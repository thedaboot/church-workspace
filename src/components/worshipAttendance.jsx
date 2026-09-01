import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus } from 'lucide-react';
import { groupRoster, countPresent, canToggleGroup, kindLabel, formatServiceDate } from '../services/worship.js';

// ============================================================================
// 예배 출석 체크 (docs/V2.md 결정 6 · 0035·0036)
// ----------------------------------------------------------------------------
// 자격은 두 겹이다. 전체 자격자(관리자·교역자·올해 임원)는 전원을, 순장은 **자기 순만**
// 만진다. 다른 순은 보이되 눌리지 않는다 — 감추면 "누가 몇 명 왔나"를 못 보게 된다.
// 화면이 감추는 것은 진입 버튼뿐이고, 실제 경계는 RLS다(0036 attendance 정책).
//
// 사람 축은 계정이 아니라 **명단(people)** 이다(0035). 순 편성은 그 예배 날짜의 연도
// 것을 쓴다 — 순은 해마다 다시 짜므로 지난 예배를 열면 그 시절 순으로 서야 한다.
//
// 실시간 반영은 이 회차에 넣지 않는다(사용자 결정) — 열 때 조회 + 낙관적 갱신이다.
// ============================================================================

const NOTE_DELAY = 900;

function PersonChip({ person, on, disabled, onToggle }) {
  return (
    <button
      type="button" disabled={disabled} aria-pressed={on}
      onClick={() => onToggle(person.id, !on)}
      className={`att-chip px-2.5 py-1.5 rounded-full text-[12px] font-semibold transition active:scale-95 disabled:active:scale-100 ${disabled ? 'opacity-40 cursor-default' : ''}`}
      style={on
        ? { background: 'var(--app-accent-weak)', color: 'var(--app-accent-text)', border: '1px solid var(--app-accent)' }
        : { background: 'var(--app-surface)', color: 'var(--app-ink-muted)', border: '1px solid var(--app-line)' }}
    >
      {person.name}
    </button>
  );
}

export function AttendanceScreen({
  service, roster, present, perms = {}, onToggle, onAddPerson, onSaveNote, onBack,
}) {
  const buckets = useMemo(() => groupRoster(roster), [roster]);
  const [closed, setClosed] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(service?.attendance_note || '');
  const [noteState, setNoteState] = useState('');
  const dirty = useRef(false);

  useEffect(() => { setNote(service?.attendance_note || ''); dirty.current = false; }, [service?.id]);
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(async () => {
      setNoteState('저장하는 중');
      const ok = await onSaveNote(note);
      setNoteState(ok ? '저장했어요' : '');
    }, NOTE_DELAY);
    return () => clearTimeout(t);
  }, [note, onSaveNote]);

  const total = (roster?.people || []).length;
  const here = countPresent(roster?.people || [], present);

  const add = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const made = await onAddPerson(name);
    setBusy(false);
    if (made) { setNewName(''); setAdding(false); }
  };

  return (
    <div className="worship-attendance dc-screen pb-10">
      <div className="flex items-center gap-1.5 mb-4">
        <span className="flex-1" />
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">
          <ArrowLeft size={13} /> 주보로
        </button>
      </div>

      <header className="mb-5">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">출석 체크</h2>
        <p className="mt-1 text-[11.5px] text-fg-muted">
          {kindLabel(service?.kind)} · {formatServiceDate(service?.service_date)}
        </p>
        <p className="att-total mt-3 text-[13px] font-bold text-fg tabular-nums">
          전체 <span className="text-accent-text">{here}</span>/{total}
        </p>
      </header>

      {buckets.map(g => {
        const open = !closed.has(String(g.id));
        const can = canToggleGroup(perms, g.id);
        return (
          <section key={String(g.id)} className="mb-2.5">
            <button type="button" className="att-group-head w-full flex items-center gap-2 py-2.5 text-left"
              aria-expanded={open}
              onClick={() => setClosed(prev => {
                const next = new Set(prev);
                next.has(String(g.id)) ? next.delete(String(g.id)) : next.add(String(g.id));
                return next;
              })}
              style={{ borderBottom: '1px solid var(--app-line)' }}>
              <ChevronDown size={14} className="shrink-0 text-fg-faint transition-transform"
                style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
              <span className="flex-1 min-w-0 text-[13px] font-bold text-fg truncate">{g.name}</span>
              <span className="shrink-0 text-[11.5px] text-fg-muted tabular-nums">
                {countPresent(g.people, present)}/{g.people.length}
              </span>
            </button>
            {open && (
              <div className="att-group-body flex flex-wrap gap-1.5 py-2.5">
                {g.people.map(p => (
                  <PersonChip key={p.id} person={p} on={present.has(p.id)} disabled={!can} onToggle={onToggle} />
                ))}
                {!g.people.length && <p className="text-[12px] text-fg-faint py-1">이 순에 편성된 사람이 아직 없어요</p>}
              </div>
            )}
          </section>
        );
      })}

      {/* 새신자는 그 자리에서 명단에 올린다(결정 6) — 출석 자격자면 RLS가 통과시킨다(0035) */}
      <div className="mt-5">
        {adding ? (
          <div className="flex items-center gap-1.5 max-w-[26rem]">
            <input
              autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              aria-label="미등록 출석자 이름" placeholder="예: 김철수"
              className="flex-1 min-w-0 text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
            <button type="button" onClick={add} disabled={busy || !newName.trim()}
              className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">추가</button>
            <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
              className="px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">취소</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="att-add-open inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95">
            <Plus size={13} /> 미등록 출석자 추가
          </button>
        )}
      </div>

      <section className="mt-7 max-w-[42rem]">
        <div className="flex items-center gap-2 pb-2.5">
          <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">출석 메모</h3>
          <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
          <span className="text-[10.5px] text-fg-faint">{noteState}</span>
        </div>
        <textarea
          value={note} onChange={e => { dirty.current = true; setNote(e.target.value); }}
          aria-label="출석 메모" placeholder="예: 오늘은 새신자가 두 명 왔어요"
          className="w-full resize-y min-h-[4.5rem] text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint leading-relaxed" />
      </section>
    </div>
  );
}
