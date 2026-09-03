import { useSyncExternalStore, useMemo } from 'react';
import { projectYear } from '../utils.js';

// 고른 해(0025) — **탭 줄과 대시보드가 같은 값을 본다.**
// 예전에는 useTabYear 안의 useState였다. 그러면 값이 컴포넌트마다 따로 놀아서, 탭에서
// 2027로 바꿔도 대시보드의 '프로젝트 진행'은 2026에 남는다. 데스크톱 TopNav · 모바일
// MobileTopBar · 대시보드 셋이 같이 보는 값이므로 컴포넌트 밖으로 뺐다.
//
// 워크스페이스 스토어에 섞지 않는 이유는 presence.js와 같다 — LOAD_STATE가 상태를
// 통째로 갈아치우므로 재조회 때마다 고른 해가 사라진다.
// 사람마다 다르고 서버가 알 필요가 없는 값이라 localStorage에 남긴다.
const KEY = 'tab_year';
const thisYear = () => String(new Date().getFullYear());

let value = (() => {
  try { return localStorage.getItem(KEY) || thisYear(); } catch { return thisYear(); }
})();
const subs = new Set();

function setProjectYear(y) {
  const next = String(y);
  if (next === value) return;
  value = next;
  try { localStorage.setItem(KEY, next); } catch { /* 프라이빗 모드 */ }
  subs.forEach(fn => fn());
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => value;

// setProjectYear는 모듈 스코프라 이미 안정 참조다 — useCallback으로 감싸지 않는다.
export function useProjectYear() {
  return [useSyncExternalStore(subscribe, getSnapshot, getSnapshot), setProjectYear];
}

// 고를 수 있는 해 목록과 해마다의 프로젝트 수. 탭 줄과 대시보드가 같은 목록을 봐야
// 한쪽에만 있는 해가 생기지 않는다. 올해는 프로젝트가 없어도 언제나 목록에 있다 —
// 해가 바뀐 직후에 고를 수 있는 해가 하나도 없으면 안 된다.
export function useYearOptions(allProjects) {
  return useMemo(() => {
    const counts = {};
    (allProjects || []).forEach(p => { const y = projectYear(p); counts[y] = (counts[y] || 0) + 1; });
    const set = new Set(Object.keys(counts));
    set.add(thisYear());
    return { years: [...set].sort((a, b) => b.localeCompare(a)), yearCounts: counts };
  }, [allProjects]);
}
