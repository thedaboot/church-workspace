import { useSyncExternalStore } from 'react';
import { supabase } from './supabaseClient.js';

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
let views = [];             // [{ id, projectId, cardId }] — 사람마다 열어 둔 창 수만큼
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
let where = { projectId: null, cardId: null };

// presenceState(): { [profile id]: [{ presence_ref, …실어 보낸 값 }, …] }
// 메타는 그 사람이 열어 둔 창 수만큼 온다 — 하나로 줄이지 않고 그대로 편다
// (폰으로는 프로젝트를, 노트북으로는 업무 창을 보고 있을 수 있다).
const entriesOf = (state) => Object.entries(state || {}).flatMap(([id, metas]) =>
  (metas && metas.length ? metas : [{}]).map(m => ({
    id, projectId: m.projectId || null, cardId: m.cardId || null,
  })));

// 게스트 모드에서는 클라이언트가 없어 아무 일도 하지 않는다(집합은 계속 비어 있다).
export function subscribePresence() {
  const c = supabase;
  if (!c) return () => {};
  let stopped = false;
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
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      joined = true;
      ch.track(where);   // 붙기 전에 정해진 자리도 여기서 한 번에 나간다
    });
  })();
  return () => {
    stopped = true;
    joined = false;
    where = { projectId: null, cardId: null };
    if (channel) { c.removeChannel(channel); channel = null; }
    setPresence([], null);
  };
}

// 내가 지금 보고 있는 곳을 얹는다. 값이 그대로면 아무것도 안 보낸다 —
// track 한 번이 접속한 모든 사람에게 sync 이벤트를 만든다.
export function trackWhere(next) {
  const w = { projectId: next?.projectId || null, cardId: next?.cardId || null };
  if (w.projectId === where.projectId && w.cardId === where.cardId) return;
  where = w;
  if (joined && channel) channel.track(w);
}
