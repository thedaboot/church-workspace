import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Wrench, ChevronLeft, ChevronDown, Bell, ImageOff } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLeave } from '../hooks/useExit.js';
import { Segmented } from './segmented.jsx';
import { Avatar } from './Avatar.jsx';
import { showToast } from './Toast.jsx';
import { formatRelative } from '../utils.js';
import {
  groupErrors, deviceOf, speedStats, secText, feedbackCounts, filterAudit, byDay, screenOf,
} from '../services/opsCore.js';
import {
  useFeedback, setFeedbackStatus, useErrorEvents, speedSamples, auditRows, AUDIT_KINDS,
} from '../services/opsDemo.js';

// ============================================================================
// 운영 창(시안 v5 2묶음 · mock/b3 · **마스터만** · 입구는 프로필 메뉴 · 게스트 시연에서만 선다)
// ----------------------------------------------------------------------------
// 탭 넷: 불편 사항 · 화면 오류 · 다붓이 답변 속도 · 관리 기록. 저장 자리는 services/opsDemo.js(게스트 브라우저),
// 셈·묶기는 services/opsCore.js(순수 · logcheck-live).
//   · 폰은 화면 전체(.dc-rise · 보이는 창 높이 --app-vh), 데스크톱은 큰 가운데 대화창(.dc-dialog) · 뒤판 .dc-scrim ·
//     닫힘 useLeave(.dc-out) · body 포털 z-[95](휴지통 창과 같은 자리).
//   · 불편 사항: 상태 셋(새로 들어옴 · 확인함 · 고침)으로 거른다 · 데스크톱은 목록 | 내용 두 칸, 폰은 목록 → 내용(뒤로).
//     '고침'으로 바꾸면 보낸 사람에게 알림(opsDemo.setFeedbackStatus — 보낸 사람이 나면 내 알림 종에 들어온다).
//   · 화면 오류: 지문으로 묶은 줄(횟수 · 사람 수 · 마지막 · 화면 · 기기·브라우저 · 빌드) → 눌러 펼치면 스택과 최근에 난 차례.
//   · 다붓이 답변 속도: 기간의 중간값 · 느린 답 비율 · 최근 느린 질문(묻는 사람은 싣지 않는다 — 견주지 않는다).
//   · 관리 기록: 누가 · 무엇을 · 언제 — 종류 칩으로 거르고 날짜로 묶는다.
// 문구는 모두 사용자 확인 전 자리표다(시안 커밋 메시지의 표).
// ============================================================================

const SLOW_MS = 8000;
const STATUS = {
  new: ['새로 들어옴', 'bg-accent-weak text-accent-text'],
  seen: ['확인함', 'bg-tag-yellow text-tag-yellow-fg'],
  fixed: ['고침', 'bg-tag-green text-tag-green-fg'],
};
const timeText = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateTimeText = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${timeText(iso)}`;
};

const StatusChip = ({ status }) => {
  const [label, cls] = STATUS[status] || STATUS.new;
  return <span className={`shrink-0 px-1.5 py-px rounded-xs text-[10.5px] font-semibold ${cls}`}>{label}</span>;
};

const Empty = ({ children }) => (
  <p data-ops-empty="" className="flex-1 flex items-center justify-center py-14 text-center text-[13px] text-fg-muted">{children}</p>
);

// 회색 토글 한 벌(Segmented) — 탭 안 거르기 줄
const Filter = ({ items, value, onPick, label }) => (
  <Segmented items={items} value={value} onPick={onPick} aria-label={label}
    className="inline-flex p-[3px] rounded-md max-w-full"
    btnClassName="px-2.5 py-[5px] rounded-sm text-[11.5px] font-semibold whitespace-nowrap transition-colors" />
);

// ── 불편 사항 ───────────────────────────────────────────────────────────────
function FeedbackRow({ f, on, onPick }) {
  const { device, browser } = deviceOf(f.ua);
  return (
    <li>
      <button type="button" onClick={() => onPick(f.id)} data-fb-row={f.status}
        className={`w-full text-left flex items-start gap-2.5 px-3 py-3 border-b border-line/70 transition-colors ${on ? 'bg-accent-weak/50' : 'hover:bg-surface-hover'}`}>
        <Avatar name={f.user} className="flex w-7 h-7 text-[11px] shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12.5px] font-semibold text-fg truncate">{f.user}</span>
            <span className="text-[11px] text-fg-muted shrink-0">{formatRelative(f.at)}</span>
            <span className="flex-1" />
            <StatusChip status={f.status} />
          </span>
          <span className="block text-[12.5px] text-fg-secondary leading-snug mt-1 line-clamp-2">{f.text}</span>
          <span className="block text-[11px] text-fg-muted mt-1 truncate">{[f.screenName || screenOf(f.route), device, browser].join(' · ')}</span>
        </span>
        {f.shot && <img src={f.shot} alt="" className="shrink-0 w-10 h-12 object-cover object-top rounded-xs border border-line bg-canvas" />}
      </button>
    </li>
  );
}

function FeedbackDetail({ f, me, onBack }) {
  const { device, browser } = deviceOf(f.ua);
  const pick = (status) => {
    if (status === f.status) return;
    const t = setFeedbackStatus(f.id, status, me);
    if (status === 'fixed' && t) showToast(`${t.user}님에게 알림을 보냈어요`);
  };
  const facts = [
    ['화면', f.screenName || screenOf(f.route)],
    ['기기', `${device} · ${browser}`],
    ['화면 크기', f.size],
    ['빌드', f.build],
  ].filter(([, v]) => v);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-5 py-4" data-fb-detail="">
      {onBack && (
        <button type="button" onClick={onBack} className="-ml-1.5 mb-2 inline-flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[12px] text-fg-muted hover:bg-surface-hover">
          <ChevronLeft size={15} />목록
        </button>
      )}
      <div className="flex items-center gap-2.5">
        <Avatar name={f.user} className="flex w-8 h-8 text-xs shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-fg truncate">{f.user}</span>
          <span className="block text-[11px] text-fg-muted">{dateTimeText(f.at)}</span>
        </span>
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-fg whitespace-pre-wrap break-words">{f.text}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Filter label="상태" value={f.status} onPick={pick}
          items={[['new', STATUS.new[0]], ['seen', STATUS.seen[0]], ['fixed', STATUS.fixed[0], { 'data-fb-fix': '' }]]} />
      </div>
      {f.status === 'fixed' && f.notified && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-muted" data-fb-notified="">
          <Bell size={12} className="shrink-0" />{f.user}님에게 알림을 보냈어요{f.statusAt ? ` · ${dateTimeText(f.statusAt)}` : ''}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        {facts.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-fg min-w-0 break-words">{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      <div className="mt-4">
        {f.shot ? (
          <img src={f.shot} alt="화면 사진" className="w-full max-w-[420px] rounded-md border border-line bg-canvas" />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted"><ImageOff size={13} />화면 사진 미첨부</span>
        )}
      </div>
    </div>
  );
}

function FeedbackTab({ isMobile }) {
  const list = useFeedback();
  const me = useStore(selectCurrentUser).name;
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const c = feedbackCounts(list);
  const shown = filter === 'all' ? list : list.filter(f => f.status === filter);
  // 데스크톱은 늘 하나를 펴 둔다(오른쪽 칸이 비지 않게) · 폰은 누를 때만
  const current = list.find(f => f.id === openId) || (!isMobile ? shown[0] : null);
  const EMPTY = { all: '받은 불편 사항 0건', new: '새로 들어온 불편 사항을 다 확인했어요', seen: '확인 중인 불편 사항 0건', fixed: '고친 불편 사항 0건' };

  if (isMobile && current) return <FeedbackDetail f={current} me={me} onBack={() => setOpenId(null)} />;
  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex flex-col min-h-0 w-full md:w-[380px] md:shrink-0 md:border-r md:border-line">
        <div className="px-4 md:px-5 pt-3 pb-2 shrink-0">
          <Filter label="상태" value={filter} onPick={setFilter} items={[
            ['all', <>전체 <span className="tabular-nums">{c.all}</span></>],
            ['new', <>{STATUS.new[0]} <span className="tabular-nums">{c.new}</span></>],
            ['seen', <>{STATUS.seen[0]} <span className="tabular-nums">{c.seen}</span></>],
            ['fixed', <>{STATUS.fixed[0]} <span className="tabular-nums">{c.fixed}</span></>],
          ]} />
        </div>
        {shown.length ? (
          <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-fb-list="">
            {shown.map(f => <FeedbackRow key={f.id} f={f} on={!isMobile && current?.id === f.id} onPick={setOpenId} />)}
          </ul>
        ) : <Empty>{EMPTY[filter]}</Empty>}
      </div>
      {!isMobile && (current ? <FeedbackDetail key={current.id} f={current} me={me} /> : <Empty>받은 불편 사항 0건</Empty>)}
    </div>
  );
}

// ── 화면 오류 ──────────────────────────────────────────────────────────────
const PERIODS = { day: 1, week: 7, month: 30 };
function ErrorRow({ g }) {
  const [open, setOpen] = useState(false);
  const route = g.routes[0]?.[0];
  const meta = [
    `마지막 ${formatRelative(g.lastSeen)}`,
    `${g.people}명`,
    route && screenOf(route) + (g.routes.length > 1 ? ` 외 ${g.routes.length - 1}곳` : ''),
    g.devices[0]?.[0],
    g.builds.map(b => b[0]).join(', '),
  ].filter(Boolean);
  return (
    <li className="border-b border-line/70" data-err-group="">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full text-left flex items-start gap-3 px-4 md:px-5 py-3 hover:bg-surface-hover transition-colors">
        <span className="shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full bg-tag-red-fg" />
        <span className="flex-1 min-w-0">
          <span className="block font-mono text-[12px] text-fg leading-snug break-words line-clamp-2">{g.message}</span>
          <span className="block mt-1 text-[11px] text-fg-muted break-words">{meta.join(' · ')}</span>
        </span>
        <span className="shrink-0 px-1.5 py-px rounded-xs bg-tag-red text-tag-red-fg text-[11px] font-bold tabular-nums" data-err-count={g.count}>{g.count}회</span>
        <ChevronDown size={14} className={`shrink-0 mt-0.5 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 md:px-5 pb-3 md:pl-[38px]">
          {g.stack && (
            <pre className="text-[10.5px] leading-relaxed font-mono text-fg-muted bg-canvas border border-line rounded-md p-2.5 overflow-x-auto max-w-full whitespace-pre">{g.stack}</pre>
          )}
          <ul className="mt-2 text-[11.5px]">
            {g.events.slice(0, 8).map(ev => {
              const d = deviceOf(ev.ua);
              return (
                <li key={ev.id} className="flex flex-wrap gap-x-2 py-1 border-b border-line/50 last:border-b-0 text-fg-muted">
                  <span className="text-fg tabular-nums">{dateTimeText(ev.at)}</span>
                  <span>{screenOf(ev.route)}</span>
                  <span>{d.device} · {d.browser}</span>
                  <span>{ev.build}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

function ErrorsTab() {
  const events = useErrorEvents();
  const [period, setPeriod] = useState('week');
  const groups = useMemo(() => groupErrors(events, { since: Date.now() - PERIODS[period] * 86400000 }), [events, period]);
  const total = groups.reduce((s, g) => s + g.count, 0);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 md:px-5 pt-3 pb-2 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Filter label="기간" value={period} onPick={setPeriod} items={[['day', '24시간'], ['week', '7일'], ['month', '30일']]} />
        <span className="text-[11.5px] text-fg-muted tabular-nums">{groups.length}종 · {total}회</span>
      </div>
      {groups.length ? (
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{groups.map(g => <ErrorRow key={g.fp} g={g} />)}</ul>
      ) : <Empty>이 기간에 난 오류 0건</Empty>}
    </div>
  );
}

// ── 다붓이 답변 속도 ───────────────────────────────────────────────────────
const Tile = ({ label, value, sub }) => (
  <div className="flex-1 min-w-0 rounded-md border border-line bg-surface px-3 py-2.5">
    <p className="text-[11px] text-fg-muted">{label}</p>
    <p className="text-[20px] font-bold text-fg tabular-nums tracking-[-0.3px] mt-0.5">{value}</p>
    {sub && <p className="text-[11px] text-fg-muted mt-0.5 truncate">{sub}</p>}
  </div>
);

function SpeedTab() {
  const [period, setPeriod] = useState('week');
  const s = useMemo(() => speedStats(speedSamples(), { days: PERIODS[period], slowMs: SLOW_MS }), [period]);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-5 py-3">
      <Filter label="기간" value={period} onPick={setPeriod} items={[['week', '7일'], ['month', '30일']]} />
      <div className="mt-3 flex gap-2" data-speed-tiles="">
        <Tile label="중간값" value={secText(s.median)} />
        <Tile label="느린 답" value={s.slowRatio == null ? '-' : `${Math.round(s.slowRatio * 100)}%`} sub={`${secText(SLOW_MS)} 넘은 답 ${s.slowCount}건`} />
        <Tile label="질문" value={`${s.count}건`} />
      </div>
      <h4 className="mt-5 mb-1 text-[12px] font-semibold text-fg-muted">최근 느린 질문</h4>
      {s.recentSlow.length ? (
        <ul>
          {s.recentSlow.map((q, i) => (
            <li key={i} className="flex items-start gap-3 py-2.5 border-b border-line/70 last:border-b-0" data-slow-row="">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-fg break-words">{q.q}</span>
                <span className="block text-[11px] text-fg-muted mt-0.5">
                  근거 찾기 {secText(q.findMs)} · 답 쓰기 {secText(q.writeMs)} · {formatRelative(q.at)}
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-bold text-tag-red-fg tabular-nums">{secText(q.ms)}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>느린 답 0건</Empty>}
    </div>
  );
}

// ── 관리 기록 ──────────────────────────────────────────────────────────────
function AuditTab() {
  const rows = auditRows();
  const [kind, setKind] = useState('all');
  const shown = filterAudit(rows, kind);
  const days = byDay(shown);
  const count = (k) => filterAudit(rows, k).length;
  const chip = ([k, label]) => {
    const on = kind === k;
    return (
      <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={on} data-audit-kind={k}
        className="shrink-0 px-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
        style={{ background: on ? 'var(--app-ink)' : 'var(--app-surface-hover)', color: on ? 'var(--app-canvas)' : 'var(--app-ink-muted)', fontWeight: on ? 700 : 500 }}>
        {label} <span className="tabular-nums">{count(k)}</span>
      </button>
    );
  };
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1.5 px-4 md:px-5 pt-3 pb-2 overflow-x-auto md:flex-wrap scrollbar-hide x-scroll-lock shrink-0">
        {AUDIT_KINDS.map(chip)}
      </div>
      {days.length ? (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-5 pb-3">
          {days.map(d => (
            <section key={d.key}>
              <h4 className="pt-3 pb-1 text-[11px] font-semibold text-fg-muted">{d.label}</h4>
              <ul>
                {d.rows.map(r => (
                  <li key={r.id} className="flex items-start gap-2.5 py-2 border-b border-line/60 last:border-b-0" data-audit-row={r.kind}>
                    <Avatar name={r.who} className="flex w-6 h-6 text-[10px] shrink-0 mt-px" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] text-fg-secondary leading-snug">
                        <span className="font-semibold text-fg">{r.who}</span>님이 {r.text}
                      </span>
                      <span className="block text-[11px] text-fg-muted mt-0.5 break-words">{r.target}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">{timeText(r.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : <Empty>이 종류의 기록 0건</Empty>}
    </div>
  );
}

// ── 창 ─────────────────────────────────────────────────────────────────────
export function OpsDesk({ onClose }) {
  const isMobile = useIsMobile();
  const [leaving, leave] = useLeave();
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const [tab, setTab] = useState('feedback');
  const newCount = feedbackCounts(useFeedback()).new;
  const downOnScrim = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  const out = leaving ? ' dc-out' : '';
  const TABS = [
    ['feedback', <>불편 사항{newCount > 0 && <span className="ml-1 tabular-nums text-accent-text">{newCount}</span>}</>],
    ['errors', '화면 오류'],
    ['speed', isMobile ? '답변 속도' : '다붓이 답변 속도'],
    ['audit', '관리 기록'],
  ];

  const body = (
    <>
      <div className="flex items-center gap-2 px-4 md:px-5 pt-3 md:pt-4 shrink-0">
        <h3 className="flex-1 font-bold text-fg tracking-[-0.25px] flex items-center gap-2"><Wrench size={16} className="text-fg-muted" />운영</h3>
        <button type="button" onClick={close} title="닫기" aria-label="닫기" className="p-1 rounded-full text-fg-faint hover:bg-surface-hover"><X size={18} strokeWidth={1.75} /></button>
      </div>
      <div className="px-4 md:px-5 pt-3 pb-1 shrink-0 border-b border-line">
        <Segmented items={TABS} value={tab} onPick={setTab} tabs role="tablist" aria-label="운영"
          className="grid grid-cols-4 md:inline-grid md:grid-flow-col md:auto-cols-max p-[3px] rounded-md mb-2 w-full md:w-auto"
          btnClassName="px-1.5 md:px-3.5 py-[6px] rounded-sm text-[12px] font-semibold whitespace-nowrap transition-colors" />
      </div>
      <div className="flex-1 min-h-0 flex flex-col" role="tabpanel">
        {tab === 'feedback' && <FeedbackTab isMobile={isMobile} />}
        {tab === 'errors' && <ErrorsTab />}
        {tab === 'speed' && <SpeedTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </>
  );

  return createPortal(isMobile ? (
    <div role="dialog" aria-label="운영" data-ops-desk=""
      className={`fixed inset-x-0 top-0 h-[var(--app-vh,100dvh)] z-[95] flex flex-col bg-surface dc-rise${out}`}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {body}
    </div>
  ) : (
    <div onMouseDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnScrim.current) close(); }}
      className={`fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-6 dc-scrim${out}`}>
      <div role="dialog" aria-label="운영" data-ops-desk=""
        className={`bg-surface rounded-lg shadow-elevated border border-line w-full max-w-[1040px] h-[min(760px,88dvh)] flex flex-col overflow-hidden dc-dialog${out}`}>
        {body}
      </div>
    </div>
  ), document.body);
}
