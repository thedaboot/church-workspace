import { prefersReducedMotion } from './useReducedMotion.js';
import { easeMove } from './useFlip.js';

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
let origin = null;   // { id, rect, at }

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target?.closest?.('[data-flip]');
    origin = el ? { id: el.dataset.flip, rect: el.getBoundingClientRect(), at: performance.now() } : null;
  }, true);
}

const visible = (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;

function ghost(to) {
  const g = document.createElement('div');
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('data-morph-ghost', '');
  Object.assign(g.style, {
    position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    background: 'var(--app-surface)', border: '1px solid var(--app-line)', borderRadius: '12px',
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
  const to = win.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const g = ghost(to);
  // 자라기(quint)와 엇갈려 사라지기(직선)를 따로 돌린다 — 한 애니메이션의 구간으로 두면 quint가 앞 구간을 120ms에 끝내고
  // 창이 뜨기 전 100ms 동안 빈 판이 멈춰 서 있었다.
  g.animate([{ transform: squeeze(o.rect, to) }, { transform: 'none' }], { duration: OPEN_MS, easing: easeMove() });
  g.animate([{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], { duration: OPEN_MS, easing: 'linear' }).onfinish = () => g.remove();
  win.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'linear' });
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
  const g = ghost(from);
  g.animate([{ transform: 'none' }, { transform: squeeze(to, from) }], { duration: CLOSE_MS, easing: easeMove() });
  g.animate([{ opacity: 0.9 }, { opacity: 0.9, offset: 0.75 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'linear' }).onfinish = () => g.remove();
  setTimeout(flash, CLOSE_MS * 0.8);
}
