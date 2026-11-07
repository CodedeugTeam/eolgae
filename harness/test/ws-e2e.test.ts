// WebSocket 축 e2e. ① 프록시 Upgrade 터널이 실제로 통하는지(평문·TLS 업스트림), ② ws-spa fixture 자기 대조 차이 0,
// ③ 보내는 메시지 순서를 바꾼 사본은 websocket 축 차이로 종료 1 인지 본다. chromium 을 띄우므로 오래 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProxy } from '../src/proxy.ts';
import { run } from '../src/run.ts';
import type { WsEvent } from '../src/ws.ts';
import { startWsEchoServer } from './helpers/ws-echo-server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const wsSpa = join(here, '..', 'fixtures', 'ws-spa');
const wsSpec = join(here, '..', 'fixtures', 'ws-spa.spec.ts');
const execFileP = promisify(execFile);

async function tmpDir(t: { after(fn: () => Promise<void>): void }, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Node 전역 WebSocket 으로 프록시에 연결해 메시지 하나를 주고받고 닫는다. 받은 메시지를 순서대로 돌려준다. */
function roundTrip(wsUrl: string, send: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const got: string[] = [];
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error('ws 왕복 시간 초과')), 10_000);
    ws.addEventListener('open', () => ws.send(send));
    ws.addEventListener('message', (ev) => {
      got.push(String(ev.data));
      if (got.length === 2) ws.close();
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      resolve(got);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws 오류'));
    });
  });
}

test('프록시 Upgrade 터널: /api 아래 ws 는 backend 로 가고 --header 가 Upgrade 요청에도 실린다', async (t) => {
  const backend = await startWsEchoServer();
  const target = await startWsEchoServer();
  const proxy = await startProxy({ targetURL: target.url, backendURL: backend.url, headers: { 'x-forwarded-user': 'e2e-reviewer' } });
  t.after(async () => {
    await proxy.close();
    await backend.close();
    await target.close();
  });

  const got = await roundTrip(proxy.url.replace(/^http/, 'ws') + '/api/ws?token=abc', '{"type":"ping","seq":1}');
  assert.deepEqual(got, ['{"type":"welcome","n":1}', '{"type":"ping","seq":1}']);
  assert.equal(backend.upgrades.length, 1);
  assert.equal(backend.upgrades[0]?.url, '/api/ws?token=abc');
  assert.equal(backend.upgrades[0]?.headers['x-forwarded-user'], 'e2e-reviewer');
  assert.deepEqual(backend.messages, ['{"type":"ping","seq":1}']);
  assert.equal(target.upgrades.length, 0);

  // /api 밖의 ws 는 target 으로 간다.
  const got2 = await roundTrip(proxy.url.replace(/^http/, 'ws') + '/live', 'hi');
  assert.deepEqual(got2, ['{"type":"welcome","n":1}', 'hi']);
  assert.equal(target.upgrades.length, 1);
  assert.equal(target.upgrades[0]?.headers['x-forwarded-user'], 'e2e-reviewer');
});

test('프록시 Upgrade 터널: https 업스트림이면 tls 로 잇는다(openssl 이 없으면 생략)', { timeout: 60_000 }, async (t) => {
  const dir = await tmpDir(t, 'eolgae-tls-');
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  try {
    await execFileP('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', keyPath, '-out', certPath, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    ]);
  } catch {
    t.skip('openssl 을 쓸 수 없어 TLS 업스트림 테스트를 생략한다');
    return;
  }
  const backend = await startWsEchoServer({ tls: { key: await readFile(keyPath), cert: await readFile(certPath) } });
  const target = await startWsEchoServer();
  const proxy = await startProxy({ targetURL: target.url, backendURL: backend.url });
  // 자체 서명 인증서라 이 테스트 동안만 검증을 끈다(tls.connect 가 호출 시점에 읽는다).
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  t.after(async () => {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    await proxy.close();
    await backend.close();
    await target.close();
  });

  assert.match(backend.url, /^https:/);
  const got = await roundTrip(proxy.url.replace(/^http/, 'ws') + '/api/ws', 'secure');
  assert.deepEqual(got, ['{"type":"welcome","n":1}', 'secure']);
  assert.equal(backend.upgrades.length, 1);
});

test('ws 자기 대조: 같은 ws-spa 를 old/new 로 넣으면 websocket 축 차이 0, 종료 코드 0', { timeout: 120_000 }, async (t) => {
  const backend = await startWsEchoServer();
  t.after(() => backend.close());
  const out = await tmpDir(t, 'eolgae-ws-e2e-');

  const result = await run({ old: `static:${wsSpa}`, new: `static:${wsSpa}`, backend: backend.url, scenarios: [wsSpec], out });
  const { report } = result;
  assert.equal(report.exitCode, 0, JSON.stringify(report.summary));
  assert.equal(report.summary.axes.websocket, 0);
  assert.equal(report.scenarios.length, 2);
  for (const s of report.scenarios) {
    assert.equal(s.status, 'same', `${s.name}: ${JSON.stringify(s.ws, null, 1).slice(0, 2000)}`);
    assert.equal(s.ws?.compared, true);
    assert.equal(s.ws?.equal, true);
    assert.equal(s.ws?.old.openCount, 1, '연결 1개');
    assert.equal(s.ws?.old.closeCount, 1, '종료 1개');
    assert.equal(s.ws?.old.frames.length, 5, '송신 2 + welcome 수신 + echo 수신 2');
    // open 핸들러의 send 는 동기라 welcome message 이벤트보다 먼저 기록된다.
    assert.deepEqual(
      s.ws?.old.frames.map((f) => `${f.dir}:${f.kind}`),
      ['sent:ping', 'sent:chat', 'received:welcome', 'received:ping', 'received:chat'],
    );
    assert.equal(s.console?.equal, true);
  }
  const home = report.scenarios.find((s) => s.name === 'ws-home')!;
  assert.equal(home.ws?.old.connections[0]?.path, '/api/ws?token=***&v=***', '보고서의 쿼리 값은 가려진다');
  assert.deepEqual(home.ws?.options, { ignoreQuery: false, messageKey: 'type', ignorePayload: false, timeoutMs: 1000 });
  assert.equal(home.ws?.old.frames[0]?.bytes, Buffer.byteLength('{"seq":1,"type":"ping"}'), '보고서에는 정규화한 페이로드의 바이트 수·해시만');
  assert.match(home.ws?.old.frames[0]?.sha256 ?? '', /^[0-9a-f]{12}$/);
  const iq = report.scenarios.find((s) => s.name === 'ws-ignore-query')!;
  assert.equal(iq.ws?.old.connections[0]?.path, '/api/ws', 'ignoreQuery 면 쿼리를 뗀다');
  assert.deepEqual(iq.ws?.options, { ignoreQuery: true, messageKey: 'type', ignorePayload: true, timeoutMs: 200 });
  assert.ok(iq.ws?.old.frames.every((f) => f.bytes === undefined && f.sha256 === undefined));

  // backend 에 Upgrade 가 네 번(시나리오 2 × 대상 2) 도착했고, network json 에 ws 원본이 남아 있다.
  assert.equal(backend.upgrades.length, 4);
  const net = JSON.parse(await readFile(join(out, 'network', 'ws-home.old.json'), 'utf8')) as { ws: WsEvent[] };
  assert.equal(net.ws.filter((e) => e.kind === 'open').length, 1);
  assert.equal(net.ws.filter((e) => e.kind === 'sent').length, 2);
  assert.ok(net.ws.every((e) => e.conn === 0));

  const jsonText = await readFile(result.reportJsonPath, 'utf8');
  const json = JSON.parse(jsonText) as typeof report;
  assert.equal(json.scenarios[0]?.ws?.equal, true);
  const md = await readFile(result.reportMdPath, 'utf8');
  // 마스킹: 쿼리 값·페이로드 원문(SECRET)은 report.json/report.md 어디에도 없고 network json 원본에는 있다.
  assert.doesNotMatch(jsonText, /SECRET/);
  assert.doesNotMatch(md, /SECRET/);
  const rawNet = await readFile(join(out, 'network', 'ws-home.old.json'), 'utf8');
  assert.match(rawNet, /SECRET-QUERY/);
  assert.match(rawNet, /SECRET-BODY/);
  assert.match(md, /\| ws-home \| — 생략 \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \| ✅ 같음 \(연결 1\/1, 프레임 5\/5\) \|/);
});

test('ws 자기 대조: 보내는 메시지 순서를 바꾼 사본을 new 로 넣으면 websocket 축 차이·종료 코드 1', { timeout: 120_000 }, async (t) => {
  const backend = await startWsEchoServer();
  t.after(() => backend.close());
  const out = await tmpDir(t, 'eolgae-ws-e2e-');
  const changedRoot = await tmpDir(t, 'eolgae-ws-changed-');
  const changed = join(changedRoot, 'ws-spa-changed');
  await cp(wsSpa, changed, { recursive: true });
  const js = join(changed, '_app', 'immutable', 'entry', 'app.Ws1aB2cD.js');
  const src = await readFile(js, 'utf8');
  const ping = "  ws.send(JSON.stringify({ type: 'ping', seq: 1 }));\n";
  const chat = "  ws.send(JSON.stringify({ type: 'chat', text: '안녕 token=SECRET-BODY', seq: 2 }));\n";
  assert.ok(src.includes(ping + chat), 'fixture 의 송신 두 줄을 찾아야 한다');
  await writeFile(js, src.replace(ping + chat, chat + ping));

  const { report } = await run({ old: `static:${wsSpa}`, new: `static:${changed}`, backend: backend.url, scenarios: [wsSpec], out });
  assert.equal(report.exitCode, 1, JSON.stringify(report.summary));
  assert.equal(report.summary.different, 2);
  assert.equal(report.summary.axes.websocket, 2);
  for (const s of report.scenarios) {
    assert.equal(s.status, 'different');
    assert.equal(s.ws?.equal, false, 'websocket 축이 차이를 잡아야 한다');
    assert.equal(s.ws?.firstDiff?.where, 'frames');
    assert.equal(s.ws?.firstDiff?.index, 0, '첫 송신에서 어긋난다');
    assert.match(s.ws?.firstDiff?.old ?? '', /^#0 → ping/);
    assert.match(s.ws?.firstDiff?.new ?? '', /^#0 → chat/);
    assert.equal(s.network?.equal, true, '네트워크 축(/api HTTP 요청)은 같다');
    assert.equal(s.console?.equal, true);
  }
  const md = await readFile(join(out, 'report.md'), 'utf8');
  // 받은 메시지 순서가 바뀌어 DOM 열도 다름일 수 있으므로 WebSocket 열만 본다.
  assert.match(md, /\| ws-home \| — 생략 \| [^|]+ \| ✅ 같음 \| ✅ 같음 \| ❌ 다름 \(연결 1\/1, 프레임 5\/5\) \|/);
  assert.match(md, /#### WebSocket \(연결·프레임 순서\)/);
  assert.match(md, /처음 어긋난 곳: 프레임 0/);
  assert.match(md, /\| \*\*0\*\* \| #0 → ping \[\d+B sha256 [0-9a-f]{12}\] \| #0 → chat \[\d+B sha256 [0-9a-f]{12}\] \|/);
  assert.match(md, /원문은 `network\/ws-home\.old\.json`, `network\/ws-home\.new\.json` 참조/);
  assert.doesNotMatch(md, /SECRET/);
  assert.doesNotMatch(await readFile(join(out, 'report.json'), 'utf8'), /SECRET/);
  // DOM 은 받은 메시지 순서가 바뀌어 다를 수 있다. 이 테스트의 관심은 websocket 축이므로 단정하지 않는다.
});
