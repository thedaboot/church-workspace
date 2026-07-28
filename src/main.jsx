// 본문 폰트는 SUIT 한 벌이다(index.css의 @font-face). Pretendard 동적 서브셋 CSS를
// 여기서 같이 불러오던 탓에 배포에 woff2가 92개(약 4MB) 실리고, 첫 화면에서 두 벌의
// 한글 폰트를 받았다. --font-sans의 폴백 이름으로만 남긴다(기기에 깔려 있으면 쓰인다).
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@seed-design/css/base.css';
import './index.css';
import ChurchApp from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChurchApp />
  </React.StrictMode>,
);
