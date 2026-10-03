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
// 한 사람의 기록(출석·노트·묵상·성경 읽은 기록·기도제목) · 사람 평가 · 비밀 값과 지시 무시 요청은
// 모델을 부르지 않는다(사용자 결정 2026-10-02). 걸렸으면 { kind, answer }.
const SECRET = /이전\s?(?:지시|명령|규칙)|지시를?\s?무시|규칙을?\s?무시|무시하고|ignore\s+(?:all|previous|the)|system\s?prompt|시스템\s?프롬프트|프롬프트를|비밀\s?번호|패스워드|password|이메일|e-?mail|메일\s?주소|토큰|api\s?키|키\s?값|서비스\s?키|회원\s?(?:목록|명단)|가입자\s?(?:목록|명단)|전체\s?명단/i;
const PERSONAL = /출석|결석|안\s?(?:왔|나왔|온)\s?사람|빠진\s?사람|누가.{0,12}(?:안\s?(?:왔|나왔|했)|빠졌)|기도\s?제목|묵상|큐티|예배\s?노트|내\s?노트|성경\s?(?:읽은|읽기\s?기록)|헌금.{0,8}(?:누가|얼마)|연락처|전화\s?번호|휴대폰|생년월일|집\s?주소|사는\s?곳/i;
// 새 글을 만들어 달라는 요청(기획안·초안·공지 써 줘) — 다붓이는 기록을 찾아 알려 주고, 글을 지어 주지 않는다(2026-10-03 사용자 결정 —
// '내년 동계수련회 기획안 만들어줘'가 모르는 질문에 섰다). 자주 묻는 질문에도 서지 않는다(refused).
const MAKE = /(?:만들어|작성해|써|짜|짜서|지어|그려)\s?(?:줘|주세요|줄래|줄 수|달라)|초안\s?(?:좀|을|를)?\s?(?:만들|작성|써)/;
const JUDGE = /누가\s?(?:제일|가장|더)\s?(?:잘|못|열심|게으|늦)|(?:성실|불성실|게으른|열심인)\s?사람|순위|랭킹|평가해/i;
export const PREFILTER_ANSWERS = {
  secret: '그건 알려 드릴 수 없어요. 계정 정보와 비밀 값은 다붓이가 다루지 않아요.',
  personal: '출석이나 노트, 묵상 같은 한 사람 한 사람의 기록은 다붓이가 다루지 않아요.',
  judge: '사람을 서로 견주거나 평가하는 질문은 다붓이가 다루지 않아요.',
  make: '다붓이는 기록에서 찾아 알려 드려요. 새 글을 만들어 드리지는 않아요.',
};
export function prefilter(q) {
  const s = String(q || '');
  const kind = SECRET.test(s) ? 'secret' : PERSONAL.test(s) ? 'personal' : JUDGE.test(s) ? 'judge' : MAKE.test(s) ? 'make' : null;
  return kind ? { kind, answer: PREFILTER_ANSWERS[kind] } : null;
}

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
    rows.push({ hay: `${p.title} ${b.title || ''} ${it.meta?.q || ''} ${it.meta?.team || ''} ${it.meta?.time || ''} ${it.text}`, p, b, it });
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
    const cites = [];
    for (const id of ids) {
      const c = byId.get(id).cite;
      if (c && !cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
    }
    kept.push({ text, ids, cites });
  }
  return { kept, dropped };
}

// '찾지 못했어요' 답의 칩 — 문장에 그 근거의 이름이 나올 때만 단다(엉뚱한 칩을 막는다 · 시범 약점)
export function notFoundCites(text, cites) {
  return (cites || []).filter(c => c?.label && String(text).includes(String(c.label).replace(/\.\w+$/, '')));
}

export const NOT_FOUND = '기록에서 찾지 못했어요. 이 질문은 위키의 자주 묻는 질문에 남겨 둘게요.';

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
