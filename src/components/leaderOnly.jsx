import { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Plus } from 'lucide-react';
import { usePopover } from '../hooks/usePopover.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { usePresence } from '../hooks/useExit.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { ShareSwitch } from './bibleParts.jsx';
import { Segmented } from './segmented.jsx';
import { Avatar } from './Avatar.jsx';
import { BTN_CONFIRM_QUIET } from './buttons.js';
import { FIELD } from './groupsParts.jsx';
import { CONFIG, teamLine } from '../config.js';
import { LEADERS, CUSTOM, isLeaderOnly, isCustomOnly, isRestricted, canSetVisibility, toggleViewerTeam } from '../services/visibility.js';
import { store, useStore } from '../store/workspaceStore.js';
import { selectMembers } from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import * as cloudSync from '../services/cloudSync.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';

// ============================================================================
// 리더만 보는 프로젝트(0092) — '리더만' 칩 · 자물쇠 버튼 + 토글 팝오버 (2026-10-12 시안 승인)
// ----------------------------------------------------------------------------
// 칩은 두 자리에 같은 모양으로 선다: 데스크톱 프로젝트 제목 옆(projectView) ·
// 업무 창 머리(modals — 프로젝트 것을 물려받는다 · 업무마다 따로 켜지 않는다). accent-weak 바탕 + 자물쇠 + 글자.
// 폰 상단바 제목은 칩 대신 **제목 앞 자물쇠 하나**(LeaderTitleLock · 탭 줄과 같은 표시 · 시안 승인 2026-10-14) —
// 칩이 좁은 폰에서 제목 자리를 먹어 '더다…'까지 잘렸다(PITFALLS 51-b). 누르면 아래와 같은 `리더만 보기` 팝오버.
// 자물쇠 버튼은 프로젝트 머리의 공유·삭제 묶음 **앞**에, 리더에게만 선다(게스트는 언제나 · visibility.js).
// 누르면 팝오버에 `리더만 보기` 라벨 + 토글 한 줄뿐이다(설명 줄 없음 · 폭은 내용만큼 — `!w-max`가 판 폭을 이긴다).
// 켜져 있으면 버튼도 accent-weak로 서서 상태가 보인다. 실제 경계는 DB다(0092 정책) — 여기는 그리기만.
// 저장(useSetVisibility)도 여기 한 벌 — 프로젝트 머리와 폰 상단바가 같이 쓴다.
//
// ── 보는 사람 직접 선택(v5 B · 시안 승인 2026-10-17 · 0105) ──
// 판이 `보는 사람` + 세 칸(모두 · 리더만 · 직접 선택 — Segmented)이 된다. 직접 선택이면 팀 칩이 먼저 서고, 칩을 누르면
// 그 팀 사람이 아래에 **다 체크된 채** 펼쳐진다(사람마다 뺄 수 있다 · 나는 못 뺀다). 다른 팀 사람은 이름 칸으로 추가한다(별도로 추가한 사람).
// 고를 때마다 곧바로 저장한다(토글과 같은 결 — 확정 버튼 없음). 값은 프로젝트의 viewers·viewerTeams(services/visibility.js).
// 데스크톱은 같은 자물쇠 팝오버를 넓혀서(312px · .dc-pop · 아래 남은 높이에 맞춰 고정), 폰은 보이는 창 안의 아래 시트(.dc-sheet-up + .dc-scrim · 닫힘은 .dc-out).
// 칩 자리(데스크톱 제목 옆 · 업무 창 머리)는 '리더만' 칩과 같은 알약에 자물쇠 + 얼굴 셋 + 'N명'.
// 사람 목록은 스토어의 members(클라우드 · 게스트는 비어 있어 나 한 사람뿐이다 — 스위트는 members를 심는다).
// 이 판은 직접 선택을 쓸 수 있을 때만 선다 — 클라우드는 0105를 읽었을 때(viewersReady · 마이그레이션 전이면 위 토글 그대로), 게스트는 언제나.
// 클라우드의 실제 경계는 DB다(0105 — project_viewers + 마스터 · hidden_ids). 저장은 set_project_viewers 한 번(cloudSync).
// ============================================================================

// 보는 사람 바꾸기(0092) — 바꿀 수 없는 사람이면 null(자물쇠 버튼·팝오버를 세우지 않는다).
// **낙관적으로 먼저 바꾸지 않는다** — 누가 보느냐는 저장된 값이 곧 화면의 사실이다(참고 링크 비밀번호와
// 같은 순서). 클라우드는 서버가 돌려준 값(리더가 아니면 트리거가 옛 값으로 되돌린다)을 그대로 쓴다.
// 누가·언제(visibilityBy·visibilityAt · 0099)도 같이 적는다 — 화면 문구는 없다. 클라우드는 DB 트리거가 적은 값을 받고,
// 게스트는 로컬에 이름과 시각을 적는다(바뀔 때만 — 같은 값을 다시 누르면 옛 기록 그대로).
// next: 'all' | 'leaders' | { visibility: 'custom', viewers(이름), viewerTeams } — 클라우드도 같은 모양을 받는다(cloudSync.projectVisibilityCloud)
export function useSetVisibility(project) {
  const { enabled, session } = useAuth();
  const cloudOn = enabled && !!session;
  // 나는 리더인가(0092 · cloudSync.loadCloudState) — 게스트 스토어에는 이 칸이 없고 자물쇠는 언제나 선다
  const amLeader = useStore(s => s.amLeader);
  if (!project || !canSetVisibility({ cloudOn, amLeader })) return null;
  return async (next) => {
    const want = typeof next === 'string' ? next : next?.visibility;
    try {
      const changed = want !== (project.visibility || 'all');
      const saved = cloudOn ? await cloudSync.projectVisibilityCloud(project.id, next)
        : { visibility: want,
          ...(want === CUSTOM ? { viewers: next.viewers || [], viewerTeams: next.viewerTeams || [] } : {}),
          ...(changed ? { visibilityBy: store.getState().currentUser?.name || null, visibilityAt: new Date().toISOString() } : {}) };
      store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, ...saved } });
    } catch (err) {
      const what = '보는 사람을 바꾸지 못했어요';
      console.error(`[cloud] ${what}:`, cloudSync.formatCloudError(err), err);
      showToast(failText(what, err));
    }
  };
}

// small — 업무 창 머리(10.5px) / 기본 — 데스크톱 제목 옆(11px)
// 직접 고른 사람만(0105)이면 같은 알약에 자물쇠 + 얼굴 셋 + 'N명'(누가 보는지 한눈에 · 이름은 title로)
export function LeaderChip({ project, small = false, className = '' }) {
  if (isCustomOnly(project)) return <ViewersChip project={project} small={small} className={className} />;
  if (!isLeaderOnly(project)) return null;
  return (
    <span data-leader-chip="" className={`inline-flex items-center shrink-0 rounded-full bg-accent-weak text-accent-text font-bold whitespace-nowrap ${
      small ? 'gap-[3px] pl-[5px] pr-[7px] py-[2px] text-[10.5px]' : 'gap-1 pl-[7px] pr-[9px] py-[3px] text-[11px]'} ${className}`}>
      <Lock size={small ? 10 : 11} strokeWidth={2.5} className="shrink-0" aria-hidden />리더만
    </span>
  );
}

function ViewersChip({ project, small, className }) {
  const names = project.viewers || [];
  const face = small ? 'w-[14px] h-[14px] text-[7.5px]' : 'w-4 h-4 text-[8px]';
  return (
    <span data-viewers-chip="" title={names.join(', ')}
      className={`inline-flex items-center shrink-0 rounded-full bg-accent-weak text-accent-text font-bold whitespace-nowrap tabular-nums ${
        small ? 'gap-[3px] pl-[5px] pr-[7px] py-[1px] text-[10.5px]' : 'gap-1 pl-[7px] pr-[9px] py-[2px] text-[11px]'} ${className}`}>
      <Lock size={small ? 10 : 11} strokeWidth={2.5} className="shrink-0" aria-hidden />
      <span className="inline-flex items-center mx-px">
        {names.slice(0, 3).map(n => <Avatar key={n} name={n} className={`flex ${face} -ml-[4px] first:ml-0 ring-[1.5px] ring-accent-weak`} />)}
      </span>
      {names.length}명
    </span>
  );
}

// 탭 줄 자물쇠(20차 ⑥ · 시안 '프로젝트 탭줄(리더에게)') — 리더 프로젝트 탭 이름 앞 10px. 색은 탭 글자를 따른다
// (currentColor — 켜진 탭은 진하게 · 꺼진 탭은 muted · 보관은 faint). 데스크톱 탭과 그 폭 재기 줄 · 더보기 연도 폴더 · 폰 탭 줄.
// 글자 줄 안의 inline-block이다(감싸는 flex를 두지 않는다 — 폰 보관 탭의 Archive 아이콘과 같은 이유 · §6-9-bu).
// 직접 고른 사람만(0105)도 같은 자물쇠다.
export function TabLock({ project, className = '' }) {
  if (!isRestricted(project)) return null;
  return <Lock size={10} strokeWidth={2.6} data-tab-lock="" aria-hidden className={`inline-block shrink-0 align-[-1px] mr-[5px] ${className}`} />;
}

// 자물쇠 하나에 붙는 `리더만 보기` 팝오버 한 벌 — 프로젝트 머리 자물쇠와 폰 상단바 제목 자물쇠가 같이 쓴다.
// onSet(next) → 약속. 실패하면 useSetVisibility가 토스트를 띄우고 값은 그대로다(저장된 것만 비춘다 — 낙관적으로 먼저 뒤집지 않는다).
// 직접 선택을 쓸 수 있으면 판이 `보는 사람` 세 칸으로 넓어지고, 폰에서는 아래 시트로 뜬다(머리말).
function useLeaderSwitch(project, onSet) {
  const { enabled, session } = useAuth();
  // 직접 선택을 쓸 수 있나 — 클라우드는 0105를 읽었을 때(cloudSync.loadCloudState viewersReady), 게스트는 언제나(로컬 값)
  const viewersReady = useStore(s => s.viewersReady === true);
  const pick = enabled && !!session ? viewersReady : true;
  const isMobile = useIsMobile();
  const sheet = pick && isMobile;
  // 고르기 판은 아래에 남은 높이(fit · 위 한계 560)까지만 — 직접 고르기에서는 그 높이로 **고정**해서 사람이 늘고 줄어도
  // 판이 커졌다 작아지거나 위로 밀려 올라가지 않는다(구르는 것은 판 안의 가운데 칸 하나 · 시안 2차 2026-10-16)
  const pop = usePopover(pick ? 312 : 140, pick ? PICK_MAX_H : 40, { gap: 8, measure: true, fit: pick });
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef(null);
  useDismiss(sheetOpen, () => setSheetOpen(false), [sheetRef]);
  const { shown: sheetShown, leaving: sheetLeaving } = usePresence(sheetOpen);
  const [busy, setBusy] = useState(false);
  const on = isLeaderOnly(project);
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSet(on ? 'all' : LEADERS); } finally { setBusy(false); }
  };
  const open = sheet ? sheetOpen : pop.open;
  const toggle = sheet ? () => setSheetOpen(o => !o) : pop.toggle;
  const panel = () => {
    if (!pick) return pop.panel('z-[90] !w-max bg-surface border border-line rounded-lg shadow-elevated py-[9px] pl-3.5 pr-3', (
      <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={flip} data-leader-switch=""
        className={`inline-flex items-center gap-3 text-[12.5px] font-bold text-fg whitespace-nowrap ${busy ? 'opacity-60' : ''}`}>
        리더만 보기<ShareSwitch on={on} />
      </button>
    ));
    if (!sheet) return pop.panel('z-[90] flex flex-col overflow-hidden bg-surface border border-line rounded-[10px] shadow-elevated',
      <ViewersPicker project={project} onSet={onSet} />,
      isCustomOnly(project) && pop.pos.maxHeight ? { height: Math.min(PICK_MAX_H, pop.pos.maxHeight) } : null);
    if (!sheetShown) return null;
    // 폰 시트는 **보이는 창(--app-vh · App.jsx)** 안에 선다 — 업무 창과 같은 길이다(inset-0이면 키보드가 올라와도 시트 바닥이
    // 키보드 밑에 남아 '이름으로 추가하기' 칸이 가렸다). 칸에 초점이 가면 App의 커서 따라가기가 시트 가운데 칸(하나뿐인 구르는 칸)을 민다.
    // 직접 고르기에서는 시트 높이를 고정한다(사람이 늘고 줄어도 시트 머리가 오르내리지 않게).
    return createPortal(
      <div className={`fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[95] flex items-end bg-black/50 dc-scrim${sheetLeaving ? ' dc-out' : ''}`} aria-hidden={sheetLeaving || undefined}>
        <div ref={sheetRef} role="dialog" aria-label="보는 사람" data-viewers-sheet=""
          className={`w-full flex flex-col overflow-hidden rounded-t-2xl bg-surface dc-sheet-up${sheetLeaving ? ' dc-out' : ''} ${
            isCustomOnly(project) ? 'h-[min(88%,680px)]' : 'max-h-[88%]'}`}>
          <span className="shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
          <ViewersPicker project={project} onSet={onSet} big
            foot={<button type="button" onClick={() => setSheetOpen(false)} className={`${BTN_CONFIRM_QUIET} w-full`}>닫기</button>} />
        </div>
      </div>, document.body);
  };
  return { pop, on: isRestricted(project), open, toggle, panel };
}

// 보는 사람 고르기 판(0105) — 세 칸 · 팀 칩 · 이름 칸 · 팀별 사람 체크 · 별도로 추가한 사람.
// big: 폰 시트(줄이 조금 크다). 고를 때마다 onSet으로 곧바로 저장한다. foot: 바닥 줄 아래에 붙일 것(폰 시트의 닫기).
// **구르는 칸은 하나다**(시안 2차 2026-10-16 — 판 안 목록과 판 자신이 따로 굴러 사람이 늘 때마다 화면이 뛰었다):
//   머리(제목 · 세 칸 · 팀 칩 · 이름 칸 — 늘 보인다) / 가운데(팀별 사람 · 별도로 추가한 사람 · 치는 동안은 찾은 사람만 —
//   overscroll-contain으로 바깥까지 굴리지 않는다) / 바닥(N명이 볼 수 있어요 · 폰은 닫기). 판의 높이는 부르는 쪽이 정한다.
// 이름 칸은 앱의 표준 칸(groupsParts FIELD)과 같은 글자·여백·테두리다.
const PICK_ITEMS = [['all', '모두'], [LEADERS, '리더만'], [CUSTOM, '직접 선택']];
const PICK_MAX_H = 560;
function ViewersPicker({ project, onSet, big = false, foot = null }) {
  const me = useStore(s => s.currentUser?.name || '');
  const storeMembers = useStore(selectMembers);
  const myTeams = useStore(s => s.currentUser?.teams);
  // 가입한 사람(스토어 members). 게스트는 비어 있어 나 한 사람이다(내 팀으로 — 칩을 켜면 나만 들어간다)
  const people = useMemo(() => (storeMembers.length ? storeMembers : (me ? [{ name: me, teams: myTeams || [] }] : [])), [storeMembers, me, myTeams]);
  const [q, setQ] = useState('');
  const mode = project.visibility === LEADERS || project.visibility === CUSTOM ? project.visibility : 'all';
  const viewers = useMemo(() => (project.viewers?.length ? project.viewers : (me ? [me] : [])), [project.viewers, me]);
  const viewerTeams = project.viewerTeams || [];
  // 팀 칩 — 명단에 사람이 있는 팀만, config의 팀 차례로
  const teams = useMemo(() => Object.keys(CONFIG.TEAMS).filter(t => people.some(p => (p.teams || []).includes(t))), [people]);
  const save = (patch) => onSet({ visibility: CUSTOM, viewers, viewerTeams, ...patch });
  const pickMode = (v) => { if (v === mode) return; onSet(v === CUSTOM ? { visibility: CUSTOM, viewers, viewerTeams } : v); };
  const setTeam = (t) => save(toggleViewerTeam({ viewers, viewerTeams }, t, people, me));
  const has = new Set(viewers);
  const flip = (name) => { if (name === me) return; save({ viewers: has.has(name) ? viewers.filter(n => n !== name) : [...viewers, name] }); };
  const inOpenTeam = (p) => viewerTeams.some(t => (p.teams || []).includes(t));
  const extras = people.filter(p => has.has(p.name) && !inOpenTeam(p));
  const found = q.trim() ? people.filter(p => !has.has(p.name) && !inOpenTeam(p) && p.name.includes(q.trim())).slice(0, 6) : [];
  const row = big ? 'py-[7px] text-[13.5px]' : 'py-[5px] text-[12.5px]';
  const face = big ? 'w-6 h-6 text-[10.5px]' : 'w-[22px] h-[22px] text-[10px]';
  const person = (p, key) => (
    <label key={key} data-viewer-row={p.name} className={`flex items-center gap-2.5 px-1.5 rounded-md hover:bg-surface-hover ${row} ${p.name === me ? '' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={has.has(p.name)} disabled={p.name === me} onChange={() => flip(p.name)}
        className={`${big ? 'w-[18px] h-[18px]' : 'w-[15px] h-[15px]'} m-0 shrink-0`} style={{ accentColor: 'var(--app-accent)' }} />
      <Avatar name={p.name} className={`flex ${face}`} />
      <span className="flex-1 min-w-0 truncate font-semibold text-fg">{p.name}</span>
      {p.name === me && <span className="shrink-0 text-[11px] text-fg-muted">나</span>}
    </label>
  );
  const custom = mode === CUSTOM;
  const padX = big ? 'px-4' : 'px-3.5';
  return (
    <div data-viewers-picker="" className="flex-1 min-h-0 flex flex-col min-w-0">
      <div className={`shrink-0 flex flex-col gap-2.5 ${padX} ${big ? 'pt-3' : 'pt-3'} ${custom ? 'pb-2.5 border-b border-line' : 'pb-3'}`}>
        <div className={`${big ? 'text-[14px]' : 'text-[12.5px]'} font-bold text-fg`}>보는 사람</div>
        <Segmented className="flex p-[3px] rounded-md" value={mode} onPick={pickMode}
          btnClassName={`flex-1 px-2 rounded-sm font-bold transition-colors whitespace-nowrap ${big ? 'py-[7px] text-[13px]' : 'py-[5px] text-[12px]'}`}
          items={PICK_ITEMS.map(([v, label]) => [v, label, { 'data-visibility-pick': v }])} />
        {custom && (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="팀">
              {teams.map(t => {
                const sel = viewerTeams.includes(t);
                return (
                  <button key={t} type="button" onClick={() => setTeam(t)} aria-pressed={sel} data-viewer-team-chip={t}
                    className={`rounded-full font-bold border transition active:scale-95 ${big ? 'px-3 py-[5px] text-[12.5px]' : 'px-2.5 py-1 text-[11.5px]'} ${sel
                      ? `${CONFIG.TEAMS[t]} border-transparent` : 'border-line text-fg-muted hover:bg-surface-hover'}`}>{t}</button>
                );
              })}
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름으로 추가하기" aria-label="이름으로 추가하기" data-viewer-search=""
              enterKeyHint="search" className={`${FIELD} w-full`} />
          </>
        )}
      </div>
      {custom && (
        <div data-viewers-scroll="" className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${padX} py-2`}>
          {q.trim() ? (
            found.map(p => (
              <button key={p.name} type="button" data-viewer-add={p.name} onClick={() => { save({ viewers: [...viewers, p.name] }); setQ(''); }}
                className={`w-full flex items-center gap-2.5 px-1.5 rounded-md hover:bg-surface-hover text-left ${row}`}>
                <Avatar name={p.name} className={`flex ${face}`} />
                <span className="font-semibold text-fg truncate">{p.name}</span>
                <span className="flex-1 min-w-0 truncate text-[11px] text-fg-muted">{teamLine(p.teams, { primary: p.team }).join(' · ')}</span>
                <Plus size={14} className="shrink-0 text-accent-text" aria-hidden />
              </button>
            ))
          ) : (
          <div className="flex flex-col gap-2 min-w-0">
            {viewerTeams.map(t => {
              const members = people.filter(p => (p.teams || []).includes(t));
              const n = members.filter(p => has.has(p.name)).length;
              return (
                <div key={t} data-viewer-team={t} className="min-w-0">
                  <div className="flex items-center justify-between px-1.5 pb-0.5 text-[11px] font-bold">
                    <span className={CONFIG.TEAM_FG[t] || 'text-fg-muted'}>{t}</span>
                    <span className="text-fg-muted tabular-nums">{n}/{members.length}</span>
                  </div>
                  {members.map(p => person(p, `${t}:${p.name}`))}
                </div>
              );
            })}
            {extras.length > 0 && (
              <div data-viewer-extra="" className="min-w-0">
                <div className="px-1.5 pb-0.5 text-[11px] font-bold text-fg-muted">별도로 추가한 사람</div>
                {extras.map(p => person(p, `x:${p.name}`))}
              </div>
            )}
          </div>
          )}
        </div>
      )}
      {(custom || foot) && (
        <div data-viewers-foot="" className={`shrink-0 flex flex-col gap-2.5 ${padX} ${custom ? 'pt-2.5 border-t border-line' : ''} ${big ? '' : 'pb-3'}`}
          style={big ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : null}>
          {custom && <div className="text-[11.5px] text-fg-muted tabular-nums" data-viewer-count="">{viewers.length}명이 볼 수 있어요</div>}
          {foot}
        </div>
      )}
    </div>
  );
}

export function LeaderLockButton({ project, onSet }) {
  const { on, open, toggle, panel, pop } = useLeaderSwitch(project, onSet);
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={toggle} data-leader-lock="" aria-expanded={open} aria-pressed={on}
          title="리더만 보기" aria-label="리더만 보기"
          className={`p-1.5 rounded-md transition active:scale-95 shrink-0 ${on
            ? 'bg-accent-weak text-accent-text' : 'text-fg-faint hover:text-accent-text hover:bg-surface-hover'}`}>
          <Lock size={16} strokeWidth={1.75} />
        </button>
      </span>
      {panel()}
    </span>
  );
}

// 폰 상단바 제목 앞 자물쇠(시안 승인 2026-10-14) — 리더 프로젝트일 때만. 15px accent(탭 줄 자물쇠와 같은 표시)이고
// 누름 자리는 바 높이(36px)만큼 · 왼쪽 6px은 바 여백으로 내밀어(-ml-1.5) 자물쇠 획이 바 여백(14px)에 맞는다.
// 바꿀 수 없는 사람(onSet 없음)에게는 누르지 않는 표시만. 직접 고른 사람만(0105)도 같은 자물쇠 → 아래 시트.
export function LeaderTitleLock({ project, onSet }) {
  const { open, toggle, panel, pop } = useLeaderSwitch(project, onSet);
  if (!isRestricted(project)) return null;
  const icon = <Lock size={15} strokeWidth={2} aria-hidden className="shrink-0" />;
  if (!onSet) return <span data-title-lock="" role="img" aria-label="리더만 보기" className="shrink-0 inline-flex text-accent-text">{icon}</span>;
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0 -ml-1.5">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={toggle} data-title-lock="" aria-expanded={open}
          title="리더만 보기" aria-label="리더만 보기"
          className="h-9 px-1.5 inline-flex items-center rounded-md text-accent-text transition active:scale-95">
          {icon}
        </button>
      </span>
      {panel()}
    </span>
  );
}
