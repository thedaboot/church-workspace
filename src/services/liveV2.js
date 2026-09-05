import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';
import { dropCache } from './cache.js';

// ============================================================================
// v2 화면(예배·말씀·모임·명단·홈)의 실시간 — "변경 신호 → 캐시 무효화 + 재조회"
// ----------------------------------------------------------------------------
// 0049 전까지 v2 표는 Realtime 발행 목록에 하나도 없었고 구독도 0개였다. 그래서
// **남이 주보를 발행해도, 나눔을 올려도, 명단의 직분을 고쳐도 그 화면에 머무는 동안은
// 영영 몰랐다** — 나갔다 들어와야 갱신되고 그 첫 프레임마저 옛 캐시였다.
//
// **행 단위 리듀서를 만들지 않는다.** cloudSync.subscribeWorkspace는 카드 1건을 병합해
// 넣지만(§6-21), 여기 표들은 화면이 통째로 다시 읽어도 싼 목록이고 서로 얽혀 있다
// (출석 하나가 주보 상세·홈 카드·내 순 소식을 같이 바꾼다). 그래서 이 파일이 하는 일은
// 딱 두 가지다:
//   ① 어떤 표가 바뀌었는지 보고 **그 표에 딸린 캐시 접두를 비운다**(항상 — 화면이
//      떠 있든 아니든. 안 비우면 다음 진입의 첫 프레임이 옛 값이다)
//   ② 그 화면이 **지금 떠 있을 때만** 재조회를 시킨다(Egress — 안 보는 화면을 위해
//      쿼리를 쏘지 않는다. 그 화면은 다음 진입에서 비워진 캐시 때문에 어차피 읽는다)
//
// 채널은 하나(`church-v2`)다. 소켓은 cloud.subscribeAll·presence와 같은 것을 쓰므로
// 재접속·좀비 소켓 되살리기는 presence.js가 이미 하는 것을 그대로 얻는다(§4.9).
// 여기서 더 하는 것은 **끊겼다 다시 붙었을 때 전부 한 번 다시 읽는 것**이다 —
// 끊겨 있던 동안의 이벤트는 오지 않기 때문이다(폰이 백그라운드에 있다 깨어난 경우).
//
// 게스트 모드(supabase 없음)와 로그인 전에는 아무 일도 하지 않는다.
// ============================================================================

const TOPIC = 'church-v2';
// 연속 이벤트를 한 번의 재조회로 묶는다 — 주보 저장 한 번이 services UPDATE 여러 건을
// 만들고(자동 저장), 순 편성 한 번이 group_members를 여러 줄 갈아 끼운다.
const DEBOUNCE_MS = 300;

// 표 → 비울 캐시 접두(services/cache.js의 실제 키 모양).
// **kind는 접두의 첫 마디다** — 표를 화면 이름으로 한 번 더 적어 두면 한쪽만 고쳐서
// 어긋난다. 'worship:svc'는 주보 상세 한 벌(명단·출석·노트·송폼)이고 'worship'은
// 목록까지 포함한다.
// 홈은 **접두를 쪼개지 않는다**('home:qt'가 아니라 'home'). 카드 넷이 다 작은 조회라
// 통째로 비워도 싸고, 쪼개 두면 홈이 카드를 하나 더 붙이거나 열쇠 이름을 바꿀 때
// 여기가 조용히 낡는다(실제로 회차 중에 home:worship → home:services로 바뀌었다).
const TABLE_CACHE = {
  services:          ['worship', 'home'],
  attendance:        ['worship:svc', 'home', 'groups:mine'],
  service_notes:     ['worship:svc', 'home', 'groups:mine'],
  qt_entries:        ['word:qt', 'home'],
  // 명단·순이 바뀌면 출석 명단도 바뀐다 — 모임·명단·주보 상세·홈이 같이 낡는다
  people:            ['groups', 'roster', 'worship:svc', 'home'],
  people_roles:      ['groups', 'roster', 'worship:svc', 'home'],
  groups:            ['groups', 'roster', 'worship:svc', 'home'],
  group_members:     ['groups', 'roster', 'worship:svc', 'home'],
  club_applications: ['groups', 'roster', 'worship:svc', 'home'],
};

export const V2_TABLES = Object.keys(TABLE_CACHE);
export const prefixesOf = (table) => TABLE_CACHE[table] || [];
export const kindsOf = (table) => [...new Set(prefixesOf(table).map(p => p.split(':')[0]))];
export const ALL_KINDS = [...new Set(V2_TABLES.flatMap(kindsOf))];

// ── 신호 큐 (순수 — 검사가 이것만 떼어 돌린다) ───────────────────────────────
// 표 이름을 밀어 넣으면 캐시를 비우고, 디바운스가 끝나면 **모아 둔 kind들을 한 번에**
// 넘긴다. 모르는 표는 아무 일도 하지 않는다(false).
export function createSignalQueue({ drop, notify, delay = DEBOUNCE_MS }) {
  const pending = new Set();
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const kinds = [...pending];
      pending.clear();
      if (kinds.length) notify(kinds);
    }, delay);
  };
  return {
    push(table) {
      const prefixes = prefixesOf(table);
      if (!prefixes.length) return false;
      prefixes.forEach(drop);
      kindsOf(table).forEach(k => pending.add(k));
      arm();
      return true;
    },
    // 끊겼다 다시 붙었을 때 — 그동안의 이벤트는 오지 않았다
    pushAll() {
      V2_TABLES.forEach(t => prefixesOf(t).forEach(drop));
      ALL_KINDS.forEach(k => pending.add(k));
      arm();
    },
    pendingKinds: () => [...pending],
  };
}

// ── 막아 둔 동안의 신호 (순수 — 검사가 이것만 떼어 돌린다) ──────────────────
// enabled가 false인 동안 온 신호는 **버리지 않고 기억**했다가, 다시 켜질 때 한 번만
// 흘린다. 여러 번 왔어도 한 번이다(재조회는 한 번이면 최신이다).
export function createGate(call) {
  let missed = false;
  return {
    signal(enabled) { if (enabled) call(); else missed = true; },
    enable(enabled) { if (!enabled || !missed) return; missed = false; call(); },
    missed: () => missed,
  };
}

// ── 구독자 명부 ─────────────────────────────────────────────────────────────
const subs = new Map();   // kind → Set<fn>

function fanOut(kinds) {
  for (const kind of kinds) {
    for (const fn of subs.get(kind) || []) {
      // 한 화면의 재조회가 실패해도 나머지는 돌아야 한다
      try { fn(); } catch (e) { console.error(`[liveV2] ${kind} 재조회 실패:`, e); }
    }
  }
}

const queue = createSignalQueue({ drop: (p) => dropCache(p), notify: fanOut });

function subscribeKind(kind, fn) {
  let set = subs.get(kind);
  if (!set) { set = new Set(); subs.set(kind, set); }
  set.add(fn);
  void ensureChannel();
  return () => { set.delete(fn); };
}

// ── 채널 ────────────────────────────────────────────────────────────────────
// 한 번 열면 페이지가 살아 있는 동안 닫지 않는다. 화면을 나가도 열어 두는 쪽이 맞다 —
// 이벤트를 받아야 **안 보는 화면의 캐시도 비울 수 있고**(그게 이 파일의 절반이다),
// 탭을 옮길 때마다 채널을 여닫으면 재구독 왕복만 늘어난다. 재조회는 어차피 구독자가
// 있는 kind에만 간다.
let channel = null;
let opening = false;
let wasDown = false;

async function ensureChannel() {
  const c = supabase;
  if (!c || channel || opening) return;     // 게스트 모드에서는 여기서 끝난다
  opening = true;
  try {
    const { data } = await c.auth.getSession();
    // 로그인 전에는 열지 않는다(RLS가 아무것도 안 흘려보낸다) — 다음 마운트에서 다시 본다
    if (!data?.session || channel) return;
    // 같은 topic 채널이 남아 있으면 걷어낸다 — supabase-js는 같은 topic이면 기존
    // 인스턴스를 돌려주고, 이미 subscribe된 채널에 .on을 붙이면 예외가 난다(§6-3).
    c.getChannels().filter(ch => ch.topic === TOPIC || ch.topic === `realtime:${TOPIC}`)
      .forEach(ch => c.removeChannel(ch));
    let ch = c.channel(TOPIC);
    for (const table of V2_TABLES) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table },
        (payload) => queue.push(payload?.table || table));
    }
    channel = ch;
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // 끊겨 있던 동안의 이벤트는 오지 않는다 — 다시 붙는 순간 전부 한 번 읽는다
        if (wasDown) { wasDown = false; queue.pushAll(); }
        return;
      }
      // presence.js와 같은 규칙: 되살리는 일은 라이브러리와 presence의 심장박동이
      // 한다(§4.9). 여기서는 "끊겼었다"만 기억한다.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDown = true;
    });
  } catch (e) {
    console.error('[liveV2] 실시간 채널을 열지 못했어요:', e);
  } finally {
    opening = false;
  }
}

// ── 화면이 쓰는 훅 ──────────────────────────────────────────────────────────
// kind의 신호가 오면 refresh()를 부른다(마운트 중에만). useCached가 돌려주는 refresh를
// 그대로 넘기면 된다.
//
//   useLiveRefresh('worship', invalidate);
//   useLiveRefresh('worship', invalidate, screen === 'list');   // 편집 중에는 건너뛴다
//
// enabled가 false인 동안 온 신호는 **버리지 않고 기억**했다가 다시 켜질 때 한 번만
// 흘린다 — 편집 중인 주보를 재조회로 덮지 않으면서, 나오는 순간 최신이 되게.
// refresh·enabled는 ref로 들고 있어서 인라인 화살표를 그냥 넘겨도 재구독이 없다.
export function useLiveRefresh(kind, refresh, enabled = true) {
  const fnRef = useRef(refresh);
  const onRef = useRef(enabled);
  const gate = useRef(null);
  if (!gate.current) gate.current = createGate(() => fnRef.current?.());
  useEffect(() => { fnRef.current = refresh; onRef.current = enabled; });

  useEffect(() => subscribeKind(kind, () => gate.current.signal(onRef.current)), [kind]);
  useEffect(() => { gate.current.enable(enabled); }, [enabled]);
}

// 읽기가 useCached가 아니라 effect에 들어 있는 화면용(membersView의 명단) — 신호가
// 올 때마다 **숫자 하나**가 커진다. 그 값을 effect의 deps에 넣으면 그때 다시 읽는다.
// 새 객체가 아니라 숫자여야 한다(§4.9 무한 리렌더).
export function useLiveTick(kind) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeKind(kind, () => setTick(t => t + 1)), [kind]);
  return tick;
}
