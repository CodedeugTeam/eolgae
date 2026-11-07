// 하니스 static: 스모크. fixture 빌드를 old/new 둘 다로 넣어 라우트 직접 진입·내부 <a> 이동·뒤로가기가 돌고 종료 0 인지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../harness/src/run.ts';
import { startEchoServer } from '../../harness/test/helpers/echo-server.ts';
import { buildFixture, fixtureSpec } from './helpers/fixture.ts';

test('하니스 static: 자기 대조 — about 직접 진입·홈→소개 링크·뒤로가기, 네 축 차이 0', { timeout: 180_000 }, async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'eolgae-entry-smoke-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  // build.test.ts 가 같은 시점에 fixture 기본 build/ 를 지우고 다시 만들 수 있어 여기서는 임시 폴더로 빌드한다.
  const build = await buildFixture('fixture-smoke', join(out, 'fixture-build'));
  const backend = await startEchoServer();
  t.after(() => backend.close());

  const { report } = await run({
    old: `static:${build}`,
    new: `static:${build}`,
    backend: backend.url,
    scenarios: [fixtureSpec],
    out,
  });
  assert.equal(report.exitCode, 0, JSON.stringify(report.scenarios, null, 1).slice(0, 4000));
  assert.equal(report.scenarios.length, 2);
  for (const s of report.scenarios) {
    assert.equal(s.status, 'same', s.name);
    assert.equal(s.console?.oldErrors, 0, `${s.name}: 콘솔 에러 0`);
    assert.equal(s.console?.newErrors, 0, `${s.name}: 콘솔 에러 0`);
  }
});
