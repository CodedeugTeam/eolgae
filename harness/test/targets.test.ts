import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTarget, startStaticServer } from '../src/targets.ts';

const spa = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spa');

test('parseTarget: static:/url: 두 형식만 받는다', () => {
  assert.deepEqual(parseTarget('url:http://127.0.0.1:3000/'), { kind: 'url', url: 'http://127.0.0.1:3000' });
  assert.equal(parseTarget('static:harness/fixtures/spa').kind, 'static');
  assert.throws(() => parseTarget('file:/x'), /알 수 없는 target 종류/);
  assert.throws(() => parseTarget('url:ftp://x'), /http 또는 https/);
  assert.throws(() => parseTarget('nope'), /형식이 잘못/);
});

test('정적 서버: 파일은 그대로, 알 수 없는 경로는 index.html 폴백, /_app 아래 없는 파일은 404', async (t) => {
  const server = await startStaticServer(spa);
  t.after(() => server.close());

  const index = await fetch(`${server.url}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/);
  const indexBody = await index.text();
  assert.match(indexBody, /eolgae fixture/);

  const js = await fetch(`${server.url}/_app/immutable/entry/app.Bq7x2kLm.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);
  assert.match(await js.text(), /getElementById\('app'\)/);

  const fallback = await fetch(`${server.url}/some/deep/path?x=1`);
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(await fallback.text(), indexBody);

  const missingAsset = await fetch(`${server.url}/_app/immutable/entry/nope.js`);
  assert.equal(missingAsset.status, 404);

  // 인코딩된 ../ 로 폴더 밖을 노리면 403
  const traversal = await fetch(`${server.url}/..%2F..%2Fpackage.json`);
  assert.equal(traversal.status, 403);
});

test('정적 서버: 폴더에 index.html 이 없으면 기동 자체를 거부한다', async () => {
  await assert.rejects(startStaticServer(join(spa, '_app')), /index\.html 이 없습니다/);
  await assert.rejects(startStaticServer(join(spa, 'no-such-dir')), /폴더가 없습니다/);
});
