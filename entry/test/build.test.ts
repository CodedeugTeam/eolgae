// fixture 앱을 vite build 해 결과물 규약(아키텍처 3.3)을 확인한다: build/index.html, build/_app/immutable/, dist/·assets/ 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildFixture, fixtureRoot } from './helpers/fixture.ts';

const missing = (p: string) => assert.rejects(access(p), `${p} 는 없어야 한다`);

test('fixture vite build → build/index.html + build/_app/immutable/, Vite 기본 dist/·assets/ 없음', { timeout: 120_000 }, async () => {
  const out = await buildFixture('fixture-9.9.9');
  assert.equal(out, join(fixtureRoot, 'build'));
  await access(join(out, 'index.html'));
  const immutable = await readdir(join(out, '_app', 'immutable'));
  assert.ok(immutable.some((f) => f.endsWith('.js')), `_app/immutable 에 js 가 있어야 한다: ${immutable.join(',')}`);
  await missing(join(fixtureRoot, 'dist'));
  await missing(join(out, 'assets'));
  // publicDir=static 이 그대로 복사된다.
  assert.equal(await readFile(join(out, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n');
  // index.html 은 해시 자산을 /_app/immutable/ 아래에서 참조한다.
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /src="\/_app\/immutable\/[^"]+\.js"/);
  assert.doesNotMatch(html, /%sveltekit|data-sveltekit/);
  // define 으로 APP_VERSION 이 번들에 박힌다.
  const js = await Promise.all(immutable.filter((f) => f.endsWith('.js')).map((f) => readFile(join(out, '_app', 'immutable', f), 'utf8')));
  assert.ok(js.some((s) => s.includes('fixture-9.9.9')), 'APP_VERSION 치환');
  assert.ok(!js.some((s) => /\$state\(/.test(s)), '$state 호출은 컴파일되어 남지 않는다');
});
