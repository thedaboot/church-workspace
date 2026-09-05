import { supabase } from './supabaseClient.js';
import { fetchPeople, fetchGroups, fetchGroupMembers, fetchMyPerson, fetchRoles, guestStore } from './people.js';
import { listServiceFiles, uploadServiceFile as uploadServiceFileToDrive, ensureServiceFolder, deleteAttachment } from './cloud.js';
import { downscaleImage, FILE_MAX_DIM } from './image.js';
import { generateId } from '../utils.js';

// ============================================================================
// v2 예배 — 주보(services) · 출석(attendance) · 내 예배 노트(service_notes)
// ----------------------------------------------------------------------------
// 스펙 정본은 docs/V2.md §1(결정 4·5·6·7·14)·§2, 저장 자리는 0036이다.
//
// **RLS가 권한의 진실이고 화면은 그걸 비춘다.** 여기 있는 판정 함수(worshipPerms)는
// 0035·0036의 can_edit_service()·can_check_all_attendance()·leads_sun_of()를 그대로
// 옮긴 것이다 — 버튼을 감추는 용도이지 막는 용도가 아니다. 어긋나면 DB가 이긴다.
//
// 명단·순 편성은 people.js 한 벌을 쓴다(다시 만들지 않는다). 이 파일은 그 위에
// 예배 화면이 필요로 하는 것만 얹는다: 주보 읽기·쓰기, 출석 토글, 내 노트 upsert.
//
// **게스트 모드(supabase 없음)에서는 localStorage가 클라우드 자리를 대신한다** —
// 워크스페이스가 게스트에서 `church_app_v4`를 보는 것과 같은 방식이다. 그래야
// 브라우저 스위트가 이 화면을 실제로 눌러 볼 수 있다(tests/worship.mjs). 클라우드
// 경로(RLS·실데이터)는 사람이 확인해야 한다 — HANDOFF §2-6.
// ============================================================================

const COLS = 'id, kind, service_date, status, title, passage_ref, preacher, roles, songs, notices, praise_leader, praise_playlist_url, attendance_note, drive_folder_id, created_at, updated_at';

export const SUNDAY_KIND = 'sunday';
const SUNDAY_LABEL = '주일 4부 젊은이 예배';
const UNASSIGNED = '순 미지정';

// 찬양팀 이름은 **고정 상수**다(사용자 결정 2026-09-05: "찬양팀의 이름은 Re:born
// 워십이라 고정해줘도 나쁘지 않겠다"). 팀이 하나뿐이라 주보마다 적을 값이 아니고,
// 바뀌면 여기 한 줄만 고친다. 인도자는 격주로 바뀌므로 주보 행의 칸이다
// (`services.praise_leader` — 0044).
export const PRAISE_TEAM = 'Re:born 워십';

// ── 게스트 시드 (클라우드가 없을 때의 저장 자리) ────────────────────────────
const { all: guestAll, rows: guestRows, set: guestSet } = guestStore('church_worship_v1');

// ── 순수 헬퍼 (브라우저 없이도 검사된다) ────────────────────────────────────

// 종류 이름. 'sunday'만 상수고 나머지는 만든 사람이 적은 이름 그대로다(결정 14).
export const kindLabel = (kind) => (kind === SUNDAY_KIND ? SUNDAY_LABEL : (kind || '예배'));

// 다가오는 주일. 오늘이 주일이면 오늘이다 — 주일 아침에 주보를 만들면서
// 다음 주 날짜가 기본값이면 매번 고쳐야 한다.
export function nextSundayDate(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
//   주보 작성·발행 = 관리자(마스터 포함) + 교역자 + 올해 회장 + 미디어팀  (can_edit_service)
//   출석 전체      = 관리자(마스터 포함) + 교역자 + 올해 **리더순장**     (can_check_all_attendance)
//   출석 자기 순   = 올해 그 순의 순장                                   (leads_sun_of)
//
// 두 번 바뀐 자리다. ① 2026-09-03(0042) 주보에서 교역자가 빠지고 미디어팀이 들어왔고,
// ② **2026-09-05 교역자가 주보로 돌아왔고 전체 출석은 리더순장 하나로 좁혀졌다**
// (예전에는 '그 해 직분 줄이 있으면 누구나'라 부장·총무·리더팀장까지 전원을 만졌다).
// 미디어팀은 명단 속성(people.teams)이라 연도와 무관하고, 회장·리더순장은 연도별 직분이다.
// 나머지 사람은 발행된 주보를 읽기만 한다 — 화면에서 버튼을 감추지만 경계는 RLS다.
const MEDIA_TEAM = '미디어팀';
// 전체 출석은 **리더순장 하나**다(0043의 다섯 직분 중). 부장·총무·리더팀장은 빠진다.
const LEAD_SUNJANG = 'lead_sunjang';

export function worshipPerms({ isMaster = false, isAdmin = false, myPerson = null, myRoles = [], ledGroupIds = [] } = {}) {
  const roles = myRoles || [];
  const pastor = !!myPerson?.is_pastor;
  const media = (myPerson?.teams || []).includes(MEDIA_TEAM);
  const canEdit = !!isMaster || !!isAdmin || pastor || roles.includes('president') || media;
  const canCheckAll = !!isMaster || !!isAdmin || pastor || roles.includes(LEAD_SUNJANG);
  const led = ledGroupIds || [];
  return { canEdit, canCheckAll, ledGroupIds: led, canCheck: canCheckAll || led.length > 0 };
}

// 그 순을 내가 체크할 수 있나. '순 미지정'(groupId 없음)은 전체 자격자만 만진다.
export const canToggleGroup = (perms, groupId) =>
  !!perms?.canCheckAll || (!!groupId && (perms?.ledGroupIds || []).includes(groupId));

// 이름 가나다순. localeCompare('ko')라야 'ㄱㄴㄷ'이 맞는다 — 기본 비교는 코드포인트
// 순서라 한글도 얼추 맞지만 자모 조합·영문 섞임에서 어긋난다.
const byKoName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');

// 순별로 묶은 명단. 순장은 편성 명단에 없어도 자기 순에 세운다(0036 same_sun과 같다).
// 어느 순에도 없는 사람은 맨 끝 '순 미지정' 묶음으로 — 새신자가 여기로 들어온다.
//
// **묶음 안 순서는 순장 먼저, 나머지는 가나다순**이다(사용자 결정 2026-09-02).
// 예전에는 group_members가 돌아온 순서 그대로였는데, 그 순서는 DB가 보장하지 않아
// 출석을 부를 때마다 사람 자리가 달라졌다. '순 미지정'도 같은 가나다순이다.
export function groupRoster({ people = [], groups = [], members = [] } = {}) {
  const byId = new Map(people.map(p => [p.id, p]));
  const placed = new Set();
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
      .map(m => take(m.person_id)).filter(Boolean).sort(byKoName);
    return {
      id: g.id, name: g.name, leaderPersonId: g.leader_person_id,
      people: leader ? [leader, ...rest] : rest,
    };
  });
  const rest = people.filter(p => !placed.has(p.id)).sort(byKoName);
  if (rest.length) buckets.push({ id: null, name: UNASSIGNED, leaderPersonId: null, people: rest });
  return buckets;
}

// 묶음별 (출석/전체) — 상단 집계와 순 머리줄이 같은 셈을 쓴다.
export const countPresent = (list = [], present) => list.filter(p => present?.has(p.id)).length;

// ── 주보 ────────────────────────────────────────────────────────────────────

// 작성 중(draft)은 편집 자격자에게만 온다 — 화면이 아니라 RLS가 거른다(0036).
export async function fetchServices() {
  if (!supabase) return [...guestRows('services')].sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)));
  const { data, error } = await supabase.from('services').select(COLS).order('service_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createService({ kind = SUNDAY_KIND, serviceDate }) {
  const row = { kind: (kind || SUNDAY_KIND).trim() || SUNDAY_KIND, service_date: serviceDate, status: 'draft' };
  if (!supabase) {
    const made = { id: generateId(), roles: [], songs: [], notices: [], title: '', passage_ref: '', preacher: '', praise_leader: '', praise_playlist_url: '', attendance_note: '', created_at: new Date().toISOString(), ...row };
    guestSet('services', [...guestRows('services'), made]);
    return made;
  }
  const { data, error } = await supabase.from('services').insert(row).select(COLS).single();
  if (error) throw error;
  return data;
}

export async function saveService(id, patch) {
  if (!supabase) {
    const rows = guestRows('services').map(s => (s.id === id ? { ...s, ...patch } : s));
    guestSet('services', rows);
    return rows.find(s => s.id === id);
  }
  const { data, error } = await supabase.from('services')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single();
  if (error) throw error;
  return data;
}

export const publishService = (id) => saveService(id, { status: 'published' });

export async function removeService(id) {
  if (!supabase) { guestSet('services', guestRows('services').filter(s => s.id !== id)); return; }
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw error;
}

// ── 송폼 (주보에 붙는 파일 · 0047) ──────────────────────────────────────────
// 저장 자리는 업무 첨부와 **같은 files 표**다(축만 card_id → service_id로 바뀐다).
// 드라이브도 같은 길이라(cloud.uploadServiceFile → uploadOwnedFile) 3MB 갈래·멱등
// 열쇠·미리보기·내려받기·휴지통이 전부 그대로 동작한다. 여기서 가르는 것은
// 게스트/클라우드뿐이다.
//
// **게스트 모드에는 드라이브도 Storage도 없다.** 행만 localStorage에 남기고 바이트는
// 메모리에 둔다(§6-29-k와 같은 이유 — localStorage는 문자열 5MB라 PDF 한 장도 못 담는다).
// 새로고침하면 줄은 남고 미리보기만 못 연다.
const guestBytes = new Map();   // files.id → 고른 File (게스트 세션 동안만)

export async function fetchServiceFiles(serviceId) {
  if (!supabase) {
    return guestRows('files')
      .filter(f => f.service_id === serviceId)
      .map(f => (guestBytes.has(f.id) ? { ...f, _file: guestBytes.get(f.id) } : f));
  }
  return listServiceFiles(serviceId);
}

// 드라이브 폴더는 **파일 바이트가 오가기 전에** 한 번만 확보한다(§6-29-h).
// 게스트에는 폴더가 없다 — null이면 부르는 쪽이 그냥 올린다.
export async function ensureServiceDriveFolder(service) {
  if (!supabase) return null;
  return ensureServiceFolder(service);
}

export async function uploadServiceFile(service, file, folderId = null) {
  if (!supabase) {
    const row = {
      id: generateId(), service_id: service.id, name: file.name,
      size_bytes: file.size ?? null, mime_type: file.type || null, source: 'local',
    };
    guestBytes.set(row.id, file);
    guestSet('files', [...guestRows('files'), row]);
    return { ...row, _file: file };
  }
  // 사진으로 찍어 온 송폼도 있다 — 첨부와 같이 보내기 직전에 줄인다(§6-29-m).
  // 사진이 아니거나 이미 작으면 원본 그대로 간다.
  const sending = await downscaleImage(file, FILE_MAX_DIM, 0.9);
  return uploadServiceFileToDrive(sending, {
    serviceId: service.id,
    serviceDate: service.service_date,
    serviceFolderId: folderId || service.drive_folder_id || null,
  });
}

// 지우는 길은 업무 첨부와 한 벌이다 — **DB 행부터, 실체는 그 뒤 최선으로**(§6-29-e).
export async function removeServiceFile(row) {
  if (!supabase) {
    guestBytes.delete(row.id);
    guestSet('files', guestRows('files').filter(f => f.id !== row.id));
    return;
  }
  return deleteAttachment(row);
}

// ── 명단 · 자격 ─────────────────────────────────────────────────────────────

// 그 예배 날짜의 연도 순 편성. 순은 해마다 다시 짜므로 '올해'가 아니라 그 예배의 해다.
export async function fetchRoster(year) {
  if (!supabase) {
    const groups = guestRows('groups').filter(g => g.type === 'sun' && (!year || g.year === year));
    const ids = new Set(groups.map(g => g.id));
    return {
      people: guestRows('people').filter(p => !p.removed_at),
      groups,
      members: guestRows('group_members').filter(m => ids.has(m.group_id)),
    };
  }
  const [people, groups] = await Promise.all([fetchPeople(), fetchGroups('sun', year)]);
  const members = await fetchGroupMembers(groups.map(g => g.id));
  return { people, groups, members };
}

// 화면이 쓸 자격 한 벌. 마스터·관리자는 로그인 계정 속성이라 호출부(useAuth)가 준다.
// 게스트 모드에는 로그인이 없다 — 시드의 me가 그 자리를 대신하고, 기본은 전부 허용이다
// (게스트에서 isAdmin·isMaster가 true인 것과 같은 취급).
export async function fetchWorshipPerms(year, { isMaster = false, isAdmin = false } = {}) {
  if (!supabase) {
    return { canEdit: true, canCheckAll: true, ledGroupIds: [], canCheck: true, ...(guestAll().me || {}) };
  }
  const [myPerson, roles, groups] = await Promise.all([fetchMyPerson(), fetchRoles(year), fetchGroups('sun', year)]);
  const myRoles = myPerson ? roles.filter(r => r.person_id === myPerson.id).map(r => r.role) : [];
  const ledGroupIds = myPerson ? groups.filter(g => g.leader_person_id === myPerson.id).map(g => g.id) : [];
  return worshipPerms({ isMaster, isAdmin, myPerson, myRoles, ledGroupIds });
}

// 명단에 없는 사람을 그 자리에서 올린다(결정 6). 출석 자격자면 RLS가 통과시킨다(0035).
export async function addRosterPerson(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (!supabase) {
    const made = { id: generateId(), name: clean, teams: [], is_pastor: false, profile_id: null };
    guestSet('people', [...guestRows('people'), made]);
    return made;
  }
  const { data, error } = await supabase.from('people').insert({ name: clean })
    .select('id, name, birthday, teams, is_pastor, profile_id').single();
  if (error) throw error;
  return data;
}

// 갓 올린 사람을 **그 순의 명단에 넣는다**(0035 group_members · 0050).
// 왜 여기 있나: `attendance_insert`는 `leads_sun_of(person_id)` — "그 사람이 내 순의
// 순원인가"를 묻는데, 방금 만든 사람은 어느 순에도 없다. 그래서 순장이 올린 새신자는
// 명단에만 오르고 출석이 42501로 막혔다(순장 계정으로 재현 2026-09-06). 순장에게는
// 사람을 만들 자격만 있고(people_insert의 leads_any_sun) 자기 순에 넣을 자격이 없었다 —
// 그 한 칸을 0050이 연다.
//
// **이미 구성원인 것은 실패가 아니다** — PK가 (group_id, person_id)라 두 번 넣으면
// 23505가 나는데 넣으려던 상태는 이미 참이다(groups.addMember와 같은 판단 · §6의 23505).
// 게스트에서는 groups.addMember(church_groups_v1)가 아니라 **예배 저장 자리**에 넣는다 —
// 출석 화면의 명단(fetchRoster)이 읽는 곳이 그쪽이다(people.js guestStore 주석).
export async function addToSun(groupId, personId) {
  if (!groupId || !personId) return;
  if (!supabase) {
    const rows = guestRows('group_members').filter(m => !(m.group_id === groupId && m.person_id === personId));
    guestSet('group_members', [...rows, { group_id: groupId, person_id: personId }]);
    return;
  }
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, person_id: personId });
  if (error && String(error.code) !== '23505') throw error;
}

// ── 출석 ────────────────────────────────────────────────────────────────────
// 행이 있으면 출석, 지우면 취소(0036). 화면은 낙관적으로 먼저 바꾸고 실패하면 되돌린다.

export async function fetchAttendance(serviceId) {
  if (!supabase) return guestRows('attendance').filter(a => a.service_id === serviceId).map(a => a.person_id);
  const { data, error } = await supabase.from('attendance').select('person_id').eq('service_id', serviceId);
  if (error) throw error;
  return (data ?? []).map(r => r.person_id);
}

// **"이미 출석"은 실패가 아니다**(§6의 23505 항목과 같은 판단). PK가 (service_id,
// person_id)라 두 번 찍으면 23505가 나는데, 넣으려던 상태는 이미 참이다. 예전에는
// 화면이 켠 칩을 도로 끄고 '표시하지 못했어요'라고 말했다 — DB에는 있는데 화면만
// 없다고 하는, 정확히 반대로 된 답이었다(2026-09-06 지적). upsert + ignoreDuplicates가
// 그 왕복을 아예 없앤다(존재하면 아무 일도 하지 않는다).
export async function checkIn(serviceId, personId) {
  if (!supabase) {
    const rows = guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId));
    guestSet('attendance', [...rows, { service_id: serviceId, person_id: personId }]);
    return;
  }
  const { error } = await supabase.from('attendance').upsert(
    { service_id: serviceId, person_id: personId },
    { onConflict: 'service_id,person_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function checkOut(serviceId, personId) {
  if (!supabase) {
    guestSet('attendance', guestRows('attendance').filter(a => !(a.service_id === serviceId && a.person_id === personId)));
    return;
  }
  const { error } = await supabase.from('attendance').delete().eq('service_id', serviceId).eq('person_id', personId);
  if (error) throw error;
}

// 공유 상태만 바꾼다 — **글은 건드리지 않는다.**
//   setNoteShared(serviceId, shared) → 갱신된 행 { id?, body, shared_to_sun } | null
// 노트가 없으면 아무것도 만들지 않고 null을 준다(공유할 글이 없으니 뜻이 없다).
// 이 함수는 예배 화면의 노트 구역과 **모임 화면의 '공유된 노트' 목록이 같이 쓴다** —
// 그쪽에서 내 비공개 노트를 그 자리에서 공유로 바꿀 때도 이 한 벌을 부르면 된다.
// RLS(0036 service_notes_write)가 profile_id = auth.uid()로 자기 것만 허용한다.
export async function setNoteShared(serviceId, shared) {
  const cur = await fetchMyNote(serviceId);
  if (!cur) return null;
  return saveMyNote(serviceId, { body: cur.body || '', sharedToSun: !!shared });
}

// ── 유튜브 가져오기 (서버 함수 경유) ───────────────────────────────────────
// 재생목록은 RSS로, 영상 제목은 oEmbed로 받는다. 둘 다 api/yt.js가 대신 받아 온다 —
// 브라우저에서 바로 부르면 CORS가 막고, 나중에 키를 쓰는 길로 가더라도 서버만 바뀐다.
// **게스트·로컬 vite에는 /api/yt가 없다**(404) — 그때는 토스트 한 줄로 끝낸다.
//
// **왜 안 됐는지를 원인마다 다르게 말한다**(사용자 지시 2026-09-03: '지금은 가져올 수
// 없어요'로는 무엇을 하면 되는지 알 수 없다). 여기서 만드는 글은 **뒷도막(이유)** 이고
// 앞도막('재생목록을 가져오지 못했어요')은 부르는 화면이 붙인다 — failText가 그 둘을
// 잇는다(errorText.js의 err.human 경로).
//
// `quiet`는 '콘솔에 오류로 남길 일이 아니다'는 뜻이다 — 서버 함수가 없는 환경
// (게스트·로컬 vite)이나 주소를 잘못 붙인 경우가 그렇다. 고장이 아니라 환경이거나
// 사람이 고칠 수 있는 일이라 화면의 토스트 한 줄로 끝난다. 서버가 실제로 실패한
// 경우만 console.error로 남긴다(cloud.js가 501을 notConfigured로 가르는 것과 같은 취지).
const WHY_GUEST = '게스트 모드에서는 유튜브에 닿을 수 없어요';
const WHY_DEPLOY = '배포된 앱에서만 되는 기능이에요';
const WHY_LOGIN = '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요';
const WHY_NOT_LIST = '붙인 주소가 유튜브 재생목록 링크가 아니에요';

const cantErr = (why, quiet = false) => {
  const e = new Error('yt');
  e.human = why;
  if (quiet) e.quiet = true;
  return e;
};

async function ytFetch(body) {
  if (!supabase) throw cantErr(WHY_GUEST, true);
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw cantErr(WHY_LOGIN, true);
  const r = await fetch('/api/yt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (r.ok) return out;
  // 서버가 한국어로 이유를 주면 그것을 그대로 싣는다. 이유가 없는 404는 함수 자체가
  // 없는 것이고(로컬 vite), 401은 세션이 끊긴 것이라 우리가 이유를 만든다.
  if (r.status === 401) throw cantErr(WHY_LOGIN, true);
  if (r.status === 404 && !out.error) throw cantErr(WHY_DEPLOY, true);
  throw cantErr(out.error || '유튜브가 응답하지 않았어요\n잠시 후 다시 시도해주세요');
}

// 재생목록 주소 → [{ title, link }]. 곡 목록에 그대로 붙일 모양으로 돌려준다.
export async function fetchPlaylistSongs(url) {
  const listId = youtubeListId(url);
  if (!listId) throw cantErr(WHY_NOT_LIST, true);
  const { items = [] } = await ytFetch({ listId });
  return items.filter(v => v?.videoId).map(v => ({ title: v.title || '', link: youtubeWatchUrl(v.videoId) }));
}

// 영상 주소 → 제목. 제목 칸이 비어 있을 때만 쓴다(적어 둔 제목을 덮지 않는다).
export async function fetchVideoTitle(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) return '';
  const { title = '' } = await ytFetch({ videoId });
  return title;
}

// ── 내 예배 노트 ────────────────────────────────────────────────────────────
// 예배당 한 건(unique). 기본은 나만 보고, '내 순에 공유'를 켜면 올해 같은 순만 본다.
// 남의 노트는 이 화면에 오지 않는다 — 모임 화면 소관이다(결정 7).

async function myUid() {
  const { data: { user } = {} } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function fetchMyNote(serviceId) {
  if (!supabase) return guestRows('service_notes').find(n => n.service_id === serviceId) || null;
  const uid = await myUid();
  if (!uid) return null;
  const { data, error } = await supabase.from('service_notes')
    .select('id, body, shared_to_sun').eq('service_id', serviceId).eq('profile_id', uid).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function saveMyNote(serviceId, { body = '', sharedToSun = false }) {
  if (!supabase) {
    const rows = guestRows('service_notes').filter(n => n.service_id !== serviceId);
    const made = { service_id: serviceId, body, shared_to_sun: sharedToSun };
    guestSet('service_notes', [...rows, made]);
    return made;
  }
  const uid = await myUid();
  if (!uid) return null;
  const { data, error } = await supabase.from('service_notes')
    .upsert({ service_id: serviceId, profile_id: uid, body, shared_to_sun: sharedToSun, updated_at: new Date().toISOString() },
      { onConflict: 'service_id,profile_id' })
    .select('id, body, shared_to_sun').single();
  if (error) throw error;
  return data;
}
