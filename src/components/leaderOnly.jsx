import { useState } from 'react';
import { Lock } from 'lucide-react';
import { usePopover } from '../hooks/usePopover.js';
import { ShareSwitch } from './bibleParts.jsx';
import { isLeaderOnly } from '../services/visibility.js';

// ============================================================================
// 리더만 보는 프로젝트(0092) — '리더만' 칩 · 자물쇠 버튼 + 토글 팝오버 (2026-10-12 시안 승인)
// ----------------------------------------------------------------------------
// 칩은 세 자리에 같은 모양으로 선다: 데스크톱 프로젝트 제목 옆(projectView) · 폰 상단바 제목 옆(mobileNav) ·
// 업무 창 머리(modals — 프로젝트 것을 물려받는다 · 업무마다 따로 켜지 않는다). accent-weak 바탕 + 자물쇠 + 글자.
// 자물쇠 버튼은 프로젝트 머리의 공유·삭제 묶음 **앞**에, 리더에게만 선다(게스트는 언제나 · visibility.js).
// 누르면 팝오버에 `리더만 보기` 라벨 + 토글 한 줄뿐이다(설명 줄 없음 · 폭은 내용만큼 — `!w-max`가 판 폭을 이긴다).
// 켜져 있으면 버튼도 accent-weak로 서서 상태가 보인다. 실제 경계는 DB다(0092 정책) — 여기는 그리기만.
// ============================================================================

// small — 업무 창 머리·폰 상단바(10.5px) / 기본 — 데스크톱 제목 옆(11px)
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

// onSet(on) → 약속. 실패하면 부르는 쪽이 토스트를 띄우고 값은 그대로다(저장된 것만 비춘다 — 낙관적으로 먼저 뒤집지 않는다).
export function LeaderLockButton({ project, onSet }) {
  const pop = usePopover(140, 40, { gap: 8, measure: true });
  const [busy, setBusy] = useState(false);
  const on = isLeaderOnly(project);
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSet(!on); } finally { setBusy(false); }
  };
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
      {pop.panel('z-[90] !w-max bg-surface border border-line rounded-lg shadow-elevated py-[9px] pl-3.5 pr-3', (
        <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={flip} data-leader-switch=""
          className={`inline-flex items-center gap-3 text-[12.5px] font-bold text-fg whitespace-nowrap ${busy ? 'opacity-60' : ''}`}>
          리더만 보기<ShareSwitch on={on} />
        </button>
      ))}
    </span>
  );
}
