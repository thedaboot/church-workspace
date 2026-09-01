import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Bookmark, Search, X, Highlighter } from 'lucide-react';
import { loadBibleIndex, loadBook } from '../services/bible.js';
import { parseRef } from '../services/bibleRef.js';
import {
  loadBibleState, saveBibleState, loadFontStep, saveFontStep,
  chapterKey, parseChapterKey, verseKey, parseVerseKey,
} from '../services/word.js';
import { SectionHead, Card, prefersReducedMotion } from '../views/dashboardParts.jsx';
import { Skeleton } from './media.jsx';

// ============================================================================
// 성경 읽기 — 목차 · 리더 · 본문 검색 · 북마크 · 형광펜 · 이어읽기 (docs/V2.md 결정 12)
// ----------------------------------------------------------------------------
// 본문은 public/bible/*.json(개역한글)이고 로더는 services/bible.js 하나다.
// '(없음)'·'[ ]'·'(셀라)'는 대한성서공회의 편집 표기라 데이터에 그대로 있다 —
// 지우면 절 번호가 통째로 밀리므로 **화면에서만** 흐리게 그린다
// (public/bible/README.md · services/bible.js 머리말).
//
// 검색은 인덱스를 만들지 않는다. 66권을 순서대로 받아 훑고, 책 하나가 끝날 때마다
// 진행을 그린다(첫 검색은 4.5MB를 받으므로 그 사이 화면이 멈춰 보이면 안 된다).
// 받은 책은 loadBook이 캐시하므로 두 번째 검색부터는 빠르다.
//
// **폭**: 본문 열만 46rem에서 끊고 화면의 남는 폭은 '내 기록'(북마크·형광펜)이 쓴다
// (사용자 피드백 2026-09-01 — "레이아웃을 화면 폭에 맞게, 본문 열은 읽기 폭 유지").
// 좁은 화면에는 옆 칸이 설 자리가 없으므로 같은 부품을 목차 위에 세운다 — 예전에
// 북마크가 있던 그 자리다.
// ============================================================================

const OT_COUNT = 39;               // 정경 순서 — index.json의 앞 39권이 구약
const RESULT_LIMIT = 50;           // 결과 상한(스펙). 넘으면 거기서 멈춘다

// 글자 크기 3단계. 계정이 아니라 기기에 남긴다(같은 사람도 폰과 노트북이 다르다).
const FONT_STEPS = [
  { size: '13.5px', line: '1.75', gap: '5px', mark: '11px' },
  { size: '15px', line: '1.8', gap: '7px', mark: '12.5px' },
  { size: '17px', line: '1.85', gap: '9px', mark: '14px' },
];

// ── 화면이 바뀔 때의 결 ─────────────────────────────────────────────────────
// 말씀 화면 안에서 무엇이 바뀌든(세그먼트 · 날짜 · 장 · 목차↔리더) 같은 결로 바뀐다.
// index.css에 새 키프레임을 두지 않고 **전환**으로 낸다: k가 달라진 렌더에서 시작
// 자리로 되돌려 놓고(렌더 중 setState — 그 렌더가 곧바로 다시 돈다), 그림이 나간
// 뒤(useEffect)에 제자리로 보낸다. 움직이는 것은 transform·opacity뿐이다(§4.2).
// dir: 1 다음 · -1 이전 · 0 방향 없음(그때는 세로로 아주 조금).
export function Swap({ k, dir = 0, className = '', children }) {
  const [seen, setSeen] = useState(k);
  const [shown, setShown] = useState(true);
  const reduce = prefersReducedMotion();

  if (seen !== k) { setSeen(k); if (!reduce) setShown(false); }
  useEffect(() => { if (!shown) setShown(true); }, [shown]);

  const off = dir === 0 ? 'translate3d(0, 5px, 0)' : `translate3d(${dir > 0 ? 12 : -12}px, 0, 0)`;
  return (
    <div
      className={className}
      data-swap={String(k)}
      style={reduce ? undefined : {
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : off,
        // 되돌릴 때는 전환을 끄고 튕겨 놓는다 — 안 그러면 나가는 것과 들어오는 것이
        // 같은 자리에서 서로 되감겨 흐릿하게 흔들린다.
        transition: shown ? 'opacity .26s var(--ease-out-quint), transform .26s var(--ease-out-quint)' : 'none',
      }}
    >{children}</div>
  );
}

// ── 기다리는 자리 ───────────────────────────────────────────────────────────
// 자리를 먼저 잡아 두는 것이 목적이다 — 글자 한 줄("본문을 여는 중")로 두면 본문이
// 도착할 때 아래 것들이 통째로 밀린다(사용자 피드백 2026-09-01 '출렁임').
// 줄 길이를 조금씩 달리해 글 덩이처럼 보이게 한다.
const SKEL_W = ['92%', '86%', '96%', '78%', '90%', '84%', '94%', '72%', '88%', '82%', '95%', '76%'];

export function PassageSkeleton({ lines = 8, step = 1 }) {
  const f = FONT_STEPS[step] || FONT_STEPS[1];
  return (
    <div className="flex flex-col" style={{ gap: f.gap }} aria-hidden="true">
      {SKEL_W.slice(0, lines).map((w, i) => (
        // 크기는 **바깥**이 잡는다 — Skeleton은 className만 받고, `.dc-skeleton`이
        // position:relative를 박고 있어 위치 유틸은 어차피 먹지 않는다(media.jsx 머리말)
        <div key={i} style={{ width: w, height: `calc(${f.size} * ${f.line})` }}>
          <Skeleton className="w-full h-full rounded-[4px]" />
        </div>
      ))}
    </div>
  );
}

// ── 본문 한 덩이 (QT 탭도 같이 쓴다) ───────────────────────────────────────
// marks: 형광펜이 켜진 절의 '장:절' 집합 · onMark: 절을 눌렀을 때(리더에서만 준다)
export function PassageText({ verses, step = 1, showChapter = false, focus = null, marks = null, onMark = null }) {
  const f = FONT_STEPS[step] || FONT_STEPS[1];
  // 글을 끌어 고르고 손을 뗀 자리에도 click이 온다 — 고른 것이 있으면 형광펜을 켜지
  // 않는다(복사하려고 고른 것을 형광펜으로 알아들으면 지우러 다시 눌러야 한다).
  const hit = (chapter, verse) => {
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    onMark(chapter, verse);
  };
  return (
    <div className="flex flex-col" style={{ gap: f.gap }}>
      {verses.map(v => {
        // 이 판에서 비워 둔 절. 글자는 남기고 색만 죽인다 — 지우면 뒤 절 번호가 밀린다
        const blank = v.text === '(없음)';
        const on = focus && focus.chapter === v.chapter && focus.verse === v.verse;
        const key = `${v.chapter}:${v.verse}`;
        const lit = !!marks?.has(key);
        const style = { fontSize: f.size, lineHeight: f.line };
        // 형광펜 색은 업무 본문의 ==형광펜==과 같은 토큰이다(RichText·.tiptap mark)
        if (lit) { style.background = 'var(--app-tag-yellow)'; style.color = 'var(--app-tag-yellow-fg)'; }
        if (on) style.boxShadow = 'inset 0 0 0 1.5px var(--app-accent)';
        return (
          <p
            key={key}
            data-verse={key}
            data-focus={on ? '1' : undefined}
            data-mark={lit ? '1' : undefined}
            role={onMark ? 'button' : undefined}
            tabIndex={onMark ? 0 : undefined}
            aria-pressed={onMark ? lit : undefined}
            onClick={onMark ? () => hit(v.chapter, v.verse) : undefined}
            onKeyDown={onMark ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault(); onMark(v.chapter, v.verse);
            } : undefined}
            className={`rounded-[4px] transition-colors ${blank ? 'text-fg-faint' : 'text-fg-secondary'} ${
              lit || on ? '-mx-1.5 px-1.5' : ''} ${on && !lit ? 'bg-accent-weak' : ''} ${onMark ? 'cursor-pointer' : ''}`}
            style={style}
          >
            {/* 형광펜이 켜지면 절 번호도 그 색을 옅게 쓴다 — 회색을 그대로 두면 노랑 위에서
                탁해 보이고, 진하게 두면 번호가 본문보다 세진다 */}
            <span className={`mr-1.5 tabular-nums font-bold ${lit ? 'opacity-70' : 'text-fg-faint'}`} style={{ fontSize: f.mark }}>
              {showChapter ? `${v.chapter}:${v.verse}` : v.verse}
            </span>
            {v.text}
          </p>
        );
      })}
    </div>
  );
}

// ── 글자 크기 Aa 3단계 ─────────────────────────────────────────────────────
export function FontSteps({ step, onChange }) {
  return (
    <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
      {FONT_STEPS.map((f, i) => (
        <button
          key={i} onClick={() => onChange(i)} title={['작게', '보통', '크게'][i]}
          aria-label={`글자 ${['작게', '보통', '크게'][i]}`}
          className="px-2 py-[3px] rounded-[5px] font-bold leading-none transition-colors"
          style={{
            fontSize: [11, 13, 15][i],
            background: step === i ? 'var(--app-surface)' : 'transparent',
            color: step === i ? 'var(--app-ink)' : 'var(--app-ink-muted)',
          }}
        >Aa</button>
      ))}
    </span>
  );
}

// 빈 화면 표식 — 펼친 책. 왼쪽 면 → 오른쪽 면 → 가운데 선 순서로 그려진다(§4.2)
export function EmptyBookMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-12 h-12 mx-auto" aria-hidden="true">
      <path className="dc-draw" pathLength="1" d="M24 15c-4.6-3.2-9.8-3.6-15.5-1.2v21c5.7-2.4 10.9-2 15.5 1.2"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M24 15c4.6-3.2 9.8-3.6 15.5-1.2v21c-5.7-2.4-10.9-2-15.5 1.2"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M24 15v21"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const btn = 'inline-flex items-center justify-center gap-1 rounded-md text-[12px] font-semibold transition active:scale-95';

// ── 성경 읽기 탭 ────────────────────────────────────────────────────────────
export function BibleTab({ initialRef = '' }) {
  const [books, setBooks] = useState([]);
  const [state, setState] = useState({ lastRef: '', bookmarks: [], highlights: [] });
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);

  const [place, setPlace] = useState(null);      // { bookId, chapter } — 없으면 목차
  const [pickedBook, setPickedBook] = useState(null);  // 목차에서 고른 책(장 그리드)
  const [focus, setFocus] = useState(null);      // 검색 결과·형광펜 목록에서 들어온 절
  const [dir, setDir] = useState(0);             // 화면이 바뀌는 방향(이전/다음 장)

  const [chap, setChap] = useState(null);        // { key, verses } — 지금 장의 절 배열
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null);     // { done, total } · null이면 안 돌고 있다
  const searchToken = useRef(0);
  const bodyRef = useRef(null);

  const bookOf = useCallback((id) => books.find(b => b.id === id) || null, [books]);

  // 첫 진입 — 책 목록 · 내 상태(이어읽기·북마크·형광펜) · 글자 크기
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, saved] = await Promise.all([loadBibleIndex(), loadBibleState()]);
      if (!alive) return;
      setBooks(list);
      setState(saved);
      setStep(loadFontStep());
      // 주보·QT에서 넘어온 구절이 먼저다. 없으면 마지막으로 읽던 자리로 이어간다.
      const fromRef = initialRef ? parseRef(initialRef, list) : null;
      const last = fromRef
        ? { bookId: fromRef.bookId, chapter: fromRef.start.chapter }
        : parseChapterKey(saved.lastRef);
      if (last && list.some(b => b.id === last.bookId)) setPlace(last);
      setReady(true);
    })().catch(() => setReady(true));
    return () => { alive = false; };
  }, [initialRef]);

  // 지금 장의 본문. **어느 장의 것인지 같이 들고 있는다** — 장을 넘긴 직후 한 프레임
  // 동안 앞 장의 절이 새 제목 밑에 남아 있었다.
  useEffect(() => {
    if (!place) { setChap(null); return undefined; }
    const key = chapterKey(place.bookId, place.chapter);
    let alive = true;
    loadBook(place.bookId)
      .then(data => { if (alive) setChap({ key, verses: data.chapters[place.chapter - 1] || [] }); })
      .catch(() => { if (alive) setChap({ key, verses: [] }); });
    return () => { alive = false; };
  }, [place]);

  const here = place ? bookOf(place.bookId) : null;
  const placeKey = place ? chapterKey(place.bookId, place.chapter) : '';
  const loaded = !!place && chap?.key === placeKey;

  // 검색·형광펜 목록에서 들어온 절로 데려간다
  useEffect(() => {
    if (!focus || !loaded) return;
    const el = bodyRef.current?.querySelector('[data-focus="1"]');
    el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [focus, loaded]);

  const update = (next) => { setState(next); saveBibleState(next); };
  const goto = (bookId, chapter, at = null, delta = 0) => {
    setDir(delta);
    setPlace({ bookId, chapter });
    setFocus(at);
    setQuery(''); setTyped(''); setResults([]); setProgress(null);
    searchToken.current++;
    update({ ...state, lastRef: chapterKey(bookId, chapter) });
  };

  // 장을 옮긴다. 책의 끝을 넘으면 다음 책 1장으로 이어진다(성경은 한 권이다).
  const move = (delta) => {
    if (!place) return;
    const idx = books.findIndex(b => b.id === place.bookId);
    const at = books[idx];
    const next = place.chapter + delta;
    if (next >= 1 && next <= at.chapters) return goto(place.bookId, next, null, delta);
    const nb = books[idx + delta];
    if (!nb) return;
    goto(nb.id, delta > 0 ? 1 : nb.chapters, null, delta);
  };

  const runSearch = async (raw) => {
    const q = raw.trim();
    const token = ++searchToken.current;
    setQuery(q);
    setFocus(null);
    setDir(0);
    if (!q) { setResults([]); setProgress(null); return; }
    setResults([]); setProgress({ done: 0, total: books.length });
    const out = [];
    for (let i = 0; i < books.length; i++) {
      if (token !== searchToken.current) return;
      const b = books[i];
      let data = null;
      try { data = await loadBook(b.id); } catch { /* 한 권을 못 받아도 나머지는 찾는다 */ }
      if (token !== searchToken.current) return;
      if (data) {
        for (let c = 0; c < data.chapters.length && out.length < RESULT_LIMIT; c++) {
          const verses = data.chapters[c];
          for (let v = 0; v < verses.length; v++) {
            if (!verses[v].includes(q)) continue;
            out.push({ bookId: b.id, name: b.name, chapter: c + 1, verse: v + 1, text: verses[v] });
            if (out.length >= RESULT_LIMIT) break;
          }
        }
      }
      setResults(out.slice());
      setProgress({ done: i + 1, total: books.length });
      if (out.length >= RESULT_LIMIT) break;
      await new Promise(r => setTimeout(r, 0));   // 진행이 화면에 그려질 틈
    }
    if (token === searchToken.current) setProgress(p => (p ? { ...p, done: books.length } : null));
  };

  const clearSearch = () => {
    searchToken.current++;
    setQuery(''); setTyped(''); setResults([]); setProgress(null);
  };

  const verses = useMemo(() => (loaded ? chap.verses : []).map((text, i) => ({
    chapter: place?.chapter || 1, verse: i + 1, text,
  })), [chap, loaded, place]);
  const marked = place && state.bookmarks.some(b => b.ref === placeKey);

  const toggleBookmark = () => {
    if (!place || !here) return;
    const bookmarks = marked
      ? state.bookmarks.filter(b => b.ref !== placeKey)
      : [...state.bookmarks, { ref: placeKey, label: `${here.name} ${place.chapter}장`, at: new Date().toISOString() }];
    update({ ...state, bookmarks });
  };

  // 이 장에 켜진 형광펜 — PassageText는 '장:절'로 본다
  const marks = useMemo(() => {
    if (!place) return null;
    const pre = `${place.bookId} ${place.chapter}:`;
    const set = new Set();
    for (const h of state.highlights || []) {
      const ref = String(h?.ref || '');
      if (ref.startsWith(pre)) set.add(ref.slice(place.bookId.length + 1));
    }
    return set;
  }, [state.highlights, place]);

  const toggleHighlight = (chapter, verse) => {
    if (!place) return;
    const ref = verseKey(place.bookId, chapter, verse);
    const lit = (state.highlights || []).some(h => h?.ref === ref);
    update({
      ...state,
      highlights: lit
        ? state.highlights.filter(h => h?.ref !== ref)
        : [...(state.highlights || []), { ref, at: new Date().toISOString() }],
    });
  };

  const searching = !!progress && progress.done < progress.total && results.length < RESULT_LIMIT;

  const myMarks = (
    <MyMarks
      books={books} bookmarks={state.bookmarks} highlights={state.highlights || []}
      onOpenChapter={(bookId, chapter) => goto(bookId, chapter)}
      onOpenVerse={(bookId, chapter, verse) => goto(bookId, chapter, { chapter, verse })}
      onRemoveBookmark={ref => update({ ...state, bookmarks: state.bookmarks.filter(b => b.ref !== ref) })}
      onRemoveHighlight={ref => update({ ...state, highlights: state.highlights.filter(h => h?.ref !== ref) })}
    />
  );

  // 화면이 바뀌는 단위 — 이 값이 달라지면 Swap이 새로 들여보낸다
  const viewKey = query ? `q:${query}` : place ? `p:${placeKey}` : pickedBook ? `b:${pickedBook}` : 'toc';

  return (
    // 화면 폭을 다 쓴다 — 본문 열은 46rem에서 끊고(오래 읽는 글이라 한 줄이 길면
    // 다음 줄 첫 글자를 눈이 못 찾는다) 남는 폭은 '내 기록'이 받는다.
    <div className="grid gap-x-7 gap-y-6 items-start side-grid">
      <div className="min-w-0">
        {/* 검색 · 글자 크기 — 목차에서도 리더에서도 같은 자리 */}
        <div className="flex items-center gap-2 pb-3.5 max-w-[46rem]">
          <form
            onSubmit={e => { e.preventDefault(); runSearch(typed); }}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 h-9 rounded-md"
            style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}
          >
            <Search size={14} className="shrink-0 text-fg-faint" />
            <input
              value={typed} onChange={e => setTyped(e.target.value)}
              placeholder="본문 검색" aria-label="본문 검색"
              className="flex-1 min-w-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-faint outline-none"
            />
            {(typed || query) && (
              <button type="button" onClick={clearSearch} aria-label="검색어 지우기"
                className="shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors">
                <X size={13} />
              </button>
            )}
          </form>
          <FontSteps step={step} onChange={n => { setStep(n); saveFontStep(n); }} />
        </div>

        <Swap k={viewKey} dir={dir} className="min-w-0">
          {query ? (
            <SearchResults
              query={query} results={results} progress={progress} searching={searching}
              onOpen={r => goto(r.bookId, r.chapter, { chapter: r.chapter, verse: r.verse })}
            />
          ) : place ? (
            <div ref={bodyRef} className="min-w-0 max-w-[46rem]">
              <div className="flex items-center gap-2 pb-3">
                <button onClick={() => { setDir(-1); setPlace(null); setPickedBook(null); }}
                  className={`${btn} shrink-0 pl-1.5 pr-2.5 h-8 text-fg-muted hover:bg-surface-hover`}>
                  <ChevronLeft size={14} />목차
                </button>
                <h3 className="flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">
                  {here?.name} {place.chapter}장
                </h3>
                <button onClick={toggleBookmark} title={marked ? '북마크 지우기' : '북마크에 넣기'}
                  aria-label={marked ? '북마크 지우기' : '북마크에 넣기'}
                  className={`${btn} shrink-0 w-8 h-8 ${marked ? 'text-accent-text bg-accent-weak' : 'text-fg-muted hover:bg-surface-hover'}`}>
                  <Bookmark size={15} fill={marked ? 'currentColor' : 'none'} />
                </button>
              </div>

              <Card className="p-4 md:p-5">
                {loaded
                  ? <PassageText verses={verses} step={step} focus={focus} marks={marks} onMark={toggleHighlight} />
                  : <PassageSkeleton lines={10} step={step} />}
              </Card>

              <div className="flex items-center gap-2 pt-3.5">
                <button onClick={() => move(-1)} className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover`}
                  style={{ border: '1px solid var(--app-line)' }}>
                  <ChevronLeft size={14} />이전 장
                </button>
                <button onClick={() => move(1)} className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover`}
                  style={{ border: '1px solid var(--app-line)' }}>
                  다음 장<ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex flex-col gap-6">
              {/* 옆 칸이 설 자리가 없는 폭에서는 목차 위가 '내 기록'의 자리다 */}
              <div className="lg:hidden">{myMarks}</div>
              <Toc books={books} ready={ready} picked={pickedBook} setPicked={id => { setDir(id ? 1 : -1); setPickedBook(id); }} onOpen={goto} />
            </div>
          )}
        </Swap>
      </div>

      <div className="min-w-0 hidden lg:block">{myMarks}</div>
    </div>
  );
}

// ── 내 기록 (북마크 · 형광펜) ───────────────────────────────────────────────
// 누르면 그 자리로 간다. 형광펜은 절까지 데려가고 그 절이 화면 가운데에 선다.
// 절 본문을 여기서 같이 보여 주지 않는 이유: 표시하려면 그 책 파일을 전부 받아야 해서
// 형광펜이 여러 권에 걸린 사람은 목록 하나에 몇 MB를 받게 된다.
const MarkChip = ({ label, onOpen, onRemove, removeLabel }) => (
  <span className="inline-flex items-center rounded-full overflow-hidden"
    style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
    <button onClick={onOpen}
      className="pl-3 pr-1.5 py-1.5 text-[11.5px] font-semibold text-fg hover:bg-surface-hover transition-colors">
      {label}
    </button>
    <button onClick={onRemove} aria-label={removeLabel}
      className="pr-2.5 pl-1 py-1.5 text-fg-faint hover:text-fg transition-colors">
      <X size={12} />
    </button>
  </span>
);

function MyMarks({ books, bookmarks = [], highlights = [], onOpenChapter, onOpenVerse, onRemoveBookmark, onRemoveHighlight }) {
  const nameOf = (id) => books.find(b => b.id === id)?.name || '';
  // 최근에 그은 것이 위로 — 목록이 길어지면 방금 그은 것을 다시 찾기 어렵다
  const lit = useMemo(() => [...highlights]
    .map(h => ({ ...h, at: h?.at || '' }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))), [highlights]);

  return (
    <div className="min-w-0 flex flex-col gap-6">
      <div>
        <SectionHead right={bookmarks.length
          ? <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{bookmarks.length}장</span> : null}>
          북마크
        </SectionHead>
        {bookmarks.length === 0 ? (
          <p className="text-[11.5px] text-fg-faint">북마크한 장이 여기 모입니다</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {bookmarks.map(m => {
              const at = parseChapterKey(m.ref);
              const label = m.label || (at ? `${nameOf(at.bookId)} ${at.chapter}장` : m.ref);
              return (
                <MarkChip
                  key={m.ref} label={label} removeLabel={`${label} 북마크 지우기`}
                  onOpen={() => at && onOpenChapter(at.bookId, at.chapter)}
                  onRemove={() => onRemoveBookmark(m.ref)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div>
        <SectionHead right={lit.length
          ? <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{lit.length}절</span> : null}>
          형광펜
        </SectionHead>
        {lit.length === 0 ? (
          <p className="text-[11.5px] text-fg-faint inline-flex items-center gap-1.5">
            <Highlighter size={13} className="shrink-0" />형광펜을 그은 절이 여기 모입니다
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lit.map(h => {
              const at = parseVerseKey(h.ref);
              if (!at) return null;
              const label = `${nameOf(at.bookId)} ${at.chapter}:${at.verse}`;
              return (
                <MarkChip
                  key={h.ref} label={label} removeLabel={`${label} 형광펜 지우기`}
                  onOpen={() => onOpenVerse(at.bookId, at.chapter, at.verse)}
                  onRemove={() => onRemoveHighlight(h.ref)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 목차 (책 목록 → 장 그리드) ──────────────────────────────────────────────
function Toc({ books, ready, picked, setPicked, onOpen }) {
  if (!ready) return <TocSkeleton />;

  if (picked) {
    const b = books.find(x => x.id === picked);
    if (!b) return null;
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2 pb-3">
          <button onClick={() => setPicked(null)}
            className={`${btn} shrink-0 pl-1.5 pr-2.5 h-8 text-fg-muted hover:bg-surface-hover`}>
            <ChevronLeft size={14} />책 목록
          </button>
          <h3 className="flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">{b.name}</h3>
          <span className="shrink-0 text-[11.5px] text-fg-faint tabular-nums">{b.chapters}장</span>
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
    <div className="min-w-0 flex flex-col gap-6">
      {[['구약', books.slice(0, OT_COUNT)], ['신약', books.slice(OT_COUNT)]].map(([title, list]) => (
        <div key={title}>
          <SectionHead right={<span className="text-[11px] text-fg-faint tabular-nums shrink-0">{list.length}권</span>}>
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
function SearchResults({ query, results, progress, searching, onOpen }) {
  const capped = results.length >= RESULT_LIMIT;
  return (
    <div className="min-w-0 max-w-[46rem]">
      <div className="flex items-center gap-2 pb-2.5">
        <span className="text-[12.5px] font-bold text-fg truncate min-w-0">{query}</span>
        <span className="text-[11.5px] text-fg-faint tabular-nums shrink-0">
          {searching
            ? `${progress.done}/${progress.total}권 훑는 중 · ${results.length}건`
            : capped ? `앞에서부터 ${results.length}건` : `${results.length}건`}
        </span>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
      </div>

      {!results.length ? (
        searching
          ? <PassageSkeleton lines={5} />
          : (
            <div className="min-h-[38vh] flex flex-col items-center justify-center text-center">
              <EmptyBookMark />
              <p className="text-[13px] font-semibold text-fg mt-3">그 말이 나오는 절을 찾지 못했어요</p>
            </div>
          )
      ) : (
        <div className="flex flex-col">
          {results.map(r => (
            <button key={`${r.bookId}-${r.chapter}-${r.verse}`} onClick={() => onOpen(r)}
              data-hit={verseKey(r.bookId, r.chapter, r.verse)}
              className="text-left py-2.5 px-2.5 -mx-2.5 rounded-[8px] hover:bg-surface-hover transition-colors">
              <span className="block text-[11.5px] font-bold text-accent-text tabular-nums">
                {r.name} {r.chapter}:{r.verse}
              </span>
              <span className="block text-[12.5px] leading-relaxed text-fg-secondary mt-0.5">
                {highlight(r.text, query)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 찾은 말을 표시한다 — 색은 토큰(tag-yellow)이라 다크에서도 따라온다
function highlight(text, q) {
  const i = text.indexOf(q);
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] px-0.5" style={{ background: 'var(--app-tag-yellow)', color: 'var(--app-tag-yellow-fg)' }}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}
