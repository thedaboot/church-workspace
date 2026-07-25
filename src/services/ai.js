import { supabase } from './supabaseClient.js';

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
      '- 담당자나 마감일이 있으면 "다음 단계"에 누가·언제까지인지 반영해라.',
      '- 내용이 빈약하면 지어내지 말고 있는 것만 담백하게 적어라.',
      '- "핵심"이라는 단어는 절대 쓰지 마라.',
      '',
      ORG_CONTEXT,
    ].join('\n');
    return await AiService.callGemini(prompt, sysPrompt);
  },
  polishText: async (text) => {
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
      '이제 아래 초안을 다듬어줘:',
      '',
      text,
    ].join('\n');
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
      ORG_CONTEXT,
    ].join('\n');
    return await AiService.callGemini(prompt, sysPrompt);
  }
};
