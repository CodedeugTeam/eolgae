// 회귀 비교용 보고서 정규화. 실행마다 바뀌는 값(생성 시각·소요 시간·임시 경로·포트)만 고정 문자열로 바꾼다.
// 골든 파일(harness/test/golden/*)은 서비스 워커 수집을 넣기 전 하니스로 만든 보고서이며, 옵션을 켜지 않은 실행이
// 그때와 같은 보고서·종료 코드·네트워크 축 판정을 내는지 이 정규화를 거쳐 비교한다.
export interface GoldenPaths {
  /** 실행에 쓴 값 → 바꿔 넣을 이름 */
  [actual: string]: string;
}

export function normalizeReportJson(json: string, paths: GoldenPaths): string {
  const report = JSON.parse(replacePaths(json, paths)) as {
    createdAt: string;
    scenarios: { durationMs?: { old: number; new: number } }[];
  };
  report.createdAt = '<createdAt>';
  for (const s of report.scenarios) {
    if (s.durationMs) s.durationMs = { old: 0, new: 0 };
  }
  return JSON.stringify(report, null, 2) + '\n';
}

export function normalizeReportMd(md: string, paths: GoldenPaths): string {
  return replacePaths(md, paths).replace(/^- 생성: .*$/m, '- 생성: <createdAt>');
}

function replacePaths(text: string, paths: GoldenPaths): string {
  let out = text;
  // 긴 값부터 바꿔 접두어가 겹치는 경로가 먼저 잘리지 않게 한다.
  for (const actual of Object.keys(paths).sort((a, b) => b.length - a.length)) {
    out = out.replaceAll(actual, paths[actual]!);
  }
  return out;
}
