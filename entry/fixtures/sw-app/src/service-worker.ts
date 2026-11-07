/// <reference types="@codedeugteam/eolgae/service-worker" />
/// <reference lib="webworker" />
// fixture 서비스 워커. roomcast 서비스 워커와 같은 꼴: install 에서 build+files+'/' 를 캐시하고 skipWaiting 은 하지 않는다.
// SKIP_WAITING 메시지를 받으면 넘겨받는다. INFO 메시지에는 가상 모듈 값과 wasm 주소를 돌려준다(테스트가 읽는다).
import { build, files, version } from 'virtual:eolgae/service-worker';
import { payloadUrl } from '$lib/payload.ts';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `fixture-shell-${version}`;
const SHELL = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...SHELL, '/'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
  if (event.data?.type === 'INFO') event.ports[0]?.postMessage({ build, files, version, payloadUrl });
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/')) ?? Response.error()));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
  }
});
