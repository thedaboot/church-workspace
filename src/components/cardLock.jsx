import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { usePopover } from '../hooks/usePopover.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { imeComposing } from '../utils.js';
import { LOCK_MOTION_MS, lockFormError } from '../services/cardLock.js';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { BTN } from './buttons.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { SecretInput } from './SecretInput.jsx';
import { matchSecret } from '../services/secretKeys.js';

// ============================================================================
// 업무 잠금(0099) — 자물쇠 그림 · 업무 창 머리줄 자물쇠 버튼 + `업무 잠그기` 팝오버 · 잠금 판 · 판이 접히고 걷히는 모션 · 보드 카드 자물쇠
// (사용자 결정 2026-10-13 · 시안 https://claude.ai/artifact/CYcKxtnnGp6miyJmDY9fgo '⑨ 업무 잠금')
// ----------------------------------------------------------------------------
// 실제 경계는 DB다(0099 — 본문·댓글·첨부·같이 쓰기·버전 기록이 서버에서 막힌다). 여기는 그리기와 입력만:
//   CardLockButton  머리줄 공유 **왼쪽**, 만든 사람에게만. 잠겨 있으면 accent-weak로 선다(리더만 보기 버튼과 같은 표기).
//                   팝오버 `업무 잠그기` · `비밀번호` · `비밀번호 확인` · `취소`/`잠그기`. 잠긴 뒤에도 같은 판으로 **다시 설정**하고,
//                   그때만 `잠금 해제`가 선다(만든 사람은 비밀번호 없이 푼다).
//   LockedPanel     못 여는 사람의 본문 자리 — 자물쇠 그림 · `이 업무는 현재 잠겨있어요` · 비밀번호 칸 + `입력`.
//   두 칸이 다르거나 비밀번호가 틀리면 **입력 칸이 좌우로 흔들리고 빨간 테두리**(.dc-shake · 토스트 없음 — §8).
//   LockGate        잠금 판 ↔ 본문. **잠길 때·열릴 때만** 움직인다(약 420ms · 앱 quint 하나 · index.css .dc-lock-*):
//                   잠길 때 고리가 내려와 닫히며 본문이 흐려져(blur) 판으로 접히고, 열릴 때 고리가 올라가며 판이 걷히고 본문이
//                   또렷해진다. 처음 그릴 때와 움직임 줄이기(prefers-reduced-motion)면 즉시. 다른 자리(보드 카드 자물쇠)는 움직이지 않는다.
//
// ── '비밀번호를 까먹었어요'(v5 B · 시안 승인 2026-10-17 · 0106 — 요청 칸 card_lock_requests · 마스터 알림 lock_reset · reset_card_lock) ──
//   LockedPanel     입력 줄 아래 글자 버튼 `비밀번호를 까먹었어요` → 확인 판(ConfirmPopover) → 그 업무에 요청을 적고
//                   그 자리는 `개발자에게 요청했어요`가 된다(onForgot · asked — 부르는 쪽 modals.jsx가 넘긴다).
//   LockResetNotice 마스터에게, 요청이 걸린 잠긴 업무의 보기 화면 위 한 줄 — `○○님이 비밀번호를 다시 설정해 달라고 요청했어요` +
//                   `새 비밀번호 설정`(잠그기 팝오버와 같은 두 칸 · LockForm 한 벌 · 폰은 그 줄 아래 인라인). 설정하면 요청이 지워진다.
//   잠금 판은 본문 자리를 끝까지 채운다(flex-1 · 시안 2차 — 판 아래 창 바닥까지 빈 띠가 남았다 · 내용은 가운데).
//   게스트는 마스터이자 요청한 사람이라(auth 기본값) 둘이 한 화면에 같이 선다(요청은 그 업무의 로컬 값 · 알림 없음).
//   클라우드는 업무 창이 요청 표를 읽었을 때만 버튼을 세운다(modals.jsx — 0106 전이면 예전 잠금 판 그대로).
// ============================================================================

// 자물쇠 그림 — lucide Lock과 같은 선(몸통 + 고리). 고리만 따로 움직이게 path에 클래스를 단다.
export function LockGlyph({ size = 16, strokeWidth = 2, className = '', ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} {...rest}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path className="dc-lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// 보드 카드·상시 칩 제목 앞(시안 ③) — 글자 줄 안의 inline-block(TabLock과 같은 이유 · §6-9-bu). 움직이지 않는다.
export function CardLockMark({ task, size = 12 }) {
  if (!task?.locked) return null;
  return <LockGlyph size={size} strokeWidth={2.4} data-card-lock="" className="inline-block shrink-0 align-[-1px] mr-[5px] text-fg-muted" />;
}

// 흔들림 — 틀린 칸(refs[이름])에 .dc-shake를 **다시** 건다(연달아 틀려도 또 흔들린다 · 칸을 새로 만들지 않아 초점이 남는다).
// 빨간 테두리는 다시 칠 때까지 남는다. 움직임 줄이기면 CSS가 흔들림만 끈다(테두리는 그대로).
function useShake(refs) {
  const [bad, setBad] = useState(null);     // 틀린 칸 이름
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = bad && refs[bad]?.current;
    if (!el) return;
    el.classList.remove('dc-shake');
    void el.offsetWidth;                    // 애니메이션을 처음부터
    el.classList.add('dc-shake');
    el.focus();
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { bad, flag: (which) => { setBad(which); setTick(t => t + 1); }, clear: () => setBad(null) };
}
const fieldCls = (bad) => `h-[34px] px-2.5 rounded-lg bg-surface-2 text-[13px] text-fg outline-none border transition-colors ${
  bad ? 'border-tag-red-fg' : 'border-line focus:border-accent'}`;

// 잠그기 팝오버의 두 칸 + 아래 줄 한 벌 — 머리줄 자물쇠(CardLockButton)와 마스터의 새 비밀번호 설정(ResetLockButton)가 같이 쓴다.
// onSubmit(pw) → 약속(실패면 던진다 — 부르는 쪽이 토스트) · 맞으면 onDone. extra는 왼쪽 끝 버튼(잠금 해제).
function LockForm({ open, title, submitLabel, onSubmit, onCancel, onDone, extra = null, busy: outerBusy = false }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);
  const pw2Ref = useRef(null);
  const shake = useShake({ pw: pwRef, confirm: pw2Ref });
  useEffect(() => { if (!open) { setPw(''); setPw2(''); shake.clear(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // 첫 칸 초점은 **굴리지 않고** 준다(autoFocus는 브라우저가 칸을 보이게 하려고 문서·창을 밀어 화면이 뛰었다 · 시안 2차).
  // 키보드가 올라온 뒤 칸이 가리면 App의 커서 따라가기가 구르는 칸만 민다.
  useEffect(() => { if (open) pwRef.current?.focus({ preventScroll: true }); }, [open]);
  const submit = async () => {
    if (busy || outerBusy) return;
    const bad = lockFormError(pw, pw2);
    if (bad) { shake.flag(bad); return; }
    setBusy(true);
    try { await onSubmit(pw); onDone?.(); } catch { /* 부르는 쪽이 토스트 */ } finally { setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !imeComposing(e)) { e.preventDefault(); submit(); } };
  return (
    <div data-card-lock-pop="" className="flex flex-col gap-2">
      <div className="text-[12.5px] font-bold text-fg">{title}</div>
      <label className="flex flex-col gap-1 text-[11px] text-fg-muted">비밀번호
        <SecretInput ref={pwRef} value={pw}
          onValue={v => { setPw(v); shake.clear(); }} onKeyDown={onKey} data-lock-field="pw" aria-invalid={shake.bad === 'pw'}
          className={fieldCls(shake.bad === 'pw')} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-fg-muted">비밀번호 확인
        <SecretInput ref={pw2Ref} value={pw2}
          onValue={v => { setPw2(v); shake.clear(); }} onKeyDown={onKey} data-lock-field="confirm" aria-invalid={shake.bad === 'confirm'}
          className={fieldCls(shake.bad === 'confirm')} />
      </label>
      <div className="flex items-center gap-1.5 justify-end mt-0.5">
        {extra}
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-[7px] bg-surface-hover text-fg-muted text-[12px] font-semibold hover:bg-line">취소</button>
        <button type="button" onClick={submit} disabled={busy || outerBusy} data-lock-submit=""
          className="px-3 py-1.5 rounded-[7px] bg-accent hover:bg-accent-strong text-white text-[12px] font-bold disabled:opacity-40">{submitLabel}</button>
      </div>
    </div>
  );
}

// 머리줄 자물쇠(만든 사람에게만 — 부르는 쪽이 가른다). onLock(pw) / onUnlock() → 약속(실패면 던진다 — 부르는 쪽이 토스트).
export function CardLockButton({ locked, onLock, onUnlock }) {
  const pop = usePopover(250, 190, { gap: 8, measure: true });
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [stir, setStir] = useState(null);   // 'shut' | 'lift' — 버튼 고리가 한 번 움직인다
  useEffect(() => {
    if (!stir) return undefined;
    const t = setTimeout(() => setStir(null), LOCK_MOTION_MS);
    return () => clearTimeout(t);
  }, [stir]);
  const done = (kind) => { pop.close(); if (!reduced) setStir(kind); };
  const release = async () => {
    if (busy) return;
    setBusy(true);
    try { await onUnlock(); done('lift'); } catch { /* 부르는 쪽이 토스트 */ } finally { setBusy(false); }
  };
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={pop.toggle} data-card-lock-btn="" aria-expanded={pop.open} aria-pressed={locked}
          title="업무 잠그기" aria-label="업무 잠그기"
          className={`w-7 h-7 inline-flex items-center justify-center rounded-md transition active:scale-95 shrink-0 ${locked
            ? 'bg-accent-weak text-accent-text' : 'text-fg-faint hover:text-accent-text hover:bg-surface-hover'}`}>
          <LockGlyph size={15} strokeWidth={2.2} className={stir ? `dc-lock-${stir}` : ''} data-lock-stir={stir || undefined} />
        </button>
      </span>
      {pop.panel('z-[90] bg-surface border border-line rounded-lg shadow-elevated px-3.5 py-3', (
        <LockForm open={pop.open} title="업무 잠그기" submitLabel="잠그기" onSubmit={onLock} onCancel={pop.close} onDone={() => done('shut')} busy={busy}
          extra={locked && (
            <button type="button" onClick={release} disabled={busy} data-lock-release=""
              className="mr-auto px-2 py-1.5 rounded-[7px] text-[12px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-hover disabled:opacity-40">잠금 해제</button>
          )} />
      ))}
    </span>
  );
}

// 마스터의 새 비밀번호 설정 — 잠그기 팝오버와 같은 두 칸. onReset(pw) → 약속(실패면 던진다).
// 데스크톱은 버튼에 붙은 팝오버, **폰은 그 줄 아래에 그대로 펼친다**(시안 2차 — 떠 있는 판(fixed) 안의 칸에 초점이 가면
// 아이폰이 키보드를 올리며 화면 전체를 밀었다 · groupsParts 피커가 터치에서 인라인인 것과 같은 판단 §6-9-an).
// 인라인이면 칸은 업무 창 본문(구르는 칸) 안이라 App의 커서 따라가기가 그 칸만 민다.
const RESET_LABEL = '새 비밀번호 설정';
function ResetLockButton({ onReset }) {
  const pop = usePopover(250, 190, { gap: 8, measure: true });
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={pop.toggle} aria-expanded={pop.open} data-lock-reset-open="" className={`${BTN} whitespace-nowrap`}>{RESET_LABEL}</button>
      </span>
      {pop.panel('z-[90] bg-surface border border-line rounded-lg shadow-elevated px-3.5 py-3', (
        <LockForm open={pop.open} title={RESET_LABEL} submitLabel="설정" onSubmit={onReset} onCancel={pop.close} onDone={pop.close} />
      ))}
    </span>
  );
}

// 마스터에게 — 요청이 걸린 잠긴 업무의 보기 화면 위 한 줄. by: 가장 최근에 요청한 사람 이름(여럿이면 그 사람 · 설정하면 다 걷힌다).
export function LockResetNotice({ by, onReset }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  return (
    <div data-lock-reset-ask="" className="mt-4 pl-3 pr-2 py-2 rounded-[10px] bg-accent-weak">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <LockGlyph size={15} strokeWidth={2.2} className="text-accent-text shrink-0" />
        <span className="flex-1 min-w-[160px] text-[12.5px] leading-snug text-fg">{by}님이 비밀번호를 다시 설정해 달라고 요청했어요</span>
        {isMobile ? (
          !open && <button type="button" onClick={() => setOpen(true)} data-lock-reset-open="" className={`${BTN} whitespace-nowrap`}>{RESET_LABEL}</button>
        ) : <ResetLockButton onReset={onReset} />}
      </div>
      {isMobile && open && (
        <div data-lock-reset-inline="" className="mt-2 mb-1 mr-1 px-3 py-3 rounded-[9px] bg-surface border border-line">
          <LockForm open title={RESET_LABEL} submitLabel="설정" onSubmit={onReset} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

// 못 여는 사람의 본문 자리. onUnlock(pw) → 약속<boolean>(맞으면 true · 틀렸거나 1분 5회를 넘었으면 false · 통신 실패는 던진다).
// stir: LockGate가 넘기는 'shut' | 'lift' — 판의 자물쇠 고리가 한 번 움직인다.
// onForgot() → 약속 — 없으면 `비밀번호를 까먹었어요`가 서지 않는다(클라우드에서 요청 표를 못 읽었을 때). asked: 내가 이미 요청했나.
export function LockedPanel({ onUnlock, stir = null, onForgot = null, asked = false }) {
  const [pw, setPw] = useState('');
  const [raw, setRaw] = useState('');   // 친 글자 그대로 — 예전에 한글로 건 비밀번호(secretKeys.js)
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const shake = useShake({ pw: inputRef });
  const submit = async () => {
    if (busy) return;
    if (!pw) { shake.flag('pw'); return; }
    setBusy(true);
    let ok = false;
    try { ok = await matchSecret(onUnlock, pw, raw); } catch { ok = null; } finally { setBusy(false); }
    if (ok === false) shake.flag('pw');
  };
  return (
    <div data-lock-panel="" className="flex-1 flex flex-col items-center justify-center gap-2.5 pt-[34px] pb-[26px] px-4 rounded-[10px] bg-surface-2">
      <LockGlyph size={26} strokeWidth={1.8} className={`text-fg-faint ${stir ? `dc-lock-${stir}` : ''}`} />
      <div className="text-[13px] leading-relaxed text-center text-fg">이 업무는 현재 잠겨있어요</div>
      <div className="flex gap-1.5 w-[260px] max-w-full">
        <SecretInput ref={inputRef} value={pw} placeholder="비밀번호" aria-label="비밀번호"
          onValue={(v, r) => { setPw(v); setRaw(r); shake.clear(); }}
          onKeyDown={e => { if (e.key === 'Enter' && !imeComposing(e)) { e.preventDefault(); submit(); } }}
          data-lock-field="unlock" aria-invalid={!!shake.bad}
          className={`flex-1 min-w-0 h-9 px-[11px] rounded-[9px] bg-surface text-[13px] text-fg placeholder:text-fg-muted outline-none border transition-colors ${
            shake.bad ? 'border-tag-red-fg' : 'border-line focus:border-accent'}`} />
        <button type="button" onClick={submit} disabled={busy} data-lock-enter=""
          className="h-9 px-3.5 rounded-[9px] bg-accent hover:bg-accent-strong text-white text-[12.5px] font-bold shrink-0 disabled:opacity-40">입력</button>
      </div>
      {onForgot && (asked ? (
        <div data-lock-forgot-asked="" className="mt-0.5 text-[11.5px] text-fg-muted">개발자에게 요청했어요</div>
      ) : (
        <ConfirmPopover message="개발자 분에게 비밀번호를 다시 설정해 달라고 요청할까요?" confirmLabel="요청하기" tone="ok" onConfirm={onForgot}>
          <button type="button" data-lock-forgot=""
            className="mt-0.5 text-[11.5px] text-fg-muted underline underline-offset-2 decoration-line hover:text-fg">비밀번호를 까먹었어요</button>
        </ConfirmPopover>
      ))}
    </div>
  );
}

// 잠금 판 ↔ 본문. closed가 **바뀌는 순간에만** 두 겹을 한 칸에 겹쳐 움직이고(잠길 때 본문 흐려짐 + 판 접혀 들어옴 ·
// 열릴 때 판 걷힘 + 본문 또렷해짐) LOCK_MOTION_MS 뒤 한 겹만 남긴다. 처음 그릴 때 · 움직임 줄이기면 그 자리에서 바뀐다.
// panel(stir)는 판을 그리는 함수 — 움직이는 동안 'shut'|'lift'를 받아 고리를 움직인다.
export function LockGate({ closed, panel, children }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(null);   // 'closing' | 'opening' | null
  const prev = useRef(closed);
  useLayoutEffect(() => {
    if (prev.current === closed) return undefined;
    prev.current = closed;
    if (reduced) { setPhase(null); return undefined; }
    setPhase(closed ? 'closing' : 'opening');
    const t = setTimeout(() => setPhase(null), LOCK_MOTION_MS);
    return () => clearTimeout(t);
  }, [closed, reduced]);
  if (!phase) return closed ? panel(null) : children;
  const closing = phase === 'closing';
  return (
    <div className="grid" data-lock-phase={phase}>
      <div className={`[grid-area:1/1] min-w-0 ${closing ? 'dc-lock-blur-out pointer-events-none' : 'dc-lock-blur-in'}`}>{children}</div>
      <div className={`[grid-area:1/1] self-start min-w-0 ${closing ? 'dc-lock-veil-in' : 'dc-lock-veil-out pointer-events-none'}`}>
        {panel(closing ? 'shut' : 'lift')}
      </div>
    </div>
  );
}
