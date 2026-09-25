import React, { useMemo } from 'react';
import logoLight from '../assets/logo-light.webp';
import { tokenizeInline, IMAGE_LINE_RE, unescapeLine } from '../services/markdown.js';
import { SEASON_MAST } from '../services/churchYear.js';

// ============================================================================
// 종이 — 예배 노트 · 묵상 노트 · 주보가 **바깥으로 나갈 때** 입는 옷 (2026-09-09)
// ----------------------------------------------------------------------------
// 사용자 요청: "예배 노트와 묵상 노트도 순모임 가이드처럼 작성한 이후에는 좀 이쁜
// 템플릿(순모임 가이드와는 다른)으로 바로 만들어줬으면 함. 공유할 때도 이 형태로",
// "주보도 발행이 완료되면 예배 페이지에서 보일 때는 주보 템플릿에 맞춰서 깔끔하게".
//
// **순모임 가이드 종이를 베끼지 않는다**(사용자 지적 2026-09-09 — "순모임 가이드랑
// 똑같이 하지는 말라니까. 디자인 템플릿이 너무 똑같잖아"). 가이드의 돔 카드와 하트
// 머리줄은 사용자가 준 템플릿이라 그대로 두고, 여기는 **앱이 이미 쓰는 재료로만** 짰다
// (시안 A '밤 머리' — 사용자 선택 2026-09-09):
//   · 맨 위 인디고 띠(`--app-night` #213183 — 홈 히어로의 그 색). 카카오톡 목록에서
//     이 띠 하나로 우리 종이인 걸 알아본다
//   · 아래는 흰 종이, 도막은 **왼쪽 라벨 · 오른쪽 글** 두 칸 + 실선 한 겹
//   · 큰 글자는 굵기 200, 작은 라벨은 800 — SUIT 가변 굵기의 대비가 이 종이의 인상이다
//   · 로고와 발문 THE DABOOT MINISTRY. 캐릭터 컷은 **노트 종이에만** 한 장(예배는
//     heart, 말씀은 book) — 주보는 설교 본문 전문이 실리는 공식 문서라 얹지 않는다
//
// **종이는 다크 모드를 따라가지 않는다.** 인쇄물이고 카카오톡으로 나가는 그림이라
// 언제나 밝다 — 그래서 아래 색은 토큰이 아니라 라이트 고정값이다(가이드 종이와 같은
// 판단). 값 자체는 index.css `:root`에서 그대로 가져왔다.
//
// 그림·PDF로 굽는 길은 services/shareImage.js 한 벌이다(여기는 그리기만 한다).
// **로고에 width/height를 반드시 박는다** — 카카오 인앱에서 로고가 깨졌던 자리다.
//
// 2026-09-10부터 **노트는 이 종이 안에서 쓴다**(사용자 요청 — "세련되고 기쁘게 자발적으로
// 작성할 수 있는 공간으로"). 그래서 띠·머리·밑단이 `PaperMast`·`PaperNoteHead`·`NotePaper`로
// 나와 있다 — 편집 화면이 같은 부품을 쓴다(마크업을 한 벌 더 적으면 한쪽만 고쳐진다).
// 도막 자리에 무엇이 서는지만 다르다: 읽기는 `PaperRow` 여러 줄, 편집은 편집기 하나
// (index.css `.note-paper`의 격자가 그 안에서 라벨·칸을 만든다 — §6-32-p).
//
// 2026-09-14에 **종이가 실제 서식을 그린다**(사용자 지적 — "불릿도 안 그려. 그냥 이렇게만
// 보일 뿐"). 그전에는 굵게와 불릿 흉내만 있었고 기울임·밑줄·취소선·형광펜·링크·사진
// 주소가 마커째 글자로 찍혔다. 지금은 `PaperText`가 편집기와 **같은 토크나이저**
// (services/markdown.js)를 쓰고, 사진도 종이에 앉는다 — 그림·PDF로 굽는 길에서 그 주소를
// data URI로 바꿔 심는다(services/shareImage.js `inlineImages`).
// ============================================================================

export const PAPER = {
  canvas: '#f6f5f7',
  surface: '#fffdfc',
  line: '#dcd8dc',
  ink: '#191720',
  ink2: '#2b2833',
  muted: '#6b6675',
  faint: '#a29daa',
  accent: '#3f6fc4',
  night: '#213183',
  // 형광펜 바탕과 체크 상자 채움. 앱의 라이트 토큰(--app-tag-yellow · --app-tag-green-fg)과
  // 같은 값이되 **여기 한 벌만** 적는다 — 편집 종이(index.css `.note-paper`)가 이것을
  // `--paper-mark`·`--paper-check`으로 받아 쓴다(종이는 다크를 따라가지 않는다 · §6-32-i).
  mark: '#fbecd0',
  check: '#2c5d42',
};

// 종이에 앉는 사진의 높이 상한(사용자 결정 2026-09-14) — 글 칸 폭을 다 쓰고 이 높이에서
// 멈춘다. 편집 종이의 같은 값은 index.css `.note-paper .tiptap img`에 있다.
const PHOTO_MAX_H = 260;

// 종이 위쪽 인디고 띠. 왼쪽 날짜(가는 굵기·숫자 등간격), 오른쪽 종이 이름(800).
// **읽기와 편집이 같은 부품을 쓴다**(2026-09-10) — 그래서 export다. 편집 화면에 같은
// 마크업을 한 벌 더 적으면 한쪽만 고쳐진다(§6-32-p).
//
// **주보 종이에는 교회력이 선다**(사용자 결정 2026-09-25 · services/churchYear.js) — `season`을
// 주면 날짜 위에 절기 이름 한 줄('성령강림절 후 제17주일')이 서고, 특별 절기면 띠가 그 절기의
// 짙은 색이 된다(SEASON_MAST — 종이는 다크를 따라가지 않으므로 라이트 한 벌 · §6-32-i). 연중은
// 이름 줄만 서고 띠는 인디고 그대로다. PDF로도 그대로 나간다. 노트 종이는 season을 안 준다 —
// 그때는 마크업이 예전과 한 글자도 다르지 않다(편집·읽기 종이의 줄 위치 검사가 그대로 선다).
export function PaperMast({ date, kind, season = null }) {
  const tone = season?.color ? SEASON_MAST[season.color] : null;
  const dateEl = <span className="paper-mast-date text-[12px] font-light tracking-[0.04em] tabular-nums opacity-[0.82]">{date}</span>;
  return (
    <div className="paper-mast flex items-end justify-between gap-3 px-[18px] pt-[13px] pb-[14px]"
      data-season={season ? (season.color || 'plain') : undefined}
      style={{ background: tone?.bg || PAPER.night, color: tone?.ink || '#fff',
        ...(tone?.edge ? { borderBottom: `1px solid ${tone.edge}` } : {}) }}>
      {season?.name ? (
        <span className="flex flex-col gap-px min-w-0">
          <span className="paper-mast-season text-[10.5px] font-semibold tracking-[-0.01em] opacity-[0.92]">{season.name}</span>
          {dateEl}
        </span>
      ) : dateEl}
      <span className="paper-mast-kind text-[15px] font-extrabold tracking-[-0.03em]">{kind}</span>
    </div>
  );
}

// 도막 한 줄 — 왼쪽 라벨 칸은 58px 고정이다. 비율(%)로 두면 라벨이 길 때 글 칸이
// 좁아져서 도막마다 글의 시작 자리가 달라진다.
//
// **칸 나누기는 index.css의 `.paper-row`가 한다**(2026-09-17). 여기 인라인 스타일로
// 박아 두었더니 좁은 화면에서 **편집 종이와 읽기 종이가 갈렸다** — 편집 쪽은
// `.note-paper .tiptap`이 639px 아래에서 한 열로 접히는데(2026-09-10 결정) 읽기 쪽은
// 인라인이라 폭을 안 봐서 늘 두 열이었다(사용자 지적 2026-09-17 — "수정 화면과 발행
// 화면이 다르게 보여지거든"). 인라인 스타일은 미디어 쿼리가 못 이긴다.
// **노트 종이만 접힌다**(`.paper-note .paper-row`) — 주보 종이의 찬양·섬기는 이들·광고
// 줄은 그대로 두 열이다(바깥으로 나가는 인쇄물이고 `tests/worship`이 그 모양을 단정한다).
export function PaperRow({ label, children }) {
  return (
    <div className="paper-row grid gap-3 py-[11px]"
      style={{ borderBottom: `1px solid ${PAPER.line}` }}>
      <span className="paper-row-label text-[10px] font-extrabold tracking-[0.02em] pt-[2px]"
        style={{ color: PAPER.faint }}>{label}</span>
      <div className="paper-row-body min-w-0 text-[12.5px] leading-[1.8]" style={{ color: PAPER.ink2 }}>
        {children}
      </div>
    </div>
  );
}

// 종이에 앉는 글 — 노트는 마크다운으로 쓴다. **RichText를 쓰지 않는다**: 그 뷰어는 앱
// 토큰(text-fg 등)으로 칠해서 다크 모드를 따라가는데, 종이는 언제나 밝아야 한다(머리말 ·
// §6-32-i). 그렇다고 **따로 읽지도 않는다** — 토크나이저는 뷰어(RichText)·편집기가 같이
// 쓰는 그 한 벌(services/markdown.js `tokenizeInline`)이고, 여기서 바꾸는 것은 **칠하는
// 색뿐**이다. 파서가 둘이면 한쪽만 고쳐져서 "쓴 그대로 나간다"가 거짓이 된다.
//
// 2026-09-14 이전에는 **굵게와 불릿 흉내만** 있었고 기울임·밑줄·취소선·형광펜·링크·사진
// 주소는 마커가 글자 그대로 종이에 찍혔다(사용자 지적 — "불릿도 안 그려. 그냥 이렇게만
// 보일 뿐"). 불릿도 진짜 목록이 아니라 en대시 + flex였다. 지금 그리는 것은 markdown.js
// 머리말의 지원 범위 그대로다:
//   마크  `**굵게**` `*기울임*` `__밑줄__` `~~취소선~~` `==형광펜==` `[글](주소)`
//   블록  문단 · 제목(#~####) · `- 불릿` · `1. 번호` · `- [ ] 체크` · 이미지 URL 단독 줄
// **불릿·번호는 진짜 ul/ol이다** — 편집 종이(index.css `.note-paper .tiptap`)가 그렇게
// 그리므로, 읽기 종이가 흉내를 내면 저장하는 순간 다른 물건이 된다.
const MARK_TAG = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', highlight: 'mark' };
// 색은 전부 PAPER 한 벌에서 온다(§6-32-i) — 앱 토큰은 다크를 따라간다.
// **밑줄·취소선을 CSS 기본값에 맡기지 않는다**: Tailwind preflight가 들어온 화면이라
// 태그만으로는 모양이 보장되지 않는다.
const MARK_STYLE = {
  bold: { color: PAPER.ink, fontWeight: 700 },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through', opacity: 0.8 },
  highlight: { background: PAPER.mark, color: PAPER.ink, borderRadius: 3, padding: '0 0.125rem' },
};
// 종이 위의 링크는 눌리지 않는다(그림·PDF로 나간다) — 그래도 **글자 모양은 링크**여야
// 어디가 주소였는지 읽는 사람이 안다.
const LINK_STYLE = { color: PAPER.accent, textDecoration: 'underline', wordBreak: 'break-all' };

// 인라인 한 줄 → 마크가 입혀진 조각들. 안쪽부터 감싸 올라간다(RichText renderInline과 같은 결).
function paperInline(text, keyBase) {
  return tokenizeInline(text).map((seg, i) => {
    let node = seg.href
      ? <a href={seg.href} target="_blank" rel="noreferrer" style={LINK_STYLE}>{seg.text}</a>
      : seg.text;
    for (const m of [...seg.marks].reverse()) {
      const Tag = MARK_TAG[m];
      if (Tag) node = <Tag style={MARK_STYLE[m]}>{node}</Tag>;
    }
    return <React.Fragment key={`${keyBase}-${i}`}>{node}</React.Fragment>;
  });
}

// 줄 배열 → 블록 배열. 판정 순서는 markdown.js·RichText와 **같다**(체크 → 불릿 → 번호) —
// 체크 항목은 불릿 패턴에도 걸려서 순서가 바뀌면 `[ ]`가 글자로 남는다.
// **글 사이 빈 줄은 한 줄 그대로 그린다**(사용자 결정 2026-09-25 · 목업 A1 — "편집 화면과
// 같게"). 예전에는 인쇄물이라 접었는데, 사람이 엔터 두 번으로 나눈 문단이 읽기에서 붙어
// 버리고 수정↔저장 때 줄이 30px 넘게 뛰었다. 줄 간격·빈 줄·들여쓰기가 편집 종이
// (index.css `.note-paper .tiptap`)와 같은 값이다(index.css `.paper-note .paper-row-body`).
// 도막 앞뒤의 빈 줄은 splitNoteSections가 이미 걷었다 — 도막은 여전히 한 줄이고 빈 도막에
// 높이를 주지 않는다(§7).
const TODO_RE = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const NUM_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEAD_RE = /^\s*#{1,6}\s+(.*)$/;
function paperBlocks(text) {
  const out = [];
  const push = (type, item, extra = null) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === type) prev.items.push(item);
    else out.push({ type, items: [item], key: item.key, ...(extra || {}) });
  };
  String(text || '').split('\n').forEach((raw, i) => {
    // `\`로 막아 둔 글줄은 문법처럼 생겼어도 문단이다(markdown.js needsEscape와 한 쌍)
    const plain = unescapeLine(raw);
    if (plain !== null) { out.push({ type: 'p', value: plain, key: i }); return; }
    const line = raw.trim();
    // 줄 **전체**가 사진 주소일 때만 사진이다(markdown.js IMAGE_LINE_RE와 같은 판정)
    if (IMAGE_LINE_RE.test(line)) { out.push({ type: 'img', src: line, key: i }); return; }
    const todo = TODO_RE.exec(raw);
    if (todo) { push('todo', { value: todo[2], done: todo[1].toLowerCase() === 'x', key: i }); return; }
    const ul = BULLET_RE.exec(raw);
    if (ul) { push('ul', { value: ul[1], key: i }); return; }
    const ol = NUM_RE.exec(raw);
    if (ol) { push('ol', { value: ol[2], key: i }, { start: Number(ol[1]) || 1 }); return; }
    if (!line) { out.push({ type: 'gap', key: i }); return; }
    // 도막 제목은 이미 왼쪽 라벨로 올라가 있다 — 남은 `#`은 걷고 글만 세운다
    const h = HEAD_RE.exec(raw);
    out.push({ type: 'p', value: h ? h[1] : raw, key: i });
  });
  return out;
}

// 목록의 들여쓰기는 편집 종이와 같은 1.25rem이다(index.css `.tiptap ul`) — 글머리는
// 글자 칸 **밖**에 그려지므로 이 자리가 곧 글머리가 설 자리다(§6-32-u).
// 목록 앞뒤 여백은 index.css `.paper-note .paper-row-body`가 편집 종이와 같은 값으로 준다(A1).
const LIST_STYLE = { paddingLeft: '1.25rem', margin: 0 };
// 체크 상자 — 편집 종이의 체크박스(index.css `.note-paper .tiptap`)와 같은 16px·같은 색.
function PaperCheck({ done }) {
  return (
    <span className="paper-check shrink-0 inline-flex items-center justify-center"
      style={{
        width: 16, height: 16, marginTop: 3, borderRadius: 4,
        border: `1.5px solid ${done ? PAPER.check : PAPER.line}`,
        background: done ? PAPER.check : 'transparent',
      }}>
      {done ? (
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff"
          strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : null}
    </span>
  );
}
function PaperText({ text }) {
  const blocks = useMemo(() => paperBlocks(text), [text]);
  return (
    <>
      {blocks.map((b) => {
        switch (b.type) {
          // 사진 — 글 칸 폭 100% · 높이 상한 260px · contain (사용자 결정 2026-09-14).
          // 굽는 길에서 이 주소를 data URI로 바꿔 심는다(services/shareImage.js) —
          // 안 그러면 foreignObject 안에서 그 자리가 통째로 빈다.
          case 'img':
            return (
              <img key={b.key} className="paper-photo block" src={b.src} alt="" decoding="async"
                style={{
                  width: '100%', maxHeight: PHOTO_MAX_H, objectFit: 'contain',
                  borderRadius: 12, border: `1px solid ${PAPER.line}`, margin: '6px 0',
                }} />
            );
          case 'ul':
            return (
              <ul key={b.key} className="paper-bullets" style={{ ...LIST_STYLE, listStyle: 'disc' }}>
                {b.items.map(it => <li key={it.key}>{paperInline(it.value, it.key)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={b.key} className="paper-numbers" start={b.start || 1}
                style={{ ...LIST_STYLE, listStyle: 'decimal' }}>
                {b.items.map(it => <li key={it.key}>{paperInline(it.value, it.key)}</li>)}
              </ol>
            );
          case 'todo':
            return (
              <ul key={b.key} className="paper-todos" style={{ ...LIST_STYLE, listStyle: 'none', paddingLeft: 0 }}>
                {b.items.map(it => (
                  <li key={it.key} className="flex items-start gap-2">
                    <PaperCheck done={it.done} />
                    <span className="min-w-0"
                      style={it.done ? { color: PAPER.faint, textDecoration: 'line-through' } : undefined}>
                      {paperInline(it.value, it.key)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          // 빈 줄 — 글자 한 줄 높이(편집기의 빈 문단과 같다)
          case 'gap':
            return <p key={b.key} className="paper-line paper-gap"><br /></p>;
          default:
            return <p key={b.key} className="paper-line">{paperInline(b.value, b.key)}</p>;
        }
      })}
    </>
  );
}

// 종이 밑단 — 로고와 발문. right로 발문 대신 다른 글(쪽 번호 등)을 줄 수 있다.
function PaperTail({ right = 'THE DABOOT MINISTRY' }) {
  return (
    <div className="paper-tail flex items-end justify-between gap-3 mt-[14px]">
      <img className="paper-logo block" src={logoLight} width="328" height="240"
        style={{ height: 20, width: 'auto' }} alt="더다붓" decoding="async" />
      <span className="paper-mark text-[8.5px] font-extrabold tracking-[2.2px]"
        style={{ color: PAPER.faint }}>{right}</span>
    </div>
  );
}

// 종이 껍데기 — 띠 + 흰 몸통. sheetRef가 html2canvas가 굽는 자리다.
// **PAPER를 CSS 변수로도 흘려 보낸다**(2026-09-10). 종이 안에 서는 것이 늘 우리
// JSX인 것은 아니다 — 편집기(ProseMirror)가 그리는 글은 index.css가 칠해야 하고,
// 종이는 다크를 따라가지 않으므로(32-i) 그 규칙이 앱 토큰을 쓸 수 없다. hex를 CSS에
// 한 벌 더 적으면 두 자리가 갈라지므로, **여기 한 벌**을 변수로 내려 준다.
export function PaperSheet({ sheetRef, date, kind, children, className = '', style = null, season = null }) {
  return (
    <div ref={sheetRef} className={`paper-sheet ${className}`}
      style={{
        background: PAPER.surface, color: PAPER.ink,
        '--paper-surface': PAPER.surface, '--paper-line': PAPER.line, '--paper-ink': PAPER.ink,
        '--paper-ink2': PAPER.ink2, '--paper-muted': PAPER.muted, '--paper-faint': PAPER.faint,
        '--paper-accent': PAPER.accent, '--paper-mark': PAPER.mark, '--paper-check': PAPER.check,
        ...(style || {}),
      }}>
      <PaperMast date={date} kind={kind} season={season} />
      <div className="paper-body px-[18px] pt-[20px] pb-[18px]">{children}</div>
    </div>
  );
}
// ── 노트 종이의 부품 (예배 노트 · 묵상 노트) ────────────────────────────────
// 노트 종이의 머리 — 설교 제목·구절과 캐릭터 컷. **읽기(NoteSheet)와 편집(NotePaper)이
// 같은 것을 쓴다**(2026-09-10 · 사용자 요청 "종이 안에서 쓰기").
// 제목 줄의 글자 — 읽기 문단과 편집 입력 칸이 **같은 값**을 쓴다(한쪽만 고쳐지면
// 수정을 눌렀을 때 제목의 크기·굵기가 바뀐다).
const TITLE_TYPE = 'text-[21px] font-extralight tracking-[-0.045em] leading-[1.15]';

export function PaperNoteHead({ passageRef = '', passageTitle = '', cut = null, onTitleChange = null }) {
  // **묵상 노트는 제목을 종이 위에서 직접 쓴다**(사용자 요청 2026-09-11 · 0062).
  // 예배 노트의 제목은 주보에서 온 설교 제목이라 읽기만 하고, 묵상은 쓰는 사람의 것이다.
  // 받는 쪽이 `onTitleChange`를 주면 그 자리가 입력 칸이 된다 — 테두리·배경 없이 종이
  // 위에 바로 쓰는 느낌이고, 색은 앱 토큰이 아니라 종이 색이다(종이는 다크를 따라가지
  // 않는다 · §6-32-i). 자리표는 `제목 미정`(사용자가 정한 문구) 하나뿐이다.
  const editTitle = typeof onTitleChange === 'function';
  return (
    <div className="paper-hero flex items-start justify-between gap-2.5">
      {/* **제목이 위, 구절이 아래**(사용자 결정 2026-09-09 — "예배 노트도 제목이 위에,
          본문이 그 아래 표시되도록"). 설교 제목이 이 노트가 무엇에 대한 글인지 말하는
          자리이고, 구절은 그것을 어디서 들었는지다. 제목이 없는 주보(묵상 노트가 늘
          그렇다)에서는 구절이 그대로 큰 글자로 올라온다 — 빈 자리를 남기지 않는다.
          **제목을 쓰는 종이에서는 칸이 비어 있어도 두 줄 그대로**다 — 쓰다 지웠다고
          줄이 하나로 접히면 종이 높이가 출렁인다. */}
      <div className="min-w-0 flex-1">
        {editTitle ? (
          <>
            <input type="text" value={passageTitle} onChange={e => onTitleChange(e.target.value)}
              placeholder="제목 미정" aria-label="묵상 제목" maxLength={80}
              className={`paper-title-input block w-full p-0 border-0 bg-transparent outline-none
                placeholder:text-[var(--paper-faint)] ${TITLE_TYPE}`}
              style={{ color: PAPER.ink }} />
            <p className="paper-ref text-[13px] font-extrabold tracking-[-0.02em] mt-[3px] break-words"
              style={{ color: PAPER.accent }}>{passageRef || ' '}</p>
          </>
        ) : passageTitle ? (
          <>
            <p className={`paper-ref-title break-words ${TITLE_TYPE}`}
              style={{ color: PAPER.ink }}>{passageTitle}</p>
            <p className="paper-ref text-[13px] font-extrabold tracking-[-0.02em] mt-[3px] break-words"
              style={{ color: PAPER.accent }}>{passageRef}</p>
          </>
        ) : (
          <p className={`paper-ref break-words ${TITLE_TYPE}`}
            style={{ color: PAPER.ink }}>{passageRef || ' '}</p>
        )}
      </div>
      {cut ? <img className="paper-cut block shrink-0" src={cut.src} width={cut.w} height={cut.h}
        style={{ width: 58, height: 'auto' }} alt="" decoding="async" /> : null}
    </div>
  );
}

// 노트 종이의 껍데기 — 띠 · 머리 · (도막 자리) · 밑단. children이 도막 자리다.
// **읽기는 PaperRow들을, 편집은 편집기 하나를 그 자리에 넣는다**(사용자 요청 2026-09-10 —
// "종이 안에서 쓰기"). 부품이 한 벌이라 두 모드의 띠·제목·구절·컷이 어긋날 수 없다.
export function NotePaper({
  sheetRef, date, kind, passageRef = '', passageTitle = '', cut = null, className = '', children,
  onTitleChange = null,
}) {
  return (
    <PaperSheet sheetRef={sheetRef} date={date} kind={kind} className={`paper-note ${className}`}>
      {/* onTitleChange를 주면 제목 자리가 입력 칸이 된다(묵상 노트 — PaperNoteHead 머리말) */}
      <PaperNoteHead passageRef={passageRef} passageTitle={passageTitle} cut={cut} onTitleChange={onTitleChange} />
      {children}
      <PaperTail />
    </PaperSheet>
  );
}

// ── 노트 종이 (예배 노트 · 묵상 노트) ───────────────────────────────────────
// sections는 services/noteTemplate.js splitNoteSections의 결과다. 구절은 라벨 줄이
// 아니라 **머리**에 선다 — 그 한 줄이 이 노트가 무엇에 대한 글인지 말하는 자리이고,
// 라벨 칸에 넣으면 다른 도막과 같은 무게로 묻힌다. 머리에 서는 구절은 **주보의 값
// (passageRef) 하나**다.
//
// 예전에는 옛 노트의 '본문' 도막을 여기서 머리로 끌어올렸다. 2026-09-14에 그 갈래를
// 걷었다(사용자 결정 — "그 밑에 구절 또 사용자로부터 입력받을 수 있는 섹션 … 완벽하게
// 제거") — 그 도막은 이제 읽기에도 편집에도 서지 않고 저장될 때도 다시 쓰이지 않는다
// (services/noteTemplate.js `dropLegacySections`가 한 자리에서 걷는다).
export function NoteSheet({ sheetRef, date, kind, passageRef = '', passageTitle = '', sections = [], cut = null }) {
  return (
    <NotePaper sheetRef={sheetRef} date={date} kind={kind}
      passageRef={passageRef} passageTitle={passageTitle} cut={cut}>
      <div className="paper-rows mt-5" style={{ borderTop: `1px solid ${PAPER.line}` }}>
        {sections.map((s, i) => (
          <PaperRow key={`${s.title}-${i}`} label={s.title || ' '}>
            {/* 줄바꿈은 그대로 살린다 — 노트는 사람이 엔터로 끊어 쓴 글이다 */}
            <PaperText text={s.body} />
          </PaperRow>
        ))}
      </div>
    </NotePaper>
  );
}

// ── 주보 종이 1쪽 — 말씀 ────────────────────────────────────────────────────
// **본문을 전부 적는다**(사용자 결정 2026-09-09 — "주보에서 모든 본문 말씀이 다 적혀야
// 하고, 말씀 요약은 안 해줘도 돼"). 그래서 이 쪽은 본문 길이만큼 길어지고, 찬양·광고는
// 2쪽에서 새로 시작하므로 밀리지 않는다. PDF가 알아서 다음 장으로 넘긴다.
export function ServiceSheetOne({ sheetRef, date, kind, title, refStr, preacher, verses = [], season = null }) {
  return (
    <PaperSheet sheetRef={sheetRef} date={date} kind={kind} season={season} className="paper-service paper-service-1">
      <p className="paper-pgno text-[9px] tracking-[0.1em]" style={{ color: PAPER.faint }}>1 / 2 · 말씀</p>
      {title ? (
        <p className="paper-wt text-[17px] font-extrabold tracking-[-0.035em] leading-[1.25] mt-2.5 break-words"
          style={{ color: PAPER.ink }}>{title}</p>
      ) : null}
      <p className="paper-wm text-[11px] mt-1" style={{ color: PAPER.muted }}>
        {[refStr, preacher].filter(Boolean).join(' · ')}
      </p>
      {verses.length ? (
        <div className="paper-verses mt-3">
          {verses.map((v, i) => (
            <React.Fragment key={`${v.chapter}:${v.verse}`}>
              {i > 0 && v.chapter !== verses[i - 1].chapter && (
                <p className="paper-chapter text-[10.5px] font-extrabold tabular-nums mt-3 mb-1"
                  style={{ color: PAPER.muted }}>{v.chapter}장</p>
              )}
              <p className="paper-verse flex gap-2 text-[12px] leading-[1.9]" style={{ color: PAPER.ink2 }}>
                <span className="w-[15px] shrink-0 text-right text-[8.5px] font-extrabold tabular-nums pt-[5px]"
                  style={{ color: PAPER.accent }}>{v.verse}</span>
                <span className="min-w-0 break-words">{v.text}</span>
              </p>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <PaperTail />
    </PaperSheet>
  );
}

// ── 주보 종이 2쪽 — 찬양 · 섬기는 이들 · 광고 ───────────────────────────────
// **봉헌 기도는 종이에서 뺀다**(사용자 결정 2026-09-09 — "봉헌 기도는 어차피 다 같이
// 해서 제외해도 돼. 주보에서"). 담당자 줄은 사람이 적는 자유 글자라(0036 roles jsonb)
// 아래 목록으로 걸러 낸다. 앱 안 '담당자' 탭에는 그대로 남는다 — 뺀 자리는 종이뿐이다.
const PAPER_ROLE_SKIP = ['봉헌기도', '봉헌'];
const roleKey = (x) => String(x || '').replace(/\s+/g, '');
export const paperRoles = (rows = []) =>
  (rows || []).filter(r => (r?.name || r?.person_id) && !PAPER_ROLE_SKIP.includes(roleKey(r?.role)));

export function ServiceSheetTwo({
  sheetRef, date, kind, team, leader, songs = [], roles = [], notices = [], nameOf, cut = null, tagline = '', season = null,
}) {
  const rows = paperRoles(roles);
  // personId를 같이 넘긴다 — 명단 본명·호칭을 id로 찾는다(이름은 계정 표시 이름일 수 있다 · serviceView.realNameOf)
  const who = (r) => (nameOf ? nameOf(r.name, r.personId || r.person_id || null) : r.name);
  return (
    <PaperSheet sheetRef={sheetRef} date={date} kind={kind} season={season} className="paper-service paper-service-2">
      <div className="flex items-start justify-between gap-2.5">
        <p className="paper-pgno text-[9px] tracking-[0.1em]" style={{ color: PAPER.faint }}>2 / 2 · 찬양 · 광고</p>
        {cut ? <img className="paper-cut block shrink-0" src={cut.src} width={cut.w} height={cut.h}
          style={{ width: 54, height: 'auto' }} alt="" decoding="async" /> : null}
      </div>

      <div className="paper-rows mt-3" style={{ borderTop: `1px solid ${PAPER.line}` }}>
        {(songs.length || leader) ? (
          <PaperRow label="찬양">
            <span className="font-extrabold" style={{ color: PAPER.ink }}>{team}</span>
            {/* '찬양 인도'는 **섬기는 이들 줄과 같은 자획**이다(사용자 결정 2026-09-09 —
                "찬양 인도 폰트도 대표기도, 헌금봉헌 쪽과 마찬가지로"): 작은 굵은 라벨 +
                보통 이름. 예전에는 팀 이름 뒤에 문장처럼 이어 붙어 있었다. */}
            {leader ? (
              <span className="paper-leader flex items-baseline gap-1.5 mt-[3px]">
                <span className="shrink-0 text-[9.5px] font-extrabold tracking-[0.02em]"
                  style={{ color: PAPER.faint }}>찬양 인도</span>
                <span className="min-w-0 break-words">{nameOf ? nameOf(leader) : leader}</span>
              </span>
            ) : null}
            {songs.length ? (
              <ol className="paper-songs mt-2 list-none p-0 m-0">
                {songs.map((s, i) => (
                  <li key={i} className="flex gap-2 leading-[1.9]">
                    <span className="w-[15px] shrink-0 text-[9.5px] font-extrabold tabular-nums pt-[4px]"
                      style={{ color: PAPER.faint }}>{i + 1}</span>
                    <span className="min-w-0 break-words">{s.title || '제목 없는 찬양'}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </PaperRow>
        ) : null}

        {rows.length ? (
          <PaperRow label="섬기는 이들">
            <div className="paper-roles grid gap-x-2.5 gap-y-[3px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {rows.map((r, i) => (
                <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                  {r.role ? (
                    <span className="shrink-0 text-[9.5px] font-extrabold tracking-[0.02em]"
                      style={{ color: PAPER.faint }}>{r.role}</span>
                  ) : null}
                  <span className="min-w-0 break-words">{who(r)}</span>
                </div>
              ))}
            </div>
          </PaperRow>
        ) : null}

        {notices.length ? (
          <PaperRow label="광고">
            <ol className="paper-notices list-none p-0 m-0">
              {notices.map((n, i) => (
                <li key={i} className="flex gap-2 leading-[1.9]">
                  <span className="w-[15px] shrink-0 text-[9.5px] font-extrabold tabular-nums pt-[4px]"
                    style={{ color: PAPER.faint }}>{i + 1}</span>
                  {/* 광고는 제목 + 내용 두 조각이다(0036 notices jsonb) — 종이에 내용만
                      실으면 무슨 광고인지가 사라진다. 하나만 있으면 그것만 선다. */}
                  <span className="min-w-0 break-words">
                    {n.title ? (
                      <span className="block font-bold" style={{ color: PAPER.ink }}>{n.title}</span>
                    ) : null}
                    {n.body ? (
                      <span className="block whitespace-pre-line" style={{ color: PAPER.ink2 }}>{n.body}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </PaperRow>
        ) : null}
      </div>

      <PaperTail right={tagline || 'THE DABOOT MINISTRY'} />
    </PaperSheet>
  );
}

// 종이 머리의 날짜 — `2026. 09. 06`. 앱 안 화면의 날짜 문구(`26년 9월 6일`)와 다른
// 이유는 이 줄이 인쇄물의 머리이고 숫자가 등간격으로 줄을 맞춰야 하기 때문이다.
export const paperDate = (iso) => {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}` : s;
};
