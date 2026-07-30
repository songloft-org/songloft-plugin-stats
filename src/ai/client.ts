/// <reference types="@songloft/plugin-sdk" />
// OpenAI 兼容 API 客户端：配置存储 + chat completions 封装
// 一套配置通吃 DeepSeek / 通义 / Kimi / 本地 Ollama 等 OpenAI 兼容服务

const AI_CONFIG_KEY = 'ai_config';
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_TOKENS = 2048;

export interface AiConfig {
  /** API 根地址，如 https://api.deepseek.com/v1（不含 /chat/completions）*/
  baseUrl: string;
  apiKey: string;
  /** 模型名，如 deepseek-chat */
  model: string;
}

function defaultAiConfig(): AiConfig {
  return { baseUrl: '', apiKey: '', model: '' };
}

export async function loadAiConfig(): Promise<AiConfig> {
  try {
    const raw = await songloft.storage.get(AI_CONFIG_KEY);
    if (raw == null) return defaultAiConfig();
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
      model: typeof data.model === 'string' ? data.model : '',
    };
  } catch {
    return defaultAiConfig();
  }
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  await songloft.storage.set(AI_CONFIG_KEY, {
    baseUrl: String(config.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(config.apiKey || '').trim(),
    model: String(config.model || '').trim(),
  });
}

export async function isAiConfigured(): Promise<boolean> {
  const c = await loadAiConfig();
  return !!(c.baseUrl && c.apiKey && c.model);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 调用 chat completions，返回首条回复文本。QuickJS fetch 无 AbortController，用 Promise.race 兜底超时 */
export async function chatComplete(messages: ChatMessage[], opts?: { temperature?: number; jsonMode?: boolean; timeoutMs?: number; maxTokens?: number }): Promise<string> {
  const config = await loadAiConfig();
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error('AI 未配置，请先在设置中填写 API 地址、密钥和模型');
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: opts?.maxTokens ?? MAX_TOKENS,
    temperature: opts?.temperature ?? 0.7,
  };
  if (opts?.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  } as any);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}s）`)), timeoutMs)
  );

  const res = await Promise.race([request, timeout]);
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || JSON.stringify(errBody).slice(0, 200);
    } catch { /* 忽略响应体解析失败 */ }
    throw new Error(`AI 接口 HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 返回内容为空');
  }
  return content.trim();
}

/** 从 LLM 回复中提取 JSON 对象（容忍 markdown 代码块包裹）*/
export function extractJson(text: string): any {
  let s = text.trim();
  // 剥掉 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 截取首个 { 到最后一个 } 之间的内容
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** 连通性测试：让模型回一个字 */
export async function testAiConnection(): Promise<string> {
  return await chatComplete(
    [{ role: 'user', content: '请只回复两个字：正常' }],
    { temperature: 0, timeoutMs: 30 * 1000 }
  );
}
