import { sha256 } from '../_lib.js';

// 위키 만들기의 공용 값 — api/_wikiBuild.js 머리말이 전체 그림이다(여기는 여러 조각 파일이 같이 쓰는 것만).
export const WIKI_MODEL = 'gemini-3.1-flash-lite';
export const sha = (s) => sha256(s, { len: 24 });
export const TEAM_ORDER = ['교역자', '임원진', '찬양팀', '워십팀', '웰컴팀', '미디어팀', '엔지니어팀'];
// 업무 칩의 '순장'은 팀이 아니다 — '순장들도 봐야 하는 일'이라는 표시(사용자 결정 2026-10-04). 팀 목록·다른 팀과 했던 일에서 빼고 보는 사람 표시로만.
export const AUDIENCE = new Set(['순장', '순원']);
export const audienceNote = (aud) => (aud?.length ? `${aud.join('·')}도 함께 봐요` : '');
// 회의 기록 — 그 날의 기록이라 날짜가 회의 날이다(그 밖의 업무는 마지막으로 고친 날)
export const MEETING_TITLE = /회의|월례회|미팅|모임/;
