import React, { useRef, useState, useCallback } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  Heading1, Heading2, List, ListOrdered, Link2, Eye, EyeOff,
} from 'lucide-react';
import { MentionInput } from './MentionInput.jsx';
import { RichText } from './RichText.jsx';

// ============================================================================
// 마크다운 툴바 + 실시간 미리보기 에디터 (상세 내용용)
// ----------------------------------------------------------------------------
// - 내부 textarea는 MentionInput(@멘션 자동완성 + 이미지 paste)을 그대로 사용
// - 툴바: 선택 영역을 토큰으로 감싸거나 줄 앞 접두어 토글
// - 미리보기: RichText로 실시간 렌더(접기/펴기)
// - elementRef: 부모(본문 이미지 paste)가 textarea DOM을 참조할 수 있게 포워딩
// ============================================================================
export function MarkdownEditor({ value, onChange, members = [], elementRef, onPaste, placeholder, className = '' }) {
  const taRef = useRef(null);
  const [showPreview, setShowPreview] = useState(true);

  const setRef = useCallback((node) => {
    taRef.current = node;
    if (typeof elementRef === 'function') elementRef(node);
    else if (elementRef) elementRef.current = node;
  }, [elementRef]);

  const focusAt = (a, b = a) => requestAnimationFrame(() => {
    const el = taRef.current; if (!el) return;
    el.focus(); el.setSelectionRange(a, b);
  });

  // 선택 영역을 prefix/suffix로 감싸기 (선택 없으면 placeholder를 넣고 그 부분을 선택)
  const wrap = (prefix, suffix = prefix, ph = '내용') => {
    const el = taRef.current; if (!el) return;
    const v = value || '';
    const start = el.selectionStart, end = el.selectionEnd;
    const hasSel = end > start;
    const inner = hasSel ? v.slice(start, end) : ph;
    const next = v.slice(0, start) + prefix + inner + suffix + v.slice(end);
    onChange(next);
    if (hasSel) { const p = start + prefix.length + inner.length + suffix.length; focusAt(p); }
    else focusAt(start + prefix.length, start + prefix.length + inner.length);
  };

  // 현재 줄 앞 접두어 토글 (제목·목록) — 다른 블록 접두어는 먼저 제거
  const linePrefix = (prefix) => {
    const el = taRef.current; if (!el) return;
    const v = value || '';
    const caret = el.selectionStart;
    const lineStart = v.lastIndexOf('\n', caret - 1) + 1;
    const nl = v.indexOf('\n', caret);
    const lineEnd = nl === -1 ? v.length : nl;
    const line = v.slice(lineStart, lineEnd);
    const cleaned = line.replace(/^(#{1,4}\s+|[-*]\s+|\d+[.)]\s+)/, '');
    const nextLine = line.startsWith(prefix) ? cleaned : prefix + cleaned;
    const next = v.slice(0, lineStart) + nextLine + v.slice(lineEnd);
    onChange(next);
    const p = caret + (nextLine.length - line.length);
    focusAt(Math.max(lineStart, p));
  };

  // [선택](url) 삽입 후 커서를 url 자리에 선택 상태로
  const insertLink = () => {
    const el = taRef.current; if (!el) return;
    const v = value || '';
    const start = el.selectionStart, end = el.selectionEnd;
    const inner = end > start ? v.slice(start, end) : '텍스트';
    const md = `[${inner}](url)`;
    const next = v.slice(0, start) + md + v.slice(end);
    onChange(next);
    const urlStart = start + 1 + inner.length + 2; // "[" + inner + "]("
    focusAt(urlStart, urlStart + 3);
  };

  const TB = ({ onClick, title, children }) => (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95 shrink-0">{children}</button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 border border-line border-b-0 rounded-t-md bg-surface-2/60 px-1.5 py-1">
        <TB onClick={() => wrap('**')} title="굵게"><Bold size={14} /></TB>
        <TB onClick={() => wrap('*')} title="기울임"><Italic size={14} /></TB>
        <TB onClick={() => wrap('__')} title="밑줄"><Underline size={14} /></TB>
        <TB onClick={() => wrap('~~')} title="취소선"><Strikethrough size={14} /></TB>
        <TB onClick={() => wrap('==')} title="형광펜"><Highlighter size={14} /></TB>
        <span className="w-px h-4 bg-line mx-1 shrink-0" />
        <TB onClick={() => linePrefix('# ')} title="제목 1"><Heading1 size={15} /></TB>
        <TB onClick={() => linePrefix('## ')} title="제목 2"><Heading2 size={15} /></TB>
        <TB onClick={() => linePrefix('- ')} title="불릿 목록"><List size={15} /></TB>
        <TB onClick={() => linePrefix('1. ')} title="번호 목록"><ListOrdered size={15} /></TB>
        <span className="w-px h-4 bg-line mx-1 shrink-0" />
        <TB onClick={insertLink} title="링크"><Link2 size={14} /></TB>
      </div>
      <MentionInput
        as="textarea" name="content" value={value}
        onChange={onChange} members={members} elementRef={setRef} onPaste={onPaste}
        placeholder={placeholder}
        className={`${className} rounded-t-none`}
      />
      {(value || '').trim() && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowPreview(s => !s)} className="flex items-center gap-1 text-[10px] text-fg-faint hover:text-fg-muted transition active:scale-95 mb-1">
            {showPreview ? <EyeOff size={11} /> : <Eye size={11} />} 미리보기
          </button>
          {showPreview && (
            <div className="bg-surface-2/50 border border-line rounded-md p-3 max-h-56 overflow-y-auto animate-in fade-in duration-150">
              <RichText content={value} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
