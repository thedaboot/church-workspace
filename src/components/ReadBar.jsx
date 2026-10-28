// 읽은 만큼 차는 막대(UI 다듬기 2차 M15 · 시안 값 그대로 · PITFALLS 75-f) — 성경 장 · 위키 장(예배 노트는 넣었다가 뺐다 — 사용자 결정 2026-10-28).
// 머리 아래(스크롤 통의 맨 위)에 붙는 2px 막대가 그 통의 스크롤만큼 바탕 빛 그라데이션(--app-brand-grad)으로 찬다.
// **CSS 스크롤 타임라인 하나다**(index.css `.dc-read-bar` — animation-timeline: scroll(nearest block)) — 스크롤마다 JS가 돌지 않는다.
// 받지 않는 브라우저에서는 막대가 아예 서지 않는다(@supports). 자리를 차지하지 않는다(높이 2px · 아래 여백 -2px) — 아래 글이 밀리지 않게.
// 부모 안에서 sticky라, 부모(읽는 칸)가 화면에 있는 동안만 선다.
export const ReadBar = () => <div className="dc-read-bar" aria-hidden="true"><i /></div>;
