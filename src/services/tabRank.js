// 프로젝트 탭 줄의 순서 — **사람마다 자기 차례**(시안 2026-10-16 · 옛 '앞 칸'을 대신한다).
//
// 한 번도 끌어 본 적 없는 사람은 모두가 같이 보는 position 순서를 그대로 본다. 누구든 탭을 끌면 **그 사람의 차례만**
// 바뀐다 — 남의 탭 줄과 projects.position은 움직이지 않는다(옛 saveTabOrder는 모두의 position을 고쳤다).
// 내 차례에 아직 없는 프로젝트(그 뒤에 새로 생긴 것)는 **내 차례 맨 뒤**에 position 순으로 붙는다.
// 차례를 두는 곳은 services/tabOrder.js, 여기는 순수 함수만(import 0 · logcheck가 본다).
//
// 옛 앞 칸(최근 7일 여럿이 움직인 것 다섯까지 · activityStats·splitFrontTabs)은 지웠다 — tabFront.js의
// 숫자도 같이 빠졌고, 남은 것은 탭 점이 보는 활동 줄뿐이다.

// 탭 점(traces.freshProjectIds)이 보는 활동 줄의 창 — 며칠 치를 읽나(tabFront.js)
export const FRONT_DAYS = 7;

// list: position 순으로 선 프로젝트(고른 해·보관 제외로 걸러진 것) · order: 내 차례(id 배열 — 다른 해·지운 것도 섞여 있다)
// → 내 차례에 있는 것이 그 차례로 앞, 없는 것은 뒤에 position 순. order가 비면 list 그대로(모두의 순서).
// 후보는 **list 안에서만** — 다른 해·보관·안 보이는(리더만) 프로젝트의 id는 이 줄에 끼지 않는다.
export function applyTabOrder(list, order) {
  const src = list || [];
  const ids = Array.isArray(order) ? order : [];
  if (!ids.length) return src.slice();
  const byId = new Map(src.map(p => [p.id, p]));
  const placed = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
  const on = new Set(placed.map(p => p.id));
  return [...placed, ...src.filter(p => !on.has(p.id))];
}

// 탭 하나를 다른 탭 자리로 끈다 → 새 내 차례(id 배열) · 못 끄면 null.
// all: position 순 전체(보관 안 한 것 — 다른 해 것까지). 지금 내 차례로 **전체**를 세운 뒤 옮긴다 — 그래서 아직
// 자리가 없던 프로젝트도 이때 자리를 얻고, 다른 해 것의 차례는 그대로다. 끼워 넣기는 뒤로 끌면 놓은 것 뒤(PITFALLS 12-a).
export function moveInTabOrder(all, order, fromId, toId) {
  const ids = applyTabOrder(all, order).map(p => p.id);
  const from = ids.indexOf(fromId), to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = ids.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
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
//   2) 고른 해의 탭 순서(내 차례 · 없으면 position) 첫 프로젝트
//   3) 고른 해에 하나도 없으면 프로젝트가 있는 가장 최근 해의 탭 순서 첫 것(탭 줄의 연도가 따라간다)
//   4) 아무것도 없으면 null(새로 만들기)
// active: 보관하지 않은 프로젝트(position 순) · all: 전체(마지막 본 것 확인용) · yearOf: utils.projectYear
export function pickProjectToOpen({ active, all, year, lastId, order, yearOf }) {
  const last = lastId && (all || []).find(p => p.id === lastId);
  if (last && yearOf(last) === String(year)) return last.id;
  const firstOf = (y) => applyTabOrder((active || []).filter(p => yearOf(p) === String(y)), order)[0]?.id || null;
  const inYear = firstOf(year);
  if (inYear) return inYear;
  const years = [...new Set((active || []).map(yearOf))].sort((a, b) => b.localeCompare(a));
  return years.length ? firstOf(years[0]) : null;
}
