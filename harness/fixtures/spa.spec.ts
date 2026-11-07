// fixture SPA 용 시나리오. 앱 저장소의 harness/*.spec.ts 도 이 모양으로 쓴다.
// 앱 저장소에서는 '../src/index.ts' 대신 '@codedeugteam/eolgae/harness' 를 import 한다.
import { defineScenarios } from '../src/index.ts';

export default defineScenarios([
  {
    name: 'home',
    async run(page) {
      await page.goto('/');
      await page.waitForSelector('#app[data-ready="1"]');
    },
  },
  {
    name: 'deep-link',
    // 알 수 없는 경로로 직접 진입해도 index.html 폴백으로 같은 앱이 뜨는지 본다.
    async run(page) {
      await page.goto('/some/deep/path?x=1');
      await page.waitForSelector('#app[data-ready="1"]');
    },
    screenshot: { threshold: 0.1, maxDiffPixelRatio: 0 },
  },
]);
