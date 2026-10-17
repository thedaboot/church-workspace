import { useSyncExternalStore } from 'react';
import { normalizeEvent } from './events.js';

// ============================================================================
// 행사 일정 저장 자리(시안 · mock/b2) — **게스트만**이다. 브라우저 한 칸(`events_v1`) + 처음 열 때 시연 씨앗.
// 클라우드 경로는 아직 없다(마이그레이션·api 없음 · 이 시안은 게스트 빌드로만 미리보기에 선다).
//
// 실제 DB에 붙일 때 필요한 것(사용자 결정 뒤):
//   · 표 `events`(id uuid · title text · start_date date · end_date date · place text · memo text · kind text CHECK 세 값 ·
//     created_by uuid · created_at · updated_at · deleted_at — 휴지통(0104)에 넣을지 정할 것)
//   · RLS: 읽기 = 승인된 사람 모두 · 쓰기(insert/update/delete) = 리더진 + 마스터(_leaders·is_master와 같은 판정)
//   · 실시간: liveV2 라우팅에 events 한 갈래(남이 넣은 행사가 바로 보이게)
//   · 내 달력: api/ics.js에 '행사 전체' 구독 한 갈래(사람마다 고르지 않고 모두 같은 피드 · 서명 주소 · 하루 종일 VEVENT)
//   · 휴지통·활동 피드에 실을지는 사용자 결정
// ============================================================================

const KEY = 'events_v1';

// 시연 씨앗 — 큰 일만(수련회 · 절기 · 체육대회 · 성탄 · 송구영신 …)
const SEED = [
  { id: 'ev_seed_1', title: '가을 야유회', start: '2026-10-24', end: '2026-10-24', place: '남한산성', memo: '오전 10시 교회 앞 출발', kind: 'event' },
  { id: 'ev_seed_2', title: '종교개혁주일', start: '2026-10-25', end: '2026-10-25', place: '', memo: '', kind: 'season' },
  { id: 'ev_seed_3', title: '청년부 체육대회', start: '2026-11-07', end: '2026-11-07', place: '교회 체육관', memo: '순별로 팀을 나눠요', kind: 'event' },
  { id: 'ev_seed_4', title: '추수감사주일', start: '2026-11-15', end: '2026-11-15', place: '', memo: '', kind: 'season' },
  { id: 'ev_seed_5', title: '대림절', start: '2026-11-29', end: '2026-12-24', place: '', memo: '', kind: 'season' },
  { id: 'ev_seed_6', title: '성탄 예배', start: '2026-12-25', end: '2026-12-25', place: '본당', memo: '오전 11시', kind: 'event' },
  { id: 'ev_seed_7', title: '2026 겨울 수련회', start: '2026-12-28', end: '2026-12-30', place: '양평 수양관', memo: '신청은 12월 13일까지', kind: 'retreat' },
  { id: 'ev_seed_8', title: '송구영신 예배', start: '2026-12-31', end: '2026-12-31', place: '본당', memo: '밤 10시 30분', kind: 'event' },
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
