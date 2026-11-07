import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isApiPath, parseHeaderArgs, startProxy } from '../src/proxy.ts';
import { startStaticServer } from '../src/targets.ts';
import { startEchoServer } from './helpers/echo-server.ts';

const spa = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spa');

test('isApiPath: /api 는 /api, /api/..., /api?.. 에만 맞는다', () => {
  assert.equal(isApiPath('/api', '/api'), true);
  assert.equal(isApiPath('/api/hello?x=1', '/api'), true);
  assert.equal(isApiPath('/api?x=1', '/api'), true);
  assert.equal(isApiPath('/apix', '/api'), false);
  assert.equal(isApiPath('/', '/api'), false);
  assert.equal(isApiPath('/api/x', '/api/'), true);
});

test('parseHeaderArgs: k=v 목록을 소문자 키 맵으로 바꾸고 형식 오류는 거부한다', () => {
  assert.deepEqual(parseHeaderArgs(['X-Forwarded-User=e2e-reviewer', 'a = b=c']), { 'x-forwarded-user': 'e2e-reviewer', a: 'b=c' });
  assert.deepEqual(parseHeaderArgs(undefined), {});
  assert.throws(() => parseHeaderArgs(['novalue']), /k=v/);
});

test('프록시: /api 는 backend 로, 나머지는 target 으로 가고 두 방향 모두 --header 가 실린다', async (t) => {
  const backend = await startEchoServer();
  const target = await startEchoServer();
  const proxy = await startProxy({
    targetURL: target.url,
    backendURL: backend.url,
    headers: { 'x-forwarded-user': 'e2e-reviewer' },
  });
  t.after(async () => {
    await proxy.close();
    await backend.close();
    await target.close();
  });

  const api = await fetch(`${proxy.url}/api/hello?from=%2F`, { method: 'POST', body: 'x' });
  assert.equal(api.status, 200);
  const apiBody = (await api.json()) as { method: string; url: string; user: string };
  assert.equal(apiBody.method, 'POST');
  assert.equal(apiBody.url, '/api/hello?from=%2F');
  assert.equal(apiBody.user, 'e2e-reviewer');
  assert.equal(backend.received.length, 1);
  assert.equal(target.received.length, 0);

  const page = await fetch(`${proxy.url}/some/page?x=1`);
  const pageBody = (await page.json()) as { url: string; user: string; headers: Record<string, string> };
  assert.equal(pageBody.url, '/some/page?x=1');
  assert.equal(pageBody.user, 'e2e-reviewer');
  assert.equal(target.received.length, 1);
  // host 헤더는 업스트림 주소로 바뀐다.
  assert.equal(pageBody.headers.host, new URL(target.url).host);

  const notApi = await fetch(`${proxy.url}/apix`);
  await notApi.text();
  assert.equal(target.received.length, 2);
  assert.equal(backend.received.length, 1);
});

test('프록시: static 대상 앞에서 index.html 폴백과 /api 분기가 함께 동작한다', async (t) => {
  const backend = await startEchoServer();
  const target = await startStaticServer(spa);
  const proxy = await startProxy({ targetURL: target.url, backendURL: backend.url, apiPrefix: '/api' });
  t.after(async () => {
    await proxy.close();
    await backend.close();
    await target.close();
  });

  const fallback = await fetch(`${proxy.url}/deep/path`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /eolgae fixture/);

  const api = await fetch(`${proxy.url}/api/hello`);
  const body = (await api.json()) as { user: string | null };
  assert.equal(body.user, null);
  assert.equal(backend.received[0]?.url, '/api/hello');
});

test('프록시: 업스트림이 죽어 있으면 502 로 답한다', async (t) => {
  const backend = await startEchoServer();
  const deadPort = new URL(backend.url).port;
  await backend.close();
  const target = await startEchoServer();
  const proxy = await startProxy({ targetURL: target.url, backendURL: `http://127.0.0.1:${deadPort}` });
  t.after(async () => {
    await proxy.close();
    await target.close();
  });
  const res = await fetch(`${proxy.url}/api/x`);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /연결 실패/);
});
