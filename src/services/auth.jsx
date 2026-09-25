import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, resetMyUid } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';
import { isKakaoInApp, returnToOf, authErrorInUrl } from '../utils.js';
import { setEntryQuery } from './entryQuery.js';
import { APPROVAL_POLL_MS, permFromRpc, shouldWatchApproval, approvalRowPassed } from './approvalWatch.js';

// ============================================================================
// 인증 컨텍스트 (Supabase OAuth: 구글 / 카카오)
// - supabase 미설정(.env 없음) 시 enabled=false → 게스트 모드로 통과
// - 승인 대기 중에는 승인을 지켜본다(실시간·다시 보일 때·30초 — 판정은 approvalWatch.js)
// ============================================================================
const AuthContext = createContext({ enabled: false, session: null, loading: false, isAdmin: true, isMaster: true, approved: true, signIn: () => {}, signOut: () => {}, autoSignInKakao: () => false });

export const useAuth = () => useContext(AuthContext);

// 내 로그인 이메일. 구글 문서 주소의 `authuser=`에 실어 **어느 구글 계정으로 열지**를
// 정하는 데 쓴다(§6-34-h — 브라우저의 기본 계정이 편집자가 아니면 읽기 화면이 뜬다).
// 게스트 모드에서는 세션이 없어 빈 문자열이고, 그때는 주소에 아무것도 붙지 않는다.
export const useMyEmail = () => useAuth().session?.user?.email || '';

// ── 로그인 전 자리 기억 (2026-09-05) ─────────────────────────────────────────
// 카카오톡으로 공유한 링크(/s/t/<id> → /?p=&t=)를 인앱 브라우저에서 열면 세션이 없어
// 로그인 화면이 뜨고, OAuth가 origin('/')으로 돌려보내서 가려던 업무를 잃었다.
// 왜 sessionStorage인가(redirectTo에 실어 보내지 않고):
//  · redirectTo는 Supabase 대시보드의 허용 목록에 있어야 한다. 지금 목록은 origin이고,
//    쿼리가 붙은 주소를 통과시키려면 와일드카드(`/**`)를 등록해야 한다 — 코드만 봐서는
//    등록 여부를 알 수 없고, 목록에 없으면 조용히 Site URL로 떨어져 **아무 표시 없이**
//    같은 증상이 난다. 저장소는 그 설정에 기대지 않는다.
//  · OAuth 왕복은 같은 탭 안에서 일어나므로(인앱 웹뷰도 같다) sessionStorage가 살아 있고,
//    탭을 닫으면 같이 사라져서 다른 날 다른 자리로 튀는 일이 없다.
//  · hash는 저장하지 않는다(returnToOf) — 거기는 auth-js가 토큰·오류를 싣는 자리다.
// 인앱 브라우저가 저장소를 막아 두면 던진다 — 그때는 자리 기억만 포기하고 로그인은 한다.
const RETURN_KEY = 'auth.returnTo';
const AUTO_KAKAO_KEY = 'auth.autoKakaoTried';
const ss = {
  get: (k) => { try { return window.sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { window.sessionStorage.setItem(k, v); } catch { /* 막힌 저장소 */ } },
  del: (k) => { try { window.sessionStorage.removeItem(k); } catch { /* 막힌 저장소 */ } },
};
const rememberReturnTo = () => {
  const to = returnToOf(window.location);
  if (to) ss.set(RETURN_KEY, to); else ss.del(RETURN_KEY);
};
// 세션이 생긴 직후, WorkspaceShell이 마운트되기 **전에** 부른다 — 그쪽은 `?p=&t=`를
// useState 초기값으로 한 번만 읽으므로 그 뒤에 주소를 고치면 화면이 따라오지 않는다.
// auth-js가 hash를 지운 자리(`/#`)도 이 replaceState가 같이 정리한다.
// 저장소에서 온 글자라 그대로 믿지 않는다. `//evil.example`은 브라우저가 **다른 origin**의
// 주소로 읽는다(scheme-relative) — replaceState는 같은 origin만 받아서 던지고, 그 예외가
// getSession의 then 안에서 나면 setSession까지 못 가서 **로그인이 통째로 멈춘다.**
// 우리 자리('/'로 시작하고 '//'가 아닌 것)만 복원하고, 그래도 던지면 자리만 포기한다.
const consumeReturnTo = () => {
  const to = ss.get(RETURN_KEY);
  if (!to) return;
  ss.del(RETURN_KEY);
  if (!to.startsWith('/') || to.startsWith('//')) return;
  if (to === window.location.pathname + window.location.search) return;
  try { window.history.replaceState(null, '', to); } catch { /* 막힌 히스토리 */ return; }
  // 딥링크의 나머지 값(s·g·apply — 0053)은 entryQuery가 **모듈 첫 실행 때** 주소에서 붙잡는데,
  // OAuth 왕복 뒤의 첫 주소는 `/#…`이라 그 스냅샷이 비어 있다. 복원한 자리를 다시 실어 준다
  // (모임 담당 보고 2026-09-07 — 그쪽은 화면에서 주소를 한 번 더 읽는 우회를 뒀다).
  setEntryQuery(to);
};

// 카카오 자동 로그인을 이미 한 번 시도했나. sessionStorage와 **둘 다** 본다 —
// 인앱 웹뷰가 저장소를 막아 두면 ss.get이 언제나 null이라 표식이 없는 것과 같고,
// 그러면 로그아웃 → 자동 재로그인 고리에서 빠져나올 수 없다(모듈 변수는 탭이 살아
// 있는 동안 남으므로 그 경우의 마지막 방어선이다).
let autoKakaoTried = false;

// 자격 세 가지를 한 번 묻는다. 셋 다 security definer 함수라 RLS를 우회해서 답하므로
// 승인 대기자도 자기 상태를 안다. 답 읽기는 approvalWatch.permFromRpc 한 벌(실패면 null).
const askPerm = async () => {
  try {
    return permFromRpc(await Promise.all([
      supabase.rpc('is_admin'), supabase.rpc('is_master'), supabase.rpc('is_approved'),
    ]));
  } catch { return null; }
};

export function AuthProvider({ children }) {
  const enabled = !!supabase;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(enabled);
  // 관리자·승인 여부는 **DB에 물어본다**(0022). 예전에는 VITE_ADMIN_EMAILS로 화면이
  // 따로 판정했는데, 빌드 시점에 박히는 값이라 관리자를 한 명 늘릴 때마다 재배포가
  // 필요했고 DB의 admins 표와 어긋나기도 했다(§4.5의 '둘 중 하나만 넣으면 어긋난다').
  // null = 아직 모름 — 이때 승인 화면을 띄우면 로그인 직후 한 번 번쩍인다.
  const [perm, setPerm] = useState({ isAdmin: null, isMaster: null, approved: null });

  useEffect(() => {
    if (!enabled) return;
    // getSession은 클라이언트 초기화(주소의 토큰 읽기 → 세션 저장 → hash 지우기)를 기다린
    // 뒤 답하므로, OAuth에서 돌아온 첫 로드에서도 여기서 세션이 잡힌다. 그래서 자리
    // 복원은 setSession보다 **먼저**다(위 consumeReturnTo 주석).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) consumeReturnTo();
      setSession(data.session); setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_IN' && newSession) consumeReturnTo();
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, [enabled]);

  // 로그인 사용자 이름을 워크스페이스 프로필에 반영 — 단, 이름이 **비어 있을 때만**.
  // onAuthStateChange는 토큰 갱신(1시간 주기)에도 새 session 객체를 주므로 조건 없이
  // 덮어쓰면 사용자가 정한 표시 이름이 구글 이름으로 되돌아갔다. 그러면
  // selectMyTasks(assignees에 name 포함)가 어긋나 '내 업무'가 통째로 비었다.
  useEffect(() => {
    const name = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name;
    if (name && !store.getState().currentUser.name) store.dispatch({ type: 'UPDATE_USER', payload: { name } });
  }, [session]);

  // 세션이 생기거나 바뀌면 권한을 다시 묻는다(askPerm).
  useEffect(() => {
    if (!enabled) return;
    // 세션이 바뀌면 '내 id'를 다시 묻는다 — 안 버리면 다른 사람으로 로그인했는데
    // 앞사람의 id가 남는다(0061 effective_uid의 캐시).
    resetMyUid();
    if (!session) { setPerm({ isAdmin: null, isMaster: null, approved: null }); return; }
    let alive = true;
    (async () => {
      // **못 물어본 것을 '아니오'로 바꾸지 않는다**(2026-09-22 신고 · 조해리·노준석).
      // 이 물음은 토큰이 갱신될 때마다(한 시간) 다시 던져지는데, 폰에서 신호가 잠깐
      // 끊기면 rpc가 에러로 돌아오고 예전에는 `!!null`이 false가 되어 멀쩡히 쓰던
      // 사람이 '승인을 기다려주세요' 화면으로 떨어졌다. 실패하면 **앞서 알던 값을
      // 그대로 두고**, 한 번 더 물어본다. 그래도 안 되면 다음 갱신 때 또 묻는다.
      let res = await askPerm();
      if (!res && alive) {
        await new Promise(r => setTimeout(r, 1500));
        if (alive) res = await askPerm();
      }
      if (!alive) return;
      if (!res) {
        // 두 번 다 실패 — 아는 것을 지우지 않는다. 처음이라면 null(아직 모름)로 남고,
        // AuthGate는 그때 승인 대기가 아니라 빈 화면을 보여 준다.
        console.error('[auth] 자격을 확인하지 못했어요 — 알던 값을 그대로 둡니다');
        return;
      }
      setPerm(res);
    })();
    return () => { alive = false; };
  }, [enabled, session]);

  // **승인 대기 화면이 떠 있는 동안은 승인을 지켜본다**(2026-09-25). 위 물음은 세션이 바뀔
  // 때만(토큰 갱신 · 약 한 시간) 돌아서, 관리자가 수락해도 새로고침하거나 한 시간을 기다려야
  // 들어왔다. 세 갈래로 다시 묻는다(approvalWatch.js 머리말) — 실시간 내 profiles 행 ·
  // 앱이 다시 보일 때 · 30초 주기. 판정은 같은 askPerm이고, 승인되는 순간 AuthGate가
  // 워크스페이스를 마운트한다. 실패하면 알던 값(대기)을 그대로 둔다 — 다음 갈래가 또 묻는다.
  const uid = session?.user?.id || null;
  const watching = shouldWatchApproval({ enabled, hasSession: !!uid, approved: perm.approved });
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    let busy = false;
    const recheck = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      const res = await askPerm();
      busy = false;
      if (alive && res) setPerm(res);
    };
    const channel = supabase.channel(`approval:${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => { if (approvalRowPassed(payload.new)) recheck(); })
      .subscribe();
    const timer = setInterval(recheck, APPROVAL_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [watching, uid]);

  const signIn = (provider) => {
    // 떠나기 전에 지금 자리를 적어 둔다 — 돌아오면 consumeReturnTo가 그 자리로 보낸다
    rememberReturnTo();
    return supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        // 구글: 매번 전체 동의 화면 대신 계정 선택만
        ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
      },
    });
  };
  // 로그아웃은 **자리와 표식을 같이 치운다**(2026-09-06).
  //  · 카카오 표식을 여기서 **놓는다**(지우지 않는다 — 지우는 길이 생기면 로그아웃 →
  //    자동 재로그인 고리가 돌아온다). 자동 시작은 인앱 브라우저에서 처음 온 사람을 위한
  //    것이고, 방금 나간 사람은 '다른 계정으로 로그인'을 하려는 것이다.
  //  · 돌아갈 자리(returnTo)도 지운다. 안 지우면 다음 로그인이 **먼저 사람이 가려던 곳**이
  //    아니라 지난 세션의 딥링크로 데려간다.
  //  · 주소의 `?p=&t=`도 함께 내린다 — WorkspaceShell이 그 값을 useState 초기값으로 한 번만
  //    읽으므로, 남겨 두면 로그인 화면 뒤에 지난 업무가 그대로 열린다.
  //  · **`scope: 'local'`을 반드시 적는다**(2026-09-21 · 아이패드 로그인 풀림의 원인).
  //    auth-js의 기본값은 `'global'`이라 옵션을 비워 두면 **그 사람의 모든 기기**의
  //    리프레시 토큰이 서버에서 폐기된다. 폰에서 한 번 로그아웃하면 아이패드는 그 자리에서
  //    안 튕기고(액세스 토큰이 최대 한 시간 살아 있다) **다음 갱신 때** 조용히 풀린다 —
  //    그래서 "가끔 로그인하라고 뜬다"로 보였다. 기기마다 세션이 따로인 것이 맞다.
  const signOut = () => {
    autoKakaoTried = true;
    ss.set(AUTO_KAKAO_KEY, '1');
    ss.del(RETURN_KEY);
    try { window.history.replaceState(null, '', '/'); } catch { /* 막힌 히스토리 */ }
    return supabase.auth.signOut({ scope: 'local' });
  };

  // 카카오톡 인앱 브라우저에서 로그인 화면이 뜨면 카카오 로그인을 **한 번** 자동으로 시작한다.
  // 카카오톡으로 받은 링크를 여는 사람은 이미 카카오에 로그인돼 있어 버튼 한 번이 그냥 절차다.
  // 한 번만인 이유(sessionStorage 표식): 실패·취소로 돌아왔을 때 또 시작하면 빠져나올 수
  // 없는 고리가 된다. 표식은 탭이 살아 있는 동안 남으므로 로그아웃 뒤에도 자동으로 다시
  // 들어가지 않는다(그때는 버튼을 눌러야 한다 — '다른 계정으로 로그인'이 뜻하는 바다).
  // 주소에 OAuth 오류가 실려 있으면(authErrorInUrl) 표식이 없어도 시작하지 않는다.
  // 돌려주는 값: 시작했으면 true — 화면이 그 버튼을 로딩 상태로 보여 준다.
  const autoSignInKakao = () => {
    if (!enabled) return false;
    if (!isKakaoInApp(navigator.userAgent)) return false;
    if (authErrorInUrl(window.location.href)) return false;
    if (autoKakaoTried) return false;   // 저장소가 막힌 웹뷰에서도 한 번만(위 주석)
    autoKakaoTried = true;
    if (ss.get(AUTO_KAKAO_KEY)) return false;
    ss.set(AUTO_KAKAO_KEY, '1');
    signIn('kakao');
    return true;
  };

  // 게스트 모드(로컬)는 전원 관리자·전원 승인으로 취급한다 — 서버가 없다.
  const isAdmin = !enabled || perm.isAdmin === true;
  // 마스터 = 관리자 중의 관리자(0028). AI 기능(요약 고정·고치기)과 관리자 지정·해제.
  // 관리자는 멤버 관리(수락·환송)와 업무 삭제만 한다(사용자 결정).
  const isMaster = !enabled || perm.isMaster === true;
  // 아직 모르는 동안(null)은 **승인된 것으로 본다** — 로그인 직후 한 프레임 동안
  // '승인을 기다려주세요'가 번쩍이면 이미 쓰고 있던 사람에게 사고처럼 보인다.
  const approved = !enabled || perm.approved !== false;

  return <AuthContext.Provider value={{ enabled, session, loading, isAdmin, isMaster, approved, signIn, signOut, autoSignInKakao }}>{children}</AuthContext.Provider>;
}
