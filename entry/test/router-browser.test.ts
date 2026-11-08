// 빌드한 fixture 를 Chromium 에서 돌려 load·replaceState·page.state·invalidateAll·얕은/깊은 popstate·오류 화면을 확인한다.
// load 요청은 /data/items.json 하나라 그 요청 수로 load 가 몇 번 돌았는지 센다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { buildFixture } from './helpers/fixture.ts';
import { startStaticServer } from './helpers/static-server.ts';

interface Probe {
  loads: () => number;
  documents: string[];
  errors: string[];
}

function probe(page: Page): Probe {
  let loads = 0;
  const documents: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname === '/data/items.json') loads++;
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents.push(pathname);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return { loads: () => loads, documents, errors };
}

const text = (page: Page, testId: string) => page.textContent(`[data-testid="${testId}"]`);
const path = (page: Page) => page.evaluate(() => location.pathname + location.search + location.hash);
// 빈 앵커 주석(<!---->)의 개수·위치는 레이아웃 구조에 달려 있어 비교에서 뺀다.
const mainHtml = (page: Page) => page.locator('main').evaluate((m) => m.innerHTML.replaceAll('<!---->', '').trim());

test('브라우저: load·replaceState·page.state·invalidateAll·popstate·오류 화면', { timeout: 180_000 }, async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'eolgae-router-browser-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const build = await buildFixture('router-browser', join(tmp, 'build'));
  const server = await startStaticServer(build);
  t.after(() => server.close());
  const browser = await chromium.launch();
  t.after(() => browser.close());

  await t.test('목록 필터(replaceState) → 상세 → 뒤로가기: 목록 load 가 다시 돌고 필터가 page.state 로 복원된다', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    assert.equal(p.loads(), 1);
    assert.equal(await text(page, 'state'), '{}', '시작 page.state 는 빈 객체');
    assert.equal(await text(page, 'count'), '3');

    await page.fill('[data-testid="filter"]', 'b');
    assert.equal(await text(page, 'count'), '2');
    assert.equal(await path(page), '/items?q=b');
    assert.equal(await text(page, 'page-url'), '/items', 'replaceState 는 page.url 을 바꾸지 않는다');
    assert.equal(p.loads(), 1, 'replaceState 는 load 를 부르지 않는다');

    await page.click('text=banana');
    await page.waitForSelector('[data-page="item-detail"]');
    assert.equal(await path(page), '/items/2');
    assert.equal(p.loads(), 2);

    await page.goBack();
    await page.waitForSelector('[data-page="items"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '2');
    assert.equal(p.loads(), 3, '깊은 popstate 는 load 를 다시 돌린다');
    assert.equal(await page.inputValue('[data-testid="filter"]'), 'b');
    assert.equal(await text(page, 'state'), '{"filter":"b"}');
    assert.equal(await path(page), '/items?q=b');
    assert.deepEqual(p.documents, ['/items'], '전체 이동 없음');
    assert.deepEqual(p.errors, []);
    await page.close();
  });

  await t.test('invalidateAll: load 를 한 번 다시 돌리고 page.state 를 비운다(필터는 page.url 기준으로 돌아간다)', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    await page.fill('[data-testid="filter"]', 'apple');
    assert.equal(await text(page, 'count'), '1');
    await page.click('[data-testid="reload-data"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="state"]')?.textContent === '{}');
    assert.equal(p.loads(), 2);
    assert.equal(await text(page, 'count'), '3', '옛 SvelteKit 빌드 실측과 같게 필터가 풀린다');
    assert.equal(await path(page), '/items?q=apple', '주소창은 그대로');
    assert.deepEqual(p.errors, []);
    await page.close();
  });

  await t.test('새로고침은 page.state 를 되살리지 않고 주소(쿼리)로 다시 그린다', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    await page.fill('[data-testid="filter"]', 'blue');
    await page.reload();
    await page.waitForSelector('[data-page="items"]');
    assert.equal(await text(page, 'state'), '{}');
    assert.equal(await page.inputValue('[data-testid="filter"]'), 'blue', 'URL 쿼리 q 로 복원');
    assert.equal(await text(page, 'count'), '1');
    assert.equal(p.loads(), 2);
    assert.deepEqual(p.errors, []);
    await page.close();
  });

  await t.test('새로고침 뒤 /items?q=… 와 다른 state 가 history 에 있어도 주소 쿼리로 그리고, 상세 → 뒤로가기에서도 되살아나지 않는다', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    await page.fill('[data-testid="filter"]', 'apple');
    // 주소만 q=blue 로 바꾸고 history 항목의 state 는 apple 로 남긴다(필터를 바꾸고 다시 바꾼 뒤 주소만 남은 상황).
    await page.evaluate(() => history.replaceState(history.state, '', '/items?q=blue'));
    await page.reload();
    await page.waitForSelector('[data-page="items"]');
    assert.equal(await text(page, 'state'), '{}');
    assert.equal(await page.inputValue('[data-testid="filter"]'), 'blue');
    assert.equal(await text(page, 'count'), '1');
    assert.deepEqual(await page.evaluate(() => history.state?.state), {}, 'history 항목의 state 도 버린다');
    await page.click('text=blueberry');
    await page.waitForSelector('[data-page="item-detail"]');
    await page.goBack();
    await page.waitForSelector('[data-page="items"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="count"]')?.textContent === '1');
    assert.equal(await text(page, 'state'), '{}');
    assert.equal(await page.inputValue('[data-testid="filter"]'), 'blue', '앞 문서의 apple 이 아니라 주소 쿼리');
    assert.deepEqual(p.errors, []);
    await page.close();
  });

  await t.test('해시 링크와 그 뒤로가기는 load 를 돌리지 않는다(얕은 이동)', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    await page.click('text=apple');
    await page.waitForSelector('[data-page="item-detail"]');
    assert.equal(p.loads(), 2);
    await page.click('[data-testid="hash-link"]');
    await page.waitForFunction(() => location.hash === '#part');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '');
    await page.goForward();
    await page.waitForFunction(() => location.hash === '#part');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '');
    // popstate 처리가 비동기로 남아 있으면 요청이 늦게 나갈 수 있어 잠깐 기다린다.
    await page.waitForTimeout(200);
    assert.equal(p.loads(), 2, '해시 이동·뒤로가기·앞으로가기 모두 load 없음');
    assert.equal(await page.textContent('[data-page="item-detail"]'), 'apple');
    assert.deepEqual(p.errors, []);
    await page.close();
  });

  await t.test('오류 화면: error(400) 은 그 status·message, 일반 Error 는 500 Internal Error(콘솔에 남김), 이동 중 오류는 주소를 바꾼다', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/items/abc`);
    await page.waitForSelector('main h1');
    assert.equal(await mainHtml(page), '<h1>400</h1> <p>Invalid item id</p>');
    assert.deepEqual(p.errors, [], 'error() 는 콘솔에 남기지 않는다');

    await page.goto(`${server.url}/items/999`);
    await page.waitForSelector('main h1');
    assert.equal(await mainHtml(page), '<h1>500</h1> <p>Internal Error</p>');
    assert.equal(p.errors.length, 1);
    assert.match(p.errors[0]!, /item 999 not found/);

    await page.goto(`${server.url}/items`);
    await page.waitForSelector('[data-page="items"]');
    await page.click('[data-testid="bad-link"]');
    await page.waitForFunction(() => location.pathname === '/items/abc');
    await page.waitForSelector('main h1:text("400")');
    assert.equal(await text(page, 'route-id'), '/items/:id');
    await page.goBack();
    await page.waitForSelector('[data-page="items"]');
    await page.close();
  });

  await t.test('load 없는 라우트는 그대로: 링크 이동·뒤로가기, 전체 이동 없음', async () => {
    const page = await browser.newPage();
    const p = probe(page);
    await page.goto(`${server.url}/`);
    await page.waitForSelector('[data-page="home"]');
    await page.click('[data-testid="nav-about"]');
    await page.waitForSelector('[data-page="about"]');
    await page.click('[data-testid="nav-items"]');
    await page.waitForSelector('[data-page="items"]');
    await page.goBack();
    await page.waitForSelector('[data-page="about"]');
    await page.goBack();
    await page.waitForSelector('[data-page="home"]');
    assert.deepEqual(p.documents, ['/']);
    assert.equal(p.loads(), 1, '목록에 한 번 들렀을 때만 load');
    assert.deepEqual(p.errors, []);
    await page.close();
  });
});
