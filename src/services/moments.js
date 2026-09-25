import { supabase, myUid } from './supabaseClient.js';

// ============================================================================
// 홈의 날짜로 켜지는 두 자리의 읽기 — 지난 해의 오늘 · 한 해의 발자취(목업 '은혜와 리듬' 7·8번)
// ----------------------------------------------------------------------------
// 고르는 규칙은 services/homeMoments.js(순수)다. 여기는 **왕복만** 한다 — 새 저장 자리는 없다.
// 게스트(supabase 없음)에는 activity 표도 노트 표도 없다: 지난 해의 오늘은 스토어 업무의
// activityLog(tabRank.guestActivityRows)로 부르는 쪽이 대신하고, 노트는 빈 목록이다.
// 둘 다 곁줄이라 실패는 부르는 쪽이 삼킨다(홈 카드는 그대로 선다).
// ============================================================================

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
// 로컬 날짜의 자정 → ISO 시각(업무 셈과 같은 로컬 기준 · homeMoments.localDayOf와 짝)
function localMidnightIso(iso, plusDays = 0) {
  const m = ISO.exec(String(iso || ''));
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3] + plusDays).toISOString();
}

// 작년 창의 프로젝트 활동 — [{ projectId, at }]. 창은 로컬 날짜 [from, to] 이틀 끝까지.
// 1000줄 상한(PostgREST)이 걸리면 가장 이른 쪽이 잘린다 — 한 창에 활동이 1000건을 넘는 일은 드물고,
// 넘어도 '가장 많이 움직인 프로젝트'는 대개 그대로다(최근 순으로 받는다).
export async function fetchActivityBetween(from, to) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('activity')
    .select('project_id, created_at')
    .gte('created_at', localMidnightIso(from)).lt('created_at', localMidnightIso(to, 1))
    .not('project_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []).map(r => ({ projectId: r.project_id, at: r.created_at }));
}

// 그 해 내가 예배 노트를 쓴 주보 — [{ serviceId, title, date }]. **노트 글은 읽지 않는다**(발자취에는
// 설교 제목만 싣는다) — 글이 빈 노트만 거른다. 합친 계정이면 남긴 계정 id(0061 · myUid).
export async function fetchMyNoteSundays(year) {
  if (!supabase) return [];
  const uid = await myUid();
  if (!uid) return [];
  const { data, error } = await supabase.from('service_notes')
    .select('service_id, services!inner(title, service_date)')
    .eq('profile_id', uid).not('body', 'is', null).neq('body', '')
    .gte('services.service_date', `${year}-01-01`).lte('services.service_date', `${year}-12-31`);
  if (error) throw error;
  return (data ?? []).map(r => ({ serviceId: r.service_id, title: r.services?.title || '', date: r.services?.service_date || '' }));
}
