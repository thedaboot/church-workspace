import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Skeleton } from '../components/media.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { useAuth } from '../services/auth.jsx';
import { MySunPanel, SunAdminPanel } from '../components/groupsSun.jsx';
import { ClubsPanel } from '../components/groupsClub.jsx';
import { WITH_ICON } from '../components/groupsParts.jsx';
import { fetchServices, fetchAttendance } from '../services/worship.js';
import {
  fetchGroupPerms, fetchGroupsRoster, fetchApplications, fetchSunSharedNotes, fetchMeetings,
  createGroup, saveGroup, addMember, removeMember, moveMember, reorderClubs,
  applyToClub, cancelApplication, acceptApplication, declineApplication,
  createMeeting, saveMeetingAttendance,
  mySun, latestSunday, toggleAttendance, yearOptions,
} from '../services/groups.js';

// ============================================================================
// v2 모임 화면 — 내 순 · 동아리 · 순 편성 (docs/V2.md §1 결정 1·2·3·7 · §2 · §3)
// ----------------------------------------------------------------------------
// **이 파일은 통신과 상태만 가진다.** 그리는 일은 components/groupsSun ·
// groupsClub이 props로 받아서 한다 — 그래야 검사가 가짜 순·동아리·신청으로
// 화면을 그대로 눌러 볼 수 있다(tests/groups.mjs).
//
// 자격 판정(groups.js fetchGroupPerms)은 0035의 can_manage_sun()·groups_insert·
// group_members_write를 옮긴 것이고 **버튼을 감추는 용도**다. 어긋나도 DB가 이긴다.
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

const LOADING = (
  <div className="dc-screen pb-8 space-y-2">
    <Skeleton className="h-8 w-40 rounded-md mb-4" />
    <Skeleton className="h-[120px] w-full rounded-[10px]" />
    <Skeleton className="h-[86px] w-full rounded-[10px]" />
  </div>
);

export function GroupsView() {
  const { isMaster } = useAuth();
  const [state, setState] = useState(null);          // 올해 한 벌 + 자격 + 대기 신청
  const [admin, setAdmin] = useState(null);          // { year, people, suns, members } — 순 편성
  const [year, setYear] = useState(THIS_YEAR);
  const [tab, setTab] = useState('mine');
  const [extra, setExtra] = useState({ notes: [], service: null, present: new Set() });
  const [openClubId, setOpenClubId] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [creating, setCreating] = useState(null);    // null | 'club' | 'sun' — 만들기 칸은 머리줄에서 연다

  // ── 읽기 ──────────────────────────────────────────────────────────────────
  const loadBase = useCallback(async () => {
    const [perms, roster, apps] = await Promise.all([
      fetchGroupPerms(THIS_YEAR, { isMaster }),
      fetchGroupsRoster(THIS_YEAR),
      fetchApplications(),
    ]);
    setState({ perms, apps, ...roster });
  }, [isMaster]);

  useEffect(() => {
    loadBase().catch(e => {
      console.error('[groups] 모임 목록 실패:', e);
      showToast(failText('모임을 받지 못했어요', e));
      setState({ perms: { myPerson: null, isMaster: false, canManageSun: false, canCreateClub: false, ledClubIds: [] },
        apps: [], people: [], suns: [], clubs: [], members: [], allGroups: [] });
    });
  }, [loadBase]);

  // 고른 해의 순 편성. 올해면 이미 읽어 둔 한 벌을 그대로 쓴다.
  const loadAdmin = useCallback(async (y) => {
    if (y === THIS_YEAR) { setAdmin(null); return; }
    try {
      const r = await fetchGroupsRoster(y);
      setAdmin({ year: y, ...r });
    } catch (e) {
      console.error('[groups] 순 편성 연도 실패:', e);
      showToast(failText('그 해의 순 편성을 받지 못했어요', e));
    }
  }, []);
  useEffect(() => { loadAdmin(year); }, [year, loadAdmin]);

  const refresh = useCallback(async () => {
    await loadBase();
    if (year !== THIS_YEAR) await loadAdmin(year);
  }, [loadBase, loadAdmin, year]);

  // 내 순 소식 — 최근 주일 예배 출석 · 내 순에 공유된 노트. 명단에 이어진 사람만.
  const myPersonId = state?.perms?.myPerson?.id || null;
  useEffect(() => {
    if (!myPersonId) return undefined;
    let alive = true;
    (async () => {
      const [notes, services] = await Promise.all([fetchSunSharedNotes(), fetchServices()]);
      const service = latestSunday(services);
      const present = service ? new Set(await fetchAttendance(service.id)) : new Set();
      if (alive) setExtra({ notes, service, present });
    })().catch(e => console.error('[groups] 내 순 소식 실패:', e));
    return () => { alive = false; };
  }, [myPersonId]);

  useEffect(() => {
    if (!openClubId) { setMeetings([]); return undefined; }
    let alive = true;
    fetchMeetings(openClubId)
      .then(rows => { if (alive) setMeetings(rows); })
      .catch(e => console.error('[groups] 모임 일정 실패:', e));
    return () => { alive = false; };
  }, [openClubId]);

  // ── 쓰기 ──────────────────────────────────────────────────────────────────
  // 한 벌로 감싼다 — 실패는 콘솔에 원문, 화면에는 무엇이 안 됐는지만(§8 · errorText).
  const run = useCallback(async (what, fn, done) => {
    try {
      await fn();
      await refresh();
      if (done) showToast(done);
      return true;
    } catch (e) {
      console.error(`[groups] ${what} 실패:`, e);
      showToast(failText(what, e));
      return false;
    }
  }, [refresh]);

  const perms = state?.perms;
  const me = perms?.myPerson || null;

  const apply = useCallback((club) => run('가입 신청을 보내지 못했어요',
    () => applyToClub(club.id, me.id), '가입 신청을 보냈어요'), [run, me]);

  const cancelApply = useCallback((app) => run('가입 신청을 취소하지 못했어요',
    () => cancelApplication(app.id), '가입 신청을 취소했어요'), [run]);

  const accept = useCallback((app) => {
    const name = state?.people.find(p => p.id === app.person_id)?.name || '';
    return run('가입 신청을 수락하지 못했어요', () => acceptApplication(app),
      name ? `${name}님을 동아리 명단에 넣었어요` : '동아리 명단에 넣었어요');
  }, [run, state]);

  const decline = useCallback((app) => run('가입 신청을 거절하지 못했어요',
    () => declineApplication(app.id), '가입 신청을 거절했어요'), [run]);

  const dropClubMember = useCallback((club, person) => run('동아리에서 내보내지 못했어요',
    () => removeMember(club.id, person.id), `${person.name}님을 동아리에서 내보냈어요`), [run]);

  const addClubMember = useCallback((club, personId) => {
    const name = state?.people.find(p => p.id === personId)?.name || '';
    return run('멤버를 넣지 못했어요', () => addMember(club.id, personId),
      name ? `${name}님을 ${club.name}에 넣었어요` : '멤버를 넣었어요');
  }, [run, state]);

  // 순서는 먼저 화면에 반영한다 — 저장을 기다렸다 다시 읽으면 놓은 카드가 잠깐
  // 제자리로 돌아갔다 온다. 실패했을 때만 한 벌을 다시 읽어 되돌린다.
  const reorderClubList = useCallback(async (ids) => {
    const at = new Map(ids.map((id, i) => [id, i]));
    setState(s => (s ? { ...s, clubs: [...s.clubs].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)) } : s));
    try {
      await reorderClubs(ids);
    } catch (e) {
      console.error('[groups] 동아리 순서 저장 실패:', e);
      showToast(failText('동아리 순서를 저장하지 못했어요', e));
      await refresh();
    }
  }, [refresh]);

  const newClub = useCallback(({ name, note, leaderPersonId }) => run('동아리를 만들지 못했어요',
    () => createGroup({ type: 'club', name, note, leaderPersonId }), '새 동아리를 만들었어요'), [run]);

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

  const newSun = useCallback(({ name, leaderPersonId }) => run('순을 만들지 못했어요',
    () => createGroup({ type: 'sun', name, year, leaderPersonId }), '새 순을 만들었어요'), [run, year]);

  const renameSun = useCallback((group, name) => run('순 이름을 바꾸지 못했어요',
    () => saveGroup(group.id, { name }), '순 이름을 바꿨어요'), [run]);

  // 순장을 정하면 그 순의 구성원으로도 들어간다(saveGroup) — 출석 정책이 구성원을 본다.
  const setLeader = useCallback((group, personId) => {
    const name = state?.people.find(p => p.id === personId)?.name || '';
    return run('순장을 정하지 못했어요',
      () => saveGroup(group.id, { leader_person_id: personId || null }),
      name ? `${name}님을 순장으로 정했어요` : '순장을 비웠어요');
  }, [run, state]);

  const addSunMember = useCallback((group, personId) => {
    const name = state?.people.find(p => p.id === personId)?.name || '';
    return run('순원을 넣지 못했어요', () => addMember(group.id, personId),
      name ? `${name}님을 ${group.name}에 넣었어요` : '순원을 넣었어요');
  }, [run, state]);

  const moveSunMember = useCallback((group, toGroupId, person) => run('순을 옮기지 못했어요',
    () => moveMember(group.id, toGroupId, person.id), `${person.name}님의 순을 옮겼어요`), [run]);

  const dropSunMember = useCallback((group, person) => run('순원을 빼지 못했어요',
    () => removeMember(group.id, person.id), `${person.name}님을 순에서 뺐어요`), [run]);

  // ── 그리기 ────────────────────────────────────────────────────────────────
  const adminData = year === THIS_YEAR ? state : (admin?.year === year ? admin : null);
  const years = useMemo(() => yearOptions(state?.allGroups || []), [state]);
  const sun = useMemo(() => mySun(me, state?.suns || [], state?.members || []), [me, state]);
  const openClub = useMemo(
    () => (state?.clubs || []).find(c => c.id === openClubId) || null,
    [state, openClubId],
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

      {active === 'mine' && (
        <MySunPanel myPerson={me} sun={sun} people={state.people} members={state.members}
          service={extra.service} present={extra.present} notes={extra.notes} />
      )}

      {active === 'club' && (
        <ClubsPanel clubs={state.clubs} people={state.people} members={state.members} apps={state.apps}
          perms={perms} openClub={openClub} meetings={meetings}
          creating={creating === 'club'} onCloseCreate={() => setCreating(null)}
          onOpen={g => setOpenClubId(g.id)} onBack={() => setOpenClubId(null)}
          onCreateClub={newClub} onApply={apply} onCancelApply={cancelApply}
          onAccept={accept} onDecline={decline}
          onAddMember={addClubMember} onRemoveMember={dropClubMember} onReorder={reorderClubList}
          onCreateMeeting={newMeeting} onToggleMeeting={toggleMeeting} />
      )}

      {active === 'sun' && (adminData
        ? (
          <SunAdminPanel year={year} years={years} suns={adminData.suns} people={adminData.people}
            members={adminData.members} onYear={setYear}
            creating={creating === 'sun'} onCloseCreate={() => setCreating(null)}
            onCreateSun={newSun} onRenameSun={renameSun} onSetLeader={setLeader}
            onAddMember={addSunMember} onMoveMember={moveSunMember} onRemoveMember={dropSunMember} />
        )
        : LOADING)}
    </div>
  );
}
