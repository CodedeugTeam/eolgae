// 자기 대조 e2e. fixture SPA 를 old/new 둘 다로 넣으면 차이 0, spa-changed 를 new 로 넣으면 DOM 축 차이.
// chromium 을 실제로 띄우므로 다른 테스트보다 오래 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessError, run } from '../src/run.ts';
import type { Report } from '../src/report.ts';
import { makeChanged } from '../fixtures/make-changed.ts';
import { startEchoServer } from './helpers/echo-server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const spa = join(here, '..', 'fixtures', 'spa');
const spec = join(here, '..', 'fixtures', 'spa.spec.ts');

async function tmpOut(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eolgae-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('자기 대조: 같은 fixture 를 old/new 로 넣으면 네 축 차이 0, 종료 코드 0', { timeout: 120_000 }, async (t) => {
  const backend = await startEchoServer();
  t.after(() => backend.close());
  const out = await tmpOut(t);

  const result = await run({
    old: `static:${spa}`,
    new: `static:${spa}`,
    backend: backend.url,
    scenarios: [spec],
    out,
    headers: { 'x-forwarded-user': 'e2e-reviewer', authorization: 'Bearer SECRET-TOKEN-X' },
  });
  const { report } = result;
  assert.equal(report.exitCode, 0, JSON.stringify(report.summary));
  assert.equal(report.scenarios.length, 2);
  for (const s of report.scenarios) {
    assert.equal(s.status, 'same', `${s.name}: ${JSON.stringify(s, null, 1).slice(0, 2000)}`);
    assert.equal(s.console?.oldErrors, 0);
    assert.equal(s.network?.old.length, 1, '시나리오마다 /api/hello 한 번');
    assert.equal(s.network?.old[0]?.status, 200);
    assert.equal(s.ws?.oldCount, 0);
  }
  // 프록시가 x-forwarded-user 를 넣어 줬으므로 화면에 사용자 이름이 떴고, 그 DOM 이 저장됐다.
  const dom = await readFile(join(out, 'dom', 'home.old.html'), 'utf8');
  assert.match(dom, /hello e2e-reviewer/);
  assert.match(dom, /app\.HASH\.js/);
  assert.doesNotMatch(dom, /data-sveltekit/);
  // backend 에 도착한 요청에도 헤더가 있다.
  assert.ok(backend.received.every((r) => r.headers['x-forwarded-user'] === 'e2e-reviewer'));

  const jsonText = await readFile(result.reportJsonPath, 'utf8');
  const json = JSON.parse(jsonText) as Report;
  assert.equal(json.exitCode, 0);
  const md = await readFile(result.reportMdPath, 'utf8');
  assert.match(md, /같음 2 \/ 다름 0 \/ 오류 0/);
  // 헤더 값은 보고서에 남지 않고 키만 남는다.
  assert.deepEqual(json.targets.headers, ['x-forwarded-user=***', 'authorization=***']);
  assert.doesNotMatch(jsonText, /SECRET-TOKEN-X|e2e-reviewer=/);
  assert.doesNotMatch(md, /SECRET-TOKEN-X/);
  assert.match(md, /주입 헤더: `x-forwarded-user=\*\*\*`, `authorization=\*\*\*`/);
  await access(join(out, 'screenshots', 'home', 'old.png'));
  await access(join(out, 'screenshots', 'home', 'new.png'));
  await assert.rejects(access(join(out, 'screenshots', 'home', 'diff.png')), '차이가 없으면 diff.png 를 만들지 않는다');
  await access(join(out, 'network', 'deep-link.old.json'));
});

test('자기 대조: 글자 하나 바꾼 spa-changed 를 new 로 넣으면 DOM 축 차이·종료 코드 1·diff.png', { timeout: 120_000 }, async (t) => {
  const backend = await startEchoServer();
  t.after(() => backend.close());
  const out = await tmpOut(t);
  const changedDir = await mkdtemp(join(tmpdir(), 'eolgae-changed-'));
  t.after(() => rm(changedDir, { recursive: true, force: true }));
  const changed = await makeChanged(join(changedDir, 'spa-changed'));

  const { report } = await run({
    old: `static:${spa}`,
    new: `static:${changed}`,
    backend: backend.url,
    scenarios: [spec],
    out,
  });
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary.different, 2);
  for (const s of report.scenarios) {
    assert.equal(s.status, 'different');
    assert.equal(s.dom?.equal, false, 'DOM 축이 차이를 잡아야 한다');
    // 해시·svelte 클래스·__sveltekit 전역 차이는 정규화로 지워져 글자 차이만 남는다.
    assert.match(s.dom?.excerpt?.old ?? '', /가/);
    assert.match(s.dom?.excerpt?.new ?? '', /나/);
    assert.equal(s.network?.equal, true, '네트워크 축은 같아야 한다(/_app 자산 이름 차이는 제외)');
    assert.equal(s.console?.equal, true);
    // 글자가 바뀌었으므로 스크린샷도 다르다. 그대로 보고하고 diff.png 가 있어야 한다.
    assert.equal(s.screenshot && !s.screenshot.skipped ? s.screenshot.equal : null, false);
    await access(join(out, 'screenshots', s.slug, 'diff.png'));
  }
  const oldDom = await readFile(join(out, 'dom', 'home.old.html'), 'utf8');
  const newDom = await readFile(join(out, 'dom', 'home.new.html'), 'utf8');
  assert.equal(oldDom.replace('가', '나'), newDom, '정규화 뒤 남는 차이는 글자 하나뿐이어야 한다');
});

test('DOM 옵션: dom.root 는 <head> 차이를 범위 밖에 두고, dom.title 은 <title> 을 다시 비교에 넣고, 없는 root 는 실행 오류', { timeout: 120_000 }, async (t) => {
  const backend = await startEchoServer();
  t.after(() => backend.close());
  const out = await tmpOut(t);
  // <title> 만 다른 사본. 본문(#app)은 같다.
  const titleDir = join(await mkdtemp(join(tmpdir(), 'eolgae-title-')), 'spa-title');
  t.after(() => rm(dirname(titleDir), { recursive: true, force: true }));
  await cp(spa, titleDir, { recursive: true });
  const indexPath = join(titleDir, 'index.html');
  await writeFile(indexPath, (await readFile(indexPath, 'utf8')).replace('<title>eolgae fixture</title>', '<title>eolgae fixture (new)</title>'));

  const optSpec = join(out, 'dom-options.spec.ts');
  await writeFile(
    optSpec,
    [
      `import { defineScenarios } from '${join(root, 'harness', 'src', 'index.ts')}';`,
      "const ready = async (page) => { await page.goto('/'); await page.waitForSelector('#app[data-ready=\"1\"]'); };",
      'export default defineScenarios([',
      "  { name: 'whole', run: ready },",
      "  { name: 'root-only', run: ready, dom: { root: '#app' } },",
      "  { name: 'root-title', run: ready, dom: { root: '#app', title: true } },",
      "  { name: 'root-missing', run: ready, dom: { root: '#no-such-element' }, screenshot: false },",
      "  { name: 'api-only', run: ready, dom: { root: '#app' }, network: { apiOnly: true } },",
      ']);',
      '',
    ].join('\n'),
  );

  const { report } = await run({ old: `static:${spa}`, new: `static:${titleDir}`, backend: backend.url, scenarios: [optSpec], out });
  const by = Object.fromEntries(report.scenarios.map((s) => [s.name, s]));
  assert.equal(by['whole']?.status, 'different', '문서 전체 비교는 <title> 차이를 잡는다');
  assert.equal(by['whole']?.dom?.equal, false);
  assert.equal(by['root-only']?.status, 'same', 'root 범위에서는 <head> 가 빠져 같다');
  assert.equal(by['root-only']?.dom?.root, '#app');
  assert.equal(by['root-title']?.status, 'different', 'title 을 넣으면 다시 차이가 난다');
  assert.match(by['root-title']?.dom?.excerpt?.new ?? '', /\(new\)/);
  assert.equal(by['root-missing']?.status, 'error');
  assert.match(by['root-missing']?.error ?? '', /dom\.root "#no-such-element" 에 맞는 요소가 없습니다/);
  // 네트워크 범위: 기본 'all' 도 /api/hello 한 건뿐이고(/_app 자산·문서·favicon 제외), apiOnly 는 'api' 로 적힌다.
  assert.equal(by['whole']?.network?.scope, 'all');
  assert.deepEqual(by['whole']?.network?.old, [{ method: 'GET', path: '/api/hello?from=%2F', status: 200 }]);
  assert.equal(by['api-only']?.network?.scope, 'api');
  assert.equal(by['api-only']?.status, 'same');
  assert.equal(report.exitCode, 2, '실행 오류가 하나라도 있으면 2');
  const rootDom = await readFile(join(out, 'dom', 'root-only.old.html'), 'utf8');
  assert.match(rootDom, /^<div id="app"/, 'root 범위의 저장 파일은 그 요소부터 시작한다');
  assert.doesNotMatch(rootDom, /<head>/);
  const titleDom = await readFile(join(out, 'dom', 'root-title.new.html'), 'utf8');
  assert.match(titleDom, /^<title>eolgae fixture \(new\)<\/title> <div id="app"/);
  const md = await readFile(join(out, 'report.md'), 'utf8');
  assert.match(md, /- 범위: `#app` \+ <title>/);
  assert.match(md, /네트워크\(요청 순서\)/);
});

test('시나리오 파일은 있지만 시나리오가 0개면 실행 오류(HarnessError)', { timeout: 60_000 }, async (t) => {
  const out = await tmpOut(t);
  const emptySpec = join(out, 'empty.spec.ts');
  await writeFile(emptySpec, "import { defineScenarios } from '" + join(root, 'harness', 'src', 'index.ts') + "';\nexport default defineScenarios([]);\n");
  await assert.rejects(
    run({ old: `static:${spa}`, new: `static:${spa}`, backend: 'http://127.0.0.1:1', scenarios: [emptySpec], out }),
    (err: unknown) => err instanceof HarnessError && /시나리오가 하나도 없습니다/.test(err.message),
  );
});

test('CLI: --header 형식 오류는 스택 없이 메시지만 내고 종료 코드 2', { timeout: 60_000 }, async (t) => {
  const out = await tmpOut(t);
  const r = await runCli(['run', '--old', `static:${spa}`, '--new', `static:${spa}`, '--backend', 'http://127.0.0.1:1', '--scenarios', spec, '--out', out, '--header', 'novalue']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--header 형식은 k=v/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('CLI: 필수 인자가 없으면 종료 코드 2, help 는 0', { timeout: 60_000 }, async () => {
  const missing = await runCli(['run', '--old', 'static:x']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /필수 인자가 없습니다/);
  const help = await runCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /eolgae-harness run/);
  const unknown = await runCli(['frobnicate']);
  assert.equal(unknown.code, 2);
});

test('CLI: 대상 폴더가 없으면 실행 오류로 종료 코드 2', { timeout: 60_000 }, async (t) => {
  const out = await tmpOut(t);
  const r = await runCli([
    'run',
    '--old',
    `static:${join(spa, 'no-such-dir')}`,
    '--new',
    `static:${spa}`,
    '--backend',
    'http://127.0.0.1:1',
    '--scenarios',
    spec,
    '--out',
    out,
  ]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /대상 기동 실패/);
});

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, 'harness', 'src', 'cli.ts'), ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
