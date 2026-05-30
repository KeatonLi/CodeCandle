# Gitwick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that visualizes Git commit history as interactive candlestick charts, treating LOC as "stock price" and commits as "trading data."

**Architecture:** Node.js extension gathers Git history via `git log --shortstat`, computes cumulative LOC time series, aggregates into OHLC candles (day/week/month), and sends JSON to a Webview panel that renders with Lightweight Charts. No frontend build toolchain — vendored ES module loaded via `<script type="module">`.

**Tech Stack:** TypeScript (extension), Vanilla JS (webview), Lightweight Charts v4.2 (ES module vendored), VS Code Extension API v1.90+

---

### Task 1: Project Scaffolding

**Files:**
- Create: `gitwick/package.json`
- Create: `gitwick/tsconfig.json`
- Create: `gitwick/.vscodeignore`
- Create: `gitwick/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "gitwick",
  "displayName": "Gitwick",
  "description": "Git commit history as candlestick charts — visualize your repo like a stock",
  "version": "0.1.0",
  "publisher": "libokai",
  "license": "MIT",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": ["Visualization", "Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "gitwick.show",
        "title": "Gitwick: Show Candlestick Chart"
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "tsc -p ./",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/vscode": "^1.90.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out", "webview"]
}
```

- [ ] **Step 3: Create .vscodeignore**

```
node_modules
src
tsconfig.json
.gitignore
webview/*.ts
```

- [ ] **Step 4: Create .gitignore**

```
node_modules
out
*.vsix
```

- [ ] **Step 5: Install dependencies and compile**

```bash
cd gitwick && npm install && npm run compile
```

Expected: `node_modules/` created, `out/` directory with compiled JS.

- [ ] **Step 6: Commit**

```bash
git add gitwick/package.json gitwick/tsconfig.json gitwick/.vscodeignore gitwick/.gitignore
git commit -m "chore: scaffold gitwick VS Code extension"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `gitwick/src/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
/** Raw commit parsed from git log output */
export interface CommitRecord {
  hash: string;
  timestamp: number; // Unix seconds
  insertions: number;
  deletions: number;
}

/** A single OHLC candle for one time bucket */
export interface CandleData {
  time: number; // Unix timestamp of bucket start, seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // insertions + deletions
  commitCount: number;
}

/** Granularity of time buckets */
export type Granularity = 'day' | 'week' | 'month';

/** Message types for extension ↔ webview communication */
export type ExtensionMessage =
  | { type: 'updateChart'; candles: CandleData[]; repoName: string }
  | { type: 'error'; message: string };

export type WebviewMessage =
  | { type: 'setGranularity'; granularity: Granularity }
  | { type: 'refresh' };
```

- [ ] **Step 2: Commit**

```bash
git add gitwick/src/types.ts
git commit -m "feat: add type definitions for commit records, candles, and messages"
```

---

### Task 3: GitDataCollector

**Files:**
- Create: `gitwick/src/gitDataCollector.ts`

- [ ] **Step 1: Create gitDataCollector.ts**

```typescript
import { execFile } from 'child_process';
import { CommitRecord } from './types';

/**
 * Collects commit history from a Git repository and computes cumulative LOC.
 */
export class GitDataCollector {
  constructor(private repoPath: string) {}

  /** Run git and return stdout as string */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: this.repoPath,
        maxBuffer: 50 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) {
          reject(new Error(`git ${args[0]} failed: ${err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /** Parse git log --shortstat output into CommitRecord[] */
  parseGitLog(output: string, limit: number = 10000): CommitRecord[] {
    const records: CommitRecord[] = [];
    const lines = output.split('\n');
    let i = 0;

    while (i < lines.length && records.length < limit) {
      const line = lines[i].trim();

      // Match hash + timestamp line: "abc1234 1717027200"
      const headerMatch = line.match(/^([0-9a-f]{7,40})\s+(\d+)$/);
      if (headerMatch) {
        const hash = headerMatch[1];
        const timestamp = parseInt(headerMatch[2], 10);

        let insertions = 0;
        let deletions = 0;

        // Check next lines for shortstat
        // Pattern: "X files changed, Y insertions(+), Z deletions(-)"
        // or just: "Y insertions(+), Z deletions(-)"
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const statLine = lines[j].trim();
          const insMatch = statLine.match(/(\d+)\s+insertions?\(\+\)/);
          const delMatch = statLine.match(/(\d+)\s+deletions?\(-\)/);
          if (insMatch) insertions = parseInt(insMatch[1], 10);
          if (delMatch) deletions = parseInt(delMatch[1], 10);
          if (insMatch || delMatch) break;
        }

        records.push({ hash, timestamp, insertions, deletions });
      }
      i++;
    }

    return records;
  }

  /** Collect all commit records and compute cumulative LOC sequence */
  async collect(limit: number = 10000): Promise<CommitRecord[]> {
    const output = await this.execGit([
      'log',
      '--all',
      '--reverse',
      '--format=%H %at',
      '--shortstat',
      '--no-merges',
    ]);

    const records = this.parseGitLog(output, limit);
    return records;
  }

  /** Get the repository name from the path */
  getRepoName(): string {
    const parts = this.repoPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /** Check if the given path is inside a git repository */
  static async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['rev-parse', '--git-dir'], {
          cwd: repoPath,
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add gitwick/src/gitDataCollector.ts
git commit -m "feat: add GitDataCollector for parsing git log and computing LOC history"
```

---

### Task 4: CandlestickAggregator (with unit tests)

**Files:**
- Create: `gitwick/src/candlestickAggregator.ts`
- Create: `gitwick/src/__tests__/candlestickAggregator.test.ts`
- Modify: `gitwick/package.json` (add test script)
- Modify: `gitwick/tsconfig.json` (if needed for tests)

- [ ] **Step 1: Create candlestickAggregator.ts**

```typescript
import { CommitRecord, CandleData, Granularity } from './types';

/**
 * Aggregates commit records into OHLC candlestick data grouped by time buckets.
 */
export class CandlestickAggregator {
  /**
   * Get the start of a time bucket for a given timestamp.
   * day: midnight UTC of that day
   * week: midnight UTC of the Monday of that week
   * month: midnight UTC of the 1st of that month
   */
  private bucketStart(ts: number, granularity: Granularity): number {
    const d = new Date(ts * 1000);
    if (granularity === 'day') {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    }
    if (granularity === 'week') {
      const dayOfWeek = d.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday=0
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset) / 1000;
    }
    // month
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }

  /**
   * Get the next bucket start after the given timestamp.
   */
  private nextBucketStart(ts: number, granularity: Granularity): number {
    const d = new Date(ts * 1000);
    if (granularity === 'day') {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
    }
    if (granularity === 'week') {
      return this.bucketStart(ts, 'week') + 7 * 86400;
    }
    // month
    const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return nextMonth.getTime() / 1000;
  }

  /**
   * Convert CommitRecord[] to CandleData[] for the given granularity.
   *
   * For each time bucket:
   * - open  = cumulative LOC at first commit in bucket
   * - close = cumulative LOC at last commit in bucket
   * - high  = max cumulative LOC in bucket
   * - low   = min cumulative LOC in bucket
   * - volume = sum(insertions + deletions) in bucket
   *
   * Buckets with no commits carry forward the previous close
   * (open=high=low=close=prevClose, volume=0).
   */
  aggregate(records: CommitRecord[], granularity: Granularity): CandleData[] {
    if (records.length === 0) return [];

    // Compute cumulative LOC
    let cumulativeLoc = 0;
    const withLoc = records.map(r => {
      cumulativeLoc += r.insertions - r.deletions;
      return { ...r, cumulativeLoc };
    });

    // Group commits by bucket
    const bucketMap = new Map<number, { cumulativeLocs: number[]; volume: number; commitCount: number }>();

    for (const r of withLoc) {
      const bucket = this.bucketStart(r.timestamp, granularity);
      let entry = bucketMap.get(bucket);
      if (!entry) {
        entry = { cumulativeLocs: [], volume: 0, commitCount: 0 };
        bucketMap.set(bucket, entry);
      }
      entry.cumulativeLocs.push(r.cumulativeLoc);
      entry.volume += r.insertions + r.deletions;
      entry.commitCount += 1;
    }

    if (bucketMap.size === 0) return [];

    // Sort bucket keys
    const sortedBuckets = Array.from(bucketMap.keys()).sort((a, b) => a - b);

    // Generate candles for all buckets in range, including empty ones
    const candles: CandleData[] = [];
    let prevClose = 0;

    const firstBucket = sortedBuckets[0];
    const lastBucket = sortedBuckets[sortedBuckets.length - 1];

    let currentBucket = firstBucket;
    while (currentBucket <= lastBucket) {
      const entry = bucketMap.get(currentBucket);

      if (entry && entry.cumulativeLocs.length > 0) {
        const locs = entry.cumulativeLocs;
        const open = locs[0];
        const close = locs[locs.length - 1];
        const high = Math.max(...locs);
        const low = Math.min(...locs);

        candles.push({
          time: currentBucket,
          open,
          high,
          low,
          close,
          volume: entry.volume,
          commitCount: entry.commitCount,
        });
        prevClose = close;
      } else {
        // Empty bucket: carry forward
        candles.push({
          time: currentBucket,
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose,
          volume: 0,
          commitCount: 0,
        });
      }

      currentBucket = this.nextBucketStart(currentBucket, granularity);
    }

    return candles;
  }
}
```

- [ ] **Step 2: Create the test file**

```typescript
import * as assert from 'assert';
import { CandlestickAggregator } from '../candlestickAggregator';
import { CommitRecord } from '../types';

suite('CandlestickAggregator', () => {
  const aggregator = new CandlestickAggregator();

  test('returns empty array for no commits', () => {
    const result = aggregator.aggregate([], 'day');
    assert.deepStrictEqual(result, []);
  });

  test('single commit produces one candle with correct OHLC', () => {
    const records: CommitRecord[] = [
      { hash: 'a', timestamp: 1717027200, insertions: 100, deletions: 0 },
    ];
    const result = aggregator.aggregate(records, 'day');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].open, 100);
    assert.strictEqual(result[0].close, 100);
    assert.strictEqual(result[0].high, 100);
    assert.strictEqual(result[0].low, 100);
    assert.strictEqual(result[0].volume, 100);
    assert.strictEqual(result[0].commitCount, 1);
  });

  test('two commits same day produce one candle', () => {
    // Same day: 2024-05-30 00:00:00 and 2024-05-30 12:00:00
    const ts1 = Date.UTC(2024, 4, 30, 0, 0, 0) / 1000;
    const ts2 = Date.UTC(2024, 4, 30, 12, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: ts1, insertions: 50, deletions: 0 },
      { hash: 'b', timestamp: ts2, insertions: 30, deletions: 10 },
    ];
    const result = aggregator.aggregate(records, 'day');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].open, 50);    // first commit LOC = 50
    assert.strictEqual(result[0].close, 70);   // 50 + 30 - 10 = 70
    assert.strictEqual(result[0].high, 70);
    assert.strictEqual(result[0].low, 50);
    assert.strictEqual(result[0].volume, 90);  // (50+0)+(30+10)
    assert.strictEqual(result[0].commitCount, 2);
  });

  test('commits on different days produce separate candles with gap fill', () => {
    // Day 1: 2024-05-30
    const ts1 = Date.UTC(2024, 4, 30, 10, 0, 0) / 1000;
    // Day 3: 2024-06-01
    const ts2 = Date.UTC(2024, 5, 1, 10, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: ts1, insertions: 100, deletions: 0 },
      { hash: 'b', timestamp: ts2, insertions: 50, deletions: 0 },
    ];
    const result = aggregator.aggregate(records, 'day');

    // Should have 3 candles: May 30, May 31 (empty), June 1
    assert.strictEqual(result.length, 3);

    // May 30
    assert.strictEqual(result[0].open, 100);
    assert.strictEqual(result[0].close, 100);
    assert.strictEqual(result[0].commitCount, 1);

    // May 31 (empty carry-forward)
    assert.strictEqual(result[1].open, 100);
    assert.strictEqual(result[1].close, 100);
    assert.strictEqual(result[1].high, 100);
    assert.strictEqual(result[1].low, 100);
    assert.strictEqual(result[1].volume, 0);
    assert.strictEqual(result[1].commitCount, 0);

    // June 1
    assert.strictEqual(result[2].open, 100);
    assert.strictEqual(result[2].close, 150);
    assert.strictEqual(result[2].commitCount, 1);
  });

  test('deletions reduce cumulative LOC', () => {
    const ts1 = Date.UTC(2024, 4, 30, 0, 0, 0) / 1000;
    const ts2 = Date.UTC(2024, 4, 31, 0, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: ts1, insertions: 200, deletions: 0 },
      { hash: 'b', timestamp: ts2, insertions: 0, deletions: 50 },
    ];
    const result = aggregator.aggregate(records, 'day');

    assert.strictEqual(result[0].close, 200);
    assert.strictEqual(result[1].close, 150);
    assert.strictEqual(result[1].volume, 50);
  });

  test('weekly granularity groups commits into Monday-start weeks', () => {
    // Monday 2024-05-27
    const mon = Date.UTC(2024, 4, 27, 10, 0, 0) / 1000;
    // Wednesday 2024-05-29
    const wed = Date.UTC(2024, 4, 29, 10, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: mon, insertions: 50, deletions: 0 },
      { hash: 'b', timestamp: wed, insertions: 50, deletions: 0 },
    ];
    const result = aggregator.aggregate(records, 'week');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].open, 50);
    assert.strictEqual(result[0].close, 100);
    assert.strictEqual(result[0].commitCount, 2);
  });

  test('monthly granularity groups commits by month', () => {
    const may = Date.UTC(2024, 4, 15, 0, 0, 0) / 1000;
    const june = Date.UTC(2024, 5, 15, 0, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: may, insertions: 100, deletions: 0 },
      { hash: 'b', timestamp: june, insertions: 200, deletions: 0 },
    ];
    const result = aggregator.aggregate(records, 'month');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].close, 100);
    assert.strictEqual(result[1].close, 300);
  });

  test('high and low track intra-bucket extremes', () => {
    const ts1 = Date.UTC(2024, 4, 30, 0, 0, 0) / 1000;
    const ts2 = Date.UTC(2024, 4, 30, 4, 0, 0) / 1000;
    const ts3 = Date.UTC(2024, 4, 30, 8, 0, 0) / 1000;

    const records: CommitRecord[] = [
      { hash: 'a', timestamp: ts1, insertions: 100, deletions: 0 },  // LOC=100
      { hash: 'b', timestamp: ts2, insertions: 0, deletions: 80 },    // LOC=20
      { hash: 'c', timestamp: ts3, insertions: 200, deletions: 0 },   // LOC=220
    ];
    const result = aggregator.aggregate(records, 'day');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].open, 100);
    assert.strictEqual(result[0].high, 220);
    assert.strictEqual(result[0].low, 20);
    assert.strictEqual(result[0].close, 220);
  });
});
```

- [ ] **Step 3: Add test configuration to package.json**

Add to the root of `package.json`, after `"scripts"`:

```json
"scripts": {
  "vscode:prepublish": "tsc -p ./",
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "test": "node ./out/__tests__/runTest.js"
},
```

Also add `@types/mocha` and `@vscode/test-electron` to devDependencies:

```json
"devDependencies": {
  "@types/vscode": "^1.90.0",
  "@types/node": "^20.0.0",
  "@types/mocha": "^10.0.0",
  "typescript": "^5.4.0",
  "@vscode/test-electron": "^2.4.0"
}
```

- [ ] **Step 4: Create test runner**

Create `gitwick/src/__tests__/runTest.ts`:

```typescript
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
```

Create `gitwick/src/__tests__/suite/index.ts`:

```typescript
import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((resolve, reject) => {
    glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
      if (err) return reject(err);
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
      try {
        mocha.run(failures => {
          if (failures > 0) reject(new Error(`${failures} tests failed.`));
          else resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
```

- [ ] **Step 5: Install test dependencies and run tests**

```bash
cd gitwick && npm install && npm run compile && npm test
```

Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add gitwick/src/candlestickAggregator.ts gitwick/src/__tests__/ gitwick/package.json
git commit -m "feat: add CandlestickAggregator with unit tests for OHLC bucketing"
```

---

### Task 5: WebviewProvider

**Files:**
- Create: `gitwick/src/webviewProvider.ts`

- [ ] **Step 1: Create webviewProvider.ts**

```typescript
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

    // Read the HTML file
    let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

    // Replace local resource references with webview URIs
    const styleUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, 'style.css')
    );
    const chartUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, 'chart.js')
    );

    html = html.replace('./style.css', styleUri.toString());
    html = html.replace('./chart.js', chartUri.toString());

    return html;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add gitwick/src/webviewProvider.ts
git commit -m "feat: add WebviewProvider for panel lifecycle and message passing"
```

---

### Task 6: Extension Entry Point

**Files:**
- Create: `gitwick/src/extension.ts`

- [ ] **Step 1: Create extension.ts**

```typescript
import * as vscode from 'vscode';
import { GitDataCollector } from './gitDataCollector';
import { CandlestickAggregator } from './candlestickAggregator';
import { GitwickWebviewProvider } from './webviewProvider';
import { Granularity } from './types';

export function activate(context: vscode.ExtensionContext) {
  const webviewProvider = new GitwickWebviewProvider(context.extensionUri);

  async function loadAndRender(granularity: Granularity = 'day') {
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
    } catch (err: any) {
      webviewProvider.showError(`Git 命令执行失败: ${err.message}`);
    }
  }

  webviewProvider.setOnGranularityChange((granularity: Granularity) => {
    loadAndRender(granularity);
  });

  webviewProvider.setOnRefresh(() => {
    loadAndRender(webviewProvider['currentGranularity'] || 'day');
  });

  const showCommand = vscode.commands.registerCommand('gitwick.show', () => {
    webviewProvider.show();
    loadAndRender();
  });

  context.subscriptions.push(showCommand);
}

export function deactivate() {}
```

**Note:** The private field access `webviewProvider['currentGranularity']` is a deliberate workaround since the field is private. We'll make it accessible in the next step.

- [ ] **Step 2: Commit**

```bash
git add gitwick/src/extension.ts
git commit -m "feat: add extension entry point wiring data collection to webview"
```

---

### Task 7: Webview Frontend

**Files:**
- Create: `gitwick/webview/index.html`
- Create: `gitwick/webview/style.css`
- Create: `gitwick/webview/chart.js`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gitwick</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="toolbar">
    <span id="repoName">Gitwick</span>
    <div id="granularityGroup">
      <button class="granularity-btn active" data-gran="day">日</button>
      <button class="granularity-btn" data-gran="week">周</button>
      <button class="granularity-btn" data-gran="month">月</button>
    </div>
    <button id="refreshBtn" title="刷新">↻</button>
  </div>

  <div id="chartContainer"></div>

  <div id="statusBar">
    <span id="statusText">点击蜡烛查看详情</span>
  </div>

  <div id="errorOverlay" class="hidden">
    <div class="error-box">
      <p id="errorMessage"></p>
      <button id="retryBtn">重试</button>
    </div>
  </div>

  <script type="module" src="./chart.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create style.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--vscode-editor-background, #1e1e1e);
  color: var(--vscode-editor-foreground, #cccccc);
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

#toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  flex-shrink: 0;
}

#repoName {
  font-weight: 600;
  font-size: 14px;
}

#granularityGroup {
  display: flex;
  gap: 0;
  border: 1px solid var(--vscode-panel-border, #3c3c3c);
  border-radius: 4px;
  overflow: hidden;
}

.granularity-btn {
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--vscode-editor-foreground, #cccccc);
  cursor: pointer;
  font-size: 12px;
  border-right: 1px solid var(--vscode-panel-border, #3c3c3c);
}

.granularity-btn:last-child {
  border-right: none;
}

.granularity-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, #2a2d2e);
}

.granularity-btn.active {
  background: var(--vscode-button-background, #0078d4);
  color: var(--vscode-button-foreground, #ffffff);
}

#refreshBtn {
  margin-left: auto;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--vscode-editor-foreground, #cccccc);
  cursor: pointer;
  font-size: 16px;
  border-radius: 4px;
}

#refreshBtn:hover {
  background: var(--vscode-toolbar-hoverBackground, #2a2d2e);
}

#chartContainer {
  flex: 1;
  position: relative;
}

#statusBar {
  padding: 6px 16px;
  border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
  font-size: 12px;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground, #999);
}

#errorOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vscode-editor-background, #1e1e1e);
}

#errorOverlay.hidden {
  display: none;
}

.error-box {
  text-align: center;
}

.error-box p {
  margin-bottom: 16px;
  color: var(--vscode-errorForeground, #f48771);
}

.error-box button {
  padding: 6px 20px;
  border: none;
  background: var(--vscode-button-background, #0078d4);
  color: var(--vscode-button-foreground, #ffffff);
  border-radius: 4px;
  cursor: pointer;
}

.error-box button:hover {
  background: var(--vscode-button-hoverBackground, #026ec1);
}
```

- [ ] **Step 3: Create chart.js**

```javascript
import { createChart, CrosshairMode } from './lightweight-charts.standalone.production.mjs';

const vscode = acquireVsCodeApi();

let chart = null;
let candleSeries = null;
let volumeSeries = null;

// Initialize chart
function initChart() {
  const container = document.getElementById('chartContainer');
  chart = createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#999',
    },
    grid: {
      vertLines: { color: '#2a2a2a' },
      horzLines: { color: '#2a2a2a' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: '#3c3c3c',
    },
    timeScale: {
      borderColor: '#3c3c3c',
      timeVisible: true,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#ef4444',
    downColor: '#22c55e',
    borderUpColor: '#ef4444',
    borderDownColor: '#22c55e',
    wickUpColor: '#ef4444',
    wickDownColor: '#22c55e',
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });

  // Set volume series to bottom scale
  volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  chart.subscribeCrosshairMove((param) => {
    if (!param.time || !param.point) {
      document.getElementById('statusText').textContent = '点击蜡烛查看详情';
      return;
    }

    const candleData = param.seriesData.get(candleSeries);
    if (candleData) {
      const d = new Date(candleData.time * 1000);
      const dateStr = d.toLocaleDateString('zh-CN');
      document.getElementById('statusText').textContent =
        `${dateStr}  |  O:${candleData.open.toLocaleString()}  H:${candleData.high.toLocaleString()}  L:${candleData.low.toLocaleString()}  C:${candleData.close.toLocaleString()}  |  Vol:${(candleData.volume || 0).toLocaleString()} lines`;
    }
  });

  // Resize on container resize
  const observer = new ResizeObserver(() => {
    if (chart) chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  observer.observe(container);
}

// Update chart with new data
function updateChart(candles) {
  if (!chart) return;

  const candleData = candles.map(c => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  const volData = candles.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)',
  }));

  candleSeries.setData(candleData);
  volumeSeries.setData(volData);
}

// Granularity buttons
const buttons = document.querySelectorAll('.granularity-btn');
buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const gran = btn.getAttribute('data-gran');
    vscode.postMessage({ type: 'setGranularity', granularity: gran });
  });
});

// Refresh button
document.getElementById('refreshBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});

// Retry button
document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('errorOverlay').classList.add('hidden');
  vscode.postMessage({ type: 'refresh' });
});

// Handle messages from extension
window.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'updateChart') {
    document.getElementById('errorOverlay').classList.add('hidden');
    document.getElementById('repoName').textContent = 'Gitwick - ' + msg.repoName;

    if (!chart) initChart();
    updateChart(msg.candles);
  }

  if (msg.type === 'error') {
    document.getElementById('errorMessage').textContent = msg.message;
    document.getElementById('errorOverlay').classList.remove('hidden');
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add gitwick/webview/
git commit -m "feat: add webview frontend with Lightweight Charts rendering"
```

---

### Task 8: Download and Vendor Lightweight Charts

**Files:**
- Create: `gitwick/webview/lightweight-charts.standalone.production.mjs`

- [ ] **Step 1: Download the ES module bundle**

```bash
cd gitwick && npm install lightweight-charts@4.2.2 --save-prod
cp node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs webview/
```

- [ ] **Step 2: Commit**

```bash
git add gitwick/webview/lightweight-charts.standalone.production.mjs gitwick/package.json gitwick/package-lock.json
git commit -m "chore: vendor lightweight-charts 4.2 ES module bundle"
```

---

### Task 9: Final Integration and Build Check

**Files:**
- No new files. Verify everything compiles and the extension structure is correct.

- [ ] **Step 1: Compile the extension**

```bash
cd gitwick && npm run compile
```

Expected: No TypeScript errors, `out/` directory populated.

- [ ] **Step 2: Verify file structure**

```bash
ls -la gitwick/
ls -la gitwick/out/
ls -la gitwick/webview/
```

Expected structure:
```
gitwick/
├── out/          (compiled JS)
├── src/          (source TS)
├── webview/      (HTML/CSS/JS/LWC)
├── package.json
├── tsconfig.json
├── node_modules/
```

- [ ] **Step 3: Run tests**

```bash
cd gitwick && npm test
```

Expected: All 8 unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add gitwick/out/ gitwick/src/
git commit -m "chore: final integration — all modules wired, tests passing"
```

---

### Task 10: README

**Files:**
- Create: `gitwick/README.md`

- [ ] **Step 1: Create README.md**

```markdown
# Gitwick

将 Git 仓库的提交历史可视化为 K 线/蜡烛图，让开发者直观看到代码库的"涨跌"与"成交量"。

## 功能

- K线图展示代码行数（LOC）随时间的变化趋势
- 成交量柱状图反映代码改动强度
- 日/周/月三种粒度切换
- 鼠标悬停查看每根蜡烛的详细数据（开/高/低/收/量）
- 缩放、平移等交互

## 使用方法

1. 在 VS Code 中打开一个 Git 仓库
2. 按 `Ctrl+Shift+P` 打开命令面板
3. 输入 `Gitwick: Show Candlestick Chart` 并回车
4. 侧边打开 Gitwick 面板，显示 K 线图

## 开发

```bash
npm install
npm run compile
npm test
```

按 F5 启动 Extension Development Host 调试。

## 技术栈

- Lightweight Charts (TradingView) — 金融级 K 线图渲染
- TypeScript — 扩展本体
- VS Code Extension API — Webview Panel

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add gitwick/README.md
git commit -m "docs: add README with usage and development instructions"
```

---
