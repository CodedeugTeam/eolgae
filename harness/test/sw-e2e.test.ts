// 서비스 워커 fixture e2e. chromium 을 실제로 띄운다.
// - 옵션을 켜지 않으면(sw-spa-off.spec.ts) 보고서·종료 코드·네트워크 축 판정이 서비스 워커 수집을 넣기 전과 같다(골든 비교).
// - 옵션을 켜면(sw-spa.spec.ts) 같은 빌드끼리는 종료 0, 미리 캐시 목록만 다른 빌드는 서비스 워커 집합 차이로 종료 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type RunOptions } from '../src/run.ts';
import type { NetworkEntry } from '../src/normalize.ts';
import { makeSwChanged } from '../fixtures/make-sw-changed.ts';
import { startEchoServer } from './helpers/echo-server.ts';
import { normalizeReportJson, normalizeReportMd } from './helpers/golden.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, '..', 'fixtures');
const spa = join(fx, 'spa');
const swSpa = join(fx, 'sw-spa');
const spaSpec = join(fx, 'spa.spec.ts');
const swOnSpec = join(fx, 'sw-spa.spec.ts');
const swOffSpec = join(fx, 'sw-spa-off.spec.ts');
const golden = join(here, 'golden');

async function tmpDir(t: { after(fn: () => Promise<void>): void }, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** run 한 결과를 골든과 같은 방식으로 정규화해 골든 파일과 비교한다(gen 은 기준 커밋 코드로 같은 입력을 돌려 만든 것). */
async function assertGolden(name: string, opts: Omit<RunOptions, 'out'> & { out: string }, backendURL: string): Promise<number> {
  const r = await run(opts);
  const oldDir = opts.old.slice('static:'.length);
  const newDir = opts.new.slice('static:'.length);
  const spec = opts.scenarios[0]!;
  // 골든 생성 때와 같은 순서로 넣는다(old 와 new 가 같은 폴더면 뒤의 '<new>' 가 남는다).
  const paths = { [oldDir]: '<old>', [newDir]: '<new>', [spec]: '<spec>', [backendURL]: '<backend>', [fx]: '<fixtures>' };
  const json = normalizeReportJson(await readFile(r.reportJsonPath, 'utf8'), paths);
  const md = normalizeReportMd(await readFile(r.reportMdPath, 'utf8'), paths);
  assert.equal(json, await readFile(join(golden, `${name}.report.json`), 'utf8'), `${name}: report.json 이 골든과 다르다`);
  assert.equal(md, await readFile(join(golden, `${name}.report.md`), 'utf8'), `${name}: report.md 가 골든과 다르다`);
  return r.report.exitCode;
}

async function readRequests(out: string, slug: string, side: 'old' | 'new'): Promise<NetworkEntry[]> {
  return (JSON.parse(await readFile(join(out, 'network', `${slug}.${side}.json`), 'utf8')) as { requests: NetworkEntry[] }).requests;
}

test('회귀: 옵션을 켜지 않으면 기존 fixture·서비스 워커 fixture 모두 보고서·종료 코드·네트워크 축이 골든과 같다', { timeout: 240_000 }, async (t) => {
  const backend = await startEchoServer();
  t.after(() => backend.close());
  const tmp = await tmpDir(t, 'eolgae-sw-golden-');
  const changed = await makeSwChanged(join(tmp, 'sw-spa-changed'));

  const spaOut = await tmpDir(t, 'eolgae-sw-out-');
  const headers = { 'x-forwarded-user': 'e2e-reviewer', authorization: 'Bearer SECRET-TOKEN-X' };
  assert.equal(await assertGolden('spa-self', { old: `static:${spa}`, new: `static:${spa}`, backend: backend.url, scenarios: [spaSpec], out: spaOut, headers }, backend.url), 0);

  const selfOut = await tmpDir(t, 'eolgae-sw-out-');
  assert.equal(await assertGolden('sw-off-self', { old: `static:${swSpa}`, new: `static:${swSpa}`, backend: backend.url, scenarios: [swOffSpec], out: selfOut }, backend.url), 0);

  // 옵션을 켜지 않으면 서비스 워커 미리 캐시 목록 차이는 보이지 않는다(기존 동작 그대로 종료 0).
  const negOut = await tmpDir(t, 'eolgae-sw-out-');
  assert.equal(await assertGolden('sw-off-negative', { old: `static:${swSpa}`, new: `static:${changed}`, backend: backend.url, scenarios: [swOffSpec], out: negOut }, backend.url), 0);

  // 원본 network json 에도 출처 표시나 서비스 워커 요청이 들어가지 않는다.
  for (const side of ['old', 'new'] as const) {
    const reqs = await readRequests(negOut, 'sw-off', side);
    assert.ok(reqs.length > 0);
    assert.ok(reqs.every((r) => !('source' in r)), `${side}: 옵션을 끄면 source 필드가 없다`);
    assert.ok(!reqs.some((r) => /\/offline\.(txt|html)$/.test(r.url)), `${side}: 서비스 워커 요청이 섞이지 않는다`);
  }
});

test('자기 대조(--self): 옵션을 켜고 같은 서비스 워커 빌드를 old/new 로 넣으면 SW 요청까지 같아 종료 코드 0', { timeout: 120_000 }, async (t) => {
  const out = await tmpDir(t, 'eolgae-sw-out-');
  const { report } = await run({ old: `static:${swSpa}`, new: `static:${swSpa}`, backend: 'http://127.0.0.1:1', scenarios: [swOnSpec], out });
  assert.equal(report.exitCode, 0, JSON.stringify(report.scenarios[0]?.network, null, 1));
  const s = report.scenarios[0]!;
  assert.equal(s.status, 'same');
  const swCmp = s.network?.serviceWorker;
  assert.ok(swCmp, '옵션을 켜면 보고서에 서비스 워커 비교가 붙는다');
  assert.equal(swCmp.equal, true);
  // /_app/ 자산은 기본 제외 규칙으로 빠지고, 서비스 워커 스크립트·미리 캐시 목록이 남는다.
  assert.deepEqual(
    swCmp.old.map((x) => `${x.method} ${x.path} ${x.status}`),
    ['GET / 200', 'GET /icon.svg 200', 'GET /manifest.webmanifest 200', 'GET /offline.txt 200', 'GET /service-worker.js 200'],
  );
  assert.deepEqual(s.network?.old, [{ method: 'GET', path: '/data.json', status: 200 }], '페이지 요청 순서 비교는 그대로다');

  // 원본 network json 에는 출처가 page / service-worker 로 표시된다.
  const reqs = await readRequests(out, 'sw-on', 'old');
  const bySource = (src: string) => reqs.filter((r) => r.source === src).map((r) => new URL(r.url).pathname);
  assert.ok(bySource('page').includes('/data.json'));
  assert.ok(bySource('service-worker').includes('/service-worker.js'));
  assert.ok(bySource('service-worker').includes('/_app/immutable/entry/app.Sw7kQ2xP.js'), '원본에는 제외 전 요청이 모두 남는다');
  assert.ok(reqs.every((r) => r.source === 'page' || r.source === 'service-worker'));

  const md = await readFile(join(out, 'report.md'), 'utf8');
  assert.match(md, /\| sw-on \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \(SW 5\/5\) \|/);
});

test('음성 대조(--negative): 옵션을 켜면 미리 캐시 목록만 다른 빌드를 서비스 워커 집합 차이로 잡아 종료 코드 1', { timeout: 120_000 }, async (t) => {
  const tmp = await tmpDir(t, 'eolgae-sw-neg-');
  const changed = await makeSwChanged(join(tmp, 'sw-spa-changed'));
  const out = await tmpDir(t, 'eolgae-sw-out-');
  const { report } = await run({ old: `static:${swSpa}`, new: `static:${changed}`, backend: 'http://127.0.0.1:1', scenarios: [swOnSpec], out });
  assert.equal(report.exitCode, 1);
  const s = report.scenarios[0]!;
  assert.equal(s.status, 'different');
  assert.equal(s.dom?.equal, true, '화면·DOM 은 같다');
  assert.equal(s.screenshot && !s.screenshot.skipped && s.screenshot.equal, true);
  assert.equal(s.network?.equal, false);
  assert.equal(s.network?.firstDiffIndex, undefined, '페이지 요청 순서는 같다');
  assert.deepEqual(s.network?.serviceWorker?.onlyOld, ['GET /offline.txt → 200']);
  assert.deepEqual(s.network?.serviceWorker?.onlyNew, ['GET /offline.html → 200']);
  assert.equal(report.summary.axes.network, 1);
  const md = await readFile(join(out, 'report.md'), 'utf8');
  assert.match(md, /#### 네트워크 \(서비스 워커 요청 집합\)/);
  assert.match(md, /- new 에만: `GET \/offline\.html → 200`/);
});
