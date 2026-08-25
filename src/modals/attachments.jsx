import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, File, FileSpreadsheet, Presentation, Paperclip, UploadCloud,
  Loader2, AlertTriangle, Eye, Trash2, X,
} from 'lucide-react';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { uploadAttachment, getAttachmentUrls, deleteAttachment, listCardFiles, getFileOpenUrl } from '../services/cloud.js';
import { FilePreviewModal, officeSrc, PreparingFrame, FRAME_SETTLE, OFFICE_TIMEOUT } from '../components/FilePreviewModal.jsx';
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

// 새 업무(저장 전) 첨부 — 파일은 카드 id가 있어야 올라간다(files가 카드를 참조).
// 그래서 여기서는 File 객체를 골라 담아두기만 하고, 저장 직후 셸이 올린다.
// 쓰는 사람에게는 "처음부터 첨부"와 같다.
export const PendingAttachments = ({ files = [], onChange }) => {
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState([]);
  const inputRef = useRef(null);
  const add = (fileList) => {
    const picked = Array.from(fileList || []);
    const tooBig = picked.filter(f => f.size > MAX_UPLOAD_BYTES);
    setRejected(tooBig.map(f => ({ name: f.name, size: f.size })));
    tooBig.forEach(f => showToast(`'${f.name}'은(는) 25MB를 넘어 첨부하지 못했어요.`));
    const ok = picked.filter(f => f.size <= MAX_UPLOAD_BYTES);
    if (ok.length) onChange([...files, ...ok]);
  };
  const remove = (i) => onChange(files.filter((_, x) => x !== i));
  return (
    <div className="mt-5">
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-fg-muted"><Paperclip size={13} className="text-fg-faint" /> 첨부 파일</div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent-weak/40' : 'border-line hover:bg-surface-2/50'}`}
      >
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <UploadCloud size={20} strokeWidth={1.75} className="mx-auto text-fg-faint mb-1" />
        <p className="text-[11px] text-fg-muted">파일을 끌어다 놓거나 클릭해서 선택하세요</p>
        <p className="text-[10px] text-fg-faint mt-0.5">저장하면 올라가요 · 최대 25MB</p>
      </div>
      {rejected.length > 0 && (
        <p className="mt-2 text-[11px] text-tag-red-fg">한 파일당 25MB까지 올릴 수 있어요 · {rejected.map(f => f.name).join(', ')}</p>
      )}
      {files.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {files.map((f, i) => {
            const kind = fileKind(f.name, f.type);
            return (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2.5 py-2 animate-in fade-in duration-200">
                <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-fg truncate">{f.name}</p>
                  <p className="text-[10px] text-fg-faint mt-0.5">{formatBytes(f.size)}</p>
                </div>
                <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95" title="빼기"><X size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// 스토리지에 실체가 있는 엑셀만 펼칠 수 있다(드라이브로 옮긴 파일은 서명 URL이 없다).
// csv는 오피스 뷰어가 못 그린다 — 미리보기(텍스트)로 본다.
const isSheetRow = (row) => !!row.storage_path
  && ['xls', 'xlsx'].includes((String(row.name || '').split('.').pop() || '').toLowerCase());

// 엑셀을 행 바로 아래에 펼친다 — 노션식 임베드(읽기 전용, 미리보기와 같은 MS 뷰어).
// 서명 URL은 펼칠 때마다 새로 받는다(만료가 있어서 담아두면 다음 날 깨진 화면이 남는다).
// 뷰어가 첫 페이지를 그릴 때까지 우리 스켈레톤으로 덮는다 — 안 덮으면 MS 뷰어의
// 로딩 화면(남의 폰트·남의 스피너)이 그대로 비쳐서 앱이 아닌 화면처럼 보인다.
// 미리보기 모달(FilePreviewModal)과 같은 값·같은 스켈레톤을 쓴다.
function InlineSheet({ row }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // '크게 보기' — 기본 높이는 업무 창 스크롤을 다 잡아먹지 않는 선(420px)이고,
  // 표를 제대로 볼 때는 화면 높이 75%까지 늘린다. 버튼 토글이라 모바일에서도 된다
  // (CSS resize 핸들은 터치에서 안 잡히고, 밀어야 나오는 조작은 §8에 걸린다).
  const [tall, setTall] = useState(false);
  const settleRef = useRef(null);
  useEffect(() => {
    let alive = true;
    getFileOpenUrl(row)
      .then(u => { if (alive) setUrl(u); })
      .catch(e => { if (alive) setErr(e.message || String(e)); });
    return () => { alive = false; clearTimeout(settleRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  useEffect(() => {
    if (!url || ready) return;
    const t = setTimeout(() => setTimedOut(true), OFFICE_TIMEOUT);
    return () => clearTimeout(t);
  }, [url, ready]);
  if (err) return <p className="text-[11px] text-fg-faint py-2">펼쳐보기를 준비하지 못했어요 · {err}</p>;
  if (timedOut && !ready) return <p className="text-[11px] text-fg-faint py-2">미리보기가 응답하지 않아요 · 눈 모양(미리보기)으로 열어보세요</p>;
  return (
    <div className="pb-2">
      <div className={`relative w-full ${tall ? 'h-[75dvh]' : 'h-[320px] md:h-[420px]'}`}>
        {!ready && <PreparingFrame absolute />}
        {url && (
          <iframe
            src={officeSrc(url)} title={row.name}
            // onLoad 직후엔 아직 첫 페이지가 안 그려져 있다 → 조금 뒤에 걷는다(모달과 동일)
            onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setReady(true), FRAME_SETTLE); }}
            className={`w-full h-full rounded-md border border-line bg-surface ${ready ? '' : 'opacity-0'}`}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-[10px] text-fg-faint min-w-0 truncate">마이크로소프트 오피스 미리보기로 표시해요</p>
        <button type="button" onClick={() => setTall(t => !t)}
          className="shrink-0 text-[10px] font-semibold text-accent-text hover:underline transition active:scale-95">
          {tall ? '원래 높이로' : '크게 보기'}
        </button>
      </div>
    </div>
  );
}

// thumb(서명 URL)은 상위에서 일괄 발급받아 주입 — 행마다 개별 요청하지 않는다
const AttachmentRow = ({ row, canDelete, thumb, onOpen, onRemove, embedded, onToggleEmbed }) => {
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
      {/* 엑셀은 행 아래로 바로 펼친다 — 글자 버튼: hover 뒤에 숨기지 않는다(§8) */}
      {onToggleEmbed && (
        <button type="button" onClick={onToggleEmbed}
          className="shrink-0 px-1.5 py-1 rounded-md text-[11px] font-semibold text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95">
          {embedded ? '접기' : '펼쳐보기'}
        </button>
      )}
      <button type="button" onClick={onOpen} className="p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95" title="미리보기"><Eye size={14} /></button>
      {canDelete && (
        <ConfirmPopover message={`'${row.name}'을(를) 삭제할까요?`} onConfirm={onRemove}>
          <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95" title="삭제"><Trash2 size={14} /></button>
        </ConfirmPopover>
      )}
    </div>
  );
};

export const AttachmentSection = ({ task, userId, isAdmin, onFileActivity, readOnly = false, uploadingNames = [] }) => {
  // 이미 받아둔 attachments를 먼저 그리고(즉시 표시) 백그라운드로 갱신
  const [items, setItems] = useState(task.attachments || []);
  const [thumbs, setThumbs] = useState({}); // { storage_path: signedUrl }
  const [dragOver, setDragOver] = useState(false);
  const [uploadingName, setUploadingName] = useState(null);
  const [rejected, setRejected] = useState([]); // 용량 초과로 건너뛴 파일들
  const [preview, setPreview] = useState(null); // 미리보기로 열어둔 files 행
  const [embedded, setEmbedded] = useState({}); // { files.id: true } — 펼쳐둔 엑셀
  const inputRef = useRef(null);

  // 첫 페인트 경쟁 방지: 네트워크는 유휴 시점으로 미룬다(모달은 로컬 데이터로 먼저 뜬다)
  useEffect(() => {
    let alive = true;
    const handle = whenIdle(() => {
      // 새 업무는 저장 직후 첨부가 올라가는 중이라, 이 조회가 그 전에 다녀오면 빈 목록이
      // 온다. 그걸 그대로 받으면 방금 올라온 파일을 도로 지운다 → 더 짧은 응답은 버린다.
      // ponytail: 다른 사람이 지운 파일은 이 조회로 사라지지 않는다(다시 열면 맞는다) —
      // 그 경우가 드물고, 방금 올린 내 파일이 사라지는 쪽이 훨씬 자주 겪는 일이다.
      listCardFiles(task.id)
        .then(rows => { if (alive) setItems(prev => (rows.length >= prev.length ? rows : prev)); })
        .catch(e => console.error('[cloud] 첨부 목록 로드 실패:', e));
    });
    return () => { alive = false; cancelIdle(handle); };
  }, [task.id]);

  // 생성 시 골라둔 첨부는 저장 **직후** 셸이 올려 스토어(task.attachments)로 들어온다 —
  // 위 listCardFiles가 업로드가 끝나기 전에 다녀갔을 수 있어, 더 긴 목록이 오면 반영한다.
  useEffect(() => {
    const rows = task.attachments || [];
    if (rows.length) setItems(prev => (prev.length >= rows.length ? prev : rows));
  }, [task.attachments]);

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

  // 읽기 전용(뷰어)에서 첨부가 없으면 섹션 자체를 숨김 — 올라가는 중이면 자리를 남긴다
  if (readOnly && items.length === 0 && !uploadingNames.length) return null;

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
      {/* 저장 직후 올라가는 중인 파일 — 실제 행과 같은 자리·같은 높이로 둔다.
          비워 두면 업로드가 끝날 때까지 '첨부가 안 됐다'로 읽힌다. */}
      {uploadingNames.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {uploadingNames.map(name => (
            <div key={name} className="flex items-center gap-2.5 py-2">
              <span className="w-9 h-9 rounded-md bg-surface-hover flex items-center justify-center shrink-0">
                <Loader2 size={14} className="animate-spin text-fg-faint" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-fg truncate">{name}</p>
                <p className="text-[10px] text-fg-faint mt-0.5">올리는 중…</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {items.map(row => (
            <div key={row.id}>
              <AttachmentRow row={row} thumb={thumbs[row.storage_path]} canDelete={!readOnly && (isAdmin || row.uploaded_by === userId)} onOpen={() => openFile(row)} onRemove={() => removeItem(row)}
                embedded={!!embedded[row.id]}
                onToggleEmbed={isSheetRow(row) ? () => setEmbedded(prev => ({ ...prev, [row.id]: !prev[row.id] })) : null} />
              {embedded[row.id] && isSheetRow(row) && <InlineSheet row={row} />}
            </div>
          ))}
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
