// ============================================================================
// 계정 — 내 프로필 · 다녀간 시각(0019·0048) · 팀 소속(profile_teams) · 프로필 자가 복구
// ----------------------------------------------------------------------------
// ============================================================================
// myUid = **합친 계정이면 남긴 계정의 id**(0061·0063). 내 것을 읽고 쓰는 자리는
// 세션의 uid가 아니라 이 값을 봐야 한다 — 정책이 그 값으로 판정한다(§6-34-d).
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, myUid } from '../supabaseClient.js';
import { client, unwrap, accessToken } from './core.js';

// ── profiles / teams ────────────────────────────────────────────────────────
export async function getMyProfile() {
  const { data: { user } } = await client().auth.getUser();
  if (!user) return null;
  return unwrap(await client().from('profiles').select('*').eq('id', user.id).maybeSingle());
}
export async function listProfiles() {
  return unwrap(await client().from('profiles').select('*'));
}
// 다녀갔다고 찍기 — 대시보드의 '오늘 다녀간 사람'이 보는 값(0019).
// **부르는 쪽이 빈도를 정한다**: 앱을 열 때 한 번(App.initialLoad) · 화면이 보이는 동안
// 5분마다 한 번(App의 심장박동 effect · utils.dueForHeartbeat) · 떠날 때 한 번 ·
// **쓰기가 성공할 때마다(1분에 한 번 · cloudSync.markWrote · 2026-09-06)**.
// 여기에 자체 스로틀을 또 두지 않는다. 빈도가 두 군데에 적히면 어느 쪽이 진짜인지 모른다.
// 실패를 삼킨다: 이건 화면에 얼굴 하나가 덜 뜨는 일이고, 그것 때문에 앱을 못 쓰게 하지 않는다.
//
// **시각은 서버가 정한다**(0048의 `touch_last_seen()`). 예전에는 브라우저가
// `new Date()`로 만들어 보냈는데, 같은 화면에서 나란히 비교되는 `activity.created_at`은
// DB의 now()라 기기 시계가 어긋난 만큼 "1분 전 수정 · 4분 전 다녀감"이 됐다
// (이 앱은 기기 시계가 어긋난다는 것을 이미 안다 — core.js의 withClockSkewRetry).
// 0048 이전 환경을 위한 `profiles` update 폴백은 지웠다(0048이 라이브에 있다 · 2026-09-24).
export async function touchLastSeen() {
  try {
    unwrap(await client().rpc('touch_last_seen'));
  } catch (e) {
    console.warn('[cloud] 접속 시각 기록 생략:', e.message);
  }
}

// **탭을 닫는 순간의 한 번**(App의 pagehide·visibilitychange hidden).
// 평범한 fetch는 페이지가 사라지면서 취소된다 — 그래서 '떠날 때 찍기'(2026-09-05)가
// 실제로는 자주 안 남았다(라이브 확인: 마지막 쓰기보다 last_seen_at이 225초 뒤처져 있었다).
// `keepalive`는 문서가 사라진 뒤에도 요청을 끝까지 보내라는 뜻이라 이 자리에만 쓴다.
// supabase-js로는 이 옵션을 실을 수 없어 REST를 직접 부른다 — 그래서 세션 토큰도 직접 붙인다
// (`getSession`은 저장소에서 읽으므로 네트워크를 타지 않는다 · 떠나는 길에 왕복하면 늦다).
export async function stampLeaveBeacon() {
  try {
    if (!supabase || !SUPABASE_URL) return;
    const token = await accessToken();
    if (!token) return;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/touch_last_seen`, {
      method: 'POST', keepalive: true, body: '{}',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    });
  } catch { /* 떠나는 길이다 — 실패해도 남길 화면이 없다 */ }
}
// 가입 트리거가 발화하지 않아 프로필 행이 없을 수 있으므로 update 대신 upsert(행 없어도 성공)
// **남긴 계정 행에 쓴다**(0063 · §6-34-g). 화면에 보이는 것은 그 행인데 저장은 자기
// 행으로 가서, 합친 계정으로 사진·이름을 바꾸면 아무 일도 안 일어난 것처럼 보였다.
export async function updateMyProfile(patch) {
  const uid = await myUid();
  if (!uid) throw new Error('로그인이 필요합니다.');
  return unwrap(await client().from('profiles').upsert({ id: uid, ...patch }).select().single());
}
// ── 여러 팀 소속 (profile_teams) ─────────────────────────────────────────────
// 0008 마이그레이션이 아직 적용되지 않은 환경에서도 앱이 죽지 않아야 한다.
// 테이블이 없으면 빈 배열/무시로 떨어지고, 대표 팀(profiles.team_id)만으로 동작한다.
export async function listProfileTeams() {
  const { data, error } = await client().from('profile_teams').select('profile_id, team_id');
  if (error) { console.warn('[cloud] profile_teams 조회 생략:', error.message); return []; }
  return data || [];
}
export async function setMyTeams(teamIds) {
  const uid = await myUid();                  // 내 정보와 같은 행에 모은다(0063)
  if (!uid) throw new Error('로그인이 필요합니다.');
  const del = await client().from('profile_teams').delete().eq('profile_id', uid);
  if (del.error) { console.warn('[cloud] profile_teams 저장 생략:', del.error.message); return; }
  if (!teamIds.length) return;
  const rows = teamIds.map(team_id => ({ profile_id: uid, team_id }));
  const ins = await client().from('profile_teams').insert(rows);
  if (ins.error) console.warn('[cloud] profile_teams 저장 실패:', ins.error.message);
}

// 프로필 행이 없을 때 클라이언트가 직접 자기 행을 생성(RLS상 본인 insert 허용).
// **있는 행은 건드리지 않는다** — 예전 upsert는 getMyProfile이 잠깐 비어 돌아온 순간 OAuth 메타(카카오·
// 구글 기본 사진, 가입 때 이름)로 사용자가 바꿔 둔 사진·이름을 덮어썼다(2026-09-03 지적 — "내 프로필 사진이
// 갑자기 카카오 프로필로 바뀌었다"). 자가 복구는 '없으면 만들기'까지만이다.
// 카카오·구글이 준 사진 주소인가(우리 Storage가 아님). 이 주소는 **그쪽 사정으로 죽는다** —
// 카카오는 프로필 사진을 바꾸면 옛 주소가 404가 되고, 구글 lh3 주소도 갱신된다. 그러면
// Avatar가 깨진 그림을 글자 원으로 되돌려서 "갑자기 기본 프로필로 바뀌었다"가 된다
// (사용자 보고 2026-09-07 · 라이브에 카카오 5 · 구글 5 주소가 그대로 박혀 있었다).
const isProviderAvatar = (url) => /(kakaocdn\.net|googleusercontent\.com)/i.test(String(url || ''));

export async function ensureMyProfile(user) {
  const meta = user.user_metadata || {};
  const existing = await client().from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing.data) {
    // 사진이 **제공자 주소**이고 로그인으로 새 주소가 왔으면 그것으로 바꾼다 — Supabase는 OAuth
    // 로그인마다 user_metadata를 제공자 값으로 갱신하므로 여기 오는 것이 지금 살아 있는 주소다.
    // 직접 올린 사진(Storage)이나 '기본으로'(null)는 사용자의 선택이라 건드리지 않는다
    // (회차 8의 덮어쓰기 버그와 반대 방향 — 그때는 사용자 사진을 제공자 값으로 덮었다).
    // **여기는 일부러 `user.id`다** — 로그인한 계정 자기 행의 자가 복구다. 합친 계정이면
    // 0063의 `profiles_update`가 이 쓰기를 막는데(주인은 남긴 계정 하나로 모은다) 그래도
    // 된다: 화면이 읽는 사진은 남긴 계정 행의 것이고 실패는 아래에서 그냥 지나간다.
    const cur = existing.data.avatar_url;
    const fresh = meta.avatar_url || meta.picture || null;
    if (cur && fresh && cur !== fresh && isProviderAvatar(cur) && isProviderAvatar(fresh)) {
      const { data } = await client().from('profiles').update({ avatar_url: fresh }).eq('id', user.id).select().maybeSingle();
      if (data) return data;
    }
    return existing.data;
  }
  const row = {
    id: user.id,
    display_name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || null,
  };
  return unwrap(await client().from('profiles').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select().single());
}
export async function listTeams() {
  return unwrap(await client().from('teams').select('*').order('name', { ascending: true }));
}

