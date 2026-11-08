// mount(routes, target, options): 앱 레이아웃을 Svelte 5 mount() 로 한 번 올리고, 라우터가 이동을 끝낼 때마다
// 페이지 컴포넌트·data·params 를 $state prop 으로 교체한다(D-1). 레이아웃이 없으면 페이지를 target 에 직접 올린다.
import { mount as svelteMount, unmount as svelteUnmount, type Component } from 'svelte';
import type { MountOptions, PageProps, RouteDefinition } from './types.ts';
import { browserEnv, createRouter, type Resolved } from './router.ts';
import { installLinkInterceptor, setActiveRouter } from './navigation.ts';
import { setPage } from './page.svelte.ts';
import { createLayoutProps, createPageProps } from './outlet.svelte.ts';

export interface Mounted {
  /** 라우터·링크 가로채기를 멈추고 컴포넌트를 내린다. */
  unmount(): Promise<void>;
}

export function mount(routes: RouteDefinition[], target: Element, opts: MountOptions = {}): Mounted {
  if (!(target instanceof Element)) {
    throw new Error('[eolgae] mount 의 target 이 Element 가 아닙니다. index.html 의 <div id="app"> 를 확인하세요.');
  }
  const { layout, interceptLinks = true, error } = opts;

  // 레이아웃이 있으면 한 번만 올리고 Page prop 을 바꾼다. 없으면 페이지 컴포넌트를 갈아 끼운다.
  let layoutProps: ReturnType<typeof createLayoutProps> | null = null;
  let instance: Record<string, unknown> | null = null;
  let pageProps: PageProps | null = null;
  let currentComponent: Component<PageProps> | null = null;

  const render = (r: Resolved) => {
    setPage({ url: r.url, params: r.match.params, state: r.state, data: r.data, route: { id: r.match.id }, status: r.status, error: r.error });
    if (layout) {
      if (!layoutProps) {
        layoutProps = createLayoutProps({ Page: r.component, data: r.data, params: r.match.params });
        instance = svelteMount(layout, { target, props: layoutProps });
      } else {
        layoutProps.Page = r.component;
        layoutProps.data = r.data;
        layoutProps.params = r.match.params;
      }
      return;
    }
    if (instance && currentComponent === r.component && pageProps) {
      pageProps.data = r.data;
      pageProps.params = r.match.params;
      return;
    }
    if (instance) void svelteUnmount(instance, { outro: false });
    pageProps = createPageProps({ data: r.data, params: r.match.params });
    currentComponent = r.component;
    instance = svelteMount(r.component, { target, props: pageProps });
  };

  const router = createRouter(routes, browserEnv(), render, { error });
  setActiveRouter(router);
  const uninstall = interceptLinks ? installLinkInterceptor(router) : () => {};

  // 첫 렌더. 실패(라우트 표에 없는 경로 등)는 비동기로 던져 콘솔에 보이게 한다.
  void router.start().catch((err) => {
    console.error(err);
  });

  return {
    async unmount() {
      uninstall();
      router.stop();
      setActiveRouter(null);
      if (instance) await svelteUnmount(instance, { outro: false });
      instance = null;
      layoutProps = null;
      pageProps = null;
      currentComponent = null;
    },
  };
}
