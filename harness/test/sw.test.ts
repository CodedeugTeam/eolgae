// 서비스 워커 요청 수집(network.serviceWorker) 단위 테스트: 요약·집합 비교·보고서 표시.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkSignatures, serviceWorkerSignatures, type NetworkEntry } from '../src/normalize.ts';
import { compareNetwork, compareServiceWorkerRequests } from '../src/compare.ts';
import { buildReport, renderMarkdown, type ScenarioReport } from '../src/report.ts';

const base = 'http://127.0.0.1:5555';
const page = (seq: number, path: string, extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  seq,
  method: 'GET',
  url: base + path,
  resourceType: 'fetch',
  status: 200,
  t: seq,
  source: 'page',
  ...extra,
});
const sw = (seq: number, path: string, extra: Partial<NetworkEntry> = {}): NetworkEntry => page(seq, path, { source: 'service-worker', ...extra });

test('SW 요약: 페이지 요약(networkSignatures)에는 서비스 워커 요청이 들어가지 않는다', () => {
  const entries = [page(0, '/data.json'), sw(1, '/service-worker.js', { resourceType: 'other' }), sw(2, '/icon.svg')];
  assert.deepEqual(networkSignatures(entries), [{ method: 'GET', path: '/data.json', status: 200 }]);
});

test('SW 요약: 출처 표시가 없는 요청(옵션을 켜지 않은 수집)은 모두 페이지 요청으로 본다', () => {
  const entries: NetworkEntry[] = [{ seq: 0, method: 'GET', url: base + '/data.json', resourceType: 'fetch', status: 200, t: 0 }];
  assert.deepEqual(networkSignatures(entries), [{ method: 'GET', path: '/data.json', status: 200 }]);
  assert.deepEqual(serviceWorkerSignatures(entries), []);
});

test('SW 요약: 서비스 워커 요청만 남기고 기본 제외 규칙(문서·/_app/·favicon)을 같게 적용한 뒤 정렬한다', () => {
  const entries = [
    page(0, '/data.json'),
    sw(1, '/service-worker.js', { resourceType: 'other' }),
    sw(2, '/offline.txt'),
    sw(3, '/_app/immutable/entry/app.Ab12Cd34.js'),
    sw(4, '/favicon.png'),
    sw(5, '/'),
    sw(6, '/icon.svg', { status: undefined }),
  ];
  assert.deepEqual(serviceWorkerSignatures(entries), [
    { method: 'GET', path: '/', status: 200 },
    { method: 'GET', path: '/icon.svg', status: null },
    { method: 'GET', path: '/offline.txt', status: 200 },
    { method: 'GET', path: '/service-worker.js', status: 200 },
  ]);
  assert.deepEqual(
    serviceWorkerSignatures(entries, { apiOnly: true }),
    [],
    'apiOnly 면 서비스 워커 요청도 --api-prefix 요청만 남긴다',
  );
});

test('SW 비교: 순서가 달라도 같은 집합이면 같음, 다르면 old 에만·new 에만 있는 요청을 적는다', () => {
  const a = serviceWorkerSignatures([sw(0, '/a'), sw(1, '/b'), sw(2, '/b')]);
  const b = serviceWorkerSignatures([sw(5, '/b'), sw(6, '/a'), sw(7, '/b')]);
  assert.deepEqual(compareServiceWorkerRequests(a, b), { equal: true, old: a, new: b, onlyOld: [], onlyNew: [] });

  const c = serviceWorkerSignatures([sw(0, '/a'), sw(1, '/b'), sw(2, '/c', { status: 404 })]);
  const d = serviceWorkerSignatures([sw(0, '/b'), sw(1, '/b'), sw(2, '/c')]);
  const cmp = compareServiceWorkerRequests(c, d);
  assert.equal(cmp.equal, false);
  assert.deepEqual(cmp.onlyOld, ['GET /a → 200', 'GET /c → 404'], '중복은 개수까지 센다');
  assert.deepEqual(cmp.onlyNew, ['GET /b → 200', 'GET /c → 200']);
});

function scenarioWithNetwork(network: ScenarioReport['network']): ScenarioReport {
  return {
    name: 'sw-on',
    slug: 'sw-on',
    status: network?.equal ? 'same' : 'different',
    durationMs: { old: 1, new: 1 },
    network,
  };
}

const targets = {
  old: 'static:a',
  new: 'static:b',
  backend: 'http://127.0.0.1:4000',
  apiPrefix: '/api',
  viewport: '1280x720',
  headers: [],
  scenarioFiles: ['x.spec.ts'],
};

test('보고서: 서비스 워커 집합이 다르면 네트워크 칸에 SW 건수, 상세에 집합 차이를 적고 종료 코드 1', () => {
  const pageSigs = networkSignatures([page(0, '/data.json')]);
  const swCmp = compareServiceWorkerRequests(
    serviceWorkerSignatures([sw(0, '/'), sw(1, '/offline.txt')]),
    serviceWorkerSignatures([sw(0, '/'), sw(1, '/offline.html')]),
  );
  const network = {
    ...compareNetwork(pageSigs, pageSigs),
    equal: false,
    serviceWorker: swCmp,
    files: { old: 'network/sw-on.old.json', new: 'network/sw-on.new.json' },
    scope: 'all' as const,
  };
  const report = buildReport(targets, [scenarioWithNetwork(network)], '2026-01-01T00:00:00.000Z');
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary.axes.network, 1);
  const md = renderMarkdown(report);
  assert.match(md, /\| sw-on \| — 미수집 \| — 미수집 \| ❌ 다름 \(SW 2\/2\) \|/);
  assert.doesNotMatch(md, /#### 네트워크 \(요청 순서\)/, '페이지 요청 순서가 같으면 그 표는 적지 않는다');
  assert.match(md, /#### 네트워크 \(서비스 워커 요청 집합\)/);
  assert.match(md, /- old 에만: `GET \/offline\.txt → 200`/);
  assert.match(md, /- new 에만: `GET \/offline\.html → 200`/);
});

test('보고서: 서비스 워커 집합이 같으면 네트워크 칸에 같음과 SW 건수만 적는다', () => {
  const pageSigs = networkSignatures([page(0, '/data.json')]);
  const s = serviceWorkerSignatures([sw(0, '/'), sw(1, '/a')]);
  const network = {
    ...compareNetwork(pageSigs, pageSigs),
    serviceWorker: compareServiceWorkerRequests(s, s),
    files: { old: 'o', new: 'n' },
    scope: 'all' as const,
  };
  const report = buildReport(targets, [scenarioWithNetwork(network)], '2026-01-01T00:00:00.000Z');
  assert.equal(report.exitCode, 0);
  assert.match(renderMarkdown(report), /\| ✅ 같음 \(SW 2\/2\) \|/);
});
