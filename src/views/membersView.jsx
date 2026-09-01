import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck, UserX, ShieldCheck, Shield, Plus, Loader2 } from 'lucide-react';
import { Avatar } from '../components/Avatar.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { RosterPanel } from '../components/roster.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText, objectParticle } from '../services/errorText.js';
import { agoLabel, visitOrder } from '../utils.js';
import { usePresence } from '../services/presence.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import * as cloud from '../services/cloud.js';
import { isCloudEnabled } from '../services/supabaseClient.js';
import * as roster from '../services/roster.js';

// ============================================================================
// 전역 '멤버' 화면 — 관리자만 (0022)
// ----------------------------------------------------------------------------
// 사용자가 "전역 화면 신설"로 정했다. 대시보드의 '가입한 사람' 목록(MembersModal)은
// **누가 있는지 보는 자리**로 그대로 두고, 여기는 **손을 대는 자리**다.
//
// 네 가지만 한다. 승인 대기 수락 · 환송해주기 · 다시 초대하기 · 관리자 지정·해제.
// '환송해주기'는 접근만 끊는다(0022) — 지난 댓글·기록의 이름은 그대로 남는다.
// 환송한 사람은 '승인을 기다리는 사람'으로 **다시 올라오지 않는다**(0027):
// approved 하나로 둘을 겸했더니 방금 내보낸 사람을 다시 수락하라고 화면이 졸랐다.
// 계정을 지우는 길은 두지 않았다 — 프로필 행을 지워도 다시 로그인하면 되살아나고
// (auth.users가 남는다), 계정을 지우려면 뭔가 쓴 적 있는 사람은 DB가 막는다.
//
// 관리자 지정은 **가입자 목록에서 고른다**. 예전에는 이메일을 타이핑해야 했는데
// (관리자 원본이 `admins.email`이고 profiles에 이메일이 없었다), 0028이
// `profiles.email`을 채워서 얼굴·이름으로 고를 수 있게 됐다. 지정·해제 버튼은
// **마스터에게만 보인다** — DB도 막는다(0029). 화면만 감추는 상태를 만들지 않는다.
//
// ── v2에서 붙은 '명단' 탭 (docs/V2.md 결정 1·13 · 권한 표: 마스터 + 관리자) ──
// 청년 ~50명은 대부분 계정이 없다. 그래서 사람의 축이 둘이다 —
//   **계정**(profiles) = 워크스페이스에 가입한 사람. 위의 네 가지가 그대로다.
//   **명단**(people)   = 청년부 전체. 출석·순 편성이 이 축을 쓴다.
// 둘을 잇는 것이 `people.profile_id`이고, **관리자가 눈으로 골라** 잇는다.
// 이름이 같아도 자동으로 잇지 않는다(§6-26).
//
// 명단 쪽 통신은 전부 여기서 하고(services/roster.js), 화면은 props만 받는
// components/roster.jsx가 그린다 — 게스트 스위트가 가짜 명단으로 눌러 볼 수 있게.
// 게스트 모드에는 클라우드가 없으므로 계정 목록도 roster.guestProfiles()로 떨어진다
// (예전에는 여기서 던져서 콘솔 오류와 토스트가 같이 났다).
// ============================================================================

const TABS = [['account', '계정'], ['roster', '명단']];
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1];
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'ko');

const Section = ({ title, count, children, hint }) => (
  <section className="mb-7">
    <div className="flex items-center gap-2 mb-2.5">
      <h3 className="text-[13px] font-bold text-fg">{title}</h3>
      {count != null && <span className="text-[11px] text-fg-faint tabular-nums">{count}명</span>}
      <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
    </div>
    {hint && <p className="text-[11px] text-fg-faint mb-2.5 leading-relaxed">{hint}</p>}
    {children}
  </section>
);

const RowSkeleton = () => (
  <div className="flex items-center gap-2.5 py-2.5">
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-2 w-16 rounded" />
    </div>
  </div>
);

export function MembersView({ isAdmin, isMaster }) {
  const [tab, setTab] = useState('account');
  const [rows, setRows] = useState(null);       // null = 아직 받는 중
  const [admins, setAdmins] = useState(null);
  const [busy, setBusy] = useState({});         // { profileId|email|personId|'add': true }
  const [pickOpen, setPickOpen] = useState(false);   // 관리자로 지정할 사람 고르기
  const [year, setYear] = useState(THIS_YEAR);
  const [book, setBook] = useState(null);       // 명단 — null = 아직 받는 중
  const online = usePresence();
  // 줄마다 'N분 전 가입 · N분 전 다녀감'이 있다 — 이 화면을 열어 두면 그 글자가 굳는다
  useMinuteTick();

  const load = useCallback(async () => {
    // 게스트 모드에는 클라우드가 없다 — 던지게 두면 화면을 열 때마다 콘솔 오류다
    if (!isCloudEnabled()) { setRows(roster.guestProfiles()); setAdmins([]); return; }
    try {
      const [ms, as] = await Promise.all([cloud.listMembersAdmin(), cloud.listAdmins()]);
      setRows(ms);
      setAdmins(as);   // [{ email, is_master }]
    } catch (e) {
      console.error('[cloud] 멤버 목록 실패:', e);
      showToast(failText('멤버 목록을 받지 못했어요', e));
      setRows([]); setAdmins([]);
    }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // 명단은 '명단' 탭을 열 때 처음 받는다 — 계정만 보러 온 사람에게 네 번의 왕복을
  // 미리 물리지 않는다. 연도를 바꾸면 그 해의 직분·순 편성을 다시 받는다.
  useEffect(() => {
    if (!isAdmin || tab !== 'roster') return;
    let alive = true;
    setBook(null);
    (async () => {
      try {
        const data = await roster.loadRoster(year);
        if (alive) setBook({ ...data, people: [...data.people].sort(byName) });
      } catch (e) {
        console.error('[roster] 명단 조회 실패:', e);
        if (!alive) return;
        showToast(failText('명단을 받지 못했어요', e));
        setBook({ people: [], roles: [], suns: [], groupMembers: [] });
      }
    })();
    return () => { alive = false; };
  }, [isAdmin, tab, year]);

  if (!isAdmin) {
    return (
      <div className="dc-screen max-w-3xl mx-auto py-16 text-center">
        <p className="text-[13px] text-fg-muted">관리자만 볼 수 있는 화면이에요.</p>
      </div>
    );
  }

  const mark = (key, on) => setBusy(prev => ({ ...prev, [key]: on }));

  const approve = async (row, next) => {
    mark(row.id, true);
    try {
      await cloud.setApproved(row.id, next);
      // removed_at도 같이 바꾼다 — 안 그러면 환송한 사람이 어느 구역에도 안 남는다
      setRows(prev => prev.map(r => (r.id === row.id
        ? { ...r, approved: next, removed_at: next ? null : new Date().toISOString() }
        : r)));
      showToast(next ? `${row.display_name || '이 분'}을 수락했어요` : `${row.display_name || '이 분'}을 환송했어요`);
    } catch (e) {
      console.error('[cloud] 승인 변경 실패:', e);
      showToast(failText(next ? '수락하지 못했어요' : '환송하지 못했어요', e));
    } finally { mark(row.id, false); }
  };

  // 이메일을 손으로 치지 않고 **가입한 사람 목록에서 고른다**(0028에서 profiles.email을
  // 두면서 가능해졌다). "어차피 노준석이잖아" — 사람으로 다루는 것이 맞다.
  const addAdmin = async (person) => {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { showToast('이 분은 로그인 이메일이 없어서 관리자로 지정할 수 없어요'); return; }
    mark(email, true);
    try {
      await cloud.addAdmin(email);
      setAdmins(prev => [...prev, { email, is_master: false }].sort((a, b) => a.email.localeCompare(b.email)));
      setPickOpen(false);
      showToast(`${person.display_name || email}님을 관리자로 지정했어요`);
    } catch (e) {
      console.error('[cloud] 관리자 지정 실패:', e);
      showToast(failText('관리자로 지정하지 못했어요', e));
    } finally { mark(email, false); }
  };

  const dropAdmin = async (email) => {
    mark(email, true);
    try {
      await cloud.removeAdmin(email);
      setAdmins(prev => prev.filter(a => a.email !== email));
      showToast('관리자에서 해제했어요');
    } catch (e) {
      console.error('[cloud] 관리자 해제 실패:', e);
      showToast(failText('관리자에서 해제하지 못했어요', e));
    } finally { mark(email, false); }
  };

  // ── 명단 ──────────────────────────────────────────────────────────────────
  // 쓰기가 성공하면 그 줄만 갈아 끼운다(목록을 통째로 다시 받지 않는다 — 계정 쪽
  // approve와 같은 방식). 막히면 화면은 그대로 두고 토스트만 낸다 — RLS가 진실이다.
  const patchPerson = (id, patch) => setBook(prev => (prev
    ? { ...prev, people: prev.people.map(p => (p.id === id ? { ...p, ...patch } : p)) }
    : prev));

  // 한 벌로 쓰는 쓰기 껍데기 — busy 표시 · 성공 토스트 · 실패 토스트가 전부 같다
  const write = async (key, run, done, whatFailed) => {
    mark(key, true);
    try {
      const out = await run();
      done(out);
      return true;
    } catch (e) {
      console.error(`[roster] ${whatFailed}:`, e);
      showToast(failText(whatFailed, e));
      return false;
    } finally { mark(key, false); }
  };

  const rosterOn = {
    year: setYear,
    add: (row) => write('add', () => roster.addPerson(row), (made) => {
      setBook(prev => (prev ? { ...prev, people: [...prev.people, made].sort(byName) } : prev));
      showToast(`${made.name}${objectParticle(made.name)} 명단에 올렸어요`);
    }, '명단에 올리지 못했어요'),

    save: (p, patch) => write(p.id, () => roster.updatePerson(p.id, patch), () => {
      patchPerson(p.id, patch);
      showToast(`${patch.name || p.name} 정보를 저장했어요`);
    }, '저장하지 못했어요'),

    remove: (p, next) => write(p.id, () => roster.setRemoved(p.id, next), () => {
      patchPerson(p.id, { removed_at: next ? new Date().toISOString() : null });
      showToast(next
        ? `${p.name}${objectParticle(p.name)} 환송했어요`
        : `${p.name}${objectParticle(p.name)} 명단으로 되돌렸어요`);
    }, next ? '환송하지 못했어요' : '되돌리지 못했어요'),

    link: (p, profileId) => write(p.id, () => roster.linkProfile(p.id, profileId), () => {
      patchPerson(p.id, { profile_id: profileId || null });
      showToast(profileId ? '계정을 이었어요' : '계정 연결을 해제했어요');
    }, profileId ? '계정을 잇지 못했어요' : '계정 연결을 해제하지 못했어요'),

    pastor: (p, next) => write(p.id, () => roster.setPastor(p.id, next), () => {
      patchPerson(p.id, { is_pastor: next });
      showToast(next ? `${p.name} 교역자로 지정했어요` : '교역자 지정을 해제했어요');
    }, next ? '교역자로 지정하지 못했어요' : '교역자 지정을 해제하지 못했어요'),

    role: (p, role, next) => write(p.id, () => roster.setYearRole(p.id, year, role, next), () => {
      const label = roster.ROLE_LABEL[role];
      setBook(prev => (prev ? {
        ...prev,
        roles: next
          ? [...prev.roles, { person_id: p.id, year, role }]
          : prev.roles.filter(r => !(r.person_id === p.id && r.year === year && r.role === role)),
      } : prev));
      showToast(next ? `${year}년 ${label}으로 지정했어요` : `${year}년 ${label} 지정을 해제했어요`);
    }, next ? '직분을 지정하지 못했어요' : '직분 지정을 해제하지 못했어요'),
  };

  // 환송한 사람은 '승인을 기다리는 사람'으로 다시 올라오지 않는다(0027) —
  // 방금 내보낸 사람을 다시 수락하라고 화면이 조르면 안 된다(사용자 지적).
  const waiting = (rows || []).filter(r => !r.approved && !r.removed_at);
  const removed = (rows || []).filter(r => !r.approved && r.removed_at);
  // 함께하는 사람은 **다녀간 순**이다 — 대시보드 '가입한 사람' 목록과 같은 정렬
  // (utils.visitOrder). 가입순으로 두면 오래 안 온 사람이 계속 맨 위에 선다.
  const members = visitOrder(
    (rows || []).filter(r => r.approved)
      .map(r => ({ ...r, name: r.display_name || '', lastSeenAt: r.last_seen_at, joinedAt: r.created_at })),
  );

  // 접속 표시는 대시보드 '가입한 사람' 목록(MembersModal)과 같은 모양이다 — 아바타
  // 귀퉁이의 초록 원 + '접속 중'. 지금 보고 있는 사람에게 '1초 전 다녀감'이 뜨면
  // 어색하다(사용자 지적).
  const MemberRow = ({ row, action }) => {
    const isOnline = online.has(row.id);
    return (
    <div className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
      <span className="relative shrink-0 inline-flex">
        <Avatar name={row.display_name} url={row.avatar_url} className="flex w-8 h-8 text-[13px]" />
        {isOnline && (
          <span aria-hidden className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full"
            style={{ background: 'var(--app-tag-green-fg)', boxShadow: '0 0 0 2px var(--app-surface)' }} />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-fg truncate">{row.display_name || '이름 없음'}</p>
        <p className="text-[10.5px] truncate" style={{ color: isOnline ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)' }}>
          {[row.created_at && `${agoLabel(row.created_at)} 가입`,
            isOnline ? '접속 중' : (row.last_seen_at && `${agoLabel(row.last_seen_at)} 다녀감`)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {action}
    </div>
    );
  };

  return (
    <div className="dc-screen max-w-3xl mx-auto pb-8">
      <div className="mb-4">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">멤버 관리</h2>
        <p className="text-[11.5px] text-fg-muted mt-1">가입 수락·관리자 지정과 청년 명단을 여기서 합니다.</p>
      </div>

      {/* 사람의 축이 둘이다 — 가입한 '계정'과 청년부 전체 '명단'(파일 머리말) */}
      <div className="flex items-center gap-2 pb-4">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {TABS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className="px-3.5 py-[6px] rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: tab === key ? 'var(--app-surface)' : 'transparent',
                color: tab === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{label}</button>
          ))}
        </span>
      </div>

      {tab === 'roster' ? (
        <RosterPanel {...(book || {})} profiles={rows || []} year={year} years={YEARS}
          busy={busy} loading={book === null} on={rosterOn} />
      ) : rows === null ? (
        <><RowSkeleton /><RowSkeleton /><RowSkeleton /></>
      ) : (
        <>
          {/* 대기자가 있을 때만 그린다 — 없는 줄을 그리면 "할 일이 있다"로 읽힌다 */}
          {waiting.length > 0 && (
            <Section title="승인을 기다리는 사람" count={waiting.length}
              hint="수락하기 전에는 프로젝트도 업무도 볼 수 없어요.">
              {waiting.map(row => (
                <MemberRow key={row.id} row={row} action={
                  <button type="button" disabled={!!busy[row.id]} onClick={() => approve(row, true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} 수락
                  </button>
                } />
              ))}
            </Section>
          )}

          <Section title="함께하는 사람" count={members.length}>
            {members.map(row => (
              <MemberRow key={row.id} row={row} action={
                <ConfirmPopover message={`${row.display_name || '이 분'}을 환송할까요? 지난 댓글·기록은 그대로 남아요.`}
                  onConfirm={() => approve(row, false)}>
                  <button type="button" disabled={!!busy[row.id]}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    <UserX size={13} /> 환송해주기
                  </button>
                </ConfirmPopover>
              } />
            ))}
          </Section>

          {/* 환송한 사람 — 다시 부를 수 있다. 프로필 행을 지우지 않는 이유는
              0027 주석에 있다(지워도 다시 로그인하면 되살아난다). */}
          {removed.length > 0 && (
            <Section title="환송한 사람" count={removed.length}
              hint="다시 초대하면 수락 대기 없이 바로 돌아와요. 지난 댓글·기록은 계속 남아 있어요.">
              {removed.map(row => (
                <MemberRow key={row.id} row={row} action={
                  <button type="button" disabled={!!busy[row.id]} onClick={() => approve(row, true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-hover text-fg-muted text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} 다시 초대하기
                  </button>
                } />
              ))}
            </Section>
          )}

          {/* 마스터라는 말은 화면에 쓰지 않는다 — 사용자 결정("마스터 권한은 나만 알고
              있을게"). 문구도 배지도 마스터에게만 보인다. 경계 자체는 DB가 막으므로
              (0029) 감춰도 '화면만 감추는' 상태가 되지 않는다. */}
          <Section title="관리자" count={(admins || []).length}
            hint="관리자는 멤버 관리와 업무 삭제를 할 수 있어요.">
            {(admins || []).map(a => {
              // 같은 사람이 계정을 여럿 쓰면(구글·카카오) 행이 둘이다 — 이름으로 묶어 보여준다
              const who = (rows || []).find(r => (r.email || '').toLowerCase() === a.email);
              return (
                <div key={a.email} className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
                  {who
                    ? <Avatar name={who.display_name} url={who.avatar_url} className="flex w-8 h-8 text-[13px] shrink-0" />
                    : <span className="w-8 h-8 rounded-full bg-accent-weak flex items-center justify-center shrink-0"><ShieldCheck size={15} className="text-accent-text" /></span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-fg truncate">
                      {who?.display_name || a.email}
                      {isMaster && a.is_master && <span className="ml-1.5 text-[10px] font-bold text-accent-text">마스터</span>}
                    </p>
                    <p className="text-[10.5px] text-fg-faint truncate">{a.email}</p>
                  </div>
                  {isMaster && (
                    <ConfirmPopover message={`${who?.display_name || a.email}을 관리자에서 해제할까요?`} onConfirm={() => dropAdmin(a.email)}>
                      <button type="button" disabled={!!busy[a.email]}
                        className="shrink-0 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                        해제하기
                      </button>
                    </ConfirmPopover>
                  )}
                </div>
              );
            })}

            {/* 지정은 마스터만. 관리자에게 이 줄을 보여 주고 누르면 DB가 막는 것은
                §4.4가 지적한 '화면만 감추는' 상태와 반대다 — 아예 안 보여준다. */}
            {isMaster && (pickOpen ? (
              <div className="mt-3 border border-line rounded-lg p-1.5 max-h-64 overflow-y-auto">
                {members.filter(m => !(admins || []).some(a => a.email === (m.email || '').toLowerCase())).map(m => (
                  <button key={m.id} type="button" disabled={!!busy[m.email]} onClick={() => addAdmin(m)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
                    <Avatar name={m.display_name} url={m.avatar_url} className="flex w-7 h-7 text-xs shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-fg truncate">{m.display_name || '이름 없음'}</span>
                      <span className="block text-[10.5px] text-fg-faint truncate">{m.email || '로그인 이메일 없음'}</span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => setPickOpen(false)}
                  className="w-full mt-1 py-2 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">닫기</button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95">
                <Plus size={13} /> 가입한 사람 중에서 지정하기
              </button>
            ))}

            <p className="mt-2.5 text-[10.5px] text-fg-faint leading-relaxed">
              <Shield size={11} className="inline -mt-0.5 mr-1" />
              자기 자신은 해제할 수 없어요.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
