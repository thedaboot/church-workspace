import webpush from 'web-push';
import { notifLine } from '../src/services/notifyText.js';
import { adminClient, readJson, bearer, requireApprovedUser, safeEqual, sameOriginPath } from './_lib.js';
import { syncDocVectors } from './_docsync.js';

// ============================================================================
// /api/push — 웹 푸시 발송. 두 입구가 한 파일에 있다.
// ----------------------------------------------------------------------------
//   POST  앱이 알림 행을 넣은 직후 부른다(cloud.insertNotifications 안에서).
//         Authorization: Bearer <supabase access token> — **승인된 사람만**(_lib.js).
//   GET   하루 한 번 Vercel Cron이 깨운다(vercel.json의 crons). Authorization: Bearer <CRON_SECRET>.
//         `?job` 하나로 갈린다 — 크론 자리가 **두 개까지**라(Vercel Hobby) 배치가 늘 때마다
//         라우트를 새로 파지 않고 이 입구를 나눠 쓴다.
//           (없음)          오늘·내일 마감인데 완료가 아닌 카드의 담당자에게 due_soon
//                           → 그 **뒤에** 업무·댓글·첨부 임베딩 증분(doc_vec · 0074 · 시간 예산 안에서만)
//           job=worship     오늘(KST) 발행된 주보가 있으면 승인 멤버 전원에게 worship_today
//                           → 이어서 내일(KST) 동아리 모임이 있으면 그 구성원에게 meeting_tomorrow(0078)
//           job=embed       임베딩 증분만(손으로 부르는 길 · 크론에는 없다 — 자리가 둘뿐이다)
//
// 왜 pg_cron이 아니라 Vercel Cron인가: DB에서 푸시를 보내려면 pg_net으로 HTTP를
// 쳐야 하고, 그러면 발송 로직이 SQL과 JS 두 곳에 갈라진다. 보존 기간 정리(0012)는
// DB 안에서 끝나는 일이라 pg_cron이 맞지만 이건 아니다.
//
// 구독을 읽고 쓰는 일은 service key로 한다 — push_subscriptions의 RLS는 본인 행만
// 허용하므로, 남에게 보내려면 서버가 우회해야 한다.
// ============================================================================

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const admin = adminClient;

// VAPID 키가 없으면 **발송만** 건너뛴다. 마감 임박 배치는 앱 안 알림도 만들기 때문에,
// 키가 없다고 라우트 전체를 501로 막으면 종에도 아무것도 안 뜬다.
const pushReady = () => !!(VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT);
if (pushReady()) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// POST 한 번에 받는 사람 상한과 미리보기 글자 상한(보안 감사 2026-09-24). 미리보기는 DB의
// 알림 INSERT 정책(0053 · 200자)과 같은 값이다. 받는 사람이 제일 많은 것은 주보 발행
// 알림(승인 멤버 전원)이고 2026-09-24에 22명이다 — **멤버가 50명을 넘으면 여기를 올리세요**
// (넘친 사람에게는 앱 안 알림만 가고 푸시가 조용히 빠진다).
export const MAX_RECIPIENTS = 50;
export const MAX_PREVIEW = 200;

// 푸시 제목의 '누가'는 **서버가 정한다** — 몸통의 actorName을 그대로 쓰면 아무 이름('관리자')이나
// 실을 수 있다. 앱 안 알림 행도 0071 트리거가 같은 값으로 덮는다(합친 계정은 남긴 계정의 이름).
async function actorNameOf(db, uid, fallback) {
  const { data: me } = await db.from('profiles').select('display_name, merged_into').eq('id', uid).maybeSingle();
  let name = me?.display_name;
  if (me?.merged_into) {
    const { data: keep } = await db.from('profiles').select('display_name').eq('id', me.merged_into).maybeSingle();
    name = keep?.display_name || name;
  }
  return String(name || '').trim() || fallback || '누군가';
}

// 딥링크는 이미 있다 — /?p=<projectId>&t=<cardId>
// (kstDate와 함께 tests/push.mjs가 직접 부른다 — 그래서 export)
export const deepLink = (projectId, cardId) => {
  const params = new URLSearchParams();
  if (projectId) params.set('p', projectId);
  if (cardId) params.set('t', cardId);
  const q = params.toString();
  return q ? `/?${q}` : '/';
};

// ── 발송 ────────────────────────────────────────────────────────────────────
// profileIds(= auth.users.id)의 모든 기기로 보낸다. 한 사람이 여러 기기를 가질 수 있다.
// 410/404는 "그 구독은 죽었다"는 뜻이므로 행을 지운다 — 안 지우면 앱을 지운 기기로
// 매번 보내고, 그 실패가 로그를 가려서 진짜 실패를 못 본다.
//
// **준비(질의)와 발송을 갈라 둔 이유**: 마감 임박 배치는 한 번 돌 때 알림이 여러 건이고,
// 예전에는 그 한 건마다 sendToProfiles를 불러 구독 조회 + 안 읽은 수 집계를 **다시** 했다
// (알림 N건 → 왕복 2N번, 그것도 순차 await). 지금은 받는 사람 전부를 한 번에 읽어
// 사람별 Map으로 들고, 카드별 발송은 그 Map만 본다.

// 구독 · 안 읽은 알림 수를 한 번에 읽어 사람별로 묶는다.
async function loadTargets(db, profileIds) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  const byProfile = new Map();
  const unread = new Map();
  if (!ids.length) return { byProfile, unread };

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('profile_id, endpoint, p256dh, auth')
    .in('profile_id', ids);
  if (error) throw error;
  for (const s of subs || []) {
    const list = byProfile.get(s.profile_id);
    if (list) list.push(s); else byProfile.set(s.profile_id, [s]);
  }
  if (!byProfile.size) return { byProfile, unread };

  // 아이콘 위 숫자(안 읽은 알림 수)는 **받는 사람마다 다르다** — payload를 하나로 만들어
  // 돌려쓸 수 없다. 사람 수만큼 질의하지 않도록 한 번에 세어 Map에 담아 둔다.
  // 이 시점에는 이 알림의 행이 이미 insert된 뒤다(insertNotifications도 배치도 그 순서다).
  const { data: rows, error: cntErr } = await db
    .from('notifications').select('recipient_id').eq('read', false).in('recipient_id', ids);
  // 못 세면 숫자만 빠진다 — 알림 자체는 보낸다.
  if (cntErr) console.error('[push] 안 읽은 수 세기 실패:', cntErr);
  else for (const r of rows || []) unread.set(r.recipient_id, (unread.get(r.recipient_id) || 0) + 1);

  return { byProfile, unread };
}

// 준비된 구독으로 한 건 보낸다. 죽은 구독은 dead에 모으고, 지우는 것은 부르는 쪽이
// 마지막에 한 번만 한다(같은 기기가 여러 알림에 걸려도 삭제는 한 번).
async function pushWith(targets, profileIds, { title, body, url, tag }, dead) {
  const { byProfile, unread } = targets;
  const deadSet = new Set(dead);
  const subs = [...new Set((profileIds || []).filter(Boolean))]
    .flatMap(id => byProfile.get(id) || [])
    .filter(s => !deadSet.has(s.endpoint));
  if (!subs.length) return 0;

  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        // appBadge는 showNotification의 badge(안드로이드 상태바 아이콘 주소)와 다른 값이다.
        // 세지 못했으면 null — 워커가 그때는 숫자를 건드리지 않는다.
        JSON.stringify({ title, body, url, tag, appBadge: unread.get(s.profile_id) ?? null }),
      );
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
      else console.error('[push] 발송 실패:', e?.statusCode, e?.body || e?.message);
    }
  }));
  return sent;
}

async function dropDead(db, dead) {
  const gone = [...new Set(dead)];
  if (!gone.length) return 0;
  const { error } = await db.from('push_subscriptions').delete().in('endpoint', gone);
  if (error) console.error('[push] 죽은 구독 정리 실패:', error);
  return gone.length;
}

// 한 건짜리 입구(POST)용 — 준비와 발송을 한 번에.
async function sendToProfiles(db, profileIds, payload) {
  if (!pushReady()) return { sent: 0, dropped: 0 };
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return { sent: 0, dropped: 0 };

  const targets = await loadTargets(db, ids);
  const dead = [];
  const sent = await pushWith(targets, ids, payload, dead);
  return { sent, dropped: await dropDead(db, dead) };
}

// ── POST: 앱이 만든 알림을 푸시로 한 번 더 ──────────────────────────────────
async function handleSend(req, res) {
  // POST는 푸시가 전부인 입구다. 키가 없으면 할 일이 없다 — 앱은 이 응답을 무시한다.
  if (!pushReady()) { res.status(501).json({ error: '푸시가 아직 설정되지 않았습니다 (VAPID 키 3종 필요).' }); return; }

  // 승인된 사람만 — 예전에는 로그인만 봐서 승인 전 계정도 아무에게나 푸시를 보낼 수 있었다
  const db = admin();
  const user = await requireApprovedUser(req, res, { supabase: db });
  if (!user) return;

  const { recipientIds, kind, actorName, cardId, projectId, preview, link } = await readJson(req);
  // 자기 자신에게는 보내지 않는다(앱 안 알림도 같은 규칙 — cloudSync가 먼저 걸러내지만
  // 여기서도 막아 둔다. 알림은 종류가 늘 때마다 호출부가 늘어나는 자리다).
  // 같은 id가 여럿이면 하나로 — 상한은 **거른 뒤의** 수로 센다.
  const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : [])
    .filter(id => typeof id === 'string' && id && id !== user.id))].slice(0, MAX_RECIPIENTS);
  if (!ids.length) { res.status(200).json({ sent: 0 }); return; }

  // 예배·모임 알림(0053)은 우리 주소 한 칸(link)으로 간다 — 업무 알림은 예전 그대로.
  // 앞글자만 보면 `'/\t/evil.com'`이 지나간다 — 브라우저와 같은 파서로 풀어 우리 출처인지 본다
  // (_lib.js sameOriginPath · public/sw.js 알림 클릭도 같은 규칙 · 0071 DB CHECK).
  const safeLink = sameOriginPath(link);
  const result = await sendToProfiles(db, ids, {
    title: notifLine(kind, await actorNameOf(db, user.id, actorName)),
    body: String(preview || '').slice(0, MAX_PREVIEW),
    url: safeLink || deepLink(projectId, cardId),
    tag: cardId ? `card:${cardId}` : (safeLink ? `link:${safeLink}` : 'thedaboot'),
  });
  res.status(200).json(result);
}

// ── GET: 마감 임박 배치 ─────────────────────────────────────────────────────
// 날짜는 KST로 센다. cards.due_date는 date 컬럼(시각 없음)이고 사람은 한국 날짜로
// 생각하는데, Vercel Cron은 UTC로 돈다. 크론이 도는 23:00 UTC는 이미 다음 날
// 08:00 KST이므로, UTC 날짜를 그대로 쓰면 하루씩 어긋난 알림이 간다.
// (2026-09-21에 07:00 KST → 08:00 KST로 옮겼다 — 7시는 이르다는 사용자 판단.
//  kstDate는 now에 9시간을 더할 뿐이라 시각을 옮겨도 셈은 그대로다.)
export const kstDate = (offsetDays = 0, now = Date.now()) => new Date(
  now + 9 * 3600e3 + offsetDays * 86400e3,
).toISOString().slice(0, 10);

async function handleDueSoon(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(501).json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }); return; }
  if (!safeEqual(bearer(req), secret)) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  const db = admin();
  const today = kstDate(0);
  const tomorrow = kstDate(1);

  // 담당자는 조인이 원본이다(HANDOFF §5의 28번). cards.assignees 컬럼으로 폴백하지
  // 않는 이유: 그 이름들은 프로필과 이어지지 않은 사람이라 알림을 받을 계정 자체가 없다.
  // 보관한 프로젝트는 뺀다 — 대시보드·탭에서 이미 빠진 일로 알림이 오면 소음이다.
  const { data: cards, error } = await db
    .from('cards')
    .select('id, title, project_id, due_date, card_assignees(profile_id), projects!inner(archived)')
    .in('due_date', [today, tomorrow])
    .neq('status', 'done')
    .eq('projects.archived', false);
  if (error) { console.error('[push] 마감 임박 조회 실패:', error); res.status(502).json({ error: 'DB 조회 실패' }); return; }

  const wanted = [];
  for (const c of cards || []) {
    const when = c.due_date === today ? '오늘 마감' : '내일 마감';
    for (const a of c.card_assignees || []) {
      if (a.profile_id) wanted.push({ cardId: c.id, projectId: c.project_id, recipientId: a.profile_id, preview: `${c.title} · ${when}` });
    }
  }
  if (!wanted.length) { res.status(200).json({ cards: 0, notified: 0, sent: 0 }); return; }

  // 같은 날 두 번 알리지 않는다. 하루 한 번 도는 작업이지만 손으로 부를 수도 있고,
  // 재시도가 겹칠 수도 있다. 최근 20시간 안에 같은 (사람, 카드)로 만든 due_soon이
  // 있으면 건너뛴다 — 유니크 제약을 걸 수 없어서(created_at::date는 immutable이 아니다)
  // 넣기 전에 읽어서 거른다.
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const { data: recent, error: recentErr } = await db
    .from('notifications')
    .select('recipient_id, card_id')
    .eq('kind', 'due_soon')
    .gte('created_at', since)
    .in('card_id', [...new Set(wanted.map(w => w.cardId))]);
  if (recentErr) { console.error('[push] 최근 알림 조회 실패:', recentErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  const already = new Set((recent || []).map(r => `${r.recipient_id}|${r.card_id}`));

  const fresh = wanted.filter(w => !already.has(`${w.recipientId}|${w.cardId}`));
  if (!fresh.length) { res.status(200).json({ cards: cards.length, notified: 0, sent: 0, skipped: wanted.length }); return; }

  const { error: insErr } = await db.from('notifications').insert(fresh.map(w => ({
    recipient_id: w.recipientId,
    actor_name: '더다붓',
    kind: 'due_soon',
    card_id: w.cardId,
    project_id: w.projectId,
    preview: w.preview,
  })));
  if (insErr) { console.error('[push] due_soon 생성 실패:', insErr); res.status(502).json({ error: '알림 생성 실패' }); return; }

  // 푸시는 카드별로 보낸다(제목이 카드마다 다르므로 한 번에 묶을 수 없다). 하지만
  // **구독·안 읽은 수는 한 번만 읽는다** — 알림마다 다시 물으면 왕복이 알림 수의 두 배가
  // 된다(N+1). 안 읽은 수는 위 insert가 끝난 뒤의 값이라 루프 도중에 바뀌지 않는다.
  let sent = 0;
  if (pushReady()) {
    const targets = await loadTargets(db, fresh.map(w => w.recipientId));
    const dead = [];
    for (const w of fresh) {
      sent += await pushWith(targets, [w.recipientId], {
        title: notifLine('due_soon'),
        body: w.preview,
        url: deepLink(w.projectId, w.cardId),
        tag: `card:${w.cardId}`,
      }, dead);
    }
    await dropDead(db, dead);
  }
  res.status(200).json({ cards: cards.length, notified: fresh.length, sent, skipped: wanted.length - fresh.length });
}

// ── GET ?job=worship의 두 번째 갈래: 동아리 모임 전날 (0078) ─────────────────
// 모임 날짜가 **내일(KST)**인 동아리 모임이 있으면 그 동아리 구성원에게 앱 안 알림 + 푸시 한 통.
// 당일 알림은 없다(사용자 결정 2026-09-25).
//
// 왜 11:30 배치에 얹었나: 크론 자리는 둘뿐이고(08:00 마감 임박 · 11:30 예배 당일) 전날 저녁이
// 가장 좋지만 없다. 08:00은 이르고(7시를 8시로 옮긴 이유 그대로) 그 뒤에 임베딩이 60초 예산을
// 나눠 쓴다. 11:30은 둘 중 늦은 시각이고, 같은 결(예배·모임 · 링크 축 중복 방지)의 시스템 알림 배치다.
//
// 받는 사람: 그 동아리의 group_members + 동아리장(앱의 meeting_new가 쓰는 groupPeople과 같은 집합)
// 중 명단에서 환송되지 않았고 계정이 이어진 사람 → 승인·미환송 프로필. 합친 계정은 남긴 계정으로
// 보낸다(알림 읽기 정책이 effective_uid다). **모임을 만든 사람도 받는다** — 보내는 사람이 없는 알림이다.
// 한 동아리에 내일 모임이 둘이면 한 통(열쇠가 동아리 링크다).
//
// 문구는 notifyText meeting_tomorrow(`내일 {동아리 이름} 모임이 있어요`) — 동아리 이름은 actor_name
// 칸에 싣는다. preview는 모임 제목(없으면 비운다 — '내일'이 이미 날짜다). 링크는 앱의 동아리 알림과
// 같은 `/?p=groups&g=<동아리>`(services/groups.js clubLink — 브라우저 모듈이라 import하지 않는다).
export const clubLink = (groupId) => (groupId ? `/?p=groups&g=${groupId}` : '/?p=groups');

// 순수 — 질의 결과를 받아 넣을 알림을 고른다(tests/push.mjs가 직접 부른다).
//   meetings  group_meetings + groups(id, name, type, removed_at, leader_person_id, group_members(person_id))
//   accounts  Map(person_id → 받을 profile id) — 환송·미승인·계정 없는 사람은 이미 빠져 있다
//   recent    최근 20시간의 meeting_tomorrow 알림 [{ recipient_id, link }]
export function meetingEveRows(meetings = [], accounts = new Map(), recent = []) {
  const seen = new Set((recent || []).map(r => `${r.recipient_id}|${r.link}`));
  const out = [];
  for (const m of meetings || []) {
    const g = m.groups;
    if (!g || g.type !== 'club' || g.removed_at) continue;
    const link = clubLink(g.id || m.group_id);
    const persons = [g.leader_person_id, ...(g.group_members || []).map(x => x.person_id)];
    for (const pid of persons) {
      const to = pid && accounts.get(pid);
      if (!to || seen.has(`${to}|${link}`)) continue;
      seen.add(`${to}|${link}`);
      out.push({
        recipientId: to,
        link,
        club: String(g.name || '').trim().slice(0, 100),
        preview: String(m.title || '').trim().slice(0, MAX_PREVIEW) || null,
      });
    }
  }
  return out;
}

async function handleMeetingEve(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(501).json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }); return; }
  if (!safeEqual(bearer(req), secret)) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  const db = admin();
  const tomorrow = kstDate(1);

  const { data: meetings, error } = await db
    .from('group_meetings')
    .select('id, group_id, title, meeting_date, groups!inner(id, name, type, removed_at, leader_person_id, group_members(person_id))')
    .eq('meeting_date', tomorrow).eq('groups.type', 'club').is('groups.removed_at', null);
  if (error) { console.error('[push] 내일 동아리 모임 조회 실패:', error); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  if (!meetings?.length) { res.status(200).json({ meetings: 0, notified: 0, sent: 0 }); return; }

  // 명단 → 계정. 계정이 없는 사람(profile_id null)은 받을 자리가 없다.
  const personIds = [...new Set(meetings.flatMap(m => [m.groups?.leader_person_id, ...(m.groups?.group_members || []).map(x => x.person_id)]).filter(Boolean))];
  const { data: people, error: pErr } = await db
    .from('people').select('id, profile_id').in('id', personIds).is('removed_at', null).not('profile_id', 'is', null);
  if (pErr) { console.error('[push] 동아리 구성원 조회 실패:', pErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  const { data: profs, error: prErr } = await db
    .from('profiles').select('id, merged_into').in('id', [...new Set((people || []).map(p => p.profile_id))])
    .eq('approved', true).is('removed_at', null);
  if (prErr) { console.error('[push] 구성원 계정 조회 실패:', prErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  const keep = new Map((profs || []).map(p => [p.id, p.merged_into || p.id]));
  const accounts = new Map();
  for (const p of people || []) if (keep.has(p.profile_id)) accounts.set(p.id, keep.get(p.profile_id));

  // 같은 날 두 번 알리지 않는다 — worship_today와 같은 방식(넣기 전에 읽어서 거른다 · 열쇠는 받는 사람+링크)
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const links = [...new Set(meetings.map(m => clubLink(m.groups?.id || m.group_id)))];
  const { data: recent, error: recentErr } = await db
    .from('notifications').select('recipient_id, link')
    .eq('kind', 'meeting_tomorrow').gte('created_at', since).in('link', links);
  if (recentErr) { console.error('[push] 최근 알림 조회 실패:', recentErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }

  const wanted = meetingEveRows(meetings, accounts, recent);
  if (!wanted.length) { res.status(200).json({ meetings: meetings.length, notified: 0, sent: 0 }); return; }

  const { error: insErr } = await db.from('notifications').insert(wanted.map(w => ({
    recipient_id: w.recipientId,
    actor_name: w.club || '더다붓',
    kind: 'meeting_tomorrow',
    preview: w.preview,
    link: w.link,
  })));
  if (insErr) { console.error('[push] meeting_tomorrow 생성 실패:', insErr); res.status(502).json({ error: '알림 생성 실패' }); return; }

  // 구독·안 읽은 수는 루프 밖에서 한 번만(N+1 없음) · 동아리 단위로 보낸다(문구가 동아리마다 다르다)
  let sent = 0;
  if (pushReady()) {
    const targets = await loadTargets(db, wanted.map(w => w.recipientId));
    const dead = [];
    for (const link of new Set(wanted.map(w => w.link))) {
      const group = wanted.filter(w => w.link === link);
      sent += await pushWith(targets, group.map(w => w.recipientId), {
        title: notifLine('meeting_tomorrow', group[0].club),
        body: group[0].preview || '',
        url: link,
        tag: `link:${link}`,
      }, dead);
    }
    await dropDead(db, dead);
  }
  res.status(200).json({ meetings: meetings.length, notified: wanted.length, sent });
}

// ── GET ?job=worship: 예배 당일 배치 (0053) ────────────────────────────────
// 오늘(KST) 날짜의 **발행된** 주보를 찾아 승인 멤버 전원에게 알린다. 크론은 11:30 KST
// (`30 2 * * *` UTC)에 돌아 예배(13:30) 두 시간 전이다.
//
// 왜 서버가 만드나: 받는 사람이 전원이고 보내는 사람이 없다(actor 없는 시스템 알림 —
// notifyText의 SYSTEM_TEXT). 그래서 0053의 INSERT 정책에도 worship_today가 없다.
//
// **kindLabel을 import하지 않는다** — services/worship.js는 브라우저 모듈이라(supabase
// 클라이언트를 물고 온다) 서버리스에서 부르면 통째로 딸려 온다. 이름 하나를 위해 그럴
// 이유가 없어 여기서 한 줄로 가른다(notifyText.js는 순수 모듈이라 그대로 import한다).
const SUNDAY_LABEL = '주일 4부 젊은이 예배';
const serviceLabel = (kind) => (kind === 'sunday' ? SUNDAY_LABEL : (kind || '예배'));

async function handleWorshipToday(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(501).json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }); return; }
  if (!safeEqual(bearer(req), secret)) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  const db = admin();
  const today = kstDate(0);

  const { data: services, error } = await db
    .from('services').select('id, kind, title, service_date')
    .eq('service_date', today).eq('status', 'published');
  if (error) { console.error('[push] 오늘 주보 조회 실패:', error); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  if (!services?.length) { res.status(200).json({ services: 0, notified: 0, sent: 0 }); return; }

  const { data: members, error: memErr } = await db
    .from('profiles').select('id').eq('approved', true).is('removed_at', null);
  if (memErr) { console.error('[push] 승인 멤버 조회 실패:', memErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  const ids = (members || []).map(m => m.id).filter(Boolean);
  if (!ids.length) { res.status(200).json({ services: services.length, notified: 0, sent: 0 }); return; }

  // 같은 날 두 번 알리지 않는다 — due_soon과 같은 방식이다(유니크 제약을 걸 수 없어서
  // 넣기 전에 읽어서 거른다). 열쇠는 (받는 사람, link)다: 카드 축이 아니라 주보 축이라
  // card_id가 비어 있고, link가 그 주보를 가리키는 유일한 값이다.
  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const links = services.map(s => `/?p=worship&s=${s.id}`);
  const { data: recent, error: recentErr } = await db
    .from('notifications').select('recipient_id, link')
    .eq('kind', 'worship_today').gte('created_at', since).in('link', links);
  if (recentErr) { console.error('[push] 최근 알림 조회 실패:', recentErr); res.status(502).json({ error: 'DB 조회 실패' }); return; }
  const already = new Set((recent || []).map(r => `${r.recipient_id}|${r.link}`));

  const wanted = [];
  for (const s of services) {
    const link = `/?p=worship&s=${s.id}`;
    const preview = `${serviceLabel(s.kind)}${s.title ? ` · ${s.title}` : ''}`;
    for (const id of ids) {
      if (!already.has(`${id}|${link}`)) wanted.push({ recipientId: id, link, preview });
    }
  }
  if (!wanted.length) { res.status(200).json({ services: services.length, notified: 0, sent: 0, skipped: services.length * ids.length }); return; }

  const { error: insErr } = await db.from('notifications').insert(wanted.map(w => ({
    recipient_id: w.recipientId,
    actor_name: '더다붓',
    kind: 'worship_today',
    preview: w.preview,
    link: w.link,
  })));
  if (insErr) { console.error('[push] worship_today 생성 실패:', insErr); res.status(502).json({ error: '알림 생성 실패' }); return; }

  // 푸시도 마감 배치와 같은 모양이다 — **구독·안 읽은 수는 루프 밖에서 한 번만** 읽는다.
  // 여기서는 주보마다 문구가 달라 주보 단위로 보낸다(대개 한 건이다).
  let sent = 0;
  if (pushReady()) {
    const targets = await loadTargets(db, wanted.map(w => w.recipientId));
    const dead = [];
    for (const s of services) {
      const link = `/?p=worship&s=${s.id}`;
      const group = wanted.filter(w => w.link === link);
      if (!group.length) continue;
      sent += await pushWith(targets, group.map(w => w.recipientId), {
        title: notifLine('worship_today'),
        body: group[0].preview,
        url: link,
        tag: `link:${link}`,
      }, dead);
    }
    await dropDead(db, dead);
  }
  res.status(200).json({ services: services.length, notified: wanted.length, sent });
}

// ── 8시 크론에 얹은 문서 임베딩 (배치 E4 · 0074 doc_vec · api/_docsync.js) ─────────
// 크론 자리가 둘뿐이라(Vercel Hobby · 이미 둘) 새 크론을 못 판다 — 마감 임박 배치 **뒤에** 얹는다.
// 규칙 셋:
//   ① 알림이 먼저다. handleDueSoon이 다 끝난 뒤에야 임베딩을 시작한다.
//   ② 임베딩이 무엇으로 실패해도 알림 응답은 그대로 나간다(runEmbedSync는 던지지 않는다).
//   ③ 함수 시간 제한(vercel.json의 maxDuration 60초) 안에서 응답한다 — 예산은 남은 시간에서
//      여유를 뺀 만큼이고, 그 안에 안 끝나면 기다리지 않고 응답한다(못 한 조각은 다음 날 잇는다).
// 응답을 먼저 보내고 뒤에서 돌리지 않는 이유: Vercel 함수는 응답이 끝나면 멈출 수 있다(waitUntil이
// 필요하다). 크론은 응답 시각을 따지지 않으므로 알림을 다 보낸 뒤 임베딩까지 하고 한 번에 응답한다.
export const PUSH_MAX_MS = 60 * 1000;      // vercel.json functions["api/push.js"].maxDuration과 같아야 한다
export const EMBED_BUDGET_MS = 40 * 1000;  // 하루치 증분은 대개 요청 한 번(수 초)이다
const EMBED_MARGIN_MS = 8 * 1000;          // 응답을 쓰고 로그를 남길 여유

// 부른 뒤 남은 시간으로 예산을 정한다(알림 배치가 쓴 시간을 뺀다)
export const embedBudget = (started, now = Date.now()) =>
  Math.min(EMBED_BUDGET_MS, PUSH_MAX_MS - EMBED_MARGIN_MS - (now - started));

// 임베딩 증분 — **던지지 않는다**. 예산을 넘기면 기다리지 않고 멈춘 채로 요약을 돌려준다.
export async function runEmbedSync(budgetMs) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return { skipped: 'GEMINI_API_KEY 없음' };
  if (!(budgetMs >= 5000)) return { skipped: '시간 없음' };
  let timer;
  try {
    const work = syncDocVectors(admin(), { geminiKey, budgetMs, log: (m) => console.log(m) });
    // 동기화 안의 DB 왕복에는 시간 상한이 없다 — 예산 + 5초를 넘기면 결과를 기다리지 않는다
    const cap = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), budgetMs + 5000); });
    const s = await Promise.race([work, cap]);
    if (s.timeout) { console.error('[push] 문서 임베딩이 시간 안에 안 끝났다'); work.catch(e => console.error('[push] 문서 임베딩 실패(늦게):', e)); return { error: '시간 초과' }; }
    const out = { docs: s.docs, embedded: s.embedded, dropped: s.dropped, moved: s.moved, remaining: s.remaining, ms: s.ms };
    if (s.stopped) out.stopped = s.stopped;
    console.log('[push] 문서 임베딩:', JSON.stringify(out));
    return out;
  } catch (e) {
    console.error('[push] 문서 임베딩 실패:', e);
    return { error: '실패' };
  } finally {
    clearTimeout(timer);
  }
}

// 응답을 잡아 두는 자리 — handleDueSoon은 그대로 두고(여러 갈래에서 res에 곧장 쓴다) 그 결과만 받는다
function heldResponse() {
  const h = { code: 200, body: null };
  h.status = (c) => { h.code = c; return h; };
  h.json = (b) => { h.body = b; return h; };
  return h;
}

// GET(job 없음) — 마감 임박 알림 → 문서 임베딩 → 한 번에 응답
async function handleDueSoonThenEmbed(req, res, started) {
  const held = heldResponse();
  await handleDueSoon(req, held);
  // 크론 비밀이 틀리거나 없으면 거기서 끝이다(임베딩도 같은 비밀 뒤에 있다)
  if (held.code === 401 || held.code === 501) { res.status(held.code).json(held.body); return; }
  const embed = await runEmbedSync(embedBudget(started));
  res.status(held.code).json({ ...(held.body || {}), embed });
}

// GET ?job=worship(11:30 크론) — 예배 당일 → 동아리 모임 전날. 한쪽이 DB 오류로 죽어도 다른 쪽은 돈다.
async function handleWorshipThenMeetings(req, res) {
  const w = heldResponse();
  await handleWorshipToday(req, w);
  if (w.code === 401 || w.code === 501) { res.status(w.code).json(w.body); return; }
  const m = heldResponse();
  await handleMeetingEve(req, m);
  res.status(w.code !== 200 ? w.code : m.code).json({ ...(w.body || {}), meeting: m.body });
}

// GET ?job=embed — 손으로 부르는 길(같은 CRON_SECRET). 알림은 건드리지 않는다.
async function handleEmbedJob(req, res, started) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(501).json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }); return; }
  if (!safeEqual(bearer(req), secret)) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }
  if (!process.env.GEMINI_API_KEY) { res.status(501).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }); return; }
  const embed = await runEmbedSync(embedBudget(started));
  res.status(embed.error ? 502 : 200).json({ embed });
}

export default async function handler(req, res) {
  const started = Date.now();
  try {
    if (req.method === 'POST') return await handleSend(req, res);
    // 크론이 부르는 배치. vercel.json이 `/api/push?job=worship`으로 넘긴다.
    if (req.method === 'GET') {
      if (req.query?.job === 'worship') return await handleWorshipThenMeetings(req, res);
      if (req.query?.job === 'embed') return await handleEmbedJob(req, res, started);
      return await handleDueSoonThenEmbed(req, res, started);
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[push] 처리 실패:', e);
    res.status(500).json({ error: '푸시 처리 실패' });
  }
}
