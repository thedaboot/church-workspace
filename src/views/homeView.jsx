import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Church, ChevronRight, ListChecks, Users } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser, selectMyTasks } from '../store/selectors.js';
import { Skeleton } from '../components/media.jsx';
import { CARD, CARD_STYLE, Empty } from '../components/groupsParts.jsx';
import { ISO_TODAY, byDue } from './dashboardParts.jsx';
import { kstToday, shortDayLabel, fetchSchedule, fetchMyEntry } from '../services/word.js';
import { loadPassage } from '../services/bible.js';
import { kindLabel, fetchServices, fetchAttendance } from '../services/worship.js';
import { fetchGroupPerms, fetchGroupsRoster, mySun, groupPeople, countSunSharedNotes, latestSunday } from '../services/groups.js';
import { useCached } from '../services/cache.js';
import { useLiveRefresh } from '../services/liveV2.js';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

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

// 캐릭터 — `public/chars/sparkle-wave.webp` **한 장**(203×168, 배경 투명).
//
// 사용자 피드백 세 번을 지나 여기 왔다(2026-09-03): 큰 일러스트 한 장 → "너무 크다"
// → 작은 마크 → "밍밍하다" → 컷 다섯 장 무리 → **"캐릭터는 홈에 딱 하나만"**.
// 그래서 시각별로 컷을 바꾸던 것도 없앴다 — 그림은 언제나 이 한 장이다.
// **인사말은 그대로 시각에 따라 바뀐다**(아래 heroGreeting).
//
// 크기는 높이로만, 그리고 원본 이하로만 준다. 폭을 함께 적어 두는 이유는 캐싱이 아니라
// **자리 잡기**다 — width/height가 없으면 그림이 도착하는 순간 아래 카드가 밀려난다.
//
// **레티나에서 실제로 그려지는 픽셀은 CSS 높이 × dpr이다.** 1x 컷(203×168)만 있을 때
// 140px로 두었더니 280px까지 늘어나 흐려졌다(사용자 지적 2026-09-03 — "화질이 구려
// 보인다"). 지금은 컷마다 `@2x`(2배, 406×336)가 있어서 `srcset`으로 갈라 주고 상한을
// 140px로 되돌렸다(2x 화면 280px ≤ 336px). `image-rendering`은 손대지 않는다(auto) —
// 억지로 픽셀을 세우면 파스텔 그라디언트가 더 상한다.
const cutSet = (src) => `${src} 1x, ${src.replace(/\.webp$/, '@2x.webp')} 2x`;
const HERO_CUT = { src: '/chars/sparkle-wave.webp', w: 203, h: 168 };

// 인사말은 시각에 따라 바뀐다. 담백한 존댓말 한 줄이고 느낌표·이모지를 붙이지 않는다(§8).
// 이름이 없는 계정(아직 이름을 안 적은 사람)에는 이름 자리를 비운 문장을 쓴다 —
// '님, 안녕하세요'처럼 앞이 잘린 줄이 되지 않게. 기준은 QT·예배 카드와 같은 한국
// 시간이다(브라우저 시간대로 재면 나라마다 다른 인사말이 뜬다).
// 네 구간이다(사용자 결정 2026-09-03 — 처음엔 셋이었다). 경계는 여기 한 곳뿐이다.
export function heroSlot(hour) {
  if (hour >= 6 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 18) return 'day';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';   // 23시 ~ 다음 날 6시
}
// 문구는 사용자가 정한 그대로다(2026-09-03). 이름 자리와 문장의 앞뒤가 구간마다
// 다르므로(아침·밤은 앞, 낮·저녁은 뒤) 한 틀로 합치지 않는다.
const HERO_GREETINGS = {
  morning: (who) => (who ? `좋은 아침이에요, ${who}님` : '좋은 아침이에요'),
  day: (who) => (who ? `${who}님, 기쁜 날이에요` : '기쁜 날이에요'),
  evening: (who) => (who ? `${who}님, 아름다운 밤이에요` : '아름다운 밤이에요'),
  night: (who) => (who ? `고생이 많아요, ${who}님` : '고생이 많아요'),
};
export const heroGreeting = (hour, name = '') => HERO_GREETINGS[heroSlot(hour)](String(name || '').trim());

const kstHour = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));

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

// **카드에 고정 최소 높이를 주지 않는다.** 한때 네 카드에 같은 min-height를 걸었더니
// 줄이 둘뿐인 카드 아래가 통째로 비었다(사용자 지적 2026-09-03, 두 번). 카드는 내용
// 만큼만 서고, **같은 행의 두 카드만** 그리드가 서로 맞춰 준다(items-stretch는 행마다
// 따로 계산된다 — 행끼리는 달라도 된다). 그래서 오늘의 QT·이번 주 예배 행은 두 줄
// 높이이고, 내 업무·내 순 행은 업무 건수만큼(최대 네 줄) 높다.
//
// 행이 과하게 커지지 않는 것은 내 업무의 줄 수 상한이 막는다.
const TASK_ROWS = 3;

// ── 홈 카드의 날짜 표기 (사용자 결정 2026-09-03 — 두 자리 연도) ─────────────
// 문자열을 그대로 쪼갠다 — `new Date('2026-09-06')`은 UTC 자정이라 시간대에 따라
// 하루가 밀린다(§0019의 'MM-DD' 관례와 같은 이유). 요일만 UTC로 셈한다.
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const ymd = (iso) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));

// '2026-09-06' → '26년 9월 6일 (일)'  (예배 메타 줄)
export function homeDateLabel(iso) {
  const m = ymd(iso);
  if (!m) return '';
  const w = WEEKDAY[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${m[1].slice(2)}년 ${+m[2]}월 ${+m[3]}일 (${w})`;
}

// '2026-09-04' → '26. 9. 4.'  (내 업무 줄의 마감). 마감이 없으면 '미정'이다 —
// '없어요'로 끝나는 짧은 부정을 쓰지 않는다(§8).
export function homeDueLabel(iso) {
  const m = ymd(iso);
  return m ? `${m[1].slice(2)}. ${+m[2]}. ${+m[3]}.` : '미정';
}
// 한 줄로 자르는 한 벌 — 카드의 모든 줄이 이 규칙을 쓴다(높이가 흔들리지 않게).
const ONE_LINE = 'overflow-hidden text-ellipsis whitespace-nowrap';



// ── 카드 껍데기 ─────────────────────────────────────────────────────────────
// 통째로 눌리는 카드. 화살표는 언제나 보인다 — hover에서만 나타나는 조작은 터치
// 기기에 없는 것과 같다(§8).
function LinkCard({ className, label, icon: Icon, onOpen, delay, title, focus, meta }) {
  return (
    <button
      type="button" onClick={onOpen} title={title}
      // 높이 셈: 제목 줄 18 + 8 + 본문 42 + 6 + 꼬리 17 + 패딩 = 네 카드가 같은 높이.
      // **flex flex-col + justify-start이라야 한다.** 버튼은 내용을 세로 가운데에
      // 놓는 상자(anonymous flex box)를 갖고 있어서, 같은 행의 옆 카드가 더 높아
      // 이 카드가 늘어나면 **제목 줄까지 통째로 아래로 내려간다** — 그래서 카드마다
      // 화살표 높이가 달라 보였다(사용자 지적 2026-09-03 · 실측 410 / 571px).
      className={`home-card ${className} dc-card flex flex-col justify-start w-full text-left p-4 md:p-[18px] ${CARD} transition-[translate,box-shadow] duration-200 ease-out active:scale-[.995]`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}
    >
      {/* 제목 줄 — 아이콘 · 라벨 · (오른쪽 끝) 화살표. 화살표는 이 줄 안에 있고
          내용 높이와 무관하다. 네 카드가 같은 줄 높이를 갖도록 h를 못 박는다. */}
      <span className="home-card-head flex items-center justify-between gap-1.5 h-[18px] mb-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon size={13} className="text-fg-faint shrink-0" />
          <span className="text-[11.5px] font-semibold text-fg-muted truncate">{label}</span>
        </span>
        <ChevronRight size={14} className="home-card-go text-fg-faint shrink-0" />
      </span>
      {/* 본문은 **초점 한 줄 + 메타 한 줄**이다(사용자 지적 2026-09-03 — "줄바꿈이 너무
          많아 무엇을 봐야 할지 고민하게 된다"). 예전에는 칩·날짜·부제·상태를 각각 줄로
          쌓아서 카드마다 읽을 순서가 달랐다. 지금은 눈이 굵은 줄에 먼저 닿고, 나머지는
          가운뎃점으로 이어 붙인 한 줄이다. 높이를 못 박아 네 카드가 같은 구조다. */}
      <span className="home-card-body block">
        <span className={`home-card-focus block text-[15px] font-extrabold text-fg tracking-[-0.3px] ${ONE_LINE}`}>
          {focus}
        </span>
        <span className="home-card-meta block mt-1 text-[12px] leading-[1.45] text-fg-muted">
          {meta}
        </span>
      </span>
    </button>
  );
}

// ── 카드 3 · 내 업무 ────────────────────────────────────────────────────────
// 카드 머리는 목록으로, 줄은 그 업무 창으로 간다 — 그래서 이 카드만 통짜 버튼이
// 아니다(버튼 안에 버튼을 넣을 수 없다).
function TasksCard({ tasks, today, onOpenList, onOpenTask, delay }) {
  const open = useMemo(() => tasks.filter(t => t.status !== '완료'), [tasks]);
  // 가까운 마감 **셋까지**. 마감이 없는 업무는 byDue가 뒤로 보낸다(목록 화면과 같은
  // 규칙). 넘치는 것은 세지 않고 마지막 줄에 '+N건 더'로 접는다 — 업무가 쌓일수록
  // 이 카드만 자라서 옆 카드와 높이가 어긋났다(사용자 지적 2026-09-03).
  const near = useMemo(() => [...open].sort(byDue).slice(0, TASK_ROWS), [open]);
  const more = open.length - near.length;
  return (
    <div className={`home-card home-tasks dc-card flex flex-col justify-start p-4 md:p-[18px] ${CARD}`}
      style={{ ...CARD_STYLE, animationDelay: `${delay}ms` }}>
      {/* 다른 세 카드와 같은 제목 줄이다 — 아이콘 · 라벨 · 오른쪽 끝 화살표, 높이 18px */}
      <button type="button" onClick={onOpenList}
        className="home-card-head w-full flex items-center justify-between gap-1.5 h-[18px] mb-2 text-left">
        <span className="flex items-center gap-1.5 min-w-0">
          <ListChecks size={13} className="text-fg-faint shrink-0" />
          <span className="text-[11.5px] font-semibold text-fg-muted">내 업무</span>
          <span className="home-task-count text-[11.5px] font-semibold text-fg tabular-nums">{open.length}건</span>
        </span>
        <ChevronRight size={14} className="home-card-go text-fg-faint shrink-0" />
      </button>
      {/* 줄은 셋까지 + '+N건 더' 한 줄 — 업무가 몇 건이든 이 칸은 더 자라지 않는다. */}
      <div className="home-tasks-body">
        {near.length ? near.map(t => (
          <button
            key={t.id} type="button" onClick={() => onOpenTask(t)}
            className="home-task-row w-full flex items-center gap-3 h-[21px] px-2 -mx-2 rounded-[6px] text-left hover:bg-surface-hover transition-colors"
          >
            <span className="shrink-0 w-11 text-[11.5px] font-bold tabular-nums"
              style={{ color: t.dueDate && t.dueDate < today ? 'var(--app-tag-red-fg)' : 'var(--app-ink-muted)' }}>
              {homeDueLabel(t.dueDate)}
            </span>
            <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-fg truncate">{t.title}</span>
          </button>
        )) : (
          // 사용자가 고른 문구다(§8) — 없는 것을 세는 문장 대신 끝난 상태를 그대로 말한다
          <p className="home-tasks-clear text-[12.5px] text-fg-muted leading-[21px]">다 정리되었어요</p>
        )}
        {more > 0 && (
          <p className="home-tasks-more h-[15px] text-[11.5px] font-semibold text-fg-muted leading-[15px]">{`+${more}건 더`}</p>
        )}
      </div>
    </div>
  );
}

// ── 랜딩 쇼케이스 ───────────────────────────────────────────────────────────
// 카드 넷 아래에 서는 네 블록(예배 · 말씀 · 모임 · 업무). 사용자 요청 2026-09-03 —
// "카드 아래 남는 부분에 랜딩 페이지 같은 인터랙션·모션 그래픽으로 '우리 서비스로
// 이걸 할 수 있다' 느낌." 카드가 **오늘 무엇이 있는지**를 말하고, 이 블록은 **여기서
// 무엇을 할 수 있는지**를 말한다. 그래서 카드가 하나도 없는 날에도 이건 선다.
//
// 숫자를 세지 않는다 — 통계·랭킹은 §1 원칙에서 금지다. 블록은 눌러서 그 화면으로 간다.
//
// **모션은 CSS만으로 돈다.** 자바스크립트 타이머로 프레임을 돌리면 홈이 떠 있는 동안
// 계속 리렌더가 돈다. 키프레임은 `index.css`가 아니라 이 화면이 들고 있다 — 그 파일은
// 이 회차의 소유가 아니어서 건드리지 않았다(옮길 자리는 §4.2의 모션 절이다).
// 규칙은 그대로 지킨다: **transform·opacity만** 움직이고, 색은 토큰만 쓰고,
// `prefers-reduced-motion`이면 전부 멈춘다.
// 문구는 사용자가 준 그대로다(2026-09-03) — 무엇을 할 수 있는지 한 줄이고, 과장·비교가
// 없다(§8). 블록은 **캐릭터 컷 + 제목 + 설명 한 줄**이다.
//
// 모션 그래픽은 만들었다가 **뺐다**(사용자 결정 2026-09-03 — "가독성을 높이든지, 아니면
// 모션 그래픽 자체를 없애자, 그게 나을 것 같다"). 작은 도형이 네 칸에서 각자 돌면
// 시선이 글보다 그쪽으로 가고, 좁은 폭에서는 부품이 서로 겹쳤다. 되살리지 말 것.
//
// 컷은 서로, 그리고 히어로의 sparkle-wave와 겹치지 않게 고른다. 원본 크기(1x)를 함께
// 들고 있는 이유는 width/height로 자리를 미리 잡기 위해서다 — 그림이 늦게 와도 카드가
// 안 밀린다. 실제로 받는 파일은 `srcset`이 화면 배율에 따라 고른다(1x 또는 @2x).
//
// 설명은 **두 도막**이다. 어디서 줄이 나뉘는지를 사용자가 정했다(2026-09-03) — 넓은
// 화면에서 브라우저가 알아서 접으면 '예배 중'과 '예배 노트를' 사이처럼 뜻이 끊기는
// 자리에서 나뉜다. `text-wrap: balance`는 쓰지 않는다(줄 위치가 폭마다 또 달라진다).
// 좁은 화면에서는 `<br>`을 숨겨 한 문장으로 흐르게 두고, 그때는 브라우저가 접는다.
const SHOWCASE = [
  { key: 'worship', to: 'worship', title: '예배', cut: '/chars/heart.webp', w: 187, h: 156,
    desc: ['이번 주 주보를 확인하고', '예배 중 예배 노트를 남겨요'] },
  { key: 'word', to: 'word', title: '말씀', cut: '/chars/book.webp', w: 196, h: 157,
    desc: ['오늘 QT 본문을 읽고', '묵상을 기록해요'] },
  { key: 'groups', to: 'groups', title: '모임', cut: '/chars/coffee.webp', w: 190, h: 153,
    desc: ['우리 순, 우리 동아리의 명단과', '순모임 가이드를 확인해요'] },
  { key: 'work', to: 'dashboard', title: '업무', cut: '/chars/laptop.webp', w: 189, h: 160,
    desc: ['내가 맡은 업무와', '프로젝트를 이어서 진행해요'] },
];

function Showcase({ onNavigate }) {
  const ref = useRef(null);
  // 스크롤로 내려올 때 한 번 나타난다. 처음부터 세워 두면 카드 넷과 함께 이미 다 서
  // 있어서 '내려오다 만나는' 인상이 없다. **한 번 보이면 관찰을 끊는다** — 오르내릴
  // 때마다 다시 나타나면 스크롤이 덜컹거린다(§4.2 — 순번 지연은 첫 마운트만).
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const ob = new IntersectionObserver((rows) => {
      if (rows.some(r => r.isIntersecting)) { setSeen(true); ob.disconnect(); }
    }, { rootMargin: '-40px' });
    ob.observe(ref.current);
    return () => ob.disconnect();
  }, [seen]);

  return (
    <section className="home-show mt-9 md:mt-11" ref={ref}>
      <h3 className="home-show-title text-[12.5px] font-bold text-fg-muted pb-3">더다붓 워크스페이스에서 할 수 있는 것</h3>
      {/* 1열 → 768px 2열 → 1280px 4열. 1024에서 4열로 가면 한 칸이 230px 남짓이라
          설명 한 줄이 세 줄로 접힌다(사용자 요청 2026-09-03 — 폭마다 예쁘게).
          사이는 12px, 넓은 화면에서 16px. */}
      <div className="home-show-grid grid gap-3 lg:gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SHOWCASE.map(({ key, to, title, desc, cut, w, h }, i) => (
          // 차례는 **컷 → 제목 → 설명 → 모션**이다(사용자 정정 2026-09-03). 컷과 모션은
          // 가로 가운데이고 글은 왼쪽 정렬이다 — 글까지 가운데로 두면 네 블록의 설명
          // 길이가 달라서 줄 시작이 제각각이 된다. 모션은 눌리지 않는다(블록 전체가
          // 버튼이다). 설명 길이가 블록마다 달라 모션 줄의 높이를 맞추려면 설명 칸이
          // 남는 자리를 먹어야 한다 — 그래서 블록은 flex 세로 배치이고 설명이 flex-1이다.
          // 호버에서 살짝 떠오르고 화살표가 오른쪽으로 미끄러진다. **transition에
          // `all`을 주지 않는다**(§6-17-b) — 자리(top/left)까지 전이 대상이 되면
          // 그림자·자리 계산이 겹쳐 미끄러진다. transform·box-shadow만 전이한다.
          // 호버가 없는 기기에서는 화살표가 그냥 제자리에 있고, 그래도 '눌러서 가는
          // 것'이 보인다(§8 — hover로만 나타나는 조작은 만들지 않는다).
          <button
            key={key} type="button" onClick={() => onNavigate(to)}
            // **전이 목록에 `translate`가 들어가야 한다.** 테일윈드 4의 `-translate-y-*`는
            // `transform`이 아니라 독립 속성 `translate`를 쓴다 — `transition-[transform]`만
            // 적어 두면 값은 바뀌는데 전이가 걸리지 않아 툭 튄다(실측: transform은
            // 내내 matrix(1,0,0,1,0,0)이었다). `all`은 쓰지 않는다(§6-17-b).
            className={`home-show-item home-show-${key} group ${seen ? 'dc-card' : 'opacity-0'} relative flex flex-col items-center w-full text-center p-5 lg:p-6 ${CARD} transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elevated active:scale-[.995]`}
            style={{ ...CARD_STYLE, animationDelay: `${i * 70}ms` }}
          >
            <ChevronRight size={14}
              className="home-show-go absolute top-4 right-4 text-fg-faint transition-[translate] duration-200 ease-out group-hover:translate-x-[3px]" />
            <img src={cut} srcSet={cutSet(cut)} width={w} height={h}
              alt="" aria-hidden="true" draggable="false" loading="lazy" decoding="async"
              className="home-show-cut block w-auto h-[96px] select-none pointer-events-none" />
            {/* 제목은 가운데다. 화살표는 블록 오른쪽 위 — **제목 줄로 옮기지 않는다**
                (사용자 정정 2026-09-03: "화살표를 옮기라고 하진 않았다"). 제목 줄 오른쪽
                끝 규칙은 위 카드 넷에만 해당한다. */}
            <span className="home-show-name block w-full mt-3 text-[15.5px] font-extrabold text-fg tracking-[-0.3px]">{title}</span>
            {/* 설명은 읽는 줄이다 — 줄 간격을 넉넉히 두고(1.7) keep-all로 낱말이 쪼개지지
                않게 한다(body에 걸려 있다). 줄바꿈 자리는 사용자가 정했다(위 SHOWCASE). */}
            <span className="home-show-desc block w-full mt-1.5 text-[13px] leading-[1.7] text-fg-muted">
              <span className="home-show-l1">{desc[0]}</span>
              <br className="hidden sm:inline" />
              <span className="home-show-l2">{` ${desc[1]}`}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
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
  const year = Number(day.slice(0, 4)) || new Date().getFullYear();

  // **캐시가 있으면 그것을 먼저 그린다**(사용자 요청 2026-09-03 — "매번 스켈레톤이
  // 아니라 캐시된 값이 먼저 보이게"). services/cache.js의 useCached가 마지막에 읽은
  // 값을 즉시 돌려주고 뒤에서 다시 읽어 갈아 끼운다. 스켈레톤은 **캐시가 하나도 없는
  // 첫 진입**에만 나온다. 홈은 하루에 여러 번 여는 첫 화면이라 여기가 가장 크게 체감된다.
  //
  // **갈래를 셋으로 나눈 채로 둔다**(예전 Promise.all 하나에서). 하나가 실패해도 나머지
  // 카드는 서고, 키가 따로라 QT는 날짜별·순은 연도별로 캐시가 걸린다. 실패는 콘솔에
  // 원문으로 남기고 **다시 던진다** — 실패한 값을 캐시에 넣으면 다음 진입에서 그 빈
  // 값이 먼저 그려진다.
  const loud = (what, fn) => async () => {
    try { return await fn(); } catch (e) { console.error(`[home] ${what}을 받지 못했어요:`, e); throw e; }
  };

  // 본문 첫 절까지 같이 싣는다 — 구절 번호만 있으면 카드의 둘째 줄이 늘 비어 있다
  // (사용자 지적 2026-09-03 — "오늘의 QT·내 순은 아래가 빈다"). 성경은 정적 파일이라
  // 게스트에서도 읽히고, 캐시에 함께 들어가서 다음 진입에는 네트워크가 없다.
  const qtQ = useCached(`home:qt:${day}`, loud('오늘 본문', async () => {
    const [qt, entry] = await Promise.all([fetchSchedule(day), fetchMyEntry(day)]);
    let first = '';
    if (qt?.passage_ref) {
      try {
        const p = await loadPassage(qt.passage_ref);
        first = p?.verses?.[0]?.text || '';
      } catch (e) { console.error('[home] 본문 첫 절을 읽지 못했어요:', e); }
    }
    return { qt: qt || null, first, written: !!String(entry?.body || '').trim() };
  }), [day]);

  // **주보 목록은 한 번만 읽는다.** 예전에는 여기서 한 번, 아래 '내 순'에서 지난 주일을
  // 찾느라 또 한 번 불렀다 — 같은 목록을 홈 한 판에 두 번 받아 오는 낭비였다. 이번 주
  // 예배(pickService)와 지난 주일(latestSunday)은 **같은 목록에서 파생되는 값**이라
  // 캐시 키도 하나다. 갈래를 나눈 이유는 실패를 가르기 위해서지 조회를 가르기 위해서가
  // 아니다(이 파일 머리 주석).
  const svcQ = useCached(`home:services:${day}`, loud('예배 목록', async () => {
    const list = await fetchServices();
    return { service: pickService(list, day) || null, latest: latestSunday(list) || null };
  }), [day]);

  // 메타 줄의 재료를 싣는다: 인원 · 지난 주일 참석 수 · 공유된 예배 노트 수.
  // **문구는 화면이 만든다** — 여기서 문장을 만들어 캐시에 넣으면 문구를 고칠 때
  // 지난 캐시가 옛 문장을 먼저 그린다. 남과 견주는 값이 아니라 우리 순의 사실이다
  // (docs/V2.md §1 — 랭킹·비교 금지).
  const sunQ = useCached(`home:sun:${year}`, loud('내 순', async () => {
    const [perms, roster] = await Promise.all([fetchGroupPerms(year), fetchGroupsRoster(year)]);
    const me = perms?.myPerson || null;
    const sun = me && roster ? mySun(me, roster.suns, roster.members) : null;
    if (!sun) return null;
    const people = groupPeople({ people: roster.people, group: sun, members: roster.members });
    // 나눔은 **개수만** 쓴다 — 본문·이름·사진까지 실어 와서 .length를 읽던 자리다.
    const notes = await countSunSharedNotes().catch(() => 0);
    return {
      sun,
      ids: people.map(p => p.id),
      count: people.length,
      leaderName: roster.people.find(p => p.id === sun.leader_person_id)?.name || '',
      notes,
    };
  }), [year]);

  // 지난 주일 주보의 **우리 순** 참석 수. 주보 목록(svcQ)과 명단(sunQ)이 둘 다 와야
  // 셀 수 있어서 갈래를 따로 뒀다 — 내 순 안에서 세면 주보가 도착할 때마다 명단 조회가
  // 통째로 다시 돈다. 발행된 주일 예배가 없거나 내 순이 없으면 null(그 도막을 뺀다).
  const lastSundayId = svcQ.data?.latest?.id || '';
  const sunIds = sunQ.data?.ids || null;
  const attQ = useCached(`home:present:${lastSundayId}:${sunQ.data?.sun?.id || ''}`,
    loud('지난 주일 참석', async () => {
      if (!lastSundayId || !sunIds?.length) return null;
      const ok = await fetchAttendance(lastSundayId).catch(() => []);
      const mine = new Set(sunIds);
      return ok.filter(id => mine.has(id)).length;
    }), [lastSundayId, sunIds?.join(',') || '']);

  // 홈은 첫 화면이라 여기가 가장 오래 떠 있다 — 주보 발행·나눔·명단이 바뀌면 카드
  // 셋을 같이 다시 읽는다(0049 · services/liveV2.js).
  useLiveRefresh('home', () => { qtQ.refresh(); svcQ.refresh(); sunQ.refresh(); attQ.refresh(); });

  // 셋 다 캐시가 없을 때만 스켈레톤이다 — 하나라도 값이 있으면 그 카드를 먼저 세운다.
  const firstLoad = qtQ.loading && svcQ.loading && sunQ.loading;
  const church = firstLoad ? null : {
    qt: qtQ.data?.qt || null,
    written: !!qtQ.data?.written,
    service: svcQ.data?.service || null,
    sun: sunQ.data?.sun || null,
    sunCount: sunQ.data?.count || 0,
    leaderName: sunQ.data?.leaderName || '',
    sunPresent: attQ.data ?? null,
    sunNotes: sunQ.data?.notes || 0,
    qtFirst: qtQ.data?.first || '',
  };

  const name = currentUser?.name || '';
  const today = ISO_TODAY();

  // 있는 카드만 세운다. 순서는 docs/V2.md §3 그대로 — 오늘의 QT · 이번 주 예배 ·
  // 내 업무 · 내 순. 등장 지연은 **실제로 선 자리**를 따른다(빠진 카드가 있어도
  // 한 칸씩 차례로 들어온다, §4.2).
  const cards = [];
  if (church?.qt) {
    cards.push(['qt', (delay) => (
      // 초점은 오늘 구절, 메타는 본문 첫 절이다. 묵상을 쓴 날에는 그 줄 끝에 한 마디를
      // 붙인다 — 안 쓴 날에는 아무 말도 하지 않는다(없는 것을 굳이 말하지 않는다).
      // 잔디와 마찬가지로 남과 견주지 않는다.
      <LinkCard className="home-qt" label="오늘의 QT" icon={BookOpen} delay={delay} title="말씀으로"
        onOpen={() => onNavigate('word')}
        focus={<span className="home-qt-ref">{church.qt.passage_ref}</span>}
        meta={
          <span className={`home-qt-first ${ONE_LINE}`}>
            {church.qtFirst || church.qt.label || ''}
            {church.written && <span className="home-qt-done"> · 묵상 기록함</span>}
          </span>
        } />
    )]);
  }
  if (church?.service) {
    const s = church.service;
    // 초점은 **설교 제목**이다. 예배 종류·날짜·채워진 만큼의 담당자·찬양 수는 메타 한
    // 줄로 이어 붙인다 — 예전에는 칩 · 날짜 · 제목 · 부제가 각각 줄이라 넉 줄이었다.
    // 칩(둥근 배경)을 쓰지 않는 이유도 같다: 줄마다 무게가 생겨 초점이 흐려진다.
    // 작성 중인 주보는 편집 자격자에게만 온다 — 거르는 것은 화면이 아니라 RLS다(0036).
    const meta = [
      kindLabel(s.kind),
      homeDateLabel(s.service_date),
      (s.roles || []).length ? `담당자 ${s.roles.length}` : '',
      (s.songs || []).length ? `찬양 ${s.songs.length}` : '',
      // 찬양을 싣는 줄이라 인도자도 같은 줄에 붙는다(0044) — 줄을 늘리지는 않는다
      s.praise_leader ? `인도 ${s.praise_leader}` : '',
    ].filter(Boolean).join(' · ');
    cards.push(['worship', (delay) => (
      <LinkCard className="home-worship" label="이번 주 예배" icon={Church} delay={delay} title="예배로"
        onOpen={() => onNavigate('worship')}
        focus={<span className="home-worship-title">{s.title || '설교 제목 미정'}</span>}
        meta={
          <span className={`home-worship-sub ${ONE_LINE}`}>
            {s.status !== 'published' && <span className="home-worship-draft font-semibold">작성 중 · </span>}
            {meta}
          </span>
        } />
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
    // 초점은 순 이름 + 순장이고, 메타는 우리 순의 사실 한 줄이다 — 인원 · 지난 주일
    // 참석 · 공유된 예배 노트 수. 남과 견주는 값이 아니다(docs/V2.md §1).
    const meta = [
      `${church.sunCount}명`,
      church.sunPresent != null ? `지난 주일 ${church.sunPresent}명 참석` : '',
      church.sunNotes ? `공유 노트 ${church.sunNotes}` : '',
    ].filter(Boolean).join(' · ');
    cards.push(['sun', (delay) => (
      <LinkCard className="home-sun" label="내 순" icon={Users} delay={delay} title="모임으로"
        onOpen={() => onNavigate('groups')}
        focus={
          <span className="flex items-baseline gap-2">
            <span className={`home-sun-name ${ONE_LINE}`}>{church.sun.name}</span>
            {church.leaderName && (
              <span className="home-sun-leader shrink-0 text-[11.5px] font-semibold text-fg-muted">순장 {church.leaderName}</span>
            )}
          </span>
        }
        meta={<span className={`home-sun-meta ${ONE_LINE}`}>{meta}</span>} />
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

        {/* 캐릭터 한 장 — 글이 다 들어온 뒤에 선다(§4.2 · 글의 .dc-card가 .28s다).
            width/height를 적어 두면 그림이 도착하기 전에도 이 자리가 확보되어 아래
            카드가 밀리지 않는다. eager: 첫 화면에 바로 보이는 그림이라 미루면 홈이
            한 번 비어 보인다. decoding=async: 디코딩이 첫 페인트를 붙잡지 않게. */}
        <img
          src={HERO_CUT.src} srcSet={cutSet(HERO_CUT.src)}
          width={HERO_CUT.w} height={HERO_CUT.h}
          alt="" aria-hidden="true" draggable="false" loading="eager" decoding="async"
          className="home-cut dc-card block mx-auto mt-4 md:mt-5 w-auto h-[112px] md:h-[140px] select-none pointer-events-none"
          style={{ animationDelay: '280ms' }}
        />
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

      <Showcase onNavigate={onNavigate} />

      {/* 대표 홈페이지의 발문 — **글자가 아니라 로고**다(사용자 요청 2026-09-03).
          자산과 테마 분기는 헤더(layout.jsx)가 쓰는 것을 그대로 쓴다: 라이트·다크
          두 장을 다 두고 `dark:` 변형으로 가른다(index.css의 @custom-variant dark).
          자바스크립트로 테마를 읽어 한 장만 고르면, 헤더의 토글로 테마를 바꿀 때
          이 그림만 다시 그려지지 않는다. */}
      <p className="home-mark mt-9 flex justify-center">
        <img src={logoLight} width="640" height="469" alt="더다붓" decoding="async"
          className="home-mark-logo h-6 w-auto opacity-60 dark:hidden" />
        <img src={logoDark} width="640" height="469" alt="더다붓" decoding="async"
          className="home-mark-logo h-6 w-auto opacity-60 hidden dark:block" />
      </p>
    </div>
  );
}
