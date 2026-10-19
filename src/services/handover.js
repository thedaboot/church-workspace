// ============================================================================
// 인수인계 · 졸업 · 직분 묶음의 순수 규칙 (시안 2026-10-16 · 실제 붙이기 v5 1묶음 C 2026-10-17)
// ----------------------------------------------------------------------------
// **import가 없다** — 노드에서 그대로 들여 검사한다(tests/logcheck-v2 '인수인계' 블록).
// 저장 자리(클라우드 0109 · 게스트 localStorage·씨앗)는 services/handoverStore.js, 화면은 components/handover.jsx.
// 짝·졸업·인계 묶기는 화면(useHandoverModel)과 마스터의 목록 내리기(handoverStore.cloudSync)가 같은 함수를 부른다.
//
// 직분 줄의 묶음(사용자 요청 "기존 직분들 정렬도 구분되게" · 2026-10-16 순서 확정):
//   교역자  |  부장  |  임원 — 회장·총무·리더순장(·리더팀장)  |  팀장(팀 하나)  |  비전 메이커
// 리더팀장(lead_team)은 지우지 않는다 — **2027부터 고르는 줄에 안 서고**(사용자 결정) 지난해 줄은 그대로다.
// 그 해에 이미 리더팀장 줄이 있는 사람에게는 칩이 남는다(풀 길이 있어야 한다).
//
// 팀장(team_lead)은 people_roles의 team_lead + team 칸이다(0107 · 팀장은 리더진 — is_leader()).
//
// 졸업: **1월 1일 한국 나이 31세**(나이 = 해 − 태어난 해 + 1 · 2027 졸업 = 1997년생). 앱은 그대로 쓴다 —
// 그 해 명단에 '졸업' 표시만 붙는다(권한 변화 없음). 태어난 연도는 people.birth_year(0107).
// ============================================================================

export const LEAD_TEAM_LAST_YEAR = 2026;   // 리더팀장을 고를 수 있는 마지막 해
export const GRAD_AGE = 31;
export const TEAM_LEAD = 'team_lead';
// 예배팀장(0107 · 사용자 결정 2026-10-17) — 팀 칸 없는 직분 하나 · 리더진 · 특정 팀의 팀장이 아니라 소속 겹침 막기에 안 걸린다
export const WORSHIP_LEAD = 'worship_lead';

// 고르는 줄에서 빠지는 해 — 이 표 한 곳이 정한다(리더팀장 · 예배팀장 모두 2027부터 안 선다 · 사용자 결정 2026-10-16 · 10-17).
// 그 해 줄이 이미 있는 사람에게는 칩이 남는다(풀 길이 있어야 한다) · 지난해 줄(기록)은 그대로 보인다.
export const LAST_OFFERED_YEAR = { lead_team: LEAD_TEAM_LAST_YEAR, [WORSHIP_LEAD]: 2026 };

// 칩 묶음 — 'pastor'는 연도와 무관한 명단 속성(is_pastor)이고 나머지는 people_roles 값이다
export const ROLE_GROUPS = [
  ['pastor'],
  ['director'],
  ['president', 'treasurer', 'lead_sunjang', 'lead_team'],
  [TEAM_LEAD, WORSHIP_LEAD],
  ['vision_maker'],
];

// 그 해 고르는 줄에 설 칩(묶음 모양 그대로). held = 그 사람이 그 해 이미 가진 값(Set)
export function rolesOffered(year, held = new Set()) {
  return ROLE_GROUPS.map(g => g.filter(r => !(r in LAST_OFFERED_YEAR) || Number(year) <= LAST_OFFERED_YEAR[r] || held.has(r)));
}

// ── 자리 겹침(사용자 결정 2026-10-16) ─────────────────────────────────────
// 순장은 순원일 수 없고(어느 순이든 — 소속 칩 '순장'·'순원'은 한 사람에게 하나), 팀장은 그 팀의 팀원일 수 없다
// (소속 칩의 그 팀). 화면은 겹치는 칩을 비활성으로 두고(안내 줄 없음), 저장 길(roster.js)도 같은 판정으로 막고 DB 트리거(0107)가 한 번 더 막는다.
const SUN_PAIR = { '순장': '순원', '순원': '순장' };
// 소속 칩 중 지금 고를 수 없는 것 — teams = 그 사람의 소속 · ledTeam = 그 해 팀장인 팀(없으면 null)
export function blockedSeats(teams = [], ledTeam = null) {
  const out = new Set();
  for (const t of teams) if (SUN_PAIR[t]) out.add(SUN_PAIR[t]);
  if (ledTeam) out.add(ledTeam);
  return out;
}
// 팀장으로 고를 수 없는 팀 — 이미 그 팀의 팀원(소속)인 팀
export const blockedLeadTeams = (teams = []) => new Set(teams.filter(t => t.endsWith('팀')));
// **겹침은 그해부터 본다**(사용자 결정 2026-10-17): 소속(people.teams)은 '지금'이라, 다음 해 팀장은 지금 그 팀 팀원이어도 고를 수 있다 —
// 1월 1일 적용 단계(0109 apply_handovers)가 그 사람을 그 팀 소속에서 빼고 기록한다. 그해 또는 지난해 줄만 막는다.
export const seatYearApplies = (year, nowYear) => Number(year) <= Number(nowYear);
export const leadTeamsBlocked = (teams = [], year, nowYear) => (seatYearApplies(year, nowYear) ? blockedLeadTeams(teams) : new Set());
// 저장해도 되나 — 순장·순원을 같이 들었거나 이끄는 팀을 소속으로도 들었으면 false
export const seatsValid = (teams = [], ledTeam = null) =>
  !(teams.includes('순장') && teams.includes('순원')) && !(ledTeam && teams.includes(ledTeam));

// ── 졸업 ────────────────────────────────────────────────────────────────────
export const koreanAge = (birthYear, year) => (Number(birthYear) ? Number(year) - Number(birthYear) + 1 : null);
export const isGraduateYear = (birthYear, year) => koreanAge(birthYear, year) === GRAD_AGE;

// 그 해 1월 1일에 졸업하는 사람(환송한 사람 제외 · 이름순)
export function graduatesOf(people, year) {
  return (people || [])
    .filter(p => p && !p.removed_at && isGraduateYear(p.birth_year, year))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
}

// ── 직분 짝 ─────────────────────────────────────────────────────────────────
// 자리(slot) = 직분 값, 팀장만 팀까지(`team_lead:찬양팀`). 2026 총무 → 2027 총무, 찬양팀장 → 찬양팀장.
export const slotOf = (r) => (r.role === TEAM_LEAD ? `${TEAM_LEAD}:${r.team || ''}` : r.role);
const SLOT_ORDER = ROLE_GROUPS.flat();
const slotRank = (slot) => {
  const [role, team = ''] = slot.split(':');
  return [SLOT_ORDER.indexOf(role), team];
};
// 팀장끼리는 팀 순서(teamOrder — 부르는 쪽이 config 팀 순서를 준다 · 없는 팀은 뒤에 가나다)
const bySlot = (teamOrder) => (a, b) => {
  const [ra, ta] = slotRank(a); const [rb, tb] = slotRank(b);
  const ix = (t) => { const i = teamOrder.indexOf(t); return i < 0 ? 999 : i; };
  return (ra - rb) || (ix(ta) - ix(tb)) || ta.localeCompare(tb, 'ko');
};

// 직분 짝을 맞춘다. 나가는 사람마다 한 줄 — 같은 자리의 새 사람(여럿이면 첫째)이 기본값이고
// overrides[key]로 고친다(null = 받는 사람 미정). 새 해에만 있는 자리는 from 없이 한 줄(새로 맡음).
//   kind: 'pass' 넘김 · 'same' 그대로(같은 사람) · 'open' 받는 사람 미정 · 'new' 새로 맡음 · 'drop' 사라질 직분(인계 없음)
// 사라질 직분(사용자 승인 목업 ⑥ 2026-10-19): ① toYear에 고르는 줄에서 빠지는 직분(LAST_OFFERED_YEAR — 리더팀장·예배팀장)은
// 받는 사람이 없으면 저절로 'drop' ② 어느 직분이든 인수자 메뉴의 '직분 제거'(overrides[key] = DROP_SEAT)도 'drop'.
// 'drop'에 사람을 고르면 다시 'pass'(하던 일을 넘길 사람이 있을 때). 'drop'은 buildHandovers가 인계 건을 만들지 않는다.
export const DROP_SEAT = '-';
const endsBy = (slot, toYear) => {
  const role = slot.split(':')[0];
  return !!toYear && role in LAST_OFFERED_YEAR && Number(toYear) > LAST_OFFERED_YEAR[role];
};
export function pairRoles(oldRoles = [], newRoles = [], overrides = {}, teamOrder = [], { toYear = null } = {}) {
  const olds = new Map(); const news = new Map();
  for (const r of oldRoles) { const s = slotOf(r); olds.set(s, [...(olds.get(s) || []), r.person_id]); }
  for (const r of newRoles) { const s = slotOf(r); news.set(s, [...(news.get(s) || []), r.person_id]); }
  const out = [];
  for (const slot of [...new Set([...olds.keys(), ...news.keys()])].sort(bySlot(teamOrder))) {
    const from = olds.get(slot) || [];
    const to = news.get(slot) || [];
    if (!from.length) {
      for (const t of to) out.push({ key: `${slot}>${t}`, slot, from: null, to: t, kind: 'new' });
      continue;
    }
    from.forEach((f, i) => {
      const key = `${slot}<${f}`;
      const auto = to[i] ?? to[0] ?? null;
      const t = key in overrides ? overrides[key] : auto;
      const drop = t === DROP_SEAT || (!t && !(key in overrides) && endsBy(slot, toYear));
      out.push({ key, slot, from: f, to: drop ? null : (t ?? null), auto, kind: drop ? 'drop' : !t ? 'open' : t === f ? 'same' : 'pass' });
    });
  }
  return out;
}

// 인계 한 건 = (나가는 사람, 받는 사람) 한 쌍. 직분 넘김과 졸업이 같은 쌍이면 한 건으로 합친다
// (총무를 넘기며 졸업하는 사람이 같은 사람에게 두 번 쓰지 않게). 그대로·새로 맡음은 인계가 아니다.
//   grads   확정한 졸업자 id 배열 · gradTo  { [졸업자 id]: 받는 사람 id } — 없으면 그 사람의 직분 짝을 따른다
export function buildHandovers(pairs = [], grads = [], gradTo = {}) {
  const items = new Map();
  const add = (from, to, label) => {
    const id = `${from}>${to || ''}`;
    const it = items.get(id) || { id, from, to: to || null, slots: [], graduate: false };
    if (label === 'graduate') it.graduate = true; else it.slots.push(label);
    items.set(id, it);
  };
  for (const p of pairs) if (p.from && (p.kind === 'pass' || p.kind === 'open')) add(p.from, p.to, p.slot);
  for (const g of grads) {
    const own = pairs.find(p => p.from === g && (p.kind === 'pass' || p.kind === 'open'));
    const to = g in gradTo ? gradTo[g] : (own?.to ?? null);
    add(g, to, 'graduate');
  }
  return [...items.values()];
}

// ── 업무 ────────────────────────────────────────────────────────────────────
const DONE = '완료';
// 넘길 수 있는 업무 — 그 사람이 담당자이고 아직 안 끝난 것(상시 포함)
export const openTasksOf = (tasks, name) =>
  (tasks || []).filter(t => t && t.status !== DONE && (t.assignees || []).includes(name));

// 담당자에서 나가는 사람을 받는 사람으로 바꾼다(이미 있으면 빼기만 · 순서 유지)
export function passAssignees(assignees = [], fromName, toName) {
  const out = [];
  for (const a of assignees) {
    const v = a === fromName ? toName : a;
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// ── 클라우드 줄(0109 handovers) → 화면 모양 ─────────────────────────────────
// notes[아이템 id] = { note, taskIds, done, rowId } · seen[아이템 id] · applied(다음 해 줄이 적용됐으면 { at, items, moves }) ·
// fixedItems(지금 목록에 있는 줄 전부 — 마스터가 아닌 사람의 홈 카드가 본다). 아이템 id는 buildHandovers와 같은 `넘기는>받는`.
export function handoverRowsView(rows = [], toYear) {
  const key = (r) => `${r.from_person}>${r.to_person || ''}`;
  const live = (rows || []).filter(r => r && r.active);
  const notes = {}; const seen = {};
  for (const r of rows || []) {
    if (!r) continue;
    const id = key(r);
    if (r.year === toYear || !notes[id]) notes[id] = { note: r.note || '', taskIds: r.task_ids || [], done: !!r.written_at, rowId: r.id };
    if (r.seen_at) seen[id] = true;
  }
  const toItem = (r) => ({ id: key(r), from: r.from_person, to: r.to_person || null, slots: r.slots || [],
    graduate: !!r.graduate, year: r.year, appliedAt: r.applied_at || null });
  const next = live.filter(r => r.year === toYear);
  const done = next.filter(r => r.applied_at);
  const applied = done.length ? { at: done[0].applied_at, items: next.map(toItem), moves: next.flatMap(r => r.moves || []) } : null;
  return { notes, seen, applied, fixedItems: live.map(toItem) };
}
