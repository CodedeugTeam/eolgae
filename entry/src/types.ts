// 공개 타입. 설계 노트(entry-설계 3.2)의 인터페이스를 그대로 옮긴다.
import type { Component } from 'svelte';

/** `RouteDefinition.load` 가 받는 인자. 1차에서는 타입만 두고 load 호출은 미구현이다. */
export interface LoadEvent {
  fetch: typeof fetch;
  params: Record<string, string>;
  url: URL;
}

/** 페이지 컴포넌트가 받는 prop. */
export interface PageProps<Data = unknown> {
  data: Data;
  params: Record<string, string>;
}

/** 라우트 표의 한 줄. `path` 는 `/`, `/project/:id`, `*`(폴백) 세 꼴을 받는다. */
export interface RouteDefinition<Data = unknown> {
  path: string;
  /** 페이지 컴포넌트. 지연 로드 함수 꼴은 타입만 두고 1차에서는 호출 시 미구현 에러를 던진다. */
  component: Component<PageProps<Data>> | (() => Promise<{ default: Component<PageProps<Data>> }>);
  /** 라우트 데이터 로더. 1차에서는 정의만 받고 실행은 미구현 에러를 던진다. */
  load?: (e: LoadEvent) => Data | Promise<Data>;
}

/** `page` 반응형 객체의 모양. `$app/state` 의 `page` 와 같은 필드를 둔다. */
export interface Page {
  url: URL;
  params: Record<string, string>;
  state: Record<string, unknown>;
  data: unknown;
  route: { id: string | null };
}

/** 앱이 소유하는 레이아웃 컴포넌트가 받는 prop. `<Page {data} {params} />` 로 렌더한다. */
export interface LayoutProps {
  Page: Component<PageProps>;
  data: unknown;
  params: Record<string, string>;
}

export interface MountOptions {
  layout?: Component<LayoutProps>;
  /** 내부 `<a href>` 클릭을 가로채 SPA 이동으로 바꾼다. 기본 true (D-3). */
  interceptLinks?: boolean;
}

export interface GotoOptions {
  replaceState?: boolean;
  state?: unknown;
}

/** 서비스 워커 매니페스트 옵션(entry-설계 3.6). 1차는 타입만 두고 roomcast 전환 티켓에서 채운다. */
export interface ServiceWorkerOptions {
  /** 서비스 워커 소스 경로. 기본 `src/service-worker.ts` 예정 */
  src?: string;
  /** 출력 파일명. 기본 `service-worker.js` 예정 */
  fileName?: string;
}
