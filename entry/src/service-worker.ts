// 서비스 워커 매니페스트(SvelteKit `$service-worker` 대체). eolgae() 플러그인의 `serviceWorker` 옵션이 켜지면 쓰인다.
// - 빌드: 메인 빌드 번들 키로 `build` 목록을 만들고, 메인 빌드가 결과물을 쓴 뒤 2차 `vite.build` 로 서비스 워커를 같은 outDir 에 낸다.
// - dev: `/<fileName>` 요청에 소스를 import 하는 한 줄을 돌려주고, 가상 모듈은 `build: []` 로 낸다(SvelteKit dev 와 같은 동작).
// Node 에서만 실행된다.
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as vite from 'vite';
import type { InlineConfig, Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { ServiceWorkerOptions } from './types.ts';

/** 서비스 워커 코드가 import 하는 가상 모듈 이름. */
export const SERVICE_WORKER_MODULE_ID = 'virtual:eolgae/service-worker';
const RESOLVED_ID = '\0' + SERVICE_WORKER_MODULE_ID;

/** Vite 8(rolldown)이면 true. Vite 7(rollup) 타입에는 `rolldownVersion` 이 없어 느슨하게 읽는다. */
const isRolldown = !!(vite as unknown as Record<string, unknown>).rolldownVersion;

const defaultFilesFilter = (file: string): boolean => !/\.DS_Store/.test(file);

export interface ResolvedServiceWorkerOptions {
  src: string | undefined;
  fileName: string;
  files: (file: string) => boolean;
}

/** 소스 경로를 root 기준으로 찾는다. `src` 를 주지 않으면 `src/service-worker.ts` → `.js` 순으로 찾는다. */
export function resolveServiceWorkerOptions(opts: ServiceWorkerOptions, root: string): ResolvedServiceWorkerOptions {
  const fileName = opts.fileName ?? 'service-worker.js';
  if (!fileName.endsWith('.js') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error(`[eolgae] serviceWorker.fileName 은 폴더 없는 .js 파일 이름이어야 합니다: ${fileName}`);
  }
  const candidates = opts.src ? [opts.src] : ['src/service-worker.ts', 'src/service-worker.js'];
  const src = candidates.map((c) => resolve(root, c)).find((p) => existsSync(p));
  return { src, fileName, files: opts.files ?? defaultFilesFilter };
}

/** publicDir 를 재귀로 읽어 `/` 구분 상대 경로를 정렬해 돌려준다. 폴더가 없거나 꺼져 있으면 빈 목록. */
export function listStaticFiles(publicDir: string | false, filter: (file: string) => boolean): string[] {
  if (!publicDir || !existsSync(publicDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(publicDir, full).split(sep).join('/'));
    }
  };
  walk(publicDir);
  return out.filter(filter).sort();
}

/**
 * 메인 빌드 번들 키에서 서비스 워커가 캐시할 `build` 목록을 고른다.
 * SvelteKit 은 client manifest 의 file·css·assets 를 모은다. 번들 키에는 그 밖에 HTML 진입(index.html)·sourcemap·
 * `.vite/` manifest 가 섞이므로 뺀다.
 */
export function selectBuildFiles(bundleKeys: Iterable<string>): string[] {
  return [...bundleKeys].filter((key) => !key.endsWith('.html') && !key.endsWith('.map') && !key.startsWith('.vite/')).sort();
}

/** 가상 모듈 본문. 경로 앞에는 Vite `base`(기본 `/`)를 붙인다. */
export function createServiceWorkerModule(input: { base: string; build: string[]; files: string[]; version: string; dev: boolean }): string {
  const list = (items: string[]): string => `[${items.map((f) => JSON.stringify(input.base + f)).join(', ')}]`;
  const guard = input.dev
    ? `if (typeof self === 'undefined' || typeof ServiceWorkerGlobalScope === 'undefined' || !(self instanceof ServiceWorkerGlobalScope)) {\n  throw new Error('${SERVICE_WORKER_MODULE_ID} 는 서비스 워커 안에서만 import 할 수 있습니다');\n}\n`
    : '';
  return `${guard}export const build = ${list(input.build)};\nexport const files = ${list(input.files)};\nexport const version = ${JSON.stringify(input.version)};\n`;
}

/**
 * `vite build` 의 앱 빌드인지 본다. Storybook(`iframe.html` 입력)·라이브러리·SSR 빌드와 dev·vitest(serve)에서는
 * 서비스 워커를 빌드하지 않는다. 입력이 없거나(Vite 기본 index.html) root 의 index.html 하나일 때만 true.
 */
export function isAppBuild(config: Pick<ResolvedConfig, 'command' | 'root' | 'build'>): boolean {
  if (config.command !== 'build') return false;
  const build = config.build as unknown as Record<string, unknown>;
  if (build.ssr || build.lib) return false;
  const bundler = (build.rolldownOptions ?? build.rollupOptions) as { input?: unknown } | undefined;
  const input = bundler?.input;
  if (input === undefined) return true;
  const inputs = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input as Record<string, unknown>);
  const indexHtml = resolve(config.root, 'index.html');
  return inputs.length === 1 && typeof inputs[0] === 'string' && resolve(config.root, inputs[0]) === indexHtml;
}

/** 사용자 alias(객체·배열 두 꼴)를 배열 꼴로 바꾼다. */
export type AliasEntry = { find: string | RegExp; replacement: string };
export function toAliasArray(alias: unknown): AliasEntry[] {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias as AliasEntry[];
  return Object.entries(alias as Record<string, string>).map(([find, replacement]) => ({ find, replacement }));
}

export interface ServiceWorkerPluginInput {
  options: ServiceWorkerOptions;
  version: string;
  /** 플러그인 config() 훅이 정한 사용자 alias + `$lib`. 2차 빌드에 그대로 넘긴다. */
  getAlias: () => AliasEntry[];
}

/** `serviceWorker` 옵션이 켜졌을 때 eolgae() 가 함께 돌려주는 플러그인. */
export function serviceWorkerPlugin(input: ServiceWorkerPluginInput): Plugin {
  let config: ResolvedConfig;
  let resolved: ResolvedServiceWorkerOptions;
  let enabled = false;
  let buildFiles: string[] = [];

  const staticFiles = (): string[] => listStaticFiles(config.publicDir, resolved.files);

  return {
    name: 'eolgae:service-worker',
    configResolved(c) {
      config = c;
      resolved = resolveServiceWorkerOptions(input.options, c.root);
      enabled = isAppBuild(c);
      if (enabled && !resolved.src) {
        throw new Error(`[eolgae] serviceWorker 소스를 찾지 못했습니다: ${input.options.src ?? 'src/service-worker.ts'}`);
      }
    },
    resolveId(id) {
      if (id === SERVICE_WORKER_MODULE_ID) return RESOLVED_ID;
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      if (config.command === 'serve') {
        return createServiceWorkerModule({ base: config.base, build: [], files: staticFiles(), version: input.version, dev: true });
      }
      throw new Error(`[eolgae] ${SERVICE_WORKER_MODULE_ID} 는 서비스 워커 소스에서만 import 할 수 있습니다`);
    },
    configureServer(server: ViteDevServer) {
      // SvelteKit dev 와 같게: `/<fileName>` 에 소스를 import 하는 한 줄을 돌려준다(모듈 워커로 등록해야 한다).
      const path = config.base + resolved.fileName;
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== path) return next();
        if (!resolved.src) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/javascript');
        res.end(`import '${config.base}@fs${resolved.src.startsWith('/') ? '' : '/'}${vite.normalizePath(resolved.src)}';`);
      });
    },
    generateBundle(_, bundle) {
      if (!enabled) return;
      buildFiles = selectBuildFiles(Object.keys(bundle));
    },
    writeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!enabled || !resolved.src) return;
        await buildServiceWorker({ config, src: resolved.src, fileName: resolved.fileName, alias: input.getAlias(), code: createServiceWorkerModule({ base: config.base, build: buildFiles, files: staticFiles(), version: input.version, dev: false }) });
      },
    },
  };
}

/**
 * 2차 빌드. SvelteKit `build_service_worker.js` 와 같은 설정을 쓴다.
 * 자산 이름은 메인 빌드와 같은 패턴(assetsDir·assetFileNames)을 줘서, 앱과 서비스 워커가 함께 쓰는 자산(wasm 등)이
 * 같은 파일 이름으로 겹쳐 쓰여 한 벌만 남게 한다. 그래야 그 자산이 `build` 목록에 들어 오프라인에서도 캐시로 풀린다.
 */
async function buildServiceWorker(input: { config: ResolvedConfig; src: string; fileName: string; alias: AliasEntry[]; code: string }): Promise<void> {
  const { config } = input;
  const mainBuild = config.build as unknown as Record<string, unknown>;
  const mainOutput = ((mainBuild.rolldownOptions ?? mainBuild.rollupOptions) as { output?: unknown } | undefined)?.output;
  const mainAssetFileNames = mainOutput && !Array.isArray(mainOutput) ? (mainOutput as { assetFileNames?: unknown }).assetFileNames : undefined;
  const outDir = resolve(config.root, config.build.outDir);
  // Vite 7(rollup)은 .js 진입에 esbuild 가 export 를 잘못 넣는 문제가 있어 .mjs 로 낸 뒤 이름을 바꾼다(SvelteKit 과 같다).
  const emitName = isRolldown ? input.fileName : input.fileName.replace(/\.js$/, '.mjs');

  const virtualModule: Plugin = {
    name: 'eolgae:service-worker-manifest',
    resolveId(id) {
      return id === SERVICE_WORKER_MODULE_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? input.code : undefined;
    },
  };

  const swConfig: InlineConfig = {
    root: config.root,
    mode: config.mode,
    base: config.base,
    configFile: false,
    publicDir: false,
    logLevel: config.logLevel,
    define: config.define,
    plugins: [virtualModule],
    resolve: { alias: input.alias },
    build: {
      outDir,
      emptyOutDir: false,
      assetsDir: config.build.assetsDir,
      assetsInlineLimit: config.build.assetsInlineLimit,
      modulePreload: false,
      minify: config.build.minify,
      copyPublicDir: false,
      rollupOptions: {
        input: { 'service-worker': input.src },
        output: {
          entryFileNames: emitName,
          ...(mainAssetFileNames !== undefined ? { assetFileNames: mainAssetFileNames } : {}),
          // 서비스 워커 안의 import() 는 HTML 명세상 금지라 동적 import 를 한 파일로 인라인한다(두 축 같은 꼴).
          // SvelteKit 은 Vite 8 에서 청크를 따로 내 서비스 워커가 실행 중 실패한다. 이 설정은 2차 빌드에만 들어간다.
          ...(isRolldown ? { codeSplitting: false } : { inlineDynamicImports: true }),
        },
      } as NonNullable<InlineConfig['build']>['rollupOptions'],
    },
    experimental: {
      // 서비스 워커 안에서 `location` 은 서비스 워커 자신의 주소다. SvelteKit 과 같게 자산 URL 을 그 기준 절대 경로로 만든다.
      renderBuiltUrl(filename) {
        return { runtime: `new URL(${JSON.stringify(filename)}, location.href).pathname` };
      },
    },
  };

  await vite.build(swConfig);
  if (!isRolldown) renameSync(join(outDir, emitName), join(outDir, input.fileName));
}
