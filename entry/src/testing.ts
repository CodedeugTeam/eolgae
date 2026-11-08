// 스토리(Storybook)·단위 테스트용 진입점 `@codedeugteam/eolgae/testing`. 앱 코드에서는 쓰지 않는다.
// mount 없이 컴포넌트를 그릴 때 page 의 값을 정해 둔다(SvelteKit Storybook 의 page 목업 대신).
import { setPage as setPageInternal } from './page.svelte.ts';
import type { Page } from './types.ts';

export type PagePatch = Partial<Omit<Page, 'url'>> & { url?: URL | string };

/**
 * `page` 의 값을 바꾼다. 준 필드만 바꾸고 나머지는 그대로 둔다. `url` 은 문자열이면 현재 문서 주소 기준으로 푼다.
 * 라우터가 돌고 있으면 다음 이동이 다시 덮어쓴다.
 */
export function setPage(patch: PagePatch): void {
  const { url, ...rest } = patch;
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  setPageInternal({ ...rest, ...(url !== undefined ? { url: typeof url === 'string' ? new URL(url, base) : url } : {}) });
}
