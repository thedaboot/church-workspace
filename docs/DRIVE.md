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
// 더다붓 워크스페이스 → 개인 드라이브 파일 저장기
const ROOT_FOLDER_ID = 'PASTE_FOLDER_ID_HERE';
const SHARED_TOKEN = 'PASTE_LONG_RANDOM_STRING_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== SHARED_TOKEN) return json({ error: 'unauthorized' });

    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const folder = getOrCreateFolder(root, body.projectName || '기타');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(body.dataBase64),
      body.mimeType || 'application/octet-stream',
      body.name || 'file'
    );
    const file = folder.createFile(blob);
    return json({ id: file.getId(), url: file.getUrl(), folderId: folder.getId() });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function getOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## URL을 받은 뒤 우리가 할 것

1. Vercel 환경변수 등록 (**둘 다 서버 전용 — `VITE_` 접두사 금지**)
   - `DRIVE_WEBAPP_URL`
   - `DRIVE_WEBAPP_TOKEN`
2. `api/drive.js` 추가 — 세션 토큰 검증 후 스크립트로 프록시
   (브라우저가 스크립트 URL을 알 수 없게. `api/ai.js`와 같은 패턴)
3. 신규 업로드 경로 전환: `uploadAttachment`가 Storage 대신 `api/drive`로
   보내고 `source:'drive'`, `drive_file_id`, `web_view_link`로 행을 만든다
4. 기존 파일 이관 스크립트 (1회 실행):
   - `files where source='storage'` 조회
   - Storage에서 내려받아 `api/drive`로 올림
   - 행 갱신: `source='drive'`, `drive_file_id`, `web_view_link`,
     `storage_path=null`, 그리고 `projects.drive_folder_id` 채우기
   - 검증 후 Storage 객체 삭제
5. 이관 중에도 서비스는 정상 — 읽기 경로가 행 단위로 분기하므로
   절반은 Storage, 절반은 드라이브인 상태도 문제없이 동작한다

## 한계 (알고 넘어갈 것)

- Apps Script 웹앱은 요청 1건당 실행 시간·페이로드 제한이 있다.
  25MB 이하 파일 기준으로는 충분하지만, 대용량은 실패할 수 있다
- 드라이브 파일 권한: 링크를 아는 사람이 열 수 있게 하려면 스크립트에서
  `file.setSharing(...)`을 추가해야 한다. 기본은 소유자만 열 수 있다
  → 워크스페이스 멤버가 열려면 이 설정이 필요하다(소유자 결정 사항)
- 앱에서 파일을 지워도 드라이브 실체는 남는다(안전 쪽 선택)
