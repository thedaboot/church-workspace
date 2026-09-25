// 프로젝트 탭 줄의 '앞 칸'(사용자 결정 2026-09-25 · 목업 권장안 A).
//
// 앞 칸 = **최근 7일 동안 그 프로젝트에서 무언가 한 사람 수**(activity.actor_id 고유 수)가
// 많은 순, 같으면 가장 최근 활동이 앞. **두 명 이상**인 것만, 다섯까지. 그 뒤는 손으로 정한
// position 순서 그대로이고 앞 칸에 올라간 것은 거기서 빠진다.
//
// **숫자는 앱을 열 때와 다시 보일 때만 새로 잰다**(services/tabFront.js) — 보고 있는 동안
// 남의 활동으로 탭이 움직이면 누르려던 탭이 손가락 밑에서 빠져나간다. 여기는 순수 함수만
// 둔다(노드에서 logcheck가 바로 본다 · import 0).
//
// 사람 수이지 건수가 아니다 — 한 사람이 하루 종일 고친 프로젝트보다 여럿이 들른 곳이 앞이다.
// 화면에 숫자·순위를 쓰지 않는다(§7 '랭킹' · §8 견주는 구조 금지) — 앞 칸과 나머지 사이의
// 얇은 선 하나뿐이다.

export const FRONT_DAYS = 7;
export const FRONT_MAX = 5;
export const FRONT_MIN_PEOPLE = 2;

const DAY_MS = 86400000;

// rows: [{ projectId, actor, at }] — actor는 클라우드에서 계정 id(합친 계정은 남긴 계정),
// 게스트에서는 이름. at은 ISO 글자나 ms.
// → { [projectId]: { people, lastAt } } (lastAt은 ms). 창 밖·주인 없는 줄은 버린다.
export function activityStats(rows, nowMs, days = FRONT_DAYS) {
  const from = nowMs - days * DAY_MS;
  const acc = new Map();
  for (const r of rows || []) {
    if (!r || !r.projectId || !r.actor) continue;
    const t = typeof r.at === 'number' ? r.at : Date.parse(r.at);
    if (!Number.isFinite(t) || t < from || t > nowMs + DAY_MS) continue;   // 앞으로 하루는 시계 오차로 봐준다
    let s = acc.get(r.projectId);
    if (!s) acc.set(r.projectId, (s = { actors: new Set(), lastAt: 0 }));
    s.actors.add(r.actor);
    if (t > s.lastAt) s.lastAt = t;
  }
  const out = {};
  for (const [pid, s] of acc) out[pid] = { people: s.actors.size, lastAt: s.lastAt };
  return out;
}

// list: position 순으로 선 프로젝트(이미 고른 해·보관 제외로 걸러진 것).
// → { front, rest } — front는 앞 칸(최대 max), rest는 나머지(list 순서 그대로).
// 후보를 **list 안에서만** 고른다 — 다른 해의 바쁜 프로젝트가 이 해의 칸을 먹으면 안 된다.
export function splitFrontTabs(list, stats, max = FRONT_MAX, minPeople = FRONT_MIN_PEOPLE) {
  const src = list || [];
  if (!stats) return { front: [], rest: src.slice() };
  const picked = src
    .map((p, i) => ({ p, i, s: stats[p.id] }))
    .filter(x => x.s && x.s.people >= minPeople)
    .sort((a, b) => b.s.people - a.s.people || b.s.lastAt - a.s.lastAt || a.i - b.i)
    .slice(0, max)
    .map(x => x.p);
  const ids = new Set(picked.map(p => p.id));
  return { front: picked, rest: src.filter(p => !ids.has(p.id)) };
}

// 게스트 모드에는 activity 표가 없다 — 스토어 업무의 activityLog(이름·시각)로 같은 줄을 만든다.
// tasks: 스토어의 { byId, allIds }.
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
//   2) 고른 해의 탭 순서(앞 칸 → position) 첫 프로젝트
//   3) 고른 해에 하나도 없으면 프로젝트가 있는 가장 최근 해의 탭 순서 첫 것(탭 줄의 연도가 따라간다)
//   4) 아무것도 없으면 null(새로 만들기)
// active: 보관하지 않은 프로젝트(position 순) · all: 전체(마지막 본 것 확인용) · yearOf: utils.projectYear
export function pickProjectToOpen({ active, all, year, lastId, stats, yearOf }) {
  const last = lastId && (all || []).find(p => p.id === lastId);
  if (last && yearOf(last) === String(year)) return last.id;
  const firstOf = (y) => {
    const { front, rest } = splitFrontTabs((active || []).filter(p => yearOf(p) === String(y)), stats);
    return (front[0] || rest[0])?.id || null;
  };
  const inYear = firstOf(year);
  if (inYear) return inYear;
  const years = [...new Set((active || []).map(yearOf))].sort((a, b) => b.localeCompare(a));
  return years.length ? firstOf(years[0]) : null;
}
