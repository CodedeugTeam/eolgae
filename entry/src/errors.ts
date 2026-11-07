// 미구현 기능을 호출했을 때 던지는 에러. 1차(termcast) 범위 밖 기능은 타입·자리만 있고 이 에러를 낸다.
export class NotImplementedError extends Error {
  readonly feature: string;
  constructor(feature: string, hint?: string) {
    super(`[eolgae] ${feature} 은(는) 아직 구현되지 않았습니다(1차 범위 밖).${hint ? ' ' + hint : ''}`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
