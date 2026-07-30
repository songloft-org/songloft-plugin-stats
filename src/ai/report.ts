/// <reference types="@songloft/plugin-sdk" />
// AI 听歌报告：把统计摘要交给 LLM 生成个性化文案，可选推送到已启用渠道
import { chatComplete } from './client';
import { loadHistory } from '../store';
import { computeSummary, computeHourlyDistribution } from '../aggregator';
import { formatDuration, PLATFORM_PUSHERS } from '../pusher';
import { loadPushConfig } from '../push/config';
import type { PushConfig } from '../push/config';
import type { TimeRange } from '../types';

export type ReportPeriod = 'week' | 'month';

const PERIOD_INFO: Record<ReportPeriod, { days: number; label: string }> = {
  week: { days: 7, label: '最近 7 天' },
  month: { days: 30, label: '最近 30 天' },
};

/** 生成 AI 听歌报告文案 */
export async function generateAiReport(period: ReportPeriod): Promise<{ title: string; content: string }> {
  const info = PERIOD_INFO[period] || PERIOD_INFO.week;
  const now = Date.now();
  const range: TimeRange = { from: now - info.days * 24 * 60 * 60 * 1000, to: now };

  const history = await loadHistory();
  const inRange = history.filter((r) => r.timestamp >= range.from! && r.timestamp < range.to!);
  if (inRange.length === 0) {
    throw new Error(`${info.label}没有播放记录，无法生成报告`);
  }
  const summary = computeSummary(history, range);
  const hourly = computeHourlyDistribution(inRange);

  // 组织事实素材，LLM 只负责写作，不允许编造数据
  const facts = [
    `统计周期：${info.label}`,
    `播放次数：${summary.totalPlays}，听歌时长：${formatDuration(summary.totalDurationSec)}`,
    `听过 ${summary.uniqueSongs} 首不同的歌，${summary.uniqueArtists} 位歌手`,
    `最常听的歌手：${summary.topArtists.slice(0, 5).map((a) => `${a.artist}（${a.plays}次）`).join('、') || '无'}`,
    `最常听的歌：${summary.topSongs.slice(0, 5).map((s) => `《${s.title}》- ${s.artist}（${s.plays}次）`).join('、') || '无'}`,
    `最常听的专辑：${summary.topAlbums.slice(0, 3).map((a) => `《${a.album}》（${a.plays}次）`).join('、') || '无'}`,
    `时段分布：${hourly.map((h) => `${h.label} ${h.count} 次`).join('，')}`,
  ].join('\n');

  const content = await chatComplete(
    [
      {
        role: 'system',
        content:
          '你是音乐 App 的听歌报告写手。根据用户的听歌数据写一份简短有趣的中文报告：' +
          '开头一句总结，中间点评听歌口味和习惯（可以适度幽默、玩梗），结尾给一句听歌建议。' +
          '只能使用提供的数据，严禁编造数字或歌名。纯文本输出（可用 emoji），不要 markdown 标题，全文 200 字以内。',
      },
      { role: 'user', content: facts },
    ],
    { temperature: 0.9 }
  );

  const title = period === 'month' ? '🤖 AI 月度听歌报告' : '🤖 AI 周听歌报告';
  return { title, content };
}

/** 推送报告到所有已启用的渠道，返回成功的平台列表 */
export async function pushAiReport(title: string, content: string): Promise<string[]> {
  const pushConfig = await loadPushConfig();
  const platforms: (keyof PushConfig)[] = ['feishu', 'wxpusher'];
  const pushed: string[] = [];
  for (const platform of platforms) {
    if (pushConfig[platform]?.enabled && pushConfig[platform]?.token) {
      const pusher = PLATFORM_PUSHERS[platform];
      if (!pusher) continue;
      try {
        await pusher(pushConfig[platform].token, title, content);
        pushed.push(platform);
      } catch (e) {
        songloft.log.error(`[AI报告] 推送失败 (${platform}): ${String(e)}`);
      }
    }
  }
  return pushed;
}

// ── 定时推送配置 ──────────────────────────────────────────────────────────────

const AI_REPORT_SCHEDULE_KEY = 'ai_report_schedule';

/** 周报每周一推送，月报每月 1 日推送 */
export interface AiReportSchedule {
  enabled: boolean;
  period: ReportPeriod;
  hour: number;
  minute: number;
}

const DEFAULT_AI_REPORT_SCHEDULE: AiReportSchedule = {
  enabled: false,
  period: 'week',
  hour: 9,
  minute: 0,
};

export async function loadAiReportSchedule(): Promise<AiReportSchedule> {
  try {
    const raw = await songloft.storage.get(AI_REPORT_SCHEDULE_KEY);
    if (raw == null) return { ...DEFAULT_AI_REPORT_SCHEDULE };
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') return { ...DEFAULT_AI_REPORT_SCHEDULE };
    return {
      enabled: !!data.enabled,
      period: data.period === 'month' ? 'month' : 'week',
      hour: typeof data.hour === 'number' && data.hour >= 0 && data.hour <= 23 ? data.hour : 9,
      minute: typeof data.minute === 'number' && data.minute >= 0 && data.minute <= 59 ? data.minute : 0,
    };
  } catch {
    return { ...DEFAULT_AI_REPORT_SCHEDULE };
  }
}

export async function saveAiReportSchedule(schedule: AiReportSchedule): Promise<void> {
  await songloft.storage.set(AI_REPORT_SCHEDULE_KEY, schedule);
}
