import { supabase } from './supabaseClient.js';
import { generateId } from '../utils.js';
import { kstToday } from './roster.js';
import { guestStore } from './people.js';
import { demoOn } from './opsDemo.js';

// ============================================================================
// 새가족 정착 카드 — 모임 > '새가족' 탭(v5 4묶음 · 사용자 승인 시안 mock/b5 2026-10-21 · 0120)
// ----------------------------------------------------------------------------
// 칸(stage)은 그 사람이 **마지막으로 마친 일**이고 칸 이름 = 그 칸으로 옮기는 버튼 이름이다('OO 완료' · 사용자 결정):
//   첫 방문 완료 → 재방문 완료 → 컨택 완료 → 등록 완료 → 교육 완료(새신자 교육 · 여러 회) → 배정 완료 → 정착 완료.
//   보류는 칸이 아니라 보드 위 한 줄(업무 보드의 상시 줄과 같은 자리). 단계는 손으로 아무 칸으로나 옮긴다("아닐 수도 있어").
//
// **사람과 순은 명단·순 편성의 것을 그대로 쓴다**(사용자 2026-10-21 — "기존 DB와의 정합성").
//   · 새신자 등록 = 청년 명단(people)에 한 줄 + newcomer_at(0119). 카드는 그 사람의 id(person_id)만 든다.
//   · 순 배정 = 순 편성과 같은 칸(group_members). 카드는 순 이름을 적지 않는다 — 보여 줄 순은 언제나 group_members에서 읽는다.
//   · 등록 전 카드는 명단에 없다 — 등록 완료 칸부터 뒤로 옮기면 먼저 등록한다(welcomeBoard move).
//   클라우드에서는 둘 다 **정의자 함수**다(0120 welcome_register · welcome_assign_sun) — 웰컴팀은 people·group_members를
//   직접 쓸 권한이 없다(0035·0045). 함수 안에서 can_see_welcome()을 다시 본다.
//   새가족 QR 화면은 로그인이 없다 → submit_welcome_card(0120 · anon · 길이·형식 · 10분 30장).
//
// 쓰기는 **먼저 화면에 선다**(카드 한 벌을 여기서 들고 고친 뒤 DB로 — 실패하면 다시 읽어 서버 모양으로 되돌리고 throw).
// 부르는 쪽(welcomeBoard)이 실패 토스트를 띄운다.
//
// 게스트(시안·검사)는 localStorage('church_welcome_v1') — 명단·순은 모임 화면이 읽는 게스트 칸(church_groups_v1)과 멤버 화면의
// 명단 칸(church_roster_v1)에 같이 적는다. 미리보기 빌드(demoOn)만 시연 씨앗을 심는다 — 검사 브라우저에는 심지 않는다.
// ============================================================================

export const STAGES = [
  ['visit1', '첫 방문 완료'],
  ['visit2', '재방문 완료'],
  ['contact', '컨택 완료'],
  ['register', '등록 완료'],
  ['meet', '교육 완료'],   // 새신자 교육 — 순 배정 전 리더(리더순장·전도사님)가 새신자를 알아 가며 어느 순이 맞을지 보는 시간
  ['sun', '배정 완료'],
  ['settled', '정착 완료'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const STAGE_INDEX = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
export const HOLD = 'hold';
export const HOLD_LABEL = '보류';
// 단계 점 색 — 토큰만(라이트·다크가 같이 따라온다)
export const STAGE_DOT = {
  visit1: 'var(--app-ink-faint)', visit2: 'var(--app-tag-blue-fg)', contact: 'var(--app-tag-purple-fg)',
  register: 'var(--app-tag-pink-fg)', meet: 'var(--app-tag-orange-fg)', sun: 'var(--app-tag-yellow-fg)',
  settled: 'var(--app-tag-green-fg)', [HOLD]: 'var(--app-tag-gray-fg)',
};
// 명단에 사람이 있어야 하는 칸(등록 완료부터)
export const needsPerson = (stage) => stage !== HOLD && STAGE_INDEX[stage] >= STAGE_INDEX.register;

// 카드 한 줄 아래 말(다음에 할 일 · 사용자 문구 2026-10-21)
export function nextStep(c, sunName) {
  switch (c.stage) {
    case 'visit1': return '재방문을 기다려요';
    case 'visit2': return '웰컴팀이 컨택할 차례예요';
    case 'contact': return '교회 등록 여부를 정해요';
    case 'register': return '리더진이 케어해요';
    case 'meet': return '순을 배정해요';
    case 'sun': return '잘 정착하는지 지켜봐요';
    case 'settled': return sunName ? `${sunName} 순원` : '정착 완료';
    default: return c.note || HOLD_LABEL;
  }
}

// ── 순수 갈래(브라우저 없이 검사된다 — tests/welcome.mjs) ──────────────────────
// 카드 고치기 한 벌 — 무엇을 바꾸는지만 돌려준다(게스트·클라우드가 같은 답을 쓴다)
export const stagePatch = (c, stage, today) => ({
  stage,
  ...(stage === 'visit2' && c.visits.length < 2 ? { visits: [...c.visits, today] } : {}),
  ...(stage === 'settled' && !c.settled_at ? { settled_at: today } : {}),
});
// 교육 기록 지우기 — 다 지우면 교육 완료 칸에서 등록 완료 칸으로
export function meetRemovePatch(c, at) {
  const meets = c.meets.filter((_, i) => i !== at);
  return { meets, ...(meets.length === 0 && c.stage === 'meet' ? { stage: 'register' } : {}) };
}
// 교육 날짜 고치기 — 고친 뒤 날짜순(회차 = 날짜 차례)
export const meetDatePatch = (c, at, date) => ({ meets: c.meets.map((d, i) => (i === at ? date : d)).sort() });
// 교육 한 회 더 — 등록 완료 칸이면 교육 완료 칸으로
export const meetAddPatch = (c, today) => ({ meets: [...c.meets, today], stage: c.stage === 'register' ? 'meet' : c.stage });
// 컨택 완료 = 누른 사람이 담당(사용자 2026-10-21 — 되돌려 다른 사람이 다시 누르면 그 사람으로)
export const contactPatch = (by, today) => ({ contact: { by, at: today }, owner: by, stage: 'contact' });

// 연락처 칸 — 숫자만 쳐도 칸 안에서 010-0000-0000 꼴로 바뀐다(사용자 2026-10-21). 010은 3-4-4, 02는 2-(3|4)-4, 그 밖은 10자리 3-3-4 · 11자리 3-4-4.
export function formatPhone(input) {
  const d = String(input || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.startsWith('010') || d.length === 11) {
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

// ── 저장 자리 ──────────────────────────────────────────────────────────────
const cloudOn = () => !!supabase;
const COLS = 'id, name, phone, how, note, stage, position, visits, contact_by, contact_at, owner, registered_at, meets, settled_at, person_id, created_at';
const fromRow = (r) => ({
  id: r.id, name: r.name, phone: r.phone || '', how: r.how || '', note: r.note || '', stage: r.stage, position: r.position ?? 0,
  visits: r.visits || [], contact: r.contact_by ? { by: r.contact_by, at: r.contact_at } : null, owner: r.owner || null,
  registered_at: r.registered_at || null, meets: r.meets || [], settled_at: r.settled_at || null, person_id: r.person_id || null,
  created_at: r.created_at,
});
// 화면 칸 → DB 칸(바뀐 것만)
function toRow(p) {
  const out = {};
  for (const k of ['stage', 'position', 'visits', 'owner', 'meets', 'settled_at', 'person_id', 'registered_at']) if (k in p) out[k] = p[k];
  if ('contact' in p) { out.contact_by = p.contact?.by || null; out.contact_at = p.contact?.at || null; }
  return out;
}

const KEY = 'church_welcome_v1';
const SEEDED = 'church_welcome_seeded';
const lsRead = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const lsWrite = (cards) => { try { localStorage.setItem(KEY, JSON.stringify(cards)); } catch { /* 막힌 저장소 */ } };
const seeded = () => { try { return !!localStorage.getItem(SEEDED); } catch { return true; } };
const groupsGuest = guestStore('church_groups_v1');
const rosterGuest = guestStore('church_roster_v1');

let cache = null;          // 클라우드: 마지막으로 읽은 한 벌(+ 먼저 선 고침)
let loadError = null;
const listeners = new Set();
const emit = () => listeners.forEach(f => f());
export const onWelcomeChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

// 지금 한 벌. 클라우드에서 아직 안 읽었으면 null(스켈레톤 자리) — refreshCards()가 채운다.
export function loadCards() {
  if (cloudOn()) return cache;
  if (demoOn() && !seeded()) seed();
  return lsRead() || [];
}
export const loadFailed = () => loadError;

export async function refreshCards() {
  if (!cloudOn()) { emit(); return; }
  const { data, error } = await supabase.from('welcome_cards').select(COLS).order('created_at');
  if (error) { loadError = error; emit(); throw error; }
  loadError = null;
  cache = (data || []).map(fromRow);
  emit();
}

// 카드 한 장 고치기 — 먼저 화면에, 다음 DB. 실패하면 다시 읽고 던진다.
async function patch(id, fn) {
  const cards = loadCards() || [];
  const cur = cards.find(c => c.id === id);
  if (!cur) return null;
  const p = fn(cur);
  const next = { ...cur, ...p };
  if (!cloudOn()) { lsWrite(cards.map(c => (c.id === id ? next : c))); emit(); return next; }
  cache = cards.map(c => (c.id === id ? next : c)); emit();
  const { error } = await supabase.from('welcome_cards').update(toRow(p)).eq('id', id);
  if (error) { await refreshCards().catch(() => {}); throw error; }
  return next;
}

const today = () => kstToday();
export const setStage = (id, stage) => patch(id, c => stagePatch(c, stage, today()));
export const markContacted = (id, by) => patch(id, () => contactPatch(by, today()));
export const addMeet = (id) => patch(id, c => meetAddPatch(c, today()));
export const removeMeet = (id, at) => patch(id, c => meetRemovePatch(c, at));
export const setMeetDate = (id, at, date) => patch(id, c => meetDatePatch(c, at, date));

// 같은 칸 안 순서(업무 보드와 같은 끌기) — 여러 장을 한 번에
export async function reorder(list) {
  const pos = new Map(list.map(x => [x.id, x.position]));
  const cards = loadCards() || [];
  const next = cards.map(c => (pos.has(c.id) ? { ...c, position: pos.get(c.id) } : c));
  if (!cloudOn()) { lsWrite(next); emit(); return; }
  cache = next; emit();
  const changed = cards.filter(c => pos.has(c.id) && c.position !== pos.get(c.id));
  const results = await Promise.all(changed.map(c => supabase.from('welcome_cards').update({ position: pos.get(c.id) }).eq('id', c.id)));
  const bad = results.find(r => r.error);
  if (bad) { await refreshCards().catch(() => {}); throw bad.error; }
}

// 새신자 등록 — 명단 한 줄 + newcomer_at(0120 welcome_register · 두 번 눌러도 사람은 하나)
export async function register(id) {
  const cards = loadCards() || [];
  const card = cards.find(c => c.id === id);
  if (!card || card.person_id) return card;
  if (!cloudOn()) {
    const row = personRow(card.name, today());
    putPerson(row);
    return patch(id, () => ({ person_id: row.id, registered_at: today() }));
  }
  const { data, error } = await supabase.rpc('welcome_register', { p_card: id });
  if (error) throw error;
  cache = (cache || []).map(c => (c.id === id ? { ...c, person_id: data, registered_at: c.registered_at || today() } : c));
  emit();
  return cache.find(c => c.id === id);
}

// 순 배정 — 순 편성과 같은 칸. from = 지금 순(옮기기) · 게스트는 순 편성의 넣기·옮기기 그대로(groups.js)
export async function assignSun(card, group, from = null) {
  if (!card?.person_id) throw new Error('먼저 새신자로 등록해 주세요');
  if (!cloudOn()) {
    // 늦게 싣는다 — 새가족 정보 화면(로그인 없는 한 장)이 이 파일을 실어도 모임 화면 코드가 딸려 가지 않게
    const { addMember, moveMember } = await import('./groups.js');
    if (from) await moveMember(from.id, group.id, card.person_id); else await addMember(group.id, card.person_id);
    return;
  }
  const { error } = await supabase.rpc('welcome_assign_sun', { p_card: card.id, p_group: group.id });
  if (error) throw error;
}

// 새가족 QR 화면 — 로그인 없음(0120 submit_welcome_card)
export async function submitNewcomer({ name, phone, how, note }) {
  if (!cloudOn()) {
    const card = { id: generateId(), name, phone, how, note, stage: 'visit1', created_at: today(), visits: [today()], contact: null,
      registered_at: null, meets: [], settled_at: null, owner: null, person_id: null, position: 0 };
    lsWrite([...(lsRead() || []), card]); emit();
    return card;
  }
  const { data, error } = await supabase.rpc('submit_welcome_card', { p_name: name, p_phone: phone, p_how: how || null, p_note: note || null });
  if (error) throw error;
  // 웹 푸시는 서버가 보낸다(0121 — 알림 줄은 함수가 이미 넣었다). 방금 들어온 카드 한 장에 한 번만 · 실패해도 정보는 들어갔다
  fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ welcome: data }) })
    .catch(e => console.warn('[welcome] 푸시를 부탁하지 못했어요:', e));
  return { name };
}

// ── 게스트 ─────────────────────────────────────────────────────────────────
function personRow(name, newcomer_at) {
  return { id: `wd-${generateId()}`, name, birthday: null, teams: [], gender: null, is_pastor: false, profile_id: null,
    note: null, removed_at: null, created_at: new Date().toISOString(), birth_year: null, newcomer_at };
}
function putPerson(row) {
  groupsGuest.set('people', [...groupsGuest.rows('people'), row]);
  rosterGuest.set('people', [...rosterGuest.rows('people'), row]);
}
const daysAgo = (n) => new Date(new Date(`${today()}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);

// 시연 씨앗(미리보기 빌드만) — 단계마다 한두 장 · 등록한 카드는 명단에 사람이 있고, 배정·정착 카드는 그 해 순의 순원이다.
// 그 해 순이 없으면 둘을 세운다(동아리 시연 씨앗 clubReport.ensureClubDemo의 사람으로 순장).
function seed() {
  const year = Number(today().slice(0, 4));
  let suns = groupsGuest.rows('groups').filter(g => g.type === 'sun' && !g.removed_at && g.year === year);
  if (!suns.length) {
    const ppl = groupsGuest.rows('people');
    const lead = (name) => ppl.find(p => p.name === name)?.id || null;
    suns = [
      { id: 'wd-s1', type: 'sun', name: '새싹순', year, leader_person_id: lead('천진영'), note: null, removed_at: null },
      { id: 'wd-s2', type: 'sun', name: '꼬순', year, leader_person_id: lead('김윤주'), note: null, removed_at: null },
    ];
    groupsGuest.set('groups', [...groupsGuest.rows('groups'), ...suns]);
    groupsGuest.set('group_members', [...groupsGuest.rows('group_members'),
      ...suns.filter(s => s.leader_person_id).map(s => ({ group_id: s.id, person_id: s.leader_person_id }))]);
  }
  const c = (name, stage, first, extra = {}) => ({
    id: generateId(), name, phone: '010-0000-0000', how: '친구 소개', note: '', stage,
    created_at: daysAgo(first), visits: [daysAgo(first)], contact: null, registered_at: null, meets: [],
    settled_at: null, owner: null, person_id: null, position: 0, ...extra,
  });
  const registered = (name, stage, first, extra = {}) => {
    const row = personRow(name, daysAgo(first - 10));
    putPerson(row);
    return c(name, stage, first, { person_id: row.id, registered_at: daysAgo(first - 10), visits: [daysAgo(first), daysAgo(first - 7)],
      contact: { by: '김유나', at: daysAgo(first - 9) }, owner: '김유나', ...extra });
  };
  const cards = [
    c('이서윤', 'visit1', 2, { how: 'SNS' }),
    c('박도현', 'visit1', 5),
    c('최하은', 'visit2', 9, { visits: [daysAgo(9), daysAgo(2)] }),
    c('정우진', 'visit2', 16, { visits: [daysAgo(16), daysAgo(9)] }),
    c('한서아', 'contact', 23, { visits: [daysAgo(23), daysAgo(16)], contact: { by: '김유나', at: daysAgo(12) }, owner: '김유나' }),
    registered('김예린', 'register', 26),
    registered('문가온', 'meet', 30, { meets: [daysAgo(9), daysAgo(2)] }),
    registered('오세훈', 'sun', 45, { meets: [daysAgo(23), daysAgo(16)], owner: '박서준' }),
    registered('윤채원', 'settled', 70, { meets: [daysAgo(48), daysAgo(41)], settled_at: daysAgo(20), owner: '박서준' }),
    c('강민재', HOLD, 40, { note: '다른 교회 청년부에 다니기로 함' }),
  ];
  const pid = (n) => cards.find(x => x.name === n).person_id;
  groupsGuest.set('group_members', [...groupsGuest.rows('group_members'),
    { group_id: suns[0].id, person_id: pid('오세훈') }, { group_id: (suns[1] || suns[0]).id, person_id: pid('윤채원') }]);
  // 새가족 정보 화면이 먼저 적어 둔 카드는 뒤에 둔다 · 1차 시안의 옛 카드(position 없음)는 버린다
  lsWrite([...cards, ...(lsRead() || []).filter(x => 'position' in x)]);
  try { localStorage.setItem(SEEDED, '1'); } catch { /* 막힌 저장소 */ }
}
