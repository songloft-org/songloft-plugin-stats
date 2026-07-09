/// <reference types="@songloft/plugin-sdk" />
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import router from './router';
import { startScheduler, stopScheduler, subscribePlayEvents } from './scheduler';
import { drainWrites } from './store';

async function onInit(): Promise<void> {
  songloft.log.info('播放统计插件已启动');
  subscribePlayEvents();
  // 启动定时推送 / 备份调度
  startScheduler();
}

async function onDeinit(): Promise<void> {
  stopScheduler();
  await drainWrites();
  songloft.log.info('播放统计插件已停止');
}

async function onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse> {
  return await router.handle(req);
}

globalThis.onInit = onInit;
globalThis.onDeinit = onDeinit;
globalThis.onHTTPRequest = onHTTPRequest;
