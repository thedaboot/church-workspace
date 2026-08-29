// ============================================================================
// 2. Utils & Helpers (유틸리티)
// ============================================================================
export const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// 모바일 뷰포트 1회 판정 (autoFocus처럼 마운트 시점에만 읽는 값에 사용)
// 모바일에서 자동 포커스는 키보드가 튀어 올라 레이아웃을 덮으므로 피한다.
export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

// ── @멘션 ───────────────────────────────────────────────────────────────────
// 텍스트에서 @이름을 뽑는다. 표시명 **정확 일치**로 사람을 찾으므로(cloudSync의
// resolveMentionRecipients) 뽑는 규칙이 한 벌이어야 한다. 알림을 만드는 쪽과
// AI가 쓴 멘션을 검사하는 쪽(services/ai.js)이 같이 쓴다 — 여기가 원본이다.
// 표시명에 공백이 있는 경우는 다루지 않는다(@뒤 공백 없는 토큰만).
export const MENTION_TAIL = /[.,!?;:)\]}'"]+$/;   // "@민수," → "민수"
export function extractMentions(text) {
  const found = String(text || '').match(/@([^\s@]+)/g) || [];
  const names = found.map(t => t.slice(1).replace(MENTION_TAIL, '')).filter(Boolean);
  return [...new Set(names)];
}

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

// 업무 줄에 팀을 한 마디로 — `웰컴팀` · `웰컴팀 외 2팀`.
// 예전에는 teams[0] 하나만 그렸다. 여러 팀이 붙은 업무는 나머지가 화면 어디에도 없어서,
// "9월 월례회는 웰컴팀 일"로 읽혔다(사용자 지적 2026-08-29). 색은 대표 팀 색을 그대로
// 쓰므로 여기서는 글자만 만든다 — 색까지 여기서 정하면 순수 함수가 아니게 된다.
export function teamsLabel(teams) {
  const list = [...new Set((teams || []).filter(Boolean))];
  if (!list.length) return null;
  return { lead: list[0], more: list.length - 1 };
}

// 연도는 **사람이 정한 값**이다(0025). 값이 없는 옛 행은 만든 해로 떨어진다.
// 탭 줄과 대시보드가 **같은 규칙**을 봐야 한다 — 규칙이 두 벌이면 탭에는 있는
// 프로젝트가 대시보드에는 없는 해가 생긴다. 그래서 layout.jsx가 이걸 가져다 쓴다.
export const projectYear = (p) =>
  String(p?.year || String(p?.createdAt || '').slice(0, 4) || new Date().getFullYear());

// 그 해 프로젝트만 — 대시보드 '프로젝트 진행'이 상단 연도 선택을 따라간다.
// 연도를 안 보면 보관하지 않은 프로젝트가 해마다 쌓여 이 칸만 끝없이 길어진다
// (selectActiveProjectsList는 보관 여부만 걸렀다 — 사용자 지적 2026-08-29).
export const projectsOfYear = (list, year) =>
  (list || []).filter(p => projectYear(p) === String(year));

// 엑셀 첨부를 **구글이 그린 화면**으로 볼 주소. 변환 사본이 있을 때만 준다.
//
// 구글은 .xlsx를 열어볼 때 게을리 변환해서, 갓 올린 파일은 이 주소가 오류를 냈다
// (그래서 예전에는 파일 나이 30분으로 뷰어를 갈랐고, 나중에 앱이 직접 표를 그렸다).
// 지금은 올릴 때 스크립트가 **네이티브 구글 시트 사본**을 만들어 두므로 기다릴 것이
// 없다(0031 · files.preview_file_id). 사본이 없으면 null이고, 부르는 쪽은 예전 길로
// 떨어진다 — 옛 첨부·변환 실패·스크립트가 v7 미만인 경우다.
//
// rm=minimal은 구글 머리줄을 걷어내고, widget=true는 시트 탭을 남긴다 — 시트가 여럿인
// 파일에서 탭이 없으면 첫 장밖에 못 본다.
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
export const sheetPreviewUrl = (row) => (row?.preview_file_id
  ? `https://docs.google.com/spreadsheets/d/${row.preview_file_id}/preview?widget=true&rm=minimal`
  : null);

// 달력 7열의 폭 — **격자선을 장치 픽셀에 붙인다.**
//
// grid-cols-7 + gap:1px으로 두면 열 폭이 소수가 되고(164.703 · 164.719 …), 1px 선이
// 장치 픽셀 두 개에 걸쳐 번진다. 걸치는 비율이 선마다 달라서 **어떤 선만 굵어 보인다**
// — 실측 소수부가 .703 .422 .141 .844 .563 .281이었고, 0.5에 가장 가까운 두 선
// (월|화 .422 · 목|금 .563)이 정확히 사용자가 짚은 자리였다(2026-08-29).
//
// 경계를 round(x * dpr) / dpr 로 붙이면 여섯 선이 **똑같이** 그려진다. dpr이 1.25면
// 1px 선은 어차피 1.25 장치 픽셀이라 완전히 또렷할 수는 없지만, 여섯이 같은 모양이면
// 눈에는 고른 격자로 보인다 — 우리가 고치려는 것은 선명함이 아니라 **들쭉날쭉함**이다.
//
// 폭을 못 재면(0) null을 준다 — 부르는 쪽이 1fr로 떨어진다.
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
export function snapCols(width, dpr = 1, gap = 1, n = 7) {
  const w = Number(width) || 0;
  const d = Number(dpr) > 0 ? Number(dpr) : 1;
  if (w <= 0 || n <= 0) return null;
  const inner = w - gap * (n - 1);          // 선을 뺀, 칸이 나눠 가질 폭
  if (inner <= 0) return null;
  const snap = (x) => Math.round(x * d) / d;
  const cols = [];
  let used = 0;
  for (let i = 1; i < n; i++) {
    // i번째 선이 시작하는 자리(칸 i-1까지 + 선 i-1개)를 장치 픽셀에 붙인다
    const edge = snap((inner * i) / n + gap * (i - 1));
    cols.push(Math.max(0, edge - used));
    used = edge + gap;
  }
  cols.push(Math.max(0, w - used));         // 마지막 칸은 남는 것을 다 가진다
  return cols;
}


// 달력에 얹힐 수 있는 업무 — 시작일이든 마감일이든 하나는 있어야 한다.
//
// 팀 칩의 숫자가 **화면이 보여줄 수 있는 것**을 세게 하려고 뺐다. 예전에는 칩이 전부를
// 세서, 달력에는 3건만 보이는데 칩에는 `웰컴팀 7`이 떴다(사용자 지적 2026-08-29 —
// 실제로 웰컴팀 7건 중 4건이 마감 미정인 9·10·11·12월 월례회였다). 달력이 빠뜨린 것이
// 아니라 셈의 기준이 둘이었다. 마감 미정을 달력에 억지로 얹지는 않는다 — 마감일
// 필수화는 §7에서 뺐고, 마감 미정은 대시보드의 제 구간에서 보인다.
export const datedTasks = (list) => (list || []).filter(t => t?.startDate || t?.dueDate);

// 하위 업무(cards.subtasks) 진척 — 보드 카드와 업무 창이 같이 쓴다.
// 순수 함수라 utils에 둔다(보드가 모달을 가져오는 방향이 되지 않게).
// 고정된 요약이 낡았나 — 고정한 뒤에 카드가 바뀌었으면(체크·본문 수정) 참.
// 고정 쓰기 자체도 updated_at을 올리는데(트리거·서버 시계) ai_summary_at은 클라이언트
// 시계라, 시계가 어긋난 만큼 방금 고정한 것이 낡음으로 보일 수 있다 — 1분 여유를 둔다
// (cloudSync.withClockSkewRetry가 있는 이유와 같은 어긋남이다).
export function summaryOutdated(updatedAt, pinnedAt) {
  if (!updatedAt || !pinnedAt) return false;
  const gap = new Date(updatedAt) - new Date(pinnedAt);
  return Number.isFinite(gap) && gap > 60000;
}

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

// 드라이브 첨부 미리보기 주소 — **뷰어가 둘이고 파일 나이로 고른다.**
//
// · 스프레드시트 미리보기(`docs.google.com/spreadsheets/d/<id>/preview`)가 더 좋다.
//   글자가 크고, 행·열 머리글(A B C…) 없이 표만 그리고, 시트 탭이 진짜 탭이고,
//   글자를 고를 수 있다. 확대·축소 알약도 안 뜬다.
// · 그런데 **갓 올린 파일에는 "Google Docs에 오류가 발생했습니다"가 뜬다** — 구글이
//   준비하는 데 시간이 걸린다(45초 뒤에도 그랬다). 파일 뷰어는 갓 올린 파일도 바로
//   그린다. 올리고 바로 확인하는 것이 가장 흔한 동작이라 그때는 파일 뷰어를 쓴다.
//
// **2026-08-29 정정: 시간 문제가 아니었다.** 구글은 .xlsx를 **사람이 열 때** 변환한다 —
// 같은 날 올린 두 파일 중 열어 본 것만 미리보기가 떴고, 안 열어 본 것은 http 500이었다.
// 그래서 이 상수는 애초에 틀린 전제였고, 지금은 **업로드 때 만든 변환 사본**
// (files.preview_file_id · utils.sheetPreviewUrl)이 그 자리를 대신한다.
// 아래 driveSrc는 옛 형식(.doc·.ppt)에만 남아 있다.
// SHEET_READY_MS는 **실측한 값이 아니다.** 45초에 실패하는 것만 확인했고 언제부터
// 되는지는 재지 않아 넉넉히 잡았다. 늦게 잡아도 잃는 것이 적다 — 그 사이에는 파일
// 뷰어가 표를 제대로 그린다. 이르게 잡으면 오류 화면이 뜬다.
// (3일 지난 파일로 둘을 나란히 재서 스프레드시트 쪽이 낫다는 것을 확인했다.)
// 주의: HTML 글자만 보고 판단하면 안 된다 — 파일 뷰어는 자바스크립트로 그리므로
// 응답 본문에 표가 없다. 그것 때문에 한 번 반대로 판단했다.
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
// ponytail: 시간으로 가른다. iframe 오류는 cross-origin이라 읽을 수 없어 감지할
// 길이 없다. 이르게 뜨는 일이 생기면 SHEET_READY_MS를 늘리면 된다.
export const SHEET_READY_MS = 30 * 60 * 1000;
// 확장자 → 구글 전용 뷰어 종류. 스프레드시트만이 아니라 문서·프레젠테이션도
// 같은 편집기 미리보기가 있다(사용자 요청 — "엑셀처럼 다른 형식도").
const DRIVE_EDITOR = {
  xlsx: 'spreadsheets', xls: 'spreadsheets', csv: 'spreadsheets',
  docx: 'document', doc: 'document',
  pptx: 'presentation', ppt: 'presentation',
};
export const driveSrc = (row, now = Date.now()) => {
  if (!row?.drive_file_id) return null;
  const ext = String(row.name || '').split('.').pop().toLowerCase();
  const editor = DRIVE_EDITOR[ext];
  const age = now - new Date(row.created_at || 0).getTime();
  return (editor && age > SHEET_READY_MS)
    ? `https://docs.google.com/${editor}/d/${row.drive_file_id}/preview`
    : `https://drive.google.com/file/d/${row.drive_file_id}/preview`;
};

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

// 선후관계 그래프의 열 배치 — 각 업무를 "선행 업무보다 오른쪽 열"에 둔다.
// 반환: [[depth 0 업무들], [depth 1 업무들], ...] (열 안은 마감일순 — byDue와 같은 규칙).
// 지워진 카드를 가리키는 id는 무시하고, 순환(A→B→A)은 그 자리에서 끊는다 —
// 화면이 던지며 죽는 것보다 한 칸 어긋난 배치가 낫다.
export function depLayers(tasks = []) {
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  const memo = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;               // 순환 — 여기서 끊는다
    visiting.add(id);
    const deps = (byId.get(id)?.dependsOn || []).filter(d => byId.has(d) && d !== id);
    const d = deps.length ? Math.max(...deps.map(depthOf)) + 1 : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };
  const cols = [];
  for (const t of tasks || []) {
    const d = depthOf(t.id);
    (cols[d] = cols[d] || []).push(t);
  }
  // 순환을 끊으면 중간 깊이가 빌 수 있다(A→B→A에서 A=2, B=1, 0층이 빔) → 빈 열을 걷어낸다.
  // 걷어내지 않으면 희소 배열 구멍에서 sort가 던지고, 화면에는 빈 열이 남는다.
  const packed = cols.filter(Boolean);
  for (const col of packed) col.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  return packed;
}

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

// 본문 체크리스트의 n번째 항목을 뒤집은 마크다운을 돌려준다(0부터 센다).
// 뷰어(RichText)가 체크박스를 누르면 이걸로 content를 바꿔 저장한다 — 하위 업무처럼
// 보기 모드에서 바로 눌린다. 정규식은 markdown.js·RichText의 체크리스트 줄 판정과
// 같은 모양이어야 한다(logcheck가 지킨다).
export function toggleTodoLine(md, idx) {
  let i = -1;
  return String(md ?? '').split('\n').map(line => {
    const m = line.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s?.*)$/);
    if (!m) return line;
    i++;
    if (i !== idx) return line;
    return `${m[1]}${m[2].trim() ? ' ' : 'x'}${m[3]}`;
  }).join('\n');
}

// ── 힘 기반 그래프 한 스텝 (연결 지도·프로젝트 그래프 뷰가 같이 쓴다) ────────────
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
// pos·vel을 제자리에서 고친다(매 프레임 3번 돌므로 새 배열을 만들면 GC가 튄다).
//
// **alpha 냉각(d3-force식 — Injoy 그래프에서 가져온 판단):** 힘을 전부 alpha로
// 스케일한다. 부르는 쪽이 alpha를 매 틱 줄이면 에너지가 잦아들며 출렁임 없이
// 멈춘다. 상수 감쇠만으로는 깨울 때마다 풀 에너지로 진동했다(사용자 지적 — "탱글").
//
//  node: { ax?: 0..1 x 앵커 비율 · ay?: 0..1 · fixed?: {x,y} 고정 노드 ·
//          repel?: 반발 배수 · pl/pr/pt/pb?: 경계 여유 ·
//          zx?: [0..1, 0..1] — x를 이 영역(비율) 안에만 가둔다(사람은 왼쪽,
//          프로젝트는 오른쪽 — 끌어도 남의 영역으로 못 나간다) }
//  edge: [aIdx, bIdx, 목표 길이(기본 90)]
//  opts: { alpha=1 · skip: 끌고 있거나 손으로 놓아둔(고정) 노드 index Set —
//          힘을 받지 않지만 남을 밀어내는 데는 참여한다 }
// ponytail: d3-force 대신 손 시뮬 — 노드 수십 개라 O(n²) 반발도 공짜다.
export function forceStep(pos, vel, nodes, edges, W, H, opts = {}) {
  const alpha = opts.alpha ?? 1;
  const skipSet = opts.skip;
  const REPEL = 2400, SPRING = 0.02, ANCHOR_X = 0.02, ANCHOR_Y = 0.012, DAMP = 0.8, MAX_V = 18;
  const skip = (i) => nodes[i].fixed || (skipSet ? skipSet.has(i) : false);
  for (let i = 0; i < nodes.length; i++) {
    if (skip(i)) continue;
    let fx = 0, fy = 0;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      const d2 = Math.max(120, dx * dx + dy * dy);
      const f = (REPEL * (nodes[i].repel || 1) * (nodes[j].repel || 1) * alpha) / d2;
      const d = Math.sqrt(d2);
      fx += (dx / d) * f; fy += (dy / d) * f;
    }
    fx += (W * (nodes[i].ax ?? 0.5) - pos[i].x) * ANCHOR_X * alpha;
    fy += (H * (nodes[i].ay ?? 0.5) - pos[i].y) * ANCHOR_Y * alpha;
    vel[i].x = (vel[i].x + fx) * DAMP; vel[i].y = (vel[i].y + fy) * DAMP;
  }
  for (const [a, b, L] of edges) {
    const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = (d - (L || 90)) * SPRING * alpha;
    const ux = dx / d, uy = dy / d;
    if (!skip(a)) { vel[a].x += ux * f; vel[a].y += uy * f; }
    if (!skip(b)) { vel[b].x -= ux * f; vel[b].y -= uy * f; }
  }
  for (let i = 0; i < nodes.length; i++) {
    if (skip(i)) continue;
    // 속도 상한 — 가까운 두 점의 척력 스파이크에 튕겨 나가지 않게(Injoy와 같은 이유)
    const sp = Math.hypot(vel[i].x, vel[i].y);
    if (sp > MAX_V) { vel[i].x *= MAX_V / sp; vel[i].y *= MAX_V / sp; }
    const b = forceBounds(nodes[i], W, H);
    let nx = pos[i].x + vel[i].x, ny = pos[i].y + vel[i].y;
    // 벽에 닿으면 그 방향 속도를 죽인다 — 안 그러면 미는 힘에 눌려 가장자리에서 영영 떤다
    if (nx <= b.x0 || nx >= b.x1) vel[i].x = 0;
    if (ny <= b.y0 || ny >= b.y1) vel[i].y = 0;
    pos[i].x = Math.min(b.x1, Math.max(b.x0, nx));
    pos[i].y = Math.min(b.y1, Math.max(b.y0, ny));
  }
}

// 노드 하나의 이동 가능 범위 — 시뮬과 드래그가 같은 규칙을 본다
// (드래그만 다른 규칙이면 끌어다 놓은 자리로는 못 가는 자리가 생긴다)
export function forceBounds(node, W, H) {
  return {
    x0: Math.max(node.pl ?? 20, node.zx ? W * node.zx[0] : 0),
    x1: Math.min(W - (node.pr ?? 20), node.zx ? W * node.zx[1] : W),
    y0: node.pt ?? 20,
    y1: H - (node.pb ?? 16),
  };
}
