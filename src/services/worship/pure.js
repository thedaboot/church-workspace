// ============================================================================
// 예배 — 순수 부분(브라우저 없이도 검사된다 · tests/logcheck-v2가 노드에서 읽는다)
// ----------------------------------------------------------------------------
// 주보 열 · 최근에 부른 곡 · 지난 주보에서 물려받는 임사자 · 날짜 글자 · 출석이 열리는 때 ·
// 유튜브 주소 · 자격 판정(worshipPerms) · 순별 명단 · 파일 갈래(kind) · 지난 큐시트 고르기.
// 저장·통신은 같은 폴더의 다른 파일이 한다(bulletin · files · attendance · notes · api).
// import는 순수 모듈뿐이다 — byName만 people.js에서 온다(노드 검사는 그 줄을 걷는다).
// ============================================================================
import { COVER_KIND, SUNDAY_KIND, kindLabel } from '../serviceView.js';
import { localDate } from '../../utils.js';
import { byName } from '../people.js';

// cover_focus_y — 표지 사진의 보일 세로 위치(0081). 이 칸 때문에 0081이 먼저 나가야 한다(HANDOFF §3-4).
export const COLS = 'id, kind, service_date, status, title, passage_ref, preacher, roles, songs, notices, praise_leader, praise_playlist_url, attendance_note, cue_sheet, drive_folder_id, cover_focus_y, created_at, updated_at';

// ── 최근에 부른 곡 (2026-09-21 사용자 요청) ─────────────────────────────────
// 찬양팀이 콘티를 짤 때 실제로 겪는 물음은 "이 곡 저번 달에 부르지 않았나"다.
// **새 표를 만들지 않는다** — 주보마다 부른 곡이 이미 `services.songs`(jsonb, 0036)에
// 쌓여 있어서 발행본만 거꾸로 훑으면 이력이 그냥 나온다.
//
// 곡 제목은 사람이 손으로도 적고 유튜브에서도 온다(api/yt의 cleanTitle). 같은 곡이
// "주 은혜임을"과 "주 은혜임을 " 처럼 다른 글자로 들어오므로 **띄어쓰기를 지우고 소문자로**
// 맞춘 열쇠로 견준다(통합 검색의 norm과 같은 판단 · layout.jsx).
export const songKey = (title) => String(title || '').toLowerCase().replace(/\s+/g, '');

const DAY = 86400000;

// 발행된 주보에서 `onDate`보다 **앞선** 것들의 곡을 모아 [{ title, weeksAgo }]로 준다.
// 최신이 앞이고, 같은 곡이 여러 번이면 **가장 최근 한 번만** 남는다.
//   · 발행본만 보는 이유: 작성 중 주보의 곡은 아직 부른 곡이 아니다(홈 카드와 같은 판단).
//   · 자기 자신과 같은 날짜는 뺀다 — 지금 짜고 있는 콘티가 "0주 전"으로 되돌아오면 안 된다.
//   · weeksAgo는 **최소 1**이다. 금요 예배처럼 주중에 낀 것이 0으로 떨어지면
//     "0주 전에 했던 곡"이라는 말이 나온다.
export function recentSongs(services, { onDate, weeks = 8 } = {}) {
  const on = Date.parse(`${String(onDate || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(on)) return [];
  const seen = new Map();
  for (const s of services || []) {
    if (s?.status !== 'published') continue;
    const at = Date.parse(`${String(s.service_date || '').slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(at) || at >= on) continue;
    const weeksAgo = Math.max(1, Math.round((on - at) / (7 * DAY)));
    if (weeksAgo > weeks) continue;
    for (const song of Array.isArray(s.songs) ? s.songs : []) {
      const title = String(song?.title || '').trim();
      if (!title) continue;
      const key = songKey(title);
      const prev = seen.get(key);
      // 링크도 같이 물려준다(사용자 요청 2026-09-22) — 칩으로 넣고 나서 같은 영상을
      // 다시 찾아 붙이는 일이 없어야 한다. 가장 최근 것의 링크를 쓴다.
      if (!prev || weeksAgo < prev.weeksAgo) seen.set(key, { title, weeksAgo, link: String(song?.link || '').trim() });
    }
  }
  return [...seen.values()].sort((a, b) => a.weeksAgo - b.weeksAgo || a.title.localeCompare(b.title));
}

// 곡 제목 → 최근에 부른 적이 있으면 그 주 수. 없으면 0. (화면의 '3주 전에 했던 곡' 표)
export function weeksAgoOf(recent, title) {
  const key = songKey(title);
  return (recent || []).find(r => songKey(r.title) === key)?.weeksAgo || 0;
}

// ── 지난 주보에서 물려받는 임사자 (2026-09-21 사용자 결정) ──────────────────
// **대표기도와 헌금봉헌 둘뿐이다.** 인도·성경봉독·광고·축도·설교자는 비워 둔다 —
// 매주 사람이 바뀌는 자리라 미리 채우면 틀린 이름이 그대로 발행될 수 있다
// (§7의 '마감일 필수화'와 같은 판단: 강제로 채운 값은 거짓이 되기 쉽다).
//
// 임사자 줄은 고른 목록이 아니라 **자유 입력**이라(worshipDetail RolesEdit) 역할 글자로
// 견준다 — 띄어쓰기만 접는다. 지난 주보가 '헌금 봉헌'이라고 적었어도 같은 자리로 본다.
export const PREFILL_ROLES = ['대표기도', '헌금봉헌'];
const roleKey = (v) => String(v || '').replace(/\s+/g, '');
const PREFILL_KEYS = new Set(PREFILL_ROLES.map(roleKey));
const PREFILL_LABEL = new Map(PREFILL_ROLES.map(r => [roleKey(r), r]));
// 광고에서 찾을 제목(띄어쓰기를 접은 모양)
const NEXT_WEEK_NOTICE = '다음주예배위원';
// 광고에는 호칭까지 적는다("이수빈 형제") — roles에는 이름만 들어간다(0064의 호칭 규칙과
// 같은 말들이다). 못 알아본 호칭은 이름에 붙은 채로 남는데, 사람이 보고 고치면 되는
// 자리라 버리지 않는다 — 지우는 쪽이 더 위험하다.
// **띄어쓰기 한 칸은 반드시 있어야 한다**(`\s+`). 붙여 쓴 것까지 떼면 '강꽃님'처럼
// 호칭으로 끝나는 **진짜 이름**을 잘라 먹는다(우리 명단에 있는 이름이다).
// 주보 광고는 사람이 손으로 적는 자리라 넉넉히 받는다 — 여기 없는 호칭은 이름에 붙은
// 채로 남고, 그러면 명단과 안 이어져서(동그라미가 안 붙어서) 적은 사람이 바로 안다.
const HONORIFICS = /\s+(형제님|형제|자매님|자매|청년|전도사님|전도사|목사님|목사|사모님|부장님|부장|팀장님|팀장|회장님|회장|부회장|총무님|총무|서기|집사님|집사|권사님|권사|장로님|장로|강사님|간사님|간사|선생님|리더님|리더|순장님|순장|순원)\s*$/;
const bareName = (v) => String(v || '').replace(/[()（）]/g, ' ').trim().replace(HONORIFICS, '').trim();

// 다음 주 담당자는 **지난 주보의 광고**에 있다(2026-09-22 사용자 지적 · 라이브 확인).
// 9/20 주보를 보면 roles는 그 날 섬긴 사람(이하랑·꽃님)이고, 9/27에 섬길 사람은 광고의
// `다음 주 예배 위원`에 "대표기도: 이수빈 형제 / 헌금봉헌: 윤현서 자매"로 적혀 있다.
// **지난 주보의 roles를 그대로 물려주면 언제나 한 주 밀린 사람이 앉는다** — 처음에
// 그렇게 만들었다가 여기서 고쳤다.
//
// 광고 본문은 사람이 손으로 적는 자유 글이라 넉넉히 읽는다: 제목은 띄어쓰기를 접어
// 견주고, 본문은 줄마다 `역할: 이름 호칭` 모양을 찾는다. `대표 기도`처럼 띄어 적은
// 주보가 실제로 있어서(9/13) 역할도 띄어쓰기를 접는다.
//
// **종류를 가린다**(kind). 성탄절·송구영신은 주일 4부와 섬기는 사람이 다른데, 종류를 안
// 보면 지난 주일의 이름이 성탄절 주보에 앉는다(tests/worship이 잡아냈다 · 2026-09-21).
// 같은 종류의 앞선 발행본이 없거나 그 광고에 위원이 안 적혀 있으면 **빈 배열**이고,
// 그때는 화면도 조용하다 — 지어내지 않는다.
//
// people을 주면 이름이 똑같은 사람을 찾아 personId까지 이어 준다(동그라미가 붙는다).
export function prefillRoles(services, { onDate, kind = SUNDAY_KIND, people = [] } = {}) {
  const on = Date.parse(`${String(onDate || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(on)) return [];
  const want = (kind || SUNDAY_KIND).trim() || SUNDAY_KIND;
  let last = null;
  for (const s of services || []) {
    if (s?.status !== 'published' || (s.kind || SUNDAY_KIND) !== want) continue;
    const at = Date.parse(`${String(s.service_date || '').slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(at) || at >= on) continue;
    if (!last || at > last.at) last = { at, row: s };
  }
  if (!last) return [];
  const notice = (Array.isArray(last.row.notices) ? last.row.notices : [])
    .find(n => roleKey(n?.title).includes(NEXT_WEEK_NOTICE));
  if (!notice) return [];
  const byRole = new Map();
  for (const raw of String(notice.body || '').split('\n')) {
    // 사람이 손으로 적는 자리라 넉넉히 받는다(2026-09-22): 앞에 붙은 불릿(`- `·`· `)을
    // 걷고, 가르는 표는 콜론(`:`·`：`)이든 붙임표(`-`)든 받는다. 역할 이름은 띄어 적어도
    // 된다(`대표 기도`) — roleKey가 띄어쓰기를 접는다.
    const line = raw.replace(/^[\s\-*·•‧・]+/, '');
    const m = /^(.{2,10}?)\s*(?:[:：]|[-–—])\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = roleKey(m[1]);
    if (!PREFILL_KEYS.has(key) || byRole.has(key)) continue;
    const name = bareName(m[2]);
    if (!name) continue;
    // 광고는 본명으로 적힐 때가 많다('강서윤 자매') — 계정 표시 이름(name)뿐 아니라 명단에 적힌
    // 이름(roster_name · people.js withDisplayName)도 같은 사람으로 본다(2026-09-25).
    const found = (people || []).find(x => String(x?.name || '').trim() === name || String(x?.roster_name || '').trim() === name);
    byRole.set(key, { role: PREFILL_LABEL.get(key), name, personId: found?.id ?? null });
  }
  // 적힌 순서가 아니라 **우리 차례대로** 세운다(대표기도 → 헌금봉헌). 주보마다 적는
  // 순서가 달라도 편집 화면의 줄 순서는 늘 같아야 사람이 헷갈리지 않는다.
  return PREFILL_ROLES.map(r => byRole.get(roleKey(r))).filter(Boolean);
}

const UNASSIGNED = '순 미지정';
// 순 묶음 **위**에 서는 두 묶음(2026-09-07). 부장·교역자는 어느 순에도 편성되어 있지 않아
// '순 미지정'으로 떨어졌는데, 그 이름은 "아직 순을 못 정한 청년"이라는 뜻이라 어긋난다.
// id가 uuid가 아니라 글자인 이유: 이 묶음은 groups 행이 아니라 **명단 속성으로 만든 묶음**이다.
export const PASTOR_GROUP = 'pastor';
export const DIRECTOR_GROUP = 'director';
const HEAD_GROUPS = new Map([[PASTOR_GROUP, '전도사님'], [DIRECTOR_GROUP, '부장님']]);

// 찬양팀 이름(PRAISE_TEAM)은 고정 상수이고 serviceView.js에 있다(위 import · 0044).
// ── 순수 헬퍼 (브라우저 없이도 검사된다) ────────────────────────────────────

// 파일 이름에서 걷어야 하는 글자 — 윈도·맥·안드로이드가 공통으로 막는 아홉 자.
// 종류 이름은 주보를 만든 사람이 적은 글이라 무엇이든 들어올 수 있다(kindLabel 주석).
// 지우기만 하고 다른 글자로 바꾸지 않는다 — '_'나 '-'로 바꾸면 이름에 없던 구분이 생긴다.
export const safeFileName = (s) => String(s || '').replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

// 주보 PDF·그림의 파일 이름 — `2026.09.06 주일 4부 젊은이 예배_주보`(사용자 결정 2026-09-11).
// 예전에는 `주보 2026. 09. 06`이라 카카오톡 목록에서 **어느 예배의 주보인지** 알 수 없었다.
// 날짜가 앞이라 이름만으로 차례가 서고, 종이 머리(paperDate)와 달리 **점 사이에 공백이
// 없다** — 파일 이름은 숫자 줄을 맞출 일이 없고 공백이 있으면 주소로 옮길 때 갈린다.
// 노트·가이드 파일 이름은 그대로다(그쪽은 예배 종류가 붙을 자리가 아니다).
export function servicePaperName(service) {
  const iso = String(service?.service_date || '');
  const date = /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).replace(/-/g, '.') : iso;
  return safeFileName(`${date} ${kindLabel(service?.kind)}_주보`);
}

// 다가오는 주일. 오늘이 주일이면 오늘이다 — 주일 아침에 주보를 만들면서
// 다음 주 날짜가 기본값이면 매번 고쳐야 한다.
export function nextSundayDate(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return localDate(d);
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// '2026-09-06' → '26년 9월 6일 (일)'. **연도를 두 자리로 늘 붙인다**(사용자 결정
// 2026-09-03). 예전에는 올해면 생략했는데, 지난 예배를 훑을 때 어느 해인지가 카드마다
// 달라 헷갈렸다. 두 자리인 이유는 목록 카드의 메타 한 줄이 짧아야 해서다.
// 날짜 문자열을 그대로 쪼갠다 — new Date('2026-09-06')은 UTC 자정이라 시간대에 따라
// 하루가 밀린다(0019의 'MM-DD' 관례와 같은 이유).
export function formatServiceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [y, mo, day] = [+m[1], +m[2], +m[3]];
  const w = WEEKDAY[new Date(y, mo - 1, day).getDay()];
  return `${String(y).slice(2)}년 ${mo}월 ${day}일 (${w})`;
}

export const serviceYear = (iso) => Number(String(iso || '').slice(0, 4)) || new Date().getFullYear();

// 지금(한국 시간) 'YYYY-MM-DD HH:mm:ss'. 브라우저 로컬 시간으로 재면 검사 기계의
// 시간대에 따라 답이 달라진다 — 'sv-SE' 로케일이 곧 'YYYY-MM-DD HH:mm:ss'라
// **글자 비교가 곧 시간 비교**다(word.js의 kstToday가 날짜만 같은 방식으로 만든다.
// 쉼표를 끼워 넣는 런타임이 있어 한 번 걷어낸다).
export const kstNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(',', '');

// 예배가 시작하는 시각(KST). 주일 4부 젊은이 예배가 13:30이고, '그 밖의 예배'는
// 시간 칸이 없으니 같은 값을 쓴다(사용자 결정 2026-09-05) — 예배마다 시각을 두게
// 되면 그때 services에 칸을 만들고 이 상수는 기본값이 된다.
export const ATTEND_OPEN_HM = '13:30';

// 출석 화면에 **들어갈 수** 있는 주보인가 — 발행된 것뿐이다. 예배 전에도 미리 열어
// 명단을 훑을 수 있어야 한다(사용자 결정 2026-09-05: 그 전에는 체크만 잠근다).
export const attendanceVisible = (service) => !!service && service.status === 'published';

// 출석을 **만질 수** 있는가 — 발행됐고 예배 시작 시각(그날 13:30 KST)이 지났을 때다.
// 예전에는 '예배 날짜가 지난(오늘 포함)'이라 주일 새벽에도 체크가 열려 있었다.
// 'YYYY-MM-DD HH:mm'은 글자 순서가 곧 시간 순서라 그대로 견준다.
export function attendanceOpen(service, now = kstNow()) {
  if (!attendanceVisible(service)) return false;
  const d = String(service.service_date || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && `${d} ${ATTEND_OPEN_HM}` <= String(now);
}

// 홈이 **'지난 주일'이라 부를 수 있는** 주보 — 오늘보다 **앞선** 가장 최근 발행 주일
// 예배다. 오늘이 주일이면 오늘 주보는 세지 않는다(사용자 지적 2026-09-06: "이건 당장
// 오늘이거든? 표기도 하지 않는 게 …"). 오늘 예배의 출석은 출석 화면에서 본다.
// 그런 주보가 없으면 null이고, 그때 홈은 그 도막을 **아예 그리지 않는다**(문구 없음).
//
// 날짜는 'YYYY-MM-DD'라 글자 비교가 곧 날짜 비교다. 모양이 깨진 행은 애초에 세지 않는다
// (한 건이 맨 앞을 차지하면 홈이 엉뚱한 주보의 출석을 센다 — homeView pickService와 같은 판단).
export const pastSunday = (services = [], today = kstNow().slice(0, 10)) => (services || [])
  .filter(s => s?.kind === SUNDAY_KIND && s?.status === 'published'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(s?.service_date || ''))
    && String(s.service_date) < String(today))
  .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)))[0] || null;

// 홈·모임이 출석 수를 세는 창 — 오늘(KST)에서 여덟 주 전부터(fetchAttendanceCounts의 since).
// 둘이 찾는 것은 '출석이 실제로 들어온 가장 최근 주일' 하나라(groups.attendanceSunday),
// 여덟 주 안에 아무 주일에도 출석이 없으면 예전처럼 지난 주일(pastSunday)로 떨어진다.
// 날짜는 'YYYY-MM-DD' 글자만 셈한다 — UTC 자정으로 세우고 UTC로 읽으니 시간대가 끼지 않는다.
export const COUNT_WINDOW_DAYS = 56;
export function countsSince(today = kstNow().slice(0, 10), days = COUNT_WINDOW_DAYS) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - days)).toISOString().slice(0, 10);
}

// ── 유튜브 주소 (순수 — 노드에서 바로 검사된다) ────────────────────────────
// 재생목록·영상 id를 주소에서 뽑는다. **호스트를 먼저 본다** — 이 값이 그대로 서버
// 함수(api/yt.js)로 가기 때문에, 아무 주소나 받으면 우리 서버가 남의 심부름을 하는
// 열린 프록시가 된다(api/ai.js가 세션을 먼저 보는 것과 같은 취지).
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ytUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return YT_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
  } catch { return null; }
};

// 'watch?v=..&list=..' · 'playlist?list=..' 둘 다 list 하나에서 온다.
export function youtubeListId(raw) {
  const id = ytUrl(raw)?.searchParams.get('list') || '';
  return LIST_ID.test(id) ? id : null;
}

// 'watch?v=' · 'youtu.be/..' · 'shorts/..' · 'embed/..' · 'live/..'
export function youtubeVideoId(raw) {
  const u = ytUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  let id = '';
  if (host.endsWith('youtu.be')) id = u.pathname.slice(1).split('/')[0];
  else if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
  else id = (/^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname) || [])[1] || '';
  return VIDEO_ID.test(id) ? id : null;
}

export const youtubeWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
// 가져온 재생목록을 주보에 적어 둘 때 쓰는 **한 가지 모양**. 사람이 붙이는 주소는
// 'watch?v=…&list=…'일 때도 있어서 그대로 저장하면 보기에서 첫 곡으로 튄다.
export const youtubePlaylistUrl = (listId) => `https://www.youtube.com/playlist?list=${listId}`;

// 영상 주소 → 썸네일 주소. i.ytimg.com은 **키도 서버 함수도 필요 없는 공개 주소**라
// 게스트·로컬에서도 그대로 뜬다(mqdefault = 320x180, 곡 줄에 쓰기 딱 맞다).
// 유튜브 주소가 아니면 null — 화면은 그때 음표 아이콘으로 떨어진다.
export const youtubeThumb = (raw) => {
  const id = youtubeVideoId(raw);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
};

// 가져온 곡을 기존 목록 뒤에 붙인다 — **같은 영상은 한 번만**(link 기준).
// 두 번 가져와도 같은 곡이 겹치지 않아야 한다(재생목록을 고쳐서 다시 누르는 일이 흔하다).
export function mergeSongs(rows = [], picked = []) {
  const have = new Set((rows || []).map(s => String(s?.link || '').trim()).filter(Boolean));
  const add = [];
  for (const p of picked || []) {
    const link = String(p?.link || '').trim();
    if (!link || have.has(link)) continue;
    have.add(link);
    add.push({ title: p.title || '', link });
  }
  return [...(rows || []), ...add];
}

// 자격 판정 — 0035·0036·0042·**0045**의 서버 함수와 같은 식이다(DB가 진실이고 여기는 거울).
//   주보 작성·발행 = 관리자(마스터 포함) + 교역자 + 올해 회장 + 미디어팀 + 조준환(0083)  (can_edit_service)
//   출석 전체      = 관리자(마스터 포함) + 교역자 + 올해 **리더순장**     (can_check_all_attendance)
//   출석 자기 순   = 올해 그 순의 순장                                   (leads_sun_of)
//
// 두 번 바뀐 자리다. ① 2026-09-03(0042) 주보에서 교역자가 빠지고 미디어팀이 들어왔고,
// ② **2026-09-05 교역자가 주보로 돌아왔고 전체 출석은 리더순장 하나로 좁혀졌다**
// (예전에는 '그 해 직분 줄이 있으면 누구나'라 부장·총무·리더팀장까지 전원을 만졌다).
// 미디어팀은 명단 속성(people.teams)이라 연도와 무관하고, 회장·리더순장은 연도별 직분이다.
// 나머지 사람은 발행된 주보를 읽기만 한다 — 화면에서 버튼을 감추지만 경계는 RLS다.
const MEDIA_TEAM = '미디어팀';
// 규칙 밖에서 주보를 쓰는 사람(명단 id) — 사용자 결정 2026-09-27 '조준환 한 사람만' · 서버는 0083
export const SERVICE_EDITOR_PEOPLE = ['d2a6ea3d-aa9a-41ce-a6e8-7c43728402b0'];   // 조준환
// 전체 출석은 **리더순장 하나**다(0043의 다섯 직분 중). 부장·총무·리더팀장은 빠진다.
const LEAD_SUNJANG = 'lead_sunjang';

export function worshipPerms({ isMaster = false, isAdmin = false, myPerson = null, myRoles = [], ledGroupIds = [] } = {}) {
  const roles = myRoles || [];
  const pastor = !!myPerson?.is_pastor;
  const media = (myPerson?.teams || []).includes(MEDIA_TEAM);
  const canEdit = !!isMaster || !!isAdmin || pastor || roles.includes('president') || media
    || SERVICE_EDITOR_PEOPLE.includes(myPerson?.id);
  const canCheckAll = !!isMaster || !!isAdmin || pastor || roles.includes(LEAD_SUNJANG);
  const led = ledGroupIds || [];
  // **큐시트 사본을 고칠 수 있는 사람은 교역자·마스터뿐이다**(사용자 결정 2026-09-09 —
  // "큐시트는 교역자와 마스터만 수정 가능하게 하자"). 주보를 쓰는 자격(canEdit)보다 좁다:
  // 회장·미디어팀·관리자는 주보를 쓰지만 큐시트 원고를 고치지는 않는다.
  //
  // **이 깃발은 화면이 /edit 주소를 줄지 말지만 정한다.** 실제 경계는 드라이브에 있다 —
  // 그 사본에 편집자로 올라간 구글 계정 둘(joshua052698@gmail.com · mose716@gmail.com)만
  // 실제로 고칠 수 있고, 나머지는 /edit으로 열어도 읽기 화면이 뜬다(Apps Script v10).
  // 그래서 여기서 새는 것이 권한 구멍은 아니다 — 헛걸음을 줄이는 자리다.
  const canEditCue = !!isMaster || pastor;
  return { canEdit, canCheckAll, canEditCue, ledGroupIds: led, canCheck: canCheckAll || led.length > 0 };
}

// 그 순을 내가 체크할 수 있나. '순 미지정'(groupId 없음)과 전도사님·부장님 묶음은
// **전체 자격자만** 만진다 — 순장에게는 자기 순 청년뿐이고, 그 묶음들은 순이 아니다.
export const canToggleGroup = (perms, groupId) =>
  !!perms?.canCheckAll
  || (!!groupId && !HEAD_GROUPS.has(groupId) && (perms?.ledGroupIds || []).includes(groupId));

// 이름 가나다순은 people.js의 byName 한 벌이다(모임과 같이 쓴다).

// 순별로 묶은 명단. 순장은 편성 명단에 없어도 자기 순에 세운다(0036 same_sun과 같다).
// 어느 순에도 없는 사람은 맨 끝 '순 미지정' 묶음으로.
//
// **맨 앞에는 전도사님·부장님 묶음이 선다**(사용자 지적 2026-09-07 — 신효진 부장·임성빈
// 교역자가 '순 미지정'에 들어가 있었다). 교역자는 명단 속성(`people.is_pastor`)이고 부장은
// 그 해의 직분 줄(`people_roles.role='director'`)이라, 그 해 편성을 읽는 fetchRoster의
// `roles`가 여기까지 와야 안다(호칭 규칙은 people.js honorific과 같은 재료다).
// **그 사람들은 '순 미지정'에서 빠지되 순에 편성돼 있으면 순에도 그대로 선다** — 순 출석은
// 순장이 부르고, 이 묶음은 전체 자격자가 부르는 별도의 줄이다.
//
// **묶음 안 순서는 순장 먼저, 나머지는 가나다순**이다(사용자 결정 2026-09-02).
// 예전에는 group_members가 돌아온 순서 그대로였는데, 그 순서는 DB가 보장하지 않아
// 출석을 부를 때마다 사람 자리가 달라졌다. '순 미지정'도 같은 가나다순이다.
export function groupRoster({ people = [], groups = [], members = [], roles = [] } = {}) {
  const byId = new Map(people.map(p => [p.id, p]));
  const placed = new Set();
  // 그 해 부장. 한 사람이 부장이면서 교역자일 일은 없지만, 겹치면 교역자가 이긴다
  // (호칭도 people.js honorific이 같은 차례로 가른다).
  const directorIds = new Set((roles || []).filter(r => r?.role === DIRECTOR_GROUP && r?.person_id).map(r => r.person_id));
  const pastors = people.filter(p => p?.is_pastor).sort(byName);
  const directors = people.filter(p => !p?.is_pastor && directorIds.has(p.id)).sort(byName);
  // 이 사람들은 '순 미지정'에서 뺀다(순 편성 여부와 무관하다 — placed와는 다른 집합이다)
  const headed = new Set([...pastors, ...directors].map(p => p.id));
  const heads = [
    [PASTOR_GROUP, pastors],
    [DIRECTOR_GROUP, directors],
  ].filter(([, list]) => list.length)
    .map(([id, list]) => ({ id, name: HEAD_GROUPS.get(id), leaderPersonId: null, people: list }));
  const buckets = groups.map(g => {
    // 같은 묶음에 두 번 서지 않게 — 순장이 편성 명단에도 들어 있는 경우가 흔하다
    const seen = new Set();
    const take = (id) => {
      if (seen.has(id) || !byId.has(id)) return null;
      seen.add(id); placed.add(id);
      return byId.get(id);
    };
    const leader = g.leader_person_id ? take(g.leader_person_id) : null;
    const rest = members.filter(m => m.group_id === g.id)
      .map(m => take(m.person_id)).filter(Boolean).sort(byName);
    return {
      id: g.id, name: g.name, leaderPersonId: g.leader_person_id,
      people: leader ? [leader, ...rest] : rest,
    };
  });
  const rest = people.filter(p => !placed.has(p.id) && !headed.has(p.id)).sort(byName);
  if (rest.length) buckets.push({ id: null, name: UNASSIGNED, leaderPersonId: null, people: rest });
  return [...heads, ...buckets];
}

// 묶음별 (출석/전체) — 상단 집계와 순 머리줄이 같은 셈을 쓴다.
export const countPresent = (list = [], present) => list.filter(p => present?.has(p.id)).length;

// ── 주보 ────────────────────────────────────────────────────────────────────

// 가벼운 열 두 벌(2026-09-24) — 목록 전체를 읽되 **그 화면이 실제로 읽는 칸만** 받는다.
// 주보 한 행에는 찬양·광고·임사자·큐시트(jsonb)가 들어 있어 홈·모임이 그걸 매번 통째로
// 받았다. 칸을 뺄 때는 그 화면의 소비자를 전부 봐야 한다:
//   · 홈(homeView svcQ): pickService·pastSunday·attendanceSunday(id·kind·status·service_date)
//     + 카드(title·preacher · 누르면 id로 상세). passage_ref는 여유로 싣는다.
//   · 모임(groupsView mineQ): 위에 더해 순모임 가이드가 **고른 주보로 프롬프트를 만든다**
//     (sunGuide.buildGuidePrompt — title·passage_ref·preacher·songs·praise_leader).
// 예배 화면은 전체(COLS)다 — 상세·recentSongs·prefillRoles가 roles·notices까지 읽는다.
// 게스트는 저장된 행을 그대로 준다(칸을 거르지 않는다 — 작은 목록이다).
// 홈은 **예배 날 '오늘의 예배' 카드**가 찬양·광고까지 한 장에 싣는다(2026-09-25 · homeView 주일 모드) —
// songs·notices·praise_leader·praise_playlist_url을 더했고, 그러면 가이드 칸(songs·praise_leader)을 다 품어서 둘이 같아졌다.
export const HOME_SERVICE_COLS = 'id, kind, service_date, status, title, passage_ref, preacher, songs, notices, praise_leader, praise_playlist_url';
export const GUIDE_SERVICE_COLS = HOME_SERVICE_COLS;

// ── 주보에 붙는 파일의 갈래 (0054 · 0081) ───────────────────────────────────
// 0054 이전에 심긴 행(게스트 시드·옛 주보)에는 kind가 없다 — **송폼으로 읽는다**.
// 그때 주보에 붙는 파일은 송폼 하나뿐이었고, 0054의 백필도 같은 값을 넣었다.
export const SONGFORM = 'songform';
export const CUESHEET = 'cuesheet';
// 표지 사진(0081) — 주보당 한 장. 송폼·큐시트와 같은 표·같은 폴더·같은 업로드 한 벌이다.
export const COVER = COVER_KIND;
export const fileKindOf = (f) => (f?.kind || SONGFORM);
export const filesOfKind = (files, kind) => (files || []).filter(f => fileKindOf(f) === kind);

// ── 지난 큐시트로 바로 편집 (사용자 요청 2026-10-02) ─────────────────────────────
// 9/20 큐시트의 구글 편집 사본을 고쳐 10/04 큐시트를 만들어 버린 일이 있었다 — 지난 주 것을 고쳐 다음 주 것을
// 만드는 것이 실제 쓰는 법인데 그 길이 없었다. 그래서 새 주보의 큐시트 칸에서 **지난 큐시트를 이 주보로 복사**해
// 곧바로 편집 화면을 연다. 복사할 글은 원본 .docx가 아니라 **편집 사본**이다(사람들이 고치는 곳 · as=docx로 내보낸다).
// 사본이 없으면 원본 바이트 그대로. 그 뒤는 손으로 올린 큐시트와 같은 길(uploadServiceFile)이다.
//
// 이름은 지난 날짜를 이 주보 날짜로 바꾼다 — '20260920_…' → '20261004_…'(YYYYMMDD · YY.MM.DD · YYYY-MM-DD 어느
// 모양이든 같은 모양으로). 날짜가 안 보이면 앞에 'YYYYMMDD_'를 붙인다.
const ymd = (iso) => String(iso || '').slice(0, 10).split('-');
export function cueNameFor(name, fromDate, toDate) {
  const n = String(name || '큐시트.docx');
  const [fy, fm, fd] = ymd(fromDate);
  const [ty, tm, td] = ymd(toDate);
  if (!ty) return n;
  const forms = [
    [`${fy}${fm}${fd}`, `${ty}${tm}${td}`],
    [`${fy}-${fm}-${fd}`, `${ty}-${tm}-${td}`],
    [`${fy.slice(2)}.${fm}.${fd}`, `${ty.slice(2)}.${tm}.${td}`],
  ];
  for (const [a, b] of forms) if (fy && n.includes(a)) return n.split(a).join(b);
  return `${ty}${tm}${td}_${n}`;
}
// 이 날짜 **앞** 주보 중 큐시트 파일이 있는 가장 가까운 것 — { service, file } | null. 한 주보에 여럿이면 마지막에 올린 것.
export function pickLastCue(services, files, beforeDate) {
  const byService = new Map();
  for (const f of files || []) {
    if (fileKindOf(f) !== CUESHEET || !f.service_id) continue;
    const cur = byService.get(f.service_id);
    if (!cur || String(f.created_at || '') > String(cur.created_at || '')) byService.set(f.service_id, f);
  }
  const prev = (services || []).filter(s => s.service_date && s.service_date < beforeDate && byService.has(s.id))
    .sort((a, b) => b.service_date.localeCompare(a.service_date))[0];
  return prev ? { service: prev, file: byService.get(prev.id) } : null;
}

// 노트 공유 알림(bulletin.notifyNoteShared)의 링크 — 순장이 노트를 읽는 자리(모임 화면)이고
// **그 주보를 싣는다**(`note=<주보 id>` · entryQuery의 약속). 없으면 모임 화면이 가장 최근
// 주보를 골라서, 지난 주보의 노트를 공유했을 때 엉뚱한 주보의 노트 목록이 섰다.
// `s`를 쓰지 않는 이유: 예배 화면이 떠 있는 채로 종을 누르면 그 화면의 진입 이펙트가
// `s`를 먼저 집어 가서 그 주보 상세를 연다(worshipView — 화면이 바뀌기 전에 돈다).
export const noteSharedLink = (serviceId) => `/?p=groups&note=${serviceId}`;
