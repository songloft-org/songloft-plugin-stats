/// <reference types="@songloft/plugin-sdk" />
// 自然语言建歌单：LLM 只负责把用户描述翻译成结构化规则，筛选仍走本地规则引擎（零幻觉）
import { chatComplete, extractJson } from './client';
import type { PlaylistRule } from '../recommend/rules';
import { generateRuleItems, getLibraryFacets } from '../recommend/rules';
import type { RecommendItem } from '../recommend/playlists';

export interface NlRuleResult {
  /** LLM 解析出的规则（不含 id，未保存）*/
  rule: Omit<PlaylistRule, 'id'>;
  /** 规则命中的歌曲预览 */
  items: RecommendItem[];
  total: number;
}

/** 把用户一句话翻译成 PlaylistRule 字段并本地预览 */
export async function nlToRule(text: string): Promise<NlRuleResult> {
  const input = String(text || '').trim();
  if (!input) throw new Error('请描述你想要的歌单');
  if (input.length > 200) throw new Error('描述太长了，请精简到 200 字以内');

  const facets = await getLibraryFacets();
  const genreList = facets.genres.map((g) => g.genre).join('、') || '（曲库暂无流派标签）';
  const yearRange = facets.yearMin ? `${facets.yearMin}~${facets.yearMax}` : '（曲库暂无年份标签）';

  const system = [
    '你是音乐歌单规则解析器。把用户对歌单的自然语言描述翻译成 JSON 筛选规则，只输出 JSON，不要任何解释。',
    'JSON 字段（全部可选，不确定就省略，字段之间是 AND 关系）：',
    '- name: string 歌单名（必填，从描述里提炼，不超过 12 字）',
    '- genre: string 流派，必须从下方曲库流派列表中精确选一个，列表里没有贴近的就省略',
    '- artist: string 艺术家关键词（描述中明确提到歌手名才填）',
    '- album: string 专辑关键词（描述中明确提到专辑名才填）',
    '- onlyFavorite: boolean 描述提到"收藏"或"我喜欢的"才填 true',
    '- yearFrom / yearTo: number 年份范围（"80年代"=1980~1989，"老歌"可理解为 2000 以前）',
    '- minPlays: number 最低播放次数（"常听的"=3，"最爱"=5）',
    '- notPlayedDays: number 多少天没听过（"很久没听"=30）',
    '- size: number 歌单容量（描述提到数量才填，1~500）',
    `曲库流派列表：${genreList}`,
    `曲库年份范围：${yearRange}`,
  ].join('\n');

  const reply = await chatComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ],
    { temperature: 0.2, jsonMode: true }
  );

  let parsed: any;
  try {
    parsed = extractJson(reply);
  } catch {
    throw new Error('AI 返回的规则无法解析，请换个说法再试');
  }

  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : parseInt(String(v || ''), 10);
    return isNaN(n) || n <= 0 ? undefined : n;
  };
  // 只信任白名单字段；流派再对一遍曲库，防止 LLM 编造
  const validGenres = new Set(facets.genres.map((g) => g.genre));
  const genre = typeof parsed.genre === 'string' && validGenres.has(parsed.genre.trim()) ? parsed.genre.trim() : undefined;
  const rule: Omit<PlaylistRule, 'id'> = {
    name: String(parsed.name || input).trim().slice(0, 30) || 'AI 歌单',
    genre,
    artist: typeof parsed.artist === 'string' && parsed.artist.trim() ? parsed.artist.trim() : undefined,
    album: typeof parsed.album === 'string' && parsed.album.trim() ? parsed.album.trim() : undefined,
    onlyFavorite: parsed.onlyFavorite === true ? true : undefined,
    yearFrom: num(parsed.yearFrom),
    yearTo: num(parsed.yearTo),
    minPlays: num(parsed.minPlays),
    notPlayedDays: num(parsed.notPlayedDays),
    size: Math.min(500, num(parsed.size) || 50),
  };

  const items = await generateRuleItems({ id: '_preview', ...rule });
  return { rule, items: items.slice(0, 20), total: items.length };
}
