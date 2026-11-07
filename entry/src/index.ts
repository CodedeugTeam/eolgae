// 공개 export(entry-설계 3.2). 브라우저에서 쓰는 것만 둔다. Vite 플러그인은 `@codedeugteam/eolgae/vite`.
export { page } from './page.svelte.ts';
export { goto, replaceState, invalidateAll } from './navigation.ts';
export { mount, type Mounted } from './mount.ts';
export { matchRoute, type RouteMatch } from './router.ts';
export { NotImplementedError } from './errors.ts';
export type {
  GotoOptions,
  LayoutProps,
  LoadEvent,
  MountOptions,
  Page,
  PageProps,
  RouteDefinition,
  ServiceWorkerOptions,
} from './types.ts';
