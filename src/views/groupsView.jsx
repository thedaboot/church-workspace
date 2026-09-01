import React from 'react';

// v2 모임 화면 — 내 순(명단 · 출석 현황 · 공유된 예배 노트) · 동아리(목록 · 가입 신청 ·
// 모임 일정/출석). 스펙은 docs/V2.md §1(결정 2·3)·§2. 회차 2 모임 줄기가 이 파일을 채운다.
// App.jsx 라우팅(GLOBAL_MENUS 'groups')은 이미 연결돼 있다.
export function GroupsView() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 text-center text-sm text-fg-muted">
      모임 화면을 만들고 있어요
    </div>
  );
}
