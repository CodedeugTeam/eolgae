// 서비스 워커 fixture 를 vite build 해 2차 빌드 결과를 본다(Vite 8·7 두 축에서 돈다).
// service-worker.js 하나(.mjs 잔재 없음)·ESM import/export 없음·build 목록 = _app/immutable 전부(index.html 제외)·
// files = static 목록(.DS_Store 제외)·version·앱과 서비스 워커가 함께 쓰는 wasm 은 한 벌만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import * as vite from 'vite';
import { chromium } from 'playwright';
import { buildSwFixture, swFixtureRoot } from './helpers/fixture.ts';
import { startStaticServer } from './helpers/static-server.ts';

const isRolldown = !!(vite as unknown as Record<string, unknown>).rolldownVersion;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

test('serviceWorker 빌드: service-worker.js·build/files/version·wasm 한 벌·index.html 미포함', { timeout: 120_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'eolgae-sw-build-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const out = await buildSwFixture('sw-1.2.3', join(tmp, 'build'));
  const all = (await walk(out)).map((f) => relative(out, f).split(sep).join('/')).sort();

  assert.ok(all.includes('service-worker.js'), `service-worker.js 가 outDir 바로 아래 있어야 한다: ${all.join(',')}`);
  assert.ok(!all.some((f) => f.endsWith('.mjs')), `.mjs 잔재가 없어야 한다: ${all.join(',')}`);
  const sw = await readFile(join(out, 'service-worker.js'), 'utf8');
  assert.doesNotMatch(sw, /(^|[;\s}])import\s*[\w{*'"`]/, '정적 import 가 없어야 한다(한 파일로 묶임)');
  assert.doesNotMatch(sw, /(^|[;\s}])export\s*[{*]|(^|[;\s}])export\s+(const|let|var|function|default)\b/, 'export 가 없어야 한다');

  // build 목록 = 메인 빌드가 낸 _app/immutable 파일 전부. 2차 빌드가 자산을 따로 내지 않으므로 출력의 _app/immutable 과 같다.
  const immutable = all.filter((f) => f.startsWith('_app/immutable/'));
  const wasm = all.filter((f) => f.endsWith('.wasm'));
  assert.equal(wasm.length, 1, `wasm 은 한 벌만 있어야 한다: ${wasm.join(',')}`);
  assert.ok(immutable.some((f) => f.endsWith('.js')) && immutable.some((f) => f.endsWith('.css')), immutable.join(','));
  for (const f of immutable) assert.ok(sw.includes(`/${f}`), `build 목록에 /${f} 가 있어야 한다`);
  assert.ok(sw.includes(`_app/immutable/${wasm[0]!.split('/').pop()}`), '서비스 워커 코드가 같은 wasm 을 가리킨다');
  assert.ok(!sw.includes('index.html'), 'build 목록에 index.html 이 없어야 한다');
  assert.ok(!sw.includes('.map'), 'sourcemap 이 없어야 한다');

  // files = static 목록(.DS_Store 제외). .DS_Store 파일 자체는 Vite 가 publicDir 를 복사하므로 출력에는 있다(SvelteKit 과 같다).
  assert.ok(sw.includes('/robots.txt') && sw.includes('/icons/icon.svg'), 'files 목록');
  assert.ok(!sw.includes('.DS_Store'), 'files 에서 .DS_Store 는 빠진다');
  assert.ok(sw.includes('sw-1.2.3'), 'version');

  // 메인 빌드 결과물 규약은 그대로다.
  await access(join(out, 'index.html'));
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /src="\/_app\/immutable\/[^"]+\.js"/);
});

test('serviceWorker 빌드: index.html 이 아닌 입력(Storybook 꼴)이면 서비스 워커를 빌드하지 않는다', { timeout: 120_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'eolgae-sw-iframe-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const out = await buildSwFixture('sw-iframe', join(tmp, 'build'), { EOLGAE_FIXTURE_INPUT: join(swFixtureRoot, 'iframe.html') });
  const all = await readdir(out);
  assert.ok(all.includes('iframe.html'), all.join(','));
  assert.ok(!all.includes('service-worker.js') && !all.includes('service-worker.mjs'), `서비스 워커가 없어야 한다: ${all.join(',')}`);
});

test('serviceWorker 빌드: 동적 import 도 두 축 모두 한 파일로 인라인(청크·import() 없음), build 목록은 메인 빌드 결과, 브라우저에서 동작', { timeout: 120_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'eolgae-sw-dynamic-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const out = await buildSwFixture('sw-dyn', join(tmp, 'build'), { EOLGAE_FIXTURE_SW_SRC: 'src/service-worker-dynamic.ts' });
  const all = (await walk(out)).map((f) => relative(out, f).split(sep).join('/')).sort();
  const sw = await readFile(join(out, 'service-worker.js'), 'utf8');

  // (가) 청크 파일·.mjs 잔재·import() 가 없고, 동적 import 한 모듈이 service-worker.js 안에 들어 있다.
  assert.ok(!all.some((f) => /(^|\/)lazy[-.]/.test(f)), `${isRolldown ? 'Vite 8(codeSplitting: false)' : 'Vite 7(inlineDynamicImports)'}: 청크가 없어야 한다: ${all.join(',')}`);
  assert.ok(!all.some((f) => f.endsWith('.mjs')), all.join(','));
  assert.doesNotMatch(sw, /\bimport\s*\(/, 'import() 가 남지 않는다');
  assert.ok(sw.includes('lazy-loaded'), '동적 import 모듈이 인라인된다');

  // (나) build 목록 = 메인 빌드가 낸 _app/immutable 파일 전부(2차 빌드가 따로 낸 파일이 없다). 정확한 목록은 (다)에서 서비스 워커가 돌려준 값으로 본다.
  const immutable = all.filter((f) => f.startsWith('_app/immutable/')).map((f) => `/${f}`);
  for (const f of immutable) assert.ok(sw.includes(f), `build 목록에 ${f}`);

  // (다) 브라우저에서 등록되고, 메시지 처리 중 동적 import 한 값을 돌려준다.
  const server = await startStaticServer(out);
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    const reply = new Promise<{ lazyValue: string; version: string; build: string[] }>((ok) => (channel.port1.onmessage = (e) => ok(e.data)));
    reg.active!.postMessage({ type: 'INFO' }, [channel.port2]);
    return reply;
  });
  assert.equal(info.lazyValue, 'lazy-loaded');
  assert.equal(info.version, 'sw-dyn');
  assert.deepEqual([...info.build].sort(), immutable);
  assert.deepEqual(errors, []);
});
