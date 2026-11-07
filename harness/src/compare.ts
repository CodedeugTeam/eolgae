// 네 축 비교. 수집 결과 두 개(old, new)를 받아 차이 여부와 사람이 볼 발췌를 만든다.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { formatSignature, type NetworkSignature } from './normalize.ts';

export interface ImageSize {
  width: number;
  height: number;
}

export interface ScreenshotComparison {
  equal: boolean;
  threshold: number;
  maxDiffPixelRatio: number;
  diffPixels: number;
  diffRatio: number;
  old: ImageSize;
  new: ImageSize;
  sizeMismatch: boolean;
  /** 차이가 있을 때만 채워지는 diff 이미지(PNG 바이트) */
  diffPng?: Buffer;
}

export interface ScreenshotCompareOptions {
  threshold?: number;
  maxDiffPixelRatio?: number;
}

export function compareScreenshots(oldPng: Buffer, newPng: Buffer, opts: ScreenshotCompareOptions = {}): ScreenshotComparison {
  const threshold = opts.threshold ?? 0.1;
  const maxDiffPixelRatio = opts.maxDiffPixelRatio ?? 0;
  const a = PNG.sync.read(oldPng);
  const b = PNG.sync.read(newPng);
  const oldSize = { width: a.width, height: a.height };
  const newSize = { width: b.width, height: b.height };

  if (a.width !== b.width || a.height !== b.height) {
    // 크기가 다르면 비교 자체가 성립하지 않으므로 차이로 보고한다. diff 는 두 이미지를 겹쳐 그린다.
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const pa = padTo(a, width, height);
    const pb = padTo(b, width, height);
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(pa.data, pb.data, diff.data, width, height, { threshold });
    return {
      equal: false,
      threshold,
      maxDiffPixelRatio,
      diffPixels,
      diffRatio: diffPixels / (width * height),
      old: oldSize,
      new: newSize,
      sizeMismatch: true,
      diffPng: PNG.sync.write(diff),
    };
  }

  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
  const total = a.width * a.height;
  const diffRatio = total === 0 ? 0 : diffPixels / total;
  const equal = diffRatio <= maxDiffPixelRatio;
  return {
    equal,
    threshold,
    maxDiffPixelRatio,
    diffPixels,
    diffRatio,
    old: oldSize,
    new: newSize,
    sizeMismatch: false,
    ...(equal ? {} : { diffPng: PNG.sync.write(diff) }),
  };
}

function padTo(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = 0; y < img.height; y++) {
    const srcStart = y * img.width * 4;
    img.data.copy(out.data, y * width * 4, srcStart, srcStart + img.width * 4);
  }
  return out;
}

export interface DomExcerpt {
  index: number;
  old: string;
  new: string;
}

export interface DomComparison {
  equal: boolean;
  oldLength: number;
  newLength: number;
  excerpt?: DomExcerpt;
}

/** 정규화된 두 HTML 문자열을 비교한다. 다르면 첫 차이 지점 앞뒤를 발췌한다. */
export function compareDom(oldHtml: string, newHtml: string, contextChars = 120): DomComparison {
  if (oldHtml === newHtml) {
    return { equal: true, oldLength: oldHtml.length, newLength: newHtml.length };
  }
  const limit = Math.min(oldHtml.length, newHtml.length);
  let i = 0;
  while (i < limit && oldHtml.charCodeAt(i) === newHtml.charCodeAt(i)) i++;
  const from = Math.max(0, i - contextChars);
  return {
    equal: false,
    oldLength: oldHtml.length,
    newLength: newHtml.length,
    excerpt: {
      index: i,
      old: oldHtml.slice(from, i + contextChars),
      new: newHtml.slice(from, i + contextChars),
    },
  };
}

export interface NetworkComparison {
  equal: boolean;
  old: NetworkSignature[];
  new: NetworkSignature[];
  /** 처음 어긋난 위치. 한쪽이 더 길면 짧은 쪽 길이 */
  firstDiffIndex?: number;
}

export function compareNetwork(oldSigs: NetworkSignature[], newSigs: NetworkSignature[]): NetworkComparison {
  const n = Math.max(oldSigs.length, newSigs.length);
  for (let i = 0; i < n; i++) {
    const a = oldSigs[i];
    const b = newSigs[i];
    if (!a || !b || formatSignature(a) !== formatSignature(b)) {
      return { equal: false, old: oldSigs, new: newSigs, firstDiffIndex: i };
    }
  }
  return { equal: true, old: oldSigs, new: newSigs };
}

export interface ConsoleMessage {
  /** playwright ConsoleMessage.type() 또는 'pageerror' */
  type: string;
  text: string;
  location?: string;
}

export interface ConsoleComparison {
  /** 두 대상 모두 error 레벨·pageerror 가 0건 */
  equal: boolean;
  oldErrors: number;
  newErrors: number;
  old: ConsoleMessage[];
  new: ConsoleMessage[];
}

export function isConsoleError(m: ConsoleMessage): boolean {
  return m.type === 'error' || m.type === 'pageerror';
}

export function compareConsole(oldMsgs: ConsoleMessage[], newMsgs: ConsoleMessage[]): ConsoleComparison {
  const oldErrors = oldMsgs.filter(isConsoleError).length;
  const newErrors = newMsgs.filter(isConsoleError).length;
  return { equal: oldErrors === 0 && newErrors === 0, oldErrors, newErrors, old: oldMsgs, new: newMsgs };
}
