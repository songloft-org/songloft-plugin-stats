import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { loadHistory, getSummary, getDedupIndex, resetHistory, importRecords, exportHistory, getMaxHistory, setMaxHistory, getRecordCount } from '../stats/store';
import { computeSummary, computeTrends, computeHourlyDistribution } from '../stats/aggregator';
import type { TimeRange } from '../stats/types';

const MAX_LIMIT = 100;

/** 解析请求体（兼容 Uint8Array 和 string） */
function parseBody(req: HTTPRequest): any {
  if (!req.body) return {};
  try {
    const str = typeof req.body === 'string'
      ? req.body
      : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array));
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function parseTimeQuery(q: Record<string, unknown>): TimeRange | undefined {
  const fromStr = q.from !== undefined && q.from !== null ? String(q.from) : '';
  const toStr = q.to !== undefined && q.to !== null ? String(q.to) : '';
  const from = fromStr ? parseInt(fromStr, 10) : undefined;
  const to = toStr ? parseInt(toStr, 10) : undefined;
  if (from === undefined && to === undefined) return undefined;

  const range: TimeRange = {};
  if (from !== undefined && !isNaN(from)) range.from = from;
  if (to !== undefined && !isNaN(to)) range.to = to;
  return range;
}

export function registerStatsHandlers(router: Router): void {
  router.get('/api/stats/summary', async (req) => {
    const range = parseTimeQuery(parseQuery(req.query));
    if (range) {
      // 时间范围查询：不缓存，直接计算
      const history = await loadHistory();
      return jsonResponse({ success: true, data: computeSummary(history, range) });
    }
    return jsonResponse({ success: true, data: await getSummary() });
  });

  router.get('/api/history', async (req) => {
    const q = parseQuery(req.query);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(q.limit || '30'), 10) || 30));
    const offset = Math.max(0, parseInt(String(q.offset || '0'), 10) || 0);

    const history = await loadHistory();
    const index = getDedupIndex();
    // 从去重索引中取最近 N 个不同 songId，按 timestamp 从晚到早
    const uniqueIds = [...index.entries()]
      .map(([songId, pos]) => ({ songId, pos, ts: history[pos].timestamp }))
      .sort((a, b) => b.ts - a.ts)
      .slice(offset, offset + limit);

    const records = uniqueIds.map(({ pos }) => history[pos]);

    return jsonResponse({
      success: true,
      data: { total: history.length, records },
    });
  });

  router.get('/api/history/raw', async (req) => {
    const q = parseQuery(req.query);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(q.limit || '20'), 10) || 20));
    const offset = Math.max(0, parseInt(String(q.offset || '0'), 10) || 0);

    const history = await loadHistory();
    // 从后往前取原始记录（不去重），支持翻页
    const start = Math.max(0, history.length - offset - limit);
    const end = history.length - offset;
    const records = history.slice(start, end).reverse();

    return jsonResponse({
      success: true,
      data: { total: history.length, records, hasMore: start > 0 },
    });
  });

  router.get('/api/stats/trends', async (req) => {
    const q = parseQuery(req.query);
    const days = Math.min(90, Math.max(1, parseInt(String(q.days || '7'), 10) || 7));
    const history = await loadHistory();
    return jsonResponse({ success: true, data: computeTrends(history, days) });
  });

  router.get('/api/stats/hourly', async () => {
    const history = await loadHistory();
    return jsonResponse({ success: true, data: computeHourlyDistribution(history) });
  });

  // ── 数据导出/导入/重置 ──────────────────────────────────────────────────────

  router.get('/api/export', async () => {
    const history = await exportHistory();
    const json = JSON.stringify({ version: 1, exportedAt: Date.now(), records: history }, null, 2);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="songloft-stats-export.json"',
      },
      body: json,
    };
  });

  router.post('/api/import', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const records = input.records || input;
      const added = await importRecords(Array.isArray(records) ? records : []);
      songloft.log.info(`[导入] 新增 ${added} 条记录`);
      return jsonResponse({ success: true, data: { added, total: (await loadHistory()).length } });
    } catch (e) {
      return jsonResponse({ success: false, error: 'JSON 解析失败: ' + String(e) });
    }
  });

  router.post('/api/reset', async () => {
    await resetHistory();
    songloft.log.info('[重置] 播放历史已清空');
    return jsonResponse({ success: true });
  });

  // ── 设置 ────────────────────────────────────────────────────────────────────

  router.get('/api/settings', async () => {
    const [maxHistory, count] = await Promise.all([getMaxHistory(), getRecordCount()]);
    return jsonResponse({ success: true, data: { maxHistory, recordCount: count } });
  });

  router.post('/api/settings', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      if (typeof input.maxHistory === 'number') {
        await setMaxHistory(input.maxHistory);
        songloft.log.info(`[设置] 历史上限更新为 ${input.maxHistory}`);
        return jsonResponse({ success: true, data: { maxHistory: await getMaxHistory() } });
      }
      return jsonResponse({ success: false, error: '无效的 maxHistory 参数' });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });
}
