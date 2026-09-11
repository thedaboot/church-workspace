# Apps Script — 붙여넣을 코드 (v10)

개인 지메일 드라이브는 서비스 계정으로 못 만진다(공유 드라이브가 없어 소유권도 용량도
서비스 계정에 갈 수 없다). 남는 길은 소유자 계정으로 도는 웹앱 하나이고, 우리 서버는 그
URL로 요청만 보낸다 — 토큰 만료도 갱신 관리도 없다. 구조와 한계는 `docs/DRIVE.md`.

## 전체 코드

> **맨 위 두 줄은 그대로 두세요.**
> ```js
> const ROOT_FOLDER_ID = '...';   // 그대로
> const SHARED_TOKEN   = '...';   // 그대로
> ```
> 아래 코드에는 이 둘의 **선언이 없습니다**(쓰기만 합니다). 파일을 통째로 갈아 끼우면
> `ROOT_FOLDER_ID is not defined`로 죽습니다. **그 두 줄 아래부터** 바꾸세요.
> 값은 Vercel 환경변수가 아니라 스크립트 안에만 있어서, 지우면 드라이브에서 폴더 id를
> 다시 찾아야 합니다.
>
> 고급 드라이브 서비스는 v7에서 켰습니다(편집기 왼쪽 **서비스(+)** → **Drive API** → v3 →
> 식별자 `Drive`). 목록에 `Drive`가 없으면 그것부터 추가하세요 — 없으면
> `Drive.Files.copy`에서 `Drive is not defined`로 죽습니다.

```js
// **이 스크립트가 몇 판인지.** 모든 답(json)에 실려 나간다 — 부르는 쪽이 "이 계정에
// v8 이상이 올라갔나"를 물을 자리가 여기 말고는 없다(아래 json 참고). 앱은 `>= 8`만 본다.
const SCRIPT_VERSION = 10;

const KEY_PREFIX = 'wskey:';   // v6까지 description에 쓰던 접두사 — 읽기 위해 남긴다
const KEY_PROP = 'wskey';      // v7부터는 appProperties에 쓴다(질의로 찾을 수 있다)

// 큐시트 사본을 고칠 수 있는 구글 계정(사용자 결정 2026-09-09 — 교역자와 마스터만).
// **여기 있는 계정만** 편집자가 된다 — role을 'writer'/type 'anyone'으로 올리면 링크를
// 아는 누구나 고칠 수 있고 그건 뺀 길이다(HANDOFF §7). 사람이 바뀌면 이 줄을 고치고
// 새 버전으로 올리면 된다(옛 사본의 편집자는 그대로 남으니 드라이브에서 지운다).
var CUE_EDITORS = ['joshua052698@gmail.com', 'mose716@gmail.com'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) return json({ error: 'unauthorized' });

    switch (body.action || 'upload') {
      case 'upload':       return json(upload(body));
      case 'uploadFromUrl': return json(uploadFromUrl(body));
      case 'ensureFolder': return json({ folderId: folderFor(body).getId() });
      case 'renameFolder': return json(renameFolder(body));
      case 'trash':        return json(trash(body));
      case 'list':         return json(list(body));
      case 'convert':      return json(convertExisting(body));
      default:             return json({ error: 'unknown action' });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

// ── 폴더 ────────────────────────────────────────────────────────────────────
// id가 있으면 id로, 없으면 path를 따라 내려가며 찾거나 만든다.
// id를 먼저 보는 것이 중요하다 — 이름으로만 찾으면 프로젝트 이름을 바꾼 순간
// 예전 파일은 옛 폴더에, 새 파일은 새 폴더에 쌓인다.
function folderFor(body) {
  if (body.folderId) {
    try {
      return DriveApp.getFolderById(body.folderId);
    } catch (err) {
      // **D: "못 찾음"일 때만 폴백한다.** 예전에는 여기서 전부 삼켜서, 권한 오류나
      // 일시적 오류에도 path로 떨어져 **폴더 트리를 새로 팠다**. 이름이 같은 폴더가
      // 둘 생기면 그때부터 같은 업무의 파일이 두 군데로 갈린다.
      var msg = String(err && err.message || err);
      var gone = msg.indexOf('찾을 수 없') >= 0 || msg.indexOf('not found') >= 0
              || msg.indexOf('No item') >= 0 || msg.indexOf('does not exist') >= 0;
      if (!gone) throw err;
    }
  }
  var f = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var path = body.path && body.path.length ? body.path : [body.projectName || '기타'];
  for (var i = 0; i < path.length; i++) f = childFolder(f, String(path[i] || '기타'));
  return f;
}

// **C: 만들기에는 잠금을 건다.** 사진 여러 장이 동시에 올라가면서 업무 폴더가 처음
// 생기는 순간, 세 요청이 나란히 "없다 → 만든다"를 해서 같은 이름 폴더가 여럿 생겼다.
// 찾기는 잠그지 않는다 — 있는 경우가 대부분이고 거기에 잠금을 걸면 병렬이 죽는다.
function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    // 잠금을 못 잡아도 만들기는 한다 — 막느니 드물게 겹치는 쪽이 낫다
    return parent.createFolder(name);
  }
  try {
    var again = parent.getFoldersByName(name);   // 기다리는 사이 남이 만들었을 수 있다
    return again.hasNext() ? again.next() : parent.createFolder(name);
  } finally {
    lock.releaseLock();
  }
}

// 읽기 전용 조회용 — 없으면 null. list가 폴더를 만들어 버리면 안 된다.
function childFolderIfExists(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

// ── 파일 목록 ───────────────────────────────────────────────────────────────
// **A: 고급 드라이브 서비스로 한 번에 받는다.**
// 예전에는 DriveApp 이터레이터를 돌며 파일마다 getId·getName·getSize·getUrl·
// getDescription을 불렀다. 이게 **타임아웃 확인 경로**(uploadOnceOrFind → list)에서
// 돌기 때문에, 이미 느려진 순간에 가장 느린 코드가 돌고 있었다.
// md5Checksum을 같이 받는다 — scripts/drive_check.mjs가 존재만이 아니라 내용까지 맞출 수 있다.
function filesIn(folderId, limit) {
  var out = [];
  var token = null;
  do {
    var r = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id,name,size,webViewLink,description,appProperties,md5Checksum,modifiedTime)',
      pageSize: 200,
      pageToken: token || undefined,
      supportsAllDrives: true,
    });
    var files = r.files || [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      out.push({
        id: f.id,
        name: f.name,
        size: Number(f.size || 0),
        url: f.webViewLink,
        key: keyOf(f),
        role: (f.appProperties && f.appProperties.wsrole) || null,   // 'sheetpreview' = 변환 사본(표·문서·슬라이드)
        md5: f.md5Checksum || null,
        modifiedTime: f.modifiedTime || null,
      });
      if (out.length >= limit) return out;
    }
    token = r.nextPageToken;
  } while (token);
  return out;
}

// 열쇠는 v7부터 appProperties에, v6까지는 description에 있다 — 둘 다 읽는다
function keyOf(f) {
  var p = f.appProperties && f.appProperties[KEY_PROP];
  if (p) return p;
  var d = f.description || '';
  return d.indexOf(KEY_PREFIX) === 0 ? d.slice(KEY_PREFIX.length) : null;
}

// **B: 열쇠로 바로 찾는다.** 폴더를 훑지 않는다.
// v6까지 올린 파일은 appProperties가 없으므로, 못 찾으면 목록으로 한 번 더 본다.
function findByKey(folderId, key) {
  if (!key) return null;
  var q = "'" + folderId + "' in parents and trashed = false"
        + " and appProperties has { key='" + KEY_PROP + "' and value='" + String(key).replace(/'/g, "") + "' }";
  var r = Drive.Files.list({ q: q, fields: 'files(id,name,webViewLink)', pageSize: 1, supportsAllDrives: true });
  if (r.files && r.files.length) return r.files[0];

  var seen = filesIn(folderId, 500);            // 옛 파일(description 열쇠) 폴백
  for (var i = 0; i < seen.length; i++) {
    if (seen[i].key === key) return { id: seen[i].id, name: seen[i].name, webViewLink: seen[i].url };
  }
  return null;
}

// 열쇠는 **만들 때 같이** 붙인다(v9 · 아래 createInFolder) — v8까지는 만든 뒤 update로
// 한 번 더 갔다. description에도 같이 남긴다: 드라이브 화면에서 사람이 볼 수 있고,
// v6으로 되돌리더라도 열쇠를 잃지 않는다(되돌릴 일이 없기를 바라지만 값이 싸다).
function keyMeta(key) {
  if (!key) return {};
  var props = {};
  props[KEY_PROP] = String(key);
  return { appProperties: props, description: KEY_PREFIX + key };
}

// **I: 파일 하나를 드라이브 왕복 둘로 만든다**(v8은 셋 — createFile · 열쇠 update · setSharing).
// Drive.Files.create는 이름·부모·열쇠·설명을 **한 요청**에 받고, 남는 하나는 공유
// 설정인데 그건 다른 API(Permissions)라 합칠 수 없다(makePreviewCopy와 같은 사정).
// 공유는 v8과 같은 뜻이다 — 링크를 아는 사람은 **보기**(앱이 lh3.googleusercontent.com/d/<id>로
// 썸네일을 붙인다. 이 줄이 없으면 소유자만 열 수 있어서 앱 안 이미지가 전부 깨진다).
// 'writer'로 올리면 링크를 아는 누구나 고칠 수 있다(사용자가 판단해서 뺀 길 — HANDOFF §7).
// webViewLink는 DriveApp의 getUrl()과 같은 주소다(drive.google.com/file/d/<id>/view…).
function createInFolder(folderId, blob, name, mimeType, key) {
  var meta = { name: name || 'file', parents: [folderId], mimeType: mimeType || 'application/octet-stream' };
  var km = keyMeta(key);
  if (km.appProperties) { meta.appProperties = km.appProperties; meta.description = km.description; }
  var file = Drive.Files.create(meta, blob, { supportsAllDrives: true, fields: 'id,webViewLink' });
  Drive.Permissions.create({ role: 'reader', type: 'anyone' }, file.id, { supportsAllDrives: true });
  return file;
}

// ── 업로드 ──────────────────────────────────────────────────────────────────
function upload(body) {
  // 업무 폴더는 프로젝트 폴더 **아래**다. 프로젝트 폴더 id를 주면 거기서 시작한다.
  var folder = folderFor(body);
  if (body.cardTitle) folder = childFolder(folder, String(body.cardTitle));

  // 재시도일 때만 찾는다 — 첫 시도에 찾으면 그게 왕복 한 번을 그냥 더 쓰는 것이다
  if (body.retry) {
    var found = findByKey(folder.getId(), body.key);
    if (found) return { id: found.id, url: found.webViewLink, folderId: folder.getId(), existing: true };
  }

  var blob = Utilities.newBlob(
    Utilities.base64Decode(body.dataBase64),
    body.mimeType || 'application/octet-stream',
    body.name || 'file'
  );
  // 왕복 둘 — 만들기(이름·부모·열쇠·설명 한 요청) + 공유(v9 · createInFolder 주석)
  var file = createInFolder(folder.getId(), blob, body.name, body.mimeType, body.key);
  return {
    id: file.id, url: file.webViewLink, folderId: folder.getId(),
    // **여기서 변환하지 않는다**(v8). 사본은 두 번째 요청(convert 액션)이 만든다 —
    // 올리는 시간에 변환 시간을 더하지 않으려는 것이다(위 머리말 '왜 두 단계인가').
    // body.convert는 **옛 화면 호환**으로만 남긴다: 배포 직후 캐시된 탭이 아직 그 칸을
    // 실어 보낼 수 있고, 그 탭에서 올린 엑셀도 사본을 가져야 한다. 새 화면은 안 보낸다.
    previewId: body.convert ? makePreviewCopy(file.id, body.name || 'file', folder.getId()) : null,
  };
}

// **F: 오피스 파일을 구글 네이티브 사본으로**(v7의 makeSheetCopy를 종류별로 넓혔다).
// 구글은 .xlsx·.docx·.pptx를 **열어볼 때** 게을리 변환한다. 그래서 갓 올린 파일은
// docs.google.com/…/preview 가 "Google Docs에 오류가 발생했습니다"를 낸다(45초 뒤에도
// 그랬다). Drive.Files.copy에 mimeType을 주면 **그 자리에서** 변환된 네이티브 파일이
// 생기므로 기다릴 것이 없다. 엑셀에서 되던 그 방법을 워드·PPT에도 그대로 쓴다
// (사용자 요청 2026-09-08 — "pptx 뷰어나 docs도 그냥 실제 뷰로, 엑셀처럼").
//
// **종류는 확장자가 정한다.** 부르는 쪽이 convert를 보냈든 convertTo를 보냈든 .docx는
// 문서, .pptx는 슬라이드다. 값을 믿고 만들면 잘못 보낸 한 번이 영영 남는 쓰레기 사본이
// 되고(글자가 표 칸에 흩어진 시트), 그게 preview_file_id에 박혀 첨부가 그 꼴로 열린다.
//
// **드라이브 왕복은 둘이다**(v7은 셋이었다). 이름·부모·종류를 copy 요청 본문에 같이
// 실으면 만들고 나서 고치러 다시 갈 일이 없고, 열쇠 지우기도 같은 요청에서 끝난다.
// 남는 하나는 공유 설정인데 그건 다른 API(Permissions)라 합칠 수 없다.
//
// 원본은 그대로 둔다 — 내려받기·'새 탭에서 열기'·첨부 내용 검색이 원본을 쓴다.
// 원본을 버리면 구글 변환에서 미묘하게 달라진 것을 되돌릴 길이 없다(결산 파일에는
// 도장 스캔과 회계식 서식이 들어 있다).
//
// **실패해도 던지지 않는다.** 변환이 안 되는 파일(손상·형식 밖)이 있어도 첨부 자체는
// 올라가야 한다. null을 돌려주면 앱이 예전 길(우리가 직접 그리기)로 떨어진다.
//
// 확장자 → [사본의 종류, 이름 뒤에 붙일 말]. **표는 여기 한 벌뿐이다.**
var COPY_AS = {
  xlsx: ['GOOGLE_SHEETS', ' (표)'], xlsm: ['GOOGLE_SHEETS', ' (표)'],
  xls:  ['GOOGLE_SHEETS', ' (표)'], csv:  ['GOOGLE_SHEETS', ' (표)'],
  docx: ['GOOGLE_DOCS', ' (문서)'], doc:  ['GOOGLE_DOCS', ' (문서)'],
  pptx: ['GOOGLE_SLIDES', ' (슬라이드)'], ppt: ['GOOGLE_SLIDES', ' (슬라이드)'],
};

function makePreviewCopy(fileId, name, folderId, cueEditors) {
  var target = COPY_AS[String(name || '').split('.').pop().toLowerCase()];
  if (!target) return null;   // PDF·사진·zip 등은 구글 편집기가 없다 — 사본을 안 만든다
  try {
    var copy = Drive.Files.copy({
      name: name + target[1],
      mimeType: MimeType[target[0]],
      parents: [folderId],
      // **열쇠를 물려받으면 안 된다.** Drive.Files.copy는 appProperties·description까지
      // 그대로 베낀다(실측 2026-08-29 — 사본과 원본에 같은 wskey가 붙었다). 그러면
      // findByKey가 **사본을 원본으로 착각**할 수 있고(끊긴 업로드를 확인하는 자리다)
      // drive_file_id에 사본 id가 들어가 내려받기·새 탭이 깨진다. drive_check도 중복으로 센다.
      // v7은 만든 뒤 update로 지웠는데, **만들 때 같이 주면 왕복이 하나 줄어든다.**
      // 표시(wsrole)는 v7이 쓰던 'sheetpreview' 그대로다 — 이름을 바꾸면 v7이 만든 사본과
      // v8이 만든 사본을 한 표시로 알아볼 수 없게 된다(읽는 쪽은 종류를 안 가른다).
      appProperties: { wskey: null, wsrole: 'sheetpreview' },
      description: '',
    }, fileId, { supportsAllDrives: true });
    // 미리보기는 iframe으로 뜬다 — 링크로 **볼** 수 있어야 남들 화면에서도 그려진다.
    // role은 언제나 'reader'다. 'writer'로 올리면 링크를 아는 누구나 고칠 수 있다
    // (드라이브는 워크스페이스 멤버인지 모른다 — 사용자가 판단해서 뺀 길이다).
    Drive.Permissions.create({ role: 'reader', type: 'anyone' }, copy.id, { supportsAllDrives: true });

    // ── v10: 큐시트만 이름 있는 계정 둘을 편집자로 ──────────────────────────
    // 실패해도 사본은 살린다 — 편집이 안 되는 것보다 미리보기가 통째로 없는 것이 나쁘다.
    // sendNotificationEmail: false — 주보를 올릴 때마다 두 사람에게 메일이 가면 안 된다.
    if (cueEditors) {
      for (var i = 0; i < CUE_EDITORS.length; i++) {
        try {
          Drive.Permissions.create(
            { role: 'writer', type: 'user', emailAddress: CUE_EDITORS[i] },
            copy.id,
            { supportsAllDrives: true, sendNotificationEmail: false });
        } catch (permErr) {
          Logger.log('큐시트 편집자 추가 실패(' + CUE_EDITORS[i] + '): ' + permErr);
        }
      }
    }
    return copy.id;
  } catch (err) {
    Logger.log('변환 실패(첨부는 그대로 둔다): ' + err);
    return null;
  }
}

// 주소에서 받아 드라이브에 쓴다. upload과 같은 결과를 돌려준다.
// 큰 파일 전용 — 바이트가 우리 함수를 지나가지 않는다.
function uploadFromUrl(body) {
  var folder = folderFor(body);
  if (body.cardTitle) folder = childFolder(folder, String(body.cardTitle));

  if (body.retry) {
    var found = findByKey(folder.getId(), body.key);
    if (found) return { id: found.id, url: found.webViewLink, folderId: folder.getId(), existing: true };
  }

  var res = UrlFetchApp.fetch(String(body.url), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() >= 300) {
    return { error: '파일을 받아오지 못했습니다 (' + res.getResponseCode() + ')' };
  }
  var blob = res.getBlob().setName(body.name || 'file');
  if (body.mimeType) blob = blob.setContentType(body.mimeType);
  // upload과 같은 두 왕복(v9)
  var file = createInFolder(folder.getId(), blob, body.name, body.mimeType || blob.getContentType(), body.key);
  return {
    id: file.id, url: file.webViewLink, folderId: folder.getId(),
    // **여기서 변환하지 않는다**(v8). 사본은 두 번째 요청(convert 액션)이 만든다 —
    // 올리는 시간에 변환 시간을 더하지 않으려는 것이다(위 머리말 '왜 두 단계인가').
    // body.convert는 **옛 화면 호환**으로만 남긴다: 배포 직후 캐시된 탭이 아직 그 칸을
    // 실어 보낼 수 있고, 그 탭에서 올린 엑셀도 사본을 가져야 한다. 새 화면은 안 보낸다.
    previewId: body.convert ? makePreviewCopy(file.id, body.name || 'file', folder.getId()) : null,
  };
}

// **파일 하나에 변환 사본을 붙인다.** v8부터 이것이 사본을 만드는 **정상 경로**다 —
// 앱이 파일을 올리고 목록에 세운 **뒤에** 따로 부른다(위 upload의 주석). 옛 첨부를
// 훑는 scripts/backfill_sheet_preview.mjs도 같은 액션을 쓴다.
//
// 사본은 **원본과 같은 폴더**에 만든다 — 업무 폴더 밖으로 나가면 정리가 어려워진다.
// 이름·폴더를 **같이 보내 주면 파일을 다시 묻지 않는다**(왕복 하나가 준다). 앱은 방금
// 올린 파일이라 둘 다 알고, 백필은 이름만 알아서 폴더는 여기서 찾는다.
// 종류는 여기서도 **확장자**가 정한다 — body.convertTo는 "만들어 달라"는 뜻일 뿐이라
// 읽지 않는다. 부르는 쪽이 잘못 보내도 사본 종류가 틀어지지 않는다.
function convertExisting(body) {
  var name = body.name;
  var parent = body.folderId;
  if (!name || !parent) {
    var f = Drive.Files.get(body.fileId, { fields: 'id,name,parents', supportsAllDrives: true });
    name = name || f.name;
    parent = parent || (f.parents && f.parents[0]) || ROOT_FOLDER_ID;
  }
  return { previewId: makePreviewCopy(body.fileId, name, parent, !!body.cueEditors) };
}

// ── 목록 ────────────────────────────────────────────────────────────────────
// 폴더를 만들지 않는다.
function list(body) {
  var folder;
  if (body.folderId) {
    try { folder = DriveApp.getFolderById(body.folderId); } catch (err) { return { files: [] }; }
  } else {
    folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var path = body.path && body.path.length ? body.path : [body.projectName || '기타'];
    for (var i = 0; i < path.length && folder; i++) folder = childFolderIfExists(folder, String(path[i] || '기타'));
    if (!folder) return { files: [] };
  }
  if (body.cardTitle) {
    folder = childFolderIfExists(folder, String(body.cardTitle));
    if (!folder) return { files: [] };
  }
  return { folderId: folder.getId(), files: filesIn(folder.getId(), 500) };
}

function renameFolder(body) {
  var folder = folderFor(body);
  if (body.newName) folder.setName(body.newName);
  return { folderId: folder.getId(), name: folder.getName() };
}

// 완전 삭제가 아니라 휴지통이다 — 30일 안에는 되돌릴 수 있다.
// 앱에서 잘못 지운 것을 복구할 길이 없으면 그건 싱크가 아니라 유실이다.
// 파일이든 폴더든 id 하나로 지운다(고급 서비스는 둘을 가르지 않아서
// getFileById가 폴더에서 실패하던 왕복이 없어진다).
function trash(body) {
  Drive.Files.update({ trashed: true }, body.fileId, null, { supportsAllDrives: true });
  return { trashed: body.fileId };
}

// **모든 답에 스크립트 버전을 싣는다**(v8부터 · 지금 10).
// 왜 액션을 하나 더 만들지 않았나: 액션을 늘리면 api/drive.js의 허용 목록(ACTIONS)까지
// 같이 넓혀야 하고, 그 둘이 같은지 보는 검사(tests/drivesync)도 따라 움직여야 한다.
// 답에 한 칸 얹는 쪽이 싸다. **v7 이하는 이 값이 없다(undefined)** — 부르는 쪽은 그것을
// 0으로 읽고 "아직 v8이 아니다"로 판단해서 워드·PPT 변환을 보내지 않는다
// (src/services/cloud.js의 attachPreviewCopy · scripts/backfill_sheet_preview.mjs).
function json(obj) {
  var out = obj || {};
  out.version = SCRIPT_VERSION;
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// 권한 승인용 — 한 번만 실행하면 '외부 서비스에 연결' 승인 창이 뜬다.
// uploadFromUrl이 UrlFetchApp을 쓰는데, 소유자가 그 권한을 승인한 적이 없으면
// "UrlFetchApp.fetch을(를) 호출할 수 있는 권한이 없습니다"로 죽는다.
// **v7부터는 고급 드라이브 서비스 승인도 여기서 같이 받는다.**
function 권한승인() {
  const r = UrlFetchApp.fetch('https://www.google.com');
  const d = Drive.Files.list({ q: "'" + ROOT_FOLDER_ID + "' in parents and trashed = false", pageSize: 1 });
  Logger.log('외부 연결 OK · ' + r.getResponseCode() + ' / 드라이브 OK · 파일 ' + ((d.files || []).length) + '건');
}
```

## 올리는 순서 (5분)

1. [script.google.com](https://script.google.com) → 이 프로젝트 →
   **`ROOT_FOLDER_ID`·`SHARED_TOKEN` 두 줄만 남기고** 그 아래를 위 코드로 갈아 끼웁니다.
2. 저장 → **배포 → 배포 관리 → 연필(수정) → 버전 '새 버전' → 배포**.
   **새 배포를 만들지 마세요** — 같은 배포의 새 버전이면 URL이 그대로입니다. URL이 바뀌면
   Vercel 환경변수 `DRIVE_WEBAPP_URL`을 Production·Development 둘 다 고쳐야 합니다.
3. 그 밖에 바꿀 것은 없습니다. 권한 승인(`권한승인` 실행)은 v7에서 이미 받았고 v8 이후로
   새로 쓰는 권한이 없습니다.

## 올린 뒤 확인할 것

1. **판 번호** — `node scripts/backfill_sheet_preview.mjs`(인수 없이 = 읽기만)의 첫 줄에
   스크립트가 답한 판 번호가 찍힙니다. 앱의 게이트는 `version >= 8`입니다.
   (`--fix`를 붙이면 사본이 없는 옛 첨부에 사본을 만들어 `files.preview_file_id`에 적습니다.
   `.env`에 `VITE_SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`DRIVE_WEBAPP_URL`·`DRIVE_WEBAPP_TOKEN`이 필요합니다.)
2. **업무 첨부는 보기** — 업무에 워드·PPT·엑셀을 하나 올리면 목록에 **바로** 서고(변환을
   기다리지 않습니다), 몇 초 뒤 '펼쳐보기'가 구글 화면입니다. 그 화면에 글자를 칠 수 있으면
   `cueEditors`가 새고 있는 것입니다 — 업무 첨부는 언제나 **보기**입니다.
3. **큐시트는 편집자 두 계정만** — 주보 말씀 탭에 큐시트 `.docx`를 올리고, 교역자·마스터
   계정으로는 편집 화면(글자를 칠 수 있음), 다른 계정으로는 읽기 화면인지.
4. **폰에서는 앱 안 창이 읽기 화면일 수 있습니다** — iframe 안의 구글은 브라우저의 구글
   로그인 상태(서드파티 쿠키)를 쓰고 아이폰 사파리·카카오 인앱이 그것을 막습니다.
   머리줄의 **'구글 문서에서 편집'**(새 탭)으로 확인하세요.
5. `node scripts/drive_check.mjs` — 어긋남 0건이면 끝입니다.

## 판 이력

| 판 | 무엇이 바뀌었나 |
|---|---|
| v4 | 멱등 열쇠(`key` · 재시도에서 같은 파일을 다시 만들지 않게) · `list` 액션 · `trash`가 폴더 id도 받는다 |
| v5 | `uploadFromUrl` — 바이트 대신 주소를 받아 스크립트가 직접 내려받는다(Vercel 함수의 4.5MB 몸통 한도를 지나가지 않게) |
| v6 | `권한승인()` — 소유자가 UrlFetchApp 권한을 한 번 승인하는 자리(그 권한을 실제로 쓰는 함수를 실행해야 구글이 묻는다) |
| v7 | 고급 드라이브 서비스로 전환 · 열쇠를 `description`에서 `appProperties`로(질의로 찾는다) · 폴더 만들기에 `LockService` 잠금 · **엑셀을 구글 시트 사본으로**(0031 · `files.preview_file_id`) |
| v8 | 사본을 **워드(구글 문서)·PPT(구글 슬라이드)** 까지 · 사본 만들기를 `upload`에서 떼어 `convert` 액션으로(두 단계) · 모든 답에 `version`. **배포하지 않고 건너뛰었다**(사용자 결정 2026-09-08) |
| v9 | 업로드 왕복 3→2 — `Drive.Files.create`에 이름·부모·열쇠·설명을 한 요청에 싣고 공유는 `Permissions.create` 하나(`createInFolder`) |
| v10 | **큐시트 사본에만** 이름 있는 계정 둘(`CUE_EDITORS`)을 편집자로 — 앱이 `convert`에 `cueEditors`를 실을 때만. `role:'writer'`+`type:'anyone'`은 쓰지 않는다(링크를 아는 누구나 고치게 되는 길 — HANDOFF §7). **지금 판**(2026-09-09 배포) |

액션 목록은 v7부터 v10까지 같습니다(`upload`·`uploadFromUrl`·`ensureFolder`·`renameFolder`·
`trash`·`list`·`convert`) — `api/drive.js`의 허용 목록과 같은지는 `tests/drivesync`가 봅니다.

## 되돌리려면

배포 관리에는 지난 버전이 남아 있어 **그 버전을 고르기만 하면** 됩니다. 이미 만들어진 사본과
붙은 편집자는 그대로 남으므로(드라이브에서 손으로 지웁니다) 이미 붙은 미리보기는 계속
동작하고, 되돌린 뒤에 올리는 파일만 그 판의 동작을 따릅니다.
