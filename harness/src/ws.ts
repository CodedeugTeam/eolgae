// WebSocket 축. 수집(page.on('websocket'))과 정규화·비교를 한 곳에 둔다.
//  - 수집: 연결(open)·프레임(sent/received)·종료(close)·오류(error) 이벤트를 연결 순번과 함께 남긴다.
//  - 정규화: 연결은 path(+query), 프레임은 (연결 순번, 방향, 메시지 종류[, 페이로드]) 로 요약한다.
//  - 비교: 연결 순서열과 프레임 순서열을 앞에서부터 맞춰 보고 처음 어긋난 곳을 알려준다.
import type { Page } from 'playwright';

export type WsEventKind = 'open' | 'sent' | 'received' | 'close' | 'error';

export interface WsEvent {
  /** 이 이벤트가 속한 연결의 순번(시나리오 안에서 open 된 순서, 0부터) */
  conn: number;
  url: string;
  kind: WsEventKind;
  /** 프레임 본문. 바이너리 프레임은 base64 문자열로 담는다. */
  payload?: string;
  /** 바이너리 프레임이면 true */
  binary?: boolean;
  /** 프레임 본문 길이(문자열은 문자 수, 바이너리는 바이트 수) */
  size?: number;
  /** 시나리오 시작 기준 경과 시간(ms) */
  t: number;
}

export interface WsCollector {
  /** 수집된 이벤트. 실행 중 계속 채워진다. */
  events: WsEvent[];
  /** 아직 close 되지 않은 연결 수 */
  openCount(): number;
}

/** page 에 WebSocket 리스너를 붙이고 수집기를 돌려준다. */
export function attachWsCollector(page: Page, startedAt = Date.now()): WsCollector {
  const events: WsEvent[] = [];
  let nextConn = 0;
  let open = 0;
  const now = () => Date.now() - startedAt;
  page.on('websocket', (ws) => {
    const url = ws.url();
    const conn = nextConn++;
    open++;
    let closed = false;
    events.push({ conn, url, kind: 'open', t: now() });
    ws.on('framesent', (frame) => events.push({ conn, url, kind: 'sent', ...framePayload(frame.payload), t: now() }));
    ws.on('framereceived', (frame) => events.push({ conn, url, kind: 'received', ...framePayload(frame.payload), t: now() }));
    ws.on('close', () => {
      if (!closed) {
        closed = true;
        open--;
      }
      events.push({ conn, url, kind: 'close', t: now() });
    });
    ws.on('socketerror', (err) => events.push({ conn, url, kind: 'error', payload: String(err), t: now() }));
  });
  return { events, openCount: () => open };
}

function framePayload(payload: string | Buffer): Pick<WsEvent, 'payload' | 'binary' | 'size'> {
  if (typeof payload === 'string') return { payload, size: payload.length };
  return { payload: payload.toString('base64'), binary: true, size: payload.length };
}

/** 시나리오 계약의 websocket 옵션. 모두 선택이고 기본값은 아래와 같다. */
export interface WebSocketOptions {
  /** 연결 URL 비교에서 쿼리를 뗀다. 기본 false */
  ignoreQuery?: boolean;
  /** JSON 메시지의 종류를 읽을 키. 기본 'type' */
  messageKey?: string;
  /** 페이로드 전문은 비교하지 않고 메시지 종류만 비교한다. 기본 false */
  ignorePayload?: boolean;
  /** run 이 끝난 뒤 열린 소켓이 있으면 이만큼(ms) 프레임을 더 모은다. 기본 1000 */
  timeoutMs?: number;
}

export const WS_DEFAULTS = { ignoreQuery: false, messageKey: 'type', ignorePayload: false, timeoutMs: 1000 } as const;

/** 메시지 종류 fallback 으로 쓰는 앞부분 길이 */
const KIND_HEAD = 32;

/** 연결 하나의 요약 */
export interface WsConnectionSignature {
  conn: number;
  /** path(+query). 호스트·포트는 프록시마다 다르므로 보지 않는다 */
  path: string;
  closed: boolean;
  errors: number;
}

/** 프레임 하나의 요약 */
export interface WsFrameSignature {
  conn: number;
  dir: 'sent' | 'received';
  /** 메시지 종류: JSON 이면 messageKey 값, 아니면 앞 32자, 바이너리면 `binary:<바이트>` */
  kind: string;
  /** ignorePayload 가 아니면 정규화한 전문(JSON 은 키 정렬·공백 제거, 바이너리는 base64) */
  payload?: string;
}

export interface WsSummary {
  connections: WsConnectionSignature[];
  frames: WsFrameSignature[];
  openCount: number;
  closeCount: number;
  errorCount: number;
}

/** 수집한 이벤트를 비교용 요약으로 바꾼다. */
export function wsSummary(events: readonly WsEvent[], opts: WebSocketOptions = {}): WsSummary {
  const ignoreQuery = opts.ignoreQuery ?? WS_DEFAULTS.ignoreQuery;
  const messageKey = opts.messageKey ?? WS_DEFAULTS.messageKey;
  const ignorePayload = opts.ignorePayload ?? WS_DEFAULTS.ignorePayload;

  const byConn = new Map<number, WsConnectionSignature>();
  const frames: WsFrameSignature[] = [];
  let closeCount = 0;
  let errorCount = 0;
  for (const e of events) {
    switch (e.kind) {
      case 'open':
        byConn.set(e.conn, { conn: e.conn, path: wsPath(e.url, ignoreQuery), closed: false, errors: 0 });
        break;
      case 'close': {
        closeCount++;
        const c = byConn.get(e.conn);
        if (c) c.closed = true;
        break;
      }
      case 'error': {
        errorCount++;
        const c = byConn.get(e.conn);
        if (c) c.errors++;
        break;
      }
      case 'sent':
      case 'received': {
        const sig: WsFrameSignature = { conn: e.conn, dir: e.kind, kind: messageKind(e, messageKey) };
        if (!ignorePayload) sig.payload = normalizePayload(e);
        frames.push(sig);
        break;
      }
    }
  }
  const connections = [...byConn.values()].sort((a, b) => a.conn - b.conn);
  return { connections, frames, openCount: connections.length, closeCount, errorCount };
}

/** 연결 URL 에서 path(+query) 만 남긴다. 해석할 수 없는 URL 은 그대로 둔다. */
export function wsPath(url: string, ignoreQuery: boolean): string {
  try {
    const u = new URL(url);
    return ignoreQuery ? u.pathname : u.pathname + u.search;
  } catch {
    return url;
  }
}

/** 메시지 종류. JSON 객체이고 messageKey 값이 문자열·숫자·불리언이면 그 값, 아니면 본문 앞 32자. */
export function messageKind(e: Pick<WsEvent, 'payload' | 'binary' | 'size'>, messageKey: string): string {
  if (e.binary) return `binary:${e.size ?? 0}`;
  const text = e.payload ?? '';
  const parsed = tryParseJson(text);
  if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const v = (parsed as Record<string, unknown>)[messageKey];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return text.length > KIND_HEAD ? text.slice(0, KIND_HEAD) : text;
}

/** 페이로드 전문 정규화. JSON 은 키를 정렬해 공백 없이 다시 직렬화하고, 그 밖은 그대로 둔다. */
export function normalizePayload(e: Pick<WsEvent, 'payload' | 'binary'>): string {
  const text = e.payload ?? '';
  if (e.binary) return text;
  const parsed = tryParseJson(text);
  return parsed === undefined ? text : JSON.stringify(sortKeys(parsed));
}

function tryParseJson(text: string): unknown {
  const head = text.trimStart().charAt(0);
  if (head !== '{' && head !== '[') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function formatWsConnection(c: WsConnectionSignature): string {
  return `#${c.conn} ${c.path}${c.closed ? ' (closed)' : ' (open)'}${c.errors > 0 ? ` errors=${c.errors}` : ''}`;
}

export function formatWsFrame(f: WsFrameSignature): string {
  const arrow = f.dir === 'sent' ? '→' : '←';
  return f.payload === undefined ? `#${f.conn} ${arrow} ${f.kind}` : `#${f.conn} ${arrow} ${f.kind} ${f.payload}`;
}

export interface WsDiff {
  /** 어느 순서열에서 어긋났는지 */
  where: 'connections' | 'frames';
  index: number;
  old: string | null;
  new: string | null;
}

export interface WsComparison {
  equal: boolean;
  old: WsSummary;
  new: WsSummary;
  /** 처음 어긋난 곳. 연결 순서열을 먼저 보고, 같으면 프레임 순서열을 본다 */
  firstDiff?: WsDiff;
}

/** 두 요약을 비교한다. 연결(path·종료 여부) 순서열이 같고 프레임 순서열이 같아야 equal. */
export function compareWs(oldS: WsSummary, newS: WsSummary): WsComparison {
  const conn = firstMismatch(oldS.connections, newS.connections, formatWsConnection);
  if (conn) return { equal: false, old: oldS, new: newS, firstDiff: { where: 'connections', ...conn } };
  const frame = firstMismatch(oldS.frames, newS.frames, formatWsFrame);
  if (frame) return { equal: false, old: oldS, new: newS, firstDiff: { where: 'frames', ...frame } };
  return { equal: true, old: oldS, new: newS };
}

function firstMismatch<T>(a: readonly T[], b: readonly T[], fmt: (x: T) => string): Omit<WsDiff, 'where'> | undefined {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const xs = x === undefined ? null : fmt(x);
    const ys = y === undefined ? null : fmt(y);
    if (xs !== ys) return { index: i, old: xs, new: ys };
  }
  return undefined;
}
