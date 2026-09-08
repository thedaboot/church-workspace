// ============================================================================
// 노트 템플릿 — 예배 노트 · QT 묵상이 빈 칸으로 시작하지 않게 (사용자 요청 2026-09-08)
// ----------------------------------------------------------------------------
// "기존 순 노트 템플릿 가져와서 최대한 우리 디자인 시스템에 맞춰 재구성하기".
// 원본은 옛 순 노트 앱(soon-frontend NoteDetail.tsx)이고 다섯 도막이었다 —
// 본문 · 말씀요약 · 묵상노트 · 결단하기 · 기도하기. 각 도막이 잎 아이콘이 붙은 제목과
// 늘어나는 textarea 한 칸이었다.
//
// **부품을 그대로 옮기지 않는다.** 우리 노트는 편집기 하나(MarkdownEditor)이고 저장
// 형식은 마크다운 문자열이라, 도막을 다섯 상자로 만들면 저장 자리도 다섯이 된다.
// 대신 **그 도막들을 H3 제목으로 심어 준다** — 편집기는 그대로 하나이고, 읽기 모드
// (RichText)·나눔 피드·AI 프롬프트가 전부 지금 쓰는 길 그대로다. 잎 표시는 화면에서만
// 붙인다(index.css의 `.note-template h3::before` 한 벌 — 편집기 감싸개와 읽기 상자에
// 같이 붙는 클래스라 두 모드에서 같은 모양이다).
//
// QT에는 '말씀 요약'이 없다. 그 칸은 설교를 듣고 적는 자리인데 QT는 혼자 본문을 읽는
// 자리라, 요약과 묵상이 같은 글이 된다.
//
// 순수 모듈이다 — 노드에서 그대로 검사한다(tests/word.mjs 1절).
// ============================================================================

const WORSHIP_SECTIONS = ['본문', '말씀 요약', '묵상 노트', '결단하기', '기도하기'];
const QT_SECTIONS = ['본문', '묵상 노트', '결단하기', '기도하기'];

// 제목 줄의 모양 — isTemplateOnly가 '사람이 쓴 글'과 가르는 기준이다.
// 두 템플릿의 제목을 다 받는다(예배 노트를 QT에 붙여 넣는 사람도 있다).
const SECTION_RE = new RegExp(`^###\\s+(?:${[...new Set([...WORSHIP_SECTIONS, ...QT_SECTIONS])].join('|')})$`);

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
