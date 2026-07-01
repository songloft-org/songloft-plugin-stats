/// <reference types="@songloft/plugin-sdk" />
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, PlayEvent } from '@songloft/plugin-sdk';
import { registerStatsHandlers } from './handlers/stats';
import { appendRecord, drainWrites, getRecordCount, getSongMeta } from './stats/store';

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
}

async function onDeinit(): Promise<void> {
  songloft.events.offPlayEvent();
  await drainWrites();
  songloft.log.info('播放统计插件已停止');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
