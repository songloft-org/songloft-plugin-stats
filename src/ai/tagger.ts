/// <reference types="@songloft/plugin-sdk" />
// AI 标签补全：LLM 按「歌名 + 艺术家」推断流派/年份，写库走宿主 REST API
// （PUT /api/v1/songs/{id}/tags：非空字段覆盖、空值保留原值、仅支持本地歌曲），
// 作为 tag 插件刮削不到时的兜底。后台分批执行，前端轮询进度。
import { chatComplete, extractJson } from './client';
import { fetchLibrary, invalidateLibraryCache } from '../recommend/profile';
import type { LibrarySong } from '../recommend/profile';

// 批次宁小勿大：宿主 fetch 代理有固定超时（插件无法延长），本地慢模型大批次容易撞上 deadline
const BATCH_SIZE = 8;
const MAX_SONGS_PER_RUN = 200;

export interface AiTagProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  total: number;
  processed: number;
  success: number;
  failed: number;
  error?: string;
  /** 最近一次失败的具体原因，便于前端直接展示排查 */
  lastError?: string;
}

let progress: AiTagProgress = { status: 'idle', total: 0, processed: 0, success: 0, failed: 0 };

export function getAiTagProgress(): AiTagProgress {
  return { ...progress };
}

/** 统计缺流派/年份的本地歌曲数（写标签接口仅支持本地歌曲）*/
export async function countMissingTags(): Promise<{ missing: number; localTotal: number }> {
  const library = await fetchLibrary();
  const locals = library.filter((s) => s.type === 'local');
  const missing = locals.filter((s) => !s.genre || !s.year).length;
  return { missing, localTotal: locals.length };
}

/** 发一次推断请求：jsonMode 被 4xx 拒绝时自动降级为普通模式 */
async function requestInfer(messages: Parameters<typeof chatComplete>[0]): Promise<string> {
  const opts = { temperature: 0.1, maxTokens: 1024 };
  try {
    return await chatComplete(messages, { ...opts, jsonMode: true });
  } catch (e) {
    // 部分 OpenAI 兼容服务不支持 response_format，返回 4xx；去掉 jsonMode 重试一次
    if (/HTTP 4\d\d/.test(String(e))) {
      songloft.log.warn(`[AI标签] jsonMode 请求被拒（${String(e)}），改用普通模式重试`);
      return await chatComplete(messages, opts);
    }
    throw e;
  }
}

/** 一批歌曲交给 LLM 推断流派/年份，返回 songId → { genre, year }。
 * lenient 模式用于二次机会：要求至少给出大致流派，年份仍宁缺毋滥 */
async function inferBatch(songs: LibrarySong[], lenient = false): Promise<Map<number, { genre?: string; year?: number }>> {
  const list = songs
    .map((s) => `${s.songId}|${s.title}|${s.artist}${s.album ? '|' + s.album : ''}`)
    .join('\n');
  const messages: Parameters<typeof chatComplete>[0] = [
    {
      role: 'system',
      content:
        '你是音乐元数据专家。下面每行是一首歌：id|歌名|艺术家|专辑（专辑可能缺失）。' +
        '推断每首歌的流派和发行年份，输出 JSON：{"songs":[{"id":数字,"genre":"流派","year":年份}]}。' +
        '流派用简短中文或通用英文（如 流行/摇滚/民谣/电子/说唱/古典/爵士/Pop/Rock）。' +
        (lenient
          ? '这些歌你可能不认识，但每首都必须给出一个大致流派：可根据歌名语言、用词风格、艺术家名称粗略判断（如纯音乐/流行/民谣/电子）。' +
            '年份仅在有把握时给出，不确定就省略。只输出 JSON。'
          : '不确定的字段省略，绝不要瞎猜冷门歌曲的年份。只输出 JSON。'),
    },
    { role: 'user', content: list },
  ];
  let reply: string;
  try {
    reply = await requestInfer(messages);
  } catch (e) {
    // 本地模型冷启动时首次请求常超时（模型仍在后台加载），稍等后重试一次
    if (/deadline exceeded|超时|timeout/i.test(String(e))) {
      songloft.log.warn(`[AI标签] 请求超时（${String(e)}），15 秒后重试一次`);
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 15000));
      reply = await requestInfer(messages);
    } else {
      throw e;
    }
  }

  const result = new Map<number, { genre?: string; year?: number }>();
  const parsed = extractJson(reply);
  const arr = Array.isArray(parsed?.songs) ? parsed.songs : [];
  for (const item of arr) {
    const id = typeof item?.id === 'number' ? item.id : parseInt(String(item?.id || ''), 10);
    if (isNaN(id)) continue;
    const genre = typeof item.genre === 'string' && item.genre.trim() ? item.genre.trim().slice(0, 30) : undefined;
    const yearNum = typeof item.year === 'number' ? item.year : parseInt(String(item.year || ''), 10);
    const year = !isNaN(yearNum) && yearNum >= 1900 && yearNum <= 2100 ? yearNum : undefined;
    if (genre || year) result.set(id, { genre, year });
  }
  return result;
}

/** 写入单首歌的标签（只传缺失的字段，非空覆盖语义保证不动其他标签）*/
async function writeTags(song: LibrarySong, inferred: { genre?: string; year?: number }): Promise<void> {
  const [host, token] = await Promise.all([songloft.plugin.getHostUrl(), songloft.plugin.getToken()]);
  const body: Record<string, string | number> = {};
  if (!song.genre && inferred.genre) body.genre = inferred.genre;
  if (!song.year && inferred.year) body.year = inferred.year;
  if (Object.keys(body).length === 0) return;

  const res = await fetch(`${host}/api/v1/songs/${song.songId}/tags`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  } as any);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** 启动一轮 AI 标签补全（异步后台执行，防重入）。返回本轮将处理的歌曲数 */
export async function startAiTagging(): Promise<number> {
  if (progress.status === 'running') {
    throw new Error('上一轮补全尚未完成');
  }

  const library = await fetchLibrary();
  const targets = library
    .filter((s) => s.type === 'local' && (!s.genre || !s.year))
    .slice(0, MAX_SONGS_PER_RUN);
  if (targets.length === 0) {
    throw new Error('没有缺流派/年份的本地歌曲');
  }

  progress = { status: 'running', total: targets.length, processed: 0, success: 0, failed: 0 };

  // 不 await：后台跑批，前端轮询 getAiTagProgress
  (async () => {
    try {
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        try {
          const inferred = await inferBatch(batch);
          // 二次机会：第一轮未识别的歌用宽松提示词再推一次，至少拿到大致流派
          const misses = batch.filter((s) => !inferred.has(s.songId));
          if (misses.length > 0) {
            try {
              const retry = await inferBatch(misses, true);
              for (const [id, tags] of retry) inferred.set(id, tags);
            } catch (e) {
              songloft.log.warn(`[AI标签] 宽松重试失败: ${String(e)}`);
            }
          }
          for (const song of batch) {
            const tags = inferred.get(song.songId);
            try {
              if (tags) {
                await writeTags(song, tags);
                progress.success++;
              } else {
                progress.failed++;
                progress.lastError = 'LLM 两轮推断均无法识别该歌曲（歌名/艺术家信息不足）';
              }
            } catch (e) {
              progress.failed++;
              progress.lastError = `写入标签失败: ${String(e)}`;
              songloft.log.warn(`[AI标签] 写入失败 (${song.title}): ${String(e)}`);
            }
            progress.processed++;
          }
        } catch (e) {
          // 整批 LLM 调用失败：计入失败并继续下一批
          progress.failed += batch.length;
          progress.processed += batch.length;
          progress.lastError = `LLM 调用失败: ${String(e)}`;
          songloft.log.error(`[AI标签] 批次失败: ${String(e)}`);
        }
      }
      progress.status = 'done';
      songloft.log.info(`[AI标签] 完成: 成功 ${progress.success}，失败 ${progress.failed}`);
      // 让新标签立即在推荐/规则中生效
      invalidateLibraryCache();
    } catch (e) {
      progress.status = 'error';
      progress.error = String(e);
      songloft.log.error(`[AI标签] 异常终止: ${String(e)}`);
    }
  })();

  return targets.length;
}
