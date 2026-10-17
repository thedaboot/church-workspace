// ============================================================================
// 운영 화면의 순수 규칙(시안 v5 2묶음 · mock/b3 · import 0 — tests/logcheck-live가 노드에서 그대로 들인다)
// ----------------------------------------------------------------------------
// 화면은 components/opsDesk.jsx, 저장 자리(게스트 시연)는 services/opsDemo.js.
//   · 화면 오류 묶기(groupErrors) — 같은 오류는 **지문(fingerprint)** 하나로 센다: 문구의 숫자·id·주소를 걷은 글 +
//     스택 맨 위 줄의 함수·파일(빌드마다 바뀌는 해시·줄 번호는 뺀다). 그래야 배포가 바뀌어도 같은 오류가 한 줄에 모인다.
//   · 기기·브라우저 이름(deviceOf) — user agent에서 사람이 읽는 이름 둘만.
//   · 다붓이 답변 속도(speedStats) — 기간 안의 중간값 · 느린 답 비율 · 최근 느린 질문. **사람 칸이 없다**
//     (누가 물었는지 견주지 않는다 — HANDOFF §8 '누가 누구와 견주는 구조를 만들지 마세요').
//   · 불편 사항 셈(feedbackCounts) · 관리 기록 거르기(filterAudit) · 날짜 묶음(byDay).
// ============================================================================

const DAY = 86400000;

// ── 화면 오류 ──────────────────────────────────────────────────────────────
export const normMessage = (m) => String(m || '')
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
  .replace(/\d+/g, 'N')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200);

// 스택 맨 위의 우리 코드 한 줄 → 'fn@file' (assets/index-AbC123.js → index.js · 줄·칸 번호 없음)
export function topFrame(stack) {
  for (const line of String(stack || '').split('\n')) {
    const m = /at\s+(?:(\S+)\s+\()?(.*?):\d+:\d+\)?\s*$/.exec(line.trim())
      || /^(\S*)@(.*?):\d+:\d+$/.exec(line.trim());   // 사파리·파이어폭스 모양 fn@file:1:2
    if (!m) continue;
    const file = (m[2].split(/[?#]/)[0].split('/').pop() || '').replace(/-[A-Za-z0-9_]{6,}(?=\.\w+$)/, '');
    return `${m[1] || '?'}@${file}`;
  }
  return '';
}

export const errorFingerprint = (ev) => `${normMessage(ev.message)}|${topFrame(ev.stack)}`;

const countTop = (vals) => {
  const m = new Map();
  vals.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

// events: [{ at, message, stack, route, ua?, device?, browser?, build, user }] → 지문마다 한 줄(마지막으로 난 차례)
export function groupErrors(events, { since = 0 } = {}) {
  const groups = new Map();
  for (const ev of events) {
    const t = new Date(ev.at).getTime();
    if (!(t >= since)) continue;
    const fp = errorFingerprint(ev);
    let g = groups.get(fp);
    if (!g) { g = { fp, message: ev.message, events: [] }; groups.set(fp, g); }
    g.events.push(ev);
  }
  return [...groups.values()].map(g => {
    const evs = g.events.sort((a, b) => new Date(b.at) - new Date(a.at));
    const dev = evs.map(e => (e.device ? e : { ...e, ...deviceOf(e.ua) }));
    return {
      fp: g.fp,
      message: evs[0].message,
      count: evs.length,
      people: new Set(evs.map(e => e.user).filter(Boolean)).size,
      lastSeen: evs[0].at,
      firstSeen: evs[evs.length - 1].at,
      routes: countTop(evs.map(e => e.route)),
      devices: countTop(dev.map(e => [e.device, e.browser].filter(Boolean).join(' · '))),
      builds: countTop(evs.map(e => e.build)),
      stack: evs[0].stack || '',
      events: evs,
    };
  }).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
}

// user agent → { device, browser } (사람이 읽는 이름 · 모르면 '기타')
export function deviceOf(ua = '') {
  const s = String(ua);
  const device = /iPad/.test(s) || (/Macintosh/.test(s) && /Mobile\//.test(s)) ? 'iPad'
    : /iPhone/.test(s) ? 'iPhone'
    : /Android/.test(s) ? (/SM-|Samsung/i.test(s) ? '갤럭시' : '안드로이드')
    : /Windows/.test(s) ? 'Windows'
    : /Macintosh|Mac OS X/.test(s) ? 'Mac' : '기타';
  const browser = /KAKAOTALK/i.test(s) ? '카카오톡'
    : /SamsungBrowser/.test(s) ? '삼성 인터넷'
    : /Edg\//.test(s) ? 'Edge'
    : /Firefox|FxiOS/.test(s) ? 'Firefox'
    : /CriOS|Chrome\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : '기타';
  return { device, browser };
}

// ── 다붓이 답변 속도 ───────────────────────────────────────────────────────
export const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// samples: [{ at, ms, q, findMs?, writeMs?, cached? }] — 사람 칸은 받지 않는다
export function speedStats(samples, { now = Date.now(), days = 7, slowMs = 8000, recent = 8 } = {}) {
  const since = now - days * DAY;
  const inRange = samples.filter(s => new Date(s.at).getTime() >= since && Number.isFinite(s.ms));
  const ms = inRange.map(s => s.ms);
  const slow = inRange.filter(s => s.ms >= slowMs);
  return {
    count: inRange.length,
    median: median(ms),
    slowRatio: inRange.length ? slow.length / inRange.length : null,
    slowCount: slow.length,
    recentSlow: [...slow].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, recent),
  };
}

// 초 한 자리(2.4초) — 10초 넘거나 딱 떨어지면 정수(8초)
export const secText = (ms) => (ms == null ? '-'
  : ms >= 10000 || ms % 1000 === 0 ? `${Math.round(ms / 1000)}초` : `${(ms / 1000).toFixed(1)}초`);

// ── 불편 사항 · 관리 기록 ─────────────────────────────────────────────────
export const FEEDBACK_STATES = ['new', 'seen', 'fixed'];
export function feedbackCounts(list) {
  const c = { all: list.length, new: 0, seen: 0, fixed: 0 };
  list.forEach(f => { if (c[f.status] != null) c[f.status] += 1; });
  return c;
}

export const filterAudit = (list, kind) => (kind && kind !== 'all' ? list.filter(r => r.kind === kind) : list);

// 화면 주소(?p=) → 화면 이름 — 폰 상단 제목(mobileNav MENU_TITLES)과 같은 말 · 프로젝트는 부르는 쪽이 이름을 넘긴다
const SCREEN_NAMES = { home: '홈', dashboard: '업무 대시보드', schedule: '전체 일정', members: '멤버 관리', worship: '예배', word: '말씀', groups: '모임', wiki: '위키', myTasks: '내 업무' };
export function screenOf(route, projectTitle = null) {
  let p = 'home';
  try { p = new URLSearchParams(String(route || '').split('?')[1] || '').get('p') || 'home'; } catch { /* 모양이 다른 주소 */ }
  if (SCREEN_NAMES[p]) return SCREEN_NAMES[p];
  if (p.startsWith('team:')) return `${p.slice(5)} 보드`;
  return projectTitle || '프로젝트';
}

// 날짜 묶음 — [{ key, label, rows }] · label은 오늘 · 어제 · M월 D일(로컬)
export function byDay(rows, now = Date.now()) {
  const key = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const today = key(now);
  const yesterday = key(now - DAY);
  const out = [];
  for (const r of [...rows].sort((a, b) => new Date(b.at) - new Date(a.at))) {
    const k = key(r.at);
    let g = out[out.length - 1];
    if (!g || g.key !== k) {
      const d = new Date(r.at);
      g = { key: k, label: k === today ? '오늘' : k === yesterday ? '어제' : `${d.getMonth() + 1}월 ${d.getDate()}일`, rows: [] };
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}
