import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Check, X, Pencil, QrCode } from 'lucide-react';
import { SectionHead } from '../views/dashboardParts.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { DatePicker } from './DatePicker.jsx';
import {
  CARD, CARD_STYLE, BTN, BTN_QUIET, FIELD, ICON_BTN, WITH_ICON, EXIT, useClosing, NEW_H, DATE_TRIGGER,
  PersonTag, PersonPick, LabeledField, Empty, PeopleMark, MeetMark, FailTail,
} from './groupsParts.jsx';
import { groupPeople, canManageClub, canEditClub, notInGroup } from '../services/groups.js';
import { formatServiceDate } from '../services/worship.js';
import { imeComposing } from '../utils.js';
import { splitMeetings, PAST_MEETINGS_SHOWN } from '../services/traces.js';

// QR 창(qrcode 포함)은 열 때만 받는다(2026-09-24)
const ClubQrModal = lazy(() => import('./ClubQr.jsx').then(m => ({ default: m.ClubQrModal })));

// ============================================================================
// 동아리 상세 — 구성원 · 멤버 추가 · 가입 신청 · 모임과 출석(groupsClub.jsx에서 갈라 왔다 · 19차)
// ----------------------------------------------------------------------------
// 목록·끌어서 순서·방향 전환 겉껍데기(ClubsPanel)는 groupsClub.jsx에 있고, 권한 표도 그 파일 머리말이다.
// 그리는 일만 한다 — 통신은 views/groupsView.jsx가 한다.
// 생성기의 칸 높이(NEW_H)·날짜 트리거 모양(DATE_TRIGGER)은 예배 만들기와 한 벌이다(groupsParts).
// ============================================================================

// 모임 일정 읽기 실패의 첫 줄(D2 — 실패 자리의 제목)
const MEET_FAIL = '모임 일정을 불러오지 못했어요';

// ── 상세 ────────────────────────────────────────────────────────────────────
export function ClubDetail({
  club, people, members, apps, perms, meetings, meetingsFail = null, onBack, onApply, onCancelApply,
  onAccept, onDecline, onAddMember, onRemoveMember, onEditClub, onCreateMeeting, onToggleMeeting,
  onDeleteMeeting,
}) {
  const [adding, setAdding] = useState(false);
  const [closingMeet, closeMeet] = useClosing();
  // 오늘(한국 시간)을 미리 채운다 — 모임은 대개 오늘이나 이번 주에 잡는다.
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', note: '' });
  const [qrOpen, setQrOpen] = useState(false);
  // 다른 동아리로 옮겨 가면 그 동아리에서 열어 둔 칸을 전부 닫는다 — 앞 동아리의 편집
  // 칸·QR·모임 만들기가 다음 동아리의 머리줄에 남으면 안 된다.
  // **지금은 대개 돌지 않는다**: 2026-09-08에 붙인 방향 전환 겉껍데기(ClubsPanel의
  // `key={club:<id>}`)가 상세를 통째로 다시 마운트하므로 상태가 스스로 초기값으로 돌아간다.
  // 남겨 두는 것은 그 key가 바뀌면(같은 자리에서 동아리만 갈아 끼우게 되면) 되살아나는
  // 함정이라서다 — 그때 셋 중 하나만 빠져 있으면 그 칸만 남는다.
  useEffect(() => { setEditing(false); setQrOpen(false); setAdding(false); setPastOpen(false); }, [club.id]);

  const list = useMemo(() => groupPeople({ people, group: club, members }), [people, club, members]);
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);
  const manage = canManageClub(perms, club.id);
  // 신청 수락·거절만 아직 **마스터 + 그 동아리장**이다(0035 club_applications_update).
  // 0045는 멤버 추가·제거(group_members_write)와 모임(group_meetings_write)만 관리자까지
  // 열었으므로 이 자리는 따로 잰다 — 자격이 없는데 버튼이 보이면 눌렀을 때 RLS가 막는다.
  const manageApps = !!perms.isMaster || (perms.ledClubIds || []).includes(club.id);
  const me = perms.myPerson;
  const joined = !!me && list.some(p => p.id === me.id);
  const myApp = me ? apps.find(a => a.group_id === club.id && a.person_id === me.id) : null;
  const waiting = useMemo(() => apps.filter(a => a.group_id === club.id), [apps, club.id]);
  // 이미 든 사람은 '멤버 추가' 후보가 아니다 — 넣어 봐야 아무 일도 안 일어난다.
  const candidates = useMemo(() => notInGroup(people, club, members), [people, club, members]);

  // 다가오는 / 지난 모임(traces.splitMeetings) — 오늘은 한국 날짜다(모임 날짜가 한국 날짜)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const { upcoming, past } = useMemo(() => splitMeetings(meetings, today), [meetings, today]);
  const [pastOpen, setPastOpen] = useState(false);
  const submitMeeting = async () => {
    const ok = await onCreateMeeting(club, { date, title: title.trim() });
    if (ok) { closeMeet(() => { setAdding(false); setTitle(''); }); }
  };

  // 이름·설명 고치기. 값은 **열 때** 담는다 — 상태를 club과 계속 맞춰 두면 저장 뒤
  // 한 벌을 다시 읽는 사이에 타이핑 중인 칸이 되돌아간다.
  const canEdit = canEditClub(perms, club);
  const openEdit = () => { setDraft({ name: club.name, note: club.note || '' }); setEditing(true); };
  const submitEdit = async () => {
    const name = draft.name.trim();
    const note = draft.note.trim();
    if (!name) return;
    // 그대로면 저장하러 가지 않는다(순 이름과 같은 판단) — 바뀐 게 없는데 토스트가 뜬다
    if (name === club.name && note === (club.note || '')) { setEditing(false); return; }
    const ok = await onEditClub(club, { name, note });
    if (ok) setEditing(false);
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
        {/* 신청 QR — 동아리를 고칠 수 있는 사람만(canEdit · 0039 groups_update).
            찍으면 로그인 → 이 동아리의 신청 목록까지 한 번에 간다(components/ClubQr.jsx).
            무채색 테두리 버튼이다: 누르면 창이 뜨는 도구이지 저장이 아니고(§8 색 규칙),
            같은 줄의 '가입 신청'(진한 accent)과 뜻이 갈려 보여야 한다. */}
        {canEdit && (
          <button type="button" onClick={() => setQrOpen(true)}
            className={`club-qr-open ${WITH_ICON} px-2.5 py-1.5 rounded-md border border-line bg-surface text-[11.5px] font-semibold text-fg hover:bg-surface-hover transition active:scale-95`}>
            <QrCode size={13} /><span>신청 QR</span>
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onBack} className={BTN_QUIET}>목록으로</button>
      </div>
      {qrOpen && <Suspense fallback={null}><ClubQrModal club={club} onClose={() => setQrOpen(false)} /></Suspense>}

      <div className={`p-4 ${CARD}`} style={CARD_STYLE}>
        {/* 이름·설명은 머리줄에서 그 자리에 고친다 — 따로 창을 띄우면 무엇을 고치는
            중인지가 화면에서 사라진다. 확정은 오른쪽 끝(§8 대화창 규칙). */}
        {editing ? (
          <div className="club-edit-form flex flex-wrap items-center gap-1.5">
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              aria-label="동아리 이름 고치기" placeholder="예: 통통"
              className={`${FIELD} font-bold w-full sm:w-40`} />
            <input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
              aria-label="동아리 설명 고치기" placeholder="예: 통기타 동아리"
              onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') submitEdit(); }}
              className={`${FIELD} flex-1 min-w-[8rem] sm:max-w-[26rem]`} />
            <button type="button" onClick={submitEdit} disabled={!draft.name.trim()}
              className={`club-edit-save shrink-0 ${BTN}`}>저장</button>
            <span className="flex-1" />
            <button type="button" onClick={() => setEditing(false)}
              className={`club-edit-cancel shrink-0 ${BTN_QUIET}`}>취소</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <h2 className="club-title text-[17px] font-extrabold text-fg tracking-[-0.3px] break-words">{club.name}</h2>
              {canEdit && (
                <button type="button" onClick={openEdit} aria-label={`${club.name} 정보 고치기`}
                  className={`club-edit ${ICON_BTN}`}><Pencil size={13} /></button>
              )}
            </div>
            {club.note && <p className="mt-1 text-[12.5px] text-fg-secondary break-words">{club.note}</p>}
          </>
        )}

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

      {/* 리더 도구 — 그 동아리장 또는 관리자에게만(0045 group_members_write) */}
      {manage && (
        <div className="club-leader-tools mt-6">
          {/* 가입 신청 — **대기가 없어도 구역은 남긴다**(사용자 결정 2026-09-03 캐릭터 컷).
              동아리장이 '신청이 오면 어디에 뜨는지'를 알 수 있어야 하고, 그 자리가
              비어 있다는 것도 정보다. 높이는 카드에 딸린 구역만큼만 잡는다.
              수락·거절 자격만 아직 마스터 + 그 동아리장이라(위 manageApps) 이 구역은
              관리자에게 서지 않는다. */}
          {manageApps && (
          <div className="mb-6">
            <SectionHead>{waiting.length ? `가입 신청 ${waiting.length}건` : '가입 신청'}</SectionHead>
            {waiting.length === 0 && (
              <Empty className="club-app-empty" mark={<PeopleMark />} minH="20vh"
                title="아직 들어온 가입 신청이 없어요" />
            )}
            {waiting.length > 0 && (
              <div className="space-y-2">
                {waiting.map(a => (
                  <div key={a.id} className={`club-app-row dc-row flex items-center gap-2 p-3 ${CARD}`} style={CARD_STYLE}>
                    <PersonTag person={byId.get(a.person_id) || { name: '' }} />
                    <span className="flex-1" />
                    <button type="button" onClick={() => onAccept(a)} aria-label="수락"
                      className={`club-accept ${WITH_ICON} ${BTN}`}>
                      <Check size={13} /><span>수락</span>
                    </button>
                    <button type="button" onClick={() => onDecline(a)} aria-label="거절"
                      className={`club-decline ${WITH_ICON} px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95`}>
                      <X size={13} /><span>거절</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

        </div>
      )}

      {/* 모임 — **다가오는 모임 / 지난 모임** 두 구역(사용자 결정 2026-09-25 · 목업 mockup-traces 6 권장안).
          다가오는 = 오늘 포함 가까운 날부터(그날 출석을 체크하는 자리) · 지난 = 최근부터 세 개, 나머지는
          'N건 더 보기'. 나누는 규칙은 services/traces.splitMeetings(KST 날짜). '모임 만들기'는 다가오는 모임
          머리 오른쪽이다(만들 수 있는 사람에게만 — manage). 다가오는 쪽이 비면 상태 한 줄 `다음 모임 미정`
          (예전의 그림 + '예정된 모임이 아직 없어요'를 대신한다 · §8 문구 톤), 지난 쪽이 비면 구역째 없다.
          지난 모임의 칩은 흐리게 하지 않는다(출석 수정 자격은 manage 하나 — 구성원에게는 이미 .6이다). */}
      {(meetings.length > 0 || manage || !!meetingsFail) && (
        <div className="club-meetings mt-6">
          <SectionHead right={manage && !adding && (
            <button type="button" onClick={() => setAdding(true)}
              className={`club-meet-new-open ${WITH_ICON} px-2 py-1 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95`}>
              <Plus size={12} /><span>모임 만들기</span>
            </button>
          )}>다가오는 모임</SectionHead>

          {/* 생성기 — 날짜는 오늘이 이미 채워져 있어서 **한 번 눌러 만든다**.
              예전에는 날짜·제목·버튼이 저마다 한 줄을 차지해 세 줄이었고, 정작 채울 것은
              하나(제목, 그것도 선택)뿐이었다(사용자 지적 2026-09-02 — 새 주보와 같은 문제).
              지금은 **예배 만들기와 같은 짜임**이다(2026-09-08): 칸마다 위에 작은 라벨,
              칸 높이는 모두 34px(NEW_H), 확정 왼쪽 / 나가기는 그 줄의 오른쪽 끝(ml-auto).
                · 640부터  — [날짜][제목][만들기] … [취소]  한 줄
                · 375에서 — 제목이 한 줄을 다 쓰고, 그 아래 [날짜][만들기] … [취소]
              차례를 order로 바꾸는 이유: 좁은 폭에서 날짜가 먼저 서면 제목(w-full)이
              혼자 한 줄로 밀려나 **세 줄**이 된다. 라벨은 취소가 홀로 뜨지 않게 하는
              ml-auto와 함께 §8의 '나가기 오른쪽'을 두 폭에서 같은 자리로 지킨다.
              날짜는 업무 날짜와 같은 픽커다 — 네이티브 date 입력은 기기마다 다른 달력이
              뜨고, 우리 화면의 다른 날짜 칸과 생김새가 달랐다.
              **relative z-20**은 날짜 패널 몫이다 — 이 카드의 등장 애니메이션(transform)이
              쌓임 맥락을 만들어서 안의 z-50이 카드 밖으로 나가지 못하고, 아래 모임
              카드들(저마다 같은 이유로 맥락을 갖는다)이 패널을 덮었다(예배 화면에서
              먼저 발견 · §6-1과 같은 뿌리). */}
          {adding && (
            <div className={`club-meet-new ${closingMeet ? EXIT : 'dc-card'} relative z-20 p-3 mb-2 flex flex-wrap items-end gap-2.5 sm:gap-1.5 ${CARD}`} style={CARD_STYLE}>
              <LabeledField label="제목"
                className="club-meet-title order-1 w-full sm:order-2 sm:w-auto sm:flex-1 sm:basis-40 sm:min-w-0 sm:max-w-[26rem]">
                <input value={title} onChange={e => setTitle(e.target.value)} aria-label="모임 제목"
                  placeholder="예: 9월 첫 모임" onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') submitMeeting(); }}
                  className={`${FIELD} ${NEW_H} w-full`} />
              </LabeledField>
              <LabeledField label="날짜" className="order-2 shrink-0 sm:order-1">
                {/* 클래스는 이 감싸개에 그대로 둔다 — 검사가 `.club-meet-date`의 첫
                    자식을 픽커 뿌리로 잡는다(tests/groups.mjs pickDate) */}
                <div className="club-meet-date">
                  <DatePicker value={date} onChange={setDate} triggerClassName={DATE_TRIGGER} />
                </div>
              </LabeledField>
              {/* 확정 왼쪽 / 나가기 오른쪽(§8) — 새 주보·새 동아리·새 순과 같은 자리다.
                  두 모드에서 자리가 같아야 손가락 밑의 버튼이 뜻을 바꾸지 않는다. */}
              <button type="button" onClick={submitMeeting} disabled={!date}
                className={`club-meet-make order-3 shrink-0 ${BTN}`}>만들기</button>
              <button type="button" onClick={() => setAdding(false)}
                className={`club-meet-cancel order-4 shrink-0 ml-auto ${BTN_QUIET}`}>취소</button>
            </div>
          )}

          {/* 못 읽었을 때는 없는 것과 가른다(D2) — 같은 그림 + 두 줄 + '다시 시도' */}
          {meetingsFail ? (
            <Empty className="club-meet-failed" mark={<MeetMark />} minH="28vh" title={MEET_FAIL}>
              <FailTail reason={meetingsFail.reason} onRetry={meetingsFail.onRetry} />
            </Empty>
          ) : (
            <>
              {upcoming.length > 0 ? (
                <div className="club-meet-upcoming space-y-2">
                  {upcoming.map(m => (
                    <MeetingRow key={m.id} meeting={m} list={list} manage={manage}
                      onToggle={onToggleMeeting} onDelete={onDeleteMeeting} />
                  ))}
                </div>
              ) : (
                <p className="club-meet-empty pt-0.5 pb-1 text-[11.5px] text-fg-muted">다음 모임 미정</p>
              )}
              {past.length > 0 && (
                <div className="club-meet-past mt-5">
                  <SectionHead>지난 모임</SectionHead>
                  <div className="space-y-2">
                    {(pastOpen ? past : past.slice(0, PAST_MEETINGS_SHOWN)).map(m => (
                      <MeetingRow key={m.id} meeting={m} list={list} manage={manage}
                        onToggle={onToggleMeeting} onDelete={onDeleteMeeting} />
                    ))}
                  </div>
                  {!pastOpen && past.length > PAST_MEETINGS_SHOWN && (
                    <button type="button" onClick={() => setPastOpen(true)}
                      className="club-meet-past-more w-full mt-1 py-2 rounded-md text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99]">
                      {past.length - PAST_MEETINGS_SHOWN}건 더 보기
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 모임 한 줄 — 날짜·제목과 사람 칩. 칩은 눌러서 출석을 켜고 끄고, 그 자리에서 저장된다.
//
// **삭제는 만들 수 있는 사람의 것이다**(사용자 요청 2026-09-14 — 작성자·마스터·동아리장·
// 관리자). manage가 곧 그 경계고 0035 group_meetings_write와 같은 줄이다(services/groups
// deleteMeeting 주석). 확인은 ConfirmPopover 한 벌(§8), 자리는 줄 오른쪽 끝 — **늘 보인다**.
// hover에서만 나타나게 하면 터치 기기에서는 기능이 없는 것처럼 보인다(§8).
function MeetingRow({ meeting, list, manage, onToggle, onDelete }) {
  const present = useMemo(() => new Set(Array.isArray(meeting.attendance) ? meeting.attendance : []),
    [meeting.attendance]);
  const when = formatServiceDate(meeting.meeting_date);
  return (
    <div className={`club-meeting dc-row p-3.5 ${CARD}`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="club-meeting-date text-[12.5px] font-bold text-fg">{when}</span>
        {meeting.title && <span className="text-[12px] text-fg-secondary break-words">{meeting.title}</span>}
        <span className="flex-1" />
        <span className="club-meeting-count text-[11.5px] text-fg-muted">{present.size}/{list.length}</span>
        {manage && onDelete && (
          <ConfirmPopover
            className="inline-flex self-center"
            message={`${when} 모임을 지울까요?\n출석 체크도 같이 지워져요.`}
            confirmLabel="삭제" onConfirm={() => onDelete(meeting)}>
            <button type="button" aria-label={`${when} 모임 지우기`}
              className={`club-meet-drop ${ICON_BTN} p-1.5 hover:text-tag-red-fg`}>
              <Trash2 size={13} />
            </button>
          </ConfirmPopover>
        )}
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
