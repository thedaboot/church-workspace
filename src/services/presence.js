import { useSyncExternalStore } from 'react';

// ============================================================================
// 지금 접속해 있는 사람 (Realtime presence)
// ----------------------------------------------------------------------------
// 워크스페이스 스토어에 넣지 않는 이유: LOAD_STATE가 상태를 통째로 갈아치우는데,
// 접속 목록은 서버 스냅샷이 아니라 연결 상태라 그 흐름에 섞이면 재조회마다 사라진다.
// 값 하나짜리 외부 스토어가 가장 작다.
// ============================================================================

let online = new Set();          // profile id들. 게스트 모드에서는 언제나 빈 집합
const listeners = new Set();

export function setOnline(ids) {
  online = new Set(ids || []);
  listeners.forEach(l => l());
}

// getSnapshot은 같은 참조를 돌려줘야 한다 — setOnline에서만 교체되므로 안전하다
export function usePresence() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => online,
  );
}
