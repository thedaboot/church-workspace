import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Link as LinkIcon, X } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { showToast } from './Toast.jsx';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { failText } from '../services/errorText.js';
import { projectCalendarFeed } from '../services/cloud.js';
import {
  feedPickable, feedDateLabel, feedDefaultPick, feedSentence, feedDevice, feedButtons, feedHref, createFeedSaver,
} from '../services/calendarFeed.js';

// ============================================================================
// 프로젝트 달력 머리의 `내 달력` — 업무를 골라 폰·구글 달력에 구독으로 넣는다 (목업 v3 · 2026-09-28)
// ----------------------------------------------------------------------------
// 규칙·문구·기기별 버튼은 services/calendarFeed.js(순수 · 서버와 한 벌), 저장은 api/ics.js(0085).
// 데스크톱은 버튼 아래 팝오버(useAnchoredPos · 17-b transition-none), 폰은 아래 창(검정 50% 뒤판).
// **게스트에는 없다** — 서버가 없다(ProjectView가 cloudOn일 때만 세운다).
//
// 저장: 체크는 화면이 원본이고 createFeedSaver가 400ms 모아 하나씩 보낸다(고른 것 전체 · upsert).
// 버튼은 **이미 받아 둔 주소로 그 자리에서** 연다(await 없이 — 새 창을 여는 자격이 살아 있을 때).
// 저장이 도는 중이어도 주소는 같다(줄 id가 바뀌지 않는다). 처음 여는 동안(저장된 것을 묻는 중)은 체크를 막는다.
// ============================================================================

const POP_W = 348;
const FAIL = failText('달력 주소를 만들지 못했어요', { human: '잠시 뒤 다시 눌러 주세요' });

export function MyCalendarButton({ projectId, tasks }) {
  const isMobile = useIsMobile();
  const me = useStore(selectCurrentUser);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);       // null = 아직 모름(서버에 묻는 중)
  const [urls, setUrls] = useState(null);     // { url, webcal }
  const asked = useRef(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const sheetRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open && !isMobile, POP_W, 460, 8, popRef);

  const pickable = useMemo(() => feedPickable(tasks), [tasks]);
  const dev = useMemo(() => (typeof navigator === 'undefined' ? { os: 'desktop', kakao: false }
    : feedDevice(navigator.userAgent, navigator.maxTouchPoints || 0)), []);
  const buttons = useMemo(() => feedButtons(dev), [dev]);

  const saver = useMemo(() => createFeedSaver((cards) => projectCalendarFeed(projectId, cards), {
    onDone: (out) => { if (out?.url) setUrls({ url: out.url, webcal: out.webcal }); },
    onFail: (e) => { console.error('[calendarFeed] 저장 실패:', e); showToast(FAIL); },
  }), [projectId]);
  // 창을 닫거나 화면을 떠나도 기다리던 저장은 보낸다
  useEffect(() => () => saver.flush(), [saver]);

  const close = useCallback(() => { saver.flush(); setOpen(false); }, [saver]);
  useDismiss(open, close, [rootRef, popRef, sheetRef]);

  // 처음 열 때 한 번 — 저장된 것이 있으면 그것, 없으면 내가 담당자인 업무를 골라 두고 바로 저장한다
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    projectCalendarFeed(projectId).then((out) => {
      if (out?.url) setUrls({ url: out.url, webcal: out.webcal });
      if (Array.isArray(out?.cards)) { setSel(out.cards); return; }
      const first = feedDefaultPick(pickable, me?.name);
      setSel(first);
      if (first.length) { saver.set(first); saver.flush(); }
    }).catch((e) => {
      asked.current = false;
      console.error('[calendarFeed] 불러오기 실패:', e);
      showToast(FAIL);
      setOpen(false);
    });
  }, [open, projectId, pickable, me?.name, saver]);

  const on = useMemo(() => new Set(sel || []), [sel]);
  const chosen = pickable.filter(t => on.has(t.id));
  const ready = chosen.length > 0 && !!urls;

  const toggle = (id) => {
    if (!sel) return;
    const next = new Set(on);
    if (next.has(id)) next.delete(id); else next.add(id);
    // 목록 순서로 · 목록에 없는 것(날짜를 잃었거나 상시가 된 업무)은 이때 빠진다
    const cards = pickable.filter(t => next.has(t.id)).map(t => t.id);
    setSel(cards);
    saver.set(cards);
  };

  const act = (a) => {
    if (!ready) return;
    if (a === 'copy') {
      navigator.clipboard.writeText(urls.url)
        .then(() => showToast('주소를 복사했어요'))
        .catch(() => showToast(`복사에 실패했어요\n${urls.url}`));
      return;
    }
    const h = feedHref(a, urls, dev.kakao);
    if (!h) return;
    if (h.how === 'window') window.open(h.href, '_blank', 'noopener');
    else window.location.href = h.href;
    saver.flush();
  };

  const big = isMobile;
  const primary = buttons[0];
  const rest = buttons.slice(1);
  const quiet = `${big ? 'h-[46px] rounded-[10px] text-[13.5px]' : 'h-9 rounded-lg text-[12.5px]'} inline-flex items-center justify-center gap-1.5 font-semibold border border-line bg-surface text-fg transition active:scale-95 disabled:opacity-40 enabled:hover:bg-surface-hover`;
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
          <b className={`${big ? 'text-[16px]' : 'text-[14px]'} font-extrabold text-fg`}>내 달력에 연결</b>
          <p data-feed-desc="" className={`${big ? 'text-[13px]' : 'text-[12.5px]'} leading-[1.55] text-fg-muted`}>{feedSentence(chosen.map(t => t.title))}</p>
        </div>
        {!big && (
          <button type="button" onClick={close} aria-label="닫기"
            className="w-[26px] h-[26px] shrink-0 rounded-md grid place-items-center text-fg-muted hover:bg-surface-hover">
            <X size={15} />
          </button>
        )}
      </div>
      {pickable.length > 0 && (
        <div className={`flex flex-col gap-0.5 p-1 rounded-lg border border-line overflow-y-auto ${big ? 'max-h-[38dvh]' : 'max-h-[248px]'} ${sel ? '' : 'opacity-60'}`}>
          {pickable.map(t => {
            const checked = on.has(t.id);
            return (
              <label key={t.id} className={`flex items-center gap-[9px] rounded-md cursor-pointer ${big ? 'px-2.5 py-[11px]' : 'px-2 py-[7px]'} ${checked ? 'bg-accent-weak' : ''}`}>
                <input type="checkbox" checked={checked} disabled={!sel} onChange={() => toggle(t.id)}
                  className={`${big ? 'w-[18px] h-[18px]' : 'w-[15px] h-[15px]'} m-0 shrink-0`} style={{ accentColor: 'var(--app-accent)' }} />
                <span className={`flex-1 min-w-0 truncate font-semibold text-fg ${big ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{t.title}</span>
                <span className={`shrink-0 whitespace-nowrap text-fg-muted tabular-nums ${big ? 'text-[12px]' : 'text-[11px]'}`}>{feedDateLabel(t)}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className={`flex flex-col ${big ? 'gap-2' : 'gap-[7px]'}`}>
        <button type="button" disabled={!ready} onClick={() => act(primary.act)}
          className={`${big ? 'h-12 rounded-[10px] text-[14px]' : 'h-[38px] rounded-lg text-[13px]'} font-bold text-white bg-accent transition active:scale-95 disabled:opacity-40 enabled:hover:bg-accent-strong`}>
          {primary.label}
        </button>
        <div className={rest.length > 1 ? 'grid grid-cols-2 gap-[7px]' : 'flex flex-col'}>
          {rest.map(b => (
            <button key={b.act} type="button" disabled={!ready} onClick={() => act(b.act)} className={quiet}>
              {b.act === 'copy' && <LinkIcon size={big ? 14 : 13} />}{b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-px bg-line" />
      <div className={`flex flex-col gap-1 leading-[1.55] text-fg-muted ${big ? 'text-[12px]' : 'text-[11.5px]'}`}>
        <span>이 주소를 아는 사람도 동일하게 업무 제목과 마감일을 등록할 수 있어요.</span>
        <span>마감일을 바꾸면 내 달력에는 몇 시간 뒤에 반영돼요.</span>
      </div>
    </>
  );

  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <button ref={btnRef} type="button" aria-expanded={open} data-my-calendar=""
        onClick={() => { if (open) close(); else { place(); setOpen(true); } }}
        className={`inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 sm:pl-[9px] sm:pr-[11px] rounded-md text-[12px] font-bold border transition-colors ${open ? 'border-accent bg-accent-weak text-accent-text' : 'border-line text-fg-muted hover:bg-surface-hover'}`}>
        <CalendarPlus size={14} />내 달력
      </button>
      {open && !isMobile && createPortal(
        <div ref={popRef} role="dialog" aria-label="내 달력에 연결" data-feed-panel=""
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: POP_W }}
          className="z-[90] flex flex-col gap-3 px-4 pt-4 pb-3.5 rounded-xl bg-surface border border-line shadow-elevated transition-none animate-in fade-in zoom-in-95 duration-150">
          {body}
        </div>, document.body)}
      {open && isMobile && createPortal(
        <div className="fixed inset-0 z-[95] flex items-end bg-black/50 transition-none animate-in fade-in duration-150">
          <div ref={sheetRef} role="dialog" aria-label="내 달력에 연결" data-feed-panel=""
            className="w-full max-h-[92dvh] overflow-y-auto flex flex-col gap-3.5 px-5 pt-2.5 rounded-t-2xl bg-surface transition-none animate-in fade-in slide-in-from-bottom-4 duration-150"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <span className="self-center w-9 h-1 rounded-full bg-line" />
            {body}
          </div>
        </div>, document.body)}
    </span>
  );
}
