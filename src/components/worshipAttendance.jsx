import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, X } from 'lucide-react';
import { groupRoster, countPresent, canToggleGroup, kindLabel, formatServiceDate, attendanceOpen } from '../services/worship.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import { BTN, BTN_QUIET } from './groupsParts.jsx';
import { SaveState, BTN_SOFT } from './worshipDetail.jsx';

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
//
// **예배가 시작하기 전에도 이 화면에 들어온다**(사용자 결정 2026-09-05) — 명단을 미리
// 훑을 수 있어야 하니까. 다만 체크는 그날 13:30(KST)부터다(services의 attendanceOpen ·
// ATTEND_OPEN_HM). 그 전에는 사람 칩과 '미등록 출석자 추가'가 잠기고, **왜 잠겼는지를
// 한 마디로 말한다**('아직 예배 전이에요' — 사용자가 문구까지 정했다. §8의 안내 줄
// 금지는 사용법 설명을 두고 하는 말이고, 이건 잠긴 이유다).
//
// 열리는 순간은 화면이 스스로 넘는다 — `useMinuteTick`이 1분마다 다시 그린다. 그것이
// 없으면 13:25에 들어온 사람은 새로고침할 때까지 계속 잠겨 있다.
//
// **미등록 출석자는 명단이 아니라 그 예배의 손님이다**(0053 · 사용자 결정 2026-09-07).
// 이름만 `attendance_guests`에 남고 ×로 지운다 — 청년 명단(people)에 올리는 것은 마스터의
// 일이다. 손님은 언제나 출석이라 사람 칩처럼 켜고 끄지 않는다.
//
// **출석 메모는 노트처럼 읽기/편집 두 모드다**(사용자 요청 2026-09-08: "출석 메모도
// 노트처럼 저장하고 수정할 수 있는 구조로 — 지금은 저장이 된다 해도 저장의 기능을
// 제대로 하고 있는지를 모르겠음"). 아래 메모 구역 주석 참고.
// ============================================================================

// 편집 진입 버튼(연한 accent)은 내 예배 노트의 '수정'과 **같은 한 벌**을 그대로 받아
// 쓴다(worshipDetail의 BTN_SOFT) — 예전에는 같은 글자를 두 파일에 각자 적어 두어서
// 한쪽만 고쳐질 자리였다. 저장 상태 칩(SaveState)도 그 파일에서 온다.

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

// 손님 칩 — 이름 + × 하나. **확인 팝오버를 붙이지 않는다**(알림 지우기와 같은 판단 · §8):
// 잃는 것이 이름 한 줄이고 다시 적는 데 두 번의 조작이면 되는데, 확인이 붙으면 출석을
// 부르는 동안 누르는 횟수가 두 배가 된다. 대신 실패하면 부르는 쪽이 칩을 되돌려 놓는다.
function GuestChip({ guest, disabled, onRemove }) {
  return (
    <span className="att-guest inline-flex items-center gap-0.5 pl-2.5 pr-1 py-1 rounded-full text-[12px] font-semibold"
      style={{ background: 'var(--app-accent-weak)', color: 'var(--app-accent-text)', border: '1px solid var(--app-accent)' }}>
      {guest.name}
      <button type="button" disabled={disabled} onClick={() => onRemove(guest)}
        aria-label={`${guest.name} 지우기`} title="지우기"
        className="att-guest-del shrink-0 p-1 rounded-full transition-colors hover:bg-surface disabled:opacity-40">
        <X size={11} />
      </button>
    </span>
  );
}

export function AttendanceScreen({
  service, roster, present, guests = [], perms = {}, onToggle, onAddGuest, onRemoveGuest, onSaveNote, onBack,
}) {
  useMinuteTick();
  const checkOpen = attendanceOpen(service);   // 체크가 열렸나(묶음 펼침 open과 다른 값이다)
  const buckets = useMemo(() => groupRoster(roster), [roster]);
  const [closed, setClosed] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // ── 출석 메모 (0052 · 읽기/편집 두 모드) ──────────────────────────────────
  // 저장된 글은 `service.attendance_note`가 진실이다 — 부르는 쪽(worshipView)이 저장에
  // 성공하면 그 칸을 갈아 끼운다. 화면이 따로 들고 있는 것은 **고치는 중인 글**뿐이다.
  const savedNote = service?.attendance_note || '';
  const [note, setNote] = useState(savedNote);
  const [noteState, setNoteState] = useState('');     // '' | 'saving' | 'saved'
  const [noteBusy, setNoteBusy] = useState(false);
  // 저장된 메모가 없으면 처음부터 편집기다 — 빈 읽기 상자를 세울 이유가 없다(내 노트와 같다)
  const [editingNote, setEditingNote] = useState(!savedNote);
  const noteDirty = note !== savedNote;
  const readingNote = !!savedNote && !editingNote;

  // 다른 주보를 열거나 저장된 값이 새로 오면 고치던 글을 그 값으로 되돌리고 읽기로 나간다.
  // `noteState`는 건드리지 않는다 — 저장이 끝나면 부르는 쪽이 attendance_note를 갈아
  // 끼우므로, 여기서 비우면 방금 켠 '저장되었어요'가 같은 프레임에 지워진다(MyNote와 같은 함정).
  useEffect(() => { setNote(savedNote); setEditingNote(!savedNote); }, [service?.id, savedNote]);

  const saveNote = async () => {
    if (noteBusy || !noteDirty) return;
    setNoteBusy(true); setNoteState('saving');
    const ok = await onSaveNote(note);
    setNoteBusy(false); setNoteState(ok ? 'saved' : '');
    if (ok) setEditingNote(false);
  };
  // 취소는 저장된 글로 되돌리고 읽기 모드로 나간다(고치던 것을 버린다)
  const cancelNote = () => { setNote(savedNote); setNoteState(''); setEditingNote(false); };

  const total = (roster?.people || []).length;
  const here = countPresent(roster?.people || [], present);

  const add = async () => {
    const name = newName.trim();
    if (!name || busy || !checkOpen) return;
    setBusy(true);
    const made = await onAddGuest(name);
    setBusy(false);
    // 잇달아 여러 명을 적는 일이 흔하다 — 칸은 비우되 닫지 않는다
    if (made) setNewName('');
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
        <p className="att-total mt-3 flex flex-wrap items-center gap-2 text-[13px] font-bold text-fg tabular-nums">
          <span>전체 <span className="text-accent-text">{here}</span>/{total}</span>
          {/* 손님은 명단 밖이라 분모에 넣을 수 없다 — 도막을 따로 붙인다(0053) */}
          {guests.length > 0 && <span className="att-guest-count font-semibold text-fg-muted">· 손님 {guests.length}</span>}
          {/* 잠긴 이유 — 예배 시작(13:30) 전에는 체크가 안 된다 */}
          {!checkOpen && (
            <span className="att-not-yet px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">
              아직 예배 전이에요
            </span>
          )}
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
                  <PersonChip key={p.id} person={p} on={present.has(p.id)} disabled={!can || !checkOpen} onToggle={onToggle} />
                ))}
                {!g.people.length && <p className="text-[12px] text-fg-faint py-1">이 순에 편성된 사람이 아직 없어요</p>}
              </div>
            )}
          </section>
        );
      })}

      {/* 미등록 출석자 — 순 묶음 아래 한 구역이다(0053). 명단에 올리는 것이 아니라 그 예배의
          손님으로만 남고, 자격은 출석을 체크할 수 있는 사람이다(RLS가 같은 경계 · 0053). */}
      <section className="att-guests mt-5">
        <div className="flex items-center gap-2 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
          <span className="flex-1 min-w-0 text-[13px] font-bold text-fg truncate">미등록 출석자</span>
          <span className="shrink-0 text-[11.5px] text-fg-muted tabular-nums">{guests.length}</span>
        </div>
        {guests.length > 0 && (
          <div className="att-guest-body flex flex-wrap gap-1.5 py-2.5">
            {guests.map(g => (
              <GuestChip key={g.id} guest={g} disabled={!perms.canCheck || !checkOpen}
                onRemove={onRemoveGuest} />
            ))}
          </div>
        )}
        <div className="mt-2.5">
          {adding ? (
            <div className="flex items-center gap-1.5 max-w-[26rem]">
              <input
                autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                aria-label="미등록 출석자 이름" placeholder="예: 다붓이"
                className="flex-1 min-w-0 text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint" />
              <button type="button" onClick={add} disabled={busy || !newName.trim() || !checkOpen}
                className="att-add-do shrink-0 px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">추가</button>
              <button type="button" onClick={() => { setAdding(false); setNewName(''); }}
                className="shrink-0 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">닫기</button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} disabled={!checkOpen}
              className="att-add-open inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40 disabled:active:scale-100">
              <Plus size={13} /> 미등록 출석자 추가
            </button>
          )}
        </div>
      </section>

      {/* 출석 메모는 **출석을 체크할 수 있는 사람**이 쓴다 — 순장도 쓴다(사용자 결정
          2026-09-06: "출석 메모는 주보를 편집하는 건 아니라고 생각해서"). 잠깐 주보 편집
          자격자에게만 세웠던 자리다: 저장 자리가 주보 행의 한 칸이라 저장 경로가
          saveService → services_write(can_edit_service)여서 순장이 쓴 메모가 한 줄도 남지
          않았다. 지금은 그 한 칸만 쓰는 rpc로 간다(0052 · services/worship.js
          saveAttendanceNote) — 그래서 화면 게이트도 출석 자격(canCheck)과 같아졌다. */}
      {/* **내 예배 노트와 같은 읽기/편집 구조다**(사용자 요청 2026-09-08). 예전에는
          디바운스 자동 저장이라 저장 표시가 잠깐 켜졌다 사라질 뿐이었고, 남은 화면은
          쓰는 중인지 저장된 것인지 구분이 없는 편집기 한 칸이었다 — "저장이 된다 해도
          저장의 기능을 제대로 하고 있는지를 모르겠음". 지금은 저장된 메모가 상자 안에
          그대로 서고(읽기), '수정'을 눌러야 편집기가 열린다.
          도구 줄은 §8 그대로다 — 확정 왼쪽 / 나가기 오른쪽, 두 모드에서 같은 자리:
            읽기  `[수정(연한 accent)]`
            편집  `[저장(진한 accent)] … [취소(무채색)]`
          **비운 메모도 저장이다** — 잘못 적은 줄을 지우는 것도 사람이 뜻한 저장이라,
          잠그는 조건은 '바뀐 것이 없을 때'뿐이다. */}
      {/* **폭 상한을 두지 않는다**(§6-9-k). `max-w-[42rem]`이던 때는 1440에서 이 구역만
          672px에서 멈춰 오른쪽 726px이 통째로 비었다 — 같은 화면의 순 묶음·손님 줄은
          트랙을 다 쓰고 있어서 메모 칸만 반쪽으로 남았다. 주보 상세의 내 예배 노트도
          폭을 다 쓴다(같은 자리에 같은 규칙). 이미 두 번 밟은 함정이다(주보 편집 폼의
          46rem · 본문 보기의 42rem). */}
      {perms.canCheck && (
        <section className="att-note mt-7">
          <div className="flex items-center gap-2 pb-2.5">
            <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">출석 메모</h3>
            <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
            {/* 주보 편집·예배 노트와 같은 저장 표시 한 벌(worshipDetail의 SaveState) */}
            <SaveState state={noteState} />
          </div>
          {readingNote ? (
            // 상자 모양은 노트 읽기 상자와 같고 높이만 편집기와 맞춘다(min-h-[4.5rem]) —
            // 두 모드를 오갈 때 아래 것들이 튀지 않게. 노트와 달리 마크다운이 아니라
            // 적은 그대로의 글이라 whitespace-pre-line으로 줄바꿈만 살린다.
            <div className="att-note-read min-h-[4.5rem] border border-line rounded-md p-3 bg-surface">
              <p className="text-[13px] leading-relaxed text-fg-secondary whitespace-pre-line break-words">{savedNote}</p>
            </div>
          ) : (
            <textarea
              value={note} onChange={e => { setNoteState(''); setNote(e.target.value); }}
              aria-label="출석 메모" placeholder="예: 오늘은 새신자가 두 명 왔어요"
              className="att-note-box w-full resize-y min-h-[4.5rem] text-[13px] px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint leading-relaxed" />
          )}
          <div className="att-note-tools mt-2.5 flex items-center gap-2">
            {readingNote ? (
              <button type="button" onClick={() => setEditingNote(true)}
                className={`att-note-edit ${BTN_SOFT}`}>수정</button>
            ) : (
              <button type="button" onClick={saveNote} disabled={!noteDirty || noteBusy}
                className={`att-note-save ${BTN}`}>저장</button>
            )}
            {/* 되돌아갈 글이 있을 때만 뜬다 — 처음 적는 메모에는 취소할 것이 없다 */}
            {!readingNote && !!savedNote && (
              <button type="button" onClick={cancelNote}
                className={`att-note-cancel ml-auto ${BTN_QUIET}`}>취소</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
