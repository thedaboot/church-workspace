// ============================================================================
// 알림 — 웹 푸시 구독 · 앱 안 알림(모든 알림의 관문 insertNotifications) · 활동 기록 · 실시간 구독
// ----------------------------------------------------------------------------
// 알림은 **남긴 계정** 앞으로 온다(myUid · 0063). 지금 접속한 사람(presence)은 services/presence.js가 맡는다.
// ============================================================================
import { myUid } from '../supabaseClient.js';
import { client, unwrap, authedPost } from './core.js';

// ── push_subscriptions (웹 푸시 구독) ───────────────────────────────────────
// 기기당 한 행. endpoint가 unique이고 upsert로 넣으므로 같은 기기가 다시 구독해도
// 깨지지 않는다(권한 재요청·키 갱신·앱 재설치 때 실제로 그렇게 된다).
// 공용 기기에서 주인이 바뀔 수 있으므로 갱신 시 profile_id도 같이 덮는다.
// `.select()`를 붙이지 않는다 — 본인 행이라 정책상 읽을 수는 있지만 돌려받을 이유가 없다.
export async function savePushSubscription(sub) {
  const uid = await myUid();                  // 알림이 가는 곳과 같은 계정이어야 한다(0063)
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { endpoint, keys } = sub || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error('구독 정보가 올바르지 않습니다.');
  unwrap(await client().from('push_subscriptions').upsert({
    profile_id: uid,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' }));
}

export async function deletePushSubscription(endpoint) {
  unwrap(await client().from('push_subscriptions').delete().eq('endpoint', endpoint));
}

// ── notifications (@멘션 알림) ──────────────────────────────────────────────
// 본인 알림 최근 N개 (읽지 않은 것 우선, 그다음 최신순)
export async function listMyNotifications(limit = 30) {
  const uid = await myUid();                  // 알림은 **남긴 계정** 앞으로 온다(0063)
  if (!uid) return [];
  return unwrap(await client()
    .from('notifications')
    .select('*')
    .eq('recipient_id', uid)
    .order('read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit));
}

// 멘션 알림 일괄 생성 (recipientIds는 auth.users.id 배열)
// kind: 'mention'(멘션) | 'reply'(내 댓글에 답글) — DB check와 INSERT 정책이 이 둘만 허용
//
// **.select()를 붙이면 안 된다.** notifications의 SELECT 정책은 본인 수신 행만
// (recipient_id = effective_uid() · 0063) 허용하는데, 여기서 넣는 행은 '남에게 보내는' 알림이다.
// insert().select()는 SQL의 INSERT ... RETURNING이라 넣은 행을 읽으려 하고, 정책에
// 막혀 42501(new row violates row-level security policy)로 **insert까지 롤백된다.**
// 그래서 멘션 알림이 한 번도 생성되지 않았다(호출부가 실패를 조용히 삼켜 화면에도
// 아무 표시가 없었다). 넣기만 하고 돌려받지 않는다.
// link — 업무가 아닌 알림(예배·모임, 0053)이 갈 우리 주소('/?p=worship&s=…'). 업무 알림은
// card_id·project_id로 딥링크를 만들므로 비워 둔다. **본인은 여기서도 뺀다** — 호출부마다
// 거르던 규칙을 관문 한 곳에서 한 번 더(주보 발행 알림은 '승인 멤버 전원'이 받는 사람이라
// 호출부가 자기 id를 빼먹기 쉽다).
export async function insertNotifications(recipientIds, { actorName, cardId, projectId, preview, kind = 'mention', link = null }) {
  const { data: { user } } = await client().auth.getUser();
  const me = user?.id || null;
  const ids = [...new Set((recipientIds || []).filter(id => id && id !== me))];
  if (!ids.length) return 0;
  const rows = ids.map(recipient_id => ({
    recipient_id,
    actor_name: actorName || '누군가',
    kind,
    card_id: cardId || null,
    project_id: projectId || null,
    preview: (preview || '').slice(0, 200) || null,
    link: link || null,
  }));
  unwrap(await client().from('notifications').insert(rows));
  // 앱 안 알림과 웹 푸시를 같은 자리에서 보낸다 — 이 함수가 모든 알림의 관문이므로
  // 여기 붙이면 종류가 늘어도 푸시가 따라온다. 갈라 두면 한쪽만 도는 경로가 생긴다.
  // 기다리지 않는다: 발송이 늦어도 저장 흐름을 붙잡지 않아야 하고, 실패는 삼킨다
  // (앱 안 알림은 이미 들어갔다).
  void requestPush(ids, { actorName, cardId, projectId, preview, kind, link });
  return rows.length;
}

// /api/push에 발송을 부탁한다. VAPID 개인키는 서버에만 있으므로 브라우저가 직접
// 보낼 수는 없다. 배포 전(라우트 없음)·미설정(501)에서도 조용히 지나간다.
async function requestPush(recipientIds, payload) {
  try {
    // 토큰이 없으면 보내지 않고 조용히 지나간다(게스트는 client()가 던져 아래에서 삼킨다)
    await authedPost('/api/push', { recipientIds, ...payload }, { noToken: () => null });
  } catch (e) {
    console.warn('[push] 발송 요청 실패:', e);
  }
}

export async function markNotificationRead(id) {
  return unwrap(await client().from('notifications').update({ read: true }).eq('id', id).select().maybeSingle());
}

// 알림 1건 지우기. 0005의 delete 정책이 본인 수신 행만 허용하므로 남의 알림은 못 지운다.
export async function deleteNotification(id) {
  unwrap(await client().from('notifications').delete().eq('id', id));
}

export async function markAllNotificationsRead() {
  const uid = await myUid();
  if (!uid) return;
  unwrap(await client().from('notifications').update({ read: true }).eq('recipient_id', uid).eq('read', false));
}

// 본인 수신 알림 INSERT만 구독
export function subscribeMyNotifications(userId, onInsert) {
  const c = client();
  const topic = `notifications:${userId}`;
  // supabase-js는 같은 topic으로 channel()을 부르면 기존 인스턴스를 그대로 돌려준다.
  // 그 채널이 이미 subscribe()된 상태면 .on('postgres_changes')가 예외를 던지고
  // (cannot add callbacks after subscribe) 그게 ErrorBoundary까지 올라가 화면이 깨졌다.
  // 남아 있던 같은 topic 채널을 먼저 걷어내고 새로 만든다.
  c.getChannels()
    .filter(ch => ch.topic === topic || ch.topic === `realtime:${topic}`)
    .forEach(ch => c.removeChannel(ch));
  const channel = c.channel(topic)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      payload => onInsert(payload.new))
    .subscribe();
  return () => c.removeChannel(channel);
}

// ── activity ─────────────────────────────────────────────────────────────────
// 카드 1건의 활동 기록 — 활동은 업무 창 안에서만 보이므로 창을 열 때 그 카드 것만 읽는다.
// (예전에는 워크스페이스 전체 활동을 초기 로드와 매 재조회마다 읽었다. 활동은 쌓이기만
//  하는 테이블이라 오래 쓰면 카드보다 훨씬 커진다.)
export async function listCardActivity(cardId) {
  return unwrap(await client().from('activity').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
}
export async function insertActivity(row) {
  // row: { id?, project_id?, card_id?, action, payload? }
  // 같은 id가 이미 있으면 조용히 넘어간다. 활동은 덧붙이기만 하는 기록이고 id는
  // 클라이언트가 만든다 — 같은 기록을 두 번 보내는 것은 '이미 적혔다'는 뜻이지
  // 저장을 실패시킬 일이 아니다. 예전에는 여기서 activity_pkey 중복이 나면
  // 업무 저장 전체가 "저장에 실패했어요"로 보였다(카드 자체는 이미 저장된 뒤인데도).
  unwrap(await client().from('activity').upsert(row, { onConflict: 'id', ignoreDuplicates: true }));
}

// ── 실시간 구독 ────────────────────────────────────────────────────────────
// 워크스페이스 전역 구독. onChange는 payload를 그대로 받는다 —
// 표(payload.table)에 따라 "그 카드만 다시 읽기 / 전체 재조회"로 갈라진다
// (cloudSync.subscribeWorkspace).
// 지금 접속해 있는 사람(presence)은 services/presence.js가 채널을 직접 소유한다 —
// "지금 보고 있는 곳"을 track으로 다시 실어야 해서 채널 인스턴스가 필요하기 때문이다.

// 최근 활동 — 대시보드 피드용. 표시는 이름·카드 제목으로 하므로 여기서는 행만 가져온다
// (이름은 profileIdToName, 제목은 스토어의 tasks가 이미 안다 — 조인이 필요 없다).
export async function listRecentActivity(limit = 30) {
  return unwrap(await client().from('activity')
    .select('id, actor_id, action, card_id, project_id, created_at')
    .order('created_at', { ascending: false }).limit(limit));
}

// 탭 줄 앞 칸(services/tabRank.js)이 보는 줄 — 최근 며칠 동안 프로젝트에 남은 활동의 주인과 시각.
// 앱을 열 때와 다시 보일 때만 부른다(tabFront.js). 1000줄에서 자른다(PostgREST 상한) —
// 넘치면 가장 오래된 날의 줄이 빠질 뿐이고, 최근 순이라 앞 칸 판정에는 거의 영향이 없다.
export async function listProjectActivitySince(sinceIso) {
  return unwrap(await client().from('activity')
    .select('project_id, actor_id, created_at')
    .gte('created_at', sinceIso)
    .not('project_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1000));
}

// onStatus: 채널 상태('SUBSCRIBED'·'CHANNEL_ERROR'·'TIMED_OUT'·'CLOSED') — 다시 붙었을 때
// 따라잡기 읽기를 하려고 받는다(cloudSync.subscribeWorkspace · realtimeStatus.js).
export function subscribeAll(onChange, onStatus) {
  const c = client();
  const channel = c.channel('workspace-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onChange)
    // 댓글 반응(0032). comments와 같은 결 — 열려 있는 업무 창일 때만 상세를 다시 읽는다.
    // 라우팅은 cloudSync.subscribeWorkspace에 같이 적었다(§6-21 — 안 적으면 전체 재조회다)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_reactions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_links' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, onChange)
    // 새로 가입한 사람·이름 수정. 이걸 안 들으면 그 전에 열어 둔 화면은 그 사람을 영영
    // 모르고, 활동 기록이 '알 수 없음'이 되는 것을 넘어 담당자까지 어긋난다(0018 참고)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onChange)
    // 대시보드 '최근 활동' 피드(0020). 라우팅은 전체 재조회가 아니라 피드만 다시 읽기다
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity' }, onChange)
    .subscribe((status) => onStatus?.(status));
  return () => c.removeChannel(channel);
}
