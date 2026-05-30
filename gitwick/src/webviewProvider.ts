import * as vscode from 'vscode';
import * as fs from 'fs';
import { CandleData, Granularity, WebviewMessage } from './types';

/**
 * Manages the Gitwick Webview Panel — creates, updates, and handles messages.
 */
export class GitwickWebviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private currentGranularity: Granularity = 'day';
  private onGranularityChange?: (g: Granularity) => void;
  private onRefresh?: () => void;

  constructor(private extensionUri: vscode.Uri) {}

  setOnGranularityChange(cb: (g: Granularity) => void): void {
    this.onGranularityChange = cb;
  }

  setOnRefresh(cb: () => void): void {
    this.onRefresh = cb;
  }

  /** Create or reveal the webview panel */
  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'gitwick',
      'Gitwick',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
        ],
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => {
        switch (msg.type) {
          case 'setGranularity':
            this.currentGranularity = msg.granularity;
            this.onGranularityChange?.(msg.granularity);
            break;
          case 'refresh':
            this.onRefresh?.();
            break;
        }
      }
    );

    this.panel.webview.html = this.getHtmlContent();
  }

  /** Send candle data to the webview for rendering */
  updateChart(candles: CandleData[], repoName: string): void {
    this.panel?.webview.postMessage({
      type: 'updateChart',
      candles,
      repoName,
    });
  }

  /** Send an error message to the webview */
  showError(message: string): void {
    this.panel?.webview.postMessage({
      type: 'error',
      message,
    });
  }

  /** Build the webview HTML, resolving local resource URLs */
  private getHtmlContent(): string {
    const webviewPath = vscode.Uri.joinPath(this.extensionUri, 'webview');
    const htmlPath = vscode.Uri.joinPath(webviewPath, 'index.html');

    try {
      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

      const styleUri = this.panel!.webview.asWebviewUri(
        vscode.Uri.joinPath(webviewPath, 'style.css')
      );
      const chartUri = this.panel!.webview.asWebviewUri(
        vscode.Uri.joinPath(webviewPath, 'chart.js')
      );

      html = html.replace('./style.css', styleUri.toString());
      html = html.replace('./chart.js', chartUri.toString());

      return html;
    } catch {
      return `<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:var(--vscode-errorForeground,#f48771);background:var(--vscode-editor-background,#1e1e1e);"><p>无法加载 Webview 资源文件。</p></body></html>`;
    }
  }
}
