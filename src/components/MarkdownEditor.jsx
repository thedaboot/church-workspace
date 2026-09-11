import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
// starter-kit이 이미 물고 있는 패키지라 새 다운로드가 없다(3.29.0 동일)
import { TaskList, TaskItem } from '@tiptap/extension-list';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3, Heading4, List, ListOrdered, ListTodo, Link2, Unlink, Loader2, Minus,
} from 'lucide-react';
import { mdToDoc, docToMd } from '../services/markdown.js';
import { uploadContentImage } from '../services/cloud.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { isMobileViewport, keepVisible } from '../utils.js';
import { downscaleImage, BODY_MAX_DIM } from '../services/image.js';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// 제목에서 Enter를 치면 **본문으로 떨어진다.** 기본 동작은 같은 제목이 이어지는데,
// 제목을 연달아 쓰는 일은 거의 없고 대개 그 아래에 내용을 적는다(사용자 지적
// 2026-08-30 — H1~H4 전부). 불릿·번호·체크는 그대로 이어진다: 그건 같은 종류가
// 연달아 오는 것이 정상이고, 빈 항목에서 Enter를 치면 TipTap이 알아서 빠져나온다.
const HeadingExit = Extension.create({
  name: 'headingExit',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this;
        if (!editor.isActive('heading')) return false;
        // **어디서 치든 다음 줄은 본문이다**(사용자 결정 2026-08-30 — 처음에는 줄 끝에서만
        // 그렇게 했는데 가운데서도 같기를 원했다). 제목을 연달아 쓰는 일은 거의 없다.
        // splitBlock({ keepMarks: true })라야 형광펜·굵기 같은 서식이 따라온다 —
        // 그냥 splitBlock이면 뒤쪽이 맨 글자가 된다.
        // setNode는 **가른 뒤**에 부른다: 먼저 부르면 앞쪽 제목까지 본문이 된다.
        return editor.chain()
          .splitBlock({ keepMarks: true })
          // **줄 끝에서는 splitBlock이 이미 문단을 만들어 놓는다.** 그때 setNode를 또 부르면
          // "바꿀 것이 없다"며 false가 나오고, 그 false가 이 단축키의 반환값이 되어
          // ProseMirror가 **기본 Enter를 한 번 더 돌린다** → 빈 문단이 하나 더 생겼다
          // (사용자 지적 2026-08-30 — "줄바꿈이 두 번 된다"). 가운데서 가른 경우에는
          // 뒤쪽이 제목 그대로라 setNode가 실제로 일을 한다 — 그때만 부른다.
          .command(({ state, commands }) =>
            state.selection.$from.parent.type.name === 'paragraph' || commands.setNode('paragraph'))
          .run();
      },
    };
  },
});

// 정해진 중제목은 **편집기 안에서 지워지지 않는다** (사용자 결정 2026-09-10 —
// "아예 수정 창에서부터 그 중제목은 고정해달라는거야"). 저장할 때 되살리는 길
// (services/noteTemplate.js ensureNoteSections)은 저장된 글만 지키므로, 쓰는 동안에는
// 제목이 사라져 보였다.
//
// **막는 방식**: 트랜잭션이 끝난 문서에서 정해진 제목이 하나라도 없어지면 그 트랜잭션을
// 물린다(filterTransaction). 그러면 백스페이스·전체 선택 후 입력·제목 글자 고치기가
// 전부 아무 일도 하지 않는다 — 그것이 '고정'이다. 본문(제목 아래 글)은 그대로 자유롭다.
//
// **딸린 함정 하나**: 바깥에서 value가 바뀌어 문서를 통째로 교체할 때도(setContent)
// 트랜잭션이 돈다. 옛 노트에는 그 제목이 없을 수 있어서 그때 물리면 **편집기가 새 글을
// 못 받는다**. 그래서 교체하는 동안에는 `bypass()`로 통과시킨다(아래 replacingRef).
const LockedHeadings = Extension.create({
  name: 'lockedHeadings',
  addOptions() { return { titles: [], bypass: () => false }; },
  addProseMirrorPlugins() {
    const { titles, bypass } = this.options;
    if (!titles || !titles.length) return [];
    const found = (doc) => {
      const set = new Set();
      doc.descendants((node) => {
        if (node.type.name !== 'heading') return true;
        const t = node.textContent.trim();
        if (titles.includes(t)) set.add(t);
        return false;      // 제목 안으로는 더 안 들어간다
      });
      return set;
    };
    return [new Plugin({
      filterTransaction: (tr, state) => {
        if (!tr.docChanged || bypass()) return true;
        const before = found(state.doc);
        // 아직 하나도 없으면 막지 않는다 — 빈 편집기·옛 노트에 제목을 심는 길이 필요하다
        if (!before.size) return true;
        const after = found(tr.doc);
        for (const t of before) if (!after.has(t)) return false;
        return true;
      },
    })];
  },
});

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
// 본문 이미지 줄이기는 services/image.js가 한다(첨부와 같은 코드를 쓴다).

// 서식 바가 멈추는 자리 = **스크롤 통 안에서 위에 붙어 있는 것들의 높이**.
// 업무 창은 머리줄이 `sticky top-0`이라, 0으로 두면 바가 머리줄 **위로 올라가 겹친다**
// (2026-08-30에 실제로 그렇게 나갔다 — 사용자 지적 "아예 헤더로 가면 어떻게 해").
// 높이를 재서 그만큼 내려 세운다: 머리줄 높이는 글자 크기·창 폭에 따라 달라져서
// 상수로 박으면 어느 폭에선가 반드시 어긋난다.
// z는 머리줄(z-10)보다 낮게 둔다 — 혹시 겹치더라도 머리줄이 이긴다.
//
// **통을 찾는 규칙은 브라우저의 규칙과 같아야 한다**(2026-09-07). 예전에는 `auto|scroll`만
// 보고 지나쳤는데, sticky가 실제로 멈추는 자리는 **가장 가까운 스크롤 컨테이너**이고 거기에는
// `hidden`도 들어간다(스크롤 막대만 없을 뿐 스크롤 상자다 — `clip`만 아니다). 그 상자를
// 지나쳐 더 위의 통을 재면 **브라우저가 붙이는 자리와 우리가 계산한 자리가 서로 다른 상자
// 기준**이 되어, 바가 엉뚱한 높이에서 멈추거나 아예 안 붙은 것처럼 보인다.
// 업무 창은 `overflow-hidden` 껍데기가 스크롤 통보다 **바깥**이라 답이 예전과 같다.
//
// **찾은 통을 같이 돌려준다**(2026-09-11) — 바가 붙었는지 보는 관찰자가 같은 통을 봐야
// 하기 때문이다(아래 IntersectionObserver의 `root`). 통을 여기서만 알고 있으면 관찰자는
// 뷰포트를 보게 되고, 페이지 스크롤 통에서는 그 둘이 서로 다른 상자가 된다.
//
// **통은 셋뿐이다** — 이 에디터가 서는 자리가 셋이기 때문이다(2026-09-11):
//  · **업무 창**(데스크톱 모달 안 `overflow-y-auto` 본문): 통 = 그 본문. 안에 `sticky top-0`
//    머리줄이 있어 `top`은 그 높이(≈53), `bg`는 본문의 `bg-surface`, `root`는 그 본문이다.
//  · **페이지**(예배 노트·묵상 노트 — App의 `main`): 통 = main. 안에 머리줄이 없어 `top`은
//    `-paddingTop`(위 패딩만큼 올려 창 머리줄에 붙인다), `bg`는 카드/바탕색, `root`는 main이다.
//    여기서 `root`를 빼먹어 붙어도 모양이 안 바뀌었다(아래 IntersectionObserver 주석).
//    **모바일도 같은 길이다**(2026-09-11 결정) — `MobileTopBar`는 `main` **밖**의 형제라
//    `-paddingTop`으로 올려 세우면 그 바로 밑이 곧 붙는 자리다.
//  · **모바일 풀스크린 업무 창**(창이 화면을 다 덮는 판): 통은 그 창의 본문이고 머리줄이
//    통 **밖**(`shrink-0`)이라 여기서도 머리줄 높이가 0으로 잡힌다 — `-paddingTop`(`p-5`)만큼
//    올리면 통의 테두리 상자 위, 즉 창 머리줄 바로 밑이다. 데스크톱과 같은 계산 하나다.
function useStickyTop(ref) {
  const [pos, setPos] = useState({ top: 0, bg: '', box: null });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // 이 에디터를 품은 스크롤 통을 찾는다(업무 창 본문 · 페이지 안 편집기는 App의 main)
    let box = el.parentElement;
    while (box && box !== document.body) {
      const oy = getComputedStyle(box).overflowY;
      if (oy !== 'visible' && oy !== 'clip') break;
      box = box.parentElement;
    }
    // 붙었을 때 깔 **바탕색** — 바가 놓인 통의 색이다(사용자 결정 2026-09-11: 붙으면
    // 상자가 아니라 줄). 업무 창 본문은 `bg-surface`, 페이지 노트는 그 카드/바탕이라
    // 상수로 박을 수 없다 — 색이 있는 첫 조상까지 올라가 그 색을 그대로 쓴다.
    // 투명 판정은 알파만 본다(`rgb(255,255,0)`처럼 끝이 `,0)`인 불투명 색이 있다).
    const clear = (c) => {
      if (!c || c === 'transparent') return true;
      const open = c.indexOf('(');
      if (open < 0) return false;
      const inside = c.slice(open + 1, c.lastIndexOf(')'));
      const slash = inside.indexOf('/');
      const parts = inside.split(',');
      const raw = slash >= 0 ? inside.slice(slash + 1) : (parts.length === 4 ? parts[3] : '1');
      const n = parseFloat(raw);
      return Number.isFinite(n) && n === 0;
    };
    const bgOf = () => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (!clear(c)) return c;
      }
      return '';
    };
    // 값이 그대로면 **같은 객체를 돌려준다** — 매번 새 객체를 담으면 ResizeObserver가
    // 도는 족족 리렌더가 돈다(예전에 숫자 하나였을 때는 저절로 막혔다).
    const put = (top, bg) => setPos(p => (p.top === top && p.bg === bg && p.box === box ? p : { top, bg, box }));
    const calc = () => {
      const bg = bgOf();
      if (!box || box === document.body) { put(0, bg); return; }
      // 통 안에서 **위(top:0)에 붙는** 것들 중 에디터보다 앞에 있는 것의 높이.
      // 직계 자식만 보면 안 된다 — 모달 구조가 폭에 따라 달라져서 머리줄이 한 겹
      // 더 안쪽에 있는 경우가 있다(모바일에서 그래서 0이 나왔다).
      // **에디터 안쪽은 세면 안 된다.** 서식 바 자신이 처음에는 top:0이라 이 그물에
      // 걸렸고, 자기 키(37px)만큼 자기를 내려 세웠다 — 데스크톱은 머리줄(53px)이 더 커서
      // 가려졌고 머리줄이 없는 모바일에서만 본문 한가운데에 떴다(사용자 지적 2026-08-30).
      // `compareDocumentPosition`으로 **완전히 앞에 있는 것**만 고른다:
      // FOLLOWING이면서 CONTAINED_BY가 아니어야 서로 품지 않는 앞선 형제다.
      const AHEAD = Node.DOCUMENT_POSITION_FOLLOWING;
      const INSIDE = Node.DOCUMENT_POSITION_CONTAINED_BY;
      let h = 0;
      for (const node of box.querySelectorAll('*')) {
        const rel = node.compareDocumentPosition(el);
        if (!(rel & AHEAD) || (rel & INSIDE)) continue;
        const cs = getComputedStyle(node);
        if (cs.position !== 'sticky' || parseFloat(cs.top || '0') !== 0) continue;
        h = Math.max(h, node.getBoundingClientRect().height);
      }
      // sticky의 `top`은 통의 **콘텐츠 상자** 위에서 잰다 — 통에 위쪽 패딩이 있으면
      // 0으로 둬도 그 패딩만큼 내려 서고, 그 틈으로 본문 글자가 지나가 보인다
      // (모바일 업무 창은 본문 통이 `p-5`다). 머리줄이 없으면 패딩만큼 **올려** 세워
      // 창 머리줄에 딱 붙인다. 머리줄이 있으면 그 머리줄도 같은 기준으로 서므로
      // 높이를 그대로 쓰면 된다(데스크톱은 예전과 같은 값이다).
      const pad = parseFloat(getComputedStyle(box).paddingTop || '0') || 0;
      put(Math.round(h > 0 ? h : -pad), bg);
    };
    calc();
    // **한 번 재고 끝내면 안 된다.** 통이 커지는 것 말고도 다시 재야 하는 일이 있다:
    //  · 편집기가 늦게 마운트되거나(lazy) 읽기 모드에서 `display:none`으로 숨어 있다가
    //    '수정'으로 드러난다 — 그때 첫 calc은 폭 0짜리 상자에서 돌았다(QT 묵상이 그렇다).
    //  · 창 폭이 바뀌면 머리줄 높이와 통의 padding(`pt-2.5` → `md:pt-3.5`)이 같이 바뀐다.
    // 그래서 통과 **편집기 자신**을 둘 다 보고, 창 크기 변화도 듣는다. min-height만 바뀌는
    // 계산이 아니라 값 하나를 setState하는 것뿐이라 되풀이(재기 → 커짐 → 다시 재기)가 없다.
    const ro = new ResizeObserver(calc);
    if (box && box !== document.body) ro.observe(box);
    ro.observe(el);
    window.addEventListener('resize', calc);
    return () => { ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [ref]);
  return pos;
}

// `lockedHeadings` — 지워지지 않는 중제목 목록(노트의 도막 이름). **편집기를 만들 때
// 한 번 읽는다** — 화면마다 고정이라 바뀌지 않는다(예배 노트 넷 · QT 셋).
//
// `tools` — 서식 바에 무엇을 두는지. 기본 `'all'`(업무 상세)은 전부이고, `'note'`(예배
// 노트·묵상 노트)는 **제목(H1~H4)·구분선·링크를 뺀다** — 제목은 2026-09-10, 구분선·링크는
// 2026-09-11의 사용자 결정이다("불렛과 번호, 체크박스는 남겨두고 구분선이랑 링크 서식은
// 제거"). 도막 제목이 고정이라 제목을 새로 만들 일이 없고(단계를 바꾸면 그 도막이 종이에서
// 라벨로 안 올라가는 것처럼 보인다), 종이에는 선을 긋지 않으며 링크도 쓰지 않는다.
//
// `frame` — 편집 칸을 감싸는 틀. 받으면 `frame(<EditorContent/>)`로 그 안에 넣는다.
// 노트가 이것으로 **종이 안에서 쓰기**를 만든다(components/paper.jsx `NotePaper`).
// 서식 바는 틀 **밖·위**에 그대로 남는다 — sticky로 따라 내려오는 것이 그 자리다.
export function MarkdownEditor({
  value, onChange, members = [], cloudMode = false, placeholder, className = '',
  lockedHeadings = [], tools = 'all', frame = null,
}) {
  const lastEmitted = useRef(value ?? '');
  // 문서를 통째로 교체하는 중인가 — 그때는 중제목 고정을 통과시킨다(LockedHeadings 머리말)
  const replacingRef = useRef(false);
  const editorRef = useRef(null);
  const cloudModeRef = useRef(cloudMode);
  const [uploading, setUploading] = useState(false);

  // 서식 바는 **모든 폭에서 같은 방식**이다 — 통 안에서 위에 붙는 sticky 하나(사용자 결정
  // 2026-09-11: "그냥 데스크톱처럼 똑같은 방식으로 모바일·태블릿에서도 되게"). 그래서
  // 이 부품에 폭 분기가 없다 — 자리는 useStickyTop 하나가 잰다.
  const wrapRef = useRef(null);

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
    // 정확 일치 > 접두 일치 > 포함 순 — 동명 유사 이름("노준석"/"노준석_서브")에서 오선택 방지
    const rank = (n) => { const l = n.toLowerCase(); return l === q ? 0 : l.startsWith(q) ? 1 : 2; };
    // 목록은 max-h-48 안에서 스크롤된다 — 6명에서 자르면 뒷순번 사람이
    // 아예 없는 것처럼 보였다(담당자 선택기와 같은 판단).
    return [...new Set(members.filter(Boolean))].filter(n => n.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'));
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
      const url = await uploadContentImage(await downscaleImage(file, BODY_MAX_DIM));
      editorRef.current?.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      console.error('[cloud] 본문 이미지 업로드 실패:', e);
      showToast(failText('이미지를 올리지 못했어요', e));
    } finally {
      setUploading(false);
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // 우리 마크다운 서브셋에 없는 블록·마크는 비활성화
        blockquote: false, codeBlock: false, code: false,
        // 구분선 — `---`를 치면 바로 선이 된다(StarterKit의 입력 규칙). `***`·`___`도 같이
        // 받는다. 저장 형식은 언제나 `---` 한 줄이다(markdown.js).
        horizontalRule: {},
        // 생 URL은 평문으로 유지해야 하므로 자동 링크화 금지
        link: { openOnClick: false, autolink: false, linkOnPaste: false },
      }),
      Highlight,
      // 본문 체크리스트 — 저장 형식은 `- [ ]`/`- [x]` 한 줄(markdown.js).
      // nested: false — 중첩 체크리스트는 서브셋에 없다(직렬화가 첫 문단만 본다).
      TaskList,
      TaskItem.configure({ nested: false }),
      Image.configure({ inline: false, allowBase64: false }),
      // dataAttribute 기본값은 'placeholder' — CSS content: attr(data-placeholder)와
      // 맞추기 위해 명시한다(index.css의 .tiptap 규칙과 한 쌍)
      Placeholder.configure({ placeholder: placeholder || '내용을 입력하세요...', dataAttribute: 'data-placeholder' }),
      HeadingExit,
      // 문서를 통째로 교체하는 중에는 통과시킨다(위 머리말의 함정)
      LockedHeadings.configure({ titles: lockedHeadings, bypass: () => replacingRef.current }),
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
      handlePaste: (view, event) => {
        const img = Array.from(event.clipboardData?.files || []).find(f => (f.type || '').startsWith('image/'));
        if (img && cloudModeRef.current) {
          event.preventDefault();
          uploadImage(img);
          return true;
        }
        // **글을 고른 채 주소를 붙여넣으면 그 글이 링크가 된다.** 가장 흔한 링크 넣기인데
        // 예전에는 고른 글이 주소로 갈아치워졌다(사용자 요청 2026-08-30 — "링크 넣는
        // 방식을 쉽게"). 고른 것이 없을 때는 손대지 않는다 — 생 URL은 평문으로 두는 것이
        // 이 에디터의 규칙이고(autolink: false) RichText가 알아서 링크로 그린다.
        const text = (event.clipboardData?.getData('text/plain') || '').trim();
        if (!text || view.state.selection.empty) return false;
        if (!/^https?:\/\/\S+$/i.test(text)) return false;
        event.preventDefault();
        editorRef.current?.chain().focus().setLink({ href: text }).run();
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
    onBlur: () => { setTimeout(closeMention, 120); },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // 서식 바가 통 위에 붙었나 — 붙으면 **상자가 아니라 줄**이 된다(사용자 결정
  // 2026-09-11 · 아래 Toolbar 머리말). 폭과 상관없이 모든 화면에서 같다.
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef(null);
  const { top: stickyTop, bg: stuckBg, box: scrollBox } = useStickyTop(wrapRef);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setStuck(false); return undefined; }
    // **관찰하는 상자가 바가 붙는 통과 같아야 한다**(2026-09-11 · §6-9-aa).
    // `root`를 비워 두면 기본이 뷰포트다 — 업무 창은 통이 화면 한가운데라 우연히 맞았지만,
    // **페이지 스크롤 통**(App의 main)에서는 센티넬이 그 통의 잘림선(화면 위 53px)에서
    // 이미 사라진다. 그때 `boundingClientRect.top`은 아직 41px쯤이라 `< 0`이 거짓이고,
    // 한 번 어긋나면 관찰자가 다시 부르지 않아 **바가 붙어도 모양이 그대로**였다
    // (사용자 지적 2026-09-11 — 1440에서 예배 노트 '수정' 뒤 스크롤).
    const root = scrollBox && scrollBox !== document.body ? scrollBox : null;
    // 바가 멈추는 줄 = 통의 **콘텐츠 상자 위 + stickyTop**이다(sticky의 top은 콘텐츠
    // 상자에서 잰다 — 위 useStickyTop의 `pad` 주석과 같은 규칙). rootMargin으로 관찰
    // 상자의 위를 그만큼 깎아 두면 센티넬이 그 줄을 넘는 순간이 곧 붙는 순간이다.
    // 음수일 수 있어(머리줄이 없으면 stickyTop이 `-pad`다) 부호는 계산해서 넣는다.
    const pad = root ? parseFloat(getComputedStyle(root).paddingTop || '0') || 0 : 0;
    // **아래쪽은 통째로 열어 둔다**(`0px` 대신 큰 값). 관찰자는 '겹침이 바뀔 때'만 부른다 —
    // 아래도 닫아 두면 편집기가 통 **밑에** 있을 때도 '안 겹침'이라, 거기서 한 번에 위로
    // 뛰면(닻 이동·빠른 튕김·scrollIntoView) 안 겹침 → 안 겹침이 되어 **아무도 안 부른다**.
    // 실제로 그랬다: 조금씩 굴리면 붙는데 0에서 1161로 한 번에 가면 모양이 그대로였다
    // (2026-09-11 헤드리스). 아래를 열어 두면 '밑에 있다 = 겹친다'가 되어 줄을 넘는
    // 순간이 늘 한 번의 변화가 된다.
    const io = new IntersectionObserver(
      // 위로 지나갔을 때만 '붙었다'이다 — 가르는 기준은 0이 아니라 **깎은 뒤의 관찰 상자
      // 위**다(root가 뷰포트가 아니라 통이면 그 자리가 0이 아니다).
      ([entry]) => setStuck(!entry.isIntersecting
        && entry.boundingClientRect.top < (entry.rootBounds ? entry.rootBounds.top : 0)),
      { root, threshold: 0, rootMargin: `${-(pad + stickyTop)}px 0px 100000px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stickyTop, scrollBox]);

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
    // 교체하는 동안에는 중제목 고정을 통과시킨다 — 옛 노트에 그 제목이 없으면
    // 그 트랜잭션이 물려서 새 글이 들어오지 못한다(LockedHeadings 머리말)
    replacingRef.current = true;
    try { editor.commands.setContent(mdToDoc(incoming), { emitUpdate: false }); }
    finally { replacingRef.current = false; }
  }, [value, editor]);

  // 툴바 활성 상태 — 필요한 불리언만 구독해 타이핑마다 전체 리렌더되지 않게
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ed ? {
      bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'),
      strike: ed.isActive('strike'), highlight: ed.isActive('highlight'), link: ed.isActive('link'),
      h1: ed.isActive('heading', { level: 1 }), h2: ed.isActive('heading', { level: 2 }),
      h3: ed.isActive('heading', { level: 3 }), h4: ed.isActive('heading', { level: 4 }),
      bullet: ed.isActive('bulletList'), ordered: ed.isActive('orderedList'),
      todo: ed.isActive('taskList'),
    } : {},
  }) || {};

  // 빈 공간을 눌러도 글이 써진다 — 예전에는 글자가 있는 자리를 정확히 눌러야 커서가
  // 잡혀서, 아래 여백을 누르면 아무 일도 안 일어났다(사용자 지적 2026-08-30).
  // .tiptap이 아닌 곳(감싸개의 패딩·남는 높이)을 누른 경우에만 문서 끝으로 보낸다 —
  // 안 그러면 글 가운데를 눌러 커서를 옮기는 정상 동작을 뺏는다.
  //
  // **틀 안의 입력 칸은 건드리지 않는다**(2026-09-11 · §6-32-y). 틀(frame)이 들어오면서
  // 이 감싸개 안에 편집기 말고 **누를 것**이 생겼다 — 묵상 노트의 제목 칸이 그렇다
  // (paper.jsx PaperNoteHead). 그것까지 여기서 preventDefault로 막고 포커스를 편집기
  // 끝으로 보내 버려서, 실기기에서 제목 칸을 눌러도 커서가 안 잡혔다(사용자 지적
  // 2026-09-11 — "제목 미정 글자만 있고 못 고친다"). 스스로 포커스를 받는 것들은 그대로 둔다.
  const SELF_FOCUS = 'input, textarea, button, a, [contenteditable], select, label';
  const focusEnd = (e) => {
    if (!editor || e.target.closest('.tiptap') || e.target.closest(SELF_FOCUS)) return;
    e.preventDefault();                       // 눌린 자리에서 선택이 시작되지 않게
    editor.chain().focus('end').run();
  };

  return (
    <div ref={wrapRef} className="relative">
      {/* 센티넬 — 서식 바가 '붙었는지'를 이걸로 잰다(Injoy 글쓰기와 같은 방식).
          scroll 이벤트로 매 프레임 재는 대신 IntersectionObserver 한 번이면 된다. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {/* 바는 **제자리에 그대로 둔다** — sticky는 문서 흐름 안에 있어야 붙는다.
          모바일에서 body로 빼 화면 아래에 고정하던 길은 2026-09-11에 걷었다(§6-9-aa-4). */}
      <Toolbar
        editor={editor} active={active} uploading={uploading} tools={tools}
        stuck={stuck} top={stickyTop} stuckBg={stuckBg} />
      {/* onMouseDown이라야 한다 — click은 선택이 이미 끝난 뒤라 커서가 안 옮겨진다.
          틀(frame)이 있으면 편집 칸이 그 안에 든다 — 종이 여백을 눌러도 focusEnd가
          도는 것은 그대로다(`.tiptap` 밖이면 문서 끝으로 보낸다). */}
      <div className={className} onMouseDown={focusEnd}>
        {frame ? frame(<EditorContent editor={editor} />) : <EditorContent editor={editor} />}
      </div>
      {mention && suggestions.length > 0 && (
        <div
          style={{ position: 'fixed', left: Math.min(mention.left, window.innerWidth - 176), top: mention.top + 4 }}
          className="z-[80] w-max min-w-[9rem] max-w-[min(16rem,calc(100vw-2rem))] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150"
        >
          {suggestions.map((name, i) => (
            <button
              key={name} type="button"
              // 방향키로 목록 밖까지 내려가도 활성 항목이 보이게
              ref={i === activeIdx ? keepVisible : null}
              onMouseDown={(e) => { e.preventDefault(); pick(name); }}
              // text-[13px]: 담당자 선택기·더보기 메뉴와 같은 크기(14px는 본문 옆에서 커 보였다)
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}
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

function Toolbar({
  editor, active, uploading, tools = 'all',
  stuck = false, top = 0, stuckBg = '',
}) {
  // 노트 한 벌 — 제목·구분선·링크가 빠지고 글자 서식과 목록 셋만 남는다(머리말의 `tools`)
  const note = tools === 'note';
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  // 단축키가 부르는 자리 — 훅은 early return보다 위에 있어야 하고 openLink는 아래에 있다
  const openLinkRef = useRef(null);
  const linkBtnRef = useRef(null);
  const linkRootRef = useRef(null);
  const [linkPos, placeLink] = useAnchoredPos(linkBtnRef, linkOpen, 256, 110);

  useEffect(() => {
    if (!linkOpen) return;
    const onDown = (e) => { if (linkRootRef.current && !linkRootRef.current.contains(e.target)) setLinkOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setLinkOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [linkOpen]);

  // Ctrl/⌘+K — 글을 고른 채 누르면 바로 주소 칸이 열린다(어느 편집기나 이 자리다).
  // 에디터 DOM에 건다 — window에 걸면 업무 창 밖에서도 잡힌다.
  useEffect(() => {
    if (!editor || note) return undefined;
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      openLinkRef.current?.();
    };
    // **`editor.view`는 뷰가 붙기 전에는 게터가 던진다** — 옵셔널 체이닝으로 못 막는다.
    // 처음 렌더에서 실제로 터져서 업무 수정 창이 통째로 오류 화면이 됐다(2026-08-30).
    // 붙었을 때 한 번 더 붙여 본다('create'는 뷰가 생긴 뒤에 온다).
    let dom = null;
    const attach = () => {
      if (dom) return;
      try { dom = editor.view.dom; } catch { dom = null; return; }
      dom.addEventListener('keydown', onKey);
    };
    attach();
    editor.on('create', attach);
    return () => { editor.off('create', attach); dom?.removeEventListener('keydown', onKey); };
  }, [editor, note]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  // 고른 글자 — 팝오버에 "무엇에 링크를 거는지" 그대로 보여준다.
  // 예전에는 주소 칸만 있어서, 고른 것이 없을 때 무엇이 생기는지 눌러 봐야 알았다.
  const { from, to, empty } = editor.state.selection;
  const picked = empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim();

  const openLink = () => {
    // 이미 링크가 걸린 자리면 그 주소를 채워 둔다 — 고치는 것이 흔한 일인데
    // 빈 칸이 뜨면 주소를 다시 찾아 와야 했다
    setHref(editor.getAttributes('link')?.href || '');
    placeLink();
    setLinkOpen(o => !o);
  };
  openLinkRef.current = openLink;

  const applyLink = () => {
    const url = href.trim();
    if (!url) return;
    // 사람은 `naver.com`이라고 적는다 — https를 알아서 붙인다.
    // 메일 주소는 mailto:로(그것도 링크다).
    const full = /^(https?:\/\/|mailto:)/i.test(url)
      ? url
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
    if (editor.state.selection.empty) {
      // 고른 것이 없으면 주소를 글자로 넣고 그 글자에 링크를 건다
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

  // **붙으면 상자가 아니라 줄이 된다**(사용자 결정 2026-09-11 — 글 위에 상자가 얹혀 떠
  // 있는 것처럼 보였고, 노트 종이에서는 인디고 마스트가 그 밑으로 지나갔다).
  // 붙은 상태에서는 둥근 모서리·양옆·위 선을 걷고 **아래 가는 선 하나 + 연한 그림자**만
  // 남기며, 배경은 그 통의 바탕색(useStickyTop이 재 온다)이라 평평하게 눕는다.
  // 2026-08-30의 "그림자도 없이"는 여기서 갱신됐다 — 상자를 지우는 대신 글과 바를 가르는
  // 표시가 하나는 있어야 한다. 배경은 두 상태 모두 **완전 불투명**이다(블러 금지 · §6-9-aa):
  // 반투명이면 밑으로 지나가는 글이 비쳐 바가 글자 위에 얹힌 것처럼 보인다.
  //
  // **모든 폭에서 이 한 벌이다**(사용자 결정 2026-09-11 — "그냥 데스크톱처럼 똑같은 방식으로
  // 모바일·태블릿에서도"). 모바일만 화면 아래(키보드 위)에 fixed로 세우던 갈래는 실기기
  // 아이폰에서 `visualViewport` 계산이 키보드 위에 서지 않아 걷었다(§6-9-aa-4).
  // overflow-x-auto: 좁은 화면에서 버튼이 줄바꿈으로 두 줄이 되면 바가 본문을 가린다 —
  // 같은 종류가 이어지는 줄이라 가로 스크롤이 §8에 걸리지 않는다(프로젝트 탭과 같은 결).
  const EASE = 'var(--ease-out-quint)';
  return (
    <div
      data-editor-bar="sticky"
      style={{
        top,
        transition: `background-color .15s ${EASE}, border-color .15s ${EASE}, border-radius .15s ${EASE}, box-shadow .15s ${EASE}`,
        ...(stuck && stuckBg ? { background: stuckBg } : null),
      }}
      className={`flex items-center gap-0.5 overflow-x-auto scrollbar-hide x-scroll-lock bg-surface-2 sticky z-[5] px-1.5 py-1 border border-line ${
        stuck ? 'rounded-none border-x-0 border-t-0 shadow-soft' : 'rounded-t-md border-b-0'
      }`}
    >
      <TB on={active.bold} onClick={() => chain().toggleBold().run()} title="굵게"><Bold size={14} /></TB>
      <TB on={active.italic} onClick={() => chain().toggleItalic().run()} title="기울임"><Italic size={14} /></TB>
      <TB on={active.underline} onClick={() => chain().toggleUnderline().run()} title="밑줄"><Underline size={14} /></TB>
      <TB on={active.strike} onClick={() => chain().toggleStrike().run()} title="취소선"><Strikethrough size={14} /></TB>
      <TB on={active.highlight} onClick={() => chain().toggleHighlight().run()} title="형광펜"><Highlighter size={14} /></TB>
      {/* 제목 묶음 — **노트에서는 빠진다**(`tools="note"` · 사용자 결정 2026-09-10).
          도막 제목이 고정이라 제목을 만들 일이 없고, 그 앞의 구분선도 이 묶음의 것이라
          같이 걷는다. `tests/word`가 노트 바에 `title="제목 1"`이 **없어야 한다**로
          단정한다(업무 본문·업무 창은 그대로 넷 다 있다 — `tests/handoff`). */}
      {!note && (
        <>
          <span className="w-px h-4 bg-line mx-1 shrink-0" />
          <TB on={active.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()} title="제목 1"><Heading1 size={15} /></TB>
          <TB on={active.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} title="제목 2"><Heading2 size={15} /></TB>
          {/* 저장 형식(#~####)과 뷰어는 4단계까지 이미 지원하고 있었다 — 버튼만 없었다 */}
          <TB on={active.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()} title="제목 3"><Heading3 size={15} /></TB>
          <TB on={active.h4} onClick={() => chain().toggleHeading({ level: 4 }).run()} title="제목 4"><Heading4 size={15} /></TB>
        </>
      )}
      <TB on={active.bullet} onClick={() => chain().toggleBulletList().run()} title="불릿 목록"><List size={15} /></TB>
      <TB on={active.ordered} onClick={() => chain().toggleOrderedList().run()} title="번호 목록"><ListOrdered size={15} /></TB>
      <TB on={active.todo} onClick={() => chain().toggleTaskList().run()} title="체크리스트"><ListTodo size={15} /></TB>
      {/* 구분선·링크 — **노트에서는 뺀다**(`tools="note"` · 사용자 결정 2026-09-11:
          "불렛과 번호, 체크박스는 남겨두고 구분선이랑 링크 서식은 제거"). 업무 상세에는
          그대로 둔다. 구분선은 본문에 `---`를 쳐도 되지만 버튼도 두는 이유는 §8이다:
          치는 법을 아는 사람만 쓸 수 있는 기능은 숨긴 것과 같다. */}
      {!note && (<>
        <TB onClick={() => chain().setHorizontalRule().run()} title="구분선"><Minus size={15} /></TB>
        <span className="w-px h-4 bg-line mx-1 shrink-0" />
        <span ref={linkRootRef} className="inline-flex">
          <span ref={linkBtnRef} className="inline-flex">
            <TB on={active.link} onClick={openLink} title={picked ? `'${picked.slice(0, 12)}'에 링크를 걸어요` : '링크 (Ctrl/⌘+K)'}><Link2 size={14} /></TB>
          </span>
          {linkOpen && (
            <div
              style={{ position: 'fixed', left: linkPos.left, top: linkPos.top, width: 256 }}
              className="z-[90] bg-surface border border-line rounded-lg shadow-elevated p-2.5 animate-in fade-in zoom-in-95 duration-150"
            >
              {/* 무엇에 링크가 걸리는지 먼저 말한다 — 고른 것이 없으면 주소가 그대로 글자가
                  된다는 것도 알려 준다(예전에는 눌러 봐야 알았다) */}
              <p className="text-[10.5px] text-fg-faint mb-1.5 truncate">
                {picked ? <>‘<span className="text-fg-muted font-semibold">{picked}</span>’에 링크를 걸어요.</> : '주소가 그대로 글자가 돼요.'}
              </p>
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
      </>)}
      {uploading && (
        <span className="ml-auto flex items-center gap-1 text-[10px] text-fg-muted pr-1">
          <Loader2 size={11} className="animate-spin" /> 이미지 업로드 중...
        </span>
      )}
    </div>
  );
}
