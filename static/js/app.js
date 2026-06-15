/**
 * 播放统计 — 前端入口
 * SongloftPlugin 由主程序自动注入
 */
const { apiGet } = SongloftPlugin;

const SOURCE_LABELS = {
  'songloft-player': '客户端',
  miot: '智能音箱',
  unknown: '未知',
};

let currentDays = 0;
const HISTORY_LIMIT = 5; // 固定显示最近 5 条记录
let isLoading = false;
let debounceTimer = null;

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatDuration(sec) {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${sec} 秒`;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `今天 ${time}`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
}

function sourceLabel(src) {
  return SOURCE_LABELS[src] || src || '未知';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── 自定义弹窗 / Toast ──────────────────────────────────────────────────────────

let dialogResolve = null;

function openDialog({ title, body, confirmText = '确定', cancelText = '取消', danger = false }) {
  const overlay = document.getElementById('dialogOverlay');
  const confirmBtn = document.getElementById('dialogConfirm');
  const cancelBtn = document.getElementById('dialogCancel');

  document.getElementById('dialogTitle').textContent = title;
  document.getElementById('dialogBody').textContent = body;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  confirmBtn.classList.toggle('dialog__btn--danger', danger);

  overlay.classList.add('open');

  return new Promise((resolve) => {
    dialogResolve = resolve;
  });
}

function closeDialog(result) {
  const overlay = document.getElementById('dialogOverlay');
  overlay.classList.remove('open');
  if (dialogResolve) {
    dialogResolve(result);
    dialogResolve = null;
  }
}

let toastTimer = null;

function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function initDialog() {
  document.getElementById('dialogConfirm').addEventListener('click', () => closeDialog(true));
  document.getElementById('dialogCancel').addEventListener('click', () => closeDialog(false));
  // 点击遮罩关闭
  document.getElementById('dialogOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDialog(false);
  });
}

// ── 加载状态 ──────────────────────────────────────────────────────────────────

function setLoading(loading) {
  isLoading = loading;
  document.getElementById('summaryCards').classList.toggle('loading', loading);
}

function showError(message) {
  const errMsg = escapeHtml(message);
  document.getElementById('topArtists').innerHTML =
    `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('topSongs').innerHTML =
    `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('sourceList').innerHTML =
    `<li class="rank-list__empty">加载失败: ${errMsg}</li>`;
  document.getElementById('historyList').innerHTML =
    `<li class="history-list__empty">加载失败: ${errMsg}</li>`;
}

// ── 渲染函数 ──────────────────────────────────────────────────────────────────

function renderSummary(data) {
  document.getElementById('totalPlays').textContent = String(data.totalPlays);
  document.getElementById('totalDuration').textContent = formatDuration(data.totalDurationSec);
  document.getElementById('uniqueSongs').textContent = String(data.uniqueSongs);
  document.getElementById('uniqueArtists').textContent = String(data.uniqueArtists);

  const artistEl = document.getElementById('topArtists');
  if (!data.topArtists.length) {
    artistEl.innerHTML = '<li class="rank-list__empty">暂无数据</li>';
  } else {
    artistEl.innerHTML = data.topArtists
      .map(
        (a) =>
          `<li><span class="rank-list__name">${escapeHtml(a.artist)}</span>` +
          `<span class="rank-list__count">${a.plays} 次</span></li>`,
      )
      .join('');
  }

  const songEl = document.getElementById('topSongs');
  if (!data.topSongs.length) {
    songEl.innerHTML = '<li class="rank-list__empty">暂无数据</li>';
  } else {
    songEl.innerHTML = data.topSongs
      .map(
        (s) =>
          `<li><span class="rank-list__name">${escapeHtml(s.title)}` +
          `<span style="color:var(--md-on-surface-variant);font-weight:400"> · ${escapeHtml(s.artist)}</span></span>` +
          `<span class="rank-list__count">${s.plays} 次</span></li>`,
      )
      .join('');
  }

  // 来源分布
  renderBySource(data.bySource);
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

function renderHistory(records) {
  const el = document.getElementById('historyList');
  if (!records.length) {
    el.innerHTML = '<li class="history-list__empty">暂无播放记录，开始听歌吧</li>';
    return;
  }
  const html = records
    .map(
      (r) =>
        `<li>` +
        `<span class="history-list__song">${escapeHtml(r.artist)} — ${escapeHtml(r.title)}</span>` +
        `<span class="history-list__meta">${formatTime(r.timestamp)} · ${sourceLabel(r.source)}</span>` +
        `</li>`,
    )
    .join('');
  el.innerHTML = html;
}

// ── 数据请求 ──────────────────────────────────────────────────────────────────

async function loadData() {
  if (isLoading) return;
  setLoading(true);
  const daysParam = currentDays > 0 ? `?days=${currentDays}` : '';
  try {
    const [summary, history] = await Promise.all([
      apiGet('/api/stats/summary' + daysParam),
      apiGet(`/api/history?limit=${HISTORY_LIMIT}&offset=0`),
    ]);
    if (summary.success) renderSummary(summary.data);
    if (history.success) {
      renderHistory(history.data.records);
    }
  } catch (err) {
    showError(err.message || '未知错误');
  } finally {
    setLoading(false);
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs__btn').forEach((b) => {
        b.classList.remove('tabs__btn--active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('tabs__btn--active');
      btn.setAttribute('aria-selected', 'true');
      currentDays = parseInt(btn.dataset.days, 10) || 0;
      // debounce 200ms
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadData, 200);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDialog();
  initTabs();
  loadData();
});
