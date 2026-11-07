/// <reference types="@codedeugteam/eolgae/service-worker" />
/// <reference lib="webworker" />
// 동적 import 를 쓰는 서비스 워커. 서비스 워커 안 import() 는 명세상 금지라 플러그인이 두 축 모두 한 파일로 인라인해야 동작한다.
import { build, version } from 'virtual:eolgae/service-worker';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'INFO') return;
  const { lazyValue } = await import('./lib/lazy.ts');
  event.ports[0]?.postMessage({ build, version, lazyValue });
});
