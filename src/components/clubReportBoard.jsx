import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { CARD, CARD_STYLE, BTN_QUIET } from './groupsParts.jsx';
import { Segmented } from './segmented.jsx';
import { REPORT_STATUS } from './meetingReport.jsx';
import { fetchReportBoard, setSupportPaid } from '../services/clubReport.js';

// ============================================================================
// 동아리 보고서 제출 현황 + 지원비 지급 체크(v5 3묶음 · **시안 mock/b4** · 문구 임시)
// ----------------------------------------------------------------------------
// 자리: 모임 > 동아리 탭 머리줄의 '보고서 현황'(마스터 · 총무만 · 사용자 결정 2026-10-21).
// 그 해의 지난 모임 전부 — 위에 상태 셋의 수와 '지급할 지원금'(제출 완료인데 아직 지급 전) 합계, 아래에 모임마다 한 줄:
//   동아리 · 모임 날짜·제목 · 참석 · 지원금(참석자 × 5,000원) · 보고서 상태 · 지급 체크.
// 지급 체크는 **제출 완료한 모임만** 켠다(보고서를 보고 지급한다 — 시안 제안 · 사용자 확인 전).
// 줄을 누르면 그 동아리 상세로 간다(보고서를 열어 본다).
// ============================================================================

const won = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const shortDay = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[1]}. ${+m[2]}.` : ''; };
const FILTERS = [['all', '전체'], ['none', '미제출'], ['draft', '작성 중'], ['done', '제출 완료'], ['unpaid', '지급 전']];

export function ClubReportBoard({ year, me = '', onOpenClub, onBack }) {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('all');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => fetchReportBoard(year), [year, tick]);
  const count = (k) => rows.filter(r => r.status === k).length;
  const owed = rows.filter(r => r.status === 'done' && !r.paidAt).reduce((n, r) => n + r.amount, 0);
  const paid = rows.filter(r => r.paidAt).reduce((n, r) => n + r.amount, 0);
  const shown = rows.filter(r => (filter === 'all' ? true : filter === 'unpaid' ? r.status === 'done' && !r.paidAt : r.status === filter));
  const toggle = (r) => { setSupportPaid(r.meeting.id, !r.paidAt, me); setTick(t => t + 1); };

  return (
    <div className="club-report-board" data-report-board="">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[15px] font-bold text-fg">{`${year}년 보고서 현황`}</h3>
        <span className="flex-1" />
        <button type="button" onClick={onBack} className={BTN_QUIET}>목록으로</button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-3">
        {['none', 'draft', 'done'].map(k => (
          <div key={k} className={`${CARD} px-3 py-2.5`} style={CARD_STYLE}>
            <p className="text-[11px] font-semibold text-fg-muted">{REPORT_STATUS[k][0]}</p>
            <p className="mt-0.5 text-[18px] font-bold text-fg tabular-nums">{count(k)}<span className="ml-0.5 text-[11px] font-semibold text-fg-muted">건</span></p>
          </div>
        ))}
        <div className={`${CARD} col-span-3 md:col-span-2 px-3 py-2.5 flex md:block items-baseline gap-3`} style={CARD_STYLE}>
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-fg-muted">지급할 지원금</p>
            <p className="mt-0.5 text-[18px] font-bold text-accent-text tabular-nums">{won(owed)}</p>
          </div>
          <p className="text-[11px] text-fg-muted tabular-nums">{`지급 완료 ${won(paid)}`}</p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 mb-2.5">
        <Segmented className="inline-flex p-[3px] rounded-md" items={FILTERS} value={filter} onPick={setFilter}
          btnClassName="px-3 py-[6px] rounded-sm text-[12px] font-semibold whitespace-nowrap transition-colors" />
      </div>

      <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
        {/* 데스크톱 머리 — 동아리 | 모임 | 참석 | 지원금 | 보고서 | 지급 */}
        <div className="hidden md:grid grid-cols-[9rem_minmax(0,1fr)_3.5rem_5.5rem_5rem_6.5rem] gap-3 px-4 py-2 text-[11px] font-semibold text-fg-muted border-b border-line">
          <span>동아리</span><span>모임</span><span className="text-right">참석</span><span className="text-right">지원금</span><span>보고서</span><span>지급</span>
        </div>
        {shown.length === 0 && <p className="px-4 py-6 text-[12.5px] text-fg-muted">해당하는 모임 없음</p>}
        {shown.map((r, i) => {
          const [label, tone] = REPORT_STATUS[r.status];
          const canPay = r.status === 'done' || !!r.paidAt;
          return (
            <div key={r.meeting.id} data-board-row={r.status}
              className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[9rem_minmax(0,1fr)_3.5rem_5.5rem_5rem_6.5rem] items-center gap-x-3 gap-y-1 px-4 py-2.5"
              style={i ? { borderTop: '1px solid var(--app-line)' } : undefined}>
              <button type="button" onClick={() => onOpenClub?.(r.club)} className="min-w-0 text-left md:contents">
                <span className="block md:inline text-[13px] font-semibold text-fg truncate">{r.club.name}</span>
                <span className="block md:inline text-[12px] text-fg-muted truncate md:text-fg">
                  <span className="tabular-nums">{shortDay(r.meeting.meeting_date)}</span>{r.meeting.title ? ` ${r.meeting.title}` : ''}
                  <span className="md:hidden tabular-nums">{` · ${(r.meeting.attendance || []).length}명 · ${won(r.amount)}`}</span>
                </span>
              </button>
              <span className="hidden md:block text-right text-[12.5px] text-fg tabular-nums">{`${(r.meeting.attendance || []).length}명`}</span>
              <span className="hidden md:block text-right text-[12.5px] text-fg tabular-nums">{won(r.amount)}</span>
              <span className="row-start-1 col-start-2 md:row-start-auto md:col-start-auto justify-self-end md:justify-self-start">
                <span className={`px-1.5 py-px rounded-xs text-[10.5px] font-bold ${tone}`}>{label}</span>
              </span>
              <span className="col-span-2 md:col-span-1 flex items-center gap-2 min-w-0">
                <button type="button" role="checkbox" aria-checked={!!r.paidAt} disabled={!canPay} onClick={() => toggle(r)}
                  data-board-paid={r.paidAt ? 'true' : 'false'}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40
                    ${r.paidAt ? 'bg-tag-green text-tag-green-fg border-transparent' : 'bg-surface text-fg-muted border-line enabled:hover:bg-surface-hover'}`}>
                  <span className={`w-3.5 h-3.5 rounded-[4px] flex items-center justify-center ${r.paidAt ? 'bg-tag-green-fg text-surface' : 'border border-line'}`}>
                    {r.paidAt && <Check size={10} strokeWidth={3} />}
                  </span>
                  {r.paidAt ? '지급 완료' : '지급'}
                </button>
                {r.paidAt && <span className="md:hidden text-[11px] text-fg-muted truncate">{[r.paidBy, shortDay(r.paidAt.slice(0, 10))].filter(Boolean).join(' · ')}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
