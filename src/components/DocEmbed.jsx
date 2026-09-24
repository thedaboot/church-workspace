import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Table, Presentation, ExternalLink, Maximize2, Minimize2, X } from 'lucide-react';
import { docEmbedKind, docEmbedSrc, docThumbUrl, DOC_KIND_LABEL } from '../services/docEmbed.js';
import { useMyEmail } from '../services/auth.jsx';
import { Skeleton } from './media.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';

// ============================================================================
// 구글 문서·시트·슬라이드 링크를 **앱 안에서 열어 편집**하는 창 (2026-09-07)
// ----------------------------------------------------------------------------
// 다른 화면(주보 큐시트, 참고 링크, 본문 안 링크)은 이 파일에서만 가져다 쓴다.
//
//   docEmbedKind(url) → 'doc' | 'sheet' | 'slide' | null   (구글 문서 주소인가, 어느 종류인가)
//   docEmbedSrc(url, { email, mobile }) → iframe에 실을 주소(/edit · rm=minimal · #gid= 보존 ·
//                       email을 주면 authuser= — 어느 구글 계정으로 열지, §6-34-h ·
//                       mobile이면 보기 주소 + authuser 없음, §6-34-h-3)
//   docThumbUrl(url) → 첫 장 그림(lh3 · 로그인 없이 온다)
//   <DocEmbedModal url title onClose />                     (전체 화면 모달)
//     └ **폰 + 슬라이드**는 iframe이 아니다 — 첫 장 그림 한 장과 새 탭 버튼뿐(§6-29-y-2)
//   <PwPrompt onOk onCancel />                              (비밀번호 한 줄 — 첨부와 같은 모양)
//   <DocKindIcon kind size />                                (종류 표시 하나)
//
// 판정·주소 만들기는 `services/docEmbed.js`에 있다(순수 함수라 노드에서 바로 검사한다).
//
// **왜 iframe으로 되나**: 구글 편집기는 다른 사이트 안에서 열리는 것을 허용한다
// (노션·컨플루언스가 같은 방식이다). 다만 **그 브라우저가 구글에 로그인돼 있어야** 하고,
// 서드파티 쿠키를 막는 환경(사파리 기본값 · 카카오 인앱 웹뷰)에서는 iframe 안에서 로그인이
// 되지 않아 로그인 화면이나 빈 화면이 뜬다. 우리는 그것을 감지할 수 없다(다른 출처라
// 안을 들여다볼 수 없다) — 그래서 **'새 탭에서 열기'를 언제나 머리줄에 두고**, 30초 안에
// iframe이 load를 알리지 않으면 그 버튼을 눈에 띄게 바꾼다. 사람이 막다른 길에 서지 않는다.
// 로그인이 돼 있어도 **계정이 여럿이면 구글은 기본 계정으로 연다** — 그 계정에 편집
// 권한이 없으면 읽기 화면이다. `authuser=`가 그것을 정한다(§6-34-h).
//
// **sandbox를 주지 않는다.** 첨부 HTML 미리보기(§6-29-z-2)와 반대다 — 그쪽은 **남이 준
// 파일 내용**을 우리가 실행시키는 자리라 출처를 불투명하게 만들어야 하고, 여기는 구글이
// 자기 출처에서 자기 편집기를 그리는 자리다. 구글 편집기는 스크립트·폼·팝업·자기 쿠키를
// 전부 쓰므로 sandbox로 조금이라도 조이면 **편집이 안 된다**.
//
// 비밀번호(view_pw·view_pw_salt — 0053)는 **화면 가림**이다(첨부 0023과 같은 한계 ·
// services/viewPw.js). DocEmbedModal 자신은 비밀번호를 모른다 — 부르는 쪽이 먼저 확인하고
// 통과했을 때만 연다.
// ============================================================================

export { docEmbedKind };

const KIND_ICON = { doc: FileText, sheet: Table, slide: Presentation };

// 종류 표시 하나. 색을 쓰지 않는다 — 글자와 같은 색으로 흐르게 둔다(linkIcons.jsx와 같은 판단).
export function DocKindIcon({ kind, size = 12, className = 'shrink-0' }) {
  const Icon = KIND_ICON[kind];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={1.6} className={className} aria-hidden="true" />;
}

// iframe이 이 시간 안에 load를 알리지 않으면 '새 탭에서 열기'를 강조한다.
// 첨부 오피스 뷰어(12초)보다 길게 잡았다 — 구글 편집기는 처음 열 때 실제로 오래 걸린다.
const SLOW_MS = 30000;

export function DocEmbedModal({ url, title = '', onClose }) {
  const kind = docEmbedKind(url);
  // 창을 화면 가득 넓히기 — 첨부 미리보기 창(FilePreviewModal)과 **같은 버튼·같은
  // 아이콘**이다. 사용자 신고 2026-09-13(아이패드 스크린샷): 업무 본문에 건 구글
  // 슬라이드를 열면 가장자리가 남은 카드 안에 장표가 작게 들어가는데 넓힐 길이 없었다.
  // 모바일은 원래 화면을 다 쓰므로 버튼을 두지 않는다(태블릿부터 보인다 — 그쪽이 좁다).
  const isMobile = useIsMobile();
  // **폰에서 슬라이드는 iframe을 만들지 않는다**(사용자 신고 2026-09-20 · §6-34-h-3).
  // 첨부의 'slide-card'와 **같은 갈래·같은 모양**이다(components/FilePreviewModal.jsx —
  // 서로 import하지 않는다). 구글 슬라이드를 iframe으로 실으면 홈 화면 앱(PWA) 웹뷰가
  // **통째로 죽는데**(§6-29-y-2 · 실기기 2회), 지금까지 본문 링크가 죽지 않고 '액세스
  // 권한 필요'만 떴던 것은 구글이 인증에서 먼저 막아 덱을 아예 안 그렸기 때문이다 —
  // 인증만 고치면 그리기 시작하고 그때 앱이 나간다.
  const slideCard = isMobile && kind === 'slide';
  const thumb = slideCard ? docThumbUrl(url) : null;
  // `authuser=<내 이메일>` — 브라우저에 구글 계정이 여럿 로그인돼 있으면 구글은 **기본
  // 계정**으로 열고, 그 계정에 편집 권한이 없으면 읽기 화면이 뜬다(§6-34-h). 첨부 사본과
  // 같은 사정이다. **새 탭 버튼은 더하지 않는다** — 이 창 머리줄에 이미 있다.
  // 폰에서는 그 인자가 거꾸로 막았다 — `mobile`이 보기 주소를 주고 authuser를 걷는다.
  const src = docEmbedSrc(url, { email: useMyEmail(), mobile: isMobile });
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  // 첫 장 그림이 안 왔나(폰 슬라이드 갈래) — 오면 그림 자리를 빼고 버튼만 남긴다.
  const [thumbFailed, setThumbFailed] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    // 폰 슬라이드 갈래에는 iframe이 없다 — load를 알릴 것이 없으니 30초 타이머도 뜻이 없다
    // (걸어 두면 30초 뒤 머리줄 버튼이 혼자 커진다).
    if (ready || slideCard) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [ready, slideCard]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = DOC_KIND_LABEL[kind] || '문서';

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 animate-in fade-in duration-150" onClick={onClose}>
      {/* 모바일은 화면을 다 쓴다(100dvh — 주소 줄이 접혔다 펴져도 창이 흔들리지 않는다).
          데스크톱은 가장자리를 남긴 둥근 카드다: 뒤가 보여야 이 창이 앱 위에 떠 있는 것으로 읽힌다. */}
      <div
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={title || label} data-doc-embed={kind || 'link'}
        // 넓히면 가장자리를 지운다. 크기가 바뀌는 전환이라 §4.2의 "transform/opacity만"에서
        // 한 칸 비켜나는데, 첨부 미리보기 창이 이미 같은 예외를 쓰고 있어 같은 이징을 쓴다.
        className={`absolute flex flex-col overflow-hidden bg-canvas shadow-elevated animate-in fade-in zoom-in-95 duration-150 transition-[inset,border-radius] ${wide
          ? 'inset-0 h-[100dvh]'
          : 'inset-0 h-[100dvh] md:inset-4 md:h-auto lg:inset-8 md:border md:border-line md:rounded-lg'}`}
        style={{ transitionDuration: '220ms', transitionTimingFunction: 'var(--ease-out-quint)' }}
      >
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-line bg-surface">
          <DocKindIcon kind={kind} size={15} className="shrink-0 text-fg-muted" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-fg truncate">{title || label}</p>
            {/* 정보가 밖으로 나가는 고지 — 이 창은 구글에 주소를 실어 보내고 구글이 그린다
                (첨부의 오피스 뷰어 고지와 같은 자리 · CLAUDE.md의 예외). */}
            {/* 줄이지 않는다(truncate 금지) — 무엇이 밖으로 나가는지 말하는 줄인데
                375px에서 뒷말이 잘려 나갔다. 두 줄이 되어도 다 보이는 쪽이 맞다.
                **앞절은 언제나 같다** — 정보가 밖으로 나간다는 고지다(CLAUDE.md의 예외).
                **뒷절만 폰에서 갈린다**(사용자 결정 2026-09-20): 폰은 보기 주소로 열어서
                (§6-34-h-3) "여기서 바로 고칠 수 있어요"가 거짓이 된다. 새 낱말을 만들지
                않고 원래 뒷절이 말하던 **편집**을 폰에서 참인 자리(새 탭)로 옮겼고,
                슬라이드는 첫 장만 그림으로 세우므로 사용자가 준 문장을 그대로 쓴다. */}
            <p className="text-[10px] text-fg-faint mt-0.5 leading-snug">
              {label}는 구글에서 열려요 · {isMobile
                ? (slideCard ? '새 탭에서 열면 전체 PPT를 볼 수 있어요' : '새 탭에서 열면 고칠 수 있어요')
                : '편집 권한이 있는 링크면 여기서 바로 고칠 수 있어요'}
            </p>
          </div>
          {/* 새 탭은 **원 주소**로 간다 — rm=minimal은 좁은 앱 창을 위한 값이라 넓은 탭에서는 필요 없다.
              30초가 지나도록 화면이 오지 않으면(사파리·인앱 웹뷰에서 실제로 그렇다) 이 버튼이
              아이콘에서 글자 있는 버튼으로 바뀐다 — 막다른 길에 세우지 않는다. */}
          <a
            href={url} target="_blank" rel="noreferrer" title="새 탭에서 열기"
            className={slow && !ready
              ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 whitespace-nowrap'
              : 'p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95'}
          >
            <ExternalLink size={16} className="shrink-0" />{slow && !ready && '새 탭에서 열기'}
          </a>
          {!isMobile && (
            <button type="button" onClick={() => setWide(w => !w)}
              className="p-2 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95"
              title={wide ? '창 크기로' : '화면 가득'}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button type="button" onClick={onClose} title="닫기"
            className="p-2 rounded-md text-fg-faint hover:bg-surface-hover transition active:scale-95"><X size={18} /></button>
        </div>

        {/* 구글 편집기는 언제나 밝은 화면이다(다크 모드를 따라가지 않는다 — §6-29-c와 같다).
            그래서 이 칸의 바탕만 흰색으로 둔다. 안 그러면 문서가 오기 전 어두운 면이
            깜빡이고, 오고 나서는 흰 종이 둘레에 검은 테가 남는다.
            폰 슬라이드 갈래는 구글 화면이 아니라 우리 카드라 앱 바탕 그대로다. */}
        <div className={`relative flex-1 min-h-0 ${slideCard ? 'flex flex-col items-center justify-center px-4' : 'bg-white'}`}>
          {slideCard ? (
            <>
              {/* 첫 장 그림과 버튼 **둘 다 원 주소**를 연다 — 새 탭은 1차 쿠키라 로그인이
                  제대로 붙고, rm=minimal은 좁은 앱 창을 위한 값이라 넓은 탭에서는 필요 없다.
                  누른 제스처 안에서 곧장 연다(기다리면 팝업 차단에 걸린다).
                  글자는 버튼 하나뿐이다 — 안내 문구를 새로 만들지 않는다(§8 · 첨부에서
                  사용자가 목업 B안을 골랐다). */}
              {!thumbFailed && thumb && (
                <button type="button" onClick={() => window.open(url, '_blank', 'noreferrer')} aria-label={title || label}
                  className="w-full max-w-[42rem] aspect-video rounded-md border border-line bg-white overflow-hidden transition active:scale-[0.99]">
                  <img
                    src={thumb} alt="" draggable={false} loading="eager"
                    onError={() => setThumbFailed(true)}
                    className="w-full h-full object-contain"
                  />
                </button>
              )}
              <button type="button" onClick={() => window.open(url, '_blank', 'noreferrer')}
                className="mt-4 inline-flex items-center gap-1.5 bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-md text-xs font-medium transition active:scale-95">
                <ExternalLink size={13} /> 새 탭에서 열기
              </button>
            </>
          ) : (
            <>
              <iframe
                src={src} title={title || label}
                onLoad={() => setReady(true)}
                /* sandbox 없음 — 위 머리말 참고. 붙이면 구글 편집기가 자기 쿠키·팝업·클립보드를
                   못 써서 '편집도 가능하게'라는 이 기능의 목적 자체가 사라진다. */
                allow="clipboard-read; clipboard-write"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 w-full h-full border-0"
              />
              {!ready && (
                /* Skeleton에 위치 유틸리티를 주지 마세요 — `.dc-skeleton`이 position:relative를
                   박고 있어서 absolute가 먹지 않는다(media.jsx의 같은 주석). 자리는 바깥이 잡는다. */
                <span className="absolute inset-0 pointer-events-none"><Skeleton className="w-full h-full" /></span>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 비밀번호 한 줄. 첨부의 입력 줄(modals/attachments.jsx PasswordGate)과 같은 모양이다.
// 맞는지 아닌지는 **부르는 쪽이 판단한다** — onOk(pw)가 false를 돌려주면 여기서 틀렸다고 적는다
// (참고 링크는 resource_links 행을, 큐시트는 services.cue_sheet jsonb를 보는데,
//  그 차이를 이 부품이 알 필요가 없다).
export function PwPrompt({ onOk, onCancel, className = '' }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { if ((await onOk?.(pw)) === false) setWrong(true); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className={`flex items-center gap-2 ${className}`} data-pw-prompt>
      <input
        type="password" value={pw} autoComplete="off" autoFocus
        onChange={(e) => { setPw(e.target.value); setWrong(false); }}
        placeholder="비밀번호" aria-label="비밀번호"
        className="w-32 px-2 py-1.5 rounded-md border border-line bg-surface text-[13px] text-fg outline-none focus:border-accent transition-colors"
      />
      {/* 취소 왼쪽 / 확정 오른쪽 — 팝오버의 버튼 배치는 §8 그대로다 */}
      <button type="button" onClick={onCancel}
        className="px-2.5 py-1.5 rounded-md text-fg-muted text-[11px] font-semibold hover:bg-surface-hover transition active:scale-95">취소</button>
      <button type="submit" disabled={busy}
        className="px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">열기</button>
      {wrong && <span className="text-[11px] text-tag-red-fg">비밀번호가 맞지 않아요</span>}
    </form>
  );
}
