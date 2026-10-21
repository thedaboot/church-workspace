import { generateId } from '../utils.js';
import { kstToday } from './roster.js';
import { guestStore } from './people.js';

// ============================================================================
// 새가족 정착 흐름 — 시안(v5 4묶음 · mock/b5 · 게스트 시연만)
// ----------------------------------------------------------------------------
// 단계는 사용자가 알려 준 웰컴팀의 보통 순서다(2026-10-21 — "아닐 수도 있어"라서 끌어서·메뉴로 아무 단계로나 옮긴다):
//   첫 방문 → 두 번째 방문 → 웰컴팀 컨택 → 새신자 등록 → 새신자 교육(리더순장·전도사님 · 여러 번) → 순 배정 → 정착.
// 칸은 '마지막으로 한 일'이다(첫 방문 칸 = 첫 방문만 한 사람). 보류는 칸이 아니라 보드 위 한 줄(업무 보드의 상시 줄과 같은 자리).
//
// **사람과 순은 명단·순 편성의 것을 그대로 쓴다**(사용자 2026-10-21 — "기존 DB와의 정합성").
//   · 새신자 등록 = 청년 명단(people)에 한 줄 + newcomer_at(0119). 카드는 그 사람의 id(person_id)만 든다.
//   · 순 배정 = 순 편성과 같은 길(groups.addMember → group_members). 카드는 순을 따로 적지 않는다 —
//     보여 줄 순은 언제나 group_members에서 읽는다(순 편성에서 옮기면 카드에도 그대로 선다).
//   · 등록 전 카드는 명단에 없다 — 새신자 등록 칸부터 뒤로 옮기면 먼저 등록한다.
// 실제로 붙일 때: 표 하나(welcome_cards — 단계·방문·컨택·새신자 교육 · person_id · 웰컴팀·리더진·교역자·마스터만) +
// 새가족 카드를 받는 서버 함수(로그인 없음 · 횟수 제한). 지금은 localStorage('church_welcome_v1') 한 칸이다.
// ============================================================================

export const STAGES = [
  // 칸 이름 = 그 칸으로 옮기는 버튼 이름('OO 완료' · 사용자 결정 2026-10-21 — 칸에는 그 일을 마친 사람이 선다)
  ['visit1', '첫 방문 완료'],
  ['visit2', '재방문 완료'],
  ['contact', '컨택 완료'],
  ['register', '등록 완료'],
  ['meet', '교육 완료'],   // 새신자 교육 — 순 배정 전 리더(리더순장·전도사님)가 새신자를 알아 가며 어느 순이 맞을지 보는 시간(사용자 이름 2026-10-21)
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
export const needsPerson = (stage) => stage !== HOLD && STAGE_INDEX[stage] >= STAGE_INDEX.register;

const KEY = 'church_welcome_v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (cards) => { try { localStorage.setItem(KEY, JSON.stringify(cards)); } catch { /* 막힌 저장소 */ } };
const listeners = new Set();
const emit = () => listeners.forEach(f => f());
export const onWelcomeChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

// 게스트에서 모임 화면이 읽는 명단·순 자리(services/groups.js와 같은 칸)와 멤버 화면의 명단 자리(services/roster.js) —
// 클라우드에서는 둘 다 people·group_members 한 벌이다. 시연에서는 등록한 사람을 두 자리에 같이 적는다.
const groupsGuest = guestStore('church_groups_v1');
const rosterGuest = guestStore('church_roster_v1');

const daysAgo = (n) => {
  const t = new Date(`${kstToday()}T00:00:00Z`).getTime() - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

function personRow(name, birth_year, newcomer_at) {
  return { id: `wd-${generateId()}`, name, birthday: null, teams: [], gender: null, is_pastor: false, profile_id: null,
    note: null, removed_at: null, created_at: new Date().toISOString(), birth_year: birth_year || null, newcomer_at };
}
function putPerson(row) {
  groupsGuest.set('people', [...groupsGuest.rows('people'), row]);
  rosterGuest.set('people', [...rosterGuest.rows('people'), row]);
}

// 시연 씨앗 — 단계마다 한두 장 · 등록한 카드는 명단에 사람이 있고, 순 배정·정착 카드는 그 해 순의 순원이다.
// 그 해 순이 없으면 둘을 세운다(동아리 시연 씨앗 clubReport.ensureClubDemo의 사람으로 순장).
function seed() {
  const year = Number(kstToday().slice(0, 4));
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
    const row = personRow(name, 1999, daysAgo(first - 10));
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
  // 오세훈 → 첫 순 · 윤채원 → 둘째 순(순 편성과 같은 칸)
  const pid = (n) => cards.find(x => x.name === n).person_id;
  groupsGuest.set('group_members', [...groupsGuest.rows('group_members'),
    { group_id: suns[0].id, person_id: pid('오세훈') }, { group_id: (suns[1] || suns[0]).id, person_id: pid('윤채원') }]);
  // 새가족 카드 화면(로그인 없는 한 장)이 먼저 적어 둔 카드는 뒤에 그대로 둔다
  // 1차 시안의 옛 카드(position이 없는 모양)는 버린다 — 같은 이름이 두 번 서지 않게
  const all = [...cards, ...(read() || []).filter(x => 'position' in x)];
  write(all);
  try { localStorage.setItem(SEEDED, '1'); } catch { /* 막힌 저장소 */ }
  return all;
}

// 시연 씨앗은 모임 화면이 처음 열릴 때 한 번(welcomeBoard가 부른다 — 동아리 씨앗 다음이어야 순장 이름을 찾는다).
// 새가족 카드 화면은 씨앗을 심지 않는다 — 그 화면만 연 브라우저에 모임 씨앗이 먼저 서면 동아리 씨앗이 건너뛴다.
const SEEDED = 'church_welcome_seeded';
const seeded = () => { try { return !!localStorage.getItem(SEEDED); } catch { return true; } };
export function loadCards() { return seeded() ? (read() || []) : seed(); }
const patch = (id, fn) => {
  const cards = loadCards().map(c => (c.id === id ? { ...c, ...fn(c) } : c));
  write(cards); emit();
  return cards.find(c => c.id === id);
};

// 새가족 정보(QR로 보낸 것) → '첫 방문 완료'
export function addNewcomerCard({ name, phone, how, note }) {
  const today = kstToday();
  const card = { id: generateId(), name, phone, how, note, stage: 'visit1', created_at: today,
    visits: [today], contact: null, registered_at: null, meets: [], settled_at: null, owner: null, person_id: null, position: 0 };
  write([...(read() || []), card]); emit();
  return card;
}

// 새신자 등록 — 명단에 한 줄(newcomer_at = 오늘). 실제로는 roster.addPerson 한 번(같은 이름이 이미 있으면 자동으로 잇지 않고 고르게 · §6-26).
export function register(id) {
  const card = loadCards().find(c => c.id === id);
  if (!card || card.person_id) return card;
  const row = personRow(card.name, card.birth_year, kstToday());
  putPerson(row);
  return patch(id, () => ({ person_id: row.id, registered_at: kstToday() }));
}

// 단계 옮기기 — 같은 칸 안 순서(position)는 reorder가 따로(업무 보드와 같은 끌기)
export const setStage = (id, stage) => patch(id, c => ({
  stage,
  ...(stage === 'visit2' && c.visits.length < 2 ? { visits: [...c.visits, kstToday()] } : {}),
  ...(stage === 'settled' && !c.settled_at ? { settled_at: kstToday() } : {}),
}));
export function reorder(list) {
  const pos = new Map(list.map(x => [x.id, x.position]));
  write(loadCards().map(c => (pos.has(c.id) ? { ...c, position: pos.get(c.id) } : c))); emit();
}
// 컨택 완료 = 누른 사람이 담당이 된다(사용자 2026-10-21 — 단계를 되돌려 다른 사람이 다시 누르면 그 사람으로 바뀐다)
export const markContacted = (id, by) => patch(id, () => ({ contact: { by, at: kstToday() }, owner: by, stage: 'contact' }));
// 잘못 누른 교육 기록을 지운다(사용자 2026-10-21 — "횟수를 조절 못 하네"). 다 지우면 교육 완료 칸에서 등록 완료 칸으로 돌아간다
export const removeMeet = (id, at) => patch(id, c => {
  const meets = c.meets.filter((_, i) => i !== at);
  return { meets, ...(meets.length === 0 && c.stage === 'meet' ? { stage: 'register' } : {}) };
});
// 교육 날짜 고치기 — 고친 뒤 날짜순으로 다시 세운다(회차 = 날짜 차례)
export const setMeetDate = (id, at, date) => patch(id, c => ({
  meets: c.meets.map((d, i) => (i === at ? date : d)).sort(),
}));
export const addMeet = (id) => patch(id, c => ({ meets: [...c.meets, kstToday()], stage: c.stage === 'register' ? 'meet' : c.stage }));

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
