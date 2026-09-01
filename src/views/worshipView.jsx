import React from 'react';

// v2 예배 화면 — 주보 목록/상세(말씀·임사자·찬양·광고) · 작성/발행 · 출석 체크 · 예배 노트.
// 스펙은 docs/V2.md §1(결정 4·5·6·7·14)·§2. 회차 2 예배 줄기가 이 파일을 채운다.
// App.jsx 라우팅(GLOBAL_MENUS 'worship')은 이미 연결돼 있다.
export function WorshipView() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 text-center text-sm text-fg-muted">
      예배 화면을 만들고 있어요
    </div>
  );
}
