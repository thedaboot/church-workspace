import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase 클라이언트 (.env의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 사용)
// ============================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ponytail: 환경변수 미설정 시 null — 앱은 로그인 없는 게스트 모드로 동작
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
