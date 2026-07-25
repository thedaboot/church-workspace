import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  Heading1, Heading2, List, ListOrdered, Link2, Unlink, Loader2,
} from 'lucide-react';
import { mdToDoc, docToMd } from '../services/markdown.js';
import { uploadContentImage } from '../services/cloud.js';
import { showToast } from './Toast.jsx';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { isMobileViewport } from '../utils.js';

// ============================================================================
// 노션식 WYSIWYG 상세 내용 에디터 (TipTap)
// ----------------------------------------------------------------------------
// - 쓰는 자리에서 굵게는 굵게로, 이미지는 이미지로 보인다(별도 미리보기 없음)
// - 저장 형식은 여전히 우리 마크다운 서브셋 문자열: 로드 시 md→doc,
//   변경 시 doc→md로 직렬화해 onChange(md)로 올린다 (services/markdown.js)
// - @멘션은 텍스트 기반 유지(뷰어 RichText가 렌더) — 제안 팝오버만 에디터용으로 이식
// - 우리 서브셋에 없는 기능(인용·코드블록·구분선)은 아예 비활성화해
//   "쓸 수 있는 것 = 저장할 수 있는 것"을 일치시킨다
// ============================================================================
const MAX_SUGGESTIONS = 6;

export function MarkdownEditor({ value, onChange, members = [], cloudMode = false, placeholder, className = '' }) {
  const lastEmitted = useRef(value ?? '');
  const editorRef = useRef(null);
  const cloudModeRef = useRef(cloudMode);
  const [uploading, setUploading] = useState(false);

  // 멘션 상태 — editorProps 핸들러는 1회 생성 클로저라 ref로 읽는다
  const [mention, setMention] = useState(null); // { query, from, to, left, top }
  const [activeIdx, setActiveIdx] = useState(0);
  const mentionRef = useRef(null);
  const activeIdxRef = useRef(0);
  const suggestionsRef = useRef([]);
  const pickRef = useRef(() => {});

  useEffect(() => { cloudModeRef.current = cloudMode; }, [cloudMode]);
  useEffect(() => { mentionRef.current = mention; }, [mention]);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  const closeMention = useCallback(() => { setMention(null); setActiveIdx(0); }, []);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return [...new Set(members.filter(Boolean))].filter(n => n.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
  }, [mention, members]);
  useEffect(() => { suggestionsRef.current = suggestions; }, [suggestions]);

  // 커서 앞 '@단어'를 감지해 제안 팝오버 위치를 잡는다
  const detectMention = useCallback((editor) => {
    const { state, view } = editor;
    const sel = state.selection;
    if (!sel.empty) { closeMention(); return; }
    const pos = sel.from;
    const text = state.doc.textBetween(sel.$from.start(), pos, '\n', '￼');
    const m = text.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) { closeMention(); return; }
    const query = m[1];
    let coords;
    try { coords = view.coordsAtPos(pos); } catch { closeMention(); return; }
    setMention({ query, from: pos - query.length - 1, to: pos, left: coords.left, top: coords.bottom });
    setActiveIdx(0);
  }, [closeMention]);

  const uploadImage = useCallback(async (file) => {
    setUploading(true);
    try {
      const url = await uploadContentImage(file);
      editorRef.current?.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      console.error('[cloud] 본문 이미지 업로드 실패:', e);
      showToast('이미지 업로드에 실패했어요 · ' + (e.message || e));
    } finally {
      setUploading(false);
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // 우리 마크다운 서브셋에 없는 블록·마크는 비활성화
        blockquote: false, codeBlock: false, code: false, horizontalRule: false,
        // 생 URL은 평문으로 유지해야 하므로 자동 링크화 금지
        link: { openOnClick: false, autolink: false, linkOnPaste: false },
      }),
      Highlight,
      Image.configure({ inline: false, allowBase64: false }),
      // dataAttribute 기본값은 'placeholder' — CSS content: attr(data-placeholder)와
      // 맞추기 위해 명시한다(index.css의 .tiptap 규칙과 한 쌍)
      Placeholder.configure({ placeholder: placeholder || '내용을 입력하세요...', dataAttribute: 'data-placeholder' }),
    ],
    content: mdToDoc(value),
    autofocus: false, // 모바일에서 키보드가 즉시 올라오는 것 방지
    editorProps: {
      attributes: { class: 'tiptap outline-none' },
      handleKeyDown: (_view, event) => {
        const list = suggestionsRef.current;
        if (!mentionRef.current || !list.length) return false;
        if (event.key === 'ArrowDown') { setActiveIdx(i => (i + 1) % list.length); return true; }
        if (event.key === 'ArrowUp') { setActiveIdx(i => (i - 1 + list.length) % list.length); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { pickRef.current(list[activeIdxRef.current]); return true; }
        if (event.key === 'Escape') { closeMention(); return true; }
        return false;
      },
      handlePaste: (_view, event) => {
        const img = Array.from(event.clipboardData?.files || []).find(f => (f.type || '').startsWith('image/'));
        if (!img || !cloudModeRef.current) return false; // 게스트는 기존 동작(URL 텍스트)
        event.preventDefault();
        uploadImage(img);
        return true;
      },
      handleDrop: (_view, event) => {
        const img = Array.from(event.dataTransfer?.files || []).find(f => (f.type || '').startsWith('image/'));
        if (!img || !cloudModeRef.current) return false;
        event.preventDefault();
        uploadImage(img);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = docToMd(ed.getJSON());
      lastEmitted.current = md;
      onChange(md);
      detectMention(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => detectMention(ed),
    onBlur: () => setTimeout(closeMention, 120),
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  const pick = useCallback((name) => {
    const m = mentionRef.current;
    if (!m || !editorRef.current || !name) return;
    editorRef.current.chain().focus().insertContentAt({ from: m.from, to: m.to }, `@${name} `).run();
    closeMention();
  }, [closeMention]);
  useEffect(() => { pickRef.current = pick; }, [pick]);

  // 외부에서 value가 바뀐 경우(AI 다듬기, 다른 업무 열기)만 문서를 교체
  useEffect(() => {
    if (!editor) return;
    const incoming = value ?? '';
    if (incoming === lastEmitted.current) return;
    if (incoming === docToMd(editor.getJSON())) return;
    lastEmitted.current = incoming;
    editor.commands.setContent(mdToDoc(incoming), { emitUpdate: false });
  }, [value, editor]);

  // 툴바 활성 상태 — 필요한 불리언만 구독해 타이핑마다 전체 리렌더되지 않게
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ed ? {
      bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'),
      strike: ed.isActive('strike'), highlight: ed.isActive('highlight'), link: ed.isActive('link'),
      h1: ed.isActive('heading', { level: 1 }), h2: ed.isActive('heading', { level: 2 }),
      bullet: ed.isActive('bulletList'), ordered: ed.isActive('orderedList'),
    } : {},
  }) || {};

  return (
    <div>
      <Toolbar editor={editor} active={active} uploading={uploading} />
      <div className={className}>
        <EditorContent editor={editor} />
      </div>
      {mention && suggestions.length > 0 && (
        <div
          style={{ position: 'fixed', left: Math.min(mention.left, window.innerWidth - 176), top: mention.top + 4 }}
          className="z-[80] w-max min-w-[9rem] max-w-[min(16rem,calc(100vw-2rem))] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150"
        >
          {suggestions.map((name, i) => (
            <button
              key={name} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(name); }}
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

// ── 툴바 ────────────────────────────────────────────────────────────────────
function Toolbar({ editor, active, uploading }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const linkBtnRef = useRef(null);
  const linkRootRef = useRef(null);
  const [linkPos] = useAnchoredPos(linkBtnRef, linkOpen, 256, 110);

  useEffect(() => {
    if (!linkOpen) return;
    const onDown = (e) => { if (linkRootRef.current && !linkRootRef.current.contains(e.target)) setLinkOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setLinkOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [linkOpen]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  const applyLink = () => {
    const url = href.trim();
    if (!url) return;
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (editor.state.selection.empty) {
      chain().insertContent({ type: 'text', text: full, marks: [{ type: 'link', attrs: { href: full } }] }).run();
    } else {
      chain().setLink({ href: full }).run();
    }
    setHref(''); setLinkOpen(false);
  };

  const TB = ({ on, onClick, title, children }) => (
    <button
      type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded-md transition active:scale-95 shrink-0 ${on ? 'bg-surface-hover text-fg' : 'hover:bg-surface-hover text-fg-muted'}`}
    >{children}</button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border border-line border-b-0 rounded-t-md bg-surface-2/60 px-1.5 py-1">
      <TB on={active.bold} onClick={() => chain().toggleBold().run()} title="굵게"><Bold size={14} /></TB>
      <TB on={active.italic} onClick={() => chain().toggleItalic().run()} title="기울임"><Italic size={14} /></TB>
      <TB on={active.underline} onClick={() => chain().toggleUnderline().run()} title="밑줄"><Underline size={14} /></TB>
      <TB on={active.strike} onClick={() => chain().toggleStrike().run()} title="취소선"><Strikethrough size={14} /></TB>
      <TB on={active.highlight} onClick={() => chain().toggleHighlight().run()} title="형광펜"><Highlighter size={14} /></TB>
      <span className="w-px h-4 bg-line mx-1 shrink-0" />
      <TB on={active.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()} title="제목 1"><Heading1 size={15} /></TB>
      <TB on={active.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} title="제목 2"><Heading2 size={15} /></TB>
      <TB on={active.bullet} onClick={() => chain().toggleBulletList().run()} title="불릿 목록"><List size={15} /></TB>
      <TB on={active.ordered} onClick={() => chain().toggleOrderedList().run()} title="번호 목록"><ListOrdered size={15} /></TB>
      <span className="w-px h-4 bg-line mx-1 shrink-0" />
      <span ref={linkRootRef} className="inline-flex">
        <span ref={linkBtnRef} className="inline-flex">
          <TB on={active.link} onClick={() => { setHref(''); setLinkOpen(o => !o); }} title="링크"><Link2 size={14} /></TB>
        </span>
        {linkOpen && (
          <div
            style={{ position: 'fixed', left: linkPos.left, top: linkPos.top, width: 256 }}
            className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-2.5 animate-in fade-in zoom-in-95 duration-150"
          >
            <input
              autoFocus={!isMobileViewport()} value={href} onChange={e => setHref(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
              placeholder="https://..."
              className="w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setLinkOpen(false)} className="text-xs px-2.5 py-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">취소</button>
              <button type="button" onClick={applyLink} disabled={!href.trim()} className="text-xs px-2.5 py-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white rounded-md transition active:scale-95">적용</button>
            </div>
          </div>
        )}
      </span>
      {active.link && (
        <TB onClick={() => chain().unsetLink().run()} title="링크 제거"><Unlink size={14} /></TB>
      )}
      {uploading && (
        <span className="ml-auto flex items-center gap-1 text-[10px] text-fg-muted pr-1">
          <Loader2 size={11} className="animate-spin" /> 이미지 업로드 중...
        </span>
      )}
    </div>
  );
}
