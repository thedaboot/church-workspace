import { store } from '../store/workspaceStore.js';
import { TaskService } from './domain.js';
import { makeViewPw } from './viewPw.js';

// ============================================================================
// 게스트 시연 표식(v5 2묶음 시안 · mock/b3) — 미리보기에서 폰 기능을 눌러 볼 길. **클라우드에서는 아무것도 안 한다.**
//   ?demo=lock   남이 잠근 업무 하나(비밀번호 1234 · demoLock)를 첫 프로젝트에 심는다 — 다시 부르면 다시 잠긴 상태로.
//                이 업무는 창을 닫으면 다시 잠긴다(modals.jsx — '다음에 열 때' 생체 인증 버튼을 보이려고).
//   ?demo=kakao  카카오톡 인앱인 척(services/inApp.js — 알림 판 줄 · 생체 인증 숨김)
// 표식은 한 번 읽고 주소에서 지운다(kakao는 탭 동안 sessionStorage에 남는다).
// ============================================================================

export const DEMO_LOCK_ID = 'demo-lock-task';
export const DEMO_LOCK_PW = '1234';

export async function ensurePhoneDemo({ cloud = false } = {}) {
  if (cloud || typeof window === 'undefined') return;
  let want = '';
  try { want = new URLSearchParams(window.location.search).get('demo') || ''; } catch { return; }
  if (want !== 'lock') return;
  const st = store.getState();
  const projectId = st.projects?.allIds?.[0];
  if (!projectId) return;
  const lockPw = await makeViewPw(DEMO_LOCK_PW);
  const had = st.tasks.byId[DEMO_LOCK_ID];
  const base = had || { ...TaskService.create({ projectId, title: '잠긴 업무 시연', status: '진행 중', assignees: ['조해리'], teams: [], content: '비밀번호로 연 사람만 보는 본문이에요.' }, '조해리'), id: DEMO_LOCK_ID };
  const task = { ...base, locked: true, lockedOpen: false, lockPw, demoLock: true };
  const tasks = { byId: { ...st.tasks.byId, [DEMO_LOCK_ID]: task }, allIds: had ? st.tasks.allIds : [...st.tasks.allIds, DEMO_LOCK_ID] };
  store.dispatch({ type: 'LOAD_STATE', payload: { ...st, tasks } });
  try { localStorage.setItem('church_app_v4', JSON.stringify(store.getState())); } catch { /* 막힌 저장소 */ }
  try { const u = new URL(window.location.href); u.searchParams.delete('demo'); window.history.replaceState(window.history.state, '', u); } catch { /* 옛 브라우저 */ }
}
