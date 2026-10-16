// 내 프로젝트 탭 차례(시안 2026-10-16) — 규칙은 tabRank.applyTabOrder·moveInTabOrder.
//
// **사람마다 다르다** — 탭을 끌면 내 탭 줄만 움직인다(옛 saveTabOrder는 모두의 position을 고쳤다). 한 번도 끈 적 없으면
// 빈 배열이고, 그때 탭 줄은 모두의 position 순서다. 시안은 브라우저 한 칸(`tab_order_v1` — 프로젝트 id 배열, 차례가 곧
// 탭 순서)에 둔다. 진짜 저장 자리는 사람 행 하나다(profiles.tab_order uuid[] — 기기를 옮겨도 따라오게). 그때도 이 모듈의
// 겉(useTabOrder · setTabOrder)은 그대로 두고 안의 읽기·쓰기만 바꾼다.
//
// 워크스페이스 스토어에 섞지 않는다 — LOAD_STATE가 상태를 통째로 갈아치운다(useProjectYear.js와 같은 이유).
// 지워진 프로젝트의 id가 남아 있어도 괜찮다 — 탭 줄은 지금 있는 것만 고른다(applyTabOrder).
import { useSyncExternalStore } from 'react';

const KEY = 'tab_order_v1';

let value = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
})();
const subs = new Set();

export function setTabOrder(ids) {
  const next = Array.isArray(ids) ? [...new Set(ids)] : [];
  if (next.length === value.length && next.every((x, i) => x === value[i])) return;
  value = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 비공개 모드 — 이번 화면에서만 */ }
  subs.forEach(fn => fn());
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => value;

export function useTabOrder() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
