import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWs, messageKind, normalizePayload, wsPath, wsSummary, type WsEvent } from '../src/ws.ts';

/** 연결 하나에 welcome 수신 → ping/chat 송신 → echo 둘 수신 → close 가 담긴 예제 시퀀스 */
function sequence(url = 'ws://127.0.0.1:41234/api/ws?token=abc'): WsEvent[] {
  const ping = JSON.stringify({ type: 'ping', seq: 1 });
  const chat = JSON.stringify({ type: 'chat', text: '안녕', seq: 2 });
  return [
    { conn: 0, url, kind: 'open', t: 1 },
    { conn: 0, url, kind: 'received', payload: '{"type":"welcome","n":1}', size: 24, t: 2 },
    { conn: 0, url, kind: 'sent', payload: ping, size: ping.length, t: 3 },
    { conn: 0, url, kind: 'sent', payload: chat, size: chat.length, t: 4 },
    { conn: 0, url, kind: 'received', payload: ping, size: ping.length, t: 5 },
    { conn: 0, url, kind: 'received', payload: chat, size: chat.length, t: 6 },
    { conn: 0, url, kind: 'close', t: 7 },
  ];
}

test('ws 요약: 연결은 path+query 로, 프레임은 (연결, 방향, 종류, 페이로드) 로 요약한다', () => {
  const s = wsSummary(sequence());
  assert.equal(s.openCount, 1);
  assert.equal(s.closeCount, 1);
  assert.equal(s.errorCount, 0);
  assert.deepEqual(s.connections, [{ conn: 0, path: '/api/ws?token=abc', closed: true, errors: 0 }]);
  assert.equal(s.frames.length, 5);
  assert.deepEqual(s.frames[0], { conn: 0, dir: 'received', kind: 'welcome', payload: '{"n":1,"type":"welcome"}' });
  assert.deepEqual(s.frames[1], { conn: 0, dir: 'sent', kind: 'ping', payload: '{"seq":1,"type":"ping"}' });
  assert.equal(s.frames[2]?.kind, 'chat');
});

test('ws 비교: 같은 시퀀스(프록시 포트가 달라도)면 차이 0', () => {
  const r = compareWs(wsSummary(sequence('ws://127.0.0.1:41234/api/ws?token=abc')), wsSummary(sequence('ws://127.0.0.1:55555/api/ws?token=abc')));
  assert.equal(r.equal, true);
  assert.equal(r.firstDiff, undefined);
});

test('ws 비교: 메시지 하나 순서가 바뀐 사본은 프레임 순서열에서 처음 어긋난 위치와 양쪽 값을 보고한다', () => {
  const swapped = sequence();
  [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
  const r = compareWs(wsSummary(sequence()), wsSummary(swapped));
  assert.equal(r.equal, false);
  assert.equal(r.firstDiff?.where, 'frames');
  assert.equal(r.firstDiff?.index, 1);
  assert.match(r.firstDiff?.old ?? '', /^#0 → ping /);
  assert.match(r.firstDiff?.new ?? '', /^#0 → chat /);
});

test('ws 비교: 연결 수·종료 여부가 다르면 연결 순서열에서 어긋난다', () => {
  const noClose = sequence().filter((e) => e.kind !== 'close');
  const r = compareWs(wsSummary(sequence()), wsSummary(noClose));
  assert.equal(r.equal, false);
  assert.equal(r.firstDiff?.where, 'connections');
  assert.equal(r.firstDiff?.old, '#0 /api/ws?token=abc (closed)');
  assert.equal(r.firstDiff?.new, '#0 /api/ws?token=abc (open)');

  const reconnect = [...sequence(), ...sequence().map((e) => ({ ...e, conn: 1 }))];
  const r2 = compareWs(wsSummary(sequence()), wsSummary(reconnect));
  assert.equal(r2.equal, false);
  assert.equal(r2.firstDiff?.where, 'connections');
  assert.equal(r2.firstDiff?.index, 1);
  assert.equal(r2.firstDiff?.old, null);
  assert.equal(wsSummary(reconnect).openCount, 2);
});

test('ws 옵션 ignoreQuery: 기본은 쿼리가 다르면 다름, 켜면 같음', () => {
  const a = sequence('ws://h/api/ws?token=abc');
  const b = sequence('ws://h/api/ws?token=xyz');
  assert.equal(compareWs(wsSummary(a), wsSummary(b)).equal, false);
  assert.equal(compareWs(wsSummary(a, { ignoreQuery: true }), wsSummary(b, { ignoreQuery: true })).equal, true);
  assert.equal(wsPath('ws://h:1/a/b?q=1', false), '/a/b?q=1');
  assert.equal(wsPath('ws://h:1/a/b?q=1', true), '/a/b');
  assert.equal(wsPath('not a url', true), 'not a url');
});

test('ws 옵션 messageKey: JSON 이면 지정한 키 값이 종류, 없거나 JSON 이 아니면 앞 32자', () => {
  assert.equal(messageKind({ payload: '{"type":"ping","op":"x"}' }, 'type'), 'ping');
  assert.equal(messageKind({ payload: '{"type":"ping","op":"x"}' }, 'op'), 'x');
  assert.equal(messageKind({ payload: '{"type":"ping","n":7}' }, 'n'), '7');
  // 키가 없으면 본문 앞 32자
  assert.equal(messageKind({ payload: '{"type":"ping"}' }, 'kind'), '{"type":"ping"}');
  const long = 'x'.repeat(40);
  assert.equal(messageKind({ payload: long }, 'type'), 'x'.repeat(32));
  assert.equal(messageKind({ payload: '[1,2]' }, 'type'), '[1,2]');
  assert.equal(messageKind({ payload: 'AAAA', binary: true, size: 3 }, 'type'), 'binary:3');

  const a = sequence();
  const b = sequence().map((e) => (e.kind === 'sent' && e.payload?.includes('ping') ? { ...e, payload: '{"type":"ping","op":"y","seq":1}' } : e));
  // 기본 키 type 으로는 종류가 같지만 페이로드가 달라 다름, ignorePayload 까지 켜면 같음
  assert.equal(compareWs(wsSummary(a), wsSummary(b)).equal, false);
  assert.equal(compareWs(wsSummary(a, { ignorePayload: true }), wsSummary(b, { ignorePayload: true })).equal, true);
  // op 키로 보면 종류 자체가 다르다(a 에는 op 가 없어 앞 32자 fallback)
  assert.equal(compareWs(wsSummary(a, { messageKey: 'op', ignorePayload: true }), wsSummary(b, { messageKey: 'op', ignorePayload: true })).equal, false);
});

test('ws 옵션 ignorePayload: 종류만 비교하고 요약에 payload 를 싣지 않는다', () => {
  const s = wsSummary(sequence(), { ignorePayload: true });
  assert.ok(s.frames.every((f) => f.payload === undefined));
  const changedText = sequence().map((e) => (e.payload?.includes('안녕') ? { ...e, payload: '{"type":"chat","text":"바뀜","seq":2}' } : e));
  assert.equal(compareWs(wsSummary(sequence()), wsSummary(changedText)).equal, false);
  assert.equal(compareWs(wsSummary(sequence(), { ignorePayload: true }), wsSummary(changedText, { ignorePayload: true })).equal, true);
});

test('ws 페이로드 정규화: JSON 은 키 정렬·공백 제거, 그 밖은 그대로, 바이너리는 base64 그대로', () => {
  assert.equal(normalizePayload({ payload: '{ "b": 1, "a": {"d": [2, {"z":1,"y":2}], "c": null} }' }), '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  assert.equal(normalizePayload({ payload: 'plain text' }), 'plain text');
  assert.equal(normalizePayload({ payload: '{broken' }), '{broken');
  assert.equal(normalizePayload({ payload: 'AQID', binary: true }), 'AQID');
});
