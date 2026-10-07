import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SectionHead, Card } from './dashboardParts.jsx';
import { loadBibleIndex } from '../services/bible.js';
import { fullRef } from '../services/bibleRef.js';
import { shortDayLabel, monthDays, shiftMonth, weekRange, fetchMyEntryDates, fetchScheduleRange } from '../services/word.js';
import { Swap } from '../components/bibleParts.jsx';

// ============================================================================
// 말씀 QT의 '내 기록' — 잔디(개인 전용 · 결정 10) + 그 달 묵상 목록
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 views/wordView.jsx에서 갈라 왔다. 보고 있는 달·그 달의 기록은 이 부품이 스스로 읽고,
// 부르는 쪽(QtTab)은 저장·삭제 뒤 reloadKey를 올려 "다시 읽어라"만 알린다.
// ============================================================================

// ── 내 기록 (잔디 — 개인 전용) ──────────────────────────────────────────────
// **칸을 잔디만큼 줄였다**(사용자 피드백 2026-09-02 4차 — "모바일과 아래쪽 뷰에서 너무
// 크다"). 예전에는 칸이 `aspect-square`라 폭을 나눠 가졌고, 모바일 전체 폭에서는 한 칸이
// 41px·1440px 옆 칸에서는 35px이었다 — 달력만큼 커져서 '기록 달력'이 아니라 달력으로
// 읽혔다. 칸을 고정 크기로 못 박으면 어느 폭에서도 같은 크기다.
//
// **날짜 숫자는 다시 들어왔다**(사용자 결정 2026-09-03 — "숫자가 있어도 좋을 것 같다,
// 살짝만 키워라"). 13px에는 숫자가 못 들어가서 20px로 올렸다 — 한 달이 158px(7×20 + 6×3)
// 이라 375px 화면에도 여유가 있고, 예전 41px의 절반이다. 요일 머리글·월 표시는 그대로
// 두고(숫자만으로는 무슨 요일인지 모른다) 칸마다 title·aria-label도 유지한다.
//
// **이전 달·다음 달로 넘길 수 있다**(2026-09-07). 이번 달만 보이면 지난 기록을 볼 길이
// 없었다. 보고 있는 달은 이 부품이 들고 있고(`view`), 그 달의 기록 날짜도 스스로 읽는다 —
// 한 번 읽은 달은 기억해 두므로 앞뒤로 넘나들 때 기다림이 없다. 저장·삭제가 있으면
// 부르는 쪽이 `reloadKey`를 올리고, 그때 보고 있는 달을 다시 읽는다(다른 달은 버린다).
// 다음 달 버튼은 **이번 달을 보고 있을 때 꺼진다** — 앞날의 기록은 있을 수 없다.
const WEEK_HEAD = ['일', '월', '화', '수', '목', '금', '토'];
const CELL = 20;   // px — 칸 한 변(숫자가 들어가는 최소 크기)
const GAP = 3;     // px — 칸 사이
const HEAD_H = 11; // px — 요일 머리글 한 줄(10px + pb-px · 최소 글자 10px — D9)
// 6주 짜리 달의 높이. 5주 달을 볼 때도 이만큼 잡아 두어야 달을 넘길 때 아래가 안 튄다
// (한 줄이 23px이라 9월 ↔ 8월에서 카드가 통째로 오르내렸다).
const GRID_MIN_H = HEAD_H + 6 * CELL + 6 * GAP;

const monthKey = (iso) => iso.slice(0, 7);
const NO_DATES = [];
const NO_REFS = {};
// 그 달 묵상 목록 — 일곱 줄까지 펴 두고 넘치면 'N건 더 보기'(목업 '지난 기록' 2번)
const MONTH_ROWS = 7;
// '2026-09-24' → '9. 24. 목'
const monthRowDate = (iso) => `${+iso.slice(5, 7)}. ${+iso.slice(8, 10)}. ${WEEK_HEAD[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;

export function Grass({ today, picked = '', onPick, reloadKey = 0 }) {
  const [view, setView] = useState(today);          // 보고 있는 달(그 달의 아무 날)
  const month = useMemo(() => monthDays(view), [view]);
  const [weekStart, weekEnd] = useMemo(() => weekRange(today), [today]);
  const key = monthKey(view);
  const thisMonth = monthKey(today);
  const isNow = key === thisMonth;

  // 이번 달 격자는 **이번 주가 걸친 만큼까지** 읽는다(달을 넘나드는 주가 있다).
  // 다른 달에는 '이번 주'라는 말이 없으므로 그 달만 읽는다.
  const first = month.days[0];
  const last = month.days[month.days.length - 1];
  const from = isNow && weekStart < first ? weekStart : first;
  const to = isNow && weekEnd > last ? weekEnd : last;

  // 달마다 한 번만 읽고 기억한다. 값을 달 열쇠로 들고 있으므로 **넘긴 첫 프레임에
  // 앞 달의 초록이 남지 않는다**(늦게 오는 값으로 덮는 방식이면 한 프레임 남는다).
  // 값은 [{ date, title }]다(제목이 같이 온다 — 아래 그 달 묵상 목록). 구절은 따로 읽는다(ref).
  const [byMonth, setByMonth] = useState({});
  const rows = byMonth[key]?.rows || NO_DATES;
  const refOf = byMonth[key]?.refs || NO_REFS;
  const dates = useMemo(() => rows.map(r => r.date), [rows]);
  const stale = useRef(false);
  useEffect(() => { stale.current = true; }, [reloadKey]);   // 저장·삭제 뒤에는 기억을 못 믿는다
  useEffect(() => {
    let alive = true;
    // 구절은 곁줄이다 — 못 읽으면 제목 없는 줄의 흐린 구절만 빈다(달력·문장은 그대로)
    // 읽기표는 약자로 저장되어 있다(0038) — 이 조회 안에서 한 번 책 이름 전체로 편다(§6-32-w와 같은 자리)
    Promise.all([
      fetchMyEntryDates(from, to),
      fetchScheduleRange(first, last).catch(() => []),
      loadBibleIndex().catch(() => null),
    ]).then(([v, sch, books]) => {
      if (!alive) return;
      const full = (ref) => (books ? fullRef(ref, books) : ref);
      const val = { rows: v, refs: Object.fromEntries(sch.map(r => [r.qt_date, full(r.passage_ref)])) };
      setByMonth(m => (stale.current ? { [key]: val } : { ...m, [key]: val }));
      stale.current = false;
    }).catch(() => {});
    return () => { alive = false; };
  }, [key, from, to, first, last, reloadKey]);

  const set = useMemo(() => new Set(dates), [dates]);
  // 그 달 묵상 — **최근 날짜부터** 한 줄씩(이번 주가 걸친 앞 달 날짜는 빼고 그 달 것만)
  const monthRows = useMemo(() => rows.filter(r => r.date >= first && r.date <= last)
    .sort((a, b) => b.date.localeCompare(a.date)), [rows, first, last]);
  const [allRows, setAllRows] = useState(false);
  useEffect(() => { setAllRows(false); }, [key]);   // 달을 넘기면 다시 접힌다
  const shownRows = allRows ? monthRows : monthRows.slice(0, MONTH_ROWS);
  const inMonth = month.days.filter(d => set.has(d)).length;
  const inWeek = dates.filter(d => d >= weekStart && d <= weekEnd).length;
  const navBtn = 'w-9 h-7 shrink-0 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover disabled:opacity-35 disabled:hover:bg-transparent transition active:scale-95';
  // 달이 바뀌는 결은 날짜를 넘길 때와 같다(Swap의 옆으로 슬라이드)
  const [dir, setDir] = useState(0);
  const goMonth = (n) => { setDir(n); setView(shiftMonth(view, n)); };
  return (
    // data-col: 검사(tests/word.mjs)가 이 칸이 자기 트랙을 다 쓰는지 잰다(§6-9-k)
    <div data-col="grass">
      <SectionHead right={
        <span className="flex items-center gap-0.5 shrink-0">
          {!isNow && (
            <button onClick={() => { setDir(view < today ? 1 : -1); setView(today); }}
              className="mr-1 shrink-0 px-2 h-7 rounded-md text-[11px] font-semibold text-accent-text bg-accent-weak transition active:scale-95">
              오늘
            </button>
          )}
          <button onClick={() => goMonth(-1)} aria-label="지난 달" className={navBtn}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-fg-muted tabular-nums whitespace-nowrap">{month.year}년 {month.month}월</span>
          {/* 앞날의 기록은 있을 수 없다 — 이번 달에서는 잠근다 */}
          <button onClick={() => goMonth(1)} aria-label="다음 달" disabled={isNow} className={navBtn}>
            <ChevronRight size={14} />
          </button>
        </span>
      }>
        내 기록
      </SectionHead>
      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* 6주 자리를 늘 잡아 둔다(GRID_MIN_H) — 5주 달과 6주 달의 높이가 다르면
              달을 넘길 때마다 카드가 통째로 오르내린다 */}
          <Swap k={key} dir={dir} className="shrink-0">
          <div className="grid content-start"
            style={{ gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP, minHeight: GRID_MIN_H }}>
            {WEEK_HEAD.map(w => (
              <span key={w} className="text-[10px] font-semibold text-fg-muted text-center leading-none pb-px">{w}</span>
            ))}
            {Array.from({ length: month.lead }, (_, i) => <span key={`b${i}`} />)}
            {month.days.map(d => {
              const has = set.has(d);
              return (
                <button
                  key={d} onClick={() => onPick(d)} title={shortDayLabel(d)} aria-label={shortDayLabel(d)}
                  className="rounded-xs flex items-center justify-center text-[10px] font-semibold tabular-nums leading-none transition active:scale-90"
                  style={{
                    width: CELL, height: CELL,
                    background: has ? 'var(--app-tag-green)' : 'var(--app-surface-hover)',
                    // 기록한 날은 초록 위의 짙은 초록, 안 한 날은 옅은 바닥 위의 무채색 —
                    // 10px이라 faint로 두면 안 읽힌다(대비를 한 단계 올렸다)
                    color: has ? 'var(--app-tag-green-fg)' : 'var(--app-ink-muted)',
                    opacity: d > today ? 0.45 : 1,
                    boxShadow: d === today ? 'inset 0 0 0 1.5px var(--app-accent)' : undefined,
                  }}
                >{+d.slice(8)}</button>
              );
            })}
          </div>
          </Swap>
          {/* '이번 주·이번 달'은 오늘이 든 달의 말이다 — 지난 달을 보고 있으면
              그 달의 이름으로 센다(8월 3번 기록했어요) */}
          <p className="flex-1 min-w-[9rem] text-[11.5px] text-fg-muted tabular-nums">
            {isNow
              ? `이번 주 ${inWeek}번, 이번 달 ${inMonth}번 기록했어요`
              : `${month.month}월 ${inMonth}번 기록했어요`}
          </p>
        </div>
        {/* 그 달 묵상 — 달력 **아래** 가는 선 하나 + 최근 날짜부터 한 줄씩(목업 '지난 기록' 2번 · 사용자 승인
            2026-09-25). 줄은 '날짜 · 제목'이고 제목이 비면 그 날 구절을 흐리게. 누르면 달력 칸과 같은 길(onPick)로
            그 날로 간다. 스트릭·숫자 강조는 없다(결정 10) — 위 문장이 그대로 수를 말한다. 기록이 없는 달은 줄째 없다. */}
        {monthRows.length > 0 && (
          <div data-qt-month="" className="mt-3 pt-1.5 border-t border-line">
            {shownRows.map((r, i) => {
              const ref = refOf[r.date] || '';
              return (
                <button key={r.date} type="button" data-qt-row={r.date} onClick={() => onPick(r.date)}
                  className={`w-full flex items-center gap-2.5 py-[7px] px-2 -mx-2 rounded-md text-left transition-colors hover:bg-surface-hover
                    ${r.date === picked ? 'bg-surface-hover' : ''}`}
                  style={{ width: 'calc(100% + 1rem)', borderTop: i ? '1px solid color-mix(in srgb, var(--app-line) 60%, transparent)' : undefined }}>
                  <span className="shrink-0 w-[52px] text-[11.5px] font-bold text-fg-muted tabular-nums">{monthRowDate(r.date)}</span>
                  {r.title
                    ? <span data-qt-row-title="" className="flex-1 min-w-0 truncate text-[12.5px] text-fg">{r.title}</span>
                    : <span data-qt-row-ref="" className="flex-1 min-w-0 truncate text-[12.5px] text-fg-muted">{ref}</span>}
                </button>
              );
            })}
            {/* 일곱 줄을 넘으면 그 자리에서 편다(마감 목록과 같은 말투) */}
            {!allRows && monthRows.length > MONTH_ROWS && (
              <button type="button" data-qt-more="" onClick={() => setAllRows(true)}
                className="mt-1 px-2 -mx-2 py-1.5 rounded-md text-[11.5px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors">
                {`${monthRows.length - MONTH_ROWS}건 더 보기`}
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
