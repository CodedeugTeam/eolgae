# eolgae

SvelteKit 앱을 정적 SPA로 옮길 때, **옛 빌드와 새 빌드가 같은 화면·같은 요청을 내는지** 확인하는 패리티 하니스입니다.
바꾸는 코드보다 바꿨는지 확인하는 코드가 먼저라는 원칙으로, 전환 PR마다 이 하니스의 보고서를 붙입니다.

지금 저장소에는 `harness/` 패키지만 있습니다. 공용 진입점(entry) 패키지는 다음 단계에서 추가됩니다.

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
npm install --save-dev "@codedeugteam/eolgae@github:CodedeugTeam/eolgae#v0.1.1"
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
npm test           # node:test (정규화·비교·보고서·정적 서버·프록시·자기 대조 e2e)
```

구성은 `harness/src/`(소스), `harness/test/`(테스트), `harness/fixtures/`(테스트용 최소 SPA와 시나리오)입니다.

## 라이선스

MIT
