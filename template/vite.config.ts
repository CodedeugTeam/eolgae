import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { eolgae } from '@codedeugteam/eolgae/vite';

// eolgae() 가 outDir build/·assetsDir _app/immutable/·publicDir static/·$lib 별칭·APP_VERSION define 을 넣는다.
// 앱별로 필요한 것(server.proxy 등)만 아래에 적는다.
export default defineConfig({
  plugins: [svelte(), eolgae({ version: process.env.APP_VERSION })],
  // server: { proxy: { '/api': 'http://127.0.0.1:8080', '/ws': { target: 'ws://127.0.0.1:8080', ws: true } } },
});
