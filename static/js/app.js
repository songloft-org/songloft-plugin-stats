/**
 * 播放统计 — 前端入口
 * 只负责模块组装与主/子 Tab 路由，各页面逻辑见同目录模块：
 *   api.js       API 请求封装
 *   ui.js        对话框 / Toast / 格式化工具
 *   stats.js     统计页
 *   settings.js  设置页基础（上限 / 导入导出 / 重置）
 *   push.js      推送设置
 *   backup.js    WebDAV 备份
 *   recommend.js 智能推荐 / 规则歌单 / 自动刷新 / tag 联动
 *   ai.js        AI 建歌单 / 听歌报告 / 标签补全
 */
import { initDialogs } from './ui.js';
import { initStats } from './stats.js';
import { initSettings, loadSettings } from './settings.js';
import { initPush, loadPushSettings } from './push.js';
import { initBackup, loadBackupServers } from './backup.js';
import {
  initRecommend,
  loadRecommend,
  loadRecSchedule,
  loadRuleFacets,
  loadRules,
  loadTagStatus,
} from './recommend.js';
import { initAi, loadAiSettings, refreshAiCards } from './ai.js';

document.addEventListener('DOMContentLoaded', () => {
  initDialogs();
  initStats();
  initSettings();
  initPush();
  initBackup();
  initRecommend();
  initAi();

  // 主 Tab 切换（统计 / 推荐 / 设置）—— 新外壳使用 .tab-item / .active
  document.getElementById('mainTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    document.querySelectorAll('#mainTabs .tab-item').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'settings') {
      loadSettings();
      loadPushSettings();
    }
    if (tabName === 'recommend') {
      loadRecommend();
      // 其余子页面的数据在切到对应子 Tab 时才加载
    }
  });

  // 推荐页子 Tab 切换（智能推荐 / 规则歌单 / 自动刷新）
  const recommendSubTabs = document.getElementById('recommendSubTabs');
  if (recommendSubTabs) {
    recommendSubTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const subTabName = tab.dataset.subtab;
      document.querySelectorAll('#recommendSubTabs .tab').forEach((t) => {
        t.classList.toggle('tab--active', t.dataset.subtab === subTabName);
      });
      document.querySelectorAll('#tab-recommend .subtab-content').forEach((c) => c.classList.remove('active'));
      document.getElementById('subtab-' + subTabName).classList.add('active');

      if (subTabName === 'rec-rules') {
        loadRules();
        loadRuleFacets();
        loadTagStatus();
        refreshAiCards();
      }
      if (subTabName === 'rec-auto') {
        loadRecSchedule();
      }
    });
  }

  // 设置页子 Tab 切换（推送 / 备份 / AI / 历史 / 危险操作）
  const settingsSubTabs = document.getElementById('settingsSubTabs');
  if (settingsSubTabs) {
    settingsSubTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const subTabName = tab.dataset.subtab;
      document.querySelectorAll('#settingsSubTabs .tab').forEach((t) => {
        t.classList.toggle('tab--active', t.dataset.subtab === subTabName);
      });
      document.querySelectorAll('#tab-settings .subtab-content').forEach((c) => c.classList.remove('active'));
      document.getElementById('subtab-' + subTabName).classList.add('active');

      // 切换到备份 Tab 时加载配置
      if (subTabName === 'backup') {
        loadBackupServers();
      }
      // 切换到 AI Tab 时加载配置
      if (subTabName === 'ai') {
        loadAiSettings();
      }
    });
  }
});
