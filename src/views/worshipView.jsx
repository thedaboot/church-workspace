import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PencilLine, ChevronDown } from 'lucide-react';
import { Skeleton } from '../components/media.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { useAuth } from '../services/auth.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { ServiceDetail, WorshipEmpty } from '../components/worshipDetail.jsx';
import { AttendanceScreen } from '../components/worshipAttendance.jsx';
import {
  SUNDAY_KIND, kindLabel, formatServiceDate, nextSundayDate, serviceYear, worshipPerms, mergeSongs,
  fetchServices, fetchWorshipPerms, fetchRoster, createService, saveService, publishService, removeService,
  fetchAttendance, checkIn, checkOut, addRosterPerson, fetchMyNote, saveMyNote,
  fetchPlaylistSongs, fetchVideoTitle,
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

// 종류 피커의 두 번째 줄 — 고르면 이름 칸이 나온다(이벤트성 예배)
const OTHER_LABEL = '다른 예배…';

// ── 실패 문구 ───────────────────────────────────────────────────────────────
// **'무엇을 못 했는지'에 '왜'를 붙여 한 줄로 말한다**(사용자 지시 2026-09-03:
// "'순장을 정하지 못했어요 · 이미 같은 것이 있어요'보다 '순장을 지정하지 못했어요.
// 그 청년은 이미 자리가 배정되어 있어요'처럼 명확하게"). 공용 errorReason은 표와
// 코드만 알아서 '이미 같은 것이 있어요'까지밖에 말하지 못한다 — **무엇이 겹쳤는지는
// 이 화면만 안다.** 그래서 아는 코드는 여기서 사람 말로 바꾸고, 모르는 것(오프라인·
// 로그인 끊김·서버 불안정)은 그대로 공용 문구에 맡긴다(앱 전체가 같은 말을 해야 한다).
//
// 두 도막을 잇는 것은 failText다 — 짧으면 ' · ', 길면 줄을 바꾼다(§8).
const NEED_EDIT = '주보는 회장·교역자·마스터만 쓸 수 있어요';
const GONE = '이 주보가 이미 지워졌어요 · 새로고침해주세요';
const fail = (what, err, byCode = {}) => {
  const why = err?.human || byCode[String(err?.code ?? '')];
  return failText(what, why ? { human: why } : err);
};

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

// 예배 종류 — 고르는 것은 둘뿐이다(주일 4부 젊은이 예배 / 그 밖의 자유 이름).
// 칩 두 개로 두면 종류 이름이 길어서 줄 하나를 통째로 먹었다 — 지금은 한 칸이다.
function KindPicker({ other, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // 트리거 바로 아래에 붙는 팝오버라 자리를 state로 잡지 않는다 — 그래서 §6-17-b의
  // 'top이 전이되어 미끄러진다'가 생기지 않는다(날짜 픽커와 같은 방식).
  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button type="button" aria-label="예배 종류" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="worship-kind-pick inline-flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 text-xs text-fg hover:bg-surface-hover focus:border-accent focus:shadow-soft outline-none transition-all">
        {other ? OTHER_LABEL : kindLabel(SUNDAY_KIND)}
        <ChevronDown size={12} className="text-fg-faint shrink-0" />
      </button>
      {open && (
        <div className="worship-kind-list absolute left-0 top-full z-50 mt-1 w-max min-w-full bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
          {[[false, kindLabel(SUNDAY_KIND)], [true, OTHER_LABEL]].map(([v, label]) => (
            <button key={label} type="button" onClick={() => { onPick(v); setOpen(false); }}
              className={`w-full px-2 py-1.5 rounded-md text-left text-[12.5px] transition-colors ${
                v === other ? 'bg-surface-hover text-fg font-semibold' : 'text-fg-muted hover:bg-surface-hover'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 새 주보 — 기본은 주일 4부 젊은이 예배, 날짜는 다가오는 주일이다(결정 14).
// 이벤트성 예배는 종류 이름을 그대로 적는다('금요 열정 예배'·'성탄절 예배').
//
// **한 줄짜리 생성기다**(사용자 지적 2026-09-02: "날짜와 그 밖의 예배만 정하고 만들
// 것이라면 세 줄로 쪼갤 이유가 없다"). 종류·날짜가 기본값으로 채워져 있어서 열자마자
// '만들기' 한 번이면 끝나고, 이름 칸은 '다른 예배'를 고를 때만 나온다.
function NewServiceForm({ onCreate, onCancel }) {
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => nextSundayDate());
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await onCreate({ kind: other ? name.trim() : SUNDAY_KIND, serviceDate: date });
    setBusy(false);
  };

  return (
    <div className={`worship-new p-3 mb-4 ${CARD}`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-center gap-1.5">
        <KindPicker other={other} onPick={setOther} />
        {other && (
          <input value={name} onChange={e => setName(e.target.value)} aria-label="예배 이름" placeholder="예: 금요 열정 예배"
            autoFocus onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            className="flex-1 basis-40 min-w-0 max-w-[16rem] text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
        )}
        {/* 업무의 날짜 픽커 한 벌을 그대로 쓴다 — 브라우저마다 다르게 그려지는
            <input type="date">와 달리 다크 모드·모바일에서 같은 모양이다(사용자 지적) */}
        <div className="worship-new-date shrink-0">
          <DatePicker value={date} onChange={setDate} />
        </div>
        <button type="button" onClick={submit} disabled={busy || (other && !name.trim()) || !date}
          className="worship-new-make shrink-0 px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">만들기</button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel}
          className="shrink-0 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">취소</button>
      </div>
    </div>
  );
}

function ServiceList({ services, perms, onOpen, onCreate }) {
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
        showToast(fail('주보 목록을 받지 못했어요', e, { 42501: '승인된 멤버만 주보를 볼 수 있어요' }));
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
      showToast(fail('주보에 딸린 명단과 출석을 받지 못했어요', e, { 42501: '승인된 멤버만 명단을 볼 수 있어요' }));
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
      showToast(fail('주보를 만들지 못했어요', e, {
        23505: '그 날짜의 주일 예배 주보가 이미 있어요',
        42501: '주보는 회장·교역자·마스터만 만들 수 있어요',
      }));
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
      showToast(fail('주보를 저장하지 못했어요', e, { 42501: NEED_EDIT, PGRST116: GONE }));
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
      showToast(fail('주보를 발행하지 못했어요', e, { 42501: NEED_EDIT, PGRST116: GONE }));
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
      showToast(fail('주보를 삭제하지 못했어요', e, {
        42501: NEED_EDIT, PGRST116: GONE,
        23503: '이 주보에 딸린 출석 기록이 아직 남아 있어요',
      }));
    }
  }, [openId]);

  const saveNote = useCallback(async ({ body, sharedToSun }) => {
    try {
      const row = await saveMyNote(openId, { body, sharedToSun });
      if (row) setNote(row);
      return true;
    } catch (e) {
      console.error('[worship] 예배 노트 저장 실패:', e);
      showToast(fail('예배 노트를 저장하지 못했어요', e, {
        42501: '노트는 로그인한 본인만 쓸 수 있어요',
        PGRST116: GONE,
      }));
      return false;
    }
  }, [openId]);

  // 출석은 먼저 화면에 반영하고 실패하면 되돌린다 — 한 명씩 누르는 조작이라
  // 서버를 기다리면 목록 전체가 굼떠 보인다.
  const toggle = useCallback(async (personId, next) => {
    // 누구의 출석인지까지 말한다 — 칩 여러 개를 잇달아 누르면 어느 것이 실패했는지
    // 토스트만 보고는 알 수 없다(이름은 이미 명단에 있다)
    const who = (roster.people || []).find(p => p.id === personId)?.name || '그 청년';
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
      showToast(fail(next ? `${who}님을 출석으로 표시하지 못했어요` : `${who}님의 출석을 취소하지 못했어요`, e, {
        23505: '이미 출석으로 표시되어 있어요 · 새로고침해주세요',
        42501: '내 순 청년만 출석을 만질 수 있어요 · 다른 순은 임원·교역자가 체크해요',
        23503: '이 주보나 명단이 이미 지워졌어요 · 새로고침해주세요',
      }));
    }
  }, [openId, roster.people]);

  // 미등록 출석자 — **두 걸음이라 실패도 두 가지다**(명단에 올리기 → 출석으로 표시).
  // 한 덩이로 묶어 두면 이미 명단에 올라간 뒤에 출석만 실패했는데도 '명단에 올리지
  // 못했어요'라고 거짓말을 하게 된다(사용자 지시 2026-09-03 — 무엇을 못 했는지가
  // 정확해야 한다).
  const addPerson = useCallback(async (name) => {
    const clean = String(name || '').trim();
    let made = null;
    try {
      made = await addRosterPerson(clean);
      if (!made) return null;
      setRoster(r => ({ ...r, people: [...(r.people || []), made] }));
    } catch (e) {
      console.error('[worship] 미등록 출석자 추가 실패:', e);
      showToast(fail(`${clean}님을 명단에 올리지 못했어요`, e, {
        42501: '출석을 체크할 수 있는 사람만 명단에 올릴 수 있어요',
      }));
      return null;
    }
    try {
      await checkIn(openId, made.id);
      setPresent(prev => new Set(prev).add(made.id));
      showToast(`${made.name}님을 명단에 올리고 출석으로 표시했어요`);
    } catch (e) {
      console.error('[worship] 미등록 출석자 출석 실패:', e);
      showToast(fail(`${made.name}님을 명단에는 올렸지만 출석으로 표시하지 못했어요`, e, {
        42501: '내 순 청년만 출석을 만질 수 있어요 · 다른 순은 임원·교역자가 체크해요',
      }));
    }
    return made;
  }, [openId]);

  const saveAttendanceNote = useCallback((text) => save({ attendance_note: text }), [save]);

  // 유튜브 재생목록 → 찬양 목록. 통신은 이 파일이 갖고(worshipDetail 머리말) 화면은
  // 돌려받은 목록을 그대로 쓴다. **왜 안 됐는지는 원인마다 다르다** — 주소가 아닌지,
  // 게스트 모드인지, 배포된 앱이 아닌지, 재생목록이 비공개인지(services/worship.js가
  // 이유를 만들고 여기서 '무엇을 못 했는지'를 앞에 붙인다).
  const pullPlaylist = useCallback(async (url, rows) => {
    try {
      const picked = await fetchPlaylistSongs(url);
      const next = mergeSongs(rows, picked);
      const added = next.length - (rows || []).length;
      showToast(added ? `${added}곡을 가져왔어요` : '가져올 새 곡이 없어요 · 재생목록의 곡이 이미 다 들어 있어요');
      return added ? next : null;
    } catch (e) {
      // 서버 함수가 없는 환경(게스트·로컬 vite)이나 주소를 잘못 붙인 것은 고장이
      // 아니다 — 토스트 한 줄로 끝내고 콘솔에는 남기지 않는다(worship.js의 quiet)
      if (!e?.quiet) console.error('[worship] 재생목록 가져오기 실패:', e);
      showToast(fail('재생목록을 가져오지 못했어요', e));
      return null;
    }
  }, []);

  // 링크만 붙였을 때 제목을 채운다. 실패하면 아무 말도 하지 않는다 — 사람이 부탁한
  // 일이 아니라 곁들이는 일이고, 제목은 손으로 적으면 된다.
  const lookupTitle = useCallback(async (url) => {
    try { return await fetchVideoTitle(url); } catch { return ''; }
  }, []);

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
        onPullPlaylist={pullPlaylist} onLookupTitle={lookupTitle}
      />
    );
  }

  return <ServiceList services={services} perms={perms} onOpen={open} onCreate={create} />;
}
