import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// 드라이브 ↔ 앱 싱크 검사 — 소스 단정.
// ----------------------------------------------------------------------------
// 이 경로는 게스트 모드에 없고(첨부는 클라우드 전용) 실제 드라이브를 부르지 않고는
// 돌려볼 수 없다. `cloud.js`는 노드에서 import도 안 된다(import.meta.env를 읽는다).
// 그래서 push.mjs와 같은 방식으로 **소스를 읽어 불변식을 단정**한다.
//
// 여기 있는 항목은 전부 2026-08-28에 실제로 겪었거나 실측으로 확인한 것이다.
// ============================================================================
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { fails++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const cloud = read('src/services/cloud.js');
const api = read('api/drive.js');
const sync = read('src/services/cloudSync.js');
const att = read('src/modals/attachments.jsx');
const vercel = JSON.parse(read('vercel.json'));
const drivemd = read('docs/DRIVE.md');

// ── 시간 ────────────────────────────────────────────────────────────────────
// 실측(2026-08-28): 폴더 만들기 3.5초 · 100KB 4.3초 · 1MB 5.8초 · 3MB 8.5초 · 8MB 26.7초.
// 바닥값이 4초라 기본값에 맡기면 흔한 업로드가 시간 제한에 걸린다.
check('함수 시간 제한을 우리가 명시한다', () => {
  const d = vercel.functions?.['api/drive.js'];
  assert.ok(d, 'vercel.json에 api/drive.js 설정이 없다');
  assert.ok(d.maxDuration >= 60, `maxDuration이 ${d.maxDuration}초 — 8MB 업로드가 26.7초다`);
});

check('프록시가 스스로 시간을 재고 한국어 이유를 돌려준다', () => {
  // 안 끊으면 함수가 죽을 때까지 매달리고, 브라우저는 JSON이 아닌 오류 페이지를 받는다.
  // 그러면 부르는 쪽이 이유를 못 읽어 "드라이브가 응답하지 않았어요"만 뜬다(사용자 신고).
  assert.match(api, /AbortController/, 'AbortController가 없다');
  assert.match(api, /SCRIPT_BUDGET_MS/, '시간 예산 상수가 없다');
  assert.match(api, /status\(504\)/, '시간 초과를 504로 구분하지 않는다');
  assert.match(api, /timeout: true/, '시간 초과 표시를 안 실어 보낸다');
  const budget = Number(/SCRIPT_BUDGET_MS = (\d+)/.exec(api)?.[1] || 0);
  const max = vercel.functions['api/drive.js'].maxDuration;
  assert.ok(budget > 0 && budget < max, `예산(${budget}초)이 maxDuration(${max}초)보다 짧아야 우리가 먼저 잡는다`);
});

// ── 재시도 ──────────────────────────────────────────────────────────────────
check('업로드는 멱등 목록에 없다', () => {
  // 스크립트의 upload은 파일을 **새로 만든다**. 그냥 재시도하면 "타임아웃은 났지만
  // 사실 올라갔던" 경우 파일이 두 개가 된다 — 사용자가 겪은 바로 그 상황이다.
  const set = /const IDEMPOTENT = new Set\(\[([^\]]*)\]\)/.exec(cloud)?.[1] || '';
  assert.ok(!set.includes("'upload'"), '업로드가 멱등 목록에 들어 있다 — 중복 파일이 생긴다');
  for (const a of ['ensureFolder', 'renameFolder', 'trash', 'list']) {
    assert.ok(set.includes(`'${a}'`), `${a}는 여러 번 불러도 같으므로 재시도해야 한다`);
  }
});

check('다시 해도 소용없는 실패는 재시도하지 않는다', () => {
  // 401(로그인)·403(미승인)·413(용량)은 되풀이해도 같다
  const fn = /const worthRetry = \(e\) =>([\s\S]*?);\r?\n/.exec(cloud)?.[1] || '';
  assert.ok(fn.includes('timeout') && fn.includes('502') && fn.includes('504'), '재시도할 실패를 안 가린다');
  assert.ok(fn.includes('notConfigured'), '드라이브 미설정은 재시도 대상이 아니다');
  assert.ok(!/40[13]/.test(fn) || /!==\s*40[13]/.test(fn), '401·403을 재시도 대상에 넣지 않는다');
});

check('업로드 재시도는 먼저 확인하고 retry 표시를 붙인다', () => {
  assert.match(cloud, /action: 'list'/, '올라갔는지 확인하는 list 호출이 없다');
  assert.match(cloud, /\.\.\.payload, retry: true/, '재시도에 retry 표시가 없다 — 스크립트가 중복 검사를 건너뛴다');
  assert.match(cloud, /key,/, '멱등 열쇠를 안 보낸다');
});

// ── 싱크 구멍 ───────────────────────────────────────────────────────────────
check('행을 못 만들면 올린 파일을 되돌린다', () => {
  // 안 되돌리면 "드라이브에는 있는데 앱에는 없는" 파일이 영영 남는다 = 유실
  const block = /files 행 생성 실패[\s\S]{0,400}/.exec(cloud)?.[0] || '';
  assert.match(block, /action: 'trash'/, '고아 파일을 휴지통으로 보내지 않는다');
});

check('업무 폴더를 파일보다 먼저 확보한다', () => {
  assert.match(sync, /export async function ensureCardFolder/, 'ensureCardFolder가 없다');
  assert.match(sync, /setCardFolder/, '폴더 id를 cards에 적지 않는다');
  assert.match(att, /ensureCardFolder/, '업로드 전에 폴더를 확보하지 않는다');
  // 폴더 id를 먼저 저장해야 다음 업로드가 같은 이름 폴더를 또 만들지 않는다
  const order = att.indexOf('ensureCardFolder') < att.indexOf('uploadAttachment(file');
  assert.ok(order, '폴더 확보가 업로드보다 뒤에 있다');
});

check('폴더 id를 스토어에도 넣는다', () => {
  // cloudSync는 스토어를 물 수 없다(노드에서 도는 검사가 깨진다 — §6-29-a).
  // 부르는 쪽이 넣지 않으면 이번 세션 내내 배치마다 폴더를 다시 찾는다.
  assert.ok(!/from '\.\.\/store\//.test(sync), 'cloudSync가 스토어를 import하면 안 된다');
  assert.match(att, /UPDATE_PROJECT[\s\S]{0,120}driveFolderId/, '프로젝트 폴더 id가 스토어로 안 간다');
  assert.match(att, /SYNC_TASK[\s\S]{0,120}driveFolderId/, '업무 폴더 id가 스토어로 안 간다');
});

// ── 스크립트 ────────────────────────────────────────────────────────────────
check('문서의 스크립트가 멱등 열쇠와 list를 안다 (v5)', () => {
  assert.match(drivemd, /case 'list'/, 'list 액션이 없다');
  assert.match(drivemd, /KEY_PREFIX/, '열쇠를 적어 두지 않는다');
  assert.match(drivemd, /if \(body\.retry\)/, '첫 시도에도 폴더를 훑으면 파일 많은 업무가 느려진다');
  assert.match(drivemd, /childFolderIfExists/, 'list가 폴더를 만들어 버리면 안 된다');
});

check('프록시가 아는 액션과 스크립트가 아는 액션이 같다', () => {
  const apiSet = new Set([...(/ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(api)?.[1] || '')
    .matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]));
  const scriptSet = new Set([...drivemd.matchAll(/case '([a-zA-Z]+)':\s+return json/g)].map(m => m[1]));
  for (const a of scriptSet) assert.ok(apiSet.has(a), `스크립트는 ${a}를 아는데 프록시가 막는다`);
  for (const a of apiSet) assert.ok(scriptSet.has(a), `프록시는 ${a}를 통과시키는데 스크립트가 모른다`);
});

// ── 화면에 나가는 문구 ──────────────────────────────────────────────────────
check('시간 초과 문구에 초 단위를 넣지 않는다', () => {
  // 쓰는 사람에게 "50초 안에"는 아무 소용이 없다 — 무엇이 막혔고 무엇을 하면
  // 되는지만 말한다(사용자 결정 2026-08-28). 몇 초 걸렸는지는 서버 로그에 남는다.
  const msg = /status\(504\)[\s\S]{0,220}?error: `([^`]*)`/.exec(api)?.[1] || '';
  assert.ok(msg, '시간 초과 문구를 못 찾았다');
  assert.ok(!/\d+\s*초/.test(msg), `문구에 초 단위가 들어 있다: ${msg}`);
  assert.match(msg, /개발자에게 알려주시고/, '무엇을 하면 되는지가 없다');
  assert.match(msg, /\\n/, '두 마디를 한 줄로 붙이면 토스트가 길어진다');
});

check('토스트가 줄바꿈을 그리고 폭이 묶여 있다', () => {
  const toast = read('src/components/Toast.jsx');
  assert.match(toast, /whitespace-pre-line/, '줄바꿈이 무시된다');
  // max-w가 화면 폭뿐이면 데스크톱에서 긴 문구가 한 줄로 화면을 가로지른다
  assert.match(toast, /max-w-\[min\(/, '토스트 폭에 상한이 없다');
});

const { failText } = await import('../src/services/errorText.js');
check('failText: 짧으면 한 줄, 길면 줄을 나눈다', () => {
  assert.strictEqual(failText('저장하지 못했어요', { human: '인터넷을 확인해주세요' }),
    '저장하지 못했어요 · 인터넷을 확인해주세요');
  const long = failText("'2026 하계 수련회 견적서.xlsx'을(를) 올리지 못했어요", { human: '드라이브에 파일을 올리는 데 문제가 있어요' });
  assert.ok(long.includes('\n'), '긴 문구를 한 줄로 붙였다');
  // 이유 자체가 여러 줄이면 언제나 나눈다
  assert.ok(failText('짧아요', { human: '첫 줄\n둘째 줄' }).startsWith('짧아요\n'), '여러 줄 이유를 가운뎃점으로 붙였다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
