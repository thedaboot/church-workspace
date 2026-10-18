import { useSyncExternalStore } from 'react';
import { isCloudEnabled } from './supabaseClient.js';

// ============================================================================
// 관리자 메뉴 · 피드백 · 알림 — **게스트 시연의 저장 자리**(v5 2묶음 · 사용자 승인 시안 mock/b3 · 클라우드는 services/ops.js · 0113)
// ----------------------------------------------------------------------------
// 화면: components/opsDesk.jsx(관리자 메뉴 창) · components/feedbackSend.jsx(피드백 전송) · components/notificationBell.jsx(게스트 종).
// 규칙: services/opsCore.js · services/notifyPrefs.js(순수). 끈 알림은 두 모드 다 services/notifOff.js.
//   · 켜지는 조건(demoOn): 게스트(클라우드 키 없음) + **빌드본**(미리보기 브랜치 mock/b3는 게스트 모드로 빌드한다) — 게스트 스위트는
//     dev 서버를 돌아서 상단바·프로필 메뉴가 그대로다(헤드리스 크롬은 navigator.webdriver가 거짓이라 그것으로는 못 가른다 —
//     tests/mobbits '게스트 모드라 알림 종은 없음'이 잡았다). dev에서 보려면 localStorage `ops_demo`='1'.
//   · 시연 역할(demoRole): 'master' | 'member' — 게스트는 마스터라 회원 쪽 화면(운영 메뉴 없음)을 보려면 프로필 메뉴의
//     시연 줄로 바꾼다(localStorage `ops_demo_role`). 클라우드에서는 쓰지 않는다.
//   · 저장은 localStorage 열쇠 셋(피드백 · 화면 오류 · 알림) — 처음 열면 씨앗을 심는다(날짜는 지금 기준).
//   · 화면 오류는 씨앗 + **이 브라우저에서 실제로 난 오류**(window error · unhandledrejection)를 받는다 — 실제 앱의 수집 모양을 미리 본다.
// 실제 앱(0113): 표 넷(feedback · client_errors · ai_timings · admin_audit) + RLS(마스터만 읽기 · 본인 피드백은 넣기) · 오류는 DB 함수
//   report_client_error(services/errorReport.js) · '해결'은 set_feedback_status가 보낸 사람에게 알림 행을 넣는다 — 읽기·쓰기는 services/ops.js.
// ============================================================================

const K = { fb: 'ops_feedback_v2', err: 'ops_errors_v1', notif: 'ops_notifs_v1', role: 'ops_demo_role' };
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장소가 막힌 브라우저 — 이번 화면에서만 */ } };
const readJson = (k) => { try { return JSON.parse(lsGet(k)); } catch { return null; } };

export function demoOn() {
  if (isCloudEnabled() || typeof window === 'undefined') return false;
  return !!import.meta.env.PROD || lsGet('ops_demo') === '1';
}

// ── 작은 저장 자리 공장(값 · 구독) ──────────────────────────────────────────
function cell(key, seed) {
  let snap = null;
  const subs = new Set();
  const get = () => {
    if (snap == null) {
      // 씨앗은 처음 바꿀 때 저장된다(읽기만 한 브라우저에는 열쇠를 남기지 않는다)
      snap = readJson(key);
      if (snap == null) snap = seed();
    }
    return snap;
  };
  const set = (next) => {
    snap = typeof next === 'function' ? next(get()) : next;
    lsSet(key, JSON.stringify(snap));
    subs.forEach(f => f());
  };
  const use = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, get);
  return { get, set, use };
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();
let n = 0;
const nid = (p) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`;

// 씨앗 화면 사진 — 진짜 사진 대신 화면 모양 그림(SVG · 두 테마 같은 그림)
const mockShot = (accent = '#4f5bd5', rows = 5) => {
  const bars = Array.from({ length: rows }, (_, i) =>
    `<rect x="16" y="${92 + i * 46}" width="${(i % 3 === 0 ? 300 : 240) - i * 8}" height="30" rx="6" fill="#eef0f4"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400" viewBox="0 0 360 400"><rect width="360" height="400" fill="#f7f8fa"/><rect width="360" height="52" fill="#fff"/><rect x="16" y="18" width="90" height="16" rx="4" fill="#dfe2e8"/><circle cx="332" cy="26" r="11" fill="${accent}"/>${bars}<rect x="16" y="64" width="120" height="14" rx="4" fill="#c9cdd6"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  galaxy: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
  galaxyChrome: 'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
};

// ── 피드백 ───────────────────────────────────────────────────────────────
const seedFeedback = () => [
  { id: nid('fb'), at: ago(40 * MIN), user: '김은지', status: 'new', route: '/?p=worship', screenName: '예배', ua: UA.iphoneKakao, size: '390×844', build: 'b3·7f2c1a0',
    text: '카톡으로 들어와서 주보 PDF 저장을 누르면 아무 반응이 없어요. 사파리에서는 잘 돼요.', shot: mockShot('#4f5bd5', 6) },
  { id: nid('fb'), at: ago(5 * HOUR), user: '박지훈', status: 'new', route: '/?p=groups', screenName: '모임', ua: UA.galaxy, size: '384×832', build: 'b3·7f2c1a0',
    text: '동아리 모임 날짜를 고를 때 달력이 키보드에 반쯤 가려져요.', shot: mockShot('#2f9e6e', 4) },
  { id: nid('fb'), at: ago(1 * DAY + 3 * HOUR), user: '이수빈', status: 'checking', statusAt: ago(20 * HOUR), route: '/?p=dashboard', screenName: '업무 대시보드', ua: UA.win, size: '1536×864', build: 'b3·6d91e4b',
    text: '대시보드에서 팀별 남은 업무 숫자랑 보드에 있는 숫자가 하나 달라요. 보류 중인 업무 때문인 것 같아요.', shot: mockShot('#4f5bd5', 5) },
  { id: nid('fb'), at: ago(3 * DAY), user: '최다은', status: 'resolved', statusAt: ago(2 * DAY), notified: true, route: '/?p=word', screenName: '말씀', ua: UA.iphone, size: '393×852', build: 'b3·5a03c77',
    text: '말씀 검색 결과에서 뒤로 가면 맨 위로 올라가요.', shot: null },
  { id: nid('fb'), at: ago(6 * DAY), user: '조은혜', status: 'resolved', statusAt: ago(5 * DAY), notified: true, route: '/?p=home', screenName: '홈', ua: UA.mac, size: '1440×900', build: 'b3·5a03c77',
    text: '홈 생일 카드 이름이 길면 잘려요.', shot: mockShot('#d9822b', 3) },
];
const fb = cell(K.fb, seedFeedback);
export const useFeedback = fb.use;
export function addFeedback(row) {
  const item = { id: nid('fb'), at: new Date().toISOString(), status: 'new', ...row };
  fb.set(list => [item, ...list]);
  return item;
}
// 상태 바꾸기(new · checking · resolved) — **처음** '해결'로 갈 때만 보낸 사람에게 알림(0113 set_feedback_status와 같은 약속 ·
// 시연: 보낸 사람이 나면 내 알림 종에 들어온다). notifiedNow = 이번에 알림을 보냈나.
export function setFeedbackStatus(id, status, me) {
  let target = null;
  let notifiedNow = false;
  fb.set(list => list.map(f => {
    if (f.id !== id) return f;
    notifiedNow = status === 'resolved' && !f.notified;
    target = { ...f, status, statusAt: new Date().toISOString(), notified: f.notified || notifiedNow };
    return target;
  }));
  if (target && notifiedNow && target.user === me) {
    pushNotif({ kind: 'feedback_fixed', actor_name: null, preview: target.text.slice(0, 80), link: null });
  }
  return target && { ...target, notifiedNow };
}

// ── 화면 오류 ──────────────────────────────────────────────────────────────
const STACK = {
  pdf: 'TypeError: Cannot read properties of null (reading \'getContext\')\n    at bakeCanvas (https://church-workspace.vercel.app/assets/index-C1x9QaZp.js:412:88)\n    at async shareOrSave (https://church-workspace.vercel.app/assets/index-C1x9QaZp.js:418:12)',
  chunk: 'TypeError: Failed to fetch dynamically imported module: https://church-workspace.vercel.app/assets/groupsView-Dk2pQ8sL.js\n    at prefetchView (https://church-workspace.vercel.app/assets/index-C1x9QaZp.js:88:20)',
  date: 'RangeError: Invalid time value\n    at Date.toISOString (<anonymous>)\n    at weekOf (https://church-workspace.vercel.app/assets/calendar-Bf3sZ0aa.js:51:33)',
  ro: 'ResizeObserver loop completed with undelivered notifications.',
};
function seedErrors() {
  const out = [];
  const add = (count, { message, stack, routes, uas, builds, people, spreadH, startH = 0 }) => {
    for (let i = 0; i < count; i++) {
      out.push({
        id: nid('err'), at: ago((startH + (spreadH * i) / Math.max(1, count - 1)) * HOUR + (i % 7) * 13 * MIN),
        message: message.replace('{id}', `${(1000 + i * 37).toString(16)}aa-0000-4000-8000-00000000000${i % 10}`),
        stack, route: routes[i % routes.length], ua: uas[i % uas.length], build: builds[i % builds.length], user: people[i % people.length],
      });
    }
  };
  add(9, { message: 'Cannot read properties of null (reading \'getContext\')', stack: STACK.pdf, routes: ['/?p=worship'], uas: [UA.iphoneKakao, UA.iphoneKakao, UA.galaxy], builds: ['b3·7f2c1a0', 'b3·6d91e4b'], people: ['김은지', '임성빈', '정민경', '김은지'], spreadH: 70, startH: 0.6 });
  add(4, { message: 'Failed to fetch dynamically imported module: https://church-workspace.vercel.app/assets/groupsView-Dk2pQ8sL.js', stack: STACK.chunk, routes: ['/?p=groups', '/?p=home'], uas: [UA.galaxyChrome, UA.win], builds: ['b3·6d91e4b'], people: ['박지훈', '윤다은'], spreadH: 30, startH: 26 });
  add(2, { message: 'Invalid time value', stack: STACK.date, routes: ['/?p=schedule'], uas: [UA.mac], builds: ['b3·7f2c1a0'], people: ['이수빈'], spreadH: 2, startH: 3 });
  add(1, { message: 'Card {id} not found in store', stack: 'Error: Card not found\n    at openTask (https://church-workspace.vercel.app/assets/index-C1x9QaZp.js:301:7)', routes: ['/?p=dashboard'], uas: [UA.win], builds: ['b3·5a03c77'], people: ['조은혜'], spreadH: 0, startH: 9 * 24 });
  return out;
}
const errs = cell(K.err, seedErrors);
export const useErrorEvents = errs.use;

// 이 브라우저에서 난 오류를 받아 둔다(시연 — 실제 앱은 같은 모양으로 /api에 보낸다 · 같은 지문은 하루 상한)
let capturing = false;
export function captureErrors(build = 'dev') {
  if (capturing || !demoOn()) return;
  capturing = true;
  const put = (message, stack) => {
    if (!message || /ResizeObserver loop/.test(message)) return;   // 브라우저가 내는 무해한 소리는 받지 않는다
    errs.set(list => [{ id: nid('err'), at: new Date().toISOString(), message: String(message).slice(0, 300), stack: String(stack || '').slice(0, 2000),
      route: location.pathname + location.search, ua: navigator.userAgent, build, user: '홍길동' }, ...list].slice(0, 300));
  };
  window.addEventListener('error', (e) => put(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => put(e.reason?.message || String(e.reason), e.reason?.stack));
}

// ── 다붓이 답변 속도(씨앗만 — 사람 칸 없음) ───────────────────────────────────
const QUESTIONS = ['이번 주 예배 위원이 누구야?', '수련회 회비 얼마였지?', '지난달 미디어팀 회의에서 정한 거 알려줘', '새가족 환영 선물 업무 누가 맡았어?',
  '다음 주 순모임 가이드 나왔어?', '찬양팀 콘티 어디 있어?', '2025년 여름 수련회 장소가 어디였지?', '주보 광고에 넣을 행사 정리해줘', '대림절 예배는 언제부터야?', '동아리 지원비 신청 방법 알려줘'];
let speedSeed = null;
export function speedSamples() {
  if (speedSeed) return speedSeed;
  let r = 7;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  speedSeed = Array.from({ length: 260 }, (_, i) => {
    const slow = rnd() < 0.08;
    const cached = !slow && rnd() < 0.3;
    const findMs = cached ? 0 : Math.round(500 + rnd() * 1400 + (slow ? 2500 + rnd() * 3000 : 0));
    const writeMs = cached ? Math.round(150 + rnd() * 300) : Math.round(900 + rnd() * 1800 + (slow ? 3500 + rnd() * 5000 : 0));
    return { at: ago(rnd() * 30 * DAY + i * 1000), q: QUESTIONS[i % QUESTIONS.length], findMs, writeMs, ms: findMs + writeMs, cached };
  });
  return speedSeed;
}

// ── 관리 기록(씨앗만) ────────────────────────────────────────────────────────
export const AUDIT_KINDS = [['all', '전체'], ['lock', '잠금'], ['visibility', '보는 사람'], ['trash', '삭제·복원'], ['approve', '가입 승인'], ['role', '직분']];
let auditSeed = null;
export function auditRows() {
  if (auditSeed) return auditSeed;
  const R = (h, who, kind, text, target) => ({ id: nid('au'), at: ago(h * HOUR), who, kind, text, target });
  auditSeed = [
    R(0.3, '김은지', 'lock', '업무를 잠갔어요', '수련회 회비 정산'),
    R(2.5, '홍길동', 'visibility', "보는 사람을 '직접 선택'으로 변경했어요", '새신자 초청 주일'),
    R(6, '임성빈', 'trash', '업무를 삭제했어요', '현수막 시안 2'),
    R(7, '홍길동', 'trash', '업무를 복원했어요', '현수막 시안 2'),
    R(26, '홍길동', 'approve', '가입을 승인했어요', '윤다은'),
    R(27, '홍길동', 'role', "직분을 '찬양팀장'으로 변경했어요", '정민경'),
    R(30, '김은지', 'lock', '잠금을 풀었어요', '수련회 숙소 계약'),
    R(52, '박지훈', 'visibility', "보는 사람을 '리더만'으로 변경했어요", '2027 임원 수련회'),
    R(75, '홍길동', 'trash', '프로젝트를 삭제했어요', '2025 겨울 수련회(사본)'),
    R(98, '홍길동', 'approve', '가입을 승인했어요', '문서연'),
    R(120, '홍길동', 'role', "직분을 '순장'으로 변경했어요", '윤다은'),
    R(170, '이수빈', 'lock', '업무를 잠갔어요', '헌금 위원 명단'),
  ];
  return auditSeed;
}

// ── 게스트 알림(종 시연) · 끈 알림 ───────────────────────────────────────────
const seedNotifs = () => [
  { id: nid('nt'), kind: 'mention', actor_name: '김은지', preview: '@홍길동 포스터에 장소 넣어 주세요', created_at: ago(12 * MIN), read: false },
  { id: nid('nt'), kind: 'worship_today', actor_name: null, preview: '주일 4부 청년 예배', created_at: ago(55 * MIN), read: false },
  { id: nid('nt'), kind: 'assignee_comment', actor_name: '임성빈', preview: '시안 두 개 올려 두었어요', created_at: ago(2 * HOUR), read: false },
  { id: nid('nt'), kind: 'meeting_tomorrow', actor_name: '보드게임 동아리', preview: '10월 정기 모임', created_at: ago(5 * HOUR), read: true },
  { id: nid('nt'), kind: 'service_published', actor_name: '오세진', preview: '10월 셋째 주 주보', created_at: ago(1 * DAY), read: true },
  { id: nid('nt'), kind: 'due_soon', actor_name: null, preview: '수련회 포스터 디자인', created_at: ago(1 * DAY + 2 * HOUR), read: true },
  { id: nid('nt'), kind: 'club_apply', actor_name: '윤다은', preview: '사진 동아리', created_at: ago(2 * DAY), read: true },
  { id: nid('nt'), kind: 'approval', actor_name: '문서연', preview: null, created_at: ago(3 * DAY), read: true },
  { id: nid('nt'), kind: 'guide_pinned', actor_name: null, preview: '10월 셋째 주', created_at: ago(4 * DAY), read: true },
];
const notifs = cell(K.notif, seedNotifs);
export const useGuestNotifs = notifs.use;
export const setGuestNotifs = notifs.set;
export function pushNotif(row) {
  notifs.set(list => [{ id: nid('nt'), created_at: new Date().toISOString(), read: false, ...row }, ...list].slice(0, 30));
}


// ── 시연 역할 ──────────────────────────────────────────────────────────────
const role = cell(K.role, () => 'master');
export const useDemoRole = role.use;
export const setDemoRole = role.set;
