import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Skeleton } from '../components/media.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText, objectParticle } from '../services/errorText.js';
import { useAuth } from '../services/auth.jsx';
import { useCached, dropCache } from '../services/cache.js';
import { MySunPanel, SunNotesSection, SunAdminPanel } from '../components/groupsSun.jsx';
import { ClubsPanel } from '../components/groupsClub.jsx';
import { WITH_ICON, useClosing, useSettled } from '../components/groupsParts.jsx';
import { SunGuidePanel } from '../components/sunGuide.jsx';
import { loadGuide } from '../services/sunGuide.js';
import { fetchServices, fetchAttendance } from '../services/worship.js';
import {
  fetchGroupPerms, fetchGroupsRoster, fetchApplications, fetchSunSharedNotes, fetchMeetings,
  createGroup, saveGroup, saveClubInfo, addMember, removeMember, moveMember, reorderClubs,
  applyToClub, cancelApplication, acceptApplication, declineApplication,
  createMeeting, saveMeetingAttendance, setNoteShared,
  groupPerms, mySun, latestSunday, toggleAttendance, yearOptions, leaderPlan, dupReason,
  duplicateName, dupNameText,
} from '../services/groups.js';

// ============================================================================
// v2 모임 화면 — 내 순 · 동아리 · 순 편성 (docs/V2.md §1 결정 1·2·3·7 · §2 · §3)
// ----------------------------------------------------------------------------
// **이 파일은 통신과 상태만 가진다.** 그리는 일은 components/groupsSun ·
// groupsClub이 props로 받아서 한다 — 그래야 검사가 가짜 순·동아리·신청으로
// 화면을 그대로 눌러 볼 수 있다(tests/groups.mjs).
//
// 자격 판정(groups.js fetchGroupPerms)은 0035·0039의 can_manage_sun()·groups_insert·
// groups_update·group_members_write를 옮긴 것이고 **버튼을 감추는 용도**다. 어긋나도
// DB가 이긴다. 마스터·관리자 여부는 로그인 계정 속성이라 useAuth가 준다 — App.jsx가
// props 없이 부르는 화면이지만 그 두 값은 컨텍스트에 있다(worshipView와 같은 길).
//
// 연도가 둘인 이유: '내 순'과 동아리는 언제나 **올해**를 본다(순은 해마다 다시 짜고,
// 내가 지금 속한 순은 올해 편성이다). 순 편성 구역만 연도를 골라 지난 편성을 손본다.
// 그래서 올해 한 벌(state)과 고른 해 한 벌(admin)을 따로 들고 있다.
//
// 쓰기 뒤에는 한 벌을 다시 읽는다 — 명단·순·동아리는 다 합쳐도 작고(53명·11개),
// 화면 곳곳의 인원 수·'참여 중' 표시가 한 번의 조작으로 같이 움직이기 때문이다.
// 예외는 둘, 손이 결과를 기다리면 굼떠 보이는 것들이다: 모임 출석 토글(한 명씩
// 누른다)과 동아리 카드 순서(끄는 도중 손 밑에서 카드가 돌아오면 안 된다).
//
// 폭은 대시보드 계열과 하나다(사용자 지시 2026-09-01) — 이 화면 어디에도 max-w가
// 없고, 내 순·동아리·순 편성이 views/views.jsx와 같은 `dc-screen pb-6` 폭에 선다.
// ============================================================================

const THIS_YEAR = new Date().getFullYear();

// 스켈레톤은 **캐시가 하나도 없는 첫 진입**에만 나온다(services/cache.js).
const LOADING = (
  <div className="groups-loading dc-screen pb-8 space-y-2">
    <Skeleton className="h-8 w-40 rounded-md mb-4" />
    <Skeleton className="h-[120px] w-full rounded-[10px]" />
    <Skeleton className="h-[86px] w-full rounded-[10px]" />
  </div>
);

// 내 순의 딸린 섹션(공유된 노트 + 순모임 가이드) 자리. **한 덩이다** — 둘이 저마다
// 스켈레톤을 들면 자리가 두 번 흔들린다(사용자 지적 2026-09-03). 종이는 한 장 몫만
// 잡는다: 세 장을 다 그리면 가이드가 없는 순장(대다수)에게 큰 빈 상자가 떴다가 접힌다.
const MINE_SKELETON = (
  <div className="mine-skeleton mt-6 space-y-3">
    <Skeleton className="h-4 w-40 rounded-md" />
    <Skeleton className="w-full h-[86px] rounded-[10px]" />
    <Skeleton className="w-full h-[120px] rounded-[20px]" />
  </div>
);

// 읽지 못했을 때의 한 벌 — 자격은 groupPerms() 기본값이다. 손으로 적은 한 벌을 두면
// 자격이 하나 늘 때마다 이 줄이 뒤처져서, 아무것도 못 하는 화면이 아니라 **되지 않을
// 버튼이 선 화면**이 된다.
const EMPTY_BUNDLE = { perms: groupPerms(), apps: [], people: [], suns: [], clubs: [], members: [], allGroups: [] };

export function GroupsView() {
  const { isMaster, isAdmin } = useAuth();
  const [year, setYear] = useState(THIS_YEAR);
  const [tab, setTab] = useState('mine');
  const [openClubId, setOpenClubId] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [clubOrder, setClubOrder] = useState(null);  // 끌어 놓은 직후의 순서(아래 주석)
  const [creating, setCreating] = useState(null);    // null | 'club' | 'sun' — 만들기 칸은 머리줄에서 연다
  // 만들기 칸은 닫힐 때 짧게 접힌다 — 그 150ms 동안 칸을 살려 둔다(groupsParts useClosing)
  const [closingCreate, closeCreate] = useClosing();
  const shutCreate = useCallback(() => closeCreate(() => setCreating(null)), [closeCreate]);

  // ── 읽기 ──────────────────────────────────────────────────────────────────
  // **캐시가 있으면 그것을 먼저 그린다**(사용자 요청 2026-09-03 — "매번 스켈레톤이
  // 아니라 캐시된 값이 먼저 보이게"). 홈과 같은 훅이다(services/cache.js) — 마지막에
  // 읽은 한 벌을 즉시 돌려주고 뒤에서 다시 읽어 갈아 끼운다. 스켈레톤은 캐시가 없는
  // 첫 진입에만 나온다. 실패는 **다시 던진다** — 빈 값을 캐시에 넣으면 다음 진입에서
  // 그 빈 화면이 먼저 그려진다.
  //
  // 캐시는 JSON을 거치므로 **한 벌에 함수를 담지 않는다** — 자격 판정은 바깥 함수다
  // (groups.js canEditClub·canManageClub). 예전에 perms가 메서드를 들고 있었다.
  const baseQ = useCached(`groups:all:${THIS_YEAR}`, async () => {
    try {
      const [perms, roster, apps] = await Promise.all([
        fetchGroupPerms(THIS_YEAR, { isMaster, isAdmin }),
        fetchGroupsRoster(THIS_YEAR),
        fetchApplications(),
      ]);
      return { perms, apps, ...roster };
    } catch (e) {
      console.error('[groups] 모임 목록 실패:', e);
      throw e;
    }
  }, [isMaster, isAdmin]);

  // 고른 해의 순 편성. **올해는 위의 한 벌이 이미 들고 있다** — 그때는 읽지 않는다
  // (loader가 null을 돌려주면 캐시에도 null이 남아 스켈레톤이 뜨지 않는다).
  const adminQ = useCached(`groups:roster:${year}`, async () => {
    if (year === THIS_YEAR) return null;
    try {
      return { year, ...await fetchGroupsRoster(year) };
    } catch (e) {
      console.error('[groups] 순 편성 연도 실패:', e);
      throw e;
    }
  }, [year]);

  const state = baseQ.data || (baseQ.error ? EMPTY_BUNDLE : null);
  const admin = adminQ.data || null;

  // 읽기 실패는 한 번만 말한다 — 캐시된 값이 있으면 화면은 그대로 서 있다.
  useEffect(() => {
    if (baseQ.error) showToast(failText('내 순과 동아리를 불러오지 못했어요', baseQ.error));
  }, [baseQ.error]);
  useEffect(() => {
    if (adminQ.error) showToast(failText('그 해 순 편성을 불러오지 못했어요', adminQ.error));
  }, [adminQ.error]);

  // 쓰기 뒤에는 **캐시를 비우고 다시 읽는다** — 비우지 않으면 저장 직후 옛 값이
  // 한 번 깜빡인다(cache.js 주석).
  const refresh = useCallback(async () => {
    dropCache('groups');
    await Promise.all([baseQ.refresh(), adminQ.refresh()]);
  }, [baseQ.refresh, adminQ.refresh]);

  // ── 내 순의 딸린 섹션은 **한 벌로 읽는다** (사용자 지적 2026-09-03) ──────
  // "공유된 예배 노트와 순모임 가이드가 각각 따로 스켈레톤이 된다." 키를 나눠 두면
  // 둘이 저마다 다른 프레임에 도착해서 자리가 두 번 흔들린다. 한 키에 Promise.all로
  // 묶으면 스켈레톤도 한 덩이고 한 번에 실제 내용으로 바뀐다.
  //
  // 기준 예배(가장 최근 발행 주일 예배)는 **명단 연결과 무관하게 읽는다** — 마스터·
  // 관리자 계정이 명단에 이어지지 않은 경우가 실제로 있고, 그때 가이드 자리까지
  // 사라지면 만들 길이 없다. 출석·노트는 '내 순 소식'이라 명단이 이어진 사람만.
  //
  // 가이드는 볼 자격이 있을 때만 묻는다(0039 sun_guides_select) — 자격이 없으면 어차피
  // 행이 오지 않는데 질의 한 번이 더 붙는다.
  const perms = state?.perms;
  const me = perms?.myPerson || null;
  const myPersonId = me?.id || null;
  const sun = useMemo(() => mySun(me, state?.suns || [], state?.members || []), [me, state]);
  const sunId = sun?.id || '';
  const leadsASun = useMemo(
    () => !!me && (state?.suns || []).some(g => g.leader_person_id === me.id),
    [me, state],
  );
  const guidePerms = useMemo(
    () => ({ canCreate: !!perms?.canManageSun, canView: leadsASun || !!perms?.canManageSun }),
    [perms, leadsASun],
  );
  const canViewGuide = guidePerms.canView;

  const mineKey = `groups:mine:${sunId || 'none'}:${myPersonId || 'anon'}`;
  const mineQ = useCached(mineKey, async () => {
    try {
      const service = latestSunday(await fetchServices()) || null;
      const [present, notes, guide] = await Promise.all([
        service && myPersonId ? fetchAttendance(service.id) : [],
        myPersonId ? fetchSunSharedNotes() : [],
        // 가이드는 곁가지다 — 못 읽어도 나머지는 서야 한다(패널이 다시 읽는다)
        service && canViewGuide ? loadGuide(service.id).catch(() => null) : null,
      ]);
      return { service, present, notes, guide };
    } catch (e) {
      console.error('[groups] 내 순 소식을 받지 못했어요:', e);
      throw e;
    }
  }, [sunId, myPersonId, canViewGuide]);
  // 한 프레임이라도 앞 키의 값으로 그리지 않는다(groupsParts useSettled 주석)
  const mineSettled = useSettled(mineKey, mineQ.loading);
  const service = mineQ.data?.service || null;
  // Set은 JSON으로 담기지 않는다 — 캐시에는 배열로 두고 여기서 Set으로 세운다
  const present = useMemo(() => new Set(mineQ.data?.present || []), [mineQ.data]);

  // 동아리 상세를 열 때 그 동아리의 모임을 읽는다. **캐시에 넣지 않는다** — 출석을
  // 누르면 그 자리에서 바뀌는 값이라(toggleMeeting) 캐시와 화면이 갈리기 쉽고,
  // 상세로 들어가는 한 번의 조작에 딸린 짧은 읽기다.
  useEffect(() => {
    if (!openClubId) { setMeetings([]); return undefined; }
    let alive = true;
    fetchMeetings(openClubId)
      .then(rows => { if (alive) setMeetings(rows); })
      .catch(e => console.error('[groups] 모임 일정 실패:', e));
    return () => { alive = false; };
  }, [openClubId]);

  // 내 노트의 공유를 그 줄에서 켜고 끈다(사용자 결정 2026-09-03). 노트 한 벌만
  // 다시 읽는다 — 순·동아리는 그대로다.
  const shareNote = useCallback(async (note, next) => {
    try {
      await setNoteShared(note.serviceId, next);
      dropCache('groups:mine');
      await mineQ.refresh();
      return true;
    } catch (e) {
      console.error('[groups] 노트 공유를 바꾸지 못했어요:', e);
      showToast(failText('노트 공유를 바꾸지 못했어요', e));
      return false;
    }
  }, [mineQ.refresh]);

  // 지금 순 편성 화면이 보고 있는 한 벌(올해면 state, 지난 해면 admin). 순장 지정
  // 판정이 이것을 보므로 **쓰기보다 위에** 둔다 — 아래에 두면 useCallback의 의존성이
  // 선언 전 변수를 읽어 TDZ로 죽는다.
  const adminData = year === THIS_YEAR ? state : (admin?.year === year ? admin : null);

  // ── 쓰기 ──────────────────────────────────────────────────────────────────
  // 한 벌로 감싼다 — 실패는 콘솔에 원문, 화면에는 무엇이 안 됐는지만(§8 · errorText).
  // dup은 **유니크 위반일 때만** 쓰는 한 줄이다(무엇이 이미 있는지는 부르는 쪽만
  // 안다 — groups.js dupReason). 사용자 지적 2026-09-03: "'이미 같은 것이 있어요'는
  // 무슨 말인지 모르겠다."
  const run = useCallback(async (what, fn, done, dup) => {
    try {
      await fn();
      await refresh();
      if (done) showToast(done);
      return true;
    } catch (e) {
      console.error(`[groups] ${what} 실패:`, e);
      showToast(failText(what, dupReason(e, dup)));
      return false;
    }
  }, [refresh]);

  // 저장하러 가기 전에 막힌 경우 — 서버에 물어볼 것도 없이 이유가 분명하다.
  // 문구 모양은 실패 토스트와 같다(errorText가 err.human을 가장 먼저 본다).
  const refuse = useCallback((what, why) => { showToast(failText(what, { human: why })); return false; }, []);

  const apply = useCallback((club) => run('가입 신청을 보내지 못했어요',
    () => applyToClub(club.id, me.id), '가입 신청을 보냈어요',
    `${club.name}에는 이미 신청해 두었어요`), [run, me]);

  const cancelApply = useCallback((app) => run('가입 신청을 취소하지 못했어요',
    () => cancelApplication(app.id), '가입 신청을 취소했어요'), [run]);

  const accept = useCallback((app) => {
    const name = state?.people.find(p => p.id === app.person_id)?.name || '';
    return run('가입 신청을 수락하지 못했어요', () => acceptApplication(app),
      name ? `${name}님을 동아리 명단에 넣었어요` : '동아리 명단에 넣었어요',
      name ? `${name}님은 이미 그 동아리 멤버예요` : '이미 그 동아리 멤버예요');
  }, [run, state]);

  const decline = useCallback((app) => run('가입 신청을 거절하지 못했어요',
    () => declineApplication(app.id), '가입 신청을 거절했어요'), [run]);

  const dropClubMember = useCallback((club, person) => run('동아리에서 내보내지 못했어요',
    () => removeMember(club.id, person.id), `${person.name}님을 동아리에서 내보냈어요`), [run]);

  const addClubMember = useCallback((club, personId) => {
    const name = state?.people.find(p => p.id === personId)?.name || '';
    return run('동아리 멤버로 넣지 못했어요', () => addMember(club.id, personId),
      name ? `${name}님을 ${club.name}에 넣었어요` : '멤버를 넣었어요',
      name ? `${name}님은 이미 ${club.name} 멤버예요` : `이미 ${club.name} 멤버예요`);
  }, [run, state]);

  // 순서는 먼저 화면에 반영한다 — 저장을 기다렸다 다시 읽으면 놓은 카드가 잠깐
  // 제자리로 돌아갔다 온다. 실패했을 때만 한 벌을 다시 읽어 되돌린다.
  // 한 벌은 이제 캐시가 들고 있어서(useCached) 직접 고쳐 넣을 수 없다 — **놓은 순서를
  // 따로 들고 있다가 그릴 때 얹는다.** 저장이 성공하면 다음에 읽어 온 한 벌도 같은
  // 순서라 이 값은 그대로 맞고, 실패하면 비우고 다시 읽어 되돌린다.
  const reorderClubList = useCallback(async (ids) => {
    setClubOrder(ids);
    try {
      await reorderClubs(ids);
    } catch (e) {
      console.error('[groups] 동아리 순서 저장 실패:', e);
      showToast(failText('동아리 순서를 저장하지 못했어요', e));
      setClubOrder(null);
      await refresh();
    }
  }, [refresh]);

  // 같은 이름은 0041이 DB에서 막는다 — 화면은 저장하러 가기 전에 같은 말을 한다.
  const newClub = useCallback(({ name, note, leaderPersonId }) => {
    const taken = duplicateName({ groups: state?.allGroups || [], type: 'club', name });
    if (taken) return refuse('동아리를 만들지 못했어요', taken);
    return run('동아리를 만들지 못했어요',
      () => createGroup({ type: 'club', name, note, leaderPersonId }),
      `${name}${objectParticle(name)} 만들었어요`, dupNameText('club'));
  }, [run, refuse, state]);

  // 동아리 이름·설명 고치기 — 마스터·관리자 또는 그 동아리장(0039 groups_update).
  // 순 이름 바꾸기와 같은 결의 조작이라 문구도 같은 결로 둔다.
  const editClub = useCallback((club, { name, note }) => {
    const taken = duplicateName({ groups: state?.allGroups || [], type: 'club', name, exceptId: club.id });
    if (taken) return refuse('동아리 정보를 바꾸지 못했어요', taken);
    return run('동아리 정보를 바꾸지 못했어요',
      () => saveClubInfo(club.id, { name, note }), '동아리 정보를 바꿨어요', dupNameText('club'));
  }, [run, refuse, state]);

  const newMeeting = useCallback(async (club, { date, title }) => {
    try {
      await createMeeting(club.id, { date, title });
      setMeetings(await fetchMeetings(club.id));
      showToast('모임을 만들었어요');
      return true;
    } catch (e) {
      console.error('[groups] 모임을 만들지 못했어요:', e);
      showToast(failText('모임을 만들지 못했어요', e));
      return false;
    }
  }, []);

  // 출석은 먼저 화면에 반영하고 실패하면 되돌린다(예배 출석과 같은 방식).
  const toggleMeeting = useCallback(async (meeting, personId) => {
    const before = Array.isArray(meeting.attendance) ? meeting.attendance : [];
    const next = toggleAttendance(before, personId);
    setMeetings(rows => rows.map(m => (m.id === meeting.id ? { ...m, attendance: next } : m)));
    try {
      await saveMeetingAttendance(meeting.id, next);
    } catch (e) {
      console.error('[groups] 모임 출석 변경 실패:', e);
      setMeetings(rows => rows.map(m => (m.id === meeting.id ? { ...m, attendance: before } : m)));
      showToast(failText('모임 출석을 바꾸지 못했어요', e));
    }
  }, []);

  // 새 순의 순장도 같은 판정을 거친다(사용자 지시 2026-09-03). 피커가 이미 '어느 순에도
  // 없는 사람'만 올리므로 화면에서는 걸릴 일이 없고, 목록이 낡았을 때의 마지막 방어선이다.
  // 아직 없는 순이라 id가 없는 껍데기를 넘긴다 — 어느 구성원 줄과도 맞지 않는다.
  const newSun = useCallback(({ name, leaderPersonId }) => {
    const plan = leaderPlan({
      group: { id: null, name, leader_person_id: null }, personId: leaderPersonId,
      people: adminData?.people || [], suns: adminData?.suns || [], members: adminData?.members || [],
    });
    if (!plan.ok) return refuse('순을 만들지 못했어요', plan.why);
    // 순은 **같은 해 안에서만** 유일하다(0041) — 지난 해에 같은 이름이 있어도 만든다
    const taken = duplicateName({ groups: state?.allGroups || [], type: 'sun', name, year });
    if (taken) return refuse('순을 만들지 못했어요', taken);
    return run('순을 만들지 못했어요',
      () => createGroup({ type: 'sun', name, year, leaderPersonId }),
      `${name}${objectParticle(name)} 만들었어요`, dupNameText('sun', year));
  }, [run, refuse, year, adminData, state]);

  const renameSun = useCallback((group, name) => {
    const taken = duplicateName({
      groups: state?.allGroups || [], type: 'sun', name, year: group.year, exceptId: group.id,
    });
    if (taken) return refuse('순 이름을 바꾸지 못했어요', taken);
    return run('순 이름을 바꾸지 못했어요',
      () => saveGroup(group.id, { name }), '순 이름을 바꿨어요', dupNameText('sun', group.year));
  }, [run, refuse, state]);

  // 순장 지정 — **저장하러 가기 전에 네 갈래를 판정한다**(groups.js leaderPlan · 사용자
  // 지시 2026-09-03). 이미 다른 순의 순장이거나 다른 순의 순원이면 세우지 않고 이유를
  // 말하고, 이 순의 순원이면 그대로 세우고(구성원 추가를 건너뛴다), 아무 순에도 없으면
  // 세운 뒤 이 순 구성원에 넣는다. 출석 정책(leads_sun_of)이 구성원을 보기 때문에
  // '리더인데 구성원이 아닌' 상태를 남기지 않는다(0037).
  const setLeader = useCallback((group, personId) => {
    const plan = leaderPlan({
      group, personId, people: adminData?.people || [],
      suns: adminData?.suns || [], members: adminData?.members || [],
    });
    if (!plan.ok) return refuse('순장을 지정하지 못했어요', plan.why);
    if (plan.same) return true;
    return run('순장을 지정하지 못했어요', async () => {
      await saveGroup(group.id, { leader_person_id: personId || null });
      if (plan.addMember) await addMember(group.id, personId);
    }, plan.name ? `${plan.name}님을 ${group.name} 순장으로 지정했어요` : '순장을 비웠어요');
  }, [run, refuse, adminData]);

  const addSunMember = useCallback((group, personId) => {
    const name = state?.people.find(p => p.id === personId)?.name || '';
    return run('순원을 넣지 못했어요', () => addMember(group.id, personId),
      name ? `${name}님을 ${group.name}에 넣었어요` : '순원을 넣었어요',
      name ? `${name}님은 이미 ${group.name} 순원이에요` : '이미 그 순의 순원이에요');
  }, [run, state]);

  const moveSunMember = useCallback((group, toGroupId, person) => run('순을 옮기지 못했어요',
    () => moveMember(group.id, toGroupId, person.id), `${person.name}님의 순을 옮겼어요`,
    `${person.name}님은 이미 그 순의 순원이에요`), [run]);

  const dropSunMember = useCallback((group, person) => run('순원을 빼지 못했어요',
    () => removeMember(group.id, person.id), `${person.name}님을 순에서 뺐어요`), [run]);

  // ── 그리기 ────────────────────────────────────────────────────────────────
  const years = useMemo(() => yearOptions(state?.allGroups || []), [state]);
  // 끌어 놓은 순서가 있으면 그것으로 세운다(위 reorderClubList 주석)
  const clubs = useMemo(() => {
    const list = state?.clubs || [];
    if (!clubOrder) return list;
    const at = new Map(clubOrder.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  }, [state, clubOrder]);
  const openClub = useMemo(
    () => clubs.find(c => c.id === openClubId) || null,
    [clubs, openClubId],
  );

  const tabs = useMemo(() => {
    const list = [['mine', '내 순'], ['club', '동아리']];
    if (perms?.canManageSun) list.push(['sun', '순 편성']);
    return list;
  }, [perms]);

  if (!state) return LOADING;
  const active = tabs.some(([k]) => k === tab) ? tab : 'mine';

  return (
    <div className="groups-screen dc-screen pb-6">
      {/* 탭 줄도 아래 카드와 같은 폭 안에 선다 — 왼쪽 끝에 두면 내용과 세로선이 어긋난다.
          '새 …'는 이 줄의 오른쪽에 둔다: 따로 한 줄을 차지하면 버튼만 떠 있게 보인다. */}
      <div className="flex items-center gap-2 pb-3.5">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {tabs.map(([key, label]) => (
            <button key={key} type="button"
              onClick={() => { setTab(key); setCreating(null); }} aria-pressed={active === key}
              className="groups-tab px-3.5 py-[6px] rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: active === key ? 'var(--app-surface)' : 'transparent',
                color: active === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{label}</button>
          ))}
        </span>
        <span className="flex-1" />
        {/* 아이콘과 글자 사이는 gap 하나로만 벌린다 — 글자를 span으로 감싸지 않으면
            JSX의 앞 공백이 그대로 남아 버튼마다 사이가 달라진다(groupsParts WITH_ICON) */}
        {active === 'club' && !openClub && perms.canCreateClub && !creating && (
          <button type="button" onClick={() => setCreating('club')}
            className={`club-new-open ${WITH_ICON} px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95`}>
            <Plus size={13} /><span>새 동아리</span>
          </button>
        )}
        {active === 'sun' && !creating && (
          <button type="button" onClick={() => setCreating('sun')}
            className={`sun-new-open ${WITH_ICON} px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95`}>
            <Plus size={13} /><span>새 순</span>
          </button>
        )}
      </div>

      {/* 가이드는 **순 카드 밑**이다(사용자 지시 2026-09-03 — 처음에는 위에 두었다).
          이 탭의 주인은 내 순이고, 가이드는 그 순으로 무엇을 할지에 대한 딸린 섹션이다.
          위에 두면 탭을 열자마자 AI 종이 세 장이 화면을 채우고 순 명단이 접혀 내려갔다.
          기준 예배는 '가장 최근 발행 주일 예배' 한 건으로, 출석 줄이 쓰는 것과 같다. */}
      {active === 'mine' && (
        <>
          <MySunPanel myPerson={me} sun={sun} people={state.people} members={state.members}
            service={service} present={present} />
          {/* 노트와 가이드는 **한 덩이로** 뜬다(한 키·한 스켈레톤 — 위 주석). 순 카드
              밑이다: 이 탭의 주인은 내 순이고 가이드는 그 순으로 무엇을 할지다. 위에
              두면 탭을 열자마자 AI 종이 세 장이 화면을 채우고 명단이 접혀 내려갔다. */}
          {mineSettled ? (
            <>
              {!!sun && <SunNotesSection notes={mineQ.data?.notes || []} onShare={shareNote} />}
              {/* 가이드는 위 mineQ가 이미 읽어 왔다 — 패널이 다시 읽지 않게 넘긴다(undefined면 스스로 읽음).
                  저장하면 캐시를 비우고 한 벌을 다시 읽어 다음 진입에도 새 값이 먼저 선다. */}
              <SunGuidePanel service={service} perms={guidePerms}
                initialGuide={mineQ.data ? (mineQ.data.guide ?? null) : undefined}
                loading={mineQ.loading}
                onSaved={() => { dropCache('groups:mine'); mineQ.refresh(); }} />
            </>
          ) : MINE_SKELETON}
        </>
      )}

      {active === 'club' && (
        <ClubsPanel clubs={clubs} people={state.people} members={state.members} apps={state.apps}
          perms={perms} openClub={openClub} meetings={meetings}
          creating={creating === 'club'} closingCreate={closingCreate} onCloseCreate={shutCreate}
          onOpen={g => setOpenClubId(g.id)} onBack={() => setOpenClubId(null)}
          onCreateClub={newClub} onEditClub={editClub} onApply={apply} onCancelApply={cancelApply}
          onAccept={accept} onDecline={decline}
          onAddMember={addClubMember} onRemoveMember={dropClubMember} onReorder={reorderClubList}
          onCreateMeeting={newMeeting} onToggleMeeting={toggleMeeting} />
      )}

      {active === 'sun' && (adminData
        ? (
          <SunAdminPanel year={year} years={years} suns={adminData.suns} people={adminData.people}
            members={adminData.members} onYear={setYear}
            creating={creating === 'sun'} closingCreate={closingCreate} onCloseCreate={shutCreate}
            onCreateSun={newSun} onRenameSun={renameSun} onSetLeader={setLeader}
            onAddMember={addSunMember} onMoveMember={moveSunMember} onRemoveMember={dropSunMember} />
        )
        : LOADING)}
    </div>
  );
}
