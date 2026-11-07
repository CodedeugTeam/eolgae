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
  // 최상위 문서 요청(전체 이동)만 센다. SPA 이동이면 늘지 않는다.
  const documents: string[] = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents.push(new URL(r.url()).pathname);
  });

  await page.goto(url);
  await page.waitForSelector('[data-page="home"]');
  assert.deepEqual(documents, ['/']);
  assert.equal(await page.textContent('[data-testid="version"]'), 'vdev', 'APP_VERSION 기본 dev');
  await page.click('[data-testid="nav-about"]');
  await page.waitForSelector('[data-page="about"]');
  assert.equal(await page.textContent('[data-testid="page-url"]'), '/about', 'page.url 이 반응한다');
  assert.equal(await page.textContent('[data-testid="route-id"]'), '/about');
  await page.goBack();
  await page.waitForSelector('[data-page="home"]');
  assert.deepEqual(documents, ['/'], '소개 이동·뒤로가기는 SPA 이동이라 문서 요청이 늘지 않는다');

  // 표에 없는 경로 링크: fixture 에 `*` 폴백이 있어도 가로채지 않고 전체 이동(문서 요청 1건, D-3).
  // dev 서버가 index.html 로 폴백한 뒤 직접 진입이므로 폴백 라우트(*) 가 그린다.
  await page.click('[data-testid="nav-unknown"]');
  await page.waitForSelector('[data-page="not-found"]');
  assert.deepEqual(documents, ['/', '/not-in-table'], '표 밖 링크는 문서 요청 1건(전체 이동)');
  assert.equal(await page.evaluate(() => location.pathname), '/not-in-table');
  assert.equal(await page.textContent('[data-testid="route-id"]'), '*');

  // data-eolgae-reload 링크도 전체 이동.
  await page.click('[data-testid="nav-legacy"]');
  await page.waitForSelector('[data-page="not-found"]');
  assert.deepEqual(documents, ['/', '/not-in-table', '/legacy-page']);
  assert.deepEqual(errors, []);
});
