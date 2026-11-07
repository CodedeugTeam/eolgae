// vite dev 로 fixture 를 띄워 D-2 를 확인한다: node_modules 안 .svelte.js 가 컴파일돼 `$state` ReferenceError 가 없어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { ensureEntryDist, ensureFixtureLink, fixtureRoot } from './helpers/fixture.ts';

test('vite dev: fixture 기동 → 홈·소개 이동·$state 오류 없음', { timeout: 120_000 }, async (t) => {
  await ensureEntryDist();
  await ensureFixtureLink();
  const server = await createServer({ root: fixtureRoot, configFile: `${fixtureRoot}/vite.config.ts`, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
  await server.listen();
  t.after(() => server.close());
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, 'dev 서버 주소');

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(url);
  await page.waitForSelector('[data-page="home"]');
  assert.equal(await page.textContent('[data-testid="version"]'), 'vdev', 'APP_VERSION 기본 dev');
  await page.click('[data-testid="nav-about"]');
  await page.waitForSelector('[data-page="about"]');
  assert.equal(await page.textContent('[data-testid="page-url"]'), '/about', 'page.url 이 반응한다');
  assert.equal(await page.textContent('[data-testid="route-id"]'), '/about');
  await page.goBack();
  await page.waitForSelector('[data-page="home"]');
  assert.equal(await page.evaluate(() => (window as unknown as { __eolgaeBoots: number }).__eolgaeBoots), 1, '전체 이동 없음');
  // 표에 없는 경로 링크는 가로채지 않고 전체 이동 → dev 서버 SPA 폴백 → 폴백 라우트(*) 가 그린다. boots 가 2 가 된다.
  await page.click('[data-testid="nav-unknown"]');
  await page.waitForSelector('[data-page="not-found"]');
  assert.equal(await page.evaluate(() => (window as unknown as { __eolgaeBoots: number }).__eolgaeBoots), 1, '새 문서라 다시 1');
  assert.equal(await page.evaluate(() => location.pathname), '/not-in-table');
  assert.deepEqual(errors, []);
});
