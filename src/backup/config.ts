// WebDAV 备份配置管理

export interface BackupDavConfig {
  url: string
  username?: string
  password?: string
  name: string
}

export interface BackupSchedule {
  enabled: boolean
  hour: number
  minute: number
  configName: string
}

const CONFIG_KEY = 'backup_dav_configs'
const SCHEDULE_KEY = 'backup_schedule'

export async function getBackupDavConfigs(): Promise<BackupDavConfig[]> {
  try {
    const val = await songloft.storage.get(CONFIG_KEY)
    if (val) {
      return JSON.parse(val) as BackupDavConfig[]
    }
  } catch (err) {
    songloft.log.error('[备份] 获取 WebDAV 配置失败: ' + String(err))
  }
  return []
}

export async function saveBackupDavConfigs(configs: BackupDavConfig[]): Promise<void> {
  await songloft.storage.set(CONFIG_KEY, JSON.stringify(configs))
}

export async function getBackupDavConfig(name: string): Promise<BackupDavConfig | undefined> {
  const configs = await getBackupDavConfigs()
  return configs.find(c => c.name === name)
}

export async function loadBackupSchedule(): Promise<BackupSchedule> {
  try {
    const raw = await songloft.storage.get(SCHEDULE_KEY)
    if (raw == null) return { enabled: false, hour: 2, minute: 0, configName: '' }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      enabled: !!data.enabled,
      hour: typeof data.hour === 'number' ? data.hour : 2,
      minute: typeof data.minute === 'number' ? data.minute : 0,
      configName: typeof data.configName === 'string' ? data.configName : '',
    }
  } catch {
    return { enabled: false, hour: 2, minute: 0, configName: '' }
  }
}

export async function saveBackupSchedule(schedule: BackupSchedule): Promise<void> {
  await songloft.storage.set(SCHEDULE_KEY, schedule)
}
