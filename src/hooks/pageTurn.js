import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './useReducedMotion.js';

// 앞뒤 방향이 있는 넘김(UI 다듬기 2차 M13 · 시안 값 그대로 · PITFALLS 75-d) — 달력의 이전 달·다음 달.
// 다음은 오른쪽에서, 이전은 왼쪽에서 들어온다: 옛 판은 반대쪽으로 45% 밀리며 흐려지고 새 판은 45%에서 제자리로(300ms quint · 둘이 같이).
//
// **View Transitions를 쓰지 않는다** — 그 그림은 맨 위 층에 그려져 부모의 overflow로 잘리지 않아서, 45% 밀린 판이 옆 목록·머리 위로
// 지나갔다(자르려면 겹친 묶음(view-transition-group)이 있어야 하는데 사파리·카카오 인앱이 아직 다 받지 않는다). 대신
//   ① 넘기기 직전 판(el)의 겉모양을 복제해 같은 자리에 겹쳐 두고(누름·검사가 잡지 않게 data-*·id를 걷고 inert)
//   ② 상태 바꿈을 곧바로 그린 뒤(flushSync — React는 같은 el에 새 달을 그린다)
//   ③ 복제는 나가고 el은 들어온다(Web Animations · transform·opacity만).
// 움직이는 동안만 부모를 가로로 자른다(.dc-turn-clip — clip이라 스크롤 통이 생기지 않는다).
// 움직임 줄이기 · 방향 없음 · el.animate 없음이면 commit만 — 지금처럼 그냥 바뀐다.
export const TURN_PAGE = { shift: 45, ms: 300, ease: 'cubic-bezier(.16, 1, .3, 1)' };

const live = new WeakMap();   // el → 지금 나가는 중인 복제
const madeRel = new WeakSet();   // 자리를 잡으려고 position: relative를 준 부모(마지막 복제가 나가면 걷는다)

export function pageTurn(el, dir, commit) {
  if (!el || !dir || !el.animate || prefersReducedMotion()) { commit(); return; }
  const host = el.parentElement;
  live.get(el)?.remove();
  el.getAnimations().forEach(a => a.cancel());
  const hr = host.getBoundingClientRect(), er = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  for (const n of [ghost, ...ghost.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) if (a.name === 'id' || a.name.startsWith('data-')) n.removeAttribute(a.name);
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: 'absolute', margin: '0', pointerEvents: 'none',
    left: `${er.left - hr.left - host.clientLeft}px`, top: `${er.top - hr.top - host.clientTop + host.scrollTop}px`,
    width: `${er.width}px`, height: `${er.height}px`,
  });
  if (getComputedStyle(host).position === 'static') { host.style.position = 'relative'; madeRel.add(host); }
  host.classList.add('dc-turn-clip');
  host.appendChild(ghost);
  live.set(el, ghost);

  flushSync(commit);

  const opt = { duration: TURN_PAGE.ms, easing: TURN_PAGE.ease };
  const out = ghost.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-dir * TURN_PAGE.shift}%)`, opacity: 0 }], { ...opt, fill: 'forwards' });
  el.animate([{ transform: `translateX(${dir * TURN_PAGE.shift}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], opt);
  out.onfinish = out.oncancel = () => {
    ghost.remove();
    if (live.get(el) === ghost) {
      live.delete(el);
      host.classList.remove('dc-turn-clip');
      if (madeRel.has(host)) { host.style.position = ''; madeRel.delete(host); }
    }
  };
}
