// 서비스 워커 fixture. eolgae({ serviceWorker }) 로 빌드하면 build/service-worker.js 가 함께 나온다.
// 앱과 서비스 워커가 같은 wasm(src/lib/payload.wasm)을 `new URL(..., import.meta.url)` 로 가져와, 2차 빌드가 자산을 한 벌만 남기는지 본다.
import { defineConfig } from 'vite';
import { eolgae } from '../../src/plugin.ts';

// 테스트가 딴 폴더에 빌드할 때 쓰는 환경 변수(entry/fixtures/app 과 같은 방식).
const outDir = process.env.EOLGAE_FIXTURE_OUTDIR;
// Storybook 처럼 index.html 이 아닌 HTML 을 입력으로 빌드하는 경우를 흉내 낸다(서비스 워커를 빌드하지 않아야 한다).
const input = process.env.EOLGAE_FIXTURE_INPUT;

export default defineConfig({
  plugins: [eolgae({ ...(outDir ? { outDir } : {}), serviceWorker: {} })],
  ...(input ? { build: { rollupOptions: { input } } } : {}),
  logLevel: 'warn',
});
