import type { PlayEvent } from '@songloft/plugin-sdk';
import type { PlayRecord, StatsSummary, MediaType } from './types';

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
    await flushSave(history);
    // 裁剪后重建增量聚合状态
    if (incInitialized) {
      rebuildIncState(cache!);
    }
  }
}

// ── 歌曲元数据缓存（与 scheduler 共用，避免重复查询 songloft.songs.getById）─────
const MAX_META_CACHE = 500;
const metaCache = new Map<number, { album?: string; duration?: number; type?: MediaType }>();

/** 获取歌曲元数据（带缓存），含媒体类型 type（来自 Song.type） */
export async function getSongMeta(songId: number): Promise<{ album?: string; duration?: number; type?: MediaType }> {
  if (metaCache.has(songId)) return metaCache.get(songId)!;
  try {
    const song = await songloft.songs.getById(songId);
    const meta = { album: song?.album, duration: song?.duration, type: song?.type };
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

// ── 聚合增量状态（增量更新，避免全量遍历）───────────────────────────────────────
// 仅在 appendRecord 时增量更新；导入/重置时退回全量计算
const incArtistMap = new Map<string, number>();
const incSongMap = new Map<number, { title: string; artist: string; plays: number }>();
const incAlbumMap = new Map<string, number>();
const incBySource: Record<string, number> = {};
const incByMediaType: Record<string, number> = {};
const incUniqueSongs = new Set<number>();
const incUniqueArtists = new Set<string>();
let incTotalDurationSec = 0;
let incTotalPlays = 0;
let incInitialized = false;

/** 从全量记录重建增量聚合状态（仅在导入/重置后调用） */
function rebuildIncState(records: PlayRecord[]): void {
  incArtistMap.clear();
  incSongMap.clear();
  incAlbumMap.clear();
  const newBySource: Record<string, number> = {};
  const newByMediaType: Record<string, number> = {};
  incUniqueSongs.clear();
  incUniqueArtists.clear();
  incTotalDurationSec = 0;
  incTotalPlays = 0;

  for (const r of records) {
    if (!r || typeof r.songId !== 'number' || typeof r.artist !== 'string' || typeof r.title !== 'string') continue;
    incTotalPlays++;
    incUniqueSongs.add(r.songId);
    incUniqueArtists.add(r.artist);
    incTotalDurationSec += r.duration || 0;
    incArtistMap.set(r.artist, (incArtistMap.get(r.artist) || 0) + 1);
    const existingSong = incSongMap.get(r.songId);
    if (existingSong) {
      existingSong.plays++;
    } else {
      incSongMap.set(r.songId, { title: r.title, artist: r.artist, plays: 1 });
    }
    if (r.album) {
      incAlbumMap.set(r.album, (incAlbumMap.get(r.album) || 0) + 1);
    }
    const src = r.source || 'unknown';
    newBySource[src] = (newBySource[src] || 0) + 1;
    const mt = r.type || 'unknown';
    newByMediaType[mt] = (newByMediaType[mt] || 0) + 1;
  }
  // 替换 incBySource / incByMediaType 对象引用
  for (const key of Object.keys(incBySource)) delete incBySource[key];
  Object.assign(incBySource, newBySource);
  for (const key of Object.keys(incByMediaType)) delete incByMediaType[key];
  Object.assign(incByMediaType, newByMediaType);
  incInitialized = true;
}

/** 从增量聚合状态构建 StatsSummary */
function buildIncSummary(): StatsSummary {
  const topArtists = [...incArtistMap.entries()]
    .map(([artist, plays]) => ({ artist, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  const topSongs = [...incSongMap.entries()]
    .map(([songId, v]) => ({ songId, ...v }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  const topAlbums = [...incAlbumMap.entries()]
    .map(([album, plays]) => ({ album, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  return {
    totalPlays: incTotalPlays,
    totalDurationSec: incTotalDurationSec,
    uniqueSongs: incUniqueSongs.size,
    uniqueArtists: incUniqueArtists.size,
    topArtists,
    topSongs,
    topAlbums,
    bySource: incBySource,
    byMediaType: incByMediaType,
  };
}

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
  // 首次加载时初始化增量聚合状态
  if (!incInitialized) {
    rebuildIncState(cache);
  }
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
  const limit = await getMaxHistory();
  const trimmed = records.length > limit ? records.slice(-limit) : records;
  await songloft.storage.set(HISTORY_KEY, trimmed);
  cache = trimmed;
  // 裁剪后重建去重索引（覆盖整个 trimmed，含刚写入的记录）
  if (dedupIndex) {
    dedupIndex = buildDedupIndex(trimmed);
  }
}

// ── 记录写入 ──────────────────────────────────────────────────────────────────

/** 获取聚合摘要（基于增量状态，O(1) 排序开销），首次调用确保已初始化 */
export async function getSummary(): Promise<StatsSummary> {
  await loadHistory(); // 确保 incInitialized
  return buildIncSummary();
}

/** 增量追加一条记录到聚合状态 */
function incAppendRecord(record: PlayRecord): void {
  if (!incInitialized) return;
  incTotalPlays++;
  incUniqueSongs.add(record.songId);
  incUniqueArtists.add(record.artist);
  incTotalDurationSec += record.duration || 0;
  incArtistMap.set(record.artist, (incArtistMap.get(record.artist) || 0) + 1);
  const existingSong = incSongMap.get(record.songId);
  if (existingSong) {
    existingSong.plays++;
  } else {
    incSongMap.set(record.songId, { title: record.title, artist: record.artist, plays: 1 });
  }
  if (record.album) {
    incAlbumMap.set(record.album, (incAlbumMap.get(record.album) || 0) + 1);
  }
  const src = record.source || 'unknown';
  incBySource[src] = (incBySource[src] || 0) + 1;
  const mt = record.type || 'unknown';
  incByMediaType[mt] = (incByMediaType[mt] || 0) + 1;
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
    record.type = meta.type;
  }

  const history = await loadHistory();
  history.push(record);
  incAppendRecord(record); // 增量更新聚合状态
  await flushSave(history);
  // 增量维护去重索引，保证 /api/history 去重视图包含本次新播放的歌
  if (dedupIndex && cache) {
    dedupIndex.set(record.songId, cache.length - 1);
  }
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
    await flushSave(history);
    // 导入后重建增量聚合状态
    if (incInitialized) {
      rebuildIncState(cache!);
    }
    // 导入后去重索引失效，下次查询时重建
    dedupIndex = null;
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
  // 重置增量聚合状态
  incArtistMap.clear();
  incSongMap.clear();
  incAlbumMap.clear();
  for (const key of Object.keys(incBySource)) delete incBySource[key];
  for (const key of Object.keys(incByMediaType)) delete incByMediaType[key];
  incUniqueSongs.clear();
  incUniqueArtists.clear();
  incTotalDurationSec = 0;
  incTotalPlays = 0;
  incInitialized = true; // 已初始化但为空
}
