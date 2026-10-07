// ============================================================================
// v2 예배 — 주보(services) · 출석(attendance) · 내 예배 노트(service_notes)
// ----------------------------------------------------------------------------
// 스펙 정본은 docs/V2.md §1(결정 4·5·6·7·14)·§2, 저장 자리는 0036이다.
//
// **RLS가 권한의 진실이고 화면은 그걸 비춘다.** 여기 있는 판정 함수(worshipPerms)는
// 0035·0036의 can_edit_service()·can_check_all_attendance()·leads_sun_of()를 그대로
// 옮긴 것이다 — 버튼을 감추는 용도이지 막는 용도가 아니다. 어긋나면 DB가 이긴다.
//
// 명단·순 편성은 people.js 한 벌을 쓴다(다시 만들지 않는다). 이 파일은 그 위에
// 예배 화면이 필요로 하는 것만 얹는다: 주보 읽기·쓰기, 출석 토글, 내 노트 upsert.
//
// **게스트 모드(supabase 없음)에서는 localStorage가 클라우드 자리를 대신한다** —
// 워크스페이스가 게스트에서 `church_app_v4`를 보는 것과 같은 방식이다. 그래야
// 브라우저 스위트가 이 화면을 실제로 눌러 볼 수 있다(tests/worship.mjs). 클라우드
// 경로(RLS·실데이터)는 사람이 확인해야 한다 — HANDOFF §3-6.
// ============================================================================

// 쪼갠 자리(2026-10-07 · 19차): worship/pure.js(순수) · bulletin.js(주보·알림) · files.js(파일) ·
// attendance.js(명단·자격·출석) · notes.js(내 노트) · api.js(서버 함수). 부르는 쪽은 이 파일 하나를 문다.
export * from './worship/pure.js';
export * from './worship/bulletin.js';
export * from './worship/files.js';
export * from './worship/attendance.js';
export * from './worship/notes.js';
export * from './worship/api.js';
// 종류 이름·찬양팀 이름은 순수 모듈(serviceView.js)이 정본이다 — 공개 보기(서버·공개 페이지)도 같은 글자를 쓴다
export { SUNDAY_KIND, kindLabel, PRAISE_TEAM } from './serviceView.js';
export { copyExportAs } from './cueDigest.js';
