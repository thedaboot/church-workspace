import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Eye, GraduationCap, Handshake, PencilLine, RotateCcw, X } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { Skeleton } from './media.jsx';
import { Fold } from './Fold.jsx';
import { profileAvatar } from '../services/cloudSync.js';
import { Segmented } from './segmented.jsx';
import { BTN, BTN_SOFT, BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { CARD, CARD_STYLE, MenuPick, PersonPick, FIELD, FailLeft } from './groupsParts.jsx';
import { badgeClass, LEAD_TEAMS } from './roleBadge.js';
import { showToast } from './Toast.jsx';
import { useLeave } from '../hooks/useExit.js';
import { useStore } from '../store/workspaceStore.js';
import { selectTasksList, selectProjectsList, selectCurrentUser } from '../store/selectors.js';
import { CONFIG } from '../config.js';
import { objectParticle, failText, errorReason } from '../services/errorText.js';
import { ROLE_LABEL, GRAD_LABEL, teamLeadLabel, teamLeadPhrase } from '../services/roster.js';
import { pairRoles, graduatesOf, buildHandovers, openTasksOf, TEAM_LEAD, DROP_SEAT } from '../services/handover.js';
import {
  useHandover, applyHandover, resetHandover, viewAs, viewBack, guestRoster, handoverOn, FROM_YEAR, TO_YEAR,
  setOverride, setGrads, setGradTo, saveNote, markSeen, loadHandover, myPersonIds,
} from '../services/handoverStore.js';

// 고치기가 실패하면 토스트(화면 값은 다음 읽기에서 DB 것으로 돌아온다)
const tryWrite = (p) => Promise.resolve(p).catch((e) => { console.error('[handover] 저장 실패:', e); showToast(failText('저장하지 못했어요', e)); });

// ============================================================================
// 인수인계 — 멤버 화면의 세 번째 탭(마스터만) + 홈 카드 둘 (시안 2026-10-16 · 실제 붙이기 v5 1묶음 C · 0109)
// ----------------------------------------------------------------------------
// 흐름(사용자가 정한 차례): 다음 해 직분은 '청년 명단'의 그 해에 넣는다 → ① 직분 짝(자리로 자동 · 고칠 수 있다)
// → ② 졸업(한국 나이 31세 자동 목록 · 확정 · 인수자) → ③ 인계 내용(나가는 사람이 전달 사항 · 인계할 업무)
// → ④ 1월 1일 적용(아침 크론 · api/push.js → apply_handovers) → 인수자가 앱을 열면 홈 맨 위에 카드(누구에게서 · 전달 사항 · 업무).
// 지난해 리더가 지난해 '리더만 보기' 프로젝트를 계속 보고 고치는 것은 ④에 한 줄로 말한다(DB는 0110).
// **시연 전용**('화면 확인' · '1월 1일에 보일 화면 적용해 보기' · '처음으로')은 게스트(handoverOn)에서만 선다.
//
// 규칙은 services/handover.js(순수 · logcheck-v2), 저장·시드·적용은 services/handoverStore.js.
// 폰은 한 단계씩 한 장(아래 이전·다음) · 데스크톱은 같은 단계에 지난해 | 다음 해 두 열.
// 부품은 앱의 것 — Segmented(단계) · MenuPick(인수자 고치기) · PersonPick(졸업자의 인수자) ·
// 버튼 두 단 · 아래 시트(.dc-sheet-dialog + .dc-scrim · useLeave로 걷힘 · PITFALLS 57).
// ============================================================================

const ONE_LINE = 'block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';
const STEPS = [[1, '직분'], [2, '졸업'], [3, '인계 내용'], [4, '적용']];

export const slotLabel = (slot) => {
  if (slot === 'graduate') return GRAD_LABEL;
  const [role, team] = slot.split(':');
  return role === TEAM_LEAD ? teamLeadLabel(team) : (ROLE_LABEL[role] || role);
};
export const itemLabels = (it) => [...it.slots.map(slotLabel), ...(it.graduate ? [GRAD_LABEL] : [])];
// 문장 자리(홈 인계 카드) — 팀장은 '찬양팀 팀장'처럼 띄어 쓴다(사용자 결정 2026-10-17 · 칩은 itemLabels 그대로 '찬양팀장')
const slotPhrase = (slot) => {
  const [role, team] = slot.split(':');
  return role === TEAM_LEAD ? teamLeadPhrase(team) : slotLabel(slot);
};
export const itemPhrases = (it) => [...it.slots.map(slotPhrase), ...(it.graduate ? [GRAD_LABEL] : [])];

// 화면 둘(탭·홈)이 같이 보는 한 벌 — 명단·직분·업무에서 짝·졸업·인계를 만든다
export function useHandoverModel() {
  const hv = useHandover();
  const tasks = useStore(selectTasksList);
  const projects = useStore(selectProjectsList);
  return useMemo(() => {
    const { people: all, roles } = guestRoster();
    const people = all.filter(p => !p.removed_at);
    const byId = new Map(all.map(p => [p.id, p]));
    const nameOf = (id) => byId.get(id)?.name || '';
    const pairs = pairRoles(roles.filter(r => r.year === FROM_YEAR), roles.filter(r => r.year === TO_YEAR), hv.overrides || {}, LEAD_TEAMS, { toYear: TO_YEAR });
    const autoGrads = graduatesOf(people, TO_YEAR);
    const grads = hv.grads ?? autoGrads.map(p => p.id);
    const live = roles.some(r => r.year === TO_YEAR) ? buildHandovers(pairs, grads, hv.gradTo || {}) : [];   // 다음 해 직분이 없으면 인계도 없다(handoverStore.liveItems와 같은 조건)
    // 클라우드에서 마스터가 아니면 명단·계획을 못 읽는다 — RLS가 준 줄(내 것)이 곧 목록이다
    const fixed = !handoverOn() && !hv.master ? (hv.fixedItems || []) : null;
    const items = hv.applied?.items || fixed || live;
    const projectOf = new Map(projects.map(p => [p.id, p]));
    const openOf = (id) => openTasksOf(tasks, nameOf(id));
    // 업무 하나는 인계 한 건에만 — 다른 건이 이미 고른 업무
    const takenBy = new Map();
    for (const it of items) for (const t of hv.notes?.[it.id]?.taskIds || []) takenBy.set(t, it.id);
    const newHolders = [...new Set(roles.filter(r => r.year === TO_YEAR).map(r => r.person_id))]
      .map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    // 인수자 메뉴의 나머지 — 다음 해 직분이 없는 명단 사람도 고를 수 있다(사용자 승인 목업 ⑥ · 직분자 다음에 이름순)
    const holderIds = new Set(newHolders.map(p => p.id));
    const others = people.filter(p => !holderIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return { hv, people, byId, nameOf, pairs, autoGrads, grads, items, tasks, projectOf, openOf, takenBy, newHolders, others };
  }, [hv, tasks, projects]);
}

const Badge = ({ label }) => (
  <span className={`shrink-0 px-1.5 py-px rounded-xs text-[10px] font-bold ${badgeClass(label)}`}>{label}</span>
);
// 사진은 명단 사람에 이어진 계정(people.profile_id)으로 찾는다 — 명단 이름(본명)과 계정 표시명이 달라
// 이름으로는 못 찾는다(roster.jsx와 같은 이유 · §6-26). 이어진 계정이 없거나 사진이 없으면 글자 원.
const Face = ({ person, size = 'w-6 h-6 text-[10.5px]' }) => (
  <Avatar name={person?.name || ''} url={profileAvatar(person?.profile_id) || null} className={`flex ${size} shrink-0`} />
);
const Who = ({ person, muted }) => person ? (
  <span className="flex items-center gap-1.5 min-w-0">
    <Face person={person} />
    <span className={`text-[13px] font-semibold truncate ${muted ? 'text-fg-muted' : 'text-fg'}`}>{person.name}</span>
  </span>
) : null;
const Quiet = ({ children }) => <span className="text-[12px] text-fg-muted">{children}</span>;

const Head = ({ title, count, children }) => (
  <div className="flex items-center gap-2 mb-2.5">
    <h3 className="text-[13px] font-bold text-fg shrink-0">{title}</h3>
    {count != null && <span className="text-[11px] text-fg-muted tabular-nums shrink-0">{count}</span>}
    <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
    {children}
  </div>
);

// ── ① 직분 짝 ───────────────────────────────────────────────────────────────
function PairStep({ m, onEditRoster }) {
  const setTo = (key, id) => tryWrite(setOverride(key, id));
  // 2027 직분자 → 나머지 명단 → 미정 → 직분 제거(사라질 직분으로 · 인계 없음 — 목업 ⑥)
  const options = [...m.newHolders, ...m.others].map(p => ({ id: p.id, name: p.name }))
    .concat([{ id: '', name: '미정' }, { id: DROP_SEAT, name: '직분 제거' }]);
  return (
    <section data-hv-step="1">
      {/* 데스크톱 두 열의 머리 — 지난해 | 다음 해 */}
      <div className="hidden md:grid grid-cols-[7.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_7.5rem] gap-3 px-3 pb-1.5 text-[11px] font-semibold text-fg-muted">
        <span /><span>{`${FROM_YEAR}년`}</span><span /><span>{`${TO_YEAR}년`}</span><span />
      </div>
      <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
        {m.pairs.map((p, i) => {
          const from = m.byId.get(p.from);
          const to = m.byId.get(p.to);
          const changed = p.from && p.to !== p.auto;
          const drop = p.kind === 'drop';
          const pick = !m.hv.applied && p.kind !== 'new' && (
            // 데스크톱은 끝 열(7.5rem)을 꽉 채운다(UI 다듬기 2026-10-26) — '변경'과 '인계할 사람 선택'의 폭이 달라 오른쪽 끝이
            // 들쭉날쭉했다. 끝이 한 줄로 서면 세로로 훑어 남은 줄을 바로 센다.
            <MenuPick className="md:w-full md:[&>.menu-pick]:w-full md:[&>.menu-pick]:justify-between" label="인수자" items={options.filter(o => (drop ? o.id !== DROP_SEAT : o.id !== (p.to || '')))} onPick={(id) => setTo(p.key, id)}>
              {drop ? '인계할 사람 선택' : to ? '변경' : '선택'}
            </MenuPick>
          );
          // 폰은 두 줄 — [직분 칩 · 고르기] / [지난해 → 다음 해]. 고르기를 이름 칸에 같이 두면 '사라질 직분' 칩과
          // '인계할 사람 선택'이 한 칸에 안 들어가 줄마다 다르게 꺾였다(사용자 지적 2026-10-21). 데스크톱은 한 줄 끝 열.
          return (
            <div key={p.key} data-pair={p.key} data-kind={p.kind}
              className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] md:grid-cols-[7.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2 md:gap-x-3 gap-y-2 px-3 py-2.5"
              style={i ? { borderTop: '1px solid var(--app-line)' } : undefined}>
              <span className="col-span-2 md:col-span-1 flex items-center gap-1.5 min-h-7"><Badge label={slotLabel(p.slot)} /></span>
              <span data-pair-pick="" className="row-start-1 col-start-3 md:col-start-5 justify-self-end md:justify-self-stretch">{pick}</span>
              <span className="min-w-0">{from ? <Who person={from} /> : <Quiet>새로 맡음</Quiet>}</span>
              <span className="flex justify-center text-fg-faint"><ArrowRight size={14} /></span>
              <span className="min-w-0 flex items-center gap-1.5">
                {p.kind === 'same' ? <><Who person={to} muted /><span className="shrink-0 text-[11px] text-fg-muted">유지</span></>
                  : drop ? <span data-seat-drop="" className="shrink-0 px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-tag-gray text-tag-gray-fg">사라질 직분</span>
                  : to ? <Who person={to} /> : <span className="text-[12.5px] font-semibold text-tag-orange-fg">미정</span>}
                {changed && <span aria-hidden className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
              </span>
            </div>
          );
        })}
      </div>
      {!m.hv.applied && (
        <button type="button" className={`${BTN_SOFT} mt-3 inline-flex items-center gap-1.5`} onClick={() => onEditRoster?.(TO_YEAR)}>
          <PencilLine size={13} /><span>{`명단에서 ${TO_YEAR}년 직분 수정`}</span>
        </button>
      )}
    </section>
  );
}

// ── ② 졸업 ──────────────────────────────────────────────────────────────────
function GradStep({ m }) {
  const set = new Set(m.grads);
  const toggle = (id) => tryWrite(setGrads(set.has(id) ? m.grads.filter(x => x !== id) : [...m.grads, id]));
  const setTo = (gid, id) => tryWrite(setGradTo(gid, id));
  const pool = m.people;
  return (
    <section data-hv-step="2">
      <Head title={`${TO_YEAR}년 졸업`} count={`${m.autoGrads.length}명`}>
        <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">{`${TO_YEAR - 30}년생`}</span>
      </Head>
      {m.autoGrads.length === 0 ? (
        <p className="py-6 text-[12.5px] text-fg-muted">{`${TO_YEAR - 30}년생 미등록`}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {m.autoGrads.map(p => {
            const on = set.has(p.id);
            const open = m.openOf(p.id);
            const item = m.items.find(it => it.from === p.id && it.graduate);
            return (
              <div key={p.id} data-grad={p.id} className={`${CARD} p-3`} style={CARD_STYLE}>
                <div className="flex items-center gap-2.5">
                  <Face person={p} size="w-8 h-8 text-[13px]" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold text-fg ${ONE_LINE}`}>{p.name}</p>
                    <p className={`text-[10.5px] text-fg-muted tabular-nums ${ONE_LINE}`}>
                      {[`${p.birth_year}년생`, `진행 중 업무 ${open.length}건`].join(' · ')}
                    </p>
                  </div>
                  <button type="button" aria-pressed={on} disabled={!!m.hv.applied} onClick={() => toggle(p.id)}
                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[11px] font-semibold border transition active:scale-95 disabled:opacity-40
                      ${on ? 'bg-tag-gray text-tag-gray-fg border-transparent' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}>
                    {on ? <Check size={11} /> : <GraduationCap size={12} />}{GRAD_LABEL}
                  </button>
                </div>
                {on && (
                  <div className="mt-2.5 flex items-center gap-2 pl-[42px]">
                    <span className="shrink-0 text-[11px] font-semibold text-fg-muted">인수자</span>
                    <PersonPick className="flex-1 min-w-0" label={`${p.name} 인수자`} placeholder="인수자 선택"
                      people={pool.filter(x => x.id !== p.id)} value={item?.to || ''} allowClear
                      onChange={(id) => setTo(p.id, id)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── ③ 인계 내용 ─────────────────────────────────────────────────────────────
function ItemRow({ m, it, onWrite, onViewAs }) {
  const from = m.byId.get(it.from);
  const to = m.byId.get(it.to);
  const note = m.hv.notes?.[it.id];
  return (
    <div data-item={it.id} className={`${CARD} p-3`} style={CARD_STYLE}>
      <div className="flex flex-wrap items-center gap-1">{itemLabels(it).map(l => <Badge key={l} label={l} />)}</div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-2">
        <Who person={from} />
        <span className="flex justify-center text-fg-faint"><ArrowRight size={14} /></span>
        {to ? <Who person={to} /> : <span className="text-[12.5px] font-semibold text-tag-orange-fg">미정</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className={`shrink-0 px-1.5 py-px rounded-xs text-[10px] font-bold ${note?.done ? 'bg-tag-green text-tag-green-fg' : 'bg-tag-gray text-tag-gray-fg'}`}>
          {note?.done ? '작성 완료' : '미작성'}
        </span>
        <span className="text-[11px] text-fg-muted tabular-nums">{`업무 ${(note?.taskIds || []).length}건`}</span>
        <span className="ml-auto flex items-center gap-1">
          {/* '화면 확인'는 시연 전용(게스트) — 그 사람의 홈 카드를 미리 보려고만 있다. 실제 앱에는 두지 않는다 */}
          {handoverOn() && <button type="button" onClick={() => onViewAs(from)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95">
            <Eye size={13} /><span>화면 확인</span>
          </button>}
          {!m.hv.applied && (
            <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => onWrite(it)}>
              <PencilLine size={13} /><span>{note?.done ? '고치기' : '쓰기'}</span>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function ItemsStep({ m, onWrite, onViewAs }) {
  return (
    <section data-hv-step="3">
      <Head title="인계" count={`${m.items.length}건`} />
      <div className="grid gap-2 md:grid-cols-2">
        {m.items.map(it => <ItemRow key={it.id} m={m} it={it} onWrite={onWrite} onViewAs={onViewAs} />)}
      </div>
    </section>
  );
}

// ── ④ 적용 ──────────────────────────────────────────────────────────────────
function ApplyStep({ m, onViewAs }) {
  const applied = m.hv.applied;
  const seats = m.pairs.filter(p => p.kind === 'pass' || p.kind === 'new').length;
  const moving = applied ? applied.moves.length
    : m.items.filter(it => it.to).reduce((n, it) => n + (m.hv.notes?.[it.id]?.taskIds || []).length, 0);
  const lines = [
    [Handshake, `직분 ${seats}자리가 ${TO_YEAR}년에 변경돼요`],
    [ArrowRight, `업무 ${moving}건의 담당자가 바뀌어요`],
    [GraduationCap, `졸업 ${m.grads.length}명 · 워크스페이스는 그대로 사용할 수 있어요`],
    [Eye, `${FROM_YEAR}년에 리더만 볼 수 있었던 프로젝트는 ${FROM_YEAR}년 리더진들도 계속 볼 수 있어요`],
  ];
  const receivers = [...new Set(m.items.map(it => it.to).filter(Boolean))].map(id => m.byId.get(id)).filter(Boolean);
  const apply = () => {
    applyHandover(m.items, m.nameOf);
    showToast(`${TO_YEAR}년 1월 1일로 적용했어요`);
  };
  return (
    <section data-hv-step="4">
      <div className={`${CARD} p-3.5`} style={CARD_STYLE}>
        <ul className="space-y-2">
          {lines.map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-2 text-[12.5px] text-fg leading-[1.5]">
              <Icon size={14} className="shrink-0 mt-[3px] text-fg-faint" /><span className="min-w-0">{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3.5 pt-3 flex flex-wrap items-center gap-2" style={{ borderTop: '1px solid var(--app-line)' }}>
          {applied ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-tag-green-fg">
              <Check size={14} />{`${TO_YEAR}년 1월 1일 적용됨`}
            </span>
          ) : (
            <>
              <span className="text-[12.5px] text-fg-muted">1월 1일에 적용돼요</span>
              {/* 시연 전용 — 실제 앱은 1월 1일 아침 크론이 적용한다 */}
              {handoverOn() && <button type="button" data-hv-apply className={`${BTN_CONFIRM} ml-auto`} onClick={apply}>1월 1일에 보일 화면 적용해 보기</button>}
            </>
          )}
        </div>
      </div>
      {applied && (
        <div className="mt-5">
          <Head title="인수자" count={`${receivers.length}명`} />
          <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
            {receivers.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2.5" style={i ? { borderTop: '1px solid var(--app-line)' } : undefined}>
                <Who person={p} />
                <span className="ml-auto flex items-center gap-1 shrink-0">
                  {m.items.filter(it => it.to === p.id).flatMap(itemLabels).slice(0, 2).map(l => <Badge key={l} label={l} />)}
                  {handoverOn() && <button type="button" data-view-as={p.id} onClick={() => onViewAs(p)}
                    className="ml-1 inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition active:scale-95">
                    <Eye size={13} /><span>화면 확인</span>
                  </button>}
                </span>
              </div>
            ))}
          </div>
          {handoverOn() && (
            <button type="button" className={`${BTN_CONFIRM_QUIET} mt-3`} onClick={() => { resetHandover(); showToast('기존 상태로 되돌렸어요'); }}>
              <RotateCcw size={14} />처음으로
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ── 인계 내용 작성(아래 시트 · 768부터 가운데 창) ───────────────────────────
export function HandoverSheet({ m, item, onClose }) {
  const saved = m.hv.notes?.[item.id] || {};
  const [note, setNote] = useState(saved.note || '');
  const [picked, setPicked] = useState(() => new Set(saved.taskIds || []));
  const [leaving, leave] = useLeave();
  const close = () => leave(onClose);
  const boxRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const from = m.byId.get(item.from);
  const to = m.byId.get(item.to);
  const tasks = m.openOf(item.from);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveNote(item, note.trim(), [...picked]);
      showToast('인계 내용을 저장했어요');
      close();
    } catch (e) {
      console.error('[handover] 인계 내용 저장 실패:', e);
      showToast(failText('저장하지 못했어요', e));
    } finally { setSaving(false); }
  };
  const toggle = (id) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const out = leaving ? ' dc-out' : '';
  return createPortal(
    <div className={`hv-sheet-back fixed inset-x-0 top-[var(--vv-top,0px)] h-[var(--app-vh,100dvh)] z-[95] flex items-end md:items-center justify-center md:p-4 bg-black/50 dc-scrim${out}`}
      role="dialog" aria-modal="true" aria-label="인계 내용"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={boxRef} className={`hv-sheet w-full md:max-w-[34rem] max-h-[92%] overflow-y-auto p-4 rounded-t-2xl md:rounded-lg shadow-elevated dc-sheet-dialog${out}`}
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-line)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[14px] font-extrabold tracking-[-0.2px] text-fg">인계 내용</b>
          <button type="button" onClick={close} aria-label="닫기"
            className="relative before:absolute before:-inset-2 hidden md:grid place-items-center w-7 h-7 rounded-md text-fg-muted hover:bg-surface-hover">
            <X size={16} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">{itemLabels(item).map(l => <Badge key={l} label={l} />)}</div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-2">
          <Who person={from} />
          <span className="flex justify-center text-fg-faint"><ArrowRight size={14} /></span>
          {to ? <Who person={to} /> : <span className="text-[12.5px] font-semibold text-tag-orange-fg">미정</span>}
        </div>

        <label className="block mt-4 mb-1.5 text-[11px] font-semibold text-fg-muted" htmlFor="hv-note">전달 사항</label>
        <textarea id="hv-note" value={note} onChange={e => setNote(e.target.value)} rows={5} placeholder="예: 회비의 정산은 매달 첫 주에 진행돼요"
          className={`${FIELD} w-full resize-y leading-[1.6]`} />

        <p className="mt-4 mb-1.5 flex items-baseline gap-2 text-[11px] font-semibold text-fg-muted">
          인계할 업무<span className="font-normal tabular-nums">{`${picked.size}/${tasks.length}`}</span>
        </p>
        {tasks.length === 0 ? (
          <p className="py-2 text-[12px] text-fg-muted">진행 중 업무 0건</p>
        ) : (
          <div className="border border-line rounded-lg overflow-hidden">
            {tasks.map((t, i) => {
              const other = m.takenBy.get(t.id);
              const busy = other && other !== item.id;
              const on = picked.has(t.id);
              const otherTo = busy ? m.nameOf(m.items.find(x => x.id === other)?.to) : '';
              return (
                <button key={t.id} type="button" disabled={busy} onClick={() => toggle(t.id)} aria-pressed={on}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-40"
                  style={i ? { borderTop: '1px solid var(--app-line)' } : undefined}>
                  <span className={`shrink-0 grid place-items-center w-[18px] h-[18px] rounded-[5px] border ${on ? 'bg-accent border-accent text-white' : 'border-line bg-surface'}`}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`text-[12.5px] font-semibold text-fg ${ONE_LINE}`}>{t.title}</span>
                    <span className={`text-[10.5px] text-fg-muted ${ONE_LINE}`}>
                      {[m.projectOf.get(t.projectId)?.title, busy && otherTo ? `${otherTo}님에게` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={`shrink-0 px-1.5 py-px rounded-xs text-[10px] font-bold ${CONFIG.STATUS_STYLES[t.status] || ''}`}>{t.status}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 mt-4 md:justify-end">
          <button type="button" onClick={close} className={`flex-1 md:flex-none md:w-24 ${BTN_CONFIRM_QUIET}`}>취소</button>
          <button type="button" onClick={save} disabled={saving} className={`hv-save flex-1 md:flex-none md:w-24 ${BTN_CONFIRM}`}>저장</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 처음 읽는 동안(클라우드 · 마스터 읽기 전) — 명단 줄 모양 그대로. 홈 카드가 먼저 읽은 '내 줄'(master: false)로는
// 짝이 비어 '직분 수정' 버튼만 먼저 서고 명단이 뒤에 툭 들어왔다(사용자 지적 2026-10-19)
function HandoverSkeleton() {
  return (
    <div data-hv-skeleton="" aria-busy="true">
      <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] md:grid-cols-[7.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_7.5rem] items-center gap-x-2 md:gap-x-3 gap-y-2 px-3 py-2.5"
            style={i ? { borderTop: '1px solid var(--app-line)' } : undefined}>
            <span className="col-span-2 md:col-span-1 flex items-center min-h-7"><Skeleton className="w-12 h-4 rounded-xs" /></span>
            <Skeleton className="row-start-1 col-start-3 md:col-start-5 justify-self-end w-14 h-7 rounded-xs" />
            <span className="flex items-center gap-1.5"><Skeleton className="w-6 h-6 rounded-full! shrink-0" /><Skeleton className="w-14 h-3.5" /></span>
            <span />
            <span className="flex items-center gap-1.5"><Skeleton className="w-6 h-6 rounded-full! shrink-0" /><Skeleton className="w-14 h-3.5" /></span>
          </div>
        ))}
      </div>
      <Skeleton className="mt-3 w-40 h-8" />
    </div>
  );
}

// ── 탭 한 장 ────────────────────────────────────────────────────────────────
export function HandoverPanel({ onEditRoster, onNavigate }) {
  const m = useHandoverModel();
  // 클라우드: 탭을 열 때마다 명단·계획·기록을 새로 읽고 목록을 내려 둔다(명단 탭에서 다음 해 직분을 고친 뒤 · handoverStore)
  useEffect(() => { loadHandover({ master: true }); }, []);
  const [step, setStep] = useState(1);
  const [writing, setWriting] = useState(null);
  const top = useRef(null);
  const go = (n) => { setStep(n); top.current?.scrollIntoView?.({ block: 'nearest' }); };
  const seeAs = (p) => { if (!p) return; viewAs(p.name); onNavigate?.('home'); };
  return (
    <section ref={top} className="dc-screen" data-handover="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
        <h3 className="flex items-center gap-1.5 text-[15px] font-extrabold text-fg tracking-[-0.3px] tabular-nums">
          {FROM_YEAR}년<ArrowRight size={15} className="text-fg-faint" />{TO_YEAR}년
        </h3>
        <Segmented role="group" aria-label="단계" className="flex p-[3px] rounded-md shrink-0 sm:ml-auto max-w-full overflow-x-auto scrollbar-hide"
          value={step} onPick={go}
          btnClassName="px-2.5 py-[6px] rounded-sm text-[12px] font-semibold whitespace-nowrap transition-colors"
          items={STEPS.map(([n, l]) => [n, <span key={n} className="tabular-nums">{`${n} ${l}`}</span>, { 'data-step': n }])} />
      </div>

      {/* 읽기 실패 자리(D2 · 사용자 승인 문구 2026-10-17) — 클라우드에서 명단·계획·기록을 못 읽었다. 토스트는 띄우지 않는다 */}
      {!handoverOn() && m.hv.error ? (
        <FailLeft className="handover-load-failed" title="인수인계를 받지 못했어요" reason={errorReason(m.hv.error)}
          onRetry={() => loadHandover({ master: true })} />
      ) : !handoverOn() && !(m.hv.loaded && m.hv.master) ? (
        <HandoverSkeleton />
      ) : (
      <div key={step} className="dc-screen">
        {step === 1 && <PairStep m={m} onEditRoster={onEditRoster} />}
        {step === 2 && <GradStep m={m} />}
        {step === 3 && <ItemsStep m={m} onWrite={setWriting} onViewAs={seeAs} />}
        {step === 4 && <ApplyStep m={m} onViewAs={seeAs} />}
      </div>
      )}

      {/* 이전 · 다음 — 폰은 한 장씩 넘기는 길(시트처럼) · 데스크톱도 같은 자리(오른쪽 아래) */}
      <div className="mt-5 flex gap-2 md:justify-end">
        <button type="button" disabled={step === 1} onClick={() => go(step - 1)} className={`flex-1 md:flex-none md:w-28 ${BTN_CONFIRM_QUIET}`}>
          <ChevronLeft size={15} />이전
        </button>
        <button type="button" disabled={step === 4} onClick={() => go(step + 1)} className={`flex-1 md:flex-none md:w-28 ${BTN_CONFIRM}`}>
          다음<ChevronRight size={15} />
        </button>
      </div>

      {writing && <HandoverSheet m={m} item={writing} onClose={() => setWriting(null)} />}
    </section>
  );
}

// ── 홈 카드 둘 ─────────────────────────────────────────────────────────────
// 나가는 사람(적용 전): '인계 내용 작성' · 인수자(적용 뒤 · 확인 전): 누구에게서 · 전달 사항 · 인계받은 업무.
// 보는 사람 = 게스트 currentUser 이름(시안의 '화면 확인'가 바꾼다). 카드는 히어로 아래 · 카드 격자 위 한 줄.
export function HandoverHomeCards({ onTaskClick }) {
  const m = useHandoverModel();
  const me = useStore(selectCurrentUser)?.name || '';
  const [writing, setWriting] = useState(null);
  // 클라우드: 앱을 연 뒤 한 번 내 줄을 읽는다(마스터가 탭에서 이미 읽었으면 그대로)
  useEffect(() => { if (!handoverOn() && !m.hv.loaded) loadHandover(); }, [m.hv.loaded]);
  const mine = myPersonIds(m.people, me);
  if (!mine.length && m.hv.origName == null) return null;
  // 게스트 시연은 한 벌의 '적용됨'을 보고, 클라우드는 줄마다(해 · 적용한 때)를 본다
  const demo = handoverOn();
  const outgoing = m.items.filter(it => mine.includes(it.from) && (demo ? !m.hv.applied : !it.appliedAt && (it.year ?? TO_YEAR) === TO_YEAR && !m.hv.applied));
  const incoming = m.items.filter(it => mine.includes(it.to) && (demo ? !!m.hv.applied : !!(it.appliedAt || m.hv.applied)) && !m.hv.seen?.[it.id]);
  const viewing = m.hv.origName != null;
  if (!outgoing.length && !incoming.length && !viewing) return null;
  const taskById = new Map(m.tasks.map(t => [t.id, t]));
  return (
    <div className="hv-home mb-3 md:mb-3.5 space-y-3">
      {viewing && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-fg-muted" style={CARD_STYLE}>
          <Eye size={13} className="shrink-0 text-fg-faint" />
          <span className="flex-1 min-w-0 truncate">{`${me}님 화면으로 보는 중`}</span>
          <button type="button" onClick={viewBack} className="shrink-0 px-2 py-1 rounded-md text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover">돌아가기</button>
        </div>
      )}
      {outgoing.map(it => {
        const to = m.nameOf(it.to);
        const labels = itemPhrases(it).join(' · ');
        const done = !!m.hv.notes?.[it.id]?.done;
        const taskCount = (m.hv.notes?.[it.id]?.taskIds || []).length;
        // 작성 완료 뒤에는 한 줄로 접는다(사용자 승인 목업 ⑥-c 2026-10-19 — 1월 1일까지 큰 카드가 홈 맨 위를 차지했다).
        // 쓰기 전 카드 ↔ 한 줄은 접고 펴기(Fold · quint) · 한 줄의 '수정'은 같은 인계 내용 시트를 연다.
        return (
          <div key={it.id} data-hv-out={it.id} data-hv-done={done ? 'true' : 'false'} className={`home-card dc-card ${CARD}`} style={CARD_STYLE}>
            <Fold open={!done}>
              <div className="p-4 md:p-[18px]">
                <span className="flex items-center gap-1.5 h-[18px] mb-2">
                  <Handshake size={13} className="text-fg-faint shrink-0" />
                  <span className="text-[11.5px] font-semibold text-fg-muted">인수인계</span>
                </span>
                <p className="text-[15px] font-extrabold text-fg tracking-[-0.3px] leading-[1.4]">
                  {to ? `${TO_YEAR}년 ${labels}${objectParticle(labels)} ${to}님에게 인계해요` : `${TO_YEAR}년 ${labels} 인계`}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[12px] text-fg-muted tabular-nums">{[`업무 ${taskCount}건`, '미작성'].join(' · ')}</span>
                  <button type="button" className={`${BTN} ml-auto inline-flex items-center gap-1`} onClick={() => setWriting(it)}>
                    <PencilLine size={13} /><span>인계 내용 작성</span>
                  </button>
                </div>
              </div>
            </Fold>
            <Fold open={done}>
              <div className="flex items-center gap-2.5 h-12 pl-4 pr-2" data-hv-line="">
                <span className="w-[18px] h-[18px] rounded-full bg-tag-green text-tag-green-fg flex items-center justify-center shrink-0"><Check size={11} strokeWidth={2.5} /></span>
                <span className="flex-1 min-w-0 truncate text-[12.5px] text-fg-secondary">
                  {[`${labels} 인계 내용을 작성했어요`, to ? `업무 ${taskCount}건` : '인수자 미정'].join(' · ')}
                </span>
                <button type="button" onClick={() => setWriting(it)}
                  className="shrink-0 px-2.5 h-8 rounded-md text-[12px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-95">수정</button>
              </div>
            </Fold>
          </div>
        );
      })}
      {incoming.map(it => {
        const from = m.byId.get(it.from);
        const labels = itemPhrases(it).filter(l => l !== GRAD_LABEL);
        const what = labels.length ? labels.join(' · ') : '업무';
        const note = m.hv.notes?.[it.id];
        const tasks = (note?.taskIds || []).map(id => taskById.get(id)).filter(Boolean);
        return (
          <div key={it.id} data-hv-in={it.id} className={`home-card dc-card ${CARD} p-4 md:p-[18px]`} style={CARD_STYLE}>
            <span className="flex items-center gap-1.5 h-[18px] mb-2">
              <Handshake size={13} className="text-fg-faint shrink-0" />
              <span className="text-[11.5px] font-semibold text-fg-muted">인수인계</span>
            </span>
            <div className="flex items-center gap-2">
              <Face person={from} size="w-7 h-7 text-[11.5px]" />
              <p className="min-w-0 text-[15px] font-extrabold text-fg tracking-[-0.3px] leading-[1.4]">
                {`${from?.name || ''}님에게서 ${what}${objectParticle(what)} 인계받았어요`}
              </p>
            </div>
            <div className="mt-3 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-4">
              <blockquote className="px-3 py-2.5 rounded-lg text-[13px] leading-[1.65] text-fg whitespace-pre-wrap"
                style={{ background: 'var(--app-surface-hover)' }}>
                {note?.note || <span className="text-fg-muted">전달 사항 미입력</span>}
              </blockquote>
              <div className="mt-3 md:mt-0">
                <p className="mb-1.5 text-[11px] font-semibold text-fg-muted">{`인계받은 업무 ${tasks.length}건`}</p>
                {tasks.map(t => (
                  <button key={t.id} type="button" onClick={() => onTaskClick?.(t)}
                    className="w-full flex items-center gap-2 py-1.5 text-left rounded-md hover:bg-surface-hover transition-colors">
                    <span className={`shrink-0 px-1.5 py-px rounded-xs text-[10px] font-bold ${CONFIG.STATUS_STYLES[t.status] || ''}`}>{t.status}</span>
                    <span className={`flex-1 text-[12.5px] text-fg ${ONE_LINE}`}>{t.title}</span>
                    <ChevronRight size={13} className="shrink-0 text-fg-faint" />
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button type="button" className={BTN} onClick={() => tryWrite(markSeen(it))}>확인</button>
            </div>
          </div>
        );
      })}
      {writing && <HandoverSheet m={m} item={writing} onClose={() => setWriting(null)} />}
    </div>
  );
}

