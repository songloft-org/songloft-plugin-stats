# play-stats

SongLoft 官方播放统计插件 — 记录播放历史,展示听歌次数与艺术家排行。

> 这是 SongLoft 官方插件,由社区贡献者开发和维护。

## 功能

- 自动记录歌曲播放完成事件（`onPlayEvent`）
- 总播放次数、听歌时长、艺术家/歌曲排行
- 按全部 / 近 7 天 / 近 30 天筛选
- 最近播放历史、清空记录
- 轻量 Web 面板，自动适配亮/暗主题

## 开发

```bash
npm install
npm run dev    # 联调本地 Songloft 实例
npm run build  # 生成 dist/play-stats.jsplugin.zip
npm run validate
```


## 要求

- Songloft 宿主版本 ≥ 2.8.2（需支持 `songloft.events.onPlayEvent`）
- 权限：`storage`、`songs.read`

## License

Apache-2.0
