// 본문 폰트는 SUIT 한 벌이다(index.css의 @font-face). Pretendard 동적 서브셋 CSS를
// 여기서 같이 불러오던 탓에 배포에 woff2가 92개(약 4MB) 실리고, 첫 화면에서 두 벌의
// 한글 폰트를 받았다. --font-sans의 폴백 이름으로만 남긴다(기기에 깔려 있으면 쓰인다).
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ChurchApp from './App.jsx';

// 배포 뒤에 열려 있던 탭은 옛 조각 이름을 찾다가 404가 난다(늦게 싣는 화면 · 2026-10-09). Vite가 알려 주면 한 번만
// 새로 불러 새 판을 받는다 — 10초 안에 또 나면 그대로 둔다(계속 새로 고치는 고리를 막는다).
window.addEventListener('vite:preloadError', (e) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('chunk-reload-at')) || 0; } catch { /* 저장소가 막힌 브라우저 */ }
  if (Date.now() - last < 10e3) return;
  try { sessionStorage.setItem('chunk-reload-at', String(Date.now())); } catch { /* 위와 같다 */ }
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChurchApp />
  </React.StrictMode>,
);
