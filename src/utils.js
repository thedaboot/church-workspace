// ============================================================================
// 2. Utils & Helpers (유틸리티)
// ============================================================================
// 큰 덩어리는 utils/로 갈랐다(19차 묶음 B2) — 부르는 쪽은 여전히 이 파일 하나를 문다:
//   utils/authUrl.js       공유 링크 로그인(카카오 인앱 · 돌아갈 자리 · OAuth 실패)
//   utils/peopleSeen.js    대시보드 사람 칸 · 다녀간 시각 · localDate
//   utils/taskEdit.js      업무 창 수정 판정 · 바뀐 칸 · 하위 업무 병합
//   utils/presenceWhere.js 지금 보고 있는 사람 고르기 · 자리 옮김
//   utils/graphLayout.js   선후관계 열 · 힘 그래프 한 스텝 · 라벨 떼어놓기 · 이동 범위
// 조각은 import 0개다(노드 검사가 베껴 들인다 — tests/_load.mjs). 조각이 이 파일을 물면 순환이다.
export * from './utils/authUrl.js';
export * from './utils/peopleSeen.js';
export * from './utils/taskEdit.js';
export * from './utils/presenceWhere.js';
export * from './utils/graphLayout.js';

// substr은 폐기된 API다 — 같은 자리를 자르는 slice로 둔다(결과는 그대로)
export const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

// 모바일 뷰포트 1회 판정 (autoFocus처럼 마운트 시점에만 읽는 값에 사용)
// 모바일에서 자동 포커스는 키보드가 튀어 올라 레이아웃을 덮으므로 피한다.
export const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

// ── @멘션 ───────────────────────────────────────────────────────────────────
// 텍스트에서 @이름을 뽑는다. 표시명 **정확 일치**로 사람을 찾으므로(cloudSync의
// resolveMentionRecipients) 뽑는 규칙이 한 벌이어야 한다. 알림을 만드는 쪽과
// AI가 쓴 멘션을 검사하는 쪽(services/ai.js)이 같이 쓴다 — 여기가 원본이다.
// 표시명에 공백이 있는 경우는 다루지 않는다(@뒤 공백 없는 토큰만).
// **마크다운 서식 기호도 꼬리다**(2026-09-25) — `**@양민혁**`·`(@박지호)**`처럼 굵게·형광펜
// 안에 든 멘션이 이름 `양민혁**`로 읽혀 알림이 안 갔고 AI 맥락에서도 빠졌으며, 다듬기의
// sanitizeMentions가 모르는 이름으로 보고 `@`를 떼어 버렸다(라이브 카드 3장). 서식 기호는
// `*`(굵게·기울임) `=`(형광펜) `_`(밑줄) `~`(취소선) `` ` ``. **끝에 붙은 것만** 뗀다 —
// 이름 가운데의 `_`(예: `노준석_서브`)는 그대로 이름이다.
export const MENTION_TAIL = /[.,!?;:)\]}'"*=_~`]+$/;   // "@민수," → "민수" · "@양민혁**" → "양민혁"
// "@박지호)" → { name: '박지호', tail: ')' }. **그리는 쪽(RichText)도 이것을 쓴다** —
// 뽑는 쪽만 꼬리를 떼고 그리는 쪽은 `@\S+`를 통째로 칩에 넣었더니 `(@박지호)`의 닫는
// 괄호가 강조 안에 들어갔다(사용자 지적 2026-09-08). 규칙이 한 벌이어야 알림을 받는
// 사람과 화면에서 강조되는 글자가 같다.
export function splitMention(token) {
  const raw = String(token || '');
  const body = raw.startsWith('@') ? raw.slice(1) : raw;
  const tail = (body.match(MENTION_TAIL) || [''])[0];
  return { name: body.slice(0, body.length - tail.length), tail };
}
export function extractMentions(text) {
  const found = String(text || '').match(/@([^\s@]+)/g) || [];
  const names = found.map(t => splitMention(t).name).filter(Boolean);
  return [...new Set(names)];
}

export const formatDate = (dateString) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// 날짜만 있는 값('2026-09-26')을 'N월 N일'로. formatDate는 시각까지 붙여서(생성 시각용)
// 마감일 같은 날짜 칸에는 안 맞는다 — 그 자리에 쓰면 "9월 26일 오전 09:00"이 된다.
export const formatDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : '';
};

// 날짜만 있는 값('2026-09-26')을 '9. 26.'으로 — 대시보드 마감 목록·달력·칸반 카드·홈 '작년 이맘때'가
// 같은 짧은 표기를 쓴다(예전에는 화면마다 같은 한 줄을 따로 들고 있었다). 문자열을 그대로 쪼갠다 —
// new Date로 읽으면 시간대에 따라 하루가 밀린다.
export const mdDot = (iso) => `${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;

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

// 편집 목록의 줄 열쇠 — **저장하지 않는다**(주보 roles·songs·notices jsonb 모양 그대로 · 0036).
// 줄에 id 칸이 없어서 key={i}였는데, 그러면 줄을 옮기거나 지울 때 리액트가 **자리로** 짝을
// 지어 한 줄의 상태(열린 목록·삭제 확인)가 옆 줄로 넘어간다. 여기서 이전 렌더의 줄과 짝을 짓는다:
//   ① 같은 객체면 그 열쇠(옮기기·지우기는 filter/splice라 객체가 그대로다)
//   ② 아니면 같은 자리의 옛 줄이 새 목록에서 사라졌을 때만 그 자리 열쇠(그 자리에서 고친 줄 —
//      고치면 `{...r, ...patch}`로 새 객체가 된다. 입력 중에 열쇠가 바뀌면 칸이 새로 마운트되어
//      글자를 칠 때마다 포커스를 잃는다)
//   ③ 그 밖(새로 더한 줄)은 새 열쇠. 바깥에서 통째로 갈아 끼우면(다시 읽기) ②로 자리대로 잇는다.
// 한 열쇠를 두 줄에 주지 않는다. 순수 함수라 여기 둔다(tests/logcheck).
export function stableRowKeys(prevRows = [], prevKeys = [], rows = [], mint) {
  const byObj = new Map();
  prevRows.forEach((r, i) => { if (r && typeof r === 'object' && !byObj.has(r)) byObj.set(r, prevKeys[i]); });
  const inNext = new Set(rows);
  const used = new Set();
  return rows.map((r, i) => {
    let k = byObj.get(r);
    if (k !== undefined && !used.has(k)) { used.add(k); return k; }
    k = prevKeys[i];
    if (k !== undefined && !used.has(k) && !inNext.has(prevRows[i])) { used.add(k); return k; }
    k = mint();
    used.add(k);
    return k;
  });
}

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
// **상시는 날짜가 남아 있어도 달력에 서지 않는다**(2026-09-25 · 상시로 바꾸면 날짜를 지우지만 옛 행·동시 저장을 막는다).
export const datedTasks = (list) => (list || []).filter(t => (t?.startDate || t?.dueDate) && t.status !== '상시');

// 업무의 '이번 주'가 끝나는 날 — 오늘이 속한 주의 **토요일** ISO 날짜.
// 한 주는 주일(일요일)에 시작한다(사용자 지시 2026-09-08 "업무 이번 주 - 주일을
// 시작으로 하기 무조건"). 오늘이 토요일이면 오늘, 주일이면 엿새 뒤다.
// 예전에는 '오늘부터 6일'이라 목요일에 보면 다음 주 화요일 마감이 '이번 주'에 섞였고,
// 화면의 '이번 주'가 달력의 이번 주와 다른 말을 했다.
//
// UTC로 파싱하고 UTC 게터로 되돌린다 — 서머타임을 쓰는 시간대의 브라우저에서
// 로컬 자정에 날짜를 더하면 하루가 23/25시간이 되어 결과가 하루 밀린다.
// 순수 함수라 utils에 둔다(브라우저 없이 검사할 수 있게 — tests/logcheck.mjs).
export function weekEndOf(todayIso) {
  const d = new Date(`${String(todayIso || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + (6 - d.getUTCDay()) * 86400000).toISOString().slice(0, 10);
}

// 하위 업무를 DB(cards.subtasks jsonb)에 적는 모양. 이름이 빈 줄은 버린다(아무 뜻 없는 체크박스).
// **맡은 사람·기한도 싣는다**(2026-09-24) — 예전에는 {id,title,done}만 적어서, 담당 업무에서
// 내려온 이름·날짜가 저장(체크 한 번에도 카드 전체를 쓴다)마다 잘려 나갔다. 게스트는 이 길을
// 안 타서 검사가 못 봤다. 빈 값은 키째 뺀다 — 손으로 더한 줄은 예전 모양 그대로다.
export function subtasksForDb(list) {
  return (Array.isArray(list) ? list : [])
    .filter(s => s && String(s.title || '').trim())
    .map(s => ({
      id: s.id, title: String(s.title).trim(), done: !!s.done,
      ...(String(s.assignee || '').trim() ? { assignee: String(s.assignee).trim() } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(String(s.due || '')) ? { due: s.due } : {}),
    }));
}

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

// 최근에 **만든** 것부터 — 선행 업무 후보 목록이 쓴다(사용자 결정 2026-08-31).
// 예전에는 스토어의 allIds 순서(=created_at 오름차순)라 맨 위가 가장 오래된 업무였고,
// 방금 만든 업무를 고르려면 목록 끝까지 내려가야 했다.
// 여기서 updatedAt을 보지 않는 이유: 남이 옛 업무의 제목만 고쳐도 후보 순서가 흔들리면
// 고르는 사람이 같은 자리를 두 번 찾지 못한다. 만든 순서는 변하지 않는다.
export const byNewest = (a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));

// 최근에 **끝낸** 것부터 — 마감 목록의 '끝낸 업무' 구간이 쓴다(사용자 결정 2026-08-31).
// 값은 `completedAt`(0033/0034가 만든 cards.completed_at)이고 **날짜 칸에 그대로
// 보여준다** — 정렬 기준이 화면에 안 보이면 목록이 "날짜가 왔다갔다" 하는 것으로
// 읽힌다(사용자 지적 2026-08-31: 칸은 마감일인데 정렬은 updatedAt이었다).
//
// updatedAt으로 정렬하지 않는 이유: 완료된 업무에 첨부를 하나 올리거나 제목을
// 고치면 updatedAt이 그때로 바뀐다. 그 값을 '끝낸 날'이라고 부르면 거짓이 된다.
// 폴백(updatedAt → createdAt)은 completedAt이 아직 없는 자리를 위한 것이다 —
// 배포 전환기의 옛 탭, 그리고 게스트 모드의 옛 localStorage.
export const completedTime = (t) => String(t?.completedAt || t?.updatedAt || t?.createdAt || '');
export const byCompleted = (a, b) => completedTime(b).localeCompare(completedTime(a));

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
// **표는 한 벌이다** — 새 탭에서 여는 주소를 만드는 쪽(cloud.getFileOpenUrl)도 이것을
// 가져다 쓴다. 두 벌이면 확장자를 하나 붙일 때 한쪽만 고쳐져서, 앱 안에서는 구글
// 화면으로 열리는데 새 탭에서는 어두운 파일 뷰어로 떨어지는 파일이 생긴다.
export const GOOGLE_EDITOR = {
  xlsx: 'spreadsheets', xls: 'spreadsheets', csv: 'spreadsheets',
  docx: 'document', doc: 'document',
  pptx: 'presentation', ppt: 'presentation',
};
export const driveSrc = (row, now = Date.now()) => {
  if (!row?.drive_file_id) return null;
  const ext = String(row.name || '').split('.').pop().toLowerCase();
  const editor = GOOGLE_EDITOR[ext];
  const age = now - new Date(row.created_at || 0).getTime();
  return (editor && age > SHEET_READY_MS)
    ? `https://docs.google.com/${editor}/d/${row.drive_file_id}/preview`
    : `https://drive.google.com/file/d/${row.drive_file_id}/preview`;
};

// ── Enter로 확정하는 칸 (2026-09-25 감사 S6·9) ──────────────────────────────
// **한글 조합 중의 Enter는 확정이 아니다.** 맥·아이폰은 조합 중인 마지막 글자를 끝내는 Enter를
// 칸에 그대로 보내서(isComposing, 옛 브라우저는 keyCode 229), 그 Enter로 등록이 한 번 돌고
// 조합이 끝난 글자가 칸에 남아 한 번 더 등록되거나 마지막 글자만 남았다. Enter로 무언가를
// 하는 칸은 전부 이것부터 본다. React 이벤트든 DOM 이벤트든 받는다.
export const imeComposing = (e) =>
  !!(e?.nativeEvent?.isComposing ?? e?.isComposing) || e?.keyCode === 229 || e?.nativeEvent?.keyCode === 229;
// 손가락으로 쓰는 기기인가 — 댓글 칸의 Enter가 줄바꿈이 되는 자리(감사 9). 폰 키보드에는
// Shift+Enter가 없어서 Enter가 곧 등록이면 줄을 바꿀 길이 아예 없었다. 등록은 옆 버튼이 한다.
export const coarsePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// ── 키보드가 올라왔을 때 커서를 어디로 옮겨야 하나 (2026-09-22) ─────────────
// `caret`은 지금 커서(또는 쓰고 있는 칸)의 자리, `view`는 **쓸 수 있는 띠**다 —
// 보이는 창에서 아래 도구 줄(저장·취소)을 뺀 구간. 굴려야 할 거리를 돌려준다(0이면 그대로).
//
// 왜 scrollIntoView({block:'center'})로 안 되나: 그건 **칸 전체**를 가운데로 보낸다.
// 업무 상세의 본문 편집기는 화면보다 길어서, 가운데로 보내면 커서가 어디에 있든
// 엉뚱한 데가 보인다(사용자 지적 — "딱 커서 위치한 곳까지 올라가야 하는데").
// 그리고 저장·취소 바는 창 안에 떠 있어서 브라우저의 셈에 안 들어간다.
export function caretShift(caret, view, pad = 12) {
  if (!caret || !view) return 0;
  const top = view.top + pad;
  const bottom = view.bottom - pad;
  if (!(bottom > top)) return 0;                    // 띠가 없으면(키보드가 다 먹었으면) 그대로
  if (caret.bottom > bottom) return Math.round(caret.bottom - bottom);
  if (caret.top < top) return Math.round(caret.top - top);
  return 0;
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

// ── 끌어다 놓은 자리로 순서 바꾸기 ─────────────────────────────────────────
// 프로젝트 탭 순서(0021)를 데스크톱 드래그와 모바일 길게 눌러 끌기가 같이 쓴다.
// **뒤로 끌면 놓은 것 뒤, 앞으로 끌면 앞**이다 — 언제나 '앞'에 끼우면 나를 목록에서
// 뺀 만큼 뒤 항목이 당겨져 **제자리로 돌아온다**(§6-12-a. 눈으로는 "안 움직인다"로만
// 보여서 보드 순서 바꾸기에서 검사가 먼저 잡았다).
// 옮길 수 없으면(둘 중 하나가 목록에 없거나 같은 자리) null — 부르는 쪽은 저장을 건너뛴다.
export function reorderIds(ids, fromId, toId) {
  const list = ids || [];
  const from = list.indexOf(fromId), to = list.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = list.slice();
  // 먼저 빼고(splice가 인자로 먼저 실행된다) 그 자리에 넣는다 — 뒤로 끌었으면
  // 뺀 만큼 당겨져 to가 놓은 것의 '뒤'가 되고, 앞으로 끌었으면 '앞'이 된다.
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// 이 요소를 실제로 스크롤하는 조상. 이 앱은 창이 아니라 `main`이 스크롤한다
// (App.jsx의 레이아웃) — `window.scrollBy`로는 아무 일도 일어나지 않는다.
// 없으면 문서 스크롤러로 떨어진다.
export function scrollParentOf(el) {
  let n = el?.parentElement;
  while (n && n !== document.documentElement) {
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
    n = n.parentElement;
  }
  return document.scrollingElement;
}

// ── 팀 보드 상단의 사람 칩 ──────────────────────────────────────────────────
// **기준은 "그 팀에 속한 사람"이지 "그 팀 업무를 맡은 사람"이 아니다.**
// 예전에는 팀 업무의 담당자를 세어 칩을 세웠는데, 그러면 교역자 팀 보드에 교역자가
// 아닌 청년이 떴다(교역자 팀 업무 한 건을 맡고 있었다 · 사용자 지적 2026-09-07).
// 팀은 사람 프로필이 말한다(스토어의 members — cloudSync가 profiles·profile_teams로
// 만든다: 대표 팀 `team` + 겸직까지 담은 `teams`).
// **팀 소속이 없는데 이 팀 업무를 맡은 사람은 칩에서 빠진다**(사용자 결정) — 칩은
// "이 팀이 누구인가"를 말하는 줄이고, 그 사람의 업무는 아래 마감 목록에 그대로 있다.
// 숫자는 그 사람이 맡은 **이 팀의 남은 업무 수**다(0이면 화면이 숫자를 생략한다).
//
// members가 비어 있으면(게스트 모드 · 클라우드가 아직 안 왔을 때) 예전처럼 담당자
// 기준으로 떨어진다 — 그러지 않으면 게스트 스위트에서 이 줄이 통째로 빈다.
export function teamChips(members, tasks, teamName) {
  const left = new Map();
  for (const t of (tasks || [])) {
    if (t.status === '완료' || t.status === '상시' || !(t.teams || []).includes(teamName)) continue;   // 상시는 남은 업무가 아니다(taskCounts.isOpen)
    for (const a of (t.assignees || [])) left.set(a, (left.get(a) || 0) + 1);
  }
  const list = (members || []).length
    // 동명이인이 둘 다 서면 같은 칩이 두 번 뜬다 — 이름으로 한 번만 센다
    ? [...new Set(members
        .filter(m => m.team === teamName || (m.teams || []).includes(teamName))
        .map(m => m.name).filter(Boolean))]
      .map(name => ({ name, left: left.get(name) || 0 }))
    : [...left.entries()].map(([name, n]) => ({ name, left: n }));
  return list.sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'ko'));
}

// 그 상태 맨 위에 설 position — 그 상태 업무들 가운데 가장 작은 값 - 1(자기 자신은 뺀다 · 없으면 0).
// App.handleStatusChange가 상태 버튼·상단 칩으로 옮길 때 쓴다(2026-10-02).
export function topPosition(tasks, status, selfId = null) {
  let min = null;
  for (const t of tasks || []) {
    if (!t || t.id === selfId || t.status !== status) continue;
    const p = Number(t.position ?? 0);
    if (min === null || p < min) min = p;
  }
  return (min === null ? 1 : min) - 1;
}
