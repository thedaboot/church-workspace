// 매 실행 전 새 세션(리프레시 토큰은 한 번 쓰면 바뀐다)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const url = process.env.VITE_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const u of st.users) {
  const password = randomBytes(18).toString('base64url');
  const r = await admin.auth.admin.updateUserById(u.id, { password }); if (r.error) throw r.error;
  const c = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email: u.email, password }); if (s.error) throw s.error;
  u.session = s.data.session;
}
writeFileSync(process.argv[2], JSON.stringify(st, null, 2));
console.log('fresh sessions', st.users.map(u => u.name).join(', '));
