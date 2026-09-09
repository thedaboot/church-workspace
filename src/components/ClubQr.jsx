import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Link2 } from 'lucide-react';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { CARD_STYLE, BTN, BTN_QUIET, WITH_ICON } from './groupsParts.jsx';

// ============================================================================
// 동아리 가입 신청 QR — 발급 · 카카오톡 공유 · 이미지 저장 · 링크 복사
// ----------------------------------------------------------------------------
// 여는 자리는 동아리 상세의 머리줄이고, 여는 사람은 **그 동아리를 고칠 수 있는
// 사람**(마스터·관리자·그 동아리장 — groups.js canEditClub · 0039 groups_update)이다.
// 부르는 쪽이 그 판정을 하고 여기서는 다시 재지 않는다.
//
// 주소는 `/s/c/<동아리 id>?apply=1`이다. 그 자리(api/share.js type 'c')가 카카오톡이
// 읽는 OG 카드를 그려 주고, 사람은 `/?p=groups&g=<id>&apply=1`로 넘어간다 —
// 로그인이 필요하면 auth.jsx가 그 주소를 기억했다가 로그인 뒤에 되돌린다.
// 모임 화면이 그 값을 읽어 신청까지 한다(views/groupsView.jsx · services/entryQuery.js).
//
// **QR 라이브러리는 열 때 받는다**(lazy import). 이 화면을 여는 사람은 몇 명뿐인데
// 첫 번들에 실으면 모두가 내려받는다 — 성경 데이터·pdf 뷰어와 같은 판단이다.
//
// **QR 카드는 언제나 밝다.** 다크 테마의 어두운 종이에 밝은 모듈로 그리면 반전 코드가
// 되어 못 읽는 리더가 많다. 그래서 종이·글자는 라이트 값으로 못 박고, 모듈만 토큰에서
// 읽는다 — `--app-night`은 라이트·다크가 같은 값이라(#213183) 테마를 바꿔도 카드가
// 흔들리지 않는다. 카드를 감싸는 모달은 여느 화면처럼 테마를 따라간다.
// ============================================================================

// 카드 한 장의 단위(뷰박스). 화면 크기는 CSS가 정하고, 내려받는 그림은 이 값의 2배다.
const CARD_W = 320;
const CARD_H = 380;
const QR_BOX = 240;   // 카드 안에서 QR이 차지하는 한 변(아래 여백 4모듈을 포함한다)
const QUIET = 4;      // 여백 모듈 수 — QR 규격의 최소값이고, 이보다 좁으면 못 읽는 리더가 있다

// 라이트 토큰 값 그대로다(index.css :root) — 위 머리말의 '카드는 언제나 밝다'.
const PAPER = '#ffffff';
const INK = '#191720';
const INK_MUTED = '#6b6675';
const MODULE_FALLBACK = '#213183';   // --app-night

// 그림으로 구운 뒤에는 우리 폰트(SUIT)가 따라가지 않는다 — <img>로 그리는 SVG는
// 페이지의 @font-face를 못 받는다. 그래서 시스템 한글 폰트까지 적어 둔다.
const FONT = "'SUIT Variable', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

const tokenColor = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
};

// 긴 이름은 글자를 줄인다 — 카드 폭을 넘기면 이름이 종이 밖으로 흘러나간다.
const nameSize = (name) => {
  const n = String(name || '').length;
  if (n <= 9) return 21;
  if (n <= 13) return 17;
  return 14;
};

// 카드 아래에 적는 짧은 주소. uuid를 그대로 적으면 두 줄이 되고 읽을 사람도 없다 —
// 어디로 가는 링크인지만 보이면 된다.
const shortUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.host}/s/c/…`;
  } catch { return url; }
};

export function ClubQrModal({ club, onClose }) {
  const [mods, setMods] = useState(null);    // { n, dark: [[r, c], …] }
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const svgRef = useRef(null);

  const url = useMemo(() => `${window.location.origin}/s/c/${club.id}?apply=1`, [club.id]);
  const module = useMemo(() => tokenColor('--app-night', MODULE_FALLBACK), []);

  // Esc로 닫는다(이 화면의 다른 팝오버·모달과 같은 규칙)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 라이브러리는 열 때 받는다. 못 받으면 카드 자리에 실패를 말하고 링크 복사만 남긴다 —
  // 조용히 빈 상자를 세우면 무엇이 잘못됐는지 알 길이 없다(§6-29-e).
  useEffect(() => {
    let alive = true;
    import('qrcode-generator')
      .then((mod) => {
        const qrcode = mod.default || mod.qrcode;
        // 0 = 크기 자동, 'M' = 오류 정정 15%. 인쇄해 붙여 두는 것이 아니라 화면·
        // 메시지로 도는 코드라 M이면 넉넉하다(H는 모듈이 촘촘해져 작게 찍으면 오히려 불리하다).
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        const n = qr.getModuleCount();
        const dark = [];
        for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) dark.push([r, c]);
        if (alive) setMods({ n, dark });
      })
      .catch((e) => {
        console.error('[groups] QR을 만들지 못했어요:', e);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [url]);

  // 모듈 하나가 사각형 하나다. rect를 수백 개 세우는 대신 path 하나로 그린다 —
  // 그림으로 굽고(canvas) 다시 그리는 길이 있어서 노드 수가 그대로 비용이 된다.
  const path = useMemo(() => {
    if (!mods) return '';
    const cell = QR_BOX / (mods.n + QUIET * 2);
    const at = (i) => ((QUIET + i) * cell).toFixed(2);
    const s = cell.toFixed(2);
    return mods.dark.map(([r, c]) => `M${at(c)} ${at(r)}h${s}v${s}h-${s}z`).join('');
  }, [mods]);

  // SVG → 캔버스 → PNG(2배). 화면에 서 있는 그 카드를 그대로 굽는다.
  // 복제본에 width/height를 못 박는다 — 화면용 <svg>는 CSS로 크기를 잡고 있어서,
  // 속성이 없으면 브라우저마다 다른 크기로 래스터한다.
  const toPng = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(CARD_W));
    clone.setAttribute('height', String(CARD_H));
    clone.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(clone);
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('svg를 그림으로 바꾸지 못했어요'));
      img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W * 2;
    canvas.height = CARD_H * 2;
    const ctx = canvas.getContext('2d');
    // 투명 PNG로 나가면 카카오톡의 어두운 대화방에서 검은 종이에 검은 모듈이 된다
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('신청 링크를 복사했어요');
    } catch (e) {
      console.error('[groups] 링크 복사 실패:', e);
      showToast(failText('링크를 복사하지 못했어요', { human: url }));
    }
  }, [url]);

  // 카카오톡·공유 — 그림과 링크를 같이 보낼 수 있으면 그렇게, 아니면 링크만,
  // 공유 시트가 아예 없으면 복사한다(components/ShareButton.jsx와 같은 사다리).
  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      let file = null;
      try {
        const blob = await toPng();
        if (blob) file = new File([blob], `${club.name} 가입 신청 QR.png`, { type: 'image/png' });
      } catch (e) {
        console.error('[groups] QR 그림을 만들지 못했어요:', e);
      }
      if (file && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], url });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
          console.error('[groups] 그림 공유 실패:', e);
        }
      }
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ url });
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
          console.error('[groups] 링크 공유 실패:', e);
        }
      }
      await copy();
    } finally {
      setBusy(false);
    }
  }, [busy, toPng, url, club.name, copy]);

  // **'이미지 저장' 버튼은 걷었다**(사용자 결정 2026-09-10 — "그냥 카카오톡에 공유
  // 버튼만 남겨줘 차라리"). 내려받기가 막힌 폰에서는 그 버튼이 공유 시트를 여는 것으로
  // 끝나서 위 '카카오톡·공유'와 같은 일을 두 번 하는 자리였다. 저장은 그 시트 안에 있다.

  const size = nameSize(club.name);

  return createPortal(
    <div className="club-qr-back fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/50 animate-in fade-in duration-150"
      role="dialog" aria-modal="true" aria-label={`${club.name} 가입 신청 QR`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="club-qr w-full max-w-[21rem] p-4 rounded-[14px] shadow-elevated animate-in fade-in zoom-in-95"
        style={CARD_STYLE} onMouseDown={e => e.stopPropagation()}>
        {failed ? (
          <p className="club-qr-failed py-10 text-center text-[13px] text-fg-muted whitespace-pre-line">
            {'QR을 만들지 못했어요\n링크 복사로 보내 주세요'}
          </p>
        ) : (
          <svg ref={svgRef} className="club-qr-card block mx-auto" viewBox={`0 0 ${CARD_W} ${CARD_H}`}
            xmlns="http://www.w3.org/2000/svg" width={CARD_W} height={CARD_H}
            style={{ width: '100%', height: 'auto', maxWidth: `${CARD_W}px` }}
            role="img" aria-label={`${club.name} 가입 신청 QR 코드`}>
            <rect x="0" y="0" width={CARD_W} height={CARD_H} rx="14" fill={PAPER} />
            <text x={CARD_W / 2} y="50" textAnchor="middle" fontFamily={FONT}
              fontSize={size} fontWeight="800" fill={INK}>{club.name}</text>
            <text x={CARD_W / 2} y="72" textAnchor="middle" fontFamily={FONT}
              fontSize="11.5" fontWeight="600" fill={INK_MUTED}>가입 신청 QR</text>
            <g transform={`translate(${(CARD_W - QR_BOX) / 2}, 88)`}>
              <rect x="0" y="0" width={QR_BOX} height={QR_BOX} fill={PAPER} />
              {!!path && <path d={path} fill={module} shapeRendering="crispEdges" />}
            </g>
            <text x={CARD_W / 2} y="352" textAnchor="middle" fontFamily={FONT}
              fontSize="10.5" fill={INK_MUTED}>{shortUrl(url)}</text>
          </svg>
        )}

        {/* 상시 도구 줄 — 확정 왼쪽 / 나가기 오른쪽(§8). 네 버튼이 한 줄에 다 들어가는
            폭이 아니라 '닫기'는 대개 아랫줄인데, **자기 줄의 오른쪽 끝**에 선다
            (`ml-auto`). flex-1짜리 빈 칸으로 밀면 그 칸이 첫 줄의 남은 폭을 다 먹어서
            닫기가 아랫줄 **왼쪽**에 붙고, 두 모드에서 자리가 달라진다. */}
        <div className="club-qr-tools flex flex-wrap items-center gap-1.5 mt-3.5">
          <button type="button" onClick={share} disabled={busy}
            className={`club-qr-share ${WITH_ICON} ${BTN}`}>
            <Share2 size={13} /><span>카카오톡·공유</span>
          </button>
          <button type="button" onClick={copy}
            className={`club-qr-copy ${WITH_ICON} ${BTN_QUIET}`}>
            <Link2 size={13} /><span>링크 복사</span>
          </button>
          <button type="button" onClick={onClose} className={`club-qr-close ml-auto ${BTN_QUIET}`}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
