import { supabase } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';

// ============================================================================
// 6-2. AI Service Layer — /api/ai 서버 프록시 경유 (API 키는 서버에만)
// ============================================================================

// 청년부 조직 — 요약·다듬기에서 사람 이름이 나올 때 직함을 맞게 붙이도록 주는 배경 지식.
// 사람이 바뀌면 여기만 고치면 된다(두 프롬프트가 같이 참조).
const ORG_CONTEXT = [
  '[우리 청년부 조직]',
  '- 교역자·부장: 임성빈 전도사님, 신효진 부장님',
  '- 임원진: 양민혁 회장님, 정민경 리더순장님, 조준환 예배팀장님, 조해리 총무님, 박지호 리더팀장님',
  '- 순장(정민경 리더순장 산하): 김승찬, 김윤주, 노준석, 배현민, 임재훈, 천진영 순장님',
  '- 팀장: 박지호 웰컴팀장님, 워십팀장 공석, 노준석 찬양팀장님, 문진혁 엔지니어팀장님, 이시온 미디어팀장님',
  '- 세부 팀원 명단은 아직 등록되지 않았다.',
  '조직 관련 규칙:',
  '- 위 표에 있는 이름이 나오면 표에 적힌 "이름 + 직함"으로 불러라(예: 조준환 → 조준환 예배팀장님).',
  '- 한 사람이 두 직함을 가질 수 있다(예: 노준석은 순장이면서 찬양팀장). 맥락에 맞는 쪽을 골라라.',
  '- 표에 없는 이름은 직함을 지어내지 마라. 기본은 "OOO 청년"으로 부르고, 소속 팀을 알 수 있으면 "웰컴팀에 속한 OOO 청년"처럼 팀을 앞에 붙여라.',
].join('\n');

// 대시 표기 규칙 — 엠/엔 대시는 쓰지 않는다(사용자 요청)
const DASH_RULE = '- 문장 안에서 엠 대시(—)나 엔 대시(–)는 절대 쓰지 마라. 필요하면 일반 하이픈(-)을 써라.';

// 사역 업무의 일반적인 진행 순서. "다음 단계"가 지금 업무를 되풀이하지 않고
// 실제로 이어질 일을 짚게 하는 데 쓴다(예: 콘티 확정 → 송폼·악보 제작 → 연습 → 리허설).
const FLOW_CONTEXT = [
  '[사역별 일반 진행 순서]',
  '- 찬양·워십: 곡 선정 → 콘티 확정 → 악보·송폼 제작 → 파트별 연습 → 전체 연습 → 사운드 체크·리허설 → 본 예배/집회',
  '- 미디어: 컨셉 논의 → 디자인 시안 → 시안 확정 → 제작·인쇄 → 배포·업로드',
  '- 엔지니어: 장비 점검 → 세팅·배선 → 사운드·조명 체크 → 리허설 → 당일 운영',
  '- 웰컴: 참가 명단 정리 → 안내 동선·조 편성 → 물품 준비 → 당일 접수·안내',
  '- 임원진·교역자: 기획·예산 승인 → 각 팀 배분 → 진행 점검 → 마무리 보고',
].join('\n');

// 지금 업무 주변 상황(같은 프로젝트의 다른 업무·담당 팀·담당자)을 프롬프트에 실어준다.
// 이게 없으면 AI가 볼 게 이 카드 하나뿐이라 "다음 단계"에 마감일 얘기를 되풀이한다.
const NEARBY_LIMIT = 12;
const fmtTask = (t) => [
  t.title,
  t.status,
  t.teams?.length ? t.teams.join('·') : '팀 미지정',
  t.assignees?.length ? t.assignees.join(', ') : '담당자 미지정',
  [t.startDate, t.dueDate].filter(Boolean).join('~') || '일정 없음',
].join(' | ');

export function buildTaskContext(task) {
  const s = store.getState();
  const project = s.projects.byId[task.projectId];
  const siblings = (s.tasks.allIds || [])
    .map(id => s.tasks.byId[id])
    .filter(t => t && t.projectId === task.projectId && t.id !== task.id);
  // 같은 팀을 공유하는 업무가 조율 상대일 확률이 높다 → 그걸 먼저, 나머지는 일정 순
  const myTeams = new Set(task.teams || []);
  const shared = siblings.filter(t => (t.teams || []).some(x => myTeams.has(x)));
  const rest = siblings.filter(t => !shared.includes(t));
  const byDate = (a, b) => String(a.dueDate || a.startDate || '9999').localeCompare(String(b.dueDate || b.startDate || '9999'));
  const picked = [...shared.sort(byDate), ...rest.sort(byDate)].slice(0, NEARBY_LIMIT);
  // 이 업무 마감 뒤에 놓인 업무 = "다음 단계"의 1순위 후보
  const after = task.dueDate
    ? picked.filter(t => String(t.dueDate || t.startDate || '') > task.dueDate).map(t => t.title)
    : [];

  return [
    '[지금 이 업무의 주변 상황]',
    project ? `- 소속 프로젝트: ${project.title}` : '',
    `- 이 업무: ${fmtTask(task)}`,
    '- 같은 프로젝트의 다른 업무 (제목 | 상태 | 담당 팀 | 담당자 | 일정):',
    picked.length ? picked.map(t => `  · ${fmtTask(t)}`).join('\n') : '  · (없음)',
    after.length ? `- 이 업무 마감 이후에 놓인 업무: ${after.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
export const AiService = {
  callGemini: async (prompt, systemInstruction = "") => {
    // 게스트 모드(수파베이스 미설정) → 로그인 안내
    if (!supabase) return "AI 기능은 로그인 후 사용할 수 있어요.";
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return "AI 기능은 로그인 후 사용할 수 있어요.";

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt, systemInstruction }),
      });
      // 로컬 vite dev에는 서버 함수가 없어 404 → 안내
      if (response.status === 404) return "AI 기능은 배포 환경에서 동작해요 (로컬은 `npx vercel dev` 필요).";
      if (response.status === 501) return "AI 기능이 아직 설정되지 않았어요 (관리자에게 GEMINI_API_KEY 설정을 요청하세요).";
      if (!response.ok) {
        console.error("AI 프록시 오류:", response.status, await response.text().catch(() => ''));
        return "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      }
      const result = await response.json();
      return result.text || "";
    } catch (error) {
      console.error("AI 요청 실패:", error);
      return "AI 기능은 배포 환경에서 동작해요 (로컬은 `npx vercel dev` 필요).";
    }
  },
  summarizeTask: async (task) => {
    const commentsText = (task.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const meta = [
      task.assignees?.length ? `담당자: ${task.assignees.join(', ')}` : '',
      task.dueDate ? `마감일: ${task.dueDate}` : '',
    ].filter(Boolean).join(' · ');
    const prompt = [
      `업무 제목: ${task.title}`,
      `상세 내용: ${task.content || '(없음)'}`,
      meta && `[정보] ${meta}`,
      `\n[댓글 타임라인]\n${commentsText || '(댓글 없음)'}`,
      '',
      buildTaskContext(task),
      '\n위 업무를 아래 형식에 맞춰 요약해줘.',
    ].filter(Boolean).join('\n');
    const sysPrompt = [
      '너는 더다붓(교회 청년부) 워크스페이스의 요약 도우미야. 팀원들이 읽자마자 바로 움직일 수 있게 요약해.',
      '',
      '출력 형식(정확히 이 3줄, 다른 말 붙이지 마):',
      '1. **현황** - 한 문장',
      '2. **챙길 것** - 한 문장',
      '3. **다음 단계** - 한 문장',
      '',
      '규칙:',
      '- 라벨과 문장 사이는 일반 하이픈 하나("- ")로만 구분해라.',
      DASH_RULE,
      '- 각 줄은 딱 한 문장, 존댓말 간결체(~해요/~예요체).',
      '- 예배·전도·수련회·양육 같은 사역 맥락과 용어를 자연스럽게 살려라.',
      '- 내용이 빈약하면 지어내지 말고 있는 것만 담백하게 적어라.',
      '- "핵심"이라는 단어는 절대 쓰지 마라.',
      '',
      '"다음 단계" 규칙 (가장 중요):',
      '- 이 업무가 끝난 뒤 이어질 행동을 써라. 이 업무를 마감일까지 끝내라는 말은 절대 쓰지 마라',
      '  (예: 콘티 확정 업무에서 "마감일까지 콘티를 확정해 주세요"는 틀린 답이다).',
      '- 1순위: 주변 상황에 적힌 "이 업무 마감 이후에 놓인 업무"를 지목하고, 그 담당 팀·담당자를 함께 불러라.',
      '- 2순위: 이어질 업무가 목록에 없으면 사역별 진행 순서에서 바로 다음 단계 하나만 제안해라',
      '  (예: 콘티 확정 → 악보·송폼 제작이나 파트별 연습 일정 잡기).',
      '- 담당 팀이 둘 이상이면 팀 사이에 무엇을 넘겨주고 받아야 하는지 한 마디로 적어라',
      '  (예: 찬양팀이 확정한 콘티를 엔지니어팀에 넘겨 사운드 세팅을 준비해요).',
      '- 이 업무가 이미 완료 상태면 다음 단계는 후속 업무나 인수인계로 써라.',
      '',
      FLOW_CONTEXT,
      '',
      ORG_CONTEXT,
    ].join('\n');
    return await AiService.callGemini(prompt, sysPrompt);
  },
  // task를 넘기면 주변 상황(같은 프로젝트 업무·팀·담당자)을 배경 지식으로 함께 준다.
  // 내용을 늘리라는 뜻이 아니라, 사람·팀 이름을 맞게 부르고 엉뚱한 다음 단계를 만들지 않게 하려는 것.
  polishText: async (text, task = null) => {
    const prompt = [
      '아래는 팀원이 카드에 쓴 초안이야. 더다붓 카드 본문 형식으로 다듬어줘. 내용·의도·수량·링크·메모는 하나도 빼지 마.',
      '',
      '---예시 1 (대충 쓴 짧은 메모)---',
      'before:',
      '수련회 조편성 아직 안됨 인원 42명 리더 5명 방배정도 해야하고 버스는 25인승 2대 예약함 김집사님한테 견적 받기',
      'after:',
      '### 수련회 준비 현황',
      '- 참가 인원 **42명**, 리더 **5명**',
      '- 버스: 25인승 **2대** 예약 완료',
      '',
      '### 남은 일',
      '- 조 편성 (미완료)',
      '- 방 배정',
      '- 김집사님께 견적 받기',
      '',
      '---예시 2 (쇼핑 링크 나열)---',
      'before:',
      '간식 이거 https://smartstore.naver.com/main/products/1234567?query=abc 20봉지 그리고 포장지 https://www.coupang.com/vp/products/999?itemId=88 이건 50장',
      'after:',
      '### 간식',
      '- [초코파이 대용량_네이버](https://smartstore.naver.com/main/products/1234567?query=abc) **20봉지**',
      '',
      '### 포장지',
      '- [선물 포장지_쿠팡](https://www.coupang.com/vp/products/999?itemId=88) **50장**',
      '---예시 끝---',
      '',
      task ? '\n' + buildTaskContext(task) : '',
      '',
      '이제 아래 초안을 다듬어줘:',
      '',
      text,
    ].filter(Boolean).join('\n');
    const sysPrompt = [
      '너는 더다붓(교회 청년부) 워크스페이스의 카드 정리 도우미야.',
      '청년부 팀원이 아무렇게나 쓴 초안(짧은 메모, 대충 나열, 구어체, 어딘가에서 복붙한 긴 텍스트 등)을 더다붓 카드 본문 형식으로 잘 구조화하는 게 목적이야.',
      '',
      '반드시 지켜:',
      '- 원문의 내용·의도·수량·가격·메모·고민 포인트·링크는 절대 삭제하지 마라. 다듬는 거지 요약이 아니다.',
      '- 우리 마크다운 서브셋만 써라: #~#### 제목, - 불릿, 1. 번호, **굵게**, ==형광펜==, [이름](URL) 링크. 표와 코드블록은 쓰지 마라.',
      '- 긴 쇼핑/상품 URL은 반드시 `[상품명_쇼핑몰](원본URL)` 한 줄 링크로 축약해라. 쿼리스트링까지 원본 URL 그대로 링크 안에 넣어라.',
      '- 수량·가격 같은 숫자는 **굵게** 강조해라.',
      '- 성격이 다른 묶음(예: 포장지/간식/안내문/남은 일)은 ### 제목으로 섹션을 나눠라.',
      '- 톤은 청년부 팀원에게 말하듯 간결하고 친근하게. 과한 격식은 빼라.',
      '- 이모지는 원문에 있던 것만 유지하고 새로 넣지 마라.',
      '- 원문이 이미 깔끔하면 억지로 뜯어고치지 말고 형식만 살짝 정돈해라.',
      '- "핵심"이라는 단어는 절대 쓰지 마라.',
      DASH_RULE,
      '',
      '주변 상황(같은 프로젝트의 다른 업무·담당 팀·담당자)이 함께 주어지면:',
      '- 원문에 등장하는 사람·팀을 그 정보에 맞게 정확히 불러라.',
      '- 원문이 "남은 일"을 적고 있으면, 다른 팀에 넘겨야 하는 것과 받아야 하는 것을 원문 범위 안에서 분명히 적어라.',
      '- 주변 상황에서 알게 된 사실을 새 항목으로 추가하지는 마라. 다듬기지 작성이 아니다.',
      '',
      FLOW_CONTEXT,
      '',
      ORG_CONTEXT,
    ].join('\n');
    return await AiService.callGemini(prompt, sysPrompt);
  }
};
