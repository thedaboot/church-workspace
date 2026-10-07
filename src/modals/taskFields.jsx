import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Clock, X, User, Hash, CalendarRange, Check, ArrowLeftRight } from 'lucide-react';
import { CONFIG } from '../config.js';
import { keepVisible, byNewest, imeComposing } from '../utils.js';
import { useStore } from '../store/workspaceStore.js';
import { namesLabel } from '../services/actionItems.js';
import { Avatar } from '../components/Avatar.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { useAnchoredPos } from '../components/ConfirmPopover.jsx';
import { useDismiss } from '../hooks/useDismiss.js';

// ============================================================================
// 업무 창의 칸 — 속성 칸 한 벌(TaskProps: 상태·날짜·팀·담당자·선행 업무) · 담당자 고르기 둘(AssigneePicker 칸 ·
// OwnerPicker 칩) · 얼굴 쌓기(FaceStack) · 제목 칸(TitleField)과 그 초안(useNameDraft · 600ms)
// ----------------------------------------------------------------------------
// 껍데기와 보기·수정 화면은 modals.jsx, 담당 업무·하위 업무 목록은 taskLists.jsx, AI(3줄 요약 · 다듬기)는 taskSummary.jsx.
// 떠 있는 목록은 body 포털 + useAnchoredPos, 바깥 누름은 useDismiss에 **목록 ref까지** 넘긴다(HANDOFF §8 · PITFALLS 17-d).
// ============================================================================

// 얼굴 쌓기 — 앞의 셋만 겹쳐 세운다(담당자 칩 · 담당 업무 줄 · 하위 업무 줄). 크기는 자리마다 다르고 겹침은 6px이다.
export function FaceStack({ names = [], size = 'w-[21px] h-[21px]', overlap = '-ml-1.5', className = 'flex items-center shrink-0' }) {
  return (
    <span className={className}>
      {names.slice(0, 3).map((n, i) => (
        <Avatar key={n} name={n} className={`flex ${size} text-[10px] ${i ? `${overlap} ring-[1.5px] ring-surface` : ''}`} />
      ))}
    </span>
  );
}

// 선행 업무 고르기 — 칩(빼기 X) + 네이티브 <select>(더하기).
// 같은 프로젝트의 다른 업무만 후보다. 자기 자신·이미 고른 것은 목록에서 뺀다.
// 한 단계 순환(A→B이면서 B→A)도 후보에서 뺀다 — depLayers가 끊어 주긴 하지만,
// 만들 수 있게 두면 그래프가 "왜 이 모양이지"가 된다. 긴 순환(A→B→C→A)까지 막는
// 탐색은 두지 않았다: 사람이 그걸 만들 확률보다 코드가 늘어나는 비용이 크다.
function DependsRow({ formData, setFormData }) {
  // 셀렉터가 매번 새 배열을 돌려주면 useSyncExternalStore가 무한 리렌더에 빠진다
  // (selectMembers의 NO_MEMBERS와 같은 함정 — 실제로 여기서 한 번 터졌다).
  // 안정된 참조(s.tasks)만 구독하고 파생은 useMemo로 한다.
  const tasksState = useStore(s => s.tasks);
  // 최근에 만든 업무가 맨 위다(utils.byNewest) — allIds 순서를 그대로 쓰면 맨 위가
  // 가장 오래된 업무여서, 방금 만든 업무를 고르려면 목록 끝까지 내려가야 했다.
  const candidates = useMemo(() => tasksState.allIds
    .map(id => tasksState.byId[id])
    .filter(t => t.projectId === formData.projectId && t.id !== formData.id)
    .sort(byNewest),
    [tasksState, formData.projectId, formData.id]);
  const chosen = formData.dependsOn || [];
  const byId = new Map(candidates.map(t => [t.id, t]));
  const options = candidates.filter(t =>
    !chosen.includes(t.id) && !(t.dependsOn || []).includes(formData.id));
  const add = (id) => { if (id) setFormData(prev => ({ ...prev, dependsOn: [...(prev.dependsOn || []), id] })); };
  const remove = (id) => setFormData(prev => ({ ...prev, dependsOn: (prev.dependsOn || []).filter(x => x !== id) }));
  return (
    <PropertyRow icon={<ArrowLeftRight size={13} className="text-fg-faint" />} label="선행 업무">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {chosen.map(id => (
          <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-semibold bg-surface-hover text-fg max-w-[220px]">
            {/* 지워진 카드를 가리키면 제목이 없다 — 그래도 칩은 남겨서 뺄 수 있게 한다 */}
            <span className="truncate">{byId.get(id)?.title || '(지워진 업무)'}</span>
            <button type="button" onClick={() => remove(id)} title="선행 업무 빼기"
              className="text-fg-faint hover:text-tag-red-fg transition-colors shrink-0"><X size={11} /></button>
          </span>
        ))}
        {options.length > 0 && (
          <select value="" onChange={(e) => add(e.target.value)} aria-label="선행 업무"
            className="text-[11px] text-fg-muted bg-surface border border-line rounded-full px-2 py-1 outline-none focus:border-accent max-w-[200px]">
            <option value="">{chosen.length ? '+ 더 추가' : '+ 먼저 끝나야 하는 업무'}</option>
            {options.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        {!options.length && !chosen.length && (
          <span className="text-[11px] text-fg-muted">이 프로젝트에 다른 업무가 생기면 고를 수 있어요</span>
        )}
      </div>
    </PropertyRow>
  );
}

// 보기 모드의 선행 업무 줄 — 있을 때만 그린다. 끝난 선행 업무에는 체크를 붙여서
// "이제 시작해도 되는지"가 제목을 읽지 않아도 보이게 한다.
export function DependsViewRow({ dependsOn }) {
  // DependsRow와 같은 이유 — 셀렉터에서 새 배열을 만들지 않는다
  const tasksState = useStore(s => s.tasks);
  const deps = useMemo(() => (dependsOn || []).map(id => tasksState.byId[id]).filter(Boolean),
    [tasksState, dependsOn]);
  if (!deps.length) return null;
  return (
    <div className="flex items-start gap-0 py-2.5">
      <span className="w-24 shrink-0 text-fg-muted">선행 업무</span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 min-w-0">
        {deps.map(d => (
          <span key={d.id} className="inline-flex items-center gap-1 font-medium max-w-full"
            style={{ color: d.status === '완료' ? 'var(--app-tag-green-fg)' : 'var(--app-ink)' }}>
            {d.status === '완료' && <Check size={11} className="shrink-0" />}
            <span className="truncate">{d.title}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// 노션 속성 행: 좌측 라벨 + 우측 값 레이아웃
const PropertyRow = ({ icon, label, children }) => (
  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 sm:gap-0 py-2">
    <div className="w-28 shrink-0 flex items-center gap-1.5 text-xs text-fg-muted">{icon}{label}</div>
    <div className="flex-1 min-w-0">{children}</div>
  </div>
);

// 담당자 멤버 칩 선택기 — 등록된 멤버만 고를 수 있다(목록 밖 이름은 넣지 못한다).
// 예전에는 아무 이름이나 타이핑+Enter로 넣을 수 있었는데, 가입하지 않은 사람은
// 업무를 볼 수도 알림을 받을 수도 없고 아무의 '내 업무'에도 안 잡혀서 배정이
// 아니라 메모였다. 오타도 그렇게 유령 담당자가 됐다. 그런 메모는 본문에 적는다.
const AssigneePicker = ({ value = [], onChange, members = [] }) => {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);
  const popRef = useRef(null);   // 포털로 나간 목록(또는 '없는 이름' 줄) — 바깥 누름 판정에 같이 넣는다

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const uniq = [...new Set(members.filter(Boolean))].filter(m => !value.includes(m))
      .sort((a, b) => a.localeCompare(b, 'ko')); // 가나다순
    // 전원을 보여준다 — 6명에서 자르면 뒷순번 사람은 목록에 없는 것처럼 보였다
    // (목록에 max-h + 스크롤이 있어 길어도 화면을 밀지 않는다)
    return q ? uniq.filter(m => m.toLowerCase().includes(q)) : uniq;
  }, [input, members, value]);

  // 목록은 **body 포털**이다(HANDOFF §8 '떠 있는 것') — 업무 창은 overflow 있는 상자라
  // absolute 목록이 잘리거나 좁은 폭에서 화면 밖으로 나갔다. 칸 상자의 왼쪽 끝에서 연다.
  const listOpen = open && (suggestions.length > 0 || !!input.trim());
  const [pos, place] = useAnchoredPos(rootRef, listOpen, 160, 200, 8, popRef, { align: 'start' });
  // 거르면 줄 수가 바뀐다 — 위로 뒤집혀 선 목록이 칸에서 떨어져 뜨지 않게 다시 잰다
  useLayoutEffect(() => { if (listOpen) place(); }, [listOpen, suggestions.length, place]);

  // 목록이 포털이라 rootRef의 자손이 아니다 — **목록도 '안'으로 센다**(useDismiss 머리말 · PITFALLS 17-d)
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);

  const add = (name) => {
    const n = (name || '').trim();
    setInput(''); setActiveIdx(0);
    if (!n || value.includes(n)) return;
    onChange([...value, n]);
  };
  const remove = (name) => onChange(value.filter(v => v !== name));

  const onKeyDown = (e) => {
    if (imeComposing(e)) return;   // 조합을 끝내는 Enter로 고르지 않는다
    if (e.key === 'Enter') {
      e.preventDefault();
      // 목록에 있는 것만 넣는다 — 입력한 글자를 그대로 담당자로 만들지 않는다
      if (open && suggestions.length) add(suggestions[activeIdx] ?? suggestions[0]);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Backspace' && !input && value.length) { remove(value[value.length - 1]); }
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1.5 focus-within:border-accent focus-within:shadow-soft transition-all">
        {value.map(name => (
          <span key={name} className="inline-flex items-center gap-1 bg-accent-weak text-accent-text rounded-full pl-2 pr-1 py-0.5 text-[11px] font-medium">
            {name}
            <button type="button" onClick={() => remove(name)} className="relative before:absolute before:-inset-x-1 before:-inset-y-[5px] hover:bg-accent/20 rounded-full p-0.5 transition active:scale-95" title="제거"><X size={11} /></button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '추가…' : '멤버 이름으로 찾기'} aria-label="담당자"
          className="flex-1 min-w-[8rem] bg-transparent text-xs text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
      {/* 찾는 이름이 목록에 없을 때 — 왜 안 들어가는지 알려준다.
          아무 안내 없이 Enter가 먹히지 않으면 입력이 씹힌 것처럼 보인다. */}
      {open && input.trim() && suggestions.length === 0 && createPortal(
        <p ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className="z-[90] px-2.5 py-2 text-[11px] text-fg-muted bg-surface border border-line rounded-lg shadow-elevated">
          등록된 멤버에 없는 이름이에요
        </p>, document.body)}
      {open && suggestions.length > 0 && createPortal(
        <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className="z-[90] w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 transition-none animate-in fade-in zoom-in-95 duration-150">
          {suggestions.map((name, i) => (
            <button key={name} type="button" onMouseDown={e => { e.preventDefault(); add(name); }}
              // 방향키로 목록 밖까지 내려가도 활성 항목이 보이게
              // text-[13px]: 다른 메뉴(더보기·프로필)와 같은 크기 — text-sm(14px)은 12px
              // 입력칸 옆에서 혼자 커 보였다(실제 지적)
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>, document.body)}
    </div>
  );
};

// ── 담당자 고르기 ────────────────────────────────────────────────────────
// 담당자 칸(AssigneePicker)과 달리 **한 줄 안에 들어가야** 해서 칩 하나를 누르면
// 목록이 뜨는 모양이다. 목록에 없는 이름은 넣지 않는다(그쪽과 같은 규칙) — 다만
// 이미 적혀 있는 팀 이름(`엔지니어팀`)은 그대로 두고 지울 수만 있다.
export function OwnerPicker({ names = [], members = [], onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos] = useAnchoredPos(triggerRef, open, 210, 260);

  useDismiss(open, () => setOpen(false), [rootRef, popRef]);

  const toggle = (n) => onChange(names.includes(n) ? names.filter(x => x !== n) : [...names, n]);
  const list = useMemo(
    () => [...new Set([...names, ...members.filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko')),
    [names, members],
  );

  const pop = open ? createPortal(
    <div ref={popRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: 210 }}
      className="z-[90] max-h-60 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 transition-none animate-in fade-in zoom-in-95 duration-150">
      {list.map(n => (
        <button key={n} type="button" onClick={() => toggle(n)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12.5px] transition-colors ${names.includes(n) ? 'bg-accent-weak text-accent-text font-semibold' : 'text-fg-muted hover:bg-surface-hover'}`}>
          <Avatar name={n} className="flex w-5 h-5 text-[10px] shrink-0" />
          <span className="truncate">{n}</span>
          {names.includes(n) && <Check size={13} strokeWidth={3} className="ml-auto shrink-0" />}
        </button>
      ))}
    </div>, document.body) : null;

  return (
    <span className="inline-flex shrink-0" ref={rootRef}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 h-[30px] rounded-full border text-[12px] transition active:scale-95 ${names.length ? 'pl-1 pr-2.5 border-line bg-surface text-fg' : 'px-2.5 border-dashed border-line bg-surface text-fg-muted'}`}>
        {names.length > 0 && <FaceStack names={names} className="flex items-center" />}
        <span className="truncate max-w-[9rem]">{names.length ? namesLabel(names) : '담당자'}</span>
      </button>
      {pop}
    </span>
  );
}

// 초점이 있거나 저장이 밀린 동안만 초안을 든다 — 그 밖에는 스토어의 지금 값(남이 고친 이름)을 그린다.
// 빈 이름은 저장하지 않는다(칸을 떠나면 원래 이름으로 돌아간다). flush는 창을 닫을 때도 불린다(register).
export const NAME_IDLE_MS = 600;
export function useNameDraft({ value, onCommit, register, hold, idleMs = NAME_IDLE_MS }) {
  const [draft, setDraft] = useState(null);
  const ref = useRef({ draft: null, timer: null, release: null, focused: false });
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const flush = useCallback(() => {
    const r = ref.current;
    clearTimeout(r.timer); r.timer = null;
    const release = r.release; r.release = null;
    if (!release) return;
    const d = r.draft;
    if (d != null && d.trim()) commitRef.current(d, release);
    else release(true);
  }, []);
  useEffect(() => register?.(flush), [register, flush]);
  useEffect(() => () => flush(), [flush]);
  const change = (v) => {
    const r = ref.current;
    r.draft = v; setDraft(v);
    if (!r.release) r.release = hold ? hold() : () => {};
    clearTimeout(r.timer);
    r.timer = setTimeout(flush, idleMs);
  };
  const focus = () => { ref.current.focused = true; };
  const blur = () => {
    flush();
    ref.current.focused = false; ref.current.draft = null; setDraft(null);
  };
  return { shown: draft ?? value ?? '', change, focus, blur };
}

// ── 속성 칸 한 벌 — 새 업무 폼과 업무 창(연 채로 고치기)이 같이 쓴다 ─────────────
// `set(fn)` — fn은 (지금 카드 → 새 카드). 새 업무 폼은 폼 state에, 업무 창은 스토어의 지금 카드에 걸고
// **곧바로 저장**한다(TaskModalShell commit — 바뀐 칸만).
export function TaskProps({ data, set, members }) {
  const toggleTeam = (team) => set(prev => ({ ...prev, teams: (prev.teams || []).includes(team) ? prev.teams.filter(t => t !== team) : [...(prev.teams || []), team] }));
  return (
    <div className="border-y border-line divide-y divide-line/60">
      <PropertyRow icon={<CheckSquare size={13} className="text-fg-faint" />} label="상태">
        <div className="flex flex-wrap gap-1.5">
          {/* 상시는 맨 아래(config STATUS_PICK). 상시로 고르는 순간 날짜 두 칸을 비운다 —
              상시는 마감이 없는 업무이고, 칸을 숨기기만 하면 옛 날짜가 남아 달력·마감 셈에 선다.
              저장 쪽(domain.updateWithLogs)도 같은 일을 한 번 더 한다. */}
          {CONFIG.STATUS_PICK.map(s => (
            <button key={s} type="button" onClick={() => set(prev => (s === CONFIG.STATUS_ONGOING
              ? { ...prev, status: s, startDate: '', dueDate: '' }
              : { ...prev, status: s }))}
              aria-pressed={(data.status || '시작 전') === s}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${(data.status || '시작 전') === s ? CONFIG.STATUS_STYLES[s] + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
              {s}
            </button>
          ))}
        </div>
      </PropertyRow>
      {data.status !== CONFIG.STATUS_ONGOING && (
        <>
          <PropertyRow icon={<CalendarRange size={13} className="text-fg-faint" />} label="시작일">
            <DatePicker value={data.startDate || ''} onChange={(v) => set(prev => ({ ...prev, startDate: v }))} />
          </PropertyRow>
          <PropertyRow icon={<Clock size={13} className="text-fg-faint" />} label="마감일">
            <DatePicker value={data.dueDate || ''} onChange={(v) => set(prev => ({ ...prev, dueDate: v }))} />
          </PropertyRow>
        </>
      )}
      <PropertyRow icon={<Hash size={13} className="text-fg-faint" />} label="담당 팀">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CONFIG.TEAMS).map(([team, colorClass]) => {
            const selected = (data.teams || []).includes(team);
            return (
              <button key={team} type="button" onClick={() => toggleTeam(team)} aria-pressed={selected}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all active:scale-95 ${selected ? colorClass + ' border-transparent shadow-soft' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                {team}
              </button>
            );
          })}
        </div>
      </PropertyRow>
      <PropertyRow icon={<User size={13} className="text-fg-faint" />} label="담당자">
        <AssigneePicker value={data.assignees || []} onChange={(next) => set(prev => ({ ...prev, assignees: next }))} members={members} />
      </PropertyRow>
      {/* 선행 업무(0020) — 이 업무보다 먼저 끝나야 하는 것. 같은 프로젝트 안에서만 고른다
          (프로젝트를 건너 잇기 시작하면 그래프가 화면 하나에 안 담긴다).
          네이티브 <select>다: 목록이 길어도 모바일에서 OS가 알아서 잘 굴려 준다. */}
      <DependsRow formData={data} setFormData={set} />
    </div>
  );
}

// 제목 칸 — 초점이 있거나 저장이 밀린 동안만 초안(useNameDraft), 600ms 조용하거나 떠날 때 저장.
// Enter는 칸을 떠난다(조합을 끝내는 Enter는 무시 · utils.imeComposing). 빈 제목은 저장하지 않고
// 떠나면 원래 제목으로 돌아간다(cards.title not null).
export function TitleField({ value, onCommit, register, hold }) {
  const name = useNameDraft({ value, onCommit, register, hold });
  return (
    <input type="text" name="title" value={name.shown}
      onChange={e => name.change(e.target.value)} onFocus={name.focus} onBlur={name.blur}
      onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      placeholder="업무 제목 입력" aria-label="업무 제목 입력"
      className="w-full text-xl md:text-2xl font-bold tracking-[-0.25px] text-fg placeholder:text-fg-faint bg-transparent border-none outline-none focus:ring-0 p-0" />
  );
}
