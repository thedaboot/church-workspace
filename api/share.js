import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /s/:type/:id → 크롤러용 OG 메타 HTML + 사람은 앱으로 리디렉션
//   type: 'p'(프로젝트) | 't'(카드) | 'c'(동아리 — 가입 신청 QR).
//   SUPABASE_SECRET_KEY로 RLS 우회 조회(읽기 전용).
//
// 'c'는 동아리 가입 신청 QR이 가리키는 자리다(2026-09-07). `?apply=1`이 붙어 오면
// 앱 주소에도 그대로 얹어 `/?p=groups&g=<id>&apply=1`로 보낸다 — 모임 화면이 그
// 값을 보고 신청까지 한다(services/entryQuery.js의 딥링크 약속). vercel.json의
// rewrite(`/s/:type/:id`)는 나머지 쿼리를 그대로 넘긴다.
// ============================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 라벨은 config.js의 STATUSES와 같은 글자다 — 한쪽만 고치면 공유 카드와 앱이 갈린다.
const STATUS_KO = { todo: '시작 전', doing: '진행 중', hold: '보류 중', done: '완료' };
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async function handler(req, res) {
  const { type, id } = req.query;
  const wantApply = req.query.apply === '1';
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${host}`;
  const ogImage = `${origin}/og.png`;

  let title = '더다붓 워크스페이스';
  let description = '함께 준비하고, 함께 섬기는 청년들의 공간';
  let appUrl = '/';

  if ((type === 'p' || type === 't' || type === 'c') && id && UUID_RE.test(id)) {
    try {
      const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
      if (type === 'c') {
        // **name만 고른다.** groups에 `description` 칸은 없고(0035 — 설명 칸의 이름은
        // `note`다) 설명 문구는 아래처럼 못 박은 한 줄이라 읽을 것이 없다. 없는 칸을
        // 고르면 42703으로 조용히 비는 자리가 또 생긴다(아래 projects 주석의 그 함정).
        const { data, error } = await supabase.from('groups').select('name').eq('id', id).maybeSingle();
        if (error) console.error('[share] 동아리 조회 실패:', error);
        if (data) {
          title = `더다붓 · ${data.name}`;
          description = '가입 신청은 이 링크에서 할 수 있어요.';
          appUrl = `/?p=groups&g=${id}${wantApply ? '&apply=1' : ''}`;
        }
      } else if (type === 'p') {
        // projects에 description 컬럼은 없다(0009에서 지웠다 — HANDOFF §5). 없는 칸을
        // 고르면 PostgREST가 42703으로 던지고 data가 null이 되어, OG 제목이 기본값으로
        // 떨어지고 appUrl이 '/'로 남아 **딥링크까지 사라졌다**.
        const { data, error } = await supabase.from('projects').select('name').eq('id', id).maybeSingle();
        if (error) console.error('[share] 프로젝트 조회 실패:', error);
        if (data) {
          title = `더다붓 · ${data.name}`;
          description = '팀과 함께 준비하는 프로젝트예요.';
          appUrl = `/?p=${id}`;
        }
      } else {
        const { data, error } = await supabase.from('cards').select('title, status, due_date, project_id').eq('id', id).maybeSingle();
        if (error) console.error('[share] 업무 조회 실패:', error);
        if (data) {
          title = `더다붓 · ${data.title}`;
          const parts = [STATUS_KO[data.status] || ''];
          if (data.due_date) parts.push(`마감 ${data.due_date}`);
          description = parts.filter(Boolean).join(' · ') || '업무 상세';
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
