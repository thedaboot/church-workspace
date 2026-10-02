// 첨부 실측용 임시 데이터 — 계정 하나(마스터 자리 · 큐시트 편집 자격까지) · 2099년 프로젝트·업무 하나 ·
// 2099-12-27 작성 중 주보 하나. teardown.mjs가 전부 지운다(드라이브 폴더는 휴지통).
//   node --env-file=.env scripts/attach-live/setup.mjs <state.json>
// 마스터로 두는 이유: 주보 파일을 올리려면 can_edit_service(), 큐시트 사본 편집 화면은
// worshipPerms.canEditCue(마스터·교역자)가 필요하다. 명단(people)에 교역자 줄을 만드는 것보다
// admins 한 줄이 흔적이 적다. 이메일은 .invalid라 드라이브 편집자 붙이기는 그 한 줄만 실패한다.
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const url = process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SECRET_KEY, anon = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const OUT = process.argv[2];
const email = 'attach-test-1@thedaboot.invalid', name = '첨부검증';
const password = randomBytes(18).toString('base64url');
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, name } });
if (error) throw error;
const id = data.user.id;
for (let i = 0; i < 20; i++) { const { data: r } = await admin.from('profiles').select('id').eq('id', id).maybeSingle(); if (r) break; await new Promise(r => setTimeout(r, 300)); }
const up = await admin.from('profiles').update({ approved: true, display_name: name }).eq('id', id).select('id').single();
if (up.error) throw up.error;
const ad = await admin.from('admins').insert({ email, is_master: true });
if (ad.error) throw ad.error;
const c = createClient(url, anon, { auth: { persistSession: false } });
const s = await c.auth.signInWithPassword({ email, password });
if (s.error) throw s.error;
const out = { users: [{ id, name, email, session: s.data.session }] };
const proj = await admin.from('projects').insert({ name: '첨부 검증(자동 삭제)', year: 2099, position: 999, created_by: id }).select('id').single();
if (proj.error) throw proj.error;
const card = await admin.from('cards').insert({ project_id: proj.data.id, title: '첨부 검증 업무', description: '첨부 실측', status: 'todo', created_by: id, assignees: [] }).select('id').single();
if (card.error) throw card.error;
const svcRow = await admin.from('services').insert({ kind: 'sunday', service_date: '2099-12-27', status: 'draft' }).select('id').single();
if (svcRow.error) throw svcRow.error;
out.projectId = proj.data.id; out.cardId = card.data.id; out.serviceId = svcRow.data.id;
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('ok user', id, 'project', out.projectId, 'card', out.cardId, 'service', out.serviceId);
