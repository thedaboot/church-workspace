import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';

// ============================================================================
// 인증 컨텍스트 (Supabase OAuth: 구글 / 카카오)
// - supabase 미설정(.env 없음) 시 enabled=false → 게스트 모드로 통과
// ============================================================================
const AuthContext = createContext({ enabled: false, session: null, loading: false, isAdmin: true, approved: true, signIn: () => {}, signOut: () => {} });

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const enabled = !!supabase;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(enabled);
  // 관리자·승인 여부는 **DB에 물어본다**(0022). 예전에는 VITE_ADMIN_EMAILS로 화면이
  // 따로 판정했는데, 빌드 시점에 박히는 값이라 관리자를 한 명 늘릴 때마다 재배포가
  // 필요했고 DB의 admins 표와 어긋나기도 했다(§4.5의 '둘 중 하나만 넣으면 어긋난다').
  // null = 아직 모름 — 이때 승인 화면을 띄우면 로그인 직후 한 번 번쩍인다.
  const [perm, setPerm] = useState({ isAdmin: null, approved: null });

  useEffect(() => {
    if (!enabled) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
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
    if (!session) { setPerm({ isAdmin: null, approved: null }); return; }
    let alive = true;
    (async () => {
      const [a, ap] = await Promise.all([
        supabase.rpc('is_admin'),
        supabase.rpc('is_approved'),
      ]);
      if (!alive) return;
      if (a.error) console.error('[auth] is_admin 실패:', a.error);
      if (ap.error) console.error('[auth] is_approved 실패:', ap.error);
      setPerm({ isAdmin: !!a.data, approved: !!ap.data });
    })();
    return () => { alive = false; };
  }, [enabled, session]);

  const signIn = (provider) => supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
      // 구글: 매번 전체 동의 화면 대신 계정 선택만
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  const signOut = () => supabase.auth.signOut();

  // 게스트 모드(로컬)는 전원 관리자·전원 승인으로 취급한다 — 서버가 없다.
  const isAdmin = !enabled || perm.isAdmin === true;
  // 아직 모르는 동안(null)은 **승인된 것으로 본다** — 로그인 직후 한 프레임 동안
  // '승인을 기다려주세요'가 번쩍이면 이미 쓰고 있던 사람에게 사고처럼 보인다.
  const approved = !enabled || perm.approved !== false;

  return <AuthContext.Provider value={{ enabled, session, loading, isAdmin, approved, signIn, signOut }}>{children}</AuthContext.Provider>;
}
