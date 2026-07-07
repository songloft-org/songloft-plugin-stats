/**
 * 播放统计 — 前端入口
 * SongloftPlugin 由主程序自动注入
 */
const apiGet = (typeof SongloftPlugin !== 'undefined' && SongloftPlugin.apiGet)
  ? SongloftPlugin.apiGet
  : async (url) => (await fetch(url)).json();

const apiPost = (typeof SongloftPlugin !== 'undefined' && SongloftPlugin.apiPost)
  ? SongloftPlugin.apiPost
  : async (url, data) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return resp.json();
    };

// ── Dialog ────────────────────────────────────────────────────────────────────
let dialogResolve = null;

function showDialog(title, content, confirmText = '确定', cancelText = '取消') {
  return new Promise((resolve) => {
    dialogResolve = resolve;

    const dialogTitle = document.getElementById('dialogTitle');
    const dialogContent = document.getElementById('dialogContent');
    const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');
    const dialogCancelBtn = document.getElementById('dialogCancelBtn');
    const dialogOverlay = document.getElementById('dialogOverlay');

    if (dialogTitle) dialogTitle.textContent = title;
    if (dialogContent) dialogContent.textContent = content;
    if (dialogConfirmBtn) dialogConfirmBtn.textContent = confirmText;
    if (dialogCancelBtn) dialogCancelBtn.textContent = cancelText;
    if (dialogOverlay) dialogOverlay.classList.add('show');
  });
}

function closeDialog(result) {
  const dialogOverlay = document.getElementById('dialogOverlay');
  if (dialogOverlay) {
    dialogOverlay.classList.remove('show');
  }
  if (dialogResolve) {
    dialogResolve(result);
    dialogResolve = null;
  }
}

function initDialogs() {
  const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');
  const dialogCancelBtn = document.getElementById('dialogCancelBtn');
  const dialogOverlay = document.getElementById('dialogOverlay');

  if (dialogConfirmBtn) {
    dialogConfirmBtn.addEventListener('click', () => {
      closeDialog(true);
    });
  }

  if (dialogCancelBtn) {
    dialogCancelBtn.addEventListener('click', () => {
      closeDialog(false);
    });
  }

  // 点击遮罩层关闭对话框
  if (dialogOverlay) {
    dialogOverlay.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeDialog(false);
      }
    });
  }
}

const SOURCE_LABELS = {
  'songloft-player': '客户端',
  'miot': '智能音箱',
  'web': '网页端',
  'mobile': '手机端',
  'airplay': 'AirPlay',
  'bluetooth': '蓝牙',
  'unknown': '未知',
};

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

function buildUrl(path, range) {
  const tr = getTimeRange(range);
  if (!tr) return path;
  return `${path}?from=${tr.from}&to=${tr.to}`;
}

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
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (dateOnly.getTime() === today.getTime()) return `今天 ${time}`;
  if (dateOnly.getTime() === yesterday.getTime()) return `昨天 ${time}`;
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

// ── 状态管理 ──────────────────────────────────────────────────────────────────

function showLoading() {
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
        `<span class="history-list__meta">${formatTime(r.timestamp)} · ${sourceLabel(r.source)}</span>` +
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

async function loadData(range, isInitial) {
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
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('tab--active', t.dataset.range === range);
  });
  document.getElementById('historyList').removeAttribute('data-append');
  loadData(range, false);
}

// ── 设置页逻辑 ────────────────────────────────────────────────────────────────

/** 刷新统计 Tab 数据（无论当前是否在统计页都会预加载） */
function refreshStatsTab() {
  // 清空历史列表，避免残留旧数据
  document.getElementById('historyList').innerHTML = '<li class="history-list__empty">加载中…</li>';
  document.getElementById('historyList').removeAttribute('data-append');
  historyOffset = 0;
  document.getElementById('historyFooter').style.display = 'none';
  // 如果当前在统计 Tab，立即刷新；否则预加载，切回来时自动显示
  const statsTab = document.getElementById('tab-stats');
  if (statsTab && statsTab.classList.contains('active')) {
    loadData(currentRange, false);
  } else {
    // 后台预加载
    loadData(currentRange, false);
  }
}

function showToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast--show ' + (ok ? 'toast--ok' : 'toast--err');
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('toast--show'), 2500);
}

async function loadSettings() {
  try {
    const resp = await apiGet('/api/settings');
    if (resp.success) {
      document.getElementById('recordCount').textContent = resp.data.recordCount;
      document.getElementById('maxHistorySelect').value = String(resp.data.maxHistory);
    }
  } catch {
    document.getElementById('recordCount').textContent = '加载失败';
  }
}

document.getElementById('btnSaveLimit').addEventListener('click', async () => {
  const maxHistory = parseInt(document.getElementById('maxHistorySelect').value);
  try {
    const resp = await apiPost('/api/settings', { maxHistory });
    if (resp.success) {
      showToast(`历史上限已设为 ${resp.data.maxHistory.toLocaleString()} 条`);
      loadSettings();
      refreshStatsTab();
    } else {
      showToast((resp && resp.error) || '保存失败', false);
    }
  } catch (e) {
    showToast(String(e), false);
  }
});

document.getElementById('btnExport').addEventListener('click', async () => {
  const confirmed = await showDialog('确认导出', '确定要导出所有播放统计数据吗？', '导出', '取消');
  if (!confirmed) return;
  try {
    const resp = await apiGet('/api/export');
    const blob = new Blob([JSON.stringify(resp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'songloft-stats-export.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功');
  } catch (e) {
    showToast('导出失败: ' + String(e), false);
  }
});

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const confirmed = await showDialog('确认导入', '确定要导入统计数据吗？这将合并现有数据。', '导入', '取消');
    if (!confirmed) {
      e.target.value = '';
      return;
    }
    const resp = await apiPost('/api/import', JSON.parse(text));
    if (resp.success) {
      showToast(`导入成功，新增 ${resp.data.added} 条记录`);
      loadSettings();
      refreshStatsTab();
    } else {
      showToast((resp && resp.error) || '导入失败', false);
    }
  } catch (e) {
    showToast('导入失败: ' + String(e), false);
  }
  e.target.value = '';
});

document.getElementById('btnReset').addEventListener('click', async () => {
  const confirmed = await showDialog('确认重置', '确定要清空所有播放统计数据吗？此操作不可撤销。', '重置', '取消');
  if (!confirmed) return;
  try {
    const resp = await apiPost('/api/reset', {});
    if (resp.success) {
      showToast('统计数据已清空');
      loadSettings();
      refreshStatsTab();
    }
  } catch (e) {
    showToast('重置失败: ' + String(e), false);
  }
});

// ── 推送设置 ────────────────────────────────────────────────────────────────

let pushConfig = { feishu: { token: '', enabled: false }, wxpusher: { token: '', enabled: false }, enabled: false };
let pushSchedule = { enabled: false, hour: 9, minute: 0 };

async function loadPushSettings() {
  try {
    const resp = await apiGet('/api/push/config');
    if (resp.success) {
      const old = resp.data.config;
      // 兼容旧格式（单 token）
      if (old.token !== undefined && !old.feishu) {
        pushConfig = {
          feishu: { token: '', enabled: false },
          wxpusher: { token: '', enabled: false },
          enabled: false,
        };
        if (old.platform === 'feishu') pushConfig.feishu.token = old.token;
        else if (old.platform === 'wxpusher') pushConfig.wxpusher.token = old.token;
        pushConfig[old.platform || 'feishu'].enabled = !!old.enabled;
      } else {
        pushConfig = {
          feishu: { ...pushConfig.feishu, ...(old.feishu || {}) },
          wxpusher: { ...pushConfig.wxpusher, ...(old.wxpusher || {}) },
        };
      }
      pushSchedule = resp.data.schedule;
      applyPushUI();
    }
  } catch {
    // 静默失败
  }
}

function applyPushUI() {
  document.getElementById('pushPlatformSelect').value = getCurrentPlatform();
  updateTokenField();
  document.getElementById('pushTokenInput').value = getCurrentToken() || '';
  document.getElementById('pushEnabledCheck').checked = getCurrentConfig().enabled;
  document.getElementById('pushScheduleEnabledCheck').checked = !!pushSchedule.enabled;
  document.getElementById('pushHourInput').value = pushSchedule.hour || 9;
  document.getElementById('pushMinuteInput').value = pushSchedule.minute || 0;
}

function getCurrentPlatform() {
  return document.getElementById('pushPlatformSelect').value;
}

function getCurrentConfig() {
  const platform = getCurrentPlatform();
  return pushConfig[platform] || { token: '', enabled: false };
}

function getCurrentToken() {
  return getCurrentConfig().token;
}

function setCurrentToken(val) {
  const platform = getCurrentPlatform();
  pushConfig[platform] = { ...getCurrentConfig(), token: val };
}

function setCurrentEnabled(val) {
  const platform = getCurrentPlatform();
  pushConfig[platform] = { ...getCurrentConfig(), enabled: val };
}

function updateTokenField() {
  const platform = getCurrentPlatform();
  const label = document.getElementById('pushTokenLabel');
  const input = document.getElementById('pushTokenInput');
  const helpText = document.getElementById('pushHelpText');
  const qrSection = document.getElementById('pushQrCode');

  if (platform === 'feishu') {
    label.textContent = 'larkKey';
    input.placeholder = '请输入飞书机器人 webhook key';
    helpText.innerHTML = `
      <p class="push-help-desc">
        飞书群组机器人：<a href="https://www.feishu.cn/hc/zh-CN/articles/360024984973" target="_blank" rel="noopener">在群组中使用机器人</a>
      </p>`;
    qrSection.style.display = 'none';
  } else if (platform === 'wxpusher') {
    label.textContent = 'SPT';
    input.placeholder = '请输入 WxPusher SPT 码（多个用逗号分隔）';
    helpText.innerHTML = `
      <p class="push-help-desc">
        WxPusher 极简推送，独立 APP，支持 Android、iOS、Harmony、Window、MacOS、Linux 等 6 大平台。<br>
        扫描二维码下载 APP，获取 SPT。多个 SPT 用英文逗号(,)分隔，最多 10 个。<br>
        <a href="https://wxpusher.zjiecode.com/download/" target="_blank" rel="noopener">点击下载 APP</a> · <a href="https://wxpusher.zjiecode.com/docs/#/?id=spt" target="_blank" rel="noopener">官方说明</a>
      </p>`;
    qrSection.style.display = 'block';
    document.getElementById('pushQrImg').src = 'https://wxpusher.zjiecode.com/api/qrcode/RwjGLMOPTYp35zSYQr0HxbCPrV9eU0wKVBXU1D5VVtya0cQXEJWPjqBdW3gKLifS.jpg';
  }
}

document.getElementById('pushPlatformSelect').addEventListener('change', () => {
  updateTokenField();
  document.getElementById('pushTokenInput').value = getCurrentToken() || '';
  document.getElementById('pushEnabledCheck').checked = getCurrentConfig().enabled;
});

document.getElementById('btnSavePushConfig').addEventListener('click', async () => {
  const platform = getCurrentPlatform();
  const tokenVal = document.getElementById('pushTokenInput').value.trim();
  setCurrentToken(tokenVal);
  setCurrentEnabled(document.getElementById('pushEnabledCheck').checked);

  // 未启用时允许保存空 token，启用时必须填 token
  if (!getCurrentConfig().enabled && !tokenVal) {
    // 未启用且 token 为空，允许保存
  } else if (getCurrentConfig().enabled && !tokenVal) {
    showToast('请先填写 Token', false);
    return;
  }

  try {
    const resp = await apiPost('/api/push/config', { config: pushConfig });
    if (resp.success) {
      showToast('推送配置已保存');
    } else {
      showToast((resp && resp.error) || '保存失败', false);
    }
  } catch (e) {
    showToast(String(e), false);
  }
});

document.getElementById('btnSavePushSchedule').addEventListener('click', async () => {
  pushSchedule.enabled = document.getElementById('pushScheduleEnabledCheck').checked;
  const hourInput = document.getElementById('pushHourInput').value.trim();
  const minuteInput = document.getElementById('pushMinuteInput').value.trim();
  
  // 验证 hour
  const hour = parseInt(hourInput, 10);
  if (isNaN(hour) || hour < 0 || hour > 23 || String(hour) !== hourInput) {
    showToast('请输入有效的小时（0-23）', false);
    return;
  }
  
  // 验证 minute
  const minute = parseInt(minuteInput, 10);
  if (isNaN(minute) || minute < 0 || minute > 59 || String(minute) !== minuteInput) {
    showToast('请输入有效的分钟（0-59）', false);
    return;
  }
  
  pushSchedule.hour = hour;
  pushSchedule.minute = minute;
  
  if (pushSchedule.enabled) {
    // 检查所有已启用平台是否都有 token
    const platforms = ['feishu', 'wxpusher'];
    for (const p of platforms) {
      const cfg = pushConfig[p];
      if (cfg && cfg.enabled && !cfg.token) {
        const name = p === 'feishu' ? '飞书' : 'WxPusher';
        showToast(`请先配置 ${name} 的 Token`, false);
        return;
      }
    }
  }
  
  try {
    const resp = await apiPost('/api/push/config', { schedule: pushSchedule });
    if (resp.success) {
      const timeStr = `${String(pushSchedule.hour).padStart(2, '0')}:${String(pushSchedule.minute).padStart(2, '0')}`;
      showToast(`定时推送已设为每天 ${timeStr}`);
    } else {
      showToast((resp && resp.error) || '保存失败', false);
    }
  } catch (e) {
    showToast(String(e), false);
  }
});

document.getElementById('btnTestPush').addEventListener('click', async () => {
  const btn = document.getElementById('btnTestPush');
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const platform = getCurrentPlatform();
    const resp = await apiPost('/api/push/test', { platform });
    if (resp.success) {
      showToast('测试推送已发送，请检查设备');
    } else {
      showToast((resp && resp.error) || '推送失败', false);
    }
  } catch (e) {
    showToast(String(e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '发送测试推送';
  }
});

// ── 初始化 ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initDialogs();
  showLoading();
  loadData('all', true);

  // 主 Tab 切换（统计 / 设置）
  document.getElementById('mainTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    document.querySelectorAll('#mainTabs .tab').forEach((t) => {
      t.classList.toggle('tab--active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'settings') {
      loadSettings();
      loadPushSettings();
    }
  });

  // 设置页子 Tab 切换（推送 / 历史 / 危险操作）
  const settingsSubTabs = document.getElementById('settingsSubTabs');
  if (settingsSubTabs) {
    settingsSubTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const subTabName = tab.dataset.subtab;
      document.querySelectorAll('#settingsSubTabs .tab').forEach((t) => {
        t.classList.toggle('tab--active', t.dataset.subtab === subTabName);
      });
      document.querySelectorAll('.subtab-content').forEach((c) => c.classList.remove('active'));
      document.getElementById('subtab-' + subTabName).classList.add('active');
    });
  }

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
});
