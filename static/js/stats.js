/**
 * 统计页：概览、趋势图、时段分布、播放历史
 */
import { apiGet } from './api.js';
import { escapeHtml, formatDuration, formatTime, mediaLabel, sourceLabel } from './ui.js';

// ── 状态 ──────────────────────────────────────────────────────────────────────

let currentRange = 'all';
let historyOffset = 0;
let currentTrendDays = 7;
const HISTORY_PAGE_SIZE = 20;

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function getTimeRange(rangeKey) {
  if (rangeKey === 'all') return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400000;
  if (rangeKey === 'today') return { from: todayStart, to: todayEnd };

  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(todayStart);
  monday.setDate(monday.getDate() + mondayOffset);
  const mondayStart = monday.getTime();

  if (rangeKey === 'week') return { from: mondayStart, to: todayEnd };

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (rangeKey === 'month') return { from: monthStart, to: todayEnd };

  return null;
}

// ── 加载/错误状态 ─────────────────────────────────────────────────────────────

export function showLoading() {
  document.getElementById('totalPlays').innerHTML = '<span class="skeleton-text skeleton-text--sm"></span>';
  document.getElementById('totalDuration').innerHTML = '<span class="skeleton-text skeleton-text--sm"></span>';
  document.getElementById('uniqueSongs').innerHTML = '<span class="skeleton-text skeleton-text--sm"></span>';
  document.getElementById('uniqueArtists').innerHTML = '<span class="skeleton-text skeleton-text--sm"></span>';
  const skeletonItems = (n) => Array.from({length: n}, () =>
    '<li class="rank-list__skeleton"><span class="skeleton-text skeleton-text--lg"></span><span class="skeleton-text skeleton-text--sm"></span></li>'
  ).join('');
  document.getElementById('topArtists').innerHTML = skeletonItems(5);
  document.getElementById('topSongs').innerHTML = skeletonItems(5);
  document.getElementById('topAlbums').innerHTML = skeletonItems(5);
  document.getElementById('sourceList').innerHTML = skeletonItems(3);
  document.getElementById('trendChart').innerHTML = '<div class="bar-chart__empty">加载中…</div>';
  document.getElementById('hourlyDist').innerHTML = '<div class="hourly-dist__empty">加载中…</div>';
  const historyEl = document.getElementById('historyList');
  if (!historyEl.dataset.append) {
    historyEl.innerHTML = skeletonItems(3);
  }
}

function showError(message) {
  const errMsg = escapeHtml(message);
  document.getElementById('totalPlays').textContent = '—';
  document.getElementById('totalDuration').textContent = '—';
  document.getElementById('uniqueSongs').textContent = '—';
  document.getElementById('uniqueArtists').textContent = '—';
  document.getElementById('topArtists').innerHTML = `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('topSongs').innerHTML = `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('topAlbums').innerHTML = `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('sourceList').innerHTML = `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('historyList').innerHTML = `<li class="history-list__empty">加载失败: ${errMsg}</li>`;
}

// ── 趋势图与时段分布 ──────────────────────────────────────────────────────────

function renderTrends(data) {
  const el = document.getElementById('trendChart');
  if (!data.length) {
    el.innerHTML = '<div class="bar-chart__empty">暂无数据</div>';
    return;
  }
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  el.innerHTML = data
    .map((d) => {
      const height = Math.max(2, Math.round((d.count / maxCount) * 100));
      const barClass = d.count === 0 ? 'bar-column__bar bar-column__bar--empty' : 'bar-column__bar';
      return `<div class="bar-column">` +
        `<span class="bar-column__count">${d.count || ''}</span>` +
        `<div class="${barClass}" style="height:${height}px"></div>` +
        `<span class="bar-column__label">${d.date}</span>` +
        `</div>`;
    })
    .join('');
}

function renderHourly(data) {
  const el = document.getElementById('hourlyDist');
  if (!data.length) {
    el.innerHTML = '<div class="hourly-dist__empty">暂无数据</div>';
    return;
  }
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  el.innerHTML = data
    .map((d) => {
      const pct = Math.round((d.count / total) * 100);
      return `<div class="hourly-row">` +
        `<span class="hourly-row__label">${d.label}</span>` +
        `<div class="hourly-row__track"><div class="hourly-row__fill" style="width:${pct}%"></div></div>` +
        `<span class="hourly-row__count">${d.count}首</span>` +
        `</div>`;
    })
    .join('');
}

async function loadTrends() {
  try {
    const resp = await apiGet(`/api/stats/trends?days=${currentTrendDays}`);
    if (resp.success) renderTrends(resp.data);
  } catch {
    document.getElementById('trendChart').innerHTML = '<div class="bar-chart__empty">加载失败</div>';
  }
}

async function loadHourly() {
  try {
    const resp = await apiGet('/api/stats/hourly');
    if (resp.success) renderHourly(resp.data);
  } catch {
    document.getElementById('hourlyDist').innerHTML = '<div class="hourly-dist__empty">加载失败</div>';
  }
}

function switchTrendDays(days) {
  if (currentTrendDays === days) return;
  currentTrendDays = days;
  document.querySelectorAll('.btn-range').forEach((b) => {
    b.classList.toggle('btn-range--active', parseInt(b.dataset.trendDays) === days);
  });
  loadTrends();
}

// ── 渲染函数 ──────────────────────────────────────────────────────────────────

function renderSummary(data) {
  document.getElementById('totalPlays').textContent = String(data.totalPlays);
  document.getElementById('totalDuration').textContent = formatDuration(data.totalDurationSec);
  document.getElementById('uniqueSongs').textContent = String(data.uniqueSongs);
  document.getElementById('uniqueArtists').textContent = String(data.uniqueArtists);

  function rankList(elId, items, nameFn, countFn) {
    const el = document.getElementById(elId);
    if (!items.length) {
      el.innerHTML = '<li class="rank-list__empty">暂无数据</li>';
      return;
    }
    el.innerHTML = items
      .map((item) =>
        `<li><span class="rank-list__name">${nameFn(item)}</span>` +
        `<span class="rank-list__count">${countFn(item)}</span></li>`
      )
      .join('');
  }

  rankList('topArtists', data.topArtists || [],
    (a) => escapeHtml(a.artist), (a) => `${a.plays} 次`);

  rankList('topSongs', data.topSongs || [],
    (s) => `${escapeHtml(s.title)}<span style="color:var(--md-on-surface-variant);font-weight:400"> · ${escapeHtml(s.artist)}</span>`,
    (s) => `${s.plays} 次`);

  rankList('topAlbums', data.topAlbums || [],
    (a) => escapeHtml(a.album), (a) => `${a.plays} 次`);

  renderBySource(data.bySource);
  renderMediaType(data.byMediaType);
}

function renderBySource(bySource) {
  const el = document.getElementById('sourceList');
  if (!el) return;
  const entries = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    el.innerHTML = '<li class="rank-list__empty">暂无数据</li>';
    return;
  }
  el.innerHTML = entries
    .map(
      ([src, count]) =>
        `<li><span class="rank-list__name">${escapeHtml(sourceLabel(src))}</span>` +
        `<span class="rank-list__count">${count} 次</span></li>`,
    )
    .join('');
}

function renderMediaType(byMediaType) {
  const el = document.getElementById('mediaTypeList');
  if (!el) return;
  const raw = byMediaType || {};
  // 分别展示：本地 = local；网络 = remote；电台 = radio；未知单独计
  const merged = {};
  if (raw['local']) merged['本地'] = raw['local'];
  if (raw['remote']) merged['网络'] = raw['remote'];
  if (raw['radio']) merged['电台'] = raw['radio'];
  if (raw['unknown']) merged['未知'] = raw['unknown'];
  const entries = Object.entries(merged).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    el.innerHTML = '<li class="rank-list__empty">暂无数据</li>';
    return;
  }
  el.innerHTML = entries
    .map(
      ([label, count]) =>
        `<li><span class="rank-list__name">${escapeHtml(label)}</span>` +
        `<span class="rank-list__count">${count} 次</span></li>`,
    )
    .join('');
}

function renderHistory(records, append) {
  const el = document.getElementById('historyList');
  if (!append) {
    if (!records.length) {
      el.innerHTML = '<li class="history-list__empty">暂无播放记录，开始听歌吧</li>';
      return;
    }
    el.innerHTML = '';
  }
  const html = records
    .map(
      (r) =>
        `<li>` +
        `<span class="history-list__song">${escapeHtml(r.artist)} — ${escapeHtml(r.title)}</span>` +
        `<span class="history-list__meta">${formatTime(r.timestamp)} · ${mediaLabel(r.type)} · ${sourceLabel(r.source)}</span>` +
        `</li>`,
    )
    .join('');
  el.insertAdjacentHTML('beforeend', html);
}

// ── 历史分页 ──────────────────────────────────────────────────────────────────

let isLoadingMore = false;

async function loadMoreHistory() {
  if (isLoadingMore) return;
  isLoadingMore = true;
  const btn = document.getElementById('btnLoadMore');
  btn.disabled = true;
  btn.textContent = '加载中…';

  try {
    const offset = historyOffset + HISTORY_PAGE_SIZE;
    const resp = await apiGet(`/api/history/raw?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`);
    if (resp.success) {
      renderHistory(resp.data.records, true);
      historyOffset = offset;
      if (!resp.data.hasMore) {
        document.getElementById('historyFooter').style.display = 'none';
      }
    }
  } catch (err) {
    btn.textContent = '加载失败，重试';
  } finally {
    isLoadingMore = false;
    btn.disabled = false;
    if (btn.textContent === '加载中…') btn.textContent = '加载更多';
  }
}

// ── 数据请求 ──────────────────────────────────────────────────────────────────

export async function loadData(range, isInitial) {
  if (!isInitial) showLoading();
  const tr = getTimeRange(range);
  const summaryUrl = tr
    ? `/api/stats/summary?from=${tr.from}&to=${tr.to}`
    : '/api/stats/summary';

  try {
    const [summary, history] = await Promise.all([
      apiGet(summaryUrl),
      apiGet(`/api/history/raw?limit=${HISTORY_PAGE_SIZE}&offset=0`),
    ]);
    if (summary.success) renderSummary(summary.data);
    if (history.success) {
      renderHistory(history.data.records, false);
      historyOffset = 0;
      const footer = document.getElementById('historyFooter');
      if (history.data.hasMore) {
        footer.style.display = '';
      } else {
        footer.style.display = 'none';
      }
    }
    // 趋势和时段：首次加载时获取，后续轮询也被动刷新
    loadTrends();
    loadHourly();
  } catch (err) {
    showError(err.message || '未知错误');
  }
}

// ── Tab 切换 ──────────────────────────────────────────────────────────────────

function switchTab(range) {
  if (currentRange === range) return;
  currentRange = range;
  document.querySelectorAll('#timeTabs .tab').forEach((t) => {
    t.classList.toggle('tab--active', t.dataset.range === range);
  });
  document.getElementById('historyList').removeAttribute('data-append');
  loadData(range, false);
}

/** 刷新统计 Tab 数据（无论当前是否在统计页都会预加载） */
export function refreshStatsTab() {
  // 清空历史列表，避免残留旧数据
  document.getElementById('historyList').innerHTML = '<li class="history-list__empty">加载中…</li>';
  document.getElementById('historyList').removeAttribute('data-append');
  historyOffset = 0;
  document.getElementById('historyFooter').style.display = 'none';
  // 无论当前是否在统计 Tab 都刷新，切回来时自动显示最新数据
  loadData(currentRange, false);
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

export function initStats() {
  showLoading();
  loadData('all', true);

  // 顶部刷新按钮
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshStatsTab());

  // 时间 Tab 点击
  document.getElementById('timeTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.range);
  });

  // 趋势天数切换
  document.querySelector('.trends-controls').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-range');
    if (!btn) return;
    switchTrendDays(parseInt(btn.dataset.trendDays));
  });

  // 加载更多
  document.getElementById('btnLoadMore').addEventListener('click', loadMoreHistory);

  // 60 秒轮询
  let timer = setInterval(() => loadData(currentRange, false), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadData(currentRange, false);
      timer = setInterval(() => loadData(currentRange, false), 60_000);
    } else {
      clearInterval(timer);
    }
  });
}
