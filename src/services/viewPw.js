// ============================================================================
// 화면 가림용 비밀번호 — 참고 링크 · 주보 큐시트 (0053)
// ----------------------------------------------------------------------------
// **첨부(0023)와 같은 규칙, 같은 한계다.** sha-256(salt + pw)를 브라우저에서 계산하고
// 소금은 값마다 새로 만든다. 링크나 문서 자체를 잠그는 것이 아니라 **우리 화면에서
// 가리는 것뿐**이다 — 주소를 직접 아는 사람은 그대로 연다(HANDOFF §7 '첨부를 진짜로
// 잠그기'). 그래서 화면 문구에 '암호화'라는 말을 쓰지 않는다.
//
// **계산은 이 파일 한 벌이다**(2026-09-08). 예전에는 cloud.js에도 같은 `sha256Hex`와
// 같은 소금 만들기가 그대로 적혀 있었다 — 한쪽만 고치면 걸어 둔 비밀번호가 다른 쪽에서
// 안 풀리는 자리였다. 지금은 cloud.js가 여기를 가져다 쓴다(`setFilePassword` ·
// `setLinkPassword` · `checkFilePassword`). 방향은 **한쪽뿐이다** — 이 파일은 cloud.js를
// import하지 않는다. 그러면 supabase 클라이언트가 딸려 와서, 이것만 필요한 쪽(주보
// 큐시트는 services 행의 jsonb 한 칸이라 첨부 경로를 안 지난다)과 브라우저 없이 도는
// 노드 검사가 통째로 무거워진다. `tests/three.mjs`가 왕복을 본다.
//
// 쓰는 곳
//   · 첨부: files.view_pw / view_pw_salt / view_pw_by (거는 쪽은 cloud.setFilePassword)
//   · 참고 링크: resource_links의 같은 세 칸 (거는 쪽은 cloud.setLinkPassword)
//   · 주보 큐시트: services.cue_sheet jsonb의 { view_pw, view_pw_salt }
// ============================================================================

// WebCrypto로 만든다(서버 왕복 없음).
const sha256Hex = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

// 빈 비밀번호 = 잠금 풀기. 두 칸을 **둘 다 null로** 돌려준다 — 소금만 남겨 두면
// 다음에 거는 비밀번호가 옛 소금을 물려받아 "풀었다 다시 걸었는데 예전 것이 맞는" 일이 난다.
export async function makeViewPw(pw) {
  const password = String(pw ?? '');
  if (!password) return { view_pw: null, view_pw_salt: null };
  const salt = crypto.randomUUID();
  return { view_pw: await sha256Hex(salt + password), view_pw_salt: salt };
}

// row: { view_pw, view_pw_salt } — 잠겨 있지 않으면 **언제나 통과**다.
// 부르는 쪽이 isLocked로 먼저 갈라 쓰지만, 여기서도 같은 판단을 해야 잠금이 풀린 뒤
// 남아 있던 입력 줄이 엉뚱하게 '틀렸다'고 말하지 않는다.
export async function verifyViewPw(row, pw) {
  if (!row?.view_pw) return true;
  return (await sha256Hex((row.view_pw_salt || '') + String(pw ?? ''))) === row.view_pw;
}

export const isLocked = (row) => !!row?.view_pw;
