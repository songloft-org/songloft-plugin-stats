import type { PlayRecord, StatsSummary, TimeRange } from './types';

function isValidRecord(r: PlayRecord): boolean {
  return (
    r != null &&
    typeof r.songId === 'number' &&
    typeof r.timestamp === 'number' &&
    typeof r.artist === 'string' && r.artist.length > 0 &&
    typeof r.title === 'string' && r.title.length > 0
  );
}

function inTimeRange(r: PlayRecord, range?: TimeRange): boolean {
  if (!range) return true;
  if (range.from !== undefined && r.timestamp < range.from) return false;
  if (range.to !== undefined && r.timestamp >= range.to) return false;
  return true;
}

export function computeSummary(records: PlayRecord[], range?: TimeRange): StatsSummary {
  const artistMap = new Map<string, number>();
  const songMap = new Map<number, { title: string; artist: string; plays: number }>();
  const albumMap = new Map<string, number>();
  const bySource: Record<string, number> = {};
  const byMediaType: Record<string, number> = {};
  const uniqueSongs = new Set<number>();
  const uniqueArtists = new Set<string>();
  let totalDurationSec = 0;
  let validCount = 0;

  for (const r of records) {
    if (!isValidRecord(r)) continue;
    if (!inTimeRange(r, range)) continue;
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

    if (r.album) {
      albumMap.set(r.album, (albumMap.get(r.album) || 0) + 1);
    }

    const src = r.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
    const mt = r.type || 'unknown';
    byMediaType[mt] = (byMediaType[mt] || 0) + 1;
  }

  const topArtists = [...artistMap.entries()]
    .map(([artist, plays]) => ({ artist, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  const topSongs = [...songMap.entries()]
    .map(([songId, v]) => ({ songId, ...v }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  const topAlbums = [...albumMap.entries()]
    .map(([album, plays]) => ({ album, plays }))
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 10);

  return {
    totalPlays: validCount,
    totalDurationSec,
    uniqueSongs: uniqueSongs.size,
    uniqueArtists: uniqueArtists.size,
    topArtists,
    topSongs,
    topAlbums,
    bySource,
    byMediaType,
  };
}

/** 按天统计播放量，返回最近 N 天的日期-播放量数组 */
export function computeTrends(records: PlayRecord[], days: number): { date: string; count: number }[] {
  const dayMap = new Map<string, number>();
  const now = new Date();
  // 生成最近 days 天的日期 key
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    dayMap.set(key, 0);
  }
  // 归入对应日期
  for (const r of records) {
    if (!isValidRecord(r)) continue;
    const d = new Date(r.timestamp);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    if (dayMap.has(key)) {
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
  }
  return [...dayMap.entries()].map(([date, count]) => ({ date, count }));
}

/** 按时段（凌晨/上午/下午/晚上）统计播放占比 */
export function computeHourlyDistribution(records: PlayRecord[]): { label: string; count: number }[] {
  const periods = [
    { label: '凌晨', range: [0, 6] },
    { label: '上午', range: [6, 12] },
    { label: '下午', range: [12, 18] },
    { label: '晚上', range: [18, 24] },
  ];
  const result = periods.map((p) => ({ label: p.label, count: 0 }));

  for (const r of records) {
    if (!isValidRecord(r)) continue;
    const hour = new Date(r.timestamp).getHours();
    for (let i = 0; i < periods.length; i++) {
      if (hour >= periods[i].range[0] && hour < periods[i].range[1]) {
        result[i].count++;
        break;
      }
    }
  }
  return result;
}
