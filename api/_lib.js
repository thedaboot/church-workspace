import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual, createHash } from 'node:crypto';
import { isApprovedProfile } from '../src/services/approval.js';

// ============================================================================
// api/ 공용 머리 — 몸통 읽기 · 세션 확인 · 승인 확인 · 비밀 비교 (보안 감사 2026-09-24)
//   + 작은 공용 값(UUID · 상태 글자 · 예배 이름 · HTML 이스케이프 · 해시 · 살아 있는 가입자) · Gemini 한 번(19차)
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
// 401의 이유는 화면에 그대로 선다(드라이브·유튜브 중계가 out.error를 err.human으로 싣는다) —
// '세션이 유효하지 않습니다' 같은 기술 용어 대신 errorText의 401 문구와 같은 두 줄(§8).
const LOGIN_AGAIN = '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요';
export async function requireApprovedUser(req, res, { supabase = null, forbidden = '승인된 사용자만 쓸 수 있습니다.' } = {}) {
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: LOGIN_AGAIN }); return null; }
  supabase = supabase || adminClient();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) { res.status(401).json({ error: LOGIN_AGAIN }); return null; }
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

// ── 여러 라우트가 같이 쓰는 작은 것들 (19차 리팩토링 — 사본 둘·셋을 한 벌로) ──────────────
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 업무 상태 글자 — config.js의 STATUSES와 같은 글자다(한쪽만 고치면 공유 카드·위키·다붓이와 앱이 갈린다)
export const STATUS = { todo: '시작 전', doing: '진행 중', hold: '보류 중', done: '완료', ongoing: '상시' };
// 예배 종류 이름 — services/serviceView.js kindLabel과 같은 글자(push·ics는 브라우저 모듈을 물지 않는다)
export const SUNDAY_LABEL = '주일 4부 젊은이 예배';
export const serviceKindLabel = (kind) => (kind === 'sunday' ? SUNDAY_LABEL : (kind || '예배'));
// HTML 속성·본문에 넣을 글자(공유 카드 · 주보 공개 보기)
export const escHtml = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// sha256 16진 — len을 주면 앞에서 그만큼만(위키 원본 해시는 24자 · 문서 조각 해시는 통째로)
export const sha256 = (s, { len = 0 } = {}) => {
  const h = createHash('sha256').update(String(s), 'utf8').digest('hex');
  return len ? h.slice(0, len) : h;
};
// 살아 있는 가입자 — 승인 · 환송 안 됨 · 합쳐지지 않음 · 표시 이름 있음(위키 명단 · 다붓이 사람 줄·생일)
export const liveProfile = (p) => !!(p && p.approved && !p.removed_at && !p.merged_into && String(p.display_name || '').trim());

// ── Gemini 한 번 ─────────────────────────────────────────────────────────────
// 주소 · 키 머리 · 시간 상한만 한 벌이다. 다시 부르기 · 오류 가르기 · 답 읽기는 부르는 쪽마다 달라서 거기에 둔다
// (위키는 429·503을 다시 부르고, /api/ai는 504·502로 가르고, 문서 임베딩은 남은 시간 안에서만 다시 부른다).
// ms가 지나면 fetch와 몸통 읽기가 TimeoutError로 끊긴다 — 판정은 isTimeout 하나로(AbortError가 아니다).
// lenient: 몸통이 JSON이 아니면 {}로(문서 임베딩 — 상태 코드로 가른다).
export const geminiUrl = (model, method = 'generateContent') => `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
export async function geminiFetch(model, method, body, { key = process.env.GEMINI_API_KEY, ms, lenient = false } = {}) {
  const r = await fetch(geminiUrl(model, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const j = lenient ? await r.json().catch(() => ({})) : await r.json();
  return { r, j };
}
// 우리가 정한 시간 상한에 끊겼나 — AbortSignal.timeout은 AbortError가 아니라 TimeoutError를 낸다
export const isTimeout = (e) => e?.name === 'TimeoutError';
