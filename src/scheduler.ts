/// <reference types="@songloft/plugin-sdk" />
import type { PlayEvent } from '@songloft/plugin-sdk';
import { loadHistory, getRecordCount, exportHistory, appendRecord } from './store';
import { computeSummary } from './aggregator';
import type { TimeRange } from './types';
import { loadPushConfig, loadPushSchedule, savePushSchedule } from './push/config';
import type { PushConfig, PushSchedule } from './push/config';
import { getBackupDavConfig, loadBackupSchedule, saveBackupSchedule, BackupSchedule } from './backup/config';
import { uploadBackup } from './webdav';
import { PLATFORM_PUSHERS, buildPushContent, buildTestPushContent, buildBackupPushContent } from './pusher';

// ── 去重机制：同一首歌至少间隔 duration 50%（最低 10s）才记录 ─────────────────
const MIN_DEDUP_MS = 10_000;
const lastRecorded = new Map<number, { timestamp: number; duration: number }>();

/** 获取歌曲时长（复用 store.ts 的 metaCache）*/
async function getSongDuration(songId: number): Promise<number> {
  const { getSongMeta } = await import('./store');
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

// ── 推送执行 ──────────────────────────────────────────────────────────────────

let pushTimerId: number | null = null;

export interface PushResult {
  ok: boolean;
  reason?: string;
}

async function doPush(platform: string, isManual?: boolean, isTest?: boolean): Promise<PushResult> {
  const config = await loadPushConfig();
  const pc = config[platform as keyof typeof config];
  if (!pc?.enabled || !pc.token) {
    const reason = `${platform}: 未启用或 token 为空`;
    songloft.log.info(`[推送] ${reason}，跳过`);
    return { ok: false, reason };
  }

  try {
    let title: string;
    let body: string;

    if (isTest) {
      // 测试推送：仅验证 webhook 连通性，不依赖播放记录
      const c = buildTestPushContent();
      title = c.title;
      body = c.content;
    } else {
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
        return { ok: false, reason: '昨日无播放记录' };
      }

      const c = buildPushContent(summary);
      title = c.title;
      body = c.content;
    }

    const pusher = PLATFORM_PUSHERS[platform];
    if (!pusher) {
      songloft.log.error(`[推送] 不支持的平台: ${platform}`);
      return { ok: false, reason: '不支持的平台' };
    }
    await pusher(pc.token, title, body);
    songloft.log.info(`[推送] 成功 (${platform}): ${title}`);
    if (isManual) {
      songloft.log.info(`[推送] ${platform} 测试推送成功`);
    }
    return { ok: true };
  } catch (e) {
    songloft.log.error(`[推送] ${platform} 失败: ${String(e)}`);
    return { ok: false, reason: String(e) };
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
      const config = await loadPushConfig();
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

// ── 备份执行 ──────────────────────────────────────────────────────────────────

let backupTimerId: number | null = null;
let backupInProgress = false;

async function doBackup(): Promise<void> {
  if (backupInProgress) {
    songloft.log.warn('[备份] 上一次备份尚未完成，跳过本次调度');
    return;
  }

  const schedule = await loadBackupSchedule();
  if (!schedule.enabled || !schedule.configName) {
    songloft.log.info('[备份] 定时备份未启用或配置不存在，跳过');
    return;
  }

  const config = await getBackupDavConfig(schedule.configName);
  if (!config) {
    songloft.log.error(`[备份] 配置 "${schedule.configName}" 不存在`);
    // 禁用该配置
    await saveBackupSchedule({ ...schedule, configName: '' });
    return;
  }

  backupInProgress = true;
  songloft.log.info(`[备份] 开始定时备份 (配置: ${schedule.configName})`);

  try {
    const history = await exportHistory();
    const recordCount = history.length;
    const backupData = {
      version: 1,
      exportedAt: Date.now(),
      records: history
    };
    const jsonContent = JSON.stringify(backupData, null, 2);
    const fileName = `stats-backup-${Date.now()}.json`;

    await uploadBackup(config, fileName, jsonContent);
    songloft.log.info(`[备份] 上传成功: ${fileName}`);

    // 备份成功，推送通知
    const { title, content } = buildBackupPushContent(true, fileName, recordCount);
    await notifyBackupResult(title, content);
  } catch (e) {
    songloft.log.error(`[备份] 失败: ${String(e)}`);
    const { title, content } = buildBackupPushContent(false, undefined, undefined, String(e));
    await notifyBackupResult(title, content);
  } finally {
    backupInProgress = false;
  }
}

/** 备份结果推送到所有已启用的平台 */
async function notifyBackupResult(title: string, content: string): Promise<void> {
  const pushConfig = await loadPushConfig();
  const platforms: (keyof PushConfig)[] = ['feishu', 'wxpusher'];
  for (const platform of platforms) {
    if (pushConfig[platform]?.enabled && pushConfig[platform]?.token) {
      const pusher = PLATFORM_PUSHERS[platform];
      if (pusher) {
        try {
          await pusher(pushConfig[platform].token, title, content);
        } catch (e) {
          songloft.log.error(`[备份] 推送通知失败 (${platform}): ${String(e)}`);
        }
      }
    }
  }
}

function scheduleNextBackup(): void {
  if (backupTimerId !== null) {
    clearTimeout(backupTimerId);
    backupTimerId = null;
  }

  loadBackupSchedule()
    .then((schedule: BackupSchedule) => {
      if (!schedule || !schedule.enabled || !schedule.configName) return;

      const now = Date.now();
      const todayStart = new Date(now);
      todayStart.setHours(schedule.hour, schedule.minute, 0, 0);
      let nextFire = todayStart.getTime();

      if (nextFire <= now) {
        nextFire += 86400000;
      }

      const delay = nextFire - now;
      songloft.log.info(`[备份调度] 下次备份: ${new Date(nextFire).toLocaleString('zh-CN')} (延迟 ${Math.round(delay / 60000)} 分钟)`);

      backupTimerId = setTimeout(async () => {
        await doBackup();
        scheduleNextBackup();
      }, delay);
    })
    .catch((err: unknown) => {
      songloft.log.error(`[备份调度] 加载调度配置失败: ${String(err)}`);
      setTimeout(() => scheduleNextBackup(), 5 * 60 * 1000);
    });
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

// ── 生命周期调度控制 ──────────────────────────────────────────────────────────

export function startScheduler(): void {
  songloft.log.info('[调度] 启动推送/备份定时任务');
  scheduleNextPush();
  scheduleNextBackup();
}

export function stopScheduler(): void {
  songloft.events.offPlayEvent();
  if (pushTimerId !== null) {
    clearTimeout(pushTimerId);
    pushTimerId = null;
  }
  if (backupTimerId !== null) {
    clearTimeout(backupTimerId);
    backupTimerId = null;
  }
  songloft.log.info('[调度] 已停止');
}

export { subscribePlayEvents, doPush, scheduleNextPush, scheduleNextBackup, doBackup };
