import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Hash, Archive } from 'lucide-react';
import { store, useStore } from '../store/workspaceStore.js';
import { selectProjectsList, selectActiveProjectsList, selectArchivedProjectsList } from '../store/selectors.js';
import { projectYear } from '../utils.js';
import { useProjectYear, useYearOptions } from '../hooks/useProjectYear.js';
import { splitFrontTabs } from '../services/tabRank.js';
import { useTabFrontStats, useTabActivityRows } from '../services/tabFront.js';
import { useSeenBase, useOpenedProjects, markProjectOpened } from '../services/sinceSeen.js';
import { freshProjectIds } from '../services/traces.js';
import * as cloudSync from '../services/cloudSync.js';
import { showToast } from './Toast.jsx';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { usePopover } from '../hooks/usePopover.js';

// ============================================================================
// 프로젝트 탭 줄의 공용 부품 — 데스크톱 TopNav(layout.jsx)와 폰 MobileTopBar(mobileNav.jsx)가 같이 쓴다.
// 19차 묶음 D에서 layout.jsx에서 갈라 왔다(동작·모양은 그대로).
//   · 고른 해의 탭 목록(useYearTabs — 앞 칸 · 끌어올린 지금 프로젝트 · 그 해 보관함) · 연도 고르기(YearPicker)
//     · 더보기 연도 폴더(YearFolders) · 탭 폭 재기(useTabFit) · 탭 순서 저장(saveTabOrder — 데스크톱·폰 한 길)
//   · 앞 칸 세로선(TAB_DIVIDER) · 앞 칸 넛지(useFrontNudge·FrontNudge · PITFALLS 12-g·12-h) · 지난 방문 뒤의 점(FreshDot)
// YearPicker는 대시보드·모임 화면도 쓴다 — 그쪽은 layout.jsx의 재수출로 들인다.
// ============================================================================

// 활성 프로젝트는 언제나 탭에 보이게 — 6번째 프로젝트를 열었는데 탭에 아무것도
// 선택돼 있지 않으면 지금 어디 있는지 알 수 없다.
// max는 탭 줄 폭에서 잰 값이다(useTabFit) — 예전에는 고정 5라서 넓은 화면에서
// 자리가 남는데도 '더보기'로 밀어냈다.
export function splitProjectTabs(projectsList, activeMenu, max) {
  const shown = projectsList.slice(0, max);
  const active = projectsList.find(p => p.id === activeMenu);
  if (active && !shown.some(p => p.id === active.id)) shown[max - 1] = active;
  const shownIds = new Set(shown.map(p => p.id));
  return { shown, rest: projectsList.filter(p => !shownIds.has(p.id)) };
}

// 앞 칸과 나머지 사이의 얇은 세로선(데스크톱·폰 한 벌). 줄이 items-end라 self-center로 글자
// 높이에 맞춘다 — 점·라벨·안내 문구는 두지 않는다(사용자 결정 2026-09-25).
export const TAB_DIVIDER = 'shrink-0 self-center w-px h-4 mx-1 bg-line transition-colors duration-150';
// 넛지가 떠 있는 동안 세로선이 accent로 바뀐다(아래 앞 칸 넛지)
export const tabDividerCls = (hot) => (hot ? TAB_DIVIDER.replace('bg-line', 'bg-accent') : TAB_DIVIDER);

// ── 지난 방문 이후 남이 움직인 프로젝트의 옅은 점(사용자 결정 2026-09-25 · 목업 권장안) ──
// 탭 **왼쪽**에 5px accent 60%. 절대 위치라 탭 폭이 변하지 않는다 — useTabFit의 측정 줄은 그대로고,
// 오른쪽 위 얼굴(ViewerFaces)과도 겹치지 않는다. 숫자·글자 없음. 그 프로젝트를 열면 지운다
// (sinceSeen.markProjectOpened). 판정은 traces.freshProjectIds, 재료는 탭 앞 칸과 같은 줄(tabFront).
export const FreshDot = ({ className = 'left-[5px]' }) => (
  <span aria-hidden data-fresh-dot="" className={`absolute top-1/2 -mt-[2.5px] w-[5px] h-[5px] rounded-full bg-accent opacity-60 pointer-events-none ${className}`} />
);
export function useFreshProjects(activeMenu, isProject) {
  const rows = useTabActivityRows();
  const base = useSeenBase();
  const opened = useOpenedProjects();
  // 연 프로젝트는 들어갈 때와 나올 때 한 번씩 찍는다 — 보는 동안 생긴 움직임에 나온 뒤 점이 서지 않게
  useEffect(() => {
    if (!isProject) return undefined;
    markProjectOpened(activeMenu);
    return () => markProjectOpened(activeMenu);
  }, [activeMenu, isProject]);
  return useMemo(() => freshProjectIds(rows, base, opened, activeMenu), [rows, base, opened, activeMenu]);
}

// ── 앞 칸 넛지 N1 (사용자 결정 2026-09-25 · 목업 front-nudge 권장안) ──────────────
// 앞 칸 탭은 끌 수 없다(활동이 자리를 정한다). 왜 안 움직이는지 **헷갈리는 순간에만** 말풍선 하나:
//   · 앞 칸 탭을 끌려고 할 때(데스크톱 누른 채 움직임 · 폰 길게 누르기) → '최근 활발한 프로젝트'
//   · 뒤쪽 탭을 앞 칸 위로 가져갈 때 → '앞에 있는 프로젝트는 자동으로 조정돼요.'
//   · 데스크톱은 앞 칸 탭 hover에도 첫 말풍선 — **한 번이라도 본 브라우저에서는 hover로는 안 뜬다**
//     (브라우저 한 칸 `front_nudge_seen`). 끌 때는 언제나 뜬다.
// 2.5초 뒤 사라지고, 떠 있는 동안 세로선이 accent다. 늘 붙어 있는 안내 줄은 두지 않는다(CLAUDE.md).
// 떠 있는 것 규칙(§8): body 포털 + useAnchoredPos(가로·세로 가두기) · animate-in에는 transition-none.
// 앞 칸 탭은 draggable이 아니라 dragstart가 없다 — '끌려는 것'을 잡는 법은 PITFALLS 12-h, 폰은 12-g.
const NUDGE_MS = 2500;
const NUDGE_SEEN_KEY = 'front_nudge_seen';
export const nudgeSeen = () => { try { return localStorage.getItem(NUDGE_SEEN_KEY) === '1'; } catch { return false; } };
const markNudgeSeen = () => { try { localStorage.setItem(NUDGE_SEEN_KEY, '1'); } catch { /* 비공개 모드 */ } };
export const finePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function useFrontNudge() {
  const [nudge, setNudge] = useState(null);   // { el, kind: 'front'|'back', people }
  const timer = useRef(0);
  const cur = useRef(null);
  const show = useCallback((el, kind, people = 0) => {
    if (!el) return;
    // 같은 탭·같은 말이 이미 떠 있으면 그대로 둔다 — dragover는 쉬지 않고 오므로 매번 늘리면 안 사라진다
    if (cur.current && cur.current.el === el && cur.current.kind === kind) return;
    clearTimeout(timer.current);
    markNudgeSeen();
    cur.current = { el, kind, people };
    setNudge(cur.current);
    timer.current = setTimeout(() => { cur.current = null; setNudge(null); }, NUDGE_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [nudge, show];
}

export function FrontNudge({ nudge }) {
  const anchor = useRef(null);
  anchor.current = nudge?.el || null;
  const boxRef = useRef(null);
  const [pos] = useAnchoredPos(anchor, !!nudge, 260, 64, 6, boxRef, { align: 'start' });
  if (!nudge) return null;
  return createPortal(
    <div ref={boxRef} role="status" data-front-nudge={nudge.kind}
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
      className="z-[90] w-max max-w-[260px] bg-surface border border-line rounded-lg shadow-elevated px-2.5 py-2 text-[12px] leading-[1.45] text-fg-secondary pointer-events-none transition-none animate-in fade-in duration-150">
      {nudge.kind === 'front' ? (
        <>
          <b className="block font-bold text-fg">최근 활발한 프로젝트</b>
          <span className="block text-fg-muted">최근 7일 동안 {nudge.people}명이 보고 있어요</span>
        </>
      ) : (
        <span className="block text-fg-muted">앞에 있는 프로젝트는 자동으로 조정돼요.<br />이 프로젝트는 구분선 뒤에서 움직일 수 있어요.</span>
      )}
    </div>,
    document.body
  );
}

// 탭 줄에 몇 개가 들어가는지 실제 폭으로 잰다. 보이지 않는 측정 줄(measureRef)에
// 전체 탭 + '더보기' + '+ 프로젝트'를 같은 클래스로 그려 두고, 줄 폭 안에서
// "탭 k개 + (남는 게 있으면) 더보기 + '+ 프로젝트'"가 들어가는 최대 k를 고른다.
// 글자 폭 추정(폰트 상수 곱하기)으로 하지 않는 이유: 제목 길이가 제각각이라 반드시 어긋난다.
export function useTabFit(tabRowRef, measureRef, count, alwaysMore, withDivider = false) {
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const row = tabRowRef.current;
    if (!row) return;
    const calc = () => {
      const meas = measureRef.current;
      if (!meas) return;
      const kids = [...meas.children];              // [탭들…, 더보기, + 프로젝트]
      const tabW = kids.slice(0, count).map(el => el.offsetWidth);
      const moreW = kids[count]?.offsetWidth || 0;
      const plusW = kids[count + 1]?.offsetWidth || 0;
      const yearW = kids[count + 2]?.offsetWidth || 0;   // 줄 맨 앞의 연도 버튼(항상 있다)
      // 앞 칸과 나머지 사이의 세로선(tabRank.js) — 앞 칸이 있을 때만 선다. 넘쳐서 안 설 때도
      // 빼 두면 한 칸이 모자랄 수는 있어도 넘치지는 않는다.
      const divW = withDivider ? (kids[count + 3]?.getBoundingClientRect().width || 0) + 8 : 0;
      const cs = getComputedStyle(row);
      // -16: 측정 span과 실제 button 렌더 사이의 미세 오차(서브픽셀·보더) 여유.
      // 딱 맞는 경계(800px에 670px 탭)에서 몇 px 넘쳐 '+ 프로젝트'가 잘렸다.
      const avail = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - plusW - yearW - divW - 16;
      let used = 0, k = 0;
      for (let i = 0; i < count; i++) {
        const needMore = alwaysMore || i < count - 1;  // 이 뒤에 더보기가 서야 하나
        if (used + tabW[i] + (needMore ? moreW : 0) > avail) break;
        used += tabW[i]; k = i + 1;
      }
      setFit(Math.max(1, k));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(row);
    // 폰트(SUIT)가 늦게 로드되면 탭 폭이 바뀌는데 줄 폭은 그대로라 ResizeObserver가
    // 못 잡는다 — 로드 완료 시 한 번 다시 잰다. window resize도 같이 듣는다
    // (헤드리스 에뮬레이션처럼 RO 콜백이 걸러지는 환경의 안전망).
    document.fonts?.ready?.then(calc);
    window.addEventListener('resize', calc);
    return () => { ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [tabRowRef, measureRef, count, alwaysMore, withDivider]);
  return fit;
}

// 탭 순서 저장 — 데스크톱 드래그(네이티브 DnD)와 모바일 길게 눌러 끌기(dnd-kit)가
// **같은 경로**를 쓴다(0021의 projects.position). 순서대로 1부터 다시 매긴다.
// 보관된 프로젝트는 탭에 서지 않으므로 목록에 없고, 그래서 position도 안 건드린다 —
// 보관함은 연도·created_at으로 묶는다. 값이 겹쳐도 정렬 2차 키가 가른다.
export function saveTabOrder(orderedIds, allProjects, cloudMode) {
  const changed = [];
  orderedIds.forEach((pid, i) => {
    const p = allProjects.find(x => x.id === pid);
    if (p && (p.position ?? 0) !== i + 1) {
      store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: pid, position: i + 1 } });
      changed.push({ id: pid, position: i + 1 });
    }
  });
  if (cloudMode && changed.length) {
    cloudSync.projectOrderCloud(changed).catch(err => {
      console.error('[cloud] 탭 순서 저장 실패:', err);
      showToast('탭 순서를 저장하지 못했어요\n잠시 후 다시 시도해주세요');
    });
  }
}

// ── 연도 고르기 ────────────────────────────────────────────────────────────
// 프로젝트 탭 줄 앞의 `2026 ▾`. 고른 해의 프로젝트만 탭에 선다 — 해가 쌓일수록
// 탭 줄이 넘쳐서 '더보기'로 밀려나기만 하던 문제까지 같이 푼다.
// 연도는 projects.created_at에서 파생한다(연도 컬럼을 따로 두지 않는다 — 0014의 판단).
// 연도 규칙(값이 없는 옛 행은 만든 해로)은 **utils.projectYear 하나**다 — 대시보드의
// '프로젝트 진행'도 같은 값을 봐야 해서 옮겼다. 규칙이 두 벌이면 탭에는 있는
// 프로젝트가 대시보드에는 없는 해가 생긴다.
// 폴백이 원래 규칙이었고, 해가 바뀌기 전에 미리 만드는 프로젝트를 못 견뎌서 컬럼을
// 두게 됐다(2027 프로젝트 둘이 2026 폴더에 들어가 있었다 — 사용자 지적).

// 고른 해는 사람마다 다르고 서버가 알 필요가 없다 → useProjectYear(localStorage).
// 다른 해의 프로젝트를 열면(검색·알림·링크로) 그 해로 따라간다 — 안 그러면 지금
// 보고 있는 프로젝트가 탭 줄 어디에도 없어서 "어디 있는지" 표시가 사라진다.
function useTabYear(allProjects, activeMenu) {
  const { years, yearCounts } = useYearOptions(allProjects);
  const [year, pick] = useProjectYear();
  const activeYear = allProjects.find(p => p.id === activeMenu) ? projectYear(allProjects.find(p => p.id === activeMenu)) : null;
  useEffect(() => { if (activeYear && activeYear !== year) pick(activeYear); }, [activeYear]); // eslint-disable-line react-hooks/exhaustive-deps
  // 고른 해가 목록에 없으면(그 해 프로젝트를 다 지웠다) 가장 최근 해로 떨어진다.
  // **고쳐서 스토어에 되돌려 놓는다** — 예전에는 여기서만 갈아 끼웠는데, 지금은
  // 대시보드가 같은 스토어를 보므로 되돌리지 않으면 탭과 대시보드가 다른 해를 본다.
  // years에는 올해가 언제나 들어 있어서(위 set.add) 이 되돌림은 한 번에 멎는다.
  useEffect(() => { if (!years.includes(year)) pick(years[0]); }, [years, year, pick]);
  const safeYear = years.includes(year) ? year : years[0];
  return { year: safeYear, setYear: pick, years, yearCounts };
}

// 고른 해의 탭 목록 — 데스크톱 TopNav와 폰 MobileTopBar가 **같은 계산 한 벌**을 본다(예전에는 두 벌이었다).
//   yearList   고른 해의 보관하지 않은 프로젝트(position 순)
//   posSource  + 지금 보고 있는 것이 해가 달라 빠졌으면 끝에 한 번 끌어올린다 — 어디 있는지 표시가 화면에서
//              사라지면 안 된다. **한 번만 더한다**(갈래를 둘로 쓰면 보관된 것을 다른 해에서 열었을 때 같은 탭이
//              두 번 들어갔다 — navsmoke가 잡았다). 앞 칸 탭도 이 순서 안의 제자리를 지킨다(끌기 번호의 기준).
//   tabSource  앞 칸(services/tabRank.js — 최근 7일 여럿이 움직인 것 다섯까지 · 후보는 고른 해의 것뿐)을 맨 앞에 세운 순서.
//              숫자는 앱을 열 때·다시 보일 때만 새로 잰다(tabFront.js).
//   archivedForYear  고른 해의 보관 프로젝트(사용자 결정 2026-09-01 — 그 해 것만) · **지금 보고 있는 것은 뺀다**:
//              위에서 탭으로 끌어올렸으니 거기에도 두면 같은 프로젝트가 두 번 선다(실제로 그렇게 보였다).
// liftArchived — 보관된 지금 프로젝트도 posSource에 끌어올리나. 데스크톱은 그렇다. 폰은 아니다: 폰은 보관 탭을
//   **같은 줄 끝**에 이어 세우고(사용자 결정 2026-09-14) 지금 보는 보관 탭은 그 앞에 따로 한 번 넣는다(mobileNav).
export function useYearTabs(activeMenu, { liftArchived = true } = {}) {
  const activeList = useStore(selectActiveProjectsList);
  const archived = useStore(selectArchivedProjectsList);
  const allProjects = useStore(selectProjectsList);
  const project = allProjects.find(p => p.id === activeMenu) || null;
  const { year, setYear, years, yearCounts } = useTabYear(allProjects, activeMenu);
  const yearList = activeList.filter(p => projectYear(p) === year);
  const lift = project && (liftArchived || !project.archived) && !yearList.some(p => p.id === activeMenu);
  const posSource = lift ? [...yearList, project] : yearList;
  const frontStats = useTabFrontStats();
  const { front } = splitFrontTabs(yearList, frontStats);
  const frontIds = new Set(front.map(p => p.id));
  const tabSource = front.length ? [...front, ...posSource.filter(p => !frontIds.has(p.id))] : posSource;
  const archivedForYear = archived.filter(p => p.id !== activeMenu && projectYear(p) === year);
  return { allProjects, project, year, setYear, years, yearCounts, posSource, tabSource, front, frontIds, frontStats, archivedForYear };
}

// 연도 버튼 + 목록. 팝오버는 body 포털이 기본이다(§6-1).
export function YearPicker({ year, years, yearCounts = {}, onPick, compact = false }) {
  const pop = usePopover(112, 40 + years.length * 34);
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0">
      <span ref={pop.btnRef} className="inline-flex">
        <button onClick={pop.toggle} title="연도 고르기"
          className={`inline-flex items-center gap-1 -mb-px border-b-2 border-transparent text-[13px] font-semibold text-fg-muted hover:text-fg transition-colors tabular-nums ${compact ? 'px-2 pt-2.5 pb-2' : 'pl-0 pr-1.5 pt-2.5 pb-2'}`}>
          {year} <ChevronDown size={13} />
        </button>
      </span>
      {pop.panel('z-[90] bg-surface border border-line rounded-lg shadow-elevated p-1.5 max-h-72 overflow-y-auto',
        years.map(y => (
          <button key={y} onClick={() => { pop.close(); onPick(y); }}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] text-left tabular-nums transition-colors hover:bg-surface-hover ${y === year ? 'text-fg font-bold' : 'text-fg-muted'}`}>
            <span className="flex-1">{y}년</span>
            {/* 그 해 프로젝트 수 — 빈 해를 열어보고서야 아는 일이 없게 */}
            {yearCounts[y] > 0 && <span className="text-[10.5px] text-fg-muted">{yearCounts[y]}</span>}
          </button>
        )))}
    </span>
  );
}

// 더보기 = 연도 폴더 (사용자 결정 2026-08-24). 탭에 못 들어간 진행 중 프로젝트와
// 보관된 프로젝트를 같은 연도 아래에서 함께 본다 — 예전에는 '보관'해야만 연도로
// 묶여서, 지난 해 프로젝트를 찾으려면 먼저 보관부터 해야 했다.
// 2026-09-01부터는 **고른 해의 것만** 받는다(사용자 결정) — 그래서 사실상 폴더가
// 하나지만, 연도 머리글이 "이건 몇 년 것"을 말해 주므로 묶는 모양은 그대로 둔다.
// 연도는 projects.created_at에서 파생한다(연도 컬럼을 따로 두지 않는다).
// 보관된 것은 Archive 아이콘 + 흐린 글자로 가른다. 보관 해제는 열어서 이름 수정 창에서.
export function YearFolders({ active, archived, onPick }) {
  const yearOf = (p) => projectYear(p) || '연도 모름';
  const byYear = new Map();
  const put = (p, isArchived) => {
    const y = yearOf(p);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push({ p, isArchived });
  };
  active.forEach(p => put(p, false));
  archived.forEach(p => put(p, true));
  // 최신 연도 먼저, '연도 모름'은 맨 뒤(글자라 숫자보다 크게 정렬되는 것을 손으로 뺀다)
  const years = [...byYear.keys()].filter(y => y !== '연도 모름').sort((a, b) => b.localeCompare(a));
  if (byYear.has('연도 모름')) years.push('연도 모름');
  return (
    <>
      {years.map(year => (
        <div key={year}>
          <p className="px-2.5 pt-2 pb-0.5 text-[10px] font-bold text-fg-muted tabular-nums first:pt-1">{year}</p>
          {byYear.get(year).map(({ p, isArchived }) => (
            <button key={p.id} onClick={() => onPick(p.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] transition-colors text-left ${isArchived ? 'text-fg-faint hover:text-fg-muted' : 'text-fg-muted hover:text-fg'} hover:bg-surface-hover`}>
              {isArchived
                ? <Archive size={13} className="shrink-0" />
                : <Hash size={14} className="shrink-0 text-fg-faint" />}
              <span className="truncate">{p.title}</span>
              {isArchived && <span className="ml-auto shrink-0 text-[10px] text-fg-muted">보관됨</span>}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
