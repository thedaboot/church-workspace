import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /s/:type/:id → 크롤러용 OG 메타 HTML + 사람은 앱으로 리디렉션
//   type: 'p'(프로젝트) | 't'(카드).  SUPABASE_SECRET_KEY로 RLS 우회 조회(읽기 전용).
// ============================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_KO = { todo: '시작 전', doing: '진행 중', done: '완료' };
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async function handler(req, res) {
  const { type, id } = req.query;
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;
  const ogImage = `${origin}/og.png`;

  let title = '더다붓 워크스페이스';
  let description = '함께 준비하고, 함께 섬기는 청년들의 공간';
  let appUrl = '/';

  if ((type === 'p' || type === 't') && id && UUID_RE.test(id)) {
    try {
      const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
      if (type === 'p') {
        const { data } = await supabase.from('projects').select('name, description').eq('id', id).maybeSingle();
        if (data) {
          title = `더다붓 · ${data.name}`;
          description = data.description || '팀과 함께 준비하는 프로젝트예요.';
          appUrl = `/?p=${id}`;
        }
      } else {
        const { data } = await supabase.from('cards').select('title, status, due_date, project_id').eq('id', id).maybeSingle();
        if (data) {
          title = `더다붓 · ${data.title}`;
          const parts = [STATUS_KO[data.status] || ''];
          if (data.due_date) parts.push(`마감 ${data.due_date}`);
          description = parts.filter(Boolean).join(' · ') || '작업 상세';
          appUrl = `/?p=${data.project_id}&t=${id}`;
        }
      }
    } catch (e) {
      console.error('[share] 메타 조회 실패:', e);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.status(200).send(`<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${ogImage}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${ogImage}"/>
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}"/>
</head><body>
<script>location.replace(${JSON.stringify(appUrl)});</script>
<p style="font-family:sans-serif;color:#615d59">이동 중이에요… <a href="${esc(appUrl)}">여기</a>를 눌러 주세요.</p>
</body></html>`);
}
