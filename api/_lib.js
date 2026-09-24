import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { isApprovedProfile } from '../src/services/approval.js';

// ============================================================================
// api/ 공용 머리 — 몸통 읽기 · 세션 확인 · 승인 확인 · 비밀 비교 (보안 감사 2026-09-24)
// ----------------------------------------------------------------------------
// **이름이 `_`로 시작하면 Vercel이 라우트로 만들지 않는다** — 형제 파일이 import만 한다.
// dev 서버(vite.config.js의 devApiFunctions)도 같은 규칙으로 `_`파일을 건너뛴다.
// tests/push.mjs가 api/push.js를 노드에서 import하므로 여기도 노드에서 그대로 돌아야 한다
// (브라우저 모듈을 끌어오지 않는다 — approval.js는 순수 모듈이다).
//
// 왜 한 곳으로 모았나: 인증 머리 다섯 벌이 서로 달랐다. drive·drive-file은 승인까지
// 봤는데 ai·yt·push(POST)는 **로그인만** 봐서, 승인 전 계정도 제미나이·유튜브 키와
// 푸시 발송을 쓸 수 있었다. 한 벌이면 새 라우트가 그 확인을 빼먹을 자리가 없다.
// ============================================================================

export const adminClient = () => createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Vercel은 content-type이 json이면 req.body에 파싱된 객체를 넣어 준다(dev 서버도 흉내낸다).
// 없으면 스트림을 직접 읽는다. 깨진 JSON은 빈 객체다 — 부르는 쪽이 칸이 없다고 400을 낸다.
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export const bearer = (req) => {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
};

// 관리자는 `admins` 표(이메일)가 원본이다(0022). DB의 is_approved()도 `or is_admin()`이다.
export async function isAdminEmail(supabase, email) {
  if (!email) return false;
  const { data } = await supabase.from('admins').select('email').ilike('email', email);
  return !!(data && data.length);
}

// 세션 → 승인된 사람인지. 통과하면 user를, 아니면 401/403을 **써 놓고** null을 돌려준다
// (부르는 쪽은 `if (!user) return;` 한 줄).
// **합친 계정은 남긴 계정의 칸을 본다**(services/approval.js · 0063) — 서비스 키라 DB의
// is_approved()를 못 쓴다. 관리자 표는 승인 칸이 아닐 때만 본다 — 승인된 사람(거의 전부)
// 에게는 답이 이미 정해져 있어 왕복을 하나 아낀다(2026-09-08 api/drive.js의 판단 그대로).
export async function requireApprovedUser(req, res, { supabase = null, forbidden = '승인된 사용자만 쓸 수 있습니다.' } = {}) {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: '인증이 필요합니다.' }); return null; }
  supabase = supabase || adminClient();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) { res.status(401).json({ error: '세션이 유효하지 않습니다.' }); return null; }
  if (await isApprovedProfile(supabase, user.id)) return user;
  if (await isAdminEmail(supabase, user.email)) return user;
  console.error('[api] 승인 확인 실패:', user.email);
  res.status(403).json({ error: forbidden });
  return null;
}

// 합친 계정이면 남긴 계정의 id, 아니면 자기 id — DB의 effective_uid()와 같은 규칙(0061).
// "내 것인가"는 두 id를 다 내 것으로 본다(§6-34-i) — 그래서 집합으로 돌려준다.
export async function myIds(supabase, uid) {
  const { data } = await supabase.from('profiles').select('merged_into').eq('id', uid).maybeSingle();
  return new Set([uid, data?.merged_into].filter(Boolean));
}

// 비밀 값 비교(크론). `===`는 첫 다른 글자에서 멈춰 걸린 시간으로 앞자리를 흘린다.
// timingSafeEqual은 길이가 다르면 던지므로 길이를 먼저 본다(길이는 비밀이 아니다).
export function safeEqual(given, secret) {
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(String(secret ?? ''), 'utf8');
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// 우리 출처 안의 경로인가 — 앞글자만 보면 `'/\t/evil.com'`이 통과하고, 브라우저의 URL
// 파서가 탭을 지워 `//evil.com`(남의 출처)으로 읽는다. 브라우저와 같은 파서로 풀어 본다.
// public/sw.js의 알림 클릭도 같은 규칙이다(그쪽은 self.location.origin을 쓴다).
const PROBE_ORIGIN = 'https://thedaboot.invalid';
export function sameOriginPath(link) {
  if (typeof link !== 'string' || !link.startsWith('/')) return null;
  try {
    const u = new URL(link, PROBE_ORIGIN);
    return u.origin === PROBE_ORIGIN ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch { return null; }
}
