import { useSyncExternalStore, useEffect } from 'react';
import { isCloudEnabled, myUid } from './supabaseClient.js';
import { client, unwrap } from './cloud/core.js';
import { requestPush } from './cloud/notify.js';
import { ROLE_LABEL } from './roster.js';
import { auditText } from './opsCore.js';
import * as demo from './opsDemo.js';

// ============================================================================
// 관리자 메뉴 · 피드백 전송의 읽기·쓰기(v5 2묶음 · 0113) — 화면은 components/opsDesk.jsx · components/feedbackSend.jsx
// ----------------------------------------------------------------------------
// 겉은 하나, 안은 둘(tabOrder.js와 같은 짜임):
//   · 클라우드 — 0113 표(feedback · client_errors · ai_timings · admin_audit · storage 'feedback'). 읽기는 RLS가 **마스터만** 준다
//     (피드백은 본인 행도 — 이 화면은 마스터만 연다). 상태 바꾸기는 set_feedback_status(마스터) — 처음 '해결'이면 DB 함수가 보낸 사람
//     알림 행을 넣고 그 사람 id를 돌려주며, 여기서 그 id로 푸시를 부탁한다(lock_reset과 같은 길 · 받는 사람이 끈 종류인지는
//     api/push.js가 보지만 feedback_fixed는 표 밖이라 언제나 간다).
//   · 게스트 — services/opsDemo.js(브라우저 시연 자리 · 씨앗).
// 읽기 칸(remote)은 '없음'과 '못 읽음'을 가른다(§8 D2 · PITFALLS 24-g): 캐시 없는 첫 읽기가 실패하면 state 'fail'(화면이 실패 자리를
// 세운다) · 캐시가 있으면 지난 값을 둔 채 error만(화면이 토스트). 창을 열 때마다 다시 읽는다(실시간 구독은 없다 — 마스터 한 사람의 창).
// 화면 사진은 비공개 버킷이라 서명 주소(1시간)로 그린다 · 이름은 profiles 조인(display_name · 없으면 '이름 미상').
// ============================================================================

const cloud = isCloudEnabled();
const DAY = 86400000;

function remote(fetcher) {
  let snap = { state: 'idle', data: undefined, error: null };
  const subs = new Set();
  const put = (next) => { snap = { ...snap, ...next }; subs.forEach(f => f()); };
  let seq = 0;
  async function load() {
    const my = ++seq;
    put({ state: snap.data === undefined ? 'loading' : 'ready', error: null });
    try {
      const data = await fetcher();
      if (my === seq) put({ state: 'ready', data, error: null });
    } catch (e) {
      console.error('[ops] 읽기 실패:', e?.message || e);
      if (my === seq) put({ state: snap.data === undefined ? 'fail' : 'ready', error: e });
    }
  }
  const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
  const getSnap = () => snap;
  function use() {
    const s = useSyncExternalStore(subscribe, getSnap, getSnap);
    useEffect(() => { load(); }, []);
    return { ...s, reload: load };
  }
  const edit = (fn) => put({ data: fn(snap.data) });
  return { use, edit, get: getSnap };
}

// 게스트 — 늘 'ready'
const ready = (data) => ({ state: 'ready', data, error: null, reload: () => {} });

// ── 피드백 ───────────────────────────────────────────────────────────────
const EXT_MIME = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const shotMime = (pathOrUrl) => {
  const s = String(pathOrUrl || '');
  const m = /^data:([^;,]+)/.exec(s);
  if (m) return m[1];
  return EXT_MIME[(/\.(\w+)(?:\?|$)/.exec(s.split('?')[0]) || [])[1]?.toLowerCase()] || 'image/jpeg';
};

async function fetchFeedback() {
  const rows = unwrap(await client().from('feedback')
    .select('id, sender_id, body, shot_path, route, ua, viewport, build, status, created_at, status_at, notified_at, sender:profiles!feedback_sender_id_fkey(display_name)')
    .order('created_at', { ascending: false }).limit(300));
  const paths = rows.map(r => r.shot_path).filter(Boolean);
  const urls = new Map();
  if (paths.length) {
    // 서명 주소를 못 받으면 사진만 빠진다(목록은 선다 · 원문은 콘솔)
    const { data, error } = await client().storage.from('feedback').createSignedUrls(paths, 3600);
    if (error) console.warn('[ops] 화면 사진 주소를 받지 못했어요:', error.message || error);
    for (const d of data || []) if (d?.signedUrl && d.path) urls.set(d.path, d.signedUrl);
  }
  return rows.map(r => ({
    id: r.id, at: r.created_at, user: r.sender?.display_name || '이름 미상', userId: r.sender_id,
    status: r.status, statusAt: r.status_at, notified: !!r.notified_at,
    route: r.route, ua: r.ua, size: r.viewport, build: r.build, text: r.body,
    shot: (r.shot_path && urls.get(r.shot_path)) || null,
  }));
}
const feedbackCell = cloud ? remote(fetchFeedback) : null;
export const useFeedbackList = cloud ? feedbackCell.use : () => ready(demo.useFeedback());

// 상태 바꾸기 → { notified: 이번에 알림을 보냈나, user } · 실패하면 던진다(화면 값은 되돌린다)
export async function changeFeedbackStatus(f, status, me) {
  if (!cloud) {
    const r = demo.setFeedbackStatus(f.id, status, me);
    return { notified: !!r?.notifiedNow, user: f.user };
  }
  const before = f;
  const at = new Date().toISOString();
  feedbackCell.edit(list => (list || []).map(x => (x.id === f.id ? { ...x, status, statusAt: at } : x)));
  try {
    const to = unwrap(await client().rpc('set_feedback_status', { f: f.id, s: status }));
    if (to) {
      feedbackCell.edit(list => (list || []).map(x => (x.id === f.id ? { ...x, notified: true } : x)));
      void requestPush([to], { kind: 'feedback_fixed', preview: String(f.text || '').slice(0, 80) });
    }
    return { notified: !!to, user: f.user };
  } catch (e) {
    feedbackCell.edit(list => (list || []).map(x => (x.id === f.id ? before : x)));
    throw e;
  }
}

// data URL → Blob(fetch(data:)는 CSP connect-src에 data:가 없어 막힌다)
function dataUrlBlob(url) {
  const [head, b64] = String(url).split(',');
  const mime = (/^data:([^;,]+)/.exec(head) || [])[1] || 'image/jpeg';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// 피드백 보내기 — 사진을 못 올리면 사진 없이 보낸다(글이 먼저다 · 원문은 콘솔). 행을 못 넣으면 던진다.
export async function sendFeedback({ text, shot, route, ua, size, build, screenName, user }) {
  if (!cloud) { demo.addFeedback({ user, text, shot: shot || null, route, ua, size, build, screenName }); return; }
  const uid = await myUid();
  if (!uid) throw new Error('로그인이 필요합니다.');
  let shotPath = null;
  if (shot) {
    try {
      const blob = dataUrlBlob(shot);
      const path = `${uid}/${crypto.randomUUID()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      const { error } = await client().storage.from('feedback').upload(path, blob, { contentType: blob.type, upsert: false });
      if (error) throw error;
      shotPath = path;
    } catch (e) {
      console.warn('[feedback] 화면 사진을 올리지 못했어요 — 사진 없이 보낸다:', e?.message || e);
    }
  }
  unwrap(await client().from('feedback').insert({
    body: text, shot_path: shotPath, route: String(route || '').slice(0, 300), ua: String(ua || '').slice(0, 300),
    viewport: String(size || '').slice(0, 20), build: String(build || '').slice(0, 40),
  }));
}

// ── 앱 내 오류(client_errors 한 줄 = 지문·사람·빌드·화면·기기·날짜 · count) ────────
async function fetchErrors() {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const rows = unwrap(await client().from('client_errors')
    .select('id, fingerprint, message, top_frame, stack, route, ua, build, profile_id, count, last_seen')
    .gte('last_seen', since).order('last_seen', { ascending: false }).limit(2000));
  return rows.map(r => ({ id: r.id, at: r.last_seen, fp: r.fingerprint, message: r.message, stack: r.stack || r.top_frame || '',
    route: r.route, ua: r.ua, build: r.build, user: r.profile_id, n: r.count }));
}
const errorCell = cloud ? remote(fetchErrors) : null;
export const useErrorList = cloud ? errorCell.use : () => ready(demo.useErrorEvents());

// ── 다붓이 답변 속도(ai_timings · 묻는 사람 칸 없음) ────────────────────────
async function fetchSpeed() {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const rows = unwrap(await client().from('ai_timings')
    .select('at, question, gather_ms, answer_ms, total_ms, cached')
    .gte('at', since).order('at', { ascending: false }).limit(5000));
  return rows.map(r => ({ at: r.at, q: r.question, findMs: r.gather_ms, writeMs: r.answer_ms, ms: r.total_ms, cached: r.cached }));
}
const speedCell = cloud ? remote(fetchSpeed) : null;
export const useSpeedList = cloud ? speedCell.use : () => ready(demo.speedSamples());

// ── 기록 관리(admin_audit) ──────────────────────────────────────────────────
export const roleLabel = (role, team) => (role === 'team_lead' ? `${team || ''}장` : ROLE_LABEL[role] || role || '');
async function fetchAudit() {
  const rows = unwrap(await client().from('admin_audit')
    .select('id, at, actor_id, kind, action, target_label, detail, actor:profiles(display_name)')
    .order('at', { ascending: false }).limit(500));
  return rows.map(r => ({
    id: r.id, at: r.at, who: r.actor?.display_name || '이름 미상', kind: r.kind, text: auditText(r, roleLabel),
    target: r.kind === 'role' && r.detail?.year ? `${r.target_label} · ${r.detail.year}년` : r.target_label,
  }));
}
const auditCell = cloud ? remote(fetchAudit) : null;
export const useAuditList = cloud ? auditCell.use : () => ready(demo.auditRows());
export const AUDIT_KINDS = demo.AUDIT_KINDS;
