// 담당자가 표시명이 아니라 프로필 id로 붙는지 (0013 / cloudSync 읽기·쓰기 양방향).
// 검증 스위트는 게스트 모드만 돌아서 이 경로를 브라우저로는 볼 수 없다 —
// cloud.js를 가짜로 바꿔치고 cloudSync만 노드에서 직접 돌린다(aictx.mjs와 같은 방식).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src', 'services', 'cloudSync.js');
const patched = readFileSync(SRC, 'utf8')
  // 네트워크를 타는 계층만 가짜로. 나머지(모양 변환)는 실제 코드를 그대로 돌린다.
  .replace(/import \* as cloud from '\.\/cloud\.js';/, 'const cloud = globalThis.__CLOUD;')
  .replace(/import \{ statusToDb, statusFromDb \} from '\.\/cloud\.js';/,
    `const DB = { '시작 전':'todo', '진행 중':'doing', '보류 중':'hold', '완료':'done' };
     const statusToDb = s => DB[s] || 'todo';
     const statusFromDb = d => Object.keys(DB).find(k => DB[k] === d) || '시작 전';`)
  // utils에서 가져오는 이름이 늘어도 이 스위트가 깨지지 않게 **줄 전체**를 갈아치운다
  // (예전에는 `import { normalize }`만 정확히 찾다가, httpsImage가 추가되자 못 찾고
  //  임시 폴더에서 ../utils.js를 찾으려다 CRASH 났다)
  .replace(/import \{[^}]*\} from '\.\.\/utils\.js';/,
    `const normalize = a => a.reduce((acc, i) => { acc.byId[i.id] = i; acc.allIds.push(i.id); return acc; }, { byId:{}, allIds:[] });
     const httpsImage = u => { const s = String(u || ''); return s.slice(0,7).toLowerCase() === 'http://' ? 'https://' + s.slice(7) : s; };`);

const PROFILES = [
  { id: 'u1', display_name: '노준석', team_id: 'team-1' },
  { id: 'u2', display_name: '조준환' },
];
// 카드 3장으로 읽기 규칙 세 가지를 한 번에 본다:
//   c1 조인 있음        → 조인의 프로필 이름 (컬럼의 옛 이름을 이긴다)
//   c2 조인 없음+컬럼   → 컬럼으로 폴백 (0013 적용 전 카드 / 백필 못 된 이름)
//   c3 둘 다 없음       → 빈 배열
const CARDS = [
  { id: 'c1', project_id: 'p1', title: '콘티 확정', status: 'doing',
    assignees: ['노준서'], card_teams: [{ team_id: 'team-1' }], card_assignees: [{ profile_id: 'u1' }] },
  { id: 'c2', project_id: 'p1', title: '악보 제작', status: 'todo',
    assignees: ['가입안한사람'], card_teams: [], card_assignees: [] },
  { id: 'c3', project_id: 'p1', title: '사운드 체크', status: 'todo',
    assignees: [], card_teams: [], card_assignees: [] },
];

const writes = [];
globalThis.__CLOUD = {
  withClockSkewRetry: (fn) => fn(),
  listTeams: async () => [{ id: 'team-1', name: '찬양팀' }],
  listProfiles: async () => PROFILES,
  listProjects: async () => [{ id: 'p1', name: '2026 하계 수련회' }],
  listAllCards: async () => CARDS,
  listAllLinks: async () => [],
  listAllFiles: async () => [],
  getMyProfile: async () => PROFILES[0],
  getSession: async () => ({ session: { user: { id: 'u1' } }, user: { id: 'u1' } }),
  listProfileTeams: async () => [],
  createCard: async (data, teamIds, assigneeIds) => { writes.push({ op: 'create', teamIds, assigneeIds }); return data; },
  updateCard: async (id, patch, teamIds, assigneeIds) => { writes.push({ op: 'update', patch, teamIds, assigneeIds }); return patch; },
};

const dir = mkdtempSync(join(tmpdir(), 'assignees-'));
const file = join(dir, 'cloudSync.mjs');
writeFileSync(file, patched);
const sync = await import('file://' + file.replace(/\\/g, '/'));

// ── 읽기 ──────────────────────────────────────────────────────────────────
const { state } = await sync.loadCloudState();
const byId = state.tasks.byId;

// 이 하나가 원래 버그다: 프로필 이름을 '노준석'으로 바꿔도 카드에는 옛 이름
// '노준서'가 박혀 있어서 그 사람의 '내 업무'에서 카드가 사라졌다.
assert.deepStrictEqual(byId.c1.assignees, ['노준석'], '조인이 있으면 프로필의 현재 이름을 쓴다');
assert.deepStrictEqual(byId.c2.assignees, ['가입안한사람'], '조인이 없으면 cards.assignees로 폴백한다');
assert.deepStrictEqual(byId.c3.assignees, [], '둘 다 없으면 빈 배열');
assert.deepStrictEqual(byId.c1.teams, ['찬양팀'], '팀 매핑은 그대로 동작한다');

// ── 쓰기 ──────────────────────────────────────────────────────────────────
await sync.cardUpsertCloud({ id: 'c9', projectId: 'p1', title: '새 업무', status: '진행 중',
  teams: ['찬양팀'], assignees: ['조준환'] }, true);
const created = writes.at(-1);
assert.deepStrictEqual(created.assigneeIds, ['u2'], '새 카드: 표시명이 프로필 id로 바뀌어 저장된다');
assert.deepStrictEqual(created.teamIds, ['team-1']);

await sync.cardUpsertCloud({ id: 'c1', projectId: 'p1', title: '콘티 확정', status: '완료',
  teams: [], assignees: ['노준석', '조준환'] }, false);
const updated = writes.at(-1);
assert.deepStrictEqual(updated.assigneeIds, ['u1', 'u2'], '수정: 담당자 여럿도 id로 바뀐다');
assert.deepStrictEqual(updated.assigneeIds !== undefined, true, 'undefined면 cloud.js가 담당자를 건드리지 않는다');
// 컬럼도 계속 쓴다 — 롤백 여지와, 프로필이 지워졌을 때 "누구였는지"를 남기려고
assert.deepStrictEqual(updated.patch.assignees, ['노준석', '조준환'], 'cards.assignees 컬럼도 함께 쓴다');

// 프로필에 없는 이름은 조인에 넣지 않는다(선택기가 막지만 프로필이 사라진 경우가 있다)
await sync.cardUpsertCloud({ id: 'c1', projectId: 'p1', title: 'x', status: '완료',
  teams: [], assignees: ['없는사람'] }, false);
assert.deepStrictEqual(writes.at(-1).assigneeIds, [], '프로필에 없는 이름은 조인 행을 만들지 않는다');
assert.deepStrictEqual(writes.at(-1).patch.assignees, ['없는사람'], '그래도 컬럼에는 남아 화면에서 사라지지 않는다');

// ── cloud.js가 내보내는 문장 모양 ─────────────────────────────────────────
// 저장이 겹치면(저장 두 번 눌림·두 기기) 조인 쓰기 문장이 D1 D2 I1 I2 순으로 도착한다.
// "전부 지우고 전부 넣기"였을 때는 I2가 I1의 행과 부딪혀 duplicate key로 저장이
// 실패했다(라이브에서 재현 확인). 순서에 상관없는 모양인지 여기서 못 박는다.
const SB_SRC = join(import.meta.dirname, '..', 'src', 'services', 'cloud.js');
const sbPatched = readFileSync(SB_SRC, 'utf8')
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'const supabase = globalThis.__SB;')
  .replace(/import \{ CONFIG \} from '\.\.\/config\.js';/,
    `const CONFIG = { STATUS_DB: { '시작 전':'todo', '진행 중':'doing', '보류 중':'hold', '완료':'done' }, STATUSES: ['시작 전'] };`);

// 부른 문장을 기록만 하는 가짜 쿼리 빌더 (네트워크 없음)
const stmts = [];
globalThis.__SB = {
  from(table) {
    const rec = { table, filters: [] };
    const self = {
      update: (patch) => { rec.op = 'update'; rec.patch = patch; return self; },
      upsert: (rows, opts) => { rec.op = 'upsert'; rec.rows = rows; rec.opts = opts; return self; },
      insert: (rows) => { rec.op = 'insert'; rec.rows = rows; return self; },
      delete: () => { rec.op = 'delete'; return self; },
      select: () => self, single: () => self, maybeSingle: () => self,
      eq: (c, v) => { rec.filters.push({ kind: 'eq', col: c, val: v }); return self; },
      not: (c, o, v) => { rec.filters.push({ kind: 'not', col: c, op: o, val: v }); return self; },
      then: (onOk) => { stmts.push(rec); return Promise.resolve({ data: { id: 'c1' }, error: null }).then(onOk); },
    };
    return self;
  },
};
const sbFile = join(dir, 'cloud.mjs');
writeFileSync(sbFile, sbPatched);
const cloudMod = await import('file://' + sbFile.replace(/\\/g, '/'));

await cloudMod.updateCard('c1', { title: 'x' }, ['team-1'], ['u1', 'u2']);
const stmtsFor = (t) => stmts.filter(s => s.table === t);
for (const [table, col] of [['card_assignees', 'profile_id'], ['card_teams', 'team_id']]) {
  const del = stmtsFor(table).find(s => s.op === 'delete');
  const ins = stmtsFor(table).find(s => s.op === 'upsert' || s.op === 'insert');
  assert.ok(del, `${table}: 지우는 문장이 있다`);
  assert.ok(del.filters.some(f => f.kind === 'not' && f.col === col && f.op === 'in'),
    `${table}: 집합에 없는 것만 지운다 (전부 지우면 겹친 저장이 duplicate key로 깨진다)`);
  assert.equal(ins?.op, 'upsert', `${table}: 넣기는 upsert여야 한다 (insert는 이미 있는 행에서 깨진다)`);
  assert.equal(ins.opts?.ignoreDuplicates, true, `${table}: on conflict do nothing`);
}

// 담당자를 모두 비우는 경우 — 이때는 전부 지우고 넣지 않는다
stmts.length = 0;
await cloudMod.updateCard('c1', { title: 'x' }, undefined, []);
const emptyDel = stmtsFor('card_assignees').find(s => s.op === 'delete');
assert.ok(emptyDel && !emptyDel.filters.some(f => f.kind === 'not'), '빈 집합이면 조건 없이 전부 지운다');
assert.ok(!stmtsFor('card_assignees').some(s => s.op === 'upsert' || s.op === 'insert'), '빈 집합이면 넣지 않는다');
assert.ok(!stmtsFor('card_teams').length, 'undefined인 조인은 건드리지 않는다');

console.log('PASS  담당자 읽기 3가지(조인·폴백·빈 값) · 쓰기 3가지(신규·수정·미등록) · 조인 쓰기가 순서에 상관없는 모양');
