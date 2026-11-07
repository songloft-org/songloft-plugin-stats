import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── 宿主 songloft 全局 mock（与宿主语义一致：set 存 JSON，get 反序列化）─────────
const kv = new Map();
globalThis.songloft = {
  storage: {
    async get(key) {
      const raw = kv.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async set(key, value) {
      kv.set(key, JSON.stringify(value));
    },
    async delete(key) {
      kv.delete(key);
    },
  },
  log: { info() {}, warn() {}, error() {} },
  songs: {
    async getById(id) {
      return { id, title: 'T' + id, artist: 'A' + id, album: 'AL' + id, duration: 180, type: 'local' };
    },
  },
};

const store = await import('./.gen/store.mjs');

const HISTORY_KEY = 'play_history';

function event(songId, ts, artist) {
  return {
    type: 'finish',
    song: { id: songId, title: 'S' + songId, artist: artist || 'A' + songId },
    source: 'web',
    timestamp: ts,
  };
}

/** 每个测试的统一前奏：resetHistory 同时清存储与模块级缓存（cache/聚合状态/队列有序） */
async function fresh() {
  kv.clear();
  await store.resetHistory();
}

test('appendRecord 落盘且增量聚合立即可见', async () => {
  await fresh();
  const now = Date.now();
  await store.appendRecord(event(1, now));
  await store.appendRecord(event(1, now + 1000));
  await store.appendRecord(event(2, now + 2000));

  const count = await store.getRecordCount();
  assert.equal(count, 3);
  const summary = await store.getSummary();
  assert.equal(summary.totalPlays, 3);
  assert.equal(summary.uniqueSongs, 2);
  assert.equal(summary.topSongs[0].plays, 2);
  // 落盘记录带上了 songs.getById 补全的元数据
  const history = await store.loadHistory();
  assert.equal(history[0].album, 'AL1');
  assert.equal(history[0].type, 'local');
});

test('setMaxHistory 超限裁剪并重建增量聚合状态', async () => {
  await fresh();
  const base = Date.now();
  for (let i = 0; i < 1100; i++) {
    await store.appendRecord(event((i % 50) + 1, base + i * 1000, 'A' + (i % 10)));
  }
  await store.setMaxHistory(1000);
  const count = await store.getRecordCount();
  assert.equal(count, 1000);
  const summary = await store.getSummary();
  assert.equal(summary.totalPlays, 1000, '裁剪后增量聚合状态应重建');
});

test('importRecords 按 songId|timestamp 去重合并并按时间排序', async () => {
  await fresh();
  const now = Date.now();
  await store.appendRecord(event(1, now, 'X'));
  await store.appendRecord(event(2, now + 1000, 'Y'));
  const imported = [
    { songId: 100, title: 'N1', artist: 'NA', timestamp: 500 },  // 新增（更早，排序后应在最前）
    { songId: 100, title: 'N1', artist: 'NA', timestamp: 500 },  // 文件内重复
    { songId: 1, title: 'A', artist: 'X', timestamp: now },       // 与现有重复
    { songId: 101, title: 'N2', artist: 'NB', timestamp: 600 },  // 新增
    { songId: 102, title: '', artist: 'NC', timestamp: 700 },    // 非法（缺 title）
    'garbage',                                                     // 非法
  ];
  const added = await store.importRecords(imported);
  assert.equal(added, 2);
  const history = await store.loadHistory();
  assert.equal(history.length, 4);
  assert.equal(history[0].songId, 100, '导入后按 timestamp 升序');
  const summary = await store.getSummary();
  assert.equal(summary.totalPlays, 4, '导入后增量聚合应覆盖新记录');
});

test('resetHistory 清空后写队列仍可用', async () => {
  await fresh();
  await store.appendRecord(event(1, Date.now()));
  await store.appendRecord(event(2, Date.now() + 1));
  assert.equal(await store.getRecordCount(), 2);

  await store.resetHistory();
  assert.equal(await store.getRecordCount(), 0);
  const skips = await store.loadSkipCounts();
  assert.equal(skips.size, 0);

  // 队列未被重置破坏：继续追加正常
  await store.appendRecord(event(3, Date.now() + 2));
  assert.equal(await store.getRecordCount(), 1);
});

test('重置与在途写入串行化：reset 不会把在途 append 的旧数据写回（回归）', async () => {
  await fresh();
  // 通过放慢 getSongMeta 让 doAppend 停在落盘前，模拟"append 在途时用户点重置"
  const realGetById = globalThis.songloft.songs.getById;
  globalThis.songloft.songs.getById = async (...a) => {
    await new Promise((r) => setTimeout(r, 30));
    return realGetById(...a);
  };
  try {
    const appendP = store.appendRecord(event(9, Date.now()));
    const resetP = store.resetHistory();
    await Promise.all([appendP, resetP]);
    // 修复前：reset 不经队列先执行完，随后在途 append 把旧记录写回 → 计数为 1
    // 修复后：两者同队列 FIFO，append 先完成、reset 随后清空 → 计数为 0
    assert.equal(await store.getRecordCount(), 0);
    assert.equal(kv.has(HISTORY_KEY), false);
  } finally {
    globalThis.songloft.songs.getById = realGetById;
  }
});

test('recordSkip 累计切歌计数并持久化', async () => {
  await fresh();
  await store.recordSkip(7);
  await store.recordSkip(7);
  await store.recordSkip(8);
  const skips = await store.loadSkipCounts();
  assert.equal(skips.get(7), 2);
  assert.equal(skips.get(8), 1);
});

test('getDedupIndex 维护 songId → 最近位置', async () => {
  await fresh();
  const now = Date.now();
  await store.appendRecord(event(1, now));
  await store.appendRecord(event(2, now + 1));
  await store.appendRecord(event(1, now + 2));
  const idx = store.getDedupIndex();
  assert.equal(idx.size, 2);
  const history = await store.loadHistory();
  assert.equal(idx.get(1), history.length - 1);
});
