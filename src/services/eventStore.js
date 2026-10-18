import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabaseClient.js';
import { normalizeEvent } from './events.js';
import { readCache, writeCache } from './cache.js';
import { useLiveRefresh } from './liveV2.js';
import { createFeedSaver } from './calendarFeed.js';
import { listEvents, saveEventCloud, deleteEventCloud, eventCalendarFeed } from './cloud/events.js';

// ============================================================================
// 행사 일정 저장 자리 — 겉(useEvents · saveEvent · deleteEvent · 내 달력 고른 것)은 시안(mock/b2) 그대로이고 안만 둘로 갈린다.
// 화면은 components/events.jsx, 순수 규칙은 services/events.js, DB 왕복은 services/cloud/events.js(0112).
//
//   · 클라우드 — 표 `events` + `event_tasks`(0112). 목록은 통째로 읽고(행 단위 병합 없음) 지난 값을 캐시(`events:list` · 사용자별)에
//     두어 다음 진입의 첫 그리기에 쓴다. 남이 바꾸면 liveV2의 'events' 신호(events · event_tasks 발행)로 다시 읽는다(useEventsSync).
//     쓰기는 **먼저 그린다** — 저장은 save_event 한 번(행사 + 관련 업무 한 트랜잭션), 지우기는 delete 한 번. 실패하면 그 행사만
//     이전 값으로 되돌리고 부른 쪽의 onFail(토스트는 화면이 띄운다 — 이 파일은 화면 부품을 물지 않는다).
//     새 행사의 id는 여기서 uuid로 먼저 만든다(그려 둔 행사와 저장된 행사가 같은 id다 — save_event가 그 id로 넣는다).
//     저장이 도는 동안 끝난 재조회가 먼저 그린 것을 덮지 않게 `pending`(id → 행사 | null=지움)을 얹어 그린다.
//   · 게스트 — 브라우저 한 칸(`events_v2`) + 처음 열 때 시연 씨앗(그대로). 시연 생일(GUEST_BIRTHDAYS)도 게스트에만 선다.
//
// 내 달력(개인 행사 피드 · 0112 event_feeds · api/ics.js): 사람마다 한 줄 · 고른 것은 화면이 원본이고 createFeedSaver가 400ms 모아
// 하나씩 보낸다(고른 것 전체 · 서버 upsert — 프로젝트 내 달력과 같은 길 · components/calendarFeed.jsx). 처음 열 때 한 번 묻는다
// (그동안 picks는 null — 체크를 막는다). 게스트는 브라우저 한 칸(`event_feed_v1`)이고 주소가 없다.
// ============================================================================

const cloudOn = () => !!supabase;
const KEY = 'events_v2';   // 게스트 · v2(2026-10-18 2차): 절기를 빼고 예배 · 관련 업무 — 1차 시안의 v1은 읽지 않는다
const FEED_KEY = 'event_feed_v1';
const CACHE_KEY = 'events:list';   // liveV2 TABLE_CACHE의 'events' 접두와 글자가 맞아야 신호가 비운다

// 시연 씨앗(게스트만) — 큰 일만(야유회 · 체육대회 · 예배(대림절 주일 넷 · 추수감사 · 성탄 · 송구영신) · 겨울 수련회).
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
// **게스트만**이다(ScheduleView가 cloudOn이면 넘기지 않는다 — 클라우드에서 명단을 읽는 동안 가짜 생일이 서면 안 된다).
export const GUEST_BIRTHDAYS = [
  { id: 'bd_1', name: '강민지', birthday: '10-22', avatarUrl: '' },
  { id: 'bd_2', name: '박지호', birthday: '11-07', avatarUrl: '' },
  { id: 'bd_3', name: '이수빈', birthday: '12-03', avatarUrl: '' },
];
export const guestBirthdays = () => (cloudOn() ? null : GUEST_BIRTHDAYS);   // PITFALLS 65-b

const readGuest = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v; }
  } catch { /* 비공개 모드 · 막힌 저장소 — 씨앗으로 선다 */ }
  return SEED;
};

// ── 목록 ────────────────────────────────────────────────────────────────────
// 클라우드: 서버에서 읽은 것(첫 그리기는 캐시 — 캐시 열쇠는 로그인 뒤에야 사람별이라 useEventsSync가 처음 들어올 때 읽는다) · 게스트: 저장된 것
let base = cloudOn() ? [] : readGuest();
const pending = new Map();   // id → 행사 | null(지움) — 클라우드 저장이 도는 동안 얹는다
let list = base;
const subs = new Set();
const emit = () => { subs.forEach(fn => fn()); };
function recompute() {
  if (!pending.size) { list = base; return; }
  const out = base.filter(e => !pending.has(e.id));
  for (const ev of pending.values()) if (ev) out.push(ev);
  list = out;
}
const setBase = (next) => { base = next; recompute(); emit(); };

export const useEvents = () => useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => list);

// 다시 읽기(클라우드) — 겹쳐 부르면 한 번으로 · 첫 읽기가 실패하면 onFail(캐시가 있으면 지난 값 그대로)
let inflight = null;
let loadedOnce = false;
function refresh(onFail) {
  if (!cloudOn()) return Promise.resolve();
  if (!inflight) {
    inflight = listEvents().then((rows) => {
      loadedOnce = true;
      try { writeCache(CACHE_KEY, rows); } catch { /* 자리가 없으면 이번 화면에서만 */ }
      setBase(rows);
    }).catch((e) => {
      console.error('[events] 목록 읽기 실패:', e);
      onFail?.(e, { hadCache: loadedOnce || base.length > 0 });
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

// 행사 칸이 떠 있는 동안 — 들어올 때 한 번 + 남이 바꾸면(liveV2 'events') 다시. 게스트는 아무 일도 안 한다.
export function useEventsSync(onFail) {
  useEffect(() => {
    if (!cloudOn()) return;
    if (!loadedOnce && !base.length) { const cached = readCache(CACHE_KEY); if (Array.isArray(cached) && cached.length) setBase(cached); }
    void refresh(onFail);
  }, []);   // 들어올 때 한 번(onFail은 모듈 상수다)
  useLiveRefresh('events', () => { void refresh(onFail); });
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }));

// 추가·수정(같은 id면 바꾼다) — 다듬은 행을 **바로** 돌려준다(화면은 먼저 바뀐다). 제목·시작일이 없으면 null(저장하지 않는다).
// 클라우드 저장이 실패하면 그 행사만 이전 값으로(새 행사면 빠진다) 되돌리고 onFail(e).
export function saveEvent(draft, { onFail } = {}) {
  if (!cloudOn()) {
    const ev = normalizeEvent(draft);
    if (!ev) return null;
    const next = base.some(e => e.id === ev.id) ? base.map(e => (e.id === ev.id ? ev : e)) : [...base, ev];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 이 탭에서는 선다 */ }
    setBase(next);
    return ev;
  }
  const ev = normalizeEvent({ ...draft, id: draft?.id || newId() });
  if (!ev) return null;
  pending.set(ev.id, ev);
  recompute(); emit();
  saveEventCloud(ev).then(() => {
    // 저장된 값을 바탕에 넣고 얹은 것을 걷는다(실시간 신호의 재조회가 뒤따라 같은 값을 다시 준다)
    if (pending.get(ev.id) === ev) pending.delete(ev.id);
    setBase(base.some(e => e.id === ev.id) ? base.map(e => (e.id === ev.id ? ev : e)) : [...base, ev]);
  }).catch((e) => {
    console.error('[events] 저장 실패:', e);
    if (pending.get(ev.id) === ev) { pending.delete(ev.id); recompute(); emit(); }
    onFail?.(e);
  });
  return ev;
}

export function deleteEvent(id, { onFail } = {}) {
  if (!cloudOn()) {
    const next = base.filter(e => e.id !== id);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 이 탭에서는 선다 */ }
    setBase(next);
    return;
  }
  pending.set(id, null);
  recompute(); emit();
  deleteEventCloud(id).then(() => {
    if (pending.get(id) === null) pending.delete(id);
    setBase(base.filter(e => e.id !== id));
  }).catch((e) => {
    console.error('[events] 삭제 실패:', e);
    if (pending.get(id) === null) { pending.delete(id); recompute(); emit(); }
    onFail?.(e);
  });
}

// ── 내 달력 고른 것 ──────────────────────────────────────────────────────────
// 게스트: 브라우저 한 칸(null = 아직 한 번도 고르지 않았다) · 클라우드: 서버 한 줄(null = 아직 물어보지 않았다)
const readPicks = () => { try { const v = JSON.parse(localStorage.getItem(FEED_KEY)); return Array.isArray(v) ? v : null; } catch { return null; } };
let feed = { picks: cloudOn() ? null : readPicks(), urls: null };
const feedSubs = new Set();
const setFeed = (patch) => { feed = { ...feed, ...patch }; feedSubs.forEach(fn => fn()); };
export const useEventFeed = () => useSyncExternalStore((fn) => { feedSubs.add(fn); return () => feedSubs.delete(fn); }, () => feed);
// 시안의 이름 그대로(고른 것만)
export const useEventPicks = () => useEventFeed().picks;

let feedFail = null;   // 저장 실패를 받을 화면(내 달력 창이 열려 있을 때 그 창이 넣는다)
export const onEventFeedFail = (fn) => { feedFail = fn; return () => { if (feedFail === fn) feedFail = null; }; };
const saver = createFeedSaver((ids) => eventCalendarFeed(ids), {
  onDone: (out) => { if (out?.url) setFeed({ urls: { url: out.url, webcal: out.webcal } }); },
  onFail: (e) => { console.error('[events] 내 달력 저장 실패:', e); feedFail?.(e); },
});

// 창을 열 때마다(클라우드) — 저장된 것이 없으면 빈 목록에서 시작한다(시안과 같다 · 프로젝트 내 달력처럼 미리 골라 두지 않는다).
// 열 때마다 묻는 것은 계정을 바꾼 탭에서 앞사람의 고른 것이 남지 않게다. 보내는 중이면 화면 것이 원본이라 묻지 않는다.
let feedAsked = null;
export function loadEventFeed() {
  if (!cloudOn()) return Promise.resolve(feed);
  if (feed.picks && saver.pending) return Promise.resolve(feed);
  if (!feedAsked) {
    feedAsked = eventCalendarFeed().then((out) => {
      const urls = out?.url ? { url: out.url, webcal: out.webcal } : null;
      // 묻는 사이 체크를 바꿔 보내는 중이면 화면 것이 원본이다(주소만 받는다)
      if (feed.picks && saver.pending) { if (urls) setFeed({ urls }); return feed; }
      setFeed({ picks: Array.isArray(out?.events) ? out.events : [], urls });
      return feed;
    }).finally(() => { feedAsked = null; });
  }
  return feedAsked;
}

export function setEventPicks(next) {
  if (!cloudOn()) {
    try { localStorage.setItem(FEED_KEY, JSON.stringify(next)); } catch { /* 이 탭에서는 선다 */ }
    setFeed({ picks: next });
    return;
  }
  if (!feed.picks) return;   // 아직 물어보는 중 — 체크가 막혀 있다
  setFeed({ picks: next });
  saver.set(next);
}
// 창을 닫을 때 · 버튼을 누를 때 — 기다리는 저장을 바로 보낸다
export const flushEventFeed = () => saver.flush();
