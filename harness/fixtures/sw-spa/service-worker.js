// 테스트용 서비스 워커. install 에서 앱 셸 자산을 미리 캐시하고, activate 에서 바로 페이지를 맡는다.
// 이 목록이 옛·새 빌드에서 같은지가 하니스 network.serviceWorker 옵션의 비교 대상이다.
const CACHE = 'eolgae-fixture-shell';
const PRECACHE = ['/', '/_app/immutable/entry/app.Sw7kQ2xP.js', '/manifest.webmanifest', '/icon.svg', '/offline.txt'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
