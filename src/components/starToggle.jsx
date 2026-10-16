import React from 'react';
import { Star } from 'lucide-react';
import { useTabStars, toggleTabStar } from '../services/tabStars.js';

// 즐겨찾기 별(시안 2026-10-16) — 프로젝트 제목 바로 뒤. 켜면 그 프로젝트가 **내** 탭 줄 맨 앞 별 줄에 선다
// (services/tabRank.js · tabStars.js). 데스크톱은 프로젝트 머리 제목 옆(projectView), 폰은 상단바 제목 옆(mobileNav).
// 조용하게 둔다 — 꺼진 별은 faint 선, 켜진 별은 노란 태그 글자색으로 채운다(토큰이라 다크를 따라간다).
// hover로만 드러내지 않는다(§8 · 아이패드에서 사라진다). 누르는 자리는 가상 요소로 넓힌다(PITFALLS 9-by).
export function StarToggle({ projectId, size = 15, className = '' }) {
  const stars = useTabStars();
  const on = stars.includes(projectId);
  return (
    <button type="button" onClick={() => toggleTabStar(projectId)} aria-pressed={on} data-star-toggle={on ? 'on' : 'off'}
      title="즐겨찾기"
      className={`relative before:absolute before:-inset-1.5 shrink-0 inline-flex items-center justify-center p-0.5 rounded transition active:scale-90 ${on ? 'text-tag-yellow-fg' : 'text-fg-faint hover:text-fg-muted'} ${className}`}>
      <Star size={size} strokeWidth={1.9} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
