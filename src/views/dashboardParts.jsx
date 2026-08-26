import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CONFIG, teamBar, teamColor } from '../config.js';
import { Avatar } from '../components/Avatar.jsx';
import { visitOrder, agoLabel, lastVisitOf } from '../utils.js';
import { usePresence } from '../services/presence.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
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
const mdLabel = (iso) => `${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;
// 지난 날 수 (오늘 - 그날). ISO 날짜든 타임스탬프든 앞 10자만 본다.
export const ageDays = (iso, today = ISO_TODAY()) => daysLeft(today, String(iso).slice(0, 10));

// 마감이 정해지지 않은 채 이만큼 지나면 표시한다 — 마감 미정은 막지 않지만
// 조용히 묻히게 두지도 않는다(마감을 필수로 만들면 아무 날짜나 넣어서 '지연'
// 숫자가 거짓이 된다).
export const STALE_NODUE_DAYS = 14;
export const isStaleNoDue = (t, today = ISO_TODAY()) =>
  !t.dueDate && t.status !== '완료' && !!t.createdAt && ageDays(t.createdAt, today) >= STALE_NODUE_DAYS;

// 마감 기준 구간 — 지연 / 오늘 / 이번 주(6일 내) / 그 이후 / 마감 미정 / 완료
// '마감 미정'을 따로 두는 이유: 예전에는 '다음 주 이후'에 섞여 있어서 마감을 정하지
// 않은 업무가 몇 건인지 아무 데도 안 보였다. 마감 중심 화면인데 마감이 없는 업무가
// 가장 조용히 묻혔다.
const BUCKETS = [
  { key: 'overdue', label: '지연', fg: 'var(--app-tag-red-fg)' },
  { key: 'today', label: '오늘 마감', fg: 'var(--app-ink)' },
  { key: 'week', label: '이번 주', fg: 'var(--app-ink)' },
  { key: 'later', label: '다음 주 이후', fg: 'var(--app-ink-muted)' },
  { key: 'nodue', label: '마감 미정', fg: 'var(--app-ink-muted)' },
  { key: 'done', label: '끝낸 업무', fg: 'var(--app-tag-green-fg)' },
];
function bucketOf(task, today = ISO_TODAY()) {
  // 끝낸 업무는 마감이 지났어도 '지연'이 아니다 — 이미 끝난 일을 밀린 일로 세면
  // '내 업무'에서 완료 탭을 볼 때마다 전부 빨갛게 지연으로 보였다
  // 반환값은 BUCKETS의 인덱스다 — 배열 순서를 바꾸면 여기도 같이 고쳐야 한다
  if (task.status === '완료') return 5;
  if (!task.dueDate) return 4;              // 마감 미정 — 자기 구간을 가진다
  if (task.dueDate < today) return 0;
  if (task.dueDate === today) return 1;
  return daysLeft(task.dueDate, today) <= 6 ? 2 : 3;
}
// 마감 없는 업무가 뒤로 가도록 정렬 (마감일 오름차순).
// 칸반 컬럼 안 순서도 이걸 쓴다 — 목록과 보드가 서로 다른 순서를 보이면 안 된다.
export const byDue = (a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));

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
const GROUP_LIMIT = 30;   // 한 구간에 먼저 그리는 줄 수. 나머지는 '더 보기'

export function DueGroupList({ groups, projectsMap, today, onComplete, onOpen, onClaim, showTeam = true, emptyHint }) {
  const [expanded, setExpanded] = useState({});   // { [구간 key]: true }

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
      {groups.map(g => {
        // 구간마다 앞의 GROUP_LIMIT건만 먼저 그린다 — 업무가 쌓이면 이 목록이 화면에서
        // 가장 긴 DOM이 되고(줄마다 확인 팝오버가 둘), 재조회 때마다 전부 다시 만들어진다.
        const shown = expanded[g.key] ? g.items : g.items.slice(0, GROUP_LIMIT);
        const hidden = g.items.length - shown.length;
        // 마감 미정 구간에서 2주 넘게 마감이 안 정해진 건수 — 제목 줄에만 적는다
        const staleCount = g.key === 'nodue' ? g.items.filter(t => isStaleNoDue(t, today)).length : 0;
        return (
        <div key={g.key} className="pb-4">
          <div className="flex items-center gap-2 pb-[5px]">
            <span className="text-xs font-bold" style={{ color: g.fg }}>{g.label}</span>
            <span className="text-[11px] font-semibold tabular-nums text-fg-faint">{g.items.length}건</span>
            {staleCount > 0 && (
              <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap" style={{ color: 'var(--app-status-hold)' }}>
                · {STALE_NODUE_DAYS / 7}주 넘은 것 {staleCount}건
              </span>
            )}
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          </div>
          {shown.map(t => {
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
                  {/* 마감이 2주 넘게 안 정해진 건은 '미정'을 노란색으로 — 구간 제목의
                      건수와 같은 색이라 어느 줄이 그건지 눈으로 이어진다 */}
                  <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
                    title={isStaleNoDue(t, today) ? `${STALE_NODUE_DAYS / 7}주 넘게 마감이 정해지지 않았어요` : undefined}
                    style={{
                      color: over ? 'var(--app-tag-red-fg)'
                        : isToday ? 'var(--app-ink)'
                        : isStaleNoDue(t, today) ? 'var(--app-status-hold)'
                        : 'var(--app-ink-muted)',
                    }}>
                    {t.dueDate ? mdLabel(t.dueDate) : '미정'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold text-fg truncate" style={{ letterSpacing: '-0.2px' }}>{t.title}</span>
                    <span className="flex items-center gap-1.5 mt-0.5 overflow-hidden">
                      {/* 좁은 화면의 상태 표시는 여기다(오른쪽 칩은 sm 이상에서만 뜬다).
                          예전에는 오른쪽 칩에서 글자만 지우고 점을 남겼는데, 색과 상태의
                          대응을 외우고 있어야 읽히는 표시가 됐다. 칩을 오른쪽에 되살리면
                          글자가 고정으로 70px쯤 먹어서 제목에 한글 12자밖에 안 남는다 —
                          제목이 주인공인 목록이다. 이 줄로 내리면 제목은 폭을 그대로 쓰고
                          상태는 글자로 읽힌다. 폭이 밀릴 때 잘리는 건 프로젝트 이름 쪽. */}
                      <span className="sm:hidden shrink-0 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                        <span className="text-[10.5px] font-semibold whitespace-nowrap" style={{ color: CONFIG.STATUS_FG_VAR[t.status] || 'var(--app-ink-muted)' }}>{t.status}</span>
                      </span>
                      <span className="sm:hidden shrink-0 w-0.5 h-0.5 rounded-full" style={{ background: 'var(--app-line)' }} />
                      <span className="text-[10.5px] text-fg-faint truncate">{projectsMap[t.projectId]?.title || '프로젝트 없음'}</span>
                      {showTeam && t.teams?.length > 0 && (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full shrink-0" style={{ background: 'var(--app-line)' }} />
                          <span className="text-[10.5px] font-semibold whitespace-nowrap" style={{ color: teamColor(t.teams[0]) }}>{t.teams[0]}</span>
                        </>
                      )}
                      {/* 담당자도 좁은 화면에서는 여기 — 데스크톱처럼 제목 줄 오른쪽 끝에 두면
                          아바타+간격이 34px을 먹어서 제목 폭이 278→244px로 밀린다. 이 줄에서
                          ml-auto로 오른쪽에 붙이면 오른쪽 정렬이라는 인상은 같고 제목은
                          한 픽셀도 안 준다. 이름 글자를 쓰지 않는 이유: 같은 10.5px 글자라
                          팀·프로젝트와 구분이 안 된다(원형 아바타는 한눈에 '사람'으로 읽힌다). */}
                      {/* mr-1.5: 채워진 원이라 글자와 달리 좌우 여백이 0이다. 오른쪽 끝에
                          그대로 붙이면 화면 가장자리에 눌린 것처럼 보인다(글자는 자획
                          바깥에 자연스러운 여백이 있어서 같은 x에 있어도 안 그렇다). */}
                      <Avatar name={t.assignees?.[0] || ''} title={t.assignees?.[0] || '미지정'}
                        className="sm:hidden inline-flex ml-auto mr-1.5 w-4 h-4 text-[9px]" />
                    </span>
                  </span>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-[4px]"
                    style={{ background: CONFIG.STATUS_BG_VAR[t.status] || 'transparent' }}
                    title={t.status}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                    <span className="text-[11px] font-semibold" style={{ color: CONFIG.STATUS_FG_VAR[t.status] || 'var(--app-ink-muted)' }}>{t.status}</span>
                  </span>
                  <Avatar name={t.assignees?.[0] || ''} title={t.assignees?.[0] || '미지정'}
                    className="hidden sm:inline-flex w-[22px] h-[22px] text-[10.5px]" />
                </button>
                {/* 「이거 제가 할게요」(§1.2) — 담당자 없는 업무를 줄 안에서 바로 자기 배정.
                    카드를 새로 만들지 않는다(사용자 결정 — 대시보드가 이미 길다).
                    onOpen 버튼 밖이다 — 버튼 안에 버튼을 넣을 수 없다. */}
                {onClaim && !done && !(t.assignees?.length) && (
                  <ConfirmPopover
                    className="shrink-0 inline-flex" tone="ok" confirmLabel="제가 할게요"
                    title="담당자로 들어가기" message={`'${t.title}'의 담당자로 들어갈까요?`}
                    onConfirm={() => onClaim(t)}
                  >
                    <button type="button"
                      className="text-[10.5px] font-bold text-accent-text whitespace-nowrap px-1.5 py-1 rounded-[6px] hover:bg-surface-hover transition active:scale-95">
                      제가 할게요
                    </button>
                  </ConfirmPopover>
                )}
              </div>
            );
          })}
          {hidden > 0 && (
            <button
              type="button" onClick={() => setExpanded(p => ({ ...p, [g.key]: true }))}
              className="w-full mt-1 py-2 rounded-[8px] text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99]"
            >{hidden}건 더 보기</button>
          )}
        </div>
        );
      })}
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

// ── 청년별 남은 업무 ──────────────────────────────────────────────────────
// 바로 위 '팀별 남은 업무'와 같은 데이터를 사람 축으로 자른 것이라 제목도 같은 꼴이다.
// '부하'·'과부하'·'병목' 같은 판정어는 쓰지 않는다 — 사람 수가 적은 팀에서는 그런 말이
// 지적처럼 읽힌다. 이름 · 남은 건수 · 막대만 두고, 많고 적음은 막대 길이로 읽히게
// 한다(가장 많이 맡은 사람 기준의 상대 길이).
// 담당자가 없는 업무는 여기 세지 않는다 — 아무에게도 얹혀 있지 않은 일이다.
export function PersonLoadGrid({ people, onOpenPerson }) {
  if (!people.length) return <p className="text-[11px] text-fg-faint">남은 업무를 맡은 사람이 없어요</p>;
  const max = people[0].left || 1;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {people.map(p => (
        <div key={p.name} className="min-w-0">
          <span className="flex items-center gap-1.5">
            <Avatar name={p.name} className="flex w-[18px] h-[18px] text-[9px]" />
            <span className="text-[11.5px] font-semibold text-fg truncate min-w-0">{p.name}</span>
            <span className="flex-1" />
            <span className="text-[11px] font-semibold text-fg tabular-nums shrink-0">{p.left}건</span>
          </span>
          <span className="block mt-[5px]"><Bar ratio={p.left / max} color={p.late ? 'var(--p-red)' : 'var(--p-blue)'} /></span>
          {/* 지연을 안고 있는 사람만 한 줄 더 — 건수만으로는 '많이 맡았다'와
              '밀려 있다'가 구분되지 않는다 */}
          {p.late > 0 && (
            <span className="block mt-[3px] text-[10px] tabular-nums" style={{ color: 'var(--app-tag-red-fg)' }}>지연 {p.late}건</span>
          )}
        </div>
      ))}
    </div>
  );
}

// 담당자별 남은 업무 집계 — 많이 맡은 사람 순. 목록을 한 번만 훑는다.
export function personLoad(openTasks, today = ISO_TODAY()) {
  const m = new Map();
  for (const t of openTasks) {
    for (const name of (t.assignees || [])) {
      if (!name) continue;
      const s = m.get(name) || { name, left: 0, late: 0 };
      s.left++;
      if (t.dueDate && t.dueDate < today) s.late++;
      m.set(name, s);
    }
  }
  return [...m.values()].sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'ko'));
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


// ── 사람 칸 (0019) ────────────────────────────────────────────────────────────
// 대시보드가 숫자만 있고 사람이 없었다. 참여의 시작은 "여기 사람이 있다"이고, 그걸
// 말하려면 얼굴이 필요하다. 없는 줄은 그리지 않는다 — 이 앱은 담백함이 먼저다(§8).
//
// 판정어·순위·점수를 두지 않는다. 다녀간 사람은 이름을 나열하지 않고 얼굴만 보여준다 —
// 많이 온 순으로 세우면 그 줄이 곧 "덜 온 사람" 목록이 된다(§8).
//
// **줄 수는 언제나 상한이 있다.** 수련회 시즌에 열 명이 한꺼번에 가입하면 이 카드가
// 화면을 밀어내고, 그러면 정작 업무 목록이 안 보인다. 두 줄까지만 그리고 나머지는 +N이다.
const PEOPLE_ROWS = 2;

// 얼굴 묶음 (다녀간 사람 · 접힌 +N 자리에서 같이 쓴다)
function FaceRow({ people, max = 8, size = 'w-[18px] h-[18px] text-[9px]' }) {
  if (!people.length) return null;
  return (
    <span className="flex items-center min-w-0" title={people.map(m => m.name).join(' · ')}>
      {people.slice(0, max).map(m => (
        <Avatar key={m.id || m.name} name={m.name} url={m.avatarUrl}
          className={`flex ${size} -ml-[5px] first:ml-0 ring-[1.5px] ring-surface`} />
      ))}
      {people.length > max && (
        <span className="ml-[5px] text-[10.5px] text-fg-faint tabular-nums">+{people.length - max}</span>
      )}
    </span>
  );
}

// 한 사람 줄 (생일 · 새로 온 사람이 같은 모양을 쓴다)
function PersonLine({ member, text, right, rightColor }) {
  return (
    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-line/60">
      <Avatar name={member.name} url={member.avatarUrl} className="flex w-[22px] h-[22px] text-[10.5px]" />
      <span className="text-[11.5px] text-fg min-w-0 truncate">
        <span className="font-semibold">{member.name}</span>{text}
      </span>
      <span className="flex-1" />
      {right && (
        <span className="text-[11px] tabular-nums whitespace-nowrap shrink-0" style={{ color: rightColor }}>{right}</span>
      )}
    </div>
  );
}

// 상한을 넘은 나머지 — 얼굴 묶음 + "그리고 N명 더"
function OverflowLine({ rest, text }) {
  if (!rest.length) return null;
  return (
    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-line/60">
      <FaceRow people={rest} max={6} />
      <span className="text-[11px] text-fg-muted min-w-0 truncate">{rest.length}명 {text}</span>
    </div>
  );
}

export function PeopleStrip({ members, myName, seen, birthdays, joined, onOpenMembers }) {
  if (!members.length) return null;
  const dayLabel = (n) => (n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 뒤`);
  const bShown = birthdays.slice(0, PEOPLE_ROWS), bRest = birthdays.slice(PEOPLE_ROWS);
  const jShown = joined.slice(0, PEOPLE_ROWS), jRest = joined.slice(PEOPLE_ROWS);
  return (
    <Card className="px-4 py-[15px]">
      {/* 머리줄의 숫자는 누를 수 있다 — 가입한 사람 전체 목록이 열린다.
          누를 수 있다는 걸 밑줄 점선으로 보여준다(hover로만 알 수 있게 두면 §8 위반이다) */}
      <div className="flex items-baseline justify-between gap-2 pb-2.5">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">현재까지 가입한 사람</h3>
        <button type="button" onClick={onOpenMembers}
          className="text-[11px] font-semibold text-fg-muted hover:text-accent-text tabular-nums shrink-0 transition-colors"
          style={{ borderBottom: '1px dotted var(--app-line)' }}
          title="가입한 사람 전체 보기">{members.length}명</button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fg-muted whitespace-nowrap shrink-0">오늘 다녀간 사람</span>
        <FaceRow people={seen} />
      </div>

      {/* 생일은 일주일 전부터. '축하'를 앱이 대신 말하지 않는다 — 그건 사람이 할 일이다 */}
      {bShown.map(b => (
        <PersonLine key={b.id || b.name} member={b} text="님 생일이에요"
          right={`${b.month}월 ${b.day}일 · ${dayLabel(b.inDays)}`}
          rightColor={b.inDays === 0 ? 'var(--app-accent)' : 'var(--app-ink-muted)'} />
      ))}
      <OverflowLine rest={bRest} text="더 생일이 있어요" />

      {/* 새로 온 사람 — 사흘만. 환영은 한 번 지나가면 되고, 오래 남으면 인사가 낡는다 */}
      {jShown.map(m => (
        <PersonLine key={m.id || m.name} member={m} text="님이 함께하게 되었어요"
          right={m.team || ''} rightColor={m.team ? teamColor(m.team) : undefined} />
      ))}
      <OverflowLine rest={jRest} text="더 함께하게 되었어요" />
    </Card>
  );
}

// 가입한 사람 전체 — 머리줄의 'N명'을 누르면 열린다.
// 순서는 **최근에 방문한 사람이 위**다(사용자가 가입순에서 바꿨다). 지금 접속해 있는
// 사람은 초록 원(presence — DB에 안 쓰고 연결이 끊기면 서버가 지운다)이 붙고 맨 위로 온다.
// 순번을 매기지 않는다: 방문순에 번호를 붙이면 그 끝이 곧 "안 오는 사람" 순위가 된다(§8).
// 목록이 길어질 것을 전제로 스크롤을 카드 안에 둔다(창이 화면을 넘지 않게 max-h).
export function MembersModal({ members, myName, onClose }) {
  const online = usePresence();
  const ordered = React.useMemo(() => visitOrder(members, online), [members, online]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // **body 포털이 기본이다**(§6-1). 대시보드 뿌리에 걸린 .dc-screen의 transform 애니메이션이
  // 조상 containing block이 되어, 그냥 fixed로 두면 뷰포트가 아니라 그 안쪽을 기준으로
  // 박힌다 — 실제로 창이 화면 아래쪽에 나타나 하단 탭바에 잘렸다.
  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-lg shadow-elevated border border-line w-full max-w-sm max-h-[80dvh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h3 className="font-bold text-fg tracking-[-0.25px]">가입한 사람 {ordered.length}명</h3>
        </div>
        {/* 스크롤은 이 안에서만 — 창이 길어져 화면 밖으로 나가면 닫기 버튼을 못 찾는다 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 divide-y divide-line/60">
          {ordered.map(m => {
            const isOnline = online.has(m.id);
            return (
              <div key={m.id || m.name} className="flex items-center gap-2.5 py-2.5">
                {/* 접속 표시는 아바타 귀퉁이의 초록 원. 글자 배지보다 자리를 안 먹고,
                    사진 위에서도 읽힌다(바탕색 테두리로 뗀다) */}
                <span className="relative shrink-0 inline-flex">
                  <Avatar name={m.name} url={m.avatarUrl} className="flex w-7 h-7 text-xs" />
                  {isOnline && (
                    <span aria-hidden className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full"
                      style={{ background: 'var(--app-tag-green-fg)', boxShadow: '0 0 0 2px var(--app-surface)' }} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-fg truncate">
                    {m.name}{m.name === myName && <span className="ml-1 text-[10px] font-normal text-fg-faint">나</span>}
                  </span>
                  {/* 대표 팀만 보여주면 겸직(찬양팀+임원진)이 안 보인다 — 전부 적는다.
                      색은 첫 팀(대표) 것 하나만: 글자마다 딴 색이면 태그 잔치가 된다 */}
                  {(m.teams?.length || m.team) && (
                    <span className="block text-[11px] truncate" style={{ color: teamColor((m.teams?.[0]) || m.team) }}>
                      {[...new Set(m.teams?.length ? m.teams : [m.team])].join(' · ')}
                    </span>
                  )}
                </span>
                {/* 방문 기록이 없으면 가입 시각으로 — 가입하던 순간에도 앱에 있었다.
                    (0019 이전 가입자에게 '아직 방문 전'은 틀린 말이었다 — 사용자 지적) */}
                <span className="text-[11px] tabular-nums whitespace-nowrap shrink-0"
                  style={{ color: isOnline ? 'var(--app-tag-green-fg)' : 'var(--app-ink-muted)' }}>
                  {isOnline ? '접속 중' : (agoLabel(lastVisitOf(m)) || '기록 없음')}
                </span>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 shrink-0">
          <button onClick={onClose}
            className="w-full bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">닫기</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── 최근 활동 피드 (0020) ─────────────────────────────────────────────────────
// activity는 이미 쌓이고 있었는데 업무 창 안에만 갇혀 있었다 — 꺼내기만 하면 되는
// 데이터다. 클라우드는 서버 피드(activityFeed), 게스트는 tasks의 activityLog에서
// 파생한다(selectActivityFeed). 카드 제목은 스토어의 tasks에서 찾는다 — 피드에 제목을
// 박아 두면 제목을 바꿨을 때 피드만 옛 이름으로 남는다.
//
// **카드별로 묶는다.** 한 카드를 다듬으면 기록이 줄줄이 생겨서(제목·내용·상태가 각
// 한 줄) 같은 제목이 여덟 줄 반복됐고, 그게 대시보드를 길게 만든 주범이었다(사용자
// 지적). 카드마다 가장 최근 한 줄 + '외 N건'으로 접고, 다섯 카드까지만 그린다.
// '내 업무만 보기'는 접었다 — 이 칸의 값은 남들이 움직이는 게 보이는 것이라,
// 내 것만 남기면 참여를 부르는 자리가 내 메아리 방이 된다.
const FEED_ROWS = 5;

// 카드별 최근 한 줄 + 나머지 개수. 피드는 이미 최신순이라 처음 만나는 줄이 최근 것이다.
function groupFeed(feed) {
  const seen = new Map();
  const out = [];
  for (const a of feed) {
    const key = a.cardId || a.id;
    const head = seen.get(key);
    if (head) { head.more += 1; continue; }
    const row = { ...a, more: 0 };
    seen.set(key, row);
    out.push(row);
  }
  return out;
}

export function ActivityFeed({ feed, tasksById, onOpenTask }) {
  if (!feed.length) return null;
  return (
    <Card className="px-4 py-[15px]">
      <div className="pb-2">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">최근 활동</h3>
      </div>
      {groupFeed(feed).slice(0, FEED_ROWS).map(a => {
        const task = a.cardId ? tasksById[a.cardId] : null;
        const inner = (
          <>
            <Avatar name={a.actorName} className="flex w-[22px] h-[22px] text-[10.5px] mt-px" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5 min-w-0">
                {/* 카드가 지워졌으면 제목 없이 문장만 남는다 — 기록은 지워지지 않는다.
                    min-w-0: flex 항목은 기본 최소 폭이 내용 폭이라, 없으면 긴 제목이
                    시간 라벨을 오른쪽 끝에서 밀어낸다(줄마다 시간 x가 달라진다). */}
                <span className="text-[11px] font-semibold text-fg truncate min-w-0">{task ? task.title : a.actorName}</span>
                <span className="flex-1" />
                <span className="text-[10px] text-fg-faint tabular-nums whitespace-nowrap shrink-0">{agoLabel(a.at)}</span>
              </span>
              <span className="block text-[11px] text-fg-muted truncate">
                {task ? `${a.actorName}님이 ` : ''}{a.action}
                {a.more > 0 && <span className="text-fg-faint"> 외 {a.more}건</span>}
              </span>
            </span>
          </>
        );
        // 카드가 있으면 눌러서 연다. 없으면(지워진 카드) 그냥 줄이다
        return task ? (
          /* dc-row(줄 등장 애니메이션)를 쓰지 않는다 — 이 카드는 PeopleStrip처럼 정적인
             부속 정보이고, .dc-row는 마감 목록의 "행"이라는 뜻으로 검사들도 그 클래스로
             목록을 찾는다(여기 붙이면 피드 줄이 마감 목록 행으로 세어진다). */
          <button key={a.id} type="button" onClick={() => onOpenTask(task)}
            /* 폭은 calc(100%+16px)이어야 한다. w-full(=100%)에 -mx-2를 얹으면 왼쪽으로만 8px
               밀려 오른쪽이 16px 빈다(사용자가 지적한 공백). 그렇다고 w-full을 빼면 button은
               폼 요소라 display:flex여도 **내용 폭으로 줄어든다** — 줄마다 폭이 달라져 시간
               라벨이 제각각 섰다. 음수 마진만큼을 폭에 직접 더해 준다. */
            className="w-[calc(100%+16px)] flex items-start gap-2 py-[7px] -mx-2 px-2 rounded-[8px] text-left hover:bg-surface-hover transition-colors border-t border-line/60 first-of-type:border-t-0">
            {inner}
          </button>
        ) : (
          /* 버튼 줄과 같은 박스(-mx-2 px-2)를 준다 — 다르면 이 줄만 16px 좁아져서
             시간 라벨이 다른 줄과 다른 x에 선다(정렬이 흐트러진 원인 중 하나) */
          <div key={a.id} className="flex items-start gap-2 py-[7px] -mx-2 px-2 border-t border-line/60 first-of-type:border-t-0">
            {inner}
          </div>
        );
      })}
    </Card>
  );
}

// ── 연결 지도 — 사람 · 팀 · 프로젝트 (0019·0020 회차의 #28) ──────────────────
// "내가 어디에 붙어 있나"를 한 장으로. 세 열을 고정 좌표로 두고 선만 SVG로 긋는다 —
// force 시뮬레이션·측정(ResizeObserver) 없이 렌더와 같은 상수로 좌표를 계산한다.
// ── 프로젝트 연결 지도 — 힘 기반 노드 그래프 (2026-08-26) ─────────────────────
// 예전에는 사람·팀·프로젝트 3열 목록이었는데, 사람이 늘수록 **높이가 줄 수만큼
// 쌓였다**(사용자 지적). 지금은 노드가 서로 밀고(반발) 연결선이 당기는(스프링)
// 힘 배치라 높이가 고정이고, 자리 잡는 과정 자체가 모션이 된다.
//  · 의미는 유지한다 — 사람은 왼쪽, 팀은 가운데, 프로젝트는 오른쪽으로 **약하게**
//    끌어서(x 앵커) 3층 읽기가 남는다. 순수 force만 두면 어느 게 팀인지 한참 찾는다.
//  · prefers-reduced-motion이면 애니메이션 없이 정착된 상태를 바로 그린다.
//  · 판정어 없음(§8): 연결이 없는 사람도 그대로 보인다.
// ponytail: d3-force 대신 손 시뮬 60줄 — 노드 30개 안팎이라 O(n²) 반발도 공짜다.
//           노드가 수백이 되면 d3-force + 쿼드트리로 바꾼다.
const FM = { H_DESK: 340, H_MOBILE: 300, SETTLE_MS: 2600 };

function simStep(pos, vel, nodes, edges, W, H) {
  const REPEL = 2400, SPRING = 0.028, ANCHOR_X = 0.02, CENTER_Y = 0.012, DAMP = 0.86;
  for (let i = 0; i < nodes.length; i++) {
    let fx = 0, fy = 0;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      const d2 = Math.max(120, dx * dx + dy * dy);
      // 프로젝트 라벨은 제일 크다 — 서로는 더 세게 밀어야 안 겹친다
      const f = (REPEL / d2) * (nodes[i].kind === 'project' && nodes[j].kind === 'project' ? 3 : 1);
      const d = Math.sqrt(d2);
      fx += (dx / d) * f; fy += (dy / d) * f;
    }
    // 종류별 x 앵커 — 사람 20% · 팀 50% · 프로젝트 80%
    const ax = nodes[i].kind === 'member' ? W * 0.20 : nodes[i].kind === 'team' ? W * 0.5 : W * 0.80;
    fx += (ax - pos[i].x) * ANCHOR_X;
    fy += (H / 2 - pos[i].y) * CENTER_Y;
    vel[i].x = (vel[i].x + fx) * DAMP; vel[i].y = (vel[i].y + fy) * DAMP;
  }
  for (const [a, b, L] of edges) {
    const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const f = (d - L) * SPRING;
    const ux = dx / d, uy = dy / d;
    vel[a].x += ux * f; vel[a].y += uy * f;
    vel[b].x -= ux * f; vel[b].y -= uy * f;
  }
  for (let i = 0; i < nodes.length; i++) {
    pos[i].x = Math.min(W - nodes[i].pr, Math.max(nodes[i].pl, pos[i].x + vel[i].x));
    pos[i].y = Math.min(H - 16, Math.max(20, pos[i].y + vel[i].y));
  }
}

export function NetworkMap({ members, teamsInUse, projects, teamProjects, onOpenTeam, onOpenProject }) {
  const compact = useIsMobile();
  const H = compact ? FM.H_MOBILE : FM.H_DESK;
  const wrapRef = useRef(null);
  const [cw, setCw] = useState(compact ? 340 : 640);
  // 시뮬 폭은 760까지만 — 전폭 카드(1300px+)에서 그대로 돌리면 앵커가 양끝으로
  // 찢어 놓거나 스프링이 이겨 가운데 왼쪽에 뭉친다. 남는 폭은 여백으로 가운데 정렬.
  const W = Math.min(cw, 760);
  const offX = Math.max(0, (cw - W) / 2);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 노드·연결 목록 — pl/pr은 라벨이 카드 밖으로 나가지 않게 하는 좌우 여유다
  const { nodes, edges } = useMemo(() => {
    const nodes = [];
    const idx = new Map();
    const push = (n) => { idx.set(n.id, nodes.length); nodes.push(n); };
    members.forEach(m => push({ id: `m:${m.name}`, kind: 'member', m, pl: 30, pr: 46 }));
    teamsInUse.forEach(t => push({ id: `t:${t}`, kind: 'team', t, pl: 40, pr: 40 }));
    projects.forEach(p => push({ id: `p:${p.id}`, kind: 'project', p, pl: 56, pr: 60 }));
    const edges = [];
    members.forEach(m => [...new Set((m.teams?.length ? m.teams : [m.team]).filter(Boolean))].forEach(t => {
      if (idx.has(`t:${t}`)) edges.push([idx.get(`m:${m.name}`), idx.get(`t:${t}`), compact ? 62 : 92, teamColor(t)]);
    }));
    teamProjects.forEach(([team, pid]) => {
      if (idx.has(`t:${team}`) && idx.has(`p:${pid}`)) edges.push([idx.get(`t:${team}`), idx.get(`p:${pid}`), compact ? 76 : 110, teamColor(team)]);
    });
    return { nodes, edges };
  }, [members, teamsInUse, projects, teamProjects, compact]);

  // 초기 자리는 결정적으로(층마다 세로 등분) — 새로고침마다 다른 그림이 되지 않게
  const initPos = () => {
    const byKind = { member: [], team: [], project: [] };
    nodes.forEach(n => byKind[n.kind].push(n.id));
    return nodes.map((n, i) => {
      const layer = n.kind === 'member' ? 0.2 : n.kind === 'team' ? 0.5 : 0.8;
      const mates = byKind[n.kind];
      const k = mates.indexOf(n.id);
      return { x: W * layer + ((i * 37) % 13) - 6, y: 24 + ((k + 0.5) / mates.length) * (H - 48) };
    });
  };
  const [pos, setPos] = useState(initPos);
  const [hi, setHi] = useState(null);   // 만지고 있는 노드 index

  useEffect(() => {
    const p = initPos();
    const vel = p.map(() => ({ x: 0, y: 0 }));
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce) {
      for (let i = 0; i < 320; i++) simStep(p, vel, nodes, edges, W, H);
      setPos(p.map(o => ({ ...o })));
      return;
    }
    let raf; const t0 = performance.now();
    const tick = () => {
      for (let k = 0; k < 3; k++) simStep(p, vel, nodes, edges, W, H);
      setPos(p.map(o => ({ ...o })));
      if (performance.now() - t0 < FM.SETTLE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, W, H]);

  // 만진 노드와 그 이웃만 또렷하게 — 나머지는 흐린다
  const linked = useMemo(() => {
    if (hi == null) return null;
    const set = new Set([hi]);
    edges.forEach(([a, b]) => { if (a === hi) set.add(b); if (b === hi) set.add(a); });
    return set;
  }, [hi, edges]);

  return (
    <Card className="px-4 py-[15px]">
      <div className="flex items-center gap-2 pb-1">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">프로젝트 연결 지도</h3>
        <span className="text-[10px] text-fg-faint">사람 → 팀 → 프로젝트</span>
      </div>
      <div ref={wrapRef} className="relative select-none" style={{ height: H }}>
        <svg className="absolute inset-0 pointer-events-none" width={cw} height={H} aria-hidden>
          {edges.map(([a, b, , color], i) => {
            const on = hi != null && (a === hi || b === hi);
            const dim = hi != null && !on;
            return (
              <line key={i} x1={offX + (pos[a]?.x || 0)} y1={pos[a]?.y} x2={offX + (pos[b]?.x || 0)} y2={pos[b]?.y}
                stroke={color} strokeWidth={on ? 1.6 : 1.1} opacity={dim ? 0.12 : on ? 0.85 : 0.45}
                style={{ transition: 'opacity 200ms' }} />
            );
          })}
        </svg>
        {nodes.map((n, i) => {
          const P = pos[i];
          if (!P) return null;
          const dim = linked && !linked.has(i);
          const base = {
            position: 'absolute', left: offX + P.x, top: P.y, transform: 'translate(-50%, -50%)',
            opacity: dim ? 0.25 : 1, transition: 'opacity 200ms',
          };
          if (n.kind === 'member') {
            return (
              <span key={n.id} style={base} className="flex flex-col items-center gap-0.5"
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
                <Avatar name={n.m.name} url={n.m.avatarUrl} className="flex w-[20px] h-[20px] text-[9px]" />
                <span className="text-[9px] leading-none text-fg-muted whitespace-nowrap">{n.m.name}</span>
              </span>
            );
          }
          if (n.kind === 'team') {
            return (
              <button key={n.id} type="button" title={`${n.t} 보드로`} style={base}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
                onClick={() => onOpenTeam(n.t)}
                className="px-2 py-[3px] rounded-full text-[10.5px] font-bold whitespace-nowrap bg-surface border border-line transition hover:opacity-70">
                <span style={{ color: teamColor(n.t) }}>{n.t}</span>
              </button>
            );
          }
          return (
            <button key={n.id} type="button" title={`${n.p.title} 열기`} style={base}
              onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
              onClick={() => onOpenProject(n.p.id)}
              className="px-2.5 py-1 rounded-[8px] bg-surface shadow-soft border border-line text-[11.5px] font-bold text-fg whitespace-nowrap max-w-[180px] truncate transition hover:opacity-70">
              {n.p.title}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
