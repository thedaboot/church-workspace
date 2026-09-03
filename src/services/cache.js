import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

// ============================================================================
// 화면 데이터 캐시 — "매번 스켈레톤"을 없앤다 (사용자 요청 2026-09-03)
// ----------------------------------------------------------------------------
// 홈·예배·말씀·모임은 들어갈 때마다 서비스 계층을 다시 읽고, 그동안 스켈레톤을 그렸다.
// 이제 마지막으로 읽은 값을 **메모리 + localStorage**에 두고, 다음 진입에서는 그 값을
// 먼저 그리고 뒤에서 새로 읽어 갈아 끼운다(stale-while-revalidate). 스켈레톤은 **캐시가
// 하나도 없을 때(첫 진입)** 만 나온다.
//
// · 키는 사용자별이다(setCacheScope) — 계정을 바꾸면 남의 값이 보이면 안 된다.
// · 게스트 모드(supabase 없음)에서는 **메모리에만** 둔다 — 검사 스위트가 localStorage에
//   시드를 심고 새로고침하는데, 지난 시드의 캐시가 먼저 그려지면 검사가 흔들린다.
// · 쓰기(저장·삭제) 뒤에는 부르는 쪽이 dropCache(prefix)로 관련 키를 비우고 다시 읽는다.
//   비우지 않으면 저장 직후 화면이 옛 값으로 한 번 깜빡인다.
// · 값은 JSON으로 저장할 수 있는 것만(Map·Set·함수는 안 된다).
// ponytail: TTL·용량 관리 없음 — 값이 크지 않은 목록들이다. 5MB 한도에 닿으면 setItem이
//   던지고 그냥 메모리 캐시로만 동작한다(catch).
// ============================================================================

const PREFIX = 'church_cache_v1';
const mem = new Map();
let scope = 'anon';
const persist = () => !!supabase;
const skey = (k) => `${PREFIX}:${scope}:${k}`;

export function setCacheScope(uid) {
  const next = uid || 'anon';
  if (next === scope) return;
  scope = next;
  mem.clear();
}

export function readCache(key) {
  if (mem.has(key)) return mem.get(key);
  if (!persist()) return undefined;
  try {
    const raw = localStorage.getItem(skey(key));
    if (raw == null) return undefined;
    const v = JSON.parse(raw);
    mem.set(key, v);
    return v;
  } catch { return undefined; }
}

export function writeCache(key, value) {
  mem.set(key, value);
  if (!persist()) return;
  try { localStorage.setItem(skey(key), JSON.stringify(value)); } catch { /* 한도 초과·비공개 모드 */ }
}

// prefix로 시작하는 키를 전부 비운다 — 예: dropCache('worship') → worship:list, worship:s1 …
export function dropCache(prefix = '') {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  if (!persist()) return;
  try {
    const head = `${PREFIX}:${scope}:${prefix}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(head)) localStorage.removeItem(k);
    }
  } catch { /* 무시 */ }
}

// 화면용 훅. 캐시가 있으면 그것을 바로 돌려주고(loading=false, stale=true) 뒤에서 loader를
// 돌려 갈아 끼운다. 캐시가 없으면 loading=true(스켈레톤). deps가 바뀌면 다시 읽는다.
//   const { data, loading, stale, error, refresh } = useCached(`worship:list:${year}`, () => loadServices(year), [year]);
export function useCached(key, loader, deps = []) {
  const [state, setState] = useState(() => {
    const hit = readCache(key);
    return { data: hit, loading: hit === undefined, stale: hit !== undefined, error: null };
  });
  const token = useRef(0);
  const keyRef = useRef(key);

  const run = useCallback(async (k) => {
    const my = ++token.current;
    try {
      const v = await loader();
      if (my !== token.current) return;
      writeCache(k, v);
      setState({ data: v, loading: false, stale: false, error: null });
    } catch (e) {
      if (my !== token.current) return;
      setState(s => ({ ...s, loading: false, error: e }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      const hit = readCache(key);
      setState({ data: hit, loading: hit === undefined, stale: hit !== undefined, error: null });
    }
    run(key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  const refresh = useCallback(() => run(keyRef.current), [run]);
  return { ...state, refresh };
}
