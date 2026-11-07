// ws-spa fixture 용 시나리오. websocket 옵션을 기본값으로 두는 것과 ignoreQuery 를 켠 것 둘을 둔다.
import { defineScenarios } from '../src/index.ts';

export default defineScenarios([
  {
    name: 'ws-home',
    async run(page) {
      await page.goto('/');
      await page.waitForSelector('#app[data-ready="1"]');
    },
    screenshot: false,
  },
  {
    name: 'ws-ignore-query',
    async run(page) {
      await page.goto('/');
      await page.waitForSelector('#app[data-ready="1"]');
    },
    screenshot: false,
    websocket: { ignoreQuery: true, ignorePayload: true, timeoutMs: 200 },
  },
]);
