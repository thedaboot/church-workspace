import { parseRef, versesInRef } from './bibleRef.js';
import { DASH_RULE } from './ai.js';

// ============================================================================
// 뜻으로 찾는 본문 검색 — 낱말이 아니라 **의미**로 구절을 고른다
// ----------------------------------------------------------------------------
// 사용자 요청 2026-09-08 — "본문 검색에 AI를 넣어 시멘틱 서치가 가능하도록".
// 지금 검색은 66권을 훑어 `includes(질문)`으로 맞히므로 '불안할 때'처럼 본문에 그
// 낱말이 없는 물음에는 한 줄도 못 내놓는다.
//
// **임베딩·벡터 색인을 만들지 않는다.** 개역한글 전문은 4.5MB이고 절이 31,102개다 —
// 그걸 벡터로 만들려면 표 하나(pgvector) · 마이그레이션 · 색인을 채우는 배치가 붙고,
// 게스트 모드에서는 아예 안 돈다. 제미나이는 성경을 이미 알고 있으므로 **구절 참조만**
// 받아 오고, 본문은 우리 데이터(public/bible/*.json)에서 읽어 붙인다. 그래서
//   · 지어낸 참조는 파서(bibleRef)에서 걸러지고,
//   · 화면에 뜨는 글자는 언제나 우리가 가진 개역한글 본문이다(모델이 절을 잘못 외워도
//     그 글이 화면에 나가지 않는다).
//
// 이 파일은 순수하다(브라우저 API를 쓰지 않는다) — 프롬프트·파싱·해석을 노드에서
// 그대로 검사한다(tests/word.mjs 1절). 부르는 쪽만 AiService.callGemini를 잇는다.
// ============================================================================

export const AI_HIT_LIMIT = 12;      // 화면에 세우는 최대 줄 수(스펙)
const RANGE_MAX = 3;                 // 한 줄이 품을 수 있는 절 수 — 넘으면 앞에서 자른다
const WHY_MAX = 40;                  // '왜 이 구절인지' 한 줄의 글자 상한

// 질문 하나 → 제미나이에게 보낼 { prompt, system }.
// books는 public/bible/index.json이다 — **책 이름을 프롬프트에 실어 준다.** 안 실으면
// 모델이 '요한복음'과 '요한 복음', '시편 23편'과 'Psalm 23'을 섞어 쓰고 그때마다
// parseRef가 못 읽는다. 우리가 아는 이름만 쓰라고 못 박는 쪽이 싸다.
export function buildBibleSearchPrompt(query, books = []) {
  const names = (books || []).map(b => b?.name).filter(Boolean).join(' · ');
  const system = [
    '너는 개역한글 성경을 잘 아는 도우미다. 사람이 던진 물음의 **뜻**에 맞는 구절을 골라 준다.',
    '- 답은 JSON 배열 하나만 내라. 설명·머리말·코드 표시를 붙이지 마라.',
    `- 배열의 길이는 최대 ${AI_HIT_LIMIT}이다. 맞는 구절이 적으면 적게 내라. 하나도 없으면 []만 내라.`,
    '- 각 항목은 {"ref":"요한복음 3:16","why":"한 문장"} 모양이다.',
    '- ref는 **한 절**이거나 아주 짧은 범위(최대 3절)다. 장 전체를 가리키지 마라.',
    '- 책 이름은 아래 목록에 있는 이름을 **글자 그대로** 써라. 약칭·영어·다른 표기를 쓰지 마라.',
    `- why는 이 구절이 물음과 어떻게 이어지는지 ${WHY_MAX}자 이내로 적는다.`,
    '- 성경에 없는 구절을 지어내지 마라. 확실한 것만 내라.',
    DASH_RULE,
    '',
    `[쓸 수 있는 책 이름]\n${names}`,
  ].join('\n');
  const prompt = [
    '아래 물음의 뜻에 맞는 개역한글 성경 구절을 골라 줘.',
    '',
    `물음: ${String(query || '').trim()}`,
  ].join('\n');
  return { prompt, system };
}

// 모델이 돌려준 글 → [{ ref, why }]. **못 읽으면 빈 배열이다**(안전한 실패).
// 코드 울타리(```json …```)와 앞뒤에 붙은 잡담을 견딘다 — 시스템 지시로 막아 두었지만
// 한 번이라도 어기면 화면이 통째로 비므로, 첫 '['부터 마지막 ']'까지만 떼어 읽는다.
export function parseBibleSearchJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const from = s.indexOf('[');
  const to = s.lastIndexOf(']');
  if (from < 0 || to < from) return [];
  let arr = null;
  try { arr = JSON.parse(s.slice(from, to + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(x => ({ ref: String(x?.ref || '').trim(), why: String(x?.why || '').trim() }))
    .filter(x => x.ref);
}

// [{ ref, why }] → 화면에 세울 줄 [{ bookId, name, chapter, verse, to, text, why }].
// loadBook(id)은 services/bible.js의 것을 그대로 받는다(검사에서는 파일을 읽는 가짜).
//
// 규칙은 셋이다:
//   ① 못 읽는 참조·모르는 책은 **버린다**(지어낸 참조가 여기서 걸린다),
//   ② 같은 절을 두 번 내면 앞의 것만 남긴다(모델이 자주 겹쳐 낸다),
//   ③ 온 순서를 지킨다 — 모델이 관련도 순으로 내놓았다고 보고 우리가 다시 세우지 않는다.
export async function resolveBibleHits(hits, books, loadBook) {
  const out = [];
  const seen = new Set();
  for (const h of hits || []) {
    if (out.length >= AI_HIT_LIMIT) break;
    const ref = parseRef(h.ref, books);
    if (!ref) continue;
    const book = (books || []).find(b => b.id === ref.bookId);
    if (!book) continue;
    let data = null;
    try { data = await loadBook(ref.bookId); } catch { continue; }
    // 장 전체를 가리키는 참조가 와도 앞 세 절만 쓴다 — 결과 줄은 '읽을 한 조각'이다
    const verses = versesInRef(data, ref).slice(0, RANGE_MAX);
    if (!verses.length) continue;
    const key = `${ref.bookId} ${verses[0].chapter}:${verses[0].verse}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const last = verses[verses.length - 1];
    out.push({
      bookId: ref.bookId,
      name: book.name,
      chapter: verses[0].chapter,
      verse: verses[0].verse,
      to: last.verse,
      // 여러 절이면 이어 붙인다 — 화면은 한 줄로 그리고 넘치면 자른다
      text: verses.map(v => v.text).join(' '),
      why: String(h.why || '').slice(0, WHY_MAX),
    });
  }
  return out;
}

// 줄 하나의 라벨 — '요한복음 3:16' 또는 '요한복음 3:16-18'
export function hitLabel(hit) {
  if (!hit) return '';
  return hit.to > hit.verse
    ? `${hit.name} ${hit.chapter}:${hit.verse}-${hit.to}`
    : `${hit.name} ${hit.chapter}:${hit.verse}`;
}

// ── 같은 물음은 한 번만 묻는다 ──────────────────────────────────────────────
// 탭이 살아 있는 동안만 남는 메모리 캐시다(ai.js의 요약 캐시와 같은 결). localStorage에
// 남기지 않는 이유: 값이 모델 답이라 언제든 달라져도 되는 것이고, 캐시 열쇠의 접두가
// 다른 키를 삼키는 자리를 하나 더 만들 이유가 없다(§6-24-f).
const memo = new Map();
const normalize = (q) => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();

// 물음 하나를 끝까지 — call(prompt, system)은 부르는 쪽이 AiService.callGemini로 잇는다.
// 실패·빈 답·안내 문구는 전부 빈 배열이다(화면은 그때 그 칸을 통째로 감춘다).
export async function aiBibleSearch(query, books, loadBook, call) {
  const key = normalize(query);
  if (!key) return [];
  if (memo.has(key)) return memo.get(key);
  const { prompt, system } = buildBibleSearchPrompt(query, books);
  let text = '';
  try { text = await call(prompt, system); } catch { return []; }
  const hits = await resolveBibleHits(parseBibleSearchJson(text), books, loadBook);
  // 빈 답은 캐시하지 않는다 — 로그인·배포가 안 되어 안내 문구가 온 것일 수 있고,
  // 그러면 그 물음은 이 탭에서 영영 빈 칸이 된다(ai.js가 안내 문구를 캐시하지 않는 것과 같다)
  if (hits.length) memo.set(key, hits);
  return hits;
}
