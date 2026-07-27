// 검증 러너 — 게스트 모드 dev 서버를 띄우고 tests/*.mjs 를 차례로 돌린다.
//   npm run verify                  전부
//   npm run verify -- calfit drag    이름으로 골라서
//   npm run verify -- --jobs 3       동시 실행(스크립트마다 CDP 포트가 달라 충돌은 없다)
//   SHOTS=1 npm run verify           스크린샷 남기는 테스트는 파일도 저장
//
// 브라우저 테스트는 Chrome 을 헤드리스로 띄운다. 경로가 다르면 CHROME 으로 덮어쓴다:
//   CHROME=/path/to/chrome npm run verify
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = dirname(HERE);
const PORT = Number(process.env.VERIFY_PORT || 4390);
const BASE = `http://localhost:${PORT}`;

// 브라우저를 쓰지 않는 순수 로직 자체검증 (서버가 필요 없다)
const NODE_ONLY = ['logcheck', 'mdcheck'];
// 순서: 넓게 훑는 것부터. 드래그·캘린더는 타이밍에 민감해서 마지막에 조용히 돌린다.
const ORDER = [
  'logcheck', 'mdcheck', 'aictx',
  'errhunt', 'handoff',
  'navsmoke', 'onebar', 'mobbits', 'bottomgap', 'modalclose',
  'batch10', 'batch11', 'dashfix', 'wide',
  'share', 'onboard', 'three', 'calfit', 'drag', 'dragdesk',
];

const args = process.argv.slice(2);
let jobs = 1;
const ji = args.indexOf('--jobs');
if (ji >= 0) { jobs = Math.max(1, Number(args[ji + 1]) || 1); args.splice(ji, 2); }
const only = args.filter(a => !a.startsWith('-'));

const found = readdirSync(HERE).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').map(f => f.replace('.mjs', ''));
const missing = ORDER.filter(n => !found.includes(n));
const extra = found.filter(n => !ORDER.includes(n));
if (missing.length) console.log(`(목록에 있지만 파일이 없음: ${missing.join(', ')})`);
if (extra.length) console.log(`(파일은 있지만 목록에 없음 — 그냥 마지막에 돌린다: ${extra.join(', ')})`);
const suites = [...ORDER.filter(n => found.includes(n)), ...extra]
  .filter(n => !only.length || only.includes(n));
if (!suites.length) { console.error('돌릴 스위트가 없어요.'); process.exit(1); }

// ── 게스트 모드용 .env.guest (레포에 커밋하지 않는다 — 없으면 만든다) ──
// 값이 비어 있으면 앱이 로그인 없이 localStorage 모드로 뜬다.
const guestEnv = join(ROOT, '.env.guest');
if (!existsSync(guestEnv)) {
  writeFileSync(guestEnv, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n');
  console.log('.env.guest 를 만들었어요 (게스트 모드 = 로그인 없이 localStorage)');
}

const needServer = suites.some(s => !NODE_ONLY.includes(s));
let server = null;
if (needServer) {
  server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--mode', 'guest', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  const until = Date.now() + 40000;
  let up = false;
  while (Date.now() < until) {
    try { await fetch(BASE); up = true; break; } catch { await new Promise(r => setTimeout(r, 300)); }
  }
  if (!up) { server.kill(); console.error(`dev 서버(${BASE})가 안 떴어요.`); process.exit(1); }
  console.log(`dev 서버 ${BASE} (guest)\n`);
}

const runOne = (name) => new Promise(resolve => {
  const started = process.hrtime.bigint();
  const p = spawn(process.execPath, [join(HERE, `${name}.mjs`), BASE], { cwd: ROOT });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => {
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    resolve({ name, code, out, secs });
  });
});

const queue = [...suites];
const done = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const name = queue.shift();
    const r = await runOne(name);
    const fails = (r.out.match(/^FAIL /gm) || []).length;
    const passes = (r.out.match(/^PASS /gm) || []).length;
    // 종료 코드가 0이 아니고 FAIL 줄도 없으면 = 스크립트가 터진 것(셀렉터가 낡았을 때 이렇게 된다)
    const crashed = r.code !== 0 && fails === 0;
    const tag = crashed ? 'CRASH' : r.code === 0 ? ' OK  ' : 'FAIL ';
    console.log(`${tag} ${name.padEnd(11)} ${passes ? passes + ' pass' : ''}${fails ? ' / ' + fails + ' FAIL' : ''}  ${r.secs.toFixed(1)}s`);
    if (r.code !== 0) console.log(r.out.split('\n').filter(l => /^(FAIL|Error|TypeError|.*Error:)/.test(l)).slice(0, 6).map(l => '      ' + l).join('\n'));
    done.push({ ...r, fails, passes, crashed });
  }
}));

if (server) server.kill();
if (process.platform === 'win32' && server) {
  // vite 는 npx 밑에서 손자 프로세스로 떠서 kill 이 안 먹을 때가 있다
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`],
    { stdio: 'ignore' });
}

const bad = done.filter(d => d.code !== 0);
const totalPass = done.reduce((a, d) => a + d.passes, 0);
console.log(`\n${done.length}개 스위트 · ${totalPass} pass · ${bad.length ? bad.length + '개 실패: ' + bad.map(b => b.name).join(', ') : '전부 통과'}`);
process.exit(bad.length ? 1 : 0);
