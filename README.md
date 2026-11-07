# eolgae

[![ci](https://github.com/CodedeugTeam/eolgae/actions/workflows/ci.yml/badge.svg)](https://github.com/CodedeugTeam/eolgae/actions/workflows/ci.yml)

지원 축: Vite 8 / vite-plugin-svelte 7(개발 기준)과 Vite 7 / vite-plugin-svelte 6(소비 앱 4개). CI가 PR·main push마다 두 축에서 빌드·테스트를 돌립니다.

SvelteKit 앱을 Vite + Svelte 5 정적 SPA로 옮길 때 쓰는 두 묶음을 한 패키지 `@codedeugteam/eolgae`로 제공합니다.

| 묶음 | import 경로 | 하는 일 |
|---|---|---|
| **entry** | `@codedeugteam/eolgae`, `@codedeugteam/eolgae/vite` | SvelteKit 대신 앱을 띄우는 공용 진입점: 라우터·`mount`·반응형 `page`·`goto`와, 결과물 규약(`build/`, `_app/immutable/`)을 지키는 Vite 플러그인, 앱이 복사해 소유하는 스캐폴드 3파일 |
| **harness** | `@codedeugteam/eolgae/harness`, CLI `eolgae-harness` | **옛 빌드와 새 빌드가 같은 화면·같은 요청을 내는지** 다섯 축(스크린샷·DOM·네트워크·콘솔·WebSocket)으로 비교하는 패리티 하니스. 바꾸는 코드보다 바꿨는지 확인하는 코드가 먼저라는 원칙으로, 전환 PR마다 보고서를 붙입니다 |

먼저 entry 를 설명하고, 「무엇을 비교하나」부터는 harness 설명입니다.

## entry: 공용 진입점

Vite + Svelte 5만으로 정적 SPA를 띄웁니다. SvelteKit의 `$app/navigation`·`$app/state`에서 앱들이 실제로 쓰던 것만 같은 이름으로 제공하고, 서버 렌더링·프리렌더·폼 액션은 다루지 않습니다. 설계 결정(순수 TS 패키지, `svelte` exports 조건, 링크 가로채기 기본 켬, `$lib` 기본 제공, 얕은 라우팅 의미)은 Vault 노트 `02. Projects/eolgae/entry/entry-설계.md`에 있습니다.

### 설치

`vite`·`svelte`·`@sveltejs/vite-plugin-svelte`는 peerDependencies이므로 앱에 이미 있는 것을 씁니다. 지원 범위는 vite `^7 || ^8`, svelte `^5.51`, vite-plugin-svelte `^6 || ^7` 입니다. 런타임 의존성은 추가되지 않습니다.

```sh
npm install --save-dev "@codedeugteam/eolgae@github:CodedeugTeam/eolgae#v0.2.0"
```

패키지 `exports["."]`에는 `svelte` 조건이 있어 vite-plugin-svelte가 이 패키지를 Svelte 라이브러리로 인식하고, 플러그인 `eolgae()`가 자기 패키지를 `optimizeDeps.exclude`에 넣습니다. 둘 다 `.svelte.ts` 안의 `$state`가 dev 에서 컴파일되지 않은 채 남는 일을 막기 위한 것입니다.

### 스캐폴드 3파일 복사

`template/` 의 세 파일을 앱 루트에 복사해 앱이 소유합니다. 상류(Vite·Svelte)에 닿는 코드는 패키지 안에만 있고, 이 세 파일은 앱 코드입니다.

| 파일 | 내용 |
|---|---|
| `index.html` | `<div id="app">` 와 `<script type="module" src="/src/main.ts">`. SvelteKit `app.html` 의 `%sveltekit.*%`·`data-sveltekit-*` 는 없습니다. `<head>` 링크(폰트·테마 css·manifest)는 여기로 옮깁니다 |
| `src/main.ts` | 라우트 표와 `mount(routes, document.getElementById('app')!, { layout })` |
| `vite.config.ts` | `svelte()` + `eolgae()`. 앱별 `server.proxy` 만 앱이 적습니다 |

`tsconfig.json` 에는 `.svelte-kit/tsconfig.json` extends 대신 아래를 인라인합니다.

```json
{
  "compilerOptions": {
    "paths": { "$lib": ["./src/lib"], "$lib/*": ["./src/lib/*"] },
    "lib": ["es2023", "dom", "dom.iterable"],
    "types": ["svelte", "vite/client"],
    "verbatimModuleSyntax": true
  }
}
```

### 라우트 표와 mount

```ts
// src/main.ts
import { mount, type RouteDefinition } from '@codedeugteam/eolgae';
import Layout from './Layout.svelte';
import Home from './routes/Home.svelte';
import Managed from './routes/Managed.svelte';
import NotFound from './routes/NotFound.svelte';

const routes: RouteDefinition[] = [
  { path: '/', component: Home },
  { path: '/managed', component: Managed },
  { path: '*', component: NotFound },        // 표에 없는 경로로 직접 진입했을 때만(서버가 index.html 로 폴백한 뒤) 보일 화면
];

mount(routes, document.getElementById('app')!, { layout: Layout });
```

- `path` 는 `/`, `/project/:id`, `*` 세 꼴입니다. 정적 세그먼트가 `:param` 보다 우선합니다. 끝의 `/` 는 무시합니다.
- `*` 폴백은 **직접 진입에만** 쓰입니다. 표에 없는 주소로 들어와 서버가 `index.html` 을 돌려준 뒤 첫 렌더에서 그립니다. `goto` 와 가로챈 링크에서는 `*` 만 걸리는 경로를 「라우트 없음」으로 보고 브라우저 전체 이동으로 넘깁니다(404 화면을 SPA 안에서 그리지 않습니다).
- `layout` 은 앱이 소유하는 Svelte 컴포넌트로 `{ Page, data, params }` prop 을 받아 `<Page {data} {params} />` 를 그립니다. 패키지는 레이아웃을 Svelte 5 `mount()` 로 한 번만 올리고 이동마다 `Page` prop 을 바꿉니다. `layout` 을 주지 않으면 페이지 컴포넌트를 target 에 바로 올립니다.
- 페이지 컴포넌트는 `{ data, params }` prop 을 받습니다(`PageProps`). 1차에서는 둘 다 각각 `undefined`·`{}` 입니다.
- `mount()` 는 `{ unmount(): Promise<void> }` 를 돌려줍니다.
- 첫 진입 경로가 표에 없고 `*` 도 없으면 콘솔에 에러를 내고 아무것도 그리지 않습니다. 앱은 `*` 를 두는 편이 안전합니다.
- 라우트·match 를 직접 다루는 API 는 공개하지 않습니다. 라우트 정보는 `page.route.id`·`page.params` 로 읽습니다.

```svelte
<!-- src/Layout.svelte -->
<script lang="ts">
  import { page, type LayoutProps } from '@codedeugteam/eolgae';
  let { Page, data, params }: LayoutProps = $props();
</script>

<nav><a href="/">홈</a> <a href="/managed">관리</a> <a href="/auth/logout" data-eolgae-reload>로그아웃</a></nav>
<p>{page.url.pathname}</p>
<Page {data} {params} />
```

### page 와 goto

```ts
import { page, goto } from '@codedeugteam/eolgae';

page.url;        // URL, 반응형. page.url.pathname 등을 템플릿에서 바로 읽는다
page.route.id;   // 매칭된 라우트 패턴('/managed'). 없으면 null
await goto('/managed');                        // pushState → 매칭 → page 갱신 → 컴포넌트 교체
await goto('/managed', { replaceState: true }); // replaceState 로
```

`goto` 는 라우트 표에 없는 경로(`*` 폴백만 걸리는 경로 포함)·다른 origin 이면 `location.href` 전체 이동으로 넘깁니다(404 화면을 그리지 않습니다). 서버 라우트(`/auth/*`, `/api`)가 섞인 앱에서 안전하도록 한 선택입니다. `javascript:`·`mailto:` 처럼 http(s) 가 아닌 주소는 에러를 던집니다.

**내부 링크 가로채기**는 기본으로 켜져 있습니다(`mount(..., { interceptLinks: false })` 로 끔). 문서 안 `<a href>` 클릭 가운데 아래는 가로채지 않고 브라우저에 맡깁니다.

- 다른 origin, `mailto:` 등 다른 스킴
- `target` 속성(`_self` 제외), `download` 속성, `rel="external"`
- `data-eolgae-reload`(정식) 또는 `data-sveltekit-reload`(전환기 인정) 가 앵커나 조상에 있을 때(값이 `off` 면 제외하지 않음)
- 라우트 표에 없는 경로(`*` 폴백만 걸리는 경로 포함), 같은 문서 안 해시 이동(`#section`, 빈 `#`), 보조 키(ctrl·meta·shift·alt)·가운데 버튼 클릭, 이미 `preventDefault` 된 클릭

뒤로가기·앞으로가기(`popstate`)도 같은 경로로 라우트를 바꿉니다. `browser` 가드는 제공하지 않습니다(정적 SPA 라 항상 브라우저).

### Vite 플러그인 eolgae()

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { eolgae } from '@codedeugteam/eolgae/vite';

export default defineConfig({
  plugins: [svelte(), eolgae()],
});
```

| 옵션 | 기본값 | 넣는 설정 |
|---|---|---|
| `outDir` | `'build'` | `build.outDir` |
| `assetsDir` | `'_app/immutable'` | `build.assetsDir` (해시 자산 폴더) |
| `publicDir` | `'static'` | `publicDir` (앱들이 `static/` 을 씁니다) |
| `lib` | `'src/lib'` | `resolve.alias['$lib']`. `false` 면 넣지 않음 |
| `version` | `process.env.APP_VERSION ?? 'dev'` | `define['import.meta.env.APP_VERSION']` (JSON 문자열) |
| `serviceWorker` | 없음(끔) | 서비스 워커 매니페스트. 아래 「서비스 워커」 절 |

표의 값은 기본값입니다. 앱 `vite.config.ts` 가 `build.outDir`·`build.assetsDir`·`publicDir` 를 직접 적었으면 그 값을 존중하고, 플러그인 옵션을 주면 옵션이 이깁니다. 그 외에 항상 `optimizeDeps.exclude: ['@codedeugteam/eolgae']` 를 넣습니다. 결과물은 `build/index.html` + `build/_app/immutable/<hash 자산>` + `static/` 복사본이며, Vite 기본 `dist/`·`assets/` 는 쓰지 않습니다. 모르는 경로를 `index.html` 로 폴백하는 일은 서빙 쪽(Go embed·nginx)이 하므로 `404.html` 을 만들지 않습니다.

### 서비스 워커

SvelteKit 의 `src/service-worker.ts` + `$service-worker` 를 대신합니다. `serviceWorker` 옵션을 주면 `vite build` 가 앱 빌드를 마친 뒤 서비스 워커를 한 번 더 빌드해 outDir 바로 아래 `service-worker.js` 로 냅니다. 서비스 워커 코드는 가상 모듈 `virtual:eolgae/service-worker` 에서 캐시할 목록과 버전을 가져옵니다. 옵션을 주지 않으면 아무 일도 하지 않습니다.

```ts
// vite.config.ts
export default defineConfig({
  plugins: [svelte(), eolgae({ serviceWorker: {} })],
});
```

| `serviceWorker` 옵션 | 기본값 | 뜻 |
|---|---|---|
| `src` | `'src/service-worker.ts'`(없으면 `.js`) | 서비스 워커 소스(root 기준) |
| `fileName` | `'service-worker.js'` | 출력 파일 이름(outDir 바로 아래, 폴더 없는 `.js`) |
| `files` | `.DS_Store` 제외 | `files` 목록 필터. 정적 파일 폴더 기준 `/` 구분 경로를 받아 `true` 면 넣는다 |

가상 모듈이 내보내는 값은 SvelteKit `$service-worker` 의 같은 이름과 뜻이 같습니다(`base`·`prerendered` 는 없습니다).

| 이름 | 빌드 | dev |
|---|---|---|
| `build: string[]` | 앱 빌드가 낸 해시 자산(JS·CSS·wasm 등, `/_app/immutable/...`). `index.html`·sourcemap 은 빠집니다 | `[]` |
| `files: string[]` | 정적 파일 폴더(`static/`)의 파일(`/robots.txt` 등) | 같음 |
| `version: string` | 플러그인 `version`(기본 `process.env.APP_VERSION ?? 'dev'`) | 같음 |

```ts
// src/service-worker.ts
/// <reference types="@codedeugteam/eolgae/service-worker" />
/// <reference lib="webworker" />
import { build, files, version } from 'virtual:eolgae/service-worker'; // 옛 코드: from '$service-worker'

const CACHE = `app-shell-${version}`;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...build, ...files, '/'])));
});
```

타입은 위처럼 소스 맨 위 `/// <reference types="@codedeugteam/eolgae/service-worker" />` 로 가져오거나 tsconfig `types` 에 `"@codedeugteam/eolgae/service-worker"` 를 넣습니다. `$service-worker` 별칭은 제공하지 않으므로 import 줄 하나를 바꿉니다. `$lib` 별칭과 앱 vite.config 의 `resolve.alias`·`define` 은 서비스 워커 빌드에도 들어갑니다. Svelte 등 다른 플러그인은 들어가지 않습니다(SvelteKit 과 같음).

**등록은 앱이 합니다.** 플러그인은 `index.html` 을 고치지 않습니다. SvelteKit 이 넣던 것과 같은 시점(`load` 이벤트)·같은 꼴(`type: 'module'`)로 앱 `index.html` 이나 `src/main.ts` 에 둡니다. 빌드 결과는 import 가 없는 한 파일이지만, 자산 주소를 `import.meta.url` 로 푸는 코드(wasm 등)가 있으면 모듈 워커여야 하고, dev 의 `service-worker.js` 는 소스를 `import` 하므로 모듈 워커로만 돕니다.

```ts
// src/main.ts (또는 index.html 의 <script>)
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
  });
}
```

동작 세부:

- 앱과 서비스 워커가 함께 쓰는 자산(예: `new URL('./x.wasm', import.meta.url)`)은 두 빌드에서 같은 이름 규칙(`assetsDir`·`assetFileNames`)으로 나와 **한 파일만** 남고, 그 파일이 `build` 목록에 들어 있어 오프라인에서도 캐시로 풀립니다.
- Vite 8 은 `service-worker.js` 를 바로 내고, Vite 7 은 SvelteKit 과 같게 `.mjs` 로 낸 뒤 이름을 바꿉니다. 결과물은 두 축에서 같은 꼴입니다.
- 서비스 워커는 `vite build` 의 앱 빌드(입력이 없거나 root `index.html` 하나)에서만 빌드합니다. dev·vitest, SSR·라이브러리 빌드, Storybook(`iframe.html` 입력) 빌드에서는 빌드하지 않습니다.
- dev 서버는 `/service-worker.js` 요청에 소스를 import 하는 한 줄(`import '/@fs/<절대 경로>/src/service-worker.ts';`)을 돌려주고, 가상 모듈은 `build: []` 를 냅니다. SvelteKit 2 dev 와 같은 동작이라 dev 에서도 등록·설치됩니다.
- 서비스 워커 안에서 가상 모듈 밖의 앱 전용 모듈(DOM 을 쓰는 코드 등)은 import 하지 않습니다. 가상 모듈을 서비스 워커가 아닌 앱 코드에서 import 하면 에러가 납니다.

### 1차 범위와 미구현

1차(termcast 전환)에 필요한 것만 동작합니다. 나머지는 타입과 자리를 두고 **호출하면 `NotImplementedError`** 를 던집니다.

| 동작 | 미구현(호출 시 에러) |
|---|---|
| `mount`, `{ path, component }`, 링크 가로채기, `goto`, `page.url`·`page.route`, 플러그인(outDir·assetsDir·publicDir·`$lib`·`APP_VERSION`·`serviceWorker`), 스캐폴드 3파일, `:param` 매칭과 `page.params` 채움 | `RouteDefinition.load` 와 `page.data`, `invalidateAll()`, `replaceState()` 와 `page.state`(얕은 라우팅), 지연 로드 `component: () => import(...)`, 스크롤 복원 |

### 개발용 fixture

`entry/fixtures/app/` 은 테스트가 `vite build`·`vite dev`·하니스 `static:` 으로 돌리는 최소 앱입니다. 패키지를 실제 설치처럼 `node_modules/@codedeugteam/eolgae` 로 소비하도록 테스트 helper 가 저장소 루트를 가리키는 심볼릭 링크를 만들고(`.gitignore` 에 있음) `resolve.preserveSymlinks` 로 경로를 node_modules 안에 둡니다. 직접 띄워 보려면:

```sh
npm run build
node -e "import('./entry/test/helpers/fixture.ts').then((m) => m.ensureFixtureLink())"
npx vite entry/fixtures/app          # dev
npx vite build entry/fixtures/app    # → entry/fixtures/app/build/
```

`entry/fixtures/sw-app/` 은 `serviceWorker` 옵션을 켠 최소 앱입니다(Svelte 없음). 앱과 서비스 워커가 같은 wasm 을 가져오고, 테스트가 빌드 결과(wasm 한 벌·`build`·`files`·`version`)·dev 서버·Chromium(등록·오프라인 새로고침·대기 워커 → `SKIP_WAITING`)을 봅니다. `npx vite build entry/fixtures/sw-app` 으로 직접 빌드할 수 있습니다.

## harness: 패리티 하니스

같은 시나리오를 옛 빌드와 새 빌드에서 돌려 결과를 비교합니다. 아래 절은 모두 harness 설명입니다.

## 무엇을 비교하나

같은 시나리오를 old 대상과 new 대상에서 한 번씩(같은 순서, 대상마다 새 BrowserContext) 돌리고, `run`이 끝난 시점의 상태를 네 축으로 비교합니다.

| 축 | 수집 | 비교 |
|---|---|---|
| 스크린샷 | `page.screenshot` | pixelmatch. 시나리오별 `threshold`(기본 0.1)·`maxDiffPixelRatio`(기본 0). 크기가 다르면 차이. `screenshots/<scenario>/{old,new,diff}.png` (diff는 차이가 있을 때만) |
| DOM | `document.documentElement.outerHTML`. 시나리오 `dom.root`(CSS selector)가 있으면 그 요소의 outerHTML 만, `dom.title`이면 `document.title`을 `<title>`로 앞에 붙임 | 정규화 뒤 문자열 비교. 다르면 첫 차이 지점 앞뒤를 보고서에 발췌. 정규화한 전체는 `dom/<scenario>.{old,new}.html` |
| 네트워크 | `page.on('request'/'response')` | 문서 요청·`/_app/` 자산·favicon을 뺀 **모든 요청**의 `(method, path+query, status)` 순서 비교. 시나리오 `network.apiOnly: true`면 `--api-prefix` 요청만(v0.1.0 동작). 원본은 `network/<scenario>.{old,new}.json` |
| 콘솔 | `console` error 레벨·`pageerror` | 두 대상 모두 0건이어야 같음. 모든 메시지 목록을 보고서에 적음 |
| WebSocket | `page.on('websocket')` 연결·프레임(sent/received)·종료·오류 | 연결 순서열(path+query·종료 여부)과 프레임 순서열 `(연결 순번, 방향, 메시지 종류[, 페이로드])` 비교. 옵션과 규칙은 아래 [WebSocket 축](#websocket-축) 참조. 원본은 `network/<scenario>.{old,new}.json`의 `ws` |

DOM 정규화 규칙은 빌드마다 바뀌는 값만 지웁니다.

- `src`·`href` 속성과 `import()` 경로의 `./`·`../` 접두어 → `/` (adapter-node는 라우트 깊이에 따른 상대 경로, adapter-static은 루트 기준 경로를 내므로 먼저 통일)
- `/_app/immutable/<...>.<hash>.<ext>` 의 해시 조각 → `HASH` (`<script>`·`<link>`의 `/_app/` 참조 포함)
- `class` 속성 안 `svelte-[a-z0-9]+` → `svelte-HASH`
- `data-sveltekit-*` 속성 제거
- 인라인 부트스트랩의 `__sveltekit_<hash>` 전역 → `__sveltekit_HASH`, `base: new URL("..", location).pathname.slice(0, -1)` 계산식 → `base: ""`
- 연속 공백 → 한 칸

정규화로 지워지지 않는 서빙 차이도 있습니다. adapter-node 셸은 라우트별 `<link rel="stylesheet">`를, adapter-static 셸은 `modulepreload` 목록을 `<head>`에 넣고, 이름이 해시만인 chunk(`/_app/immutable/chunks/<hash>.js`)는 빌드마다 다릅니다. 이런 앱은 시나리오에 `dom: { root: 'main', title: true }`처럼 범위를 주어 `<head>`와 인라인 부트를 비교 밖에 둡니다.

### WebSocket 축

`run`이 끝날 때까지 페이지가 연 WebSocket을 모두 수집해 두 대상에서 비교합니다. 프록시 포트가 대상마다 다르므로 연결 URL은 호스트·포트를 빼고 **path+query**만 봅니다.

비교 단위는 두 순서열입니다. 연결 순서열이 같아야 하고, 그다음 프레임 순서열이 같아야 같음입니다. 어느 쪽이든 처음 어긋난 위치와 양쪽 값을 보고서에 적습니다.

| 순서열 | 항목 | 비교하는 값 |
|---|---|---|
| 연결 | 열린 순서대로 | `path(+query)`, 종료 여부(`run` 끝에 닫혔는지), 오류 수. 연결·종료 횟수는 이 순서열 길이로 비교됩니다 |
| 프레임 | 보낸·받은 순서대로 | 연결 순번, 방향(`→` sent / `←` received), 메시지 종류, (옵션) 정규화한 페이로드 |

비교는 원문으로 하지만 **보고서에는 원문을 싣지 않습니다.** `report.json`·`report.md`의 프레임은 종류·바이트 수·sha256 앞 12자만, 연결 path의 쿼리 값은 `key=***`로 적습니다(`--header` 값 마스킹과 같은 기준). 원문은 `network/<scenario>.{old,new}.json`의 `ws`에만 남습니다.

메시지 종류는 본문이 JSON 객체면 `messageKey`(기본 `type`) 값이고, 그 키가 없거나 JSON이 아니면 본문 앞 32자, 바이너리 프레임이면 `binary:<바이트 수>`입니다. 페이로드 정규화는 JSON이면 키를 정렬하고 공백을 지운 전문, 그 밖은 원문, 바이너리는 base64입니다.

시나리오별 옵션은 모두 선택이며 기본값이 있습니다.

```ts
websocket?: {
  ignoreQuery?: boolean;   // 연결 URL 비교에서 쿼리를 뗀다(토큰·세션 ID가 쿼리에 있을 때). 기본 false
  messageKey?: string;     // JSON 메시지의 종류를 읽을 키. 기본 'type'
  ignorePayload?: boolean; // 종류만 비교하고 페이로드 전문은 보지 않는다(타임스탬프·ID가 본문에 섞일 때). 기본 false
  timeoutMs?: number;      // run 이 끝난 뒤 열린 소켓이 있으면 이만큼 프레임을 더 모은다. 기본 1000
}
```

보고서에는 다섯째 열로 `✅ 같음 (연결 1/1, 프레임 12/12)` 꼴로 찍히고, 다르면 차이 상세에 처음 어긋난 곳과 그 앞뒤 10행 표가 붙습니다. `report.json`의 `scenarios[].ws`에 연결·프레임 요약 전체, `summary.axes.websocket`에 차이 난 시나리오 수가 들어갑니다. WebSocket 차이도 종료 코드 1입니다.

알아 둘 한계가 있습니다.

- 프레임은 Playwright가 보는 순서입니다. `open` 핸들러에서 동기로 `send`한 프레임은 서버가 먼저 보낸 메시지보다 앞에 기록됩니다(두 대상이 같은 코드를 돌리면 같은 순서가 나옵니다).
- 프록시는 Upgrade 요청을 TCP 터널로 잇고 `--header`를 Upgrade 요청에도 넣습니다. 업스트림이 `https:`면 TLS로 감싸 잇습니다. 브라우저와 프록시 사이는 항상 평문 `ws:`입니다.
- 조각 프레임·압축 확장은 Playwright가 합쳐 준 결과를 그대로 씁니다. 재연결은 새 연결로 세어져 연결 순서열에서 드러납니다.
- 주기 push(heartbeat)가 있는 장수명 소켓은 `timeoutMs` 창 안에 몇 프레임이 들어오는지가 실행마다 흔들릴 수 있습니다. 그런 시나리오는 `run` 안에서 소켓을 닫거나(페이지 이동·로그아웃 등), `ignorePayload`와 함께 시나리오를 짧게 고정해 프레임 수를 결정적으로 만듭니다.
- `https:` 업스트림이 자체 서명 인증서면 Node 기본 검증에 걸려 터널이 끊깁니다. 이때는 사용자가 하니스 프로세스에 `NODE_TLS_REJECT_UNAUTHORIZED=0`을 직접 주어야 합니다(하니스가 대신 끄지 않습니다).

## 설치

GitHub 의존성으로 설치합니다. 설치 때 `prepare` 스크립트가 `tsc` 빌드를 돌리므로 `dist/`는 커밋하지 않습니다.

```sh
npm install --save-dev "@codedeugteam/eolgae@github:CodedeugTeam/eolgae#v0.2.0"
npx playwright install chromium   # 앱에 chromium 이 아직 없을 때만
```

요구 사항은 Node 24 이상(시나리오 `.ts` 파일을 네이티브 TS 로딩으로 바로 import 합니다)과 chromium입니다.
의존성은 `playwright`, `pixelmatch`, `pngjs` 셋이고 빌드에만 `typescript`를 씁니다. 다른 프레임워크·CLI 라이브러리·테스트 러너는 넣지 않습니다.

설치 때 알아 둘 점이 둘 있습니다.

- 앱 `package.json`에 `"type": "module"`이 있어야 시나리오 `.ts` 파일이 ESM으로 읽힙니다. SvelteKit 앱은 기본으로 들어 있습니다. 없으면 `import` 문에서 `Cannot use import statement outside a module` 오류가 납니다.
- npm 11.19 이상은 git 의존성의 `prepare` 스크립트를 두고 `install scripts not yet covered by allowScripts` 경고를 냅니다. 빌드는 그래도 실행되며(`dist/`가 생깁니다), 경고를 없애려면 `npm install-scripts approve @codedeugteam/eolgae`를 한 번 실행합니다.

## 실행

```sh
eolgae-harness run \
  --old <target> --new <target> \
  --backend <url> \
  --scenarios <glob 또는 파일> [--scenarios ...] \
  --out <dir> \
  [--header k=v ...] [--api-prefix /api] [--viewport 1280x720] [--quiet]
```

`target`은 두 형식입니다.

- `static:<build 폴더>` 하니스 내장 정적 서버로 서빙합니다. 파일이 있으면 그대로, 알 수 없는 경로는 `index.html`로 폴백(SPA), `/_app/` 아래에서 없는 파일은 404입니다.
- `url:<http://host:port>` 이미 떠 있는 서버를 그대로 씁니다.

**모든 target 앞에 하니스 프록시가 섭니다.** 프록시는 `--api-prefix`(기본 `/api`)로 시작하는 요청을 `--backend`로, 나머지를 target으로 넘기고, `--header k=v`를 두 방향 요청 모두에 넣습니다. Traefik forward-auth가 넣어 주는 `x-forwarded-user` 같은 헤더를 흉내 내는 용도입니다. 브라우저는 프록시 포트만 봅니다. 포트는 OS가 배정합니다.

종료 코드는 셋입니다.

| 코드 | 뜻 |
|---|---|
| 0 | 모든 축(스크린샷·DOM·네트워크·콘솔·WebSocket) 차이 없음 |
| 1 | 차이가 하나라도 있음 |
| 2 | 실행 오류(시나리오 예외·대상 기동 실패·인자 오류) |

`--out` 아래에 `report.json`(구조화)과 `report.md`(시나리오×축 표, 차이 상세, 콘솔 목록, 파일 경로)가 생깁니다. `--header`로 넣은 값은 인증 토큰일 수 있어 보고서에는 키만 남고 값은 `***`로 가려집니다.

### 예시: gatekeeper dashboard 옛 빌드(adapter-node) vs 새 빌드(adapter-static)

옛 빌드는 Node 서버(포트 3000, `/api` 프록시 없음), 새 빌드는 nginx(포트 80)로 각각 띄워 둔 상태입니다.
백엔드는 gatekeeper의 오프라인 E2E 스텁 서버(포트 4000이라 가정)이고, 인증은 `x-forwarded-user: e2e-reviewer` 헤더로 흉내 냅니다.

```sh
eolgae-harness run \
  --old url:http://127.0.0.1:3000 \
  --new url:http://127.0.0.1:8080 \
  --backend http://127.0.0.1:4000 \
  --header x-forwarded-user=e2e-reviewer \
  --scenarios "dashboard/harness/*.spec.ts" \
  --out harness-out
```

두 대상 모두 `url:`이므로 하니스는 서버를 띄우지 않고, 각 앞에 프록시만 세워 `/api/*`를 스텁 서버로 보내고 헤더를 넣습니다.
새 빌드를 컨테이너 없이 보려면 `--new static:dashboard/build`처럼 빌드 폴더를 바로 넣어도 됩니다.

### 예시: 저장소 안 fixture로 자기 대조

fixture SPA는 `/api/hello`를 한 번 부르므로 백엔드가 있어야 합니다. 백엔드가 없으면 fetch 실패가 양쪽 콘솔 에러로 잡혀 콘솔 축 차이로 종료 1이 납니다. 테스트가 쓰는 echo 서버를 별도 터미널에 띄워 두고 돌립니다.

```sh
# 터미널 1: echo 백엔드(받은 요청과 x-forwarded-user 를 JSON 으로 돌려준다). 포트는 출력에 찍힌다.
node -e "import('./harness/test/helpers/echo-server.ts').then(async (m) => { const s = await m.startEchoServer(); console.log(s.url); })"

# 터미널 2: 위에 찍힌 주소를 --backend 에 넣는다.
npm run fixtures:changed      # harness/fixtures/spa-changed 생성(글자 하나·해시 다름)
node harness/src/cli.ts run \
  --old static:harness/fixtures/spa --new static:harness/fixtures/spa-changed \
  --backend http://127.0.0.1:<echo 포트> --header x-forwarded-user=e2e-reviewer \
  --scenarios harness/fixtures/spa.spec.ts --out harness-out
```

같은 폴더를 old/new로 넣으면 종료 0, `spa-changed`를 new로 넣으면 DOM 축(글자)과 스크린샷 축이 다름으로 잡혀 종료 1입니다.
해시가 달라진 자산 이름은 정규화로 지워지고 `/_app/` 요청은 네트워크 축에서 제외되므로, 네트워크 축은 같음으로 나옵니다.

## 시나리오 작성

앱 저장소의 `harness/*.spec.ts`에 씁니다. default export는 `defineScenarios([...])` 결과여야 하고, 시나리오는 Playwright `page` API만 씁니다.

```ts
// harness/dashboard.spec.ts
import { defineScenarios } from '@codedeugteam/eolgae/harness';

export default defineScenarios([
  {
    name: 'runs-list',
    async run(page, ctx) {
      await page.goto('/runs?status=failed');          // ctx.baseURL 이 프록시라 상대 경로로 간다
      await page.waitForSelector('[data-testid="runs-table"]');
    },
    screenshot: { threshold: 0.1, maxDiffPixelRatio: 0 }, // false 면 스크린샷 축 생략
  },
  {
    name: 'rerun-then-reload',
    async run(page) {
      await page.goto('/runs/1');
      await page.getByRole('button', { name: '재실행' }).click();
      await page.waitForResponse((r) => r.url().includes('/api/runs/1'));
    },
    headers: { 'x-harness-case': 'rerun' },             // 이 시나리오의 BrowserContext 에만 더해지는 요청 헤더
    network: { apiOnly: true },                          // 이 시나리오만 /api 요청으로 네트워크 축을 좁힌다
  },
  {
    name: 'settings',
    async run(page) {
      await page.goto('/settings');
      await page.locator('html[data-hydrated="true"]').waitFor();
    },
    dom: { root: 'main', title: true },                  // <head>·인라인 부트는 빼고 <main> 과 <title> 만 비교
  },
]);
```

계약은 다음과 같습니다.

```ts
interface ScenarioContext { baseURL: string; backendURL: string; label: 'old' | 'new' }
interface Scenario {
  name: string;
  run(page: import('playwright').Page, ctx: ScenarioContext): Promise<void>;
  screenshot?: { threshold?: number; maxDiffPixelRatio?: number; fullPage?: boolean } | false;
  headers?: Record<string, string>;
  dom?: { root?: string; title?: boolean };            // root: 이 selector 의 첫 요소만 비교(없으면 실행 오류). title: document.title 도 비교
  network?: { apiOnly?: boolean };                     // true 면 --api-prefix 요청만(v0.1.0 동작)
  websocket?: { ignoreQuery?: boolean; messageKey?: string; ignorePayload?: boolean; timeoutMs?: number };
}
function defineScenarios(list: Scenario[]): Scenario[]
```

`dom.root`에 맞는 요소가 없으면 빈 문자열로 비교하지 않고 그 시나리오를 실행 오류(종료 2)로 보고합니다.

`run`이 끝난 뒤 진행 중인 요청이 끝나길 최대 3초 기다리고, 열린 WebSocket이 있으면 `websocket.timeoutMs`(기본 1초)만큼 더 기다린 다음 수집합니다. 비동기 렌더가 있으면 `run` 안에서 `waitForSelector` 등으로 상태를 고정해 두는 편이 안전합니다.

## 개발

```sh
npm ci
npm run build      # tsc → dist/
npm test           # node:test (harness: 정규화·비교·보고서·정적 서버·프록시·자기 대조 e2e / entry: 라우터·링크 규칙·플러그인·fixture 빌드·dev·스모크)
```

Vite 7 / vite-plugin-svelte 6 축(소비 앱이 쓰는 조합)으로도 같은 테스트를 돌립니다. 설치된 `vite`·플러그인만 바꾸고(`--no-save`) `package.json`·lock은 그대로입니다. 끝나면 `npm ci`로 되돌립니다.

```sh
npm run test:vite7   # vite@7.3.1 + @sveltejs/vite-plugin-svelte@6.2.4 로 교체 → build → test
npm ci               # 기본 축(Vite 8)으로 복원
```

CI(`.github/workflows/ci.yml`)는 PR·main push마다 ubuntu 러너에서 `test (vite8)`·`test (vite7)` 두 job으로 같은 순서(npm ci → 교체 → playwright chromium 설치 → build → test)를 돌립니다.

구성은 두 묶음입니다.

- entry: `entry/src/`(소스, `.ts`·`.svelte.ts`만), `entry/test/`(node:test. 라우터·링크 규칙·플러그인 단위 테스트와 fixture 빌드·dev·하니스 스모크), `entry/fixtures/app/`(fixture 앱), `template/`(스캐폴드). 빌드는 `tsconfig.entry.json` → `dist/entry/`
- harness: `harness/src/`(소스), `harness/test/`(테스트), `harness/fixtures/`(테스트용 최소 SPA와 시나리오). 빌드는 `tsconfig.json` → `dist/`

## 라이선스

MIT
