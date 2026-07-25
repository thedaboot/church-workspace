import React, { useState, useRef, useMemo, useCallback } from 'react';

// ============================================================================
// @멘션 자동완성 입력 (textarea / input 공용)
// ----------------------------------------------------------------------------
// - '@' 뒤 글자를 타이핑하면 입력창 근처에 멤버 제안 팝오버 노출
// - ↑↓ 이동, Enter/Tab 선택, Esc 닫기, 클릭 선택
// - 팝오버가 열려 있는 동안의 Enter/Tab/방향키는 부모 onKeyDown으로 전달하지 않음
//   (부모의 "Enter=등록" 같은 동작과 충돌 방지)
// - members: 표시명 문자열 배열
// - dropUp: 팝오버를 입력창 위로(댓글 입력처럼 화면 하단일 때)
// - elementRef: 실제 textarea/input DOM 참조를 부모로 넘김(본문 이미지 붙여넣기 등)
// ============================================================================
const MAX_SUGGESTIONS = 6;

export function MentionInput({
  as = 'textarea', value, onChange, members = [], className = '',
  onKeyDown, onPaste, dropUp = false, elementRef, ...rest
}) {
  const innerRef = useRef(null);
  const [mention, setMention] = useState(null); // { query, start }
  const [activeIdx, setActiveIdx] = useState(0);

  const setRef = useCallback((node) => {
    innerRef.current = node;
    if (typeof elementRef === 'function') elementRef(node);
    else if (elementRef) elementRef.current = node;
  }, [elementRef]);

  const filtered = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const uniq = [...new Set(members.filter(Boolean))];
    // 정확 일치 > 접두 일치 > 포함 순으로 정렬 — "노준석" 입력 시 "노준석_서브"가 앞서지 않게
    const rank = (n) => { const l = n.toLowerCase(); return l === q ? 0 : l.startsWith(q) ? 1 : 2; };
    return uniq.filter(n => n.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_SUGGESTIONS);
  }, [mention, members]);

  const showPopover = !!mention && filtered.length > 0;

  const detectMention = (text, caret) => {
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) { setMention({ query: m[1], start: caret - m[1].length - 1 }); setActiveIdx(0); }
    else setMention(null);
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    detectMention(e.target.value, e.target.selectionStart);
  };

  const selectMember = (name) => {
    const el = innerRef.current;
    const caret = el ? el.selectionStart : value.length;
    const start = mention ? mention.start : caret;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const inserted = `@${name} `;
    const next = before + inserted + after;
    onChange(next);
    setMention(null);
    const newPos = (before + inserted).length;
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(newPos, newPos); } });
  };

  const handleKeyDown = (e) => {
    if (showPopover) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % filtered.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); selectMember(filtered[activeIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    onKeyDown?.(e);
  };

  const Tag = as === 'input' ? 'input' : 'textarea';

  return (
    <div className="relative">
      <Tag
        ref={setRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onClick={(e) => detectMention(e.target.value, e.target.selectionStart)}
        onBlur={() => setTimeout(() => setMention(null), 120)}
        className={className}
        {...rest}
      />
      {showPopover && (
        <div className={`absolute left-0 z-50 w-max min-w-[9rem] max-w-[min(16rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {filtered.map((name, i) => (
            <button
              key={name} type="button"
              // onMouseDown(preventDefault)로 blur보다 먼저 처리해 선택 보장
              onMouseDown={(e) => { e.preventDefault(); selectMember(name); }}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}
            >
              <span className="text-accent-text font-semibold shrink-0">@</span>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
