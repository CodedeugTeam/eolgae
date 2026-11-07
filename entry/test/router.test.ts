// 라우트 매칭과 라우터 상태 기계. DOM 없이 가짜 RouterEnv 로 history 동작을 확인한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileRoutes, createRouter, matchRoute, type Resolved, type RouterEnv } from '../src/router.ts';
import { NotImplementedError } from '../src/errors.ts';
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
  test('* 는 폴백, 없으면 null', () => {
    assert.equal(matchRoute(routes, '/nope/anything')?.id, '*');
    assert.equal(matchRoute(routes.slice(0, 3), '/nope'), null);
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
}

function fakeEnv(initial = 'http://app.test/'): FakeEnv {
  let popHandler: ((state: unknown) => void) | null = null;
  const fake: FakeEnv = {
    entries: [{ state: null, href: initial }],
    index: 0,
    assigned: [],
    env: {
      currentHref: () => fake.entries[fake.index]!.href,
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
    assert.deepEqual(fake.entries[1]?.state, { from: 'home' });
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

  test('load 가 있는 라우트·지연 로드 컴포넌트는 1차 미구현 에러로 reject 한다', async () => {
    const withLoad: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/data', component: Project, load: () => ({}) },
      { path: '/lazy', component: () => Promise.resolve({ default: Project }) },
    ];
    const fake = fakeEnv();
    const router = createRouter(withLoad, fake.env, () => {});
    await router.start();
    await assert.rejects(router.navigate('/data'), NotImplementedError);
    await assert.rejects(router.navigate('/lazy'), (e: unknown) => e instanceof NotImplementedError && /지연 로드/.test(e.message));
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
