// ============================================================================
// 홈의 날짜로 켜지는 세 자리 — 순수 판정(import 0 · tests/logcheck가 노드에서 바로 본다)
// ----------------------------------------------------------------------------
// 목업 '은혜와 리듬' 3·7·8번(사용자 승인 2026-09-25). 화면(homeView)은 이 판정의 결과만 그린다.
//
//   · 오늘의 예배(주일 모드) — sundayMode
//   · 지난 해의 오늘        — yearAgoWindow · pickYearAgo
//   · 한 해의 발자취        — footprintYear
//
// **날짜는 글자로만 센다**('YYYY-MM-DD'). `new Date('2026-09-06')`은 UTC 자정이라 시간대에 따라
// 하루가 밀린다(homeView ymd 주석과 같은 이유) — 달력 셈이 필요하면 UTC로 세우고 UTC로 읽는다.
// ============================================================================

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// UTC로 세운 날짜에 n일을 더한다(달·해를 넘는다)
function addDays(iso, n) {
  const m = ISO.exec(String(iso || ''));
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// ── 오늘의 예배(주일 모드) ──────────────────────────────────────────────────
// 발행된 주보의 날짜가 오늘(KST)이면 **08:00부터 자정까지** 켠다(사용자 결정 2026-09-25 — 목업은
// 06:00이었다). 그 사이 홈의 예배 카드가 격자 맨 앞에서 두 칸을 차지하고 내 순 카드는 출석 칸으로
// 들어간다. 경계는 여기 한 곳이다.
// now: KST 'YYYY-MM-DD HH:mm:ss'(worship.kstNow) — 글자 순서가 곧 시간 순서라 그대로 견준다.
export const SUNDAY_FROM = '08:00';
export function sundayMode(service, now) {
  if (!service || service.status !== 'published') return false;
  const d = String(service.service_date || '');
  const n = String(now || '');
  if (!ISO.test(d) || !ISO.test(n.slice(0, 10))) return false;
  return n.slice(0, 10) === d && `${d} ${SUNDAY_FROM}` <= n;
}

// ── 지난 해의 오늘 ──────────────────────────────────────────────────────────
// 창: **작년 오늘 ±7일**(로컬 날짜 — 업무 셈 §8과 같은 기준). 2월 29일은 작년에 없으니 28일로.
export const YEAR_AGO_DAYS = 7;
// activity 표에 기록이 쌓이기 시작한 날(라이브 DB 2026-07-25) — 창이 이보다 앞이면 묻지 않는다.
// 창이 ±7일이라 이 날에 처음 닿는 것은 2027-07-18이다 — 그 전에는 줄이 없는 것이 정상이다.
export const ACTIVITY_SINCE = '2026-07-25';
export function yearAgoWindow(today, days = YEAR_AGO_DAYS) {
  const m = ISO.exec(String(today || ''));
  if (!m) return null;
  const y = +m[1] - 1;
  const last = new Date(Date.UTC(y, +m[2], 0)).getUTCDate();   // 작년 그 달의 마지막 날
  const center = isoOf(y, +m[2], Math.min(+m[3], last));
  return { year: y, from: addDays(center, -days), to: addDays(center, days) };
}

// 로컬 날짜 'YYYY-MM-DD' — ISO 시각(타임스탬프)이면 **브라우저 로컬**로 읽는다(업무 마감과 같은 기준 ·
// utils.localDate와 같은 모양). 날짜 글자는 그대로.
export function localDayOf(v) {
  const s = String(v || '');
  if (ISO.test(s)) return s;
  const t = typeof v === 'number' ? v : Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// 작년 오늘 ±7일에 activity가 **가장 많은 작년 연도 프로젝트 하나**(같으면 최근 활동이 앞).
// **모두에게 같은 줄이다**(사용자 결정 — 내 것으로 좁히면 사람마다 달라지고 견주는 구조가 생긴다).
// 누르면 그 창에 마감·완료가 걸린 업무 **셋까지**(날짜순)가 펼쳐진다.
//   rows:     [{ projectId, at }] — activity(클라우드) 또는 업무의 activityLog(게스트)
//   projects: [{ id, year, title, archived }] — 보관된 것도 들어온다(작년 것은 대개 보관이다)
//   tasks:    [{ id, projectId, title, dueDate, completedAt }]
// → { project, window, tasks: [{ task, date }] } | null
export const YEAR_AGO_TASKS = 3;
export function pickYearAgo({ today, rows = [], projects = [], tasks = [] } = {}) {
  const win = yearAgoWindow(today);
  if (!win) return null;
  const inWin = (d) => !!d && d >= win.from && d <= win.to;
  const byId = new Map((projects || []).filter(p => p && Number(p.year) === win.year).map(p => [p.id, p]));
  const acc = new Map();
  for (const r of rows || []) {
    if (!r || !byId.has(r.projectId)) continue;
    const d = localDayOf(r.at);
    if (!inWin(d)) continue;
    const t = typeof r.at === 'number' ? r.at : Date.parse(r.at) || 0;
    const s = acc.get(r.projectId) || { n: 0, last: 0 };
    s.n += 1; if (t > s.last) s.last = t;
    acc.set(r.projectId, s);
  }
  const best = [...acc.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0];
  if (!best) return null;
  const project = byId.get(best[0]);
  const picked = (tasks || [])
    .filter(t => t && t.projectId === project.id)
    .map(t => {
      // 완료가 창 안이면 끝낸 날, 아니면 마감일 — 둘 다 창 밖이면 빠진다
      const done = localDayOf(t.completedAt);
      const due = localDayOf(t.dueDate);
      const date = inWin(done) ? done : (inWin(due) ? due : '');
      return date ? { task: t, date } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.task.title || '').localeCompare(String(b.task.title || ''), 'ko'))
    .slice(0, YEAR_AGO_TASKS);
  return { project, window: win, tasks: picked };
}

// ── 한 해의 발자취 ──────────────────────────────────────────────────────────
// **12월 둘째 주일 ~ 1월 6일**(사용자 결정 2026-09-25 · 주현절까지) 홈에 입구가 선다. 그 동안은
// '지난 해의 오늘'과 같은 자리를 이 입구가 쓴다. 돌려주는 것은 **돌아보는 해**(12월이면 그 해,
// 1월이면 지난해) — 기간 밖이면 null. 제목 '{해}년의 발자취'의 해가 이 값이다.
export function secondSundayOfDecember(year) {
  const dow = new Date(Date.UTC(year, 11, 1)).getUTCDay();   // 12월 1일의 요일(0=일)
  return isoOf(year, 12, 1 + ((7 - dow) % 7) + 7);
}
export function footprintYear(today) {
  const m = ISO.exec(String(today || ''));
  if (!m) return null;
  const y = +m[1];
  if (+m[2] === 1 && +m[3] <= 6) return y - 1;
  if (+m[2] === 12 && today >= secondSundayOfDecember(y)) return y;
  return null;
}

// 발자취 한 장에 실을 것 — 그 해(로컬 날짜)에 **내가 남긴 것**만 고른다. 숫자·합계·순위는 만들지 않는다.
// 본문(노트·묵상 글)은 싣지 않는다 — 구절 본문은 화면이 public/bible에서 붙이고, 노트는 설교 제목만이다.
//   highlights: bible_state.highlights [{ ref:'gen 1:3' | 'qt:2026-09-06 jos 4:2', at, color }]
//   bookmarks:  bible_state.bookmarks  [{ ref:'gen 3', label, at }]
//   notes:      [{ serviceId, title, date }] — 그 해 내가 노트를 쓴 주보(글이 빈 노트는 부르는 쪽이 뺀다)
//   tasks·projects: 스토어 — 그 해(project.year) 내가 담당자인 업무의 프로젝트, 같이 담당한 사람 셋까지
const VERSE = /^(?:qt:\d{4}-\d{2}-\d{2} )?(\S+) (\d+):(\d+)$/;
const CHAPTER = /^(\S+) (\d+)$/;
const inYear = (at, year) => localDayOf(at).slice(0, 4) === String(year);
export const FOOTPRINT_FACES = 3;
export function footprintSections({ year, highlights = [], bookmarks = [], notes = [], tasks = [], projects = [], myName = '' } = {}) {
  // 구절 — 같은 장에서 **이어진 절**은 한 줄로 묶는다(한 번에 칠한 범위가 절마다 따로 서지 않게).
  // QT 본문에서 칠한 것('qt:날짜 ' 접두)도 같은 절로 읽는다. 같은 절이 두 번이면 한 번만.
  const seen = new Set();
  const verses = [];
  for (const h of highlights || []) {
    const m = VERSE.exec(String(h?.ref || ''));
    if (!m || !inYear(h?.at, year)) continue;
    const key = `${m[1]} ${m[2]}:${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verses.push({ bookId: m[1], chapter: +m[2], verse: +m[3], at: String(h.at || '') });
  }
  verses.sort((a, b) => a.at.localeCompare(b.at) || a.bookId.localeCompare(b.bookId) || a.chapter - b.chapter || a.verse - b.verse);
  const passages = [];
  for (const v of verses) {
    const run = passages.find(p => p.bookId === v.bookId && p.chapter === v.chapter && (v.verse === p.to + 1 || v.verse === p.from - 1));
    if (run) { run.from = Math.min(run.from, v.verse); run.to = Math.max(run.to, v.verse); }
    else passages.push({ bookId: v.bookId, chapter: v.chapter, from: v.verse, to: v.verse, at: v.at });
  }
  // 북마크한 장 — 넣은 날 순
  const chapters = (bookmarks || [])
    .map(b => ({ m: CHAPTER.exec(String(b?.ref || '')), b }))
    .filter(x => x.m && inYear(x.b.at, year))
    .map(({ m, b }) => ({ ref: b.ref, bookId: m[1], chapter: +m[2], label: String(b.label || ''), at: String(b.at || '') }))
    .sort((a, b) => a.at.localeCompare(b.at));
  // 예배 노트를 쓴 주일 — 주보 날짜 순, 설교 제목만
  const sundays = (notes || [])
    .filter(n => n && String(n.date || '').slice(0, 4) === String(year))
    .map(n => ({ serviceId: n.serviceId, title: String(n.title || ''), date: String(n.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // 함께한 프로젝트 — 그 해 프로젝트 중 내가 담당한 업무가 있는 것. 얼굴은 같이 담당한 사람 이름순 셋까지
  const me = String(myName || '').trim();
  const byProject = new Map();
  const yearProjects = new Map((projects || []).filter(p => p && Number(p.year) === Number(year)).map(p => [p.id, p]));
  for (const t of tasks || []) {
    if (!t || !yearProjects.has(t.projectId)) continue;
    const names = (t.assignees || []).map(n => String(n || '').trim()).filter(Boolean);
    if (!me || !names.includes(me)) continue;
    const set = byProject.get(t.projectId) || new Set();
    names.filter(n => n !== me).forEach(n => set.add(n));
    byProject.set(t.projectId, set);
  }
  const together = [...byProject.entries()]
    .map(([id, set]) => ({ project: yearProjects.get(id), faces: [...set].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, FOOTPRINT_FACES) }))
    .sort((a, b) => String(a.project.title || '').localeCompare(String(b.project.title || ''), 'ko'));
  return { passages, chapters, sundays, together };
}
