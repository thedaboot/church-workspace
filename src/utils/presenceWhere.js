// ============================================================================
// 지금 누가 여기를 보고 있나 — presence meta 고르기(viewersOf) · 자리 옮김 판정(nextWhereMeta)
// ----------------------------------------------------------------------------
// 채널·track은 services/presence.js가 한다(react·supabase를 물어 노드에서 못 들인다). 여기는 순수 판정만 —
// import 0개라 노드 검사가 베껴 들인다(tests/_load.mjs). 부르는 쪽은 utils.js(바렐)를 문다.
// ============================================================================

// ── 지금 누가 여기를 보고 있나 ─────────────────────────────────────────────
// Realtime presence가 실어 온 것만 본다: entries는 [{ id, projectId, cardId, at }]이고
// 한 사람이 창을 여럿 열면 그 수만큼 들어온다(폰과 노트북, 탭 두 개).
// cardId를 물으면 그 업무 창을 지금 열어 둔 사람, 아니면 그 프로젝트에 들어와 있는 사람이다
// (업무 창을 연 사람도 그 프로젝트를 보고 있는 것이 맞다).
//
// **한 사람은 언제나 한 곳에만 뜬다** — 사람마다 `at`(track할 때 찍은 시각)이 가장 큰
// meta **하나만** 남기고 그것으로 판정한다. 전부 그리면 같은 얼굴이 '더다붓 예배'와
// '회계 인수인계' 탭에, 또 '대표기도자'와 '헌금봉헌' 카드에 동시에 떴다(사용자 지적
// 2026-08-30 · 스크린샷 두 장). 이 규칙 덕분에 **자리를 옮기는 즉시 옛 자리에서
// 빠진다** — 업무 창을 닫거나 다른 프로젝트로 가면 새 at이 찍힌 meta가 이기기 때문이다.
// `at`이 없는 옛 meta는 0으로 보고(배포 전환기), 같으면 seq가 큰 쪽이 이긴다(isNewerWhere).
//
// **본인은 뺀다** — 내가 보고 있는 건 나도 안다. 최대 limit명.
// 여기에는 지금 붙어 있는 연결만 들어온다 — 기록으로 남기거나 "며칠 전에 봤다"로
// 바꾸는 순간 §7의 '카드별 조회 추적'이 된다(사용자가 판단해서 뺀 것).

// 자리를 옮겼나 · 옮겼으면 presence에 실을 meta 한 벌. 옮기지 않았으면 null이다
// (track 한 번이 접속한 모두에게 sync 이벤트를 만든다 — 같은 자리를 다시 알릴 이유가 없다).
// **재접속에서는 이 함수를 부르지 않는다** — 마지막에 만든 meta를 **그대로** 다시 보낸다.
// 그래야 `at`이 "자리를 옮긴 시각"으로 남는다(presence.js의 그 주석).
export function nextWhereMeta(cur, next, now = Date.now()) {
  const projectId = next?.projectId || null;
  const cardId = next?.cardId || null;
  if (cur && projectId === (cur.projectId || null) && cardId === (cur.cardId || null)) return null;
  return { projectId, cardId, at: now, seq: (Number(cur?.seq) || 0) + 1 };
}

// 같은 사람의 meta 둘을 견주는 값. **`at`은 "자리를 옮긴 시각"이지 "연결이 살아 있다고
// 알린 시각"이 아니다**(presence.js) — 예전에는 재접속마다 at이 새로 찍혀서, 옛 프로젝트를
// 켜 둔 백그라운드 탭이 재접속하는 것만으로 지금 보고 있는 탭을 이겼다(사용자 지적
// 2026-09-05 — "임원진 회의를 보고 있는데 가을 체육대회로 나온다").
// `seq`는 **한 클라이언트 안에서만** 뜻이 있는 증가 번호다. 같은 밀리초에 두 번 옮겼을 때
// 순서를 확정하는 데만 쓴다(기기가 다르면 시계가 달라 어차피 at으로 갈린다).
// (한 숫자로 합치지 않는다 — at은 이미 1.7e12라 자리를 붙이면 안전 정수를 넘는다)
const isNewerWhere = (a, b) => {
  const ta = Number(a?.at) || 0, tb = Number(b?.at) || 0;
  if (ta !== tb) return ta > tb;
  return (Number(a?.seq) || 0) >= (Number(b?.seq) || 0);
};

// opts.entries — id 대신 그 사람의 최신 meta를 돌려준다(보드 얼굴이 `editing`을 본다 · 2026-09-30).
export function viewersOf(entries, match = {}, opts = {}) {
  const { meId = null, limit = 3, entries: asEntries = false } = opts;
  const wantCard = match?.cardId || null;
  const wantProject = match?.projectId || null;
  if (!wantCard && !wantProject) return [];
  // 사람마다 가장 최근 meta 하나만 — 거르기(match)보다 **먼저** 해야 한다.
  // 거른 뒤에 하나만 남기면 "그 카드를 보는 옛 meta"가 살아남아 옛 자리에 얼굴이 남는다.
  const latest = new Map();
  for (const e of entries || []) {
    const id = e?.id;
    if (!id || id === meId) continue;
    const cur = latest.get(id);
    if (!cur || isNewerWhere(e, cur)) latest.set(id, e);
  }
  const ids = [];
  for (const e of latest.values()) {
    if (wantCard ? e.cardId !== wantCard : e.projectId !== wantProject) continue;
    ids.push(asEntries ? e : e.id);
    if (limit > 0 && ids.length >= limit) break;
  }
  return ids;
}
