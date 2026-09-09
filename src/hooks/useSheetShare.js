import { useCallback, useEffect, useRef, useState } from 'react';
import { preloadExport, nodeToPng, nodesToPdf, shareOrSave } from '../services/shareImage.js';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';

// ============================================================================
// 종이 하나(또는 두 쪽)를 **미리 구워 두고** 누르면 바로 보내는 훅 (2026-09-09)
// ----------------------------------------------------------------------------
// 사용자 보고 2026-09-09: "모바일에서 PDF로 공유, 이미지로 저장 이거 다 안돼. PWA
// 쪽이고 뭐든 간에... 데스크톱 쪽은 되는데 이게 안 되네. 주보도 예배 노트도, 묵상 노트도."
//
// **왜 데스크톱만 되는가.** `navigator.share`는 사용자 제스처가 살아 있는 동안만 열린다.
// 앞선 고침(shareImage `preloadExport`)은 **라이브러리 받는 시간**만 걷어냈는데, 남은
// **굽는 시간**이 폰에서는 그것보다 길다 — 세로로 긴 종이를 html2canvas가 그리는 데
// 몇 초가 걸리고, 그 사이 iOS는 자격을 거둬 간다(데스크톱은 빨라서 창 안에 들어왔다).
//
// 그래서 **누르기 전에 그림까지 만들어 둔다.** 종이가 화면에 서고 조금 지나면 뒤에서
// 굽고, 버튼은 이미 만들어진 파일을 보내기만 한다 — `share()` 앞에 기다릴 것이 없다.
// 종이 내용이 바뀌면(열쇠가 바뀌면) 구운 것을 버리고 다시 굽는다.
//
// 미리 굽기가 실패하거나 아직 안 끝났으면 **누를 때 굽는다**(예전 길) — 데스크톱은
// 그 길로도 되고, 폰에서는 실패하면 사다리가 내려받기로 떨어져 사람에게 말한다.
//
// `ready`는 화면이 쓰라고 내보낸다 — 버튼을 잠그지는 않는다(굽는 동안 잠기면 "왜 안
// 눌리지"가 된다). 아직 안 구워졌어도 누르면 그 자리에서 굽는다.
// ============================================================================

// 종이가 서고 이만큼 뒤에 굽기 시작한다 — 진입 모션·글꼴이 앉을 시간을 준다.
// 이보다 짧으면 모션 중간 모습이 그림에 박히고, 길면 빨리 누른 사람이 옛 길로 간다.
const BAKE_DELAY = 700;

export function useSheetShare({ refs, key, background, kind = 'png', fileName, what }) {
  const blobRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pdf = kind === 'pdf';

  const bake = useCallback(async () => {
    const nodes = (refs || []).map(r => r?.current).filter(Boolean);
    if (!nodes.length) return null;
    return pdf ? nodesToPdf(nodes, background) : nodeToPng(nodes[0], background);
  }, [refs, background, pdf]);

  useEffect(() => {
    blobRef.current = null;
    setReady(false);
    preloadExport({ pdf });
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const blob = await bake();
        if (alive && blob) { blobRef.current = blob; setReady(true); }
      } catch (e) {
        // 실패해도 조용히 — 누를 때 다시 굽는다. 여기서 토스트를 띄우면 아무것도 누르지
        // 않은 사람에게 실패를 알리는 셈이 된다.
        console.warn('[share] 미리 굽기 실패(누를 때 다시 굽는다):', e);
      }
    }, BAKE_DELAY);
    return () => { alive = false; clearTimeout(t); };
    // key가 종이 내용을 대표한다 — 바뀌면 구운 것을 버린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pdf]);

  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // **미리 구운 것이 있으면 여기서 기다리는 것이 없다** — 그것이 이 훅의 요점이다.
      let blob = blobRef.current;
      if (!blob) {
        blob = await bake();
        if (blob) { blobRef.current = blob; setReady(true); }
      }
      if (!blob) throw new Error('빈 종이');
      const type = pdf ? 'application/pdf' : 'image/png';
      const name = `${fileName}.${pdf ? 'pdf' : 'png'}`;
      await shareOrSave([new File([blob], name, { type })], { toast: showToast, what });
    } catch (e) {
      console.error(`[share] ${what}:`, e);
      showToast(failText(what, e));
    } finally { setBusy(false); }
  }, [busy, bake, pdf, fileName, what]);

  return { share, busy, ready };
}
