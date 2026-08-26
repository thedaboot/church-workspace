import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileQuestion, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { RichText } from './RichText.jsx';
import { getFileOpenUrl, driveImageFullUrl, fetchDriveFileBlob } from '../services/cloud.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { Skeleton, SmartImage } from './media.jsx';
import { PdfView } from './PdfView.jsx';

// ============================================================================
// 첨부 미리보기 — 새 탭으로 스토리지 링크를 던지지 않고 앱 안에서 본다.
// ----------------------------------------------------------------------------
// 형식별 처리
//   이미지·PDF·영상·소리·텍스트(md 포함): 브라우저가 직접 그린다(외부 전송 없음)
//   워드·엑셀·파워포인트: 브라우저가 못 그리므로 Office Online 임베드 뷰어를 쓴다
//     → 서명 URL이 마이크로소프트 쪽으로 전달된다. 화면에 그 사실을 표시하고,
//       원치 않으면 OFFICE_VIEWER를 false로 두면 '열기'만 노출된다.
//   hwp·zip 등: 미리보기 수단이 없어 파일 정보 + 열기/내려받기만 제공
// ============================================================================
const OFFICE_VIEWER = true; // false = 오피스 파일도 미리보기 없이 '열기'만

const extOf = (name = '') => (name.split('.').pop() || '').toLowerCase();
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'sh'];
const OFFICE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const MAX_TEXT_BYTES = 512 * 1024;      // 텍스트는 이만큼만 내려받아 보여준다
const MAX_PDF_PREFETCH = 15 * 1024 * 1024; // 이보다 크면 통째로 받지 않고 바로 스트리밍
// 첨부 목록의 엑셀 '펼쳐보기'(attachments.jsx)도 같은 값·같은 스켈레톤을 쓴다 —
// 뷰어 iframe이 뜨는 동안 남의 로딩 화면(외부 폰트)이 비쳐 보이지 않게 가리는 값들이다.
export const OFFICE_TIMEOUT = 12000;    // 이 시간 안에 안 뜨면 안내로 대체
// iframe onLoad는 "문서가 전달된 시점"이라 뷰어가 첫 페이지를 그리기 전이다.
// 그 사이 PDF 뷰어의 검은 배경이 그대로 보여서, 조금 더 기다렸다 스켈레톤을 걷는다.
export const FRAME_SETTLE = 260;

function previewKind(row) {
  const mime = row.mime_type || '';
  const ext = extOf(row.name);
  // 이미지는 드라이브 파일이어도 <img>로 직접 그린다 — 구글 이미지 CDN(lh3) 주소가
  // 고정이라 브라우저가 캐싱하고(서명 URL과 달리 두 번째부터는 요청이 안 나간다),
  // iframe 뷰어와 달리 사진 넘기기(이전/다음)가 된다.
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  if (row.source === 'drive') {
    // 드라이브 파일도 형식별로 **가장 나은 뷰어**로 간다(사용자 요청) —
    //  · 오피스류(엑셀·워드·PPT·csv): 구글 전용 편집기 미리보기(driveSrc가 시간 게이트)
    //  · PDF·텍스트·영상·소리: 앱이 직접 그린다. 바이트는 /api/drive-file이 중계한다
    //    (브라우저→drive.google.com 은 CORS가 막는다). 첨부 상한이 25MB라 통째로
    //    받아도 된다. PDF만 프리페치 상한(15MB)을 넘으면 드라이브 뷰어로 남긴다.
    if (OFFICE_EXT.includes(ext) || ext === 'csv') return 'drive';
    if ((mime === 'application/pdf' || ext === 'pdf') && (row.size_bytes ?? 0) <= MAX_PDF_PREFETCH) return 'pdf';
    if ((mime.startsWith('text/') || TEXT_EXT.includes(ext)) && (row.size_bytes ?? 0) <= MAX_TEXT_BYTES) return 'text';
    if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
    if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg'].includes(ext)) return 'audio';
    return 'drive';
  }
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text';
  if (OFFICE_EXT.includes(ext)) return OFFICE_VIEWER ? 'office' : 'none';
  return 'none';
}

// 첨부 목록의 엑셀 '펼쳐보기'(attachments.jsx)도 같은 뷰어 주소를 쓴다
export const officeSrc = (url) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
// 드라이브 미리보기 주소는 순수 함수라 utils에 있다(노드에서 바로 검사한다 — §2-5).
// 부르는 쪽(attachments.jsx)이 이미 여기서 가져다 쓰고 있어 그대로 다시 내보낸다.
import { driveSrc } from '../utils.js';
export { driveSrc };

// 어느 뷰어로 그리고 있는지 — 화면 아래 한 줄에 그대로 적는다.
// 예전에는 이 문구가 조건 없이 '마이크로소프트 오피스 미리보기로 표시해요'였다.
// 드라이브 파일은 구글로 그리고 있는데도 마이크로소프트라고 적혀 있어서, 무엇이
// 어디로 나가는지 화면이 거짓말을 하고 있었다(사용자 지적).
export const viewerNote = (row) => (row.source === 'drive'
  ? '구글 드라이브 미리보기로 표시해요'
  : '마이크로소프트 오피스 미리보기로 표시해요 · 파일 주소가 마이크로소프트로 전달됩니다');

// 드라이브 이미지의 <img> 주소 — 아니면 null(스토리지는 서명 URL을 따로 받는다)
const imgSrcOf = (r) => (r?.source === 'drive' && r.drive_file_id ? driveImageFullUrl(r.drive_file_id) : null);

// row: 처음 연 files 행
// rows: 같은 목록의 나머지 행 — 사진 이전/다음 넘기기용. 잠긴(비밀번호) 파일은
//       호출부가 걸러서 넘긴다(여기서 또 검사하면 비밀번호 로직이 두 벌이 된다).
// initialSrc: 호출부가 이미 가진 URL. 이미지는 목록 썸네일이 같은 서명 URL이라
//             그대로 넘기면 스켈레톤 없이 곧바로 뜬다(서명 재발급도 건너뜀).
export function FilePreviewModal({ row, rows = null, initialSrc = null, onClose }) {
  const isMobile = useIsMobile();
  // 사진 넘기기 — 지금 보는 파일이 이미지일 때, 같은 목록의 **이미지끼리만**.
  // 문서·영상은 안 넘긴다: iframe 뷰어는 장마다 새로 뜨는 데 몇 초씩 걸려서
  // "넘긴다"는 느낌이 안 난다. 사진(첨부의 대부분)만 즉시 넘어간다.
  const [cur, setCur] = useState(row);
  const kind = useMemo(() => previewKind(cur), [cur]);
  const gallery = useMemo(() => (rows || []).filter(r => previewKind(r) === 'image'), [rows]);
  const gi = gallery.findIndex(r => r.id === cur.id);
  const canNav = kind === 'image' && gi >= 0 && gallery.length > 1;
  const [url, setUrl] = useState(initialSrc);
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [frameReady, setFrameReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [pdfSrc, setPdfSrc] = useState(null); // { blob } 또는 { src } — 준비가 끝난 뒤에만 렌더
  const timerRef = useRef(null);
  const settleRef = useRef(null);
  const go = useCallback((d) => {
    const next = canNav ? gallery[gi + d] : null;
    if (!next) return;   // 끝에서는 멈춘다 — 빙글빙글 돌면 몇 장인지 감을 잃는다
    setCur(next); setUrl(null); setText(null); setError(null);
    setFrameReady(false); setTimedOut(false); setPdfSrc(null);
  }, [canNav, gallery, gi]);
  // 이웃 사진을 미리 받아 둔다 — lh3 주소는 고정이라 이게 곧 캐시를 채우는 일이고,
  // 다음/이전을 눌렀을 때 스켈레톤 없이 바로 뜬다.
  useEffect(() => {
    if (!canNav) return;
    [gallery[gi + 1], gallery[gi - 1]].forEach(r => {
      const src = imgSrcOf(r);
      if (src) { const im = new Image(); im.src = src; }
    });
  }, [canNav, gallery, gi]);

  // 서명 URL 확보 (이미 있으면 건너뜀)
  useEffect(() => {
    if (url) return;
    let alive = true;
    getFileOpenUrl(cur)
      .then(u => { if (alive) setUrl(u); })
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.id]);

  // 텍스트/마크다운은 내려받아 그대로 보여준다
  useEffect(() => {
    if (kind !== 'text' || text !== null) return;
    if ((cur.size_bytes ?? 0) > MAX_TEXT_BYTES) { setError('파일이 커서 미리보기를 건너뛰었어요.'); return; }
    let alive = true;
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(b => b.text())
        .then(t => { if (alive) setText(t); })
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    fetch(url)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(t => { if (alive) setText(t); })
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url, cur.id]);

  // PDF는 파일을 먼저 통째로 받아두고 그 바이트로 그린다.
  // 주소만 넘기면 그리기 시작한 뒤에야 내려받기가 진행돼 빈 화면이 오래 보인다.
  // 큰 파일은 통째로 기다리는 게 더 나빠서 주소로 바로 스트리밍한다.
  useEffect(() => {
    if (kind !== 'pdf' || pdfSrc) return;
    let alive = true;
    // 드라이브 파일은 서버 중계로 바이트를 받는다(웹 주소는 HTML 페이지라 못 쓴다)
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(b => { if (alive) setPdfSrc({ blob: b }); })
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    if ((cur.size_bytes ?? 0) > MAX_PDF_PREFETCH) { setPdfSrc({ src: url }); return; }
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => { if (alive) setPdfSrc({ blob: b }); })
      .catch(() => { if (alive) setPdfSrc({ src: url }); }); // 실패하면 주소로
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url, cur.id]);

  // 드라이브 영상·소리 — 프록시로 통째로 받아 블롭 URL로 튼다(첨부 상한 25MB).
  // <video src>에 웹 주소(web_view_link)를 주면 HTML 페이지라 못 튼다.
  const [blobSrc, setBlobSrc] = useState(null);
  useEffect(() => {
    if ((kind !== 'video' && kind !== 'audio') || cur.source !== 'drive' || !cur.drive_file_id) return;
    let alive = true; let obj = null;
    fetchDriveFileBlob(cur.drive_file_id)
      .then(b => { if (!alive) return; obj = URL.createObjectURL(b); setBlobSrc(obj); })
      .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); setBlobSrc(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, cur.id]);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  // 오피스 뷰어가 응답 없이 멈추는 경우가 있어 시간 제한을 둔다
  useEffect(() => {
    if (kind !== 'office' || !url || frameReady) return;
    timerRef.current = setTimeout(() => setTimedOut(true), OFFICE_TIMEOUT);
    return () => clearTimeout(timerRef.current);
  }, [kind, url, frameReady]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, go]);

  const openExternal = () => { if (url) window.open(url, '_blank', 'noopener'); };

  const body = (() => {
    if (error) return <Fallback row={cur} message={error} onOpen={openExternal} />;

    if (kind === 'image') {
      // 가운데 정렬은 바깥 div가 한다 — SmartImage의 래퍼(inline-block)에 폭을 주면
      // 래퍼만 가운데로 가고 그 안의 이미지는 왼쪽에 붙는다.
      return (
        <div className="w-full h-full flex items-center justify-center">
          <SmartImage
            key={cur.id}
            src={imgSrcOf(cur) || url} alt={cur.name}
            wrapperClassName="w-full h-full flex items-center justify-center"
            className="max-w-full max-h-full object-contain rounded-md"
            skeletonClassName="w-72 h-72"
          />
        </div>
      );
    }
    if (kind === 'video') {
      const src = cur.source === 'drive' ? blobSrc : url;
      if (!src) return <Skeleton className="w-full h-full" />;
      return <video src={src} controls className="max-w-full max-h-full rounded-md bg-black" />;
    }
    if (kind === 'audio') {
      const src = cur.source === 'drive' ? blobSrc : url;
      if (!src) return <Skeleton className="w-full h-16" />;
      return <audio src={src} controls className="w-full" />;
    }
    if (kind === 'text') {
      if (text === null) return <Skeleton className="w-full h-full" />;
      const isMd = ['md', 'markdown'].includes(extOf(cur.name));
      return (
        <div className="w-full h-full max-w-3xl mx-auto bg-surface border border-line rounded-md p-4 overflow-auto text-sm">
          {isMd
            ? <RichText content={text} />
            : <pre className="text-xs text-fg-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">{text}</pre>}
        </div>
      );
    }
    // PDF는 pdf.js로 직접 그린다 — iOS 사파리는 iframe 안의 PDF를 첫 쪽만 보여준다.
    if (kind === 'pdf') {
      if (!pdfSrc) return <PreparingFrame />;
      return (
        <PdfView
          blob={pdfSrc.blob} src={pdfSrc.src}
          onError={(e) => setError(`미리보기를 그릴 수 없어요 · ${e.message || e}`)}
        />
      );
    }
    if (kind === 'office' || kind === 'drive') {
      const src = kind === 'drive' ? driveSrc(cur) : (url && officeSrc(url));
      // 파일을 받는 동안(src 없음)에도 같은 안내를 보여준다
      if (!src) return <PreparingFrame />;
      if (timedOut && !frameReady) return <Fallback row={cur} message="미리보기가 응답하지 않아요." onOpen={openExternal} />;
      return (
        <div className="relative w-full h-full">
          {!frameReady && <PreparingFrame absolute />}
          <iframe
            src={src} title={cur.name}
            // onLoad 직후엔 아직 첫 페이지가 안 그려져 있다(뷰어 배경만 보임) → 조금 뒤에 걷는다
            onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setFrameReady(true), FRAME_SETTLE); }}
            className={`w-full h-full rounded-md border border-line bg-surface ${frameReady ? '' : 'opacity-0'}`}
          />
        </div>
      );
    }
    return <Fallback row={cur} message="이 형식은 앱에서 미리보기를 지원하지 않아요." onOpen={openExternal} />;
  })();

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-0 md:p-6 animate-in fade-in duration-150" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        // 높이를 확정해 둔다 — max-h만 주면 안쪽 h-full(미리보기 영역)이 기준을 못 잡아
        // 파일 종류마다 크기가 들쭉날쭉해지고 모바일에서 잘려 보였다.
        className={`bg-canvas border border-line shadow-elevated flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${isMobile ? 'w-full h-full' : 'w-full max-w-5xl h-[88dvh] rounded-lg'}`}
      >
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-line bg-surface">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-fg truncate">{cur.name}</p>
            {/* 안내 줄은 office(마이크로소프트로 주소가 나가는 경우)에만 — 정보가
                밖으로 나가니 알려야 한다. 그 외에는 붙이지 않는다(사용자 결정
                2026-08-27 — 새 안내 줄은 먼저 물어보고 붙일 것). */}
            {kind === 'office' && (
              <p className="text-[10px] text-fg-faint mt-0.5">{viewerNote(cur)}</p>
            )}
          </div>
          <button type="button" onClick={openExternal} disabled={!url} className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 disabled:opacity-40" title="새 탭에서 열기"><ExternalLink size={16} /></button>
          <a
            href={url || undefined} download={cur.name} target="_blank" rel="noreferrer"
            className={`p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 ${url ? '' : 'pointer-events-none opacity-40'}`}
            title="내려받기"
          ><Download size={16} /></a>
          <button type="button" onClick={onClose} className="p-2 rounded-md text-fg-faint hover:bg-surface-hover transition active:scale-95" title="닫기"><X size={18} /></button>
        </div>
        {/* 미리보기 영역은 남은 공간을 그대로 채운다(고정 dvh를 쓰면 창 크기에 안 맞는다) */}
        <div className="relative flex-1 min-h-0 p-2 md:p-4 flex items-center justify-center overflow-hidden">
          {body}
          {/* 사진 이전/다음 — 아래 가운데 필 하나로(앱의 surface·line 토큰).
              사진 양옆의 검은 원은 우리 어디에도 없는 색이었고 가장자리를 가렸다
              (사용자 지적). hover 뒤에 숨기지 않는다(§8). 끝에서는 흐려진다. */}
          {canNav && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-surface border border-line shadow-elevated">
              <button type="button" onClick={() => go(-1)} disabled={gi === 0} title="이전 사진 (←)"
                className="p-1.5 rounded-full text-fg-muted hover:text-fg hover:bg-surface-hover transition active:scale-95 disabled:opacity-25 disabled:pointer-events-none">
                <ChevronLeft size={16} />
              </button>
              <span className="px-1 text-[11px] font-semibold text-fg-muted tabular-nums whitespace-nowrap">{gi + 1} / {gallery.length}</span>
              <button type="button" onClick={() => go(1)} disabled={gi === gallery.length - 1} title="다음 사진 (→)"
                className="p-1.5 rounded-full text-fg-muted hover:text-fg hover:bg-surface-hover transition active:scale-95 disabled:opacity-25 disabled:pointer-events-none">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 준비 중 자리(스켈레톤 + 안내). absolute=이미 자리를 잡은 컨테이너 위에 덮어씌울 때
export function PreparingFrame({ absolute = false }) {
  return (
    <div className={absolute ? 'absolute inset-0' : 'relative w-full h-full'}>
      <Skeleton className="absolute inset-0 w-full h-full" />
      <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted">
        <Loader2 size={14} className="animate-spin" /> 미리보기를 준비하고 있어요
      </span>
    </div>
  );
}

function Fallback({ row, message, onOpen }) {
  return (
    <div className="text-center px-6 py-10">
      <span className="inline-flex w-12 h-12 rounded-lg bg-tag-gray text-tag-gray-fg items-center justify-center mb-3"><FileQuestion size={22} strokeWidth={1.75} /></span>
      <p className="text-sm text-fg font-medium truncate max-w-xs mx-auto">{row.name}</p>
      <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">{message}</p>
      <button type="button" onClick={onOpen} className="mt-4 inline-flex items-center gap-1.5 bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-md text-xs font-medium transition active:scale-95">
        <ExternalLink size={13} /> 새 탭에서 열기
      </button>
    </div>
  );
}
