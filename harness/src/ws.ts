// WebSocket 수집 훅. 이번 단계에서는 수집만 하고 비교는 하지 않는다(termcast 전환 때 채운다).
import type { Page } from 'playwright';

export type WsEventKind = 'open' | 'sent' | 'received' | 'close' | 'error';

export interface WsEvent {
  url: string;
  kind: WsEventKind;
  /** 프레임 본문. 바이너리 프레임은 base64 문자열로 담는다. */
  payload?: string;
  /** 시나리오 시작 기준 경과 시간(ms) */
  t: number;
}

/** page 에 WebSocket 리스너를 붙이고, 수집된 이벤트 배열을 돌려준다. 배열은 실행 중 계속 채워진다. */
export function attachWsCollector(page: Page, startedAt = Date.now()): WsEvent[] {
  const events: WsEvent[] = [];
  const now = () => Date.now() - startedAt;
  page.on('websocket', (ws) => {
    const url = ws.url();
    events.push({ url, kind: 'open', t: now() });
    ws.on('framesent', (frame) => {
      events.push({ url, kind: 'sent', payload: framePayload(frame.payload), t: now() });
    });
    ws.on('framereceived', (frame) => {
      events.push({ url, kind: 'received', payload: framePayload(frame.payload), t: now() });
    });
    ws.on('close', () => events.push({ url, kind: 'close', t: now() }));
    ws.on('socketerror', (err) => events.push({ url, kind: 'error', payload: String(err), t: now() }));
  });
  return events;
}

function framePayload(payload: string | Buffer): string {
  return typeof payload === 'string' ? payload : payload.toString('base64');
}
