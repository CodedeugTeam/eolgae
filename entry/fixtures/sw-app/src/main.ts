// 앱 쪽: 버전·wasm 주소를 화면에 쓰고, SvelteKit 과 같은 시점(load)·꼴(type: 'module')로 서비스 워커를 등록한다.
import './app.css';
import { payloadUrl } from './lib/payload.ts';

const app = document.querySelector('#app')!;
app.innerHTML = `<p data-testid="version">v${import.meta.env.APP_VERSION}</p><p data-testid="payload">${payloadUrl}</p>`;

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
  });
}
