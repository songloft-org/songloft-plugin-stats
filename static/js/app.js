/**
 * 播放统计 — 前端入口
 * SongloftPlugin 由主程序自动注入
 */
const { apiGet, apiDelete } = SongloftPlugin;

const SOURCE_LABELS = {
  'songloft-player': '客户端',
  miot: '智能音箱',
  unknown: '未知',
};

let currentDays = 0;
let historyOffset = 0;
const HISTORY_PAGE_SIZE = 30;
let historyTotal = 0;
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
  document.getElementById('trendChart').innerHTML =
    `<div class="trend-chart__empty">加载失败: ${errMsg}</div>`;
}

// ── 渲染函数 ──────────────────────────────────────────────────────────────────

function renderTrend(data) {
  const container = document.getElementById('trendChart');
  if (!data || !data.length) {
    container.innerHTML = '<div class="trend-chart__empty">暂无趋势数据</div>';
    return;
  }

  const maxPlays = Math.max(1, ...data.map((d) => d.plays));
  const svgWidth = 680;
  const svgHeight = 140;
  const padTop = 10;
  const padBottom = 24;
  const padLeft = 4;
  const padRight = 4;
  const chartH = svgHeight - padTop - padBottom;
  const barCount = data.length;
  const gap = 2;
  const barW = Math.max(2, (svgWidth - padLeft - padRight - gap * (barCount - 1)) / barCount);

  let svg = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet">`;

  // 网格线（3条水平线）
  for (let i = 1; i <= 3; i++) {
    const y = padTop + chartH - (chartH * i) / 3;
    svg += `<line class="trend-gridline" x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" />`;
  }

  // 柱子 + 日期标签
  data.forEach((d, i) => {
    const x = padLeft + i * (barW + gap);
    const h = d.plays > 0 ? Math.max(3, (d.plays / maxPlays) * chartH) : 0;
    const y = padTop + chartH - h;
    svg += `<rect class="trend-bar" x="${x}" y="${y}" width="${barW}" height="${h}" data-date="${d.date}" data-plays="${d.plays}" data-dur="${d.durationSec}" />`;

    // 每隔几天显示一次标签，避免拥挤
    const labelInterval = barCount <= 14 ? 1 : barCount <= 31 ? 3 : 7;
    if (i % labelInterval === 0 || i === barCount - 1) {
      svg += `<text class="trend-label" x="${x + barW / 2}" y="${svgHeight - 4}">${d.date}</text>`;
    }
  });

  svg += '</svg>';
  svg += '<div class="trend-tooltip" id="trendTooltip"></div>';
  container.innerHTML = svg;

  // Tooltip 交互
  const tooltip = document.getElementById('trendTooltip');
  container.querySelectorAll('.trend-bar').forEach((bar) => {
    bar.addEventListener('mouseenter', (e) => {
      const date = bar.getAttribute('data-date');
      const plays = bar.getAttribute('data-plays');
      const dur = formatDuration(parseInt(bar.getAttribute('data-dur'), 10));
      tooltip.textContent = `${date}  ${plays} 次播放  ${dur}`;
      tooltip.classList.add('visible');
    });
    bar.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 8) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 36) + 'px';
    });
    bar.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  });
}

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

function renderHistory(records, append) {
  const el = document.getElementById('historyList');
  if (!records.length && !append) {
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
  if (append) {
    // 移除“加载更多”按钮再追加
    const loadMore = el.querySelector('.load-more');
    if (loadMore) loadMore.remove();
    el.insertAdjacentHTML('beforeend', html);
  } else {
    el.innerHTML = html;
  }
  // 如果还有更多记录，显示“加载更多”
  if (historyOffset < historyTotal) {
    el.insertAdjacentHTML(
      'beforeend',
      `<li class="load-more"><button class="btn-text" id="loadMoreBtn" type="button">加载更多</button></li>`,
    );
    document.getElementById('loadMoreBtn').addEventListener('click', loadMoreHistory);
  }
}

// ── 数据请求 ──────────────────────────────────────────────────────────────────

async function loadData() {
  if (isLoading) return;
  setLoading(true);
  historyOffset = 0;
  const daysParam = currentDays > 0 ? `?days=${currentDays}` : '';
  // 趋势图默认 30 天，选“全部”时显示 30 天趋势
  const trendDays = currentDays > 0 ? currentDays : 30;
  try {
    const [summary, history, trend] = await Promise.all([
      apiGet('/api/stats/summary' + daysParam),
      apiGet(`/api/history?limit=${HISTORY_PAGE_SIZE}&offset=0`),
      apiGet(`/api/stats/trend?days=${trendDays}`),
    ]);
    if (summary.success) renderSummary(summary.data);
    if (history.success) {
      historyTotal = history.data.total;
      historyOffset = history.data.records.length;
      renderHistory(history.data.records, false);
    }
    if (trend.success) renderTrend(trend.data);
  } catch (err) {
    showError(err.message || '未知错误');
  } finally {
    setLoading(false);
  }
}

async function loadMoreHistory() {
  if (isLoading || historyOffset >= historyTotal) return;
  try {
    const res = await apiGet(`/api/history?limit=${HISTORY_PAGE_SIZE}&offset=${historyOffset}`);
    if (res.success) {
      historyOffset += res.data.records.length;
      renderHistory(res.data.records, true);
    }
  } catch (err) {
    showToast('加载更多失败: ' + (err.message || '未知错误'));
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

function initClear() {
  const btn = document.getElementById('clearBtn');
  btn.addEventListener('click', async () => {
    const confirmed = await openDialog({
      title: '清空播放记录',
      body: '确定清空所有播放记录？此操作不可恢复。',
      confirmText: '清空',
      danger: true,
    });
    if (!confirmed) return;
    btn.disabled = true;
    try {
      await apiDelete('/api/history', { body: JSON.stringify({ confirm: true }) });
      await loadData();
      showToast('已清空所有播放记录');
    } catch (err) {
      showToast('清空失败: ' + (err.message || '未知错误'));
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDialog();
  initTabs();
  initClear();
  loadData();
});
