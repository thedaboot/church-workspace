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
// · TTL은 없다(값이 크지 않은 목록들이다). 대신 **자리는 관리한다** — scope를 바꿀 때
//   옛 사용자의 키를 지우고(setCacheScope), 한도에 걸리면 이 scope를 비우고 한 번만
//   다시 시도한다(writeCache). 예전에는 계정을 바꿀 때마다 한 벌이 통째로 쌓여서
//   5MB에 닿는 순간부터 **모든 쓰기가 조용히 실패**했고, 캐시가 옛 값에 굳었다.
// ============================================================================

const PREFIX = 'church_cache_v1';
const mem = new Map();
let scope = 'anon';
const persist = () => !!supabase;
const skey = (k) => `${PREFIX}:${scope}:${k}`;

// localStorage에서 조건에 맞는 우리 키를 지운다 — **메모리 캐시는 건드리지 않는다**
// (부르는 쪽이 각자 정한다). 뒤에서부터 도는 것은 removeItem이 색인을 당기기 때문이다.
function purgeKeys(match) {
  if (!persist()) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}:`) && match(k)) localStorage.removeItem(k);
    }
  } catch { /* 무시 */ }
}

export function setCacheScope(uid) {
  const next = uid || 'anon';
  if (next === scope) return;
  scope = next;
  mem.clear();
  // **지금 scope 것만 남긴다.** 로그아웃·계정 전환이 쌓아 둔 남의 키는 다시 읽힐 일이
  // 없는데 자리만 먹는다(그리고 그 사람의 명단·묵상이 기기에 남는다).
  purgeKeys(k => !k.startsWith(`${PREFIX}:${scope}:`));
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
  let raw;
  try { raw = JSON.stringify(value); } catch { return; }   // 담을 수 없는 값(순환 참조 등)
  try { localStorage.setItem(skey(key), raw); }
  catch {
    // 한도 초과(QuotaExceeded)나 비공개 모드. **이 scope를 비우고 한 번만** 다시 넣는다 —
    // 안 비우면 그 뒤의 모든 쓰기가 조용히 실패해서 캐시가 옛 값에 굳는다(그 화면은
    // 저장을 해도 다음 진입에서 지난 값을 먼저 그린다). 메모리 캐시는 그대로 둔다.
    purgeKeys(k => k.startsWith(`${PREFIX}:${scope}:`));
    try { localStorage.setItem(skey(key), raw); } catch { /* 그래도 안 되면 메모리만 */ }
  }
}

// prefix로 시작하는 키를 전부 비운다 — 예: dropCache('worship:svc') → worship:svc:s1 …
// **접두는 그냥 글자 비교다.** 짧게 주면 이웃 갈래까지 같이 지워진다 — dropCache('word')는
// 'word:qt:…'만이 아니라 'word:…'로 시작하는 모든 키를 가져간다. 그래서 갈래가 다른 값은
// 열쇠의 첫 도막을 다르게 짓는다(성경 상태는 'bible:state'다 — wordBible STATE_KEY).
export function dropCache(prefix = '') {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  const head = `${PREFIX}:${scope}:${prefix}`;
  purgeKeys(k => k.startsWith(head));
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
