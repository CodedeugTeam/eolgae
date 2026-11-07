// 하니스 프록시. 모든 target 앞에 서서
//  ① apiPrefix 로 시작하는 요청은 backend 로, 나머지는 target 으로 넘기고
//  ② 두 방향 모두에 지정한 헤더를 주입한다(Traefik forward-auth 가 넣는 x-forwarded-user 흉내).
// 브라우저는 이 프록시 포트만 본다.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export interface ProxyOptions {
  /** 비 API 요청이 가는 곳 (정적 서버 또는 url: 대상) */
  targetURL: string;
  /** apiPrefix 요청이 가는 곳 */
  backendURL: string;
  /** 기본 /api */
  apiPrefix?: string;
  /** 두 방향 요청 모두에 주입하는 헤더 */
  headers?: Record<string, string>;
}

export interface RunningProxy {
  url: string;
  close(): Promise<void>;
}

/** `--header k=v` 문자열 목록을 헤더 맵으로 바꾼다. 키는 소문자로 맞춘다. */
export function parseHeaderArgs(list: readonly string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list ?? []) {
    const idx = item.indexOf('=');
    if (idx <= 0) throw new Error(`--header 형식은 k=v 입니다: "${item}"`);
    out[item.slice(0, idx).trim().toLowerCase()] = item.slice(idx + 1).trim();
  }
  return out;
}

/** 요청 경로가 apiPrefix 에 속하는지. `/api` 는 `/api`, `/api/..`, `/api?..` 에 맞고 `/apix` 에는 맞지 않는다. */
export function isApiPath(urlPath: string, apiPrefix: string): boolean {
  const prefix = apiPrefix.endsWith('/') ? apiPrefix.slice(0, -1) : apiPrefix;
  if (prefix === '') return false;
  if (!urlPath.startsWith(prefix)) return false;
  const next = urlPath.charAt(prefix.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

export async function startProxy(opts: ProxyOptions): Promise<RunningProxy> {
  const apiPrefix = opts.apiPrefix ?? '/api';
  const target = new URL(opts.targetURL);
  const backend = new URL(opts.backendURL);
  const inject = normalizeHeaders(opts.headers ?? {});

  const pick = (urlPath: string) => (isApiPath(urlPath, apiPrefix) ? backend : target);

  const server = http.createServer((req, res) => forward(req, res, pick(req.url ?? '/'), inject));
  server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, pick(req.url ?? '/'), inject));

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

function normalizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

function buildHeaders(req: IncomingMessage, upstream: URL, inject: Record<string, string>): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers[k] = v;
  }
  headers['host'] = upstream.host;
  // 업스트림이 압축해 보내면 그대로 흘려보내므로 accept-encoding 은 유지한다.
  for (const [k, v] of Object.entries(inject)) headers[k] = v;
  return headers;
}

function forward(req: IncomingMessage, res: ServerResponse, upstream: URL, inject: Record<string, string>): void {
  const mod = upstream.protocol === 'https:' ? https : http;
  const preq = mod.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: buildHeaders(req, upstream, inject),
    },
    (pres) => {
      res.writeHead(pres.statusCode ?? 502, pres.statusMessage, pres.headers);
      pres.pipe(res);
    },
  );
  preq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(`eolgae-harness proxy: upstream ${upstream.origin} 연결 실패: ${err.message}`);
  });
  req.pipe(preq);
}

// WebSocket 등 Upgrade 요청은 TCP 터널로 그대로 잇는다. 헤더 주입은 첫 요청 줄에만 적용된다.
function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, upstream: URL, inject: Record<string, string>): void {
  const port = Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80));
  const headers = buildHeaders(req, upstream, inject);
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  for (const [k, v] of Object.entries(headers)) {
    for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
  }
  const raw = lines.join('\r\n') + '\r\n\r\n';

  const upstreamSocket = net.connect(port, upstream.hostname, () => {
    upstreamSocket.write(raw);
    if (head.length > 0) upstreamSocket.write(head);
    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });
  const drop = () => {
    socket.destroy();
    upstreamSocket.destroy();
  };
  upstreamSocket.on('error', drop);
  socket.on('error', drop);
}
