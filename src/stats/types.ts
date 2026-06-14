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

export interface DailyTrendItem {
  /** 日期标签，格式 "MM-DD" */
  date: string;
  /** 当天播放次数 */
  plays: number;
  /** 当天播放总时长（秒） */
  durationSec: number;
}
