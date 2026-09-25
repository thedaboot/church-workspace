import { isTemplateOnly } from './noteTemplate.js';

// ============================================================================
// 주보를 **보여 주는 쪽**의 순수 규칙 — 본명 · 찬양 줄 · 스토리 장 나누기 · 내 노트 목록
// ----------------------------------------------------------------------------
// 저장 모양은 하나도 바꾸지 않는다. 여기 있는 것은 전부 "이미 있는 값을 어떻게 세우나"다.
// import는 순수 모듈(noteTemplate.js) 하나뿐이라 노드(tests/logcheck)에서 그대로 부른다.
// ============================================================================

// ── 명단 본명 (사용자 결정 2026-09-25) ─────────────────────────────────────
// 주보(종이·상세의 섬기는 이·찬양 인도·다음 주 위원)와 스토리에서는 **계정 표시 이름 대신
// 연결된 명단의 본명**을 쓴다('이하랑Alex' → '이하랑', '꽃님' → '강꽃님'). 주보는 새가족도
// 보는 공식 문서라 본인이 정한 별명보다 이름이 맞다.
//
// **보이는 자리에서만 바꾼다.** 주보에 저장된 이름(`roles[].name`)은 그 순간의 계정 표시
// 이름이고(라이브 9/20: '이하랑Alex'·'꽃님' + personId) 그대로 둔다 — 편집 줄의 이름 칸도
// 그 글자 그대로다. HANDOFF §8의 '이름·사진은 명단↔계정을 잇지 않는다'(한쪽으로 덮으면
// 사용자가 정한 이름이 사라진다)와 부딪히지 않는다: 어느 쪽 값도 덮지 않고 **읽을 때 고를 뿐**이다.
//
// 재료는 fetchPeople의 모양이다 — 계정이 이어진 사람은 `name`이 계정 표시 이름이고 명단에 적힌
// 이름은 `roster_name`에 있다(people.js withDisplayName). personId가 있으면 id로 찾고, 이름만
// 있는 자리(찬양 인도자 · 광고 글)는 표시 이름·본명 둘 다 열쇠로 찾는다. **못 찾으면 적힌 글자
// 그대로**다(객원 강사처럼 명단에 없는 이름 — 지어내지 않는다).
export function realNameOf(people = []) {
  const byId = new Map();
  const byName = new Map();
  for (const p of people || []) {
    if (!p?.id) continue;
    const real = String(p.roster_name || p.name || '').trim();
    if (!real) continue;
    byId.set(p.id, real);
    for (const k of [p.name, p.roster_name]) {
      const key = String(k || '').trim();
      if (key && !byName.has(key)) byName.set(key, real);
    }
  }
  return (name, personId = null) => {
    const hit = (personId && byId.get(personId)) || byName.get(String(name || '').trim());
    return hit ? { name: hit, found: true } : { name: String(name || '').trim(), found: false };
  };
}

// 광고 '다음 주 예배 위원'의 한 줄 `대표기도: 이수빈 형제`에서 이름만 본명으로 바꾼다.
// 호칭은 적힌 그대로 둔다(광고는 사람이 쓴 글이다 — 호칭까지 새로 붙이지 않는다).
// 이름 칸은 `이름` 또는 `이름 호칭` 둘 중 하나로 본다: 통째로 명단에 있으면 그것, 아니면 마지막
// 띄어쓰기 앞까지를 이름으로 본다. 명단에 없으면 그 줄은 한 글자도 안 바뀐다.
const ROLE_LINE = /^(\s*[-*·•‧・]?\s*)(.{2,10}?)(\s*(?:[:：]|[-–—])\s*)(.+?)\s*$/;
// 이름 칸 하나(`이수빈 형제` · `꽃님`) → 본명으로 바꾼 글자. 명단에 없으면 그대로.
export function realNameText(value, real) {
  const v = String(value || '').trim();
  if (!v || typeof real !== 'function') return v;
  const whole = real(v);
  if (whole.found) return whole.name;
  const cut = v.lastIndexOf(' ');
  if (cut <= 0) return v;
  const head = real(v.slice(0, cut));
  return head.found ? `${head.name}${v.slice(cut)}` : v;
}
export function realNamesInRoleLines(body, real) {
  if (typeof real !== 'function') return String(body || '');
  return String(body || '').split('\n').map((line) => {
    const m = ROLE_LINE.exec(line);
    if (!m) return line;
    const next = realNameText(m[4], real);
    return next === m[4] ? line : `${m[1]}${m[2]}${m[3]}${next}`;
  }).join('\n');
}

// 광고 제목이 '다음 주 예배 위원'인가 — 띄어쓰기를 접어 견준다(worship.prefillRoles와 같은 열쇠)
export const isNextWeekNotice = (n) => String(n?.title || '').replace(/\s+/g, '').includes('다음주예배위원');

// 그 광고의 줄들 → [{ role, value }] (스토리 마지막 장). 모양이 아닌 줄은 버린다.
export function nextWeekRoles(notices = []) {
  const n = (notices || []).find(isNextWeekNotice);
  if (!n) return [];
  return String(n.body || '').split('\n').map(l => ROLE_LINE.exec(l)).filter(Boolean)
    .map(m => ({ role: m[2].trim(), value: m[4].trim() })).filter(r => r.role && r.value);
}

// ── 찬양 줄 — 팀과 제목 (사용자 결정 2026-09-25) ────────────────────────────
// 곡 제목이 `팀 - 제목` 모양이면(**첫 ` - `** 기준) 팀과 제목을 나눠 보여 준다. 유튜브에서 가져온
// 제목이 대개 그 모양이다(라이브 9/13·9/20 열 곡). 아니면 **제목 한 줄 그대로**다 — 라이브에는
// `제목 | 팀`·`제목ㅣ팀`·`제목 l 팀`도 있는데(9/6) 어느 쪽이 팀인지 글자만으로는 모른다.
// 지어내서 나누지 않는다. 앞뒤 어느 한쪽이라도 비면 나누지 않는다.
export function splitSongTitle(title) {
  const s = String(title || '').trim();
  const i = s.indexOf(' - ');
  if (i <= 0) return { team: '', title: s };
  const team = s.slice(0, i).trim();
  const rest = s.slice(i + 3).trim();
  return team && rest ? { team, title: rest } : { team: '', title: s };
}

// ── 스토리 장 나누기 ────────────────────────────────────────────────────────
// 잰 높이들 → 장마다 들어갈 [시작, 끝) 목록. 앞에서부터 채우고 넘치면 다음 장이다.
// **혼자서 한 장을 넘는 항목은 그 장을 혼자 쓴다**(그 장 안에서만 세로로 내린다 — 목업 판단).
// 높이를 아직 못 쟀으면(avail ≤ 0) 한 장에 다 싣는다(첫 프레임).
export function packPages(heights = [], avail = 0, gap = 0) {
  if (!heights.length) return [];
  if (!(avail > 0)) return [[0, heights.length]];
  const pages = [];
  let start = 0;
  let used = 0;
  heights.forEach((h, i) => {
    if (i === start) { used = h; return; }
    if (used + gap + h <= avail) { used += gap + h; return; }
    pages.push([start, i]);
    start = i; used = h;
  });
  pages.push([start, heights.length]);
  return pages;
}

// 스토리 광고 장에 설 광고 — **내용이 있는 것만**(제목만 있는 광고는 종이가 싣는다) ·
// '다음 주 예배 위원'은 마지막 장으로 옮겨 가므로 여기서 뺀다.
export const storyNotices = (notices = []) => (notices || [])
  .filter(n => String(n?.body || '').trim() && !isNextWeekNotice(n));

// ── 내 예배 노트 모아 보기 (2026-09-25) ────────────────────────────────────
// 내 노트 행 + 주보 목록 → [{ service, note }] — **쓴 것만**(빈 노트·손대지 않은 템플릿은
// 뺀다 · isTemplateOnly), 주보가 목록에 없는 노트도 뺀다(지워진 주보 · 발행 전으로 돌아간 주보),
// 최근 예배가 앞이다. 노트 행은 이미 **내 것만** 온다(worship.fetchMyNotes가 profile_id로 거른다).
export function myNoteRows(notes = [], services = []) {
  const byId = new Map((services || []).map(s => [s?.id, s]));
  return (notes || [])
    .map(n => ({ note: n, service: byId.get(n?.service_id) }))
    .filter(r => r.service && String(r.note?.body || '').trim() && !isTemplateOnly(r.note.body, r.service.passage_ref || ''))
    .sort((a, b) => String(b.service.service_date || '').localeCompare(String(a.service.service_date || '')));
}
