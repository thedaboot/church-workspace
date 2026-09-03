import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Bookmark, Search, X, Highlighter, Eraser } from 'lucide-react';
import { loadBibleIndex, loadBook } from '../services/bible.js';
import { parseRef } from '../services/bibleRef.js';
import {
  loadBibleState, saveBibleState, loadFontStep, saveFontStep,
  chapterKey, parseChapterKey, verseKey, parseVerseKey,
} from '../services/word.js';
import { showToast } from './Toast.jsx';
import { readCache, writeCache } from '../services/cache.js';
import { failText } from '../services/errorText.js';
import { SectionHead, Card, prefersReducedMotion } from '../views/dashboardParts.jsx';
import { Skeleton } from './media.jsx';

// ============================================================================
// 성경 읽기 — 목차 · 리더 · 본문 검색 · 북마크 · 형광펜 · 이어읽기 (docs/V2.md 결정 12)
// ----------------------------------------------------------------------------
// 본문은 public/bible/*.json(개역한글)이고 로더는 services/bible.js 하나다.
// '(없음)'·'[ ]'·'(셀라)'는 대한성서공회의 편집 표기라 데이터에 그대로 있다 —
// 지우면 절 번호가 통째로 밀리므로 **화면에서만** 흐리게 그린다
// (public/bible/README.md · services/bible.js 머리말).
//
// 검색은 인덱스를 만들지 않는다. 66권을 순서대로 받아 훑고, 책 하나가 끝날 때마다
// 진행을 그린다(첫 검색은 4.5MB를 받으므로 그 사이 화면이 멈춰 보이면 안 된다).
// 받은 책은 loadBook이 캐시하므로 두 번째 검색부터는 빠르다.
//
// **목차 · 북마크 · 형광펜은 세 화면이다**(사용자 피드백 2026-09-02 4차 — "목차 화면에
// 북마크·형광펜 목록이 같이 보인다"). 예전에는 넓은 화면에서 옆 칸(300px)에, 좁은
// 화면에서는 목차 위에 '내 기록'을 세웠다. 그래서 ① 책을 고르러 온 사람이 북마크 목록을
// 지나쳐야 했고 ② 좁은 폭에서 **본문을 읽는 동안에는 두 목록에 닿을 길이 아예 없었다**
// (옆 칸은 lg에서만 서고, 목차 위 자리는 목차 화면에만 있었다). 지금은 검색 줄 아래
// 세그먼트가 어느 폭에서도 늘 서 있고, 고른 것 하나만 그린다.
//
// **폭: 어느 화면도 상한을 두지 않는다**(사용자 피드백 2026-09-03 — "어느 폭에서도 빈
// 구간 없이 채울 것"). 검색 줄·리더·검색 결과·목차·북마크·형광펜 전부 컨테이너를 채운다.
// 예전에는 읽기 폭을 46rem에서 끊었는데(한 줄이 길면 다음 줄 첫 글자를 눈이 못 찾는다),
// 1000px 남짓에서 오른쪽에 230px 빈 띠가 남는 쪽이 더 거슬렸다 — 사용자 결정이 이긴다.
// 대신 목록은 폭이 넓어질수록 열을 늘려(2 → 3열) 한 열이 너무 길어지지 않게 하고, 책
// 머리글의 개수는 이름 **바로 옆**에 붙인다(오른쪽 끝에 붙이면 넓은 열에서 400px 떨어진다).
// ============================================================================

const OT_COUNT = 39;               // 정경 순서 — index.json의 앞 39권이 구약
const SWIPE_MIN = 60;              // px — 이만큼 가로로 쓸면 장을 넘긴다(모바일)
const STATE_KEY = 'word:state';    // 캐시 열쇠 — 이어읽기·북마크·형광펜(services/cache.js)
const RESULT_LIMIT = 50;           // 결과 상한(스펙). 넘으면 거기서 멈춘다

// 글자 크기 3단계. 계정이 아니라 기기에 남긴다(같은 사람도 폰과 노트북이 다르다).
const FONT_STEPS = [
  { size: '13.5px', line: '1.75', gap: '5px', mark: '11px' },
  { size: '15px', line: '1.8', gap: '7px', mark: '12.5px' },
  { size: '17px', line: '1.85', gap: '9px', mark: '14px' },
];

// ── 화면이 바뀔 때의 결 ─────────────────────────────────────────────────────
// 말씀 화면 안에서 무엇이 바뀌든(세그먼트 · 날짜 · 장 · 목차↔리더) 같은 결로 바뀐다.
// index.css에 새 키프레임을 두지 않고 **전환**으로 낸다: k가 달라진 렌더에서 시작
// 자리로 되돌려 놓고(렌더 중 setState — 그 렌더가 곧바로 다시 돈다), 그림이 나간
// 뒤(useEffect)에 제자리로 보낸다. 움직이는 것은 transform·opacity뿐이다(§4.2).
// dir: 1 다음 · -1 이전 · 0 방향 없음(그때는 세로로 아주 조금).
//
// **거리를 키웠다**(사용자 피드백 2026-09-02 — "이전/다음 장 애니메이션이 안 보인다").
// 12px·.26s는 스크롤 한 칸보다 작아서, 장이 바뀐 것은 알아도 어느 쪽으로 갔는지가
// 눈에 남지 않았다. 28px·.3s면 방향이 읽히고 §4.2의 결(이징 하나 · transform/opacity만)
// 안에 그대로 있다. prefers-reduced-motion이면 전환 자체가 없다.
const SWAP_SHIFT = 28;    // px — 방향이 보이는 최소치. 이보다 작으면 없는 것과 같았다
const SWAP_LIFT = 8;      // px — 방향이 없을 때(dir 0)의 세로 이동
const SWAP_MS = 300;      // ms — §4.2의 .dc-screen(260ms)과 같은 결

export function Swap({ k, dir = 0, className = '', children }) {
  const [seen, setSeen] = useState(k);
  const [shown, setShown] = useState(true);
  const nodeRef = useRef(null);
  const reduce = prefersReducedMotion();

  if (seen !== k) { setSeen(k); if (!reduce) setShown(false); }
  useEffect(() => {
    if (shown) return;
    // **이 줄이 애니메이션의 전부다.** 시작 자리를 브라우저에 한 번 '보여 주고' 나서
    // 제자리로 보낸다 — offsetHeight를 읽으면 그 자리로 스타일이 확정되고, 그래야
    // 다음 값이 전환의 끝점이 된다. 없으면 두 값이 같은 스타일 갱신 안에서 처리되어
    // **전환이 아예 시작되지 않는다**(사용자 피드백 2026-09-02 "애니메이션이 눈에
    // 안 잡힌다"의 진짜 원인 — 거리가 작아서가 아니라 안 돌고 있었다). 지우지 말 것.
    void nodeRef.current?.offsetHeight;
    setShown(true);
  }, [shown]);

  const off = dir === 0
    ? `translate3d(0, ${SWAP_LIFT}px, 0)`
    : `translate3d(${dir > 0 ? SWAP_SHIFT : -SWAP_SHIFT}px, 0, 0)`;
  const ease = `${SWAP_MS}ms var(--ease-out-quint)`;
  return (
    <div
      ref={nodeRef}
      className={className}
      data-swap={String(k)}
      style={reduce ? undefined : {
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : off,
        // 되돌릴 때는 전환을 끄고 튕겨 놓는다 — 안 그러면 나가는 것과 들어오는 것이
        // 같은 자리에서 서로 되감겨 흐릿하게 흔들린다.
        transition: shown ? `opacity ${ease}, transform ${ease}` : 'none',
      }}
    >{children}</div>
  );
}

// ── 기다리는 자리 ───────────────────────────────────────────────────────────
// 자리를 먼저 잡아 두는 것이 목적이다 — 글자 한 줄("본문을 여는 중")로 두면 본문이
// 도착할 때 아래 것들이 통째로 밀린다(사용자 피드백 2026-09-01 '출렁임').
// 줄 길이를 조금씩 달리해 글 덩이처럼 보이게 한다.
const SKEL_W = ['92%', '86%', '96%', '78%', '90%', '84%', '94%', '72%', '88%', '82%', '95%', '76%'];

export function PassageSkeleton({ lines = 8, step = 1 }) {
  const f = FONT_STEPS[step] || FONT_STEPS[1];
  // 줄 길이 열두 개를 돌려 쓴다 — QT는 넘기기 직전 높이만큼 자리를 채우므로(wordView의
  // QtPassage) 열두 줄로는 긴 본문의 자리가 덜 차서 카드 아래가 비어 보인다
  const widths = Array.from({ length: Math.max(1, lines) }, (_, i) => SKEL_W[i % SKEL_W.length]);
  return (
    <div className="flex flex-col" style={{ gap: f.gap }} aria-hidden="true">
      {widths.map((w, i) => (
        // 크기는 **바깥**이 잡는다 — Skeleton은 className만 받고, `.dc-skeleton`이
        // position:relative를 박고 있어 위치 유틸은 어차피 먹지 않는다(media.jsx 머리말)
        <div key={i} style={{ width: w, height: `calc(${f.size} * ${f.line})` }}>
          <Skeleton className="w-full h-full rounded-[4px]" />
        </div>
      ))}
    </div>
  );
}

// ── 형광펜 한 벌 ────────────────────────────────────────────────────────────
// **글자가 있는 자리만 칠한다**(사용자 피드백 2026-09-02 4차 — "칠할 때 그 줄 블록
// 전체가 칠해진다"). 예전에는 절 <p>에 배경을 줘서, 짧은 절도 카드 오른쪽 끝까지
// 노랗게 그어졌다. 배경을 절 안의 인라인 요소로 내리고 `box-decoration-break: clone`을
// 걸면 여러 줄로 감기는 절도 **각 줄의 글자 폭만** 칠해진다(안 걸면 마지막 줄 끝까지
// 한 덩이로 이어진다). 좌우 padding은 같은 값의 음수 margin으로 상쇄해 글자 자리가
// 밀리지 않게 한다. 색은 업무 본문의 ==형광펜==과 같은 토큰이다(RichText·.tiptap mark).
const HL_STYLE = {
  borderRadius: '3px',
  padding: '1px 2px',
  margin: '0 -2px',
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
};

// **색은 네 가지다**(사용자 결정 2026-09-03 — 빨·파·노·초). 값은 업무 태그와 같은 토큰이라
// 다크 모드에서도 따라온다(Tailwind 기본 팔레트를 쓰면 themefit이 잡는다). 저장은
// bible_state.highlights 항목의 `color`이고, **색이 없는 예전 항목은 노랑으로 읽는다**
// (0038로 들어간 항목에는 색 칸이 없었다 — 마이그레이션 없이 화면에서 흡수한다).
export const HL_COLORS = [['red', '빨강'], ['blue', '파랑'], ['yellow', '노랑'], ['green', '초록']];
const HL_TOKEN = {
  red: ['var(--app-tag-red)', 'var(--app-tag-red-fg)'],
  blue: ['var(--app-tag-blue)', 'var(--app-tag-blue-fg)'],
  yellow: ['var(--app-tag-yellow)', 'var(--app-tag-yellow-fg)'],
  green: ['var(--app-tag-green)', 'var(--app-tag-green-fg)'],
};
export const hlColor = (c) => (HL_TOKEN[c] ? c : 'yellow');

function Hl({ color, children }) {
  const c = hlColor(color);
  const [bg, fg] = HL_TOKEN[c];
  return <mark data-lit={c} style={{ ...HL_STYLE, background: bg, color: fg }}>{children}</mark>;
}

// ── 본문 한 덩이 (QT 탭도 같이 쓴다) ───────────────────────────────────────
// marks: 형광펜이 켜진 절의 Map('장:절' → 색 이름)
// onPickVerse(chapter, verse): 절을 눌렀을 때(리더에서만 준다). **여기서 칠하지
//   않는다** — 부른 쪽이 도구 줄(VerseTool)을 넘겨 준다.
// picked: 지금 고른 **범위**의 '장:절' Set — 그 절들에 표시를 준다(사용자 결정 2026-09-03)
// toolAt: 그 범위의 마지막 절 '장:절' — 그 **다음 형제로** tool을 그린다
export function PassageText({
  verses, step = 1, showChapter = false, focus = null, marks = null, onPickVerse = null, picked = null,
  toolAt = null, tool = null,
}) {
  const f = FONT_STEPS[step] || FONT_STEPS[1];
  // 글을 끌어 고르고 손을 뗀 자리에도 click이 온다 — 고른 것이 있으면 팝오버를 띄우지
  // 않는다(복사하려고 고른 것을 형광펜으로 알아들으면 고른 것이 풀린다).
  const hit = (chapter, verse, el) => {
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    onPickVerse(chapter, verse, el);
  };
  return (
    <div className="flex flex-col" style={{ gap: f.gap }}>
      {verses.map(v => {
        // 이 판에서 비워 둔 절. 글자는 남기고 색만 죽인다 — 지우면 뒤 절 번호가 밀린다
        const blank = v.text === '(없음)';
        const on = focus && focus.chapter === v.chapter && focus.verse === v.verse;
        const key = `${v.chapter}:${v.verse}`;
        const litColor = marks?.get?.(key) || null;
        const lit = !!litColor;
        const isPicked = !!picked?.has?.(key);
        const style = { fontSize: f.size, lineHeight: f.line };
        // 형광펜은 절 상자가 아니라 글자에 걸린다(HL_STYLE) — 여기서 배경을 주지 말 것
        if (on) style.boxShadow = 'inset 0 0 0 1.5px var(--app-accent)';
        // **지금 도구 줄이 무엇을 대상으로 하는지 절이 말한다**(사용자 피드백 2026-09-03).
        // 왼쪽 accent 선 + 옅은 바닥. 형광펜(노랑, 글자)·검색 도착(테두리)과 안 겹친다.
        if (isPicked) { style.boxShadow = 'inset 2px 0 0 var(--app-accent)'; style.background = 'var(--app-surface-hover)'; }
        const line = (
          <p
            key={key}
            data-verse={key}
            data-focus={on ? '1' : undefined}
            data-mark={lit ? '1' : undefined}
            data-picked={isPicked ? '1' : undefined}
            role={onPickVerse ? 'button' : undefined}
            tabIndex={onPickVerse ? 0 : undefined}
            aria-expanded={onPickVerse ? toolAt === key : undefined}
            onClick={onPickVerse ? (e) => hit(v.chapter, v.verse, e.currentTarget) : undefined}
            onKeyDown={onPickVerse ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault(); onPickVerse(v.chapter, v.verse, e.currentTarget);
            } : undefined}
            className={`dc-verse rounded-[4px] transition-colors ${blank ? 'text-fg-faint' : 'text-fg-secondary'} ${
              on || isPicked ? '-mx-1.5 px-1.5' : ''} ${on && !isPicked ? 'bg-accent-weak' : ''} ${
              isPicked ? 'dc-verse-picked' : ''} ${onPickVerse ? 'cursor-pointer' : ''}`}
            style={style}
          >
            {/* 절 번호는 칠하지 않는다 — 형광펜은 읽은 글에 긋는 것이고, 번호까지 노래지면
                본문이 어디서 시작하는지가 흐려진다 */}
            <span className="mr-1.5 tabular-nums font-bold text-fg-faint" style={{ fontSize: f.mark }}>
              {showChapter ? `${v.chapter}:${v.verse}` : v.verse}
            </span>
            {lit ? <Hl color={litColor}>{v.text}</Hl> : v.text}
          </p>
        );
        // **도구 줄은 눌린 절 바로 다음 형제다**(사용자 피드백 2026-09-03 — 좌표를 재는
        // 팝오버는 어긋날 길이 여러 개였다. 문서 흐름 안에 있으면 어긋날 자리가 없다).
        // 칸 사이 간격(f.gap)만큼 음수 마진으로 당겨, 글자 크기를 바꿔도 절에 붙어 선다.
        //
        // **언제나 Fragment로 감싼다.** 고른 절만 감싸면 그 자리의 타입이 p ↔ Fragment로
        // 바뀌어 리액트가 <p>를 새로 만든다 — 누르는 순간 절 요소가 갈려서 그 절에 걸린
        // 것(선택·포커스·검사가 쥔 참조)이 통째로 끊긴다.
        return (
          <React.Fragment key={key}>
            {line}
            {tool && toolAt === key ? <div style={{ marginTop: `calc(2px - ${f.gap})` }}>{tool}</div> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── 절을 눌렀을 때의 도구 줄 ────────────────────────────────────────────────
// **누르자마자 칠하지 않는다**(사용자 피드백 2026-09-02). 본문을 읽다 보면 손이
// 스치기만 해도 절이 노래졌고, 되돌리려면 같은 자리를 또 눌러야 했다. 절을 누르면
// 무엇을 할지 먼저 묻는다 — 이미 칠해져 있으면 [형광펜 지우기], 아니면 [형광펜 칠하기]
// ('긋기'에서 바뀐 이름 — 2026-09-02 4차. 색을 입히는 일이라 '칠하기'다).
// 취소는 바깥 누름과 Esc다(따로 '취소' 줄을 두지 않는다 — 잃는 것이 없다).
//
// **좌표를 재지 않는다**(사용자 피드백 2026-09-03 — "형광펜 칠하기 버튼이 아직도 엉뚱한
// 곳에 뜬다"). 예전에는 body 포털 + useAnchoredPos로 눌린 절 옆에 fixed로 세웠는데,
// 어긋날 자리가 세 군데였다: ① 위치가 state라 tailwind `duration-*`이 top/left까지 전이
// (§6-17-b) ② 앵커를 갈아 끼우면 배치 훅이 다시 안 돈다 ③ 스크롤·리사이즈·주소 줄
// 접힘처럼 rect가 바뀌는 순간마다 다시 재야 한다. 지금은 **눌린 절의 다음 형제**로
// 문서 흐름 안에 그린다(PassageText의 `tool`) — 잴 것이 없으니 어긋날 수도 없다.
// 대상이 무엇인지는 절 자신이 말한다(왼쪽 accent 선 + 옅은 바닥, `dc-verse-picked`).
//
// **여기는 색이 늘 자리다.** 지금은 노랑 하나라 칩이 '무슨 색으로 칠하는지'를 보여 주는
// 표시다. 색이 늘면 칩을 색마다 하나씩 두고 각 칩이 그 색으로 칠하게 하면 된다
// (services/word.js의 verseKey는 그대로 두고 highlights 항목을 { ref, at, color }로 늘린다).
const toolBtn = 'inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] font-semibold text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors';

export function VerseTool({ label, current, lit, onPaint, onErase }) {
  return (
    // `pr-2`·`ml-1`이 칩 오른쪽 여백이다(사용자 지적 2026-09-03 — 칩이 테두리에 붙어 있었다)
    <span
      data-verse-tool={label} role="group" aria-label={`${label} 형광펜`}
      className="inline-flex items-center gap-1 p-1 pr-2 rounded-lg bg-surface border border-line shadow-soft animate-in fade-in duration-150"
    >
      <Highlighter size={13} className="shrink-0 mx-1 text-fg-faint" />
      {HL_COLORS.map(([c, ko]) => (
        <button
          key={c} type="button" data-hl-color={c} onClick={() => onPaint(c)}
          aria-pressed={current === c} title={`${ko}으로 칠하기`} aria-label={`${ko}으로 칠하기`}
          className="shrink-0 w-7 h-7 rounded-full transition active:scale-90"
          style={{
            background: HL_TOKEN[c][0],
            // 지금 칠해져 있는 색에는 accent 링이 돈다 — '현재 색'을 칩이 말한다
            boxShadow: current === c ? 'inset 0 0 0 2px var(--app-accent)' : 'inset 0 0 0 1px var(--app-line)',
          }}
        />
      ))}
      {/* 칠할 것이 없는데 지우기가 있으면 아무 일도 못 한다 — 켜져 있을 때만 세운다 */}
      {lit && (
        <button type="button" onClick={onErase} className={`${toolBtn} ml-1`}>
          <Eraser size={13} className="shrink-0" />형광펜 지우기
        </button>
      )}
    </span>
  );
}

// ── 글자 크기 Aa 3단계 ─────────────────────────────────────────────────────
function FontSteps({ step, onChange }) {
  return (
    <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
      {FONT_STEPS.map((f, i) => (
        <button
          key={i} onClick={() => onChange(i)} title={['작게', '보통', '크게'][i]}
          aria-label={`글자 ${['작게', '보통', '크게'][i]}`}
          className="px-2 py-[3px] rounded-[5px] font-bold leading-none transition-colors"
          style={{
            fontSize: [11, 13, 15][i],
            background: step === i ? 'var(--app-surface)' : 'transparent',
            color: step === i ? 'var(--app-ink)' : 'var(--app-ink-muted)',
          }}
        >Aa</button>
      ))}
    </span>
  );
}

// 빈 화면 표식 — 펼친 책. 왼쪽 면 → 오른쪽 면 → 가운데 선 순서로 그려진다(§4.2)
// 크기는 밖에서 준다 — 본문 자리(48px)와 옆 칸 '내 기록'(36px)이 쓰는 자리가 다르다.
export function EmptyBookMark({ className = 'w-12 h-12 mx-auto' }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path className="dc-draw" pathLength="1" d="M24 15c-4.6-3.2-9.8-3.6-15.5-1.2v21c5.7-2.4 10.9-2 15.5 1.2"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M24 15c4.6-3.2 9.8-3.6 15.5-1.2v21c-5.7-2.4-10.9-2-15.5 1.2"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M24 15v21"
        fill="none" stroke="var(--app-ink-faint)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const btn = 'inline-flex items-center justify-center gap-1 rounded-md text-[12px] font-semibold transition active:scale-95';
// 따라다니는 장 넘기기 버튼 — 테두리 없이 옅은 판 + 은은한 그림자, hover에서만 떠오른다.
// **전이는 opacity·배경색만**(위치 속성에 걸면 sticky가 미끄러진다 — §6-17-b).
const chapNav = 'sticky w-11 h-11 flex items-center justify-center rounded-full bg-surface/80 shadow-soft '
  + 'text-fg-muted opacity-80 hover:opacity-100 hover:bg-accent-weak hover:text-accent-text '
  + 'transition-[opacity,background-color,color] duration-150 active:scale-95';

// 목차 · 북마크 · 형광펜 — 세그먼트 모양은 말씀 화면의 [QT | 성경 읽기]와 같은 한 벌이다
const PANES = [['toc', '목차'], ['bookmark', '북마크'], ['highlight', '형광펜']];
const paneIndex = (key) => PANES.findIndex(p => p[0] === key);

// ── 성경 읽기 탭 ────────────────────────────────────────────────────────────
export function BibleTab({ initialRef = '' }) {
  const [books, setBooks] = useState([]);
  // **캐시가 있으면 그 값으로 시작한다**(사용자 요청 2026-09-03 — "매번 스켈레톤이 아니라
  // 캐시된 값이 먼저"). 이어읽기·북마크·형광펜은 이 화면이 직접 고치기도 해서
  // useCached(읽기 전용 훅)가 아니라 readCache/writeCache 한 쌍을 쓴다 — 고친 값을
  // 그 자리에서 캐시에 얹어야 다음 진입이 최신이다(update).
  const [state, setState] = useState(() => readCache(STATE_KEY) || { lastRef: '', bookmarks: [], highlights: [] });
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState(null);   // 책 목록을 못 받았을 때의 이유

  const [pane, setPane] = useState('toc');       // 'toc' | 'bookmark' | 'highlight'
  const [place, setPlace] = useState(null);      // { bookId, chapter } — 없으면 목차
  const [pickedBook, setPickedBook] = useState(null);  // 목차에서 고른 책(장 그리드)
  const [focus, setFocus] = useState(null);      // 검색 결과·형광펜 목록에서 들어온 절
  const [dir, setDir] = useState(0);             // 화면이 바뀌는 방향(이전/다음 장)

  const [chap, setChap] = useState(null);        // { key, verses } — 지금 장의 절 배열
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null);     // { done, total } · null이면 안 돌고 있다
  const searchToken = useRef(0);
  const bodyRef = useRef(null);

  // 형광펜 도구 줄이 붙은 **범위** — { anchor, from, to }(장 안의 절 번호).
  // 자리는 문서 흐름이 잡으므로 앵커 좌표가 없다(VerseTool 머리말).
  const [sel, setSel] = useState(null);

  // **장을 넘길 때 자리를 붙잡는다**(사용자 피드백 2026-09-03 — 본문이 비었다가 채워지며
  // 높이가 튀고 스크롤이 점프했다). QT가 하는 것과 같은 방식이다(wordView 머리말):
  // 넘기기 직전 카드 높이를 재어 두고, 기다리는 동안 그 높이만큼 스켈레톤을 세운다.
  // 스크롤은 **새 장이 도착한 뒤 한 번만** 본문 카드 위로 올린다 — 넘기는 순간에 옮기면
  // 아직 옛 장 높이라 두 번 움직인다.
  const cardRef = useRef(null);
  const headRef = useRef(null);
  const [holdH, setHoldH] = useState(0);
  const scrollWanted = useRef(false);

  // 넘긴 뒤에는 **장 제목 줄**로 올라간다(사용자 피드백 2026-09-03 — 1절이 아니라 그 줄이
  // 기준이다). `scrollIntoView({block:'start'})`만 쓰면 화면 위에 붙어 있는 내비 밑으로
  // 들어가 제목이 가려지므로, 스크롤 통을 찾아 그만큼 여유를 두고 올린다.
  const scrollToHead = () => {
    const el = headRef.current;
    if (!el) return;
    let box = el.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight + 8) break;
      box = box.parentElement;
    }
    const page = document.scrollingElement || document.documentElement;
    const scroller = box && box !== document.body ? box : page;
    const isPage = scroller === page;
    // 페이지가 스크롤되는 폭에서는 상단 내비가 화면에 붙어 있다(≈52px) — 그만큼 비운다.
    // 안쪽 통이 스크롤되는 폭에서는 그 통이 이미 내비 아래에서 시작하므로 조금만 띄운다.
    const pad = isPage ? 64 : 8;
    const base = isPage ? 0 : scroller.getBoundingClientRect().top;
    const top = scroller.scrollTop + el.getBoundingClientRect().top - base - pad;
    // **즉시 옮긴다**(사용자 피드백 2026-09-03 — "스르륵 올라가는 게 어색하다").
    // 장이 바뀌는 결은 Swap의 슬라이드가 내고, 스크롤은 그 프레임에 한 번 끝난다.
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  };

  const bookOf = useCallback((id) => books.find(b => b.id === id) || null, [books]);

  // 첫 진입 — 책 목록 · 내 상태(이어읽기·북마크·형광펜) · 글자 크기
  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, saved] = await Promise.all([loadBibleIndex(), loadBibleState()]);
      if (!alive) return;
      setBooks(list);
      setState(saved);
      writeCache(STATE_KEY, saved);
      setStep(loadFontStep());
      // 주보·QT에서 넘어온 구절이 먼저다. 없으면 마지막으로 읽던 자리로 이어간다.
      const fromRef = initialRef ? parseRef(initialRef, list) : null;
      const last = fromRef
        ? { bookId: fromRef.bookId, chapter: fromRef.start.chapter }
        : parseChapterKey(saved.lastRef);
      if (last && list.some(b => b.id === last.bookId)) setPlace(last);
      setReady(true);
    })().catch(err => {
      // 예전에는 조용히 빈 목록으로 떨어져 '구약 0권 · 신약 0권'이 떴다 — 화면이
      // 거짓말을 하지 않게 이유를 들고 있는다(사용자 피드백 2026-09-03).
      console.error('[word] 성경 목차 읽기 실패:', err);
      setLoadErr(err || true); setReady(true);
    });
    return () => { alive = false; };
  }, [initialRef]);

  // 지금 장의 본문. **어느 장의 것인지 같이 들고 있는다** — 장을 넘긴 직후 한 프레임
  // 동안 앞 장의 절이 새 제목 밑에 남아 있었다.
  useEffect(() => {
    if (!place) { setChap(null); return undefined; }
    const key = chapterKey(place.bookId, place.chapter);
    let alive = true;
    loadBook(place.bookId)
      .then(data => { if (alive) setChap({ key, verses: data.chapters[place.chapter - 1] || [] }); })
      // **못 받았으면 못 받았다고 말한다**(사용자 피드백 2026-09-03 — 예외 문구 검토).
      // 예전에는 빈 절 배열로 떨어져서 카드 안이 통째로 비었고, 화면은 아무 말도 안 했다.
      .catch(err => { if (alive) setChap({ key, verses: [], failed: err || true }); });
    return () => { alive = false; };
  }, [place]);

  const here = place ? bookOf(place.bookId) : null;
  const placeKey = place ? chapterKey(place.bookId, place.chapter) : '';
  const loaded = !!place && chap?.key === placeKey;

  // 검색·형광펜 목록에서 들어온 절로 데려간다
  useEffect(() => {
    if (!focus || !loaded) return;
    const el = bodyRef.current?.querySelector('[data-focus="1"]');
    el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [focus, loaded]);

  // 장을 넘겨서 온 경우에만, **새 장이 도착한 그때 한 번** 본문 카드 위로 올린다
  useEffect(() => {
    if (!loaded || !scrollWanted.current) return;
    scrollWanted.current = false;
    scrollToHead();
  }, [loaded, placeKey]);

  // 기다리는 동안 세울 스켈레톤 줄 수 — 붙잡아 둔 높이를 채운다(한 줄 ≈ 34px)
  const holdLines = holdH ? Math.max(8, Math.round((holdH - 44) / 34)) : 10;

  // what을 주면 **못 남겼을 때 이유까지 말한다**(사용자 피드백 2026-09-03 — 예외 문구).
  // 예전에는 saveBibleState가 실패를 삼켜서, 클라우드에 안 남은 형광펜이 화면에는
  // 칠해져 있었다(새로 열면 사라진다). 이어읽기(lastRef)만 바뀌는 호출은 조용히 넘긴다.
  const update = (next, what = '') => {
    setState(next);
    writeCache(STATE_KEY, next);   // 고친 값이 곧 다음 진입의 첫 화면이다

    saveBibleState(next).then(r => {
      if (what && r && r.ok === false) showToast(failText(what, r.error));
    }).catch(() => {});
  };
  const goto = (bookId, chapter, at = null, delta = 0) => {
    setDir(delta);
    setPane('toc');          // 북마크·형광펜 줄에서 왔어도 이제 보는 것은 본문이다
    setPlace({ bookId, chapter });
    setFocus(at);
    setSel(null);       // 자리를 옮기면 고른 절이 사라진다 — 선택도 같이 내린다
    setQuery(''); setTyped(''); setResults([]); setProgress(null);
    searchToken.current++;
    update({ ...state, lastRef: chapterKey(bookId, chapter) });
  };

  // 장을 옮긴다. 책의 끝을 넘으면 다음 책 1장으로 이어진다(성경은 한 권이다).
  // **넘긴 뒤에는 본문 맨 위로 돌아온다**(사용자 피드백 2026-09-03 — 아래쪽에서 넘기면
  // 새 장의 중간부터 보였다). 검색·형광펜에서 절을 물고 들어오는 goto와 달리 여기는
  // 언제나 첫 절부터 읽는 자리다.
  const move = (delta) => {
    if (!place) return;
    const idx = books.findIndex(b => b.id === place.bookId);
    const at = books[idx];
    const next = place.chapter + delta;
    const nb = books[idx + delta];
    if (next >= 1 && next <= at.chapters) goto(place.bookId, next, null, delta);
    else if (nb) goto(nb.id, delta > 0 ? 1 : nb.chapters, null, delta);
    else return;
    setHoldH(cardRef.current?.offsetHeight || 0);
    scrollWanted.current = true;
  };

  // 성경의 처음(창세기 1장)·끝(요한계시록 마지막 장)에서는 그쪽 화살표를 세우지 않는다
  const bookIdx = place ? books.findIndex(b => b.id === place.bookId) : -1;
  const canPrev = !!place && bookIdx >= 0 && !(bookIdx === 0 && place.chapter === 1);
  const canNext = !!place && bookIdx >= 0
    && !(bookIdx === books.length - 1 && place.chapter === (books[bookIdx]?.chapters || 1));

  // 모바일은 **쓸어서** 넘긴다(사용자 피드백 2026-09-03 — 화살표가 맨 아래라 스크롤을 다
  // 내려야 넘길 수 있었다). 가로 이동이 60px을 넘고 세로보다 커야 장이 바뀐다 — 읽다가
  // 위아래로 훑는 손짓과 갈라야 한다. 쓸고 난 뒤의 click은 절 선택으로 세지 않는다
  // (터치 기기는 손을 떼는 자리에 click을 한 번 더 보낸다).
  const touchAt = useRef(null);
  const swipedAt = useRef(0);
  const onTouchStart = (e) => {
    const t = e.touches && e.touches[0];
    touchAt.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e) => {
    const from = touchAt.current;
    touchAt.current = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!from || !t) return;
    const dx = t.clientX - from.x, dy = t.clientY - from.y;
    if (Math.abs(dx) > 10) swipedAt.current = Date.now();
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dy) > Math.abs(dx)) return;   // 세로로 더 움직였으면 스크롤이다
    if (dx < 0 ? canNext : canPrev) move(dx < 0 ? 1 : -1);
  };

  const runSearch = async (raw) => {
    const q = raw.trim();
    const token = ++searchToken.current;
    setQuery(q);
    setPane('toc');           // 결과는 본문 열의 자리에 그린다
    setFocus(null);
    setDir(0);
    if (!q) { setResults([]); setProgress(null); return; }
    setResults([]); setProgress({ done: 0, total: books.length });
    const out = [];
    for (let i = 0; i < books.length; i++) {
      if (token !== searchToken.current) return;
      const b = books[i];
      let data = null;
      try { data = await loadBook(b.id); } catch { /* 한 권을 못 받아도 나머지는 찾는다 */ }
      if (token !== searchToken.current) return;
      if (data) {
        for (let c = 0; c < data.chapters.length && out.length < RESULT_LIMIT; c++) {
          const verses = data.chapters[c];
          for (let v = 0; v < verses.length; v++) {
            if (!verses[v].includes(q)) continue;
            out.push({ bookId: b.id, name: b.name, chapter: c + 1, verse: v + 1, text: verses[v] });
            if (out.length >= RESULT_LIMIT) break;
          }
        }
      }
      setResults(out.slice());
      setProgress({ done: i + 1, total: books.length });
      if (out.length >= RESULT_LIMIT) break;
      await new Promise(r => setTimeout(r, 0));   // 진행이 화면에 그려질 틈
    }
    if (token === searchToken.current) setProgress(p => (p ? { ...p, done: books.length } : null));
  };

  const clearSearch = () => {
    searchToken.current++;
    setQuery(''); setTyped(''); setResults([]); setProgress(null);
  };

  const verses = useMemo(() => (loaded ? chap.verses : []).map((text, i) => ({
    chapter: place?.chapter || 1, verse: i + 1, text,
  })), [chap, loaded, place]);
  const marked = place && state.bookmarks.some(b => b.ref === placeKey);

  const toggleBookmark = () => {
    if (!place || !here) return;
    const bookmarks = marked
      ? state.bookmarks.filter(b => b.ref !== placeKey)
      : [...state.bookmarks, { ref: placeKey, label: `${here.name} ${place.chapter}장`, at: new Date().toISOString() }];
    update({ ...state, bookmarks },
      marked ? `${here.name} ${place.chapter}장을 북마크에서 빼지 못했어요` : `${here.name} ${place.chapter}장을 북마크에 넣지 못했어요`);
  };

  // 이 장에 켜진 형광펜 — PassageText는 '장:절' → 색 Map으로 본다
  const marks = useMemo(() => {
    if (!place) return null;
    const pre = `${place.bookId} ${place.chapter}:`;
    const map = new Map();
    for (const h of state.highlights || []) {
      const ref = String(h?.ref || '');
      if (ref.startsWith(pre)) map.set(ref.slice(place.bookId.length + 1), hlColor(h?.color));
    }
    return map;
  }, [state.highlights, place]);

  // ── 범위 고르기(사용자 결정 2026-09-03) ────────────────────────────────────
  // **앵커 방식**이다. 첫 클릭이 앵커고, 다음 클릭은 앵커와 그 절 사이를 범위로 만든다:
  // 4 → 1이면 1~4, 1 → 4도 1~4, 1~3에서 6을 누르면 1~6, 1~6에서 5를 누르면 1~5로
  // **줄어든다**(역으로 취소). 앵커를 다시 누르면 해제. 늘리기와 취소가 같은 손짓이라
  // '범위 시작/끝' 두 모드를 만들지 않아도 된다.
  const pickVerse = (chapter, verse) => {
    if (Date.now() - swipedAt.current < 400) return;   // 방금 쓸었다면 그건 넘기려던 손이다
    setSel(prev => {
      if (!prev) return { anchor: verse, from: verse, to: verse };
      if (verse === prev.anchor) return null;
      return { anchor: prev.anchor, from: Math.min(prev.anchor, verse), to: Math.max(prev.anchor, verse) };
    });
  };

  // 바깥을 누르거나 Esc면 해제한다. **고른 절과 도구 줄은 '안'이다** — 여기서 닫아 버리면
  // mousedown이 닫고 곧바로 click이 다시 여는 꼴이 된다.
  useEffect(() => {
    if (!sel) return undefined;
    const onDown = (e) => {
      if (e.target?.closest?.('[data-verse-tool], [data-picked="1"]')) return;
      setSel(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [sel]);

  // 고른 범위 — 화면에 줄 표시(Set) · 저장에 쓸 참조 목록 · 지금 색 · 라벨
  const selKeys = useMemo(() => {
    if (!sel || !place) return null;
    const set = new Set();
    for (let v = sel.from; v <= sel.to; v++) set.add(`${place.chapter}:${v}`);
    return set;
  }, [sel, place]);
  const selRefs = useMemo(() => (!sel || !place ? []
    : Array.from({ length: sel.to - sel.from + 1 }, (_, i) => verseKey(place.bookId, place.chapter, sel.from + i))),
  [sel, place]);
  const selHits = selRefs.map(ref => (state.highlights || []).find(h => h?.ref === ref)).filter(Boolean);
  const selLit = selHits.length > 0;
  const selColor = selLit ? hlColor(selHits[0].color) : null;
  const selLabel = sel
    ? `${here?.name || ''} ${place.chapter}:${sel.from}${sel.to > sel.from ? `~${sel.to}` : ''}`.trim()
    : '';
  // 도구 줄은 **범위의 마지막 절 아래**에 선다(사용자 결정 2026-09-03)
  const toolAt = sel && place ? `${place.chapter}:${sel.to}` : null;

  // 범위 전체를 그 색으로 칠한다 — 이미 다른 색이면 **덧칠**이다(같은 절이 두 번 남지
  // 않게 먼저 걷어내고 다시 넣는다).
  const paintRange = (color) => {
    if (!selRefs.length) return;
    const at = new Date().toISOString();
    const rest = (state.highlights || []).filter(h => !selRefs.includes(h?.ref));
    const label = selLabel;
    setSel(null);
    update({ ...state, highlights: [...rest, ...selRefs.map(ref => ({ ref, at, color }))] },
      `${label}에 형광펜을 칠하지 못했어요`);
  };
  const eraseRange = () => {
    if (!selRefs.length || !selLit) return;
    const label = selLabel;
    setSel(null);
    update({ ...state, highlights: (state.highlights || []).filter(h => !selRefs.includes(h?.ref)) },
      `${label}의 형광펜을 지우지 못했어요`);
  };

  const searching = !!progress && progress.done < progress.total && results.length < RESULT_LIMIT;

  // 북마크·형광펜 — 책으로 묶어 정경 순으로. 파싱이 안 되는 옛 값은 그룹에 못 들어가므로
  // 개수는 실제로 그린 줄로 센다
  const bookGroups = useMemo(() => groupByBook(state.bookmarks || [], books, parseChapterKey), [state.bookmarks, books]);
  const litGroups = useMemo(() => groupByBook(state.highlights || [], books, parseVerseKey), [state.highlights, books]);
  const bookTotal = bookGroups.reduce((n, g) => n + g.items.length, 0);
  const litTotal = litGroups.reduce((n, g) => n + g.items.length, 0);

  const pickPane = (key) => {
    if (key === pane) return;
    setDir(paneIndex(key) > paneIndex(pane) ? 1 : -1);
    setPane(key);
  };

  // 화면이 바뀌는 단위 — 이 값이 달라지면 Swap이 새로 들여보낸다
  const viewKey = pane !== 'toc' ? `m:${pane}`
    : query ? `q:${query}` : place ? `p:${placeKey}` : pickedBook ? `b:${pickedBook}` : 'toc';

  return (
    <div className="min-w-0">
      {/* 검색 · 글자 크기 — 목차에서도 리더에서도 같은 자리 */}
      <div data-col="searchbar" className="flex items-center gap-2 pb-2.5">
        <form
          onSubmit={e => { e.preventDefault(); runSearch(typed); }}
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2.5 h-9 rounded-md"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}
        >
          <Search size={14} className="shrink-0 text-fg-faint" />
          <input
            value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="본문 검색" aria-label="본문 검색"
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-faint outline-none"
          />
          {(typed || query) && (
            <button type="button" onClick={clearSearch} aria-label="검색어 지우기"
              className="shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors">
              <X size={13} />
            </button>
          )}
        </form>
        <FontSteps step={step} onChange={n => { setStep(n); saveFontStep(n); }} />
      </div>

      {/* 목차 · 북마크 · 형광펜 — 어느 폭에서도, 본문을 읽는 중에도 늘 여기 있다 */}
      <div className="flex items-center gap-2 pb-3.5">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {PANES.map(([key, label]) => (
            <button
              key={key} data-pane={key} onClick={() => pickPane(key)} aria-pressed={pane === key}
              className="px-3 py-[6px] rounded-[5px] text-[12px] font-semibold transition-colors"
              style={{
                background: pane === key ? 'var(--app-surface)' : 'transparent',
                color: pane === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}
            >{label}</button>
          ))}
        </span>
      </div>

      <Swap k={viewKey} dir={dir} className="min-w-0">
        {pane === 'bookmark' ? (
          <MarkSection
            title="북마크" unit="장" kind="bookmark" groups={bookGroups} total={bookTotal}
            empty="북마크한 장을 여기서 볼 수 있어요"
            onOpenItem={at => goto(at.bookId, at.chapter)}
            onRemoveItem={ref => update({ ...state, bookmarks: state.bookmarks.filter(b => b.ref !== ref) },
              '북마크를 지우지 못했어요')}
          />
        ) : pane === 'highlight' ? (
          <MarkSection
            title="형광펜" unit="절" kind="highlight" groups={litGroups} total={litTotal}
            empty="형광펜을 칠한 절은 여기서 볼 수 있어요"
            onOpenItem={at => goto(at.bookId, at.chapter, { chapter: at.chapter, verse: at.verse })}
            onRemoveItem={ref => update({ ...state, highlights: (state.highlights || []).filter(h => h?.ref !== ref) },
              '형광펜을 지우지 못했어요')}
          />
        ) : query ? (
          <SearchResults
            query={query} results={results} progress={progress} searching={searching}
            onOpen={r => goto(r.bookId, r.chapter, { chapter: r.chapter, verse: r.verse })}
          />
        ) : place ? (
          <div ref={bodyRef} data-col="read" className="min-w-0">
            {/* 좁은 폭에서도 셋이 한 줄에 그대로 선다 — 제목만 줄어들고(min-w-0 truncate)
                양쪽 버튼은 shrink-0에 44px 터치 타깃이다(사용자 피드백 2026-09-02 4차) */}
            <div ref={headRef} data-chap-head="" className="flex items-center gap-1.5 pb-3">
              {/* 세그먼트가 '목차'라는 이름을 가져갔으므로 이 버튼은 **책 목록**이다 —
                  한 화면에 같은 이름의 버튼이 둘이면 어느 쪽이 어디로 가는지 알 수 없다
                  (장 그리드의 되돌아가는 버튼이 이미 '책 목록'이라 이름도 한 벌이 된다) */}
              <button onClick={() => { setDir(-1); setPlace(null); setPickedBook(null); }}
                className={`${btn} shrink-0 pl-2 pr-3 h-11 text-fg-muted hover:bg-surface-hover`}>
                <ChevronLeft size={15} />책 목록
              </button>
              <h3 className="bible-place flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">
                {here?.name} {place.chapter}장
              </h3>
              <button onClick={toggleBookmark} title={marked ? '북마크 지우기' : '북마크에 넣기'}
                aria-label={marked ? '북마크 지우기' : '북마크에 넣기'}
                className={`${btn} shrink-0 w-11 h-11 ${marked ? 'text-accent-text bg-accent-weak' : 'text-fg-muted hover:bg-surface-hover'}`}>
                <Bookmark size={16} fill={marked ? 'currentColor' : 'none'} />
              </button>
            </div>

            {/* **화살표는 본문 옆에서 따라다닌다**(사용자 피드백 2026-09-03 — 데스크톱).
                44px 버튼이 양옆 칸에서 `sticky`로 화면 가운데 높이에 머문다: 스크롤을
                아무리 내려도 눈높이에 있고, 본문 가장자리 밖이라 글자를 가리지 않는다.
                좁은 화면에는 그 칸이 없다 — 거기서는 쓸어서 넘긴다(onTouchEnd).
                모양은 **테두리 없는 옅은 판**이다(사용자 피드백 2026-09-03 — "너무 구식,
                조금 더 세련되게"): bg-surface/80 + shadow-soft에 hover에서만 accent-weak로
                떠오른다. 전이는 opacity·배경색만 건다 — 위치 속성에 transition을 걸면
                sticky가 스크롤마다 미끄러진다(§6-17-b).
                본문과의 간격도 6px 더 벌렸다(gap-1.5 → gap-3). */}
            <div data-chap-swipe="" className="flex items-stretch gap-3"
              onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div className="hidden md:flex w-11 shrink-0 justify-center">
                {canPrev && (
                  <button data-chap-nav="prev" onClick={() => move(-1)} aria-label="이전 장" title="이전 장"
                    className={chapNav} style={{ top: '45vh' }}>
                    <ChevronLeft size={16} />
                  </button>
                )}
              </div>

              <div ref={cardRef} className="flex-1 min-w-0">
              <Card className="p-4 md:p-5"
                style={{ minHeight: loaded ? undefined : (holdH || undefined) }}>
              {loaded && !verses.length ? (
                <p className="text-[12.5px] text-fg-muted whitespace-pre-line">
                  {chap?.failed
                    ? failText(`${here?.name || ''} ${place.chapter}장의 본문을 불러오지 못했어요`, chap.failed)
                    : '이 장에는 본문이 들어 있지 않아요'}
                </p>
              ) : loaded
                ? <PassageText
                    verses={verses} step={step} focus={focus} marks={marks}
                    onPickVerse={pickVerse} picked={selKeys} toolAt={toolAt}
                    tool={sel ? (
                      <VerseTool
                        label={selLabel} current={selColor} lit={selLit}
                        onPaint={paintRange} onErase={eraseRange}
                      />
                    ) : null}
                  />
                : <PassageSkeleton lines={holdLines} step={step} />}
              </Card>
              </div>

              <div className="hidden md:flex w-11 shrink-0 justify-center">
                {canNext && (
                  <button data-chap-nav="next" onClick={() => move(1)} aria-label="다음 장" title="다음 장"
                    className={chapNav} style={{ top: '45vh' }}>
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* 아래쪽 두 버튼은 그대로 둔다(사용자 결정 2026-09-03) — 끝에서는 누를 것이
                없으므로 그쪽만 꺼 둔다 */}
            <div className="flex items-center gap-2 pt-3.5">
              <button onClick={() => move(-1)} disabled={!canPrev} aria-label="이전 장"
                className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent`}
                style={{ border: '1px solid var(--app-line)' }}>
                <ChevronLeft size={14} />이전 장
              </button>
              <button onClick={() => move(1)} disabled={!canNext} aria-label="다음 장"
                className={`${btn} flex-1 h-10 text-fg-muted hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent`}
                style={{ border: '1px solid var(--app-line)' }}>
                다음 장<ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          <Toc books={books} ready={ready} failed={loadErr} picked={pickedBook}
            setPicked={id => { setDir(id ? 1 : -1); setPickedBook(id); }} onOpen={goto} />
        )}
      </Swap>
    </div>
  );
}

// ── 북마크 · 형광펜 목록 ────────────────────────────────────────────────────
// 세그먼트로 고른 것 하나만 그린다(BibleTab 머리말). 누르면 그 자리로 간다 — 형광펜은
// 절까지 데려가고 그 절이 화면 가운데에 선다.
//
// **책으로 묶는다**(사용자 피드백 2026-09-02 — "북마크·형광펜이 계속 쌓인다").
// 평평한 칩 목록은 스무 개만 넘어가도 어디가 어디인지 안 보였다. 정경 순으로 책마다
// 묶고, 책 머리글에 개수를 적고, 책 단위로 접었다 편다.
//
// **펼친 책의 파일만 그때 받는다.** 형광펜 줄에 절 미리보기를 한 줄 붙이려면 그 책
// 파일이 필요한데, 목록 전체를 미리 받으면 여러 권에 걸친 사람은 목록 하나에 몇 MB를
// 받는다. 그래서 펼칠 때 loadBook 한 권만 부른다(services/bible.js가 캐시하므로 두 번째
// 부터는 즉시 온다). 북마크는 장 제목이면 되므로 파일이 필요 없다 — 받지 않는다.
//
// **기본 펼침/접힘의 기준**: 책이 두 권까지면 펼쳐 둔다. 그때는 접힌 껍데기가 오히려
// 손을 한 번 더 쓰게 만든다(줄이 서너 개인데 머리글만 보이는 꼴). 세 권부터는 접어
// 둔다 — 그 정도면 목록이 화면을 넘기고, 무엇이 어느 책에 있는지가 먼저 궁금해진다.
// 사람이 직접 접거나 편 책은 그 선택이 이긴다(open에 남는다).
const AUTO_OPEN_BOOKS = 2;

// 책별로 묶어 정경 순으로 돌려준다 — [{ book, items }]
function groupByBook(entries, books, parse) {
  const bag = new Map();
  for (const e of entries) {
    const at = parse(e?.ref);
    if (!at) continue;
    if (!bag.has(at.bookId)) bag.set(at.bookId, []);
    bag.get(at.bookId).push({ ...e, at });
  }
  // books가 곧 정경 순이다(index.json). 책 안에서는 장·절 순 — 읽는 차례와 같다.
  return books
    .filter(b => bag.has(b.id))
    .map(b => ({
      book: b,
      items: bag.get(b.id).sort((x, y) => (x.at.chapter - y.at.chapter) || ((x.at.verse || 0) - (y.at.verse || 0))),
    }));
}

const markRow = 'flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors';

// 책 하나 — 머리글(개수) + 펼쳤을 때의 줄들. kind: 'bookmark' | 'highlight'
function MarkBookGroup({ book, items, kind, open, onToggle, onOpenItem, onRemoveItem }) {
  const [chapters, setChapters] = useState(null);   // 형광펜 미리보기용 절 본문
  const reduce = prefersReducedMotion();
  const needsText = kind === 'highlight';

  // 펼친 책만, 펼친 그때 받는다
  useEffect(() => {
    if (!open || !needsText || chapters) return undefined;
    let alive = true;
    loadBook(book.id)
      .then(d => { if (alive) setChapters(d.chapters || []); })
      .catch(() => { if (alive) setChapters([]); });   // 못 받아도 참조 줄은 남는다
    return () => { alive = false; };
  }, [open, needsText, chapters, book.id]);

  return (
    <div className="min-w-0">
      <button
        onClick={onToggle} aria-expanded={open} data-book-group={`${kind}:${book.id}`}
        className="w-full flex items-center gap-1.5 px-2 -mx-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors text-left"
      >
        <ChevronDown
          size={13} className="shrink-0 text-fg-faint"
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: reduce ? 'none' : 'transform .18s var(--ease-out-quint)' }}
        />
        {/* 개수는 이름 **바로 옆**이다 — 오른쪽 끝에 붙이면 열이 넓어질수록 이름과 개수가
            멀어져 한 줄로 읽히지 않는다(폭 상한을 없앤 2026-09-03 회차) */}
        <span className="min-w-0 truncate text-[11.5px] font-bold text-fg">{book.name}</span>
        <span className="shrink-0 text-[11px] text-fg-faint tabular-nums">
          {items.length}{kind === 'bookmark' ? '장' : '절'}
        </span>
        <span className="flex-1" />
      </button>

      {open && (
        <div className="pl-[18px] flex flex-col">
          {items.map(it => {
            const { chapter, verse } = it.at;
            const label = kind === 'bookmark'
              ? (it.label || `${book.name} ${chapter}장`)
              : `${book.name} ${chapter}:${verse}`;
            // 형광펜 미리보기 한 줄. 아직 안 왔으면 자리만 잡아 둔다(오면서 밀지 않게)
            const preview = needsText && chapters ? (chapters[chapter - 1]?.[verse - 1] || '') : '';
            return (
              <span key={it.ref} className="flex items-center gap-0.5">
                <button data-goto={it.ref} onClick={() => onOpenItem(it.at)} className={markRow}>
                  {kind === 'bookmark' ? (
                    <span className="block truncate text-[11.5px] font-semibold text-fg">{chapter}장</span>
                  ) : (
                    <span className="block truncate">
                      <span className="text-[11px] font-bold text-accent-text tabular-nums">{chapter}:{verse}</span>
                      {/* 발췌는 리더에서 칠한 그 색으로 그린다 — 색이 곧 '무엇으로
                          칠했는지'다(색이 늘면 항목의 색 값을 그대로 넘긴다) */}
                      {needsText && !chapters
                        ? <span className="inline-flex align-middle ml-1.5 w-24 h-3"><Skeleton className="w-full h-full rounded-[3px]" /></span>
                        : <span className="ml-1.5 text-[11.5px]">{preview ? <Hl color={it.color}>{preview}</Hl> : ''}</span>}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRemoveItem(it.ref)}
                  aria-label={`${label} ${kind === 'bookmark' ? '북마크' : '형광펜'} 지우기`}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 한 칸(북마크 또는 형광펜) — 제목 · 총 개수 · 책 그룹들, 비었으면 마크와 한 줄.
// 책 묶음은 넓은 화면에서 여러 열로 선다 — 목록은 격자라 읽기 폭에 갇힐 이유가 없다.
function MarkSection({ title, unit, empty, groups, total, kind, onOpenItem, onRemoveItem }) {
  // 사람이 직접 접거나 편 책만 남는다 — 나머지는 책 수에 따라 기본값을 따른다
  const [open, setOpen] = useState({});
  const auto = groups.length <= AUTO_OPEN_BOOKS;

  return (
    <div data-col={kind} className="min-w-0">
      <SectionHead right={total
        ? <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{total}{unit}</span> : null}>
        {title}
      </SectionHead>
      {!total ? (
        // 빈 칸은 남는 자리의 가운데에 마크와 함께 선다(§8). 표식은 SVG 선 그리기다 —
        // 캐릭터 컷은 홈에만 둔다(사용자 결정 2026-09-03).
        <div className="min-h-[38vh] flex flex-col items-center justify-center text-center">
          <EmptyBookMark />
          <p className="text-[13.5px] font-semibold text-fg mt-3">{empty}</p>
        </div>
      ) : (
        <div className="grid gap-x-7 items-start sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => (
            <MarkBookGroup
              key={g.book.id} book={g.book} items={g.items} kind={kind}
              open={open[g.book.id] ?? auto}
              onToggle={() => setOpen(o => ({ ...o, [g.book.id]: !(o[g.book.id] ?? auto) }))}
              onOpenItem={onOpenItem} onRemoveItem={onRemoveItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 목차 (책 목록 → 장 그리드) ──────────────────────────────────────────────
function Toc({ books, ready, failed = null, picked, setPicked, onOpen }) {
  if (!ready) return <TocSkeleton />;
  // 못 받은 것을 '0권'으로 그리지 않는다(사용자 피드백 2026-09-03 — 예외 문구)
  if (!books.length) {
    return (
      <div data-col="toc" className="min-h-[38vh] flex flex-col items-center justify-center text-center">
        <EmptyBookMark />
        <p className="text-[13.5px] font-semibold text-fg mt-3 whitespace-pre-line">
          {failed ? failText('성경 목차를 불러오지 못했어요', failed) : '성경 목차가 아직 준비되지 않았어요'}
        </p>
      </div>
    );
  }

  if (picked) {
    const b = books.find(x => x.id === picked);
    if (!b) return null;
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2 pb-3">
          <button onClick={() => setPicked(null)}
            className={`${btn} shrink-0 pl-1.5 pr-2.5 h-8 text-fg-muted hover:bg-surface-hover`}>
            <ChevronLeft size={14} />책 목록
          </button>
          <h3 className="flex-1 min-w-0 truncate text-[15px] font-extrabold text-fg tracking-[-0.3px]">{b.name}</h3>
          <span className="shrink-0 text-[11.5px] text-fg-faint tabular-nums">{b.chapters}장</span>
        </div>
        <div className="grid gap-1.5 grid-cols-6 sm:grid-cols-8 lg:grid-cols-10">
          {Array.from({ length: b.chapters }, (_, i) => (
            <button key={i} onClick={() => onOpen(b.id, i + 1, null, 1)}
              className="h-10 rounded-md text-[12.5px] font-semibold text-fg-muted tabular-nums hover:bg-surface-hover transition active:scale-95"
              style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-col="toc" className="min-w-0 flex flex-col gap-6">
      {[['구약', books.slice(0, OT_COUNT)], ['신약', books.slice(OT_COUNT)]].map(([title, list]) => (
        <div key={title}>
          <SectionHead right={<span className="text-[11px] text-fg-faint tabular-nums shrink-0">{list.length}권</span>}>
            {title}
          </SectionHead>
          <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {list.map(b => (
              <button key={b.id} onClick={() => setPicked(b.id)}
                className="px-2 h-10 rounded-md text-[12.5px] font-semibold text-fg truncate hover:bg-surface-hover transition active:scale-95"
                style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 목차가 오기 전 자리 — 구약 39 · 신약 27권 그리드와 같은 모양으로 세워 둔다
function TocSkeleton() {
  return (
    <div className="min-w-0 flex flex-col gap-6" aria-hidden="true">
      {[39, 27].map((n, k) => (
        <div key={k}>
          <div className="flex items-center gap-2 pb-2.5">
            <Skeleton className="h-3.5 w-10 rounded-[4px]" />
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          </div>
          <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 검색 결과 ───────────────────────────────────────────────────────────────
function SearchResults({ query, results, progress, searching, onOpen }) {
  const capped = results.length >= RESULT_LIMIT;
  return (
    <div data-col="search" className="min-w-0">
      <div className="flex items-center gap-2 pb-2.5">
        <span className="text-[12.5px] font-bold text-fg truncate min-w-0">{query}</span>
        <span className="text-[11.5px] text-fg-faint tabular-nums shrink-0">
          {searching
            ? `${progress.done}/${progress.total}권 훑는 중 · ${results.length}건`
            : capped ? `앞에서부터 ${results.length}건` : `${results.length}건`}
        </span>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
      </div>

      {!results.length ? (
        searching
          ? <PassageSkeleton lines={5} />
          : (
            <div className="min-h-[38vh] flex flex-col items-center justify-center text-center">
              <EmptyBookMark />
              <p className="text-[13px] font-semibold text-fg mt-3">개역한글 본문에서 그 말이 그대로 나오는 절을 찾지 못했어요</p>
            </div>
          )
      ) : (
        <div className="flex flex-col">
          {results.map(r => (
            <button key={`${r.bookId}-${r.chapter}-${r.verse}`} onClick={() => onOpen(r)}
              data-hit={verseKey(r.bookId, r.chapter, r.verse)}
              className="text-left py-2.5 px-2.5 -mx-2.5 rounded-[8px] hover:bg-surface-hover transition-colors">
              <span className="block text-[11.5px] font-bold text-accent-text tabular-nums">
                {r.name} {r.chapter}:{r.verse}
              </span>
              <span className="block text-[12.5px] leading-relaxed text-fg-secondary mt-0.5">
                {highlight(r.text, query)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 찾은 말을 표시한다 — 색은 토큰(tag-yellow)이라 다크에서도 따라온다
function highlight(text, q) {
  const i = text.indexOf(q);
  if (i < 0 || !q) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] px-0.5" style={{ background: 'var(--app-tag-yellow)', color: 'var(--app-tag-yellow-fg)' }}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}
