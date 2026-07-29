import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { notifLine } from '../src/services/notifyText.js';

// ============================================================================
// /api/push — 웹 푸시 발송. 두 입구가 한 파일에 있다.
// ----------------------------------------------------------------------------
//   POST  앱이 알림 행을 넣은 직후 부른다(cloud.insertNotifications 안에서).
//         Authorization: Bearer <supabase access token> 으로 로그인만 확인한다.
//   GET   하루 한 번 Vercel Cron이 깨운다(vercel.json의 crons).
//         오늘·내일 마감인데 완료가 아닌 카드의 담당자에게 due_soon 알림 + 푸시.
//         Authorization: Bearer <CRON_SECRET>.
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

const admin = () => createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// VAPID 키가 없으면 **발송만** 건너뛴다. 마감 임박 배치는 앱 안 알림도 만들기 때문에,
// 키가 없다고 라우트 전체를 501로 막으면 종에도 아무것도 안 뜬다.
const pushReady = () => !!(VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT);
if (pushReady()) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const bearer = (req) => {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
};

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
async function sendToProfiles(db, profileIds, { title, body, url, tag }) {
  if (!pushReady()) return { sent: 0, dropped: 0 };
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return { sent: 0, dropped: 0 };

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('profile_id', ids);
  if (error) throw error;
  if (!subs?.length) return { sent: 0, dropped: 0 };

  const payload = JSON.stringify({ title, body, url, tag });
  const dead = [];
  let sent = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint);
      else console.error('[push] 발송 실패:', e?.statusCode, e?.body || e?.message);
    }
  }));

  if (dead.length) {
    const { error: delErr } = await db.from('push_subscriptions').delete().in('endpoint', dead);
    if (delErr) console.error('[push] 죽은 구독 정리 실패:', delErr);
  }
  return { sent, dropped: dead.length };
}

// ── POST: 앱이 만든 알림을 푸시로 한 번 더 ──────────────────────────────────
async function handleSend(req, res) {
  // POST는 푸시가 전부인 입구다. 키가 없으면 할 일이 없다 — 앱은 이 응답을 무시한다.
  if (!pushReady()) { res.status(501).json({ error: '푸시가 아직 설정되지 않았습니다 (VAPID 키 3종 필요).' }); return; }
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  const db = admin();
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) { res.status(401).json({ error: '유효하지 않은 세션입니다.' }); return; }

  const { recipientIds, kind, actorName, cardId, projectId, preview } = await readJson(req);
  // 자기 자신에게는 보내지 않는다(앱 안 알림도 같은 규칙 — cloudSync가 먼저 걸러내지만
  // 여기서도 막아 둔다. 알림은 종류가 늘 때마다 호출부가 늘어나는 자리다).
  const ids = (recipientIds || []).filter(id => id && id !== user.id);
  if (!ids.length) { res.status(200).json({ sent: 0 }); return; }

  const result = await sendToProfiles(db, ids, {
    title: notifLine(kind, actorName),
    body: preview || '',
    url: deepLink(projectId, cardId),
    tag: cardId ? `card:${cardId}` : 'thedaboot',
  });
  res.status(200).json(result);
}

// ── GET: 마감 임박 배치 ─────────────────────────────────────────────────────
// 날짜는 KST로 센다. cards.due_date는 date 컬럼(시각 없음)이고 사람은 한국 날짜로
// 생각하는데, Vercel Cron은 UTC로 돈다. 크론이 도는 22:00 UTC는 이미 다음 날
// 07:00 KST이므로, UTC 날짜를 그대로 쓰면 하루씩 어긋난 알림이 간다.
export const kstDate = (offsetDays = 0, now = Date.now()) => new Date(
  now + 9 * 3600e3 + offsetDays * 86400e3,
).toISOString().slice(0, 10);

async function handleDueSoon(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(501).json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }); return; }
  if (bearer(req) !== secret) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

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

  // 푸시는 카드별로 보낸다(제목이 카드마다 다르므로 한 번에 묶을 수 없다).
  let sent = 0;
  for (const w of fresh) {
    const r = await sendToProfiles(db, [w.recipientId], {
      title: notifLine('due_soon'),
      body: w.preview,
      url: deepLink(w.projectId, w.cardId),
      tag: `card:${w.cardId}`,
    });
    sent += r.sent;
  }
  res.status(200).json({ cards: cards.length, notified: fresh.length, sent, skipped: wanted.length - fresh.length });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') return await handleSend(req, res);
    if (req.method === 'GET') return await handleDueSoon(req, res);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[push] 처리 실패:', e);
    res.status(500).json({ error: '푸시 처리 실패' });
  }
}
