import { createHmac } from 'node:crypto';
import { adminClient, readJson, requireApprovedUser, safeEqual } from './_lib.js';
import { readNoticeDate, buildIcs, noticeEvent } from '../src/services/noticeDate.js';

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

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const supabase = adminClient();
    const user = await requireApprovedUser(req, res, { supabase });
    if (!user) return;
    const a = argsOf(await readJson(req));
    if (!a) { res.status(400).json({ error: '어느 광고인지 알 수 없어요' }); return; }
    const hit = await load(supabase, a.s, a.n);
    if (!hit) { res.status(404).json({ error: '이 광고에서 날짜를 읽지 못했어요' }); return; }
    const e = Date.now() + TTL_MS;
    res.status(200).json({ url: `/api/ics?s=${a.s}&n=${a.n}&e=${e}&sig=${sign(a.s, a.n, e)}` });
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }

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
