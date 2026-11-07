// 시나리오 계약. 앱 저장소의 harness/*.spec.ts 가 이 타입과 defineScenarios 만 쓴다.
import type { Page } from 'playwright';

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

export interface Scenario {
  /** 보고서와 파일 이름에 쓰이는 이름. 시나리오 파일 안에서 고유해야 한다. */
  name: string;
  /** Playwright page API 만 써서 화면을 원하는 상태까지 끌고 간다. run 이 끝난 시점의 상태를 수집한다. */
  run(page: Page, ctx: ScenarioContext): Promise<void>;
  screenshot?: ScreenshotOptions | false;
  /** 이 시나리오를 돌릴 BrowserContext 에 더해지는 요청 헤더 */
  headers?: Record<string, string>;
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
