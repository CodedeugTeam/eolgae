// 레이아웃·페이지 컴포넌트에 넘기는 반응형 prop 묶음(runes 모듈).
// Svelte 5 `mount(Component, { props })` 에 `$state` 객체를 넘기면 필드 갱신이 그대로 컴포넌트에 반영된다.
// `$state()` 는 변수 선언의 초기값 자리에서만 쓸 수 있어 바로 return 하지 않고 변수에 받는다.
import type { LayoutProps, PageProps } from './types.ts';

export function createLayoutProps(initial: LayoutProps): LayoutProps {
  const props = $state<LayoutProps>(initial);
  return props;
}

export function createPageProps(initial: PageProps): PageProps {
  const props = $state<PageProps>(initial);
  return props;
}
