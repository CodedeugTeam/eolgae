// fixture 는 저장소 안에서 패키지를 node_modules 심볼릭 링크로 소비한다(테스트 helper 가 만든다).
// preserveSymlinks 로 경로를 node_modules 안에 두어 실제 설치와 같은 조건(optimizeDeps 대상)으로 D-2 를 확인한다.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { eolgae } from '../../src/plugin.ts';

// 플러그인 config() 가 build.outDir 를 넣으므로 CLI --outDir 로는 바꿀 수 없다. 테스트가 딴 폴더에 빌드할 때는 이 환경 변수를 쓴다.
const outDir = process.env.EOLGAE_FIXTURE_OUTDIR;

export default defineConfig({
  plugins: [svelte(), eolgae(outDir ? { outDir } : {})],
  resolve: { preserveSymlinks: true },
  logLevel: 'warn',
});
