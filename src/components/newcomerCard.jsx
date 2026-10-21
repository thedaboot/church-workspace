import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import logoLight from '../assets/logo-light.webp';
import { addNewcomerCard } from '../services/welcome.js';

// ============================================================================
// 새가족 카드 — 새가족 QR을 찍으면 열리는 한 장(시안 · v5 4묶음 · mock/b5)
// ----------------------------------------------------------------------------
// **로그인 화면(components/LoginScreen.jsx)과 한 벌의 모양이다** — 앱 밖에서 처음 보는 화면이라 같은 글로우 바탕·로고·
// 반투명 흰 판·둥근 버튼을 쓰고, 로그인 화면처럼 **언제나 밝다**(테마 토큰이 아니라 라이트 값 그대로 · 사용자 2026-10-21).
// **로그인 없이** 쓴다. 처음 온 날 카카오 로그인·승인 대기까지 시키면 대부분 거기서 멈춘다 — 앱 계정은 새신자로 등록된 뒤
// 워크스페이스 가입 QR로 만든다(components/joinQr.jsx). 낸 카드는 정착 보드 '첫 방문'에 선다(services/welcome.js).
// 연락처는 웰컴팀 컨택에만 쓴다 — 무엇에 쓰는지 적는다(정보가 밖으로 나가는 고지와 같은 자리 · CLAUDE.md 예외).
// 실제로 붙일 때: 로그인 없는 서버 함수(횟수 제한 · 봇 막기) → welcome_cards. 지금은 이 브라우저 localStorage.
// 문구는 시안 — 사용자 확정 전.
// ============================================================================
const HOW = ['친구 소개', '가족', 'SNS', '지나가다', '기타'];
// 로그인 화면의 라이트 값(index.css :root) 그대로
const INPUT = 'w-full h-11 px-3.5 rounded-lg bg-white border border-[#dcd8dc] text-[15px] text-[#191720] placeholder:text-[#a29daa] outline-none focus:border-[#3f6fc4] transition-colors';
const LABEL = 'block mb-1.5 text-[12px] font-semibold text-[#6b6675]';

export function NewcomerCardPage() {
  const [form, setForm] = useState({ name: '', phone: '', birth_year: '', how: '', note: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const ready = form.name.trim() && form.phone.replace(/[^0-9]/g, '').length >= 10 && agree;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    await new Promise(r => setTimeout(r, 500));
    const by = /^(19|20)\d{2}$/.test(form.birth_year) ? Number(form.birth_year) : null;
    setDone(addNewcomerCard({ ...form, name: form.name.trim(), birth_year: by }));
    setBusy(false);
  };

  return (
    <div className="relative min-h-dvh flex justify-center px-4 py-10 overflow-hidden bg-[#f6f5f7]">
      <div className="absolute -top-32 -left-24 w-[30rem] h-[30rem] rounded-full bg-[#62aef0]/25 blur-[130px]" />
      <div className="absolute -bottom-40 -right-24 w-[34rem] h-[34rem] rounded-full bg-[#d6b6f6]/35 blur-[140px]" />
      <div className="absolute top-1/4 right-1/4 w-56 h-56 rounded-full bg-[#ff64c8]/15 blur-[100px]" />
      <div className="absolute bottom-1/4 left-1/4 w-48 h-48 rounded-full bg-[#2a9d99]/12 blur-[90px]" />

      <main data-newcomer-card="" className="relative w-full max-w-sm my-auto animate-in fade-in zoom-in-95 duration-500">
        <img src={logoLight} width="328" height="240" alt="더다붓" decoding="async"
          className="h-16 w-auto mx-auto mb-5 drop-shadow-[0_8px_28px_rgba(55,53,47,0.18)]" />
        {done ? (
          <section data-newcomer-done="" className="text-center">
            <h1 className="text-xl font-bold text-[#2b2833] tracking-[-0.25px] mb-2">{done.name}님, 반가워요!</h1>
            <p className="text-sm text-[#6b6675] leading-relaxed">정보를 전송했어요.<br />웰컴팀이 곧 연락드릴게요.</p>
          </section>
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#2b2833] tracking-[-0.25px] mb-2 text-center">처음 오셨나요?</h1>
            <p className="text-sm text-[#6b6675] mb-7 leading-relaxed text-center">정보를 남겨 주시면<br />웰컴팀이 연락드릴게요.</p>

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
              <label className="block">
                <span className={LABEL}>태어난 해 <span className="font-normal">(선택)</span></span>
                <input value={form.birth_year} onChange={e => setForm(f => ({ ...f, birth_year: e.target.value.replace(/[^0-9]/g, '') }))}
                  inputMode="numeric" maxLength={4} placeholder="예: 1999" aria-label="태어난 해" className={`${INPUT} tabular-nums`} />
              </label>
              <div>
                <span className={LABEL}>어떻게 오셨어요? <span className="font-normal">(선택)</span></span>
                <div className="flex flex-wrap gap-1.5">
                  {HOW.map(h => {
                    const on = form.how === h;
                    return (
                      <button key={h} type="button" aria-pressed={on} onClick={() => setForm(f => ({ ...f, how: on ? '' : h }))}
                        className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold border transition active:scale-95 ${
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
                <span className="text-[12.5px] text-[#2b2833] leading-relaxed">이름과 연락처를 청년부 웰컴팀이 연락드리는 데 쓰는 것에 동의해요.</span>
              </label>
              <button type="button" onClick={submit} disabled={!ready || busy} data-newcomer-submit=""
                className="w-full flex items-center justify-center gap-2 bg-[#3f6fc4] text-white text-sm font-semibold py-3 rounded-full shadow-soft hover:bg-[#33589c] transition active:scale-95 disabled:opacity-40">
                {busy && <Loader2 size={16} className="animate-spin" />}정보 전송
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
