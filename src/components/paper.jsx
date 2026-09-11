import React, { useMemo } from 'react';
import logoLight from '../assets/logo-light.png';
import { splitBold } from '../services/sunGuide.js';

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
};

// 종이 위쪽 인디고 띠. 왼쪽 날짜(가는 굵기·숫자 등간격), 오른쪽 종이 이름(800).
// **읽기와 편집이 같은 부품을 쓴다**(2026-09-10) — 그래서 export다. 편집 화면에 같은
// 마크업을 한 벌 더 적으면 한쪽만 고쳐진다(§6-32-p).
export function PaperMast({ date, kind }) {
  return (
    <div className="paper-mast flex items-end justify-between gap-3 px-[18px] pt-[13px] pb-[14px]"
      style={{ background: PAPER.night, color: '#fff' }}>
      <span className="paper-mast-date text-[12px] font-light tracking-[0.04em] tabular-nums opacity-[0.82]">{date}</span>
      <span className="paper-mast-kind text-[15px] font-extrabold tracking-[-0.03em]">{kind}</span>
    </div>
  );
}

// 도막 한 줄 — 왼쪽 라벨 칸은 58px 고정이다. 비율(%)로 두면 라벨이 길 때 글 칸이
// 좁아져서 도막마다 글의 시작 자리가 달라진다.
export function PaperRow({ label, children }) {
  return (
    <div className="paper-row grid gap-3 py-[11px]"
      style={{ gridTemplateColumns: '58px minmax(0, 1fr)', borderBottom: `1px solid ${PAPER.line}` }}>
      <span className="paper-row-label text-[10px] font-extrabold tracking-[0.02em] pt-[2px]"
        style={{ color: PAPER.faint }}>{label}</span>
      <div className="paper-row-body min-w-0 text-[12.5px] leading-[1.8]" style={{ color: PAPER.ink2 }}>
        {children}
      </div>
    </div>
  );
}

// 종이에 앉는 글 — 노트는 마크다운으로 쓴다. **RichText를 쓰지 않는다**: 그 뷰어는 앱
// 토큰(text-fg 등)으로 칠해서 다크 모드를 따라가는데, 종이는 언제나 밝아야 한다(머리말).
// 그래서 여기서 필요한 만큼만 그린다 — `**굵게**`와 `- 목록`이다(노트에 실제로 쓰이는
// 두 가지다). 굵게 파서는 순모임 가이드가 쓰던 한 벌을 그대로 쓴다(services/sunGuide.js
// splitBold — tests/sunguide가 검사한다). 그리지 않는 마커가 글자로 남지 않게 줄 앞의
// `#`은 걷는다 — 도막 제목은 이미 왼쪽 라벨로 올라가 있다.
const BULLET_RE = /^\s*[-*]\s+/;
function PaperText({ text }) {
  const lines = useMemo(() => String(text || '').split('\n'), [text]);
  return (
    <>
      {lines.map((raw, i) => {
        const bullet = BULLET_RE.test(raw);
        const body = bullet ? raw.replace(BULLET_RE, '') : raw.replace(/^\s*#{1,6}\s+/, '');
        if (!body.trim()) return null;
        const parts = splitBold(body);
        const inner = parts.map((x, j) => (x.bold
          ? <strong key={j} className="font-bold" style={{ color: PAPER.ink }}>{x.text}</strong>
          : <React.Fragment key={j}>{x.text}</React.Fragment>));
        return bullet ? (
          <span key={i} className="paper-bullet flex gap-1.5">
            <span className="shrink-0" style={{ color: PAPER.faint }}>–</span>
            <span className="min-w-0">{inner}</span>
          </span>
        ) : <span key={i} className="paper-line block">{inner}</span>;
      })}
    </>
  );
}

// 종이 밑단 — 로고와 발문. right로 발문 대신 다른 글(쪽 번호 등)을 줄 수 있다.
function PaperTail({ right = 'THE DABOOT MINISTRY' }) {
  return (
    <div className="paper-tail flex items-end justify-between gap-3 mt-[14px]">
      <img className="paper-logo block" src={logoLight} width="640" height="469"
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
export function PaperSheet({ sheetRef, date, kind, children, className = '', style = null }) {
  return (
    <div ref={sheetRef} className={`paper-sheet ${className}`}
      style={{
        background: PAPER.surface, color: PAPER.ink,
        '--paper-surface': PAPER.surface, '--paper-line': PAPER.line, '--paper-ink': PAPER.ink,
        '--paper-ink2': PAPER.ink2, '--paper-muted': PAPER.muted, '--paper-faint': PAPER.faint,
        '--paper-accent': PAPER.accent,
        ...(style || {}),
      }}>
      <PaperMast date={date} kind={kind} />
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
// 라벨 칸에 넣으면 다른 도막과 같은 무게로 묻힌다. 새 노트는 넘겨받은 passageRef가
// 그 자리에 서고(템플릿에서 '본문' 도막을 뺐다 — 2026-09-12), **옛 노트의 '본문'
// 도막**은 여기서 머리로 끌어올린다. 아는 이름만 올리지 않고 **첫 도막이 '본문'일
// 때만** 올린다(사람이 제목을 고쳐 쓴 노트에서 엉뚱한 도막이 머리로 올라가지 않게).
export function NoteSheet({ sheetRef, date, kind, passageRef = '', passageTitle = '', sections = [], cut = null }) {
  const first = sections[0];
  const headIsPassage = first && first.title === '본문';
  const ref = (headIsPassage ? first.body : '') || passageRef;
  const rows = headIsPassage ? sections.slice(1) : sections;
  return (
    <NotePaper sheetRef={sheetRef} date={date} kind={kind}
      passageRef={ref} passageTitle={passageTitle} cut={cut}>
      <div className="paper-rows mt-5" style={{ borderTop: `1px solid ${PAPER.line}` }}>
        {rows.map((s, i) => (
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
export function ServiceSheetOne({ sheetRef, date, kind, title, refStr, preacher, verses = [] }) {
  return (
    <PaperSheet sheetRef={sheetRef} date={date} kind={kind} className="paper-service paper-service-1">
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
  sheetRef, date, kind, team, leader, songs = [], roles = [], notices = [], nameOf, cut = null, tagline = '',
}) {
  const rows = paperRoles(roles);
  const who = (r) => (nameOf ? nameOf(r.name) : r.name);
  return (
    <PaperSheet sheetRef={sheetRef} date={date} kind={kind} className="paper-service paper-service-2">
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
