import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { ChevronLeft, ChevronRight, Users, Lock, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectMembers, selectCurrentUser } from '../store/selectors.js';
import { Avatar } from '../components/Avatar.jsx';
import { RichText } from '../components/RichText.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';
import { SectionHead, Card } from './dashboardParts.jsx';
import { loadPassage } from '../services/bible.js';
import { BibleTab, PassageText, PassageSkeleton, EmptyBookMark, Swap } from '../components/wordBible.jsx';
import {
  kstToday, shiftDay, dayLabel, shortDayLabel, monthDays, weekRange,
  fetchSchedule, fetchMyEntry, saveMyEntry, deleteMyEntry, fetchSharedEntries, fetchMyEntryDates,
} from '../services/word.js';

// ============================================================================
// v2 말씀 화면 — QT(오늘 본문 · 묵상 기록 · 나눔 · 내 기록) | 성경 읽기
// ----------------------------------------------------------------------------
// 스펙은 docs/V2.md §1(결정 8~12)·§3. 저장 계층은 services/word.js, 본문 데이터는
// public/bible/*.json(services/bible.js), 구절 해석은 services/bibleRef.js다.
//
// **잔디(내 기록)는 개인 전용이다**(결정 10). 'N일 연속'·배지·남과의 비교를 여기에
// 붙이지 않는다 — 한 주 못 오면 벌 받는 느낌이 남고, 이 화면은 같이 사역하는
// 사람들이 본다(§7 '랭킹·점수·배지·스트릭'). 순장도 순원의 잔디를 볼 수 없어서
// 애초에 남의 기록은 묻지도 않는다(fetchMyEntryDates는 내 것만 읽는다).
//
// 묵상은 기본 비공개이고 '나누기'를 켠 글만 그날 나눔에 오른다(결정 11). 경계는
// 화면이 아니라 RLS가 지킨다(0036).
//
// **날짜를 바꿔도 자리는 그대로 있어야 한다**(사용자 피드백 2026-09-01 — "화면 전체가
// 새로 그려지며 움직인다"). 본문·묵상·나눔 세 칸 모두 기다리는 동안 같은 자리에
// 스켈레톤을 세우고 최소 높이를 잡아 둔다. 바뀌는 것은 안의 내용뿐이다.
//
// **본문표 붙여넣기 도구는 없다** — 읽기표 730일치가 0038로 qt_schedule에 들어 있다
// (services/word.js 머리말). 되살리지 말 것.
// ============================================================================

const SEGMENTS = [['qt', 'QT'], ['read', '성경 읽기']];

// 업무 본문과 **같은 에디터**를 쓴다(사용자 피드백 2026-09-01). 저장 형식도 같은
// 마크다운이고 나눔 피드는 RichText로 그린다. TipTap은 무거우므로 modals가 하듯
// lazy로 떼어 둔다(§1.3) — 성경 읽기만 보다 나가는 사람은 받지 않는다.
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
// 서식 바(37px) + 본문 칸(min-h-40 = 160px). 에디터가 붙기 전에도 같은 높이를 잡아
// 두어야 도착하는 순간 아래 것들이 밀리지 않는다.
const EDITOR_H = 197;
const EditorSkeleton = () => <div className="dc-skeleton border border-line rounded-md" style={{ height: EDITOR_H }} />;

// 주보의 본문 구절에서 넘어오는 자리를 위해 initialTab·initialRef를 받는다
// (App.jsx는 지금 <WordView />로만 부른다 — 회차 3 IA 재편에서 이어 붙인다).
export function WordView({ initialTab = 'qt', initialRef = '' }) {
  const [tab, setTab] = useState(initialRef ? 'read' : initialTab);
  const [dir, setDir] = useState(0);

  const pick = (key) => {
    if (key === tab) return;
    setDir(SEGMENTS.findIndex(s => s[0] === key) > SEGMENTS.findIndex(s => s[0] === tab) ? 1 : -1);
    setTab(key);
  };

  return (
    <div className="dc-screen pb-6">
      <div className="flex items-center gap-2 pb-3.5">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {SEGMENTS.map(([key, label]) => (
            <button key={key} onClick={() => pick(key)}
              className="px-3.5 py-[6px] rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: tab === key ? 'var(--app-surface)' : 'transparent',
                color: tab === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{label}</button>
          ))}
        </span>
      </div>

      <Swap k={tab} dir={dir}>
        {tab === 'qt' ? <QtTab /> : <BibleTab initialRef={initialRef} />}
      </Swap>
    </div>
  );
}

// ── QT ──────────────────────────────────────────────────────────────────────
function QtTab() {
  const members = useStore(selectMembers);
  const currentUser = useStore(selectCurrentUser);
  const today = kstToday();

  const [date, setDate] = useState(today);
  const [dir, setDir] = useState(0);
  const [day, setDay] = useState({ loading: true, schedule: null, passage: null });
  const [draft, setDraft] = useState(null);        // { body, shared } — null이면 아직 안 읽음
  const [saved, setSaved] = useState({ body: '', shared: false });
  const [saving, setSaving] = useState(false);
  const [feed, setFeed] = useState(null);          // null이면 아직 안 읽음
  const [grass, setGrass] = useState([]);
  const editorRef = useRef(null);

  const go = (next) => {
    if (next === date) return;
    setDir(next > date ? 1 : -1);
    setDate(next);
  };

  // 그날 본문 — 일정 한 줄을 읽고, 구절이 있으면 본문까지 편다
  useEffect(() => {
    let alive = true;
    setDay({ loading: true, schedule: null, passage: null });
    (async () => {
      const schedule = await fetchSchedule(date);
      if (!alive) return;
      if (!schedule) { setDay({ loading: false, schedule: null, passage: null }); return; }
      let passage = null;
      try { passage = await loadPassage(schedule.passage_ref); } catch { /* 못 읽으면 구절만 보여준다 */ }
      if (alive) setDay({ loading: false, schedule, passage });
    })().catch(() => alive && setDay({ loading: false, schedule: null, passage: null }));
    return () => { alive = false; };
  }, [date]);

  // 내 묵상 · 그날 나눔
  useEffect(() => {
    let alive = true;
    setDraft(null); setFeed(null);
    (async () => {
      const [mine, shared] = await Promise.all([fetchMyEntry(date), fetchSharedEntries(date)]);
      if (!alive) return;
      const next = { body: mine?.body || '', shared: !!mine?.shared };
      setDraft(next); setSaved(next); setFeed(shared);
    })().catch(() => {
      if (!alive) return;
      setDraft({ body: '', shared: false }); setSaved({ body: '', shared: false }); setFeed([]);
    });
    return () => { alive = false; };
  }, [date]);

  // 잔디 — 이번 달 + 이번 주가 걸친 만큼만 읽는다(달을 넘나드는 주가 있다)
  const month = useMemo(() => monthDays(today), [today]);
  const [weekStart, weekEnd] = useMemo(() => weekRange(today), [today]);
  const reloadGrass = useCallback(() => {
    const from = weekStart < month.days[0] ? weekStart : month.days[0];
    const to = weekEnd > month.days[month.days.length - 1] ? weekEnd : month.days[month.days.length - 1];
    fetchMyEntryDates(from, to).then(setGrass).catch(() => {});
  }, [month, weekStart, weekEnd]);
  useEffect(() => { reloadGrass(); }, [reloadGrass]);

  const dirty = !!draft && (draft.body !== saved.body || draft.shared !== saved.shared);
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveMyEntry(date, draft);
      setSaved(draft);
      setFeed(await fetchSharedEntries(date));
      reloadGrass();
      showToast(draft.shared ? '묵상을 저장하고 나눔에 올렸어요' : '묵상을 저장했어요');
    } catch (e) {
      console.error('[word] 묵상 저장 실패:', e);
      showToast(failText('묵상을 저장하지 못했어요', e));
    } finally {
      setSaving(false);
    }
  };

  // 나눔에서 내 글을 지운다 — 그 날 묵상 자체가 없어지므로 잔디에서도 빠진다
  const removeMine = async () => {
    try {
      await deleteMyEntry(date);
      const blank = { body: '', shared: false };
      setDraft(blank); setSaved(blank);
      setFeed(await fetchSharedEntries(date));
      reloadGrass();
      showToast('묵상을 지웠어요');
    } catch (e) {
      console.error('[word] 묵상 삭제 실패:', e);
      showToast(failText('묵상을 지우지 못했어요', e));
    }
  };

  // 고치기는 위의 '내 묵상' 칸이 한다 — 같은 글을 두 자리에서 고칠 수 있으면
  // 어느 쪽이 진짜인지 알 수 없다. 그 칸으로 데려가고 커서를 준다.
  const editMine = () => {
    const box = editorRef.current;
    if (!box) return;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.querySelector('.tiptap')?.focus();
  };

  return (
    <div className="grid gap-x-7 gap-y-6 items-start side-grid">
      {/* 읽는 폭은 46rem에서 끊는다 — 본문은 오래 읽는 글이라 한 줄이 길면 눈이 샌다 */}
      <div className="min-w-0 max-w-[46rem]">
        {/* 날짜 이동 */}
        <div className="flex items-center gap-1 pb-3">
          <button onClick={() => go(shiftDay(date, -1))} aria-label="어제"
            className="w-9 h-9 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95">
            <ChevronLeft size={17} />
          </button>
          <span className="text-[13.5px] font-bold text-fg tabular-nums px-1">{dayLabel(date)}</span>
          <button onClick={() => go(shiftDay(date, 1))} aria-label="내일"
            className="w-9 h-9 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95">
            <ChevronRight size={17} />
          </button>
          {date !== today && (
            <button onClick={() => go(today)}
              className="ml-1 px-2.5 h-8 rounded-md text-[11.5px] font-semibold text-accent-text bg-accent-weak transition active:scale-95">
              오늘로
            </button>
          )}
        </div>

        {/* 본문 — 기다리는 동안에도 같은 자리에 같은 크기로 서 있는다 */}
        <div className="min-h-[320px]">
          <Swap k={date} dir={dir}><QtPassage day={day} /></Swap>
        </div>

        {/* 내 묵상 */}
        <div className="mt-6" ref={editorRef}>
          <SectionHead>내 묵상</SectionHead>
          <div style={{ minHeight: EDITOR_H }}>
            {draft ? (
              <Suspense fallback={<EditorSkeleton />}>
                <MarkdownEditor
                  value={draft.body}
                  onChange={(md) => setDraft(d => (d ? { ...d, body: md } : d))}
                  placeholder="오늘 본문에서 마음에 남은 것"
                  className="min-h-40 border border-line rounded-md rounded-t-none p-3 bg-surface focus-within:border-accent focus-within:shadow-soft transition-all"
                />
              </Suspense>
            ) : <EditorSkeleton />}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <button onClick={save} disabled={!dirty || saving}
              className="bg-accent hover:bg-accent-strong disabled:bg-line text-white px-4 py-1.5 rounded-md text-[11.5px] font-semibold transition active:scale-95">
              저장
            </button>
            <span className="flex-1" />
            <ShareToggle
              value={!!draft?.shared} disabled={!draft}
              onChange={v => setDraft(d => (d && d.shared !== v ? { ...d, shared: v } : d))}
            />
          </div>
        </div>

        {/* 그날의 나눔 */}
        <div className="mt-6">
          <SectionHead>{date === today ? '오늘의 나눔' : '이 날의 나눔'}</SectionHead>
          <div className="min-h-[72px]">
            {feed === null
              ? <FeedSkeleton />
              : <ShareFeed entries={feed} members={members} myName={currentUser?.name || ''}
                  onEdit={editMine} onDelete={removeMine} />}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <Grass month={month} today={today} dates={grass} weekStart={weekStart} weekEnd={weekEnd} onPick={go} />
      </div>
    </div>
  );
}

// ── 나만 보기 / 나누기 ──────────────────────────────────────────────────────
// **이미 그 상태인 쪽을 눌러도 아무 일도 일어나지 않는다**(사용자 지적 2026-09-01 —
// 예전에는 한 버튼이 상태를 표시하면서 누르면 뒤집혀서, 지금 상태를 확인하려고 누른
// 사람이 값을 바꿔 놓고 저장 버튼을 켰다). 두 쪽을 나란히 두고 값이 실제로 달라질
// 때만 draft를 새로 만든다 — 같은 객체를 돌려주면 리렌더도 dirty도 없다.
function ShareToggle({ value, disabled, onChange }) {
  const OPTIONS = [[false, '나만 보기', Lock], [true, '나누기', Users]];
  return (
    <span className={`flex p-[3px] rounded-[8px] shrink-0 ${disabled ? 'opacity-40' : ''}`}
      style={{ background: 'var(--app-surface-hover)' }}>
      {OPTIONS.map(([v, label, Icon]) => (
        <button
          key={label} onClick={() => onChange(v)} disabled={disabled} aria-pressed={value === v}
          className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[5px] text-[11.5px] font-semibold transition-colors"
          style={{
            background: value === v ? 'var(--app-surface)' : 'transparent',
            color: value === v ? 'var(--app-ink)' : 'var(--app-ink-muted)',
          }}
        >
          <Icon size={12.5} />{label}
        </button>
      ))}
    </span>
  );
}

// ── 그날 본문 ───────────────────────────────────────────────────────────────
export function QtPassage({ day }) {
  if (day.loading) return <Card className="p-4 md:p-5"><PassageSkeleton lines={8} /></Card>;
  if (!day.schedule) {
    return (
      <div className="min-h-[220px] flex flex-col items-center justify-center text-center">
        <EmptyBookMark />
        <p className="text-[13.5px] font-semibold text-fg mt-3">이 날짜의 본문이 아직 올라오지 않았어요</p>
      </div>
    );
  }
  const { schedule, passage } = day;
  return (
    <Card className="p-4 md:p-5">
      {schedule.label && (
        <h3 className="text-[15.5px] font-extrabold text-fg tracking-[-0.3px]">{schedule.label}</h3>
      )}
      <p className={`text-[12px] font-bold text-accent-text ${schedule.label ? 'mt-0.5' : ''}`}>{schedule.passage_ref}</p>
      <div className="mt-3.5">
        {passage?.verses?.length
          ? <PassageText verses={passage.verses} showChapter={passage.verses[0].chapter !== passage.verses.at(-1).chapter} />
          : <p className="text-[12.5px] text-fg-faint">적어 둔 구절을 성경에서 찾지 못했어요</p>}
      </div>
    </Card>
  );
}

// ── 나눔 피드 ───────────────────────────────────────────────────────────────
// 묵상은 업무 본문과 같은 마크다운이라 여기서도 같은 뷰어(RichText)로 그린다.
function FeedSkeleton() {
  return (
    <div className="flex items-start gap-2.5 py-2.5" aria-hidden="true">
      <div className="w-7 h-7 shrink-0 mt-px"><Skeleton className="w-full h-full rounded-full" /></div>
      <div className="flex-1 min-w-0">
        <Skeleton className="h-3 w-16 rounded-[4px]" />
        <div className="mt-1.5"><Skeleton className="h-3.5 w-full rounded-[4px]" /></div>
      </div>
    </div>
  );
}

export function ShareFeed({ entries, members = [], myName = '', onEdit, onDelete }) {
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  if (!entries.length) {
    return <p className="text-[11.5px] text-fg-faint">이 날짜에 올라온 나눔이 아직 없어요</p>;
  }
  return (
    <div className="flex flex-col">
      {entries.map(e => {
        // 이름·사진의 원본은 워크스페이스 멤버 목록이다(profiles에서 온다).
        // 게스트 모드의 로컬 나눔은 언제나 내 글이라 프로필이 붙지 않는다.
        const m = byId.get(e.profile_id);
        const name = m?.name || e.name || myName;
        const url = m?.avatarUrl || e.avatarUrl || '';
        return (
          <div key={e.id} className="dc-row flex items-start gap-2.5 py-2.5">
            <Avatar name={name} url={url || undefined} className="flex w-7 h-7 text-[11px] shrink-0 mt-px" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[11.5px] font-bold text-fg truncate min-w-0">{name}</p>
                {/* 내 글에만 붙고 **언제나 보인다** — hover로만 뜨면 터치 기기에서는
                    없는 기능이 된다(§8) */}
                {e.mine && (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <button onClick={onEdit} aria-label="내 나눔 고치기"
                      className="w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                      <Pencil size={12} />
                    </button>
                    <ConfirmPopover
                      message="이 날 묵상을 지울까요? 나눔에서도 내려가고 내 기록에서도 빠져요."
                      onConfirm={onDelete}
                    >
                      <button aria-label="내 나눔 지우기"
                        className="w-6 h-6 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </ConfirmPopover>
                  </span>
                )}
              </div>
              <div className="text-[13px] leading-relaxed text-fg-secondary break-words mt-0.5">
                <RichText content={e.body} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 내 기록 (잔디 — 개인 전용) ──────────────────────────────────────────────
const WEEK_HEAD = ['일', '월', '화', '수', '목', '금', '토'];

export function Grass({ month, today, dates, weekStart, weekEnd, onPick }) {
  const set = useMemo(() => new Set(dates), [dates]);
  const inMonth = month.days.filter(d => set.has(d)).length;
  const inWeek = dates.filter(d => d >= weekStart && d <= weekEnd).length;
  return (
    <div>
      <SectionHead right={<span className="text-[11px] text-fg-faint tabular-nums shrink-0">{month.month}월</span>}>
        내 기록
      </SectionHead>
      <Card className="p-3.5">
        <div className="grid grid-cols-7 gap-1">
          {WEEK_HEAD.map(w => (
            <span key={w} className="text-[9.5px] font-semibold text-fg-faint text-center pb-0.5">{w}</span>
          ))}
          {Array.from({ length: month.lead }, (_, i) => <span key={`b${i}`} />)}
          {month.days.map(d => {
            const has = set.has(d);
            return (
              <button
                key={d} onClick={() => onPick(d)} title={shortDayLabel(d)}
                className="aspect-square rounded-[4px] flex items-center justify-center text-[10px] font-semibold tabular-nums transition active:scale-95"
                style={{
                  background: has ? 'var(--app-tag-green)' : 'var(--app-surface-hover)',
                  color: has ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)',
                  opacity: d > today ? 0.45 : 1,
                  boxShadow: d === today ? 'inset 0 0 0 1.5px var(--app-accent)' : undefined,
                }}
              >{+d.slice(8)}</button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-fg-muted tabular-nums mt-3">
          이번 주 {inWeek}번, 이번 달 {inMonth}번 기록했어요
        </p>
      </Card>
    </div>
  );
}
