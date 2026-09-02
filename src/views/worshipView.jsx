import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, PencilLine } from 'lucide-react';
import { Skeleton } from '../components/media.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { useAuth } from '../services/auth.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { ServiceDetail, WorshipEmpty } from '../components/worshipDetail.jsx';
import { AttendanceScreen } from '../components/worshipAttendance.jsx';
import {
  SUNDAY_KIND, kindLabel, formatServiceDate, nextSundayDate, serviceYear, worshipPerms,
  fetchServices, fetchWorshipPerms, fetchRoster, createService, saveService, publishService, removeService,
  fetchAttendance, checkIn, checkOut, addRosterPerson, fetchMyNote, saveMyNote,
} from '../services/worship.js';

// ============================================================================
// v2 예배 화면 — 주보 목록/상세(말씀·임사자·찬양·광고) · 작성/발행 · 출석 체크 · 예배 노트
// ----------------------------------------------------------------------------
// 스펙은 docs/V2.md §1(결정 4·5·6·7·14)·§2, 저장 자리는 0036이다.
// App.jsx 라우팅(GLOBAL_MENUS 'worship')은 이미 연결돼 있다.
//
// **이 파일은 통신과 상태만 가진다.** 그리는 일은 worshipDetail·worshipAttendance가
// props로 받아서 한다 — 그래야 검사가 가짜 주보·명단으로 화면을 그대로 눌러 볼 수 있다.
//
// 작성 중(draft) 주보는 편집 자격자에게만 온다. 목록에서 거르는 것이 아니라 **RLS가
// 안 준다**(0036) — 화면은 그걸 비추기만 한다. 자격 판정(worshipPerms)이 어긋나도
// DB가 이긴다.
// ============================================================================

const KINDS = [
  { id: 'all', label: '전체' },
  { id: 'sunday', label: '주일예배' },
  { id: 'other', label: '그 밖의 예배' },
];

const CARD = 'rounded-[10px] shadow-soft transition active:scale-[.995]';
const CARD_STYLE = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };

function ServiceCard({ service, onOpen }) {
  const isDraft = service.status !== 'published';
  return (
    <button type="button" onClick={() => onOpen(service)}
      className={`worship-card dc-card w-full text-left p-3.5 ${CARD}`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(service.kind)}</span>
        {isDraft && <span className="worship-draft-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>}
        <span className="text-[11.5px] text-fg-muted">{formatServiceDate(service.service_date)}</span>
      </div>
      <p className="mt-1.5 text-[14px] font-bold text-fg break-words">{service.title || '설교 제목 미정'}</p>
      {(service.passage_ref || service.preacher) && (
        <p className="mt-0.5 text-[11.5px] text-fg-muted break-words">
          {[service.passage_ref, service.preacher].filter(Boolean).join(' · ')}
        </p>
      )}
    </button>
  );
}

// 새 주보 — 기본은 주일 4부 청년 예배, 날짜는 다가오는 주일이다(결정 14).
// 이벤트성 예배는 종류 이름을 그대로 적는다('금요 열정 예배'·'성탄절 예배').
function NewServiceForm({ onCreate, onCancel }) {
  const [sunday, setSunday] = useState(true);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => nextSundayDate());
  const [busy, setBusy] = useState(false);
  const chip = (on) => `px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition active:scale-95 ${on ? 'bg-accent text-white' : 'bg-surface border border-line text-fg-muted'}`;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await onCreate({ kind: sunday ? SUNDAY_KIND : name.trim(), serviceDate: date });
    setBusy(false);
  };

  return (
    <div className={`worship-new p-3.5 mb-4 ${CARD}`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(sunday)} onClick={() => setSunday(true)}>{kindLabel(SUNDAY_KIND)}</button>
        <button type="button" className={chip(!sunday)} onClick={() => setSunday(false)}>그 밖의 예배</button>
      </div>
      {!sunday && (
        <input value={name} onChange={e => setName(e.target.value)} aria-label="예배 이름" placeholder="예: 금요 열정 예배"
          className="w-full max-w-[24rem] mt-2.5 text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
      )}
      {/* 업무의 날짜 픽커 한 벌을 그대로 쓴다 — 브라우저마다 다르게 그려지는
          <input type="date">와 달리 다크 모드·모바일에서 같은 모양이다(사용자 지적) */}
      <div className="worship-new-date mt-2.5">
        <DatePicker value={date} onChange={setDate} />
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <button type="button" onClick={submit} disabled={busy || (!sunday && !name.trim()) || !date}
          className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">만들기</button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel}
          className="px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">취소</button>
      </div>
    </div>
  );
}

export function ServiceList({ services, perms, onOpen, onCreate }) {
  const [kind, setKind] = useState('all');
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const drafts = useMemo(() => (services || []).filter(s => s.status !== 'published'), [services]);
  const shown = useMemo(() => (services || [])
    .filter(s => (draftsOnly ? s.status !== 'published' : s.status === 'published'))
    .filter(s => (kind === 'all' ? true : kind === 'sunday' ? s.kind === SUNDAY_KIND : s.kind !== SUNDAY_KIND)),
  [services, kind, draftsOnly]);

  return (
    <div className="worship-list dc-screen pb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">예배</h2>
        <span className="flex-1" />
        {perms.canEdit && !creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="worship-new-open inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">
            <Plus size={13} /> 새 주보
          </button>
        )}
      </div>

      {creating && <NewServiceForm onCancel={() => setCreating(false)}
        onCreate={async (v) => { const ok = await onCreate(v); if (ok) setCreating(false); }} />}

      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock">
        {KINDS.map(k => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
            className="worship-kind-chip shrink-0 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition active:scale-95"
            style={kind === k.id
              ? { background: 'var(--app-ink)', color: 'var(--app-canvas)' }
              : { background: 'var(--app-surface)', color: 'var(--app-ink-muted)', border: '1px solid var(--app-line)' }}>
            {k.label}
          </button>
        ))}
      </div>

      {/* 작성 중 줄은 편집 자격자에게만 — 없는 사람에게는 RLS가 애초에 안 준다(0036) */}
      {perms.canEdit && drafts.length > 0 && (
        <button type="button" onClick={() => setDraftsOnly(v => !v)} aria-pressed={draftsOnly}
          className="worship-drafts-open inline-flex items-center gap-1.5 px-2.5 py-2 mb-3 rounded-md text-[11.5px] font-semibold transition active:scale-95"
          style={draftsOnly
            ? { background: 'var(--app-tag-yellow)', color: 'var(--app-tag-yellow-fg)' }
            : { background: 'var(--app-surface-hover)', color: 'var(--app-ink-muted)' }}>
          <PencilLine size={13} /> 작성 중 {drafts.length}
        </button>
      )}

      {/* 넓은 폭에서는 카드가 옆으로 선다 — 한 줄짜리 카드를 1440px에 늘여 놓으면
          글자는 왼쪽 끝에 몰리고 오른쪽은 비어 있다(사용자 지적) */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map(s => <ServiceCard key={s.id} service={s} onOpen={onOpen} />)}
      </div>
      {!shown.length && (
        <WorshipEmpty text={draftsOnly ? '작성 중인 주보가 아직 없어요' : '발행된 주보가 아직 없어요'} />
      )}
    </div>
  );
}

const LOADING = (
  <div className="pb-8">
    <Skeleton className="h-8 w-24 rounded-md mb-4" />
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
    </div>
  </div>
);

export function WorshipView({ onOpenBible } = {}) {
  const { enabled, session, isMaster, isAdmin } = useAuth();
  const [perms, setPerms] = useState(null);
  const [services, setServices] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [screen, setScreen] = useState('list');      // 'list' | 'detail' | 'attendance'
  const [roster, setRoster] = useState({ people: [], groups: [], members: [] });
  const [present, setPresent] = useState(() => new Set());
  const [note, setNote] = useState(null);
  const [editOnOpen, setEditOnOpen] = useState(false);   // 만들자마자 수정 화면으로

  // 노트는 가입자 누구나 쓴다(결정 7). 게스트 모드에는 로그인이 없다 — 그때도 연다.
  const canWriteNote = !enabled || !!session;
  const service = useMemo(() => (services || []).find(s => s.id === openId) || null, [services, openId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ps, list] = await Promise.all([
          fetchWorshipPerms(new Date().getFullYear(), { isMaster, isAdmin }),
          fetchServices(),
        ]);
        if (!alive) return;
        setPerms(ps); setServices(list);
      } catch (e) {
        console.error('[worship] 주보 목록 실패:', e);
        if (!alive) return;
        showToast(failText('주보를 받지 못했어요', e));
        setPerms(worshipPerms({ isMaster, isAdmin })); setServices([]);
      }
    })();
    return () => { alive = false; };
  }, [isMaster, isAdmin]);

  const open = useCallback(async (svc, { edit = false } = {}) => {
    setEditOnOpen(edit);
    setOpenId(svc.id); setScreen('detail'); setNote(null); setPresent(new Set());
    try {
      const [r, att, n] = await Promise.all([
        fetchRoster(serviceYear(svc.service_date)),
        fetchAttendance(svc.id),
        canWriteNote ? fetchMyNote(svc.id) : Promise.resolve(null),
      ]);
      setRoster(r); setPresent(new Set(att)); setNote(n);
    } catch (e) {
      console.error('[worship] 주보 상세 실패:', e);
      showToast(failText('주보를 여는 데 문제가 있어요', e));
    }
  }, [canWriteNote]);

  const create = useCallback(async (v) => {
    try {
      const made = await createService(v);
      setServices(list => [made, ...(list || [])]);
      // 만들면 목록이 아니라 그 주보의 수정 화면으로 바로 간다(사용자 결정) —
      // 갓 만든 주보는 전부 빈 칸이라 목록으로 돌아갈 이유가 없다
      open(made, { edit: true });
      return true;
    } catch (e) {
      console.error('[worship] 주보 만들기 실패:', e);
      showToast(failText('주보를 만들지 못했어요', e));
      return false;
    }
  }, [open]);

  const save = useCallback(async (patch) => {
    try {
      const row = await saveService(openId, patch);
      setServices(list => (list || []).map(s => (s.id === openId ? { ...s, ...(row || patch) } : s)));
      return true;
    } catch (e) {
      console.error('[worship] 주보 저장 실패:', e);
      showToast(failText('주보를 저장하지 못했어요', e));
      return false;
    }
  }, [openId]);

  const publish = useCallback(async () => {
    try {
      await publishService(openId);
      setServices(list => (list || []).map(s => (s.id === openId ? { ...s, status: 'published' } : s)));
      showToast('주보를 발행했어요');
    } catch (e) {
      console.error('[worship] 주보 발행 실패:', e);
      showToast(failText('주보를 발행하지 못했어요', e));
    }
  }, [openId]);

  const drop = useCallback(async () => {
    const id = openId;
    try {
      await removeService(id);
      setServices(list => (list || []).filter(s => s.id !== id));
      setOpenId(null); setScreen('list');
    } catch (e) {
      console.error('[worship] 주보 삭제 실패:', e);
      showToast(failText('주보를 삭제하지 못했어요', e));
    }
  }, [openId]);

  const saveNote = useCallback(async ({ body, sharedToSun }) => {
    try {
      const row = await saveMyNote(openId, { body, sharedToSun });
      if (row) setNote(row);
      return true;
    } catch (e) {
      console.error('[worship] 예배 노트 저장 실패:', e);
      showToast(failText('예배 노트를 저장하지 못했어요', e));
      return false;
    }
  }, [openId]);

  // 출석은 먼저 화면에 반영하고 실패하면 되돌린다 — 한 명씩 누르는 조작이라
  // 서버를 기다리면 목록 전체가 굼떠 보인다.
  const toggle = useCallback(async (personId, next) => {
    setPresent(prev => {
      const s = new Set(prev);
      if (next) s.add(personId); else s.delete(personId);
      return s;
    });
    try {
      await (next ? checkIn : checkOut)(openId, personId);
    } catch (e) {
      console.error('[worship] 출석 변경 실패:', e);
      setPresent(prev => {
        const s = new Set(prev);
        if (next) s.delete(personId); else s.add(personId);
        return s;
      });
      showToast(failText(next ? '출석으로 바꾸지 못했어요' : '출석을 되돌리지 못했어요', e));
    }
  }, [openId]);

  const addPerson = useCallback(async (name) => {
    try {
      const made = await addRosterPerson(name);
      if (!made) return null;
      setRoster(r => ({ ...r, people: [...(r.people || []), made] }));
      await checkIn(openId, made.id);
      setPresent(prev => new Set(prev).add(made.id));
      showToast(`${made.name}님을 명단에 올리고 출석으로 표시했어요`);
      return made;
    } catch (e) {
      console.error('[worship] 미등록 출석자 추가 실패:', e);
      showToast(failText('명단에 올리지 못했어요', e));
      return null;
    }
  }, [openId]);

  const saveAttendanceNote = useCallback((text) => save({ attendance_note: text }), [save]);

  if (!perms || services === null) return LOADING;

  if (screen === 'attendance' && service) {
    return (
      <AttendanceScreen
        service={service} roster={roster} present={present} perms={perms}
        onToggle={toggle} onAddPerson={addPerson} onSaveNote={saveAttendanceNote}
        onBack={() => setScreen('detail')}
      />
    );
  }

  if (screen === 'detail' && service) {
    return (
      <ServiceDetail
        service={service} people={roster.people} perms={perms} note={note} canWriteNote={canWriteNote}
        startEditing={editOnOpen}
        onBack={() => { setScreen('list'); setOpenId(null); setEditOnOpen(false); }}
        onSave={save} onPublish={publish} onDelete={drop} onSaveNote={saveNote}
        onOpenAttendance={() => setScreen('attendance')}
        onOpenBible={onOpenBible}
      />
    );
  }

  return <ServiceList services={services} perms={perms} onOpen={open} onCreate={create} />;
}
