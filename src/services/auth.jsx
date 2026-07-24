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

  // 로그인 사용자 이름을 워크스페이스 프로필에 반영
  useEffect(() => {
    const name = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name;
    if (name) store.dispatch({ type: 'UPDATE_USER', payload: { name } });
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

  // 게스트 모드는 전원 관리자, 로그인 모드는 등록된 이메일만 관리자
  const isAdmin = !enabled || (!!session && ADMIN_EMAILS.includes((session.user.email || '').toLowerCase()));

  return <AuthContext.Provider value={{ enabled, session, loading, isAdmin, signIn, signOut }}>{children}</AuthContext.Provider>;
}
