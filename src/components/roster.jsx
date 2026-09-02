import React, { useMemo, useState } from 'react';
import { Plus, Check, Link2, Link2Off, UserX, Undo2, Loader2, Pencil, X } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { Skeleton } from './media.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { BTN as BTN_BASE, BTN_QUIET as BTN_QUIET_BASE, FIELD as FIELD_BASE, WITH_ICON } from './groupsParts.jsx';
import { CONFIG } from '../config.js';
import { objectParticle } from '../services/errorText.js';
import {
  ROLE_LABEL, YEAR_ROLES, PASTOR_LABEL,
  parseBirthday, searchPeople, unlinkedProfiles, sunNames, rolesByPerson, personBadges,
} from '../services/roster.js';

// ============================================================================
// 명단 구역의 부품 — 멤버 화면(views/membersView.jsx)의 '명단' 탭이 쓴다
// ----------------------------------------------------------------------------
// **props로 받은 것만 그린다.** 통신(조회·저장)은 전부 membersView가 하고 여기는
// 화면만 만든다 — 그래야 게스트 스위트가 가짜 명단을 심어 이 화면을 그대로 눌러
// 볼 수 있다(tests/roster.mjs · services/word·worship와 같은 방식).
//
// 사진은 **계정이 이어진 사람만**이다. url을 null로 못 박아 이름으로 사진을 찾는
// 길(Avatar의 기본 동작)을 아예 닫는다 — 이름으로 사람을 매다는 방식은 §6-26에서
// 이미 깨졌고, 명단에는 동명이인이 생길 수 있다.
//
// 행을 지우는 버튼은 없다. 환송(removed_at)만 있고 되돌릴 수 있다 — 출석 기록이
// person_id로 매달려 있다(services/roster.js 머리말).
// ============================================================================

// 버튼·입력칸은 모임 화면(groupsParts)과 한 벌이다. 여기 버튼은 전부 아이콘이 들어 WITH_ICON을 얹는다.
const FIELD = `min-w-0 ${FIELD_BASE}`;
const BTN = `${WITH_ICON} ${BTN_BASE}`;
const BTN_QUIET = `${WITH_ICON} ${BTN_QUIET_BASE}`;
const ROW = { borderBottom: '1px solid var(--app-line)' };

// 고를 수 있는 팀은 **사역 팀만**이다. CONFIG.TEAMS의 '임원진'·'교역자'는 팀이 아니라
// 직분이고, 명단에서는 아래 '직분' 줄이 그 자리를 맡는다(people_roles · is_pastor).
// 같은 이름이 팀 칩과 직분 칩에 둘 다 서면 어느 쪽을 눌러야 하는지 알 수 없다.
const TEAM_CHIPS = Object.entries(CONFIG.TEAMS).filter(([t]) => t.endsWith('팀'));

// 배지 색은 토큰만 쓴다. 교역자는 CONFIG.TEAMS의 '교역자'와 같은 계열로 맞춘다.
const BADGE_STYLE = {
  [PASTOR_LABEL]: 'bg-tag-red text-tag-red-fg',
  [ROLE_LABEL.president]: 'bg-tag-yellow text-tag-yellow-fg',
  [ROLE_LABEL.lead_sunjang]: 'bg-tag-purple text-tag-purple-fg',
  [ROLE_LABEL.officer]: 'bg-tag-blue text-tag-blue-fg',
};

// '05-26' → '5월 26일'. 저장 값은 언제나 MM-DD다(0019·0035의 관례).
export const birthdayLabel = (mmdd) => {
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
    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[11px] font-semibold border transition active:scale-95 disabled:opacity-40
      ${on ? `${className} border-transparent` : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
    {on && <Check size={11} className="shrink-0" />}{children}
  </button>
);

// ── 사람 한 명의 입력 폼 (추가·수정 공용) ───────────────────────────────────
function PersonForm({ initial = {}, submitLabel, onSubmit, onCancel, busy, withNote = false }) {
  const [name, setName] = useState(initial.name || '');
  const [birthday, setBirthday] = useState(initial.birthday || '');
  const [teams, setTeams] = useState(initial.teams || []);
  const [note, setNote] = useState(initial.note || '');

  const parsed = parseBirthday(birthday);
  const ready = !!name.trim() && parsed.ok;
  const toggleTeam = (t) => setTeams(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));

  const submit = () => {
    if (!ready) return;
    onSubmit({ name: name.trim(), birthday: parsed.value, teams, ...(withNote ? { note: note.trim() || null } : {}) });
  };

  return (
    <div className="rounded-lg border border-line p-3 space-y-2.5" style={{ background: 'var(--app-surface)' }}>
      <div className="flex flex-wrap gap-2">
        <input aria-label="이름" value={name} onChange={e => setName(e.target.value)} placeholder="이름"
          className={`${FIELD} flex-1 basis-[8rem]`} />
        <input aria-label="생일" value={birthday} onChange={e => setBirthday(e.target.value)} placeholder="예: 05-26"
          className={`${FIELD} w-[6.5rem] shrink-0`}
          style={parsed.ok ? undefined : { borderColor: 'var(--app-tag-red-fg)' }} />
      </div>
      {!parsed.ok && <p className="text-[11px]" style={{ color: 'var(--app-tag-red-fg)' }}>생일은 05-26처럼 적어주세요</p>}

      <div>
        <label className="block text-[11px] font-semibold text-fg-muted mb-1.5">
          소속 팀 <span className="font-normal text-fg-faint">여러 개 고를 수 있어요</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {TEAM_CHIPS.map(([t, color]) => (
            <Chip key={t} on={teams.includes(t)} onClick={() => toggleTeam(t)} className={color}>{t}</Chip>
          ))}
        </div>
      </div>

      {withNote && (
        <input aria-label="메모" value={note} onChange={e => setNote(e.target.value)} placeholder="메모"
          className={`${FIELD} w-full`} />
      )}

      <div className="flex items-center gap-2">
        <button type="button" className={BTN} disabled={!ready || busy} onClick={submit}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{submitLabel}
        </button>
        <button type="button" className={BTN_QUIET} onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 계정 연결 ───────────────────────────────────────────────────────────────
// **이름이 같아도 자동으로 잇지 않는다**(§6-26). 관리자가 목록에서 골라 잇는다.
function AccountRow({ person, linked, candidates, busy, onLink, onUnlink }) {
  const [pick, setPick] = useState(false);
  if (linked) {
    return (
      <div className="flex items-center gap-2">
        <Avatar name={linked.display_name} url={linked.avatar_url || null} className="flex w-6 h-6 text-[11px] shrink-0" />
        <span className="text-[12px] text-fg truncate">{linked.display_name || linked.email}</span>
        <button type="button" className={`${BTN_QUIET} ml-auto shrink-0`} disabled={busy} onClick={onUnlink}>
          <Link2Off size={13} /> 연결 해제
        </button>
      </div>
    );
  }
  if (!candidates.length) {
    return <p className="text-[11.5px] text-fg-faint">가입한 계정이 모두 명단에 이어져 있어요</p>;
  }
  return pick ? (
    <div className="border border-line rounded-lg p-1.5 max-h-56 overflow-y-auto">
      {candidates.map(c => (
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
      <Link2 size={13} /> 계정 잇기
    </button>
  );
}

// ── 한 사람을 펼쳤을 때 ─────────────────────────────────────────────────────
function EditPanel({ person, linked, candidates, roleSet, year, busy, on }) {
  return (
    <div className="mt-2.5 space-y-3 pl-[42px]">
      <PersonForm initial={person} submitLabel="저장" busy={busy} withNote
        onSubmit={(patch) => on.save(person, patch)} onCancel={() => on.close()} />

      <div>
        <p className="text-[11px] font-semibold text-fg-muted mb-1.5">계정</p>
        <AccountRow person={person} linked={linked} candidates={candidates} busy={busy}
          onLink={(profileId) => on.link(person, profileId)} onUnlink={() => on.link(person, null)} />
      </div>

      <div>
        <p className="text-[11px] font-semibold text-fg-muted mb-1.5">
          직분 <span className="font-normal text-fg-faint">{year}년</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {/* 교역자만 연도와 무관한 명단 속성이다(people.is_pastor) */}
          <Chip on={!!person.is_pastor} disabled={busy} className={BADGE_STYLE[PASTOR_LABEL]}
            onClick={() => on.pastor(person, !person.is_pastor)}>{PASTOR_LABEL}</Chip>
          {YEAR_ROLES.map(r => (
            <Chip key={r} on={roleSet.has(r)} disabled={busy} className={BADGE_STYLE[ROLE_LABEL[r]]}
              onClick={() => on.role(person, r, !roleSet.has(r))}>{ROLE_LABEL[r]}</Chip>
          ))}
        </div>
      </div>

      <ConfirmPopover
        message={`${person.name}${objectParticle(person.name)} 환송할까요? 지난 출석 기록은 그대로 남아요.`}
        confirmLabel="환송" onConfirm={() => on.remove(person, true)}>
        <button type="button" className={`${BTN_QUIET} hover:text-tag-red-fg`} disabled={busy}>
          <UserX size={13} /> 환송해주기
        </button>
      </ConfirmPopover>
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
            {open ? '닫기' : '고치기'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── 명단 구역 전체 ──────────────────────────────────────────────────────────
export function RosterPanel({
  people = [], roles = [], suns = [], groupMembers = [], profiles = [],
  year, years = [], busy = {}, loading = false, on = {},
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);

  const roleMap = useMemo(() => rolesByPerson(roles), [roles]);
  const sunMap = useMemo(() => sunNames(suns, groupMembers), [suns, groupMembers]);
  const profileById = useMemo(() => new Map((profiles || []).map(p => [p.id, p])), [profiles]);
  const candidates = useMemo(() => unlinkedProfiles(profiles, people), [profiles, people]);

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
        <input aria-label="이름으로 찾기" value={q} onChange={e => setQ(e.target.value)} placeholder="이름으로 찾기"
          className={`${FIELD} flex-1 basis-[9rem]`} />
        <select aria-label="연도" value={year} onChange={e => on.year?.(Number(e.target.value))}
          className={`${FIELD} shrink-0`}>
          {years.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
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

      <Head title="명단" count={shown.length} />
      {loading ? (
        <><RowSkeleton /><RowSkeleton /><RowSkeleton /></>
      ) : shown.length === 0 ? (
        <p className="py-6 text-[12.5px] text-fg-muted">
          {q ? `'${q}'와 이름이 맞는 사람을 못 찾았어요` : '명단이 아직 비어 있어요'}
        </p>
      ) : shown.map(p => {
        const roleSet = roleMap.get(p.id) || new Set();
        const open = openId === p.id;
        return (
          <PersonRow key={p.id} person={p} linked={profileById.get(p.profile_id)}
            sun={(sunMap.get(p.id) || []).join(', ')} badges={personBadges(p, roleSet)}
            open={open} busy={!!busy[p.id]} onOpen={() => setOpenId(open ? null : p.id)}>
            {open && (
              <EditPanel person={p} linked={profileById.get(p.profile_id)} candidates={candidates}
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
