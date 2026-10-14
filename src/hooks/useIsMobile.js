import { useState, useEffect } from 'react';

// 폭 판정 훅 — 리사이즈·회전에 반응한다. CSS로 감추지 않고 **한쪽만 마운트**할 때 쓴다(PITFALLS §6-3).
function useMedia(query) {
  const [hit, setHit] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return hit;
}

// md 미만(768px) 여부 — 모바일 전용 레이아웃(업무 모달 풀스크린, 캘린더 점 표시 등)이 공유해서 쓴다.
export const useIsMobile = () => useMedia('(max-width: 767px)');

// lg 미만(1024px) 여부 — 데스크톱 상단 바가 아이패드 세로(768~1023)에서 다붓이 알약·찾기 칸을
// 얼굴·돋보기 버튼으로 줄인다(layout.jsx TopNav · PITFALLS 51-a). 찾기는 칸과 버튼이 state가 달라 한쪽만 마운트한다.
export const useIsNarrowDesk = () => useMedia('(max-width: 1023px)');
