import { createHmac } from 'node:crypto';
import { adminClient, readJson, requireApprovedUser, safeEqual, isAdminEmail } from './_lib.js';
import { readNoticeDate, buildIcs, noticeEvent } from '../src/services/noticeDate.js';
import { isApprovedProfile } from '../src/services/approval.js';
import { STATUS_KO, feedKeepRow, feedEvent, buildFeedIcs, feedCalName, feedUrls, taskLink } from '../src/services/calendarFeed.js';

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
// **발행된 주보만**이다(작성 중 주보는 RLS가 편집 자격자에게만 준다 — 서비스 키라 여기서 직접 본다).
// 두 걸음 모두 **화면과 같은 파서**(src/services/noticeDate.js)로 광고를 다시 읽는다 — 칩은 섰는데
// 누르면 엉뚱한 날이 들어가는 일이 없게, 그리고 주소를 손으로 바꿔 아무 광고나 달력으로 만들지 못하게.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 10 * 60 * 1000;
const SUNDAY_LABEL = '주일 4부 젊은이 예배';   // services/worship.js kindLabel과 같은 글자
const kindText = (kind) => (kind === 'sunday' ? SUNDAY_LABEL : (kind || '예배'));

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

async function feedPost(req, res, supabase, user, body) {
  const project = String(body?.project || '');
  if (!UUID_RE.test(project)) { res.status(400).json({ error: '어느 프로젝트인지 알 수 없어요' }); return; }
  const owner = await ownerOf(supabase, user.id);
  const { host, proto } = hostOf(req);
  const reply = (row) => res.status(200).json(row
    ? { cards: row.card_ids || [], ...feedUrls(host, row.id, calSig(row.id), proto) }
    : { cards: null });

  if (!Array.isArray(body.cards)) {
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
  const { data: proj } = await supabase.from('projects').select('id').eq('id', project).maybeSingle();
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

async function feedGet(req, res) {
  const f = String(req.query?.f || '');
  const sig = String(req.query?.sig || '').replace(/\.ics$/i, '');
  if (!UUID_RE.test(f) || !safeEqual(sig, calSig(f))) { gone(res); return; }
  const supabase = adminClient();
  const { data: feed } = await supabase.from('calendar_feeds').select('id, owner, project_id, card_ids').eq('id', f).maybeSingle();
  if (!feed || !(await ownerApproved(supabase, feed.owner))) { gone(res); return; }
  const { data: proj } = await supabase.from('projects').select('id, name').eq('id', feed.project_id).maybeSingle();
  if (!proj) { gone(res); return; }
  let rows = [];
  if (feed.card_ids?.length) {
    const { data, error } = await supabase.from('cards')
      .select('id, title, status, start_date, due_date, card_assignees(profile_id)')
      .eq('project_id', feed.project_id);   // 위 POST와 같은 이유로 id 목록은 여기서 거른다
    if (error) { console.error('[ics] 구독 업무 읽기 실패:', error); res.status(500).end(); return; }
    const picked = new Set(feed.card_ids);
    rows = (data || []).filter(r => picked.has(r.id) && feedKeepRow(r));
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

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const supabase = adminClient();
    const user = await requireApprovedUser(req, res, { supabase });
    if (!user) return;
    const body = await readJson(req);
    // `project`가 있으면 내 달력 구독, 없으면 광고 한 건(아래 — 예전 그대로)
    if (body && body.project !== undefined) { await feedPost(req, res, supabase, user, body); return; }
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
  const ev = noticeEvent(hit.service, hit.notice, a.n, hit.read, kindText(hit.service.kind));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // inline이라야 아이폰 Safari가 내려받기 대신 캘린더 '추가' 화면을 띄운다
  res.setHeader('Content-Disposition', `inline; filename="event.ics"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).end(buildIcs(ev));
}
