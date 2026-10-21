import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Paperclip, UploadCloud, FilePen, X, Loader2, AlertTriangle, PencilLine } from 'lucide-react';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { formatBytes, fileKind, UploadTrack } from './fileRow.jsx';
import { BTN, BTN_SOFT } from './buttons.js';
import { WITH_ICON, ICON_BTN } from './groupsParts.jsx';
import { uploadingByCard, uploadWatchers, unstageUpload, cancelUpload } from '../modals/uploadQueue.js';
import { meetingQueueKey, REPORT_ACCEPT, splitNameTail } from '../services/groups.js';
import { previewCopyOf } from '../services/previewKind.js';
import { reportStatus } from '../services/clubReport.js';

const MeetingReportForm = lazy(() => import('./meetingReportForm.jsx').then(m => ({ default: m.MeetingReportForm })));
// 보고서 상태 칩(시안 mock/b4 · 문구 임시) — 현황(clubReportBoard)과 같은 말
export const REPORT_STATUS = {
  none: ['미제출', 'bg-tag-gray text-tag-gray-fg'],
  draft: ['작성 중', 'bg-tag-orange text-tag-orange-fg'],
  done: ['제출 완료', 'bg-tag-green text-tag-green-fg'],
};

// 미리보기·편집 창(+PdfView)은 열 때만 받는다 — 업무 첨부·주보와 같은 창이다
const FilePreviewModal = lazy(() => import('./FilePreviewModal.jsx').then(m => ({ default: m.FilePreviewModal })));

// ============================================================================
// 동아리 모임의 활동 보고서 칸 (0093 · 사용자 결정 2026-10-12 · 시안 4-C)
// ----------------------------------------------------------------------------
// **지난 모임**(오늘 KST 앞)의 출석 칩 아래에 가는 선 + `활동 보고서` 한 칸. 그리는 일만 한다 —
// 통신·큐는 views/groupsView.jsx가 하고(services/groups.js · modals/uploadQueue.js), 여기는 큐의 줄을 구독해
// 올리는 중(`드라이브에 올리는 중` — 주보 파일 줄과 같은 말)·못 올린 줄(빨간 줄 + 다시 시도)을 세운다.
//
//   manage(마스터·관리자·동아리장 = canManageClub · 0093 can_edit_meeting) — 파일 줄 + `편집` + 지우기 X ·
//     `파일 올리기`(보고서가 없으면 진한 accent, 있으면 연한) · `지난 보고서 가져오기`(이 모임에 보고서가 없고
//     이 동아리의 다른 모임에 있을 때만 — groups.lastReportOf)
//   구성원 — 보고서가 있는 모임만 파일 줄(버튼·X 없음), 없으면 칸 자체가 없다
// 줄을 누르면 미리보기, `편집`은 구글 편집 사본을 연다(큐시트처럼 — 데스크톱은 앱 안 창이 곧 편집 화면,
// 폰은 창 머리줄의 '구글 시트에서 편집' · FilePreviewModal canEditCopy/inlineEdit).
// 클래스는 `club-meet-report-*`(tests/groups가 잡는다).
// ============================================================================

// 'M월 D일' — 올린 날(한국 날짜)
const dayOf = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const [, m, d] = new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).split('-');
  return `${+m}월 ${+d}일`;
};

export function MeetingReport({ club = null, meeting, manage, people = [], prev = null, onPick, onRetry, onRemove, onCopyLast, onGrantEdit = null, onSaveForm = null }) {
  const key = meetingQueueKey(meeting.id);
  const [pending, setPending] = useState(() => [...(uploadingByCard.get(key) || [])]);
  // 큐는 모듈 레벨이다 — 동아리를 나갔다 와도(이 칸이 다시 마운트돼도) 올리는 중인 줄이 그대로 선다(§6-29-r)
  useEffect(() => {
    const sync = () => setPending([...(uploadingByCard.get(key) || [])]);
    uploadWatchers.add(sync);
    sync();
    return () => { uploadWatchers.delete(sync); };
  }, [key]);
  const [preview, setPreview] = useState(null);   // { row, edit }
  const [copying, setCopying] = useState(false);
  const [writing, setWriting] = useState(false);   // 작성 화면(시안 mock/b4)
  const inputRef = useRef(null);

  const files = meeting.files || [];
  if (!manage && !files.length) return null;
  const has = files.length > 0 || pending.some(r => !r._cancel);
  const nameOf = (uid) => (uid && people.find(p => p.profile_id === uid)?.name) || '';
  const copyLast = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const row = await onCopyLast(prev);
      if (row) setPreview({ row, edit: true });   // 사본이 서면 곧바로 편집 화면(주보 '지난 큐시트로 바로 편집'과 같은 길)
    } finally { setCopying(false); }
  };

  return (
    <div className="club-meet-report mt-3 pt-2.5 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--app-line)' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Paperclip size={13} className="shrink-0 text-fg-faint" />
        <span className="club-meet-report-label text-[11.5px] font-bold text-fg-muted">활동 보고서</span>
        {onSaveForm && (manage || reportStatus(meeting) === 'done') && (() => {
          const [label, tone] = REPORT_STATUS[reportStatus(meeting)];
          return <span data-report-status={reportStatus(meeting)} className={`shrink-0 px-1.5 py-px rounded-xs text-[10.5px] font-bold ${tone}`}>{label}</span>;
        })()}
        <span className="flex-1" />
        {manage && (
          <span className={`flex items-center gap-1.5 ${onSaveForm ? 'basis-full sm:basis-auto' : ''}`}>
            {/* 칸 자체는 안 보인다 — 버튼이 대신 연다(주보 파일 줄과 같은 방식) */}
            <input ref={inputRef} type="file" multiple accept={REPORT_ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true"
              onChange={e => { onPick(e.target.files); e.target.value = ''; }} />
            {!has && prev && (
              <button type="button" onClick={copyLast} disabled={copying} title={prev.file?.name || ''}
                className={`club-meet-report-copy shrink-0 ${WITH_ICON} ${BTN_SOFT}`}>
                {copying ? <Loader2 size={13} className="animate-spin" /> : <FilePen size={13} />}<span>지난 보고서 가져오기</span>
              </button>
            )}
            <button type="button" onClick={() => inputRef.current?.click()}
              className={`club-meet-report-add shrink-0 ${WITH_ICON} ${has || onSaveForm ? BTN_SOFT : BTN}`}>
              <UploadCloud size={13} /><span>파일 올리기</span>
            </button>
            {onSaveForm && (
              <button type="button" onClick={() => setWriting(true)} data-report-write=""
                className={`order-first sm:order-none flex-1 sm:flex-none justify-center ${WITH_ICON} ${BTN}`}>
                <PencilLine size={13} /><span>{meeting.report_form?.saved_at ? '보고서 수정' : '보고서 작성'}</span>
              </button>
            )}
          </span>
        )}
      </div>
      {files.map(row => {
        const meta = [nameOf(row.uploaded_by), dayOf(row.created_at), formatBytes(row.size_bytes)].filter(Boolean).join(' · ');
        return (
          <ReportRow key={row.id} row={row} meta={meta} onOpen={() => setPreview({ row, edit: false })}>
            {/* 작성 화면으로 만든 보고서는 구글 사본으로 고치지 않는다 — 원본은 작성 화면이다(시안 mock/b4) */}
            {manage && !row.generated && previewCopyOf(row.name) && (
              <button type="button" onClick={() => setPreview({ row, edit: true })} aria-label={`${row.name} 편집`}
                className="club-meet-report-edit shrink-0 px-2.5 py-0.5 rounded-full border border-line bg-surface text-[11px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-95">
                편집
              </button>
            )}
            {manage && (
              <ConfirmPopover className="shrink-0 inline-flex" message={`'${row.name}'을(를) 삭제할까요?`} onConfirm={() => onRemove(row)}>
                <button type="button" aria-label={`${row.name} 삭제`} className={`club-meet-report-drop ${ICON_BTN} hover:text-tag-red-fg`}>
                  <X size={12} />
                </button>
              </ConfirmPopover>
            )}
          </ReportRow>
        );
      })}
      {/* 멈춘 줄(_cancel — 다 보낸 뒤 X · 올라오는 대로 거둔다)은 그 순간 화면에서 빠진다(업무 첨부와 같다) */}
      {pending.filter(row => !row._cancel).map(row => (row._failed ? (
        // 못 올린 파일 — 업무 첨부와 같은 빨간 줄(2026-10-09). 다시 시도는 고른 파일 그대로 같은 길로 간다.
        <div key={row.id} className="club-meet-report-failed flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-tag-red text-tag-red-fg min-w-0">
          <span className="w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0"><AlertTriangle size={15} /></span>
          <div className="min-w-0 flex-1" title={row.name}>
            {/* 이름은 올라간 줄과 같은 가운데 말줄임(MiddleName) — 끝을 자르면 `(10월).xlsx`가 빨간 줄에서도 사라졌다 */}
            <MiddleName name={row.name} className="club-meet-report-failed-name text-[12px] font-semibold" />
            <p className="mt-px text-[10.5px]">올리지 못했어요</p>
          </div>
          <button type="button" onClick={() => onRetry(row.id)} className={`club-meet-report-retry shrink-0 ${BTN}`}>다시 시도</button>
          <button type="button" onClick={() => unstageUpload(key, row.id)} aria-label="목록에서 빼기"
            className="shrink-0 p-1.5 rounded-md hover:bg-surface-hover transition active:scale-95"><X size={13} /></button>
        </div>
      ) : (
        // 아직 드라이브에 안 올라간 줄 — 고르자마자 선다(§6-29-k). 편집·지우기는 없다(DB에 행이 아직 없다).
        // 진행 퍼센트·막대와 멈춤 X는 업무 첨부 줄과 같다(2026-10-19 사용자 요청 · uploadQueue 머리말)
        <ReportRow key={row.id} row={row} pending onOpen={() => setPreview({ row, edit: false })}
          meta={`${row._phase === 'move' ? '드라이브로 옮기는 중' : '드라이브에 올리는 중'} · ${formatBytes(row.size_bytes)}`}>
          {manage && (
            <button type="button" onClick={() => cancelUpload(key, row.id)} title="올리기 취소" aria-label="올리기 취소"
              className={`club-meet-report-cancel ${ICON_BTN} hover:text-tag-red-fg`}><X size={12} /></button>
          )}
        </ReportRow>
      )))}
      {writing && (
        <Suspense fallback={null}>
          <MeetingReportForm club={club} meeting={meeting} people={people} onClose={() => setWriting(false)}
            onSave={(draft, opt) => onSaveForm(draft, opt)} />
        </Suspense>
      )}
      {preview && (
        <Suspense fallback={null}>
          <FilePreviewModal row={preview.row} rows={files} initialSrc={null} onClose={() => setPreview(null)}
            canEditCopy={manage}
            onGrantEdit={manage && onGrantEdit ? () => onGrantEdit(preview.row) : null}
            inlineEdit={manage && preview.edit} />
        </Suspense>
      )}
    </div>
  );
}

// 파일 이름 한 줄 — **가운데를 줄인다**(2026-10-14 반응형 점검) — 끝을 자르면 작은 폰에서 `(10월).xlsx`가 통째로
// 사라졌다. 앞 칸만 말줄임하고 꼬리(확장자 앞 몇 글자 + 확장자)는 늘 선다(groups.splitNameTail · PITFALLS 48-d).
// 앞 칸은 whitespace-pre — 띄어쓰기에서 갈린 이름의 끝 칸 공백이 접혀 두 낱말이 붙어 보이지 않게.
// 올라간 줄(ReportRow)과 못 올린 빨간 줄이 이 한 벌을 쓴다.
function MiddleName({ name, className = '' }) {
  const [head, tail] = splitNameTail(name);
  return (
    <p className={`flex min-w-0 ${className}`}>
      <span className="club-meet-report-head min-w-0 overflow-hidden text-ellipsis whitespace-pre">{head}</span>
      <span className="club-meet-report-tail shrink-0 whitespace-pre">{tail}</span>
    </p>
  );
}

// 파일 한 줄 — 종류 칩 · 이름(가운데 말줄임) · 올린 사람 · 날짜 · 크기. 줄을 누르면 미리보기.
function ReportRow({ row, meta, pending = false, onOpen, children = null }) {
  const kind = fileKind(row.name, row.mime_type);
  const moving = pending && row._phase === 'move';
  const pct = moving ? 100 : (pending && Number.isFinite(row._pct) ? row._pct : null);
  return (
    <div className={`club-meet-report-row${pending ? ' club-meet-report-pending' : ''} flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-canvas min-w-0`}>
      <span className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 ${pending ? 'bg-surface-hover text-fg-faint' : kind.chip}`}>{kind.icon}</span>
      <button type="button" onClick={onOpen} title={row.name} className="min-w-0 flex-1 text-left">
        <MiddleName name={row.name} className={`club-meet-report-name text-[12px] font-semibold ${pending ? 'text-fg-muted' : 'text-fg'}`} />
        <p className="club-meet-report-meta mt-px flex items-center gap-1 text-[10.5px] text-fg-muted min-w-0">
          {pending && <Loader2 size={10} className="shrink-0 animate-spin" />}
          <span className="truncate">{meta}</span>
          {pct !== null && !moving && <span className="ml-auto tabular-nums font-semibold shrink-0">{pct}%</span>}
        </p>
        {pct !== null && <UploadTrack pct={pct} />}
      </button>
      {children}
    </div>
  );
}
