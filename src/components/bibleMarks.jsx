import { useState, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { loadBook } from '../services/bible.js';
import { SectionHead } from '../views/dashboardParts.jsx';
import { Skeleton } from './media.jsx';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { Hl, EmptyBookMark } from './bibleParts.jsx';

// ============================================================================
// 성경 읽기의 북마크 · 형광펜 목록 — [본문 | 북마크 | 형광펜] 세그먼트의 뒤 두 칸
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 wordBible.jsx에서 갈라 왔다. 고르는 것·지우는 것·여는 것은 부르는 쪽(BibleTab)이
// 정하고(onOpenItem·onRemoveItem), 여기는 책으로 묶고(groupByBook) 범위를 한 줄로 묶어(mergeRuns) 그린다.
// ============================================================================

// ── 북마크 · 형광펜 목록 ────────────────────────────────────────────────────
// 세그먼트로 고른 것 하나만 그린다(BibleTab 머리말). 누르면 그 자리로 간다 — 형광펜은
// 절까지 데려가고 그 절이 화면 가운데에 선다.
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

// 책별로 묶어 정경 순으로 돌려준다 — [{ book, items, count }].
// count는 **절(장) 수**다. items는 범위로 묶여 줄이 그보다 적을 수 있으므로(mergeRuns)
// 머리글의 '3절'은 items.length가 아니라 이 값으로 센다.
// 항목에 얹는 것: at = 파싱한 자리(bookId·chapter·verse) · stamp = 항목이 들고 있던 시각 ·
// to·refs = 이 줄이 품은 마지막 절 번호와 참조들(묶이지 않았으면 자기 하나뿐이다).
export function groupByBook(entries, books, parse, merge = false) {
  const bag = new Map();
  for (const e of entries) {
    const at = parse(e?.ref);
    if (!at) continue;
    if (!bag.has(at.bookId)) bag.set(at.bookId, []);
    bag.get(at.bookId).push({ ...e, at, stamp: String(e?.at || ''), to: at.verse, refs: [e.ref] });
  }
  // books가 곧 정경 순이다(index.json). 책 안에서는 장·절 순 — 읽는 차례와 같다.
  return books
    .filter(b => bag.has(b.id))
    .map(b => {
      const sorted = bag.get(b.id)
        .sort((x, y) => (x.at.chapter - y.at.chapter) || ((x.at.verse || 0) - (y.at.verse || 0)));
      return { book: b, items: merge ? mergeRuns(sorted) : sorted, count: sorted.length };
    });
}

// **한 번에 칠한 범위는 한 줄이다**(사용자 지시 2026-09-05 — "형광펜 범위로 칠했을 때,
// 형광펜 섹션에 절마다 죄다 들어가는 게 아니라 해당 범위가 형광펜 섹션에 들어가게").
// 저장 모양은 절 단위 { ref, at, color } 그대로다 — 리더의 marks·지우기·이어읽기가 모두
// 절 하나를 열쇠로 쓰므로 **보여줄 때만** 묶는다.
// 묶는 기준은 paintRange가 남긴 자취다: 그 함수는 범위의 모든 절에 **같은 at**을 찍으므로
// (장 · at · 색)이 같고 절 번호가 이어지면 그것이 곧 한 번의 손짓이다. 따로따로 칠한
// 이웃 절은 at이 달라 묶이지 않고, 범위의 일부를 덧칠하면 at이 갈려 저절로 둘로 쪼개진다.
// 들어오는 목록은 장·절 순으로 서 있어야 한다(groupByBook이 세워 준다).
function mergeRuns(items) {
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && prev.at.chapter === it.at.chapter && prev.stamp === it.stamp
      && (prev.color || '') === (it.color || '') && prev.to + 1 === it.at.verse) {
      prev.to = it.at.verse;
      prev.refs.push(it.ref);
      continue;
    }
    out.push({ ...it, refs: [...it.refs] });
  }
  return out;
}

const markRow = 'flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors';
// **북마크 줄은 눌리는 판이 보인다**(사용자 지적 2026-09-08 — "북마크 쪽에 여백이 너무
// 커서 어딜 눌러야 해당 북마크된 장으로 넘어갈 수 있을지가 안 잡힌다. 배경을 미세하게
// 넣어주든가"). 형광펜 줄은 절 미리보기가 줄을 채워서 누를 자리가 눈에 잡히는데,
// 북마크 줄은 '23장' 넉 자뿐이라 넓은 열에서 오른쪽이 통째로 비어 보였다. 옅은 판을
// 깔고 hover에서 한 단계 진해진다 — 값은 토큰이라 다크에서도 따라온다(§8).
const bookmarkRow = `${markRow} bg-surface-hover hover:bg-line`;

// 책 하나 — 머리글(개수) + 펼쳤을 때의 줄들. kind: 'bookmark' | 'highlight'
// onRemoveItem은 **참조 목록**을 받는다 — 범위로 묶인 줄은 절 여럿을 한꺼번에 지운다.
function MarkBookGroup({ book, items, count, kind, open, onToggle, onOpenItem, onRemoveItem }) {
  const [chapters, setChapters] = useState(null);   // 형광펜 미리보기용 절 본문
  const reduce = useReducedMotion();
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
        {/* 개수는 이름 **바로 옆**이다 — 오른쪽 끝에 붙이면 열이 넓어질수록 이름과 개수가
            멀어져 한 줄로 읽히지 않는다(폭 상한을 없앤 2026-09-03 회차) */}
        <span className="min-w-0 truncate text-[11.5px] font-bold text-fg">{book.name}</span>
        <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">
          {count}{kind === 'bookmark' ? '장' : '절'}
        </span>
        <span className="flex-1" />
      </button>

      {open && (
        // 줄 사이를 4px로 좁힌다 — 판이 깔린 줄은 붙어 있어야 '목록'으로 읽힌다
        <div className="pl-[18px] flex flex-col gap-1">
          {items.map(it => {
            const { chapter, verse } = it.at;
            // 범위로 묶인 줄은 '1:2~4'다(mergeRuns) — 절 하나면 그대로 '1:2'
            const span = it.to > verse ? `${chapter}:${verse}~${it.to}` : `${chapter}:${verse}`;
            const label = kind === 'bookmark'
              ? (it.label || `${book.name} ${chapter}장`)
              : `${book.name} ${span}`;
            // 형광펜 미리보기 한 줄. 아직 안 왔으면 자리만 잡아 둔다(오면서 밀지 않게).
            // 범위면 그 절들을 이어 붙인다 — 한 줄에 truncate로 잘려 앞머리만 보인다.
            const preview = needsText && chapters
              ? (chapters[chapter - 1] || []).slice(verse - 1, it.to).join(' ')
              : '';
            return (
              <span key={it.ref} className="flex items-center gap-0.5">
                <button data-goto={it.ref} onClick={() => onOpenItem(it.at)}
                  className={kind === 'bookmark' ? bookmarkRow : markRow}>
                  {kind === 'bookmark' ? (
                    <span className="block truncate text-[11.5px] font-semibold text-fg">{chapter}장</span>
                  ) : (
                    <span className="block truncate">
                      <span className="text-[11px] font-bold text-accent-text tabular-nums">{span}</span>
                      {/* 발췌는 리더에서 칠한 그 색으로 그린다 — 색이 곧 '무엇으로
                          칠했는지'다(색이 늘면 항목의 색 값을 그대로 넘긴다) */}
                      {needsText && !chapters
                        ? <span className="inline-flex align-middle ml-1.5 w-24 h-3"><Skeleton className="w-full h-full rounded-[3px]" /></span>
                        : <span className="ml-1.5 text-[11.5px]">{preview ? <Hl color={it.color}>{preview}</Hl> : ''}</span>}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRemoveItem(it.refs)}
                  aria-label={`${label} ${kind === 'bookmark' ? '북마크' : '형광펜'} 지우기`}
                  className="relative before:absolute before:-inset-y-0.5 before:-left-px before:-right-1 shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors"
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

// 한 칸(북마크 또는 형광펜) — 제목 · 총 개수 · 책 그룹들, 비었으면 마크와 한 줄.
// 책 묶음은 넓은 화면에서 여러 열로 선다 — 목록은 격자라 읽기 폭에 갇힐 이유가 없다.
export function MarkSection({ title, unit, empty, groups, total, kind, onOpenItem, onRemoveItem }) {
  // 사람이 직접 접거나 편 책만 남는다 — 나머지는 책 수에 따라 기본값을 따른다.
  // **열쇠에 kind를 넣는다.** 북마크와 형광펜은 같은 자리에 그려지는 같은 부품이라
  // 리액트가 칸을 옮겨도 이 state를 그대로 물려준다(§6-18과 같은 함정) — 형광펜에서 편
  // 창세기가 북마크에서도 펼쳐져 있었다. 칸 이름을 열쇠에 넣으면 갈리면서도 **각 칸의
  // 선택은 남는다**(리마운트로 지우면 오갈 때마다 접힘으로 되돌아간다).
  const [open, setOpen] = useState({});
  const auto = groups.length <= AUTO_OPEN_BOOKS;
  const isOpen = (id) => open[`${kind}:${id}`] ?? auto;

  return (
    <div data-col={kind} className="min-w-0">
      <SectionHead right={total
        ? <span className="text-[11px] text-fg-muted tabular-nums shrink-0">{total}{unit}</span> : null}>
        {title}
      </SectionHead>
      {!total ? (
        // 빈 칸은 남는 자리의 가운데에 마크와 함께 선다(§8). 표식은 SVG 선 그리기다 —
        // 캐릭터 컷은 홈에만 둔다(사용자 결정 2026-09-03).
        <div className="min-h-[38vh] flex flex-col items-center justify-center text-center">
          <EmptyBookMark />
          <p className="text-[13.5px] font-semibold text-fg mt-3">{empty}</p>
        </div>
      ) : (
        <div className="grid gap-x-7 items-start sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => (
            <MarkBookGroup
              key={g.book.id} book={g.book} items={g.items} count={g.count} kind={kind}
              open={isOpen(g.book.id)}
              onToggle={() => setOpen(o => ({ ...o, [`${kind}:${g.book.id}`]: !isOpen(g.book.id) }))}
              onOpenItem={onOpenItem} onRemoveItem={onRemoveItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
