import type { PlayRecord, StatsSummary, DailyTrendItem } from './types';

const MAX_DAYS = 365 * 10; // 安全上限，防止溢出

function isValidRecord(r: PlayRecord): boolean {
  return (
    r != null &&
    typeof r.songId === 'number' &&
    typeof r.timestamp === 'number' &&
    typeof r.artist === 'string' && r.artist.length > 0 &&
    typeof r.title === 'string' && r.title.length > 0
  );
}

export function computeSummary(records: PlayRecord[]): StatsSummary {
  const artistMap = new Map<string, number>();
  const songMap = new Map<number, { title: string; artist: string; plays: number }>();
  const bySource: Record<string, number> = {};
  const uniqueSongs = new Set<number>();
  const uniqueArtists = new Set<string>();
  let totalDurationSec = 0;
  let validCount = 0;

  for (const r of records) {
    if (!isValidRecord(r)) continue;
    validCount++;

    uniqueSongs.add(r.songId);
    uniqueArtists.add(r.artist);
    totalDurationSec += r.duration || 0;

    artistMap.set(r.artist, (artistMap.get(r.artist) || 0) + 1);

    const existing = songMap.get(r.songId);
    if (existing) {
      existing.plays++;
    } else {
      songMap.set(r.songId, { title: r.title, artist: r.artist, plays: 1 });
    }

    const src = r.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const topArtists = [...artistMap.entries()]
    .map(([artist, plays]) => ({ artist, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  const topSongs = [...songMap.entries()]
    .map(([songId, v]) => ({ songId, ...v }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  return {
    totalPlays: validCount,
    totalDurationSec,
    uniqueSongs: uniqueSongs.size,
    uniqueArtists: uniqueArtists.size,
    topArtists,
    topSongs,
    bySource,
  };
}

export function filterByDays(records: PlayRecord[], days: number): PlayRecord[] {
  if (days <= 0) return records;
  const safeDays = Math.min(days, MAX_DAYS);
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  return records.filter((r) => typeof r.timestamp === 'number' && r.timestamp >= since);
}

/**
 * 按天聚合播放趋势，返回最近 N 天的每日数据。
 * 不足天数用 0 填充，保证返回数组长度始终等于 days。
 */
export function computeDailyTrend(records: PlayRecord[], days: number): DailyTrendItem[] {
  if (days <= 0 || days > MAX_DAYS) days = 30;

  // 按日期 key 聚合
  const dayMap = new Map<string, { plays: number; durationSec: number }>();
  for (const r of records) {
    if (!isValidRecord(r)) continue;
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const existing = dayMap.get(key);
    if (existing) {
      existing.plays++;
      existing.durationSec += r.duration || 0;
    } else {
      dayMap.set(key, { plays: 1, durationSec: r.duration || 0 });
    }
  }

  // 生成最近 N 天的完整序列（从早到晚）
  const result: DailyTrendItem[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const agg = dayMap.get(key);
    result.push({
      date: label,
      plays: agg ? agg.plays : 0,
      durationSec: agg ? agg.durationSec : 0,
    });
  }
  return result;
}
