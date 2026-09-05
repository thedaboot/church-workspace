import { useSyncExternalStore } from 'react';
import { supabase } from './supabaseClient.js';
import { nextWhereMeta } from '../utils.js';

// ============================================================================
// 지금 접속해 있는 사람 · 지금 누가 어디를 보고 있나 (Realtime presence)
// ----------------------------------------------------------------------------
// 워크스페이스 스토어에 넣지 않는 이유: LOAD_STATE가 상태를 통째로 갈아치우는데,
// 접속 목록은 서버 스냅샷이 아니라 연결 상태라 그 흐름에 섞이면 재조회마다 사라진다.
// 값 하나짜리 외부 스토어가 가장 작다.
//
// presence는 임의의 값을 같이 실어 나른다 — 그래서 "내가 지금 보고 있는 곳"
// (`{ projectId, cardId }`)을 여기에 얹는다. **DB에도 서버에도 아무것도 안 남는다.**
// 연결이 끊기면 서버가 바로 지우므로 나가면 얼굴도 같이 사라진다. 이것을 기록으로
// 남기거나 "며칠 전에 봤다"로 바꾸는 순간 §7의 '카드별 조회 추적'이 된다.
//
// 채널을 cloud.js가 아니라 여기서 소유한다: 보고 있는 곳이 바뀔 때마다 track()을 다시
// 불러야 하는데 그러려면 채널 인스턴스를 들고 있어야 한다(cloud.js의 subscribePresence는
// 붙은 사람 id만 돌려주고 채널을 감춘다).
// ============================================================================

const TOPIC = 'presence-workspace';

let online = new Set();     // profile id들. 게스트 모드에서는 언제나 빈 집합
let views = [];             // [{ id, projectId, cardId, at, seq }] — 사람마다 열어 둔 창 수만큼
let meId = null;            // 내 profile id(= auth user id). 본인 얼굴을 빼는 데 쓴다
const listeners = new Set();
const NO_VIEWS = [];

// getSnapshot은 같은 참조를 돌려줘야 한다 — 여기서만 교체되므로 안전하다
function setPresence(entries, me = null) {
  const list = entries && entries.length ? entries : NO_VIEWS;
  online = new Set(list.map(e => e.id));
  views = list;
  meId = me;
  listeners.forEach(l => l());
}

// 내 id는 채널에 붙기 직전에 정해지고(첫 sync보다 먼저다) 화면이 다시 그려질 이유가
// 아니라서 훅으로 두지 않는다.
export const presenceMe = () => meId;

const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };

export function usePresence() {
  return useSyncExternalStore(subscribe, () => online);
}

// 누가 어디를 보고 있나 — 고르는 일은 utils.viewersOf(순수 함수)가 한다.
// **파생 배열을 여기서 만들면 안 된다**: useSyncExternalStore는 ===로 비교해서
// 매번 새 배열이면 무한 리렌더가 된다(§4.9).
export function usePresenceViews() {
  return useSyncExternalStore(subscribe, () => views);
}

// ── 채널 ────────────────────────────────────────────────────────────────────
let channel = null;
let joined = false;
// 내가 지금 보고 있는 곳 + 그 자리에 **언제** 왔나(presence에 그대로 실린다).
// **`at`은 "자리를 옮긴 시각"이지 "연결이 살아 있다고 알린 시각"이 아니다**(2026-09-06).
// 예전에는 track할 때마다 `Date.now()`를 새로 찍었고 재접속(SUBSCRIBED가 다시 불림)에서도
// 그랬다. presence 열쇠가 user.id라 한 사람의 탭·기기 meta가 한 열쇠에 같이 사는데,
// **옛 프로젝트를 켜 둔 백그라운드 탭이 재접속하는 것만으로 at이 가장 커져**
// `utils.viewersOf`(사람마다 at 최댓값 하나)에서 지금 보고 있는 탭을 이겼다 — 사용자가 본
// "임원진 회의를 보고 있는데 가을 체육대회로 나온다"가 이것이다(2026-09-05).
// 지금은 자리가 **실제로 바뀔 때만** 새로 찍고(`utils.nextWhereMeta`), 재-track은 그때
// 만든 meta를 **그대로** 다시 보낸다 — 자리가 안 바뀌었으니 나이도 안 바뀐다.
let meta = { projectId: null, cardId: null, at: 0, seq: 0 };

// **realtime-js 2.110.8의 presence 버그를 여기서 되돌린다.**
// presenceAdapter는 join·leave 콜백을 부르기 전에 meta를 `transformState`로 훑으면서
// `phx_ref`를 지우고 `presence_ref`로 옮긴다. 그런데 그 meta 객체들은 **로컬 presence
// 상태 안에 그대로 들어 있는 바로 그 객체들**이라(phoenix syncDiff가 참조로 옮겨 담는다),
// 한 번 join diff를 받은 사람의 meta는 `phx_ref`를 영영 잃는다. 그다음부터 서버가 보내는
// leave diff는 ref로 짝을 찾지 못해 **아무것도 지우지 못한다.** 결과:
//   · 자리를 옮길 때마다 meta가 지워지지 않고 **쌓인다**(track 4번 → meta 4개)
//   · **나간 사람이 영영 안 사라진다** — 브라우저를 닫아도 남들 화면에는 계속 '접속 중'이고
//     얼굴도 마지막에 보던 자리에 붙어 있다. 새로고침해야 없어진다(사용자 지적 2026-08-30).
// 노드 하네스로 재현·확인했다: 고치기 전 = meta 1→4로 쌓이고 나가도 4개 그대로,
// 고친 뒤 = 언제나 meta 1개, 나가면 0개.
// 콜백이 넘겨주는 `currentPresences`가 **바로 그 살아 있는 meta 객체들**이라 여기서
// 되살릴 수 있다. join이 leave보다 먼저 처리되므로(같은 diff 안에서) join에서 되살려야
// 그 자리의 leave가 먹는다 — sync에서만 고치면 늦는다.
// 라이브러리가 고쳐지면 `phx_ref`가 살아 있어서 이 함수는 아무 일도 하지 않는다.
const healRefs = ({ currentPresences }) => {
  for (const m of currentPresences || []) {
    if (m && m.phx_ref === undefined && m.presence_ref !== undefined) m.phx_ref = m.presence_ref;
  }
};

// presenceState(): { [profile id]: [{ presence_ref, …실어 보낸 값 }, …] }
// 메타는 그 사람이 열어 둔 창 수만큼 온다(폰과 노트북이 서로 다른 곳을 볼 수 있다) —
// 여기서는 그대로 펴서 넘기고, **어느 하나를 고르는 일은 `utils.viewersOf`가 한다**
// (`at`이 가장 큰 것 하나 · 순수 함수라 노드에서 검사한다). 전부 그리면 같은 얼굴이
// 두 프로젝트 탭·두 업무 카드에 동시에 뜬다(사용자 지적 2026-08-30).
// `at`은 track할 때 실어 보낸 시각이고, 없는 옛 meta는 0으로 본다(배포 전환기).
const entriesOf = (state) => Object.entries(state || {}).flatMap(([id, metas]) =>
  (metas && metas.length ? metas : [{}]).map(m => ({
    id, projectId: m.projectId || null, cardId: m.cardId || null,
    at: Number(m.at) || 0, seq: Number(m.seq) || 0,
  })));

// ── 탭이 다시 보일 때 (모바일에서 오래 백그라운드에 있다가 돌아오는 경우) ──────
// 노드 하네스 실측(2026-08-30)으로 자동으로 되는 것과 안 되는 것을 갈랐다:
//  · 소켓이 **깨끗하게 끊기면** supabase-js가 스스로 1.4초 만에 다시 붙고, 채널의
//    subscribe 콜백이 SUBSCRIBED로 **다시 불린다** — 아래 재-track이 그대로 실려
//    자리까지 복구된다. 여기에 덧댈 코드가 없다.
//  · 안 되는 것은 **좀비 소켓**이다. readyState는 OPEN인데 아무것도 안 흐르는 상태로,
//    모바일이 백그라운드에 오래 있다 깨어날 때 생긴다. 라이브러리는 심장박동
//    두 번(25초 × 2)이 지나야 알아채서, 실측 **47초** 동안 남들 화면이 낡은 채 남았다.
//  · 그래서 다시 보이는 순간 심장박동을 한 번 보내고 유예 뒤 한 번 더 보낸다.
//    두 번째 호출은 **첫 번째의 답이 안 왔으면 그 자리에서 소켓을 끊는다**(라이브러리
//    규칙) → 곧바로 재접속·재-track. 실측 47초 → 9.5초. 건강한 소켓에는 심장박동
//    두 번이 더 나갈 뿐 아무 일도 안 일어난다(대조군으로 확인 — 오진 없음).
// 소켓은 cloud.subscribeAll과 함께 쓰는 하나뿐이라, 여기서 되살리면 데이터 실시간도 같이 산다.
const WAKE_GRACE_MS = 8000;
let wakeTimer = null;

function nudgeConnection() {
  const c = supabase;
  if (!c || !channel || document.hidden) return;
  // 물러난 backoff(최대 10초)를 기다리지 않고 지금 붙는다
  if (!c.realtime.isConnected()) { c.realtime.connect(); return; }
  c.realtime.sendHeartbeat();
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    if (!document.hidden && supabase?.realtime.isConnected()) supabase.realtime.sendHeartbeat();
  }, WAKE_GRACE_MS);
}

// 게스트 모드에서는 클라이언트가 없어 아무 일도 하지 않는다(집합은 계속 비어 있다).
export function subscribePresence() {
  const c = supabase;
  if (!c) return () => {};
  let stopped = false;
  const onVisible = () => { if (!document.hidden) nudgeConnection(); };
  document.addEventListener('visibilitychange', onVisible);
  (async () => {
    const { data: { user } } = await c.auth.getUser();
    if (!user || stopped) return;
    // 같은 topic 채널이 남아 있으면 먼저 걷어낸다 — supabase-js는 같은 topic이면 기존
    // 인스턴스를 그대로 돌려주고, 이미 subscribe된 채널에 .on을 붙이면 예외가 난다
    // (알림 채널에서 실제로 화면이 죽었다 — §6-3).
    c.getChannels().filter(ch => ch.topic === TOPIC || ch.topic === `realtime:${TOPIC}`)
      .forEach(ch => c.removeChannel(ch));
    const ch = c.channel(TOPIC, { config: { presence: { key: user.id } } });
    channel = ch;
    ch.on('presence', { event: 'sync' }, () => setPresence(entriesOf(ch.presenceState()), user.id));
    // join·leave는 화면에 쓰지 않는다 — 라이브러리가 지워 버린 ref를 되살리려고 듣는다.
    // join이 leave보다 먼저 처리되므로 둘 다 걸어야 같은 diff 안의 leave가 먹는다.
    ch.on('presence', { event: 'join' }, healRefs);
    ch.on('presence', { event: 'leave' }, healRefs);
    ch.subscribe((status) => {
      // 끊기면 joined를 내린다 — 그 사이의 trackWhere는 meta만 바꿔 두고, 다시 붙을 때
      // 아래에서 최신 meta가 한 번에 나간다(실측: 재접속 때 이 콜백이 다시 불린다).
      if (status !== 'SUBSCRIBED') { joined = false; return; }
      joined = true;
      // 붙기 전에 정해진 자리도 여기서 한 번에 나간다. `at`을 같이 실어야
      // viewersOf가 "이 사람의 지금 자리"를 고를 수 있다(기기·탭이 여럿일 때).
      // **여기서 at을 새로 찍지 않는다** — 위 meta 주석의 그 버그다.
      ch.track(meta);
    });
  })();
  return () => {
    stopped = true;
    joined = false;
    // **여기서 `where`를 지우지 않는다**(2026-09-06). App의 trackWhere effect는
    // 보고 있는 자리(projectId·cardId)에만 의존해서, 이 구독이 다시 걸려도 자리가 그대로면
    // 다시 불리지 않는다 — 지우면 재구독 직후 `{null, null}`로 track되어 **얼굴이 통째로
    // 사라진다.** 자리는 화면이 소유하고 이 함수는 연결만 소유한다.
    document.removeEventListener('visibilitychange', onVisible);
    clearTimeout(wakeTimer);
    if (channel) { c.removeChannel(channel); channel = null; }
    setPresence([], null);
  };
}

// 내가 지금 보고 있는 곳을 얹는다. 값이 그대로면 아무것도 안 보낸다 —
// track 한 번이 접속한 모든 사람에게 sync 이벤트를 만든다.
//
// **자리가 바뀔 때마다 `at`이 새로 찍힌다** — 그래서 업무 창을 닫거나 다른 프로젝트로
// 옮기는 순간, 이 기기의 meta가 그 사람의 '가장 최근'이 되어 옛 자리의 얼굴이 곧바로
// 밀려난다(사용자 요구 2026-08-30 — "다른 데로 가면 바로 아이콘이 빠지게").
// 비교는 자리(projectId·cardId)로만 한다 — at까지 비교하면 언제나 달라서 매번 보낸다.
export function trackWhere(next) {
  const m = nextWhereMeta(meta, next);
  if (!m) return;                      // 같은 자리다 — 아무것도 안 보낸다
  meta = m;
  if (joined && channel) channel.track(meta);
}
