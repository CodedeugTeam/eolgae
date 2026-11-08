// 공개 타입. 설계 노트(entry-설계 3.2)의 인터페이스를 그대로 옮긴다.
import type { Component } from 'svelte';
import type { PageError } from './errors.ts';

/** `RouteDefinition.load` 가 받는 인자. `fetch` 는 전역 fetch 이며 상대 URL 은 문서 주소 기준으로 풀린다. */
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
  /**
   * 라우트 데이터 로더. 이동할 때마다 실행해 끝난 뒤에 주소를 기록하고 화면을 바꾸며, 반환값이 `data` prop 이자
   * `page.data` 가 된다. 던지면 `mount` 옵션 `error` 화면을 그린다(`error(status, message)` 는 그 status, 그 밖은 500).
   */
  load?: (e: LoadEvent) => Data | Promise<Data>;
}

/** `page` 반응형 객체의 모양. `$app/state` 의 `page` 와 같은 필드를 둔다. */
export interface Page {
  url: URL;
  params: Record<string, string>;
  state: Record<string, unknown>;
  data: unknown;
  route: { id: string | null };
  /** HTTP 상태. 정상이면 200, load 가 던지면 그 상태(일반 오류는 500). */
  status: number;
  /** load 오류. 정상이면 null. */
  error: PageError | null;
}

/** 앱이 소유하는 레이아웃 컴포넌트가 받는 prop. `<Page {data} {params} />` 로 렌더한다. */
export interface LayoutProps {
  Page: Component<PageProps>;
  data: unknown;
  params: Record<string, string>;
}

export interface MountOptions {
  layout?: Component<LayoutProps>;
  /**
   * load 가 던졌을 때 레이아웃 안 `Page` 자리에 그릴 오류 화면. `page.status`·`page.error` 를 읽는다.
   * SvelteKit 기본 오류 화면과 같게 하려면 `<h1>{page.status}</h1>\n<p>{page.error?.message}</p>` 를 그린다.
   * 주지 않으면 load 오류는 그대로 던져진다(goto 는 reject, 주소·화면은 그대로).
   */
  error?: Component<PageProps>;
  /** 내부 `<a href>` 클릭을 가로채 SPA 이동으로 바꾼다. 기본 true (D-3). */
  interceptLinks?: boolean;
}

export interface GotoOptions {
  replaceState?: boolean;
  state?: unknown;
}

/**
 * 서비스 워커 매니페스트 옵션(entry-설계 3.6). 켜면 `vite build` 가 서비스 워커를 함께 빌드하고,
 * 서비스 워커 코드는 가상 모듈 `virtual:eolgae/service-worker` 에서 `build`·`files`·`version` 을 가져온다.
 */
export interface ServiceWorkerOptions {
  /** 서비스 워커 소스 경로(root 기준). 기본 `src/service-worker.ts`(없으면 `src/service-worker.js`) */
  src?: string;
  /** 출력 파일명(outDir 바로 아래). 기본 `service-worker.js` */
  fileName?: string;
  /** `files` 목록에 넣을 정적 파일 필터. publicDir 기준 `/` 구분 상대 경로를 받는다. 기본 `.DS_Store` 제외 */
  files?: (file: string) => boolean;
}
