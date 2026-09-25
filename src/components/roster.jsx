import { useMemo, useState } from 'react';
import { Plus, Check, Link2, Link2Off, UserX, Undo2, Loader2, Pencil, X, Search, CalendarDays } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { Skeleton } from './media.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { DatePicker } from './DatePicker.jsx';
import { BTN as BTN_BASE, BTN_QUIET as BTN_QUIET_BASE, FIELD as FIELD_BASE, WITH_ICON, LabeledField, FailLeft } from './groupsParts.jsx';
import { CONFIG, teamColor, teamBgColor } from '../config.js';
import { objectParticle } from '../services/errorText.js';
import {
  ROLE_LABEL, YEAR_ROLES, PASTOR_LABEL, GENDERS, GENDER_LABEL,
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
// **줄을 늘리지 않는다**(사용자 지적 2026-09-05 — "줄바꿈 제발 최소화"). 계정·성별·직분은
// 라벨과 내용이 같은 줄에 서고, 칩이 넘치면 줄을 바꾸지 않고 가로로 스크롤한다
// (§8 — 같은 종류가 이어지는 줄에서는 허용). 성별은 칩이 둘뿐이라 375px에서도 안 넘친다.
// ============================================================================

// 버튼·입력칸은 모임 화면(groupsParts)과 한 벌이다. 여기 버튼은 전부 아이콘이 들어 WITH_ICON을 얹는다.
const FIELD = `min-w-0 ${FIELD_BASE}`;
const BTN = `${WITH_ICON} ${BTN_BASE}`;
const BTN_QUIET = `${WITH_ICON} ${BTN_QUIET_BASE}`;
const ROW = { borderBottom: '1px solid var(--app-line)' };
// 칩이 이어지는 줄 — 넘치면 wrap이 아니라 가로 스크롤이다(보드 상태 칩·프로젝트 탭과 같다).
// 끝까지 밀면 마지막 칩이 통 끝에 딱 붙어 답답했다(사용자 지적 2026-09-07) — 마지막에
// 12px을 세워 여백을 남긴다. **스크롤 통의 padding-right로는 안 된다**: 넘쳐 흐른 내용에는
// 그 여백이 안 걸린다(§6-2와 같은 이유). 그래서 ::after를 flex 항목 하나로 세운다.
// views/views.jsx의 TEAM_CHIP_ROW(팀 보드 사람 칩)와 같은 한 벌이다.
const CHIP_ROW = 'flex items-center gap-1.5 flex-nowrap min-w-0 overflow-x-auto scrollbar-hide x-scroll-lock'
  + " after:content-[''] after:shrink-0 after:w-3";

// 고를 수 있는 것: **사역 팀 + 순 자리(순장·순원)**. 순장·순원은 2026-09-22에 열었다
// (그전에는 `t.endsWith('팀')` 하나여서 명단에서 고를 데가 아예 없었다).
//
// **`임원진`·`교역자`는 여기 없다** — 둘 다 직분이고 아래 '직분' 줄이 맡는다
// (임원진은 그 해 `people_roles`, 교역자는 `people.is_pastor`). 같은 글자가 두 줄에
// 서면 어느 쪽을 눌러야 하는지 알 수 없다 — 2026-09-22에 교역자를 잠깐 여기 넣었다가
// 사용자 결정으로 **도로 뺐다**(직분 줄에 그대로 둔다).
//
// 계정 쪽 소속(`profile_teams`)의 교역자는 **직분 토글이 정한다**(0069) — 여기서 고르지
// 않아도 is_pastor를 끄면 계정에서도 빠진다. 배현민 계정이 교역자로 굳어 있던 자리다.
const EXTRA_SEATS = ['순장', '순원'];
const TEAM_CHIPS = Object.entries(CONFIG.TEAMS).filter(([t]) => t.endsWith('팀') || EXTRA_SEATS.includes(t));

// 배지 색은 토큰만 쓴다. 교역자는 CONFIG.TEAMS의 '교역자'와 같은 계열로 맞춘다.
const BADGE_STYLE = {
  [PASTOR_LABEL]: 'bg-tag-red text-tag-red-fg',
  [ROLE_LABEL.director]: 'bg-tag-orange text-tag-orange-fg',
  [ROLE_LABEL.president]: 'bg-tag-yellow text-tag-yellow-fg',
  [ROLE_LABEL.treasurer]: 'bg-tag-blue text-tag-blue-fg',
  [ROLE_LABEL.lead_sunjang]: 'bg-tag-purple text-tag-purple-fg',
  [ROLE_LABEL.lead_team]: 'bg-tag-green text-tag-green-fg',
};

// 성별 칩도 같은 토큰 표를 쓴다. 자매의 pink는 직분 배지가 안 쓰는 색이고, 형제의 blue는
// 총무와 같은 계열이지만 줄이 달라 나란히 서지 않는다(라벨이 '성별'·'직분'으로 갈린다).
const GENDER_STYLE = { m: 'bg-tag-blue text-tag-blue-fg', f: 'bg-tag-pink text-tag-pink-fg' };

// '05-26' → '5월 26일'. 저장 값은 언제나 MM-DD다(0019·0035의 관례).
const birthdayLabel = (mmdd) => {
  const m = /^(\d{2})-(\d{2})$/.exec(String(mmdd || ''));
  return m ? `${+m[1]}월 ${+m[2]}일` : '';
};

// 명단 한 줄 자리(가입자 탭 membersView도 같은 것을 쓴다).
export const RowSkeleton = () => (
  <div className="flex items-center gap-2.5 py-2.5">
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-2 w-16 rounded" />
    </div>
  </div>
);

// 줄 등장 지연(ms). 상한을 둔다 — 명단은 쉰 줄이 넘어서 순번을 끝까지 주면 아래쪽이
// 1.5초 뒤에 뜬다. stagger는 useEnterStagger()의 값(첫 마운트에만 참). membersView도 쓴다.
export const rowDelay = (i, stagger) => (stagger ? Math.min(i, 12) * 30 : 0);

const Head = ({ title, count, children }) => (
  <div className="flex items-center gap-2 mb-2.5">
    <h3 className="text-[13px] font-bold text-fg shrink-0">{title}</h3>
    {count != null && <span className="text-[11px] text-fg-muted tabular-nums shrink-0">{count}명</span>}
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
      {label}{sub && <span className="block font-normal text-fg-muted tabular-nums">{sub}</span>}
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
          소속 <span className="font-normal text-fg-muted">여러 개 고를 수 있어요</span>
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
    return <p className="py-1.5 text-[11.5px] text-fg-muted">연결할 수 있는 가입자가 없어요</p>;
  }
  return pick ? (
    <div className="border border-line rounded-lg p-1.5 max-h-56 overflow-y-auto">
      {link.candidates.map(c => (
        <button key={c.id} type="button" disabled={busy} onClick={() => { setPick(false); onLink(c.id); }}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
          <Avatar name={c.display_name} url={c.avatar_url || null} className="flex w-7 h-7 text-xs shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] text-fg truncate">{c.display_name || '이름 미입력'}</span>
            <span className="block text-[10.5px] text-fg-muted truncate">{c.email || ''}</span>
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

// ── 가입자 → 청년 명단 잇기 (사용자 결정 2026-09-25 · 목업 mockup-traces 7 권장안) ─────────
// 멤버 화면 '가입자' 탭에서 쓴다 — 가입을 수락한 줄 아래(또는 '명단 미연결' 칩을 누른 줄 아래)에 펴진다.
// 자리·모양은 계정 합치기 판과 같은 below 판이다. 위 AccountRow(사람 → 계정)의 반대 방향이다(계정 → 사람).
//   · 후보 = 아직 계정이 없는 명단 사람(환송 제외) · **이름순 그대로** — 이름이 비슷한 순으로 올리지 않는다
//     (계정 이름과 명단 본명이 다른 경우가 많다 — 꽃님/강꽃님)
//   · **미리 골라 두지 않는다** — 이름이 같아도 자동으로 잇지 않는다(§6-26). 누르면 **바로** 잇는다
//     (AccountRow와 같은 방식 · 되돌리기는 명단의 '연결 해제')
//   · 통신은 부르는 쪽(membersView)이 한다 — 여기는 props만 그린다(파일 머리말)
export function ProfileLinkPanel({ account, people = [], ready = true, busy = false, onLink, onClose }) {
  const [q, setQ] = useState('');
  const unlinked = useMemo(() => (people || []).filter(p => !p.profile_id && !p.removed_at), [people]);
  const shown = useMemo(() => searchPeople(unlinked, q), [unlinked, q]);
  return (
    <div data-link-panel={account.id} className="members-link-pick mt-2 border border-line rounded-lg p-1.5">
      <p className="flex items-baseline gap-2 px-2 pt-1 pb-1.5">
        <span className="text-[12px] font-bold text-fg">청년 명단과 잇기</span>
        {ready && <span className="text-[11px] text-fg-muted tabular-nums">미연결 {unlinked.length}명</span>}
      </p>
      {/* 이름으로 찾기 — 명단 탭의 찾기 칸과 같은 모양(성경 리더 검색 폼 한 벌) */}
      <div className="mx-1 mb-1 flex items-center gap-1.5 px-2.5 h-9 rounded-md"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
        <Search size={14} className="shrink-0 text-fg-faint" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름으로 찾기" aria-label="이름으로 찾기"
          className="flex-1 min-w-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-faint outline-none" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="검색어 지우기"
            className="shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors"><X size={13} /></button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {!ready ? (
          <Skeleton className="h-4 w-40 rounded my-2 mx-2" />
        ) : shown.map(p => (
          <button key={p.id} type="button" disabled={busy} onClick={() => onLink(p)} data-link-person={p.id}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
            <span className="min-w-0 truncate text-[12.5px] font-semibold text-fg">{p.name}</span>
            {GENDER_LABEL[p.gender] && <span className="shrink-0 text-[11px] text-fg-muted">{GENDER_LABEL[p.gender]}</span>}
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {(p.teams || []).map(t => (
                <span key={t} className="px-1.5 py-px rounded-xs text-[10px] font-bold"
                  style={{ background: teamBgColor(t), color: teamColor(t) }}>{t}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onClose}
        className="w-full mt-1 py-2 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">닫기</button>
    </div>
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

      {/* 성별 — 호칭을 '형제/자매'로 부르기 위한 칸이다(0064 · 사용자 결정 2026-09-14).
          **켠 칩을 다시 누르면 꺼진다**(null): 잘못 눌렀을 때 돌아갈 길이 있어야 하고,
          비어 있는 것이 정상 상태다(그동안은 '청년'으로 부른다). 자격·부품·모양은 아래
          직분 줄과 같고, 연도와 무관한 명단 속성이라 sub(연도)가 없다. */}
      <PanelRow label="성별">
        <div className={`${CHIP_ROW} py-0.5`}>
          {GENDERS.map(g => (
            <Chip key={g} on={person.gender === g} disabled={busy} className={GENDER_STYLE[g]}
              onClick={() => on.gender(person, person.gender === g ? null : g)}>{GENDER_LABEL[g]}</Chip>
          ))}
        </div>
      </PanelRow>

      <PanelRow label="직분" sub={`${year}년`}>
        {/* `data-roles`: 직분 줄을 집는 표. 2026-09-22에 소속 줄에도 '교역자'를 잠깐 넣었다가
            검사가 엉뚱한 칩을 눌러 깨졌다 — 칩은 도로 뺐지만 이 표는 남긴다(글자로 찾는
            검사는 같은 이름이 하나만 있다는 가정에 기대고, 그 가정은 또 깨진다). */}
        <div data-roles className={`${CHIP_ROW} py-0.5`}>
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
// 줄 등장은 앱의 관례대로 `.dc-row` + 순번 지연이고, **순번은 첫 마운트에만** 준다
// (useEnterStagger 주석 — 검색으로 목록이 갈릴 때 뒤늦게 나타나는 줄이 생기면 안 된다).
function PersonRow({ person, linked, sun, badges, open, busy, right, children, delay = 0, onOpen }) {
  const meta = [];
  const bday = birthdayLabel(person.birthday);
  if (bday) meta.push(bday);
  if (person.teams?.length) meta.push(person.teams.join(' · '));

  return (
    <div data-person={person.id} className="dc-row py-2.5" style={{ ...ROW, animationDelay: `${delay}ms` }}>
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
          <p className="text-[10.5px] text-fg-muted truncate">
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
  year, years = [], busy = {}, loading = false, on = {}, failed = null,
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

  // 줄 등장 순번은 **첫 마운트에만**이다 — 검색으로 목록이 갈릴 때 지연을 주면 새로
  // 걸린 줄만 몇백 ms 뒤에 나타난다(useEnterStagger 주석). 지연 상한도 둔다:
  // 명단은 쉰 줄이 넘어서 순번을 끝까지 주면 아래쪽이 1.5초 뒤에 뜬다.
  const stagger = useEnterStagger();

  const handlers = {
    close: () => setOpenId(null),
    save: async (p, patch) => { if (await on.save?.(p, patch)) setOpenId(null); },
    link: (p, profileId) => on.link?.(p, profileId),
    gender: (p, next) => on.gender?.(p, next),
    pastor: (p, next) => on.pastor?.(p, next),
    role: (p, role, next) => on.role?.(p, role, next),
    remove: async (p, next) => { await on.remove?.(p, next); setOpenId(null); },
  };

  return (
    <section className="dc-screen">
      {/* 줄을 **정해서** 그린다 — flex-wrap에 맡겨 두었더니 375~430px에서 '사람 추가'만
          다음 줄로 떨어져 왼쪽에 혼자 섰다(사용자 지적 2026-09-07).
          모바일: [찾기 + 사람 추가] / [연도]  ·  ≥640: [찾기 + 연도 + 사람 추가] 한 줄.
          연도만 `basis-full`로 둘째 줄을 차지하고, 그 안의 세그먼트는 감싸개 덕에
          내용 폭 그대로다(basis-full을 세그먼트에 직접 주면 배경이 화면을 가로지른다). */}
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
        <button type="button" className={`${BTN} shrink-0 whitespace-nowrap sm:order-3`} onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> 사람 추가
        </button>
        {/* 연도 — 고를 값이 셋뿐이라 세그먼트 컨트롤이다(탭 줄과 같은 짜임) */}
        <div className="flex shrink-0 basis-full sm:basis-auto sm:order-2">
          <span role="group" aria-label="연도" className="flex p-[3px] rounded-md shrink-0"
            style={{ background: 'var(--app-surface-hover)' }}>
            {years.map(y => (
              <button key={y} type="button" data-year={y} onClick={() => on.year?.(y)} aria-pressed={year === y}
                className="px-2.5 py-[6px] rounded-sm text-[12px] font-semibold tabular-nums transition-colors"
                style={{
                  background: year === y ? 'var(--app-surface)' : 'transparent',
                  color: year === y ? 'var(--app-ink)' : 'var(--app-ink-muted)',
                }}>{y}</button>
            ))}
          </span>
        </div>
      </div>

      {adding && (
        <div className="mb-4">
          <PersonForm submitLabel="추가" busy={!!busy.add}
            onSubmit={async (row) => { if (await on.add?.(row)) setAdding(false); }}
            onCancel={() => setAdding(false)} />
        </div>
      )}

      <Head title="청년 명단" count={loading || failed ? null : shown.length} />
      {/* 못 받았다(D2) — 빈 문구 자리에 실패 두 줄 + '다시 시도'. 목록이 왼쪽 정렬이라 이것도 왼쪽이다 */}
      {failed ? (
        <FailLeft className="roster-load-failed" title={failed.title} reason={failed.reason} onRetry={failed.onRetry} />
      ) : loading ? (
        <><RowSkeleton /><RowSkeleton /><RowSkeleton /></>
      ) : shown.length === 0 ? (
        <p className="py-6 text-[12.5px] text-fg-muted">
          {q ? `'${q}'와 이름이 맞는 사람을 못 찾았어요` : '청년 명단이 아직 비어 있어요'}
        </p>
      ) : shown.map((p, i) => {
        const roleSet = roleMap.get(p.id) || new Set();
        const open = openId === p.id;
        return (
          <PersonRow key={p.id} person={p} linked={profileById.get(p.profile_id)}
            sun={(sunMap.get(p.id) || []).join(', ')} badges={personBadges(p, roleSet)}
            open={open} busy={!!busy[p.id]} delay={rowDelay(i, stagger)} onOpen={() => setOpenId(open ? null : p.id)}>
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
          {shownGone.map((p, i) => (
            <PersonRow key={p.id} person={p} linked={profileById.get(p.profile_id)}
              sun={(sunMap.get(p.id) || []).join(', ')} badges={personBadges(p, roleMap.get(p.id) || new Set())}
              busy={!!busy[p.id]} delay={rowDelay(i, stagger)} right={
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
