// ============================================================================
// 관리 — 화면 가림 비밀번호(첨부 0023 · 참고 링크 0053) · 멤버 승인·환송(0022·0027) · 관리자 · 계정 합치기(0059) · 내 달력 구독(0085)
// ----------------------------------------------------------------------------
// 권한의 경계는 DB 정책이다 — 화면에서 감추는 것과 이중으로 걸린다.
// ============================================================================
import { client, unwrap, getSession, authedPost } from './core.js';
// 화면 가림 비밀번호 계산(setFilePassword · setLinkPassword)은 viewPw.js가 원본이다. 순수 모듈이라 여기서
// 가져다 써도 supabase가 딸려 가지 않는다(반대 방향은 안 된다 — viewPw.js 머리말).
import { makeViewPw, verifyViewPw } from '../viewPw.js';

// ── 첨부 비밀번호 (0023) ────────────────────────────────────────────────────
// **화면을 가리는 잠금이다. 파일 자체를 잠그지 않는다.** 주소를 직접 아는 사람은
// 그대로 열 수 있다 — 같이 일하는 사람들 사이에서 실수로 여는 것을 막는 수준이고,
// 그 이상으로 읽히게 만들면 안 된다(0023 주석에 이유가 있다). 화면 문구에
// '암호화'라는 말을 쓰지 않는 이유다.
// 해시·소금 만들기는 `services/viewPw.js` 한 벌이다 — 예전에는 같은 계산이 여기에도
// 그대로 적혀 있어서, 한쪽을 고치면 걸어 둔 비밀번호가 다른 쪽에서 안 풀렸다.
// 여기 남는 것은 **DB 세 칸을 쓰는 일**뿐이다(view_pw · view_pw_salt · view_pw_by).
// 빈 비밀번호 = 잠금 풀기 — 소금만 남기지 않고 세 칸을 다 지운다(viewPw.makeViewPw가
// 앞 두 칸을 null로 주고, 건 사람 칸은 여기서 같이 비운다).
async function setViewPassword(table, id, password) {
  const cols = await makeViewPw(password);
  // 잠금을 풀 때는 건 사람도 지운다 — 세션을 물어볼 이유도 없다
  const view_pw_by = cols.view_pw ? ((await getSession())?.user?.id ?? null) : null;
  return unwrap(await client().from(table)
    .update({ ...cols, view_pw_by })
    .eq('id', id).select().single());
}

export const setFilePassword = (fileId, password) => setViewPassword('files', fileId, password);
export const checkFilePassword = (row, password) => verifyViewPw(row, password);

// ── 멤버 관리 (0022) ────────────────────────────────────────────────────────
// 전역 '멤버' 화면이 쓴다. 관리자만 의미가 있지만 정책이 DB에서 막으므로
// 화면에서 감추는 것과 이중으로 걸린다(§4.5의 요약 고정과 다른 점이다).
export async function listMembersAdmin() {
  return unwrap(await client().from('profiles')
    // merged_into(0060) — 값이 있으면 **합쳐서 환송된 계정**이다. 그냥 환송된 계정과
    // 겉모습이 같아서(approved=false + removed_at) 이 칸이 없으면 '다시 초대하기'가
    // 그 계정을 빈 중복으로 되살린다.
    .select('id, display_name, email, avatar_url, approved, approved_at, removed_at, created_at, last_seen_at, birthday, merged_into')
    .order('created_at', { ascending: true }));
}

// 승인·승인 취소(=내보내기). 내보내면 접근만 끊기고 지난 기록의 이름은 남는다.
// 환송(approved=false)은 `removed_at`을 같이 찍는다 — 그래야 '승인을 기다리는
// 사람'으로 다시 올라오지 않는다(0027). 다시 부르면 지운다.
export async function setApproved(profileId, approved) {
  const me = (await getSession())?.user?.id ?? null;
  const now = new Date().toISOString();
  return unwrap(await client().from('profiles')
    .update(approved
      ? { approved: true, approved_at: now, approved_by: me, removed_at: null, removed_by: null }
      : { approved: false, removed_at: now, removed_by: me })
    .eq('id', profileId).select('id, approved, removed_at').single());
}

// 관리자 목록·지정·해제. admins는 이메일이 원본이고 profiles에는 email이 없어서
// 화면은 auth 쪽 이메일을 손으로 넣는다(가입자 목록에서 고르는 길은 profiles에
// 이메일이 없어 막혀 있다 — 0022 주석 참고).
export async function listAdmins() {
  return unwrap(await client().from('admins').select('email, is_master').order('email'));
}
export async function addAdmin(email) {
  return unwrap(await client().from('admins').insert({ email: String(email).trim().toLowerCase() }).select('email').single());
}
export async function removeAdmin(email) {
  unwrap(await client().from('admins').delete().eq('email', String(email).trim().toLowerCase()));
}

// ── 참고 링크 비밀번호 (0053) ───────────────────────────────────────────────
// 첨부(0023)와 **같은 화면 가림**이다 — 링크 자체를 잠그지 않는다. 주소를 직접 아는
// 사람은 그대로 연다. 그래서 화면 문구에 '암호화'라는 말을 쓰지 않는다.
// 계산도 칸도 첨부와 같으므로 위의 setViewPassword 한 벌을 그대로 쓴다
// (주보 큐시트는 services 행의 jsonb 한 칸이라 이 경로를 안 지나고, viewPw.js를 직접 쓴다).
export const setLinkPassword = (linkId, password) => setViewPassword('resource_links', linkId, password);

// 한 사람의 두 계정 합치기(0059 · 마스터만 — 자격은 DB 함수가 본다). 남기는 계정으로
// **계정 축 참조를 다 옮기고** 합친 계정은 환송 처리된다. 되돌릴 수 없다 — 부르는 쪽이
// 확인을 먼저 받아야 한다. 돌려주는 jsonb는 무엇이 몇 건 옮겨졌는지다(화면 문구에 쓴다).
export async function mergeProfiles(keepId, dropId) {
  const data = unwrap(await client().rpc('merge_profiles', { p_keep: keepId, p_drop: dropId }));
  return data || {};
}

// ── 내 달력 구독 (0085 · api/ics.js · services/calendarFeed.js) ──────────────
// cards를 빼면 저장된 것을 묻는다({ cards: null }이면 아직 없다), 주면 **고른 것 전체**로 덮는다
// (차이가 아니라 전체라 같은 요청이 두 번 가도 결과가 같다). → { cards, url, webcal }
export async function projectCalendarFeed(projectId, cards) {
  const r = await authedPost('/api/ics', cards === undefined ? { project: projectId } : { project: projectId, cards }, {
    noToken: () => { const e = new Error('로그인이 필요해요'); e.status = 401; throw e; },
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(out.error || `calendar feed ${r.status}`); e.status = r.status; throw e; }
  return out;
}
