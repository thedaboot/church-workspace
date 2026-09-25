import { supabase, myUid } from './supabaseClient.js';

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
// 클라우드 경로는 사람이 직접 확인해야 한다(HANDOFF §3-6).
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

// 달 이동 — 잔디의 이전·다음 달. **1일로 맞춰 돌려준다**(monthDays에 그대로 넣는다).
// shiftDay로 30일씩 더하면 달 길이가 달라 2월이나 31일에서 한 달을 건너뛴다.
export function shiftMonth(iso, months) {
  const m = +iso.slice(5, 7) + months;
  const y = +iso.slice(0, 4) + Math.floor((m - 1) / 12);
  const mm = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(mm).padStart(2, '0')}-01`;
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
  bible: 'word_bible_state',      // { lastRef, bookmarks, highlights, recentSearches }
  font: 'word_bible_font',        // 0 | 1 | 2
  // 이번 주 이 장을 본 사람(0080). 게스트에는 남이 없어 남의 줄을 여기 심는다(tests/word.mjs) —
  // 내가 적은 줄은 따로 둔다(내 줄은 얼굴에 서지 않는다).
  reads: 'word_bible_reads',            // { 'gen 3': [{ profile_id, name, avatarUrl? }] }
  readsMine: 'word_bible_reads_mine',   // [{ chapter_key, week_start }]
  readShare: 'word_bible_read_share',   // true | false — 나도 나누기
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

// **합친 계정이면 남긴 계정의 id다**(0061 · supabaseClient.myUid) — 내 uid로 걸면
// 노트·묵상이 남긴 계정 아래 있어서 한 줄도 안 나온다.
const myId = () => myUid();

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
// **제목이 같이 다닌다**(0062 · 사용자 요청 2026-09-11). 예배 노트 종이의 머리에는
// 설교 제목이 서는데 묵상은 그 자리가 늘 비어 구절만 올라왔다 — 이제 쓴 사람이 단다.
// 빈 제목은 `''`다(0062가 `not null default ''`인 이유) — 없는 것과 빈 것을 가르지 않는다.
// 0062를 아직 안 넣은 판에서 온 행에도 `?? ''`로 받는다.
const entryTitle = (row) => String(row?.title ?? '');

export async function fetchMyEntry(date) {
  if (!supabase) {
    const row = lsGet(LS.entries, {})[date];
    return row ? { qt_date: date, body: row.body || '', title: entryTitle(row), shared: !!row.shared } : null;
  }
  const uid = await myId();
  if (!uid) return null;
  const { data, error } = await supabase.from('qt_entries')
    .select('id, qt_date, body, title, shared').eq('qt_date', date).eq('profile_id', uid).maybeSingle();
  if (error) throw error;
  return data ? { ...data, title: entryTitle(data) } : null;
}

export async function saveMyEntry(date, { body, title = '', shared }) {
  const t = String(title || '').trim();
  if (!supabase) {
    const all = lsGet(LS.entries, {});
    all[date] = { body, title: t, shared: !!shared };
    lsSet(LS.entries, all);
    return { qt_date: date, body, title: t, shared: !!shared };
  }
  const uid = await myId();
  if (!uid) throw new Error('로그인이 필요합니다');
  const { data, error } = await supabase.from('qt_entries').upsert(
    { qt_date: date, profile_id: uid, body, title: t, shared: !!shared, updated_at: new Date().toISOString() },
    { onConflict: 'qt_date,profile_id' },
  ).select('id, qt_date, body, title, shared').single();
  if (error) throw error;
  return { ...data, title: entryTitle(data) };
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
        avatarUrl: r.avatarUrl || '', body: r.body, title: entryTitle(r), mine: false,
      }));
    const row = lsGet(LS.entries, {})[date];
    const mine = row?.shared && row.body
      ? [{ id: 'local', profile_id: '', name: '', avatarUrl: '', body: row.body, title: entryTitle(row), mine: true }]
      : [];
    return [...others, ...mine];
  }
  const uid = await myId();
  const { data, error } = await supabase.from('qt_entries')
    .select('id, profile_id, body, title, updated_at, profiles(display_name, avatar_url)')
    .eq('qt_date', date).eq('shared', true)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).filter(r => (r.body || '').trim()).map(r => ({
    id: r.id,
    profile_id: r.profile_id,
    name: r.profiles?.display_name || '',
    avatarUrl: r.profiles?.avatar_url || '',
    body: r.body,
    title: entryTitle(r),
    mine: !!uid && r.profile_id === uid,
  }));
}

// 그 날 나눔의 **개수만**(홈 오늘의 QT 카드 '오늘의 나눔 N' · 사용자 요청 2026-09-25). 누가 썼는지는
// 묻지 않는다 — 카드는 수만 말한다. 조건은 fetchSharedEntries와 같고(공유 · 본문이 빈 글은 빼고)
// head:true라 행은 오지 않는다. 게스트는 같은 목록의 길이다(내 로컬 나눔 포함).
export async function countSharedEntries(date) {
  if (!supabase) return (await fetchSharedEntries(date)).length;
  const { count, error } = await supabase.from('qt_entries')
    .select('id', { count: 'exact', head: true })
    .eq('qt_date', date).eq('shared', true)
    .not('body', 'is', null).neq('body', '');
  if (error) throw error;
  return count ?? 0;
}

// 잔디 — **내 기록 날짜만**. 남의 것은 애초에 묻지 않는다(결정 10).
// **제목이 같이 온다**(2026-09-25 · 목업 '지난 기록' 2번) — 달력 아래 그 달 묵상 목록이 '날짜 · 제목'을
// 한 줄씩 세운다(제목이 비면 그 날 구절을 흐리게 · fetchScheduleRange). 본문은 싣지 않는다.
// → [{ date, title }] 날짜 오름차순
export async function fetchMyEntryDates(from, to) {
  if (!supabase) {
    return Object.entries(lsGet(LS.entries, {}))
      .filter(([d, v]) => d >= from && d <= to && (v?.body || '').trim())
      .map(([d, v]) => ({ date: d, title: entryTitle(v).trim() }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const uid = await myId();
  if (!uid) return [];
  const { data, error } = await supabase.from('qt_entries')
    .select('qt_date, title').eq('profile_id', uid).gte('qt_date', from).lte('qt_date', to);
  if (error) throw error;
  return (data ?? []).map(r => ({ date: r.qt_date, title: entryTitle(r).trim() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 그 기간의 읽기표 — [{ qt_date, passage_ref }] 날짜 오름차순. 달력 아래 목록의 흐린 구절과
// '이번 주 이 장을 본 사람'의 나눔 보기(이 장에 걸친 날)가 쓴다. 게스트는 심어 둔 일정.
export async function fetchScheduleRange(from, to) {
  if (!supabase) {
    return Object.entries(lsGet(LS.schedule, {}))
      .filter(([d]) => d >= from && d <= to)
      .map(([d, v]) => ({ qt_date: d, passage_ref: String(v?.passage_ref || '') }))
      .sort((a, b) => a.qt_date.localeCompare(b.qt_date));
  }
  const { data, error } = await supabase.from('qt_schedule')
    .select('qt_date, passage_ref').gte('qt_date', from).lte('qt_date', to).order('qt_date');
  if (error) throw error;
  return data ?? [];
}

// ── 이번 주 이 장을 본 사람 (0080 bible_reads) ──────────────────────────────
// 판정(주 셈·나 빼기·이름순)은 services/bibleReads.js(순수)다. 여기는 왕복만 한다.
// **실패는 조용하다** — 얼굴은 있으면 좋은 곁줄이라, 못 읽으면 그 자리가 안 설 뿐이다(본문은 그대로).
// 게스트에는 남이 없어서 심어 둔 자리(word_bible_reads)를 남의 줄로 본다(나눔의 word_qt_shared와 같은 방식).
//
// 장을 열 때 **한 번** 읽는다(실시간 없음 — 사용자 결정). 이름·사진은 부르는 쪽이 멤버 목록에서 붙인다
// (profiles를 조인하면 행마다 이름이 두 벌이 된다 — 나눔 칩이 멤버 목록을 원본으로 보는 것과 같다).
// → [{ profile_id, name?, avatarUrl? }]
export async function fetchChapterReaders(chapter, weekStart) {
  if (!supabase) return (lsGet(LS.reads, {})[chapter] || []).filter(r => r && r.profile_id);
  const { data, error } = await supabase.from('bible_reads')
    .select('profile_id').eq('chapter_key', chapter).eq('week_start', weekStart);
  if (error) throw error;
  return data ?? [];
}

// 장을 5초 넘게 펼쳤다 — 이번 주 이 장에 내 줄 하나(같은 주·같은 장은 한 줄 · ignoreDuplicates).
// 켬/끔은 부르는 쪽이 먼저 본다(loadReadShare) — 꺼져 있으면 부르지 않는다.
export async function markChapterRead(chapter, weekStart) {
  if (!supabase) {
    const mine = lsGet(LS.readsMine, []).filter(r => !(r.chapter_key === chapter && r.week_start === weekStart));
    lsSet(LS.readsMine, [...mine, { chapter_key: chapter, week_start: weekStart }]);
    return;
  }
  const uid = await myId();
  if (!uid) return;
  const { error } = await supabase.from('bible_reads').upsert(
    { profile_id: uid, chapter_key: chapter, week_start: weekStart },
    { onConflict: 'profile_id,chapter_key,week_start', ignoreDuplicates: true },
  );
  if (error) throw error;
}

// '나도 나누기'를 끄면 **내 줄을 모두 지운다**(사용자 결정 — 기록을 남기지 않고 지움)
export async function clearMyReads() {
  if (!supabase) { lsSet(LS.readsMine, []); return; }
  const uid = await myId();
  if (!uid) return;
  const { error } = await supabase.from('bible_reads').delete().eq('profile_id', uid);
  if (error) throw error;
}

// 켬/끔 — bible_state.share_reads 한 칸(0080). **bible_state의 큰 읽기·쓰기(load/saveBibleState)와
// 따로 둔다**: 0080이 아직 안 나간 판에서 그 한 벌에 이 칸을 넣으면 북마크·형광펜 저장까지 같이 실패한다.
// 못 읽으면 켬(기본값)으로 본다. 한 번 읽은 값은 모듈이 들고 있다(장 머리의 판과 내 정보가 같은 값).
// 계정이 바뀌면 다시 읽는다(열쇠가 uid다 — 한 기기에서 계정을 바꿔도 앞사람 값을 쓰지 않게).
let readShareMemo = null;   // { uid, on }
export async function loadReadShare() {
  if (!supabase) return lsGet(LS.readShare, true) !== false;
  try {
    const uid = await myId();
    if (!uid) return true;
    if (readShareMemo?.uid === uid) return readShareMemo.on;
    const { data, error } = await supabase.from('bible_state').select('share_reads').eq('profile_id', uid).maybeSingle();
    if (error) throw error;
    readShareMemo = { uid, on: data?.share_reads !== false };
    return readShareMemo.on;
  } catch (e) {
    console.warn('[word] 나도 나누기 값을 읽지 못했어요:', e);
    return true;
  }
}
// 끄면 내 줄도 같이 지운다. 실패는 던진다 — 부르는 쪽(토글)이 되돌리고 토스트로 알린다.
export async function saveReadShare(on) {
  const next = !!on;
  if (!supabase) lsSet(LS.readShare, next);
  else {
    const uid = await myId();
    if (!uid) throw new Error('로그인이 필요합니다');
    const { error } = await supabase.from('bible_state').upsert(
      { profile_id: uid, share_reads: next, updated_at: new Date().toISOString() },
      { onConflict: 'profile_id' },
    );
    if (error) throw error;
    readShareMemo = { uid, on: next };
  }
  if (!next) await clearMyReads();
}

// 이 사람들 중 **그 날들에 묵상을 공유해 둔 사람**의 날짜 — [{ profile_id, qt_date }].
// '나눔 보기'가 선다(그 사람이 이 장에 걸친 QT 묵상을 공유했을 때만). 공유 글은 RLS가 모두에게 연다(0036).
export async function fetchSharedOn(dates, profileIds) {
  if (!dates?.length || !profileIds?.length) return [];
  if (!supabase) {
    const all = lsGet(LS.shared, {});
    return dates.flatMap(d => (all[d] || [])
      .filter(r => r?.profile_id && profileIds.includes(r.profile_id) && String(r.body || '').trim())
      .map(r => ({ profile_id: r.profile_id, qt_date: d })));
  }
  const { data, error } = await supabase.from('qt_entries')
    .select('profile_id, qt_date').eq('shared', true)
    .in('qt_date', dates).in('profile_id', profileIds)
    .not('body', 'is', null).neq('body', '');
  if (error) throw error;
  return data ?? [];
}

// ── bible_state — 이어읽기 · 북마크 · 형광펜 · 최근 검색어 ──────────────────
// 로그인이면 DB, 게스트면 localStorage. 어느 쪽이든 화면이 멈추면 안 되므로
// 실패는 삼키고 마지막에 알던 값으로 간다.
// highlights는 0038에서 붙은 칸이다 — 예전 행에는 없을 수 있으므로 배열인지 확인한다.
const EMPTY_STATE = { lastRef: '', bookmarks: [], highlights: [], recentSearches: [] };
const arr = (v) => (Array.isArray(v) ? v : []);

// ── 최근 검색어 (0065 · 사용자 요청 2026-09-14) ─────────────────────────────
// 모양은 `[{ q, at }, …]`이고 **최신이 앞**이다. 상한 30·중복 제거·오래된 것 버리기를
// DB가 아니라 여기서 하는 이유는 0065 머리말에 있다 — 화면이 배열 전체를 들고 다시
// 쓰는 구조라, 트리거를 두면 자르는 규칙이 두 곳으로 갈린다.
//
// 순수 함수로 떼어 둔다(§3-5) — `.js`라 노드에서 그대로 검사된다(tests/logcheck.mjs).
export const RECENT_SEARCH_MAX = 30;

// 들어온 값을 믿지 않는다. 옛 행·손으로 넣은 값이 섞이면 화면이 빈 줄을 그린다.
const recentRows = (list) => arr(list)
  .map(r => ({ q: String(r?.q ?? '').trim(), at: String(r?.at ?? '') }))
  .filter(r => r.q);

// ── 성경 낱말 검색의 맞춤 (2026-09-25) ────────────────────────────────────
// **띄어쓰기를 지우고 견준다.** 개역한글은 띄어쓰기가 오늘 맞춤법과 달라('사랑 하는'·'하나님의 아들')
// 사람이 친 대로 견주면 0건이 흔했다. 상단 검색(layout.jsx norm)과 같은 판단이다 — 공백만 지운다
// (한글에는 대소문자가 없고, 영문이 섞일 일도 없다). 절 안의 **원래 글자 자리**도 돌려줘야 결과 줄에서
// 찾은 말을 칠할 수 있어서, 지운 글자에서 찾은 자리를 원문 자리로 되돌린다.
export const compactText = (s) => String(s || '').replace(/\s+/g, '');

// text 안에서 q가 나오는 자리들 — 공백은 양쪽 다 무시한다. [[시작, 끝), …] 원문 인덱스, 겹치지 않게 앞에서부터.
export function matchRanges(text, q) {
  const str = String(text || '');
  const needle = compactText(q);
  if (!needle) return [];
  const at = [];            // 지운 글자 i → 원문 자리
  let packed = '';
  for (let i = 0; i < str.length; i++) {
    if (/\s/.test(str[i])) continue;
    at.push(i); packed += str[i];
  }
  const out = [];
  for (let from = packed.indexOf(needle); from >= 0; from = packed.indexOf(needle, from + needle.length)) {
    out.push([at[from], at[from + needle.length - 1] + 1]);
  }
  return out;
}

// **검색이 시작될 때 한 번** 부른다(글자를 칠 때마다 부르면 '사'·'사사'·'사사기'가
// 세 줄로 쌓인다). 같은 검색어면 줄을 새로 쌓지 않고 **맨 위로 올리면서 시각만** 간다.
export function pushRecentSearch(list, q, at = new Date().toISOString()) {
  const rows = recentRows(list);
  const text = String(q ?? '').trim();       // 앞뒤 공백은 다듬는다
  if (!text) return rows;                    // 빈 글자는 남기지 않는다
  return [{ q: text, at: String(at ?? '') }, ...rows.filter(r => r.q !== text)]
    .slice(0, RECENT_SEARCH_MAX);            // 넘치면 **가장 오래된 것**이 뒤에서 빠진다
}

// 한 줄만 지운다. 비교 기준은 남길 때와 같다(다듬은 글자).
export function removeRecentSearch(list, q) {
  const text = String(q ?? '').trim();
  return recentRows(list).filter(r => r.q !== text);
}

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
      .select('last_ref, bookmarks, highlights, recent_searches').eq('profile_id', uid).maybeSingle();
    if (error) throw error;
    return {
      lastRef: data?.last_ref || '', bookmarks: arr(data?.bookmarks), highlights: arr(data?.highlights),
      recentSearches: recentRows(data?.recent_searches),
    };
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
        recent_searches: recentRows(next.recentSearches),   // 모양만 고른다 — 자르는 것은 pushRecentSearch 하나다
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

// ── AI 본문 검색 캐시 (0057) ────────────────────────────────────────────────
// 같은 물음은 **누가 물어도** 한 번만 AI로 나간다(사용자 요청 2026-09-09). 열쇠와
// 담는 모양은 bibleSearch가 정하고(normalizeQuery · 참조 문자열 배열) 여기는 왕복만
// 한다 — 그 파일은 순수하게 남아야 노드에서 그대로 검사된다(bibleSearch.js 머리말).
//
// 캐시는 **있으면 좋은 것**이다. 읽기가 실패하면 null을 돌려 AI로 보내고, 쓰기가
// 실패하면 삼킨다(같은 순간 남이 먼저 넣으면 23505다 — 그건 캐시가 채워진 것이니
// 오류가 아니다). 캐시 때문에 검색이 안 되는 일이 없어야 한다.
//
// 게스트 모드에는 갈래가 없다 — ai.aiEnabled()가 거짓이면 wordBible이 검색을 아예
// 안 부르므로 이 함수까지 오지 않는다(§6-9-ar).
export const bibleSearchStore = {
  get: async (key) => {
    if (!supabase) return null;
    const { data, error } = await supabase.from('bible_search_cache')
      .select('refs').eq('query_norm', key).maybeSingle();
    if (error) { console.error('[word] 검색 캐시를 읽지 못했어요:', error); return null; }
    return Array.isArray(data?.refs) ? data.refs : null;
  },
  set: async (key, refs) => {
    if (!supabase || !Array.isArray(refs) || !refs.length) return;
    const { error } = await supabase.from('bible_search_cache')
      .insert({ query_norm: key, refs });
    // 23505 = 같은 순간 남이 먼저 넣었다. 그건 성공과 같다.
    if (error && error.code !== '23505') console.error('[word] 검색 캐시를 남기지 못했어요:', error);
  },
};
