# Songloft 插件：播放统计

一个用于 Songloft 的播放数据统计插件。自动记录播放完成事件，提供播放次数、听歌时长、不同歌曲/艺术家等概览，以及排行榜、趋势、时段分布等可视化统计；并支持定时推送日报、WebDAV 备份与恢复。

## 特性

- **播放记录**：订阅播放完成事件（finish）自动记录，内置去重机制（同一首歌在窗口内重复播放不重复计数）。
- **统计概览**：今日 / 本周 / 本月 / 全部 四个时间范围，展示播放次数、听歌时长、不同歌曲、不同艺术家。
- **排行榜**：热门艺术家、热门歌曲、热门专辑 Top 排行。
- **趋势与分布**：按天的播放趋势柱状图、一天 24 小时播放时段分布。
- **最近播放**：最近播放历史列表，支持加载更多。
- **定时推送**：每日定时将昨日统计摘要推送到 飞书 / WxPusher（两平台共用一个推送时间）。
- **WebDAV 备份**：将播放历史备份到 WebDAV 服务器，并支持从服务器下载备份文件导入恢复。

## 使用说明

### 安装与开发

```bash
# 安装依赖
npm install

# 编译构建（生成 dist/stats.jsplugin.zip）
npm run build

# 验证插件
npm run validate
```

将 `dist/stats.jsplugin.zip` 上传到 Songloft 即可使用。



## 目录结构

```
songloft-plugin-demo/
├── plugin.json              # 插件元数据（名称、入口、权限、哈希）
├── package.json             # 构建 / 验证脚本
├── tsconfig.json            # TypeScript 配置
├── manifest.json            # 更新清单
├── src/
│   ├── main.ts              # 生命周期入口（onInit / onDeinit / onHTTPRequest）
│   ├── router.ts            # HTTP 路由注册（/api/*）
│   ├── store.ts             # 播放历史存储与增量聚合
│   ├── aggregator.ts        # 统计计算（概览 / 趋势 / 时段分布）
│   ├── scheduler.ts         # 定时推送与定时备份调度
│   ├── pusher.ts            # 飞书 / WxPusher 推送实现
│   ├── webdav.ts            # WebDAV 连接 / 列举 / 上传 / 下载
│   ├── push/config.ts       # 推送配置与定时（全局共用时间）
│   ├── backup/config.ts     # WebDAV 备份配置与定时
│   └── types.ts             # 类型定义
├── static/
│   ├── index.html           # 前端页面（MD3 外壳 + 统计/设置 Tab）
│   ├── js/app.js            # 前端业务逻辑
│   └── css/style.css        # 组件样式（引用 --md-* 变量）
└── dist/                    # 构建产物
```

## API 一览

插件通过 `onHTTPRequest` 暴露以下接口（路径均经 `/jsplugin/stats` 前缀路由，前端使用 `SongloftPlugin.apiGet/apiPost` 调用）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/summary` | 指定时间范围的统计概览 |
| GET | `/api/stats/trends` | 按天播放趋势 |
| GET | `/api/stats/hourly` | 24 小时时段分布 |
| GET | `/api/history/list` | 最近播放历史（分页） |
| GET/POST | `/api/history/export` `/api/history/import` | 导出 / 导入历史 |
| GET/POST | `/api/settings` | 读取 / 保存设置（最大历史条数等） |
| GET/POST | `/api/push/config` | 推送平台配置 |
| GET/POST | `/api/push/schedule` | 定时推送配置（全局共用时间） |
| POST | `/api/push/trigger` | 手动触发推送（测试） |
| GET/POST | `/api/backup/webdav/config` | WebDAV 备份配置（增删改查） |
| GET | `/api/backup/webdav/list` | 列举服务器备份文件 |
| POST | `/api/backup/webdav/upload` | 上传备份 |
| POST | `/api/backup/webdav/download` | 下载备份并导入 |
| GET/POST | `/api/backup/schedule` | 定时备份配置 |

> 路径与字段以插件实际代码为准。
