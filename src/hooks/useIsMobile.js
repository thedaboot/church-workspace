import { useState, useEffect } from 'react';

// md 미만(768px) 여부 — 리사이즈·회전에 반응한다.
// 모바일 전용 레이아웃(업무 모달 풀스크린, 캘린더 점 표시 등)이 공유해서 쓴다.
const QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
