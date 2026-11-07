import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderMarkdown, scenarioStatus, type ScenarioReport } from '../src/report.ts';

const targets = {
  old: 'static:build-old',
  new: 'url:http://127.0.0.1:3000',
  backend: 'http://127.0.0.1:4000',
  apiPrefix: '/api',
  viewport: '1280x720',
  headers: ['x-forwarded-user=e2e-reviewer'],
  scenarioFiles: ['harness/spa.spec.ts'],
};

function sameScenario(name: string): ScenarioReport {
  return {
    name,
    slug: name,
    status: 'same',
    durationMs: { old: 10, new: 12 },
    screenshot: {
      skipped: false,
      equal: true,
      threshold: 0.1,
      maxDiffPixelRatio: 0,
      diffPixels: 0,
      diffRatio: 0,
      old: { width: 1280, height: 720 },
      new: { width: 1280, height: 720 },
      sizeMismatch: false,
      files: { old: `screenshots/${name}/old.png`, new: `screenshots/${name}/new.png` },
    },
    dom: { equal: true, oldLength: 100, newLength: 100, files: { old: `dom/${name}.old.html`, new: `dom/${name}.new.html` } },
    network: {
      equal: true,
      old: [{ method: 'GET', path: '/api/hello', status: 200 }],
      new: [{ method: 'GET', path: '/api/hello', status: 200 }],
      files: { old: `network/${name}.old.json`, new: `network/${name}.new.json` },
    },
    console: { equal: true, oldErrors: 0, newErrors: 0, old: [], new: [{ type: 'log', text: 'ready' }] },
    ws: {
      compared: true,
      equal: true,
      old: { connections: [], frames: [], openCount: 0, closeCount: 0, errorCount: 0 },
      new: { connections: [], frames: [], openCount: 0, closeCount: 0, errorCount: 0 },
      options: { ignoreQuery: false, messageKey: 'type', ignorePayload: false, timeoutMs: 1000 },
      files: { old: `network/${name}.old.json`, new: `network/${name}.new.json` },
    },
  };
}

test('보고서: 차이가 없으면 종료 코드 0 과 같음 표가 나온다', () => {
  const report = buildReport(targets, [sameScenario('home')], '2026-11-07T00:00:00.000Z');
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.summary, { total: 1, same: 1, different: 0, error: 0, axes: { screenshot: 0, dom: 0, network: 0, console: 0, websocket: 0 } });
  const md = renderMarkdown(report);
  assert.match(md, /^# eolgae 패리티 보고서/);
  assert.match(md, /\| home \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \(연결 0\/0, 프레임 0\/0\) \|/);
  assert.doesNotMatch(md, /## 차이 상세/);
  // 콘솔 메시지 목록은 차이가 없어도 적는다.
  assert.match(md, /- new: 1건\n {2}- \[log\] ready/);
});

test('보고서: DOM·네트워크·스크린샷 차이는 상세 절에 발췌와 파일 경로를 적고 종료 코드 1', () => {
  const s = sameScenario('deep-link');
  s.dom = {
    equal: false,
    oldLength: 100,
    newLength: 100,
    excerpt: { index: 42, old: '<h1>가</h1>', new: '<h1>나</h1>' },
    files: s.dom!.files,
  };
  s.network = {
    equal: false,
    old: [{ method: 'GET', path: '/api/a', status: 200 }],
    new: [{ method: 'GET', path: '/api/b', status: 200 }],
    firstDiffIndex: 0,
    files: s.network!.files,
  };
  s.screenshot = {
    ...(s.screenshot as Extract<ScenarioReport['screenshot'], { skipped: false }>),
    equal: false,
    diffPixels: 12,
    diffRatio: 12 / (1280 * 720),
    files: { old: 'screenshots/deep-link/old.png', new: 'screenshots/deep-link/new.png', diff: 'screenshots/deep-link/diff.png' },
  };
  s.status = scenarioStatus(s);
  assert.equal(s.status, 'different');

  const report = buildReport(targets, [sameScenario('home'), s]);
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.summary.axes, { screenshot: 1, dom: 1, network: 1, console: 0, websocket: 0 });
  const md = renderMarkdown(report);
  assert.match(md, /\| deep-link \| ❌ 다름 \| ❌ 다름 \| ❌ 다름 \| ✅ 같음 \|/);
  assert.match(md, /## 차이 상세/);
  assert.match(md, /첫 차이 위치: 42/);
  assert.match(md, /```html\n<h1>가<\/h1>\n```/);
  assert.match(md, /\| \*\*0\*\* \| GET \/api\/a → 200 \| GET \/api\/b → 200 \|/);
  // scope 가 없는 v0.1.0 보고서는 apiPrefix 요청만 비교한 것으로 적는다.
  assert.match(md, /- 범위: `\/api` 요청만/);
  assert.match(md, /- diff: `screenshots\/deep-link\/diff\.png`/);
  assert.match(md, /다른 픽셀 12개/);
});

test('보고서: 실행 오류가 있으면 종료 코드 2 이고 오류 메시지를 적는다', () => {
  const err: ScenarioReport = { name: 'broken', slug: 'broken', status: 'error', durationMs: { old: 0, new: 0 }, error: 'Error: boom\n  at x' };
  const report = buildReport(targets, [sameScenario('home'), err]);
  assert.equal(report.exitCode, 2);
  const md = renderMarkdown(report);
  assert.match(md, /\| broken \| ⚠️ 오류 \|/);
  assert.match(md, /실행 오류:\n\n```\nError: boom\n {2}at x\n```/);
});

test('보고서: 콘솔 에러가 있으면 콘솔 축만 다름이고 건수를 적는다', () => {
  const s = sameScenario('home');
  s.console = { equal: false, oldErrors: 0, newErrors: 2, old: [], new: [{ type: 'error', text: 'x' }, { type: 'pageerror', text: 'y' }] };
  s.status = scenarioStatus(s);
  const md = renderMarkdown(buildReport(targets, [s]));
  assert.match(md, /\| home \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ❌ 다름 \(old 0 \/ new 2\) \|/);
  assert.match(md, /error\/pageerror: old 0건, new 2건/);
});

test('보고서: WebSocket 차이는 다섯째 열에 다름으로 찍히고 상세 절에 어긋난 곳과 표가 나오며 종료 코드 1', () => {
  const s = sameScenario('live');
  const frames = (kinds: string[]) => kinds.map((kind, i) => ({ conn: 0, dir: i % 2 === 0 ? ('sent' as const) : ('received' as const), kind }));
  s.ws = {
    ...s.ws!,
    equal: false,
    old: { connections: [{ conn: 0, path: '/api/ws', closed: false, errors: 0 }], frames: frames(['ping', 'pong']), openCount: 1, closeCount: 0, errorCount: 0 },
    new: { connections: [{ conn: 0, path: '/api/ws', closed: false, errors: 0 }], frames: frames(['pong', 'ping']), openCount: 1, closeCount: 0, errorCount: 0 },
    firstDiff: { where: 'frames', index: 0, old: '#0 → ping', new: '#0 → pong' },
    options: { ...s.ws!.options, ignorePayload: true },
  };
  s.status = scenarioStatus(s);
  assert.equal(s.status, 'different');
  const report = buildReport(targets, [s]);
  assert.equal(report.exitCode, 1);
  assert.equal(report.summary.axes.websocket, 1);
  const md = renderMarkdown(report);
  assert.match(md, /\| live \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ❌ 다름 \(연결 1\/1, 프레임 2\/2\) \|/);
  assert.match(md, /#### WebSocket \(연결·프레임 순서\)/);
  assert.match(md, /- 처음 어긋난 곳: 프레임 0\n {2}- old: `#0 → ping`\n {2}- new: `#0 → pong`/);
  assert.match(md, /\| \*\*0\*\* \| #0 → ping \| #0 → pong \|\n\| 1 \| #0 ← pong \| #0 ← ping \|/);
  assert.match(md, /ignorePayload true/);
  assert.match(md, /- 원문은 `network\/live\.old\.json`, `network\/live\.new\.json` 참조/);
});

test('보고서: 연결 순서열이 어긋나면 연결 표를 적는다', () => {
  const s = sameScenario('reconnect');
  s.ws = {
    ...s.ws!,
    equal: false,
    old: { connections: [{ conn: 0, path: '/api/ws', closed: true, errors: 0 }], frames: [], openCount: 1, closeCount: 1, errorCount: 0 },
    new: {
      connections: [
        { conn: 0, path: '/api/ws', closed: true, errors: 0 },
        { conn: 1, path: '/api/ws', closed: false, errors: 0 },
      ],
      frames: [],
      openCount: 2,
      closeCount: 1,
      errorCount: 0,
    },
    firstDiff: { where: 'connections', index: 1, old: null, new: '#1 /api/ws (open)' },
  };
  s.status = scenarioStatus(s);
  const md = renderMarkdown(buildReport(targets, [s]));
  assert.match(md, /- 연결: old 1개\(종료 1\), new 2개\(종료 1\)/);
  assert.match(md, /- 처음 어긋난 곳: 연결 1\n {2}- old: —\n {2}- new: `#1 \/api\/ws \(open\)`/);
  assert.match(md, /\| \*\*1\*\* \| — \| #1 \/api\/ws \(open\) \|/);
});
