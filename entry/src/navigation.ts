// goto·replaceState·invalidateAll 과 내부 <a href> 가로채기(D-3).
// 활성 라우터는 mount() 가 등록한다. page.svelte.ts 를 import 하지 않아 node:test 에서 바로 불러올 수 있다.
import type { GotoOptions } from './types.ts';
import type { Router } from './router.ts';
import { NotImplementedError } from './errors.ts';

let active: Router | null = null;

/** 패키지 내부용. mount() 가 라우터를 등록·해제한다. */
export function setActiveRouter(router: Router | null): void {
  active = router;
}

/**
 * 주소를 바꾸고 라우트를 교체한다. 라우트 표에 없는 경로·다른 origin 은 브라우저 전체 이동으로 넘긴다(D-3).
 * `opts.state` 는 history state 와 `page.state` 에 들어간다.
 */
export async function goto(href: string | URL, opts: GotoOptions = {}): Promise<void> {
  if (!active) {
    throw new Error('[eolgae] goto 는 mount() 뒤에 호출해야 합니다.');
  }
  await active.navigate(href, { replace: opts.replaceState ?? false, state: opts.state });
}

/** 얕은 라우팅(D-5). 1차 범위 밖이라 호출하면 미구현 에러를 던진다. */
export function replaceState(_href: string | URL | '', _state: Record<string, unknown>): void {
  throw new NotImplementedError('replaceState(얕은 라우팅)', 'gk-dash 전환 티켓에서 채운다.');
}

/** 현재 라우트의 load 재실행. 1차 범위 밖이라 호출하면 미구현 에러를 던진다. */
export async function invalidateAll(): Promise<void> {
  throw new NotImplementedError('invalidateAll', 'gk-dash 전환 티켓에서 채운다.');
}

/** 가로채기 판단에 필요한 만큼만 뽑은 링크 정보. DOM 없이도 만들 수 있어 테스트가 쉽다. */
export interface LinkInfo {
  /** href 속성 원문 */
  href: string;
  target: string | null;
  download: boolean;
  rel: string | null;
  /** 앵커 또는 조상에 data-eolgae-reload / data-sveltekit-reload 가 있는지 */
  reload: boolean;
}

export interface ClickInfo {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

export type InterceptDecision =
  | { intercept: true; url: URL }
  | {
      intercept: false;
      reason:
        | 'modifier'
        | 'prevented'
        | 'no-href'
        | 'target'
        | 'download'
        | 'rel-external'
        | 'reload-opt-out'
        | 'other-origin'
        | 'hash-only'
        | 'no-route';
    };

/**
 * 클릭을 가로채 SPA 이동으로 바꿀지 정한다. 제외 규칙은 SvelteKit 과 같고(D-3) 여기에
 * `data-sveltekit-reload`(전환기 인정)·`data-eolgae-reload`(정식) opt-out 과 라우트 표 미매칭을 더한다.
 */
export function decideIntercept(
  link: LinkInfo,
  click: ClickInfo,
  currentHref: string,
  hasRoute: (url: URL) => boolean,
): InterceptDecision {
  if (click.defaultPrevented) return { intercept: false, reason: 'prevented' };
  if (click.button !== 0 || click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) {
    return { intercept: false, reason: 'modifier' };
  }
  if (link.href === '') return { intercept: false, reason: 'no-href' };
  if (link.target !== null && link.target !== '' && link.target !== '_self') return { intercept: false, reason: 'target' };
  if (link.download) return { intercept: false, reason: 'download' };
  if (link.rel && link.rel.split(/\s+/).includes('external')) return { intercept: false, reason: 'rel-external' };
  if (link.reload) return { intercept: false, reason: 'reload-opt-out' };

  let url: URL;
  const current = new URL(currentHref);
  try {
    url = new URL(link.href, current);
  } catch {
    return { intercept: false, reason: 'no-href' };
  }
  if (url.origin !== current.origin) return { intercept: false, reason: 'other-origin' };
  // 같은 문서 안 해시 이동은 브라우저에 맡긴다.
  if (url.hash !== '' && url.pathname === current.pathname && url.search === current.search) {
    return { intercept: false, reason: 'hash-only' };
  }
  if (!hasRoute(url)) return { intercept: false, reason: 'no-route' };
  return { intercept: true, url };
}

const RELOAD_SELECTOR = '[data-eolgae-reload],[data-sveltekit-reload]';

/** DOM 앵커에서 LinkInfo 를 만든다. reload 속성은 조상까지 보고, 값이 "off" 면 opt-out 이 아니다(Kit 과 같음). */
export function linkInfoFromAnchor(a: HTMLAnchorElement): LinkInfo {
  const reloadHost = a.closest(RELOAD_SELECTOR);
  const reloadValue = reloadHost?.getAttribute('data-eolgae-reload') ?? reloadHost?.getAttribute('data-sveltekit-reload') ?? null;
  return {
    href: a.getAttribute('href') ?? '',
    target: a.getAttribute('target'),
    download: a.hasAttribute('download'),
    rel: a.getAttribute('rel'),
    reload: reloadHost !== null && reloadValue !== 'off',
  };
}

/** document 에 클릭 리스너를 걸어 내부 링크를 가로챈다. 해지 함수를 돌려준다. */
export function installLinkInterceptor(router: Router, doc: Document = document): () => void {
  const listener = (event: MouseEvent) => {
    const target = event.composedPath?.()[0] ?? event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const decision = decideIntercept(linkInfoFromAnchor(anchor), event, location.href, (url) => router.resolve(url).match !== null);
    if (!decision.intercept) return;
    event.preventDefault();
    void router.navigate(decision.url).catch((err) => {
      console.error(err);
    });
  };
  doc.addEventListener('click', listener);
  return () => doc.removeEventListener('click', listener);
}
