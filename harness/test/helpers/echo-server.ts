// 테스트용 echo 백엔드. 받은 메서드·경로·헤더를 JSON 으로 돌려준다.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface EchoServer {
  url: string;
  /** 받은 요청 기록(순서대로) */
  received: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined> }>;
  close(): Promise<void>;
}

export async function startEchoServer(): Promise<EchoServer> {
  const received: EchoServer['received'] = [];
  const server = createServer((req, res) => {
    const headers = { ...req.headers };
    received.push({ method: req.method ?? '', url: req.url ?? '', headers });
    const body = JSON.stringify({
      ok: true,
      method: req.method,
      url: req.url,
      user: headers['x-forwarded-user'] ?? null,
      headers,
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
