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
3. **비밀 값은 로컬 `.env`와 Vercel 환경변수에만 있다**(§5). 마이그레이션·psql에는 `SUPABASE_DB_URL` (대시보드 Connect의 Session pooler URI)이 필요하다.
4. **검증 스위트는 게스트 모드만 돈다.** 로그인·실시간·알림·푸시·첨부처럼 클라우드에서만 도는 경로는 테스트가 못 보고, 이 사각지대가 버그를 여럿 가리고 있었다(§6-25·27·28·29).
   **그쪽을 건드리면 배포 후 직접 확인해 달라고 부탁하세요.**
5. **라이브 DB 확인은 psql로 한다.** 한글이 깨지면 `PGCLIENTENCODING=UTF8`, SQL은 파일로 넘기는 쪽이 안전하다. RLS 경로를 재현할 때는 트랜잭션 안에서 `set local role authenticated` +
   `set_config('request.jwt.claims', …)`로 같은 역할·클레임을 만들고 **ROLLBACK**한다.
6. **Vercel이 푸시 웹훅을 놓칠 때가 있다**("고쳤는데 안 보인다"의 정체) — `gh api repos/thedaboot/church-workspace/deployments?per_page=1`로 새 배포를 확인하고, 없으면 `git commit
   --allow-empty`로 재트리거한다.
7. **이 환경(Claude Code)의 권한 분류기가 `supabase db push`를 막는다** — 사용자에게 `! <명령>`으로 넘긴다.
8. **Apps Script는 어시스턴트가 올릴 수 없다.** 고칠 것이 생기면 `docs/APPS_SCRIPT.md`를 고치고 사용자에게 부탁한다(배포 URL이 같으면 Vercel 환경변수는 그대로. 새 배포를 만들면 Production·Development 둘 다
   고쳐야 한다). `ROOT_FOLDER_ID`·`SHARED_TOKEN`은 스크립트 안에만 있으니 코드를 갈아 끼울 때 그 두 줄은 남긴다.
9. **스크린샷을 레포 루트에 흘리지 마세요**(실제로 8장이 커밋됐다) — 임시 출력은 스크래치 폴더로.

## 2. 남은 일

**다음에 만들 것은 비어 있다.** 2026-08-30 묶음(에디터·댓글 반응·AI 업무 링크·모바일 탭 순서·지금 누가 어디를)과 대시보드 참여 아이디어 30개는 전부 나갔다. 다시 꺼내지 않기로 한 것은 §7에 있다.

**사용자 판단 대기**(시각·문구 결정은 물어보는 쪽이다 — §8):

- **노트 도막별 자리표 문구는 사용자가 정한다**(2026-09-10) — 임의로 만들지 말 것(§8의 안내 줄 금지와 같은 자리).
- **노트의 읽기 종이와 편집 종이 높이가 다르다**(편집 쪽에 서식 바 + 쓸 빈 자리가 더 있다 — §6-32-p). 길은 셋: 그대로 둔다 / 편집 종이의 빈 자리를 줄인다 / 읽기 **상자**에 min-height를 준다.
- **주보 상세는 실시간으로 다시 읽지 않는다**(목록만). 상세까지 살리려면 편집 중 폼을 덮지 않을 방법이 먼저다.
- **순장이 출석 메모를 남겨야 하는지**(0052로 길은 열어 뒀다) · **예배 명칭 통일** · **형광펜 색** · **내 순 출석 이력** · **나눔 빈 자리 마크와 홈 생일 카드** · **찬양 구성** · **문구 톤**.
- **시각 판단 일곱**(2026-09-09 점검에서 남긴 것): `DepGraph` 고정 높이 440 · 768~900px에서 상단 검색창이 짜부라진다 · 375 주보 머리 카드가 두 줄 · 1440 순원 줄의 '순 옮기기·빼기'가 이름에서 200px
  떨어진다(§6-9-k) · 대시보드 '팀별 남은 업무'가 0건 팀까지 세운다 · 미리보기 `timedOut` 폴백이 `gdoc`에는 상한이 없다 · 비밀번호 설정 줄이 링크(`LinkPwFields`)와 첨부(`PasswordSetter`) 두 벌.

**짚어둔 것**(급하지 않음):

- **출석 13:30 게이트는 클라이언트만이다** — `attendance_insert` 정책은 시간을 안 본다(DB에도 걸지는 별도 결정).
- **`groups` 표를 한 화면에서 네 번 읽는다**(`fetchGroupPerms` + `fetchGroupsRoster` × 두 화면) — 보류.
- **주보 자동 저장이 Realtime Egress를 쓴다**(900ms UPDATE가 행 전체로 나간다) — Egress 분류를 보고 판단하되 **짐작으로 고치지 말 것**. `attendance.checked_by`는 0행이지만 남겨 둔다.
- **성능은 측정하지 않았다.** 이 PC에서 실행 간 편차가 3배까지 난다 — **성능 주장은 같은 실행 안에서 조건을 교대(A/B)해** 비교한다(이 함정에 두 번 빠졌다). 메인 번들 숫자는 고칠 때마다 `npm run build`로 갱신한다.
- **검색은 아직 `String.includes()`** 다(공백을 지우고 비교 · 첨부 이름·댓글까지 · **내용은 못 본다**). RAG를 붙일 자리는 **첨부 내용·댓글·지난 프로젝트 아카이브**다 — **카드에 벡터를 붙이는 것부터 시작하지 마세요.**
- **보드 조작 줄 합치기** — 모바일에서 카드에 닿기까지 여섯 겹이다(마지막 두 줄을 합치는 쪽이 값이 크다).
- **업로드 속도는 구조상 여기까지다**(남은 시간은 Apps Script가 드라이브에 쓰는 시간). **인라인 상한(3MB)을 올려 Storage 경유를 없애자는 생각은 하지 마세요**(base64가 33%를 불린다 · §6-29-n·o).

**실기기 확인 목록**(2026-09-10~11 회차 — 게스트 스위트가 못 보는 자리):

- **폰에서 공유 넷**(주보 PDF · 예배 노트 · 묵상 노트 · 순모임 가이드)이 **3초 안에** 열리는지 — **홈 화면에 추가한 앱(PWA)** 과 **카카오톡 인앱** 각각(그 둘은 내려받기가 막혀 새 탭으로 떨어진다).
- **공유 그림이 화면과 같은지**(줄 간격·라벨 기준선·가이드 머리줄의 하트 — §6-32-t).
- **큐시트 '구글 문서에서 편집'**(새 탭)으로 실제 편집이 되는지 · 업무 첨부는 그대로 보기인지 — §6-34-h.
- **노트 종이 편집**(인디고 띠·제목·구절·캐릭터 컷이 저장된 종이와 같은지 · 도막 제목이 지워지지 않는지).
- **업무 링크가 '첨부 파일' 구역 안**에 파일 줄과 한 목록으로 서고 '열기'로 앱 안에서 고쳐지는지(0058 · §6-35).
- **합친 계정 사진**이 담당자·멘션·댓글·활동에서 남긴 계정 것인지(§6-34-f).
- **Apps Script는 v10이 배포된 판이다**(2026-09-09) — 큐시트 편집이 안 되면 `docs/APPS_SCRIPT.md` '올린 뒤 확인할 것'의 판 번호부터.

## 3. 이 레포의 흐름 (새 기능을 붙일 때)

기능을 여럿 붙이면서 매번 같은 순서를 밟았다. 그대로 하면 된다.

1. **저장 자리를 먼저 고른다 — 컬럼이냐 조인 테이블이냐.** 카드와 언제나 같이 읽고 쓰고 항목이 몇 개뿐이면 **컬럼**(jsonb라도). 조인은 따로 조회·집계할 이유가 있을 때만 — 왕복이 두 번이라 저장이 겹치면 깨진다(§6-27).
2. **앱 안의 모양은 그대로 두는 쪽을 먼저 본다.** 0013이 담당자를 조인으로 옮겼는데도 `task.assignees`는 여전히 이름 배열이라 셀렉터·뷰·활동 기록·AI 컨텍스트를 한 줄도 안 고쳤다. 저장 계층만 바꾸는 길을 먼저 찾으세요.
3. **마이그레이션은 psql로, 결과를 눈으로 확인한다.** `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <파일>` → 컬럼·제약·정책·백필 건수 확인. 되돌리는 SQL은 파일 맨 아래 주석(§5).
4. **코드가 새 컬럼을 읽기 시작하면 마이그레이션이 먼저 나가야 한다.** 조회에 없는 관계를 넣으면 `loadCloudState`가 던져 **모두에게 오류 화면**이 뜬다. 순서는 마이그레이션 → 푸시.
5. **검사 하나를 남긴다**(화면이면 브라우저 스위트, 순수 로직이면 `logcheck`) **그리고 일부러 되돌려서 실제로 실패하는지 확인한다.** 이걸로 여러 번 걸렀다. 순수 로직은 `.js`(JSX 아님)에 두면 노드에서 바로 검사된다.
6. **클라우드 경로는 직접 확인해 달라고 부탁한다.** 지금까지 잡힌 버그 상당수가 사용자가 써 보고 알려준 것이다.
7. **문서를 같이 고친다** — `HANDOFF.md`(결정·남은 일·파일 지도) · `docs/PITFALLS.md`(새 함정은 뒤에 번호를 갈라 붙인다) · `README.md`(기능·마이그레이션 표) · `tests/README.md`(스위트·단정 개수).

## 4. 화면 ↔ 파일 지도

파일마다 한 줄이다. 설명은 그 파일 **머리말 주석**에 있으니 되풀이하지 않는다. 괄호의 `§`는 `docs/PITFALLS.md`.

```
src/main.jsx                  부트스트랩(React 마운트)
src/App.jsx                   조립 + 라우팅 상태 · GLOBAL_MENUS·CHURCH_ORDER·needsFullHeight · main 스크롤(§6-9-v)
src/index.css                 토큰(--app-*/--p-*)·모션(dc-*)·`.tiptap`·`.note-paper`(§6-32-p) · 폰트 import (§4.2)
src/config.js                 팀·상태 상수 · teamColor/teamPaint · MAX_UPLOAD_MB · 팀 표는 안전목록(§6-9-bo)
src/utils.js                  순수 헬퍼 한 벌(정렬·날짜·생일·그래프 물리·멘션·drive 주소…) — logcheck가 검사
src/store/workspaceStore.js   useSyncExternalStore 스토어 + 되돌리기 기록(§6-22)
src/store/selectors.js        셀렉터 — 매번 새 배열을 만들면 무한 리렌더(§4.9)
src/hooks/controllers.js      저장·삭제 등 쓰기 경로
src/hooks/useIsMobile.js      반응형 분기 — 한쪽만 마운트(§6-3)
src/hooks/useForceGraph.js    그래프 시뮬 루프·냉각·드래그 — 연결 지도와 그래프 뷰 한 벌(§4.9)
src/hooks/useMinuteTick.js    상대 시간 라벨 늙히기(§4.9)
src/hooks/useEnterStagger.js  순차 등장은 첫 마운트만(§4.2)
src/hooks/useProjectYear.js   고른 연도 모듈 스토어 — 지도·프로젝트 진행·탭 줄이 같은 값을 본다(§4.9)
src/hooks/useSheetShare.jsx   종이를 미리 구워 두는 훅 + 마지막 갈래 overlay(§6-32-g·32-s·32-m)
src/components/layout.jsx     TopNav / MobileTopBar / MobileTabBar / ProfileMenu / SearchBox / NotificationBell
src/components/boards.jsx     칸반 보드(dnd-kit) — 카드·상태 칩·컬럼·DragOverlay(§6-1·§6-10~12-c)
src/components/calendar.jsx   캘린더(주 단위 행) — 띠 배치·모바일 달력·날짜 옆 생일 얼굴(§4.8·§6-13~15)
src/components/depgraph.jsx   프로젝트 '그래프' 보기 — useForceGraph 공용(§4.9)
src/components/Avatar.jsx     사람 동그라미 — 사진 없으면 이름 첫 글자(§4.7)
src/components/ConfirmPopover.jsx  삭제 확인 팝오버 + useAnchoredPos(위치 공용 훅 · §6-17)
src/components/DatePicker.jsx 노션 톤 데이트피커 — children·triggerClassName·allowClear · `yearless`(명단 생일)
src/components/DocEmbed.jsx   구글 문서·시트·슬라이드를 앱 안 iframe으로(판정·주소는 services/docEmbed.js · §6-29-z-6)
src/components/ErrorBoundary.jsx  오류 화면
src/components/FilePreviewModal.jsx  첨부 미리보기 창 — 갈래 판정은 services/previewKind.js(§6-29-c)
src/components/fileRow.jsx    파일 한 줄의 크기·종류 표기 — 업무 첨부와 주보 송폼 공용
src/components/linkIcons.jsx  참고 링크 앞의 서비스 표시(커밋된 path · §4.2)
src/components/links.jsx      링크 부품 한 벌 — PinnedLinkChip·LinkRow·LinkAddPopover·useLinkAccess·LinkPwFields(§6-35)
src/components/LoginScreen.jsx 로그인 화면(라이트 고정 hex · 로고 preload — §6-29-z-5)
src/components/MarkdownEditor.jsx  TipTap 편집기 — 서식 바·sticky·LockedHeadings·frame(§6-32-o·32-p·§6-9-aa)
src/components/media.jsx      이미지·영상·소리 미리보기
src/components/MentionInput.jsx  @멘션 자동완성 — 댓글·답글 공용(§4.11)
src/components/OfficeView.jsx 워드·PPT 미리보기 **폴백**(구글 사본이 있으면 안 쓴다 · §6-29-y)
src/components/paper.jsx      **종이** — PaperMast·PaperNoteHead·PaperSheet·NotePaper·NoteSheet·ServiceSheetOne/Two(§6-32-p)
src/components/PdfView.jsx    pdf.js 미리보기
src/components/RichText.jsx   본문 렌더 — InlineLink가 앱 안에서 연다(§6의 본문 링크 항목)
src/components/roster.jsx     (v2) 청년 명단 — 연도 세그먼트·직분 6종·계정 연결(0043)
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
src/components/groupsParts.jsx (v2) 모임 공용 — CARD/BTN/FIELD · PersonPick·MenuPick(§6-9-an·33-a) · useSettled(§6-9-ad)
src/components/ClubQr.jsx     (v2) 동아리 신청 QR 카드(§6-29-z-7)
src/views/views.jsx           DashboardView / ProjectView / MyTasksView / TeamView / ScheduleView / TeamFilterBar
src/views/dashboardParts.jsx  여러 화면이 쓰는 부품 — 마감 구간·KpiCell·Bar·PeopleStrip(§4.8)·ActivityFeed·NetworkMap(§4.9)
src/views/membersView.jsx     전역 '멤버'(관리자) — [가입자 | 청년 명단] · 접속 표시는 스토어를 겹쳐 쓴다(§4.8)
src/views/homeView.jsx        (v2) 홈 — 인사말 + 카드 넷. 자기 저장 자리가 없다(§6-9-x·9-r·9-s)
src/views/worshipView.jsx     (v2) 예배 — 주보 목록 → 상세/작성/발행 → 출석
src/views/wordView.jsx        (v2) 말씀 — [QT | 성경 읽기] · 내 묵상은 저장하면 종이(§6-32-p·19-b)
src/views/groupsView.jsx      (v2) 모임 — 내 순 · 동아리 · 순 편성
src/modals/modals.jsx         업무 창 — TaskModalShell·TaskViewer·TaskEditor·SubtaskList·담당자·선행 업무(§4.9)
src/modals/attachments.jsx    업무 창의 첨부 구역 — 업로드·미리보기·삭제 + **링크 줄**(§6-35 · startUploads는 §6-29-u)
src/modals/comments.jsx       업무 창의 댓글·반응·활동 기록 패널(§4.11)
src/modals/settings.jsx       내 정보(사진·이름·팀) / 프로젝트 만들기·이름 수정(§4.7·§6-34-g)
src/services/supabaseClient.js 클라이언트 한 벌 + setWriteObserver(§4.8) + myUid()(§6-34-d)
src/services/cloud.js         Supabase 읽기·쓰기 — 업로드는 `uploadOwnedFile` 한 벌(업무·주보가 같이 쓴다)
src/services/cloudSync.js     모양 변환 + 실시간 라우팅 + 알림 만들기(§6-21·21-a·29-a)
src/services/auth.jsx         OAuth — 로그인 전 자리 기억·카카오 인앱 자동 시작(§6의 auth 항목)
src/services/domain.js        TaskService·ActivityService(§6-28)
src/services/presence.js      지금 접속한 사람 — 워크스페이스 스토어 밖 미니 스토어(§4.9·§6-24-b)
src/services/liveV2.js        v2 실시간 — 채널 하나 · 표 → 캐시 접두 · useLiveRefresh(§6-24-a)
src/services/cache.js         화면 데이터 캐시(메모리+localStorage, 사용자별) · useCached(§6-24-d·24-e·24-f)
src/services/entryQuery.js    진입 주소의 나머지 값을 모듈 첫 실행 때 붙잡는다(§6-24-c)
src/services/ai.js            Gemini 프롬프트·컨텍스트·요약 캐시 — 배경 지식 원본은 `docs/AI.md`(§4.4·§6-43~46)
src/services/bibleSearch.js   AI 본문 검색 순수 모듈 — 참조만 받는다(§6-9-ar)
src/services/sunGuide.js      순모임 가이드 — 프롬프트·JSON 파싱·fitGuide·sun_guides(§4.4)
src/services/notifyText.js    알림 문구 — 앱과 api/push.js가 같이 본다(§4.3)
src/services/push.js          브라우저 구독 켜기/끄기(§6-30)
src/services/image.js         올리기 전 축소(첨부 2560px · 본문 1600px · 아바타 256px · §6-29-m)
src/services/fileText.js      첨부에서 글자 뽑기(검색·AI가 읽는다)
src/services/ooxml.js         zip 풀기 + XML 훑기 — xlsx·docx·pptx 공용, 의존성 0(§6-29-c-2·29-z)
src/services/xlsx.js docx.js pptx.js  엑셀·워드·PPT 읽기(tests/sheet·office가 검사 · §6-29-w·29-x)
src/services/previewKind.js   첨부 미리보기 갈래 판정 — 순수 함수(§6-29-z-2)
src/services/docEmbed.js      구글 임베드 판정·주소 — 순수 함수(§6-29-z-6)
src/services/viewPw.js        화면 가림 비밀번호 순수 모듈 — cloud.js를 import하지 않는다(§6-31-f·9-bp)
src/services/markdown.js      마크다운 왕복 — RichText와 한 쌍(mdcheck)
src/services/titleText.js     유튜브 제목 평문화 — 앱과 api/yt.js 두 곳(§6-9-ah)
src/services/errorText.js     오류 코드 → 사람 말(§6-29-e · §8)
src/services/shareImage.js    종이를 그림·PDF로 — nodeToPng·bakeAndSlice·shareOrSave·isBlankCanvas(§6-32-*)
src/services/people.js        (v2) 명단·모임 읽기 공용 + guestStore(게스트 저장 자리 공장)
src/services/roster.js        (v2) 명단 쓰기·계정 연결(§6의 roster_name 항목)
src/services/worship.js       (v2) 주보·출석·노트·자격(§6-9-ak)
src/services/word.js          (v2) QT 일정·묵상·bible_state · shouldAdoptBody(§6-24-c)
src/services/groups.js        (v2) 순·동아리·신청·모임·groupPerms · share()로 중복 조회 묶기(§6-9-bg)
src/services/bible.js bibleRef.js  (v2) public/bible 로더·캐시 / 구절 파서 — 주보·QT·리더가 한 벌(§6-9-aq)
src/services/noteTemplate.js  (v2) 노트 템플릿·LEGACY_SECTIONS·isTemplateOnly·ensureNoteSections(§6-9-as·32-l)
src/assets/                   SUIT 서브셋 + symbols(보조 글꼴) + 로고 — 생성 스크립트는 scripts/(§4.2·§6-9-au)
api/ai.js                     Gemini 프록시(25초에 끊는다 · §6-9-bn)
api/push.js                   POST=앱 알림을 푸시로 / GET=마감 임박·오늘 예배 배치(`?job` · §4.3)
api/drive.js                  Apps Script 프록시 — 업로드·폴더·휴지통(50초에 끊는다 · §6-29-f·29-g)
api/drive-file.js             드라이브 파일 바이트 중계(앱 안 뷰어용 · §6-29-c·29-z-3)
api/share.js                  공유 링크 OG 메타 — 조회 `error`를 반드시 읽는다(§6-31-d·31-e)
api/yt.js                     유튜브 재생목록·제목 중계(ai.js와 같은 Bearer 인증)
vite.config.js                dev 전용 `/api/<name>` 미들웨어 — 게스트 모드에는 붙지 않는다(§6-29-z-4)
public/sw.js                  서비스 워커 — 푸시 표시 + 클릭 시 딥링크. 캐싱은 하지 않는다
public/bible/                 (v2) 개역한글 66권 json + index.json
public/chars/                 (v2) 캐릭터 28컷(webp) — 홈만 쓰고 원본(177~225px) 이상으로 키우지 않는다
public/ 그 밖                 아이콘·매니페스트·OG·스크린샷
scripts/subset_suit.py subset_symbols.py make_icons.py  폰트·아이콘 생성(한 번 돌리고 결과물을 커밋)
scripts/drive_check.mjs       드라이브 ↔ DB 어긋남 점검(`--fix`를 붙여야 고친다 · §6-29-j)
scripts/migrate_to_drive.mjs reset_drive_migration.mjs backfill_sheet_preview.mjs  이관·되돌리기·사본 백필
scripts/bible_check.mjs       성경 json 정합 검사(tests/bibleref와 짝)
supabase/migrations/          0001~0061 — 표는 README, 최근 것은 §5
tests/                        검증 스위트 + 러너 — 목록은 tests/README.md
design/                       원본 시트(chars.png·char.png) — 배포에 안 실림
```

업무 창 네 파일은 `modals.jsx`가 `attachments.jsx`·`comments.jsx`를 쓰고 `settings.jsx`는 App이 직접 가져온다. **새 전역 화면을 만들면 `App.jsx`의 `GLOBAL_MENUS`에 넣으세요** — 없으면
프로젝트 id로 오해돼 대시보드로 튕긴다. 안에서 스크롤하는 화면(보드·달력)은 `needsFullHeight`에도 넣어야 높이가 확정된다(§6-2).

## 5. 데이터 · 스키마 · 비밀

- **마이그레이션 번호별 표는 `README.md`에 하나만 둔다.** 스키마는 `supabase/migrations/0001~0061`이고 **전부 라이브 DB에 적용**되어 있다. 최근 것: **0059** 계정 합치기 rpc(마스터만 · 되돌릴 수 없다) ·
  **0060** `profiles.merged_into`(합친 계정을 다시 초대하면 빈 중복이 살아나던 것) · **0061** `effective_uid()`(합친 계정으로 들어와도 그 사람 — `is_approved`·`my_person_id`·개인 표 셋의
  정책).
- **`npx supabase db push`를 쓰지 마세요.** 원장(`supabase_migrations.schema_migrations`)에는 0038까지만 적혀 있어서 dry-run이 0039부터를 "적용할 것"으로 잡는다. 새 파일은 `psql
  "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<파일>`로 넣는다.
- **적용 여부는 원장이 아니라 실제 객체로 확인한다**(컬럼·함수·정책·발행 목록). 되돌리는 SQL은 파일 맨 아래 주석.
- **값을 손보는 UPDATE는 `cards`의 트리거를 끄고 돌린다**(`trg_cards_updated_meta`) — `updated_at = now()`가 무조건 걸려서 백필 한 줄이 완료 카드 28건의 날짜를 밀었다. **before update 트리거에서
  `new.X = old.X`를 쓰지 마세요**(그 컬럼을 직접 고치는 UPDATE 전부가 무력화된다 — 0033의 백필이 자기 트리거에 덮인 이유).
- **RLS 경계 요약**: 모든 내용 표에 `is_approved()`(0022) · 관리자 원본은 `admins` 표 하나 · 지정·해제는 `is_master()`(0029) · 프로젝트 삭제는 전원(0021) · 주보 쓰기
  `can_edit_service()`(0042·0045) · 전체 출석 `can_check_all_attendance()`(0045) · 순 관리 `can_manage_sun()`(0039·0045) · 개인 표
  셋(`service_notes`·`qt_entries`·`bible_state`)은 `effective_uid()`(0061). 자세한 것은 §4.5·§6-31-a.
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
| 노트·주보 종이를 순모임 가이드 종이처럼 | "디자인 템플릿이 너무 똑같잖아" — 가이드 종이는 사용자가 준 템플릿이라 그대로 둔다 |
| 주보 종이에 캐릭터 컷 | 설교 본문이 실리는 공식 문서다(`tests/worship`이 단정) — **노트 종이에는 한 컷 붙인다** |
| 주보를 이미지 두 장으로 카카오톡에 | 카카오 인앱 웹뷰에 공유 시트가 없어 내려받기로 떨어진다 → **PDF 한 파일** |
| 발행된 주보에서 탭을 걷고 종이만 남기기 | 종이에는 유튜브 링크·구절 잇기가 없다 → '주보' 탭을 맨 앞·기본 탭으로 |
| 첨부에 편집 권한 주기 | 드라이브는 워크스페이스 멤버인지 모른다 — **링크를 아는 누구나 고칠 수 있다.** 같이 채울 문서는 참고 링크로 |
| 달력에서 업무 만들기를 '전체 일정'에도 | 거기에는 프로젝트가 없다 — **프로젝트 캘린더에만**(2026-08-24) |
| 본문 에디터의 슬래시 메뉴 | 접고 **툴바 버튼**(체크리스트·h3·h4)으로 정했다(2026-08-24) |
| 연도 폴더를 별도 화면으로 | 더보기 메뉴가 연도 폴더(진행 중 + 보관)고 탭줄은 유지한다(2026-08-24) |
| 수요 예배 | **하지 않는다** — AI 배경 지식·화면 문구에 넣지 말 것(예배는 주일 4부 청년 예배·금요 열정 예배) |
| Gemini 모델 교체 | `3.1-flash-lite` 유지(2026-08-29 A/B 6회 — 3.5는 호칭 '님'을 빼먹었다). 새 A/B 근거 없이 제안 금지 |

## 8. 관례

- 커밋 메시지는 한국어, 제목 한 줄 + 본문에 **왜**를 쓴다. `Co-Authored-By: Claude` 라인은 넣지 않는다.
- **문구 톤**: 담백하고 상태를 그대로 말한다. 사용자가 고친 실제 예 — `여기는 다 정리됐어요` → `다 정리되었어요` · `마감 없음` → `마감 미정` · `단계를 입력하고 Enter` → `예: 포스터 시안 만들기`(방법보다 "여기에 무엇을 적는
  칸인지"가 먼저) · `+ 링크` → `+ 참고 링크`(**프로젝트 헤더**의 그 버튼. 업무 창 첨부 구역의 것은 `+ 파일` 옆이라 `+ 링크`다 — §6-35. 되돌리지 마세요). **"없어요"로 끝나는 짧은 부정 표현과 번역투를 특히 싫어한다.**
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
