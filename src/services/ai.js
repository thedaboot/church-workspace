// ============================================================================
// 6-2. AI Service Layer (Gemini LLM Integration)
// ============================================================================
export const AiService = {
  callGemini: async (prompt, systemInstruction = "") => {
    const apiKey = ""; // Canvas 환경에서 자동 주입됨
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

    try {
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
      console.error("Gemini API Error:", error);
      return "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
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
