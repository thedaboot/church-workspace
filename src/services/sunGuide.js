import { supabase } from './supabaseClient.js';
import { guestStore } from './people.js';
import { AiService, isFallbackText } from './ai.js';
import { loadPassage } from './bible.js';
import { kindLabel, formatServiceDate } from './worship.js';

// ============================================================================
// 순모임 가이드 — 주보 한 건당 한 벌. AI가 템플릿의 **내용만** 채운다 (0039)
// ----------------------------------------------------------------------------
// 사용자 피드백 2026-09-02: "주보가 나오면 순모임을 진행할 수 있는 템플릿을 AI가
// 자동으로 만들어 볼 수 있게. 이미지를 생성하라는 게 아니고, 내가 준 템플릿처럼
// 만들어 두고 **내용만 AI가 글자수에 맞게** 채우는 것."
//
// 그래서 이 파일이 하는 일은 셋이다.
//   1. 주보(제목·구절·설교자)와 **개역한글 본문 텍스트**를 프롬프트에 싣는다.
//   2. 돌아온 글을 JSON으로 읽고 **모양과 글자수를 우리가 강제한다**(fitGuide).
//      모델에게 상한을 말해도 넘긴다 — 넘긴 글이 그대로 화면에 들어가면 카드 세 장의
//      비례가 무너진다. 자를 때는 문장 경계에서 자른다.
//   3. 저장·읽기(sun_guides, 게스트는 localStorage).
//
// **본문 구절 → 텍스트는 다시 만들지 않는다** — services/bible.js의 loadPassage와
// bibleRef.js 한 벌을 쓴다(주보·QT·성경 읽기가 같은 것을 쓴다).
//
// AI가 돌려준 문자열을 그대로 화면에 넣지 않는다(§6-43) — 실패하면 AiService는 안내
// 문구를 **문자열로** 돌려주므로 parseGuide가 isFallbackText로 먼저 걸러 null을 준다.
// 화면은 null을 받으면 토스트만 띄우고 쓰던 것을 지키면 된다.
// ============================================================================

// 본문(body)의 모양 — **화면·검사·모임 화면이 같이 쓰는 계약이다.** 여기 필드를
// 늘리려면 components/sunGuide.jsx와 tests/sunguide.mjs를 같이 고쳐야 한다.
//   { passage: { ref, title }, summary, points: [{ title, body } ×3], questions: [string ×3] }
//
// 글자수 상한은 사용자가 준 템플릿(세로 카드 3장)에서 그 자리가 실제로 담는 만큼이다.
// 소제목의 번호('1.')와 질문의 'Q.'는 **화면이 붙인다** — 글에 넣으면 모델이 번호를
// 어긋나게 매기고, 상한도 번호가 잡아먹는다.
export const LIMITS = { summary: 380, pointTitle: 24, pointBody: 260, question: 80 };
export const POINTS = 3;
export const QUESTIONS = 3;

const str = (v) => String(v ?? '').trim();

// 문장이 끝나는 자리 — '다.' '요.' '. '(마침표+공백/끝) '?' '!'.
const SENT = /다\.|요\.|\.(?=\s|$)|[?!]/g;

// 짝이 맞지 않는 굵게 마커를 뗀다. 자른 자리가 `**…**` 안이면 여는 마커만 남아서
// 화면에 별 두 개가 글자로 보인다(직접 파싱하므로 HTML로 새지는 않는다).
function dropUnpairedBold(s) {
  if (((s.match(/\*\*/g) || []).length) % 2 === 0) return s;
  const at = s.lastIndexOf('**');
  return `${s.slice(0, at)}${s.slice(at + 2)}`;
}

// 상한에 맞춰 자른다. **단어 중간에서 끊지 않는다** — 문장 경계가 있으면 거기서,
// 없으면 마지막 공백에서, 그것도 없으면(한 문장이 상한보다 긴 한글 글) 상한에서.
export function fitText(text, limit) {
  const s = str(text);
  if (s.length <= limit) return s;
  const head = s.slice(0, limit);
  let cut = -1;
  SENT.lastIndex = 0;
  let m;
  while ((m = SENT.exec(head))) cut = m.index + m[0].length;
  if (cut <= 0) {
    const sp = head.lastIndexOf(' ');
    cut = sp > 0 ? sp : limit;
  }
  return dropUnpairedBold(head.slice(0, cut).trim()).trim();
}

// 모양과 글자수를 강제한다. **배열은 언제나 셋**이다 — 모자라면 빈 칸으로 채우고
// 넘치면 버린다. 화면이 `points[2]`를 그대로 그리기 때문에 여기서 길이를 못 박는다.
export function fitGuide(body) {
  const b = body && typeof body === 'object' ? body : {};
  const p = b.passage && typeof b.passage === 'object' ? b.passage : {};
  const points = Array.isArray(b.points) ? b.points : [];
  const questions = Array.isArray(b.questions) ? b.questions : [];
  return {
    passage: { ref: str(p.ref), title: str(p.title) },
    summary: fitText(b.summary, LIMITS.summary),
    points: Array.from({ length: POINTS }, (_, i) => ({
      title: fitText(points[i]?.title, LIMITS.pointTitle),
      body: fitText(points[i]?.body, LIMITS.pointBody),
    })),
    questions: Array.from({ length: QUESTIONS }, (_, i) => fitText(questions[i], LIMITS.question)),
  };
}

// 이게 가이드 본문인가. 저장된 `{}`(0039의 기본값)와 모델의 엉뚱한 답을 같은 자리에서
// 걸러 낸다 — 화면은 "가이드가 없다"와 "가이드가 깨졌다"를 구분할 필요가 없다.
export function isGuideShape(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (typeof v.summary !== 'string' || !v.summary.trim()) return false;
  if (!v.passage || typeof v.passage !== 'object' || typeof v.passage.ref !== 'string') return false;
  const every = (a, f) => Array.isArray(a) && a.length > 0 && a.every(f);
  if (!every(v.points, (x) => x && typeof x.title === 'string' && typeof x.body === 'string')) return false;
  return every(v.questions, (x) => typeof x === 'string');
}

// '**…**'를 <strong>으로 가르기 위한 조각들 — [{ bold, text }].
// **HTML을 만들지 않는다**(dangerouslySetInnerHTML 금지) — 모델이 돌려준 글에 태그가
// 섞여 있어도 글자로만 보인다.
export function splitBold(text) {
  const s = String(text ?? '');
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ bold: false, text: s.slice(last, m.index) });
    out.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ bold: false, text: s.slice(last) });
  return out;
}

// 템플릿 머리의 날짜 — '2026-03-01' → '26년 3월 1일'(사용자가 준 템플릿 그대로).
// 문자열을 그대로 쪼갠다 — new Date('2026-03-01')은 UTC 자정이라 하루가 밀린다.
export function guideDateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[1].slice(2)}년 ${+m[2]}월 ${+m[3]}일` : '';
}

// ── 프롬프트 ────────────────────────────────────────────────────────────────

// 본문을 몇 절까지 싣나. 시편 119편 같은 장 전체가 오면 프롬프트가 통째로 커진다.
export const VERSE_LIMIT = 60;

// 절들을 '절번호 본문' 줄로. 장을 건너는 범위(여호수아 3:14-4:24)에서는 절 번호만으로
// 어느 장인지 알 수 없으므로 '장:절'로 적는다.
export function passageLines(verses = [], limit = VERSE_LIMIT) {
  const all = Array.isArray(verses) ? verses : [];
  const crossing = all.length > 1 && all[0].chapter !== all[all.length - 1].chapter;
  const lines = all.slice(0, limit)
    .map((v) => `${crossing ? `${v.chapter}:${v.verse}` : v.verse} ${v.text}`);
  if (all.length > limit) lines.push(`(본문이 길어 앞 ${limit}절만 실었습니다)`);
  return lines.join('\n');
}

// 문구 톤은 §8이 사람에게 요구하는 것을 그대로 요구한다(ai.js의 TONE_RULES와 같은 정신).
// 가이드는 순장들이 그대로 읽어 진행하는 글이라 더 좁다 — **순원 누구를 지목하거나
// 견주는 구조가 되면 안 된다**(docs/V2.md §1 '지키는 원칙').
const GUIDE_SYSTEM = [
  '너는 청년부 순모임 가이드의 초안을 쓴다. 주일 설교 본문을 순원들이 함께 읽고 나눌 수 있게 정리한다.',
  '',
  '- **지어내지 마라.** 아래 실린 본문과 설교 제목 안에서만 쓴다. 본문에 없는 사건·인물·인용을 만들지 마라.',
  '- 존댓말 설명체로 쓴다("~합니다" · "~입니다").',
  '- 문구 톤: 담백하게, 본문이 말하는 것을 그대로 말해라. 번역투를 쓰지 마라.',
  '  · **누가 누구와 견주는 표현을 절대 쓰지 마라.** 이 글은 순원들이 둘러앉아 같이 읽는다.',
  '  · 읽는 사람을 판단하거나 지목하는 말(부족하다, 못하고 있다, 반성해야 한다)을 쓰지 마라.',
  '  · "없어요"로 끝나는 짧은 부정 표현을 피해라.',
  '  · "핵심"이라는 단어는 절대 쓰지 마라.',
  '  · 문장 안에서 엠 대시(—)나 엔 대시(–)는 절대 쓰지 마라. 필요하면 일반 하이픈(-)을 써라.',
  '- 강조할 성경 구절은 **이렇게** 별 두 개로 감싼다. 그 밖의 마크다운(제목·목록·표)은 쓰지 마라.',
  '- **답은 JSON 하나만 낸다.** 코드펜스·머리말·설명을 붙이지 마라.',
].join('\n');

// 주보 한 건 → { prompt, system }. 본문 텍스트는 부르는 쪽이 넘긴다(generateGuide가
// bible.js로 받아 온다) — 그래야 이 함수가 네트워크 없이 검사된다.
export function buildGuidePrompt({ service, passageText = '' } = {}) {
  const s = service || {};
  const prompt = [
    '[주보]',
    `예배: ${kindLabel(s.kind)} · ${formatServiceDate(s.service_date)}`,
    `설교 제목: ${str(s.title) || '(아직 없음)'}`,
    `본문 구절: ${str(s.passage_ref) || '(아직 없음)'}`,
    `설교자: ${str(s.preacher) || '(아직 없음)'}`,
    '',
    '[본문 (개역한글)]',
    passageText || '(본문 텍스트를 받지 못했습니다. 위 구절만 보고 쓰되, 본문에 없는 내용을 지어내지 마라.)',
    '',
    '[만들 것 — 아래 모양의 JSON 하나]',
    '{',
    '  "passage": { "ref": "본문 구절을 그대로", "title": "본문을 한 마디로 (12자 이내)" },',
    `  "summary": "본문의 배경과 흐름을 한 단락으로 (${LIMITS.summary}자 이내)",`,
    '  "points": [',
    `    { "title": "소제목 (${LIMITS.pointTitle}자 이내, 번호는 붙이지 마라)", "body": "그 대목의 설명 (${LIMITS.pointBody}자 이내)" },`,
    '    { "title": "…", "body": "…" },',
    '    { "title": "…", "body": "…" }',
    '  ],',
    '  "questions": [',
    `    "지난 한 주 일상을 나누는 질문 (${LIMITS.question}자 이내)",`,
    `    "본문을 자기 삶에 적용하는 질문 (${LIMITS.question}자 이내)",`,
    `    "본문을 자기 삶에 적용하는 질문 (${LIMITS.question}자 이내)"`,
    '  ]',
    '}',
    '',
    `- points는 반드시 ${POINTS}개이고 본문의 흐름을 차례로 따라간다.`,
    `- questions는 반드시 ${QUESTIONS}개이고, **첫 질문은 본문 이야기가 아니라 지난 한 주 일상을 나누는 질문**이다.`,
    '- 질문 앞에 "Q."를 붙이지 마라. 소제목 앞에 번호를 붙이지 마라. 화면이 붙인다.',
    '- 글자수 상한을 넘기지 마라. 넘기면 문장이 잘려 나간다.',
    '- 각 body에서 인용하는 성경 구절은 **별 두 개**로 감싼다.',
  ].join('\n');
  return { prompt, system: GUIDE_SYSTEM };
}

// 모델의 답 → 본문. 코드펜스·앞뒤 잡문은 첫 '{'와 마지막 '}' 사이만 남겨 지운다.
// 모양이 아니면 null이다 — 부르는 쪽은 토스트만 띄우면 된다.
export function parseGuide(text) {
  const s = String(text ?? '');
  if (!s.trim() || isFallbackText(s)) return null;
  const open = s.indexOf('{');
  const close = s.lastIndexOf('}');
  if (open < 0 || close <= open) return null;
  let parsed;
  try { parsed = JSON.parse(s.slice(open, close + 1)); } catch { return null; }
  return isGuideShape(parsed) ? fitGuide(parsed) : null;
}

// 주보 한 건으로 초안 만들기. 실패(게스트·로그인 없음·모양 깨짐)는 **null**이다.
// 본문을 못 읽어도 멈추지 않는다 — 구절만 싣고 만든다(주보에 구절이 아직 없을 수 있다).
export async function generateGuide(service) {
  if (!service) return null;
  let passageText = '';
  if (service.passage_ref) {
    try {
      const loaded = await loadPassage(service.passage_ref);
      if (loaded?.verses?.length) passageText = passageLines(loaded.verses);
    } catch (e) {
      console.error('[sunGuide] 본문을 읽지 못했어요:', e);
    }
  }
  const { prompt, system } = buildGuidePrompt({ service, passageText });
  const body = parseGuide(await AiService.callGemini(prompt, system));
  if (!body) return null;
  // 구절은 주보가 진실이다 — 모델이 옮겨 적다가 틀리면 화면의 '주일 본문'이 주보와
  // 어긋난다(순장이 그걸 읽어 준다).
  if (service.passage_ref) body.passage.ref = String(service.passage_ref);
  return body;
}

// ── 저장 (sun_guides · 게스트는 localStorage) ───────────────────────────────
// 게스트 키는 서비스마다 따로다(people.guestStore 주석) — 여기도 자기 키 한 벌이다.
const GUEST_TABLE = 'sun_guides';
const { rows: guestRows, set: guestSet } = guestStore('church_sunguide_v1');

export async function loadGuide(serviceId) {
  if (!serviceId) return null;
  if (!supabase) {
    const row = guestRows(GUEST_TABLE).find((r) => r.service_id === serviceId);
    return isGuideShape(row?.body) ? fitGuide(row.body) : null;
  }
  // 볼 자격이 없으면 error가 아니라 **행이 없다**(0039의 select 정책) — 화면은
  // '가이드 없음'과 같이 다룬다.
  const { data, error } = await supabase.from('sun_guides')
    .select('service_id, body, updated_at').eq('service_id', serviceId).maybeSingle();
  if (error) throw error;
  return isGuideShape(data?.body) ? fitGuide(data.body) : null;
}

export async function saveGuide(serviceId, body) {
  const fitted = fitGuide(body);
  if (!serviceId) return fitted;
  if (!supabase) {
    const rest = guestRows(GUEST_TABLE).filter((r) => r.service_id !== serviceId);
    guestSet(GUEST_TABLE, [...rest, { service_id: serviceId, body: fitted, updated_at: new Date().toISOString() }]);
    return fitted;
  }
  // created_by는 payload에 넣지 않는다 — 0039가 auth.uid()를 기본값으로 두었고,
  // 다른 사람이 다시 만들어 저장할 때 처음 만든 사람이 지워지면 안 된다.
  const { error } = await supabase.from('sun_guides')
    .upsert({ service_id: serviceId, body: fitted, updated_at: new Date().toISOString() },
      { onConflict: 'service_id' });
  if (error) throw error;
  return fitted;
}
