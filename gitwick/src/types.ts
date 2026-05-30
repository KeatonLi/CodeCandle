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
