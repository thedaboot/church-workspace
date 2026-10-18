import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, Link as LinkIcon, MapPin, Plus, Trash2, X } from 'lucide-react';
import { CalendarBoard } from './calendar.jsx';
import { Avatar } from './Avatar.jsx';
import { DatePicker } from './DatePicker.jsx';
import { ConfirmPopover, useAnchoredPos, popMotion } from './ConfirmPopover.jsx';
import { FIELD, LabeledField, DATE_TRIGGER } from './groupsParts.jsx';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { TaskRef } from './RichText.jsx';
import { showToast } from './Toast.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLeave } from '../hooks/useExit.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { useStore } from '../store/workspaceStore.js';
import { imeComposing, localDate, byNewest } from '../utils.js';
import {
  EVENT_KINDS, kindOf, eventPaint, eventDot, eventCalItems, eventRangeLabel,
  monthEvents, togglePick, livePicks, eventFeedSentence,
} from '../services/events.js';
import { useEvents, saveEvent, deleteEvent, useEventPicks, setEventPicks } from '../services/eventStore.js';
import { feedDevice, feedButtons } from '../services/calendarFeed.js';

// ============================================================================
// 행사 일정(시안 · mock/b2 · 2026-10-18) — '전체 일정'의 '행사' 칸
// ----------------------------------------------------------------------------
// 순원 피드백: 전체 일정이 사실상 업무 전부라 한 사람의 업무로 덮인다 → 예배·행사·수련회 같은 큰 일만 보는 칸.
// 달력은 CalendarBoard를 그대로 쓴다(띠 배치·폰 달력·생일 얼굴 — calendar.jsx 머리말 · PITFALLS §4.8·§6-13~15).
// 행사는 업무 모양(startDate·dueDate)으로 바꿔 넘기고 색·고른 날 목록만 이 파일이 준다. 폰은 여러 날 행사도 점이다(사용자 확인).
//   · 머리 오른쪽: '내 달력'(보고 있는 달의 일정을 골라 개인 피드에 · 아래 EventFeedButton) · '새 일정'(편집할 수 있는 사람만 · 오늘로)
//   · 날짜에서 바로 추가: 데스크톱 날짜 칸 오른쪽 클릭 · 폰 날짜 길게 누르기 — 그 날짜가 들어간 추가 창
//     (고른 날 목록의 '+ 새 일정'은 2차에서 뺐다 — 사용자 결정 2026-10-18)
//   · 일정 창(EventWindow) 한 벌: 읽기 상태(같은 창 · 칸이 글자로) ↔ 수정(지금의 입력 칸) · 새 일정은 수정 상태로 열려 저장하면 읽기 상태.
//     데스크톱 가운데 대화창(.dc-dialog) · 폰 아래 시트(.dc-sheet-up · 보이는 창 --app-vh 안 — 키보드에 안 가린다) ·
//     뒤판 .dc-scrim · 닫힘 useLeave(.dc-out · PITFALLS 57). z-50 — 업무 창과 같은 층(DatePicker 판 z-90이 위에 선다).
//   · 누가 추가·수정·삭제하나는 services/events.js의 canEditEvents 하나(리더진 + 마스터 · 사용자 결정 2026-10-18).
//     못 하는 사람은 읽기 상태만 — '수정'·'새 일정'·오른쪽 클릭·길게 누르기가 없다.
//   · 관련 업무: 수정 상태에서 고르고(선행 업무 고르기와 같은 칩 + 네이티브 select) 읽기 상태에서 업무 링크 카드(RichText.TaskRef) —
//     못 보는 업무는 '업무 링크' 중립 칩(같은 판정 canSeeProject).
// 저장은 게스트만(services/eventStore.js — 실제 DB에 필요한 것은 그 머리말).
// ============================================================================

export function EventCalendar({ canEdit, bdayPeople }) {
  const events = useEvents();
  const items = useMemo(() => eventCalItems(events), [events]);
  const [win, setWin] = useState(null);   // { id } 읽기로 열기 · { draft } 새 일정(수정 상태)

  const openNew = useCallback((iso) => setWin({ draft: { title: '', start: iso, end: iso, place: '', memo: '', kind: 'event', taskIds: [] } }), []);
  const openView = useCallback((item) => setWin({ id: item.id }), []);

  const renderDay = useCallback(({ iso, list, birthdays, tight }) => (
    <EventDaySheet iso={iso} list={list} birthdays={birthdays} tight={tight} onOpen={openView} />
  ), [openView]);

  const legend = useMemo(() => (
    <span className="hidden sm:flex items-center gap-2.5">
      {EVENT_KINDS.map(k => (
        <span key={k.key} className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-muted">
          <span className="w-2 h-1 rounded-full" style={{ background: `var(--app-tag-${k.token}-fg)` }} />{k.label}
        </span>
      ))}
    </span>
  ), []);
  // 머리 오른쪽: 내 달력(보고 있는 달) + (추가할 수 있는 사람만) 새 일정 — 오늘 날짜로 연다
  const header = useCallback((view) => (
    <span className="inline-flex items-center gap-1.5">
      <EventFeedButton view={view} events={events} />
      {canEdit && (
        <button type="button" onClick={() => openNew(localDate(new Date()))} data-event-new=""
          className="inline-flex items-center gap-1 h-7 pl-2 pr-2.5 rounded-md text-[12px] font-bold text-white bg-accent hover:bg-accent-strong transition active:scale-95">
          <Plus size={13} className="[stroke-width:2.4px]" />새 일정
        </button>
      )}
    </span>
  ), [events, canEdit, openNew]);

  return (
    <>
      <CalendarBoard
        tasks={items} onTaskClick={openView} headerExtra={header}
        paintOf={eventPaint} dotOf={eventDot} legend={legend} renderDay={renderDay}
        bdayPeople={bdayPeople} onDayAdd={canEdit ? openNew : null}
      />
      {win && (
        <EventWindow key={win.id || `new-${win.draft.start}`} initialId={win.id || null} initialDraft={win.draft || null}
          canEdit={canEdit} onClose={() => setWin(null)} />
      )}
    </>
  );
}

// 고른 날 목록 — 달력의 DaySheet와 같은 줄 모양(머리 · 생일 줄 먼저 · 줄 순차 등장). 줄을 누르면 일정 창(읽기 상태 · 누구나)
function EventDaySheet({ iso, list, birthdays = [], tight, onOpen }) {
  return (
    <div className={`${tight ? '' : 'pt-3'} shrink-0`} data-event-day={iso}>
      <div className="flex items-center gap-2 pb-2">
        <h4 className="text-[12.5px] font-bold text-fg">{Number(iso.slice(5, 7))}월 {Number(iso.slice(8, 10))}일</h4>
        <span className="text-[11px] text-fg-muted tabular-nums">{list.length}건</span>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
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
          const meta = [ev.place, eventRangeLabel(ev)].filter(Boolean).join(' · ');
          return (
            <button key={ev.id} type="button" onClick={() => onOpen(ev)} data-event-row={ev.id}
              className="dc-row w-[calc(100%+16px)] flex items-start gap-2.5 py-2 text-left rounded-md px-2 -mx-2 border-t border-line/60 first-of-type:border-t-0 hover:bg-surface-hover transition-colors"
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
            </button>
          );
        })}
    </div>
  );
}

// 날짜 글자 — DatePicker 버튼과 같은 모양('2026. 12. 28. (월)') · 읽기 상태가 수정 상태와 같은 자리에 같은 글자로 선다
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dateText = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}. ${m}. ${d}. (${WD[new Date(y, m - 1, d).getDay()]})`;
};

// 종류 칩 하나 — 수정 상태의 고르기 칩과 같은 모양(읽기 상태는 고른 것 하나만 · 누르지 않는다)
const kindChipCls = (big) => `inline-flex items-center gap-1.5 pl-[9px] pr-[11px] ${big ? 'py-[7px] text-[13px]' : 'py-[5px] text-[11.5px]'} rounded-full transition-colors`;
const kindChipStyle = (k, on) => ({
  background: on ? `var(--app-tag-${k.token})` : 'var(--app-surface-hover)',
  color: on ? `var(--app-tag-${k.token}-fg)` : 'var(--app-ink-muted)',
  fontWeight: on ? 700 : 500,
});

// ── 일정 창: 읽기 상태 ↔ 수정 상태(같은 창 · 같은 칸 차례) ───────────────────────
function EventWindow({ initialId, initialDraft, canEdit, onClose }) {
  const isMobile = useIsMobile();
  const events = useEvents();
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [id, setId] = useState(initialId);
  const [draft, setDraft] = useState(initialDraft);   // null이면 읽기 상태
  const editing = !!draft;
  const isNew = editing && !id;
  const ev = id ? events.find(e => e.id === id) : null;
  const set = (k) => (v) => setDraft(prev => ({ ...prev, [k]: v }));
  const downOnScrim = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-datepicker]')) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  // 읽던 일정이 사라졌으면(다른 탭에서 지움) 창을 닫는다
  useEffect(() => { if (!editing && id && !ev) onClose(); }, [editing, id, ev, onClose]);

  const ok = editing && !!draft.title.trim() && !!draft.start;
  const submit = () => {
    if (!ok) return;
    const saved = saveEvent(draft);
    if (!saved) return;
    showToast(isNew ? '일정을 추가했어요' : '일정을 수정했어요');
    setId(saved.id);
    setDraft(null);   // 저장하면 읽기 상태로
  };
  const cancel = () => { if (isNew) close(); else setDraft(null); };
  const remove = () => { deleteEvent(id); showToast('일정을 삭제했어요'); close(); };
  const startEdit = () => { if (canEdit && ev) setDraft({ ...ev, taskIds: ev.taskIds || [] }); };
  const onEnter = (e) => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  const out = leaving ? ' dc-out' : '';
  const big = isMobile;
  const input = `${FIELD} w-full ${big ? 'text-[15px] py-2' : ''}`;
  // 폰 날짜 칸은 칸 높이를 맞춘다(DATE_TRIGGER는 34px · 폰 입력칸과 같은 높이)
  const dateTrigger = `${DATE_TRIGGER} w-full justify-start ${big ? '!text-[14px]' : ''}`;
  // 읽기 상태의 글자 — 입력 칸과 같은 글자 크기 · 같은 왼쪽 선(칸 안쪽 여백 없이 라벨 아래에 곧게)
  const text = `${big ? 'text-[15px]' : 'text-[13px]'} text-fg leading-[1.5] break-words`;
  const empty = <span className="text-fg-muted">미입력</span>;
  if (!editing && !ev) return null;
  const d = editing ? draft : ev;
  const title = isNew ? '새 일정' : editing ? '일정 수정' : '일정';

  const body = (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <h3 className={`flex-1 font-bold text-fg tracking-[-0.25px] ${big ? 'text-[16px]' : 'text-[15px]'}`}>{title}</h3>
        {!big && (
          <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        )}
      </div>
      <div className="flex flex-col gap-3 mt-3.5" data-event-mode={editing ? 'edit' : 'view'}>
        <LabeledField label="제목">
          {editing
            ? <input value={d.title} onChange={e => set('title')(e.target.value)} onKeyDown={onEnter} aria-label="제목"
                placeholder="예: 겨울 수련회" autoFocus={!big && isNew} enterKeyHint="done" className={input} data-event-title="" />
            : <p className={`${text} font-semibold`} data-event-view-title="">{d.title}</p>}
        </LabeledField>
        <div className="grid grid-cols-2 gap-2.5">
          <LabeledField label="시작일" className="[&>div]:flex">
            {editing
              ? <DatePicker value={d.start} onChange={(v) => setDraft(prev => ({ ...prev, start: v, end: prev.end && prev.end < v ? v : prev.end }))}
                  allowClear={false} ariaLabel="시작일" triggerClassName={dateTrigger} />
              : <p className={`${text} tabular-nums`}>{dateText(d.start)}</p>}
          </LabeledField>
          <LabeledField label="종료일" className="[&>div]:flex">
            {editing
              ? <DatePicker value={d.end} onChange={set('end')} ariaLabel="종료일" triggerClassName={dateTrigger} />
              : <p className={`${text} tabular-nums`}>{dateText(d.end || d.start)}</p>}
          </LabeledField>
        </div>
        <LabeledField label="종류">
          {editing ? (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="종류">
              {EVENT_KINDS.map(k => (
                <button key={k.key} type="button" role="radio" aria-checked={d.kind === k.key} onClick={() => set('kind')(k.key)} data-event-kind={k.key}
                  className={kindChipCls(big)} style={kindChipStyle(k, d.kind === k.key)}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(--app-tag-${k.token}-fg)` }} />{k.label}
                </button>
              ))}
            </div>
          ) : (
            <span className={kindChipCls(big)} style={kindChipStyle(kindOf(d.kind), true)}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(--app-tag-${kindOf(d.kind).token}-fg)` }} />{kindOf(d.kind).label}
            </span>
          )}
        </LabeledField>
        <LabeledField label="장소">
          {editing ? (
            <div className="relative">
              <MapPin size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none" />
              <input value={d.place} onChange={e => set('place')(e.target.value)} onKeyDown={onEnter} aria-label="장소"
                placeholder="예: 양평 수양관" className={`${input} pl-7`} />
            </div>
          ) : (
            <p className={`${text} flex items-center gap-1.5`}>{d.place ? <><MapPin size={14} className="text-fg-faint shrink-0" />{d.place}</> : empty}</p>
          )}
        </LabeledField>
        <LabeledField label="메모">
          {editing
            ? <textarea value={d.memo} onChange={e => set('memo')(e.target.value)} aria-label="메모" rows={big ? 3 : 2}
                placeholder="예: 신청은 12월 13일까지" className={`${input} resize-none leading-[1.5]`} />
            : <p className={`${text} whitespace-pre-wrap`}>{d.memo || empty}</p>}
        </LabeledField>
        <LabeledField label="관련 업무">
          {editing
            ? <RelatedTasksPicker value={d.taskIds || []} onChange={set('taskIds')} big={big} />
            : (d.taskIds || []).length
              // 카드를 누르면 업무 창이 열린다 — 이 창은 걷는다(같은 z 층에서 겹쳐 서지 않게)
              ? <div className="flex flex-col" data-event-tasks="" onClickCapture={(e) => { if (e.target.closest('a') && !e.metaKey && !e.ctrlKey && !e.shiftKey) close(); }}>
                  {/* 중립 칩은 글자 안에 서는 모양이라 글자 크기를 물려받는다 — 본문(13px)과 같은 크기로 묶는다 */}
                  {d.taskIds.map(tid => <div key={tid} className="text-[13px] leading-[1.9]"><TaskRef id={tid} /></div>)}
                </div>
              : <p className={text}><span className="text-fg-muted">미지정</span></p>}
        </LabeledField>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 mt-5">
          {!isNew && (
            <ConfirmPopover message="이 일정을 삭제할까요?" onConfirm={remove}>
              <button type="button" data-event-delete=""
                className="inline-flex items-center gap-1 min-h-10 px-2 rounded-md text-[12.5px] font-semibold text-tag-red-fg hover:bg-surface-hover transition active:scale-95">
                <Trash2 size={14} />삭제
              </button>
            </ConfirmPopover>
          )}
          <span className="flex-1" />
          <button type="button" onClick={cancel} className={`${BTN_CONFIRM_QUIET} ${big ? 'flex-1' : ''}`}>취소</button>
          <button type="button" onClick={submit} disabled={!ok} data-event-save="" className={`${BTN_CONFIRM} ${big ? 'flex-1' : ''}`}>{isNew ? '추가' : '저장'}</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-5">
          <span className="flex-1" />
          <button type="button" onClick={close} className={`${BTN_CONFIRM_QUIET} ${big ? 'flex-1' : ''}`}>닫기</button>
          {canEdit && (
            <button type="button" onClick={startEdit} data-event-edit=""
              className={`inline-flex items-center justify-center gap-1.5 min-h-10 px-4 py-2.5 rounded-md text-[13px] font-semibold transition active:scale-95 bg-accent-weak text-accent-text hover:brightness-95 ${big ? 'flex-1' : ''}`}>
              수정
            </button>
          )}
        </div>
      )}
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
      <div role="dialog" aria-label={title} data-event-dialog=""
        className={`w-full max-h-[92%] overflow-y-auto overscroll-contain flex flex-col px-5 pt-2.5 rounded-t-2xl bg-surface dc-sheet-up${out}`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <span className="self-center w-9 h-1 rounded-full bg-line mb-3 shrink-0" />
        {body}
      </div>
    </div>
  ) : (
    <div {...scrimProps} className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 dc-scrim${out}`}>
      <div role="dialog" aria-label={title} data-event-dialog=""
        className={`bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-[440px] max-h-[min(720px,88dvh)] overflow-y-auto flex flex-col dc-dialog${out}`}>
        {body}
      </div>
    </div>
  ), document.body);
}

// 관련 업무 고르기 — 업무 창의 선행 업무 고르기(modals/taskFields DependsRow)와 같은 모양: 칩(빼기 X) + 네이티브 <select>(더하기).
// 후보는 내가 볼 수 있는 업무 전부(스토어에 있는 것 — 클라우드는 RLS가 이미 걸렀다) · 프로젝트별 묶음(optgroup) · 최근 것이 위.
// 지운 업무·못 보는 업무를 가리키면 제목이 없다 — 그래도 칩은 남겨서 뺄 수 있게 한다('업무 링크').
function RelatedTasksPicker({ value, onChange, big }) {
  const tasksState = useStore(s => s.tasks);
  const projectsState = useStore(s => s.projects);
  const groups = useMemo(() => {
    const m = new Map();
    tasksState.allIds.map(id => tasksState.byId[id]).filter(t => t && !value.includes(t.id)).sort(byNewest).forEach(t => {
      const p = projectsState.byId[t.projectId];
      if (!p) return;
      if (!m.has(p.id)) m.set(p.id, { title: p.title, list: [] });
      m.get(p.id).list.push(t);
    });
    return [...m.values()];
  }, [tasksState, projectsState, value]);
  const add = (id) => { if (id) onChange([...value, id]); };
  const remove = (id) => onChange(value.filter(x => x !== id));
  const size = big ? 'text-[13px] py-1.5' : 'text-[11px] py-1';
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0" data-event-task-picker="">
      {value.map(id => (
        <span key={id} className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 ${size} rounded-full font-semibold bg-surface-hover text-fg max-w-[240px]`}>
          <span className="truncate">{tasksState.byId[id]?.title || '업무 링크'}</span>
          <button type="button" onClick={() => remove(id)} title="관련 업무 삭제" aria-label="관련 업무 삭제"
            className="text-fg-faint hover:text-tag-red-fg transition-colors shrink-0"><X size={big ? 13 : 11} /></button>
        </span>
      ))}
      {groups.length > 0 && (
        <select value="" onChange={(e) => add(e.target.value)} aria-label="관련 업무"
          className={`${size} text-fg-muted bg-surface border border-line rounded-full px-2 outline-none focus:border-accent max-w-[220px]`}>
          <option value="">{value.length ? '+ 더 추가' : '+ 관련 업무 추가'}</option>
          {groups.map(g => (
            <optgroup key={g.title} label={g.title}>
              {g.list.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

// ── 내 달력 ─────────────────────────────────────────────────────────────────
// 프로젝트 달력의 `내 달력`(components/calendarFeed.jsx)과 같은 흐름 — 데스크톱 팝오버(.dc-pop) · 폰 아래 시트.
// **보고 있는 달**의 일정을 체크 목록으로 보이고, 고른 것은 내 개인 행사 피드(구독 주소 하나)에 모인다 — 다른 달에서 고른 것도
// 같은 피드에 남는다(사용자 승인 2026-10-18). 다시 열면 고른 것이 체크된 채로 서고 풀 수 있다. 위 설명 줄은 고른 것 전체를 센다.
// 게스트(이 시안)는 고른 것을 브라우저에 두고(eventStore) 연결 버튼은 서버가 없어 토스트만 띄운다.
const POP_W = 348;
function EventFeedButton({ view, events }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const sheetRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open && !isMobile, POP_W, 460, 8, popRef);
  const dev = useMemo(() => (typeof navigator === 'undefined' ? { os: 'desktop', kakao: false }
    : feedDevice(navigator.userAgent, navigator.maxTouchPoints || 0)), []);
  const buttons = useMemo(() => feedButtons(dev), [dev]);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [rootRef, popRef, sheetRef]);
  const stored = useEventPicks();
  const picks = useMemo(() => livePicks(stored || [], events), [stored, events]);
  const on = useMemo(() => new Set(picks), [picks]);
  const month = useMemo(() => monthEvents(events, view.y, view.m), [events, view.y, view.m]);
  const chosen = useMemo(() => eventCalItems(events).filter(e => on.has(e.id)), [events, on]);
  const ready = chosen.length > 0;
  const toggle = (id) => setEventPicks(togglePick(picks, id));
  const act = () => { if (ready) showToast('미리보기에서는 연결하지 않아요'); };

  const big = isMobile;
  const primary = buttons[0];
  const rest = buttons.slice(1);
  const quiet = `${big ? 'h-[46px] rounded-[10px] text-[13.5px]' : 'h-9 rounded-lg text-[12.5px]'} inline-flex items-center justify-center gap-1.5 font-semibold border border-line bg-surface text-fg transition active:scale-95 disabled:opacity-40 enabled:hover:bg-surface-hover`;
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
          <b className={`${big ? 'text-[16px]' : 'text-[14px]'} font-extrabold text-fg`}>내 달력에 연결</b>
          <p data-event-feed-desc="" className={`${big ? 'text-[13px]' : 'text-[12.5px]'} leading-[1.55] text-fg-muted`}>{eventFeedSentence(chosen.map(e => e.title))}</p>
        </div>
        {!big && (
          <button type="button" onClick={close} aria-label="닫기"
            className="w-[26px] h-[26px] shrink-0 rounded-md grid place-items-center text-fg-muted hover:bg-surface-hover">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={`${big ? 'text-[12px]' : 'text-[11px]'} font-semibold text-fg-muted`}>{view.y}년 {view.m + 1}월</span>
        {month.length ? (
          <div className={`flex flex-col gap-0.5 p-1 rounded-lg border border-line overflow-y-auto ${big ? 'max-h-[38dvh]' : 'max-h-[248px]'}`}>
            {month.map(e => {
              const checked = on.has(e.id);
              return (
                <label key={e.id} data-event-pick={e.id} className={`flex items-center gap-[9px] rounded-md cursor-pointer ${big ? 'px-2.5 py-[11px]' : 'px-2 py-[7px]'} ${checked ? 'bg-accent-weak' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(e.id)}
                    className={`${big ? 'w-[18px] h-[18px]' : 'w-[15px] h-[15px]'} m-0 shrink-0`} style={{ accentColor: 'var(--app-accent)' }} />
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: eventDot(e) }} />
                  <span className={`flex-1 min-w-0 truncate font-semibold text-fg ${big ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{e.title}</span>
                  <span className={`shrink-0 whitespace-nowrap text-fg-muted tabular-nums ${big ? 'text-[12px]' : 'text-[11px]'}`}>{eventRangeLabel(e)}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <p data-event-feed-empty="" className={`py-3 text-center rounded-lg border border-line text-fg-muted ${big ? 'text-[12.5px]' : 'text-[11.5px]'}`}>이 달 일정 없음</p>
        )}
      </div>
      <div className={`flex flex-col ${big ? 'gap-2' : 'gap-[7px]'}`}>
        <button type="button" disabled={!ready} onClick={act}
          className={`${big ? 'h-12 rounded-[10px] text-[14px]' : 'h-[38px] rounded-lg text-[13px]'} font-bold text-white bg-accent transition active:scale-95 disabled:opacity-40 enabled:hover:bg-accent-strong`}>
          {primary.label}
        </button>
        <div className={rest.length > 1 ? 'grid grid-cols-2 gap-[7px]' : 'flex flex-col'}>
          {rest.map(b => (
            <button key={b.act} type="button" disabled={!ready} onClick={act} className={quiet}>
              {b.act === 'copy' && <LinkIcon size={big ? 14 : 13} />}{b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-px bg-line" />
      <div className={`flex flex-col gap-1 leading-[1.55] text-fg-muted ${big ? 'text-[12px]' : 'text-[11.5px]'}`}>
        <span>여기서 일정을 변경하면 내 달력에는 몇 시간 뒤에 반영돼요.</span>
      </div>
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
