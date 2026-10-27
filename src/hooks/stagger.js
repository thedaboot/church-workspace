// 줄·카드 등장 순번 — 뒤로 갈수록 간격이 짧아진다(UI 다듬기 2차 M22 · 시안 값 그대로 · PITFALLS 78-a).
// 첫 간격은 그 목록이 쓰던 값(step · 22~30ms) 그대로, 다음 간격부터 0.78배씩 줄고 14ms 아래로는 안 내려가며,
// 출발 시각은 260ms를 넘지 않는다 — 긴 목록의 마지막 줄이 늘어지지 않게(예전: 같은 간격 × 12번째에서 멈춤).
// - 첫 렌더에서만 순번을 주는 것(useEnterStagger)과 다시 온 화면의 순번 0(quickEnter · 72-a)은 그대로 — 이것은 값만 정한다.
export const STAGGER_DECAY = 0.78;
export const STAGGER_FLOOR = 14;
export const STAGGER_CAP = 260;

export function staggerMs(i, step) {
  let t = 0;
  for (let k = 0; k < i; k++) {
    t += Math.max(STAGGER_FLOOR, step * STAGGER_DECAY ** k);
    if (t >= STAGGER_CAP) return STAGGER_CAP;
  }
  return Math.round(t);
}
