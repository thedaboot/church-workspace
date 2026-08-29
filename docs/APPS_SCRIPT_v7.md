# Apps Script v7 — 붙여넣을 코드와 바꾸는 이유

**2026-08-29에 사용자가 올렸고 라이브에서 확인했습니다.** 배포 URL은 그대로입니다
(같은 배포의 새 버전 — Vercel 환경변수를 손대지 않았습니다).

실측으로 확인한 것(임시 폴더에서 올렸다 지웠습니다):
`md5`가 돌아온다(A · v6은 못 준다) · 열쇠가 `appProperties`에 붙는다(B) ·
폴더 이름 바꾸기가 산다(D) · **변환 사본이 갓 만든 순간 `preview`로 http 200**,
같은 순간 **원본 id로는 http 400** — 30분 문제의 정체가 이것이고 사본이 그것을 푼다.
200이 로그인 없이 나왔으므로 공유 권한도 제대로 걸렸다(남의 화면에서도 뜬다).

v6에서 고친 것은 다섯 가지입니다.
**배포 URL은 바뀌지 않습니다** — 같은 배포를 '새 버전'으로 올리면 됩니다.
바꾸면 `node scripts/drive_check.mjs`로 한 번 훑어 보세요(읽기만 합니다).

| | 무엇 | 왜 |
|---|---|---|
| A | `list`·`findByKey`를 고급 드라이브 서비스 한 번으로 | 파일 수만큼 왕복하던 것이 한 번이 된다. **타임아웃 확인 경로가 이걸 쓴다** — 이미 느려진 순간에 가장 느린 코드가 돌고 있었다 |
| B | 열쇠를 `description` 대신 `appProperties`로 | 폴더를 훑지 않고 **질의 한 번**으로 찾는다. 폴더가 커질수록 벌어진다 |
| C | 폴더 만들기에 `LockService` | 사진 세 장이 동시에 올라가며 업무 폴더가 처음 생기면 같은 이름 폴더가 여럿 생길 수 있었다 |
| D | `folderFor`의 `catch`를 좁힌다 | 권한·일시 오류까지 폴백으로 떨어져 **폴더 트리를 새로 팠다**. 이름이 같은 폴더가 둘 생기면 그때부터 파일이 갈린다 |
| E | 엑셀을 올리면 **구글 시트 사본**을 같이 만든다(+ 옛 첨부용 `convert` 액션) | 구글은 `.xlsx`를 열어볼 때 게을리 변환해서 갓 올린 파일은 시트 미리보기가 오류를 냈다. 올리는 김에 변환해 두면 **기다릴 것이 없다**(사용자 결정 2026-08-29) |

루트 폴더 공유 상속은 넣지 않았습니다 — 업로드 왕복 하나를 줄이는 대신
**폴더 링크로 전체 목록이 열립니다.** 지금은 파일 하나하나만 공개고 목록은 아닙니다.

---

## 먼저: 고급 드라이브 서비스를 켭니다

Apps Script 편집기 왼쪽 **서비스(+)** → **Drive API** → 버전 **v3** → 식별자 `Drive` → 추가.
안 켜면 `Drive.Files.list`에서 `Drive is not defined`로 죽습니다.

`appsscript.json`에 이렇게 들어갑니다(편집기가 알아서 씁니다):

```json
{
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }
    ]
  }
}
```

## 옛 열쇠는 그대로 읽습니다

v6까지 올린 파일은 열쇠가 `description`에 있습니다. v7은 **새로 올리는 것만**
`appProperties`에 쓰고, 찾을 때는 **둘 다** 봅니다. 지난 파일을 옮기는 작업은
없습니다 — 열쇠는 업로드가 끊겼을 때만 쓰는 값이고, 이미 올라간 파일에는 쓸 일이
없습니다.

---

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

```js
const KEY_PREFIX = 'wskey:';   // v6까지 description에 쓰던 접두사 — 읽기 위해 남긴다
const KEY_PROP = 'wskey';      // v7부터는 appProperties에 쓴다(질의로 찾을 수 있다)

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

// 열쇠를 붙인다. description에도 같이 남긴다 — 드라이브 화면에서 사람이 볼 수 있고,
// v6으로 되돌리더라도 열쇠를 잃지 않는다(되돌릴 일이 없기를 바라지만 값이 싸다).
function stampKey(fileId, key) {
  if (!key) return;
  var props = {};
  props[KEY_PROP] = String(key);
  Drive.Files.update({ appProperties: props, description: KEY_PREFIX + key }, fileId, null,
    { supportsAllDrives: true });
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
  var file = folder.createFile(blob);
  stampKey(file.getId(), body.key);
  // 링크를 아는 사람은 보기 — 앱이 lh3.googleusercontent.com/d/<id>로 썸네일을 붙인다.
  // 이 줄이 없으면 소유자만 열 수 있어서 앱 안 이미지가 전부 깨진다.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    id: file.getId(), url: file.getUrl(), folderId: folder.getId(),
    previewId: body.convert ? makeSheetCopy(file.getId(), file.getName(), folder.getId()) : null,
  };
}

// **E: 엑셀을 구글 시트로 변환한 사본.**
// 구글은 .xlsx를 **열어볼 때** 게을리 변환한다. 그래서 갓 올린 파일은
// docs.google.com/spreadsheets/<id>/preview 가 "Google Docs에 오류가 발생했습니다"를
// 낸다(45초 뒤에도 그랬다). Drive.Files.copy에 mimeType을 주면 **그 자리에서** 변환된
// 네이티브 시트가 생기므로 기다릴 것이 없다.
//
// 원본 .xlsx는 그대로 둔다 — 내려받기·'새 탭에서 열기'·첨부 내용 검색이 원본을 쓴다.
// 원본을 버리면 구글 변환에서 미묘하게 달라진 것을 되돌릴 길이 없다(결산 파일에는
// 도장 스캔과 회계식 서식이 들어 있다).
//
// **실패해도 던지지 않는다.** 변환이 안 되는 파일(손상·형식 밖)이 있어도 첨부 자체는
// 올라가야 한다. null을 돌려주면 앱이 예전 길(직접 그리기)로 떨어진다.
function makeSheetCopy(fileId, name, folderId) {
  try {
    var copy = Drive.Files.copy(
      { name: name + ' (표)', mimeType: MimeType.GOOGLE_SHEETS, parents: [folderId] },
      fileId, { supportsAllDrives: true });
    // 미리보기는 iframe으로 뜬다 — 링크로 볼 수 있어야 남들 화면에서도 그려진다
    Drive.Permissions.create({ role: 'reader', type: 'anyone' }, copy.id, { supportsAllDrives: true });
    return copy.id;
  } catch (err) {
    Logger.log('시트 변환 실패(첨부는 그대로 둔다): ' + err);
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
  var file = folder.createFile(blob);
  stampKey(file.getId(), body.key);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    id: file.getId(), url: file.getUrl(), folderId: folder.getId(),
    previewId: body.convert ? makeSheetCopy(file.getId(), file.getName(), folder.getId()) : null,
  };
}

// **이미 올라가 있는 엑셀에 변환 사본을 붙인다**(옛 첨부 백필용 — 2026-08-29).
// 구글은 .xlsx를 **사람이 열 때** 변환한다. 그래서 아무도 안 열어 본 파일은 몇 달이
// 지나도 시트 미리보기가 오류를 낸다(실측: 같은 날 올린 두 파일 중 열어 본 것만 떴다).
// 시간으로 가르던 옛 규칙(SHEET_READY_MS 30분)은 전제부터 틀렸다.
// 사본은 **원본과 같은 폴더**에 만든다 — 업무 폴더 밖으로 나가면 정리가 어려워진다.
function convertExisting(body) {
  var f = Drive.Files.get(body.fileId, { fields: 'id,name,parents', supportsAllDrives: true });
  var parent = (f.parents && f.parents[0]) || ROOT_FOLDER_ID;
  return { previewId: makeSheetCopy(f.id, f.name, parent) };
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
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

---

## 올린 뒤 확인할 것

0. **`ROOT_FOLDER_ID`·`SHARED_TOKEN` 두 줄이 남아 있는지** 눈으로 확인합니다.
1. 편집기에서 **`권한승인`을 한 번 실행** — 승인 창이 두 번 뜰 수 있습니다(외부 연결 + 드라이브).
   로그에 `외부 연결 OK · 200 / 드라이브 OK`가 나오면 됩니다.
2. **배포 → 배포 관리 → 연필 → 버전 '새 버전'** 으로 올립니다. URL이 바뀌면
   Vercel 환경변수(`DRIVE_WEBAPP_URL`)를 Production·Development 둘 다 고쳐야 합니다.
3. 앱에서 **작은 사진 하나** 올리기 → 드라이브의 `프로젝트 / 업무` 폴더에 들어가는지.
4. 앱에서 **10MB 넘는 파일** 하나 올리기(`uploadFromUrl` 경로).
5. **첨부 하나 지우기** — 휴지통으로 가는지(`trash`가 고급 서비스로 바뀌었습니다).
6. **업무 하나 지우기** — 업무 폴더가 통째로 휴지통에 들어가는지.
7. **엑셀(.xlsx) 하나 올리기 → 올린 그 자리에서 바로 '펼쳐보기'.**
   구글이 그린 표가 뜨면 성공입니다(30분을 안 기다립니다). 드라이브의 업무 폴더에
   `<원래이름> (표)`가 같이 생겨 있어야 합니다.
   **안 뜨면** 앱이 예전 길(직접 그리기)로 떨어지므로 화면이 깨지지는 않습니다 —
   그때는 알려주세요.
8. `node scripts/drive_check.mjs` — 어긋남 0건이면 끝입니다.

## 되돌리려면

v6 코드를 그대로 다시 붙여넣고 새 버전으로 올리면 됩니다.
v7이 올린 파일도 `description`에 열쇠를 같이 남기므로 v6이 읽을 수 있습니다.
