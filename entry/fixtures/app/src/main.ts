import { mount, type RouteDefinition } from '@codedeugteam/eolgae';
import Layout from './Layout.svelte';
import Home from './pages/Home.svelte';
import About from './pages/About.svelte';
import NotFound from './pages/NotFound.svelte';

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
  { path: '*', component: NotFound },
];

mount(routes, document.getElementById('app')!, { layout: Layout });
