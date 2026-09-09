import { supabase } from './supabaseClient.js';
import { guestStore } from './people.js';
import { AiService, isFallbackText } from './ai.js';
import { loadPassage } from './bible.js';
import { kindLabel, formatServiceDate, SUNDAY_KIND } from './worship.js';

// ============================================================================
// 순모임 가이드 — 주보 한 건당 한 벌. AI가 템플릿의 **내용만** 채운다 (0039 · 0055)
// ----------------------------------------------------------------------------
// 사용자 피드백 2026-09-02: "주보가 나오면 순모임을 진행할 수 있는 템플릿을 AI가
// 자동으로 만들어 볼 수 있게. 이미지를 생성하라는 게 아니고, 내가 준 템플릿처럼
// 만들어 두고 **내용만 AI가 글자수에 맞게** 채우는 것."
//
// 사용자 스펙 2026-09-08(화면을 다시 켜면서): "이 템플릿 그대로 나오되, 어떤 주보를
// 기준으로 만들건지 마스터 or 관리자 or 리더 순장 or 순장들이 선택하게 하고 …
// 만들어지면 마스터는 그 요약 고정 기능처럼 고정을 할 수 있게 해서, 해당 가이드만 볼
// 수 있게끔(캐싱 구조). 만든 가이드를 이미지로 저장도 할 수 있게, 로고도 잘 포함될 수
// 있도록."
//
// 그래서 이 파일이 하는 일은 넷이다.
//   1. 주보(제목·구절·설교자)와 **개역한글 본문 텍스트**를 프롬프트에 싣는다.
//   2. 돌아온 글을 JSON으로 읽고 **모양과 글자수를 우리가 강제한다**(fitGuide).
//      모델에게 상한을 말해도 넘긴다 — 넘긴 글이 그대로 종이에 들어가면 비례가 무너진다.
//      자를 때는 문장 경계에서 자른다.
//   3. 저장·읽기(sun_guides, 게스트는 localStorage).
//   4. 고정(0055) — 마스터가 한 벌을 골라 두면 모두가 그 한 벌을 기본으로 연다.
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
//   { passage: { ref, title }, summaryRef?, summary?, points: [{ title, body } ×3],
//     questions: [string ×3~4], questionNote? }
//
// `passage.title`은 **모델이 짓는 말이 아니라 주보의 설교 제목이다**(사용자 지시
// 2026-09-09 — "'본문 한 마디'가 아니라 설교 제목으로"). `passage.ref`가 이미 그랬듯
// 주보가 진실이다: 프롬프트는 이 칸을 아예 묻지 않고 generateGuide가 `service.title`로
// 채운다. 주보에 제목이 없으면 빈 글이고, 화면은 빈 글이면 대괄호를 그리지 않는다.
// **지난 가이드는 그때 지어진 말을 그대로 들고 있다**(마이그레이션 없음) — 그 글도
// 그대로 열려야 하므로 여기서 지우지 않는다.
//
// `summary`·`summaryRef`는 **선택 필드**다. 2026-09-08 템플릿에는 줄글 요약 단락이
// 아예 없다 — '말씀 요약'은 번호가 붙은 소제목 셋(points)으로만 이루어진다. 그래서
// 프롬프트는 이 둘을 더 이상 묻지 않는다. 다만 **지난 가이드는 그 단락을 들고 있으므로**
// 모양 검증에서 빼고, 화면은 값이 있을 때만 그린다(없는 필드를 이유로 옛 가이드가
// 안 열리면 안 된다).
//
// `questionNote`는 마지막 질문에 곁들이는 한 줄이다(템플릿의 작은 괄호 줄 —
// '(EX. 고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기!)').
// 괄호와 'EX.'는 **화면이 붙인다** — 소제목의 번호·질문의 'Q.'와 같은 이유다.
export const SUN_GUIDE_ON = true;

export const LIMITS = {
  summaryRef: 30, summary: 380, pointTitle: 24, pointBody: 260, question: 80, questionNote: 80,
};
export const POINTS = 3;
// 질문은 셋 또는 넷이다 — 프롬프트는 넷을 시키고(첫 질문은 지난 한 주 일상),
// 셋뿐인 지난 가이드도 그대로 열린다.
export const QUESTIONS_MIN = 3;
export const QUESTIONS_MAX = 4;

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

// 모양과 글자수를 강제한다. **points는 언제나 셋**이다 — 모자라면 빈 칸으로 채우고
// 넘치면 버린다(화면이 `points[2]`를 그대로 그린다). questions는 셋~넷 사이로 재운다:
// 넷째까지는 살리고 다섯째부터 버리며, 셋에 못 미치면 빈 칸으로 채운다.
export function fitGuide(body) {
  const b = body && typeof body === 'object' ? body : {};
  const p = b.passage && typeof b.passage === 'object' ? b.passage : {};
  const points = Array.isArray(b.points) ? b.points : [];
  const questions = (Array.isArray(b.questions) ? b.questions : [])
    .slice(0, QUESTIONS_MAX).map((q) => fitText(q, LIMITS.question));
  while (questions.length < QUESTIONS_MIN) questions.push('');
  return {
    passage: { ref: str(p.ref), title: str(p.title) },
    // 없으면 빈 글이다 — 화면은 빈 글이면 그 줄을 아예 그리지 않는다
    summaryRef: fitText(b.summaryRef, LIMITS.summaryRef),
    summary: fitText(b.summary, LIMITS.summary),
    points: Array.from({ length: POINTS }, (_, i) => ({
      title: fitText(points[i]?.title, LIMITS.pointTitle),
      body: fitText(points[i]?.body, LIMITS.pointBody),
    })),
    questions,
    questionNote: fitText(b.questionNote, LIMITS.questionNote),
  };
}

// 이게 가이드 본문인가. 저장된 `{}`(0039의 기본값)와 모델의 엉뚱한 답을 같은 자리에서
// 걸러 낸다 — 화면은 "가이드가 없다"와 "가이드가 깨졌다"를 구분할 필요가 없다.
// **줄글 요약은 더 이상 필수가 아니다**(2026-09-08 템플릿) — 있으면 문자열이어야 한다.
export function isGuideShape(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!v.passage || typeof v.passage !== 'object' || typeof v.passage.ref !== 'string') return false;
  for (const k of ['summary', 'summaryRef', 'questionNote']) {
    if (v[k] != null && typeof v[k] !== 'string') return false;
  }
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

// 고르는 칩에 적는 짧은 이름 — `26.09.06 예배`(사용자 결정 2026-09-09 — "26년 9월 6일
// 주보 이렇게 하지 말고, 26.09.06 예배 이렇게 해줘"). 칩은 버튼 무리 안에 서므로
// 종이 머리·목록 줄의 긴 날짜와 달리 **짧아야** 한다. 점으로 끊어 적으면 폭이 절반이다.
export function guidePickLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[1].slice(2)}.${m[2]}.${m[3]} 예배` : '';
}

// ── 어떤 주보로 만들 것인가 (사용자 스펙 2026-09-08) ────────────────────────
// 고를 수 있는 것은 **발행된 주일 예배**다. 앞으로 올 주일도 넣는다 — 그 주 예배로
// 무엇을 나눌지는 예배 **전에** 준비한다(groups.js latestSunday와 같은 판단).
// 너무 길면 고르는 자리가 목록 화면이 된다 — 최근 여덟 건이면 두 달치다.
// `keepId`(= 고정된 가이드의 주보)는 여덟 건 밖으로 밀려나도 목록에 남는다. 기본으로
// 여는 한 벌이 정작 고를 수 없는 자리에 있으면 안 된다.
export const GUIDE_SERVICE_LIMIT = 8;

export function guideServices(services = [], keepId = '', limit = GUIDE_SERVICE_LIMIT) {
  const sundays = (services || [])
    .filter((s) => s?.kind === SUNDAY_KIND && s?.status === 'published')
    .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)));
  const head = sundays.slice(0, limit);
  const keep = keepId && !head.some((s) => s.id === keepId)
    ? sundays.find((s) => s.id === keepId) : null;
  return keep ? [...head, keep] : head;
}

// 고르는 줄에 적는 한 줄 — 날짜와, 설교 제목이 있으면 그것까지.
export const guideServiceLabel = (s) => (s
  ? `${guideServiceDate(s)}${str(s.title) ? ` · ${str(s.title)}` : ''}`
  : '');

// 고르는 목록은 날짜와 제목을 **따로** 세운다(왼쪽 날짜 · 그 옆 제목 · 오른쪽 꼬리표).
// 날짜 글자는 예배 줄기와 한 벌이다(§6-9-bp — worship.formatServiceDate).
export const guideServiceDate = (s) => (s ? formatServiceDate(s.service_date) : '');

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
    // 설교 제목은 **묻지 않는다** — 주보가 진실이라 generateGuide가 넣는다(위 계약 주석).
    // 물어 두면 모델이 지은 말이 주보 제목을 밀어내고, 순장이 읽어 주는 줄이 주보와 어긋난다.
    '{',
    '  "passage": { "ref": "본문 구절을 그대로" },',
    '  "points": [',
    `    { "title": "소제목 (${LIMITS.pointTitle}자 이내, 번호는 붙이지 마라)", "body": "그 대목의 설명 (${LIMITS.pointBody}자 이내)" },`,
    '    { "title": "…", "body": "…" },',
    '    { "title": "…", "body": "…" }',
    '  ],',
    '  "questions": [',
    `    "지난 한 주 일상을 나누는 질문 (${LIMITS.question}자 이내)",`,
    `    "본문을 자기 삶에 적용하는 질문 (${LIMITS.question}자 이내)",`,
    `    "본문을 자기 삶에 적용하는 질문 (${LIMITS.question}자 이내)",`,
    `    "이번 한 주를 어떻게 살아 볼지 정하는 질문 (${LIMITS.question}자 이내)"`,
    '  ],',
    `  "questionNote": "마지막 질문을 순모임에서 같이 해 볼 방법 한 줄 (${LIMITS.questionNote}자 이내, 마땅한 것이 없으면 빈 글)"`,
    '}',
    '',
    `- points는 반드시 ${POINTS}개이고 본문의 흐름을 차례로 따라간다. 이 셋이 '말씀 요약'의 전부다.`,
    `- questions는 반드시 ${QUESTIONS_MAX}개이고, **첫 질문은 본문 이야기가 아니라 지난 한 주 일상을 나누는 질문**이다.`,
    '- questionNote는 예를 들면 "고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기" 같은 한 줄이다.',
    '  "EX."나 괄호를 붙이지 마라. 화면이 붙인다.',
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

// 사용자가 준 순모임 가이드 템플릿 원문(26년 2월 1일분) — 개발 모드의 미리보기 전용 예시
const SAMPLE_GUIDE = {
  passage: { ref: '창세기 21:14-20', title: '(예시) 브엘세바!' },
  points: [
    { title: '죽음의 땅 광야', body: '아브라함이 준 떡과 물 한 가죽부대가 떨어지자 하갈은 아이를 덤불 아래 두고 화살 한 바탕쯤 떨어져 앉습니다. **아이의 죽는 것을 차마 보지 못하겠다**는 말이 그 자리의 전부입니다. 광야는 길이 보이지 않는 자리이고, 하갈은 그 자리에서 소리를 내어 웁니다.' },
    { title: '하나님이 들으셨다', body: '하나님은 아이의 소리를 들으셨습니다. **하나님이 그 아이의 소리를 들으셨나니**라는 말씀이 두 번 이어집니다. 우는 소리를 듣는 분이 계신다는 것이 이 대목이 말하는 것입니다. 사람은 아이를 두고 떨어져 앉았지만 하나님은 그 자리로 오십니다.' },
    { title: '눈이 밝아지니 샘물이', body: '하나님이 하갈의 눈을 밝히시니 **샘물**이 보입니다. 없던 샘이 생긴 것이 아니라 보이지 않던 것이 보인 것입니다. 하갈은 가죽부대에 물을 채워 아이에게 마시게 하고, 아이는 광야에서 자라 활 쏘는 자가 됩니다.' },
  ],
  questions: [
    '지난 한 주 어떠한 삶을 보냈는지 일상을 나눠봅시다!',
    '지금 내가 서 있는 광야는 어떤 자리인가요?',
    '들으시는 하나님을 붙들었던 순간이 있다면 나눠 주세요.',
    '이번 한 주, 곁에 있는 한 사람의 소리를 어떻게 들어 줄 수 있을까요?',
  ],
  questionNote: '고단한 한 주를 보낸 순원이 있다면 다같이 카페에 가서 달달한 것 먹기!',
};

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
  let body = parseGuide(await AiService.callGemini(prompt, system));
  // ponytail: 로컬 vite에는 /api/ai 서버 함수가 없어 AI가 늘 실패한다. 개발 모드에서만 사용자가
  // 준 템플릿 원문(창세기 21장 예시)을 그대로 돌려 **틀과 편집 흐름을 볼 수 있게** 한다.
  // 배포 빌드에서는 이 줄이 통째로 죽는다(import.meta.env.DEV = false).
  if (!body && import.meta.env?.DEV) body = fitGuide(structuredClone(SAMPLE_GUIDE));
  if (!body) return null;
  // 구절도 설교 제목도 주보가 진실이다 — 모델이 옮겨 적다가 틀리거나 딴 말을 지으면
  // 화면의 '주일 본문'이 주보와 어긋난다(순장이 그걸 읽어 준다).
  // 제목은 프롬프트가 아예 묻지 않으므로 여기서 넣는다. 주보에 없으면 빈 글이고,
  // 화면은 빈 글이면 대괄호째 그리지 않는다.
  if (service.passage_ref) body.passage.ref = String(service.passage_ref);
  body.passage.title = str(service.title);
  return body;
}

// ── 저장 (sun_guides · 게스트는 localStorage) ───────────────────────────────
// 게스트 키는 서비스마다 따로다(people.guestStore 주석) — 여기도 자기 키 한 벌이다.
const GUEST_TABLE = 'sun_guides';
const { rows: guestRows, set: guestSet } = guestStore('church_sunguide_v1');

// 읽기의 결과는 **한 벌 + 고정 여부**다(0055). 화면이 두 값을 같이 쓰므로 한 번에 준다 —
// 고정 여부는 body 안에 넣지 않는다(body는 AI가 채우는 템플릿이고, fitGuide가 모르는
// 필드를 떨어뜨린다. 넣었다면 저장할 때마다 조용히 사라졌을 것이다).
const shaped = (row) => (isGuideShape(row?.body)
  ? { body: fitGuide(row.body), pinned: !!row.pinned, updatedAt: row.updated_at || '' }
  : null);

export async function loadGuide(serviceId) {
  if (!serviceId) return null;
  if (!supabase) return shaped(guestRows(GUEST_TABLE).find((r) => r.service_id === serviceId));
  // 볼 자격이 없으면 error가 아니라 **행이 없다**(0039의 select 정책) — 화면은
  // '가이드 없음'과 같이 다룬다.
  const { data, error } = await supabase.from('sun_guides')
    .select('service_id, body, pinned, updated_at').eq('service_id', serviceId).maybeSingle();
  if (error) throw error;
  return shaped(data);
}

// 이 주보들 중 **이미 가이드가 있는 것**의 id 목록(사용자 지시 2026-09-09 — "주보를
// 일단 먼저 사용자가 선택을 하고 나서 해당 주보에 대해서 만들 수 있게"). 고르는 줄에
// '가이드 있음' 꼬리표를 붙이려면 한 건씩 열어 보지 않고 한 번에 알아야 한다.
// 열 건 남짓이라 body까지 받아 **모양까지 본다** — 0039의 기본값 `{}`가 든 행은
// 가이드가 아니다(loadGuide가 그 행을 null로 돌려주므로 꼬리표만 붙으면 어긋난다).
// 볼 자격이 없으면 error가 아니라 0행이다(0039의 select 정책).
export async function guidedServiceIds(serviceIds = []) {
  const ids = [...new Set((serviceIds || []).filter(Boolean))];
  if (!ids.length) return [];
  if (!supabase) {
    return guestRows(GUEST_TABLE)
      .filter((r) => ids.includes(r.service_id) && isGuideShape(r.body))
      .map((r) => r.service_id);
  }
  const { data, error } = await supabase.from('sun_guides')
    .select('service_id, body').in('service_id', ids);
  if (error) throw error;
  return (data || []).filter((r) => isGuideShape(r.body)).map((r) => r.service_id);
}

// 지금 고정된 가이드가 붙은 주보 id(없으면 null). 화면은 이 값으로 **처음 여는 한 벌**을
// 정한다 — 고정이 있으면 그것, 없으면 가장 최근 주일이다.
export async function pinnedGuideId() {
  if (!supabase) return guestRows(GUEST_TABLE).find((r) => r.pinned)?.service_id || null;
  const { data, error } = await supabase.from('sun_guides')
    .select('service_id').eq('pinned', true).maybeSingle();
  if (error) throw error;
  return data?.service_id || null;
}

export async function saveGuide(serviceId, body) {
  const fitted = fitGuide(body);
  if (!serviceId) return fitted;
  if (!supabase) {
    const rows = guestRows(GUEST_TABLE);
    const old = rows.find((r) => r.service_id === serviceId);
    const rest = rows.filter((r) => r.service_id !== serviceId);
    guestSet(GUEST_TABLE, [...rest, {
      // 고정은 여기서 건드리지 않는다 — 저장은 body만 갈아 끼운다(클라우드도 같다)
      ...old, service_id: serviceId, body: fitted, updated_at: new Date().toISOString(),
    }]);
    return fitted;
  }
  // created_by는 payload에 넣지 않는다 — 0039가 auth.uid()를 기본값으로 두었고,
  // 다른 사람이 다시 만들어 저장할 때 처음 만든 사람이 지워지면 안 된다.
  // pinned도 넣지 않는다 — upsert는 넘긴 칸만 쓰므로 고정 상태가 그대로 남는다
  // (마스터가 고정해 둔 행을 저장 한 번으로 풀어 버리면 안 된다).
  const { error } = await supabase.from('sun_guides')
    .upsert({ service_id: serviceId, body: fitted, updated_at: new Date().toISOString() },
      { onConflict: 'service_id' });
  if (error) throw error;
  return fitted;
}

// 고정 스위치 — **마스터만**(0055 set_sun_guide_pinned). 자격 판정도 '고정은 한 번에
// 하나'도 DB의 함수가 들고 있다. 화면은 버튼을 감출 뿐이다.
export async function pinGuide(serviceId, on) {
  if (!serviceId) return false;
  if (!supabase) {
    guestSet(GUEST_TABLE, guestRows(GUEST_TABLE)
      .map((r) => ({ ...r, pinned: !!on && r.service_id === serviceId })));
    return !!on;
  }
  const { error } = await supabase.rpc('set_sun_guide_pinned',
    { p_service_id: serviceId, p_on: !!on });
  if (error) throw error;
  return !!on;
}
