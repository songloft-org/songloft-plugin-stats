const PUSH_CONFIG_KEY = 'push_config';
const PUSH_SCHEDULE_KEY = 'push_schedule';

export interface PlatformConfig {
  token: string;
  enabled: boolean;
}

export interface PushConfig {
  feishu: PlatformConfig;
  wxpusher: PlatformConfig;
}

export interface PushSchedule {
  enabled: boolean;
  hour: number;
  minute: number;
}

function defaultPushConfig(): PushConfig {
  return { feishu: { token: '', enabled: false }, wxpusher: { token: '', enabled: false } };
}

export async function loadPushConfig(): Promise<PushConfig> {
  try {
    const raw = await songloft.storage.get(PUSH_CONFIG_KEY);
    if (raw == null) return defaultPushConfig();
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // 兼容旧格式 { platform, token, enabled }
    if (data.platform !== undefined) {
      const platform = data.platform === 'feishu' || data.platform === 'wxpusher' ? data.platform : 'feishu';
      return {
        feishu: { token: platform === 'feishu' ? (data.token || '') : '', enabled: platform === 'feishu' ? !!data.enabled : false },
        wxpusher: { token: platform === 'wxpusher' ? (data.token || '') : '', enabled: platform === 'wxpusher' ? !!data.enabled : false },
      };
    }
    // 新格式：对每个平台配置设置默认值，防止 undefined
    return {
      feishu: data.feishu || { token: '', enabled: false },
      wxpusher: data.wxpusher || { token: '', enabled: false },
    };
  } catch {
    return defaultPushConfig();
  }
}

export async function savePushConfig(config: PushConfig): Promise<void> {
  await songloft.storage.set(PUSH_CONFIG_KEY, config);
}

export async function loadPushSchedule(): Promise<PushSchedule> {
  try {
    const raw = await songloft.storage.get(PUSH_SCHEDULE_KEY);
    if (raw == null) return { enabled: false, hour: 9, minute: 0 };
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      enabled: !!data.enabled,
      hour: typeof data.hour === 'number' ? data.hour : 9,
      minute: typeof data.minute === 'number' ? data.minute : 0,
    };
  } catch {
    return { enabled: false, hour: 9, minute: 0 };
  }
}

export async function savePushSchedule(schedule: PushSchedule): Promise<void> {
  await songloft.storage.set(PUSH_SCHEDULE_KEY, schedule);
}
