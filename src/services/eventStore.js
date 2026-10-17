import { useSyncExternalStore } from 'react';
import { normalizeEvent } from './events.js';

// ============================================================================
// 행사 일정 저장 자리(시안 · mock/b2) — **게스트만**이다. 브라우저 한 칸(`events_v2`) + 처음 열 때 시연 씨앗 · 내 달력 고른 것(`event_feed_v1`).
// 클라우드 경로는 아직 없다(마이그레이션·api 없음 · 이 시안은 게스트 빌드로만 미리보기에 선다).
//
// 실제 DB에 붙일 때 필요한 것(사용자 결정 뒤):
//   · 표 `events`(id uuid · title text · start_date date · end_date date · place text · memo text · kind text CHECK 세 값 ·
//     created_by uuid · created_at · updated_at · deleted_at — 휴지통(0104)에 넣을지 정할 것)
//   · RLS: 읽기 = 승인된 사람 모두 · 쓰기(insert/update/delete) = 리더진 + 마스터(_leaders·is_master와 같은 판정)
//   · 실시간: liveV2 라우팅에 events 한 갈래(남이 넣은 행사가 바로 보이게)
//   · 관련 업무: 잇는 표 `event_tasks`(event_id · card_id · position · 지운 업무는 cascade) — 읽기는 행사와 같고, 업무 제목은
//     카드 RLS가 거른다(못 보는 업무는 화면이 '업무 링크' 중립 칩으로 그린다 · visibility.canSeeProject)
//   · 내 달력: 개인 행사 피드 — 프로젝트 내 달력(0085 · api/ics.js)과 같은 모양의 표(owner · 고른 event_id 목록 · 서명 주소 하나).
//     달마다 골라도 피드는 사람당 하나다. .ics는 하루 종일 VEVENT(종료일 다음 날까지 · DTEND 배타)
//   · 휴지통·활동 피드에 실을지는 사용자 결정
// ============================================================================

const KEY = 'events_v2';   // v2(2026-10-18 2차): 절기를 빼고 예배 · 관련 업무 — 1차 시안의 v1은 읽지 않는다
const FEED_KEY = 'event_feed_v1';

// 시연 씨앗 — 큰 일만(야유회 · 체육대회 · 예배(대림절 주일 넷 · 추수감사 · 성탄 · 송구영신) · 겨울 수련회).
// 관련 업무는 인수인계 시연 씨앗(handoverStore — id가 hv-task-N으로 고정)의 업무를 가리킨다. 'demo-hidden-task'는 없는 업무 —
// 나에게 안 보이는 업무가 '업무 링크' 중립 칩으로 서는 모양을 보이려는 것이다.
const SEED = [
  { id: 'ev_seed_1', title: '가을 야유회', start: '2026-10-24', end: '2026-10-24', place: '남한산성', memo: '오전 10시 교회 앞 출발', kind: 'event', taskIds: [] },
  { id: 'ev_seed_2', title: '청년부 체육대회', start: '2026-11-07', end: '2026-11-07', place: '교회 체육관', memo: '순별로 팀을 나눠요', kind: 'event', taskIds: [] },
  { id: 'ev_seed_3', title: '추수감사 예배', start: '2026-11-15', end: '2026-11-15', place: '본당', memo: '', kind: 'service', taskIds: [] },
  { id: 'ev_seed_4', title: '대림절 예배', start: '2026-11-29', end: '2026-11-29', place: '본당', memo: '대림절 첫째 주일', kind: 'service', taskIds: [] },
  { id: 'ev_seed_5', title: '대림절 예배', start: '2026-12-06', end: '2026-12-06', place: '본당', memo: '대림절 둘째 주일', kind: 'service', taskIds: [] },
  { id: 'ev_seed_6', title: '대림절 예배', start: '2026-12-13', end: '2026-12-13', place: '본당', memo: '대림절 셋째 주일', kind: 'service', taskIds: [] },
  { id: 'ev_seed_7', title: '대림절 예배', start: '2026-12-20', end: '2026-12-20', place: '본당', memo: '대림절 넷째 주일', kind: 'service', taskIds: ['hv-task-7'] },
  { id: 'ev_seed_8', title: '성탄 예배', start: '2026-12-25', end: '2026-12-25', place: '본당', memo: '오전 11시', kind: 'service', taskIds: ['hv-task-7', 'hv-task-8'] },
  { id: 'ev_seed_9', title: '2026 겨울 수련회', start: '2026-12-28', end: '2026-12-30', place: '양평 수양관', memo: '신청은 12월 13일까지', kind: 'retreat', taskIds: ['hv-task-0', 'demo-hidden-task'] },
  { id: 'ev_seed_10', title: '송구영신 예배', start: '2026-12-31', end: '2026-12-31', place: '본당', memo: '밤 10시 30분', kind: 'service', taskIds: [] },
];

// 시연 생일 — 게스트에는 가입한 사람(members)이 없어 달력에 생일이 하나도 서지 않는다. 두 칸(행사·업무)이 같이 쓴다.
export const GUEST_BIRTHDAYS = [
  { id: 'bd_1', name: '강민지', birthday: '10-22', avatarUrl: '' },
  { id: 'bd_2', name: '박지호', birthday: '11-07', avatarUrl: '' },
  { id: 'bd_3', name: '이수빈', birthday: '12-03', avatarUrl: '' },
];

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v; }
  } catch { /* 비공개 모드 · 막힌 저장소 — 씨앗으로 선다 */ }
  return SEED;
};
let list = read();
const subs = new Set();
const write = (next) => {
  list = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 이 탭에서는 선다 */ }
  subs.forEach(fn => fn());
};

export const useEvents = () => useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => list);

// 추가·수정(같은 id면 바꾼다) — 다듬은 행을 돌려준다. 제목·시작일이 없으면 null(저장하지 않는다)
export function saveEvent(draft) {
  const ev = normalizeEvent(draft);
  if (!ev) return null;
  write(list.some(e => e.id === ev.id) ? list.map(e => (e.id === ev.id ? ev : e)) : [...list, ev]);
  return ev;
}
export function deleteEvent(id) { write(list.filter(e => e.id !== id)); }

// ── 내 달력 고른 것(게스트 · 브라우저 한 칸) — 클라우드는 개인 행사 피드 표(머리말) ──
const readPicks = () => { try { const v = JSON.parse(localStorage.getItem(FEED_KEY)); return Array.isArray(v) ? v : null; } catch { return null; } };
let picks = readPicks();   // null = 아직 한 번도 고르지 않았다
const pickSubs = new Set();
export const useEventPicks = () => useSyncExternalStore((fn) => { pickSubs.add(fn); return () => pickSubs.delete(fn); }, () => picks);
export function setEventPicks(next) {
  picks = next;
  try { localStorage.setItem(FEED_KEY, JSON.stringify(next)); } catch { /* 이 탭에서는 선다 */ }
  pickSubs.forEach(fn => fn());
}
