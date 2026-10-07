import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Share2, NotebookPen } from 'lucide-react';
import { ShareChip, ShareToggle } from './ShareToggle.jsx';
import { BTN, BTN_QUIET, WITH_ICON, FailTail, NoteMark } from './groupsParts.jsx';
import { formatServiceDate } from '../services/worship.js';
import { worshipNoteTemplate, isTemplateOnly, bodyOrTemplate, splitNoteSections,
  ensureNoteSections, WORSHIP_SECTIONS, noteDraftKey, hasDraft } from '../services/noteTemplate.js';
import { readCache, dropCache } from '../services/cache.js';
import { NoteSheet, NotePaper, PAPER, paperDate, NOTE_CUT } from './paper.jsx';
import { useSheetShare } from '../hooks/useSheetShare.jsx';
import { useNoteDraft } from '../hooks/useNoteDraft.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { formatDay } from '../utils.js';
import { SaveState, WorshipEmpty, BTN_SOFT, SHEET_BOX } from './worshipParts.jsx';

// ============================================================================
// 내 예배 노트 — 주보 아래 노트 칸(MyNote) · 예배 머리줄 '내 예배 노트' 모아 보기(MyNotesScreen)
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 worshipDetail.jsx에서 갈라 왔다. 예배마다 한 건, 기본은 나만 본다.
// 남의 노트는 여기 오지 않는다(결정 7 — 순의 공유 노트는 모임 화면 groupsSun 소관).
// 종이는 paper.jsx 한 벌(읽기·편집이 같은 부품 · §6-32-p), 초안은 hooks/useNoteDraft.js다.
// ============================================================================

// 업무 본문·QT 묵상과 같은 에디터 한 벌. 무거워서 그 화면들처럼 lazy로 들인다
// (첫 번들에 tiptap이 실리지 않게 — modals.jsx·wordView.jsx가 같은 방식이다).
const MarkdownEditor = lazy(() => import('./MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
const EditorSkeleton = () => <div className="min-h-40 border border-line rounded-md rounded-t-none dc-skeleton" />;
// 노트 편집기의 감싸개 — **종이가 그 안에 든다**(2026-09-10 · MarkdownEditor의 `frame`).
// 그래서 여백·배경·글자색은 종이(components/paper.jsx)가 가지고, 여기는 서식 바 아래로
// 이어지는 테두리와 둥근 모서리만 맡는다. MarkdownEditor는 이 상자의 **빈 자리를 눌러도**
// 문서 끝으로 커서를 보낸다(그 파일의 focusEnd).
const EDITOR_BOX = 'overflow-hidden border border-line rounded-md rounded-t-none focus-within:border-accent focus-within:shadow-soft transition-all';

// ── 내 예배 노트 ─────────────────────────────────────────────────────────────
// 예배마다 한 건, 기본은 나만 본다. 남의 노트는 여기 오지 않는다(결정 7).
//
// **말씀의 내 묵상과 같은 부품·같은 순서다**(사용자 재강조 2026-09-03) — 칩과 공유
// 세그먼트는 components/ShareToggle.jsx 한 벌이고 라벨만 이 화면 것이다. 글은 저장
// 버튼으로만 나가고(빈 노트는 저장할 것이 없으니 버튼이 잠긴다), **공유는 저장된 노트의
// 상태만 그 자리에서 바꾼다** — 같이 올리면 저장을 누르지 않았는데 글이 나가 버린다.
// 아직 저장한 것이 없으면 공유할 것도 없으므로 세그먼트가 잠긴다.
//
// **저장된 노트가 있으면 읽기 모드다**(2026-09-07 · QT 묵상과 같은 패턴). 예전에는 편집기가
// 늘 열려 있어서 "쓴 것인지 고치는 중인지"가 화면에 없었다 — 글은 저장돼 있는데 편집기
// 안에 그대로 있으니 아직 안 보낸 것처럼 읽혔다. 지금은 저장된 글을 **종이**로 그리고
// (components/paper.jsx · 공유되는 그림과 같은 것이다) '수정'을 눌러야 편집기가 열린다.
//
// 도구 줄의 자리는 §8 그대로다 — **확정 왼쪽 / 나가기 오른쪽**, 그리고 두 모드에서 같은 자리:
//   읽기  `[수정(연한 accent)] [칩] … [ ] [공유 토글]`
//   편집  `[저장(진한 accent)] [칩] … [취소(무채색)] [공유 토글]`
// 375px에서 토글만 다음 줄 오른쪽에 혼자 서던 자리라 **줄을 grid로 잡는다**(flex-wrap에
// 맡기지 않는다): 640 미만에서 토글이 둘째 줄을 통째로 쓰고 왼쪽부터 폭을 채운다.
const NOTE_TOOLS = 'worship-note-tools mt-2.5 grid items-center gap-2 grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]';
const NOTE_TOGGLE = 'col-span-3 w-full sm:col-span-1 sm:w-auto';

// 브라우저 초안(사용자 결정 2026-09-14): 쓰다가 다른 화면에 다녀와도 글이 남는다. 서버가
// 아니라 **브라우저**다 — 노트는 저장이 곧 끝이고 공유 토글이 따로 있어서 서버 자동 저장은
// 아직 다 쓰지 않은 글을 남에게 보인다. 자리·열쇠 관례는 services/cache.js가 가진 것을
// 그대로 쓴다(사용자별 · §6-24-d). 열쇠는 **주보 한 건마다** 하나다 — 날짜만으로는 같은
// 날 두 예배(주일 4부·금요)의 노트가 한 초안을 나눠 쓴다.
//
// focus — '내 예배 노트'의 0건 자리에서 `{M월 D일} 예배 노트 쓰기`로 들어왔다(2026-09-25). 이 칸까지
// 내려가 편집 상태로 연다(저장된 노트가 있으면 '수정'을 누른 것과 같다).
export function MyNote({ note, serviceId = '', serviceDate = '', passageRef = '', passageTitle = '', onSave, onShare, focus = false }) {
  const sectionRef = useRef(null);
  // **처음 여는 노트는 템플릿으로 시작한다**(사용자 요청 2026-09-08 — 옛 순 노트
  // 템플릿을 우리 디자인으로). services/noteTemplate.js가 도막 제목 셋을 세운다 —
  // 구절은 종이 머리(PaperNoteHead)에 서므로 도막으로 한 번 더 두지 않는다(2026-09-12).
  // passageRef는 그래도 아래 isTemplateOnly에 넘긴다 — 옛 노트의 '본문' 도막에 들어
  // 있는 구절 줄은 사람이 쓴 글이 아니기 때문이다.
  const tpl = useMemo(() => worshipNoteTemplate(), []);
  const [body, setBody] = useState(() => bodyOrTemplate(note?.body, tpl));
  const [state, setState] = useState('');         // '' | 'saving' | 'saved'  (저장 버튼)
  const [shareState, setShareState] = useState(''); // '' | 'saving' | 'saved'  (공유 칩)
  const [busy, setBusy] = useState(false);
  // 저장된 노트가 없으면 처음부터 편집기다 — 빈 읽기 상자를 세울 이유가 없다
  const [editing, setEditing] = useState(!note);

  const saved = !!note;
  const shared = !!note?.shared_to_sun;
  // 되돌아갈 자리 — 저장된 글이 있으면 그것, 없으면 손대지 않은 템플릿이다
  const base = bodyOrTemplate(note?.body, tpl);
  // **손대지 않은 템플릿은 빈 노트다.** 제목 줄이 있다는 이유로 저장이 열리면
  // 아무도 쓰지 않은 제목 세 줄이 그대로 저장된다(isTemplateOnly).
  const hasText = !isTemplateOnly(body, passageRef);
  const dirty = body !== base;
  const reading = saved && !editing;
  // 종이에 세울 도막. 저장된 글만 본다 — 편집 중인 글은 종이가 아니라 편집기가 그린다.
  const sections = useMemo(() => splitNoteSections(note?.body || ''), [note?.body]);
  const draftKey = noteDraftKey('worship', serviceId || serviceDate);
  const sheetRef = useRef(null);
  // **누르기 전에 그림까지 구워 둔다**(hooks/useSheetShare.js) — 미리 받기만으로는
  // 폰에서 공유 시트가 열리지 않았다(사용자 보고 2026-09-09).
  const img = useSheetShare({
    refs: [sheetRef], background: PAPER.surface,
    key: reading ? `${note?.id || 'none'}:${note?.body || ''}` : '',
    fileName: `예배 노트 ${paperDate(serviceDate)}`.trim(),
    what: '이미지를 저장하지 못했어요',
  });

  // 주보가 바뀌거나 서버 값이 새로 오면 편집 중이던 글을 그 값으로 되돌린다.
  // **읽기 모드도 같이 되돌린다** — 다른 주보를 열었는데 앞 주보의 편집 상태가 남으면
  // 남의 글 위에 커서가 놓인 것처럼 보인다.
  // `state`는 건드리지 않는다 — 저장이 끝나면 부르는 쪽이 note를 갈아 끼우므로,
  // 여기서 비우면 방금 켠 '저장되었어요'가 같은 프레임에 지워진다.
  //
  // **초안은 바로 이 자리에서 되살린다**(2026-09-14) — 따로 효과를 두면 이 효과와
  // 번갈아 글을 갈아 끼운다. 되살아나는 것은 **같은 주보로 돌아왔을 때뿐**이다(열쇠가
  // 주보 한 건이다). 저장된 글과 같은 초안은 되살릴 것이 없으므로 그냥 서버 값이 선다.
  //
  // **같은 주보에서 note만 새로 온 경우에는 고치던 글을 건드리지 않는다**(2026-09-25 감사 S1·S2).
  // 공유 토글(setNoteShared)이 돌려준 행, 캐시로 먼저 그린 뒤 도착한 조회 결과가 그 경우다 —
  // 예전에는 그때마다 편집기 글을 저장본으로 되돌리고 편집을 닫아서, 쓰던 노트가 사라졌다.
  // 판정은 말씀 화면과 같은 규칙이다(word.js shouldAdoptBody): 마지막으로 넣어 준 글에서 한
  // 글자라도 고쳤으면 그대로 두고, 안 고쳤으면 새 값을 넣는다. 편집 모드는 사람이 '수정'을
  // 눌러 연 것이면 그대로 두고(userEditing), 아니면 예전처럼 '저장된 게 있나'로 정한다.
  const synced = useRef({ key: null, body: '', note: undefined });
  const userEditing = useRef(false);
  const bodyNow = useRef(body);
  bodyNow.current = body;
  useEffect(() => {
    const fresh = bodyOrTemplate(note?.body, tpl);
    if (synced.current.key === draftKey) {
      // 같은 note로 한 번 더 도는 것(개발 모드 StrictMode의 두 번 돌리기)은 새로 온 값이 아니다 —
      // 거기서 넣으면 방금 되살린 초안을 저장본으로 덮는다
      if (synced.current.note === note) return;
      synced.current.note = note;
      if (bodyNow.current !== synced.current.body) return;   // 고치는 중 — 쓰던 글이 이긴다
      synced.current.body = fresh;
      setBody(fresh);
      if (!userEditing.current) setEditing(!note);
      return;
    }
    synced.current = { key: draftKey, body: fresh, note };
    userEditing.current = false;
    const draft = readCache(draftKey);
    if (hasDraft(draft, fresh)) { setBody(draft.body); setState('draft'); setEditing(true); userEditing.current = true; return; }
    setBody(fresh); setEditing(!note);
  }, [note, tpl, draftKey]);

  // 편집 중에는 주기적으로 브라우저에 남긴다. 저장된 글과 같아지는 순간(저장·취소·
  // 되돌아옴) 지운다 — 되살릴 것이 없는 초안이 자리만 차지하지 않게. 쓰고 곧바로 떠나도
  // 그 자리에서 남는다(hooks/useNoteDraft.js 머리말 · 말씀 화면과 같은 짝).
  useNoteDraft(draftKey, body === base ? null : { body });

  useEffect(() => {
    if (!focus) return undefined;
    userEditing.current = true; setEditing(true);
    // 편집기는 lazy로 늦게 붙는다 — 한 박자 뒤에 내려간다(모션을 끈 사람에게는 바로)
    const smooth = !prefersReducedMotion();
    const el = sectionRef.current;
    const go = (behavior) => el?.scrollIntoView({ block: 'start', behavior });
    const t = setTimeout(() => go(smooth ? 'smooth' : 'auto'), 120);
    // 위쪽 종이는 본문(개역한글)이 늦게 붙어서 내려간 뒤에 자란다 — 그러면 노트 칸이 화면 밖으로
    // 밀린다. 2초 동안은 위가 자랄 때마다 다시 맞춘다(사람이 손으로 움직이면 그만둔다).
    const box = el?.parentElement;
    let live = true;
    const stop = () => { live = false; };
    const ro = box ? new ResizeObserver(() => { if (live) go('auto'); }) : null;
    const t2 = setTimeout(() => { if (box) ro.observe(box); }, 140);
    const t3 = setTimeout(stop, 2200);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    return () => {
      clearTimeout(t); clearTimeout(t2); clearTimeout(t3); ro?.disconnect();
      window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop);
    };
  }, [focus, serviceId]);

  const save = async () => {
    if (busy || !hasText || !dirty) return;
    setBusy(true); setState('saving'); setShareState('');
    // **도막 제목은 지워지지 않는다**(사용자 결정 2026-09-09 — "중제목들 안 지워지게").
    // 편집기에서 지웠어도 저장되는 글에는 세 도막이 그 순서로 서 있다. 사람이 쓴
    // 글과 새로 만든 도막은 그대로 남는다(services/noteTemplate.js ensureNoteSections).
    const kept = ensureNoteSections(body, WORSHIP_SECTIONS);
    const ok = await onSave({ body: kept, sharedToSun: shared });
    setBusy(false); setState(ok ? 'saved' : '');
    // 저장했으면 초안은 할 일을 다 했다. **실패하면 남긴다** — 그때가 초안이 가장 필요한 때다
    // 편집기 글도 저장된 글로 맞춘다 — 저장이 돌려준 note는 위 효과가 '고치는 중'으로 보고
    // 건너뛰므로(S1), 여기서 맞추지 않으면 도막이 되살아난 만큼 저장 직후에도 dirty로 남는다.
    if (ok) {
      const next = bodyOrTemplate(kept, tpl);
      synced.current.body = next; userEditing.current = false;
      setBody(next); dropCache(draftKey); setEditing(false);
    }
  };

  // 취소는 **저장된 글로 되돌리고** 읽기 모드로 나간다(고치던 것을 버린다).
  // 되돌리는 조작이므로 초안도 같이 지운다(사용자 결정 2026-09-14).
  const cancel = () => {
    synced.current.body = base; userEditing.current = false;
    dropCache(draftKey); setBody(base); setState(''); setEditing(false);
  };

  // 공유만 바꾼다 — 글은 저장된 것을 그대로 둔다(편집 중인 글은 건드리지 않는다).
  // onShare는 부르는 쪽이 services의 setNoteShared로 잇는다(모임 화면도 같은 함수를 쓴다).
  const setShare = async (v) => {
    if (!saved || v === shared || shareState === 'saving') return;
    setShareState('saving'); setState('');
    const ok = onShare ? await onShare(v) : await onSave({ body: note?.body || '', sharedToSun: v });
    setShareState(ok ? 'saved' : '');
  };

  return (
    <section ref={sectionRef} className="worship-note mt-7 scroll-mt-4">
      <div className="flex items-center gap-2 pb-2.5">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">내 예배 노트</h3>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        {/* 노트는 발행이라는 것이 없다 — 저장되면 그것으로 끝이라 '임시'가 아니다 */}
        <SaveState state={state} />
      </div>
      {reading ? (
        // **저장하면 바로 종이다**(사용자 요청 2026-09-09). 공유되는 그림과 화면이 같은
        // 것이라야 "이 모양으로 나간다"를 눌러 보기 전에 안다.
        <div className={`worship-note-read ${SHEET_BOX}`}>
          <div className="rounded-lg overflow-hidden border border-line">
            <NoteSheet sheetRef={sheetRef} date={paperDate(serviceDate)} kind="예배 노트"
              passageRef={passageRef} passageTitle={passageTitle} sections={sections} cut={NOTE_CUT} />
          </div>
        </div>
      ) : (
        // **편집도 같은 종이 안에서 한다**(사용자 요청 2026-09-10 — "세련되고 기쁘게
        // 자발적으로 작성할 수 있는 공간으로"). 서식 바가 위에 붙고, 그 아래 종이가
        // 선다: 인디고 띠 → 설교 제목·구절 → 도막마다 왼쪽 라벨·오른쪽 쓰는 칸.
        // 부품은 읽기와 **같은 것**이고(paper.jsx NotePaper), 라벨·칸을 만드는 것은
        // index.css `.note-paper`의 격자 한 겹이다 — 편집기는 여전히 하나이고 저장
        // 형식도 마크다운 문자열 하나다(§6-32-p).
        <div className={`worship-note-editor note-paper ${SHEET_BOX}`}>
          <Suspense fallback={<EditorSkeleton />}>
            <MarkdownEditor
              value={body}
              onChange={(v) => { setState(''); setBody(v); }}
              placeholder="오늘 말씀에서 마음에 남은 것"
              className={EDITOR_BOX}
              /* 도막 제목은 **수정 창에서부터** 지워지지 않는다(사용자 결정 2026-09-10) */
              lockedHeadings={WORSHIP_SECTIONS}
              /* 제목·구분선·링크가 빠진 노트 서식 바(사용자 결정 2026-09-10·09-11) */
              tools="note"
              /* 읽기 종이와 **같은 값**을 머리에 넘긴다 — 두 모드의 머리가 어긋나면
                 "이 모양으로 나간다"가 거짓이 된다 */
              frame={(content) => (
                <NotePaper date={paperDate(serviceDate)} kind="예배 노트"
                  passageRef={passageRef} passageTitle={passageTitle} cut={NOTE_CUT}>
                  <div className="paper-rows mt-5">{content}</div>
                </NotePaper>
              )}
            />
          </Suspense>
        </div>
      )}
      <div className={NOTE_TOOLS}>
        {reading ? (
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => { userEditing.current = true; setEditing(true); }} className={`worship-note-edit ${BTN_SOFT}`}>수정</button>
            <button type="button" onClick={img.share} disabled={img.busy}
              className={`worship-note-image ${WITH_ICON} ${BTN_QUIET}`}>
              {/* 아이콘은 `Share2`다(사용자 결정 2026-09-10) — 하는 일이 내려받기가
                  아니라 **공유**이고, 막힌 판에서만 저장·새 탭으로 떨어진다(§6-32-k) */}
              {img.busy ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
              <span>이미지로 공유</span>
            </button>
          </span>
        ) : (
          <button type="button" onClick={save} disabled={!dirty || !hasText || busy} className={`worship-note-save ${BTN}`}>저장</button>
        )}
        <span className="min-w-0">
          <ShareChip state={shareState} label={shared ? '우리 순에 공유할게요' : '나만 볼게요'} />
        </span>
        {/* 취소는 고치던 것이 있을 때만 뜬다(처음 쓰는 노트에는 되돌아갈 글이 없다).
            칸 자체는 늘 있어야 격자가 흔들리지 않는다. */}
        <span className="justify-self-end">
          {!reading && saved && (
            <button type="button" onClick={cancel} className={`worship-note-cancel ${BTN_QUIET}`}>취소</button>
          )}
        </span>
        <ShareToggle className={NOTE_TOGGLE} value={shared} disabled={!saved || busy}
          onChange={setShare} shareLabel="순에 공유하기" />
      </div>
      {/* 공유·저장이 막힌 브라우저에서 마지막 갈래(hooks/useSheetShare.jsx) */}
      {img.overlay}
    </section>
  );
}

// ── 내 예배 노트 모아 보기 (사용자 결정 2026-09-25 · 목업 mockup-traces 1) ──────────
// 예배 화면 머리줄의 '내 예배 노트'가 여는 **같은 화면 안의 자리**다(말씀 세그먼트에 칸을 더하지
// 않는다 — 노트는 주보에서 쓰고 주보에서 고치므로 가는 길이 둘이 되면 안 된다). 목록에는 **쓴 것만**
// 최근 예배가 앞이고(serviceView.myNoteRows), 공유한 노트에는 `순에 공유` 칩이 선다.
// 누르면 그 노트 종이(NoteSheet — 주보 아래 노트와 같은 부품)가 선다: 데스크톱(≥768)은 목록 | 종이
// 두 칸이고 처음부터 맨 위 노트가 서 있다, 폰은 목록 → 종이(돌아가기 '내 예배 노트').
// 고치는 곳은 여전히 주보 한 곳이라 종이 위에는 `주보에서 열기` 하나뿐이다.
//
// rows는 [{ service, note }] | null(읽는 중). failed는 캐시 없는 첫 읽기 실패 — 빈 자리에 실패 두 줄과
// '다시 시도'가 선다(HANDOFF §8 D2 · 토스트는 띄우지 않는다).
//
// **0건일 때**(사용자 결정 2026-09-25 · 목업 mockup-followup 1): 노트 그림 + `예배 노트가 아직 없어요`
// (사용자가 직접 고른 문구 — §8의 '없어요' 규칙보다 앞선다) + 연한 accent 버튼 `{M월 D일} 예배 노트
// 쓰기`(날짜 글자는 utils.formatDay 한 벌). 버튼이 가리키는 주보(writeTarget)는 발행본 중 service_date ≤ 오늘(KST)인 가장 최근 것이다 —
// 아직 드리지 않은 예배의 노트를 권하지 않는다. 누르면 그 주보 상세의 내 예배 노트 칸까지 내려가
// 편집 상태로 연다. 노트가 한 건이라도 있으면 이 버튼은 없다.
const NOTE_CARD = 'worship-mynote-card w-full text-left px-4 py-3.5 rounded-[10px] shadow-soft transition active:scale-[.995]';
export function MyNotesScreen({ rows = null, failed = null, onBack, onOpenService, writeTarget = null, onWrite }) {
  const [picked, setPicked] = useState(null);      // 폰에서 누른 노트(주보 id) — 없으면 목록
  const list = rows || [];
  // 데스크톱은 고른 게 없으면 맨 위 노트를 세운다(두 칸이 처음부터 차 있게)
  const shownId = picked || list[0]?.service?.id || null;
  const shown = list.find(r => r.service.id === shownId) || null;
  const sections = useMemo(() => splitNoteSections(shown?.note?.body || ''), [shown?.note?.body]);
  const openBtn = shown && (
    <button type="button" onClick={() => onOpenService(shown.service)}
      className={`worship-mynote-open ${WITH_ICON} ${BTN_QUIET}`}>
      <NotebookPen size={13} /> <span>주보에서 열기</span>
    </button>
  );
  return (
    <div className="worship-mynotes dc-screen pb-10">
      {/* 폰에서 종이를 보는 동안은 돌아가기가 '내 예배 노트'(목록)다 — 예배로 가는 돌아가기는 숨는다 */}
      <div className={`${picked ? 'hidden md:flex' : 'flex'} items-center mb-1.5`}>
        <button type="button" onClick={onBack}
          className="worship-mynotes-back inline-flex items-center gap-1 -ml-1 px-1.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[12.5px] font-semibold transition active:scale-95">
          <ArrowLeft size={14} /> 예배
        </button>
      </div>
      {picked && (
        <div className="flex md:hidden items-center gap-2 mb-2.5">
          <button type="button" onClick={() => setPicked(null)}
            className="worship-mynotes-list inline-flex items-center gap-1 -ml-1 px-1.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[12.5px] font-semibold transition active:scale-95">
            <ArrowLeft size={14} /> 내 예배 노트
          </button>
          <span className="flex-1" />
          {openBtn}
        </div>
      )}
      <h2 className={`${picked ? 'hidden md:block' : ''} text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px] mb-4`}>내 예배 노트</h2>

      {failed ? (
        <WorshipEmpty className="worship-mynotes-failed" text="내 예배 노트를 받지 못했어요">
          <FailTail reason={failed.reason} onRetry={failed.onRetry} />
        </WorshipEmpty>
      ) : rows === null ? (
        <div className="worship-mynotes-loading grid gap-2.5 md:w-[340px]" aria-hidden="true">
          {[0, 1, 2].map(k => <div key={k} className="h-[76px] rounded-[10px] dc-skeleton" />)}
        </div>
      ) : !list.length ? (
        <WorshipEmpty className="worship-mynotes-empty" text="예배 노트가 아직 없어요" mark={<NoteMark />} alert={false}>
          {writeTarget && onWrite && (
            <div className="mt-3">
              <button type="button" onClick={() => onWrite(writeTarget)} className={`worship-mynotes-write ${BTN_SOFT}`}>
                {formatDay(writeTarget.service_date)} 예배 노트 쓰기
              </button>
            </div>
          )}
        </WorshipEmpty>
      ) : (
        <div className="md:grid md:grid-cols-[340px_minmax(0,1fr)] md:gap-7 md:items-start">
          <ul className={`worship-mynotes-listbox ${picked ? 'hidden md:grid' : 'grid'} gap-2.5`}>
            {list.map(({ service, note }) => {
              const on = service.id === shownId;
              return (
                <li key={service.id}>
                  <button type="button" onClick={() => setPicked(service.id)} aria-pressed={on}
                    className={`${NOTE_CARD} ${on ? 'md:ring-2 md:ring-accent' : ''}`}
                    style={{ backgroundColor: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
                    <span className="flex items-start gap-2">
                      <span className="worship-mynote-title flex-1 min-w-0 text-[15px] font-bold text-fg tracking-[-0.2px] break-words">
                        {service.title || '설교 제목 미정'}
                      </span>
                      {note.shared_to_sun && (
                        <span className="worship-mynote-shared shrink-0 mt-0.5 px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg text-[10.5px] font-bold whitespace-nowrap">순에 공유</span>
                      )}
                    </span>
                    <span className="worship-mynote-meta block mt-1 text-[12.5px] leading-relaxed text-fg-muted truncate">
                      {[formatServiceDate(service.service_date), service.passage_ref].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {shown && (
            <div className={`worship-mynote-paper ${picked ? 'block' : 'hidden md:block'} min-w-0`}>
              <div className="hidden md:flex justify-end mb-2">{openBtn}</div>
              <div className={SHEET_BOX}>
                <div className="rounded-lg overflow-hidden border border-line">
                  <NoteSheet date={paperDate(shown.service.service_date)} kind="예배 노트"
                    passageRef={shown.service.passage_ref || ''} passageTitle={shown.service.title || ''}
                    sections={sections} cut={NOTE_CUT} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
