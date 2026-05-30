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
        const open = candles.length === 0 ? locs[0] : prevClose;
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
