import { store } from '../store/workspaceStore.js';

// ============================================================================
// 게스트 시연 — 다붓이 답 순서(v5 2묶음 · 게스트만): 기록을 살피는 말 → **찾은 근거 칩 먼저** → 답 작성 → 검사 끝난 답을 한 문장씩.
// 클라우드에서는 쓰지 않는다(services/wiki.askDabooti의 게스트 갈래만). 검사(tests/wiki)가 넣는 window.__dabootiAnswer가 있으면 그쪽이 먼저다.
// '수련회'가 든 질문만 받는다(입력 칸 자리표 '예: 수련회 준비는 언제부터 해요?') — 나머지는 예전처럼 '찾을 수 없어요'.
// 답 글은 게스트 워크스페이스의 업무(수련회 포스터 디자인)와 함께 쓰는 글(더다붓 소개)을 가리키는 **시연용 글**이다.
// 시간: 기록 모음 0 → 근거 1.4초 → 답 작성 2.3초 → 답 3.6초(기다리는 말은 1.5초부터 선다 — wikiCore.waitLine).
// ============================================================================

export const DEMO_STEPS = { evidence: 1400, answer: 2300, done: 3600 };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

export function demoAnswerFor(q) {
  if (!/수련회/.test(String(q || ''))) return null;
  const st = store.getState();
  const task = st.tasks.allIds.map(id => st.tasks.byId[id]).find(t => /수련회/.test(t?.title || '') && !t.locked);
  const project = task ? st.projects.byId[task.projectId] : null;
  const card = task ? { t: 'card', id: task.id, label: task.title } : null;
  const page = { t: 'page', id: 'intro', label: '더다붓 소개' };
  const cites = card ? [card, page] : [page];
  const due = task?.dueDate ? `${Number(task.dueDate.slice(5, 7))}월 ${Number(task.dueDate.slice(8, 10))}일` : '';
  const sentences = [
    { text: `수련회 준비는 '${project?.title || '여름 수련회 준비'}' 프로젝트에서 하고 있어요.`, cites: card ? [card] : [page] },
    ...(card ? [{ text: `지금은 '${task.title}' 업무가 ${task.status || '진행 중'}이고${due ? `, 마감은 ${due}이에요` : '요'}.`, cites: [card] }] : []),
    { text: '청년부 행사 준비는 보통 임원진과 담당 팀이 함께 일정을 정해요.', cites: [page] },
  ];
  return { evidence: cites, answer: { id: 'demo-answer', status: 'answered', sentences, files: [], reveal: true } };
}

export async function runDemo(demo, { onStage, onEvidence } = {}) {
  onStage?.('gather');
  await wait(DEMO_STEPS.evidence);
  onEvidence?.(demo.evidence);
  await wait(DEMO_STEPS.answer - DEMO_STEPS.evidence);
  onStage?.('answer');
  await wait(DEMO_STEPS.done - DEMO_STEPS.answer);
  return { ...demo.answer };
}
