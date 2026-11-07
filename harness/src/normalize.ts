// DOM·네트워크 정규화. 빌드마다 달라지는 해시와 SvelteKit 전용 속성을 지워 "의미가 같은지"만 비교한다.

/** `/_app/immutable/<...>.<hash>.<ext>` 의 해시 조각 → HASH */
const IMMUTABLE_HASH = /(\/_app\/immutable\/[^\s"'()<>]*?)\.([A-Za-z0-9_-]{6,})\.([a-z0-9]+)(?=["'()\s<>?#]|$)/g;
/** 인라인 부트스트랩 스크립트의 `__sveltekit_<hash>` 전역 → __sveltekit_HASH */
const SVELTEKIT_GLOBAL = /__sveltekit_[a-z0-9]+/g;
/** class 속성 */
const CLASS_ATTR = /\sclass=("[^"]*"|'[^']*')/g;
const SVELTE_CLASS = /\bsvelte-[a-z0-9]+\b/g;
/** data-sveltekit-* 속성(값 있든 없든) */
const DATA_SVELTEKIT_ATTR = /\sdata-sveltekit-[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

export function normalizeDom(html: string): string {
  let out = html;
  out = out.replace(IMMUTABLE_HASH, '$1.HASH.$3');
  out = out.replace(SVELTEKIT_GLOBAL, '__sveltekit_HASH');
  out = out.replace(CLASS_ATTR, (whole, quoted: string) => {
    const q = quoted.charAt(0);
    const inner = quoted.slice(1, -1).replace(SVELTE_CLASS, 'svelte-HASH');
    return whole.slice(0, whole.length - quoted.length) + q + inner + q;
  });
  out = out.replace(DATA_SVELTEKIT_ATTR, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/** 수집기가 남기는 요청 한 건의 원본 */
export interface NetworkEntry {
  /** 요청 시작 순서(0부터) */
  seq: number;
  method: string;
  url: string;
  resourceType: string;
  /** 응답이 오지 않았으면(실패·취소) undefined */
  status?: number;
  failure?: string;
  /** 시나리오 시작 기준 경과 시간(ms) */
  t: number;
}

/** 비교에 쓰는 요약: (method, path+query, status) */
export interface NetworkSignature {
  method: string;
  path: string;
  status: number | null;
}

/**
 * `/_app/` 자산·문서 요청·favicon 을 빼고 apiPrefix 요청만 남겨 순서대로 요약한다.
 * 호스트(프록시 포트)는 대상마다 다르므로 path+query 만 본다.
 */
export function apiSignatures(entries: readonly NetworkEntry[], apiPrefix = '/api'): NetworkSignature[] {
  const prefix = apiPrefix.endsWith('/') ? apiPrefix.slice(0, -1) : apiPrefix;
  const out: NetworkSignature[] = [];
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      continue;
    }
    const path = u.pathname + u.search;
    if (e.resourceType === 'document') continue;
    if (u.pathname.startsWith('/_app/')) continue;
    if (u.pathname === '/favicon.ico' || /\/favicon\.[a-z0-9]+$/.test(u.pathname)) continue;
    if (!u.pathname.startsWith(prefix)) continue;
    const next = u.pathname.charAt(prefix.length);
    if (!(next === '' || next === '/')) continue;
    out.push({ method: e.method.toUpperCase(), path, status: e.status ?? null });
  }
  return out;
}

export function formatSignature(s: NetworkSignature): string {
  return `${s.method} ${s.path} → ${s.status ?? 'no-response'}`;
}
