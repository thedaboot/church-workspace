import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ImagePlus, Loader2, CheckCircle2 } from 'lucide-react';
import { useLeave } from '../hooks/useExit.js';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { FIELD } from './groupsParts.jsx';
import { SmartImage } from './media.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { photoOf, supportAmountOf, formOf, withPhotoUrls } from '../services/clubReport.js';
import { amountText } from '../services/xlsxWrite.js';

// ============================================================================
// 동아리 활동 보고서 작성 화면(v5 3묶음 · 사용자 승인 시안 mock/b4 · 문구 확정 2026-10-21 · 0117)
// ----------------------------------------------------------------------------
// 지난 모임의 '보고서 작성' — 폰은 아래 시트, 데스크톱은 가운데 대화창(.dc-sheet-dialog · 피드백 전송과 같은 틀).
// 양식(동아리_활동보고서.xlsx)의 칸 그대로: 동아리명·모임 일자·참석자·지원금액은 모임에서 채우고(고치지 않는다),
// 활동 내용 · 차기 활동계획 · 지원비 사용내용 · 계좌번호를 쓴다. 사진·영수증은 폰 사진첩·카메라에서 고른다.
//   · 저장 — 엑셀을 새로 만들어 그 모임의 보고서 칸을 덮는다 · 현황은 '작성 중'
//   · 제출 — 같은 저장 + 제출 표시 · 현황은 '제출 완료'
// 사진은 고르는 즉시 줄인다(긴 변 1280px jpeg · services/clubReport.photoOf).
// ============================================================================

// 칸은 쓰는 만큼 늘어난다(사용자 요청 2026-10-22 — 칸 안 스크롤이 좁아 쓰기도 읽기도 힘들었다) · 숫자는 처음 줄 수
const TEXTS = [
  ['activity', '활동 내용', 5],
  ['plan', '차기 활동계획', 3],
  ['usage', '지원비 사용내용', 3],
];
// 글 높이에 맞춰 늘어나는 칸 — 칸 안 스크롤 없이 시트 본문이 한 번에 스크롤된다. 폭이 바뀌면(회전·창 크기) 다시 잰다.
// shortcut: CSS field-sizing: content가 iOS 26 아래에 없어 JS로 잰다, 지원이 넓어지면 그 한 줄로 바꾼다
function GrowText({ value, rows, ...rest }) {
  const ref = useRef(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(() => {
    fit();
    // 끝에 쓰는 중이면 늘어난 아랫줄을 본문 스크롤이 따라간다(폰 키보드 위로 글자가 숨지 않게)
    const el = ref.current;
    if (el && document.activeElement === el && el.selectionEnd === el.value.length) el.scrollIntoView({ block: 'nearest' });
  }, [value, fit]);
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (ref.current) ro.observe(ref.current.parentElement);
    return () => ro.disconnect();
  }, [fit]);
  return <textarea ref={ref} value={value} rows={rows} {...rest} />;
}
// 저장·제출 중 — 글자는 자리만 남기고(invisible) 그 위 가운데에 도는 표시. 폭이 그대로라 옆 버튼이 밀리지 않는다(사용자 지적 2026-10-22)
const Busy = ({ on, children }) => (
  <>
    <span className={on ? 'invisible' : undefined}>{children}</span>
    {on && <Loader2 size={14} className="animate-spin absolute inset-0 m-auto" />}
  </>
);
const shortDay = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[1]}월 ${+m[2]}일` : ''; };

function PhotoGroup({ label, list, onAdd, onDrop, busy }) {
  const ref = useRef(null);
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="text-[12px] font-bold text-fg-muted">{label}</h4>
        {list.length > 0 && <span className="text-[11px] text-fg-faint tabular-nums">{list.length}장</span>}
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {list.map(p => (
          <span key={p.id} className="relative aspect-square">
            {/* 올라간 사진은 서명 주소를 받고 그림을 다 받을 때까지 같은 자리에 스켈레톤(사용자 요청 2026-10-22) */}
            <SmartImage src={p.dataUrl || p.url} alt={p.name} wrapperClassName="block w-full h-full" skeletonClassName="w-full h-full rounded-xs"
              className="w-full h-full object-cover rounded-xs border border-line bg-canvas" />
            <button type="button" onClick={() => onDrop(p.id)} aria-label={`${label} 삭제`} title="삭제"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-fg text-surface flex items-center justify-center shadow-elevated before:absolute before:-inset-1.5">
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className="aspect-square rounded-xs border border-dashed border-line text-fg-muted hover:bg-surface-hover flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          <span>사진 추가</span>
        </button>
      </div>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} aria-hidden="true"
        onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
    </section>
  );
}

export function MeetingReportForm({ club, meeting, people = [], onSave, onClose }) {
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const prev = formOf(meeting) || {};
  const [draft, setDraft] = useState(() => ({
    activity: prev.activity || '', plan: prev.plan || '', usage: prev.usage || '', account: prev.account || '',
    photos: prev.photos || [], receipts: prev.receipts || [],
  }));
  const [busy, setBusy] = useState(null);      // 'photos' | 'receipts' — 사진을 줄이는 중
  const [saving, setSaving] = useState(null);  // 'save' | 'submit'
  const downOnScrim = useRef(false);
  const names = (meeting.attendance || []).map(id => people.find(p => p.id === id)?.name).filter(Boolean);
  const amount = supportAmountOf(meeting);
  const submitted = !!prev.submitted_at;

  // 올라간 사진(비공개 버킷)은 열 때 서명 주소를 받아 미리 보기를 그린다
  useEffect(() => {
    let alive = true;
    Promise.all([withPhotoUrls(draft.photos), withPhotoUrls(draft.receipts)]).then(([photos, receipts]) => {
      if (alive) setDraft(d => ({ ...d, photos: d.photos.map(p => photos.find(x => x.id === p.id) || p), receipts: d.receipts.map(p => receipts.find(x => x.id === p.id) || p) }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const setText = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }));
  const add = async (k, files) => {
    const list = Array.from(files || []).filter(f => (f.type || '').startsWith('image/'));
    if (!list.length) return;
    setBusy(k);
    try {
      const done = [];
      for (const f of list) {
        try { done.push(await photoOf(f)); } catch (e) { console.warn('[report] 사진을 읽지 못했어요:', e); showToast(`'${f.name}'을(를) 넣지 못했어요`); }
      }
      setDraft(d => ({ ...d, [k]: [...d[k], ...done] }));
    } finally { setBusy(null); }
  };
  const drop = (k, id) => setDraft(d => ({ ...d, [k]: d[k].filter(p => p.id !== id) }));

  const save = async (submit) => {
    if (saving) return;
    setSaving(submit ? 'submit' : 'save');
    try {
      await onSave(draft, { submit });
      showToast(submit ? '보고서를 제출했어요' : '보고서를 저장했어요');
      close();
    } catch (e) {
      console.error('[report] 보고서를 저장하지 못했어요:', e);
      showToast(failText(submit ? '보고서를 제출하지 못했어요' : '보고서를 저장하지 못했어요', e));
      setSaving(null);
    }
  };
  const out = leaving ? ' dc-out' : '';
  const Fixed = ({ label, children }) => (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-[5.5rem] shrink-0 text-[12px] font-semibold text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-fg break-words">{children}</span>
    </div>
  );

  return createPortal(
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); }}
      className={`fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[95] flex items-end md:items-center md:justify-center md:p-4 bg-black/50 dc-scrim${out}`}>
      <div role="dialog" aria-label="활동 보고서 작성" data-report-form=""
        className={`w-full md:max-w-[560px] max-h-[92%] md:max-h-[88dvh] flex flex-col overflow-hidden bg-surface rounded-t-2xl md:rounded-lg md:border md:border-line md:shadow-elevated dc-sheet-dialog${out}`}>
        <span className="md:hidden shrink-0 self-center w-9 h-1 mt-2.5 rounded-full bg-line" />
        <div className="flex items-start gap-2 px-5 pt-3 md:pt-5 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-fg tracking-[-0.25px]">활동 보고서 작성</h3>
            <p className="mt-0.5 text-[12px] text-fg-muted truncate">{[club?.name, shortDay(meeting.meeting_date), meeting.title].filter(Boolean).join(' · ')}</p>
          </div>
          {submitted && (
            <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg text-[11px] font-semibold">
              <CheckCircle2 size={12} />제출 완료
            </span>
          )}
          <button type="button" onClick={close} title="닫기" aria-label="닫기" className="shrink-0 p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-3 pb-6">
          <div className="rounded-md bg-canvas px-3 py-1.5">
            <Fixed label="참석자">{names.length ? `${names.length}명 · ${names.join(', ')}` : '출석 체크 전'}</Fixed>
            <Fixed label="지원금액">{amountText(amount)}</Fixed>
          </div>
          {TEXTS.map(([k, label, rows]) => (
            <label key={k} className="block mt-3">
              <span className="block mb-1 text-[12px] font-bold text-fg-muted">{label}</span>
              <GrowText value={draft[k]} onChange={setText(k)} rows={rows} data-report-field={k}
                className={`${FIELD} w-full resize-none overflow-hidden leading-relaxed py-2`} />
            </label>
          ))}
          <label className="block mt-3">
            <span className="block mb-1 text-[12px] font-bold text-fg-muted">지원금 받을 계좌</span>
            <input value={draft.account} onChange={setText('account')} data-report-field="account" inputMode="text"
              placeholder="은행 · 계좌번호 · 예금주" className={`${FIELD} w-full py-2`} />
          </label>
          <PhotoGroup label="활동 사진" list={draft.photos} busy={busy === 'photos'} onAdd={f => add('photos', f)} onDrop={id => drop('photos', id)} />
          <PhotoGroup label="지원비 영수증" list={draft.receipts} busy={busy === 'receipts'} onAdd={f => add('receipts', f)} onDrop={id => drop('receipts', id)} />
        </div>
        <div className="flex gap-2 px-5 pt-3 shrink-0 border-t border-line" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={close} className={`${BTN_CONFIRM_QUIET} px-3`}>취소</button>
          <span className="flex-1" />
          <button type="button" onClick={() => save(false)} disabled={!!saving || !!busy} data-report-save=""
            className={`${BTN_CONFIRM_QUIET} relative text-accent-text`}>
            <Busy on={saving === 'save'}>저장</Busy>
          </button>
          <button type="button" onClick={() => save(true)} disabled={!!saving || !!busy} data-report-submit="" className={`${BTN_CONFIRM} relative`}>
            <Busy on={saving === 'submit'}>{submitted ? '다시 제출' : '제출'}</Busy>
          </button>
        </div>
      </div>
    </div>,
    document.body);
}
