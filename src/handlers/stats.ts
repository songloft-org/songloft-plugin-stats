import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router } from '@songloft/plugin-sdk';
import { loadHistory, clearHistory } from '../stats/store';
import { computeSummary, filterByDays } from '../stats/aggregator';

export function registerStatsHandlers(router: Router): void {
  router.get('/api/stats/summary', async (req) => {
    const q = parseQuery(req.query);
    const days = parseInt(String(q.days || '0'), 10);
    const history = await loadHistory();
    const filtered = days > 0 ? filterByDays(history, days) : history;
    return jsonResponse({ success: true, data: computeSummary(filtered) });
  });

  router.get('/api/history', async (req) => {
    const q = parseQuery(req.query);
    const limit = Math.min(100, Math.max(1, parseInt(String(q.limit || '30'), 10) || 30));
    const offset = Math.max(0, parseInt(String(q.offset || '0'), 10) || 0);

    const history = await loadHistory();
    const reversed = history.slice().reverse();
    const page = reversed.slice(offset, offset + limit);

    return jsonResponse({
      success: true,
      data: { total: history.length, records: page },
    });
  });

  router.delete('/api/history', async () => {
    await clearHistory();
    return jsonResponse({ success: true });
  });
}
