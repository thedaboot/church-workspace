import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { FIELD } from './groupsParts.jsx';
import { BTN_CONFIRM } from './buttons.js';
import { addNewcomerCard } from '../services/welcome.js';

// ============================================================================
// 새가족 카드 — 새가족 QR을 찍으면 열리는 한 장(시안 · v5 4묶음 · mock/b5)
// ----------------------------------------------------------------------------
// **로그인 없이** 쓴다. 처음 온 날 카카오 로그인·승인 대기까지 시키면 대부분 거기서 멈춘다 — 앱 계정은 새신자로 등록된 뒤
// 기존 멤버 가입 QR로 만든다(components/joinQr.jsx). 낸 카드는 정착 보드 '첫 방문'에 선다(services/welcome.js).
// 연락처는 웰컴팀 연락에만 쓴다 — 무엇에 쓰는지 칸 아래에 적는다(정보가 밖으로 나가는 고지와 같은 자리 · CLAUDE.md 예외).
// 실제로 붙일 때: 로그인 없는 서버 함수(횟수 제한 · 봇 막기) → welcome_cards. 지금은 이 브라우저 localStorage.
// 문구는 시안 — 사용자 확정 전.
// ============================================================================
const HOW = ['친구 소개', '가족', 'SNS', '지나가다', '기타'];

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
    <div className="min-h-[100dvh] bg-canvas flex justify-center px-4 py-8 sm:py-14">
      <main data-newcomer-card="" className="w-full max-w-[420px] dc-screen">
        <img src="/icon-192.png" alt="" className="w-11 h-11 rounded-[12px] mb-4" />
        {done ? (
          <section data-newcomer-done="">
            <h1 className="text-[22px] font-extrabold text-fg tracking-[-0.4px]">{done.name}님, 반가워요!</h1>
            <p className="mt-2 text-[14px] text-fg-muted leading-relaxed">카드를 받았어요. 웰컴팀이 곧 연락드릴게요.</p>
            <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-[13px] text-fg-secondary leading-relaxed">
              주일 청년부 예배는 오후 2시, 본당 4층이에요.
            </div>
          </section>
        ) : (
          <>
            <h1 className="text-[22px] font-extrabold text-fg tracking-[-0.4px]">처음 오셨나요?</h1>
            <p className="mt-1.5 text-[14px] text-fg-muted leading-relaxed">새가족 카드를 써 주시면 웰컴팀이 연락드릴게요.</p>

            <div className="mt-6 rounded-lg border border-line bg-surface p-4 space-y-4">
              <label className="block">
                <span className="block mb-1 text-[11px] font-semibold text-fg-muted">이름</span>
                <input value={form.name} onChange={set('name')} autoComplete="name" aria-label="이름"
                  className={`${FIELD} w-full h-10 text-[14px]`} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-semibold text-fg-muted">연락처</span>
                <input value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="010-0000-0000" aria-label="연락처"
                  className={`${FIELD} w-full h-10 text-[14px] tabular-nums`} />
              </label>
              <label className="block">
                <span className="block mb-1 text-[11px] font-semibold text-fg-muted">태어난 해 <span className="font-normal">(선택)</span></span>
                <input value={form.birth_year} onChange={e => setForm(f => ({ ...f, birth_year: e.target.value.replace(/[^0-9]/g, '') }))}
                  inputMode="numeric" maxLength={4} placeholder="예: 1999" aria-label="태어난 해"
                  className={`${FIELD} w-[8rem] h-10 text-[14px] tabular-nums`} />
              </label>
              <div>
                <span className="block mb-1.5 text-[11px] font-semibold text-fg-muted">어떻게 오셨어요? <span className="font-normal">(선택)</span></span>
                <div className="flex flex-wrap gap-1.5">
                  {HOW.map(h => {
                    const on = form.how === h;
                    return (
                      <button key={h} type="button" aria-pressed={on} onClick={() => setForm(f => ({ ...f, how: on ? '' : h }))}
                        className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold border transition active:scale-95 ${
                          on ? 'bg-accent-weak text-accent-text border-transparent' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                        {on && <Check size={12} />}{h}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="block mb-1 text-[11px] font-semibold text-fg-muted">하고 싶은 말 <span className="font-normal">(선택)</span></span>
                <textarea value={form.note} onChange={set('note')} rows={2} aria-label="하고 싶은 말"
                  className={`${FIELD} w-full resize-none leading-relaxed py-2 text-[14px]`} />
              </label>
            </div>

            <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="w-[18px] h-[18px] m-0 mt-px shrink-0" style={{ accentColor: 'var(--app-accent)' }} data-newcomer-agree="" />
              <span className="text-[12.5px] text-fg-secondary leading-relaxed">
                이름과 연락처를 청년부 웰컴팀이 연락드리는 데 쓰는 것에 동의해요.
              </span>
            </label>

            <button type="button" onClick={submit} disabled={!ready || busy} data-newcomer-submit=""
              className={`${BTN_CONFIRM} mt-5 w-full h-11 justify-center text-[14px]`}>
              {busy && <Loader2 size={15} className="animate-spin" />}카드 보내기
            </button>
          </>
        )}
      </main>
    </div>
  );
}
