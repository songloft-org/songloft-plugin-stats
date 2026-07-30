/// <reference types="@songloft/plugin-sdk" />
import type { SongProfile, LibrarySong } from './profile';
import { buildProfiles, fetchLibrary, hourToPeriod } from './profile';
import { DEFAULT_WEIGHTS, scoreSong, skipRate, weightedSample } from './scorer';
import { loadHistory } from '../store';

/** 智能歌单模式 */
export type RecommendMode = 'shuffle' | 'gems' | 'daypart' | 'noskip' | 'genrefav';

export const MODE_INFO: Record<RecommendMode, { name: string; description: string }> = {
  shuffle: { name: '随便听听', description: '综合热度与时段偏好，混入少量未听过的探索曲目' },
  gems: { name: '久未听的宝藏', description: '曾经高频播放但最近 30 天以上没听过的歌' },
  daypart: { name: '当前时段偏好', description: '你在当前时段（凌晨/上午/下午/晚上）最常听的歌' },
  noskip: { name: '免切歌精选', description: '切歌率最低、最耐听的歌' },
  genrefav: { name: '最爱流派', description: '近 30 天你听得最多的流派，从中混听（依赖歌曲流派标签）' },
};

export const ALL_MODES: RecommendMode[] = ['shuffle', 'gems', 'daypart', 'noskip', 'genrefav'];

/** 推荐结果条目 */
export interface RecommendItem {
  songId: number;
  title: string;
  artist: string;
  album?: string;
  /** 推荐理由（前端展示）*/
  reason: string;
}

const DEFAULT_SIZE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** shuffle 模式中"探索"曲目（从未播放过的歌）占比 */
const EXPLORE_RATIO = 0.2;
/** gems 模式的"久未听"门槛（天）*/
const GEMS_MIN_IDLE_DAYS = 30;
/** genrefav 模式的统计窗口（天）与流派数上限 */
const GENREFAV_WINDOW_DAYS = 30;
const GENREFAV_TOP_GENRES = 3;

function toItem(p: SongProfile, reason: string): RecommendItem {
  return { songId: p.songId, title: p.title, artist: p.artist, album: p.album, reason };
}

/** 从曲库挑选从未播放过的探索曲目，优先常听歌手/流派的新歌 */
function pickExplore(
  library: LibrarySong[],
  profiles: Map<number, SongProfile>,
  count: number,
): RecommendItem[] {
  if (count <= 0) return [];

  // 统计常听歌手与流派（按播放量）
  const artistPlays = new Map<string, number>();
  const genrePlays = new Map<string, number>();
  const knownGenres = new Map<number, string>();
  for (const s of library) {
    if (s.genre) knownGenres.set(s.songId, s.genre);
  }
  for (const p of profiles.values()) {
    artistPlays.set(p.artist, (artistPlays.get(p.artist) || 0) + p.plays);
    const g = knownGenres.get(p.songId);
    if (g) genrePlays.set(g, (genrePlays.get(g) || 0) + p.plays);
  }

  const unplayed = library.filter((s) => !profiles.has(s.songId));
  const scored = unplayed.map((s) => {
    // 熟悉歌手/流派加分，让探索不至于太跳
    const familiar =
      (artistPlays.get(s.artist) ? 1 : 0) + (s.genre && genrePlays.get(s.genre) ? 0.5 : 0);
    return { item: s, score: familiar + Math.random() * 0.5 };
  });

  return weightedSample(scored, count).map((s) => ({
    songId: s.songId,
    title: s.title,
    artist: s.artist,
    album: s.album,
    reason: artistPlays.has(s.artist) ? `你常听 ${s.artist}，但还没听过这首` : '曲库探索',
  }));
}

/** 生成指定模式的推荐列表 */
export async function generateRecommend(mode: RecommendMode, size?: number): Promise<RecommendItem[]> {
  const limit = Math.min(200, Math.max(5, size || DEFAULT_SIZE));
  const now = Date.now();
  const profiles = await buildProfiles();
  const played = [...profiles.values()];
  const maxPlays = played.reduce((m, p) => Math.max(m, p.plays), 0);

  switch (mode) {
    case 'shuffle': {
      const exploreCount = Math.round(limit * EXPLORE_RATIO);
      const scored = played.map((p) => ({
        item: p,
        score: scoreSong(p, maxPlays, now, DEFAULT_WEIGHTS),
      }));
      const picks = weightedSample(scored, limit - exploreCount).map((p) =>
        toItem(p, `听过 ${p.plays} 次`),
      );
      // 探索部分需要全曲库（失败不影响主列表）
      let explore: RecommendItem[] = [];
      try {
        const library = await fetchLibrary();
        explore = pickExplore(library, profiles, exploreCount);
      } catch (e) {
        songloft.log.warn('[推荐] 拉取曲库失败，跳过探索曲目: ' + String(e));
      }
      // 交错混入探索曲目
      const result = [...picks];
      explore.forEach((item, i) => {
        result.splice(Math.min(result.length, (i + 1) * 4), 0, item);
      });
      return result.slice(0, limit);
    }

    case 'gems': {
      const cutoff = now - GEMS_MIN_IDLE_DAYS * DAY_MS;
      return played
        .filter((p) => p.plays >= 2 && p.lastPlayedAt < cutoff)
        .sort((a, b) => b.plays - a.plays || a.lastPlayedAt - b.lastPlayedAt)
        .slice(0, limit)
        .map((p) =>
          toItem(p, `播放 ${p.plays} 次，已 ${Math.floor((now - p.lastPlayedAt) / DAY_MS)} 天没听`),
        );
    }

    case 'daypart': {
      const period = hourToPeriod(new Date(now).getHours());
      const labels = ['凌晨', '上午', '下午', '晚上'];
      return played
        .filter((p) => p.periodCounts[period] > 0)
        .sort((a, b) => b.periodCounts[period] - a.periodCounts[period])
        .slice(0, limit)
        .map((p) => toItem(p, `${labels[period]}听过 ${p.periodCounts[period]} 次`));
    }

    case 'noskip': {
      return played
        .filter((p) => p.plays >= 2)
        .sort((a, b) => skipRate(a.plays, a.skips) - skipRate(b.plays, b.skips) || b.plays - a.plays)
        .slice(0, limit)
        .map((p) => toItem(p, p.skips === 0 ? `听过 ${p.plays} 次从未切歌` : `切歌率极低`));
    }

    case 'genrefav': {
      // 近 30 天各流派播放量→取前 3 名，再从这些流派内按热度加权选歌（含未听过的）
      const library = await fetchLibrary();
      const genreOf = new Map<number, string>();
      for (const s of library) {
        if (s.genre) genreOf.set(s.songId, s.genre);
      }

      const history = await loadHistory();
      const cutoff = now - GENREFAV_WINDOW_DAYS * DAY_MS;
      const genrePlays = new Map<string, number>();
      for (const r of history) {
        if (!r || typeof r.songId !== 'number' || typeof r.timestamp !== 'number') continue;
        if (r.timestamp < cutoff) continue;
        const g = genreOf.get(r.songId);
        if (g) genrePlays.set(g, (genrePlays.get(g) || 0) + 1);
      }
      // 无流派标签或近期无播放时返回空，前端展示数据不足提示
      const topGenres = [...genrePlays.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, GENREFAV_TOP_GENRES)
        .map(([g]) => g);
      if (topGenres.length === 0) return [];
      const topSet = new Set(topGenres);

      const scored = library
        .filter((s) => s.genre && topSet.has(s.genre))
        .map((s) => {
          const p = profiles.get(s.songId);
          // 听过的歌按播放量提权（封顶防独占），未听过的也有机会露出
          return { item: s, score: 1 + (p ? Math.min(5, p.plays) : 0) + Math.random() };
        });
      return weightedSample(scored, limit).map((s) => ({
        songId: s.songId,
        title: s.title,
        artist: s.artist,
        album: s.album,
        reason: `你最近常听「${s.genre}」`,
      }));
    }

    default:
      return [];
  }
}

// ── 歌单物化：把推荐结果写成主程序里的真实歌单 ─────────────────────────────────

const PLAYLIST_PREFIX = '智能歌单·';
export { PLAYLIST_PREFIX };

export interface MaterializeResult {
  playlistId: number;
  playlistName: string;
  songCount: number;
  created: boolean;
}

/** 把一组 songId 物化为真实歌单（存在同名歌单则清空重填）*/
export async function materializeItems(name: string, description: string, songIds: number[]): Promise<MaterializeResult> {
  if (songIds.length === 0) {
    throw new Error('推荐结果为空（播放数据不足或筛选条件过严）');
  }

  const existing = (await songloft.playlists.list()).find((pl) => pl.name === name);

  let playlistId: number;
  let created = false;
  if (existing) {
    playlistId = existing.id;
    // 清空旧内容
    const oldSongs = await songloft.playlists.getSongs(playlistId);
    if (oldSongs.length > 0) {
      await songloft.playlists.removeSongs(playlistId, oldSongs.map((s) => s.id));
    }
  } else {
    const pl = await songloft.playlists.create({ name, description });
    playlistId = pl.id;
    created = true;
  }

  const { added } = await songloft.playlists.addSongs(playlistId, songIds);
  songloft.log.info(`[推荐] 歌单「${name}」已刷新: ${added} 首`);
  return { playlistId, playlistName: name, songCount: added, created };
}

/** 将推荐结果物化为真实歌单 */
export async function materializePlaylist(mode: RecommendMode, size?: number): Promise<MaterializeResult> {
  const items = await generateRecommend(mode, size);
  const name = PLAYLIST_PREFIX + MODE_INFO[mode].name;
  return materializeItems(name, MODE_INFO[mode].description, items.map((i) => i.songId));
}
