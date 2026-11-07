#!/usr/bin/env node
// eolgae-harness CLI. 인자 파싱은 node:util parseArgs 만 쓴다.
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HarnessError, run } from './run.ts';
import { parseHeaderArgs } from './proxy.ts';

const USAGE = `사용법:
  eolgae-harness run --old <target> --new <target> --backend <url> --scenarios <glob|file> [...] --out <dir>
                     [--header k=v ...] [--api-prefix /api] [--viewport 1280x720] [--quiet]

target:
  static:<build 폴더>   하니스 내장 정적 서버로 서빙 (알 수 없는 경로는 index.html 폴백)
  url:<http://host:port> 이미 떠 있는 서버

종료 코드: 0 차이 없음 / 1 차이 있음 / 2 실행 오류`;

export interface ParsedCli {
  command: 'run' | 'help';
  options: {
    old?: string;
    new?: string;
    backend?: string;
    scenarios?: string[];
    out?: string;
    header?: string[];
    'api-prefix'?: string;
    viewport?: string;
    quiet?: boolean;
    help?: boolean;
  };
}

export function parseCli(argv: readonly string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      old: { type: 'string' },
      new: { type: 'string' },
      backend: { type: 'string' },
      scenarios: { type: 'string', multiple: true },
      out: { type: 'string' },
      header: { type: 'string', multiple: true },
      'api-prefix': { type: 'string' },
      viewport: { type: 'string' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || command === undefined || command === 'help') {
    return { command: 'help', options: values };
  }
  if (command !== 'run') {
    throw new HarnessError(`알 수 없는 명령 "${command}"\n\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new HarnessError(`run 뒤에 위치 인자는 받지 않습니다: ${positionals.slice(1).join(' ')}`);
  }
  return { command: 'run', options: values };
}

export function parseViewport(input: string | undefined): { width: number; height: number } {
  if (!input) return { width: 1280, height: 720 };
  const m = /^(\d+)x(\d+)$/.exec(input.trim());
  if (!m) throw new HarnessError(`--viewport 형식은 <너비>x<높이> 입니다: "${input}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function isInvokedDirectly(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === moduleUrl;
  } catch {
    return false;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedCli;
  try {
    parsed = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (parsed.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  const o = parsed.options;
  const missing = (['old', 'new', 'backend', 'scenarios', 'out'] as const).filter((k) => {
    const v = o[k];
    return v === undefined || (Array.isArray(v) && v.length === 0);
  });
  if (missing.length > 0) {
    console.error(`필수 인자가 없습니다: ${missing.map((k) => `--${k}`).join(', ')}\n\n${USAGE}`);
    return 2;
  }
  try {
    const result = await run({
      old: o.old!,
      new: o.new!,
      backend: o.backend!,
      scenarios: o.scenarios!,
      out: o.out!,
      headers: parseHeaderArgs(o.header),
      apiPrefix: o['api-prefix'],
      viewport: parseViewport(o.viewport),
      log: o.quiet ? undefined : (line) => console.error(line),
    });
    return result.report.exitCode;
  } catch (err) {
    if (err instanceof HarnessError) {
      console.error(`오류: ${err.message}`);
    } else {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    return 2;
  }
}

// bin 으로 실행됐을 때만 main 을 돈다(테스트에서 import 할 수 있게).
// node_modules/.bin 의 심볼릭 링크로 불려도 잡히도록 realpath 로 비교한다.
if (isInvokedDirectly(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 2;
    },
  );
}
