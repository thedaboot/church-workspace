import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink, ClipboardCheck } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { keepVisible } from '../utils.js';
import { PassagePicker, PassageBody } from './worshipPassage.jsx';
import { EmptyBookMark } from './wordBible.jsx';
import { kindLabel, formatServiceDate, attendanceOpen } from '../services/worship.js';

// ============================================================================
// 주보 상세 — 말씀 · 담당자 · 찬양 · 광고 + 내 예배 노트 (docs/V2.md 결정 4·5·7)
// ----------------------------------------------------------------------------
// 데이터는 전부 props다. 화면을 눌러 보는 검사(tests/worship.mjs)가 가짜 주보·명단으로
// 이 부품만 그려 볼 수 있게, 통신은 부르는 쪽(worshipView)이 전부 가진다.
//
// 담당자·찬양·광고는 주보 한 건과 언제나 같이 읽고 쓰는 값이라 jsonb 한 칸이다
// (HANDOFF §2-1 · 0036). 그래서 편집은 '행 목록을 통째로 들고 있다가 저장'이고,
// 조인 테이블처럼 행마다 왕복하지 않는다.
//
// 편집 중에는 **저절로 저장된다**(디바운스). 그래서 편집 모드의 오른쪽 버튼은 '취소'가
// 아니라 '목록으로'다 — 이미 저장된 것을 되돌려 주지 못하면서 취소라고 부르면 거짓말이
// 된다. 왼쪽 '저장'은 기다리지 않고 지금 저장하고 보기 모드로 돌아가는 버튼이다.
// 발행은 여전히 명시적으로 누른다(결정 5).
// ============================================================================

const ROW = 'flex items-center gap-1.5';
const INPUT = 'min-w-0 text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint';
const ICON_BTN = 'p-1.5 rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-30';
const SAVE_DELAY = 900;
// 이름과 역할이 화면 양 끝으로 갈라지지 않게, 줄 목록은 한 눈에 읽히는 폭까지만 넓힌다
// (화면 틀·머리줄·탭은 대시보드와 같은 전체 폭을 쓴다 — §3의 넓은 레이아웃)
const LIST = 'max-w-[46rem]';

const TABS = [
  { id: 'word', label: '말씀' },
  { id: 'roles', label: '담당자' },
  { id: 'songs', label: '찬양' },
  { id: 'notices', label: '광고' },
];

// 저절로 저장되는 칸들(주보 편집 · 내 예배 노트 · 출석 메모)이 함께 쓰는 상태 표시.
// state는 '' | 'saving' | 'saved'.
//
// 끝난 것만 **연한 초록 칩**이다(사용자 결정 2026-09-02) — 누르지 않아도 저장되는 화면이라
// 저장이 끝난 순간이 눈에 들어와야 안심이 된다. '저장하는 중'은 지나가는 상태라 무채색이다.
// 라벨은 부르는 쪽이 정한다: 아직 발행 전인 주보는 '임시 저장되었어요'(발행해야 남들이
// 본다는 뜻이 담긴다), 이미 발행된 주보를 고치는 중이면 그 글자가 거짓이 되므로
// '저장되었어요'다.
export function SaveState({ state, savedLabel = '저장되었어요' }) {
  const done = state === 'saved';
  return (
    <span className={`worship-save-state text-[10.5px] ${
      done ? 'px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg font-bold' : 'text-fg-faint'}`}>
      {done ? savedLabel : (state === 'saving' ? '저장하는 중' : '')}
    </span>
  );
}

// 예배 화면의 빈 상태 한 벌 — **마크와 함께 남는 공간의 세로·가로 가운데**(§8 ·
// 사용자 지적 2026-09-02: 글자만 위에 붙어 있으면 아래가 통째로 비어 보인다).
//
// 마크는 새로 그리지 않는다. 대시보드의 AllClearMark(체크)·EmptyColumnMark(카드)는
// export가 없고 그 파일들은 이 회차에서 못 건드리므로, 이미 export된 같은 한 벌인
// 말씀 화면의 EmptyBookMark(펼친 책)를 그대로 쓴다 — 주보·본문 화면이라 그림도 맞는다.
// 안내 줄은 붙이지 않는다(§8) — 한 줄이 전부다.
export function WorshipEmpty({ text }) {
  return (
    <div className="worship-empty min-h-[46vh] flex flex-col items-center justify-center text-center">
      <EmptyBookMark />
      <p className="mt-3 text-[13.5px] font-semibold text-fg">{text}</p>
    </div>
  );
}

// 배열 한 칸 옮기기 (담당자·찬양·광고 공용). 끝에서는 그대로 둔다.
const moveAt = (list, from, to) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
};

// 저장에 실제로 실리는 칸만 추린다 — 보기 값(status·created_at)까지 되돌려 보내지 않는다
const patchOf = (d) => ({
  title: d.title || null, passage_ref: d.passage_ref || null, preacher: d.preacher || null,
  roles: d.roles || [], songs: d.songs || [], notices: d.notices || [],
});

// ── 보기 ─────────────────────────────────────────────────────────────────────
function WordTab({ service }) {
  const has = service.title || service.passage_ref || service.preacher;
  if (!has) return <WorshipEmpty text="설교 제목과 본문 구절을 아직 적지 않았어요" />;
  return (
    <div>
      {service.title && <h3 className="text-[16px] font-extrabold text-fg tracking-[-0.3px]">{service.title}</h3>}
      <p className="mt-1 text-[12px] text-fg-muted">
        {[service.passage_ref, service.preacher].filter(Boolean).join(' · ')}
      </p>
      <PassageBody refStr={service.passage_ref} />
    </div>
  );
}

function RolesTab({ rows, people }) {
  const byId = useMemo(() => new Map((people || []).map(p => [p.id, p])), [people]);
  if (!rows.length) return <WorshipEmpty text="담당자를 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((r, i) => {
        const person = r.personId || r.person_id ? byId.get(r.personId || r.person_id) : null;
        const name = person?.name || r.name || '';
        return (
          <li key={i} className="worship-role-row flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
            {/* 계정이 이어진 사람만 사진이 있다 — 나머지는 이름 글자 원이다(§4.7) */}
            <Avatar name={name} {...(person?.profile_id ? {} : { url: null })} className="flex w-7 h-7 text-[12px] shrink-0" />
            <span className="flex-1 min-w-0 text-[13px] font-semibold text-fg truncate">{name || '이름 없음'}</span>
            <span className="shrink-0 text-[11.5px] text-fg-muted">{r.role || ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SongsTab({ rows }) {
  if (!rows.length) return <WorshipEmpty text="찬양을 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((s, i) => (
        <li key={i} className="flex items-center gap-2 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
          <span className="w-5 shrink-0 text-[11px] font-bold text-fg-faint tabular-nums">{i + 1}</span>
          <span className="flex-1 min-w-0 text-[13px] text-fg break-words">{s.title}</span>
          {s.link && (
            <a href={s.link} target="_blank" rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-text hover:underline">
              <ExternalLink size={12} /> 듣기
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function NoticesTab({ rows }) {
  if (!rows.length) return <WorshipEmpty text="광고를 아직 적지 않았어요" />;
  return (
    <ol className={`${LIST} space-y-3.5`}>
      {rows.map((n, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="w-5 shrink-0 text-[11px] font-bold text-fg-faint tabular-nums pt-0.5">{i + 1}</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-fg break-words">{n.title}</p>
            {n.body && <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-secondary whitespace-pre-line break-words">{n.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── 편집 ─────────────────────────────────────────────────────────────────────
// 순서 버튼은 언제나 보인다 — hover로 숨기면 터치 기기에서 그 기능이 없는 것과 같다(§8).
function RowTools({ index, total, onMove, onRemove, what }) {
  return (
    <>
      <button type="button" className={ICON_BTN} disabled={index === 0} title="위로"
        aria-label={`${what} 위로`} onClick={() => onMove(index, index - 1)}><ChevronUp size={13} /></button>
      <button type="button" className={ICON_BTN} disabled={index === total - 1} title="아래로"
        aria-label={`${what} 아래로`} onClick={() => onMove(index, index + 1)}><ChevronDown size={13} /></button>
      <ConfirmPopover className="shrink-0 inline-flex" title={`${what} 삭제`}
        message={`이 ${what} 줄을 삭제할까요?`} onConfirm={() => onRemove(index)}>
        <button type="button" aria-label={`${what} 삭제`}
          className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors">
          <Trash2 size={13} />
        </button>
      </ConfirmPopover>
    </>
  );
}

const AddRow = ({ label, onClick }) => (
  <button type="button" onClick={onClick}
    className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95">
    <Plus size={13} /> {label}
  </button>
);

function WordEdit({ draft, set }) {
  return (
    <div className="space-y-2.5">
      <input className={`${INPUT} w-full max-w-[42rem]`} value={draft.title || ''} onChange={e => set({ title: e.target.value })}
        aria-label="설교 제목" placeholder="예: 흔들리지 않는 기쁨" />
      <PassagePicker value={draft.passage_ref || ''} onChange={v => set({ passage_ref: v })} />
      <input className={`${INPUT} w-full max-w-[42rem]`} value={draft.preacher || ''} onChange={e => set({ preacher: e.target.value })}
        aria-label="설교자" placeholder="예: 임성빈 전도사님" />
      {/* 고르는 대로 아래에 본문이 펼쳐진다 */}
      <PassageBody refStr={draft.passage_ref} />
    </div>
  );
}

// 담당자 사람 칸 — 이름 입력 하나로 명단 고르기와 자유 이름을 겸한다(사용자 결정).
// 치면 명단이 뜨고(방향키·Enter), 고르면 person이 연결된다. 명단에 없는 사람(외부 강사
// 같은)은 적은 글자가 그대로 남는다 — 0036의 roles jsonb가 둘 다 받는다.
// 담당자 지정(modals의 AssigneePicker)과 같은 톤이되, 그쪽은 목록 밖 이름을 막는다는
// 점만 다르다(업무 배정은 계정이 있어야 뜻이 있고, 주보 담당자는 이름만으로도 뜻이 있다).
function PersonNameInput({ row, people, onPick }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);
  const name = row.name || '';
  const linked = useMemo(
    () => (row.personId ? (people || []).find(p => p.id === row.personId) : null),
    [row.personId, people],
  );

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    const all = [...(people || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    return q ? all.filter(p => String(p.name).toLowerCase().includes(q)) : all;
  }, [name, people]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (p) => { onPick({ name: p.name, personId: p.id }); setOpen(false); setActiveIdx(0); };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[activeIdx] ?? suggestions[0]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="worship-person relative flex-1 basis-40 min-w-0" ref={rootRef}>
      <div className="flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1 focus-within:border-accent focus-within:shadow-soft transition-all">
        {/* 명단에 이어진 사람만 동그라미가 붙는다 — 연결됐다는 표시를 겸한다 */}
        {linked && <Avatar name={linked.name} {...(linked.profile_id ? {} : { url: null })} className="flex w-5 h-5 text-[10px] shrink-0" />}
        <input
          value={name} aria-label="이름" placeholder="이름"
          // 글자를 고치면 연결은 풀린다 — 이름과 사람이 어긋난 채로 남지 않게(§6-26)
          onChange={e => { onPick({ name: e.target.value, personId: null }); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="worship-person-list absolute left-0 top-full z-50 mt-1 w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
          {suggestions.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={e => { e.preventDefault(); choose(p); }}
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <Avatar name={p.name} {...(p.profile_id ? {} : { url: null })} className="flex w-5 h-5 text-[10px] shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RolesEdit({ rows, people, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      {rows.map((r, i) => (
        <div key={i} className="worship-role-edit flex flex-wrap items-center gap-1.5 py-2" style={{ borderBottom: '1px solid var(--app-line)' }}>
          <input className={`${INPUT} w-[7.5rem] shrink-0`} value={r.role || ''} aria-label="역할"
            onChange={e => set(i, { role: e.target.value })} placeholder="예: 대표기도" />
          <PersonNameInput row={r} people={people} onPick={v => set(i, v)} />
          <span className={`${ROW} shrink-0`}>
            <RowTools index={i} total={rows.length} what="담당자"
              onMove={(a, b) => onChange(moveAt(rows, a, b))}
              onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
          </span>
        </div>
      ))}
      <AddRow label="담당자 추가" onClick={() => onChange([...rows, { role: '', personId: null, name: '' }])} />
    </div>
  );
}

function SongsEdit({ rows, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      {rows.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 py-2" style={{ borderBottom: '1px solid var(--app-line)' }}>
          <input className={`${INPUT} flex-1 basis-40`} value={s.title || ''} aria-label="찬양 제목"
            onChange={e => set(i, { title: e.target.value })} placeholder="예: 주 은혜임을" />
          <input className={`${INPUT} flex-1 basis-40`} value={s.link || ''} aria-label="찬양 링크"
            onChange={e => set(i, { link: e.target.value })} placeholder="링크(선택)" />
          <span className={`${ROW} shrink-0`}>
            <RowTools index={i} total={rows.length} what="찬양"
              onMove={(a, b) => onChange(moveAt(rows, a, b))}
              onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
          </span>
        </div>
      ))}
      <AddRow label="찬양 추가" onClick={() => onChange([...rows, { title: '', link: '' }])} />
    </div>
  );
}

function NoticesEdit({ rows, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      {rows.map((n, i) => (
        <div key={i} className="py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
          <div className={`${ROW}`}>
            <input className={`${INPUT} flex-1 max-w-[42rem]`} value={n.title || ''} aria-label="광고 제목"
              onChange={e => set(i, { title: e.target.value })} placeholder="예: 겨울 수련회 신청" />
            <RowTools index={i} total={rows.length} what="광고"
              onMove={(a, b) => onChange(moveAt(rows, a, b))}
              onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
          </div>
          <textarea className={`${INPUT} w-full max-w-[42rem] mt-1.5 resize-y min-h-[3.5rem]`} value={n.body || ''} aria-label="광고 내용"
            onChange={e => set(i, { body: e.target.value })} placeholder="예: 1월 20일까지 순장에게 신청해주세요" />
        </div>
      ))}
      <AddRow label="광고 추가" onClick={() => onChange([...rows, { title: '', body: '' }])} />
    </div>
  );
}

// ── 내 예배 노트 ─────────────────────────────────────────────────────────────
// 예배마다 한 건, 기본은 나만 본다. 남의 노트는 여기 오지 않는다(결정 7).
function MyNote({ note, onSave }) {
  const [body, setBody] = useState(note?.body || '');
  const [shared, setShared] = useState(!!note?.shared_to_sun);
  const [state, setState] = useState('');       // '' | 'saving' | 'saved'
  const dirty = useRef(false);

  useEffect(() => { setBody(note?.body || ''); setShared(!!note?.shared_to_sun); dirty.current = false; }, [note]);

  // 글은 디바운스, 공유 토글은 바로 — 토글은 한 번 누르는 조작이라 기다릴 이유가 없다
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(async () => {
      setState('saving');
      const ok = await onSave({ body, sharedToSun: shared });
      setState(ok ? 'saved' : '');
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [body, shared, onSave]);

  const toggleShare = async () => {
    const next = !shared;
    setShared(next); dirty.current = true;
    setState('saving');
    const ok = await onSave({ body, sharedToSun: next });
    setState(ok ? 'saved' : '');
  };

  return (
    <section className="worship-note mt-7 max-w-[42rem]">
      <div className="flex items-center gap-2 pb-2.5">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">내 예배 노트</h3>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        {/* 노트는 발행이라는 것이 없다 — 저장되면 그것으로 끝이라 '임시'가 아니다 */}
        <SaveState state={state} />
      </div>
      <textarea
        value={body}
        onChange={e => { dirty.current = true; setBody(e.target.value); }}
        aria-label="내 예배 노트"
        placeholder="예: 오늘 말씀에서 마음에 남은 구절"
        className={`${INPUT} w-full resize-y min-h-[7rem] leading-relaxed`}
      />
      <label className="mt-2 inline-flex items-center gap-2 cursor-pointer select-none">
        <button type="button" role="switch" aria-checked={shared} aria-label="내 순에 공유"
          onClick={toggleShare}
          className="w-9 h-5 rounded-full transition-colors relative shrink-0"
          style={{ background: shared ? 'var(--app-accent)' : 'var(--app-line)' }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: shared ? '1.125rem' : '0.125rem' }} />
        </button>
        <span className="text-[12px] text-fg-secondary">내 순에 공유</span>
      </label>
    </section>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
export function ServiceDetail({
  service, people = [], perms = {}, note = null, canWriteNote = false, startEditing = false,
  onBack, onSave, onPublish, onDelete, onSaveNote, onOpenAttendance,
}) {
  const [tab, setTab] = useState('word');
  const [draft, setDraft] = useState(null);     // null이면 보기 모드
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved'
  const dirty = useRef(false);
  const editing = draft !== null;
  const shown = editing ? draft : service;
  const rows = (k) => (Array.isArray(shown?.[k]) ? shown[k] : []);
  const set = (patch) => { dirty.current = true; setDraft(d => ({ ...d, ...patch })); };

  const draftOf = (s) => ({
    ...s,
    roles: Array.isArray(s?.roles) ? s.roles : [],
    songs: Array.isArray(s?.songs) ? s.songs : [],
    notices: Array.isArray(s?.notices) ? s.notices : [],
  });

  // 만들자마자 수정 화면으로 들어온다(사용자 결정) — 새 주보는 열자마자 빈 칸이라
  // '수정'을 한 번 더 누르게 할 이유가 없다.
  useEffect(() => {
    dirty.current = false; setSaveState(''); setTab('word');
    setDraft(startEditing && perms.canEdit ? draftOf(service) : null);
    // 주보가 바뀔 때만 — startEditing은 그때 부르는 쪽이 정해서 넘긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  // 편집 중에는 저절로 저장된다(사용자 결정) — 노트·출석 메모와 같은 디바운스다.
  useEffect(() => {
    if (!editing || !dirty.current) return undefined;
    const t = setTimeout(async () => {
      setSaveState('saving');
      const ok = await onSave(patchOf(draft));
      setSaveState(ok ? 'saved' : '');
      if (ok) dirty.current = false;
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, editing, onSave]);

  if (!service) return null;
  const isDraft = service.status !== 'published';
  const canAttend = perms.canCheck && attendanceOpen(service);

  // 기다리지 않고 지금 저장하고 보기 모드로
  const saveNow = async () => {
    setBusy(true);
    setSaveState('saving');
    const ok = await onSave(patchOf(draft));
    setBusy(false);
    setSaveState(ok ? 'saved' : '');
    if (ok) { dirty.current = false; setDraft(null); }
  };

  // 편집 중에 나가면 아직 안 넘어간 글자를 먼저 넘긴다(디바운스가 씹히지 않게)
  const leave = async () => {
    if (editing && dirty.current) { dirty.current = false; await onSave(patchOf(draft)); }
    onBack();
  };

  return (
    <div className="worship-detail dc-screen pb-10">
      {/* 상시 도구 줄 — 확정 왼쪽 / 나가기 오른쪽(§8). '수정'과 '저장'이 같은 자리에 선다 */}
      <div className="flex items-center gap-1.5 mb-4">
        {perms.canEdit && (editing ? (
          <button type="button" onClick={saveNow} disabled={busy}
            className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">저장</button>
        ) : (
          <button type="button" onClick={() => { dirty.current = false; setSaveState(''); setDraft(draftOf(service)); }}
            className="px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95">수정</button>
        ))}
        {perms.canEdit && !editing && isDraft && (
          <ConfirmPopover tone="ok" confirmLabel="발행하기" message="발행하면 모두가 이 주보를 볼 수 있어요."
            onConfirm={onPublish}>
            <button type="button"
              className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">발행하기</button>
          </ConfirmPopover>
        )}
        {perms.canEdit && editing && (
          <ConfirmPopover message="이 주보를 삭제할까요? 적어 둔 내용도 같이 사라져요." onConfirm={onDelete}>
            <button type="button" className="px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">삭제</button>
          </ConfirmPopover>
        )}
        {/* 저장은 저절로 되므로 그 사실이 눈에 보여야 한다(노트 라벨과 같은 톤).
            발행 전에는 '임시' — 저장은 됐지만 아직 나만 본다는 뜻이 같이 담긴다 */}
        <SaveState state={saveState} savedLabel={isDraft ? '임시 저장되었어요' : '저장되었어요'} />
        <span className="flex-1" />
        <button type="button" onClick={leave}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">
          <ArrowLeft size={13} /> 목록으로
        </button>
      </div>

      {/* 머리줄 — 왼쪽에 종류·날짜, 오른쪽에 출석 체크(사용자 지적: 아래에 두니 공백이 남았다) */}
      <header className="flex items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(service.kind)}</span>
          {isDraft && <span className="worship-draft-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>}
          <span className="text-[11.5px] text-fg-muted">{formatServiceDate(service.service_date)}</span>
        </div>
        <span className="flex-1" />
        {/* 출석은 발행된 뒤, 예배 날짜가 지난 뒤에만 만진다(사용자 결정) */}
        {canAttend && !editing && (
          <button type="button" onClick={onOpenAttendance}
            className="worship-att-open shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-line text-[11.5px] font-semibold text-fg transition active:scale-95 hover:bg-surface-hover">
            <ClipboardCheck size={13} /> 출석 체크
          </button>
        )}
      </header>

      <div className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock" style={{ borderBottom: '1px solid var(--app-line)' }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-selected={tab === t.id}
            className={`worship-tab shrink-0 px-3 py-2 text-[12.5px] font-semibold transition-colors ${tab === t.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            style={{ borderBottom: `2px solid ${tab === t.id ? 'var(--app-ink)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="worship-tabpanel">
        {tab === 'word' && (editing ? <WordEdit draft={draft} set={set} /> : <WordTab service={service} />)}
        {tab === 'roles' && (editing
          ? <RolesEdit rows={rows('roles')} people={people} onChange={v => set({ roles: v })} />
          : <RolesTab rows={rows('roles')} people={people} />)}
        {tab === 'songs' && (editing
          ? <SongsEdit rows={rows('songs')} onChange={v => set({ songs: v })} />
          : <SongsTab rows={rows('songs')} />)}
        {tab === 'notices' && (editing
          ? <NoticesEdit rows={rows('notices')} onChange={v => set({ notices: v })} />
          : <NoticesTab rows={rows('notices')} />)}
      </div>

      {canWriteNote && !editing && <MyNote note={note} onSave={onSaveNote} />}
    </div>
  );
}
