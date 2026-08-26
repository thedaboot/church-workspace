import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CONFIG, teamPaint, teamColor } from '../config.js';
import { STATUS_BAR, STATUS_DOT_VAR } from '../views/dashboardParts.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useStore } from '../store/workspaceStore.js';
import { selectMembers } from '../store/selectors.js';
import { birthdayMap, birthdaysOn } from '../utils.js';
import { Avatar } from './Avatar.jsx';

// ============================================================================
// 프로젝트 캘린더 (보드와 나란히 놓이는 또 하나의 보기)
// ----------------------------------------------------------------------------
// 주 단위 행 구조: 각 주가 flex:1 / min-height:0 / overflow:hidden 이고,
// 행 안은 ① 배경 셀 7칸(클릭 타깃) ② 날짜 숫자 줄 ③ 띠 레인 순서의 세로 흐름이다.
// 띠를 날짜 위에 절대 배치로 얹으면 날짜가 가려지고 다음 주로 넘친다(핸드오프 경고).
// ============================================================================
// 12. UI Components (순수 프레젠테이션)
// ============================================================================
// 교회 달력이라 일요일은 '주일'로 표기한다.
const WEEKDAYS = ['주일', '월', '화', '수', '목', '금', '토'];
const CAL_LANES = 2;            // 주당 보여줄 띠 줄 수. 넘치면 그 날짜에 +N건
const CAL_MIN_YEAR = new Date().getFullYear();
const CAL_MAX_YEAR = 2030;

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoOf(d); };
const mdOf = (iso) => `${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;

// 업무 기간 — 시작일이 없으면 마감일 하루로 본다(핸드오프: 없으면 마감일 당일로 처리)
const spanOf = (t) => {
  const end = t.dueDate || t.startDate;
  const start = t.startDate || end;
  if (!end) return null;
  return start <= end ? { start, end } : { start: end, end: start };
};

// 한 주(일요일 시작) 안에서 겹치는 업무를 레인에 배치한다.
// 같은 업무가 그 주 내내 같은 줄에 있어야 띠가 끊기지 않는다.
function layoutWeek(weekStart, tasks, laneCount = CAL_LANES) {
  const weekEnd = addDays(weekStart, 6);
  const bars = [];
  tasks.forEach(t => {
    const s = spanOf(t);
    if (!s || s.end < weekStart || s.start > weekEnd) return;
    const from = s.start < weekStart ? weekStart : s.start;
    const to = s.end > weekEnd ? weekEnd : s.end;
    const col = Math.round((new Date(`${from}T00:00:00`) - new Date(`${weekStart}T00:00:00`)) / 86400000);
    const span = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
    bars.push({
      task: t, col, span,
      continued: s.start < weekStart,     // 지난 주에서 이어짐 → ↳ 접두사
      clippedRight: s.end > weekEnd,      // 다음 주로 이어짐 → 오른쪽 모서리 각지게
      sortKey: `${s.start}-${-span}`,
    });
  });
  bars.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const lanes = [];                        // lanes[i] = bar[]
  const overflowByCol = Array(7).fill(0);
  const overflowTasks = Array(7).fill(null);   // 칸마다 못 실린 업무들 — 팀색 점의 재료
  bars.forEach(bar => {
    let li = 0;
    while (li < laneCount) {
      const busy = (lanes[li] || []).some(b => bar.col < b.col + b.span && b.col < bar.col + bar.span);
      if (!busy) break;
      li++;
    }
    if (li >= laneCount) {
      for (let c = bar.col; c < bar.col + bar.span; c++) {
        overflowByCol[c]++;
        (overflowTasks[c] = overflowTasks[c] || []).push(bar.task);
      }
      return;
    }
    (lanes[li] = lanes[li] || []).push(bar);
  });
  return { lanes, overflowByCol, overflowTasks };
}

// ── 캘린더 ────────────────────────────────────────────────────────────────
// 주 단위 행 구조: 각 주가 flex:1 / min-height:0 / overflow:hidden 이고,
// 행 안은 ① 배경 셀 7칸(클릭 타깃) ② 날짜 숫자 줄 ③ 띠 레인 순서의 세로 흐름이다.
// 띠를 날짜 위에 절대 배치로 얹으면 날짜가 가려지고 다음 주로 넘친다(핸드오프 경고).
// onNewTask(iso)는 프로젝트 캘린더만 넘긴다 — 전체 일정에는 "어느 프로젝트에 만들지"가
// 없어서 버튼을 두지 않는다(ScheduleView는 이 prop을 넘기지 않는다).
export const CalendarBoard = React.memo(({ tasks, onTaskClick, onNewTask }) => {
  const isMobile = useIsMobile();
  // 생일도 달력에 얹는다(0019). 업무가 아니므로 건수에 세지 않고 띠 레인도 쓰지 않는다 —
  // 날짜 숫자 옆의 작은 얼굴과, 그 날 목록의 첫 줄로만 나온다. 그래야 "업무가 없는 날"이
  // 통째로 비어 보이지 않고, 띠 줄 수(CAL_LANES=2)를 생일이 잡아먹지도 않는다.
  const members = useStore(selectMembers);
  const bdays = React.useMemo(() => birthdayMap(members), [members]);
  const todayIso = isoOf(new Date());
  const [view, setView] = React.useState(() => {
    const d = new Date();
    return { y: Math.max(CAL_MIN_YEAR, Math.min(CAL_MAX_YEAR, d.getFullYear())), m: d.getMonth() };
  });
  const [selected, setSelected] = React.useState(todayIso);

  const first = new Date(view.y, view.m, 1);
  const gridStart = isoOf(new Date(view.y, view.m, 1 - first.getDay()));
  const weekCount = Math.ceil((first.getDay() + new Date(view.y, view.m + 1, 0).getDate()) / 7);
  const weekStarts = Array.from({ length: weekCount }, (_, i) => addDays(gridStart, i * 7));

  const monthPrefix = `${view.y}-${String(view.m + 1).padStart(2, '0')}`;
  const monthTasks = React.useMemo(() => (tasks || []).filter(t => {
    const s = spanOf(t);
    return s && (s.start.startsWith(monthPrefix) || s.end.startsWith(monthPrefix)
      || (s.start < monthPrefix && s.end > monthPrefix));
  }), [tasks, monthPrefix]);

  // 한 주 줄에 들어가는 띠 줄 수 — 창이 낮으면 2줄이 안 들어가 띠가 잘렸다.
  // 실제 줄 높이를 재서 1~CAL_LANES 사이로 정하고, 넘치는 건 '+N건'으로 남긴다.
  const gridRef = React.useRef(null);
  const [laneFit, setLaneFit] = React.useState(CAL_LANES);
  React.useEffect(() => {
    const el = gridRef.current;
    if (!el || isMobile) return;
    const calc = () => {
      const rowH = el.clientHeight / weekCount;
      // 날짜 줄 / 레인 위아래 여백(pt-1 + pb-0.5 = 6) / +N건 줄(10px leading-none + 2) / 띠(18)+간격(3)
      // 이 상수들은 아래 CSS와 한 쌍이다 — 실제보다 작게 잡으면 +N건이 줄 바닥에서 잘린다
      // (실제로 잘렸다: OVER를 14로 두고 +N건 줄은 15px를 차지했다).
      // 띠 16px + 간격 2px = LANE 18. 21이었을 때는 창 높이 745px에서 두 줄이
      // 안 들어가 laneFit이 1로 떨어졌다(사용자 화면 — "+2건만 나온다").
      const DATE = 22, PAD = 6, OVER = 12, LANE = 18;
      setLaneFit(Math.max(1, Math.min(CAL_LANES, Math.floor((rowH - DATE - PAD - OVER) / LANE))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weekCount, isMobile]);

  const weeks = React.useMemo(() => weekStarts.map(ws => ({ ws, ...layoutWeek(ws, tasks || [], laneFit) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, gridStart, weekCount, laneFit]);

  const canPrev = !(view.y === CAL_MIN_YEAR && view.m === 0);
  const canNext = !(view.y === CAL_MAX_YEAR && view.m === 11);
  const shift = (n) => () => setView(v => {
    const d = new Date(v.y, v.m + n, 1);
    const y = Math.max(CAL_MIN_YEAR, Math.min(CAL_MAX_YEAR, d.getFullYear()));
    return { y, m: d.getMonth() };
  });

  // 날짜 → 그 날 걸쳐 있는 업무. 한 번 만들어 두고 칸마다 꺼내 쓴다.
  // 예전에는 칸마다 목록 전체를 다시 filter해서, 모바일 달력(42칸)은 렌더마다
  // 42 × 전체 업무를 훑었다.
  const tasksByDate = React.useMemo(() => {
    const m = new Map();
    (tasks || []).forEach(t => {
      const s = spanOf(t);
      if (!s) return;
      // 구간이 비정상적으로 길면(잘못 입력된 연도 등) 시작·마감 이틀만 찍는다
      let iso = s.start;
      for (let i = 0; iso <= s.end && i < 400; i++) {
        const bucket = m.get(iso);
        if (bucket) bucket.push(t); else m.set(iso, [t]);
        iso = addDays(iso, 1);
      }
    });
    return m;
  }, [tasks]);
  const dayTasks = (iso) => tasksByDate.get(iso) || [];
  const selectedList = dayTasks(selected);

  // 요일 줄은 달력 칸과 폭이 같아야 한다 → 데스크톱에선 달력 열 안에 들어간다
  const weekdayHeader = (
    <div className="grid grid-cols-7 pb-1.5 shrink-0">
      {WEEKDAYS.map((w, i) => (
        <span key={w} className="text-[10.5px] font-bold text-center"
          style={{ color: i === 0 ? 'var(--app-tag-red-fg)' : i === 6 ? 'var(--app-tag-blue-fg)' : 'var(--app-ink-faint)' }}>{w}</span>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 상단: 이전/다음 붙은 쌍 + 연월 + 건수 + 상태 범례 */}
      <div className="flex items-center gap-2.5 pb-2 shrink-0 flex-wrap">
        <span className="flex rounded-[8px] overflow-hidden shrink-0" style={{ border: '1px solid var(--app-line)' }}>
          <button onClick={shift(-1)} disabled={!canPrev} title="이전 달"
            className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-surface-hover transition-colors disabled:opacity-30">
            <ChevronLeft size={15} />
          </button>
          <span className="w-px" style={{ background: 'var(--app-line)' }} />
          <button onClick={shift(1)} disabled={!canNext} title="다음 달"
            className="w-7 h-7 flex items-center justify-center text-fg-muted hover:bg-surface-hover transition-colors disabled:opacity-30">
            <ChevronRight size={15} />
          </button>
        </span>
        <h3 className="text-[14.5px] font-extrabold text-fg tabular-nums">{view.y}년 {view.m + 1}월</h3>
        <span className="text-[11.5px] text-fg-faint tabular-nums">{monthTasks.length}건</span>
        <span className="flex-1" />
        <span className="hidden sm:flex items-center gap-2.5">
          {CONFIG.STATUSES.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[10.5px] text-fg-muted">
              <span className="w-2 h-1 rounded-full" style={{ background: STATUS_BAR[s] }} />{s}
            </span>
          ))}
        </span>
      </div>

      {isMobile ? (
        <>
          {weekdayHeader}
          <MobileCalendar
            weekStarts={weekStarts} month={view.m} todayIso={todayIso} selected={selected} setSelected={setSelected}
            dayTasks={dayTasks} selectedList={selectedList} onTaskClick={onTaskClick}
            bdays={bdays} onNewTask={onNewTask}
          />
        </>
      ) : (
        // 데스크톱: 달력이 왼쪽, 고른 날 목록이 오른쪽.
        // 목록을 달력 아래에 두면 달력 높이를 빼앗아 띠가 잘렸다.
        <div className="flex-1 min-h-0 flex gap-5">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {weekdayHeader}
        <div ref={gridRef} className="flex-1 min-h-0 flex flex-col rounded-[10px] overflow-hidden shadow-soft"
          style={{ border: '1px solid var(--app-line)', background: 'color-mix(in srgb, var(--app-line) 55%, var(--app-ink-faint))' }}>
          {weeks.map(({ ws, lanes, overflowByCol, overflowTasks }, wi) => (
            <div key={ws} className="relative flex-1 min-h-0 overflow-hidden flex flex-col"
              style={{ borderTop: wi ? '1px solid color-mix(in srgb, var(--app-line) 55%, var(--app-ink-faint))' : 'none' }}>
              {/* ① 배경 셀 — 클릭 타깃 */}
              <div className="absolute inset-0 grid grid-cols-7" style={{ gap: 1 }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const iso = addDays(ws, i);
                  const inMonth = Number(iso.slice(5, 7)) === view.m + 1;
                  const isToday = iso === todayIso;
                  const isSel = iso === selected;
                  return (
                    <button key={iso} onClick={() => setSelected(iso)} aria-label={mdOf(iso)}
                      className="transition-colors"
                      style={{
                        background: isToday ? 'var(--app-accent-weak)' : isSel ? 'var(--app-surface-hover)'
                          : inMonth ? 'var(--app-surface)' : 'var(--app-canvas)',
                        boxShadow: isSel && !isToday ? 'inset 0 0 0 1.5px var(--app-accent)' : 'none',
                      }} />
                  );
                })}
              </div>
              {/* ② 날짜 숫자 */}
              <div className="relative grid grid-cols-7 pt-1.5 shrink-0 pointer-events-none" style={{ gap: 1 }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const iso = addDays(ws, i);
                  const inMonth = Number(iso.slice(5, 7)) === view.m + 1;
                  // 생일은 날짜 숫자 **옆**에 작은 얼굴로. 띠 레인에 넣지 않는 이유는
                  // 레인이 두 줄뿐이라(CAL_LANES) 생일이 업무 띠를 밀어내기 때문이다.
                  const bl = birthdaysOn(bdays, iso);
                  return (
                    /* gap-2: 날짜 숫자와 생일 얼굴 사이. 4px로 두었더니 숫자에 얼굴이
                       눌어붙어 보였다 — 원은 채워진 도형이라 글자보다 여백을 더 먹는다
                       (참고 링크 표시에서 같은 판단을 했다: 3px → 5px) */
                    <span key={iso} className="px-1.5 flex items-center gap-2 min-w-0">
                      <span className="text-[10.5px] font-semibold tabular-nums shrink-0"
                        style={{ color: inMonth ? 'var(--app-ink-muted)' : 'var(--app-ink-faint)' }}>
                        {Number(iso.slice(8, 10))}
                      </span>
                      {bl.slice(0, 2).map(p => (
                        <Avatar key={p.id || p.name} name={p.name} url={p.avatarUrl}
                          title={`${p.name}님 생일`}
                          className="flex w-[14px] h-[14px] text-[8px] -ml-[3px] first:ml-0 ring-1 ring-surface" />
                      ))}
                      {bl.length > 2 && (
                        <span className="text-[9px] text-fg-faint tabular-nums leading-none">+{bl.length - 2}</span>
                      )}
                    </span>
                  );
                })}
              </div>
              {/* ③ 띠 레인 — 레인 영역 자체는 클릭을 통과시킨다.
                  안 그러면 칸의 아래 절반이 이 div에 먹혀서 날짜가 한 번에 안 눌렸다.
                  띠와 '+N건'만 다시 클릭을 받는다. */}
              <div className="relative flex-1 min-h-0 flex flex-col gap-[2px] pt-1 pb-0.5 pointer-events-none">
                {Array.from({ length: laneFit }, (_, li) => (
                  <div key={li} className="grid grid-cols-7 shrink-0" style={{ gap: 1 }}>
                    {(lanes[li] || []).map(bar => (
                      <CalBar key={bar.task.id} bar={bar} onClick={() => onTaskClick(bar.task)} />
                    ))}
                  </div>
                ))}
                {overflowByCol.some(Boolean) && (
                  // leading-none + 고정 높이 — 글자 줄 높이(15px)가 laneFit 계산의 예약분을
                  // 넘어서 +N건이 줄 바닥에 반쯤 잘려 보였다. 계산 상수(OVER)와 한 쌍.
                  // '+N건' 글자만 있으면 일정이 있어도 빈 날처럼 읽혔다(사용자 지적) —
                  // 못 실린 업무의 **팀색 점**을 앞에 찍는다(모바일 달력과 같은 언어).
                  <div className="grid grid-cols-7 shrink-0 h-[12px]" style={{ gap: 1 }}>
                    {overflowByCol.map((n, i) => (
                      <span key={i} className="px-1.5">
                        {n > 0 && (
                          <button onClick={() => setSelected(addDays(ws, i))} title={`${n}건 더 — 눌러서 목록으로`}
                            className="pointer-events-auto flex items-center gap-[3px] text-[10px] leading-none font-semibold text-fg-faint hover:text-fg-muted transition-colors">
                            {(overflowTasks[i] || []).slice(0, 3).map((t, k) => (
                              <span key={k} className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: teamColor(t.teams?.[0]) }} />
                            ))}
                            +{n}
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
        {/* 고른 날의 목록 — 좁은 칸에서 못 읽는 제목·팀·기간을 여기서 읽는다.
            폭 316 = 내용 300 + 좌우 px-2. 줄이 hover 배경을 넓히려고 -mx-2로 8px씩
            넘치게 그려져(§6-9-d) 그대로 두면 **가로 스크롤바가 생겼다**(사용자 지적).
            모바일과 같은 처리 — 패딩만큼 상자를 키우고 음수 마진으로 자리는 그대로. */}
        <div className="w-[316px] -mx-2 px-2 shrink-0 min-h-0 overflow-y-auto overflow-x-hidden">
          <DaySheet iso={selected} list={selectedList} onTaskClick={onTaskClick} tight
            birthdays={birthdaysOn(bdays, selected)} onNewTask={onNewTask} />
        </div>
        </div>
      )}
    </div>
  );
});

// 기간 띠 한 조각. 이어지는 조각은 ↳ 를 붙이고 잘린 쪽 모서리를 각지게 한다.
function CalBar({ bar, onClick }) {
  const { task, col, span, continued, clippedRight } = bar;
  return (
    <button
      onClick={onClick} title={`${task.title} (${mdOf(spanOf(task).start)} ~ ${mdOf(spanOf(task).end)})`}
      className="pointer-events-auto min-w-0 h-[16px] px-1.5 flex items-center text-left hover:brightness-95 transition-[filter]"
      style={{
        gridColumn: `${col + 1} / span ${span}`,
        ...teamPaint(task.teams),
        borderTopLeftRadius: continued ? 2 : 4, borderBottomLeftRadius: continued ? 2 : 4,
        borderTopRightRadius: clippedRight ? 2 : 4, borderBottomRightRadius: clippedRight ? 2 : 4,
      }}
    >
      <span className="text-[10.5px] font-semibold truncate">{continued ? '↳ ' : ''}{task.title}</span>
    </button>
  );
}

// 모바일 캘린더 — 52px 고정 칸에 팀 색 점만 찍고, 날짜를 누르면 아래에 그날 목록
function MobileCalendar({ weekStarts, month, todayIso, selected, setSelected, dayTasks, selectedList, onTaskClick, bdays, onNewTask }) {
  // 격자와 목록을 **다른 스크롤 통**에 둔다. 한 통에 같이 두었더니 목록을 읽으려고
  // 미는 순간 달력이 위로 밀려 첫 주 줄이 잘렸다(사용자 지적) — 달력은 "지금 어디를
  // 보고 있나"를 알려주는 기준이라 목록을 볼 때도 자리에 있어야 한다.
  // 데스크톱이 달력 왼쪽·목록 오른쪽으로 갈라 둔 것과 같은 판단이다.
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 grid grid-cols-7 rounded-[10px] overflow-hidden shadow-soft"
        style={{ gap: 1, background: 'color-mix(in srgb, var(--app-line) 55%, var(--app-ink-faint))', border: '1px solid var(--app-line)', gridAutoRows: '52px' }}>
        {weekStarts.flatMap(ws => Array.from({ length: 7 }, (_, i) => {
          const iso = addDays(ws, i);
          const inMonth = Number(iso.slice(5, 7)) === month + 1;
          const isToday = iso === todayIso;
          const isSel = iso === selected;
          const list = dayTasks(iso);
          const bl = birthdaysOn(bdays, iso);
          return (
            <button key={iso} onClick={() => setSelected(iso)}
              className="flex flex-col items-center pt-1.5 gap-1 transition-colors"
              style={{
                background: isToday ? 'var(--app-accent-weak)' : isSel ? 'var(--app-surface-hover)'
                  : inMonth ? 'var(--app-surface)' : 'var(--app-canvas)',
                boxShadow: isSel && !isToday ? 'inset 0 0 0 1.5px var(--app-accent)' : 'none',
              }}>
              {/* 날짜 숫자 + 생일 얼굴. 52px 칸이라 한 명까지만 그리고 나머지는 +N —
                  칸을 넘기면 아래 점(업무)이 밀려 내려간다 */}
              <span className="flex items-center justify-center gap-[6px] min-w-0 px-0.5">
                <span className="text-[11px] font-semibold tabular-nums shrink-0"
                  style={{ color: inMonth ? 'var(--app-ink-muted)' : 'var(--app-ink-faint)' }}>{Number(iso.slice(8, 10))}</span>
                {bl.slice(0, 1).map(p => (
                  <Avatar key={p.id || p.name} name={p.name} url={p.avatarUrl}
                    className="flex w-[13px] h-[13px] text-[7.5px]" />
                ))}
                {bl.length > 1 && <span className="text-[8px] text-fg-faint leading-none tabular-nums">+{bl.length - 1}</span>}
              </span>
              <span className="flex items-center justify-center gap-[3px] flex-wrap px-1">
                {list.slice(0, 3).map(t => (
                  <span key={t.id} className="w-[5px] h-[5px] rounded-full" style={{ background: teamColor(t.teams?.[0]) }} />
                ))}
                {list.length > 3 && <span className="text-[8px] text-fg-faint leading-none">+{list.length - 3}</span>}
              </span>
            </button>
          );
        }))}
      </div>
      {/* overflow-x-hidden: 목록 줄이 -mx-2로 좌우 8px씩 넘치게 그려져 있어서
          (누르는 자리를 넓히려는 것) 그대로 두면 가로 스크롤이 생긴다. 이 줄에서
          가로로 볼 것은 없다 — 위아래로만 민다(사용자 지적). */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 -mx-2">
        <DaySheet iso={selected} list={selectedList} onTaskClick={onTaskClick}
          birthdays={birthdaysOn(bdays, selected)} onNewTask={onNewTask} />
      </div>
    </div>
  );
}

// 선택한 날의 목록 — 팀 레일 + 제목 + 팀·담당자·기간 + 상태 칩
function DaySheet({ iso, list, onTaskClick, tight = false, birthdays = [], onNewTask }) {
  return (
    <div className={`${tight ? '' : 'pt-3'} shrink-0`}>
      <div className="flex items-center gap-2 pb-2">
        <h4 className="text-[12.5px] font-bold text-fg">{Number(iso.slice(5, 7))}월 {Number(iso.slice(8, 10))}일</h4>
        <span className="text-[11px] text-fg-faint tabular-nums">{list.length}건</span>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        {/* 고른 날짜가 마감일로 들어간 새 업무 창을 연다 — 달력에서 날짜를 이미 골랐는데
            헤더의 '새 업무'로 가면 마감일을 다시 고르게 된다 */}
        {onNewTask && (
          <button type="button" onClick={() => onNewTask(iso)}
            className="shrink-0 text-[11px] font-semibold text-accent-text hover:underline transition active:scale-95">
            + 새 업무
          </button>
        )}
      </div>
      {/* 생일 줄이 먼저. 업무가 아니라 건수에 세지 않는다 — 대신 이 줄이 있으면
          '업무가 없어요'만 남는 빈 날이 사라진다(사용자 지적) */}
      {birthdays.map(p => (
        <div key={p.id || p.name} className="flex items-center gap-2.5 py-2">
          <Avatar name={p.name} url={p.avatarUrl} className="flex w-7 h-7 text-xs" />
          <span className="text-[13px] text-fg min-w-0 truncate">
            <span className="font-semibold">{p.name}</span>님 생일이에요
          </span>
        </div>
      ))}
      {list.length === 0
        ? (birthdays.length
            ? null
            : <p className="py-4 text-center text-[11px] text-fg-faint">해당 날짜에는 업무가 없어요</p>)
        : list.map((t, i) => {
          const s = spanOf(t);
          return (
            <button key={t.id} onClick={() => onTaskClick(t)}
              /* w-full+-mx-2는 왼쪽으로만 8px 밀린다(피드에서 잡은 함정 — §6-9-d) */
              className="dc-row w-[calc(100%+16px)] flex items-center gap-2.5 py-2 text-left hover:bg-surface-hover rounded-[8px] px-2 -mx-2 transition-colors border-t border-line/60 first-of-type:border-t-0"
              style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
              <span className="shrink-0 w-[3px] h-7 rounded-full" style={teamPaint(t.teams, true)} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-fg truncate">{t.title}</span>
                <span className="block text-[10.5px] text-fg-faint truncate">
                  {[t.teams?.join(', '), t.assignees?.join(', '), s && (s.start === s.end ? mdOf(s.end) : `${mdOf(s.start)} ~ ${mdOf(s.end)}`)]
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 inline-flex items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-[4px]"
                style={{ background: CONFIG.STATUS_BG_VAR[t.status] }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                <span className="text-[11px] font-semibold" style={{ color: CONFIG.STATUS_FG_VAR[t.status] }}>{t.status}</span>
              </span>
            </button>
          );
        })}
    </div>
  );
}
