import { SEED_PAGES } from '../src/services/wikiCore.js';
import { sha } from './_wiki/const.js';
import { gather } from './_wiki/gather.js';
import { nameMatcher, peopleIndex } from './_wiki/people.js';
import { skeletons } from './_wiki/skeleton.js';
import { faqPage } from './_wiki/faq.js';
import { fillPage, srcHashOf } from './_wiki/fill.js';

// ============================================================================
// 더다붓 위키 만들기 — 매일 8시 크론(api/push.js) · scripts/wiki-build.mjs가 같이 쓰는 한 벌 (0088 · 16차)
// ----------------------------------------------------------------------------
// 시범(레포 밖 wiki-pilot/v2)에서 배운 대로 **사실은 코드가, 묶음 내용만 모델이** 쓴다:
//   · 날짜·상태·팀·앞뒤 업무는 화면 요소(블록 제목·상태 칩·근거 칩)로 코드가 세운다.
//   · 모델은 업무 본문·하위 업무·댓글·가이드에서 뽑은 조각(S1…)만 보고 블록마다 두세 문장을 쓴다.
//     문장마다 어느 조각에서 왔는지 적게 하고, 두 번째 호출이 '근거에 없는 주장'만 찾아 걸러 낸다.
//   · 사람 이름은 써도 된다(사용자 결정 2026-10-04) — 다만 **그 블록 조각에 있는 이름만**. 조각에 없는 이름이 든 문장은 코드가 버린다
//     (nameMatcher.strangers). 사람을 견주거나 평가하는 말은 여전히 쓰지 않는다(§8).
// 자가 개선: 사람이 고친 문장(wiki_edits의 before → text)을 '사람이 고친 예'로 프롬프트에 싣는다 —
//   다음에 다시 쓸 때 그 말투와 표현을 따른다. 사람이 지운 문장은 '쓰지 말 것'이다.
//   고친 줄 자체는 다시 모아도 덮지 않는다(화면이 겹쳐 그린다 · wikiCore.overlayEdits).
// 다시 모으기: 장마다 원본 해시(src_hash)를 남기고 같으면 모델을 부르지 않는다 — 매일 도는 크론의 대부분.
// 쓰지 않는 데이터: 출석 · 예배 노트 · QT 묵상(나눈 것도) · 성경 읽은 기록 · 비밀번호 첨부 내용 ·
//   '2026 워크스페이스 개선'(앱 개발) · '회계'(돈 · 정본은 그 프로젝트의 메뉴얼 업무).
//
// 이 파일은 한 번 돌기(buildWiki)와 바깥에 내보이는 이름만 — 몸통은 api/_wiki/에 나눠 있다(19차 · `_`라 라우트가 아니다):
//   const.js 공용 값(모델 · 팀 순서 · 순장 표시 · 해시) · gen.js Gemini 한 번 · people.js 사람 이름·부르는 꼴·댓글 줄·명단 ·
//   text.js 글 조각(본문 → 조각) · gather.js 원본 읽기 · excerpt.js 블록 하나·바뀌기 전·정보 상자·정해지기까지 ·
//   skeleton.js 장 뼈대 · faq.js 자주 묻는 질문 장 · fill.js 모델로 채우기(쓰기·검사 프롬프트 · 원본 해시)
// ============================================================================

export { WIKI_MODEL, sha, TEAM_ORDER, AUDIENCE } from './_wiki/const.js';
export { gen, SCHEMA } from './_wiki/gen.js';
export { nameMatcher, peopleIndex, commentLine, rosterOf } from './_wiki/people.js';
export { fillIn, snippetsOf } from './_wiki/text.js';
export { gather } from './_wiki/gather.js';
export { projectTitle, recordDate, finishedTask, foldGap, supersededSnips, eventInfo, recurringLead, decideSnips } from './_wiki/excerpt.js';
export { skeletons } from './_wiki/skeleton.js';
export { answeredToday, faqPage } from './_wiki/faq.js';
export { examplesFromEdits, wikiSentenceIssues, phantomExtra, dropRepeats, fillPage, srcHashOf } from './_wiki/fill.js';

// ── 한 번 돌기 ───────────────────────────────────────────────────────────────
// budgetMs 안에서만 모델을 부른다(크론 60초 · 나머지는 다음 날). force면 해시를 보지 않는다.
// 바뀐 것: { built:[id], skipped:n, pending:[id], removed:[id], faq, usage, dropped }
export async function buildWiki(db, { budgetMs = 200 * 1000, force = false, only = null, concurrency = 3, today } = {}) {
  const started = Date.now();
  const log = [];
  const D = await gather(db, today);
  const hasName = nameMatcher(D.names);
  D.people = peopleIndex(D.roster);
  const prev = new Map(D.pages.map(p => [p.id, p]));
  const now = new Date().toISOString();

  // 함께 쓰는 글 — 없을 때만 심는다(그 뒤로는 사람이 고친다)
  const seeds = SEED_PAGES.filter(p => !prev.has(p.id)).map(p => ({ ...p, source: null, source_count: 0, built_at: now }));
  if (seeds.length) { const { error } = await db.from('wiki_pages').insert(seeds); if (error) throw new Error(`seed: ${error.message}`); }

  const pages = skeletons(D).filter(p => !only || only.includes(p.id));
  const built = []; const pending = []; let skipped = 0; const dropped = {};
  const queue = [];
  for (const pg of pages) {
    const h = srcHashOf(pg);
    if (!force && prev.get(pg.id)?.src_hash === h) { skipped++; continue; }
    queue.push({ pg, h });
  }
  const run = async ({ pg, h }) => {
    if (Date.now() - started > budgetMs) { pending.push(pg.id); return; }
    try {
      const out = await fillPage(pg, { edits: D.edits, hasName, log, people: D.people });
      const row = { id: pg.id, grp: pg.grp, title: pg.title, kind: 'auto', position: pg.position, source: pg.source, source_count: pg.source_count, blocks: out.blocks, src_hash: h, built_at: new Date().toISOString() };
      const { error } = await db.from('wiki_pages').upsert(row);
      if (error) throw new Error(error.message);
      built.push(pg.id);
      if (out.dropped.length) dropped[pg.id] = out.dropped;
    } catch (e) {
      console.error('[wiki] 장 만들기 실패:', pg.id, e?.message || e);
      pending.push(pg.id);
    }
  };
  for (let i = 0; i < queue.length; i += concurrency) await Promise.all(queue.slice(i, i + concurrency).map(run));

  // 원본이 사라진 자동 장(지운 프로젝트 · 팀에 업무가 없어짐)은 걷는다. 일부만 돈 날(only)은 건드리지 않는다.
  const removed = [];
  if (!only) {
    const keep = new Set([...pages.map(p => p.id), 'faq']);
    const gone = D.pages.filter(p => p.kind === 'auto' && !keep.has(p.id)).map(p => p.id);
    if (gone.length) { const { error } = await db.from('wiki_pages').delete().in('id', gone); if (!error) removed.push(...gone); }
  }

  // 자주 묻는 질문은 언제나 다시(모델 없음)
  let faq = null;
  if (!only || only.includes('faq')) {
    const fp = faqPage(D);
    const { error } = await db.from('wiki_pages').upsert({ ...fp, src_hash: sha(JSON.stringify(fp.blocks)), built_at: new Date().toISOString() });
    faq = error ? `실패: ${error.message}` : `${fp.blocks[0].items.length}+${fp.blocks[1].items.length}`;
  }
  const usage = log.reduce((a, u) => ({ calls: a.calls + 1, input: a.input + u.input, output: a.output + u.output }), { calls: 0, input: 0, output: 0 });
  return { built, skipped, pending, removed, faq, usage, dropped, ms: Date.now() - started };
}
