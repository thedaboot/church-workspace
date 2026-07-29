import React, { useState } from 'react';
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
export const BUCKETS = [
  { key: 'overdue', label: '지연', fg: 'var(--app-tag-red-fg)' },
  { key: 'today', label: '오늘 마감', fg: 'var(--app-ink)' },
  { key: 'week', label: '이번 주', fg: 'var(--app-ink)' },
  { key: 'later', label: '다음 주 이후', fg: 'var(--app-ink-muted)' },
  { key: 'nodue', label: '마감 미정', fg: 'var(--app-ink-muted)' },
  { key: 'done', label: '끝낸 업무', fg: 'var(--app-tag-green-fg)' },
];
export function bucketOf(task, today = ISO_TODAY()) {
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

export function DueGroupList({ groups, projectsMap, today, onComplete, onOpen, showTeam = true, emptyHint }) {
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
                      <span className={`sm:hidden ml-auto mr-1.5 shrink-0 w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] font-bold ${avatarColor(t.assignees?.[0] || '')}`}
                        title={t.assignees?.[0] || '미지정'}>
                        {(t.assignees?.[0] || '?')[0]}
                      </span>
                    </span>
                  </span>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1.5 pl-[7px] pr-[9px] py-[3px] rounded-[4px]"
                    style={{ background: CONFIG.STATUS_BG_VAR[t.status] || 'transparent' }}
                    title={t.status}>
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
            <span className={`w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold ${avatarColor(p.name)}`}>{p.name[0]}</span>
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
