import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, buildPushContent, buildTestPushContent, buildBackupPushContent } from './.gen/pusher.mjs';

test('formatDuration 分级格式化', () => {
  assert.equal(formatDuration(0), '0分钟');
  assert.equal(formatDuration(45), '45秒');
  assert.equal(formatDuration(125), '2分钟');
  assert.equal(formatDuration(3660), '1小时1分钟');
  assert.equal(formatDuration(3960), '1小时6分钟');
});

test('buildPushContent 汇总统计摘要', () => {
  const { title, content } = buildPushContent({
    totalPlays: 12,
    totalDurationSec: 7200,
    uniqueSongs: 8,
    uniqueArtists: 3,
    topArtists: [{ artist: 'A', plays: 5 }],
    topSongs: [{ songId: 1, title: 'S', artist: 'A', plays: 4 }],
    topAlbums: [],
    bySource: {},
    byMediaType: { local: 7, remote: 3, radio: 2 },
  });
  assert.match(title, /昨日听歌报告/);
  assert.match(content, /播放次数: 12/);
  assert.match(content, /2小时0分钟/);
  assert.match(content, /本地 7 次/);
  assert.match(content, /A\(5\)/);
});

test('buildPushContent 空榜单不报错', () => {
  const { content } = buildPushContent({
    totalPlays: 0, totalDurationSec: 0, uniqueSongs: 0, uniqueArtists: 0,
    topArtists: [], topSongs: [], topAlbums: [], bySource: {},
  });
  assert.ok(content.length > 0);
});

test('buildTestPushContent 不含统计', () => {
  const { title, content } = buildTestPushContent();
  assert.match(title, /测试推送/);
  assert.ok(!/\d+ 次/.test(content));
});

test('buildBackupPushContent 成功与失败分支', () => {
  const ok = buildBackupPushContent(true, 'f.json', 123);
  assert.match(ok.content, /备份成功/);
  assert.match(ok.content, /f\.json/);
  assert.match(ok.content, /123/);
  const fail = buildBackupPushContent(false, undefined, undefined, 'boom');
  assert.match(fail.content, /备份失败/);
  assert.match(fail.content, /boom/);
});
