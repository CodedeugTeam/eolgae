// 테스트용 최소 SPA. 글자 하나를 그리고 /api/hello 를 한 번 부른다.
// 파일 이름의 해시 조각(Bq7x2kLm)과 svelte-* 클래스는 빌드마다 바뀌는 값을 흉내 낸 것이다.
const app = document.getElementById('app');
const title = document.createElement('h1');
title.className = 'title svelte-7f3k9a';
title.textContent = '가';
app.appendChild(title);

const hello = document.createElement('p');
hello.className = 'hello svelte-7f3k9a';
hello.textContent = '…';
app.appendChild(hello);

const path = location.pathname;
const route = document.createElement('p');
route.className = 'route';
route.textContent = `route: ${path}`;
app.appendChild(route);

fetch('/api/hello?from=' + encodeURIComponent(path))
  .then((r) => r.json())
  .then((data) => {
    hello.textContent = `hello ${data.user ?? 'anonymous'}`;
    app.dataset.ready = '1';
  })
  .catch((err) => {
    hello.textContent = 'hello failed';
    console.error('api 실패', err);
    app.dataset.ready = '1';
  });
