import { generateId } from '../utils.js';
import { kstToday } from './roster.js';

// ============================================================================
// 새가족 정착 흐름 — 시안(v5 4묶음 · mock/b5 · 게스트 시연만)
// ----------------------------------------------------------------------------
// 단계는 사용자가 알려 준 웰컴팀의 보통 순서다(2026-10-21 — "아닐 수도 있어"라서 단계는 자유롭게 옮길 수 있다):
//   첫 방문 → 두 번째 방문 → 웰컴팀 연락 → 새신자 등록(여부를 정한다) → 리더 모임(리더순장·전도사님 · 여러 번) → 순 배정 → 정착.
// 칸은 '마지막으로 한 일'이다(첫 방문 칸 = 첫 방문만 한 사람). '새신자로 등록'을 누르면 청년 명단에 들어가고 people.newcomer_at이 그날이 된다(0119 · 명단 배지 석 달).
// 카드의 출발점은 새가족 QR로 쓴 새가족 카드다(로그인 없이 — components/newcomerCard.jsx).
// 실제로 붙일 때: 표 하나(welcome_cards — 단계·기록 · 웰컴팀·리더진·교역자·마스터만) + 새가족 카드를 받는 서버 함수(로그인 없음 · 횟수 제한).
// 지금은 localStorage('church_welcome_v1') 한 칸이다.
// ============================================================================

export const STAGES = [
  ['visit1', '첫 방문'],
  ['visit2', '두 번째 방문'],
  ['contact', '웰컴팀 연락'],
  ['register', '새신자 등록'],
  ['meet', '리더 모임'],
  ['sun', '순 배정'],
  ['settled', '정착'],
];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const HOLD = 'hold';   // 등록하지 않기로 한 카드(보드 아래 '보류' 묶음)

const KEY = 'church_welcome_v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (cards) => { try { localStorage.setItem(KEY, JSON.stringify(cards)); } catch { /* 막힌 저장소 */ } };
const listeners = new Set();
const emit = () => listeners.forEach(f => f());
export const onWelcomeChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

const daysAgo = (n) => {
  const t = new Date(`${kstToday()}T00:00:00Z`).getTime() - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

// 시연 카드 — 단계마다 한두 장
function demo() {
  const c = (name, stage, extra = {}) => ({
    id: generateId(), name, phone: '010-0000-0000', birth_year: 1999, how: '친구 소개', note: '',
    stage, created_at: daysAgo(extra.first ?? 7), visits: [daysAgo(extra.first ?? 7)], contact: null,
    decision: null, meets: [], sun: null, settled_at: null, owner: null, ...extra,
  });
  return [
    c('이서윤', 'visit1', { first: 2, how: '인스타그램' }),
    c('박도현', 'visit1', { first: 5 }),
    c('최하은', 'visit2', { first: 9, visits: [daysAgo(9), daysAgo(2)] }),
    c('정우진', 'visit2', { first: 16, visits: [daysAgo(16), daysAgo(9)] }),
    c('김예린', 'register', { first: 26, visits: [daysAgo(26), daysAgo(19)], contact: { by: '김유나', at: daysAgo(15) }, decision: { at: daysAgo(4) }, owner: '김유나' }),
    c('한서아', 'contact', { first: 23, visits: [daysAgo(23), daysAgo(16)], contact: { by: '김유나', at: daysAgo(12) }, owner: '김유나' }),
    c('문정원', 'meet', { first: 30, visits: [daysAgo(30), daysAgo(23)], contact: { by: '김유나', at: daysAgo(20) }, decision: { at: daysAgo(16) }, meets: [daysAgo(9), daysAgo(2)], owner: '김유나' }),
    c('오세훈', 'sun', { first: 45, visits: [daysAgo(45), daysAgo(38)], contact: { by: '박서준', at: daysAgo(35) }, decision: { at: daysAgo(30) }, meets: [daysAgo(23), daysAgo(16), daysAgo(9)], sun: '새싹순', owner: '박서준' }),
    c('윤채원', 'settled', { first: 70, visits: [daysAgo(70), daysAgo(63)], contact: { by: '박서준', at: daysAgo(60) }, decision: { at: daysAgo(55) }, meets: [daysAgo(48), daysAgo(41)], sun: '꼬순', settled_at: daysAgo(20), owner: '박서준' }),
    c('강민재', HOLD, { first: 40, note: '다른 교회 청년부에 다니기로 함' }),
  ];
}

export function loadCards() {
  let cards = read();
  if (!cards) { cards = demo(); write(cards); }
  return cards;
}
const patch = (id, fn) => {
  const cards = loadCards().map(c => (c.id === id ? { ...c, ...fn(c) } : c));
  write(cards); emit();
  return cards.find(c => c.id === id);
};

// 새가족 카드(QR로 쓴 것) → 보드 '첫 방문'
export function addNewcomerCard({ name, phone, birth_year, how, note }) {
  const today = kstToday();
  const card = { id: generateId(), name, phone, birth_year: birth_year || null, how, note, stage: 'visit1', created_at: today,
    visits: [today], contact: null, decision: null, meets: [], sun: null, settled_at: null, owner: null };
  write([...loadCards(), card]); emit();
  return card;
}

export const setStage = (id, stage) => patch(id, () => ({ stage }));
export const addVisit = (id) => patch(id, c => ({ visits: [...c.visits, kstToday()], stage: c.stage === 'visit1' ? 'visit2' : c.stage }));
export const markContacted = (id, by) => patch(id, c => ({ contact: { by, at: kstToday() }, owner: c.owner || by, stage: 'contact' }));
export const register = (id) => patch(id, () => ({ decision: { at: kstToday() }, stage: 'register' }));
export const hold = (id) => patch(id, () => ({ stage: HOLD }));
export const addMeet = (id) => patch(id, c => ({ meets: [...c.meets, kstToday()], stage: 'meet' }));
export const assignSun = (id, sun) => patch(id, () => ({ sun, stage: 'sun' }));
export const settle = (id) => patch(id, () => ({ stage: 'settled', settled_at: kstToday() }));
export const setNote = (id, note) => patch(id, () => ({ note }));

// 단계마다 다음에 할 일 한 줄(카드에 보이는 말) — 문구는 시안 · 사용자 확정 전
export function nextStep(c) {
  switch (c.stage) {
    case 'visit1': return '두 번째 방문을 기다려요';
    case 'visit2': return '웰컴팀이 연락할 차례예요';
    case 'contact': return '새신자 등록 여부를 정해요';
    case 'register': return '리더 모임을 잡아요';
    case 'meet': return `리더 모임 ${c.meets.length}번 · 순을 정해요`;
    case 'sun': return `${c.sun || '순'} · 정착을 지켜봐요`;
    case 'settled': return c.sun ? `${c.sun} 순원` : '정착';
    default: return '보류';
  }
}
