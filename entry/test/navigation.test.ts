// 링크 가로채기 제외 규칙(D-3)과 mount 전 호출 에러.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideIntercept, goto, invalidateAll, replaceState, type ClickInfo, type LinkInfo } from '../src/navigation.ts';

const click: ClickInfo = { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false };
const current = 'http://app.test/list?q=1';
const routes = new Set(['/', '/list', '/detail']);
const hasRoute = (url: URL) => routes.has(url.pathname);
const link = (over: Partial<LinkInfo> = {}): LinkInfo => ({ href: '/detail', target: null, download: false, rel: null, reload: false, ...over });

describe('decideIntercept', () => {
  test('같은 origin 의 라우트 표 경로는 가로챈다', () => {
    const d = decideIntercept(link(), click, current, hasRoute);
    assert.equal(d.intercept, true);
    if (d.intercept) assert.equal(d.url.href, 'http://app.test/detail');
  });
  test('상대 경로·쿼리도 현재 주소 기준으로 해석한다', () => {
    const d = decideIntercept(link({ href: 'detail?x=2' }), click, current, hasRoute);
    assert.equal(d.intercept, true);
    if (d.intercept) assert.equal(d.url.href, 'http://app.test/detail?x=2');
  });
  const reject = (name: string, l: Partial<LinkInfo>, reason: string, c: Partial<ClickInfo> = {}) =>
    test(`제외: ${name}`, () => {
      const d = decideIntercept(link(l), { ...click, ...c }, current, hasRoute);
      assert.equal(d.intercept, false);
      if (!d.intercept) assert.equal(d.reason, reason);
    });
  reject('다른 origin', { href: 'https://example.com/detail' }, 'other-origin');
  reject('mailto: 등 다른 스킴', { href: 'mailto:a@b.c' }, 'other-origin');
  reject('target 속성', { target: '_blank' }, 'target');
  reject('download 속성', { download: true }, 'download');
  reject('rel=external', { rel: 'noopener external' }, 'rel-external');
  reject('data-eolgae-reload / data-sveltekit-reload opt-out', { reload: true }, 'reload-opt-out');
  reject('라우트 표에 없는 경로(서버 라우트)', { href: '/auth/logout' }, 'no-route');
  reject('같은 문서 해시 이동', { href: '/list?q=1#top' }, 'hash-only');
  reject('빈 해시 href="#"', { href: '#' }, 'hash-only');
  reject('상대 해시 href="#top"', { href: '#top' }, 'hash-only');
  reject('href 없음', { href: '' }, 'no-href');
  reject('보조 키(ctrl)', {}, 'modifier', { ctrlKey: true });
  reject('보조 키(meta)', {}, 'modifier', { metaKey: true });
  reject('가운데 버튼', {}, 'modifier', { button: 1 });
  reject('이미 preventDefault 된 클릭', {}, 'prevented', { defaultPrevented: true });
  test('target=_self 는 제외하지 않는다', () => {
    assert.equal(decideIntercept(link({ target: '_self' }), click, current, hasRoute).intercept, true);
  });
  test('다른 경로의 해시 링크는 가로챈다', () => {
    assert.equal(decideIntercept(link({ href: '/detail#sec' }), click, current, hasRoute).intercept, true);
  });
});

describe('mount 전 호출', () => {
  test('goto 는 mount 전에 부르면 안내 에러', async () => {
    await assert.rejects(goto('/x'), /mount\(\) 뒤에/);
  });
  test('goto 는 http(s) 외 스킴을 거부한다', async () => {
    await assert.rejects(goto('javascript:alert(1)'), /http\(s\) 주소만/);
    await assert.rejects(goto('mailto:a@b.c'), /http\(s\) 주소만/);
  });
  test('replaceState·invalidateAll 은 mount 전에 부르면 안내 에러', async () => {
    assert.throws(() => replaceState('/x', {}), /mount\(\) 뒤에/);
    await assert.rejects(invalidateAll(), /mount\(\) 뒤에/);
  });
});
