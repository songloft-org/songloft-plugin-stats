/// <reference types="@songloft/plugin-sdk" />
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, PlayEvent } from '@songloft/plugin-sdk';
import { registerStatsHandlers } from './handlers/stats';
import { appendRecord, drainWrites, getRecordCount, getSongMeta, loadHistory } from './stats/store';
import { getSummary } from './stats/store';
import { computeSummary } from './stats/aggregator';
import type { TimeRange } from './stats/types';

const router = createRouter();
registerStatsHandlers(router);

// ── 去重机制：同一首歌至少间隔 duration 50%（最低 10s）才记录 ─────────────────
const MIN_DEDUP_MS = 10_000;
const lastRecorded = new Map<number, { timestamp: number; duration: number }>();

/** 获取歌曲时长（复用 store.ts 的 metaCache）*/
async function getSongDuration(songId: number): Promise<number> {
  const meta = await getSongMeta(songId);
  return meta.duration ?? 0;
}

/** 检查同一首歌在去重窗口内是否已记录过 */
function checkDuplicateWindow(songId: number, prev: { timestamp: number; duration: number }, currentTs: number): boolean {
  const timeDiff = Math.abs(currentTs - prev.timestamp);
  // 动态窗口：取 max(10s, duration * 50%)
  const windowMs = prev.duration > 0
    ? Math.max(MIN_DEDUP_MS, prev.duration * 500)
    : MIN_DEDUP_MS;
  if (timeDiff < windowMs) {
    songloft.log.info(`[去重] songId=${songId} 间隔${timeDiff}ms < 窗口${windowMs}ms`);
    return true;
  }
  return false;
}

/** 清理过期的去重记录，防止内存泄漏 */
function cleanupStaleDedup(): void {
  if (lastRecorded.size <= 200) return;
  const cutoff = Date.now() - MIN_DEDUP_MS * 2;
  for (const [id, v] of lastRecorded) {
    if (v.timestamp < cutoff) lastRecorded.delete(id);
  }
}

/** 判断是否为重复播放（同一首歌间隔太近）*/
async function isDuplicate(songId: number, timestamp: number): Promise<boolean> {
  const prev = lastRecorded.get(songId);
  if (prev !== undefined && checkDuplicateWindow(songId, prev, timestamp)) {
    return true;
  }
  const duration = await getSongDuration(songId);
  lastRecorded.set(songId, { timestamp, duration });
  cleanupStaleDedup();
  return false;
}

// ── 推送配置 ──────────────────────────────────────────────────────────────────
import { loadPushConfig, loadPushSchedule } from './push/config';
import type { PushConfig, PushSchedule } from './push/config';

// ── 推送平台消息构造 ──────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0分钟';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  if (m > 0) return `${m}分钟`;
  return `${sec}秒`;
}

/** HTML 转义，防止 XSS */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildPushContent(summary: any): { title: string; content: string } {
  const topArtists = (summary.topArtists || []).slice(0, 3);
  const topSongs = (summary.topSongs || []).slice(0, 3);
  const lines: string[] = [];
  lines.push(`🎵 播放次数: ${summary.totalPlays}`);
  lines.push(`⏱ 听歌时长: ${formatDuration(summary.totalDurationSec)}`);
  lines.push(`🎶 不同歌曲: ${summary.uniqueSongs}`);
  lines.push(`🎤 不同歌手: ${summary.uniqueArtists}`);
  if (topArtists.length > 0) {
    lines.push('🏆 最爱歌手: ' + topArtists.map((a: any) => `${a.artist}(${a.plays})`).join(', '));
  }
  if (topSongs.length > 0) {
    lines.push('🎸 最爱歌曲: ' + topSongs.map((s: any) => `${s.title} - ${s.artist}`).join(', '));
  }
  return {
    title: '📊 昨日听歌报告',
    content: lines.join('\n'),
  };
}

// ── 飞书推送实现 ────────────────────────────────────────────────────────────

async function pushToFeishu(token: string, title: string, content: string): Promise<void> {
  let url = token;
  if (!token.startsWith('http')) {
    url = `https://open.feishu.cn/open-apis/bot/v2/hook/${encodeURIComponent(token)}`;
  }
  const body = JSON.stringify({
    msg_type: 'text',
    content: { text: `${title}\n\n${content}` },
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── WxPusher 极简推送实现 ────────────────────────────────────────────────────

async function pushToWxPusher(spt: string, title: string, content: string): Promise<void> {
  const spts = spt.split(',').map((s) => s.trim()).filter(Boolean);
  if (spts.length === 0) throw new Error('SPT 不能为空');
  if (spts.length > 10) throw new Error('SPT 最多支持 10 个');

  const json: Record<string, any> = {
    content: `<h1>${escapeHtml(title)}</h1><br/><div style='white-space: pre-wrap;'>${escapeHtml(content).replace(/\n/g, '<br/>')}</div>`,
    summary: escapeHtml(title),
    contentType: 2,
  };
  if (spts.length === 1) {
    json.spt = spts[0];
  } else {
    json.sptList = spts;
  }

  const res = await fetch('https://wxpusher.zjiecode.com/api/send/message/simple-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const PLATFORM_PUSHERS: Record<string, (token: string, title: string, content: string) => Promise<void>> = {
  feishu: pushToFeishu,
  wxpusher: pushToWxPusher,
};

// ── 推送执行 ──────────────────────────────────────────────────────────────────

let pushTimerId: number | null = null;

async function doPush(platform: string, isManual?: boolean): Promise<void> {
  const config = await loadPushConfig();
  const pc = config[platform as keyof typeof config];
  if (!pc?.enabled || !pc.token) {
    if (isManual) songloft.log.info(`[推送] ${platform}: 未启用或 token 为空，跳过`);
    return;
  }

  try {
    // 计算昨日时间范围：昨日 0:00:00 ~ 今日 0:00:00
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const timeRange: TimeRange = {
      from: yesterdayStart.getTime(),
      to: todayStart.getTime()
    };

    const history = await loadHistory();
    const summary = computeSummary(history, timeRange);

    // 如果昨日没有数据，就跳过推送
    if (summary.totalPlays === 0) {
      songloft.log.info(`[推送] 昨日无播放记录，跳过 ${platform} 推送`);
      return;
    }

    const { title, content } = buildPushContent(summary);
    const pusher = PLATFORM_PUSHERS[platform];
    if (!pusher) {
      songloft.log.error(`[推送] 不支持的平台: ${platform}`);
      return;
    }
    await pusher(pc.token, title, content);
    songloft.log.info(`[推送] 成功 (${platform}): ${title}`);
    if (isManual) {
      songloft.log.info(`[推送] ${platform} 测试推送成功`);
    }
  } catch (e) {
    songloft.log.error(`[推送] ${platform} 失败: ${String(e)}`);
  }
}

// ── 定时器调度 ────────────────────────────────────────────────────────────────

function scheduleNextPush(): void {
  // 清除旧的定时器
  if (pushTimerId !== null) {
    clearTimeout(pushTimerId);
    pushTimerId = null;
  }

  // 从持久化存储读取调度配置
  loadPushSchedule()
    .then((schedule: PushSchedule) => {
    if (!schedule || !schedule.enabled) return;

    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setHours(schedule.hour, schedule.minute, 0, 0);
    let nextFire = todayStart.getTime();

    // 如果今天的推送时间已过，设为明天
    if (nextFire <= now) {
      nextFire += 86400000; // +1 day
    }

    const delay = nextFire - now;
    songloft.log.info(`[推送调度] 下次推送: ${new Date(nextFire).toLocaleString('zh-CN')} (延迟 ${Math.round(delay / 60000)} 分钟)`);

    pushTimerId = setTimeout(async () => {
      // 推送所有已启用的平台
      const config = await loadPushConfig(persistentStorage);
      const platforms: (keyof PushConfig)[] = ['feishu', 'wxpusher'];
      for (const platform of platforms) {
        if (config[platform]?.enabled && config[platform]?.token) {
          await doPush(platform);
        }
      }
      // 推送完成后调度下一次
      scheduleNextPush();
    }, delay);
    })
    .catch((err: unknown) => {
      songloft.log.error(`[推送调度] 加载调度配置失败: ${String(err)}`);
      // 延迟5分钟后重试，保证服务可恢复
      setTimeout(() => scheduleNextPush(), 5 * 60 * 1000);
    });
}

// 暴露给 handler 使用
(globalThis as any).__songloftDoPush = doPush;
(globalThis as any).__songloftScheduleNextPush = scheduleNextPush;

// ── 里程碑检测 ─────────────────────────────────────────────────────────────────
const MILESTONE_COUNTS = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const milestoneReached = new Set<number>();

async function checkMilestones(): Promise<void> {
  try {
    const count = await getRecordCount();
    for (const m of MILESTONE_COUNTS) {
      if (count >= m && !milestoneReached.has(m)) {
        milestoneReached.add(m);
        songloft.log.info(`🎉 [里程碑] 播放次数达到 ${m}！`);
      }
    }
  } catch {
    // 里程碑检测失败不影响主流程
  }
}

function subscribePlayEvents(): void {
  songloft.events.onPlayEvent(async (event: PlayEvent) => {
    songloft.log.info(
      `[PlayEvent] type=${event.type} source=${event.source} songId=${event.song.id} ${event.song.artist} - ${event.song.title}`,
    );
    
    // 只记录 finish 事件（播放完成），跳过 play 和 skip 事件
    if (event.type !== 'finish') {
      return;
    }
    
    // 同一首歌至少间隔 duration 50% 才算有效播放
    if (await isDuplicate(event.song.id, event.timestamp)) {
      return;
    }
    try {
      await appendRecord(event);
      songloft.log.info(
        `[已记录] type=${event.type} source=${event.source} ${event.song.artist} - ${event.song.title}`,
      );
      checkMilestones();
    } catch (e) {
      songloft.log.error('记录播放失败: ' + String(e));
    }
  });
  songloft.log.info('[PlayEvent] 播放事件订阅已注册');
}

async function onInit(): Promise<void> {
  songloft.log.info('播放统计插件已启动');
  subscribePlayEvents();
  // 启动定时推送调度
  scheduleNextPush();
}

async function onDeinit(): Promise<void> {
  songloft.events.offPlayEvent();
  await drainWrites();
  // 清理推送定时器
  if (pushTimerId !== null) {
    clearTimeout(pushTimerId);
    pushTimerId = null;
  }
  songloft.log.info('播放统计插件已停止');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
