import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Check, X } from 'lucide-react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { SectionHead } from '../views/dashboardParts.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { DatePicker } from './DatePicker.jsx';
import {
  CARD, CARD_STYLE, BTN, BTN_QUIET, FIELD, ICON_BTN, WITH_ICON,
  PersonTag, PersonPick, Empty, PeopleMark, MeetMark,
} from './groupsParts.jsx';
import { groupPeople, canManageClub, myGroupIds, notInGroup } from '../services/groups.js';
import { formatServiceDate } from '../services/worship.js';
import { reorderIds } from '../utils.js';

// ============================================================================
// 동아리 — 목록(끌어서 순서 조정) · 상세(구성원 · 멤버 추가 · 가입 신청 · 모임과 출석)
// ----------------------------------------------------------------------------
// 그리는 일만 한다. 통신은 views/groupsView.jsx가 한다.
//
// 권한(docs/V2.md 권한 표 · 0035 RLS):
//   · 동아리 개설·동아리장 지정 = **마스터만**       → '새 동아리'는 마스터에게만
//   · 명단·모임·신청 수락 = 마스터 또는 그 동아리장  → 리더 도구가 그때만 선다
//   · 가입 신청·취소 = 본인                          → 명단에 이어진 계정만
// 화면은 이 경계를 비추기만 한다. 어긋나면 DB가 이긴다.
//
// **카드 순서만 예외로 누구나 바꾼다** — 프로젝트 탭·칸반과 같은 '공유 순서'라서,
// 0038이 position만 만지는 definer 함수를 승인 멤버 전체에게 열어 두었다.
//
// 폭은 대시보드 계열 하나다 — 여기서 max-w로 다시 좁히지 않는다(groupsSun.jsx 머리말).
// ============================================================================

// 놓을 곳은 "손가락/커서가 있는 곳" 기준(보드와 같은 판단 — §6-11).
// pointerWithin이 비었을 때만 사각형 겹침으로 떨어진다.
const dropCollision = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

export function ClubsPanel({
  clubs, people, members, apps, perms, openClub, meetings, creating, onCloseCreate,
  onOpen, onBack, onCreateClub, onApply, onCancelApply, onAccept, onDecline,
  onAddMember, onRemoveMember, onReorder, onCreateMeeting, onToggleMeeting,
}) {
  if (openClub) {
    return (
      <ClubDetail club={openClub} people={people} members={members} apps={apps} perms={perms}
        meetings={meetings} onBack={onBack} onApply={onApply} onCancelApply={onCancelApply}
        onAccept={onAccept} onDecline={onDecline} onAddMember={onAddMember} onRemoveMember={onRemoveMember}
        onCreateMeeting={onCreateMeeting} onToggleMeeting={onToggleMeeting} />
    );
  }
  return (
    <ClubList clubs={clubs} people={people} members={members} apps={apps} perms={perms}
      creating={creating} onCloseCreate={onCloseCreate} onOpen={onOpen}
      onCreateClub={onCreateClub} onReorder={onReorder} />
  );
}

// ── 목록 ────────────────────────────────────────────────────────────────────
function ClubList({ clubs, people, members, apps, perms, creating, onCloseCreate, onOpen, onCreateClub, onReorder }) {
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
      {creating && (
        <div className={`club-new p-3.5 mb-4 ${CARD}`} style={CARD_STYLE}>
          <input value={name} onChange={e => setName(e.target.value)} aria-label="동아리 이름"
            placeholder="예: 통통" className={`w-full sm:w-72 ${FIELD}`} />
          <input value={note} onChange={e => setNote(e.target.value)} aria-label="동아리 설명"
            placeholder="예: 통기타 동아리" className={`w-full sm:w-96 mt-2.5 ${FIELD}`} />
          <PersonPick label="동아리장" people={people} value={leaderId} onChange={setLeaderId}
            placeholder="동아리장 지정" allowClear className="w-full sm:w-72 mt-2.5" />
          <div className="flex items-center gap-1.5 mt-3">
            <button type="button" onClick={submit} disabled={!name.trim()} className={BTN}>만들기</button>
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
            <ClubCard key={g.id} club={g} people={people} members={members}
              joined={mine.has(g.id)} pending={myPending.has(g.id)} onOpen={onOpen} />
          ))}
        </div>
        {/* 끌고 있는 동안만 상자로 세운다 — 손에 들린 게 무엇인지 보여야 한다.
            body 포털이 기본이다: .dc-card의 transform이 fixed의 기준 박스가 된다(§6-1). */}
        {createPortal(
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {dragged ? (
              <div className={`p-3.5 bg-surface border border-line shadow-elevated rotate-1 scale-[.98] opacity-95 cursor-grabbing ${CARD}`}>
                <ClubCardInner club={dragged} people={people} members={members}
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
function ClubCardInner({ club, people, members, joined, pending }) {
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
    </>
  );
}

// 끌어서 순서를 바꾸는 카드. 카드 자체가 드롭 대상이라 목록 어디에나 끼워 넣을 수 있다
// (컬럼이 따로 없는 한 줄짜리 목록이라 프로젝트 탭과 같은 모양이다).
function ClubCard({ club, people, members, joined, pending, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: club.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: club.id });
  // dnd-kit은 ref를 하나만 받으므로 손으로 합친다. **조건을 넣지 않는다**(§6-12-c) —
  // 콜백 신원이 바뀌면 끄는 도중에 노드가 사라진다.
  const setRefs = useCallback((el) => { setNodeRef(el); setDropRef(el); }, [setNodeRef, setDropRef]);
  return (
    <button ref={setRefs} {...attributes} {...listeners} type="button" onClick={() => onOpen(club)}
      className={`club-card dc-card w-full text-left p-3.5 cursor-grab active:cursor-grabbing transition ${CARD} ${isDragging ? 'opacity-40' : ''} ${isOver && !isDragging ? 'shadow-[inset_0_2px_0_0_var(--app-accent)]' : ''}`}
      style={CARD_STYLE}>
      <ClubCardInner club={club} people={people} members={members} joined={joined} pending={pending} />
    </button>
  );
}

// ── 상세 ────────────────────────────────────────────────────────────────────
function ClubDetail({
  club, people, members, apps, perms, meetings, onBack, onApply, onCancelApply,
  onAccept, onDecline, onAddMember, onRemoveMember, onCreateMeeting, onToggleMeeting,
}) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  const [title, setTitle] = useState('');

  const list = useMemo(() => groupPeople({ people, group: club, members }), [people, club, members]);
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);
  const manage = canManageClub(perms, club.id);
  const me = perms.myPerson;
  const joined = !!me && list.some(p => p.id === me.id);
  const myApp = me ? apps.find(a => a.group_id === club.id && a.person_id === me.id) : null;
  const waiting = useMemo(() => apps.filter(a => a.group_id === club.id), [apps, club.id]);
  // 이미 든 사람은 '멤버 추가' 후보가 아니다 — 넣어 봐야 아무 일도 안 일어난다.
  const candidates = useMemo(() => notInGroup(people, club, members), [people, club, members]);

  const submitMeeting = async () => {
    const ok = await onCreateMeeting(club, { date, title: title.trim() });
    if (ok) { setAdding(false); setTitle(''); }
  };

  return (
    <div className="club-detail dc-screen pb-8">
      {/* 상시 도구 줄 — 확정 왼쪽 / 나가기 오른쪽(§8) */}
      <div className="flex items-center gap-1.5 mb-3.5">
        {me && !joined && !myApp && (
          <button type="button" onClick={() => onApply(club)} className={`club-apply ${BTN}`}>가입 신청</button>
        )}
        {myApp && (
          <>
            <span className="club-waiting px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">신청 대기</span>
            <button type="button" onClick={() => onCancelApply(myApp)} className={`club-cancel ${BTN_QUIET}`}>신청 취소</button>
          </>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onBack} className={BTN_QUIET}>목록으로</button>
      </div>

      <div className={`p-4 ${CARD}`} style={CARD_STYLE}>
        <h2 className="text-[17px] font-extrabold text-fg tracking-[-0.3px]">{club.name}</h2>
        {club.note && <p className="mt-1 text-[12.5px] text-fg-secondary break-words">{club.note}</p>}

        <div className="mt-4">
          <SectionHead>구성원 {list.length}명</SectionHead>
          {/* 이름과 내보내기가 한 칸 안에서 붙어 있게 — 칸 수는 폭이 정한다(groupsSun과 같다) */}
          <div className="grid gap-x-3 gap-y-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
            {list.map(p => (
              <PersonTag key={p.id} person={p} className="club-member"
                badge={p.id === club.leader_person_id ? '동아리장' : null}
                right={manage && p.id !== club.leader_person_id ? (
                  <ConfirmPopover message={`${p.name}님을 ${club.name}에서 내보낼까요?`} confirmLabel="내보내기"
                    onConfirm={() => onRemoveMember(club, p)}>
                    <button type="button" aria-label={`${p.name} 내보내기`} className={`club-drop ${ICON_BTN}`}>
                      <Trash2 size={13} />
                    </button>
                  </ConfirmPopover>
                ) : null} />
            ))}
          </div>
          {/* 명단 채우기는 그 동아리장(또는 마스터)의 일이다 — 가입 신청을 기다리지
              않고 여기서 바로 넣는다. 구성원 수는 넣고 빼는 대로 같이 움직인다. */}
          {manage && (
            <PersonPick label={`${club.name} 멤버 추가`} people={candidates} value=""
              onChange={id => id && onAddMember(club, id)} placeholder="멤버 추가"
              className="club-add mt-3 w-full sm:w-64" />
          )}
        </div>
      </div>

      {/* 리더 도구 — 그 동아리장 또는 마스터에게만(0035 group_members_write) */}
      {manage && (
        <div className="club-leader-tools mt-6">
          {waiting.length > 0 && (
            <div className="mb-6">
              <SectionHead>가입 신청 {waiting.length}건</SectionHead>
              <div className="space-y-2">
                {waiting.map(a => (
                  <div key={a.id} className={`club-app-row dc-row flex items-center gap-2 p-3 ${CARD}`} style={CARD_STYLE}>
                    <PersonTag person={byId.get(a.person_id) || { name: '' }} />
                    <span className="flex-1" />
                    <button type="button" onClick={() => onAccept(a)} aria-label="수락"
                      className={`club-accept ${WITH_ICON} px-2.5 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95`}>
                      <Check size={13} /><span>수락</span>
                    </button>
                    <button type="button" onClick={() => onDecline(a)} aria-label="거절"
                      className={`club-decline ${WITH_ICON} px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95`}>
                      <X size={13} /><span>거절</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SectionHead right={!adding && (
            <button type="button" onClick={() => setAdding(true)}
              className={`club-meet-new-open ${WITH_ICON} px-2 py-1 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95`}>
              <Plus size={12} /><span>모임 만들기</span>
            </button>
          )}>모임</SectionHead>

          {adding && (
            <div className={`club-meet-new p-3.5 mb-2 ${CARD}`} style={CARD_STYLE}>
              {/* 업무 날짜와 같은 픽커다 — 네이티브 date 입력은 기기마다 다른 달력이
                  뜨고, 우리 화면의 다른 날짜 칸과 생김새가 달랐다. */}
              <div className="club-meet-date">
                <DatePicker value={date} onChange={setDate} />
              </div>
              <input value={title} onChange={e => setTitle(e.target.value)} aria-label="모임 제목"
                placeholder="예: 9월 첫 모임" className={`w-full sm:w-96 mt-2.5 ${FIELD}`} />
              <div className="flex items-center gap-1.5 mt-3">
                <button type="button" onClick={submitMeeting} disabled={!date} className={BTN}>만들기</button>
                <span className="flex-1" />
                <button type="button" onClick={() => setAdding(false)} className={BTN_QUIET}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}

      {(meetings.length > 0 || manage) && (
        <div className={manage ? 'mt-2' : 'mt-6'}>
          {!manage && <SectionHead>모임</SectionHead>}
          <div className="space-y-2">
            {meetings.map(m => (
              <MeetingRow key={m.id} meeting={m} list={list} manage={manage} onToggle={onToggleMeeting} />
            ))}
          </div>
          {/* 이 빈 자리는 화면 한 판이 아니라 카드 아래에 딸린 구역이라 세로를 줄여
              잡는다 — 46vh를 그대로 쓰면 동아리 카드 뒤로 빈 화면이 한 판 더 붙는다 */}
          {!meetings.length && (
            <Empty className="club-meet-empty" mark={<MeetMark />} minH="28vh"
              title="예정된 모임이 아직 없어요" />
          )}
        </div>
      )}
    </div>
  );
}

// 모임 한 줄 — 날짜·제목과 사람 칩. 칩은 눌러서 출석을 켜고 끄고, 그 자리에서 저장된다.
function MeetingRow({ meeting, list, manage, onToggle }) {
  const present = useMemo(() => new Set(Array.isArray(meeting.attendance) ? meeting.attendance : []),
    [meeting.attendance]);
  return (
    <div className={`club-meeting dc-row p-3.5 ${CARD}`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="club-meeting-date text-[12.5px] font-bold text-fg">{formatServiceDate(meeting.meeting_date)}</span>
        {meeting.title && <span className="text-[12px] text-fg-secondary break-words">{meeting.title}</span>}
        <span className="flex-1" />
        <span className="club-meeting-count text-[11.5px] text-fg-faint">{present.size}/{list.length}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {list.map(p => {
          const on = present.has(p.id);
          return (
            <button key={p.id} type="button" disabled={!manage} aria-pressed={on}
              onClick={() => onToggle(meeting, p.id)}
              className="club-meet-chip px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-60"
              style={on
                ? { background: 'var(--app-accent)', color: '#fff' }
                : { background: 'var(--app-surface-hover)', color: 'var(--app-ink-muted)' }}>
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
