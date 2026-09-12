import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from './media.jsx';
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
export function PdfView({ blob = null, src = null, zoom = 1, onError }) {
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
        if (!host) throw new Error('미리보기 자리를 찾지 못했어요');
        host.replaceChildren();

        // 가로 폭에 맞춰 그린다(화면 배율 반영 — 모바일에서 흐릿하지 않게).
        // 쪽이 쌓이면 세로 스크롤바가 생겨 내용 폭이 그만큼 줄어든다 → 미리 비워둔다.
        // 확대는 **그릴 폭 자체**를 늘리는 것이다. 넘치는 만큼은 바깥 통이 좌우로 민다.
        const cssWidth = Math.max(240, ((host.clientWidth || boxW) - 16) * zoom);
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
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${Math.floor(viewport.height * (cssWidth / pxWidth))}px`;
          canvas.className = 'block mx-auto mb-2 rounded-md border border-line bg-white shadow-soft';
          host.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (!alive) return;
          setDrawn(n);
          if (n === Math.min(FIRST_CHUNK, total)) setStatus('ready');
          // 나머지 쪽은 한 박자 쉬며 그려 스크롤이 끊기지 않게
          if (n >= FIRST_CHUNK) await new Promise(r => setTimeout(r, 0));
        }
        if (alive) setStatus('ready');
      } catch (e) {
        console.error('[preview] PDF 렌더 실패:', e);
        if (alive) { setStatus('error'); errRef.current?.(e); }
      }
    })();

    return () => { alive = false; if (doc) doc.destroy?.(); };
  }, [blob, src, boxW, zoom]);

  return (
    <div className="relative w-full h-full">
      {/* scrollbar-gutter: 스크롤바 자리를 처음부터 비워 폭이 흔들리지 않게.
          미지원 브라우저에서도 overflow-x-hidden으로 가로 스크롤은 생기지 않는다. */}
      <div
        ref={hostRef}
        // 확대했을 때만 좌우로 민다 — 배율 1에서는 넘칠 것이 없고, 가로 스크롤이
        // 열려 있으면 세로로 훑다가 옆으로 미끄러진다.
        className={`w-full h-full overflow-y-auto [scrollbar-gutter:stable] ${zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'} ${status === 'ready' ? '' : 'opacity-0'}`}
      />
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
