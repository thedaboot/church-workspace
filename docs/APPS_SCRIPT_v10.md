# Apps Script v10 — 큐시트 사본에 편집자 둘

**이 판은 v9에서 네 군데만 고칩니다.** v9 문서(`docs/APPS_SCRIPT_v9.md`)가 지금 배포된 판이고
전체 코드가 거기 있습니다 — 통째로 갈아 끼우지 말고 **아래 네 곳만** 고치세요.
올리기 전에도 앱은 그대로 돌아갑니다(큐시트가 보기로만 열립니다).

## 왜

사용자 결정 2026-09-09 — **"큐시트는 교역자와 마스터만 수정 가능하게 하자."**

큐시트는 워드(`.docx`)로 올라오고, 스크립트가 구글 문서 **사본**을 만들어 앱이 그 사본을
iframe으로 띄웁니다. 지금 사본의 공유는 `{role:'reader', type:'anyone'}` 하나뿐이라
**아무도** 그 안에서 고칠 수 없습니다(주소를 `/edit`으로 바꿔도 구글이 읽기 화면을 줍니다).

`role`을 `'writer'`로 올리는 길은 **쓰지 않습니다** — 링크를 아는 누구나 고칠 수 있게 되고
그건 사용자가 판단해서 뺀 길입니다(HANDOFF §7 '첨부에 편집 권한 주기'). 대신 **이름이 있는
구글 계정 둘만** 편집자로 올립니다:

```
joshua052698@gmail.com   마스터(노준석) — 사본의 소유자이기도 하다
mose716@gmail.com        교역자(임성빈)
```

그러면 §7이 걱정한 "링크를 아는 누구나"는 열리지 않고, 그 두 계정으로 브라우저에 로그인해
있을 때만 앱 안에서 바로 고쳐집니다. 나머지 사람은 같은 자리에서 읽기 화면을 봅니다.

**편집자를 붙이는 것은 큐시트 사본뿐입니다.** 앱이 `convert` 요청에 `cueEditors: true`를
실어 보낼 때만 붙고(업무 첨부·송폼은 안 보냅니다), 그 판단은 `files.kind === 'cuesheet'`
한 줄입니다(`src/services/cloud.js`). 그래서 업무 첨부 사본의 공유는 지금과 똑같습니다.

**고쳐지는 것은 사본이고 원본 `.docx`는 그대로입니다.** 앱에서 고친 큐시트와 다시 내려받은
원본이 갈립니다 — 큐시트를 앱에서 고쳐 쓰기로 했다면 **원본을 다시 올리지 마세요**(올리면
새 사본이 생기고 앱은 그것을 가리킵니다). 링크로 걸린 큐시트(`services.cue_sheet`)는 이 일과
무관합니다 — 그건 원래부터 `/edit`으로 열리고 그 문서의 공유 설정이 경계입니다.

---

## 고칠 곳 1 — 판 번호

```js
const SCRIPT_VERSION = 9;
```
를
```js
const SCRIPT_VERSION = 10;
```
로. (앱은 `>= 8`만 보므로 동작이 바뀌지는 않습니다. 배포가 올라갔는지 확인할 때 씁니다.)

## 고칠 곳 2 — 편집자 목록 (새로 추가)

`const KEY_PROP = 'wskey';` **바로 아래**에 붙이세요.

```js
// 큐시트 사본을 고칠 수 있는 구글 계정(사용자 결정 2026-09-09 — 교역자와 마스터만).
// **여기 있는 계정만** 편집자가 된다 — role을 'writer'/type 'anyone'으로 올리면 링크를
// 아는 누구나 고칠 수 있고 그건 뺀 길이다(HANDOFF §7). 사람이 바뀌면 이 줄을 고치고
// 새 버전으로 올리면 된다(옛 사본의 편집자는 그대로 남으니 드라이브에서 지운다).
var CUE_EDITORS = ['joshua052698@gmail.com', 'mose716@gmail.com'];
```

## 고칠 곳 3 — `makePreviewCopy`

시그니처에 `cueEditors`를 받고, `Drive.Permissions.create({ role: 'reader', … })` **바로 아래**에
편집자 루프를 붙입니다. 나머지는 v9 그대로입니다.

```js
function makePreviewCopy(fileId, name, folderId, cueEditors) {
  var target = COPY_AS[String(name || '').split('.').pop().toLowerCase()];
  if (!target) return null;   // PDF·사진·zip 등은 구글 편집기가 없다 — 사본을 안 만든다
  try {
    var copy = Drive.Files.copy({
      name: name + target[1],
      mimeType: MimeType[target[0]],
      parents: [folderId],
      appProperties: { wskey: null, wsrole: 'sheetpreview' },
      description: '',
    }, fileId, { supportsAllDrives: true });
    // 미리보기는 iframe으로 뜬다 — 링크로 **볼** 수 있어야 남들 화면에서도 그려진다.
    // role은 언제나 'reader'다. 'writer'로 올리면 링크를 아는 누구나 고칠 수 있다.
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
```

## 고칠 곳 4 — `convertExisting`이 그 칸을 넘긴다

마지막 줄 하나만 바뀝니다.

```js
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
```

> `upload` 안에서 사본을 만드는 옛 호환 갈래(v9 문서의 `upload`)는 **손대지 않습니다** —
> 거기로 오는 것은 배포 직후 새로고침하지 않은 옛 탭의 엑셀뿐이고, 큐시트는 언제나
> `convert`로 옵니다.

---

## 올리는 순서 (3분)

1. [script.google.com](https://script.google.com) → 그 프로젝트 열기
2. 위 네 곳을 고친다 (**맨 위 `ROOT_FOLDER_ID`·`SHARED_TOKEN` 두 줄은 그대로**)
3. 저장 → **배포 → 배포 관리 → 연필(수정) → 버전 '새 버전' → 배포**
   **새 배포를 만들지 마세요** — URL이 바뀌면 Vercel 환경변수를 Production·Development
   둘 다 고쳐야 합니다.

## 올린 뒤 확인할 것

1. **판 번호** — 앱에서 아무 오피스 파일을 올리고 서버 로그(`vercel logs`)의 `[drive] convert`
   응답에 `"version":10`이 오는지. 또는 스크립트 편집기에서 `SCRIPT_VERSION`을 눈으로.
2. **새 큐시트** — 주보 수정 화면에서 큐시트 `.docx`를 하나 올리고, 몇 초 뒤 그 줄을 열면
   **교역자·마스터 계정으로는 편집 화면**(글자를 칠 수 있음), 다른 계정으로는 읽기 화면인지.
3. **업무 첨부는 그대로** — 업무에 xlsx를 올려 펼쳐보기가 여전히 **보기**인지(편집칸이 뜨면
   `cueEditors`가 잘못 새고 있는 것입니다).

## 이미 올라간 큐시트 하나 (백필 — 손으로)

스크립트는 **새로 올리는 파일**에만 편집자를 붙입니다. 라이브에 이미 있는 큐시트 사본은
하나뿐이라 드라이브에서 손으로 두 계정을 편집자로 추가하면 끝입니다.

```
파일: 20260906_더다붓청년예배 큐시트.docx (문서)
주소: https://docs.google.com/document/d/1rZCwXbDP6GjLiYCu6Osjk8HQbdgjwMsS8kMLM7cISTM/edit
```

열어서 오른쪽 위 **공유** → `mose716@gmail.com` 추가 → **편집자** → 알림 끄기 → 완료.
(마스터 계정은 소유자라 추가할 것이 없습니다.) 이 뒤로 올라오는 큐시트는 스크립트가
알아서 붙입니다.

## v11 후보 (미리 적어 두는 것)

- **`cueEditors`를 액션으로 따로 빼기** — 지금은 사본을 만들 때만 붙습니다. 편집자 명단이
  바뀌면 옛 사본은 손으로 고쳐야 합니다. `action:'grantEditors'` 하나를 두면
  `scripts/drive_check.mjs --fix`가 한 바퀴 돌 수 있습니다. 지금은 파일이 한 건이라 값이 작습니다.
- **원본 `.docx`를 사본에서 되쓰기** — 앱에서 고친 큐시트를 원본으로 내려 받으려면
  `Drive.Files.export`로 사본을 docx로 뽑아 원본을 덮어야 합니다. 원본을 정본으로 쓸 이유가
  생기면 그때. 지금은 "앱에서 고치면 사본이 정본"입니다.

## 되돌리려면

`makePreviewCopy`의 편집자 루프를 지우고 `SCRIPT_VERSION`을 9로 되돌린 뒤 같은 배포의
새 버전으로 올립니다. 이미 붙은 편집자는 드라이브에서 파일마다 지워야 합니다(공유 → 사람 →
접근 권한 삭제). 앱 쪽은 `worshipPerms.canEditCue`를 늘 거짓으로 두면 편집 주소를 만들지 않습니다.
