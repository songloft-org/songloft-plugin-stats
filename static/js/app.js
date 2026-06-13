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
}

function renderHistory(records) {
  const el = document.getElementById('historyList');
  if (!records.length) {
    el.innerHTML = '<li class="history-list__empty">暂无播放记录，开始听歌吧</li>';
    return;
  }
  el.innerHTML = records
    .map(
      (r) =>
        `<li>` +
        `<span class="history-list__song">${escapeHtml(r.artist)} — ${escapeHtml(r.title)}</span>` +
        `<span class="history-list__meta">${formatTime(r.timestamp)} · ${sourceLabel(r.source)}</span>` +
        `</li>`,
    )
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function loadData() {
  const daysParam = currentDays > 0 ? `?days=${currentDays}` : '';
  try {
    const [summary, history] = await Promise.all([
      apiGet('/api/stats/summary' + daysParam),
      apiGet('/api/history?limit=30'),
    ]);
    if (summary.success) renderSummary(summary.data);
    if (history.success) renderHistory(history.data.records);
  } catch (err) {
    document.getElementById('topArtists').innerHTML =
      `<li class="rank-list__empty">加载失败: ${escapeHtml(err.message)}</li>`;
  }
}

function initTabs() {
  document.querySelectorAll('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs__btn').forEach((b) => b.classList.remove('tabs__btn--active'));
      btn.classList.add('tabs__btn--active');
      currentDays = parseInt(btn.dataset.days, 10) || 0;
      loadData();
    });
  });
}

function initClear() {
  const btn = document.getElementById('clearBtn');
  btn.addEventListener('click', async () => {
    if (!confirm('确定清空所有播放记录？此操作不可恢复。')) return;
    btn.disabled = true;
    try {
      await apiDelete('/api/history');
      await loadData();
    } catch (err) {
      alert('清空失败: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initClear();
  loadData();
});
