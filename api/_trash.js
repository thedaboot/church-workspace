import { purgePlan, isMissingColumn, TRASH_DAYS } from '../src/services/trashItems.js';

// ============================================================================
// 휴지통(0104) — 서버 키 경로의 한 벌. `_`로 시작해 라우트가 아니다(함수 수에 들지 않는다).
// ----------------------------------------------------------------------------
//   trashedIds(db)     지운 프로젝트 · 따로 지운 업무 id — 서버 키로 통째로 읽는 자리(위키 · 다붓이 아침 고리 · 임베딩 ·
//                      마감 알림 · 달력 · 공유 카드)가 trashItems.dropTrashed·goneCard로 걷는다(RLS를 안 타는 자리다).
//                      **칸이 없으면(0104 전) 빈 Set** — 코드가 마이그레이션보다 먼저 나가도 그대로 돈다.
//   purgeTrash(db)     30일 지난 것을 정리한다(아침 크론 · api/push.js). 앱의 예전 삭제(cloud/board.js deleteCard·deleteProject)와
//                      같은 차례: 준비물(폴더 id · 첨부 행) 읽기 → 행 삭제(프로젝트는 cascade가 업무까지) → 첨부 행 →
//                      드라이브 폴더째 휴지통(실패하면 업무 폴더 → 파일 단위) · Storage(레거시) 실체 삭제.
//                      드라이브 휴지통은 앱과 같은 Apps Script `trash` 액션을 서버가 직접 부른다(api/drive.js와 같은 주소·토큰).
//                      **던지지 않는다** — 실패는 로그와 돌려주는 값에 남고 다음 아침에 다시 잡힌다(행이 남아 있으면).
//   sweepStrayUploads(db)  attachments 버킷에서 하루 지난, 어느 files 행도 안 가리키는 사본을 지운다(같은 아침 크론).
// ============================================================================

export async function trashedIds(db) {
  const [p, c] = await Promise.all([
    db.from('projects').select('id').not('deleted_at', 'is', null),
    db.from('cards').select('id').not('deleted_at', 'is', null),
  ]);
  for (const [name, r] of [['projects', p], ['cards', c]]) {
    if (r.error && isMissingColumn(r.error)) return { projects: new Set(), cards: new Set() };
    if (r.error) throw Object.assign(new Error(`${name}: ${r.error.message}`), { pg: r.error });
  }
  return { projects: new Set((p.data || []).map(x => x.id)), cards: new Set((c.data || []).map(x => x.id)) };
}

// 업무 행 하나가 휴지통 것인가(자기 표시 · 프로젝트 표시). project_id가 없는 행(프로젝트 조회)도 받는다
export const goneCard = (t, row) => !!row && (t.cards.has(row.id) || t.projects.has(row.project_id));

// 한 번 읽어 바로 판정 — 행 하나만 보는 자리(공유 카드 · 달력 구독의 프로젝트)
export async function isTrashed(db, table, id) {
  if (!id) return false;
  const { data, error } = await db.from(table).select('deleted_at').eq('id', id).maybeSingle();
  if (error) { if (isMissingColumn(error)) return false; throw error; }
  return !!data?.deleted_at;
}

// 드라이브 휴지통 한 번(Apps Script `trash` — 폴더도 파일도 같은 액션 · 멱등). 설정이 없으면 false
async function driveTrash(fileId) {
  const url = process.env.DRIVE_WEBAPP_URL;
  const token = process.env.DRIVE_WEBAPP_TOKEN;
  if (!url || !token || !fileId) return false;
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash', token, fileId }),
      signal: AbortSignal.timeout(30 * 1000),
    });
    const out = await r.json().catch(() => ({ error: `응답을 읽지 못했다 (${r.status})` }));
    if (out.error) { console.error('[trash] 드라이브 휴지통 실패:', fileId, out.error); return false; }
    return true;
  } catch (e) {
    console.error('[trash] 드라이브 휴지통 닿지 못함:', fileId, e?.message || e);
    return false;
  }
}

const ATTACH_BUCKET = 'attachments';

// now·days는 검사·되돌리기용(days: 0이면 휴지통 전부). trash: 드라이브 휴지통 함수(검사가 바꿔 끼운다)
export async function purgeTrash(db, { now = Date.now(), days = TRASH_DAYS, trash = driveTrash } = {}) {
  const [p, c] = await Promise.all([
    db.from('projects').select('id, deleted_at, drive_folder_id').not('deleted_at', 'is', null),
    db.from('cards').select('id, project_id, deleted_at, drive_folder_id').not('deleted_at', 'is', null),
  ]);
  for (const r of [p, c]) {
    if (r.error && isMissingColumn(r.error)) return { skipped: '0104 전' };
    if (r.error) throw r.error;
  }
  // 지운 프로젝트 안의 업무(자기 표시가 없는 것)도 폴더·첨부를 모아야 한다
  const dueIds = (p.data || []).map(x => x.id);
  let inside = [];
  if (dueIds.length) {
    const r = await db.from('cards').select('id, project_id, deleted_at, drive_folder_id').in('project_id', dueIds);
    if (r.error) throw r.error;
    inside = r.data || [];
  }
  const cards = [...new Map([...(c.data || []), ...inside].map(x => [x.id, x])).values()];
  const plan = purgePlan({ projects: p.data || [], cards }, now, days);
  if (!plan.projectIds.length && !plan.cardIds.length) return { projects: 0, cards: 0 };

  // ① 준비물 — 첨부 행(행을 지우면 files.card_id가 null이 되어 못 찾는다)
  let files = [];
  for (let i = 0; i < plan.fileCardIds.length; i += 100) {
    const r = await db.from('files').select('id, card_id, source, drive_file_id, preview_file_id, storage_path, name')
      .in('card_id', plan.fileCardIds.slice(i, i + 100));
    if (r.error) throw r.error;
    files.push(...(r.data || []));
  }
  // ② 드라이브를 **행보다 먼저**(감사 2026-10-23) — 행을 먼저 지우면 드라이브가 실패한 날(시간 초과 · 스크립트 오류) 폴더 id를 쥔 행이 없어
  //    다음 아침에 다시 잡을 재료가 남지 않았다. 휴지통 보내기는 멱등이라 행 삭제가 실패하면 다음 날 다시 보내도 된다.
  //    프로젝트 폴더째, 실패하면 업무 폴더째, 그것도 실패하면 파일 단위(cloud/drive.js trashFolder·trashFileBodies와 같은 차례)
  const inFolder = new Set();
  let folders = 0;
  for (const pf of plan.projectFolders) {
    if (await trash(pf.folderId)) { folders++; pf.cardFolders.forEach(cf => inFolder.add(cf.cardId)); continue; }
    for (const cf of pf.cardFolders) if (await trash(cf.folderId)) { folders++; inFolder.add(cf.cardId); }
  }
  for (const cf of plan.cardFolders) if (await trash(cf.folderId)) { folders++; inFolder.add(cf.cardId); }
  let bodies = 0;
  for (const f of files) {
    if (f.storage_path) {
      const r = await db.storage.from(ATTACH_BUCKET).remove([f.storage_path]).catch(e => ({ error: e }));
      if (r?.error) console.error('[trash] Storage 정리 실패:', f.name, r.error); else bodies++;
    }
    if (f.source !== 'drive' || !f.drive_file_id || inFolder.has(f.card_id)) continue;
    for (const id of [f.preview_file_id, f.drive_file_id].filter(Boolean)) if (await trash(id)) bodies++;
  }
  // ③ 행 삭제 — 프로젝트(cascade가 안의 업무까지) → 따로 지운 업무
  if (plan.projectIds.length) {
    const r = await db.from('projects').delete().in('id', plan.projectIds);
    if (r.error) throw r.error;
  }
  if (plan.cardIds.length) {
    const r = await db.from('cards').delete().in('id', plan.cardIds);
    if (r.error) throw r.error;
  }
  // ④ 남은 첨부 행
  if (files.length) {
    const r = await db.from('files').delete().in('id', files.map(f => f.id));
    if (r.error) console.error('[trash] 첨부 행 정리 실패:', r.error);
  }
  return { projects: plan.projectIds.length, cards: plan.cardIds.length, files: files.length, folders, bodies };
}

// 3MB 넘는 첨부는 attachments 버킷을 거쳐 드라이브로 간다(cloud/drive.js uploadViaStorage). 옮긴 뒤 사본 지우기가
// 실패하거나 그 사이 탭을 닫으면 **아무 행도 안 가리키는 사본**이 남는다(라이브 2026-10-21 · 3.1MB PDF 한 장).
// 하루 지난 것 중 files.storage_path가 안 가리키는 것을 지운다 — 올리는 중인 것(몇 분)은 하루 거르기로 피한다.
// ponytail: 폴더를 한 겹씩 list로 내려간다 — 버킷이 거의 비어 있어서(드라이브 이전 뒤) 충분하다. 커지면 storage.objects를 읽는 rpc로.
export async function sweepStrayUploads(db, { now = Date.now(), minAgeMs = 864e5 } = {}) {
  const bucket = db.storage.from(ATTACH_BUCKET);
  const old = [];
  const walk = async (prefix) => {
    const { data, error } = await bucket.list(prefix, { limit: 1000 });
    if (error) throw error;
    for (const o of data || []) {
      const path = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id == null) await walk(path); // 폴더(이름 앞머리)는 id가 없다
      else if (now - Date.parse(o.created_at) > minAgeMs) old.push(path);
    }
  };
  await walk('');
  if (!old.length) return { removed: 0 };
  const kept = new Set();
  for (let i = 0; i < old.length; i += 100) {
    const r = await db.from('files').select('storage_path').in('storage_path', old.slice(i, i + 100));
    if (r.error) throw r.error;
    (r.data || []).forEach(f => kept.add(f.storage_path));
  }
  const stray = old.filter(p => !kept.has(p));
  if (!stray.length) return { removed: 0 };
  const r = await bucket.remove(stray);
  if (r.error) throw r.error;
  return { removed: stray.length };
}
