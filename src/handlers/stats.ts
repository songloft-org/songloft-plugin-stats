import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router } from '@songloft/plugin-sdk';
import { loadHistory } from '../stats/store';
import { computeSummary, filterByDays } from '../stats/aggregator';

const MAX_DAYS = 365;
const MAX_LIMIT = 100;

export function registerStatsHandlers(router: Router): void {
  router.get('/api/stats/summary', async (req) => {
    const q = parseQuery(req.query);
    const rawDays = parseInt(String(q.days || '0'), 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(0, rawDays), MAX_DAYS) : 0;
    const history = await loadHistory();
    const filtered = days > 0 ? filterByDays(history, days) : history;
    return jsonResponse({ success: true, data: computeSummary(filtered) });
  });

  router.get('/api/history', async (req) => {
    const q = parseQuery(req.query);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(q.limit || '30'), 10) || 30));
    const offset = Math.max(0, parseInt(String(q.offset || '0'), 10) || 0);

    const history = await loadHistory();
    const reversed = history.slice().reverse();
    const page = reversed.slice(offset, offset + limit);

    return jsonResponse({
      success: true,
      data: { total: history.length, records: page },
    });
  });
}
