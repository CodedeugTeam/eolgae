// 테스트용 WebSocket echo 서버. 외부 의존 없이 node:http 의 Upgrade 핸드셰이크와 프레임 파싱을 최소로 구현한다.
//  - 연결되면 `{"type":"welcome","n":1}` 을 먼저 보낸다.
//  - 텍스트 프레임은 받은 그대로 돌려준다(echo). ping 에는 pong, close 에는 close 로 답한다.
//  - 바이너리 프레임은 그대로 돌려준다.
//  - 일반 HTTP 요청에는 `{ ok: true, url, headers }` JSON 을 준다(fixture SPA 의 /api/hello 용).
// RFC 6455 의 조각 프레임(FIN=0)·확장은 다루지 않는다. 테스트용 메시지는 모두 한 프레임에 들어온다.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsEchoServer {
  /** http:// 또는 https:// 주소 */
  url: string;
  /** Upgrade 요청 기록(순서대로): 경로와 헤더 */
  upgrades: Array<{ url: string; headers: Record<string, string | string[] | undefined> }>;
  /** 받은 텍스트 메시지 기록(순서대로) */
  messages: string[];
  close(): Promise<void>;
}

export interface WsEchoOptions {
  /** 주면 https 서버로 띄운다(자체 서명 인증서 테스트용) */
  tls?: { key: string | Buffer; cert: string | Buffer };
}

export async function startWsEchoServer(opts: WsEchoOptions = {}): Promise<WsEchoServer> {
  const upgrades: WsEchoServer['upgrades'] = [];
  const messages: string[] = [];
  const sockets = new Set<Duplex>();

  const handler = (req: IncomingMessage, res: import('node:http').ServerResponse) => {
    const body = JSON.stringify({ ok: true, url: req.url, user: req.headers['x-forwarded-user'] ?? null, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const server: Server = opts.tls ? createHttpsServer(opts.tls, handler) : createServer(handler);

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    upgrades.push({ url: req.url ?? '', headers: { ...req.headers } });
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'),
    );
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify({ type: 'welcome', n: 1 }))));

    let buf = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const frame = decodeFrame(buf);
        if (!frame) break;
        buf = buf.subarray(frame.consumed);
        switch (frame.opcode) {
          case 0x1: {
            const text = frame.payload.toString('utf8');
            messages.push(text);
            socket.write(encodeFrame(0x1, frame.payload));
            break;
          }
          case 0x2:
            socket.write(encodeFrame(0x2, frame.payload));
            break;
          case 0x8:
            socket.write(encodeFrame(0x8, frame.payload));
            socket.end();
            return;
          case 0x9:
            socket.write(encodeFrame(0xa, frame.payload));
            break;
          default:
            break;
        }
      }
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `${opts.tls ? 'https' : 'http'}://127.0.0.1:${port}`,
    upgrades,
    messages,
    close: () =>
      new Promise<void>((ok) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

/** 서버→클라이언트 프레임(마스크 없음, FIN=1) */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** 클라이언트→서버 프레임 하나를 읽는다. 아직 다 안 왔으면 undefined. */
export function decodeFrame(buf: Buffer): { opcode: number; payload: Buffer; consumed: number } | undefined {
  if (buf.length < 2) return undefined;
  const opcode = buf[0]! & 0x0f;
  const masked = (buf[1]! & 0x80) !== 0;
  let len = buf[1]! & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return undefined;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return undefined;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return undefined;
  const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
  }
  return { opcode, payload, consumed: offset + maskLen + len };
}
