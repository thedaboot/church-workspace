// ============================================================================
// 대시보드 '사람' 칸 — 오늘 다녀간 사람 · 생일 · 합류 · 다녀간 시각(심장박동·떠날 때·쓰기 스탬프) · 시각 글자 모양
// ----------------------------------------------------------------------------
// 로컬 날짜(localDate)도 여기가 원본이다. import 0개 — 노드 검사가 베껴 들인다(tests/_load.mjs).
// 부르는 쪽은 utils.js(바렐)를 문다.
// ============================================================================

// ── 대시보드 '사람' 칸 (0019) ────────────────────────────────────────────────
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).

// 오늘 다녀간 사람. lastSeenAt(타임스탬프)의 **로컬 날짜**가 오늘과 같은지 본다.
// UTC로 자르면 한국 시간 오전 9시 이전에 다녀간 사람이 어제로 밀린다.
// 나는 언제나 포함한다 — 지금 이 화면을 보고 있는 사람이 나다(App이 찍는 last_seen_at은
// 방금 읽은 목록에 아직 없다).
export const seenToday = (members = [], myName = '', today = todayLocal()) =>
  (members || []).filter(m => m.name === myName || localDate(m.lastSeenAt) === today);

// 타임스탬프 → 'YYYY-MM-DD' (로컬 기준). **값이 없으면 빈 문자열이다.**
//
// 처음에는 이 함수 하나가 "오늘"과 "이 값 파싱"을 겸했다(인자가 없으면 오늘). 그래서
// last_seen_at이 아직 없는 멤버의 `localDate(undefined)`가 오늘을 돌려주는 바람에,
// **한 번도 안 다녀간 사람이 전부 "오늘 다녀간 사람"으로 셈해졌다**(검사가 잡았다).
// 같은 실수가 joinedWithin에서 또 났다 — 그래서 두 일을 갈랐다.
export function localDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayLocal = () => localDate(new Date());

// 앞으로 며칠 안에 생일인 사람 (오늘 포함). 'MM-DD'만 저장하므로 연도를 빌려 비교한다.
// 연말연시를 넘어가는 경우(12-30 → 01-02)를 위해 내년 것도 같이 본다 — 12월 31일에
// 1월 2일 생일이 안 보이면 그게 가장 필요한 순간에 빠지는 것이다.
export function birthdaysWithin(members = [], days = 7, now = new Date()) {
  const y = now.getFullYear();
  const midnight = new Date(y, now.getMonth(), now.getDate()).getTime();
  const out = [];
  for (const m of members || []) {
    if (!/^\d{2}-\d{2}$/.test(m.birthday || '')) continue;
    const [mm, dd] = m.birthday.split('-').map(Number);
    // 올해와 내년 중 오늘 이후로 가장 먼저 오는 것
    const cand = [new Date(y, mm - 1, dd).getTime(), new Date(y + 1, mm - 1, dd).getTime()]
      .filter(t => t >= midnight).sort((a, b) => a - b)[0];
    if (cand === undefined) continue;
    const inDays = Math.round((cand - midnight) / 86400000);
    if (inDays <= days) out.push({ ...m, inDays, month: mm, day: dd });
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name, 'ko'));
}

// 최근 며칠 안에 합류한 사람 (환영 줄). joinedAt은 프로필 생성 시각이다.
export const joinedWithin = (members = [], days = 7, today = todayLocal()) =>
  (members || []).filter(m => {
    const d = localDate(m.joinedAt);
    if (!d) return false;                    // 값이 없으면 '새로 온 사람'이 아니다
    const age = ageDaysLocal(d, today);
    return age >= 0 && age <= days;
  });

// 두 'YYYY-MM-DD' 사이의 날 수 (today - iso)
const ageDaysLocal = (iso, today) =>
  Math.round((new Date(`${today}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000);

// 가입한 사람 목록의 순서 — **최근에 방문한 사람이 위**(사용자가 가입순에서 바꿨다).
// 지금 접속해 있는 사람이 맨 위다: '지금'이 가장 최근이고, last_seen_at은 앱을 열 때
// 한 번만 찍으므로 접속 중인 사람끼리는 그 값만으로 못 가른다. 방문 기록이 없는 사람은
// 맨 뒤 — 그래도 **빼지 않는다**(빼면 목록 수가 머리줄의 'N명'과 달라진다).
// 방문 기록이 없으면 가입 시각을 대신 쓴다 — 가입하던 순간에도 앱에 들어와 있었으니
// 거짓이 아니고, 0019 이전 가입자에게 '아직 방문 전'이라고 하는 것이 오히려 틀린 말이다.
export const lastVisitOf = (m) => m?.lastSeenAt || m?.joinedAt || '';

export const visitOrder = (members = [], onlineIds = new Set()) =>
  (members || []).slice().sort((a, b) => {
    const ao = onlineIds.has(a.id) ? 1 : 0, bo = onlineIds.has(b.id) ? 1 : 0;
    if (ao !== bo) return bo - ao;
    const at = lastVisitOf(a), bt = lastVisitOf(b);
    if (at !== bt) return bt.localeCompare(at);       // ISO 문자열은 그대로 시간순
    return a.name.localeCompare(b.name, 'ko');
  });

// 지난 시간 → 사람이 읽는 말. 초 → 분 → 시간 → 일 → 주 → 개월 → 년 순으로 단위를
// 올린다(사용자가 정한 사다리). formatRelative와 달리 날짜로 바꾸지 않는다 —
// "언제 다녀갔나"는 끝까지 상대 시간이 자연스럽다. 값이 없거나 미래면 빈 문자열.
export function agoLabel(ts, now = Date.now()) {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then) || then > now) return '';
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return `${Math.max(1, s)}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  if (d < 31) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30.44)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}

// 다녀간 시각(profiles.last_seen_at) 심장박동의 간격.
// 예전에는 앱을 열 때 한 번만 찍어서, 두 시간을 계속 쓰고 있어도 남들 화면에는
// '2시간 전 다녀감'으로 보였다(사용자 지적 2026-08-30).
// **쓰기 비용**: 사람당 5분에 UPDATE 한 번이다(PITFALLS §4.8). 화면이 숨겨져 있으면 아예 안 찍고,
// 다시 보일 때도 이 간격을 넘겼을 때만 찍는다 — 탭을 자주 오가는 것이 곧 쓰기가 되면 안 된다.
export const HEARTBEAT_MS = 5 * 60 * 1000;
export const dueForHeartbeat = (lastAt, now = Date.now(), everyMs = HEARTBEAT_MS) =>
  !lastAt || (now - lastAt) >= everyMs;

// **떠날 때 한 번 더 찍는다**(App의 visibilitychange·pagehide). 5분 간격의 박동만 두면
// 마지막 박동과 실제로 떠난 시각 사이가 최대 5분 비어서, 남들 화면의 'N분 전 다녀감'이
// 그만큼 낡는다(사용자 지적 2026-09-05 — 두 화면의 값이 안 맞는다). 판정은
// dueForHeartbeat에 간격만 바꿔 넘긴다 — 규칙을 두 벌 쓰지 않는다. 하한을 두는 이유는
// 탭을 자주 오가는 것이 곧 쓰기가 되면 안 되기 때문이다(1분에 UPDATE 1회가 상한).
export const LEAVE_STAMP_MS = 60 * 1000;

// **쓰기는 곧 '지금'이다**(2026-09-06). 5분 박동은 *아무것도 안 하는 사람*의 상한이라,
// 그 사이에 업무를 고친 사람은 남들 화면에서 "1분 전 수정 · 4분 전 다녀감"이라는
// 모순으로 보였다(사용자 지적 2026-09-05 · 라이브에서 실제로 225초 어긋나 있었다).
// 그래서 쓰기가 성공할 때마다 다녀간 시각을 같이 찍되 **1분에 한 번**으로 묶는다 —
// 저장 한 번이 UPDATE 여럿을 만들지 않게(같은 저장에 카드·팀·담당자 쓰기가 줄줄이 난다).
// 판정은 dueForHeartbeat에 간격만 바꿔 넘긴다 — 규칙을 두 벌 쓰지 않는다.
export const WRITE_STAMP_MS = 60 * 1000;

// 그 사람의 **최근 활동 시각**을 다녀간 시각에 겹쳐 쓴다(2026-09-06).
// 위의 쓰기 스탬프가 서버에 닿기 전(또는 그 사람이 옛 배포를 쓰는 동안)에도 두 값이
// 어긋나 보이지 않게 하는 화면 쪽 안전망이고, **서버 왕복이 없다** — 활동 피드는
// 이미 스토어에 있다. 우선순위는 presence(접속 중) > max(last_seen_at, 최근 활동)이고,
// 접속 중 판정은 부르는 쪽(visitOrder·화면)이 이미 따로 한다.
//
// **바뀐 것이 없으면 받은 배열을 그대로 돌려준다** — 활동 피드는 남이 저장할 때마다
// 새로 오는데, 여기서 매번 새 배열을 만들면 그 배열을 보는 연결 지도가 저장 한 번마다
// 다시 배치된다(useMemo 의존성이 참조로 비교된다).
// `left`는 presence가 본 **떠난 순간**([{ actorId, at }] · presence.usePresenceLeft)이다 — 활동 줄과 같은 모양이라
// 같은 규칙으로 겹친다(2026-09-30). 떠난 사람이 서버 스탬프를 기다리지 않고 곧바로 '방금 다녀감'이 된다.
export function mergeActivitySeen(members = [], feed = [], left = []) {
  const list = members || [];
  if (!list.length || (!feed?.length && !left?.length)) return list;
  const latest = new Map();
  for (const a of [...(feed || []), ...(left || [])]) {
    const id = a?.actorId;
    if (!id) continue;                       // 게스트 피드에는 id가 없다(이름뿐) — 그냥 넘긴다
    const at = isoTime(a.at);
    if (!at) continue;
    const cur = latest.get(id);
    if (!cur || at > cur) latest.set(id, at);
  }
  if (!latest.size) return list;
  let changed = false;
  const next = list.map(m => {
    const at = latest.get(m.id);
    // 두 값 다 isoTime을 지나 같은 글자 모양이라 문자열 비교로 된다(§6-12-e)
    if (!at || at <= (m.lastSeenAt || '')) return m;
    changed = true;
    return { ...m, lastSeenAt: at };
  });
  return changed ? next : list;
}

// 시각 한 칸을 **한 가지 글자 모양**으로. 실시간 payload의 timestamptz는 PostgREST와
// 모양이 다르다 — realtime-js는 timestamptz를 손대지 않고 넘기므로
// '2026-09-04 15:27:43.769+00'(공백·'+00')이고, PostgREST는
// '2026-09-04T15:27:43.769+00:00'이다. 두 모양이 스토어에 섞이면 **visitOrder가 깨진다**:
// 그 정렬은 ISO 문자열을 그대로 비교하는데 공백(0x20)이 'T'보다 작아서, 방금 다녀간
// 사람이 목록 맨 아래로 간다. 그래서 스토어에 넣기 전에 여기를 지나게 한다.
// 값이 없거나 못 읽으면 빈 문자열 — agoLabel·localDate가 ''를 이미 안다.
export const isoTime = (raw) => {
  if (!raw) return '';
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
};

// 이 profiles UPDATE가 **심장박동뿐인가** — 다녀간 시각 말고는 아무것도 안 바뀌었나.
// 맞으면 부르는 쪽(cloudSync.subscribeWorkspace)이 전체 재조회 대신 스토어의 그 사람
// 한 칸만 고친다. 5분마다 사람마다 오는 이벤트라, 전체 재조회로 흘리면 접속자 전원이
// 그때마다 워크스페이스를 통째로 다시 읽는다(Egress · §6-21 라우팅).
// `updated_at`은 트리거가 같이 올리므로 셈에서 뺀다.
// **볼 키를 열거하지 않는다**: 열거하면 나중에 컬럼이 늘 때 그 변경을 놓친다(§6-21-a의
// '알 수 없음'과 같은 길이다). 모르는 키가 하나라도 다르면 false이고, 그러면 부르는 쪽이
// 전체 재조회로 떨어진다 — 틀리는 쪽이 아니라 느린 쪽으로 실패한다.
const SEEN_ONLY_IGNORE = new Set(['last_seen_at', 'updated_at']);
export function seenOnlyChange(prev, next) {
  if (!prev || !next) return false;
  if (!next.last_seen_at || String(next.last_seen_at) === String(prev.last_seen_at)) return false;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (SEEN_ONLY_IGNORE.has(k)) continue;
    const a = prev[k], b = next[k];
    if ((a ?? '') === (b ?? '')) continue;
    // 같은 시각이 다른 글자 모양으로 올 수 있다(위 isoTime) — 시각으로 한 번 더 본다
    const ta = Date.parse(a), tb = Date.parse(b);
    if (Number.isNaN(ta) || ta !== tb) return false;
  }
  return true;
}
