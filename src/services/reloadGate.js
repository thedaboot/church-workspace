// 전체 재조회 문(2026-11-09 장애 보완 · App 실시간 effect가 쓴다).
// 2026-11-08 주일 모임(접속 20명 안팎)에서 심장박동 판정 버그(utils/peopleSeen seenOnlyChange)로 사람마다 1분에
// 서너 번씩 워크스페이스 전체(쿼리 16개)를 다시 읽어 Supabase 연결 풀이 바닥났다(PGRST003 · 504 약 2,760건).
// 버그는 고쳤고, 이 문은 **다른 갈래로 폭주가 다시 생겨도 사람당 상한**을 세운다:
//   · 겹치지 않는다 — 도는 중에 온 요청은 끝난 뒤 한 번으로 묶인다
//   · 시작 사이 간격은 gapMs 이상 — 그 안에 온 요청은 간격이 차는 때로 미룬다(버리지 않는다 · 마지막 변경은 반영된다)
//   · 이미 잡힌 타이머가 더 이르면 그대로 둔다 — 늦게 온 요청이 이른 재조회를 뒤로 밀지 않는다
// 순수 모듈(import 0) — 시계·타이머를 넘겨받아 logcheck-live가 가짜 시계로 본다. 함정 §6-21-c.
export function createReloadGate(run, { gapMs, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let lastAt = -Infinity, running = false, again = false, timer = null, dueAt = 0;
  const fire = async () => {
    timer = null;
    if (running) { again = true; return; }
    running = true; lastAt = now();
    try { await run(); } catch { /* run이 스스로 적는다 */ }
    running = false;
    if (again) { again = false; schedule(0); }
  };
  function schedule(delay = 0) {
    const at = Math.max(now() + delay, lastAt + gapMs);
    if (timer && dueAt <= at) return;
    if (timer) clearTimer(timer);
    dueAt = at;
    timer = setTimer(fire, Math.max(0, at - now()));
  }
  const cancel = () => { if (timer) clearTimer(timer); timer = null; };
  return { schedule, cancel };
}
