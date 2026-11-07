import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── 宿主 songloft 全局 mock ──────────────────────────────────────────────────
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
      return { id, title: 'T' + id, artist: 'A' + id, album: 'AL', duration: 200, type: 'local' };
    },
    async list() {
      return [];
    },
  },
  playlists: {
    async list() {
      return [];
    },
    async getSongs() {
      return [];
    },
    async addSongs() {
      return { added: 0, skipped: 0 };
    },
    async removeSongs() {},
    async create(p) {
      return { id: 1, name: p.name };
    },
  },
  events: {
    onPlayEvent() {},
    offPlayEvent() {},
  },
  plugin: {
    async getToken() {
      return 'token';
    },
    async getHostUrl() {
      return 'http://localhost:58091';
    },
  },
};

// 定时调度（scheduleNextPush 等）会挂起长延迟 setTimeout，测试进程不应等它：
// 全局替换为 no-op（node:test 内部计时器走 node 内部绑定，不受影响）
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

const router = (await import('./.gen/router.mjs')).default;

async function call(method, path, { query = '', body } = {}) {
  const res = await router.handle({
    method,
    path,
    query,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    parsed = { raw: res.body };
  }
  return { status: res.statusCode, headers: res.headers, ...parsed };
}

test('未知路由返回 404', async () => {
  const res = await call('GET', '/api/nope');
  assert.equal(res.status, 404);
});

test('GET /api/settings 返回上限与记录数', async () => {
  kv.clear();
  const res = await call('GET', '/api/settings');
  assert.equal(res.success, true);
  assert.equal(typeof res.data.maxHistory, 'number');
  assert.equal(res.data.recordCount, 0);
});

test('POST /api/settings 拒绝非数字 maxHistory', async () => {
  const res = await call('POST', '/api/settings', { body: { maxHistory: 'abc' } });
  assert.equal(res.success, false);
});

test('POST /api/settings 保存上限并落盘', async () => {
  const res = await call('POST', '/api/settings', { body: { maxHistory: 5000 } });
  assert.equal(res.success, true);
  assert.equal(res.data.maxHistory, 5000);
  assert.equal(JSON.parse(kv.get('settings')).maxHistory, 5000);
});

test('POST /api/push/config 旧格式只覆盖目标平台，不清掉另一平台（回归）', async () => {
  kv.clear();
  // 预置：飞书已配置
  kv.set('push_config', JSON.stringify({
    feishu: { token: 'FEISHU_KEY', enabled: true },
    wxpusher: { token: '', enabled: false },
  }));
  // 旧格式请求：只配置 wxpusher
  const res = await call('POST', '/api/push/config', {
    body: { config: { platform: 'wxpusher', token: 'SPT123', enabled: true } },
  });
  assert.equal(res.success, true);
  assert.equal(res.data.config.wxpusher.token, 'SPT123');
  assert.equal(res.data.config.wxpusher.enabled, true);
  // 修复前：旧格式分支重建全空配置再填单平台 → 飞书 token 被清空
  assert.equal(res.data.config.feishu.token, 'FEISHU_KEY', '另一平台配置必须保留');
  assert.equal(res.data.config.feishu.enabled, true);
});

test('POST /api/push/config 新格式按平台合并', async () => {
  kv.clear();
  await call('POST', '/api/push/config', {
    body: { config: { feishu: { token: 'K1', enabled: true } } },
  });
  const res = await call('POST', '/api/push/config', {
    body: { config: { wxpusher: { token: 'K2', enabled: true } } },
  });
  assert.equal(res.data.config.feishu.token, 'K1');
  assert.equal(res.data.config.wxpusher.token, 'K2');
});

test('POST /api/push/config 校验 schedule 时间范围', async () => {
  kv.clear();
  const badHour = await call('POST', '/api/push/config', {
    body: { schedule: { enabled: true, hour: 25, minute: 0 } },
  });
  assert.equal(badHour.success, false);
  const badMinute = await call('POST', '/api/push/config', {
    body: { schedule: { enabled: true, hour: 8, minute: 60 } },
  });
  assert.equal(badMinute.success, false);
  const ok = await call('POST', '/api/push/config', {
    body: { schedule: { enabled: true, hour: 8, minute: 30 } },
  });
  assert.equal(ok.success, true);
  assert.equal(ok.data.schedule.hour, 8);
});

test('POST /api/import 接受裸数组与 records 包装', async () => {
  await call('POST', '/api/reset', { body: {} });
  const r1 = { songId: 1, title: 'A', artist: 'X', timestamp: 100 };
  const r2 = { songId: 2, title: 'B', artist: 'Y', timestamp: 200 };
  const viaRecords = await call('POST', '/api/import', { body: { records: [r1, r2] } });
  assert.equal(viaRecords.success, true);
  assert.equal(viaRecords.data.added, 2);
  const bare = await call('POST', '/api/import', { body: [r1] });
  assert.equal(bare.data.added, 0, '与已有记录重复应跳过');
  const invalid = await call('POST', '/api/import', { body: {} });
  assert.equal(invalid.success, true);
  assert.equal(invalid.data.added, 0);
});

test('GET /api/stats/summary 支持时间范围查询', async () => {
  // store 模块级缓存跨测试持续，用 /api/reset 同时清存储与缓存
  await call('POST', '/api/reset', { body: {} });
  const now = Date.now();
  await call('POST', '/api/import', {
    body: { records: [
      { songId: 1, title: 'A', artist: 'X', timestamp: now - 1000 },
      { songId: 2, title: 'B', artist: 'Y', timestamp: now + 86400000 },
    ] },
  });
  const ranged = await call('GET', '/api/stats/summary', { query: `from=${now - 5000}&to=${now + 5000}` });
  assert.equal(ranged.success, true);
  assert.equal(ranged.data.totalPlays, 1);
  const all = await call('GET', '/api/stats/summary');
  assert.equal(all.data.totalPlays, 2);
});

test('GET /api/recommend 拒绝无效模式', async () => {
  const res = await call('GET', '/api/recommend', { query: 'mode=bogus' });
  assert.equal(res.success, false);
  assert.match(res.error, /无效的推荐模式/);
});

test('GET /api/stats/trends 校验 days 边界', async () => {
  kv.clear();
  const res = await call('GET', '/api/stats/trends', { query: 'days=999' });
  assert.equal(res.success, true);
  assert.equal(res.data.length, 90, 'days 上限 90');
  assert.match(res.data[0].date, /^\d{2}\/\d{2}$/);
});

test('POST /api/recommend/rules 保存并返回 id，删除生效', async () => {
  kv.clear();
  const saved = await call('POST', '/api/recommend/rules', {
    body: { rule: { name: '测试规则', minPlays: 3 } },
  });
  assert.equal(saved.success, true);
  assert.ok(saved.data.id);
  const del = await call('POST', '/api/recommend/rules', { body: { action: 'delete', id: saved.data.id } });
  assert.equal(del.success, true);
  const list = await call('GET', '/api/recommend/rules');
  assert.deepEqual(list.data, []);
});
