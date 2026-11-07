// 브라우저 테스트용 정적 서버. 서빙 폴더를 도중에 바꿀 수 있어 「새 버전 배포」를 흉내 낸다.
// 파일이 없고 확장자도 없는 경로는 index.html 로 폴백한다(nginx try_files 와 같은 꼴).
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};

export interface StaticServer {
  url: string;
  setRoot(root: string): void;
  close(): Promise<void>;
}

export async function startStaticServer(root: string): Promise<StaticServer> {
  let current = root;
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = normalize(join(current, path === '/' ? 'index.html' : path));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      if (extname(path)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-cache' });
      res.end(await readFile(join(current, 'index.html')));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('주소를 얻지 못했다');
  return {
    url: `http://127.0.0.1:${address.port}`,
    setRoot: (next) => (current = next),
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
