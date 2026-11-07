// 서비스 워커 매니페스트의 순수 함수: 빌드 판정(Storybook 가드)·build 목록 고르기·정적 파일 목록·가상 모듈 본문·옵션 해석.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { createServiceWorkerModule, isAppBuild, listStaticFiles, resolveServiceWorkerOptions, selectBuildFiles, SERVICE_WORKER_MODULE_ID } from '../src/service-worker.ts';

type BuildCheck = Parameters<typeof isAppBuild>[0];
const cfg = (command: 'build' | 'serve', build: Record<string, unknown> = {}): BuildCheck =>
  ({ command, root: '/srv/app', build: build as unknown as ResolvedConfig['build'] }) as BuildCheck;

describe('isAppBuild: vite build 의 앱 빌드에서만 서비스 워커를 빌드한다', () => {
  test('입력이 없거나 root 의 index.html 하나면 앱 빌드', () => {
    assert.equal(isAppBuild(cfg('build', { rollupOptions: {} })), true);
    assert.equal(isAppBuild(cfg('build', { rollupOptions: { input: '/srv/app/index.html' } })), true);
    assert.equal(isAppBuild(cfg('build', { rolldownOptions: { input: { main: 'index.html' } } })), true);
  });
  test('dev·vitest(serve), SSR·라이브러리 빌드, Storybook(iframe.html 입력)·여러 입력은 앱 빌드가 아니다', () => {
    assert.equal(isAppBuild(cfg('serve')), false);
    assert.equal(isAppBuild(cfg('build', { ssr: true })), false);
    assert.equal(isAppBuild(cfg('build', { lib: { entry: 'src/index.ts' } })), false);
    assert.equal(isAppBuild(cfg('build', { rollupOptions: { input: '/x/node_modules/@storybook/builder-vite/input/iframe.html' } })), false);
    assert.equal(isAppBuild(cfg('build', { rolldownOptions: { input: ['/srv/app/index.html', '/srv/app/other.html'] } })), false);
  });
});

test('selectBuildFiles: index.html·sourcemap·.vite/ manifest 를 빼고 정렬한다', () => {
  const keys = ['index.html', '_app/immutable/index-b.js', '_app/immutable/index-b.js.map', '_app/immutable/a.css', '_app/immutable/payload-x.wasm', '.vite/manifest.json', 'nested/page.html'];
  assert.deepEqual(selectBuildFiles(keys), ['_app/immutable/a.css', '_app/immutable/index-b.js', '_app/immutable/payload-x.wasm']);
});

test('listStaticFiles: 재귀·/ 구분·정렬, 기본 필터는 .DS_Store 제외, 폴더가 없거나 false 면 빈 목록', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'eolgae-sw-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'icons', 'deep'), { recursive: true });
  await writeFile(join(dir, 'robots.txt'), '');
  await writeFile(join(dir, '.DS_Store'), '');
  await writeFile(join(dir, 'icons', '.DS_Store'), '');
  await writeFile(join(dir, 'icons', 'deep', 'a.png'), '');
  const { files } = resolveServiceWorkerOptions({}, dir);
  assert.deepEqual(listStaticFiles(dir, files), ['icons/deep/a.png', 'robots.txt']);
  assert.deepEqual(listStaticFiles(dir, (f) => f.endsWith('.txt')), ['robots.txt']);
  assert.deepEqual(listStaticFiles(join(dir, 'none'), files), []);
  assert.deepEqual(listStaticFiles(false, files), []);
});

test('createServiceWorkerModule: build·files·version 을 내보내고 경로 앞에 base 를 붙인다. dev 는 서비스 워커 밖 import 를 막는다', () => {
  const code = createServiceWorkerModule({ base: '/', build: ['_app/immutable/a.js'], files: ['robots.txt'], version: 'v"1', dev: false });
  assert.equal(code, 'export const build = ["/_app/immutable/a.js"];\nexport const files = ["/robots.txt"];\nexport const version = "v\\"1";\n');
  const dev = createServiceWorkerModule({ base: '/', build: [], files: [], version: 'dev', dev: true });
  assert.match(dev, /ServiceWorkerGlobalScope/);
  assert.match(dev, /export const build = \[\];/);
  assert.equal(SERVICE_WORKER_MODULE_ID, 'virtual:eolgae/service-worker');
});

test('resolveServiceWorkerOptions: 기본 src/service-worker.ts, 없으면 .js, fileName 은 폴더 없는 .js 만', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'eolgae-sw-opts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(resolveServiceWorkerOptions({}, dir).src, undefined);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'service-worker.js'), '');
  assert.equal(resolveServiceWorkerOptions({}, dir).src, resolve(dir, 'src/service-worker.js'));
  await writeFile(join(dir, 'src', 'service-worker.ts'), '');
  assert.equal(resolveServiceWorkerOptions({}, dir).src, resolve(dir, 'src/service-worker.ts'));
  assert.equal(resolveServiceWorkerOptions({}, dir).fileName, 'service-worker.js');
  assert.equal(resolveServiceWorkerOptions({ fileName: 'sw.js' }, dir).fileName, 'sw.js');
  assert.throws(() => resolveServiceWorkerOptions({ fileName: 'sw.mjs' }, dir));
  assert.throws(() => resolveServiceWorkerOptions({ fileName: 'a/sw.js' }, dir));
});
