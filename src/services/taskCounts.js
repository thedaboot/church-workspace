// ============================================================================
// 업무 셈 한 벌 — 지연 · 마감 구간 · 남은 업무 · 2주 방치 · 진척
// ----------------------------------------------------------------------------
// 대시보드 KPI · 마감 목록 · 인사말 · 팀별/청년별 남은 업무 · 내 업무 · 팀 보드 · 보드 카드의
// 빨간 마감이 **같은 판정**을 보게 모았다(2026-09-25 셈 감사). 예전에는 화면마다
// `t.status !== '완료' && t.dueDate < today`를 따로 적어서, 보류 중인 업무가 대시보드에서는
// '지연'인데 목록에서는 … 같은 어긋남이 날 자리가 많았다.
//
// 기준(사용자 결정 · HANDOFF §8):
//   · **한 주는 주일(일요일)에 시작해 토요일에 끝난다**(utils.weekEndOf와 같은 셈).
//   · 날짜는 브라우저 로컬 `YYYY-MM-DD` — 타임스탬프는 로컬 날짜로 바꿔 비교한다(UTC 앞 10자가 아니다).
//   · **지연 = 돌아가는 일(시작 전·진행 중)의 마감이 오늘보다 앞**. 보류 중은 멈춘 일이라 지연이 아니고,
//     상시는 마감이 없다.
//   · **남은 업무 = 끝낼 일** — 완료도 상시도 아닌 것. 상시는 끝나지 않는 일이라 남은 수·진척의
//     분모에 넣으면 진척이 영영 100%가 못 된다.
//   · 마감 구간: 지연 / 오늘 마감 / 이번 주(내일~토요일) / 다음 주 이후 / 마감 미정 / 상시 / 보류 중 / 끝낸 업무.
//     보류 중은 날짜가 있어도 제 구간이다 — '오늘 마감'·'이번 주'에 섞이면 KPI가 멈춘 일을 급한 일로 센다.
//
// 순수 모듈 — config·utils(둘 다 import 0)만 부른다(tests/logcheck가 노드에서 바로 부른다).
// ============================================================================
import { CONFIG } from '../config.js';
import { weekEndOf, localDate } from '../utils.js';

export const DONE = '완료';
export const HOLD = '보류 중';
export const ONGOING = CONFIG.STATUS_ONGOING;   // '상시'

export const isDone = (t) => t?.status === DONE;
export const isOngoing = (t) => t?.status === ONGOING;
// 끝낼 일 — 남은 업무 셈 · 진척의 분모
export const isOpen = (t) => !!t && t.status !== DONE && t.status !== ONGOING;
// 날짜로 굴러가는 일 — 지연·오늘·이번 주를 따질 수 있는 것
export const isRunning = (t) => isOpen(t) && t.status !== HOLD;

// 타임스탬프 → 로컬 날짜(utils.localDate). 'YYYY-MM-DD'는 그대로 — localDate에 넣으면 UTC 자정으로
// 읽혀 서쪽 시간대에서 하루 밀린다.
export const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : localDate(v));
export const todayIso = () => localDate(new Date());

// 두 날짜 사이 날 수(to - from). 자정끼리 UTC로 재서 서머타임에 흔들리지 않는다.
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
// 지난 날 수 (오늘 - 그날). 타임스탬프는 **로컬 날짜**로 — 예전에는 앞 10자(UTC)를 잘라서
// 한국 아침 9시 전에 만든 업무가 하루 더 묵은 것으로 셈해졌다.
export function ageDays(v, today = todayIso()) {
  const d = dayOf(v);
  return d ? daysBetween(d, today) : NaN;
}

export const isOverdue = (t, today = todayIso()) => isRunning(t) && !!t.dueDate && t.dueDate < today;

// 구간 열쇠 — 화면(dashboardParts의 BUCKETS)이 이 순서로 선다
export const BUCKET_KEYS = ['overdue', 'today', 'week', 'later', 'nodue', 'ongoing', 'hold', 'done'];
export function bucketOf(t, today = todayIso()) {
  // 끝낸 업무는 마감이 지났어도 '지연'이 아니다
  if (isDone(t)) return 'done';
  if (isOngoing(t)) return 'ongoing';
  if (t.status === HOLD) return 'hold';
  if (!t.dueDate) return 'nodue';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  // '이번 주'는 주일에 시작해 토요일에 끝나는 달력의 주다 — 금요일에는 토요일 하루만 남는다
  return t.dueDate <= weekEndOf(today) ? 'week' : 'later';
}

// 구간별 건수 — KPI가 이걸 센다(아래 목록과 같은 함수라 숫자와 목록이 어긋날 수 없다)
export function dueCounts(tasks, today = todayIso()) {
  const c = Object.fromEntries(BUCKET_KEYS.map(k => [k, 0]));
  for (const t of (tasks || [])) if (t) c[bucketOf(t, today)]++;
  return c;
}

// 마감이 정해지지 않은 채 이만큼 **손대지 않으면** 표시한다. 기준은 마지막으로 고친 날
// (updatedAt) — 만든 날로 재면 매주 손보는 업무도 2주가 지나면 방치로 떴다.
// 보류·상시는 제 구간이 따로라 여기 오지 않는다.
export const STALE_NODUE_DAYS = 14;
export const isStaleNoDue = (t, today = todayIso()) =>
  !!t && bucketOf(t, today) === 'nodue'
  && ageDays(t.updatedAt || t.createdAt, today) >= STALE_NODUE_DAYS;

// 진척 — 끝낸 수 / (전체 - 상시)
export function progressOf(tasks) {
  let done = 0, total = 0;
  for (const t of (tasks || [])) {
    if (!t || isOngoing(t)) continue;
    total++;
    if (isDone(t)) done++;
  }
  return { done, total };
}

// 팀별 남은 업무 — config의 팀 순서 · 상시는 세지 않는다
export function teamLeftStats(tasks) {
  const acc = new Map(Object.keys(CONFIG.TEAMS).map(name => [name, { name, total: 0, done: 0 }]));
  for (const t of (tasks || [])) {
    if (!t || isOngoing(t)) continue;
    for (const team of (t.teams || [])) {
      const s = acc.get(team);
      if (!s) continue;                        // config에 없는 팀 이름은 무시
      s.total++;
      if (isDone(t)) s.done++;
    }
  }
  return [...acc.values()];
}

// 청년별 남은 업무 — 많이 맡은 사람 순. **지연 수는 세지 않는다**(사용자 결정 2026-09-25 —
// 사람마다 빨간 '지연 N건'이 서면 누가 밀렸는지 견주는 줄이 된다 · §8).
export function personLoad(tasks) {
  const m = new Map();
  for (const t of (tasks || [])) {
    if (!isOpen(t)) continue;
    for (const name of (t.assignees || [])) {
      if (!name) continue;
      const s = m.get(name) || { name, left: 0 };
      s.left++;
      m.set(name, s);
    }
  }
  return [...m.values()].sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'ko'));
}

// '지난 7일 간 N건 끝냈어요' — 오늘 포함 7일(오늘과 앞 엿새). 예전에는 `<= 7`이라 8일을 셌다.
// whenOf는 끝낸 시각(utils.completedTime — cards.completed_at)을 주는 함수다(여기는 import 0).
export const RECENT_DONE_DAYS = 7;
// 끝낸 날(로컬 날짜)이 오늘 포함 7일 안인가 — 내 업무·팀 보드 맨 아래 '완료한 업무' 구간(2026-09-25)도
// 이 판정 하나다(168시간이 아니라 날짜로 — 셈 기준 §8). 끝낸 시각을 모르면 넣지 않는다(NaN < 7은 false).
export const isRecentlyDone = (t, whenOf, today = todayIso()) =>
  isDone(t) && ageDays(whenOf(t), today) < RECENT_DONE_DAYS;
export const recentDoneCount = (tasks, whenOf, today = todayIso()) =>
  (tasks || []).filter(t => isRecentlyDone(t, whenOf, today)).length;

// 고른 해 프로젝트의 업무만 — ids는 Set(대시보드가 projectsOfYear(보관 제외)로 만든다)
export const inProjects = (tasks, ids) => (tasks || []).filter(t => t && ids.has(t.projectId));
