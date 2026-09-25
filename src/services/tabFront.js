// 프로젝트 탭 줄 앞 칸의 숫자(사람 수·마지막 활동) — **앱을 열 때와 다시 보일 때만** 잰다.
// 판정 규칙은 tabRank.js(순수)이고, 여기는 언제 재고 어디에 두는지만 맡는다.
//
// 워크스페이스 스토어에 넣지 않는다 — LOAD_STATE가 상태를 통째로 갈아치우고, 실시간 재조회는
// 보고 있는 동안에도 돈다. 그 흐름을 타면 남의 활동 하나에 탭이 손가락 밑에서 튄다.
// 그래서 presence.js·useProjectYear.js처럼 모듈 밖 미니 스토어에 두고, App.jsx가
// 첫 로드 뒤 한 번 + visibilitychange(보임)마다 refreshTabFront를 부른다.
//
// 게스트 모드에는 activity 표가 없어 스토어 업무의 activityLog로 같은 줄을 만든다
// (tabRank.guestActivityRows) — 게스트는 한 사람이라 보통 앞 칸이 비고, 지금과 같은 줄이 선다.
import { useSyncExternalStore } from 'react';
import { store } from '../store/workspaceStore.js';
import * as cloudSync from './cloudSync.js';
import { activityStats, guestActivityRows, FRONT_DAYS } from './tabRank.js';

let stats = null;          // { [projectId]: { people, lastAt } } — null이면 앞 칸 없음
// 잰 줄 그대로 — 탭 왼쪽의 '지난 방문 이후 남이 움직인 곳' 점(traces.freshProjectIds)이 본다.
// 같은 때(열 때·다시 보일 때)에만 바뀌므로 점도 보는 동안 튀지 않는다.
let rows = [];
let seq = 0;
const subs = new Set();

export async function refreshTabFront(cloudMode) {
  const my = ++seq;
  try {
    const now = Date.now();
    const got = cloudMode
      ? await cloudSync.loadTabActivity(FRONT_DAYS, now)
      : guestActivityRows(store.getState().tasks);
    if (my !== seq) return;                 // 더 나중에 시작한 읽기가 이긴다
    stats = activityStats(got, now);
    rows = got;
    subs.forEach(fn => fn());
  } catch (e) {
    // 못 읽으면 지난 값을 그대로 둔다 — 탭 순서가 한 번 덜 새로워질 뿐이라 알리지 않는다
    console.warn('[tabs] 최근 활동을 읽지 못했어요:', e);
  }
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => stats;
const getRows = () => rows;

export function useTabFrontStats() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useTabActivityRows() {
  return useSyncExternalStore(subscribe, getRows, getRows);
}
