import { createHmac } from 'node:crypto';
import { adminClient, readJson, requireApprovedUser, safeEqual, isAdminEmail, UUID_RE, serviceKindLabel } from './_lib.js';
import { readNoticeDate, buildIcs, buildIcsMulti, noticeEvent, noticeEvents, noticeIcsName } from '../src/services/noticeDate.js';
import { isApprovedProfile } from '../src/services/approval.js';
import { STATUS_KO, feedKeepRow, feedEvent, buildFeedIcs, feedCalName, feedUrls, taskLink } from '../src/services/calendarFeed.js';
import { isRestricted } from '../src/services/visibility.js';
import { audienceFor } from './_leaders.js';
import { trashedIds, goneCard } from './_trash.js';
import { eventFeedEvent, EVENT_FEED_NAME } from '../src/services/events.js';

// ============================================================================
// /api/ics — 주보 광고 한 건 → 폰 기본 달력(.ics) (2026-09-25 · 광고 → 내 달력 방식 가)
// ----------------------------------------------------------------------------
// **두 걸음이다.** .ics는 브라우저가 주소를 **직접 여는** 것이라(아이폰 Safari가 text/calendar를
// 받으면 캘린더 '추가' 화면을 띄운다 — blob 내려받기보다 확실하다) 그 요청에 Authorization 머리를
// 실을 수 없고, 접근 토큰을 주소에 실으면 방문 기록·서버 로그에 남는다. 그래서:
//   POST { s: 주보 id, n: 광고 순번 }  + Bearer → 승인 확인(공용 머리) → 읽히는 광고면
//        { url: '/api/ics?s=&n=&e=&sig=' } — **10분짜리 서명 주소**
//   GET  ?s=&n=&e=&sig=                        → 서명·만료 확인 → text/calendar
// 서명 열쇠는 서버 비밀(SUPABASE_SECRET_KEY)에서 갈라 낸다(새 비밀 값을 만들지 않는다).
//
// **이번 주 일정 모두 추가**(v5 2묶음 · 2026-10-18)도 같은 두 걸음 · 같은 10분 서명이다 — 그 주보에서 날짜가 읽히는 광고 전부를
// .ics 하나(VEVENT 여러 개 · noticeDate.buildIcsMulti)로:
//   POST { s: 주보 id, all: true } + Bearer → 읽히는 광고가 있으면 { url: '/api/ics?s=&all=1&e=&sig=' }
//   GET  ?s=&all=1&e=&sig=                → 서명(순번 자리에 'all' — 한 건 서명과 섞이지 않는다)·만료 → text/calendar
// 광고 목록은 GET에서 **다시 읽는다**(화면이 보낸 목록을 믿지 않는다 — 한 건과 같은 이유). UID는 광고마다 한 건과 같아서
// 한 건씩 넣은 일정과 겹쳐 쌓이지 않는다. 안드로이드는 구글 템플릿이 한 건씩이라 화면이 .ics를 내려받는다(worshipView).
//
// **내 달력 구독**(2026-09-28 · 0085 · services/calendarFeed.js)도 여기서 받는다 — Hobby 요금제라
// 함수 파일을 늘리지 않는다. 몸통/주소로 갈래를 가른다:
//   POST { project }            + Bearer → 내 줄이 있으면 { cards, url, webcal } · 없으면 { cards: null }
//   POST { project, cards: [] } + Bearer → 그 프로젝트 업무만 남겨 **upsert(owner, project_id)** →
//        { cards, url, webcal } — 같은 요청이 두 번 와도 한 줄로 모인다(고른 것 전체를 보낸다 · 차이가 아니다)
//   GET  /cal/<feed>/<서명>.ics (vercel.json 재작성 → ?f=&sig=) → 서명 · **주인이 아직 승인된 사람인지** →
//        그 프로젝트에 남아 있는 고른 업무로 text/calendar. 만료 없음 · 서명 열쇠 접두는 `cal:`(광고 `ics:`와 다르다).
//   재작성의 마지막 도막은 `:file`(= `<서명>.ics`)로 통째로 받아 여기서 `.ics`를 뗀다 — `:sig.ics` 모양은
//   경로 패턴 해석기에 따라 점을 이름에 넣기도 해서 믿지 않았다.
//
// **행사 내 달력**(0112 · 사람마다 한 줄 `event_feeds` · services/events.js)도 같은 자리 · 같은 재작성이다:
//   POST { eventFeed: true }              + Bearer → 내 줄이 있으면 { events, url, webcal } · 없으면 { events: null }
//   POST { eventFeed: true, events: [] }  + Bearer → 있는 행사만 남겨 **upsert(owner)** → { events, url, webcal }
//   GET  /cal/<줄>/<서명>.ics → 서명 열쇠 접두가 `calev:`인 서명이면 이 갈래다(프로젝트 피드 `cal:`와 같은 주소 모양 ·
//        서명이 달라 서로의 줄을 열지 못한다) → 주인이 승인된 사람인지 → 고른 행사 중 **남아 있는 것만** 하루 종일 일정으로
//        (DTEND = 종료일 다음 날 · events.eventFeedEvent). 행사는 승인된 누구나 읽으므로 프로젝트처럼 보이나를 따로 보지 않는다.
//
// **리더만 보는 프로젝트(0092)**는 주인이 리더일 때만, **직접 선택(0105)**은 주인이 고른 사람·마스터일 때만 — 등록(POST)도
// 구독(GET)도. 서비스 키라 RLS를 안 타서 여기서 직접 본다(seeProject). 프로젝트가 나중에 좁혀지면 못 보는 사람의 구독 주소는 404로 닫힌다.
// **발행된 주보만**이다(작성 중 주보는 RLS가 편집 자격자에게만 준다 — 서비스 키라 여기서 직접 본다).
// 두 걸음 모두 **화면과 같은 파서**(src/services/noticeDate.js)로 광고를 다시 읽는다 — 칩은 섰는데
// 누르면 엉뚱한 날이 들어가는 일이 없게, 그리고 주소를 손으로 바꿔 아무 광고나 달력으로 만들지 못하게.
// ============================================================================

const TTL_MS = 10 * 60 * 1000;

const sign = (s, n, e) => createHmac('sha256', `ics:${process.env.SUPABASE_SECRET_KEY || ''}`)
  .update(`${s}.${n}.${e}`).digest('base64url');

// 주보 + 광고 순번 → { service, notice, read } | null (발행본 · 읽히는 광고만)
async function load(supabase, s, n) {
  const { data, error } = await supabase.from('services')
    .select('id, kind, service_date, status, notices').eq('id', s).maybeSingle();
  if (error) { console.error('[ics] 주보 조회 실패:', error); return null; }
  if (!data || data.status !== 'published') return null;
  const notice = Array.isArray(data.notices) ? data.notices[n] : null;
  const read = notice ? readNoticeDate(notice, data.service_date) : null;
  return read ? { service: data, notice, read } : null;
}

// 주보 하나의 날짜가 읽히는 광고 전부 → { service, events } | null (발행본 · 한 건 이상)
async function loadAll(supabase, s) {
  const { data, error } = await supabase.from('services')
    .select('id, kind, service_date, status, notices').eq('id', s).maybeSingle();
  if (error) { console.error('[ics] 주보 조회 실패:', error); return null; }
  if (!data || data.status !== 'published') return null;
  const events = noticeEvents(data, Array.isArray(data.notices) ? data.notices : [], serviceKindLabel(data.kind));
  return events.length ? { service: data, events } : null;
}

const argsOf = (src) => {
  const s = String(src?.s || '');
  const n = Number(src?.n);
  return UUID_RE.test(s) && Number.isInteger(n) && n >= 0 && n < 100 ? { s, n } : null;
};

// ── 내 달력 구독 ─────────────────────────────────────────────────────────────
const MAX_CARDS = 300;   // 0085의 check와 같은 값
export const calSig = (id) => createHmac('sha256', `cal:${process.env.SUPABASE_SECRET_KEY || ''}`)
  .update(String(id)).digest('base64url');
const hostOf = (req) => ({ host: req.headers.host, proto: req.headers['x-forwarded-proto'] || 'https' });

// 합친 계정이면 남긴 계정 — 줄의 주인은 DB의 effective_uid()와 같은 값이어야 읽기 정책이 맞는다
async function ownerOf(supabase, uid) {
  const { data } = await supabase.from('profiles').select('merged_into').eq('id', uid).maybeSingle();
  return data?.merged_into || uid;
}

// 주인이 이 프로젝트를 볼 수 있는가 → 프로젝트 행(이름 포함) | null. 리더만 보는 프로젝트면 주인이 리더여야 하고(0092),
// 직접 선택이면 주인이 고른 사람이거나 마스터여야 한다(0105 project_audiences). 목록을 못 읽으면 못 본다고 한다(닫힌 쪽).
async function seeProject(supabase, projectId, owner) {
  const { data: proj, error } = await supabase.from('projects').select('id, name, visibility').eq('id', projectId).maybeSingle();
  if (error) { console.error('[ics] 프로젝트 조회 실패:', error); return null; }
  if (!proj) return null;
  // 휴지통(0104)에 있는 프로젝트는 지운 프로젝트와 같다(칸이 없으면 — 0104 전 — 거를 것이 없다)
  try { if ((await trashedIds(supabase)).projects.has(projectId)) return null; } catch (e) {
    console.error('[ics] 휴지통 조회 실패:', e?.message || e); return null;
  }
  if (!isRestricted(proj)) return proj;
  try {
    // 리더만은 올해 리더 ∪ 그해 리더(0110 지난해 리더) · 직접 선택은 고른 사람 ∪ 마스터(_leaders.audienceFor 한 벌)
    const allowed = (await audienceFor(supabase, { projectId: proj.id })) || new Set();
    return allowed.has(owner) ? proj : null;
  } catch (e) {
    console.error('[ics] 보는 사람 목록 조회 실패:', e?.message || e); return null;
  }
}

// ── 행사 내 달력(0112) ───────────────────────────────────────────────────────
export const eventSig = (id) => createHmac('sha256', `calev:${process.env.SUPABASE_SECRET_KEY || ''}`)
  .update(String(id)).digest('base64url');

async function eventFeedPost(req, res, supabase, user, body) {
  const owner = await ownerOf(supabase, user.id);
  const { host, proto } = hostOf(req);
  const reply = (row) => res.status(200).json(row
    ? { events: row.event_ids || [], ...feedUrls(host, row.id, eventSig(row.id), proto) }
    : { events: null });
  if (!Array.isArray(body.events)) {
    const { data, error } = await supabase.from('event_feeds').select('id, event_ids').eq('owner', owner).maybeSingle();
    if (error) { console.error('[ics] 행사 구독 조회 실패:', error); res.status(500).json({ error: 'feed' }); return; }
    reply(data);
    return;
  }
  const want = [...new Set(body.events.map(String))];
  if (want.length > MAX_CARDS || !want.every(id => UUID_RE.test(id))) {
    res.status(400).json({ error: '고른 일정을 읽지 못했어요' }); return;
  }
  let kept = [];
  if (want.length) {
    // 행사 표는 작다(한 해 수십 건) — id 목록을 주소에 싣지 않고 통째로 읽어 거른다(프로젝트 피드와 같은 이유)
    const { data: rows, error } = await supabase.from('events').select('id');
    if (error) { console.error('[ics] 행사 확인 실패:', error); res.status(500).json({ error: 'feed' }); return; }
    const ok = new Set((rows || []).map(r => r.id));
    kept = want.filter(id => ok.has(id));
  }
  const { data: row, error } = await supabase.from('event_feeds')
    .upsert({ owner, event_ids: kept, updated_at: new Date().toISOString() }, { onConflict: 'owner' })
    .select('id, event_ids').single();
  if (error) { console.error('[ics] 행사 구독 저장 실패:', error); res.status(500).json({ error: 'feed' }); return; }
  reply(row);
}

async function feedPost(req, res, supabase, user, body) {
  const project = String(body?.project || '');
  if (!UUID_RE.test(project)) { res.status(400).json({ error: '어느 프로젝트인지 알 수 없어요' }); return; }
  const owner = await ownerOf(supabase, user.id);
  const { host, proto } = hostOf(req);
  const reply = (row) => res.status(200).json(row
    ? { cards: row.card_ids || [], ...feedUrls(host, row.id, calSig(row.id), proto) }
    : { cards: null });
  // 지운 프로젝트와 못 보는 프로젝트(0092)를 가르지 않는다 — 있다는 것부터 알리지 않는다
  const proj = await seeProject(supabase, project, owner);

  if (!Array.isArray(body.cards)) {
    if (!proj) { reply(null); return; }
    const { data, error } = await supabase.from('calendar_feeds').select('id, card_ids')
      .eq('owner', owner).eq('project_id', project).maybeSingle();
    if (error) { console.error('[ics] 구독 조회 실패:', error); res.status(500).json({ error: 'feed' }); return; }
    reply(data);
    return;
  }
  const want = [...new Set(body.cards.map(String))];
  if (want.length > MAX_CARDS || !want.every(id => UUID_RE.test(id))) {
    res.status(400).json({ error: '고른 업무를 읽지 못했어요' }); return;
  }
  if (!proj) { res.status(404).json({ error: '프로젝트가 지워졌어요' }); return; }
  // 그 프로젝트의 업무만 남긴다(다른 프로젝트 id를 끼워 넣어도 달력에 들어가지 않게 — GET도 한 번 더 거른다)
  let kept = [];
  if (want.length) {
    // id 목록을 주소에 싣지 않고 프로젝트 업무를 통째로 읽어 거른다(300개면 주소가 11KB — 프로젝트 하나는 수십 건이다)
    const { data: rows, error } = await supabase.from('cards').select('id').eq('project_id', project);
    if (error) { console.error('[ics] 업무 확인 실패:', error); res.status(500).json({ error: 'feed' }); return; }
    const ok = new Set((rows || []).map(r => r.id));
    kept = want.filter(id => ok.has(id));
  }
  const { data: row, error } = await supabase.from('calendar_feeds')
    .upsert({ owner, project_id: project, card_ids: kept, updated_at: new Date().toISOString() }, { onConflict: 'owner,project_id' })
    .select('id, card_ids').single();
  if (error) { console.error('[ics] 구독 저장 실패:', error); res.status(500).json({ error: 'feed' }); return; }
  reply(row);
}

const NO_FEED = '이 달력 주소는 더 이상 쓸 수 없어요.';
const gone = (res) => {
  res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(NO_FEED);
};

// 담당자 이름 — 앱과 같은 규칙(합친 계정은 남긴 계정의 이름 · cloudSync)
async function namesOf(supabase, ids) {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, display_name, merged_into').in('id', ids);
  const rows = data || [];
  const keep = [...new Set(rows.map(p => p.merged_into).filter(Boolean))];
  const kept = keep.length ? ((await supabase.from('profiles').select('id, display_name').in('id', keep)).data || []) : [];
  const keptName = new Map(kept.map(p => [p.id, p.display_name || '']));
  return new Map(rows.map(p => [p.id, (p.merged_into && keptName.get(p.merged_into)) || p.display_name || '']));
}

// 주인이 아직 승인된 사람인가 — requireApprovedUser와 같은 두 갈래(승인 칸 · 관리자 표)를 id로 본다.
// 내보낸 사람(0027 · approved=false)의 주소는 여기서 닫힌다.
async function ownerApproved(supabase, owner) {
  if (await isApprovedProfile(supabase, owner)) return true;
  const { data } = await supabase.from('profiles').select('email').eq('id', owner).maybeSingle();
  return isAdminEmail(supabase, data?.email);
}

async function eventFeedGet(req, res, f) {
  const supabase = adminClient();
  const { data: feed } = await supabase.from('event_feeds').select('id, owner, event_ids').eq('id', f).maybeSingle();
  if (!feed || !(await ownerApproved(supabase, feed.owner))) { gone(res); return; }
  let rows = [];
  if (feed.event_ids?.length) {
    const { data, error } = await supabase.from('events').select('id, title, start_date, end_date, place, memo');
    if (error) { console.error('[ics] 행사 구독 읽기 실패:', error); res.status(500).end(); return; }
    const picked = new Set(feed.event_ids);
    // 지워진 행사는 표에 없어 저절로 빠진다(event_ids는 그대로 둔다)
    rows = (data || []).filter(r => picked.has(r.id)).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }
  const events = rows.map(r => eventFeedEvent({ id: r.id, title: r.title, start: r.start_date, end: r.end_date, place: r.place, memo: r.memo }));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="thedaboot-events.ics"');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).end(buildFeedIcs({ calName: EVENT_FEED_NAME, events }));
}

async function feedGet(req, res) {
  const f = String(req.query?.f || '');
  const sig = String(req.query?.sig || '').replace(/\.ics$/i, '');
  if (UUID_RE.test(f) && safeEqual(sig, eventSig(f))) { await eventFeedGet(req, res, f); return; }
  if (!UUID_RE.test(f) || !safeEqual(sig, calSig(f))) { gone(res); return; }
  const supabase = adminClient();
  const { data: feed } = await supabase.from('calendar_feeds').select('id, owner, project_id, card_ids').eq('id', f).maybeSingle();
  if (!feed || !(await ownerApproved(supabase, feed.owner))) { gone(res); return; }
  const proj = await seeProject(supabase, feed.project_id, feed.owner);
  if (!proj) { gone(res); return; }
  let rows = [];
  if (feed.card_ids?.length) {
    const { data, error } = await supabase.from('cards')
      .select('id, title, status, start_date, due_date, card_assignees(profile_id)')
      .eq('project_id', feed.project_id);   // 위 POST와 같은 이유로 id 목록은 여기서 거른다
    if (error) { console.error('[ics] 구독 업무 읽기 실패:', error); res.status(500).end(); return; }
    const picked = new Set(feed.card_ids);
    // 휴지통(0104)의 업무는 달력에서 빠진다 — 복원하면 다음 구독 갱신에 돌아온다(card_ids는 그대로 둔다)
    let trashed = { projects: new Set(), cards: new Set() };
    try { trashed = await trashedIds(supabase); } catch (e) { console.error('[ics] 휴지통 조회 실패:', e?.message || e); res.status(500).end(); return; }
    rows = (data || []).filter(r => picked.has(r.id) && !goneCard(trashed, r) && feedKeepRow(r));
  }
  const names = await namesOf(supabase, [...new Set(rows.flatMap(r => (r.card_assignees || []).map(a => a.profile_id)))]);
  const { host, proto } = hostOf(req);
  const origin = `${proto}://${host}`;
  const events = rows.map(r => feedEvent({
    id: r.id, title: r.title, status: STATUS_KO[r.status] || '시작 전', startDate: r.start_date || '', dueDate: r.due_date || '',
    assignees: (r.card_assignees || []).map(a => names.get(a.profile_id)).filter(Boolean),
  }, taskLink(origin, feed.project_id, r.id)));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="thedaboot.ics"');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).end(buildFeedIcs({ calName: feedCalName(proj.name), events }));
}

// GET ?s=&all=1&e=&sig= — 이번 주 일정 모두 추가(위 머리말)
async function allGet(req, res) {
  const s = String(req.query?.s || '');
  const e = Number(req.query?.e);
  if (!UUID_RE.test(s) || !Number.isFinite(e) || e < Date.now() || !safeEqual(String(req.query?.sig || ''), sign(s, 'all', e))) {
    res.status(403).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('링크가 만료되었어요. 앱에서 다시 눌러주세요.');
    return;
  }
  const hit = await loadAll(adminClient(), s);
  if (!hit) {
    res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('이 주보에서 날짜를 읽지 못했어요.');
    return;
  }
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // 한글 파일 이름은 filename*(RFC 5987) — 옛 이름 칸은 ASCII로 남긴다
  res.setHeader('Content-Disposition', `inline; filename="notices.ics"; filename*=UTF-8''${encodeURIComponent(noticeIcsName(hit.service.service_date))}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).end(buildIcsMulti(hit.events));
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const supabase = adminClient();
    const user = await requireApprovedUser(req, res, { supabase });
    if (!user) return;
    const body = await readJson(req);
    // `project`가 있으면 내 달력 구독, `eventFeed`면 행사 내 달력(0112), 둘 다 없으면 광고 한 건(아래 — 예전 그대로)
    if (body && body.project !== undefined) { await feedPost(req, res, supabase, user, body); return; }
    if (body && body.eventFeed !== undefined) { await eventFeedPost(req, res, supabase, user, body); return; }
    // 이번 주 일정 모두 추가 — 그 주보의 광고 전부(위 머리말)
    if (body && body.all === true) {
      const s = String(body.s || '');
      if (!UUID_RE.test(s)) { res.status(400).json({ error: '어느 주보인지 알 수 없어요' }); return; }
      if (!(await loadAll(supabase, s))) { res.status(404).json({ error: '이 주보에서 날짜를 읽지 못했어요' }); return; }
      const e = Date.now() + TTL_MS;
      res.status(200).json({ url: `/api/ics?s=${s}&all=1&e=${e}&sig=${sign(s, 'all', e)}` });
      return;
    }
    const a = argsOf(body);
    if (!a) { res.status(400).json({ error: '어느 광고인지 알 수 없어요' }); return; }
    const hit = await load(supabase, a.s, a.n);
    if (!hit) { res.status(404).json({ error: '이 광고에서 날짜를 읽지 못했어요' }); return; }
    const e = Date.now() + TTL_MS;
    res.status(200).json({ url: `/api/ics?s=${a.s}&n=${a.n}&e=${e}&sig=${sign(a.s, a.n, e)}` });
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }
  if (req.query?.f !== undefined) { await feedGet(req, res); return; }
  if (req.query?.all !== undefined) { await allGet(req, res); return; }

  const a = argsOf(req.query);
  const e = Number(req.query?.e);
  if (!a || !Number.isFinite(e) || e < Date.now() || !safeEqual(String(req.query?.sig || ''), sign(a.s, a.n, e))) {
    res.status(403).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('링크가 만료되었어요. 앱에서 다시 눌러주세요.');
    return;
  }
  const hit = await load(adminClient(), a.s, a.n);
  if (!hit) {
    res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('이 광고에서 날짜를 읽지 못했어요.');
    return;
  }
  const ev = noticeEvent(hit.service, hit.notice, a.n, hit.read, serviceKindLabel(hit.service.kind));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // inline이라야 아이폰 Safari가 내려받기 대신 캘린더 '추가' 화면을 띄운다
  res.setHeader('Content-Disposition', `inline; filename="event.ics"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).end(buildIcs(ev));
}
