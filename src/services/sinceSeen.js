// 지난 방문의 기준 시각 — '새로 움직인 곳의 옅은 점'(사용자 결정 2026-09-25 · 목업 권장안)이 본다.
//
// **앱을 열 때 한 번만 붙잡는다.** 내 `last_seen_at`은 첫 찍기(App.initialLoad의 markSeen(0))·5분 박동·
// 떠날 때 찍기로 계속 덮인다 — 첫 찍기 **전에** 읽은 값(loadCloudState가 돌려준 내 프로필 행)이
// "지난번에 떠난 때"다. App.jsx가 그 자리에서 captureSeenBase를 부른다. 다시 보일 때 새로 잡지 않는다
// (활동 줄 점은 다음에 앱을 열 때까지 둔다).
//
// 게스트에는 last_seen_at이 없다 — 브라우저 한 칸(`seen_base_v1`)에 지난번 연 시각을 두고 같은 일을 한다
// (열 때마다 지금으로 바뀐다 — 검사는 이동마다 다시 심는다 · PITFALLS 42-i).
//
// 탭 점은 **그 프로젝트를 열면 지운다** — 연(그리고 떠난) 시각을 프로젝트마다 여기 둔다(새로고침하면
// 기준 시각이 새로 잡히므로 따로 남기지 않는다). 워크스페이스 스토어 밖 미니 스토어다(tabFront.js와
// 같은 이유 — LOAD_STATE가 통째로 갈아치운다).
import { useSyncExternalStore } from 'react';

let base = null;              // { at: ms, me: Set<string> } | null
let opened = {};              // { [projectId]: ms }
const subs = new Set();
const emit = () => subs.forEach(fn => fn());

const GUEST_KEY = 'seen_base_v1';

// at: 지난 방문 시각(ISO·ms·null) · me: '나'로 칠 열쇠 배열. 한 번 잡으면 그 세션 동안 그대로다.
export function captureSeenBase({ at, me = [] }) {
  if (base) return;
  const t = typeof at === 'number' ? at : Date.parse(at || '');
  // 처음 온 사람(기록 없음)에게는 점을 찍지 않는다 — 전부 '새로'라면 점이 아무 말도 안 한다
  base = Number.isFinite(t) ? { at: t, me: new Set(me.filter(Boolean)) } : null;
  emit();
}

// 게스트: 지난번 연 시각을 읽고 지금으로 바꿔 둔다
export function captureGuestSeenBase(myName) {
  let prev = null;
  try { prev = localStorage.getItem(GUEST_KEY); localStorage.setItem(GUEST_KEY, new Date().toISOString()); } catch { /* 비공개 모드 */ }
  captureSeenBase({ at: prev, me: [myName] });
}

export function markProjectOpened(projectId, now = Date.now()) {
  if (!projectId) return;
  opened = { ...opened, [projectId]: now };
  emit();
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getBase = () => base;
const getOpened = () => opened;
export const useSeenBase = () => useSyncExternalStore(subscribe, getBase, getBase);
export const useOpenedProjects = () => useSyncExternalStore(subscribe, getOpened, getOpened);
