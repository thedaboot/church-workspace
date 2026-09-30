// ============================================================================
// AI 글의 순수 조각 — 프롬프트에 싣는 날짜 글자 · 모델 답 뒤처리 · 요약 모양 판정.
// **import가 없다** — services/ai.js와 sunGuide.js가 같이 쓰고, tests/logcheck이 그대로 읽는다.
// ============================================================================

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → 로컬 Date. new Date('2026-10-11')은 UTC 자정이라 한국에서 하루가 밀리지 않지만
// 서쪽 시간대에서는 밀린다 — 문자열을 쪼개 로컬로 만든다.
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// 주일이면 그 주일의 달 규칙 — 둘째 주일은 성찬 예배, 마지막 주일은 Q예배(docs/AI.md §2.2).
// 모델에게 규칙만 주면 날짜가 몇째 주인지 스스로 셈해야 하고, 거기서 틀린다 — 코드가 셈해 붙인다.
export function sundayNote(iso) {
  const d = parseIso(iso);
  if (!d || d.getDay() !== 0) return '';
  const day = d.getDate();
  if (day >= 8 && day <= 14) return '둘째 주 성찬 예배';
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (day + 7 > last) return '마지막 주 Q예배';
  return '';
}

// 프롬프트의 날짜 한 칸 — `2026-10-11(일 · 둘째 주 성찬 예배 · 준비는 10일(토)까지)`.
// 요일은 언제나 붙는다(AI가 ISO 글자만 보고 요일을 못 맞힌다). `due`면 주일 마감에 전날 준비를 붙인다
// (달력 규칙 "마감이 주일이면 준비는 그 전날까지"를 모델이 셈하지 않게).
export function dateLabel(iso, { due = false } = {}) {
  if (!iso) return iso;
  const d = parseIso(iso);
  if (!d) return iso;
  const notes = [DOW[d.getDay()]];
  const sn = sundayNote(iso);
  if (sn) notes.push(sn);
  if (due && d.getDay() === 0) {
    const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const md = sat.getMonth() === d.getMonth() ? `${sat.getDate()}일` : `${sat.getMonth() + 1}월 ${sat.getDate()}일`;
    notes.push(`준비는 ${md}(토)까지`);
  }
  return `${iso}(${notes.join(' · ')})`;
}

// '2026-10-03' → '10월 3일(토)' (하위 업무 기한)
export function koDay(iso) {
  const d = parseIso(iso);
  return d ? `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})` : String(iso || '');
}

// 하위 업무 한 칸 — `송폼 제작(담당 한가람 · 10월 3일(토))`. 담당·기한이 없으면 제목만.
export function subtaskLabel(x) {
  const extra = [x?.assignee ? `담당 ${x.assignee}` : '', x?.due ? koDay(x.due) : ''].filter(Boolean);
  return extra.length ? `${x.title}(${extra.join(' · ')})` : x?.title;
}

// 댓글 타임라인 — `[9/24(수)] 이름: 본문`, 답글은 들여 쓴다. **최근 20개만** 싣고 그 앞은 개수만 적는다
// (댓글이 긴 카드에서 프롬프트가 끝없이 커지고, 요약에 필요한 것은 최근 흐름이다).
export const COMMENT_LIMIT = 20;
const shortDay = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d && !Number.isNaN(d.getTime()) ? `[${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})] ` : '';
};
export function commentTimeline(comments, limit = COMMENT_LIMIT) {
  const list = (comments || []).filter(c => c && (c.text || '').trim());
  if (!list.length) return '';
  const time = (c) => String(c.timestamp || '');
  // 최근 limit개를 고른다 — 시각이 없는 것은 원래 차례를 따른다(sort는 안정적이다)
  const byTime = list.map((c, i) => ({ c, i })).sort((a, b) => time(a.c).localeCompare(time(b.c)) || a.i - b.i);
  const kept = new Set(byTime.slice(-limit).map(x => x.c));
  const omitted = list.length - kept.size;
  // 차례는 스레드 순서 — 최상위 댓글 뒤에 그 답글. 부모가 잘려 나간 답글은 제자리에 들여 쓴다.
  const tops = list.filter(c => !c.parentId || !list.some(p => p.id === c.parentId));
  const lines = [];
  const line = (c, reply) => `${reply ? '  ↳ ' : ''}${shortDay(c.timestamp)}${c.author || '이름 미상'}: ${c.text}`;
  for (const top of tops) {
    if (kept.has(top)) lines.push(line(top, !!top.parentId));
    list.filter(r => r.parentId && r.parentId === top.id && kept.has(r)).forEach(r => lines.push(line(r, true)));
  }
  return [omitted > 0 ? `(그 앞 댓글 ${omitted}개 생략)` : '', ...lines].filter(Boolean).join('\n');
}

// 엠/엔 대시를 일반 하이픈으로 — 프롬프트 규칙(DASH_RULE)만으로는 가끔 새어 나온다. 주소 안은 건드리지 않는다
// (주소의 글자를 바꾸면 링크가 다른 곳을 가리킨다).
const URL_RE = /https?:\/\/[^\s)\]>]+/g;
export function plainDashes(text) {
  const s = String(text ?? '');
  let out = '';
  let at = 0;
  for (const m of s.matchAll(URL_RE)) {
    out += s.slice(at, m.index).replace(/[—–]/g, '-') + m[0];
    at = m.index + m[0].length;
  }
  return out + s.slice(at).replace(/[—–]/g, '-');
}

// 요약이 약속한 3줄 모양인가 — `1. **현황** - …` / `2. **챙길 것** - …` / `3. **다음 단계** - …`.
// 모양이 깨진 답은 보여 주되 캐시에 넣지 않는다(다시 누르면 새로 묻는다).
const SUMMARY_LINES = [/^1\. \*\*현황\*\* - \S/, /^2\. \*\*챙길 것\*\* - \S/, /^3\. \*\*다음 단계\*\* - \S/];
export function isSummaryShape(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length === SUMMARY_LINES.length && SUMMARY_LINES.every((re, i) => re.test(lines[i]));
}
