// sw-spa fixture 에서 "서비스 워커 미리 캐시 목록만 다른 사본" sw-spa-changed 를 만든다.
// 페이지 화면·DOM·페이지 요청은 그대로이고, install 의 cache.addAll 목록에서 /offline.txt 를 /offline.html 로 바꾼다.
// 하니스 network.serviceWorker 옵션이 이 차이를 잡는지(음성 대조) 확인하는 용도다.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'sw-spa');

export async function makeSwChanged(target: string): Promise<string> {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(src, target, { recursive: true });
  const sw = join(target, 'service-worker.js');
  const text = await readFile(sw, 'utf8');
  const changed = text.replace("'/offline.txt'", "'/offline.html'");
  if (changed === text) throw new Error('service-worker.js 에서 /offline.txt 를 찾지 못했습니다');
  await writeFile(sw, changed);
  await writeFile(join(target, 'offline.html'), '<p>offline</p>\n');
  return target;
}
