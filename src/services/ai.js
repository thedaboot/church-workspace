import { supabase } from './supabaseClient.js';

// ============================================================================
// 6-2. AI Service Layer — /api/ai 서버 프록시 경유 (API 키는 서버에만)
// ============================================================================
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
    const prompt = `업무 제목: ${task.title}\n상세 내용: ${task.content}\n\n[댓글 타임라인]\n${commentsText}\n\n위 업무의 전체적인 진행 상황과 앞으로 남은 핵심 이슈를 3줄 이내로 간결하게 요약해줘.`;
    const sysPrompt = "너는 교회 청년부 프로젝트 매니저 어시스턴트야. 빠르고 명확하게 요약해.";
    return await AiService.callGemini(prompt, sysPrompt);
  },
  polishText: async (text) => {
    const prompt = `다음 텍스트를 다듬어줘:\n\n${text}`;
    const sysPrompt = "다음 텍스트를 교회 청년부 협업 툴에 맞게 예의 바르면서도 명확하고 프로페셔널한 어조로 교정해줘. 핵심 내용은 절대 누락하지 말고, 읽기 좋게 문단이나 기호를 적절히 사용해.";
    return await AiService.callGemini(prompt, sysPrompt);
  },
  friendlyComment: async (text) => {
    const prompt = `다음 댓글 내용을 수정해줘:\n\n${text}`;
    const sysPrompt = "교회 청년부 팀원에게 남기는 피드백 댓글이야. 핵심 피드백은 유지하되, 감정이 상하지 않게 둥글고 부드럽고 격려하는 어조로 다듬어줘.";
    return await AiService.callGemini(prompt, sysPrompt);
  }
};
