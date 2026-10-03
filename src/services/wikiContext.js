import { loadWiki } from './wiki.js';
import { WIKI_GROUPS, FAQ_ID, overlayEdits, overlayTitles, stripBold, termsOf, termWeights, mdLabel, withTeamCards } from './wikiCore.js';

// ============================================================================
// 위키 → 다른 AI 기능의 맥락 (17차 · 사용자 결정 2026-10-04)
// ----------------------------------------------------------------------------
// 더다붓 위키는 마스터만 고치고 교회 맥락의 정본이 됐다. 3줄 요약 · AI 문맥 다듬기(services/ai.js) ·
// 순모임 가이드(services/sunGuide.js)는 그동안 ai.js의 상수(ORG_CONTEXT 등)만 봐서, 마스터가 위키에
// 적은 새 사실(리더팀장·리더순장 · 인도자 돌림 · 콘티·송폼이 나오는 때)이 닿지 않았다.
// 여기서 **위키 전체**(함께 쓰는 글만이 아니라 팀·행사·예배 장까지)에서 그 업무·주보에 맞는 줄만 고른다.
//   pickWikiContext(query, { pages, edits, … })  순수 · 결정적 → '[찬양팀] …' 줄들('' = 고를 것 없음)
//   wikiContextFor(query, opts)                   읽기(10분 쥔다 · 1.5초에 끊는다) + 고르기 → 블록 글('' = 없음)
//   heldWikiStamp()                               쥔 위키의 마지막 고친 때 — 요약 캐시 열쇠에 넣는다
// 사람이 고친 문장은 화면과 같은 규칙으로 겹친다(wikiCore.overlayEdits — 같은 열쇠는 글을 바꾸고, 빈 글은 지운 줄,
// 열쇠가 없는 줄은 더한 줄). 굵게 별표는 걷는다(stripBold). 자주 묻는 질문 장 · 업무 제목만 늘어놓은 칸(chips·gap) ·
// 표(rows)·QT·찬양 목록은 싣지 않는다. 못 읽으면 ''이고, 부르는 쪽은 상수만으로 돈다(게스트 · 실패).
// ============================================================================

export const WIKI_CONTEXT_LIMIT = 1200;
export const WIKI_CONTEXT_TITLE = '[더다붓 위키에서 고른 맥락(마스터가 확인한 글 · 업무 내용과 다르면 업무를 따른다)]';
const WIKI_TTL_MS = 10 * 60 * 1000;
const WIKI_WAIT_MS = 1500;
const PER_PAGE = 4;              // 한 장이 칸을 다 채우지 않게(함께 쓰는 글로 몰리지 않게)
const PINNED_MAX = 3;            // 업무 팀의 소개 줄
const LINE_MAX = 220;
const LINES_MAX = 12;           // 칸이 남아도 약한 줄로 채우지 않는다
const QUERY_MAX = 600;           // 본문은 앞만 본다 — 긴 회의록의 흔한 낱말이 줄을 고르지 않게
const TEXT_TYPES = new Set(['hero', 'list', 'plain', 'teams', 'timeline', 'section', 'sermon']);
// 워크스페이스 사용법(guide)은 앱 쓰는 법이라 업무 요약·다듬기·가이드의 맥락이 아니다(다붓이만 읽는다 · 2026-10-04)
const SKIP_PAGES = new Set([FAQ_ID, 'qt', 'songs', 'guide']);

const flat = (t) => stripBold(t).replace(/\s+/g, ' ').trim();
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// 장 차례 — DB가 주는 순서는 정해져 있지 않다(결정적으로 고르려고 묶음 · 자리 · id로 줄 세운다)
const pageOrder = (a, b) => {
  const ga = WIKI_GROUPS.indexOf(a.grp); const gb = WIKI_GROUPS.indexOf(b.grp);
  return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
};

function lineLabel(page, block, item) {
  if (item.meta?.team) return item.meta.team;
  const parts = [page.title];
  if (block.title && block.title !== page.title) parts.push(block.title);
  if (block.meta?.date) parts.push(mdLabel(block.meta.date));
  if (item.meta?.time) parts.push(item.meta.time);
  return parts.filter(Boolean).join(' · ');
}

// 겹친 지금 모습의 줄 전부 — [{ order, page, label, text, hay, human }]
export function wikiRows(pages = [], edits = [], { exclude = [] } = {}) {
  const skipBlock = new Set(exclude);
  const by = new Map();
  for (const e of edits || []) { if (!by.has(e.page_id)) by.set(e.page_id, []); by.get(e.page_id).push(e); }
  const rows = [];
  // 사람이 고치거나 지운 글의 옛 모습 — 다른 장에 같은 글이 그대로 남아 있으면 그 줄도 싣지 않는다
  // (팀 장의 소개 줄은 함께 쓰는 글 초안을 베낀 것이라, 마스터가 '더다붓 소개 › 팀'을 고쳐도 옛 글이 같이 실렸다 · 실데이터 2026-10-04)
  const stale = new Set((edits || []).map(e => flat(e.before)).filter(Boolean));
  // 팀 장 소개 줄은 더다붓 소개 › 팀 카드의 지금 글(wikiCore.withTeamCards)
  const now = withTeamCards([...(pages || [])].sort(pageOrder).map(raw => { const pe = by.get(raw.id) || []; const o = overlayTitles(raw, pe); return { ...o, blocks: overlayEdits(o.blocks, pe) }; }));
  for (const p of now) {
    if (SKIP_PAGES.has(p.id)) continue;
    for (const b of p.blocks) {
      if (!TEXT_TYPES.has(b.type) || skipBlock.has(b.key)) continue;
      for (const it of b.items || []) {
        const text = flat(it.text);
        if (!text || (!it.edit && stale.has(text))) continue;
        const label = flat(lineLabel(p, b, it));
        rows.push({ order: rows.length, page: p.id, block: b.key, team: it.meta?.team || '', label, text, hay: `${label} ${p.title} ${b.title || ''} ${text}`, human: !!(it.edit || it.by === 'human') });
      }
    }
  }
  return rows;
}

// 찾을 낱말 — 숫자·날짜 조각('9월'·'2026')은 뺀다(어느 줄에나 있어 엉뚱한 줄을 끌어온다)
const queryTerms = (query) => termsOf(String(query || '').slice(0, QUERY_MAX * 2)).filter(t => !/^\d+(?:월|일|년|시|분|명|개|주)?$/.test(t));

// query: 업무 제목·본문 앞·팀·프로젝트 이름(요약·다듬기) · 설교 제목·본문 구절·찬양(가이드)
// teams: 이 업무의 팀 — 그 팀 소개 줄을 맨 앞에 둔다(위키 '더다붓 소개 › 팀'이나 그 팀 장의 소개 줄 · 최대 셋)
// exclude: 블록 열쇠(그 업무 자신의 장 블록 'c:<id>' · 그 주보 's:<id>' — 같은 글을 되먹이지 않는다)
export function pickWikiContext(query, { pages = [], edits = [], limit = WIKI_CONTEXT_LIMIT, teams = [], exclude = [] } = {}) {
  const rows = wikiRows(pages, edits, { exclude });
  if (!rows.length) return '';
  const out = []; const seen = new Set(); const perPage = new Map();
  let used = 0;
  const take = (r) => {
    const line = `[${r.label}] ${cut(r.text, LINE_MAX)}`;
    if (seen.has(r.text) || out.length >= LINES_MAX || used + line.length + 1 > limit) return false;
    seen.add(r.text); out.push(line); used += line.length + 1;
    perPage.set(r.page, (perPage.get(r.page) || 0) + 1);
    return true;
  };
  // ① 업무 팀의 소개 줄 — 함께 쓰는 글의 팀 칸이 먼저(마스터가 고친 글), 없으면 그 팀 장의 첫 줄
  let pinned = 0;
  for (const team of [...new Set((teams || []).filter(Boolean))]) {
    if (pinned >= PINNED_MAX) break;
    const r = rows.find(x => x.team === team) || rows.find(x => x.page === `team:${team}`);
    if (r && take(r)) pinned++;
  }
  // ② 드문 낱말에 무게(wikiCore.termWeights — 다붓이와 같은 셈). 사람이 고친·더한 줄은 조금 더 무겁다(마스터가 확인한 글).
  const terms = queryTerms(query);
  if (terms.length) {
    const w = termWeights(rows.map(r => r.hay), terms);
    const scored = rows.map(r => {
      // 글에 든 낱말이 온 무게, 장·블록 제목에만 든 낱말은 반 무게 — 제목 하나로 그 장의 줄이 줄줄이 끌려오지 않게
      const s = terms.reduce((sum, t) => sum + (r.text.includes(t) ? w.get(t) : r.hay.includes(t) ? w.get(t) / 2 : 0), 0);
      return { r, s: s * (r.human ? 1.5 : 1) };
    }).filter(x => x.s > 0);
    scored.sort((a, b) => b.s - a.s || a.r.order - b.r.order);
    const top = scored[0]?.s || 0;
    for (const { r, s } of scored) {
      if (s < top * 0.4 || out.length >= LINES_MAX) break;
      if ((perPage.get(r.page) || 0) >= PER_PAGE) continue;
      take(r);
    }
  }
  return out.join('\n');
}

// 그 줄들을 프롬프트 블록으로 — 줄이 없으면 ''(상수만으로 돈다)
// note: 머리 아래 한 줄 — 요약·다듬기는 상수 배경과 부딪히면 위키가 이긴다는 것(기본), 가이드는 참고일 뿐이라는 것
export const WIKI_NOTE_OVER_CONSTANTS = '- 아래 줄이 시스템 안내의 배경 지식(조직·일정)과 다르면 이 줄을 따른다.';
export function wikiBlock(lines, note = WIKI_NOTE_OVER_CONSTANTS) {
  if (!String(lines || '').trim()) return '';
  return [WIKI_CONTEXT_TITLE, note, lines].filter(Boolean).join('\n');
}

// 쥔 위키의 마지막으로 바뀐 때(장 updated_at · 고친 줄 edited_at 가운데 가장 늦은 것)
export function wikiStampOf(pages = [], edits = []) {
  let s = '';
  for (const p of pages || []) if (String(p.updated_at || p.built_at || '') > s) s = String(p.updated_at || p.built_at || '');
  for (const e of edits || []) if (String(e.edited_at || '') > s) s = String(e.edited_at || '');
  return s;
}

// ── 읽기 · 10분 쥔다(ai.js의 명단과 같은 방식) ─────────────────────────────────
let memo = null;          // { at, value: { pages, edits, stamp } }
let inflight = null;
export const setWikiMemo = (value, at = Date.now()) => { memo = value ? { at, value: { ...value, stamp: value.stamp ?? wikiStampOf(value.pages, value.edits) } } : null; inflight = null; };
const fresh = (now) => memo && now - memo.at < WIKI_TTL_MS;
function startLoad(now) {
  if (!inflight) {
    inflight = Promise.resolve().then(() => loadWiki())
      .then(({ pages = [], edits = [] } = {}) => { setWikiMemo({ pages, edits }, now); return memo.value; })
      .catch((e) => { console.warn('[wikiContext] 위키를 읽지 못해 상수만으로 부른다:', e?.message || e); return null; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}
// → { pages, edits, stamp } | null. 1.5초 안에 못 읽으면 null이고(AI를 오래 붙잡지 않는다), 읽기는 뒤에서 마저 끝나 다음 부름이 쓴다.
export async function loadWikiForAi({ now = Date.now(), wait = WIKI_WAIT_MS } = {}) {
  if (fresh(now)) return memo.value;
  let timer;
  try {
    return await Promise.race([
      startLoad(now),
      new Promise((resolve) => { timer = setTimeout(() => resolve(memo?.value || null), wait); }),
    ]);
  } finally { clearTimeout(timer); }
}
// 요약 캐시 열쇠용 — 기다리지 않는다. 쥔 것이 오래됐으면 뒤에서 다시 읽기만 걸어 둔다.
export function heldWikiStamp(now = Date.now()) {
  if (!fresh(now)) startLoad(now);
  return memo?.value?.stamp || '';
}

// 읽기 + 고르기 + 블록. 어떤 실패도 ''다.
export async function wikiContextFor(query, opts = {}) {
  try {
    const w = await loadWikiForAi(opts);
    if (!w) return '';
    return wikiBlock(pickWikiContext(query, { ...opts, pages: w.pages, edits: w.edits }), opts.note);
  } catch (e) {
    console.warn('[wikiContext] 맥락을 고르지 못했다:', e?.message || e);
    return '';
  }
}
