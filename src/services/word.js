import { supabase } from './supabaseClient.js';

// ============================================================================
// 말씀 화면의 저장 계층 — qt_schedule · qt_entries · bible_state (0036 · docs/V2.md §1)
// ----------------------------------------------------------------------------
// 여기는 저 표 셋만 본다. 성경 본문은 DB가 아니라 정적 파일이고(services/bible.js),
// 구절 참조 해석은 bibleRef.js 한 벌을 쓴다 — 여기서 다시 만들지 않는다.
//
// **읽기표는 사람이 붙여넣지 않는다.** 2026·2027 730일치가 0038 마이그레이션으로
// qt_schedule에 통째로 들어가 있어서, 마스터용 '본문표 붙여넣기' 도구와 그 파서를
// 2026-09-01에 지웠다(사용자 결정 — "내가 표를 주면 네가 넣어라"). 다음 해 표가
// 필요하면 같은 방식으로 마이그레이션에 넣는다. 여기에 파서를 되살리지 말 것.
//
// **게스트 모드(supabase 없음)에서는 같은 함수가 localStorage로 떨어진다.** 워크스페이스
// 본체가 church_app_v4로 도는 것과 같은 방식이고(§4.1의 게스트 dev 서버), 브라우저
// 스위트가 가짜 QT 데이터로 화면을 검사할 수 있는 자리이기도 하다(tests/word.mjs).
// 클라우드 경로는 사람이 직접 확인해야 한다(HANDOFF §2-6).
// ============================================================================

// ── 날짜 (한국 시간) ────────────────────────────────────────────────────────
// 앱은 한국에서 쓰지만 검사는 어느 시간대에서도 같은 답이 나와야 한다 — 브라우저
// 로컬 시간(dashboardParts.ISO_TODAY)이 아니라 Asia/Seoul을 못 박는다.
// 'sv-SE' 로케일이 곧 'YYYY-MM-DD'다.
export const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const utc = (iso) => new Date(`${iso}T00:00:00Z`);

// 날짜 이동 — UTC로 더한다(현지 시간으로 더하면 서머타임 있는 지역에서 하루가 샌다)
export function shiftDay(iso, days) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (iso) => WEEK[utc(iso).getUTCDay()];
export const dayLabel = (iso) =>
  `${+iso.slice(0, 4)}년 ${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 (${weekdayOf(iso)})`;
export const shortDayLabel = (iso) => `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 (${weekdayOf(iso)})`;

// 그 달의 날짜들 — 잔디 그리드가 쓴다. lead = 1일이 놓일 요일(0=일)
export function monthDays(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return { year: y, month: m, lead: utc(days[0]).getUTCDay(), days };
}

// 그 날이 낀 주(일요일 시작)의 [처음, 끝]
export function weekRange(iso) {
  const start = shiftDay(iso, -utc(iso).getUTCDay());
  return [start, shiftDay(start, 6)];
}

// ── 편집기에 새로 읽어 온 글을 넣어도 되나 (§6-9-n의 짝) ────────────────────
// 화면은 캐시된 묵상을 먼저 그리고 뒤에서 다시 읽어 갈아 끼운다(services/cache.js).
// 예전에는 **날짜가 바뀔 때만** 에디터에 글을 넣어서, 캐시가 낡아 있으면 옛 글이 그대로
// 남았고 그 상태로 저장하면 서버의 새 글을 옛 글로 덮었다(2026-09-06 지적).
// 그렇다고 도착할 때마다 넣으면 쓰던 글을 뺏는다. 그래서 셋으로 가른다:
//   · 날짜가 바뀌었으면 → 언제나 넣는다(다른 날의 글이다)
//   · 사람이 아직 안 고쳤으면(지금 글 === 마지막으로 넣어 준 글) → 신선한 값으로 간다
//   · 한 글자라도 고쳤으면 → 그대로 둔다
export function shouldAdoptBody({ dateChanged = false, body = '', lastSynced = '', next = '' } = {}) {
  if (dateChanged) return true;
  if (next === body) return false;     // 넣어 봐야 같은 글이다
  return body === lastSynced;          // 손대지 않았으면 새 값이 맞다
}

// ── 게스트(로컬) 저장 ───────────────────────────────────────────────────────
const LS = {
  schedule: 'word_qt_schedule',   // { 'YYYY-MM-DD': { passage_ref, label } }
  entries: 'word_qt_entries',     // { 'YYYY-MM-DD': { body, shared } }  — 내 것만
  // 남이 공유한 묵상. 클라우드에서는 qt_entries의 shared 행들이 이 자리다 — 게스트에는
  // 사람이 나 하나뿐이라 나눔 피드에 **남의 줄이 아예 없었고**, 마스터의 삭제 같은
  // '남의 줄'에 붙는 것을 브라우저 스위트가 볼 수 없었다(tests/word.mjs).
  shared: 'word_qt_shared',       // { 'YYYY-MM-DD': [{ id, name, avatarUrl?, body }] }
  bible: 'word_bible_state',      // { lastRef, bookmarks }
  font: 'word_bible_font',        // 0 | 1 | 2
};
const lsGet = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
};
const lsSet = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사파리 비공개 모드 */ }
};

const myId = async () => {
  const { data: { user } = {} } = await supabase.auth.getUser();
  return user?.id || null;
};

// ── qt_schedule ─────────────────────────────────────────────────────────────
export async function fetchSchedule(date) {
  if (!supabase) {
    const row = lsGet(LS.schedule, {})[date];
    return row ? { qt_date: date, passage_ref: row.passage_ref, label: row.label || '' } : null;
  }
  const { data, error } = await supabase.from('qt_schedule')
    .select('qt_date, passage_ref, label').eq('qt_date', date).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// ── qt_entries — 내 묵상 ────────────────────────────────────────────────────
export async function fetchMyEntry(date) {
  if (!supabase) {
    const row = lsGet(LS.entries, {})[date];
    return row ? { qt_date: date, body: row.body || '', shared: !!row.shared } : null;
  }
  const uid = await myId();
  if (!uid) return null;
  const { data, error } = await supabase.from('qt_entries')
    .select('id, qt_date, body, shared').eq('qt_date', date).eq('profile_id', uid).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function saveMyEntry(date, { body, shared }) {
  if (!supabase) {
    const all = lsGet(LS.entries, {});
    all[date] = { body, shared: !!shared };
    lsSet(LS.entries, all);
    return { qt_date: date, body, shared: !!shared };
  }
  const uid = await myId();
  if (!uid) throw new Error('로그인이 필요합니다');
  const { data, error } = await supabase.from('qt_entries').upsert(
    { qt_date: date, profile_id: uid, body, shared: !!shared, updated_at: new Date().toISOString() },
    { onConflict: 'qt_date,profile_id' },
  ).select('id, qt_date, body, shared').single();
  if (error) throw error;
  return data;
}

// 그 날 내 묵상을 통째로 지운다 — 나눔에서도 내려가고 잔디에서도 빠진다.
// RLS의 qt_entries_write가 `for all`이라 본인 행 삭제는 이미 열려 있다(0036).
export async function deleteMyEntry(date) {
  if (!supabase) {
    const all = lsGet(LS.entries, {});
    delete all[date];
    lsSet(LS.entries, all);
    return;
  }
  const uid = await myId();
  if (!uid) throw new Error('로그인이 필요합니다');
  const { error } = await supabase.from('qt_entries')
    .delete().eq('qt_date', date).eq('profile_id', uid);
  if (error) throw error;
}

// 남의 나눔을 지운다 — **마스터만**(사용자 결정 2026-09-05 · 0045
// qt_entries_delete_master). 공유 해제가 아니라 **그 사람의 그날 묵상 행 자체**가
// 없어지므로 그 사람의 잔디에서도 빠진다. 부르는 자리의 문구가 그걸 말해야 한다.
//
// 자격은 RLS가 지킨다. 마스터가 아니면 지워지는 행이 0개일 뿐 오류가 나지 않으므로
// (정책이 걸러 낸 행은 애초에 delete의 대상이 아니다) **화면이 버튼을 감추는 것**이
// 사람에게 보이는 경계다(wordView canDeleteShared).
export async function deleteEntryAsMaster(id) {
  if (!supabase) {
    const all = lsGet(LS.shared, {});
    for (const d of Object.keys(all)) {
      const rest = (all[d] || []).filter(r => r.id !== id);
      if (rest.length) all[d] = rest; else delete all[d];
    }
    lsSet(LS.shared, all);
    return;
  }
  // **지워진 행 수를 확인한다.** 정책이 걸러 낸 행은 delete의 대상이 아니라서 오류가
  // 나지 않는다 — 마스터가 아닌 사람이 눌러도 성공으로 돌아왔고, 화면은 '지웠어요'라고
  // 말한 뒤 다시 읽어 온 목록에 그 줄이 그대로 서 있었다(2026-09-06 지적).
  // 여기서 `.select()`는 안전하다(§6-25와 다르다) — qt_entries의 SELECT 정책은 공유된
  // 글을 모두에게 열어 두므로 방금 지운 행을 되읽을 수 있다.
  const { data, error } = await supabase.from('qt_entries').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!(data || []).length) {
    const err = new Error(`qt_entries delete affected 0 rows (id=${id})`);
    err.human = '이미 지워졌거나 지울 자격이 없어요\n새로고침해주세요';   // errorText가 human을 먼저 본다
    throw err;
  }
}

// 그 날의 나눔 — '나누기'를 켠 글만. RLS도 같은 경계를 본다(0036).
// `mine`은 화면이 수정·삭제를 열어 줄 자리를 고르는 데 쓴다 — 이름 비교로는 동명이인이
// 섞이므로 auth uid로 가른다(게스트의 로컬 나눔은 언제나 내 글이다).
export async function fetchSharedEntries(date) {
  if (!supabase) {
    const others = (lsGet(LS.shared, {})[date] || [])
      .filter(r => (r?.body || '').trim())
      .map(r => ({
        id: r.id, profile_id: r.profile_id || '', name: r.name || '',
        avatarUrl: r.avatarUrl || '', body: r.body, mine: false,
      }));
    const row = lsGet(LS.entries, {})[date];
    const mine = row?.shared && row.body
      ? [{ id: 'local', profile_id: '', name: '', avatarUrl: '', body: row.body, mine: true }]
      : [];
    return [...others, ...mine];
  }
  const uid = await myId();
  const { data, error } = await supabase.from('qt_entries')
    .select('id, profile_id, body, updated_at, profiles(display_name, avatar_url)')
    .eq('qt_date', date).eq('shared', true)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).filter(r => (r.body || '').trim()).map(r => ({
    id: r.id,
    profile_id: r.profile_id,
    name: r.profiles?.display_name || '',
    avatarUrl: r.profiles?.avatar_url || '',
    body: r.body,
    mine: !!uid && r.profile_id === uid,
  }));
}

// 잔디 — **내 기록 날짜만**. 남의 것은 애초에 묻지 않는다(결정 10).
export async function fetchMyEntryDates(from, to) {
  if (!supabase) {
    return Object.entries(lsGet(LS.entries, {}))
      .filter(([d, v]) => d >= from && d <= to && (v?.body || '').trim())
      .map(([d]) => d).sort();
  }
  const uid = await myId();
  if (!uid) return [];
  const { data, error } = await supabase.from('qt_entries')
    .select('qt_date').eq('profile_id', uid).gte('qt_date', from).lte('qt_date', to);
  if (error) throw error;
  return (data ?? []).map(r => r.qt_date).sort();
}

// ── bible_state — 이어읽기 · 북마크 · 형광펜 ────────────────────────────────
// 로그인이면 DB, 게스트면 localStorage. 어느 쪽이든 화면이 멈추면 안 되므로
// 실패는 삼키고 마지막에 알던 값으로 간다.
// highlights는 0038에서 붙은 칸이다 — 예전 행에는 없을 수 있으므로 배열인지 확인한다.
const EMPTY_STATE = { lastRef: '', bookmarks: [], highlights: [] };
const arr = (v) => (Array.isArray(v) ? v : []);

// 성경 상태의 로컬 자리는 **사용자별**이다(2026-09-06). 예전에는 'word_bible_state' 한 키라,
// 한 기기에서 계정을 바꾸면 클라우드가 흔들리는 순간 폴백이 **앞사람의 북마크·형광펜**을
// 집어 왔다(그리고 그 값이 그대로 다시 저장됐다). 게스트(supabase 없음)에는 계정이 없으므로
// 예전 키를 그대로 쓴다 — 브라우저 스위트가 심는 자리도 그쪽이다(tests/word.mjs).
const bibleKey = (uid) => (uid ? `${LS.bible}:${uid}` : LS.bible);

export async function loadBibleState() {
  if (!supabase) return { ...EMPTY_STATE, ...lsGet(LS.bible, EMPTY_STATE) };
  let uid = null;
  try {
    uid = await myId();
    if (!uid) return { ...EMPTY_STATE };
    const { data, error } = await supabase.from('bible_state')
      .select('last_ref, bookmarks, highlights').eq('profile_id', uid).maybeSingle();
    if (error) throw error;
    return { lastRef: data?.last_ref || '', bookmarks: arr(data?.bookmarks), highlights: arr(data?.highlights) };
  } catch {
    // 누구인지 모르면 폴백도 없다 — 모르는 채로 로컬을 읽으면 남의 값을 보여 준다
    return uid ? { ...EMPTY_STATE, ...lsGet(bibleKey(uid), EMPTY_STATE) } : { ...EMPTY_STATE };
  }
}

// **못 남긴 것을 부르는 쪽에 알려준다**(사용자 피드백 2026-09-03 — 예외 문구 검토).
// 여기서 던지지는 않는다(읽던 자리 하나 때문에 본문이 멈추면 안 된다) 대신
// `{ ok, error }`를 돌려주고, 북마크·형광펜처럼 사람이 **한 일이 사라지는** 경우에만
// 부르는 쪽이 이유까지 붙여 말한다(wordBible의 update). 이어읽기는 조용히 넘긴다.
export async function saveBibleState(next) {
  if (!supabase) { lsSet(LS.bible, next); return { ok: true }; }
  let uid = null;
  try { uid = await myId(); } catch { /* 세션을 못 물어봐도 로컬에는 남긴다 */ }
  lsSet(bibleKey(uid), next);   // 로그인해도 로컬에 같이 남긴다 — 클라우드가 흔들려도 읽던 자리는 지킨다
  try {
    if (!uid) return { ok: true };   // 로그인 전이면 기기에만 남는 것이 정상이다
    const { error } = await supabase.from('bible_state').upsert(
      {
        profile_id: uid, last_ref: next.lastRef || null,
        bookmarks: arr(next.bookmarks), highlights: arr(next.highlights),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    console.error('[word] 성경 상태 저장 실패:', error);
    return { ok: false, error };
  }
}

// 글자 크기는 기기의 취향이라 계정을 따라다니지 않는다(같은 사람도 폰과 노트북이 다르다)
export const loadFontStep = () => {
  const n = Number(lsGet(LS.font, 1));
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : 1;
};
export const saveFontStep = (step) => lsSet(LS.font, step);

// 장 단위 열쇠 — bible_state.last_ref·bookmarks가 쓰는 모양('gen 3', 0036 주석)
export const chapterKey = (bookId, chapter) => `${bookId} ${chapter}`;
export function parseChapterKey(key) {
  const m = /^(\S+)\s+(\d+)$/.exec(String(key || ''));
  return m ? { bookId: m[1], chapter: +m[2] } : null;
}

// 절 단위 열쇠 — bible_state.highlights가 쓰는 모양('gen 1:3', 0038 주석).
// 장 열쇠와 같은 규칙에 `:절`만 붙는다 — 한 파서로 둘 다 읽으면 'gen 1'과
// 'gen 1:3'이 섞여 들어와도 갈리지 않으므로 함수를 나눠 둔다.
export const verseKey = (bookId, chapter, verse) => `${bookId} ${chapter}:${verse}`;
export function parseVerseKey(key) {
  const m = /^(\S+)\s+(\d+):(\d+)$/.exec(String(key || ''));
  return m ? { bookId: m[1], chapter: +m[2], verse: +m[3] } : null;
}
