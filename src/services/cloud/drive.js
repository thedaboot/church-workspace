// ============================================================================
// 첨부의 실체 — 파일 목록 · 개인 구글 드라이브(/api/drive · docs/DRIVE.md) · 업로드 한 벌(uploadOwnedFile) ·
// 구글 변환 사본 · 주보 파일(0047) · Storage 옛 길 · 본문 이미지 · 지운 첨부의 실체 정리
// ----------------------------------------------------------------------------
// 재시도·멱등 열쇠·3MB 갈래·되돌리기의 이유는 각 자리 주석에 있다(§6-29 머리말 — 두 벌로 두지 않는다).
// ============================================================================
import { client, unwrap, getSession, sleep, accessToken, authedPost } from './core.js';
import { generateId } from '../../utils.js';
// 어떤 파일에 구글 변환 사본을 만들지 — 표를 **여는 쪽과 한 벌**로 둔다(previewKind.js).
// 두 벌이면 새 확장자를 붙일 때 한쪽만 고쳐져서 "사본은 있는데 안 열리는 파일"이 생긴다.
import { previewCopyOf } from '../previewKind.js';

// ── files / 첨부 파일 (Supabase Storage: private 버킷 'attachments') ──────────
export const ATTACH_BUCKET = 'attachments';

// 초기 로드가 읽는 것은 **업무 첨부뿐**이다. 0047부터 files에는 주보 송폼도 들어 있는데
// (service_id), 그것까지 끌어오면 워크스페이스 스토어가 업무와 상관없는 행을 지고 다닌다
// — cloudSync가 card_id 없는 행을 어차피 버리므로 순전히 낭비다(그리고 주보가 쌓일수록
// 늘어난다). 거르는 자리는 조회 한 곳이면 된다.
export async function listAllFiles() {
  return unwrap(await client().from('files').select('*').is('service_id', null).order('created_at', { ascending: true }));
}
export async function listCardFiles(cardId) {
  return unwrap(await client().from('files').select('*').eq('card_id', cardId).order('created_at', { ascending: true }));
}
// 주보 한 건에 붙은 송폼(0047). 업무 첨부와 같은 표·같은 행 모양이라 미리보기·
// 내려받기·삭제가 전부 그대로 동작한다.
export async function listServiceFiles(serviceId) {
  return unwrap(await client().from('files').select('*').eq('service_id', serviceId).order('created_at', { ascending: true }));
}

// ── 개인 구글 드라이브 (docs/DRIVE.md · 스크립트는 docs/APPS_SCRIPT.md) ─────
// 첨부의 실체를 드라이브로 옮기고 DB에는 참조만 남긴다. 브라우저는 스크립트 URL을
// 모르고 /api/drive가 대신 부른다. 드라이브가 설정되지 않은 환경(로컬·프리뷰)은
// 501을 돌려주므로 부르는 쪽이 Storage로 되돌린다.
// 여러 번 불러도 결과가 같은 액션들. 이것들만 재시도한다 —
// upload은 스크립트가 파일을 **새로 만들기** 때문에 그냥 다시 보내면 파일이 두 개가 된다
// (그래서 재시도는 열쇠를 아는 v5 스크립트에서 uploadWithRetry가 따로 한다).
const IDEMPOTENT = new Set(['ensureFolder', 'renameFolder', 'trash', 'list']);
// 끊긴 업로드가 실제로 끝났는지 확인하기 전에 기다리는 시간. 상한(10MB)이 35초쯤이고
// 예산이 55초라 보통은 끊길 일이 없지만, 끊겼다면 스크립트가 마무리 중일 공산이 크다.
const VERIFY_WAIT_MS = 4000;
const RETRY_WAITS = [400, 1200];     // 두 번까지, 점점 길게 (sleep은 위 시계-오차 재시도가 이미 두었다)

async function driveOnce(payload) {
  // 토큰은 core.accessToken 한 벌로 꺼낸다 — `getSession()`의 모양 함정(§6-29)은 그 머리말에 있다.
  const r = await authedPost('/api/drive', payload, {
    noToken: () => { const e = new Error('로그인이 필요해요'); e.human = '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요'; throw e; },
  });
  const out = await r.json().catch(() => ({}));
  if (r.status === 501) { const e = new Error('드라이브 미설정'); e.notConfigured = true; throw e; }
  if (!r.ok) {
    // 서버가 한국어로 이유를 준다 — 그대로 화면에 실어야 무엇이 막혔는지 보인다.
    // status도 같이 남긴다(로그에서 401/403/413/502/504를 가르기 위해).
    const e = new Error(out.error || `드라이브 오류 (${r.status})`);
    e.human = out.error || `드라이브가 응답하지 않았어요 (${r.status})`;
    e.status = r.status;
    e.timeout = !!out.timeout || r.status === 504;
    // 스크립트가 스스로 뱉은 오류는 다시 해도 같다(권한 부족·모르는 액션 등).
    // 이 표시가 없으면 실패마다 확인·재시도가 한 번씩 더 붙어 헛왕복이 된다.
    e.scriptError = !!out.scriptError;
    console.error('[drive] 실패:', r.status, out);
    throw e;
  }
  return out;
}

// 다시 해볼 만한 실패인가 — 시간 초과·게이트웨이 오류·네트워크 끊김.
// 401(로그인)·403(미승인)·413(용량 초과)은 다시 해도 같으므로 바로 포기한다.
const worthRetry = (e) => !e?.notConfigured && !e?.scriptError
  && (e?.timeout || e?.status === 502 || e?.status === 504 || e?.status === undefined);

async function driveCall(payload) {
  const action = payload?.action || 'upload';
  if (!IDEMPOTENT.has(action)) return driveOnce(payload);
  let last;
  for (let i = 0; i <= RETRY_WAITS.length; i++) {
    try { return await driveOnce(payload); }
    catch (e) {
      last = e;
      if (i === RETRY_WAITS.length || !worthRetry(e)) throw e;
      console.warn(`[drive] ${action} 재시도 ${i + 1}회 (${e.human || e.message})`);
      await sleep(RETRY_WAITS[i]);
    }
  }
  throw last;
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onerror = () => {
    const e = fr.error || new Error('파일을 읽지 못했어요');
    e.human = '파일을 읽지 못했어요\n다른 파일로 해보시거나 다시 시도해주세요';
    reject(e);
  };
  // data:...;base64,XXXX → 앞머리를 떼고 보낸다
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.readAsDataURL(file);
});

// 드라이브 파일의 그림 주소. 구글 이미지 CDN이 **줄여서** 내주므로 우리 대역폭이 0이다
// (스크립트가 올릴 때 '링크를 아는 사람은 보기'로 열어 둔다 — 사용자 결정 2026-08-25).
export const driveImageUrl = (fileId, size = 200) =>
  `https://lh3.googleusercontent.com/d/${fileId}=w${size}-h${size}-c`;
// 미리보기용 — 자르지 않고(=s: 긴 변 기준) 크게. 주소가 고정이라 브라우저가 캐싱한다
// (서명 URL은 발급마다 달라서 캐시가 통째로 빗나갔다 — Egress에서 겪은 함정).
export const driveImageFullUrl = (fileId, size = 1600) =>
  `https://lh3.googleusercontent.com/d/${fileId}=s${size}`;

// 드라이브 파일 바이트 — PDF를 앱 안 pdf.js로 그릴 때 쓴다(/api/drive-file 주석).
// 브라우저는 drive.google.com에 CORS로 막히므로 서버가 얇게 중계한다.
// `as: 'docx'` — 구글 문서를 .docx로 내보내 받는다(api/drive-file.js의 그 갈래)
// 내보낼 수 있는 오피스 모양 → 파일 형식. 예배의 '지난 큐시트로 바로 편집'(worship/files.lastCueFile)이 같은 표를 쓴다.
export const OFFICE_TYPE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export async function fetchDriveFileBlob(fileId, { as = null } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('로그인이 필요합니다.');
  const r = await fetch(`/api/drive-file?id=${encodeURIComponent(fileId)}${Object.keys(OFFICE_TYPE).includes(as) ? `&as=${as}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const out = await r.json().catch(() => ({}));
    const e = new Error(out.error || `파일을 받아오지 못했어요 (${r.status})`);
    e.human = out.error;
    throw e;
  }
  return r.blob();
}

// 업로드 한 번의 **멱등 열쇠**. 스크립트 v5가 이 값을 파일 설명에 적어 두고,
// 재시도일 때 같은 열쇠의 파일이 이미 있으면 새로 만들지 않고 그것을 돌려준다.
// v4 스크립트는 이 값을 그냥 무시하므로 붙여 보내도 안전하다. 만들기는 utils.generateId 한 벌이다
// (randomUUID가 없는 브라우저 폴백까지 거기 있다).
const newKey = generateId;

// 업로드는 **그냥 재시도하면 안 된다** — 스크립트가 파일을 새로 만들기 때문에
// "타임아웃은 났지만 사실 올라갔던" 경우 파일이 두 개가 된다(사용자가 겪은 상황).
// 그래서 실패하면 먼저 **정말 안 올라갔는지 확인**하고, 없을 때만 다시 보낸다.
//  · v5 스크립트: list로 열쇠를 찾아본다 → 있으면 그 파일을 그대로 쓴다
//  · v4 스크립트: list가 'unknown action'으로 떨어진다 → 재시도하지 않고 실패를 알린다
//    (모르면 안 하는 쪽이 낫다 — 중복 파일은 사람이 지워야 한다)
async function uploadOnceOrFind(payload, folderHint) {
  try {
    return await driveOnce(payload);
  } catch (e) {
    if (e.notConfigured || !worthRetry(e)) throw e;
    // **끊긴 뒤에는 잠깐 기다렸다 확인한다.** 우리가 시간 예산으로 끊어도 스크립트는
    // 계속 돌아 파일을 다 쓴다. 곧바로 확인하면 아직 없어서 "안 올라갔다"로 보고
    // 다시 보내게 되고, 그러면 파일이 두 개가 된다. 열쇠 검사는 **이미 다 쓰인 뒤**만
    // 막아주므로, 그 사이를 기다려서 메운다.
    if (e.timeout) await sleep(VERIFY_WAIT_MS);
    let found = null;
    let foundIn = null;
    try {
      const seen = await driveCall({ action: 'list', ...folderHint });
      foundIn = seen?.folderId || null;
      found = (seen?.files || []).find(f => f.key === payload.key) || null;
    } catch (le) {
      // list를 모르는 스크립트(v4)이거나 그것마저 실패 — 다시 보내지 않는다
      console.warn('[drive] 업로드 확인 불가(스크립트가 list를 모르거나 실패):', le.human || le.message);
      throw e;
    }
    if (found) {
      console.warn('[drive] 타임아웃이었지만 파일은 올라가 있었다 — 그 파일을 쓴다:', found.name);
      return { id: found.id, url: found.url, folderId: folderHint.folderId || foundIn || undefined, existing: true };
    }
    console.warn('[drive] 업로드가 정말 안 됐다 — 한 번 다시 보낸다');
    return driveOnce({ ...payload, retry: true });
  }
}

// Vercel 함수가 받아 주는 요청 몸통의 한도. **실측**(2026-08-28, 배포된 함수에
// 크기별로 던져 봄): 4MB는 401까지 가고 4.4MB부터 413 FUNCTION_PAYLOAD_TOO_LARGE다.
// base64가 33%를 붙이니 실제 파일은 3.3MB가 천장이었고, 그보다 큰 파일은
// **함수에 닿지도 못하고** 가장자리에서 잘렸다 — 우리가 준비한 한국어 이유조차
// 나올 수 없었다(사용자 신고: 20MB PDF가 올리자마자 실패).
// 여유를 두고 3MB로 잡는다. 이보다 크면 Storage를 거쳐 나른다(uploadViaStorage).
const INLINE_MAX = 3 * 1024 * 1024;

// 큰 파일 — 바이트가 **우리 함수를 지나가지 않는다.**
// 브라우저가 Storage에 직접 올리고(그 길에는 함수가 없어 4.5MB 한도가 없다),
// 스크립트에는 주소만 넘겨 받아 가게 한다.
//
// **스크립트가 v5면(uploadFromUrl을 모르면) 그 파일은 Storage에 그대로 둔다.**
// 이 앱은 원래 Storage에 파일을 두던 구조이고 읽기 경로가 아직 파일 한 건 단위로
// 갈라져 있어서(files.source), 그대로 두어도 미리보기·썸네일·새 탭이 전부 동작한다.
// 스크립트를 못 고치는 상황에서도 큰 파일이 **올라가기는 해야 한다** — 실패하는 것보다
// 낫고, 나중에 v6을 올리면 scripts/migrate_to_drive.mjs가 드라이브로 옮겨 준다.
//
// 돌려주는 것: { drive } 또는 { storagePath } 중 하나.
// `prefix`는 Storage에 둘 자리의 앞머리다 — 업무 첨부는 `<프로젝트>/<업무>`,
// 주보 송폼은 `services/<주보>`(0047). 부르는 쪽이 정한다.
async function uploadViaStorage(file, { prefix, key, folderHint, name = file.name }) {
  const c = client();
  const safe = (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${prefix}/${newKey()}-${safe}`;
  const put = await c.storage.from(ATTACH_BUCKET).upload(path, file, {
    contentType: file.type || undefined, upsert: false, cacheControl: '2592000',
  });
  if (put.error) throw put.error;

  let signed;
  try {
    const data = unwrap(await c.storage.from(ATTACH_BUCKET).createSignedUrl(path, 600));
    signed = data.signedUrl;
  } catch (e) {
    console.warn('[drive] 주소를 못 만들어 Storage에 둔다:', e.message || e);
    return { storagePath: path };
  }

  try {
    const drive = await uploadOnceOrFind({
      action: 'uploadFromUrl',
      ...folderHint,
      key,
      url: signed,
      name, mimeType: file.type || undefined,
    }, folderHint);
    // 드라이브로 갔으니 옮겨 담는 자리는 치운다. 실패해도 던지지 않는다 —
    // 남은 사본은 용량만 차지하고, 그것 때문에 첨부가 막히면 안 된다.
    c.storage.from(ATTACH_BUCKET).remove([path])
      .then(r => { if (r.error) console.warn('[drive] 임시 사본 정리 실패:', r.error.message); })
      .catch(e => console.warn('[drive] 임시 사본 정리 실패:', e));
    return { drive };
  } catch (e) {
    // v5 스크립트는 'unknown action'을 돌려준다. 그 밖의 실패도 같이 받는다 —
    // 파일은 이미 Storage에 올라가 있으므로 **버리지 않고 그대로 쓴다.**
    console.warn('[drive] 드라이브로 못 옮겨 Storage에 둔다:', e.human || e.message || e);
    return { storagePath: path };
  }
}

// ── 구글 변환 사본 (files.preview_file_id) ──────────────────────────────────
// 엑셀은 시트로, 워드는 문서로, PPT는 슬라이드로 옮긴 **네이티브 구글 사본**을 만들어
// 둔다. 구글은 오피스 파일을 **열어볼 때** 게을리 변환해서, 사본이 없으면 갓 올린 파일의
// 미리보기가 오류를 낸다(§6 · utils.SHEET_READY_MS). 원본은 그대로 둔다 —
// 내려받기·새 탭·첨부 내용 검색이 원본을 쓴다.
//
// **왜 두 단계인가**(2026-09-08). v7까지는 스크립트가 upload 안에서 변환까지 끝내고
// 답했다. 그러면 올리는 시간에 변환 시간이 **그대로 더해져서**, 쓰는 사람은 파일이
// 목록에 서는 것조차 그만큼 늦게 봤다(사용자 지적 — "미리보기에서 엄청 오래 기다렸다가
// 봐야하는데 이 문제도 개선"). 지금은 원본만 올려 곧바로 행을 만들고, 사본은 **뒤에서**
// 붙인다. 사본이 붙기 전에 열면 우리 렌더러로 그려지고(잘리지만 보이기는 한다),
// 그 뒤에 열면 구글 화면이다.
//
// **v7에 워드·PPT를 보내면 안 된다.** v7의 convert 액션은 종류를 안 보고 **시트** 사본을
// 만들어서, 글자가 표 칸에 흩어진 사본이 preview_file_id에 박힌다. 스크립트가 답마다
// 실어 보내는 version으로 가른다(v7 이하에는 그 칸이 없다 → 0으로 읽힌다).
// 엑셀은 v7도 제대로 만들므로 버전을 안 따진다.
function attachPreviewCopy(row, { fileId, name, folderId, kind, version, cueEditors = false }) {
  if (!kind || !fileId) return null;
  if (kind !== 'spreadsheet' && Number(version || 0) < 8) return null;
  // **보통은 await 하지 않는다.** 첨부는 이미 목록에 서 있고, 사본은 늦게 붙어도 된다.
  // 약속은 돌려준다 — `지난 큐시트로 바로 편집`은 사본이 서야 편집 화면을 열 수 있다(uploadOwnedFile awaitCopy).
  return (async () => {
    try {
      // name·folderId를 같이 보내면 스크립트가 파일을 다시 묻지 않는다(왕복 한 번 절약).
      //
      // **사본을 고칠 수 있는 사람은 계정 단위로 정해진다**(사용자 결정 2026-09-11 ·
      // Apps Script v11). 두 갈래다:
      //  · 큐시트 — 교역자·마스터 둘뿐이다(2026-09-09). 누구인지는 스크립트의
      //    `CUE_EDITORS`가 안다 — 개인 지메일 주소를 앱 번들에 박지 않으려는 것이다.
      //  · 그 밖의 첨부 — **올린 사람 + 관리자 + 마스터.** 여기서 적는 것은 올린 사람
      //    하나이고, 관리자·마스터는 서버가 더한다(api/drive.js `editorsFor`):
      //    `admins` 표는 관리자에게만 열려 있어서(0022) 여기서 읽으면 일반 사용자에게는
      //    오류가 아니라 **0행**이 오고, 관리자가 빠진 줄 아무도 모른 채 지나간다.
      // v11 미만은 이 칸들을 모르므로 그냥 무시한다 — 사본은 만들어지고 보기만 된다.
      const mine = cueEditors ? null : (await getSession())?.user?.email || null;
      const out = await driveCall({
        action: 'convert', fileId, name, folderId, convertTo: kind,
        ...(cueEditors ? { cueEditors: true } : { editors: mine ? [mine] : [] }),
      });
      if (!out?.previewId) return;
      await client().from('files').update({ preview_file_id: out.previewId }).eq('id', row.id);
      // 이 화면이 들고 있는 행에도 적어 둔다 — 다시 그릴 때 바로 구글 화면으로 간다.
      // (다른 화면·다른 사람은 다음 조회에서 받는다. 실시간을 걸 만한 값이 아니다.)
      row.preview_file_id = out.previewId;
    } catch (e) {
      // 사본이 없으면 앱이 예전 길(우리 렌더러)로 떨어진다 — 첨부 자체는 멀쩡하다.
      // 여기서 토스트를 띄우면 "올라갔는데 실패했다"로 읽힌다. 조용히 넘긴다.
      console.warn('[drive] 미리보기 사본을 못 만들었어요(첨부는 그대로):', e.human || e.message || e);
    }
  })();
}

// **이미 만들어진 사본에 편집자를 뒤늦게 붙인다**(Apps Script v11 `grantEditors`).
// 사본을 만들 때(위 attachPreviewCopy) 한 번 붙지만 그것으로 안 되는 두 경우가 있다:
//  · v10까지 올린 **옛 첨부** — 편집자가 하나도 없다
//  · 사본이 생긴 **뒤에 관리자가 된 사람** — 그 명단은 서버가 부를 때마다 다시 읽는다
// 그래서 '구글 문서에서 편집'을 누를 때마다 부른다. 멱등이라 두 번 불러도 같다.
// 명단은 여기서 정하지 않는다 — 보낸 이메일에 서버가 부르는 사람·관리자·마스터를
// 더한다(api/drive.js `editorsFor`). **기다려야 한다** — 권한이 붙기 전에 편집 주소를
// 열면 구글이 읽기 화면을 주고, 그게 "편집이 안 된다"의 정체다(§6-34-h).
export async function grantCopyEditors(row, emails = []) {
  const fileId = row?.preview_file_id;
  if (!fileId) throw new Error('구글 사본이 아직 없어요');
  return driveCall({ action: 'grantEditors', fileId, editors: emails.filter(Boolean) });
}

// ============================================================================
// 첨부 한 건이 지나가는 **하나의 길**. 업무 첨부와 주보 송폼(0047)이 이것을 같이 쓴다.
// ----------------------------------------------------------------------------
// 두 갈래가 다른 것은 셋뿐이다:
//   folderHint     — 드라이브의 어느 폴더로 갈지
//   owner          — files 행의 주인 칸(`{project_id, card_id}` 또는 `{service_id}`)
//   prefix         — Storage를 거칠 때 임시 사본을 둘 자리
//   rememberFolder — 스크립트가 폴더를 새로 판 경우 그 id를 어디에 적을지(0026·0047)
// 나머지 — 3MB 갈래(INLINE_MAX) · 멱등 열쇠 · 타임아웃 뒤 확인 · 시트 변환 사본 ·
// 행을 못 만들면 올린 파일 되돌리기 — 는 **두 갈래가 똑같아야 하는 것들**이라 여기
// 한 벌로 둔다. 두 벌로 두면 고칠 때마다 한쪽만 고쳐진다(§6-29 머리말의 그 함정).
// ============================================================================
async function uploadOwnedFile(file, { folderHint, owner, prefix, rememberFolder, awaitCopy = false }) {
  // 이름은 **NFC로 한 번 맞춘 것**을 이 흐름 전체가 쓴다. 맥(사파리·파인더)에서 고른 파일은
  // 한글이 자모로 풀린 NFD로 오는데, 그대로 저장하면 같은 글자를 쳐도 검색에 안 걸리고
  // 드라이브에서도 이름이 다른 파일로 보인다(라이브 15행 · 2026-09-24 · 0072가 옛 행을 맞춘다).
  const name = String(file.name || '').normalize('NFC');
  const c = client();
  const key = newKey();
  const copyKind = previewCopyOf(name);   // 'spreadsheet'|'document'|'presentation'|null
  let up = null;          // 드라이브에 올라간 경우
  let storagePath = null; // Storage에 남긴 경우(스크립트가 v5거나 옮기기 실패)
  try {
    if ((file.size ?? 0) > INLINE_MAX) {
      const out = await uploadViaStorage(file, { prefix, key, folderHint, name });
      up = out.drive || null;
      storagePath = out.storagePath || null;
    } else {
      up = await uploadOnceOrFind({
        action: 'upload',
        ...folderHint,
        key,
        name, mimeType: file.type || undefined,
        dataBase64: await fileToBase64(file),
      }, folderHint);
    }
  } catch (e) {
    if (!e.notConfigured) throw e;
    // 드라이브가 없는 환경 — 예전 경로 그대로
    return uploadToStorageOnly(file, { owner, prefix, name });
  }

  let row;
  try {
    row = unwrap(await c.from('files').insert({
      ...owner,
      name,
      mime_type: file.type || null,
      size_bytes: file.size ?? null,
      ...(up
        ? { source: 'drive', drive_file_id: up.id, web_view_link: up.url,
            // 사본은 보통 아래에서 **뒤에 붙는다**. 이 칸이 여기서 채워지는 것은 옛
            // 화면(캐시된 탭)이 upload에 convert를 실어 보낸 경우뿐이다 — 그때는
            // 스크립트가 이미 만들어 돌려줬으니 두 번 만들지 않는다.
            ...(up.previewId ? { preview_file_id: up.previewId } : {}) }
        : { source: 'storage', storage_path: storagePath }),
    }).select().single());
  } catch (e) {
    // 드라이브에는 올라갔는데 DB 행을 못 만든 경우다. **올린 파일을 도로 휴지통으로
    // 보낸다** — 안 그러면 "드라이브에는 있는데 앱에는 없는" 파일이 영영 남고,
    // 그건 싱크가 아니라 유실이다(사용자가 짚은 바로 그 어긋남).
    console.error('[drive] 올라갔지만 files 행 생성 실패:', e);
    try {
      if (up) await driveCall({ action: 'trash', fileId: up.id });
      else if (storagePath) await c.storage.from(ATTACH_BUCKET).remove([storagePath]);
    } catch (te) { console.error('[drive] 되돌리기도 실패 — 실체가 남는다:', te); }
    e.human = e.human || `파일을 목록에 넣지 못해 되돌렸어요\n${e.message || e}`;
    throw e;
  }

  // 폴더를 이번에 처음 판 경우 id를 적어 둔다(다음 업로드부터 id로 넣는다).
  // 실패하면 **알린다** — 조용히 넘기면 다음 업로드가 같은 이름 폴더를 하나 더 만들고
  // 한 주인의 파일이 두 폴더로 갈라진다(드라이브는 같은 이름 형제를 허용한다).
  if (up?.folderId && rememberFolder) {
    try { await rememberFolder(up.folderId); }
    catch (e) { console.error('[drive] 폴더 id 저장 실패 — 다음 업로드가 폴더를 또 만들 수 있다:', e); }
  }
  // 미리보기 사본은 **여기서 기다리지 않는다**(위 attachPreviewCopy 머리말).
  // 행이 이미 있으므로 사본 id는 몇 초 뒤 UPDATE로 따라 붙는다.
  if (up && !row.preview_file_id) {
    const copying = attachPreviewCopy(row, {
      fileId: up.id, name, folderId: up.folderId,
      kind: copyKind, version: up.version,
      cueEditors: row.kind === 'cuesheet',
    });
    if (awaitCopy && copying) await copying;   // 실패해도 던지지 않는다(attachPreviewCopy가 삼킨다) — 행은 그대로 선다
  }

  // 부르는 쪽(병렬 업로드)이 나머지 파일을 이 폴더 id로 바로 넣을 수 있게 실어 보낸다
  // — files 컬럼이 아니라 임시 속성이다(DB에는 cards/services.drive_folder_id가 원본).
  return Object.assign(row, { _driveFolderId: up?.folderId });
}

export async function uploadAttachment(file, { projectId, cardId, projectName, driveFolderId, cardTitle, cardFolderId }) {
  // 업무 폴더 id를 이미 알면 그것만 보낸다(cardTitle을 같이 보내면 그 안에 또
  // 같은 이름 폴더를 판다 — 0026). 폴더 만들기는 부르는 쪽이 미리 끝낸다.
  const folderHint = cardFolderId
    ? { folderId: cardFolderId }
    : { folderId: driveFolderId || undefined, projectName: projectName || '기타', cardTitle: cardTitle || undefined };
  return uploadOwnedFile(file, {
    folderHint,
    owner: { project_id: projectId, card_id: cardId },
    prefix: `${projectId}/${cardId}`,
    rememberFolder: cardFolderId ? null : (folderId) => setCardFolder(cardId, folderId),
  });
}

// ── 주보에 붙는 파일 — 송폼 · 큐시트 (0047 · 갈래는 0054) ───────────────────
// 드라이브 자리는 `더다붓 워크스페이스/예배/<YYYY-MM-DD>/`다. Apps Script는 고칠 것이
// 없다 — folderFor가 path 배열을 따라 내려가며 없으면 만든다(v7 · 이름으로 찾으므로
// 멱등하다). 두 번째 업로드부터는 services.drive_folder_id로 곧장 간다.
//
// **송폼과 큐시트는 같은 표·같은 폴더·같은 업로드 한 벌이다**(§6-29-u). 다른 것은
// `files.kind` 한 칸뿐이고, 그 값이 화면에서 어느 줄에 서느냐를 정한다(0054).
export const SERVICE_DRIVE_ROOT = '예배';
export const serviceFolderPath = (serviceDate) => [SERVICE_DRIVE_ROOT, String(serviceDate || '날짜 미정')];

// 주보 폴더 id만 적는다 — 주보 폼을 통째로 보내지 않는다(저장 중인 남의 편집을
// 같이 덮는다 · setCardFolder와 같은 이유).
export async function setServiceFolder(serviceId, folderId) {
  return unwrap(await client().from('services').update({ drive_folder_id: folderId }).eq('id', serviceId).select('id').single());
}

// 폴더를 **파일 바이트가 오가기 전에** 확보한다(§6-29-h — 업무 폴더와 같은 이유).
// 실패해도 null을 돌려주고 업로드는 진행한다: 스크립트가 path로 폴더를 찾는 폴백이
// 있어서 파일은 제자리에 간다. 폴더 id를 못 적는 것뿐이다.
export async function ensureServiceFolder(service) {
  if (service?.drive_folder_id) return service.drive_folder_id;
  if (!service?.id || !service?.service_date) return null;
  try {
    const { folderId } = await ensureDriveFolder(null, null, serviceFolderPath(service.service_date));
    if (!folderId) return null;
    await setServiceFolder(service.id, folderId);
    return folderId;
  } catch (e) {
    if (!e.notConfigured) console.error('[drive] 주보 폴더 확보 실패:', e);
    return null;
  }
}

// `kind`를 안 주면 'songform'이다 — 0047부터 이 함수를 부른 자리가 전부 송폼이었고,
// 0054가 옛 행을 그 값으로 백필했다. null로 두면 업무 첨부(card_id)와 구분이 없어진다.
export const SERVICE_FILE_KINDS = ['songform', 'cuesheet', 'cover'];   // cover = 표지 사진(0081)
export async function uploadServiceFile(file, { serviceId, serviceDate, serviceFolderId, kind = 'songform', awaitCopy = false }) {
  const folderHint = serviceFolderId
    ? { folderId: serviceFolderId }
    : { path: serviceFolderPath(serviceDate) };
  return uploadOwnedFile(file, {
    folderHint,
    owner: { service_id: serviceId, kind: SERVICE_FILE_KINDS.includes(kind) ? kind : 'songform' },
    prefix: `services/${serviceId}`,
    rememberFolder: serviceFolderId ? null : (folderId) => setServiceFolder(serviceId, folderId),
    awaitCopy,
  });
}

// 첨부에서 뽑은 글자(0030). 그 한 칸만 건드린다 — 파일 행을 통째로 보내면
// 같은 시각에 올라간 다른 정보를 덮는다(요약 고정이 세 칸만 쓰는 것과 같은 이유).
// 업로드가 끝난 뒤에 따로 부르므로 실패해도 첨부 자체는 멀쩡하다.
export async function setFileExcerpt(fileId, text) {
  return unwrap(await client().from('files').update({ text_excerpt: text || null }).eq('id', fileId).select('id').single());
}

// 업무 폴더 id만 적는다. 카드 폼을 통째로 보내지 않는다 — 그러면 저장 중인 남의
// 편집을 같이 덮는다(§6-28-a와 같은 이유).
export async function setCardFolder(cardId, folderId) {
  return unwrap(await client().from('cards').update({ drive_folder_id: folderId }).eq('id', cardId).select('id').single());
}

// 폴더를 미리 확보한다. path를 주면 여러 겹을 **한 번에** 만든다
// (프로젝트/업무 두 겹을 한 호출로 — 왕복이 하나 줄어든다).
export async function ensureDriveFolder(projectName, folderId, path) {
  return driveCall({ action: 'ensureFolder', projectName, folderId: folderId || undefined, path: path || undefined });
}
export async function renameDriveFolder(folderId, newName) {
  return driveCall({ action: 'renameFolder', folderId, newName });
}

// 예전 경로(Supabase Storage). 드라이브 이전 파일과 미설정 환경이 쓴다.
// owner·prefix는 위 uploadOwnedFile이 넘긴다 — 업무 첨부든 주보 송폼이든 같은 길이다.
async function uploadToStorageOnly(file, { owner, prefix, name = file.name }) {
  const c = client();
  const safe = (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  // 열쇠 만들기는 위 newKey 한 벌이다(randomUUID가 없는 브라우저 폴백까지 거기 있다)
  const path = `${prefix}/${newKey()}-${safe}`;
  // cacheControl: 경로에 uuid가 박혀 있어 **같은 주소가 다른 그림이 될 수 없다.**
  // 기본값은 1시간이라, 한 시간 뒤 다시 열면 (주소가 같아도) 되묻는 왕복이 생긴다.
  // 30일로 두면 그 왕복도 사라진다. 이미 올라간 파일은 그대로 3600이고, 그쪽은
  // ETag 덕에 304(본문 0바이트)로 끝난다.
  const up = await c.storage.from(ATTACH_BUCKET).upload(path, file, {
    contentType: file.type || undefined, upsert: false, cacheControl: '2592000',
  });
  if (up.error) throw up.error;
  try {
    return unwrap(await c.from('files').insert({
      ...owner,
      name,
      mime_type: file.type || null,
      storage_path: path,
      size_bytes: file.size ?? null,
      source: 'storage',
    }).select().single());
  } catch (e) {
    try { await c.storage.from(ATTACH_BUCKET).remove([path]); } catch (_) { /* 정리 실패는 무시 */ }
    throw e;
  }
}

// 본문 이미지: 공개 버킷 'content-images'에 업로드 → publicUrl 반환
// (RichText가 이미지 URL을 렌더하므로 텍스트에 URL만 삽입하면 됨)
const CONTENT_IMG_BUCKET = 'content-images';
export async function uploadContentImage(file) {
  const c = client();
  const { data: { user } } = await c.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  const ext = (file.type && file.type.split('/')[1]) || (file.name || '').split('.').pop() || 'png';
  const path = `${user.id}/${crypto.randomUUID()}.${ext.toLowerCase()}`;
  const up = await c.storage.from(CONTENT_IMG_BUCKET).upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (up.error) throw up.error;
  const { data } = c.storage.from(CONTENT_IMG_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ── 지운 첨부의 실체 정리 — 업무·프로젝트·첨부 삭제가 같이 쓴다(§6-29-e) ──────────
// 행은 부르는 쪽이 **먼저** 지웠다 — 드라이브 왕복을 기다렸다 행을 지우면 그 사이 재조회가
// 지운 것을 화면에 되살린다. 여기는 최선이고 **던지지 않는다**: 실패는 콘솔에 남기고 넘어간다
// (드라이브는 30일 복구된다 · 사용자 결정). 같은 것을 두 번 불러도 결과가 같다(휴지통·삭제는 멱등).
//
// 폴더 하나를 휴지통에 넣으면 안의 파일이 전부 따라간다(파일마다 Apps Script 왕복을 하면 사진
// 열 장짜리 업무 삭제가 십수 초다). 폴더 휴지통은 스크립트 v4부터다(docs/APPS_SCRIPT.md 판 이력) —
// 옛 스크립트면 실패하므로 그때는 파일 단위로 되돌아간다. 실패를 조용히 넘기면 드라이브에 고아가 남는다.
// → 넣었으면 true. id가 없거나 실패하면 false(부르는 쪽이 파일 단위로 내려간다).
export async function trashFolder(folderId, what, fallback = '') {
  if (!folderId) return false;
  try { await driveCall({ action: 'trash', fileId: folderId }); return true; }
  catch (e) { console.error(`[cloud] ${what} 휴지통 이동 실패${fallback ? `(${fallback})` : ''}:`, e); return false; }
}

// 파일마다: Storage(레거시) 객체는 지우고, 드라이브 파일은 **변환 사본 먼저**(0031 — 원본 삭제가 실패해도
// 사본만 남는 일이 없게) 휴지통으로. `inTrashedFolder(f)`가 참인 드라이브 파일은 폴더째 이미 갔다.
export async function trashFileBodies(files, { inTrashedFolder = () => false } = {}) {
  const c = client();
  for (const f of files || []) {
    if (f.storage_path) {
      try { await c.storage.from(ATTACH_BUCKET).remove([f.storage_path]); }
      catch (e) { console.error('[cloud] Storage 정리 실패:', f.name, e); }
    }
    if (f.source !== 'drive' || !f.drive_file_id || inTrashedFolder(f)) continue;
    for (const id of [f.preview_file_id, f.drive_file_id].filter(Boolean)) {
      try { await driveCall({ action: 'trash', fileId: id }); }
      catch (e) { console.error('[drive] 휴지통 이동 실패:', f.name, e.human || e.message || e); }
    }
  }
}
