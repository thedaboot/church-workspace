import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Search, X, Hash, MessageSquare, Paperclip } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectProjectsList, selectProjectsMap, selectTasksList, selectTasks } from '../store/selectors.js';
import { imeComposing } from '../utils.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { useDismiss } from '../hooks/useDismiss.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { Skeleton } from './media.jsx';
import { semanticOn, matchDocs, peekDocs } from '../services/semantic.js';
import { relatedKey, relatedReady, relatedTasks, RELATED_KIND_LABEL, RELATED_DEBOUNCE_MS } from '../services/vecSearch.js';

// ============================================================================
// 통합 검색 — 데스크톱 상단의 인라인 칸 + 결과 판(body 포털 · z-[80]) · 폰 상단바의 아이콘 + 전체 판(body 포털 · z-50).
// 19차 묶음 D에서 layout.jsx에서 갈라 왔다(동작·모양은 그대로).
//   · 글자 결과(공백·NFC를 맞춘 includes · 프로젝트·업무·첨부 글자·댓글) 아래에 뜻 결과 '관련된 업무 내용'(게스트는 없다)
//   · 돌아가는 안내 문구(useRotatingHint · SearchHint) — 성경 본문 검색 칸(wordBible)도 쓴다(layout.jsx 재수출로 들인다)
//   · z 자리는 HANDOFF §8 '떠 있는 것' — 결과 판 z-[80](tests/mobbits가 body의 첫 z-[90]을 프로필 메뉴로 본다) ·
//     폰 판은 상단바 안이 아니라 body로(PITFALLS 9-cb) · 바깥 누름 닫기에 포털 판도 '안'으로(PITFALLS 17-d)
// 이 결과 판은 칸 폭을 따르고(matchWidth) 열 때 place()를 부르지 않는다 — 공용 usePopover를 쓰지 않는 이유다.
// ============================================================================

// 매치 부분을 <mark>로 강조(첫 등장 위치 기준)
const highlight = (text, q) => {
  if (!text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>{text.slice(0, idx)}<mark className="bg-tag-yellow text-tag-yellow-fg rounded-[2px] px-0.5">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>
  );
};

const SEARCH_LIMIT = 8; // 그룹당 최대 표시 수

// ── 검색창 안내 문구 (사용자 결정 2026-08-31) ────────────────────────────────
// 셋을 2초씩 돌린다. 첫 줄만으로는 **첨부 안 글자와 댓글까지 찾는다는 걸 아무도
// 모르는** 상태였다(그게 이 검색의 숨은 값이다). 셋을 한 줄에 이어 붙이면 320px
// 칸에서 잘리므로 돌린다.
const SEARCH_HINTS = [
  '프로젝트나 업무를 검색해봐요!',
  '댓글이나 첨부 파일도 검색 가능해요',
  '무엇을 찾고 계신가요?',
];
const HINT_HOLD_MS = 2000;   // 떠 있는 시간
const HINT_FADE_MS = 700;    // 사라지고 나타나는 시간 — 천천히(사용자 결정 2026-08-31)

// 돌아가는 문구. **input의 placeholder 속성은 첫 줄로 고정**하고(스크린 리더와
// 검사가 그걸 본다) 눈에 보이는 글자는 겹쳐 놓은 span이 그린다 — placeholder
// 가상 요소는 브라우저마다 전환이 제각각이라 opacity를 믿을 수 없다.
// `on`이 false면(글자를 쳤거나 reduced-motion) 첫 줄에서 멈춘다.
//
// **한 벌이다** — 문구 배열만 받는다(2026-09-09에 성경 본문 검색 칸도 이걸 쓴다 ·
// components/wordBible.jsx). 줄이 하나뿐이면 타이머를 아예 걸지 않는다(게스트의
// 본문 검색이 그렇다 — 돌릴 것이 없는데 700ms마다 다시 그릴 이유가 없다).
export function useRotatingHint(on, hints = SEARCH_HINTS) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);
  const len = hints.length;
  useEffect(() => {
    if (!on || len < 2) { setI(0); setVisible(true); return; }
    let t;
    const fadeOut = () => { setVisible(false); t = setTimeout(swap, HINT_FADE_MS); };
    const swap = () => { setI(n => (n + 1) % len); setVisible(true); t = setTimeout(fadeOut, HINT_HOLD_MS); };
    t = setTimeout(fadeOut, HINT_HOLD_MS);
    return () => clearTimeout(t);
  }, [on, len]);
  return { text: hints[i] || hints[0] || '', visible };
}

// 겹쳐 놓은 안내 글자. 부모가 relative여야 하고, 왼쪽 여백(아이콘 폭)은 부모가 정한다.
export const SearchHint = ({ show, left, size, hints = SEARCH_HINTS }) => {
  // 움직임을 줄이라고 한 사람에게는 돌리지 않는다(§4.2) — 첫 줄만 가만히 보여준다
  const still = useReducedMotion();
  const { text, visible } = useRotatingHint(show && !still, hints);
  if (!show) return null;
  return (
    <span aria-hidden data-hint=""
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 right-3 truncate text-fg-faint transition-opacity ${size}`}
      style={{ left, opacity: visible ? 1 : 0, transitionDuration: `${HINT_FADE_MS}ms` }}>
      {text}
    </span>
  );
};

// ── 관련된 업무 내용 (뜻 검색 · 사용자 결정 G-a 2026-09-25) ──────────────────
// 글자 결과는 공백을 뺀 includes라 띄어쓰기·낱말이 조금만 달라도 못 찾고('찬양 기획' ↛ '찬양예배 기획'),
// 클라우드에서는 열어 본 업무의 댓글·첨부만 손에 있다(PITFALLS 6-20). 그래서 글자 결과 **아래에**
// doc_vec(0074)으로 찾은 업무를 최대 다섯 줄 세운다 — 위에 이미 선 업무는 빼고, 줄마다 어디에 걸렸는지
// 한 줄('댓글 · ' · '첨부 · ' · '상세 내용 · '). 모양은 services/vecSearch.js, 왕복은 services/semantic.js.
//   · 두 글자부터 · 치는 동안은 묻지 않는다(RELATED_DEBOUNCE_MS) · 같은 물음은 메모리에서 · 옛 물음은 끊는다
//   · 도는 동안은 글 없이 줄 모양 뼈대만 · 못 찾았거나 실패하면 구역째 없다(설명 줄 없음)
//   · **게스트 모드에서는 구역도 네트워크도 없다**(semanticOn) — 그래서 검사는 이 길을 못 탄다(실기기 확인)
function useRelated(query) {
  const ready = semanticOn() && relatedReady(query);
  const key = relatedKey(query);
  const [got, setGot] = useState({ key: '', rows: null });
  useEffect(() => {
    if (!ready) return undefined;
    const hit = peekDocs(key);
    if (hit) { setGot({ key, rows: hit }); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      matchDocs(key, { signal: ctl.signal })
        .then(rows => { if (!ctl.signal.aborted) setGot({ key, rows }); })
        .catch(e => {
          if (ctl.signal.aborted || e?.name === 'AbortError') return;
          console.warn('[search] 관련된 업무 내용을 받지 못했어요:', e);
          setGot({ key, rows: [] });
        });
    }, RELATED_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, key]);
  if (!ready) return { on: false, loading: false, rows: [] };
  const rows = got.key === key ? got.rows : (peekDocs(key) || null);
  return { on: true, loading: rows === null, rows: rows || [] };
}

// 뜻 결과 한 줄의 표시 — 업무는 초록(글자 결과와 같다), 댓글은 파랑, 첨부는 주황(목업에서 정한 색)
const RELATED_ICON = {
  card: { Icon: CheckSquare, cls: 'bg-tag-green text-tag-green-fg' },
  comment: { Icon: MessageSquare, cls: 'bg-tag-blue text-tag-blue-fg' },
  file: { Icon: Paperclip, cls: 'bg-tag-orange text-tag-orange-fg' },
};

// 기다리는 동안의 줄 — 실제 줄(아이콘 24 · 제목 20 · 아랫줄 15 · py-2.5)과 같은 높이를 잡는다
const RelatedSkeleton = () => (
  <div className="search-related-skel flex items-center gap-2 px-2 py-2.5" aria-hidden="true">
    <Skeleton className="w-6 h-6 rounded-md shrink-0" />
    <span className="flex-1 min-w-0">
      <span className="flex items-center h-5"><Skeleton className="h-2.5 w-[70%] rounded-xs" /></span>
      <span className="flex items-center h-[15px]"><Skeleton className="h-2 w-[45%] rounded-xs" /></span>
    </span>
  </div>
);

// 결과 계산 + 렌더 (검색 중일 때만 마운트 → store 구독·계산도 그때만 발생)
// useDeferredValue로 타이핑 입력과 무거운 결과 렌더를 분리해 렉 방지
function SearchResults({ query, onPick }) {
  const projectsList = useStore(selectProjectsList);
  const tasksList = useStore(selectTasksList);
  const tasksById = useStore(selectTasks).byId;
  const projectsMap = useStore(selectProjectsMap);
  const deferred = useDeferredValue(query);
  const related = useRelated(deferred);

  const results = useMemo(() => {
    // 공백을 지우고 비교한다 — "버스 견적"이 "전세버스 견적서"를 못 찾던 것(§1.3)이
    // 대부분 띄어쓰기 차이였다. RAG 없이 잡히는 것부터 잡는다.
    // NFC로 맞춰 비교한다 — 맥에서 올린 파일 이름은 한글이 자모로 풀린 NFD로 저장돼 있어
    // 같은 글자를 쳐도 안 걸렸다(업로드는 이제 NFC로 저장한다 · 0072가 옛 행을 맞춘다).
    const norm = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
    const q = norm(deferred);
    if (q.length < 2) return null;
    const hit = (x) => norm(x).includes(q);
    const projectHits = projectsList.filter(p => hit(p.title));
    // 첨부 이름·댓글도 본다. 클라우드에서는 열어 본 카드만 채워져 있다(§6-20) —
    // 그래도 없는 것보다 낫고, 게스트·최근에 연 카드에서는 온전히 잡힌다.
    const taskHits = tasksList.filter(t =>
      hit(t.title) || hit(t.content) ||
      (t.assignees || []).some(hit) ||
      (t.teams || []).some(hit) ||
      // 첨부는 이름뿐 아니라 **안에 든 글자**도 본다(files.text_excerpt, 0030).
      // "야식 찬조"로 결산 엑셀이 잡힌다. 백필한 사진에는 Gemini 캡션([사진] 접두)이 있어
      // 그 글로도 잡힌다 · 새로 올리는 사진에는 캡션이 생기지 않아 이름으로만 잡힌다.
      (t.attachments || []).some(a => (typeof a === 'string' ? hit(a) : (hit(a?.name) || hit(a?.text_excerpt)))) ||
      (t.comments || []).some(c => hit(c?.text))
    );
    return { projectHits, taskHits };
  }, [deferred, projectsList, tasksList]);

  const pShown = results ? results.projectHits.slice(0, SEARCH_LIMIT) : [];
  const tShown = results ? results.taskHits.slice(0, SEARCH_LIMIT) : [];
  // 위에 이미 선 업무는 뜻 결과에서 뺀다(같은 업무를 두 번 세우지 않는다)
  const shownIds = tShown.map(t => t.id).join(',');
  const relatedRows = useMemo(
    () => relatedTasks(related.rows, { tasksById, exclude: new Set(shownIds ? shownIds.split(',') : []) }),
    [related.rows, tasksById, shownIds],
  );

  if (!results) return null;
  const empty = results.projectHits.length === 0 && results.taskHits.length === 0;
  const showRelated = related.on && (related.loading || relatedRows.length > 0);
  // '검색 결과가 없어요'는 **그 문구가 서는 자리의 가운데**다 — 뜻 결과 구역이 있으면 글자 결과
  // 자리(구역 위) 안에서, 없으면 판 전체에서 가로·세로 가운데(사용자 요청 2026-09-25 · tests/navsmoke·mobbits).
  const none = <p className="search-none px-3 py-6 text-center text-xs text-fg-faint">검색 결과가 없어요</p>;
  if (empty && !showRelated) return none;

  const pMore = results.projectHits.length - pShown.length;
  const tMore = results.taskHits.length - tShown.length;
  const q = deferred.trim();

  return (
    <>
      <div className="search-text">
        {empty && none}
        {pShown.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-fg-muted uppercase tracking-wider">프로젝트</p>
            {pShown.map(p => (
              <button key={p.id} onClick={() => onPick('project', p)} className="w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left hover:bg-surface-hover transition-colors">
                <span className="w-6 h-6 rounded-md bg-tag-purple text-tag-purple-fg flex items-center justify-center shrink-0"><Hash size={13} strokeWidth={1.75} /></span>
                <span className="text-sm text-fg truncate min-w-0">{highlight(p.title, q)}</span>
                {/* 보관된 것도 검색에는 나온다(지운 게 아니다) — 대신 그렇다고 표시한다 */}
                {p.archived && <span className="shrink-0 text-[10px] text-fg-muted">보관</span>}
              </button>
            ))}
            {pMore > 0 && <p className="px-2 py-1 text-[10px] text-fg-muted">그 외 {pMore}건 더 있어요</p>}
          </div>
        )}
        {tShown.length > 0 && (
          <div>
            <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-fg-muted uppercase tracking-wider">업무</p>
            {tShown.map(t => (
              <button key={t.id} onClick={() => onPick('task', t)} className="w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left hover:bg-surface-hover transition-colors">
                <span className="w-6 h-6 rounded-md bg-tag-green text-tag-green-fg flex items-center justify-center shrink-0"><CheckSquare size={13} strokeWidth={1.75} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-fg truncate">{highlight(t.title, q)}</span>
                  <span className="block text-[10px] text-fg-muted truncate">{projectsMap[t.projectId]?.title || '프로젝트 미지정'}</span>
                </span>
              </button>
            ))}
            {tMore > 0 && <p className="px-2 py-1 text-[10px] text-fg-muted">그 외 {tMore}건 더 있어요</p>}
          </div>
        )}
      </div>
      {showRelated && (
        <div className="search-related mt-1" aria-busy={related.loading || undefined}>
          <p className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-fg-muted uppercase tracking-wider">관련된 업무 내용</p>
          {related.loading ? <><RelatedSkeleton /><RelatedSkeleton /></> : relatedRows.map(({ task, kind, excerpt }) => {
            const { Icon, cls } = RELATED_ICON[kind] || RELATED_ICON.card;
            return (
              <button key={task.id} onClick={() => onPick('task', task)} data-kind={kind}
                className="search-related-row w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-left hover:bg-surface-hover transition-colors">
                <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${cls}`}><Icon size={13} strokeWidth={1.75} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-fg truncate">{task.title}</span>
                  <span className="block text-[10px] text-fg-muted truncate">
                    {excerpt ? `${RELATED_KIND_LABEL[kind]} · ${excerpt}` : (projectsMap[task.projectId]?.title || '프로젝트 미지정')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// 통합 검색 — 데스크톱 인라인 드롭다운 + 모바일 아이콘 트리거·전체폭 오버레이
// store 구독/결과 계산은 SearchResults(검색어 2자+ 일 때만 마운트)로 분리해 타이핑 렉 제거
export function SearchBox({ onSearchSelect, variant = 'inline' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);        // 데스크톱 드롭다운
  const [mobileOpen, setMobileOpen] = useState(false); // 모바일 오버레이
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const active = query.trim().length >= 2;

  // 데스크톱 결과 판은 **body 포털**이다(HANDOFF §8 '떠 있는 것') — 폭은 검색칸에서 잰다
  // (matchWidth). z는 z-[80]: 프로필 메뉴가 z-[90]이고 검사(tests/mobbits)가 body의 첫 z-[90]을
  // 그 메뉴로 본다 — 같은 z를 쓰면 엉뚱한 판을 잰다.
  // 폭은 칸을 따르되 **320px 아래로는 줄이지 않는다**(minWidth) — 768~1030px에서 칸이 54~310px로
  // 줄어 결과 판이 글자 하나 폭의 기둥이 됐다(2026-09-25 · tests/navsmoke). 넓힌 판은 화면 안으로 갇힌다.
  const listOpen = open && active;
  const [listPos] = useAnchoredPos(rootRef, listOpen, 320, 360, 8, listRef, { matchWidth: true, minWidth: 320, align: 'start' });

  // 데스크톱: 바깥 클릭 / Escape 닫기. 프로필 메뉴·더보기와 **같은 훅**을 쓴다 — 닫는 규칙이
  // 여러 벌이면 한쪽만 고쳐진다. 결과 판이 포털이라 **그 판도 '안'으로** 넘긴다(useDismiss 머리말).
  useDismiss(open, () => setOpen(false), [rootRef, listRef]);

  // 검색어가 바뀌면 목록을 맨 위로 — 목록 상자가 그대로 남아 스크롤 위치를 물려받아서, 내려 본
  // 뒤에 한 글자를 더 치면 새 결과의 가운데(또는 첫 줄이 반쯤 잘린 자리)부터 보였다(2026-09-25).
  const mobileListRef = useRef(null);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    if (mobileListRef.current) mobileListRef.current.scrollTop = 0;
  }, [query]);

  const reset = () => setQuery('');
  const closeMobile = () => { setMobileOpen(false); reset(); };

  // 모바일 오버레이: Escape 닫기
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { setMobileOpen(false); setQuery(''); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const pick = (kind, item) => { onSearchSelect(kind, item); setOpen(false); setMobileOpen(false); reset(); };

  // ── 키보드로 결과 고르기 (데스크톱 · 2026-09-25) ──────────────────────────
  // 결과 판이 body 포털이라 **Tab으로는 닿지 않는다**(DOM 순서가 문서 맨 끝이다) — 키보드로는
  // 결과를 열 길이 아예 없었다. ↓로 판에 들어가고 ↑↓로 줄을 옮긴다. 여는 것은 줄 버튼의
  // Enter(브라우저 기본)이고, 첫 줄에서 ↑ · Esc는 칸으로 돌아간다(Esc는 useDismiss가 판도 닫는다).
  // 표시는 앱 전역의 focus-visible 테두리 그대로다 — 새 모양을 더하지 않는다.
  const inputRef = useRef(null);
  const onInputKey = (e) => {
    if (imeComposing(e)) return;   // 조합 중 ↓는 글자 확정이다
    if (e.key === 'ArrowDown' && listOpen) {
      const first = listRef.current?.querySelector('button');
      if (first) { e.preventDefault(); first.focus(); }
    }
  };
  const onListKey = (e) => {
    const btns = [...(listRef.current?.querySelectorAll('button') || [])];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? inputRef.current : btns[i - 1])?.focus(); }
    else if (e.key === 'Escape') inputRef.current?.focus();
  };

  // 아이콘 트리거 + 전체폭 오버레이 (모바일 상단바)
  if (variant === 'icon') {
    return (
      <>
        <button className="p-2 rounded-md text-fg-muted transition active:scale-95 shrink-0" onClick={() => setMobileOpen(true)} title="검색"><Search size={19} /></button>
        {/* 불투명 배경 — 모바일 GPU 비용 큰 blur 미사용.
            **body 포털이다**(2026-09-25) — 상단바 상자가 flex 항목에 z-20이라 쌓임 맥락을 만들어,
            안에 둔 z-50 판이 하단 탭바(z-40)보다 아래에 깔렸다. 탭바가 어둡게 덮이지 않고 눌렸고,
            가로 폰에서는 마지막 결과가 탭바 밑에 가렸다(tests/mobbits). */}
        {mobileOpen && createPortal(
          <div className="fixed inset-0 z-50 bg-black/50 animate-in fade-in duration-150" onClick={closeMobile}>
            <div className="absolute inset-x-0 top-0 bg-surface border-b border-line shadow-elevated p-3 animate-in fade-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
                  <input
                    autoFocus type="text" value={query} onChange={e => setQuery(e.target.value)}
                    /* 키보드의 '검색'(Enter)은 **키보드를 내린다**(2026-09-25) — 전에는 아무 일도 없어
                       키보드를 내릴 길이 없었고, 그 뒤에 결과 절반이 가려 있었다. 결과는 이미 떠 있다. */
                    enterKeyHint="search"
                    onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') e.currentTarget.blur(); }}
                    /* 속성은 첫 줄로 고정하고 보이는 글자는 SearchHint가 그린다 */
                    placeholder={SEARCH_HINTS[0]} aria-label={SEARCH_HINTS[0]}
                    className="pl-9 pr-3 py-2 text-sm bg-surface border border-line rounded-xs focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all placeholder:text-transparent"
                  />
                  <SearchHint show={!query} left="2.25rem" size="text-sm" />
                </div>
                <button onClick={closeMobile} aria-label="닫기" className="p-2 rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95 shrink-0"><X size={18} /></button>
              </div>
              {/* 높이는 **보이는 창(--app-vh · App.jsx)** 안으로도 가둔다(2026-09-25) — 70dvh만으로는
                  아이폰 키보드가 올라와도 줄지 않아(dvh는 키보드를 모른다) 마지막 결과가 키보드 밑에
                  남았고, 끝까지 내려도 닿지 않았다. 5rem = 목록 위(칸 줄 58px) + 아래 여백 12px + 틈. */}
              {active && (
                <div ref={mobileListRef} className="mt-2 max-h-[min(70dvh,calc(var(--app-vh,100dvh)_-_5rem))] overflow-y-auto">
                  <SearchResults query={query} onPick={pick} />
                </div>
              )}
            </div>
          </div>, document.body)}
      </>
    );
  }

  // 데스크톱 인라인 검색창 + 드롭다운
  return (
    <div className="relative w-full max-w-[320px]" ref={rootRef}>
      <Search className="w-[15px] h-[15px] absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
      <input
        ref={inputRef} type="text" value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={onInputKey}
        placeholder={SEARCH_HINTS[0]} aria-label={SEARCH_HINTS[0]}
        className="pl-8 pr-3 h-8 text-[12.5px] bg-surface/60 border border-line rounded-sm focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent-weak outline-none w-full transition-all placeholder:text-transparent"
      />
      <SearchHint show={!query} left="2rem" size="text-[12.5px]" />
      {listOpen && createPortal(
        <div ref={listRef} onKeyDown={onListKey} style={{ position: 'fixed', left: listPos.left, top: listPos.top, width: listPos.width }}
          className="z-[80] max-h-[360px] overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1.5 transition-none animate-in fade-in zoom-in-95 duration-150">
          <SearchResults query={query} onPick={pick} />
        </div>, document.body)}
    </div>
  );
}
