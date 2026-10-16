// 내 즐겨찾기 프로젝트와 그 차례(시안 2026-10-16) — 탭 줄 맨 앞에 서는 것(규칙은 tabRank.splitStarredTabs).
//
// **사람마다 다르다** — 별을 달고 끌어서 바꾸는 것은 내 탭 줄만 움직인다(옛 saveTabOrder는 모두의 position을 고쳤다).
// 시안은 브라우저 한 칸(`tab_stars_v1` — 프로젝트 id 배열, 차례가 곧 탭 순서)에 둔다. 진짜 저장 자리는
// 사람 행 하나다(profiles에 id 배열 한 칸 — 계정을 바꾸거나 기기를 옮겨도 따라오게). 그때도 이 모듈의
// 겉(useTabStars · toggleTabStar · setTabStars)은 그대로 두고 안의 읽기·쓰기만 바꾼다.
//
// 워크스페이스 스토어에 섞지 않는다 — LOAD_STATE가 상태를 통째로 갈아치운다(useProjectYear.js와 같은 이유).
// 지워진 프로젝트의 id가 남아 있어도 괜찮다 — 탭 줄은 지금 있는 것만 고른다(splitStarredTabs).
import { useSyncExternalStore } from 'react';
import { toggleStarId } from './tabRank.js';

const KEY = 'tab_stars_v1';

let value = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
})();
const subs = new Set();

export function setTabStars(ids) {
  const next = Array.isArray(ids) ? [...new Set(ids)] : [];
  if (next.length === value.length && next.every((x, i) => x === value[i])) return;
  value = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 비공개 모드 — 이번 화면에서만 */ }
  subs.forEach(fn => fn());
}

export const toggleTabStar = (id) => setTabStars(toggleStarId(value, id));

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => value;

export function useTabStars() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
