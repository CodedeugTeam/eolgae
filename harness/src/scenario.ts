// 시나리오 계약. 앱 저장소의 harness/*.spec.ts 가 이 타입과 defineScenarios 만 쓴다.
import type { Page } from 'playwright';
import type { WebSocketOptions } from './ws.ts';

export type { WebSocketOptions };

/** 시나리오가 실행되는 대상 정보. baseURL 은 하니스 프록시 주소다(브라우저는 이 포트만 본다). */
export interface ScenarioContext {
  baseURL: string;
  backendURL: string;
  label: 'old' | 'new';
}

/** 스크린샷 축 옵션. false 를 주면 그 시나리오는 스크린샷을 비교하지 않는다. */
export interface ScreenshotOptions {
  /** pixelmatch 색 차이 허용치(0~1). 기본 0.1 */
  threshold?: number;
  /** 전체 픽셀 대비 다른 픽셀 비율 허용치(0~1). 기본 0 */
  maxDiffPixelRatio?: number;
  /** 뷰포트 대신 문서 전체를 찍는다. 기본 false */
  fullPage?: boolean;
}

/** DOM 축 옵션. 비교 범위를 좁힌다. 없으면 문서 전체(document.documentElement.outerHTML)를 비교한다. */
export interface DomOptions {
  /**
   * 이 CSS selector 에 맞는 첫 요소의 outerHTML 만 비교한다. 서빙 방식에 따라 달라지는 `<head>` 와
   * 인라인 부트 스크립트를 범위 밖에 두는 용도다(예: 'main'). 요소가 없으면 그 시나리오는 실행 오류다.
   */
  root?: string;
  /** true 면 document.title 을 `<title>` 로 앞에 붙여 함께 비교한다. root 로 `<head>` 가 빠질 때 쓴다. 기본 false */
  title?: boolean;
}

/** 네트워크 축 옵션 */
export interface NetworkOptions {
  /**
   * true 면 `--api-prefix` 로 시작하는 요청만 비교한다(v0.1.0 동작).
   * 기본 false: 문서 요청·`/_app/` 자산·favicon 을 뺀 모든 요청을 (method, path+query, status) 순서로 비교한다.
   */
  apiOnly?: boolean;
  /**
   * true 면 서비스 워커가 보낸 요청(스크립트 요청, install 의 cache.addAll, fetch 핸들러의 fetch 등)도 수집해
   * 페이지 요청 순서 비교와 함께 두 대상의 집합(순서 무시, 중복은 개수까지)으로 비교한다. 제외 규칙과 apiOnly 는 같게 적용한다.
   * 서비스 워커 요청도 run 뒤 진행 중 요청 대기에 들어간다. install 이 끝나기 전에 run 이 끝나지 않게
   * run 안에서 `navigator.serviceWorker.ready` 등을 기다려 둔다. 기본 false(서비스 워커 요청은 수집하지 않는다)
   */
  serviceWorker?: boolean;
}

export interface Scenario {
  /** 보고서와 파일 이름에 쓰이는 이름. 시나리오 파일 안에서 고유해야 한다. */
  name: string;
  /** Playwright page API 만 써서 화면을 원하는 상태까지 끌고 간다. run 이 끝난 시점의 상태를 수집한다. */
  run(page: Page, ctx: ScenarioContext): Promise<void>;
  screenshot?: ScreenshotOptions | false;
  /** 이 시나리오를 돌릴 BrowserContext 에 더해지는 요청 헤더 */
  headers?: Record<string, string>;
  dom?: DomOptions;
  network?: NetworkOptions;
  /**
   * WebSocket 축 옵션. 생략하면 기본값(ignoreQuery false, messageKey 'type', ignorePayload false, timeoutMs 1000)으로 비교한다.
   * run 이 끝난 뒤 열린 소켓이 있으면 timeoutMs 만큼 프레임을 더 모은 다음 수집한다.
   */
  websocket?: WebSocketOptions;
}

/** 시나리오 목록을 검증해 돌려준다. 시나리오 파일의 default export 는 이 함수의 결과여야 한다. */
export function defineScenarios(list: Scenario[]): Scenario[] {
  if (!Array.isArray(list)) {
    throw new TypeError('defineScenarios 에는 시나리오 배열을 넘겨야 합니다');
  }
  const seen = new Set<string>();
  for (const [i, s] of list.entries()) {
    if (!s || typeof s.name !== 'string' || s.name.trim() === '') {
      throw new TypeError(`시나리오 ${i} 번째에 name 이 없습니다`);
    }
    if (typeof s.run !== 'function') {
      throw new TypeError(`시나리오 "${s.name}" 에 run 함수가 없습니다`);
    }
    if (seen.has(s.name)) {
      throw new TypeError(`시나리오 이름 "${s.name}" 이 중복됩니다`);
    }
    seen.add(s.name);
  }
  return list;
}

/** 시나리오 이름을 파일·폴더 이름으로 쓸 수 있게 바꾼다. */
export function scenarioSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'scenario' : slug;
}
