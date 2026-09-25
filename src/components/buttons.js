// ============================================================================
// 주 버튼 두 단 (D9 · 사용자 결정 2026-09-25 — 목업 remaining-mockup §2에서 골랐다)
// ----------------------------------------------------------------------------
// 같은 역할의 버튼이 화면마다 17벌이었다(글자 10~14px · 굵기 500~700 · 비활성 bg-line과
// opacity가 섞였다). 이제 accent로 채운 주 버튼은 이 두 단만 쓴다.
//
//   작은 단(BTN)   11.5px · 600 · 높이 29px(6px 12px) · 모서리 8px — 도구 줄·입력 줄 옆
//                  (댓글 등록·답글·저장 · 새 주보 · 가입 신청 · 팝오버 안의 추가·적용)
//   확정 단        13px · 600 · 높이 40px(10px 16px) · 모서리 8px — 창 맨 아래의 확정
//   (BTN_CONFIRM)  (내 정보 저장·시작하기 · 프로젝트 만들기 · 불러오기 실패 화면의 다시 시도)
//                  짝이 되는 취소는 BTN_CONFIRM_QUIET(같은 크기 · 무채색)
//
// **비활성은 opacity .4 하나다.** 예전 `disabled:bg-line`은 라이트에서 흰 글자/#dcd8dc가
// 1.41:1로 거의 안 보였고, 다크에서는 흰/#333230이 12.8:1이라 비활성이 오히려 눌리는
// 것처럼 보였다. hover 색은 `enabled:`에만 준다(비활성 위에서 색이 바뀌면 눌리는 것처럼 읽힌다).
// 순서·색 규칙(HANDOFF §8 — 대화창은 취소 왼쪽/확정 오른쪽, 진한 accent = 확정)은 그대로다.
// 업무 창 아래 줄(저장·수정·닫기)은 §8의 '상시 도구 줄'이라 여기 두 단에 넣지 않았다.
// tests/handoff가 두 단의 계산값과 `disabled:bg-line`이 소스에 없는지를 본다.
// ============================================================================

export const BTN = 'px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40';

const CONFIRM_BASE = 'inline-flex items-center justify-center gap-1.5 min-h-10 px-4 py-2.5 rounded-md text-[13px] font-semibold transition active:scale-95 disabled:opacity-40';
export const BTN_CONFIRM = `${CONFIRM_BASE} bg-accent enabled:hover:bg-accent-strong text-white`;
export const BTN_CONFIRM_QUIET = `${CONFIRM_BASE} bg-surface-hover enabled:hover:bg-line text-fg-muted`;
