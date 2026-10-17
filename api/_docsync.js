import { EMBED_MODEL, EMBED_DIM, unitVec } from './ai.js';
import { sha256, geminiFetch, isTimeout } from './_lib.js';
import { mdLabel } from '../src/services/wikiCore.js';
import { wikiEvidence, pageBody, serviceText } from './_wiki/evidence.js';
import { dropLocked } from '../src/services/cardLock.js';
import { dropTrashed } from '../src/services/trashItems.js';
import { trashedIds } from './_trash.js';

// ============================================================================
// 업무·댓글·첨부 → doc_vec(0074) 증분 동기화 — 크론과 스크립트가 같이 쓰는 한 벌 (배치 E4)
// ----------------------------------------------------------------------------
// 부르는 곳 셋: api/push.js의 8시 크론(마감 임박 알림 **뒤에**, 시간 예산 안에서만) ·
// `/api/push?job=embed`(손으로 부르는 길 · 같은 CRON_SECRET) · scripts/embed-docs.mjs(로컬 · 드라이런).
// 이름이 `_`로 시작해 라우트가 아니다(api/_lib.js 머리말).
//
// **모델·차원·정규화는 api/ai.js에서 가져온다**(질문 쪽 · 성경 쪽과 한 벌). ai.js를 import해도
// 딸려 오는 것은 _lib.js뿐이고 push.js가 이미 그것을 물고 있다 — 상수를 따로 `_embed.js`로
// 옮기면 scripts/embed-bible.mjs와 tests/logcheck의 import 자리까지 같이 바뀌어 얻는 것이 없다.
//
// 흐름: 원본을 읽는다 → 조각(글 + sha256)을 만든다 → doc_vec의 (kind, source_id, chunk, hash)와
// 견준다 → 해시가 다른 것만 임베딩해 upsert · 원본은 있는데 조각이 줄어든 행은 지운다 · 해시는
// 같은데 업무가 다른 프로젝트로 옮긴 행은 project_id만 고친다. **원본이 지워진 것은 FK cascade가
// 이미 지웠다.** 조각 글이 그대로면 아무것도 안 부른다 — 매일 도는 크론의 대부분이 이 갈래다.
//
// 넣지 않는 것: 주보에 딸린 첨부(service_id — 작성 중 주보의 파일은 편집자만 본다) · 발췌가 빈
// 첨부 · 개인 표(service_notes·qt_entries — 공유 규칙이 사람마다 다르다). 이유는 0074 머리말.
//
// 20차 ②(2026-10-12 · 0096): 다붓이 검색 모드(api/_wikiAsk.js DABOOTI_RETRIEVE)가 근거를 좁히려고 **위키 장**(wiki · 자주 묻는
// 질문 장은 빼고 · 사람이 고친 글 겹침)과 **발행된 주보**(service · 설교·찬양·광고 + 딸린 파일 이름 — 발췌는 안 싣는다)를 더했다.
// 글은 다붓이가 모델에 싣는 기록과 같은 글이다(api/_wiki/evidence.js). 0096 전이면(page_id 칸이 없다) 두 종류는 건너뛴다.
// ============================================================================

export const TASK_TYPE = 'RETRIEVAL_DOCUMENT';
export const EMBED_BATCH = 100;        // batchEmbedContents 한 번의 상한
export const UPSERT_BATCH = 100;       // 한 번 임베딩한 묶음을 바로 쓴다(시간이 끊겨도 한 일은 남는다)
export const CHUNK_MAX = 1200;         // 조각 본문 글자 상한(머리줄 제외)
export const CHUNK_OVERLAP = 150;      // 앞 조각 끝을 다음 조각 앞에 이만큼까지 겹친다
export const NEW_KINDS = ['wiki', 'service'];   // 0096 — 원본 칸은 page_id(text) · service_id
export const KINDS = ['card', 'comment', 'file', ...NEW_KINDS];
export const PRICE_PER_M_TOKENS = 0.15;   // gemini-embedding-001 입력 1M 토큰당(scripts/embed-bible.mjs와 같은 값)

// ── 글 만들기 (순수 함수 — tests/logcheck가 노드에서 부른다) ─────────────────

// 조각 해시 — 임베딩한 글의 sha256 통째로(_lib 한 벌 · 스크립트·tests가 여기서 가져간다)
export { sha256 };

// 마크다운에서 벡터에 소음인 것만 걷는다 — 링크 주소(글자만 남긴다) · 이미지 · 강조 기호(==, **).
// 제목(#)·목록(-)·@이름은 둔다 — 구조와 사람 이름이 뜻의 일부다('청년별 담당 업무' 도막도 그대로).
function cleanMarkdown(md) {
  return String(md || '')
    .replace(/\r\n?/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\((?:https?:|mailto:|\/)[^)]*\)/g, '$1')
    .replace(/==|\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 너무 긴 한 덩어리를 max 이하로 — 문장 끝 → 공백 → 그냥 자르기 순으로 자리를 찾는다
function splitLong(s, max) {
  const out = [];
  let rest = s;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = Math.max(win.lastIndexOf('. '), win.lastIndexOf('? '), win.lastIndexOf('! '));
    if (cut >= max * 0.5) cut += 1; else cut = win.lastIndexOf(' ');
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// 문단(빈 줄) → 줄 → 문장 순으로 쪼갠 조각들. 각 조각은 max 이하이고 이어 붙일 구분자를 안다.
// max를 넘는 한 줄은 겹칠 자리(overlap)를 남기고 자른다 — 통짜 발췌(엑셀 셀을 공백으로 이은 것)도 겹치게.
function pieces(s, max, overlap) {
  const room = Math.max(max - overlap - 1, Math.ceil(max / 2));
  const out = [];
  for (const para of s.split(/\n{2,}/)) {
    if (!para.trim()) continue;
    if (para.length <= max) { out.push({ text: para, sep: '\n\n' }); continue; }
    let first = true;
    for (const line of para.split('\n')) {
      if (!line.trim()) continue;
      for (const part of (line.length <= max ? [line] : splitLong(line, room))) {
        out.push({ text: part, sep: first ? '\n\n' : '\n' });
        first = false;
      }
    }
  }
  return out;
}

// 앞 조각의 끝 overlap자 — 줄 머리(없으면 낱말 머리)에서 시작하게 앞쪽을 버린다
function tailOf(s, overlap) {
  if (overlap <= 0 || !s) return '';
  const t = s.slice(-overlap);
  const nl = t.indexOf('\n');
  if (nl >= 0 && nl < t.length - 1) return t.slice(nl + 1).trim();
  const sp = t.indexOf(' ');
  return sp >= 0 ? t.slice(sp + 1).trim() : '';
}

// 긴 글 → max자 이하 조각들. 문단 경계에서 자르고, 다음 조각 앞에 앞 조각 끝(≤ overlap자)을 겹친다.
// 짧은 글은 그대로 한 조각, 빈 글은 [].
export function chunkText(text, max = CHUNK_MAX, overlap = CHUNK_OVERLAP) {
  const s = String(text || '').trim();
  if (!s) return [];
  if (s.length <= max) return [s];
  const chunks = [];
  let cur = '';
  for (const p of pieces(s, max, overlap)) {
    if (!cur) { cur = p.text; continue; }
    if (cur.length + p.sep.length + p.text.length <= max) { cur += p.sep + p.text; continue; }
    chunks.push(cur);
    const tail = tailOf(cur, overlap);
    cur = tail && tail.length + 1 + p.text.length <= max ? `${tail}\n${p.text}` : p.text;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// 한 원본 → 조각 행들(벡터 없이). 머리줄은 조각마다 붙는다 — 조각 하나만 걸려도 어느 업무인지 안다.
// 본문이 비면 머리줄만으로 한 조각(업무 제목만으로도 찾을 수 있게).
// 새 종류(위키 장 · 주보)만 page_id · service_id를 단다 — 옛 세 종류의 행 모양은 그대로(0096 전에도 upsert가 돈다).
function rowsFor(kind, sourceId, projectId, header, body) {
  const parts = chunkText(body);
  const texts = parts.length ? parts.map(p => `${header}\n${p}`) : [header];
  return texts.map((text, chunk) => ({
    kind,
    card_id: kind === 'card' ? sourceId : null,
    comment_id: kind === 'comment' ? sourceId : null,
    file_id: kind === 'file' ? sourceId : null,
    ...(kind === 'wiki' ? { page_id: sourceId } : kind === 'service' ? { service_id: sourceId } : {}),
    source_id: sourceId,
    project_id: projectId || null,
    chunk,
    body: text,
    body_hash: sha256(text),
  }));
}

const clean1 = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 원본 → 넣어야 할 조각 전부. kinds를 주면 그 종류만. **updated_at은 보지 않는다**(해시가 열쇠).
//   card    '프로젝트명 / 업무 제목' + 본문
//   comment '업무 제목 · 댓글: 본문'
//   file    '업무 제목 · 첨부: 파일명' + 발췌   — 업무에 달린 것 · 발췌가 있는 것만
//   wiki    "위키 '장 제목'" + 장 글(다붓이 근거와 같은 글)   — DB에 있는 장만(FK) · 자주 묻는 질문 장은 빼고
//   service 'M월 D일(요) 주보' + 설교·찬양·광고 + 첨부 이름   — 발행된 주보만(services_select와 같은 범위)
export function buildDocs({ projects = [], cards = [], comments = [], files = [], pages = [], edits = [], services = [], serviceFiles = [] }, kinds = KINDS) {
  const want = new Set(kinds);
  const projName = new Map(projects.map(p => [p.id, clean1(p.name)]));
  const cardById = new Map(cards.map(c => [c.id, c]));
  const out = [];
  if (want.has('card')) {
    for (const c of cards) {
      const pn = projName.get(c.project_id);
      const header = pn ? `${pn} / ${clean1(c.title)}` : clean1(c.title);
      out.push(...rowsFor('card', c.id, c.project_id, header, cleanMarkdown(c.description)));
    }
  }
  if (want.has('comment')) {
    for (const m of comments) {
      const card = cardById.get(m.card_id);
      if (!card) continue;                       // 업무가 없는 댓글은 열 자리가 없다
      const body = String(m.body || '').trim();
      if (!body) continue;
      const parts = chunkText(body);
      parts.forEach((p, chunk) => {
        const text = `${clean1(card.title)} · 댓글: ${p}`;
        out.push({ kind: 'comment', card_id: null, comment_id: m.id, file_id: null, source_id: m.id,
          project_id: card.project_id || null, chunk, body: text, body_hash: sha256(text) });
      });
    }
  }
  if (want.has('file')) {
    for (const f of files) {
      if (!f.card_id || f.service_id) continue;  // 주보 첨부는 넣지 않는다(0074 머리말)
      const card = cardById.get(f.card_id);
      const excerpt = String(f.text_excerpt || '').trim();
      if (!card || !excerpt) continue;
      const header = `${clean1(card.title)} · 첨부: ${clean1(f.name)}`;
      out.push(...rowsFor('file', f.id, card.project_id, header, excerpt));
    }
  }
  if (want.has('wiki')) {
    const stored = new Set(pages.map(p => p.id));
    for (const { page } of wikiEvidence(pages, edits).items) {
      if (stored.has(page.id)) out.push(...rowsFor('wiki', page.id, null, `위키 '${clean1(page.title)}'`, pageBody(page)));
    }
  }
  if (want.has('service')) {
    const filesOf = Map.groupBy(serviceFiles.filter(f => f.service_id && f.name), f => f.service_id);
    for (const s of services.filter(s => s.status === 'published')) {
      const names = (filesOf.get(s.id) || []).map(f => clean1(f.name));
      out.push(...rowsFor('service', s.id, null, `${mdLabel(s.service_date, true)} 주보`, `${serviceText(s)}${names.length ? `\n첨부: ${names.join(', ')}` : ''}`));
    }
  }
  return out;
}

const keyOf = (r) => `${r.kind}|${r.source_id}|${r.chunk}`;

// 잠긴 업무(0099)의 몫은 **건드리지 않는다** — 새로 만들지도(본문은 card_secrets로 옮겨 cards 쪽이 비었다), 지우지도 않는다.
// 이미 있는 조각은 정책(doc_vec_select의 locked_hidden_ids)이 여는 사람에게만 보이게 거르고, 풀면 **그 자리에서** 다시 보인다
// (다음 크론을 기다리지 않는다). 돌려주는 것: 잠긴 몫을 뺀 원본 + 그대로 둘 source_id Set(업무·그 댓글·그 첨부).
export function holdLocked(src) {
  const open = dropLocked(src);
  const keep = new Set([
    ...open.locked,
    ...(src.comments || []).filter(m => open.locked.has(m.card_id)).map(m => m.id),
    ...(src.files || []).filter(f => f.card_id && open.locked.has(f.card_id)).map(f => f.id),
  ].map(String));
  return { src: { ...src, cards: open.cards, comments: open.comments, files: open.files }, keep };
}

// 지금 있어야 할 조각(docs)과 doc_vec에 있는 행(existing: id·kind·source_id·chunk·body_hash·project_id)을
// 견준다. kinds 밖의 기존 행은 건드리지 않는다(--kind로 한 종류만 돌릴 때).
//   embed — 없거나 해시가 다른 조각(임베딩해 upsert)
//   move  — 해시는 같은데 project_id만 다른 행({ id, project_id } · 임베딩 없이 고친다)
//   drop  — 원본은 있는데 그 조각 번호가 더는 없는 행의 id(원본이 없어진 것은 cascade가 이미 지웠다)
export function planSync(docs, existing, kinds = KINDS) {
  const want = new Set(kinds);
  const have = new Map();
  for (const r of existing) if (want.has(r.kind)) have.set(keyOf(r), r);
  const embed = [], move = [], seen = new Set();
  for (const d of docs) {
    const k = keyOf(d);
    seen.add(k);
    const h = have.get(k);
    if (!h || h.body_hash !== d.body_hash) embed.push(d);
    else if ((h.project_id || null) !== (d.project_id || null)) move.push({ id: h.id, project_id: d.project_id || null });
  }
  const drop = [];
  for (const [k, r] of have) if (!seen.has(k)) drop.push(r.id);
  return { embed, move, drop };
}

// ── 임베딩 ──────────────────────────────────────────────────────────────────

export const docRequests = (texts) => texts.map(text => ({
  model: `models/${EMBED_MODEL}`,
  content: { parts: [{ text }] },
  taskType: TASK_TYPE,
  outputDimensionality: EMBED_DIM,
}));

// halfvec 입력 글자(scripts/embed-bible.mjs vecLiteral과 같은 모양)
export const vecLiteral = (vec) => `[${vec.map(x => x.toFixed(6)).join(',')}]`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// texts(최대 100) → 단위 길이 벡터 배열. deadline(ms 시각)을 넘길 요청은 끊는다.
// 429·5xx는 **남은 시간 안에서만** 한 번 더 — 크론이 기다리다 함수 시간 제한에 죽지 않게.
// 내보내는 것은 다붓이 회귀 묶음(scripts/dabooti-eval.mjs --local-index)이 DB에 쓰지 않고 같은 조각을 재 보려는 것이다.
export async function embedTexts(texts, key, { deadline = Infinity, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    const left = deadline - Date.now();
    if (left < 3000) throw Object.assign(new Error('시간 예산이 다 됐다'), { budget: true });
    let r, j;
    try {
      ({ r, j } = await geminiFetch(EMBED_MODEL, 'batchEmbedContents', { requests: docRequests(texts) }, { key, ms: Math.min(left - 1000, 30000), lenient: true }));
    } catch (e) {
      if (isTimeout(e)) throw Object.assign(new Error('임베딩 요청이 시간 안에 안 끝났다'), { budget: true });
      if (i >= tries) throw e;
      await sleep(1000 * i);
      continue;
    }
    if (!r.ok) {
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || i >= tries) throw new Error(`임베딩 HTTP ${r.status} ${String(j.error?.message || '').slice(0, 160)}`);
      const delay = (j.error?.details || []).find(d => d.retryDelay)?.retryDelay;
      const wait = delay ? Math.ceil(parseFloat(delay) * 1000) + 500 : 2000 * i;
      if (Date.now() + wait > deadline - 5000) throw Object.assign(new Error(`임베딩 HTTP ${r.status} — 기다릴 시간이 없다`), { budget: true });
      await sleep(wait);
      continue;
    }
    const embs = j.embeddings || [];
    if (embs.length !== texts.length) throw new Error(`임베딩 개수가 다르다: ${embs.length} ≠ ${texts.length}`);
    return embs.map((e, n) => {
      const v = e.values;
      if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error(`조각 ${n}: 차원 ${v?.length} ≠ ${EMBED_DIM}`);
      return unitVec(v);
    });
  }
}

// ── DB ──────────────────────────────────────────────────────────────────────

// PostgREST 기본 상한(1000행)을 넘어 끝까지 읽는다
async function readAll(db, table, columns, where = (q) => q, orderBy = ['id']) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await orderBy.reduce((q, col) => q.order(col), where(db.from(table).select(columns))).range(from, from + 999);
    if (error) throw Object.assign(new Error(`${table} 읽기 실패: ${error.code || ''} ${error.message}`), { pg: error });
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function loadSources(db, kinds = KINDS) {
  const want = new Set(kinds);
  // 휴지통(0104) — 지운 프로젝트·업무와 그 댓글·첨부는 원본에서 빠진다 → 그 조각은 아래 동기화가 '원본 없음'으로 지운다
  // (RLS가 이미 가리지만 doc_vec 행 자체를 남길 까닭이 없다 · 복원하면 다음 동기화에 다시 임베딩된다)
  const [projectsRaw, cardsRaw, commentsRaw, filesRaw, pages, edits, services, serviceFiles, trashed] = await Promise.all([
    readAll(db, 'projects', 'id, name'),
    readAll(db, 'cards', 'id, project_id, title, description, locked'),
    want.has('comment') ? readAll(db, 'comments', 'id, card_id, body') : [],
    want.has('file') ? readAll(db, 'files', 'id, card_id, service_id, name, text_excerpt', q => q.not('card_id', 'is', null)) : [],
    want.has('wiki') ? readAll(db, 'wiki_pages', 'id, grp, title, kind, blocks') : [],
    // wiki_edits에는 id 칸이 없다 — (page_id, item_key)로 차례를 세운다
    want.has('wiki') ? readAll(db, 'wiki_edits', 'page_id, item_key, block_key, text, before, edited_by, edited_at', q => q, ['page_id', 'item_key']) : [],
    want.has('service') ? readAll(db, 'services', 'id, service_date, title, passage_ref, songs, notices, status', q => q.eq('status', 'published')) : [],
    want.has('service') ? readAll(db, 'files', 'id, service_id, name', q => q.not('service_id', 'is', null)) : [],
    trashedIds(db),
  ]);
  const { projects, cards, comments, files } = dropTrashed({ projects: projectsRaw, cards: cardsRaw, comments: commentsRaw, files: filesRaw }, trashed);
  return { projects, cards, comments, files, pages, edits, services, serviceFiles };
}

const isMissingTable = (e) => ['42P01', 'PGRST205'].includes(e?.pg?.code);
// 0096 전 — doc_vec에 page_id 칸이 없다(PostgREST는 42703 또는 PGRST204로 답한다)
const isMissingColumn = (e) => ['42703', 'PGRST204'].includes(e?.pg?.code);

// ── 동기화 ──────────────────────────────────────────────────────────────────
// db는 **서버 키 클라이언트**여야 한다(doc_vec에 클라이언트 쓰기 권한이 없다).
// budgetMs 안에서만 임베딩한다 — 못 한 것은 다음 번에 이어서 한다(해시가 다르니 다시 잡힌다).
// dryRun이면 읽기만 하고 무엇을 할지 센다(doc_vec이 아직 없으면 빈 표로 본다).
// 돌려주는 것: { docs, byKind, embed, embedded, moved, dropped, remaining, chars, ms, stopped, missingTable }
export async function syncDocVectors(db, { geminiKey, budgetMs = 40000, dryRun = false, kinds = KINDS, log = () => {} } = {}) {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;

  // 있는 행을 먼저 읽는다 — 0096 전(page_id 칸 없음)이면 새 종류를 빼고 돈다(마이그레이션이 늦어도 업무 임베딩은 그대로)
  let existing = [];
  let missingTable = false;
  let newCols = true;
  try {
    existing = await readAll(db, 'doc_vec', 'id, kind, source_id, chunk, body_hash, project_id, page_id');
  } catch (e) {
    if (isMissingColumn(e)) {
      newCols = false;
      kinds = kinds.filter(k => !NEW_KINDS.includes(k));
      log('[docsync] doc_vec에 page_id가 없다(0096 전) — 위키 장·주보는 건너뛴다');
      existing = await readAll(db, 'doc_vec', 'id, kind, source_id, chunk, body_hash, project_id');
    } else if (dryRun && isMissingTable(e)) missingTable = true;
    else throw e;
  }
  const { src, keep } = holdLocked(await loadSources(db, kinds));
  const docs = buildDocs(src, kinds);
  const plan = planSync(docs, existing.filter(r => !keep.has(String(r.source_id))), kinds);

  const byKind = {};
  for (const k of kinds) byKind[k] = { sources: 0, chunks: 0, chars: 0, embed: 0 };
  const srcSeen = new Set();
  for (const d of docs) {
    const b = byKind[d.kind];
    b.chunks++; b.chars += d.body.length;
    if (!srcSeen.has(`${d.kind}|${d.source_id}`)) { srcSeen.add(`${d.kind}|${d.source_id}`); b.sources++; }
  }
  for (const d of plan.embed) byKind[d.kind].embed++;
  const summary = {
    docs: docs.length, byKind, existing: existing.length,
    embed: plan.embed.length, moved: 0, dropped: 0, embedded: 0,
    remaining: plan.embed.length, chars: plan.embed.reduce((s, d) => s + d.body.length, 0),
    ms: 0, stopped: null, missingTable,
  };
  if (dryRun) { summary.ms = Date.now() - t0; summary.plan = plan; return summary; }
  if (plan.embed.length && !geminiKey) throw new Error('GEMINI_API_KEY가 없다');

  // 싼 것부터 — 지우기·옮기기는 임베딩이 끊겨도 끝나 있게
  for (let i = 0; i < plan.drop.length; i += 200) {
    const ids = plan.drop.slice(i, i + 200);
    const { error } = await db.from('doc_vec').delete().in('id', ids);
    if (error) throw new Error(`doc_vec 지우기 실패: ${error.message}`);
    summary.dropped += ids.length;
  }
  const byProject = new Map();
  for (const m of plan.move) {
    const list = byProject.get(m.project_id);
    if (list) list.push(m.id); else byProject.set(m.project_id, [m.id]);
  }
  for (const [pid, ids] of byProject) {
    const { error } = await db.from('doc_vec').update({ project_id: pid }).in('id', ids);
    if (error) throw new Error(`doc_vec 프로젝트 고치기 실패: ${error.message}`);
    summary.moved += ids.length;
  }

  for (let i = 0; i < plan.embed.length; i += EMBED_BATCH) {
    const batch = plan.embed.slice(i, i + EMBED_BATCH);
    let vecs;
    try {
      vecs = await embedTexts(batch.map(d => d.body), geminiKey, { deadline });
    } catch (e) {
      if (!e.budget) throw e;
      summary.stopped = e.message;
      log(`[docsync] 멈춤: ${e.message} — 남은 ${summary.remaining}조각은 다음 번에`);
      break;
    }
    const now = new Date().toISOString();
    const rows = batch.map((d, n) => ({
      kind: d.kind, card_id: d.card_id, comment_id: d.comment_id, file_id: d.file_id,
      ...(newCols ? { page_id: d.page_id ?? null, service_id: d.service_id ?? null } : {}),
      project_id: d.project_id, chunk: d.chunk, body: d.body, body_hash: d.body_hash,
      vec: vecLiteral(vecs[n]), updated_at: now,
    }));
    for (let j = 0; j < rows.length; j += UPSERT_BATCH) {
      const { error } = await db.from('doc_vec').upsert(rows.slice(j, j + UPSERT_BATCH), { onConflict: 'kind,source_id,chunk' });
      if (error) throw new Error(`doc_vec 쓰기 실패: ${error.code || ''} ${error.message}`);
    }
    summary.embedded += rows.length;
    summary.remaining -= rows.length;
    log(`[docsync] ${summary.embedded}/${plan.embed.length}조각`);
  }
  summary.ms = Date.now() - t0;
  return summary;
}
