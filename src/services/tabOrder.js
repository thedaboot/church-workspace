// 내 프로젝트 탭 차례 — 규칙은 tabRank.applyTabOrder·moveInTabOrder (시안 2026-10-16 · 실제 붙이기 v5 1묶음 C · 0108).
//
// **사람마다 다르다** — 탭을 끌면 내 탭 줄만 움직인다(옛 saveTabOrder는 모두의 position을 고쳤다). 한 번도 끈 적 없으면
// 빈 배열이고, 그때 탭 줄은 모두의 position 순서다. 이 모듈의 겉(useTabOrder · setTabOrder)은 시안 그대로이고 안만 둘로 갈린다:
//   · 클라우드 — 계정 행 한 칸 `profiles.tab_order uuid[]`(0108 · 기기를 옮겨도 따라온다 · 본인만 고친다 — 칸 가드 트리거).
//     읽기는 cloudSync.loadCloudState가 내 프로필 행(합친 계정이면 남긴 계정)을 읽을 때 primeTabOrder로 넣는다.
//     쓰기는 그 행 update 한 번(myUid). 칸이 아직 없으면(0108 전) 읽기는 브라우저 한 칸 그대로, 쓰기는 콘솔에만 남는다(§3-4).
//   · 게스트 — 브라우저 한 칸(`tab_order_v1` — 프로젝트 id 배열, 차례가 곧 탭 순서). 지금처럼.
// 클라우드에서도 브라우저 한 칸에 같이 적어 둔다 — 첫 그리기(로드 전)에 지난 차례가 바로 선다.
//
// 워크스페이스 스토어에 섞지 않는다 — LOAD_STATE가 상태를 통째로 갈아치운다(useProjectYear.js와 같은 이유).
// 지워진 프로젝트의 id가 남아 있어도 괜찮다 — 탭 줄은 지금 있는 것만 고른다(applyTabOrder).
import { useSyncExternalStore } from 'react';
import { supabase, myUid } from './supabaseClient.js';

const KEY = 'tab_order_v1';
const clean = (ids) => (Array.isArray(ids) ? [...new Set(ids.filter(x => typeof x === 'string'))] : []);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let value = (() => {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
})();
const subs = new Set();

function put(next) {
  value = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 비공개 모드 — 이번 화면에서만 */ }
  subs.forEach(fn => fn());
}

// 클라우드 저장 — 마지막 것만 남는다(끌 때마다 한 번 · 겹쳐도 뒤의 값이 이긴다)
let saving = 0;
async function saveCloud(next) {
  const my = ++saving;
  try {
    const uid = await myUid();
    if (!uid || my !== saving) return;
    const { error } = await supabase.from('profiles').update({ tab_order: next }).eq('id', uid);
    if (error) throw error;
  } catch (e) {
    // 화면의 차례는 그대로 둔다 — 다른 기기에 한 번 덜 따라갈 뿐이라 토스트를 띄우지 않는다
    console.warn('[tabs] 탭 차례를 저장하지 못했어요:', e?.message || e);
  }
}

export function setTabOrder(ids) {
  const next = clean(ids);
  if (same(next, value)) return;
  put(next);
  if (supabase) saveCloud(next);
}

// 내 프로필 행의 tab_order — 칸이 없으면(undefined · 0108 전) 브라우저 값을 그대로 둔다
export function primeTabOrder(fromProfile) {
  if (!Array.isArray(fromProfile)) return;
  const next = clean(fromProfile);
  if (!same(next, value)) put(next);
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => value;

export function useTabOrder() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
