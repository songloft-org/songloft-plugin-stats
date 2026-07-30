/// <reference types="@songloft/plugin-sdk" />
import { loadHistory, loadSkipCounts } from '../store';

/** 时段划分：0=凌晨(0-6) 1=上午(6-12) 2=下午(12-18) 3=晚上(18-24)，与 aggregator 一致 */
export const PERIOD_COUNT = 4;

export function hourToPeriod(hour: number): number {
  return Math.min(3, Math.floor(hour / 6));
}

/** 单曲行为画像（由播放历史 + 切歌计数聚合而来）*/
export interface SongProfile {
  songId: number;
  title: string;
  artist: string;
  album?: string;
  /** 完整播放次数 */
  plays: number;
  /** 切歌次数 */
  skips: number;
  /** 最后一次播放时间戳（毫秒）*/
  lastPlayedAt: number;
  /** 各时段播放次数分布（4 维）*/
  periodCounts: number[];
}

/** 曲库中的候选歌曲（含从未播放过的歌）*/
export interface LibrarySong {
  songId: number;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: number;
  type: string;
}

/** 从播放历史 + 切歌计数构建全部歌曲画像（songId → profile）*/
export async function buildProfiles(): Promise<Map<number, SongProfile>> {
  const [history, skipCounts] = await Promise.all([loadHistory(), loadSkipCounts()]);
  const profiles = new Map<number, SongProfile>();

  for (const r of history) {
    if (!r || typeof r.songId !== 'number' || typeof r.timestamp !== 'number') continue;
    // 电台是直播流，不适合进歌单推荐
    if (r.type === 'radio') continue;
    let p = profiles.get(r.songId);
    if (!p) {
      p = {
        songId: r.songId,
        title: r.title,
        artist: r.artist,
        album: r.album,
        plays: 0,
        skips: 0,
        lastPlayedAt: 0,
        periodCounts: [0, 0, 0, 0],
      };
      profiles.set(r.songId, p);
    }
    p.plays++;
    // 取最新记录的元数据与最后播放时间
    if (r.timestamp > p.lastPlayedAt) {
      p.lastPlayedAt = r.timestamp;
      p.title = r.title;
      p.artist = r.artist;
      if (r.album) p.album = r.album;
    }
    p.periodCounts[hourToPeriod(new Date(r.timestamp).getHours())]++;
  }

  // 合并切歌计数（含只被切过、从未完整播放过的歌）
  for (const [songId, skips] of skipCounts) {
    const p = profiles.get(songId);
    if (p) {
      p.skips = skips;
    }
    // 无播放记录的纯 skip 歌曲缺少元数据，不进画像（评分时按未知处理）
  }

  return profiles;
}

// ── 曲库枚举 ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 500;
const MAX_LIBRARY_SONGS = 50000;
const LIBRARY_CACHE_TTL_MS = 10 * 60 * 1000;

let libraryCache: { songs: LibrarySong[]; fetchedAt: number } | null = null;

/** 分页拉取全曲库（带 10 分钟缓存；排除电台类型）*/
export async function fetchLibrary(): Promise<LibrarySong[]> {
  if (libraryCache && Date.now() - libraryCache.fetchedAt < LIBRARY_CACHE_TTL_MS) {
    return libraryCache.songs;
  }

  const songs: LibrarySong[] = [];
  let offset = 0;
  while (offset < MAX_LIBRARY_SONGS) {
    const page = await songloft.songs.list({ limit: PAGE_SIZE, offset });
    if (!Array.isArray(page) || page.length === 0) break;
    for (const s of page) {
      // 电台是直播流，不适合进歌单推荐
      if (s.type === 'radio') continue;
      songs.push({
        songId: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album || undefined,
        genre: s.genre || undefined,
        year: s.year || undefined,
        type: s.type,
      });
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  libraryCache = { songs, fetchedAt: Date.now() };
  return songs;
}

/** 使曲库缓存失效（测试/手动刷新用）*/
export function invalidateLibraryCache(): void {
  libraryCache = null;
}

// ── 收藏歌单 ──────────────────────────────────────────────────────────────────

const FAVORITE_CACHE_TTL_MS = 5 * 60 * 1000;

let favoriteCache: { ids: Set<number>; fetchedAt: number } | null = null;

/** 获取收藏歌曲的 id 集合（收藏是宿主预置的内置歌单，带 built_in 标签；带 5 分钟缓存）*/
export async function fetchFavoriteIds(): Promise<Set<number>> {
  if (favoriteCache && Date.now() - favoriteCache.fetchedAt < FAVORITE_CACHE_TTL_MS) {
    return favoriteCache.ids;
  }

  const ids = new Set<number>();
  const playlists = await songloft.playlists.list();
  const fav = playlists.find((pl) => pl.type === 'normal' && (pl.labels || []).includes('built_in'));
  if (fav) {
    const songs = await songloft.playlists.getSongs(fav.id);
    for (const s of songs) ids.add(s.id);
  } else {
    songloft.log.warn('[推荐] 未找到内置收藏歌单，收藏条件将匹配不到任何歌曲');
  }

  favoriteCache = { ids, fetchedAt: Date.now() };
  return ids;
}
