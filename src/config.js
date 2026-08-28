// ============================================================================
// 1. Constants & Configurations (설정 및 상수)
// ============================================================================
// 첨부 한 건의 상한. **세 군데가 이 값에 맞춰져 있다** — 고를 때 거르는 자리,
// 미리보기가 "우리 뷰어로 그릴지" 가르는 자리, 그리고 바이트를 중계하는
// api/drive-file.js의 MAX_BYTES다. 여기만 올리고 나머지를 안 올리면 **받아는 주는데
// 우리 뷰어로는 안 보이는 파일**이 생긴다 — 19MB PDF가 드라이브의 어두운 파일
// 뷰어로 떨어진 것이 그것이었다(사용자 신고 2026-08-28). tests/drivesync가 짝을 본다.
export const MAX_UPLOAD_MB = 25;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const CONFIG = {
  TEAMS: {
    '웰컴팀': 'bg-tag-pink text-tag-pink-fg',
    '워십팀': 'bg-tag-purple text-tag-purple-fg',
    '찬양팀': 'bg-tag-blue text-tag-blue-fg',
    '엔지니어팀': 'bg-tag-gray text-tag-gray-fg',
    '미디어팀': 'bg-tag-brown text-tag-brown-fg',
    '임원진': 'bg-tag-yellow text-tag-yellow-fg',
    '교역자': 'bg-tag-red text-tag-red-fg',
  },
  // 보드 컬럼 순서 = 이 배열 순서. DB 값 매핑은 STATUS_DB(인덱스가 아니라 이름 기준)
  STATUSES: ['시작 전', '진행 중', '보류 중', '완료'],
  STATUS_STYLES: {
    '시작 전': 'bg-tag-gray text-tag-gray-fg border-line',
    '진행 중': 'bg-tag-blue text-tag-blue-fg border-line',
    '보류 중': 'bg-tag-yellow text-tag-yellow-fg border-line',
    '완료': 'bg-tag-green text-tag-green-fg border-line'
  },
  // 컬럼 헤더 dot 색 (상태별)
  STATUS_DOTS: {
    '시작 전': 'bg-fg-faint',
    '진행 중': 'bg-accent',
    '보류 중': 'bg-status-hold',
    '완료': 'bg-tag-green-fg'
  },
  // 앱 표기 ↔ DB(cards.status) 값. 순서를 바꿔도 매핑이 깨지지 않게 이름으로 못 박는다.
  STATUS_DB: { '시작 전': 'todo', '진행 중': 'doing', '보류 중': 'hold', '완료': 'done' },
  // 상태 칩용 실제 색값 (인라인 style에서 쓴다 — Tailwind 클래스로는 값을 꺼낼 수 없다)
  STATUS_BG_VAR: {
    '시작 전': 'var(--app-tag-gray)', '진행 중': 'var(--app-tag-blue)',
    '보류 중': 'var(--app-tag-yellow)', '완료': 'var(--app-tag-green)',
  },
  STATUS_FG_VAR: {
    '시작 전': 'var(--app-tag-gray-fg)', '진행 중': 'var(--app-tag-blue-fg)',
    '보류 중': 'var(--app-tag-yellow-fg)', '완료': 'var(--app-tag-green-fg)',
  },
  // 팀 이름을 배지가 아니라 글자색으로 쓸 때 (보드 카드). TEAMS와 같은 색 계열.
  TEAM_FG: {
    '웰컴팀': 'text-tag-pink-fg',
    '워십팀': 'text-tag-purple-fg',
    '찬양팀': 'text-tag-blue-fg',
    '엔지니어팀': 'text-tag-gray-fg',
    '미디어팀': 'text-tag-brown-fg',
    '임원진': 'text-tag-yellow-fg',
    '교역자': 'text-tag-red-fg',
  },
  // 팀 → index.css의 태그 색 토큰 이름. 캘린더처럼 실제 색값이 필요한 곳에서 쓴다
  // (TEAMS는 Tailwind 클래스 문자열이라 색값을 꺼낼 수 없다). TEAMS와 같은 색으로 유지.
  TEAM_TOKENS: {
    '웰컴팀': 'pink',
    '워십팀': 'purple',
    '찬양팀': 'blue',
    '엔지니어팀': 'gray',
    '미디어팀': 'brown',
    '임원진': 'yellow',
    '교역자': 'red',
  }
};

// 담당 팀 색으로 캘린더 띠·점 색을 만든다.
// 여러 팀이 함께 하는 업무는 팀 색을 세로 줄무늬로 나눠 칠해 "공동 업무"임을 보여준다
// (최대 3색까지만 — 그 이상은 줄무늬가 알아보기 어려워진다).
// strong: 점·세로바처럼 글자가 얹히지 않는 작은 요소용(진한 색).
//         파스텔 배경색을 8px 점에 쓰면 팀 구분이 거의 안 보인다.
export const teamPaint = (teams = [], strong = false) => {
  const suffix = strong ? '-fg' : '';
  const tokens = teams.map(t => CONFIG.TEAM_TOKENS[t]).filter(Boolean).slice(0, 3);
  if (!tokens.length) return { background: `var(--app-tag-gray${suffix})`, color: 'var(--app-tag-gray-fg)' };
  const color = `var(--app-tag-${tokens[0]}-fg)`;
  if (tokens.length === 1) return { background: `var(--app-tag-${tokens[0]}${suffix})`, color };
  // 가로(90deg)로 나누면 여러 날에 걸친 띠가 날짜 칸마다 각각 그려지기 때문에
  // 색이 계속 번갈아 반복되는 것처럼 보였다. 세로(180deg)로 나누면 어느 칸이든
  // 같은 그림이 나와서 "두 팀 / 세 팀"이 한눈에 읽힌다.
  const stops = tokens.map((tk, i) => {
    const from = (i / tokens.length * 100).toFixed(2);
    const to = ((i + 1) / tokens.length * 100).toFixed(2);
    return `var(--app-tag-${tk}${suffix}) ${from}% ${to}%`;
  }).join(', ');
  return { background: `linear-gradient(180deg, ${stops})`, color };
};

// 팀 색 한 가지를 실제 색값으로 (대시보드 막대 등). 팀이 없으면 회색.
export const teamColor = (team) => {
  const token = CONFIG.TEAM_TOKENS[team];
  return token ? `var(--app-tag-${token}-fg)` : 'var(--app-tag-gray-fg)';
};
// 팀 배경색 (칩)
export const teamBgColor = (team) => {
  const token = CONFIG.TEAM_TOKENS[team];
  return token ? `var(--app-tag-${token})` : 'var(--app-tag-gray)';
};
// 진행 바에 쓰는 팀 파스텔 — 진한 팀 색을 바에 쓰면 화면이 시끄러워진다
export const teamBar = (team) => {
  const token = CONFIG.TEAM_TOKENS[team];
  return token ? `var(--p-${token})` : 'var(--p-gray)';
};
