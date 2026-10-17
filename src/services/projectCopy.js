// 프로젝트 복제(사용자 승인 시안 2026-10-17 · 새 칸 없음) — 한 해의 프로젝트를 다음 해 뼈대로 옮긴다(예: 2026 하계 수련회 → 2027 하계 수련회).
//
// **옮기는 것은 짜임새뿐이다**: 업무 제목 · 담당 팀 · 하위 업무 제목 · 상세 내용 · 선후관계(새 id로 다시 잇는다) · 보드 순서.
// **비우는 것**: 담당자 · 시작일·마감일 · 상태(시작 전으로 — 상시는 상시 그대로) · 하위 업무의 체크·담당자·기한 ·
// 댓글 · 활동 · 첨부(파일은 그 해의 것이다). 창(ProjectModal 복제 단계)은 업무마다 비워지는 것을 지운 글자로 보여 준다.
// **잠긴 업무(0099)는 제목·팀·순서만** — 본문·하위 업무는 잠금 안의 것이라(card_secrets) 새 공개 업무로 옮기지 않는다.
// 클라우드의 댓글·첨부 수는 업무 창을 열기 전에는 commentCount·fileCount(0016 · 트리거가 센다)에만 있다 — 둘 중 큰 쪽.
// import 0 — 노드 검사가 바로 본다. id는 부르는 쪽이 만든다(genId).

export const ONGOING = '상시';

// 이름 앞 네 자리 연도를 고른 해로 바꾼다('2026 하계 수련회' → '2027 하계 수련회'). 연도가 없으면 그대로.
export function retitleForYear(title, year) {
  const t = String(title || '');
  return /^\s*\d{4}(?=\D|$)/.test(t) ? t.replace(/^(\s*)\d{4}/, `$1${year}`) : t;
}

// 원본 업무 차례 — 보드 순서(position) 다음 만든 때
export const copyOrder = (tasks) => (tasks || []).slice()
  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

// 업무 하나에서 비워질 것의 개수·값(미리보기용) — 0·빈 값은 뺀다
export function droppedOf(t) {
  return {
    assignees: (t.assignees || []).length,
    due: t.dueDate || t.startDate || '',
    comments: Math.max(t.commentCount ?? 0, (t.comments || []).length),
    attachments: Math.max(t.fileCount ?? 0, (t.attachments || []).length),
  };
}

// 옮겨 갈 본문·하위 업무 — 잠긴 업무는 비운다(미리보기의 '상세 내용'·'하위 업무 N'도 이것으로 센다)
export const keptOf = (t) => (t?.locked ? { content: '', subtasks: [] } : { content: t?.content || '', subtasks: t?.subtasks || [] });

// tasks: 원본 프로젝트의 업무 · projectId: 새 프로젝트 · genId: () => 새 id
// → 새 업무 재료 배열(TaskService.create에 그대로 넘긴다 — author·생성 기록은 거기서 붙는다)
export function copyTasks(tasks, projectId, genId) {
  const list = copyOrder(tasks);
  const idMap = new Map(list.map(t => [t.id, genId()]));
  return list.map((t, i) => ({
    ...keptOf(t),
    id: idMap.get(t.id),
    projectId,
    title: t.title || '',
    teams: [...(t.teams || [])],
    status: t.status === ONGOING ? ONGOING : '시작 전',
    assignees: [],
    startDate: '',
    dueDate: '',
    position: i,
    subtasks: keptOf(t).subtasks.map(s => ({ id: genId(), title: s?.title || '', done: false })),
    dependsOn: (t.dependsOn || []).map(d => idMap.get(d)).filter(Boolean),
    attachments: [],
  }));
}
