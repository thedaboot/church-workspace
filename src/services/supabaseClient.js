import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase 단일 클라이언트 인스턴스
// - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 미설정 시 null
//   → 앱은 로그인 없는 게스트(로컬) 모드로 동작
// ============================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      // 세션 지속성 명시 (기본값이지만 의도를 분명히 — 새로고침 후 로그인 유지)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const isCloudEnabled = () => !!supabase;
