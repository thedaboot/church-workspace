// 장애 시간대 Supabase 로그 한 장 요약(2026-11-09 · 2026-11-08 주일 접속 장애를 이 쿼리들로 짚었다 — PITFALLS 21-c).
//
//   node scripts/incident-logs.mjs 2026-11-08T16:00 2026-11-08T17:30      ← KST 시각(초 없이). 끝을 빼면 시작 + 2시간
//
// **Supabase 로그는 하루만 남는다** — 장애가 난 날 돌리세요. 한 번에 24시간까지(API 한도).
// 읽는 값: .env의 SUPABASE_ACCESS_TOKEN(대시보드 Account → Access Tokens · analytics 읽기 권한). 읽기만 한다.
// API: GET /v1/projects/{ref}/analytics/endpoints/logs — 표는 `logs` 하나 · `source`로 가른다 · 칸은 log_attributes['…'](문자열).
// 옛 `logs.all`은 없어졌다(410). `select *`·`count(*)`는 거절된다(칸을 적고 count()).
//
// 보는 것:
//   ① 5분마다 요청 수 · 5xx · 전체 재조회 수(projects 목록 GET = loadCloudState 한 번 · App의 reloadCloud)
//   ② 4xx·5xx가 많은 경로
//   ③ 연결 풀 바닥(PGRST003) · Realtime 경고 · 로그인 오류(bad_jwt · 갱신 시간 초과)
//   ④ 같은 기기(UA)가 1분에 쓰기를 많이 보낸 것(재시도 폭주 — 17:14 사례)
import { readFileSync } from 'node:fs';

const REF = 'zdqkwvbuiorqrykfedon';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
if (!env.SUPABASE_ACCESS_TOKEN) { console.error('.env에 SUPABASE_ACCESS_TOKEN이 없습니다.'); process.exit(1); }

const [a, b] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a || '')) { console.error('쓰는 법: node scripts/incident-logs.mjs 2026-11-08T16:00 [2026-11-08T17:30]  (KST)'); process.exit(1); }
const kst = (s) => new Date(`${s}:00+09:00`);
const start = kst(a);
const end = b ? kst(b) : new Date(start.getTime() + 2 * 3600e3);
if (!(end > start) || end - start > 24 * 3600e3) { console.error('끝은 시작보다 뒤, 24시간 안이어야 합니다.'); process.exit(1); }

async function q(sql) {
  const u = new URL(`https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs`);
  u.searchParams.set('sql', sql);
  u.searchParams.set('iso_timestamp_start', start.toISOString());
  u.searchParams.set('iso_timestamp_end', end.toISOString());
  const r = await fetch(u, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return j.result || [];
}
const toKst = (t) => new Date(`${String(t).replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
const st = "log_attributes['response.status_code']";
const path = "replaceRegexpAll(log_attributes['request.path'], '[0-9a-f-]{36}', '<id>')";

console.log(`Supabase 로그 ${a} ~ ${b || '(+2시간)'} KST\n`);

console.log('① 5분마다 — 시각 · 요청 · 5xx · 4xx · 전체 재조회(projects GET)');
for (const r of await q(`select toStartOfFiveMinutes(timestamp) as t, count() as n,
    countIf(${st} like '5%') as e5, countIf(${st} like '4%') as e4,
    countIf(log_attributes['request.path'] = '/rest/v1/projects' and log_attributes['request.method'] = 'GET') as full
    from logs where source = 'edge_logs' group by t order by t`)) {
  console.log(`  ${toKst(r.t)}  ${String(r.n).padStart(6)}  ${String(r.e5).padStart(5)}  ${String(r.e4).padStart(5)}  ${String(r.full).padStart(4)}`);
}

console.log('\n② 오류가 많은 경로(상위 15)');
for (const r of await q(`select ${st} as s, log_attributes['request.method'] as m, ${path} as p, count() as n
    from logs where source = 'edge_logs' and toInt32OrZero(${st}) >= 400 group by s, m, p order by n desc limit 15`)) {
  console.log(`  ${r.s} ${r.m.padEnd(6)} ${r.p}  ${r.n}`);
}

console.log('\n③ 연결 풀 · Realtime · 로그인');
const [pool] = await q(`select count() as n from logs where source = 'postgrest_logs' and event_message like '%PGRST003%'`);
console.log(`  연결 풀 대기 시간 초과(PGRST003): ${pool?.n ?? 0}`);
for (const r of await q(`select substring(event_message, 1, 90) as m, count() as n from logs where source = 'realtime_logs'
    and match(event_message, '(?i)limit|timeout|error|too many') group by m order by n desc limit 6`)) console.log(`  Realtime: ${r.m}  ${r.n}`);
for (const r of await q(`select extract(event_message, '"error_code":"([a-z_]+)"') as c, count() as n from logs where source = 'auth_logs'
    and event_message like '%"error_code"%' group by c order by n desc limit 6`)) console.log(`  로그인 오류 ${r.c}: ${r.n}`);

console.log('\n④ 1분에 쓰기를 30번 넘게 보낸 기기(UA 앞 60자)');
const burst = await q(`select toStartOfMinute(timestamp) as t, substring(log_attributes['request.headers.user_agent'], 1, 60) as ua,
    ${path} as p, countIf(toInt32OrZero(${st}) >= 400) as bad, count() as n from logs where source = 'edge_logs'
    and log_attributes['request.method'] in ('POST', 'PATCH', 'DELETE') and log_attributes['request.path'] not like '/rest/v1/rpc/%'
    group by t, ua, p having n > 30 order by n desc limit 10`);
if (!burst.length) console.log('  없음');
for (const r of burst) console.log(`  ${toKst(r.t)}  ${r.p}  ${r.n}번(거절 ${r.bad})  ${r.ua}`);
