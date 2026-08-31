import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CONFIG, teamBar, teamColor } from '../config.js';
import { Avatar } from '../components/Avatar.jsx';
import { visitOrder, agoLabel, lastVisitOf, teamsLabel, byCompleted, completedTime, spreadLabels } from '../utils.js';
import { usePresence } from '../services/presence.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { useForceGraph } from '../hooks/useForceGraph.js';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';

// ============================================================================
// 리디자인 공용 조각 — 대시보드 / 내 업무 / 팀 보드가 같은 부품을 쓴다.
// (핸드오프 문서의 "마감 그룹 리스트", "KPI 카드", 진행 바 규격)
// ============================================================================

// 움직임을 줄여 달라고 한 사람 — index.css가 애니메이션·전환을 통째로 끄므로
// (§4.2) 자라는 연출을 붙이는 자리는 처음부터 최종 값으로 그려야 한다.
// 안 그러면 전환이 없어서 0에 멈춘 빈 바가 남는다.
export const prefersReducedMotion = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

// '끝낸 업무'만 마감일이 아니라 **최근에 끝낸 것부터** 선다(사용자 결정 2026-08-31).
// 나머지 구간은 "앞으로 무엇이 급한가"라 마감일 오름차순이 맞지만, 끝낸 업무는
// 앞으로 할 일이 아니라 기록이고 방금 끝낸 것이 맨 위여야 한다 — 예전에는
// '내 업무'에서 완료를 누를 때마다 그 줄이 몇 년 전 업무들 아래로 사라졌다.
// **그 구간은 날짜 칸도 마감일이 아니라 끝낸 날이다**(아래 dateOf) — 정렬 기준이
// 화면에 없으면 목록이 뒤죽박죽으로 읽힌다(사용자 지적 2026-08-31).
export function groupByDue(tasks, today = ISO_TODAY()) {
  return BUCKETS.map((b, i) => ({
    ...b,
    items: tasks.filter(t => bucketOf(t, today) === i).sort(b.key === 'done' ? byCompleted : byDue),
  })).filter(g => g.items.length);
}

// 줄 왼쪽 날짜 칸에 무엇을 쓰나. '끝낸 업무'는 끝낸 날(정렬 기준과 같은 값),
// 나머지는 마감일. 끝낸 날을 모르는 옛 데이터는 마감일로 떨어진다.
export const rowDate = (t, bucketKey) => (bucketKey === 'done'
  ? (completedTime(t).slice(0, 10) || t.dueDate || '')
  : (t.dueDate || ''));

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

export function DueGroupList({ groups, projectsMap, today, onComplete, onOpen, showTeam = true, emptyHint }) {
  const [expanded, setExpanded] = useState({});   // { [구간 key]: true }
  // 순차 등장은 처음 열 때만 — 그 뒤에 구간을 옮겨 다시 마운트되는 줄(완료로 옮긴 업무,
  // '더 보기'로 펼친 줄)은 지연 없이 바로 나타나야 한다(useEnterStagger 주석).
  const stagger = useEnterStagger();

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
            const delay = stagger ? `${Math.min(seen++, 12) * 22}ms` : '0ms';
            const done = t.status === '완료';
            const over = !done && t.dueDate && t.dueDate < today;
            const isToday = !done && t.dueDate === today;
            const teams = teamsLabel(t.teams);
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
                  {/* '끝낸 업무' 구간은 마감일이 아니라 **끝낸 날**이다 — 이 구간의
                      정렬 기준이 그 값이고, 칸에 안 보여주면 날짜가 뒤죽박죽으로
                      읽힌다(사용자 지적 2026-08-31). title로 마감일도 같이 알려준다. */}
                  <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
                    title={done
                      ? (t.dueDate ? `끝낸 날 · 마감은 ${mdLabel(t.dueDate)}였어요` : '끝낸 날')
                      : isStaleNoDue(t, today) ? `${STALE_NODUE_DAYS / 7}주 넘게 마감이 정해지지 않았어요` : undefined}
                    style={{
                      color: over ? 'var(--app-tag-red-fg)'
                        : isToday ? 'var(--app-ink)'
                        : isStaleNoDue(t, today) ? 'var(--app-status-hold)'
                        : 'var(--app-ink-muted)',
                    }}>
                    {rowDate(t, g.key) ? mdLabel(rowDate(t, g.key)) : '미정'}
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
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-[4px]"
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
              className="w-full mt-1 py-2 rounded-[8px] text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99]"
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
  // 오른쪽 끝의 'N분 전'은 그릴 때의 시각으로 굳는다 — 창을 열어 둔 동안 같이 늙게 한다
  useMinuteTick();
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
  // 줄 오른쪽의 'N분 전'이 굳지 않게 — 대시보드는 켜 둔 채로 오래 보는 화면이다.
  // 훅은 조건부 return보다 **먼저** 불러야 한다(리액트 규칙).
  useMinuteTick();
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
// ── 프로젝트 연결 지도 — 힘 기반 노드 그래프 (2026-08-26 · 27) ─────────────────
// 예전에는 사람·팀·프로젝트 3열 목록이라 사람이 늘수록 높이가 줄 수만큼 쌓였다
// (사용자 지적). 지금은 힘 배치라 높이가 고정이고 자리 잡는 과정이 모션이다.
//  · **팀은 가운데 열에 고정**(사용자 결정 2026-08-27 — 순수 force로 두었더니
//    어디가 팀인지 흔들렸다). 사람·프로젝트만 그 주위에 떠 있다.
//  · **사람·프로젝트 노드는 손으로 끌 수 있다**(사용자 요청 — 겹치면 직접 편다).
//    시뮬·드래그·클릭 삼킴은 useForceGraph가 한다(그래프 뷰와 공용).
//  · 판정어 없음(§8): 연결이 없는 사람도 그대로 보인다.
// 배치 상수 한 곳 — **노드 앵커 · 열 머리글 · 선의 목표 길이가 같은 값을 본다.**
// 예전에는 세 군데에 숫자를 흩뿌려서 '프로젝트' 머리글(0.8)과 실제 앵커(0.85)가
// 어긋나 있었다.
const FM = {
  // 높이는 **줄 수를 따라간다**(2026-08-31). 340px에 프로젝트 15개를 넣으면 한 칸이
  // 22px인데 라벨이 26px이라 겹칠 수밖에 없었다(사용자 스크린샷의 그 상태다).
  H_MIN_DESK: 340, H_MAX_DESK: 540, ROW_DESK: 30,
  H_MIN_MOB: 300, H_MAX_MOB: 580, ROW_MOB: 30,
  // 시뮬 폭 — **데스크톱은 카드를 다 쓴다**(2026-08-31 사용자 지적 — "좌우 공간이 많이
  // 남는다"). 예전에 760으로 묶어 둔 이유는 "넓으면 앵커가 양끝으로 찢는다"였는데,
  // 그건 폭 탓이 아니라 **선의 목표 길이가 고정(92·150px)이라 앵커 간격과 싸운 것**
  // 이었다. 지금은 목표 길이를 앵커 간격에서 뽑으므로(EDGE_OF) 폭에 따라 같이 늘고,
  // 넓어질수록 오히려 조용해진다(실측: 총이동 168 → 52px/노드).
  // 1400으로 한 번 묶어 봤더니 1858px 카드에서 좌우 229px씩 또 남았다 → 상한을 없앤다.
  // x 앵커(폭 비율): 사람 · 팀 · 프로젝트.
  // 프로젝트 라벨이 180px까지라 0.84에 세우면 오른쪽 끝(+90)이 카드 경계에 딱 맞는다.
  AX_DESK: { m: 0.09, t: 0.44, p: 0.84 },
  AX_MOB: { m: 0.16, t: 0.44, p: 0.84 },
  // 라벨 최소 간격 — 그릴 때 utils.spreadLabels가 이만큼은 띄운다(층별)
  GAP_DESK: { m: 36, t: 22, p: 30 },
  GAP_MOB: { m: 36, t: 20, p: 30 },
  // 층이 가로로 헤맬 수 있는 범위(폭 비율). 겹침은 그릴 때 y로 풀므로 가로 흔들림은
  // 그냥 잡음이다 — 좁혀서 **열로 읽히게** 한다. 넓게 뒀더니 프로젝트 라벨이 팀 열
  // 위로 들어왔다(모바일에서 특히). 끌기는 세로로는 그대로 자유롭다.
  ZX_DESK: { m: [0.02, 0.20], p: [0.78, 0.99] },
  ZX_MOB: { m: [0.02, 0.30], p: [0.76, 0.99] },
  // 끌 때만 쓰는 넓은 범위(utils.forceBounds의 drag). 시뮬 범위로 끌면 몇십 px에서
  // 벽에 부딪혀 뻑뻑하다(사용자 지적 2026-08-31). **층 밖으로는 여전히 못 나간다**
  // (사용자 결정 2026-08-27) — 넓어진 것은 자기 층 안에서의 여유뿐이다.
  ZXD_DESK: { m: [0.02, 0.40], p: [0.58, 0.99] },
  ZXD_MOB: { m: [0.02, 0.42], p: [0.52, 0.99] },
};
// 선의 목표 길이 = 두 층의 앵커 간격. 스프링이 앵커와 싸우지 않으므로 가로로는
// 가만히 있고 **세로로만** 이어진 짝을 끌어당긴다 — 그게 이 그림이 원하는 힘이다.
const EDGE_OF = (a, b, W) => Math.max(48, (b - a) * W);

export function NetworkMap({ members, teamsInUse, projects, teamProjects, teamLeft = {}, memberLoad, onOpenTeam, onOpenProject }) {
  const compact = useIsMobile();
  const wrapRef = useRef(null);
  // **폭을 재기 전에는 배치하지 않는다**(cw = 0 · 2026-08-31 사용자 지적 — "모바일에서
  // 렌더링될 때 뚜둑하면서 펼쳐지는 느낌"). 예전에는 짐작한 폭(340/640)으로 한 번
  // 배치하고, ResizeObserver가 진짜 폭을 알려주면 W가 바뀌어 **처음부터 다시** 배치했다.
  // 그 두 번째 배치가 눈에 보이는 "뚜둑"이었다. 모바일은 더 심했다 — '연결' 탭이
  // 숨어 있는 동안 clientWidth가 0이라 하한(280)으로 한 번 더 배치됐다.
  const [cw, setCw] = useState(0);
  // 가장 붐비는 층이 높이를 정한다 — 라벨이 겹치지 않을 만큼만 키우고 상한에서 멈춘다
  const rows = Math.max(members.length, teamsInUse.length, projects.length, 1);
  const H = compact
    ? Math.min(FM.H_MAX_MOB, Math.max(FM.H_MIN_MOB, rows * FM.ROW_MOB + 60))
    : Math.min(FM.H_MAX_DESK, Math.max(FM.H_MIN_DESK, rows * FM.ROW_DESK + 60));
  const W = cw;   // 카드 폭을 그대로 쓴다(좌우 여백을 만들지 않는다)
  const offX = 0;
  const AX = compact ? FM.AX_MOB : FM.AX_DESK;
  const ZX = compact ? FM.ZX_MOB : FM.ZX_DESK;
  const ZXD = compact ? FM.ZXD_MOB : FM.ZXD_DESK;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // 숨어 있는 동안(clientWidth 0)은 0으로 둔다 — 하한으로 배치해 두면 보일 때
    // 다시 배치되고 그게 "뚜둑"이다. 창을 몇 px 흔드는 것으로 다시 배치되지 않게
    // 8px 단위로 끊는다(회전·창 크기 변경은 그대로 따라간다).
    const read = () => {
      const w = el.clientWidth;
      setCw(w < 200 ? 0 : Math.round(w / 8) * 8);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 노드·연결 목록 ─────────────────────────────────────────────────────────
  // **사람과 프로젝트를 자기 팀의 띠(밴드) 높이에 세운다**(2026-08-31 읽기 보조).
  // 예전에는 세로 등분이라 순서가 팀과 아무 상관이 없었고, 그래서 선 40개가 서로를
  // 가로질렀습니다 — 가독성을 망친 것은 라벨 겹침이 아니라 **교차**였습니다.
  // 팀을 여럿 맡은 사람은 **첫 팀** 띠에 서고 나머지 팀으로 가는 선만 띠를 건넙니다
  // (그게 실제로 겸직이라는 사실이라 숨기지 않습니다).
  // ay를 안 주면 forceStep이 **전부 세로 가운데로** 끌어당깁니다(기본 0.5) — 그것도
  // 순서를 흐트러뜨리던 원인이었습니다.
  const { nodes, edges, bands } = useMemo(() => {
    // 폭을 아직 모르면 **아무것도 만들지 않는다.** 노드를 만들어 두면 그 폭으로 한 번
    // 배치되고 자리가 posById에 기억돼서, 진짜 폭이 들어올 때 그 자리에서 다시
    // 움직인다 — 그게 "뚜둑"이다. 빈 목록이면 시뮬이 기억할 것도 없다.
    if (!W) return { nodes: [], edges: [], bands: [] };
    const nodes = [];
    const idx = new Map();
    const push = (n) => { idx.set(n.id, nodes.length); nodes.push(n); };
    const T = Math.max(1, teamsInUse.length);
    const slot = new Map(teamsInUse.map((t, i) => [t, i]));
    // 띠 = 세로를 팀 수로 나눈 칸. 팀 칩은 그 칸의 가운데에 고정된다.
    const top = 26, span = H - 52;
    const bandTop = (k) => top + (k / T) * span;
    const bandH = span / T;
    const bands = teamsInUse.map((t, k) => ({ team: t, y0: bandTop(k), y1: bandTop(k) + bandH }));

    // 한 띠 안에서 j번째(총 n개)면 어디에 서나 — 등분해서 겹치지 않게
    const inBand = (k, j, n) => (bandTop(k) + ((j + 0.5) / Math.max(1, n)) * bandH) / H;
    // 팀이 없거나 목록에 없는 팀이면 전체 높이에 편다(마지막 띠 아래로 밀지 않는다)
    const spread = (j, n) => (top + ((j + 0.5) / Math.max(1, n)) * span) / H;

    // 층별로 "같은 띠에 몇 번째인가"를 먼저 센다 — 그래야 등분할 수 있다
    const rank = (list, teamOf) => {
      const seen = new Map();
      return list.map((x) => {
        const k = slot.has(teamOf(x)) ? slot.get(teamOf(x)) : -1;
        const j = seen.get(k) || 0;
        seen.set(k, j + 1);
        return { k, j };
      }).map((r, i, all) => ({ ...r, n: all.filter(o => o.k === r.k).length, i }));
    };
    const firstTeam = (m) => (m.teams?.length ? m.teams : [m.team]).filter(Boolean)[0];
    const mainTeamOfProject = (pr) => {
      const hit = teamProjects.filter(([, pid]) => pid === pr.id);
      if (!hit.length) return null;
      // 업무가 가장 많은 팀을 그 프로젝트의 자리로 본다
      return hit.slice().sort((a, b) => (b[2] || 1) - (a[2] || 1))[0][0];
    };

    const mRank = rank(members, firstTeam);
    members.forEach((m, k) => {
      const r = mRank[k];
      push({
        id: `m:${m.name}`, kind: 'member', m, pl: 30, pr: 46,
        // zx: 사람은 왼쪽 영역 밖으로 못 나간다 — 층 읽기가 안 깨진다(사용자 결정)
        ax: AX.m, zx: ZX.m, zxDrag: ZXD.m,
        ay: r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n),
        iy: r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n),
      });
    });
    // 팀은 가운데 열 고정 — 자기 띠의 가운데. 모바일은 살짝 왼쪽(0.44).
    const teamX = W * AX.t;
    teamsInUse.forEach((t, k) => push({
      id: `t:${t}`, kind: 'team', t, left: teamLeft[t] || 0,
      fixed: { x: teamX, y: bandTop(k) + bandH / 2 },
    }));
    const pRank = rank(projects, mainTeamOfProject);
    projects.forEach((pr, k) => {
      const r = pRank[k];
      const y = r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n);
      push({
        id: `p:${pr.id}`, kind: 'project', p: pr,
        // pr = 라벨 반폭 + 여유. 이 값이 라벨 폭보다 작으면 좁은 데스크톱(offX가 0인
        // 폭)에서 라벨 오른쪽이 카드 밖으로 나간다.
        pl: 56, pr: compact ? 66 : 96,
        // **한 열로 세운다.** 두 열(홀짝 지그재그)로 벌려 봤더니 선이 오히려 더
        // 엇갈려 보였다 — 겹침은 그릴 때 떼어놓는 쪽(spreadLabels)이 확실하다.
        ax: AX.p,
        ay: y, iy: y, zx: ZX.p, zxDrag: ZXD.p,
        repel: 1.7,   // 라벨이 제일 크다 — 서로는 더 세게 밀어야 안 겹친다
      });
    });

    const edges = [];
    // 목표 길이는 앵커 간격이다(EDGE_OF) — 고정값이면 폭이 넓어질수록 스프링이
    // 앵커를 이기려 들어 그래프가 계속 출렁인다(실측: 방향 반전 4.9 → 1.0회/노드).
    const lenMT = EDGE_OF(AX.m, AX.t, W);
    const lenTP = EDGE_OF(AX.t, AX.p, W);
    // 선 굵기 = 같이 맡은 업무 수(사용자 결정 2026-08-31). **선이 있냐 없냐는 멤버십**
    // 이고 굵기만 업무 수다 — 업무 수로 선을 만들면 맡은 일이 없는 사람이 팀에서
    // 사라집니다(§8).
    members.forEach(m => [...new Set((m.teams?.length ? m.teams : [m.team]).filter(Boolean))].forEach(t => {
      if (!idx.has(`t:${t}`)) return;
      edges.push([idx.get(`m:${m.name}`), idx.get(`t:${t}`), lenMT, teamColor(t),
        memberLoad?.get?.(`${m.name}|${t}`) || 0]);
    }));
    teamProjects.forEach(([team, pid, n]) => {
      if (idx.has(`t:${team}`) && idx.has(`p:${pid}`)) {
        edges.push([idx.get(`t:${team}`), idx.get(`p:${pid}`), lenTP, teamColor(team), n || 0]);
      }
    });
    return { nodes, edges, bands };
  }, [members, teamsInUse, projects, teamProjects, teamLeft, memberLoad, compact, W, H, AX, ZX, ZXD]);

  // 엔진은 프로젝트 그래프 뷰(depgraph)와 **같은 useForceGraph/forceStep**이다
  // (사용자 지시 2026-08-31 — "힘 엔진은 같이 가져가라"). 상수·미리 돌리기·선 길이
  // 규칙을 여기서 고치면 그 화면도 같이 따라온다. 갈라 두지 마세요.
  // **끌기는 그대로 둡니다**(사용자 지시 2026-08-31 — "끌기는 왜 빼").
  const { pos, bindDrag } = useForceGraph({ nodes, edges, W, H, wrapRef, offX, compact });
  // hover(데스크톱) 또는 탭(모바일)으로 고른 노드. 사람 노드는 갈 곳이 없으므로
  // **탭이 곧 포커스**다 — 터치 기기에는 hover가 없어서 이 기능이 아예 없었다(§8).
  const [hi, setHi] = useState(null);
  const [pin, setPin] = useState(null);
  const cur = hi ?? pin;

  // 만진(또는 탭해 둔) 노드와 그 이웃만 또렷하게 — 나머지는 흐린다
  const linked = useMemo(() => {
    if (cur == null) return null;
    const set = new Set([cur]);
    edges.forEach(([a, b]) => { if (a === cur) set.add(b); if (b === cur) set.add(a); });
    return set;
  }, [cur, edges]);
  // 선 굵기의 기준 — 가장 굵은 연결이 상한이 된다(절대 굵기를 박으면 업무가 늘 때 다 굵어진다)
  const maxW = useMemo(() => Math.max(1, ...edges.map(e => e[4] || 0)), [edges]);

  // **그릴 때 같은 층 라벨을 떼어놓는다**(utils.spreadLabels · 2026-08-31).
  // 힘 배치는 겹치지 않음을 보장할 수 없다 — 척력을 세게 하면 노드가 영역 밖으로
  // 밀리고, 약하면 라벨이 겹친다(실측 4~9건). 시뮬 좌표(pos)는 건드리지 않고
  // 화면 y만 민다: 끌기는 여전히 자기 좌표를 따라가고, 보이는 것만 안 겹친다.
  // useMemo를 쓰지 않는다 — pos는 ref 배열이라 참조가 안 바뀌어서 의존성으로 못 쓴다.
  // 노드 37개 × 층 3개짜리 정렬이라 매 프레임 돌아도 공짜다.
  const GAP = compact ? FM.GAP_MOB : FM.GAP_DESK;
  const drawY = new Map();
  for (const [kind, key] of [['member', 'm'], ['team', 't'], ['project', 'p']]) {
    const items = nodes.map((n, i) => ({ n, i }))
      .filter(({ n }) => n.kind === kind)
      .map(({ i }) => ({ i, y: pos[i]?.y ?? 0 }));
    if (!items.length) continue;
    // 위 경계 38: 열 머리글(9.5px, 위에 붙어 있다) 아래다 — 20으로 뒀더니 첫 노드가
    // 머리글을 덮었다(실측 '사람'·'프로젝트' 둘 다).
    spreadLabels(items, GAP[key], 38, H - 16).forEach((y, i) => drawY.set(i, y));
  }
  const yOf = (i) => drawY.get(i) ?? (pos[i]?.y ?? 0);

  return (
    <Card className="px-4 py-[15px]">
      <div className="flex items-center gap-2 pb-1">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">프로젝트 연결 지도</h3>
        <span className="text-[10px] text-fg-faint">사람 → 팀 → 프로젝트</span>
      </div>
      {/* 빈 데를 누르면 탭 포커스가 풀린다 */}
      <div ref={wrapRef} className="relative select-none" style={{ height: H }}
        onClick={(e) => { if (e.target === e.currentTarget) setPin(null); }}>
        {/* 팀 띠 — 사람·프로젝트가 자기 팀 높이에 서므로, 옅은 가로 띠가 "이 줄은 이 팀"을
            말해 준다(2026-08-31 읽기 보조). 홀수 띠만 칠해서 줄무늬로 읽히게 하고, 고른
            팀의 띠는 그 팀 색으로 한 겹 더 밝힌다. 선 아래에 깔린다(pointer-events 없음). */}
        {bands.map((b, k) => {
          const isCur = cur != null && nodes[cur]?.kind === 'team' && nodes[cur].t === b.team;
          const near = cur != null && linked && [...linked].some(j => nodes[j]?.kind === 'team' && nodes[j].t === b.team);
          return (
            <span key={b.team} aria-hidden className="absolute pointer-events-none"
              style={{
                left: offX, top: b.y0, width: W, height: b.y1 - b.y0,
                background: isCur || near
                  ? `color-mix(in srgb, ${teamColor(b.team)} 12%, transparent)`
                  : k % 2 ? 'var(--app-surface-hover)' : 'transparent',
                opacity: isCur || near ? 1 : 0.55,
                transition: 'background 200ms, opacity 200ms',
              }} />
          );
        })}
        {/* 열 머리글 — 팀 열(가운데)은 고정이라 정확하고, 사람·프로젝트는 영역(zx)의 가운데쯤이다 */}
        <span className="absolute text-[9.5px] font-bold text-fg-faint" style={{ left: offX + W * AX.m, top: 0, transform: 'translateX(-50%)' }}>사람</span>
        <span className="absolute text-[9.5px] font-bold text-fg-faint" style={{ left: offX + W * AX.t, top: 0, transform: 'translateX(-50%)' }}>팀</span>
        <span className="absolute text-[9.5px] font-bold text-fg-faint" style={{ left: offX + W * AX.p, top: 0, transform: 'translateX(-50%)' }}>프로젝트</span>
        <svg className="absolute inset-0 pointer-events-none" width={cw} height={H} aria-hidden>
          {edges.map(([a, b, , color, weight], i) => {
            const on = cur != null && (a === cur || b === cur);
            const dim = cur != null && !on;
            const x1 = offX + (pos[a]?.x || 0), y1 = yOf(a);
            const x2 = offX + (pos[b]?.x || 0), y2 = yOf(b);
            const bend = Math.min(26, Math.hypot(x2 - x1, y2 - y1) * 0.12);
            // 굵기 = 같이 맡은 업무 수(사용자 결정 2026-08-31). 0.9~3.2px 사이로 누른다 —
            // 상한이 없으면 업무가 많은 한 줄이 화면을 갈라 버리고, 하한이 없으면
            // 0건 연결이 사라져 "그 팀 사람이 아닌 것"처럼 보인다.
            const wpx = 0.9 + Math.min(1, (weight || 0) / maxW) * 2.3;
            return (
              <path key={i}
                d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - bend} ${x2} ${y2}`}
                fill="none" stroke={color} strokeWidth={on ? wpx + 0.7 : wpx}
                strokeLinecap="round"
                opacity={dim ? 0.1 : on ? 0.9 : 0.42}
                style={{ transition: 'opacity 200ms, stroke-width 200ms' }} />
            );
          })}
        </svg>
        {nodes.map((n, i) => {
          const P = pos[i];
          if (!P) return null;
          const dim = linked && !linked.has(i);
          const base = {
            position: 'absolute', left: offX + P.x, top: yOf(i), transform: 'translate(-50%, -50%)',
            opacity: dim ? 0.22 : 1, transition: 'opacity 200ms',
          };
          if (n.kind === 'member') {
            const drag = bindDrag(i);
            const picked = pin === i;
            return (
              // 사람 노드는 갈 곳이 없어서 예전에는 눌러도 아무 일이 없었다 → **탭이 포커스**다.
              // 터치 기기에는 hover가 없어서 "그 사람의 연결만 보기"가 아예 없는 기능이었다(§8).
              <button key={n.id} type="button" {...drag}
                style={{ ...base, ...drag.style, cursor: 'grab' }}
                aria-pressed={picked}
                title={`${n.m.name} — 눌러서 이 사람의 연결만 보기`}
                className="flex flex-col items-center gap-0.5"
                onClick={() => setPin(picked ? null : i)}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
                <Avatar name={n.m.name} url={n.m.avatarUrl}
                  className={`flex w-[20px] h-[20px] text-[9px] pointer-events-none ${picked ? 'ring-2 ring-accent' : ''}`} />
                <span className={`text-[9px] leading-none whitespace-nowrap pointer-events-none ${picked ? 'text-fg font-bold' : 'text-fg-muted'}`}>{n.m.name}</span>
              </button>
            );
          }
          if (n.kind === 'team') {
            return (
              // 남은 업무 수를 칩 안에 붙인다(사용자 결정 2026-08-31) — 연결과 부담을
              // 한 번에 읽는다. 0건이면 숫자를 쓰지 않는다(없는 것을 굳이 말하지 않는다).
              <button key={n.id} type="button" title={`${n.t} 보드로${n.left ? ` · 남은 업무 ${n.left}건` : ''}`} style={base}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
                onClick={() => onOpenTeam(n.t)}
                className="inline-flex items-center gap-1 pl-2 pr-[7px] py-[3px] rounded-full text-[10.5px] font-bold whitespace-nowrap bg-surface border border-line shadow-soft transition hover:opacity-70">
                <span style={{ color: teamColor(n.t) }}>{n.t}</span>
                {n.left > 0 && (
                  <span className="text-[9.5px] font-semibold tabular-nums text-fg-faint">{n.left}</span>
                )}
              </button>
            );
          }
          const drag = bindDrag(i);
          return (
            <button key={n.id} type="button" title={`${n.p.title} 열기`} {...drag}
              style={{ ...base, ...drag.style, cursor: 'grab' }}
              onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
              onClick={() => onOpenProject(n.p.id)}
              className={`px-2.5 py-1 rounded-[8px] bg-surface shadow-soft border border-line font-bold text-fg whitespace-nowrap truncate transition hover:opacity-70 ${compact ? 'text-[10.5px] max-w-[128px]' : 'text-[11.5px] max-w-[200px]'}`}>
              {n.p.title}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
