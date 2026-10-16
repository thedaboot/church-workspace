// 프로젝트 탭 줄의 순서 — **즐겨찾기가 앞**(시안 2026-10-16 · 옛 '앞 칸'을 대신한다).
//
// 사람마다 별을 단 프로젝트가 탭 줄 맨 앞에 **내가 정한 차례로** 서고, 그 뒤는 모두가 같이 보는
// position 순서 그대로다(별 단 것은 거기서 빠진다). 사이에 얇은 세로선 하나(문구·점 없음).
// 끌어서 바꾸는 것은 **내 별 차례뿐**이다 — 남의 탭 줄은 움직이지 않는다(옛 saveTabOrder는 모두의
// position을 고쳤다). 별 목록을 두는 곳은 services/tabStars.js, 여기는 순수 함수만(import 0 · logcheck가 본다).
//
// 옛 앞 칸(최근 7일 여럿이 움직인 것 다섯까지 · activityStats·splitFrontTabs)은 지웠다 — tabFront.js의
// 숫자도 같이 빠졌고, 남은 것은 탭 점이 보는 활동 줄뿐이다.

// 탭 점(traces.freshProjectIds)이 보는 활동 줄의 창 — 며칠 치를 읽나(tabFront.js)
export const FRONT_DAYS = 7;

// list: position 순으로 선 프로젝트(이미 고른 해·보관 제외로 걸러진 것) · starIds: 내 별 차례(다른 해 것도 섞여 있다)
// → { starred, rest } — starred는 starIds 차례 중 list에 있는 것, rest는 나머지(list 순서 그대로).
// 별 후보를 **list 안에서만** 고른다 — 다른 해·보관·안 보이는(리더만) 프로젝트의 별이 이 줄을 먹지 않는다.
export function splitStarredTabs(list, starIds) {
  const src = list || [];
  const ids = Array.isArray(starIds) ? starIds : [];
  if (!ids.length) return { starred: [], rest: src.slice() };
  const byId = new Map(src.map(p => [p.id, p]));
  const starred = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
  const on = new Set(starred.map(p => p.id));
  return { starred, rest: src.filter(p => !on.has(p.id)) };
}

// 별 하나 켜고 끄기 — 새로 켠 것은 **별 줄 맨 뒤**(구분선 바로 앞)에 선다. 원래 배열은 건드리지 않는다.
export function toggleStarId(starIds, id) {
  const ids = Array.isArray(starIds) ? starIds : [];
  if (!id) return ids.slice();
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

// 게스트 모드에는 activity 표가 없다 — 스토어 업무의 activityLog(이름·시각)로 같은 줄을 만든다.
// tasks: 스토어의 { byId, allIds }. 탭 점(tabFront)과 홈 '작년 이맘때'가 쓴다.
export function guestActivityRows(tasks) {
  const out = [];
  for (const id of tasks?.allIds || []) {
    const t = tasks.byId?.[id];
    if (!t?.projectId) continue;
    for (const l of t.activityLog || []) out.push({ projectId: t.projectId, actor: l.author, at: l.timestamp });
  }
  return out;
}

// 폰 하단 '프로젝트' 버튼이 열 곳(2026-09-25).
//   1) 마지막으로 본 프로젝트가 아직 있고 고른 해 것이면 그것
//   2) 고른 해의 탭 순서(내 별 → position) 첫 프로젝트
//   3) 고른 해에 하나도 없으면 프로젝트가 있는 가장 최근 해의 탭 순서 첫 것(탭 줄의 연도가 따라간다)
//   4) 아무것도 없으면 null(새로 만들기)
// active: 보관하지 않은 프로젝트(position 순) · all: 전체(마지막 본 것 확인용) · yearOf: utils.projectYear
export function pickProjectToOpen({ active, all, year, lastId, starIds, yearOf }) {
  const last = lastId && (all || []).find(p => p.id === lastId);
  if (last && yearOf(last) === String(year)) return last.id;
  const firstOf = (y) => {
    const { starred, rest } = splitStarredTabs((active || []).filter(p => yearOf(p) === String(y)), starIds);
    return (starred[0] || rest[0])?.id || null;
  };
  const inYear = firstOf(year);
  if (inYear) return inYear;
  const years = [...new Set((active || []).map(yearOf))].sort((a, b) => b.localeCompare(a));
  return years.length ? firstOf(years[0]) : null;
}
