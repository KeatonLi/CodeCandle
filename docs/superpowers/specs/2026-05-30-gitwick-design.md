# Gitwick — 设计规格说明

**日期**: 2026-05-30  
**项目**: Gitwick — Git 仓库提交历史 K 线图 VS Code 插件

## 产品定义

- **一句话描述**：把代码行数（LOC）当作"股价"，把 Git 提交历史当作"交易记录"，在 VS Code 中生成可交互的 K 线图。
- **目标用户**：对代码库演化趋势感兴趣的开发者、开源项目维护者。
- **形态**：纯 VS Code 插件，通过 Webview Panel 展示。

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  VS Code Extension (Node.js)                    │
│                                                 │
│  ┌────────────┐    ┌──────────────────────┐     │
│  │ extension.ts│───▶│ GitDataCollector      │     │
│  │ (入口)      │    │ - git log --shortstat │     │
│  │            │    │ - 累计 LOC 时间序列      │     │
│  │            │    └──────────┬───────────┘     │
│  │            │               │                 │
│  │            │    ┌──────────▼───────────┐     │
│  │            │    │ CandlestickAggregator │     │
│  │            │    │ - commit→K线聚合       │     │
│  │            │    │ - 日/周/月粒度切换     │     │
│  │            │    └──────────┬───────────┘     │
│  │            │               │                 │
│  │  ┌─────────▼───────────────▼───────────┐     │
│  │  │           Webview Panel              │     │
│  │  │  - Lightweight Charts 渲染 K 线      │     │
│  │  │  - 粒度切换 / 缩放平移 / Hover      │     │
│  └────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 职责 |
|------|------|
| `extension.ts` | 注册命令、创建 Webview Panel、协调数据流 |
| `GitDataCollector` | 执行 `git log`、解析输出、计算累计 LOC 时间序列 |
| `CandlestickAggregator` | 将原始 commit 数据按时间桶聚合成 OHLC + Volume |
| `WebviewProvider` | Webview 生命周期管理、postMessage 通信 |
| Webview 前端 (HTML/JS) | Lightweight Charts 渲染、交互控制 |

---

## 数据管线

### 1. 提取原始 commit 数据

```bash
git log --all --format="%H %at" --shortstat
```

解析每个 commit: `{ hash, timestamp, insertions, deletions }`

### 2. 计算累计 LOC

```
累计LOC[n] = 累计LOC[n-1] + insertions[n] - deletions[n]
```

初始 LOC 通过 checkout 到第一个 commit 后用 `cloc` 计算，然后逐 commit 累加。

### 3. K 线聚合

对每个时间桶（日/周/月）：

| 字段 | 计算规则 |
|------|---------|
| Open | 桶内第一个 commit 时的累计 LOC |
| Close | 桶内最后一个 commit 时的累计 LOC |
| High | 桶内累计 LOC 最大值 |
| Low | 桶内累计 LOC 最小值 |
| Volume | 桶内所有 commit 的 (insertions + deletions) 之和 |

空时间桶（无 commit）→ 前一根蜡烛的 Close 平推（Open=High=Low=Close=前Close，Volume=0）。

### 4. 传输

聚合后的 OHLC 数组通过 `panel.webview.postMessage()` 发送到前端。

---

## 前端 UI

### 布局

```
┌──────────────────────────────────────────────────┐
│  Gitwick  my-project▼  [日] [周] [月]            │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┃ K线图 (Candlestick Series)                   │
│  ┃ 红涨绿跌 / 缩放平移 / 十字光标               │
│  ┃────────────────────────────────────          │
│  █ 成交量 (Histogram Series)                    │
│  ────────────────────────────────────           │
│  状态栏: 日期 | O:0000 H:0000 L:0000 C:0000     │
│           Vol: 0000 lines | Commits: 00          │
└──────────────────────────────────────────────────┘
```

### 工具栏

- 仓库名 + 分支显示
- 日/周/月 切换按钮组（Chip 样式）
- （后续可加）刷新按钮

### 图表交互

- **缩放/平移**：鼠标滚轮缩放，拖拽平移（Lightweight Charts 原生能力）
- **Hover 十字光标**：显示当前蜡烛的 tooltip
- **底部状态栏**：选中蜡烛的完整数据（开/高/低/收/量/提交数）

### 颜色方案

- 涨（Close > Open）：红色 `#ef4444`
- 跌（Close <= Open）：绿色 `#22c55e`
- 成交量：与涨跌同色

---

## 错误处理

| 场景 | 表现 |
|------|------|
| 工作区不是 Git 仓库 | 面板显示空状态："当前工作区不是 Git 仓库" |
| Git 历史为空 | 显示："此仓库尚无提交记录" |
| 仓库过大 (>10,000 commits) | 截断至最近 10,000 条，顶部提示 |
| `git` 命令执行失败 | 显示错误信息 + 重试按钮 |
| Lightweight Charts 加载失败 | 显示"图表库加载失败" + 重试 |

---

## 文件结构

```
gitwick/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts            # activate/deactivate 入口
│   ├── gitDataCollector.ts     # git log 执行与解析
│   ├── candlestickAggregator.ts
│   ├── webviewProvider.ts
│   └── types.ts
├── webview/
│   ├── index.html
│   ├── style.css
│   ├── chart.ts
│   └── lightweight-charts.umd.js   # vendored
└── README.md
```

---

## 命令注册

| 命令 ID | 功能 |
|---------|------|
| `gitwick.show` | 打开 Gitwick 面板 |

## 激活条件

当 VS Code 打开的工作区是 Git 仓库时激活（`activationEvents: ["onStartupFinished"]`，由扩展自行判断）。

---

## 技术选型

| 项 | 选择 |
|----|------|
| 图表库 | Lightweight Charts (TradingView) |
| 代码行数统计 | `scc` 或直接逐 commit 累加（不依赖外部二进制） |
| 前端工具链 | 无 — 纯 HTML/JS，vendored library |
| TypeScript | Yes（扩展本体） |
| 打包 | vsce（标准 VS Code 扩展打包） |
