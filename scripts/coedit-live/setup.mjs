// 동시 편집 실측용 임시 데이터 — 계정 둘 · 2099년 프로젝트 하나 · 업무 하나. teardown.mjs가 전부 지운다.
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const url = process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SECRET_KEY, anon = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const OUT = process.argv[2];
const people = [{ email: 'coedit-test-1@thedaboot.invalid', name: '검증하나' }, { email: 'coedit-test-2@thedaboot.invalid', name: '검증둘' }];
const out = { users: [] };
for (const p of people) {
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name, name: p.name } });
  if (error) throw error;
  const id = data.user.id;
  for (let i = 0; i < 20; i++) { const { data: r } = await admin.from('profiles').select('id').eq('id', id).maybeSingle(); if (r) break; await new Promise(r => setTimeout(r, 300)); }
  const up = await admin.from('profiles').update({ approved: true, display_name: p.name }).eq('id', id).select('id, approved, display_name').single();
  if (up.error) throw up.error;
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email: p.email, password });
  if (s.error) throw s.error;
  out.users.push({ id, name: p.name, email: p.email, session: s.data.session });
}
const proj = await admin.from('projects').insert({ name: '동시편집 검증(자동 삭제)', year: 2099, position: 999, created_by: out.users[0].id }).select('id').single();
if (proj.error) throw proj.error;
const md = '### 검증용 본문\n\n첫 문단입니다.\n\n- 첫째 항목\n- 둘째 항목 ==형광펜==\n- 셋째 항목\n\n### 남은 일\n- 마무리';
const card = await admin.from('cards').insert({ project_id: proj.data.id, title: '동시편집 검증 업무', description: md, status: 'todo', created_by: out.users[0].id, assignees: [] }).select('id').single();
if (card.error) throw card.error;
out.projectId = proj.data.id; out.cardId = card.data.id; out.md = md;
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('ok', out.users.map(u => u.name + ' ' + u.id), 'project', out.projectId, 'card', out.cardId);
