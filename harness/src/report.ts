// 보고서. report.json(구조화)과 report.md(사람용)를 만든다.
import type { ConsoleComparison, DomComparison, NetworkComparison, ScreenshotComparison } from './compare.ts';
import { formatSignature } from './normalize.ts';

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

export interface WsAxis {
  /** 비교하지 않는다. 수집 건수만 적는다. */
  compared: false;
  oldCount: number;
  newCount: number;
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
    axes: { screenshot: number; dom: number; network: number; console: number };
  };
  /** 0 차이 없음, 1 차이 있음, 2 실행 오류 */
  exitCode: 0 | 1 | 2;
}

export function buildReport(targets: ReportTargets, scenarios: ScenarioReport[], createdAt = new Date().toISOString()): Report {
  const axes = { screenshot: 0, dom: 0, network: 0, console: 0 };
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
export function scenarioStatus(s: Pick<ScenarioReport, 'screenshot' | 'dom' | 'network' | 'console' | 'error'>): ScenarioStatus {
  if (s.error) return 'error';
  const diffs = [
    s.screenshot && !s.screenshot.skipped && !s.screenshot.equal,
    s.dom && !s.dom.equal,
    s.network && !s.network.equal,
    s.console && !s.console.equal,
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
  lines.push('| 시나리오 | 스크린샷 | DOM | 네트워크(요청 순서) | 콘솔 에러 | WebSocket(수집만) |');
  lines.push('|---|---|---|---|---|---|');
  for (const s of report.scenarios) {
    if (s.status === 'error') {
      lines.push(`| ${esc(s.name)} | ⚠️ 오류 | ⚠️ 오류 | ⚠️ 오류 | ⚠️ 오류 | — |`);
      continue;
    }
    const shot = !s.screenshot ? NA : s.screenshot.skipped ? SKIP : s.screenshot.equal ? OK : NG;
    const dom = !s.dom ? NA : s.dom.equal ? OK : NG;
    const net = !s.network ? NA : s.network.equal ? OK : NG;
    const con = !s.console ? NA : s.console.equal ? OK : `${NG} (old ${s.console.oldErrors} / new ${s.console.newErrors})`;
    const ws = s.ws ? `old ${s.ws.oldCount} / new ${s.ws.newCount}건` : '—';
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
      if (s.network && !s.network.equal) {
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
      if (s.console && !s.console.equal) {
        lines.push('#### 콘솔');
        lines.push('');
        lines.push(`- error/pageerror: old ${s.console.oldErrors}건, new ${s.console.newErrors}건`);
        lines.push('');
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

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
