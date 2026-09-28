// ============================================================================
// 업무 본문 같이 쓰기 — **화면이 쓰는 순수 부분** (import 0 · tests/coedit가 노드에서 돌린다)
// ----------------------------------------------------------------------------
// 엔진(core.js·index.js)과 따로 둔 까닭: 이 함수들은 업무 창의 첫 조각에 실린다(얼굴 색·판 목록
// 글자). 엔진을 import하면 yjs가 같이 딸려 와서 첫 화면이 무거워진다(§6-29-z-18).
//
//   userColor(id)            사람마다 고정된 색 — 이름표·얼굴·판 목록 점이 같은 색이다
//   facesFrom(states, me)    awareness 상태 → 머리줄 얼굴(나 먼저 · 같은 사람은 한 번)
//   versionLabel(v, oldest)  판 목록 뒷말 `2줄 추가 · 1줄 제거` / `처음 작성한 본문`
//   versionTime(at, now)     `오늘 오후 3:12` · `어제 오전 9:05` · `9월 25일 오후 3:12`
//   lineDiff(before, after)  고친 곳 보기의 줄 차이 [{ op: 'same'|'add'|'del', text }]
// ============================================================================

// 흰 글자를 얹는 색이다(이름표 · 얼굴 머리글자). **흰 글자와의 대비 4.5:1 이상**만 둔다 —
// 두 테마 모두 같은 색이 칠해지고 글자는 늘 흰색이라 테마마다 따로 고를 까닭이 없다.
// 대비는 tests/coedit가 잰다. 태그 색(--app-tag-*)을 쓰지 않는 까닭: 그쪽은 연한 바탕 +
// 진한 글자 짝이라 흰 글자를 얹을 수 없고, 다크에서는 바탕이 어두워져 커서 선이 묻힌다.
export const PALETTE = ['#2f6fb5', '#c0392b', '#1e7a46', '#8e44ad', '#b35c1e', '#0f766e', '#b0306a', '#5b55c9'];

// 같은 사람은 어느 기기·어느 창에서든 같은 색 — 사람 id(effective_uid)로 고른다.
// id가 없으면(게스트 · 아직 못 물은 순간) 이름으로 고른다.
export function userColor(key = '') {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// awareness.getStates()(Map<clientID, { user }>) → 얼굴 목록. **같은 사람이 창을 둘 열어도
// 얼굴은 하나**다(사람 id로 묶는다 — clientID는 창마다 다르다). 나는 맨 앞, 나머지는 먼저
// 들어온 차례(clientID 순이 아니라 Map에 들어온 차례 — 그 편이 얼굴이 덜 튄다).
export function facesFrom(states, myClientId) {
  const out = [];
  const seen = new Set();
  const push = (clientId, user) => {
    if (!user || !user.name) return;
    const key = user.id || `name:${user.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: user.name, color: user.color || userColor(user.id || user.name), me: clientId === myClientId });
  };
  const entries = states ? [...states.entries()] : [];
  const mine = entries.find(([id]) => id === myClientId);
  if (mine) push(mine[0], mine[1]?.user);
  for (const [id, st] of entries) if (id !== myClientId) push(id, st?.user);
  return out;
}

// 판 목록 뒷말. 0인 쪽은 뺀다(`2줄 추가`만) · 가장 오래된 판은 늘 `처음 작성한 본문`이다 —
// 그 판의 줄 수는 '세션 시작 글'과의 차이라 처음 쓴 사람에게는 뜻이 없다.
export function versionLabel(v, oldest = false) {
  if (oldest) return '처음 작성한 본문';
  const added = Number(v?.added) || 0;
  const removed = Number(v?.removed) || 0;
  return [added && `${added}줄 추가`, removed && `${removed}줄 제거`].filter(Boolean).join(' · ');
}

// 시각 — 로컬 날짜로 오늘·어제를 가른다(업무 마감과 같은 로컬 · HANDOFF §8 날짜)
const two = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export function versionTime(at, now = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const clock = `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${two(d.getMinutes())}`;
  const today = ymd(now);
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (ymd(d) === today) return `오늘 ${clock}`;
  if (ymd(d) === ymd(yest)) return `어제 ${clock}`;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${clock}` : `${d.getFullYear()}년 ${md} ${clock}`;
}

// 줄 차이 — 같은 앞·뒤를 걷고 가운데를 LCS로 가른다(core.lineDiffCounts와 같은 방식 · 셈이 같다).
// 가운데가 너무 크면(2000×2000 넘게) 뺀 줄을 모두 앞에, 더한 줄을 모두 뒤에 둔다 — 셈은
// 어림이지만 화면이 멈추지 않는다.
export function lineDiff(before, after) {
  const a = before ? String(before).split('\n') : [];
  const b = after ? String(after).split('\n') : [];
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const head = a.slice(0, s).map(text => ({ op: 'same', text }));
  const tail = a.slice(ea).map(text => ({ op: 'same', text }));
  const x = a.slice(s, ea), y = b.slice(s, eb);
  let mid;
  if (x.length * y.length > 4_000_000) {
    mid = [...x.map(text => ({ op: 'del', text })), ...y.map(text => ({ op: 'add', text }))];
  } else {
    // dp[i][j] = x[i..]와 y[j..]의 LCS 길이 — 앞에서부터 걸으며 같은 줄·뺀 줄·더한 줄을 고른다
    const n = x.length, m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    mid = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { mid.push({ op: 'same', text: x[i] }); i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { mid.push({ op: 'add', text: y[j] }); j++; }
      else { mid.push({ op: 'del', text: x[i] }); i++; }
    }
  }
  return [...head, ...mid, ...tail];
}

// 판 하나의 '고친 곳' = **바로 앞 판에서 이 판으로** 바뀐 줄(목록의 `N줄 추가 · M줄 제거`와 같은
// 것을 보여 준다). 가장 오래된 판은 빈 글에서. versions는 최신이 앞이다(목록 차례 그대로).
export function versionDiff(versions, index) {
  const v = versions?.[index];
  if (!v) return [];
  const prev = versions[index + 1];
  return lineDiff(prev ? prev.md : '', v.md);
}
