import React, { useState, useEffect, useRef } from 'react';
import { CONFIG, teamBar, teamColor } from '../config.js';
import { Avatar } from '../components/Avatar.jsx';
import { teamsLabel, byCompleted, completedTime, localDate } from '../utils.js';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { bucketOf, isOverdue, isStaleNoDue, STALE_NODUE_DAYS, personLoad, RECENT_DONE_DAYS } from '../services/taskCounts.js';

// ============================================================================
// 리디자인 공용 조각 — 대시보드 / 내 업무 / 팀 보드가 같은 부품을 쓴다.
// (핸드오프 문서의 "마감 그룹 리스트", "KPI 카드", 진행 바 규격)
// 대시보드에만 서는 큰 덩이 셋은 components/로 갈랐다(2026-10-07 19차) — 사람 칸·가입한 사람 창
// `peopleStrip.jsx` · 최근 활동 `activityFeed.jsx` · 연결 지도 `networkMap.jsx`.
// ============================================================================

// 움직임을 줄여 달라고 한 사람 — index.css가 애니메이션·전환을 통째로 끄므로
// (§4.2) 자라는 연출을 붙이는 자리는 처음부터 최종 값으로 그려야 한다.
// 안 그러면 전환이 없어서 0에 멈춘 빈 바가 남는다. 판정은 hooks/useReducedMotion.js 한 벌이고,
// 여기서 가져가던 자리(wordBible)를 위해 이어서 내보낸다.
export { prefersReducedMotion };

export const ISO_TODAY = () => localDate(new Date());
// 남은 날 수 (음수 = 지남). 자정 기준으로 비교해야 "오늘"이 시간대에 따라 흔들리지 않는다.
export const daysLeft = (iso, today = ISO_TODAY()) =>
  Math.round((new Date(`${iso}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
const mdLabel = (iso) => `${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;
// 청년별 셈은 services/taskCounts.js 한 벌이다 — 여기서는 이어서 내보내기만 한다
// (views가 이 파일에서 가져간다).
export { personLoad };

// 마감 기준 구간 — 판정은 taskCounts.bucketOf(열쇠)이고 여기는 라벨·색만 둔다.
// '마감 미정'을 따로 두는 이유: 예전에는 '다음 주 이후'에 섞여 있어서 마감을 정하지
// 않은 업무가 몇 건인지 아무 데도 안 보였다. 마감 중심 화면인데 마감이 없는 업무가
// 가장 조용히 묻혔다. **상시**(마감 없이 계속 사는 업무)와 **보류 중**(멈춘 일)은 날짜
// 구간에 섞지 않고 제 구간을 가진다 — 마감 미정에 섞이면 '2주 넘은 것'이 거짓이 된다.
const BUCKETS = [
  { key: 'overdue', label: '지연', fg: 'var(--app-tag-red-fg)' },
  { key: 'today', label: '오늘 마감', fg: 'var(--app-ink)' },
  { key: 'week', label: '이번 주', fg: 'var(--app-ink)' },
  { key: 'later', label: '다음 주 이후', fg: 'var(--app-ink-muted)' },
  { key: 'nodue', label: '마감 미정', fg: 'var(--app-ink-muted)' },
  { key: 'ongoing', label: '상시', fg: 'var(--app-tag-purple-fg)' },
  { key: 'hold', label: '보류 중', fg: 'var(--app-ink-muted)' },
  { key: 'done', label: '끝낸 업무', fg: 'var(--app-tag-green-fg)' },
];
// 마감 없는 업무가 뒤로 가도록 정렬 (마감일 오름차순).
// 칸반 컬럼 안 순서도 이걸 쓴다 — 목록과 보드가 서로 다른 순서를 보이면 안 된다.
export const byDue = (a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));

// '끝낸 업무'만 마감일이 아니라 **최근에 끝낸 것부터** 선다(사용자 결정 2026-08-31).
// 나머지 구간은 "앞으로 무엇이 급한가"라 마감일 오름차순이 맞지만, 끝낸 업무는
// 앞으로 할 일이 아니라 기록이고 방금 끝낸 것이 맨 위여야 한다 — 예전에는
// '내 업무'에서 완료를 누를 때마다 그 줄이 몇 년 전 업무들 아래로 사라졌다.
// **그 구간은 날짜 칸도 마감일이 아니라 끝낸 날이다**(아래 dateOf) — 정렬 기준이
// 화면에 없으면 목록이 뒤죽박죽으로 읽힌다(사용자 지적 2026-08-31).
// recentDone: 기본 목록(상태 칩을 안 고른 내 업무 · 팀 보드) 맨 아래의 **최근 7일 안에 완료한 업무**
// (사용자 결정 2026-09-25 · 목업 mockup-traces 3). 그 구간만 머리가 `완료한 업무` + 흐린 `최근 7일`이다 —
// '완료' 칩으로 전부 볼 때는 예전 이름 그대로. 무엇이 7일 안인지는 taskCounts.isRecentlyDone이 정한다.
// ongoing: 상시 구간을 세울지. **기본은 뺀다**(사용자 결정 2026-09-27 — 대시보드·내 업무·팀 업무에서
// 상시를 보이지 않게). 상시는 보드 네 칸 위 한 줄에서만 보이고, 내 업무에서 '상시' 칩을 골랐을 때만 여기 선다.
export function groupByDue(tasks, today = ISO_TODAY(), { recentDone = false, ongoing = false } = {}) {
  return BUCKETS.filter(b => ongoing || b.key !== 'ongoing').map(b => ({
    ...b,
    ...(recentDone && b.key === 'done' ? { label: '완료한 업무', note: `최근 ${RECENT_DONE_DAYS}일` } : null),
    items: tasks.filter(t => bucketOf(t, today) === b.key).sort(b.key === 'done' ? byCompleted : byDue),
  })).filter(g => g.items.length);
}

// 줄 왼쪽 날짜 칸에 무엇을 쓰나. '끝낸 업무'는 끝낸 날(정렬 기준과 같은 값),
// 나머지는 마감일. 끝낸 날을 모르는 옛 데이터는 마감일로 떨어진다.
// 끝낸 날은 **로컬 날짜**다(타임스탬프 앞 10자는 UTC라 한국 아침 9시 전에 끝낸 것이 전날로 찍혔다).
export const rowDate = (t, bucketKey) => (bucketKey === 'done'
  ? (localDate(completedTime(t)) || t.dueDate || '')
  : (t.dueDate || ''));

// 상태 → 진행 바 파스텔
export const STATUS_BAR = {
  '시작 전': 'var(--p-gray)',
  '진행 중': 'var(--p-blue)',
  '보류 중': 'var(--p-yellow)',
  '완료': 'var(--p-green)',
  '상시': 'var(--p-purple)',
};
// 상태 → 점 색 (CSS 변수 — 인라인 style에서 쓴다)
export const STATUS_DOT_VAR = {
  '시작 전': 'var(--app-ink-faint)',
  '진행 중': 'var(--app-accent)',
  '보류 중': 'var(--app-status-hold)',
  '완료': 'var(--app-tag-green-fg)',
  '상시': 'var(--app-tag-purple-fg)',
};

// ── 진행 바 (scaleX) ───────────────────────────────────────────────────────
// **화면이 뜰 때 0에서 자란다**(사용자 결정 2026-08-31). 전환(transition)은 마운트에서
// 돌지 않으므로 첫 그림은 scaleX(0)으로 두고, 잠깐 뒤에 실제 값으로 바꿔서 이미 걸려
// 있는 `.dc-bar-fill` 전환(.55s)이 그때 돌게 한다. 예전에는 KPI 숫자가 순번대로
// 들어오는 동안 바만 이미 꽉 차 있어서 순서가 어긋나 보였다.
// 값이 바뀔 때(상태를 옮기거나 필터를 바꿀 때)는 지연 없이 바로 이어진다.
const BAR_MOUNT_DELAY = 160;   // KPI 칸 등장(320ms)의 중간쯤 — 숫자가 먼저 읽힌다
export function Bar({ ratio, color, height = 4 }) {
  const target = Math.max(0, Math.min(1, ratio || 0));
  const grown = useRef(false);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (grown.current || prefersReducedMotion()) { setShown(target); return; }
    const id = setTimeout(() => { grown.current = true; setShown(target); }, BAR_MOUNT_DELAY);
    return () => clearTimeout(id);
  }, [target]);
  return (
    <span className="block rounded-full overflow-hidden" style={{ height, background: 'var(--p-track)' }}>
      <span className="dc-bar-fill block h-full rounded-full"
        style={{ background: color, transform: `scaleX(${shown.toFixed(3)})` }} />
    </span>
  );
}

// ── 상태 4색 세그먼트 바 (프로젝트 진행) ───────────────────────────────────
export function StatusSegments({ counts, total }) {
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : '0%');
  return (
    <span className="flex rounded-xs overflow-hidden" style={{ height: 7, background: 'var(--p-track)' }}>
      {CONFIG.STATUSES.slice().reverse().map(s => (
        <span key={s} className="block h-full" style={{ width: pct(counts[s] || 0), background: STATUS_BAR[s] }} />
      ))}
    </span>
  );
}

// ── KPI 카드 한 칸 ────────────────────────────────────────────────────────
// 1px 격자(부모가 background:line + gap:1px)를 쓰므로 카드 자체는 배경만 칠한다.
// 격자 밖에 혼자 서는 칸(대시보드 '전체 진척도' · 팀 보드 '완료')도 같은 부품이다 — 껍데기만
// className/style로 바꾼다(KPI_SOLO · 둥근 테두리는 부르는 쪽이 얹는다).
//   tone="green"  팀 보드 '완료' — 바탕·글자가 초록이고 메모는 흐린 초록
//   phoneNote     메모를 폰에서도 보인다. 격자 칸의 메모('마감이 지난 업무')는 폰에서 숨기지만,
//                 '12/30건'·'전체 N건 중'은 값의 분모라 빼면 숫자가 혼자 남는다.
const KPI_CELL = 'dc-kpi flex flex-col gap-[9px] px-4 pt-3.5 pb-[13px] transition-colors';
export const KPI_SOLO = 'dc-kpi flex flex-col gap-[9px] justify-center px-4 pt-3.5 pb-[13px]';
const KPI_TONE = {
  green: { bg: 'var(--app-tag-green)', fg: 'var(--app-tag-green-fg)', label: 'var(--app-tag-green-fg)' },
  alert: { bg: 'var(--app-tag-red)', fg: 'var(--app-tag-red-fg)', label: 'var(--app-tag-red-fg)' },
  plain: { bg: 'var(--app-surface)', fg: 'var(--app-ink)', label: 'var(--app-ink-muted)' },
};
export function KpiCell({ dot, label, value, unit = '건', note, ratio, bar, alert, delay = 0, tone, phoneNote = false, className = KPI_CELL, style }) {
  const t = KPI_TONE[tone || (alert ? 'alert' : 'plain')];
  return (
    <div
      className={className}
      style={{ background: t.bg, animationDelay: `${delay}ms`, ...style }}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
        <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: t.label }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-[5px]">
        <span className="text-[34px] font-extrabold leading-none tabular-nums" style={{ letterSpacing: '-1.8px', color: t.fg }}>{value}</span>
        {unit && <span className="text-xs font-semibold" style={{ color: t.label }}>{unit}</span>}
        <span className="flex-1" />
        {note && (tone === 'green'
          ? <span className={`${phoneNote ? '' : 'hidden md:inline '}text-[10.5px] tabular-nums whitespace-nowrap`} style={{ color: t.fg, opacity: .7 }}>{note}</span>
          : <span className={`${phoneNote ? '' : 'hidden md:inline '}text-[10.5px] tabular-nums whitespace-nowrap text-fg-muted`}>{note}</span>)}
      </div>
      <Bar ratio={ratio} color={bar} />
    </div>
  );
}

// ── 마감 그룹 리스트 ──────────────────────────────────────────────────────
// 대시보드·내 업무·팀 보드가 같이 쓴다. meta로 프로젝트만/팀까지 표시를 고른다.
const GROUP_LIMIT = 30;   // 한 구간에 먼저 그리는 줄 수. 나머지는 '더 보기'
const COMPLETE_DRAW_MS = 360;   // 완료 원이 튀고 체크가 다 그려지는 시간(60ms 지연 + 240ms) + 여유
// 줄 왼쪽 원의 확인 팝오버 두 갈래 — 끝낸 줄은 진행 중으로 되돌리고, 남은 줄은 완료로 옮긴다
const DONE_ASK = {
  undo: {
    next: '진행 중', confirmLabel: '되돌리기', title: '완료 취소', filled: true,
    message: (title) => `'${title}'을 다시 진행 중으로 되돌릴까요?`, aria: (title) => `${title} 완료 취소`,
    className: 'w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-70',
    style: { background: 'var(--app-tag-green-fg)' },
  },
  done: {
    next: '완료', confirmLabel: '완료', title: '완료로 옮기기', filled: false,
    message: (title) => `'${title}'을 완료로 옮길까요?`, aria: (title) => `${title} 완료로 옮기기`,
    className: 'group/done w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-colors',
    style: { border: '1.5px solid var(--app-line)' },
  },
};

export function DueGroupList({ groups, projectsMap, today, onComplete, onOpen, showTeam = true, emptyHint }) {
  const [expanded, setExpanded] = useState({});   // { [구간 key]: true }
  // 순차 등장은 처음 열 때만 — 그 뒤에 구간을 옮겨 다시 마운트되는 줄(완료로 옮긴 업무,
  // '더 보기'로 펼친 줄)은 지연 없이 바로 나타나야 한다(useEnterStagger 주석).
  const stagger = useEnterStagger();
  // 작은 완료의 손맛(2026-09-25 · index.css `.dc-ring-now`·`.dc-check-now`): 완료를 확정하면 **그 자리에서**
  // 원이 채워지며 튀고 체크가 그려진 뒤(340ms) 저장한다 — 대시보드는 끝낸 줄을 목록에서 빼므로 저장부터
  // 하면 움직임이 보일 자리가 없다. 방금 누른 줄에만 걸리고(실시간으로 남이 끝낸 줄은 이 길을 안 탄다),
  // 되돌리기는 기다리지 않는다. 움직임을 줄인 사람에게는 기다릴 까닭이 없어 바로 저장한다(PITFALLS 9-cg).
  const [pending, setPending] = useState(() => new Set());
  const pendTimers = useRef([]);
  useEffect(() => () => pendTimers.current.forEach(clearTimeout), []);
  const complete = (t, next) => {
    if (next !== '완료' || prefersReducedMotion()) { onComplete(t, next); return; }
    setPending(p => new Set(p).add(t.id));
    pendTimers.current.push(setTimeout(() => {
      setPending(p => { const n = new Set(p); n.delete(t.id); return n; });
      onComplete(t, next);
    }, COMPLETE_DRAW_MS));
  };

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
        // 마감 미정 구간에서 2주 넘게 손대지 않은 건수(taskCounts.isStaleNoDue) — 제목 줄에만 적는다
        const staleCount = g.key === 'nodue' ? g.items.filter(t => isStaleNoDue(t, today)).length : 0;
        return (
        <div key={g.key} className="pb-4">
          <div className="flex items-center gap-2 pb-[5px]">
            <span className="text-xs font-bold" style={{ color: g.fg }}>{g.label}</span>
            <span className="text-[11px] font-semibold tabular-nums text-fg-muted">{g.items.length}건</span>
            {g.note && <span data-group-note="" className="text-[11px] tabular-nums text-fg-muted whitespace-nowrap">{g.note}</span>}
            {staleCount > 0 && (
              <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap" style={{ color: 'var(--app-status-hold)' }}>
                · {STALE_NODUE_DAYS / 7}주 넘은 것 {staleCount}건
              </span>
            )}
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          </div>
          {shown.map(t => {
            const delay = stagger ? `${Math.min(seen++, 12) * 22}ms` : '0ms';
            const done = t.status === '완료';
            const drawing = !done && pending.has(t.id);   // 방금 완료를 누른 줄(저장 전 340ms)
            // 빨강은 taskCounts.isOverdue 하나 — 보류 중인 업무의 지난 마감은 회색이다
            const over = isOverdue(t, today);
            const isToday = g.key === 'today';
            // 한 줄에서 두 번(title·색) 묻던 판정 — 값이 같아야 노란 글자와 그 설명이 짝이 된다
            const stale = isStaleNoDue(t, today);
            const teams = teamsLabel(t.teams);
            const ask = DONE_ASK[done ? 'undo' : 'done'];
            return (
              <div
                key={t.id}
                className="dc-row flex items-center gap-3 p-2.5 -mx-2.5 rounded-md hover:bg-surface-hover transition-colors"
                style={{ animationDelay: delay, transitionDuration: '120ms' }}
              >
                {/* 완료 처리 — 목록에서 바로 끝낼 수 있어야 '지금 뭘 해야 하나' 화면이 된다.
                    한 번의 오터치로 상태가 바뀌지 않게 확인을 한 번 받는다.
                    이미 끝난 건은 같은 자리에서 되돌린다(같은 상태로 저장은 아무 일도 안 하니
                    버튼이 죽은 것처럼 보였다). */}
                {drawing ? (
                  <span className="shrink-0 inline-flex">
                    <span aria-hidden data-done-drawing=""
                      className="dc-ring-now w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--app-tag-green-fg)' }}>
                      <Checkmark filled now />
                    </span>
                  </span>
                ) : (
                  <ConfirmPopover
                    className="shrink-0 inline-flex" tone="ok" confirmLabel={ask.confirmLabel}
                    title={ask.title} message={ask.message(t.title)}
                    onConfirm={() => complete(t, ask.next)}
                  >
                    <span role="button" aria-label={ask.aria(t.title)} className={ask.className} style={ask.style}>
                      <Checkmark filled={ask.filled} />
                    </span>
                  </ConfirmPopover>
                )}
                <button type="button" onClick={() => onOpen(t)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  {/* 마감이 2주 넘게 안 정해진 건은 '미정'을 노란색으로 — 구간 제목의
                      건수와 같은 색이라 어느 줄이 그건지 눈으로 이어진다 */}
                  {/* '끝낸 업무' 구간은 마감일이 아니라 **끝낸 날**이다 — 이 구간의
                      정렬 기준이 그 값이고, 칸에 안 보여주면 날짜가 뒤죽박죽으로
                      읽힌다(사용자 지적 2026-08-31). title로 마감일도 같이 알려준다. */}
                  <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
                    title={done
                      ? (t.dueDate ? `끝낸 날 · 마감은 ${mdLabel(t.dueDate)}였어요` : '끝낸 날')
                      : stale ? `마감 미정으로 ${STALE_NODUE_DAYS / 7}주 넘게 그대로예요` : undefined}
                    style={{
                      color: over ? 'var(--app-tag-red-fg)'
                        : isToday ? 'var(--app-ink)'
                        : stale ? 'var(--app-status-hold)'
                        : 'var(--app-ink-muted)',
                    }}>
                    {/* 상시는 날짜가 없는 것이 제 모양이라 '미정'을 쓰지 않는다(칸은 비워 제목 자리를 맞춘다) */}
                    {rowDate(t, g.key) ? mdLabel(rowDate(t, g.key)) : g.key === 'ongoing' ? '' : '미정'}
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
                      <span className="text-[10.5px] text-fg-muted truncate">{projectsMap[t.projectId]?.title || '프로젝트 미지정'}</span>
                      {/* 팀이 여럿이면 `웰컴팀 외 2팀`. 예전에는 teams[0] 하나만 그려서
                          여러 팀이 붙은 업무는 나머지가 화면 어디에도 없었다 — "9월
                          월례회는 웰컴팀 일"로 읽혔다(사용자 지적 2026-08-29).
                          색은 대표 팀 색 하나로 간다(팀마다 색을 나눠 칠하면 이 줄이
                          알록달록해져서 상태·프로젝트와 구분이 사라진다).
                          shrink-0: 폭이 밀릴 때 양보하는 것은 프로젝트 이름 쪽이다. */}
                      {showTeam && teams && (
                        <>
                          <span className="w-0.5 h-0.5 rounded-full shrink-0" style={{ background: 'var(--app-line)' }} />
                          <span className="text-[10.5px] font-semibold whitespace-nowrap shrink-0" style={{ color: teamColor(teams.lead) }}>
                            {teams.lead}
                            {teams.more > 0 && <span className="font-medium opacity-75"> 외 {teams.more}팀</span>}
                          </span>
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
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-xs"
                    style={{ background: CONFIG.STATUS_BG_VAR[t.status] || 'transparent' }}
                    title={t.status}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT_VAR[t.status] }} />
                    <span className="text-[11px] font-semibold" style={{ color: CONFIG.STATUS_FG_VAR[t.status] || 'var(--app-ink-muted)' }}>{t.status}</span>
                  </span>
                  <Avatar name={t.assignees?.[0] || ''} title={t.assignees?.[0] || '미지정'}
                    className="hidden sm:inline-flex w-[22px] h-[22px] text-[10.5px]" />
                </button>
              </div>
            );
          })}
          {hidden > 0 && (
            <button
              type="button" onClick={() => setExpanded(p => ({ ...p, [g.key]: true }))}
              className="w-full mt-1 py-2 rounded-md text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99]"
            >{hidden}건 더 보기</button>
          )}
        </div>
        );
      })}
    </div>
  );
}

// 다 끝난 화면의 표식 — 원이 살짝 커지며 나타나고 **그 뒤에** 체크가 그려진다.
// 로티 파일을 물리는 대신 SVG 한 장으로 같은 인상을 낸다(의존성·네트워크 없음).
// 체크의 지연은 원(.dc-draw-ring)의 길이와 같아야 한다 — .dc-draw의 기본 지연은
// .1s라서, 그대로 두면 원이 아직 커지는 중에 체크가 겹쳐 그려졌다(순서가 없었다).
function AllClearMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-12 h-12 mx-auto" aria-hidden="true">
      <circle className="dc-draw-ring" cx="24" cy="24" r="21" fill="var(--app-tag-green)" style={{ transformOrigin: 'center' }} />
      <path
        className="dc-draw" pathLength="1" d="M15 24.5 21.5 31 34 18" style={{ animationDelay: '.28s' }}
        fill="none" stroke="var(--app-tag-green-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// 완료 버튼 안의 체크 — 미완료는 hover에서 진해지고, 끝낸 건은 초록 원 위 흰 체크
// now — 방금 누른 완료: 체크를 선으로 그린다(pathLength=1 · index.css `.dc-check-now`)
function Checkmark({ filled = false, now = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={filled ? '#fff' : 'var(--app-tag-green-fg)'} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      className={filled ? `w-[11px] h-[11px]${now ? ' dc-check-now' : ''}` : 'w-[11px] h-[11px] opacity-40 group-hover/done:opacity-100 transition-opacity'}>
      <path pathLength="1" d="M20 6 9 17l-5-5" />
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
  if (!people.length) return <p className="text-[11px] text-fg-muted">모두 정리되었어요</p>;
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
          {/* 사람마다 빨간 '지연 N건'·빨간 막대를 두었다가 걷었다(사용자 결정 2026-09-25) —
              누가 밀렸는지 가리키는 줄이 되어 사람끼리 견주는 구조였다(§8). 지연은 업무 쪽
              (KPI·마감 목록)에서 보인다. */}
          <span className="block mt-[5px]"><Bar ratio={p.left / max} color="var(--p-blue)" /></span>
        </div>
      ))}
    </div>
  );
}

// ── 섹션 제목 (줄 있는 것 / 없는 것) ──────────────────────────────────────
// `wrapRight` — 오른쪽 묶음이 **두 줄로 접히는** 머리줄(순모임 가이드처럼 버튼이
// 넷 이상). 기본(items-center)으로 두면 그 묶음이 두 줄이 되는 순간 제목과 가로선이
// 두 줄 덩이의 세로 가운데로 내려가, 선이 버튼 사이를 관통하고 제목이 첫 줄 버튼과
// 다른 높이에 선다(사용자 지적 2026-09-09 — 375에서 '고정 해제'가 제목과 겹쳐 보였다).
// 그때는 위로 맞추고 가로선만 제목의 한가운데 높이로 내린다.
export function SectionHead({ children, right, wrapRight = false }) {
  return (
    <div className={`flex gap-2 pb-2.5 ${wrapRight ? 'items-start' : 'items-center'}`}>
      <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">{children}</h3>
      <span className={`flex-1 h-px ${wrapRight ? 'mt-[9px]' : ''}`} style={{ background: 'var(--app-line)' }} />
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

