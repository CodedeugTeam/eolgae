// 비교 대상(target) 해석과 내장 정적 서버.
// target 은 `static:<build 폴더>` 또는 `url:<http://host:port>` 두 형식만 받는다.
import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';

export type TargetSpec = { kind: 'static'; dir: string } | { kind: 'url'; url: string };

export interface RunningTarget {
  /** 브라우저가 아닌 프록시가 바라보는 주소 */
  url: string;
  spec: TargetSpec;
  close(): Promise<void>;
}

export function parseTarget(input: string): TargetSpec {
  const idx = input.indexOf(':');
  if (idx < 0) {
    throw new Error(`target 형식이 잘못됐습니다: "${input}" (static:<dir> 또는 url:<http://...>)`);
  }
  const kind = input.slice(0, idx);
  const rest = input.slice(idx + 1);
  if (kind === 'static') {
    if (rest === '') throw new Error('static: 뒤에 빌드 폴더 경로가 필요합니다');
    return { kind: 'static', dir: resolve(rest) };
  }
  if (kind === 'url') {
    let parsed: URL;
    try {
      parsed = new URL(rest);
    } catch {
      throw new Error(`url: 뒤의 주소를 해석할 수 없습니다: "${rest}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`url: 대상은 http 또는 https 만 지원합니다: "${rest}"`);
    }
    return { kind: 'url', url: parsed.origin };
  }
  throw new Error(`알 수 없는 target 종류 "${kind}" (static 또는 url)`);
}

/** target 을 기동한다. url: 은 이미 떠 있는 서버이므로 그대로 돌려준다. */
export async function startTarget(spec: TargetSpec): Promise<RunningTarget> {
  if (spec.kind === 'url') {
    return { url: spec.url, spec, close: async () => {} };
  }
  const server = await startStaticServer(spec.dir);
  return { url: server.url, spec, close: server.close };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

/**
 * 빌드 폴더를 서빙하는 정적 서버. 포트는 OS 가 배정한다.
 * - 파일이 있으면 그대로 서빙
 * - 폴더면 그 안의 index.html
 * - `/_app/` 아래에서 없는 파일은 404 (자산 요청이 index.html 로 둔갑하지 않게)
 * - 그 밖의 알 수 없는 경로는 SPA 폴백으로 루트 index.html(200)
 */
export async function startStaticServer(dir: string): Promise<StaticServer> {
  const root = resolve(dir);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`static 대상 폴더가 없습니다: ${root}`);
  }
  const indexPath = join(root, 'index.html');
  const indexStat = await stat(indexPath).catch(() => null);
  if (!indexStat || !indexStat.isFile()) {
    throw new Error(`static 대상 폴더에 index.html 이 없습니다: ${root}`);
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end();
        return;
      }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
      const candidate = resolve(root, '.' + pathname);
      // 폴더 밖으로 나가는 경로는 거부한다.
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const file = await resolveFile(candidate);
      if (file) {
        await sendFile(res, file, method === 'HEAD');
        return;
      }
      if (pathname.startsWith('/_app/')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      await sendFile(res, indexPath, method === 'HEAD');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err));
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

async function resolveFile(candidate: string): Promise<string | null> {
  const s = await stat(candidate).catch(() => null);
  if (!s) return null;
  if (s.isFile()) return candidate;
  if (s.isDirectory()) {
    const idx = join(candidate, 'index.html');
    const is = await stat(idx).catch(() => null);
    if (is && is.isFile()) return idx;
  }
  return null;
}

async function sendFile(res: import('node:http').ServerResponse, file: string, headOnly: boolean): Promise<void> {
  const s = await stat(file);
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(s.size),
    // 비교 재현성을 위해 캐시는 끈다.
    'cache-control': 'no-store',
  });
  if (headOnly) {
    res.end();
    return;
  }
  await new Promise<void>((ok, fail) => {
    const stream = createReadStream(file);
    stream.on('error', fail);
    res.on('finish', ok);
    stream.pipe(res);
  });
}
