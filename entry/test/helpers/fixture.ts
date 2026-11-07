// entry fixture 앱을 빌드·기동하는 공용 helper. 세 테스트(build·harness·dev)가 같이 쓴다.
import { access, mkdir, rm, symlink, readlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');
export const fixtureRoot = join(repoRoot, 'entry', 'fixtures', 'app');
export const fixtureBuildDir = join(fixtureRoot, 'build');
export const fixtureSpec = join(repoRoot, 'entry', 'fixtures', 'app.spec.ts');

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function runNode(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${args.join(' ')} 종료 ${code}\n${out}`))));
  });
}

/** dist/entry 가 없으면 tsc 로 만든다(`npm run build` 를 먼저 돌렸으면 건너뜀). */
export async function ensureEntryDist(): Promise<void> {
  if (await exists(join(repoRoot, 'dist', 'entry', 'index.js'))) return;
  await runNode([join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.entry.json'], repoRoot);
}

/**
 * fixture 가 패키지를 실제 설치처럼 `node_modules/@codedeugteam/eolgae` 로 소비하도록 저장소 루트를 가리키는
 * 심볼릭 링크를 만든다. 이미 있으면 그대로 둔다. (.gitignore 에 올라 있다)
 */
export async function ensureFixtureLink(): Promise<void> {
  const scope = join(fixtureRoot, 'node_modules', '@codedeugteam');
  const link = join(scope, 'eolgae');
  const want = relative(scope, repoRoot);
  await mkdir(scope, { recursive: true });
  const current = await readlink(link).catch(() => null);
  if (current === want) return;
  if (current !== null) await rm(link, { recursive: true, force: true });
  try {
    await symlink(want, link, 'dir');
  } catch (err) {
    // 테스트 파일이 병렬 프로세스로 돌아 동시에 만들 수 있다. 다른 쪽이 먼저 만들었으면 그대로 쓴다.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || (await readlink(link).catch(() => null)) !== want) throw err;
  }
}

/**
 * fixture 를 `vite build` 한다. 기본은 플러그인 기본값대로 fixture 안 build/ 에 내고, 결과 폴더를 비우고 새로 만든다.
 * 테스트 파일은 병렬 프로세스로 돌므로, 결과물 규약을 확인하는 테스트 하나만 기본 폴더를 쓰고 나머지는 `outDir` 로 딴 폴더를 준다.
 */
export async function buildFixture(version = 'fixture-test', outDir = fixtureBuildDir): Promise<string> {
  await ensureEntryDist();
  await ensureFixtureLink();
  await rm(outDir, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { APP_VERSION: version };
  if (outDir !== fixtureBuildDir) env.EOLGAE_FIXTURE_OUTDIR = outDir;
  await runNode([join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', fixtureRoot], repoRoot, env);
  return outDir;
}
