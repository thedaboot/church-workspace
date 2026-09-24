// ============================================================================
// AI가 사람을 **누구를 싣고 어떻게 부르는가** — 순수 모듈(import 0) · 2026-09-25
// ----------------------------------------------------------------------------
// services/ai.js의 peopleContext가 이 파일을 쓴다. 노드에서 그대로 부를 수 있어야
// tests/logcheck·aictx가 검사한다(§3-5) — 그래서 supabase·스토어를 물지 않는다.
// 재료는 부르는 쪽이 넘긴다: 가입자(스토어 members — role_note·팀) + 명단 한 벌
// (worship.fetchRoster 모양 — people·groups·members·roles. 없으면 null이고 그래도 돈다).
//
// 사용자 결정(2026-09-25 · AI 감사의 물음 1·3·6·7·9·13):
//   · **직함은 role_note가 이긴다.** 연도 직분(people_roles)은 role_note에 직함이 하나도
//     없을 때만 채운다 — role_note가 예배팀장이면 연도 직분이 리더팀장이어도 예배팀장으로 부른다.
//   · **직함이 여럿이면 업무가 고른다.** 순 일이면 순장, 아니면 그 업무 팀의 직함
//     (찬양팀 업무 → 찬양팀장), 예배 전반이면 예배팀장, 그 밖에는 순 아닌 첫 직함.
//     직함이 하나뿐이면 그 직함이다(순장 하나뿐인 사람은 어디서든 순장님).
//   · 교역자는 '전도사님'(교역자님이 아니다) · 부장은 '부장님' — 직함 + 님.
//   · 순 자리는 팀 목록에 섞지 않고 따로 적는다(`순: TT순 순장`).
//   · 다듬기에 싣는 사람은 **가입자 중 글에 실제로 나온 사람만** — 이름 전체·이름 두
//     글자·표시명·표시명↔명단 이름(꽃님/강꽃님 …)으로 찾는다.
//
// **이름을 여기 적지 않는다**(ai.js 머리말과 같은 이유 — 공개 레포 · 개명). 표시명과 명단
// 이름의 짝은 people.profile_id로 잇는다(§6-26 — 이름으로 매칭하지 않는다).
// ============================================================================

// 연도 직분 → 직함 글자. roster.js의 ROLE_LABEL과 같은 값이다(그 파일은 supabase를 물어서
// 여기서 부를 수 없다 — 바꾸면 둘 다 고친다). '회장'은 role_note 쪽 글자(청년부 회장)를 따른다.
export const ROLE_TITLE = {
  director: '부장', president: '청년부 회장', treasurer: '총무',
  lead_sunjang: '리더순장', lead_team: '리더팀장',
};
export const PASTOR_TITLE = '전도사';
// 직함이 없는 가입자를 부르는 말 — HANDOFF §8: AI 문구는 '청년' 그대로다(2026-09-14)
export const PLAIN_CALL = '청년';

const uniq = (a) => [...new Set(a.filter(Boolean))];

// ── role_note → 직함과 맡은 일 ──────────────────────────────────────────────
// role_note는 사람이 쓰는 자유 텍스트다: '순장 · 찬양팀장' · '예배팀장 · 찬양팀 남자 싱어' ·
// '총무 · 회계 · 찬양팀 여자 싱어' · '청년부 회장 · 여러 팀을 섬기는 팀원' · '전도사 · 담당 교역자'.
// **직함**은 부를 때 이름 뒤에 붙는 말이고(끝이 ~장·총무·회계·전도사…, 두 낱말까지),
// 나머지(싱어·일렉·팀원·담당 교역자)는 **맡은 일**이다. 괄호 속 직함도 읽는다 —
// 옛 글 '담당 교역자(전도사님)'가 그 모양이었다. 뒤에 붙은 '님'은 뗀다('부장님' → '부장').
// '교역자'는 직함으로 안 본다 — 사용자 결정: 교역자는 사실이지만 부르는 말은 '전도사님'.
const TITLE_TAIL = /(장|총무|회계|서기|전도사|목사|강도사|간사)$/;
function asTitle(s) {
  const clean = String(s || '').trim().replace(/님$/, '').trim();
  if (!clean) return '';
  const words = clean.split(/\s+/);
  if (words.length > 2 || !TITLE_TAIL.test(words[words.length - 1])) return '';
  return clean;
}
export function splitRoleNote(note) {
  const titles = [];
  const notes = [];
  for (const raw of String(note || '').split(/\s*[·,/]\s*/)) {
    const seg = raw.trim();
    if (!seg) continue;
    const head = seg.replace(/\([^)]*\)/g, '').trim();
    const t = asTitle(head);
    if (t) titles.push(t);
    else if (head) notes.push(seg);
    for (const m of seg.matchAll(/\(([^)]*)\)/g)) titles.push(asTitle(m[1]));
  }
  return { titles: uniq(titles), notes };
}

// 이 사람의 직함들 — **role_note가 먼저**, 비었을 때만 명단(교역자·연도 직분)이 채운다.
export function titlesOf(member, info = null) {
  const { titles, notes } = splitRoleNote(member?.role);
  if (titles.length) return { titles, notes };
  const fill = [];
  if (info?.isPastor) fill.push(PASTOR_TITLE);
  for (const r of info?.roles || []) fill.push(ROLE_TITLE[r]);
  return { titles: uniq(fill), notes };
}

// ── 업무가 어떤 자리인가 ────────────────────────────────────────────────────
export const isSunTitle = (t) => /순장$/.test(String(t || '').replace(/\s+/g, ''));
// 순 일의 신호는 두 세기다.
//   · 센 신호 — 담당 팀에 순장·순원이 있거나 **제목**이 순을 말한다('순별 양육 미수료자').
//   · 약한 신호 — 본문이 순을 **세 번 이상** 말한다. 한두 번은 곁가지다: 라이브 카드에서 수련회
//     피드백의 '## 순장 피드백' 한 도막, 워크스페이스 개선 카드의 '순장 권한' 같은 기능 이름이 그랬다
//     (2026-09-25 · 84장 중 본문에만 순이 나오는 카드 9장이 전부 1~3번).
//     약한 신호는 **업무 팀의 직함이 없을 때만** 순장을 고른다(pickTitle).
// '리더순장'은 직함이라 걷고 센다(리더 모임 참석자 줄에 적힌다). 순 이름(TT순·선착순…)은
// 신호로 쓰지 않는다 — '선착순 20명'처럼 흔한 말과 겹친다.
const SUN_WORDS = /순모임|순원|순장|순별|순\s?편성|순\s?배정|순\s?나눔|내\s순|각\s순|우리\s순|순\s모임/g;
const sunCount = (s) => (String(s || '').replace(/리더\s?순장/g, '').match(SUN_WORDS) || []).length;
export const SUN_TEXT_MIN = 3;
export function isSunTask({ teams = [], title = '' } = {}) {
  if ((teams || []).some(t => t === '순장' || t === '순원')) return true;
  return sunCount(title) > 0;
}
export const isSunText = ({ text = '' } = {}) => sunCount(text) >= SUN_TEXT_MIN;
// 예배 전반의 일 — 예배를 세우는 팀이 둘 이상 걸렸거나 제목이 예배를 말한다
const WORSHIP_TEAMS = ['찬양팀', '엔지니어팀', '워십팀'];
export const isWorshipTask = ({ teams = [], title = '' } = {}) =>
  (teams || []).filter(t => WORSHIP_TEAMS.includes(t)).length >= 2 || /예배/.test(String(title || ''));

export function taskScope(task = {}, text = '') {
  const t = { teams: task.teams || [], title: task.title || '', text: text || task.content || '' };
  return { teams: t.teams, sun: isSunTask(t), sunText: isSunText(t), worship: isWorshipTask(t) };
}

// 직함 고르기(결정 3). 차례가 곧 규칙이다:
//   센 순 신호 → 순장 · 업무 팀의 직함 · 약한 순 신호 → 순장 · 예배 전반 → 예배팀장 · 순 아닌 첫 직함.
export function pickTitle(titles = [], scope = {}) {
  if (!titles.length) return '';
  const sunT = titles.filter(isSunTitle);
  const other = titles.filter(t => !isSunTitle(t));
  if (scope.sun && sunT.length) return sunT[0];
  for (const team of scope.teams || []) {
    const hit = other.find(t => t.replace(/\s+/g, '').startsWith(team));
    if (hit) return hit;
  }
  if (scope.sunText && sunT.length) return sunT[0];
  if (scope.worship) {
    const w = other.find(t => t.includes('예배팀장'));
    if (w) return w;
  }
  return other[0] || titles[0];
}

export const callName = (name, title) => (title ? `${name} ${title}님` : `${name} ${PLAIN_CALL}`);

// ── 명단 한 벌 → 가입자 이름별 정보 ─────────────────────────────────────────
// { 표시명 → { rosterName, isPastor, roles:[code], sun:'TT순 순장' } }. 명단이 없으면 빈 Map.
export function rosterIndex(roster, members = []) {
  const out = new Map();
  const people = roster?.people || [];
  if (!people.length) return out;
  const byProfile = new Map(people.filter(p => p?.profile_id).map(p => [p.profile_id, p]));
  const rolesBy = new Map();
  for (const r of roster.roles || []) {
    if (!r?.person_id || !r?.role) continue;
    rolesBy.set(r.person_id, [...(rolesBy.get(r.person_id) || []), r.role]);
  }
  const sunOf = new Map();
  for (const g of roster.groups || []) {
    if (g?.type && g.type !== 'sun') continue;
    if (g.leader_person_id) sunOf.set(g.leader_person_id, `${g.name} 순장`);
  }
  const groupName = new Map((roster.groups || []).map(g => [g.id, g.name]));
  for (const m of roster.members || []) {
    if (!sunOf.has(m.person_id) && groupName.has(m.group_id)) sunOf.set(m.person_id, `${groupName.get(m.group_id)} 순원`);
  }
  for (const mem of members) {
    const p = byProfile.get(mem.id);
    if (!p) continue;
    out.set(mem.name, {
      rosterName: String(p.roster_name || p.name || '').trim(),
      isPastor: !!p.is_pastor,
      roles: rolesBy.get(p.id) || [],
      sun: sunOf.get(p.id) || '',
    });
  }
  return out;
}

// ── 글에 나온 가입자 찾기(결정 13) ──────────────────────────────────────────
// 열쇠: 표시명 · 명단 이름 · 이름 두 글자(세 글자 한글 이름의 뒤 두 글자).
//  · 세 글자 이상 한글 열쇠 — 앞이 한글이 아니면 걸린다(홍길동님 · @홍길동 — 다른 이름 속의 '홍길동'은 아니다).
//  · 두 글자 열쇠 — 앞이 한글이 아니고, 뒤가 끝·공백·문장부호이거나 사람에게 붙는 말
//    (형제·자매·님·청년·조사·'순' — 'OO순'은 그 사람이 순장인 순)일 때만. '### 길동' · '운전자(길동)' ·
//    'OO순(TT순)' · 'OO이가'가 걸리고, 두 이름을 띄어 쓰지 않고 붙인 것은 못 잡는다(놓치는 쪽을 골랐다).
//  · **흔한 낱말과 같은 두 글자**(COMMON)는 사람 자리일 때만 — '@시온' · '(시온)' · 사람에게만 붙는 말
//    (형제·님·이가·한테…)이 뒤따를 때. '시온의 영광'은 찬양 가사다.
const NAME_TAIL = '(?:형제|자매|님|씨|청년|팀장|순장|이가|이는|이랑|이한테|이도|이와|이의|이에게|이께|이네|이|가|는|랑|한테|도|와|과|에게|께|순|아|야|은|을|를|의)';
const PERSON_TAIL = '(?:\\s?(?:형제|자매|님|씨|청년|팀장|순장)|이가|이랑|이한테|이에게|랑|한테|에게|께서)';
// 지금 가입자 가운데 걸리는 것은 '시온' 하나다. 나머지는 명단에 있는 이름(현재·미정·유지·성령)이거나
// 흔한 교회 말이다 — 그 사람이 가입하는 날 바로 틀리지 않게 미리 둔다.
export const COMMON_GIVEN = new Set(['시온', '현재', '미정', '유지', '성령', '은혜', '하늘', '소망', '사랑', '기쁨', '평강', '한결']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HANGUL_ONLY = /^[가-힣]+$/;

function keysOf(member, info) {
  const keys = new Set([member.name]);
  const roster = info?.rosterName;
  if (roster) keys.add(roster);
  // 두 글자 이름은 **실명**에서만 뗀다 — 표시명은 별명일 수 있다(현민스 → '민스'는 사람 이름이 아니다).
  // 명단이 없으면 표시명이 곧 실명이라고 보고 뗀다.
  const real = roster || member.name;
  const hangul = (String(real).match(/[가-힣]+/) || [''])[0];
  if (hangul.length === 3) keys.add(hangul.slice(1));
  return [...keys].filter(Boolean);
}

export function hitsName(text, key) {
  const s = String(text || '');
  if (!key || !s.includes(key)) return false;
  if (!HANGUL_ONLY.test(key)) return s.includes(key);          // 'Alex'가 붙은 표시명 같은 것
  if (key.length >= 3) return new RegExp(`(?<![가-힣])${esc(key)}`).test(s);
  const k = esc(key);
  // 흔한 낱말이면 사람 자리로만 읽는다: '@시온' · '(시온)' · '시온 형제'·'시온이가'. '시온의 영광'은 아니다.
  if (COMMON_GIVEN.has(key)) return new RegExp(`(?<=@)${k}|\\(${k}\\)|(?<![가-힣])${k}${PERSON_TAIL}`).test(s);
  return new RegExp(`(?<![가-힣])${k}(?:${NAME_TAIL}|(?![가-힣]))`).test(s);
}

// 글에 나온 가입자의 표시명 Set
export function mentionedMembers(text, members = [], index = new Map()) {
  const out = new Set();
  const s = String(text || '');
  if (!s.trim()) return out;
  for (const m of members) {
    if (keysOf(m, index.get(m.name)).some(k => hitsName(s, k))) out.add(m.name);
  }
  return out;
}

// ── 사람 한 줄 ──────────────────────────────────────────────────────────────
// `노준석 | 팀: 찬양팀 | 순: TT순 순장 | 부를 때: 노준석 찬양팀장님 | 멘션은 @노준석`
// 순장·순원은 팀 목록에서 빼고 '순:' 칸에 적는다(결정 9). 명단 이름이 표시명과 다르면
// 괄호로 붙인다 — 원문에 명단 이름('배현민')으로 적혀 있어도 모델이 같은 사람인 줄 안다.
const SUN_TEAMS = new Set(['순장', '순원']);
export function personLine(member, { info = null, scope = {}, withMention = false } = {}) {
  const teams = (member.teams?.length ? member.teams : [member.team]).filter(Boolean);
  const work = teams.filter(t => !SUN_TEAMS.has(t));
  const sun = info?.sun || (teams.includes('순장') ? '순장' : (teams.includes('순원') ? '순원' : ''));
  const { titles, notes } = titlesOf(member, info);
  const title = pickTitle(titles, scope);
  const alias = info?.rosterName && info.rosterName !== member.name ? `(명단 이름 ${info.rosterName})` : '';
  return [
    `${member.name}${alias}`,
    `팀: ${work.length ? work.join('·') : '미지정'}`,
    sun ? `순: ${sun}` : '',
    `부를 때: ${callName(member.name, title)}`,
    notes.length ? `맡은 일: ${notes.join(' · ')}` : '',
    withMention ? `멘션은 @${member.name}` : '',
  ].filter(Boolean).join(' | ');
}
