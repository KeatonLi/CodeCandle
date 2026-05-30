import { createChart } from './lightweight-charts.standalone.production.mjs';

const vscode = acquireVsCodeApi();

let chart = null;
let candleSeries = null;
let volumeSeries = null;

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
      mode: 1, // CrosshairMode.Normal = 1
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

  const observer = new ResizeObserver(() => {
    if (chart) chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  observer.observe(container);
}

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
