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
