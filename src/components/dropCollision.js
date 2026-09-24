import { pointerWithin, rectIntersection } from '@dnd-kit/core';

// 놓을 곳은 "손가락/커서가 있는 곳" 기준으로 판단한다(칸반 보드·동아리 카드·모바일 프로젝트 탭 공용 · §6-11).
// 기본값(rectIntersection)은 끌고 있는 것의 사각형이 가장 많이 겹친 대상을 고르는데,
// 카드 폭이 상태 칩보다 훨씬 넓어서 엉뚱한 칩에 놓이곤 했다(실측: 완료에 놓았는데 보류 중).
// 포인터가 어떤 대상 안에도 없을 때만(탭 사이 여백 등) 기존 방식으로 되돌린다 — 그러지
// 않으면 끌던 것이 조용히 제자리로 돌아간다.
export const dropCollision = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};
