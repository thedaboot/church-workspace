import React, { useState, useEffect, useRef } from 'react';
import { FileText, File, FileSpreadsheet, Presentation, Paperclip, UploadCloud, Loader2, AlertTriangle, Eye, Trash2, X, Lock, LockOpen } from 'lucide-react';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { uploadAttachment, getAttachmentUrls, getAttachmentThumbUrls, deleteAttachment, listCardFiles, getFileOpenUrl, setFilePassword, checkFilePassword, driveImageUrl, fetchDriveFileBlob } from '../services/cloud.js';
import { FilePreviewModal } from '../components/FilePreviewModal.jsx';
import { SheetView } from '../components/SheetView.jsx';
import { SmartImage, Skeleton } from '../components/media.jsx';
import { useStore, store } from '../store/workspaceStore.js';
import { selectProjectsMap } from '../store/selectors.js';
import { ensureProjectFolder } from '../services/cloudSync.js';

// ============================================================================
// 업무 창의 첨부 파일 영역 (클라우드 모드 전용)
// ----------------------------------------------------------------------------
// 업로드·삭제는 수정 모드에서, 보기 모드는 읽기 전용 목록.
// 파일 실체는 Supabase Storage(private 버킷), DB에는 참조(files)만 있다.
// ============================================================================

// 이번 세션에 지운 첨부 id — **모듈 레벨**이라 수정 화면에서 지우고 바로 저장해
// 보기 화면(다른 인스턴스)이 떠도 공유된다. 삭제가 DB에 닿기 전에 다녀간 조회가
// 지운 파일을 되살리는 경합의 이중 방어다(1차 방어는 cloud.deleteAttachment가
// DB 행을 먼저 지우는 것). 실패해서 되살릴 때는 도로 뺀다.
const deletedFileIds = new Set();

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

// ── 첨부 비밀번호 (엑셀만 — 사용자 결정 2026-08-25) ────────────────────────
// **화면을 가리는 잠금이다.** 주소를 직접 아는 사람은 그대로 열 수 있다(0023 주석).
// 그래서 문구에 '암호화'라는 말을 쓰지 않고, 무엇을 막는지 그대로 적는다.
function PasswordGate({ row, onUnlock }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (await checkFilePassword(row, pw)) { onUnlock(); return; }
    setWrong(true);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 pb-2 pl-[46px]">
      <input
        type="password" value={pw} autoComplete="off"
        onChange={(e) => { setPw(e.target.value); setWrong(false); }}
        placeholder="비밀번호"
        className="w-32 px-2 py-1.5 rounded-md border border-line bg-surface text-[13px] text-fg outline-none focus:border-accent transition-colors"
      />
      <button type="submit" className="px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11px] font-semibold transition active:scale-95">열기</button>
      {wrong && <span className="text-[11px] text-tag-red-fg">비밀번호가 맞지 않아요</span>}
    </form>
  );
}

// 비밀번호를 걸거나 푸는 줄 — 올린 사람과 관리자만 본다
function PasswordSetter({ row, onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (next) => {
    setBusy(true);
    try { onDone(await setFilePassword(row.id, next)); }
    catch (e) { console.error('[cloud] 첨부 비밀번호 저장 실패:', e); showToast(failText('비밀번호를 저장하지 못했어요', e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="pb-2 pl-[46px]">
      <div className="flex items-center gap-2">
        <input
          type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off"
          placeholder={row.view_pw ? '새 비밀번호' : '비밀번호를 정해주세요'}
          className="w-40 px-2 py-1.5 rounded-md border border-line bg-surface text-[13px] text-fg outline-none focus:border-accent transition-colors"
        />
        <button type="button" disabled={busy || !pw} onClick={() => save(pw)}
          className="px-2.5 py-1.5 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">저장</button>
        {row.view_pw && (
          <button type="button" disabled={busy} onClick={() => save('')}
            className="px-2.5 py-1.5 rounded-md bg-surface-hover text-fg-muted text-[11px] font-semibold transition active:scale-95">잠금 해제</button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-fg-faint leading-relaxed">
        비밀번호를 아는 사람만 앱에서 열 수 있어요.
      </p>
    </div>
  );
}

// 엑셀은 어디에 있든 펼칠 수 있다. 드라이브 파일은 **구글 자체 미리보기**를 쓰므로
// 마이크로소프트로 주소가 나가지 않는다(Storage 파일만 MS 뷰어를 거친다).
// csv는 어느 뷰어도 표로 그리지 못한다 — 미리보기(텍스트)로 본다.
const isSheetRow = (row) => (!!row.storage_path || (row.source === 'drive' && !!row.drive_file_id))
  && ['xls', 'xlsx', 'csv'].includes((String(row.name || '').split('.').pop() || '').toLowerCase());

// 엑셀을 행 바로 아래에 펼친다 — 노션식 임베드(읽기 전용).
// 예전에는 구글·마이크로소프트 뷰어를 iframe으로 물렸는데, 갓 올린 파일에서
// 구글 편집기 preview가 오류를 뱉어 파일 나이 30분으로 뷰어를 갈라야 했다
// (utils.driveSrc). "올리고 바로 펼쳐보기"가 가장 흔한 동작인데 그때가 제일
// 못생겼다. 지금은 바이트를 받아 **우리가 직접 그린다**(SheetView) — 기다릴 것이
// 없고, 라이트·다크도 따라간다. 미리보기 모달과 같은 컴포넌트다.
function InlineSheet({ row }) {
  const [src, setSrc] = useState(null);      // { blob } 또는 { text }(csv)
  const [err, setErr] = useState(null);
  // '크게 보기' — 기본 높이는 업무 창 스크롤을 다 잡아먹지 않는 선(420px)이고,
  // 표를 제대로 볼 때는 화면 높이 75%까지 늘린다. 버튼 토글이라 모바일에서도 된다
  // (CSS resize 핸들은 터치에서 안 잡히고, 밀어야 나오는 조작은 §8에 걸린다).
  const [tall, setTall] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null); setErr(null);
    const asCsv = (String(row.name || '').split('.').pop() || '').toLowerCase() === 'csv';
    const take = (b) => (asCsv ? b.text().then(t => ({ text: t })) : Promise.resolve({ blob: b }));
    const got = (v) => { if (alive) setSrc(v); };
    const failed = (e) => { if (alive) setErr(e.human || e.message || String(e)); };
    if (row.source === 'drive' && row.drive_file_id) {
      fetchDriveFileBlob(row.drive_file_id).then(take).then(got).catch(failed);
    } else {
      getFileOpenUrl(row)
        .then(u => fetch(u))
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(take).then(got).catch(failed);
    }
    return () => { alive = false; };
  }, [row.id, row.name, row.source, row.drive_file_id]);

  if (err) return <p className="text-[11px] text-fg-faint py-2">펼쳐보기를 준비하지 못했어요 · {err}</p>;
  return (
    <div className="pb-2">
      <div className={`relative w-full ${tall ? 'h-[75dvh]' : 'h-[320px] md:h-[420px]'}`}>
        {src
          ? <SheetView blob={src.blob} text={src.text ?? null} name={row.name} onError={(e) => setErr(e.message || String(e))} />
          : <Skeleton className="w-full h-full" />}
      </div>
      <div className="flex items-center justify-end mt-1">
        <button type="button" onClick={() => setTall(t => !t)}
          className="shrink-0 text-[10px] font-semibold text-accent-text hover:underline transition active:scale-95">
          {tall ? '원래 높이로' : '크게 보기'}
        </button>
      </div>
    </div>
  );
}

// thumb(서명 URL)은 상위에서 일괄 발급받아 주입 — 행마다 개별 요청하지 않는다
const AttachmentRow = ({ row, canDelete, thumb, thumbFailed, onOpen, onRemove, embedded, onToggleEmbed, locked, onToggleLockUI, canLock }) => {
  // 이미지 썸네일 — 스토리지는 200px 서명 URL, 드라이브는 구글 이미지 CDN이
  // 줄여서 내준다(우리 대역폭 0). 주소 발급이 실패한 것은 아이콘으로 돌아간다:
  // 스켈레톤을 영원히 두면 "고장"으로 읽힌다.
  const src = row.source === 'drive'
    ? (row.drive_file_id ? driveImageUrl(row.drive_file_id) : null)
    : thumb;
  const isImage = (row.mime_type || '').startsWith('image/') && !!src && !thumbFailed;
  const kind = fileKind(row.name, row.mime_type);
  return (
    <div className="flex items-center gap-2.5 py-2 animate-in fade-in duration-200">
      {isImage
        ? <SmartImage
            src={src} alt={row.name} onClick={onOpen} title="미리보기"
            wrapperClassName="h-20 w-20 shrink-0 inline-block"
            className="h-20 w-20 object-cover rounded-md border border-line"
          />
        : <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-fg truncate">{row.name}</p>
        <p className="text-[10px] text-fg-faint mt-0.5">{formatBytes(row.size_bytes)}</p>
      </div>
      {/* 잠긴 파일이라는 표시. 자물쇠는 '아는 사람만 본다'를 한눈에 말한다 */}
      {row.view_pw && <Lock size={12} className="shrink-0 text-fg-faint" aria-label="비밀번호가 걸린 파일" />}
      {canLock && (
        <button type="button" onClick={onToggleLockUI}
          className="shrink-0 p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95"
          title={row.view_pw ? '비밀번호 바꾸기·풀기' : '비밀번호 걸기'}>
          {row.view_pw ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      )}
      {/* 엑셀은 행 아래로 바로 펼친다 — 글자 버튼: hover 뒤에 숨기지 않는다(§8) */}
      {onToggleEmbed && (
        <button type="button" onClick={onToggleEmbed}
          className="shrink-0 px-1.5 py-1 rounded-md text-[11px] font-semibold text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95">
          {embedded ? '접기' : '펼쳐보기'}
        </button>
      )}
      <button type="button" onClick={onOpen} className="p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95" title={locked ? '비밀번호를 넣어야 열려요' : '미리보기'}><Eye size={14} /></button>
      {canDelete && (
        <ConfirmPopover message={`'${row.name}'을(를) 삭제할까요?`} onConfirm={onRemove}>
          <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95" title="삭제"><Trash2 size={14} /></button>
        </ConfirmPopover>
      )}
    </div>
  );
};

export const AttachmentSection = ({ task, userId, isAdmin, onFileActivity, readOnly = false, uploadingNames = [] }) => {
  // 드라이브는 프로젝트 하나에 폴더 하나다. 이름이 아니라 **폴더 id**를 넘겨야
  // 프로젝트 이름을 바꿔도 예전 파일과 새 파일이 두 폴더로 갈라지지 않는다.
  const project = useStore(selectProjectsMap)[task.projectId];
  // 이미 받아둔 attachments를 먼저 그리고(즉시 표시) 백그라운드로 갱신
  const [items, setItems] = useState(task.attachments || []);
  // 목록 조회가 다녀오기 전인지. 이게 없으면 첨부가 있는 업무를 열었을 때
  // 첨부 영역이 통째로 없다가 나중에 툭 나타난다(사용자 지적 — 이미지가 바로 안 보인다).
  // 몇 개인지는 조회 전에도 안다(cards.file_count) → 그 수만큼 자리를 미리 잡는다.
  const [listing, setListing] = useState(!(task.attachments || []).length);
  const [thumbs, setThumbs] = useState({}); // { storage_path: signedUrl }
  // 서명 URL을 못 받은 경로. 이게 없으면 발급이 실패했을 때 스켈레톤이 영원히 남는다 —
  // 이미지가 많을수록 한 요청이 커져서 걸릴 확률이 올라간다(사용자 지적).
  const [thumbFailed, setThumbFailed] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [uploadingList, setUploadingList] = useState([]); // 지금 올라가는 파일 이름들(병렬)
  // 지금 올리는 중인지 — 위 조회가 업로드를 앞질렀는지 가르는 유일한 근거다
  const uploadingRef = useRef(false);
  const [rejected, setRejected] = useState([]); // 용량 초과로 건너뛴 파일들
  const [preview, setPreview] = useState(null); // 미리보기로 열어둔 files 행
  const [embedded, setEmbedded] = useState({}); // { files.id: true } — 펼쳐둔 엑셀
  const [unlocked, setUnlocked] = useState({}); // { files.id: true } — 이번에 비밀번호를 맞춘 것
  const [lockUI, setLockUI] = useState({});     // { files.id: true } — 비밀번호 설정 줄을 연 것
  const [askPw, setAskPw] = useState({});       // { files.id: true } — 비밀번호를 물어야 하는 것
  const inputRef = useRef(null);

  // 첫 페인트 경쟁 방지: 네트워크는 유휴 시점으로 미룬다(모달은 로컬 데이터로 먼저 뜬다)
  useEffect(() => {
    let alive = true;
    const handle = whenIdle(() => {
      // 새 업무는 저장 직후 첨부가 올라가는 중이라, 이 조회가 그 전에 다녀오면 빈 목록이
      // 온다. 그걸 그대로 받으면 방금 올라온 파일을 도로 지운다.
      // **다만 "짧으면 무조건 버린다"로 두면 지운 파일이 되살아난다**(사용자 지적).
      // 올리는 중일 때만 버린다 — 그때가 조회가 앞질러 갈 수 있는 유일한 순간이다.
      listCardFiles(task.id)
        .then(rows => {
          if (!alive) return;
          rows = rows.filter(r => !deletedFileIds.has(r.id));   // 방금 지운 것은 되살리지 않는다
          const uploading = uploadingRef.current;
          setItems(prev => (rows.length >= prev.length || !uploading ? rows : prev));
        })
        .catch(e => console.error('[cloud] 첨부 목록 로드 실패:', e))
        .finally(() => { if (alive) setListing(false); });
    });
    return () => { alive = false; cancelIdle(handle); };
  }, [task.id]);

  // 생성 시 골라둔 첨부는 저장 **직후** 셸이 올려 스토어(task.attachments)로 들어온다 —
  // 위 listCardFiles가 업로드가 끝나기 전에 다녀갔을 수 있어, 더 긴 목록이 오면 반영한다.
  useEffect(() => {
    const rows = (task.attachments || []).filter(r => !deletedFileIds.has(r.id));
    if (rows.length) setItems(prev => (prev.length >= rows.length ? prev : rows));
  }, [task.attachments]);

  // 이미지 썸네일 서명 URL을 한 번에 발급 (이미지 없으면 스토리지 호출 없음)
  useEffect(() => {
    const need = items.filter(r => (r.mime_type || '').startsWith('image/') && r.storage_path && !thumbs[r.storage_path]).map(r => r.storage_path);
    if (!need.length) return;
    let alive = true;
    // 유휴까지 미루지 않는다 — 이 효과는 목록이 온 뒤에 도는 것이라 창은 이미 그려졌고,
    // 서명 URL 발급은 네트워크라 첫 페인트와 다투지 않는다. 미뤄 두었더니 그만큼
    // 썸네일이 늦게 떴다(사용자 지적).
    // 200px로 줄여 받는다(원본을 받으면 사진 한 장에 1.5MB다).
    // 변환이 안 되는 경로만 원본 서명으로 한 번 더 시도한다.
    getAttachmentThumbUrls(need)
      .then(async map => {
        const missing = need.filter(p => !map[p]);
        if (missing.length) {
          try { Object.assign(map, await getAttachmentUrls(missing)); }
          catch (e) { console.error('[cloud] 원본 서명도 실패:', e); }
        }
        if (!alive) return;
        setThumbs(prev => ({ ...prev, ...map }));
        const dead = need.filter(p => !map[p]);
        if (dead.length) setThumbFailed(prev => ({ ...prev, ...Object.fromEntries(dead.map(p => [p, true])) }));
      })
      .catch(e => {
        console.error('[cloud] 썸네일 URL 발급 실패:', e);
        if (alive) setThumbFailed(prev => ({ ...prev, ...Object.fromEntries(need.map(p => [p, true])) }));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    // 용량 초과 파일은 토스트로 알리고 + 업로드 영역에 계속 남는 경고로도 보여준다
    // (토스트는 몇 초 뒤 사라져서 "왜 안 올라갔지?"가 남는다)
    const tooBig = files.filter(f => f.size > MAX_UPLOAD_BYTES);
    setRejected(tooBig.map(f => ({ name: f.name, size: f.size })));
    tooBig.forEach(f => showToast(`'${f.name}'은(는) 25MB를 넘어 첨부하지 못했어요.`));
    const ok = files.filter(f => f.size <= MAX_UPLOAD_BYTES);
    if (!ok.length) return;

    uploadingRef.current = true;
    setUploadingList(prev => [...prev, ...ok.map(f => f.name)]);
    try {
      // 폴더는 첫 업로드 때 한 번만 확보한다 — 그 뒤로는 id로 바로 올려서
      // 프로젝트 이름을 바꿔도 파일이 두 폴더로 갈라지지 않는다
      const folderId = project ? await ensureProjectFolder(project) : null;
      const uploadOne = async (file, cardFolderId) => {
        const row = await uploadAttachment(file, {
          projectId: task.projectId, cardId: task.id,
          projectName: project?.title, driveFolderId: folderId || project?.driveFolderId,
          cardTitle: task.title, cardFolderId,
        });
        setItems(prev => {
          const next = [...prev, row];
          // 스토어도 같이 — 여기만 두면 창을 닫았다 열 때 새 파일이 잠깐 사라져 보인다
          store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, attachments: next } });
          return next;
        });
        setUploadingList(prev => { const i = prev.indexOf(file.name); return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; });
        onFileActivity?.(`파일 '${row.name}'을(를) 첨부했습니다.`);
        return row;
      };
      // **동시 3개** — 순차는 사진 열 장에 수십 초였다. 단, 업무 폴더가 아직 없으면
      // 첫 파일이 혼자 폴더를 만들고 나머지가 병렬로 간다. 동시에 만들면 드라이브가
      // 같은 이름 폴더를 여러 개 만든다(드라이브는 같은 이름 형제를 허용한다).
      let queue = ok;
      let cardFolderId = task.driveFolderId;
      if (!cardFolderId && ok.length > 1) {
        try {
          const first = await uploadOne(ok[0], undefined);
          cardFolderId = first?._driveFolderId || undefined;   // 없으면 이름으로 찾는다(스크립트 폴백)
        } catch (e) {
          console.error('[cloud] 업로드 실패:', e);
          showToast(failText(`'${ok[0].name}'을(를) 올리지 못했어요`, e));
          setUploadingList(prev => prev.filter(n => n !== ok[0].name));
        }
        queue = ok.slice(1);
      }
      const LIMIT = 3;
      let next = 0;
      const worker = async () => {
        while (next < queue.length) {
          const file = queue[next++];
          try { await uploadOne(file, cardFolderId); }
          catch (e) {
            console.error('[cloud] 업로드 실패:', e);
            showToast(failText(`'${file.name}'을(를) 올리지 못했어요`, e));
            setUploadingList(prev => prev.filter(n => n !== file.name));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(LIMIT, queue.length) }, worker));
    } finally {
      uploadingRef.current = false;
      setUploadingList([]);
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
  // 이번 세션에 비밀번호를 맞췄거나, 애초에 안 걸려 있으면 열린다.
  // 창을 닫으면 잊는다 — 한 번 푼 것을 계속 들고 있으면 '잠금'이라는 말이 무색해진다.
  const isLocked = (row) => !!row.view_pw && !unlocked[row.id];
  const openFile = (row) => {
    if (isLocked(row)) { setAskPw(prev => ({ ...prev, [row.id]: true })); return; }
    setPreview(row);
  };
  // **줄을 먼저 지우고 나중에 서버에 알린다.** 드라이브 휴지통 이동은 왕복이라
  // 응답을 기다리면 몇 초 동안 아무 일도 안 일어난 것처럼 보인다(사용자 지적 —
  // "삭제되는 동안 기다리는 것 같다"). 스피너를 붙이는 대신 기다림을 없앴다.
  // 실패하면 되돌린다 — 지워진 척하고 사라지면 파일을 잃은 것으로 읽힌다.
  // **스토어(task.attachments)도 같이 고친다.** 여기만 지우면 창을 닫았다 열 때
  // 되살아난다(사용자 지적 — "지웠는데 반영이 안 된다").
  const removeItem = async (row) => {
    const before = items;
    const next = items.filter(x => x.id !== row.id);
    const put = (list) => {
      setItems(list);
      store.dispatch({ type: 'SYNC_TASK', payload: { id: task.id, attachments: list } });
    };
    deletedFileIds.add(row.id);
    put(next);
    try {
      await deleteAttachment(row);
      onFileActivity?.(`파일 '${row.name}'을(를) 삭제했습니다.`);
    } catch (e) {
      deletedFileIds.delete(row.id);
      put(before);
      console.error('[cloud] 삭제 실패:', e);
      showToast(failText(`'${row.name}'을(를) 지우지 못했어요`, e));
    }
  };

  // 목록이 오기 전이고 붙어 있는 파일이 있다면, 그 수만큼 스켈레톤 줄로 자리를 잡는다.
  // 개수를 자르지 않는다 — 다섯 줄만 잡아 두면 여덟 장짜리 업무에서 자리를 잡으나
  // 마나였다(사용자 지적). 20줄에서만 끊는다(그 이상은 화면을 넘겨서 의미가 없다).
  const pendingRows = listing ? Math.min(task.fileCount || 0, 20) : 0;

  // 읽기 전용(뷰어)에서 첨부가 없으면 섹션 자체를 숨김 — 올라가는 중이거나
  // 아직 목록을 받는 중이면 자리를 남긴다
  if (readOnly && items.length === 0 && !uploadingNames.length && !pendingRows) return null;

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
      {!readOnly && uploadingList.map(name => (
        <div key={name} className="flex items-center gap-2 mt-2 text-[11px] text-fg-muted"><Loader2 size={13} className="animate-spin" /> 업로드 중: {name}</div>
      ))}
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
      {pendingRows > 0 && items.length === 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {Array.from({ length: pendingRows }, (_, i) => (
            // 높이는 **이미지 줄(80px)** 에 맞춘다 — 목록이 오기 전에는 무엇이 이미지인지
            // 알 수 없는데, 낮은 쪽(아이콘 36px)에 맞추면 실제 줄이 들어올 때 두 배 넘게
            // 밀린다. 자리를 잡는 것이 목적이니 넉넉한 쪽이 맞다.
            <div key={i} className="flex items-center gap-2.5 py-2">
              <Skeleton className="w-20 h-20 rounded-md shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3 w-2/5 rounded" />
                <Skeleton className="h-2 w-12 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="divide-y divide-line/60 mt-1">
          {items.map(row => (
            <div key={row.id}>
              <AttachmentRow row={row} thumb={thumbs[row.storage_path]} thumbFailed={!!thumbFailed[row.storage_path]} canDelete={!readOnly && (isAdmin || row.uploaded_by === userId)} onOpen={() => openFile(row)} onRemove={() => removeItem(row)}
                embedded={!!embedded[row.id]}
                locked={isLocked(row)}
                canLock={!readOnly && isSheetRow(row) && (isAdmin || row.uploaded_by === userId)}
                onToggleLockUI={() => setLockUI(prev => ({ ...prev, [row.id]: !prev[row.id] }))}
                onToggleEmbed={isSheetRow(row)
                  // 잠긴 파일은 '펼쳐보기'가 곧장 비밀번호를 묻는다 — 펼침 상태로
                  // 먼저 바꾸면 버튼이 '접기'로 바뀌어 열린 것처럼 읽힌다
                  ? () => (isLocked(row)
                      ? setAskPw(prev => ({ ...prev, [row.id]: !prev[row.id] }))
                      : setEmbedded(prev => ({ ...prev, [row.id]: !prev[row.id] })))
                  : null} />
              {lockUI[row.id] && (
                <PasswordSetter row={row} onDone={(saved) => {
                  setItems(prev => prev.map(x => (x.id === saved.id ? saved : x)));
                  setLockUI(prev => ({ ...prev, [row.id]: false }));
                  setUnlocked(prev => ({ ...prev, [row.id]: true }));   // 내가 건 잠금은 나에게 열려 있다
                }} />
              )}
              {/* 잠겨 있으면 펼치기 전에 비밀번호부터 묻는다. 맞추면 그 자리에서 펼쳐진다. */}
              {isLocked(row) && askPw[row.id] && (
                <PasswordGate row={row} onUnlock={() => {
                  setUnlocked(prev => ({ ...prev, [row.id]: true }));
                  setAskPw(prev => ({ ...prev, [row.id]: false }));
                  if (isSheetRow(row)) setEmbedded(prev => ({ ...prev, [row.id]: true }));
                }} />
              )}
              {embedded[row.id] && isSheetRow(row) && !isLocked(row) && <InlineSheet row={row} />}
            </div>
          ))}
        </div>
      )}
      {preview && (
        <FilePreviewModal
          row={preview}
          /* 사진 이전/다음용 — 잠긴 파일은 넘기지 않는다(비밀번호를 안 풀고 넘겨보게 된다) */
          rows={items.filter(r => !isLocked(r))}
          // 목록에서 이미 받아둔 이미지가 있으면 그대로 넘겨 스켈레톤 없이 바로 띄운다
          /* 썸네일은 200px cover(잘린 정사각)라 미리보기 첫 화면으로 쓰면
             사진이 잘려 보인다. 모달이 원본 주소를 스스로 받고 그동안 자기
             스켈레톤을 띄운다. */
          initialSrc={null}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
};
