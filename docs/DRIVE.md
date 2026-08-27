# 개인 구글 드라이브 연동 · 마이그레이션 계획

첨부 파일의 **실체를 개인 구글 드라이브로 옮기고, DB에는 참조만 남기는** 구조.
현재 앱은 이미 이 구조를 읽을 수 있게 되어 있고(아래 "이미 된 것"), 남은 건
드라이브 소유자 계정에서 한 번 해줘야 하는 설정뿐이다.

## 왜 Apps Script 방식인가

개인 지메일 드라이브는 서비스 계정으로 접근할 수 없다(공유 드라이브가 없어서
서비스 계정이 소유권을 가질 수 없고, 개인 계정 용량에 쓰지도 못한다).
남는 방법은 두 가지인데:

| 방법 | 필요한 것 | 유지 부담 |
|---|---|---|
| **Apps Script 웹앱** (권장) | 소유자가 스크립트 1개 배포 → URL | 없음. 토큰 만료 없음 |
| OAuth refresh token | 구글 클라우드 프로젝트 + 동의 화면 + 토큰 보관 | 토큰 폐기·갱신 관리 필요 |

권장안은 소유자가 **자기 계정으로 실행되는 스크립트**를 배포하는 것이다.
우리 서버는 그 URL로 파일을 보내기만 하면 되고, 저장·용량·소유권은 전부
소유자 드라이브에 있다.

## 이미 된 것 (코드·DB)

- `files.source` = `'storage' | 'drive'` — 파일 1건 단위로 저장소를 구분한다
- `files.drive_file_id`, `files.web_view_link` — 드라이브 파일 참조
- `projects.drive_folder_id` — 프로젝트 1개 = 드라이브 폴더 1개
- 읽기 경로 분기: `getFileOpenUrl(row)` (src/services/cloud.js)
  → `source='drive'`면 `web_view_link`로 열고, 아니면 Storage 서명 URL
- 삭제 경로: `storage_path`가 없으면 Storage는 건드리지 않고 DB 행만 지운다
  (드라이브 파일 실체는 소유자 드라이브에 남는다 — 의도된 동작)

즉 **행 하나의 source를 'drive'로 바꾸는 것만으로** 앱은 그대로 동작한다.

## 소유자가 해줘야 하는 것 (1회, 약 5분)

1. 드라이브에 폴더 하나 생성: `더다붓 워크스페이스`
2. [script.google.com](https://script.google.com) → 새 프로젝트 → 아래 코드 붙여넣기
3. `ROOT_FOLDER_ID`에 1번 폴더 ID를 넣는다 (폴더 URL의 `/folders/` 뒤 문자열)
4. `SHARED_TOKEN`을 아무 긴 랜덤 문자열로 바꾼다 (우리 서버만 아는 값)
5. 배포 → 새 배포 → 유형 **웹 앱** / 실행 계정 **나** / 액세스 **모든 사용자**
6. 나온 **웹 앱 URL**과 `SHARED_TOKEN`을 전달 (채팅·메일로 보내지 말고 안전한 경로로)

```javascript
// 더다붓 워크스페이스 → 개인 드라이브 파일 저장기 (v5)
//
// v4에서 달라진 것 (2026-08-28):
//  1) upload이 **멱등 열쇠(key)** 를 받는다. 재시도(retry:true)일 때 같은 열쇠의
//     파일이 그 폴더에 이미 있으면 새로 만들지 않고 그것을 돌려준다.
//     → 앱이 타임아웃을 봤지만 실제로는 올라갔던 경우, 다시 보내도 파일이 두 개가
//       되지 않는다. **이것이 없으면 업로드에 재시도를 붙일 수 없다.**
//     → 첫 시도에서는 폴더를 훑지 않는다(사진 서른 장짜리 업무에서 매번 훑으면
//       그게 새 병목이 된다). 훑는 것은 재시도일 때뿐이다.
//  2) **list** 액션 — 폴더 안 파일을 열쇠와 함께 돌려준다. 업로드가 끊겼을 때
//     "정말 안 올라갔는지" 확인하고, DB와 드라이브를 맞춰보는 데 쓴다.
//     list는 폴더를 **만들지 않는다**(없으면 files: []).
//
// 열쇠는 파일 설명(description)에 적는다 — DriveApp만으로 읽고 쓸 수 있어
// 고급 서비스를 켤 필요가 없고, 드라이브에서 눈으로 봐도 방해되지 않는다.
//
// ROOT_FOLDER_ID · SHARED_TOKEN 두 줄은 **기존 값을 그대로** 두세요.
const ROOT_FOLDER_ID = 'PASTE_FOLDER_ID_HERE';
const SHARED_TOKEN = 'PASTE_LONG_RANDOM_STRING_HERE';

const KEY_PREFIX = 'wskey:';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) return json({ error: 'unauthorized' });

    switch (body.action || 'upload') {
      case 'upload':       return json(upload(body));
      case 'ensureFolder': return json({ folderId: folderFor(body).getId() });
      case 'renameFolder': return json(renameFolder(body));
      case 'trash':        return json(trash(body));
      case 'list':         return json(list(body));
      default:             return json({ error: 'unknown action' });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

// 폴더는 id가 있으면 id로, 없으면 path를 따라 내려가며 찾거나 만든다.
// path: ['2026 하계 수련회', '포스터 만들기'] 처럼 위에서 아래로.
// id를 먼저 보는 것이 중요하다 — 이름으로만 찾으면 프로젝트 이름을 바꾼 순간
// 예전 파일은 옛 폴더에, 새 파일은 새 폴더에 쌓인다.
function folderFor(body) {
  if (body.folderId) {
    try { return DriveApp.getFolderById(body.folderId); } catch (err) { /* 지워졌으면 path로 */ }
  }
  var f = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var path = body.path && body.path.length ? body.path : [body.projectName || '기타'];
  for (var i = 0; i < path.length; i++) f = childFolder(f, String(path[i] || '기타'));
  return f;
}

function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 읽기 전용 조회용 — 없으면 null. list가 폴더를 만들어 버리면 안 된다.
function childFolderIfExists(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

// 같은 열쇠를 가진 파일 찾기(재시도일 때만 부른다)
function findByKey(folder, key) {
  if (!key) return null;
  var tag = KEY_PREFIX + key;
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getDescription() === tag) return f;
  }
  return null;
}

function upload(body) {
  // 업무 폴더는 프로젝트 폴더 **아래**다. 프로젝트 폴더 id를 주면 거기서 시작한다.
  var folder = folderFor(body);
  if (body.cardTitle) folder = childFolder(folder, String(body.cardTitle));

  // 재시도일 때만 훑는다 — 첫 시도에 훑으면 파일이 많은 폴더에서 그게 병목이다
  if (body.retry) {
    var found = findByKey(folder, body.key);
    if (found) return { id: found.getId(), url: found.getUrl(), folderId: folder.getId(), existing: true };
  }

  var blob = Utilities.newBlob(
    Utilities.base64Decode(body.dataBase64),
    body.mimeType || 'application/octet-stream',
    body.name || 'file'
  );
  var file = folder.createFile(blob);
  if (body.key) file.setDescription(KEY_PREFIX + body.key);
  // 링크를 아는 사람은 보기 — 앱이 lh3.googleusercontent.com/d/<id>로 썸네일을 붙인다.
  // 이 줄이 없으면 소유자만 열 수 있어서 앱 안 이미지가 전부 깨진다.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), url: file.getUrl(), folderId: folder.getId() };
}

// 폴더 안 파일 목록(열쇠 포함). 폴더를 만들지 않는다.
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
  var out = [];
  var it = folder.getFiles();
  while (it.hasNext() && out.length < 500) {
    var f = it.next();
    var d = f.getDescription() || '';
    out.push({
      id: f.getId(), name: f.getName(), size: f.getSize(), url: f.getUrl(),
      key: d.indexOf(KEY_PREFIX) === 0 ? d.slice(KEY_PREFIX.length) : null,
    });
  }
  return { folderId: folder.getId(), files: out };
}

function renameFolder(body) {
  var folder = folderFor(body);
  if (body.newName) folder.setName(body.newName);
  return { folderId: folder.getId(), name: folder.getName() };
}

// 완전 삭제가 아니라 휴지통이다 — 30일 안에는 되돌릴 수 있다.
// 앱에서 잘못 지운 것을 복구할 길이 없으면 그건 싱크가 아니라 유실이다.
// v4부터 **폴더 id도 받는다** — 업무·프로젝트를 지울 때 폴더째 휴지통으로 보낸다
// (getFileById는 폴더에 못 쓰므로 실패하면 getFolderById로 다시 시도한다).
function trash(body) {
  try { DriveApp.getFileById(body.fileId).setTrashed(true); }
  catch (err) { DriveApp.getFolderById(body.fileId).setTrashed(true); }
  return { trashed: body.fileId };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 우리 쪽 (2026-08-26에 붙였다)

1. **Vercel 환경변수** `DRIVE_WEBAPP_URL` · `DRIVE_WEBAPP_TOKEN`
   (**둘 다 서버 전용 — `VITE_` 접두사 금지.** 붙이면 브라우저에 그대로 박힌다)
   Production·Development 등록 완료. Preview는 남아 있다(프리뷰 배포에만 쓴다).
2. **`api/drive.js`** — 세션 토큰을 검증하고 스크립트로 넘긴다(`api/ai.js`와 같은 패턴).
   브라우저는 스크립트 URL·토큰을 모른다. **승인된 사람만** 통과시킨다(0022) —
   RLS는 DB만 지키고 이 경로는 DB를 거치지 않는다.
   키가 없는 환경(로컬·프리뷰)은 501을 주고, 부르는 쪽이 Storage로 되돌린다.
3. **업로드 경로**: `cloud.uploadAttachment`가 드라이브로 보내고 `source:'drive'`,
   `drive_file_id`, `web_view_link`로 행을 만든다. 501이면 예전 Storage 경로.
4. **폴더는 `프로젝트 / 업무` 두 겹**이다. 프로젝트 폴더는
   `projects.drive_folder_id`에 id로 적어 두고(첫 업로드 때 `ensureProjectFolder`가
   한 번 만든다), 업무 폴더는 그 아래에 **제목으로** 찾거나 만든다.
   프로젝트를 id로 잡는 이유: 이름으로만 찾으면 프로젝트 이름을 바꾼 순간 예전
   파일과 새 파일이 두 폴더로 갈라진다.
   **업무 폴더는 id를 두지 않았다** — 업무마다 컬럼 하나를 더 두고 제목이 바뀔
   때마다 폴더 이름을 맞추는 것은, 훑어보기 편하자고 치르기에 큰 비용이다.
   대신 **업무 제목을 바꾸면 그 뒤에 올리는 파일은 새 이름 폴더로 간다**(예전
   파일은 옛 이름 폴더에 남는다). 이게 걸리면 그때 `cards.drive_folder_id`를 둔다.
5. **CRUD 싱크**: 프로젝트 이름을 바꾸면 폴더 이름도 따라간다(폴더가 이미 있을 때만 —
   파일을 한 번도 안 올린 프로젝트에 빈 폴더를 만들 이유가 없다). 앱에서 첨부를
   지우면 드라이브에서는 **휴지통으로** 간다(30일 복구 가능). 프로젝트를 지워도
   드라이브 폴더는 남긴다(안전 쪽).
6. **썸네일**: 이미지 첨부는 `lh3.googleusercontent.com/d/<id>=w200-h200-c`로 붙는다.
   구글 이미지 CDN이 줄여서 내주므로 **우리 대역폭이 0**이다. 스크립트가 올릴 때
   '링크를 아는 사람은 보기'로 열어 두기 때문에 가능하다(사용자 결정).
7. **엑셀 펼쳐보기**: 드라이브 파일은 구글 자체 미리보기
   (`drive.google.com/file/d/<id>/preview`)를 쓴다 — 마이크로소프트로 주소가
   나가지 않는다. Storage에 남은 파일만 MS 뷰어를 거친다.
8. **기존 파일 이관**: `node scripts/migrate_to_drive.mjs` (인수 없이 돌리면 무엇을
   옮길지만 보여준다, `--go`로 실행, `--go --limit 5`로 몇 건만).
   한 건씩 처리하고 행을 즉시 갱신하므로 **끊겨도 다시 돌리면 이어서** 한다.
   이관 중에도 서비스는 정상이다 — 읽기 경로가 행 단위로 갈라진다.
   **Storage 객체는 지우지 않는다** — 눈으로 확인한 뒤 따로 지운다.
   이 스크립트는 `.env`에 `SUPABASE_SECRET_KEY`가 필요하다(RLS 우회 + Storage 다운로드).

## 한계 (알고 넘어갈 것)

- Apps Script 웹앱은 요청 1건당 실행 시간·페이로드 제한이 있다.
  25MB 이하 파일 기준으로는 충분하지만, 대용량은 실패할 수 있다
- **파일은 '링크를 아는 사람은 보기'로 열린다**(사용자 결정, 2026-08-25). 그래야
  앱 안에서 썸네일·미리보기가 지금과 똑같이 보이고 우리 대역폭이 0이 된다. 대가는
  주소를 아는 사람은 로그인 없이도 연다는 것이다 — 지금(비공개 버킷 + 1시간짜리
  서명 URL)보다 약하다. 이 결정을 되돌리면 썸네일도 같이 포기해야 한다
- **앱에서 지우면 드라이브에서는 휴지통으로 간다**(30일 복구 가능). 완전 삭제는
  되돌릴 수 없고, 남겨 두기만 하는 것은 CRUD 싱크가 아니다
- 본문 이미지·프로필 사진은 **옮기지 않는다**(사용자 결정) — 올릴 때 이미 줄여서
  저장하고, 본문에는 주소가 글 안에 박히므로 주소 체계를 바꾸면 지난 글의 이미지가
  구글 사정에 한꺼번에 끌려간다. 옮기는 것은 업무 첨부뿐이다
