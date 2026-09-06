import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../services/auth.jsx';
import logoLight from '../assets/logo-light.png';

// ============================================================================
// 로그인 화면 (Supabase OAuth — 구글 / 카카오)
// 웜 페이퍼 캔버스 + 스티커 팔레트 파스텔 글로우 (노션 daylight 톤)
// ============================================================================
// 승인 대기 화면도 여기 있다 — 같은 배경·같은 상자를 쓴다. 따로 만들면 로그인
// 직후에 화면이 통째로 갈아치워진 것처럼 보인다(사용자가 문구까지 정했다).
export function LoginScreen({ waiting = false }) {
  const { signIn, signOut, session, autoSignInKakao } = useAuth();
  const myName = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || '';
  // 카카오톡 인앱 브라우저면 카카오 로그인을 자동으로 시작한다(한 번만 — auth.jsx 주석).
  // 승인 대기 화면(waiting)은 이미 로그인한 상태라 해당 없다. 시작했으면 그 버튼을
  // 로딩으로 보여 준다 — 떠나기 전 잠깐 동안 두 번 눌리지 않게.
  const [auto, setAuto] = useState(false);
  // autoSignInKakao는 렌더마다 새 함수라 deps에 넣으면 효과가 매 렌더 돈다(표식 덕에 무해하지만 헛일이다)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!waiting && autoSignInKakao()) setAuto(true); }, [waiting]);

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4 overflow-hidden bg-[#f6f5f7]">
      {/* 파스텔 글로우: 스티커 팔레트를 장식으로만 */}
      <div className="absolute -top-32 -left-24 w-[30rem] h-[30rem] rounded-full bg-[#62aef0]/25 blur-[130px]" />
      <div className="absolute -bottom-40 -right-24 w-[34rem] h-[34rem] rounded-full bg-[#d6b6f6]/35 blur-[140px]" />
      <div className="absolute top-1/4 right-1/4 w-56 h-56 rounded-full bg-[#ff64c8]/15 blur-[100px]" />
      <div className="absolute bottom-1/4 left-1/4 w-48 h-48 rounded-full bg-[#2a9d99]/12 blur-[90px]" />

      <div className="relative w-full max-w-sm text-center animate-in fade-in zoom-in-95 duration-500">
        {/* width·height는 원본 크기다(640×469). 없으면 그림이 아직 안 왔을 때 `w-auto`가
            칸을 가로 전체로 벌려서, 깨진 이미지 아이콘이 왼쪽 끝에 붙고 alt 글자만 가운데
            뜬다 — 카카오톡 인앱에서 실제로 그렇게 보였다(2026-09-06). 비율이 적혀 있으면
            들어오기 전에도 자리가 109×80으로 잡혀서 그림만 나중에 채워진다. */}
        <img src={logoLight} width="640" height="469" alt="더다붓" decoding="async" fetchPriority="high"
          className="h-20 w-auto mx-auto mb-6 drop-shadow-[0_8px_28px_rgba(55,53,47,0.18)]" />
        <h1 className="text-xl font-bold text-[#2b2833] tracking-[-0.25px] mb-2">더다붓 워크스페이스</h1>
        <p className="text-sm text-[#6b6675] mb-10 leading-relaxed">함께 준비하고, 함께 섬기는 청년들의 공간<br />같이 만들어봐요!</p>

        {waiting ? (
          <div className="bg-white/80 backdrop-blur-md border border-[#dcd8dc] rounded-xl p-7 shadow-elevated">
            <p className="text-sm text-[#2b2833] leading-relaxed">
              가입 승인을 관리자에게 요청했어요.
              <br /><br />
              승인을 기다려주세요 !
            </p>
            {myName && <p className="text-[11px] text-[#a39e98] mt-5">{myName}님으로 로그인했어요</p>}
            <button
              onClick={signOut}
              className="mt-5 w-full py-2.5 rounded-full border border-[#dcd8dc] bg-white text-[#6b6675] text-[13px] font-medium hover:bg-[#f6f5f7] transition active:scale-95"
            >다른 계정으로 로그인</button>
          </div>
        ) : (
        <div className="bg-white/80 backdrop-blur-md border border-[#dcd8dc] rounded-xl p-6 shadow-elevated space-y-3">
          <button
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-2.5 bg-white border border-[#dcd8dc] text-[#2b2833] text-sm font-medium py-3 rounded-full shadow-soft hover:bg-[#f6f5f7] transition active:scale-95"
          >
            <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
            구글로 계속하기
          </button>
          <button
            onClick={() => signIn('kakao')} disabled={auto}
            className="w-full flex items-center justify-center gap-2.5 bg-[#fee500] text-[#191919] text-sm font-medium py-3 rounded-full shadow-soft hover:bg-[#f6dc00] transition active:scale-95 disabled:opacity-70"
          >
            {auto
              ? <Loader2 size={17} className="animate-spin" />
              : <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.26 4.66 6.65l-1.19 4.4c-.1.39.34.7.68.47l5.23-3.47c.2.01.41.02.62.02 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg>}
            카카오로 계속하기
          </button>
        </div>
        )}

        <p className="text-[11px] text-[#a39e98] mt-8">
          {waiting ? '승인되면 바로 들어올 수 있어요.' : '로그인하면 팀별 프로젝트와 업무에 접근할 수 있어요.'}
        </p>
      </div>
    </div>
  );
}
