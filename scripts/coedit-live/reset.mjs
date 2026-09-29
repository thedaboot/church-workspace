// 매 실행 전 업무를 처음 모양으로(본문·제목·상태) + 같이 쓰기 기록·버전 비우기
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const t of ['card_doc_updates', 'card_docs', 'card_doc_versions']) { const r = await db.from(t).delete().eq('card_id', st.cardId); if (r.error) throw r.error; }
const r = await db.from('cards').update({ title: '동시편집 검증 업무', status: 'todo', description: st.md }).eq('id', st.cardId); if (r.error) throw r.error;
console.log('reset ok');
