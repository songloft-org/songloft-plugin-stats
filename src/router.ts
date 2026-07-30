/// <reference types="@songloft/plugin-sdk" />
import { createRouter, jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { loadHistory, getSummary, getDedupIndex, resetHistory, importRecords, exportHistory, getMaxHistory, setMaxHistory, getRecordCount } from './store';
import { computeSummary, computeTrends, computeHourlyDistribution } from './aggregator';
import type { TimeRange } from './types';
import { loadPushConfig, savePushConfig, loadPushSchedule, savePushSchedule } from './push/config';
import { getBackupDavConfigs, saveBackupDavConfigs, getBackupDavConfig, loadBackupSchedule, saveBackupSchedule, BackupDavConfig } from './backup/config';
import { testConnection, listDirectory, uploadBackup, downloadBackup } from './webdav';
import { doPush, scheduleNextPush, scheduleNextBackup, loadRecommendSchedule, saveRecommendSchedule, scheduleNextRecommendRefresh, doRecommendRefresh, scheduleNextAiReport } from './scheduler';
import type { PushResult, RecommendSchedule } from './scheduler';
import { generateRecommend, materializePlaylist, MODE_INFO, ALL_MODES } from './recommend/playlists';
import type { RecommendMode } from './recommend/playlists';
import { loadRules, upsertRule, deleteRule, generateRuleItems, materializeRule, getLibraryFacets } from './recommend/rules';
import { getTagStatus, triggerTagScrape, getTagScrapeProgress } from './recommend/linkage';
import { loadAiConfig, saveAiConfig, isAiConfigured, testAiConnection } from './ai/client';
import { nlToRule } from './ai/nlplaylist';
import { generateAiReport, pushAiReport, loadAiReportSchedule, saveAiReportSchedule } from './ai/report';
import type { ReportPeriod, AiReportSchedule } from './ai/report';
import { countMissingTags, startAiTagging, getAiTagProgress } from './ai/tagger';
import { loadSkipCounts } from './store';

const MAX_LIMIT = 100;

/** 手动触发推送（测试推送）*/
async function triggerPush(platform: string, isTest: boolean): Promise<PushResult> {
  return await doPush(platform, isTest, isTest);
}

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

function registerStatsHandlers(router: Router): void {
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

  // ── 推送设置 ────────────────────────────────────────────────────────────────

  router.get('/api/push/config', async () => {
    const [config, schedule] = await Promise.all([loadPushConfig(), loadPushSchedule()]);
    return jsonResponse({ success: true, data: { config, schedule } });
  });

  router.post('/api/push/config', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);

      if (input.config) {
        // 新格式：per-platform config { feishu: { token, enabled }, wxpusher: { token, enabled } }
        // 旧格式：{ platform, token, enabled }
        if (input.config.feishu !== undefined) {
          // 合并现有配置，避免覆盖其他平台
          const existing = await loadPushConfig();
          const merged = {
            feishu: { ...existing.feishu, ...(input.config.feishu || {}) },
            wxpusher: { ...existing.wxpusher, ...(input.config.wxpusher || {}) },
          };
          await savePushConfig(merged);
        } else {
          // 兼容旧格式，转换为新格式
          const platform = input.config.platform === 'feishu' || input.config.platform === 'wxpusher' ? input.config.platform : 'feishu';
          const newConfig = {
            feishu: { token: '', enabled: false },
            wxpusher: { token: '', enabled: false },
          };
          newConfig[platform as keyof typeof newConfig] = {
            token: input.config.token || '',
            enabled: !!input.config.enabled,
          };
          await savePushConfig(newConfig);
          songloft.log.info(`[推送配置] 平台=${platform}, 启用=${input.config.enabled}`);
        }
      }

      if (input.schedule) {
        if (typeof input.schedule.hour !== 'number' || input.schedule.hour < 0 || input.schedule.hour > 23) {
          return jsonResponse({ success: false, error: 'Invalid hour, must be 0-23' });
        }
        if (typeof input.schedule.minute !== 'number' || input.schedule.minute < 0 || input.schedule.minute > 59) {
          return jsonResponse({ success: false, error: 'Invalid minute, must be 0-59' });
        }
        await savePushSchedule(input.schedule);
        songloft.log.info(`[推送调度] 启用=${input.schedule.enabled}, 时间=${String(input.schedule.hour).padStart(2,'0')}:${String(input.schedule.minute).padStart(2,'0')}`);
        // 调度更新后立即重新计算下次推送时间
        scheduleNextPush();
      }

      const [config, schedule] = await Promise.all([loadPushConfig(), loadPushSchedule()]);
      return jsonResponse({ success: true, data: { config, schedule } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 手动触发推送 ────────────────────────────────────────────────────────────

  router.post('/api/push/test', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const platform = input.platform || 'feishu';
      const result = await triggerPush(platform, true);
      if (result.ok) {
        return jsonResponse({ success: true, message: '推送测试已发送' });
      }
      return jsonResponse({ success: false, error: result.reason || '推送失败' });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 备份设置 ────────────────────────────────────────────────────────────────

  router.get('/api/backup/webdav/config', async () => {
    const configs = await getBackupDavConfigs();
    return jsonResponse({ success: true, data: configs });
  });

  router.post('/api/backup/webdav/config', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const configs = await getBackupDavConfigs();

      if (input.action === 'add' || input.action === 'update') {
        const existing = configs.findIndex(c => c.name === input.name);
        if (existing >= 0) {
          configs[existing] = input.config;
        } else {
          configs.push(input.config);
        }
      } else if (input.action === 'delete') {
        const filtered = configs.filter(c => c.name !== input.name);
        await saveBackupDavConfigs(filtered);
        return jsonResponse({ success: true });
      }

      await saveBackupDavConfigs(configs);
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/backup/webdav/test', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const connected = await testConnection(input.config as BackupDavConfig);
      return jsonResponse({ success: true, data: { connected } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.get('/api/backup/webdav/list', async (req: HTTPRequest) => {
    try {
      const q = parseQuery(req.query);
      const configName = q.configName ? String(q.configName) : '';
      const path = q.path ? String(q.path) : '/';

      if (!configName) {
        return jsonResponse({ success: false, error: '缺少 configName' });
      }

      const config = await getBackupDavConfig(configName);
      if (!config) {
        return jsonResponse({ success: false, error: '配置不存在' });
      }

      const items = await listDirectory(config, path);
      // 过滤出备份文件（stats-backup-*.json）
      const backupFiles = items
        .filter(item => item.type === 'file' && item.basename.startsWith('stats-backup-') && item.basename.endsWith('.json'))
        .map(item => ({
          name: item.basename,
          size: item.size,
          lastmod: item.lastmod,
          path: item.filename
        }));

      return jsonResponse({ success: true, data: backupFiles });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/backup/upload', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const configName = input.configName as string;

      if (!configName) {
        return jsonResponse({ success: false, error: '缺少配置名称' });
      }

      const config = await getBackupDavConfig(configName);
      if (!config) {
        return jsonResponse({ success: false, error: '配置不存在' });
      }

      const history = await exportHistory();
      const backupData = {
        version: 1,
        exportedAt: Date.now(),
        records: history
      };
      const jsonContent = JSON.stringify(backupData, null, 2);
      const fileName = `stats-backup-${Date.now()}.json`;

      await uploadBackup(config, fileName, jsonContent);
      songloft.log.info(`[备份] 上传成功: ${fileName}`);

      return jsonResponse({ success: true, data: { fileName } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/backup/download', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const configName = input.configName as string;
      const fileName = input.fileName as string;

      if (!configName || !fileName) {
        return jsonResponse({ success: false, error: '缺少必要参数' });
      }

      const config = await getBackupDavConfig(configName);
      if (!config) {
        return jsonResponse({ success: false, error: '配置不存在' });
      }

      const content = await downloadBackup(config, fileName);
      const backupData = JSON.parse(content);

      return jsonResponse({ success: true, data: backupData });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 定时备份 ────────────────────────────────────────────────────────────────

  router.get('/api/backup/schedule', async () => {
    const schedule = await loadBackupSchedule();
    return jsonResponse({ success: true, data: schedule });
  });

  router.post('/api/backup/schedule', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      if (input.action === 'save') {
        await saveBackupSchedule(input.schedule);
        // 重新调度
        scheduleNextBackup();
      }
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });
  // ── 智能推荐 ──────────────────────────────────────────────────────────────────

  router.get('/api/recommend/modes', async () => {
    const skips = await loadSkipCounts();
    let totalSkips = 0;
    for (const v of skips.values()) totalSkips += v;
    return jsonResponse({
      success: true,
      data: {
        modes: ALL_MODES.map((mode) => ({ mode, ...MODE_INFO[mode] })),
        totalSkips,
      },
    });
  });

  router.get('/api/recommend', async (req) => {
    try {
      const q = parseQuery(req.query);
      const mode = String(q.mode || 'shuffle') as RecommendMode;
      if (!ALL_MODES.includes(mode)) {
        return jsonResponse({ success: false, error: '无效的推荐模式: ' + mode });
      }
      const limit = parseInt(String(q.limit || '30'), 10) || 30;
      const items = await generateRecommend(mode, limit);
      return jsonResponse({ success: true, data: { mode, items } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/recommend/apply', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const mode = String(input.mode || 'shuffle') as RecommendMode;
      if (!ALL_MODES.includes(mode)) {
        return jsonResponse({ success: false, error: '无效的推荐模式: ' + mode });
      }
      const limit = typeof input.limit === 'number' ? input.limit : 30;
      const result = await materializePlaylist(mode, limit);
      return jsonResponse({ success: true, data: result });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 规则歌单 ────────────────────────────────────────────────────────────────

  router.get('/api/recommend/facets', async () => {
    try {
      return jsonResponse({ success: true, data: await getLibraryFacets() });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.get('/api/recommend/rules', async () => {
    return jsonResponse({ success: true, data: await loadRules() });
  });

  router.post('/api/recommend/rules', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      if (input.action === 'delete') {
        await deleteRule(String(input.id || ''));
        return jsonResponse({ success: true });
      }
      const rule = await upsertRule(input.rule || {});
      return jsonResponse({ success: true, data: rule });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.get('/api/recommend/rules/preview', async (req) => {
    try {
      const q = parseQuery(req.query);
      const id = String(q.id || '');
      const rules = await loadRules();
      const rule = rules.find((r) => r.id === id);
      if (!rule) return jsonResponse({ success: false, error: '规则不存在' });
      const items = await generateRuleItems(rule);
      return jsonResponse({ success: true, data: { rule, items } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/recommend/rules/apply', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const result = await materializeRule(String(input.id || ''));
      return jsonResponse({ success: true, data: result });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 推荐定时刷新 ──────────────────────────────────────────────────────────

  router.get('/api/recommend/schedule', async () => {
    return jsonResponse({ success: true, data: await loadRecommendSchedule() });
  });

  router.post('/api/recommend/schedule', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      if (typeof input.hour !== 'number' || input.hour < 0 || input.hour > 23) {
        return jsonResponse({ success: false, error: 'Invalid hour, must be 0-23' });
      }
      if (typeof input.minute !== 'number' || input.minute < 0 || input.minute > 59) {
        return jsonResponse({ success: false, error: 'Invalid minute, must be 0-59' });
      }
      const modes = Array.isArray(input.modes)
        ? input.modes.filter((m: string) => (ALL_MODES as string[]).includes(m))
        : [];
      const schedule: RecommendSchedule = {
        enabled: !!input.enabled,
        hour: input.hour,
        minute: input.minute,
        modes,
        refreshRules: input.refreshRules !== false,
      };
      await saveRecommendSchedule(schedule);
      scheduleNextRecommendRefresh();
      return jsonResponse({ success: true, data: schedule });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/recommend/refresh', async () => {
    try {
      const result = await doRecommendRefresh();
      return jsonResponse({ success: true, data: result });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── 标签刮削插件联动 ────────────────────────────────────────────────────

  router.get('/api/linkage/tag/status', async () => {
    try {
      return jsonResponse({ success: true, data: await getTagStatus() });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/linkage/tag/scrape', async () => {
    try {
      return jsonResponse({ success: true, data: await triggerTagScrape() });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.get('/api/linkage/tag/progress', async (req) => {
    try {
      const q = parseQuery(req.query);
      const taskId = String(q.taskId || '');
      if (!taskId) return jsonResponse({ success: false, error: '缺少 taskId' });
      return jsonResponse({ success: true, data: await getTagScrapeProgress(taskId) });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // ── AI 功能 ─────────────────────────────────────────────────────────────────

  router.get('/api/ai/config', async () => {
    const [config, configured] = await Promise.all([loadAiConfig(), isAiConfigured()]);
    return jsonResponse({ success: true, data: { config, configured } });
  });

  router.post('/api/ai/config', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      await saveAiConfig({
        baseUrl: String(input.baseUrl || ''),
        apiKey: String(input.apiKey || ''),
        model: String(input.model || ''),
      });
      return jsonResponse({ success: true, data: { configured: await isAiConfigured() } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/ai/test', async () => {
    try {
      const reply = await testAiConnection();
      return jsonResponse({ success: true, data: { reply } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // 自然语言建歌单：解析 + 预览（保存/物化复用现有 rules 接口）
  router.post('/api/ai/nlplaylist', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const result = await nlToRule(String(input.text || ''));
      return jsonResponse({ success: true, data: result });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // AI 听歌报告：生成文案，push=true 时同时推送到已启用渠道
  router.post('/api/ai/report', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      const period: ReportPeriod = input.period === 'month' ? 'month' : 'week';
      const { title, content } = await generateAiReport(period);
      let pushed: string[] = [];
      if (input.push) {
        pushed = await pushAiReport(title, content);
      }
      return jsonResponse({ success: true, data: { title, content, pushed } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // AI 报告定时推送（周报每周一 / 月报每月 1 日）
  router.get('/api/ai/report/schedule', async () => {
    return jsonResponse({ success: true, data: await loadAiReportSchedule() });
  });

  router.post('/api/ai/report/schedule', async (req: HTTPRequest) => {
    try {
      const input = parseBody(req);
      if (typeof input.hour !== 'number' || input.hour < 0 || input.hour > 23) {
        return jsonResponse({ success: false, error: '无效的小时' });
      }
      if (typeof input.minute !== 'number' || input.minute < 0 || input.minute > 59) {
        return jsonResponse({ success: false, error: '无效的分钟' });
      }
      const schedule: AiReportSchedule = {
        enabled: !!input.enabled,
        period: input.period === 'month' ? 'month' : 'week',
        hour: input.hour,
        minute: input.minute,
      };
      await saveAiReportSchedule(schedule);
      scheduleNextAiReport();
      return jsonResponse({ success: true, data: schedule });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  // AI 标签补全
  router.get('/api/ai/tag/status', async () => {
    try {
      const [missing, configured] = await Promise.all([countMissingTags(), isAiConfigured()]);
      return jsonResponse({ success: true, data: { ...missing, configured, progress: getAiTagProgress() } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.post('/api/ai/tag/start', async () => {
    try {
      const total = await startAiTagging();
      return jsonResponse({ success: true, data: { total } });
    } catch (e) {
      return jsonResponse({ success: false, error: String(e) });
    }
  });

  router.get('/api/ai/tag/progress', async () => {
    return jsonResponse({ success: true, data: getAiTagProgress() });
  });
}

const router = createRouter();
registerStatsHandlers(router);

export default router;
