import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, ArrowUp, ArrowDown, ArrowRight, ArrowUpRight, ArrowDownRight,
  Circle, Flag, Check, X, TriangleAlert, ChevronDown,
} from 'lucide-react';
import { Skeleton } from './media.jsx';
import { parseXlsx, parseCsv, luminance, viewColPx, VIEW_FONT_PX } from '../services/xlsx.js';

// ============================================================================
// 엑셀·csv 미리보기 — 구글 iframe 대신 앱이 직접 그린다.
// ----------------------------------------------------------------------------
// 예전에는 드라이브 뷰어를 파일 나이 30분으로 갈랐다(utils.driveSrc). 갓 올린 파일은
// 구글 편집기 preview가 오류를 뱉어서 어두운 드라이브 파일 뷰어로 떨어졌고,
// "올리고 바로 펼쳐보기"가 가장 흔한 동작인데 그때가 제일 못생겼다.
// 바이트는 이미 /api/drive-file이 중계하므로 우리가 읽으면 기다릴 것이 없다.
//
// 다크 모드 규칙 (사용자 결정 — "서식도 다크 모드도 다 챙긴다"):
//   · 작성자가 **색을 칠한 칸**은 원본 색 그대로 둔다. 노란 강조를 우리 색으로
//     바꾸면 작성자가 담은 뜻이 사라진다. 글자색은 그 배경에 맞춰 자동으로 고른다.
//   · **흰색에 가까운 칠은 '종이'로 본다.** 엑셀 서식은 본문 전체를 흰색으로
//     칠해 두는 일이 아주 흔하고(실제 파일의 명단 시트가 통째로 #FFFFFF다),
//     그걸 그대로 두면 다크 모드에서 흰 표가 통째로 뜬다. 흰 칠은 강조가 아니라
//     기본값이므로 우리 토큰으로 그린다.
//   · 굵기·기울임·취소선·정렬·병합·열 너비는 언제나 원본을 따른다. 테마와 안 부딪힌다.
//   · **테두리**는 굵기와 모양만 원본을 따르고 색은 우리 선 색이다(검정 테두리를 그대로
//     쓰면 다크에서 사라진다). 작성자가 색을 지정한 테두리만 그 색을 남긴다.
//   · **글자색**은 색이 있는 글자만 살리되 `color-mix`로 현재 테마의 글자색을 섞는다 —
//     라이트에서는 그대로 진하고, 다크에서는 같은 색상이 밝아진다. 검정·흰색 글자는
//     엑셀의 기본값이라 우리 토큰에 맡긴다(xlsx.chromatic).
//   · **조건부 서식**은 파서가 미리 적용해서 넘긴다(수식 규칙·아이콘 집합 포함 — services/formula.js).
//
// 가독성이 서식보다 앞선다 (사용자 판단 2026-08-28 — "서식·테두리 다 챙기는 것도 좋은데,
// 가독성이 더 중요해보임"). 원본과 어긋나더라도 읽히는 쪽을 고른 자리는 셋이다:
//   · 넘치는 글자를 **접는다**(원본의 '줄바꿈 안 함'을 안 따른다 — 아래 td 주석).
//   · 열 너비에 **상한**을 둔다. 접는 우리에게 화면보다 넓은 열은 의미가 없다(xlsx.viewColPx).
//   · 글자를 엑셀 기준보다 키우고, 같은 글자 수가 들어가게 열도 같은 비율로 넓힌다.
// ============================================================================

// 이보다 밝은 칠은 '흰 종이'로 보고 우리 토큰에 맡긴다.
// 0.85로 두면 연한 하늘색(#dae3f3 · 실제 파일이 구분에 쓴다)까지 지워진다.
const PAPER_L = 0.92;
const fillOf = (bg) => {
  if (!bg || !/^#[0-9a-fA-F]{6}$/.test(bg)) return null;
  const l = luminance(bg);
  if (l > PAPER_L) return null;
  return { background: bg, color: l > 0.45 ? '#191720' : '#f7f6f4' };
};

// 격자선은 실제 테두리보다 옅다 — 엑셀에서도 눈금선과 테두리는 다르게 보인다.
// 이게 없으면 "테두리를 넣었다"가 화면에서 구분되지 않는다.
const GRID = '1px solid color-mix(in srgb, var(--app-line) 55%, transparent)';
const sideCss = (sd) => (sd ? `${sd.w}px ${sd.s} ${sd.c || 'var(--app-line)'}` : GRID);

// 배경과 글자의 밝기 차 — 조건부 서식이 준 글자색을 쓸지 자동 대비로 덮을지 가른다
const readable = (fg, bg) => Math.abs(luminance(fg) - luminance(bg)) > 0.28;

// 셀 글자색 정책 한 벌 — 칠이 있으면 그 배경에서 읽히는 색만 쓰고, 칠이 없으면
// 현재 테마의 글자색을 섞는다(라이트에서는 진하고 다크에서는 같은 색상이 밝아진다).
// 셀 전체 색과 부분 서식(run) 색이 **같은 정책**을 지나야 한 셀 안에서 톤이 안 어긋난다.
const inkOf = (fg, bg, painted) => {
  if (!fg) return undefined;
  if (painted) return readable(fg, bg) ? fg : undefined;
  return `color-mix(in oklab, ${fg} 72%, var(--app-ink))`;
};

// 부분 서식(rich text run) — 한 셀 안에서 구간마다 색·굵기·크기가 다르다.
// 원본 엑셀의 '비고' 칸이 찬조 구간만 주황인 것이 이걸로 살아난다(사용자 지적).
function CellText({ cell, painted }) {
  if (!cell?.runs) return cell?.v ?? '';
  return cell.runs.map((rn, i) => (
    <span
      key={i}
      style={{
        color: inkOf(rn.color, cell.bg, painted),
        fontWeight: rn.bold ? 700 : undefined,
        fontStyle: rn.italic ? 'italic' : undefined,
        textDecoration: rn.strike ? 'line-through' : rn.under ? 'underline' : undefined,
        fontSize: rn.szPx ? `${rn.szPx}px` : undefined,
      }}
    >{rn.t}</span>
  ));
}

// ── 조건부 서식의 아이콘 집합 ───────────────────────────────────────────────
// 엑셀은 초록/노랑/빨강을 고정색으로 박지만 **우리는 태그 토큰을 쓴다** — 고정색을
// 그대로 쓰면 다크 모드에서 톤이 어긋나고, 이 앱에 없는 색이 표 안에만 생긴다
// (테두리·칠에 쓴 판단과 같다). 아이콘은 lucide만 쓴다(§4.2 — 이모지 금지).
const ICON_COLORS = {
  3: ['var(--app-tag-red-fg)', 'var(--app-status-hold)', 'var(--app-tag-green-fg)'],
  4: ['var(--app-tag-red-fg)', 'var(--app-tag-orange-fg)', 'var(--app-status-hold)', 'var(--app-tag-green-fg)'],
  5: ['var(--app-tag-red-fg)', 'var(--app-tag-orange-fg)', 'var(--app-status-hold)', 'var(--app-tag-green-fg)', 'var(--app-tag-green-fg)'],
};
const ARROWS = {
  3: [ArrowDown, ArrowRight, ArrowUp],
  4: [ArrowDown, ArrowDownRight, ArrowUpRight, ArrowUp],
  5: [ArrowDown, ArrowDownRight, ArrowRight, ArrowUpRight, ArrowUp],
};
// 등급·조각은 채운 점 개수로 보여준다(별점처럼) — 아이콘 하나로는 단계가 안 읽힌다
const DOTS = /Rating|Quarters|Boxes|Stars/i;

function CellIcon({ icon }) {
  const { set, idx, n } = icon;
  const palette = ICON_COLORS[n] || ICON_COLORS[3];
  const gray = /Gray|Black/i.test(set);
  const color = gray ? 'var(--app-ink-muted)' : palette[Math.min(idx, palette.length - 1)];
  if (DOTS.test(set)) {
    return (
      <span className="inline-flex items-center gap-[1px] align-[-1px]" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <Circle key={i} size={7} style={{ color }} fill={i <= idx ? 'currentColor' : 'transparent'} />
        ))}
      </span>
    );
  }
  let Mark;
  if (/Arrows/i.test(set)) Mark = (ARROWS[n] || ARROWS[3])[Math.min(idx, n - 1)];
  else if (/Flags/i.test(set)) Mark = Flag;
  else if (/Symbols/i.test(set)) Mark = [X, TriangleAlert, Check][Math.min(idx, 2)];
  else Mark = Circle;                                   // 신호등·표지판 계열
  const filled = /TrafficLights|Signs|Flags/i.test(set);
  return <Mark size={12} style={{ color }} fill={filled ? 'currentColor' : 'none'} className="inline align-[-2px] shrink-0" aria-hidden="true" />;
}

// onError: 그리지 못했을 때 부르는 쪽에 넘긴다(PdfView와 같은 모양) — 렌더 중에
// 던지면 ErrorBoundary가 화면을 통째로 걷어가서, 미리보기 하나가 업무 창을 죽인다.
export function SheetView({ blob, text = null, name = '', onError }) {
  const [book, setBook] = useState(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let alive = true;
    setBook(null); setTab(0);
    (async () => {
      try {
        const done = text !== null
          ? parseCsv(text, name || 'CSV')
          : await parseXlsx(await blob.arrayBuffer());
        if (alive) setBook(done);
      } catch (e) {
        console.error('[preview] 엑셀 읽기 실패:', e);
        if (alive) onError?.(e);
      }
    })();
    return () => { alive = false; };
    // onError는 부르는 쪽에서 매번 새로 만들어질 수 있어 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, text, name]);

  const sheet = book?.sheets?.[tab] || null;

  // 병합에 덮이는 칸은 그리지 않는다 — 안 지우면 표가 오른쪽으로 밀린다
  const covered = useMemo(() => {
    const set = new Set();
    for (const g of sheet?.merges || []) {
      for (let r = g.r; r < g.r + g.rs; r++) {
        for (let c = g.c; c < g.c + g.cs; c++) if (r !== g.r || c !== g.c) set.add(`${r},${c}`);
      }
    }
    return set;
  }, [sheet]);
  const spanAt = useMemo(() => {
    const m = new Map();
    for (const g of sheet?.merges || []) m.set(`${g.r},${g.c}`, g);
    return m;
  }, [sheet]);

  // 그림을 앵커 셀에 붙인다. 앵커가 병합에 덮인 자리면(그 td는 안 그려진다)
  // 그 병합의 앵커 셀로 옮긴다.
  const imagesAt = useMemo(() => {
    const m = new Map();
    for (const im of sheet?.images || []) {
      let key = `${im.r},${im.c}`;
      if (covered.has(key)) {
        const g = (sheet?.merges || []).find(g =>
          im.r >= g.r && im.r < g.r + g.rs && im.c >= g.c && im.c < g.c + g.cs);
        if (g) key = `${g.r},${g.c}`;
      }
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(im);
    }
    return m;
  }, [sheet, covered]);

  // 그림 폭: 원본 크기(ext)가 있으면 화면 배율로, 없으면 걸친 열들의 너비 합으로 어림
  const colPx = (i) => viewColPx(sheet?.cols[i] ?? sheet?.defaultColPx ?? null);
  const imgWidth = (im) => {
    if (im.wPx) return Math.round(im.wPx * (VIEW_FONT_PX / 11.5));
    if (im.c2 && sheet) {
      let w = 0;
      for (let i = im.c; i < im.c2 && i < (sheet.rows[0]?.length || 0); i++) w += colPx(i);
      return w || null;
    }
    return null;
  };

  if (!book || !sheet) {
    return (
      <div className="relative w-full h-full">
        {/* Skeleton에 absolute를 주면 먹지 않는다(.dc-skeleton이 position: relative를
            박는다 — index.css). 자리는 바깥 span이 잡는다. */}
        <span className="absolute inset-0"><Skeleton className="w-full h-full" /></span>
        <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted">
          <Loader2 size={14} className="animate-spin" /> 미리보기를 준비하고 있어요
        </span>
      </div>
    );
  }

  const width = sheet.rows[0]?.length || 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* 시트 탭 — 한 장짜리면 줄을 두지 않는다. 가로로 미는 줄이라 x-scroll-lock(§4.2) */}
      {book.sheets.length > 1 && (
        <div className="shrink-0 flex items-center gap-1 overflow-x-auto scrollbar-hide x-scroll-lock pb-1.5">
          {book.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`} type="button" onClick={() => setTab(i)}
              className="dc-press shrink-0 px-2.5 py-1 rounded-[6px] text-[11.5px] font-semibold transition-colors whitespace-nowrap"
              style={{
                background: i === tab ? 'var(--app-surface)' : 'transparent',
                color: i === tab ? 'var(--app-ink)' : 'var(--app-ink-muted)',
                border: `1px solid ${i === tab ? 'var(--app-line)' : 'transparent'}`,
              }}
            >{s.name}</button>
          ))}
        </div>
      )}

      {/* 표는 자기 상자 안에서 스크롤한다 — 모바일에서 화면 전체가 가로로 밀리면 안 된다.
          overscroll-contain이 표 끝에서 바깥(업무 창)이 따라 밀리는 것을 막는다. */}
      <div key={tab} className="dc-sheet flex-1 min-h-0 overflow-auto overscroll-contain rounded-md border border-line bg-surface">
        <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {Array.from({ length: width }, (_, i) => (
              // 시트가 기본 열 너비를 정해 두면(<sheetFormatPr>) 너비 없는 열은 그걸 쓴다 —
              // 실물 결산안이 106px인데 공장 기본 64px로 그리면 표 비례가 무너진다
              <col key={i} style={{ width: `${viewColPx(sheet.cols[i] ?? sheet.defaultColPx ?? null)}px` }} />
            ))}
          </colgroup>
          <tbody>
            {sheet.rows.map((row, r) => (
              // 행 높이는 **최소값**이다 — 내용이 크면 행이 알아서 늘어난다.
              // 제목 행(크게)과 간격용 빈 행(납작하게)이 원본 인상을 지킨다.
              <tr key={r} style={sheet.rowPx?.[r] ? { height: `${sheet.rowPx[r]}px` } : undefined}>
                {row.map((cell, c) => {
                  if (covered.has(`${r},${c}`)) return null;
                  const g = spanAt.get(`${r},${c}`);
                  const paint = fillOf(cell?.bg);
                  const bd = cell?.bd;
                  const bar = cell?.bar;
                  const imgs = imagesAt.get(`${r},${c}`);
                  const hasFilter = sheet.filter && r === sheet.filter.r && c >= sheet.filter.c1 && c <= sheet.filter.c2;
                  // 글자색: 칠이 있으면 그 배경에 맞춰 고르고(작성자가 준 색이 읽히면 그걸
                  // 쓴다), 칠이 없으면 현재 테마의 글자색을 섞어 라이트·다크 모두에서 읽히게.
                  const color = paint
                    ? (cell?.fg && readable(cell.fg, cell.bg) ? cell.fg : paint.color)
                    : inkOf(cell?.fg, cell?.bg, false);
                  return (
                    <td
                      key={c}
                      rowSpan={g?.rs > 1 ? g.rs : undefined}
                      colSpan={g?.cs > 1 ? g.cs : undefined}
                      // 원본의 wrapText(줄바꿈 안 함)는 **따르지 않는다.** 엑셀은 넘치는
                      // 글자를 옆 칸으로 흘리거나 잘라 버리는데, 미리보기에서 그러면
                      // 비고 같은 긴 칸의 내용이 화면 밖으로 나가 안 보인다. 여기서는
                      // 열 너비를 원본대로 두고 글자만 접는다 — 정보가 먼저다.
                      className={`relative px-1.5 py-1 leading-[1.45] break-words text-fg whitespace-pre-wrap ${cell?.cf ? 'dc-cell-paint' : ''}`}
                      style={{
                        // 글자 크기는 원본을 따른다(8pt 잔글씨~24pt 제목) — 없으면 기준 크기
                        fontSize: `${cell?.szPx || VIEW_FONT_PX}px`,
                        background: paint?.background,
                        color,
                        borderTop: sideCss(bd?.t), borderRight: sideCss(bd?.r),
                        borderBottom: sideCss(bd?.b), borderLeft: sideCss(bd?.l),
                        fontWeight: cell?.bold ? 700 : 400,
                        fontStyle: cell?.italic ? 'italic' : undefined,
                        textDecoration: cell?.strike ? 'line-through' : cell?.under ? 'underline' : undefined,
                        textAlign: cell?.align || (cell?.num ? 'right' : 'left'),
                        // 엑셀의 기본 세로 정렬은 top이 아니라 **bottom**이다
                        verticalAlign: cell?.valign === 'center' ? 'middle' : cell?.valign === 'top' ? 'top' : 'bottom',
                        fontVariantNumeric: cell?.num ? 'tabular-nums' : undefined,
                      }}
                    >
                      {/* 데이터 막대 — 글자 뒤에 깔고 왼쪽에서 자란다(scaleX, §4.2) */}
                      {bar && (
                        <span
                          aria-hidden="true"
                          className="dc-bar-grow absolute inset-y-[2px] left-[2px] rounded-[2px] pointer-events-none"
                          style={{
                            width: `calc(${(bar.ratio * 100).toFixed(1)}% - 4px)`,
                            background: `color-mix(in srgb, ${bar.color} 45%, transparent)`,
                          }}
                        />
                      )}
                      {cell?.icon
                        ? (
                          <span className="relative inline-flex items-center gap-1 w-full" style={{ justifyContent: (cell.align || (cell.num ? 'right' : 'left')) === 'right' ? 'flex-end' : 'flex-start' }}>
                            <CellIcon icon={cell.icon} />
                            {cell.icon.showValue && <span>{cell.v}</span>}
                          </span>
                        )
                        : <span className="relative"><CellText cell={cell} painted={!!paint} /></span>}
                      {/* 자동 필터 — 원본 머리행의 ▼ 버튼 자리. 아이콘만, 문구 없이. */}
                      {hasFilter && <ChevronDown size={10} className="relative inline align-[-1px] ml-0.5 text-fg-faint shrink-0" aria-hidden="true" />}
                      {/* 시트에 얹힌 그림(도장·서명 스캔 등) — 앵커 셀 안에 그린다.
                          원본은 셀 위에 떠 있지만, 행 높이를 원본대로 다 재현하지 않는
                          한 픽셀 좌표는 어차피 안 맞는다. "그 자리에 그 그림"이 먼저다. */}
                      {imgs?.map((im, i) => (
                        <img
                          key={i} src={im.src} alt=""
                          className="relative block max-w-full"
                          style={{ width: imgWidth(im) ? `${imgWidth(im)}px` : undefined }}
                        />
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheet.truncated && (
        <p className="shrink-0 pt-1 text-center text-[10px] text-fg-faint">
          앞의 500줄까지만 보여줘요 · 전체는 새 탭에서 열기
        </p>
      )}
    </div>
  );
}
