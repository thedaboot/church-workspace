import { supabase } from './supabaseClient.js';
import { fetchPeople, fetchRoles, fetchGroups, fetchGroupMembers, fetchMyPerson, guestStore } from './people.js';
import { SUNDAY_KIND } from './worship.js';
import { generateId } from '../utils.js';

// ============================================================================
// v2 모임 — 내 순 · 동아리(가입 신청 · 모임 출석) · 순 편성
// ----------------------------------------------------------------------------
// 스펙 정본은 docs/V2.md §1(결정 1·2·3·7)·§2·§3, 저장 자리는 0035(groups ·
// group_members · club_applications · group_meetings)와 0036(service_notes)이고
// 자격은 0039가 마지막으로 갈아 끼웠다(can_manage_sun · groups_update).
//
// **RLS가 권한의 진실이고 화면은 그걸 비춘다.** 여기 있는 판정(groupPerms ·
// canManageClub)은 0035·0039의 can_manage_sun()·groups_insert·groups_update·
// group_members_write를 그대로 옮긴 것이다 — 버튼을 감추는 용도이지 막는 용도가
// 아니다. 어긋나면 DB가 이긴다.
//
// 명단·모임 읽기는 people.js 한 벌을 쓰고(다시 만들지 않는다), 예배 출석은 예배 줄기의
// worship.js를 그대로 부른다. 이 파일은 그 위에 모임 화면이 필요로 하는 것만 얹는다:
// 순·동아리 쓰기, 가입 신청, 모임 일정·출석, 내 순에 공유된 예배 노트 읽기.
//
// **남의 비공개 노트를 묻는 코드는 여기 없다**(결정 7). 공유 노트 조회는 언제나
// shared_to_sun = true로 좁히고, 그 안에서 '올해 같은 순'을 가르는 것은 0036의
// same_sun()이다. 순장이라도 순원의 비공개 노트·QT는 볼 수 없다.
//
// **게스트 모드(supabase 없음)에서는 localStorage가 클라우드 자리를 대신한다** —
// word.js·worship.js와 같은 방식이고 키만 다르다(church_groups_v1). 그래야 브라우저
// 스위트가 가짜 순·동아리·신청으로 이 화면을 실제로 눌러 볼 수 있다(tests/groups.mjs).
// 클라우드 경로(RLS·실데이터)는 사람이 확인해야 한다 — HANDOFF §2-6.
// ============================================================================

// position은 동아리 카드 순서다(0038). people.js의 fetchGroups는 이 칸을 읽지 않으므로
// 동아리는 여기서 직접 읽는다 — 명단 계층은 예배·모임이 함께 쓰는 곳이라 건드리지 않는다.
const GROUP_COLS = 'id, type, name, year, leader_person_id, note, position';
const APP_COLS = 'id, group_id, person_id, status, created_at';
const MEETING_COLS = 'id, group_id, meeting_date, title, attendance, note';

// ── 게스트 저장 자리 ────────────────────────────────────────────────────────
const { all: guestAll, rows: guestRows, set: guestSet } = guestStore('church_groups_v1');

// ── 순수 헬퍼 (브라우저 없이도 검사된다 — §2-5) ─────────────────────────────

// 자격 한 벌. 0039(그전에는 0035)의 함수와 같은 식이다.
//   순 편성(만들기·순장 지정·연도 개편) = 마스터 + 관리자 + 올해 리더순장  (can_manage_sun)
//   동아리 개설·리더 지정              = 마스터만                          (groups_insert)
//   동아리 명단·모임                   = 마스터 또는 그 동아리 리더        (group_members_write)
//   동아리 이름·설명 고치기            = 마스터·관리자 또는 그 동아리 리더 (groups_update)
//
// **순 편성에서 교역자가 빠지고 관리자가 들어왔다**(사용자 결정 2026-09-02 "마스터/
// 관리자/리더순장만 우선"). 0039가 can_manage_sun()을 그렇게 갈아 끼웠고 여기가 그 거울이다.
// 교역자(is_pastor)는 예배 쪽 자격에만 남는다(worship.js worshipPerms).
export function groupPerms({ isMaster = false, isAdmin = false, myPerson = null, myRoles = [], ledClubIds = [] } = {}) {
  const master = !!isMaster;
  const admin = master || !!isAdmin;   // 마스터는 admins 표의 한 행이다(0028) — 언제나 관리자다
  return {
    myPerson,
    isMaster: master,
    isAdmin: admin,
    canManageSun: master || admin || (myRoles || []).includes('lead_sunjang'),
    canCreateClub: master,
    ledClubIds: ledClubIds || [],
    // 이름·설명은 그 동아리 리더도 고친다 — 명단·모임(canManageClub)과 자격이 다르다:
    // 그쪽은 마스터+리더, 이쪽은 관리자+리더다(0039 groups_update).
    canEditClub: (club) => admin || (!!club?.leader_person_id && club.leader_person_id === myPerson?.id),
  };
}

export const canManageClub = (perms, groupId) =>
  !!perms?.isMaster || (!!groupId && (perms?.ledClubIds || []).includes(groupId));

// 이름 순서는 한 군데서 정한다 — 화면마다 다르면 같은 사람이 자리를 옮겨 다닌다.
// localeCompare('ko')라야 한글이 ㄱㄴㄷ으로 선다(기본 정렬은 유니코드 코드포인트라
// 겹받침·한자 이름에서 어긋난다).
export const byName = (a, b) =>
  String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');

// 그 모임의 사람들 — **리더가 맨 앞, 나머지는 가나다순**이고, 편성 명단에 없어도
// 세운다(0037의 관례와 같다). 예전에는 group_members가 온 차례 그대로여서 넣은
// 순서대로 쌓였고, 한 사람을 넣고 뺄 때마다 명단의 줄이 통째로 바뀌어 보였다
// (사용자 지적 2026-09-02). 리더만 예외로 위에 두는 이유: 그 자리는 이름이 아니라
// 역할로 찾는다.
export function groupPeople({ people = [], group = null, members = [] } = {}) {
  if (!group) return [];
  const byId = new Map(people.map(p => [p.id, p]));
  const seen = new Set();
  const take = (id) => {
    if (seen.has(id) || !byId.has(id)) return null;
    seen.add(id);
    return byId.get(id);
  };
  const leader = group.leader_person_id ? take(group.leader_person_id) : null;
  const rest = members
    .filter(m => m.group_id === group.id)
    .map(m => take(m.person_id))
    .filter(Boolean)
    .sort(byName);
  return leader ? [leader, ...rest] : rest;
}

// 내가 든 순(그 해). 순장은 편성 명단에 없어도 자기 순이다.
export function mySun(myPerson, suns = [], members = []) {
  if (!myPerson) return null;
  return suns.find(g => g.leader_person_id === myPerson.id
    || members.some(m => m.group_id === g.id && m.person_id === myPerson.id)) || null;
}

// 내가 든 모임 id들 — 동아리 카드의 '참여 중' 표시가 쓴다.
export function myGroupIds(myPerson, groups = [], members = []) {
  if (!myPerson) return [];
  return groups.filter(g => g.leader_person_id === myPerson.id
    || members.some(m => m.group_id === g.id && m.person_id === myPerson.id)).map(g => g.id);
}

// 가장 최근 발행 주일 예배 한 건. 없으면 null이고, 그때는 출석 줄을 아예 그리지 않는다.
export const latestSunday = (services = []) => [...services]
  .filter(s => s.kind === SUNDAY_KIND && s.status === 'published')
  .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)))[0] || null;

// 그 사람들 중 몇이 왔나 — 순 카드의 n/m이 이 셈을 쓴다.
export const presentCount = (list = [], present) => {
  const has = present instanceof Set ? (id) => present.has(id) : (id) => (present || []).includes(id);
  return list.filter(p => has(p.id)).length;
};

// 출석 배열 토글 — group_meetings.attendance는 person id 배열 jsonb다.
export function toggleAttendance(list = [], personId) {
  const set = new Set(list);
  if (set.has(personId)) set.delete(personId); else set.add(personId);
  return [...set];
}

// 동아리 카드 순서 — position이 작은 것부터, **값이 없는 것은 뒤**로 두되 원래 차례를
// 유지한다(0038이 전부 채웠지만, 그 뒤에 만들어진 동아리는 잠시 null일 수 있다).
// 값이 같을 때 Postgres가 순서를 보장하지 않는 함정(§6-24)은 두 번째 키가 막는다.
export function sortClubs(list = []) {
  return list.map((g, i) => ({ g, i }))
    .sort((a, b) => {
      const pa = Number.isFinite(a.g.position) ? a.g.position : Infinity;
      const pb = Number.isFinite(b.g.position) ? b.g.position : Infinity;
      return pa - pb || a.i - b.i;
    })
    .map(x => x.g);
}

// 순 편성 후보 — **sun_exempt인 사람은 빠진다**(0040). 부장님·전도사님은 명단에는
// 있어야 하지만(출석·직분·생일) 순원·순장 후보에 오르면 안 된다(사용자 지시
// 2026-09-03). 이름을 코드에 박지 않고 명단 속성 한 칸으로 가른다(§6-26).
// **동아리는 이 규칙을 쓰지 않는다** — 동아리 가입은 제외 대상이 아니다.
export const sunCandidates = (people = []) => people.filter(p => !p?.sun_exempt);

// 그 모임에 아직 없는 사람들 — '멤버 추가'·'순원 추가' 후보.
// 순이면 sun_exempt를 함께 걸러 낸다(위 주석) — 순 후보를 만드는 자리가 셋이라
// 규칙은 sunCandidates 한 곳에만 둔다.
export function notInGroup(people = [], group = null, members = []) {
  if (!group) return people;
  const pool = group.type === 'sun' ? sunCandidates(people) : people;
  const inside = new Set(members.filter(m => m.group_id === group.id).map(m => m.person_id));
  if (group.leader_person_id) inside.add(group.leader_person_id);
  return pool.filter(p => !inside.has(p.id));
}

// ── 순장 지정 판정 (사용자 지시 2026-09-03) ─────────────────────────────────
// "순장을 다른 사람으로 바꿨는데 '순장을 정하지 못했어요'라고 하면서 실제로는 이미
// 바뀌어 있다." 원인은 두 걸음이었다: 리더 update는 성공하고, 뒤따르는 구성원 추가가
// **유니크 위반**(group_members의 PK는 (group_id, person_id) — 0035)으로 죽었다.
// 그래서 두 가지를 고쳤다.
//   · addMember가 '이미 구성원'을 실패로 보지 않는다(아래).
//   · 저장하러 가기 **전에** 네 갈래를 판정한다 — DB 오류는 마지막 방어선일 뿐이다.
//
// 네 갈래(사용자가 정한 정책):
//   1. 이미 **다른 순의 순장**      → 세우지 않는다
//   2. **이 순의 순원**             → 세운다 (구성원 추가는 건너뛴다)
//   3. **다른 순의 순원**           → 세우지 않고, 먼저 이 순으로 옮기라고 말한다
//                                     (옮기는 일은 사람이 판단한다 — 편성이므로)
//   4. 아무 순에도 없음             → 세우고 이 순 구성원에 넣는다
// 이전 순장은 그대로 순원으로 남는다 — 리더 자리만 바뀐다.
export function leaderPlan({ group, personId, people = [], suns = [], members = [] } = {}) {
  if (!group) return { ok: false, why: '순을 찾지 못했어요' };
  // 비우기는 언제나 된다 — 구성원은 그대로 남는다
  if (!personId) return { ok: true, addMember: false, name: '' };
  if (personId === group.leader_person_id) return { ok: true, addMember: false, same: true, name: '' };

  const person = people.find(p => p.id === personId);
  const name = person?.name || '';
  if (!person) return { ok: false, why: '명단에서 그 청년을 찾지 못했어요' };
  if (person.sun_exempt) return { ok: false, why: `${name}님은 순 편성 대상이 아니에요` };

  const leads = suns.find(g => g.id !== group.id && g.leader_person_id === personId);
  if (leads) return { ok: false, why: `${name}님은 이미 ${leads.name}의 순장이에요` };

  const sunIds = new Set(suns.map(g => g.id));
  const here = members.some(m => m.group_id === group.id && m.person_id === personId);
  if (here) return { ok: true, addMember: false, name };

  const elsewhere = members.find(m => m.person_id === personId && m.group_id !== group.id && sunIds.has(m.group_id));
  if (elsewhere) {
    const other = suns.find(g => g.id === elsewhere.group_id);
    return { ok: false, why: `${name}님은 ${other?.name || '다른 순'} 순원이라, 먼저 이 순으로 순원 추가(이동)를 해 주세요` };
  }
  return { ok: true, addMember: true, name };
}

// 유니크 위반(23505)의 이유는 **부르는 쪽만 안다** — '이미 신청해 두었어요'인지
// '이미 그 순의 순원이에요'인지. errorText.js는 화면 전체가 같이 쓰는 파일이라
// 거기에 모임 화면의 사정을 넣지 않고, 그 한 줄을 여기서 얹는다(errorReason이
// err.human을 가장 먼저 본다).
export const dupReason = (err, human) =>
  (err && String(err.code) === '23505' && human) ? { code: err.code, message: err.message, human } : err;

// 연도 고르기의 후보 — 편성이 있는 해 + 올해(+ 다음 해 개편을 미리 짤 수 있게).
export function yearOptions(groups = [], now = new Date().getFullYear()) {
  const years = new Set([now, now + 1]);
  for (const g of groups) if (g.year) years.add(g.year);
  return [...years].sort((a, b) => b - a);
}

// ── 읽기 ────────────────────────────────────────────────────────────────────

// 동아리 목록. 순서는 손으로 정한 것(position)이 먼저다 — 이름순이 아니다.
async function fetchClubs() {
  if (!supabase) return sortClubs(guestRows('groups').filter(g => g.type === 'club' && !g.removed_at));
  const { data, error } = await supabase.from('groups')
    .select(GROUP_COLS).eq('type', 'club').is('removed_at', null)
    .order('position', { nullsFirst: false }).order('name');
  if (error) throw error;
  return sortClubs(data ?? []);
}

// 화면 한 벌 — 명단 · 그 해의 순 · 동아리 · 두 쪽의 구성원.
export async function fetchGroupsRoster(year) {
  if (!supabase) {
    const all = guestRows('groups').filter(g => !g.removed_at);
    const suns = all.filter(g => g.type === 'sun' && (!year || g.year === year));
    const clubs = sortClubs(all.filter(g => g.type === 'club'));
    const ids = new Set([...suns, ...clubs].map(g => g.id));
    return {
      people: guestRows('people').filter(p => !p.removed_at),
      suns, clubs,
      members: guestRows('group_members').filter(m => ids.has(m.group_id)),
      allGroups: all,
    };
  }
  const [people, suns, clubs, everySun] = await Promise.all([
    fetchPeople(), fetchGroups('sun', year), fetchClubs(), fetchGroups('sun'),
  ]);
  const members = await fetchGroupMembers([...suns, ...clubs].map(g => g.id));
  return { people, suns, clubs, members, allGroups: [...everySun, ...clubs] };
}

// 자격. 마스터·관리자는 로그인 계정 속성이라 호출부(useAuth)가 준다.
// 게스트 모드에는 로그인이 없다 — 시드의 me가 그 자리를 대신한다(worship.js와 같은 방식).
// 시드가 isAdmin을 따로 말하지 않으면 **마스터 여부를 따른다** — 마스터는 관리자이고
// (0028), 자격을 낮춰 심은 시드가 관리자 권한을 뒷문으로 얻으면 안 된다.
export async function fetchGroupPerms(year, { isMaster = false, isAdmin = false } = {}) {
  if (!supabase) {
    const me = guestAll().me || {};
    const people = guestRows('people');
    const myPerson = me.personId ? people.find(p => p.id === me.personId) || null : null;
    const clubs = guestRows('groups').filter(g => g.type === 'club' && !g.removed_at);
    const ledClubIds = myPerson ? clubs.filter(c => c.leader_person_id === myPerson.id).map(c => c.id) : [];
    const master = me.isMaster === undefined ? true : !!me.isMaster;
    return groupPerms({
      isMaster: master,
      isAdmin: me.isAdmin === undefined ? master : !!me.isAdmin,
      myPerson, myRoles: me.roles || [], ledClubIds,
    });
  }
  const [myPerson, roles, clubs] = await Promise.all([fetchMyPerson(), fetchRoles(year), fetchClubs()]);
  const myRoles = myPerson ? roles.filter(r => r.person_id === myPerson.id).map(r => r.role) : [];
  const ledClubIds = myPerson ? clubs.filter(c => c.leader_person_id === myPerson.id).map(c => c.id) : [];
  return groupPerms({ isMaster, isAdmin, myPerson, myRoles, ledClubIds });
}

// 대기 중인 동아리 가입 신청. RLS가 범위를 지킨다(0035) — 내 신청 + 내가 리더인
// 동아리의 신청만 온다. 화면은 그걸 그대로 나눠 그린다.
export async function fetchApplications() {
  if (!supabase) return guestRows('club_applications').filter(a => a.status === 'pending');
  const { data, error } = await supabase.from('club_applications')
    .select(APP_COLS).eq('status', 'pending').order('created_at');
  if (error) throw error;
  return data ?? [];
}

// 내 순에 공유된 예배 노트. **shared_to_sun = true로만 묻는다** — 남의 비공개 노트를
// 묻는 문장이 있어서는 안 된다(결정 7). 올해 같은 순인지는 0036의 same_sun()이 가른다.
export async function fetchSunSharedNotes() {
  if (!supabase) {
    const services = guestRows('services');
    return guestRows('service_notes')
      .filter(n => n.shared_to_sun && String(n.body || '').trim())
      .map(n => ({
        id: n.id || `${n.service_id}-${n.profile_id || ''}`,
        body: n.body,
        name: n.author_name || '',
        avatarUrl: '',
        serviceDate: services.find(s => s.id === n.service_id)?.service_date || '',
      }))
      .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));
  }
  const { data, error } = await supabase.from('service_notes')
    .select('id, body, updated_at, service_id, services(service_date), profiles(display_name, avatar_url)')
    .eq('shared_to_sun', true).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .filter(r => String(r.body || '').trim())
    .map(r => ({
      id: r.id,
      body: r.body,
      name: r.profiles?.display_name || '',
      avatarUrl: r.profiles?.avatar_url || '',
      serviceDate: r.services?.service_date || '',
    }));
}

export async function fetchMeetings(groupId) {
  if (!supabase) {
    return guestRows('group_meetings').filter(m => m.group_id === groupId)
      .sort((a, b) => String(b.meeting_date).localeCompare(String(a.meeting_date)));
  }
  const { data, error } = await supabase.from('group_meetings')
    .select(MEETING_COLS).eq('group_id', groupId).order('meeting_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── 쓰기 · 구성원 ───────────────────────────────────────────────────────────

export async function addMember(groupId, personId) {
  if (!supabase) {
    const rows = guestRows('group_members').filter(m => !(m.group_id === groupId && m.person_id === personId));
    guestSet('group_members', [...rows, { group_id: groupId, person_id: personId }]);
    return;
  }
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, person_id: personId });
  // **이미 구성원인 것은 실패가 아니다.** PK가 (group_id, person_id)라 두 번 넣으면
  // 23505가 나는데(0035), 넣으려던 상태는 이미 참이다. 이 한 줄이 없어서 순장을
  // 바꿀 때마다 '순장을 정하지 못했어요'가 떴다 — 리더는 이미 바뀐 뒤였다
  // (사용자 지적 2026-09-03). 게스트 경로는 위에서 이미 걸러 낸다.
  if (error && String(error.code) !== '23505') throw error;
}

export async function removeMember(groupId, personId) {
  if (!supabase) {
    guestSet('group_members', guestRows('group_members')
      .filter(m => !(m.group_id === groupId && m.person_id === personId)));
    return;
  }
  const { error } = await supabase.from('group_members')
    .delete().eq('group_id', groupId).eq('person_id', personId);
  if (error) throw error;
}

// 순을 옮긴다. 넣기가 먼저다 — 빼기만 되고 넣기가 막히면 그 사람이 어느 순에도 없게 된다.
export async function moveMember(fromGroupId, toGroupId, personId) {
  if (fromGroupId === toGroupId) return;
  await addMember(toGroupId, personId);
  await removeMember(fromGroupId, personId);
}

// ── 쓰기 · 모임(순·동아리) ─────────────────────────────────────────────────

// **리더를 정하면 그 모임의 구성원으로도 넣는다**(0037의 관례) — 출석 정책
// leads_sun_of()·same_sun()이 group_members를 보기 때문이다.
export async function createGroup({ type, name, year = null, leaderPersonId = null, note = null }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (!supabase) {
    const made = {
      id: generateId(), type, name: clean, year: type === 'sun' ? year : null,
      leader_person_id: leaderPersonId || null, note: note || null,
    };
    guestSet('groups', [...guestRows('groups'), made]);
    if (made.leader_person_id) await addMember(made.id, made.leader_person_id);
    return made;
  }
  const { data, error } = await supabase.from('groups').insert({
    type, name: clean, year: type === 'sun' ? year : null,
    leader_person_id: leaderPersonId || null, note: note || null,
  }).select(GROUP_COLS).single();
  if (error) throw error;
  if (data.leader_person_id) await addMember(data.id, data.leader_person_id);
  return data;
}

// 동아리 카드 순서 저장. ids는 **새 순서대로의 uuid 배열**이다.
// 행 update는 RLS상 리더·마스터만이라(0035) 일반 멤버의 순서 바꾸기가 막힌다 —
// 0038이 position만 만지는 definer 함수를 열어 두었고 여기서 그걸 부른다(0021과 같은 판단).
export async function reorderClubs(ids = []) {
  if (!ids.length) return;
  if (!supabase) {
    const at = new Map(ids.map((id, i) => [id, i + 1]));
    guestSet('groups', guestRows('groups').map(g => (at.has(g.id) ? { ...g, position: at.get(g.id) } : g)));
    return;
  }
  const { error } = await supabase.rpc('reorder_clubs', { ids });
  if (error) throw error;
}

// 동아리 이름·설명 고치기(0039 groups_update — 관리자 또는 그 동아리 리더).
// **새 함수가 아니라 saveGroup 한 벌을 쓴다** — 클라우드·게스트 두 길이 이미 그 안에
// 있다. 여기서 하는 일은 값을 다듬는 것뿐이다: 이름은 비울 수 없고(비우면 카드에
// 제목이 없는 동아리가 남는다), 설명은 비우면 null이다(빈 문자열이 남으면 카드와
// 상세에 빈 줄이 한 칸 선다).
export async function saveClubInfo(id, { name, note }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return saveGroup(id, { name: clean, note: String(note || '').trim() || null });
}

// **여기서 구성원을 손대지 않는다.** 예전에는 리더를 담은 patch가 오면 곧바로
// addMember를 불렀는데, 그 두 걸음 중 뒤가 유니크 위반으로 죽으면 '못 했어요'가 떴다
// (리더는 이미 바뀐 뒤였다 — 사용자 지적 2026-09-03). 지금은 부르는 쪽이 leaderPlan으로
// 먼저 판정하고, 넣어야 할 때만 넣는다(groupsView setLeader).
export async function saveGroup(id, patch) {
  if (!supabase) {
    const rows = guestRows('groups').map(g => (g.id === id ? { ...g, ...patch } : g));
    guestSet('groups', rows);
    return rows.find(g => g.id === id);
  }
  const { data, error } = await supabase.from('groups').update(patch).eq('id', id).select(GROUP_COLS).single();
  if (error) throw error;
  return data;
}

// ── 쓰기 · 동아리 가입 신청 ─────────────────────────────────────────────────
// 신청은 본인만(RLS: person_id = my_person_id) · 취소도 본인 · 수락·거절은 그 동아리
// 리더나 마스터다(0035). 수락은 명단에 넣는 일까지 한 벌로 본다.

export async function applyToClub(groupId, personId) {
  if (!supabase) {
    const made = { id: generateId(), group_id: groupId, person_id: personId, status: 'pending', created_at: new Date().toISOString() };
    guestSet('club_applications', [...guestRows('club_applications'), made]);
    return made;
  }
  const { data, error } = await supabase.from('club_applications')
    .insert({ group_id: groupId, person_id: personId }).select(APP_COLS).single();
  if (error) throw error;
  return data;
}

export async function cancelApplication(id) {
  if (!supabase) { guestSet('club_applications', guestRows('club_applications').filter(a => a.id !== id)); return; }
  const { error } = await supabase.from('club_applications').delete().eq('id', id);
  if (error) throw error;
}

async function decide(id, status) {
  if (!supabase) {
    guestSet('club_applications', guestRows('club_applications')
      .map(a => (a.id === id ? { ...a, status, decided_at: new Date().toISOString() } : a)));
    return;
  }
  const { error } = await supabase.from('club_applications')
    .update({ status, decided_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// 명단에 먼저 넣는다 — 수락 표시만 남고 명단에 없으면 신청한 사람이 갈 곳이 없다.
export async function acceptApplication(app) {
  await addMember(app.group_id, app.person_id);
  await decide(app.id, 'accepted');
}

export const declineApplication = (id) => decide(id, 'declined');

// ── 쓰기 · 모임 일정 · 출석 ─────────────────────────────────────────────────

export async function createMeeting(groupId, { date, title = '' }) {
  if (!date) return null;
  if (!supabase) {
    const made = { id: generateId(), group_id: groupId, meeting_date: date, title: String(title || '').trim() || null, attendance: [], note: null };
    guestSet('group_meetings', [...guestRows('group_meetings'), made]);
    return made;
  }
  const { data, error } = await supabase.from('group_meetings')
    .insert({ group_id: groupId, meeting_date: date, title: String(title || '').trim() || null })
    .select(MEETING_COLS).single();
  if (error) throw error;
  return data;
}

export async function saveMeetingAttendance(meetingId, ids) {
  if (!supabase) {
    guestSet('group_meetings', guestRows('group_meetings')
      .map(m => (m.id === meetingId ? { ...m, attendance: ids } : m)));
    return;
  }
  const { error } = await supabase.from('group_meetings').update({ attendance: ids }).eq('id', meetingId);
  if (error) throw error;
}
