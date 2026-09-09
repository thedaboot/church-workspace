import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { preloadExport, nodeToPng, nodesToPdf, shareOrSave } from '../services/shareImage.js';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 종이 하나(또는 두 쪽)를 **미리 구워 두고** 누르면 바로 보내는 훅 (2026-09-09)
// ----------------------------------------------------------------------------
// 사용자가 세 번 겪은 자리다. 원인이 셋이었고 셋 다 다른 곳에 있었다:
//   ① 누를 때 라이브러리를 받아 공유 자격을 잃던 것 → `preloadExport`(shareImage)
//   ② **누를 때 굽느라 그 자격을 또 잃던 것** → 이 훅이 미리 굽는다(아래 BAKE_DELAY).
//      폰에서는 긴 종이를 html2canvas가 그리는 데 몇 초가 걸리고 그 사이 iOS가 자격을
//      거둬 간다. 데스크톱은 빨라서 창 안에 들어왔다 — 그래서 "데스크톱은 되는데"였다
//   ③ **`canShare`가 없으면 `share`를 아예 안 부르던 것** → shareImage.shareOrSave가
//      이제 share가 있으면 부른다. 그리고 어느 갈래도 안 되면 **그림을 화면에 띄운다**
//      (`overlay`) — 브라우저 API가 필요 없으니 카카오 인앱·PWA에서도 된다
//
// 그래서 이 훅이 돌려주는 것은 넷이다: `share`(누르는 자리) · `busy` · `ready`(미리
// 구워졌나) · **`overlay`**(마지막 갈래의 화면 — 부르는 쪽이 한 줄로 그린다).
//
// PDF는 화면에 띄울 수 없으므로 **그때는 쪽마다 그림으로 바꿔** 띄운다(사용자가 고른
// PDF 한 파일이 안 되는 자리에서, 아무것도 안 되는 것보다 두 장이 보이는 쪽이 낫다).
// ============================================================================

// 종이가 서고 이만큼 뒤에 굽기 시작한다 — 진입 모션·글꼴이 앉을 시간을 준다.
// 이보다 짧으면 모션 중간 모습이 그림에 박히고, 길면 빨리 누른 사람이 옛 길로 간다.
const BAKE_DELAY = 700;

export function useSheetShare({ refs, key, background, kind = 'png', fileName, what }) {
  const blobRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  // 마지막 갈래로 띄우는 것 — 그림들 또는 **왜 안 됐는지**.
  // 토스트로만 말하면 폰에서 놓친다(사용자가 세 번 "안 된다"고 알려 준 뒤로 이렇게 바꿨다) —
  // 전면 화면이라 못 보고 지나칠 수 없고, 다음 보고에 원인이 그대로 실려 온다.
  const [shown, setShown] = useState(null);
  const pdf = kind === 'pdf';

  const nodes = useCallback(() => (refs || []).map(r => r?.current).filter(Boolean), [refs]);

  const bake = useCallback(async () => {
    const list = nodes();
    if (!list.length) return null;
    return pdf ? nodesToPdf(list, background) : nodeToPng(list[0], background);
  }, [nodes, background, pdf]);

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

  // 마지막 갈래 — 그림으로 띄운다. PDF는 못 띄우므로 쪽마다 PNG로 다시 굽는다.
  const overlayFrom = useCallback(async (files) => {
    if (!pdf) { setShown(files.map(f => ({ url: URL.createObjectURL(f), name: f.name }))); return; }
    try {
      const pages = [];
      for (const node of nodes()) {
        const png = await nodeToPng(node, background);
        pages.push({ url: URL.createObjectURL(png), name: `${fileName} ${pages.length + 1}쪽.png` });
      }
      setShown(pages);
    } catch (e) {
      console.error('[share] 그림으로도 띄우지 못했어요:', e);
      setShown([{ error: `${e?.name || '오류'} — ${e?.message || e}` }]);
    }
  }, [pdf, nodes, background, fileName, what]);

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
      await shareOrSave([new File([blob], name, { type })],
        { toast: showToast, what, onOverlay: overlayFrom });
    } catch (e) {
      console.error(`[share] ${what}:`, e);
      // **화면에 띄운다** — 토스트는 놓치기 쉽고, 무엇이 막혔는지가 다음 걸음의 재료다
      setShown([{ error: `${e?.name || '오류'} — ${e?.message || e}` }]);
    } finally { setBusy(false); }
  }, [busy, bake, pdf, fileName, what, overlayFrom]);

  const close = useCallback(() => {
    setShown(prev => { (prev || []).forEach(p => p.url && URL.revokeObjectURL(p.url)); return null; });
  }, []);

  // 그림 한 판. **길게 눌러 저장하는 것 말고는 길이 없는 자리**라 그 한 줄을 적는다 —
  // §8이 금지하는 '사용법 안내'와 다르다: 여기서는 그것이 유일한 조작이고, 안 적으면
  // 그림만 뜨고 무엇을 해야 할지 알 수 없다.
  const failed = !!shown?.[0]?.error;
  const overlay = useMemo(() => (shown ? createPortal(
    <div className="sheet-save fixed inset-0 z-[120] flex flex-col bg-black/80 dc-pop"
      onClick={close} role="dialog" aria-label={failed ? '내보내지 못한 이유' : '저장할 그림'}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
        <p className="text-[12px] text-white/80">
          {failed ? what : '그림을 길게 눌러 저장하거나 공유할 수 있어요'}
        </p>
        <button type="button" onClick={close} aria-label="닫기"
          className="p-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition active:scale-95">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 flex flex-col items-center gap-4">
        {shown.map((p, i) => (p.error ? (
          // 원인을 그대로 보여 준다 — 사람에게는 낯선 글자지만 이 자리에서 막힌 것을
          // 알려 주려면 이름이 있어야 한다(§8의 '실패 문구에 기술 용어 금지'는 **평소**
          // 문구의 규칙이고, 여기는 개발자에게 알려 달라고 부탁하는 자리다)
          <div key={i} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] rounded-[10px] bg-surface p-4">
            <p className="text-[13px] font-bold text-fg">{what}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted break-words">{p.error}</p>
            <p className="mt-2 text-[11px] text-fg-faint">이 줄을 그대로 개발자에게 알려주세요.</p>
          </div>
        ) : (
          <img key={p.url} src={p.url} alt={p.name}
            className="block w-full max-w-[560px] rounded-[10px] shadow-elevated"
            onClick={(e) => e.stopPropagation()} />
        )))}
      </div>
    </div>, document.body) : null), [shown, close, failed, what]);

  return { share, busy, ready, overlay };
}
