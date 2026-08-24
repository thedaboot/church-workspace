import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileQuestion, Loader2 } from 'lucide-react';
import { RichText } from './RichText.jsx';
import { getFileOpenUrl } from '../services/cloud.js';
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

export function previewKind(row) {
  const mime = row.mime_type || '';
  const ext = extOf(row.name);
  if (row.source === 'drive') return 'drive';
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text';
  if (OFFICE_EXT.includes(ext)) return OFFICE_VIEWER ? 'office' : 'none';
  return 'none';
}

// 첨부 목록의 엑셀 '펼쳐보기'(attachments.jsx)도 같은 뷰어 주소를 쓴다
export const officeSrc = (url) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
const driveSrc = (row) => (row.drive_file_id ? `https://drive.google.com/file/d/${row.drive_file_id}/preview` : null);

// row: files 테이블 행
// initialSrc: 호출부가 이미 가진 URL. 이미지는 목록 썸네일이 같은 서명 URL이라
//             그대로 넘기면 스켈레톤 없이 곧바로 뜬다(서명 재발급도 건너뜀).
export function FilePreviewModal({ row, initialSrc = null, onClose }) {
  const isMobile = useIsMobile();
  const kind = useMemo(() => previewKind(row), [row]);
  const [url, setUrl] = useState(initialSrc);
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [frameReady, setFrameReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [pdfSrc, setPdfSrc] = useState(null); // { blob } 또는 { src } — 준비가 끝난 뒤에만 렌더
  const timerRef = useRef(null);
  const settleRef = useRef(null);

  // 서명 URL 확보 (이미 있으면 건너뜀)
  useEffect(() => {
    if (url) return;
    let alive = true;
    getFileOpenUrl(row)
      .then(u => { if (alive) setUrl(u); })
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  // 텍스트/마크다운은 내려받아 그대로 보여준다
  useEffect(() => {
    if (kind !== 'text' || !url || text !== null) return;
    if ((row.size_bytes ?? 0) > MAX_TEXT_BYTES) { setError('파일이 커서 미리보기를 건너뛰었어요.'); return; }
    let alive = true;
    fetch(url)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(t => { if (alive) setText(t); })
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url]);

  // PDF는 파일을 먼저 통째로 받아두고 그 바이트로 그린다.
  // 주소만 넘기면 그리기 시작한 뒤에야 내려받기가 진행돼 빈 화면이 오래 보인다.
  // 큰 파일은 통째로 기다리는 게 더 나빠서 주소로 바로 스트리밍한다.
  useEffect(() => {
    if (kind !== 'pdf' || !url || pdfSrc) return;
    if ((row.size_bytes ?? 0) > MAX_PDF_PREFETCH) { setPdfSrc({ src: url }); return; }
    let alive = true;
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => { if (alive) setPdfSrc({ blob: b }); })
      .catch(() => { if (alive) setPdfSrc({ src: url }); }); // 실패하면 주소로
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url]);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  // 오피스 뷰어가 응답 없이 멈추는 경우가 있어 시간 제한을 둔다
  useEffect(() => {
    if (kind !== 'office' || !url || frameReady) return;
    timerRef.current = setTimeout(() => setTimedOut(true), OFFICE_TIMEOUT);
    return () => clearTimeout(timerRef.current);
  }, [kind, url, frameReady]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openExternal = () => { if (url) window.open(url, '_blank', 'noopener'); };

  const body = (() => {
    if (error) return <Fallback row={row} message={error} onOpen={openExternal} />;

    if (kind === 'image') {
      // 가운데 정렬은 바깥 div가 한다 — SmartImage의 래퍼(inline-block)에 폭을 주면
      // 래퍼만 가운데로 가고 그 안의 이미지는 왼쪽에 붙는다.
      return (
        <div className="w-full h-full flex items-center justify-center">
          <SmartImage
            src={url} alt={row.name}
            wrapperClassName="w-full h-full flex items-center justify-center"
            className="max-w-full max-h-full object-contain rounded-md"
            skeletonClassName="w-72 h-72"
          />
        </div>
      );
    }
    if (kind === 'video') {
      if (!url) return <Skeleton className="w-full h-full" />;
      return <video src={url} controls className="max-w-full max-h-full rounded-md bg-black" />;
    }
    if (kind === 'audio') {
      if (!url) return <Skeleton className="w-full h-16" />;
      return <audio src={url} controls className="w-full" />;
    }
    if (kind === 'text') {
      if (text === null) return <Skeleton className="w-full h-full" />;
      const isMd = ['md', 'markdown'].includes(extOf(row.name));
      return (
        <div className="w-full h-full max-w-3xl mx-auto bg-surface border border-line rounded-md p-4 overflow-auto">
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
      const src = kind === 'drive' ? driveSrc(row) : (url && officeSrc(url));
      // 파일을 받는 동안(src 없음)에도 같은 안내를 보여준다
      if (!src) return <PreparingFrame />;
      if (timedOut && !frameReady) return <Fallback row={row} message="미리보기가 응답하지 않아요." onOpen={openExternal} />;
      return (
        <div className="relative w-full h-full">
          {!frameReady && <PreparingFrame absolute />}
          <iframe
            src={src} title={row.name}
            // onLoad 직후엔 아직 첫 페이지가 안 그려져 있다(뷰어 배경만 보임) → 조금 뒤에 걷는다
            onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setFrameReady(true), FRAME_SETTLE); }}
            className={`w-full h-full rounded-md border border-line bg-surface ${frameReady ? '' : 'opacity-0'}`}
          />
        </div>
      );
    }
    return <Fallback row={row} message="이 형식은 앱에서 미리보기를 지원하지 않아요." onOpen={openExternal} />;
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
            <p className="text-xs font-semibold text-fg truncate">{row.name}</p>
            {kind === 'office' && (
              <p className="text-[10px] text-fg-faint mt-0.5">마이크로소프트 오피스 미리보기로 표시해요</p>
            )}
          </div>
          <button type="button" onClick={openExternal} disabled={!url} className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 disabled:opacity-40" title="새 탭에서 열기"><ExternalLink size={16} /></button>
          <a
            href={url || undefined} download={row.name} target="_blank" rel="noreferrer"
            className={`p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 ${url ? '' : 'pointer-events-none opacity-40'}`}
            title="내려받기"
          ><Download size={16} /></a>
          <button type="button" onClick={onClose} className="p-2 rounded-md text-fg-faint hover:bg-surface-hover transition active:scale-95" title="닫기"><X size={18} /></button>
        </div>
        {/* 미리보기 영역은 남은 공간을 그대로 채운다(고정 dvh를 쓰면 창 크기에 안 맞는다) */}
        <div className="flex-1 min-h-0 p-2 md:p-4 flex items-center justify-center overflow-hidden">{body}</div>
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
