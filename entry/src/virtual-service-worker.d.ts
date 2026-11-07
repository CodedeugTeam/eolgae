// 가상 모듈 `virtual:eolgae/service-worker` 의 타입. 패키지 `@codedeugteam/eolgae/service-worker` 로 노출한다.
// 서비스 워커 소스 맨 위에 `/// <reference types="@codedeugteam/eolgae/service-worker" />` 를 두거나 tsconfig `types` 에 넣는다.
declare module 'virtual:eolgae/service-worker' {
  /** 메인 빌드가 낸 해시 자산(JS·CSS·wasm 등) 경로. `index.html`·sourcemap 은 들어가지 않는다. dev 에서는 빈 배열. */
  export const build: string[];
  /** 정적 파일 폴더(publicDir) 의 파일 경로. 기본으로 `.DS_Store` 는 빠진다. */
  export const files: string[];
  /** 플러그인 `version` 옵션 값(기본 `process.env.APP_VERSION ?? 'dev'`). 캐시 이름에 쓴다. */
  export const version: string;
}
