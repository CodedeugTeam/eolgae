import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareConsole, compareDom, compareNetwork, compareScreenshots } from '../src/compare.ts';

function solidPng(width: number, height: number, rgb: [number, number, number], dots: Array<[number, number]> = []): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  for (const [x, y] of dots) {
    const i = (y * width + x) * 4;
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
  }
  return PNG.sync.write(png);
}

test('네트워크 비교: 같은 순서면 equal', () => {
  const a = [
    { method: 'GET', path: '/api/a', status: 200 },
    { method: 'POST', path: '/api/b', status: 201 },
  ];
  const r = compareNetwork(a, [...a]);
  assert.equal(r.equal, true);
  assert.equal(r.firstDiffIndex, undefined);
});

test('네트워크 비교: 순서가 바뀌면 처음 어긋난 위치를 알려준다', () => {
  const a = [
    { method: 'GET', path: '/api/a', status: 200 },
    { method: 'POST', path: '/api/b', status: 201 },
  ];
  const b = [a[1]!, a[0]!];
  const r = compareNetwork(a, b);
  assert.equal(r.equal, false);
  assert.equal(r.firstDiffIndex, 0);
});

test('네트워크 비교: 상태 코드가 다르거나 한쪽이 더 길면 다름', () => {
  const a = [{ method: 'GET', path: '/api/a', status: 200 }];
  assert.equal(compareNetwork(a, [{ method: 'GET', path: '/api/a', status: 500 }]).equal, false);
  const longer = compareNetwork(a, [...a, { method: 'GET', path: '/api/extra', status: 200 }]);
  assert.equal(longer.equal, false);
  assert.equal(longer.firstDiffIndex, 1);
});

test('DOM 비교: 다르면 첫 차이 지점 전후를 발췌한다', () => {
  const base = '<html><body><h1>';
  const r = compareDom(base + '가</h1></body></html>', base + '나</h1></body></html>', 5);
  assert.equal(r.equal, false);
  assert.equal(r.excerpt?.index, base.length);
  // 앞뒤 5자: '<body>' 의 마지막 '>' 부터 '</h1' 까지
  assert.equal(r.excerpt?.old, '><h1>가</h1');
  assert.equal(r.excerpt?.new, '><h1>나</h1');
  assert.equal(compareDom('a', 'a').equal, true);
});

test('스크린샷 비교: 같은 이미지는 equal 이고 diff 를 만들지 않는다', () => {
  const img = solidPng(20, 10, [255, 255, 255]);
  const r = compareScreenshots(img, solidPng(20, 10, [255, 255, 255]));
  assert.equal(r.equal, true);
  assert.equal(r.diffPixels, 0);
  assert.equal(r.diffPng, undefined);
});

test('스크린샷 비교: 픽셀 하나만 달라도 기본 허용치(0)에서는 다름이고 diff 를 만든다', () => {
  const a = solidPng(20, 10, [255, 255, 255]);
  const b = solidPng(20, 10, [255, 255, 255], [[3, 4]]);
  const r = compareScreenshots(a, b);
  assert.equal(r.equal, false);
  assert.equal(r.diffPixels, 1);
  assert.ok(r.diffPng && r.diffPng.length > 0);
  const diff = PNG.sync.read(r.diffPng!);
  assert.equal(diff.width, 20);
  assert.equal(diff.height, 10);
});

test('스크린샷 비교: maxDiffPixelRatio 를 넉넉히 주면 같음으로 본다', () => {
  const a = solidPng(20, 10, [255, 255, 255]);
  const b = solidPng(20, 10, [255, 255, 255], [[3, 4]]);
  const r = compareScreenshots(a, b, { maxDiffPixelRatio: 0.01 });
  assert.equal(r.equal, true);
  assert.equal(r.diffPixels, 1);
});

test('스크린샷 비교: 크기가 다르면 sizeMismatch 와 함께 다름으로 보고한다', () => {
  const r = compareScreenshots(solidPng(20, 10, [255, 255, 255]), solidPng(20, 12, [255, 255, 255]));
  assert.equal(r.equal, false);
  assert.equal(r.sizeMismatch, true);
  assert.deepEqual(r.old, { width: 20, height: 10 });
  assert.deepEqual(r.new, { width: 20, height: 12 });
  assert.ok(r.diffPng);
});

test('콘솔 비교: 두 대상 모두 error·pageerror 0건이어야 equal', () => {
  const ok = compareConsole([{ type: 'log', text: 'hi' }], [{ type: 'warning', text: 'w' }]);
  assert.equal(ok.equal, true);
  const bad = compareConsole([], [{ type: 'pageerror', text: 'boom' }]);
  assert.equal(bad.equal, false);
  assert.equal(bad.newErrors, 1);
  assert.equal(compareConsole([{ type: 'error', text: 'x' }], []).equal, false);
});
