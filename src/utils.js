// ============================================================================
// 2. Utils & Helpers (유틸리티)
// ============================================================================
export const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 모바일 뷰포트 1회 판정 (autoFocus처럼 마운트 시점에만 읽는 값에 사용)
// 모바일에서 자동 포커스는 키보드가 튀어 올라 레이아웃을 덮으므로 피한다.
export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const formatDate = (dateString) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// 상대 시간 (방금 · n분 전 · n시간 전 · n일 전 · 그 이상은 날짜)
export const formatRelative = (dateString) => {
  if (!dateString) return '';
  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day <= 7) return `${day}일 전`;
  return new Date(then).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};

// 이름 해시 → 파스텔 태그 9색 중 하나 (같은 사람은 항상 같은 색). 장식 전용.
const AVATAR_TAGS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const avatarColor = (name = '') => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const t = AVATAR_TAGS[h % AVATAR_TAGS.length];
  return `bg-tag-${t} text-tag-${t}-fg`;
};

// 키별로 한 번에 묶는다 → Map<key, item[]>
// 프로젝트마다/팀마다 목록 전체를 다시 filter하면 O(프로젝트×업무)가 되고, 그게
// 렌더마다 돌았다(프로젝트 20 × 업무 500 = 만 단위 순회).
export const groupBy = (list, keyOf) => {
  const m = new Map();
  for (const item of list) {
    const k = keyOf(item);
    if (k === undefined || k === null) continue;
    const bucket = m.get(k);
    if (bucket) bucket.push(item); else m.set(k, [item]);
  }
  return m;
};

// Entity 정규화 헬퍼 (Redux Toolkit Entity Adapter 패턴)
export const normalize = (array) => array.reduce((acc, item) => {
  acc.byId[item.id] = item;
  acc.allIds.push(item.id);
  return acc;
}, { byId: {}, allIds: [] });

// 목록에서 방향키로 옮긴 항목이 스크롤 영역 밖이면 보이게 끌어온다.
// ref 콜백으로 쓴다: ref={i === activeIdx ? keepVisible : null}
// (활성 항목이 바뀔 때만 호출되므로 useEffect가 필요 없다)
export const keepVisible = (el) => el?.scrollIntoView({ block: 'nearest' });

// 대시보드 인사말이 세는 범위 — "내 것 + 담당자 없는 것(공통)".
//
// 예전에는 인사말이 상단 세그먼트(전체/내 팀/내 업무)를 따라가는 목록을 셌다. 기본값이
// '전체'라서, 미디어팀 박지호 건 하나가 지연이면 "노준석님, 밀린 업무부터 정리해봐요"가
// 떴다 — 남의 지연을 내 이름으로 나무라는 문장이었다. 인사말은 나에게 말을 거는 문장이니
// 내 것만 센다. KPI·목록은 그대로 세그먼트를 따라간다(그건 필터의 일이다).
//
// 담당자가 없는 업무를 내 것에 함께 세는 이유: 아무의 것도 아닌 일은 아무도 챙기지 않는다.
// 인사말에서까지 빠지면 영원히 안 보인다.
//
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
export const myScope = (openTasks, myName) => (openTasks || []).filter(t => {
  const a = t?.assignees || [];
  return a.length === 0 || a.includes(myName);
});

// 하위 업무(cards.subtasks) 진척 — 보드 카드와 업무 창이 같이 쓴다.
// 순수 함수라 utils에 둔다(보드가 모달을 가져오는 방향이 되지 않게).
export function subtaskProgress(list = []) {
  const total = list.length;
  const done = list.reduce((n, s) => n + (s.done ? 1 : 0), 0);
  return { total, done, ratio: total ? done / total : 0 };
}

// 프로필 사진 주소를 https로 올린다.
// 카카오 로그인이 주는 주소가 http라서, https 페이지에서는 브라우저가 혼합 콘텐츠로
// 막아 버린다(요청 자체가 안 나가서 onError도 늦게 온다). 카카오 CDN은 https로도 같은
// 이미지를 준다. 구글 주소는 이미 https라 그대로다.
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
export const httpsImage = (url) => String(url || '').replace(/^http:\/\//i, 'https://');

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
export const todayLocal = () => localDate(new Date());

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

// 가입한 순서대로 (먼저 온 사람이 위) + 며칠 전인지.
// 날짜가 없는 사람도 **빼지 않고** 맨 뒤에 둔다(daysAgo = null) — 빼면 목록 수가 머리줄의
// '7명'과 달라져서, 눌러 놓고 세어 보면 화면이 서로 다른 말을 한다.
export const joinedOrder = (members = [], today = todayLocal()) =>
  (members || [])
    .map(m => {
      const d = localDate(m.joinedAt);
      return { ...m, daysAgo: d ? ageDaysLocal(d, today) : null };
    })
    .sort((a, b) => {
      if (a.daysAgo === null) return 1;
      if (b.daysAgo === null) return -1;
      return b.daysAgo - a.daysAgo || a.name.localeCompare(b.name, 'ko');
    });

// 며칠 전 → 사람이 읽는 말. 오늘·어제만 따로 부르고 나머지는 날 수 그대로.
export const daysAgoLabel = (n) =>
  n === null || n === undefined ? '' : n <= 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`;

// 생일을 'MM-DD' → 사람들 로 묶는다. 달력이 날짜 칸마다 물어보므로 한 번만 만든다
// (12명 × 42칸을 매 렌더 훑지 않게).
export const birthdayMap = (members = []) => {
  const m = new Map();
  for (const p of members || []) {
    if (!/^\d{2}-\d{2}$/.test(p.birthday || '')) continue;
    const b = m.get(p.birthday);
    if (b) b.push(p); else m.set(p.birthday, [p]);
  }
  return m;
};

// 'YYYY-MM-DD' → 그 날 생일인 사람. **연도는 보지 않는다**(생일에 연도가 없다).
// 없으면 언제나 같은 빈 배열을 돌려준다 — 매번 새 배열이면 React가 계속 다시 그린다.
const NO_BIRTHDAYS = [];
export const birthdaysOn = (map, iso = '') =>
  (map && map.get(String(iso).slice(5, 10))) || NO_BIRTHDAYS;
