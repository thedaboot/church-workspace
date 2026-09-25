// ============================================================================
// '흔적과 움직임' 순수 규칙 한 벌 (사용자 결정 2026-09-25 · 목업 mockup-traces 3~7)
// ----------------------------------------------------------------------------
// 화면(dashboardParts·layout·groupsClub)이 쓰는 판정만 모았다 — 노드에서 logcheck가 바로 본다.
// import는 notifyText(역시 순수) 하나다.
//
//   · 최근 활동: 카드별로 묶기(groupFeed) · 업무 밖 움직임 줄(extraFeedRows) · 시간순 섞기(mixFeed)
//   · 지난 방문 이후 남이 움직인 곳(isFreshMove · freshProjectIds) — 기준 시각은 sinceSeen.js가 쥔다
//   · 동아리 모임 나누기(splitMeetings)
// ============================================================================
import { notifLine } from './notifyText.js';

const ms = (v) => (typeof v === 'number' ? v : Date.parse(v || ''));

// ── 지난 방문 이후 남이 움직였나 ─────────────────────────────────────────────
// base: { at(ms), me: Set } — 앱을 열 때 붙잡은 내 last_seen_at과 '나'로 칠 열쇠들
// (클라우드는 계정 id — 합친 계정은 두 id 모두, 게스트는 이름). 내 움직임에는 점을 찍지 않는다.
export function isFreshMove(at, actorKey, base) {
  if (!base || !Number.isFinite(base.at)) return false;
  const t = ms(at);
  if (!Number.isFinite(t) || t <= base.at) return false;
  return !!actorKey && !base.me?.has(actorKey);
}

// 탭 줄 점 — rows는 tabFront가 잰 [{ projectId, actor, at }]. 그 프로젝트를 연 뒤(opened[pid])의
// 움직임만 센다(열면 지운다). 지금 보고 있는 프로젝트(activeId)에는 찍지 않는다.
export function freshProjectIds(rows, base, opened = {}, activeId = null) {
  const out = new Set();
  if (!base) return out;
  for (const r of rows || []) {
    if (!r?.projectId || r.projectId === activeId || out.has(r.projectId)) continue;
    const since = Math.max(base.at, opened[r.projectId] || 0);
    if (isFreshMove(r.at, r.actor, { at: since, me: base.me })) out.add(r.projectId);
  }
  return out;
}

// ── 최근 활동 ────────────────────────────────────────────────────────────────
// 카드별 최근 한 줄 + 나머지 개수. 피드는 최신순이라 처음 만나는 줄이 최근 것이다.
// fresh: 그 카드 묶음 안에 **지난 방문 이후 남이 한 줄**이 하나라도 있으면 — 맨 윗줄이 내 것이어도
// 그 아래 남의 댓글이 새로 달렸으면 점이 선다.
export const feedActor = (a) => a?.actorId || a?.actorName || '';
export function groupFeed(feed, base = null) {
  const seen = new Map();
  const out = [];
  for (const a of feed || []) {
    const key = a.cardId || a.id;
    const fresh = isFreshMove(a.at, feedActor(a), base);
    const head = seen.get(key);
    if (head) { head.more += 1; if (fresh) head.fresh = true; continue; }
    const row = { ...a, more: 0, fresh };
    seen.set(key, row);
    out.push(row);
  }
  return out;
}

// 업무 밖 움직임 → 피드와 같은 모양의 줄. 문장은 알림 문구(notifyText) 그대로다 —
// 같은 일이 종에서는 이 말, 대시보드에서는 저 말로 읽히면 안 된다. 묵상 줄만 알림에 짝이 없어
// 사용자 문구(2026-09-25)를 쓴다.
//   services: [{ id, title, published_at, published_by }] — 발행된 것만 넘긴다
//   meetings: [{ id, group_id, meeting_date, title, created_at, created_by }]
//   qts:      [{ id, profile_id, qt_date, title, updated_at }] — **나눈 것(shared)만** 넘긴다
//   nameOf(id) → 표시 이름('' 이면 그 줄을 세우지 않는다 — 누가 했는지 모르는 줄은 거짓 문장이 된다)
//   groupName(id) → 동아리 이름('' 이면 세우지 않는다 — 지워진 동아리)
//   passageOf(date) → 그 날 QT 본문(없으면 '')
export const QT_SHARED_TEXT = '오늘 QT 묵상을 나눴어요';
const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1].slice(2)}. ${+m[2]}. ${+m[3]}.` : '';
};
export function extraFeedRows({ services = [], meetings = [], qts = [], nameOf = () => '', groupName = () => '', passageOf = () => '' } = {}) {
  const out = [];
  for (const s of services) {
    const who = s?.published_by ? nameOf(s.published_by) : '';
    if (!who || !s.published_at) continue;
    out.push({
      id: `svc:${s.id}`, kind: 'service', actorId: s.published_by, actorName: who,
      head: s.title || '주보', text: notifLine('service_published', who), at: s.published_at,
      link: `/?p=worship&s=${s.id}`,
    });
  }
  for (const m of meetings) {
    const who = m?.created_by ? nameOf(m.created_by) : '';
    const club = groupName(m?.group_id);
    if (!who || !club || !m.created_at) continue;
    out.push({
      id: `meet:${m.id}`, kind: 'meeting', actorId: m.created_by, actorName: who,
      // 알림(meeting_new)의 preview와 같은 모양 — '통통 · 26. 9. 27.'
      head: `${club} · ${shortDate(m.meeting_date)}`, text: notifLine('meeting_new', who), at: m.created_at,
      link: `/?p=groups&g=${m.group_id}`,
    });
  }
  for (const q of qts) {
    const who = q?.profile_id ? nameOf(q.profile_id) : '';
    if (!who || !q.updated_at) continue;
    out.push({
      id: `qt:${q.id}`, kind: 'qt', actorId: q.profile_id, actorName: who,
      head: passageOf(q.qt_date) || q.title || 'QT', text: `${who}님이 ${QT_SHARED_TEXT}`, at: q.updated_at,
      link: '/?p=word',
    });
  }
  return out;
}

// 묶은 활동 줄과 업무 밖 줄을 시간순(최근 먼저)으로. 같은 시각이면 활동이 앞(원래 순서 유지).
export function mixFeed(grouped, extras, base = null) {
  const ex = (extras || []).map(r => ({ ...r, fresh: isFreshMove(r.at, feedActor(r), base) }));
  const all = [...(grouped || []).map((r, i) => ({ r, i, k: 0 })), ...ex.map((r, i) => ({ r, i, k: 1 }))];
  all.sort((a, b) => (ms(b.r.at) || 0) - (ms(a.r.at) || 0) || a.k - b.k || a.i - b.i);
  return all.map(x => x.r);
}

// '더보기'는 그 자리에서 열 줄씩 편다(사용자 결정 2026-09-25) — 처음 다섯 줄.
export const FEED_FIRST = 5;
export const FEED_STEP = 10;

// ── 동아리 모임 ──────────────────────────────────────────────────────────────
// 다가오는 모임 = 오늘 포함 앞으로(가까운 날부터) · 지난 모임 = 어제까지(최근부터).
// today는 'YYYY-MM-DD'(KST — 모임 날짜가 한국 날짜다).
export const PAST_MEETINGS_SHOWN = 3;
export function splitMeetings(meetings, today) {
  const upcoming = [], past = [];
  for (const m of meetings || []) {
    const d = String(m?.meeting_date || '').slice(0, 10);
    if (!d) continue;
    (d >= today ? upcoming : past).push(m);
  }
  upcoming.sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)));
  past.sort((a, b) => String(b.meeting_date).localeCompare(String(a.meeting_date)));
  return { upcoming, past };
}
