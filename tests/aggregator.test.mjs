import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSummary, computeTrends, computeHourlyDistribution } from './.gen/aggregator.mjs';

const DAY = 24 * 60 * 60 * 1000;

function rec(partial) {
  return {
    songId: 1,
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    source: 'web',
    type: 'local',
    timestamp: Date.now(),
    ...partial,
  };
}

test('computeSummary 汇总播放次数/去重/Top 榜', () => {
  const records = [
    rec({ songId: 1, artist: 'A', title: 'S1', album: 'X', source: 'web', type: 'local' }),
    rec({ songId: 1, artist: 'A', title: 'S1', album: 'X', source: 'web', type: 'local', timestamp: Date.now() + 1000 }),
    rec({ songId: 2, artist: 'B', title: 'S2', album: 'Y', source: 'miot', type: 'remote', timestamp: Date.now() + 2000 }),
  ];
  const s = computeSummary(records);
  assert.equal(s.totalPlays, 3);
  assert.equal(s.uniqueSongs, 2);
  assert.equal(s.uniqueArtists, 2);
  assert.equal(s.topArtists[0].artist, 'A');
  assert.equal(s.topArtists[0].plays, 2);
  assert.equal(s.topSongs[0].songId, 1);
  assert.equal(s.topAlbums[0].album, 'X');
  assert.equal(s.bySource.web, 2);
  assert.equal(s.bySource.miot, 1);
  assert.equal(s.byMediaType.local, 2);
  assert.equal(s.byMediaType.remote, 1);
});

test('computeSummary 时间范围过滤 [from, to) 左闭右开', () => {
  const from = Date.now() - 10 * DAY;
  const to = Date.now();
  const s = computeSummary([
    rec({ timestamp: from - 1 }),   // 早于 from → 排除
    rec({ timestamp: from }),       // 边界含 → 计入
    rec({ timestamp: to }),         // 等于 to → 排除
  ], { from, to });
  assert.equal(s.totalPlays, 1);
});

test('computeSummary 跳过非法记录', () => {
  const s = computeSummary([
    rec({ songId: null }),
    rec({ songId: 'x' }),
    rec({ artist: '' }),
    null,
    rec({ songId: 3, artist: 'C', title: 'S3' }),
  ]);
  assert.equal(s.totalPlays, 1);
});

test('computeTrends 只统计窗口内天数，跨年同月日不误归入（回归）', () => {
  const now = new Date();
  // 一年前的"今天"：key 的 MM/DD 相同，年份不同
  const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 12).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
  const result = computeTrends([
    rec({ timestamp: lastYear }),
    rec({ timestamp: yesterday }),
  ], 7);
  assert.equal(result.length, 7);
  const total = result.reduce((a, b) => a + b.count, 0);
  assert.equal(total, 1, '一年前的记录不应被计入 7 天窗口');
  // 输出标签仍为 MM/DD
  assert.match(result[0].date, /^\d{2}\/\d{2}$/);
});

test('computeHourlyDistribution 按时段归桶', () => {
  const mk = (h) => rec({ timestamp: new Date(2026, 0, 1, h, 30).getTime() });
  const result = computeHourlyDistribution([mk(2), mk(5), mk(9), mk(14), mk(22)]);
  const byLabel = Object.fromEntries(result.map((r) => [r.label, r.count]));
  assert.equal(byLabel['凌晨'], 2);
  assert.equal(byLabel['上午'], 1);
  assert.equal(byLabel['下午'], 1);
  assert.equal(byLabel['晚上'], 1);
});
