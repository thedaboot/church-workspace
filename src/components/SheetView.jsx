import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from './media.jsx';
import { parseXlsx, parseCsv } from '../services/xlsx.js';

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
//   · 굵기·정렬·병합·열 너비는 언제나 원본을 따른다. 색과 달리 테마와 안 부딪힌다.
// ============================================================================

// 상대 밝기(sRGB) — 글자색 고르기와 '종이 판정'에 같이 쓴다
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
// 이보다 밝은 칠은 '흰 종이'로 보고 우리 토큰에 맡긴다.
// 0.85로 두면 연한 하늘색(#dae3f3 · 실제 파일이 구분에 쓴다)까지 지워진다.
const PAPER_L = 0.92;
const fillOf = (bg) => {
  if (!bg || !/^#[0-9a-fA-F]{6}$/.test(bg)) return null;
  const l = luminance(bg);
  if (l > PAPER_L) return null;
  return { background: bg, color: l > 0.45 ? '#191720' : '#f7f6f4' };
};

const DEFAULT_COL_PX = 64;   // 엑셀 기본 열 너비(8.43자)에 맞춘 값

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

  if (!book || !sheet) {
    return (
      <div className="relative w-full h-full">
        <Skeleton className="absolute inset-0 w-full h-full" />
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
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain rounded-md border border-line bg-surface">
        <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {Array.from({ length: width }, (_, i) => (
              <col key={i} style={{ width: `${sheet.cols[i] || DEFAULT_COL_PX}px` }} />
            ))}
          </colgroup>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => {
                  if (covered.has(`${r},${c}`)) return null;
                  const g = spanAt.get(`${r},${c}`);
                  const paint = fillOf(cell?.bg);
                  return (
                    <td
                      key={c}
                      rowSpan={g?.rs > 1 ? g.rs : undefined}
                      colSpan={g?.cs > 1 ? g.cs : undefined}
                      className="border border-line px-1.5 py-1 text-[11.5px] leading-[1.45] align-top whitespace-pre-wrap break-words text-fg"
                      style={{
                        ...(paint || {}),
                        fontWeight: cell?.bold ? 700 : 400,
                        textAlign: cell?.align || (cell?.num ? 'right' : 'left'),
                        fontVariantNumeric: cell?.num ? 'tabular-nums' : undefined,
                      }}
                    >{cell?.v ?? ''}</td>
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
