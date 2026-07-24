import React from 'react';
import { useAuth } from '../services/auth.jsx';
import logoDark from '../assets/logo-dark.png';

// ============================================================================
// 로그인 화면 (Supabase OAuth — 구글 / 카카오)
// 노션 스펙의 "deep indigo night band"를 전면 배경으로 쓰는 단 하나의 다크 아일랜드
// ============================================================================
export function LoginScreen() {
  const { signIn } = useAuth();

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[#161f52]">
      {/* 밤하늘 배경: 인디고 그라데이션 + 은은한 스티커 글로우 */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#1a2461] via-[#213183] to-[#141b47]" />
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#62aef0]/20 blur-[120px]" />
      <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full bg-[#d6b6f6]/15 blur-[140px]" />
      <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full bg-[#ff64c8]/10 blur-[80px]" />

      <div className="relative w-full max-w-sm text-center animate-in fade-in zoom-in-95 duration-500">
        {/* 로고는 카드 밖, 밤하늘 위에 */}
        <img src={logoDark} alt="The 다붓" className="h-20 w-auto mx-auto mb-6 drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]" />
        <h1 className="text-xl font-bold text-white tracking-[-0.25px] mb-2">다붓 워크스페이스</h1>
        <p className="text-sm text-white/60 mb-10 leading-relaxed">함께 준비하고, 함께 섬기는 우리의 공간.<br />계정으로 시작해 주세요.</p>

        <div className="bg-white/[0.06] backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-elevated space-y-3">
          <button
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-[#31302e] text-sm font-medium py-3 rounded-full shadow-soft hover:bg-white/90 transition active:scale-95"
          >
            <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
            구글로 계속하기
          </button>
          <button
            onClick={() => signIn('kakao')}
            className="w-full flex items-center justify-center gap-2.5 bg-[#fee500] text-[#191919] text-sm font-medium py-3 rounded-full shadow-soft hover:bg-[#f6dc00] transition active:scale-95"
          >
            <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.26 4.66 6.65l-1.19 4.4c-.1.39.34.7.68.47l5.23-3.47c.2.01.41.02.62.02 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg>
            카카오로 계속하기
          </button>
        </div>

        <p className="text-[11px] text-white/35 mt-8">로그인하면 팀별 프로젝트와 업무에 접근할 수 있어요.</p>
      </div>
    </div>
  );
}
