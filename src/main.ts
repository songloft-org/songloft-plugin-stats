/// <reference types="@songloft/plugin-sdk" />
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, PlayEvent } from '@songloft/plugin-sdk';
import { registerStatsHandlers } from './handlers/stats';
import { appendRecord, drainWrites } from './stats/store';

const router = createRouter();
registerStatsHandlers(router);

// ── 去重机制：同一首歌在短时间内（10s）不重复记录 ──────────────────────────────
const DEDUP_WINDOW_MS = 10_000;
const lastRecorded = new Map<number, number>(); // songId -> timestamp

function isDuplicate(songId: number, timestamp: number): boolean {
  const prev = lastRecorded.get(songId);
  if (prev !== undefined && timestamp - prev < DEDUP_WINDOW_MS) {
    return true;
  }
  lastRecorded.set(songId, timestamp);
  // 清理过期条目，防止内存泄漏
  if (lastRecorded.size > 200) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS * 2;
    for (const [id, ts] of lastRecorded) {
      if (ts < cutoff) lastRecorded.delete(id);
    }
  }
  return false;
}

function subscribePlayEvents(): void {
  songloft.events.onPlayEvent(async (event: PlayEvent) => {
    // 详细日志：记录所有事件的完整信息
    songloft.log.info(
      `[PlayEvent] type=${event.type} source=${event.source} songId=${event.song.id} ${event.song.artist} - ${event.song.title} timestamp=${event.timestamp}`,
    );
    
    // 只记录 finish 事件（播放完成），跳过 play 和 skip 事件
    // 这样可以避免用户只是点击预览就被记录，确保统计的是真正听完的歌曲
    if (event.type !== 'finish') {
      songloft.log.info(`[跳过] 非 finish 事件不记录: type=${event.type} ${event.song.artist} - ${event.song.title}`);
      return;
    }
    
    // finish 事件将通过去重检查
    songloft.log.info(`[允许] type=finish 将通过去重检查`);
    // 同一首歌 10s 内不重复记录（防止同一客户端同时发 play+finish）
    if (isDuplicate(event.song.id, event.timestamp)) {
      songloft.log.info(`[去重] ${event.song.artist} - ${event.song.title}`);
      return;
    }
    try {
      await appendRecord(event);
      songloft.log.info(
        `[已记录] type=${event.type} source=${event.source} ${event.song.artist} - ${event.song.title}`,
      );
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
