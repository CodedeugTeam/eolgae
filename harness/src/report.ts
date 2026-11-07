// 보고서. report.json(구조화)과 report.md(사람용)를 만든다.
import type { ConsoleComparison, DomComparison, NetworkComparison, ScreenshotComparison, ServiceWorkerComparison } from './compare.ts';
import { formatSignature } from './normalize.ts';
import { formatWsConnection, formatWsFrameDigest, type WsReportComparison } from './ws.ts';

export type ScenarioStatus = 'same' | 'different' | 'error';

export interface ScreenshotAxis extends Omit<ScreenshotComparison, 'diffPng'> {
  skipped: false;
  files: { old: string; new: string; diff?: string };
}

export interface ScreenshotSkipped {
  skipped: true;
}

export interface DomAxis extends DomComparison {
  files: { old: string; new: string };
  /** scenario.dom.root 로 범위를 좁혔으면 그 selector */
  root?: string;
  /** scenario.dom.title 로 <title> 을 함께 비교했으면 true */
  title?: boolean;
}

export interface NetworkAxis extends NetworkComparison {
  files: { old: string; new: string };
  /** 'api' 는 apiPrefix 요청만, 'all' 은 문서·/_app/ 자산·favicon 을 뺀 전체. 없으면 v0.1.0 보고서('api') */
  scope?: 'all' | 'api';
}

/**
 * WebSocket 축. 연결 순서열(path·종료 여부)과 프레임 순서열(연결 순번·방향·종류[·페이로드])을 비교한 결과.
 * 보고서용으로 마스킹된 모양이다: 프레임 페이로드는 길이·sha256 앞 12자만, 연결 path 의 쿼리 값은 `key=***`.
 */
export interface WsAxis extends WsReportComparison {
  compared: true;
  /** 비교에 쓴 옵션(기본값 채운 뒤) */
  options: { ignoreQuery: boolean; messageKey: string; ignorePayload: boolean; timeoutMs: number };
  /** 원본 이벤트가 든 network/<scenario>.{old,new}.json */
  files: { old: string; new: string };
}

export interface ScenarioReport {
  name: string;
  slug: string;
  status: ScenarioStatus;
  durationMs: { old: number; new: number };
  screenshot?: ScreenshotAxis | ScreenshotSkipped;
  dom?: DomAxis;
  network?: NetworkAxis;
  console?: ConsoleComparison;
  ws?: WsAxis;
  /** status === 'error' 일 때 메시지(스택 포함) */
  error?: string;
}

export interface ReportTargets {
  old: string;
  new: string;
  backend: string;
  apiPrefix: string;
  viewport: string;
  /** 주입 헤더. 값은 가려져 `키=***` 꼴로만 남는다. */
  headers: string[];
  scenarioFiles: string[];
}

export interface Report {
  version: 1;
  createdAt: string;
  targets: ReportTargets;
  scenarios: ScenarioReport[];
  summary: {
    total: number;
    same: number;
    different: number;
    error: number;
    /** 축별로 차이가 난 시나리오 수 */
    axes: { screenshot: number; dom: number; network: number; console: number; websocket: number };
  };
  /** 0 차이 없음, 1 차이 있음, 2 실행 오류 */
  exitCode: 0 | 1 | 2;
}

export function buildReport(targets: ReportTargets, scenarios: ScenarioReport[], createdAt = new Date().toISOString()): Report {
  const axes = { screenshot: 0, dom: 0, network: 0, console: 0, websocket: 0 };
  let same = 0;
  let different = 0;
  let error = 0;
  for (const s of scenarios) {
    if (s.status === 'error') error++;
    else if (s.status === 'different') different++;
    else same++;
    if (s.screenshot && !s.screenshot.skipped && !s.screenshot.equal) axes.screenshot++;
    if (s.dom && !s.dom.equal) axes.dom++;
    if (s.network && !s.network.equal) axes.network++;
    if (s.console && !s.console.equal) axes.console++;
    if (s.ws && !s.ws.equal) axes.websocket++;
  }
  const exitCode: 0 | 1 | 2 = error > 0 ? 2 : different > 0 ? 1 : 0;
  return {
    version: 1,
    createdAt,
    targets,
    scenarios,
    summary: { total: scenarios.length, same, different, error, axes },
    exitCode,
  };
}

/** 시나리오의 축 결과를 보고 상태를 정한다. */
export function scenarioStatus(s: Pick<ScenarioReport, 'screenshot' | 'dom' | 'network' | 'console' | 'ws' | 'error'>): ScenarioStatus {
  if (s.error) return 'error';
  const diffs = [
    s.screenshot && !s.screenshot.skipped && !s.screenshot.equal,
    s.dom && !s.dom.equal,
    s.network && !s.network.equal,
    s.console && !s.console.equal,
    s.ws && !s.ws.equal,
  ];
  return diffs.some(Boolean) ? 'different' : 'same';
}

const OK = '✅ 같음';
const NG = '❌ 다름';
const SKIP = '— 생략';
const NA = '— 미수집';

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  const { summary, targets } = report;
  lines.push('# eolgae 패리티 보고서');
  lines.push('');
  lines.push(`- 생성: ${report.createdAt}`);
  lines.push(`- old: \`${targets.old}\``);
  lines.push(`- new: \`${targets.new}\``);
  lines.push(`- backend: \`${targets.backend}\` (apiPrefix \`${targets.apiPrefix}\`)`);
  lines.push(`- viewport: ${targets.viewport}`);
  if (targets.headers.length > 0) lines.push(`- 주입 헤더: ${targets.headers.map((h) => `\`${h}\``).join(', ')}`);
  lines.push(`- 시나리오 파일: ${targets.scenarioFiles.map((f) => `\`${f}\``).join(', ')}`);
  lines.push('');
  lines.push(
    `**결과: ${summary.total}개 시나리오 중 같음 ${summary.same} / 다름 ${summary.different} / 오류 ${summary.error} → 종료 코드 ${report.exitCode}**`,
  );
  lines.push('');
  lines.push('## 시나리오 × 축');
  lines.push('');
  lines.push('| 시나리오 | 스크린샷 | DOM | 네트워크(요청 순서) | 콘솔 에러 | WebSocket(연결·프레임 순서) |');
  lines.push('|---|---|---|---|---|---|');
  for (const s of report.scenarios) {
    if (s.status === 'error') {
      lines.push(`| ${esc(s.name)} | ⚠️ 오류 | ⚠️ 오류 | ⚠️ 오류 | ⚠️ 오류 | ⚠️ 오류 |`);
      continue;
    }
    const shot = !s.screenshot ? NA : s.screenshot.skipped ? SKIP : s.screenshot.equal ? OK : NG;
    const dom = !s.dom ? NA : s.dom.equal ? OK : NG;
    const netMark = !s.network ? NA : s.network.equal ? OK : NG;
    // 서비스 워커 요청을 비교한 시나리오만 건수를 덧붙인다(옵션을 켜지 않으면 기존 칸 그대로).
    const sw = s.network?.serviceWorker;
    const net = sw ? `${netMark} (SW ${sw.old.length}/${sw.new.length})` : netMark;
    const con = !s.console ? NA : s.console.equal ? OK : `${NG} (old ${s.console.oldErrors} / new ${s.console.newErrors})`;
    const ws = !s.ws ? NA : `${s.ws.equal ? OK : NG} (${wsCounts(s.ws)})`;
    lines.push(`| ${esc(s.name)} | ${shot} | ${dom} | ${net} | ${con} | ${ws} |`);
  }
  lines.push('');

  const detailed = report.scenarios.filter((s) => s.status !== 'same');
  if (detailed.length > 0) {
    lines.push('## 차이 상세');
    lines.push('');
    for (const s of detailed) {
      lines.push(`### ${esc(s.name)}`);
      lines.push('');
      if (s.status === 'error') {
        lines.push('실행 오류:');
        lines.push('');
        lines.push('```');
        lines.push(s.error ?? '(메시지 없음)');
        lines.push('```');
        lines.push('');
        continue;
      }
      if (s.screenshot && !s.screenshot.skipped && !s.screenshot.equal) {
        const sc = s.screenshot;
        lines.push('#### 스크린샷');
        lines.push('');
        if (sc.sizeMismatch) {
          lines.push(`- 크기 다름: old ${sc.old.width}×${sc.old.height}, new ${sc.new.width}×${sc.new.height}`);
        }
        lines.push(
          `- 다른 픽셀 ${sc.diffPixels}개 (${(sc.diffRatio * 100).toFixed(3)}%, 허용 ${(sc.maxDiffPixelRatio * 100).toFixed(3)}%, threshold ${sc.threshold})`,
        );
        lines.push(`- old: \`${sc.files.old}\``);
        lines.push(`- new: \`${sc.files.new}\``);
        if (sc.files.diff) lines.push(`- diff: \`${sc.files.diff}\``);
        lines.push('');
      }
      if (s.dom && !s.dom.equal) {
        lines.push('#### DOM (정규화 뒤)');
        lines.push('');
        if (s.dom.root !== undefined) lines.push(`- 범위: \`${s.dom.root}\`${s.dom.title ? ' + <title>' : ''}`);
        lines.push(`- 길이: old ${s.dom.oldLength}, new ${s.dom.newLength}`);
        if (s.dom.excerpt) {
          lines.push(`- 첫 차이 위치: ${s.dom.excerpt.index}`);
          lines.push('');
          lines.push('old:');
          lines.push('');
          lines.push('```html');
          lines.push(s.dom.excerpt.old);
          lines.push('```');
          lines.push('');
          lines.push('new:');
          lines.push('');
          lines.push('```html');
          lines.push(s.dom.excerpt.new);
          lines.push('```');
        }
        lines.push(`- 전체: \`${s.dom.files.old}\`, \`${s.dom.files.new}\``);
        lines.push('');
      }
      // 서비스 워커 비교가 붙은 시나리오는 페이지 요청 순서가 어긋났을 때만 순서 표를 적는다(집합 차이는 아래 절).
      if (s.network && !s.network.equal && (!s.network.serviceWorker || s.network.firstDiffIndex !== undefined)) {
        lines.push('#### 네트워크 (요청 순서)');
        lines.push('');
        lines.push(`- 범위: ${s.network.scope === 'all' ? '문서·/_app/ 자산·favicon 을 뺀 전체 요청' : `\`${report.targets.apiPrefix}\` 요청만`}`);
        if (s.network.firstDiffIndex !== undefined) lines.push(`- 처음 어긋난 위치: ${s.network.firstDiffIndex}`);
        lines.push('');
        lines.push('| # | old | new |');
        lines.push('|---|---|---|');
        const n = Math.max(s.network.old.length, s.network.new.length);
        for (let i = 0; i < n; i++) {
          const a = s.network.old[i];
          const b = s.network.new[i];
          const mark = i === s.network.firstDiffIndex ? '**' : '';
          lines.push(
            `| ${mark}${i}${mark} | ${a ? esc(formatSignature(a)) : '—'} | ${b ? esc(formatSignature(b)) : '—'} |`,
          );
        }
        lines.push('');
        lines.push(`- 원본: \`${s.network.files.old}\`, \`${s.network.files.new}\``);
        lines.push('');
      }
      if (s.network?.serviceWorker && !s.network.serviceWorker.equal) {
        lines.push(...renderServiceWorkerDetail(s.network.serviceWorker, s.network.files));
      }
      if (s.console && !s.console.equal) {
        lines.push('#### 콘솔');
        lines.push('');
        lines.push(`- error/pageerror: old ${s.console.oldErrors}건, new ${s.console.newErrors}건`);
        lines.push('');
      }
      if (s.ws && !s.ws.equal) {
        lines.push(...renderWsDetail(s.ws));
      }
    }
  }

  // 콘솔 메시지는 차이가 없어도 각 대상의 목록을 남긴다(요구 사항).
  lines.push('## 콘솔 메시지');
  lines.push('');
  for (const s of report.scenarios) {
    if (!s.console) continue;
    lines.push(`### ${esc(s.name)}`);
    lines.push('');
    for (const side of ['old', 'new'] as const) {
      const msgs = s.console[side];
      lines.push(`- ${side}: ${msgs.length}건`);
      for (const m of msgs) {
        lines.push(`  - [${m.type}] ${esc(m.text)}${m.location ? ` (${m.location})` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 차이 상세의 서비스 워커 절. 순서는 보지 않으므로 한쪽에만 있는 요청 목록을 적는다. */
function renderServiceWorkerDetail(sw: ServiceWorkerComparison, files: { old: string; new: string }): string[] {
  const lines: string[] = [];
  lines.push('#### 네트워크 (서비스 워커 요청 집합)');
  lines.push('');
  lines.push(`- 서비스 워커가 보낸 요청: old ${sw.old.length}건, new ${sw.new.length}건 (순서 무시, 같은 요청은 개수까지 비교)`);
  for (const [label, list] of [['old 에만', sw.onlyOld], ['new 에만', sw.onlyNew]] as const) {
    lines.push(`- ${label}: ${list.length === 0 ? '없음' : list.map((x) => `\`${esc(x)}\``).join(', ')}`);
  }
  lines.push('');
  lines.push(`- 원본: \`${files.old}\`, \`${files.new}\` (requests[].source 가 'service-worker' 인 항목)`);
  lines.push('');
  return lines;
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** 표 셀에 넣는 WebSocket 건수 요약: 연결 수와 프레임 수를 old/new 로 적는다. */
function wsCounts(ws: WsAxis): string {
  return `연결 ${ws.old.openCount}/${ws.new.openCount}, 프레임 ${ws.old.frames.length}/${ws.new.frames.length}`;
}

/** 차이 상세의 WebSocket 절. 처음 어긋난 곳과, 그 순서열(연결 또는 프레임)을 표로 적는다. 긴 프레임 목록은 어긋난 곳 앞뒤만 보인다. */
function renderWsDetail(ws: WsAxis, window = 10): string[] {
  const lines: string[] = [];
  lines.push('#### WebSocket (연결·프레임 순서)');
  lines.push('');
  lines.push(`- 연결: old ${ws.old.openCount}개(종료 ${ws.old.closeCount}), new ${ws.new.openCount}개(종료 ${ws.new.closeCount})`);
  lines.push(`- 프레임: old ${ws.old.frames.length}개, new ${ws.new.frames.length}개`);
  lines.push(
    `- 옵션: ignoreQuery ${ws.options.ignoreQuery}, messageKey \`${ws.options.messageKey}\`, ignorePayload ${ws.options.ignorePayload}, timeoutMs ${ws.options.timeoutMs}`,
  );
  const d = ws.firstDiff;
  if (d) {
    lines.push(`- 처음 어긋난 곳: ${d.where === 'connections' ? '연결' : '프레임'} ${d.index}`);
    lines.push(`  - old: ${d.old === null ? '—' : `\`${esc(d.old)}\``}`);
    lines.push(`  - new: ${d.new === null ? '—' : `\`${esc(d.new)}\``}`);
    lines.push('');
    const oldRows = d.where === 'connections' ? ws.old.connections.map(formatWsConnection) : ws.old.frames.map(formatWsFrameDigest);
    const newRows = d.where === 'connections' ? ws.new.connections.map(formatWsConnection) : ws.new.frames.map(formatWsFrameDigest);
    const n = Math.max(oldRows.length, newRows.length);
    const from = Math.max(0, d.index - window);
    const to = Math.min(n, d.index + window + 1);
    if (from > 0) {
      lines.push(`(앞 ${from}개 생략)`);
      lines.push('');
    }
    lines.push('| # | old | new |');
    lines.push('|---|---|---|');
    for (let i = from; i < to; i++) {
      const mark = i === d.index ? '**' : '';
      lines.push(`| ${mark}${i}${mark} | ${oldRows[i] === undefined ? '—' : esc(oldRows[i]!)} | ${newRows[i] === undefined ? '—' : esc(newRows[i]!)} |`);
    }
    if (to < n) {
      lines.push('');
      lines.push(`(뒤 ${n - to}개 생략)`);
    }
  }
  lines.push('');
  lines.push(`- 원문은 \`${ws.files.old}\`, \`${ws.files.new}\` 참조 (보고서에는 페이로드를 종류·바이트 수·sha256 앞 12자로, 쿼리 값은 \`key=***\` 로만 적는다)`);
  lines.push('');
  return lines;
}
