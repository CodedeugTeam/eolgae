// 미구현 기능을 호출했을 때 던지는 에러. 1차(termcast) 범위 밖 기능은 타입·자리만 있고 에러를 낸다.
export class NotImplementedError extends Error {
  readonly feature: string;
  constructor(feature: string, hint?: string) {
    super(`[eolgae] ${feature} 은(는) 아직 구현되지 않았습니다(1차 범위 밖).${hint ? ' ' + hint : ''}`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}

/** `page.error` 의 모양. SvelteKit `App.Error` 의 기본 꼴과 같다. */
export interface PageError {
  message: string;
  [key: string]: unknown;
}

/**
 * load 가 의도해서 던지는 HTTP 오류. `error(status, body)` 가 만든다. SvelteKit `HttpError` 와 같은 모양이며,
 * 이 오류면 `page.status`·`page.error` 에 그대로 실리고 콘솔에 남기지 않는다. 그 밖의 오류는 500 `Internal Error` 가 된다.
 */
export class HttpError {
  readonly status: number;
  readonly body: PageError;
  constructor(status: number, body?: string | PageError) {
    this.status = status;
    if (typeof body === 'string') this.body = { message: body };
    else if (body) this.body = body;
    else this.body = { message: `Error: ${status}` };
  }
  toString(): string {
    return JSON.stringify(this.body);
  }
}

/** load 안에서 HTTP 오류를 던진다(SvelteKit `error()` 와 같음). status 는 400~599. */
export function error(status: number, body?: string | PageError): never {
  if (Number.isNaN(status) || status < 400 || status > 599) {
    throw new Error(`[eolgae] HTTP 오류 상태 코드는 400~599 여야 합니다: ${status}`);
  }
  throw new HttpError(status, body);
}
