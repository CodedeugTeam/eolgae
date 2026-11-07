// Vite 플러그인 eolgae(): 결과물 규약(아키텍처 3.3)·$lib 별칭(D-4)·APP_VERSION define·자기 패키지 optimizeDeps.exclude(D-2).
// export 경로는 `@codedeugteam/eolgae/vite`. Node 에서만 실행된다.
import { resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';
import type { ServiceWorkerOptions } from './types.ts';
import { NotImplementedError } from './errors.ts';

export type { ServiceWorkerOptions };

export const PACKAGE_NAME = '@codedeugteam/eolgae';

export interface EolgaeOptions {
  /** `import.meta.env.APP_VERSION` 값. 기본 `process.env.APP_VERSION ?? 'dev'` */
  version?: string;
  /** `$lib` 별칭이 가리킬 폴더(root 기준). 기본 `'src/lib'`, `false` 면 별칭을 넣지 않는다. */
  lib?: string | false;
  /** 정적 파일 폴더. 기본 `'static'` */
  publicDir?: string;
  /** 출력 폴더. 기본 `'build'` */
  outDir?: string;
  /** 해시 자산 폴더(outDir 기준). 기본 `'_app/immutable'` */
  assetsDir?: string;
  /** 서비스 워커 매니페스트(entry-설계 3.6). 1차는 타입만 두고 값을 주면 미구현 에러를 던진다. */
  serviceWorker?: ServiceWorkerOptions;
}

export function eolgae(opts: EolgaeOptions = {}): Plugin {
  if (opts.serviceWorker !== undefined) {
    throw new NotImplementedError('serviceWorker 옵션', 'roomcast 전환 티켓에서 채운다. 옵션을 빼면 나머지는 동작한다.');
  }
  const version = opts.version ?? process.env.APP_VERSION ?? 'dev';
  const lib = opts.lib ?? 'src/lib';

  return {
    name: 'eolgae',
    config(userConfig): UserConfig {
      const root = userConfig.root ? resolve(userConfig.root) : process.cwd();
      // 설계 3.4 의 값은 「기본값」이다. 플러그인 옵션 > 앱 vite.config 에 명시한 값 > 기본값 순으로 쓴다.
      const publicDir = opts.publicDir ?? userConfig.publicDir ?? 'static';
      const outDir = opts.outDir ?? userConfig.build?.outDir ?? 'build';
      const assetsDir = opts.assetsDir ?? userConfig.build?.assetsDir ?? '_app/immutable';
      const config: UserConfig = {
        publicDir,
        build: { outDir, assetsDir },
        define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
        optimizeDeps: { exclude: [PACKAGE_NAME] },
      };
      if (lib !== false) {
        config.resolve = { alias: { $lib: resolve(root, lib) } };
      }
      return config;
    },
  };
}

export default eolgae;
