import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Lock, Pencil, Trash2, Share2, Loader2 } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectMembers, selectCurrentUser } from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { myUidSync } from '../services/supabaseClient.js';
import { Avatar } from '../components/Avatar.jsx';
import { RichText } from '../components/RichText.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { showToast } from '../components/Toast.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { failText } from '../services/errorText.js';
import { useCached, dropCache } from '../services/cache.js';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { useLiveRefresh } from '../services/liveV2.js';
import { ShareChip, ShareToggle } from '../components/ShareToggle.jsx';
import { SectionHead, Card } from './dashboardParts.jsx';
import { loadPassage } from '../services/bible.js';
import { qtNoteTemplate, isTemplateOnly, bodyOrTemplate, splitNoteSections,
  ensureNoteSections, QT_SECTIONS } from '../services/noteTemplate.js';
import { NoteSheet, NotePaper, PAPER, paperDate } from '../components/paper.jsx';
import { useSheetShare } from '../hooks/useSheetShare.jsx';
import { BibleTab, PassageText, PassageSkeleton, EmptyBookMark, Swap, useBibleState, useVersePaint, marksFor } from '../components/wordBible.jsx';
import {
  kstToday, shiftDay, dayLabel, shortDayLabel, monthDays, shiftMonth, weekRange, shouldAdoptBody,
  fetchSchedule, fetchMyEntry, saveMyEntry, deleteMyEntry, deleteEntryAsMaster,
  fetchSharedEntries, fetchMyEntryDates,
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
// 묵상은 기본 비공개이고 '더다붓에 공유하기'를 켠 글만 그날 나눔에 오른다(결정 11).
// 경계는 화면이 아니라 RLS가 지킨다(0036). **'나누기'가 아니라 '더다붓에 공유하기'다**
// (사용자 피드백 2026-09-02 — 어디로 나가는지가 이름에 있어야 한다). 토글·저장 토스트가
// 같은 말을 쓴다. 피드 제목 '오늘의 나눔'은 그대로다 — 그건 올라온 글들의 이름이다.
//
// **공유 토글은 저장 버튼을 켜지 않는다**(사용자 피드백 2026-09-02 4차 — "누르자마자
// 저장이 활성화된다"). 공유는 고치는 일이 아니라 이미 저장된 글을 어디까지 보이게 할지
// 정하는 일이라, 토글은 편집 상태(dirty)를 건드리지 않고 shared 칸만 그 자리에서 저장하고
// 칩으로 알린다. 그래서 **아직 저장 전이면 토글은 꺼져 있다** — 없는 글을 공유할 수는 없다.
// **공유를 조작하는 자리는 한 곳이다 — '내 묵상' 칸의 토글**(사용자 결정 2026-09-05 —
// "토글이 위랑 아래랑 두 번 나온다"). 편집기 바로 아래에 나눔 피드가 붙어 있어서 같은
// 글의 공개 범위를 정하는 칸이 한 화면에 두 벌 서 있었다. 글을 쓰고 저장하는 자리에만
// 남기고, 피드의 내 줄은 **상태만 말한다** — 비공개면 잠금 표시가 붙고, 그 표시가 없이
// 줄이 서 있다는 것이 곧 공유 중이라는 뜻이다(피드는 공유된 글만 읽는다). 조작하려면
// 그 줄의 연필이 편집기로 데려간다.
// 나눔 줄의 눈 가리기(공유 해제)도 같은 결정으로 없앴다 — "토글로 조절할 수 있는 거면
// 눈 표시는 없애도 될 듯". 회차 5의 '나눔 지우기 = 공유 해제'를 이 결정이 대체한다.
// 지우기는 '내 묵상' 칸의 휴지통 하나뿐이다(그 날 묵상 자체가 없어진다).
// **예외로 마스터는 남의 줄도 지운다**(사용자 결정 2026-09-05 · 0045
// qt_entries_delete_master) — 공유 해제가 아니라 그 사람의 그날 묵상 행이 없어진다.
//
// 그래서 **피드의 내 줄은 공유 목록이 아니라 지금 내 묵상 상태에서 나온다**(mergeFeed).
// 토글은 내 상태를 먼저 바꾸고 목록은 그 다음에 다시 읽어 오므로, 둘을 그냥 이어 붙이면
// 넘기는 순간 같은 글이 두 줄로 섰다(사용자 관찰 2026-09-05).
//
// **날짜를 바꿔도 자리는 그대로 있어야 한다**(사용자 피드백 2026-09-01 — "화면 전체가
// 새로 그려지며 움직인다"). 본문·묵상·나눔 세 칸 모두 기다리는 동안 같은 자리에
// 스켈레톤을 세우고 최소 높이를 잡아 둔다. 바뀌는 것은 안의 내용뿐이다.
//
// 그 자리는 **넘기기 직전의 높이**로 잡는다(사용자 피드백 2026-09-02 4차 — "말씀이
// 렌더되기 전에 묵상이 잠깐 위로 올라왔다가 내려간다"). 최소 높이만 320px로 두면 열네 절짜리
// 본문(700px 남짓)에서 넘기는 순간 자리가 320으로 줄어 아래 것들이 통째로 올라왔다가
// 새 본문이 도착할 때 다시 내려갔다. 그래서 넘길 때 지금 높이를 재어 두고, 기다리는 동안
// 그 높이만큼 스켈레톤을 세운다(`hold`). 묵상 에디터는 **언마운트하지 않는다** — 날짜마다
// 새로 마운트하면 TipTap이 붙는 사이 197px 껍데기로 줄어들어 같은 출렁임이 한 번 더 났다.
// MarkdownEditor는 밖에서 value가 바뀌면 문서를 갈아 끼우므로(그 파일의 '외부에서 value가
// 바뀐 경우') 같은 에디터에 새 날짜의 글을 넣기만 하면 된다.
//
// **저장된 묵상이 있으면 읽기 모드다**(2026-09-07). 예전에는 편집기가 늘 열려 있어서
// 이미 쓴 글인지 지금 고치는 중인지 화면이 말해 주지 않았다. 이제 저장된 글은 **종이**로
// 그리고(components/paper.jsx · 공유되는 그림과 같은 것이다) '수정'을 눌러야 편집기가
// 선다 — 그때만 저장·취소가 붙는다.
// 아직 아무것도 저장하지 않은 날은 처음부터 편집기다(쓸 것이 없는데 '수정'을 누를 수는 없다).
// **그래도 편집기는 언마운트하지 않는다** — 읽기 모드에서는 `hidden`으로 두기만 한다.
// 날짜를 넘길 때 아래가 튀지 않게 하려던 위 규칙을 이 모드 전환이 깨면 안 된다.
//
// **편집도 그 종이 안에서 한다**(사용자 요청 2026-09-10 · HANDOFF §6-32-p) — 부품이
// 읽기와 같은 한 벌이라(`NotePaper`) 두 모드의 띠·구절·컷이 어긋날 수 없다.
//
// **본문표 붙여넣기 도구는 없다** — 읽기표 730일치가 0038로 qt_schedule에 들어 있다
// (services/word.js 머리말). 되살리지 말 것.
// ============================================================================

const SEGMENTS = [['qt', 'QT'], ['read', '성경 읽기']];

// 업무 본문과 **같은 에디터**를 쓴다(사용자 피드백 2026-09-01). 저장 형식도 같은
// 마크다운이고 나눔 피드는 RichText로 그린다. TipTap은 무거우므로 modals가 하듯
// lazy로 떼어 둔다(§1.3) — 성경 읽기만 보다 나가는 사람은 받지 않는다.
const MarkdownEditor = lazy(() => import('../components/MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
// 편집 칸의 감싸개 — **종이가 그 안에 든다**(2026-09-10 · MarkdownEditor의 `frame`).
// 여백·배경·글자색은 종이(components/paper.jsx)가 가지고, 여기는 서식 바 아래로 이어지는
// 테두리와 둥근 모서리만 맡는다(예배 노트와 **같은 한 줄**이다 — worshipDetail EDITOR_BOX).
// 빈 자리를 눌러 커서를 잡는 일은 MarkdownEditor가 한다(그 파일의 focusEnd —
// `.tiptap` 밖을 누르면 문서 끝으로 보낸다) — 종이 여백을 눌러도 그대로 된다.
const EDITOR_BOX = 'overflow-hidden border border-line rounded-md rounded-t-none focus-within:border-accent focus-within:shadow-soft transition-all';
// 서식 바(37px) + 본문 칸. 에디터가 붙기 전에도 같은 높이를 잡아 두어야 도착하는 순간
// 아래 것들이 밀리지 않는다.
const EDITOR_SLOT = 'min-h-[197px] md:min-h-[261px]';
const EditorSkeleton = () => (
  <div className={`dc-skeleton border border-line rounded-md ${EDITOR_SLOT}`} />
);
// 종이 폭 상한 — 인쇄물이라 여기만 max-w를 쓴다(§6-9-k의 예외). 예배 노트와 같은 값이고
// **읽기와 편집이 같이 쓴다**(2026-09-10 — 두 모드에서 종이의 폭·왼쪽 자리가 같아야
// 수정·취소를 눌렀을 때 종이가 옆으로 흔들리지 않는다. tests/word가 단정한다).
// 2026-09-07~09-09에는 읽기 상자를 **편집기의 실제 높이**(198/262px)로 맞춰 두었는데,
// 편집 화면도 종이가 되면서 두 높이가 내용에 따라 달라졌다 — 남은 차이는 §1.3에 있다.
const QT_SHEET_BOX = 'qt-note-sheet w-full max-w-[560px] mx-auto';
const QT_CUT = { src: '/chars/book.webp', w: 196, h: 157 };

// 본문이 차지할 자리. **빈 상태도 이 자리를 그대로 받는다**(사용자 피드백 2026-09-02 3차)
// — 자리는 320px인데 빈 상태만 220px이라, 본문이 없는 날에는 마크가 위로 올라붙고 아래
// 100px이 통째로 비어 보였다. 두 값을 하나로 묶어 둔다(§8 '빈 상태는 남는 자리의 가운데').
const PASSAGE_MIN_H = 320;

// 주보의 본문 구절에서 넘어오는 자리를 위해 initialTab·initialRef를 받는다
// (App.jsx가 예배 화면의 onOpenBible → wordRef로 이어 준다. 말씀 화면을 떠나면 비운다).
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
            // aria-pressed는 성경 읽기의 [본문|북마크|형광펜] 세그먼트와 같은 한 벌이다 —
            // 색만으로 고른 것을 말하면 화면을 읽어 주는 기기에는 아무 표시도 안 남는다
            <button key={key} onClick={() => pick(key)} aria-pressed={tab === key}
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
  const { session, isMaster } = useAuth();
  const today = kstToday();

  const [date, setDate] = useState(today);
  const [dir, setDir] = useState(0);
  const [day, setDay] = useState({ loading: true, schedule: null, passage: null });
  // 저장된 묵상 — **어느 날짜의 것인지 같이 들고 있는다**(본문이 그러는 것과 같은 이유).
  // null이면 아직 한 번도 안 읽었다. { date, body, shared, exists }
  const [entry, setEntry] = useState(null);
  const [body, setBody] = useState('');            // 지금 에디터에 있는 글
  const [saving, setSaving] = useState(false);
  const [shareState, setShareState] = useState(''); // '' | 'saving' | 'saved' (공유 칩)
  const [feed, setFeed] = useState(null);          // null이면 아직 안 읽음
  // 저장된 글을 고치는 중인가. 저장된 것이 없는 날은 이 값과 상관없이 편집기가 선다.
  const [editing, setEditing] = useState(false);
  const [grassKey, setGrassKey] = useState(0);     // 올리면 잔디가 보고 있는 달을 다시 읽는다
  const editorRef = useRef(null);
  const slotRef = useRef(null);
  const [hold, setHold] = useState(0);             // 넘기기 직전 본문 자리의 높이(px)

  const go = (next) => {
    if (next === date) return;
    setHold(slotRef.current?.offsetHeight || 0);
    setDir(next > date ? 1 : -1);
    setDate(next);
  };

  // ── 그날의 QT 한 묶음 (일정 · 내 묵상 · 나눔) ──────────────────────────────
  // **캐시가 있으면 스켈레톤 없이 그 값으로 먼저 그린다**(사용자 요청 2026-09-03 —
  // "매번 스켈레톤이 아니라 캐시된 값이 먼저"). 한 번 본 날짜로 되돌아오면 기다림이
  // 아예 없다. 뒤에서 다시 읽어 갈아 끼우는 것은 useCached가 한다(services/cache.js).
  // 셋을 한 열쇠로 묶는 이유: 화면에서 늘 같이 쓰이고, 저장·삭제 뒤 비울 때도 같이 비운다.
  // 본문(절 텍스트)은 여기 넣지 않는다 — 그건 bible.js가 이미 책 단위로 캐시한다.
  const qtKey = `word:qt:${date}`;
  const { data: qt, loading: qtLoading, error: qtError, refresh: refreshQt } = useCached(
    qtKey,
    async () => {
      const [schedule, mine, shared] = await Promise.all([
        fetchSchedule(date), fetchMyEntry(date), fetchSharedEntries(date),
      ]);
      // 어느 날짜의 묶음인지 같이 들고 있는다 — 날짜가 먼저 바뀌고 값이 한 프레임 늦게
      // 오므로, 이걸 안 보면 **앞 날짜의 값을 새 날짜에 적어 버린다**(빈 묵상으로 덮였다)
      return { date, schedule: schedule ?? null, mine: mine ?? null, shared: shared || [] };
    },
    [date],
  );

  // 남이 그날 나눔을 올리거나 지우면 피드에 몇 초 안에 뜬다(0049 · services/liveV2.js).
  // 고치던 글은 안전하다 — 아래 동기화가 body를 **아직 손대지 않았을 때만** 갈아 끼운다
  // (word.js shouldAdoptBody).
  useLiveRefresh('word', refreshQt);

  // 일정이 정해지면 그 구절의 본문을 편다(책 파일은 bible.js 캐시라 두 번째부터 즉시다)
  useEffect(() => {
    let alive = true;
    if (qt && qt.date !== date) return undefined;   // 아직 앞 날짜의 값이다 — 그대로 둔다
    const ref = qt?.schedule?.passage_ref || '';
    if (qtLoading) { setDay({ loading: true, schedule: null, passage: null }); return undefined; }
    // **못 읽은 것과 없는 것은 다르다**(사용자 피드백 2026-09-03 — 예외 문구 검토).
    // 예전에는 읽기가 실패해도 '아직 올라오지 않았어요'가 떠서 화면이 거짓말을 했다(§6-29-b).
    // 다만 **캐시에 그날 구절이 이미 있으면 그것을 그린다**(2026-09-06) — 재조회 한 번이
    // 실패했다고 이미 읽고 있던 본문을 걷어 내면, 화면이 또 다른 거짓말을 한다.
    if (qtError && !ref) { setDay({ loading: false, schedule: null, passage: null, failed: qtError }); return undefined; }
    if (!ref) { setDay({ loading: false, schedule: qt?.schedule || null, passage: null }); return undefined; }
    setDay(d => (d.schedule?.passage_ref === ref ? d : { loading: true, schedule: null, passage: null }));
    (async () => {
      let passage = null;
      try { passage = await loadPassage(ref); } catch { /* 못 읽으면 구절만 보여준다 */ }
      if (alive) setDay({ loading: false, schedule: qt.schedule, passage });
    })();
    return () => { alive = false; };
  }, [qt, qtLoading, qtError, date]);

  // 내 묵상 · 그날 나눔. **entry·body를 비우지 않는다** — 비우면 에디터가 언마운트되어
  // 자리가 줄고, 도착할 때 아래 것들이 다시 밀린다(머리말).
  //
  // 뒤에서 새로 읽어 온 값을 **에디터에 넣어도 되는지**는 word.js의 shouldAdoptBody가
  // 정한다(§6-9-n의 짝). 예전에는 '날짜가 바뀔 때 한 번'이라, 캐시가 낡아 있으면 첫
  // 프레임의 옛 글이 그대로 남았고 그 상태로 저장하면 **서버의 새 글을 덮었다**
  // (2026-09-06 지적). 지금은 아직 손대지 않은 글만 갈아 끼운다.
  const syncedFor = useRef('');
  const syncedBody = useRef('');   // 마지막으로 넣어 준 글 — '아직 안 고쳤나'의 기준
  const bodyRef = useRef('');
  bodyRef.current = body;          // 이펙트가 지금 에디터의 글을 볼 수 있게(렌더마다)
  // **아직 쓴 것이 없는 날은 템플릿으로 시작한다**(사용자 요청 2026-09-08 — 옛 순 노트
  // 템플릿). '본문' 아래에는 그 날 읽기표의 구절이 미리 들어간다. QT에는 '말씀 요약'이
  // 없다(services/noteTemplate.js 머리말).
  const passageRef = (qt && qt.date === date ? qt.schedule?.passage_ref : '') || '';
  const tpl = useMemo(() => qtNoteTemplate({ passageRef }), [passageRef]);
  // 넣어 주는 글과 syncedBody는 **언제나 같은 값**이어야 한다 — 다르면
  // shouldAdoptBody가 '사람이 고쳤다'로 읽어 뒤에 온 값을 영영 안 넣는다.
  const putBody = (b) => { const v = bodyOrTemplate(b, tpl); setBody(v); syncedBody.current = v; };
  useEffect(() => {
    if (!qt || qt.date !== date) return;
    const next = { date, body: qt.mine?.body || '', shared: !!qt.mine?.shared, exists: !!qt.mine };
    setEntry(next);
    setFeed(qt.shared || []);
    const dateChanged = syncedFor.current !== date;
    if (shouldAdoptBody({ dateChanged, body: bodyRef.current, lastSynced: syncedBody.current, next: next.body })) {
      putBody(next.body);
    }
    // 날짜가 바뀌면 읽기 모드로 돌아간다 — 저장된 글이 있는 날은 먼저 그 글을 보여준다
    if (dateChanged) { setShareState(''); setEditing(false); syncedFor.current = date; }
  }, [qt, date]);

  useEffect(() => {
    if (!qtError) return;
    // 조용히 빈 칸을 세우면 **이미 써 둔 묵상이 없는 것처럼 보인다**(그 상태로 저장하면
    // 덮어쓴다). 무엇을 못 읽었는지 이유까지 말한다(사용자 피드백 2026-09-03).
    console.error('[word] 묵상·나눔 읽기 실패:', qtError);
    // **캐시가 있으면 화면은 그대로 두고 말만 한다**(2026-09-06). 예전에는 재조회 한 번이
    // 실패해도 빈 칸을 세워서, 캐시로 잘 그려져 있던 묵상이 '없음'으로 바뀌었다 — 바로 그
    // 위 주석이 막으려던 일을 이 이펙트가 하고 있었다. 한 번도 못 읽었을 때만 빈 자리다.
    if (!qt || qt.date !== date) {
      setEntry({ date, body: '', shared: false, exists: false }); setFeed([]);
      if (syncedFor.current !== date) { putBody(''); syncedFor.current = date; }
    }
    showToast(failText('이 날 묵상과 나눔을 불러오지 못했어요', qtError));
  }, [qtError, qt, date]);

  // 저장한 뒤 잠깐만 남는 칩(공유 토글) — 상태 표시라 계속 서 있을 이유가 없다
  useEffect(() => {
    if (shareState !== 'saved') return undefined;
    const t = setTimeout(() => setShareState(''), 2600);
    return () => clearTimeout(t);
  }, [shareState]);

  // 잔디는 자기가 보고 있는 달을 스스로 읽는다(Grass) — 여기서는 저장·삭제 뒤에
  // "다시 읽어라"만 알린다. 어느 달을 보고 있는지는 그쪽이 안다.
  const reloadGrass = useCallback(() => setGrassKey(k => k + 1), []);

  // 지금 화면의 날짜와 읽어 온 날짜가 같을 때에만 저장·공유를 연다 — 넘긴 직후
  // 한 순간은 앞 날짜의 글이 에디터에 남아 있으므로, 그때 저장하면 엉뚱한 날에 쓴다
  const ready = !!entry && entry.date === date;
  // 되돌아갈 자리 — 저장된 글이 있으면 그것, 없으면 손대지 않은 템플릿이다
  const base = ready ? bodyOrTemplate(entry.body, tpl) : '';
  const dirty = ready && body !== base;
  // **손대지 않은 템플릿은 빈 묵상이다** — 제목 줄이 있다는 이유로 저장이 열리면
  // 아무도 쓰지 않은 제목 네 줄이 그대로 저장되고 잔디에까지 찍힌다
  const hasText = !isTemplateOnly(body, passageRef);
  // 공유는 저장된 글에만 걸 수 있다(머리말) — 빈 글은 나눔에 올라가지도 않는다
  const canShare = ready && entry.exists && !!entry.body.trim();
  // 저장된 글이 있고 고치는 중이 아니면 읽기 모드다(머리말)
  const reading = canShare && !editing;

  // ── 종이(읽기 모드) — 예배 노트와 같은 부품, 캐릭터만 book ────────────────
  const qtSections = useMemo(() => splitNoteSections(entry?.body || ''), [entry?.body]);
  const qtSheetRef = useRef(null);
  // **누르기 전에 그림까지 구워 둔다**(hooks/useSheetShare.js) — 미리 받기만으로는
  // 폰에서 공유 시트가 열리지 않았다(사용자 보고 2026-09-09).
  const qtImg = useSheetShare({
    refs: [qtSheetRef], background: PAPER.surface,
    key: reading ? `${date}:${entry?.body || ''}` : '',
    fileName: `묵상 노트 ${paperDate(date)}`.trim(),
    what: '이미지를 저장하지 못했어요',
  });

  // 피드에 설 내 줄 — **지금 저장된 내 묵상**에서 만든다(mergeFeed 머리말).
  // profile_id를 실어 보내야 비공개로 넘어가 목록에서 빠진 뒤에도 같은 이름·사진으로
  // 서 있는다(피드는 profile_id로 멤버 프로필을 찾는다). 게스트에는 세션이 없다.
  const myProfileId = myUidSync() || session?.user?.id || '';   // 합친 계정이면 남긴 계정(0063)
  const myRow = useMemo(() => {
    if (!ready) return undefined;                       // 아직 이 날의 내 묵상을 모른다
    if (!entry.exists || !entry.body.trim()) return null;
    return {
      id: MY_ROW, profile_id: myProfileId,
      body: entry.body, mine: true, private: !entry.shared,
    };
  }, [ready, entry, myProfileId]);
  const feedRows = useMemo(() => mergeFeed(feed, myRow), [feed, myRow]);

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      // **도막 제목은 지워지지 않는다**(사용자 결정 2026-09-09 — "중제목들 안 지워지게").
      // 편집기에서 지웠어도 저장되는 글에는 네 도막이 그 순서로 서 있다. 사람이 쓴 글과
      // 새로 만든 도막은 그대로 남는다(services/noteTemplate.js ensureNoteSections).
      const kept = ensureNoteSections(body, QT_SECTIONS);
      await saveMyEntry(date, { body: kept, shared: entry.shared });
      setEntry({ date, body: kept, shared: entry.shared, exists: true });
      setEditing(false);               // 저장했으니 다시 읽기 모드로(머리말)
      syncedBody.current = kept;       // 방금 이 글로 맞췄다(다음 도착값 판정의 기준)
      setFeed(await fetchSharedEntries(date));
      dropCache(qtKey); refreshQt();   // 옛 값이 먼저 그려지지 않게 그 날짜만 비운다
      dropCache('home');               // 홈의 '오늘의 QT' 카드가 '오늘 썼나'를 센다(homeView)
      reloadGrass();
      showToast(entry.shared ? '묵상을 저장하고 더다붓에 공유했어요' : '묵상을 저장했어요');
    } catch (e) {
      console.error('[word] 묵상 저장 실패:', e);
      showToast(failText('묵상을 저장하지 못했어요', e));
    } finally {
      setSaving(false);
    }
  };

  // 공유 칸만 그 자리에서 저장한다. **저장된 본문을 그대로 다시 쓴다** — 고치던 글을
  // 같이 올리면 저장 버튼을 누르지 않았는데 글이 나가 버린다(그래서 dirty도 그대로 남는다).
  // 부르는 자리는 '내 묵상' 칸의 토글 하나다(머리말) — 칩도 그 옆에만 선다.
  const setShared = async (v) => {
    if (!canShare || v === entry.shared || shareState === 'saving') return;
    setShareState('saving');
    try {
      await saveMyEntry(date, { body: entry.body, shared: v });
      setEntry(e => ({ ...e, shared: v }));
      setFeed(await fetchSharedEntries(date));
      dropCache(qtKey); refreshQt();
      dropCache('home');   // 모임·홈이 공유된 묵상을 같이 센다
      setShareState('saved');
    } catch (e) {
      console.error('[word] 공유 상태 저장 실패:', e);
      setShareState('');
      showToast(failText(v ? '묵상을 더다붓에 공유하지 못했어요' : '묵상을 나만 보기로 바꾸지 못했어요', e));
    }
  };

  // 진짜 삭제는 '내 묵상' 칸에서만 — 그 날 묵상 자체가 없어지므로 잔디에서도 빠진다
  const removeMine = async () => {
    try {
      await deleteMyEntry(date);
      setEntry({ date, body: '', shared: false, exists: false });
      putBody(''); setEditing(false);
      setFeed(await fetchSharedEntries(date));
      dropCache(qtKey); refreshQt();
      dropCache('home');
      reloadGrass();
      showToast('이 날 묵상을 지웠어요');
    } catch (e) {
      console.error('[word] 묵상 삭제 실패:', e);
      showToast(failText('이 날 묵상을 지우지 못했어요', e));
    }
  };

  // 남의 나눔 지우기 — **마스터만**(사용자 결정 2026-09-05 · 0045
  // qt_entries_delete_master). 공유를 내리는 것이 아니라 그 사람의 그날 묵상이 없어진다.
  const removeShared = async (row) => {
    try {
      await deleteEntryAsMaster(row.id);
      setFeed(await fetchSharedEntries(date));
      dropCache(qtKey); refreshQt();
      showToast('이 나눔을 지웠어요');
    } catch (e) {
      console.error('[word] 남의 나눔 삭제 실패:', e);
      showToast(failText('이 나눔을 지우지 못했어요', e));
    }
  };

  // 편집기를 연다. 읽기 모드에서는 상자가 `hidden`이라 그 프레임에는 focus가 먹지 않는다 —
  // 표식을 남겨 두고 아래 이펙트가 **모드가 바뀐 뒤** 커서를 준다.
  const wantFocus = useRef(false);
  const openEditor = useCallback(() => {
    const box = editorRef.current;
    if (!reading) { box?.querySelector('.tiptap')?.focus(); return; }
    wantFocus.current = true;
    setEditing(true);
  }, [reading]);
  useEffect(() => {
    if (!editing || !wantFocus.current) return;
    wantFocus.current = false;
    editorRef.current?.querySelector('.tiptap')?.focus();
  }, [editing]);

  // 고치기를 그만둔다 — 저장된 글로 되돌리고 읽기 모드로. 저장된 것이 없는 날에는
  // 되돌아갈 자리가 없으므로 이 버튼 자체가 없다.
  const cancelEdit = () => {
    if (!ready) return;
    putBody(entry.body);
    setEditing(false);
  };

  // 고치기는 위의 '내 묵상' 칸이 한다 — 같은 글을 두 자리에서 고칠 수 있으면
  // 어느 쪽이 진짜인지 알 수 없다. 그 칸으로 데려가고 커서를 준다.
  const editMine = () => {
    const box = editorRef.current;
    if (!box) return;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    openEditor();
  };

  // 기다리는 동안 잡아 둘 자리 — 넘기기 직전 높이가 있으면 그만큼(머리말)
  const slotH = day.loading ? Math.max(PASSAGE_MIN_H, hold) : PASSAGE_MIN_H;

  return (
    // **어느 폭에서도 빈 띠가 없다**(사용자 피드백 2026-09-03 — 1000px 남짓에서 본문이
    // 46rem에서 끊기고 오른쪽 230px이 빈 채로 '내 기록'은 그 아래에 있었다). 읽기 폭
    // 상한(46rem)을 없애고 첫 칸이 컨테이너를 채운다 — 옆 칸 300px은 lg에서만 붙는다
    // (그게 `.side-grid`다. 대시보드·내 업무와 같은 정의를 쓰면 좌우 경계도 저절로 맞는다).
    <div className="grid gap-x-7 gap-y-6 items-start side-grid">
      {/* data-col: 검사(tests/word.mjs)가 이 칸이 자기 트랙을 다 쓰는지 잰다 */}
      <div data-col="qt" className="min-w-0">
        {/* 날짜 이동 — 날짜 글자가 곧 데이트피커 트리거다(사용자 피드백 2026-09-02) */}
        <div className="flex items-center gap-1 pb-3">
          <button onClick={() => go(shiftDay(date, -1))} aria-label="어제"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95">
            <ChevronLeft size={17} />
          </button>
          <DatePicker
            value={date} onChange={d => d && go(d)} allowClear={false} ariaLabel="QT 날짜 고르기"
            triggerClassName="inline-flex items-center gap-1 h-9 px-1.5 rounded-md hover:bg-surface-hover outline-none transition-colors"
          >
            <span className="text-[13.5px] font-bold text-fg tabular-nums">{dayLabel(date)}</span>
            <ChevronDown size={13} className="shrink-0 text-fg-faint" />
          </DatePicker>
          <button onClick={() => go(shiftDay(date, 1))} aria-label="내일"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95">
            <ChevronRight size={17} />
          </button>
          {date !== today && (
            <button onClick={() => go(today)}
              className="ml-1 shrink-0 px-2.5 h-8 rounded-md text-[11.5px] font-semibold text-accent-text bg-accent-weak transition active:scale-95">
              오늘
            </button>
          )}
        </div>

        {/* 본문 — 기다리는 동안에도 같은 자리에 같은 크기로 서 있는다 */}
        <div ref={slotRef} style={{ minHeight: slotH }}>
          <Swap k={date} dir={dir}><QtPassage day={day} date={date} minH={slotH} /></Swap>
        </div>

        {/* 내 묵상 — 저장된 글이 있으면 읽기 모드, '수정'을 눌러야 편집기다(머리말) */}
        <div className="mt-6" ref={editorRef} data-note={reading ? 'read' : 'edit'}>
          <SectionHead>내 묵상</SectionHead>
          <div className={EDITOR_SLOT}>
            {/* **저장하면 바로 종이다**(사용자 요청 2026-09-09 · components/paper.jsx).
                예배 노트와 같은 종이이고 캐릭터 컷만 다르다(말씀은 book) — 공유되는
                그림과 화면이 같아야 "이 모양으로 나간다"를 눌러 보기 전에 안다. */}
            {/* 머리의 구절은 **`passageRef`** 다(`day.passage_ref`가 아니다 — 그 객체의
                구절은 `day.schedule.passage_ref`에 있어서 늘 빈 칸이 나갔다. 2026-09-10에
                편집 종이가 같은 값을 쓰면서 드러났다) */}
            <div data-note-read="1" className={reading ? QT_SHEET_BOX : 'hidden'}>
              <div className="rounded-[12px] overflow-hidden border border-line">
                <NoteSheet sheetRef={qtSheetRef} date={paperDate(date)} kind="묵상 노트"
                  passageRef={passageRef} sections={qtSections} cut={QT_CUT} />
              </div>
            </div>
            {/* **언마운트하지 않는다**(머리말) — 읽기 모드에서는 감추기만 한다.
                **편집도 같은 종이 안에서 한다**(사용자 요청 2026-09-10) — 부품은 읽기와
                같은 것이고(paper.jsx NotePaper), 라벨·칸을 만드는 것은 index.css
                `.note-paper`의 격자 한 겹이다(§6-32-p). 예배 노트와 같은 짜임이다. */}
            <div className={`qt-note-editor note-paper ${QT_SHEET_BOX} ${reading ? 'hidden' : ''}`}>
              {entry ? (
                <Suspense fallback={<EditorSkeleton />}>
                  <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    placeholder="오늘 본문에서 마음에 남은 것"
                    /* 도막 제목은 **수정 창에서부터** 지워지지 않는다(사용자 결정 2026-09-10) */
                    lockedHeadings={QT_SECTIONS}
                    /* 제목·구분선·링크가 빠진 노트 서식 바(사용자 결정 2026-09-10·09-11) */
                    tools="note"
                    className={EDITOR_BOX}
                    /* 읽기 종이와 **같은 값**을 머리에 넘긴다(그날 본문 구절) */
                    frame={(content) => (
                      <NotePaper date={paperDate(date)} kind="묵상 노트"
                        passageRef={passageRef} cut={QT_CUT}>
                        <div className="paper-rows mt-5">{content}</div>
                      </NotePaper>
                    )}
                  />
                </Suspense>
              ) : <EditorSkeleton />}
            </div>
          </div>
          {/* 도구 줄. **flex-wrap에 맡기지 않는다** — 375px에서 넷 중 토글만 다음 줄로
              떨어져 오른쪽에 혼자 섰다. 640 미만에서는 [확정·나가기]와 [토글·지우기]가
              각각 한 줄을 통째로 쓰고, 그 위에서는 예전처럼 한 줄에 양 끝으로 선다.
              자리는 §8 그대로 — 확정(저장·수정) 왼쪽, 나가기(취소) 그 오른쪽. */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] items-center gap-2 mt-2.5">
            <div data-note-tools="left" className="flex items-center gap-2 min-w-0">
              {reading ? (
                <>
                  <button onClick={openEditor}
                    className="bg-accent-weak hover:brightness-95 text-accent-text px-4 py-1.5 rounded-md text-[11.5px] font-semibold transition active:scale-95">
                    수정
                  </button>
                  <button onClick={qtImg.share} disabled={qtImg.busy} data-qt-image="1"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[11.5px] font-medium text-fg-muted bg-surface-hover hover:bg-line transition active:scale-95 disabled:opacity-50">
                    {/* 아이콘은 `Share2`다(사용자 결정 2026-09-10) — 하는 일이 내려받기가
                        아니라 **공유**이고, 막힌 판에서만 저장·새 탭으로 떨어진다(§6-32-k) */}
                    {qtImg.busy ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                    <span>이미지로 공유</span>
                  </button>
                </>
              ) : (
                <button onClick={save} disabled={!dirty || !hasText || saving}
                  className="bg-accent hover:bg-accent-strong disabled:bg-line text-white px-4 py-1.5 rounded-md text-[11.5px] font-semibold transition active:scale-95">
                  저장
                </button>
              )}
              <ShareChip state={shareState} label={entry?.shared ? '더다붓에 공유할게요' : '나만 볼게요'} />
              {/* 나가기는 줄의 오른쪽 끝 — 예배 노트의 도구 줄과 같은 자리(§8 도구 줄 규칙) */}
              {!reading && canShare && (
                <button onClick={cancelEdit}
                  className="ml-auto px-3.5 py-1.5 rounded-md text-[11.5px] font-medium text-fg-muted bg-surface-hover hover:bg-line transition active:scale-95">
                  취소
                </button>
              )}
            </div>
            {/* 공유·저장이 막힌 브라우저에서 마지막 갈래(hooks/useSheetShare.jsx) */}
            {qtImg.overlay}
            <div data-note-tools="right" className="flex items-center gap-1 justify-between sm:justify-end">
              {/* 좁은 폭에서는 제 줄을 다 쓴다 — ShareToggle이 `className`으로 폭을 받는다
                  (예배 노트도 같은 부품·같은 배치다) */}
              <ShareToggle className="grow sm:grow-0" value={!!entry?.shared} disabled={!canShare} onChange={setShared} />
              {canShare && (
                <ConfirmPopover
                  message={"이 날의 묵상을 지울까요?\n내 기록에서도 제거돼요."}
                  onConfirm={removeMine}
                >
                  <button aria-label="내 묵상 지우기"
                    className="w-9 h-9 shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                    <Trash2 size={14} />
                  </button>
                </ConfirmPopover>
              )}
            </div>
          </div>
        </div>

        {/* 그날의 나눔 */}
        <div className="mt-6">
          <SectionHead>{date === today ? '오늘의 나눔' : '이 날의 나눔'}</SectionHead>
          <div className="min-h-[72px]">
            {/* 공유하지 않은 내 묵상도 **나에게는** 이 자리에 선다(사용자 결정
                2026-09-03). 피드 자체는 공유된 글만 읽으므로(RLS와 같은 경계),
                내 것 한 줄은 화면에서 얹는다 — 남에게는 여전히 안 보인다(mergeFeed). */}
            {feed === null
              ? <FeedSkeleton />
              : <ShareFeed rows={feedRows} members={members} myName={currentUser?.name || ''}
                  onEdit={editMine} isMaster={isMaster} onDeleteOther={removeShared} />}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <Grass today={today} onPick={go} reloadKey={grassKey} />
      </div>
    </div>
  );
}

// ── 그날 본문 ───────────────────────────────────────────────────────────────
// minH: 기다리는 동안 채워야 할 자리의 높이. 카드가 자리보다 짧으면 그 차이만큼
// 아래 칸들이 올라왔다 내려간다(QtTab 머리말) — 줄 수도 자리에 맞춰 늘린다.
export function QtPassage({ day, date, minH = PASSAGE_MIN_H }) {
  // QT 본문 형광펜(사용자 결정 2026-09-05). **그날의 것**이다 — "따로 모아두지 말고, 보려면
  // 해당 날짜를 보면 된다". bible_state.highlights에 같이 두되 ref 앞에 `qt:<날짜>`를 붙여
  // 리더의 형광펜·모아보기와 갈라 둔다(parseVerseKey가 못 읽는 모양이라 모아보기에 오르지
  // 않고, 리더는 '책 ' 접두로만 걸러 본다 — marksFor).
  const [hl, updateHl] = useBibleState();
  const prefix = `qt:${date} ${day.passage?.ref?.bookId || ''} `;
  const paint = useVersePaint({
    state: hl, update: updateHl, name: day.passage?.book?.name,
    refOf: (chapter, verse) => `${prefix}${chapter}:${verse}`,
  });
  const marks = useMemo(() => marksFor(hl.highlights, prefix), [hl.highlights, prefix]);
  if (day.loading) {
    const lines = Math.max(8, Math.round((minH - 44) / 34));
    return (
      <Card className="p-4 md:p-5" style={{ minHeight: minH }}>
        <PassageSkeleton lines={lines} />
      </Card>
    );
  }
  if (!day.schedule) {
    // 못 읽은 것과 아직 없는 것을 갈라 말한다(사용자 피드백 2026-09-03).
    // **표식은 SVG 마크다**(사용자 결정 2026-09-03 — "홈 말고는 캐릭터를 넣지 말라").
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: PASSAGE_MIN_H }}>
        <EmptyBookMark />
        <p className="text-[13.5px] font-semibold text-fg mt-3 whitespace-pre-line">
          {day.failed
            ? failText('이 날짜의 본문을 불러오지 못했어요', day.failed)
            : '이 날짜의 본문이 아직 올라오지 않았어요'}
        </p>
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
          ? <PassageText
              verses={passage.verses} showChapter={passage.verses[0].chapter !== passage.verses.at(-1).chapter}
              marks={marks} onPickVerse={paint.onPickVerse} picked={paint.picked} toolAt={paint.toolAt} tool={paint.tool}
            />
          : <p className="text-[12.5px] text-fg-faint">읽기표에 적힌 구절을 성경에서 찾지 못했어요</p>}
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

// 내 줄의 열쇠는 공개 범위와 상관없이 하나다 — 토글할 때마다 key가 바뀌면 같은 줄이
// 언마운트됐다 다시 붙어서, 고쳐 놓은 두 줄 문제 대신 한 줄이 깜빡인다.
const MY_ROW = 'mine';

// 나눔 피드에 설 줄들 — 그 날 **공유 목록**(fetchSharedEntries)과 **지금 내 묵상 상태**를
// 합친다. 이 둘은 서로 다른 시각의 값이다: 토글은 내 상태를 먼저 바꾸고 목록은 그 다음에
// 다시 읽어 오므로, 그 사이 한 프레임에서는 같은 글이 양쪽에 다 있다. 예전처럼 그냥 이어
// 붙이면 **공유 → 나만 보기로 넘길 때 내 묵상이 두 줄로 보였다가 하나로** 합쳐졌고
// (사용자 관찰 2026-09-05), 반대로 넘길 때는 목록이 도착하기 전까지 한 줄도 없어서
// '올라온 나눔이 아직 없어요'가 스쳤다. 그래서 **내 줄은 지금 내 상태에서 한 줄만 만들고**
// 목록에서 온 내 줄은 걷어낸다.
//   mine: undefined = 아직 이 날 내 묵상을 못 읽었다(목록을 그대로 둔다)
//         null      = 이 날 내 묵상이 없다(지우고 나서 목록이 늦게 오는 경우도 여기다)
//         { … }     = 내 줄 한 줄
// 자리: 비공개면 맨 위다(남에게는 안 보이는 줄이라 목록의 시간 순서에 낄 자리가 없다).
// 공유 중이면 목록이 준 자리 그대로 두고, 목록에 아직 없으면 맨 뒤에 세운다 — 목록은
// updated_at 오름차순이고 방금 저장한 글이 갈 자리가 거기라, 새 목록이 와도 줄이 안 움직인다.
export function mergeFeed(shared, mine) {
  const rows = shared || [];
  if (mine === undefined) return rows;
  const others = rows.filter(e => !e.mine);
  if (!mine) return others;
  // 이름·사진은 목록에 있던 내 줄에서 이어받는다(없으면 프로필에서 찾는다 — profile_id)
  const at = rows.findIndex(e => e.mine);
  const row = { ...(at < 0 ? null : rows[at]), ...mine };
  if (mine.private) return [row, ...others];
  return at < 0 ? [...others, row] : [...others.slice(0, at), row, ...others.slice(at)];
}

// **비공개 묵상도 내 피드에는 선다**(사용자 결정 2026-09-03). 그 줄에는 '나만 보기'
// 표시가 붙는다. 남에게는 여전히 안 보인다: 피드 데이터는 공유된 글만 읽고(RLS와 같은
// 경계) 이 줄은 화면에서 내 것 하나를 얹은 것이다(mergeFeed).
//
// **이 줄에는 공유를 바꾸는 칸이 없다**(사용자 결정 2026-09-05 — 머리말 '공유를 조작하는
// 자리는 한 곳'). 표시(잠금)와 고치기(연필)만 두고, 공개 범위는 위 '내 묵상' 칸의 토글이
// 정한다 — 연필이 그 칸으로 데려간다.
//
// **남의 줄을 지우는 것은 마스터만이다**(사용자 결정 2026-09-05 · 0045
// qt_entries_delete_master). 내 줄에는 붙지 않는다 — 내 것은 위 '내 묵상' 칸의 휴지통이
// 지우고, 거기는 잔디까지 같이 비운다.
export const canDeleteShared = (row, isMaster) => !!isMaster && !row?.mine;

// 나눔 한 줄의 글 — **종이와 같은 문법**(왼쪽 라벨 · 오른쪽 글)으로 접어 보여준다.
// 사용자 지적 2026-09-09: "오늘의 나눔 쪽에는 또 별로이게 보이는데, 이것도 좀 개선을".
// 예전에는 마크다운을 그대로 RichText에 넘겨서 도막 제목이 굵은 맨 줄로 서고, **빈 도막
// (결단·기도를 안 쓴 날)까지 제목만 남아** 글에 구멍이 보였다.
// 도막이 없는 글(템플릿을 안 쓰고 쓴 나눔)은 예전 그대로 마크다운 뷰어다 — 그쪽이
// 제목·목록·굵게를 다 그린다.
function NoteDigest({ md }) {
  const secs = useMemo(() => splitNoteSections(md), [md]);
  const plain = !secs.length || (secs.length === 1 && !secs[0].title);
  if (plain) {
    return (
      <div className="text-[13px] leading-relaxed text-fg-secondary break-words mt-0.5">
        <RichText content={md} />
      </div>
    );
  }
  return (
    <div className="qt-digest mt-1 grid gap-x-3 gap-y-1 items-baseline"
      style={{ gridTemplateColumns: '52px minmax(0, 1fr)' }}>
      {secs.map((sec, i) => (
        <React.Fragment key={`${sec.title}-${i}`}>
          <span className="text-[10px] font-extrabold text-fg-faint">{sec.title || ' '}</span>
          <span className="min-w-0 text-[12.5px] leading-[1.75] text-fg-secondary break-words whitespace-pre-line">
            {sec.body}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function ShareFeed({ rows = [], members = [], myName = '', onEdit, isMaster = false, onDeleteOther }) {
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  // 줄 등장 순번은 앱의 관례대로 **첫 마운트에만** 준다(useEnterStagger 주석) — 그 뒤에
  // 새로 올라온 나눔 한 줄에까지 지연이 걸리면 그 줄만 몇백 ms 뒤에 나타나 지각으로 읽힌다.
  const stagger = useEnterStagger();
  if (!rows.length) {
    return <p className="text-[11.5px] text-fg-faint">이 날짜에 올라온 나눔이 아직 없어요</p>;
  }
  return (
    <div className="flex flex-col">
      {rows.map((e, i) => {
        // 이름·사진의 원본은 워크스페이스 멤버 목록이다(profiles에서 온다).
        // 게스트 모드의 로컬 나눔은 언제나 내 글이라 프로필이 붙지 않는다.
        const m = byId.get(e.profile_id);
        const name = m?.name || e.name || myName;
        const url = m?.avatarUrl || e.avatarUrl || '';
        return (
          <div key={e.id} data-feed-row={e.mine ? (e.private ? 'mine-private' : 'mine') : 'other'}
            className="dc-row flex items-start gap-2.5 py-2.5"
            style={{ animationDelay: stagger ? `${Math.min(i, 12) * 30}ms` : '0ms' }}>
            <Avatar name={name} url={url || undefined} className="flex w-7 h-7 text-[11px] shrink-0 mt-px" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[11.5px] font-bold text-fg truncate min-w-0">{name}</p>
                {/* 지금 이 줄이 나만 보는 글임을 그 자리에서 말한다 */}
                {e.private && (
                  <span data-private="1" className="inline-flex items-center gap-1 shrink-0 px-1.5 py-px rounded-full bg-surface-hover text-[10.5px] font-bold text-fg-muted">
                    <Lock size={10} />나만 보기
                  </span>
                )}
                {/* 내 글에만 붙고 **언제나 보인다** — hover로만 뜨면 터치 기기에서는
                    없는 기능이 된다(§8) */}
                {e.mine && onEdit && (
                  <button onClick={onEdit} aria-label="내 나눔 고치기"
                    className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                    <Pencil size={12} />
                  </button>
                )}
                {/* 공유 해제가 아니라 그 사람의 그날 묵상이 없어진다 — 문구가 그걸 말한다 */}
                {canDeleteShared(e, isMaster) && onDeleteOther && (
                  <ConfirmPopover
                    message="이 나눔을 지울까요? 공유만 내려가는 게 아니라 그 사람의 이 날 묵상이 지워져요."
                    onConfirm={() => onDeleteOther(e)}>
                    <button aria-label="이 나눔 지우기"
                      className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </ConfirmPopover>
                )}
              </div>
              <NoteDigest md={e.body} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 내 기록 (잔디 — 개인 전용) ──────────────────────────────────────────────
// **칸을 잔디만큼 줄였다**(사용자 피드백 2026-09-02 4차 — "모바일과 아래쪽 뷰에서 너무
// 크다"). 예전에는 칸이 `aspect-square`라 폭을 나눠 가졌고, 모바일 전체 폭에서는 한 칸이
// 41px·1440px 옆 칸에서는 35px이었다 — 달력만큼 커져서 '기록 달력'이 아니라 달력으로
// 읽혔다. 칸을 고정 크기로 못 박으면 어느 폭에서도 같은 크기다.
//
// **날짜 숫자는 다시 들어왔다**(사용자 결정 2026-09-03 — "숫자가 있어도 좋을 것 같다,
// 살짝만 키워라"). 13px에는 숫자가 못 들어가서 20px로 올렸다 — 한 달이 158px(7×20 + 6×3)
// 이라 375px 화면에도 여유가 있고, 예전 41px의 절반이다. 요일 머리글·월 표시는 그대로
// 두고(숫자만으로는 무슨 요일인지 모른다) 칸마다 title·aria-label도 유지한다.
//
// **이전 달·다음 달로 넘길 수 있다**(2026-09-07). 이번 달만 보이면 지난 기록을 볼 길이
// 없었다. 보고 있는 달은 이 부품이 들고 있고(`view`), 그 달의 기록 날짜도 스스로 읽는다 —
// 한 번 읽은 달은 기억해 두므로 앞뒤로 넘나들 때 기다림이 없다. 저장·삭제가 있으면
// 부르는 쪽이 `reloadKey`를 올리고, 그때 보고 있는 달을 다시 읽는다(다른 달은 버린다).
// 다음 달 버튼은 **이번 달을 보고 있을 때 꺼진다** — 앞날의 기록은 있을 수 없다.
const WEEK_HEAD = ['일', '월', '화', '수', '목', '금', '토'];
const CELL = 20;   // px — 칸 한 변(숫자가 들어가는 최소 크기)
const GAP = 3;     // px — 칸 사이
const HEAD_H = 10; // px — 요일 머리글 한 줄(9px + pb-px)
// 6주 짜리 달의 높이. 5주 달을 볼 때도 이만큼 잡아 두어야 달을 넘길 때 아래가 안 튄다
// (한 줄이 23px이라 9월 ↔ 8월에서 카드가 통째로 오르내렸다).
const GRID_MIN_H = HEAD_H + 6 * CELL + 6 * GAP;

const monthKey = (iso) => iso.slice(0, 7);
const NO_DATES = [];

function Grass({ today, onPick, reloadKey = 0 }) {
  const [view, setView] = useState(today);          // 보고 있는 달(그 달의 아무 날)
  const month = useMemo(() => monthDays(view), [view]);
  const [weekStart, weekEnd] = useMemo(() => weekRange(today), [today]);
  const key = monthKey(view);
  const thisMonth = monthKey(today);
  const isNow = key === thisMonth;

  // 이번 달 격자는 **이번 주가 걸친 만큼까지** 읽는다(달을 넘나드는 주가 있다).
  // 다른 달에는 '이번 주'라는 말이 없으므로 그 달만 읽는다.
  const first = month.days[0];
  const last = month.days[month.days.length - 1];
  const from = isNow && weekStart < first ? weekStart : first;
  const to = isNow && weekEnd > last ? weekEnd : last;

  // 달마다 한 번만 읽고 기억한다. 값을 달 열쇠로 들고 있으므로 **넘긴 첫 프레임에
  // 앞 달의 초록이 남지 않는다**(늦게 오는 값으로 덮는 방식이면 한 프레임 남는다).
  const [byMonth, setByMonth] = useState({});
  const dates = byMonth[key] || NO_DATES;
  const stale = useRef(false);
  useEffect(() => { stale.current = true; }, [reloadKey]);   // 저장·삭제 뒤에는 기억을 못 믿는다
  useEffect(() => {
    let alive = true;
    fetchMyEntryDates(from, to).then(v => {
      if (!alive) return;
      setByMonth(m => (stale.current ? { [key]: v } : { ...m, [key]: v }));
      stale.current = false;
    }).catch(() => {});
    return () => { alive = false; };
  }, [key, from, to, reloadKey]);

  const set = useMemo(() => new Set(dates), [dates]);
  const inMonth = month.days.filter(d => set.has(d)).length;
  const inWeek = dates.filter(d => d >= weekStart && d <= weekEnd).length;
  const navBtn = 'w-9 h-7 shrink-0 flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover disabled:opacity-35 disabled:hover:bg-transparent transition active:scale-95';
  // 달이 바뀌는 결은 날짜를 넘길 때와 같다(Swap의 옆으로 슬라이드)
  const [dir, setDir] = useState(0);
  const goMonth = (n) => { setDir(n); setView(shiftMonth(view, n)); };
  return (
    // data-col: 검사(tests/word.mjs)가 이 칸이 자기 트랙을 다 쓰는지 잰다(§6-9-k)
    <div data-col="grass">
      <SectionHead right={
        <span className="flex items-center gap-0.5 shrink-0">
          {!isNow && (
            <button onClick={() => { setDir(view < today ? 1 : -1); setView(today); }}
              className="mr-1 shrink-0 px-2 h-7 rounded-md text-[11px] font-semibold text-accent-text bg-accent-weak transition active:scale-95">
              오늘
            </button>
          )}
          <button onClick={() => goMonth(-1)} aria-label="지난 달" className={navBtn}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-fg-faint tabular-nums whitespace-nowrap">{month.year}년 {month.month}월</span>
          {/* 앞날의 기록은 있을 수 없다 — 이번 달에서는 잠근다 */}
          <button onClick={() => goMonth(1)} aria-label="다음 달" disabled={isNow} className={navBtn}>
            <ChevronRight size={14} />
          </button>
        </span>
      }>
        내 기록
      </SectionHead>
      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* 6주 자리를 늘 잡아 둔다(GRID_MIN_H) — 5주 달과 6주 달의 높이가 다르면
              달을 넘길 때마다 카드가 통째로 오르내린다 */}
          <Swap k={key} dir={dir} className="shrink-0">
          <div className="grid content-start"
            style={{ gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: GAP, minHeight: GRID_MIN_H }}>
            {WEEK_HEAD.map(w => (
              <span key={w} className="text-[9px] font-semibold text-fg-faint text-center leading-none pb-px">{w}</span>
            ))}
            {Array.from({ length: month.lead }, (_, i) => <span key={`b${i}`} />)}
            {month.days.map(d => {
              const has = set.has(d);
              return (
                <button
                  key={d} onClick={() => onPick(d)} title={shortDayLabel(d)} aria-label={shortDayLabel(d)}
                  className="rounded-[4px] flex items-center justify-center text-[9.5px] font-semibold tabular-nums leading-none transition active:scale-90"
                  style={{
                    width: CELL, height: CELL,
                    background: has ? 'var(--app-tag-green)' : 'var(--app-surface-hover)',
                    // 기록한 날은 초록 위의 짙은 초록, 안 한 날은 옅은 바닥 위의 무채색 —
                    // 9.5px이라 faint로 두면 안 읽힌다(대비를 한 단계 올렸다)
                    color: has ? 'var(--app-tag-green-fg)' : 'var(--app-ink-muted)',
                    opacity: d > today ? 0.45 : 1,
                    boxShadow: d === today ? 'inset 0 0 0 1.5px var(--app-accent)' : undefined,
                  }}
                >{+d.slice(8)}</button>
              );
            })}
          </div>
          </Swap>
          {/* '이번 주·이번 달'은 오늘이 든 달의 말이다 — 지난 달을 보고 있으면
              그 달의 이름으로 센다(8월 3번 기록했어요) */}
          <p className="flex-1 min-w-[9rem] text-[11.5px] text-fg-muted tabular-nums">
            {isNow
              ? `이번 주 ${inWeek}번, 이번 달 ${inMonth}번 기록했어요`
              : `${month.month}월 ${inMonth}번 기록했어요`}
          </p>
        </div>
      </Card>
    </div>
  );
}
