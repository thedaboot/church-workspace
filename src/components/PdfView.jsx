import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton, usePanDrag } from './media.jsx';
// pdf.js 6이 확인 없이 쓰는 Uint8Array 메서드 채우기 — 없으면 PDF가 한 장도 안 그려진다.
// **워커 쪽에도 따로** 들어가야 한다(pdfWorkerEntry.js가 같은 파일을 먼저 import한다).
import '../services/pdfPolyfill.js';

// ============================================================================
// PDF 미리보기 — 브라우저 내장 뷰어(iframe) 대신 직접 그린다.
// ----------------------------------------------------------------------------
// iOS 사파리(아이폰의 모든 브라우저가 여기 위에서 돈다)는 iframe 안의 PDF를
// **첫 쪽만** 보여준다. 그래서 모바일에서 2쪽부터가 통째로 사라졌다.
// pdf.js로 각 쪽을 캔버스에 그리면 데스크톱·모바일이 똑같이 전 쪽을 보여주고,
// 뷰어의 검은 배경이 번쩍이는 일도 없다.
//
// pdf.js는 무거우므로(수백 KB) PDF를 열 때만 동적으로 불러온다.
// ============================================================================
const MAX_PAGES = 50;          // 이 이상은 앱에서 그리지 않고 '새 탭에서 열기' 안내
const FIRST_CHUNK = 3;         // 먼저 그릴 쪽 수(나머지는 이어서)
// 캔버스 하나의 **실제 픽셀** 가로 상한. 확대는 CSS로 늘리는 것이 아니라 그 배율로
// 다시 그리는 것이라(글자가 뭉개지면 확대하는 뜻이 없다) 상한이 없으면 3배에서
// 쪽마다 수십 MB짜리 캔버스가 쉰 장 쌓인다. 3000이면 1200px 칸을 2.5배로 보는
// 셈이라 눈으로는 또렷하고, 배율 1·dpr 2의 2400에서 크게 벗어나지도 않는다.
const MAX_CANVAS_PX_W = 3000;
// 배율이 **연속**이 된 뒤(사용자 결정 2026-09-14 · FilePreviewModal의 ZOOM_MIN 머리말)
// 그대로는 못 쓴다 — 확대는 CSS로 늘리는 것이 아니라 그 배율로 다시 그리는 것이라
// (§6-29-z-13) 손가락이 움직이는 내내 50쪽을 다시 래스터화하면 폰이 멈춘다.
// 그래서 **손이 멎은 뒤에 한 번만** 다시 그리고, 그 사이에는 이미 그려 둔 캔버스를
// CSS로만 늘려 바로 따라오게 한다(아래 drawZoom). 짧으면 그리기가 겹치고, 길면
// 또렷해질 때까지 기다리는 느낌이 난다.
const ZOOM_SETTLE = 180;
// 쪽 사이 틈. **배율과 같이 커진다** — 손가락 손짓 동안에는 미리보기 창이 쪽을 담은 층에
// `transform: scale`을 먹이는데(FilePreviewModal의 liveBegin), transform은 틈까지 같이
// 늘린다. 여기만 8px로 고정해 두면 손을 떼는 순간 **쪽 수만큼 쌓인 틈 차이가 한꺼번에**
// 스크롤을 밀어 뒤쪽 장에서 화면이 튄다. 그리는 자리와 아래 CSS 확대가 같은 값을 쓴다.
const PAGE_GAP = 8;
// 쪽의 좌우 여백. 그릴 폭이 칸에서 16px을 비워 두므로(아래 cssWidth) 그 절반이 한쪽
// 여백이고, 그것도 **배율을 따라간다.** `mx-auto`로 두면 배율이 커져 쪽이 칸보다 넓어지는
// 순간 여백이 0으로 접혀, 손짓 중의 transform(여백까지 같이 늘린다)과 어긋나 손을 떼는
// 순간 종이가 옆으로 훌쩍 뛴다. 고정으로 주면 커밋된 화면이 **정확히 배율 곱하기**가 된다.
const PAGE_SIDE = 8;

// pdf.js가 주소로 받아 가는 보조 자료. 이 네 칸은 **vite.config.js의 `pdfjsAssets`**가
// node_modules/pdfjs-dist에서 그대로 내준다(dev는 미들웨어, build는 결과물) — 한쪽을
// 바꾸면 짝도 고치세요.
//
// **`cMapUrl`이 없으면 한글이 통째로 사라진다.** 한글 PDF는 글꼴을 CID로 품는데,
// pdf.js는 그 글꼴을 풀 때 `cmaps/Adobe-Korea1-UCS2.bcmap`을 받아야 한다. 못 받으면
// "Ensure that the `cMapUrl` API parameter is provided." 경고 한 줄만 내고 **그 글꼴을
// 버린다** — 숫자·영문은 다른 글꼴이라 남고 한글 자리만 빈 종이가 된다(사용자 신고
// 2026-09-13 · 'TalkFile_1회 학점 라디오대본.pdf'로 재현했다).
// `cMapPacked`는 그 파일들이 텍스트가 아니라 바이너리(.bcmap)라는 뜻이다.
const PDFJS_ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',   // 글꼴을 안 품은 PDF의 기본 14종
  wasmUrl: '/pdfjs/wasm/',                         // 스캔 PDF의 JBIG2·JPEG2000 그림
  iccUrl: '/pdfjs/iccs/',                          // ICC 색 프로필
};

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (mod) => {
      // 워커는 번들러가 처리하도록 URL로 넘긴다(외부 CDN 사용 안 함).
      // pdf.worker를 바로 가리키지 않고 **껍데기**를 지난다 — 그 안에서 폴리필이 먼저
      // 돈다(pdfWorkerEntry.js). `?worker&url`이라야 vite가 그 import까지 묶어 준다.
      const workerUrl = (await import('../services/pdfWorkerEntry.js?worker&url')).default;
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
      return mod;
    });
  }
  return pdfjsPromise;
}

// blob: 이미 받아둔 파일(작은 PDF) / src: 주소로 직접 스트리밍(큰 PDF)
// zoom: 1 = 칸 너비에 맞춤. 그 위는 **그 배율로 다시 그린다**(CSS 확대가 아니다).
// onBox: 스크롤 통(아래 host)을 부르는 쪽에 알린다 — 손가락 오므리기·컨트롤+휠 리스너를
//        거기에 거는 것은 미리보기 창이다(사진 갈래와 한 벌이어야 해서 한곳에 모았다).
//        **매번 같은 함수를 넘겨야 한다** — 인라인 화살표면 다시 그릴 때마다 ref 콜백이
//        null→노드로 다시 불려서 리스너가 계속 붙었다 떨어진다.
// onToggleZoom(px, py): 두 번 눌렀을 때(맞춤 ↔ 2배). 머리줄의 `100%` 버튼을 걷은 뒤로
//        PDF에서 맞춤으로 돌아오는 길이다. 캔버스뿐이라 글자 선택과 부딪히지 않는다.
export function PdfView({ blob = null, src = null, zoom = 1, onBox = null, onToggleZoom = null, onError }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [pageCount, setPageCount] = useState(0);
  const [drawn, setDrawn] = useState(0);
  // 그릴 때 쓸 칸 너비. **이 값이 바뀔 때만** 다시 그린다(아래 ResizeObserver).
  const [boxW, setBoxW] = useState(0);
  // `onError`를 효과의 의존성에 두면 안 된다 — 부르는 쪽이 인라인 화살표로 넘기므로
  // 그 쪽이 한 번 다시 그려질 때마다 새 함수가 되고, 그때마다 이 효과가 통째로 다시
  // 돌아 **PDF를 다시 열고 50쪽을 다시 래스터화**했다(감사 2026-09-13). 내려받기 버튼의
  // 스피너 하나에도 그 일이 벌어졌다. 함수는 ref에 담아 두고 부를 때만 꺼낸다.
  const errRef = useRef(onError);
  errRef.current = onError;
  // 확대한 종이를 마우스로 끌어서 민다(media.usePanDrag 머리말). 사진 쪽과 한 벌이다.
  const { panning, panProps } = usePanDrag();
  // 스크롤 통을 부르는 쪽에도 넘긴다. ref 콜백은 **한 번 만들고 다시 만들지 않는다** —
  // 매 렌더마다 새 함수면 리액트가 null로 한 번 떼었다 다시 붙인다.
  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;
  const setHost = useCallback((el) => { hostRef.current = el; onBoxRef.current?.(el); }, []);
  // 쪽(캔버스)을 담는 층. 통과 따로 두는 이유는 **손짓 동안 여기에 transform이 걸리기**
  // 때문이다(FilePreviewModal의 `data-zoom-layer`) — 통에 걸면 스크롤까지 같이 늘어난다.
  const layerRef = useRef(null);
  // 마지막으로 그린 문서와 칸 너비. 둘 다 그대로면 쪽 크기가 같으므로 비우지 않고
  // 한 장씩 갈아 끼운다(아래 inPlace) — 그래야 다시 그리는 동안 화면이 안 빈다.
  const drawnKeyRef = useRef(null);
  // **실제로 그려 둔 배율.** `zoom`은 손가락을 따라 계속 바뀌지만 다시 그리는 것은
  // 손이 멎은 뒤 한 번뿐이다(위 ZOOM_SETTLE). 둘이 벌어져 있는 동안은 아래 layout
  // effect가 캔버스를 CSS로 늘려 그 차이를 메운다.
  const [drawZoom, setDrawZoom] = useState(zoom);
  // 손가락을 따라가는 **지금** 배율. 그리는 도중에 배율이 바뀌면 그 뒤에 붙는 쪽도 같은
  // 비율로 내보내야 한다 — 안 그러면 쪽마다 폭이 다른 종이가 쌓인다(긴 PDF를 열자마자
  // 오므리면 실제로 그렇게 된다).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (zoom === drawZoom) return;
    const t = setTimeout(() => setDrawZoom(zoom), ZOOM_SETTLE);
    return () => clearTimeout(t);
  }, [zoom, drawZoom]);

  // 그 사이를 메우는 CSS 확대 — 비트맵을 늘리는 것이라 잠깐 부드러워 보였다가, 다시
  // 그리면서 또렷해진다. `useLayoutEffect`인 이유: 부모(미리보기 창)가 같은 커밋에서
  // 스크롤을 옮겨 손가락 가운데를 붙잡는데, 그때 이미 새 크기여야 한다 — 리액트는
  // 자식의 layout effect를 부모보다 먼저 돌리므로 여기가 그 자리다.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || !drawZoom || zoom === drawZoom) return;
    for (const el of layer.children) {
      const base = Number(el.dataset?.cssw);   // 그릴 때 적어 둔 CSS 폭(겹쳐 곱하지 않게)
      if (!base || !el.width) continue;
      // **그 쪽이 그려진 배율에서** 지금 배율까지. 다시 그리는 도중에 배율이 또 바뀌면
      // 층에 두 배율의 쪽이 잠깐 섞여 있으므로(아래 제자리 교체), 쪽마다 제 배율로 곱한다.
      const w = base * (zoom / (Number(el.dataset?.z) || drawZoom));
      el.style.width = `${w}px`;
      el.style.height = `${Math.round(w * (el.height / el.width))}px`;
      el.style.marginBottom = `${PAGE_GAP * zoom}px`;   // 틈도 같이(위 PAGE_GAP)
      el.style.marginLeft = el.style.marginRight = `${PAGE_SIDE * zoom}px`;
    }
  }, [zoom, drawZoom]);

  // 칸 너비가 **실제로** 달라졌을 때만 다시 그린다 — '화면 가득'을 누르면 창이 220ms
  // 동안 넓어지는데, 예전에는 그 전에 잰 폭으로 이미 그려 놓아서 넓힌 창 가운데에
  // 좁은 종이가 그대로 남았다(감사 2026-09-13). 화면을 돌렸을 때도 같았다.
  //  · 24px보다 작은 흔들림은 무시한다 — 스크롤바가 생겼다 사라지는 폭이다.
  //  · 애니메이션이 끝난 뒤 한 번만 재도록 150ms 늦춘다(그 사이 값은 버린다).
  useEffect(() => {
    const host = hostRef.current;
    // 첫 폭은 **바로** 잡는다 — 관찰자를 기다리면 150ms 늦게 그리기 시작한다.
    setBoxW(host?.clientWidth || 1);
    if (!host || typeof ResizeObserver === 'undefined') return;
    let t = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => setBoxW(prev => (Math.abs(host.clientWidth - prev) >= 24 ? host.clientWidth : prev)), 150);
    });
    ro.observe(host);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (!blob && !src) return;
    if (!boxW) return;                 // 첫 측정 전에는 그리지 않는다(폭이 0인 채로 그려진다)
    let alive = true;
    let doc = null;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (!alive) return;
        // 받아둔 파일이 있으면 바이트를 그대로 넘긴다(blob: URL을 다시 받게 하지 않는다).
        // pdf.js는 넘긴 버퍼를 가져가므로 매번 새로 읽어 넘긴다.
        // pdf.js 6부터는 문자열 URL을 그대로 받지 않는다 — { url } 형태여야 한다.
        const source = blob
          ? { ...PDFJS_ASSETS, data: new Uint8Array(await blob.arrayBuffer()) }
          : { ...PDFJS_ASSETS, url: src };
        if (!alive) return;
        doc = await pdfjs.getDocument(source).promise;
        if (!alive) return;
        setPageCount(doc.numPages);

        // 틀이 없으면 그릴 자리가 없다. 조용히 돌아서면 스켈레톤이 영영 남으므로
        // 오류로 알린다(감사 2026-09-13 — '영영 안 걷히는 준비 중' 갈래 하나였다).
        const host = hostRef.current;
        const layer = layerRef.current;
        if (!host || !layer) throw new Error('미리보기 자리를 찾지 못했어요');
        // **화면을 한 번도 비우지 않는다**(사용자 신고 2026-09-17 두 번째 — "확대를 하면
        // 중간중간 프레임이 끊긴 것처럼 하얗게 한 0.01초 끊겼다가 돌아온다"). 예전에는
        // 먼저 `replaceChildren`로 비우고 다시 붙였는데, 비운 순간부터 첫 쪽이 붙을 때까지
        // 종이가 없어 바탕이 드러났다. 같은 문서·같은 칸 너비면 쪽 크기가 이미 같으므로
        // (옛 쪽은 위 CSS 확대로 새 배율만큼 늘려 둔 상태다) **한 장씩 제자리에서 갈아
        // 끼운다** — 다 그린 새 캔버스로 바꾸는 것이라 빈 자리가 한 프레임도 안 생기고,
        // 살아 있는 캔버스는 언제나 쪽 수 그대로라 메모리도 늘지 않는다(그리는 중인 한 장만 더).
        // 칸 너비가 바뀐 때(화면 가득·화면 돌리기)는 쪽 크기 자체가 달라지므로 예전처럼 비운다.
        const prev = drawnKeyRef.current;
        const inPlace = !!prev && prev.doc === (blob || src) && prev.boxW === boxW
          && layer.children.length > 0;
        drawnKeyRef.current = { doc: blob || src, boxW };
        const kept = inPlace ? layer.children.length : 0;   // 이미 화면에 서 있는 쪽 수
        // **비우고 다시 붙일 때만** 보던 자리를 되돌린다. `replaceChildren`로 비우면 높이가
        // 0으로 접혀 스크롤이 맨 위로 튄다 — 배율만 조금 바꿨는데 1쪽으로 돌아갔다.
        // 쪽 높이가 다 같지는 않으니 위치가 아니라 **비율**로 기억하고, 쪽이 쌓일 때마다
        // 그 비율을 다시 맞춘다(다 쌓이기 전에 한 번만 맞추면 엉뚱한 데에 선다).
        // 제자리 교체일 때는 스크롤이 애초에 움직이지 않으므로 손대지 않는다 — 그 사이
        // 사람이 내려 읽은 자리를 도로 끌어올리면 안 된다.
        const frac = (pos, inner, outer) => (inner > outer ? pos / (inner - outer) : 0);
        const keep = {
          y: frac(host.scrollTop, host.scrollHeight, host.clientHeight),
          x: frac(host.scrollLeft, host.scrollWidth, host.clientWidth),
        };
        const keepScroll = () => {
          if (inPlace) return;
          if (keep.y) host.scrollTop = keep.y * Math.max(0, host.scrollHeight - host.clientHeight);
          if (keep.x) host.scrollLeft = keep.x * Math.max(0, host.scrollWidth - host.clientWidth);
        };
        if (!inPlace) layer.replaceChildren();

        // 가로 폭에 맞춰 그린다(화면 배율 반영 — 모바일에서 흐릿하지 않게).
        // 쪽이 쌓이면 세로 스크롤바가 생겨 내용 폭이 그만큼 줄어든다 → 미리 비워둔다.
        // 확대는 **그릴 폭 자체**를 늘리는 것이다. 넘치는 만큼은 바깥 통이 좌우로 민다.
        const cssWidth = Math.max(240, ((host.clientWidth || boxW) - 16) * drawZoom);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // 실제 픽셀에는 상한이 있다(위 MAX_CANVAS_PX_W) — 넘으면 그만큼만 그리고 CSS로 편다
        const pxWidth = Math.min(cssWidth * dpr, MAX_CANVAS_PX_W);
        const total = Math.min(doc.numPages, MAX_PAGES);

        for (let n = 1; n <= total; n++) {
          if (!alive) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: pxWidth / base.width });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          // 이 배율로 그린 CSS 폭을 적어 둔다 — 손가락을 따라가는 CSS 확대(위 layout
          // effect)가 이 값에서 곱한다. 늘어난 폭에서 또 곱하면 배율이 겹쳐 쌓인다.
          canvas.dataset.cssw = String(cssWidth);
          canvas.dataset.z = String(drawZoom);   // 어느 배율에서 그린 쪽인가(위 CSS 확대)
          canvas.className = 'block rounded-md border border-line bg-white shadow-soft';
          // **다 그린 뒤에 끼운다.** 빈 캔버스를 먼저 붙이고 그리면 그 동안 그 자리가
          // 빈 종이라, 쪽마다 하얗게 한 번씩 번쩍인다(위 제자리 교체 머리말).
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (!alive) return;
          // 그리는 중에 배율이 앞서 갔으면 그만큼 미리 늘려 끼운다(위 zoomRef).
          const live = (zoomRef.current || drawZoom) / drawZoom;
          canvas.style.width = `${cssWidth * live}px`;
          canvas.style.height = `${Math.floor(viewport.height * (cssWidth / pxWidth) * live)}px`;
          // 틈·좌우 여백은 배율을 따라간다(위 PAGE_GAP·PAGE_SIDE) — 고정해 두면 손짓 중의
          // transform과 어긋나 손을 뗄 때 종이가 뛴다.
          canvas.style.marginBottom = `${PAGE_GAP * drawZoom * live}px`;
          canvas.style.marginLeft = canvas.style.marginRight = `${PAGE_SIDE * drawZoom * live}px`;
          const old = layer.children[n - 1];
          if (old) layer.replaceChild(canvas, old); else layer.appendChild(canvas);
          setDrawn(Math.max(n, kept));   // 제자리 교체 중에는 옛 쪽도 화면에 서 있다
          keepScroll();
          if (n === Math.min(FIRST_CHUNK, total)) setStatus('ready');
          // 나머지 쪽은 한 박자 쉬며 그려 스크롤이 끊기지 않게
          if (n >= FIRST_CHUNK) await new Promise(r => setTimeout(r, 0));
        }
        if (alive) setStatus('ready');
      } catch (e) {
        // 배율이 또 바뀌어 **취소된** 그리기다(정리에서 doc.destroy를 부르면 그리던 것이
        // 떨어진다) — 손짓 한 번에 여러 번 나는 일이라 조용히 버린다.
        if (!alive) return;
        console.error('[preview] PDF 렌더 실패:', e);
        setStatus('error'); errRef.current?.(e);
      }
    })();

    return () => { alive = false; if (doc) doc.destroy?.(); };
  }, [blob, src, boxW, drawZoom]);

  return (
    <div className="relative w-full h-full">
      {/* scrollbar-gutter: 스크롤바 자리를 처음부터 비워 폭이 흔들리지 않게.
          미지원 브라우저에서도 overflow-x-hidden으로 가로 스크롤은 생기지 않는다. */}
      <div
        ref={setHost}
        {...(zoom > 1 ? panProps : {})}
        // `touch-action`에서 브라우저 확대를 뺀다 — 두 손가락은 미리보기 창이 받아 우리
        // 배율로 돌린다. 안 빼면 브라우저가 그 손짓을 자기 것으로 집어삼켜 `touchmove`가
        // `cancelable: false`로 오고 `preventDefault`가 아무 일도 하지 않는다.
        // 한 손가락 밀기(pan-x·pan-y)는 그대로다 — 긴 PDF를 내려 읽는 기본 조작이다.
        style={{ touchAction: 'pan-x pan-y' }}
        onDoubleClick={onToggleZoom ? (e) => onToggleZoom(e.clientX, e.clientY) : undefined}
        // 확대했을 때만 좌우로 민다 — 배율 1에서는 넘칠 것이 없고, 가로 스크롤이
        // 열려 있으면 세로로 훑다가 옆으로 미끄러진다.
        // `overscroll-contain` — 끝까지 민 뒤에도 계속 밀면 스크롤이 뒤 화면으로 넘어간다.
        // 여기서 끝낸다(첨부 미리보기 창의 사진 통과 같은 판단이다).
        className={`w-full h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable] ${zoom > 1 ? `overflow-x-auto select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}` : 'overflow-x-hidden'} ${status === 'ready' ? '' : 'opacity-0'}`}
      >
        {/* 쪽은 이 층 안에 쌓인다 — 손짓이 도는 동안 미리보기 창이 여기에 transform을
            먹인다(위 layerRef). 통에 걸면 스크롤까지 같이 늘어난다. */}
        <div ref={layerRef} data-zoom-layer="" />
      </div>
      {status === 'loading' && (
        <>
          {/* Skeleton에 absolute를 주면 먹지 않는다(.dc-skeleton이 position: relative를
              박는다 — index.css). 자리는 바깥 span이 잡는다. */}
          <span className="absolute inset-0"><Skeleton className="w-full h-full" /></span>
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted">
            <Loader2 size={14} className="animate-spin" /> 미리보기를 준비하고 있어요
          </span>
        </>
      )}
      {status === 'ready' && pageCount > MAX_PAGES && (
        <p className="absolute bottom-1 inset-x-0 text-center text-[10px] text-fg-faint">
          {MAX_PAGES}쪽까지만 보여줘요 · 전체는 새 탭에서 열기
        </p>
      )}
      {status === 'ready' && drawn < Math.min(pageCount, MAX_PAGES) && (
        <span className="absolute top-1 right-2 text-[10px] text-fg-faint bg-surface/80 rounded px-1.5 py-0.5">
          {drawn}/{Math.min(pageCount, MAX_PAGES)}쪽
        </span>
      )}
    </div>
  );
}
