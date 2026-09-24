import { useEffect, useRef } from 'react';

// 바깥 누름 · Esc로 떠 있는 것(팝오버·목록)을 닫는다. 세 파일에 한 벌씩 있던 것을 모았다(2026-09-24).
//
// refs: 이 안을 누르면 '바깥'이 아니다 — **포털로 나간 목록도 넣는다.** body 포털은 앵커의
//   자손이 아니라서 앵커만 보면 목록 안을 누르는 것이 바깥으로 잡힌다(§6-0 · ConfirmPopover도
//   같은 이유로 그렇게 한다). 렌더마다 새 배열이어도 담긴 ref 객체는 그대로라 open에만 반응한다.
// close: 언제나 **마지막 렌더의 것**을 부른다(ref로 들고 있다) — 닫으면서 지금 값을 되돌리는
//   자리(worshipPassage의 BookInput)가 열 때의 옛 값으로 되돌리지 않게.
// touch: touchstart까지 듣는다 — 터치 기기에는 mousedown이 늦게(또는 아예 안) 온다.
//   모임 화면의 피커(groupsParts)만 켠다. 나머지 자리는 원래 mousedown만 들었고 그대로 둔다.
export function useDismiss(open, close, refs, { touch = false } = {}) {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!refs.some(r => r.current?.contains(e.target))) cb.current(); };
    const onKey = (e) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('mousedown', onDown);
    if (touch) document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      if (touch) document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
