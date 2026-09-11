import { createClient } from '@supabase/supabase-js';
import { isApprovedProfile } from '../src/services/approval.js';

// ============================================================================
// /api/drive — 개인 구글 드라이브(Apps Script 웹앱) 프록시
// ----------------------------------------------------------------------------
// 브라우저가 스크립트 URL·토큰을 알면 안 되므로 서버가 대신 부른다(api/ai.js와
// 같은 패턴). 요구: Authorization: Bearer <supabase access token>.
//
// 왜 Apps Script인가: 개인 지메일 드라이브는 서비스 계정으로 접근할 수 없다
// (소유권도 용량도 가질 수 없다). 소유자 계정으로 실행되는 스크립트가 유일하게
// 남는 길이다. 배경은 docs/DRIVE.md, 붙여넣는 코드는 docs/APPS_SCRIPT.md.
//
// **몸통 한도가 4.5MB다**(실측 2026-08-28: 4MB는 함수까지 가고 4.4MB부터 413
// FUNCTION_PAYLOAD_TOO_LARGE). base64가 33%를 붙이니 실제 파일은 3.3MB가 천장이고,
// 그보다 크면 **이 함수에 닿지도 못한 채** 가장자리에서 잘린다 — 아래 한국어 이유가
// 나올 기회조차 없다. 그래서 큰 파일은 브라우저가 Storage에 직접 올리고 여기로는
// **주소만** 온다(action: 'uploadFromUrl' · cloud.uploadViaStorage).
// 사진은 그와 별개로 올리기 전에 줄인다(src/services/image.js · 긴 변 2560px).
// ============================================================================

// 클라이언트(attachments.jsx의 MAX_UPLOAD_MB)와 **같은 값이어야 한다.**
// 여기가 더 크면 화면이 막지 않은 파일이 스크립트에서 시간 초과로 죽고, 더 작으면
// 화면이 허락한 파일이 서버에서 거절된다. tests/drivesync.mjs가 둘을 맞춰 본다.
const MAX_MB = 25;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const ACTIONS = new Set(['upload', 'uploadFromUrl', 'ensureFolder', 'renameFolder', 'trash', 'list', 'convert', 'grantEditors']);

// 변환 사본에 편집자를 붙이는 두 액션(Apps Script v11). 명단은 **여기서 채운다** —
// 이유는 아래 editorsFor.
const EDITOR_ACTIONS = new Set(['convert', 'grantEditors']);
// 형식만 본다. 구글 계정인지는 우리가 알 길이 없고, 드라이브가 모르는 주소는
// 스크립트가 그 한 줄만 삼킨다(docs/APPS_SCRIPT.md addEditors).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EDITORS = 20;

// 사본을 고칠 수 있는 계정 = **부르는 사람 + 관리자·마스터 전원**(사용자 결정 2026-09-11).
// 업무 첨부는 올린 사람이 부르는 쪽이고, '구글 문서에서 편집'을 누른 사람도 마찬가지다.
//
// **왜 브라우저가 아니라 서버가 명단을 채우나**: `admins` 표는 관리자에게만 열려 있다
// (0022 `admins_select`). 일반 사용자가 그대로 읽으면 오류가 아니라 **0행**이 오므로,
// 클라이언트에서 만들면 관리자가 빠진 채 편집자가 붙고 아무도 그것을 모른다.
// 여기는 보안 키로 읽는다. 덤으로 관리자 이메일 명단이 브라우저로 나가지 않는다.
// **빈 배열이라도 보냈으면 채운다 — 안 보냈으면 손대지 않는다.** 큐시트는 `cueEditors`
// 하나만 보내고 편집자는 스크립트의 `CUE_EDITORS` 둘뿐이라(사용자 결정 2026-09-09),
// 여기서 관리자를 얹으면 그 결정이 조용히 넓어진다.
// 왕복 하나가 붙지만 이 두 액션만이다 — 사진·PDF는 사본이 없어 `convert`를 안 부르고,
// 업로드(`upload`)에서 관리자 표를 다시 묻던 것은 2026-09-08에 걷었다(§6-29 머리말).
async function editorsFor(supabase, body, user) {
  const asked = body.editors;
  const { data: admins } = await supabase.from('admins').select('email');
  const all = [user.email, ...asked, ...(admins || []).map(a => a.email)];
  const seen = new Set();
  const out = [];
  for (const raw of all) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e || seen.has(e) || !EMAIL_RE.test(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= MAX_EDITORS) break;
  }
  return out;
}

// 스크립트가 이 시간 안에 답하지 않으면 **우리가 먼저 끊는다.**
// 안 끊으면 함수가 죽을 때까지 매달리고, 그때 브라우저가 받는 것은 JSON이 아니라
// 플랫폼 오류 페이지다 → 부르는 쪽이 이유를 못 읽어 "드라이브가 응답하지 않았어요
// (504)"만 뜬다(사용자 신고). 직접 끊으면 한국어 이유를 실어 보낼 수 있다.
//
// 바닥값은 4초쯤이다(폴더 만들기 3.5초 · 100KB 4.3초 — 대부분 Apps Script 자체 비용).
// 짧게 잡으면 정상 업로드가 끊긴다. vercel.json의 maxDuration(60초)보다는 짧아야
// 플랫폼보다 우리가 먼저 잡는다.
//
// 큰 파일의 실제 소요는 **여기서 잰 값을 믿지 마세요** — 2026-08-28에 개발 기기에서
// 잰 값(20MB 59초/121초)은 재는 사람의 업로드 회선이었다. 진짜 값은 아래 성공 로그
// (`→ 성공 (N ms)`)에 남으므로 배포 뒤 그것으로 정한다.
const SCRIPT_BUDGET_MS = 55 * 1000;
// body는 그대로 넘긴다(projectName·path·cardTitle·folderId 등) — 폴더 구조를 바꿀 때
// 여기를 같이 고칠 필요가 없다. 검사하는 것은 action과 파일 크기뿐이다.

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const url = process.env.DRIVE_WEBAPP_URL;
  const token = process.env.DRIVE_WEBAPP_TOKEN;
  // 키가 없는 환경(로컬·프리뷰)에서도 앱은 돌아야 한다 — 첨부가 Storage로 떨어진다.
  // 501을 보고 부르는 쪽이 예전 경로로 되돌린다(푸시 알림이 없는 환경과 같은 처리).
  if (!url || !token) { res.status(501).json({ error: '드라이브가 아직 설정되지 않았습니다.' }); return; }

  const auth = req.headers.authorization || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!accessToken) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !user) { res.status(401).json({ error: '세션이 유효하지 않습니다.' }); return; }

  // 승인된 사람만(0022). 로그인만으로 드라이브에 파일을 쌓게 두면 승인 절차가
  // 무의미해진다 — RLS는 DB만 지키고 이 경로는 DB를 거치지 않는다.
  // **관리자 표는 승인 칸이 아닐 때만 본다**(2026-09-08). 예전에는 둘을 언제나 물어서
  // 업로드마다 왕복이 하나씩 더 붙었다 — 승인된 사람(거의 전부)에게는 답이 이미 정해져 있다.
  // **합친 계정은 남긴 계정의 칸을 본다**(services/approval.js · 0063). 여기는 서비스
  // 키라 DB의 is_approved()를 쓸 수 없어서, 합친 계정으로 로그인하면 첨부 업로드가
  // 통째로 403이었다(그 행은 환송 처리라 approved = false다).
  const approved = await isApprovedProfile(supabase, user.id);
  if (!approved) {
    const { data: admin } = await supabase.from('admins').select('email').ilike('email', user.email || ' ');
    if (!(admin && admin.length)) {
      console.error('[drive] 승인 확인 실패:', user.email);
      res.status(403).json({ error: '승인된 사용자만 파일을 올릴 수 있습니다.' });
      return;
    }
  }

  const body = await readJson(req);
  const action = body.action || 'upload';
  if (!ACTIONS.has(action)) { res.status(400).json({ error: '알 수 없는 요청입니다.' }); return; }

  if (action === 'upload') {
    const b64 = String(body.dataBase64 || '');
    // base64 길이로 원본 크기를 가늠한다(정확히 3/4). 여기서 막지 않으면 Apps
    // Script가 실행 시간 제한에 걸려 끝나는데, 그때는 원인을 알려줄 방법이 없다.
    if (!b64) { res.status(400).json({ error: '파일 내용이 없습니다.' }); return; }
    if (b64.length * 0.75 > MAX_BYTES) { res.status(413).json({ error: `${MAX_MB}MB를 넘는 파일은 올릴 수 없어요` }); return; }
  }

  // 편집자 명단은 **여기서** 만든다(위 editorsFor). 브라우저가 보낸 목록은 재료일 뿐이고,
  // 실제로 나가는 것은 부르는 사람 + 관리자·마스터다.
  if (EDITOR_ACTIONS.has(action) && Array.isArray(body.editors)) {
    body.editors = await editorsFor(supabase, body, user);
  }

  // 무엇이 막혔는지 서버에도 남긴다. 첨부가 안 올라가는데 화면에도 로그에도
  // 아무 단서가 없어서 짐작만 하게 된 적이 있다(사용자 지적).
  const tag = `[drive] ${action} ${body.name || body.projectName || ''}`.trim();
  const started = Date.now();
  const ctl = new AbortController();
  const killer = setTimeout(() => ctl.abort(), SCRIPT_BUDGET_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, action, token }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let out;
    try { out = JSON.parse(text); } catch { out = { error: `드라이브 응답을 읽지 못했습니다 (${r.status}).` }; }
    // 스크립트는 실패해도 200으로 돌려주므로 error 키로 판정한다
    if (out.error) {
      console.error(`${tag} → 스크립트 오류(${Date.now() - started}ms):`, out.error, '| http', r.status);
      // 스크립트가 **스스로** 뱉은 오류다(권한 부족·모르는 액션 등) — 대개 다시 해도
      // 같다. 부르는 쪽이 헛되이 재시도하지 않게 표시를 실어 보낸다.
      res.status(502).json({ error: String(out.error), scriptError: true });
      return;
    }
    console.log(`${tag} → 성공 (${Date.now() - started}ms)`);
    res.status(200).json(out);
  } catch (e) {
    const ms = Date.now() - started;
    // 시간 초과는 502가 아니라 504로 돌려준다 — 부르는 쪽이 "다시 해볼 만한 실패"와
    // "다시 해도 소용없는 실패"를 가를 수 있어야 한다.
    if (e?.name === 'AbortError') {
      console.error(`${tag} → 시간 초과 (${ms}ms)`);
      // 쓰는 사람에게 초 단위는 아무 소용이 없다 — 무엇이 막혔고 무엇을 하면 되는지만
      // 말한다(사용자 결정). 몇 초 걸렸는지는 위 서버 로그에 남는다.
      // 줄바꿈은 토스트가 그대로 그린다(Toast.jsx의 whitespace-pre-line).
      res.status(504).json({
        error: `드라이브에 파일을 올리는 데 문제가 있어요\n개발자에게 알려주시고, 잠시 뒤 다시 시도해주세요`,
        timeout: true,
      });
      return;
    }
    // 닿지 못한 경우도 쓰는 사람에게는 같은 종류의 일이다. 다만 원문은 붙여 둔다 —
    // 아는 코드가 하나도 없을 때 원문마저 없으면 원인을 영영 못 본다(§6-29-e).
    console.error(`${tag} → 닿지 못함 (${ms}ms):`, e?.message || e);
    res.status(502).json({ error: `드라이브에 파일을 올리는 데 문제가 있어요\n개발자에게 알려주시고, 잠시 뒤 다시 시도해주세요\n(${e.message || e})` });
  } finally {
    clearTimeout(killer);
  }
}
