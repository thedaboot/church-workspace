// ============================================================================
// 1. Constants & Configurations (설정 및 상수)
// ============================================================================
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
  STATUS_DB: { '시작 전': 'todo', '진행 중': 'doing', '보류 중': 'hold', '완료': 'done' }
};
