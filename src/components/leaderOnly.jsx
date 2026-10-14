import { useState } from 'react';
import { Lock } from 'lucide-react';
import { usePopover } from '../hooks/usePopover.js';
import { ShareSwitch } from './bibleParts.jsx';
import { LEADERS, isLeaderOnly, canSetVisibility } from '../services/visibility.js';
import { store, useStore } from '../store/workspaceStore.js';
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
// ============================================================================

// 보는 사람 바꾸기(0092) — 바꿀 수 없는 사람이면 null(자물쇠 버튼·팝오버를 세우지 않는다).
// **낙관적으로 먼저 바꾸지 않는다** — 누가 보느냐는 저장된 값이 곧 화면의 사실이다(참고 링크 비밀번호와
// 같은 순서). 클라우드는 서버가 돌려준 값(리더가 아니면 트리거가 옛 값으로 되돌린다)을 그대로 쓴다.
// 누가·언제(visibilityBy·visibilityAt · 0099)도 같이 적는다 — 화면 문구는 없다. 클라우드는 DB 트리거가 적은 값을 받고,
// 게스트는 로컬에 이름과 시각을 적는다(바뀔 때만 — 같은 값을 다시 누르면 옛 기록 그대로).
export function useSetVisibility(project) {
  const { enabled, session } = useAuth();
  const cloudOn = enabled && !!session;
  // 나는 리더인가(0092 · cloudSync.loadCloudState) — 게스트 스토어에는 이 칸이 없고 자물쇠는 언제나 선다
  const amLeader = useStore(s => s.amLeader);
  if (!project || !canSetVisibility({ cloudOn, amLeader })) return null;
  return async (on) => {
    const want = on ? LEADERS : 'all';
    try {
      const saved = cloudOn ? await cloudSync.projectVisibilityCloud(project.id, want)
        : (want === (project.visibility || 'all') ? { visibility: want }
          : { visibility: want, visibilityBy: store.getState().currentUser?.name || null, visibilityAt: new Date().toISOString() });
      store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, ...saved } });
    } catch (err) {
      const what = '보는 사람을 바꾸지 못했어요';
      console.error(`[cloud] ${what}:`, cloudSync.formatCloudError(err), err);
      showToast(failText(what, err));
    }
  };
}

// small — 업무 창 머리(10.5px) / 기본 — 데스크톱 제목 옆(11px)
export function LeaderChip({ project, small = false, className = '' }) {
  if (!isLeaderOnly(project)) return null;
  return (
    <span data-leader-chip="" className={`inline-flex items-center shrink-0 rounded-full bg-accent-weak text-accent-text font-bold whitespace-nowrap ${
      small ? 'gap-[3px] pl-[5px] pr-[7px] py-[2px] text-[10.5px]' : 'gap-1 pl-[7px] pr-[9px] py-[3px] text-[11px]'} ${className}`}>
      <Lock size={small ? 10 : 11} strokeWidth={2.5} className="shrink-0" aria-hidden />리더만
    </span>
  );
}

// 탭 줄 자물쇠(20차 ⑥ · 시안 '프로젝트 탭줄(리더에게)') — 리더 프로젝트 탭 이름 앞 10px. 색은 탭 글자를 따른다
// (currentColor — 켜진 탭은 진하게 · 꺼진 탭은 muted · 보관은 faint). 데스크톱 탭과 그 폭 재기 줄 · 더보기 연도 폴더 · 폰 탭 줄.
// 글자 줄 안의 inline-block이다(감싸는 flex를 두지 않는다 — 폰 보관 탭의 Archive 아이콘과 같은 이유 · §6-9-bu).
export function TabLock({ project, className = '' }) {
  if (!isLeaderOnly(project)) return null;
  return <Lock size={10} strokeWidth={2.6} data-tab-lock="" aria-hidden className={`inline-block shrink-0 align-[-1px] mr-[5px] ${className}`} />;
}

// 자물쇠 하나에 붙는 `리더만 보기` 팝오버 한 벌 — 프로젝트 머리 자물쇠와 폰 상단바 제목 자물쇠가 같이 쓴다.
// onSet(on) → 약속. 실패하면 useSetVisibility가 토스트를 띄우고 값은 그대로다(저장된 것만 비춘다 — 낙관적으로 먼저 뒤집지 않는다).
function useLeaderSwitch(project, onSet) {
  const pop = usePopover(140, 40, { gap: 8, measure: true });
  const [busy, setBusy] = useState(false);
  const on = isLeaderOnly(project);
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSet(!on); } finally { setBusy(false); }
  };
  const panel = () => pop.panel('z-[90] !w-max bg-surface border border-line rounded-lg shadow-elevated py-[9px] pl-3.5 pr-3', (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={flip} data-leader-switch=""
      className={`inline-flex items-center gap-3 text-[12.5px] font-bold text-fg whitespace-nowrap ${busy ? 'opacity-60' : ''}`}>
      리더만 보기<ShareSwitch on={on} />
    </button>
  ));
  return { pop, on, panel };
}

export function LeaderLockButton({ project, onSet }) {
  const { pop, on, panel } = useLeaderSwitch(project, onSet);
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={pop.toggle} data-leader-lock="" aria-expanded={pop.open} aria-pressed={on}
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
// 바꿀 수 없는 사람(onSet 없음)에게는 누르지 않는 표시만.
export function LeaderTitleLock({ project, onSet }) {
  const { pop, panel } = useLeaderSwitch(project, onSet);
  if (!isLeaderOnly(project)) return null;
  const icon = <Lock size={15} strokeWidth={2} aria-hidden className="shrink-0" />;
  if (!onSet) return <span data-title-lock="" role="img" aria-label="리더만 보기" className="shrink-0 inline-flex text-accent-text">{icon}</span>;
  return (
    <span ref={pop.rootRef} className="inline-flex shrink-0 -ml-1.5">
      <span ref={pop.btnRef} className="inline-flex">
        <button type="button" onClick={pop.toggle} data-title-lock="" aria-expanded={pop.open}
          title="리더만 보기" aria-label="리더만 보기"
          className="h-9 px-1.5 inline-flex items-center rounded-md text-accent-text transition active:scale-95">
          {icon}
        </button>
      </span>
      {panel()}
    </span>
  );
}
