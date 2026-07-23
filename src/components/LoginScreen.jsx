import React from 'react';
import { useAuth } from '../services/auth.jsx';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

// ============================================================================
// 로그인 화면 (Supabase OAuth — 구글 / 카카오)
// ============================================================================
export function LoginScreen() {
  const { signIn } = useAuth();

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-line rounded-lg shadow-elevated p-8 text-center animate-in fade-in zoom-in-95 duration-300">
        <img src={logoLight} alt="The 다붓" className="h-16 w-auto mx-auto mb-2 dark:hidden" />
        <img src={logoDark} alt="The 다붓" className="h-16 w-auto mx-auto mb-2 hidden dark:block" />
        <h1 className="text-lg font-bold text-fg tracking-[-0.25px] mb-1">청년부 워크스페이스</h1>
        <p className="text-xs text-fg-muted mb-8">팀 계정으로 로그인해 주세요.</p>
        <div className="space-y-2.5">
          <button
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-2 bg-surface border border-line text-fg text-sm font-medium py-2.5 rounded-full shadow-soft hover:bg-surface-hover transition active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
            구글로 계속하기
          </button>
          <button
            onClick={() => signIn('kakao')}
            className="w-full flex items-center justify-center gap-2 bg-[#fee500] text-[#191919] text-sm font-medium py-2.5 rounded-full shadow-soft hover:bg-[#f6dc00] transition active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.26 4.66 6.65l-1.19 4.4c-.1.39.34.7.68.47l5.23-3.47c.2.01.41.02.62.02 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg>
            카카오로 계속하기
          </button>
        </div>
        <p className="text-[10px] text-fg-faint mt-8">로그인하면 팀별 프로젝트와 업무에 접근할 수 있어요.</p>
      </div>
    </div>
  );
}
