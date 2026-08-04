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
