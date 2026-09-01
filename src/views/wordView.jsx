import React from 'react';

// v2 말씀 화면 — 매일성경(오늘 본문 · 묵상 기록 · 개인 잔디 · 나눔) | 성경 읽기(리더 ·
// 북마크 · 이어읽기). 본문 데이터는 public/bible/*.json(개역한글) — scripts/bible_check.mjs가
// 정합을 본다. 스펙은 docs/V2.md §1(결정 8~12)·§2. 회차 2 말씀 줄기가 이 파일을 채운다.
// App.jsx 라우팅(GLOBAL_MENUS 'word')은 이미 연결돼 있다.
export function WordView() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 text-center text-sm text-fg-muted">
      말씀 화면을 만들고 있어요
    </div>
  );
}
