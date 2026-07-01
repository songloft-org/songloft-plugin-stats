import type { PlayEvent } from '@songloft/plugin-sdk';
import type { PlayRecord, StatsSummary } from './types';
import { computeSummary } from './aggregator';

const HISTORY_KEY = 'play_history';
const SETTINGS_KEY = 'settings';
const DEFAULT_MAX_HISTORY = 20000;

// ── 设置 ──────────────────────────────────────────────────────────────────────

async function loadSettings(): Promise<{ maxHistory?: number }> {
  try {
    const raw = await songloft.storage.get(SETTINGS_KEY);
    if (raw == null) return {};
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function saveSettings(settings: { maxHistory?: number }): Promise<void> {
  await songloft.storage.set(SETTINGS_KEY, settings);
}

/** 获取当前历史记录保留上限 */
export async function getMaxHistory(): Promise<number> {
  const settings = await loadSettings();
  return typeof settings.maxHistory === 'number' && settings.maxHistory >= 1000
    ? settings.maxHistory
    : DEFAULT_MAX_HISTORY;
}

/** 设置历史记录保留上限（最低 1000）*/
export async function setMaxHistory(limit: number): Promise<void> {
  const clamped = Math.max(1000, Math.min(100000, limit));
  await saveSettings({ maxHistory: clamped });
  // 如果当前数据超过新上限，立即裁剪
  const history = await loadHistory();
  if (history.length > clamped) {
    summaryDirty = true;
    await flushSave(history);
  }
}

// ── 歌曲元数据缓存（与 main.ts 共用，避免重复查询 songloft.songs.getById）─────
const MAX_META_CACHE = 500;
const metaCache = new Map<number, { album?: string; duration?: number }>();

/** 获取歌曲元数据（带缓存） */
export async function getSongMeta(songId: number): Promise<{ album?: string; duration?: number }> {
  if (metaCache.has(songId)) return metaCache.get(songId)!;
  try {
    const song = await songloft.songs.getById(songId);
    const meta = { album: song?.album, duration: song?.duration };
    metaCache.set(songId, meta);
    if (metaCache.size > MAX_META_CACHE) {
      const firstKey = metaCache.keys().next().value;
      if (firstKey !== undefined) metaCache.delete(firstKey);
    }
    return meta;
  } catch {
    metaCache.set(songId, {});
    return {};
  }
}

// ── 内存缓存 ──────────────────────────────────────────────────────────────────
let cache: PlayRecord[] | null = null;

// ── 聚合结果缓存（dirty 标记）──────────────────────────────────────────────────
let summaryDirty = true;
let cachedSummary: StatsSummary | null = null;

// ── 去重索引: songId → cache 中最后一次出现的 index ─────────────────────────────
let dedupIndex: Map<number, number> | null = null;

function buildDedupIndex(records: PlayRecord[]): Map<number, number> {
  const idx = new Map<number, number>();
  for (let i = 0; i < records.length; i++) {
    idx.set(records[i].songId, i);
  }
  return idx;
}

async function readRaw(): Promise<PlayRecord[]> {
  const raw = await songloft.storage.get(HISTORY_KEY);
  if (raw == null) return [];
  // storage 可能返回已解析的对象或 JSON 字符串
  let data: unknown = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  return Array.isArray(data) ? data : [];
}

export async function loadHistory(): Promise<PlayRecord[]> {
  if (cache) return cache;
  cache = await readRaw();
  return cache;
}

/** 获取 songId → 最后出现位置的去重索引 */
export function getDedupIndex(): Map<number, number> {
  if (!dedupIndex && cache) {
    dedupIndex = buildDedupIndex(cache);
  }
  return dedupIndex || new Map();
}

// ── 写入队列（防止并发竞态）─────────────────────────────────────────────────────
let writeQueue: Promise<void> = Promise.resolve();

/** 等待所有进行中的写入完成（供 onDeinit 调用）*/
export async function drainWrites(): Promise<void> {
  await writeQueue;
}

async function flushSave(records: PlayRecord[]): Promise<void> {
  const limit = DEFAULT_MAX_HISTORY;
  const trimmed = records.length > limit ? records.slice(-limit) : records;
  await songloft.storage.set(HISTORY_KEY, trimmed);
  cache = trimmed;
  dedupIndex = null; // 下次查询时按需重建
}

// ── 记录写入 ──────────────────────────────────────────────────────────────────

/** 获取聚合摘要（带 dirty 缓存，仅数据变更时重算）*/
export async function getSummary(): Promise<StatsSummary> {
  if (!summaryDirty && cachedSummary) return cachedSummary;
  const history = await loadHistory();
  cachedSummary = computeSummary(history);
  summaryDirty = false;
  return cachedSummary;
}

async function doAppend(event: PlayEvent): Promise<PlayRecord> {
  const record: PlayRecord = {
    songId: event.song.id,
    title: event.song.title || '未知歌曲',
    artist: event.song.artist || '未知艺术家',
    source: event.source || 'unknown',
    timestamp: event.timestamp,
  };

  const meta = await getSongMeta(event.song.id);
  if (meta) {
    record.album = meta.album;
    record.duration = meta.duration;
  }

  const history = await loadHistory();
  history.push(record);
  summaryDirty = true;
  await flushSave(history);
  return record;
}

export function appendRecord(event: PlayEvent): Promise<PlayRecord> {
  const p = writeQueue.then(() => doAppend(event));
  writeQueue = p
    .catch((e) => {
      songloft.log.error('[store] appendRecord 失败: ' + String(e));
    })
    .then(() => {
      // noop
    });
  return p as Promise<PlayRecord>;
}

// ── 导出/导入/重置 ────────────────────────────────────────────────────────────

/** 导出完整播放历史（返回原始记录数组）*/
export async function exportHistory(): Promise<PlayRecord[]> {
  return await loadHistory();
}

/** 导入记录并合并（按 songId + timestamp 去重），返回新增条数 */
export async function importRecords(newRecords: PlayRecord[]): Promise<number> {
  if (!Array.isArray(newRecords) || newRecords.length === 0) return 0;

  const history = await loadHistory();
  const keySet = new Set<string>();
  for (const r of history) {
    keySet.add(`${r.songId}|${r.timestamp}`);
  }

  let added = 0;
  for (const r of newRecords) {
    if (!r || typeof r.songId !== 'number' || typeof r.timestamp !== 'number'
        || !r.title || !r.artist) continue;
    const key = `${r.songId}|${r.timestamp}`;
    if (keySet.has(key)) continue;
    keySet.add(key);
    history.push(r);
    added++;
  }

  if (added > 0) {
    // 按 timestamp 排序
    history.sort((a, b) => a.timestamp - b.timestamp);
    summaryDirty = true;
    await flushSave(history);
  }

  return added;
}

/** 获取当前总记录数（从缓存读取，不触发存储 IO）*/
export async function getRecordCount(): Promise<number> {
  const h = await loadHistory();
  return h.length;
}

/** 清空所有播放历史 */
export async function resetHistory(): Promise<void> {
  await songloft.storage.delete(HISTORY_KEY);
  cache = [];
  dedupIndex = null;
  summaryDirty = true;
  cachedSummary = null;
}
