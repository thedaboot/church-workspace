// ============================================================================
// 같이 쓰기의 저장 자리 — Supabase 구현 (0084 · 인터페이스는 core.loadDoc 머리말)
// ----------------------------------------------------------------------------
// 쓰기 넷 중 **둘은 함수(RPC)** 다: 심기(`card_doc_seed`)와 접기(`card_doc_compact`).
// 스냅샷 표에는 쓰기 정책이 없다 — 덮어쓰기와 기록 지우기가 한 트랜잭션이어야 하고
// (중간에 끊기면 글이 빈다), 심기는 '먼저 넣은 쪽만'이 DB에서 판정돼야 해서다.
// 기록(`card_doc_updates`)·판(`card_doc_versions`)은 넣기만 한다(누가 = 기본값 effective_uid()).
// 둘 다 클라이언트가 만든 열쇠(client_id uuid unique)를 달고 `on conflict do nothing`으로 간다 —
// upsert(ignoreDuplicates)는 INSERT … ON CONFLICT DO NOTHING이라 넣기 정책만으로 된다.
//
// 모든 호출을 시계 오차 재시도(cloud.withClockSkewRetry)로 감싼다 — 다른 쓰기와 같은 결.
// ============================================================================
import { withClockSkewRetry } from '../cloud.js';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };

export function supabaseStore(supabase) {
  const run = (fn) => withClockSkewRetry(async () => unwrap(await fn()));
  return {
    async snapshot(cardId) {
      const row = await run(() => supabase.from('card_docs').select('state, upto').eq('card_id', cardId).maybeSingle());
      return row ? { state: row.state, upto: Number(row.upto) || 0 } : null;
    },
    // 1000줄 상한(PostgREST 기본)에 걸리지 않게 끝까지 넘겨 읽는다 — 접기 전에는 기록이 길 수 있다
    async rowsAfter(cardId, upto) {
      const out = [];
      let from = upto;
      for (;;) {
        const page = await run(() => supabase.from('card_doc_updates').select('id, data')
          .eq('card_id', cardId).gt('id', from).order('id', { ascending: true }).limit(1000));
        for (const r of page) out.push({ id: Number(r.id), data: r.data });
        if (page.length < 1000) return out;
        from = out[out.length - 1].id;
      }
    },
    seed: (cardId, state) => run(() => supabase.rpc('card_doc_seed', { p_card: cardId, p_state: state })).then(Boolean),
    // 열쇠(client_id)가 같으면 DB가 한 번만 받는다 — 시간 초과 뒤 같은 덩어리를 다시 보내도 안전하다
    append: (cardId, data, key) => run(() => supabase.from('card_doc_updates')
      .upsert({ client_id: key, card_id: cardId, data }, { onConflict: 'client_id', ignoreDuplicates: true })),
    compact: (cardId, upto, state) => run(() => supabase.rpc('card_doc_compact', { p_card: cardId, p_upto: upto, p_state: state })).then(Boolean),
    addVersion: (cardId, { md, added, removed, editors = [] }, key) => run(() => supabase.from('card_doc_versions')
      .upsert({ client_id: key, card_id: cardId, md, added, removed, editors }, { onConflict: 'client_id', ignoreDuplicates: true })),
    // 문서가 마지막으로 바뀐 때(가장 늦은 기록 · 없으면 스냅샷) — 열 때 description이 문서보다 새것인지
    // 가를 때만 읽는다(index.js adoptCheck)
    async latestAt(cardId) {
      const row = await run(() => supabase.from('card_doc_updates').select('at').eq('card_id', cardId)
        .order('id', { ascending: false }).limit(1).maybeSingle());
      if (row?.at) return row.at;
      const snap = await run(() => supabase.from('card_docs').select('updated_at').eq('card_id', cardId).maybeSingle());
      return snap?.updated_at || null;
    },
    // 기준 판(0086) — 원래 본문을 판 한 줄로. 판이 이미 있거나 누가 먼저 넣었으면 DB가 거른다(false)
    baseline: (cardId, md) => run(() => supabase.rpc('card_doc_baseline', { p_card: cardId, p_md: md })).then(Boolean),
    // 판 목록 — 업무 창 '버전 기록' 탭이 열릴 때만 읽는다(최신이 앞 · 50판까지)
    versions: (cardId, limit = 50) => run(() => supabase.from('card_doc_versions')
      .select('id, by, at, md, added, removed, kind, editors').eq('card_id', cardId)
      .order('at', { ascending: false }).order('id', { ascending: false }).limit(limit)),
  };
}
