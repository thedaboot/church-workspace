import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileQuestion, Loader2, ChevronLeft, ChevronRight, Maximize2, Minimize2, SquarePen } from 'lucide-react';
import { RichText } from './RichText.jsx';
import { getFileOpenUrl, getFileDownloadUrl, driveImageFullUrl, fetchDriveFileBlob } from '../services/cloud.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useMyEmail } from '../services/auth.jsx';
import { Skeleton, SmartImage } from './media.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { PdfView } from './PdfView.jsx';
// 워드·PPT를 우리가 그리는 길(사본이 없는 옛 첨부·변환 실패)은 **열 때만** 필요하다 —
// 파서(docx.js·pptx.js)가 같이 딸려 오는데, 메인 번들에 두면 그 파일을 한 번도 안 여는
// 사람까지 내려받는다. 엑셀 파서(xlsx.js)는 이 화면이 더 쓰지 않는다 — 표는 구글이
// 그리고(§6-29-c), xlsx.js는 첨부 내용 검색(fileText.js)에만 남았다.
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
//   엑셀·워드·파워포인트(드라이브): 올릴 때 만들어 둔 **구글 변환 사본**을 iframe으로
//     띄운다(files.preview_file_id · kind 'sheet'·'gdoc'). 바이트를 받지 않으니 기다릴 것이
//     없고, 구글이 그린 그대로라 잘리거나 배치가 틀어지지 않는다.
//     사본이 없는 것만 우리 렌더러(OfficeView · kind 'doc'·'slide')로 떨어진다.
//   워드·엑셀·파워포인트(Storage에 남은 것): 브라우저가 못 그리므로 Office Online 임베드
//     뷰어를 쓴다 → 서명 URL이 마이크로소프트 쪽으로 전달된다. 화면에 그 사실을 표시하고,
//       원치 않으면 OFFICE_VIEWER를 false로 두면 '열기'만 노출된다.
//   hwp·zip 등: 미리보기 수단이 없어 파일 정보 + 열기/내려받기만 제공
// ============================================================================
// 종류 판정(previewKind)과 확장자 목록은 services/previewKind.js에 있다 — 순수 함수라
// 노드에서 검사한다(tests/logcheck.mjs). 여기는 그리는 쪽만 남았다.
import { previewKind, extOf, previewCopyUrl, copyEditUrl, previewCopyOf } from '../services/previewKind.js';
// 바이트를 받아 **우리가 직접 그리는** 형식들. 엑셀('sheet')은 여기 없다 — 표는 구글이
// 그리므로 25MB를 통째로 받아 파싱하고 그 결과를 안 쓰는 낭비였다(2026-08-29).
const BYTE_KINDS = new Set(['doc', 'slide']);
const MAX_TEXT_CHARS = 512 * 1024;      // 텍스트는 앞의 이만큼만 그린다(뒤는 잘렸다고 알린다)
const OFFICE_TIMEOUT = 12000;    // 이 시간 안에 안 뜨면 안내로 대체
// 구글 틀은 더 길게 잡는다 — 처음 열 때 실제로 오래 걸린다(DocEmbed의 SLOW_MS와 같은 값).
const GOOGLE_TIMEOUT = 30000;
// **틀(iframe)로 그리는 갈래 전부.** 여기 없는 갈래는 시간 제한이 없다.
const FRAME_KINDS = new Set(['office', 'drive', 'sheet', 'gdoc']);
// iframe onLoad는 "문서가 전달된 시점"이라 뷰어가 첫 페이지를 그리기 전이다.
// 그 사이 뷰어의 빈 배경이 그대로 보여서, 조금 더 기다렸다 스켈레톤을 걷는다.
// 이 창의 네 갈래('sheet'·'gdoc'·'drive'·'office')와 첨부 목록의 엑셀 '펼쳐보기'
// (attachments.jsx의 SHEET_SETTLE)가 같은 값을 쓴다 — 같은 구글 화면이 어디서 열리느냐에
// 따라 다른 속도로 걷히면 안 된다. 한쪽을 바꾸면 짝도 같이 고치세요.
// 모바일에서 구글 문서 미리보기 틀에 주는 폭(위 gdoc 갈래 주석)
const GDOC_MOBILE_W = 940;
const FRAME_SETTLE = 260;
// Storage에 남은 옛 오피스 파일만 이 뷰어로 간다(드라이브 파일은 구글이 그린다)
const officeSrc = (url) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
// 드라이브 미리보기 주소는 순수 함수라 utils에 있다(노드에서 바로 검사한다 — §3-5).
// 부르는 쪽(attachments.jsx)이 이미 여기서 가져다 쓰고 있어 그대로 다시 내보낸다.
import { driveSrc, sheetPreviewUrl } from '../utils.js';
export { driveSrc };

// 어느 뷰어로 그리고 있는지 — 화면 아래 한 줄에 그대로 적는다.
// 예전에는 이 문구가 조건 없이 '마이크로소프트 오피스 미리보기로 표시해요'였다.
// 드라이브 파일은 구글로 그리고 있는데도 마이크로소프트라고 적혀 있어서, 무엇이
// 어디로 나가는지 화면이 거짓말을 하고 있었다(사용자 지적).
// 변환 사본(preview_file_id)으로 그리는 워드·PPT·엑셀도 구글이다 — 사본은 드라이브에만
// 생기므로 source도 'drive'지만, 어느 쪽 조건으로 읽어도 마이크로소프트로 안 새게 둘 다 본다.
const viewerNote = (row) => ((row.source === 'drive' || row.preview_file_id)
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
// `canEditCopy` — 구글 사본을 **고칠 수 있는 사람에게만** 편집 화면을 준다. 켜는 자리는
// 둘이다: 주보 큐시트(교역자·마스터 — 사용자 결정 2026-09-09 · worshipPerms.canEditCue)와
// **업무 첨부**(올린 사람·관리자·마스터 — 사용자 결정 2026-09-11 · modals/attachments.jsx).
// 화면의 이 값은 버튼을 보일지만 정하고, **실제 경계는 드라이브의 편집자 목록**이다.
//
// `onGrantEdit` — 누른 그 자리에서 편집자를 붙여야 하는 갈래(업무 첨부)만 넘긴다.
// 큐시트 사본은 만들 때 이미 두 계정이 붙어 있어(Apps Script `CUE_EDITORS`) 넘기지 않고,
// 그래서 이 앵커의 기본 동작(새 탭)으로 바로 간다 — 스크립트 판이 낮아도 그 길은 산다.
export function FilePreviewModal({ row, rows = null, initialSrc = null, onClose, canEditCopy = false, onGrantEdit = null }) {
  const isMobile = useIsMobile();
  // 구글 문서 주소의 `authuser=`에 실을 내 로그인 이메일(§6-34-h). 게스트는 빈 문자열.
  const myEmail = useMyEmail();
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
  // 사본이 없어 우리가 직접 그리는 워드·PPT의 바이트(BYTE_KINDS). 예전 이름은 sheetSrc였는데
  // 엑셀이 이 길을 떠난 뒤로 이름이 화면과 어긋나 있었다.
  const [officeBlob, setOfficeBlob] = useState(null);
  // 창을 화면 가득 넓히기. 모바일은 원래 전체화면이라 버튼을 두지 않는다(태블릿부터 보인다).
  const [wide, setWide] = useState(false);
  const timerRef = useRef(null);
  const settleRef = useRef(null);
  const go = useCallback((d) => {
    const next = canNav ? gallery[gi + d] : null;
    if (!next) return;   // 끝에서는 멈춘다 — 빙글빙글 돌면 몇 장인지 감을 잃는다
    setCur(next); setUrl(null); setText(null); setError(null); setHtmlReady(false);
    setFrameReady(false); setTimedOut(false); setPdfSrc(null); setOfficeBlob(null);
    // 앞 파일이 걸어 둔 것들 — 남겨 두면 다음 파일의 화면을 건드린다(감사 2026-09-13).
    // 특히 settle 타이머는 새 틀이 뜨지도 않았는데 스켈레톤을 걷어 버린다.
    clearTimeout(settleRef.current); setBlobSrc(null);
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

  // 워드·PPT는 바이트를 받아 우리가 직접 읽는다(사본이 없어 구글 화면을 못 쓸 때만 — 위 BYTE_KINDS).
  // 드라이브 파일은 /api/drive-file 중계로만 받을 수 있다 — 브라우저에서
  // drive.google.com에 직접 가면 CORS가 막는다(§6-29-c).
  useEffect(() => {
    if (!BYTE_KINDS.has(kind) || officeBlob) return;
    let alive = true;
    if (local) { setOfficeBlob(local); return () => { alive = false; }; }
    if (cur.source === 'drive' && cur.drive_file_id) {
      fetchDriveFileBlob(cur.drive_file_id)
        .then(b => { if (alive) setOfficeBlob(b); })
        .catch(e => { if (alive) setError(e.human || e.message || String(e)); });
      return () => { alive = false; };
    }
    if (!url) return;
    fetch(url)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(b => { if (alive) setOfficeBlob(b); })
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

  // 틀로 그리는 갈래는 **전부** 시간을 잰다. 예전에는 'office' 하나만 재고 있었는데,
  // 첨부가 전부 드라이브로 옮겨진 지금 그 갈래는 아예 도달하지 않는다 — 그래서 구글
  // 틀이 막히면(콘텐츠 차단기·회사 프록시·서드파티 프레임 차단) onLoad가 영영 오지
  // 않고 **스켈레톤이 그대로 남았다**(감사 2026-09-13). 'drive' 가지는 timedOut을 읽고
  // 있으면서 타이머가 안 켜져 있어서, 지키는 것처럼 보이지만 아무것도 안 지켰다.
  //
  // 시간이 지나도 **틀은 그대로 둔다** — 늦게라도 뜨면 살아나야 하고, 내용을 바꿔치면
  // 그 뒤에 온 onLoad가 갈 곳이 없다. 덮고 있던 준비 중 자리만 '새 탭에서 열기'로
  // 바뀐다(DocEmbed가 30초에 그 버튼을 키우는 것과 같은 판단이다).
  useEffect(() => {
    if (!FRAME_KINDS.has(kind) || frameReady) return;
    timerRef.current = setTimeout(() => setTimedOut(true), kind === 'office' ? OFFICE_TIMEOUT : GOOGLE_TIMEOUT);
    return () => clearTimeout(timerRef.current);
  }, [kind, frameReady]);

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

  // 내려받기. **`Content-Disposition: attachment`가 달려 오는 주소로 보낸다**
  // (주소를 만드는 곳은 cloud.getFileDownloadUrl — 왜 그래야 하는지가 거기 적혀 있다).
  //
  // 예전에는 바이트를 우리가 받아 `URL.createObjectURL` + `a.download`로 저장했는데,
  // **홈 화면에 담은 앱·인앱 웹뷰의 iOS 사파리는 blob: 주소를 내려받지 않고 열어 버린다**
  // — "'미리보기'에서 열기 / 기타…"만 있는 페이지가 뜨고 저장이 안 됐다(사용자 신고
  // 2026-09-13, 스크린샷). attachment가 달린 진짜 주소는 사파리가 자기 내려받기로 받는다.
  //
  // `a.download`는 그대로 둔다 — **같은 출처와 blob:에서만 듣는다.** 드라이브 주소에서는
  // 브라우저가 무시하고 구글이 준 파일 이름을 쓰고(그게 원본 이름이다), 아직 올리는 중인
  // 파일(blob:)에서는 이 속성이 이름을 정한다. 한 길로 두 경우를 다 받는다.
  // `target`을 주지 않는 것이 중요하다 — attachment 응답은 페이지를 옮기지 않고
  // 내려받기만 시작한다. 새 탭을 열면 폰에서 빈 탭이 남는다.
  const [saving, setSaving] = useState(false);
  const canSave = !!(local || url || cur.drive_file_id);
  const saveFile = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    let objectUrl = null;
    try {
      const href = local
        ? (objectUrl = URL.createObjectURL(local))
        : await getFileDownloadUrl(cur);
      const a = document.createElement('a');
      a.href = href;
      a.download = cur.name || 'file';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      showToast(failText(`'${cur.name}'을(를) 내려받지 못했어요`, e));
    } finally {
      // 바로 회수하면 브라우저가 저장을 시작하기도 전에 주소가 죽는다
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      setSaving(false);
    }
  };

  // '구글 문서에서 편집' — 자격자(canEditCopy)에게만, 그리고 **언제나 보인다**(§8).
  // 왜 새 탭인가: 앱 안 창은 iframe이고 그 안의 구글은 **브라우저의 구글 로그인 상태
  // (서드파티 쿠키)** 를 쓴다. 아이폰 사파리·카카오 인앱·크롬 시크릿은 그것을 막아
  // 구글이 로그아웃 상태로 보고 읽기 화면을 준다 — 앱 안에서는 구조적으로 못 고친다
  // (§6-34-h). 새 탭은 1차 쿠키라 폰에서도 편집이 된다.
  // `rm=minimal`을 빼는 이유: 새 탭은 폭이 넉넉하니 온전한 편집기가 맞다.
  // 자격이 없으면 null이라 버튼 자체가 없다.
  const editHref = canEditCopy ? copyEditUrl(cur, { email: myEmail, minimal: false }) : null;

  // 업무 첨부는 **주소로 바로 가고, 편집자 붙이기는 뒤에서** 한다(§6-34-h · Apps Script
  // v11). v11부터는 사본을 만들 때 올린 사람·관리자를 편집자로 이미 붙이므로 여기서
  // 부르는 `grantEditors`는 **v11 이전 사본을 위한 보험**(멱등)이다. 예전에는 빈 탭을 먼저
  // 열고 권한이 붙기를 기다린 뒤 주소를 실었는데, Apps Script 왕복이 3~5초라 사용자에게는
  // "about:blank가 5초 떠 있다가 넘어간다"였다(2026-09-11). 지금은 제스처 안에서 곧장 열고
  // 권한은 뒤에서 붙인다 — 옛 사본이라 권한이 아직 없으면 첫 화면이 읽기일 수 있고,
  // 그때는 새로고침하면 편집이 된다(뒤에서 붙인 권한이 그 사이 들어온다).
  const [granting, setGranting] = useState(false);
  const onEditClick = (e) => {
    if (!onGrantEdit) return;                       // 큐시트 — 앵커 기본 동작(새 탭) 그대로
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;  // 브라우저에 맡긴다
    e.preventDefault();
    window.open(editHref, '_blank', 'noreferrer');  // 제스처 안에서 곧장 — 기다리면 팝업 차단에 걸린다
    setGranting(true);
    Promise.resolve()
      .then(onGrantEdit)
      .catch((err) => {
        console.warn('[drive] 편집 권한 부여 실패(읽기 화면일 수 있다):', err);
        showToast(failText('편집 권한을 확인하지 못했어요', err));
      })
      .finally(() => setGranting(false));
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
      // `playsInline`이 없으면 iOS가 재생을 누르는 순간 **자기 전체화면**으로 채 간다 —
      // 이 창이 그 뒤에 남아 닫을 수도 없다(감사 2026-09-13).
      return <video src={src} controls playsInline className="max-w-full max-h-full rounded-md bg-black" />;
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
      if (!officeBlob) return <PreparingFrame />;
      const View = kind === 'doc' ? DocView : SlideView;
      return <View blob={officeBlob} onError={(e) => setError(`${kind === 'doc' ? '문서' : '슬라이드'}를 읽지 못했어요 · ${e.message || e}`)} />;
    }
    // 워드·PPT에 변환 사본이 있으면 **구글이 그린 화면**을 그대로 띄운다(사용자 요청
    // 2026-09-08 — "그냥 실제 뷰로 볼 수 있게끔, 우리 엑셀 미리보기 하는 것처럼"). 우리
    // 렌더러는 pptx에서 글자가 잘리고 배치가 틀어졌다(실물 화면을 받았다). 아래 'sheet'와
    // 같은 판단이고, 사본이 없는 파일만 우리 렌더러('doc'·'slide')로 남는다.
    // **흰 바탕**: 구글 미리보기는 언제나 밝은 화면이라 다크 모드를 따라가지 않는다
    // (§6-29-c에 적힌 그 결정 그대로다 — 작성자가 칠한 색을 원본대로 보여주는 자리다).
    if (kind === 'gdoc') {
      // 자격자에게는 편집 화면, 나머지는 보기 화면. 사본이 없으면 둘 다 null이고 아래에서
      // 새 탭으로 떨어진다. `authuser=`로 어느 구글 계정으로 열지를 정한다(§6-34-h) —
      // 그래도 **앱 안 창(iframe)은 서드파티 쿠키가 막힌 브라우저에서 읽기 화면이다.**
      // 그 갈래는 머리줄의 '구글 문서에서 편집'(새 탭)이 받는다.
      const src = (canEditCopy && copyEditUrl(cur, { email: myEmail })) || previewCopyUrl(cur);
      // 종류 판정이 사본을 확인하고 왔으므로 여기서 src가 빌 일은 없다. 그래도 빈 iframe을
      // 띄우느니 새 탭을 내주는 쪽이 정직하다(스켈레톤만 남으면 영영 안 걷힌다).
      if (!src) return <Fallback row={cur} message="미리보기를 준비하지 못했어요." onOpen={openExternal} />;
      // **모바일에서는 틀을 종이 폭만큼 넓혀 두고 우리 칸이 옆으로 스크롤한다.**
      // 사용자 스크린샷(2026-09-09 · 큐시트 docx)에서 표가 오른쪽으로 잘려 나갔다 —
      // 구글 문서 미리보기는 종이를 화면 폭에 맞춰 주지 않고 **자기 폭으로 그린 뒤
      // 넘치는 것을 잘라 버린다**(iframe 안에서 가로로 밀 수도 없다). 375px 틀에
      // 940px 종이를 담고 겉을 `overflow-x-auto`로 두면, 잘리는 대신 밀어서 볼 수 있다.
      // 940은 A4 본문 폭(약 794px)에 표가 여백을 넘는 만큼을 더한 값이다 — 이보다 크게
      // 두면 처음 보이는 자리가 종이의 왼쪽 조각뿐이 된다.
      // 넓은 화면은 그대로 폭을 채운다(자를 것이 없다).
      //
      // **슬라이드(pptx)는 넓히지 않는다**(감사 2026-09-13). 잘림은 구글 *문서*(A4 종이)의
      // 이야기이고, 슬라이드 `embed`는 제 틀 크기에 맞춰 줄여 그린다 — 940px을 억지로
      // 주면 다 보이던 장표가 옆으로 밀어야 보이는 것이 됐다.
      //
      // 이름은 `panMobile`이다. 예전에는 여기서도 `wide`를 썼는데 **창을 넓히는 바깥
      // 상태와 이름이 같아** 이 블록 안에서 그 상태를 읽으면 조용히 다른 값이 잡혔다.
      const panMobile = isMobile && previewCopyOf(cur.name) !== 'presentation';
      return (
        // `x-scroll-lock`을 여기 쓰면 안 된다 — 그것은 `touch-action: pan-x`라서 **틀 안의
        // 세로 스크롤까지 막는다**(칩 줄을 위해 만든 유틸리티다). 손가락으로 문서를 내려
        // 읽을 수가 없었다(감사 2026-09-13). 가로로 흘러넘치지 않게 하는 쪽만 남긴다.
        <div className={`relative w-full h-full ${panMobile ? 'overflow-x-auto overscroll-x-contain' : ''}`}>
          {!frameReady && <PreparingFrame absolute stalled={timedOut} onOpen={openExternal} />}
          <iframe
            src={src} title={`${cur.name} 미리보기`}
            // onLoad는 "문서가 전달된 시점"이라 첫 장이 아직 안 그려져 있다 → 조금 뒤에 걷는다
            onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setFrameReady(true), FRAME_SETTLE); }}
            style={panMobile ? { width: GDOC_MOBILE_W, maxWidth: 'none' } : undefined}
            // 스켈레톤과 **정확히 같은 자리**를 채운다(둘 다 이 relative 칸을 꽉 채운다) —
            // 크기가 다르면 걷히는 순간 화면이 한 번 튄다. 걷을 때는 페이드다(§4.2).
            className={`h-full rounded-md border border-line bg-white transition-opacity duration-200 ${panMobile ? 'block' : 'w-full'} ${frameReady ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      );
    }
    if (kind === 'sheet') {
      // 변환 사본이 있으면 **구글이 그린 화면**을 그대로 띄운다(사용자 결정 2026-08-29).
      // 예전에 이 길을 접었던 이유는 갓 올린 파일에서 오류가 났기 때문인데, 이제는
      // 올릴 때 스크립트가 네이티브 시트로 변환해 두므로 기다릴 것이 없다(0031).
      // 흰 바탕이 그대로 온다 — 작성자가 칠한 색을 원본대로 보여주는 것이 이 화면의
      // 목적이라 다크 모드를 따라가지 않는다.
      const gsheet = sheetPreviewUrl(cur);
      if (gsheet) {
        // 뜨기 전에는 스켈레톤이 같은 자리를 채운다 — 바로 위 'gdoc'과 **같은 구글
        // iframe**인데 여기만 없어서, 표를 열면 구글이 그릴 때까지 빈 흰 칸이 먼저
        // 보였다(사본이 생긴 뒤로 이 갈래가 제일 흔한 첨부다).
        return (
          <div className="relative w-full h-full">
            {!frameReady && <PreparingFrame absolute stalled={timedOut} onOpen={openExternal} />}
            <iframe
              src={gsheet} title={`${cur.name} 미리보기`}
              onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setFrameReady(true), FRAME_SETTLE); }}
              className={`w-full h-full rounded-md border border-line bg-white transition-opacity duration-200 ${frameReady ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        );
      }
      // 사본이 없는 파일 — 변환에 실패했거나 아직 안 만들어졌다. 예전에는 여기서
      // 우리가 표를 그렸는데(SheetView) 2026-08-30에 지웠다.
      // **다른 실패 갈래와 같은 카드를 쓴다**(감사 2026-09-13): 예전에는 여기만 글자
      // 두 줄이라 "새 탭에서 열어주세요"라고 적어 놓고 **누를 것이 없는** 막다른 길이었다.
      return <Fallback row={cur} message="이 파일은 표로 볼 수 없어요." onOpen={openExternal} />;
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
      return (
        <div className="relative w-full h-full">
          {!frameReady && <PreparingFrame absolute stalled={timedOut} onOpen={openExternal} />}
          <iframe
            src={src} title={cur.name}
            // onLoad 직후엔 아직 첫 페이지가 안 그려져 있다(뷰어 배경만 보임) → 조금 뒤에 걷는다
            onLoad={() => { clearTimeout(settleRef.current); settleRef.current = setTimeout(() => setFrameReady(true), FRAME_SETTLE); }}
            // 걷을 때는 페이드다(§4.2) — 'gdoc'·'sheet'와 같은 전환이라야 파일 종류에
            // 따라 어떤 것은 툭 나타나고 어떤 것은 밝아지는 일이 없다
            className={`w-full h-full rounded-md border border-line bg-surface transition-opacity duration-200 ${frameReady ? 'opacity-100' : 'opacity-0'}`}
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
          {/* 편집 진입은 연한 accent다(§8의 색 규칙). 새 탭이라 <a>여야 한다 —
              폰에서는 이 길만 편집이 된다(위 editHref 주석). rel에 noreferrer까지
              두는 이유는 구글에 우리 주소를 넘길 이유가 없어서다.
              업무 첨부는 누를 때 편집자를 먼저 붙인다(onEditClick) — ⌘/Ctrl 누름은
              그대로 브라우저에 넘기므로 href가 앵커에 남아 있어야 한다. */}
          {editHref && (
            <a href={editHref} target="_blank" rel="noreferrer" onClick={onEditClick}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold whitespace-nowrap transition active:scale-95 ${granting ? 'opacity-60 pointer-events-none' : ''}`}>
              {granting
                ? <Loader2 size={13} strokeWidth={1.8} className="animate-spin" />
                : <SquarePen size={13} strokeWidth={1.8} />} 구글 문서에서 편집
            </a>
          )}
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

// 준비 중 자리(스켈레톤 + 안내). absolute=이미 자리를 잡은 컨테이너 위에 덮어씌울 때.
// `stalled`면 **나가는 길**을 준다 — 틀이 막혀 onLoad가 영영 안 오는 경우가 있고
// (서드파티 프레임 차단·콘텐츠 차단기), 그때 돌던 스피너는 거짓말이다. 문구는 예전
// 시간 초과 카드가 쓰던 그대로다.
function PreparingFrame({ absolute = false, stalled = false, onOpen = null }) {
  return (
    <div className={absolute ? 'absolute inset-0' : 'relative w-full h-full'}>
      {/* Skeleton에 absolute를 주면 먹지 않는다(.dc-skeleton이 position: relative를
          박는다 — index.css). 자리는 바깥 span이 잡는다. */}
      <span className="absolute inset-0"><Skeleton className="w-full h-full" /></span>
      {stalled ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs text-fg-muted">미리보기가 응답하지 않아요.</p>
          {onOpen && (
            <button type="button" onClick={onOpen}
              className="inline-flex items-center gap-1.5 bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-md text-xs font-medium transition active:scale-95">
              <ExternalLink size={13} /> 새 탭에서 열기
            </button>
          )}
        </span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted">
          <Loader2 size={14} className="animate-spin" /> 미리보기를 준비하고 있어요
        </span>
      )}
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
