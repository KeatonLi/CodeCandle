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
