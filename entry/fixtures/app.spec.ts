// entry fixture 앱용 하니스 시나리오. 라우트 직접 진입·내부 <a> 이동·뒤로가기를 확인한다.
import { defineScenarios } from '../../harness/src/index.ts';

export default defineScenarios([
  {
    name: 'about-direct',
    // /about 로 직접 진입: 정적 서버의 index.html 폴백 뒤 라우터가 About 을 그린다.
    async run(page) {
      await page.goto('/about');
      await page.waitForSelector('[data-page="about"]');
    },
  },
  {
    name: 'home-then-link',
    // 홈에서 내부 링크를 눌러 SPA 이동한 뒤 뒤로가기. 전체 이동 없이(boots=1) 라우트가 바뀌어야 한다.
    async run(page) {
      await page.goto('/');
      await page.waitForSelector('[data-page="home"]');
      await page.click('[data-testid="nav-about"]');
      await page.waitForSelector('[data-page="about"]');
      await page.waitForFunction(() => location.pathname === '/about' && window.__eolgaeBoots === 1);
      await page.goBack();
      await page.waitForSelector('[data-page="home"]');
      await page.waitForFunction(() => location.pathname === '/' && window.__eolgaeBoots === 1);
      await page.click('[data-testid="nav-about"]');
      await page.waitForSelector('[data-page="about"]');
    },
  },
]);

declare global {
  interface Window {
    __eolgaeBoots?: number;
  }
}
