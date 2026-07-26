import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from './media.jsx';

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

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (mod) => {
      // 워커는 번들러가 처리하도록 URL로 넘긴다(외부 CDN 사용 안 함)
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
      return mod;
    });
  }
  return pdfjsPromise;
}

// blob: 이미 받아둔 파일(작은 PDF) / src: 주소로 직접 스트리밍(큰 PDF)
export function PdfView({ blob = null, src = null, onError }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [pageCount, setPageCount] = useState(0);
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    if (!blob && !src) return;
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
          ? { data: new Uint8Array(await blob.arrayBuffer()) }
          : { url: src };
        if (!alive) return;
        doc = await pdfjs.getDocument(source).promise;
        if (!alive) return;
        setPageCount(doc.numPages);

        const host = hostRef.current;
        if (!host) return;
        host.replaceChildren();

        // 가로 폭에 맞춰 그린다(화면 배율 반영 — 모바일에서 흐릿하지 않게).
        // 쪽이 쌓이면 세로 스크롤바가 생겨 내용 폭이 그만큼 줄어든다 → 미리 비워둔다.
        const cssWidth = Math.max(240, host.clientWidth - 16);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const total = Math.min(doc.numPages, MAX_PAGES);

        for (let n = 1; n <= total; n++) {
          if (!alive) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
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
        if (alive) { setStatus('error'); onError?.(e); }
      }
    })();

    return () => { alive = false; if (doc) doc.destroy?.(); };
  }, [blob, src, onError]);

  return (
    <div className="relative w-full h-full">
      {/* scrollbar-gutter: 스크롤바 자리를 처음부터 비워 폭이 흔들리지 않게.
          미지원 브라우저에서도 overflow-x-hidden으로 가로 스크롤은 생기지 않는다. */}
      <div
        ref={hostRef}
        className={`w-full h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] ${status === 'ready' ? '' : 'opacity-0'}`}
      />
      {status === 'loading' && (
        <>
          <Skeleton className="absolute inset-0 w-full h-full" />
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
