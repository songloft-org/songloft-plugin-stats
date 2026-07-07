# songloft-plugin-stats

SongLoft 播放统计插件 — 记录播放历史，展示听歌次数与艺术家排行，支持定时推送听歌报告。

## 功能

- 自动记录歌曲播放完成事件（`onPlayEvent`）
- 总播放次数、听歌时长、艺术家/歌曲排行
- 最近播放历史
- 轻量 Web 面板，自动适配亮/暗主题
- 定时/手动推送昨日听歌报告
- WebDAV 备份与恢复（支持多服务器配置）
- 定时自动备份到 WebDAV，成功/失败均推送通知
- 支持飞书群机器人、WxPusher（极简推送 SPT）

## 开发

```bash
npm install
npm run dev    # 联调本地 Songloft 实例
npm run build  # 生成 dist/stats.jsplugin.zip
npm run validate
```


## 要求

- Songloft 宿主版本 ≥ 2.8.2（需支持 `songloft.events.onPlayEvent`）
- 权限：`storage`、`songs.read`


## License

Apache-2.0
