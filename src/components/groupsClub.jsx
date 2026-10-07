import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import { dropCollision } from './dropCollision.js';
import { CARD, CARD_STYLE, BTN, BTN_QUIET, FIELD, EXIT, PersonPick, LabeledField, Empty, PeopleMark } from './groupsParts.jsx';
import { ClubDetail } from './clubDetail.jsx';
import { groupPeople, myGroupIds, meetingDateShort } from '../services/groups.js';
import { reorderIds, imeComposing } from '../utils.js';

// ============================================================================
// 동아리 — 목록(끌어서 순서 조정) · 상세는 clubDetail.jsx(구성원 · 멤버 추가 · 가입 신청 · 모임과 출석)
// ----------------------------------------------------------------------------
// 그리는 일만 한다. 통신은 views/groupsView.jsx가 한다.
//
// 권한(docs/V2.md 권한 표 · 0035·0039·0045 RLS):
//   · 동아리 개설·동아리장 지정 = **마스터만**         → '새 동아리'는 마스터에게만
//   · 명단·모임 = 관리자 또는 그 동아리장              → 리더 도구가 그때만 선다
//   · 이름·설명 고치기 = 관리자 또는 그 동아리장       → 머리줄의 연필이 그때만 선다
//   · 신청 수락·거절 = **마스터** 또는 그 동아리장     → 그 구역만 따로 잰다(manageApps)
//   · 가입 신청·취소 = 본인                            → 명단에 이어진 계정만
// 화면은 이 경계를 비추기만 한다. 어긋나면 DB가 이긴다.
// **명단과 신청 수락은 자격이 다르다**(0045 group_members_write vs 0035
// club_applications_update) — 관리자는 사람을 넣고 뺄 수 있지만 신청 수락은 마스터·
// 동아리장의 일이다. 이름·설명은 0039부터 관리자까지 열려 있다.
//
// **카드 순서만 예외로 누구나 바꾼다** — 프로젝트 탭·칸반과 같은 '공유 순서'라서,
// 0038이 position만 만지는 definer 함수를 승인 멤버 전체에게 열어 두었다.
//
// 폭은 대시보드 계열 하나다 — 여기서 max-w로 다시 좁히지 않는다(groupsSun.jsx 머리말).
// ============================================================================

// 놓을 곳은 "손가락/커서가 있는 곳" 기준(보드와 같은 판단 — §6-11 · dropCollision.js 한 벌).

// 목록 ↔ 상세는 **교회 화면 사이 이동과 같은 결로** 미끄러진다(사용자 요청 2026-09-08 —
// "동아리 상세 들어갈 때에도 애니메이션 추가되도록").
//
// 상세에 `dc-screen`이 있는데도 아무 움직임이 없어 보인 이유: 이 화면을 감싼 App의
// 껍데기가 `dc-nav dc-nav-fwd`를 **계속 달고 있다**(App.jsx navRef는 activeMenu가 바뀔
// 때만 값을 간다). index.css의 `.dc-nav .dc-screen`이 그 안의 모든 `dc-screen`을
// **페이드만** 남기도록 키프레임을 갈아 끼우므로(가로로 미끄러지며 위로도 올라오면
// 대각선이 된다), 모임 화면 안에서 새로 마운트되는 상세도 4px 떠오름을 잃고 밝아지기만 했다.
// 그래서 겉 한 겹을 여기서 만든다 — App이 화면 사이에 하는 것과 **같은 짜임**이다
// (겉은 7px 가로 이동, 속 `dc-screen`은 페이드. 투명도는 한 겹에서만 — index.css 주석).
const NAV_IN = 'dc-nav dc-nav-fwd';
const NAV_BACK = 'dc-nav dc-nav-back';

export function ClubsPanel({
  clubs, people, members, apps, perms, openClub, meetings, meetingsFail = null, nextMeet = {}, creating, closingCreate, onCloseCreate,
  onOpen, onBack, onCreateClub, onEditClub, onApply, onCancelApply, onAccept, onDecline,
  onAddMember, onRemoveMember, onReorder, onCreateMeeting, onToggleMeeting, onDeleteMeeting,
}) {
  // 목록 → 상세는 앞으로, 상세 → 목록은 뒤로 미끄러진다(위 NAV_IN 주석).
  // **렌더 중에 정하지만 값이 바뀔 때만 간다** — App.jsx navRef와 같은 짜임이라
  // StrictMode의 두 번째 렌더에서도 같은 답이 나온다. 탭을 처음 열 때는 방향이 없다
  // (안에서 이동한 것이 아니라 화면이 선 것이다).
  const openId = openClub?.id || null;
  const navRef = useRef({ id: openId, cls: '' });
  if (navRef.current.id !== openId) navRef.current = { id: openId, cls: openId ? NAV_IN : NAV_BACK };

  // key가 바뀌어야 CSS 애니메이션이 처음부터 다시 돈다 — 같은 자리에 다른 내용을
  // 끼우면 브라우저는 이미 끝난 애니메이션을 다시 틀지 않는다(App.jsx의 key={activeMenu}).
  return (
    <div key={openId ? `club:${openId}` : 'clubs'} className={navRef.current.cls}>
      {openClub ? (
        <ClubDetail club={openClub} people={people} members={members} apps={apps} perms={perms}
          meetings={meetings} meetingsFail={meetingsFail} onBack={onBack} onApply={onApply} onCancelApply={onCancelApply}
          onAccept={onAccept} onDecline={onDecline} onAddMember={onAddMember} onRemoveMember={onRemoveMember}
          onEditClub={onEditClub} onCreateMeeting={onCreateMeeting} onToggleMeeting={onToggleMeeting}
          onDeleteMeeting={onDeleteMeeting} />
      ) : (
        <ClubList clubs={clubs} people={people} members={members} apps={apps} perms={perms} nextMeet={nextMeet}
          creating={creating} closingCreate={closingCreate} onCloseCreate={onCloseCreate} onOpen={onOpen}
          onCreateClub={onCreateClub} onReorder={onReorder} />
      )}
    </div>
  );
}

// ── 상세(구성원 · 멤버 추가 · 가입 신청 · 모임과 출석)는 clubDetail.jsx다 ──

// ── 목록 ────────────────────────────────────────────────────────────────────
function ClubList({ clubs, people, members, apps, perms, nextMeet = {}, creating, closingCreate, onCloseCreate, onOpen, onCreateClub, onReorder }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [dragId, setDragId] = useState(null);

  const mine = useMemo(() => new Set(myGroupIds(perms.myPerson, clubs, members)),
    [perms.myPerson, clubs, members]);
  const myPending = useMemo(() => new Set(
    apps.filter(a => a.person_id === perms.myPerson?.id).map(a => a.group_id)),
  [apps, perms.myPerson]);

  const submit = async () => {
    const ok = await onCreateClub({ name: name.trim(), note: note.trim(), leaderPersonId: leaderId || null });
    if (ok) { onCloseCreate(); setName(''); setNote(''); setLeaderId(''); }
  };
  // 이름·설명 두 칸이 같은 Enter다 — 이름이 있으면 바로 만든다(한글 조합 중 Enter는 확정이 아니다)
  const submitOnEnter = (e) => { if (imeComposing(e)) return; if (e.key === 'Enter' && name.trim()) submit(); };

  // 터치와 마우스는 센서를 나눈다(§6-12). 터치 200ms는 보드와 같다 — 이 줄의
  // 기본 동작이 세로 스크롤이라 길게 누르기 전에는 스크롤이 그대로 산다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragEnd = (e) => {
    setDragId(null);
    if (!e.over) return;
    // 끼워 넣는 규칙은 프로젝트 탭·보드와 한 벌이다(utils.reorderIds — §6-12-a를
    // 그 안에서 처리한다). 아래로 끌 때 제자리로 돌아오는 함정이 여기 있다.
    const next = reorderIds(clubs.map(g => g.id), String(e.active.id), String(e.over.id));
    if (next) onReorder?.(next);
  };

  const dragged = dragId ? clubs.find(g => g.id === dragId) : null;

  return (
    <div className="club-list dc-screen pb-8">
      {/* 만들기 카드 — 채울 것이 셋(이름·동아리장·설명)이라 한 줄에 담기지 않는다.
          그래서 **줄을 쌓는 대신 짜임을 준다**(사용자 지적 2026-09-03 "+ 새 동아리가
          별로 좋지 않다"): 프로젝트 만들기 창처럼 칸마다 라벨을 얹고, 꼭 채워야 하는
          둘을 한 행에 나란히, 선택인 설명을 그 아래 한 행에 둔다. 이름에 포커스가
          있고 Enter로 바로 만들어진다. 375px에서는 두 칸이 위아래로 접혀 세 줄이다. */}
      {creating && (
        <div className={`club-new ${closingCreate ? EXIT : 'dc-card'} relative z-20 p-3.5 mb-4 ${CARD}`} style={CARD_STYLE}>
          {/* 칸의 폭을 묶는다 — 1440px 카드에 칸을 그대로 늘리면 이름 한 줄을 적는
              자리가 690px이 되어 '빈 칸'처럼 보인다. 카드 자체는 아래 목록과 같은
              폭에 그대로 서고(왼쪽 선이 맞는다), 칸만 사람이 쓸 만한 너비다. */}
          <div className="grid gap-2.5 sm:grid-cols-2 sm:max-w-[46rem]">
            <LabeledField label="동아리 이름" className="club-new-name">
              <input value={name} onChange={e => setName(e.target.value)} aria-label="동아리 이름"
                placeholder="예: 통통" autoFocus
                onKeyDown={submitOnEnter}
                className={`${FIELD} w-full`} />
            </LabeledField>
            <LabeledField label="동아리장" className="club-new-leader">
              <PersonPick label="동아리장" people={people} value={leaderId} onChange={setLeaderId}
                placeholder="명단에서 고르기" allowClear className="w-full" />
            </LabeledField>
          </div>
          <LabeledField label="설명 (선택)" className="club-new-note mt-2.5 sm:max-w-[46rem]">
            <input value={note} onChange={e => setNote(e.target.value)} aria-label="동아리 설명"
              placeholder="예: 통기타 동아리"
              onKeyDown={submitOnEnter}
              className={`${FIELD} w-full`} />
          </LabeledField>
          {/* 확정 왼쪽 / 나가기 오른쪽(§8) — 이 화면의 다른 도구 줄과 같은 자리다 */}
          <div className="flex items-center gap-1.5 mt-3.5">
            <button type="button" onClick={submit} disabled={!name.trim()}
              className={`club-new-make ${BTN}`}>만들기</button>
            <span className="flex-1" />
            <button type="button" onClick={onCloseCreate} className={BTN_QUIET}>취소</button>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors} collisionDetection={dropCollision}
        // 가로 자동 스크롤만 끈다(§6-10) — 세로는 카드가 많을 때 필요하다.
        autoScroll={{ threshold: { x: 0, y: 0.2 } }}
        onDragStart={e => setDragId(String(e.active.id))}
        onDragCancel={() => setDragId(null)} onDragEnd={handleDragEnd}>
        <div className="space-y-2">
          {clubs.map(g => (
            <ClubCard key={g.id} club={g} people={people} members={members} next={nextMeet[g.id] || ''}
              joined={mine.has(g.id)} pending={myPending.has(g.id)} onOpen={onOpen} />
          ))}
        </div>
        {/* 끌고 있는 동안만 상자로 세운다 — 손에 들린 게 무엇인지 보여야 한다.
            body 포털이 기본이다: .dc-card의 transform이 fixed의 기준 박스가 된다(§6-1). */}
        {createPortal(
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {dragged ? (
              <div className={`p-3.5 bg-surface border border-line shadow-elevated rotate-1 scale-[.98] opacity-95 cursor-grabbing ${CARD}`}>
                <ClubCardInner club={dragged} people={people} members={members} next={nextMeet[dragged.id] || ''}
                  joined={mine.has(dragged.id)} pending={myPending.has(dragged.id)} />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      {!clubs.length && (
        <Empty className="club-empty" mark={<PeopleMark />} title="아직 만들어진 동아리가 없어요" />
      )}
    </div>
  );
}

// 카드 속 내용 — 실제 카드와 끌고 있는 미리보기가 같이 쓴다.
// next — 다음 동아리 모임 날짜('YYYY-MM-DD' · groups.fetchNextMeetings). 없으면 그 줄이 서지 않는다.
function ClubCardInner({ club, people, members, joined, pending, next = '' }) {
  const list = groupPeople({ people, group: club, members });
  const leaderName = people.find(p => p.id === club.leader_person_id)?.name || '';
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="club-name text-[14px] font-bold text-fg">{club.name}</span>
        {joined && (
          <span className="club-mine-badge px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg text-[10.5px] font-bold">참여 중</span>
        )}
        {pending && (
          <span className="club-pending-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">신청 대기</span>
        )}
      </div>
      {club.note && <p className="mt-1 text-[12px] text-fg-secondary break-words">{club.note}</p>}
      <p className="mt-1 text-[11.5px] text-fg-muted">
        {[leaderName ? `동아리장 ${leaderName}` : '', `${list.length}명`].filter(Boolean).join(' · ')}
      </p>
      {!!next && (
        <p className="club-next-meet mt-0.5 text-[11.5px] text-fg-muted tabular-nums">다음 동아리 모임 {meetingDateShort(next)}</p>
      )}
    </>
  );
}

// 끌어서 순서를 바꾸는 카드. 카드 자체가 드롭 대상이라 목록 어디에나 끼워 넣을 수 있다
// (컬럼이 따로 없는 한 줄짜리 목록이라 프로젝트 탭과 같은 모양이다).
function ClubCard({ club, people, members, joined, pending, next = '', onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: club.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: club.id });
  // dnd-kit은 ref를 하나만 받으므로 손으로 합친다. **조건을 넣지 않는다**(§6-12-c) —
  // 콜백 신원이 바뀌면 끄는 도중에 노드가 사라진다.
  const setRefs = useCallback((el) => { setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  return (
    <button ref={setRefs} {...attributes} {...listeners} type="button" onClick={() => onOpen(club)}
      className={`club-card dc-card w-full text-left p-3.5 cursor-grab active:cursor-grabbing transition ${CARD} ${isDragging ? 'opacity-40' : ''} ${isOver && !isDragging ? 'shadow-[inset_0_2px_0_0_var(--app-accent)]' : ''}`}
      style={CARD_STYLE}>
      <ClubCardInner club={club} people={people} members={members} joined={joined} pending={pending} next={next} />
    </button>
  );
}

