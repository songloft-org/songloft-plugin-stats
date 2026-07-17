export type MediaType = 'local' | 'remote' | 'radio';

export interface PlayRecord {
  songId: number;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  source: string;
  /** 媒体类型：local=本地, remote=网络, radio=电台（来自 Song.type） */
  type?: MediaType;
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
  /** 媒体类型分布：local / remote / radio / unknown */
  byMediaType?: Record<string, number>;
}

export interface TimeRange {
  from?: number;
  to?: number;
}
