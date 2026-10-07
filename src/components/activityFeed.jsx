import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Avatar } from './Avatar.jsx';
import { agoLabel } from '../utils.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { useStore, ACTIVITY_FEED_LIMIT } from '../store/workspaceStore.js';
import { selectMembers, selectCurrentUser } from '../store/selectors.js';
import { useSeenBase } from '../services/sinceSeen.js';
import { groupFeed, extraFeedRows, mixFeed, FEED_FIRST, FEED_STEP } from '../services/traces.js';
import { loadFeedExtras, loadMoreActivity } from '../services/feedExtras.js';
import { setEntryQuery } from '../services/entryQuery.js';
import { Card } from '../views/dashboardParts.jsx';

// 대시보드 '청년' 칸 끝의 최근 활동(views/dashboardView.jsx만 쓴다 · 2026-10-07 dashboardParts에서 갈랐다).
// ── 최근 활동 피드 (0020) ─────────────────────────────────────────────────────
// activity는 이미 쌓이고 있었는데 업무 창 안에만 갇혀 있었다 — 꺼내기만 하면 되는
// 데이터다. 클라우드는 서버 피드(activityFeed), 게스트는 tasks의 activityLog에서
// 파생한다(selectActivityFeed). 카드 제목은 스토어의 tasks에서 찾는다 — 피드에 제목을
// 박아 두면 제목을 바꿨을 때 피드만 옛 이름으로 남는다.
//
// **카드별로 묶는다.** 한 카드를 다듬으면 기록이 줄줄이 생겨서(제목·내용·상태가 각
// 한 줄) 같은 제목이 여덟 줄 반복됐고, 그게 대시보드를 길게 만든 주범이었다(사용자
// 지적). 카드마다 가장 최근 한 줄 + '외 N건'으로 접고, 처음에는 다섯 줄만 그린다.
// '내 업무만 보기'는 접었다 — 이 칸의 값은 남들이 움직이는 게 보이는 것이라,
// 내 것만 남기면 참여를 부르는 자리가 내 메아리 방이 된다.
//
// '더보기'(사용자 결정 2026-09-25 · 목업 mockup-traces 4 권장안): 다섯 줄 아래 한 줄, 누르면 창을 띄우지
// 않고 **그 자리에서 열 줄씩** 편다. 편 뒤에는 '접기'. 펴고 접는 높이는 grid-template-rows 0fr↔1fr
// (TopNav 탭 줄과 같은 기법 · 240ms · reduced-motion이면 없다 · index.css `.dc-feed-*`).
// **업무 밖 움직임도 섞는다** — 주보 발행 · 동아리 모임 일정 · 더다붓에 나눈 QT 묵상. 같은 줄 모양
// (얼굴 · 무엇 · 누가 무엇을 · 언제)이고 문장은 알림 문구다(services/traces.extraFeedRows · feedExtras).
// **지난 방문 이후 남이 움직인 줄**에는 왼쪽에 옅은 점(traces.isFreshMove · 기준 시각은 sinceSeen) —
// 다음에 앱을 열 때까지 둔다. 카드별로 묶는 규칙(groupFeed)도 traces.js로 옮겼다(점 판정과 한 벌).
const DEEP_ACTIVITY = 200;   // '더보기'를 처음 누를 때 활동을 이만큼 더 읽는다(클라우드)
const FEED_HELD = ACTIVITY_FEED_LIMIT;   // 스토어 피드의 상한(workspaceStore)

export function ActivityFeed({ feed, tasksById, onOpenTask, onNavigate }) {
  // 줄 오른쪽의 'N분 전'이 굳지 않게 — 대시보드는 켜 둔 채로 오래 보는 화면이다.
  // 훅은 조건부 return보다 **먼저** 불러야 한다(리액트 규칙).
  useMinuteTick();
  const base = useSeenBase();
  const members = useStore(selectMembers);
  const me = useStore(selectCurrentUser);
  const [extras, setExtras] = useState(null);
  const [deep, setDeep] = useState(null);       // '더보기' 뒤 더 읽은 활동(클라우드)
  const [count, setCount] = useState(FEED_FIRST);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  useEffect(() => {
    let alive = true;
    loadFeedExtras({ guestName: me.name }).then(d => { if (alive) setExtras(d); })
      .catch(e => console.warn('[feed] 업무 밖 움직임을 읽지 못했어요:', e));
    return () => { alive = false; clearTimeout(closeTimer.current); };
  }, [me.name]);

  const nameById = useMemo(() => new Map(members.map(m => [m.id, m.name])), [members]);
  const rows = useMemo(() => {
    // 활동: 더 읽은 것이 있으면 합친다(같은 줄은 스토어 쪽 — 실시간으로 얹힌 최신 줄)
    let act = feed;
    if (deep) {
      const have = new Set(feed.map(a => a.id));
      act = [...feed, ...deep.filter(a => !have.has(a.id))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    }
    // 읽은 활동이 상한에 닿았으면 그보다 옛날의 업무 밖 줄은 세우지 않는다 — 활동이 비어 있는 구간에
    // 주보·모임만 서면 그동안 업무에서 아무 일도 없었던 것처럼 읽힌다.
    const full = act.length >= (deep ? DEEP_ACTIVITY : FEED_HELD);
    const oldest = full && act.length ? Date.parse(act[act.length - 1].at) : -Infinity;
    const ex = extras ? extraFeedRows({
      services: extras.services, meetings: extras.meetings, qts: extras.qts,
      nameOf: (id) => nameById.get(id) || (id === me.name ? me.name : ''),
      groupName: (id) => extras.groupNames[id] || '',
      passageOf: (d) => extras.passages[d] || '',
    }).filter(r => Date.parse(r.at) >= oldest) : [];
    return mixFeed(groupFeed(act, base), ex, base);
  }, [feed, deep, extras, base, nameById, me.name]);

  if (!rows.length) return null;

  const more = () => {
    setCount(c => c + FEED_STEP);
    // 활동은 스토어에 서른 줄뿐이다 — 처음 펼 때 한 번 더 깊게 읽는다(업무 밖 줄과 시간이 맞게)
    if (!deep && feed.length >= FEED_HELD) {
      loadMoreActivity(DEEP_ACTIVITY).then(list => {
        if (list) setDeep(list.map(a => ({
          id: a.id, actorId: a.actor_id || null, actorName: nameById.get(a.actor_id) || '이름 미상',
          action: a.action, cardId: a.card_id || null, projectId: a.project_id || null, at: a.created_at,
        })));
      }).catch(e => console.warn('[feed] 활동을 더 읽지 못했어요:', e));
    }
  };
  const folded = () => { clearTimeout(closeTimer.current); setClosing(false); setCount(FEED_FIRST); };
  const fold = () => {
    if (prefersReducedMotion()) { folded(); return; }
    setClosing(true);
    // transitionend를 못 받는 경우(탭이 뒤로 가 있는 동안 등)의 안전망
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(folded, 400);
  };

  const openLink = (link) => {
    const q = link.slice(link.indexOf('?') + 1);
    setEntryQuery(q);
    const p = new URLSearchParams(q).get('p');
    if (p) onNavigate?.(p);
  };

  const row = (a, first) => {
    const task = a.kind ? null : (a.cardId ? tasksById[a.cardId] : null);
    const head = a.kind ? a.head : (task ? task.title : a.actorName);
    const line = a.kind ? a.text : `${task ? `${a.actorName}님이 ` : ''}${a.action}`;
    const inner = (
      <>
        {a.fresh && <span aria-hidden data-fresh-dot="" className="absolute left-px top-[15px] w-[5px] h-[5px] rounded-full bg-accent opacity-60" />}
        <Avatar name={a.actorName} className="flex w-[22px] h-[22px] text-[10.5px] mt-px" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 min-w-0">
            {/* 카드가 지워졌으면 제목 없이 문장만 남는다 — 기록은 지워지지 않는다.
                min-w-0: flex 항목은 기본 최소 폭이 내용 폭이라, 없으면 긴 제목이
                시간 라벨을 오른쪽 끝에서 밀어낸다(줄마다 시간 x가 달라진다). */}
            <span className="text-[11px] font-semibold text-fg truncate min-w-0">{head}</span>
            <span className="flex-1" />
            <span className="text-[10px] text-fg-muted tabular-nums whitespace-nowrap shrink-0">{agoLabel(a.at)}</span>
          </span>
          <span className="block text-[11px] text-fg-muted truncate">
            {line}
            {a.more > 0 && <span className="text-fg-muted"> 외 {a.more}건</span>}
          </span>
        </span>
      </>
    );
    // 줄 사이 선은 **첫 줄만 뺀다** — 편 묶음은 부모가 달라 first-of-type이 묶음마다 다시 걸린다
    const edge = first ? '' : ' border-t border-line/60';
    const go = a.kind ? () => openLink(a.link) : (task ? () => onOpenTask(task) : null);
    // 누를 곳이 있으면 버튼이다. 없으면(지워진 카드) 그냥 줄이다
    return go ? (
      /* dc-row(줄 등장 애니메이션)를 쓰지 않는다 — 이 카드는 PeopleStrip처럼 정적인
         부속 정보이고, .dc-row는 마감 목록의 "행"이라는 뜻으로 검사들도 그 클래스로
         목록을 찾는다(여기 붙이면 피드 줄이 마감 목록 행으로 세어진다). */
      <button key={a.id} type="button" onClick={go} data-feed-row={a.kind || 'activity'}
        /* 폭은 calc(100%+16px)이어야 한다. w-full(=100%)에 -mx-2를 얹으면 왼쪽으로만 8px
           밀려 오른쪽이 16px 빈다(사용자가 지적한 공백). 그렇다고 w-full을 빼면 button은
           폼 요소라 display:flex여도 **내용 폭으로 줄어든다** — 줄마다 폭이 달라져 시간
           라벨이 제각각 섰다. 음수 마진만큼을 폭에 직접 더해 준다. */
        className={`relative w-[calc(100%+16px)] flex items-start gap-2 py-[7px] -mx-2 px-2 rounded-md text-left hover:bg-surface-hover transition-colors${edge}`}>
        {inner}
      </button>
    ) : (
      /* 버튼 줄과 같은 박스(-mx-2 px-2)를 준다 — 다르면 이 줄만 16px 좁아져서
         시간 라벨이 다른 줄과 다른 x에 선다(정렬이 흐트러진 원인 중 하나) */
      <div key={a.id} data-feed-row="activity" className={`relative flex items-start gap-2 py-[7px] -mx-2 px-2${edge}`}>
        {inner}
      </div>
    );
  };

  const shown = rows.slice(0, count);
  const chunks = [];
  for (let i = FEED_FIRST; i < shown.length; i += FEED_STEP) chunks.push(shown.slice(i, i + FEED_STEP));
  const hasMore = rows.length > count;
  const FEED_BTN = 'flex-1 py-2 rounded-md text-[11.5px] font-semibold text-accent-text hover:bg-surface-hover transition active:scale-[0.99] disabled:opacity-40';
  return (
    <Card className="px-4 py-[15px]">
      <div className="pb-2">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">최근 활동</h3>
      </div>
      {shown.slice(0, FEED_FIRST).map((a, i) => row(a, i === 0))}
      {chunks.length > 0 && (
        <div className="dc-feed-fold" data-closing={closing ? 'true' : undefined}
          onTransitionEnd={(e) => { if (closing && e.target === e.currentTarget && e.propertyName === 'grid-template-rows') folded(); }}>
          <div className="min-h-0 overflow-hidden">
            {chunks.map((chunk, ci) => (
              // 새로 편 열 줄만 0fr → 1fr로 자란다(이미 편 묶음은 그대로)
              <div key={ci} className="dc-feed-chunk">
                <div className="min-h-0 overflow-hidden">{chunk.map(a => row(a, false))}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(hasMore || count > FEED_FIRST) && (
        <div className="flex -mx-2 mt-1">
          {hasMore && <button type="button" data-feed-more="" onClick={more} className={FEED_BTN}>더보기</button>}
          {count > FEED_FIRST && <button type="button" data-feed-fold="" onClick={fold} disabled={closing} className={FEED_BTN}>접기</button>}
        </div>
      )}
    </Card>
  );
}
