/// <reference types="@songloft/plugin-sdk" />
import type { LibrarySong } from './profile';
import { buildProfiles, fetchFavoriteIds, fetchLibrary } from './profile';
import type { MaterializeResult, RecommendItem } from './playlists';
import { materializeItems, PLAYLIST_PREFIX } from './playlists';

/** 规则歌单定义（SmartLists 简化版：条件之间为 AND 关系）*/
export interface PlaylistRule {
  /** 规则唯一 id（创建时生成）*/
  id: string;
  /** 歌单名（不含前缀）*/
  name: string;
  /** 流派精确匹配（空 = 不限）*/
  genre?: string;
  /** 艺术家包含匹配（空 = 不限）*/
  artist?: string;
  /** 专辑包含匹配（空 = 不限）*/
  album?: string;
  /** 仅限收藏歌曲（宿主内置收藏歌单）*/
  onlyFavorite?: boolean;
  /** 年份下限（含，0 = 不限）*/
  yearFrom?: number;
  /** 年份上限（含，0 = 不限）*/
  yearTo?: number;
  /** 最低播放次数（0 = 含从未播放的歌）*/
  minPlays?: number;
  /** 至少 N 天没听过（0 = 不限；从未播放的歌视为满足）*/
  notPlayedDays?: number;
  /** 歌单容量上限 */
  size?: number;
}

const RULES_KEY = 'rule_playlists';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RULE_SIZE = 50;
const MAX_RULES = 20;

// ── 规则存储 ──────────────────────────────────────────────────────────────────

export async function loadRules(): Promise<PlaylistRule[]> {
  try {
    const raw = await songloft.storage.get(RULES_KEY);
    if (raw == null) return [];
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(data) ? data.filter((r) => r && typeof r.id === 'string' && r.name) : [];
  } catch {
    return [];
  }
}

async function saveRules(rules: PlaylistRule[]): Promise<void> {
  await songloft.storage.set(RULES_KEY, rules);
}

function sanitizeRule(input: Partial<PlaylistRule>): Omit<PlaylistRule, 'id'> {
  const name = String(input.name || '').trim().slice(0, 30);
  if (!name) throw new Error('规则名称不能为空');
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v || '0'), 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };
  return {
    name,
    genre: String(input.genre || '').trim() || undefined,
    artist: String(input.artist || '').trim() || undefined,
    album: String(input.album || '').trim() || undefined,
    onlyFavorite: input.onlyFavorite ? true : undefined,
    yearFrom: num(input.yearFrom) || undefined,
    yearTo: num(input.yearTo) || undefined,
    minPlays: num(input.minPlays) || undefined,
    notPlayedDays: num(input.notPlayedDays) || undefined,
    size: Math.min(500, num(input.size)) || DEFAULT_RULE_SIZE,
  };
}

/** 新增或更新规则（带 id 则更新）*/
export async function upsertRule(input: Partial<PlaylistRule>): Promise<PlaylistRule> {
  const rules = await loadRules();
  const fields = sanitizeRule(input);

  if (input.id) {
    const idx = rules.findIndex((r) => r.id === input.id);
    if (idx < 0) throw new Error('规则不存在');
    rules[idx] = { id: input.id, ...fields };
    await saveRules(rules);
    return rules[idx];
  }

  if (rules.length >= MAX_RULES) throw new Error(`最多支持 ${MAX_RULES} 条规则`);
  const rule: PlaylistRule = { id: `r${Date.now().toString(36)}`, ...fields };
  rules.push(rule);
  await saveRules(rules);
  return rule;
}

/** 删除规则（不删除已生成的歌单）*/
export async function deleteRule(id: string): Promise<void> {
  const rules = await loadRules();
  await saveRules(rules.filter((r) => r.id !== id));
}

// ── 规则求值 ──────────────────────────────────────────────────────────────────

/** 生成规则歌单的曲目列表 */
export async function generateRuleItems(rule: PlaylistRule): Promise<RecommendItem[]> {
  const [library, profiles] = await Promise.all([fetchLibrary(), buildProfiles()]);
  // 收藏集合按需拉取（仅开启收藏条件的规则需要）
  const favoriteIds = rule.onlyFavorite ? await fetchFavoriteIds() : null;
  const now = Date.now();
  const artistKw = rule.artist?.toLowerCase();
  const albumKw = rule.album?.toLowerCase();

  const matched = library.filter((s: LibrarySong) => {
    if (rule.genre && s.genre !== rule.genre) return false;
    if (artistKw && !s.artist.toLowerCase().includes(artistKw)) return false;
    if (albumKw && !(s.album || '').toLowerCase().includes(albumKw)) return false;
    if (favoriteIds && !favoriteIds.has(s.songId)) return false;
    if (rule.yearFrom && (!s.year || s.year < rule.yearFrom)) return false;
    if (rule.yearTo && (!s.year || s.year > rule.yearTo)) return false;

    const p = profiles.get(s.songId);
    if (rule.minPlays && (!p || p.plays < rule.minPlays)) return false;
    if (rule.notPlayedDays && p && now - p.lastPlayedAt < rule.notPlayedDays * DAY_MS) return false;
    return true;
  });

  // 超出容量时随机打散再截取，保证每次刷新有新鲜感
  for (let i = matched.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matched[i], matched[j]] = [matched[j], matched[i]];
  }

  const size = rule.size || DEFAULT_RULE_SIZE;
  return matched.slice(0, size).map((s) => {
    const p = profiles.get(s.songId);
    return {
      songId: s.songId,
      title: s.title,
      artist: s.artist,
      album: s.album,
      reason: p ? `听过 ${p.plays} 次` : '未听过',
    };
  });
}

function describeRule(rule: PlaylistRule): string {
  const parts: string[] = [];
  if (rule.genre) parts.push(`流派=${rule.genre}`);
  if (rule.artist) parts.push(`艺术家含"${rule.artist}"`);
  if (rule.album) parts.push(`专辑含"${rule.album}"`);
  if (rule.onlyFavorite) parts.push('仅收藏');
  if (rule.yearFrom || rule.yearTo) parts.push(`年份 ${rule.yearFrom || '…'}~${rule.yearTo || '…'}`);
  if (rule.minPlays) parts.push(`播放≥${rule.minPlays}次`);
  if (rule.notPlayedDays) parts.push(`${rule.notPlayedDays}天未听`);
  return parts.length ? `规则歌单：${parts.join('，')}` : '规则歌单（全曲库）';
}

/** 将规则歌单物化为真实歌单 */
export async function materializeRule(id: string): Promise<MaterializeResult> {
  const rules = await loadRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error('规则不存在');
  const items = await generateRuleItems(rule);
  return materializeItems(PLAYLIST_PREFIX + rule.name, describeRule(rule), items.map((i) => i.songId));
}

// ── 曲库分面（供前端下拉框）────────────────────────────────────────────────────

/** 统计曲库中的流派与年份范围 */
export async function getLibraryFacets(): Promise<{ genres: { genre: string; count: number }[]; yearMin: number; yearMax: number }> {
  const library = await fetchLibrary();
  const genreMap = new Map<string, number>();
  let yearMin = 0;
  let yearMax = 0;
  for (const s of library) {
    if (s.genre) genreMap.set(s.genre, (genreMap.get(s.genre) || 0) + 1);
    if (s.year) {
      if (!yearMin || s.year < yearMin) yearMin = s.year;
      if (s.year > yearMax) yearMax = s.year;
    }
  }
  const genres = [...genreMap.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  return { genres, yearMin, yearMax };
}
