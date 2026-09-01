import React, { useEffect, useMemo, useState } from 'react';
import { loadBibleIndex, loadBook, loadPassage } from '../services/bible.js';
import { parseRef, formatRef } from '../services/bibleRef.js';

// ============================================================================
// 주보의 본문 구절 — 범위 고르기(PassagePicker) · 본문 펼치기(PassageBody)
// ----------------------------------------------------------------------------
// 구절은 글자로 받지 않는다(사용자 결정 2026-09-01). 책을 고르고 시작 장:절 ~ 끝 장:절을
// 고르면 그 자리에서 본문이 아래에 펼쳐진다. **저장되는 값은 지금까지와 같은 문자열**
// (formatRef의 '이사야 32:9-20')이라 스키마도 읽는 쪽도 그대로다.
//
// 책 목록(장 수)은 index.json 하나로 오고, 절 수는 그 책 파일을 받아야 안다 —
// 책을 고른 뒤에 한 번 받고 캐시한다(services/bible.js가 캐시를 가진다).
//
// 못 읽는 구절('주보 특별 순서' 같은 자유 표기)은 손대지 않는다. 고르기 전에는 아무것도
// 내보내지 않으므로 예전에 적어 둔 글자가 조용히 지워지는 일이 없다.
// ============================================================================

const SEL = 'text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg';

const range = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);

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
  // (없는 번호가 남으면 select가 값을 잃는다).
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
    if (!id) { setPick(null); onChange(''); return; }
    setPick({ bookId: id, c1: 1, v1: 1, c2: 1, v2: 1 });
    onChange(formatRef({ bookId: id, start: { chapter: 1, verse: 1 }, end: { chapter: 1, verse: 1 } }, books));
  };

  // 절 수를 아직 모르면 고른 절 하나만 — 목록이 비면 select가 값을 잃는다
  const verseOptions = (ch, cur) => (versesIn(ch) ? range(versesIn(ch)) : [cur]);

  return (
    <div className="worship-passage-pick flex flex-wrap items-center gap-1.5">
      <select className={`${SEL} w-[7.5rem]`} aria-label="성경 책" value={pick?.bookId || ''}
        onChange={e => chooseBook(e.target.value)} disabled={!books}>
        <option value="">책 고르기</option>
        {(books || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>

      {/* 예전에 자유 표기로 적어 둔 구절('주보 특별 순서')은 파서가 못 읽는다 —
          고르기 전까지 그 글자를 그대로 보여 준다(모르는 사이에 지워지지 않게) */}
      {!pick && !!value && <span className="text-[12.5px] text-fg-muted">{value}</span>}

      {book && pick && (
        <>
          <span className="inline-flex items-center gap-1">
            <select className={`${SEL} w-[4.25rem]`} aria-label="시작 장" value={pick.c1}
              onChange={e => put({ c1: +e.target.value, v1: 1 })}>
              {range(book.chapters).map(c => <option key={c} value={c}>{c}장</option>)}
            </select>
            <select className={`${SEL} w-[4.25rem]`} aria-label="시작 절" value={pick.v1}
              onChange={e => put({ v1: +e.target.value })}>
              {verseOptions(pick.c1, pick.v1).map(v => <option key={v} value={v}>{v}절</option>)}
            </select>
          </span>
          <span className="text-[12px] text-fg-faint px-0.5">부터</span>
          <span className="inline-flex items-center gap-1">
            <select className={`${SEL} w-[4.25rem]`} aria-label="끝 장" value={pick.c2}
              onChange={e => put({ c2: +e.target.value, v2: 1 })}>
              {range(book.chapters).filter(c => c >= pick.c1).map(c => <option key={c} value={c}>{c}장</option>)}
            </select>
            <select className={`${SEL} w-[4.25rem]`} aria-label="끝 절" value={pick.v2}
              onChange={e => put({ v2: +e.target.value })}>
              {verseOptions(pick.c2, pick.v2).filter(v => pick.c2 > pick.c1 || v >= pick.v1)
                .map(v => <option key={v} value={v}>{v}절</option>)}
            </select>
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
