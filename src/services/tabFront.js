// 프로젝트 탭 왼쪽 점(traces.freshProjectIds)이 보는 최근 활동 줄 — **앱을 열 때와 다시 보일 때만** 읽는다.
// 옛 '앞 칸'의 숫자(사람 수·마지막 활동)도 여기서 쟀는데, 탭 줄 앞은 즐겨찾기로 바뀌었다(tabRank.js 머리말).
//
// 워크스페이스 스토어에 넣지 않는다 — LOAD_STATE가 상태를 통째로 갈아치우고, 실시간 재조회는
// 보고 있는 동안에도 돈다. 그 흐름을 타면 남의 활동 하나에 점이 보는 동안 튄다.
// 그래서 presence.js·useProjectYear.js처럼 모듈 밖 미니 스토어에 두고, App.jsx가
// 첫 로드 뒤 한 번 + visibilitychange(보임)마다 refreshTabFront를 부른다.
//
// 게스트 모드에는 activity 표가 없어 스토어 업무의 activityLog로 같은 줄을 만든다(tabRank.guestActivityRows).
import { useSyncExternalStore } from 'react';
import { store } from '../store/workspaceStore.js';
import * as cloudSync from './cloudSync.js';
import { guestActivityRows, FRONT_DAYS } from './tabRank.js';

// 잰 줄 그대로 — 같은 때(열 때·다시 보일 때)에만 바뀌므로 점도 보는 동안 튀지 않는다.
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
    rows = got;
    subs.forEach(fn => fn());
  } catch (e) {
    // 못 읽으면 지난 값을 그대로 둔다 — 점이 한 번 덜 새로워질 뿐이라 알리지 않는다
    console.warn('[tabs] 최근 활동을 읽지 못했어요:', e);
  }
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getRows = () => rows;

export function useTabActivityRows() {
  return useSyncExternalStore(subscribe, getRows, getRows);
}
