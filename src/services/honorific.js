// ============================================================================
// 호칭 — 순수 모듈 (people.js에서 옮겨 왔다 · 2026-09-26)
// ----------------------------------------------------------------------------
// **import가 없다.** 주보 공개 보기(api/service-view.js — 서버)와 공개 페이지가 같은 규칙을 써야 하는데
// people.js는 supabase 클라이언트를 물고 있어 서버·공개 페이지가 부를 수 없었다. people.js가 그대로
// 다시 내보내므로 앱의 호출부는 한 줄도 바뀌지 않는다.
// ============================================================================

// ── 호칭 (사용자 결정 2026-09-06 · 형제/자매는 2026-09-14) ──────────────────
// 주보 발행본과 홈에서는 이름 뒤에 호칭을 붙인다. 차례대로 본다:
//   ① 교역자(`people.is_pastor`)            → 'OOO 전도사님'
//   ② 그 해 부장(`people_roles.role`)       → 'OOO 부장님'
//   ③ 성별이 적힌 사람(`people.gender`)     → 'OOO 형제' · 'OOO 자매'   (0064)
//   ④ 성별이 아직 비어 있으면               → 'OOO 청년'
//   ⑤ 명단에 없는 이름                      → 적은 글자 그대로
// **차례가 곧 규칙이다** — 부장인 자매는 '부장님'이지 '자매'가 아니고, 교역자는 그보다
// 앞이다(겸직이면 위쪽이 이긴다).
//
// ④가 있는 이유: gender는 nullable이고 명단 53명을 손으로 채우는 중이다(0064 주석).
// 다 채우기 전에도 화면은 돌아야 하니 빈 사람은 예전처럼 '청년'으로 부른다.
//
// **명단에 없는 이름은 그대로 둔다** — 객원 인도자·외부 강사는 우리가 아는 것이 없어서
// '청년'이라고 부를 근거가 없다. 설교자(`services.preacher`)는 자유 텍스트라 아예
// 이 길을 타지 않는다(이미 '임성빈 전도사님'처럼 적는다).
//
// 호칭은 **보기에서만** 붙인다 — 편집 화면의 입력칸은 이름 그대로다(저장되는 값이
// 이름이라야 명단 자동완성·person 연결이 계속 맞는다).
//
// 규칙이 이 함수 하나라서 대표기도·헌금 봉헌·찬양 인도·인도자·주보 종이가 저절로
// 따라온다. **AI 문구(services/ai.js)는 '청년' 그대로 둔다**(사용자 결정 2026-09-14).
export const HONORIFIC = {
  pastor: '전도사님', director: '부장님', brother: '형제', sister: '자매', youth: '청년',
};
const DIRECTOR = 'director';
// DB에 넣는 값은 'm'·'f' 두 글자다(0064의 check) — 화면 글자는 위 HONORIFIC이 정한다.
const BY_GENDER = { m: HONORIFIC.brother, f: HONORIFIC.sister };

export function honorific(name, info) {
  const clean = String(name || '').trim();
  if (!clean || !info) return clean;
  if (info.isPastor) return `${clean} ${HONORIFIC.pastor}`;
  if ((info.roles || []).includes(DIRECTOR)) return `${clean} ${HONORIFIC.director}`;
  return `${clean} ${BY_GENDER[info.gender] || HONORIFIC.youth}`;
}

// 명단 + 그 해 직분 → `(name, personId?) => '홍길동 청년'` 한 벌.
// **id가 있으면 id로 찾는다**(담당자 줄은 personId를 들고 있다). 이름만 있는 자리
// (찬양 인도자 — 0044는 글자 하나다)는 이름으로 찾는데, 계정 표시명으로 덮인 이름
// (`withDisplayName`)과 명단에 적힌 이름(`roster_name`) 둘 다 열쇠로 둔다. 같은 이름이
// 둘이면 **먼저 나온 사람**이다 — 이름만 가지고는 더 가릴 수 없다.
export function honorificsOf(people = [], roles = []) {
  const roleBy = new Map();
  for (const r of roles || []) {
    if (!r?.person_id || !r?.role) continue;
    if (!roleBy.has(r.person_id)) roleBy.set(r.person_id, []);
    roleBy.get(r.person_id).push(r.role);
  }
  const byId = new Map();
  const byName = new Map();
  for (const p of people || []) {
    if (!p?.id) continue;
    // gender를 여기 실어야 honorific의 ③이 산다 — fetchPeople의 select와 한 쌍이다.
    const info = { isPastor: !!p.is_pastor, gender: p.gender || null, roles: roleBy.get(p.id) || [] };
    byId.set(p.id, info);
    for (const key of [p.name, p.roster_name]) {
      const k = String(key || '').trim();
      if (k && !byName.has(k)) byName.set(k, info);
    }
  }
  return (name, personId = null) =>
    honorific(name, (personId && byId.get(personId)) || byName.get(String(name || '').trim()) || null);
}
