import { useLayoutEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import logoLight from '../assets/logo-light.webp';
import { submitNewcomer } from '../services/welcome.js';

// ============================================================================
// 새가족 정보 입력 — 새가족 QR을 찍으면 열리는 한 장(v5 4묶음 · 사용자 승인 시안 mock/b5 · 0120)
// ----------------------------------------------------------------------------
// **로그인 화면(components/LoginScreen.jsx)과 한 벌의 모양이다** — 앱 밖에서 처음 보는 화면이라 같은 글로우 바탕·로고·
// 반투명 흰 판·둥근 버튼을 쓰고, 로그인 화면처럼 **언제나 밝다**(테마 토큰이 아니라 라이트 값 그대로 · 사용자 2026-10-21).
// **로그인 없이** 쓴다. 처음 온 날 카카오 로그인·승인 대기까지 시키면 대부분 거기서 멈춘다 — 앱 계정은 새신자로 등록된 뒤
// 워크스페이스 가입 QR로 만든다(components/joinQr.jsx). 보낸 정보는 정착 보드 첫 칸에 선다(services/welcome.js).
// 받는 것은 이름·연락처(필수)와 어떻게 왔는지·하고 싶은 말(선택)뿐이다 — 태어난 해는 묻지 않는다(사용자 2026-10-21).
// 연락처는 웰컴팀 컨택에만 쓴다 — 무엇에 쓰는지 적는다(정보가 밖으로 나가는 고지와 같은 자리 · CLAUDE.md 예외).
//
// 전송 뒤 넘어가는 모양(사용자 2026-10-21 — "모달이 닫히고 로고가 자연스럽게 내려오는"):
//   ① 입력 판·머리말이 살짝 내려가며 옅어진다(280ms) → ② 화면이 '반가워요' 한 장으로 바뀌고, 로고는 **있던 자리에서**
//   새 자리(가운데)로 미끄러져 내려온다(FLIP · 650ms) → ③ 인사 글이 뒤따라 떠오른다. 이징은 앱 하나(--ease-out-quint).
//   움직임 줄이기면 ①·② 없이 바로 바뀐다.
// 저장: 로그인 없는 정의자 함수 submit_welcome_card(0120 · 길이·형식 · 10분 30장) → welcome_cards. 게스트는 이 브라우저 localStorage.
// ============================================================================
const HOW = ['친구 소개', '가족', 'SNS', '교회 탐색', '기타'];
// 로그인 화면의 라이트 값(index.css :root) 그대로
const INPUT = 'w-full h-11 px-3.5 rounded-lg bg-white border border-[#dcd8dc] text-[15px] text-[#191720] placeholder:text-[#a29daa] outline-none focus:border-[#3f6fc4] transition-colors';
const LABEL = 'block mb-1.5 text-[12px] font-semibold text-[#6b6675]';
const EASE = 'var(--ease-out-quint)';
const LEAVE_MS = 280;
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function NewcomerCardPage() {
  const [form, setForm] = useState({ name: '', phone: '', how: '', note: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('form');   // form → leaving → done
  const [done, setDone] = useState(null);
  const logoRef = useRef(null);
  const fromTop = useRef(null);
  const [greet, setGreet] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const ready = form.name.trim() && form.phone.replace(/[^0-9]/g, '').length >= 10 && agree;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    let card;
    try {
      card = await submitNewcomer({ ...form, name: form.name.trim() });
    } catch (e) {
      // 앱 셸 밖이라 토스트가 없다 — 버튼 위 한 줄로 말한다(10분 30장을 넘었을 때도 같은 말 · 0120)
      console.error('[welcome] 새가족 정보를 보내지 못했어요:', e);
      setFailed(true); setBusy(false);
      return;
    }
    setDone(card);
    if (reduced()) { setPhase('done'); setGreet(true); return; }
    setPhase('leaving');
    setTimeout(() => {
      fromTop.current = logoRef.current?.getBoundingClientRect().top ?? null;
      setPhase('done');
    }, LEAVE_MS);
  };

  // 로고 FLIP — 바뀐 자리에서 옛 자리만큼 거꾸로 밀어 두었다가 0으로 풀어 준다
  useLayoutEffect(() => {
    if (phase !== 'done' || fromTop.current == null) return undefined;
    const el = logoRef.current;
    const dy = fromTop.current - el.getBoundingClientRect().top;
    fromTop.current = null;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    el.getBoundingClientRect();   // 거꾸로 민 자리를 한 번 그리게
    el.style.transition = `transform .65s ${EASE}`;
    el.style.transform = '';
    const t = setTimeout(() => setGreet(true), 260);
    return () => clearTimeout(t);
  }, [phase]);

  const leaving = phase === 'leaving';
  const fade = {
    transition: `opacity ${LEAVE_MS}ms ${EASE}, transform ${LEAVE_MS}ms ${EASE}`,
    opacity: leaving ? 0 : 1,
    transform: leaving ? 'translateY(14px) scale(.98)' : 'none',
  };

  return (
    <div className="relative min-h-dvh flex justify-center px-4 py-10 overflow-hidden bg-[#f6f5f7]">
      <div className="absolute -top-32 -left-24 w-[30rem] h-[30rem] rounded-full bg-[#62aef0]/25 blur-[130px]" />
      <div className="absolute -bottom-40 -right-24 w-[34rem] h-[34rem] rounded-full bg-[#d6b6f6]/35 blur-[140px]" />
      <div className="absolute top-1/4 right-1/4 w-56 h-56 rounded-full bg-[#ff64c8]/15 blur-[100px]" />
      <div className="absolute bottom-1/4 left-1/4 w-48 h-48 rounded-full bg-[#2a9d99]/12 blur-[90px]" />

      <main data-newcomer-card="" className="relative w-full max-w-sm my-auto animate-in fade-in zoom-in-95 duration-500">
        <img ref={logoRef} src={logoLight} width="328" height="240" alt="더다붓" decoding="async"
          className="h-16 w-auto mx-auto mb-5 drop-shadow-[0_8px_28px_rgba(55,53,47,0.18)]" />
        {phase === 'done' ? (
          <section data-newcomer-done="" className="text-center"
            style={{ transition: `opacity .5s ${EASE}, transform .5s ${EASE}`, opacity: greet ? 1 : 0, transform: greet ? 'none' : 'translateY(8px)' }}>
            <h1 className="text-xl font-bold text-[#2b2833] tracking-[-0.25px] mb-2">{done?.name}님, 반가워요!</h1>
            <p className="text-sm text-[#6b6675] leading-relaxed">정보를 전송했어요.<br />더다붓 웰컴팀이 곧 연락드릴게요.</p>
          </section>
        ) : (
          <div style={fade}>
            <h1 className="text-xl font-bold text-[#2b2833] tracking-[-0.25px] mb-2 text-center">처음 오셨나요?</h1>
            <p className="text-sm text-[#6b6675] mb-7 leading-relaxed text-center">정보를 남겨 주시면<br />더다붓 웰컴팀이 연락드릴게요.</p>

            <div className="bg-white/80 backdrop-blur-md border border-[#dcd8dc] rounded-xl p-5 shadow-elevated space-y-4">
              <label className="block">
                <span className={LABEL}>이름</span>
                <input value={form.name} onChange={set('name')} autoComplete="name" aria-label="이름" className={INPUT} />
              </label>
              <label className="block">
                <span className={LABEL}>연락처</span>
                <input value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="010-0000-0000" aria-label="연락처"
                  className={`${INPUT} tabular-nums`} />
              </label>
              <div>
                <span className={LABEL}>어떻게 오셨어요? <span className="font-normal">(선택)</span></span>
                {/* 칩은 한 줄 — 넘치면 줄을 바꾸지 않고 옆으로 민다(사용자 2026-10-21 · 앱의 칩 줄 TEAM_CHIP_ROW와 같은 짜임).
                    판 가장자리까지 밀리게 판 여백(-mx-5 px-5)만큼 넓히고, 끝 여백은 ::after(넘친 내용에는 padding이 안 걸린다) */}
                <div className="-mx-5 px-5 flex items-center gap-1.5 flex-nowrap min-w-0 overflow-x-auto scrollbar-hide x-scroll-lock after:content-[''] after:shrink-0 after:w-3.5" data-how-row="">
                  {HOW.map(h => {
                    const on = form.how === h;
                    return (
                      <button key={h} type="button" aria-pressed={on} onClick={() => setForm(f => ({ ...f, how: on ? '' : h }))}
                        className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold border transition active:scale-95 ${
                          on ? 'bg-[#e8eefa] text-[#3f6fc4] border-transparent' : 'bg-white text-[#6b6675] border-[#dcd8dc] hover:bg-[#f6f5f7]'}`}>
                        {on && <Check size={12} />}{h}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className={LABEL}>하고 싶은 말 <span className="font-normal">(선택)</span></span>
                <textarea value={form.note} onChange={set('note')} rows={2} aria-label="하고 싶은 말"
                  className={`${INPUT} h-auto py-2.5 resize-none leading-relaxed`} />
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} data-newcomer-agree=""
                  className="w-[18px] h-[18px] m-0 mt-px shrink-0" style={{ accentColor: '#3f6fc4' }} />
                <span className="text-[12.5px] text-[#2b2833] leading-relaxed">이름과 연락처를 연락드리는 데 사용하는 것에 동의해요.</span>
              </label>
              {failed && <p className="text-[12.5px] text-[#993731] leading-relaxed" role="alert" data-newcomer-failed="">정보를 전송하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
              <button type="button" onClick={submit} disabled={!ready || busy} data-newcomer-submit=""
                className="w-full flex items-center justify-center gap-2 bg-[#3f6fc4] text-white text-sm font-semibold py-3 rounded-full shadow-soft hover:bg-[#33589c] transition active:scale-95 disabled:opacity-40">
                {busy && <Loader2 size={16} className="animate-spin" />}정보 전송
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
