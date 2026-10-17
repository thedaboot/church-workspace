// ============================================================================
// 행사 일정(시안 · mock/b2 · 2026-10-18) — 순수 규칙. import 0(logcheck가 노드에서 그대로 들인다).
// ----------------------------------------------------------------------------
// '전체 일정'의 '행사' 칸에 서는 것: 수련회·절기(대림절 기간)·체육대회처럼 청년부 전체가 보는 큰 일.
// 업무가 아니다 — 담당자·상태·프로젝트가 없고, 하루 종일 일정만 있다(시작일 ~ 종료일 · 장소 · 메모 · 종류 색).
// 저장 자리는 아직 게스트뿐이다(services/eventStore.js). 실제 DB에 붙일 때 필요한 것은 그 파일 머리말.
//
// 누가 추가·수정·삭제하나 — **리더진 + 마스터**(사용자 결정 2026-10-18). 바꾸려면 EVENT_EDITORS 한 줄이다
// ('everyone'이면 승인된 사람 모두). 화면은 canEditEvents 하나만 본다.
// ============================================================================

export const EVENT_EDITORS = 'leaders';   // 'leaders' = 리더진 + 마스터 · 'everyone' = 모두

// who: { isMaster, amLeader } — 게스트는 isMaster가 true다(auth.jsx). amLeader는 클라우드가 채우는 스토어 칸(0092).
export function canEditEvents(who = {}, rule = EVENT_EDITORS) {
  if (rule === 'everyone') return true;
  return who.isMaster === true || who.amLeader === true;
}

// 종류 — 색 세 벌(띠 바탕 · 진한 글자 · 레일). 토큰만 쓴다(다크 모드를 따라간다 · HANDOFF §8).
export const EVENT_KINDS = [
  { key: 'event', label: '행사', token: 'blue' },
  { key: 'season', label: '절기', token: 'purple' },
  { key: 'retreat', label: '수련회', token: 'green' },
];
export const kindOf = (key) => EVENT_KINDS.find(k => k.key === key) || EVENT_KINDS[0];
export const eventPaint = (ev, strong = false) => {
  const tk = kindOf(ev?.kind).token;
  return { background: `var(--app-tag-${tk}${strong ? '-fg' : ''})`, color: `var(--app-tag-${tk}-fg)` };
};
export const eventDot = (ev) => `var(--app-tag-${kindOf(ev?.kind).token}-fg)`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 기간 — 종료일이 없으면 시작일 하루, 거꾸로 적혔으면 뒤집는다. 시작일이 없으면 달력에 얹지 않는다(null).
export function eventSpan(ev) {
  const s = ISO.test(ev?.start || '') ? ev.start : null;
  const e = ISO.test(ev?.end || '') ? ev.end : null;
  const start = s || e;
  if (!start) return null;
  const end = e || s;
  return start <= end ? { start, end } : { start: end, end: start };
}

// 달력(CalendarBoard)의 띠 배치는 업무의 startDate·dueDate를 읽는다 — 행사를 같은 모양으로 넘겨 띠 그리기를 한 벌로 쓴다.
export function eventCalItem(ev) {
  const s = eventSpan(ev);
  if (!s) return null;
  return { ...ev, startDate: s.start, dueDate: s.end, isEvent: true };
}
export const eventCalItems = (list = []) => list.map(eventCalItem).filter(Boolean)
  .sort((a, b) => (a.startDate === b.startDate ? b.dueDate.localeCompare(a.dueDate) : a.startDate.localeCompare(b.startDate)));

// 그 날 걸쳐 있는 행사(긴 것 먼저 — 띠가 위에 서는 차례와 같다)
export const eventsOn = (list = [], iso) => eventCalItems(list).filter(e => e.startDate <= iso && iso <= e.dueDate);

// 'M월 D일' · 기간이면 'M월 D일 ~ M월 D일'(같은 달이면 뒤의 달을 접지 않는다 — 업무 목록 표기와 같은 결)
const md = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
export function eventRangeLabel(ev) {
  const s = eventSpan(ev);
  if (!s) return '';
  return s.start === s.end ? md(s.start) : `${md(s.start)} ~ ${md(s.end)}`;
}

// 저장 전 다듬기 — 제목과 시작일이 있어야 한다. 종료일이 시작일보다 앞이면 시작일로 맞춘다.
export function normalizeEvent(draft = {}) {
  const title = String(draft.title || '').trim();
  const start = ISO.test(draft.start || '') ? draft.start : '';
  if (!title || !start) return null;
  let end = ISO.test(draft.end || '') ? draft.end : start;
  if (end < start) end = start;
  return {
    id: draft.id || `ev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title, start, end,
    place: String(draft.place || '').trim(),
    memo: String(draft.memo || '').trim(),
    kind: kindOf(draft.kind).key,
  };
}
