// 서비스 워커 fixture 를 옵션 없이(기존 동작) 돌리는 시나리오. 옵션을 켜지 않으면 서비스 워커 요청이
// 네트워크 축에 들어가지 않아, 보고서·종료 코드가 서비스 워커 수집을 넣기 전과 같아야 한다(골든 비교).
import type { Page } from 'playwright';
import { defineScenarios } from '../src/index.ts';

export async function swReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('#app[data-ready="1"]');
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
}

export default defineScenarios([{ name: 'sw-off', run: swReady }]);
