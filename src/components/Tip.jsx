import { useEffect, useRef } from 'react';

// ============================================================================
// 툴팁 한 벌(UI 다듬기 2차 M6 · 2026-10-27 · 시안 값 그대로 · PITFALLS 74-a) — `data-tip="굵게"`가 달린 요소에 마우스를 올리거나
// 키보드로 초점을 옮기면(:focus-visible) 그 아래 6px에 뜬다. App에 TipHost 하나만 두고 문서에서 이벤트를 받는다(부품마다 상태를 들지 않는다).
//   · 처음 것만 500ms 기다렸다가 .16s 동안 떠오른다. **하나가 떠 있는 동안 · 닫힌 뒤 400ms 안에는** 옆 것이 기다림·움직임 없이 바로 뜬다
//     (도구 줄을 훑을 때 끈적이지 않게 — 브라우저 기본 title은 버튼마다 다시 기다린다).
//   · 떠날 때는 60ms 뒤에 닫는다(버튼 사이 틈을 지날 때 깜빡이지 않게). 누르거나 굴리면 바로 닫는다(링크 판이 그 자리에 뜬다).
//   · 손가락은 받지 않는다 — 브라우저 기본 title도 폰에서는 안 뜨고, 눌러 서식을 켤 때마다 이름이 글 위에 남으면 가린다.
//   · `title`을 같이 두지 않는다 — 브라우저 기본 툴팁이 겹쳐 뜬다. 이름은 aria-label로(화면 읽기).
// 지금 쓰는 곳: 편집기 서식 줄(MarkdownEditor `TB`). 앱 곳곳의 아이콘 버튼은 아직 title이다(검사들이 `[title=…]`로 잡는다 — 74-a).
// ============================================================================
export const TIP = { delay: 500, closeAfter: 60, warm: 400, gap: 6, edge: 8 };

export function TipHost() {
  const tipRef = useRef(null);
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'dc-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    document.body.appendChild(tip);
    tipRef.current = tip;
    let openT = 0, closeT = 0, warmT = 0, open = false, warm = false, cur = null;

    const place = (el) => {
      const r = el.getBoundingClientRect();
      tip.style.top = `${r.bottom + TIP.gap}px`;
      tip.style.left = '0px';
      const half = tip.offsetWidth / 2;
      const x = Math.min(Math.max(r.left + r.width / 2, TIP.edge + half), window.innerWidth - TIP.edge - half);
      tip.style.left = `${x}px`;
    };
    const show = (el, instant) => {
      if (!el.isConnected) return;
      tip.textContent = el.dataset.tip || '';
      tip.hidden = false;
      tip.classList.remove('dc-tip-anim');
      place(el);
      if (!instant) { void tip.offsetWidth; tip.classList.add('dc-tip-anim'); }
      open = true; cur = el;
    };
    const hide = () => { tip.hidden = true; tip.classList.remove('dc-tip-anim'); open = false; cur = null; };
    const enter = (el) => {
      clearTimeout(openT); clearTimeout(closeT);
      if (open || warm) { show(el, true); return; }
      hide();
      openT = setTimeout(() => show(el, false), TIP.delay);
    };
    const leave = () => {
      clearTimeout(openT); clearTimeout(closeT);
      closeT = setTimeout(() => {
        const was = open; hide();
        if (was) { warm = true; clearTimeout(warmT); warmT = setTimeout(() => { warm = false; }, TIP.warm); }
      }, TIP.closeAfter);
    };
    const shut = () => { clearTimeout(openT); clearTimeout(closeT); hide(); };
    const target = (e) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);

    let hov = null;   // 마우스가 지금 올라가 있는 data-tip 요소(안의 아이콘으로 옮겨 가도 같은 것)
    const over = (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = target(e);
      if (el === hov) return;
      hov = el;
      if (el) enter(el); else if (open || openT) leave();
    };
    const out = (e) => {
      if (e.pointerType !== 'mouse' || !hov) return;
      if (e.relatedTarget instanceof Node && hov.contains(e.relatedTarget)) return;
      hov = null; leave();
    };
    const focusIn = (e) => { const el = target(e); if (el && el.matches(':focus-visible')) enter(el); };
    const focusOut = (e) => { if (target(e)) leave(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('pointerdown', shut, true);
    window.addEventListener('scroll', shut, true);
    return () => {
      clearTimeout(openT); clearTimeout(closeT); clearTimeout(warmT);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('pointerdown', shut, true);
      window.removeEventListener('scroll', shut, true);
      tip.remove();
    };
  }, []);
  return null;
}
