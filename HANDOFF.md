# 인수인계 — 더다붓 워크스페이스

> **2026-09-11에 대폭 줄였다.** 지난 회차 기록·확인 목록은 git 이력(그 전 커밋의 `HANDOFF.md`)에 있다.

교회 청년부 워크스페이스. 이 문서에는 **코드와 git에서 읽을 수 없는 것만** 둔다 — 사용자 결정, 관례, 흐름, 화면↔파일 지도, 비밀이 있는 자리, 남은 일. 기능 소개는 [`README.md`](README.md), 검증 스위트 목록은
[`tests/README.md`](tests/README.md), 함정과 구조 색인은 [`docs/PITFALLS.md`](docs/PITFALLS.md).

- 레포 `github.com/thedaboot/church-workspace` · 브랜치 `main` · 배포 Vercel(푸시 시 자동)
- **커밋 해시를 여기 적지 않는다**(손으로 고치다 금방 어긋난다) — 최근 작업은 `git log --oneline -15`.
- 검증은 **고친 것과 관련된 스위트만**. 전체(`npm run verify` · 약 7분)는 **사용자가 부를 때만**이고 **푸시 직전도 예외가 아니다**(같은 지적 넷: 2026-08-27 · 08-30 · 08-31 · 09-06).
- 코드 주석의 `§3-N`은 아래 §3 흐름의 N단계, `§4.N`·`§6-N`은 `docs/PITFALLS.md`의 번호다.

## 0. 처음이라면 이 순서로

1. **§2 남은 일** — 할 일이 있다면 여기부터.  2. **§3 흐름** — 새 기능을 붙이는 순서, 이대로 하면 된다.
3. **§7 다시 제안하지 말 것** — 사용자가 판단해서 뺀 것들. 이걸 다시 꺼내지 않는 것이 이 문서의 목적 중 하나다.
4. **§4 화면↔파일 지도** → 그 파일 **머리말 주석** → 필요할 때만 `docs/PITFALLS.md`의 해당 번호.
5. v2(홈·예배·말씀·모임·명단)의 확정 설계·권한 표는 [`docs/V2.md`](docs/V2.md) §1~§3이 정본.

## 1. 이 문서 밖에 있는 것 (레포만 받아서는 알 수 없는 것)

1. **시각 규격의 원본**은 외부 디자인 핸드오프 번들이고 레포에 없다 — `C:\Users\노준석\Downloads\대시보드 완전 리디자인\design_handoff_workspace_redesign\README.md`. 규격 논쟁이 생기면 **그 문서가
   기준**이고 임의로 바꾸지 않는다(한 번 어겼다가 원복했다).
2. **계정·주소**: 마스터 구글 계정 `joshua052698@gmail.com`(드라이브 소유자 · Apps Script 실행 계정) · 카카오 관리자 `lordjoshua@naver.com` · Supabase ref `zdqkwvbuiorqrykfedon`
   · 배포 `https://church-workspace.vercel.app`.
   **Supabase는 서울(`ap-northeast-2`)이고 `vercel.json`의 `regions`도 서울(`icn1`)로 맞춰 뒀다**(2026-09-14) — 안 적으면 함수가 워싱턴에서 돌아 태평양을 두 번 건넌다(§6-29-z-17). DB를 옮기면 그 줄도 같이 옮기세요.
3. **비밀 값은 로컬 `.env`와 Vercel 환경변수에만 있다**(§5). 마이그레이션·psql에는 `SUPABASE_DB_URL` (대시보드 Connect의 Session pooler URI)이 필요하다.
4. **검증 스위트는 게스트 모드만 돈다.** 로그인·실시간·알림·푸시·첨부처럼 클라우드에서만 도는 경로는 테스트가 못 보고, 이 사각지대가 버그를 여럿 가리고 있었다(§6-25·27·28·29).
   **그쪽을 건드리면 배포 후 직접 확인해 달라고 부탁하세요.**
5. **라이브 DB 확인은 psql로 한다.** 한글이 깨지면 `PGCLIENTENCODING=UTF8`, SQL은 파일로 넘기는 쪽이 안전하다. RLS 경로를 재현할 때는 트랜잭션 안에서 `set local role authenticated` +
   `set_config('request.jwt.claims', …)`로 같은 역할·클레임을 만들고 **ROLLBACK**한다.
6. **Vercel이 푸시 웹훅을 놓칠 때가 있다**("고쳤는데 안 보인다"의 정체) — `gh api repos/thedaboot/church-workspace/deployments?per_page=1`로 새 배포를 확인하고, 없으면 `git commit
   --allow-empty`로 재트리거한다.
7. **이 환경(Claude Code)의 권한 분류기가 `supabase db push`를 막는다** — 사용자에게 `! <명령>`으로 넘긴다.
8. **Apps Script는 어시스턴트가 올릴 수 없다.** 문서와 배포된 판이 모두 v12다(2026-09-25 사용자 배포 · 새 버전 · 같은 URL · 폴더 밖 거절 확인). 고칠 것이 생기면 `docs/APPS_SCRIPT.md`를 고치고 사용자에게 부탁한다(배포 URL이 같으면 Vercel 환경변수는 그대로. 새 배포를 만들면 Production·Development 둘 다
   고쳐야 한다). `ROOT_FOLDER_ID`·`SHARED_TOKEN`은 스크립트 안에만 있으니 코드를 갈아 끼울 때 그 두 줄은 남긴다.
9. **스크린샷을 레포 루트에 흘리지 마세요**(실제로 8장이 커밋됐다) — 임시 출력은 스크래치 폴더로.

## 2. 남은 일

### 12차 — 전면 리팩토링 (2026-09-24~25)

감사 다섯 갈래·라이브 DB 조사로 배치 A~E를 짜고, 이어서 AI 맥락과 수정·입력 화면을 감사했다. 모양·문구는 **사용자가 목업으로 고른 것만** 바꿨고(빈 자리 문구 25곳 · A1 · B2 — §8) 나머지는 아래 ★로 남겼다.

- **한 것**: A 보안(`api/_lib.js` · 드라이브 프록시가 대상·칸을 본다 · 보안 헤더 · 딥링크 출처) · B 성능(바뀐 표만 실시간 · 주보 가벼운 열 · 카드 실시간 모으기 · 15초 재조회 생략 · 모달류 넷 lazy) · C 정리(죽은 코드 · 중복 합치기) ·
  D UI 결함(떠 있던 목록 다섯을 포털로 · 터치 기기 hover · 누르는 자리 · aria-label · 토스트 z) · E 임베딩 뒷단 · AI 맥락(직함은 코드가 고른다 · 글에 이름으로 나온 가입자 · 큐시트 요지 — `docs/AI.md`) ·
  편집 감사(빈 줄·줄 구조 왕복 · 업무 창 ✕·딤 확인과 칸별 병합 · 한글 조합 Enter · 초안 즉시 남기기).
- **라이브 DB**: 0071~0074 적용 · `bible_vec` 31,067행(62MB) · `doc_vec` 424조각(8시 크론이 증분) · `role_note` 4명 고침 · 첨부 256건 발췌·캡션 · 큐시트 3건 요지. **Apps Script v12 배포**(2026-09-25).
- **목업 결정 넷**(2026-09-25 · `remaining-mockup` — 사용자가 D2-a · D9-a · G-a · S-a를 골랐다):
  D2 읽기 실패는 빈 자리에 실패 두 줄 + '다시 시도'(예배 목록·모임·멤버 관리 · 토스트는 캐시가 있을 때만) ·
  D9 주 버튼 두 단 · 뒤판 50/80 · 최소 글자 10px · 12px 미만 muted(§8) ·
  G 상단 검색 글자 결과 아래 '관련된 업무 내용'(doc_vec · 최대 다섯 줄) · S 성경 검색의 AI가 실패하면 그 자리에 벡터 결과.
- **푸시 받는 사람은 50명이 상한이다** — 멤버가 50을 넘으면 넘친 사람은 푸시만 조용히 빠진다(앱 안 알림은 간다). 그때 `api/push.js`의 상한을 올린다.
- **CSP는 `frame-ancestors 'none'` 하나만 강제**하고 나머지는 Report-Only 초안이다 — 콘솔 보고를 모아 다듬은 뒤 올린다(pdf.js의 `isEvalSupported` 갈래를 먼저 본다).

**실기기 확인**(배포 뒤 · 게스트 스위트가 못 보는 자리):

- **계정·권한(0071)**: 로그인 · 내 정보 저장(이름·사진·팀) — **합친 계정도**(0071 전에는 실패했다) · 관리자 승인/환송 · 계정 합치기 · 새 가입자가 승인 전에 못 들어오는지 · 명단 추가(순장 계정) · 알림 벨의 보낸 사람 이름.
- **업무·첨부**: 업무 만들기/삭제 · 댓글 쓰기/고치기/지우기 · 첨부 올리기(3MB 넘는 것 = Storage 경유 · **맥에서 고른 한글 이름 파일**이 멀쩡하고 검색에 걸리는지) · 본문 이미지·프로필 사진 · '구글 문서에서 편집'(v12 뒤에도) · 업무/프로젝트 삭제 때 폴더 휴지통 ·
  업무 창 ✕·딤이 고친 것을 묻는지 · **두 사람이 같은 업무를 고칠 때 남이 바꾼 칸이 내 저장으로 되돌아가지 않는지**(`mergeTaskEdit` — 게스트는 이 길을 안 탄다).
- **입력·에디터**: 폰 키보드(아이폰·안드로이드)의 한글 조합 중 Enter가 확정을 안 누르는지 · 폰 댓글 칸의 Enter가 줄바꿈인지 · 빈 줄·들여쓰기가 저장·다시 열기에서 그대로인지 · 평문 붙여넣기 ·
  노트 읽기 종이와 업무 보기가 편집 화면과 같은 줄인지(A1 — **공유 그림으로 구운 모양도**) · 에디터 서식.
- **미리보기**: 한글 PDF · **옛 iOS(18.0~18.3) 사파리에서 PDF** · 워드·PPT · HTML 첨부가 `frame-ancestors` 아래에서도 그려지는지 · 구글 iframe·유튜브·오피스 뷰어 · 주보 PDF 내려받기(jspdf 4).
- **AI·푸시**: 요약·다듬기·순모임 가이드·성경 AI 검색 · 사진이 많은 업무의 요약이 문서 내용을 반영하는지 · 요약·다듬기의 첫 호출이 명단을 읽는지(콘솔에 `[ai] 명단을 받지 못해`가 없는지) · 사람 줄에 `순: OO순 순장` ·
  큐시트를 새로 올린 뒤 그 파일 행의 `text_excerpt`가 1200자 이하 요지인지 · 유튜브 재생목록 · 푸시 도착과 딥링크 · 크론 둘이 다음 날 로그에서 200인지(401이면 `CRON_SECRET`)와 8시 로그의 `[push] 문서 임베딩:` 한 줄.
- **실시간·화면**: 홈 카드 실시간 갱신 · 출석 숫자(최근 8주) · 다크/라이트 전환 · 바깥 누름 닫기(모임 피커·검색·프로젝트 더보기) · **아이패드에서** 참고 링크 자물쇠·X · 댓글 수정·삭제 · 프로젝트 이름 연필이 보이는지 ·
  포털로 옮긴 목록 다섯(담당자 찾기 · 주보 사람 칸 · 검색 결과 · 멘션 · 성경 최근 검색어)이 키보드가 올라와도 칸에 붙어 서는지 · 넓힌 작은 X가 이웃을 누르지 않는지.
- **목업 결정 넷(2026-09-25)**: 상단 검색 '관련된 업무 내용'이 서는지(두 글자 · 약 0.4초 뒤 뼈대 → 줄) · 댓글·첨부·상세 내용 발췌가 맞는지 ·
  위 글자 결과에 선 업무가 또 안 서는지 · 눌러서 그 업무가 열리는지 · 판 360px 안에서 두 구역이 보이는지(데스크톱·폰) · 미승인 계정에는 구역이 안 서는지 ·
  성경 검색에서 AI가 실패할 때(로그인 풀림·시간 초과) '○○과 관련된 성경 구절'이 같은 줄 모양으로 서는지 · 긴 참조·결과 많을 때 마지막 줄 ·
  예배·모임·멤버 관리의 읽기 실패 자리(비행기 모드로 첫 진입 · '다시 시도'로 돌아오는지) · 두 단 버튼·뒤판·10px 글자가 폰 두 테마에서 괜찮은지.
- **검색 결과 화면 감사(2026-09-25)에서 남은 것**: 아이폰 — 상단 검색 판에서 결과가 많을 때 키보드가 올라온 채 '그 외 N건'까지 내려가는지 ·
  '검색' 키로 키보드가 내려가는지 · 판이 열린 동안 하단 탭바가 어둡게 덮이고 안 눌리는지 · 가로로 돌렸을 때 마지막 결과 · 안드로이드 크롬도 같은 것(`--app-vh` 값이 다를 수 있다) ·
  성경 최근 검색어 판이 키보드 위에서 칸 아래에 붙어 짧아지는지(아이폰 SE급) · 성경 검색 X가 잘 눌리는지 · 칸 포커스 테두리 모양 · 데스크톱 768~1030px에서 결과 판이 칸보다 왼쪽으로 넓게 서는 모양.
- **앞 회차에서 남은 것**: 아이패드에서 한 시간 넘게 로그인이 남는지 · 폰에서 슬라이드가 첫 장 그림 + '새 탭에서 열기'인지(첨부·본문 링크) · 사진이 든 노트를 사파리·카카오 인앱에서 공유 · 손가락 확대(아이폰·안드로이드) · 폰에서 저장한 노트가 수정 화면과 같은 모양인지 · 성별을 넣은 뒤 `형제/자매` 호칭.

**사용자 판단 대기**(★ — 하지 않는다 · 시각·문구는 목업으로 묻는다 · §8):

- 모바일 대시보드가 상태 칩을 숨기는 것(`dashboardParts.jsx:314` — 색만으로 상태를 말한다).
- D9에서 남은 시각 통일: 모달 창 틀(모서리·안쪽 여백) · 섹션 머리줄 6벌 · 인라인 저장/취소 순서 · `Skeleton`에 넘긴 4·5px 모서리 여섯 곳이 지금 8px(PITFALLS 9-bw).
- 검색: 테두리 없는 안쪽 input의 네모 포커스 테두리(앱 전체 · 전역 `*:focus-visible` 규칙을 고칠지 — PITFALLS 9-ca) · 768~1030px 상단 검색칸 폭 ·
  글자 결과 줄이 **왜 걸렸는지**(댓글·첨부 이름·첨부 내용) 한 줄 · 상단 검색에서 Enter로 첫 결과 열기(지금은 ↓로 들어가 Enter).
- 노트 도막별 자리표 문구(사용자가 정한다) · 주보 상세 실시간(편집 중 폼을 덮지 않을 방법이 먼저).
- 순장 출석 메모 · 예배 명칭 통일 · 내 순 출석 이력 · 나눔 빈 자리 마크와 홈 생일 카드 · 찬양 구성 · 문구 톤.
- 시각 판단(2026-09-09 점검): `DepGraph` 고정 높이 440 · 375 주보 머리 카드 두 줄 · 1440 순원 줄의 '순 옮기기·빼기'가 이름에서 200px(§6-9-k) · '팀별 남은 업무'가 0건 팀까지 · 비밀번호 설정 줄 두 벌(`LinkPwFields`·`PasswordSetter`).

**다음** — 임베딩 뒷단과 화면(G·S)이 끝났다:

1. 뒷단(있는 것): 0073 `bible_vec`(31,103절 중 편집 표기 36절을 뺀 31,067행 · **인덱스 없이** — 전수 비교 top-30이 0.1~0.2초) · 0074 `doc_vec`(업무·댓글·업무 첨부 발췌 —
   **주보 첨부·노트·QT는 뺐다**: 읽는 규칙이 '승인된 전원'보다 좁다) · 질문 쪽은 `/api/ai { embed }` · 성경 색인은 로컬 한 번(`scripts/embed-bible.mjs` · 약 $0.23 · 15분) ·
   문서는 8시 크론이 **마감 임박 알림 뒤에** 증분(해시 · 예산 40초 · 실패해도 알림 응답은 그대로 · `?job=embed`는 손으로 부르는 길 · `scripts/embed-docs.mjs`는 전체·드라이런).
2. **성경 검색은 AI 검색이 앞이다**(§7 — 벡터가 못 이겼다). 벡터는 AI를 **못 물었을 때만** 그 자리를 채운다(S-a · `bibleSearch.aiBibleSearchOutcome`).
3. 상단 검색의 뜻 결과(G-a)는 **글자 결과를 대신하지 않는다** — 아래 구역이다. 품질은 실기기에서 본다(k 12 · 다섯 줄 · `services/vecSearch.js`의 상수).
4. `tests/worship`의 '취소하면 고치던 글을 버린다'가 글을 치지 않고 통과한다 — 문단에 커서를 놓고 치게 고친다(PITFALLS 42-c).

그 밖에 남은 것: 명단 미가입자 생일 3명(남다율·박세원·윤현서 — 값을 모른다) · 되돌리기 확인 ②③(ActionItems의 rows · 줄의 order) · 예배 목록의 `fetchAttendanceCounts()`가 PostgREST 1000행에 걸릴 수 있다(주보 약 20주분 — 해가 지나면 옛 주보의 출석 수가 모자란다. RPC나 창으로).

**짚어둔 것**(급하지 않음):

- **출석 13:30 게이트는 클라이언트만이다** — `attendance_insert` 정책은 시간을 안 본다(DB에도 걸지는 별도 결정).
- **`groups` 표를 한 화면에서 네 번 읽는다**(`fetchGroupPerms` + `fetchGroupsRoster` × 두 화면) — 보류.
- **주보 자동 저장이 Realtime Egress를 쓴다**(900ms UPDATE가 행 전체로 나간다) — Egress 분류를 보고 판단하되 **짐작으로 고치지 말 것**. `attendance.checked_by`는 0행이지만 남겨 둔다.
- **화면별 lazy는 아직 안 했다**(2026-09-14 판단 · 2026-09-24에는 모달류 넷만 뺐다). `App.jsx`가 여섯 뷰를 정적으로 물고 있어 업무만 쓰는 사람도 예배·모임·말씀·명단·홈 약 250 kB를 받는다
  (앱 코드 612 kB · gz 178 kB 중 · 2026-09-24). 미룬 이유는 **탭을 처음 누를 때마다 로딩 자리가 생기고**, 내비 검사 넷(`navsmoke`·`onebar`·`mobbits`·`errhunt`)이 타이밍에 민감해서다. 하려면 별도 회차로. 번들을 다시 재는 방법은 §6-29-z-18.
- **성능은 측정하지 않았다.** 이 PC에서 실행 간 편차가 3배까지 난다 — **성능 주장은 같은 실행 안에서 조건을 교대(A/B)해** 비교한다(이 함정에 두 번 빠졌다). 메인 번들 숫자는 고칠 때마다 `npm run build`로 갱신한다.
- **검색은 아직 `String.includes()`** 다(공백을 지우고 NFC로 비교 · 첨부 이름·댓글까지 · **내용은 못 본다**). RAG를 붙일 자리는 **첨부 내용·댓글·지난 프로젝트 아카이브**다 — **카드에 벡터를 붙이는 것부터 시작하지 마세요.** 0074(`doc_vec`)는 이제 상단 검색의 '관련된 업무 내용'이 쓴다(G-a).
- **보드 조작 줄 합치기** — 모바일에서 카드에 닿기까지 여섯 겹이다(마지막 두 줄을 합치는 쪽이 값이 크다).
- **업로드 속도는 구조상 여기까지다**(남은 시간은 Apps Script가 드라이브에 쓰는 시간). **인라인 상한(3MB)을 올려 Storage 경유를 없애자는 생각은 하지 마세요**(base64가 33%를 불린다 · §6-29-n·o).
- **첨부 사진 캡션은 백필한 것에만 있다**(`[사진] ` 접두 · 2026-09-24 사진 236건) — 새로 올리는 사진에는 안 생기고 `scripts/backfill_attachments.mjs`를 다시 돌려야 붙는다.

## 3. 이 레포의 흐름 (새 기능을 붙일 때)

기능을 여럿 붙이면서 매번 같은 순서를 밟았다. 그대로 하면 된다.

1. **저장 자리를 먼저 고른다 — 컬럼이냐 조인 테이블이냐.** 카드와 언제나 같이 읽고 쓰고 항목이 몇 개뿐이면 **컬럼**(jsonb라도). 조인은 따로 조회·집계할 이유가 있을 때만 — 왕복이 두 번이라 저장이 겹치면 깨진다(§6-27).
2. **앱 안의 모양은 그대로 두는 쪽을 먼저 본다.** 0013이 담당자를 조인으로 옮겼는데도 `task.assignees`는 여전히 이름 배열이라 셀렉터·뷰·활동 기록·AI 컨텍스트를 한 줄도 안 고쳤다. 저장 계층만 바꾸는 길을 먼저 찾으세요.
3. **마이그레이션은 psql로, 결과를 눈으로 확인한다.** `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <파일>` → 컬럼·제약·정책·백필 건수 확인. 되돌리는 SQL은 파일 맨 아래 주석(§5).
4. **코드가 새 컬럼을 읽기 시작하면 마이그레이션이 먼저 나가야 한다.** 조회에 없는 관계를 넣으면 `loadCloudState`가 던져 **모두에게 오류 화면**이 뜬다. 순서는 마이그레이션 → 푸시.
5. **검사 하나를 남긴다**(화면이면 브라우저 스위트, 순수 로직이면 `logcheck`) **그리고 일부러 되돌려서 실제로 실패하는지 확인한다.** 이걸로 여러 번 걸렀다. 클라우드 저장 모양(`cardPatch` 같은)을 바꾸면 `logcheck`에 단정을 둔다 — 게스트 모드는 그 길을 안 탄다. 순수 로직은 `.js`(JSX 아님)에 두면 노드에서 바로 검사된다.
6. **클라우드 경로는 직접 확인해 달라고 부탁한다.** 지금까지 잡힌 버그 상당수가 사용자가 써 보고 알려준 것이다.
7. **문서를 같이 고친다** — `HANDOFF.md`(결정·남은 일·파일 지도) · `docs/PITFALLS.md`(새 함정은 뒤에 번호를 갈라 붙인다) · `README.md`(기능·마이그레이션 표) · `tests/README.md`(스위트 표).

## 4. 화면 ↔ 파일 지도

파일마다 한 줄이다. 설명은 그 파일 **머리말 주석**에 있으니 되풀이하지 않는다. 괄호의 `§`는 `docs/PITFALLS.md`.

```
src/main.jsx                  부트스트랩(React 마운트)
src/App.jsx                   조립 + 라우팅 상태 · GLOBAL_MENUS·CHURCH_ORDER·needsFullHeight · main 스크롤(§6-9-v)
src/index.css                 토큰(--app-*/--p-*)·모션(dc-*)·`.tab-bar-work`(하단바 모드 전환)·`.tiptap`·`.note-paper`(§6-32-p) · 폰트 import (§4.2)
src/config.js                 팀·상태 상수 · teamColor/teamPaint · MAX_UPLOAD_MB · 팀 표는 안전목록(§6-9-bo)
src/utils.js                  순수 헬퍼 한 벌(정렬·날짜·생일·그래프 물리·멘션·drive 주소…) — logcheck가 검사
src/store/workspaceStore.js   useSyncExternalStore 스토어 + 되돌리기 기록(§6-22)
src/store/selectors.js        셀렉터 — 매번 새 배열을 만들면 무한 리렌더(§4.9)
src/hooks/controllers.js      저장·삭제 등 쓰기 경로
src/hooks/useIsMobile.js      반응형 분기 — 한쪽만 마운트(§6-3)
src/hooks/useForceGraph.js    그래프 시뮬 루프·냉각·드래그 — 연결 지도와 그래프 뷰 한 벌 · 호버 공장 `hoverProps`(§4.9)
src/hooks/useMinuteTick.js    상대 시간 라벨 늙히기(§4.9)
src/hooks/useEnterStagger.js  순차 등장은 첫 마운트만(§4.2)
src/hooks/useDismiss.js       바깥 누름·Esc 닫기 한 벌 — 포털로 나간 목록도 refs에 넣는다(layout·groupsParts·worshipPassage)
src/hooks/useProjectYear.js   고른 연도 모듈 스토어 — 지도·프로젝트 진행·탭 줄이 같은 값을 본다(§4.9)
src/hooks/useSheetShare.jsx   종이를 미리 구워 두는 훅 + 마지막 갈래 overlay(§6-32-g·32-s·32-m)
src/components/layout.jsx     TopNav / MobileTopBar / MobileTabBar / ProfileMenu / SearchBox / NotificationBell
src/components/boards.jsx     칸반 보드(dnd-kit) — 카드·상태 칩·컬럼·DragOverlay(§6-1·§6-10~12-c)
src/components/calendar.jsx   캘린더(주 단위 행) — 띠 배치·모바일 달력·날짜 옆 생일 얼굴(§4.8·§6-13~15)
src/components/depgraph.jsx   프로젝트 '그래프' 보기 — useForceGraph 공용(§4.9)
src/components/Avatar.jsx     사람 동그라미 — 사진 없으면 이름 첫 글자(§4.7)
src/components/buttons.js     주 버튼 두 단 — BTN(작은 단) · BTN_CONFIRM/_QUIET(확정 단) · 비활성 opacity .4(§8 · D9)
src/components/ConfirmPopover.jsx  삭제 확인 팝오버 + useAnchoredPos(위치 공용 훅 · §6-17)
src/components/dropCollision.js dnd-kit 놓을 곳 — 포인터 기준(보드·동아리 카드·모바일 탭 · §6-11)
src/components/DatePicker.jsx 노션 톤 데이트피커 — children·triggerClassName·allowClear · `yearless`(명단 생일)
                              **달력은 body로 포털된다**(2026-09-22) — 검사는 `[data-datepicker]`를 **문서에서** 찾는다(트리거 안이 아니다)
src/components/DocEmbed.jsx   구글 문서·시트·슬라이드를 앱 안 iframe으로(판정·주소는 services/docEmbed.js · §6-29-z-6)
src/components/ErrorBoundary.jsx  오류 화면
src/components/FilePreviewModal.jsx  첨부 미리보기 창 — 갈래 판정은 services/previewKind.js(§6-29-c)
src/components/fileRow.jsx    파일 한 줄의 크기·종류 표기 — 업무 첨부와 주보 송폼 공용
src/components/linkIcons.jsx  참고 링크 앞의 서비스 표시(커밋된 path · §4.2)
src/components/links.jsx      프로젝트 헤더의 참고 링크 부품 — PinnedLinkChip·LinkAddPopover·useLinkAccess·LinkPwFields(§6-35)
src/components/LoginScreen.jsx 로그인 화면(라이트 고정 hex · 로고 preload — §6-29-z-5)
src/components/MarkdownEditor.jsx  TipTap 편집기 — 서식 바·sticky·LockedHeadings·frame(§6-32-o·32-p·§6-9-aa)
src/components/media.jsx      이미지·영상·소리 미리보기
src/components/MentionInput.jsx  @멘션 자동완성 — 댓글·답글 공용(§4.11)
src/components/OfficeView.jsx 워드·PPT 미리보기 **폴백**(구글 사본이 있으면 안 쓴다 · §6-29-y)
src/components/paper.jsx      **종이** — PaperMast·PaperNoteHead·PaperSheet·NotePaper·NoteSheet·ServiceSheetOne/Two(§6-32-p)
src/components/PdfView.jsx    pdf.js 미리보기 — cmaps 없이는 한글이 빈다 · 폭이 바뀌면 다시 그린다(§6-29-z-9)
src/components/RichText.jsx   본문 렌더 — InlineLink가 앱 안에서 연다(§6의 본문 링크 항목)
src/components/roster.jsx     (v2) 청년 명단 — 연도 세그먼트·직분 6종·계정 연결(0043) · `RowSkeleton`·`rowDelay`(멤버 화면도 쓴다)
src/components/ShareButton.jsx  프로젝트·카드 공유 링크
src/components/ShareToggle.jsx  공유 토글 한 벌 — 말씀 묵상·예배 노트·내 순 노트가 같은 부품
src/components/sunGuide.jsx   (v2) 순모임 가이드 패널 — 주보 피커·이미지로 공유·고정(§4.4·§6-9-av)
src/components/Toast.jsx      토스트(`[data-toast]` · 폭 상한 28rem · §8)
src/components/wordBible.jsx  (v2) 성경 리더 — 본문|북마크|형광펜 · useVersePaint · searchHeads(§6-9-bs)
src/components/worshipDetail.jsx  (v2) 주보 상세·편집·발행 · 송폼·큐시트 · 내 예배 노트 · useFillRest(§6-9-h)
src/components/worshipPassage.jsx (v2) 본문 선택 피커 + PassageBody(§6-9-j)
src/components/worshipAttendance.jsx (v2) 출석 체크 — 순별 칩·손님 · 13:30 게이트(§6-19-c)
src/components/groupsSun.jsx  (v2) 내 순 · 순 편성
src/components/groupsClub.jsx (v2) 동아리 카드·신청·리더 도구·dnd 순서(§6-9-bi)
src/components/groupsParts.jsx (v2) 모임 공용 — CARD/BTN/FIELD · PersonPick·MenuPick(§6-9-an·33-a) · useSettled(§6-9-ad) · 읽기 실패 자리 FailTail·FailLeft(D2 · §6-24-g)
src/components/ClubQr.jsx     (v2) 동아리 신청 QR 카드(§6-29-z-7)
src/views/views.jsx           DashboardView / ProjectView / MyTasksView / TeamView / ScheduleView / TeamFilterBar
src/views/dashboardParts.jsx  여러 화면이 쓰는 부품 — 마감 구간·KpiCell·Bar·PeopleStrip(§4.8)·ActivityFeed·NetworkMap(§4.9)
src/views/membersView.jsx     전역 '멤버'(관리자) — [가입자 | 청년 명단] · 접속 표시는 스토어를 겹쳐 쓴다(§4.8)
src/views/homeView.jsx        (v2) 홈 — 인사말 + 카드 넷. 자기 저장 자리가 없다(§6-9-x·9-r·9-s)
src/views/worshipView.jsx     (v2) 예배 — 주보 목록 → 상세/작성/발행 → 출석
src/views/wordView.jsx        (v2) 말씀 — [QT | 성경 읽기] · 내 묵상은 저장하면 종이 · 나눔은 사람 칩 + 종이 하나(§6-32-p·19-b·19-b-1)
src/views/groupsView.jsx      (v2) 모임 — 내 순 · 동아리 · 순 편성
src/modals/modals.jsx         업무 창 — TaskModalShell·TaskViewer·TaskEditor·SubtaskList·담당자·선행 업무(§4.9)
src/modals/attachments.jsx    업무 창의 첨부 구역 — 업로드·미리보기·삭제·구글 사본 편집 자격(§6-34-h · startUploads는 §6-29-u)
src/modals/comments.jsx       업무 창의 댓글·반응·활동 기록 패널(§4.11)
src/modals/settings.jsx       내 정보(사진·이름·팀) / 프로젝트 만들기·이름 수정(§4.7·§6-34-g)
src/services/supabaseClient.js 클라이언트 한 벌 + setWriteObserver(§4.8) + myUid()(§6-34-d)
src/services/cloud.js         Supabase 읽기·쓰기 — 업로드는 `uploadOwnedFile` 한 벌(업무·주보가 같이 쓴다)
src/services/cloudSync.js     모양 변환 + 실시간 라우팅 + 알림 만들기(§6-21·21-a·29-a)
src/services/auth.jsx         OAuth — 로그인 전 자리 기억·카카오 인앱 자동 시작(§6의 auth 항목)
src/services/approval.js      승인 확인 **서버 전용** 한 벌 — api/drive*.js가 쓴다(합친 계정은 남긴 계정 칸 · §6-34-i)
src/services/domain.js        TaskService·ActivityService(§6-28)
src/services/presence.js      지금 접속한 사람 — 워크스페이스 스토어 밖 미니 스토어(§4.9·§6-24-b)
src/services/liveV2.js        v2 실시간 — 채널 하나 · 표 → 캐시 접두 · useLiveRefresh(§6-24-a) · 홈 접두 넷은 homeView와 맞춘다(logcheck)
src/services/realtimeBatch.js 카드 실시간을 200ms 모아 id마다 한 번 — 순수 모듈(App.onCard)
src/services/cache.js         화면 데이터 캐시(메모리+localStorage, 사용자별) · useCached(§6-24-d·24-e·24-f)
src/services/entryQuery.js    진입 주소의 나머지 값을 모듈 첫 실행 때 붙잡는다(§6-24-c)
src/services/ai.js            Gemini 프롬프트·컨텍스트·요약 캐시 · 명단 한 벌 10분 쥐기 — 배경 지식 원본은 `docs/AI.md`(§4.4·§6-43~46)
src/services/aiPeople.js      AI 사람 줄 순수 모듈 — role_note 직함 가르기·직함 고르기(pickTitle)·글에 나온 가입자(mentionedMembers)
src/services/cueDigest.js     큐시트 → 가이드 요지(주제·전례색 + 설교·결단 칸 · 인용문 버림) — 순수 모듈, 앱과 백필이 같이 쓴다
src/services/bibleSearch.js   AI 본문 검색 순수 모듈 — 참조만 받는다(§6-9-ar) · 한 번에 30줄(AI_HIT_LIMIT) · `aiBibleSearchOutcome`의 failed = AI를 못 물음(§6-46-e)
src/services/vecSearch.js     뜻 검색 결과 → 화면 줄 순수 모듈 — 와/과 · 조각 발췌 · 업무 묶기(relatedTasks) · 성경 대체 줄 — logcheck가 검사
src/services/semantic.js      뜻 검색 왕복 — /api/ai { embed } → match_docs·match_bible · 물음별 메모리 캐시 · 게스트는 semanticOn=false(네트워크 0)
src/services/actionItems.js   회의록의 '누가 · 무엇을 · 언제까지' 읽기 — 순수(import 0). 다듬기 프롬프트(ai.js 예시 3)와 모양을 맞춰 둔다
src/services/sunGuide.js      순모임 가이드 — 프롬프트·JSON 파싱·fitGuide·sun_guides(§4.4)
src/services/notifyText.js    알림 문구 — 앱과 api/push.js가 같이 본다(§4.3)
src/services/push.js          브라우저 구독 켜기/끄기(§6-30)
src/services/image.js         올리기 전 축소(첨부 2560px · 본문 1600px · 아바타 256px · §6-29-m)
src/services/fileText.js      첨부에서 글자 뽑기(검색·AI가 읽는다) — PDF 워커는 미리보기와 한 벌(pdfWorkerEntry)
src/services/textQuality.js   뽑은 글이 글인가 · HTML에서 글만 — 순수 모듈, 앱과 백필 스크립트가 같이 쓴다
src/services/ooxml.js         zip 풀기 + XML 훑기 — xlsx·docx·pptx 공용, 의존성 0(§6-29-c-2·29-z)
src/services/xlsx.js docx.js pptx.js  엑셀·워드·PPT 읽기(tests/sheet·office가 검사 · §6-29-w·29-x)
src/services/previewKind.js   첨부 미리보기 갈래 판정 — 순수 함수(§6-29-z-2)
src/services/pdfPolyfill.js   pdf.js 6이 그냥 쓰는 최신 API 채우기 — 없으면 옛 브라우저(iOS 18…)에서 PDF가 통째로 막힌다(§6-29-z-15)
src/services/pdfWorkerEntry.js pdf.js 워커 껍데기 — 그 폴리필을 **워커보다 먼저** 돌리려고만 있다(§6-29-z-15)
src/services/docEmbed.js      구글 임베드 판정·주소 — 순수 함수(§6-29-z-6)
src/services/viewPw.js        화면 가림 비밀번호 순수 모듈 — cloud.js를 import하지 않는다(§6-31-f·9-bp)
src/services/markdown.js      마크다운 왕복 — RichText와 한 쌍(mdcheck)
src/services/titleText.js     유튜브 제목 평문화 — 앱과 api/yt.js 두 곳(§6-9-ah)
src/services/errorText.js     오류 코드 → 사람 말(§6-29-e · §8)
src/services/shareImage.js    종이를 그림·PDF로 — nodeToPng·bakeAndSlice·shareOrSave·isBlankCanvas(§6-32-*)
src/services/people.js        (v2) 명단·모임 읽기 공용 + guestStore(게스트 저장 자리 공장) · `byName`(이름순 한 벌)
src/services/roster.js        (v2) 명단 쓰기·계정 연결(§6의 roster_name 항목)
src/services/worship.js       (v2) 주보·출석·노트·자격(§6-9-ak) · recentSongs(최근 8주 곡+링크) · prefillRoles(지난 주보 **광고**의 '다음 주 예배 위원' → 대표기도·헌금봉헌, 같은 kind만)
src/services/word.js          (v2) QT 일정·묵상·bible_state · shouldAdoptBody(§6-24-c)
src/services/groups.js        (v2) 순·동아리·신청·모임·groupPerms · share()로 중복 조회 묶기(§6-9-bg)
src/services/bible.js bibleRef.js  (v2) public/bible 로더·캐시 / 구절 파서 — 주보·QT·리더가 한 벌(§6-9-aq)
src/services/noteTemplate.js  (v2) 노트 템플릿·LEGACY_SECTIONS·isTemplateOnly·ensureNoteSections(§6-9-as·32-l)
src/assets/                   SUIT 서브셋 + symbols(보조 글꼴) + 로고 — 생성 스크립트는 scripts/(§4.2·§6-9-au)
api/_lib.js                   api 공용 머리 — readJson·requireApprovedUser·safeEqual·sameOriginPath. `_`로 시작해 라우트가 아니다(dev도 건너뛴다)
api/ai.js                     Gemini 프록시(25초에 끊는다 · §6-9-bn) · `{ embed }` 질문 임베딩 — EMBED_MODEL·unitVec을 스크립트·_docsync가 가져다 쓴다
api/_docsync.js               업무·댓글·첨부 → doc_vec 증분(조각·해시·계획·임베딩) — 8시 크론·?job=embed·스크립트 한 벌
api/push.js                   POST=앱 알림을 푸시로 / GET=마감 임박·오늘 예배 배치(`?job` · §4.3) · 8시 뒤 문서 임베딩 · `?job=embed`
api/drive.js                  Apps Script 프록시 — 업로드·폴더·휴지통(55초에 끊는다 · §6-29-f·29-g)
api/drive-file.js             드라이브 파일 바이트 중계(앱 안 뷰어용 · §6-29-c·29-z-3)
api/share.js                  공유 링크 OG 메타 — 조회 `error`를 반드시 읽는다(§6-31-d·31-e)
api/yt.js                     유튜브 재생목록·제목 중계(ai.js와 같은 Bearer 인증)
vite.config.js                dev 전용 `/api/<name>` 미들웨어(게스트 모드 제외 · §6-29-z-4) + pdf.js 보조 자료를 `/pdfjs/`로(§6-29-z-9)
                              + 첫 화면 벤더 칸 `EAGER_VENDORS` — 통째로 묶으면 첫 화면이 2배(§6-29-z-18)
public/sw.js                  서비스 워커 — 푸시 표시 + 클릭 시 딥링크. 캐싱은 하지 않는다
public/bible/                 (v2) 개역한글 66권 json + index.json
public/chars/                 (v2) 캐릭터 5컷(webp · @2x 포함 10장) — 홈(sparkle-wave·heart·book·coffee·laptop) · 말씀(book) · 예배 노트(heart).
                              원본(177~225px) 이상으로 키우지 않는다. 새 컷은 원본 시트(레포 밖 `Desktop/church_workspace_design/chars.png`)에서 다시 자른다
public/ 그 밖                 아이콘·매니페스트·OG·스크린샷
scripts/subset_suit.py subset_symbols.py make_icons.py  폰트·아이콘 생성(한 번 돌리고 결과물을 커밋)
scripts/drive_check.mjs       드라이브 ↔ DB 어긋남 점검(`--fix`를 붙여야 고친다 · §6-29-j)
scripts/migrate_to_drive.mjs reset_drive_migration.mjs backfill_sheet_preview.mjs  이관·되돌리기·사본 백필
scripts/bible_check.mjs       성경 json 정합 검사(tests/bibleref와 짝)
scripts/backfill_attachments.mjs  옛 첨부 발췌 백필 — 문서는 앱 파서, 사진·글자 없는 PDF는 Gemini(`--fix`를 붙여야 적는다) · `--cuesheet`는 큐시트 요지(Gemini 없음)
scripts/embed-bible.mjs       성경 → bible_vec 한 번(로컬 · --dry-run · 이어하기)
scripts/embed-docs.mjs        doc_vec 전체·증분 · --dry-run(조각·토큰·비용) · --kind
scripts/compare-bible-search.mjs  AI 검색 대 벡터 검색을 질의 30개로(한 번 쓰고 만 도구 · §7의 근거)
supabase/migrations/          0001~0074 — 표는 README, 최근 것은 §5
tests/                        검증 스위트 + 러너 — 목록은 tests/README.md
```

업무 창 네 파일은 `modals.jsx`가 `attachments.jsx`·`comments.jsx`를 쓰고 `settings.jsx`는 App이 직접 가져온다. **새 전역 화면을 만들면 `App.jsx`의 `GLOBAL_MENUS`에 넣으세요** — 없으면
프로젝트 id로 오해돼 대시보드로 튕긴다. 안에서 스크롤하는 화면(보드·달력)은 `needsFullHeight`에도 넣어야 높이가 확정된다(§6-2).

## 5. 데이터 · 스키마 · 비밀

- **마이그레이션 번호별 표는 `README.md`에 하나만 둔다.** 스키마는 `supabase/migrations/0001~0074`이고 **전부 라이브 DB에 적용**되어 있다. 최근 것: **0063** 0061이 남긴 나머지 `auth.uid()` 자리를 `alter policy`로(§6-34-i) ·
  **0064** `people.gender` · **0065** `bible_state.recent_searches` · **0066** 개인 표 기본값도 `effective_uid()` · **0067~0070** 명단(`people`)의 생일·소속·교역자·대표 팀을 트리거가 계정으로 옮긴다(§8) ·
  **0071** 칸 가드(승인·합치기·이메일은 관리자·서버만 · 작성자 칸 · 알림 이름 — 되돌리기만 하고 오류는 안 낸다. `auth.uid()`가 없으면(psql·서비스 키·가입 트리거) 통과하므로 백필은 그대로 먹힌다) ·
  **0072** `files.name`을 NFC로(데이터만 · 되돌릴 수 없고 되돌릴 까닭도 없다) ·
  **0073** pgvector(`extensions`) + `bible_vec`(halfvec 768) + `match_bible` · **0074** `doc_vec`(업무·댓글·첨부 조각 · 원본 FK cascade) + `match_docs` — 둘 다 벡터 인덱스 없음. 다음 번호는 0075.
- **`npx supabase db push`를 쓰지 마세요.** 원장(`supabase_migrations.schema_migrations`)에는 0038까지만 적혀 있어서 dry-run이 0039부터를 "적용할 것"으로 잡는다. 새 파일은 `psql
  "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<파일>`로 넣는다.
- **적용 여부는 원장이 아니라 실제 객체로 확인한다**(컬럼·함수·정책·발행 목록). 되돌리는 SQL은 파일 맨 아래 주석.
- **값을 손보는 UPDATE는 `cards`의 트리거를 끄고 돌린다**(`trg_cards_updated_meta`) — `updated_at = now()`가 무조건 걸려서 백필 한 줄이 완료 카드 28건의 날짜를 밀었다. **before update 트리거에서
  `new.X = old.X`를 쓰지 마세요**(그 컬럼을 직접 고치는 UPDATE 전부가 무력화된다 — 0033의 백필이 자기 트리거에 덮인 이유).
- **RLS 경계 요약**: 모든 내용 표에 `is_approved()`(0022) · 관리자 원본은 `admins` 표 하나 · 지정·해제는 `is_master()`(0029) · 프로젝트 삭제는 전원(0021) · 주보 쓰기
  `can_edit_service()`(0042·0045) · 전체 출석 `can_check_all_attendance()`(0045) · 순 관리 `can_manage_sun()`(0039·0045) · 개인 표
  셋(`service_notes`·`qt_entries`·`bible_state`)은 `effective_uid()`(0061) · 비관리자는 `profiles`의 승인·환송·`merged_into`·`email` 칸과 작성자 칸을 못 바꾼다(0071 트리거가
  **조용히 옛 값으로 되돌린다** · §6-31-h) · storage 올리기·읽기도 `is_approved()`(0071) · 임베딩 표 둘(`bible_vec`·`doc_vec`)은 읽기만 `is_approved()`, 쓰기 정책 없음(서버 키) — **원본보다 넓게 읽히게 되는 것(주보 첨부·개인 표)은 넣지 않는다**(§6-31-j). 자세한 것은 §4.5·§6-31-a.
- **permissive 정책은 OR다** — 좁히려면 새 정책을 더하지 말고 있는 정책 안에서 `and`로 감싼다(§6-31-a). `replica identity full`은 켜지 마세요(DELETE는 RLS로 걸러지지 않아 지워진 비공개 묵상이 모두에게
  나간다).
- **비밀 값은 이 문서에 없고, 앞으로도 넣지 마세요.** 서버 전용(`VITE_` 접두사 금지): `GEMINI_API_KEY` · `SUPABASE_SECRET_KEY` · `VAPID_PRIVATE_KEY` · `CRON_SECRET` ·
  `DRIVE_WEBAPP_URL` · `DRIVE_WEBAPP_TOKEN` (Production·Development 등록 완료, **Preview는 아직**) · `YOUTUBE_API_KEY`(없어도 앱은 돈다). 값은 Vercel 환경변수와 로컬
  `.env`에만(`.env`·`.env.guest` 모두 gitignore) · 변수 목록은 `README.md`.
- **첨부는 전부 구글 드라이브다**(2026-08-26 이관 완료 · 구조 `더다붓 워크스페이스/프로젝트/업무/파일`) — 자세한 것은 `docs/DRIVE.md`. `attachments` 버킷은 0개이고 큰 파일이 드라이브로 갈 때만 잠깐
  들른다(§6-29-o). 본문 이미지·프로필 사진은 여전히 Storage(`content-images`)가 원본이다(§7).
- **Storage 삭제는 휴지통이 없어 되돌릴 수 없다** — 지우기 전에 ① `migrate_to_drive.mjs` 옮길 것 0건 ② `drive_check.mjs` 어긋남 0건 ③ `files`에 `source='storage'` 0건 세 겹을 확인한다.
- 오피스 미리보기는 **서명 URL이 마이크로소프트로 전달**된다(UI에 표기 · `OFFICE_VIEWER = false`로 끌 수 있다).
- 어드바이저 경고 둘은 **의도해서 남긴 것**이다: `is_admin()`을 로그인 사용자가 실행할 수 있는 것(정책 평가에 필요하다) · Leaked Password Protection(OAuth만 쓰므로 저장하는 비밀번호가 없다).

## 6. 함정

- 함정과 구조 색인은 **[`docs/PITFALLS.md`](docs/PITFALLS.md)** 에 있다.
- **그 파일을 만질 때 해당 번호만 읽으면 된다** — 전체를 읽을 문서가 아니다.
- 코드 주석의 `§6-N`·`§4.N`은 **그 문서의 번호**다(번호를 바꾸거나 중간에 끼우지 마세요).

## 7. "다시 제안하지 말 것" (사용자가 판단해서 뺀 것)

| 항목 | 이유 |
|---|---|
| 주간 브리핑(AI) | 품질 검증을 먼저 하기로 |
| 순(조직) 정보 | 2026-09-01 v2로 대체 — 살아 있는 부분은 **순별 업무 보드는 만들지 않는다** 하나 |
| 카카오 알림톡·친구톡 | 템플릿 사전 심사·발송 대행사가 필요하고 심사 문구에 갇혀 §8의 톤을 못 쓴다. 웹 푸시로 해결 |
| 반복 업무 | 지금은 아니라고 정했다 |
| 로티·외부 JSON | 빈 상태는 SVG 선 그리기(`dc-draw`)로 간다 |
| 마감일 필수화 | 강제하면 아무 날짜나 넣어 '지연' 숫자가 거짓이 된다. 마감 미정 구간 + 2주 방치 표시로 해결 |
| 공유·삭제를 모바일 상단바로 | 아이콘이 일곱 개가 되어 번잡하다. 자리는 §4.6대로 링크 줄 밖 |
| 한 줄 유지 + 메타 줄만 옆으로 밀기 | 삭제가 화면 밖으로 밀린다 — 가로 스크롤로 §8을 다시 어기는 모양 |
| 프로젝트 헤더 2단 배치(`2/3`을 크게) | 링크가 없어도 항상 두 줄이고 아래 상태 칩이 같은 값을 또 센다 |
| 「이거 제가 할게요」 자기 배정 버튼 | 2026-08-27에 뺐다 — "내가 시킨 게 아니잖아". 담당자 지정은 업무 창에서 |
| AI 업무 쪼개기 | 2026-08-29에 뺐다 — "제발 언급 그만해" |
| 랭킹·점수·배지·스트릭 | §8의 "누가 누구와 견주는 구조를 만들지 마세요"와 정면으로 부딪힌다 |
| 최근 활동을 '내 업무만' 보기 | 이 칸의 값은 남들이 움직이는 게 보이는 것이다 |
| 카드별 조회 추적 | 같이 사역하는 사람들이 쓰는 화면에서 감시처럼 읽힌다. `last_seen_at` 한 칸이 정직한 중간 |
| 미가입자 명단으로 생일 관리 | (당시) 넣을 행이 없었다 — **v2의 `people`(0035)로 풀렸다** |
| 커밋 날짜를 고쳐 잔디 채우기 | 어시스턴트가 거절했다(방법 안내도 하지 않는다) |
| 첨부를 **진짜로** 잠그기 | 진짜 잠금과 펼쳐보기는 동시에 가질 수 없다 — 화면 가림을 골랐다(0023) |
| 본문 이미지·프로필 사진을 드라이브로 | 이미 줄여 저장하고, 본문 이미지는 주소가 글 안에 박혀 저장된다 |
| 드라이브 파일명을 `업무_파일명`으로 | 업무별 폴더로 바꿨다 — 이름을 안 건드려서 앱 화면이 지저분해지지 않는다 |
| 미등록 출석자를 청년 명단에 자동 등록 | 2026-09-07 — "청년 명단 등록은 마스터가 얘기할 때만". 손님은 `attendance_guests` |
| '내 순에 공유된 노트'에 내 비공개 노트를 잠금 표시로 | 2026-09-07에 뒤집혔다 — `shared_to_sun = true`만 |
| 큐시트에 비밀번호 | 2026-09-08 — "큐시트는 비밀번호 안 걸어도 돼". 비밀번호는 첨부·참고 링크에만 |
| Drive API 직접(서비스 계정·OAuth 위임)으로 Apps Script 대체 | 서비스 계정은 개인 드라이브에 파일을 소유할 수 없고 OAuth 위임은 구글 심사 대상 |
| 노트 도막 제목에 잎 그림 | 2026-09-09에 뺐다 — `tests/word`가 **없어야 한다**로 단정한다 |
| 노트 도막 '본문' | 머리에 구절이 있어 2026-09-12에 뺐다 — 옛 노트의 도막은 `LEGACY_SECTIONS`로 살아 있다 |
| 나눔을 사람마다 줄로 쌓기(접힌 요약) | 2026-09-13에 뺐다 — "그 종이 전체를 보여줘야지 … 쌓이지 않는 구조가 중요". 지금은 **사람 칩 한 줄 + 종이 하나**다(§6-19-b-1) |
| 노트·주보 종이를 순모임 가이드 종이처럼 | "디자인 템플릿이 너무 똑같잖아" — 가이드 종이는 사용자가 준 템플릿이라 그대로 둔다 |
| 주보 종이에 캐릭터 컷 | 설교 본문이 실리는 공식 문서다(`tests/worship`이 단정) — **노트 종이에는 한 컷 붙인다** |
| 주보를 이미지 두 장으로 카카오톡에 | 카카오 인앱 웹뷰에 공유 시트가 없어 내려받기로 떨어진다 → **PDF 한 파일** |
| 발행된 주보에서 탭을 걷고 종이만 남기기 | 종이에는 유튜브 링크·구절 잇기가 없다 → '주보' 탭을 맨 앞·기본 탭으로 |
| 첨부를 **링크를 아는 누구나**(anyone) 편집 | 드라이브는 워크스페이스 멤버인지 모른다 — 주소를 아는 사람 전부가 고칠 수 있다. **계정 단위**(올린 사람+마스터+관리자)로는 2026-09-11에 열었다(Apps Script v11 `editors`·`grantEditors` · §6-34-h) |
| 달력에서 업무 만들기를 '전체 일정'에도 | 거기에는 프로젝트가 없다 — **프로젝트 캘린더에만**(2026-08-24) |
| 본문 에디터의 슬래시 메뉴 | 접고 **툴바 버튼**(체크리스트·h3·h4)으로 정했다(2026-08-24) |
| 연도 폴더를 별도 화면으로 | 더보기 메뉴가 연도 폴더(진행 중 + 보관)고 탭줄은 유지한다(2026-08-24) |
| 수요 예배 | **하지 않는다** — AI 배경 지식·화면 문구에 넣지 말 것(예배는 주일 4부 청년 예배·금요 열정 예배) |
| Gemini 모델 교체 | `3.1-flash-lite` 유지. 2026-08-29 A/B 6회(3.5는 호칭 '님'을 빼먹었다)에 이어 **2026-09-25 A/B**(3.1-lite 대 3.5-flash-lite 각 30회): 3.5-lite는 '님'을 30번 중 5번 빼먹고 · 가이드 JSON이 깨지고 · 기한을 지어냈다. 새 A/B 근거 없이 제안 금지. **다음 A/B는 두 lite 모델로만, 부르기 전에 비용을 먼저 말한다**(그날 3.5-flash·3.8-flash까지 불러 지적받았다) |
| 카카오 SDK 공유 | 하지 않는다(2026-09-25). PDF는 기본 공유창으로 카카오톡에 파일째 가고 업무·프로젝트 링크는 `/s/` 공유 주소가 카드로 뜬다 — 기본 공유창이 없는 곳은 카카오 인앱뿐이다. JS 키는 받아 두었다(쓰지 않으므로 값은 적지 않는다) |
| 벡터 성경 검색을 AI 검색 대신으로 | 2026-09-25 질의 30개 비교(`scripts/compare-bible-search.mjs`)에서 못 이겼다 — AI 줄 평균 11.7 중 벡터 top-30과 겹친 것 5.9, 벡터는 낱말이 닮은 절을 가져왔다(욥 27:20 같은). AI 검색이 앞이고 벡터는 실패 시 대체·후보 추리기 후보(§2) |
| 팀장 칸(DB) | AI가 업무 팀의 팀장을 고르는 데는 `role_note`의 `OO팀장`을 읽는 것으로 같다(스토어에 있어 네트워크 0) — 칸을 따로 두면 role_note와 두 곳이 어긋난다(회계 절차를 베꼈다 어긋난 것과 같은 구조) |
| 서식 바를 모바일에서 키보드 위 고정으로 | 2026-09-11에 하루 안에 `bottom`→`top`→`body` 포털까지 갔는데 실기기 아이폰에서 끝내 키보드 위에 안 섰다 — **되돌렸다**. 모든 폭에서 sticky-top 하나다(§6-9-aa-4) |
| 노트 도막을 세 줄(4rem)로 벌리기 | 2026-09-18 하루 안에 넣고 뺐다 — 글을 쓰면 줄 간격이 벌어져 "노트가 완전 난리". 도막은 한 줄, 빈 자리는 종이 아래 한 덩어리(2026-09-03) |
| 폰에서 PPT를 우리 렌더러(`services/pptx.js`)로 | 2026-09-18 — "구글 화면으로 해달라니까", 폰트가 깨진다. 폰은 `/preview`, 데스크톱은 `/embed` |
| 계정 통합 기능 | 2026-09-14 — "지금 내가 하듯 멤버 화면에서 합칠게". 이메일이 같으면 Supabase가 이미 한 계정으로 잇는다 |
| 성경 66권 미리 받기(`bible.js` `warmBooks`)를 뒤로 미루기 | 2026-09-08 사용자 지적으로 넣은 것이다 — `tests/word`가 단정한다 |
| SUIT 폰트를 조각으로 나누기 | 한 번 해 보고 되돌렸다 — 근거는 `scripts/subset_suit.py` 머리말 |
| 인라인 그림자를 `shadow-elevated`로 바꾸기 | 값이 달라 모양이 바뀐다(`views.jsx`) |
| 화면 문구·title의 엠 대시를 하이픈으로 | §8의 대시 금지는 **AI가 만든 문장**에만 걸린다 |
| 드라이브 502에 원문을 싣지 않기 | 아는 코드가 없으면 원문이라도 보여준다(§6-29-e) — `tests/drivesync`가 지킨다 |
| 읽기 실패를 토스트의 '다시 시도'로만(D2-b) | 2026-09-25 목업 — 토스트가 사라지면 그림도 글도 없는 빈 칸만 남는다. 실패는 빈 자리에 선다(§8) |
| 뜻 결과를 글자 결과 0건일 때만(G-b) · 뜻 검색을 안 붙이기(G-c) | 2026-09-25 목업 — 제목 한 건만 걸려도 뜻 결과가 숨고, 클라우드에서는 댓글·첨부가 열어 본 업무에만 있다 |
| 성경 벡터를 AI 아래 접힌 구역으로(S-b) · 프롬프트 후보 추리기로만(S-c) | 2026-09-25 목업 — 낱말 도막과 같은 말이 두 번 서고, 후보를 좁히면 AI가 이긴 이유(목회적 구절)를 스스로 깎는다 |
| 하위 업무에 '위로 올리기'(담당 업무로 되돌리기) | 2026-09-24 — 줄마다 버튼이 늘고 폰 자리가 좁아진다. 잘못 내렸으면 지우고 '＋ 항목 추가' |

## 8. 관례

- **명단 소속 칩에 `순장`·`순원`이 있다**(2026-09-22 사용자 요청 · 상단 `순장` 보드와 대시보드 `팀별 남은 업무`에 서는 것도 의도다). 2026-09-14에는 "명단 화면의 팀 칩에는 안 뜬다"였는데 뒤집었다 — 임원진·교역자와 달리 순 자리는 아래 '직분' 줄이 맡지 않아서 **명단에서 고를 데가 아예 없었다.**
  **`교역자`는 같은 날 넣었다가 사용자 결정으로 도로 뺐다** — 직분 줄에 이미 있어서 같은 글자가 두 줄에 섰다(`tests/roster`가 엉뚱한 칩을 눌러 깨졌다). 계정 쪽 소속의 교역자는 **직분 토글이 정한다**(0069).
- **명단에서 고친 소속은 트리거가 계정으로 옮긴다**(0068). `people.teams`(명단)가 원본이고 `profile_teams`(계정)가 따라간다. **`임원진`은 손대지 않는다** — 명단이 고를 수 없는 이름이라, 같이 밀면 6명의 임원진이 통째로 지워진다. 일괄 백필도 안 했다(어느 쪽이 맞는지는 사람이 안다).
- **명단에서 고친 생일은 트리거가 계정으로 옮긴다**(0067). 생일은 `people`(명단·미가입자 포함)이 원본이고 달력은 `profiles`를 읽는다. **이름·사진은 반대로 잇지 않는다** — 계정 표시 이름은 본인이 정하고(꽃님·진우·현민스) 명단은 본명이라(강꽃님·문진우·배현민) 한쪽으로 덮으면 사용자가 정한 이름이 사라진다.
- **다음 주 예배 위원은 광고에 적는다**(2026-09-22에 라이브 주보로 확인). 주보의 `roles`는 **그 날 섬긴 사람**이고, 다음 주에 섬길 사람은 광고 `다음 주 예배 위원`에 `대표기도: 이수빈 형제` 모양으로 적힌다. 그래서 새 주보의 임사자를 미리 채울 때
  **지난 주보의 roles를 물려주면 언제나 한 주 밀린 이름이 앉는다** — `worship.prefillRoles`가 광고를 읽는 이유다. 역할·제목의 띄어쓰기는 주보마다 다르다(`대표 기도`도 있다).
- **떠 있는 것(팝오버·달력·목록)은 포털로 내보내고 뷰포트 안으로 가둔다.** `useAnchoredPos`(ConfirmPopover가 내보낸다)를 쓰면 가로·세로 둘 다 갇히고 키보드가 올라와도 따라온다. `absolute`로 두면 좁은 화면에서 화면 밖으로 나가거나 `overflow` 있는 상자에 잘린다 — DatePicker가 그렇게 2026-09-22까지 남아 있었다.
  **그러면 검사의 선택자도 같이 바뀐다** — 트리거 안에서 찾던 것을 문서에서 찾아야 한다(그때 `worship`·`roster`가 같이 깨졌다).
  **`animate-in … duration-150`을 붙이면 `transition-none`도 같이 붙인다**(PITFALLS 17-b) — 안 붙이면 첫 배치에서 화면 구석부터 미끄러져 들어온다(2026-09-24에 일곱 곳이 빠져 있었다). 달력처럼 줄 앞쪽에 서는 좁은 트리거는 `align:'start'`.
  **자동완성·검색 결과 목록도 같다**(2026-09-24에 다섯 곳을 옮겼다). 바깥 누름으로 닫는 자리는 **포털 목록 ref를 '안'에 같이 넘긴다**(`useDismiss(open, close, [rootRef, listRef])` · PITFALLS 17-d). 목록 줄 수가 바뀌면 `place()`를 다시 부른다. `opts.prefer: 'above'`(멘션)는 위가 모자라고 아래가 더 넓을 때만 아래로 선다.
  `useAnchoredPos` 옵션: `minWidth`(matchWidth 폭의 아래 한계 · 상단 검색 320) · `fitHeight`(고른 쪽에 남은 높이를 `pos.maxHeight`로 — **estHeight를 판의 max-h로 넘긴다** · 지금은 성경 최근 검색어만).
  **z 자리**: 토스트 z-130(포털 창 z-100 · 공유 시트 z-120 위) · 떠 있는 목록 z-90 · 데스크톱 검색 결과만 z-80(`tests/mobbits`가 body의 첫 z-[90]을 프로필 메뉴로 본다) ·
  모바일 검색 판은 body 포털 z-50 — **상단바 안에 fixed 판을 새로 두지 말 것**(상단바가 flex 항목 z-20이라 안의 판이 탭바 z-40 밑에 깔린다 · PITFALLS 9-cb).
- **hover로만 드러나는 조작은 `pointer-fine:md:opacity-0`로 숨긴다**(`md:opacity-0` 금지 — 폭만 보면 아이패드에서 기능이 사라진다 · 위 '기능을 숨기지 않는다'). **작은 아이콘 버튼의 누르는 자리**는
  `relative before:absolute before:-inset-…`(배경 없는 가상 요소)로 넓히되 **이웃 조작과의 틈의 절반까지만**(PITFALLS 9-by).
- **주 버튼은 두 단이다**(D9 · 2026-09-25 · `components/buttons.js`): 작은 단 `BTN`(11.5px·600·29px — 도구 줄·입력 줄 옆: 댓글 등록·답글·저장, 새 주보, 가입 신청,
  팝오버의 추가·적용) · 확정 단 `BTN_CONFIRM`(13px·600·40px — 창 맨 아래 확정: 내 정보 저장·시작하기·프로젝트 만들기, 짝 취소는 `BTN_CONFIRM_QUIET`). **비활성은 opacity .4 하나**
  (`disabled:bg-line` 금지 — 라이트 1.41:1). 업무 창 아래 줄(저장·수정·닫기)은 상시 도구 줄이라 두 단 밖이다. 새 accent 버튼은 둘 중 하나를 쓴다.
- **뒤판은 두 값**(D9): 대화창(업무 창·내 정보·프로젝트·동아리 QR·모바일 검색·가입한 사람·댓글 반응)은 검정 50% · 뒤판 fade 150ms · 창 fade+zoom-95 150ms,
  전면 미리보기(파일·문서·사진·그림 저장)는 80% · 150ms.
- **최소 글자 10px · 12px 미만 글은 faint 대신 muted**(D9) — faint는 12px 이상 보조 글·자리표·아이콘에만. 예외는 얼굴 원 안의 머리글자와 종이(인쇄 문서).
  달력 칸은 +N까지 틈 4px로 맞췄다(PITFALLS 9-ce·9-cf).
- **읽기 실패 자리**(D2): 캐시 없는 첫 읽기가 실패하면 빈 자리에 같은 그림 + 그 화면 토스트의 첫 줄 + `errorReason` + '다시 시도'(작은 단)를 세우고 토스트는 띄우지 않는다.
  캐시가 있으면 지난 값을 둔 채 토스트다. '없음'과 '못 읽음'을 상태로 가른다(빈 배열을 앉히지 않는다 · PITFALLS 24-g). 홈은 해당 없음.
- **뜻 검색 문구**(사용자 문구 2026-09-25): 상단 검색 구역 머리 **'관련된 업무 내용'**, 줄 아래 발췌 앞 '댓글 · ' / '첨부 · ' / '상세 내용 · '(아이콘: 업무 초록 · 댓글 파랑 · 첨부 주황) ·
  성경 대체 머리 **'{검색어}와/과 관련된 성경 구절'** — 와/과는 마지막 글자의 받침으로 가른다(`vecSearch.andParticle` · 숫자는 읽는 소리 · 영문은 '와').
  '검색 결과가 없어요'는 그 문구가 서는 자리의 가운데(뜻 구역이 있으면 글자 결과 자리 안). 게스트에서는 뜻 구역을 세우지 않는다.
- **폰 검색 칸의 Enter(키보드 '검색')는 키보드를 내린다**(상단 검색은 늘 · 성경은 coarse일 때만) + `enterKeyHint="search"`.
- **aria-label은 화면에 이미 있는 글자로만** — 자리표 · 바로 위 라벨 · 앱이 쓰는 말(자리표가 `https://...`인 칸은 `주소`, 댓글 고치기 칸은 `댓글 수정`).
- **Enter로 무언가 하는 핸들러는 `utils.imeComposing`부터 본다**(한글 조합 중 Enter는 무시 — `tests/logcheck`가 소스의 모든 Enter 핸들러를 단정한다). 댓글·답글·댓글 수정은 `(pointer: coarse)`에서 Enter가 줄바꿈이고 등록은 버튼이다.
- **읽기 = 편집**(사용자 결정 A1 · 2026-09-25): 노트 읽기 종이와 업무 보기는 편집 화면과 같은 줄에 선다 — 빈 줄은 한 줄, 들여쓰기 유지, 줄 간격은 `.note-paper .tiptap`의 값(주보 종이는 그대로 · PITFALLS 9-aa-11).
  하위 업무 추가 칸은 `px-3`(B2 — 상세 내용 편집기 글과 같은 x).
- **빈 자리 문구**(사용자가 목업에서 25곳을 골랐다 · 2026-09-25): `미지정` · `미입력` · `미등록` · `방문 전` · `이름 미상`처럼 상태를 짧게 — "없어요"로 끝내지 않는다(아래 문구 톤).
- **담당자는 `담당자`라고 쓴다**(2026-09-24 — '맡는 사람'을 바꿨다). 업무 창의 담당자 칸과 같은 말이다.
- **청년별 담당 업무에서 '하위 업무로' 내린 줄은 본문 도막에서 지우고 `cards.subtasks`로 옮긴다**(2026-09-24) — 그 뒤 담당자·기한의 기준은 subtasks 하나다. 다듬기로 같은 제목이 또 뽑히면 `matchSubtask`로 거르고, 다 내리면 위 구역이 사라진다(되돌리는 길은 §7).
- **하단바 '업무' 층의 파랑은 따로 둔 토큰이다**(`--app-work-bar` #3f6fc4 · 사용자가 목업 넷에서 골랐다) — 다크의 accent를 따라가면 흰 글자 대비가 3.4:1로 떨어진다.
- **구글 편집 화면(iframe)은 데스크톱에만 싣는다.** 폰은 보기 주소(`/preview` · `authuser` 없이)이고 **슬라이드는 폰에서 iframe을 만들지 않는다**(홈 화면 앱 웹뷰가 죽는다 — 첫 장 그림 + '새 탭에서 열기'). 첨부·본문 링크·큐시트가 같고, 머리줄 뒷절 문구는 사용자가 정했다(§6-34-h-3).
- **홈 예배 카드는 발행본 중 `service_date`가 가장 최근인 것**(미래 포함 · 시한 없음)이고 머리 글자는 날짜가 정한다(주를 보지 않는다). 누르면 그 주보 상세로 곧장 간다 — 알림 딥링크와 같은 길이고, 들어오는 동안 목록 없이 상세 스켈레톤이 선다.
- **호칭은 `OOO 형제/자매`**(0064) · 성별이 비면 `청년`. `services/ai.js`의 배경 지식은 `청년` 그대로다(2026-09-14 — 모델이 호칭을 틀릴 자리를 늘리지 않는다).
- **AI의 직함은 코드가 고른다**(2026-09-25 · `aiPeople.pickTitle`): `role_note`가 원본이고 연도 직분(`people_roles`)은 role_note에 직함이 없을 때만 · 순장은 순 업무에서만 · 팀 업무는 그 팀 팀장 ·
  예배팀장은 찬양·엔지니어·워십팀에 걸친 예배 전반(찬양팀장과 다른 자리) · '교역자'는 직함이 아니다(전도사님) · 청년부는 약 55명. 자세한 것은 `docs/AI.md` §2.1.
- **노트 임시 저장은 브라우저다**(서버 자동 저장은 순원에게 미완성 글을 보인다) — 되살아나면 칩이 `작성 중인 노트`. **노트 종이는 폰(<640)에서 한 열, 주보 종이는 두 열 그대로**(`index.css` `.paper-row` · 접히는 것은 `.paper-note`뿐).
- **옛 `### 본문` 도막은 어디에도 세우지 않는다** — 걷는 자리는 `noteTemplate.dropLegacySections` 한 곳이고 `LEGACY_SECTIONS`에서 `'본문'`을 빼면 안 된다(빈 노트 판정용).
- **날짜**: 로컬 `YYYY-MM-DD`는 `utils.localDate` 한 벌. QT·예배는 KST(`kstToday`), 업무 마감은 브라우저 로컬 — 둘은 합치지 않는다(`actionItems.js`는 import 0이라 그 자리에서 로컬로 조립한다).
- 커밋 메시지는 한국어, 제목 한 줄 + 본문에 **왜**를 쓴다. `Co-Authored-By: Claude` 라인은 넣지 않는다.
- **문구 톤**: 담백하고 상태를 그대로 말한다. 사용자가 고친 실제 예 — `여기는 다 정리됐어요` → `다 정리되었어요` · `마감 없음` → `마감 미정` · `단계를 입력하고 Enter` → `예: 포스터 시안 만들기`(방법보다 "여기에 무엇을 적는
  칸인지"가 먼저) · `+ 링크` → `+ 참고 링크`(**프로젝트 헤더**의 그 버튼이고, 링크를 다는 자리는 이제 거기 하나다 — §6-35). **"없어요"로 끝나는 짧은 부정 표현과 번역투를 특히 싫어한다.**
- **누가 누구와 견주는 구조를 만들지 마세요.** `내가 맡은 업무에는 지연이 없네요`를 `잘하고 있어요!`로 고쳤다 — "내 것에는 없다"는 곧 "남의 것에는 있다"로 읽히고, 이 화면은 같이 사역하는 사람들이 본다. 사람별 집계 섹션 이름은 **`청년별 남은
  업무`** 이고 `부하`·`과부하`·`병목` 같은 판정어는 쓰지 않는다.
- **실패 문구에 숫자·기술 용어를 넣지 마세요** — `드라이브가 50초 안에 응답하지 않았어요`를 `드라이브에 파일을 올리는 데 문제가 있어요 / 개발자에게 알려주시고, 잠시 뒤 다시 시도해주세요`로 고쳤다(몇 초 걸렸는지는 서버 로그에 남는다). 예외는 그림
  내보내기의 전면 실패 화면이다(§6-32-n).
- **토스트는 한눈에 읽혀야 한다** — `failText`가 30자를 넘으면 줄을 나누고, 폭 상한은 28rem이다.
- **AI가 만든 문장에는 엠 대시(—)·엔 대시(–)를 금지한다**(`ai.js`의 `DASH_RULE`). 사람이 쓰는 문서·주석에서는 쓴다.
- **용어**: UI에서 "작업"이 아니라 **"업무"**, 업무 안의 단계는 **"하위 업무"**. "핵심"이라는 단어를 쓰지 않는다.
- **기능을 숨기지 않는다.** '⋯' 메뉴에 넣었더니 기존에 쓰던 공유를 못 찾았다. hover로만 나타나는 조작도 같은 이유로 피한다(터치 기기에는 hover가 없어 그 기능이 아예 없는 것처럼 보인다). **가로 스크롤도 숨기는 방법이 될 수 있다** — 같은
  종류가 이어지는 줄은 괜찮지만 끝에 다른 성격의 버튼이 있으면 그건 숨긴 것이다(§4.6).
- **버튼 배치·색**: 대화창·팝오버는 `취소 왼쪽 / 확정 오른쪽`, 상시 도구 줄은 `확정 왼쪽 / 나가기 오른쪽`이고 두 모드에서 자리가 같다(저장한 순간 손가락 밑의 버튼이 다른 뜻이 되지 않게). 색은 행동에만 — 진한 accent = 확정, 연한
  accent = 편집 진입, 무채색 = 아무 일도 안 함. **Tailwind 기본 팔레트(`red-500` 등)를 쓰지 마세요**(다크 모드를 안 따라간다) — 토큰만 쓴다.
- **인라인 편집에는 저장·취소 버튼을 반드시 둔다**(Enter/Escape만 두면 모바일에는 그 조작이 아예 없다). **삭제 확인은 `ConfirmPopover`로 통일**한다(알림 지우기만 예외 — 잃는 것이 한 줄뿐이다).
- **여백·정렬을 매우 중시한다.** 데스크톱과 모바일(375px) 완전 동작이 필수다.
- **작업 방식**: 큰 목록을 받으면 항목마다 확인을 구하지 말고 배치로 진행하고 배치마다 `main`에 푸시한다. 마이그레이션은 보여준 뒤 바로 적용해도 된다(허락을 이미 받았다). **다만 시각 판단(레이아웃·문구 톤)은 물어보는 쪽이 낫다** — 목업을 만들어
  보여주면 훨씬 빠르게 정해진다.
