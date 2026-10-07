import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Trash2 } from 'lucide-react';
import { formatDay, generateId, subtaskProgress, imeComposing } from '../utils.js';
import { matchSubtask, namesLabel, formatActionLine } from '../services/actionItems.js';
import { Bar } from '../views/dashboardParts.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { OwnerPicker, FaceStack, useNameDraft } from './taskFields.jsx';

// ============================================================================
// 업무 창의 목록 둘 — 청년별 담당 업무(ActionItems · 본문 도막) · 하위 업무(SubtaskList · cards.subtasks)와
// 그 이름 칸(SubtaskTitle). 새 업무 폼 · 보기 · 수정 화면(modals.jsx)이 같이 쓴다.
// 줄 짜임은 두 목록이 같은 order/basis 한 벌이다(아래 각 머리말).
// ============================================================================

// ── 청년별 담당 업무 (2026-09-21 요청 · 2026-09-22 그릴링으로 다시 짰다) ──────
// 다듬기가 회의록·기획안에서 "누가 · 무엇을 · 언제까지"를 뽑아 두는데, 그게 본문 글자로만
// 남아서 손으로 하위 업무를 만들지 않으면 그대로 사라졌다.
//
// **저장 자리는 본문 그 도막 하나다**(새 칸을 만들지 않았다 · §3-1). 부품은 그것을 읽고
// (parseActionItems) 고친 결과를 도로 적는다(writeActionSection). 편집기 본문에서는 그
// 도막을 감춘다 — 고치는 길이 둘이면 두 글이 어긋난다.
//
// **줄은 빈 것도 들고 있어야 한다.** writeActionSection은 할 일이 빈 줄을 버리므로(본문에
// `- ` 껍데기를 남기지 않는다), 부모가 준 items만 그리면 `＋ 항목 추가`가 만든 빈 줄이
// 그 자리에서 사라진다 — 실제로 "항목 추가가 되지도 않는다"로 보였다(2026-09-22).
// 그래서 **여기서 줄을 들고 있고**, 바깥 글이 정말 달라졌을 때만 다시 읽는다.
//
// 줄 짜임(사용자 요청 "데스크톱·모바일 모두 잘 들어와야 한다"):
//   좁은 화면 → 첫 줄 [체크][사람] … [✕] · 둘째 줄 [할 일][날짜]
//   넓은 화면 → 한 줄 [체크][사람][할 일][날짜][✕]
// order와 basis로 가른다 — 같은 마크업 한 벌이라 두 폭이 어긋날 자리가 없다.
//
// **내린 줄은 여기 없다**(2026-09-24 그릴링 — "체크해서 내린 것만 하위에 쌓이고, 위에는
// 안 내린 것만"). '하위 업무로'는 그 줄을 **본문 도막에서 지우고** cards.subtasks로 옮긴다
// (onCreate(만든 것, 남은 줄)). 그 뒤로 사람·기한은 아래 SubtaskList가 고친다 — 본문에
// 옛 이름이 남아 AI 요약이 그걸 읽는 일이 없게. 다듬기를 다시 돌려 같은 제목이 또
// 뽑히면 matchSubtask로 거른다(그 줄도 다음에 내릴 때 같이 걷힌다).
// `ops`(같이 쓰기 · 업무 창) — 줄을 Yjs 배열에서 읽고 줄 단위로 고친다(add·update·remove). 그때는 items가
// 곧 원본이고 빈 줄도 배열에 그대로 있어서 이 부품이 줄을 따로 들 까닭이 없다(위 '빈 줄' 문제가 없다).
export function ActionItems({ items = [], subtasks = [], members = [], editable = false, onChange, onCreate, ops = null }) {
  const [rows, setRows] = useState(items);
  // 내가 적어 보낸 것이 그대로 돌아왔으면 그냥 둔다(빈 줄이 살아남는다).
  // 다듬기·되돌리기처럼 **바깥에서 글이 바뀌었을 때만** 다시 읽는다.
  const sameAsMine = useMemo(() => {
    const sig = (rs) => rs.filter(r => String(r?.what || '').trim()).map(formatActionLine).join('\n');
    return sig(rows) === sig(items);
  }, [rows, items]);
  useEffect(() => { if (!sameAsMine) setRows(items); }, [items]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = ops ? items : (editable ? rows : items);
  const pending = useMemo(() => shown.filter(it => !matchSubtask(it, subtasks)), [shown, subtasks]);
  // 고른 것 — 열 때는 아직 업무가 아닌 것이 전부 골라져 있다(대개 다 만든다).
  const [off, setOff] = useState(() => new Set());
  const keyOf = (it, i) => (ops ? it.id : it.raw) || `row-${i}`;
  const picked = pending.filter((it, i) => String(it?.what || '').trim() && !off.has(keyOf(it, i)));

  if (!pending.length) return null;

  const push = (next) => { setRows(next); onChange?.(next); };
  const toggle = (k) => setOff(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const setAt = (i, patch) => (ops ? ops.update(shown[i].id, patch) : push(shown.map((it, k) => (k === i ? { ...it, ...patch } : it))));
  const removeAt = (i) => (ops ? ops.remove(shown[i].id) : push(shown.filter((_, k) => k !== i)));
  const addRow = () => {
    const row = { names: [], name: '', what: '', dueText: '', dueDate: '', raw: ops ? '' : `새 줄 ${Date.now()}` };
    if (ops) ops.add(row); else push([...shown, row]);
  };
  const make = () => {
    if (!picked.length) return;
    // 남는 줄 = 안 고른 것 중 아직 업무가 아닌 것(이미 하위 업무인 줄도 이참에 걷는다)
    const rest = shown.filter(it => !picked.includes(it) && !matchSubtask(it, subtasks));
    onCreate?.(picked.map(it => ({
      id: generateId(), title: it.what, done: false,
      // 이름·기한을 같이 옮긴다(2026-09-22) — 없는 줄은 그냥 비어 있다
      ...(it.names?.length ? { assignee: it.names.join(', ') } : {}),
      ...(it.dueDate ? { due: it.dueDate } : {}),
    })), rest);
    if (!ops) setRows(rest);
    setOff(new Set());
  };

  return (
    <div className="action-items mt-4">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <label className="block text-xs text-fg-muted shrink-0">청년별 담당 업무</label>
        {picked.length > 0 && (
          <span className="inline-flex items-center h-[22px] px-2.5 rounded-full bg-tag-blue text-tag-blue-fg text-[11px] font-semibold">
            선택된 하위 업무 {picked.length}개
          </span>
        )}
      </div>
      <div className="divide-y divide-line/60 border-y border-line">
        {shown.map((it, i) => {
          // 내린 줄은 그리지 않는다 — i는 shown의 자리 그대로라 setAt·removeAt이 안 어긋난다
          if (matchSubtask(it, subtasks)) return null;
          const k = keyOf(it, i);
          const on = !!String(it?.what || '').trim() && !off.has(k);
          return (
            <div key={k} className="flex flex-wrap items-center gap-2 py-2">

              {/* ① 체크 + 담당자 — 두 폭 모두 맨 앞 */}
              <span className="order-1 flex items-center gap-2 min-w-0">
                <input type="checkbox" checked={on} onChange={() => toggle(k)}
                  disabled={!String(it?.what || '').trim()}
                  aria-label={`${it.what || '이 줄'} 고르기`}
                  className="action-check shrink-0 disabled:opacity-40" />
                {editable ? (
                  <OwnerPicker names={it.names || []} members={members}
                    onChange={(names) => setAt(i, { names, name: names[0] || '' })} />
                ) : (it.names?.length ? (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <FaceStack names={it.names} size="w-[22px] h-[22px]" />
                    <span className="text-xs font-semibold text-fg truncate">{namesLabel(it.names)}</span>
                  </span>
                ) : null)}
              </span>

              {/* ③ 지우기 — 좁을 때는 첫 줄 오른쪽 끝, 넓을 때는 줄의 맨 끝 */}
              <span className="order-2 sm:order-3 ml-auto sm:ml-0 flex items-center gap-1 shrink-0">
                {editable && (
                  <button type="button" onClick={() => removeAt(i)} aria-label="이 줄 지우기"
                    className="p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95">
                    <X size={13} />
                  </button>
                )}
              </span>

              {/* ② 할 일 + 기한 — 좁을 때는 **둘째 줄 통째로**, 넓을 때는 가운데를 채운다 */}
              <span className="order-3 sm:order-2 basis-full sm:basis-auto sm:flex-1 flex items-center gap-2 min-w-0">
                {editable ? (
                  <input value={it.what} onChange={(e) => setAt(i, { what: e.target.value })}
                    aria-label="할 일" placeholder="할 일"
                    className="flex-1 min-w-0 h-[34px] px-2.5 text-xs text-fg bg-surface border border-line rounded-md focus:border-accent outline-none transition-colors" />
                ) : (
                  <span className="flex-1 min-w-0 text-xs text-fg-secondary break-words">{it.what}</span>
                )}
                {editable ? (
                  <DatePicker value={it.dueDate || ''}
                    onChange={(v) => setAt(i, { dueDate: v, dueText: '' })}
                    ariaLabel="기한"
                    triggerClassName="shrink-0 inline-flex items-center gap-1 h-[34px] px-2.5 text-[11.5px] text-fg-muted bg-surface border border-line rounded-md hover:bg-surface-hover transition-colors whitespace-nowrap">
                    <span>{it.dueDate ? formatDay(it.dueDate) : '기한'}</span>
                  </DatePicker>
                ) : (it.dueText && <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">{it.dueText}</span>)}
              </span>

            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-2">
        {editable && (
          <button type="button" onClick={addRow}
            className="h-8 px-3 rounded-md border border-dashed border-line text-fg-muted text-xs font-semibold hover:bg-surface-hover transition active:scale-95">
            ＋ 항목 추가
          </button>
        )}
        <span className="flex-1" />
        {picked.length > 0 && (
          // 골랐을 때만 서는 버튼이라 불쑥 튀어나온다 — 아래에서 살짝 올라오며 든다
          <button type="button" onClick={make}
            className="h-9 px-4 rounded-md bg-accent hover:bg-accent-strong text-white text-xs font-semibold transition active:scale-95 animate-in fade-in slide-in-from-bottom-1 duration-200">
            하위 업무로
          </button>
        )}
      </div>
    </div>
  );
}

// ── 하위 업무 (체크리스트) ────────────────────────────────────────────────
// 사역 업무는 대개 여러 단계인데, 본문 마크다운 불릿으로 적으면 진척에 안 잡힌다.
// cards.subtasks(jsonb) 컬럼 하나로 둔다 — 카드와 언제나 같이 읽고 쓰므로 조인
// 테이블이 필요 없고, 컬럼 통째 쓰기라 저장이 겹쳐도 깨지지 않는다(0013에서
// 담당자를 조인으로 옮겼다가 겹친 저장이 duplicate key로 깨졌던 것과 반대 성질).
//
// 맡은 사람·기한(2026-09-24 그릴링): 담당 업무에서 내려온 줄은 이 둘을 들고 온다. 내린 뒤로는
// **여기가 기준이다** — 위와 같은 OwnerPicker·DatePicker로 고친다(모든 카드).
// assignee는 `'노준석, 박지호'` 글자로 둔다(0013 이후 jsonb 모양 그대로 — 칸을 늘리지 않았다).
// 줄 짜임은 ActionItems와 같은 order/basis 한 벌이다:
//   좁은 화면 → 첫 줄 [체크][사람] … [🗑] · 둘째 줄 [할 일][기한]
//   넓은 화면 → 한 줄 [체크][사람][할 일][기한][🗑]
//
// `onChange(fn, opts)` — fn은 (지금 목록 → 새 목록). **목록을 값으로 넘기지 않는다**: 업무 창(live)은
// 이름을 600ms 뒤에 저장하는데, 그때 이 부품이 들고 있던 목록으로 보내면 그 사이 남이 체크한 줄이 풀린다.
// 부르는 쪽이 지금 카드(스토어)에 fn을 건다. 새 업무 폼은 폼 state에 건다.
//
// `live`(업무 창 · 2026-09-28) — 체크·추가·지우기·사람·기한은 **바로** 저장되고, 이름은 SubtaskTitle이
// 초안을 들고 있다가 600ms 조용하거나 칸을 떠날 때 저장한다(글자마다 쓰지 않는다).
// **끝낸 줄의 이름은 글자(span)로 선다** — 방금 체크한 줄의 취소선을 긋는 자리가 그 글자다(PITFALLS 9-ch ·
// 입력칸에는 그릴 곳이 없다). 그 글자를 누르면 입력칸이 되어 고칠 수 있다.
const ownersOf = (s) => String(s?.assignee || '').split(',').map(x => x.trim()).filter(Boolean);

// `readOnly`(업무 창 보기 화면 · 2026-09-29 되살렸다) — 체크만 눌린다(바로 저장). 사람은 얼굴 + 이름, 기한은
// `M/D까지` 글자, 지우기·추가 칸·기한 고르기는 없다. 항목이 없으면 구역이 서지 않는다.
export function SubtaskList({ value = [], onChange, members = [], live = false, readOnly = false, register, hold }) {
  const [draft, setDraft] = useState('');
  const { total, done } = subtaskProgress(value);

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange(list => [...list, { id: generateId(), title: t, done: false }]);
    setDraft('');
  };
  // 작은 완료의 손맛(2026-09-25 · index.css `.dc-check-now`·`.dc-strike-now`) — **방금 체크한 줄만** 체크를
  // 선으로 그리고 취소선을 왼쪽에서 긋는다. 실시간으로 남이 체크한 줄·다시 연 창에는 이 값이 없어 그대로
  // 선다. 되돌리면 바로 지운다(움직임 없음). 취소선이 다 그어지면(animationend) 떼어 line-through로 돌아간다.
  const [justDone, setJustDone] = useState(null);
  const toggle = (id) => {
    const cur = value.find(s => s.id === id);
    setJustDone(cur && !cur.done ? id : null);
    onChange(list => list.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  };
  const rename = (id, title, opts) => onChange(list => list.map(s => (s.id === id ? { ...s, title } : s)), opts);
  // 비우면 키를 뺀다 — 손으로 더한 줄과 같은 모양({id,title,done})으로 돌아간다
  const patch = (id, key, v) => onChange(list => list.map(s => {
    if (s.id !== id) return s;
    const { [key]: _drop, ...rest } = s;
    return v ? { ...rest, [key]: v } : rest;
  }));
  const remove = (id) => onChange(list => list.filter(s => s.id !== id));

  // 읽기 전용인데 항목도 없으면 자리만 차지한다
  if (readOnly && !total) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <label className="block text-xs text-fg-muted shrink-0">하위 업무</label>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{done}/{total}</span>
        )}
        <span className="flex-1 min-w-[40px]"><Bar ratio={total ? done / total : 0} color="var(--p-blue)" height={3} /></span>
      </div>
      <div className="divide-y divide-line/60 border-y border-line">
        {value.map(s => {
          const owners = ownersOf(s);
          // 좁은 화면에서 할 일을 둘째 줄로 내리나 — 고치는 화면이거나 사람이 있을 때(보기에서 사람이 없으면 한 줄)
          const twoLine = !readOnly || owners.length > 0;
          const due = readOnly && s.due && (
            <span className={`shrink-0 text-[11px] tabular-nums whitespace-nowrap ${s.done ? 'text-fg-faint' : 'text-fg-muted'}`}>
              {formatDay(s.due)}까지
            </span>
          );
          return (
            <div key={s.id} className="subtask-row flex flex-wrap items-center gap-2 py-2">

              {/* ① 체크 + 맡은 사람 — 두 폭 모두 맨 앞 */}
              <span className="order-1 flex items-center gap-2 min-w-0">
                {/* 체크는 한 번에 눌린다 — 하위 업무를 끝낼 때마다 다른 조작을 거치게 하면 아무도 쓰지 않는다 */}
                <button
                  type="button" onClick={() => toggle(s.id)}
                  className="w-[18px] h-[18px] rounded-sm shrink-0 flex items-center justify-center transition-colors duration-[120ms]"
                  style={s.done
                    ? { background: 'var(--app-tag-green-fg)' }
                    : { border: '1.5px solid var(--app-line)' }}
                  aria-pressed={s.done} aria-label={`${s.title} ${s.done ? '완료 취소' : '완료'}`}
                >
                  {/* lucide Check와 같은 선이지만 pathLength=1이 있어야 선으로 그릴 수 있다 */}
                  {s.done && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden className={`w-[11px] h-[11px] text-white${justDone === s.id ? ' dc-check-now' : ''}`}>
                      <path pathLength="1" d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
                {readOnly ? (owners.length > 0 && (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <FaceStack names={owners} />
                    <span className={`text-xs font-semibold truncate ${s.done ? 'text-fg-faint' : 'text-fg'}`}>{namesLabel(owners)}</span>
                  </span>
                )) : (
                  <OwnerPicker names={owners} members={members}
                    onChange={(names) => patch(s.id, 'assignee', names.join(', '))} />
                )}
              </span>

              {/* ③ 기한(보기) · 지우기(고치기) — 좁을 때는 첫 줄 오른쪽 끝, 넓을 때는 줄의 맨 끝 */}
              <span className={`${twoLine ? 'order-2' : 'order-3'} sm:order-3 ml-auto sm:ml-0 flex items-center gap-1 shrink-0`}>
                {due}
                {/* 한 번 누르면 바로 지워졌다 — 체크박스 옆 작은 휴지통이라 잘못 누르기 쉽고,
                    하위 업무는 실행 취소가 없다. 삭제 확인은 §7대로 ConfirmPopover로 통일한다. */}
                {!readOnly && <ConfirmPopover
                  className="shrink-0 inline-flex"
                  title="이 하위 업무 삭제"
                  message={s.title.trim() ? `'${s.title.trim()}'을(를) 삭제할까요?` : '이 하위 업무를 삭제할까요?'}
                  onConfirm={() => remove(s.id)}
                >
                  <button type="button" aria-label={`${s.title || '이름 없는 하위 업무'} 삭제`}
                    className="p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors">
                    <Trash2 size={13} />
                  </button>
                </ConfirmPopover>}
              </span>

              {/* ② 할 일 + 기한 칩 — 좁을 때는 둘째 줄을 체크 폭만큼 들여서, 넓을 때는 가운데.
                  넓을 때 바탕 폭은 0(`sm:basis-0`)이다 — 글자 폭(basis-auto)이면 긴 이름이 줄을 넘겨 ③(휴지통·기한)이
                  다음 줄 왼쪽으로 떨어졌다(2026-10-07 · 사용자 승인). 남은 폭을 채우는 것은 같아 짧은 줄의 모양은 그대로다. */}
              <span className={`${twoLine ? 'order-3 basis-full pl-[26px]' : 'order-2 flex-1'} sm:order-2 sm:basis-0 sm:flex-1 sm:pl-0 flex items-center gap-2 min-w-0`}>
                {readOnly ? (
                  // 바깥은 자리(flex-1), 안은 **글자만큼인 인라인**이다 — 취소선을 그리는 요소가 줄 폭이면 줄 끝까지
                  // 그었다가 끝나는 순간 글자 폭으로 되돌아왔다(2026-09-28 사용자 지적). 인라인이라 여러 줄도 줄마다 글자 끝까지.
                  <span className="flex-1 min-w-0 text-[13px] break-words">
                    <span data-subtask-title=""
                      onAnimationEnd={(e) => { if (e.animationName === 'dc-strike' && justDone === s.id) setJustDone(null); }}
                      className={s.done ? `text-fg-faint line-through${justDone === s.id ? ' dc-strike-now' : ''}` : 'text-fg'}>{s.title}</span>
                  </span>
                ) : live ? (
                  <SubtaskTitle s={s} justDone={justDone === s.id} onStrikeEnd={() => setJustDone(null)}
                    onCommit={(title, release) => rename(s.id, title, { release })} register={register} hold={hold} />
                ) : (
                  // 새 업무 폼은 언제나 입력칸이다 — '눌러서 고치기'로 감추면 고칠 수 있다는 것 자체가 안 보인다
                  <input
                    value={s.title}
                    onChange={e => rename(s.id, e.target.value)}
                    placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
                    className={`flex-1 min-w-0 text-[13px] bg-transparent border border-transparent rounded-xs px-1.5 py-1 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface ${s.done ? 'text-fg-faint line-through' : 'text-fg'} placeholder:text-fg-faint`}
                  />
                )}
                {!readOnly && (
                  <DatePicker value={s.due || ''} onChange={(v) => patch(s.id, 'due', v)} ariaLabel="기한"
                    triggerClassName={`shrink-0 inline-flex items-center gap-1 h-[30px] px-2.5 text-[11.5px] text-fg-muted bg-surface border border-line rounded-md hover:bg-surface-hover transition-colors whitespace-nowrap ${s.due ? '' : 'border-dashed'}`}>
                    <span>{s.due ? formatDay(s.due) : '기한'}</span>
                  </DatePicker>
                )}
              </span>
            </div>
          );
        })}
        {/* readOnly + 항목 0개는 위에서 이미 return null이라 여기 오지 않는다 */}
        {!total && (
          <p className="py-2.5 text-[11px] text-fg-muted">업무를 여러 개로 나누면 하나씩 체크할 수 있어요</p>
        )}
      </div>
      {!readOnly && <input
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        // '입력하고 Enter'라고만 적혀 있었는데 onBlur로도 추가된다. 방법을 설명하는
        // 대신 예시를 두는 쪽이 낫다 — '하위 업무'가 무엇인지 모르는 사람에게는
        // 방법보다 "여기에 무엇을 적는 칸인지"가 먼저다.
        placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
        // px-3 — 글이 위 상세 내용 편집기(p-3)와 같은 x에서 시작한다(사용자 결정 2026-09-25 · 목업 B2)
        className="w-full mt-2 text-[13px] px-3 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint"
      />}
    </div>
  );
}

function SubtaskTitle({ s, justDone, onStrikeEnd, onCommit, register, hold }) {
  const [editing, setEditing] = useState(false);
  const name = useNameDraft({ value: s.title, onCommit, register, hold });
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  if (s.done && !editing) {
    // 바깥은 자리(flex-1), 안은 **글자만큼인 인라인**이다 — 취소선을 그리는 요소가 줄 폭이면 줄 끝까지
    // 그었다가 끝나는 순간 글자 폭으로 되돌아왔다(2026-09-28 사용자 지적). 인라인이라 여러 줄도 줄마다 글자 끝까지.
    return (
      <span className="flex-1 min-w-0 text-[13px] break-words px-1.5 py-1 cursor-text" onClick={() => setEditing(true)}>
        <span data-subtask-title=""
          onAnimationEnd={(e) => { if (e.animationName === 'dc-strike' && justDone) onStrikeEnd(); }}
          className={`text-fg-faint line-through${justDone ? ' dc-strike-now' : ''}`}>{s.title}</span>
      </span>
    );
  }
  return (
    <input ref={inputRef} data-subtask-title=""
      value={name.shown}
      onChange={e => name.change(e.target.value)}
      onFocus={name.focus}
      onBlur={() => { name.blur(); setEditing(false); }}
      onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder="예: 포스터 시안 만들기" aria-label="하위 업무"
      className={`flex-1 min-w-0 text-[13px] bg-transparent border border-transparent rounded-xs px-1.5 py-1 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface ${s.done ? 'text-fg-faint line-through' : 'text-fg'} placeholder:text-fg-faint`}
    />
  );
}
