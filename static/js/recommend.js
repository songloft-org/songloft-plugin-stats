/**
 * 智能推荐页：推荐模式、规则歌单、自动刷新、tag 插件联动
 */
import { apiGet, apiPost } from './api.js';
import { escapeHtml, pct, showDialog, showToast } from './ui.js';

// ── 智能推荐 ──────────────────────────────────────────────────────────────────

const RECOMMEND_MODE_INFO = {
  shuffle: { name: '随便听听', desc: '综合热度与时段偏好，混入少量未听过的探索曲目' },
  gems: { name: '久未听的宝藏', desc: '曾经高频播放但最近 30 天以上没听过的歌' },
  daypart: { name: '当前时段偏好', desc: '你在当前时段最常听的歌' },
  noskip: { name: '免切歌精选', desc: '切歌率最低、最耐听的歌' },
  genrefav: { name: '最爱流派', desc: '近 30 天你听得最多的流派，从中混听（依赖歌曲流派标签）' },
};

let currentRecommendMode = 'shuffle';
let recommendLoading = false;

export async function loadRecommend() {
  if (recommendLoading) return;
  recommendLoading = true;
  const regenBtn = document.getElementById('btnRegenRecommend');
  regenBtn.disabled = true;
  const list = document.getElementById('recommendList');
  const info = RECOMMEND_MODE_INFO[currentRecommendMode];
  document.getElementById('recommendTitle').textContent = info.name;
  document.getElementById('recommendDesc').textContent = info.desc;
  list.innerHTML = '<li class="history-list__empty">加载中…</li>';

  try {
    const resp = await apiGet(`/api/recommend?mode=${currentRecommendMode}&limit=30`);
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const items = resp.data.items || [];
    if (!items.length) {
      list.innerHTML = '<li class="history-list__empty">数据不足，先去听几首歌吧</li>';
      return;
    }
    list.innerHTML = items
      .map(
        (r) =>
          `<li>` +
          `<span class="history-list__song">${escapeHtml(r.artist)} — ${escapeHtml(r.title)}</span>` +
          `<span class="history-list__meta">${escapeHtml(r.reason || '')}</span>` +
          `</li>`,
      )
      .join('');
  } catch (e) {
    list.innerHTML = `<li class="history-list__empty">加载失败：${escapeHtml(String(e.message || e))}</li>`;
    showToast('推荐加载失败：' + String(e.message || e), false);
  } finally {
    recommendLoading = false;
    regenBtn.disabled = false;
  }
}

async function applyRecommend() {
  const btn = document.getElementById('btnApplyRecommend');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const resp = await apiPost('/api/recommend/apply', { mode: currentRecommendMode, limit: 30 });
    if (!resp.success) throw new Error(resp.error || '生成失败');
    const d = resp.data;
    showToast(`歌单「${d.playlistName}」已${d.created ? '创建' : '刷新'}，共 ${d.songCount} 首`);
  } catch (e) {
    showToast('生成歌单失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成歌单';
  }
}

// ── 规则歌单 ──────────────────────────────────────────────────────────────────

let facetsLoaded = false;

/** 标签数据变更后调用，下次进入规则页会重新拉取分面 */
export function invalidateFacets() {
  facetsLoaded = false;
}

export async function loadRuleFacets() {
  if (facetsLoaded) return;
  try {
    const resp = await apiGet('/api/recommend/facets');
    if (!resp.success) return;
    const sel = document.getElementById('ruleGenreSelect');
    const hint = document.getElementById('ruleGenreHint');
    const genres = resp.data.genres || [];
    sel.innerHTML =
      '<option value="">不限</option>' +
      genres.map((g) => `<option value="${escapeHtml(g.genre)}">${escapeHtml(g.genre)}（${g.count} 首）</option>`).join('');
    // 曲库没有任何流派标签时，下拉框只剩「不限」，需告知用户原因和解决办法
    if (hint) {
      if (genres.length === 0) {
        hint.textContent = '曲库中没有歌曲带流派标签，暂无可选项。可通过上方「曲库标签质量」一键补全，或安装标签刮削插件后重试。';
        hint.style.display = '';
      } else {
        hint.style.display = 'none';
      }
    }
    facetsLoaded = true;
  } catch (e) {
    // 分面加载失败不影响其他功能
  }
}

export function describeRuleUi(rule) {
  const parts = [];
  if (rule.genre) parts.push(`流派=${rule.genre}`);
  if (rule.artist) parts.push(`艺术家含“${rule.artist}”`);
  if (rule.album) parts.push(`专辑含“${rule.album}”`);
  if (rule.onlyFavorite) parts.push('仅收藏');
  if (rule.yearFrom || rule.yearTo) parts.push(`年份 ${rule.yearFrom || '…'}~${rule.yearTo || '…'}`);
  if (rule.minPlays) parts.push(`播放≥${rule.minPlays}次`);
  if (rule.notPlayedDays) parts.push(`${rule.notPlayedDays}天未听`);
  parts.push(`${rule.size || 50} 首`);
  return parts.join('，');
}

export async function loadRules() {
  const container = document.getElementById('ruleList');
  try {
    const resp = await apiGet('/api/recommend/rules');
    if (!resp.success) throw new Error(resp.error || '加载失败');
    const rules = resp.data || [];
    if (!rules.length) {
      container.innerHTML = '<p class="form-desc">暂无规则</p>';
      return;
    }
    container.innerHTML = rules
      .map(
        (r) =>
          `<div class="backup-server-item">
            <div class="backup-server-info">
              <div class="backup-server-name">${escapeHtml(r.name)}</div>
              <div class="backup-server-url">${escapeHtml(describeRuleUi(r))}</div>
            </div>
            <button class="btn-text rule-apply" data-id="${escapeHtml(r.id)}" style="font-size:0.8rem;padding:4px 8px;">生成</button>
            <button class="btn-text rule-delete" data-id="${escapeHtml(r.id)}" style="color:var(--md-error);font-size:0.8rem;padding:4px 8px;">删除</button>
          </div>`,
      )
      .join('');

    container.querySelectorAll('.rule-apply').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '生成中…';
        try {
          const resp2 = await apiPost('/api/recommend/rules/apply', { id: btn.dataset.id });
          if (!resp2.success) throw new Error(resp2.error || '生成失败');
          const d = resp2.data;
          showToast(`歌单「${d.playlistName}」已${d.created ? '创建' : '刷新'}，共 ${d.songCount} 首`);
        } catch (e) {
          showToast('生成失败：' + String(e.message || e), false);
        } finally {
          btn.disabled = false;
          btn.textContent = '生成';
        }
      });
    });

    container.querySelectorAll('.rule-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const confirmed = await showDialog('确认删除', '确定要删除该规则吗？已生成的歌单不会被删除。', '删除', '取消');
        if (!confirmed) return;
        try {
          await apiPost('/api/recommend/rules', { action: 'delete', id: btn.dataset.id });
          showToast('已删除规则');
          loadRules();
        } catch (e) {
          showToast('删除失败：' + String(e.message || e), false);
        }
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="form-desc">加载失败：${escapeHtml(String(e.message || e))}</p>`;
  }
}

async function saveRule() {
  const btn = document.getElementById('btnSaveRule');
  const rule = {
    name: document.getElementById('ruleNameInput').value,
    genre: document.getElementById('ruleGenreSelect').value,
    artist: document.getElementById('ruleArtistInput').value,
    album: document.getElementById('ruleAlbumInput').value,
    onlyFavorite: document.getElementById('ruleOnlyFavoriteCheck').checked,
    yearFrom: parseInt(document.getElementById('ruleYearFromInput').value) || 0,
    yearTo: parseInt(document.getElementById('ruleYearToInput').value) || 0,
    minPlays: parseInt(document.getElementById('ruleMinPlaysInput').value) || 0,
    notPlayedDays: parseInt(document.getElementById('ruleNotPlayedDaysInput').value) || 0,
    size: parseInt(document.getElementById('ruleSizeInput').value) || 0,
  };
  if (!rule.name.trim()) {
    showToast('请填写歌单名称', false);
    return;
  }
  btn.disabled = true;
  try {
    const resp = await apiPost('/api/recommend/rules', { rule });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    showToast('规则已保存');
    document.getElementById('ruleNameInput').value = '';
    loadRules();
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

// ── 自动刷新设置 ───────────────────────────────────────────────────────────

const REC_MODE_CHECKS = {
  shuffle: 'recModeShuffleCheck',
  gems: 'recModeGemsCheck',
  daypart: 'recModeDaypartCheck',
  noskip: 'recModeNoskipCheck',
  genrefav: 'recModeGenrefavCheck',
};

export async function loadRecSchedule() {
  try {
    const resp = await apiGet('/api/recommend/schedule');
    if (!resp.success) return;
    const s = resp.data;
    document.getElementById('recScheduleEnabledCheck').checked = !!s.enabled;
    document.getElementById('recScheduleHourInput').value = s.hour;
    document.getElementById('recScheduleMinuteInput').value = s.minute;
    for (const [mode, id] of Object.entries(REC_MODE_CHECKS)) {
      document.getElementById(id).checked = (s.modes || []).includes(mode);
    }
    document.getElementById('recRefreshRulesCheck').checked = !!s.refreshRules;
  } catch (e) {
    // 忽略，保持默认值
  }
}

async function saveRecSchedule() {
  const btn = document.getElementById('btnSaveRecSchedule');
  const hour = parseInt(document.getElementById('recScheduleHourInput').value);
  const minute = parseInt(document.getElementById('recScheduleMinuteInput').value);
  if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
    showToast('请填写有效的刷新时间', false);
    return;
  }
  const modes = Object.entries(REC_MODE_CHECKS)
    .filter(([, id]) => document.getElementById(id).checked)
    .map(([mode]) => mode);
  btn.disabled = true;
  try {
    const resp = await apiPost('/api/recommend/schedule', {
      enabled: document.getElementById('recScheduleEnabledCheck').checked,
      hour,
      minute,
      modes,
      refreshRules: document.getElementById('recRefreshRulesCheck').checked,
    });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    showToast('自动刷新设置已保存');
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

async function refreshRecommendNow() {
  const btn = document.getElementById('btnRefreshNow');
  btn.disabled = true;
  btn.textContent = '刷新中…';
  try {
    const resp = await apiPost('/api/recommend/refresh', {});
    if (!resp.success) throw new Error(resp.error || '刷新失败');
    const d = resp.data;
    if (d.refreshed.length === 0 && d.failed.length === 0) {
      showToast('没有需要刷新的歌单，请先勾选刷新内容并保存', false);
    } else if (d.failed.length === 0) {
      showToast(`已刷新 ${d.refreshed.length} 个歌单`);
    } else {
      showToast(`刷新完成：成功 ${d.refreshed.length}，失败 ${d.failed.length}`, false);
    }
  } catch (e) {
    showToast('刷新失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '立即刷新一次';
  }
}

// ── 标签刮削插件联动 ────────────────────────────────────────────────────────────

let tagProgressTimer = null;

export async function loadTagStatus() {
  const card = document.getElementById('tagLinkageCard');
  try {
    const resp = await apiGet('/api/linkage/tag/status');
    if (!resp.success) throw new Error(resp.error || '检测失败');
    const s = resp.data;
    if (!s.installed) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const gp = pct(s.genreCovered, s.total);
    const yp = pct(s.yearCovered, s.total);
    document.getElementById('tagCoverageInfo').textContent =
      `共 ${s.total} 首：流派标签 ${gp}%（${s.genreCovered} 首），年份标签 ${yp}%（${s.yearCovered} 首）` +
      (gp < 60 || yp < 60 ? '，建议补全后再用规则歌单' : '');
  } catch (e) {
    // tag 插件不可用时隐藏卡片，不打扰用户
    card.style.display = 'none';
  }
}

async function startTagScrape() {
  const btn = document.getElementById('btnTagScrape');
  btn.disabled = true;
  btn.textContent = '启动中…';
  try {
    const resp = await apiPost('/api/linkage/tag/scrape', {});
    if (!resp.success) throw new Error(resp.error || '启动失败');
    const d = resp.data;
    if (!d.taskId) {
      showToast(d.message || '没有需要刮削的新歌曲');
      btn.disabled = false;
      btn.textContent = '一键补全标签';
      return;
    }
    showToast(`已启动刮削，共 ${d.total} 首`);
    btn.textContent = '刮削中…';
    pollTagProgress(d.taskId);
  } catch (e) {
    showToast('启动刮削失败：' + String(e.message || e), false);
    btn.disabled = false;
    btn.textContent = '一键补全标签';
  }
}

function pollTagProgress(taskId) {
  const progressEl = document.getElementById('tagScrapeProgress');
  const btn = document.getElementById('btnTagScrape');
  progressEl.style.display = '';
  clearInterval(tagProgressTimer);

  tagProgressTimer = setInterval(async () => {
    try {
      const resp = await apiGet(`/api/linkage/tag/progress?taskId=${encodeURIComponent(taskId)}`);
      if (!resp.success) throw new Error(resp.error || '查询失败');
      const p = resp.data;
      progressEl.textContent = `刮削进度：${p.current}/${p.total}（成功 ${p.success}，跳过 ${p.skipped}，失败 ${p.failed}）`;
      if (p.status === 'done') {
        clearInterval(tagProgressTimer);
        tagProgressTimer = null;
        progressEl.textContent += ' — 已完成';
        showToast(`刮削完成：成功 ${p.success}，失败 ${p.failed}`);
        btn.disabled = false;
        btn.textContent = '一键补全标签';
        // 标签已更新，刷新覆盖率与流派下拉框
        invalidateFacets();
        loadTagStatus();
        loadRuleFacets();
      }
    } catch (e) {
      clearInterval(tagProgressTimer);
      tagProgressTimer = null;
      progressEl.textContent = '进度查询失败：' + String(e.message || e);
      btn.disabled = false;
      btn.textContent = '一键补全标签';
    }
  }, 3000);
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

export function initRecommend() {
  document.getElementById('recommendModeTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    currentRecommendMode = tab.dataset.mode;
    document.querySelectorAll('#recommendModeTabs .tab').forEach((t) => {
      t.classList.toggle('tab--active', t.dataset.mode === currentRecommendMode);
    });
    loadRecommend();
  });
  document.getElementById('btnRegenRecommend').addEventListener('click', loadRecommend);
  document.getElementById('btnApplyRecommend').addEventListener('click', applyRecommend);
  document.getElementById('btnSaveRule').addEventListener('click', saveRule);
  document.getElementById('btnSaveRecSchedule').addEventListener('click', saveRecSchedule);
  document.getElementById('btnRefreshNow').addEventListener('click', refreshRecommendNow);
  document.getElementById('btnTagScrape').addEventListener('click', startTagScrape);
}
