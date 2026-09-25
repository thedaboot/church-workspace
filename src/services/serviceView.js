import { isTemplateOnly } from './noteTemplate.js';
import { honorificsOf } from './honorific.js';

// ============================================================================
// 주보를 **보여 주는 쪽**의 순수 규칙 — 본명 · 찬양 줄 · 스토리 장 나누기 · 내 노트 목록
// ----------------------------------------------------------------------------
// 저장 모양은 하나도 바꾸지 않는다. 여기 있는 것은 전부 "이미 있는 값을 어떻게 세우나"다.
// import는 순수 모듈(noteTemplate.js · honorific.js)뿐이라 노드(tests/logcheck)와 서버(api/service-view.js)가
// 그대로 부르고, 공개 페이지(src/serviceViewMain.jsx)도 supabase 없이 쓴다.
// ============================================================================

// ── 종류 이름 · 찬양팀 (worship.js에서 옮겨 왔다 · 다시 내보낸다) ──────────
// 종류 이름. 'sunday'만 상수고 나머지는 만든 사람이 적은 이름 그대로다(docs/V2.md 결정 14).
export const SUNDAY_KIND = 'sunday';
export const SUNDAY_LABEL = '주일 4부 젊은이 예배';
export const kindLabel = (kind) => (kind === SUNDAY_KIND ? SUNDAY_LABEL : (kind || '예배'));
// 찬양팀 이름은 **고정 상수**다(사용자 결정 2026-09-05: "찬양팀의 이름은 Re:born
// 워십이라 고정해줘도 나쁘지 않겠다"). 팀이 하나뿐이라 주보마다 적을 값이 아니고,
// 바뀌면 여기 한 줄만 고친다. 인도자는 격주로 바뀌므로 주보 행의 칸이다
// (`services.praise_leader` — 0044).
export const PRAISE_TEAM = 'Re:born 워십';

// ── 명단 본명 (사용자 결정 2026-09-25) ─────────────────────────────────────
// 주보(종이·상세의 섬기는 이·찬양 인도·다음 주 위원)와 스토리에서는 **계정 표시 이름 대신
// 연결된 명단의 본명**을 쓴다('이하랑Alex' → '이하랑', '꽃님' → '강꽃님'). 주보는 새가족도
// 보는 공식 문서라 본인이 정한 별명보다 이름이 맞다.
//
// **보이는 자리에서만 바꾼다.** 주보에 저장된 이름(`roles[].name`)은 그 순간의 계정 표시
// 이름이고(라이브 9/20: '이하랑Alex'·'꽃님' + personId) 그대로 둔다 — 편집 줄의 이름 칸도
// 그 글자 그대로다. HANDOFF §8의 '이름·사진은 명단↔계정을 잇지 않는다'(한쪽으로 덮으면
// 사용자가 정한 이름이 사라진다)와 부딪히지 않는다: 어느 쪽 값도 덮지 않고 **읽을 때 고를 뿐**이다.
//
// 재료는 fetchPeople의 모양이다 — 계정이 이어진 사람은 `name`이 계정 표시 이름이고 명단에 적힌
// 이름은 `roster_name`에 있다(people.js withDisplayName). personId가 있으면 id로 찾고, 이름만
// 있는 자리(찬양 인도자 · 광고 글)는 표시 이름·본명 둘 다 열쇠로 찾는다. **못 찾으면 적힌 글자
// 그대로**다(객원 강사처럼 명단에 없는 이름 — 지어내지 않는다).
export function realNameOf(people = []) {
  const byId = new Map();
  const byName = new Map();
  for (const p of people || []) {
    if (!p?.id) continue;
    const real = String(p.roster_name || p.name || '').trim();
    if (!real) continue;
    byId.set(p.id, real);
    for (const k of [p.name, p.roster_name]) {
      const key = String(k || '').trim();
      if (key && !byName.has(key)) byName.set(key, real);
    }
  }
  return (name, personId = null) => {
    const hit = (personId && byId.get(personId)) || byName.get(String(name || '').trim());
    return hit ? { name: hit, found: true } : { name: String(name || '').trim(), found: false };
  };
}

// 광고 '다음 주 예배 위원'의 한 줄 `대표기도: 이수빈 형제`에서 이름만 본명으로 바꾼다.
// 호칭은 적힌 그대로 둔다(광고는 사람이 쓴 글이다 — 호칭까지 새로 붙이지 않는다).
// 이름 칸은 `이름` 또는 `이름 호칭` 둘 중 하나로 본다: 통째로 명단에 있으면 그것, 아니면 마지막
// 띄어쓰기 앞까지를 이름으로 본다. 명단에 없으면 그 줄은 한 글자도 안 바뀐다.
const ROLE_LINE = /^(\s*[-*·•‧・]?\s*)(.{2,10}?)(\s*(?:[:：]|[-–—])\s*)(.+?)\s*$/;
// 이름 칸 하나(`이수빈 형제` · `꽃님`) → 본명으로 바꾼 글자. 명단에 없으면 그대로.
export function realNameText(value, real) {
  const v = String(value || '').trim();
  if (!v || typeof real !== 'function') return v;
  const whole = real(v);
  if (whole.found) return whole.name;
  const cut = v.lastIndexOf(' ');
  if (cut <= 0) return v;
  const head = real(v.slice(0, cut));
  return head.found ? `${head.name}${v.slice(cut)}` : v;
}
export function realNamesInRoleLines(body, real) {
  if (typeof real !== 'function') return String(body || '');
  return String(body || '').split('\n').map((line) => {
    const m = ROLE_LINE.exec(line);
    if (!m) return line;
    const next = realNameText(m[4], real);
    return next === m[4] ? line : `${m[1]}${m[2]}${m[3]}${next}`;
  }).join('\n');
}

// 광고 제목이 '다음 주 예배 위원'인가 — 띄어쓰기를 접어 견준다(worship.prefillRoles와 같은 열쇠)
export const isNextWeekNotice = (n) => String(n?.title || '').replace(/\s+/g, '').includes('다음주예배위원');

// 그 광고의 줄들 → [{ role, value }] (스토리 마지막 장). 모양이 아닌 줄은 버린다.
export function nextWeekRoles(notices = []) {
  const n = (notices || []).find(isNextWeekNotice);
  if (!n) return [];
  return String(n.body || '').split('\n').map(l => ROLE_LINE.exec(l)).filter(Boolean)
    .map(m => ({ role: m[2].trim(), value: m[4].trim() })).filter(r => r.role && r.value);
}

// ── 찬양 줄 — 팀과 제목 (사용자 결정 2026-09-25) ────────────────────────────
// 곡 제목이 `팀 - 제목` 모양이면(**첫 ` - `** 기준) 팀과 제목을 나눠 보여 준다. 유튜브에서 가져온
// 제목이 대개 그 모양이다(라이브 9/13·9/20 열 곡). 아니면 **제목 한 줄 그대로**다 — 라이브에는
// `제목 | 팀`·`제목ㅣ팀`·`제목 l 팀`도 있는데(9/6) 어느 쪽이 팀인지 글자만으로는 모른다.
// 지어내서 나누지 않는다. 앞뒤 어느 한쪽이라도 비면 나누지 않는다.
export function splitSongTitle(title) {
  const s = String(title || '').trim();
  const i = s.indexOf(' - ');
  if (i <= 0) return { team: '', title: s };
  const team = s.slice(0, i).trim();
  const rest = s.slice(i + 3).trim();
  return team && rest ? { team, title: rest } : { team: '', title: s };
}

// ── 스토리 장 나누기 ────────────────────────────────────────────────────────
// 잰 높이들 → 장마다 들어갈 [시작, 끝) 목록. 앞에서부터 채우고 넘치면 다음 장이다.
// **혼자서 한 장을 넘는 항목은 그 장을 혼자 쓴다**(그 장 안에서만 세로로 내린다 — 목업 판단).
// 높이를 아직 못 쟀으면(avail ≤ 0) 한 장에 다 싣는다(첫 프레임).
export function packPages(heights = [], avail = 0, gap = 0) {
  if (!heights.length) return [];
  if (!(avail > 0)) return [[0, heights.length]];
  const pages = [];
  let start = 0;
  let used = 0;
  heights.forEach((h, i) => {
    if (i === start) { used = h; return; }
    if (used + gap + h <= avail) { used += gap + h; return; }
    pages.push([start, i]);
    start = i; used = h;
  });
  pages.push([start, heights.length]);
  return pages;
}

// 스토리 광고 장에 설 광고 — **전부**다(사용자 요청 2026-09-26 — 제목만 있는 광고도 종이·홈 오늘의
// 예배 카드처럼 제목 한 줄로 선다). 제목도 본문도 없는 줄만 뺀다 · '다음 주 예배 위원'은 마지막 장으로
// 옮겨 가므로 여기서 뺀다. 공개 보기(api/service-view)도 이 규칙 한 벌이다.
export const storyNotices = (notices = []) => (notices || [])
  .filter(n => (String(n?.title || '').trim() || String(n?.body || '').trim()) && !isNextWeekNotice(n));

// ── 내 예배 노트 모아 보기 (2026-09-25) ────────────────────────────────────
// 내 노트 행 + 주보 목록 → [{ service, note }] — **쓴 것만**(빈 노트·손대지 않은 템플릿은
// 뺀다 · isTemplateOnly), 주보가 목록에 없는 노트도 뺀다(지워진 주보 · 발행 전으로 돌아간 주보),
// 최근 예배가 앞이다. 노트 행은 이미 **내 것만** 온다(worship.fetchMyNotes가 profile_id로 거른다).
export function myNoteRows(notes = [], services = []) {
  const byId = new Map((services || []).map(s => [s?.id, s]));
  return (notes || [])
    .map(n => ({ note: n, service: byId.get(n?.service_id) }))
    .filter(r => r.service && String(r.note?.body || '').trim() && !isTemplateOnly(r.note.body, r.service.passage_ref || ''))
    .sort((a, b) => String(b.service.service_date || '').localeCompare(String(a.service.service_date || '')));
}

// ── 표지 사진 (0081 · 사용자 결정 2026-09-26 · 목업 mockup-followup 2 · mockup-grace 2) ──────
// 사진은 주보 첨부와 같은 길로 그 주보의 드라이브 폴더에 가고 `files.kind = 'cover'` 한 장이다.
// 보일 부분은 `services.cover_focus_y` 0~1 하나 — 그리는 쪽은 `object-fit: cover` +
// `object-position: 50% {y*100}%` 한 줄이라 폰 카드(4.5:1)·폰 머리·데스크톱 머리 어디서나
// "사진의 y% 줄 = 틀의 y% 줄"로 같은 줄이 보인다(가로 값은 없다 — 틀이 사진보다 늘 가로로 길다).
// 받는 주소는 lh3의 **자르지 않은** 사진(`=w720`, 1배 화면은 `=w360`)이다. `-c`(가운데 자르기)를
// 붙이면 서버가 위치를 버린다. 드라이브 업로드는 링크 보기(anyone·reader)라 로그인 없이 온다
// (docs/APPS_SCRIPT.md · 첨부 썸네일과 같은 근거) — 공개 보기(api/service-view)도 같은 주소다.
// 우선순위는 **사진 > 절기 색 > 기본 그라데이션**(HANDOFF §8 교회력).
export const COVER_KIND = 'cover';
export const COVER_RATIO = 76 / 343;        // 목록 카드 비율 — 표지 위치 창의 틀
export const clampFocus = (y) => {
  const n = Number(y);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
};
export const coverPosition = (y) => `50% ${Math.round(clampFocus(y) * 1000) / 10}%`;
export const coverUrl = (fileId, w = 720) => `https://lh3.googleusercontent.com/d/${fileId}=w${w}`;

// 표지 한 장 → <img>에 줄 { src, srcSet } | null. 방금 올린 사진·게스트는 브라우저 안 주소(`_src`)다
// (드라이브가 섬네일을 만들기 전 몇 초 동안 lh3가 비어 있을 수 있다). Storage로 떨어진 옛 경로
// (드라이브 미설정)는 주소가 없어 null — 사진 없이 절기 색으로 선다.
export function coverImage(cover) {
  if (!cover) return null;
  if (cover._src) return { src: cover._src, srcSet: undefined };
  const id = cover.drive_file_id;
  if (!id) return null;
  return { src: coverUrl(id, 720), srcSet: `${coverUrl(id, 360)} 1x, ${coverUrl(id, 720)} 2x` };
}

// 목록 한 번에 모은 표지 행들 → { service_id: 행 } — 한 주보에 두 장이 겹쳐 있으면(새 것을 넣고
// 옛 것을 지우는 사이) **가장 최근** 한 장이다. 표지가 아닌 행은 무시한다.
export function coverMap(rows = []) {
  const out = {};
  for (const r of rows || []) {
    if (!r?.service_id || (r.kind && r.kind !== COVER_KIND)) continue;
    const prev = out[r.service_id];
    if (!prev || String(r.created_at || '') >= String(prev.created_at || '')) out[r.service_id] = r;
  }
  return out;
}

// 표지 위치 창 — 사진 상자(stageW×stageH) 위 카드 비율 틀의 자리. 틀은 폭을 다 쓰고 위아래로만 간다.
// 파노라마처럼 사진이 틀보다 납작하면 틀이 사진 높이에 멈춘다(그때 y는 뜻이 없다 — 가운데).
export function coverFrame(stageW, stageH, y, ratio = COVER_RATIO) {
  const h = Math.min(stageH, stageW * ratio);
  return { top: clampFocus(y) * Math.max(0, stageH - h), height: h };
}
// 끌기 — 시작 값 + 손가락이 간 거리 / 틀이 움직일 수 있는 거리
export function dragFocus(startY, dy, stageW, stageH, ratio = COVER_RATIO) {
  const range = stageH - Math.min(stageH, stageW * ratio);
  return range > 0 ? clampFocus(startY + dy / range) : clampFocus(startY);
}

// ── 주보 공개 보기 (사용자 결정 2026-09-26 · api/service-view.js · src/serviceViewMain.jsx) ──────────
// 로그인 없이 열리는 주소라 **서버가 필요한 칸만 골라** 넘긴다 — 이 함수가 그 목록의 정본이다.
// 싣는 것: 넘기면서 보기·종이가 그리는 것뿐(종류·날짜·제목·본문 구절·설교자·찬양·광고·섬기는 이·
// 찬양 인도·표지). **싣지 않는 것**: 출석·출석 메모·노트·큐시트·드라이브 폴더·작성자·personId 같은
// 속 칸(개인 표는 애초에 읽지 않는다). 이름은 앱 화면과 같은 규칙(명단 본명 + 호칭 · PDF와 같다 —
// 사용자 결정)으로 **서버에서 다 풀어** 보낸다 — 공개 페이지에 명단을 통째로 주지 않는다.
// people은 fetchPeople의 모양(계정이 이어진 사람은 name = 표시 이름 · roster_name = 명단 이름)이다.
// 서명이 틀렸거나 발행 전 — 서버 404 페이지와 공개 페이지가 같은 한 줄을 쓴다('없어요'로 끝내지 않는다 · HANDOFF §8)
export const PUBLIC_MISSING = '잘못된 주소이거나 발행 전인 주보예요';
export function publicService(service, { people = [], roles = [], cover = null } = {}) {
  if (!service) return null;
  const real = realNameOf(people);
  const honor = honorificsOf(people, roles);
  const nameOf = (name, personId = null) => {
    const r = real(name, personId);
    return honor(r.found ? r.name : name, personId);
  };
  const str = (v) => String(v ?? '');
  return {
    id: str(service.id),
    kind: str(service.kind || SUNDAY_KIND),
    service_date: str(service.service_date).slice(0, 10),
    title: str(service.title),
    passage_ref: str(service.passage_ref),
    preacher: str(service.preacher),
    praise_leader: service.praise_leader ? nameOf(service.praise_leader) : '',
    roles: (Array.isArray(service.roles) ? service.roles : [])
      .filter(r => r && (str(r.role).trim() || str(r.name).trim()))
      .map(r => ({ role: str(r.role), name: str(r.name).trim() ? nameOf(r.name, r.personId || r.person_id || null) : '' })),
    songs: (Array.isArray(service.songs) ? service.songs : [])
      .filter(s => s && str(s.title).trim())
      .map(s => ({ title: str(s.title), link: /^https:\/\//.test(str(s.link)) ? str(s.link) : '' })),
    notices: (Array.isArray(service.notices) ? service.notices : [])
      .filter(n => n && (str(n.title).trim() || str(n.body).trim()))
      .map(n => ({ title: str(n.title), body: isNextWeekNotice(n) ? realNamesInRoleLines(n.body, real) : str(n.body) })),
    cover_focus_y: clampFocus(service.cover_focus_y ?? 0.5),
    cover: cover?.drive_file_id ? { drive_file_id: str(cover.drive_file_id) } : null,
  };
}
