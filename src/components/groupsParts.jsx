import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { byName } from '../services/groups.js';
import { keepVisible } from '../utils.js';

// ============================================================================
// 모임 화면의 공용 부품 — 사람 동그라미 · 명단에서 고르기 · 짧은 목록 고르기 · 카드 껍데기
// ----------------------------------------------------------------------------
// 순·동아리·순 편성 세 구역이 같은 모양을 세 번 들고 있지 않도록 여기 모은다.
// 전부 **props로 받은 것만 그린다** — 통신은 views/groupsView.jsx가 한다.
// ============================================================================

export const CARD = 'rounded-[10px] shadow-soft';
export const CARD_STYLE = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };

export const BTN = 'px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40';
export const BTN_QUIET = 'px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40';
export const FIELD = 'text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint';

// **아이콘이 든 버튼은 이 두 개만 쓴다.** 아이콘 하나뿐인 버튼에 flex를 안 주면 svg가
// 글자 baseline에 앉아 아래 descender 몫(약 2px)만큼 위로 뜬 채 선다. 그리고 아이콘과
// 글자를 나란히 둘 때 JSX에 `<Plus /> 새 동아리`라고 쓰면 **글자 앞 공백이 그대로 남아**
// gap 위에 3~4px이 더 붙는다 — 버튼마다 사이가 6.2~8.7px로 제각각이었다(실측).
// 그래서 글자는 언제나 <span>으로 감싸 공백을 없애고 간격은 gap 하나로만 준다.
export const ICON_BTN = 'inline-flex items-center justify-center p-1 rounded text-fg-faint hover:text-fg hover:bg-surface-hover transition active:scale-95';
export const WITH_ICON = 'inline-flex items-center gap-1.5';

// 사람 동그라미. **계정이 이어진 사람만 사진**이고 나머지는 이름 글자다 — 명단(people)에는
// 가입하지 않은 청년이 더 많고(결정 1), 사진은 계정에만 있다. url을 null로 못 박아
// 이름으로 사진을 찾는 길(Avatar 기본값)을 아예 닫는다.
export function PersonFace({ person, className = 'w-7 h-7 text-[11px]' }) {
  return <Avatar name={person?.name || ''} url={person?.profile_id ? undefined : null}
    className={`flex ${className}`} />;
}

// 아바타 + 이름 한 줄. badge는 '순장'·'동아리장'처럼 그 사람의 자리, right는 조작 버튼.
export function PersonTag({ person, badge, right, className = '' }) {
  return (
    <div className={`group-person flex items-center gap-2 min-w-0 ${className}`}>
      <PersonFace person={person} />
      <span className="text-[12.5px] text-fg truncate">{person?.name}</span>
      {badge && (
        <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10px] font-bold">{badge}</span>
      )}
      {right && <span className="ml-auto shrink-0 flex items-center gap-1">{right}</span>}
    </div>
  );
}

// 바깥 누름 · Esc로 닫기(layout.jsx의 useDismiss와 같은 규칙 — 그쪽은 내보내지 않는다).
// touchstart까지 듣는다: 터치 기기에는 mousedown이 늦게(또는 아예 안) 온다.
// **ref를 여러 개 받는다** — 목록이 body 포털로 나가 있으면 앵커의 자손이 아니라서,
// 앵커만 보면 목록 안을 누르는 것이 '바깥'으로 잡힌다(§6-0). mousedown에서 닫히면
// 그 뒤의 click은 사라진 버튼에 닿지 않아 순 옮기기가 한 건도 안 먹었을 것이다.
function useDismiss(open, close, ...refs) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!refs.some(r => r.current?.contains(e.target))) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// 이 파일의 피커 목록은 **body 포털이 기본**이다(§6-1). absolute + z-50으로 두었더니
// `.dc-row`·`.dc-card`의 등장 애니메이션이 `animation-fill-mode: both`로 끝난 뒤에도
// identity transform을 남겨서(계산값이 none이 아니라 matrix(1,0,0,1,0,0)) 카드마다
// **쌓임 맥락**이 생겼고, 순 편성에서 목록이 바로 아래 순 카드에 덮여 잘렸다(사용자
// 지적 2026-09-02 · 실측 5개 점 중 2~4개가 아래 카드에 가려짐). 같은 transform이
// fixed의 기준 박스도 되므로 포털 없이 fixed로 바꾸는 것으로는 풀리지 않는다.
// 자리는 ConfirmPopover의 useAnchoredPos가 잡는다 — 화면 아래쪽에서 열면 위로 뒤집고
// 좌우도 뷰포트 안으로 클램프한다(모바일 375px).
const MENU_MAX_H = 208;  // max-h-52 — 실제 높이는 그려진 뒤 measuredRef로 다시 잰다
const MENU_EST_W = 176;  // MenuPick 첫 배치용 추정 폭(내용 폭을 잰 뒤 다시 잡는다)

// 목록 껍데기의 공용 클래스. **`duration-150`이 여기 있으면 안 된다**(사용자 지적
// 2026-09-02 — "피커가 처음 열릴 때 위에서 뚝 떨어진다"). tw-animate-css의
// `animate-in`은 길이를 `--tw-duration`에서 읽는데, 테일윈드의 `duration-150`은 그 변수와
// **`transition-duration`을 같이** 놓는다. CSS에서 `transition-property`의 초깃값은
// `all`이라 아무 transition 클래스가 없어도 **위치까지 전이 대상**이 된다 —
// 첫 배치의 top이 0 → 제자리로 150ms에 걸쳐 미끄러졌다(실측: 2 → 33 → 104 → 305 → 307px).
// `animate-in`의 기본 길이가 그대로 .15s라 클래스만 빼면 등장 인상은 같다.
const MENU_BOX = 'z-[90] max-h-52 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95';

// 명단에서 고르기 — **입력하면 자동완성이 뜨는 피커**(멘션·담당자 지정과 같은 톤).
// 네이티브 <select>를 걷어낸 자리다(사용자 지적 2026-09-01 "슬라이더처럼 보인다"):
// 기기마다 다른 휠·목록이 떠서 우리 화면과 따로 놀았고, 50명 넘는 명단을 손가락으로
// 굴려 찾아야 했다. 여기서는 글자를 치면 좁혀지고 ↑↓·Enter로 고른다.
//
// 고른 뒤 원래 자리로 돌아오는 쓰임(순원·멤버 추가)에서는 부모가 value를 ''로 준다.
// 고른 사람이 있는 쓰임(순장·동아리장 지정)에서는 그 이름이 칸에 남고, 칸을 누르면
// 다시 처음부터 찾는다 — 지금 누구인지가 언제나 보인다.
export function PersonPick({
  people = [], value = '', onChange, label, placeholder = '명단에서 고르기',
  allowClear = false, className = '',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [boxW, setBoxW] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const selected = useMemo(() => people.find(p => p.id === value) || null, [people, value]);

  const close = () => { setOpen(false); setQuery(''); };
  useDismiss(open, close, rootRef, menuRef);

  // 목록의 폭은 칸의 폭이다 — 포털로 나가면 w-full이 뜻을 잃으므로 재서 넘긴다.
  // useAnchoredPos는 `앵커 오른쪽 - 폭`을 왼쪽으로 잡으니, 폭이 같으면 칸에 딱 맞게 선다.
  // **열려 있을 때만 재면 안 된다** — 폭을 모르는 채로 열면 열기 전에 부르는 place()가
  // 첫 프레임을 엉뚱한 자리에 놓는다. 칸이 살아 있는 내내 재 둔다(ResizeObserver라
  // 창 크기뿐 아니라 옆 칸이 밀어서 폭이 변하는 것도 따라간다).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => setBoxW(el.getBoundingClientRect().width || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [pos, place] = useAnchoredPos(rootRef, open && boxW > 0, boxW, MENU_MAX_H, 8, menuRef);

  // **열기 전에 자리를 잡는다**(layout.jsx ProfileMenu와 같은 순서 — place() 먼저, 그다음
  // 열기). 열고 나서 재면 첫 렌더가 {0,0}에 놓였다가 제자리로 옮겨지고, 그 이동이
  // 눈에 보인다. 이미 열려 있을 때 불러도 같은 자리를 다시 셈할 뿐이라 해롭지 않다.
  const openMenu = () => { place(); setOpen(true); };

  // 후보는 언제나 가나다순이다(사용자 지시 2026-09-02) — 명단이 온 차례대로 서면
  // 같은 이름을 찾을 때마다 다른 줄에 있다. 글자를 친 뒤에는 정확 일치 > 접두 일치 >
  // 포함으로 좁히고, 동순위 안에서 다시 가나다순이다(MentionInput과 같은 규칙).
  const hits = useMemo(() => {
    const all = [...people].sort(byName);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const rank = (n) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
    return all.filter(p => String(p.name || '').toLowerCase().includes(q))
      .sort((a, b) => rank(String(a.name).toLowerCase()) - rank(String(b.name).toLowerCase())
        || byName(a, b));
  }, [people, query]);

  const pick = (p) => {
    setQuery(''); setOpen(false); setIdx(0);
    inputRef.current?.blur();
    onChange(p.id);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(); setIdx(i => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hits.length) pick(hits[Math.min(idx, hits.length - 1)]);
    } else if (e.key === 'Escape') { close(); }
  };

  // 화살표는 **누르면 열린다**. 예전에는 그냥 놓인 아이콘이라 눌러도 아무 일이 없었다
  // (사용자 지적 2026-09-02) — 보이는 것은 눌려야 하고, 안 눌릴 것은 보이지 않아야 한다.
  // 빈 입력으로 전체 후보를 연다. 닫을 때 칸의 포커스도 같이 뗀다 — 포커스를 쥔 채
  // 닫으면 그 칸을 다시 눌러도 focus 이벤트가 없어 목록이 열리지 않는다.
  const toggle = (e) => {
    e.preventDefault();
    if (open) { close(); inputRef.current?.blur(); return; }
    setQuery(''); setIdx(0); openMenu(); inputRef.current?.focus();
  };

  // 고른 사람의 이름은 placeholder 자리에 진한 글자로 둔다 — 칸을 누르는 순간
  // 빈 칸이 되어 바로 찾을 수 있고, 지우고 다시 치는 손이 필요 없다.
  const showName = !!selected && !query;
  return (
    <div ref={rootRef} className={`person-pick ${className}`}>
      <div className={`${FIELD} flex items-center gap-1.5 ${open ? 'border-accent' : ''}`}>
        {showName && <PersonFace person={selected} className="w-[18px] h-[18px] text-[9.5px] shrink-0" />}
        <input ref={inputRef} aria-label={label} value={query} autoComplete="off"
          onChange={e => { setQuery(e.target.value); openMenu(); setIdx(0); }}
          onFocus={() => { openMenu(); setIdx(0); }}
          onKeyDown={onKeyDown}
          placeholder={showName ? selected.name : placeholder}
          className={`flex-1 min-w-0 bg-transparent outline-none text-[13px] text-fg ${showName ? 'placeholder:text-fg' : 'placeholder:text-fg-faint'}`} />
        {allowClear && selected && (
          <button type="button" aria-label={`${label} 비우기`}
            onMouseDown={e => { e.preventDefault(); setQuery(''); onChange(''); }}
            className={`${ICON_BTN} p-0.5 -mr-0.5`}><X size={12} /></button>
        )}
        <button type="button" aria-label={`${label} 목록`} aria-expanded={open}
          onMouseDown={toggle} className={`person-pick-toggle ${ICON_BTN} p-0.5 -mr-0.5`}>
          <ChevronDown size={13} />
        </button>
      </div>
      {open && boxW > 0 && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: boxW }}
          className={`person-pick-menu ${MENU_BOX}`}>
          {hits.map((p, i) => (
            <button key={p.id} type="button"
              // 방향키로 목록 밖까지 내려가도 활성 항목이 보이게(담당자 선택기와 같다)
              ref={i === idx ? keepVisible : null}
              // onMouseDown + preventDefault라야 blur보다 먼저 처리돼 선택이 보장된다
              onMouseDown={e => { e.preventDefault(); pick(p); }}
              className={`person-pick-option w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${i === idx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <PersonFace person={p} className="w-[18px] h-[18px] text-[9.5px] shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {!hits.length && <p className="px-2 py-2 text-[12px] text-fg-muted">명단에 없는 이름이에요</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}

// 짧은 목록에서 하나 고르기(순 옮기기) — 자동완성이 필요 없는 자리다.
// items는 [{ id, name }]. 트리거 글자는 children으로 받는다.
export function MenuPick({ items = [], onPick, label, empty, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(MENU_EST_W);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  useDismiss(open, () => setOpen(false), rootRef, menuRef);
  // 폭은 내용이 정한다(w-max). 그린 뒤 실제 폭으로 다시 재야 오른쪽 끝이 트리거에 맞는다 —
  // 레이아웃 패스 안에서 다시 잡으므로 자리가 튀어 보이지 않는다.
  useLayoutEffect(() => { if (open) setW(menuRef.current?.offsetWidth || MENU_EST_W); }, [open, items.length]);
  const [pos, place] = useAnchoredPos(rootRef, open, w, MENU_MAX_H, 8, menuRef);
  // PersonPick과 같은 순서 — **열기 전에 place()**(layout.jsx ProfileMenu의 패턴).
  const toggle = () => { if (open) { setOpen(false); return; } place(); setOpen(true); };
  return (
    <span ref={rootRef} className={`inline-flex ${className}`}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={toggle}
        className="menu-pick inline-flex items-center gap-1 px-1.5 py-1 rounded-xs border border-line bg-surface text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95">
        <span>{children}</span><ChevronDown size={11} className="shrink-0" />
      </button>
      {open && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className={`menu-pick-menu w-max min-w-[7rem] max-w-[min(14rem,80vw)] ${MENU_BOX}`}>
          {items.map(it => (
            <button key={it.id} type="button" onClick={() => { setOpen(false); onPick(it.id); }}
              className="menu-pick-option w-full block px-2 py-1.5 rounded-md text-left text-[12.5px] text-fg-muted hover:bg-surface-hover transition-colors truncate">{it.name}</button>
          ))}
          {!items.length && empty && <p className="px-2 py-2 text-[12px] text-fg-muted">{empty}</p>}
        </div>,
        document.body,
      )}
    </span>
  );
}

// ── 빈 자리 ─────────────────────────────────────────────────────────────────
// 로티 대신 **SVG 선 그리기 마크**를 쓴다(§8 · 외부 JSON·라이브러리 없음). 대시보드의
// AllClearMark, 보드의 EmptyColumnMark, 그래프의 GraphEmptyMark와 같은 언어이고 같은
// 애니메이션 클래스(index.css의 .dc-draw · .dc-draw-ring)를 쓴다 — 다만 그 셋은 저마다
// 자기 파일 안의 지역 함수라 가져다 쓸 수 없어서(export가 없다) 모임 화면 몫을 여기 둔다.
// 그림은 그 화면의 언어다: 모임 화면은 **사람**이고, 모임 일정 자리는 **달력**이다.

// 사람 둘 — 큰 동그라미 → 작은 동그라미 → 어깨선 둘 순서로 그려진다(§4.2 — 순서가
// 있는 애니메이션은 앞이 끝난 뒤에 다음이 시작한다).
export function PeopleMark() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12 mx-auto" aria-hidden="true">
      <circle className="dc-draw-ring" cx="26" cy="18" r="8"
        fill="var(--app-surface-hover)" stroke="var(--app-line)" strokeWidth="1.6"
        style={{ transformOrigin: '26px 18px' }} />
      <circle className="dc-draw-ring" cx="45" cy="20" r="6"
        fill="var(--app-surface-hover)" stroke="var(--app-line)" strokeWidth="1.6"
        style={{ transformOrigin: '45px 20px', animationDelay: '.28s' }} />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M14 39a12 12 0 0 1 24 0"
        fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M42 39a9 9 0 0 1 12-6.4"
        fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// 달력 한 장 — 테두리 → 머리줄 → 고리 둘(보드의 EmptyColumnMark와 같은 짜임).
export function MeetMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-12 h-12 mx-auto" aria-hidden="true"
      fill="none" stroke="var(--app-line)" strokeWidth="1.6" strokeLinecap="round">
      <path className="dc-draw" pathLength="1"
        d="M11 13.5h26a2.5 2.5 0 0 1 2.5 2.5v20a2.5 2.5 0 0 1-2.5 2.5H11a2.5 2.5 0 0 1-2.5-2.5V16a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path className="dc-draw dc-draw-2" pathLength="1" d="M8.5 22.5h31" />
      <path className="dc-draw dc-draw-3" pathLength="1" d="M17.5 9.5v7M30.5 9.5v7" />
    </svg>
  );
}

// 빈 자리 — 마크와 문구가 **남는 공간의 세로·가로 정가운데**에 선다(§8 · 대시보드
// 마감 목록·그래프의 빈 화면과 같은 판단). 위쪽에 붙여 두면 아래가 통째로 비어 보인다.
// minH는 그 구역이 실제로 차지할 만한 높이다 — 화면 한 판을 다 쓰는 빈 자리는 기본값,
// 카드 아래에 딸린 작은 구역(동아리 상세의 모임)은 호출부가 줄여 준다.
export function Empty({ mark, title, hint, minH = '46vh', className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}
      style={{ minHeight: minH }}>
      {mark}
      <p className="text-[13.5px] font-semibold text-fg mt-3">{title}</p>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </div>
  );
}
