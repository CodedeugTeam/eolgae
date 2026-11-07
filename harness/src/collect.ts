// 한 대상에서 시나리오 하나를 돌리고 네 축 원본(스크린샷·DOM·네트워크·콘솔)과 WebSocket 이벤트를 모은다.
import type { Browser, Page, Request as PwRequest, Response as PwResponse } from 'playwright';
import type { DomOptions, Scenario, ScenarioContext } from './scenario.ts';
import type { NetworkEntry } from './normalize.ts';
import type { ConsoleMessage } from './compare.ts';
import { attachWsCollector, WS_DEFAULTS, type WsEvent } from './ws.ts';

export interface Collected {
  /** screenshot: false 인 시나리오는 undefined */
  screenshot?: Buffer;
  /** 정규화 전 HTML. 기본은 document.documentElement.outerHTML, scenario.dom 이 있으면 그 범위(collectDom 참고) */
  dom: string;
  network: NetworkEntry[];
  console: ConsoleMessage[];
  ws: WsEvent[];
  durationMs: number;
}

export interface CollectOptions {
  viewport: { width: number; height: number };
  /** run 이 끝난 뒤 진행 중인 요청이 끝나기를 기다리는 최대 시간(ms). 기본 3000 */
  settleTimeoutMs?: number;
  /** 시나리오 하나의 최대 실행 시간(ms). 기본 60000 */
  scenarioTimeoutMs?: number;
}

export async function collect(browser: Browser, scenario: Scenario, ctx: ScenarioContext, opts: CollectOptions): Promise<Collected> {
  const startedAt = Date.now();
  const context = await browser.newContext({
    baseURL: ctx.baseURL,
    viewport: opts.viewport,
    deviceScaleFactor: 1,
    // 애니메이션·시간대·언어가 두 대상에서 같게 보이도록 고정한다.
    reducedMotion: 'reduce',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...(scenario.headers ? { extraHTTPHeaders: scenario.headers } : {}),
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(opts.scenarioTimeoutMs ?? 60_000);

    const network: NetworkEntry[] = [];
    const bySeq = new Map<PwRequest, NetworkEntry>();
    const pending = new Set<PwRequest>();
    const consoleMsgs: ConsoleMessage[] = [];
    const ws = attachWsCollector(page, startedAt);

    // network.serviceWorker 를 켜면 서비스 워커가 보낸 요청도 모은다. 이 요청은 page 이벤트에 오지 않고
    // BrowserContext 이벤트에서 request.serviceWorker() 가 있는 요청으로만 보인다. 옵션을 켜지 않으면 기존과 같게
    // page 이벤트만 듣고 source 필드도 남기지 않는다.
    const withServiceWorker = scenario.network?.serviceWorker === true;
    const track = (req: PwRequest, source: NetworkEntry['source']) => {
      const entry: NetworkEntry = {
        seq: network.length,
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        t: Date.now() - startedAt,
        ...(source ? { source } : {}),
      };
      network.push(entry);
      bySeq.set(req, entry);
      pending.add(req);
    };
    const onResponse = (res: PwResponse) => {
      const entry = bySeq.get(res.request());
      if (entry) entry.status = res.status();
    };
    const onFinished = (req: PwRequest) => pending.delete(req);
    const onFailed = (req: PwRequest) => {
      const entry = bySeq.get(req);
      if (entry) entry.failure = req.failure()?.errorText ?? 'failed';
      pending.delete(req);
    };

    page.on('request', (req) => track(req, withServiceWorker ? 'page' : undefined));
    page.on('response', onResponse);
    page.on('requestfinished', onFinished);
    page.on('requestfailed', onFailed);
    if (withServiceWorker) {
      // context 이벤트는 페이지 요청에도 오므로 서비스 워커 요청만 골라 페이지 요청이 두 번 잡히지 않게 한다.
      const fromWorker = (req: PwRequest) => req.serviceWorker() !== null;
      context.on('request', (req) => {
        if (fromWorker(req)) track(req, 'service-worker');
      });
      context.on('response', (res) => {
        if (fromWorker(res.request())) onResponse(res);
      });
      context.on('requestfinished', (req) => {
        if (fromWorker(req)) onFinished(req);
      });
      context.on('requestfailed', (req) => {
        if (fromWorker(req)) onFailed(req);
      });
    }
    page.on('console', (msg) => {
      const loc = msg.location();
      consoleMsgs.push({
        type: msg.type(),
        text: msg.text(),
        location: loc.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
      });
    });
    page.on('pageerror', (err) => {
      consoleMsgs.push({ type: 'pageerror', text: err.message });
    });

    await withTimeout(scenario.run(page, ctx), opts.scenarioTimeoutMs ?? 60_000, `시나리오 "${scenario.name}" 시간 초과`);
    await settle(pending, opts.settleTimeoutMs ?? 3000);
    // 열린 WebSocket 이 있으면 늦게 오는 프레임을 조금 더 기다린다(시나리오 websocket.timeoutMs, 기본 1000).
    if (ws.openCount() > 0) {
      await new Promise((r) => setTimeout(r, scenario.websocket?.timeoutMs ?? WS_DEFAULTS.timeoutMs));
    }

    const dom = await collectDom(page, scenario.dom);
    let screenshot: Buffer | undefined;
    if (scenario.screenshot !== false) {
      screenshot = await page.screenshot({
        type: 'png',
        fullPage: scenario.screenshot?.fullPage ?? false,
        animations: 'disabled',
        caret: 'hide',
      });
    }
    return { screenshot, dom, network, console: consoleMsgs, ws: ws.events, durationMs: Date.now() - startedAt };
  } finally {
    await context.close();
  }
}

/**
 * scenario.dom 에 따라 비교할 HTML 을 모은다. root 가 있으면 그 selector 의 첫 요소 outerHTML 만,
 * title 이면 document.title 을 `<title>` 로 앞에 붙인다. root 요소가 없으면 오류를 던져 시나리오를 실행 오류로 만든다.
 * 브라우저 쪽에서 평가되는 문자열이라 lib dom 없이도 쓸 수 있다.
 */
export async function collectDom(page: Page, opts: DomOptions | undefined): Promise<string> {
  let html: string;
  if (opts?.root === undefined) {
    html = (await page.evaluate('document.documentElement.outerHTML')) as string;
  } else {
    const found = (await page.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(opts.root)}); return el ? el.outerHTML : null; })()`,
    )) as string | null;
    if (found === null) throw new Error(`dom.root "${opts.root}" 에 맞는 요소가 없습니다`);
    html = found;
  }
  if (opts?.title) {
    const title = (await page.evaluate('document.title')) as string;
    html = `<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>\n${html}`;
  }
  return html;
}

async function settle(pending: Set<unknown>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type { Page };
