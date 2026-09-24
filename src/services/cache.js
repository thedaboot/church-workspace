import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, setStorageRelief } from './supabaseClient.js';

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
// 열쇠마다 **이 탭에서 마지막으로 새로 읽어 온 시각**(useCached의 run이 성공한 때). 화면을
// 오가는 재마운트가 15초 안이면 다시 읽지 않는다(아래 FRESH_MS). 메모리에만 둔다 — 새로고침한
// 탭은 언제나 다시 읽는다.
const loadedAt = new Map();
// 홈 → 예배 → 홈을 15초 안에 오가면 홈 카드 넷이 조회 14개를 또 쏘았다(2026-09-24). 방금 읽은
// 값이고 그 사이 바뀐 것은 실시간 신호가 dropCache로 비우므로(그러면 여기서도 지워진다) 다시
// 읽을 이유가 없다. **클라우드(persist)일 때만** — 게스트는 검사 스위트가 localStorage 시드를
// 바꿔 가며 화면을 다시 여는데, 그때 옛 값에 머물면 검사가 흔들린다.
export const FRESH_MS = 15000;
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

// 세션 토큰 쓰기가 한도에 걸리면 **우리 캐시 전부**를 비워 자리를 내준다
// (supabaseClient의 세션 저장 자리가 부른다 · 2026-09-21). 지금 scope만이 아니라 전부인
// 이유: 그 순간 필요한 것은 몇 킬로바이트가 아니라 토큰 한 줄이 들어갈 자리이고, 캐시는
// 다시 읽으면 그만이지만 토큰은 못 쓰면 로그인이 풀린다.
setStorageRelief(() => purgeKeys(k => k.startsWith(`${PREFIX}:`)));

export function setCacheScope(uid) {
  const next = uid || 'anon';
  if (next === scope) return;
  scope = next;
  mem.clear();
  loadedAt.clear();
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
  for (const k of [...loadedAt.keys()]) if (k.startsWith(prefix)) loadedAt.delete(k);
  const head = `${PREFIX}:${scope}:${prefix}`;
  purgeKeys(k => k.startsWith(head));
}

// prefix로 시작하는 키 가운데 keep 하나만 남기고 비운다 — 날짜가 열쇠에 든 캐시가 날마다 한 벌씩
// 쌓이지 않게(홈의 `home:qt:<날짜>`·`home:services:<날짜>` · 2026-09-24). 어제 열쇠는 다시 읽힐
// 일이 없는데 localStorage 자리만 먹는다.
export function pruneCache(prefix, keep) {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix) && k !== keep) mem.delete(k);
  for (const k of [...loadedAt.keys()]) if (k.startsWith(prefix) && k !== keep) loadedAt.delete(k);
  const head = `${PREFIX}:${scope}:${prefix}`;
  const kept = skey(keep);
  purgeKeys(k => k.startsWith(head) && k !== kept);
}

// 이 열쇠를 방금(FRESH_MS 안에) 새로 읽었고 값이 아직 있는가 — useCached가 재마운트에서 다시
// 읽을지 정한다. 클라우드일 때만 참이다(FRESH_MS 주석).
export function cacheFresh(key, now = Date.now()) {
  if (!persist() || !mem.has(key)) return false;
  const t = loadedAt.get(key);
  return t != null && now - t < FRESH_MS;
}

// useCached의 run이 성공했을 때 부른다(검사도 부른다)
export function noteLoaded(key, now = Date.now()) { loadedAt.set(key, now); }

// 화면용 훅. 캐시가 있으면 그것을 바로 돌려주고(loading=false, stale=true) 뒤에서 loader를
// 돌려 갈아 끼운다. 캐시가 없으면 loading=true(스켈레톤). deps가 바뀌면 다시 읽는다.
//   const { data, loading, stale, error, refresh } = useCached(`worship:list:${year}`, () => loadServices(year), [year]);
//
// **재마운트가 방금 읽은 열쇠면 다시 읽지 않는다**(cacheFresh · 15초 · 클라우드만). 그때는 캐시 값을
// **stale:false로** 세운다 — stale로 두면 "새로 읽은 한 벌"을 기다리는 화면(groupsView bundleFresh의
// QR 딥링크 판정)이 영영 기다린다. 생략은 마운트·열쇠가 바뀐 때뿐이다 — 같은 열쇠에서 deps만 바뀌면
// loader가 달라진 것이라 읽는다. refresh()는 언제나 읽는다.
export function useCached(key, loader, deps = []) {
  const [state, setState] = useState(() => {
    const hit = readCache(key);
    return { data: hit, loading: hit === undefined, stale: hit !== undefined && !cacheFresh(key), error: null };
  });
  const token = useRef(0);
  const keyRef = useRef(key);
  const mounted = useRef(false);

  const run = useCallback(async (k) => {
    const my = ++token.current;
    try {
      const v = await loader();
      if (my !== token.current) return;
      writeCache(k, v);
      noteLoaded(k);
      setState({ data: v, loading: false, stale: false, error: null });
    } catch (e) {
      if (my !== token.current) return;
      setState(s => ({ ...s, loading: false, error: e }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const keyChanged = keyRef.current !== key;
    const skip = (!mounted.current || keyChanged) && cacheFresh(key);
    mounted.current = true;
    if (keyChanged) {
      keyRef.current = key;
      const hit = readCache(key);
      setState({ data: hit, loading: hit === undefined, stale: hit !== undefined && !skip, error: null });
    }
    if (skip) {
      // 방금 읽은 값이다 — 그 값을 새 값으로 세우고 끝낸다(위 주석)
      token.current += 1;   // 앞서 떠난 읽기가 늦게 와서 덮지 않게
      setState(s => (s.stale || s.loading ? { data: readCache(key), loading: false, stale: false, error: null } : s));
      return;
    }
    run(key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  const refresh = useCallback(() => run(keyRef.current), [run]);
  return { ...state, refresh };
}
