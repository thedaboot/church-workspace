import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Church, ChevronRight, ListChecks, Users } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser, selectMyTasks } from '../store/selectors.js';
import { Skeleton } from '../components/media.jsx';
import { CARD, CARD_STYLE, Empty } from '../components/groupsParts.jsx';
import { ISO_TODAY, byDue } from './dashboardParts.jsx';
import { kstToday, shortDayLabel, fetchSchedule, fetchMyEntry } from '../services/word.js';
import { kindLabel, formatServiceDate, fetchServices } from '../services/worship.js';
import { fetchGroupPerms, fetchGroupsRoster, mySun, groupPeople } from '../services/groups.js';

// ============================================================================
// v2 홈 — 교회 생활 한 화면 (docs/V2.md §3 · IA A안의 첫 탭)
// ----------------------------------------------------------------------------
// 모바일 하단 바의 첫 탭이자 **앱의 첫 화면**이다(App.jsx activeMenu 기본값 'home').
//
// **여기서 새로 만드는 저장 자리도, 새로 짜는 조회도 없다.** 세 줄기가 이미 가진
// 서비스를 조립만 한다 — 말씀(fetchSchedule·fetchMyEntry) · 예배(fetchServices) ·
// 모임(fetchGroupPerms·fetchGroupsRoster) · 업무(스토어 셀렉터). 줄기가 바뀌면 홈은
// 저절로 따라간다. 반대로 홈이 자기 셈을 갖기 시작하면 같은 숫자가 두 곳에서 갈린다.
//
// **다섯 갈래를 따로 잡는다.** 한 줄기가 넘어져도 나머지 카드는 그대로 서야 한다 —
// 홈은 첫 화면이라 여기서 빈 화면이 뜨면 앱이 죽은 것처럼 보인다.
//
// **카드는 있는 것만 선다.** 게스트 모드(클라우드 없음)에서는 세 서비스가 전부 빈 값을
// 주므로 카드가 하나도 없을 수 있고, 그때는 인사말 + 빈 자리 한 줄이다.
//
// 오늘의 기준이 둘인 이유: QT·예배는 **한국 시간**(services/word.js kstToday), 업무
// 마감은 업무 화면과 같은 브라우저 로컬(dashboardParts.ISO_TODAY)이다. 각 카드가
// 자기 줄기와 같은 값을 봐야 같은 날짜가 두 화면에서 다르게 읽히지 않는다.
//
// 카드 껍데기(CARD·CARD_STYLE)는 예배·모임 화면과 같은 한 벌이고 값은
// dashboardParts의 Card와 같다 — 화면마다 카드 모서리·선이 달라지지 않게.
//
// **머리에 히어로가 선다**(사용자 피드백 2026-09-02 — "홈의 특성이 없고 너무 휑해서
// 놀랐다 … 웹앱의 대표 홈페이지다"). 카드 넷만 있던 화면은 데스크톱에서 아래 2/3이
// 통째로 비었다. 히어로는 상자를 두르지 않는다 — App.jsx가 화면 위쪽에 이미 파스텔
// 글로우(`.app-glow`)를 깔아 두었고, 그 위에 불투명한 판을 얹으면 그 글로우가 히어로
// 자리에서만 사라져 오히려 어긋난다. 캐릭터 그림이 배경 없는 투명 webp라서 라이트·
// 다크 어디에 놓아도 그대로 얹힌다.
// ============================================================================

// 캐릭터 — `public/chars/*.webp`(사용자가 준 `design/chars.png` 시트에서 컷마다 잘라
// 둔 28장, 배경 투명, 원본 168~225 × 134~196px).
//
// **한 장을 키우지 않고 여러 컷을 늘어놓는다**(사용자 피드백 2026-09-03 — 처음엔 한
// 장을 크게 썼다가 "캐릭터가 너무 크다", 다음엔 마크만큼 줄였다가 "밍밍하다"). 원본이
// 200px 남짓이라 키우면 흐려진다 — 대신 서로 다른 컷을 겹쳐 세워 한 장면으로 만든다.
//
// **크기는 높이로만, 그리고 원본 이하로만 준다.** 컷마다 원본 폭이 다르므로(168~225)
// 폭으로 잡으면 컷마다 세로 덩치가 달라진다. 아래 높이는 전부 그 컷의 원본 높이보다
// 작다(가운데 컷은 시각마다 바뀌므로 셋 중 가장 낮은 원본 153px이 상한이다).
//
// 시각에 따라 컷을 바꾼다 — 아침에는 커피, 밤에는 자는 컷이다. 홈은 하루에 여러 번
// 여는 첫 화면이라 같은 그림만 있으면 배경처럼 읽힌다. 기준은 QT·예배 카드와 같은
// 한국 시간이다(브라우저 시간대로 재면 나라마다 다른 그림이 뜬다).
//
// **그림과 인사말은 같은 경계를 쓴다**(사용자 요청 2026-09-03 — "시간에 따라 캐릭터가
// 바뀌면 인사말도 같이 바뀌게"). 그래서 경계는 heroSlot 한 곳에만 있다 — 두 벌로 두면
// 밤 그림 옆에 낮 인사말이 서는 시각이 생긴다.
export function heroSlot(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 22 || hour < 5) return 'night';
  return 'day';
}
const HERO_CUTS = { morning: '/chars/coffee.webp', night: '/chars/sleep.webp', day: '/chars/hug-side.webp' };
export const heroCut = (hour) => HERO_CUTS[heroSlot(hour)];

// 인사말. 담백한 존댓말 한 줄이고 느낌표·이모지를 붙이지 않는다(§8).
// 이름이 없는 계정(아직 이름을 안 적은 사람)에는 이름 자리를 비운 문장을 쓴다 —
// '님, 안녕하세요'처럼 앞이 잘린 줄이 되지 않게.
const HERO_GREETINGS = {
  morning: (who) => (who ? `좋은 아침이에요, ${who}님` : '좋은 아침이에요'),
  day: (who) => (who ? `${who}님, 안녕하세요` : '안녕하세요'),
  night: (who) => (who ? `${who}님, 편안한 밤이에요` : '편안한 밤이에요'),
};
const heroGreeting = (hour, name = '') => HERO_GREETINGS[heroSlot(hour)](String(name || '').trim());

const kstHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));

// 히어로의 컷 무리. 가운데(`slot: true`)만 시각에 따라 바뀌고 나머지는 고정 배역이다 —
// 배역에 coffee·sleep·hug-side를 넣지 않는다(가운데와 같은 컷이 두 장 서게 된다).
// dy는 바닥선에서 살짝 내려앉히는 값(px), lap은 왼쪽 컷과 겹치는 폭(px)이다.
// `mob`이 아닌 컷은 모바일에서 빠진다 — 375px에 다섯이 서면 가로로 넘친다.
const CROWD = [
  { key: 'book', src: '/chars/book.webp', h: 'md:h-[124px]', dy: 7, lap: 0, mob: false },
  { key: 'welcome', src: '/chars/welcome.webp', h: 'h-[84px] md:h-[136px]', dy: 3, lap: 18, mob: true },
  { key: 'slot', src: null, h: 'h-[96px] md:h-[150px]', dy: 0, lap: 18, mob: true },
  { key: 'hearts', src: '/chars/hearts.webp', h: 'h-[84px] md:h-[134px]', dy: 4, lap: 18, mob: true },
  { key: 'wave', src: '/chars/sparkle-wave.webp', h: 'md:h-[128px]', dy: 8, lap: 0, mob: false },
];

// 배경 글로우 — 캐릭터의 파스텔(하늘·라벤더)과 같은 계열이다. **토큰으로 만든다**:
// accent-weak·tag-purple은 다크에서 어두운 남색·보라로 바뀌므로 테마를 저절로 따라간다
// (index.css의 `.app-glow`는 생색을 쓰고 다크에서 opacity로 눌러 두었는데, 그 파일은
// 이 회차의 소유가 아니라 건드리지 않았다 — 겹쳐도 둘 다 아주 옅어 서로 먹지 않는다).
// blur가 아니라 radial-gradient다(§4.2 — 큰 블러 레이어는 모바일 래스터 비용이 크다).
const HERO_GLOW = {
  backgroundRepeat: 'no-repeat',
  backgroundImage: [
    'radial-gradient(52rem 24rem at 22% 6%, color-mix(in srgb, var(--app-accent-weak) 92%, transparent), transparent 70%)',
    'radial-gradient(40rem 20rem at 80% 0%, color-mix(in srgb, var(--app-tag-purple) 62%, transparent), transparent 72%)',
    'radial-gradient(34rem 18rem at 52% 92%, color-mix(in srgb, var(--app-tag-pink) 42%, transparent), transparent 74%)',
  ].join(','),
};

// ponytail: 태그라인은 사용자가 정한 문구 그대로다(2026-09-03). '다붓하다'(정답게,
// 매우 가깝게 붙어 있다)의 뜻을 그대로 풀어 쓴 줄이다.
const TAGLINE = '정답게, 매우 가깝게 붙어 함께 걷는 공동체';

// 홈에 세울 예배 한 건 — **다가오는 것 중 가장 이른 것**, 그런 것이 없으면 가장 최근에
// 지난 것. 종류는 가리지 않는다: 이번 주에 금요 예배만 잡혀 있으면 그것이 이번 주
// 예배이고, 무슨 예배인지는 kindLabel이 말한다(결정 14).
// 날짜가 없거나 모양이 깨진 행은 애초에 세지 않는다 — 문자열 비교로 줄을 세우기 때문에
// 그런 행 하나가 맨 앞을 차지하면 홈이 엉뚱한 주보를 편다.
export function pickService(services = [], today = kstToday()) {
  const dated = (services || []).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(String(s?.service_date || '')));
  const ahead = dated.filter(s => s.service_date >= today)
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  if (ahead.length) return ahead[0];
  return dated.sort((a, b) => b.service_date.localeCompare(a.service_date))[0] || null;
}

// 마감 칸 — 마감 목록(dashboardParts의 mdLabel)과 같은 모양·같은 폭이다.
const dueLabel = (iso) => (iso ? `${+iso.slice(5, 7)}. ${+iso.slice(8, 10)}.` : '미정');

// ── 카드 껍데기 ─────────────────────────────────────────────────────────────
// 통째로 눌리는 카드. 화살표는 언제나 보인다 — hover에서만 나타나는 조작은 터치
// 기기에 없는 것과 같다(§8).
function LinkCard({ className, label, icon: Icon, onOpen, delay, title, children }) {
  return (
    <button
      type="button" onClick={onOpen} title={title}
      className={`home-card ${className} dc-card w-full text-left p-4 md:p-[18px] ${CARD} transition active:scale-[.995]`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}
    >
      <span className="flex items-center gap-1.5 mb-2">
        <Icon size={13} className="text-fg-faint shrink-0" />
        <span className="text-[11.5px] font-semibold text-fg-muted">{label}</span>
        <span className="flex-1" />
        <ChevronRight size={14} className="text-fg-faint shrink-0" />
      </span>
      {children}
    </button>
  );
}

// ── 카드 3 · 내 업무 ────────────────────────────────────────────────────────
// 카드 머리는 목록으로, 줄은 그 업무 창으로 간다 — 그래서 이 카드만 통짜 버튼이
// 아니다(버튼 안에 버튼을 넣을 수 없다).
function TasksCard({ tasks, today, onOpenList, onOpenTask, delay }) {
  const open = useMemo(() => tasks.filter(t => t.status !== '완료'), [tasks]);
  // 가까운 마감 둘. 마감이 없는 업무는 byDue가 뒤로 보낸다(목록 화면과 같은 규칙).
  const near = useMemo(() => [...open].sort(byDue).slice(0, 2), [open]);
  return (
    <div className={`home-card home-tasks dc-card p-4 md:p-[18px] ${CARD}`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}>
      <button type="button" onClick={onOpenList} className="w-full flex items-center gap-1.5 text-left">
        <ListChecks size={13} className="text-fg-faint shrink-0" />
        <span className="text-[11.5px] font-semibold text-fg-muted">내 업무</span>
        <span className="home-task-count text-[11.5px] font-semibold text-fg tabular-nums">{open.length}건</span>
        <span className="flex-1" />
        <ChevronRight size={14} className="text-fg-faint shrink-0" />
      </button>
      {near.length ? (
        <div className="mt-1.5">
          {near.map(t => (
            <button
              key={t.id} type="button" onClick={() => onOpenTask(t)}
              className="home-task-row w-full flex items-center gap-3 px-2 -mx-2 py-1.5 rounded-[8px] text-left hover:bg-surface-hover transition-colors"
            >
              <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
                style={{ color: t.dueDate && t.dueDate < today ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>
                {dueLabel(t.dueDate)}
              </span>
              <span className="flex-1 min-w-0 text-[13px] font-semibold text-fg truncate">{t.title}</span>
            </button>
          ))}
        </div>
      ) : (
        // 사용자가 고른 문구다(§8) — 없는 것을 세는 문장 대신 끝난 상태를 그대로 말한다
        <p className="home-tasks-clear mt-1.5 text-[12.5px] text-fg-muted">다 정리되었어요</p>
      )}
    </div>
  );
}

const LOADING = (
  <div className="home-loading grid gap-3 md:gap-3.5 md:grid-cols-2">
    {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] w-full rounded-[10px]" />)}
  </div>
);

export function HomeView({ onNavigate, onTaskClick }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  // 화면이 서 있는 동안 날짜가 흔들리지 않게 한 번만 잡는다(자정을 넘겨도 홈을 다시
  // 열면 새 날짜다 — App이 화면을 바꿀 때마다 이 뷰를 다시 마운트한다).
  const [day] = useState(kstToday);
  // 그림과 인사말이 보는 시각. 날짜와 같이 **한 번만** 잡는다 — 렌더마다 다시 재면
  // 경계(10시·22시)를 넘는 순간 리렌더 하나 때문에 그림과 문구가 갈릴 수 있다.
  const [hour] = useState(kstHour);
  const [church, setChurch] = useState(null);   // null이면 아직 안 읽음

  useEffect(() => {
    let alive = true;
    const year = Number(day.slice(0, 4)) || new Date().getFullYear();
    // 갈래마다 따로 잡는다 — 하나가 실패해도 나머지 카드는 선다. 실패는 콘솔에
    // 원문으로 남기고(§8 · errorText) 화면에는 그 카드만 빠진다.
    const safe = (what, p, fallback) => p.catch((e) => {
      console.error(`[home] ${what} 실패:`, e);
      return fallback;
    });
    (async () => {
      const [qt, entry, services, perms, roster] = await Promise.all([
        safe('오늘 본문', fetchSchedule(day), null),
        safe('내 묵상', fetchMyEntry(day), null),
        safe('예배 목록', fetchServices(), []),
        safe('내 명단 항목', fetchGroupPerms(year), null),
        safe('순 편성', fetchGroupsRoster(year), null),
      ]);
      if (!alive) return;
      const me = perms?.myPerson || null;
      const sun = me && roster ? mySun(me, roster.suns, roster.members) : null;
      setChurch({
        qt,
        written: !!String(entry?.body || '').trim(),
        service: pickService(services, day),
        sun,
        sunCount: sun ? groupPeople({ people: roster.people, group: sun, members: roster.members }).length : 0,
        leaderName: sun ? (roster.people.find(p => p.id === sun.leader_person_id)?.name || '') : '',
      });
    })();
    return () => { alive = false; };
  }, [day]);

  const name = currentUser?.name || '';
  const today = ISO_TODAY();

  // 있는 카드만 세운다. 순서는 docs/V2.md §3 그대로 — 오늘의 QT · 이번 주 예배 ·
  // 내 업무 · 내 순. 등장 지연은 **실제로 선 자리**를 따른다(빠진 카드가 있어도
  // 한 칸씩 차례로 들어온다, §4.2).
  const cards = [];
  if (church?.qt) {
    cards.push(['qt', (delay) => (
      <LinkCard className="home-qt" label="오늘의 QT" icon={BookOpen} delay={delay} title="말씀으로"
        onOpen={() => onNavigate('word')}>
        <span className="home-qt-ref block text-[15px] font-extrabold text-fg tracking-[-0.3px] break-words">
          {church.qt.passage_ref}
        </span>
        {church.qt.label && (
          <span className="home-qt-label block mt-0.5 text-[11.5px] text-fg-muted break-words">{church.qt.label}</span>
        )}
        {/* 안 쓴 날에는 줄을 두지 않는다 — 없는 것을 굳이 말하지 않는다(대시보드의
            '지난 7일 간 N건'과 같은 판단). 잔디와 마찬가지로 남과 견주지 않는다. */}
        {church.written && (
          <span className="home-qt-done block mt-1.5 text-[11.5px] font-semibold" style={{ color: 'var(--app-tag-green-fg)' }}>
            오늘 묵상을 기록했어요
          </span>
        )}
      </LinkCard>
    )]);
  }
  if (church?.service) {
    const s = church.service;
    cards.push(['worship', (delay) => (
      <LinkCard className="home-worship" label="이번 주 예배" icon={Church} delay={delay} title="예배로"
        onOpen={() => onNavigate('worship')}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(s.kind)}</span>
          {/* 작성 중인 주보는 편집 자격자에게만 온다 — 거르는 것은 화면이 아니라 RLS다(0036) */}
          {s.status !== 'published' && (
            <span className="home-worship-draft px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>
          )}
          <span className="text-[11.5px] text-fg-muted">{formatServiceDate(s.service_date)}</span>
        </span>
        <span className="home-worship-title block mt-1.5 text-[14px] font-bold text-fg break-words">{s.title || '설교 제목 미정'}</span>
        {(s.passage_ref || s.preacher) && (
          <span className="home-worship-sub block mt-0.5 text-[11.5px] text-fg-muted break-words">
            {[s.passage_ref, s.preacher].filter(Boolean).join(' · ')}
          </span>
        )}
      </LinkCard>
    )]);
  }
  if (myTasks.length) {
    cards.push(['tasks', (delay) => (
      <TasksCard tasks={myTasks} today={today} delay={delay}
        onOpenList={() => onNavigate('myTasks')} onOpenTask={onTaskClick} />
    )]);
  }
  // 명단에 안 이어진 계정에는 이 카드가 아예 없다(모임 화면이 그 사정을 말한다)
  if (church?.sun) {
    cards.push(['sun', (delay) => (
      <LinkCard className="home-sun" label="내 순" icon={Users} delay={delay} title="모임으로"
        onOpen={() => onNavigate('groups')}>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="home-sun-name text-[15px] font-extrabold text-fg tracking-[-0.3px]">{church.sun.name}</span>
          {church.leaderName && <span className="home-sun-leader text-[11.5px] text-fg-muted">순장 {church.leaderName}</span>}
          <span className="flex-1" />
          <span className="home-sun-count text-[11.5px] text-fg-faint tabular-nums">{church.sunCount}명</span>
        </span>
      </LinkCard>
    )]);
  }

  return (
    <div className="home-screen dc-screen pb-8">
      {/* 히어로 — 가운데 정렬 랜딩. 글이 먼저 서고 그 아래에 컷 무리가 한 장면으로
          앉는다(사용자 피드백 2026-09-03 — "조금 더 랜딩 페이지같이, 확 임팩트가 오게").
          상자를 두르지 않는다: 배경은 토큰으로 만든 글로우 한 겹뿐이다.
          `-z-10`이라야 뒤로 간다 — 자리를 잡은(absolute) 요소는 기본적으로 흐름 안의
          글보다 위에 그려져서, 그냥 두면 글로우가 인사말을 덮는다. */}
      <section className="home-hero relative text-center pt-3 pb-6 md:pt-7 md:pb-8">
        <div className="home-hero-glow pointer-events-none absolute -z-10 inset-x-0 -top-6 h-[300px] md:h-[420px]"
          style={HERO_GLOW} aria-hidden="true" />

        <div className="home-hero-text dc-card mx-auto max-w-[720px]">
          {/* 인사말과 날짜는 **한 줄**이다(사용자 요청 2026-09-03). baseline으로 맞춰야
              큰 인사말과 작은 날짜 칩의 글자 밑선이 같아진다(items-center로 두면 칩이
              한가운데 떠서 따로 붙인 표처럼 보인다). 데스크톱은 반드시 한 줄이고
              (인사말 + 칩이 720px 안에 든다), 좁은 화면에서는 flex-wrap이 넘긴다. */}
          <div className="home-hero-line flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
            <h2 className="home-greeting text-[27px] md:text-[40px] font-extrabold text-fg leading-[1.15]"
              style={{ letterSpacing: '-1px' }}>
              {heroGreeting(hour, name)}
            </h2>
            {/* 날짜는 QT·예배 카드와 같은 한국 시간이다 — 카드는 오늘 본문인데 머리줄만
                하루 어긋나면 그 화면을 믿을 수 없게 된다 */}
            <p className="home-date shrink-0 px-2.5 py-1 rounded-full text-[11.5px] font-semibold text-fg-muted"
              style={CARD_STYLE}>{shortDayLabel(day)}</p>
          </div>
          <p className="home-tagline mt-2.5 text-[15px] md:text-[17px] text-fg-muted">{TAGLINE}</p>
        </div>

        {/* 컷 무리 — 바닥선을 맞추고(items-end) 컷마다 조금 내려앉힌다. 겹침은 왼쪽으로
            당겨서 만든다. 글이 다 들어온 뒤에 왼쪽부터 차례로 선다(§4.2 — 순서가 있는
            애니메이션은 앞이 끝난 뒤에 다음이 시작한다. 글의 .dc-card가 .28s다). */}
        <div className="home-crowd mt-4 md:mt-6 flex items-end justify-center">
          {/* 내려앉히는 값(dy)을 transform으로 주면 안 된다 — `.dc-card`의 등장
              애니메이션이 transform을 쓰고 fill-mode: both로 `none`을 남겨서 연출이
              끝나는 순간 y가 도로 0이 된다. 그래서 relative + top이다. */}
          {CROWD.map((c, i) => (
            <img
              key={c.key} src={c.src || heroCut(hour)} alt="" aria-hidden="true" draggable="false"
              className={`home-cut home-cut-${c.key} dc-card relative shrink-0 w-auto ${c.h} ${c.mob ? '' : 'hidden md:block'} select-none pointer-events-none`}
              style={{
                marginLeft: i ? `-${c.lap}px` : 0,
                top: `${c.dy}px`,
                animationDelay: `${280 + i * 60}ms`,
              }}
            />
          ))}
        </div>
      </section>

      {!church ? LOADING : cards.length ? (
        <div className="home-cards grid gap-3 md:gap-3.5 md:grid-cols-2">
          {cards.map(([key, render], i) => <React.Fragment key={key}>{render(i * 40)}</React.Fragment>)}
        </div>
      ) : (
        // 히어로가 이미 화면을 채우므로 빈 자리는 마크 없이 한 줄이고 높이도 줄인다 —
        // 여기에 46vh를 그대로 두면 히어로 아래가 통째로 비어 보인다(§8 · 작은 구역의
        // 빈 자리는 글자 한 줄).
        <Empty className="home-empty" minH="18vh" title="예배 · 말씀 · 모임 소식이 아직 올라오지 않았어요" />
      )}

      {/* 대표 홈페이지의 발문 — 랜딩 느낌을 닫는 한 줄이다(순모임 가이드 템플릿 푸터와
          같은 표기). 사용법을 알려주는 안내 줄이 아니다. */}
      <p className="home-mark mt-9 text-center text-[10px] font-semibold text-fg-faint" style={{ letterSpacing: '2.6px' }}>
        THE DABOOT MINISTRY
      </p>
    </div>
  );
}
