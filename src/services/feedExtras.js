// 대시보드 '최근 활동'에 섞는 업무 밖 움직임 — 주보 발행 · 동아리 모임 일정 · 더다붓에 나눈 QT 묵상
// (사용자 결정 2026-09-25 · 목업 mockup-traces 4). 줄 모양·문장은 traces.extraFeedRows(순수)가 만든다.
//
// **승인된 전원이 읽을 수 있는 것만 읽는다** — 조회에서 직접 거른다(RLS에만 기대지 않는다):
//   · services: `status = 'published'`만 — 주보 편집 자격이 있는 사람에게는 RLS가 초안도 돌려준다
//   · qt_entries: `shared = true`만 — 내 비공개 묵상은 RLS가 나에게 돌려준다. **절대 섞지 않는다**
//   · group_meetings: 승인된 전원이 읽는다(0035)
// 발행 시각·발행한 사람(`services.published_at`·`published_by`)과 모임을 잡은 사람(`group_meetings.created_by`)은
// 0079가 더한 칸이다. **칸이 아직 없으면(마이그레이션 전) 그 갈래만 조용히 비운다** — 대시보드의 곁가지라
// loadCloudState처럼 오류 화면을 띄울 까닭이 없다(§3-4). 콘솔에만 남긴다.
//
// RLS에만 기대지 않는 이유는 PITFALLS 31-k. 대시보드를 오갈 때마다 네 번을 다시 묻지 않게 1분 쥔다.
import { supabase } from './supabaseClient.js';
import { guestStore } from './people.js';

const TTL_MS = 60000;
const LIMIT = 20;
let held = null;   // { at, data }

const guestWorship = guestStore('church_worship_v1');
const guestGroups = guestStore('church_groups_v1');

async function part(label, run) {
  try { return await run(); } catch (e) { console.warn(`[feed] ${label}을(를) 읽지 못했어요:`, e); return []; }
}
const rowsOf = async (q) => { const { data, error } = await q; if (error) throw error; return data || []; };

// → { services, meetings, qts, groupNames: { [id]: name }, passages: { [date]: ref } }
export async function loadFeedExtras({ force = false, guestName = '' } = {}) {
  if (!force && held && Date.now() - held.at < TTL_MS) return held.data;
  let data;
  if (!supabase) {
    // 게스트는 한 사람이다 — 발행·모임을 잡은 사람은 나다(점도 안 선다)
    const groups = guestGroups.rows('groups');
    data = {
      services: guestWorship.rows('services').filter(s => s.status === 'published')
        .map(s => ({ id: s.id, title: s.title, published_at: s.published_at || s.created_at || null, published_by: guestName })),
      meetings: guestGroups.rows('group_meetings').map(m => ({ ...m, created_by: m.created_by || guestName })),
      qts: [],
      groupNames: Object.fromEntries(groups.filter(g => !g.removed_at).map(g => [g.id, g.name])),
      passages: {},
    };
  } else {
    const [services, meetings, qts] = await Promise.all([
      part('주보 발행', () => rowsOf(supabase.from('services')
        .select('id, title, published_at, published_by')
        .eq('status', 'published').not('published_at', 'is', null)
        .order('published_at', { ascending: false }).limit(LIMIT))),
      part('동아리 모임', () => rowsOf(supabase.from('group_meetings')
        .select('id, group_id, meeting_date, title, created_at, created_by, groups(name, type, removed_at)')
        .order('created_at', { ascending: false }).limit(LIMIT))),
      part('나눈 묵상', () => rowsOf(supabase.from('qt_entries')
        .select('id, profile_id, qt_date, title, updated_at')
        .eq('shared', true)
        .order('updated_at', { ascending: false }).limit(LIMIT))),
    ]);
    const dates = [...new Set(qts.map(q => q.qt_date).filter(Boolean))];
    const sched = dates.length
      ? await part('QT 본문', () => rowsOf(supabase.from('qt_schedule').select('qt_date, passage_ref').in('qt_date', dates)))
      : [];
    const groupNames = {};
    for (const m of meetings) {
      const g = m.groups;
      if (g && !g.removed_at && g.type === 'club') groupNames[m.group_id] = g.name;
    }
    data = {
      services, meetings, qts, groupNames,
      passages: Object.fromEntries(sched.map(r => [r.qt_date, r.passage_ref || ''])),
    };
  }
  held = { at: Date.now(), data };
  return data;
}

// '더보기'를 처음 누를 때 — 스토어 피드(서른 줄)보다 깊게. 게스트는 스토어 파생 피드가 전부라 null.
export async function loadMoreActivity(limit = 200) {
  if (!supabase) return null;
  return rowsOf(supabase.from('activity')
    .select('id, actor_id, action, card_id, project_id, created_at')
    .order('created_at', { ascending: false }).limit(limit));
}
