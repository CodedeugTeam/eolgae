// 서비스 워커가 있는 테스트용 최소 SPA. 글자 하나를 그리고 /data.json 을 한 번 부른 뒤 /service-worker.js 를 등록한다.
// 페이지가 보낸 요청(/data.json)은 page 이벤트로, 서비스 워커가 install 에서 보낸 요청(cache.addAll)은 context 이벤트로만 보인다.
const app = document.getElementById('app');
const title = document.createElement('h1');
title.textContent = '가';
app.appendChild(title);

fetch('/data.json')
  .then((r) => r.json())
  .then((data) => {
    const p = document.createElement('p');
    p.textContent = `data ${data.name}`;
    app.appendChild(p);
  })
  .catch((err) => console.error('data 실패', err))
  .finally(() => {
    app.dataset.ready = '1';
  });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch((err) => console.error('sw 등록 실패', err));
}
