// 반응형 `page` 객체(runes 모듈). `$app/state` 의 page 와 같은 방식으로, 내부에서 프로퍼티를 갱신하면 읽는 쪽이 반응한다.
// 이 파일은 소비 앱의 vite-plugin-svelte 가 컴파일하므로 `$state` 를 그대로 남긴다(D-1·D-2).
import type { Page } from './types.ts';

function initialUrl(): URL {
  return typeof location !== 'undefined' ? new URL(location.href) : new URL('http://localhost/');
}

const state = $state<Page>({
  url: initialUrl(),
  params: {},
  state: {},
  data: undefined,
  route: { id: null },
  status: 200,
  error: null,
});

/** 현재 페이지 정보. 읽기 전용으로 쓴다. 갱신은 패키지 내부(`setPage`)만 한다. */
export const page: Readonly<Page> = state;

/** 패키지 내부용. 라우터가 이동을 끝낸 뒤 호출한다. 스토리·테스트에서는 `@codedeugteam/eolgae/testing` 의 `setPage` 를 쓴다. */
export function setPage(patch: Partial<Page>): void {
  if (patch.url !== undefined) state.url = patch.url;
  if (patch.params !== undefined) state.params = patch.params;
  if (patch.state !== undefined) state.state = patch.state;
  if ('data' in patch) state.data = patch.data;
  if (patch.route !== undefined) state.route = patch.route;
  if (patch.status !== undefined) state.status = patch.status;
  if ('error' in patch) state.error = patch.error ?? null;
}
