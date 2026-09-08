import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SectionHead } from '../views/dashboardParts.jsx';
import { Skeleton } from './media.jsx';
import { RichText } from './RichText.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { ShareChip, ShareToggle } from './ShareToggle.jsx';
import { YearPicker } from './layout.jsx';
import {
  CARD, CARD_STYLE, BTN, BTN_QUIET, FIELD, ICON_BTN, EXIT,
  PersonTag, PersonPick, MenuPick, Empty, PeopleMark, NoteMark,
} from './groupsParts.jsx';
import { groupPeople, presentCount, sunCandidates } from '../services/groups.js';
import { formatServiceDate } from '../services/worship.js';

// ============================================================================
// 순 — 내 순 카드(구성원 · 최근 주일 예배 출석 · 공유된 예배 노트) · 순 편성 관리 구역
// ----------------------------------------------------------------------------
// 그리는 일만 한다. 통신은 views/groupsView.jsx가 하고 여기는 props로 받는다 —
// 그래야 검사가 가짜 순·노트로 화면을 그대로 눌러 볼 수 있다(tests/groups.mjs).
//
// 공유된 예배 노트는 **shared_to_sun을 켠 글만** 온다(결정 7 · 0036 same_sun). 순장에게
// 순원의 비공개 노트를 보여주지 않는다 — '안 한 사람이 지목되는' 구조를 만들지 않는다.
// **내 비공개 노트도 오지 않는다**(사용자 지시 2026-09-07) — 이 구역의 이름이
// '내 순에 공유된 예배 노트'라서, 공유하지 않은 글이 서면 이름과 내용이 어긋난다.
// 없는 줄은 그리지 않는다: 공유된 노트가 하나도 없으면 그 구역 자체가 없다.
//
// **폭은 대시보드 계열과 하나다**(사용자 지시 2026-09-01) — 내 순·동아리·순 편성이
// 저마다 max-w를 들고 있으면 탭을 옮길 때마다 카드 왼쪽 선이 움직인다. 화면 폭은
// views/views.jsx의 `dc-screen pb-6` 하나가 정하고 여기서는 다시 좁히지 않는다.
// ============================================================================

// ── 내 순 ───────────────────────────────────────────────────────────────────
// service·present는 **출석이 실제로 들어온 주일**의 것이다(groups.js attendanceSunday) —
// 아직 오지 않은 주일의 주보가 발행돼 있어도 그 예배의 `0/N`을 세지 않는다.
// loading은 그 한 벌(mineQ)이 캐시 없이 처음 오는 중이라는 뜻이다.
export function MySunPanel({ myPerson, sun, people, members, service, present, loading = false }) {
  const list = useMemo(() => groupPeople({ people, group: sun, members }), [people, sun, members]);
  const leaderName = useMemo(
    () => people.find(p => p.id === sun?.leader_person_id)?.name || '',
    [people, sun],
  );

  if (!myPerson) {
    return (
      <Empty className="mysun-empty" mark={<PeopleMark />}
        title="아직 명단에 이어지지 않은 계정이에요" hint="관리자에게 알려주세요" />
    );
  }
  if (!sun) {
    return (
      <Empty className="mysun-empty" mark={<PeopleMark />}
        title="올해 순 편성에 아직 이름이 올라 있지 않아요" />
    );
  }

  // 출석은 '출석이 들어온 가장 최근 주일 예배' 한 건이다(사용자 결정 2026-09-08).
  // 그런 예배가 없으면 줄을 그리지 않는다.
  const attended = service ? presentCount(list, present) : 0;
  const came = (id) => !!service && (present instanceof Set ? present.has(id) : (present || []).includes(id));

  return (
    <div className="mysun dc-screen pb-8">
      <div className={`mysun-card dc-card p-4 ${CARD}`} style={CARD_STYLE}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="mysun-name text-[17px] font-extrabold text-fg tracking-[-0.3px]">{sun.name}</h2>
          {leaderName && <span className="mysun-leader text-[11.5px] text-fg-muted">순장 {leaderName}</span>}
          <span className="flex-1" />
          <span className="text-[11.5px] text-fg-faint">{list.length}명</span>
        </div>

        {/* 첫 진입(캐시 없음)에는 **같은 높이의 자리**를 먼저 잡는다 — 아무것도 안
            그리면 값이 도착하는 순간 이름 격자가 한 줄만큼 아래로 밀린다. 높이는 이
            줄의 글자 크기(11.5px)가 만드는 높이와 같다. */}
        {loading ? (
          <div className="mysun-att-loading mt-2"><Skeleton className="h-[17px] w-44 rounded-md" /></div>
        ) : service && (
          <p className="mysun-att mt-2 text-[11.5px] text-fg-muted">
            {formatServiceDate(service.service_date)} 예배 출석 {attended}/{list.length}
          </p>
        )}

        {/* 칸 수를 못 박지 않고 폭이 허락하는 만큼 채운다 — 화면 폭이 대시보드 기준으로
            넓어져서 세 칸으로 두면 이름 오른쪽이 한 뼘씩 비었다(1440px에서 350px씩). */}
        <div className="mt-3.5 grid gap-x-3 gap-y-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,12rem),1fr))]">
          {/* 그 예배에 온 사람에게는 초록 '출석'이 하나 더 붙는다(사용자 요청
              2026-09-08). 자리('순장')가 먼저고 그날의 사실('출석')이 뒤다 —
              기준 예배가 없으면(위 service가 null) 아무에게도 붙지 않는다. */}
          {list.map(p => (
            <PersonTag key={p.id} person={p} className="mysun-member"
              badge={p.id === sun.leader_person_id ? '순장' : null}
              tag={came(p.id) ? '출석' : null} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ── 내 순에 공유된 예배 노트 ────────────────────────────────────────────────
// **카드 밖으로 나와 있다** — 이 섹션과 순모임 가이드는 같은 한 벌로 읽히고(캐시 키
// groups:mine:…) 스켈레톤도 하나로 묶여야 해서, 부르는 쪽이 두 섹션을 나란히 세운다
// (사용자 지적 2026-09-03 — "각각 따로 스켈레톤이 된다").
// 없을 때도 구역은 남긴다: 순장이 '노트가 공유되면 어디에 뜨는지'를 알 수 있어야 하고,
// 그 자리가 비어 있다는 것도 정보다. 순원의 비공개 노트는 여전히 오지 않는다(결정 7).
export function SunNotesSection({ notes = [], onShare }) {
  return (
    <div className="mysun-notes mt-6">
      <SectionHead>내 순에 공유된 예배 노트</SectionHead>
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map(n => <NoteRow key={n.id} note={n} onShare={onShare} />)}
        </div>
      ) : (
        <Empty className="mysun-note-empty" mark={<NoteMark />} minH="20vh"
          title="아직 순에 공유된 예배 노트가 없어요" />
      )}
    </div>
  );
}

// 노트 한 줄. **여기 서는 것은 공유된 노트뿐이다**(사용자 지시 2026-09-07 — 한동안은
// 내 비공개 노트도 잠금 표시를 달고 섰다). 내 줄에는 공유 토글이 그대로 남아서 여기서
// 공유를 끌 수 있고, 끄면 그 줄이 목록에서 사라진다(조회가 shared_to_sun만 본다).
// 바꾼 뒤에는 초록 칩으로 지금 상태를 말한다 — 토스트로 띄우면 목록의 어느 줄이
// 바뀐 것인지 알 수 없다.
//
// **공유는 말씀·예배와 같은 한 부품이다**(components/ShareToggle.jsx · 회차 8 '공유
// 토글은 한 부품'). 예전에는 이 줄만 누를 때마다 이름이 뒤집히는 버튼('순에 공유하기'
// ↔ '나만 보기')이라, 공유된 줄에 적힌 '나만 보기'가 지금 상태인지 누르면 될 일인지
// 알 수 없었다(2026-09-01에 다른 화면에서 지적받은 것과 같은 문제). 두 쪽을 나란히
// 두면 라벨이 손 밑에서 바뀌지 않는다.
// **이 화면에는 편집기가 없으므로 조작은 이 줄에 남는다**(사용자 결정 2026-09-05 —
// 말씀 나눔 피드에서는 편집기 토글 하나만 남기고 줄에서는 뺐다). 노트를 쓰는 자리는
// 예배 상세 화면이고, 거기 토글과 여기 토글은 서로 다른 화면에 한 벌씩이다.
function NoteRow({ note, onShare }) {
  const [state, setState] = useState('');   // '' | 'saving' | 'saved' (공유 칩)
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (state !== 'saved') return undefined;
    const t = setTimeout(() => setState(''), 2600);
    return () => clearTimeout(t);
  }, [state]);

  // 이미 그 상태인 쪽을 눌러도 아무 일도 일어나지 않는다(ShareToggle 머리말)
  const setShare = async (v) => {
    if (!onShare || v === !!note.shared || state === 'saving') return;
    setSaid(v ? '우리 순에 공유할게요' : '나만 볼게요');
    setState('saving');
    const ok = await onShare(note, v);
    setState(ok ? 'saved' : '');
  };

  return (
    <div className={`mysun-note dc-row p-3.5 ${CARD}`} style={CARD_STYLE}>
      <div className="flex items-center gap-2 gap-y-1.5 flex-wrap">
        <p className="text-[11.5px] text-fg-muted">
          {[note.serviceDate ? formatServiceDate(note.serviceDate) : '', note.name].filter(Boolean).join(' · ')}
        </p>
        {!!state && (
          <span className="mysun-note-said"><ShareChip state={state} label={said} /></span>
        )}
        <span className="flex-1" />
        {/* 좁은 폭에서는 토글이 **줄 아래에서 폭을 채운다**(두 쪽이 반씩). 예전에는
            `shrink-0`인 채로 접혀서, 날짜 줄 오른쪽 끝과 토글 왼쪽 끝이 어긋난 자리에
            버튼 두 개가 떠 있었다(사용자 지적 2026-09-07). 640부터는 지금처럼 오른쪽 끝이다.
            폭은 ShareToggle의 `className`으로 준다 — 그 부품은 말씀·예배와 함께 쓰는
            공용이라 안을 고치지 않는다(components/ShareToggle.jsx). 안쪽 두 쪽은 그 부품이
            `grow`로 남는 폭을 나누는데, **정확히 반씩**이려면 basis가 0이어야 해서
            좁은 폭에서만 `flex-1`을 얹는다(라벨 길이가 달라 grow만으로는 한쪽이 넓다). */}
        {note.mine && (
          <span className="mysun-note-share w-full sm:w-auto sm:shrink-0 [&_button]:flex-1 sm:[&_button]:flex-none">
            <ShareToggle value={!!note.shared} disabled={state === 'saving'}
              onChange={setShare} shareLabel="순에 공유하기" className="w-full sm:w-auto" />
          </span>
        )}
      </div>
      {/* 노트는 **마크다운으로 쓴다**(예배 화면이 MarkdownEditor로 바뀌었다) — 원문을
          그대로 글자로 두면 '## 제목'·'- 항목'·'**굵게**'가 그대로 보인다. 업무 본문·
          댓글과 같은 뷰어 한 벌을 쓴다(components/RichText.jsx). */}
      <div className="mysun-note-body mt-1 text-[13px] text-fg-secondary leading-relaxed break-words">
        <RichText content={note.body} />
      </div>
    </div>
  );
}

// ── 순 편성 (can_manage_sun 자격자만 — 마스터 · 관리자 · 리더순장) ──────────
// 교역자는 0039에서 빠졌다(사용자 결정 2026-09-02 "마스터/관리자/리더순장만 우선") —
// 탭 자체가 서지 않으므로 이 구역에 오는 사람은 이미 자격자다.
// 순장을 지정하면 그 순의 구성원으로도 들어간다(services/groups.js saveGroup) —
// 출석 정책 leads_sun_of()가 group_members를 보기 때문이다(0037).
// 고른 해의 편성이 오는 동안 순 목록 자리만 잡는다 — 연도 줄과 만들기 칸은 그대로
// 서 있어야 방금 누른 연도 고르개가 사라졌다 돌아오지 않는다.
const ADMIN_SKELETON = (
  <div className="sun-admin-loading space-y-2.5">
    <Skeleton className="w-full h-[152px] rounded-[10px]" />
    <Skeleton className="w-full h-[152px] rounded-[10px]" />
  </div>
);

export function SunAdminPanel({
  year, years, suns, people, members, creating, closingCreate, onCloseCreate, loading = false,
  onYear, onCreateSun, onRenameSun, onSetLeader, onAddMember, onMoveMember, onRemoveMember,
}) {
  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState('');

  // 그 해 어느 순에도 없는 사람만 '순원 추가'에 올린다 — 이미 편성된 사람은 '순 옮기기'로
  // 옮긴다. 그러지 않으면 한 사람이 두 순에 동시에 들어간다.
  // **sun_exempt(부장님·전도사님)는 아예 후보가 아니다**(0040 · sunCandidates) —
  // 순원 추가·순장 지정·새 순의 순장, 순 편성의 세 후보 목록이 같은 규칙을 쓴다.
  const unplaced = useMemo(() => {
    const placed = new Set();
    for (const g of suns) {
      if (g.leader_person_id) placed.add(g.leader_person_id);
      for (const m of members) if (m.group_id === g.id) placed.add(m.person_id);
    }
    return sunCandidates(people).filter(p => !placed.has(p.id));
  }, [people, suns, members]);
  // 순장 후보 — 순 편성 대상인 사람 전체(이미 편성된 사람도 자기 순의 순장이 될 수 있다).
  // 세울 수 있는지는 고른 뒤에 판정한다(groups.js leaderPlan) — 목록에서 미리 빼면
  // '왜 안 보이는지'를 화면이 말해 줄 수 없다.
  const leaderPool = useMemo(() => sunCandidates(people), [people]);

  const submit = async () => {
    const ok = await onCreateSun({ name: name.trim(), leaderPersonId: leaderId || null });
    if (ok) { onCloseCreate(); setName(''); setLeaderId(''); }
  };

  return (
    <div className="sun-admin dc-screen pb-8">
      {/* 연도는 프로젝트 진행 줄·탭 줄과 같은 부품이다(layout.jsx YearPicker) —
          네이티브 select는 기기마다 다른 목록이 떠서 우리 화면과 따로 놀았다. */}
      <div className="sun-year flex items-center gap-2 mb-2.5">
        <YearPicker year={year} years={years} onPick={onYear} compact />
      </div>

      {/* 한 줄짜리 생성기 — 이름과 순장은 같은 줄에 선다(사용자 지적 2026-09-03
          "쓸데없는 줄바꿈으로 나누지 말라"). 새 주보·모임 만들기와 같은 결이고,
          375px에서는 버튼이 둘째 줄로 접힌다. 순장 후보는 아직 아무 순에도 없는
          사람들이다 — 이미 편성된 사람을 새 순의 순장으로 세우면 두 순에 동시에 든다. */}
      {creating && (
        <div className={`sun-new ${closingCreate ? EXIT : 'dc-card'} relative z-20 p-2.5 mb-4 flex flex-wrap items-center gap-1.5 ${CARD}`} style={CARD_STYLE}>
          <input value={name} onChange={e => setName(e.target.value)} aria-label="새 순 이름"
            placeholder="예: 꼬순" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) submit(); }}
            className={`${FIELD} w-full sm:w-40`} />
          <PersonPick label="새 순의 순장" people={unplaced} value={leaderId} onChange={setLeaderId}
            placeholder="순장 지정" allowClear className="flex-1 min-w-[9rem] sm:max-w-[13rem]" />
          <button type="button" onClick={submit} disabled={!name.trim()}
            className={`sun-new-make shrink-0 ${BTN}`}>만들기</button>
          <span className="flex-1" />
          <button type="button" onClick={onCloseCreate} className={`shrink-0 ${BTN_QUIET}`}>취소</button>
        </div>
      )}

      {loading ? ADMIN_SKELETON : (
        <>
          <div className="space-y-2.5">
            {suns.map(g => (
              <SunRow key={g.id} group={g} suns={suns} people={people} members={members}
                unplaced={unplaced} leaderPool={leaderPool}
                onRename={onRenameSun} onSetLeader={onSetLeader}
                onAddMember={onAddMember} onMoveMember={onMoveMember} onRemoveMember={onRemoveMember} />
            ))}
          </div>
          {!suns.length && (
            <Empty className="sun-empty" mark={<PeopleMark />}
              title={`${year}년 순 편성이 아직 비어 있어요`} />
          )}
        </>
      )}
    </div>
  );
}

function SunRow({ group, suns, people, members, unplaced, leaderPool, onRename, onSetLeader, onAddMember, onMoveMember, onRemoveMember }) {
  const [draft, setDraft] = useState(group.name);
  useEffect(() => { setDraft(group.name); }, [group.name]);

  const list = useMemo(() => groupPeople({ people, group, members }), [people, group, members]);
  const others = useMemo(() => suns.filter(g => g.id !== group.id), [suns, group]);

  // 이름은 칸을 떠날 때(또는 Enter) 저장한다 — 글자마다 서버를 부르지 않는다.
  // **막히면 칸을 되돌린다**(0041 같은 이름) — 저장되지 않은 이름이 칸에 남아 있으면
  // 화면과 저장된 것이 어긋나고, 다음에 그 칸을 떠날 때 또 같은 실패가 뜬다.
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === group.name) { setDraft(group.name); return; }
    const ok = await onRename(group, next);
    if (!ok) setDraft(group.name);
  };

  return (
    <div className={`sun-row dc-row p-3.5 ${CARD}`} style={CARD_STYLE}>
      {/* 줄을 **정해서** 그린다(§6-9-z). flex-wrap에 맡겨 두었더니 375에서 순장 칸이
          둘째 줄로 내려가면서 인원 수가 그 줄 오른쪽에 붙어, 순의 인원이 아니라 순장에
          딸린 숫자처럼 읽혔다. 지금은 [이름 … N명] / [순장]이고, 640부터는 예전처럼
          [이름][순장] … [N명] 한 줄이다. 차례를 order로 바꾸는 이유는 읽는 순서(이름 ·
          순장 · 인원)를 DOM에 그대로 두기 위해서다. */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={`${group.name} 순 이름`}
          className={`sun-name ${FIELD} font-bold order-1 flex-1 sm:flex-none sm:w-[9.5rem]`} />
        <PersonPick label={`${group.name} 순장`} people={leaderPool} value={group.leader_person_id || ''}
          onChange={id => onSetLeader(group, id)} placeholder="순장 지정" allowClear
          className="sun-leader-pick order-3 basis-full sm:order-2 sm:basis-auto sm:w-[11rem]" />
        <span className="sun-count order-2 shrink-0 text-[11.5px] text-fg-faint sm:order-3 sm:ml-auto">{list.length}명</span>
      </div>

      {/* 이름과 그 사람의 조작(옮기기·빼기)은 한 칸 안에서 붙어 있어야 한다 —
          칸이 넓어지면 조작이 이름에서 멀찍이 떨어져 누구 것인지 흐려진다. */}
      <div className="mt-3 grid gap-x-3 gap-y-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
        {/* 순장은 옮기기·빼기 대상이 아니다 — 그러면 순장 자리는 그대로인데 구성원에서만
            빠져서, 출석 정책(leads_sun_of)이 보는 명단과 화면이 어긋난다. 순장을 바꾸려면
            위의 순장 칸에서 다른 사람을 고른다. */}
        {list.map(p => (
          <PersonTag key={p.id} person={p} className="sun-member"
            badge={p.id === group.leader_person_id ? '순장' : null}
            right={p.id === group.leader_person_id ? null : (
              <>
                <MenuPick className="sun-move" label={`${p.name} 순 옮기기`} items={others}
                  empty="옮길 다른 순이 아직 없어요"
                  onPick={id => onMoveMember(group, id, p)}>순 옮기기</MenuPick>
                <ConfirmPopover message={`${p.name}님을 ${group.name}에서 뺄까요?`} confirmLabel="빼기"
                  onConfirm={() => onRemoveMember(group, p)}>
                  <button type="button" aria-label={`${p.name} 빼기`} className={`sun-drop ${ICON_BTN}`}>
                    <Trash2 size={13} />
                  </button>
                </ConfirmPopover>
              </>
            )} />
        ))}
      </div>

      <PersonPick label={`${group.name} 순원 추가`} people={unplaced} value=""
        onChange={id => id && onAddMember(group, id)} placeholder="순원 추가"
        className="sun-add mt-3 w-full sm:w-64" />
    </div>
  );
}
