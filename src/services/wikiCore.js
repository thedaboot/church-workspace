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
const NOTE = /묵상|큐티|예배\s?노트|내\s?노트|(?:누구|남|다른\s?사람)의?\s?노트|성경\s?(?:읽은|읽기\s?기록)/i;
const CONTACT = /연락처|전화\s?번호|휴대폰|핸드폰|생년월일|집\s?주소|사는\s?곳/i;
const PRIVATE = /기도\s?제목|헌금.{0,8}(?:누가|얼마)|(?:개인|집안|가정|그\s?사람|걔)\s?(?:의\s?)?(?:사정|형편|문제)|왜\s?(?:안\s?나와|안\s?와|그만뒀|나갔)/i;
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
  judge: '사람을 서로 견주거나 평가하는 건 다붓이가 하지 않아요.',
  // 사용자 문구(2026-10-04) — 거른 답(refused)이라 자주 묻는 질문에 서지 않는다
  make: '아직은 무언가를 만들어 드리기 어려워요. 가능해지면 꼭 말씀드릴게요.',
};
export function prefilter(q) {
  const s = String(q || '');
  const kind = OVERRIDE.test(s) ? 'override' : SECRET.test(s) ? 'secret' : NOTE.test(s) ? 'note' : CONTACT.test(s) ? 'contact'
    : PRIVATE.test(s) ? 'private' : JUDGE.test(s) ? 'judge' : MAKE.test(s) ? 'make' : null;
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
  greet: '안녕하세요! 궁금한 게 있으면 편하게 물어봐 주세요.',
  thanks: '도움이 됐다니 기뻐요! 또 궁금한 게 있으면 물어봐 주세요.',
  praise: '칭찬해 주셔서 고마워요! 더 잘 찾아 볼게요.',
  ok: '네, 좋아요! 또 궁금한 게 있으면 물어봐 주세요.',
  bye: '네, 다음에 또 만나요! 좋은 하루 보내세요.',
  statement: '알려 주셔서 고마워요! 정리해서 내일 아침에 학습해 둘게요.',
};
// 다붓이를 부르는 말 — '더다붓'(청년부 이름)은 아니다
const SELF = /(?<![가-힣])(?:너|넌|너는|너를|너의|니|니가|네가|당신)(?![가-힣])|(?<!더)다붓(?:이|아)/;
const MAKE_WORD = /만들|만든|개발|제작|창조|아빠|아버지|엄마|어머니|부모|주인|창시/;
const MAKER_ASK = /(?:누가|누구).{0,10}(?:만들|만든|개발|제작|창조)|(?:만든|만들어\s?준|개발한|제작한)\s?(?:사람|분|이|애)|(?:개발자|제작자|아빠|아버지|엄마|어머니|부모|주인).{0,6}(?:누구|누가|뭐)/;
// 물음 — 물음표 · 물음 말 · 부탁(…줘)은 알려 주는 말이 아니다
const ASKING = /[?？]|언제|어디|누구|누가|뭐|뭘|무엇|무슨|어떤|어떻|어때|어땠|왜|몇|얼마|어느|알려|보여|찾아|궁금|있나|있니|없나|인가|인지|일까|는지|던가|맞아|맞나|맞죠|맞지|(?:니|냐|나요|까요|까|ㄹ까|가요|나|래요|대요)$/;
const REQUEST = /줘|주세요|주실|줄래|줄 수|달라|해\s?봐/;
// 알려 주는 말의 꼴 — ① 이름·말 + 이다(…이야 · …예요) ② 은/는·에·까지·부터가 든 서술(…송폼은 금요일에 나와)
const COPULA_END = /(?:이야|야|이에요|예요|에요|입니다|이다|이래|이거든|거든|이잖아|잖아|임)$/;
const PLAIN_END = /(?:와|와요|해|해요|돼|돼요|어|어요|아|아요|다|요|함|음|네|지)$/;
const INFO_PARTICLE = /[가-힣A-Za-z0-9](?:은|는|에|에서|까지|부터|이랑|랑)\s/;
const GREET = /^(?:안녕|하이|hi|hello|헬로|ㅎㅇ|반가워|반갑|좋은\s?(?:아침|하루|저녁))/i;
const THANKS = /고마|감사|땡큐|thank|thx|ㄳ|ㄱㅅ/i;
const PRAISE = /잘했|잘하네|잘한다|최고|똑똑|귀여|귀엽|대단|멋져|멋지|짱|사랑해|천재/;
const OK = /^(?:응|ㅇㅇ|ㅇㅋ|오케이|ok|알겠|알았|그래|넵|네|예|좋아|좋네|ㅎㅎ|ㅋㅋ)/i;
const BYE = /^(?:잘\s?가|바이|bye|다음에\s?(?:봐|또)|또\s?봐|수고)/i;

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
  // 만든 사람을 알려 줌('너 아빠 노준석이야' · '알아둬 다붓아 너의 개발자는 노준석이야')
  if (makerTold(s) && SELF.test(s)) {
    return { kind: 'self', status: 'answered', answer: s.includes(MAKER) ? TALK_ANSWERS.makerTold : TALK_ANSWERS.makerOther };
  }
  const c = core(s);
  if (!isAsking(s) || /^[?？]*$/.test(c)) {
    if (THANKS.test(c) && c.length <= 30) return { kind: 'thanks', status: 'answered', answer: TALK_ANSWERS.thanks };
    if (GREET.test(c) && c.length <= 20) return { kind: 'greet', status: 'answered', answer: TALK_ANSWERS.greet };
    if (BYE.test(c) && c.length <= 15) return { kind: 'bye', status: 'answered', answer: TALK_ANSWERS.bye };
    if (PRAISE.test(c) && c.length <= 20) return { kind: 'praise', status: 'answered', answer: TALK_ANSWERS.praise };
    if (OK.test(c) && c.length <= 8) return { kind: 'ok', status: 'answered', answer: TALK_ANSWERS.ok };
    if (!c) return { kind: 'greet', status: 'answered', answer: TALK_ANSWERS.greet };   // '다붓아!'만
  }
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
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// 위키 줄 찾기 — 낱말이 몇 개 걸리는가(장 제목·블록 제목·질문도 본다)
// 낱말마다 무게를 매긴다 — 위키 줄 가운데 드물게 나오는 낱말일수록 무겁다(log(1 + 줄 수 / 나온 줄 수)).
// '예배'처럼 어디에나 있는 말이 '송폼' 줄을 밀어내던 것을 막는다(2026-10-03). score는 걸린 낱말 무게의 합, n은 걸린 낱말 수.
export function scoreWikiItems(pages, terms) {
  const hits = [];
  if (!terms.length) return hits;
  const rows = [];
  for (const p of pages || []) for (const b of p.blocks || []) for (const it of b.items || []) {
    if (!String(it.text || '').trim()) continue;
    // 띄어 쓴 글도 붙여 쓴 질문 낱말에 걸리게 붙인 글을 덧붙인다 — '찬양인도자 누구야'가 '찬양 인도자는 …' 줄을 못 찾았다(2026-10-04)
    const hay = `${p.title} ${b.title || ''} ${it.meta?.q || ''} ${it.meta?.team || ''} ${it.meta?.time || ''} ${it.text}`;
    rows.push({ hay: `${hay} ${String(it.text).replace(/\s+/g, '')}`, p, b, it });
  }
  const w = termWeights(rows.map(r => r.hay), terms);
  for (const r of rows) {
    const got = terms.filter(t => r.hay.includes(t));
    if (got.length) hits.push({ score: got.reduce((s, t) => s + w.get(t), 0), n: got.length, page: r.p, block: r.b, item: r.it });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
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

// '찾지 못했어요' 답의 칩 — 문장에 그 근거의 이름이 나올 때만 단다(엉뚱한 칩을 막는다 · 시범 약점)
export function notFoundCites(text, cites) {
  return (cites || []).filter(c => c?.label && String(text).includes(String(c.label).replace(/\.\w+$/, '')));
}

// 모르는 질문의 답(사용자 문구 2026-10-04) — 크론이 8시(KST)에 돈다. 자주 묻는 질문 장은 마스터만 보니 그 장 이야기는 답 글에 넣지 않는다(마스터에게는 화면이 칩을 단다).
export const NOT_FOUND = '워크스페이스에서는 그런 내용을 찾을 수가 없어서, 해당 질문은 보완해서 내일 아침에 학습해 둘게요.';

// 문장이 근거에 글자 그대로 기대는가 — 내용 낱말(termsOf 규칙 · 조사·물음 말 걷음)이 **셋 이상이고 전부** 근거 글에 있으면 true.
// 다붓이 답의 코드 검사(api/_wikiAsk.js) — 참이면 모델 검사를 건너뛴다. 낱말이 적은 문장은 모델이 본다(관계가 틀릴 여지).
export function groundedIn(sentence, evidenceText) {
  const toks = termsOf(sentence).filter(t => !/^\d+$/.test(t));
  const hay = String(evidenceText || '').replace(/\s+/g, ' ');
  // 끝 한 글자를 뗀 꼴도 같은 낱말로 본다('파일로' · '결산안이' — 조사가 덜 떨어진 경우)
  return toks.length >= 3 && toks.every(t => hay.includes(t) || (t.length >= 3 && hay.includes(t.slice(0, -1))));
}
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
