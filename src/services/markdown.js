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

    // 번호 목록 — **첫 항목의 숫자를 `attrs.start`로 들고 간다.** 목록 사이에 불릿 같은
    // 다른 블록이 끼면 뒤 목록은 `2.`·`3.`으로 이어지는데, 쓰는 쪽(serializeList)은 그
    // 숫자를 제대로 적는데 읽는 쪽이 버려서 **저장하고 다시 열면 전부 `1.`** 이 됐다
    // (사용자 지적 2026-09-11 · 그리는 쪽 RichText도 같이 고쳤다).
    const ol = raw.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) {
      const prev = content[content.length - 1];
      if (prev?.type === 'orderedList') prev.content.push(listItem(ol[2]));
      else content.push({ type: 'orderedList', attrs: { start: Number(ol[1]) || 1 }, content: [listItem(ol[2])] });
      continue;
    }

    // 그 외(빈 줄 포함) → 문단. 빈 줄은 빈 문단으로 남겨 원문 줄 수를 보존한다.
    content.push(paragraph(raw));
  }

  // PM doc은 최소 1개 블록이 필요
  if (!content.length) content.push({ type: 'paragraph' });
  // **제목으로 끝나면 빈 문단을 하나 붙인다**(사용자 신고 2026-09-18 — "기도 섹션이
  // 눌러야 도막이 늘어난다 … 처음에는 도막이 아예 없는 것처럼 보인다").
  // `docToMd`가 저장할 때 끝의 빈 문단을 잘라내므로, 한 번 저장했거나 브라우저 초안으로
  // 되살아난 노트는 마지막 도막 제목으로 **끝나** 버린다 — 그 도막에는 문단이 아예 없어
  // 종이에 쓸 칸이 안 그려지고(도막 min-height가 걸릴 요소가 없다), 커서를 넣는 순간
  // ProseMirror가 그제서야 문단을 만들어 칸이 튀어나왔다.
  // 여기서 붙이면 템플릿·저장본·초안 세 길이 한 번에 같아진다.
  // **저장 형식은 안 변한다** — docToMd가 이 빈 문단을 다시 잘라내므로 왕복은 그대로다
  // (tests/mdcheck가 그 왕복을 단정한다).
  if (content[content.length - 1]?.type === 'heading') content.push({ type: 'paragraph' });
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

// `br`: 줄 안의 하드브레이크(Shift+Enter)를 무엇으로 적나. **문단만 줄바꿈이다** —
// 제목·목록·체크 항목은 한 줄이 곧 한 블록이라, 거기서 `\n`을 적으면 다시 열 때 둘째 줄이
// 그 블록 밖의 문단으로 떨어졌다(2026-09-25 감사). 그 자리들에서는 공백으로 잇는다 —
// 글은 한 글자도 안 잃고 블록 안에 남는다(편집기도 그 자리의 Shift+Enter를 막는다 ·
// MarkdownEditor BlockBreaks).
function serializeInlineContent(content = [], br = '\n') {
  return content.map(n => {
    if (n.type === 'text') return serializeText(n);
    if (n.type === 'hardBreak') return br;
    // 인라인 이미지는 우리 서브셋에 없으므로 URL만 남긴다
    if (n.type === 'image') return n.attrs?.src || '';
    return '';
  }).join('');
}
// 문단 — 하드브레이크로 갈린 줄마다 pad를 붙인다
const serializeParagraph = (content, pad = '') =>
  serializeInlineContent(content).split('\n').map(l => `${pad}${l}`).join('\n');

// listItem 안의 블록들을 줄 배열로. **중첩 목록도 들여쓰지 않고 같은 줄에 편다**(2026-09-25) —
// 읽는 쪽(mdToDoc·RichText·종이)은 들여쓰기를 보지 않아서, 들여 적어도 다시 열면 평평해지고
// 그 다음 저장에서야 들여쓰기가 사라졌다(값이 저장할 때마다 흔들렸다). 처음부터 평평하게
// 적으면 한 번에 굳는다. 편집기도 Tab으로 들이는 길을 막았다(MarkdownEditor BlockBreaks).
function serializeListItem(item, marker) {
  const lines = [];
  const blocks = item.content || [];
  blocks.forEach((b, i) => {
    if (b.type === 'paragraph') {
      if (i === 0) lines.push(`${marker} ${serializeInlineContent(b.content, ' ')}`);
      // 항목 안 둘째 문단은 예전처럼 두 칸 들여 적는다(다시 열면 들여쓴 문단이다)
      else if (serializeInlineContent(b.content)) lines.push(serializeParagraph(b.content, '  '));
    } else if (b.type === 'bulletList' || b.type === 'orderedList') {
      lines.push(...serializeList(b));
    } else {
      lines.push(...serializeBlock(b));
    }
  });
  if (!lines.length) lines.push(`${marker} `);
  return lines;
}

function serializeList(list) {
  const ordered = list.type === 'orderedList';
  const start = ordered ? (list.attrs?.start ?? 1) : 1;
  const lines = [];
  (list.content || []).forEach((item, i) => {
    const marker = ordered ? `${start + i}.` : '-';
    lines.push(...serializeListItem(item, marker));
  });
  return lines;
}

function serializeBlock(block) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.attrs?.level || 1, 1), 4);
      return [`${'#'.repeat(level)} ${serializeInlineContent(block.content, ' ')}`];
    }
    case 'bulletList':
    case 'orderedList':
      return serializeList(block);
    // 체크리스트 — 항목당 한 줄(- [ ] / - [x]). 항목 안은 문단 하나만 본다
    // (에디터에서 taskItem에 문단을 더 쌓는 조작을 열어두지 않았다 — nested: false).
    case 'taskList':
      return (block.content || []).map(item =>
        `- [${item.attrs?.checked ? 'x' : ' '}] ${serializeInlineContent(item.content?.[0]?.content, ' ')}`);
    case 'image':
      return [block.attrs?.src || ''];
    // 구분선은 언제나 `---`로 적는다 — 읽을 때는 ***·___도 받지만(mdToDoc) 쓸 때는 한 벌이다
    case 'horizontalRule':
      return ['---'];
    case 'paragraph':
    default:
      return [serializeParagraph(block.content)];
  }
}

// 이어진 번호 줄은 읽을 때 **한 목록**이 된다(mdToDoc — 첫 숫자가 start, 나머지는 차례).
// 그래서 적을 때도 그 차례로 적는다: 번호 목록 둘이 맞붙었거나(`1. 가` 뒤에 새 목록 `1. 나`)
// 중첩 번호가 펴졌을 때, 적힌 숫자와 다시 읽은 숫자가 달라 다음 저장에서 값이 바뀌었다.
const OL_LINE = /^(\s*)(\d+)([.)]\s+[\s\S]*)$/;
function renumberRuns(lines) {
  let prev = null;
  return lines.map(line => {
    const m = OL_LINE.exec(line);
    if (!m) { prev = null; return line; }
    // 첫 숫자는 읽는 쪽과 같은 셈이다(`Number(…) || 1` — 0은 1로 읽는다)
    const n = prev === null ? (Number(m[2]) || 1) : prev + 1;
    prev = n;
    return `${m[1]}${n}${m[3]}`;
  });
}

// ── TipTap doc JSON → 마크다운 문자열 ──────────────────────────────────────
// **빈 줄을 합치지 않는다**(2026-09-25). 예전에는 `\n{3,}`를 `\n\n`으로 접어서 빈 문단
// 둘·셋을 두고 저장하면 다시 열 때 하나였다 — 빈 문단 N개는 줄바꿈 N+1개이고 읽는 쪽
// (mdToDoc)은 이미 그대로 읽는다. 옛 글은 이미 접힌 채 저장돼 있어 읽는 모양이 그대로다.
// 끝은 **줄바꿈만** 걷는다(끝에 남은 빈 문단). 공백까지 걷으면 끝의 빈 항목 `- `가 `-`가
// 되어 다시 열면 글자 `-`였다.
export function docToMd(doc) {
  const blocks = doc?.content || [];
  const lines = [];
  for (const b of blocks) lines.push(...serializeBlock(b));
  return renumberRuns(lines.join('\n').split('\n')).join('\n').replace(/\n+$/, '');
}
