import React, { useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ArrowDown, ChevronDown, SlidersHorizontal, Check } from 'lucide-react';
import { CONFIG, teamColor, teamPaint } from '../config.js';
import { mdDot, imeComposing } from '../utils.js';
import { isOverdue } from '../services/taskCounts.js';
import { STATUS_DOT_VAR, Bar } from '../views/dashboardParts.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { usePopover } from '../hooks/usePopover.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { usePresence } from '../hooks/useExit.js';
import { Avatar } from './Avatar.jsx';
import { StatusMenu } from './boards.jsx';
import { Segmented } from './segmented.jsx';
import {
  TABLE_COLS, PHONE_COL_CHOICES, PHONE_COLS_DEFAULT, sortTasks, nextSort, filterTasks, assigneesOf,
} from '../services/projectViews.js';

// ============================================================================
// 프로젝트 '표' 보기 (시안 mock/b3 · v5 2묶음 '업무 편의')
// ----------------------------------------------------------------------------
// 규칙(칸·정렬·걸러내기)은 services/projectViews.js(순수 · logcheck-dash). 팀은 프로젝트 화면의 팀 칩이 이미 거른다
// (tasks가 그 결과다) — 여기서 한 번 더 고르게 두면 같은 조건이 두 자리에 선다.
//   데스크톱 — 칸 전부 · 머리를 누르면 정렬(오름 → 내림 → 보드 차례) · 위 줄의 상태·담당자 고르기(usePopover) ·
//             줄을 누르면 업무 창 · 상태 칩은 보드와 같은 StatusMenu(줄을 열지 않는다).
//   폰 — **가로로 밀지 않는다**(§8) · 줄 = 제목 + 고른 두 칸 · 정렬·걸러내기·칸 고르기는 아래 시트 하나.
//        고른 두 칸은 이 브라우저에만 둔다(localStorage · 보는 사람마다의 편의).
// 정렬·걸러내기는 프로젝트를 옮기면 처음으로 돌아간다(ProjectView가 프로젝트마다 다시 선다).
// ============================================================================

const COL_LABEL = Object.fromEntries(TABLE_COLS);
const PHONE_COLS_KEY = 'table_phone_cols';
const readPhoneCols = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PHONE_COLS_KEY) || 'null');
    if (Array.isArray(v) && v.length === 2 && v.every(k => PHONE_COL_CHOICES.includes(k))) return v;
  } catch { /* 저장소가 막힌 브라우저 */ }
  return PHONE_COLS_DEFAULT;
};

// ── 칸 그리기 ────────────────────────────────────────────────────────────────
const Dash = () => <span className="text-fg-faint">–</span>;

function StatusCell({ task, onStatusChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const s = task.status;
  const chip = (
    <span className={`inline-flex items-center gap-1.5 ${compact ? 'pl-[6px] pr-[7px]' : 'pl-[7px] pr-[9px]'} py-[3px] rounded-xs whitespace-nowrap`}
      style={{ background: CONFIG.STATUS_BG_VAR[s] }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[s] }} />
      <span className="text-[11px] font-semibold" style={{ color: CONFIG.STATUS_FG_VAR[s] }}>{s}</span>
      {onStatusChange && !compact && <ChevronDown size={11} className="-mr-0.5" style={{ color: CONFIG.STATUS_FG_VAR[s] }} />}
    </span>
  );
  if (!onStatusChange || compact) return chip;
  return (
    <span ref={rootRef} className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <span ref={btnRef} className="inline-flex">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="rounded-xs transition active:scale-95 hover:brightness-95">{chip}</button>
      </span>
      <StatusMenu anchorRef={btnRef} rootRef={rootRef} open={open} onClose={close} current={s} align="start"
        onPick={(next) => onStatusChange(task, next)} />
    </span>
  );
}

function PeopleCell({ names = [], compact = false }) {
  if (!names.length) return <span className="text-fg-muted text-[11.5px]">미지정</span>;
  // 폰 칸(76px)에는 얼굴을 빼고 이름만 — 얼굴 둘에 이름까지 서면 '이하…'로 잘렸다
  if (compact) return <span className="text-[12px] text-fg-secondary truncate">{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="flex shrink-0">
        {names.slice(0, 2).map(n => (
          <Avatar key={n} name={n} className="flex w-[18px] h-[18px] text-[9px] -ml-[5px] first:ml-0 ring-[1.5px] ring-surface" />
        ))}
      </span>
      <span className="text-[12px] text-fg-secondary truncate">{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>
    </span>
  );
}

function TeamsCell({ teams = [] }) {
  if (!teams.length) return <Dash />;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: teamColor(teams[0]) }} />
      <span className="text-[12px] truncate" style={{ color: teamColor(teams[0]) }}>{teams[0]}</span>
      {teams.length > 1 && <span className="text-[11px] text-fg-muted tabular-nums shrink-0">+{teams.length - 1}</span>}
    </span>
  );
}

function SubCell({ list = [] }) {
  if (!list.length) return <Dash />;
  const done = list.filter(s => s.done).length;
  return (
    <span className="inline-flex items-center gap-2 min-w-0 w-full">
      <span className="flex-1 min-w-[28px] max-w-[64px]"><Bar ratio={done / list.length} color="var(--p-blue)" height={3} /></span>
      <span className="text-[11.5px] text-fg-muted tabular-nums shrink-0">{done}/{list.length}</span>
    </span>
  );
}

function DateCell({ task, k }) {
  const v = task[k];
  if (!v) return <Dash />;
  const late = k === 'dueDate' && isOverdue(task);
  return <span className={`text-[12px] tabular-nums whitespace-nowrap ${late ? 'text-tag-red-fg font-semibold' : 'text-fg-secondary'}`}>{mdDot(v)}</span>;
}

function Cell({ k, task, onStatusChange, compact }) {
  switch (k) {
    case 'status': return <StatusCell task={task} onStatusChange={onStatusChange} compact={compact} />;
    case 'teams': return <TeamsCell teams={task.teams} />;
    case 'assignees': return <PeopleCell names={task.assignees} compact={compact} />;
    case 'startDate': case 'dueDate': return <DateCell task={task} k={k} />;
    case 'subtasks': return <SubCell list={task.subtasks} />;
    default: return null;
  }
}

// 머리 칸 — 누르면 정렬. 고른 칸에만 화살표가 선다.
function HeadCell({ k, sort, onSort, className = '' }) {
  const on = sort?.key === k;
  const Arrow = on && sort.dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={() => onSort(k)} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`group/h inline-flex items-center gap-1 min-w-0 text-left text-[11px] font-bold transition-colors ${on ? 'text-fg' : 'text-fg-muted hover:text-fg'} ${className}`}>
      <span className="truncate">{COL_LABEL[k]}</span>
      <Arrow size={11} className={`shrink-0 ${on ? '' : 'opacity-0 pointer-fine:group-hover/h:opacity-60'}`} />
    </button>
  );
}

// ── 고르기 판(상태 · 담당자) — 데스크톱 위 줄의 칩 ─────────────────────────────
function PickList({ items, picked, onToggle }) {
  return (
    <div className="flex flex-col">
      {items.map(([v, label, dot]) => {
        const on = picked.includes(v);
        return (
          <button key={v || '_none'} type="button" onClick={() => onToggle(v)} aria-pressed={on}
            className={`flex items-center gap-2 px-2 py-[7px] text-[12.5px] rounded-md text-left transition-colors hover:bg-surface-hover ${on ? 'text-fg font-semibold' : 'text-fg-secondary'}`}>
            {dot}
            <span className="flex-1 min-w-0 truncate">{label}</span>
            <Check size={14} className={`shrink-0 text-accent-text ${on ? '' : 'invisible'}`} />
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({ label, count, children }) {
  const pop = usePopover(208, 260, { gap: 6, measure: true });
  return (
    <span ref={pop.rootRef} className="inline-flex">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={pop.toggle} aria-expanded={pop.open}
          className={`inline-flex items-center gap-1 h-7 pl-[10px] pr-2 rounded-md text-[12px] font-semibold border transition-colors ${count || pop.open ? 'border-accent bg-accent-weak text-accent-text' : 'border-line text-fg-muted hover:bg-surface-hover'}`}>
          {label}{count > 0 && <span className="tabular-nums"> · {count}</span>}
          <ChevronDown size={13} />
        </button>
      </span>
      {pop.panel('z-[90] bg-surface border border-line rounded-[10px] shadow-elevated p-1 max-h-[320px] overflow-y-auto', children)}
    </span>
  );
}

const statusItems = () => CONFIG.STATUS_PICK.map(s => [s, s,
  <span key="d" className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[s] }} />]);
const assigneeItems = (names) => names.map(n => [n, n || '미지정',
  n ? <Avatar key="a" name={n} className="flex w-[18px] h-[18px] text-[9px]" /> : <span key="a" className="w-[18px] h-[18px] rounded-full border border-dashed border-line shrink-0" />]);

const toggleIn = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

// ── 폰 아래 시트(정렬 · 상태 · 담당자 · 보이는 칸) ───────────────────────────────
// 고르기는 전부 같은 칩이다(목록 줄로 두면 담당자가 열 명만 돼도 시트가 화면 둘을 넘었다)
const SheetChip = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
    className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12.5px] font-semibold border transition-colors active:scale-95 ${on ? 'border-accent bg-accent-weak text-accent-text' : 'border-line text-fg-muted'}`}>
    {children}
  </button>
);
function TableSheet({ open, onClose, sort, setSort, statuses, setStatuses, assignees, setAssignees, names, cols, setCols }) {
  const sheetRef = useRef(null);
  const { shown, leaving } = usePresence(open);
  useDismiss(open, onClose, [sheetRef]);
  if (!shown) return null;
  const section = 'text-[12px] font-bold text-fg-muted pt-1';
  const pickCol = (k) => setCols(prev => (prev.includes(k) ? prev : [prev[1], k]));
  return createPortal(
    <div className={`fixed inset-0 z-[95] flex items-end bg-black/50 dc-scrim${leaving ? ' dc-out' : ''}`}>
      <div ref={sheetRef} role="dialog" aria-label="정렬·필터" data-table-sheet=""
        className={`w-full max-h-[86dvh] overflow-y-auto flex flex-col gap-3 px-5 pt-2.5 rounded-t-2xl bg-surface dc-sheet-up${leaving ? ' dc-out' : ''}`}
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        <span className="self-center w-9 h-1 rounded-full bg-line" />
        <b className="text-[16px] font-extrabold text-fg">정렬·필터</b>

        <p className={section}>보이는 칸</p>
        <div className="flex flex-wrap gap-1.5" data-sheet-cols="">
          {PHONE_COL_CHOICES.map(k => {
            const on = cols.includes(k);
            return (
              <SheetChip key={k} on={on} onClick={() => pickCol(k)}>{COL_LABEL[k]}</SheetChip>
            );
          })}
        </div>

        <p className={section}>정렬</p>
        <div className="flex flex-wrap gap-1.5">
          {TABLE_COLS.map(([k, label]) => {
            const on = sort?.key === k;
            return (
              <SheetChip key={k} on={on} onClick={() => setSort(on ? null : { key: k, dir: 'asc' })}>{label}</SheetChip>
            );
          })}
        </div>
        {sort && (
          <Segmented className="flex p-[3px] rounded-md self-start"
            items={[['asc', '오름차순'], ['desc', '내림차순']]} value={sort.dir}
            onPick={(dir) => setSort({ ...sort, dir })}
            btnClassName="px-3 py-[6px] rounded-sm text-[12.5px] font-semibold transition-colors" />
        )}

        <p className={section}>상태</p>
        <div className="flex flex-wrap gap-1.5">
          {CONFIG.STATUS_PICK.map(st => (
            <SheetChip key={st} on={statuses.includes(st)} onClick={() => setStatuses(p => toggleIn(p, st))}>
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: STATUS_DOT_VAR[st] }} />{st}
            </SheetChip>
          ))}
        </div>

        <p className={section}>담당자</p>
        <div className="flex flex-wrap gap-1.5">
          {names.map(n => (
            <SheetChip key={n || '_none'} on={assignees.includes(n)} onClick={() => setAssignees(p => toggleIn(p, n))}>{n || '미지정'}</SheetChip>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => { setSort(null); setStatuses([]); setAssignees([]); }}
            className="flex-1 h-11 rounded-[10px] text-[13.5px] font-semibold border border-line text-fg transition active:scale-95">초기화</button>
          <button type="button" onClick={onClose}
            className="flex-1 h-11 rounded-[10px] text-[13.5px] font-bold text-white bg-accent transition active:scale-95">확인</button>
        </div>
      </div>
    </div>, document.body);
}

// ── 표 ──────────────────────────────────────────────────────────────────────
export const TaskTable = React.memo(function TaskTable({ tasks, onTaskClick, onStatusChange }) {
  const isMobile = useIsMobile();
  const [sort, setSort] = useState(null);           // { key, dir } | null(보드 차례)
  const [statuses, setStatuses] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [cols, setColsState] = useState(readPhoneCols);
  const setCols = (fn) => setColsState(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    try { localStorage.setItem(PHONE_COLS_KEY, JSON.stringify(next)); } catch { /* 위와 같다 */ }
    return next;
  });

  const names = useMemo(() => assigneesOf(tasks), [tasks]);
  const rows = useMemo(() => {
    const shown = filterTasks(tasks, { statuses, assignees });
    return sort ? sortTasks(shown, sort.key, sort.dir) : shown;
  }, [tasks, statuses, assignees, sort]);
  const onSort = (k) => setSort(cur => nextSort(cur, k));
  const filtered = statuses.length + assignees.length + (sort ? 1 : 0);

  const empty = (
    <p className="py-10 text-center text-[12px] text-fg-muted">조건에 맞는 업무가 없어요</p>
  );

  if (isMobile) {
    const grid = { gridTemplateColumns: 'minmax(0,1fr) 76px 76px' };
    return (
      <div className="h-full min-h-0 flex flex-col" data-task-table="phone">
        <div className="flex items-center gap-2 pb-2 shrink-0">
          <span className="text-[11.5px] text-fg-muted tabular-nums">{rows.length}건</span>
          <span className="flex-1" />
          <button type="button" onClick={() => setSheet(true)} data-table-sheet-open=""
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-bold border transition-colors ${filtered ? 'border-accent bg-accent-weak text-accent-text' : 'border-line text-fg-muted'}`}>
            <SlidersHorizontal size={14} />정렬·필터{filtered > 0 && <span className="tabular-nums"> · {filtered}</span>}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-[10px] border border-line bg-surface">
          <div className="grid items-center gap-x-2 px-3 h-9 border-b border-line sticky top-0 bg-surface z-[1]" style={grid}>
            <HeadCell k="title" sort={sort} onSort={onSort} />
            {cols.map(k => <HeadCell key={k} k={k} sort={sort} onSort={onSort} />)}
          </div>
          {rows.length === 0 ? empty : rows.map((t, i) => (
            <button key={t.id} type="button" onClick={() => onTaskClick(t)} data-table-row=""
              className="dc-row w-full grid items-center gap-x-2 px-3 py-2.5 text-left border-b border-line/60 last:border-b-0 active:bg-surface-hover"
              style={{ ...grid, animationDelay: `${Math.min(i, 12) * 22}ms` }}>
              <span className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-[3px] h-6 rounded-full" style={teamPaint(t.teams, true)} />
                <span className="text-[13px] font-semibold text-fg truncate">{t.title}</span>
              </span>
              {cols.map(k => <span key={k} className="min-w-0 flex">{<Cell k={k} task={t} compact />}</span>)}
            </button>
          ))}
        </div>
        <TableSheet open={sheet} onClose={() => setSheet(false)} sort={sort} setSort={setSort}
          statuses={statuses} setStatuses={setStatuses} assignees={assignees} setAssignees={setAssignees}
          names={names} cols={cols} setCols={setCols} />
      </div>
    );
  }

  const grid = { gridTemplateColumns: 'minmax(220px,2.4fr) 112px minmax(110px,1fr) minmax(120px,1.1fr) 76px 76px 130px' };
  return (
    <div className="h-full min-h-0 flex flex-col" data-task-table="desk">
      <div className="flex items-center gap-1.5 pb-2.5 shrink-0">
        <FilterChip label="상태" count={statuses.length}>
          <PickList items={statusItems()} picked={statuses} onToggle={(v) => setStatuses(p => toggleIn(p, v))} />
        </FilterChip>
        <FilterChip label="담당자" count={assignees.length}>
          <PickList items={assigneeItems(names)} picked={assignees} onToggle={(v) => setAssignees(p => toggleIn(p, v))} />
        </FilterChip>
        {(statuses.length > 0 || assignees.length > 0) && (
          <button type="button" onClick={() => { setStatuses([]); setAssignees([]); }}
            className="ml-1 text-[11.5px] font-semibold text-accent-text hover:underline">초기화</button>
        )}
        <span className="flex-1" />
        <span className="text-[11.5px] text-fg-muted tabular-nums">{rows.length}건</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-[10px] border border-line bg-surface shadow-soft">
        <div role="row" className="grid items-center gap-x-3 px-4 h-9 border-b border-line sticky top-0 bg-surface z-[1]" style={grid}>
          {TABLE_COLS.map(([k]) => <HeadCell key={k} k={k} sort={sort} onSort={onSort} />)}
        </div>
        {rows.length === 0 ? empty : rows.map((t, i) => (
          <div key={t.id} role="row" tabIndex={0} onClick={() => onTaskClick(t)} data-table-row=""
            onKeyDown={(e) => { if (imeComposing(e)) return; if (e.key === 'Enter' && e.target === e.currentTarget) onTaskClick(t); }}
            className="dc-row grid items-center gap-x-3 px-4 min-h-[44px] py-1.5 cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-surface-hover transition-colors outline-none focus-visible:bg-surface-hover"
            style={{ ...grid, animationDelay: `${Math.min(i, 12) * 22}ms` }}>
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="shrink-0 w-[3px] h-6 rounded-full" style={teamPaint(t.teams, true)} />
              <span className="text-[13px] font-semibold text-fg truncate">{t.title}</span>
            </span>
            {TABLE_COLS.slice(1).map(([k]) => <span key={k} className="min-w-0 flex"><Cell k={k} task={t} onStatusChange={onStatusChange} /></span>)}
          </div>
        ))}
      </div>
    </div>
  );
});
