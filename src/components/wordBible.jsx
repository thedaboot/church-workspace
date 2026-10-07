import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Bookmark, Search, X } from 'lucide-react';
import { loadBibleIndex, loadBook, forEachPool, warmBooks, POOL } from '../services/bible.js';
import { parseRef } from '../services/bibleRef.js';
import { aiBibleSearchOutcome, hitLabel } from '../services/bibleSearch.js';
import { semanticOn, matchBible } from '../services/semantic.js';
import { andParticle, bibleVecHits } from '../services/vecSearch.js';
import { AiService, aiEnabled } from '../services/ai.js';
import {
  loadBibleState, loadFontStep, saveFontStep,
  chapterKey, parseChapterKey, verseKey, parseVerseKey, bibleSearchStore,
  pushRecentSearch, removeRecentSearch, compactText, matchRanges,
  kstToday, weekRange, fetchScheduleRange, fetchChapterReaders, markChapterRead, fetchSharedOn,
  loadReadShare, saveReadShare,
} from '../services/word.js';
import { READ_DWELL_MS, weekStartOf, readersView, qtDatesCovering } from '../services/bibleReads.js';
import { MOODS, moodAsk } from '../data/moods.js';
import { MOOD_CHIP, MOOD_GAP, fitMoods, orderOnOpen, validMemo } from '../services/moodPick.js';
import { useStore } from '../store/workspaceStore.js';
import { selectMembers } from '../store/selectors.js';
import { myUidSync } from '../services/supabaseClient.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { Avatar } from './Avatar.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { SectionHead, Card } from '../views/dashboardParts.jsx';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { SearchHint } from './layout.jsx';
import { Skeleton } from './media.jsx';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { coarsePointer } from '../utils.js';
import {
  Swap, PassageText, PassageSkeleton, EmptyBookMark, FontSteps, ShareSwitch, hlColor,
  useStateBox, useVersePaint, marksFor,
} from './bibleParts.jsx';
import { groupByBook, MarkSection } from './bibleMarks.jsx';

// 공용 부품은 bibleParts.jsx로 옮겼다(19차) — 예배·내 정보는 예전처럼 여기서 가져간다
export { EmptyBookMark, PassageSkeleton, ShareSwitch, hlColor };

// ============================================================================
// 성경 읽기 — 목차 · 리더 · 본문 검색 · 북마크 · 형광펜 · 이어읽기 (docs/V2.md 결정 12)
// ----------------------------------------------------------------------------
// 본문은 public/bible/*.json(개역한글)이고 로더는 services/bible.js 하나다.
// '(없음)'·'[ ]'·'(셀라)'는 대한성서공회의 편집 표기라 데이터에 그대로 있다 —
// 지우면 절 번호가 통째로 밀리므로 **화면에서만** 흐리게 그린다
// (public/bible/README.md · services/bible.js 머리말).
//
// 검색은 인덱스를 만들지 않는다. 66권을 받아 훑고, 책 하나가 끝날 때마다 진행을
// 그린다(첫 검색은 4.5MB를 받으므로 그 사이 화면이 멈춰 보이면 안 된다).
// **받는 것은 겹치게, 훑는 것은 정경 순으로**(사용자 요청 2026-09-08 — "검색 속도
// 개선"). 예전에는 for 안에서 `await loadBook`을 한 권씩 기다려서 왕복이 66번 줄줄이
// 섰다. 지금은 services/bible.js의 forEachPool이 여섯 권을 동시에 띄우고, 훑기는
// 도착 순서가 아니라 목록 순서로 부른다 — 그래야 결과 줄과 상한(50건)에서 잘리는
// 자리가 정경 순 그대로다. 받은 책은 메모리와 Cache Storage에 남아 새로고침 뒤에도 빠르다.
//
// **검색은 두 갈래를 동시에 돌린다**(사용자 요청 2026-09-08 — "본문 검색에 AI를 넣어
// 시멘틱 서치가 가능하도록"). 낱말 그대로 찾는 것(위)과 뜻으로 찾는 것
// (services/bibleSearch.js)이고, 결과 칸에 두 도막으로 선다. AI 쪽이 비거나 실패하면
// 그 도막을 통째로 감춘다 — 왜 없는지 설명하는 줄을 붙이지 않는다(§8).
//
// **최근 검색어는 검색 칸에 딸린 판이다**(사용자 요청 2026-09-14 · 0065). 칸을 비운 채
// 들어왔을 때만 서고, 한 줄을 누르면 그 말로 바로 검색이 돈다(runSearch 한 길). 쌓는
// 자리도 runSearch 하나다 — 글자를 칠 때마다 남기면 '사'·'사사'·'사사기'가 세 줄이 된다.
// 상한 30·중복 제거는 services/word.js의 pushRecentSearch가 하고, 저장 자리는
// bible_state의 같은 행이다(이어읽기·북마크·형광펜과 한 벌로 읽고 쓴다).
//
// **목차 · 북마크 · 형광펜은 세 화면이다**(사용자 피드백 2026-09-02 4차 — "목차 화면에
// 북마크·형광펜 목록이 같이 보인다"). 예전에는 넓은 화면에서 옆 칸(300px)에, 좁은
// 화면에서는 목차 위에 '내 기록'을 세웠다. 그래서 ① 책을 고르러 온 사람이 북마크 목록을
// 지나쳐야 했고 ② 좁은 폭에서 **본문을 읽는 동안에는 두 목록에 닿을 길이 아예 없었다**
// (옆 칸은 lg에서만 서고, 목차 위 자리는 목차 화면에만 있었다). 지금은 검색 줄 아래
// 세그먼트가 어느 폭에서도 늘 서 있고, 고른 것 하나만 그린다.
//
// **폭: 어느 화면도 상한을 두지 않는다**(사용자 피드백 2026-09-03 — "어느 폭에서도 빈
// 구간 없이 채울 것"). 검색 줄·리더·검색 결과·목차·북마크·형광펜 전부 컨테이너를 채운다.
// 예전에는 읽기 폭을 46rem에서 끊었는데(한 줄이 길면 다음 줄 첫 글자를 눈이 못 찾는다),
// 1000px 남짓에서 오른쪽에 230px 빈 띠가 남는 쪽이 더 거슬렸다 — 사용자 결정이 이긴다.
// 대신 목록은 폭이 넓어질수록 열을 늘려(2 → 3열) 한 열이 너무 길어지지 않게 하고, 책
// 머리글의 개수는 이름 **바로 옆**에 붙인다(오른쪽 끝에 붙이면 넓은 열에서 400px 떨어진다).
//
// **파일 셋으로 나뉜다**(19차 2026-10-07): 본문 한 덩이·형광펜·화면 전환·성경 상태 그릇은 bibleParts.jsx,
// 북마크·형광펜 목록은 bibleMarks.jsx, 여기는 리더(BibleTab)·검색·목차다. BibleTab의 상태는 훅 넷으로 갈랐다 —
// 검색(useBibleSearch) · 최근 검색어 판과 마음 칩 차례(useRecentPanel) · 이 장을 본 사람(useChapterReaders) ·
// 쓸어 넘기기(useSwipe). 훅은 이 파일 안에 둔다(검사가 이 파일의 글자로 배선을 본다).
// ============================================================================

const OT_COUNT = 39;               // 정경 순서 — index.json의 앞 39권이 구약
const SWIPE_MIN = 60;              // px — 이만큼 가로로 쓸면 장을 넘긴다(모바일)
// 낱말 결과는 **한 번에 50줄씩** 그린다(2026-09-25 — 예전에는 50건에서 훑기를 멈춰서 '하나님'·'사랑'
// 같은 흔한 말은 창세기·출애굽기에서 끝나고 신약이 통째로 빠졌다). 이제 66권을 끝까지 훑어 건수는
// 전부 세고, 줄은 50씩 '더 보기'로 이어 편다(수천 줄을 한 번에 그리면 폰이 멈춘다).
const RESULT_PAGE = 50;
// 검색 결과로 들어온 절의 테두리 강조가 남아 있는 시간(사용자 요청 2026-09-08 —
// "그 이후 강조 표시가 3초 후에는 없어져도 될 것 같음"). 도착한 절을 못 찾는 일이
// 없게 데려다는 주되, 계속 테두리가 남아 있으면 그 절만 다른 글처럼 읽힌다.
const FOCUS_MS = 3000;

// ── 본문 검색 칸의 안내 문구 (사용자 요청 2026-09-09) ────────────────────────
// 메인 검색창과 **같은 한 벌**로 돌린다(layout.jsx의 useRotatingHint·SearchHint —
// 2초 떠 있고 0.7초에 걸쳐 갈아탄다. 두 벌을 만들지 않는다). placeholder 속성은
// 첫 줄로 고정하고 눈에 보이는 글자는 겹쳐 놓은 span이 그린다.
//
// 둘째 줄은 **AI를 부를 수 있을 때만** 넣는다 — 게스트에는 AI 도막이 아예 서지
// 않는데(§6-9-ar) "같이 찾아줄게요"라고 하면 없는 것을 약속하는 말이 된다.
const BIBLE_HINTS = ['어떤 본문을 찾으시나요?', 'AI가 본문을 같이 찾아줄게요'];
export const searchHints = (aiOn) => (aiOn ? BIBLE_HINTS : BIBLE_HINTS.slice(0, 1));

const btn = 'inline-flex items-center justify-center gap-1 rounded-md text-[12px] font-semibold transition active:scale-95';
// 따라다니는 장 넘기기 버튼 — 테두리 없이 옅은 판 + 은은한 그림자, hover에서만 떠오른다.
// **전이는 opacity·배경색만**(위치 속성에 걸면 sticky가 미끄러진다 — §6-17-b).
const chapNav = 'sticky w-11 h-11 flex items-center justify-center rounded-full bg-surface/80 shadow-soft '
  + 'text-fg-muted opacity-80 hover:opacity-100 hover:bg-accent-weak hover:text-accent-text '
  + 'transition-[opacity,background-color,color] duration-150 active:scale-95';

// 목차 · 북마크 · 형광펜 — 세그먼트 모양은 말씀 화면의 [QT | 성경 읽기]와 같은 한 벌이다
// 세그먼트 이름은 '본문'(사용자 결정 2026-09-05 — 전에는 '목차'였고, 그때는 리더의 되돌아가기가
// '책 목록'이었다). 이제 되돌아가기 버튼이 '목차'다.
const PANES = [['toc', '본문'], ['bookmark', '북마크'], ['highlight', '형광펜']];
const paneIndex = (key) => PANES.findIndex(p => p[0] === key);

const RECENT_MAX_H = 288;   // 최근 검색어 판의 높이 상한(예전 max-h-72) — 키보드가 있으면 더 줄어든다

// ── "이런 마음일 때" (사용자 결정 2026-09-25 · 목업 '은혜와 리듬' 5번) ─────────────
// 최근 검색어 판 맨 위의 칩 **한 줄**. 규칙은 services/moodPick.js 머리말 — 여기는 폭을 재는 일만 한다.
// 섞인 차례는 이 브라우저에 한 벌 기억한다(localStorage — 막혀 있으면 이 탭 안에서만): 판을 닫고 1분 안에
// 다시 열면 같은 칩, 지나면 새로 섞고 방금 보였던 칩은 뒤로 민다.
const MOOD_MEMO = 'bible_mood_memo';   // { order, shownAt, last }
let moodMemo = null;                   // localStorage가 막힌 기기의 대신 자리
const readMoodMemo = () => {
  try { const raw = localStorage.getItem(MOOD_MEMO); if (raw) return validMemo(JSON.parse(raw), MOODS.length); } catch { /* 막혔거나 깨졌다 */ }
  return validMemo(moodMemo, MOODS.length);
};
const writeMoodMemo = (memo) => {
  moodMemo = memo;
  try { localStorage.setItem(MOOD_MEMO, JSON.stringify(memo)); } catch { /* 사파리 비공개 모드 */ }
};
export function MoodChips({ order, width = 0, onPick, onFit }) {
  const rowRef = useRef(null);
  const probeRef = useRef(null);
  const [fit, setFit] = useState(null);   // 한 줄에 드는 후보 번호들(null이면 아직 안 쟀다)
  // **실제로 그린 칩 폭을 잰다** — 글자 수로 어림하면 글꼴·크기에 따라 넘친다. 보이지 않는 줄에 후보를
  // 전부 세워 offsetWidth(판의 zoom 등장 연출에 안 흔들린다)를 읽고, 소수점 몫으로 1px씩 넉넉히 잡는다.
  // 그리기 전에(layout) 정하므로 넘친 칩이 한 프레임 보였다 사라지는 일이 없다.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const probe = probeRef.current;
    if (!row || !probe) return;
    const widths = [...probe.children].map(c => c.offsetWidth + 1);
    const next = fitMoods(order, widths, row.clientWidth, MOOD_GAP);
    setFit(next);
    onFit?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, width]);
  return (
    <>
      <p className="px-2 pt-0.5 pb-1 text-[11px] font-bold text-fg-muted">이런 마음일 때</p>
      <div ref={rowRef} data-moods="" className="relative flex flex-nowrap gap-1.5 overflow-hidden px-1.5 pt-0.5 pb-2.5">
        {(fit || []).map(i => (
          <button key={i} type="button" data-mood={MOODS[i]} onClick={() => onPick(MOODS[i])} className={MOOD_CHIP}>
            {MOODS[i]}
          </button>
        ))}
        {/* 재는 줄 — 자리를 차지하지 않고 보이지 않는다(검사·화면 읽기에도 안 잡히게 aria-hidden) */}
        <span ref={probeRef} aria-hidden="true" className="absolute left-0 top-0 flex gap-1.5 invisible pointer-events-none h-0 overflow-hidden">
          {MOODS.map(label => <span key={label} className={MOOD_CHIP}>{label}</span>)}
        </span>
      </div>
    </>
  );
}

// ── 이번 주 이 장을 본 사람 (0080 · 사용자 결정 2026-09-25 · 목업 '은혜와 리듬' 6번) ──────
// 장 머리의 제목과 북마크 사이 — 얼굴 셋 + '+N', 나 제외, **이름순**, 시각·횟수·절 없음, 0명이면 자리째 없다.
// 누르면 판(body 포털 · HANDOFF §8 '떠 있는 것'): 제목 · 이름 줄(그 사람이 이 장에 걸친 이번 주 QT 묵상을
// 공유해 뒀으면 '나눔 보기') · 판 아래 '나도 나누기'(끄면 내 기록을 지우고 다시 남기지 않는다 — 내 정보에도 같은 토글).
// §7 '카드별 조회 추적'의 **예외다**(사용자 결정 — 공동체성). 되돌리지 말 것.
const READERS_W = 236;
function ChapterReaders({ view, shared = {}, onOpenShare }) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; loadReadShare().then(v => { if (alive) setShare(v); }); return () => { alive = false; }; }, []);
  useDismiss(open, () => setOpen(false), [btnRef, popRef]);
  const [pos] = useAnchoredPos(btnRef, open, READERS_W, 240, 8, popRef);
  const toggleShare = async () => {
    if (busy) return;
    const next = !share;
    setShare(next); setBusy(true);
    try { await saveReadShare(next); }
    catch (e) { setShare(!next); showToast(failText('나도 나누기를 바꾸지 못했어요', e)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button ref={btnRef} type="button" data-readers="" onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-label="이번 주 이 장을 본 사람"
        className="shrink-0 flex items-center h-11 px-1.5 rounded-md hover:bg-surface-hover transition-colors">
        {view.faces.map((p, i) => (
          <Avatar key={p.profile_id} name={p.name} url={p.avatarUrl || undefined}
            className={`flex w-[21px] h-[21px] text-[10px] ring-[1.5px] ring-surface ${i ? '-ml-1.5' : ''}`} />
        ))}
        {view.more > 0 && <span data-readers-more="" className="ml-1 text-[11px] font-bold text-fg-muted tabular-nums">+{view.more}</span>}
      </button>
      {open && createPortal(
        <div ref={popRef} data-readers-pop=""
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: READERS_W }}
          className="z-[90] bg-surface border border-line rounded-xl shadow-elevated p-2 transition-none animate-in fade-in zoom-in-95 duration-150">
          <p className="px-1.5 pt-0.5 pb-1.5 text-[11px] font-bold text-fg-muted">이번 주 이 장을 본 사람</p>
          <div className="max-h-[220px] overflow-y-auto">
            {view.all.map(p => (
              <div key={p.profile_id} data-reader={p.name} className="flex items-center gap-2 p-1.5 rounded-md text-[12.5px] font-semibold text-fg">
                <Avatar name={p.name} url={p.avatarUrl || undefined} className="flex w-[21px] h-[21px] text-[10px]" />
                <span className="min-w-0 truncate">{p.name}</span>
                {shared[p.profile_id] && onOpenShare && (
                  <button type="button" data-reader-share="" onClick={() => { setOpen(false); onOpenShare(shared[p.profile_id], p.profile_id); }}
                    className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold text-accent-text hover:bg-accent-weak transition-colors">
                    나눔 보기
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" role="switch" aria-checked={share} data-read-share="" onClick={toggleShare} disabled={busy}
            className="w-full mt-1.5 pt-2 pb-0.5 px-1.5 border-t border-line flex items-center justify-between text-[11.5px] font-semibold text-fg-muted">
            <span>나도 나누기</span>
            <ShareSwitch on={share} />
          </button>
        </div>, document.body)}
    </>
  );
}

// ── 본문 검색 (BibleTab의 검색 상태 한 벌) ──────────────────────────────────
// 낱말 그대로 찾기와 뜻으로 찾기를 같이 띄우고, 둘 다 같은 열쇠(searchToken)로 늦게 온 답을 버린다.
// stateArrived: bible_state가 도착했는가(BibleTab 머리 — 그 전에는 최근 검색어를 남기지 않는다).
function useBibleSearch({ books, state, update, stateArrived }) {
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState([]);
  const [shown, setShown] = useState(RESULT_PAGE);    // 낱말 결과 중 그리는 줄 수('더 보기'로 는다)
  // 검색 결과에서 절을 열었나 — 그러면 결과를 지우지 않고 들고 있다가 머리줄의 되돌아가기가
  // 목차 대신 **결과로** 돌아간다(2026-09-25 — 예전에는 절을 여는 순간 결과가 지워져 같은 검색을
  // 다시 쳐야 했다). 장을 넘겨도 그대로다(결과 속 절 앞뒤를 읽다가 돌아오는 흐름).
  const [fromSearch, setFromSearch] = useState(false);
  const [progress, setProgress] = useState(null);     // { done, total } · null이면 안 돌고 있다
  // 뜻으로 찾은 구절(services/bibleSearch.js). aiWait는 답을 기다리는 중인가 —
  // 게스트 모드(로그인이 없는 빌드)에서는 묻지도 않으므로 둘 다 그대로 비어 있다.
  const [aiHits, setAiHits] = useState([]);
  const [aiWait, setAiWait] = useState(false);
  // AI 도막에 선 줄이 어디서 왔나 — 'ai'(평소) | 'vec'(AI를 못 물어서 벡터로 채웠다 · S-a). 머리줄만 달라진다.
  const [aiFrom, setAiFrom] = useState('ai');
  const searchToken = useRef(0);

  // 검색 자리를 비우고 q를 지금 검색어로 세운다 — 열쇠를 갈아서 돌고 있던 훑기·AI 답은 버려진다.
  // 새 검색(runSearch) · 검색 접기(clearSearch) · 다른 자리로 옮기기(goto)가 모두 이 한 벌을 거친다.
  const resetSearch = (q = '') => {
    const token = ++searchToken.current;
    setQuery(q);
    setFromSearch(false);
    setResults([]); setProgress(null);
    setAiHits([]); setAiWait(false);
    return token;
  };
  // 검색을 접는다 — 칸의 글자까지 비운다
  const clearSearch = () => { resetSearch(); setTyped(''); };

  // 낱말 그대로 찾기 — **받는 것만 겹친다**(forEachPool). 훑기는 목록 순서 그대로라
  // 결과 줄이 정경 순이다. 한 권이 끝날 때마다 결과·진행을 그린다. 66권을 끝까지 훑는다(RESULT_PAGE).
  // **띄어쓰기는 지우고 견준다**(services/word.js compactText) — '사랑 하는'을 '사랑하는'으로 쳐도 걸린다.
  const runKeyword = async (q, token) => {
    setResults([]); setShown(RESULT_PAGE); setProgress({ done: 0, total: books.length });
    const needle = compactText(q);
    const out = [];
    await forEachPool(books, POOL, b => loadBook(b.id), async (data, b, i) => {
      if (token !== searchToken.current) return false;
      if (data) {
        const packed = packedOf(data);
        for (let c = 0; c < data.chapters.length; c++) {
          const verses = data.chapters[c];
          for (let v = 0; v < verses.length; v++) {
            if (!packed[c][v].includes(needle)) continue;
            out.push({ bookId: b.id, name: b.name, chapter: c + 1, verse: v + 1, text: verses[v] });
          }
        }
      }
      setResults(out.slice());
      setProgress({ done: i + 1, total: books.length });
      await new Promise(r => setTimeout(r, 0));   // 진행이 화면에 그려질 틈
      return true;
    });
    if (token === searchToken.current) setProgress(p => (p ? { ...p, done: books.length } : null));
  };

  // 뜻으로 찾기 — 제미나이가 고른 구절을 우리 본문으로 확인해서 돌려준다
  // (services/bibleSearch.js). **실패는 조용하다** — 그 도막을 감출 뿐이다.
  //
  // **AI를 못 물었으면(실패·시간 초과) 그 자리에 벡터 결과를 같은 줄 모양으로 세운다**(사용자 결정 S-a
  // 2026-09-25). 평소 화면은 그대로다 — 비교에서 AI가 이겼으므로(HANDOFF §7) AI가 답한 자리에는 벡터를
  // 섞지 않고, 지금까지 아무것도 안 뜨던 자리만 채운다. 머리줄은 '{검색어}와/과 관련된 성경 구절'.
  // 벡터도 실패하면 예전처럼 도막째 감춘다. 게스트에서는 둘 다 묻지 않는다(aiEnabled · semanticOn).
  const runAi = async (q, token) => {
    if (!aiEnabled()) return;          // 게스트 모드에서는 묻지도 않는다(빈 자리도 안 뜬다)
    setAiWait(true); setAiFrom('ai');
    let out = { hits: [], failed: false };
    // 다섯째 인자가 **사람들 사이에 공유되는 캐시**다(0057) — 남이 같은 말로 이미
    // 물어봤으면 AI를 부르지 않는다(사용자 요청 2026-09-09).
    try { out = await aiBibleSearchOutcome(q, books, loadBook, AiService.callGemini, bibleSearchStore); }
    catch { out = { hits: [], failed: true }; }
    if (token !== searchToken.current) return;
    if (!out.failed || !semanticOn()) { setAiHits(out.hits); setAiWait(false); return; }
    let vec = [];
    try { vec = bibleVecHits(await matchBible(q), books); }
    catch (e) { console.warn('[word] 관련된 성경 구절을 받지 못했어요:', e); }
    if (token !== searchToken.current) return;
    setAiFrom('vec'); setAiHits(vec); setAiWait(false);
  };

  // recentAs: 최근 검색어에 남길 글자(칩 — AI 물음 대신 칩 글자 그대로 · 목업 5번). 없으면 검색어 그대로.
  const run = (raw, recentAs = '') => {
    const q = raw.trim();
    const token = resetSearch(q);
    if (!q) return;
    // 최근 검색어는 **여기 한 자리**에서만 쌓인다(0065) — 검색이 실제로 시작되는 곳이다.
    // 글자를 칠 때(setTyped) 남기면 '사'·'사사'·'사사기'가 세 줄이 된다.
    if (stateArrived.current) update({ ...state, recentSearches: pushRecentSearch(state.recentSearches, recentAs || q) });
    // 둘을 **같이** 띄운다 — AI 답을 기다리느라 낱말 결과가 늦으면 안 된다
    runKeyword(q, token);
    runAi(q, token);
  };

  return {
    query, typed, setTyped, results, shown, setShown, fromSearch, setFromSearch,
    progress, aiHits, aiWait, aiFrom, run, clearSearch,
  };
}

// ── 최근 검색어 판 · 마음 칩 차례 ───────────────────────────────────────────
// 최근 검색어 줄은 **검색어를 비운 채 칸에 들어왔을 때** 선다(0065). rowRef: 칸 + 글자 크기 줄(마음 칩이
// 있으면 판이 이 폭을 쓴다) · formRef: 검색 칸 · panelRef: 판.
function useRecentPanel({ typed, recent, moodsOn, rowRef, formRef, panelRef }) {
  const [focused, setFocused] = useState(false);
  // 최근 검색어 판이 서는 조건 — **검색 칸 안 안내 문구의 회전도 이 값이 멈춘다**(BibleTab의
  // SearchHint). 두 자리가 같은 값을 봐야 판이 열린 순간과 문구가 멎는 순간이 어긋나지 않는다.
  // **칩이 있으면 최근 검색어가 없어도 판이 뜬다**(목업 5번). 게스트(AI 없음)에는 칩이 없다 — 낱말 검색으로
  // '지칠 때'를 찾으면 0건이라 없는 것을 약속하는 자리가 된다(searchHints와 같은 근거).
  const recentOpen = focused && !typed && (recent.length > 0 || moodsOn);
  // 칩 차례 — 판이 **열리는 순간** 한 번 정한다(1분 안이면 기억한 차례, 지났으면 새로 섞고 방금 본 칩은 뒤로).
  // 닫히는 순간 그때 보였던 칩과 시각을 적는다(services/moodPick.js). 렌더 중에 정해야 칩이 첫 그림부터 맞다.
  const wasOpen = useRef(false);
  const moodOrderRef = useRef(null);
  const moodShown = useRef([]);
  if (moodsOn && recentOpen !== wasOpen.current) {
    if (recentOpen) {
      const memo = readMoodMemo();
      moodOrderRef.current = orderOnOpen(memo, MOODS.length);
      writeMoodMemo({ order: moodOrderRef.current, shownAt: memo?.shownAt || 0, last: memo?.last || [] });
    } else if (moodOrderRef.current) {
      writeMoodMemo({ order: moodOrderRef.current, shownAt: Date.now(), last: moodShown.current });
    }
    wasOpen.current = recentOpen;
  }
  // 최근 검색어 판은 **body 포털**이다(HANDOFF §8 '떠 있는 것') — 폭은 검색 칸에서 잰다.
  // 바깥 누름으로 닫는 훅이 없다: 칸의 blur가 닫고, 판의 mousedown preventDefault가 포커스를
  // 지켜서 포털이어도 판 안을 누르는 동안은 열려 있다.
  // 키보드가 올라와 칸 아래가 짧으면 **판을 그 자리에 맞게 줄인다**(fitHeight · 2026-09-25) — 전에는
  // 가두기가 288px 판을 칸 위로 끌어올려 검색 칸을 덮었다(375×667 · 키보드 300px).
  // 마음 칩이 있으면(AI 있는 판) 판은 **검색 줄 전체 폭**이다(목업 5번 — 폰 375에서 칸 폭만 쓰면 칩이 두 개밖에 안 든다).
  // 칩이 없는 판(게스트)은 예전처럼 칸 폭이다.
  const [recentPos, placeRecent] = useAnchoredPos(moodsOn ? rowRef : formRef, recentOpen, 320, RECENT_MAX_H, 8, panelRef,
    { matchWidth: true, align: 'start', fitHeight: true });
  // 한 줄을 지우면 판이 줄어든다 — 위로 뒤집혀 선 판이 칸에서 떨어져 뜨지 않게 다시 잰다
  useLayoutEffect(() => { if (recentOpen) placeRecent(); }, [recentOpen, recent.length, placeRecent]);
  return { setFocused, recentOpen, recentPos, moodOrder: moodOrderRef.current, onMoodFit: (f) => { moodShown.current = f; } };
}

// ── 이번 주 이 장을 본 사람(0080) — 장을 열 때 **한 번** 읽는다(실시간 없음) ─────────────
// 이름·사진은 멤버 목록이 원본이다(나눔 칩과 같다). 게스트의 심어 둔 줄은 이름을 들고 온다.
// '나눔 보기'는 이번 주 읽기표에서 이 장에 걸친 날 → 그 날 공유해 둔 묵상이 있는 사람만.
// loaded: 지금 장의 본문이 도착했나 — 그때부터 5초를 센다(아래).
function useChapterReaders({ place, placeKey, books, loaded }) {
  const members = useStore(selectMembers);
  const [readers, setReaders] = useState(null);   // { key, rows, shared: { [profile_id]: 날짜 } }
  useEffect(() => {
    if (!place || !books.length) return undefined;
    let alive = true;
    const key = placeKey;
    const today = kstToday();
    (async () => {
      const rows = await fetchChapterReaders(key, weekStartOf(today));
      const me = myUidSync() || '';
      const ids = [...new Set(rows.map(r => r.profile_id))].filter(id => id && id !== me);
      let shared = {};
      if (ids.length) {
        const [ws, we] = weekRange(today);
        const sch = await fetchScheduleRange(ws, we).catch(() => []);
        const dates = qtDatesCovering(sch, place.bookId, place.chapter, ref => parseRef(ref, books));
        const on = await fetchSharedOn(dates, ids).catch(() => []);
        for (const r of on) if (!shared[r.profile_id] || r.qt_date > shared[r.profile_id]) shared[r.profile_id] = r.qt_date;
      }
      if (alive) setReaders({ key, rows, shared });
    })().catch(e => { console.warn('[word] 이 장을 본 사람을 읽지 못했어요:', e); if (alive) setReaders(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, books]);
  const view = useMemo(() => {
    if (!readers || readers.key !== placeKey) return readersView([], '');
    const byId = new Map((members || []).map(m => [m.id, m]));
    return readersView(readers.rows.map(r => {
      const m = byId.get(r.profile_id);
      return { profile_id: r.profile_id, name: m?.name || r.name || '', avatarUrl: m?.avatarUrl || r.avatarUrl || '' };
    }), myUidSync() || '');
  }, [readers, placeKey, members]);

  // 장을 **5초 넘게** 펼쳐 두면 이번 주 이 장에 내 줄 하나(나도 나누기가 켜져 있을 때만).
  // 목차에서 훑고 지나간 장은 적히지 않는다 — 장을 옮기면 타이머가 풀린다.
  useEffect(() => {
    if (!loaded || !placeKey) return undefined;
    const key = placeKey;
    const t = setTimeout(async () => {
      try {
        if (!(await loadReadShare())) return;
        await markChapterRead(key, weekStartOf(kstToday()));
      } catch (e) { console.warn('[word] 이 장을 본 기록을 남기지 못했어요:', e); }
    }, READ_DWELL_MS + 100);
    return () => clearTimeout(t);
  }, [loaded, placeKey]);
  return { view, shared: readers?.shared };
}

// ── 쓸어서 넘기기 ───────────────────────────────────────────────────────────
// 모바일은 **쓸어서** 넘긴다(사용자 피드백 2026-09-03 — 화살표가 맨 아래라 스크롤을 다
// 내려야 넘길 수 있었다). 가로 이동이 60px을 넘고 세로보다 커야 장이 바뀐다 — 읽다가
// 위아래로 훑는 손짓과 갈라야 한다. 쓸고 난 뒤의 click은 절 선택으로 세지 않는다
// (터치 기기는 손을 떼는 자리에 click을 한 번 더 보낸다 — justSwiped).
// onSwipe(1 | -1): 다음 장 · 이전 장
function useSwipe(onSwipe) {
  const touchAt = useRef(null);
  const swipedAt = useRef(0);   // 마지막 스와이프 시각(onTouchEnd가 적는다)
  const onTouchStart = (e) => {
    const t = e.touches && e.touches[0];
    touchAt.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e) => {
    const from = touchAt.current;
    touchAt.current = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!from || !t) return;
    const dx = t.clientX - from.x, dy = t.clientY - from.y;
    if (Math.abs(dx) > 10) swipedAt.current = Date.now();
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return;   // 세로로 더 움직였으면 스크롤이다
    onSwipe(dx < 0 ? 1 : -1);
  };
  const justSwiped = () => Date.now() - swipedAt.current < 400;
  return { onTouchStart, onTouchEnd, justSwiped };
}

// ── 성경 읽기 탭 ────────────────────────────────────────────────────────────
export function BibleTab({ initialRef = '', onOpenShare }) {
  const [books, setBooks] = useState([]);
  // **캐시가 있으면 그 값으로 시작한다**(사용자 요청 2026-09-03 — "매번 스켈레톤이 아니라
  // 캐시된 값이 먼저"). 이어읽기·북마크·형광펜은 이 화면이 직접 고치기도 해서
  // useCached(읽기 전용 훅)가 아니라 readCache/writeCache 한 쌍을 쓴다 — 고친 값을
  // 그 자리에서 캐시에 얹어야 다음 진입이 최신이다(useStateBox의 update).
  const { state, adopt, update } = useStateBox();
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState(null);   // 책 목록을 못 받았을 때의 이유

  const [pane, setPane] = useState('toc');       // 'toc' | 'bookmark' | 'highlight'
  const [place, setPlace] = useState(null);      // { bookId, chapter } — 없으면 목차
  const [pickedBook, setPickedBook] = useState(null);  // 목차에서 고른 책(장 그리드)
  const [focus, setFocus] = useState(null);      // 검색 결과·형광펜 목록에서 들어온 절
  const [dir, setDir] = useState(0);             // 화면이 바뀌는 방향(이전/다음 장)

  const [chap, setChap] = useState(null);        // { key, verses } — 지금 장의 절 배열
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const searchFormRef = useRef(null);
  const searchRowRef = useRef(null);   // 칸 + 글자 크기 줄 — 마음 칩이 있으면 판이 이 폭을 쓴다
  const recentRef = useRef(null);
  // **bible_state가 도착한 뒤에만 검색어를 남긴다.** 검색 칸은 첫 진입 순간부터 눌리는데,
  // 아직 안 읽어 온 상태로 update를 부르면 빈 북마크·형광펜이 그대로 서버에 덮인다
  // (북마크·형광펜 버튼은 장을 펼쳐야 눌려서 이 위험이 검색 칸에만 있다). 그 짧은 사이에
  // 친 말은 목록에 안 남을 뿐이고, 검색 자체는 그대로 돈다.
  const stateArrived = useRef(false);
  const search = useBibleSearch({ books, state, update, stateArrived });
  const {
    query, typed, setTyped, results, shown, setShown, fromSearch, setFromSearch,
    progress, aiHits, aiWait, aiFrom, clearSearch,
  } = search;

  // **장을 넘길 때 자리를 붙잡는다**(사용자 피드백 2026-09-03 — 본문이 비었다가 채워지며
  // 높이가 튀고 스크롤이 점프했다). QT가 하는 것과 같은 방식이다(wordView 머리말):
  // 넘기기 직전 카드 높이를 재어 두고, 기다리는 동안 그 높이만큼 스켈레톤을 세운다.
  // 스크롤은 **새 장이 도착한 뒤 한 번만** 본문 카드 위로 올린다 — 넘기는 순간에 옮기면
  // 아직 옛 장 높이라 두 번 움직인다.
  const cardRef = useRef(null);
  const headRef = useRef(null);
  const [holdH, setHoldH] = useState(0);
  const scrollWanted = useRef(false);

  // 넘긴 뒤에는 **장 제목 줄**로 올라간다(사용자 피드백 2026-09-03 — 1절이 아니라 그 줄이
  // 기준이다). `scrollIntoView({block:'start'})`만 쓰면 화면 위에 붙어 있는 내비 밑으로
  // 들어가 제목이 가려지므로, 스크롤 통을 찾아 그만큼 여유를 두고 올린다.
  const scrollToHead = () => {
    const el = headRef.current;
    if (!el) return;
    let box = el.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight + 8) break;
      box = box.parentElement;
    }
    const page = document.scrollingElement || document.documentElement;
    const scroller = box && box !== document.body ? box : page;
    const isPage = scroller === page;
    // 페이지가 스크롤되는 폭에서는 상단 내비가 화면에 붙어 있다(≈52px) — 그만큼 비운다.
    // 안쪽 통이 스크롤되는 폭에서는 그 통이 이미 내비 아래에서 시작하므로 조금만 띄운다.
    const pad = isPage ? 64 : 8;
    const base = isPage ? 0 : scroller.getBoundingClientRect().top;
    const top = scroller.scrollTop + el.getBoundingClientRect().top - base - pad;
    // **즉시 옮긴다**(사용자 피드백 2026-09-03 — "스르륵 올라가는 게 어색하다").
    // 장이 바뀌는 결은 Swap의 슬라이드가 내고, 스크롤은 그 프레임에 한 번 끝난다.
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  };

  const bookOf = useCallback((id) => books.find(b => b.id === id) || null, [books]);

  // 첫 진입 — 책 목록 · 내 상태(이어읽기·북마크·형광펜) · 글자 크기
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, saved] = await Promise.all([loadBibleIndex(), loadBibleState()]);
      if (!alive) return;
      setBooks(list);
      // 기다리는 동안 칠한 형광펜·북마크는 덮지 않는다(useStateBox의 edited가 본다).
      // 이어읽기 자리(saved.lastRef)는 그래도 쓴다 — 아래는 '어느 장을 펼까'라 다른 값이다.
      adopt(saved);
      stateArrived.current = true;
      setStep(loadFontStep());
      // 주보·QT에서 넘어온 구절이 먼저다. 없으면 마지막으로 읽던 자리로 이어간다.
      const fromRef = initialRef ? parseRef(initialRef, list) : null;
      const last = fromRef
        ? { bookId: fromRef.bookId, chapter: fromRef.start.chapter }
        : parseChapterKey(saved.lastRef);
      if (last && list.some(b => b.id === last.bookId)) setPlace(last);
      setReady(true);
    })().catch(err => {
      // 예전에는 조용히 빈 목록으로 떨어져 '구약 0권 · 신약 0권'이 떴다 — 화면이
      // 거짓말을 하지 않게 이유를 들고 있는다(사용자 피드백 2026-09-03).
      console.error('[word] 성경 목차 읽기 실패:', err);
      setLoadErr(err || true); setReady(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRef]);

  // **책 목록이 오면 남은 책을 조용히 받아 둔다**(services/bible.js warmBooks).
  // 리더에 들어온 사람은 곧 검색하거나 다른 장으로 넘어가는데, 그때마다 왕복을
  // 기다렸다. 2초 뒤에 시작하므로 지금 장을 여는 요청과 겹치지 않고, 데이터 아끼기를
  // 켠 기기에서는 아예 하지 않는다. 화면을 떠나면 예약은 취소된다.
  useEffect(() => (books.length ? warmBooks(books) : undefined), [books]);

  // 지금 장의 본문. **어느 장의 것인지 같이 들고 있는다** — 장을 넘긴 직후 한 프레임
  // 동안 앞 장의 절이 새 제목 밑에 남아 있었다.
  useEffect(() => {
    if (!place) { setChap(null); return undefined; }
    const key = chapterKey(place.bookId, place.chapter);
    let alive = true;
    loadBook(place.bookId)
      .then(data => { if (alive) setChap({ key, verses: data.chapters[place.chapter - 1] || [] }); })
      // **못 받았으면 못 받았다고 말한다**(사용자 피드백 2026-09-03 — 예외 문구 검토).
      // 예전에는 빈 절 배열로 떨어져서 카드 안이 통째로 비었고, 화면은 아무 말도 안 했다.
      .catch(err => { if (alive) setChap({ key, verses: [], failed: err || true }); });
    return () => { alive = false; };
  }, [place]);

  const here = place ? bookOf(place.bookId) : null;
  const placeKey = place ? chapterKey(place.bookId, place.chapter) : '';
  const loaded = !!place && chap?.key === placeKey;

  const readers = useChapterReaders({ place, placeKey, books, loaded });

  // 검색·형광펜 목록에서 들어온 절로 데려간다
  useEffect(() => {
    if (!focus || !loaded) return;
    const el = bodyRef.current?.querySelector('[data-focus="1"]');
    el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [focus, loaded]);

  // **강조는 3초 뒤에 꺼진다**(사용자 요청 2026-09-08). 데려다주는 것이 목적이고,
  // 그 뒤로도 테두리가 남아 있으면 그 절만 다른 글처럼 읽힌다. 새 절로 들어오면
  // 타이머가 다시 시작하고, 화면을 떠나면 정리된다(PassageText가 전이로 뺀다).
  useEffect(() => {
    if (!focus || !loaded) return undefined;
    const t = setTimeout(() => setFocus(null), FOCUS_MS);
    return () => clearTimeout(t);
  }, [focus, loaded]);

  // 장을 넘겨서 온 경우에만, **새 장이 도착한 그때 한 번** 본문 카드 위로 올린다
  useEffect(() => {
    if (!loaded || !scrollWanted.current) return;
    scrollWanted.current = false;
    scrollToHead();
  }, [loaded, placeKey]);

  // 기다리는 동안 세울 스켈레톤 줄 수 — 붙잡아 둔 높이를 채운다(한 줄 ≈ 34px)
  const holdLines = holdH ? Math.max(8, Math.round((holdH - 44) / 34)) : 10;

  // 형광펜 범위 고르기·칠하기 — 도구 줄까지 훅이 만든다(useVersePaint 머리말).
  // ref는 '책 장:절'(services/word.js verseKey — bible_state.highlights의 모양).
  const paint = useVersePaint({
    state, update, name: here?.name,
    refOf: (chapter, verse) => verseKey(place.bookId, chapter, verse),
    guard: () => swipe.justSwiped(),   // 방금 쓸었다면 그건 넘기려던 손이다
  });
  // keepSearch: 검색 결과를 들고 간다(결과에서 절을 열 때 · 결과에서 연 장을 넘길 때). 그 밖의 길
  // (목차·북마크·형광펜)은 예전처럼 검색을 접는다.
  const goto = (bookId, chapter, at = null, delta = 0, keepSearch = false) => {
    setDir(delta);
    setPane('toc');          // 북마크·형광펜 줄에서 왔어도 이제 보는 것은 본문이다
    setPlace({ bookId, chapter });
    setFocus(at);
    paint.clear();      // 자리를 옮기면 고른 절이 사라진다 — 선택도 같이 내린다
    if (keepSearch) setFromSearch(true);
    else clearSearch();
    update({ ...state, lastRef: chapterKey(bookId, chapter) });
  };

  // 장을 옮긴다. 책의 끝을 넘으면 다음 책 1장으로 이어진다(성경은 한 권이다).
  // **넘긴 뒤에는 본문 맨 위로 돌아온다**(사용자 피드백 2026-09-03 — 아래쪽에서 넘기면
  // 새 장의 중간부터 보였다). 검색·형광펜에서 절을 물고 들어오는 goto와 달리 여기는
  // 언제나 첫 절부터 읽는 자리다.
  const move = (delta) => {
    if (!place) return;
    const idx = books.findIndex(b => b.id === place.bookId);
    const at = books[idx];
    const next = place.chapter + delta;
    const nb = books[idx + delta];
    if (next >= 1 && next <= at.chapters) goto(place.bookId, next, null, delta, fromSearch);
    else if (nb) goto(nb.id, delta > 0 ? 1 : nb.chapters, null, delta, fromSearch);
    else return;
    setHoldH(cardRef.current?.offsetHeight || 0);
    scrollWanted.current = true;
  };

  // 성경의 처음(창세기 1장)·끝(요한계시록 마지막 장)에서는 그쪽 화살표를 세우지 않는다
  const bookIdx = place ? books.findIndex(b => b.id === place.bookId) : -1;
  const canPrev = !!place && bookIdx >= 0 && !(bookIdx === 0 && place.chapter === 1);
  const canNext = !!place && bookIdx >= 0
    && !(bookIdx === books.length - 1 && place.chapter === (books[bookIdx]?.chapters || 1));
  const swipe = useSwipe((d) => { if (d > 0 ? canNext : canPrev) move(d); });

  // 검색을 시작한다 — 결과는 본문 열의 자리에 그린다
  const runSearch = (raw, recentAs = '') => {
    setPane('toc');
    setFocus(null);
    setDir(0);
    search.run(raw, recentAs);
  };

  // 최근 검색어 한 줄을 누르면 **지금 검색을 시작하는 그 길** 그대로다(runSearch).
  // 칸의 글자도 같이 채운다 — 폼으로 냈을 때와 화면이 같아야 한다. 칸에서 손을 떼면
  // 목록이 닫히고(focused) 폰에서는 키보드도 내려간다.
  const pickRecent = (q) => { setTyped(q); inputRef.current?.blur(); runSearch(q); };
  // "이런 마음일 때" 칩 — 같은 길(runSearch)로 **한 틀의 물음**('{칩} 읽을 성경 말씀')을 검색한다.
  // 칸에는 칩 글자가 서고 최근 검색어에도 칩 글자가 남는다.
  const pickMood = (label) => { setTyped(label); inputRef.current?.blur(); runSearch(moodAsk(label), label); };
  const dropRecent = (q) => update(
    { ...state, recentSearches: removeRecentSearch(state.recentSearches, q) },
    '최근 검색어를 지우지 못했어요',
  );
  const recent = state.recentSearches || [];

  const verses = useMemo(() => (loaded ? chap.verses : []).map((text, i) => ({
    chapter: place?.chapter || 1, verse: i + 1, text,
  })), [chap, loaded, place]);
  const marked = place && state.bookmarks.some(b => b.ref === placeKey);

  const toggleBookmark = () => {
    if (!place || !here) return;
    const bookmarks = marked
      ? state.bookmarks.filter(b => b.ref !== placeKey)
      : [...state.bookmarks, { ref: placeKey, label: `${here.name} ${place.chapter}장`, at: new Date().toISOString() }];
    update({ ...state, bookmarks },
      marked ? `${here.name} ${place.chapter}장을 북마크에서 빼지 못했어요` : `${here.name} ${place.chapter}장을 북마크에 넣지 못했어요`);
  };

  // 이 책에 켜진 형광펜 — PassageText는 '장:절' → 색 Map으로 본다
  const marks = useMemo(() => (place ? marksFor(state.highlights, `${place.bookId} `) : null), [state.highlights, place]);

  const searching = !!progress && progress.done < progress.total;

  // AI를 부를 수 있는 자리인지는 한 세션 안에서 바뀌지 않는다(!!supabase)
  const hints = useMemo(() => searchHints(aiEnabled()), []);
  const moodsOn = hints.length > 1;   // = aiEnabled() — 한 세션 안에서 바뀌지 않는다
  const { setFocused, recentOpen, recentPos, moodOrder, onMoodFit } = useRecentPanel({
    typed, recent, moodsOn, rowRef: searchRowRef, formRef: searchFormRef, panelRef: recentRef,
  });

  // 북마크·형광펜 — 책으로 묶어 정경 순으로. 파싱이 안 되는 옛 값은 그룹에 못 들어가므로
  // 개수는 실제로 그린 줄로 센다
  const bookGroups = useMemo(() => groupByBook(state.bookmarks || [], books, parseChapterKey), [state.bookmarks, books]);
  // 형광펜만 범위를 한 줄로 묶는다(mergeRuns) — 총 개수는 묶기 전 절 수(count)로 센다
  const litGroups = useMemo(() => groupByBook(state.highlights || [], books, parseVerseKey, true), [state.highlights, books]);
  const bookTotal = bookGroups.reduce((n, g) => n + g.count, 0);
  const litTotal = litGroups.reduce((n, g) => n + g.count, 0);

  const pickPane = (key) => {
    if (key === pane) return;
    setDir(paneIndex(key) > paneIndex(pane) ? 1 : -1);
    setPane(key);
  };

  // 화면이 바뀌는 단위 — 이 값이 달라지면 Swap이 새로 들여보낸다
  // 결과에서 절을 연 동안(fromSearch)은 검색어가 살아 있어도 본문이 선다
  const showResults = !!query && !(fromSearch && place);
  const viewKey = pane !== 'toc' ? `m:${pane}`
    : showResults ? `q:${query}` : place ? `p:${placeKey}` : pickedBook ? `b:${pickedBook}` : 'toc';

  return (
    <div className="min-w-0">
      {/* 검색 · 글자 크기 — 목차에서도 리더에서도 같은 자리 */}
      <div ref={searchRowRef} data-col="searchbar" className="flex items-center gap-2 pb-2.5">
        <form ref={searchFormRef}
          /* 손가락 기기에서는 낸 뒤 **키보드를 내린다**(2026-09-25) — 최근 검색어를 누를 때(pickRecent)는
             내려가는데 키보드의 '검색'으로 내면 그대로 남아 결과 절반을 가렸다. 마우스에서는 칸에 남는다
             (이어서 고쳐 치는 자리다). */
          onSubmit={e => { e.preventDefault(); runSearch(typed); if (coarsePointer()) inputRef.current?.blur(); }}
          /* 포커스 테두리는 **칸 상자(form)** 에 선다(2026-09-25). 앱 전역의 `*:focus-visible`(index.css ·
             레이어 밖이라 `outline-none` 유틸을 이긴다)이 안쪽 input에 걸려, 둥근 칸 안에 네모 테두리가
             아이콘에 붙어 떴다. 같은 테두리(accent 2px · 2px 띄움)를 상자로 옮기고 input은 끈다. */
          className="relative flex-1 min-w-0 flex items-center gap-1.5 px-2.5 h-9 rounded-md has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}
        >
          <Search size={14} className="shrink-0 text-fg-faint" />
          <input
            ref={inputRef} enterKeyHint="search"
            value={typed} onChange={e => setTyped(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            /* 속성은 첫 줄로 고정하고 보이는 글자는 SearchHint가 돌린다(layout.jsx와 한 벌) */
            placeholder={BIBLE_HINTS[0]} aria-label={BIBLE_HINTS[0]}
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-fg placeholder:text-transparent outline-none!"
          />
          {/* 왼쪽 여백은 아이콘 폭 그대로 — 패딩 10px + 아이콘 14px + 사이 6px */}
          {/* 최근 검색어 판이 떠 있는 동안에는 **첫 줄에 고정**한다(사용자 결정 2026-09-14).
              읽으려는 목록 바로 위에서 글자가 2초마다 갈아타면 어지럽다. 칸이 무엇을 적는
              자리인지는 첫 줄 하나로 여전히 말한다. */}
          <SearchHint show={!typed && !query} left="1.875rem" size="text-[12.5px]"
            hints={recentOpen ? hints.slice(0, 1) : hints} />
          {(typed || query) && (
            /* 누르는 자리는 21px이라 폰에서 잘 빗나갔다 — 칸 높이 안(위아래 7px)과 글자 크기 단추까지
               틈의 절반(오른쪽 7px)만큼 넓힌다(HANDOFF §8 · PITFALLS 9-by · 2026-09-25) */
            <button type="button" onClick={clearSearch} aria-label="검색어 지우기"
              className="relative before:absolute before:-inset-y-[7px] before:-left-1 before:-right-[7px] shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors">
              <X size={13} />
            </button>
          )}

          {/* 최근 검색어 (0065) — 칸을 비운 채 들어왔을 때만 선다. 모양은 메인 검색창의
              결과 판과 같은 한 벌이다(layout.jsx SearchBox).
              **onMouseDown의 preventDefault가 이 판을 쓸 수 있게 만든다** — 없으면 칸이
              먼저 포커스를 잃어 판이 사라지고 클릭이 허공에 떨어진다(누르는 순간 사라지는
              목록이 된다). 터치에서도 브라우저가 click 앞에 mousedown을 보내므로 같다. */}
          {recentOpen && createPortal(
            <div
              ref={recentRef} data-recent="" onMouseDown={e => e.preventDefault()}
              style={{ position: 'fixed', left: recentPos.left, top: recentPos.top, width: recentPos.width,
                maxHeight: Math.min(RECENT_MAX_H, recentPos.maxHeight ?? RECENT_MAX_H) }}
              className="z-[90] overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1.5 transition-none animate-in fade-in zoom-in-95 duration-150"
            >
              {moodsOn && <MoodChips order={moodOrder} width={recentPos.width} onPick={pickMood} onFit={onMoodFit} />}
              {moodsOn && recent.length > 0 && <hr className="border-0 h-px bg-line mx-1.5 mb-1.5" />}
              {recent.length > 0 && <p className="px-2 pt-0.5 pb-1 text-[11px] font-bold text-fg-muted">최근 검색어</p>}
              {recent.map(r => (
                <span key={r.q} className="flex items-center gap-0.5">
                  <button type="button" data-recent-q={r.q} onClick={() => pickRecent(r.q)}
                    className="flex-1 min-w-0 truncate text-left px-2 py-1.5 rounded-md text-[12.5px] text-fg hover:bg-surface-hover transition-colors">
                    {r.q}
                  </button>
                  <button type="button" data-recent-drop="" onClick={() => dropRecent(r.q)}
                    aria-label={`최근 검색어에서 ${r.q} 지우기`}
                    className="relative before:absolute before:-inset-y-[3px] before:-left-px before:-right-1.5 shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>, document.body)}
        </form>
        <FontSteps step={step} onChange={n => { setStep(n); saveFontStep(n); }} />
      </div>

      {/* 목차 · 북마크 · 형광펜 — 어느 폭에서도, 본문을 읽는 중에도 늘 여기 있다 */}
      <div className="flex items-center gap-2 pb-3.5">
        <span className="flex p-[3px] rounded-md shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {PANES.map(([key, label]) => (
            <button
              key={key} data-pane={key} onClick={() => pickPane(key)} aria-pressed={pane === key}
              className="px-3 py-[6px] rounded-sm text-[12px] font-semibold transition-colors"
              style={{
                background: pane === key ? 'var(--app-surface)' : 'transparent',
                color: pane === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}
            >{label}</button>
          ))}
        </span>
      </div>

      <Swap k={viewKey} dir={dir} className="min-w-0">
        {pane === 'bookmark' ? (
          <MarkSection
            title="북마크" unit="장" kind="bookmark" groups={bookGroups} total={bookTotal}
            empty="북마크한 장을 여기서 볼 수 있어요"
            onOpenItem={at => goto(at.bookId, at.chapter)}
            onRemoveItem={refs => update({ ...state, bookmarks: state.bookmarks.filter(b => !refs.includes(b.ref)) },
              '북마크를 지우지 못했어요')}
          />
        ) : pane === 'highlight' ? (
          <MarkSection
            title="형광펜" unit="절" kind="highlight" groups={litGroups} total={litTotal}
            empty="형광펜을 칠한 절은 여기서 볼 수 있어요"
            onOpenItem={at => goto(at.bookId, at.chapter, { chapter: at.chapter, verse: at.verse })}
            onRemoveItem={refs => update({ ...state, highlights: (state.highlights || []).filter(h => !refs.includes(h?.ref)) },
              '형광펜을 지우지 못했어요')}
          />
        ) : showResults ? (
          <SearchResults
            query={query} results={results} progress={progress} searching={searching}
            aiHits={aiHits} aiWait={aiWait} aiFrom={aiFrom} step={step}
            shown={shown} onMore={() => setShown(n => n + RESULT_PAGE)}
            onOpen={r => goto(r.bookId, r.chapter, { chapter: r.chapter, verse: r.verse }, 0, true)}
          />
        ) : place ? (
          <div ref={bodyRef} data-col="read" className="min-w-0">
            {/* 좁은 폭에서도 셋이 한 줄에 그대로 선다 — 제목만 줄어들고(min-w-0 truncate)
                양쪽 버튼은 shrink-0에 44px 터치 타깃이다(사용자 피드백 2026-09-02 4차) */}
            <div ref={headRef} data-chap-head="" className="flex items-center gap-1.5 pb-3">
              {/* 되돌아가기는 **목차**다(사용자 결정 2026-09-05 — 세그먼트가 '본문'이 되면서
                  '목차'가 비었다). 장 그리드의 되돌아가는 버튼도 같은 이름이라 한 벌이다.
                  **검색 결과에서 연 절이면 '결과'다**(2026-09-25) — 누르면 들고 있던 결과가 그대로
                  선다(다시 훑지 않는다). 글자는 '목차'와 같은 결의 두 글자로 둔다. */}
              <button data-back={fromSearch ? 'results' : 'toc'}
                onClick={() => { setDir(-1); if (fromSearch) { setFromSearch(false); return; } setPlace(null); setPickedBook(null); }}
                className={`${btn} shrink-0 pl-2 pr-3 h-11 text-fg-muted hover:bg-surface-hover`}>
                <ChevronLeft size={15} />{fromSearch ? '결과' : '목차'}
              </button>
              <h3 className="bible-place flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">
                {here?.name} {place.chapter}장
              </h3>
              {readers.view.all.length > 0 && (
                <ChapterReaders key={placeKey} view={readers.view} shared={readers.shared} onOpenShare={onOpenShare} />
              )}
              <button onClick={toggleBookmark} title={marked ? '북마크 지우기' : '북마크에 넣기'}
                aria-label={marked ? '북마크 지우기' : '북마크에 넣기'}
                className={`${btn} shrink-0 w-11 h-11 ${marked ? 'text-accent-text bg-accent-weak' : 'text-fg-muted hover:bg-surface-hover'}`}>
                <Bookmark size={16} fill={marked ? 'currentColor' : 'none'} />
              </button>
            </div>

            {/* **화살표는 본문 옆에서 따라다닌다**(사용자 피드백 2026-09-03 — 데스크톱).
                44px 버튼이 양옆 칸에서 `sticky`로 화면 가운데 높이에 머문다: 스크롤을
                아무리 내려도 눈높이에 있고, 본문 가장자리 밖이라 글자를 가리지 않는다.
                좁은 화면에는 그 칸이 없다 — 거기서는 쓸어서 넘긴다(onTouchEnd).
                모양은 **테두리 없는 옅은 판**이다(사용자 피드백 2026-09-03 — "너무 구식,
                조금 더 세련되게"): bg-surface/80 + shadow-soft에 hover에서만 accent-weak로
                떠오른다. 전이는 opacity·배경색만 건다 — 위치 속성에 transition을 걸면
                sticky가 스크롤마다 미끄러진다(§6-17-b).
                본문과의 간격도 6px 더 벌렸다(gap-1.5 → gap-3). */}
            <div data-chap-swipe="" className="flex items-stretch gap-3"
              onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd}>
              <div className="hidden md:flex w-11 shrink-0 justify-center">
                {canPrev && (
                  <button data-chap-nav="prev" onClick={() => move(-1)} aria-label="이전 장" title="이전 장"
                    className={chapNav} style={{ top: '45dvh' }}>
                    <ChevronLeft size={16} />
                  </button>
                )}
              </div>

              <div ref={cardRef} className="flex-1 min-w-0">
              <Card className="p-4 md:p-5"
                style={{ minHeight: loaded ? undefined : (holdH || undefined) }}>
              {loaded && !verses.length ? (
                <p className="text-[12.5px] text-fg-muted whitespace-pre-line">
                  {chap?.failed
                    ? failText(`${here?.name || ''} ${place.chapter}장의 본문을 불러오지 못했어요`, chap.failed)
                    : '이 장에는 본문이 들어 있지 않아요'}
                </p>
              ) : loaded
                ? <PassageText
                    verses={verses} step={step} focus={focus} marks={marks}
                    onPickVerse={paint.onPickVerse} picked={paint.picked} toolAt={paint.toolAt} tool={paint.tool}
                  />
                : <PassageSkeleton lines={holdLines} step={step} />}
              </Card>
              </div>

              <div className="hidden md:flex w-11 shrink-0 justify-center">
                {canNext && (
                  <button data-chap-nav="next" onClick={() => move(1)} aria-label="다음 장" title="다음 장"
                    className={chapNav} style={{ top: '45dvh' }}>
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* 아래쪽 두 버튼은 그대로 둔다(사용자 결정 2026-09-03) — 끝에서는 누를 것이
                없으므로 그쪽만 꺼 둔다 */}
            <div className="flex items-center gap-2 pt-3.5">
              <button onClick={() => move(-1)} disabled={!canPrev} aria-label="이전 장"
                className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent`}
                style={{ border: '1px solid var(--app-line)' }}>
                <ChevronLeft size={14} />이전 장
              </button>
              <button onClick={() => move(1)} disabled={!canNext} aria-label="다음 장"
                className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent`}
                style={{ border: '1px solid var(--app-line)' }}>
                다음 장<ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          <Toc books={books} ready={ready} failed={loadErr} picked={pickedBook}
            setPicked={id => { setDir(id ? 1 : -1); setPickedBook(id); }} onOpen={goto} />
        )}
      </Swap>
    </div>
  );
}

// ── 목차 (책 목록 → 장 그리드) ──────────────────────────────────────────────
function Toc({ books, ready, failed = null, picked, setPicked, onOpen }) {
  if (!ready) return <TocSkeleton />;
  // 못 받은 것을 '0권'으로 그리지 않는다(사용자 피드백 2026-09-03 — 예외 문구)
  if (!books.length) {
    return (
      <div data-col="toc" className="min-h-[38vh] flex flex-col items-center justify-center text-center">
        <EmptyBookMark />
        <p className="text-[13.5px] font-semibold text-fg mt-3 whitespace-pre-line">
          {failed ? failText('성경 목차를 불러오지 못했어요', failed) : '성경 목차가 아직 준비되지 않았어요'}
        </p>
      </div>
    );
  }

  if (picked) {
    const b = books.find(x => x.id === picked);
    if (!b) return null;
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2 pb-3">
          <button onClick={() => setPicked(null)}
            className={`${btn} shrink-0 pl-1.5 pr-2.5 h-8 text-fg-muted hover:bg-surface-hover`}>
            <ChevronLeft size={14} />목차
          </button>
          <h3 className="flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">{b.name}</h3>
          <span className="shrink-0 text-[11.5px] text-fg-muted tabular-nums">{b.chapters}장</span>
        </div>
        <div className="grid gap-1.5 grid-cols-6 sm:grid-cols-8 lg:grid-cols-10">
          {Array.from({ length: b.chapters }, (_, i) => (
            <button key={i} onClick={() => onOpen(b.id, i + 1, null, 1)}
              className="h-10 rounded-md text-[12.5px] font-semibold text-fg-muted tabular-nums hover:bg-surface-hover transition active:scale-95"
              style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-col="toc" className="min-w-0 flex flex-col gap-6">
      {[['구약', books.slice(0, OT_COUNT)], ['신약', books.slice(OT_COUNT)]].map(([title, list]) => (
        <div key={title}>
          <SectionHead right={<span className="text-[11px] text-fg-muted tabular-nums shrink-0">{list.length}권</span>}>
            {title}
          </SectionHead>
          <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {list.map(b => (
              <button key={b.id} onClick={() => setPicked(b.id)}
                className="px-2 h-10 rounded-md text-[12.5px] font-semibold text-fg truncate hover:bg-surface-hover transition active:scale-95"
                style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 목차가 오기 전 자리 — 구약 39 · 신약 27권 그리드와 같은 모양으로 세워 둔다
function TocSkeleton() {
  return (
    <div className="min-w-0 flex flex-col gap-6" aria-hidden="true">
      {[39, 27].map((n, k) => (
        <div key={k}>
          <div className="flex items-center gap-2 pb-2.5">
            <Skeleton className="h-3.5 w-10 rounded-[4px]" />
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          </div>
          <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 검색 결과 ───────────────────────────────────────────────────────────────
// 두 도막이다(사용자 요청 2026-09-08): 낱말이 그대로 나오는 절과 뜻으로 찾은 구절.
// 위는 66권을 훑은 결과이고 아래는 제미나이가 고른 참조를 우리 본문으로 확인한
// 것이다(services/bibleSearch.js).
//
// **AI 도막은 없으면 통째로 사라진다.** 로그인 전이거나 모델이 못 찾았을 때 "AI가
// 못 찾았어요" 같은 줄을 세우지 않는다 — 쓰는 사람이 할 수 있는 일이 없는 안내다(§8).
// 그리고 두 도막이 다 비었을 때만 빈 자리를 세운다.
const resultHead = 'flex items-center gap-2 pb-2.5';

function ResultHead({ children, count = '' }) {
  return (
    <div className={resultHead}>
      <span className="text-[12.5px] font-bold text-fg truncate min-w-0">{children}</span>
      {!!count && <span className="text-[11.5px] text-fg-muted tabular-nums shrink-0">{count}</span>}
      <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
    </div>
  );
}

// 머리줄에 무엇이 서는지를 한 자리에서 정한다(사용자 피드백 2026-09-09).
// · 낱말 도막의 머리줄이 곧 검색어 줄이다 — 예전에는 검색어 줄 밑에 '본문에 그대로
//   나오는 절'이 한 줄 더 있어서 같은 말을 두 번 했다. 상한(50건)에 걸려도 그냥
//   'N건'이다("앞에서부터"는 훑기가 정경 순이라는 우리 사정이지 읽는 사람의 일이 아니다).
// · **0건이면서 AI가 답을 들고 있으면 낱말 머리줄을 아예 안 세운다** — '감사와 찬양 0건'
//   위에 AI 결과가 붙으면 찾은 것이 없다는 말처럼 읽힌다.
// · AI 도막은 '<검색어>에 대해 AI가 찾은 구절' + 건수. 기다리는 중에는 건수가 없다.
// · AI를 못 물어 벡터로 채운 도막(aiFrom 'vec' · S-a)은 '<검색어>와/과 관련된 성경 구절'이다(받침으로 가른다).
// 순수 함수라 브라우저에서 그대로 불러 검사한다(tests/word.mjs).
export function searchHeads({ query, count = 0, searching = false, progress = null, aiCount = 0, aiWait = false, aiFrom = 'ai' }) {
  const aiShown = aiWait || aiCount > 0;
  const empty = !count && !aiShown && !searching;
  const scan = `${progress?.done ?? 0}/${progress?.total ?? 0}권 훑는 중 · ${count}건`;
  return {
    empty,
    keyword: count > 0 || searching || empty
      ? { title: query, count: searching ? scan : `${count}건` }
      : null,
    ai: aiShown ? {
      title: aiFrom === 'vec' ? `${query}${andParticle(query)} 관련된 성경 구절` : `${query}에 대해 AI가 찾은 구절`,
      count: aiWait ? '' : `${aiCount}건`,
    } : null,
  };
}

// 결과 한 줄 — 낱말 도막과 AI 도막이 같은 모양이다(자리 · 글자 · 누르면 그 절로). data-*는 그대로 단추에 붙는다.
function HitRow({ label, onClick, children, ...data }) {
  return (
    <button onClick={onClick} {...data}
      className="text-left py-2.5 px-2.5 -mx-2.5 rounded-md hover:bg-surface-hover transition-colors">
      <span className="block text-[11.5px] font-bold text-accent-text tabular-nums">{label}</span>
      <span className="block text-[12.5px] leading-relaxed text-fg-secondary mt-0.5">{children}</span>
    </button>
  );
}

function SearchResults({ query, results, progress, searching, aiHits = [], aiWait = false, aiFrom = 'ai', step = 1, shown = RESULT_PAGE, onMore, onOpen }) {
  const heads = searchHeads({
    query, count: results.length, searching, progress, aiCount: aiHits.length, aiWait, aiFrom,
  });
  return (
    <div data-col="search" className="min-w-0">
      {/* 둘 다 비었고 더 기다릴 것도 없을 때에만 빈 자리다 */}
      {heads.empty ? (
        <>
          <ResultHead count={heads.keyword.count}>{heads.keyword.title}</ResultHead>
          <div className="min-h-[38vh] flex flex-col items-center justify-center text-center">
            <EmptyBookMark />
            <p className="text-[13px] font-semibold text-fg mt-3">해당 단어는 찾지 못했어요</p>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-5">
          {heads.keyword && (
            <div data-hits="keyword" className="min-w-0">
              <ResultHead count={heads.keyword.count}>{heads.keyword.title}</ResultHead>
              {results.length ? (
                <div className="flex flex-col">
                  {results.slice(0, shown).map(r => (
                    <HitRow key={`${r.bookId}-${r.chapter}-${r.verse}`} onClick={() => onOpen(r)}
                      data-hit={verseKey(r.bookId, r.chapter, r.verse)} label={`${r.name} ${r.chapter}:${r.verse}`}>
                      {highlight(r.text, query)}
                    </HitRow>
                  ))}
                  {/* 끝에서 이어 편다 — 대시보드 마감 목록의 '더 보기'와 같은 모양(행동이 아니라 펼치기라
                      accent 채움이 아니다 · §8 색 규칙) */}
                  {results.length > shown && (
                    <button type="button" data-more="" onClick={onMore}
                      className="w-full mt-1 py-2 rounded-md text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99]">
                      더 보기
                    </button>
                  )}
                </div>
              ) : <PassageSkeleton lines={5} step={step} />}
            </div>
          )}

          {heads.ai && (
            <div data-hits="ai" data-from={aiFrom} className="min-w-0">
              <ResultHead count={heads.ai.count}>{heads.ai.title}</ResultHead>
              {aiHits.length ? (
                <div className="flex flex-col">
                  {aiHits.map(h => (
                    <HitRow key={`ai-${h.bookId}-${h.chapter}-${h.verse}`} onClick={() => onOpen(h)}
                      data-ai-hit={verseKey(h.bookId, h.chapter, h.verse)} label={hitLabel(h)}>
                      {h.text}
                    </HitRow>
                  ))}
                </div>
              ) : <PassageSkeleton lines={4} step={step} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 찾은 말을 표시한다 — 색은 토큰(tag-yellow)이라 다크에서도 따라온다.
// **한 절에 여러 번 나오면 다 표시한다.** 앞의 하나만 칠하면 뒤의 것은 안 찾은 글자처럼
// 읽힌다(창세기 1:27 '하나님이 자기 형상 곧 하나님의 형상대로'처럼 한 줄에 두 번 오는
// 절이 흔하다). 자리는 services/word.js matchRanges가 **띄어쓰기를 무시하고** 찾아 원문 자리로
// 돌려준다 — 칠하는 글자는 절에 적힌 그대로다('사랑하는'으로 찾으면 '사랑 하는'이 칠해진다).
function highlight(text, q) {
  const str = String(text);
  const ranges = matchRanges(str, q);
  if (!ranges.length) return text;
  const out = [];
  let from = 0;
  ranges.forEach(([a, b], i) => {
    if (a > from) out.push(<React.Fragment key={`t${i}`}>{str.slice(from, a)}</React.Fragment>);
    out.push(
      <mark key={`m${i}`} className="rounded-[2px] px-0.5" style={{ background: 'var(--app-tag-yellow)', color: 'var(--app-tag-yellow-fg)' }}>
        {str.slice(a, b)}
      </mark>,
    );
    from = b;
  });
  if (from < str.length) out.push(<React.Fragment key="tail">{str.slice(from)}</React.Fragment>);
  return out;
}

// 책 한 권의 절을 **띄어쓰기를 지운 모양**으로 한 번만 만들어 둔다 — 검색마다 3만 절을 다시 지우지
// 않게. 책 데이터(loadBook의 값)는 메모리 캐시에 남는 같은 객체라 WeakMap 열쇠로 맞다.
const packedBooks = new WeakMap();
function packedOf(data) {
  let p = packedBooks.get(data);
  if (!p) { p = data.chapters.map(vs => vs.map(compactText)); packedBooks.set(data, p); }
  return p;
}
