import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronDown, Bookmark, Search, X, Highlighter, Eraser } from 'lucide-react';
import { loadBibleIndex, loadBook } from '../services/bible.js';
import { parseRef } from '../services/bibleRef.js';
import {
  loadBibleState, saveBibleState, loadFontStep, saveFontStep,
  chapterKey, parseChapterKey, verseKey, parseVerseKey,
} from '../services/word.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
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
//
// **거리를 키웠다**(사용자 피드백 2026-09-02 — "이전/다음 장 애니메이션이 안 보인다").
// 12px·.26s는 스크롤 한 칸보다 작아서, 장이 바뀐 것은 알아도 어느 쪽으로 갔는지가
// 눈에 남지 않았다. 28px·.3s면 방향이 읽히고 §4.2의 결(이징 하나 · transform/opacity만)
// 안에 그대로 있다. prefers-reduced-motion이면 전환 자체가 없다.
const SWAP_SHIFT = 28;    // px — 방향이 보이는 최소치. 이보다 작으면 없는 것과 같았다
const SWAP_LIFT = 8;      // px — 방향이 없을 때(dir 0)의 세로 이동
const SWAP_MS = 300;      // ms — §4.2의 .dc-screen(260ms)과 같은 결

export function Swap({ k, dir = 0, className = '', children }) {
  const [seen, setSeen] = useState(k);
  const [shown, setShown] = useState(true);
  const nodeRef = useRef(null);
  const reduce = prefersReducedMotion();

  if (seen !== k) { setSeen(k); if (!reduce) setShown(false); }
  useEffect(() => {
    if (shown) return;
    // **이 줄이 애니메이션의 전부다.** 시작 자리를 브라우저에 한 번 '보여 주고' 나서
    // 제자리로 보낸다 — offsetHeight를 읽으면 그 자리로 스타일이 확정되고, 그래야
    // 다음 값이 전환의 끝점이 된다. 없으면 두 값이 같은 스타일 갱신 안에서 처리되어
    // **전환이 아예 시작되지 않는다**(사용자 피드백 2026-09-02 "애니메이션이 눈에
    // 안 잡힌다"의 진짜 원인 — 거리가 작아서가 아니라 안 돌고 있었다). 지우지 말 것.
    void nodeRef.current?.offsetHeight;
    setShown(true);
  }, [shown]);

  const off = dir === 0
    ? `translate3d(0, ${SWAP_LIFT}px, 0)`
    : `translate3d(${dir > 0 ? SWAP_SHIFT : -SWAP_SHIFT}px, 0, 0)`;
  const ease = `${SWAP_MS}ms var(--ease-out-quint)`;
  return (
    <div
      ref={nodeRef}
      className={className}
      data-swap={String(k)}
      style={reduce ? undefined : {
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : off,
        // 되돌릴 때는 전환을 끄고 튕겨 놓는다 — 안 그러면 나가는 것과 들어오는 것이
        // 같은 자리에서 서로 되감겨 흐릿하게 흔들린다.
        transition: shown ? `opacity ${ease}, transform ${ease}` : 'none',
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
// marks: 형광펜이 켜진 절의 '장:절' 집합
// onPickVerse(chapter, verse, el): 절을 눌렀을 때(리더에서만 준다). **여기서 칠하지
//   않는다** — 부른 쪽이 그 절에 선택 팝오버를 띄운다(VerseMarkMenu).
// picked: 지금 팝오버가 열려 있는 절의 '장:절'(aria-expanded용)
export function PassageText({
  verses, step = 1, showChapter = false, focus = null, marks = null, onPickVerse = null, picked = null,
}) {
  const f = FONT_STEPS[step] || FONT_STEPS[1];
  // 글을 끌어 고르고 손을 뗀 자리에도 click이 온다 — 고른 것이 있으면 팝오버를 띄우지
  // 않는다(복사하려고 고른 것을 형광펜으로 알아들으면 고른 것이 풀린다).
  const hit = (chapter, verse, el) => {
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    onPickVerse(chapter, verse, el);
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
            role={onPickVerse ? 'button' : undefined}
            tabIndex={onPickVerse ? 0 : undefined}
            aria-haspopup={onPickVerse ? 'menu' : undefined}
            aria-expanded={onPickVerse ? picked === key : undefined}
            onClick={onPickVerse ? (e) => hit(v.chapter, v.verse, e.currentTarget) : undefined}
            onKeyDown={onPickVerse ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault(); onPickVerse(v.chapter, v.verse, e.currentTarget);
            } : undefined}
            className={`rounded-[4px] transition-colors ${blank ? 'text-fg-faint' : 'text-fg-secondary'} ${
              lit || on ? '-mx-1.5 px-1.5' : ''} ${on && !lit ? 'bg-accent-weak' : ''} ${onPickVerse ? 'cursor-pointer' : ''}`}
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

// ── 절을 눌렀을 때의 선택 팝오버 ────────────────────────────────────────────
// **누르자마자 칠하지 않는다**(사용자 피드백 2026-09-02). 본문을 읽다 보면 손이
// 스치기만 해도 절이 노래졌고, 되돌리려면 같은 자리를 또 눌러야 했다. 절을 누르면
// 무엇을 할지 먼저 묻는다 — 이미 그어져 있으면 [형광펜 지우기], 아니면 [형광펜 긋기].
// 취소는 바깥 누름과 Esc다(따로 '취소' 줄을 두지 않는다 — 잃는 것이 없다).
//
// **여기는 색이 늘 자리다.** 지금은 줄이 하나뿐이지만 노랑 말고 다른 색이 붙으면
// 이 목록에 색 줄을 더하고 highlights 항목에 색 값을 얹으면 된다(services/word.js의
// verseKey는 그대로 두고 { ref, at, color } 꼴로 늘린다). 그때도 [지우기]는 맨 아래다.
//
// 자리 잡기는 공용 훅(useAnchoredPos)이 한다 — body 포털이라 본문이 스크롤·리사이즈로
// 움직여도 절을 따라온다. 항목 톤은 프로필 메뉴 줄과 같다(layout.jsx의 `item`).
//
// **`transition-none`을 지우지 말 것**(2026-09-02 3차 점검). 지우면 팝오버가 화면 왼쪽
// 위에서 절 옆으로 150ms 동안 날아온다. `duration-150`은 animate-in의 시간이면서 동시에
// `transition-duration`이고, `transition-property`의 초기값이 `all`이라 left·top까지
// 전환 대상이 된다. 자리는 useAnchoredPos가 그리기 전에(useLayoutEffect) 잡지만 그 안에서
// 팝오버 높이를 재느라(offsetHeight) 배치가 한 번 확정되고, 그래서 아직 값이 없던 {0,0}이
// 전환의 시작점으로 남는다. 다른 팝오버(ConfirmPopover·프로필 메뉴)는 열기 전에 place()를
// 불러 이 시작점이 아예 없다 — 여기는 눌린 절이 앵커라 열기 전에 부를 자리가 없다.
// 나타나는 결(fade-in·zoom-in-95)은 전환이 아니라 애니메이션이라 그대로 남는다.
const MENU_W = 176;
const MENU_H = 52;
const menuItem = 'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors text-left';

export function VerseMarkMenu({ anchorRef, lit, label, onPick, onClose }) {
  const popRef = useRef(null);
  const [pos] = useAnchoredPos(anchorRef, true, MENU_W, MENU_H, 8, popRef);

  useEffect(() => {
    // 앵커(그 절)도 '안'으로 친다 — 같은 절을 다시 누르면 여는 쪽이 닫는다.
    // 여기서 닫아 버리면 mousedown이 닫고 click이 곧바로 다시 여는 꼴이 된다.
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={popRef} role="menu" aria-label={`${label} 형광펜`} data-verse-menu={label}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: MENU_W }}
      className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 animate-in fade-in zoom-in-95 duration-150 transition-none"
    >
      <button type="button" role="menuitem" className={menuItem} onClick={onPick}>
        {lit ? <Eraser size={15} className="shrink-0" /> : <Highlighter size={15} className="shrink-0" />}
        {lit ? '형광펜 지우기' : '형광펜 긋기'}
      </button>
    </div>,
    document.body,
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
// 크기는 밖에서 준다 — 본문 자리(48px)와 옆 칸 '내 기록'(36px)이 쓰는 자리가 다르다.
export function EmptyBookMark({ className = 'w-12 h-12 mx-auto' }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
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

  // 형광펜 선택 팝오버 — { chapter, verse }. 앵커는 눌린 절 <p> 자체다(ref 객체 모양을
  // 그대로 맞춰 useAnchoredPos에 넘긴다).
  const [pick, setPick] = useState(null);
  const anchorRef = useRef(null);
  const closePick = useCallback(() => setPick(null), []);

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
    setPick(null);      // 자리를 옮기면 앵커였던 절이 사라진다 — 팝오버도 같이 내린다
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

  // 절을 누르면 그 절에 선택 팝오버를 띄운다 — 칠하는 것은 팝오버가 시킬 때다.
  // 같은 절을 다시 누르면 닫는다(VerseMarkMenu가 앵커를 '안'으로 쳐서 바깥 누름이
  // 먼저 닫아 버리지 않는다).
  const pickVerse = (chapter, verse, el) => {
    anchorRef.current = el;
    setPick(p => (p && p.chapter === chapter && p.verse === verse ? null : { chapter, verse }));
  };

  const pickRef = pick && place ? verseKey(place.bookId, pick.chapter, pick.verse) : '';
  const pickLit = !!pickRef && (state.highlights || []).some(h => h?.ref === pickRef);

  const toggleHighlight = () => {
    if (!pickRef) return;
    setPick(null);
    update({
      ...state,
      highlights: pickLit
        ? state.highlights.filter(h => h?.ref !== pickRef)
        : [...(state.highlights || []), { ref: pickRef, at: new Date().toISOString() }],
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
                  ? <PassageText verses={verses} step={step} focus={focus} marks={marks}
                      onPickVerse={pickVerse} picked={pick ? `${pick.chapter}:${pick.verse}` : null} />
                  : <PassageSkeleton lines={10} step={step} />}
              </Card>
              {pick && loaded && (
                <VerseMarkMenu
                  anchorRef={anchorRef} lit={pickLit}
                  label={`${here?.name || ''} ${pick.chapter}:${pick.verse}`.trim()}
                  onPick={toggleHighlight} onClose={closePick}
                />
              )}

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
//
// **책으로 묶는다**(사용자 피드백 2026-09-02 — "북마크·형광펜이 계속 쌓인다").
// 평평한 칩 목록은 스무 개만 넘어가도 어디가 어디인지 안 보였다. 정경 순으로 책마다
// 묶고, 책 머리글에 개수를 적고, 책 단위로 접었다 편다.
//
// **펼친 책의 파일만 그때 받는다.** 형광펜 줄에 절 미리보기를 한 줄 붙이려면 그 책
// 파일이 필요한데, 목록 전체를 미리 받으면 여러 권에 걸친 사람은 목록 하나에 몇 MB를
// 받는다. 그래서 펼칠 때 loadBook 한 권만 부른다(services/bible.js가 캐시하므로 두 번째
// 부터는 즉시 온다). 북마크는 장 제목이면 되므로 파일이 필요 없다 — 받지 않는다.
//
// **기본 펼침/접힘의 기준**: 책이 두 권까지면 펼쳐 둔다. 그때는 접힌 껍데기가 오히려
// 손을 한 번 더 쓰게 만든다(줄이 서너 개인데 머리글만 보이는 꼴). 세 권부터는 접어
// 둔다 — 그 정도면 목록이 화면을 넘기고, 무엇이 어느 책에 있는지가 먼저 궁금해진다.
// 사람이 직접 접거나 편 책은 그 선택이 이긴다(open에 남는다).
const AUTO_OPEN_BOOKS = 2;

// 책별로 묶어 정경 순으로 돌려준다 — [{ book, items }]
function groupByBook(entries, books, parse) {
  const bag = new Map();
  for (const e of entries) {
    const at = parse(e?.ref);
    if (!at) continue;
    if (!bag.has(at.bookId)) bag.set(at.bookId, []);
    bag.get(at.bookId).push({ ...e, at });
  }
  // books가 곧 정경 순이다(index.json). 책 안에서는 장·절 순 — 읽는 차례와 같다.
  return books
    .filter(b => bag.has(b.id))
    .map(b => ({
      book: b,
      items: bag.get(b.id).sort((x, y) => (x.at.chapter - y.at.chapter) || ((x.at.verse || 0) - (y.at.verse || 0))),
    }));
}

const markRow = 'flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors';

// 책 하나 — 머리글(개수) + 펼쳤을 때의 줄들. kind: 'bookmark' | 'highlight'
function MarkBookGroup({ book, items, kind, open, onToggle, onOpenItem, onRemoveItem }) {
  const [chapters, setChapters] = useState(null);   // 형광펜 미리보기용 절 본문
  const reduce = prefersReducedMotion();
  const needsText = kind === 'highlight';

  // 펼친 책만, 펼친 그때 받는다
  useEffect(() => {
    if (!open || !needsText || chapters) return undefined;
    let alive = true;
    loadBook(book.id)
      .then(d => { if (alive) setChapters(d.chapters || []); })
      .catch(() => { if (alive) setChapters([]); });   // 못 받아도 참조 줄은 남는다
    return () => { alive = false; };
  }, [open, needsText, chapters, book.id]);

  return (
    <div className="min-w-0">
      <button
        onClick={onToggle} aria-expanded={open} data-book-group={`${kind}:${book.id}`}
        className="w-full flex items-center gap-1.5 px-2 -mx-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors text-left"
      >
        <ChevronDown
          size={13} className="shrink-0 text-fg-faint"
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: reduce ? 'none' : 'transform .18s var(--ease-out-quint)' }}
        />
        <span className="flex-1 min-w-0 truncate text-[11.5px] font-bold text-fg">{book.name}</span>
        <span className="shrink-0 text-[11px] text-fg-faint tabular-nums">
          {items.length}{kind === 'bookmark' ? '장' : '절'}
        </span>
      </button>

      {open && (
        <div className="pl-[18px] flex flex-col">
          {items.map(it => {
            const { chapter, verse } = it.at;
            const label = kind === 'bookmark'
              ? (it.label || `${book.name} ${chapter}장`)
              : `${book.name} ${chapter}:${verse}`;
            // 형광펜 미리보기 한 줄. 아직 안 왔으면 자리만 잡아 둔다(오면서 밀지 않게)
            const preview = needsText && chapters ? (chapters[chapter - 1]?.[verse - 1] || '') : '';
            return (
              <span key={it.ref} className="flex items-center gap-0.5">
                <button data-goto={it.ref} onClick={() => onOpenItem(it.at)} className={markRow}>
                  {kind === 'bookmark' ? (
                    <span className="block truncate text-[11.5px] font-semibold text-fg">{chapter}장</span>
                  ) : (
                    <span className="block truncate">
                      <span className="text-[11px] font-bold text-accent-text tabular-nums">{chapter}:{verse}</span>
                      {needsText && !chapters
                        ? <span className="inline-flex align-middle ml-1.5 w-24 h-3"><Skeleton className="w-full h-full rounded-[3px]" /></span>
                        : <span className="ml-1.5 text-[11.5px] text-fg-secondary">{preview}</span>}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRemoveItem(it.ref)}
                  aria-label={`${label} ${kind === 'bookmark' ? '북마크' : '형광펜'} 지우기`}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 한 칸(북마크 또는 형광펜) — 제목 · 총 개수 · 책 그룹들, 비었으면 마크와 한 줄
function MarkSection({ title, unit, empty, groups, total, kind, onOpenItem, onRemoveItem }) {
  // 사람이 직접 접거나 편 책만 남는다 — 나머지는 책 수에 따라 기본값을 따른다
  const [open, setOpen] = useState({});
  const auto = groups.length <= AUTO_OPEN_BOOKS;

  return (
    <div>
      <SectionHead right={total
        ? <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{total}{unit}</span> : null}>
        {title}
      </SectionHead>
      {!total ? (
        // 빈 칸도 남는 자리의 가운데에 마크와 함께 선다(§8). 옆 칸은 좁으므로 마크는
        // 작게 그린다 — 예전에는 줄 왼쪽에 붙은 작은 아이콘 하나였고, 무엇이 북마크
        // 칸이고 무엇이 형광펜 칸인지는 어차피 바로 위 제목이 말해 준다.
        <div className="min-h-[92px] flex flex-col items-center justify-center text-center">
          <EmptyBookMark className="w-9 h-9 mx-auto" />
          <p className="text-[11.5px] text-fg-faint mt-2">{empty}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {groups.map(g => (
            <MarkBookGroup
              key={g.book.id} book={g.book} items={g.items} kind={kind}
              open={open[g.book.id] ?? auto}
              onToggle={() => setOpen(o => ({ ...o, [g.book.id]: !(o[g.book.id] ?? auto) }))}
              onOpenItem={onOpenItem} onRemoveItem={onRemoveItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MyMarks({ books, bookmarks = [], highlights = [], onOpenChapter, onOpenVerse, onRemoveBookmark, onRemoveHighlight }) {
  const bookGroups = useMemo(() => groupByBook(bookmarks, books, parseChapterKey), [bookmarks, books]);
  const litGroups = useMemo(() => groupByBook(highlights, books, parseVerseKey), [highlights, books]);
  // 파싱이 안 되는 옛 값이 섞여 있으면 그룹에는 못 들어간다 — 개수는 실제로 그린 줄로 센다
  const bookTotal = bookGroups.reduce((n, g) => n + g.items.length, 0);
  const litTotal = litGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="min-w-0 flex flex-col gap-6">
      <MarkSection
        title="북마크" unit="장" kind="bookmark" groups={bookGroups} total={bookTotal}
        empty="북마크한 장을 여기서 볼 수 있어요"
        onOpenItem={at => onOpenChapter(at.bookId, at.chapter)}
        onRemoveItem={onRemoveBookmark}
      />
      <MarkSection
        title="형광펜" unit="절" kind="highlight" groups={litGroups} total={litTotal}
        empty="형광펜을 칠한 절은 여기서 볼 수 있어요"
        onOpenItem={at => onOpenVerse(at.bookId, at.chapter, at.verse)}
        onRemoveItem={onRemoveHighlight}
      />
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
