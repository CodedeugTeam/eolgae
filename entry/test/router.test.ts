// 라우트 매칭과 라우터 상태 기계. DOM 없이 가짜 RouterEnv 로 history 동작을 확인한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileRoutes, createRouter, isHistoryEntry, isNavigable, matchRoute, type Resolved, type RouterEnv } from '../src/router.ts';
import { error, NotImplementedError } from '../src/errors.ts';
import type { RouteDefinition } from '../src/types.ts';

// Svelte 5 컴포넌트 함수는 (anchor, props) 두 인자다. 테스트는 모양만 흉내 낸다.
const comp = (name: string) => Object.assign(function component(_anchor: unknown, _props: unknown) {}, { displayName: name }) as never;
const Home = comp('Home');
const Project = comp('Project');
const Settings = comp('Settings');
const NotFound = comp('NotFound');

const routes: RouteDefinition[] = [
  { path: '/', component: Home },
  { path: '/project/:id', component: Project },
  { path: '/project/settings', component: Settings },
  { path: '*', component: NotFound },
];

describe('matchRoute', () => {
  test('정적 경로와 루트', () => {
    assert.equal(matchRoute(routes, '/')?.id, '/');
    assert.equal(matchRoute(routes, '/project/settings')?.id, '/project/settings');
  });
  test(':param 은 한 세그먼트를 잡고 디코딩한다', () => {
    const m = matchRoute(routes, '/project/a%20b');
    assert.equal(m?.id, '/project/:id');
    assert.deepEqual(m?.params, { id: 'a b' });
    assert.equal(matchRoute(routes, '/project/a/b')?.id, '*', '세그먼트 수가 다르면 :param 에 안 걸린다');
  });
  test('정적 세그먼트가 :param 보다 우선한다(표 순서 무관)', () => {
    assert.equal(matchRoute(routes, '/project/settings')?.id, '/project/settings');
    const reversed = [...routes].reverse();
    assert.equal(matchRoute(reversed, '/project/settings')?.id, '/project/settings');
  });
  test('* 는 폴백(fallback=true), 없으면 null. 폴백 매치는 isNavigable 이 false', () => {
    const m = matchRoute(routes, '/nope/anything');
    assert.equal(m?.id, '*');
    assert.equal(m?.fallback, true);
    assert.equal(isNavigable(m), false);
    assert.equal(matchRoute(routes, '/')?.fallback, false);
    assert.equal(isNavigable(matchRoute(routes, '/')), true);
    assert.equal(matchRoute(routes.slice(0, 3), '/nope'), null);
    assert.equal(isNavigable(null), false);
  });
  test('잘못된 퍼센트 인코딩은 URIError 대신 원문을 둔다', () => {
    assert.deepEqual(matchRoute(routes, '/project/%E0%A4%A')?.params, { id: '%E0%A4%A' });
  });
  test('끝의 / 는 무시한다', () => {
    assert.equal(matchRoute(routes, '/project/settings/')?.id, '/project/settings');
  });
  test('잘못된 패턴·중복 경로는 compile 때 던진다', () => {
    assert.throws(() => compileRoutes([{ path: 'about', component: Home }]), /"\/" 로 시작/);
    assert.throws(() => compileRoutes([{ path: '/', component: Home }, { path: '/', component: Home }]), /중복/);
  });
});

interface FakeEnv {
  env: RouterEnv;
  entries: Array<{ state: unknown; href: string }>;
  index: number;
  assigned: string[];
  back(): void;
  forward(): void;
  /** 브라우저가 라우터를 거치지 않고 만드는 항목(해시 링크 등). state 는 null */
  nativePush(href: string): void;
}

function fakeEnv(initial = 'http://app.test/'): FakeEnv {
  let popHandler: ((state: unknown) => void) | null = null;
  const fake: FakeEnv = {
    entries: [{ state: null, href: initial }],
    index: 0,
    assigned: [],
    env: {
      currentHref: () => fake.entries[fake.index]!.href,
      currentState: () => fake.entries[fake.index]!.state,
      fetch: (() => Promise.reject(new Error('fetch 는 쓰지 않는다'))) as typeof fetch,
      pushState(state, href) {
        fake.entries.splice(fake.index + 1);
        fake.entries.push({ state, href });
        fake.index++;
      },
      replaceState(state, href) {
        fake.entries[fake.index] = { state, href };
      },
      assign(href) {
        fake.assigned.push(href);
      },
      onPopState(handler) {
        popHandler = handler;
        return () => {
          popHandler = null;
        };
      },
    },
    back() {
      if (fake.index === 0) throw new Error('더 뒤로 갈 수 없다');
      fake.index--;
      popHandler?.(fake.entries[fake.index]!.state);
    },
    forward() {
      if (fake.index === fake.entries.length - 1) throw new Error('더 앞으로 갈 수 없다');
      fake.index++;
      popHandler?.(fake.entries[fake.index]!.state);
    },
    nativePush(href) {
      fake.entries.splice(fake.index + 1);
      fake.entries.push({ state: null, href });
      fake.index++;
    },
  };
  return fake;
}

describe('createRouter', () => {
  test('start 는 현재 주소를 해석해 onChange 를 한 번 부른다', async () => {
    const fake = fakeEnv('http://app.test/project/42?tab=a#x');
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    const r = await router.start();
    assert.equal(seen.length, 1);
    assert.equal(r.match.id, '/project/:id');
    assert.deepEqual(r.match.params, { id: '42' });
    assert.equal(r.url.search, '?tab=a');
    assert.equal(r.component, Project);
    assert.equal(router.current, r);
  });

  test('start 때 라우트 표에 없으면 던진다(폴백 * 가 없을 때)', async () => {
    const fake = fakeEnv('http://app.test/nope');
    const router = createRouter(routes.slice(0, 3), fake.env, () => {});
    await assert.rejects(router.start(), /라우트 표에 없습니다/);
  });

  test('goto: pushState 뒤 라우트·state 가 바뀌고, 뒤로가기(popstate)로 되돌아온다', async () => {
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/project/7', { state: { from: 'home' } });
    assert.equal(fake.entries.length, 2);
    assert.equal(fake.entries[1]?.href, 'http://app.test/project/7');
    // history.state 는 { 표식, 내비게이션 번호, state } 구조다. goto 의 state 는 state 자리에 그대로 들어간다.
    const entry = fake.entries[1]?.state;
    assert.ok(isHistoryEntry(entry));
    assert.deepEqual(entry.state, { from: 'home' });
    assert.equal(seen.at(-1)?.match.id, '/project/:id');
    assert.deepEqual(seen.at(-1)?.state, { from: 'home' });

    fake.back();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(seen.length, 3);
    assert.equal(seen.at(-1)?.match.id, '/');
    assert.equal(seen.at(-1)?.url.pathname, '/');
    assert.deepEqual(seen.at(-1)?.state, {}, 'state 가 null 이면 빈 객체');
    assert.deepEqual(fake.assigned, [], '전체 이동은 없었다');
  });

  test('goto replace: history 길이가 늘지 않는다', async () => {
    const fake = fakeEnv();
    const router = createRouter(routes, fake.env, () => {});
    await router.start();
    await router.navigate('/project/1', { replace: true });
    assert.equal(fake.entries.length, 1);
    assert.equal(fake.entries[0]?.href, 'http://app.test/project/1');
  });

  test('라우트 표에 없는 경로·다른 origin 은 전체 이동(assign)으로 넘기고 history 를 건드리지 않는다', async () => {
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes.slice(0, 3), fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/auth/logout?next=%2F');
    await router.navigate('https://other.example/x');
    assert.deepEqual(fake.assigned, ['http://app.test/auth/logout?next=%2F', 'https://other.example/x']);
    assert.equal(fake.entries.length, 1);
    assert.equal(seen.length, 1);
  });

  test('popstate 로 라우트 표 밖에 떨어지면 전체 이동한다', async () => {
    const fake = fakeEnv('http://app.test/outside');
    fake.env.pushState(null, 'http://app.test/');
    const router = createRouter(routes.slice(0, 3), fake.env, () => {});
    await router.start();
    fake.back();
    assert.deepEqual(fake.assigned, ['http://app.test/outside']);
  });

  test('* 폴백은 직접 진입(start)에만 쓰고 goto·popstate 에서는 전체 이동으로 넘긴다(D-3)', async () => {
    // 직접 진입: 서버가 index.html 로 폴백한 뒤라 폴백 라우트를 그린다.
    const direct = fakeEnv('http://app.test/unknown/page');
    const seenDirect: Resolved[] = [];
    const r1 = createRouter(routes, direct.env, (r) => seenDirect.push(r));
    const first = await r1.start();
    assert.equal(first.match.id, '*');
    assert.equal(first.component, NotFound);
    assert.deepEqual(direct.assigned, []);

    // goto: 표에 없는 경로는 404 화면 대신 브라우저 전체 이동. history·onChange 는 그대로.
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/auth/logout');
    assert.deepEqual(fake.assigned, ['http://app.test/auth/logout']);
    assert.equal(fake.entries.length, 1);
    assert.equal(seen.length, 1);

    // popstate 로 폴백만 걸리는 주소에 떨어져도 전체 이동.
    const back = fakeEnv('http://app.test/unknown');
    back.env.pushState(null, 'http://app.test/');
    const r3 = createRouter(routes, back.env, () => {});
    await r3.start();
    back.back();
    assert.deepEqual(back.assigned, ['http://app.test/unknown']);
  });

  test('지연 로드 컴포넌트는 1차 미구현 에러로 reject 한다(load 유무와 무관)', async () => {
    const lazy: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/lazy', component: () => Promise.resolve({ default: Project }) },
      { path: '/lazy-load', component: () => Promise.resolve({ default: Project }), load: () => ({}) },
    ];
    const fake = fakeEnv();
    const router = createRouter(lazy, fake.env, () => {});
    await router.start();
    const isLazy = (e: unknown) => e instanceof NotImplementedError && /지연 로드/.test(e.message);
    await assert.rejects(router.navigate('/lazy'), isLazy);
    await assert.rejects(router.navigate('/lazy-load'), isLazy);
  });

  test('stop 뒤에는 popstate 를 무시한다', async () => {
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/project/1');
    router.stop();
    fake.back();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(seen.length, 2);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 브라우저가 라우터를 거치지 않고 해시 링크로 항목을 만들고 popstate(state null)를 내는 것을 흉내 낸다. */
function hashClick(fake: FakeEnv, href: string, pop: (state: unknown) => void) {
  fake.nativePush(href);
  pop(null);
}

/** load 호출을 기록하는 라우트 표. 목록(/list)·상세(/detail/:id)·load 없는 홈(/) */
function loadRoutes() {
  const calls: Array<{ id: string; url: string; params: Record<string, string>; fetch: unknown }> = [];
  const List = comp('List');
  const Detail = comp('Detail');
  const r: RouteDefinition[] = [
    { path: '/', component: Home },
    {
      path: '/list',
      component: List,
      load: ({ url, params, fetch }) => {
        calls.push({ id: '/list', url: url.href, params, fetch });
        return { items: calls.length };
      },
    },
    {
      path: '/detail/:id',
      component: Detail,
      load: ({ url, params, fetch }) => {
        calls.push({ id: '/detail/:id', url: url.href, params, fetch });
        if (params.id === 'bad') error(400, 'Invalid id');
        if (params.id === 'boom') throw new Error('boom');
        return { id: params.id };
      },
    },
  ];
  return { routes: r, calls, List, Detail };
}

/** fake env 의 popstate 처리기를 꺼낸다(hashClick 용) */
function capturePop(fake: FakeEnv): () => (state: unknown) => void {
  let handler: ((state: unknown) => void) | null = null;
  const original = fake.env.onPopState;
  fake.env.onPopState = (h) => {
    handler = h;
    return original(h);
  };
  return () => handler!;
}

const ErrorPage = comp('ErrorPage');

describe('load 없는 라우트는 v0.3.0 동작 그대로', () => {
  test('goto 는 부른 자리에서 동기로 pushState 하고, 끝나면 status 200·error null·data undefined', async () => {
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    const p = router.navigate('/project/7', { state: { a: 1 } });
    assert.equal(fake.entries.length, 2, 'await 전에 이미 history 가 늘었다');
    assert.equal(fake.env.currentHref(), 'http://app.test/project/7');
    assert.equal(seen.length, 1, 'page 갱신은 그 뒤');
    await p;
    const last = seen.at(-1)!;
    assert.equal(last.status, 200);
    assert.equal(last.error, null);
    assert.equal(last.data, undefined);
    assert.deepEqual(last.state, { a: 1 });
  });

  test('start 는 history 를 건드리지 않고, 첫 page.state 는 빈 객체다', async () => {
    const fake = fakeEnv();
    fake.entries[0]!.state = { leftover: true };
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    assert.deepEqual(fake.entries[0]?.state, { leftover: true });
    assert.deepEqual(seen[0]?.state, {});
  });

  test('state 가 객체가 아니면 page.state 는 빈 객체, goto replace 는 길이를 늘리지 않는다', async () => {
    const fake = fakeEnv();
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/project/1', { state: 5 });
    assert.deepEqual(seen.at(-1)?.state, {});
    await router.navigate('/project/2', { replace: true, state: { r: true } });
    assert.equal(fake.entries.length, 2);
    assert.deepEqual(seen.at(-1)?.state, { r: true });
  });

  test('표식 없는 항목으로 popstate 하면 그 history.state 를 page.state 로 쓰고, 해시 이동도 지금처럼 다시 그린다', async () => {
    const fake = fakeEnv('http://app.test/project/1');
    const pop = capturePop(fake);
    fake.entries[0]!.state = { foreign: 1 };
    const seen: Resolved[] = [];
    const router = createRouter(routes, fake.env, (r) => seen.push(r));
    await router.start();
    await router.navigate('/');
    fake.back();
    await tick();
    assert.equal(seen.at(-1)?.match.id, '/project/:id');
    assert.deepEqual(seen.at(-1)?.state, { foreign: 1 });
    // 해시 링크(브라우저 처리) → popstate(null): v0.3.0 처럼 page.url 이 해시까지 바뀌고 state 는 빈 객체.
    const before = seen.length;
    hashClick(fake, 'http://app.test/project/1#sec', pop());
    await tick();
    assert.equal(seen.length, before + 1);
    assert.equal(seen.at(-1)?.url.hash, '#sec');
    assert.deepEqual(seen.at(-1)?.state, {});
  });
});

describe('load', () => {
  test('start·goto 에서 { fetch, params, url } 로 부르고 반환값이 data 가 된다', async () => {
    const { routes: r, calls, Detail } = loadRoutes();
    const fake = fakeEnv('http://app.test/detail/7?tab=x');
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    const first = await router.start();
    assert.deepEqual(first.data, { id: '7' });
    assert.equal(first.component, Detail);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://app.test/detail/7?tab=x');
    assert.deepEqual(calls[0]?.params, { id: '7' });
    assert.equal(calls[0]?.fetch, fake.env.fetch, '전역 fetch(env.fetch)를 그대로 넘긴다');
    await router.navigate('/list?q=1');
    assert.equal(calls.at(-1)?.url, 'http://app.test/list?q=1');
    assert.deepEqual(seen.at(-1)?.data, { items: 2 });
    assert.equal(seen.at(-1)?.status, 200);
  });

  test('순서는 매칭 → load → history 기록 → page 갱신이고, goto 는 page 갱신 뒤에 끝난다', async () => {
    const order: string[] = [];
    const gate = deferred<void>();
    const fake = fakeEnv();
    const r: RouteDefinition[] = [
      { path: '/', component: Home },
      {
        path: '/slow',
        component: Project,
        load: async () => {
          order.push(`load(entries=${fake.entries.length})`);
          await gate.promise;
          return { ok: true };
        },
      },
    ];
    const push = fake.env.pushState;
    fake.env.pushState = (s, h) => {
      order.push('push');
      push(s, h);
    };
    const router = createRouter(r, fake.env, (x) => order.push(`change:${x.match.id}`));
    await router.start();
    const p = router.navigate('/slow').then(() => order.push('goto done'));
    await tick();
    assert.equal(fake.entries.length, 1, 'load 가 끝나기 전에는 주소를 바꾸지 않는다');
    gate.resolve();
    await p;
    assert.deepEqual(order, ['change:/', 'load(entries=1)', 'push', 'change:/slow', 'goto done']);
  });

  test('오류 화면이 없으면 load 오류로 reject 하고 주소·page 는 그대로다', async () => {
    const { routes: r } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    await assert.rejects(router.navigate('/detail/boom'), /boom/);
    assert.equal(fake.entries.length, 1);
    assert.equal(seen.length, 1);
    assert.equal(router.current?.match.id, '/list');
  });

  test('오류 화면이 있으면 error(400) 은 그 status·message, 일반 Error 는 500 Internal Error 로 그리고 주소는 기록한다', async () => {
    const { routes: r, Detail } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const seen: Resolved[] = [];
    const unexpected: unknown[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x), { error: ErrorPage, onUnexpectedError: (e) => unexpected.push(e) });
    await router.start();
    await router.navigate('/detail/bad');
    assert.equal(fake.entries.length, 2);
    assert.equal(fake.env.currentHref(), 'http://app.test/detail/bad');
    let last = seen.at(-1)!;
    assert.equal(last.component, ErrorPage);
    assert.equal(last.status, 400);
    assert.deepEqual(last.error, { message: 'Invalid id' });
    assert.equal(last.match.id, '/detail/:id');
    assert.deepEqual(last.match.params, { id: 'bad' });
    assert.deepEqual(unexpected, [], 'error() 는 예상한 오류라 알리지 않는다');

    await router.navigate('/detail/boom');
    last = seen.at(-1)!;
    assert.equal(last.status, 500);
    assert.deepEqual(last.error, { message: 'Internal Error' });
    assert.equal(unexpected.length, 1);
    assert.match(String(unexpected[0]), /boom/);

    await router.navigate('/detail/3');
    last = seen.at(-1)!;
    assert.equal(last.component, Detail);
    assert.equal(last.status, 200);
    assert.equal(last.error, null);
  });

  test('직접 진입(start)의 load 오류도 오류 화면으로 그린다', async () => {
    const { routes: r } = loadRoutes();
    const fake = fakeEnv('http://app.test/detail/bad');
    const router = createRouter(r, fake.env, () => {}, { error: ErrorPage });
    const first = await router.start();
    assert.equal(first.component, ErrorPage);
    assert.equal(first.status, 400);
  });

  test('error() 는 400~599 밖의 status 를 거부한다', () => {
    assert.throws(() => error(302, 'x'), /400~599/);
    assert.throws(() => error(404), (e: unknown) => (e as { status: number; body: { message: string } }).status === 404 && (e as { body: { message: string } }).body.message === 'Error: 404');
  });

  test('겹친 이동은 마지막 것만 반영하고 앞선 goto 는 history 를 남기지 않고 끝난다', async () => {
    const slow = deferred<unknown>();
    const fake = fakeEnv();
    const r: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/a', component: Project, load: () => slow.promise },
      { path: '/b', component: Settings, load: () => ({ b: true }) },
    ];
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    const a = router.navigate('/a');
    await router.navigate('/b');
    slow.resolve({ a: true });
    await a;
    assert.deepEqual(fake.entries.map((e) => e.href), ['http://app.test/', 'http://app.test/b']);
    assert.equal(router.current?.match.id, '/b');
    assert.deepEqual(seen.map((x) => x.match.id), ['/', '/b']);
  });

  test('load 중 뒤로가기가 오면 그 이동은 버린다', async () => {
    const slow = deferred<unknown>();
    const fake = fakeEnv();
    const r: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/x', component: Settings },
      { path: '/a', component: Project, load: () => slow.promise },
    ];
    const router = createRouter(r, fake.env, () => {});
    await router.start();
    await router.navigate('/x');
    const a = router.navigate('/a');
    fake.back();
    await tick();
    slow.resolve({});
    await a;
    assert.equal(router.current?.match.id, '/');
    assert.equal(fake.entries.length, 2, '/a 는 기록되지 않았다');
  });
});

describe('replaceState', () => {
  test('history 항목만 바꾸고 page.state 만 갱신한다. page.url·load·컴포넌트는 그대로', async () => {
    const { routes: r, calls, List } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    const data = seen[0]!.data;
    router.replaceState('/list?q=1', { f: 1 });
    assert.equal(calls.length, 1, 'load 를 다시 부르지 않는다');
    assert.equal(fake.entries.length, 1);
    assert.equal(fake.entries[0]?.href, 'http://app.test/list?q=1');
    const entry = fake.entries[0]?.state;
    assert.ok(isHistoryEntry(entry));
    assert.deepEqual(entry.state, { f: 1 });
    assert.equal(entry.url, 'http://app.test/list', 'page.url 을 같이 남긴다');
    const last = seen.at(-1)!;
    assert.equal(last.url.href, 'http://app.test/list', 'page.url 은 바꾸지 않는다');
    assert.deepEqual(last.state, { f: 1 });
    assert.equal(last.component, List);
    assert.equal(last.data, data);
    router.replaceState('', { f: 2 });
    assert.equal(fake.entries[0]?.href, 'http://app.test/list?q=1', "'' 은 주소를 그대로 둔다");
    assert.deepEqual(seen.at(-1)?.state, { f: 2 });
  });

  test('첫 화면 전에 부르면 던진다', () => {
    const router = createRouter(routes, fakeEnv().env, () => {});
    assert.throws(() => router.replaceState('/', {}), /첫 화면/);
  });
});

describe('popstate 얕은·깊은 이동', () => {
  test('깊은 이동: 목록(필터 replaceState) → 상세 → 뒤로가기는 목록 load 를 page.url 로 다시 돌리고 state 를 복원한다', async () => {
    const { routes: r, calls, List } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    router.replaceState('/list?q=1', { f: 1 });
    await router.navigate('/detail/5');
    assert.equal(calls.length, 2);
    fake.back();
    await tick();
    assert.equal(calls.length, 3, '목록 load 가 다시 돈다');
    assert.equal(calls.at(-1)?.url, 'http://app.test/list', 'load 의 url 은 남겨 둔 page.url');
    const last = seen.at(-1)!;
    assert.equal(last.component, List);
    assert.deepEqual(last.state, { f: 1 });
    assert.equal(last.url.href, 'http://app.test/list');
    assert.equal(fake.env.currentHref(), 'http://app.test/list?q=1', '주소창은 replaceState 한 주소');
    // 앞으로가기도 깊은 이동이며 state 는 goto 때 것(빈 객체)
    fake.forward();
    await tick();
    assert.equal(calls.length, 4);
    assert.equal(seen.at(-1)?.match.id, '/detail/:id');
    assert.deepEqual(seen.at(-1)?.state, {});
  });

  test('얕은 이동: 해시 링크와 그 뒤로가기는 load 를 돌리지 않고 page.url·page.state 만 바꾼다', async () => {
    const { routes: r, calls, Detail } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const pop = capturePop(fake);
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    await router.navigate('/detail/5', { state: { s: 1 } });
    const data = seen.at(-1)!.data;
    hashClick(fake, 'http://app.test/detail/5#file-1', pop());
    await tick();
    assert.equal(calls.length, 2, '해시 이동은 load 를 부르지 않는다');
    assert.equal(seen.at(-1)?.url.hash, '#file-1');
    assert.deepEqual(seen.at(-1)?.state, { s: 1 }, '표식 없는 해시 항목은 page.state 를 그대로 둔다');
    fake.back();
    await tick();
    assert.equal(calls.length, 2, '같은 내비게이션 번호로 돌아오는 뒤로가기도 얕은 이동');
    const last = seen.at(-1)!;
    assert.equal(last.url.href, 'http://app.test/detail/5');
    assert.equal(last.component, Detail);
    assert.equal(last.data, data);
    assert.deepEqual(last.state, { s: 1 });
    fake.forward();
    await tick();
    assert.equal(calls.length, 2, '앞으로가기(해시만 다름)도 얕은 이동');
  });

  test('새로고침: history 의 state 를 page.state 로 되살리지 않고 load 는 한 번, 내비게이션 번호는 이어 쓴다', async () => {
    const { routes: r, calls } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const first = createRouter(r, fake.env, () => {});
    await first.start();
    first.replaceState('/list?q=1', { f: 1 });
    first.stop();
    // 같은 history 항목에서 새 문서가 뜬다
    const pop = capturePop(fake);
    const seen: Resolved[] = [];
    const reloaded = createRouter(r, fake.env, (x) => seen.push(x));
    await reloaded.start();
    assert.equal(calls.length, 2);
    assert.equal(calls.at(-1)?.url, 'http://app.test/list?q=1', '새로고침 뒤 load 는 주소창 주소로 돈다');
    assert.deepEqual(seen[0]?.state, {});
    const kept = fake.entries[0]?.state;
    assert.ok(isHistoryEntry(kept));
    assert.equal(kept.url, undefined, '앞 문서의 page.url 은 지운다. 새 page.url 은 주소창 주소');
    assert.equal(fake.entries[0]?.href, 'http://app.test/list?q=1');
    hashClick(fake, 'http://app.test/list?q=1#top', pop());
    fake.back();
    await tick();
    assert.equal(calls.length, 2, '이어 쓴 번호라 뒤로가기가 얕은 이동');
    assert.deepEqual(seen.at(-1)?.state, { f: 1 });
  });
});

describe('invalidateAll', () => {
  test('현재 page.url 로 load 를 다시 돌려 data 를 바꾸고 page.state 는 비운다. 컴포넌트·history 는 그대로', async () => {
    const { routes: r, calls, List } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    router.replaceState('/list?status=failed', { f: 1 });
    await router.invalidateAll();
    assert.equal(calls.length, 2);
    assert.equal(calls.at(-1)?.url, 'http://app.test/list', 'replaceState 한 주소가 아니라 page.url');
    const last = seen.at(-1)!;
    assert.deepEqual(last.data, { items: 2 });
    assert.deepEqual(last.state, {});
    assert.equal(last.component, List);
    assert.equal(fake.entries.length, 1);
    assert.equal(fake.entries[0]?.href, 'http://app.test/list?status=failed');
    const entry = fake.entries[0]?.state;
    assert.ok(isHistoryEntry(entry));
    assert.deepEqual(entry.state, { f: 1 }, 'history 항목의 state 는 남는다(옛 빌드 실측과 같음)');
  });

  test('같은 틱의 호출은 한 번으로 묶는다', async () => {
    const { routes: r, calls } = loadRoutes();
    const fake = fakeEnv('http://app.test/list');
    const router = createRouter(r, fake.env, () => {});
    await router.start();
    await Promise.all([router.invalidateAll(), router.invalidateAll(), router.invalidateAll()]);
    assert.equal(calls.length, 2);
    await router.invalidateAll();
    assert.equal(calls.length, 3, '다음 틱의 호출은 따로 돈다');
  });

  test('재실행 중에 다른 이동이 오면 결과를 버린다', async () => {
    const gate = deferred<void>();
    let n = 0;
    const fake = fakeEnv('http://app.test/list');
    const r: RouteDefinition[] = [
      { path: '/', component: Home },
      {
        path: '/list',
        component: Project,
        load: async () => {
          n++;
          if (n === 2) await gate.promise;
          return { n };
        },
      },
    ];
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x));
    await router.start();
    const inv = router.invalidateAll();
    await tick();
    await router.navigate('/');
    gate.resolve();
    await inv;
    assert.equal(router.current?.match.id, '/');
    assert.deepEqual(seen.map((x) => x.match.id), ['/list', '/']);
  });

  test('load 오류면 오류 화면으로 바꾸고, 다시 성공하면 원래 컴포넌트로 돌아온다', async () => {
    let fail = false;
    const fake = fakeEnv('http://app.test/list');
    const r: RouteDefinition[] = [
      {
        path: '/list',
        component: Project,
        load: () => {
          if (fail) error(503, 'down');
          return {};
        },
      },
    ];
    const seen: Resolved[] = [];
    const router = createRouter(r, fake.env, (x) => seen.push(x), { error: ErrorPage });
    await router.start();
    fail = true;
    await router.invalidateAll();
    assert.equal(seen.at(-1)?.component, ErrorPage);
    assert.equal(seen.at(-1)?.status, 503);
    fail = false;
    await router.invalidateAll();
    assert.equal(seen.at(-1)?.component, Project);
  });
});
