// ============================================================================
// 이번 주 이 장을 본 사람 — 순수 판정(import 0 · 0080 bible_reads)
// ----------------------------------------------------------------------------
// 앱(components/wordBible.jsx · services/word.js)과 서버(api/push.js 11:30 배치의 지난주 지우기)가
// **같은 주 셈**을 봐야 해서 순수 모듈로 뗐다 — 서버는 supabaseClient를 끌어올 수 없다.
//
// 남기는 것은 누가 · 어느 장 · 어느 주뿐이다(0080 머리말). 화면은 **나를 빼고 이름순**으로
// 얼굴 셋 + '+N'만 세운다 — 시각·횟수·절이 없으니 '누가 먼저·많이'가 읽힐 자리가 없다(§8).
// ============================================================================

// 장을 이만큼 **넘게** 펼쳐 두었을 때만 적는다(목차에서 훑고 지나간 장이 '본 것'으로 서지 않게)
export const READ_DWELL_MS = 5000;
// 장 머리에 세우는 얼굴 수 — 넘치면 '+N'
export const READ_FACES = 3;

// 그 날이 든 주의 **주일**('YYYY-MM-DD') — 주는 주일~토요일(§8 셈 기준 · word.weekRange와 같은 셈).
// 날짜는 KST 글자(kstToday · api/push kstDate)를 넣는다. UTC로 세우고 UTC로 읽어 시간대가 끼지 않는다.
export function weekStartOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}

// 장 머리에 세울 사람 — 나(me · 합친 계정이면 남긴 계정 id)를 빼고, 이름 없는 줄을 빼고, 같은 사람은 한 번,
// **이름순**(people.byName과 같은 비교). → { all, faces, more }
export function readersView(rows, me = '', faces = READ_FACES) {
  const seen = new Set();
  const all = [];
  for (const r of rows || []) {
    const id = String(r?.profile_id || '');
    const name = String(r?.name || '').trim();
    if (!id || !name || id === me || seen.has(id)) continue;
    seen.add(id);
    all.push({ profile_id: id, name, avatarUrl: String(r?.avatarUrl || '') });
  }
  all.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { all, faces: all.slice(0, faces), more: Math.max(0, all.length - faces) };
}

// 그 주의 QT 구절 중 **이 장에 걸친 날** — [{ qt_date, passage_ref }] 중 parsed(구절 → { bookId, start:{chapter}, end:{chapter} })로
// 이 책·장을 품은 날짜만. 파서는 부르는 쪽이 준다(bibleRef.parseRef는 책 목록이 필요하다).
export function qtDatesCovering(schedule, bookId, chapter, parse) {
  return (schedule || []).filter(s => {
    const p = parse(String(s?.passage_ref || ''));
    return !!p && p.bookId === bookId && p.start.chapter <= chapter && chapter <= p.end.chapter;
  }).map(s => s.qt_date).sort();
}
