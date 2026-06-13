/// <reference types="@songloft/plugin-sdk" />
import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse, PlayEvent } from '@songloft/plugin-sdk';
import { registerStatsHandlers } from './handlers/stats';
import { appendRecord } from './stats/store';

const router = createRouter();
registerStatsHandlers(router);

function subscribePlayEvents(): void {
  songloft.events.onPlayEvent(async (event: PlayEvent) => {
    songloft.log.info(
      `[PlayEvent] type=${event.type} source=${event.source} song=${event.song.artist} - ${event.song.title}`,
    );
    if (event.type !== 'finish') return;
    try {
      await appendRecord(event);
      songloft.log.info(
        `[已记录] ${event.song.artist} - ${event.song.title}`,
      );
    } catch (e) {
      songloft.log.error('记录播放失败: ' + String(e));
    }
  });
  songloft.log.info('[PlayEvent] 播放事件订阅已注册');
}

async function onInit(): Promise<void> {
  songloft.log.info('播放统计插件已启动');
  subscribePlayEvents();
}

async function onDeinit(): Promise<void> {
  songloft.events.offPlayEvent();
  songloft.log.info('播放统计插件已停止');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
