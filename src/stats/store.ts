import type { PlayEvent } from '@songloft/plugin-sdk';
import type { PlayRecord } from './types';

const HISTORY_KEY = 'play_history';
const MAX_HISTORY = 5000;

// ── 内存缓存 ──────────────────────────────────────────────────────────────────
let cache: PlayRecord[] | null = null;

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

// ── 写入队列（防止并发竞态）─────────────────────────────────────────────────────
let writeQueue: Promise<void> = Promise.resolve();

/** 等待所有进行中的写入完成（供 onDeinit 调用）*/
export async function drainWrites(): Promise<void> {
  await writeQueue;
}

async function flushSave(records: PlayRecord[]): Promise<void> {
  const trimmed = records.length > MAX_HISTORY ? records.slice(-MAX_HISTORY) : records;
  // 直接存储 JSON 对象，而不是字符串（storage 接口支持 JSON 数据）
  await songloft.storage.set(HISTORY_KEY, trimmed);
  cache = trimmed;
}

// ── 记录写入 ──────────────────────────────────────────────────────────────────

async function doAppend(event: PlayEvent): Promise<PlayRecord> {
  const record: PlayRecord = {
    songId: event.song.id,
    title: event.song.title,
    artist: event.song.artist || '未知艺术家',
    source: event.source || 'unknown',
    timestamp: event.timestamp,
  };

  if (!record.title) record.title = '未知歌曲';

  try {
    const song = await songloft.songs.getById(event.song.id);
    if (song) {
      record.album = song.album;
      record.duration = song.duration;
    }
  } catch {
    // 元数据获取失败不影响记录
  }

  const history = await loadHistory();
  history.push(record);
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
