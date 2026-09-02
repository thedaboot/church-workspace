import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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

// 캐릭터 마크 — `public/chars/*.webp`(사용자가 준 `public/chars.png` 시트에서 컷마다
// 잘라 둔 28장, 배경 투명, 170~225px 남짓). **큰 일러스트 한 장으로 쓰지 않는다**
// (사용자 지적 2026-09-03 — "캐릭터가 너무 크다"). 인사말 옆에 앉는 마크다.
//
// **크기는 높이로만 준다.** 컷마다 원본 폭이 다르기 때문에(177~225) 폭으로 잡으면
// 시각별로 마크의 세로 덩치가 달라지고, 어떤 컷은 원본보다 커져 흐려진다.
//
// 시각에 따라 컷을 바꾼다 — 아침에는 커피, 밤에는 자는 컷이다. 홈은 하루에 여러 번
// 여는 첫 화면이라 같은 그림만 있으면 배경처럼 읽힌다. 기준은 QT·예배 카드와 같은
// 한국 시간이다(브라우저 시간대로 재면 나라마다 다른 그림이 뜬다).
const HERO_CUTS = { morning: '/chars/coffee.webp', night: '/chars/sleep.webp', day: '/chars/hug-side.webp' };
export function heroCut(hour) {
  if (hour >= 5 && hour < 10) return HERO_CUTS.morning;
  if (hour >= 22 || hour < 5) return HERO_CUTS.night;
  return HERO_CUTS.day;
}
const kstHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));
// 공동체 이름. 앱 안에서 이미 쓰는 표기다('더다붓에 공유하기' · 템플릿 푸터의
// THE DABOOT MINISTRY). 뜻은 ai.js의 배경 지식에 적혀 있다 — "다붓하다"는 매우
// 가깝게 붙어 있다는 뜻이고, 더다붓은 "더 다붓해지자"다.
const COMMUNITY = '더다붓';
// ponytail: 태그라인은 **사용자 확정 대기**다. 캐릭터 둘이 껴안은 그림과 '다붓하다'의
// 뜻을 그대로 받은 한 줄로 두었다. 과장·비교 없는 담백한 문장이어야 한다(§8).
const TAGLINE = '가까이 붙어 함께 걷는 청년 공동체';

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
function LinkCard({ className, label, onOpen, delay, title, children }) {
  return (
    <button
      type="button" onClick={onOpen} title={title}
      className={`home-card ${className} dc-card w-full text-left p-4 ${CARD} transition active:scale-[.995]`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}
    >
      <span className="flex items-center gap-1.5 mb-2">
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
    <div className={`home-card home-tasks dc-card p-4 ${CARD}`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}>
      <button type="button" onClick={onOpenList} className="w-full flex items-center gap-1.5 text-left">
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
  <div className="home-loading grid gap-3 md:grid-cols-2">
    {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] w-full rounded-[10px]" />)}
  </div>
);

export function HomeView({ onNavigate, onTaskClick }) {
  const currentUser = useStore(selectCurrentUser);
  const myTasks = useStore(selectMyTasks);
  // 화면이 서 있는 동안 날짜가 흔들리지 않게 한 번만 잡는다(자정을 넘겨도 홈을 다시
  // 열면 새 날짜다 — App이 화면을 바꿀 때마다 이 뷰를 다시 마운트한다).
  const [day] = useState(kstToday);
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
      <LinkCard className="home-qt" label="오늘의 QT" delay={delay} title="말씀으로"
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
      <LinkCard className="home-worship" label="이번 주 예배" delay={delay} title="예배로"
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
      <LinkCard className="home-sun" label="내 순" delay={delay} title="모임으로"
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
      {/* 히어로 — 모바일은 마크 위·글 아래로 가운데, 데스크톱은 글 왼쪽·마크 오른쪽
          끝이다(DOM 차례가 모바일 차례이고 데스크톱에서 order로 뒤집는다). 데스크톱에서
          마크를 글 앞에 두면 인사말이 오른쪽으로 밀려 **아래 카드의 왼쪽 선과 어긋난다** —
          같은 화면 안에서 두 개의 왼쪽 기준선이 생긴다. */}
      <section className="home-hero flex flex-col items-center gap-2.5 pt-1 pb-5 text-center md:flex-row md:gap-6 md:pt-2 md:pb-7 md:text-left">
        <img
          src={heroCut(kstHour())} alt="" aria-hidden="true" draggable="false"
          className="home-hero-art md:order-2 md:ml-auto shrink-0 w-auto h-[108px] md:h-[140px] select-none pointer-events-none"
        />
        <div className="home-hero-text md:order-1 min-w-0 md:max-w-[560px]">
          <p className="home-hero-name text-[11.5px] font-bold text-accent-text" style={{ letterSpacing: '1.4px' }}>
            {COMMUNITY}
          </p>
          <h2 className="home-greeting text-[22px] md:text-[30px] font-extrabold text-fg mt-1 mb-[3px]" style={{ letterSpacing: '-0.9px' }}>
            {name ? `${name}님, 안녕하세요` : '안녕하세요'}
          </h2>
          {/* 날짜는 QT·예배 카드와 같은 한국 시간이다 — 카드는 오늘 본문인데 머리줄만
              하루 어긋나면 그 화면을 믿을 수 없게 된다 */}
          <p className="home-date text-[12.5px] text-fg-muted">{shortDayLabel(day)}</p>
          <p className="home-tagline mt-2.5 text-[13px] md:text-[14px] text-fg-secondary">{TAGLINE}</p>
        </div>
      </section>

      {!church ? LOADING : cards.length ? (
        <div className="home-cards grid gap-3 md:grid-cols-2">
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
