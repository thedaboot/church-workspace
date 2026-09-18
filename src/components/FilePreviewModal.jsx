import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileQuestion, Loader2, ChevronLeft, ChevronRight, Maximize2, Minimize2, SquarePen } from 'lucide-react';
import { RichText } from './RichText.jsx';
import { getFileOpenUrl, getFileDownloadUrl, driveImageFullUrl, fetchDriveFileBlob } from '../services/cloud.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useMyEmail } from '../services/auth.jsx';
import { Skeleton, SmartImage, usePanDrag } from './media.jsx';
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
// 확대 배율. **우리가 그리는 갈래(사진·PDF)에만** 있다 — 구글 문서·시트·슬라이드 틀은
// 구글이 자기 확대를 그려 주고, 오피스 뷰어도 마찬가지다(우리가 안쪽에 손댈 수 없다).
//
// 사용자 결정 2026-09-14: "150%, 200% 붙이지 말고 손가락으로 펴고, 마우스로 휠로 펼 수
// 있게끔" — 계단(100·150·200·300)과 머리줄의 `－ 100% ＋` 버튼을 걷고 **연속 배율**로
// 바꿨다. 키우는 길은 셋이다: 손가락 오므리기(아래 pinch) · 컨트롤/⌘+휠 · 두 번 누르기.
// **손가락 갈래만 다르게 돈다**: 손짓이 도는 동안에는 이 상태를 건드리지 않고 내용에
// transform을 먹이다가 손을 뗄 때 한 번 커밋한다(아래 liveBegin · 사용자 신고 2026-09-17).
// 배율 1은 '칸에 맞춤'이고 거기가 하한이다. 상한은 옛 계단의 맨 위(3배)를 그대로 둔다 —
// PDF는 CSS로 늘리는 것이 아니라 **그 배율로 다시 그리는** 것이라(§6-29-z-13) 그 위로는
// 캔버스가 감당하지 못한다(PdfView의 MAX_CANVAS_PX_W가 실제 픽셀을 한 번 더 막는다).
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
// 1 언저리는 **정확히 1로 붙인다.** 연속 배율에서는 1.0003 같은 값이 쉽게 남는데, 화면은
// `zoom > 1`로 '확대됐는가'를 판정한다(통이 스크롤로 바뀌고 끌어서 밀기가 붙는다 ·
// §6-29-z-16) — 손가락이 살짝 떨린 것만으로 그 모드가 깜빡이면 안 된다.
const ZOOM_SNAP = 0.02;
const clampZoom = (v) => (!Number.isFinite(v) || v <= ZOOM_MIN + ZOOM_SNAP ? ZOOM_MIN : Math.min(ZOOM_MAX, v));
// 두 번 눌렀을 때 가는 배율(맞춤 ↔ 이것). 옛 계단에도 있던 그 2배다.
const ZOOM_TAP = 2;
// 휠 한 칸(deltaY 100)이 얼마나 키우나 — exp(100 × 0.0025) ≈ 1.28배. 트랙패드 오므리기는
// deltaY가 한 자리라 저절로 잘게 따라온다(크롬·사파리가 `ctrlKey: true`인 wheel로 준다).
const WHEEL_ZOOM_K = 0.0025;
const ZOOM_KINDS = new Set(['image', 'pdf']);
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
  // 확대 배율(위 ZOOM_MIN·ZOOM_MAX). 파일을 바꾸면 1로 돌아간다 — 앞 사진을 3배로 보고
  // 있었다고 다음 사진도 3배로 열리면 무엇을 보고 있는지 알 수가 없다.
  const [zoom, setZoom] = useState(1);
  const canZoom = ZOOM_KINDS.has(kind);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 확대가 일어나는 **스크롤 통**. 사진은 아래 'image' 갈래의 감싸개이고, PDF는 PdfView
  // 안쪽이라 `onBox`로 받아 온다. 노드가 붙고 떨어지는 것을 효과가 알아야 해서(그때
  // 손가락·휠 리스너를 다시 걸어야 한다) ref가 아니라 상태로 둔다.
  const [zoomBox, setZoomBox] = useState(null);
  // 배율을 바꾸는 동안 **화면의 한 점을 제자리에 붙잡아 둘** 스크롤 값. 내용 크기는
  // 다시 그려진 뒤에야 바뀌므로 여기 담아 두고 아래 useLayoutEffect에서 적용한다.
  const anchorRef = useRef(null);
  // 사파리의 `gesture*`가 지금 이 손짓을 받고 있나 — 터치 길이 겹쳐서 두 번 적용되지
  // 않게 하는 표시다(바로 아래 두 효과의 머리말).
  const gestureRef = useRef(false);
  // 그림의 원래 크기 — 확대 층을 **그림이 칸에 맞춰진 크기**의 배수로 두려고 잰다.
  // 아직 안 받았으면 null이고, 그때는 층이 칸을 통째로 채운다(스켈레톤 자리).
  const [natural, setNatural] = useState(null);
  // 칸 크기. **퍼센트로는 안 된다** — 층을 가운데 맞추려고 통을 격자(`place-content`)로
  // 두는 순간 트랙이 내용 크기가 되어 `100%`가 순환이 되고 층이 0으로 무너진다
  // (헤드리스로 재어 확인했다). 그래서 픽셀로 준다.
  const [boxSize, setBoxSize] = useState(null);
  useEffect(() => {
    if (!zoomBox) return undefined;
    // **`getBoundingClientRect`를 쓰지 마세요.** 그 값은 transform을 먹은 크기라, 창이
    // 뜰 때의 등장 애니메이션(`zoom-in-95`)이 도는 동안 **95%로 잡힌다.** 그러면 맞춤
    // 크기가 그만큼 작게 정해지고, 나중에 스크롤바가 생겨 옵저버가 다시 돌 때 제 크기로
    // 고쳐지면서 **그림이 5.3% 튄다**(2026-09-17에 실측). `offsetWidth/Height`는 레이아웃
    // 크기라 transform을 안 타고, 스크롤바가 생겨도 테두리 상자라 값이 그대로다.
    const read = () => setBoxSize({ w: zoomBox.offsetWidth, h: zoomBox.offsetHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(zoomBox);
    return () => ro.disconnect();
  }, [zoomBox]);

  // **배율을 바꾸되 (px, py) 화면 점은 제자리에 남긴다.**
  // 손가락 가운데·커서 자리가 기준이어야 한다 — 좌상단 기준으로 키우면 보던 자리가
  // 화면 밖으로 달아나서, 키울수록 엉뚱한 데를 보게 된다.
  // 통 안에서의 그 점은 `(scroll + offset)`이고 내용이 k배가 되면 `(scroll + offset) × k`가
  // 되니, 새 스크롤은 그 값에서 다시 offset을 뺀 만큼이다.
  const zoomTo = useCallback((next, px = null, py = null) => {
    const z0 = zoomRef.current;
    const z1 = clampZoom(next);
    if (z1 === z0) return;
    if (zoomBox && px != null) {
      const r = zoomBox.getBoundingClientRect();
      const pend = anchorRef.current;
      // 한 프레임 안에 두 번 이상 불리면(손가락이 빠를 때) 앞의 것이 아직 화면에 적용되기
      // 전이다. 그때 스크롤을 다시 읽으면 옮기지도 않은 자리를 기준으로 또 계산해서
      // **덜 따라간다** — 배율만 곱해 이어 간다(기준점이 거의 그대로면 결과가 같다).
      anchorRef.current = pend
        ? { ...pend, k: pend.k * (z1 / z0), ox: px - r.left, oy: py - r.top }
        : { k: z1 / z0, ox: px - r.left, oy: py - r.top, sl: zoomBox.scrollLeft, st: zoomBox.scrollTop };
    }
    // 한 손짓 안에서 연달아 불린다 — 다음 계산이 아직 안 그려진 새 값을 봐야 한다.
    zoomRef.current = z1;
    setZoom(z1);
  }, [zoomBox]);

  // ------------------------------------------------------------------------
  // **손짓이 도는 동안에는 리액트를 건드리지 않는다**(사용자 신고 2026-09-17 — "손가락으로
  // 줌인 줌아웃 하면 프레임 단위로 끊겨가지고"). `touchmove`마다 `setZoom`을 부르면 매
  // 프레임 창 전체가 다시 그려지는데, 사진은 감싸개 폭이 `zoom × 100%`라 **레이아웃이
  // 다시 잡히고**(PDF는 캔버스 쉰 장의 크기가 한꺼번에 바뀐다) 그 뒤에 스크롤 보정까지
  // 돈다. 폰에서 그 한 바퀴가 16ms를 넘으면 손가락을 못 따라와 계단처럼 보인다.
  //
  // 그래서 손가락이 둘 닿는 순간부터는 **내용 층(`data-zoom-layer`)에 `transform: scale`만**
  // 먹인다 — 레이아웃이 아니라 합성이라 손가락에 그대로 붙는다. 기준점은 `transform-origin`
  // 이 아니라 **스크롤**로 잡는다(원점은 `0 0` 고정): 커밋된 배율의 화면과 **같은 계산**이라야
  // 손을 뗄 때 튀지 않는다. 손가락 가운데가 움직이면 그만큼 같이 밀린다.
  // 커밋은 손가락이 둘 미만이 되는 순간 **딱 한 번**이고, transform은 새 배율이 그려진
  // 뒤(아래 useLayoutEffect)에 걷는다 — 먼저 걷으면 리액트가 다시 그리기 전 한 프레임 동안
  // 옛 배율이 번쩍인다.
  const pinchRef = useRef(null);    // 손짓이 도는 동안만 차 있다(모양은 liveBegin에)
  const liveElRef = useRef(null);   // transform이 남아 있는 요소 — 세션보다 오래 산다

  const liveStrip = useCallback(() => {
    const el = liveElRef.current;
    liveElRef.current = null;
    if (!el) return;
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.style.willChange = '';
  }, []);

  const liveBegin = useCallback((px, py) => {
    if (pinchRef.current || !zoomBox) return;   // 이미 돌고 있다 — 사파리는 두 길을 다 준다
    const el = zoomBox.querySelector('[data-zoom-layer]');
    if (!el) return;
    const r = zoomBox.getBoundingClientRect();  // 창은 손짓 동안 움직이지 않는다 — 한 번만 잰다
    // 손가락 가운데를 못 받았으면 칸 한가운데를 기준으로 삼는다. 사파리 `GestureEvent`의
    // `clientX/Y`는 실기기로 재어 보지 못한 값이라, 없으면 **셈이 NaN이 되어 기준점 보정이
    // 통째로 0이 된다**(= 사진이 그냥 미끄러진다). 빈 값이 여기서 멎게 한다.
    const cx = Number.isFinite(px) ? px : r.left + r.width / 2;
    const cy = Number.isFinite(py) ? py : r.top + r.height / 2;
    pinchRef.current = {
      el, box: zoomBox, z0: zoomRef.current, z: zoomRef.current,
      rl: r.left, rt: r.top, ox: cx - r.left, oy: cy - r.top,
      sl: zoomBox.scrollLeft, st: zoomBox.scrollTop,
      // 손을 뗄 때 커밋할 스크롤(아래 liveScale이 고쳐 쓴다). 처음에는 지금 자리 그대로.
      tl: zoomBox.scrollLeft, tt: zoomBox.scrollTop,
      // 지금 배율에서의 **내용 크기**와 칸 크기 — 배율이 k배면 내용도 k배라(사진 층은
      // 맞춤 크기의 배수, PDF는 쪽 폭·틈·여백이 모두 배율을 따라간다) 밀 수 있는 끝을 셈할
      // 수 있다. **통의 `scrollWidth`가 아니라 층의 크기를 잰다** — 내용이 칸보다 작으면
      // scrollWidth는 칸 크기라(넘치지 않으니) 실제보다 큰 끝을 주고, 그만큼 손을 뗄 때
      // 튄다. 사진 층은 이제 그림만큼이라 둘이 다르다(2026-09-17).
      // PDF 층은 블록이라 제 폭이 칸 폭이고 **쪽(캔버스)이 그것보다 넓게 삐져나간다** —
      // 그때는 `scrollWidth`가 진짜 내용 폭이다. 사진 층은 크기가 정확해 둘이 같다.
      sw: Math.max(el.offsetWidth, el.scrollWidth), sh: Math.max(el.offsetHeight, el.scrollHeight),
      cw: zoomBox.clientWidth, ch: zoomBox.clientHeight,
      // 내용이 칸보다 작으면 통(격자)이 **가운데로 잡아 준다.** 그 여백은 배율이 커지면
      // 줄어드는데, 손짓 중 transform은 층의 왼쪽 위에서 자라므로 그만큼 어긋난다
      // (배율 1에서 시작하는 손짓이 딱 그 경우다 — 안 맞추면 또 미끄러진다).
      // 지금 여백을 재 두고 아래에서 새 여백과의 차이를 translate에 더한다. PDF 통은
      // 가운데 맞추기를 안 하므로 0이고, 0이면 계속 0으로 둔다.
      pl: el.offsetLeft, pt: el.offsetTop,
    };
    liveElRef.current = el;
    el.style.transformOrigin = '0 0';
    el.style.willChange = 'transform';
  }, [zoomBox]);

  // 손가락 사이가 처음의 몇 배인가(`ratio`)와 지금 손가락 가운데. 상·하한과 1 붙이기는
  // 여기서도 그대로 건다 — 손을 떼기 전에 이미 그 배율로 보여야 한다.
  //
  // **스크롤은 건드리지 않는다.** 예전에는 여기서 통의 `scrollLeft/Top`을 직접 썼는데
  // 아이폰에서 그 값이 먹지 않았고, 그러면 기준점 보정이 통째로 죽어 **층이 왼쪽 위에서
  // 자라는 만큼 사진이 그냥 아래로 미끄러진다**(사용자 신고 2026-09-17 두 번째 — "확대가
  // 밑으로 내려가는데"). 맞춤(배율 1)에서는 통이 `overflow-hidden`이라 밀 자리가 0이고,
  // 손짓 동안 커지는 것은 레이아웃이 아니라 transform이라 그 범위가 안 열린 것으로 보인다
  // (데스크톱 크롬에서는 같은 코드가 먹었다 — 그래서 폰에서만 났다).
  // 그래서 옮길 만큼을 스크롤이 아니라 **`translate`로** 준다: 통이 안 밀려도 화면은
  // 똑같고, 그 값이 손을 뗄 때 그대로 진짜 스크롤이 된다(아래 liveCommit). 통이 제 스크롤을
  // 스스로 움직였다면(관성이 남았거나 내용이 줄어 브라우저가 끝으로 당겼다면) 그만큼 뺀다.
  const liveScale = useCallback((ratio, px, py) => {
    const s = pinchRef.current;
    if (!s) return;
    s.z = clampZoom(s.z0 * ratio);
    const k = s.z / s.z0;
    // 지금 손가락 가운데(칸 안 자리). 못 받았으면 닿을 때 잡아 둔 자리를 그대로 쓴다(위 liveBegin).
    const ox = Number.isFinite(px) ? px - s.rl : s.ox;
    const oy = Number.isFinite(py) ? py - s.rt : s.oy;
    // 커밋된 배율에서라면 여기였을 스크롤. **끝을 넘지 않게 자르는 것까지 똑같이** 해야
    // 손을 뗄 때 튀지 않는다 — 브라우저도 같은 자리에서 자른다.
    s.tl = Math.min(Math.max((s.sl + s.ox) * k - ox, 0), Math.max(0, s.sw * k - s.cw));
    s.tt = Math.min(Math.max((s.st + s.oy) * k - oy, 0), Math.max(0, s.sh * k - s.ch));
    // 가운데 맞추기 여백이 줄어드는 만큼(위 liveBegin의 pl·pt). 처음부터 0이면 이 통은
    // 가운데를 안 맞추는 것이니 계속 0이다.
    const dl = s.pl > 0.5 ? Math.max(0, (s.cw - s.sw * k) / 2) - s.pl : 0;
    const dt = s.pt > 0.5 ? Math.max(0, (s.ch - s.sh * k) / 2) - s.pt : 0;
    s.el.style.transform =
      `translate(${dl + s.box.scrollLeft - s.tl}px, ${dt + s.box.scrollTop - s.tt}px) scale(${k})`;
  }, []);

  // 손가락이 둘 미만이 되는 순간 — **여기서 딱 한 번** 커밋한다. 두 번 불려도 안전해야
  // 한다: 사파리는 `gestureend`와 `touchend`를 둘 다 준다(§6-29-z-13-a ②).
  const liveCommit = useCallback(() => {
    const s = pinchRef.current;
    if (!s) return;
    pinchRef.current = null;
    const z0 = zoomRef.current;
    // 손짓 동안 `translate`로 보여 주던 그 자리가 **이제 진짜 스크롤이 된다**(liveScale의
    // s.tl·s.tt). 배수 1인 기준점이 곧 "이 자리에 세워라"다. 기준점을 여기서 세워 두고
    // 배율은 `zoomTo`가 커밋한다 — 배율이 바뀌는 자리는 하나여야 한다.
    anchorRef.current = { k: 1, ox: 0, oy: 0, sl: s.tl, st: s.tt };
    zoomTo(s.z);
    // 배율이 그대로면(zoomTo가 되돌아갔다) 다시 그려지지 않아 아래 layout effect도 안
    // 돈다 — 세워 둔 기준점을 도로 버리고 transform은 지금 걷는다.
    if (zoomRef.current === z0) { anchorRef.current = null; liveStrip(); }
  }, [zoomTo, liveStrip]);

  // 내용 크기가 정해지는 그 순간에 스크롤을 옮긴다. 그림은 이 커밋에서 바로 커지고,
  // PDF는 **자식의 layout effect가 먼저 돌아** 캔버스를 늘려 놓은 뒤라(리액트는 자식의
  // layout effect를 부모보다 먼저 돌린다) 여기서 잰 크기가 이미 새 크기다.
  useLayoutEffect(() => {
    // 새 배율이 그려졌으니 손짓 동안 먹였던 transform을 **이제** 걷는다. 아직 손짓이
    // 돌고 있으면(다음 손가락이 벌써 닿았다) 그대로 둔다.
    if (!pinchRef.current) liveStrip();
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!a || !zoomBox) return;
    zoomBox.scrollLeft = (a.sl + a.ox) * a.k - a.ox;
    zoomBox.scrollTop = (a.st + a.oy) * a.k - a.oy;
  }, [zoom, zoomBox, liveStrip]);
  // 확대한 사진을 마우스로 끌어서 민다(media.usePanDrag 머리말 — 왜 필요한지가 거기 있다)
  const { panning, panProps } = usePanDrag();
  // 딤을 눌러 닫기 — **누른 곳도 딤이어야 닫는다.** 사진을 끌다가 딤에서 손을 떼면
  // click이 두 곳의 공통 조상(이 딤)에서 나서 **창이 제멋대로 닫혔다.** 업무 창이
  // 이미 같은 방식으로 막고 있다(modals.jsx의 downOnOverlay).
  const dimRef = useRef(null);
  const downOnDim = useRef(false);

  // **손가락으로 오므려 확대하는 것을 우리 배율로 받는다(사파리 전용 `gesture*`).**
  // 왜 필요한가: iOS는 `maximum-scale=1.0`을 접근성 이유로 무시하므로 **페이지 자체가
  // 확대된다.** 그러면 `fixed`로 깔린 이 창은 레이아웃 뷰포트에 붙어 있는데 사람이 보는
  // 것은 좁아진 비주얼 뷰포트라, **확대한 뒤 밀면 머리줄 버튼이 보는 화면 밖으로 나간다.**
  // 사용자 신고 2026-09-13 두 번째 — "확대를 한 뒤에 스크롤을 하고 뭔가 다른 액션을
  // 하려고 하면 아예 버튼이 안 먹네". 더블탭 쪽은 `tap-zoom-lock`이 막았고(§6-29-z-14),
  // 남은 길이 이것이다. `touch-action`으로는 못 막는다 — iOS의 페이지 확대는 그 값을
  // 보지 않는다. 사파리가 주는 `gesturestart`를 preventDefault 하는 것이 유일한 길이다.
  //
  // **우리 배율이 있는 갈래(사진·PDF)에서만 막는다.** 구글 문서·시트 틀에는 대신 줄
  // 것이 없어서, 거기서 막으면 키울 방법을 통째로 뺏는 것이 된다.
  // 사파리 밖(안드로이드 크롬 등)에는 이 이벤트가 **없다** — 거기서는 `maximum-scale=1.0`이
  // 페이지 확대를 막아 주지만 그래서 우리 배율도 안 움직였다. 그 갈래는 바로 아래 효과가
  // `touch*`로 직접 받는다. 사파리는 두 길을 **둘 다** 주므로(터치도 오고 gesture도 온다)
  // 여기서 `gestureRef`를 세워 터치 쪽이 손을 떼게 한다 — 두 손가락 `touchstart` 바로 뒤에
  // `gesturestart`가 오고 그 다음이 첫 `touchmove`라, 배율이 두 번 적용될 틈이 없다.
  //
  // **여기도 손짓 동안에는 transform만** 먹인다(위 liveBegin 머리말) — 예전에는
  // `gesturechange`가 곧바로 `zoomTo`를 불러서 아이폰에서도 매 프레임 리렌더였다.
  useEffect(() => {
    if (!canZoom) return;
    // `clientX/Y`는 두 손가락 가운데다(WebKit GestureEvent) — 그 자리를 붙잡고 키운다.
    const onStart = (e) => { e.preventDefault(); gestureRef.current = true; liveBegin(e.clientX, e.clientY); };
    const onChange = (e) => { e.preventDefault(); liveScale(e.scale || 1, e.clientX, e.clientY); };
    const onEnd = (e) => { e.preventDefault(); gestureRef.current = false; liveCommit(); };
    const opt = { passive: false };
    document.addEventListener('gesturestart', onStart, opt);
    document.addEventListener('gesturechange', onChange, opt);
    document.addEventListener('gestureend', onEnd, opt);
    return () => {
      gestureRef.current = false;
      document.removeEventListener('gesturestart', onStart, opt);
      document.removeEventListener('gesturechange', onChange, opt);
      document.removeEventListener('gestureend', onEnd, opt);
    };
  }, [canZoom, liveBegin, liveScale, liveCommit]);

  // **손가락 오므리기(안드로이드)와 컨트롤/⌘+휠(데스크톱).**
  // 안드로이드 크롬에는 `gesture*`가 없으므로 두 손가락 사이 거리를 우리가 직접 잰다:
  // 닿은 순간의 거리를 기억해 두고 `지금 거리 ÷ 처음 거리 × 처음 배율`로 간다.
  // 기준점은 **두 손가락 가운데**다(liveScale이 그 자리를 붙잡는다).
  // 손짓이 도는 동안에는 `setZoom`을 부르지 않고 transform만 먹인다 — 커밋은 손가락이
  // 둘 미만이 되는 `touchend`/`touchcancel` 한 번뿐이다(위 liveBegin 머리말).
  //
  // 끌어서 밀기와 싸우지 않는다: 손가락 밀기는 브라우저의 스크롤이 맡고 있고(usePanDrag는
  // `pointerType === 'mouse'`만 받는다 · §6-29-z-16), 손가락이 둘일 때만 `preventDefault`로
  // 그 스크롤을 잠깐 끊는다. 하나로 줄면 바로 밀기로 돌아간다.
  // 리스너는 **통(zoomBox)에** 건다 — 머리줄·딤에서의 휠까지 가로채면 창 밖의 평범한
  // 조작까지 바뀐다. `{ passive: false }`가 아니면 `preventDefault`가 무시된다.
  useEffect(() => {
    if (!canZoom || !zoomBox) return;
    let startD = 0;                       // 두 손가락이 닿은 순간의 거리(0이면 손짓이 없다)
    const spread = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midX = (t) => (t[0].clientX + t[1].clientX) / 2;
    const midY = (t) => (t[0].clientY + t[1].clientY) / 2;
    const onTouchStart = (e) => {
      if (e.touches.length === 2) { startD = spread(e.touches); liveBegin(midX(e.touches), midY(e.touches)); }
    };
    const onTouchMove = (e) => {
      if (!startD || e.touches.length !== 2) return;
      if (gestureRef.current) return;     // 사파리 — 위 효과가 이미 같은 손짓을 받고 있다
      const d = spread(e.touches);
      if (!d) return;
      // 브라우저가 이 손짓을 이미 스크롤로 집어삼켰으면 취소할 수 없다(그때는 그냥 둔다).
      if (e.cancelable) e.preventDefault();
      liveScale(d / startD, midX(e.touches), midY(e.touches));
    };
    // 손가락이 둘 미만이 되는 순간 커밋한다 — 사파리는 `gestureend`가 먼저 커밋하고
    // 여기는 아무 일도 안 하게 된다(liveCommit은 한 번만 먹는다).
    const onTouchEnd = (e) => { if (e.touches.length < 2) { startD = 0; liveCommit(); } };
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;   // 그냥 휠은 스크롤 그대로 — 긴 PDF를 읽는 길이다
      e.preventDefault();                     // 안 막으면 브라우저가 페이지를 확대한다
      // 줄 단위(파이어폭스)·쪽 단위로 오는 휠을 픽셀로 맞춘다
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomTo(zoomRef.current * Math.exp(-dy * WHEEL_ZOOM_K), e.clientX, e.clientY);
    };
    const opt = { passive: false };
    zoomBox.addEventListener('touchstart', onTouchStart);
    zoomBox.addEventListener('touchmove', onTouchMove, opt);
    zoomBox.addEventListener('touchend', onTouchEnd);
    zoomBox.addEventListener('touchcancel', onTouchEnd);
    zoomBox.addEventListener('wheel', onWheel, opt);
    return () => {
      // 통이 바뀌면(파일이 바뀌었다) 손짓도 거기서 끝난 것이다. 세션을 남겨 두면
      // liveBegin이 "이미 돌고 있다"고 보고 다음 손짓이 영영 안 열린다.
      pinchRef.current = null; liveStrip();
      zoomBox.removeEventListener('touchstart', onTouchStart);
      zoomBox.removeEventListener('touchmove', onTouchMove, opt);
      zoomBox.removeEventListener('touchend', onTouchEnd);
      zoomBox.removeEventListener('touchcancel', onTouchEnd);
      zoomBox.removeEventListener('wheel', onWheel, opt);
    };
  }, [canZoom, zoomBox, zoomTo, liveBegin, liveScale, liveCommit, liveStrip]);
  const timerRef = useRef(null);
  const settleRef = useRef(null);
  const go = useCallback((d) => {
    const next = canNav ? gallery[gi + d] : null;
    if (!next) return;   // 끝에서는 멈춘다 — 빙글빙글 돌면 몇 장인지 감을 잃는다
    setCur(next); setUrl(null); setText(null); setError(null); setHtmlReady(false);
    setFrameReady(false); setTimedOut(false); setPdfSrc(null); setOfficeBlob(null);
    // 앞 파일이 걸어 둔 것들 — 남겨 두면 다음 파일의 화면을 건드린다(감사 2026-09-13).
    // 특히 settle 타이머는 새 틀이 뜨지도 않았는데 스켈레톤을 걷어 버린다.
    // 배율은 ref도 같이 되돌린다 — 손짓 중간에 넘겼을 때 다음 계산이 앞 사진의 배율을
    // 보면 안 된다. 붙잡아 둔 기준점(anchorRef)도 앞 사진의 것이라 버린다. 손짓이 돌고
    // 있었다면 **라이브 transform까지 걷는다** — 남겨 두면 다음 사진이 늘어난 채로 열린다.
    clearTimeout(settleRef.current); setBlobSrc(null);
    pinchRef.current = null; liveStrip();
    anchorRef.current = null; zoomRef.current = ZOOM_MIN; setZoom(ZOOM_MIN);
    // 층 크기는 그림 크기가 정한다 — 앞 사진의 값을 들고 있으면 다음 사진이 그 비율로 선다.
    setNatural(null);
  }, [canNav, gallery, gi, liveStrip]);
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
      // 두 번 누르면 2배↔맞춤 — 폰에서 손가락을 오므리지 않고 한 번에 키우는 길이고,
      // 머리줄의 `100%` 버튼을 걷은 뒤로는 **맞춤으로 돌아오는 길**이기도 하다.
      const zoomed = zoom > ZOOM_MIN;
      // 그림이 칸에 맞춰지는 배수. `Math.min(…, 1)`은 작은 그림을 배율 1에서 늘리지
      // 않으려는 것이다(예전 `max-w-full max-h-full`과 같은 뜻).
      const fit = natural?.w && natural?.h && boxSize?.w && boxSize?.h
        ? Math.min(boxSize.w / natural.w, boxSize.h / natural.h, 1)
        : 0;
      // 아직 못 쟀으면 층 크기를 주지 않는다 — 그때는 통이 `stretch`라 층이 칸을 채운다.
      const layerStyle = fit > 0
        ? { width: natural.w * fit * zoom, height: natural.h * fit * zoom }
        : undefined;
      return (
        // 통은 그냥 스크롤 통이다. **여기에 flex를 두지 않는다** — `justify-center`인 통에서
        // 내용이 넘치면 시작 쪽(왼쪽·위)이 잘려서 거기로 스크롤할 수가 없다(§6-29-z-13).
        // 가운데 맞추기는 안쪽 감싸개가 한다.
        <div
          ref={setZoomBox}
          // 확대했을 때만 **끌어서 민다**(usePanDrag) — 손가락은 브라우저가 알아서 밀지만
          // 마우스에는 그런 것이 없다. `select-none`은 끌 때 글자가 잡히지 않게.
          {...(zoomed ? panProps : {})}
          // `touch-action`에서 브라우저 확대를 뺀다 — 두 손가락은 우리가 받는다(위 효과).
          // 안 빼면 브라우저가 그 손짓을 자기 것으로 집어삼켜 `touchmove`가
          // `cancelable: false`로 오고, `preventDefault`가 아무 일도 하지 않는다.
          // 밀기(pan-x·pan-y)는 그대로 두고, 더블탭 확대는 어차피 여기서도 꺼진다.
          // `place-content: safe center` — 내용이 칸보다 작으면 가운데, 넘치면 **시작 쪽에
          // 붙인다.** 그냥 `center`로 두면 넘친 내용의 왼쪽·위가 잘려 거기로 스크롤할 수가
          // 없다(§6-29-z-13에서 실제로 그랬다) — `safe`가 그 경우에만 `start`로 떨어뜨린다.
          // 이게 있어야 아래 층을 **그림 크기**로 둘 수 있다(가운데 맞추기를 여백이 아니라
          // 격자가 하므로 스크롤 셈은 여전히 '내용 왼쪽 위 = 0'이다).
          style={{ touchAction: 'pan-x pan-y', display: 'grid', placeContent: fit > 0 ? 'safe center' : 'stretch' }}
          // `overscroll-contain` — 끝까지 민 뒤에도 계속 밀면 스크롤이 **뒤 화면으로
          // 넘어간다**(스크롤 체이닝). 그러면 사진은 그대로인데 뒤가 움직여서 다음 탭이
          // 엉뚱한 데 떨어진다. 이 통에서 끝낸다.
          className={`w-full h-full select-none ${zoomed
            ? `overflow-auto overscroll-contain ${panning ? 'cursor-grabbing' : 'cursor-grab'}`
            : 'overflow-hidden'}`}
          onDoubleClick={(e) => zoomTo(zoomed ? ZOOM_MIN : ZOOM_TAP, e.clientX, e.clientY)}
        >
          {/* 배율은 **맞춤 크기의 배수**이고, 층은 **그림만큼**이다(사용자 지적 2026-09-17 —
              세로로 긴 표를 키우면 "아래·오른쪽으로 빈 자리가 스크롤 범위에 들어갔다").
              예전에는 층을 통의 `zoom × 100%`로 두고 사진을 `object-contain`으로 담았는데,
              그러면 사진 **요소**가 층만큼 커지고 실제 그림은 그 안에서 레터박스된다 —
              배율을 올리면 **그 여백까지 같은 배수로 커져** 빈 종이를 스크롤하게 된다.
              그림 비율이 창 비율과 다를수록 심하다.
              그래서 층을 **칸에 맞춘 크기 × 배율**로 준다(위 `fit`). 픽셀이어야 한다 —
              가운데 맞추기를 격자에 맡기는 순간 트랙이 내용 크기가 되어 퍼센트가 순환이
              되고 층이 0으로 무너진다(헤드리스로 재어 확인했다).
              **사진 자체에 `width: zoom×100%`를 주는 옛 길로 돌아가지 마세요** — 그건 칸
              너비의 배수라 세로로 긴 사진이 1.05배에서 통째로 튀어나간다(§6-29-z-13-a).
              `data-zoom-layer` — 손짓이 도는 동안 **여기에** transform이 걸린다(위 liveBegin).
              통이 아니라 이 감싸개여야 스크롤은 그대로 두고 내용만 늘어난다. */}
          <div data-zoom-layer="" style={layerStyle}>
            <SmartImage
              key={cur.id}
              src={imgSrcOf(cur) || url} alt={cur.name}
              onReady={(img) => setNatural({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 })}
              wrapperClassName="w-full h-full flex items-center justify-center"
              /* **`max-w-full max-h-full`만 주면 안 된다.** 그러면 `<img>`가 제 원래 크기까지만
                 커져서, 층이 그보다 커진 순간부터 그림이 안 따라온다 — 작은 그림은 손짓 중
                 `transform`으로 커졌다가 손을 떼면 **도로 줄고**(사용자 지적 2026-09-17 —
                 "확대되면 되는거지 다시 축소되는 현상"), 큰 그림도 층과 몇십 픽셀 어긋나
                 그만큼 빈자리가 스크롤 범위에 남는다. 층이 이미 그림 비율이라 `w-full h-full`
                 이면 `object-contain`은 딱 맞게 채운다. */
              className="w-full h-full object-contain rounded-md"
              skeletonClassName="w-72 h-72" loadingText="미리보기를 준비하고 있어요"
            />
          </div>
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
      //
      // **폰·태블릿에는 편집 주소를 싣지 않는다**(사용자 신고 2026-09-18 · 스크린샷).
      // 아이폰 사파리는 iframe 안 구글 쿠키를 분할해서, 계정 **목록**은 읽히는데
      // (화면에 "로그인된 계정: …"까지 떴다) 그 계정으로 문서를 열 자격은 안 온다 —
      // 읽기 화면도 아니고 **'액세스 권한 필요'** 다. 같은 사본을 로그인 없이 받으면
      // `/embed`도 `/edit`도 멀쩡히 열리고(주소·공유 설정은 문제가 없다), 데스크톱
      // 크롬에서는 편집까지 된다(사용자 확인). 즉 관리자에게만, 폰에서만 나던 길이다.
      // 보기 주소(`previewCopyUrl`)는 로그인을 아예 쓰지 않아 여기서 늘 뜬다.
      // 폰에서 고치는 길은 머리줄의 '구글 문서에서 편집'(새 탭 = 1차 쿠키) 하나다.
      const src = (canEditCopy && !isMobile && copyEditUrl(cur, { email: myEmail })) || previewCopyUrl(cur);
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
          blob={pdfSrc.blob} src={pdfSrc.src} zoom={zoom}
          // 손가락·휠을 받을 통은 PdfView 안쪽의 스크롤 칸이다 — 그 노드를 받아 온다.
          // **`setZoomBox`를 그대로 넘긴다**(상태 설정 함수라 매번 같은 함수다) — 인라인
          // 화살표로 넘기면 PdfView가 다시 그려질 때마다 ref 콜백이 null→노드로 다시
          // 불려서 리스너가 계속 붙었다 떨어진다.
          onBox={setZoomBox}
          onToggleZoom={(px, py) => zoomTo(zoomRef.current > ZOOM_MIN ? ZOOM_MIN : ZOOM_TAP, px, py)}
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
    <div
      ref={dimRef}
      // 누른 곳도 딤이어야 닫는다 — 사진을 끌다가 딤에서 손을 떼면 click이 두 곳의
      // **공통 조상**(이 딤)에서 나서 창이 제멋대로 닫혔다(업무 창과 같은 판정).
      onMouseDown={(e) => { downOnDim.current = e.target === dimRef.current; }}
      onClick={(e) => { if (e.target === dimRef.current && downOnDim.current) onClose(); }}
      className={`fixed inset-0 z-[100] bg-black/70 flex items-center justify-center animate-in fade-in duration-150 ${wide ? 'p-0' : 'p-0 md:p-6'}`}>
      <div
        onClick={e => e.stopPropagation()}
        // 높이를 확정해 둔다 — max-h만 주면 안쪽 h-full(미리보기 영역)이 기준을 못 잡아
        // 파일 종류마다 크기가 들쭉날쭉해지고 모바일에서 잘려 보였다.
        // 넓히기는 크기가 바뀌는 일이라 §4.2의 "transform/opacity만"에서 한 칸 비켜난다.
        // 겹치는 요소가 이 창 하나뿐이고, 넓힐 길이 크기 말고는 없다(scale로 늘리면 글자까지
        // 커진다). 이징은 앱에 하나뿐인 --ease-out-quint를 쓴다.
        // `tap-zoom-lock` — 더블탭으로 **브라우저가 페이지를 확대하는 것**을 끊는다(§6-29-z-14).
        // 사진을 두 번 눌러 확대하는 자리라 이게 없으면 우리 배율과 브라우저 배율이 함께
        // 걸리고, 되돌려도 창이 보이는 영역 밖에 남아 "버튼이 안 눌린다"가 된다.
        className={`tap-zoom-lock bg-canvas border border-line shadow-elevated flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-[max-width,height,border-radius] ${isMobile
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
          {/* 확대 버튼(`－ 100% ＋`)은 걷었다 — 사용자 결정 2026-09-14. 사진·PDF는 손가락으로
              오므리거나 컨트롤/⌘+휠로 키우고, 두 번 누르면 2배↔맞춤이다(위 ZOOM_MIN 머리말). */}
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
