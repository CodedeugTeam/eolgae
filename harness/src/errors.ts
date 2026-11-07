// 실행 오류(시나리오 파일 로드 실패·대상 기동 실패·인자 형식 오류 등). CLI 는 이 오류를 종료 코드 2 로 옮기고 스택 없이 메시지만 보여 준다.
export class HarnessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HarnessError';
  }
}
