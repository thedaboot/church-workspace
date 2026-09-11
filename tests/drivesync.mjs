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
// **붙여넣는 코드의 원본은 이 문서 하나다**(docs/DRIVE.md는 배경 설명이고 코드가 없다).
// 판마다 문서를 두던 것은 2026-09-11에 걷었다 — 옛 판 코드는 git 이력에 있고, 무엇이
// 언제 바뀌었는지는 그 문서의 '판 이력' 표에 한 줄씩 남는다. 그래서 v7 문서를 읽어
// 액션 목록을 맞춰 보던 단정도 이 한 벌로 합쳤다(액션 목록은 v7~v10이 같다 — 표에 적혀 있다).
const scriptmd = read('docs/APPS_SCRIPT.md');
const backfill = read('scripts/backfill_sheet_preview.mjs');
const cfg = read('src/config.js');
const filesvc = read('api/drive-file.js');
const preview = read('src/components/FilePreviewModal.jsx');
// 종류 판정은 2026-09-05부터 순수 모듈이다(노드에서 직접 부르는 검사는 tests/logcheck.mjs)
const kinds = read('src/services/previewKind.js');

// ── 상한 ────────────────────────────────────────────────────────────────────
// 세 곳이 같은 값을 봐야 한다. 어긋나면 "받아는 주는데 우리 뷰어로는 안 보이는
// 파일"이 생긴다 — 미리보기가 15MB에서 갈라서 19MB PDF가 드라이브의 어두운 파일
// 뷰어로 떨어졌다(사용자 신고 2026-08-28 — "이쁜 뷰로 안 보이는 이유는 뭐지").
const mbIn = (src, name) => Number((new RegExp(name + String.raw`\s*=\s*(\d+)`).exec(src) || [])[1]);

check('첨부 상한 · 중계 상한이 같은 값이다', () => {
  const cap = mbIn(cfg, 'MAX_UPLOAD_MB');
  const relay = mbIn(filesvc, 'MAX_BYTES');
  assert.ok(cap > 0, 'config.js에서 MAX_UPLOAD_MB를 못 읽었다');
  assert.strictEqual(relay, cap, `중계가 ${relay}MB인데 첨부 상한은 ${cap}MB다 — 그 사이 크기는 올라가고도 안 보인다`);
});

check('미리보기가 크기로 우리 뷰어를 포기하지 않는다', () => {
  // PDF·텍스트는 크기와 무관하게 우리가 그린다. 큰 텍스트만 앞부분을 자른다.
  assert.ok(!(preview + kinds).includes('MAX_PDF_PREFETCH'), 'PDF에 크기 게이트가 다시 생겼다');
  assert.ok(kinds.includes("if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';"),
    '드라이브 PDF가 크기 조건 없이 pdf로 가야 한다');
  assert.ok(preview.includes('slice(0, MAX_TEXT_CHARS)'), '큰 텍스트는 거절이 아니라 앞부분을 그린다');
  // 스프레드시트도 같다 — 파서가 500줄에서 멈추므로 크기로 가를 이유가 없어졌다
  assert.ok(kinds.includes('const MAX_SHEET_BYTES = MAX_UPLOAD_BYTES;'),
    '스프레드시트 상한이 첨부 상한과 따로 논다');
  // 어쩌다 떨어지더라도 어두운 파일 뷰어가 아니라 구글 편집기 미리보기로 간다
  assert.ok(kinds.includes("if (OFFICE_EXT.includes(ext) || SHEET_EXT.includes(ext)) return 'drive';"),
    '큰 스프레드시트가 어두운 파일 뷰어로 떨어진다');
  // 워드·PPT도 우리가 그린다 — 드라이브에서 온 것이든 아직 올리는 중이든 같다.
  const docAt = [...kinds.matchAll(/if \(ext === 'docx'\) return 'doc';/g)].length;
  const sldAt = [...kinds.matchAll(/if \(ext === 'pptx'\) return 'slide';/g)].length;
  assert.strictEqual(docAt, 2, "docx가 드라이브·로컬 양쪽에서 우리 뷰로 가야 한다");
  assert.strictEqual(sldAt, 2, "pptx가 드라이브·로컬 양쪽에서 우리 뷰로 가야 한다");
});


// ── HTML 첨부 (2026-09-05) ──────────────────────────────────────────────────
// 남이 올린 HTML을 **우리 출처 안에서** 연다. 실물 첨부가 Tailwind CDN(자바스크립트가
// CSS를 만든다)으로 짜여 있어 스크립트는 열어 줬지만, allow-same-origin이 함께 들어오면
// 문서가 sandbox를 스스로 벗고 우리 세션(localStorage의 Supabase 토큰)을 읽는다 —
// 허용 목록이 allow-scripts 하나인지가 방어선이다.
check('HTML 첨부는 allow-scripts 하나만 준 sandbox iframe으로 그린다', () => {
  assert.match(preview, /<iframe\s+sandbox="allow-scripts"\s+srcDoc=\{text\}/, 'sandbox="allow-scripts" + srcdoc이 아니다');
  // 속성 값만 본다 — 주석은 지우고 센다(주석이 sandbox=""를 인용하는 것은 괜찮다)
  const code = preview.replace(/^[ \t]*\/\/.*$/gm, '');
  for (const [, v] of code.matchAll(/sandbox="([^"]*)"/g)) {
    const tokens = v.split(/\s+/).filter(Boolean);
    assert.deepStrictEqual(tokens, ['allow-scripts'],
      'sandbox 허용 목록이 allow-scripts 하나가 아니다(' + v + ') — allow-same-origin이 같이 들어오면 남의 HTML이 우리 세션을 읽는다');
  }
  assert.match(preview, /referrerPolicy="no-referrer"/, '문서 안 외부 요청에 우리 주소(?p=&t=)가 실려 나간다');
  // 종류 판정: html은 text보다 **먼저**여야 한다(mime 'text/html'이 text/*에 먹힌다)
  // return 'html'로 자르면 [앞·드라이브 가지·로컬 가지] 셋이다 — 앞에는 text가 없고, 뒤 둘에는 있다
  const parts = kinds.split("return 'html'");
  assert.strictEqual(parts.length, 3, '드라이브·로컬 양쪽에 html 판정이 하나씩');
  assert.ok(!parts[0].includes("return 'text'"), 'html보다 앞에 text 판정이 있다');
  assert.ok(parts[1].includes("return 'text'") && parts[2].includes("return 'text'"), '드라이브·로컬 양쪽에서 html 판정이 text보다 앞이어야 한다');
  assert.ok(!/TEXT_EXT = \[[^\]]*'html'/.test(kinds), 'html이 TEXT_EXT에 남아 있으면 소스가 <pre>로 뜬다');
});

check('중계가 HTML 첨부를 경고 페이지로 오판하지 않는다', () => {
  // 구글의 바이러스 검사 경고도 text/html이다. 종류만 보고 끊으면 .html 첨부가 전부 막힌다 —
  // 실제 파일은 Content-Disposition: attachment로 오고 경고 페이지는 그 머리줄이 없다.
  assert.match(filesvc, /content-disposition/i, '중계가 Content-Disposition을 보지 않는다');
  assert.match(filesvc, /type\.startsWith\('text\/html'\) && !\/attachment\/i\.test\(disposition\)/,
    'text/html 거절이 attachment 머리줄로 가려지지 않는다');
});

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
  // 폴더 id를 먼저 저장해야 다음 업로드가 같은 이름 폴더를 또 만들지 않는다.
  // 인자 이름이 바뀌어도 흔들리지 않게 호출 자체를 찾는다(예전에는 'uploadAttachment(file'
  // 로 찾다가 인자가 sending으로 바뀌면서 -1이 나와 조용히 통과할 뻔했다).
  const upAt = att.search(/\bawait uploadAttachment\(/);
  const folderAt = att.search(/\bawait ensureCardFolder\(|ensureCardFolder\(\s*$/m);
  assert.ok(upAt > 0, 'uploadAttachment 호출을 못 찾았다');
  assert.ok(folderAt > 0, 'ensureCardFolder 호출을 못 찾았다');
  assert.ok(folderAt < upAt, '폴더 확보가 업로드보다 뒤에 있다');
});

check('폴더 id를 스토어에도 넣는다', () => {
  // cloudSync는 스토어를 물 수 없다(노드에서 도는 검사가 깨진다 — §6-29-a).
  // 부르는 쪽이 넣지 않으면 이번 세션 내내 배치마다 폴더를 다시 찾는다.
  assert.ok(!/from '\.\.\/store\//.test(sync), 'cloudSync가 스토어를 import하면 안 된다');
  assert.match(att, /UPDATE_PROJECT[\s\S]{0,120}driveFolderId/, '프로젝트 폴더 id가 스토어로 안 간다');
  assert.match(att, /SYNC_TASK[\s\S]{0,120}driveFolderId/, '업무 폴더 id가 스토어로 안 간다');
});

// ── 스크립트 ────────────────────────────────────────────────────────────────
check('스크립트가 멱등 열쇠·list·변환 사본을 안다', () => {
  assert.match(scriptmd, /case 'list'/, 'list 액션이 없다');
  assert.match(scriptmd, /KEY_PROP/, '열쇠를 appProperties에 안 적는다');
  assert.match(scriptmd, /if \(body\.retry\)/, '첫 시도에도 폴더를 훑으면 파일 많은 업무가 느려진다');
  assert.match(scriptmd, /childFolderIfExists/, 'list가 폴더를 만들어 버리면 안 된다');
  assert.match(scriptmd, /makePreviewCopy/, '변환 사본을 만들지 않는다(0031)');
  // 사본이 원본의 열쇠를 물려받으면 findByKey가 사본을 원본으로 착각한다(2026-08-29)
  assert.match(scriptmd, /wskey: null/, '사본에서 열쇠를 안 지운다');
  assert.match(scriptmd, /LockService/, '폴더 만들기에 잠금이 없다 — 병렬 업로드에서 같은 폴더가 여럿 생긴다');
});

// ── 워드·PPT 사본 (v8부터) ──────────────────────────────────────────────────
check('스크립트가 워드·PPT도 네이티브 사본으로 만든다', () => {
  assert.match(scriptmd, /GOOGLE_DOCS/, '워드를 구글 문서로 안 옮긴다');
  assert.match(scriptmd, /GOOGLE_SLIDES/, 'PPT를 구글 슬라이드로 안 옮긴다');
  assert.match(scriptmd, /GOOGLE_SHEETS/, '엑셀 변환이 사라졌다(v7 동작이 깨진다)');
  assert.match(scriptmd, /convertTo/, 'convertTo를 모르면 워드·PPT 요청이 무시된다');
  // 버전을 안 실어 보내면 부르는 쪽이 v7에 워드를 보내 쓰레기 사본을 만든다
  // 앱의 게이트는 `>= 8`이다(cloud.attachPreviewCopy) — 지금 판(10)은 그 조건을 그대로 지난다
  assert.match(scriptmd, /const SCRIPT_VERSION = 10;/, '버전 상수가 10이 아니다');
  assert.match(scriptmd, /out\.version = SCRIPT_VERSION/, '답에 버전을 안 싣는다');
  // 사본 종류는 **확장자**가 정한다 — 부르는 쪽 값을 믿으면 잘못 보낸 한 번이 영영 남는다
  assert.ok(/COPY_AS\[String\(name/.test(scriptmd), '사본 종류를 확장자로 정하지 않는다');
  // 사본은 copy 한 번이다(v7은 만든 뒤 update로 열쇠를 지우러 한 번 더 갔다)
  const fn = scriptmd.slice(scriptmd.indexOf('function makePreviewCopy'), scriptmd.indexOf('// 주소에서 받아'));
  assert.ok(fn, 'makePreviewCopy를 못 찾았다');
  assert.ok(!/Drive\.Files\.update/.test(fn), '사본을 만든 뒤 고치러 한 번 더 간다 — copy 본문에 실어야 한다');
  assert.ok(!/Drive\.Files\.get/.test(fn), '사본을 만들며 파일을 다시 묻는다');
  // 링크를 아는 누구나 고칠 수 있게 되면 안 된다(HANDOFF §7 '첨부에 편집 권한 주기') — 'anyone'은 언제나 reader다.
  // v10부터 'writer'가 코드에 있지만 그것은 **이름 있는 계정**(type: 'user')뿐이다(아래 검사).
  assert.ok(!/role: 'writer'[^)]*type: 'anyone'/.test(scriptmd), "'anyone'에게 편집 권한을 준다");
  assert.ok(!/type: 'anyone'[^)]*role: 'writer'/.test(scriptmd), "'anyone'에게 편집 권한을 준다");
});

// ── v10: 큐시트 사본만 편집자 둘 (2026-09-09 — "큐시트는 교역자와 마스터만 수정 가능하게") ──
check('큐시트 사본에만 이름 있는 계정 둘이 편집자로 붙는다', () => {
  // 'writer'+'anyone'(위 검사)이 아니라 이름 있는 계정 둘이다. 명단이 코드 한 줄이라
  // 사람이 바뀌면 그 줄만 고치고 새 버전으로 올린다.
  assert.match(scriptmd, /var CUE_EDITORS = \[/, '편집자 명단(CUE_EDITORS)이 없다');
  assert.match(scriptmd, /role: 'writer', type: 'user', emailAddress: CUE_EDITORS\[i\]/,
    '편집자를 이름 있는 계정으로 주지 않는다');
  assert.match(scriptmd, /sendNotificationEmail: false/,
    '주보를 올릴 때마다 두 사람에게 메일이 간다');
  // 붙는 것은 앱이 그 칸을 실어 보낼 때뿐이다 — 업무 첨부 사본의 공유는 그대로여야 한다
  assert.match(scriptmd, /function makePreviewCopy\(fileId, name, folderId, cueEditors\)/,
    'makePreviewCopy가 cueEditors를 받지 않는다');
  assert.match(scriptmd, /if \(cueEditors\) \{/, '종류를 안 가리고 편집자를 붙인다');
  assert.match(scriptmd, /makePreviewCopy\(body\.fileId, name, parent, !!body\.cueEditors\)/,
    'convert 액션이 그 칸을 넘기지 않는다');
  // 앱 쪽 판단은 `files.kind === 'cuesheet'` 한 줄이다(업무 첨부·송폼은 안 보낸다)
  assert.match(cloud, /cueEditors: [^\n]*cuesheet/, "cloud.js가 큐시트에만 cueEditors를 싣지 않는다");
});

check('upload은 변환을 기다리지 않는다 (v8부터)', () => {
  // v7은 upload 안에서 변환까지 끝내고 답해서 올리는 시간에 변환 시간이 더해졌다.
  // convertTo(새 화면이 쓰는 칸)가 upload 자리에 있으면 그 자리에서 또 기다린다.
  const up = scriptmd.slice(scriptmd.indexOf('function upload(body)'), scriptmd.indexOf('// **F: 오피스 파일을'));
  assert.ok(up, 'upload 함수를 못 찾았다');
  assert.ok(!/body\.convertTo/.test(up), 'upload이 convertTo를 보고 변환한다 — 사본은 convert 액션이 만든다');
});

// ── 업로드 왕복 둘 (v9부터) ─────────────────────────────────────────────────
check('upload은 드라이브 왕복 둘이다(만들기 + 공유)', () => {
  // v8까지는 createFile · 열쇠 update(stampKey) · setSharing 셋이었다. 이름·부모·열쇠·설명을
  // Drive.Files.create 한 요청에 실으면 둘이 된다 — 남는 하나(공유)는 다른 API라 합칠 수 없다.
  assert.match(scriptmd, /function createInFolder\(/, '공용 만들기 함수가 없다');
  assert.match(scriptmd, /Drive\.Files\.create\(meta, blob/, '메타와 바이트를 한 요청에 싣지 않는다');
  assert.ok(!/\.createFile\(/.test(scriptmd), 'DriveApp createFile로 만든다(그 뒤 열쇠·공유 왕복이 따로 붙는다)');
  assert.ok(!/stampKey\(/.test(scriptmd), '만든 뒤 열쇠를 update로 붙인다');
  assert.ok(!/setSharing\(/.test(scriptmd), 'DriveApp setSharing을 쓴다 — Permissions.create 한 벌로');
  // 공유는 언제나 보기다(§7 마지막 줄)
  assert.match(scriptmd, /Drive\.Permissions\.create\(\{ role: 'reader', type: 'anyone' \}, file\.id/, '올린 파일에 보기 공유가 없다');
  // upload·uploadFromUrl 둘 다 같은 길
  const ups = scriptmd.match(/createInFolder\(folder\.getId\(\), blob/g) || [];
  assert.strictEqual(ups.length, 2, `upload·uploadFromUrl 둘이 createInFolder를 써야 한다(${ups.length})`);
});

check('프록시가 아는 액션과 스크립트가 아는 액션이 같다', () => {
  const apiSet = new Set([...(/ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(api)?.[1] || '')
    .matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]));
  // 액션 목록은 v7부터 지금 판까지 같다(APPS_SCRIPT.md '판 이력') — 어긋나면 그 액션이 막힌다
  const scriptSet = new Set([...scriptmd.matchAll(/case '([a-zA-Z]+)':\s+return json/g)].map(m => m[1]));
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
check('failText: 무엇과 왜는 언제나 줄을 바꿔 잇는다', () => {
  assert.strictEqual(failText('저장하지 못했어요', { human: '인터넷을 확인해주세요' }),
    '저장하지 못했어요\n인터넷을 확인해주세요');
  const long = failText("'2026 하계 수련회 견적서.xlsx'을(를) 올리지 못했어요", { human: '드라이브에 파일을 올리는 데 문제가 있어요' });
  assert.ok(long.includes('\n'), '긴 문구를 한 줄로 붙였다');
  assert.ok(!long.includes(' · '), '가운뎃점으로 이었다');
  // 이유 자체가 여러 줄이면 언제나 나눈다
  assert.ok(failText('짧아요', { human: '첫 줄\n둘째 줄' }).startsWith('짧아요\n'), '여러 줄 이유를 가운뎃점으로 붙였다');
});

// ── 낙관적 업로드 (2026-08-28) ──────────────────────────────────────────────
// 고른 파일이 **드라이브를 기다리지 않고** 바로 목록에 보이고 미리보기가 된다.
// 대신 화면이 거짓말을 하면 안 된다 — 아직 없는 주소를 버튼으로 내놓지 않는다.

check('고른 파일이 드라이브를 기다리지 않고 바로 목록에 든다', () => {
  // 업로드를 기다린 뒤에 넣으면 그게 지금의 "기다려야 한다" 그대로다
  const stage = att.indexOf('stageUploads(task.id, staged)');
  const wait = att.indexOf('await ensureProjectFolder');
  assert.ok(stage > 0, '대기 목록에 넣는 자리가 없다');
  assert.ok(stage < wait, '대기 목록에 넣기가 드라이브 호출보다 뒤에 있다');
});

check('첨부 목록은 한 곳에서만 걸러진다', () => {
  // 폼 스냅샷(formData)·조회 결과·스토어 세 갈래가 제각각 거르다가 **첫 값만**
  // 빠뜨려서, 지우고 저장하면 그 파일이 도로 한 줄 섰다(§6-29-s).
  assert.ok(att.includes('export const mergeKnown = (cardId, rows)'), '병합 자리가 없다');
  assert.ok(att.includes('const visible = mergeKnown(task.id, task.attachments)'), '첫 값이 병합을 안 거친다');
  assert.ok(att.includes('rows = mergeKnown(task.id, rows)'), '조회 결과가 병합을 안 거친다');
  // 컴포넌트가 직접 거르는 자리가 새로 생기면 또 갈라진 것이다
  const comp = att.indexOf('export const AttachmentSection');
  for (const m of att.matchAll(/deletedFileIds.has/g)) {
    assert.ok(m.index < comp, 'deletedFileIds를 컴포넌트에서 직접 본다 — mergeKnown 한 곳이어야 한다');
  }
});

check('첨부 올리는 길이 하나다', () => {
  // 새 업무에서 붙일 때가 두 번째 구현이었다: 사진을 안 줄이고, 업무 폴더를 미리
  // 안 잡고, 순차로 올리고, '올리는 중'도 이름만 있는 다른 표시였다(사용자 지적).
  const modals = read('src/modals/modals.jsx');
  assert.ok(att.includes('export async function startUploads'), '공용 업로드 함수가 없다');
  assert.ok(modals.includes('startUploads({ task: saved'), '새 업무 첨부가 공용 길을 안 쓴다');
  assert.ok(!modals.includes('uploadAttachment('), 'modals에 두 번째 업로드 구현이 남아 있다');
  assert.ok(!modals.includes('uploadingNames'), '이름만 있는 옛 올리는 중 표시가 남아 있다');
  // 사진 줄이기·폴더 먼저는 그 하나의 길에 있어야 한다
  const up = att.indexOf('export async function startUploads');
  assert.ok(att.indexOf('downscaleImage(file, FILE_MAX_DIM') > up, '공용 길이 사진을 안 줄인다');
  assert.ok(att.indexOf('await ensureCardFolder(') > up, '공용 길이 업무 폴더를 먼저 안 잡는다');
});

check('내려받기가 남의 출처에서도 진짜 내려받는다', () => {
  // download 속성은 같은 출처에서만 듣는다. 드라이브 주소에 걸면 브라우저가 그냥
  // 새 탭으로 연다(사용자 신고 2026-08-28 — "새 탭으로 열기만 되고 있음").
  assert.ok(!/download={cur.name}/.test(preview), 'download 속성에 다시 기대고 있다');
  assert.ok(preview.includes('URL.createObjectURL(blob)'), '바이트를 받아 저장하지 않는다');
  assert.ok(preview.includes('a.download = cur.name'), '저장할 이름을 안 준다');
});

check('올리는 중 표시가 업무 창을 닫아도 남는다', () => {
  // 창을 닫아도 업로드는 계속 돈다. 목록이 컴포넌트 안에만 있으면 다시 열었을 때
  // 그 줄이 사라져 화면이 "아무 일도 안 한다"고 거짓말한다(사용자 지적 2026-08-28).
  assert.ok(att.includes('const uploadingByCard = new Map()'), '올리는 중 목록이 모듈 레벨이 아니다');
  assert.ok(att.includes('useState(() => uploadingByCard.get(task.id)'), '다시 열 때 모듈 목록에서 시작하지 않는다');
  assert.ok(att.includes('uploadWatchers.add(sync)'), '다른 인스턴스의 업로드를 따라가지 않는다');
  // 탭 경고도 모듈에 있어야 한다 — 컴포넌트에 매달면 창을 닫는 순간 같이 풀린다
  const warn = att.indexOf("window.addEventListener('beforeunload', warnUnload)");
  const comp = att.indexOf('export const AttachmentSection');
  assert.ok(warn > 0 && warn < comp, '탭 경고가 컴포넌트 안에 있다');
});

check('올리는 중에는 새 탭 버튼을 두지 않는다', () => {
  // 드라이브 주소가 아직 없다. 버튼을 내놓으면 화면이 거짓말한다(사용자 결정).
  assert.match(preview, /\{!local && \(/, '새 탭 버튼이 로컬 파일에서도 보인다');
  // 내려받기는 올리는 중에도 둔다 — 고른 파일 그대로라 실제로 된다(주소가 아니라 바이트다)
  assert.ok(preview.includes('const blob = local'), '올리는 중에 고른 파일로 내려받지 못한다');
});

check('올리는 중에는 삭제·잠금을 두지 않는다', () => {
  // 아직 DB에 없는 것을 지울 수 없고, 비밀번호는 files 행에 붙는 값이다
  assert.match(att, /\{!pending && canDelete && \(/, '올리는 중에 삭제 버튼이 있다');
  assert.match(att, /\{!pending && canLock && \(/, '올리는 중에 잠금 버튼이 있다');
});

check('사진·PDF는 로컬 바이트로 바로 보이고, 엑셀은 안 보인다', () => {
  // 사진·PDF는 고른 파일 그대로 그릴 수 있으니 드라이브를 안 기다린다.
  assert.match(preview, /const local = cur\.source === 'local'/, '미리보기가 로컬 파일을 모른다');
  // **엑셀은 다르다**(2026-08-30). 표는 이제 구글이 그리고, 그 화면은 드라이브에
  // 변환 사본이 생긴 뒤에만 있다. 올리는 중에 열면 옛 화면이 잠깐 나왔다 바뀌어서
  // 두 벌처럼 보였다(사용자 지적) — 그래서 미리보기·펼쳐보기 버튼을 아예 안 준다.
  assert.match(att, /const sheetPending = pending && isSheetName\(row\.name\)/, '올리는 중인 엑셀을 가리지 않는다');
  assert.match(att, /\{!sheetPending && \(/, '올리는 중인 엑셀에 미리보기 버튼이 남아 있다');
  assert.ok(!/row\.source === 'local' && row\._file/.test(att), '펼쳐보기가 아직 로컬 바이트를 읽는다');
});

check('탭을 닫으려 하면 묻는다 · blob 주소를 되돌려준다', () => {
  // 메모리에만 있어서 닫으면 드라이브에도 DB에도 남지 않는다
  assert.match(att, /beforeunload/, '올리는 중에 탭을 닫아도 아무 말이 없다');
  assert.match(att, /revokeObjectURL/, 'blob 주소를 되돌려주지 않는다');
});

// ── 큰 파일 (2026-08-28 실측) ───────────────────────────────────────────────
// 8MB 26.7초 · 12MB 41.0초 · 16MB 56.8초 · 20MB 59.2초 · 25MB 57.9초.
// Hobby 플랜의 함수 상한이 60초라 16MB 위는 구조적으로 못 넣는다. 그리고 예산으로
// 끊어도 스크립트는 계속 돌아 파일을 다 쓰므로, **예산을 넘는 크기를 아예 받지
// 않는 것**이 중복을 막는 유일한 길이다.
check('첨부 상한을 화면과 서버가 같은 값으로 본다', () => {
  const client = mbIn(cfg, 'MAX_UPLOAD_MB');   // 상한은 config.js가 원본이다
  const server = mbIn(api, 'MAX_MB');
  assert.ok(client > 0 && server > 0, '상한 상수를 못 찾았다');
  assert.strictEqual(client, server, `화면 ${client}MB · 서버 ${server}MB — 어긋나면 한쪽이 거짓말한다`);
});

check('사진은 보내기 전에 줄인다', () => {
  // 브라우저 → Vercel 구간이 함수 실행 시간에 들어가고 Hobby 상한 60초는 못 늘린다.
  // 남은 길은 보내는 바이트를 줄이는 것뿐이다(첨부 232건 중 226건이 사진이다).
  assert.match(att, /downscaleImage\(file, FILE_MAX_DIM/, '첨부가 사진을 안 줄이고 보낸다');
  const img = read('src/services/image.js');
  assert.match(img, /imageOrientation: 'from-image'/, 'EXIF 회전을 안 보면 세로 사진이 눕는다');
  assert.match(img, /blob\.size >= file\.size\) return file/, '줄였는데 커지면 원본을 써야 한다');
  assert.match(img, /image\/gif/, 'gif를 줄이면 애니메이션이 죽는다');
});

check('끊긴 뒤에는 기다렸다 확인한다', () => {
  // 곧바로 확인하면 아직 쓰는 중이라 "없다"로 보고 다시 보내 파일이 두 개가 된다
  assert.match(cloud, /VERIFY_WAIT_MS/, '확인 전 대기가 없다');
  assert.match(cloud, /if \(e\.timeout\) await sleep\(VERIFY_WAIT_MS\)/, '시간 초과일 때 안 기다린다');
});

check('상한 문구를 손으로 두 벌 적지 않는다', () => {
  // 숫자를 문구에 직접 박으면 상한을 바꿀 때 화면만 옛말이 된다.
  // 주석은 뺀다 — 실측값을 적어 둔 줄에는 25MB가 정당하게 남아 있다.
  const code = att.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const stale = code.match(/\d+MB/g)?.filter(m => m !== `${'$'}{MAX_UPLOAD_MB}MB`) || [];
  assert.ok(!/(?<!\{)\b\d+MB/.test(code), `문구에 숫자가 직접 박혀 있다: ${stale.join(', ')}`);
  assert.match(att, /\$\{MAX_UPLOAD_MB\}MB/, '문구가 상수에서 오지 않는다');
});

// ── 4.5MB 벽 (2026-08-28 실측) ──────────────────────────────────────────────
// 배포된 함수에 크기별로 던져 봤다: 4MB는 401까지 가고 4.4MB부터 413
// FUNCTION_PAYLOAD_TOO_LARGE다. base64가 33%를 붙이니 실제 파일은 3.3MB가 천장이고,
// 그보다 크면 **함수에 닿지도 못한 채** 가장자리에서 잘린다 — 우리가 준비한 한국어
// 이유가 나올 기회조차 없다(사용자 신고: 20MB PDF가 올리자마자 실패).
check('큰 파일은 함수를 거치지 않고 Storage로 나른다', () => {
  assert.match(cloud, /const INLINE_MAX = /, '몸통 한도 상수가 없다');
  const mb = Number(/const INLINE_MAX = (\d+) \* 1024 \* 1024/.exec(cloud)?.[1] || 0);
  // base64가 33%를 붙이므로 3.3MB가 실제 천장이다. 여유를 둬야 한다.
  assert.ok(mb > 0 && mb <= 3, `INLINE_MAX가 ${mb}MB — base64를 붙이면 4.5MB 벽을 넘는다`);
  assert.match(cloud, /uploadViaStorage/, 'Storage 경유 경로가 없다');
  assert.match(cloud, /action: 'uploadFromUrl'/, '스크립트에 주소를 넘기지 않는다');
  // 드라이브로 옮겨 갔으면 옮겨 담는 자리는 치워야 한다
  assert.match(cloud, /\.remove\(\[path\]\)/, '임시 사본을 안 지운다');
});

check('스크립트가 v5여도 큰 파일은 올라간다', () => {
  // uploadFromUrl을 모르는 스크립트에서 파일을 버리면 안 된다. 이 앱은 원래
  // Storage에 파일을 두던 구조이고 읽기 경로가 파일 한 건 단위로 갈라져 있어서
  // (files.source), 그대로 두어도 미리보기·썸네일·새 탭이 다 동작한다.
  // 스크립트를 못 고치는 상황에서도 올라가기는 해야 한다(사용자가 모바일이었다).
  const fn = /async function uploadViaStorage[\s\S]*?\n}/.exec(cloud)?.[0] || '';
  assert.ok(fn, 'uploadViaStorage를 못 찾았다');
  assert.match(fn, /return \{ storagePath: path \}/, '옮기기 실패 시 파일을 버린다');
  // 실패를 받는 catch 블록 안에서는 파일을 지우면 안 된다 — 그게 유일한 사본이다
  const lastCatch = fn.slice(fn.lastIndexOf('} catch (e) {'));
  assert.ok(lastCatch.includes('storagePath: path'), '실패 경로가 Storage를 안 쓴다');
  assert.ok(!lastCatch.includes('remove('), '실패 경로에서 파일을 지운다 — 그게 유일한 사본이다');
  // 행을 만들 때 두 갈래를 모두 쓴다
  assert.match(cloud, /source: 'storage', storage_path: storagePath/, 'Storage 행을 안 만든다');
  assert.match(cloud, /source: 'drive', drive_file_id: up\.id/, '드라이브 행을 안 만든다');
});

check('uploadFromUrl도 그냥 재시도하면 안 된다', () => {
  // upload과 같은 성질이다 — 스크립트가 파일을 새로 만든다
  const set = /const IDEMPOTENT = new Set\(\[([^\]]*)\]\)/.exec(cloud)?.[1] || '';
  assert.ok(!set.includes("'uploadFromUrl'"), 'uploadFromUrl이 멱등 목록에 있다 — 중복 파일이 생긴다');
  // 대신 uploadOnceOrFind를 지나야 한다(열쇠 + 확인 후 재시도).
  // 길이로 자르지 말 것 — 주석이 늘면 조용히 어긋난다. 함수 전체를 본다.
  const fn = /async function uploadViaStorage[\s\S]*?\n}/.exec(cloud)?.[0] || '';
  assert.ok(fn, 'uploadViaStorage를 못 찾았다');
  assert.match(fn, /uploadOnceOrFind\(\{\s*\n?\s*action: 'uploadFromUrl'/, '확인 없이 보낸다');
});

check('문서의 스크립트가 uploadFromUrl을 안다 (v5부터)', () => {
  // 이 셋을 v6 코드 상자(DRIVE.md)에서 보고 있었다 — 그 상자는 2026-09-11에 지웠고
  // 지금 붙여넣는 코드 한 벌만 남았다. 보는 뜻은 그대로다.
  assert.match(scriptmd, /case 'uploadFromUrl'/, 'uploadFromUrl 액션이 없다');
  assert.match(scriptmd, /UrlFetchApp\.fetch/, '주소에서 받아오지 않는다');
  assert.match(scriptmd, /getResponseCode\(\) >= 300/, '받아오기 실패를 안 가린다');
});

// ── 주보에 붙는 파일 — 송폼 · 큐시트 (0047 · 갈래는 0054) ───────────────────
// 주보에도 파일이 붙는다. **업무 첨부와 같은 files 표·같은 업로드 한 벌**을 쓰는 것이
// 이 기능의 전제다 — 두 벌로 갈라지면 3MB 갈래·멱등 열쇠·되돌리기 중 어느 하나가
// 한쪽에만 고쳐진다(§6-29 머리말의 그 함정, 2026-08-28에 실제로 겪었다).
// 큐시트를 파일로도 붙이게 되면서(2026-09-08) 그 함정을 화면에서 다시 밟을 자리가
// 생겼다 — 갈래는 `files.kind` 한 칸이고 업로드 길은 여전히 하나다(0054 · §6-29-u).
const view = read('src/views/worshipView.jsx');
const wsvc = read('src/services/worship.js');
const wdet = read('src/components/worshipDetail.jsx');
const mig = read('supabase/migrations/0047_service_files.sql');
const migKind = read('supabase/migrations/0054_files_kind.sql');

check('송폼이 업무 첨부와 같은 업로드 한 벌을 지난다', () => {
  assert.match(cloud, /async function uploadOwnedFile\(file, \{ folderHint, owner, prefix, rememberFolder \}\)/,
    '공용 업로드 함수(uploadOwnedFile)가 없다');
  // 3MB 갈래를 판정하는 자리가 둘이면 한쪽만 고쳐진다
  const gates = [...cloud.matchAll(/> INLINE_MAX/g)].length;
  assert.strictEqual(gates, 1, `INLINE_MAX 갈래가 ${gates}군데다 — 한 곳이어야 두 갈래가 같이 고쳐진다`);
  const attach = /export async function uploadAttachment[\s\S]*?\n}/.exec(cloud)?.[0] || '';
  const svc = /export async function uploadServiceFile[\s\S]*?\n}/.exec(cloud)?.[0] || '';
  assert.match(attach, /return uploadOwnedFile\(/, '업무 첨부가 공용 길을 안 쓴다');
  assert.match(svc, /return uploadOwnedFile\(/, '송폼이 공용 길을 안 쓴다');
  // 주인 칸은 service_id이고, 갈래(0054)가 같은 insert에 실린다 — 두 벌로 갈라지지 않는다
  assert.match(svc, /owner: \{ service_id: serviceId, kind: /, '주보 파일 행의 주인 칸이 service_id + kind가 아니다');
  // 지우는 길도 한 벌이다 — DB 행부터, 실체는 그 뒤 최선으로(§6-29-e)
  assert.match(wsvc, /return deleteAttachment\(row\)/, '송폼 삭제가 두 번째 구현이다');
});

check('송폼 드라이브 자리는 예배/<날짜> 한 벌이고 폴더가 파일보다 먼저다', () => {
  assert.match(cloud, /export const SERVICE_DRIVE_ROOT = '예배'/, '드라이브 뿌리 이름이 상수가 아니다');
  assert.match(cloud, /serviceFolderPath = \(serviceDate\) => \[SERVICE_DRIVE_ROOT, String\(serviceDate/,
    'path가 [예배, 날짜] 두 겹이 아니다 — 주보마다 폴더가 갈리거나 한 폴더에 다 쌓인다');
  assert.match(cloud, /export async function ensureServiceFolder/, '주보 폴더를 미리 확보하지 않는다');
  assert.match(cloud, /await setServiceFolder\(service\.id, folderId\)/,
    '폴더 id를 services에 안 적는다 — 다음 업로드가 같은 이름 폴더를 또 만든다');
  // §6-29-h: 무거운 호출(파일 쓰기)이 폴더 만들기까지 겸하면 첫 업로드가 가장 느리다
  const folderAt = view.search(/ensureServiceDriveFolder\(service\)/);
  const upAt = view.search(/await uploadServiceFile\(service/);
  assert.ok(folderAt > 0, 'ensureServiceDriveFolder 호출을 못 찾았다');
  assert.ok(upAt > 0, 'uploadServiceFile 호출을 못 찾았다');
  assert.ok(folderAt < upAt, '폴더 확보가 업로드보다 뒤에 있다');
});

check('초기 로드가 주보 송폼까지 끌어오지 않는다', () => {
  // files 한 표를 업무와 주보가 같이 쓴다(0047). 안 거르면 워크스페이스 스토어가
  // 주보 파일까지 지고 다니고, 주보가 쌓일수록 첫 로드가 그만큼 무거워진다.
  assert.match(cloud, /from\('files'\)\.select\('\*'\)\.is\('service_id', null\)/,
    'listAllFiles가 service_id로 안 거른다');
  assert.match(sync, /if \(!f\.card_id\) return;/, 'filesByCard가 card_id 없는 행을 안 거른다');
  // 실시간도 같다 — 송폼 한 장에 접속자 전원이 열어 둔 업무를 다시 읽으면 안 된다
  assert.match(sync, /if \(row\.service_id\) return;/, 'files 실시간이 주보 갈래를 안 가른다');
});

check('files RLS 넷이 전부 주보 갈래로 갈라져 있다 (0047)', () => {
  for (const p of ['files_select', 'files_insert', 'files_update', 'files_delete']) {
    const at = mig.indexOf(`create policy ${p} on public.files`);
    assert.ok(at > 0, `${p} 정책을 못 찾았다`);
    const body = mig.slice(at, mig.indexOf('\n\n', at));
    assert.ok(body.includes('service_id'), `${p}가 주보 갈래를 안 가른다 — 작성 중 주보의 송폼이 새어 나간다`);
  }
  // 쓰기 셋은 can_edit_service, 읽기는 발행 여부까지 본다
  const sel = mig.slice(mig.indexOf('create policy files_select'));
  assert.match(sel.slice(0, sel.indexOf('\n\n')), /s\.status = 'published' or public\.can_edit_service\(\)/,
    '작성 중 주보의 송폼이 발행 전에도 읽힌다');
  assert.match(mig, /check \(\(card_id is null\) <> \(service_id is null\)\)/, '주인 배타 CHECK가 없다');
  // set null이면 업무를 지우는 순간 card_id·service_id가 둘 다 null이 되어 그 CHECK에 걸린다
  assert.match(mig, /references public\.cards\(id\) on delete cascade/,
    'card_id가 아직 set null이다 — 배타 CHECK 때문에 업무 삭제가 23514로 죽는다');
});

// 큐시트 파일이 붙으면서 생긴 자리 — **업로드 길은 하나**이고 갈래만 인자로 갈린다.
// **되돌리기**: worshipDetail에서 kind 필터(filesOfKind)를 빼면 큐시트 파일이 송폼 줄에도 선다.
check('큐시트 파일이 송폼과 같은 길을 지나고 갈래는 kind 한 칸이다 (0054)', () => {
  // 저장 자리: 0054가 CHECK로 값을 못 박고, 옛 주보 파일은 송폼으로 백필된다
  assert.match(migKind, /check \(kind is null or kind in \('songform', 'cuesheet'\)\)/,
    'files.kind의 값이 CHECK로 못 박혀 있지 않다');
  assert.match(migKind, /update public\.files set kind = 'songform' where service_id is not null/,
    '0054 이전 주보 파일이 송폼으로 백필되지 않는다');
  // 업로드 길은 **하나**다 — 큐시트가 두 번째 uploadServiceFile 호출부를 만들면 §6-29-u다
  const ups = [...view.matchAll(/uploadServiceFile\(/g)].length;
  assert.strictEqual(ups, 1, `worshipView에 uploadServiceFile 호출이 ${ups}군데다 — 첨부를 올리는 길은 하나여야 한다`);
  assert.match(view, /uploadServiceFile\(service, ok\[i\], folderId, \{ kind \}\)/,
    '업로드가 갈래를 안 싣는다 — 큐시트로 고른 파일이 송폼으로 저장된다');
  assert.match(wsvc, /export async function uploadServiceFile\(service, file, folderId = null, \{ kind = SONGFORM \} = \{\}\)/,
    'worship.uploadServiceFile의 기본 갈래가 송폼이 아니다 — 옛 호출부의 뜻이 바뀐다');
  // 게스트 저장 자리도 갈래를 들고 있어야 브라우저 검사가 두 줄을 갈라 볼 수 있다
  const svcUp = wsvc.slice(wsvc.indexOf('export async function uploadServiceFile'));
  const guest = svcUp.slice(0, svcUp.indexOf('return { ...row, _file: file };'));
  assert.match(guest, /kind: k,/, '게스트 files 행이 kind를 안 든다');
  // 화면이 갈래로 가른다 — 조회는 한 번이고 목록은 하나다(§6-29-v와 같은 문법)
  assert.match(wsvc, /export const filesOfKind = /, '갈래 필터가 서비스 계층 한 곳에 없다');
  assert.match(wdet, /filesOfKind\(files, SONGFORM\)/, '찬양 탭이 송폼만 세우지 않는다');
  assert.match(wdet, /filesOfKind\(files, CUESHEET\)/, '말씀 탭이 큐시트 파일만 세우지 않는다');
  // 파일 줄 부품도 한 벌이다 — 두 벌이면 크기 표기·종류 칩이 화면마다 갈라진다
  assert.ok(!/function SongFormRow\(/.test(wdet), '송폼 전용 줄 부품이 남아 있다 — 큐시트와 한 벌이어야 한다');
  assert.match(wdet, /function ServiceFileRow\(/, '공용 파일 줄 부품(ServiceFileRow)이 없다');
});

check('파일 중계는 불변 캐시다(재열람 왕복 0)', () => {
  // drive_file_id의 바이트는 불변이다(첨부는 보기 링크 · 다시 올리면 id가 새로 생긴다).
  // 1시간짜리로 되돌리면 다음 날 같은 3.8MB 결산안을 열 때마다 통째로 다시 받는다.
  assert.match(filesvc, /Cache-Control', 'private, max-age=2592000, immutable'/, '불변 캐시가 아니다');
  // public로 바꾸면 안 된다 — 승인 검사를 지난 응답이 공유 캐시(CDN)에 앉으면
  // 그 검사가 비켜진다
  assert.ok(!/Cache-Control', 'public/.test(filesvc), '공유 캐시에 앉히면 승인 검사가 비켜진다');
});

// ── 합친 계정의 승인 확인 (0063 · 감사 2026-09-11) ──────────────────────────
// 이 두 경로는 **서비스 키로 돌아서 RLS도 auth.uid()도 없다.** 그래서 DB의
// is_approved()(0061부터 effective_uid()를 본다)를 못 쓰고 profiles를 직접 읽는데,
// 합친 계정의 행은 환송 처리(approved = false)라 **첨부 업로드도 미리보기도 403**이었다.
check('승인 확인이 합친 계정을 따라간다(두 경로가 같은 헬퍼)', () => {
  const helper = read('src/services/approval.js');
  assert.match(helper, /select\('approved, merged_into'\)/, '승인 칸만 읽고 있다 — 합친 계정을 못 따라간다');
  assert.match(helper, /me\.merged_into/, '남긴 계정 행을 한 번 더 읽지 않는다');
  for (const [name, code] of [['api/drive.js', api], ['api/drive-file.js', filesvc]]) {
    assert.ok(/isApprovedProfile\(supabase, user\.id\)/.test(code), `${name}이 공용 헬퍼를 안 쓴다`);
    assert.ok(!/from\('profiles'\)\.select\('approved'\)/.test(code),
      `${name}이 아직 승인 칸을 직접 읽는다 — 합친 계정이 403이 된다`);
  }
});

// ── 워드·PPT를 구글 화면으로 (2026-09-08) ──────────────────────────────────
// 사용자 요청: "PPT도 보면 좀 잘리고 그러는데, 이 pptx 뷰어나 docs도 마찬가지고, 그냥
// 실제 뷰로 볼 수 있게끔 해줄 수 있나? 우리 엑셀 미리보기 하는 것처럼!!"
// 엑셀과 같은 길이다 — 올릴 때 만든 네이티브 사본(files.preview_file_id)을 iframe으로.
{
  const { previewKind, previewCopyUrl, copyEditUrl, previewCopyOf } = await import('../src/services/previewKind.js');
  const { sheetPreviewUrl } = await import('../src/utils.js');
  const drive = (name, extra = {}) => ({ name, mime_type: '', source: 'drive', drive_file_id: 'f1', ...extra });
  const copy = (name) => drive(name, { preview_file_id: 'COPY1' });

  check('사본이 있는 워드·PPT는 구글 화면(gdoc), 없으면 우리 렌더러', () => {
    assert.strictEqual(previewKind(copy('회의록.docx')), 'gdoc', '사본 있는 워드가 구글로 안 간다');
    assert.strictEqual(previewKind(copy('발표.pptx')), 'gdoc', '사본 있는 PPT가 구글로 안 간다');
    assert.strictEqual(previewKind(copy('옛문서.doc')), 'gdoc', '옛 형식도 사본이 있으면 구글로');
    assert.strictEqual(previewKind(copy('옛발표.ppt')), 'gdoc', '옛 형식도 사본이 있으면 구글로');
    // 사본이 없으면 **지금 그대로** — 옛 첨부·변환 실패·스크립트가 낮은 판이 여기로 온다
    assert.strictEqual(previewKind(drive('회의록.docx')), 'doc', '사본이 없는데 구글로 보낸다');
    assert.strictEqual(previewKind(drive('발표.pptx')), 'slide', '사본이 없는데 구글로 보낸다');
    assert.strictEqual(previewKind(drive('옛문서.doc')), 'drive', '사본 없는 옛 형식은 그대로 편집기 미리보기');
    // 엑셀은 건드리지 않았다(사본이 있든 없든 'sheet')
    assert.strictEqual(previewKind(copy('명단.xlsx')), 'sheet', '엑셀 판정이 바뀌었다');
    assert.strictEqual(previewKind(drive('명단.xlsx')), 'sheet', '엑셀 판정이 바뀌었다');
    // 올리는 중인 파일에는 사본이 있을 수 없다 — 예전 그대로 우리 렌더러
    assert.strictEqual(previewKind({ name: 'a.pptx', source: 'local' }), 'slide', '올리는 중인 PPT');
  });

  check('사본 주소는 종류를 맞춘다 (previewCopyUrl)', () => {
    // 문서 사본을 spreadsheets 주소로 열면 아무것도 안 뜬다 — 칸이 종류마다 다르다
    assert.strictEqual(previewCopyUrl(copy('회의록.docx')),
      'https://docs.google.com/document/d/COPY1/preview?rm=minimal');
    assert.strictEqual(previewCopyUrl(copy('옛문서.doc')),
      'https://docs.google.com/document/d/COPY1/preview?rm=minimal');
    // 슬라이드는 embed다 — preview는 머리줄을 남기고 슬라이드를 작게 둔다.
    // start=false·delayms가 없으면 열자마자 저 혼자 넘어간다(기본이 자동 재생).
    // **슬라이드에만 rm=minimal이 없다**(사용자 요청 2026-09-09 "화살표로 다음·이전
    // 장표 갈 수 있게") — 구글이 아래에 그려 주는 `◀ 1 ▶` 줄이 그 인자에 같이 걷힌다.
    assert.strictEqual(previewCopyUrl(copy('발표.pptx')),
      'https://docs.google.com/presentation/d/COPY1/embed?start=false&loop=false&delayms=60000');
    assert.ok(!/rm=minimal/.test(previewCopyUrl(copy('발표.ppt')) || ''), '슬라이드에서 화살표 줄을 걷었다');
    assert.ok(/rm=minimal/.test(previewCopyUrl(copy('회의록.docx')) || ''), '문서에서는 머리줄을 남긴다');
    // 엑셀은 utils.sheetPreviewUrl과 같은 주소여야 한다(같은 사본을 두 곳에서 연다)
    assert.strictEqual(previewCopyUrl(copy('명단.xlsx')), sheetPreviewUrl(copy('명단.xlsx')),
      '엑셀 사본 주소가 두 곳에서 갈라졌다');
    // **편집 주소를 만들면 안 된다** — 링크를 아는 누구나 고칠 수 있다(HANDOFF §7 '첨부에 편집 권한 주기')
    assert.ok(!/\/edit/.test(previewCopyUrl(copy('회의록.docx')) || ''), '편집 주소를 내준다');
    assert.strictEqual(previewCopyUrl(drive('회의록.docx')), null, '사본이 없으면 주소도 없다');
    assert.strictEqual(previewCopyUrl(copy('결산.pdf')), null, 'PDF에는 구글 편집기가 없다');
    assert.strictEqual(previewCopyUrl(null), null, '값이 없어도 안전하다');
  });

  // 편집 주소는 **따로 있는 함수**가 만든다(copyEditUrl) — 위 previewCopyUrl은 영영
  // 보기다. 이 함수를 쓰는 곳은 주보 큐시트 하나이고 자격은 교역자·마스터다
  // (사용자 결정 2026-09-09). 주소만 /edit이어도 실제 경계는 드라이브의 편집자 목록이다
  // (Apps Script v10 CUE_EDITORS — 이름 있는 계정 둘. 'anyone writer'가 아니다).
  check('큐시트 사본만 편집 주소를 받는다 (copyEditUrl)', () => {
    assert.strictEqual(copyEditUrl(copy('큐시트.docx')),
      'https://docs.google.com/document/d/COPY1/edit?rm=minimal');
    assert.strictEqual(copyEditUrl(copy('명단.xlsx')),
      'https://docs.google.com/spreadsheets/d/COPY1/edit?rm=minimal');
    assert.strictEqual(copyEditUrl(copy('발표.pptx')),
      'https://docs.google.com/presentation/d/COPY1/edit?rm=minimal');
    assert.strictEqual(copyEditUrl(drive('큐시트.docx')), null, '사본이 없으면 주소도 없다');
    assert.strictEqual(copyEditUrl(copy('결산.pdf')), null, 'PDF에는 구글 편집기가 없다');
    assert.strictEqual(copyEditUrl(null), null, '값이 없어도 안전하다');
  });

  // 자격자인데도 읽기 화면이 뜨던 두 갈래 중 하나 — **브라우저의 기본 구글 계정**이
  // 편집자 계정과 다르면 구글이 읽기로 준다(사용자 신고 2026-09-10 — "편집 권한을 줬는데
  // 주보에서 수정이 안 된다"). `authuser=<이메일>`이 어느 계정으로 열지를 정한다.
  // 나머지 한 갈래(iframe의 서드파티 쿠키)는 주소로 못 고쳐서 새 탭 버튼이 받는다.
  check('이메일을 주면 authuser가 붙는다 (copyEditUrl)', () => {
    assert.strictEqual(copyEditUrl(copy('큐시트.docx'), { email: 'a@b.com' }),
      'https://docs.google.com/document/d/COPY1/edit?rm=minimal&authuser=a%40b.com',
      '이메일을 줘도 authuser가 안 붙는다');
    // 새 탭 버튼의 주소 — 폭이 넉넉하니 rm=minimal 없이 온전한 편집기다
    assert.strictEqual(copyEditUrl(copy('큐시트.docx'), { email: 'a@b.com', minimal: false }),
      'https://docs.google.com/document/d/COPY1/edit?authuser=a%40b.com');
    assert.strictEqual(copyEditUrl(copy('큐시트.docx'), { minimal: false }),
      'https://docs.google.com/document/d/COPY1/edit', '인자가 없으면 물음표도 없다');
    // + 는 이메일에 쓸 수 있는 글자다(joshua+church@gmail.com) — 안 감싸면 구글이 빈칸으로 읽는다
    assert.match(copyEditUrl(copy('큐시트.docx'), { email: 'a+c@b.com' }), /authuser=a%2Bc%40b\.com$/,
      '이메일을 encodeURIComponent로 감싸지 않았다');
    // 이메일이 없으면 **지금까지와 같은 주소**다(게스트·세션 없음)
    assert.strictEqual(copyEditUrl(copy('큐시트.docx'), {}), copyEditUrl(copy('큐시트.docx')),
      '이메일이 없을 때 주소가 달라졌다');
    // 보기 주소는 영영 보기다 — 이메일을 줘도 편집으로 새지 않는다(§7)
    assert.ok(!/\/edit/.test(previewCopyUrl(copy('큐시트.docx'), { email: 'a@b.com' }) || ''),
      'previewCopyUrl이 편집 주소를 만든다');
    assert.ok(!/authuser/.test(previewCopyUrl(copy('큐시트.docx')) || ''), '보기 주소에 계정을 싣지 않는다');
  });

  // 자격자에게는 **새 탭** 버튼이 언제나 있다(§8 기능을 숨기지 않음). 앱 안 창은
  // 서드파티 쿠키가 막힌 폰에서 읽기 화면이라, 이 버튼이 유일한 편집 길이다.
  check("자격자에게만 '구글 문서에서 편집'이 뜬다 (FilePreviewModal)", () => {
    assert.match(preview, /const editHref = canEditCopy \? copyEditUrl\(cur, \{ email: myEmail, minimal: false \}\) : null;/,
      '편집 주소가 자격(canEditCopy)에 매여 있지 않다');
    const btn = preview.slice(preview.indexOf('{editHref && ('), preview.indexOf('{!isMobile && ('));
    assert.ok(btn, '편집 버튼을 못 찾았다');
    assert.match(btn, /구글 문서에서 편집/, '버튼 글자가 없다');
    assert.match(btn, /target="_blank"/, '새 탭이 아니면 서드파티 쿠키에 다시 걸린다');
    assert.match(btn, /rel="noreferrer"/, 'rel이 없다');
    // 숨기는 조건(hover·모바일 감추기)을 달지 않는다 — 폰에서 이것뿐이다
    assert.ok(!/hidden|group-hover|isMobile/.test(btn), '버튼을 숨기는 조건이 붙었다');
    // 앱 안 iframe도 같은 계정으로 연다
    const branch = preview.slice(preview.indexOf("if (kind === 'gdoc')"), preview.indexOf("if (kind === 'sheet') {"));
    assert.match(branch, /copyEditUrl\(cur, \{ email: myEmail \}\)/, 'iframe 주소에 계정을 안 싣는다');
  });

  check('무엇에 사본을 만들지가 앱과 스크립트에서 같다 (previewCopyOf)', () => {
    for (const n of ['a.xlsx', 'a.xlsm', 'a.xls', 'a.csv']) assert.strictEqual(previewCopyOf(n), 'spreadsheet', n);
    for (const n of ['a.docx', 'a.doc']) assert.strictEqual(previewCopyOf(n), 'document', n);
    for (const n of ['a.pptx', 'a.ppt']) assert.strictEqual(previewCopyOf(n), 'presentation', n);
    for (const n of ['a.pdf', 'a.png', 'a.zip', 'a', '']) assert.strictEqual(previewCopyOf(n), null, n);
    // 스크립트의 표와 확장자 목록이 같아야 한다 — 한쪽만 늘면 "사본은 있는데 안 열리는 파일"
    const inScript = new Set([...scriptmd.matchAll(/(\w+):\s*\['GOOGLE_(\w+)'/g)].map(m => m[1]));
    for (const ext of ['xlsx', 'xlsm', 'xls', 'csv', 'docx', 'doc', 'pptx', 'ppt']) {
      assert.ok(inScript.has(ext), `스크립트의 COPY_AS에 ${ext}가 없다`);
    }
  });
}

check('앱이 v7에 워드·PPT 변환을 보내지 않는다', () => {
  // v7의 convert는 종류를 안 보고 **시트** 사본을 만든다. 워드를 보내면 글자가 표 칸에
  // 흩어진 사본이 preview_file_id에 박히고, 되돌리려면 사본을 지우고 칸을 비워야 한다.
  assert.ok(!/convert:\s*true/.test(cloud), 'cloud.js가 convert: true를 보낸다 — v7이 그것만 보고 시트 사본을 만든다');
  const fn = cloud.slice(cloud.indexOf('function attachPreviewCopy'));
  assert.ok(fn, 'attachPreviewCopy가 없다');
  assert.match(fn.slice(0, 400), /kind !== 'spreadsheet' && Number\(version \|\| 0\) < 8/,
    '스크립트 판을 안 보고 워드·PPT 변환을 보낸다');
  assert.match(fn.slice(0, 900), /action: 'convert'[\s\S]{0,80}convertTo: kind/, 'convert 액션에 convertTo를 안 싣는다');
});

check('사본 만들기가 업로드 응답을 막지 않는다', () => {
  // v7은 upload 안에서 변환까지 끝내고 답해서 올리는 시간에 변환 시간이 그대로 더해졌다
  // (사용자 지적 — "미리보기에서 엄청 오래 기다렸다가 봐야하는데"). 지금은 행을 만든 뒤
  // 뒤에서 붙인다. await을 붙이면 그 개선이 통째로 사라진다.
  assert.ok(!/await attachPreviewCopy/.test(cloud), 'attachPreviewCopy를 기다린다 — 두 단계로 가른 뜻이 없어진다');
  assert.match(cloud, /attachPreviewCopy\(row, \{/, '올린 뒤 사본을 붙이지 않는다');
  // 사본 id는 행에 UPDATE로 따라 붙는다(RLS files_update는 승인된 사람에게 열려 있다 · 0047)
  assert.match(cloud.slice(cloud.indexOf('function attachPreviewCopy')),
    /from\('files'\)\.update\(\{ preview_file_id: out\.previewId \}\)/, '사본 id를 행에 안 적는다');
  // 실패는 조용히 — 첨부는 이미 목록에 있고, 사본이 없으면 예전 길로 떨어질 뿐이다
  assert.ok(!/showToast[^\n]*사본/.test(cloud), '사본 실패로 토스트를 띄운다');
});

check('백필이 v8 미만에서 워드·PPT를 건너뛴다', () => {
  assert.match(backfill, /Number\(probe\.version \|\| 0\)/, '스크립트 판을 안 읽는다');
  assert.match(backfill, /r\.kind === 'spreadsheet' \|\| VERSION >= 8/, 'v8 미만에서도 워드·PPT를 보낸다');
  // 목록을 여기 따로 들면 앱과 갈라진다
  assert.match(backfill, /from '\.\.\/src\/services\/previewKind\.js'/, '확장자 표를 앱과 나눠 쓰지 않는다');
  // 읽기가 기본이고 --fix는 명시해야 한다(사본을 만드는 일은 되돌리기가 번거롭다)
  assert.match(backfill, /const FIX = process\.argv\.includes\('--fix'\)/, '읽기가 기본이 아니다');
});

check('gdoc은 구글 화면을 그대로 띄운다 (FilePreviewModal)', () => {
  const branch = preview.slice(preview.indexOf("if (kind === 'gdoc')"), preview.indexOf("if (kind === 'sheet') {"));
  assert.ok(branch, 'gdoc 가지를 못 찾았다');
  assert.match(branch, /previewCopyUrl\(cur\)/, '사본 주소를 안 쓴다');
  // 구글 미리보기는 언제나 밝은 화면이다 — 투명하게 두면 다크 모드에서 글자가 안 보인다
  assert.match(branch, /bg-white/, '흰 바탕을 안 깐다');
  assert.match(branch, /w-full h-full/, '틀을 꽉 안 채운다');
  // 뜨기 전에는 스켈레톤이 같은 자리를 채운다(빈 흰 칸이 먼저 보이면 그게 더 나쁘다)
  assert.match(branch, /!frameReady && <PreparingFrame absolute \/>/, '준비 중 자리가 없다');
  assert.match(branch, /FRAME_SETTLE/, 'onLoad 직후에 걷으면 첫 장이 안 그려진 채로 보인다');
  // 어느 뷰어인지 화면이 거짓말하지 않는다(§6-29-b) — 사본은 구글이다
  const note = /const viewerNote = \(row\) => \(([\s\S]{0,200}?)\);/.exec(preview)?.[1] || '';
  assert.match(note, /preview_file_id/, '사본으로 그리는 파일이 마이크로소프트로 적힐 수 있다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
