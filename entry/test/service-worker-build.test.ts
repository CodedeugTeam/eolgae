// 서비스 워커 fixture 를 vite build 해 2차 빌드 결과를 본다(Vite 8·7 두 축에서 돈다).
// service-worker.js 하나(.mjs 잔재 없음)·ESM import/export 없음·build 목록 = _app/immutable 전부(index.html 제외)·
// files = static 목록(.DS_Store 제외)·version·앱과 서비스 워커가 함께 쓰는 wasm 은 한 벌만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { buildSwFixture, swFixtureRoot } from './helpers/fixture.ts';

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
