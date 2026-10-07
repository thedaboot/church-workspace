import { useState } from 'react';
import { Wand2, Undo2, Pin } from 'lucide-react';
import { summaryOutdated } from '../utils.js';
import { store } from '../store/workspaceStore.js';
import { AiService, isFallbackText } from '../services/ai.js';
import { RichText } from '../components/RichText.jsx';
import { useAuth } from '../services/auth.jsx';
import { cardSummaryCloud } from '../services/cloudSync.js';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 업무 창의 AI 두 가지 — 3줄 요약(useTaskSummary · 보기·수정 화면) · 문맥 다듬기(usePolish + '상세 내용' 머리줄 BodyHead ·
// 새 업무 폼과 수정 화면이 같이 쓴다). 규칙은 PITFALLS 19 · §4.4.
// ============================================================================

// ── AI 문맥 다듬기 (새 업무 폼 · 수정 화면 한 벌) ─────────────────────────────────────
// read() — 다듬을 글. 다듬지 않을 때(빈 글)는 null을 돌려준다(자리마다 '빈 글'의 뜻이 조금 다르다 — 폼은 빈 문자열,
// 수정 화면은 공백뿐인 글까지). write(md) — 결과를 본문에 앉힌다. context(before) — polishText에 같이 넘길 업무.
// 다듬기 직전 본문(before)이 있으면 '되돌리기'가 보인다. 창을 닫으면 잊는다 —
// "방금 다듬었는데 마음에 안 든다"가 실제 상황이고, 그 이상은 편집 이력 관리다.
// ponytail: 직전 하나만 기억한다. 두 번 다듬고 두 번 되돌릴 일은 아직 없었다.
export function usePolish({ read, write, context }) {
  const [loading, setLoading] = useState(false);
  const [before, setBefore] = useState(null);
  const polish = async () => {
    const text = read();
    if (text == null) return;
    setLoading(true);
    const polished = await AiService.polishText(text, context(text));
    setLoading(false);
    // **안내 문구를 본문에 넣지 않는다.** 안내 문구도 truthy한 문자열이라 예전에는
    // 그대로 본문을 덮었다 — 게스트·로컬·세션 만료에서 '다듬기'를 누르면 쓰던 글이
    // "AI 기능은 로그인 후 사용할 수 있어요." 한 줄로 갈아치워졌다.
    if (!polished || isFallbackText(polished)) { showToast(polished || '다듬지 못했어요\n잠시 후 다시 시도해주세요'); return; }
    setBefore(text);
    write(polished);
  };
  const undo = () => {
    write(before);
    setBefore(null);
  };
  return { loading, before, polish, undo };
}

// '상세 내용' 머리줄 — 왼쪽 라벨, 오른쪽 되돌리기 · (children: 수정 화면의 3줄 요약 버튼) · AI 문맥 다듬기
export function BodyHead({ polish, disabled, children }) {
  return (
    <div className="flex justify-between items-center gap-2 mb-1.5">
      <label className="block text-xs text-fg-muted shrink-0">상세 내용</label>
      <div className="flex items-center gap-1.5 shrink-0">
        {/* 다듬은 직후에만 보인다 — 되돌리면 사라진다 */}
        {polish.before !== null && !polish.loading && (
          <button type="button" onClick={polish.undo} className="flex items-center gap-1 px-2 py-1 bg-surface border border-line text-fg-muted hover:bg-surface-hover rounded-full text-[10px] font-bold transition active:scale-95">
            <Undo2 size={12} /> 되돌리기
          </button>
        )}
        {children}
        <button type="button" onClick={polish.polish} disabled={disabled} className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
          {polish.loading ? <span className="animate-pulse">다듬는 중...</span> : <><Wand2 size={12} /> AI 문맥 다듬기</>}
        </button>
      </div>
    </div>
  );
}

// ── 3줄 요약 (예전 보기 화면에서 옮겼다) ─────────────────────────────────────
// 버튼은 '상세 내용' 줄의 AI 다듬기 옆, 요약은 그 줄 위에 선다. 규칙은 그대로다(PITFALLS 19 · §4.4).
export function useTaskSummary(formData, cloudMode) {
  const [summary, setSummary] = useState('');      // 이번에 AI가 만든 것(고정 전)
  const [revealed, setRevealed] = useState(false); // 고정된 요약을 펼쳤는지
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // 고정된 요약은 카드에 남아 있어서(0015의 cards.ai_summary) 다른 사람도 본다.
  // **열자마자 펼치지는 않는다** — 버튼을 눌러서 나오는 편이, 요약이라는 기능이
  // 있다는 것과 자기가 그걸 불렀다는 것을 같이 알려준다.
  const pinned = formData.aiSummary || '';
  // 이번에 만든 것이 있으면 그것이 먼저다(`pinned || summary`로 쓰면 '다시 만들기'가 죽는다)
  const shown = summary || (revealed ? pinned : '');
  const showingPinned = !!pinned && shown === pinned;
  // AI 기능(요약 고정·고치기)은 **마스터만**(0028) — AI는 돈이 들고 워크스페이스 전체에 남는 글을 만든다.
  const { isMaster } = useAuth();
  const canPin = cloudMode && isMaster && !!formData.id;

  const runAi = async () => {
    setIsAiLoading(true);
    const result = await AiService.summarizeTask(formData);
    setSummary(result);
    setIsAiLoading(false);
  };
  // 고정된 요약도 '분석하는 중'을 한 번 지나서 나온다 — 같은 버튼이 사람마다 다르게 동작하지 않게.
  // 일부러 넣은 지연이다(성능 문제가 아니다).
  const REVEAL_MS = 2000;
  const revealPinned = async () => {
    setIsAiLoading(true);
    await new Promise(r => setTimeout(r, REVEAL_MS));
    setRevealed(true);
    setIsAiLoading(false);
  };
  const handleSummarize = () => (pinned ? revealPinned() : runAi());

  // 고정/해제 — 카드 저장과 분리된 경로다(요약 세 칸만 건드린다)
  const setPinnedSummary = async (text) => {
    setPinning(true);
    store.dispatch({ type: 'SYNC_TASK', payload: { id: formData.id, aiSummary: text, aiSummaryBy: text ? '나' : '', aiSummaryAt: text ? new Date().toISOString() : '' } });
    try {
      await cardSummaryCloud(formData.id, text);
      setSummary('');
      setRevealed(!!text);
    } catch (e) {
      console.error('[cloud] 요약 고정 실패:', e);
      showToast('요약을 고정하지 못했어요\n잠시 후 다시 시도해주세요');
    }
    setPinning(false);
  };
  const startEdit = () => { setDraft(shown); setEditing(true); };
  const saveEdit = async () => {
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    await setPinnedSummary(text);
  };

  // 요약 버튼은 hover로 숨기지 않는다 — 터치 기기에는 hover가 없다. 고정된 게 있어도 이 버튼이 먼저다.
  const button = !shown && (formData.content || pinned) ? (
    <button type="button" onClick={handleSummarize} disabled={isAiLoading}
      className="flex items-center gap-1 px-2 py-1 bg-tag-purple text-tag-purple-fg hover:opacity-80 rounded-full text-[10px] font-bold transition active:scale-95 disabled:opacity-40">
      {isAiLoading ? <span className="animate-pulse">요약하는 중...</span> : <><Wand2 size={12} /> 3줄 요약</>}
    </button>
  ) : null;

  // 요약 — ✨를 빼고 왼쪽 선으로 "본문이 아닌 덧말"임을 표시
  const block = (shown || isAiLoading) ? (
    <div className="pl-3 border-l-2 border-tag-purple-fg/40 animate-in fade-in duration-200">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-bold text-tag-purple-fg">3줄 요약</span>
        {/* '고정' 배지는 지금 보고 있는 것이 저장된 요약이고 고정할 수 있는 사람일 때만 */}
        {showingPinned && canPin && (
          <span className="inline-flex items-center gap-1 text-[10px] text-fg-muted"><Pin size={9} />고정</span>
        )}
        {/* 고정한 뒤에 카드가 바뀌었으면 마스터에게만 알려준다(문구는 사용자가 정했다 · 2026-08-29) */}
        {showingPinned && canPin && summaryOutdated(formData.updatedAt, formData.aiSummaryAt) && (
          <span className="text-[10px] text-fg-muted">· 고정한 뒤로 업무가 바뀌었어요</span>
        )}
      </div>
      {isAiLoading
        ? <div className="text-xs text-fg-muted animate-pulse">업무 내용과 댓글을 분석하고 있습니다...</div>
        : editing
          ? <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5} autoFocus aria-label="3줄 요약"
              className="w-full text-xs leading-relaxed text-fg bg-surface border border-line rounded-xs px-2 py-1.5 outline-none focus:border-accent resize-y" />
          : <div className="text-xs text-fg-secondary whitespace-pre-wrap"><RichText content={shown} /></div>}
      {/* 고정·고치기는 마스터만 — 아무나 덮어쓰면 마지막 사람 것만 남는다 */}
      {canPin && !isAiLoading && (
        <div className="flex gap-2 mt-1.5">
          {/* 저장이 왼쪽, 취소가 오른쪽 — '고치기'를 누른 자리에 '저장'이 와야 손가락 밑의 뜻이 안 바뀐다 */}
          {editing ? (
            <>
              <button type="button" onClick={saveEdit} disabled={pinning || !draft.trim()}
                className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                {pinning ? '저장하는 중...' : '저장'}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={pinning}
                className="text-[10px] text-fg-muted hover:text-fg transition-colors disabled:opacity-40">취소</button>
            </>
          ) : showingPinned ? (
            <>
              <button type="button" onClick={startEdit} disabled={pinning}
                className="text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">고치기</button>
              <button type="button" onClick={runAi} disabled={pinning}
                className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">다시 만들기</button>
              <button type="button" onClick={() => setPinnedSummary('')} disabled={pinning}
                className="text-[10px] text-fg-muted hover:text-fg transition-colors disabled:opacity-40">고정 해제</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setPinnedSummary(shown)} disabled={pinning || !shown}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent-text hover:underline transition-colors disabled:opacity-40">
                <Pin size={9} />{pinning ? '고정하는 중...' : (pinned ? '이 요약으로 바꾸기' : '이 요약 고정')}
              </button>
              <button type="button" onClick={startEdit} disabled={pinning || !shown}
                className="text-[10px] text-accent-text hover:underline transition-colors disabled:opacity-40">고쳐서 고정</button>
            </>
          )}
        </div>
      )}
    </div>
  ) : null;
  return { button, block };
}
