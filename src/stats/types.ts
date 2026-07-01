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
  topAlbums: { album: string; plays: number }[];
  bySource: Record<string, number>;
}

export interface TimeRange {
  from?: number;
  to?: number;
}
