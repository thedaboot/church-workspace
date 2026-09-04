import React, { useMemo, useState } from 'react';
import { Plus, Check, Link2, Link2Off, UserX, Undo2, Loader2, Pencil, X, Search, CalendarDays } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { Skeleton } from './media.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { DatePicker } from './DatePicker.jsx';
import { BTN as BTN_BASE, BTN_QUIET as BTN_QUIET_BASE, FIELD as FIELD_BASE, WITH_ICON, LabeledField } from './groupsParts.jsx';
import { CONFIG } from '../config.js';
import { objectParticle } from '../services/errorText.js';
import {
  ROLE_LABEL, YEAR_ROLES, PASTOR_LABEL,
  parseBirthday, searchPeople, accountLinkState, sunNames, rolesByPerson, personBadges,
} from '../services/roster.js';

// ============================================================================
// 청년 명단 구역의 부품 — 멤버 화면(views/membersView.jsx)의 '청년 명단' 탭이 쓴다
// ----------------------------------------------------------------------------
// **props로 받은 것만 그린다.** 통신(조회·저장)은 전부 membersView가 하고 여기는
// 화면만 만든다 — 그래야 게스트 스위트가 가짜 명단을 심어 이 화면을 그대로 눌러
// 볼 수 있다(tests/roster.mjs · services/word·worship와 같은 방식).
//
// 사진은 **계정이 연결된 사람만**이다. url을 null로 못 박아 이름으로 사진을 찾는
// 길(Avatar의 기본 동작)을 아예 닫는다 — 이름으로 사람을 매다는 방식은 §6-26에서
// 이미 깨졌고, 명단에는 동명이인이 생길 수 있다.
//
// 행을 지우는 버튼은 없다. 환송(removed_at)만 있고 되돌릴 수 있다 — 출석 기록이
// person_id로 매달려 있다(services/roster.js 머리말).
//
// **부품은 앱에 있는 것을 쓴다**(사용자 지적 2026-09-05 — "우리 컴포넌트를 쓴 것 같지
// 않다"). 이름 찾기 칸은 성경 리더의 검색 폼과 같은 모양이고(surface + line 테두리
// h-9 + lucide Search), 연도는 값이 셋뿐이라 앱 곳곳의 **세그먼트 컨트롤**이다
// (탭 줄·성경 리더의 목차/북마크/형광펜과 같은 짜임). 입력칸·버튼은 모임 화면과
// 한 벌(groupsParts)이고 라벨 붙은 칸도 그쪽 LabeledField다.
//
// **줄을 늘리지 않는다**(사용자 지적 2026-09-05 — "줄바꿈 제발 최소화"). 계정·직분은
// 라벨과 내용이 같은 줄에 서고, 칩이 넘치면 줄을 바꾸지 않고 가로로 스크롤한다
// (§8 — 같은 종류가 이어지는 줄에서는 허용).
// ============================================================================

// 버튼·입력칸은 모임 화면(groupsParts)과 한 벌이다. 여기 버튼은 전부 아이콘이 들어 WITH_ICON을 얹는다.
const FIELD = `min-w-0 ${FIELD_BASE}`;
const BTN = `${WITH_ICON} ${BTN_BASE}`;
const BTN_QUIET = `${WITH_ICON} ${BTN_QUIET_BASE}`;
const ROW = { borderBottom: '1px solid var(--app-line)' };
// 칩이 이어지는 줄 — 넘치면 wrap이 아니라 가로 스크롤이다(보드 상태 칩·프로젝트 탭과 같다).
const CHIP_ROW = 'flex items-center gap-1.5 flex-nowrap min-w-0 overflow-x-auto scrollbar-hide x-scroll-lock';

// 고를 수 있는 팀은 **사역 팀만**이다. CONFIG.TEAMS의 '임원진'·'교역자'는 팀이 아니라
// 직분이고, 명단에서는 아래 '직분' 줄이 그 자리를 맡는다(people_roles · is_pastor).
// 같은 이름이 팀 칩과 직분 칩에 둘 다 서면 어느 쪽을 눌러야 하는지 알 수 없다.
const TEAM_CHIPS = Object.entries(CONFIG.TEAMS).filter(([t]) => t.endsWith('팀'));

// 배지 색은 토큰만 쓴다. 교역자는 CONFIG.TEAMS의 '교역자'와 같은 계열로 맞춘다.
const BADGE_STYLE = {
  [PASTOR_LABEL]: 'bg-tag-red text-tag-red-fg',
  [ROLE_LABEL.director]: 'bg-tag-orange text-tag-orange-fg',
  [ROLE_LABEL.president]: 'bg-tag-yellow text-tag-yellow-fg',
  [ROLE_LABEL.treasurer]: 'bg-tag-blue text-tag-blue-fg',
  [ROLE_LABEL.lead_sunjang]: 'bg-tag-purple text-tag-purple-fg',
  [ROLE_LABEL.lead_team]: 'bg-tag-green text-tag-green-fg',
};

// '05-26' → '5월 26일'. 저장 값은 언제나 MM-DD다(0019·0035의 관례).
const birthdayLabel = (mmdd) => {
  const m = /^(\d{2})-(\d{2})$/.exec(String(mmdd || ''));
  return m ? `${+m[1]}월 ${+m[2]}일` : '';
};

const RowSkeleton = () => (
  <div className="flex items-center gap-2.5 py-2.5">
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-2 w-16 rounded" />
    </div>
  </div>
);

const Head = ({ title, count, children }) => (
  <div className="flex items-center gap-2 mb-2.5">
    <h3 className="text-[13px] font-bold text-fg shrink-0">{title}</h3>
    {count != null && <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{count}명</span>}
    <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
    {children}
  </div>
);

const Chip = ({ on, onClick, disabled, children, className = '' }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!on}
    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[11px] font-semibold border transition active:scale-95 disabled:opacity-40
      ${on ? `${className} border-transparent` : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
    {on && <Check size={11} className="shrink-0" />}{children}
  </button>
);

// 패널 안의 한 줄 — 왼쪽에 무엇에 대한 줄인지, 오른쪽에 내용. **줄을 나누지 않는다.**
const PanelRow = ({ label, sub, children }) => (
  <div className="flex items-start gap-2 min-w-0">
    <p className="shrink-0 w-[3.4rem] pt-1.5 text-[11px] font-semibold text-fg-muted">
      {label}{sub && <span className="block font-normal text-fg-faint tabular-nums">{sub}</span>}
    </p>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

// ── 사람 한 명의 입력 폼 (추가·수정 공용) ───────────────────────────────────
// 이름·생일·메모는 **한 줄에 셋**이고 라벨은 그 세 마디뿐이다. 세 칸이 무엇에 쓰이는지는
// 화면에 적지 않고 여기 적는다(사용자 결정 2026-09-05 — 설명 문장을 화면에서 뺐다.
// CLAUDE.md의 "안내·힌트 문구 줄을 임의로 추가하지 마세요"와 같은 자리다):
//   · 이름  = people.name. 출석·순 편성·모임이 이 사람을 부르는 이름이다. 계정이 연결된
//     사람은 앱의 다른 화면에서 **계정 표시명**으로 불린다(services/people.js의
//     withDisplayName) — 그래서 이 칸의 초깃값은 표시명이 아니라 roster_name이다.
//   · 생일  = people.birthday('MM-DD'. 태어난 해는 저장하지 않는다). 달력·대시보드의
//     생일 줄이 보는 값은 계정 쪽 profiles.birthday이고(§4.8), 0037이 계정이 연결된
//     사람 몫을 한 번 옮겨 담았다. 즉 이 칸은 명단이 들고 있는 값이다.
//   · 메모  = people.note. 지금 이 값을 읽어 그리는 화면은 여기뿐이고, 이 화면은
//     관리자만 들어온다(App의 members 메뉴 · MembersView의 isAdmin 게이트).
//
// **생일은 우리 데이트피커로 고른다**(사용자 지시 2026-09-05). 글자로 받던 자리다 —
// '예: 05-26' 안내와 '생일은 05-26처럼 적어주세요' 오류 줄이 같이 있었는데, 고르게
// 하면 틀린 값이 아예 만들어지지 않아 그 두 줄이 필요 없다. 연도는 없다(yearless).
function PersonForm({ initial = {}, submitLabel, onSubmit, onCancel, busy, withNote = false }) {
  // **계정이 연결된 사람은 initial.name이 계정 표시명이다**(people.js withDisplayName).
  // 그대로 두면 저장 한 번에 people.name이 표시명으로 덮여 0037이 실명으로 고친 것이
  // 되돌아간다(명단 '임재훈' → 표시명 '말감이'). 명단에 적힌 이름은 roster_name이다.
  const [name, setName] = useState(initial.roster_name || initial.name || '');
  const [birthday, setBirthday] = useState(initial.birthday || '');
  const [teams, setTeams] = useState(initial.teams || []);
  const [note, setNote] = useState(initial.note || '');

  // 고른 값은 이미 MM-DD이지만 한 번 더 통과시킨다 — 지난 시드·검사가 넣어 둔 '5-26'
  // 같은 값도 저장할 때 DB 체크(0035)와 같은 모양으로 맞춰진다.
  const parsed = parseBirthday(birthday);
  const ready = !!name.trim();
  const toggleTeam = (t) => setTeams(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));

  const submit = () => {
    if (!ready) return;
    onSubmit({ name: name.trim(), birthday: parsed.value, teams, ...(withNote ? { note: note.trim() || null } : {}) });
  };

  return (
    <div className="rounded-lg border border-line p-3 space-y-2.5" style={{ background: 'var(--app-surface)' }}>
      <div className="flex flex-wrap items-start gap-2">
        <LabeledField label="이름" className="flex-1 basis-[7rem] min-w-0">
          <input aria-label="이름" value={name} onChange={e => setName(e.target.value)} placeholder="이름"
            className={`${FIELD} w-full`} />
        </LabeledField>
        <LabeledField label="생일" className="shrink-0">
          <DatePicker value={parsed.value || ''} onChange={setBirthday} yearless ariaLabel="생일"
            triggerClassName={`${FIELD} ${WITH_ICON} w-[7.5rem] hover:bg-surface-hover`}>
            <CalendarDays size={13} className="text-fg-faint shrink-0" />
            <span className={parsed.value ? '' : 'text-fg-faint'}>
              {parsed.value ? birthdayLabel(parsed.value) : '생일 고르기'}
            </span>
          </DatePicker>
        </LabeledField>
        {withNote && (
          <LabeledField label="메모" className="flex-1 basis-[9rem] min-w-0">
            <input aria-label="메모" value={note} onChange={e => setNote(e.target.value)} placeholder="메모"
              className={`${FIELD} w-full`} />
          </LabeledField>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-fg-muted mb-1.5">
          소속 팀 <span className="font-normal text-fg-faint">여러 개 고를 수 있어요</span>
        </label>
        <div className={CHIP_ROW}>
          {TEAM_CHIPS.map(([t, color]) => (
            <Chip key={t} on={teams.includes(t)} onClick={() => toggleTeam(t)} className={color}>{t}</Chip>
          ))}
        </div>
      </div>

      {/* 도구 줄은 오른쪽 아래다 — 확정이 왼쪽, 나가기가 오른쪽 끝(§8. 저장한 순간
          손가락 밑의 버튼이 다른 뜻이 되지 않게 두 모드에서 자리가 같다). */}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={BTN} disabled={!ready || busy} onClick={submit}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{submitLabel}
        </button>
        <button type="button" className={BTN_QUIET} onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 계정 연결 ───────────────────────────────────────────────────────────────
// **이름이 같아도 자동으로 연결하지 않는다**(§6-26). 관리자가 목록에서 골라 연결한다.
// 후보가 없다는 것과 계정 목록을 아직 못 받았다는 것은 다른 말이다 —
// 그 갈래는 services/roster.js의 accountLinkState가 정한다(그 함수 주석에 왜가 있다).
function AccountRow({ person, linked, link, busy, onLink, onUnlink }) {
  const [pick, setPick] = useState(false);
  if (linked) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={linked.display_name} url={linked.avatar_url || null} className="flex w-6 h-6 text-[11px] shrink-0" />
        <span className="text-[12px] text-fg truncate">{linked.display_name || linked.email}</span>
        <button type="button" className={`${BTN_QUIET} ml-auto shrink-0`} disabled={busy} onClick={onUnlink}>
          <Link2Off size={13} /> 연결 해제
        </button>
      </div>
    );
  }
  if (link.status === 'loading') {
    return <Skeleton className="h-4 w-40 rounded my-1.5" />;
  }
  if (link.status === 'none') {
    return <p className="py-1.5 text-[11.5px] text-fg-faint">연결할 수 있는 가입자가 없어요</p>;
  }
  return pick ? (
    <div className="border border-line rounded-lg p-1.5 max-h-56 overflow-y-auto">
      {link.candidates.map(c => (
        <button key={c.id} type="button" disabled={busy} onClick={() => { setPick(false); onLink(c.id); }}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
          <Avatar name={c.display_name} url={c.avatar_url || null} className="flex w-7 h-7 text-xs shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] text-fg truncate">{c.display_name || '이름 없음'}</span>
            <span className="block text-[10.5px] text-fg-faint truncate">{c.email || ''}</span>
          </span>
        </button>
      ))}
      <button type="button" onClick={() => setPick(false)}
        className="w-full mt-1 py-2 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">닫기</button>
    </div>
  ) : (
    <button type="button" className={BTN_QUIET} onClick={() => setPick(true)} data-link-open={person.id}>
      <Link2 size={13} /> 계정 연결
    </button>
  );
}

// ── 한 사람을 펼쳤을 때 ─────────────────────────────────────────────────────
// **환송해주기는 패널 머리 오른쪽이다.** 맨 아래에 두었더니 저장·직분보다 아래에 있어
// 무엇을 하는 자리인지 흐렸다(사용자 지적 2026-09-05 — "환송해주기도 왜 밑에 있는거야").
// 위험한 동작이라 눈에는 띄어야 하지만 손이 지나가는 길에는 없어야 해서, 도구 줄
// (저장 왼쪽·취소 오른쪽 — §8)에서 떼어 머리줄의 보조 동작으로 둔다. 확인 팝오버는 그대로다.
function EditPanel({ person, linked, link, roleSet, year, busy, on }) {
  return (
    <div className="mt-2.5 space-y-3 pl-[42px]">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold text-fg-muted shrink-0">수정하기</p>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        <ConfirmPopover
          message={`${person.name}${objectParticle(person.name)} 환송할까요? 지난 출석 기록은 그대로 남아요.`}
          confirmLabel="환송" onConfirm={() => on.remove(person, true)}>
          <button type="button" className={`${BTN_QUIET} shrink-0 hover:text-tag-red-fg`} disabled={busy}>
            <UserX size={13} /> 환송해주기
          </button>
        </ConfirmPopover>
      </div>

      <PersonForm initial={person} submitLabel="저장" busy={busy} withNote
        onSubmit={(patch) => on.save(person, patch)} onCancel={() => on.close()} />

      <PanelRow label="계정">
        <AccountRow person={person} linked={linked} link={link} busy={busy}
          onLink={(profileId) => on.link(person, profileId)} onUnlink={() => on.link(person, null)} />
      </PanelRow>

      <PanelRow label="직분" sub={`${year}년`}>
        <div className={`${CHIP_ROW} py-0.5`}>
          {/* 교역자만 연도와 무관한 명단 속성이다(people.is_pastor) */}
          <Chip on={!!person.is_pastor} disabled={busy} className={BADGE_STYLE[PASTOR_LABEL]}
            onClick={() => on.pastor(person, !person.is_pastor)}>{PASTOR_LABEL}</Chip>
          {YEAR_ROLES.map(r => (
            <Chip key={r} on={roleSet.has(r)} disabled={busy} className={BADGE_STYLE[ROLE_LABEL[r]]}
              onClick={() => on.role(person, r, !roleSet.has(r))}>{ROLE_LABEL[r]}</Chip>
          ))}
        </div>
      </PanelRow>
    </div>
  );
}

// ── 명단 한 줄 ──────────────────────────────────────────────────────────────
function PersonRow({ person, linked, sun, badges, open, busy, right, children, onOpen }) {
  const meta = [];
  const bday = birthdayLabel(person.birthday);
  if (bday) meta.push(bday);
  if (person.teams?.length) meta.push(person.teams.join(' · '));

  return (
    <div data-person={person.id} className="py-2.5" style={ROW}>
      <div className="flex items-center gap-2.5">
        <Avatar name={person.name} url={linked?.avatar_url || null} className="flex w-8 h-8 text-[13px] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-semibold text-fg truncate">{person.name}</span>
            {linked && <Link2 size={11} aria-label="계정 연결됨" className="text-fg-faint shrink-0" />}
            {badges.map(b => (
              <span key={b} data-badge={b}
                className={`shrink-0 px-1.5 py-px rounded-xs text-[10px] font-bold ${BADGE_STYLE[b] || 'bg-tag-gray text-tag-gray-fg'}`}>{b}</span>
            ))}
          </p>
          <p className="text-[10.5px] text-fg-faint truncate">
            {meta.join(' · ')}
            {sun && <>{meta.length ? ' · ' : ''}<span data-sun={sun}>{sun}</span></>}
          </p>
        </div>
        {right ?? (
          <button type="button" onClick={onOpen} disabled={busy}
            className={`${BTN_QUIET} shrink-0`} aria-expanded={!!open}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : (open ? <X size={13} /> : <Pencil size={13} />)}
            {open ? '닫기' : '수정하기'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── 명단 구역 전체 ──────────────────────────────────────────────────────────
export function RosterPanel({
  people = [], roles = [], suns = [], groupMembers = [], profiles = [], profilesReady = true,
  year, years = [], busy = {}, loading = false, on = {},
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);

  const roleMap = useMemo(() => rolesByPerson(roles), [roles]);
  const sunMap = useMemo(() => sunNames(suns, groupMembers), [suns, groupMembers]);
  const profileById = useMemo(() => new Map((profiles || []).map(p => [p.id, p])), [profiles]);
  const link = useMemo(
    () => accountLinkState({ profiles, people, ready: profilesReady }),
    [profiles, people, profilesReady],
  );

  // 검색은 환송한 사람에게도 걸린다 — 한쪽만 걸면 이름을 쳤는데 엉뚱한 사람이 남는다.
  // 구역 머리의 숫자는 **지금 보이는 줄 수**다(찾는 중에는 찾은 만큼).
  const here = useMemo(() => people.filter(p => !p.removed_at), [people]);
  const gone = useMemo(() => people.filter(p => p.removed_at), [people]);
  const shown = useMemo(() => searchPeople(here, q), [here, q]);
  const shownGone = useMemo(() => searchPeople(gone, q), [gone, q]);

  const handlers = {
    close: () => setOpenId(null),
    save: async (p, patch) => { if (await on.save?.(p, patch)) setOpenId(null); },
    link: (p, profileId) => on.link?.(p, profileId),
    pastor: (p, next) => on.pastor?.(p, next),
    role: (p, role, next) => on.role?.(p, role, next),
    remove: async (p, next) => { await on.remove?.(p, next); setOpenId(null); },
  };

  return (
    <section className="dc-screen">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* 이름으로 찾기 — 성경 리더의 검색 폼과 같은 모양이다(wordBible.jsx) */}
        <div className="flex-1 basis-[11rem] min-w-0 flex items-center gap-1.5 px-2.5 h-9 rounded-md"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
          <Search size={14} className="shrink-0 text-fg-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름으로 찾기" aria-label="이름으로 찾기"
            className="flex-1 min-w-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-faint outline-none" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="검색어 지우기"
              className="shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors"><X size={13} /></button>
          )}
        </div>
        {/* 연도 — 고를 값이 셋뿐이라 세그먼트 컨트롤이다(탭 줄과 같은 짜임) */}
        <span role="group" aria-label="연도" className="flex p-[3px] rounded-[8px] shrink-0"
          style={{ background: 'var(--app-surface-hover)' }}>
          {years.map(y => (
            <button key={y} type="button" data-year={y} onClick={() => on.year?.(y)} aria-pressed={year === y}
              className="px-2.5 py-[6px] rounded-[5px] text-[12px] font-semibold tabular-nums transition-colors"
              style={{
                background: year === y ? 'var(--app-surface)' : 'transparent',
                color: year === y ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{y}</button>
          ))}
        </span>
        <button type="button" className={`${BTN} shrink-0`} onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> 사람 추가
        </button>
      </div>

      {adding && (
        <div className="mb-4">
          <PersonForm submitLabel="추가" busy={!!busy.add}
            onSubmit={async (row) => { if (await on.add?.(row)) setAdding(false); }}
            onCancel={() => setAdding(false)} />
        </div>
      )}

      <Head title="청년 명단" count={loading ? null : shown.length} />
      {loading ? (
        <><RowSkeleton /><RowSkeleton /><RowSkeleton /></>
      ) : shown.length === 0 ? (
        <p className="py-6 text-[12.5px] text-fg-muted">
          {q ? `'${q}'와 이름이 맞는 사람을 못 찾았어요` : '청년 명단이 아직 비어 있어요'}
        </p>
      ) : shown.map(p => {
        const roleSet = roleMap.get(p.id) || new Set();
        const open = openId === p.id;
        return (
          <PersonRow key={p.id} person={p} linked={profileById.get(p.profile_id)}
            sun={(sunMap.get(p.id) || []).join(', ')} badges={personBadges(p, roleSet)}
            open={open} busy={!!busy[p.id]} onOpen={() => setOpenId(open ? null : p.id)}>
            {open && (
              <EditPanel person={p} linked={profileById.get(p.profile_id)} link={link}
                roleSet={roleSet} year={year} busy={!!busy[p.id]} on={handlers} />
            )}
          </PersonRow>
        );
      })}

      {shownGone.length > 0 && (
        <div className="mt-7" data-removed-section="">
          <Head title="환송한 사람" count={shownGone.length} />
          {shownGone.map(p => (
            <PersonRow key={p.id} person={p} linked={profileById.get(p.profile_id)}
              sun={(sunMap.get(p.id) || []).join(', ')} badges={personBadges(p, roleMap.get(p.id) || new Set())}
              busy={!!busy[p.id]} right={
                <button type="button" className={`${BTN_QUIET} shrink-0`} disabled={!!busy[p.id]}
                  onClick={() => on.remove?.(p, false)}>
                  {busy[p.id] ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} 되돌리기
                </button>
              } />
          ))}
        </div>
      )}
    </section>
  );
}
