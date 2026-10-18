// ============================================================================
// 당겨서 새로 고침 — 셈 한 벌(import 0 · components/pullRefresh.jsx가 쓰고 tests/logcheck-phone이 문다 · v5 2묶음 시안)
// ----------------------------------------------------------------------------
//   rubber(raw)       손가락이 내려간 거리 → 화면이 따라오는 거리. 아이폰 고무줄과 같은 꼴(1 - 1/(x·c/d + 1))·d —
//                     처음에는 손을 거의 따라오고 갈수록 무거워져 PULL.max에 닿지 않는다.
//   pullPhase(d)      'idle' | 'pull'(아직 모자람) | 'armed'(놓으면 새로 고침)
//   gestureVerdict()  손이 처음 미끄러질 때 한 번 — 이 손짓을 당기기로 받을까('pull') · 놓을까('skip') · 더 볼까('wait').
//                     가로로 미는 손짓(보드 칸 넘기기) · 위로 미는 손짓(스크롤) · 길게 누른 뒤 움직임(dnd-kit 끌기 —
//                     TouchSensor delay 200ms) · 위가 아닌 곳(굴러 있는 상자) · 열린 창은 놓는다.
// ============================================================================

export const PULL = {
  max: 160,        // 고무줄이 다가가는 끝
  c: 1,            // 처음 기울기(1 = 처음에는 손을 그대로 따라온다 · 아이폰 스크롤 고무줄은 0.55 — 당기기에는 너무 무거워 문턱까지 240px이었다)
  arm: 70,         // 이만큼 따라오면 놓았을 때 새로 고친다
  hold: 64,        // 새로 고치는 동안 화면이 머무는 높이
  slop: 8,         // 이만큼 움직여야 방향을 가른다
  longPress: 180,  // 첫 움직임이 이보다 늦으면 길게 누른 것(끌기)으로 본다 — dnd-kit delay 200ms보다 조금 앞
  minSpin: 700,    // 새로 고침이 빨리 끝나도 이만큼은 돈다(번쩍 사라지지 않게)
  settle: 380,     // 제자리로 돌아가는 시간(폰 시트와 같은 quint 길이)
  back: 260,       // 모자라게 놓았을 때 돌아가는 시간
};

export function rubber(raw, { max = PULL.max, c = PULL.c } = {}) {
  const x = Math.max(0, Number(raw) || 0);
  return (1 - 1 / ((x * c) / max + 1)) * max;
}

export function pullPhase(d, { arm = PULL.arm } = {}) {
  if (!(d > 0.5)) return 'idle';
  return d >= arm ? 'armed' : 'pull';
}

// dx·dy: 손이 처음 자리에서 움직인 거리(아래가 +) · ms: 손을 댄 뒤 지난 시간
// atTop: 손 아래의 굴러 가는 상자가 전부 맨 위인가 · blocked: 창이 열렸거나 입력 칸·끌기 자리
export function gestureVerdict({ dx = 0, dy = 0, ms = 0, atTop = true, blocked = false } = {}, { slop = PULL.slop, longPress = PULL.longPress } = {}) {
  if (blocked || !atTop) return 'skip';
  if (Math.hypot(dx, dy) < slop) return 'wait';
  if (ms > longPress) return 'skip';
  if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) return 'skip';
  return 'pull';
}

// 다붓이가 내려오는 정도(0~1)와 갸웃 각 — 놓기 직전까지 머리부터 내려오고 armed에서 바로 선다
export function peek(d, { arm = PULL.arm } = {}) {
  const p = Math.min(1, Math.max(0, d / arm));
  return { p, tilt: p >= 1 ? 0 : -16 * (1 - p) };
}
