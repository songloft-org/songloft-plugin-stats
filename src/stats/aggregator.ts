import type { PlayRecord, StatsSummary } from './store';

export function computeSummary(records: PlayRecord[]): StatsSummary {
  const artistMap = new Map<string, number>();
  const songMap = new Map<number, { title: string; artist: string; plays: number }>();
  const bySource: Record<string, number> = {};
  const uniqueSongs = new Set<number>();
  const uniqueArtists = new Set<string>();
  let totalDurationSec = 0;

  for (const r of records) {
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

    bySource[r.source] = (bySource[r.source] || 0) + 1;
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
    totalPlays: records.length,
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
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter((r) => r.timestamp >= since);
}
