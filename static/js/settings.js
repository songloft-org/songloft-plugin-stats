/**
 * 设置页基础：历史上限、导入导出、重置
 */
import { apiGet, apiPost } from './api.js';
import { showDialog, showToast } from './ui.js';
import { refreshStatsTab } from './stats.js';

export async function loadSettings() {
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

export function initSettings() {
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
}
