// Vite 플러그인 eolgae(): 결과물 규약(아키텍처 3.3)·$lib 별칭(D-4)·APP_VERSION define·자기 패키지 optimizeDeps.exclude(D-2),
// 그리고 `serviceWorker` 옵션을 주면 서비스 워커 매니페스트(설계 3.6)를 더한다.
// export 경로는 `@codedeugteam/eolgae/vite`. Node 에서만 실행된다.
import { resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';
import type { ServiceWorkerOptions } from './types.ts';
import { serviceWorkerPlugin, toAliasArray, SERVICE_WORKER_MODULE_ID, type AliasEntry } from './service-worker.ts';

export type { ServiceWorkerOptions };
export { SERVICE_WORKER_MODULE_ID };

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
  /**
   * 서비스 워커 매니페스트(entry-설계 3.6). 주면 `vite build` 가 서비스 워커를 outDir 에 함께 내고,
   * 가상 모듈 `virtual:eolgae/service-worker` 가 `build`·`files`·`version` 을 내보낸다. 등록은 앱이 한다.
   */
  serviceWorker?: ServiceWorkerOptions;
}

export function eolgae(opts: EolgaeOptions = {}): Plugin {
  const version = opts.version ?? process.env.APP_VERSION ?? 'dev';
  const lib = opts.lib ?? 'src/lib';
  let alias: AliasEntry[] = [];

  const main: Plugin = {
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
      // 서비스 워커 2차 빌드에 넘길 alias: 앱이 적은 alias + `$lib`.
      const userAlias = toAliasArray(userConfig.resolve?.alias);
      alias = lib !== false ? [...userAlias, { find: '$lib', replacement: resolve(root, lib) }] : userAlias;
      return config;
    },
  };
  if (opts.serviceWorker === undefined) return main;
  // 서비스 워커 훅(configResolved·resolveId·load·configureServer·generateBundle·writeBundle)을 같은 플러그인에 얹는다.
  // 메인 플러그인은 config 훅만 있어 겹치는 훅이 없다. 반환 꼴은 v0.2.0 과 같은 Plugin 하나다.
  const sw = serviceWorkerPlugin({ options: opts.serviceWorker, version, getAlias: () => alias });
  return { ...sw, ...main };
}

export default eolgae;
