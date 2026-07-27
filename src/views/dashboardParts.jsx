import React from 'react';
import { CONFIG, teamBar, teamColor } from '../config.js';
import { avatarColor } from '../utils.js';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';

// ============================================================================
// 리디자인 공용 조각 — 대시보드 / 내 업무 / 팀 보드가 같은 부품을 쓴다.
// (핸드오프 문서의 "마감 그룹 리스트", "KPI 카드", 진행 바 규격)
// ============================================================================

export const ISO_TODAY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 남은 날 수 (음수 = 지남). 자정 기준으로 비교해야 "오늘"이 시간대에 따라 흔들리지 않는다.
export const daysLeft = (iso, today = ISO_TODAY()) =>
  Math.round((new Date(`${iso}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
export const mdLabel = (iso) => `${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;

// 마감 기준 구간 — 지연 / 오늘 / 이번 주(6일 내) / 그 이후 / 완료
export const BUCKETS = [
  { key: 'overdue', label: '지연', fg: 'var(--app-tag-red-fg)' },
  { key: 'today', label: '오늘 마감', fg: 'var(--app-ink)' },
  { key: 'week', label: '이번 주', fg: 'var(--app-ink)' },
  { key: 'later', label: '다음 주 이후', fg: 'var(--app-ink-muted)' },
  { key: 'done', label: '끝낸 업무', fg: 'var(--app-tag-green-fg)' },
];
export function bucketOf(task, today = ISO_TODAY()) {
  // 끝낸 업무는 마감이 지났어도 '지연'이 아니다 — 이미 끝난 일을 밀린 일로 세면
  // '내 업무'에서 완료 탭을 볼 때마다 전부 빨갛게 지연으로 보였다
  if (task.status === '완료') return 4;
  if (!task.dueDate) return 3;              // 마감 없는 건 맨 아래로
  if (task.dueDate < today) return 0;
  if (task.dueDate === today) return 1;
  return daysLeft(task.dueDate, today) <= 6 ? 2 : 3;
}
// 마감 없는 업무가 뒤로 가도록 정렬 (마감일 오름차순)
const byDue = (a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));

export function groupByDue(tasks, today = ISO_TODAY()) {
  return BUCKETS.map((b, i) => ({
    ...b,
    items: tasks.filter(t => bucketOf(t, today) === i).sort(byDue),
  })).filter(g => g.items.length);
}

// 상태 → 진행 바 파스텔
export const STATUS_BAR = {
  '시작 전': 'var(--p-gray)',
  '진행 중': 'var(--p-blue)',
  '보류 중': 'var(--p-yellow)',
  '완료': 'var(--p-green)',
};
// 상태 → 점 색 (CSS 변수 — 인라인 style에서 쓴다)
export const STATUS_DOT_VAR = {
  '시작 전': 'var(--app-ink-faint)',
  '진행 중': 'var(--app-accent)',
  '보류 중': 'var(--app-status-hold)',
  '완료': 'var(--app-tag-green-fg)',
};

// ── 진행 바 (scaleX) ───────────────────────────────────────────────────────
export function Bar({ ratio, color, height = 4 }) {
  return (
    <span className="block rounded-full overflow-hidden" style={{ height, background: 'var(--p-track)' }}>
      <span className="dc-bar-fill block h-full rounded-full"
        style={{ background: color, transform: `scaleX(${Math.max(0, Math.min(1, ratio || 0)).toFixed(3)})` }} />
    </span>
  );
}

// ── 상태 4색 세그먼트 바 (프로젝트 진행) ───────────────────────────────────
export function StatusSegments({ counts, total }) {
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : '0%');
  return (
    <span className="flex rounded-[4px] overflow-hidden" style={{ height: 7, background: 'var(--p-track)' }}>
      {CONFIG.STATUSES.slice().reverse().map(s => (
        <span key={s} className="block h-full" style={{ width: pct(counts[s] || 0), background: STATUS_BAR[s] }} />
      ))}
    </span>
  );
}

// ── KPI 카드 한 칸 ────────────────────────────────────────────────────────
// 1px 격자(부모가 background:line + gap:1px)를 쓰므로 카드 자체는 배경만 칠한다.
export function KpiCell({ dot, label, value, unit = '건', note, ratio, bar, alert, delay = 0 }) {
  const fg = alert ? 'var(--app-tag-red-fg)' : 'var(--app-ink)';
  return (
    <div
      className="dc-kpi flex flex-col gap-[9px] px-4 pt-3.5 pb-[13px] transition-colors"
      style={{ background: alert ? 'var(--app-tag-red)' : 'var(--app-surface)', animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
        <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: alert ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-[5px]">
        <span className="text-[34px] font-extrabold leading-none tabular-nums" style={{ letterSpacing: '-1.8px', color: fg }}>{value}</span>
        {unit && <span className="text-xs font-semibold" style={{ color: alert ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>{unit}</span>}
        <span className="flex-1" />
        {note && <span className="hidden md:inline text-[10.5px] tabular-nums whitespace-nowrap text-fg-faint">{note}</span>}
      </div>
      <Bar ratio={ratio} color={bar} />
    </div>
  );
}

// ── 마감 그룹 리스트 ──────────────────────────────────────────────────────
// 대시보드·내 업무·팀 보드가 같이 쓴다. meta로 프로젝트만/팀까지 표시를 고른다.
export function DueGroupList({ groups, projectsMap, today, onComplete, onOpen, showTeam = true, emptyHint }) {
  if (!groups.length) {
    // 빈 화면은 남는 공간의 정가운데에 — 위쪽에 붙어 있으면 아래가 통째로 비어 보인다
    return (
      <div className="min-h-[46vh] flex flex-col items-center justify-center text-center">
        <AllClearMark />
        <p className="text-[13.5px] font-semibold text-fg mb-1 mt-3">다 정리되었어요</p>
        {emptyHint && <p className="text-xs text-fg-faint">{emptyHint}</p>}
      </div>
    );
  }
  let seen = 0;
  return (
    <div className="min-w-0">
      {groups.map(g => (
        <div key={g.key} className="pb-4">
          <div className="flex items-center gap-2 pb-[5px]">
            <span className="text-xs font-bold" style={{ color: g.fg }}>{g.label}</span>
            <span className="text-[11px] font-semibold tabular-nums text-fg-faint">{g.items.length}건</span>
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          </div>
          {g.items.map(t => {
            const delay = `${Math.min(seen++, 12) * 22}ms`;
            const done = t.status === '완료';
            const over = !done && t.dueDate && t.dueDate < today;
            const isToday = !done && t.dueDate === today;
            return (
              <div
                key={t.id}
                className="dc-row flex items-center gap-3 p-2.5 -mx-2.5 rounded-[8px] hover:bg-surface-hover transition-colors"
                style={{ animationDelay: delay, transitionDuration: '120ms' }}
              >
                {/* 완료 처리 — 목록에서 바로 끝낼 수 있어야 '지금 뭘 해야 하나' 화면이 된다.
                    한 번의 오터치로 상태가 바뀌지 않게 확인을 한 번 받는다.
                    이미 끝난 건은 같은 자리에서 되돌린다(같은 상태로 저장은 아무 일도 안 하니
                    버튼이 죽은 것처럼 보였다). */}
                {done ? (
                  <ConfirmPopover
                    className="shrink-0 inline-flex" tone="ok" confirmLabel="되돌리기"
                    title="완료 취소" message={`'${t.title}'을 다시 진행 중으로 되돌릴까요?`}
                    onConfirm={() => onComplete(t, '진행 중')}
                  >
                    <span
                      role="button" aria-label={`${t.title} 완료 취소`}
                      className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-70"
                      style={{ background: 'var(--app-tag-green-fg)' }}
                    >
                      <Checkmark filled />
                    </span>
                  </ConfirmPopover>
                ) : (
                  <ConfirmPopover
                    className="shrink-0 inline-flex" tone="ok" confirmLabel="완료"
                    title="완료로 옮기기" message={`'${t.title}'을 완료로 옮길까요?`}
                    onConfirm={() => onComplete(t, '완료')}
                  >
                    <span
                      role="button" aria-label={`${t.title} 완료로 옮기기`}
                      className="group/done w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                      style={{ border: '1.5px solid var(--app-line)' }}
                    >
                      <Checkmark />
                    </span>
                  </ConfirmPopover>
                )}
                <button type="button" onClick={() => onOpen(t)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
                    style={{ color: over ? 'var(--app-tag-red-fg)' : isToday ? 'var(--app-ink)' : 'var(--app-ink-muted)' }}>
                    {t.dueDate ? mdLabel(t.dueDate) : '미정'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold text-fg truncate" style={{ letterSpacing: '-0.2px' }}>{t.title}</span>
                    <span className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                      <span className="text-[10.5px] text-fg-faint truncate">{projectsMap[t.projectId]?.title || '프로젝트 없음'}</span>
                      {showTeam && t.teams?.length > 0 && (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full shrink-0" style={{ background: 'var(--app-line)' }} />
                          <span className="text-[10.5px] font-semibold whitespace-nowrap" style={{ color: teamColor(t.teams[0]) }}>{t.teams[0]}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 inline-flex items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-[4px]"
                    style={{ background: CONFIG.STATUS_BG_VAR[t.status] || 'transparent' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                    <span className="text-[11px] font-semibold" style={{ color: CONFIG.STATUS_FG_VAR[t.status] || 'var(--app-ink-muted)' }}>{t.status}</span>
                  </span>
                  <span className={`hidden sm:flex shrink-0 w-[22px] h-[22px] rounded-full items-center justify-center text-[10.5px] font-bold ${avatarColor(t.assignees?.[0] || '')}`}
                    title={t.assignees?.[0] || '미지정'}>
                    {(t.assignees?.[0] || '?')[0]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// 다 끝난 화면의 표식 — 원이 살짝 커지며 나타나고 체크가 그려진다.
// 로티 파일을 물리는 대신 SVG 한 장으로 같은 인상을 낸다(의존성·네트워크 없음).
function AllClearMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-12 h-12 mx-auto" aria-hidden="true">
      <circle className="dc-draw-ring" cx="24" cy="24" r="21" fill="var(--app-tag-green)" style={{ transformOrigin: 'center' }} />
      <path
        className="dc-draw" pathLength="1" d="M15 24.5 21.5 31 34 18"
        fill="none" stroke="var(--app-tag-green-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// 완료 버튼 안의 체크 — 미완료는 hover에서 진해지고, 끝낸 건은 초록 원 위 흰 체크
function Checkmark({ filled = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={filled ? '#fff' : 'var(--app-tag-green-fg)'} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      className={filled ? 'w-[11px] h-[11px]' : 'w-[11px] h-[11px] opacity-40 group-hover/done:opacity-100 transition-opacity'}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ── 팀별 남은 업무 ────────────────────────────────────────────────────────
export function TeamLeftGrid({ stats, onOpenTeam }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {stats.map(s => (
        <button key={s.name} onClick={() => onOpenTeam(s.name)} title={`${s.name} 보드로`}
          className="min-w-0 text-left hover:opacity-60 transition-opacity">
          <span className="flex items-baseline justify-between gap-1.5">
            <span className="text-[11.5px] font-bold truncate" style={{ color: teamColor(s.name) }}>{s.name}</span>
            <span className="text-[11px] font-semibold text-fg tabular-nums shrink-0">{s.total - s.done}건</span>
          </span>
          <span className="block mt-[5px]"><Bar ratio={s.total ? s.done / s.total : 0} color={teamBar(s.name)} /></span>
        </button>
      ))}
    </div>
  );
}

// ── 섹션 제목 (줄 있는 것 / 없는 것) ──────────────────────────────────────
export function SectionHead({ children, right }) {
  return (
    <div className="flex items-center gap-2 pb-2.5">
      <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">{children}</h3>
      <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
      {right}
    </div>
  );
}

// ── 카드 껍데기 ───────────────────────────────────────────────────────────
export function Card({ className = '', children, style }) {
  return (
    <div className={`rounded-[10px] shadow-soft ${className}`}
      style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)', ...style }}>
      {children}
    </div>
  );
}
