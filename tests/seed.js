(() => {
  const TEAMS = ['웰컴팀','워십팀','찬양팀','엔지니어팀','미디어팀','임원진','교역자'];
  const ST = ['시작 전','진행 중','보류 중','완료'];
  const byId = {}, allIds = [];
  for (let i = 0; i < 150; i++) {
    const id = 't' + i;
    byId[id] = {
      id, projectId: 'p1', title: '수련회 준비 업무 ' + i,
      content: '## 현황\\n- 준비물 확인 **필요**\\n- [자료](https://example.com) 참고\\n' + '내용 문단. '.repeat(20),
      status: ST[i % 4], assignees: ['노준석'], teams: [TEAMS[i % 7]],
      startDate: '2026-08-0' + (1 + i % 9), dueDate: '2026-08-1' + (i % 9),
      position: i, author: '노준석', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-20T00:00:00Z',
      comments: Array.from({ length: i === 0 ? 15 : 2 }, (_, k) => ({
        id: id + 'c' + k, author: '노준석', text: '댓글 내용 ' + k + ' @노준석 확인 부탁해요',
        timestamp: '2026-07-20T00:00:00Z', parentId: null, edited: false,
      })),
      activityLog: Array.from({ length: i === 0 ? 30 : 3 }, (_, k) => ({
        id: id + 'a' + k, action: '상태를 진행 중으로 변경했습니다.', author: '노준석', timestamp: '2026-07-20T00:00:00Z',
      })),
      attachments: [],
    };
    allIds.push(id);
  }
  localStorage.setItem('church_app_v4', JSON.stringify({
    currentUser: { name: '노준석', team: '임원진' },
    projects: { byId: { p1: { id: 'p1', title: '2026 하계 수련회', pinnedLinks: [] } }, allIds: ['p1'] },
    tasks: { byId, allIds },
  }));
  return allIds.length;
})()