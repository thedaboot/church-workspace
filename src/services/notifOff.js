// 끈 알림 — 알림 종 '알림 설정'의 값(갈래 'task' · 항목 'task.mention' · 규칙은 notifyPrefs.js · v5 2묶음 · 0113).
//
// 겉(useNotifOff · setNotifOff)은 시안 그대로이고 안만 둘로 갈린다(tabOrder.js와 같은 짜임):
//   · 클라우드 — 계정 행 한 칸 `profiles.notif_off text[]`(0113 · 본인만 고친다 — 칸 가드 트리거). 읽기는 cloudSync.loadCloudState가
//     내 프로필 행(합친 계정이면 남긴 계정)을 읽을 때 primeNotifOff로 넣는다. 쓰기는 그 행 update 한 번(myUid).
//     **이 값이 서버에서 알림을 막는다** — notifications BEFORE INSERT 트리거가 끈 종류의 행을 넣지 않고, api/push.js loadTargets가
//     같은 표로 푸시를 거른다. 화면의 거르기(filterNotifs)는 끄기 전에 이미 받은 알림을 가리는 몫이다.
//     저장이 실패하면 화면 값을 되돌리고 그 오류를 돌려준다 — 부르는 쪽(알림 종)이 토스트(`저장하지 못했어요` + 이유)를 띄운다
//     (켜 둔 줄 알았는데 푸시가 계속 오면 안 된다).
//   · 게스트 — 브라우저 한 칸(`notif_off_v1`).
// 클라우드에서도 브라우저 한 칸에 같이 적어 둔다 — 첫 그리기(로드 전)에 지난 값이 바로 선다.
import { useSyncExternalStore } from 'react';
import { supabase, myUid } from './supabaseClient.js';

const KEY = 'notif_off_v1';
const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x))].slice(0, 40) : []);
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

// 클라우드 저장 — 마지막 것만 남는다(누를 때마다 한 번 · 겹치면 뒤의 값이 이긴다). 실패하면 그 전 값으로 되돌리고 오류를 돌려준다.
let saving = 0;
async function saveCloud(next, prev) {
  const my = ++saving;
  try {
    const uid = await myUid();
    if (!uid) throw new Error('로그인이 필요합니다.');
    if (my !== saving) return null;
    const { error } = await supabase.from('profiles').update({ notif_off: next }).eq('id', uid);
    if (error) throw error;
    return null;
  } catch (e) {
    console.error('[notif] 알림 설정을 저장하지 못했어요:', e?.message || e);
    if (my === saving) put(prev);
    return e;
  }
}

// → Promise<null | 오류>(게스트는 늘 null)
export function setNotifOff(next) {
  const v = clean(typeof next === 'function' ? next(value) : next);
  if (same(v, value)) return Promise.resolve(null);
  const prev = value;
  put(v);
  return supabase ? saveCloud(v, prev) : Promise.resolve(null);
}

// 내 프로필 행의 notif_off — 칸이 없으면(undefined · 0113 전) 브라우저 값을 그대로 둔다
export function primeNotifOff(fromProfile) {
  if (!Array.isArray(fromProfile)) return;
  const next = clean(fromProfile);
  if (!same(next, value)) put(next);
}

const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const getSnapshot = () => value;

export function useNotifOff() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
