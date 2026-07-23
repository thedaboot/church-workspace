import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { store } from '../store/workspaceStore.js';

// ============================================================================
// 인증 컨텍스트 (Supabase OAuth: 구글 / 카카오)
// - supabase 미설정(.env 없음) 시 enabled=false → 게스트 모드로 통과
// ============================================================================
const AuthContext = createContext({ enabled: false, session: null, loading: false, signIn: () => {}, signOut: () => {} });

export const useAuth = () => useContext(AuthContext);

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

  const signIn = (provider) => supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
  const signOut = () => supabase.auth.signOut();

  return <AuthContext.Provider value={{ enabled, session, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}
