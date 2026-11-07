import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiSignatures, normalizeDom, type NetworkEntry } from '../src/normalize.ts';

test('정규화: /_app/immutable 자산 해시를 HASH 로 바꾼다', () => {
  const a = normalizeDom('<script type="module" src="/_app/immutable/entry/app.Bq7x2kLm.js"></script>');
  const b = normalizeDom('<script type="module" src="/_app/immutable/entry/app.Zz9yXw1Q.js"></script>');
  assert.equal(a, b);
  assert.match(a, /\/_app\/immutable\/entry\/app\.HASH\.js/);
});

test('정규화: link href 와 css·chunk 경로도 해시를 지운다', () => {
  const html =
    '<link rel="stylesheet" href="/_app/immutable/assets/0.Dk3pQ9aa.css"><link rel="modulepreload" href="/_app/immutable/chunks/index.3kd9fs0z.js">';
  const out = normalizeDom(html);
  assert.equal(
    out,
    '<link rel="stylesheet" href="/_app/immutable/assets/0.HASH.css"><link rel="modulepreload" href="/_app/immutable/chunks/index.HASH.js">',
  );
});

test('정규화: /_app/immutable 밖의 점 포함 경로는 건드리지 않는다', () => {
  const html = '<img src="/images/photo.large.png"><script src="/_app/version.json"></script>';
  assert.equal(normalizeDom(html), html);
});

test('정규화: class 안의 svelte-xxxx 를 svelte-HASH 로 바꾸되 다른 속성은 두지 않는다', () => {
  const a = normalizeDom('<div class="shell svelte-7f3k9a other" data-x="svelte-7f3k9a">');
  const b = normalizeDom("<div class='shell svelte-p0q1r2 other' data-x=\"svelte-7f3k9a\">");
  assert.equal(a, '<div class="shell svelte-HASH other" data-x="svelte-7f3k9a">');
  assert.equal(b, "<div class='shell svelte-HASH other' data-x=\"svelte-7f3k9a\">");
});

test('정규화: data-sveltekit-* 속성을 값 유무와 관계없이 지운다', () => {
  const html = '<body data-sveltekit-preload-data="hover" data-sveltekit-reload class="x"><a data-sveltekit-noscroll href="/a">a</a></body>';
  assert.equal(normalizeDom(html), '<body class="x"><a href="/a">a</a></body>');
});

test('정규화: __sveltekit_<hash> 전역과 연속 공백을 정규화한다', () => {
  const html = '<script>\n  __sveltekit_1a2b3c4 = { base: "" };\n</script>   <div>\n\n a </div>';
  assert.equal(normalizeDom(html), '<script> __sveltekit_HASH = { base: "" }; </script> <div> a </div>');
});

function entry(seq: number, method: string, url: string, resourceType: string, status?: number): NetworkEntry {
  return { seq, method, url, resourceType, status, t: seq };
}

test('네트워크 요약: /api 요청만 (method, path+query, status) 로 순서대로 남긴다', () => {
  const entries: NetworkEntry[] = [
    entry(0, 'GET', 'http://127.0.0.1:1111/', 'document', 200),
    entry(1, 'GET', 'http://127.0.0.1:1111/_app/immutable/entry/app.Bq7x2kLm.js', 'script', 200),
    entry(2, 'GET', 'http://127.0.0.1:1111/api/hello?from=%2F', 'fetch', 200),
    entry(3, 'GET', 'http://127.0.0.1:1111/favicon.ico', 'other', 404),
    entry(4, 'POST', 'http://127.0.0.1:1111/api/runs/1/rerun', 'fetch', 202),
    entry(5, 'GET', 'http://127.0.0.1:1111/apix/not-api', 'fetch', 200),
    entry(6, 'GET', 'http://127.0.0.1:1111/api/pending', 'fetch'),
  ];
  assert.deepEqual(apiSignatures(entries, '/api'), [
    { method: 'GET', path: '/api/hello?from=%2F', status: 200 },
    { method: 'POST', path: '/api/runs/1/rerun', status: 202 },
    { method: 'GET', path: '/api/pending', status: null },
  ]);
});

test('네트워크 요약: 호스트가 달라도 path 만 비교하므로 같은 요약이 나온다', () => {
  const a = apiSignatures([entry(0, 'GET', 'http://127.0.0.1:1111/api/a', 'fetch', 200)]);
  const b = apiSignatures([entry(0, 'GET', 'http://127.0.0.1:2222/api/a', 'fetch', 200)]);
  assert.deepEqual(a, b);
});
