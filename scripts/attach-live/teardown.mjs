// 첨부 실측(scripts/attach-live) 뒤처리 — setup.mjs와 e2e.mjs가 만든 것을 전부 지운다.
//   node --env-file=.env scripts/attach-live/teardown.mjs <state.json>
// 차례: 드라이브(남은 파일·사본 → 업무 폴더 → 프로젝트 폴더 → 주보 폴더, 전부 휴지통) → Storage 임시 사본 →
// 활동·알림 → 파일 행 → 업무 → 프로젝트 → 주보 → admins → 프로필 → 계정. 끝나면 public의 uuid 칸 전수 + auth·storage를
// psql로 훑어 0건인지 본다(scripts/coedit-live/teardown.mjs와 같은 규칙).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const uid = st.users[0].id, email = st.users[0].email;
const out = [];
const log = (k, v) => { out.push([k, v]); console.log(k, v); };
async function drive(body) {
  const r = await fetch(process.env.DRIVE_WEBAPP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: process.env.DRIVE_WEBAPP_TOKEN }), redirect: 'follow' });
  const j = JSON.parse(await r.text()); if (j.error) throw new Error(j.error); return j;
}
const trash = async (what, id) => { if (!id) return; try { await drive({ action: 'trash', fileId: id }); log('trash ' + what, id); } catch (e) { log('trash ' + what + ' 실패', `${id} ${e.message}`); } };

// ── 드라이브 ──
const proj = (await db.from('projects').select('drive_folder_id').eq('id', st.projectId).maybeSingle()).data;
const card = (await db.from('cards').select('drive_folder_id').eq('id', st.cardId).maybeSingle()).data;
const svc = (await db.from('services').select('drive_folder_id').eq('id', st.serviceId).maybeSingle()).data;
const folders = { card: card?.drive_folder_id || st.cardFolderId, project: proj?.drive_folder_id || st.projectFolderId, service: svc?.drive_folder_id || st.serviceFolderId };
const rows = (await db.from('files').select('id, name, drive_file_id, preview_file_id').or(`card_id.eq.${st.cardId},service_id.eq.${st.serviceId}`)).data || [];
for (const r of rows) { await trash('사본 ' + r.name, r.preview_file_id); await trash('원본 ' + r.name, r.drive_file_id); }
// 폴더 안에 남은 것(행 없이 남은 고아 포함)도 폴더째 휴지통으로 간다
for (const k of ['card', 'service', 'project']) {
  const f = folders[k]; if (!f) continue;
  try { const l = await drive({ action: 'list', folderId: f }); log('남은 ' + k + ' 폴더 내용', (l.files || []).map(x => x.name).join(', ') || '없음'); } catch (e) { log('list ' + k, e.message); }
  await trash(k + ' 폴더', f);
}
// ── Storage 임시 사본(3MB 넘는 파일이 들렀다 가는 자리) ──
for (const prefix of [`${st.projectId}/${st.cardId}`, `services/${st.serviceId}`]) {
  const { data: objs } = await db.storage.from('attachments').list(prefix, { limit: 1000 });
  const paths = (objs || []).map(o => `${prefix}/${o.name}`);
  if (paths.length) { const r = await db.storage.from('attachments').remove(paths); log('storage ' + prefix, r.error ? r.error.message : `지움 ${paths.length}`); }
  else log('storage ' + prefix, '비어 있음');
}
// ── DB ──
const run = async (name, q) => { const r = await q; log(name, r.error ? r.error.message : 'ok'); };
await run('activity(project)', db.from('activity').delete().eq('project_id', st.projectId));
await run('activity(actor)', db.from('activity').delete().eq('actor_id', uid));
await run('notifications(recipient)', db.from('notifications').delete().eq('recipient_id', uid));
await run('files', db.from('files').delete().or(`card_id.eq.${st.cardId},service_id.eq.${st.serviceId}`));
await run('cards', db.from('cards').delete().eq('project_id', st.projectId));
await run('projects', db.from('projects').delete().eq('id', st.projectId));
await run('services', db.from('services').delete().eq('id', st.serviceId));
await run('admins', db.from('admins').delete().eq('email', email));
await run('profiles', db.from('profiles').delete().eq('id', uid));
{ const r = await db.auth.admin.deleteUser(uid); log('auth ' + uid, r.error ? r.error.message : 'ok'); }

// ── 남은 것 훑기 ──
const ids = [uid, st.projectId, st.cardId, st.serviceId, ...(st.fileIds || [])].filter(Boolean);
const driveIds = [...(st.driveIds || []), folders.card, folders.project, folders.service].filter(Boolean);
const lit = (a) => a.map(x => `'${String(x).replace(/'/g, '')}'`).join(',');
const sql = `
do $$
declare r record; n bigint; total bigint := 0; ids text[] := array[${lit(ids)}]::text[];
begin
  for r in select table_schema, table_name, column_name from information_schema.columns
           where table_schema = 'public' and data_type = 'uuid' loop
    execute format('select count(*) from %I.%I where %I::text = any($1)', r.table_schema, r.table_name, r.column_name) into n using ids;
    if n > 0 then raise notice 'LEFT %.%.% = %', r.table_schema, r.table_name, r.column_name, n; total := total + n; end if;
  end loop;
  select count(*) into n from public.files where drive_file_id = any(array[${lit(driveIds)}]::text[]) or preview_file_id = any(array[${lit(driveIds)}]::text[]);
  if n > 0 then raise notice 'LEFT files drive ids = %', n; total := total + n; end if;
  for r in select 1 from public.cards where drive_folder_id = any(array[${lit(driveIds)}]::text[])
           union all select 1 from public.projects where drive_folder_id = any(array[${lit(driveIds)}]::text[])
           union all select 1 from public.services where drive_folder_id = any(array[${lit(driveIds)}]::text[]) loop
    raise notice 'LEFT folder ref'; total := total + 1; end loop;
  select count(*) into n from auth.users where id::text = '${uid}' or email = '${email}'; total := total + n; if n > 0 then raise notice 'LEFT auth.users %', n; end if;
  select count(*) into n from public.admins where email = '${email}'; total := total + n; if n > 0 then raise notice 'LEFT admins %', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'attachments' and (name like '${st.projectId}/%' or name like 'services/${st.serviceId}/%'); total := total + n; if n > 0 then raise notice 'LEFT storage %', n; end if;
  raise notice 'LEFTOVER TOTAL = %', total;
end $$;`;
const f = join(tmpdir(), `attach-scan-${Date.now()}.sql`);
writeFileSync(f, sql);
const r = spawnSync('psql', [process.env.SUPABASE_DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', f], { encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
console.log((r.stdout || '') + (r.stderr || ''));
// 드라이브에서도 사라졌는지 — 휴지통의 폴더는 이름으로 다시 안 잡힌다(list는 trashed=false만 본다)
for (const path of [['첨부 검증(자동 삭제)'], ['예배', '2099-12-27']]) {
  try { const l = await drive({ action: 'list', path }); log('드라이브 ' + path.join('/'), l.folderId ? `아직 있음 ${l.folderId} (${(l.files || []).length}건)` : '없음'); } catch (e) { log('list ' + path.join('/'), e.message); }
}
