import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, ChevronDown, Phone, Loader2 } from 'lucide-react';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { Fold } from './Fold.jsx';
import { showToast } from './Toast.jsx';
import { addPerson, kstToday } from '../services/roster.js';
import * as W from '../services/welcome.js';

// ============================================================================
// 새가족 정착 보드 — 모임 > '새가족' 탭(시안 · v5 4묶음 · mock/b5 · 게스트 시연만)
// ----------------------------------------------------------------------------
// 칸 일곱은 services/welcome.js STAGES(사용자가 알려 준 웰컴팀 순서 2026-10-21). 칸 = 마지막으로 한 일.
//   ≥768: 일곱 칸이 한 줄(좁으면 가로 스크롤 · §8 같은 종류가 이어지는 줄).  <768: 단계마다 묶은 세로 목록.
// 카드를 누르면 시트 — 단계 줄(누르면 그 단계로 옮긴다 · "아닐 수도 있어")과 그 단계에서 할 일 버튼.
// '새신자로 등록'은 청년 명단에 사람을 넣고 newcomer_at을 그날로(0119 · 명단 배지 석 달).
// 문구는 전부 시안 — 사용자 확정 전.
// ============================================================================
const SUNS = ['꼬순', 'TT순', '새싹순'];   // 시안 — 실제로는 그 해 순 목록(groups type sun)
const md = (ymd) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${+m[1]}월 ${+m[2]}일` : ''; };

function useCards() {
  const cache = useRef(null);
  const get = () => { cache.current = cache.current || W.loadCards(); return cache.current; };
  return useSyncExternalStore((f) => W.onWelcomeChange(() => { cache.current = null; f(); }), get);
}

function Card({ c, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(c.id)} data-welcome-card={c.id}
      className="welcome-card w-full text-left rounded-md border border-line bg-surface px-3 py-2.5 hover:bg-surface-hover transition active:scale-[.98]">
      <span className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-fg truncate">{c.name}</span>
        {c.owner && <span className="ml-auto shrink-0 text-[10.5px] text-fg-muted">{c.owner}</span>}
      </span>
      <span className="block mt-0.5 text-[11px] text-fg-muted truncate">{W.nextStep(c)}</span>
      <span className="block mt-1 text-[10.5px] text-fg-faint tabular-nums">첫 방문 {md(c.visits[0])}</span>
    </button>
  );
}

export function WelcomeBoard({ meName = '나' }) {
  const cards = useCards();
  const [openId, setOpenId] = useState(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const by = (k) => cards.filter(c => c.stage === k);
  const held = by(W.HOLD);
  const open = cards.find(c => c.id === openId) || null;

  return (
    <section className="welcome-board dc-screen" data-welcome-board="">
      {/* 데스크톱 — 일곱 칸 한 줄 */}
      <div className="hidden md:block overflow-x-auto -mx-1 px-1 pb-2">
        <div className="grid gap-2.5 min-w-[1080px]" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {W.STAGES.map(([k, label]) => (
            <div key={k} className="min-w-0 rounded-lg bg-canvas p-2" data-stage={k}>
              <p className="flex items-center gap-1.5 px-1 pb-2">
                <span className="text-[12px] font-bold text-fg">{label}</span>
                <span className="text-[11px] text-fg-muted tabular-nums">{by(k).length}</span>
              </p>
              <div className="space-y-1.5">
                {by(k).map(c => <Card key={c.id} c={c} onOpen={setOpenId} />)}
                {!by(k).length && <p className="px-1 py-3 text-[11px] text-fg-faint">없어요</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 폰 — 단계마다 묶은 목록 */}
      <div className="md:hidden space-y-4">
        {W.STAGES.map(([k, label]) => (
          <div key={k} data-stage={k}>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-[12.5px] font-bold text-fg shrink-0">{label}</h3>
              <span className="text-[11px] text-fg-muted tabular-nums">{by(k).length}</span>
              <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
            </div>
            <div className="space-y-1.5">
              {by(k).map(c => <Card key={c.id} c={c} onOpen={setOpenId} />)}
              {!by(k).length && <p className="py-1 text-[11px] text-fg-faint">없어요</p>}
            </div>
          </div>
        ))}
      </div>

      {held.length > 0 && (
        <div className="mt-5">
          <button type="button" onClick={() => setHoldOpen(v => !v)} aria-expanded={holdOpen}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg-muted hover:text-fg transition-colors">
            <ChevronDown size={14} className={`transition-transform ${holdOpen ? '' : '-rotate-90'}`} />보류 {held.length}명
          </button>
          <Fold open={holdOpen}>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">{held.map(c => <Card key={c.id} c={c} onOpen={setOpenId} />)}</div>
          </Fold>
        </div>
      )}

      {open && <CardSheet c={open} meName={meName} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function CardSheet({ c, meName, onClose }) {
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [busy, setBusy] = useState(false);
  const [pickSun, setPickSun] = useState(false);
  const downOnScrim = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const at = W.STAGES.findIndex(([k]) => k === c.stage);
  // 단계마다 무엇을 했는지 한 줄(날짜) — 단계 줄 오른쪽
  const doneText = {
    visit1: md(c.visits[0]), visit2: md(c.visits[1]),
    contact: c.contact ? `${md(c.contact.at)} · ${c.contact.by}` : '',
    register: c.decision ? md(c.decision.at) : '',
    meet: c.meets.length ? `${c.meets.length}번 · 마지막 ${md(c.meets[c.meets.length - 1])}` : '',
    sun: c.sun || '', settled: md(c.settled_at),
  };
  const doRegister = async () => {
    setBusy(true);
    try {
      await addPerson({ name: c.name, birth_year: c.birth_year, newcomer_at: kstToday() });
      W.register(c.id);
      showToast(`${c.name}님을 청년 명단에 새신자로 추가했어요`);
    } finally { setBusy(false); }
  };
  const out = leaving ? ' dc-out' : '';
  const Info = ({ label, children }) => (children ? (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-[4.5rem] shrink-0 text-[12px] font-semibold text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-fg break-words">{children}</span>
    </div>
  ) : null);

  // 그 단계에서 할 일(주 버튼 하나 + 곁 버튼)
  const actions = () => {
    switch (c.stage) {
      case 'visit1': return <button type="button" className={BTN_CONFIRM} onClick={() => W.addVisit(c.id)}>두 번째 방문 기록</button>;
      case 'visit2': return <button type="button" className={BTN_CONFIRM} onClick={() => W.markContacted(c.id, meName)}>연락했어요</button>;
      case 'contact': return (<>
        <button type="button" className={BTN_CONFIRM_QUIET} onClick={() => W.hold(c.id)}>보류</button>
        <button type="button" className={BTN_CONFIRM} disabled={busy} onClick={doRegister} data-welcome-register="">
          {busy && <Loader2 size={14} className="animate-spin" />}새신자로 등록
        </button>
      </>);
      case 'register':
      case 'meet': return (<>
        {c.stage === 'meet' && <button type="button" className={BTN_CONFIRM_QUIET} onClick={() => setPickSun(v => !v)}>순 배정</button>}
        <button type="button" className={BTN_CONFIRM} onClick={() => W.addMeet(c.id)}>리더 모임 기록</button>
      </>);
      case 'sun': return <button type="button" className={BTN_CONFIRM} onClick={() => W.settle(c.id)}>정착으로 옮기기</button>;
      case W.HOLD: return <button type="button" className={BTN_CONFIRM_QUIET} onClick={() => W.setStage(c.id, 'contact')}>다시 진행</button>;
      default: return null;
    }
  };

  return createPortal(
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); }}
      className={`fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[95] flex items-end md:items-center md:justify-center md:p-4 bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label={`${c.name} 정착 카드`} data-welcome-sheet=""
        className={`w-full md:max-w-[480px] max-h-[92%] md:max-h-[88dvh] flex flex-col overflow-hidden bg-surface rounded-t-2xl md:rounded-lg md:border md:border-line md:shadow-elevated dc-sheet-dialog${out}`}>
        <span className="md:hidden shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
        <div className="flex items-start gap-2 px-5 pt-3 md:pt-5 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-fg tracking-[-0.25px]">{c.name}</h3>
            <p className="mt-0.5 text-[12px] text-fg-muted">{[`첫 방문 ${md(c.visits[0])}`, c.owner && `담당 ${c.owner}`, c.stage === W.HOLD && '보류'].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={close} aria-label="닫기" className="shrink-0 p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3 pb-5">
          <div className="rounded-md bg-canvas px-3 py-1.5">
            <Info label="연락처">{c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-accent-text"><Phone size={12} />{c.phone}</a>}</Info>
            <Info label="태어난 해">{c.birth_year ? `${c.birth_year}년` : ''}</Info>
            <Info label="어떻게">{c.how}</Info>
            <Info label="하고 싶은 말">{c.note}</Info>
          </div>

          <h4 className="mt-4 mb-1.5 text-[12px] font-bold text-fg-muted">단계</h4>
          <ol className="relative" data-welcome-steps="">
            {W.STAGES.map(([k, label], i) => {
              const done = c.stage !== W.HOLD && i < at;
              const cur = i === at;
              return (
                <li key={k}>
                  <button type="button" onClick={() => W.setStage(c.id, k)} aria-current={cur ? 'step' : undefined}
                    className={`w-full flex items-center gap-2.5 px-2 h-9 rounded-md text-left transition-colors hover:bg-surface-hover ${cur ? 'bg-accent-weak' : ''}`}>
                    <span className={`w-[18px] h-[18px] shrink-0 rounded-full flex items-center justify-center border ${
                      done ? 'bg-accent border-transparent text-white' : cur ? 'border-accent text-accent-text' : 'border-line'}`}>
                      {done && <Check size={11} strokeWidth={3} />}
                      {cur && <span className="w-2 h-2 rounded-full bg-accent" />}
                    </span>
                    <span className={`text-[13px] ${cur ? 'font-bold text-fg' : done ? 'text-fg-secondary' : 'text-fg-muted'}`}>{label}</span>
                    <span className="ml-auto text-[11px] text-fg-muted tabular-nums truncate">{(done || cur) ? doneText[k] : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <Fold open={pickSun && c.stage === 'meet'}>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUNS.map(s => (
                <button key={s} type="button" onClick={() => { W.assignSun(c.id, s); setPickSun(false); }}
                  className="h-8 px-3 rounded-full border border-line bg-surface text-[12.5px] font-semibold text-fg-secondary hover:bg-surface-hover transition active:scale-95">{s}</button>
              ))}
            </div>
          </Fold>
        </div>

        <div className="flex items-center gap-2 px-5 pt-3 shrink-0 border-t border-line" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <span className="flex-1" />
          {actions()}
        </div>
      </div>
    </div>,
    document.body,
  );
}
