// 앱 진입점. 라우트 표와 mount() 만 적는다. 라우트 추가는 이 표에 한 줄 더하면 된다.
import { mount, type RouteDefinition } from '@codedeugteam/eolgae';
import Layout from './Layout.svelte';
import Home from './routes/Home.svelte';
import NotFound from './routes/NotFound.svelte';

const routes: RouteDefinition[] = [
  { path: '/', component: Home },
  // { path: '/project/:id', component: Project },   // :param 매칭·page.params 는 뒤 티켓에서 켠다
  { path: '*', component: NotFound },               // 라우트 표에 없는 경로로 직접 진입했을 때 보일 화면
];

mount(routes, document.getElementById('app')!, { layout: Layout });
