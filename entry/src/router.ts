// 라우트 패턴 매칭과 내비게이션 상태 기계. DOM 에 직접 닿지 않고 RouterEnv 를 통해서만 history·location 을 만진다.
// 그래서 node:test 에서 가짜 env 로 단위 테스트할 수 있다.
import type { Component } from 'svelte';
import type { PageProps, RouteDefinition } from './types.ts';
import { NotImplementedError } from './errors.ts';

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
  pushState(state: unknown, href: string): void;
  replaceState(state: unknown, href: string): void;
  /** 브라우저 전체 이동(location.href = href). 라우트 표에 없는 경로가 여기로 간다(D-3). */
  assign(href: string): void;
  /** popstate 구독. 해지 함수를 돌려준다. */
  onPopState(handler: (state: unknown) => void): () => void;
}

export function browserEnv(): RouterEnv {
  return {
    currentHref: () => location.href,
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
  };
}

/** 한 번의 이동이 끝난 뒤 mount 쪽에 알리는 결과. */
export interface Resolved {
  url: URL;
  match: RouteMatch;
  component: Component<PageProps>;
  data: unknown;
  state: Record<string, unknown>;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export interface Router {
  /** 현재 주소로 첫 라우트를 해석하고 popstate 를 구독한다. 라우트 표에 없으면 에러(폴백 `*` 를 두면 된다). */
  start(): Promise<Resolved>;
  stop(): void;
  /** goto 와 가로챈 링크가 부르는 이동. 라우트 표에 없거나(`*` 폴백만 걸려도) 다른 origin 이면 전체 이동으로 넘기고 resolve 한다. */
  navigate(href: string | URL, opts?: NavigateOptions): Promise<void>;
  /** href 를 현재 주소 기준으로 해석하고 라우트 표와 맞춰 본다. 다른 origin 이면 match 는 null. 링크 가로채기는 `isNavigable` 로 판정한다. */
  resolve(href: string | URL): { url: URL; match: RouteMatch | null };
  readonly current: Resolved | null;
}

function toState(state: unknown): Record<string, unknown> {
  return state !== null && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

/** 라우트의 컴포넌트·데이터를 준비한다. 지연 로드·load 는 1차 미구현(entry-설계 3.7). */
async function prepare(match: RouteMatch, url: URL): Promise<{ component: Component<PageProps>; data: unknown }> {
  const { route } = match;
  if (route.load) {
    throw new NotImplementedError('RouteDefinition.load', `라우트 "${match.id}" 의 load 를 지우거나 뒤 티켓을 기다리세요. (${url.pathname})`);
  }
  const component = route.component as Component<PageProps> & { length?: number };
  // Svelte 5 컴포넌트 함수는 (anchor, props) 두 인자, 지연 로드 함수 `() => import()` 는 0개다.
  if (typeof component === 'function' && component.length === 0) {
    throw new NotImplementedError('지연 로드 라우트(() => import())', `라우트 "${match.id}" 를 정적 import 로 바꾸세요.`);
  }
  return { component, data: undefined };
}

export function createRouter(
  routes: RouteDefinition[],
  env: RouterEnv,
  onChange: (resolved: Resolved) => void,
): Router {
  const compiled = compileRoutes(routes);
  let current: Resolved | null = null;
  let unsubscribe: (() => void) | null = null;
  // 뒤로가기·goto 가 겹칠 때 마지막 이동만 반영한다.
  let token = 0;

  const resolve: Router['resolve'] = (href) => {
    const url = new URL(href, env.currentHref());
    const base = new URL(env.currentHref());
    if (url.origin !== base.origin) return { url, match: null };
    return { url, match: matchRoute(compiled, url.pathname) };
  };

  async function apply(url: URL, match: RouteMatch, state: unknown, my: number): Promise<Resolved | null> {
    const { component, data } = await prepare(match, url);
    if (my !== token) return null;
    const resolved: Resolved = { url, match, component, data, state: toState(state) };
    current = resolved;
    onChange(resolved);
    return resolved;
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
      unsubscribe?.();
      unsubscribe = env.onPopState((state) => {
        const now = new URL(env.currentHref());
        const m = matchRoute(compiled, now.pathname);
        if (!isNavigable(m)) {
          // 라우트 표 밖으로 되돌아간 경우(폴백만 걸리는 경우 포함): 서버가 알아서 그리게 전체 이동(D-3).
          env.assign(now.href);
          return;
        }
        const my = ++token;
        void apply(now, m, state, my).catch((err) => {
          console.error(err);
        });
      });
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
      // 설계 3.3: push → 매칭 → load → page 갱신 → 교체. load 가 던지면 reject 하고 page 는 바뀌지 않는다.
      if (opts.replace) env.replaceState(opts.state ?? null, url.href);
      else env.pushState(opts.state ?? null, url.href);
      await apply(url, match, opts.state ?? null, my);
    },
  };
}
