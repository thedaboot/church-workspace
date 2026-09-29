// ============================================================================
// 업무 본문 같이 쓰기 — **화면이 쓰는 순수 부분** (import 0 · tests/coedit가 노드에서 돌린다)
// ----------------------------------------------------------------------------
// 엔진(core.js·index.js)과 따로 둔 까닭: 이 함수들은 업무 창의 첫 조각에 실린다(얼굴 색·판 목록
// 글자). 엔진을 import하면 yjs가 같이 딸려 와서 첫 화면이 무거워진다(§6-29-z-18).
//
//   userColor(id)            사람마다 고정된 색 — 이름표·얼굴·판 목록 점이 같은 색이다
//   facesFrom(states, me)    awareness 상태 → 머리줄 얼굴(나 먼저 · 같은 사람은 한 번 · 수정 중인가 · 커서 줄)
//   presenceLabel(editors)   보기 화면 알약 `조해리님이 수정 중` · `조해리님 외 2명이 수정 중`
//   presenceInk(color)       그 알약의 물(색 12%)과 글자색 — 두 테마 모두 4.5:1 이상
//   versionLabel(v, oldest)  판 목록 뒷말 `2줄 추가 · 1줄 제거` / `처음 작성한 본문`
//   versionTime(at, now)     `오늘 오후 3:12` · `어제 오전 9:05` · `9월 25일 오후 3:12`
//   lineDiff(before, after)  고친 곳 보기의 줄 차이 [{ op: 'same'|'add'|'del', text }] — 고친 줄은 뺀 줄 → 더한 줄
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

// awareness.getStates()(Map<clientID, { user, editing, line }>) → 얼굴 목록. **같은 사람이 창을 둘 열어도
// 얼굴은 하나**다(사람 id로 묶는다 — clientID는 창마다 다르다). 나는 맨 앞, 나머지는 먼저
// 들어온 차례(clientID 순이 아니라 Map에 들어온 차례 — 그 편이 얼굴이 덜 튄다).
// `editing` — 그 사람의 창 중 하나라도 수정 화면이다. `line` — 수정 중인 창의 커서가 선 **마크다운 줄 번호**
// (쓰는 쪽 편집기가 재서 싣는다 · 엔진 core.caretLine). 보는 쪽은 편집기 없이 그 줄을 안다.
export function facesFrom(states, myClientId) {
  const out = [];
  const byKey = new Map();
  const push = (clientId, st) => {
    const user = st?.user;
    if (!user || !user.name) return;
    const key = user.id || `name:${user.name}`;
    const editing = st.editing === true;
    const line = editing && Number.isInteger(st.line) && st.line >= 0 ? st.line : null;
    const had = byKey.get(key);
    if (had) {
      if (editing && (!had.editing || had.line == null)) { had.editing = true; had.line = line ?? had.line; }
      return;
    }
    const face = { key, name: user.name, color: user.color || userColor(user.id || user.name), avatar: user.avatar || '',
      me: clientId === myClientId, editing, line };
    byKey.set(key, face);
    out.push(face);
  };
  const entries = states ? [...states.entries()] : [];
  const mine = entries.find(([id]) => id === myClientId);
  if (mine) push(mine[0], mine[1]);
  for (const [id, st] of entries) if (id !== myClientId) push(id, st);
  return out;
}

// 보기 화면 본문 위 알약 — 나 말고 수정 중인 사람. 한 사람이면 이름, 둘 넘으면 첫 사람 + 나머지 수.
export function presenceLabel(editors = []) {
  if (!editors.length) return '';
  const first = `${editors[0].name}님`;
  return editors.length === 1 ? `${first}이 수정 중` : `${first} 외 ${editors.length - 1}명이 수정 중`;
}

// 알약의 물과 글자색. 물은 그 사람 색 12%이고, 글자는 **그 물 위에서 4.5:1**이 될 때까지 라이트는 검정 쪽으로,
// 다크는 흰색 쪽으로 섞는다(같은 색 계열로 읽히게 — 회색 글자로 바꾸지 않는다).
// 표면 값은 index.css의 --app-surface(라이트 #fffdfc · 다크 #202020)와 한 쌍이다 — tests/coedit가 잰다.
export const SURFACE = { light: '#fffdfc', dark: '#202020' };
export const PILL_ALPHA = 0.12;
const rgbOf = (h) => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16));
const hexOf = (c) => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const luminance = (c) => c.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(a, b) {
  const [x, y] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export function presenceInk(color) {
  const c = rgbOf(/^#[0-9a-f]{6}$/i.test(color || '') ? color : PALETTE[0]);
  const on = (surface, toward) => {
    const bg = hexOf(mixRgb(rgbOf(surface), c, PILL_ALPHA));
    for (let k = 0; k <= 20; k++) {
      const ink = hexOf(mixRgb(c, toward, k / 20));
      if (contrast(ink, bg) >= 4.6) return { bg, ink };
    }
    return { bg, ink: hexOf(toward) };
  };
  const light = on(SURFACE.light, [0, 0, 0]);
  const dark = on(SURFACE.dark, [255, 255, 255]);
  return { bg: `${hexOf(c)}${Math.round(PILL_ALPHA * 255).toString(16).padStart(2, '0')}`, light: light.ink, dark: dark.ink, bgLight: light.bg, bgDark: dark.bg };
}

// 판 목록 뒷말. 0인 쪽은 뺀다(`2줄 추가`만) · `처음 작성한 본문`은 **기준 판**(0086 kind 'baseline' — 같이 쓰기 전부터
// 있던 본문)에만 붙인다. 예전에는 가장 오래된 판이면 늘 그 말이었는데, 이미 본문이 있던 업무를 처음 고친 사람의
// 판까지 '처음 작성'이 되었다(2026-09-29 두 사람 실측). 빈 업무에서 처음 쓴 판은 `N줄 추가`로 선다.
export function versionLabel(v) {
  if (v?.kind === 'baseline') return '처음 작성한 본문';
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
      // 고친 줄은 뺀 줄이 먼저다 — 고친 곳 보기가 줄을 본문처럼 그려서(형광펜·굵게) 서식만 바뀐 줄도
      // '옛 모양 → 새 모양' 한 쌍으로 읽힌다
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { mid.push({ op: 'del', text: x[i] }); i++; }
      else { mid.push({ op: 'add', text: y[j] }); j++; }
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
