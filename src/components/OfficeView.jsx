import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from './media.jsx';
import { parseDocx } from '../services/docx.js';
import { parsePptx } from '../services/pptx.js';

// ============================================================================
// 워드·파워포인트 미리보기 — 구글 iframe 대신 앱이 직접 그린다.
// ----------------------------------------------------------------------------
// 엑셀(SheetView)과 같은 판단이다: 구글 편집기 미리보기는 **갓 올린 파일에 오류를
// 뱉어서** 파일 나이 30분으로 갈라야 했고, "올리고 바로 열어 보는" 가장 흔한 순간이
// 언제나 못생긴 쪽(어두운 드라이브 파일 뷰어)으로 떨어졌다. 바이트는 이미
// /api/drive-file이 중계하므로 우리가 읽으면 기다릴 것이 없다.
//
// 다크 모드 규칙도 엑셀과 같다:
//   · 작성자가 **색을 지정한** 글자·칠만 원본 색을 남기고, 나머지는 우리 토큰이다.
//   · 글자색은 color-mix로 테마 글자색을 섞는다 — 라이트에서는 진하고 다크에서는
//     같은 색상이 밝아진다. 그냥 두면 다크에서 검은 글자가 배경에 묻힌다.
//   · 흰색에 가까운 칠은 '종이'로 보고 걷어낸다(원본이 본문을 통째로 흰색으로
//     칠해 두는 일이 아주 흔하다 — xlsx.js의 PAPER_L과 같은 이유·같은 값).
// ============================================================================

const PAPER_L = 0.92;
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
// 원본 칠 → 화면 칠. 흰 종이는 null(우리 배경에 맡긴다).
const fillOf = (bg) => {
  if (!bg || !/^#[0-9a-fA-F]{6}$/.test(bg)) return null;
  const l = lum(bg);
  if (l > PAPER_L) return null;
  return { background: bg, color: l > 0.45 ? '#191720' : '#f7f6f4' };
};
// 원본 글자색 → 화면 글자색. 검정·흰색은 원본의 기본값이라 우리 토큰에 맡긴다.
const inkOf = (hex) => {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const l = lum(hex);
  if (l < 0.05 || l > 0.95) return undefined;
  return `color-mix(in oklab, ${hex} 72%, var(--app-ink))`;
};

// 형광펜은 이름으로 온다(yellow·cyan…). 우리 태그 토큰으로 옮긴다 — 원색을 그대로
// 쓰면 다크 모드에서 눈이 아프고, 이 앱에 없는 색이 문서 안에만 생긴다.
const MARK = {
  yellow: 'var(--app-tag-yellow)', green: 'var(--app-tag-green)', cyan: 'var(--app-tag-blue)',
  blue: 'var(--app-tag-blue)', magenta: 'var(--app-tag-pink)', red: 'var(--app-tag-red)',
  darkYellow: 'var(--app-tag-yellow)', lightGray: 'var(--app-tag-gray)', darkGray: 'var(--app-tag-gray)',
};

const runStyle = (r) => ({
  fontWeight: r.b ? 700 : undefined,
  fontStyle: r.i ? 'italic' : undefined,
  textDecoration: [r.u && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
  color: inkOf(r.color),
  fontSize: r.sizePx ? `${r.sizePx}px` : undefined,
  background: r.mark ? (MARK[r.mark] || 'var(--app-tag-yellow)') : undefined,
  borderRadius: r.mark ? 2 : undefined,
});

const Runs = ({ runs }) => runs.map((r, i) => (r.img
  ? <img key={i} src={r.img} alt="" className="inline-block max-w-full h-auto rounded-[3px] my-1"
      style={{ width: r.w ? `${r.w}px` : undefined }} />
  : <span key={i} style={runStyle(r)} className="whitespace-pre-wrap">{r.text}</span>
));

// ── 워드 ────────────────────────────────────────────────────────────────────
const H_PX = { 1: 24, 2: 20, 3: 17, 4: 15, 5: 14, 6: 13.5 };

function Para({ p, marker }) {
  if (!p.runs.length) return <div className="h-3" aria-hidden="true" />;
  const heading = p.level > 0;
  return (
    <p
      className={`${heading ? 'font-bold mt-4 mb-1.5' : 'mb-1.5'} leading-[1.65] text-fg break-words`}
      style={{
        fontSize: heading ? `${H_PX[p.level] || 13}px` : '13.5px',
        textAlign: p.align || undefined,
        marginLeft: (p.indent || 0) + (p.list ? p.list.level * 18 : 0),
      }}
    >
      {/* 목록 표시는 우리가 그린다 — 원본 불릿 글리프(Wingdings의 ·)는 글꼴이 없으면
          네모로 나온다. 번호는 원본 번호를 이어받지 않고 순서대로 센다. */}
      {marker && <span className="text-fg-faint mr-1.5 select-none">{marker}</span>}
      <Runs runs={p.runs} />
    </p>
  );
}

function DocTable({ t }) {
  return (
    <div className="my-3 overflow-x-auto x-scroll-lock">
      <table className="border-collapse text-[12.5px]" style={{ tableLayout: t.widths.length ? 'fixed' : 'auto' }}>
        {t.widths.length > 0 && (
          <colgroup>{t.widths.map((w, i) => <col key={i} style={{ width: `${Math.max(w, 44)}px` }} />)}</colgroup>
        )}
        <tbody>
          {t.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => {
                if (c.merged) return null;              // 위 칸에 합쳐진 자리
                const paint = fillOf(c.bg);
                return (
                  <td key={ci} colSpan={c.span > 1 ? c.span : undefined}
                    className="align-top px-2 py-1.5 border border-line text-fg"
                    style={{ background: paint?.background, color: paint?.color }}>
                    {c.paras.map((p, pi) => <Para key={pi} p={p} marker={null} />)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocView({ blob, onError }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    let alive = true;
    setDoc(null);
    (async () => {
      try {
        const out = await parseDocx(await blob.arrayBuffer());
        if (alive) setDoc(out);
      } catch (e) {
        console.error('[preview] 워드 읽기 실패:', e);
        if (alive) onError?.(e);
      }
    })();
    return () => { alive = false; };
    // onError는 부르는 쪽에서 매번 새로 만들어질 수 있어 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // 번호 목록은 이어지는 동안만 센다 — 문단이 끼면 1부터 다시 시작한다
  const markers = useMemo(() => {
    if (!doc) return [];
    const out = [];
    const counters = [];
    doc.blocks.forEach((b, i) => {
      if (b.t !== 'p' || !b.list) { counters.length = 0; out[i] = null; return; }
      if (b.list.kind !== 'number') { out[i] = '·'; return; }
      counters.length = b.list.level + 1;
      counters[b.list.level] = (counters[b.list.level] || 0) + 1;
      out[i] = `${counters[b.list.level]}.`;
    });
    return out;
  }, [doc]);

  if (!doc) return <Preparing />;
  return (
    <div className="w-full h-full overflow-auto overscroll-contain rounded-md border border-line bg-surface">
      <div className="mx-auto max-w-[46rem] px-5 py-6 md:px-8 md:py-8">
        {doc.blocks.map((b, i) => (
          <React.Fragment key={i}>
            {b.t === 'table'
              ? <DocTable t={b} />
              : <Para p={b} marker={markers[i]} />}
            {b.pageBreak && <hr className="my-6 border-0 border-t border-dashed border-line" />}
          </React.Fragment>
        ))}
        {doc.truncated && (
          <p className="pt-3 text-center text-[10px] text-fg-faint">앞부분만 보여줘요 · 전체는 새 탭에서 열기</p>
        )}
      </div>
    </div>
  );
}

// ── 파워포인트 ──────────────────────────────────────────────────────────────
// 슬라이드는 좌표판이라 도형을 **퍼센트로 절대 배치**한다. 글자 크기는 원본 슬라이드
// 폭 기준 px이므로 그대로 쓰면 창을 줄였을 때 글자만 커서 상자를 넘친다 — 슬라이드
// 상자를 컨테이너로 삼고 cqw(컨테이너 폭의 1%)로 환산해서 폭과 같이 줄어들게 한다.
function Slide({ slide, deck, index }) {
  const cq = (px) => `${(px / deck.wPx * 100).toFixed(3)}cqw`;
  return (
    <div className="relative w-full rounded-md border border-line bg-surface overflow-hidden"
      style={{ aspectRatio: String(deck.ratio), containerType: 'inline-size' }}>
      {slide.shapes.map((sh, i) => {
        const box = {
          position: 'absolute',
          left: `${sh.pos.x}%`, top: `${sh.pos.y}%`,
          width: `${sh.pos.w}%`, height: `${sh.pos.h}%`,
        };
        if (sh.kind === 'img') {
          const src = deck.images[sh.src];
          return src ? <img key={i} src={src} alt="" style={box} className="object-contain" /> : null;
        }
        const paint = fillOf(sh.fill);
        return (
          <div key={i} style={{ ...box, background: paint?.background, justifyContent: sh.anchor }}
            className="flex flex-col overflow-hidden">
            {sh.paras.map((p, pi) => (
              <p key={pi} className="text-fg leading-[1.35] break-words"
                style={{
                  textAlign: p.align || undefined,
                  marginLeft: p.level ? cq(p.level * 24) : undefined,
                  marginBottom: cq(6),
                  color: paint?.color,
                }}>
                {p.bullet && <span className="text-fg-faint select-none" style={{ marginRight: cq(8) }}>·</span>}
                {p.runs.map((r, ri) => (
                  <span key={ri} style={{ ...runStyle(r), fontSize: r.sizePx ? cq(r.sizePx) : undefined }}
                    className="whitespace-pre-wrap">{r.text}</span>
                ))}
              </p>
            ))}
          </div>
        );
      })}
      {/* 몇 번째 장인지 — 슬라이드를 세로로 쌓아 보므로 번호가 없으면 어디쯤인지 모른다 */}
      <span className="absolute bottom-1.5 right-2 text-[10px] text-fg-faint select-none">{index + 1}</span>
    </div>
  );
}

export function SlideView({ blob, onError }) {
  const [deck, setDeck] = useState(null);
  useEffect(() => {
    let alive = true;
    setDeck(null);
    (async () => {
      try {
        const out = await parsePptx(await blob.arrayBuffer());
        if (alive) setDeck(out);
      } catch (e) {
        console.error('[preview] 파워포인트 읽기 실패:', e);
        if (alive) onError?.(e);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  if (!deck) return <Preparing />;
  return (
    <div className="w-full h-full overflow-auto overscroll-contain">
      <div className="mx-auto max-w-[56rem] space-y-3 p-1">
        {deck.slides.map((s, i) => <Slide key={i} slide={s} deck={deck} index={i} />)}
        {deck.truncated && (
          <p className="pt-1 text-center text-[10px] text-fg-faint">앞부분만 보여줘요 · 전체는 새 탭에서 열기</p>
        )}
      </div>
    </div>
  );
}

// 읽는 동안 — SheetView와 같은 모양(자리를 잡는 스켈레톤 + 한 줄).
function Preparing() {
  return (
    <div className="relative w-full h-full">
      <span className="absolute inset-0"><Skeleton className="w-full h-full" /></span>
      <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted">
        <Loader2 size={14} className="animate-spin" /> 미리보기를 준비하고 있어요
      </span>
    </div>
  );
}
