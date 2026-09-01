import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { loadBibleIndex, loadBook, loadPassage } from '../services/bible.js';
import { parseRef, formatRef } from '../services/bibleRef.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { keepVisible } from '../utils.js';

// ============================================================================
// 주보의 본문 선택 — 범위 고르기(PassagePicker) · 본문 펼치기(PassageBody)
// ----------------------------------------------------------------------------
// 구절은 글자로 받지 않는다(사용자 결정 2026-09-01). 책을 고르고 시작 장:절 ~ 끝 장:절을
// 고르면 그 자리에서 본문이 아래에 펼쳐진다. **저장되는 값은 지금까지와 같은 문자열**
// (formatRef의 '이사야 32:9-20')이라 스키마도 읽는 쪽도 그대로다.
//
// 처음에는 네이티브 <select> 다섯 개였는데, 브라우저마다 다르게 그려지고 다크 모드에서
// 이 앱의 것이 아닌 목록이 떴다(사용자 지적 2026-09-02 — 날짜 칸을 DatePicker로 바꾼 것과
// 같은 이유다). 지금은 전부 우리 부품이다:
//   · 책 — 담당자 이름 칸(worshipDetail의 PersonNameInput)과 같은 자동완성 입력칸.
//     이름·약칭 어디든 걸린다('엡'이 에베소서를 부른다).
//   · 장·절 — 숫자 그리드 팝오버. **body 포털 + useAnchoredPos**(§6-1)라 편집 칸이
//     화면 아래쪽에 있어도, 모바일 375px에서도 잘리지 않는다.
//
// 책 목록(장 수)은 index.json 하나로 오고, 절 수는 그 책 파일을 받아야 안다 —
// 책을 고른 뒤에 한 번 받고 캐시한다(services/bible.js가 캐시를 가진다).
//
// 못 읽는 구절('주보 특별 순서' 같은 자유 표기)은 손대지 않는다. 고르기 전에는 아무것도
// 내보내지 않으므로 예전에 적어 둔 글자가 조용히 지워지는 일이 없다.
// ============================================================================

// 트리거 버튼 — 날짜 픽커의 그 모양이다(같은 자리에 서는 칸이라 톤을 맞춘다)
const TRIGGER = 'inline-flex items-center gap-1 border border-line rounded-xs bg-surface px-2 py-1.5 text-[13px] text-fg tabular-nums hover:bg-surface-hover focus:border-accent outline-none transition-all';
const BOX = 'flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1 focus-within:border-accent focus-within:shadow-soft transition-all';
const LIST = 'z-[90] bg-surface border border-line rounded-lg shadow-elevated animate-in fade-in zoom-in-95 duration-150';
const NUM_W = 216;      // 여섯 칸 그리드 + 좌우 여백
const NUM_EST_H = 210;

const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);

// 바깥 클릭·Esc로 닫는다. 팝오버가 body 포털로 나가 있으므로 바깥 판정에 팝오버 자신도
// 넣어야 한다(ConfirmPopover가 같은 이유로 그렇게 한다).
function useDismiss(open, close, refs) {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!refs.some(r => r.current?.contains(e.target))) cb.current(); };
    const onKey = (e) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    // refs는 렌더마다 새 배열이지만 담긴 ref 객체는 그대로다 — open에만 반응하면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// 숫자 하나를 고르는 그리드 팝오버(장·절 공용).
// 시편 119편처럼 176절짜리도 있어서 목록은 스크롤한다 — 열 때 고른 번호가 보이게
// keepVisible을 건다(담당자 자동완성이 활성 항목에 거는 것과 같은 한 벌).
function NumberPicker({ label, value, suffix, options, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, NUM_W, NUM_EST_H, 8, popRef);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);

  return (
    <span ref={rootRef} className="inline-flex">
      <span ref={btnRef} className="inline-flex">
        <button type="button" aria-label={label} aria-expanded={open}
          onClick={() => { place(); setOpen(o => !o); }} className={`worship-num ${TRIGGER}`}>
          {value}{suffix} <ChevronDown size={12} className="text-fg-faint shrink-0" />
        </button>
      </span>
      {open && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: NUM_W }}
          className={`worship-num-pop ${LIST} p-2 max-h-64 overflow-y-auto`}>
          <div className="grid grid-cols-6 gap-0.5">
            {options.map(n => (
              <button key={n} type="button" ref={n === value ? keepVisible : null}
                onClick={() => { setOpen(false); onPick(n); }}
                className={`h-8 rounded-md text-[12px] tabular-nums flex items-center justify-center transition-colors ${
                  n === value ? 'bg-accent text-white font-semibold' : 'text-fg hover:bg-surface-hover'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

// 책 칸 — 담당자 이름 칸과 같은 자동완성이다. 다른 점 하나: 여기서는 목록 밖 글자를
// 받지 않는다(성경 책은 66권으로 정해져 있다). 그래서 닫힐 때 고른 책 이름으로 되돌린다 —
// 칸에는 '요한'이 적혀 있는데 아래 장·절은 이사야인 어긋남이 남지 않게.
function BookInput({ books, book, onPick, onClear }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(book?.name || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => { setText(book?.name || ''); }, [book?.id, book?.name]);
  useDismiss(open, () => { setOpen(false); setText(book?.name || ''); }, [rootRef]);

  const suggestions = useMemo(() => {
    const q = text.replace(/\s+/g, '').toLowerCase();
    const all = books || [];   // 성경 순서를 그대로 둔다 — 가나다순으로 섞으면 못 찾는다
    if (!q) return all;
    return all.filter(b => String(b.name || '').toLowerCase().includes(q) || String(b.abbr || '').includes(q));
  }, [text, books]);

  const choose = (b) => { setText(b.name); setOpen(false); setActiveIdx(0); onPick(b.id); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setText(book?.name || ''); return; }
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[activeIdx] ?? suggestions[0]); }
  };

  return (
    <div className="worship-book relative shrink-0" ref={rootRef}>
      <div className={`${BOX} w-[8.5rem]`}>
        <input
          value={text} aria-label="본문 선택" placeholder="본문 선택"
          onChange={e => { setText(e.target.value); setOpen(true); setActiveIdx(0); if (!e.target.value.trim()) onClear(); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
        <ChevronDown size={12} className="text-fg-faint shrink-0" />
      </div>
      {open && suggestions.length > 0 && (
        <div className={`worship-book-list ${LIST} absolute left-0 top-full mt-1 w-max min-w-[8.5rem] max-w-[min(16rem,90vw)] max-h-56 overflow-y-auto p-1`}>
          {suggestions.map((b, i) => (
            <button key={b.id} type="button" onMouseDown={e => { e.preventDefault(); choose(b); }}
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${
                i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PassagePicker({ value, onChange }) {
  const [books, setBooks] = useState(null);
  const [pick, setPick] = useState(null);   // { bookId, c1, v1, c2, v2 }
  const [counts, setCounts] = useState(null); // 지금 책의 장별 절 수

  // 책 목록 + 적혀 있던 구절로 초기화. 못 읽는 구절이면 고르지 않은 상태로 둔다.
  useEffect(() => {
    let alive = true;
    loadBibleIndex().then(list => {
      if (!alive) return;
      setBooks(list);
      const ref = parseRef(value, list);
      if (ref) setPick({
        bookId: ref.bookId,
        c1: ref.start.chapter, v1: ref.start.verse || 1,
        c2: ref.end.chapter, v2: ref.end.verse || ref.start.verse || 1,
      });
    }).catch(() => { if (alive) setBooks([]); });
    return () => { alive = false; };
    // 처음 한 번만 — 뒤에 오는 value는 이 부품이 스스로 만든 값이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 책이 바뀌면 절 수를 받는다. 받는 동안에는 고른 절만 보여 준다(선택이 튀지 않게).
  useEffect(() => {
    let alive = true;
    setCounts(null);
    if (!pick?.bookId) return undefined;
    loadBook(pick.bookId)
      .then(b => { if (alive) setCounts((b.chapters || []).map(c => c.length)); })
      .catch(() => { if (alive) setCounts([]); });
    return () => { alive = false; };
  }, [pick?.bookId]);

  const book = useMemo(() => (books || []).find(b => b.id === pick?.bookId) || null, [books, pick?.bookId]);
  const versesIn = (ch) => (counts && counts[ch - 1]) || 0;

  // 끝은 시작보다 앞설 수 없고, 장을 옮기면 그 장에 없는 절 번호는 끌어내린다
  // (없는 번호가 남으면 고른 표시가 목록 밖으로 나간다).
  const cap = (ch, v) => (versesIn(ch) ? Math.min(v, versesIn(ch)) : v);
  const put = (patch) => {
    const next = { ...pick, ...patch };
    if (next.c2 < next.c1) next.c2 = next.c1;
    next.v1 = cap(next.c1, next.v1);
    next.v2 = cap(next.c2, next.v2);
    if (next.c1 === next.c2 && next.v2 < next.v1) next.v2 = next.v1;
    setPick(next);
    const ref = {
      bookId: next.bookId,
      start: { chapter: next.c1, verse: next.v1 },
      end: { chapter: next.c2, verse: next.v2 },
    };
    onChange(formatRef(ref, books));
  };

  const chooseBook = (id) => {
    setPick({ bookId: id, c1: 1, v1: 1, c2: 1, v2: 1 });
    onChange(formatRef({ bookId: id, start: { chapter: 1, verse: 1 }, end: { chapter: 1, verse: 1 } }, books));
  };
  const clearBook = () => { setPick(null); onChange(''); };

  // 절 수를 아직 모르면 고른 절 하나만 — 목록이 비면 고른 번호가 어디에도 없게 된다
  const verseOptions = (ch, cur) => (versesIn(ch) ? range(versesIn(ch)) : [cur]);

  return (
    <div className="worship-passage-pick flex flex-wrap items-center gap-1.5">
      <BookInput books={books} book={book} onPick={chooseBook} onClear={clearBook} />

      {/* 예전에 자유 표기로 적어 둔 구절('주보 특별 순서')은 파서가 못 읽는다 —
          고르기 전까지 그 글자를 그대로 보여 준다(모르는 사이에 지워지지 않게) */}
      {!pick && !!value && <span className="text-[12.5px] text-fg-muted">{value}</span>}

      {book && pick && (
        <>
          <span className="inline-flex items-center gap-1">
            <NumberPicker label="시작 장" value={pick.c1} suffix="장"
              options={range(book.chapters)} onPick={c => put({ c1: c, v1: 1 })} />
            <NumberPicker label="시작 절" value={pick.v1} suffix="절"
              options={verseOptions(pick.c1, pick.v1)} onPick={v => put({ v1: v })} />
          </span>
          <span className="text-[12px] text-fg-faint px-0.5">부터</span>
          <span className="inline-flex items-center gap-1">
            <NumberPicker label="끝 장" value={pick.c2} suffix="장"
              options={range(book.chapters).filter(c => c >= pick.c1)} onPick={c => put({ c2: c, v2: 1 })} />
            <NumberPicker label="끝 절" value={pick.v2} suffix="절"
              options={verseOptions(pick.c2, pick.v2).filter(v => pick.c2 > pick.c1 || v >= pick.v1)}
              onPick={v => put({ v2: v })} />
          </span>
          <span className="text-[12px] text-fg-faint px-0.5">까지</span>
        </>
      )}
    </div>
  );
}

// ── 본문 ─────────────────────────────────────────────────────────────────────
// 구절만 정하면 개역한글 데이터에서 본문이 붙는다(결정 4). 못 읽는 구절은 손대지 않고
// **적은 글자 그대로** 둔다 — 파서가 모르는 표기라고 해서 사람이 적은 것이 틀린 것은 아니다.
//
// 읽는 폭은 본문 열에만 준다(§3의 넓은 레이아웃과 별개다) — 1440px에 한 줄이
// 가로지르면 눈이 다음 줄 머리를 못 찾는다. 절 번호는 왼쪽 고정 칸이라 이어지는 줄이
// 번호 아래로 들어가지 않는다.
export function PassageBody({ refStr }) {
  const [verses, setVerses] = useState(null);
  useEffect(() => {
    let alive = true;
    setVerses(null);
    if (!refStr) return undefined;
    loadPassage(refStr)
      .then(p => { if (alive) setVerses(p?.verses?.length ? p.verses : []); })
      .catch(() => { if (alive) setVerses([]); });
    return () => { alive = false; };
  }, [refStr]);

  if (!refStr) return null;
  if (verses === null) return <p className="text-[12px] text-fg-faint py-2">본문을 받는 중</p>;
  if (!verses.length) return null;
  return (
    <div className="worship-passage mt-4 pt-4 max-w-[42rem]" style={{ borderTop: '1px solid var(--app-line)' }}>
      {verses.map((v, i) => (
        <React.Fragment key={`${v.chapter}:${v.verse}`}>
          {/* 장이 넘어가는 자리에만 장 표시 — 한 장짜리 본문에는 아무것도 붙지 않는다 */}
          {i > 0 && v.chapter !== verses[i - 1].chapter && (
            <p className="mt-3.5 mb-1.5 text-[11.5px] font-bold text-fg-muted tabular-nums">{v.chapter}장</p>
          )}
          <p className="worship-verse flex gap-2 py-[3px] text-[14px] leading-[1.85] text-fg-secondary">
            <span className="w-5 shrink-0 text-right text-[11px] font-bold text-fg-faint tabular-nums pt-[5px]">{v.verse}</span>
            <span className="min-w-0 break-words">{v.text}</span>
          </p>
        </React.Fragment>
      ))}
    </div>
  );
}
