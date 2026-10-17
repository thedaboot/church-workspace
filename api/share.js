import { adminClient, UUID_RE, STATUS, escHtml as esc } from './_lib.js';
import { isLeaderOnly } from '../src/services/visibility.js';
import { isTrashed } from './_trash.js';

// ============================================================================
// /s/:type/:id → 크롤러용 OG 메타 HTML + 사람은 앱으로 리디렉션
//   type: 'p'(프로젝트) | 't'(카드) | 'c'(동아리 — 가입 신청 QR).
//   SUPABASE_SECRET_KEY로 RLS 우회 조회(읽기 전용).
//
// 'c'는 동아리 가입 신청 QR이 가리키는 자리다(2026-09-07). `?apply=1`이 붙어 오면
// 앱 주소에도 그대로 얹어 `/?p=groups&g=<id>&apply=1`로 보낸다 — 모임 화면이 그
// 값을 보고 신청까지 한다(services/entryQuery.js의 딥링크 약속). vercel.json의
// rewrite(`/s/:type/:id`)는 나머지 쿼리를 그대로 넘긴다.
//
// **리더만 보는 프로젝트(0092)와 그 업무는 일반 문구로 낸다** — 제목·상태·마감을 싣지 않는다. 공유 카드는
// 카카오톡 미리보기처럼 로그인 없이 읽히는 자리다. 딥링크는 그대로 둔다(앱에서 리더가 아니면 RLS가 행을
// 안 줘서 대시보드로 떨어진다 — 없는 프로젝트와 같은 길).
// **잠긴 업무(0099)는 제목만** 싣는다(상태·마감은 빼고 설명 줄은 기본 문구) — 본문은 원래 싣지 않는다. 딥링크는 그대로(앱에서 잠금 판).
// ============================================================================

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
      const supabase = adminClient();
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
        const { data, error } = await supabase.from('projects').select('name, visibility').eq('id', id).maybeSingle();
        if (error) console.error('[share] 프로젝트 조회 실패:', error);
        // 휴지통(0104)에 있으면 없는 프로젝트와 같다 — 제목을 싣지 않는다
        if (data && !(await isTrashed(supabase, 'projects', id))) {
          if (!isLeaderOnly(data)) {
            title = `더다붓 · ${data.name}`;
            description = '팀과 함께 준비하는 프로젝트예요.';
          }
          appUrl = `/?p=${id}`;
        }
      } else {
        const { data, error } = await supabase.from('cards').select('title, status, due_date, project_id, locked, projects(visibility)').eq('id', id).maybeSingle();
        if (error) console.error('[share] 업무 조회 실패:', error);
        // 휴지통(0104)의 업무 · 휴지통 프로젝트의 업무는 없는 업무와 같다
        if (data && !(await isTrashed(supabase, 'cards', id)) && !(await isTrashed(supabase, 'projects', data.project_id))) {
          if (!isLeaderOnly(data.projects)) {
            title = `더다붓 · ${data.title}`;
            const parts = [STATUS[data.status] || ''];
            if (data.due_date) parts.push(`마감 ${data.due_date}`);
            // 잠긴 업무(0099)는 제목만 — 상태·마감도 싣지 않는다(설명 줄은 기본 문구 그대로)
            if (!data.locked) description = parts.filter(Boolean).join(' · ') || '업무 상세';
          }
          appUrl = `/?p=${data.project_id}&t=${id}`;
        }
      }
    } catch (e) {
      console.error('[share] 메타 조회 실패:', e);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // CDN에 두지 않는다 — 잠그거나 '리더만 보기'로 바꾼 뒤 5분 동안 옛 제목이 미리보기로 나가던 틈(2026-10-14)
  res.setHeader('Cache-Control', 'no-store');
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
