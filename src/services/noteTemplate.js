// ============================================================================
// 노트 템플릿 — 예배 노트 · QT 묵상이 빈 칸으로 시작하지 않게 (사용자 요청 2026-09-08)
// ----------------------------------------------------------------------------
// "기존 순 노트 템플릿 가져와서 최대한 우리 디자인 시스템에 맞춰 재구성하기".
// 원본은 옛 순 노트 앱(soon-frontend NoteDetail.tsx)이고 다섯 도막이었다 —
// 본문 · 말씀요약 · 묵상노트 · 결단하기 · 기도하기. 각 도막이 잎 아이콘이 붙은 제목과
// 늘어나는 textarea 한 칸이었다.
//
// 도막 이름은 2026-09-09에 사용자가 다듬었다 — '묵상 노트' → **나의 묵상**,
// '결단하기' → **결단**, '기도하기' → **기도**. 이건 **기본값일 뿐이고** 편집기 안의
// 보통 글이라 쓰는 사람이 제목을 지우거나 바꿔도 된다. 다만 옛 이름으로 저장된 노트가
// 이미 있으므로 isTemplateOnly는 **옛 이름도 같이 받는다**(LEGACY_SECTIONS) — 안 받으면
// 그 노트들이 어느 날 갑자기 '사람이 쓴 글'로 바뀌어 나눔 피드·잔디에 오른다.
//
// **부품을 그대로 옮기지 않는다.** 우리 노트는 편집기 하나(MarkdownEditor)이고 저장
// 형식은 마크다운 문자열이라, 도막을 다섯 상자로 만들면 저장 자리도 다섯이 된다.
// 대신 **그 도막들을 H3 제목으로 심어 준다** — 편집기는 그대로 하나이고, 읽기 모드
// (RichText)·나눔 피드·AI 프롬프트가 전부 지금 쓰는 길 그대로다. 도막 제목 앞의 잎
// 표시는 2026-09-09에 사용자가 뺐다(§7) — index.css `.note-template h3`에 남은 것은
// 도막 사이 간격뿐이다.
//
// QT에는 '말씀 요약'이 없다. 그 칸은 설교를 듣고 적는 자리인데 QT는 혼자 본문을 읽는
// 자리라, 요약과 묵상이 같은 글이 된다.
//
// 순수 모듈이다 — 노드에서 그대로 검사한다(tests/word.mjs 1절).
// ============================================================================

export const WORSHIP_SECTIONS = ['본문', '말씀 요약', '나의 묵상', '결단', '기도'];
export const QT_SECTIONS = ['본문', '나의 묵상', '결단', '기도'];

// 2026-09-09 이전에 저장된 노트의 제목들. 새 템플릿에는 안 쓰고 판정에만 쓴다.
const LEGACY_SECTIONS = ['묵상 노트', '결단하기', '기도하기'];

// 제목 줄의 모양 — isTemplateOnly가 '사람이 쓴 글'과 가르는 기준이다.
// 두 템플릿의 제목을 다 받는다(예배 노트를 QT에 붙여 넣는 사람도 있다). '결단'과
// '결단하기'처럼 하나가 다른 하나의 앞부분이어도 뒤의 `$`가 있어 정확히 한 줄만 맞는다.
// **제목 단계(#~####)는 가리지 않는다**(2026-09-09 사용자 지적 — "## H2로 작성하면 아예
// 반영이 안되고 H3로만 옆에 제목으로 들어가더라고?"). 서식 바로 단계를 바꾸면 `##`나
// `#`이 되는데, `###`만 받으면 그 노트가 갑자기 '사람이 쓴 글'이 되어 나눔 피드·잔디에
// 오르고 종이에서도 도막이 갈리지 않았다.
const SECTION_RE = new RegExp(
  `^#{1,4}\\s+(?:${[...new Set([...WORSHIP_SECTIONS, ...QT_SECTIONS, ...LEGACY_SECTIONS])].join('|')})$`);

// 제목 + 그 아래 한 줄. 아래 줄을 비워 두는 이유는 **커서가 제목 밑에 떨어지게**
// 하기 위해서다 — 제목 바로 다음에 다음 제목이 오면 그 사이에 글을 쓰려고 엔터를
// 먼저 쳐야 한다.
function build(sections, passageRef) {
  const ref = String(passageRef || '').trim();
  const lines = [];
  for (const title of sections) {
    lines.push(`### ${title}`);
    lines.push(title === '본문' ? ref : '');
  }
  return lines.join('\n');
}

// 예배 노트 — 다섯 도막(원본 그대로)
export function worshipNoteTemplate({ passageRef = '' } = {}) {
  return build(WORSHIP_SECTIONS, passageRef);
}

// QT 묵상 — 네 도막('말씀 요약'이 빠진다)
export function qtNoteTemplate({ passageRef = '' } = {}) {
  return build(QT_SECTIONS, passageRef);
}

// **손대지 않은 템플릿은 빈 노트다.** 이게 없으면 화면에 글자가 있다는 이유로 저장이
// 열리고, 아무도 쓰지 않은 제목 다섯 줄이 노트로 저장되어 나눔 피드에까지 오른다.
// prefill은 '본문' 아래에 미리 넣어 둔 구절이다 — 그 줄도 사람이 쓴 글이 아니다.
//
// 제목·빈 줄·구절 줄만 남아 있으면 참이다. 편집기를 한 바퀴 돈 뒤에는 끝의 빈 줄이
// 정리되므로(services/markdown.js docToMd) **줄 단위로 보고 빈 줄은 세지 않는다**.
// 옛 제목(LEGACY_SECTIONS)도 같이 받는다 — 이름을 바꾸기 전에 저장된 빈 노트가 있다.
export function isTemplateOnly(md, prefill = '') {
  const ref = String(prefill || '').trim();
  return String(md || '')
    .split('\n')
    .map(l => l.trim())
    .every(l => !l || SECTION_RE.test(l) || (!!ref && l === ref));
}

// 저장된 글이 없는 자리에 템플릿을 세운다 — 부르는 쪽이 매번 같은 판단을 하지 않게.
export function bodyOrTemplate(body, template) {
  return String(body || '').trim() ? body : template;
}

// ── 종이가 읽는 모양 (2026-09-09) ───────────────────────────────────────────
// 저장된 마크다운 → 도막 배열 `[{ title, body }]`. 종이(components/paper.jsx)가
// 왼쪽 라벨·오른쪽 글 두 칸으로 그리려면 도막이 갈려 있어야 한다.
//
// **아는 제목만 받지 않고 제목 단계도 가리지 않는다.** 도막 이름은 편집기 안의 보통
// 글이라 사람이 지우거나 바꿀 수 있고 서식 바로 단계를 바꿀 수도 있다 — `#`~`####`로
// 시작하는 줄이면 전부 도막의 머리로 본다(사용자 지적 2026-09-09). 그래야 제목을 고쳐
// 쓴 노트가 종이에서 통째로 한 덩이가 되지 않는다.
// 첫 제목보다 앞에 있는 글은 라벨이 없는 도막 하나로 앞에 선다(제목을 다 지운 노트).
// 빈 도막은 버린다 — 종이에 라벨만 남은 빈 줄이 생기면 구멍으로 보인다.
export function splitNoteSections(md) {
  const out = [];
  let cur = { title: '', lines: [] };
  for (const raw of String(md || '').split('\n')) {
    const head = /^#{1,4}\s+(.*)$/.exec(raw.trim());
    if (head) {
      out.push(cur);
      cur = { title: head[1].trim(), lines: [] };
    } else {
      cur.lines.push(raw);
    }
  }
  out.push(cur);
  return out
    .map(s => ({ title: s.title, body: s.lines.join('\n').trim() }))
    .filter(s => !!s.body);
}

// ── 도막 제목은 지워지지 않는다 (2026-09-09 사용자 결정) ────────────────────
// "본문, 말씀 요약, 나의 묵상, 결단, 기도 는 아예 지울 수 없게 고정을 해주는 게 좋을 것
// 같아" — 그리고 다시: "중제목들 안 지워지게 해달라니까". 처음에는 '#~####를 다 받는'
// 쪽으로 갔는데 그건 **다른 요구**였다(그건 그대로 두었다 — 서식 바로 단계를 바꿔도
// 도막이 갈린다).
//
// **저장할 때 되살린다.** 편집기(TipTap) 안에서 지우는 손을 막는 길도 있지만, 그쪽은
// 트랜잭션마다 끼어들어야 해서 붙여넣기·되돌리기와 부딪힌다. 저장되는 글이 곧 종이이고
// 나눔 피드이므로, **저장 자리 하나**에서 모양을 보장하는 쪽이 확실하고 검사도 된다.
//
// 잃는 것이 없어야 한다:
//   · 아는 도막은 **그 순서대로** 세우고 각자의 글을 그대로 얹는다
//   · 첫 제목보다 앞에 있던 글(제목을 다 지운 경우)은 맨 위에 그대로 남긴다
//   · 사람이 새로 만든 도막(아는 이름이 아닌 것)은 **뒤에 붙인다** — 지우지 않는다
export function ensureNoteSections(md, sections = WORSHIP_SECTIONS) {
  const parsed = splitNoteSections(md);
  const want = sections || [];
  const byTitle = new Map();
  const extra = [];
  let lead = '';
  for (const sec of parsed) {
    if (!sec.title) { lead = lead ? `${lead}\n${sec.body}` : sec.body; continue; }
    if (want.includes(sec.title) && !byTitle.has(sec.title)) byTitle.set(sec.title, sec.body);
    else extra.push(sec);
  }
  const lines = [];
  if (lead.trim()) lines.push(lead.trim(), '');
  for (const title of want) {
    lines.push(`### ${title}`);
    lines.push(byTitle.get(title) || '');
  }
  for (const sec of extra) {
    lines.push(`### ${sec.title}`);
    lines.push(sec.body || '');
  }
  return lines.join('\n');
}
