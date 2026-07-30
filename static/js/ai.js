/**
 * AI 功能：服务配置、AI 建歌单、AI 听歌报告、AI 标签补全
 */
import { apiGet, apiPost } from './api.js';
import { escapeHtml, showToast } from './ui.js';
import { describeRuleUi, invalidateFacets, loadRuleFacets, loadRules, loadTagStatus } from './recommend.js';

let aiConfigured = false;
let aiNlParsedRule = null;
let aiTagPollTimer = null;

// ── AI 服务配置 ───────────────────────────────────────────────────────────────

export async function loadAiSettings() {
  try {
    const resp = await apiGet('/api/ai/config');
    if (!resp.success) return;
    const c = resp.data.config || {};
    aiConfigured = !!resp.data.configured;
    document.getElementById('aiBaseUrlInput').value = c.baseUrl || '';
    document.getElementById('aiApiKeyInput').value = c.apiKey || '';
    document.getElementById('aiModelInput').value = c.model || '';
  } catch (e) {
    // 配置加载失败不阻断页面
  }
  loadAiReportSchedule();
}

async function saveAiSettings() {
  const btn = document.getElementById('btnSaveAiConfig');
  btn.disabled = true;
  try {
    const resp = await apiPost('/api/ai/config', {
      baseUrl: document.getElementById('aiBaseUrlInput').value.trim(),
      apiKey: document.getElementById('aiApiKeyInput').value.trim(),
      model: document.getElementById('aiModelInput').value.trim(),
    });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    aiConfigured = !!resp.data.configured;
    showToast(aiConfigured ? 'AI 配置已保存' : '已保存（配置不完整，AI 功能暂不可用）', aiConfigured);
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

async function testAiConnection() {
  const btn = document.getElementById('btnTestAi');
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const resp = await apiPost('/api/ai/test', {});
    if (!resp.success) throw new Error(resp.error || '测试失败');
    showToast('连接正常，模型回复：' + resp.data.reply);
  } catch (e) {
    showToast('连接失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

// ── AI 听歌报告 ───────────────────────────────────────────────────────────────

async function generateAiReport(push) {
  const btnPreview = document.getElementById('btnAiReportPreview');
  const btnPush = document.getElementById('btnAiReportPush');
  const resultEl = document.getElementById('aiReportResult');
  btnPreview.disabled = true;
  btnPush.disabled = true;
  resultEl.style.display = '';
  resultEl.textContent = 'AI 生成中，请稍候…';
  try {
    const period = document.getElementById('aiReportPeriodSelect').value;
    const resp = await apiPost('/api/ai/report', { period, push: !!push });
    if (!resp.success) throw new Error(resp.error || '生成失败');
    resultEl.textContent = resp.data.title + '\n\n' + resp.data.content;
    if (push) {
      showToast(resp.data.pushed.length > 0 ? '已推送到：' + resp.data.pushed.join('、') : '生成成功，但没有已启用的推送渠道', resp.data.pushed.length > 0);
    } else {
      showToast('报告已生成');
    }
  } catch (e) {
    resultEl.style.display = 'none';
    showToast('生成失败：' + String(e.message || e), false);
  } finally {
    btnPreview.disabled = false;
    btnPush.disabled = false;
  }
}

// ── AI 报告定时推送 ─────────────────────────────────────────────────────

async function loadAiReportSchedule() {
  try {
    const resp = await apiGet('/api/ai/report/schedule');
    if (!resp.success) return;
    const s = resp.data;
    document.getElementById('aiReportScheduleEnabledCheck').checked = !!s.enabled;
    document.getElementById('aiReportSchedulePeriodSelect').value = s.period || 'week';
    document.getElementById('aiReportScheduleHourInput').value = s.hour;
    document.getElementById('aiReportScheduleMinuteInput').value = s.minute;
  } catch (e) {
    // 定时配置加载失败不阻断页面
  }
}

async function saveAiReportSchedule() {
  const btn = document.getElementById('btnSaveAiReportSchedule');
  const enabled = document.getElementById('aiReportScheduleEnabledCheck').checked;
  const hour = parseInt(document.getElementById('aiReportScheduleHourInput').value);
  const minute = parseInt(document.getElementById('aiReportScheduleMinuteInput').value);
  if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
    showToast('请填写有效的推送时间', false);
    return;
  }
  if (enabled && !aiConfigured) {
    showToast('请先配置并保存 AI 服务', false);
    return;
  }
  btn.disabled = true;
  try {
    const period = document.getElementById('aiReportSchedulePeriodSelect').value;
    const resp = await apiPost('/api/ai/report/schedule', { enabled, period, hour, minute });
    if (!resp.success) throw new Error(resp.error || '保存失败');
    const s = resp.data;
    const timeStr = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    showToast(s.enabled
      ? `定时推送已启用：${s.period === 'month' ? '每月 1 日' : '每周一'} ${timeStr}`
      : '定时推送已关闭');
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

// ── AI 建歌单 ─────────────────────────────────────────────────────────────────

/** 推荐页的 AI 入口可见性：未配置 AI 则隐藏两张卡片 */
export async function refreshAiCards() {
  try {
    const resp = await apiGet('/api/ai/config');
    aiConfigured = !!(resp.success && resp.data.configured);
  } catch (e) {
    aiConfigured = false;
  }
  document.getElementById('aiNlCard').style.display = aiConfigured ? '' : 'none';
  if (aiConfigured) {
    loadAiTagStatus();
  } else {
    document.getElementById('aiTagCard').style.display = 'none';
  }
}

async function parseAiNlPlaylist() {
  const input = document.getElementById('aiNlInput').value.trim();
  if (!input) {
    showToast('请先描述你想要的歌单', false);
    return;
  }
  const btn = document.getElementById('btnAiNlParse');
  const saveBtn = document.getElementById('btnAiNlSave');
  btn.disabled = true;
  btn.textContent = 'AI 解析中…';
  try {
    const resp = await apiPost('/api/ai/nlplaylist', { text: input });
    if (!resp.success) throw new Error(resp.error || '解析失败');
    const { rule, items, total } = resp.data;
    aiNlParsedRule = rule;
    document.getElementById('aiNlResult').style.display = '';
    document.getElementById('aiNlRuleDesc').textContent =
      `解析结果：「${rule.name}」（${describeRuleUi(rule)}），共命中 ${total} 首`;
    const list = document.getElementById('aiNlPreviewList');
    if (items.length === 0) {
      list.innerHTML = '<li class="history-list__empty">没有命中的歌曲，换个说法试试</li>';
      saveBtn.style.display = 'none';
      aiNlParsedRule = null;
    } else {
      list.innerHTML = items.map((it) =>
        `<li class="history-item"><div class="history-item__main"><span class="history-item__title">${escapeHtml(it.title)}</span><span class="history-item__artist">${escapeHtml(it.artist)}</span></div></li>`
      ).join('');
      saveBtn.style.display = '';
      showToast('解析成功，确认后可保存');
    }
  } catch (e) {
    showToast('AI 解析失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'AI 解析';
  }
}

async function saveAiNlPlaylist() {
  if (!aiNlParsedRule) return;
  const btn = document.getElementById('btnAiNlSave');
  btn.disabled = true;
  try {
    // 复用现有规则接口：先保存规则，再物化歌单
    const saveResp = await apiPost('/api/recommend/rules', { rule: aiNlParsedRule });
    if (!saveResp.success) throw new Error(saveResp.error || '保存规则失败');
    const applyResp = await apiPost('/api/recommend/rules/apply', { id: saveResp.data.id });
    if (!applyResp.success) throw new Error(applyResp.error || '生成歌单失败');
    showToast(`已生成歌单「${applyResp.data.playlistName}」（${applyResp.data.songCount} 首）`);
    document.getElementById('aiNlResult').style.display = 'none';
    document.getElementById('aiNlInput').value = '';
    btn.style.display = 'none';
    aiNlParsedRule = null;
    loadRules();
  } catch (e) {
    showToast('保存失败：' + String(e.message || e), false);
  } finally {
    btn.disabled = false;
  }
}

// ── AI 标签补全 ───────────────────────────────────────────────────────────────

async function loadAiTagStatus() {
  const card = document.getElementById('aiTagCard');
  try {
    const resp = await apiGet('/api/ai/tag/status');
    if (!resp.success) throw new Error(resp.error || '检测失败');
    const s = resp.data;
    if (!s.configured || s.missing === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    document.getElementById('aiTagInfo').textContent =
      `本地歌曲 ${s.localTotal} 首，其中 ${s.missing} 首缺流派/年份标签`;
    if (s.progress && s.progress.status === 'running') {
      startAiTagPolling();
    }
  } catch (e) {
    card.style.display = 'none';
  }
}

async function startAiTagging() {
  const btn = document.getElementById('btnAiTagStart');
  btn.disabled = true;
  btn.textContent = '启动中…';
  try {
    const resp = await apiPost('/api/ai/tag/start', {});
    if (!resp.success) throw new Error(resp.error || '启动失败');
    showToast(`AI 补全已启动，本轮处理 ${resp.data.total} 首`);
    startAiTagPolling();
  } catch (e) {
    showToast('启动失败：' + String(e.message || e), false);
    btn.disabled = false;
    btn.textContent = 'AI 补全标签';
  }
}

function startAiTagPolling() {
  const progressEl = document.getElementById('aiTagProgress');
  const btn = document.getElementById('btnAiTagStart');
  progressEl.style.display = '';
  btn.disabled = true;
  btn.textContent = '补全中…';
  clearInterval(aiTagPollTimer);

  aiTagPollTimer = setInterval(async () => {
    try {
      const resp = await apiGet('/api/ai/tag/progress');
      if (!resp.success) throw new Error(resp.error || '查询失败');
      const p = resp.data;
      progressEl.textContent = `补全进度：${p.processed}/${p.total}（成功 ${p.success}，失败 ${p.failed}）`;
      if (p.status === 'done' || p.status === 'error') {
        clearInterval(aiTagPollTimer);
        aiTagPollTimer = null;
        btn.disabled = false;
        btn.textContent = 'AI 补全标签';
        if (p.status === 'done') {
          progressEl.textContent += ' — 已完成';
          if (p.failed > 0 && p.lastError) {
            progressEl.textContent += `（失败原因：${p.lastError}）`;
          }
          if (p.failed > 0 && p.success === 0) {
            showToast(`AI 补全全部失败：${p.lastError || '未知原因'}`, false);
          } else {
            showToast(`AI 补全完成：成功 ${p.success}，失败 ${p.failed}`);
          }
          // 标签已更新，刷新相关面板
          invalidateFacets();
          loadAiTagStatus();
          loadRuleFacets();
          loadTagStatus();
        } else {
          showToast('AI 补全异常终止：' + (p.error || '未知错误'), false);
        }
      }
    } catch (e) {
      clearInterval(aiTagPollTimer);
      aiTagPollTimer = null;
      progressEl.textContent = '进度查询失败：' + String(e.message || e);
      btn.disabled = false;
      btn.textContent = 'AI 补全标签';
    }
  }, 3000);
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

export function initAi() {
  document.getElementById('btnAiNlParse').addEventListener('click', parseAiNlPlaylist);
  document.getElementById('btnAiNlSave').addEventListener('click', saveAiNlPlaylist);
  document.getElementById('btnAiTagStart').addEventListener('click', startAiTagging);
  document.getElementById('btnSaveAiConfig').addEventListener('click', saveAiSettings);
  document.getElementById('btnTestAi').addEventListener('click', testAiConnection);
  document.getElementById('btnAiReportPreview').addEventListener('click', () => generateAiReport(false));
  document.getElementById('btnAiReportPush').addEventListener('click', () => generateAiReport(true));
  document.getElementById('btnSaveAiReportSchedule').addEventListener('click', saveAiReportSchedule);
}
