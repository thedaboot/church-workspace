import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileQuestion, Loader2, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { RichText } from './RichText.jsx';
import { getFileOpenUrl, driveImageFullUrl, fetchDriveFileBlob } from '../services/cloud.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { Skeleton, SmartImage } from './media.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { PdfView } from './PdfView.jsx';
// 엑셀 표 그리기는 **엑셀을 열 때만** 필요하다 — 파서(xlsx.js)와 수식 계산기(formula.js)가
// 같이 딸려 오는데, 메인 번들에 두면 엑셀을 한 번도 안 여는 사람까지 내려받는다.
// 워드·PPT도 같다 — 파서(docx.js·pptx.js)가 딸려 오므로 열 때만 받는다.
const DocLazy = lazy(() => import('./OfficeView.jsx').then(m => ({ default: m.DocView })));
const SlideLazy = lazy(() => import('./OfficeView.jsx').then(m => ({ default: m.SlideView })));
const DocView = (props) => <Suspense fallback={<PreparingFrame />}><DocLazy {...props} /></Suspense>;
const SlideView = (props) => <Suspense fallback={<PreparingFrame />}><SlideLazy {...props} /></Suspense>;

// ============================================================================
// 첨부 미리보기 — 새 탭으로 스토리지 링크를 던지지 않고 앱 안에서 본다.
// ----------------------------------------------------------------------------
// 형식별 처리
//   이미지·PDF·영상·소리·텍스트(md 포함): 브라우저가 직접 그린다(외부 전송 없음)
//   HTML(.html·.htm): sandbox iframe에 srcdoc으로 넣는다. 허용은 allow-scripts 하나뿐이고
//     allow-same-origin은 절대 함께 주지 않는다 — 출처가 불투명해야 우리 localStorage의
//     세션 토큰에 닿지 못한다. 문서 안의 외부 이미지·CSS·스크립트는 브라우저가 그대로
//     받아온다(그 주소로 요청이 나간다 — 링크를 여는 것과 같다).
//   워드·엑셀·파워포인트: 브라우저가 못 그리므로 Office Online 임베드 뷰어를 쓴다
//     → 서명 URL이 마이크로소프트 쪽으로 전달된다. 화면에 그 사실을 표시하고,
//       원치 않으면 OFFICE_VIEWER를 false로 두면 '열기'만 노출된다.
//   hwp·zip 등: 미리보기 수단이 없어 파일 정보 + 열기/내려받기만 제공
// ============================================================================
// 종류 판정(previewKind)과 확장자 목록은 services/previewKind.js에 있다 — 순수 함수라
// 노드에서 검사한다(tests/logcheck.mjs). 여기는 그리는 쪽만 남았다.
import { previewKind, extOf } from '../services/previewKind.js';
// 바이트를 받아 우리가 직접 그리는 형식들 — 셋이 같은 길을 쓴다.
const BYTE_KINDS = new Set(['sheet', 'doc', 'slide']);
const MAX_TEXT_CHARS = 512 * 1024;      // 텍스트는 앞의 이만큼만 그린다(뒤는 잘렸다고 알린다)
// 첨부 목록의 엑셀 '펼쳐보기'(attachments.jsx)도 같은 값·같은 스켈레톤을 쓴다 —
// 뷰어 iframe이 뜨는 동안 남의 로딩 화면(외부 폰트)이 비쳐 보이지 않게 가리는 값들이다.
const OFFICE_TIMEOUT = 12000;    // 이 시간 안에 안 뜨면 안내로 대체
// iframe onLoad는 "문서가 전달된 시점"이라 뷰어가 첫 페이지를 그리기 전이다.
// 그 사이 PDF 뷰어의 검은 배경이 그대로 보여서, 조금 더 기다렸다 스켈레톤을 걷는다.
const FRAME_SETTLE = 260;
// 첨부 목록의 엑셀 '펼쳐보기'(attachments.jsx)도 같은 뷰어 주소를 쓴다
const officeSrc = (url) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
// 드라이브 미리보기 주소는 순수 함수라 utils에 있다(노드에서 바로 검사한다 — §2-5).
// 부르는 쪽(attachments.jsx)이 이미 여기서 가져다 쓰고 있어 그대로 다시 내보낸다.
import { driveSrc, sheetPreviewUrl } from '../utils.js';
export { driveSrc };

// 어느 뷰어로 그리고 있는지 — 화면 아래 한 줄에 그대로 적는다.
// 예전에는 이 문구가 조건 없이 '마이크로소프트 오피스 미리보기로 표시해요'였다.
// 드라이브 파일은 구글로 그리고 있는데도 마이크로소프트라고 적혀 있어서, 무엇이
// 어디로 나가는지 화면이 거짓말을 하고 있었다(사용자 지적).
const viewerNote = (row) => (row.source === 'drive'
  ? '구글 드라이브 미리보기로 표시해요'
  : '마이크로소프트 오피스 미리보기로 표시해요 · 파일 주소가 마이크로소프트로 전달됩니다');

// 드라이브 이미지의 <img> 주소 — 아니면 null(스토리지는 서명 URL을 따로 받는다)
const imgSrcOf = (r) => (r?.source === 'local'
  ? (r._url || null)                                   // 목록이 이미 만들어 둔 blob 주소
  : r?.source === 'drive' && r.drive_file_id ? driveImageFullUrl(r.drive_file_id) : null);

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
  const [htmlReady, setHtmlReady] = useState(false); // HTML iframe이 load를 알렸나(그 전까지 준비 중 자리)
  const [sheetSrc, setSheetSrc] = useState(null); // { blob } 또는 { text }(csv)
  // 창을 화면 가득 넓히기. 모바일은 원래 전체화면이라 버튼을 두지 않는다(태블릿부터 보인다).
  const [wide, setWide] = useState(false);
  const timerRef = useRef(null);
  const settleRef = useRef(null);
  const go = useCallback((d) => {
    const next = canNav ? gallery[gi + d] : null;
    if (!next) return;   // 끝에서는 멈춘다 — 빙글빙글 돌면 몇 장인지 감을 잃는다
    setCur(next); setUrl(null); setText(null); setError(null); setHtmlReady(false);
    setFrameReady(false); setTimedOut(false); setPdfSrc(null); setSheetSrc(null);
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

  // 아직 올리는 중인 파일(source: 'local')은 **고른 파일 자체**로 그린다.
  // 드라이브 주소가 아직 없으므로 받으러 가지 않는다.
  const local = cur.source === 'local' ? (cur._file || null) : null;

  // 서명 URL 확보 (이미 있으면 건너뜀)
  useEffect(() => {
    if (url || local) return;
    let alive = true;
    getFileOpenUrl(cur)
      .then(u => { if (alive) setUrl(u); })
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.id]);

  // 텍스트/마크다운은 내려받아 그대로 보여준다
  useEffect(() => {
    // html도 같은 길로 받는다 — iframe에 srcdoc으로 넣을 글자가 필요한 것은 같다.
    if ((kind !== 'text' && kind !== 'html') || text !== null) return;
    // 커도 **그린다** — 앞부분만 자르고 잘렸다고 아래 한 줄로 알린다(엑셀의 500줄 상한과
    // 같은 판단이다). 예전에는 여기서 '파일이 커서 미리보기를 건너뛰었어요'로 끝냈는데,
    // 큰 로그일수록 앞 몇 줄이 궁금한 법이라 아무것도 안 보여주는 쪽이 더 나빴다.
    let alive = true;
    const put = (t) => { if (alive) setText(t.slice(0, MAX_TEXT_CHARS)); };
    if (local) {
      local.text().then(put).catch(e => { if (alive) setError(e.message || String(e)); });
      return () => { alive = false; };
    }
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(b => b.text())
        .then(put)
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    fetch(url)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(put)
      .catch(e => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url, cur.id]);

  // 엑셀·워드·PPT는 바이트를 받아 우리가 직접 읽는다(구글 뷰어를 안 거친다).
  // 드라이브 파일은 /api/drive-file 중계로만 받을 수 있다 — 브라우저에서
  // drive.google.com에 직접 가면 CORS가 막는다(§6-29-c).
  useEffect(() => {
    if (!BYTE_KINDS.has(kind) || sheetSrc) return;
    // 엑셀은 이제 구글이 그린다 — 바이트를 받을 이유가 아예 없다(25MB를 통째로
    // 내려받고 파싱한 결과를 안 쓰는 낭비였다). 워드·PPT만 바이트가 필요하다.
    if (kind === 'sheet') return;
    const asCsv = extOf(cur.name) === 'csv';
    let alive = true;
    const take = (b) => (asCsv ? b.text().then(t => ({ text: t })) : Promise.resolve({ blob: b }));
    if (local) {
      take(local).then(v => { if (alive) setSheetSrc(v); }).catch(e => { if (alive) setError(e.message || String(e)); });
      return () => { alive = false; };
    }
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(take)
        .then(v => { if (alive) setSheetSrc(v); })
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(take)
      .then(v => { if (alive) setSheetSrc(v); })
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
    if (local) { setPdfSrc({ blob: local }); return () => { alive = false; }; }
    // 드라이브 파일은 서버 중계로 바이트를 받는다(웹 주소는 HTML 페이지라 못 쓴다)
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(b => { if (alive) setPdfSrc({ blob: b }); })
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => { if (alive) setPdfSrc({ blob: b }); })
      .catch(() => { if (alive) setPdfSrc({ src: url }); }); // 실패하면 주소로
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url, cur.id]);

  // 드라이브 영상·소리 — 프록시로 통째로 받아 블롭 URL로 튼다(첨부 상한 10MB).
  // <video src>에 웹 주소(web_view_link)를 주면 HTML 페이지라 못 튼다.
  const [blobSrc, setBlobSrc] = useState(null);
  useEffect(() => {
    if (kind !== 'video' && kind !== 'audio') return;
    if (local) {
      const obj = URL.createObjectURL(local);
      setBlobSrc(obj);
      return () => { URL.revokeObjectURL(obj); setBlobSrc(null); };
    }
    if (cur.source !== 'drive' || !cur.drive_file_id) return;
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

  // 내려받기. **`download` 속성은 같은 출처에서만 듣는다.** 드라이브·Storage 주소는
  // 남의 출처라 브라우저가 그 속성을 통째로 무시하고 그냥 새 탭으로 연다
  // (사용자 신고 2026-08-28 — "다운로드 버튼이 새 탭으로 열기만 된다").
  // 그래서 바이트를 우리가 받아 blob 주소로 저장한다. 드라이브는 /api/drive-file이
  // 이미 중계하고 있고, 미리보기가 방금 받은 것은 브라우저 캐시에 있어 두 번 안 받는다.
  const [saving, setSaving] = useState(false);
  const canSave = !!(local || url || cur.drive_file_id);
  const saveFile = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const blob = local
        || (cur.source === 'drive' && cur.drive_file_id
          ? await fetchDriveFileBlob(cur.drive_file_id)
          : await fetch(url).then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))));
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = cur.name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 바로 회수하면 브라우저가 저장을 시작하기도 전에 주소가 죽는다
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch (e) {
      showToast(failText(`'${cur.name}'을(를) 내려받지 못했어요`, e));
    } finally {
      setSaving(false);
    }
  };

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
              skeletonClassName="w-72 h-72" loadingText="미리보기를 준비하고 있어요"
          />
        </div>
      );
    }
    if (kind === 'video') {
      const src = (cur.source === 'drive' || local) ? blobSrc : url;
      if (!src) return <Skeleton className="w-full h-full" />;
      return <video src={src} controls className="max-w-full max-h-full rounded-md bg-black" />;
    }
    if (kind === 'audio') {
      const src = (cur.source === 'drive' || local) ? blobSrc : url;
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
          {text.length >= MAX_TEXT_CHARS && (
            <p className="pt-2 text-center text-[10px] text-fg-faint">앞부분만 보여줘요 · 전체는 새 탭에서 열기</p>
          )}
        </div>
      );
    }
    if (kind === 'html') {
      // 받는 동안도, 받은 뒤 iframe이 문서를 그리는 동안도 '준비하고 있어요'다(사용자 요청
      // 2026-09-05). Tailwind CDN 문서는 스크립트가 CSS를 만들기 전까지 흰 종이라 load
      // 이벤트까지 덮어 둔다 — 그 전에 걷으면 빈 흰 칸이 잠깐 보인다.
      if (text === null) return <PreparingFrame />;
      // sandbox 허용 목록은 **allow-scripts 하나뿐이다.** 폼·팝업·상위 창 이동은 막히고
      // 출처가 불투명해서 우리 쿠키·localStorage·Supabase 세션에 닿지 못한다.
      // **allow-same-origin은 절대 함께 주지 않는다** — 둘을 같이 주면 문서가 자기 자신의
      // sandbox 속성을 지우고 다시 띄워 벗어날 수 있고, 우리 출처가 되어 세션 토큰을 읽는다.
      // 스크립트를 왜 여나: 처음에는 sandbox=""(권한 0)이었는데, 기준으로 받아 본 실물
      // 첨부('2026 대림절 예배 기획 킥오프 워크북.html', 29KB)가 <script src=
      // "cdn.tailwindcss.com">·chart.js로 짜인 문서였다. Tailwind CDN은 **자바스크립트가
      // CSS를 만들어** 주므로 스크립트를 막으면 스타일이 하나도 없는 글 덩이가 된다
      // (2026-09-05 실물 확인). referrerPolicy는 문서 안의 외부 이미지·CSS·스크립트
      // 요청에 우리 주소(?p=&t=)가 실려 나가지 않게 한다.
      // srcdoc 문서의 바탕은 투명이라 흰 바탕을 깔아 준다 — 시트 iframe과 같은 판단이다
      // (문서는 흰 종이에 맞춰 쓰였고 다크 모드를 따라가지 않는다).
      return (
        <div className="w-full h-full flex flex-col">
          <div className="relative flex-1 min-h-0">
            <iframe
              sandbox="allow-scripts" srcDoc={text} referrerPolicy="no-referrer" title={cur.name}
              onLoad={() => setHtmlReady(true)}
              className="w-full h-full rounded-md border border-line bg-white"
            />
            {!htmlReady && <PreparingFrame absolute />}
          </div>
          {text.length >= MAX_TEXT_CHARS && (
            <p className="pt-2 text-center text-[10px] text-fg-faint">앞부분만 보여줘요 · 전체는 새 탭에서 열기</p>
          )}
        </div>
      );
    }
    // 워드·PPT는 우리가 그린다. 옛 형식(.doc·.ppt)만 구글 편집기로 남는다.
    if (kind === 'doc' || kind === 'slide') {
      if (!sheetSrc?.blob) return <PreparingFrame />;
      const View = kind === 'doc' ? DocView : SlideView;
      return <View blob={sheetSrc.blob} onError={(e) => setError(`${kind === 'doc' ? '문서' : '슬라이드'}를 읽지 못했어요 · ${e.message || e}`)} />;
    }
    if (kind === 'sheet') {
      // 변환 사본이 있으면 **구글이 그린 화면**을 그대로 띄운다(사용자 결정 2026-08-29).
      // 예전에 이 길을 접었던 이유는 갓 올린 파일에서 오류가 났기 때문인데, 이제는
      // 올릴 때 스크립트가 네이티브 시트로 변환해 두므로 기다릴 것이 없다(0031).
      // 흰 바탕이 그대로 온다 — 작성자가 칠한 색을 원본대로 보여주는 것이 이 화면의
      // 목적이라 다크 모드를 따라가지 않는다.
      const gsheet = sheetPreviewUrl(cur);
      if (gsheet) {
        return (
          <iframe
            src={gsheet} title={`${cur.name} 미리보기`}
            className="w-full h-full rounded-md border border-line bg-white"
          />
        );
      }
      // 사본이 없는 파일 — 변환에 실패했거나 아직 안 만들어졌다. 예전에는 여기서
      // 우리가 표를 그렸는데(SheetView) 2026-08-30에 지웠다.
      return (
        <div className="w-full h-full flex items-center justify-center">
          <p className="text-xs text-fg-faint text-center leading-relaxed">
            이 파일은 표로 볼 수 없어요<br />새 탭에서 열어주세요
          </p>
        </div>
      );
    }
    // PDF는 pdf.js로 직접 그린다 — iOS 사파리는 iframe 안의 PDF를 첫 쪽만 보여준다.
    if (kind === 'pdf') {
      if (!pdfSrc) return <PreparingFrame />;
      return (
        <PdfView
          blob={pdfSrc.blob} src={pdfSrc.src}
          onError={(e) => setError(`미리보기를 그릴 수 없어요\n${e.message || e}`)}
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
    <div className={`fixed inset-0 z-[100] bg-black/70 flex items-center justify-center animate-in fade-in duration-150 ${wide ? 'p-0' : 'p-0 md:p-6'}`} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        // 높이를 확정해 둔다 — max-h만 주면 안쪽 h-full(미리보기 영역)이 기준을 못 잡아
        // 파일 종류마다 크기가 들쭉날쭉해지고 모바일에서 잘려 보였다.
        // 넓히기는 크기가 바뀌는 일이라 §4.2의 "transform/opacity만"에서 한 칸 비켜난다.
        // 겹치는 요소가 이 창 하나뿐이고, 넓힐 길이 크기 말고는 없다(scale로 늘리면 글자까지
        // 커진다). 이징은 앱에 하나뿐인 --ease-out-quint를 쓴다.
        className={`bg-canvas border border-line shadow-elevated flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-[max-width,height,border-radius] ${isMobile
          ? 'w-full h-full'
          : wide ? 'w-full max-w-[100vw] h-[100dvh]' : 'w-full max-w-5xl h-[88dvh] rounded-lg'}`}
        style={{ transitionDuration: '220ms', transitionTimingFunction: 'var(--ease-out-quint)' }}
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
            {/* 새 탭 버튼이 왜 없는지 말해 준다 — 상태를 그대로 말하는 줄이다 */}
            {local && (
              <p className="text-[10px] text-fg-faint mt-0.5 flex items-center gap-1">
                <Loader2 size={10} className="animate-spin shrink-0" /> 드라이브에 올리는 중
              </p>
            )}
          </div>
          {!isMobile && (
            <button type="button" onClick={() => setWide(w => !w)}
              className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95"
              title={wide ? '창 크기로' : '화면 가득'}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {/* '새 탭에서 열기'는 **드라이브에 올라간 뒤에만** 둔다 — 아직 주소가 없는데
              버튼을 내놓으면 화면이 거짓말을 한다(사용자 결정). 내려받기는 고른 파일
              그대로 되므로 올리는 중에도 둔다. */}
          {!local && (
            <button type="button" onClick={openExternal} disabled={!url} className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 disabled:opacity-40" title="새 탭에서 열기"><ExternalLink size={16} /></button>
          )}
          <button
            type="button" onClick={saveFile} disabled={!canSave || saving}
            className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 disabled:opacity-40"
            title="내려받기"
          >{saving ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}</button>
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
function PreparingFrame({ absolute = false }) {
  return (
    <div className={absolute ? 'absolute inset-0' : 'relative w-full h-full'}>
      {/* Skeleton에 absolute를 주면 먹지 않는다(.dc-skeleton이 position: relative를
          박는다 — index.css). 자리는 바깥 span이 잡는다. */}
      <span className="absolute inset-0"><Skeleton className="w-full h-full" /></span>
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
