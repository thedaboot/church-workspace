// ============================================================================
// 뜻 검색 결과를 화면 줄로 — 순수 모듈(import 0 · 브라우저 API 없음 · tests/logcheck가 노드에서 본다)
// ----------------------------------------------------------------------------
// 두 자리가 쓴다(사용자 결정 2026-09-25 · 목업 remaining-mockup §3).
//   · 상단 전체 검색(G-a) — 글자 결과 아래 '관련된 업무 내용' 구역. match_docs(0074)의 조각을
//     업무 하나씩으로 묶어 최대 다섯 줄, 줄마다 어디에 걸렸는지 한 줄('댓글 · ' · '첨부 · ' · '상세 내용 · ').
//   · 성경 읽기 검색(S-a) — AI 검색이 실패·시간 초과일 때만 그 자리에 match_bible(0073)의 절을
//     같은 줄 모양으로. 머리는 '{검색어}와/과 관련된 성경 구절'(받침으로 가른다 — withAnd).
// 통신(질문 임베딩 · rpc)은 services/semantic.js가 한다. 여기는 모양만 바꾼다.
// ============================================================================

export const RELATED_LIMIT = 5;          // 구역에 세우는 줄 수(목업 · 최대 다섯)
export const RELATED_K = 12;             // match_docs에서 받는 조각 수 — 한 업무의 조각이 여럿 걸려도 다섯을 채우게
export const RELATED_MIN_CHARS = 2;      // 글자 결과와 같은 문턱(공백을 뺀 두 글자)
export const RELATED_DEBOUNCE_MS = 400;  // 치는 동안에는 묻지 않는다(한 글자마다 임베딩 한 번이 나가지 않게)
export const BIBLE_VEC_K = 30;           // 성경 대체 줄 수 — AI 검색의 상한(AI_HIT_LIMIT)과 같다

// 줄 아래 발췌 앞에 붙는 말 — 앱이 쓰는 낱말 그대로다(업무 창의 '댓글' · '첨부 파일' 구역 · '상세 내용')
export const RELATED_KIND_LABEL = { comment: '댓글', file: '첨부', card: '상세 내용' };

// 캐시·비교 열쇠 — 앞뒤 공백을 걷고 가운데 공백을 한 칸으로, NFC, 소문자
export const relatedKey = (q) => String(q || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
// 문턱은 공백을 뺀 길이로 잰다(글자 결과 SearchResults의 norm과 같다)
export const relatedReady = (q) => relatedKey(q).replace(/\s/g, '').length >= RELATED_MIN_CHARS;

// rpc 인자 — halfvec은 '[0.1,0.2,…]' 글자로 넘긴다(scripts/compare-bible-search.mjs와 같은 길)
export const vecParam = (vec) => `[${(vec || []).join(',')}]`;

// ── 와/과 ───────────────────────────────────────────────────────────────────
// 마지막 글자에 받침이 있으면 '과', 없으면 '와'(errorText.objectParticle의 을/를과 같은 셈 —
// 한글 음절 영역에서 (코드-0xAC00) % 28이 종성). 끝의 공백·문장부호·따옴표는 건너뛴다.
// 숫자는 읽는 소리로 가른다(1 일·3 삼·6 육·7 칠·8 팔·0 영 → 과). 영문 등 그 밖은 '와'.
const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
export function andParticle(word) {
  const s = String(word || '').replace(/[\s.,!?~'"”’)\]}…·:;-]+$/u, '');
  const last = s.slice(-1);
  if (!last) return '와';
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? '과' : '와';
  if (/[0-9]/.test(last)) return DIGIT_BATCHIM.has(last) ? '과' : '와';
  return '와';
}
export const withAnd = (word) => `${String(word || '').trim()}${andParticle(word)}`;

// ── 조각 → 발췌 한 줄 ─────────────────────────────────────────────────────────
// doc_vec.body의 모양은 api/_docsync.js buildDocs가 정한다:
//   card    '프로젝트명 / 업무 제목' \n 본문 조각        → 본문 조각
//   comment '업무 제목 · 댓글: 본문'                      → 본문
//   file    '업무 제목 · 첨부: 파일명' \n 발췌 조각       → '파일명 · 발췌'
// 머리줄의 업무 제목은 버린다 — 줄의 제목은 스토어의 지금 제목을 쓴다(이름을 고친 뒤에도 맞다).
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function docExcerpt(row) {
  const body = String(row?.body || '');
  const nl = body.indexOf('\n');
  const head = nl < 0 ? body : body.slice(0, nl);
  const rest = nl < 0 ? '' : oneLine(body.slice(nl + 1));
  if (row?.kind === 'comment') {
    const at = body.indexOf(' · 댓글: ');
    return oneLine(at < 0 ? body : body.slice(at + ' · 댓글: '.length));
  }
  if (row?.kind === 'file') {
    const at = head.indexOf(' · 첨부: ');
    const name = oneLine(at < 0 ? '' : head.slice(at + ' · 첨부: '.length));
    return [name, rest].filter(Boolean).join(' · ');
  }
  return rest;
}

// ── 조각들 → 업무 줄 ─────────────────────────────────────────────────────────
// rows는 match_docs의 결과(가까운 순)이고 card_id는 그 조각이 속한 업무다(댓글·첨부도 0074가 찾아 붙인다).
//   · 업무 하나에 한 줄 — 가장 가까운 조각의 자리를 쓴다. 그 조각의 발췌가 비었으면(본문 없는 업무의
//     머리줄만 걸린 경우) 같은 업무의 다음 조각 발췌를 빌린다.
//   · exclude — 위 글자 결과에 이미 선 업무 id(같은 업무를 두 번 세우지 않는다).
//   · tasksById에 없는 업무는 뺀다 — 열 수 없는 줄을 세우지 않는다(지워졌거나 아직 안 읽힌 업무).
export function relatedTasks(rows, { tasksById = {}, exclude = new Set(), limit = RELATED_LIMIT } = {}) {
  const get = (id) => (tasksById instanceof Map ? tasksById.get(id) : tasksById[id]);
  const out = [];
  const at = new Map();
  for (const r of rows || []) {
    const id = r?.card_id;
    if (!id || exclude.has(id)) continue;
    const task = get(id);
    if (!task) continue;
    const excerpt = docExcerpt(r);
    const kind = RELATED_KIND_LABEL[r.kind] ? r.kind : 'card';
    if (at.has(id)) {
      const cur = out[at.get(id)];
      if (!cur.excerpt && excerpt) Object.assign(cur, { kind, excerpt });
      continue;
    }
    if (out.length >= limit) continue;   // 이미 찼으면 새 업무는 안 받는다(빈 발췌 빌리기는 계속)
    at.set(id, out.length);
    out.push({ task, kind, excerpt, score: r.score ?? null });
  }
  return out;
}

// ── 성경 대체 줄 ─────────────────────────────────────────────────────────────
// match_bible의 행({ ref, book: 'gen', chapter, verse, body }) → AI 줄과 같은 모양
// { bookId, name, chapter, verse, to, text }. 모르는 책은 버리고, 같은 절은 한 번만.
export function bibleVecHits(rows, books = [], limit = BIBLE_VEC_K) {
  const name = new Map((books || []).map(b => [b.id, b.name]));
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (out.length >= limit) break;
    if (!name.has(r?.book) || !r.chapter || !r.verse) continue;
    const key = `${r.book} ${r.chapter}:${r.verse}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bookId: r.book, name: name.get(r.book), chapter: r.chapter, verse: r.verse, to: r.verse, text: String(r.body || '') });
  }
  return out;
}
