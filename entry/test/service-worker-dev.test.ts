// vite dev 의 서비스 워커 동작. 옛 SvelteKit dev(2.70.2)를 실측한 동작과 맞춘다:
// GET /service-worker.js → 200 application/javascript, 본문은 소스를 import 하는 한 줄(`import '/@fs<절대경로>';`).
// 모듈 워커로 등록되면 가상 모듈은 build: [], files: static 목록, version 을 낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { swFixtureRoot } from './helpers/fixture.ts';
import { swInfo } from './helpers/sw-page.ts';

test('vite dev: /service-worker.js 가 소스 import 한 줄을 돌려주고, 등록하면 build 빈 목록·files·version 을 받는다', { timeout: 120_000 }, async (t) => {
  const server = await createServer({ root: swFixtureRoot, configFile: join(swFixtureRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
  await server.listen();
  t.after(() => server.close());
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, 'dev 서버 주소');

  const res = await fetch(new URL('/service-worker.js', url));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/javascript');
  assert.equal(await res.text(), `import '/@fs${join(swFixtureRoot, 'src', 'service-worker.ts')}';`);

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url);
  const info = await swInfo(page);
  assert.deepEqual(info.build, [], 'dev 에서는 build 가 비어 있다(SvelteKit dev 와 같다)');
  assert.deepEqual(info.files, ['/icons/icon.svg', '/robots.txt']);
  assert.equal(info.version, process.env.APP_VERSION ?? 'dev');
  assert.deepEqual(errors, []);
});
