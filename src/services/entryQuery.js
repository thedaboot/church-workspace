import { useSyncExternalStore } from 'react';

// ============================================================================
// 진입 주소의 물음표 뒤 값 — 화면이 **한 번 읽고 지우는** 자리.
// ----------------------------------------------------------------------------
// v2 화면(홈·예배·말씀·모임)은 GLOBAL_MENUS라 App이 주소를 `/`로 정리한다(App.jsx의
// URL 동기화 효과). 그래서 `/?p=worship&s=<주보 id>` 같은 딥링크의 나머지 값(s)은
// 첫 렌더 뒤 곧 사라진다. 여기서 **모듈이 처음 실행될 때** 붙잡아 두고, 화면이 마운트되며
// `takeEntryParam('s')`로 가져가 쓴다(가져가면 지운다 — 같은 값으로 두 번 열지 않게).
//
// 앱이 떠 있는 동안 알림(종)에서 딥링크를 누르면 새로고침 없이 `setEntryQuery(search)`로
// 같은 자리에 값을 다시 넣고 신호를 보낸다. 화면은 `useEntryQuery()`를 의존성에 두면
// 그 순간 다시 읽는다.
//
// 값 이름(약속):  p = 화면(App이 읽음) · s = 주보 id · g = 모임(동아리) id ·
//                apply = 1이면 그 동아리 가입 신청까지 · t = 업무 id(기존)
// ============================================================================
let params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const listeners = new Set();
let version = 0;

const emit = () => { version += 1; listeners.forEach(l => l()); };

export const entryParam = (key) => params.get(key);

export function takeEntryParam(key) {
  const v = params.get(key);
  if (v !== null) { params.delete(key); }
  return v;
}

// search: '?p=groups&g=…' 또는 'p=groups&g=…' 또는 '/?p=…' 전체 주소 — 물음표 뒤만 쓴다
export function setEntryQuery(search) {
  const s = String(search || '');
  const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : s;
  params = new URLSearchParams(q);
  emit();
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => version;
export const useEntryQuery = () => useSyncExternalStore(subscribe, snapshot, snapshot);

// 우리 딥링크인가('/'로 시작, '//' 아님) — 알림의 link 칸은 DB CHECK도 같은 규칙이다(0053)
export const isAppLink = (link) => typeof link === 'string' && link.startsWith('/') && !link.startsWith('//');
