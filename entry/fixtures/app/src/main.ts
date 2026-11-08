import { mount, type RouteDefinition } from '@codedeugteam/eolgae';
import Layout from './Layout.svelte';
import Home from './pages/Home.svelte';
import About from './pages/About.svelte';
import NotFound from './pages/NotFound.svelte';
import Items from './pages/Items.svelte';
import ItemDetail from './pages/ItemDetail.svelte';
import ErrorPage from './pages/ErrorPage.svelte';
import { detailLoad, listLoad } from './items.ts';

declare global {
  interface Window {
    __eolgaeBoots?: number;
  }
}
// 전체 이동(새 문서 로드)이 일어났는지 세기 위한 표식. SPA 이동이면 1 에 머무른다.
window.__eolgaeBoots = (window.__eolgaeBoots ?? 0) + 1;

const routes: RouteDefinition[] = [
  { path: '/', component: Home },
  { path: '/about', component: About },
  // load 를 쓰는 라우트. 위 두 라우트는 load 가 없다(v0.3.0 과 같은 동작을 확인하는 쪽).
  { path: '/items', component: Items, load: listLoad },
  { path: '/items/:id', component: ItemDetail, load: detailLoad },
  { path: '*', component: NotFound },
];

mount(routes, document.getElementById('app')!, { layout: Layout, error: ErrorPage });
