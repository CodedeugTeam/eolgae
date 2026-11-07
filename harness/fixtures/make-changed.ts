// spa fixture 에서 "DOM 한 글자 다른 사본" spa-changed 를 만든다.
// 자산 해시와 svelte 클래스 해시도 함께 바꿔, 정규화가 그 차이를 지우고 글자 차이만 남기는지 확인할 수 있게 한다.
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'spa');
const dst = join(here, 'spa-changed');

export async function makeChanged(target = dst): Promise<string> {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(src, target, { recursive: true });

  const oldJs = join(target, '_app/immutable/entry/app.Bq7x2kLm.js');
  const newJs = join(target, '_app/immutable/entry/app.Zz9yXw1Q.js');
  let js = await readFile(oldJs, 'utf8');
  js = js.replaceAll('svelte-7f3k9a', 'svelte-p0q1r2').replace("title.textContent = '가';", "title.textContent = '나';");
  await writeFile(newJs, js);
  await rm(oldJs);

  const oldCss = join(target, '_app/immutable/assets/0.Dk3pQ9aa.css');
  await rename(oldCss, join(target, '_app/immutable/assets/0.Hh5sTt2b.css'));

  const indexPath = join(target, 'index.html');
  let html = await readFile(indexPath, 'utf8');
  html = html
    .replaceAll('app.Bq7x2kLm.js', 'app.Zz9yXw1Q.js')
    .replaceAll('0.Dk3pQ9aa.css', '0.Hh5sTt2b.css')
    .replaceAll('svelte-7f3k9a', 'svelte-p0q1r2')
    .replace('__sveltekit_1a2b3c4', '__sveltekit_9z8y7x6');
  await writeFile(indexPath, html);
  return target;
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  makeChanged().then((p) => console.log(`생성: ${p}`));
}
