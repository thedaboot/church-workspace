import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
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
export const BTN_QUIET = 'px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95';
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
function useDismiss(open, close, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) close(); };
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
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const selected = useMemo(() => people.find(p => p.id === value) || null, [people, value]);

  useDismiss(open, () => { setOpen(false); setQuery(''); }, rootRef);

  // 정확 일치 > 접두 일치 > 포함. 동순위는 가나다순(MentionInput과 같은 규칙).
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    const rank = (n) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
    return people.filter(p => String(p.name || '').toLowerCase().includes(q))
      .sort((a, b) => rank(String(a.name).toLowerCase()) - rank(String(b.name).toLowerCase())
        || String(a.name).localeCompare(String(b.name), 'ko'));
  }, [people, query]);

  const pick = (p) => {
    setQuery(''); setOpen(false); setIdx(0);
    inputRef.current?.blur();
    onChange(p.id);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx(i => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && hits.length) pick(hits[Math.min(idx, hits.length - 1)]);
    } else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  // 고른 사람의 이름은 placeholder 자리에 진한 글자로 둔다 — 칸을 누르는 순간
  // 빈 칸이 되어 바로 찾을 수 있고, 지우고 다시 치는 손이 필요 없다.
  const showName = !!selected && !query;
  return (
    <div ref={rootRef} className={`person-pick relative ${className}`}>
      <div className={`${FIELD} flex items-center gap-1.5 ${open ? 'border-accent' : ''}`}>
        {showName && <PersonFace person={selected} className="w-[18px] h-[18px] text-[9.5px] shrink-0" />}
        <input ref={inputRef} aria-label={label} value={query} autoComplete="off"
          onChange={e => { setQuery(e.target.value); setOpen(true); setIdx(0); }}
          onFocus={() => { setOpen(true); setIdx(0); }}
          onKeyDown={onKeyDown}
          placeholder={showName ? selected.name : placeholder}
          className={`flex-1 min-w-0 bg-transparent outline-none text-[13px] text-fg ${showName ? 'placeholder:text-fg' : 'placeholder:text-fg-faint'}`} />
        {allowClear && selected && (
          <button type="button" aria-label={`${label} 비우기`}
            onMouseDown={e => { e.preventDefault(); setQuery(''); onChange(''); }}
            className={`${ICON_BTN} p-0.5 -mr-0.5`}><X size={12} /></button>
        )}
        <ChevronDown size={13} className="shrink-0 text-fg-faint" />
      </div>
      {open && (
        <div className="person-pick-menu absolute left-0 top-full z-50 mt-1 w-full min-w-[9rem] max-h-52 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
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
        </div>
      )}
    </div>
  );
}

// 짧은 목록에서 하나 고르기(순 옮기기) — 자동완성이 필요 없는 자리다.
// items는 [{ id, name }]. 트리거 글자는 children으로 받는다.
export function MenuPick({ items = [], onPick, label, empty, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useDismiss(open, () => setOpen(false), rootRef);
  return (
    <span ref={rootRef} className={`relative inline-flex ${className}`}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="menu-pick inline-flex items-center gap-1 px-1.5 py-1 rounded-xs border border-line bg-surface text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95">
        <span>{children}</span><ChevronDown size={11} className="shrink-0" />
      </button>
      {open && (
        <div className="menu-pick-menu absolute right-0 top-full z-50 mt-1 w-max min-w-[7rem] max-w-[min(14rem,80vw)] max-h-52 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
          {items.map(it => (
            <button key={it.id} type="button" onClick={() => { setOpen(false); onPick(it.id); }}
              className="menu-pick-option w-full block px-2 py-1.5 rounded-md text-left text-[12.5px] text-fg-muted hover:bg-surface-hover transition-colors truncate">{it.name}</button>
          ))}
          {!items.length && empty && <p className="px-2 py-2 text-[12px] text-fg-muted">{empty}</p>}
        </div>
      )}
    </span>
  );
}

// 빈 자리 — 남는 공간의 가운데에 담백한 두 줄(§8).
export function Empty({ title, hint, className = '' }) {
  return (
    <div className={`py-16 text-center ${className}`}>
      <p className="text-[12.5px] text-fg-muted">{title}</p>
      {hint && <p className="mt-1 text-[11.5px] text-fg-faint">{hint}</p>}
    </div>
  );
}
