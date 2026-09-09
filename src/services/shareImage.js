import { failText } from './errorText.js';
import { isKakaoInApp } from '../utils.js';

// ============================================================================
// 종이를 그림·PDF로 내보내기 — 한 벌 (2026-09-09)
// ----------------------------------------------------------------------------
// 순모임 가이드가 저 혼자 하던 일을 여기로 옮겼고 네 자리가 같이 쓴다:
// 가이드 · 예배 노트 · QT 묵상 · 주보(PDF). 옮기면서 사용자가 실제로 겪은 세 가지를
// 고쳤다 — "이미지로 저장을 했을 때 저장도 안되고 카카오톡으로 공유 창도 안 열림"
// (2026-09-09):
//
//  ① **라이브러리를 누를 때 받으면 공유가 거부된다.** `navigator.share`는 사용자
//     제스처가 살아 있는 동안만 열린다(크롬은 약 5초). 예전에는 누른 **뒤에**
//     html2canvas 청크를 네트워크로 받고, 굽고, 그 다음에 share를 불러서 느린 회선에서는
//     그 창이 이미 닫혀 `NotAllowedError`가 났다. 이제 종이가 화면에 서는 순간
//     `preloadExport()`로 미리 받아 둔다 — 누르는 순간 남는 것은 굽는 시간뿐이다.
//  ② **캔버스가 너무 커서 `toBlob`이 빈 값을 준다.** 세로로 긴 종이에 배율 3을 곱하면
//     1080×6000이 되고, iOS 사파리는 캔버스 화소 상한(약 16.7M = 4096²)을 넘으면 조용히
//     null을 돌려준다. 배율을 그 상한 안으로 깎는다(`MAX_PIXELS`).
//  ③ **실패를 사람에게 말하지 않았다.** 공유가 거부되면 console에만 찍고 내려받기로
//     떨어졌는데, **카카오 인앱 웹뷰는 내려받기도 막혀서** 정말 아무 일도 일어나지
//     않았다. 이제 마지막 갈래까지 실패하면 토스트를 띄운다.
//
// **왜 주보는 이미지 두 장이 아니라 PDF인가**(사용자 결정 2026-09-09). `share({files})`는
// 파일 여러 개를 받고 아이폰 사파리·안드로이드 크롬에서는 두 장이 한 번에 간다. 그런데
// 카카오 인앱 웹뷰에는 공유 시트가 아예 없어서(navigator.share 없음) 내려받기로 떨어지고
// 그것도 막혀 있다 — 워크스페이스를 카톡 링크로 여는 사람이 많아 실제로 걸리는 구멍이다.
// PDF는 한 파일이라 어느 갈래로 가도 한 번에 하나로 간다. **PDF 안의 글자는 그림이다**
// (한글 글꼴을 심으면 600KB를 더 받아야 해서 안 심었다) — 복사·검색은 안 된다.
//
// 토스트를 부르는 쪽은 이 모듈이 아니라 화면이다(`showToast`를 인자로 받는다) —
// 서비스 계층이 컴포넌트를 가져오면 노드 검사에서 이 파일을 못 읽는다.
// ============================================================================

// 내려받는 그림의 가로 화소. 종이는 화면에서 최대 560px이라 여기서 약 2배다.
export const EXPORT_W = 1080;

// 캔버스 화소 상한 — iOS 사파리의 4096×4096. 넘으면 toBlob이 null이다.
const MAX_PIXELS = 4096 * 4096;

let canvasPromise = null;
let pdfPromise = null;

// 종이가 화면에 서면 부른다. **누르기 전에** 청크를 받아 두는 것이 목적이고, 두 번
// 불러도 같은 약속을 돌려준다. 실패는 삼킨다 — 그때는 누를 때 다시 받는다.
export function preloadExport({ pdf = false } = {}) {
  if (!canvasPromise) canvasPromise = import('html2canvas').catch(() => { canvasPromise = null; return null; });
  if (pdf && !pdfPromise) pdfPromise = import('jspdf').catch(() => { pdfPromise = null; return null; });
}

async function html2canvas() {
  if (!canvasPromise) canvasPromise = import('html2canvas');
  const mod = await canvasPromise;
  if (!mod?.default) { canvasPromise = null; throw new Error('그림 만드는 도구를 받지 못했어요'); }
  return mod.default;
}

// 화면에 서 있는 그 종이를 그대로 캔버스로. background는 종이 바탕색이다(투명하게
// 두면 카카오톡에서 검은 종이가 된다).
async function nodeToCanvas(node, background) {
  const draw = await html2canvas();
  const width = node.offsetWidth || 560;
  const height = node.offsetHeight || 800;
  // 원하는 배율(1080 기준)과 화소 상한이 허락하는 배율 중 작은 쪽. 1보다 작아지지는
  // 않게 둔다 — 아주 긴 종이는 가로가 좁아지더라도 글자가 읽혀야 한다.
  const want = EXPORT_W / width;
  const cap = Math.sqrt(MAX_PIXELS / (width * height));
  const scale = Math.max(1, Math.min(want, cap));
  return draw(node, { scale, backgroundColor: background, useCORS: true, logging: false });
}

export async function nodeToPng(node, background) {
  const canvas = await nodeToCanvas(node, background);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('빈 그림');
  return blob;
}

// 종이 여럿 → PDF 한 파일. 쪽마다 그 종이의 비율을 그대로 쓴다(A4에 억지로 맞추면
// 위아래에 흰 띠가 생기거나 글자가 잘린다).
export async function nodesToPdf(nodes, background) {
  const canvases = [];
  for (const node of nodes) {
    if (!node) continue;
    canvases.push(await nodeToCanvas(node, background));
  }
  if (!canvases.length) throw new Error('빈 종이');
  if (!pdfPromise) pdfPromise = import('jspdf');
  const { jsPDF } = await pdfPromise;
  let doc = null;
  for (const c of canvases) {
    const format = [c.width, c.height];
    const orientation = c.width > c.height ? 'landscape' : 'portrait';
    if (!doc) doc = new jsPDF({ unit: 'px', format, orientation, compress: true });
    else doc.addPage(format, orientation);
    doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, c.width, c.height);
  }
  return doc.output('blob');
}

// 이 화면이 **홈 화면에 추가된 앱(PWA standalone)** 인가. iOS는 그 모드에서
// `a[download]`가 아무 일도 하지 않는다(카카오 인앱과 같은 증상) — 새 탭으로 띄워야
// 길게 눌러 저장할 수 있다. 사용자 보고 2026-09-09: "모바일에서 PDF로 공유, 이미지로
// 저장 이거 다 안돼. PWA 쪽이고 뭐든 간에... 데스크톱 쪽은 되는데".
export function isStandalone() {
  try {
    return !!(window.navigator?.standalone
      || window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.matchMedia?.('(display-mode: minimal-ui)')?.matches);
  } catch { return false; }
}

// 보내기·저장 사다리. 여기까지 오면 파일은 이미 만들어져 있다.
//   ① `navigator.share` — **있으면 그냥 부른다**
//   ② 내려받기(a[download]) — 카카오 인앱·PWA에서는 막혀 있으므로 건너뛴다
//   ③ 둘 다 안 되면 `'overlay'`를 돌려준다 — 부르는 쪽이 그림을 화면에 띄운다(API가 필요 없다)
// 돌려주는 값은 **무엇이 일어났는지**다: 'shared' | 'aborted' | 'downloaded' | 'overlay'.
// 예전에는 참/거짓이었고, 실패하면 조용히 끝나서 사용자에게는 "아무 일도 안 일어남"이었다.
//
// **`canShare`로 문을 잠그지 않는다**(2026-09-09에 고친 자리). 예전에는
// `if (navigator.canShare?.({files}))`로 감싸서, `canShare`가 없는 판(iOS의 어떤
// 버전대)이나 그 판정이 거짓을 주는 경우에 **share를 아예 부르지 않고** 내려받기로
// 떨어졌다 — 그리고 그쪽은 PWA·카카오 인앱에서 막혀 있어서 정말 아무 일도 일어나지
// 않았다("모바일에는 이미지 공유, PDF 공유가 모두 안 되고 있어"). 지금은 share가 있으면
// 부르고, 거부하면 그 이름을 물고 다음 갈래로 간다. canShare는 **참고만** 한다.
export async function shareOrSave(files, { toast, what = '파일을 내보내지 못했어요', onOverlay } = {}) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return 'overlay';
  const blocked = isKakaoInApp(navigator.userAgent) || isStandalone();
  let why = '';   // 공유가 거부된 이유 — 마지막까지 안 되면 이것을 사람에게 말한다

  if (typeof navigator.share === 'function') {
    // canShare가 **거짓이라고 말해도** 한 번은 해 본다 — 그 판정이 파일 공유를 지원하는
    // 브라우저에서도 거짓을 주는 것을 실기기에서 겪었다. 거부는 아래에서 잡는다.
    try {
      await navigator.share({ files: list });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'aborted';   // 사용자가 시트를 닫았다 — 성공과 같다
      // **오류가 아니라 다음 갈래로 가는 단계다** — console.error로 찍으면 '콘솔 오류 0'
      // 검사가 이것을 회귀로 잡는다(합성 클릭에는 제스처가 없어 검사에서 늘 여기 온다).
      // NotAllowedError = 누른 뒤 시간이 너무 흘렀다(미리 굽기가 그것을 막는다).
      console.warn('[shareImage] 공유 시트가 열리지 않아 다음 갈래로:', e?.name, e?.message || e);
      why = e?.name || '';
    }
  }

  // 내려받기는 **막히지 않은 브라우저에서만** 시도한다. 막힌 곳에서 a.click()을 부르면
  // 아무 일도 안 하고 끝나서, 우리는 성공한 줄 알고 다음 갈래로 가지 않았다.
  if (!blocked) {
    let done = false;
    for (const file of list) {
      const href = URL.createObjectURL(file);
      try {
        const a = document.createElement('a');
        if (!('download' in a)) continue;
        a.href = href;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        done = true;
      } finally {
        setTimeout(() => URL.revokeObjectURL(href), 8000);
      }
    }
    if (done) return 'downloaded';
  }

  // 마지막 갈래 — 화면에 띄운다. 브라우저 API가 필요 없으니 어디서든 된다.
  if (onOverlay) { onOverlay(list); return 'overlay'; }
  if (toast) {
    toast(failText(what, { human: why ? `공유 창이 열리지 않았어요 (${why})` : '이 브라우저에서는 저장할 수 없어요' }));
  }
  return 'overlay';
}
