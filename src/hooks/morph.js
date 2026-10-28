import { prefersReducedMotion } from './useReducedMotion.js';
import { easeMove } from './useFlip.js';
import { EXIT_MS } from './useExit.js';

// 업무 창이 누른 줄에서 자라고, 닫으면 그 줄로 돌아가 앉는다(UI 다듬기 2차 M1 · PITFALLS 71-f) + 돌아간 줄이 잠깐 연한 파랑(C1).
// **창 자체를 키우지 않는다** — 글이 든 큰 창을 scale하면 움직이는 동안 글자가 눌려 보이고, 편집기·댓글을 그리는 첫 프레임이
// 무거워 끊긴다. 대신 빈 판(유령) 하나를 transform만으로 줄 → 창 자리로 키우고(합성 단계라 메인 스레드가 바빠도 안 끊긴다),
// 진짜 창은 그 끝에서 유령과 엇갈려 떠오른다. 닫을 때는 거꾸로 — 창이 걷히는 동안 유령이 그 줄로 줄어든다.
// - 출발점은 업무 줄에 단 `data-flip="<업무 id>"`(표 · 대시보드 · 보드)에서 누른 순간 잰다. 0.8초 안에 열린 창만 그 자리를 쓴다
//   (검색·알림·주소로 연 창은 출발점이 없어 예전처럼 열린다).
// - 움직임 줄이기면 유령 없이 예전 그대로.
// - 유령이 자라고 줄어드는 것은 '옮기기'라 --ease-move(천천히 출발 · M23 · PITFALLS 78-b)다. quint는 40%에 이미 9할을 갔지만
//   이 곡선은 70%에야 9할이라, 유령과 창이 엇갈리는 박자를 그만큼 뒤로 민다(열 때 창은 60%부터 · 유령은 65%부터 · 닫을 때 유령은 75%부터 걷힘).
const OPEN_MS = 360;
const CLOSE_MS = 300;
const REVEAL_MS = 140;
const COVER = 0.22;      // 닫을 때 유령이 창을 다 덮는 때(CLOSE_MS의 비율 · 66ms)   // 다 큰 유령이 걷히며 창의 글이 드러나는 시간
let origin = null;   // { id, rect, at }

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.('[data-flip]');
    origin = el ? { id: el.dataset.flip, rect: el.getBoundingClientRect(), at: performance.now() } : null;
  }, true);
}

const visible = (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;

function ghost(to, radius) {
  const g = document.createElement('div');
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('data-morph-ghost', '');
  Object.assign(g.style, {
    position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    background: 'var(--app-surface)', border: '1px solid var(--app-line)', borderRadius: radius || '12px',
    boxShadow: 'var(--app-shadow-elevated)', transformOrigin: '0 0', zIndex: '60', pointerEvents: 'none',
  });
  document.body.appendChild(g);
  return g;
}
const squeeze = (from, to) =>
  `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;

// 창이 처음 서는 순간(useLayoutEffect) 부른다. 출발점이 없거나 화면 밖이면 아무것도 안 한다.
export function morphOpen(win, taskId) {
  const o = origin;
  origin = null;
  if (!win || !o || o.id !== String(taskId) || performance.now() - o.at > 800 || prefersReducedMotion() || !visible(o.rect)) return;
  // 창 자신의 등장(.dc-dialog·.dc-rise — 아래에서 떠오름)은 끈다: 그 움직임을 둔 채 재면 도착 자리가 28px 어긋나고,
  // 유령이 다 큰 뒤에도 창이 움직여 두 판이 겹쳐 보였다(사용자 지적 2026-10-28).
  win.style.animation = 'none';
  const to = win.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const g = ghost(to, getComputedStyle(win).borderRadius);
  // **둘이 동시에 반투명인 순간이 없게 한다** — 예전에는 창이 떠오르는 동안 유령이 걷혀 그 사이로 뒤 화면이 비쳤다
  // (폰은 뒤판이 없어 대시보드가 통째로 겹쳐 보였다). 지금: 창은 유령이 다 클 때까지 숨었다가 **불투명하게** 서고,
  // 그 위에서 유령(빈 판)만 걷혀 글이 드러난다. 뒤에 있는 것이 늘 불투명한 창이라 아무것도 비치지 않는다.
  g.animate([{ transform: squeeze(o.rect, to) }, { transform: 'none' }], { duration: OPEN_MS, easing: easeMove() });
  // 이 곡선은 85%에 이미 크기의 98%라, 거기서부터 글을 드러낸다(끝까지 기다리면 빈 판이 멈춰 선 순간이 보였다).
  const at = OPEN_MS * 0.85;
  win.animate([{ opacity: 0 }, { opacity: 0 }], { duration: at });
  g.animate([{ opacity: 1 }, { opacity: 0 }], { delay: at, duration: REVEAL_MS, easing: 'ease-out', fill: 'backwards' }).onfinish = () => g.remove();
}

// 닫기를 누른 순간(창이 걷히기 전) 부른다. 돌아갈 줄이 화면에 있으면 그 줄로 줄어들고, 줄은 잠깐 연한 파랑으로 남는다.
export function morphClose(win, taskId) {
  const id = String(taskId || '');
  const target = id && document.querySelector(`[data-flip="${CSS.escape(id)}"]`);
  if (!target) return;
  const flash = () => { target.classList.remove('dc-was-open'); void target.offsetWidth; target.classList.add('dc-was-open'); };
  const to = target.getBoundingClientRect();
  const from = win?.getBoundingClientRect();
  if (prefersReducedMotion() || !from?.width || !visible(to)) { flash(); return; }
  // 유령이 창 위에서 먼저 짙어진 뒤(COVER — 이 곡선은 그동안 거의 안 움직인다) 줄로 줄어든다. **둘이 같이 옅어지는 순간이 없게**:
  // 창(데스크톱은 창을 품은 뒤판까지)은 유령이 다 덮을 때까지 불투명하게 붙들고, 덮은 뒤에는 유령 밑에서 바로 숨긴다.
  // 예전에는 뒤판의 걷힘(.dc-scrim.dc-out)이 창까지 같이 흐려 첫 순간 대시보드가 비쳤고, 폰은 유령이 줄어드는 동안
  // 창이 둘레에 그대로 남았다가 뚝 사라졌다(사용자 지적 2026-10-28).
  const cover = CLOSE_MS * COVER;
  const g = ghost(from, getComputedStyle(win).borderRadius);
  g.animate([{ transform: 'none' }, { transform: squeeze(to, from) }], { duration: CLOSE_MS, easing: easeMove() });
  g.animate([{ opacity: 0 }, { opacity: 1, offset: COVER }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'linear' }).onfinish = () => g.remove();
  const w = win.animate([{ opacity: 1, transform: 'none' }, { opacity: 1, transform: 'none', offset: 0.99 }, { opacity: 0, transform: 'none' }], { duration: cover + 10, fill: 'forwards' });
  // 뒤판은 유령이 덮은 뒤에 걷힌다(창이 걷히는 EXIT_MS 안에 끝나야 한다 — 그 뒤 뒤판째 빠진다)
  const scrim = win.parentElement?.classList.contains('dc-scrim') ? win.parentElement : null;
  const sc = scrim?.animate([{ opacity: 1 }, { opacity: 1, offset: cover / EXIT_MS }, { opacity: 0 }], { duration: EXIT_MS, fill: 'forwards' });
  // 걷히는 사이 다른 업무로 바뀌어 창이 남는 길(modals.jsx shut)에서 숨긴 채로 굳지 않게 — 빠진 뒤에 푼다
  setTimeout(() => { w.cancel(); sc?.cancel(); }, EXIT_MS + 120);
  setTimeout(flash, CLOSE_MS * 0.8);
}
