// ============================================================================
// 마크다운 서브셋 ↔ TipTap(ProseMirror) 문서 변환
// ----------------------------------------------------------------------------
// 저장 형식은 계속 "문자열(우리 마크다운 서브셋)"이다. 뷰어(RichText)·AI 프롬프트·
// 기존 데이터와 호환되어야 하므로 에디터는 로드 시 md→doc, 변경 시 doc→md 한다.
// tiptap-markdown은 우리 비표준 문법(__밑줄__, ==형광펜==)을 다루지 못해 자체 구현.
//
// 지원 범위 (RichText와 1:1 대응)
//   블록: 문단 / #~#### 제목 / - 불릿 / 1. 번호 / 이미지 URL 단독 줄 / 빈 줄
//   마크: **굵게** *기울임* __밑줄__ ~~취소선~~ ==형광펜== [텍스트](URL)
//   @멘션·생 URL은 노드화하지 않고 일반 텍스트로 유지 (뷰어가 렌더)
//
// 라운드트립 원칙: 블록 하나가 정확히 한 줄(목록은 항목당 한 줄)로 직렬화되고
// 줄들을 '\n'으로 이어 붙인다. 빈 줄은 빈 문단으로 표현해 원문을 보존한다.
// ============================================================================

// 인라인 토큰 — 순서 중요: 링크가 먼저, *** → ** → * 순
const INLINE_SPLIT_RE = /(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|\*[^*\n]+\*)/g;
export const MD_LINK_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/;

// 래퍼 하나를 벗겨내면 안쪽을 다시 토큰화한다 → ==**형광펜+굵게**== 같은 중첩도
// 마크로 살아난다(전에는 안쪽이 평문이라 '**'가 글자 그대로 남았다).
const WRAPPERS = [
  { re: /^\*\*\*([^*\n]+)\*\*\*$/, marks: ['bold', 'italic'] },
  { re: /^\*\*([^*\n]+)\*\*$/, marks: ['bold'] },
  { re: /^__([^_\n]+)__$/, marks: ['underline'] },
  { re: /^~~([^~\n]+)~~$/, marks: ['strike'] },
  { re: /^==([^=\n]+)==$/, marks: ['highlight'] },
  { re: /^\*([^*\n]+)\*$/, marks: ['italic'] },
];

// 인라인 문자열 → 평평한 세그먼트 배열 [{ text, marks:['bold',…], href }]
// 뷰어(RichText)와 에디터(mdToDoc)가 같은 토크나이저를 쓰도록 여기서만 정의한다.
export function tokenizeInline(text, marks = [], href = null) {
  if (!text) return [];
  const out = [];
  for (const part of String(text).split(INLINE_SPLIT_RE)) {
    if (!part) continue;
    const link = part.match(MD_LINK_RE);
    if (link) { out.push(...tokenizeInline(link[1], marks, link[2])); continue; }
    const wrap = WRAPPERS.find(w => w.re.test(part));
    if (wrap) { out.push(...tokenizeInline(part.match(wrap.re)[1], [...marks, ...wrap.marks], href)); continue; }
    out.push({ text: part, marks, href });
  }
  return out;
}
// 줄 전체가 이미지 URL일 때만 image 노드로 (일부만 포함된 줄은 문단으로 두어 원문 보존)
export const IMAGE_LINE_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?$/i;

const textNode = (text, marks) => (marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text });

// ── 인라인 문자열 → PM text 노드 배열 ───────────────────────────────────────
function parseInline(text) {
  return tokenizeInline(text).map(seg => {
    const marks = [...new Set(seg.marks)].map(type => ({ type }));
    if (seg.href) marks.push({ type: 'link', attrs: { href: seg.href } });
    return textNode(seg.text, marks);
  });
}

const paragraph = (text) => {
  const content = parseInline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};
const listItem = (text) => ({ type: 'listItem', content: [paragraph(text)] });

// ── 마크다운 문자열 → TipTap doc JSON ───────────────────────────────────────
export function mdToDoc(md) {
  const content = [];
  const lines = String(md ?? '').split('\n');

  for (const raw of lines) {
    const line = raw.trim();

    // 이미지 단독 줄
    if (IMAGE_LINE_RE.test(line)) { content.push({ type: 'image', attrs: { src: line } }); continue; }

    // 구분선 — `---` `***` `___` 셋 다 받는다(마크다운 관행). 우리가 쓰는 것은 `---`.
    // **제목보다 먼저 본다** — `---`는 아래 문단 규칙에도 걸리는 모양이다.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { content.push({ type: 'horizontalRule' }); continue; }

    // 제목 (#~####)
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) { content.push({ type: 'heading', attrs: { level: h[1].length }, content: parseInline(h[2]) }); continue; }

    // 체크리스트(- [ ] / - [x]) — 불릿보다 먼저 본다(불릿 패턴에도 걸리는 모양이라)
    const todo = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/);
    if (todo) {
      const item = { type: 'taskItem', attrs: { checked: todo[1].toLowerCase() === 'x' }, content: [paragraph(todo[2])] };
      const prev = content[content.length - 1];
      if (prev?.type === 'taskList') prev.content.push(item);
      else content.push({ type: 'taskList', content: [item] });
      continue;
    }

    // 불릿 — 연속되면 하나의 목록으로 묶음
    const ul = raw.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      const prev = content[content.length - 1];
      if (prev?.type === 'bulletList') prev.content.push(listItem(ul[1]));
      else content.push({ type: 'bulletList', content: [listItem(ul[1])] });
      continue;
    }

    // 번호 목록
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      const prev = content[content.length - 1];
      if (prev?.type === 'orderedList') prev.content.push(listItem(ol[1]));
      else content.push({ type: 'orderedList', content: [listItem(ol[1])] });
      continue;
    }

    // 그 외(빈 줄 포함) → 문단. 빈 줄은 빈 문단으로 남겨 원문 줄 수를 보존한다.
    content.push(paragraph(raw));
  }

  // PM doc은 최소 1개 블록이 필요
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

// ── PM text 노드 → 마크다운 인라인 문자열 ──────────────────────────────────
// 안쪽부터 감싸고 링크를 가장 바깥에 둔다 (단일 마크가 대부분이라 순서 영향 적음)
const WRAP_ORDER = [
  ['italic', '*'],
  ['bold', '**'],
  ['strike', '~~'],
  ['underline', '__'],
  ['highlight', '=='],
];

function serializeText(node) {
  let text = node.text ?? '';
  const marks = node.marks || [];
  const has = (name) => marks.some(m => m.type === name);
  for (const [name, token] of WRAP_ORDER) {
    if (has(name) && text) text = `${token}${text}${token}`;
  }
  const link = marks.find(m => m.type === 'link');
  if (link?.attrs?.href) text = `[${text}](${link.attrs.href})`;
  return text;
}

function serializeInlineContent(content = []) {
  return content.map(n => {
    if (n.type === 'text') return serializeText(n);
    if (n.type === 'hardBreak') return '\n';
    // 인라인 이미지는 우리 서브셋에 없으므로 URL만 남긴다
    if (n.type === 'image') return n.attrs?.src || '';
    return '';
  }).join('');
}

// listItem 안의 블록들을 줄 배열로 (중첩 목록은 들여쓰기 — 뷰어는 같은 레벨로 렌더)
function serializeListItem(item, marker, depth) {
  const lines = [];
  const pad = '  '.repeat(depth);
  const blocks = item.content || [];
  blocks.forEach((b, i) => {
    if (b.type === 'paragraph') {
      const text = serializeInlineContent(b.content);
      if (i === 0) lines.push(`${pad}${marker} ${text}`);
      else if (text) lines.push(`${pad}  ${text}`);
    } else if (b.type === 'bulletList' || b.type === 'orderedList') {
      lines.push(...serializeList(b, depth + 1));
    } else {
      lines.push(...serializeBlock(b));
    }
  });
  if (!lines.length) lines.push(`${pad}${marker} `);
  return lines;
}

function serializeList(list, depth = 0) {
  const ordered = list.type === 'orderedList';
  const start = ordered ? (list.attrs?.start ?? 1) : 1;
  const lines = [];
  (list.content || []).forEach((item, i) => {
    const marker = ordered ? `${start + i}.` : '-';
    lines.push(...serializeListItem(item, marker, depth));
  });
  return lines;
}

function serializeBlock(block) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.attrs?.level || 1, 1), 4);
      return [`${'#'.repeat(level)} ${serializeInlineContent(block.content)}`];
    }
    case 'bulletList':
    case 'orderedList':
      return serializeList(block, 0);
    // 체크리스트 — 항목당 한 줄(- [ ] / - [x]). 항목 안은 문단 하나만 본다
    // (에디터에서 taskItem에 문단을 더 쌓는 조작을 열어두지 않았다 — nested: false).
    case 'taskList':
      return (block.content || []).map(item =>
        `- [${item.attrs?.checked ? 'x' : ' '}] ${serializeInlineContent(item.content?.[0]?.content)}`);
    case 'image':
      return [block.attrs?.src || ''];
    // 구분선은 언제나 `---`로 적는다 — 읽을 때는 ***·___도 받지만(mdToDoc) 쓸 때는 한 벌이다
    case 'horizontalRule':
      return ['---'];
    case 'paragraph':
    default:
      return [serializeInlineContent(block.content)];
  }
}

// ── TipTap doc JSON → 마크다운 문자열 ──────────────────────────────────────
export function docToMd(doc) {
  const blocks = doc?.content || [];
  const lines = [];
  for (const b of blocks) lines.push(...serializeBlock(b));
  // 하드브레이크가 만든 개행을 줄 단위로 펴고, 끝의 빈 줄은 정리
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
