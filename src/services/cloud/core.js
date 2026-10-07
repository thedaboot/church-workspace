// ============================================================================
// 클라우드 영속 계층의 바탕 — 클라이언트 · unwrap · 시계 오차 재시도 · 상태 매핑 · 세션 · 로그인 토큰 붙인 /api 호출
// ----------------------------------------------------------------------------
// cloud/의 다른 파일과 v2 서비스(worship·groups·word·people)가 여기서 가져간다. 부르는 쪽은 보통 cloud.js(바렐)를 문다.
// ============================================================================
import { supabase } from '../supabaseClient.js';
import { CONFIG } from '../../config.js';

// ============================================================================
// 6. Persistence Layer — Supabase 클라우드 영속 계층
// ----------------------------------------------------------------------------
// 도메인별 async 함수. 모두 supabaseClient의 단일 인스턴스를 사용하며,
// 미설정(게스트 모드) 상태에서 호출되면 명확한 Error를 던진다.
// ============================================================================

export const client = () => {
  if (!supabase) throw new Error('클라우드에 연결되지 않은 모드예요'); // 게스트·개발(VITE_SUPABASE_URL 미설정)에서만
  return supabase;
};

// { data, error } 언래핑 헬퍼 — 오류 객체를 **그대로** 던진다(message·code·details가 남아야 errorText가 이유를 가른다).
// v2 서비스(worship·groups·word·people)의 `if (error) throw error`도 이 한 벌이다.
export const unwrap = ({ data, error }) => { if (error) throw error; return data; };

// ── PGRST303 (JWT issued at future) 자동 재시도 ─────────────────────────────
// 기기 시계가 서버보다 앞서 있으면 발급 시각이 미래인 JWT가 되어 거부된다.
// 잠깐 기다리면 서버 시각이 따라잡으므로 대기 후 재시도하고, 한 번은 세션도 갱신한다.
const isClockSkewError = (err) => {
  const code = err?.code || '';
  const msg = `${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return code === 'PGRST303' || (msg.includes('jwt') && msg.includes('future'));
};
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 클라우드 호출을 감싸 시계 오차 오류에 한해 재시도 (최대 2회 추가 시도)
export async function withClockSkewRetry(fn, { retries = 2, delay = 1500 } = {}) {
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isClockSkewError(err) || attempt >= retries) throw err;
      console.warn(`[cloud] JWT 시각 오차 감지 — ${delay}ms 후 재시도 (${attempt + 1}/${retries})`);
      if (!refreshed) {
        refreshed = true;
        try { await supabase?.auth.refreshSession(); } catch (e) { console.warn('[cloud] 세션 갱신 실패:', e); }
      }
      await sleep(delay);
    }
  }
}

// ── 상태 매핑: DB 'todo'|'doing'|'hold'|'done' ↔ 앱 '시작 전'|'진행 중'|'보류 중'|'완료' ──
// 이름 기준 매핑(CONFIG.STATUS_DB) — 보드 컬럼 순서를 바꿔도 DB 값이 어긋나지 않는다.
const APP_BY_DB = Object.fromEntries(Object.entries(CONFIG.STATUS_DB).map(([app, db]) => [db, app]));
export const statusToDb = (appStatus) => CONFIG.STATUS_DB[appStatus] || 'todo';
export const statusFromDb = (dbStatus) => APP_BY_DB[dbStatus] || CONFIG.STATUSES[0];

// ── 인증 ──────────────────────────────────────────────────────────────────
// 로그인·로그아웃은 auth.jsx가 supabase 클라이언트로 직접 한다(여기 있던 래퍼는
// 아무도 쓰지 않아 지웠다). 세션 조회만 여러 곳에서 필요하다.
export async function getSession() {
  const { data } = await client().auth.getSession();
  return { session: data.session, user: data.session?.user || null };
}

// 로그인 토큰 — 없으면 undefined. 게스트(supabase 없음)에서는 client()가 던진다 —
// 게스트를 따로 가르는 자리(유튜브·AI·위키…)는 부르는 쪽이 먼저 본다.
// **`getSession()`은 supabase의 `{ data }`를 이미 벗겨서 `{ session, user }`를
// 돌려준다.** 여기서 `.access_token`을 바로 꺼내면 언제나 undefined였고, 그래서
// 앱에서 올리는 첨부가 **한 번도 드라이브로 가지 못했다**(§6-29와 같은 함정을
// 그대로 다시 밟았다 — 그 항목이 "한 겹 더 벗기면 조용히 undefined가 되고,
// 그 자리가 아무도 안 걸리는 필터가 된다"고 적어 둔 바로 그것이다 · 옛 driveOnce 자리).
export const accessToken = async () => (await getSession())?.session?.access_token;

// 로그인 토큰을 붙여 우리 /api에 JSON을 POST한다 → fetch의 Response 그대로.
// 상태·몸통을 읽는 법은 자리마다 다르다(드라이브의 501·scriptError · 유튜브의 이유 글 · AI의 안내 글) — 그건 부르는 쪽 몫이다.
// 토큰이 없을 때 할 일도 다르다 — 던지기(드라이브·유튜브·달력) · null(공개 링크) · 안내 글(AI) · 조용히(푸시):
//   noToken  주면 보내지 않고 그 함수의 값을 돌려준다(던지면 그대로 던진다).
//            안 주면 토큰 없이도 보낸다(위키 — 서버가 401로 답한다).
//   token    먼저 물어보고 갈래를 탄 자리가 쥔 토큰(undefined여도 그 값을 쓴다) · signal 끊기
export async function authedPost(path, body, opts = {}) {
  const { signal, noToken } = opts;
  const t = 'token' in opts ? opts.token : await accessToken();
  if (!t && noToken) return noToken();
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
    signal,
  });
}
