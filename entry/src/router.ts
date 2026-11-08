// 라우트 패턴 매칭과 내비게이션 상태 기계. DOM 에 직접 닿지 않고 RouterEnv 를 통해서만 history·location 을 만진다.
// 그래서 node:test 에서 가짜 env 로 단위 테스트할 수 있다.
import type { Component } from 'svelte';
import type { PageProps, RouteDefinition } from './types.ts';
import { HttpError, NotImplementedError, type PageError } from './errors.ts';

export interface RouteMatch {
  route: RouteDefinition;
  /** 라우트 표에 적힌 패턴 그대로. `page.route.id` 가 된다. */
  id: string;
  params: Record<string, string>;
  /** `*` 폴백에 걸린 매치. 직접 진입(start)에서만 그리고, goto·링크 가로채기에서는 「라우트 없음」으로 본다(D-3). */
  fallback: boolean;
}

/** goto·링크 가로채기가 SPA 이동으로 다룰 매치인지. 폴백은 브라우저 전체 이동으로 넘긴다. */
export function isNavigable(match: RouteMatch | null): match is RouteMatch {
  return match !== null && !match.fallback;
}

type Segment = { kind: 'static'; value: string } | { kind: 'param'; name: string };

interface CompiledRoute {
  route: RouteDefinition;
  id: string;
  /** `*` 폴백이면 null */
  segments: Segment[] | null;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((s) => s !== '');
}

function compile(route: RouteDefinition): CompiledRoute {
  const { path } = route;
  if (path === '*') return { route, id: path, segments: null };
  if (!path.startsWith('/')) {
    throw new Error(`[eolgae] 라우트 경로는 "/" 로 시작하거나 "*" 이어야 합니다: "${path}"`);
  }
  const segments: Segment[] = splitPath(path).map((s) =>
    s.startsWith(':') ? { kind: 'param', name: s.slice(1) } : { kind: 'static', value: s },
  );
  return { route, id: path, segments };
}

function matchSegments(segments: Segment[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const part = parts[i]!;
    if (seg.kind === 'static') {
      if (seg.value !== part) return null;
    } else {
      // 잘못된 퍼센트 인코딩(`%E0%A4%A`)이면 URIError 대신 원문을 그대로 둔다.
      try {
        params[seg.name] = decodeURIComponent(part);
      } catch {
        params[seg.name] = part;
      }
    }
  }
  return params;
}

/** 정적 세그먼트가 많은 쪽이 먼저 매칭되도록 정렬한다(정적 > :param, `*` 는 맨 뒤). */
function specificity(c: CompiledRoute): number {
  if (c.segments === null) return -1;
  return c.segments.filter((s) => s.kind === 'static').length;
}

export function compileRoutes(routes: RouteDefinition[]): CompiledRoute[] {
  const compiled = routes.map(compile);
  const seen = new Set<string>();
  for (const c of compiled) {
    if (seen.has(c.id)) throw new Error(`[eolgae] 라우트 경로가 중복됐습니다: "${c.id}"`);
    seen.add(c.id);
  }
  // 안정 정렬: 같은 점수면 표에 적힌 순서를 지킨다.
  return compiled
    .map((c, i) => ({ c, i }))
    .sort((a, b) => specificity(b.c) - specificity(a.c) || a.i - b.i)
    .map(({ c }) => c);
}

/**
 * pathname 을 라우트 표와 맞춰 본다. 정적 세그먼트 우선, `:param` 은 한 세그먼트, `*` 는 폴백.
 * 끝의 `/` 는 무시한다(`/about/` 과 `/about` 은 같은 라우트).
 */
export function matchRoute(routes: RouteDefinition[] | CompiledRoute[], pathname: string): RouteMatch | null {
  const compiled: CompiledRoute[] =
    routes.length > 0 && 'segments' in routes[0]! ? (routes as CompiledRoute[]) : compileRoutes(routes as RouteDefinition[]);
  const parts = splitPath(pathname);
  let fallback: CompiledRoute | null = null;
  for (const c of compiled) {
    if (c.segments === null) {
      fallback = c;
      continue;
    }
    const params = matchSegments(c.segments, parts);
    if (params) return { route: c.route, id: c.id, params, fallback: false };
  }
  if (fallback) return { route: fallback.route, id: fallback.id, params: {}, fallback: true };
  return null;
}

/** 라우터가 브라우저에 닿는 유일한 창. 테스트는 가짜 구현을 넣는다. */
export interface RouterEnv {
  /** 현재 문서 주소(location.href) */
  currentHref(): string;
  /** 현재 history 항목의 state(history.state) */
  currentState(): unknown;
  pushState(state: unknown, href: string): void;
  replaceState(state: unknown, href: string): void;
  /** 브라우저 전체 이동(location.href = href). 라우트 표에 없는 경로가 여기로 간다(D-3). */
  assign(href: string): void;
  /** popstate 구독. 해지 함수를 돌려준다. */
  onPopState(handler: (state: unknown) => void): () => void;
  /** load 에 넘길 fetch. 브라우저에서는 전역 fetch 다. */
  fetch: typeof fetch;
}

export function browserEnv(): RouterEnv {
  return {
    currentHref: () => location.href,
    currentState: () => history.state,
    pushState: (state, href) => history.pushState(state, '', href),
    replaceState: (state, href) => history.replaceState(state, '', href),
    assign: (href) => {
      location.href = href;
    },
    onPopState: (handler) => {
      const listener = (e: PopStateEvent) => handler(e.state);
      addEventListener('popstate', listener);
      return () => removeEventListener('popstate', listener);
    },
    // 전역 fetch 를 그대로 넘긴다. 상대 URL 은 문서 주소 기준으로 풀린다(SvelteKit 클라이언트 fetch 와 같은 요청).
    fetch: (input, init) => globalThis.fetch(input, init),
  };
}

/**
 * 라우터가 history 에 남기는 항목. 표식(`eolgae`)이 있는 항목만 라우터가 만든 것으로 본다.
 * - `nav`: 내비게이션 번호. 깊은 이동(load 를 도는 이동)마다 새로 받고, `replaceState` 와 goto `replaceState` 는 그대로 둔다.
 *   popstate 로 같은 번호에 돌아오면 얕은 이동이다(SvelteKit 의 NAVIGATION_INDEX).
 * - `url`: `replaceState` 가 남기는 「page.url」. 주소창은 바뀌어도 page.url·load 의 url 은 이 값이다(SvelteKit PAGE_URL_KEY).
 * - `state`: `page.state` 로 되돌릴 값.
 */
export interface HistoryEntry {
  eolgae: 1;
  nav: number;
  url?: string;
  state: unknown;
}

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  return value !== null && typeof value === 'object' && (value as { eolgae?: unknown }).eolgae === 1 && typeof (value as { nav?: unknown }).nav === 'number';
}

/** 한 번의 이동이 끝난 뒤 mount 쪽에 알리는 결과. */
export interface Resolved {
  url: URL;
  match: RouteMatch;
  component: Component<PageProps>;
  data: unknown;
  state: Record<string, unknown>;
  /** 200, 또는 load 가 던진 오류의 상태 */
  status: number;
  error: PageError | null;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export interface RouterOptions {
  /** load 가 던졌을 때 그릴 화면. 없으면 load 오류를 그대로 던진다. */
  error?: Component<PageProps>;
  /** `error()` 로 던지지 않은 load 오류를 알리는 곳. 기본은 console.error(SvelteKit 기본 handleError 와 같음). */
  onUnexpectedError?: (err: unknown) => void;
}

export interface Router {
  /** 현재 주소로 첫 라우트를 해석하고 popstate 를 구독한다. 라우트 표에 없으면 에러(폴백 `*` 를 두면 된다). */
  start(): Promise<Resolved>;
  stop(): void;
  /** goto 와 가로챈 링크가 부르는 이동. 라우트 표에 없거나(`*` 폴백만 걸려도) 다른 origin 이면 전체 이동으로 넘기고 resolve 한다. */
  navigate(href: string | URL, opts?: NavigateOptions): Promise<void>;
  /** 얕은 라우팅(D-5): history 항목과 page.state 만 바꾼다. page.url 은 그대로, load·컴포넌트는 건드리지 않는다. `''` 은 현재 주소. */
  replaceState(href: string | URL, state: Record<string, unknown>): void;
  /** 현재 라우트의 load 를 현재 page.url 로 다시 실행해 data 를 바꾼다. 같은 틱 호출은 한 번으로 묶는다. page.state 는 비운다. */
  invalidateAll(): Promise<void>;
  /** href 를 현재 주소 기준으로 해석하고 라우트 표와 맞춰 본다. 다른 origin 이면 match 는 null. 링크 가로채기는 `isNavigable` 로 판정한다. */
  resolve(href: string | URL): { url: URL; match: RouteMatch | null };
  readonly current: Resolved | null;
}

function toState(state: unknown): Record<string, unknown> {
  return state !== null && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

/** 지연 로드 컴포넌트는 1차 미구현(entry-설계 3.7). 이동을 시작하기 전에 동기로 거른다. */
function routeComponent(match: RouteMatch): Component<PageProps> {
  const component = match.route.component as Component<PageProps> & { length?: number };
  // Svelte 5 컴포넌트 함수는 (anchor, props) 두 인자, 지연 로드 함수 `() => import()` 는 0개다.
  if (typeof component === 'function' && component.length === 0) {
    throw new NotImplementedError('지연 로드 라우트(() => import())', `라우트 "${match.id}" 를 정적 import 로 바꾸세요.`);
  }
  return component;
}

/** 경로·쿼리가 같고 해시만 다른가 */
function hashOnlyChange(a: URL, b: URL): boolean {
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && a.hash !== b.hash;
}

type Prepared = Omit<Resolved, 'url' | 'match' | 'state'>;

export function createRouter(
  routes: RouteDefinition[],
  env: RouterEnv,
  onChange: (resolved: Resolved) => void,
  options: RouterOptions = {},
): Router {
  const compiled = compileRoutes(routes);
  const onUnexpectedError = options.onUnexpectedError ?? ((err: unknown) => console.error(err));
  let current: Resolved | null = null;
  let unsubscribe: (() => void) | null = null;
  // 뒤로가기·goto·invalidateAll 이 겹칠 때 마지막 것만 반영한다.
  let token = 0;
  // 지금 history 항목의 내비게이션 번호와 주소창 주소(shownUrl). popstate 의 얕은/깊은 판정에 쓴다.
  let currentNav = 0;
  let lastNav = 0;
  let shownUrl: URL | null = null;
  // invalidateAll 같은 틱 묶기(SvelteKit _invalidate 의 pending_invalidate)
  let pendingInvalidate: Promise<void> | null = null;

  /** 겹치지 않는 새 내비게이션 번호. 새로고침 뒤에도 앞선 문서의 번호와 겹치지 않게 시각을 바탕으로 한다(SvelteKit 과 같음). */
  function nextNav(): number {
    lastNav = Math.max(Date.now(), lastNav + 1);
    return lastNav;
  }

  const resolve: Router['resolve'] = (href) => {
    const url = new URL(href, env.currentHref());
    const base = new URL(env.currentHref());
    if (url.origin !== base.origin) return { url, match: null };
    return { url, match: matchRoute(compiled, url.pathname) };
  };

  /** 컴포넌트와 load 결과를 준비한다. load 가 던지면 오류 화면 결과로 바꾸고, 오류 화면이 없으면 그대로 던진다. */
  async function prepare(match: RouteMatch, url: URL, component: Component<PageProps>): Promise<Prepared> {
    const { load } = match.route;
    if (!load) return { component, data: undefined, status: 200, error: null };
    try {
      const data = await load({ fetch: env.fetch, params: match.params, url: new URL(url) });
      return { component, data, status: 200, error: null };
    } catch (err) {
      if (!options.error) throw err;
      if (err instanceof HttpError) return { component: options.error, data: undefined, status: err.status, error: err.body };
      onUnexpectedError(err);
      return { component: options.error, data: undefined, status: 500, error: { message: 'Internal Error' } };
    }
  }

  function commit(resolved: Resolved): Resolved {
    current = resolved;
    onChange(resolved);
    return resolved;
  }

  async function apply(url: URL, match: RouteMatch, state: unknown, my: number): Promise<Resolved | null> {
    const prepared = await prepare(match, url, routeComponent(match));
    if (my !== token) return null;
    return commit({ url, match, state: toState(state), ...prepared });
  }

  function onPopState(raw: unknown): void {
    const now = new URL(env.currentHref());
    const entry = isHistoryEntry(raw) ? raw : null;
    // replaceState 로 주소창만 바뀐 항목은 page.url 로 남긴 주소를 쓴다.
    const target = entry?.url ? new URL(entry.url) : now;
    const m = matchRoute(compiled, target.pathname);
    if (!isNavigable(m)) {
      // 라우트 표 밖으로 되돌아간 경우(폴백만 걸리는 경우 포함): 서버가 알아서 그리게 전체 이동(D-3).
      env.assign(now.href);
      return;
    }
    // 표식 없는 항목(앱 밖에서 생긴 해시 이동 등)은 깊은 이동이면 지금처럼 history.state 를 그대로 page.state 로 쓴다.
    const state = entry ? entry.state : raw;
    const prev = shownUrl;
    const shallow =
      current !== null &&
      current.match.route === m.route &&
      ((entry !== null && entry.nav === currentNav) || (prev !== null && hashOnlyChange(now, prev)));
    shownUrl = now;
    if (entry) currentNav = entry.nav;
    else if (!shallow) currentNav = nextNav();
    lastNav = Math.max(lastNav, currentNav);

    // 얕은 이동: 같은 내비게이션 번호, 또는 경로·쿼리가 같고 해시만 다르다. load 를 돌리지 않고 page.state·page.url 만 바꾼다.
    // load 가 없는 라우트는 v0.3.0 과 같은 경로(아래 apply)로 둔다. 그쪽도 load 를 돌지 않으므로 결과가 같다.
    if (shallow && current && current.match.route.load) {
      token++;
      // 표식 없는 항목(브라우저가 만든 해시 이동)은 page.state 를 그대로 둔다(SvelteKit 과 같음).
      commit({ ...current, url: target, state: entry ? toState(entry.state) : current.state });
      return;
    }
    const my = ++token;
    void apply(target, m, state, my).catch((err) => {
      console.error(err);
    });
  }

  return {
    get current() {
      return current;
    },
    resolve,
    async start() {
      const url = new URL(env.currentHref());
      const match = matchRoute(compiled, url.pathname);
      if (!match) {
        throw new Error(
          `[eolgae] 현재 경로 "${url.pathname}" 가 라우트 표에 없습니다. 폴백 라우트 { path: '*' } 를 추가하세요.`,
        );
      }
      // 새로고침이면 이 항목이 받았던 내비게이션 번호를 이어 쓴다. history 의 state 는 page.state 로 되살리지 않는다(SvelteKit 과 같음).
      const raw = env.currentState();
      currentNav = isHistoryEntry(raw) ? raw.nav : nextNav();
      lastNav = Math.max(lastNav, currentNav);
      shownUrl = url;
      // replaceState 가 남긴 page.url 은 앞 문서의 것이다. 새 문서의 page.url 은 주소창 주소이므로 지운다(SvelteKit 도 지운다).
      if (isHistoryEntry(raw) && raw.url !== undefined) {
        env.replaceState({ eolgae: 1, nav: raw.nav, state: raw.state } satisfies HistoryEntry, url.href);
      }
      unsubscribe?.();
      unsubscribe = env.onPopState(onPopState);
      const my = ++token;
      const resolved = await apply(url, match, null, my);
      // start 가 끝나기 전에 goto 가 끼어들었으면 그 이동 결과가 current 다.
      return (resolved ?? current)!;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      token++;
    },
    async navigate(href, opts = {}) {
      const { url, match } = resolve(href);
      if (!isNavigable(match)) {
        // 라우트 표에 없는 경로는 404 화면을 그리지 않고 브라우저 전체 이동으로 넘긴다(D-3). `*` 폴백은 직접 진입(start)에만 쓴다.
        env.assign(url.href);
        return;
      }
      const my = ++token;
      const raw = opts.state ?? null;
      const record = () => {
        const nav = opts.replace ? currentNav : nextNav();
        const entry: HistoryEntry = { eolgae: 1, nav, state: raw };
        if (opts.replace) env.replaceState(entry, url.href);
        else env.pushState(entry, url.href);
        currentNav = nav;
        shownUrl = url;
      };
      // load 가 있는 라우트는 SvelteKit 과 같게 매칭 → load → (성공) history 기록 → page 갱신. load 가 던져 오류 화면을 그릴 때도
      // 주소는 기록한다. 오류 화면이 없어 던지면 reject 하고 주소·page 는 그대로다.
      // load 가 없는 라우트는 v0.3.0 과 같게 history 를 먼저(동기로) 기록한다. goto 를 부른 그 자리에서 location 이 바뀌는 동작을 소비 앱에 그대로 둔다.
      if (!match.route.load) {
        record();
        await apply(url, match, raw, my);
        return;
      }
      const prepared = await prepare(match, url, routeComponent(match));
      if (my !== token) return;
      record();
      commit({ url, match, state: toState(raw), ...prepared });
    },
    replaceState(href, state) {
      if (!current || !shownUrl) throw new Error('[eolgae] replaceState 는 첫 화면이 그려진 뒤에 호출해야 합니다.');
      const url = new URL(href === '' ? shownUrl.href : href, env.currentHref());
      const entry: HistoryEntry = { eolgae: 1, nav: currentNav, url: current.url.href, state };
      env.replaceState(entry, url.href);
      shownUrl = url;
      commit({ ...current, state: toState(state) });
    },
    async invalidateAll() {
      // 같은 틱의 호출은 하나로 묶는다. 묶인 뒤쪽 호출은 재실행을 기다리지 않고 끝난다(SvelteKit 과 같음).
      await (pendingInvalidate ||= Promise.resolve());
      if (!pendingInvalidate) return;
      pendingInvalidate = null;
      if (!current) return;
      const { url, match } = current;
      const my = ++token;
      const prepared = await prepare(match, url, routeComponent(match));
      if (my !== token) return;
      // page.state 는 비운다(SvelteKit reset_page_state 기본값, 옛 빌드 실측과 같음). history 항목은 그대로 둔다.
      commit({ url, match, state: {}, ...prepared });
    },
  };
}
