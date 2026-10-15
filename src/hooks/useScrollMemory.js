import { useEffect, useLayoutEffect, useRef } from 'react';

// ============================================================================
// 목록 → 상세 → 목록에서 목록의 자리를 지킨다 (2026-10-15 · PITFALLS 56-h)
// ----------------------------------------------------------------------------
// 스크롤하는 통은 App의 `main` 하나라(§6-2) 상세로 들어가도 scrollTop이 그대로 남았다 — 상세가 중간부터 열리고,
// 돌아오면 목록이 엉뚱한 자리(상세에서 내려간 만큼)에 섰다. 주보 목록·동아리 목록·폰 위키 첫 화면이 쓴다.
//   useScrollMemory(inDetail)
//     inDetail이 false → true: 목록에서 마지막으로 본 자리를 기억하고 상세는 맨 위에서 연다
//     true → false: 기억한 자리로 **즉시** 돌아간다(움직이면 '어디로 가나'가 보인다 — 돌아온 자리 그대로가 맞다)
//   처음 마운트가 상세면(딥링크·알림) 기억한 것이 없으니 아무것도 하지 않는다.
// 목록의 자리는 **스크롤할 때마다 적어 둔다** — 상세로 바뀐 뒤에 재면 이미 상세 높이에 눌린(clamp) 값이다.
// 그래서 부르는 쪽은 넘어가는 순간에 main을 직접 맨 위로 올리지 말 것(그 0이 목록 자리로 적힌다).
// ============================================================================
const mainEl = () => (typeof document !== 'undefined' ? document.querySelector('main') : null);

export function useScrollMemory(inDetail) {
  const live = useRef(0);       // 목록에 있는 동안 마지막 scrollTop
  const saved = useRef(null);   // 상세로 들어갈 때 기억한 목록 자리
  const was = useRef(inDetail);

  useEffect(() => {
    if (inDetail) return undefined;
    const m = mainEl();
    if (!m) return undefined;
    const note = () => { live.current = m.scrollTop; };
    note();
    m.addEventListener('scroll', note, { passive: true });
    return () => m.removeEventListener('scroll', note);
  }, [inDetail]);

  // 그림이 나가기 전에 옮긴다(App의 화면 바꿈 되돌리기와 같은 이유 — 한 프레임 어긋난 자리가 안 보이게)
  useLayoutEffect(() => {
    if (was.current === inDetail) return;
    was.current = inDetail;
    const m = mainEl();
    if (!m) return;
    if (inDetail) {
      saved.current = live.current;
      m.scrollTop = 0;
    } else if (saved.current != null) {
      m.scrollTop = saved.current;
      live.current = m.scrollTop;
      saved.current = null;
    }
  }, [inDetail]);
}
