// 본문 폰트는 SUIT 한 벌이다(index.css의 @font-face). Pretendard 동적 서브셋 CSS를
// 여기서 같이 불러오던 탓에 배포에 woff2가 92개(약 4MB) 실리고, 첫 화면에서 두 벌의
// 한글 폰트를 받았다. --font-sans의 폴백 이름으로만 남긴다(기기에 깔려 있으면 쓰인다).
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ChurchApp from './App.jsx';
import { installErrorCapture } from './services/errorReport.js';

// 앱 내 오류를 관리자 메뉴로 보낸다(0113 · 클라우드만 · 세션에 지문 하나는 한 번 — services/errorReport.js)
installErrorCapture();

// 배포 뒤에 열려 있던 탭은 옛 조각 이름을 찾다가 404가 난다(늦게 싣는 화면 · 2026-10-09). Vite가 알려 주면 한 번만
// 새로 불러 새 판을 받는다 — 10초 안에 또 나면 그대로 둔다(계속 새로 고치는 고리를 막는다).
// **오프라인이면 새로 고치지 않는다**(2026-10-15) — 조각을 못 받은 까닭이 배포가 아니라 끊긴 연결이라, 새로 고치면 브라우저의
// '오프라인' 페이지에 떨어져 앱이 통째로 사라진다. 연결이 돌아오는 순간(online) 한 번 새로 불러 그 화면을 받는다.
let reloadOnline = false;
window.addEventListener('vite:preloadError', (e) => {
  if (navigator.onLine === false) {
    if (!reloadOnline) { reloadOnline = true; window.addEventListener('online', () => location.reload(), { once: true }); }
    return;
  }
  let last = 0;
  try { last = Number(sessionStorage.getItem('chunk-reload-at')) || 0; } catch { /* 저장소가 막힌 브라우저 */ }
  if (Date.now() - last < 10e3) return;
  try { sessionStorage.setItem('chunk-reload-at', String(Date.now())); } catch { /* 위와 같다 */ }
  e.preventDefault();
  location.reload();
});

// 새가족 QR이 여는 새가족 정보 입력 — 로그인 없이 그 한 장만 그린다(앱 셸·로그인을 거치지 않는다 · components/newcomerCard.jsx · 0120)
const NewcomerCardPage = React.lazy(() => import('./components/newcomerCard.jsx').then(m => ({ default: m.NewcomerCardPage })));
const welcome = new URLSearchParams(window.location.search).has('welcome');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {welcome ? <React.Suspense fallback={null}><NewcomerCardPage /></React.Suspense> : <ChurchApp />}
  </React.StrictMode>,
);
