/**
 * 通用 UI 工具：对话框、Toast、格式化函数
 */

// ── Dialog ────────────────────────────────────────────────────────────────────
let dialogResolve = null;

export function showDialog(title, content, confirmText = '确定', cancelText = '取消') {
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

export function initDialogs() {
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

// ── Toast ─────────────────────────────────────────────────────────────────────

export function showToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast--show ' + (ok ? 'toast--ok' : 'toast--err');
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('toast--show'), 2500);
}

// ── 格式化 ────────────────────────────────────────────────────────────────────

const SOURCE_LABELS = {
  'songloft-player': '客户端',
  'miot': '智能音箱',
  'web': '网页端',
  'mobile': '手机端',
  'airplay': 'AirPlay',
  'bluetooth': '蓝牙',
  'unknown': '未知',
};

export function sourceLabel(src) {
  return SOURCE_LABELS[src] || src || '未知';
}

const MEDIA_TYPE_LABELS = {
  local: '本地',
  remote: '网络',
  radio: '电台',
  unknown: '未知',
};

export function mediaLabel(type) {
  return MEDIA_TYPE_LABELS[type] || '未知';
}

export function formatDuration(sec) {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${sec} 秒`;
}

export function formatTime(ts) {
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

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
