/**
 * WebDAV 备份：服务器配置、手动备份/恢复、定时备份
 */
import { apiGet, apiPost } from './api.js';
import { escapeHtml, formatFileSize, showDialog, showToast } from './ui.js';
import { loadSettings } from './settings.js';
import { refreshStatsTab } from './stats.js';

let backupServers = [];
let backupSchedule = { enabled: false, hour: 2, minute: 0, configName: '' };

export async function loadBackupServers() {
  try {
    const resp = await apiGet('/api/backup/webdav/config');
    if (resp.success) {
      backupServers = resp.data;
      renderBackupServerList();
      updateBackupServerSelects();
    }
  } catch {
    // 静默失败
  }
}

function renderBackupServerList() {
  const container = document.getElementById('backupServerList');
  if (!backupServers.length) {
    container.innerHTML = '<p class="setting-desc">暂无配置</p>';
    return;
  }
  container.innerHTML = backupServers.map(server =>
    `<div class="backup-server-item">
      <div class="backup-server-info">
        <div class="backup-server-name">${escapeHtml(server.name)}</div>
        <div class="backup-server-url">${escapeHtml(server.url)}</div>
      </div>
      <button class="btn-text backup-server-delete" data-name="${escapeHtml(server.name)}" style="color:var(--md-error);font-size:0.8rem;padding:4px 8px;">删除</button>
    </div>`
  ).join('');

  // 绑定删除按钮事件
  container.querySelectorAll('.backup-server-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      const confirmed = await showDialog('确认删除', `确定要删除配置 "${name}" 吗？`, '删除', '取消');
      if (!confirmed) return;
      try {
        await apiPost('/api/backup/webdav/config', { action: 'delete', name });
        showToast('已删除配置');
        loadBackupServers();
      } catch (e) {
        showToast('删除失败: ' + String(e), false);
      }
    });
  });
}

function updateBackupServerSelects() {
  const selects = ['backupServerSelect', 'restoreServerSelect', 'backupScheduleServerSelect'];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">请选择服务器</option>' +
      backupServers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  });

  // 恢复页默认停留在「请选择服务器」，由用户选择后自动加载文件列表
  refreshBackupFiles();

  // 重新加载定时备份配置
  loadBackupSchedule();
}

// 初始化时间选择器
export function initTimeSelectors() {
  const hourSelect = document.getElementById('backupScheduleHour');
  const minuteSelect = document.getElementById('backupScheduleMinute');
  if (!hourSelect || !minuteSelect) return;

  // 小时选项 0-23
  hourSelect.innerHTML = Array.from({ length: 24 }, (_, i) =>
    `<option value="${i}">${String(i).padStart(2, '0')}</option>`
  ).join('');

  // 分钟选项 0-59
  minuteSelect.innerHTML = Array.from({ length: 60 }, (_, i) =>
    `<option value="${i}">${String(i).padStart(2, '0')}</option>`
  ).join('');
}

async function loadBackupSchedule() {
  try {
    const resp = await apiGet('/api/backup/schedule');
    if (resp.success) {
      backupSchedule = resp.data;
      document.getElementById('backupScheduleEnabled').checked = backupSchedule.enabled;
      document.getElementById('backupScheduleHour').value = backupSchedule.hour;
      document.getElementById('backupScheduleMinute').value = backupSchedule.minute;
      document.getElementById('backupScheduleServerSelect').value = backupSchedule.configName || '';
    }
  } catch {
    // 静默失败
  }
}

async function refreshBackupFiles() {
  const configName = document.getElementById('restoreServerSelect').value;
  const fileSelect = document.getElementById('backupFileSelect');
  if (!configName) {
    fileSelect.innerHTML = '<option value="">请先选择服务器</option>';
    fileSelect.disabled = true;
    return;
  }

  fileSelect.innerHTML = '<option value="">加载中…</option>';
  fileSelect.disabled = true;
  try {
    const resp = await apiGet(`/api/backup/webdav/list?configName=${encodeURIComponent(configName)}`);
    if (resp.success && resp.data.length) {
      fileSelect.innerHTML = resp.data.map(f =>
        `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${formatFileSize(f.size)})</option>`
      ).join('');
      fileSelect.disabled = false;
    } else {
      fileSelect.innerHTML = '<option value="">暂无备份文件</option>';
      fileSelect.disabled = true;
    }
  } catch (e) {
    showToast('获取文件列表失败: ' + String(e), false);
  }
}

export function initBackup() {
  initTimeSelectors();

  document.getElementById('backupScheduleEnabled').addEventListener('change', () => {
    const serverSelect = document.getElementById('backupScheduleServerSelect');
    serverSelect.disabled = !document.getElementById('backupScheduleEnabled').checked;
  });

  document.getElementById('btnSaveBackupSchedule').addEventListener('click', async () => {
    const enabled = document.getElementById('backupScheduleEnabled').checked;
    const hour = parseInt(document.getElementById('backupScheduleHour').value, 10);
    const minute = parseInt(document.getElementById('backupScheduleMinute').value, 10);
    const configName = document.getElementById('backupScheduleServerSelect').value;

    if (enabled && !configName) {
      showToast('请至少选择一个服务器', false);
      return;
    }

    const schedule = { enabled, hour, minute, configName: configName || '' };
    try {
      await apiPost('/api/backup/schedule', { action: 'save', schedule });
      showToast('定时设置已保存');
    } catch (e) {
      showToast('保存失败: ' + String(e), false);
    }
  });

  document.getElementById('btnSaveBackupConfig').addEventListener('click', async () => {
    const name = document.getElementById('backupDavName').value.trim();
    const url = document.getElementById('backupDavUrl').value.trim();
    const username = document.getElementById('backupDavUsername').value.trim();
    const password = document.getElementById('backupDavPassword').value.trim();

    if (!name || !url) {
      showToast('名称和地址不能为空', false);
      return;
    }

    try {
      const config = { name, url, username, password };
      await apiPost('/api/backup/webdav/config', { action: 'add', name, config });
      showToast('配置已保存');
      document.getElementById('backupDavName').value = '';
      document.getElementById('backupDavUrl').value = '';
      document.getElementById('backupDavUsername').value = '';
      document.getElementById('backupDavPassword').value = '';
      loadBackupServers();
    } catch (e) {
      showToast('保存失败: ' + String(e), false);
    }
  });

  document.getElementById('btnTestBackup').addEventListener('click', async () => {
    const name = document.getElementById('backupDavName').value.trim();
    const url = document.getElementById('backupDavUrl').value.trim();
    const username = document.getElementById('backupDavUsername').value.trim();
    const password = document.getElementById('backupDavPassword').value.trim();

    if (!url) {
      showToast('服务器地址不能为空', false);
      return;
    }

    const btn = document.getElementById('btnTestBackup');
    btn.disabled = true;
    btn.textContent = '测试中…';

    try {
      const config = { name: name || 'Test', url, username, password };
      const resp = await apiPost('/api/backup/webdav/test', { config });
      if (resp.success && resp.data.connected) {
        showToast('连接成功');
      } else {
        showToast('连接失败: ' + (resp.error || '未知错误'), false);
      }
    } catch (e) {
      showToast('测试失败: ' + String(e), false);
    } finally {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  });

  document.getElementById('btnUploadBackup').addEventListener('click', async () => {
    const configName = document.getElementById('backupServerSelect').value;
    if (!configName) {
      showToast('请先选择服务器', false);
      return;
    }
    const confirmed = await showDialog('确认备份', '确定要上传备份到 WebDAV 吗？', '上传', '取消');
    if (!confirmed) return;

    const btn = document.getElementById('btnUploadBackup');
    btn.disabled = true;
    btn.textContent = '上传中…';

    try {
      const resp = await apiPost('/api/backup/upload', { configName });
      if (resp.success) {
        showToast(`备份成功: ${resp.data.fileName}`);
      } else {
        showToast('上传失败: ' + (resp.error || '未知错误'), false);
      }
    } catch (e) {
      showToast('上传失败: ' + String(e), false);
    } finally {
      btn.disabled = false;
      btn.textContent = '上传备份';
    }
  });

  document.getElementById('restoreServerSelect').addEventListener('change', refreshBackupFiles);

  document.getElementById('btnDownloadBackup').addEventListener('click', async () => {
    const configName = document.getElementById('restoreServerSelect').value;
    const fileName = document.getElementById('backupFileSelect').value;

    if (!configName || !fileName) {
      showToast('请选择服务器和备份文件', false);
      return;
    }

    const confirmed = await showDialog('确认恢复', '导入的数据将与现有数据合并，确定要继续吗？', '恢复', '取消');
    if (!confirmed) return;

    const btn = document.getElementById('btnDownloadBackup');
    btn.disabled = true;
    btn.textContent = '恢复中…';

    try {
      const resp = await apiPost('/api/backup/download', { configName, fileName });
      if (!resp.success) {
        showToast('下载失败: ' + (resp.error || '未知错误'), false);
        return;
      }

      const added = await apiPost('/api/import', resp.data);
      if (added.success) {
        showToast(`恢复成功，新增 ${added.data.added} 条记录`);
        loadSettings();
        refreshStatsTab();
      } else {
        showToast('导入失败: ' + (added.error || '未知错误'), false);
      }
    } catch (e) {
      showToast('恢复失败: ' + String(e), false);
    } finally {
      btn.disabled = false;
      btn.textContent = '恢复数据';
    }
  });
}
