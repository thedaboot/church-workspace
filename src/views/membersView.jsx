import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck, UserX, ShieldCheck, Shield, Plus, Loader2 } from 'lucide-react';
import { Avatar } from '../components/Avatar.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { agoLabel, visitOrder } from '../utils.js';
import * as cloud from '../services/cloud.js';

// ============================================================================
// 전역 '멤버' 화면 — 관리자만 (0022)
// ----------------------------------------------------------------------------
// 사용자가 "전역 화면 신설"로 정했다. 대시보드의 '가입한 사람' 목록(MembersModal)은
// **누가 있는지 보는 자리**로 그대로 두고, 여기는 **손을 대는 자리**다.
//
// 네 가지만 한다. 승인 대기 수락 · 환송해주기 · 다시 부르기 · 관리자 지정·해제.
// '환송해주기'는 접근만 끊는다(0022) — 지난 댓글·기록의 이름은 그대로 남는다.
// 환송한 사람은 '승인을 기다리는 사람'으로 **다시 올라오지 않는다**(0027):
// approved 하나로 둘을 겸했더니 방금 내보낸 사람을 다시 수락하라고 화면이 졸랐다.
// 계정을 지우는 길은 두지 않았다 — 프로필 행을 지워도 다시 로그인하면 되살아나고
// (auth.users가 남는다), 계정을 지우려면 뭔가 쓴 적 있는 사람은 DB가 막는다.
//
// 관리자 지정을 **이메일로** 받는 이유: 관리자 원본은 `admins.email`이고
// `profiles`에는 이메일 컬럼이 없다(0022 주석). 가입자 목록에서 고르게 하려면
// profiles에 이메일을 두어야 하는데, 그건 이 화면 하나를 위해 사람 정보를 한 벌
// 더 쌓는 일이다.
// ============================================================================

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

export function MembersView({ isAdmin }) {
  const [rows, setRows] = useState(null);       // null = 아직 받는 중
  const [admins, setAdmins] = useState(null);
  const [busy, setBusy] = useState({});         // { profileId|email: true }
  const [newAdmin, setNewAdmin] = useState('');

  const load = useCallback(async () => {
    try {
      const [ms, as] = await Promise.all([cloud.listMembersAdmin(), cloud.listAdmins()]);
      setRows(ms);
      setAdmins(as.map(a => a.email));
    } catch (e) {
      console.error('[cloud] 멤버 목록 실패:', e);
      showToast(failText('멤버 목록을 받지 못했어요', e));
      setRows([]); setAdmins([]);
    }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

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

  const addAdmin = async () => {
    const email = newAdmin.trim().toLowerCase();
    if (!email) return;
    mark(email, true);
    try {
      await cloud.addAdmin(email);
      setAdmins(prev => [...new Set([...prev, email])].sort());
      setNewAdmin('');
      showToast('관리자로 지정했어요');
    } catch (e) {
      console.error('[cloud] 관리자 지정 실패:', e);
      showToast(failText('관리자로 지정하지 못했어요', e));
    } finally { mark(email, false); }
  };

  const dropAdmin = async (email) => {
    mark(email, true);
    try {
      await cloud.removeAdmin(email);
      setAdmins(prev => prev.filter(e => e !== email));
      showToast('관리자에서 해제했어요');
    } catch (e) {
      console.error('[cloud] 관리자 해제 실패:', e);
      showToast(failText('관리자에서 해제하지 못했어요', e));
    } finally { mark(email, false); }
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

  const MemberRow = ({ row, action }) => (
    <div className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
      <Avatar name={row.display_name} url={row.avatar_url} className="flex w-8 h-8 text-[13px] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-fg truncate">{row.display_name || '이름 없음'}</p>
        <p className="text-[10.5px] text-fg-faint truncate">
          {[row.created_at && `${agoLabel(row.created_at)} 가입`,
            row.last_seen_at && `${agoLabel(row.last_seen_at)} 다녀감`].filter(Boolean).join(' · ')}
        </p>
      </div>
      {action}
    </div>
  );

  return (
    <div className="dc-screen max-w-3xl mx-auto pb-8">
      <div className="mb-6">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">멤버 관리</h2>
        <p className="text-[11.5px] text-fg-muted mt-1">가입 수락과 관리자 지정을 여기서 합니다.</p>
      </div>

      {rows === null ? (
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
              hint="다시 부르면 그대로 돌아와요. 지난 댓글·기록은 계속 남아 있어요.">
              {removed.map(row => (
                <MemberRow key={row.id} row={row} action={
                  <button type="button" disabled={!!busy[row.id]} onClick={() => approve(row, true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-hover text-fg-muted text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} 다시 부르기
                  </button>
                } />
              ))}
            </Section>
          )}

          <Section title="관리자" count={(admins || []).length}
            hint="관리자는 가입 수락·요약 고정·업무 삭제를 할 수 있어요. 이메일은 그 사람이 로그인에 쓰는 주소입니다.">
            {(admins || []).map(email => (
              <div key={email} className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
                <span className="w-8 h-8 rounded-full bg-accent-weak flex items-center justify-center shrink-0">
                  <ShieldCheck size={15} className="text-accent-text" />
                </span>
                <p className="flex-1 min-w-0 text-[13px] text-fg truncate">{email}</p>
                <ConfirmPopover message={`${email}을 관리자에서 해제할까요?`} onConfirm={() => dropAdmin(email)}>
                  <button type="button" disabled={!!busy[email]}
                    className="shrink-0 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    해제하기
                  </button>
                </ConfirmPopover>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-3">
              <input
                type="email" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addAdmin(); }}
                placeholder="예: hong@gmail.com" autoComplete="off"
                className="flex-1 min-w-0 px-2.5 py-2 rounded-md border border-line bg-surface text-[13px] text-fg placeholder:text-fg-faint outline-none focus:border-accent transition-colors"
              />
              <button type="button" onClick={addAdmin} disabled={!newAdmin.trim()}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                <Plus size={13} /> 관리자 추가
              </button>
            </div>
            {/* 자기 자신은 해제할 수 없다 — DB도 막고 있다(0022). 마지막 관리자가
                스스로를 해제하면 되돌릴 길이 없다. */}
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
