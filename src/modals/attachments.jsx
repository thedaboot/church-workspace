import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, File, FileSpreadsheet, Presentation, Paperclip, UploadCloud,
  Loader2, AlertTriangle, Eye, Trash2, X,
} from 'lucide-react';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { uploadAttachment, getAttachmentUrls, deleteAttachment, listCardFiles } from '../services/cloud.js';
import { FilePreviewModal } from '../components/FilePreviewModal.jsx';
import { SmartImage } from '../components/media.jsx';

// ============================================================================
// 업무 창의 첨부 파일 영역 (클라우드 모드 전용)
// ----------------------------------------------------------------------------
// 업로드·삭제는 수정 모드에서, 보기 모드는 읽기 전용 목록.
// 파일 실체는 Supabase Storage(private 버킷), DB에는 참조(files)만 있다.
// ============================================================================

// 첫 페인트 이후(유휴)로 작업을 미루는 헬퍼 — requestIdleCallback 미지원 시 타이머 폴백.
// 첨부 목록·썸네일 URL 발급은 모달이 뜬 뒤에 해도 되는 일이라 여기로 미룬다.
const whenIdle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 800 })
  : setTimeout(fn, 0));
const cancelIdle = (h) => {
  if (h == null) return;
  if (typeof cancelIdleCallback === 'function') { try { cancelIdleCallback(h); return; } catch { /* 타이머 핸들일 수 있음 */ } }
  clearTimeout(h);
};

// ── 첨부 파일 (클라우드 모드 전용) ──────────────────────────────────────────
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // Supabase Storage 버킷 제한과 동일
const formatBytes = (b) => {
  if (b === null || b === undefined) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fileKind = (name = '', mime = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const has = (m) => (mime || '').includes(m);
  if (ext === 'pdf' || has('pdf')) return { chip: 'bg-tag-red text-tag-red-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['doc', 'docx'].includes(ext) || has('word')) return { chip: 'bg-tag-blue text-tag-blue-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['ppt', 'pptx'].includes(ext) || has('presentation')) return { chip: 'bg-tag-orange text-tag-orange-fg', icon: <Presentation size={16} strokeWidth={1.75} /> };
  if (['xls', 'xlsx', 'csv'].includes(ext) || has('sheet') || has('excel') || has('csv')) return { chip: 'bg-tag-green text-tag-green-fg', icon: <FileSpreadsheet size={16} strokeWidth={1.75} /> };
  return { chip: 'bg-tag-gray text-tag-gray-fg', icon: <File size={16} strokeWidth={1.75} /> };
};

// thumb(서명 URL)은 상위에서 일괄 발급받아 주입 — 행마다 개별 요청하지 않는다
const AttachmentRow = ({ row, canDelete, thumb, onOpen, onRemove }) => {
  // 썸네일은 스토리지 파일만(드라이브로 옮긴 파일은 서명 URL이 없으므로 아이콘)
  const isImage = (row.mime_type || '').startsWith('image/') && !!row.storage_path;
  const kind = fileKind(row.name, row.mime_type);
  return (
    <div className="flex items-center gap-2.5 py-2 animate-in fade-in duration-200">
      {isImage
        ? <SmartImage
            src={thumb} alt={row.name} onClick={onOpen} title="미리보기"
            wrapperClassName="h-20 w-20 shrink-0 inline-block"
            className="h-20 w-20 object-cover rounded-md border border-line"
          />
        : <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-fg truncate">{row.name}</p>
        <p className="text-[10px] text-fg-faint mt-0.5">{formatBytes(row.size_bytes)}</p>
      </div>
      <button type="button" onClick={onOpen} className="p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95" title="미리보기"><Eye size={14} /></button>
      {canDelete && (
        <ConfirmPopover message={`'${row.name}'을(를) 삭제할까요?`} onConfirm={onRemove}>
          <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-red-500 hover:bg-surface-hover transition active:scale-95" title="삭제"><Trash2 size={14} /></button>
        </ConfirmPopover>
      )}
    </div>
  );
};

export const AttachmentSection = ({ task, userId, isAdmin, onFileActivity, readOnly = false }) => {
  // 이미 받아둔 attachments를 먼저 그리고(즉시 표시) 백그라운드로 갱신
  const [items, setItems] = useState(task.attachments || []);
  const [thumbs, setThumbs] = useState({}); // { storage_path: signedUrl }
  const [dragOver, setDragOver] = useState(false);
  const [uploadingName, setUploadingName] = useState(null);
  const [rejected, setRejected] = useState([]); // 용량 초과로 건너뛴 파일들
  const [preview, setPreview] = useState(null); // 미리보기로 열어둔 files 행
  const inputRef = useRef(null);

  // 첫 페인트 경쟁 방지: 네트워크는 유휴 시점으로 미룬다(모달은 로컬 데이터로 먼저 뜬다)
  useEffect(() => {
    let alive = true;
    const handle = whenIdle(() => {
      listCardFiles(task.id).then(rows => { if (alive) setItems(rows); }).catch(e => console.error('[cloud] 첨부 목록 로드 실패:', e));
    });
    return () => { alive = false; cancelIdle(handle); };
  }, [task.id]);

  // 이미지 썸네일 서명 URL을 한 번에 발급 (이미지 없으면 스토리지 호출 없음)
  useEffect(() => {
    const need = items.filter(r => (r.mime_type || '').startsWith('image/') && r.storage_path && !thumbs[r.storage_path]).map(r => r.storage_path);
    if (!need.length) return;
    let alive = true;
    const handle = whenIdle(() => {
      getAttachmentUrls(need)
        .then(map => { if (alive) setThumbs(prev => ({ ...prev, ...map })); })
        .catch(e => console.error('[cloud] 썸네일 URL 발급 실패:', e));
    });
    return () => { alive = false; cancelIdle(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    // 용량 초과 파일은 토스트로 알리고 + 업로드 영역에 계속 남는 경고로도 보여준다
    // (토스트는 몇 초 뒤 사라져서 "왜 안 올라갔지?"가 남는다)
    const tooBig = files.filter(f => f.size > MAX_UPLOAD_BYTES);
    setRejected(tooBig.map(f => ({ name: f.name, size: f.size })));
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) { showToast(`'${file.name}'은(는) 25MB를 넘어 첨부하지 못했어요.`); continue; }
      try {
        setUploadingName(file.name);
        const row = await uploadAttachment(file, { projectId: task.projectId, cardId: task.id });
        setItems(prev => [...prev, row]);
        onFileActivity?.(`파일 '${row.name}'을(를) 첨부했습니다.`);
      } catch (e) {
        console.error('[cloud] 업로드 실패:', e);
        showToast(`업로드 실패 (${file.name}) · ${e.message || e}`);
      } finally {
        setUploadingName(null);
      }
    }
  };

  // 클립보드 이미지 붙여넣기 (수정 모드에서만; 본문 textarea 붙여넣기는 stopPropagation으로 제외)
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e) => { const f = e.clipboardData?.files; if (f && f.length) uploadFiles(f); };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, readOnly]);

  // 스토리지 링크를 새 탭으로 던지지 않고 앱 안 미리보기로 연다
  // (모달 안에 '새 탭에서 열기'·'내려받기'가 있다)
  const openFile = (row) => setPreview(row);
  const removeItem = async (row) => {
    try {
      await deleteAttachment(row);
      setItems(prev => prev.filter(x => x.id !== row.id));
      onFileActivity?.(`파일 '${row.name}'을(를) 삭제했습니다.`);
    } catch (e) { console.error('[cloud] 삭제 실패:', e); showToast('삭제 실패 · ' + (e.message || e)); }
  };

  // 읽기 전용(뷰어)에서 첨부가 없으면 섹션 자체를 숨김
  if (readOnly && items.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-fg-muted"><Paperclip size={13} className="text-fg-faint" /> 첨부 파일</div>
      {!readOnly && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent-weak/40' : 'border-line hover:bg-surface-2/50'}`}
        >
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }} />
          <UploadCloud size={20} strokeWidth={1.75} className="mx-auto text-fg-faint mb-1" />
          <p className="text-[11px] text-fg-muted">파일을 끌어다 놓거나 클릭해서 선택하세요</p>
          <p className="text-[10px] text-fg-faint mt-0.5">이미지는 붙여넣기(Ctrl/⌘+V)도 돼요 · 최대 25MB</p>
        </div>
      )}
      {!readOnly && uploadingName && <div className="flex items-center gap-2 mt-2 text-[11px] text-fg-muted"><Loader2 size={13} className="animate-spin" /> 업로드 중: {uploadingName}</div>}
      {!readOnly && rejected.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-tag-red-fg/30 bg-tag-red/60 px-2.5 py-2 animate-in fade-in duration-200">
          <AlertTriangle size={14} className="text-tag-red-fg shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-tag-red-fg">한 파일당 25MB까지 올릴 수 있어요</p>
            <ul className="mt-0.5 space-y-0.5">
              {rejected.map(f => (
                <li key={f.name} className="text-[10px] text-tag-red-fg/90 truncate">{f.name} · {formatBytes(f.size)}</li>
              ))}
            </ul>
            <p className="text-[10px] text-tag-red-fg/80 mt-1">용량을 줄이거나 링크(리소스)로 공유해 주세요.</p>
          </div>
          <button type="button" onClick={() => setRejected([])} className="p-0.5 rounded text-tag-red-fg/70 hover:text-tag-red-fg transition shrink-0" title="닫기"><X size={13} /></button>
        </div>
      )}
      {items.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {items.map(row => <AttachmentRow key={row.id} row={row} thumb={thumbs[row.storage_path]} canDelete={!readOnly && (isAdmin || row.uploaded_by === userId)} onOpen={() => openFile(row)} onRemove={() => removeItem(row)} />)}
        </div>
      )}
      {preview && (
        <FilePreviewModal
          row={preview}
          // 목록에서 이미 받아둔 이미지가 있으면 그대로 넘겨 스켈레톤 없이 바로 띄운다
          initialSrc={thumbs[preview.storage_path] || null}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
};
