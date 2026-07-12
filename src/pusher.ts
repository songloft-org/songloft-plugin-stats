import type { StatsSummary } from './types';

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0分钟';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  if (m > 0) return `${m}分钟`;
  return `${sec}秒`;
}

/** HTML 转义，防止 XSS */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildPushContent(summary: StatsSummary): { title: string; content: string } {
  const topArtists = (summary.topArtists || []).slice(0, 3);
  const topSongs = (summary.topSongs || []).slice(0, 3);
  const lines: string[] = [];
  lines.push(`🎵 播放次数: ${summary.totalPlays}`);
  lines.push(`⏱ 听歌时长: ${formatDuration(summary.totalDurationSec)}`);
  lines.push(`🎶 不同歌曲: ${summary.uniqueSongs}`);
  lines.push(`🎤 不同歌手: ${summary.uniqueArtists}`);
  if (topArtists.length > 0) {
    lines.push('🏆 最爱歌手: ' + topArtists.map((a) => `${a.artist}(${a.plays})`).join(', '));
  }
  if (topSongs.length > 0) {
    lines.push('🎸 最爱歌曲: ' + topSongs.map((s) => `${s.title} - ${s.artist}`).join(', '));
  }
  return {
    title: '📊 昨日听歌报告',
    content: lines.join('\n'),
  };
}

/** 飞书推送实现 */
async function pushToFeishu(token: string, title: string, content: string): Promise<void> {
  let url = token;
  if (!token.startsWith('http')) {
    url = `https://open.feishu.cn/open-apis/bot/v2/hook/${encodeURIComponent(token)}`;
  }
  const body = JSON.stringify({
    msg_type: 'text',
    content: { text: `${title}\n\n${content}` },
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** WxPusher 极简推送实现 */
async function pushToWxPusher(spt: string, title: string, content: string): Promise<void> {
  const spts = spt.split(',').map((s) => s.trim()).filter(Boolean);
  if (spts.length === 0) throw new Error('SPT 不能为空');
  if (spts.length > 10) throw new Error('SPT 最多支持 10 个');

  const json: Record<string, any> = {
    content: `<h1>${escapeHtml(title)}</h1><br/><div style='white-space: pre-wrap;'>${escapeHtml(content).replace(/\n/g, '<br/>')}</div>`,
    summary: escapeHtml(title),
    contentType: 2,
  };
  if (spts.length === 1) {
    json.spt = spts[0];
  } else {
    json.sptList = spts;
  }

  const res = await fetch('https://wxpusher.zjiecode.com/api/send/message/simple-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const PLATFORM_PUSHERS: Record<string, (token: string, title: string, content: string) => Promise<void>> = {
  feishu: pushToFeishu,
  wxpusher: pushToWxPusher,
};

export { formatDuration, buildPushContent };

/** 测试推送内容：仅用于验证 webhook 连通性，不含统计 */
export function buildTestPushContent(): { title: string; content: string } {
  return {
    title: '📊 播放统计 · 测试推送',
    content: '这是一条测试消息，说明你的推送配置已生效 ✅',
  };
}

export function buildBackupPushContent(success: boolean, fileName?: string, recordCount?: number, error?: string): { title: string; content: string } {
  const lines: string[] = [];

  if (success) {
    lines.push('✅ 备份成功');
    lines.push(`📁 文件名: ${fileName || ''}`);
    if (recordCount != null) {
      lines.push(`📊 记录数: ${recordCount}`);
    }
    lines.push(`⏰ 时间: ${new Date().toLocaleString('zh-CN')}`);
  } else {
    lines.push('❌ 备份失败');
    if (error) {
      lines.push(`⚠️ 原因: ${error}`);
    }
    lines.push(`⏰ 时间: ${new Date().toLocaleString('zh-CN')}`);
  }

  return {
    title: '📦 播放统计备份',
    content: lines.join('\n'),
  };
}
