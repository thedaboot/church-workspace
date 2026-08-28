import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /api/drive-file — 드라이브 파일 바이트 프록시 (GET ?id=<drive_file_id>)
// ----------------------------------------------------------------------------
// 왜 필요한가: 드라이브 PDF를 앱 안의 pdf.js 뷰어로 그리고 싶은데(밝고 앱 톤에
// 맞는다 — 드라이브 파일 뷰어는 어둡고 자체 버튼이 화면을 가린다), 브라우저가
// drive.google.com에서 직접 fetch하는 것은 CORS가 막는다. 파일은 '링크를 아는
// 사람은 보기'로 공개돼 있으므로 서버는 그냥 받아올 수 있다 — 얇게 중계만 한다.
//
// 인증은 /api/drive와 같다(승인된 사용자만). 파일이 공개 링크라 해도 이 경로를
// 열어 두면 워크스페이스 밖 사람이 우리 Vercel 대역폭으로 파일을 긁을 수 있다.
//
// Cache-Control: private — 같은 사람이 같은 PDF를 다시 열면 브라우저 캐시가
// 받아서 왕복이 없다(첨부 서명 URL 50분 재사용과 같은 판단 — §1.3 Egress).
// ============================================================================

// 첨부 상한과 같은 값이다(src/config.js의 MAX_UPLOAD_MB). 이쪽이 작으면 "올라는 갔는데
// 미리보기가 안 되는" 파일이 생긴다. tests/drivesync가 두 값이 같은지 본다.
const MAX_BYTES = 25 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const id = String(req.query?.id || '');
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) { res.status(400).json({ error: '파일 id가 올바르지 않습니다.' }); return; }

  const auth = req.headers.authorization || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) { res.status(401).json({ error: '세션이 유효하지 않습니다.' }); return; }
  const { data: me } = await supabase.from('profiles').select('approved').eq('id', user.id).single();
  if (!me?.approved) { res.status(403).json({ error: '승인된 사용자만 볼 수 있습니다.' }); return; }

  // 실제 소요는 여기 로그에만 남는다 — 브라우저에서 재면 보는 사람의 회선을 재게 된다
  // (§6-29-l에서 업로드로 한 번 데인 길이다). 19MB PDF가 개발 회선에서 8-12초였다.
  const t0 = Date.now();
  try {
    // uc?export=download 는 공개 파일이면 리다이렉트를 따라 실제 바이트에 닿는다
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
    if (!r.ok) { res.status(502).json({ error: `드라이브가 파일을 주지 않았습니다 (${r.status}).` }); return; }
    const type = r.headers.get('content-type') || 'application/octet-stream';
    // 큰 파일이면 구글이 바이러스 검사 경고 HTML을 준다 — 그건 파일이 아니다
    if (type.startsWith('text/html')) { res.status(502).json({ error: '파일이 커서 드라이브가 바로 주지 않아요. 새 탭에서 열어주세요.' }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: '파일이 너무 큽니다. 새 탭에서 열어주세요.' }); return; }
    res.setHeader('Content-Type', type);
    // 30일 + immutable — drive_file_id가 가리키는 바이트는 우리 흐름에서 **불변**이다
    // (첨부는 '보기' 링크라 아무도 못 고치고, 파일을 다시 올리면 id가 새로 생긴다).
    // 예전 1시간짜리는 다음 날 같은 결산안(3.8MB)을 열 때마다 통째로 다시 받았다.
    // public이 아니라 private인 이유: 이 경로는 승인된 사용자 검사를 지나므로
    // CDN(공유 캐시)에 앉히면 그 검사가 비켜진다 — 브라우저 캐시에만 앉힌다.
    res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
    console.log(`[drive-file] ${id} ${Math.round(buf.length / 1024)}KB → 성공 (${Date.now() - t0}ms)`);
    res.status(200).send(buf);
  } catch (e) {
    console.error('[drive-file] 중계 실패:', id, e);
    res.status(502).json({ error: '드라이브에서 파일을 받아오지 못했습니다.' });
  }
}
