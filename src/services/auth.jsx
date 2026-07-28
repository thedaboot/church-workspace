import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';

// ============================================================================
// 인증 컨텍스트 (Supabase OAuth: 구글 / 카카오)
// - supabase 미설정(.env 없음) 시 enabled=false → 게스트 모드로 통과
// ============================================================================
const AuthContext = createContext({ enabled: false, session: null, loading: false, isAdmin: true, signIn: () => {}, signOut: () => {} });

export const useAuth = () => useContext(AuthContext);

// 관리자 이메일 목록 (쉼표 구분). 게스트 모드(로컬)는 전원 관리자로 취급
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function AuthProvider({ children }) {
  const enabled = !!supabase;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(enabled);

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

  const signIn = (provider) => supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
      // 구글: 매번 전체 동의 화면 대신 계정 선택만
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  const signOut = () => supabase.auth.signOut();

  // 세션 사용자의 대표 이메일 + 연결된 모든 신원(identity)의 이메일을 수집
  // (카카오 우선 가입 후 구글을 연결해도 관리자로 인정되도록)
  const collectEmails = (user) => {
    if (!user) return [];
    const list = [user.email];
    (user.identities || []).forEach(i => { list.push(i.email); list.push(i.identity_data?.email); });
    return list.filter(Boolean).map(e => e.toLowerCase());
  };
  // 게스트 모드는 전원 관리자, 로그인 모드는 등록 이메일 중 하나라도 일치하면 관리자
  const isAdmin = !enabled || (!!session && collectEmails(session.user).some(e => ADMIN_EMAILS.includes(e)));

  return <AuthContext.Provider value={{ enabled, session, loading, isAdmin, signIn, signOut }}>{children}</AuthContext.Provider>;
}
