import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skipRate, scoreSong, weightedSample, DEFAULT_WEIGHTS } from './.gen/scorer.mjs';
import { hourToPeriod } from './.gen/profile.mjs';

const DAY = 24 * 60 * 60 * 1000;

function profile(partial) {
  return {
    songId: 1,
    title: 'S',
    artist: 'A',
    plays: 10,
    skips: 2,
    lastPlayedAt: Date.now(),
    periodCounts: [1, 2, 3, 4],
    ...partial,
  };
}

test('skipRate 拉普拉斯平滑基准', () => {
  assert.equal(skipRate(0, 0), 0.5);
  assert.equal(skipRate(3, 1), (1 + 1) / (3 + 1 + 2));
});

test('hourToPeriod 时段划分', () => {
  assert.equal(hourToPeriod(0), 0);
  assert.equal(hourToPeriod(5), 0);
  assert.equal(hourToPeriod(6), 1);
  assert.equal(hourToPeriod(18), 3);
  assert.equal(hourToPeriod(23), 3);
});

test('scoreSong 越常听/越少切歌得分越高', () => {
  const now = Date.now();
  const often = scoreSong(profile({ plays: 50, skips: 0 }), 50, now, DEFAULT_WEIGHTS);
  const rarely = scoreSong(profile({ plays: 1, skips: 20 }), 50, now, DEFAULT_WEIGHTS);
  assert.ok(often > rarely);
});

test('scoreSong 久未播放获得 staleness 加成', () => {
  const now = Date.now();
  const fresh = scoreSong(profile({ lastPlayedAt: now }), 50, now, DEFAULT_WEIGHTS);
  const stale = scoreSong(profile({ lastPlayedAt: now - 90 * DAY }), 50, now, DEFAULT_WEIGHTS);
  assert.ok(stale > fresh);
});

test('weightedSample 大曲库（6 万首）不因 Math.min 展开栈溢出（回归）', () => {
  const items = [];
  for (let i = 0; i < 60000; i++) items.push({ item: i, score: -1000 + i * 0.001 });
  const picked = weightedSample(items, 30);
  assert.equal(picked.length, 30);
  assert.ok(new Set(picked).size === 30, '抽样不应重复');
});

test('weightedSample 数量不足时全量返回', () => {
  const items = [{ item: 'a', score: 1 }, { item: 'b', score: 2 }];
  const picked = weightedSample(items, 10);
  assert.deepEqual(picked.length, 2);
});

test('weightedSample 全零分数也可抽样（平移 +0.1）', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ item: i, score: 0 }));
  const picked = weightedSample(items, 5);
  assert.equal(picked.length, 5);
});
