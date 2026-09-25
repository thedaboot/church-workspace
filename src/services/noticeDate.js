// ============================================================================
// 광고 → 내 달력 (방식 가 · 2026-09-25 사용자 결정)
// ----------------------------------------------------------------------------
// 주보 쓰는 사람에게는 아무것도 더하지 않는다 — **보여 줄 때** 광고 제목+내용에서 날짜를
// 읽고, 읽힌 광고의 본문 아래에만 날짜 칩이 선다(worshipDetail NoticeCard). 누르면 `.ics`로
// **폰 기본 달력**에 넣는다(우리 '전체 일정'이 아니다). 못 읽은 광고에는 아무것도 없다.
//
// **이 파일은 화면과 서버가 같이 쓴다** — 칩을 세울지(화면)와 .ics를 만들지(api/ics.js)가
// 같은 파서를 봐야 "칩은 섰는데 누르면 없다"가 안 생긴다. 그래서 import가 없다(노드에서 그대로).
//
// 읽기 규칙(목업 권장안 그대로):
//   날짜  `M월 D일` · `YYYY년 M월 D일` · `M/D` · `M.D` · `D일`(달이 없으면 주보 날짜 뒤 31일 안의 그 날)
//   시각  `오전/오후 H시` · `… H시 M분` · `… H시 반` · `H:MM` — 없으면 하루 종일, 있으면 1시간짜리
//   요일  날짜 바로 뒤 괄호 `(일)`·`(주일)`·`(토요일)`가 있으면 맞춰 보고 **틀리면 칩 없음**
//         (잘못 읽었을 가능성이 크다)
//   거름  **주보 날짜보다 뒤인 날만** · **'생일'이 든 줄은 통째로 건너뜀**(교우동정의
//         '생일자: 조현재 형제 9/20'이 일정이 되지 않게) · 달만(`9월 월례회`) · 연도만(`27년도`) ·
//         **'다음 주' 같은 상대 말은 읽지 않는다**(담당자 명단 광고까지 일정이 된다)
// 라이브 광고(9/6·9/13·9/20 13건)는 지금 하나도 읽히지 않는다 — 달만·상대 말·빈 본문이라 정상이다.
// ============================================================================

const DAY = 86400000;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const U = (y, m, d) => Date.UTC(y, m - 1, d);
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);

// 달·날이 실제로 있는 날인가(2월 30일 같은 것은 Date가 3월로 넘겨 버린다)
const real = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31
  && new Date(U(y, m, d)).getUTCMonth() === m - 1;

// 첫 날짜 표기를 찾는다 → { y?, m?, d, end } | null. 순서가 곧 우선순위다.
function findDate(s) {
  let m;
  if ((m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(s))) return { y: +m[1], m: +m[2], d: +m[3], end: m.index + m[0].length };
  if ((m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(s))) return { m: +m[1], d: +m[2], end: m.index + m[0].length };
  // `M/D`·`M.D` — 앞뒤에 숫자·점·빗금이 붙으면 날짜가 아니다('예배 2.0' · '1.5배' · '2026.09.20')
  if ((m = /(^|[^\d./])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d./]|\s*(?:배|%))/.exec(s))) {
    return { m: +m[2], d: +m[3], end: m.index + m[0].length };
  }
  // `D일` — '3일간'·'이틀째' 같은 기간은 날짜가 아니다. 앞이 '월'이면 위에서 이미 읽었다.
  if ((m = /(^|[^\d월])(\d{1,2})\s*일(?!\s*(?:간|동안|째))/.exec(s))) return { d: +m[2], end: m.index + m[0].length };
  return null;
}

function findTime(s) {
  let m;
  if ((m = /(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/.exec(s))) {
    const h = +m[2];
    if (h < 1 || h > 12) return null;
    const mm = m[3] ? +m[3] : (m[4] ? 30 : 0);
    if (mm > 59) return null;
    return { h: (h % 12) + (m[1] === '오후' ? 12 : 0), mm };
  }
  if ((m = /(^|[^\d:])(\d{1,2}):(\d{2})(?![\d:])/.exec(s))) {
    const h = +m[2], mm = +m[3];
    if (h > 23 || mm > 59) return null;
    return { h, mm };
  }
  return null;
}

// 광고 한 건 + 주보 날짜 → { date: 'YYYY-MM-DD', time: 'HH:MM' | null } | null
export function readNoticeDate(notice, serviceDate) {
  const base = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(serviceDate || ''));
  if (!base) return null;
  const by = +base[1], bm = +base[2], bd = +base[3];
  const b = U(by, bm, bd);
  // '생일'이 든 줄은 통째로 뺀다 — 제목 줄도 같다(제목이 '생일 축하'면 광고 전체가 생일 이야기다)
  const text = [notice?.title, notice?.body].map(v => String(v || '')).join('\n')
    .split('\n').filter(line => !/생일/.test(line)).join('\n');
  const f = findDate(text);
  if (!f) return null;
  let y = f.y ?? by;
  let mo = f.m;
  const d = f.d;
  if (mo == null) {
    // 달이 없는 `D일` — 이번 달의 그 날이 이미 지났으면(당일 포함) 다음 달이다. 31일 안이어야 한다.
    mo = bm;
    if (!real(y, mo, d) || U(y, mo, d) <= b) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    if (!real(y, mo, d) || U(y, mo, d) - b > 31 * DAY) return null;
  } else if (f.y == null && real(y, mo, d) && U(y, mo, d) < b - 60 * DAY) {
    // 연말 주보의 `1월 3일`은 새해다(두 달 넘게 지난 날을 적을 일은 없다)
    y += 1;
  }
  if (!real(y, mo, d)) return null;
  const t = U(y, mo, d);
  // 요일 괄호는 **날짜 바로 뒤**의 것만 본다(다른 날의 요일을 견주지 않게)
  const wd = /^\s*\(\s*(주일|일|월|화|수|목|금|토)(?:요일)?\s*\)/.exec(text.slice(f.end));
  if (wd) {
    const want = wd[1] === '주일' ? '일' : wd[1];
    if (WD[new Date(t).getUTCDay()] !== want) return null;
  }
  if (t <= b) return null;               // 주보 날짜보다 뒤인 날만(당일 광고는 이미 알고 있다)
  const tm = findTime(text);
  return { date: isoOf(t), time: tm ? `${pad(tm.h)}:${pad(tm.mm)}` : null };
}

// 칩 글자 — `10월 11일 (일) 오후 2:00`. 칩 글자가 곧 "무엇을 읽었는지"의 확인이고 이름표다.
export function noticeDateLabel(r) {
  if (!r?.date) return '';
  const [y, m, d] = r.date.split('-').map(Number);
  let s = `${m}월 ${d}일 (${WD[new Date(U(y, m, d)).getUTCDay()]})`;
  if (r.time) {
    const [h, mm] = r.time.split(':').map(Number);
    s += ` ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(mm)}`;
  }
  return s;
}

// ── 일정 한 건의 글자들 ─────────────────────────────────────────────────────
// 제목은 광고 제목, 설명은 광고 본문 + 어느 주보의 광고인지(`2026.09.20 주일 4부 젊은이 예배 광고`).
// 시각은 **한국 시간**이다(교회가 한국에 있다) — .ics는 UTC(Z)로, 구글 주소는 ctz로 싣는다.
const kstToUtc = (date, time) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h - 9, mm);
};
const stampUtc = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

// RFC 5545 글자 이스케이프 + 75옥텟 접기(한글은 3옥텟이라 글자 수로 자르면 넘는다)
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// { uid, title, description, date, time, now? } → .ics 글자(CRLF)
export function buildIcs({ uid, title, description = '', date, time = null, now = Date.now() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//thedaboot//worship//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stampUtc(now)}`];
  if (time) {
    const s = kstToUtc(date, time);
    lines.push(`DTSTART:${stampUtc(s)}`, `DTEND:${stampUtc(s + 3600000)}`);
  } else {
    const s = Date.parse(`${date}T00:00:00Z`);
    lines.push(`DTSTART;VALUE=DATE:${ymd(s)}`, `DTEND;VALUE=DATE:${ymd(s + DAY)}`);
  }
  lines.push(`SUMMARY:${icsText(title)}`);
  if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// 안드로이드 — 구글 캘린더 앱은 .ics를 못 여는 기기가 많아 템플릿 주소로 보낸다(앱이 받는다).
// 시각은 ctz로 한국 시간을 그대로 싣는다(Z로 바꾸지 않는다).
export function googleCalendarUrl({ title, description = '', date, time = null }) {
  const d = date.replace(/-/g, '');
  let dates;
  if (time) {
    const [h, mm] = time.split(':').map(Number);
    const endH = h + 1;
    const next = endH >= 24 ? ymd(Date.parse(`${date}T00:00:00Z`) + DAY) : d;
    dates = `${d}T${pad(h)}${pad(mm)}00/${next}T${pad(endH % 24)}${pad(mm)}00`;
  } else {
    dates = `${d}/${ymd(Date.parse(`${date}T00:00:00Z`) + DAY)}`;
  }
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title || '', dates, details: description, ctz: 'Asia/Seoul' });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// 카카오 인앱 웹뷰는 text/calendar를 받아도 아무 일도 안 하거나 내려받기로 떨어진다 — 같은 주소를
// 기본 브라우저(아이폰 Safari · 안드로이드 Chrome)로 넘긴다. 안내 문구는 붙이지 않는다(실기기 확인 대상).
export const kakaoExternal = (absUrl) => `kakaotalk://web/openExternal?url=${encodeURIComponent(absUrl)}`;

// 일정 설명 한 벌(화면의 blob · 서버의 .ics · 구글 주소가 같은 글자를 쓴다)
export function noticeEvent(service, notice, index, r, kindText) {
  const date = String(service?.service_date || '').slice(0, 10).replace(/-/g, '.');
  const body = String(notice?.body || '').trim();
  return {
    uid: `${service?.id || 'service'}-${index}@thedaboot`,
    title: String(notice?.title || '').trim() || '광고',
    description: [body, `(${date} ${kindText} 광고)`].filter(Boolean).join('\n'),
    date: r.date, time: r.time,
  };
}
