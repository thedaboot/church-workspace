import { CONFIG } from '../config.js';
import { ROLE_LABEL, PASTOR_LABEL, GRAD_LABEL, NEWCOMER_LABEL } from '../services/roster.js';

// 직분 배지 색 한 벌 — 명단(roster.jsx)과 인수인계(handover.jsx · 홈 카드)가 같이 쓴다.
// 배지 색은 토큰만 쓴다. 교역자는 CONFIG.TEAMS의 '교역자'와 같은 계열로 맞춘다.
export const BADGE_STYLE = {
  [PASTOR_LABEL]: 'bg-tag-red text-tag-red-fg',
  [ROLE_LABEL.director]: 'bg-tag-orange text-tag-orange-fg',
  [ROLE_LABEL.president]: 'bg-tag-yellow text-tag-yellow-fg',
  [ROLE_LABEL.treasurer]: 'bg-tag-blue text-tag-blue-fg',
  [ROLE_LABEL.lead_sunjang]: 'bg-tag-purple text-tag-purple-fg',
  [ROLE_LABEL.lead_team]: 'bg-tag-green text-tag-green-fg',
  // 예배팀장 — 찬양·엔지니어·워십에 걸친 자리라 한 팀의 색을 빌리지 않는다
  [ROLE_LABEL.worship_lead]: 'bg-tag-gray text-tag-gray-fg',
  [ROLE_LABEL.vision_maker]: 'bg-tag-brown text-tag-brown-fg',
  [GRAD_LABEL]: 'bg-tag-gray text-tag-gray-fg',
  // 새신자 — 태그 아홉 색은 팀·직분이 다 쓴다. 겹치지 않게 연한 accent(시안 승인 2026-10-21)
  [NEWCOMER_LABEL]: 'bg-accent-weak text-accent-text',
};
// 팀장이 고르는 팀 — 사역 팀(config의 '…팀'). **기획팀은 아직 없다**(사용자 2027 명단에만 있다 — config·teams 표에 넣는 것은
// 사용자가 알려 줄 때 · 넣으면 소속 칩·팀 보드·대시보드에도 선다). DB(0107)는 '…팀'이면 받으므로 그때 여기만 따라온다.
export const LEAD_TEAMS = Object.keys(CONFIG.TEAMS).filter(t => t.endsWith('팀'));

// 팀장 배지는 그 팀의 색이다('찬양팀장' = 찬양팀 칩 색). config에 없는 팀(기획팀)은 회색.
export const badgeClass = (b) => BADGE_STYLE[b]
  || CONFIG.TEAMS[String(b).replace(/장$/, '')] || 'bg-tag-gray text-tag-gray-fg';
