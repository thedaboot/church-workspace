// ============================================================================
// 교회력(절기) — 날짜 하나로 그 날의 절기 이름과 색을 정한다 (2026-09-25 사용자 결정)
// ----------------------------------------------------------------------------
// **DB에 칸이 없다.** 주보 날짜(`services.service_date`)만 있으면 부활절 계산으로 나머지가
// 다 나온다 — 사람이 매주 고르게 하면 한 사람 일이 늘고, 큐시트의 '전례색' 줄은 큐시트가 붙은
// 발행본에만 있다(files.text_excerpt · 목록은 files를 읽지 않는다). 그래서 화면은 계산만 쓰고,
// 큐시트와 계산이 같은지는 `tests/logcheck`가 라이브 큐시트 세 장으로 대조한다(다른 해가 오면
// 검사가 먼저 알려 준다).
//
// **표기는 한국 개신교 교회력 관례다**(사용자가 골랐다 — '오순절'이 아니라 '성령강림'):
//   대림절 제N주일 · 성탄절 · 주현절 · 주현절 후 제N주일 · 사순절 제N주일 · 부활주일 ·
//   부활절 제N주일 · 성령강림주일 · 성령강림절 후 제N주일
// 주일이 아닌 날은 번호 없이 그 절기 이름만이다(주보는 거의 주일이지만 금요 예배가 있다).
//
// **색은 특별 절기에만 있다**(`color`): 대림·사순 보라(purple) · 성탄·주현(1/6까지)·부활 흰/금
// (gold) · 성령강림주일 그 주 빨강(red). **연중(주현절 후 · 성령강림절 후)은 null**이고, 화면은
// 그때 절기 초록 대신 우리 기본 톤(accent·night) 그라데이션을 쓴다 — 이름 줄은 연중에도 선다.
// `liturgical`은 전례색 그 자체(연중 = 'green')로, 큐시트 대조 검사만 본다.
//
// 이 파일은 **import가 없다** — 노드(검사)에서 그대로 부른다. 날짜는 'YYYY-MM-DD' 글자를
// UTC 자정으로 세워 일 단위로만 센다(시간대가 끼지 않는다 · worship.formatServiceDate와 같은 판단).
// ============================================================================

const DAY = 86400000;
const U = (y, m, d) => Date.UTC(y, m - 1, d);

// 부활절 — 익명의 그레고리력 알고리즘(Meeus/Jones/Butcher). 1583년 이후 모든 해에 맞다.
export function easterUtc(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return U(y, month, day);
}
export const easterDate = (y) => new Date(easterUtc(y)).toISOString().slice(0, 10);

// 대림절 첫 주일 — 성탄절 **앞** 네 번째 주일(11/27~12/3 사이). 성탄절이 주일이면 그 전 주일이
// 대림 넷째 주일이다(당일은 성탄절이다).
function advent1(y) {
  const x = U(y, 12, 25);
  const dow = new Date(x).getUTCDay();
  return x - (dow === 0 ? 7 : dow) * DAY - 21 * DAY;
}

const parse = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? U(+m[1], +m[2], +m[3]) : NaN;
};
const weeks = (from, to) => Math.round((to - from) / (7 * DAY));

// 'YYYY-MM-DD' → { key, name, color, liturgical } | null
//   key        절기 열쇠(advent·christmas·epiphany·after-epiphany·lent·easter·pentecost·after-pentecost)
//   name       화면 이름(주일이면 번호가 붙는다)
//   color      'purple' | 'gold' | 'red' | null(연중 — 기본 톤)
//   liturgical 전례색 'purple' | 'white' | 'red' | 'green'(대조 검사용)
export function churchSeason(iso) {
  const t = parse(iso);
  if (!Number.isFinite(t)) return null;
  const y = new Date(t).getUTCFullYear();
  const sunday = new Date(t).getUTCDay() === 0;
  const X = U(y, 12, 25);
  const A = advent1(y);
  const E = easterUtc(y);
  const ash = E - 46 * DAY;          // 재의 수요일
  const pent = E + 49 * DAY;         // 성령강림주일
  const out = (key, name, color, liturgical) => ({ key, name, color, liturgical });

  // 성탄절 12/25 ~ 1/5 — 새해 첫 닷새는 지난해 성탄절 기간이다
  if (t >= X || t < U(y, 1, 6)) return out('christmas', '성탄절', 'gold', 'white');
  if (t === U(y, 1, 6)) return out('epiphany', '주현절', 'gold', 'white');
  if (t >= A) {
    return out('advent', sunday ? `대림절 제${weeks(A, t) + 1}주일` : '대림절', 'purple', 'purple');
  }
  if (t < ash) {
    // 1/6 뒤 첫 주일이 주현절 후 제1주일이다
    const n = Math.floor((t - U(y, 1, 6) - DAY) / (7 * DAY)) + 1;
    return out('after-epiphany', sunday ? `주현절 후 제${n}주일` : '주현절 후', null, 'green');
  }
  if (t < E) {
    // 재의 수요일 뒤 첫 주일(ash + 4일)이 사순절 제1주일
    return out('lent', sunday ? `사순절 제${weeks(ash + 4 * DAY, t) + 1}주일` : '사순절', 'purple', 'purple');
  }
  if (t < pent) {
    if (t === E) return out('easter', '부활주일', 'gold', 'white');
    return out('easter', sunday ? `부활절 제${weeks(E, t) + 1}주일` : '부활절', 'gold', 'white');
  }
  // 빨강은 성령강림주일 **그 주**(주일~토요일)다 — 주보는 주일마다 한 장이라 결과는 주일 하나와
  // 같고, 그 주의 금요 예배도 같은 색을 입는다.
  if (t < pent + 7 * DAY) return out('pentecost', t === pent ? '성령강림주일' : '성령강림절', 'red', 'red');
  return out('after-pentecost', sunday ? `성령강림절 후 제${weeks(pent, t)}주일` : '성령강림절 후', null, 'green');
}

// 종이 머리 띠의 색 — **종이는 다크를 따라가지 않는다**(PITFALLS 32-i)라 라이트 한 벌이다.
// 연중(null)은 지금의 인디고 그대로다(사용자 결정 — 연중 종이는 바뀌지 않는다).
// 흰/금만 밝은 띠에 금빛 글자로 뒤집힌다(흰 글자면 1.4:1). 대비는 전부 7:1 이상(목업 표).
export const SEASON_MAST = {
  purple: { bg: '#4b3d84', ink: '#ffffff', edge: null },
  gold: { bg: '#f1e7cf', ink: '#5f4720', edge: '#e4d6b4' },
  red: { bg: '#8a3730', ink: '#ffffff', edge: null },
};
