import type { PlayEvent } from '@songloft/plugin-sdk';

export interface PlayRecord {
  songId: number;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  source: string;
  timestamp: number;
}

export interface StatsSummary {
  totalPlays: number;
  totalDurationSec: number;
  uniqueSongs: number;
  uniqueArtists: number;
  topArtists: { artist: string; plays: number }[];
  topSongs: { songId: number; title: string; artist: string; plays: number }[];
  bySource: Record<string, number>;
}

const HISTORY_KEY = 'play_history';
const MAX_HISTORY = 5000;

export async function loadHistory(): Promise<PlayRecord[]> {
  const raw = await songloft.storage.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHistory(records: PlayRecord[]): Promise<void> {
  const trimmed = records.length > MAX_HISTORY ? records.slice(-MAX_HISTORY) : records;
  await songloft.storage.set(HISTORY_KEY, JSON.stringify(trimmed));
}

export async function clearHistory(): Promise<void> {
  await songloft.storage.delete(HISTORY_KEY);
}

export async function appendRecord(event: PlayEvent): Promise<PlayRecord> {
  const record: PlayRecord = {
    songId: event.song.id,
    title: event.song.title,
    artist: event.song.artist,
    source: event.source || 'unknown',
    timestamp: event.timestamp,
  };

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
  await saveHistory(history);
  return record;
}
