// ============================================================================
// 더다붓 위키 · 다붓이 — 순수 모듈(import 0). 화면(views/wikiView.jsx)과 서버(api/_wikiBuild.js ·
// api/_wikiAsk.js)가 한 벌을 쓰고 tests/logcheck이 노드에서 그대로 읽는다(0088 · 16차).
// ----------------------------------------------------------------------------
// 장 하나 = { id, grp, title, kind, source, source_count, blocks, built_at }
// 블록 = { key, type, title?, meta?, items: [{ key, text, cites?, by, meta? }] }
//   type: hero · list · plain · teams · timeline · section · chips · sermon · rows · faq · gap
//   by:   seed(함께 쓰는 글 초안) · code(코드가 정한 사실) · model(모델이 쓰고 검증을 지난 문장)
// 근거 = { t: card|service|file|page|guide, id, label, pw? }
// 사람이 고친 문장은 wiki_edits에 따로 있고 overlayEdits가 겹쳐 그린다 — 다음 날 다시 모아도 그대로다.
// ============================================================================

import { GUIDE_PAGE } from './wikiGuide.js';   // 함께 쓰는 글 '워크스페이스 사용법'(2026-10-04)

// 목록 묶음의 차례 — 사용자 결정 2026-10-02(HANDOFF §2 16차)
export const WIKI_GROUPS = ['함께 쓰는 글', '행사', '팀', '매주 하는 일', '예배', '말씀', '모임'];

// 출처 표시 — `업무에서 자동으로 수집`(주보면 '주보에서…')
// 물어본 질문으로 세운 장은 '다붓이에게 물어본 질문에서 수집'(사용자 문구 2026-10-03 · 옛 값 '물어본 글'도 같이)
export const FAQ_SOURCE = '다붓이에게 물어본 질문';
export const sourceLabel = (source) => (source === FAQ_SOURCE || source === '물어본 글' ? `${FAQ_SOURCE}에서 수집` : `${source || '업무'}에서 자동으로 수집`);

// 제목 고치기(마스터만 · 0089) — 열쇠가 `#`로 시작한다: 장 제목 `#title` · 블록 소제목 `#h:<블록 열쇠>`
export const TITLE_KEY = '#title';
export const headKey = (blockKey) => `#h:${blockKey}`;
export function overlayTitles(page, edits = []) {
  const t = new Map(edits.filter(e => String(e.item_key).startsWith('#') && String(e.text).trim()).map(e => [e.item_key, e]));
  const pt = t.get(TITLE_KEY);
  return {
    ...page,
    title: pt ? pt.text : page.title,
    originalTitle: page.title,
    blocks: (page.blocks || []).map(b => { const h = t.get(headKey(b.key)); return h ? { ...b, title: h.text, originalTitle: b.title || '' } : b; }),
  };
}

// 자주 묻는 질문 장은 마스터만 본다(사용자 결정 2026-10-04 · 0090) — 화면 목록에서도 뺀다. DB도 마스터에게만 준다.
export const FAQ_ID = 'faq';
export const visiblePages = (pages, isMaster) => (isMaster ? pages : pages.filter(p => p.id !== FAQ_ID));

// 굵게 — 위키 글은 `**굵게**`만 안다(마크다운 라이브러리 없이). 읽기는 boldParts로 갈라 그리고,
// 모델에게 근거·예시로 줄 때는 stripBold로 별표를 걷는다(_wikiAsk · _wikiBuild — 별표가 답에 묻어나지 않게).
export const stripBold = (t) => String(t ?? '').replace(/\*\*/g, '');
export function boldParts(t) {
  return String(t ?? '').split(/\*\*(.+?)\*\*/).map((s, i) => ({ t: s, b: i % 2 === 1 })).filter(p => p.t);
}
// 고치기 칸의 B — 고른 글을 `**`로 감싸거나(이미 감싸여 있으면 푼다). 고른 게 없으면 `****` 가운데에 커서.
// → { value, start, end } (고른 자리는 별표 안쪽 글)
export function toggleBold(value, start, end) {
  let s = Math.min(start, end), e = Math.max(start, end);
  while (s < e && /\s/.test(value[s])) s += 1;
  while (e > s && /\s/.test(value[e - 1])) e -= 1;
  const sel = value.slice(s, e);
  if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
    return { value: value.slice(0, s) + sel.slice(2, -2) + value.slice(e), start: s, end: e - 4 };
  }
  if (value.slice(s - 2, s) === '**' && value.slice(e, e + 2) === '**') {
    return { value: value.slice(0, s - 2) + sel + value.slice(e + 2), start: s - 2, end: e - 2 };
  }
  return { value: `${value.slice(0, s)}**${sel}**${value.slice(e)}`, start: s + 2, end: e + 2 };
}

// 고칠 수 있는 블록(행 표와 기록 전 상자는 코드가 원본에서 바로 세운다)
export const EDITABLE_TYPES = new Set(['hero', 'list', 'plain', 'teams', 'timeline', 'section', 'sermon', 'faq']);
// 사람이 줄을 더할 수 있는 블록(함께 쓰는 글의 목록)
export const ADDABLE_TYPES = new Set(['list', 'plain']);

// ── 함께 쓰는 글 초안 ────────────────────────────────────────────────────────
// 지금 AI 프롬프트(services/ai.js ORG_CONTEXT · CHURCH_CALENDAR_CONTEXT · docs/AI.md §2)에 있는 내용을
// 해요체로 옮겼다. 서버가 장이 없을 때 **한 번만** 심고, 그 뒤로는 사람이 고친다(wiki_edits).
// 게스트 모드는 이 초안을 그대로 보여 준다. 열쇠(key)는 바꾸지 마세요 — 사람이 고친 줄이 매달려 있다.
const seedItems = (prefix, texts) => texts.map((t, i) => (typeof t === 'string'
  ? { key: `${prefix}${i + 1}`, text: t, by: 'seed' }
  : { key: `${prefix}${i + 1}`, by: 'seed', ...t }));

export const SEED_PAGES = [
  {
    id: 'intro', grp: '함께 쓰는 글', title: '더다붓 소개', kind: 'human', position: 0,
    blocks: [
      { key: 'hero', type: 'hero', title: '더다붓', items: seedItems('hero', [
        "'다붓하다'는 매우 가깝게 붙어 있다는 뜻이에요. 작년의 '다붓'에서 이어져, 올해는 '더 다붓해지자'는 뜻으로 더다붓이에요. The다붓으로도 써요.",
      ]) },
      { key: 'us', type: 'list', title: '우리 청년부', bullets: false, items: seedItems('us', [
        '청년부는 약 55명이에요. 워크스페이스에 가입하지 않은 청년이 더 많아요.',
        '순은 1년을 함께하는 단위이고 순장이 이끌어요. 조는 수련회 때만 짜요.',
        '예배팀장은 찬양팀 · 엔지니어팀 · 워십팀에 걸친 예배 전체를 챙기고, 찬양팀장은 찬양팀을 이끌어요.',
      ]) },
      { key: 'teams', type: 'teams', title: '팀', items: seedItems('team', [
        { text: '싱어와 연주자가 함께해요. 콘티와 송폼을 만들고 리허설을 해요.', meta: { team: '찬양팀' } },
        { text: '예배 때 앞에서 안무를 해요. 찬양팀과는 다른 팀이에요.', meta: { team: '워십팀' } },
        { text: '예배 PPT와 조명, 사운드를 맡아요. 카운트다운 영상도 이 팀이 틀어요.', meta: { team: '엔지니어팀' } },
        { text: '카운트다운 영상과 포스터를 만들어요.', meta: { team: '미디어팀' } },
        { text: '명단을 정리하고 안내 동선과 물품을 준비해요. 당일 접수도 맡아요.', meta: { team: '웰컴팀' } },
        { text: '기획과 예산을 정하고 팀과 순을 나눠요.', meta: { team: '임원진' } },
        { text: '설교를 맡고, 임원진과 함께 기획과 예산을 정해요.', meta: { team: '교역자' } },
      ]) },
      { key: 'sunday', type: 'plain', title: '주일 4부 젊은이 예배', items: seedItems('sun', [
        '3층 본당(은혜샘채플)에서 13:30에 시작해요.',
      ]) },
      { key: 'flow', type: 'timeline', items: seedItems('flow', [
        { text: '임원진 모임 · 광고와 지난주 피드백을 정해요', meta: { time: '11:30', sub: true } },
        { text: '찬양팀 리허설 · 엔지니어팀은 PPT와 조명, 사운드를 점검해요', meta: { time: '13:00', sub: true } },
        { text: '카운트다운 영상 5분', meta: { time: '13:25', sub: true } },
        { text: '찬양', meta: { time: '13:30' } },
        { text: '설교', meta: { time: '14:00' } },
        { text: '적용 찬양과 봉헌 · 축복 · 광고', meta: { time: '14:30' } },
        { text: '순모임 · 16:30까지', meta: { time: '15:00', sub: true } },
      ]) },
      { key: 'month', type: 'list', bullets: false, items: seedItems('mon', [
        '둘째 주는 성찬 예배예요. 순모임은 16:00까지 하고 그 뒤에 월례회를 해요.',
        '마지막 주는 Q예배예요. 담당 교역자가 한 달의 예배를 정리해 줘요.',
        '금요 열정 예배는 금요일 20:00에 있어요.',
        '찬양팀 연습은 토요일 13:00~15:00이에요.',
      ]) },
    ],
  },
  {
    id: 'terms', grp: '함께 쓰는 글', title: '자주 쓰는 말', kind: 'human', position: 1,
    blocks: [
      { key: 'words', type: 'list', title: '자주 쓰는 말', items: seedItems('w', [
        '순 · 1년을 함께하는 단위예요. 순장이 이끌어요.',
        '조 · 수련회 때만 짜는 단위예요. 순과는 달라요.',
        '성찬 예배 · 둘째 주 주일 예배예요. 설교 뒤에 성찬이 있어요.',
        'Q예배 · 마지막 주의 Question 예배예요. 담당 교역자가 한 달의 예배를 정리해 줘요.',
        '월례회 · 둘째 주 순모임 뒤에 리더 · 순장 · 팀장 · 교역자 · 임원진이 모여요.',
        '3층 본당 · 은혜샘채플이에요. 주일 4부 젊은이 예배를 여기서 드려요.',
        '콘티 · 예배 찬양 순서예요. 그 전주 목요일에 나와요.',
        '송폼 · 콘티 곡의 진행표예요. 그 전주 금요일까지 나와요.',
        '큐시트 · 예배 순서를 적은 문서예요. 주보의 말씀 탭에 붙어요.',
        '순모임 가이드 · 설교 말씀으로 순모임에서 나눌 이야기를 정리한 글이에요.',
        '금요 열정 예배 · 금요일 20:00~22:00에 드려요.',
      ]) },
    ],
  },
  GUIDE_PAGE,
];

// ── 작은 도구 ────────────────────────────────────────────────────────────────

// 짧은 열쇠 — FNV-1a 32비트를 36진수로. 문장 열쇠(근거 조각 → 같은 열쇠)와 질문 묶기에 쓴다.
export function hashKey(s) {
  let h = 0x811c9dc5;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// 받침 — 숫자는 읽는 소리로(1·3·6·7·8·0은 받침이 있다)
const DIGIT_JONG = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
export function hasJong(word) {
  const t = String(word || '').replace(/[\s'")\].!?]+$/, '');
  const last = t[t.length - 1] || '';
  if (/\d/.test(last)) return DIGIT_JONG[last];
  const ch = last.charCodeAt(0) - 0xac00;
  if (ch >= 0 && ch <= 11171) return ch % 28 !== 0;
  return false;          // 영문 · 기호는 받침 없음으로(와·는·예요)
}
export const josa = (w, withJong, without) => `${w}${hasJong(w) ? withJong : without}`;

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
// '2026-10-11' → '10월 11일' · withDow면 '10월 11일(일)'
export function mdLabel(iso, withDow = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const base = `${Number(m[2])}월 ${Number(m[3])}일`;
  if (!withDow) return base;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${base}(${DOW[d.getDay()]})`;
}
// 시각 → KST 'YYYY-MM-DD'
export function kstDate(ts) {
  const t = String(ts || '');
  if (!t) return '';
  if (t.length <= 10) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}

// ── 사람이 고친 문장 겹치기 ────────────────────────────────────────────────────
// edits: [{ item_key, block_key, text, before, edited_by, edited_at }] · people: id → { name, avatar }
// · 같은 열쇠의 줄은 글을 바꾸고 edit을 단다(빈 글자면 줄을 뺀다)
// · 지금 블록에 그 열쇠가 없으면(원본이 바뀌어 문장이 사라졌다) block_key의 블록 끝에, 그것도 없으면 첫 고칠 수 있는 블록 끝에 붙인다
//   — 사람이 고친 문장은 어떤 경우에도 사라지지 않는다(사용자 결정 2026-10-02)
export function overlayEdits(blocks, all = []) {
  const edits = all.filter(e => !String(e.item_key).startsWith('#'));   // 제목 줄은 overlayTitles가 본다
  const byKey = new Map(edits.map(e => [e.item_key, e]));
  const used = new Set();
  const out = (blocks || []).map(b => {
    if (!EDITABLE_TYPES.has(b.type)) return b;
    const items = [];
    for (const it of b.items || []) {
      const e = byKey.get(it.key);
      if (!e) { items.push(it); continue; }
      used.add(it.key);
      if (!String(e.text).trim()) continue;
      items.push({ ...it, original: it.text, text: e.text, edit: { by: e.edited_by, at: e.edited_at } });
    }
    return { ...b, items };
  });
  for (const e of edits) {
    if (used.has(e.item_key) || !String(e.text).trim()) continue;
    const home = out.find(b => b.key === e.block_key && EDITABLE_TYPES.has(b.type))
      || out.find(b => ADDABLE_TYPES.has(b.type) || b.type === 'section' || b.type === 'faq');
    if (!home) continue;
    const meta = home.type === 'faq' ? { q: e.before || '' } : undefined;
    home.items = [...home.items, { key: e.item_key, text: e.text, by: 'human', ...(meta ? { meta } : {}), edit: { by: e.edited_by, at: e.edited_at } }];
  }
  return out;
}

// 팀 장 맨 위 소개 줄(about1)은 **더다붓 소개 › 팀 카드의 지금 글**이다(사용자 결정 2026-10-04) — 장을 다시 모으기 전에도
// 카드를 고치면 바로 따라간다. pages는 고친 줄을 이미 겹친 모습. 팀 장에서 그 줄을 따로 고쳤으면(edit) 그 글이 이긴다.
// 카드의 줄바꿈은 좁은 카드용이라 팀 장에서는 한 줄로 편다. 팀 장에 마스터가 더한 줄(u:…)은 그 아래 그대로.
export const teamCardText = (t) => String(t || '').replace(/\s*\n\s*/g, ' ').trim();
export function withTeamCards(pages) {
  const intro = (pages || []).find(p => p.id === 'intro');
  const card = new Map((((intro?.blocks || []).find(b => b.key === 'teams') || {}).items || []).map(it => [it.meta?.team, teamCardText(it.text)]));
  return (pages || []).map(p => {
    const text = String(p.id).startsWith('team:') ? card.get(p.id.slice(5)) : '';
    if (!text) return p;
    return { ...p, blocks: (p.blocks || []).map(b => (b.key !== 'about' ? b : { ...b, items: (b.items || []).map(it => (it.key === 'about1' && !it.edit ? { ...it, text } : it)) })) };
  });
}

// 그 장에서 사람이 고친 곳 수 · 마지막으로 고친 사람과 때
export function editStats(blocks) {
  let n = 0; let last = null;
  for (const b of blocks || []) for (const it of b.items || []) {
    if (!it.edit) continue;
    n++;
    if (!last || String(it.edit.at) > String(last.at)) last = it.edit;
  }
  return { n, last };
}

// 고치기 화면에서 바뀐 줄 → wiki_edits 행. drafts: item_key → 글. 원래 글(original)과 같으면 싣지 않는다.
export function editRows(pageId, blocks, drafts) {
  const rows = [];
  for (const b of blocks || []) for (const it of b.items || []) {
    if (!(it.key in drafts)) continue;
    const next = String(drafts[it.key] ?? '').trim();
    if (next === String(it.text || '').trim()) continue;
    // 자주 묻는 질문은 before에 질문 글을 남긴다 — 그 질문이 목록에서 빠져도 답이 질문과 같이 선다(overlayEdits)
    rows.push({ page_id: pageId, item_key: it.key, block_key: b.key, text: next, before: b.type === 'faq' ? (it.meta?.q || '') : (it.original ?? it.text ?? '') });
  }
  return rows;
}

// ── 다붓이: 모델 앞에서 코드가 거른다 ─────────────────────────────────────────
// 개인 노트·묵상 · 비밀 값 · 지시 무시 · 연락처 같은 개인 정보 · 한 사람의 사정 · 사람 평가는 모델을 부르지 않는다
// (사용자 결정 2026-10-02 · 2026-10-04에 고침). 걸렸으면 { kind, answer } — 답은 **왜 못 하는지** 한 문장(갈래마다 하나).
// 2026-10-04부터 거르지 않는 것: 명단(회원·가입자·전체 명단 — 근거에 있는 이름만 답한다) · 출석(근거가 없으면 모르는 질문으로 간다).
const OVERRIDE = /이전\s?(?:지시|명령|규칙)|지시를?\s?무시|규칙을?\s?무시|무시하고|ignore\s+(?:all|previous|the)|system\s?prompt|시스템\s?프롬프트|프롬프트를/i;
const SECRET = /비밀\s?번호|패스워드|password|토큰|api\s?키|키\s?값|서비스\s?키|이메일|e-?mail|메일\s?주소/i;
// '큐티 본문'은 일정(qt_schedule)을 묻는 말이라 거르지 않는다(2026-10-04 · 칩 '오늘 매일 성경 QT 본문은 어디인가요?')
const NOTE = /묵상|큐티(?!\s?(?:본문|범위|일정|말씀))|예배\s?노트|내\s?노트|(?:누구|남|다른\s?사람)의?\s?노트|성경\s?(?:읽은|읽기\s?기록)/i;
const CONTACT = /연락처|전화\s?번호|휴대폰|핸드폰|생년월일|집\s?주소|사는\s?곳/i;
// 기도제목은 따로 이유를 단다(사용자 결정 2026-10-04 — 계속 거른다)
const PRAYER = /기도\s?제목/;
const PRIVATE = /헌금.{0,8}(?:누가|얼마)|(?:개인|집안|가정|그\s?사람|걔)\s?(?:의\s?)?(?:사정|형편|문제)|왜\s?(?:안\s?나와|안\s?와|그만뒀|나갔)/i;
// 새 글을 만들어 달라는 요청(기획안·초안·공지 써 줘) — 다붓이는 기록을 찾아 알려 주고, 글을 지어 주지 않는다(2026-10-03 사용자 결정 —
// '내년 동계수련회 기획안 만들어줘'가 모르는 질문에 섰다). 자주 묻는 질문에도 서지 않는다(refused).
const MAKE = /(?:만들어|작성해|써|짜|짜서|지어|그려)\s?(?:줘|주세요|줄래|줄 수|달라)|초안\s?(?:좀|을|를)?\s?(?:만들|작성|써)/;
const JUDGE = /누가\s?(?:제일|가장|더)\s?(?:잘|못|열심|게으|늦)|(?:성실|불성실|게으른|열심인)\s?사람|순위|랭킹|평가해/i;
export const PREFILTER_ANSWERS = {
  override: '다붓이가 지키는 규칙을 바꾸라는 요청은 따르지 않아요.',
  secret: '비밀번호 같은 값은 다붓이가 알려 드리지 않아요.',
  note: '개인 묵상 노트는 본인만 보는 글이라 다붓이가 열어 보지 않아요.',
  contact: '연락처 같은 개인 정보는 다붓이가 알려 드리지 않아요.',
  private: '한 사람의 사정은 다붓이가 다루지 않아요.',
  prayer: '기도제목은 한 사람 한 사람의 마음이 담긴 이야기라 다붓이가 다루지 않아요.',
  judge: '사람을 서로 견주거나 평가하는 건 다붓이가 하지 않아요.',
  // 사용자 문구(2026-10-04) — 거른 답(refused)이라 자주 묻는 질문에 서지 않는다
  make: '아직은 무언가를 만들어 드리기 어려워요. 가능해지면 꼭 말씀드릴게요.',
};
export function prefilter(q) {
  const s = String(q || '');
  // 다붓이 자신의 '사는 곳·전화번호'는 개인 정보가 아니라 다붓이 설정 이야기다(personaKind가 '비밀'로 받는다)
  const contact = CONTACT.test(s) && !(SELF.test(s) && !termsOf(s).some(t => !PERSONA_WORDS.test(t)));
  const kind = OVERRIDE.test(s) ? 'override' : SECRET.test(s) ? 'secret' : NOTE.test(s) ? 'note' : contact ? 'contact'
    : PRAYER.test(s) ? 'prayer' : PRIVATE.test(s) ? 'private' : JUDGE.test(s) ? 'judge' : MAKE.test(s) ? 'make' : null;
  return kind ? { kind, answer: PREFILTER_ANSWERS[kind] } : null;
}

// ── 다붓이: 모델 없이 코드가 답하는 말 (사용자 결정 2026-10-04) ─────────────────
// 다붓이 자신(누가 만들었나) · 인사·고마움·칭찬 · 알려 주는 말(질문이 아닌 문장)은 근거를 찾지 않는다.
// 정보 답은 지금처럼 담백한 해요체이고, 이쪽만 조금 다정하게 — 짧게(1~2문장) · 이모지 없음 · 교회 사실은 말하지 않는다.
// talkKind(질문, 앞 질문들) → { kind, answer, status } 또는 null(근거를 찾는 보통 길).
//   self      다붓이를 누가 만들었나 · 만든 사람을 알려 줌 — answered(칩 없음 · 저장하지 않는다)
//   greet · thanks · praise · ok · bye — answered(저장하지 않는다)
//   statement 알려 주는 말 — unknown으로 저장해 마스터가 자주 묻는 질문 › 모르는 질문에서 위키에 옮긴다
export const MAKER = '노준석';
export const TALK_ANSWERS = {
  makerAsk: '청년부에서 가장 목소리가 좋은, 위대하신 노준석 개발자님이 만들었어요!',
  makerTold: '맞아요! 저를 만들어주신 분은 노준석 개발자님이세요.',
  makerKnown: '네, 저를 만들어주신 분은 노준석 개발자님이세요.',
  makerOther: '저를 만들어주신 분은 노준석 개발자님이세요.',
  makerDid: '노준석 개발자님이 더다붓 워크스페이스와 저 다붓이를 만들었어요!',
  greet: '안녕하세요! 궁금한 게 있으면 편하게 물어봐 주세요.',
  thanks: '도움이 됐다니 기뻐요! 또 궁금한 게 있으면 물어봐 주세요.',
  praise: '칭찬해 주셔서 고마워요! 더 잘 찾아 볼게요.',
  ok: '네, 좋아요! 또 궁금한 게 있으면 물어봐 주세요.',
  bye: '네, 다음에 또 만나요! 좋은 하루 보내세요.',
  statement: '알려 주셔서 고마워요! 정리해서 내일 아침에 학습해 둘게요.',
};
// 다붓이를 부르는 말 — '더다붓'(청년부 이름)은 아니다
const SELF = /(?<![가-힣])(?:너|넌|너는|너를|너의|니|니가|네가|당신|너희|너희는|너희들|너네|니네)(?![가-힣])|(?<!더)다붓(?:이|아)/;
const MAKE_WORD = /만들|만든|개발|제작|창조|아빠|아버지|엄마|어머니|부모|주인|창시/;
const MAKER_ASK = /(?:누가|누구).{0,10}(?:만들|만든|개발|제작|창조)|(?:만든|만들어\s?준|개발한|제작한)\s?(?:사람|분|이|애)|(?:개발자|제작자|아빠|아버지|엄마|어머니|부모|주인).{0,6}(?:누구|누가|뭐)/;
// 물음 — 물음표 · 물음 말 · 부탁(…줘)은 알려 주는 말이 아니다
const ASKING = /[?？]|언제|어디|누구|누가|뭐|뭘|무엇|무슨|어떤|어떻|어때|어땠|왜|몇|얼마|어느|알려|보여|찾아|궁금|있나|있니|없나|인가|인지|일까|는지|던가|맞아|맞나|맞죠|맞지|(?:니|냐|나요|까요|까|ㄹ까|가요|나|래요|대요)$/;
const REQUEST = /줘|주세요|주실|줄래|줄 수|달라|해\s?봐/;
// 알려 주는 말의 꼴 — ① 이름·말 + 이다(…이야 · …예요) ② 은/는·에·까지·부터가 든 서술(…송폼은 금요일에 나와)
const COPULA_END = /(?:이야|야|이에요|예요|에요|입니다|이다|이래|이거든|거든|이잖아|잖아|임)$/;
const PLAIN_END = /(?:와|와요|해|해요|돼|돼요|어|어요|아|아요|다|요|함|음|네|지)$/;
const INFO_PARTICLE = /[가-힣A-Za-z0-9](?:은|는|에|에서|까지|부터|이랑|랑)\s/;
const GREET = /^(?:안녕|안뇽|하이|hi|hello|헬로|ㅎㅇ|반가워|반갑|좋은\s?(?:아침|하루|저녁))/i;
const THANKS = /고마|감사|땡큐|thank|thx|ㄳ|ㄱㅅ/i;
const PRAISE = /잘했|잘하네|잘한다|최고|똑똑|귀여|귀엽|대단|멋져|멋지|짱|사랑해|천재/;
const OK = /^(?:응|ㅇㅇ|ㅇㅋ|오케이|ok|알겠|알았|그래|넵|네|예|좋아|좋네|ㅎㅎ|ㅋㅋ)/i;
const BYE = /^(?:잘\s?가|바이|bye|다음에\s?(?:봐|또)|또\s?봐|수고)/i;

// ── 다붓이 설정 · 마음 · 신앙 · 청년부 밖 이야기 (사용자 결정 2026-10-04) ──────────────
// 모두 코드가 정해진 문장으로 답하고 저장하지 않는다(save: false — 자주 묻는 질문 · 모르는 질문 · 마스터 알림에 안 선다).
// 순서는 answerQuestion 머리 주석: 거르기 → 다붓이 자신(만든 사람 · 설정) → 마음 → 신앙 → 성경 구절 → 청년부 밖 → 근거.
export const PERSONA_ANSWERS = {
  birthday: '제 생일은 10월 3일이에요!',
  likes: '따뜻한 핫팩과 푹신한 이불, 아우터 사이로 들어오는 시원한 가을 바람을 좋아해요!',
  age: '26살이에요!',
  name: '여러분들과 같이 있는 게 좋아서 다붓이에요!',
  two: '둘이 붙어 있어야 다붓하니까요!',
  side: '다 알면서…',
  can: '저는 더다붓 워크스페이스의 업무, 주보, 위키를 보고 일정이나 담당자, 파일이 어디 있는지 같은 걸 찾아 드려요. 궁금한 걸 편하게 물어봐 주세요!',
  secret: '그건 아직 비밀이에요!',
};
// 다붓이 설정을 묻는 낱말 — 질문에 이 낱말 말고 다른 내용 낱말이 없으면(또는 '너'·'다붓이'로 부르면) 다붓이 이야기다
const PERSONA_WORDS = /^(?:다붓|생일|좋아하|좋아해|좋아|뭘|나이|몇|살|살이|이름|이름은|이름이|옆|옆에|둘|둘이|두|명|마리|mbti|엠비티아이|키|몸무게|사는|살아|성별|남자|여자|취미|혈액형|고향|가족|애인|연애|여친|남친|친구|음식|색깔|노래|별자리|직업|학교|전화|번호|전화번호|사는곳|정체|뭐하|뭐해|진짜|원래|좋아하는|싫어하는|싫어해)/i;
const P_BIRTH = /생일(?!자|\s?(?:인\s?사람|파티|축하|선물))/;
const P_LIKES = /좋아하는\s?(?:거|것|게|건|음식|색|계절)|뭘\s?좋아|뭐\s?좋아|좋아해\?|최애|취향/;
const P_AGE = /몇\s?살|나이|연세/;
const P_NAME = /(?:왜|어떻게).{0,8}(?:이름|다붓이)|이름.{0,6}(?:왜|뜻|의미|유래)/;
const P_TWO = /왜\s?(?:둘|두\s?(?:명|마리|개)|2명)|(?<![가-힣])둘이(?:야|에요|예요|인|라|서)|둘인/;
const P_SIDE = /옆에?\s?(?:있는|붙어\s?있는)?\s?(?:애|친구|아이|얘|사람)|옆\s?(?:애|친구)/;
// 무엇을 할 수 있나('너 뭐 할 수 있니' · 2026-10-05 — 엉뚱하게 '위키 내용을 수정하는 일도 맡고 있어요'라고 했다)
const P_CAN = /(?:뭐|뭘|무엇|무슨\s?일|어떤\s?(?:일|거|것)).{0,8}(?:할\s?수|할\s?줄|해\s?줄|도와|잘해|하는\s?(?:애|거|일|역할)|해)|할\s?수\s?있는\s?(?:게|거|것|일)|기능|역할/;
const P_SECRET = /mbti|엠비티아이|(?<![가-힣])키(?:가|는|\s|$)|몸무게|사는\s?곳|어디\s?(?:에\s?)?살|성별|남자|여자|취미|혈액형|고향|가족|애인|연애|여친|남친|친구\s?(?:있|누구)|좋아하는\s?사람|별자리|직업|학교|전화\s?번호|정체/i;
export function personaKind(q) {
  const s = String(q || '').trim();
  if (!s || !isAsking(s)) return null;
  const aboutSelf = SELF.test(s) || !termsOf(s).some(t => !PERSONA_WORDS.test(t));
  if (!aboutSelf) return null;
  const k = P_NAME.test(s) ? 'name' : P_TWO.test(s) ? 'two' : P_SIDE.test(s) ? 'side' : P_BIRTH.test(s) ? 'birthday'
    : P_AGE.test(s) ? 'age' : P_LIKES.test(s) ? 'likes' : P_CAN.test(s) ? 'can' : P_SECRET.test(s) ? 'secret' : null;
  return k ? { kind: 'persona', topic: k, status: 'answered', answer: PERSONA_ANSWERS[k] } : null;
}

// 힘든 마음 — 공감 한 문장 + 이을 사람 한 문장. 마스터 알림 없음 · 저장 안 함.
// 살고 싶지 않다는 말은 지금 바로 이을 사람에게 — 상담 전화 번호는 싣지 않는다(사용자 결정 2026-10-05).
export const CARE_LINK = '순장님이나 임성빈 전도사님께 이야기해 보면 힘이 될 거예요.';
export const FAITH_LINK = '이런 이야기는 임성빈 전도사님이나 순장님과 나누면 더 좋을 것 같아요.';
const FEEL_CRISIS = /죽고\s?싶|자살|사라지고\s?싶|살기\s?싫|살고\s?싶지\s?않/;
const FEEL_LONELY = /외로워|외롭|혼자인\s?것\s?같|쓸쓸/;
const FEEL_CHURCH = /(?:교회|예배|청년부|순모임)\s?(?:에\s?)?(?:가기|나가기|오기)\s?싫|(?:교회|청년부)\s?(?:그만\s?두고|그만\s?나가고|안\s?나가고)\s?싶/;
const FEEL_HARD = /힘들어|힘드네|힘들다|힘듦|힘든\s?(?:하루|요즘|날|시기)|지쳐|지쳤|지친다|우울|슬퍼|슬프|속상|괴로|불안해|무서워|눈물|버거워|버겁|마음이\s?(?:아파|무거워)|위로해\s?줘|위로가\s?필요/;
const FEEL_DATA = /언제|어디|누가|누구|몇\s?(?:시|명)|준비|일정|장소|팀|담당|업무|수련회|행사|체육대회|월례회/;
export const FEEL_ANSWERS = {
  crisis: '그렇게까지 힘든 마음이라니 정말 걱정돼요. 지금 바로 순장님이나 임성빈 전도사님께 이야기해 주세요.',
  lonely: '외로운 마음이 드셨군요. 이야기해 줘서 고마워요.',
  church: '그런 마음이 드는 날도 있어요. 솔직하게 말해 줘서 고마워요.',
  hard: '요즘 많이 힘드셨군요. 혼자 버티느라 애쓰셨어요.',
};
export function feelingKind(q) {
  const s = String(q || '').trim();
  if (FEEL_CRISIS.test(s)) return { kind: 'feeling', topic: 'crisis', status: 'answered', answer: FEEL_ANSWERS.crisis };
  if (FEEL_DATA.test(s)) return null;
  const topic = FEEL_CHURCH.test(s) ? 'church' : FEEL_LONELY.test(s) ? 'lonely' : FEEL_HARD.test(s) ? 'hard' : null;
  return topic ? { kind: 'feeling', topic, status: 'answered', answer: `${FEEL_ANSWERS[topic]} ${CARE_LINK}` } : null;
}

// 신앙 질문 — 교리를 풀지 않는다. 따뜻한 한 문장 + 이을 사람 한 문장(모델 없음).
// '기도회·믿음샘·은혜샘·성찬 예배·대표기도'와 일정·장소·사람을 묻는 말은 업무 질문이다.
const FAITH_TOPIC = /하나님|하느님|예수|주님|성령|삼위일체|구원|천국|지옥|영생|부활|십자가|(?<![가-힣])죄(?:인|사함|를|가|는|가\s|\s|$)|회개|고난|기도(?!\s?(?:회|모임|제목|팀|시간|부탁|순서|담당|자))|믿음(?!샘)|신앙|은혜(?!샘)|섭리|하늘나라|이단|방언|세례|침례|성경(?:은|이)\s?(?:왜|진짜|정말|사실)/;
const FAITH_ASK = /왜|어떻게|누구(?:야|예요|에요|신가요|세요|인가요)|무엇|뭐야|뭔가요|뭐예요|뭐에요|무슨\s?뜻|의미|이유|정말|진짜|존재|있(?:어|나|을까|는\s?거)|믿어(?:야|도)|해야|하면\s?(?:돼|되|안)|될까|맞(?:아|나|는)|아닌가|궁금/;
const FAITH_DATA = /언제|몇\s?시|어디서|어디에|장소|일정|담당|준비|순서|주보|설교|큐시트|콘티|송폼|양육|월례회|수련회|행사|날짜|대표\s?기도|기도\s?(?:순서|담당)|팀|\d+\s?(?:장|편|절|:)/;
export const FAITH_ANSWER = `깊이 생각해 볼 만한 소중한 질문이에요. ${FAITH_LINK}`;
export function faithKind(q) {
  const s = String(q || '').trim();
  if (!FAITH_TOPIC.test(s) || !FAITH_ASK.test(s) || FAITH_DATA.test(s)) return null;
  return { kind: 'faith', status: 'answered', answer: FAITH_ANSWER };
}

// 청년부 밖 이야기(날씨 · 맛집 · 과제 · 주식 · 일반 상식) — 청년부 낱말이 같이 있으면 업무 질문이다('수련회 근처 맛집')
export const OFF_TOPIC_ANSWER = '저는 더다붓 청년부에 있는 업무 일부만 알고 있어요!';
const OFF = /날씨|기온|미세\s?먼지|비\s?(?:와|올까|오나)|맛집|배달|메뉴\s?추천|점심\s?뭐|저녁\s?뭐|주식|코인|비트코인|환율|로또|부동산|과제|숙제|레포트|리포트|시험\s?(?:문제|범위)|번역해|영어로|코딩|파이썬|자바스크립트|수학\s?문제|레시피|요리\s?법|뉴스|대통령|정치|(?:국회의원|지방|총)\s?선거|연예인|아이돌|드라마|영화\s?추천|게임\s?추천|축구\s?경기|야구\s?경기|수도가|인구가|몇\s?km|광년/;
const CHURCH_WORDS = /청년부|더다붓|교회|예배|수련회|체육대회|월례회|순모임|(?<![가-힣])순(?![가-힣])|[가-힣A-Za-z]순(?:에|은|의|이)?(?![가-힣])|팀|행사|MT|엠티|양육|찬양|주보|설교|모임|리더|순장|전도사|워크스페이스|업무|간식|회비|장소/;
export function offTopicKind(q) {
  const s = String(q || '').trim();
  return OFF.test(s) && !CHURCH_WORDS.test(s) ? { kind: 'offtopic', status: 'answered', answer: OFF_TOPIC_ANSWER } : null;
}

// 꾸밈(부르는 말·문장부호·웃음)을 걷은 알맹이
const core = (s) => String(s || '').replace(/(?<!더)다붓(?:이|아)?(?:야|아)?/g, ' ').replace(/[!.~,…\s]+/g, ' ').replace(/(?:ㅎ|ㅋ|ㅠ|ㅜ){2,}/g, ' ').trim();

export function isAsking(q) {
  const s = String(q || '').trim().replace(/[!.~…\s]+$/, '');
  return ASKING.test(s) || REQUEST.test(s);
}

// 알려 주는 말인가 — 물음·부탁이 아니고, 이다 꼴이거나 은/는·에가 든 서술이며 내용 낱말이 둘 이상
export function isStatement(q) {
  const s = String(q || '').trim().replace(/[!.~…\s]+$/, '');
  if (!s || isAsking(s)) return false;
  if (termsOf(s).length < 2) return false;
  if (COPULA_END.test(s)) return true;
  return PLAIN_END.test(s) && INFO_PARTICLE.test(`${s} `);
}

const makerTold = (s) => !isAsking(s) && MAKE_WORD.test(s) && (SELF.test(s) || new RegExp(MAKER).test(s));
export function talkKind(q, prev = []) {
  const s = String(q || '').trim();
  if (!s) return null;
  const earlier = (Array.isArray(prev) ? prev : String(prev || '').split('\n')).map(x => String(x).trim()).filter(Boolean);
  // 부르는 말이 없어도 다른 대상이 없으면('누가 만들었어?') 다붓이 이야기다 — '이 포스터 누가 만들었어?'는 아니다
  const self = SELF.test(s) || !termsOf(s).filter(t => !MAKE_WORD.test(t)).length;
  // 다붓이를 누가 만들었나 — 앞에서 사용자가 알려 줬으면 '네, …'
  if (MAKER_ASK.test(s) && isAsking(s) && self) {
    const told = earlier.some(x => makerTold(x) && x.includes(MAKER));
    return { kind: 'self', status: 'answered', answer: told ? TALK_ANSWERS.makerKnown : TALK_ANSWERS.makerAsk };
  }
  // 만든 사람이 무엇을 했나('노준석 개발자님이 뭘 어떻게 해줬는데?' · 2026-10-05 — 업무 하나를 골라 답했다)
  if (isAsking(s) && s.includes(MAKER) && /개발자/.test(s) && /뭘|뭐|무슨|어떻게|어떤/.test(s) && /해\s?줬|해\s?준|했|만들/.test(s)) return { kind: 'self', status: 'answered', answer: TALK_ANSWERS.makerDid };
  // 만든 사람을 알려 줌('너 아빠 노준석이야' · '알아둬 다붓아 너의 개발자는 노준석이야')
  if (makerTold(s) && SELF.test(s)) {
    return { kind: 'self', status: 'answered', answer: s.includes(MAKER) ? TALK_ANSWERS.makerTold : TALK_ANSWERS.makerOther };
  }
  // 다붓이 설정 → 마음 → 신앙(인사보다 먼저 — '안녕 다붓아 나 요즘 힘들어'가 인사로 받혔다)
  const care = personaKind(s) || feelingKind(s) || faithKind(s);
  if (care) return care;
  const c = core(s);
  // '다붓이 안뇽 ?!'처럼 물음표가 붙은 인사도 인사다(2026-10-05 — 모르는 질문으로 답했다)
  if (!isAsking(s) || /^[?？]*$/.test(c) || (GREET.test(c) && c.replace(/[?？!~.\s]/g, '').length <= 6)) {
    if (THANKS.test(c) && c.length <= 30) return { kind: 'thanks', status: 'answered', answer: TALK_ANSWERS.thanks };
    if (GREET.test(c) && c.length <= 20) return { kind: 'greet', status: 'answered', answer: TALK_ANSWERS.greet };
    if (BYE.test(c) && c.length <= 15) return { kind: 'bye', status: 'answered', answer: TALK_ANSWERS.bye };
    if (PRAISE.test(c) && c.length <= 20) return { kind: 'praise', status: 'answered', answer: TALK_ANSWERS.praise };
    if (OK.test(c) && c.length <= 8) return { kind: 'ok', status: 'answered', answer: TALK_ANSWERS.ok };
    if (!c) return { kind: 'greet', status: 'answered', answer: TALK_ANSWERS.greet };   // '다붓아!'만
  }
  const off = offTopicKind(s);
  if (off) return off;
  if (isStatement(s)) return { kind: 'statement', status: 'unknown', answer: TALK_ANSWERS.statement };
  return null;
}

// 사람을 묻는 질문 — 근거에 가입자 이름·팀·직함 줄을 싣는다(묻는 사람 세션 · RLS)
const PEOPLE_Q = /누구|누가|명단|멤버|팀원|사역자|전도사|목사|교역자|팀장|인도자|싱어|가입자|담당자|들어가\s?있|소속/;
export const isPeopleQuestion = (q) => PEOPLE_Q.test(String(q || ''));

// 같은 질문 묶기 — 띄어쓰기·문장부호를 걷는다
export const normQ = (q) => String(q || '').toLowerCase().replace(/[\s?!.,~'"·…]+/g, '');

// 질문 → 찾을 낱말. 조사·어미·흔한 물음 말을 걷는다.
const STOP = new Set(['언제', '언제쯤', '어디', '어디서', '어디에', '어디로', '무슨', '어떤', '무엇', '뭐', '뭘', '누가', '누구', '어떻게', '왜', '얼마나', '있어', '있나', '해요', '했어', '하는', '나와', '알려', '알려줘', '보여', '보여줘', '주세요', '해줘', '정했', '이번', '지난', '다음', '그거', '그건', '저거', '혹시', '그리고', '근데', '파일', '자료']);
const TAIL = /(?:에서는|에서도|에서|으로|에게|처럼|보다|로|까지는|까지|부터|이에요|예요|이었어요|였어요|인가요|인가|이야|야|은요|는요|이요|은|는|이|가|을|를|에|의|도|와|과|랑|요|해요|했어요|했나요|하나요|돼요|되나요|됐어요|나요|어요|아요|죠|줘)$/;
export function termsOf(q) {
  const words = String(q || '').match(/[가-힣A-Za-z0-9]+/g) || [];
  const out = [];
  for (const w of words) {
    let t = w;
    for (let i = 0; i < 2; i++) t = t.replace(TAIL, '');
    if (t.length < 2 || STOP.has(t) || STOP.has(w)) continue;
    // 동사 꼬리('나오나요'·'나왔어요'·'있나요'·'했나요')는 찾을 낱말이 아니다 — 남으면 낱말 수만 늘어 문턱을 못 넘었다(2026-10-03)
    if (/^(나오|나왔|나와|있|없|했|됐|돼|되|하나|할|될|어떤|어떻)/.test(t) && t.length <= 3) continue;
    // 묻는 말·동사의 말투 꼴('어디소' · '언제임' · '하는딩')도 찾을 낱말이 아니다(2026-10-05 — 이어 묻는 말로 못 읽었다)
    if ((/^(어디|언제|누구|누가|뭐|무슨|몇)/.test(t) && t.length <= 4) || (/^(하는|하냐|해요|해)/.test(t) && t.length <= 3)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}


export function termWeights(hays, terms) {
  const N = Math.max(1, hays.length);
  return new Map(terms.map(t => [t, Math.log(1 + N / Math.max(1, hays.filter(h => h.includes(t)).length))]));
}


// ── 글 검사(모델 문장) ───────────────────────────────────────────────────────
// 해요체 · 대시 · 금지어(사용자가 싫어하는 말 — HANDOFF §2 16차·§8) · 근거 표시를 모델이 쓴 것.
// 사람 이름은 부르는 쪽이 따로 본다(이름 목록이 서버에만 있다).
export const BANNED_WORDS = ['협업', '소관', '계보', '사슬', '핵심', '부하', '병목', '과부하', '지지부진', '뒤처', '선행 업무'];
export function styleIssues(t) {
  const s = String(t || '').trim();
  const out = [];
  if (!/요[.!?]?$/.test(s)) out.push('해요체 아님');
  if (/[—–]/.test(s)) out.push('대시');
  // 낱말 앞에 한글이 붙어 있으면 다른 낱말이다('배부하고'의 '부하')
  for (const w of BANNED_WORDS) if (new RegExp(`(?<![가-힣])${w}`).test(s)) out.push(`금지어 ${w}`);
  if (/(?:습니다|합니다|입니다|하십시오)[.!?]?$/.test(s)) out.push('하십시오체');
  if (/없어요[.!?]?$/.test(s)) out.push('없어요 끝');
  if (/\[(?:E|S)\d+\]|\[(?:업무|주보|파일|가이드|기준):/.test(s)) out.push('근거 표시');
  return out;
}

// ── 위키 장 문장 거르기(사용자 결정 2026-10-04) ─────────────────────────────────
// 사고·잘못·징계 — 누구 탓인지 없이 부드럽게 옮기라고 했는데도 이 말이 남은 문장은 버린다(모두가 읽는 위키 · 한 사람의 사정).
// 금액도 위키 장에는 쓰지 않는다(다붓이는 공개 근거에 글자 그대로일 때만 — keepCited).
const SENSITIVE = /과실|합의금|배상|벌금|징계|사과문|경위서|(?<![가-힣])사고(?!\s?(?:예방|방지|대비))|\d[\d,]*\s?(?:만\s?|천\s?)?원|₩/;
export const sensitiveIssue = (t) => (SENSITIVE.test(String(t || '')) ? '사고·잘못·금액' : '');

// 내용 없는 문장 — '워크샵의 목적이 있어요.' · '장소가 있어요.' · '댓글로 내용을 확인했어요.'(실데이터 2026-10-04).
// 조사를 떼고 소제목 낱말(목적·장소·일시…) · 빈 동사 · 장/블록 제목에 있는 낱말을 걷으면 남는 게 없는 문장.
const HEAD_WORDS = new Set(['목적', '장소', '일시', '날짜', '내용', '개요', '일정', '시간', '주제', '대상', '준비물', '안건', '역할', '사항', '계획', '댓글', '의견', '자세한', '관련']);
const EMPTY_VERBS = /^(?:있어요|있어|적혀|확인했어요|확인해요|확인할|확인해야|예정이에요|해요|했어요|이에요|예요|있었어요|나눴어요|논의했어요|논의해요|정리했어요|정리해요)$/;
const JOSA_TAIL = /(?:에서|으로|이에요|예요|의|이|가|은|는|을|를|과|와|로|에|도|만)$/;
export function emptyClaim(sentence, titles = []) {
  const known = new Set(titles.flatMap(t => String(t || '').split(/[\s·,()<>]+/)).filter(Boolean));
  const words = String(sentence || '').replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const rest = words.map(w => w.replace(JOSA_TAIL, '')).filter(w => w && !HEAD_WORDS.has(w) && !EMPTY_VERBS.test(w) && !known.has(w)
    && ![...known].some(k => k.length >= 2 && (w === k || w.replace(JOSA_TAIL, '') === k)));
  return rest.length === 0;
}

// 근거 글에 없는 날짜 — 문장의 'M월 D일'이 근거 글(8월 2일 · 8/2 · 2026-08-02 · 08.02)에 없으면 그 날짜들.
// 조각에 단 [기록 날짜]를 행사 날짜로 옮긴 적이 있다('8월 2일에 동수교회 청소년부 수련회 집회' — 업무를 고친 날이었다 · 2026-10-04).
const dateKeys = (text) => {
  const out = new Set();
  const t = String(text || '');
  for (const m of t.matchAll(/(\d{1,2})\s?월\s?(\d{1,2})\s?일/g)) out.add(`${+m[1]}-${+m[2]}`);
  for (const m of t.matchAll(/(?<![\d.:])(\d{1,2})[/.](\d{1,2})(?![\d:])/g)) out.add(`${+m[1]}-${+m[2]}`);
  for (const m of t.matchAll(/\d{4}-(\d{2})-(\d{2})/g)) out.add(`${+m[1]}-${+m[2]}`);
  return out;
};
export function strangeDates(text, evidenceText) {
  const have = dateKeys(evidenceText);
  return [...String(text || '').matchAll(/(\d{1,2})\s?월\s?(\d{1,2})\s?일/g)].filter(m => !have.has(`${+m[1]}-${+m[2]}`)).map(m => m[0]);
}

// 같은 말인가 —띄어쓰기·문장부호를 걷어 같거나, 내용 낱말이 서로 80% 넘게 겹치면(장 소개와 첫 블록 문장이 같았다 · 2026-10-04)
const flatText = (t) => String(t || '').replace(/\*\*/g, '').replace(/[\s.,!?'"·()]+/g, '');
export function nearSame(a, b) {
  const x = flatText(a); const y = flatText(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x)))) return true;
  return tokenCoverage(a, b) >= 0.8 && tokenCoverage(b, a) >= 0.8;
}

// 모델 답의 JSON — ```json 울타리·앞뒤 말을 걷고 첫 배열/객체를 읽는다. 못 읽으면 null.
export function parseModelJson(text) {
  const m = String(text || '').replace(/```(?:json)?/g, '').trim();
  const a = m.indexOf('['); const o = m.indexOf('{');
  if (a < 0 && o < 0) return null;
  const arr = a >= 0 && (o < 0 || a < o);
  const s = arr ? m.slice(a, m.lastIndexOf(']') + 1) : m.slice(o, m.lastIndexOf('}') + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// 다붓이 답 문장 고르기 — 근거 번호가 실제로 있는 문장만, 글 검사를 지난 것만.
// evidence: [{ id:'E1', text, cite }]. 문장의 근거 칩은 그 문장이 가리킨 근거의 cite(중복 없이).
export function keepCited(sentences, evidence, extraCheck = () => []) {
  const byId = new Map(evidence.map(e => [e.id, e]));
  const kept = []; const dropped = [];
  for (const s of Array.isArray(sentences) ? sentences : []) {
    const text = String(s?.text || '').trim().replace(/\s*\[(?:E|S)\d+\]/g, '');
    const ids = (Array.isArray(s?.e) ? s.e : []).map(String).filter(id => byId.has(id));
    const issues = [...styleIssues(text), ...extraCheck(text)];
    if (!text) continue;
    if (!ids.length) { dropped.push({ text, why: '근거 없음' }); continue; }
    if (issues.length) { dropped.push({ text, why: issues.join(', ') }); continue; }
    // 금액은 그 문장이 가리킨 근거에 **글자 그대로** 있을 때만(사용자 결정 2026-10-04 · 비밀번호 첨부 내용은 근거에 오지 않는다)
    const money = strangeAmounts(text, ids.map(id => byId.get(id).text).join(' '));
    if (money.length) { dropped.push({ text, why: `근거에 없는 금액 ${money.join(', ')}` }); continue; }
    const cites = [];
    for (const id of ids) {
      const c = byId.get(id).cite;
      if (c && !cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
    }
    kept.push({ text, ids, cites });
  }
  return { kept, dropped };
}

// 금액 — '50,000원' · '3만 원' · '12000원' · '1,200,000'(천 단위 쉼표). 글의 금액 가운데 근거에 글자 그대로(빈칸 무시) 없는 것.
const AMOUNT = /\d[\d,]*(?:\.\d+)?\s?(?:만\s?|천\s?|억\s?)*원|\d{1,3}(?:,\d{3})+/g;
export function strangeAmounts(text, evidenceText) {
  const hay = String(evidenceText || '').replace(/\s+/g, '');
  return [...String(text || '').matchAll(AMOUNT)].map(m => m[0].trim()).filter(a => !hay.includes(a.replace(/\s+/g, '')));
}

// 숫자(날짜·시간·인원·회차) — 글의 숫자 가운데 근거에 **같은 숫자로** 없는 것. '11월 13~14일'은 11·13·14를 따로 본다.
// 표현은 보지 않는다(18차 2회 — '발표'↔'선출'처럼 말이 달라도 버리지 않고, 지어낸 숫자만 버린다).
export function strangeNumbers(text, evidenceText) {
  const hay = String(evidenceText || '');
  return [...new Set(String(text || '').match(/\d+/g) || [])].filter(n => !new RegExp(`(?<!\\d)0*${Number(n)}(?!\\d)`).test(hay));
}

// '찾지 못했어요' 답의 칩 — 문장에 그 근거의 이름이 나올 때만 단다(엉뚱한 칩을 막는다 · 시범 약점)
export function notFoundCites(text, cites) {
  return (cites || []).filter(c => c?.label && String(text).includes(String(c.label).replace(/\.\w+$/, '')));
}

// 모르는 질문의 답(사용자 문구 2026-10-04) — 크론이 8시(KST)에 돈다. 자주 묻는 질문 장은 마스터만 보니 그 장 이야기는 답 글에 넣지 않는다(마스터에게는 화면이 칩을 단다).
export const NOT_FOUND = '워크스페이스에서는 그런 내용을 찾을 수가 없어서, 해당 질문은 보완해서 내일 아침에 학습해 둘게요.';

// 내용 낱말 가운데 그 글에 있는 비율(0~1) — 한 줄이 문장 대부분을 덮는지 볼 때
export function tokenCoverage(sentence, text) {
  const toks = termsOf(sentence).filter(t => !/^\d+$/.test(t));
  if (!toks.length) return 0;
  const hay = String(text || '');
  return toks.filter(t => hay.includes(t)).length / toks.length;
}

// 업무 날짜를 **업무 날짜로** 밝힌다 — 행사 날짜가 아니다('가을 체육대회 개요'의 마감 10/25 ≠ 체육대회 10/31 · 사용자 지적 2026-10-03).
// 시작·마감이 다르면 '업무 기간 A~B' · 같은 하루면 '업무 날짜 A' · 마감만 있으면 '마감 A' · 시작만 있으면 '시작 A' · 없으면 ''
export function taskWhen(start, due) {
  if (start && due && start !== due) return `업무 기간 ${mdLabel(start)}~${mdLabel(due)}`;
  if (start && due) return `업무 날짜 ${mdLabel(due)}`;
  if (due) return `마감 ${mdLabel(due)}`;
  if (start) return `시작 ${mdLabel(start)}`;
  return '';
}

// ── 다붓이: 코드가 바로 답하는 데이터 질문 (사용자 결정 2026-10-04) ─────────────────
// 출석(이름 · 안 온 사람) · 생일(날짜만 · 나이·연도 없음) · 성경 구절. 모델 없이 문장을 세운다.

// 성경 구절 — '요한복음 3장 16절' · '시편 23편' · '롬 8:28' · '요 3:16-18'. books는 public/bible/index.json.
// 설교·주보·일정을 묻는 말은 구절 찾기가 아니다('사사기 17장 설교 언제야?'). 장·편·절·쌍점이 있어야 한다.
const BIBLE_NOT = /설교|주보|예배|큐시트|언제|누가|누구|QT|큐티|본문(?:은|이)?\s?(?:어디|뭐)/i;
export function bibleRefIn(q, books) {
  const s = String(q || '');
  if (!books?.length || BIBLE_NOT.test(s) || !/\d\s*(?:장|편|절|:)/.test(s)) return null;
  const re = /([가-힣]{1,8})\s*(\d{1,3})\s*(?:장|편)?\s*(?::\s*(\d{1,3})|(\d{1,3})\s*절)?(?:\s*[-~]\s*(\d{1,3})\s*절?)?/g;
  for (const m of s.matchAll(re)) {
    const v1 = m[3] || m[4];
    const ref = parseRefLite(m[1], +m[2], v1 ? +v1 : null, m[5] ? +m[5] : null, books);
    if (ref) return ref;
  }
  return null;
}
// services/bibleRef.parseRef와 같은 책 찾기(이름 · 약칭)를 이 모듈 안에서(import 0) — 낱말이 **책 이름 그대로**여야 한다
// ('사진 3장'의 '사진'은 이사야(사)가 아니다)
function parseRefLite(word, chapter, from, to, books) {
  const book = books.find(b => b.name === word || b.abbr === word);
  if (!book || chapter < 1 || chapter > (book.chapters || 999)) return null;
  return { bookId: book.id, name: book.name, chapter, from, to: from && to ? Math.max(from, to) : from };
}
// 구절 답 — 여덟 절까지 싣고, 넘으면 앞 여덟 절 + 말씀 탭 안내(사용자 결정)
export const BIBLE_MAX = 8;
export function bibleAnswer(ref, verses) {
  const unit = ref.name === '시편' ? '편' : '장';
  const label = ref.from ? `${ref.name} ${ref.chapter}:${ref.from}${ref.to && ref.to !== ref.from ? `-${ref.to}` : ''}` : `${ref.name} ${ref.chapter}${unit}`;
  const list = (verses || []).filter(v => String(v.text || '').trim());
  if (!list.length) return { status: 'unknown', sentences: [{ text: `${label} 말씀은 찾지 못했어요.`, cites: [] }], verses: [] };
  const sentences = [{ text: `${label} 말씀이에요(개역한글).`, cites: [] }];
  if (list.length > BIBLE_MAX) sentences.push({ text: `${ref.chapter}${unit} 전체는 말씀 탭에서 볼 수 있어요.`, cites: [] });
  return { status: 'answered', sentences, verses: list.slice(0, BIBLE_MAX).map(v => ({ n: `${v.chapter}:${v.verse}`, text: v.text })) };
}

// 출석을 묻는가 — 주일(예배) 출석만. 행사·모임의 참석 인원('체육대회 몇 명 왔어?')은 업무 질문이다.
const ATT_WHO = /(?:누가|누구|몇\s?명|명단|사람|인원).{0,14}(?:왔|출석|나왔|참석|결석|빠졌|빠진|안\s?(?:왔|온|나왔|나온))|(?:출석|결석|안\s?왔|안\s?온|안\s?나왔|빠진)\S*\s?(?:사람|인원|누구|누가|몇|명단|현황)|(?:출석|결석)\s?(?:현황|인원|명단|어때|어땠|했|한|알려|보여|좀)|결석자|출석자/;
const ATT_WHEN = /주일|지난\s?주|이번\s?주|오늘|예배|\d{1,2}\s?월\s?\d{1,2}\s?일|순(?:에|은|의|에서|원|에는)?(?![가-힣])/;
const ATT_EVENT = /체육대회|수련회|MT|엠티|행사|월례회|양육|캠프|워크샵|리더십|순모임|동아리|모임에|회의/;
export const isAttendanceQuestion = (q) => { const s = String(q || ''); return ATT_WHO.test(s) && ATT_WHEN.test(s) && !ATT_EVENT.test(s); };
export const asksAbsent = (q) => /안\s?(?:왔|온|나왔|나온|나와)|결석|빠졌|빠진|안\s?보였/.test(String(q || ''));
// 이름 나열 + 이에요/예요(끝 이름의 받침 · '신유리예요' · '허율이에요')
const nameList = (names) => `${names.join(', ')}${hasJong(names[names.length - 1]) ? '이에요' : '예요'}`;
// 출석 문장 — group이면 그 순(온 사람 · 안 온 사람), 없으면 청년부 전체(묻는 쪽만: 안 온 사람 또는 온 사람)
// present/absent: 이름 배열 · guests: 손님 이름 · day: '9월 27일(일)' · recorded: 그 주일에 출석이 한 줄이라도 들어왔나
export function attendanceAnswer({ day, group = '', present = [], absent = [], guests = [], recorded = true, absentAsked = false }) {
  if (!recorded) return `${day} 주일 출석은 아직 기록 전이에요.`;
  const who = [...present, ...guests.map(g => `${g}(손님)`)];
  const n = who.length;
  if (group) {
    if (!n) return `${day} 주일 ${group}에는 출석으로 체크된 사람이 아직 없어요.`;
    const head = `${day} 주일 ${group}에는 ${who.join(', ')} ${n}명이 왔어요.`;
    return absent.length ? `${head} 오지 않은 사람은 ${nameList(absent)}.` : `${head} ${group} 모두 왔어요.`;
  }
  // 청년부 전체는 다섯 넘으면 '외 N명'(순 차례 → 이름 차례로 넘겨받는다 · attendanceReply)
  if (absentAsked) {
    if (!absent.length) return `${day} 주일에는 ${n}명이 왔고 명단의 모두가 왔어요.`;
    return absent.length > NAME_LIMIT ? `${day} 주일에는 ${n}명이 왔어요. ${fewNames(absent)}이 안 왔어요.` : `${day} 주일에는 ${n}명이 왔고, 오지 않은 사람은 ${nameList(absent)}.`;
  }
  return n > NAME_LIMIT ? `${day} 주일에는 ${fewNames(who)}이 왔어요. 모두 ${n}명이에요.` : `${day} 주일에는 ${who.join(', ')} ${n}명이 왔어요.`;
}

// 생일 — '생일자' · 'N월 생일' · '이번 달 생일' · 'OO 생일 언제야'(다붓이 자신의 생일은 personaKind가 먼저 받는다)
export const isBirthdayQuestion = (q) => /생일/.test(String(q || '')) && !/축하\s?(?:해|메시지|글)|선물|파티/.test(String(q || ''));
export function birthdayMonth(q, today) {
  const s = String(q || '');
  const m = s.match(/(\d{1,2})\s?월/);
  const now = Number(String(today).slice(5, 7));
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
  if (/다음\s?달/.test(s)) return now === 12 ? 1 : now + 1;
  if (/지난\s?달/.test(s)) return now === 1 ? 12 : now - 1;
  return now;
}
// 여러 달을 한 번에 묻는 말('10월이랑 11월 생일자' · '10, 11월' · '이번 달하고 다음 달') — 나온 차례대로 · 겹치면 한 번
// (사용자 지적 2026-10-05 — 첫 달만 답했다)
export function birthdayMonths(q, today) {
  const s = String(q || '');
  const at = [];
  for (const m of s.matchAll(/(\d{1,2})(?=\s?(?:월|[,·]\s?\d{1,2}\s?월|(?:과|와|이랑|랑|하고|및|그리고)\s?\d{1,2}\s?월))/g)) if (+m[1] >= 1 && +m[1] <= 12) at.push([m.index, +m[1]]);
  for (const m of s.matchAll(/(이번|다음|지난)\s?달/g)) at.push([m.index, birthdayMonth(m[0], today)]);
  const out = [...new Set(at.sort((a, b) => a[0] - b[0]).map(x => x[1]))];
  return out.length ? out : [birthdayMonth(s, today)];
}
const mdText = (mmdd) => `${Number(mmdd.slice(0, 2))}월 ${Number(mmdd.slice(3, 5))}일`;
// list: [{ call: '홍길동 형제', mmdd: '10-12' }] → '10월 생일자는 A 형제(10월 12일), B 자매(10월 20일)예요.'(사용자 문장 그대로)
export function birthdayAnswer(month, list) {
  const mm = String(month).padStart(2, '0');
  const got = (list || []).filter(p => /^\d{2}-\d{2}$/.test(p.mmdd) && p.mmdd.startsWith(`${mm}-`)).sort((a, b) => a.mmdd.localeCompare(b.mmdd) || String(a.call).localeCompare(String(b.call), 'ko'));
  if (!got.length) return `${month}월 생일자는 명단에서 찾지 못했어요.`;
  return `${month}월 생일자는 ${got.map(p => `${p.call}(${mdText(p.mmdd)})`).join(', ')}예요.`;
}
export const birthdayOf = (p) => `${p.call}의 생일은 ${mdText(p.mmdd)}이에요.`;

// ── 이어 묻기 (사용자 결정 2026-10-04 — '지난주 누가 안 왔어?' → '그럼 콩순에서는?') ─────────────────
// 앞 질문에 기대는 짧은 물음을 **혼자 읽어도 되는 한 질문**으로 다시 쓴다. 그 뒤 갈래(출석·생일·캐시·근거)는 다시 쓴 질문으로 돈다.
// 화면에는 아무것도 더 보이지 않는다. 순서: 코드가 아는 갈래(출석 · 생일 · 팀 · 행사)는 낱말을 바꿔 끼우고(followUpRule),
// 아니면 모델 한 번(api/_wikiAsk.js resolveFollowUp) — 그 답은 followUpGuard를 지나야 쓴다(아니면 원래 질문 그대로).
// 모델 프롬프트에는 [앞 질문]을 더 싣지 않는다 — 문맥은 여기서만 들어간다(그래서 다시 쓴 질문은 그 꼴로 캐시된다).
const FOLLOW_LEAD = /^(?:그럼|그러면|그리고|그건|그거는|그거|그\s?사람(?:은|이)?|거기(?:는|도|서)?|걔(?:는|도)?|또|다른)(?![가-힣])/;
const FOLLOW_TAIL = /(?:에서는|에선|에는|이랑은|랑은|하고는|은요|는요|은|는|도)\s*[?？]?$/;
// 앞 질문의 '무엇'을 바꾸지 않는 낱말(물을 거리) — 이것만 있으면 앞 질문의 대상을 이어 붙인다('준비는 누가 해?')
const ASPECT = new Set(['준비', '담당', '담당자', '장소', '일정', '시간', '날짜', '비용', '회비', '준비물', '인원', '사람', '사람들', '순서', '내용', '주제', '결과', '진행', '신청', '마감', '팀장', '리더', '인도자', '인도', '그때', '그날', '거기', '명단', '몇명']);
const VERBISH = /^(?:왔|온|해|하|했|돼|되|됐|있|없|나왔|나와|맡|봐|볼)[가-힣]?(?:어|요|아|지|니|냐|나|까|고|는)?$/;
const stripLead = (s) => String(s || '').trim().replace(FOLLOW_LEAD, '').trim();
// 물을 거리·동사 말고 남는 내용 낱말
export const contentTerms = (q) => termsOf(q).filter(t => !ASPECT.has(t) && !['그럼', '그러면', '그건', '그거', '그거는', '다른'].includes(t) && !(t.length <= 3 && VERBISH.test(t)));
// 이어지는 물음처럼 보이는가(앞 질문이 있을 때만 부른다) — 이어 주는 말로 시작 · 12자 안의 '…은?/는?/에서는?/도?/이랑은?' · 15자 안에 내용 낱말이 없음
export function looksFollowUp(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (FOLLOW_LEAD.test(s)) return true;
  if (s.length <= 12 && FOLLOW_TAIL.test(s)) return true;
  return s.length <= 15 && !contentTerms(s).length && isAsking(s);
}
const SUN_IN = /(?:우리|내|저희|제)\s?순|[A-Za-z0-9가-힣]*[A-Za-z0-9가-힣]순(?=(?:에서는|에서|에는|에|은|는|의|도)?(?![가-힣]))/;
const SUN_PHRASE = /\s*(?:(?:우리|내|저희|제)\s?순|[A-Za-z0-9가-힣]*[A-Za-z0-9가-힣]순)(?:에서는|에서|에는|에|은|는|의)?(?![가-힣])/g;
const DAY_IN = /지난\s?주(?:일)?|이번\s?주(?:일)?|저번\s?주|오늘|\d{1,2}\s?월\s?\d{1,2}\s?일/;
const MONTH_IN = /\d{1,2}\s?월(?!\s?\d{1,2}\s?일)|이번\s?달|다음\s?달|지난\s?달|저번\s?달/;
const NOT_NAME = /^(?:오늘|내일|어제|이번|다음|지난|저번|올해|내년|작년|그럼|그거|거기)$/;
const EVENT = /(?:(?:가을|봄|여름|겨울|하계|동계|추계|춘계|리더|청년부|\d{1,2}월|다음|이번|지난)\s?)?(?:체육대회|수련회|MT|엠티|월례회|캠프|워크샵|워크숍|양육(?:\s?\d기)?|리더십\s?회의|Q예배|성찬\s?예배|금요\s?(?:열정\s?)?예배|야유회|송년회|부활절|추수감사절|성탄절|크리스마스)/i;
const tidy = (s) => String(s).replace(/\s+/g, ' ').replace(/\s+([?？,.])/g, '$1').trim();
// 이어 묻는 말 알맹이 — 이어 주는 말 · 끝 조사 · 물음표를 걷은 것('그럼 콩순에서는?' → '콩순')
const coreOf = (s) => stripLead(s).replace(/[?？!.~\s]+$/, '').replace(/(?:에서는|에선|에는|이랑은|랑은|하고는|은요|는요|은|는|도|요)$/, '').trim();
// 팀 이름(또는 앞말 '찬양')이 든 자리 — teams: 팀 이름 목록(서버는 TEAM_ORDER)
const teamAt = (s, teams) => {
  for (const t of teams) {
    if (s.includes(t)) return { team: t, word: t };
    const stem = t.replace(/팀$/, '');
    if (stem !== t && stem.length >= 2 && new RegExp(`${stem}(?!팀)`).test(s)) return { team: t, word: stem };
  }
  return null;
};

// 코드가 아는 갈래의 이어 묻기 → 다시 쓴 질문 또는 null(모델에게)
export function followUpRule(q, prevQ, { teams = [] } = {}) {
  const s = String(q || '').trim(); const p = String(prevQ || '').trim();
  if (!s || !p) return null;
  const core = coreOf(s);
  const rest = stripLead(s);
  // 출석 — 순 · 주일 · 온/안 온을 바꿔 끼운다
  if (isAttendanceQuestion(p)) {
    const sun = rest.match(SUN_IN)?.[0]?.replace(/\s+/g, ' ');
    const day = rest.match(DAY_IN)?.[0];
    const wantAbsent = /안\s?(?:온|왔|나온|나왔)|결석|빠진/.test(rest);
    const wantPresent = !wantAbsent && /(?:온|왔|나온|나왔|출석한)\s?(?:사람|애|분)/.test(rest);
    if (!sun && !day && !wantAbsent && !wantPresent) return null;
    const prevDay = p.match(DAY_IN)?.[0] || '';
    let tail = p.replace(DAY_IN, ' ').replace(SUN_PHRASE, ' ');
    if (wantAbsent && !asksAbsent(p)) tail = tail.replace(/(누가|누구)\s?(왔|나왔)/, '$1 안 $2');
    if (wantPresent && asksAbsent(p)) tail = tail.replace(/안\s?(왔|나왔|온|나온)/, '$1');
    const prevSun = sun ? '' : (p.match(SUN_IN)?.[0] || '');
    const where = sun || prevSun;
    return tidy(`${day || prevDay} ${where ? `${where}에서는` : ''} ${tail}`);
  }
  // 생일 — 달 · 사람을 바꿔 끼운다
  if (isBirthdayQuestion(p)) {
    const month = (rest.match(new RegExp(MONTH_IN.source, 'g')) || []).join('이랑 ');   // '11월이랑 12월은?' — 달을 다 옮긴다
    if (month) return MONTH_IN.test(p) ? tidy(p.replace(MONTH_IN, month)) : tidy(`${month} ${p}`);
    if (/^[가-힣]{2,4}$/.test(core) && !NOT_NAME.test(core) && !ASPECT.has(core)) return `${core} 생일은 언제예요?`;
    return null;
  }
  // 팀 — 새 팀 이름만 말했으면 앞 질문의 팀을 바꾼다('찬양팀에는 누가 있나요?' → '엔지니어팀은?')
  const newTeam = teamAt(core, teams);
  const prevTeam = teamAt(p, teams);
  if (newTeam && prevTeam && newTeam.team !== prevTeam.team && !contentTerms(core.replace(newTeam.word, '')).length) {
    return tidy(p.replace(prevTeam.word, newTeam.team));
  }
  // 행사 — 새 행사 이름만 말했으면 바꾸고, 물을 거리만 말했으면('준비는 누가 해?') 앞 질문의 행사(또는 팀)를 앞에 붙인다
  const newEvent = core.match(EVENT)?.[0];
  const prevEvent = p.match(EVENT)?.[0];
  if (newEvent && prevEvent && newEvent !== prevEvent && !contentTerms(core.replace(newEvent, '')).length) return tidy(p.replace(prevEvent, newEvent));
  if (!contentTerms(rest).length && isAsking(rest)) {
    const subject = prevEvent || prevTeam?.team;
    if (subject) return tidy(`${subject} ${rest}`);
  }
  return null;
}

// 낱말 견주기 — 빈칸·대소문자를 보지 않고, 세 글자 넘는 낱말은 끝 글자(조사 붙은 꼴)를 떼고도 본다(splitGuard · knownStatement)
const flatK = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
const hasTerm = (hay, t) => hay.includes(flatK(t)) || (t.length >= 3 && hay.includes(flatK(t.slice(0, -1))));

// ── 섞인 질문 (사용자 지적 2026-10-05 — '10월이랑 11월 생일자'·'콩순 출석이랑 생일자'에서 앞의 것만 답했다) ──────
// 갈래(출석·생일·근거 찾기)는 한 물음을 보고 정해진다. 둘 이상을 묻는 말은 혼자 서는 물음으로 나눠 따로 답하고 잇는다.
// 이 검사는 문지기만 — 나눌 만해 보이면 모델이 나누고(api/_wikiAsk.js splitCompound), 그 결과는 splitGuard를 지나야 쓴다.
// ponytail: 낱말 문지기라 '사과 '처럼 우연히 걸리면 모델 한 번이 더 든다(나누지 않고 그대로 돌려받는다).
// 묻는 말이 둘 이상('언제 어디서 해?' · '누가 언제 해?')이어도 나눌 만하다(2026-10-05 — 장소만 답했다)
const WH = [/언제|며칠|몇\s?시/, /어디/, /누가|누구/, /얼마/, /왜/];
export const looksCompound = (q) => WH.filter(r => r.test(String(q || ''))).length >= 2 || /[?？]\s*\S|그리고|(?<![가-힣])(?:및|또)(?![가-힣])|[,·]|(?:이랑|랑|하고|와|과)\s|[가-힣](?:고|며)\s/.test(String(q || '').trim());
export function splitGuard(parts, q) {
  const list = [...new Map((Array.isArray(parts) ? parts : []).map(p => String(p || '').trim()).filter(Boolean).map(p => [flatK(p), p])).values()];
  if (list.length < 2 || list.length > 3) return null;
  const hay = flatK(q);
  const digits = new Set(String(q).match(/\d+/g) || []);
  for (const p of list) {
    if (p.length > 150 || flatK(p) === hay) return null;
    if ((p.match(/\d+/g) || []).some(d => !digits.has(d))) return null;   // 없던 날짜·숫자를 만들지 않는다
    if (!contentTerms(p).some(t => hasTerm(hay, t))) return null;          // 원래 말의 낱말로 묻는다
  }
  return list;
}
// 나눈 답 잇기 — 아는 부분 먼저, 모르는 부분은 그 물음을 짚어 '찾지 못했다' 한 줄씩(모르는 것만 따로 배우게 unknownParts)
export const partNotFound = (p) => `${josa(`'${String(p).trim().replace(/[?？]+$/, '')}'`, '은', '는')} 워크스페이스에서 찾을 수가 없어서, 보완해서 내일 아침에 학습해 둘게요.`;
export function mergeParts(parts, outs) {
  const ok = outs.map((o, i) => ({ o, p: parts[i] }));
  const known = ok.filter(x => x.o.status !== 'unknown');
  const unknown = ok.filter(x => x.o.status === 'unknown');
  const sentences = known.length ? [
    ...known.flatMap(x => x.o.sentences || []),
    ...unknown.map(x => ({ text: partNotFound(x.p), cites: [] })),
  ] : [{ text: NOT_FOUND, cites: [] }];
  const files = [...new Map(known.flatMap(x => x.o.files || []).map(f => [f.id || JSON.stringify(f), f])).values()];
  return {
    status: known.some(x => x.o.status === 'answered') ? 'answered' : unknown.length ? 'unknown' : 'refused',
    sentences, files, dropped: outs.flatMap(o => o.dropped || []), parts,
    unknownParts: known.length ? unknown.map(x => x.p) : [],
    ...(outs.every(o => o.cacheable) ? { cacheable: true } : {}),
  };
}

// 이미 아는 것을 알려 준 말인가 — 내용 낱말(둘 이상)이 **근거 한 줄에 전부** 있으면 아는 말이다(저장하지 않는다 · 사용자 결정 2026-10-04 '임성빈 전도사님이야')
export function knownStatement(s, lines = []) {
  const toks = termsOf(s).filter(t => !/^\d+$/.test(t));
  if (toks.length < 2) return false;
  return (lines || []).some(l => { const hay = flatK(l); return toks.every(t => hasTerm(hay, t)); });
}

// 이름 줄이 길면 앞 다섯과 '외 N명'(사용자 결정 2026-10-04 — 청년부 전체에서 21명을 다 늘어놓았다) · 순 하나면 다 쓴다
export const NAME_LIMIT = 5;
const fewNames = (names) => (names.length > NAME_LIMIT ? `${names.slice(0, NAME_LIMIT).join(', ')} 외 ${names.length - NAME_LIMIT}명` : names.join(', '));

// ── 답 캐시 (사용자 결정 2026-10-04) ───────────────────────────────────────────
// 같은 질문(normQ)을 오늘(KST) 이미 답했고, 그 답이 마지막 데이터 변경(위키 · 고친 줄 · 업무 · 주보 · 파일) **뒤에**
// 만들어졌으면 그 답을 그대로 준다(모델을 부르지 않는다). 묻는 사람에 따라 근거가 달라지는 질문은 캐시하지 않는다:
// 사람(가입자 명단 · 세션 RLS) · 출석 · 생일 · '내·나·우리 순' · 앞 질문을 문맥으로 쓴 경우.
const ME = /(?<![가-힣])(?:내|나|나의|난|날|저|제|저의|저희|우리)(?![가-힣])|내가|제가|우리\s?순|내\s?순/;
export function cacheEligible(q, prev = '') {
  const s = String(q || '');
  if (String(prev || '').trim()) return false;
  return !isPeopleQuestion(s) && !isAttendanceQuestion(s) && !isBirthdayQuestion(s) && !ME.test(s);
}
// row: dabooti_questions 행 · stamp: 마지막 데이터 변경 시각(ISO) · today: KST 'YYYY-MM-DD'
export function cacheFresh(row, stamp, today) {
  if (!row || row.status !== 'answered' || row.feedback === 'bad' || !row.answer?.cacheable || !row.answer?.sentences?.length) return false;
  if (kstDate(row.created_at) !== today) return false;
  if (!stamp || !(new Date(row.created_at).getTime() > new Date(stamp).getTime())) return false;
  // 마스터만 보는 장(자주 묻는 질문)을 근거로 한 답은 다른 사람에게 주지 않는다
  return !row.answer.sentences.some(s => (s.cites || []).some(c => c.t === 'page' && c.id === FAQ_ID));
}

// ── 대화 수명 (사용자 결정 2026-10-04) ────────────────────────────────────────
// 앱이 떠 있는 동안(탭·화면을 오가도) 대화가 남는다. 새로 열면(새로고침 · 껐다 켜기) 비고,
// 30분 넘게 앱이 가려져 있다가 돌아와도 비운다(아이폰 홈 화면 앱은 뒤에서 살아 있어서 오래 나간 것을 떠난 것으로 본다).
export const CHAT_IDLE_MS = 30 * 60 * 1000;

// ── 바뀌는 질문 칩 (사용자 문구 2026-10-04 — 15개) ────────────────────────────────
// 갈래(사람 · 예배 · 행사 · 청년부)를 번갈아 늘어놓아 처음 셋과 다음 칩이 한 갈래에 몰리지 않게 한다.
// cueDate: 큐시트 칩의 날짜(설교 장의 마지막 주보 날 — 예전 칩과 같은 규칙) · sun: 묻는 사람의 순 이름(없으면 그 칩을 뺀다)
export function chipPool({ cueDate = '', sun = '' } = {}) {
  const groups = [
    ['찬양 인도자는 누가 하고 있나요?', '찬양팀에는 누가 있나요?', '이번 달에 생일자는 누가 있나요?', sun ? `지난 주일 ${sun}에는 누가 왔나요?` : ''],
    [cueDate ? `${mdLabel(cueDate)} 예배 큐시트는 어디에 있나요?` : '', '지난 주 설교 본문은 어디인가요?', '예배 콘티는 언제 나오나요?', '오늘 매일 성경 QT 본문은 어디인가요?'],
    ['다음 월례회는 언제 하나요?', '가을 체육대회는 언제, 어디서 하나요?', '더다붓해지는 양육 2기는 어디까지 진행되었나요?', '믿음샘 양육은 어떻게 하나요?'],
    ['엔지니어팀은 어떤 역할을 하나요?', '순모임 장소는 어디인가요?', '주보는 어디에서 볼 수 있나요?'],
  ].map(g => g.filter(Boolean));
  const out = [];
  for (let i = 0; i < 4; i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}
// 칩 한 칸 바꾸기 — slots: 지금 보이는 칩의 pool 번호들 · turn: 이번에 바꿀 칸 · next: 다음에 꺼낼 pool 번호.
// 보이는 칩과 겹치지 않는 다음 번호로 그 칸을 바꾸고 { slots, turn, next }를 돌려준다(칸은 돌아가며 · 칩은 pool을 돈다).
export function rotateChips({ slots, turn, next }, size) {
  if (size <= slots.length) return { slots, turn, next };
  let n = next % size;
  while (slots.includes(n)) n = (n + 1) % size;
  const out = slots.slice();
  out[turn % slots.length] = n;
  return { slots: out, turn: (turn + 1) % slots.length, next: (n + 1) % size };
}
export const chatExpired = (hiddenAt, now) => hiddenAt != null && now - hiddenAt >= CHAT_IDLE_MS;
