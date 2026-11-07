// 빌드한 서비스 워커를 Chromium 에서 돌린다: 등록·캐시 → 오프라인 새로고침 200 → 새 버전 배포 시 대기 워커 → SKIP_WAITING 으로 교체.
// 두 번 빌드(APP_VERSION 다르게)해 정적 서버의 서빙 폴더를 바꾸는 것으로 배포를 흉내 낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildSwFixture } from './helpers/fixture.ts';
import { startStaticServer } from './helpers/static-server.ts';
import { swInfo } from './helpers/sw-page.ts';

test('serviceWorker 브라우저: 등록·캐시·오프라인 새로고침·업데이트(대기 → SKIP_WAITING)', { timeout: 180_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'eolgae-sw-browser-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const v1 = await buildSwFixture('sw-v1', join(tmp, 'v1'));
  const v2 = await buildSwFixture('sw-v2', join(tmp, 'v2'));
  const server = await startStaticServer(v1);
  t.after(() => server.close());

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // 1) 등록·설치·제어. 앱이 load 이벤트에서 type: 'module' 로 등록한다.
  await page.goto(server.url);
  assert.equal(await page.textContent('[data-testid="version"]'), 'vsw-v1');
  const info = await swInfo(page);
  assert.equal(info.version, 'sw-v1');
  assert.ok(info.build.includes(info.payloadUrl), `서비스 워커가 쓰는 wasm(${info.payloadUrl})이 build 목록에 있어야 한다: ${info.build.join(',')}`);
  assert.equal(await page.textContent('[data-testid="payload"]'), info.payloadUrl, '앱과 서비스 워커가 같은 wasm 파일을 가리킨다');
  assert.ok(!info.build.some((f) => f.endsWith('.html')), 'build 에 index.html 이 없다');
  assert.deepEqual(info.files, ['/icons/icon.svg', '/robots.txt']);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]!);
    return { keys, urls: (await cache.keys()).map((r) => new URL(r.url).pathname).sort() };
  });
  assert.deepEqual(cached.keys, ['fixture-shell-sw-v1']);
  assert.deepEqual(cached.urls, [...info.build, ...info.files, '/'].sort());

  // 2) 오프라인 새로고침: 문서가 서비스 워커 캐시에서 200 으로 온다.
  await context.setOffline(true);
  const offline = await page.reload();
  assert.ok(offline, '응답');
  assert.equal(offline.status(), 200);
  assert.equal(offline.fromServiceWorker(), true);
  assert.equal(await page.textContent('[data-testid="version"]'), 'vsw-v1', '오프라인에서도 앱이 뜬다(JS·CSS 도 캐시에서)');
  await context.setOffline(false);

  // 3) 새 버전 배포 → 업데이트 확인 → 대기 워커. 서비스 워커가 skipWaiting 을 하지 않으므로 기다린다.
  server.setRoot(v2);
  const waiting = await page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!;
    await reg.update();
    const worker = reg.installing ?? reg.waiting;
    if (worker && worker.state !== 'installed') {
      await new Promise<void>((ok) => worker.addEventListener('statechange', () => worker.state === 'installed' && ok()));
    }
    return { waiting: !!reg.waiting, active: reg.active?.state ?? null };
  });
  assert.deepEqual(waiting, { waiting: true, active: 'activated' }, '새 워커는 대기 상태로 남는다');
  assert.equal((await swInfo(page)).version, 'sw-v1', 'SKIP_WAITING 전에는 옛 워커가 제어한다');

  // 4) SKIP_WAITING → controllerchange → 새 워커가 제어, 옛 캐시는 activate 에서 지워진다.
  await page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!;
    const changed = new Promise<void>((ok) => navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true }));
    reg.waiting!.postMessage({ type: 'SKIP_WAITING' });
    await changed;
  });
  assert.equal((await swInfo(page)).version, 'sw-v2');
  const keys = await page.evaluate(async () => {
    // activate 의 옛 캐시 삭제가 끝날 때까지 잠깐 기다린다.
    for (let i = 0; i < 50 && (await caches.keys()).length > 1; i++) await new Promise((ok) => setTimeout(ok, 100));
    return caches.keys();
  });
  assert.deepEqual(keys, ['fixture-shell-sw-v2']);
  assert.deepEqual(errors, []);
});
