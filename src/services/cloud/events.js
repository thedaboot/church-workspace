// ============================================================================
// 행사 일정(0112) — 목록 읽기 · 저장(save_event 한 번) · 지우기 · 내 달력(개인 행사 피드 · api/ics.js)
// ----------------------------------------------------------------------------
// 화면 쪽 겉(useEvents · saveEvent · deleteEvent · 내 달력 고른 것)은 services/eventStore.js가 쥐고, 여기는 DB 왕복만 한다.
// 앱 안의 행사 모양은 시안 그대로다 — { id, title, start, end, place, memo, kind, taskIds }(services/events.js normalizeEvent).
// 권한의 경계는 DB다(읽기 승인 전원 · 쓰기 리더진 + 마스터) — 화면의 canEditEvents와 이중으로 걸린다.
// ============================================================================
import { client, unwrap, authedPost } from './core.js';

const COLS = 'id, title, start_date, end_date, start_time, end_time, kind, place, memo, event_tasks(card_id, position)';

// DB 행 → 앱 모양(관련 업무는 position 차례)
export const eventFromRow = (r) => ({
  id: r.id, title: r.title || '', start: r.start_date || '', end: r.end_date || r.start_date || '',
  place: r.place || '', memo: r.memo || '', kind: r.kind || 'event',
  // 시각(0116) — DB는 'HH:MM:SS' · 앱은 'HH:MM' · 없으면 '' (하루 종일)
  startTime: (r.start_time || '').slice(0, 5), endTime: (r.end_time || '').slice(0, 5),
  taskIds: [...(r.event_tasks || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(x => x.card_id),
});

// 앱 모양 → save_event 인자(관련 업무까지 한 트랜잭션 · 0112 머리말)
export const saveEventArgs = (ev) => ({
  p_id: ev.id, p_title: ev.title, p_start: ev.start, p_end: ev.end || ev.start, p_kind: ev.kind,
  p_place: ev.place || '', p_memo: ev.memo || '', p_cards: ev.taskIds || [],
  p_start_time: ev.startTime || null, p_end_time: (ev.startTime && ev.endTime) || null,
});

export async function listEvents() {
  const rows = unwrap(await client().from('events').select(COLS).order('start_date', { ascending: true }));
  return (rows || []).map(eventFromRow);
}

export async function saveEventCloud(ev) {
  return unwrap(await client().rpc('save_event', saveEventArgs(ev)));
}

export async function deleteEventCloud(id) {
  unwrap(await client().from('events').delete().eq('id', id));
}

// ── 내 달력(개인 행사 피드 · 0112 event_feeds · api/ics.js) ───────────────────────
// 프로젝트 내 달력(admin.projectCalendarFeed)과 같은 모양 — events를 빼면 저장된 것을 묻고({ events: null }이면 아직 없다),
// 주면 **고른 것 전체**로 덮는다. → { events, url, webcal }
export async function eventCalendarFeed(events) {
  const r = await authedPost('/api/ics', events === undefined ? { eventFeed: true } : { eventFeed: true, events }, {
    noToken: () => { const e = new Error('로그인이 필요해요'); e.status = 401; throw e; },
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(out.error || `event feed ${r.status}`); e.status = r.status; throw e; }
  return out;
}
