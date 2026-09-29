// 두 사람 실측(scripts/coedit-live) 뒤처리 — setup.mjs가 만든 것을 전부 지운다.
//   node scripts/coedit-live/teardown.mjs <state.json>
// 지우는 차례: 활동 기록(그 프로젝트·그 두 사람) → 업무(같이 쓰기 기록·스냅샷·판은 cascade) → 프로젝트 → 프로필 → 계정.
// 끝나면 public의 uuid 칸을 전부 훑는 psql 검사로 0건인지 본다(HANDOFF §2 6의 '두 사람 실측' 줄).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ids = st.users.map(u => u.id);
const out = [];
const run = async (name, q) => { const r = await q; out.push([name, r.error ? r.error.message : 'ok']); };
await run('activity(project)', db.from('activity').delete().eq('project_id', st.projectId));
await run('activity(actor)', db.from('activity').delete().in('actor_id', ids));
await run('cards', db.from('cards').delete().eq('project_id', st.projectId));
await run('projects', db.from('projects').delete().eq('id', st.projectId));
await run('profiles', db.from('profiles').delete().in('id', ids));
for (const id of ids) {
  const r = await db.auth.admin.deleteUser(id);
  out.push(['auth ' + id, r.error ? r.error.message : 'ok']);
}
console.log(JSON.stringify(out));
