// pdf.js 워커 껍데기 — **폴리필을 먼저 실행시키려고만** 있다(pdfPolyfill.js 머리말).
// 워커는 앱과 다른 전역이라 앱 쪽에서 채운 메서드가 따라가지 않는다.
// PdfView가 `?worker&url`로 이 파일을 가리키고 그 주소를 workerSrc에 넣는다.
import './pdfPolyfill.js';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
