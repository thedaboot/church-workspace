// ============================================================================
// 알림 종류별 설정 — 갈래 넷과 그 안의 항목(시안 v5 2묶음 · mock/b3 · 순수 모듈 · import 0)
// ----------------------------------------------------------------------------
// 알림 kind(services/notifyText.js)를 사람이 고르는 갈래로 묶는다. 화면(알림 종 안 '알림 설정')과
// 걸러 보이기(filterNotifs)가 이 표 한 벌을 본다. 노드 검사(tests/logcheck-live)가 그대로 들인다.
//   · 끈 것은 문자열 배열 하나(`off`) — 갈래를 끄면 'task', 항목만 끄면 'task.mention'.
//     갈래가 꺼지면 그 안의 항목은 값과 상관없이 꺼진다(항목 값은 남겨 둔다 — 갈래를 다시 켜면 예전 고른 대로).
//   · 표에 없는 kind(관리자 메뉴의 '해결' 알림 등)는 언제나 보인다 — 끌 수 있는 것만 표에 둔다.
//   · lock_reset(비밀번호 재설정 요청 · 마스터만 받는다)은 업무 갈래에 들되 항목 칩은 없다(갈래로만 끈다).
// 실제 앱에 붙일 때: 끈 목록은 profiles 한 칸(예: notif_off text[])에 두고, 알림 행을 넣는 DB 함수·트리거와
// api/push.js가 같은 표로 받는 사람을 거른다 — 클라이언트 거르기만으로는 푸시가 그대로 간다.
// ============================================================================

export const NOTIF_GROUPS = [
  { key: 'task', label: '업무', items: [
    { key: 'comment', label: '댓글', kinds: ['reply', 'reaction', 'assignee_comment'] },
    { key: 'mention', label: '멘션', kinds: ['mention'] },
    { key: 'assign', label: '담당자', kinds: ['assign'] },
    { key: 'due', label: '마감 임박', kinds: ['due_soon'] },
  ], kinds: ['lock_reset'] },
  { key: 'worship', label: '예배', items: [
    { key: 'today', label: '오늘 예배', kinds: ['worship_today'] },
    { key: 'published', label: '주보 발행', kinds: ['service_published'] },
    { key: 'note', label: '노트 공유', kinds: ['note_shared'] },
  ] },
  { key: 'group', label: '모임', items: [
    { key: 'apply', label: '동아리 신청', kinds: ['club_apply'] },
    { key: 'accepted', label: '동아리 수락', kinds: ['club_accepted'] },
    { key: 'new', label: '새로운 모임', kinds: ['meeting_new'] },
    { key: 'tomorrow', label: '내일 모임', kinds: ['meeting_tomorrow'] },
    { key: 'guide', label: '순모임 가이드 고정', kinds: ['guide_pinned'] },
  ] },
  // 가입은 항목이 하나라 칩을 두지 않는다(요청 받기 · 승인됨 둘 다 이 갈래)
  { key: 'join', label: '가입', items: [], kinds: ['approval', 'approved'] },
];

// kind → { group, item } · 표에 없으면 null
const SLOT = new Map();
for (const g of NOTIF_GROUPS) {
  for (const k of g.kinds || []) SLOT.set(k, { group: g.key, item: null });
  for (const it of g.items) for (const k of it.kinds) SLOT.set(k, { group: g.key, item: it.key });
}
export const notifSlot = (kind) => SLOT.get(kind) || null;

export function notifAllowed(kind, off = []) {
  const s = notifSlot(kind);
  if (!s) return true;
  if (off.includes(s.group)) return false;
  return !(s.item && off.includes(`${s.group}.${s.item}`));
}

export const filterNotifs = (list, off = []) => (off.length ? list.filter(n => notifAllowed(n.kind, off)) : list);

// 켜고 끄기 — key는 'task' 또는 'task.mention'. 새 배열을 돌려준다.
export const flipOff = (off = [], key) => (off.includes(key) ? off.filter(k => k !== key) : [...off, key]);
