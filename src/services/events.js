// ============================================================================
// 행사 일정(사용자 승인 시안 mock/b2 · 2026-10-18 · 0112) — 순수 규칙. import 0(logcheck가 노드에서 그대로 들이고, api/ics.js도 문다).
// ----------------------------------------------------------------------------
// '전체 일정'의 '행사' 칸에 서는 것: 수련회·예배(대림절·성탄·송구영신)·체육대회처럼 청년부 전체가 보는 큰 일.
// 절기 기간 띠(대림절 11/29~12/24 같은)는 두지 않는다(사용자 결정 2026-10-18 — 절기 종류를 뺐다). 대림절은 주일마다 '예배' 하루씩.
// 업무가 아니다 — 담당자·상태·프로젝트가 없고, 하루 종일 일정만 있다(시작일 ~ 종료일 · 장소 · 메모 · 종류 색 · 관련 업무 taskIds).
// 저장 자리는 services/eventStore.js 한 곳(클라우드 0112 `events` · 게스트 브라우저 한 칸).
//
// 누가 추가·수정·삭제하나 — **리더진 + 마스터**(사용자 결정 2026-10-18). 바꾸려면 EVENT_EDITORS 한 줄이다
// ('everyone'이면 승인된 사람 모두). 화면은 canEditEvents 하나만 본다. **DB도 같이 고친다** — 0112의 events·event_tasks 쓰기 정책과
// save_event 첫 줄이 `is_leader() or is_master()`다(화면만 열면 저장이 42501로 실패한다).
// ============================================================================

export const EVENT_EDITORS = 'leaders';   // 'leaders' = 리더진 + 마스터 · 'everyone' = 모두

// who: { isMaster, amLeader } — 게스트는 isMaster가 true다(auth.jsx). amLeader는 클라우드가 채우는 스토어 칸(0092).
export function canEditEvents(who = {}, rule = EVENT_EDITORS) {
  if (rule === 'everyone') return true;
  return who.isMaster === true || who.amLeader === true;
}

// 종류 — 색 세 벌(띠 바탕 · 진한 글자 · 레일). 토큰만 쓴다(다크 모드를 따라간다 · HANDOFF §8).
// 차례는 어디서나 예배 · 행사 · 수련회(사용자 결정 2026-10-18 — 칩 · 범례 · 고르기)
export const EVENT_KINDS = [
  { key: 'service', label: '예배', token: 'purple' },
  { key: 'event', label: '행사', token: 'blue' },
  { key: 'retreat', label: '수련회', token: 'green' },
];
// 모르는 종류는 '행사'로 본다(차례의 첫 칸이 아니다)
export const kindOf = (key) => EVENT_KINDS.find(k => k.key === key) || EVENT_KINDS[1];
export const eventPaint = (ev, strong = false) => {
  const tk = kindOf(ev?.kind).token;
  return { background: `var(--app-tag-${tk}${strong ? '-fg' : ''})`, color: `var(--app-tag-${tk}-fg)` };
};
export const eventDot = (ev) => `var(--app-tag-${kindOf(ev?.kind).token}-fg)`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// 시각(0116 · 사용자 승인 목업 ① 2026-10-19) — 'HH:MM' KST 벽시계. 비면 하루 종일이다.
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hmOf = (v) => { const t = String(v || '').slice(0, 5); return HM.test(t) ? t : ''; };
// '오전 11:00' · '오후 12:00' · '오전 12:30'(자정 30분)
export function koTime(hm) {
  const t = hmOf(hm);
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}
// 고른 날 목록·읽기 상태의 시각 — '오전 11:00~오후 12:00' · 종료가 없으면 시작만 · 하루 종일이면 ''
export function eventTimeLabel(ev) {
  const s = hmOf(ev?.startTime);
  if (!s) return '';
  const e = hmOf(ev?.endTime);
  return e ? `${koTime(s)}~${koTime(e)}` : koTime(s);
}
// 달력 띠 앞 시각 — '11시' · '19시 30분'(띠는 좁아 24시 꼴 · 목업 ①)
const barTime = (hm) => {
  const t = hmOf(hm);
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return m ? `${h}시 ${m}분` : `${h}시`;
};
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
  const bt = barTime(ev.startTime);
  return { ...ev, startDate: s.start, dueDate: s.end, isEvent: true, ...(bt ? { barLabel: `${bt} ${ev.title}` } : {}) };
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
  // 종료 시각은 시작 시각이 있을 때만 · 하루 일정이면 시작보다 뒤여야 한다(0116 events_time_check와 같은 규칙)
  const startTime = hmOf(draft.startTime);
  let endTime = startTime ? hmOf(draft.endTime) : '';
  if (endTime && end === start && endTime <= startTime) endTime = '';
  return {
    id: draft.id || `ev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title, start, end, startTime, endTime,
    place: String(draft.place || '').trim(),
    memo: String(draft.memo || '').trim(),
    kind: kindOf(draft.kind).key,
    taskIds: [...new Set((draft.taskIds || []).filter(x => typeof x === 'string' && x))],
  };
}

// 그 달에 걸친 행사(내 달력 고르기 목록 — 지금 보고 있는 달) · m은 0부터
export function monthEvents(list = [], y, m) {
  const pre = `${y}-${String(m + 1).padStart(2, '0')}`;
  const from = `${pre}-01`, to = `${pre}-31`;
  return eventCalItems(list).filter(e => e.startDate <= to && e.dueDate >= from);
}

// ── 내 달력(개인 행사 피드) ─────────────────────────────────────────────────
// 프로젝트 달력의 내 달력(services/calendarFeed.js)과 같은 모양 — 사람마다 고른 행사가 한 피드(구독 주소 하나)에 모인다.
// 달마다 열어 고르지만 피드는 하나라 다른 달에서 고른 것도 그대로 남는다. 지워진 행사의 id는 걸러 낸다.
export function togglePick(picks = [], id) {
  return picks.includes(id) ? picks.filter(x => x !== id) : [...picks, id];
}
export const livePicks = (picks = [], list = []) => {
  const ids = new Set(list.map(e => e.id));
  return picks.filter(id => ids.has(id));
};
// 판 위 설명 한 줄(고른 것 전체 — 이 달만이 아니다). 같은 제목(대림절 예배 넷)은 한 번만 부르고 나머지는 '외 N건'에 센다.
export function eventFeedSentence(titles) {
  const all = titles || [];
  if (!all.length) return '내 달력에 추가할 일정을 선택해 주세요.';
  const named = [...new Set(all)].slice(0, 2);
  const rest = all.filter(t => !named.includes(t)).length;
  return rest ? `${named.join(', ')} 외 ${rest}건이 내 달력에 추가돼요.` : `${named.join(', ')} 일정이 내 달력에 추가돼요.`;
}

// ── 내 달력 피드(.ics) 한 줄 — api/ics.js가 부른다(서버와 화면이 같은 기간 규칙 · eventSpan) ──────────────
// 하루 종일 일정 하나. DTEND는 **종료일 다음 날**이다(VALUE=DATE는 그 날을 빼고 센다 — calendarFeed.feedEvent와 같다).
// 모양은 calendarFeed.buildFeedIcs가 받는 것(start 'YYYY-MM-DD' · end 'YYYYMMDD') · 장소는 LOCATION · 메모는 DESCRIPTION.
const nextDayCompact = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, '');
};
// 시각이 있으면(0116) 하루 종일이 아니라 그 시각으로 — startAt·endAt('YYYYMMDDTHHMMSSZ' · KST를 UTC로). 종료 시각이 없으면 1시간짜리.
const utcStamp = (iso, hm, plusMin = 0) => {
  const [y, mo, d] = iso.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi + plusMin)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};
export function eventFeedEvent(ev) {
  const s = eventSpan(ev);
  const title = String(ev?.title || '').trim();
  if (!s || !title || !ev?.id) return null;
  const base = { uid: `event-${ev.id}@thedaboot`, title, start: s.start, end: nextDayCompact(s.end),
    location: String(ev.place || '').trim(), description: String(ev.memo || '').trim() };
  const st = hmOf(ev.startTime);
  if (!st) return base;
  const et = hmOf(ev.endTime);
  return { ...base, startAt: utcStamp(s.start, st), endAt: et ? utcStamp(s.end, et) : utcStamp(s.end, st, 60) };
}
// 달력 앱에 보이는 이 구독의 이름
export const EVENT_FEED_NAME = '더다붓 · 행사 일정';
