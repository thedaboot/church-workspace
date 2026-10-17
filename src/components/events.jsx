import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Link as LinkIcon, MapPin, Plus, Trash2, X } from 'lucide-react';
import { CalendarBoard } from './calendar.jsx';
import { Avatar } from './Avatar.jsx';
import { DatePicker } from './DatePicker.jsx';
import { ConfirmPopover, useAnchoredPos, popMotion } from './ConfirmPopover.jsx';
import { FIELD, LabeledField, DATE_TRIGGER } from './groupsParts.jsx';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { showToast } from './Toast.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLeave } from '../hooks/useExit.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { imeComposing, localDate } from '../utils.js';
import {
  EVENT_KINDS, kindOf, eventPaint, eventDot, eventCalItems, eventRangeLabel,
} from '../services/events.js';
import { useEvents, saveEvent, deleteEvent } from '../services/eventStore.js';
import { feedDevice, feedButtons } from '../services/calendarFeed.js';

// ============================================================================
// 행사 일정(시안 · mock/b2 · 2026-10-18) — '전체 일정'의 '행사' 칸
// ----------------------------------------------------------------------------
// 순원 피드백: 전체 일정이 사실상 업무 전부라 한 사람의 업무로 덮인다 → 수련회·절기·체육대회 같은 큰 일만 보는 칸.
// 달력은 CalendarBoard를 그대로 쓴다(띠 배치·폰 달력·생일 얼굴 — calendar.jsx 머리말 · PITFALLS §4.8·§6-13~15).
// 행사는 업무 모양(startDate·dueDate)으로 바꿔 넘기고 색·고른 날 목록만 이 파일이 준다.
//   · 데스크톱: 달력 | 오른쪽 고른 날 목록(+ 새 일정) · 머리 오른쪽 '내 달력' · 날짜 칸 오른쪽 클릭 → 그 날짜로 추가
//   · 폰: 달력 + 아래 고른 날 목록(+ 새 일정) · 날짜 길게 누르기 → 추가 시트
//   · 추가·수정: 데스크톱 가운데 대화창(.dc-dialog) · 폰 아래 시트(.dc-sheet-up · 보이는 창 --app-vh 안 — 키보드에 안 가린다) ·
//     뒤판 .dc-scrim · 닫힘 useLeave(.dc-out · PITFALLS 57). z-50 — 업무 창과 같은 층(DatePicker 판 z-90이 위에 선다).
//   · 누가 추가·수정·삭제하나는 services/events.js의 canEditEvents 하나(리더진 + 마스터 · 사용자 결정 2026-10-18).
//     못 하는 사람에게는 + 새 일정·오른쪽 클릭·길게 누르기가 없고 줄은 눌리지 않는다.
// 저장은 게스트만(services/eventStore.js — 실제 DB에 필요한 것은 그 머리말).
// ============================================================================

export function EventCalendar({ canEdit, bdayPeople }) {
  const events = useEvents();
  const items = useMemo(() => eventCalItems(events), [events]);
  const [editing, setEditing] = useState(null);   // { draft, isNew }

  const openNew = useCallback((iso) => setEditing({ isNew: true, draft: { title: '', start: iso, end: iso, place: '', memo: '', kind: 'event' } }), []);
  const openEdit = useCallback((item) => {
    if (!canEdit) return;
    const ev = events.find(e => e.id === item.id);
    if (ev) setEditing({ isNew: false, draft: { ...ev } });
  }, [canEdit, events]);

  const renderDay = useCallback(({ iso, list, birthdays, tight }) => (
    <EventDaySheet iso={iso} list={list} birthdays={birthdays} tight={tight}
      canEdit={canEdit} onAdd={() => openNew(iso)} onOpen={openEdit} />
  ), [canEdit, openNew, openEdit]);

  const legend = useMemo(() => (
    <span className="hidden sm:flex items-center gap-2.5">
      {EVENT_KINDS.map(k => (
        <span key={k.key} className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-muted">
          <span className="w-2 h-1 rounded-full" style={{ background: `var(--app-tag-${k.token}-fg)` }} />{k.label}
        </span>
      ))}
    </span>
  ), []);
  // 머리 오른쪽: 내 달력 + (추가할 수 있는 사람만) 새 일정 — 오늘 날짜로 연다(고른 날로 열려면 아래 목록의 '+ 새 일정')
  const feed = useMemo(() => (
    <span className="inline-flex items-center gap-1.5">
      <EventFeedButton count={items.length} />
      {canEdit && (
        <button type="button" onClick={() => openNew(localDate(new Date()))} data-event-new=""
          className="inline-flex items-center gap-1 h-7 pl-2 pr-2.5 rounded-md text-[12px] font-bold text-white bg-accent hover:bg-accent-strong transition active:scale-95">
          <Plus size={13} className="[stroke-width:2.4px]" />새 일정
        </button>
      )}
    </span>
  ), [items.length, canEdit, openNew]);

  return (
    <>
      <CalendarBoard
        tasks={items} onTaskClick={openEdit} headerExtra={feed}
        paintOf={eventPaint} dotOf={eventDot} legend={legend} renderDay={renderDay}
        bdayPeople={bdayPeople} onDayAdd={canEdit ? openNew : null}
      />
      {editing && (
        <EventDialog key={editing.draft.id || editing.draft.start} initial={editing.draft} isNew={editing.isNew}
          onClose={() => setEditing(null)} />
      )}
    </>
  );
}

// 고른 날 목록 — 달력의 DaySheet와 같은 줄 모양(머리 · 생일 줄 먼저 · 줄 순차 등장)
function EventDaySheet({ iso, list, birthdays = [], tight, canEdit, onAdd, onOpen }) {
  return (
    <div className={`${tight ? '' : 'pt-3'} shrink-0`} data-event-day={iso}>
      <div className="flex items-center gap-2 pb-2">
        <h4 className="text-[12.5px] font-bold text-fg">{Number(iso.slice(5, 7))}월 {Number(iso.slice(8, 10))}일</h4>
        <span className="text-[11px] text-fg-muted tabular-nums">{list.length}건</span>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        {canEdit && (
          <button type="button" onClick={onAdd} data-event-add=""
            className="shrink-0 text-[11px] font-semibold text-accent-text hover:underline transition active:scale-95">
            + 새 일정
          </button>
        )}
      </div>
      {birthdays.map((p, i) => (
        <div key={p.id || p.name} className="dc-row flex items-center gap-2.5 py-2"
          style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
          <Avatar name={p.name} url={p.avatarUrl} className="flex w-7 h-7 text-xs" />
          <span className="text-[13px] text-fg min-w-0 truncate">
            <span className="font-semibold">{p.name}</span>님 생일이에요
          </span>
        </div>
      ))}
      {list.length === 0
        ? (birthdays.length ? null : <p data-event-empty="" className="py-4 text-center text-[11px] text-fg-muted">일정 없음</p>)
        : list.map((ev, i) => {
          const Row = canEdit ? 'button' : 'div';
          const meta = [ev.place, eventRangeLabel(ev)].filter(Boolean).join(' · ');
          return (
            <Row key={ev.id} {...(canEdit ? { type: 'button', onClick: () => onOpen(ev) } : {})} data-event-row={ev.id}
              className={`dc-row w-[calc(100%+16px)] flex items-start gap-2.5 py-2 text-left rounded-md px-2 -mx-2 border-t border-line/60 first-of-type:border-t-0 ${canEdit ? 'hover:bg-surface-hover transition-colors' : ''}`}
              style={{ animationDelay: `${Math.min(birthdays.length + i, 12) * 22}ms` }}>
              <span className="shrink-0 w-[3px] self-stretch min-h-7 rounded-full" style={eventPaint(ev, true)} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-semibold text-fg truncate">{ev.title}</span>
                  <span className="shrink-0 px-1.5 py-px rounded-xs text-[10px] font-semibold" style={eventPaint(ev)}>{kindOf(ev.kind).label}</span>
                </span>
                <span className="block text-[10.5px] text-fg-muted truncate">{meta}</span>
                {ev.memo && <span className="block mt-0.5 text-[11.5px] text-fg-muted leading-[1.45] line-clamp-2 break-keep">{ev.memo}</span>}
              </span>
            </Row>
          );
        })}
    </div>
  );
}

// ── 추가·수정 창 ────────────────────────────────────────────────────────────
function EventDialog({ initial, isNew, onClose }) {
  const isMobile = useIsMobile();
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [d, setD] = useState(initial);
  const set = (k) => (v) => setD(prev => ({ ...prev, [k]: v }));
  const downOnScrim = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-datepicker]')) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const ok = !!d.title.trim() && !!d.start;
  const submit = () => {
    if (!ok) return;
    const saved = saveEvent(d);
    if (saved) { showToast(isNew ? '일정을 추가했어요' : '일정을 수정했어요'); close(); }
  };
  const remove = () => { deleteEvent(d.id); showToast('일정을 삭제했어요'); close(); };
  const onEnter = (e) => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  const out = leaving ? ' dc-out' : '';
  const big = isMobile;
  const input = `${FIELD} w-full ${big ? 'text-[15px] py-2' : ''}`;
  // 폰 날짜 칸은 칸 높이를 맞춘다(DATE_TRIGGER는 34px · 폰 입력칸과 같은 높이)
  const dateTrigger = `${DATE_TRIGGER} w-full justify-start ${big ? '!text-[14px]' : ''}`;

  const body = (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <h3 className={`flex-1 font-bold text-fg tracking-[-0.25px] ${big ? 'text-[16px]' : 'text-[15px]'}`}>{isNew ? '새 일정' : '일정 수정'}</h3>
        {!big && (
          <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        )}
      </div>
      <div className="flex flex-col gap-3 mt-3.5">
        <LabeledField label="제목">
          <input value={d.title} onChange={e => set('title')(e.target.value)} onKeyDown={onEnter} aria-label="제목"
            placeholder="예: 겨울 수련회" autoFocus={!big} enterKeyHint="done" className={input} data-event-title="" />
        </LabeledField>
        <div className="grid grid-cols-2 gap-2.5">
          <LabeledField label="시작일" className="[&>div]:flex">
            <DatePicker value={d.start} onChange={(v) => setD(prev => ({ ...prev, start: v, end: prev.end && prev.end < v ? v : prev.end }))}
              allowClear={false} ariaLabel="시작일" triggerClassName={dateTrigger} />
          </LabeledField>
          <LabeledField label="종료일" className="[&>div]:flex">
            <DatePicker value={d.end} onChange={set('end')} ariaLabel="종료일" triggerClassName={dateTrigger} />
          </LabeledField>
        </div>
        <LabeledField label="종류">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="종류">
            {EVENT_KINDS.map(k => {
              const on = d.kind === k.key;
              return (
                <button key={k.key} type="button" role="radio" aria-checked={on} onClick={() => set('kind')(k.key)} data-event-kind={k.key}
                  className={`inline-flex items-center gap-1.5 pl-[9px] pr-[11px] ${big ? 'py-[7px] text-[13px]' : 'py-[5px] text-[11.5px]'} rounded-full transition-colors`}
                  style={{
                    background: on ? `var(--app-tag-${k.token})` : 'var(--app-surface-hover)',
                    color: on ? `var(--app-tag-${k.token}-fg)` : 'var(--app-ink-muted)',
                    fontWeight: on ? 700 : 500,
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(--app-tag-${k.token}-fg)` }} />{k.label}
                </button>
              );
            })}
          </div>
        </LabeledField>
        <LabeledField label="장소">
          <div className="relative">
            <MapPin size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none" />
            <input value={d.place} onChange={e => set('place')(e.target.value)} onKeyDown={onEnter} aria-label="장소"
              placeholder="예: 양평 수양관" className={`${input} pl-7`} />
          </div>
        </LabeledField>
        <LabeledField label="메모">
          <textarea value={d.memo} onChange={e => set('memo')(e.target.value)} aria-label="메모" rows={big ? 3 : 2}
            placeholder="예: 신청은 12월 13일까지" className={`${input} resize-none leading-[1.5]`} />
        </LabeledField>
      </div>
      <div className={`flex items-center gap-2 ${big ? 'mt-5' : 'mt-5'}`}>
        {!isNew && (
          <ConfirmPopover message="이 일정을 삭제할까요?" onConfirm={remove}>
            <button type="button" data-event-delete=""
              className="inline-flex items-center gap-1 min-h-10 px-2 rounded-md text-[12.5px] font-semibold text-tag-red-fg hover:bg-surface-hover transition active:scale-95">
              <Trash2 size={14} />삭제
            </button>
          </ConfirmPopover>
        )}
        <span className="flex-1" />
        <button type="button" onClick={close} className={`${BTN_CONFIRM_QUIET} ${big ? 'flex-1' : ''}`}>취소</button>
        <button type="button" onClick={submit} disabled={!ok} data-event-save="" className={`${BTN_CONFIRM} ${big ? 'flex-1' : ''}`}>{isNew ? '추가' : '저장'}</button>
      </div>
    </>
  );

  // 뒤판 닫기는 **뒤판에서 시작한 누름**만 — pointerdown으로 본다. 폰에서 날짜를 길게 눌러 시트가 뜬 뒤 손을 떼면
  // 브라우저가 흉내 낸 mousedown·click이 손 아래(이제 뒤판)에 떨어져 시트가 바로 닫혔다. 손가락의 pointerdown은 뒤판이 서기 전이다.
  const scrimProps = {
    onPointerDown: (e) => { downOnScrim.current = e.target === e.currentTarget; },
    onClick: (e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); },
  };
  return createPortal(isMobile ? (
    // 보이는 창(--app-vh · App.jsx) 안에 선다 — 키보드가 올라와도 시트 바닥이 키보드 밑에 남지 않는다(leaderOnly 시트와 같은 길)
    <div {...scrimProps} className={`fixed inset-x-0 top-0 h-[var(--app-vh,100dvh)] z-50 flex items-end bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label={isNew ? '새 일정' : '일정 수정'} data-event-dialog=""
        className={`w-full max-h-[92%] overflow-y-auto overscroll-contain flex flex-col px-5 pt-2.5 rounded-t-2xl bg-surface dc-sheet-up${out}`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <span className="self-center w-9 h-1 rounded-full bg-line mb-3 shrink-0" />
        {body}
      </div>
    </div>
  ) : (
    <div {...scrimProps} className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 dc-scrim${out}`}>
      <div role="dialog" aria-label={isNew ? '새 일정' : '일정 수정'} data-event-dialog=""
        className={`bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-[440px] max-h-[min(640px,85dvh)] overflow-y-auto flex flex-col dc-dialog${out}`}>
        {body}
      </div>
    </div>
  ), document.body);
}

// ── 내 달력 ─────────────────────────────────────────────────────────────────
// 프로젝트 달력의 `내 달력`(components/calendarFeed.jsx)과 같은 모양 — 데스크톱 팝오버(.dc-pop) · 폰 아래 시트.
// 행사는 사람마다 고르지 않는다(모두에게 같은 큰 일) — 목록 없이 버튼만. 게스트(이 시안)는 서버가 없어 연결하지 않는다.
const POP_W = 320;
function EventFeedButton({ count }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const sheetRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open && !isMobile, POP_W, 260, 8, popRef);
  const dev = useMemo(() => (typeof navigator === 'undefined' ? { os: 'desktop', kakao: false }
    : feedDevice(navigator.userAgent, navigator.maxTouchPoints || 0)), []);
  const buttons = useMemo(() => feedButtons(dev), [dev]);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [rootRef, popRef, sheetRef]);
  const act = () => showToast('미리보기에서는 연결하지 않아요');

  const big = isMobile;
  const primary = buttons[0];
  const rest = buttons.slice(1);
  const quiet = `${big ? 'h-[46px] rounded-[10px] text-[13.5px]' : 'h-9 rounded-lg text-[12.5px]'} inline-flex items-center justify-center gap-1.5 font-semibold border border-line bg-surface text-fg transition active:scale-95 hover:bg-surface-hover`;
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
          <b className={`${big ? 'text-[16px]' : 'text-[14px]'} font-extrabold text-fg`}>내 달력에 연결</b>
          <p className={`${big ? 'text-[13px]' : 'text-[12.5px]'} leading-[1.55] text-fg-muted`}>청년부 행사 일정 {count}건이 내 달력에 일정으로 들어가요.</p>
        </div>
        {!big && (
          <button type="button" onClick={close} aria-label="닫기"
            className="w-[26px] h-[26px] shrink-0 rounded-md grid place-items-center text-fg-muted hover:bg-surface-hover">
            <X size={15} />
          </button>
        )}
      </div>
      <div className={`flex flex-col ${big ? 'gap-2' : 'gap-[7px]'}`}>
        <button type="button" onClick={act}
          className={`${big ? 'h-12 rounded-[10px] text-[14px]' : 'h-[38px] rounded-lg text-[13px]'} font-bold text-white bg-accent transition active:scale-95 hover:bg-accent-strong`}>
          {primary.label}
        </button>
        <div className={rest.length > 1 ? 'grid grid-cols-2 gap-[7px]' : 'flex flex-col'}>
          {rest.map(b => (
            <button key={b.act} type="button" onClick={act} className={quiet}>
              {b.act === 'copy' && <LinkIcon size={big ? 14 : 13} />}{b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-px bg-line" />
      <p className={`leading-[1.55] text-fg-muted ${big ? 'text-[12px]' : 'text-[11.5px]'}`}>새 일정이 생기거나 바뀌면 내 달력에는 몇 시간 뒤에 반영돼요.</p>
    </>
  );

  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <button ref={btnRef} type="button" aria-expanded={open} data-event-feed=""
        onClick={() => { if (open) close(); else { place(); setOpen(true); } }}
        className={`inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 sm:pl-[9px] sm:pr-[11px] rounded-md text-[12px] font-bold border transition-colors ${open ? 'border-accent bg-accent-weak text-accent-text' : 'border-line text-fg-muted hover:bg-surface-hover'}`}>
        <CalendarPlus size={14} />내 달력
      </button>
      {open && !isMobile && createPortal(
        <div ref={popRef} role="dialog" aria-label="내 달력에 연결" data-event-feed-panel=""
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: POP_W, ...popMotion(pos) }}
          className="z-[90] flex flex-col gap-3 px-4 pt-4 pb-3.5 rounded-xl bg-surface border border-line shadow-elevated transition-none dc-pop">
          {body}
        </div>, document.body)}
      {open && isMobile && createPortal(
        <div className="fixed inset-0 z-[95] flex items-end bg-black/50 dc-scrim">
          <div ref={sheetRef} role="dialog" aria-label="내 달력에 연결" data-event-feed-panel=""
            className="w-full max-h-[92dvh] overflow-y-auto flex flex-col gap-3.5 px-5 pt-2.5 rounded-t-2xl bg-surface dc-sheet-up"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <span className="self-center w-9 h-1 rounded-full bg-line" />
            {body}
          </div>
        </div>, document.body)}
    </span>
  );
}
