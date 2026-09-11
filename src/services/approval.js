// ============================================================================
// 승인 확인 — **서버(서비스 키) 전용** 한 벌. api/drive.js · api/drive-file.js가 쓴다.
// ----------------------------------------------------------------------------
// DB 안에서는 `public.is_approved()`가 이 판정을 하고 0061부터 `effective_uid()`를
// 본다. 그런데 이 두 경로는 **서비스 키로 돌아서 RLS도 auth.uid()도 없다** — 그래서
// `profiles.approved`를 세션의 auth id로 직접 읽었고, 합친 계정은 그 행이 환송 처리
// (approved = false)라 **첨부 업로드와 드라이브 미리보기가 403**이었다(감사 2026-09-11).
//
// 고치는 방법은 DB가 하는 것과 같다: `merged_into`가 있으면 **남긴 계정의 칸**을 본다.
// 관리자 예외(admins 표)는 부르는 쪽이 지금처럼 따로 본다 — 여기서는 승인 칸만 답한다.
//
// 앱 번들은 이 파일을 가져오지 않는다(notifyText.js·titleText.js처럼 api/가 src/의
// 순수 모듈을 빌려 쓰는 방향이다 — 반대 방향은 supabase 클라이언트가 딸려 가서 안 된다).
// ============================================================================

export async function isApprovedProfile(supabase, uid) {
  const { data: me } = await supabase.from('profiles').select('approved, merged_into').eq('id', uid).single();
  if (!me?.merged_into) return !!me?.approved;
  const { data: keep } = await supabase.from('profiles').select('approved').eq('id', me.merged_into).single();
  return !!keep?.approved;
}
