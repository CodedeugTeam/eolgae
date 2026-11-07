// 브라우저 테스트 공용: 서비스 워커가 페이지를 제어할 때까지 기다린 뒤 INFO 메시지로 가상 모듈 값을 읽는다.
import type { Page } from 'playwright';

export interface SwInfo {
  build: string[];
  files: string[];
  version: string;
  payloadUrl: string;
}

/** 제어 중인 서비스 워커(없으면 생길 때까지 기다림)에 INFO 를 보내 답을 받는다. */
export async function swInfo(page: Page): Promise<SwInfo> {
  return page.evaluate(async () => {
    const sw = navigator.serviceWorker;
    if (!sw.controller) await new Promise<void>((ok) => sw.addEventListener('controllerchange', () => ok(), { once: true }));
    const channel = new MessageChannel();
    const reply = new Promise<SwInfo>((ok) => (channel.port1.onmessage = (e) => ok(e.data as SwInfo)));
    sw.controller!.postMessage({ type: 'INFO' }, [channel.port2]);
    return reply;
  });
}
