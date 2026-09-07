// ============================================================================
// 화면 가림용 비밀번호 — 참고 링크 · 주보 큐시트 (0053)
// ----------------------------------------------------------------------------
// **첨부(0023)와 같은 규칙, 같은 한계다.** sha-256(salt + pw)를 브라우저에서 계산하고
// 소금은 값마다 새로 만든다. 링크나 문서 자체를 잠그는 것이 아니라 **우리 화면에서
// 가리는 것뿐**이다 — 주소를 직접 아는 사람은 그대로 연다(HANDOFF §7 '첨부를 진짜로
// 잠그기'). 그래서 화면 문구에 '암호화'라는 말을 쓰지 않는다.
//
// **cloud.js의 `sha256Hex` · `setFilePassword` · `checkFilePassword`와 한 쌍이다.**
// 같은 계산을 여기 한 번 더 적었다 — cloud.js를 import하면 supabase 클라이언트가 같이
// 딸려 오는데, 이 파일을 쓰는 쪽은 그것이 필요 없다(주보 큐시트는 services 행의 jsonb
// 한 칸이라 cloud의 첨부 경로를 지나지 않고, 노드 검사도 브라우저 없이 이 파일만 읽는다).
// **한쪽 알고리즘을 고치면 다른 쪽도 같이 고쳐야 한다** — `tests/three.mjs`가 왕복을 본다.
//
// 쓰는 곳
//   · 참고 링크: resource_links.view_pw / view_pw_salt / view_pw_by
//     (거는 쪽은 cloud.setLinkPassword — DB 왕복이라 그쪽은 cloud의 sha256Hex를 쓴다)
//   · 주보 큐시트: services.cue_sheet jsonb의 { view_pw, view_pw_salt }
// ============================================================================

// WebCrypto로 만든다(서버 왕복 없음). cloud.js의 같은 이름 함수와 한 글자도 다르지 않다.
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

// row: { view_pw, view_pw_salt } — 잠겨 있지 않으면 **언제나 통과**다(cloud.checkFilePassword와 같다).
// 부르는 쪽이 isLocked로 먼저 갈라 쓰지만, 여기서도 같은 판단을 해야 잠금이 풀린 뒤
// 남아 있던 입력 줄이 엉뚱하게 '틀렸다'고 말하지 않는다.
export async function verifyViewPw(row, pw) {
  if (!row?.view_pw) return true;
  return (await sha256Hex((row.view_pw_salt || '') + String(pw ?? ''))) === row.view_pw;
}

export const isLocked = (row) => !!row?.view_pw;
