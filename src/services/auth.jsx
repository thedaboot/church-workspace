import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';
import { isKakaoInApp, returnToOf, authErrorInUrl } from '../utils.js';

// ============================================================================
// 인증 컨텍스트 (Supabase OAuth: 구글 / 카카오)
// - supabase 미설정(.env 없음) 시 enabled=false → 게스트 모드로 통과
// ============================================================================
const AuthContext = createContext({ enabled: false, session: null, loading: false, isAdmin: true, isMaster: true, approved: true, signIn: () => {}, signOut: () => {}, autoSignInKakao: () => false });

export const useAuth = () => useContext(AuthContext);

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
  try { window.history.replaceState(null, '', to); } catch { /* 막힌 히스토리 */ }
};

// 카카오 자동 로그인을 이미 한 번 시도했나. sessionStorage와 **둘 다** 본다 —
// 인앱 웹뷰가 저장소를 막아 두면 ss.get이 언제나 null이라 표식이 없는 것과 같고,
// 그러면 로그아웃 → 자동 재로그인 고리에서 빠져나올 수 없다(모듈 변수는 탭이 살아
// 있는 동안 남으므로 그 경우의 마지막 방어선이다).
let autoKakaoTried = false;

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

  // 세션이 생기거나 바뀌면 권한을 다시 묻는다. 두 값 다 security definer 함수라
  // RLS를 우회해서 답하므로, 승인 대기자도 자기 상태는 알 수 있다.
  useEffect(() => {
    if (!enabled) return;
    if (!session) { setPerm({ isAdmin: null, isMaster: null, approved: null }); return; }
    let alive = true;
    (async () => {
      const [a, m, ap] = await Promise.all([
        supabase.rpc('is_admin'),
        supabase.rpc('is_master'),
        supabase.rpc('is_approved'),
      ]);
      if (!alive) return;
      if (a.error) console.error('[auth] is_admin 실패:', a.error);
      if (m.error) console.error('[auth] is_master 실패:', m.error);
      if (ap.error) console.error('[auth] is_approved 실패:', ap.error);
      setPerm({ isAdmin: !!a.data, isMaster: !!m.data, approved: !!ap.data });
    })();
    return () => { alive = false; };
  }, [enabled, session]);

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
  const signOut = () => {
    autoKakaoTried = true;
    ss.set(AUTO_KAKAO_KEY, '1');
    ss.del(RETURN_KEY);
    try { window.history.replaceState(null, '', '/'); } catch { /* 막힌 히스토리 */ }
    return supabase.auth.signOut();
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
