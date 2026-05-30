import * as vscode from 'vscode';
import { GitDataCollector } from './gitDataCollector';
import { CandlestickAggregator } from './candlestickAggregator';
import { GitwickWebviewProvider } from './webviewProvider';
import { Granularity } from './types';

export function activate(context: vscode.ExtensionContext) {
  const webviewProvider = new GitwickWebviewProvider(context.extensionUri);
  let currentGranularity: Granularity = 'day';
  let isLoading = false;

  async function loadAndRender(granularity: Granularity) {
    if (isLoading) return;
    isLoading = true;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        webviewProvider.showError('没有打开的工作区。');
        return;
      }

      const repoPath = workspaceFolders[0].uri.fsPath;

      const isRepo = await GitDataCollector.isGitRepo(repoPath);
      if (!isRepo) {
        webviewProvider.showError('当前工作区不是 Git 仓库。');
        return;
      }

      try {
        const collector = new GitDataCollector(repoPath);
        const records = await collector.collect();

        if (records.length === 0) {
          webviewProvider.showError('此仓库尚无提交记录。');
          return;
        }

        const aggregator = new CandlestickAggregator();
        const candles = aggregator.aggregate(records, granularity);
        const repoName = collector.getRepoName();

        webviewProvider.updateChart(candles, repoName);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewProvider.showError(`Git 命令执行失败: ${message}`);
      }
    } finally {
      isLoading = false;
    }
  }

  webviewProvider.setOnGranularityChange((granularity: Granularity) => {
    currentGranularity = granularity;
    loadAndRender(granularity);
  });

  webviewProvider.setOnRefresh(() => {
    loadAndRender(currentGranularity);
  });

  const showCommand = vscode.commands.registerCommand('gitwick.show', () => {
    webviewProvider.show();
    loadAndRender(currentGranularity);
  });

  context.subscriptions.push(showCommand);
}

export function deactivate() {}
