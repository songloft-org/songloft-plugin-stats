/**
 * 推送设置：飞书 / WxPusher 配置与定时推送
 */
import { apiGet, apiPost } from './api.js';
import { showToast } from './ui.js';

let pushConfig = { feishu: { token: '', enabled: false }, wxpusher: { token: '', enabled: false }, enabled: false };
let pushSchedule = { enabled: false, hour: 9, minute: 0 };

export async function loadPushSettings() {
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

export function initPush() {
  document.getElementById('pushPlatformSelect').addEventListener('change', () => {
    updateTokenField();
    document.getElementById('pushTokenInput').value = getCurrentToken() || '';
    document.getElementById('pushEnabledCheck').checked = getCurrentConfig().enabled;
  });

  document.getElementById('btnSavePushConfig').addEventListener('click', async () => {
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
}
