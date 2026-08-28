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
const cfg = read('src/config.js');
const filesvc = read('api/drive-file.js');
const preview = read('src/components/FilePreviewModal.jsx');

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
  assert.ok(!preview.includes('MAX_PDF_PREFETCH'), 'PDF에 크기 게이트가 다시 생겼다');
  assert.ok(preview.includes("if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';"),
    '드라이브 PDF가 크기 조건 없이 pdf로 가야 한다');
  assert.ok(preview.includes('slice(0, MAX_TEXT_CHARS)'), '큰 텍스트는 거절이 아니라 앞부분을 그린다');
  // 스프레드시트도 같다 — 파서가 500줄에서 멈추므로 크기로 가를 이유가 없어졌다
  assert.ok(preview.includes('const MAX_SHEET_BYTES = MAX_UPLOAD_BYTES;'),
    '스프레드시트 상한이 첨부 상한과 따로 논다');
  // 어쩌다 떨어지더라도 어두운 파일 뷰어가 아니라 구글 편집기 미리보기로 간다
  assert.ok(preview.includes("if (OFFICE_EXT.includes(ext) || SHEET_EXT.includes(ext)) return 'drive';"),
    '큰 스프레드시트가 어두운 파일 뷰어로 떨어진다');
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

check('로컬 바이트로 미리보기·펼쳐보기가 된다', () => {
  assert.match(preview, /const local = cur\.source === 'local'/, '미리보기가 로컬 파일을 모른다');
  assert.match(att, /row\.source === 'local' && row\._file/, '펼쳐보기가 로컬 파일을 모른다');
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

check('문서의 스크립트가 uploadFromUrl을 안다 (v6)', () => {
  assert.match(drivemd, /case 'uploadFromUrl'/, 'uploadFromUrl 액션이 없다');
  assert.match(drivemd, /UrlFetchApp\.fetch/, '주소에서 받아오지 않는다');
  assert.match(drivemd, /getResponseCode\(\) >= 300/, '받아오기 실패를 안 가린다');
});

console.log(fails ? `\n${fails} FAIL` : '\nall pass');
process.exit(fails ? 1 : 0);
