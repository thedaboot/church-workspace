// ============================================================================
// 내 달력 — 프로젝트 달력의 업무를 **내 폰·구글 달력에 구독**으로 넣는다 (2026-09-28 · 목업 v3 승인)
// ----------------------------------------------------------------------------
// 프로젝트 달력 머리 오른쪽 끝의 `내 달력` → 업무를 골라 넣는다 → 고른 것은 서버에 한 줄
// (`calendar_feeds` · 0085)로 두고 **주소는 그대로**다(고른 것을 바꿔도 달력 앱을 다시 붙일 필요가 없다).
// 달력 앱은 그 주소(`/cal/<feed>/<서명>.ics`)를 한 시간쯤마다 다시 읽는다 — 마감을 바꾸면 몇 시간 뒤에 따라온다.
//
// **이 파일은 화면(components/calendarFeed.jsx)과 서버(api/ics.js)가 같이 쓴다** — 무엇이 달력에
// 들어가는지(날짜가 있고 상시가 아닌 업무)를 두 쪽이 같은 규칙으로 봐야 "골랐는데 안 들어간다"가
// 안 생긴다. import는 순수 모듈(noticeDate.js)뿐이라 노드에서 그대로 돈다(tests/logcheck).
//
// 넣는 길(목업 '버튼'):
//   아이폰·아이패드  `아이폰 달력에 추가` → webcal://(시스템이 '구독' 화면을 띄운다) + `주소 복사`
//   안드로이드       `구글 캘린더에 추가` → calendar.google.com/calendar/r?cid=<webcal> + `주소 복사`
//   Mac             `구글 캘린더에 추가` + [`Mac 캘린더에 추가`(webcal) | `주소 복사`] 나란히
//   그 밖 데스크톱   `구글 캘린더에 추가` + `주소 복사`
//   카카오 인앱      위 주소를 kakaoExternal로 기본 브라우저에 넘긴다(광고 → 내 달력과 같은 길 · 실기기 확인 대상)
// 복사는 **https 주소**다(webcal은 붙여 넣을 자리가 받지 않는 곳이 많다).
// ============================================================================
import { icsText, fold, kakaoExternal, ymd, stampUtc } from './noticeDate.js';

const DAY = 86400000;
const md = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

// DB 상태 → 앱 글자. config.js의 STATUS_DB를 뒤집은 것과 같아야 한다(logcheck가 견준다) —
// 서버가 config.js(화면 상수 한 벌)까지 끌어오지 않게 여기 적었다.
export const STATUS_KO = { todo: '시작 전', doing: '진행 중', hold: '보류 중', done: '완료', ongoing: '상시' };

// 업무의 기간 — 시작일이 없으면 마감일 하루, 마감일이 없으면 시작일 하루(calendar.jsx spanOf와 같은 규칙)
export function feedSpan(t) {
  const end = t?.dueDate || t?.startDate || '';
  const start = t?.startDate || end;
  if (!end) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

// 목록 줄의 날짜 — `10월 11일` · `10월 4일 ~ 25일` · 달을 넘으면 `9월 28일 ~ 10월 3일`
export function feedDateLabel(t) {
  const s = feedSpan(t);
  if (!s) return '';
  if (s.start === s.end) return md(s.start);
  if (s.start.slice(0, 7) === s.end.slice(0, 7)) return `${md(s.start)} ~ ${Number(s.end.slice(8, 10))}일`;
  return `${md(s.start)} ~ ${md(s.end)}`;
}

// 고를 수 있는 업무 — 날짜가 있고 상시가 아닌 것. 이른 날부터, 같으면 제목순.
export function feedPickable(tasks) {
  return (tasks || []).filter(t => t && t.status !== '상시' && feedSpan(t))
    .map(t => ({ t, s: feedSpan(t) }))
    .sort((a, b) => a.s.start.localeCompare(b.s.start) || a.s.end.localeCompare(b.s.end)
      || String(a.t.title || '').localeCompare(String(b.t.title || ''), 'ko'))
    .map(x => x.t);
}

// 처음 열 때 골라 둘 것 — 내가 담당자인 업무(없으면 아무것도 고르지 않는다)
export const feedDefaultPick = (pickable, myName) =>
  (myName ? (pickable || []).filter(t => (t.assignees || []).includes(myName)).map(t => t.id) : []);

// 목록 위 설명 한 줄(목업 문구 그대로)
export function feedSentence(titles) {
  const n = (titles || []).length;
  if (!n) return '내 달력에 넣을 업무를 골라 주세요.';
  if (n <= 2) return `${titles.join(', ')} 업무가 내 달력에 일정으로 들어가요.`;
  return `${titles.slice(0, 2).join(', ')} 업무 외 ${n - 2}건이 내 달력에 일정으로 들어가요.`;
}

// ── 기기 → 버튼 ──────────────────────────────────────────────────────────────
// 아이패드(iPadOS 13+ Safari)는 UA가 Mac이라 터치 점 수로 가른다. Mac의 크롬·파이어폭스 UA에는
// `Chrome/`·`Firefox/`가 있고 아이패드의 그 둘은 `CriOS`·`FxiOS`라 — 터치 화면을 단 기기에서 Mac UA로
// 흉내 낸 크롬(검사 · 개발자 도구)이 아이폰 버튼으로 떨어지지 않게 그 둘은 뺀다.
export function feedDevice(ua = '', touchPoints = 0) {
  const s = String(ua || '');
  const kakao = /KAKAOTALK/i.test(s);
  const ipadAsMac = /Macintosh/i.test(s) && touchPoints > 1 && !/Chrome\/|Firefox\//.test(s);
  if (/iPhone|iPad|iPod/i.test(s) || ipadAsMac) return { os: 'ios', kakao };
  if (/Android/i.test(s)) return { os: 'android', kakao };
  if (/Macintosh|Mac OS X/i.test(s)) return { os: 'mac', kakao };
  return { os: 'desktop', kakao };
}

// → [{ act: 'webcal'|'google'|'copy', label, primary? }] — 첫 줄이 주 버튼, 나머지는 그 아래
// (둘이면 나란히 · 하나면 한 줄). mobile은 아래 창(시트)의 큰 버튼 크기를 고른다.
const COPY = { act: 'copy', label: '주소 복사' };
const GOOGLE = { act: 'google', label: '구글 캘린더에 추가', primary: true };
export function feedButtons(dev) {
  switch (dev?.os) {
    case 'ios': return [{ act: 'webcal', label: '아이폰 달력에 추가', primary: true }, COPY];
    case 'android': return [GOOGLE, COPY];
    case 'mac': return [GOOGLE, { act: 'webcal', label: 'Mac 캘린더에 추가' }, COPY];
    default: return [GOOGLE, COPY];
  }
}
export const feedIsMobile = (dev) => dev?.os === 'ios' || dev?.os === 'android';

// ── 주소 ────────────────────────────────────────────────────────────────────
export const feedPath = (id, sig) => `/cal/${id}/${sig}.ics`;
// host는 요청의 Host 머리(`church-workspace.vercel.app`) · proto는 x-forwarded-proto(로컬 dev는 http)
export function feedUrls(host, id, sig, proto = 'https') {
  const p = feedPath(id, sig);
  return { url: `${proto}://${host}${p}`, webcal: `webcal://${host}${p}` };
}
export const googleSubscribeUrl = (webcal) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

// 버튼 하나 → 어디로 어떻게 여는지. 'window'는 새 창(window.open), 'location'은 이 창에서 연다
// (webcal은 시스템이 달력 앱으로 넘기므로 이 창이 떠나지 않는다). 복사는 null — 부르는 쪽이 url을 쓴다.
export function feedHref(act, urls, kakao = false) {
  if (!urls?.webcal) return null;
  let href;
  if (act === 'webcal') href = urls.webcal;
  else if (act === 'google') href = googleSubscribeUrl(urls.webcal);
  else return null;
  if (kakao) return { href: kakaoExternal(href), how: 'location' };
  return { href, how: act === 'google' ? 'window' : 'location' };
}

// ── .ics(구독 한 벌) ─────────────────────────────────────────────────────────
// 앱의 업무 딥링크(App.jsx가 읽는 `?p=&t=` · ai.js taskLink와 같은 모양)
export const taskLink = (origin, projectId, cardId) =>
  `${origin}/?p=${encodeURIComponent(projectId)}&t=${encodeURIComponent(cardId)}`;

// DB 행(서비스 키로 읽은 cards) → 달력에 들어갈 것인가. 지워진 것·다른 프로젝트로 간 것은 조회가 거르고,
// 날짜를 잃은 것·상시가 된 것은 여기서 빠진다. 완료는 남는다(상태 줄이 `완료`).
export const feedKeepRow = (row) => !!row && row.status !== 'ongoing' && !!(row.start_date || row.due_date);

// 업무 하나 → 하루 종일 일정 하나. end는 **다음 날**이다(DTEND;VALUE=DATE는 그 날을 빼고 센다).
export function feedEvent(task, link) {
  const s = feedSpan(task);
  if (!s) return null;
  const who = (task.assignees || []).filter(Boolean);
  const title = String(task.title || '').trim() || '업무';
  const description = [`${title} · ${task.status || ''}`.trim(), who.length ? `담당자 ${who.join(', ')}` : null,
    '더다붓 워크스페이스에서 열기', link].filter(Boolean).join('\n');
  return { uid: `card-${task.id}@thedaboot`, title, description, start: s.start,
    end: ymd(Date.parse(`${s.end}T00:00:00Z`) + DAY), url: link };
}

// { calName, events, now } → text/calendar(CRLF · 75옥텟 접기 · RFC 5545 이스케이프)
export function buildFeedIcs({ calName, events = [], now = Date.now() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//thedaboot//project//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calName)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const stamp = stampUtc(now);
  for (const ev of events) {
    if (!ev) continue;
    lines.push('BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ev.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${ev.end}`,
      `SUMMARY:${icsText(ev.title)}`);
    if (ev.description) lines.push(`DESCRIPTION:${icsText(ev.description)}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ── 고른 것 저장 줄 세우기 ───────────────────────────────────────────────────
// 체크를 빠르게 여러 번 눌러도 ① 400ms 모아 한 번 ② **한 번에 하나만** 보낸다(보내는 중에 또 바뀌면
// 끝난 뒤 마지막 것을 한 번 더) ③ 늦게 온 옛 응답은 버린다(번호표). 보내는 것은 늘 **고른 것 전체**라
// 두 번 가도 결과가 같다(서버는 upsert 한 줄). 응답으로 바꾸는 것은 주소뿐이다 — 고른 것은 화면이 원본이고,
// 서버 응답이 화면의 체크를 되돌리지 않는다(주소는 줄 id라 응답마다 같다).
export function createFeedSaver(send, { delay = 400, onDone = null, onFail = null, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let latest = null, timer = null, busy = false, again = false, seq = 0, applied = 0;
  const run = async () => {
    timer = null;
    if (latest === null) return;
    if (busy) { again = true; return; }
    busy = true;
    const mine = ++seq;
    const cards = latest;
    try {
      const out = await send(cards);
      if (mine > applied) { applied = mine; onDone?.(out, cards); }
    } catch (e) {
      onFail?.(e);
    } finally {
      busy = false;
      if (again) { again = false; void run(); }
    }
  };
  return {
    set(cards) {
      latest = [...cards];
      if (timer) clearTimer(timer);
      timer = setTimer(run, delay);
    },
    // 창을 닫을 때 · 버튼을 누를 때 — 기다리는 것을 바로 보낸다(누른 그 자리의 새 창 열기는 막지 않는다)
    flush() {
      if (!timer) return;
      clearTimer(timer);
      void run();
    },
    get pending() { return !!timer || busy; },
  };
}

export const feedCalName =(projectName) => `더다붓 · ${String(projectName || '').trim() || '프로젝트'}`;
