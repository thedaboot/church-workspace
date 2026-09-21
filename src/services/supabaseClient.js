import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase 단일 클라이언트 인스턴스
// - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 미설정 시 null
//   → 앱은 로그인 없는 게스트(로컬) 모드로 동작
// ============================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 다른 파일이 직접 REST를 부를 때 쓴다 — 지금은 `cloud.stampLeaveBeacon` 하나다
// (탭을 닫는 순간의 요청은 supabase-js로는 취소돼서 keepalive fetch로 직접 보낸다).
export const SUPABASE_URL = url || '';
export const SUPABASE_ANON_KEY = anonKey || '';

// ── 쓰기 한 번 = 다녀간 시각 한 번 ───────────────────────────────────────────
// **쓰기는 곧 '지금'이다**(2026-09-06). 5분 심장박동은 *아무것도 안 하는 사람*의
// 상한이라, 그 사이에 업무를 고친 사람은 남들 화면에서 "1분 전 수정 · 4분 전 다녀감"이라는
// 모순으로 보였다(사용자 지적 2026-09-05).
//
// 쓰기 함수마다 한 줄씩 넣지 않고 **여기 한 군데**서 보는 이유: 쓰기가 cloud.js만이
// 아니라 worship·groups·bible·roster에도 흩어져 있고, 앞으로 생길 것까지 빠짐없이
// 덮으려면 클라이언트가 실제로 내보내는 요청을 보는 자리가 유일하게 안전하다.
// 실제로 무엇을 할지는 부르는 쪽이 정한다(cloudSync.markSeen — 1분 스로틀).
let onWrite = null;
export const setWriteObserver = (fn) => { onWrite = fn; };

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// POST지만 쓰기가 아닌 것들 — 로그인 직후 자격 확인(auth.jsx)과 다녀간 시각 그 자체.
// 다녀간 시각 함수를 빼지 않으면 스탬프가 스스로를 부른다.
const NOT_A_WRITE = /\/rest\/v1\/rpc\/(is_admin|is_master|is_approved|touch_last_seen)\b/;

// storage는 안 본다 — 이 앱의 파일 업로드는 언제나 `files` 행 쓰기(/rest/v1/)를 같이
// 하므로 두 번 셀 이유가 없고, 서명 주소 발급(POST)은 **보기**라 쓰기로 세면 거짓이 된다.
function observedFetch(input, init) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (onWrite && WRITE_METHODS.has(method)) {
    const href = String(typeof input === 'string' ? input : (input?.url || ''));
    if (href.includes('/rest/v1/') && !NOT_A_WRITE.test(href)) {
      try { onWrite(); } catch { /* 다녀간 시각 한 칸 때문에 쓰기를 막지 않는다 */ }
    }
  }
  return globalThis.fetch(input, init);
}

// ── 세션을 담는 자리 — 한도에 걸리면 캐시를 비우고 한 번 더 ────────────────
// 아이패드 PWA에서 "좀 있다 또 로그인하라고 한다"의 정체다(제보 2026-09-21).
// 토큰은 갱신될 때마다(한 시간) **새 값으로 다시 저장돼야** 하는데, localStorage가
// 5MB에 닿으면 그 쓰기가 예외로 끝나고 조용히 사라진다. 그러면 기기에는 이미 폐기된
// 옛 토큰이 남아 다음 갱신에서 세션이 끊긴다 — 서버에는 멀쩡한 토큰이 그대로 있는데도.
// 라이브 auth.sessions에서 그 모양을 확인했다(한 번 갱신되고 버려진 세션 · 살아 있는
// 리프레시 토큰 1개 · not_after 없음).
//
// `services/cache.js`는 **자기 키가 걸릴 때만** 스스로 비운다(그 파일 주석) — 토큰
// 쓰기는 그 보호 밖이었다. 여기서 같은 구제를 토큰에도 준다. 비우는 일은 캐시가 자기
// 키를 아는 자리에서 해야 하므로 **등록해서 받는다**(위 setWriteObserver와 같은 까닭 —
// 접두를 두 벌로 적으면 한쪽만 바뀌는 날 조용히 안 지워진다).
let relieve = null;
export const setStorageRelief = (fn) => { relieve = fn; };

const authStorage = {
  getItem: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
  removeItem: (k) => { try { window.localStorage.removeItem(k); } catch { /* 막힌 저장소 */ } },
  setItem: (k, v) => {
    try { window.localStorage.setItem(k, v); return; } catch { /* 아래에서 한 번 더 */ }
    try { relieve?.(); } catch { /* 구제가 실패해도 다시 써 본다 */ }
    try { window.localStorage.setItem(k, v); }
    catch (e) {
      // 여기까지 오면 다음 갱신에서 로그인이 풀린다. 조용히 넘기지 않는다.
      console.error('[auth] 세션을 저장하지 못했어요 — 다음 갱신에서 로그인이 풀립니다:', e);
    }
  },
};

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      // 세션 지속성 명시 (기본값이지만 의도를 분명히 — 새로고침 후 로그인 유지)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage },
      global: { fetch: observedFetch },
    })
  : null;

export const isCloudEnabled = () => !!supabase;


// ── 나는 누구인가 — **합친 계정이면 남긴 계정의 id** (0061) ──────────────────
// 사용자 요구 2026-09-10: "그 계정으로 해도 합쳐진 계정으로 남을 수 있게끔."
// DB는 `effective_uid()`로 그 판정을 하고(정책·my_person_id가 그것을 본다), 클라이언트도
// 같은 값을 봐야 한다 — 자기 uid로 `.eq('profile_id', …)`를 걸면 노트·묵상이 남긴 계정
// 아래 있어서 **한 줄도 안 나온다**.
//
// 세션당 한 번만 묻고 기억한다(rpc 한 번). 로그인·로그아웃 때 `resetMyUid()`로 버린다 —
// 안 버리면 다른 사람으로 로그인했는데 앞사람의 id가 남는다.
let myUidCache = null;
export function resetMyUid() { myUidCache = null; }
export async function myUid() {
  if (!supabase) return null;
  if (myUidCache) return myUidCache;
  const { data, error } = await supabase.rpc('effective_uid');
  if (error) {
    // 함수가 아직 없는 배포(0061 미적용)에서도 앱이 돌아야 한다 — 내 uid로 떨어진다
    console.error('[auth] effective_uid 실패 — 내 계정 id로 갑니다:', error);
    const { data: { user } = {} } = await supabase.auth.getUser();
    return user?.id || null;
  }
  myUidCache = data || null;
  return myUidCache;
}

// 이미 물어 둔 값을 **동기로** 준다. 자격 판정(삭제 버튼을 보일까)은 그리는 중에
// 정해져야 해서 await할 자리가 없다 — 아직 안 물었으면 null이고, 그때는 부르는 쪽이
// 세션 uid로 떨어진다. 캐시는 myUid()가 채우고 resetMyUid()가 버린다.
export function myUidSync() { return myUidCache; }

// '내 것인가' — **0063의 정책과 같은 규칙이다: 두 id 다 나다.** 합치기 전후로 같은
// 사람의 행이 두 id에 갈려 있어서(0059가 댓글·업무의 '누가 눌렀나' 칸은 일부러 안
// 옮겼다) 한쪽만 보면 화면은 '내 것이 아니다'라며 버튼을 감추는데 DB는 허락하는
// 어긋남이 생긴다 — 합친 계정에게 **옛 댓글 삭제가 조용히 실패**하던 자리다.
export function isMyUid(id, sessionUid) {
  return !!id && (id === sessionUid || id === myUidCache);
}
