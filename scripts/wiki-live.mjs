// 위키 · 다붓이 라이브 실측 — 임시 계정 하나(승인 · 관리자 아님)로 실제 세션을 만들어 클라우드 경로를 끝까지 돈다.
//   node --env-file=.env scripts/wiki-live.mjs
// 보는 것:
//   ① /api/ai { ask } 핸들러(같은 프로세스) — 승인 확인 → 묻는 사람 세션(RLS)으로 찾기 → 답·검증 → 저장(누가 물었는지 없음)
//   ② 거른 질문은 모델을 부르지 않는다 · { feedback } · 승인 안 된 세션은 403
//   ③ 위키 읽기(is_approved) · 고치기 upsert → 고친 사람은 몸통이 아니라 세션(트리거)
// 끝나면(실패해도) 만든 것을 전부 지우고 이 계정 id가 public 표 어디에도 남지 않았는지 psql로 본다(coedit-live와 같은 규칙).
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import handler from '../api/ai.js';

const url = process.env.VITE_SUPABASE_URL, svc = process.env.SUPABASE_SECRET_KEY, anon = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(url, svc, { auth: { persistSession: false } });
const email = 'wiki-test-1@thedaboot.invalid', name = '위키검증';
const password = randomBytes(18).toString('base64url');
const results = []; const check = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };
const qIds = [];
let uid = null;

const call = async (token, body) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
};

try {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, name } });
  if (error) throw error;
  uid = data.user.id;
  for (let i = 0; i < 20; i++) { const { data: r } = await admin.from('profiles').select('id').eq('id', uid).maybeSingle(); if (r) break; await new Promise(r => setTimeout(r, 300)); }
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  const token = s.data.session.access_token;

  // ② 승인 전 — 403
  const pre = await call(token, { ask: '월례회는 언제 해요?' });
  check('승인 전 세션은 다붓이를 못 쓴다(403)', pre.code === 403, String(pre.code));
  await admin.from('profiles').update({ approved: true, display_name: name }).eq('id', uid);

  // ① 답하기
  const a = await call(token, { ask: '리더 MT 어디서 해요?' });
  check('답: 근거로 찾은 답 · 근거 칩', a.code === 200 && a.body.status === 'answered' && a.body.sentences.some(x => /다온펜션/.test(x.text)) && a.body.sentences.some(x => x.cites.length), JSON.stringify(a.body).slice(0, 220));
  if (a.body?.id) qIds.push(a.body.id);
  check('답 몸통에 걸러 낸 문장(dropped)은 내보내지 않는다', a.body && !('dropped' in a.body));
  const f = await call(token, { ask: '9월 20일 큐시트 어디 있어요?' });
  check('위치 질문: 파일 카드(미리보기 행 모양)', f.body?.files?.length > 0 && f.body.files[0].drive_file_id !== undefined && /말씀 탭/.test(f.body.files[0].where), JSON.stringify(f.body?.files?.[0] || {}).slice(0, 200));
  if (f.body?.id) qIds.push(f.body.id);
  const r = await call(token, { ask: '지난주에 누가 출석 안 했어요?' });
  check('거른 질문: 모델 없이 refused', r.body?.status === 'refused');
  if (r.body?.id) qIds.push(r.body.id);
  const row = (await admin.from('dabooti_questions').select('*').eq('id', a.body.id).single()).data;
  check('저장: 질문·답·상태만 — 누가 물었는지 칸이 없다', row && row.question === '리더 MT 어디서 해요?' && !Object.values(row).some(v => v === uid), Object.keys(row || {}).join(','));
  const fb = await call(token, { feedback: { id: a.body.id, v: 'bad' } });
  const fbRow = (await admin.from('dabooti_questions').select('feedback').eq('id', a.body.id).single()).data;
  check("피드백: '도움이 안 됐어요'가 저장된다", fb.code === 200 && fbRow?.feedback === 'bad');
  const long = await call(token, { ask: 'x'.repeat(301) });
  check('300자 넘는 질문은 413', long.code === 413);

  // ③ 위키 읽기 · 고치기(RLS · 트리거)
  const pages = await c.from('wiki_pages').select('id').limit(5);
  check('승인된 세션은 위키 장을 읽는다', !pages.error && pages.data.length > 0);
  const up = await c.from('wiki_edits').upsert({ page_id: 'terms', item_key: 'live-test', block_key: 'words', text: '실측 글', before: '', edited_by: '00000000-0000-0000-0000-000000000000' }, { onConflict: 'page_id,item_key' }).select('edited_by').single();
  check('고친 사람은 몸통이 아니라 세션', !up.error && up.data.edited_by === uid, up.error?.message || up.data?.edited_by);
  const del = await c.from('wiki_edits').delete().eq('item_key', 'live-test').select('item_key');
  check('고친 줄 지우기는 정책이 없다(되돌리기도 고치기다)', !del.error && (del.data || []).length === 0);
  const t = await c.from('wiki_edits').insert({ page_id: 'terms', item_key: '#title', text: '실측 제목', before: '자주 쓰는 말' });
  check('마스터가 아니면 제목 줄(#)은 못 넣는다(0089)', !!t.error, t.error?.message || '들어갔다');
  const q2 = await c.from('dabooti_questions').select('id').limit(1);
  check('물어본 글 표는 세션으로 읽지 못한다(서버만)', !q2.error && q2.data.length === 0);
} catch (e) {
  check('실행', false, e.message);
} finally {
  // ── 뒤처리 ──
  await admin.from('wiki_edits').delete().in('item_key', ['live-test', '#title']).eq('page_id', 'terms');
  if (qIds.length) await admin.from('dabooti_questions').delete().in('id', qIds);
  if (uid) {
    await admin.from('activity').delete().eq('actor_id', uid);
    await admin.from('profiles').delete().eq('id', uid);
    await admin.auth.admin.deleteUser(uid);
    // 이 계정 id가 public 표 어디에도 남지 않았는지(uuid 칸 전수)
    if (process.env.SUPABASE_DB_URL) {
      const sql = `do $$ declare r record; n int; total int := 0; begin for r in select table_name, column_name from information_schema.columns where table_schema='public' and data_type='uuid' loop execute format('select count(*) from public.%I where %I = %L', r.table_name, r.column_name, '${uid}') into n; total := total + n; end loop; raise notice 'left=%', total; end $$;`;
      const p = spawnSync('psql', [process.env.SUPABASE_DB_URL, '-c', sql], { encoding: 'utf8' });
      const left = (p.stderr.match(/left=(\d+)/) || [])[1];
      check('뒤처리: 이 계정 id가 남은 칸 0', left === '0', `left=${left}`);
    }
    const qLeft = (await admin.from('dabooti_questions').select('id', { count: 'exact', head: true }).in('id', qIds.length ? qIds : ['00000000-0000-0000-0000-000000000000'])).count;
    check('뒤처리: 실측으로 만든 질문 0', qLeft === 0, String(qLeft));
  }
  if (results.some(x => !x)) process.exitCode = 1;
}
