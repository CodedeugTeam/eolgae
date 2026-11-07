// Vite 플러그인 config() 반환값. 결과물 규약·$lib·define·optimizeDeps.exclude(D-2).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';
import { eolgae, PACKAGE_NAME } from '../src/plugin.ts';

function configOf(plugin: ReturnType<typeof eolgae>, user: UserConfig = {}): UserConfig {
  const hook = plugin.config;
  assert.ok(hook && typeof hook === 'function');
  const out = (hook as (c: UserConfig, env: { command: 'build'; mode: string }) => UserConfig)(user, { command: 'build', mode: 'production' });
  return out;
}

describe('eolgae()', () => {
  test('기본값: build/·_app/immutable/·static/·$lib·APP_VERSION·자기 패키지 exclude', () => {
    const saved = process.env.APP_VERSION;
    process.env.APP_VERSION = '1.2.3';
    try {
      const c = configOf(eolgae(), { root: '/srv/app' });
      assert.equal(c.build?.outDir, 'build');
      assert.equal(c.build?.assetsDir, '_app/immutable');
      assert.equal(c.publicDir, 'static');
      assert.deepEqual(c.resolve?.alias, { $lib: resolve('/srv/app', 'src/lib') });
      assert.deepEqual(c.define, { 'import.meta.env.APP_VERSION': '"1.2.3"' });
      assert.deepEqual(c.optimizeDeps?.exclude, [PACKAGE_NAME]);
      assert.equal(PACKAGE_NAME, '@codedeugteam/eolgae');
    } finally {
      if (saved === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = saved;
    }
  });
  test('APP_VERSION 이 없으면 dev', () => {
    const saved = process.env.APP_VERSION;
    delete process.env.APP_VERSION;
    try {
      assert.deepEqual(configOf(eolgae()).define, { 'import.meta.env.APP_VERSION': '"dev"' });
    } finally {
      if (saved !== undefined) process.env.APP_VERSION = saved;
    }
  });
  test('옵션으로 바꿀 수 있고 lib:false 면 별칭을 넣지 않는다', () => {
    const c = configOf(eolgae({ version: 'x', lib: false, publicDir: 'public', outDir: 'out', assetsDir: 'a' }));
    assert.equal(c.resolve, undefined);
    assert.equal(c.publicDir, 'public');
    assert.equal(c.build?.outDir, 'out');
    assert.equal(c.build?.assetsDir, 'a');
    assert.deepEqual(c.define, { 'import.meta.env.APP_VERSION': '"x"' });
  });
  test('앱 vite.config 가 같은 키를 명시했으면 존중하고, 플러그인 옵션이 있으면 옵션이 이긴다', () => {
    const respected = configOf(eolgae(), { publicDir: 'public', build: { outDir: 'out', assetsDir: 'a' } });
    assert.equal(respected.publicDir, 'public');
    assert.equal(respected.build?.outDir, 'out');
    assert.equal(respected.build?.assetsDir, 'a');
    const overridden = configOf(eolgae({ outDir: 'build2' }), { build: { outDir: 'out' } });
    assert.equal(overridden.build?.outDir, 'build2');
  });
  test('serviceWorker 옵션을 주면 같은 플러그인 하나에 서비스 워커 훅이 붙고, config() 결과는 그대로다', () => {
    const plain = eolgae({ version: 'x' });
    const withSw = eolgae({ version: 'x', serviceWorker: {} });
    assert.equal(withSw.name, 'eolgae');
    assert.deepEqual(configOf(withSw, { root: '/srv/app' }), configOf(plain, { root: '/srv/app' }));
    for (const hook of ['configResolved', 'resolveId', 'load', 'configureServer', 'generateBundle', 'writeBundle'] as const) {
      assert.ok(withSw[hook], `${hook} 훅`);
      assert.equal(plain[hook], undefined, `옵션이 없으면 ${hook} 훅이 없다(v0.2.0 과 같은 동작)`);
    }
  });
});
