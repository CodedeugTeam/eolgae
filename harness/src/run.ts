// 실행 오케스트레이션. 대상 둘을 기동하고 프록시를 앞에 세운 뒤 시나리오를 old → new 순서로 돌려 비교·보고한다.
import { mkdir, writeFile, glob as fsGlob } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { parseTarget, startTarget, type RunningTarget } from './targets.ts';
import { startProxy, type RunningProxy } from './proxy.ts';
import { collect, type Collected } from './collect.ts';
import { networkSignatures, normalizeDom } from './normalize.ts';
import { compareConsole, compareDom, compareNetwork, compareScreenshots } from './compare.ts';
import { compareWs, redactWsComparison, WS_DEFAULTS, wsSummary } from './ws.ts';
import { buildReport, renderMarkdown, scenarioStatus, type Report, type ScenarioReport } from './report.ts';
import { scenarioSlug, type Scenario, type ScenarioContext } from './scenario.ts';
import { HarnessError } from './errors.ts';

export { HarnessError };

export interface RunOptions {
  old: string;
  new: string;
  backend: string;
  /** glob 또는 파일 경로 목록 */
  scenarios: string[];
  out: string;
  headers?: Record<string, string>;
  apiPrefix?: string;
  viewport?: { width: number; height: number };
  /** 진행 로그를 받을 함수. 기본은 아무것도 출력하지 않는다. */
  log?: (line: string) => void;
}

export interface RunResult {
  report: Report;
  outDir: string;
  reportJsonPath: string;
  reportMdPath: string;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const log = options.log ?? (() => {});
  const apiPrefix = options.apiPrefix ?? '/api';
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  const headers = options.headers ?? {};
  const outDir = resolve(options.out);

  let backendURL: string;
  try {
    backendURL = new URL(options.backend).origin;
  } catch {
    throw new HarnessError(`--backend 주소를 해석할 수 없습니다: "${options.backend}"`);
  }

  const files = await resolveScenarioFiles(options.scenarios);
  if (files.length === 0) {
    throw new HarnessError(`시나리오 파일을 찾지 못했습니다: ${options.scenarios.join(', ')}`);
  }
  const scenarios = await loadScenarios(files);
  if (scenarios.length === 0) {
    throw new HarnessError(`시나리오 파일에 시나리오가 하나도 없습니다: ${files.join(', ')}`);
  }
  log(`시나리오 ${scenarios.length}개 (${files.length}개 파일)`);

  await mkdir(outDir, { recursive: true });

  let oldTarget: RunningTarget | undefined;
  let newTarget: RunningTarget | undefined;
  let oldProxy: RunningProxy | undefined;
  let newProxy: RunningProxy | undefined;
  let browser: Browser | undefined;
  try {
    try {
      oldTarget = await startTarget(parseTarget(options.old));
      newTarget = await startTarget(parseTarget(options.new));
      oldProxy = await startProxy({ targetURL: oldTarget.url, backendURL, apiPrefix, headers });
      newProxy = await startProxy({ targetURL: newTarget.url, backendURL, apiPrefix, headers });
    } catch (err) {
      throw new HarnessError(`대상 기동 실패: ${errorMessage(err)}`, { cause: err });
    }
    log(`old ${options.old} → ${oldTarget.url} (프록시 ${oldProxy.url})`);
    log(`new ${options.new} → ${newTarget.url} (프록시 ${newProxy.url})`);

    try {
      browser = await chromium.launch();
    } catch (err) {
      throw new HarnessError(`chromium 기동 실패: ${errorMessage(err)}`, { cause: err });
    }

    const results: ScenarioReport[] = [];
    for (const scenario of scenarios) {
      const slug = scenarioSlug(scenario.name);
      log(`▶ ${scenario.name}`);
      const ctxOld: ScenarioContext = { baseURL: oldProxy.url, backendURL, label: 'old' };
      const ctxNew: ScenarioContext = { baseURL: newProxy.url, backendURL, label: 'new' };
      let oldC: Collected | undefined;
      let newC: Collected | undefined;
      try {
        oldC = await collect(browser, scenario, ctxOld, { viewport });
        newC = await collect(browser, scenario, ctxNew, { viewport });
      } catch (err) {
        const message = errorStack(err);
        log(`  ⚠️ 오류: ${errorMessage(err)}`);
        results.push({
          name: scenario.name,
          slug,
          status: 'error',
          durationMs: { old: oldC?.durationMs ?? 0, new: newC?.durationMs ?? 0 },
          error: message,
        });
        continue;
      }
      const entry = await compareAndWrite(outDir, scenario, slug, oldC, newC, apiPrefix);
      results.push(entry);
      log(`  ${entry.status === 'same' ? '같음' : '다름'}`);
    }

    const report = buildReport(
      {
        old: options.old,
        new: options.new,
        backend: backendURL,
        apiPrefix,
        viewport: `${viewport.width}x${viewport.height}`,
        // 헤더 값은 인증 토큰일 수 있어 보고서에는 키만 남기고 값은 가린다.
        headers: Object.keys(headers).map((k) => `${k}=***`),
        scenarioFiles: files.map((f) => relative(process.cwd(), f) || f),
      },
      results,
    );
    const reportJsonPath = join(outDir, 'report.json');
    const reportMdPath = join(outDir, 'report.md');
    await writeFile(reportJsonPath, JSON.stringify(report, null, 2) + '\n');
    await writeFile(reportMdPath, renderMarkdown(report) + '\n');
    log(`보고서: ${reportMdPath}`);
    return { report, outDir, reportJsonPath, reportMdPath };
  } finally {
    await browser?.close().catch(() => {});
    await oldProxy?.close().catch(() => {});
    await newProxy?.close().catch(() => {});
    await oldTarget?.close().catch(() => {});
    await newTarget?.close().catch(() => {});
  }
}

async function compareAndWrite(
  outDir: string,
  scenario: Scenario,
  slug: string,
  oldC: Collected,
  newC: Collected,
  apiPrefix: string,
): Promise<ScenarioReport> {
  const shotDir = join(outDir, 'screenshots', slug);
  const domDir = join(outDir, 'dom');
  const netDir = join(outDir, 'network');
  await Promise.all([mkdir(shotDir, { recursive: true }), mkdir(domDir, { recursive: true }), mkdir(netDir, { recursive: true })]);
  const rel = (p: string) => relative(outDir, p);

  // 스크린샷
  let screenshot: ScenarioReport['screenshot'];
  if (scenario.screenshot === false || !oldC.screenshot || !newC.screenshot) {
    screenshot = { skipped: true };
  } else {
    const oldPath = join(shotDir, 'old.png');
    const newPath = join(shotDir, 'new.png');
    await writeFile(oldPath, oldC.screenshot);
    await writeFile(newPath, newC.screenshot);
    const cmp = compareScreenshots(oldC.screenshot, newC.screenshot, {
      threshold: scenario.screenshot?.threshold,
      maxDiffPixelRatio: scenario.screenshot?.maxDiffPixelRatio,
    });
    const { diffPng, ...rest } = cmp;
    const files: { old: string; new: string; diff?: string } = { old: rel(oldPath), new: rel(newPath) };
    if (diffPng) {
      const diffPath = join(shotDir, 'diff.png');
      await writeFile(diffPath, diffPng);
      files.diff = rel(diffPath);
    }
    screenshot = { ...rest, skipped: false, files };
  }

  // DOM
  const oldDom = normalizeDom(oldC.dom);
  const newDom = normalizeDom(newC.dom);
  const oldDomPath = join(domDir, `${slug}.old.html`);
  const newDomPath = join(domDir, `${slug}.new.html`);
  await writeFile(oldDomPath, oldDom + '\n');
  await writeFile(newDomPath, newDom + '\n');
  const dom = {
    ...compareDom(oldDom, newDom),
    files: { old: rel(oldDomPath), new: rel(newDomPath) },
    ...(scenario.dom?.root !== undefined ? { root: scenario.dom.root } : {}),
    ...(scenario.dom?.title ? { title: true } : {}),
  };

  // 네트워크
  const oldNetPath = join(netDir, `${slug}.old.json`);
  const newNetPath = join(netDir, `${slug}.new.json`);
  await writeFile(oldNetPath, JSON.stringify({ requests: oldC.network, ws: oldC.ws }, null, 2) + '\n');
  await writeFile(newNetPath, JSON.stringify({ requests: newC.network, ws: newC.ws }, null, 2) + '\n');
  const apiOnly = scenario.network?.apiOnly === true;
  const sigOpts = { apiPrefix, apiOnly };
  const network = {
    ...compareNetwork(networkSignatures(oldC.network, sigOpts), networkSignatures(newC.network, sigOpts)),
    files: { old: rel(oldNetPath), new: rel(newNetPath) },
    scope: apiOnly ? ('api' as const) : ('all' as const),
  };

  const consoleCmp = compareConsole(oldC.console, newC.console);

  // WebSocket: 원본 이벤트는 위 network json 에 함께 들어 있고, 여기서는 요약을 비교한다.
  // 보고서에는 페이로드 원문·쿼리 값을 싣지 않는다(길이·sha256 앞 12자, key=*** 로 마스킹).
  const wsOpts = { ...WS_DEFAULTS, ...stripUndefined(scenario.websocket ?? {}) };
  const ws: ScenarioReport['ws'] = {
    ...redactWsComparison(compareWs(wsSummary(oldC.ws, wsOpts), wsSummary(newC.ws, wsOpts))),
    compared: true,
    options: wsOpts,
    files: { old: rel(oldNetPath), new: rel(newNetPath) },
  };

  const partial = { screenshot, dom, network, console: consoleCmp, ws };
  return {
    name: scenario.name,
    slug,
    status: scenarioStatus(partial),
    durationMs: { old: oldC.durationMs, new: newC.durationMs },
    ...partial,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** glob 또는 파일 경로 목록을 절대 경로 목록으로 푼다. 순서는 정렬해 두 대상 실행 순서가 같게 한다. */
export async function resolveScenarioFiles(patterns: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of patterns) {
    if (/[*?[{]/.test(pattern)) {
      for await (const match of fsGlob(pattern, { cwd: process.cwd() })) {
        found.add(resolve(match));
      }
    } else {
      found.add(isAbsolute(pattern) ? pattern : resolve(pattern));
    }
  }
  return [...found].sort();
}

/** 시나리오 파일을 Node 네이티브 TS 로딩으로 import 한다. default export 가 defineScenarios 결과(배열)여야 한다. */
export async function loadScenarios(files: readonly string[]): Promise<Scenario[]> {
  const all: Scenario[] = [];
  const names = new Set<string>();
  for (const file of files) {
    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    } catch (err) {
      throw new HarnessError(`시나리오 파일 로드 실패 ${file}: ${errorMessage(err)}`, { cause: err });
    }
    const list = mod.default;
    if (!Array.isArray(list)) {
      throw new HarnessError(`${file}: default export 가 defineScenarios([...]) 결과가 아닙니다`);
    }
    for (const s of list as Scenario[]) {
      if (typeof s?.name !== 'string' || typeof s?.run !== 'function') {
        throw new HarnessError(`${file}: name 과 run 이 있는 시나리오만 허용됩니다`);
      }
      if (names.has(s.name)) throw new HarnessError(`시나리오 이름 "${s.name}" 이 여러 파일에 있습니다`);
      names.add(s.name);
      all.push(s);
    }
  }
  return all;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
