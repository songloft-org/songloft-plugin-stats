/// <reference types="@songloft/plugin-sdk" />
// 与「标签刮削」插件(entryPath: tag)的联动:
// 规则歌单/探索推荐依赖 genre/year 标签,tag 插件负责补全这些标签。
// tag 未实现 comm handler,通过宿主转发的 HTTP 路由联动。
import { fetchLibrary, invalidateLibraryCache } from './profile';

const TAG_ENTRY = 'tag';

/** fetch 初始化参数（tsconfig 未引入 DOM lib，自定义精简版）*/
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** 调用 tag 插件的 HTTP 路由(经宿主转发,带插件 token 认证) */
async function tagFetch(path: string, init?: FetchInit): Promise<any> {
  const [host, token] = await Promise.all([songloft.plugin.getHostUrl(), songloft.plugin.getToken()]);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${host}/api/v1/jsplugin/${TAG_ENTRY}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, init as any);
  if (!res.ok) {
    throw new Error(`tag 插件响应 HTTP ${res.status}`);
  }
  return res.json();
}

export interface TagLinkageStatus {
  /** tag 插件是否已安装且在运行 */
  installed: boolean;
  /** 曲库总数(不含电台) */
  total: number;
  /** 有流派标签的歌曲数 */
  genreCovered: number;
  /** 有年份标签的歌曲数 */
  yearCovered: number;
}

/** 标签覆盖率 + tag 插件可用性检测 */
export async function getTagStatus(): Promise<TagLinkageStatus> {
  const library = await fetchLibrary();
  let genreCovered = 0;
  let yearCovered = 0;
  for (const s of library) {
    if (s.genre) genreCovered++;
    if (s.year) yearCovered++;
  }

  let installed = false;
  try {
    await tagFetch('/config');
    installed = true;
  } catch {
    // 插件未安装/未启用/加载失败,均视为不可联动
  }

  return { installed, total: library.length, genreCovered, yearCovered };
}

/** 触发 tag 插件增量刮削,返回 { taskId, total } 或 { count: 0 }(无新歌) */
export async function triggerTagScrape(): Promise<{ taskId?: string; total?: number; message?: string }> {
  const data = await tagFetch('/scrape/incremental', { method: 'POST', body: '{}' });
  if (data && data.error) {
    throw new Error(String(data.error));
  }
  return data;
}

/** 查询刮削进度;任务完成时顺带失效曲库缓存,让新标签立即生效 */
export async function getTagScrapeProgress(taskId: string): Promise<{
  status: string;
  current: number;
  total: number;
  success: number;
  skipped: number;
  failed: number;
}> {
  const data = await tagFetch(`/scrape/batch/progress?taskId=${encodeURIComponent(taskId)}`);
  if (data && data.error) {
    throw new Error(String(data.error));
  }
  if (data.status === 'done') {
    invalidateLibraryCache();
  }
  return {
    status: data.status,
    current: data.current || 0,
    total: data.total || 0,
    success: data.success || 0,
    skipped: data.skipped || 0,
    failed: data.failed || 0,
  };
}
