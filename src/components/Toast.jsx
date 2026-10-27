import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { usePresence } from '../hooks/useExit.js';
import { useSwipeAway } from '../hooks/useSwipeAway.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';

// ============================================================================
// 초경량 토스트 — 전역 showToast(message)로 호출
// ----------------------------------------------------------------------------
// iOS Safari에서 window.alert은 화면 전체를 막는 모달이라 UX가 파괴적이므로
// 클라우드 오류 알림 등은 모두 이 토스트로 표시한다. 4초 자동 소멸.
//
// 동작 버튼이 하나 붙을 수 있다: showToast('옮겼어요', { label: '되돌리기', onAction })
// 그 경우에만 데스크톱에서 토스트가 클릭을 받는다(그 외에는 pointer-events-none이라 아래 화면을
// 가리지 않는다 — 폰은 쓸어 닫기 때문에 받는다 · 아래 M8).
//
// **자리는 둘이다**(UX 다듬기 α · 2026-10-15 · PITFALLS 54-a) — 동작 토스트 하나와 그냥 토스트 묶음. 예전에는 한 자리라
// '되돌리기'가 떠 있는 동안 아무 토스트(저장 실패 · 다른 안내)가 오면 되돌리기가 그 자리에서 사라졌다. 그냥 토스트는 동작
// 토스트를 밀어내지 않고 **그 위에** 선다(아래 자리는 늘 동작 토스트 — 누르려던 버튼이 옮겨 가지 않는다).
// 동작 토스트끼리는 예전처럼 새것이 옛것을 갈아 낀다(54-a — 붙든 삭제가 제 시간에 나간다).
//
// UI 다듬기 2차(2026-10-27 · 시안 M7·M8·M9 · PITFALLS 74-a~c):
//   M7 그냥 토스트는 갈아 끼우지 않고 **한 장처럼 쌓인다** — 뒤 것은 9px씩 위로 · 5%씩 작게 · 높이·폭은 맨 앞 것에 맞춘다(셋까지 보인다).
//      마우스를 올리면(폰은 누르면) 위로 펼쳐진다(넷까지). 각자 4초를 따로 센다. 같은 글이 또 오면 쌓지 않고 맨 앞 것을 새로 띄운다.
//      DOM에는 **새것이 먼저**다 — `querySelector('[data-toast]')`가 가장 최근 그냥 토스트를 잡는다(검사들이 그렇게 읽는다).
//   M8 폰에서는 오른쪽으로 쓸어 닫는다(hooks/useSwipeAway.js) — 두 자리 다.
//   M9 탭이 가려진 동안(`visibilitychange` · 다른 앱) **그냥 토스트의 시계는 멈춘다**. 동작 토스트는 멈추지 않는다 — 업무 삭제는
//      이 시간 + 300ms 뒤에 서버로 나가므로(54-b) 토스트만 남겨 두면 이미 나간 삭제에 '되돌리기'가 눌린다.
// ============================================================================
let emit = null;

export function showToast(message, action = null) {
  if (!message) return;
  if (emit) emit(String(message), action && action.label && action.onAction ? action : null);
  else console.warn('[toast] 아직 마운트되지 않음:', message);
}

// 동작 버튼이 있는 토스트는 조금 더 오래 둔다 — 4초 안에 읽고 누르기는 짧다.
// 업무 삭제의 되돌리기는 이 시간 동안 서버 삭제를 미룬다(controllers.handleDeleteTask).
const HOLD_MS = 4000;
export const HOLD_MS_ACTION = 7000;
// 쌓기(시안 M7 값) — 접힘: 9px씩 위 · 5%씩 작게 · 셋까지 / 펼침: 6px 틈 · 넷까지 / 걷힘 .25s
export const STACK = { peek: 9, shrink: 0.05, shown: 3, gap: 6, shownOpen: 4, outMs: 250 };

let seq = 0;
// 한 자리의 수명 — 뜬 뒤 hold만큼 있다가 걷힌다(동작 토스트 · 벽시계)
function useSlot(hold) {
  const [toast, setToast] = useState(null); // { id, message, action }
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), hold);
    return () => clearTimeout(t);
  }, [toast, hold]);
  return [toast, setToast];
}

// 가려진 동안 멈추는 시계(M9) — 남은 시간을 들고 있다가 다시 보이면 이어서 센다
function pausable(ms, fn, doc = document) {
  let left = ms, t0 = 0, h = 0, done = false;
  const run = () => { if (done || h) return; t0 = Date.now(); h = setTimeout(() => { h = 0; done = true; fn(); }, left); };
  const pause = () => { if (!h) return; clearTimeout(h); h = 0; left -= Date.now() - t0; };
  if (!doc.hidden) run();
  return { pause, resume: run, clear: () => { clearTimeout(h); h = 0; done = true; } };
}

// 그냥 토스트 묶음 — [{ id, message, leaving }] · 뒤가 새것
function usePlainStack() {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());
  const drop = useCallback((id) => {
    timers.current.get(id)?.clear(); timers.current.delete(id);
    setItems(list => list.filter(x => x.id !== id));
  }, []);
  const expire = useCallback((id) => {
    timers.current.get(id)?.clear(); timers.current.delete(id);
    if (prefersReducedMotion()) { drop(id); return; }
    setItems(list => list.map(x => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => drop(id), STACK.outMs);
  }, [drop]);
  const push = useCallback((message) => {
    const id = ++seq;
    setItems(list => {
      const front = list.filter(x => !x.leaving).pop();
      // 같은 글이 또 오면 쌓지 않는다 — 맨 앞 것을 걷고 새로 띄운다(같은 실패가 연달아 와도 한 장)
      if (front && front.message === message) { timers.current.get(front.id)?.clear(); timers.current.delete(front.id); return [...list.filter(x => x.id !== front.id), { id, message }]; }
      return [...list, { id, message }];
    });
    timers.current.set(id, pausable(HOLD_MS, () => expire(id)));
  }, [expire]);
  useEffect(() => {
    const vis = () => timers.current.forEach(t => (document.hidden ? t.pause() : t.resume()));
    document.addEventListener('visibilitychange', vis);
    const all = timers.current;
    return () => { document.removeEventListener('visibilitychange', vis); all.forEach(t => t.clear()); };
  }, []);
  return [items, push, drop];
}

export function ToastHost() {
  const [act, setAct] = useSlot(HOLD_MS_ACTION);
  const [plain, pushPlain, dropPlain] = usePlainStack();

  useEffect(() => {
    emit = (message, action) => {
      if (action) setAct({ id: ++seq, message, action }); else pushPlain(message);
    };
    return () => { emit = null; };
  }, [setAct, pushPlain]);

  // 모바일 하단 탭바(약 4.5rem + safe-area) 위로 띄운다 — 그냥 bottom-6이면
  // 되돌리기 버튼이 탭바에 가려 눌리지 않는다.
  // z는 body 포털 창들(첨부 미리보기·문서 창 z-100 · 공유 시트 z-120)보다 위다 — 이 토스트는
  // #root 안에 있고 포털은 body 끝에 붙어 문서 순서가 뒤라, 같은 z면 창이 토스트를 덮는다.
  // 둘이 함께면 세로로 쌓는다 — 묶음의 아래끝이 그대로라 동작 토스트(아래)는 자리를 지킨다.
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[130] pointer-events-none px-4 w-full flex flex-col items-center gap-2 bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6">
      <PlainStack items={plain} onAway={dropPlain} />
      <ToastSlot toast={act} onAction={() => { const fn = act.action.onAction; setAct(null); fn(); }} onAway={() => setAct(null)} />
    </div>
  );
}

// 그냥 토스트 묶음(M7) — 모두 absolute로 겹쳐 두고 transform으로 자리를 준다. 묶음 상자 높이는 맨 앞 것의 높이(뒤 것은 위로 삐져나온다).
// 접힘: 뒤 것은 맨 앞 것의 폭·높이로 잘린다(글이 겹쳐 비치지 않게 · 바탕이 불투명) / 펼침: 제 크기로 위로 줄 선다.
function PlainStack({ items, onAway }) {
  const box = useRef(null);
  const [open, setOpen] = useState(false);
  const live = items.filter(x => !x.leaving);
  useEffect(() => { if (live.length < 2) setOpen(false); }, [live.length]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const nodes = [...el.children];   // 새것이 먼저
    const front = nodes.find(n => n.dataset.leaving !== '1');
    if (!front) { el.style.height = nodes[0] ? `${nodes[0].offsetHeight}px` : '0px'; return; }
    front.style.width = ''; front.style.height = '';
    const w = front.offsetWidth, h = front.offsetHeight;
    el.style.height = `${h}px`;
    let k = 0, y = 0;
    for (const n of nodes) {
      const out = n.dataset.leaving === '1';
      const clamp = !open && n !== front;
      n.style.width = clamp ? `${w}px` : ''; n.style.height = clamp ? `${h}px` : '';
      n.dataset.clamp = clamp ? '1' : '';
      const base = open ? `translateY(${-y}px)` : `translateY(${-k * STACK.peek}px) scale(${1 - k * STACK.shrink})`;
      n.style.zIndex = String(20 - k);
      n.style.transform = out ? `${base} translateY(6px)` : base;
      n.style.opacity = out || k >= (open ? STACK.shownOpen : STACK.shown) ? '0' : '1';
      if (!out) { y += n.offsetHeight + STACK.gap; k += 1; }
    }
  });
  const lastType = useRef('mouse');
  if (!items.length) return null;
  const many = live.length > 1;
  return (
    <div
      ref={box}
      data-toast-stack={open ? 'open' : 'shut'}
      onPointerEnter={e => { if (e.pointerType === 'mouse' && many) setOpen(true); }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false); }}
      onPointerDown={e => { lastType.current = e.pointerType; }}
      // 폰은 눌러서 펼치고 접는다 — 쓸어 닫은 뒤의 click은 useSwipeAway가 막는다
      onClick={() => { if (lastType.current !== 'mouse' && many) setOpen(v => !v); }}
      className={`relative w-full dc-toast-stack${many ? ' dc-toast-many' : ''}`}
    >
      {[...items].reverse().map(t => <PlainToast key={t.id} toast={t} onAway={onAway} />)}
    </div>
  );
}

// 바깥(.dc-toast-at)은 묶음 자리(transform) · 안은 쓸기(transform) — 한 요소에 둘을 걸면 쓸고 돌아올 때 묶음 자리가 지워진다
function PlainToast({ toast, onAway }) {
  const ref = useRef(null);
  useSwipeAway(ref, () => onAway(toast.id), { enabled: !toast.leaving });
  return (
    <div data-leaving={toast.leaving ? '1' : undefined} className="dc-toast-at">
      <div ref={ref} className="dc-toast-swipe"><ToastBox toast={toast} /></div>
    </div>
  );
}

// 동작 토스트 자리 — 사라질 때도 걷히는 것을 그린다(.dc-toast.dc-out · hooks/useExit.js). 그동안 마지막 토스트를 그대로 든다.
// 새 토스트는 key가 바뀌어 처음부터 다시 들어온다.
function ToastSlot({ toast, onAction, onAway }) {
  const lastRef = useRef(null);
  if (toast) lastRef.current = toast;
  const { shown, leaving } = usePresence(!!toast);
  const t = toast || lastRef.current;
  if (!shown || !t) return null;
  return <SwipeBox key={t.id} toast={t} leaving={leaving} onAction={toast ? onAction : undefined} onAway={onAway} />;
}

function SwipeBox({ onAway, ...rest }) {
  const ref = useRef(null);
  useSwipeAway(ref, onAway, { enabled: !rest.leaving });
  return <div ref={ref} className="dc-toast-swipe max-w-full"><ToastBox {...rest} /></div>;
}

function ToastBox({ toast, leaving, onAction }) {
  return (
    <div
      role="status" data-toast={toast.action ? 'action' : ''}
      // 폭을 묶는다 — max-w를 화면 폭으로 두면 데스크톱에서 긴 문구가 한 줄로
      // 화면을 가로질러 한눈에 안 들어온다(사용자 지적). 28rem에서 접히고,
      // 모바일에서는 화면 폭이 먼저 걸린다.
      className={`bg-fg text-canvas rounded-lg shadow-elevated px-4 py-2.5 text-xs max-w-[min(28rem,calc(100vw-2rem))] leading-relaxed dc-toast${leaving ? ' dc-out' : ''} ${toast.action ? 'pointer-events-auto flex items-center gap-3 text-left' : 'text-center'}`}
    >
      {/* 문구에 든 줄바꿈을 그대로 그린다 — 두 마디짜리 안내를 한 줄로 붙여 놓으면
          길어져서 읽히지 않는다(failText가 긴 것만 줄을 나눈다) */}
      <span className="min-w-0 whitespace-pre-line">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 font-bold underline underline-offset-2 transition active:scale-95"
        >{toast.action.label}</button>
      )}
    </div>
  );
}
