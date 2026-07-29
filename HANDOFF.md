# 인수인계 — 더다붓 워크스페이스 (2026-07-29 기준)

다음 사람이 이 코드를 처음 열었을 때 **어디를 보면 되는지**, **이미 한 번 밟은 함정을 다시
밟지 않도록**, 그리고 **다음에 무엇을 할지** 정리한 문서입니다. 기능 소개는
[`README.md`](README.md)에 있습니다.

**새 기능을 붙이러 왔다면 §8(다음에 할 일)과 §9(이 레포의 흐름)부터 읽으세요.**
§8.3에는 사용자가 판단해서 뺀 항목이 이유와 함께 있습니다 — 그걸 다시 제안하지 않는 것이
이 문서의 목적 중 하나입니다.

- 레포: `github.com/thedaboot/church-workspace` · 브랜치 `main`
- 최근 작업은 `git log --oneline -15`로 봅니다 (여기에 커밋 해시를 적어 두면
  커밋마다 손으로 고쳐야 해서 금방 낡습니다 — 실제로 한 번 어긋나 있었습니다)
- 배포: Vercel, `main` 푸시 시 자동
- 검증: `npm run verify` → 22개 스위트 301 pass (약 6분).
  301은 단정 개수이고 스위트는 22개입니다 — 평소에는 `npm run verify -- handoff navsmoke`처럼
  골라 돌리고(수십 초), 푸시 직전에 한 번 전부 돌리는 흐름입니다.

### 이 문서 밖에 있는 것 (레포만 받아서는 알 수 없는 것)

1. **시각 규격의 원본**은 아래 §1의 외부 핸드오프 번들이고 레포에 없습니다. 규격 논쟁이
   생기면 그 문서가 기준입니다.
2. **비밀 값**은 로컬 `.env`와 Vercel 환경변수에만 있습니다(§6). 마이그레이션을 돌리려면
   `.env`의 `SUPABASE_DB_URL`(대시보드 Connect의 Session pooler URI)이 필요합니다.
3. **검증 스위트는 게스트 모드만 돌립니다.** 로그인·실시간·알림·첨부·담당자 저장처럼
   클라우드에서만 도는 경로는 테스트가 보지 못합니다. 이 사각지대가 실제로 버그 셋을
   가리고 있었습니다 — 멘션 알림이 한 번도 생성되지 않던 것(§5의 27번), 담당자 추가 시
   duplicate key(29번), 업무 저장 시 `activity_pkey`(30번). 뒤의 둘은 사용자가 직접 써
   보고 알려줘서 잡혔습니다. **그쪽을 건드리면 배포 후 직접 확인해 달라고 부탁하세요.**
4. **라이브 DB 확인은 psql로 합니다.** `.env`의 `SUPABASE_DB_URL`로 붙고, 한글이 깨지면
   `PGCLIENTENCODING=UTF8`을 붙이세요(psql 메타 명령에 한글을 넣으면 인코딩이 깨져서
   SQL은 파일로 넘기는 쪽이 안전합니다). RLS가 걸린 경로를 재현할 때는 트랜잭션 안에서
   `set local role authenticated` + `set_config('request.jwt.claims', …)`로 같은 역할·
   같은 클레임을 만들고 **ROLLBACK**하세요 — 버그 셋을 이 방법으로 재현했습니다.

---

## 1. 이 작업의 기준 문서

시각 리디자인은 외부에서 받은 **디자인 핸드오프 문서**를 기준으로 구현했습니다.

```
C:\Users\노준석\Downloads\대시보드 완전 리디자인\design_handoff_workspace_redesign\README.md
```

이 문서는 레포에 없습니다(전달받은 번들). 규격 논쟁이 생기면 **이 문서가 기준**이고, 임의
판단으로 바꾸지 않습니다. 실제로 한 번 어겼다가 되돌렸습니다 — 모바일 KPI를 2×2 대신 3열로
바꿨는데, 핸드오프대로 2×2로 원복했습니다.

핸드오프에 **없는** 부분(= 판단 여지가 있는 부분)은 다음과 같고, 모두 사용자 지시로 정한
것입니다.

| 항목 | 정한 내용 | 근거 |
|---|---|---|
| 데스크톱 캘린더의 '고른 날 목록' | 달력 오른쪽 300px 열 | 핸드오프는 이 목록을 *모바일 전용*으로만 규정("모바일은 하단 목록 갱신"). 아래에 두면 달력 높이를 빼앗아 띠가 잘렸다 |
| 모바일 하단 탭 구성 | 프로젝트 / 내 업무 / 대시보드 / **팀** | 핸드오프 HTML의 네 번째 탭이 '팀'. 설정은 상단 헤더로 |
| 프로젝트 화면 공유·삭제 위치 | 메타 줄 끝에 상시 노출 | '⋯' 안에 숨기니 기존에 쓰던 공유를 못 찾았다 |
| 마감 그룹의 '완료' 구간 | `끝낸 업무` 5번째 구간 | 완료 건이 '지연'으로 잡히던 문제 |

---

## 2. 화면 ↔ 파일 지도

```
src/App.jsx                 조립 + 라우팅 상태. 내비 마운트 분기, main 패딩, 뷰 래퍼
src/index.css               토큰(--app-*, --p-*) · 모션(dc-*) · 그리드 유틸
                            폰트는 assets/fonts/suit.css를 import (아래 §3)
src/config.js               팀·상태 상수, teamColor/teamBgColor/teamBar/teamPaint
src/components/layout.jsx   TopNav(데스크톱 2줄) / MobileTopBar / MobileTabBar / ProfileMenu
                            / SearchBox / NotificationBell
src/components/boards.jsx   칸반 보드(dnd-kit) — 카드 · 상태 칩 · 컬럼 · DragOverlay
src/components/calendar.jsx 캘린더(주 단위 행) — 띠 배치(layoutWeek) · 모바일 달력 · 날짜 목록
src/views/views.jsx         DashboardView / ProjectView / MyTasksView / TeamView / ScheduleView
                            / TeamFilterBar
src/views/dashboardParts.jsx  여러 화면이 공유하는 부품: 마감 구간 계산(byDue·groupByDue·
                            bucketOf·isStaleNoDue), KpiCell, Bar, StatusSegments, DueGroupList,
                            TeamLeftGrid, PersonLoadGrid·personLoad(청년별), SectionHead, Card
src/modals/modals.jsx       업무 창 — 껍데기(TaskModalShell) · 보기 · 수정 폼 · 담당자 선택
src/modals/attachments.jsx  업무 창의 첨부 영역(업로드·미리보기 열기·삭제)
src/modals/comments.jsx     업무 창의 댓글 · 활동 기록 패널
src/modals/settings.jsx     내 정보(이름·팀·연결된 계정) / 프로젝트 만들기·이름 수정
src/services/               cloud.js(Supabase) · cloudSync.js(모양 변환 + 실시간 라우팅)
                            · ai.js(Gemini 프롬프트+컨텍스트+요약 캐시) · markdown.js
                            · domain.js(TaskService·ActivityService)
                            · push.js(브라우저 구독 켜기/끄기) · notifyText.js(알림 문구 —
                              앱과 api/push.js가 같이 본다)
public/sw.js                서비스 워커 — 푸시 표시 + 클릭 시 딥링크. 캐싱은 하지 않는다
api/                        ai.js(Gemini 프록시) · share.js(OG 메타)
                            · push.js(POST=앱이 만든 알림을 푸시로, GET=마감 임박 배치)
src/store/                  useSyncExternalStore 기반 커스텀 스토어 + 셀렉터
scripts/subset_suit.py      폰트 조각 생성(한 번 돌리고 결과물을 커밋 — §3)
tests/                      검증 스위트 + 러너 (README는 tests/README.md)
```

업무 창 네 파일은 서로를 이렇게 부릅니다: `modals.jsx`가 `attachments.jsx`와
`comments.jsx`를 가져다 쓰고, `settings.jsx`는 App이 직접 가져옵니다.

전역 화면 이름은 `App.jsx`의 `GLOBAL_MENUS`(`dashboard`·`myTasks`·`schedule`)에 모여
있습니다. **새 전역 화면을 만들면 이 목록에도 넣으세요** — 없으면 그 이름이 프로젝트
id로 오해돼 '없는 프로젝트'로 판정되고 대시보드로 튕깁니다. 그리고 안에서 스크롤하는
화면(보드·달력)은 `needsFullHeight`에도 넣어야 높이가 확정됩니다(§5의 2번).

### 리디자인에서 손대지 않은 영역
`src/services/`, `src/store/`, `src/hooks/`, `supabase/`, `api/`, 첨부 관련
(`FilePreviewModal.jsx`, `PdfView.jsx`, `media.jsx`) — 디자인만 바꾸고 데이터 경로는
건드리지 않는다는 전제였습니다. 첨부·DB 동기화·공유는 리디자인 후 실제로 다시 검증했습니다
(`tests/share.mjs`, `tests/handoff.mjs`의 업무 상세/수정 절).

---

## 3. 디자인 토큰 · 모션

`src/index.css` 한 곳에 모여 있습니다. `@theme inline`으로 Tailwind 유틸과 이중화되어
있어 `bg-surface` 같은 클래스와 `var(--app-surface)` 인라인 스타일이 같은 값을 봅니다.

- **진행 바 파스텔** `--p-track/--p-blue/--p-red/--p-yellow/--p-green/--p-gray/--p-brown/--p-purple/--p-pink`
  (라이트 스펙 값: `#93b4e4` / `#e5a29b` / `#e6e3e8`, 다크는 별도 정의)
- **이징 하나** `--ease-out-quint: cubic-bezier(.16, 1, .3, 1)`. 다른 이징을 새로 만들지 않습니다.
- **애니메이션 클래스** `.dc-screen`(260ms) `.dc-row` `.dc-card` `.dc-kpi` `.dc-pop`
  `.dc-bar-fill`(scaleX 전환) `.dc-draw`/`.dc-draw-2`/`.dc-draw-3`(선 그리기) `.dc-draw-ring`
- **`transform`/`opacity`만** 애니메이션합니다. 진행 바도 `width`가 아니라 `scaleX`.
- `prefers-reduced-motion`에서 전부 해제됩니다(`tests/handoff.mjs`가 검사).
- 폰트: **SUIT Variable**. 패키지(`@sun-typeface/suit`)의 통짜 woff2(610KB)를 그대로
  물리지 않고, `scripts/subset_suit.py`로 **상용 한글 2,350자(503KB) + 나머지 음절(95KB)**
  두 조각으로 나눠 `src/assets/fonts/`에 커밋해 두었습니다. `index.css`는 거기 생성된
  `suit.css`를 import하고, `unicode-range`가 조각을 갈라 줍니다(희귀 음절이 화면에
  나올 때만 두 번째 조각을 받습니다). **UI에 새 기호를 쓰면** 스크립트의 `LATIN`
  범위에 넣고 다시 돌려야 합니다 — 범위 밖 문자는 시스템 폰트로 떨어져서 한 문장
  안에서 자획이 달라집니다(실제로 `⌘`를 빠뜨렸습니다). Pretendard는 폰트 스택의
  폴백 이름으로만 남아 있고 패키지는 없습니다.
- 아이콘: lucide, `svg.lucide { stroke-width: 1.4px }`로 굵기 통일. 이모지 아이콘 금지.
- 반응형 그리드 유틸: `.dash-grid`(1열 → lg에서 `1fr 360px`), `.side-grid`(lg에서 300px),
  `.kpi-grid`(모바일 2열 → lg 4열)

---

## 4. 검증

```bash
npm run verify                 # 전부. 게스트 dev 서버를 띄우고 끝나면 내린다
npm run verify -- calfit drag   # 골라서
npm run verify -- --jobs 3      # 동시 실행
SHOTS=1 npm run verify          # 스크린샷 저장(tests/*.png, gitignore)
CHROME=/path/to/chrome npm run verify
```

스위트 목록과 각각이 보는 것은 [`tests/README.md`](tests/README.md)에 있습니다.

**중요 — `CRASH`를 그냥 넘기지 마세요.** 이 테스트들은 헤드리스 Chrome을 CDP로 붙잡고 실제
좌표를 재는 방식이라, 앱 마크업이 바뀌면 셀렉터가 못 찾고 **스크립트가 예외로 죽습니다.**
그때 `FAIL` 줄이 없어서 "안 돌고 있는 상태"가 통과처럼 보입니다. 러너가 이 경우를
`CRASH`로 따로 찍습니다. 실제로 핸드오프 리라이트 이후 여섯 개 스위트가 이 상태로 방치돼
있었고, 다시 맞추는 과정에서 드래그·캘린더 버그 두 개가 드러났습니다.

---

## 5. 이미 밟은 함정 (다시 밟지 마세요)

코드에는 각 지점에 왜 그렇게 했는지 주석이 달려 있습니다. 여기 있는 것은 그 주석의 색인입니다.

**레이아웃 / CSS**

1. **`position: fixed`가 뷰포트 기준이 아니게 된다** — `.dc-screen`·`.dc-card`에 걸린
   transform 애니메이션이 조상 containing block이 되어, dnd-kit의 `DragOverlay`가 카드보다
   **약 100px 아래**에서 떴습니다. 해결: 오버레이를 `createPortal(..., document.body)`로
   내보냅니다(`boards.jsx`). 앞으로 fixed로 띄우는 것은 전부 body 포털을 기본으로 두세요.
2. **스크롤 컨테이너의 `padding-bottom`은 넘친 내용에 적용되지 않는다** — 뷰 래퍼에 걸린
   `h-full` 때문에 내용이 그 박스를 넘쳐 흘러서, `main`의 아래 여백이 무효가 되고 마지막 줄이
   하단 탭바에 가렸습니다. 해결: `h-full`은 내부 스크롤이 필요한 **프로젝트 화면에만**
   (`App.jsx`의 `isProjectScreen`). 회귀는 `tests/bottomgap.mjs`가 막습니다.
3. **CSS로 감추기 ≠ 언마운트** — 데스크톱/모바일 내비를 `hidden`/`md:hidden`으로만 가리면
   둘 다 마운트되어 알림 종이 두 개가 됩니다. 그러면 같은 Supabase 실시간 채널에 두 번 붙어
   `cannot add postgres_changes callbacks ... after subscribe()`로 앱이 죽습니다. 해결:
   `useIsMobile()`(matchMedia `max-width: 767px`)로 **한쪽만 마운트** + `cloud.js`에서 같은
   topic의 기존 채널 제거.
4. **Tailwind display 유틸 충돌** — 컴포넌트 기본 클래스에 `inline-flex`가 있는데 호출부에서
   `hidden md:inline-flex`를 주면 같은 레이어라 `hidden`이 집니다. display는 호출부가
   소유하게 두세요.
5. **`<button>`은 내용을 수직 중앙 정렬한다** — 형제가 `div`인 grid에서 라벨이 8px 어긋납니다
   (`block` 추가로 해결).
6. **iOS Safari의 `transform-box`가 Chrome과 다르다** — CSS로 회전한 SVG `<text>`가 부모
   밖으로 튀어나갔습니다(도넛 % 라벨). SVG 안에서 회전 텍스트를 쓰지 말고 HTML을 겹치세요.
7. **`touch-action: pan-x`는 자손 전체에 걸린다** — 가로 스크롤 줄에 걸면 그 안 카드 목록의
   세로 스크롤까지 죽습니다. 보드 스크롤러에는 `overscroll-behavior-x`만 걸었습니다.
8. **`overscroll-behavior-x: contain` vs `none`** — `contain`은 부모로 넘기는 것만 막고 자기
   고무줄(바운스)은 남깁니다. 그래서 '완료' 오른쪽으로 더 갈 것처럼 밀렸습니다 → `none`.

**dnd-kit**

9. **가로 자동 스크롤이 드롭 타깃을 빗나가게 만든다** — 손가락이 화면 오른쪽 20%에 들어가면
   화면이 옆으로 밀려서, 놓으려던 상태 칩이 손가락 밑에서 빠져나갑니다(완료 칩에 놓았는데
   진행 중으로 저장). 해결: `autoScroll={{ threshold: { x: 0, y: 0.2 } }}` — 가로만 끄고
   세로는 유지.
10. **`pointerWithin`이 비면 `rectIntersection`으로 떨어진다** — 이때 카드의 큰 사각형이
    기준이 되어 엉뚱한 컬럼이 잡힙니다. 위 9번과 겹치면 원인 추적이 어렵습니다.
11. 터치와 마우스는 센서를 분리합니다(`MouseSensor` distance 6 / `TouchSensor` delay 200).
    하나로 합치면 모바일에서 드래그가 아예 시작되지 않거나 스크롤과 싸웁니다.

**캘린더**

12. **띠를 절대 배치로 날짜 위에 얹지 말 것**(핸드오프 경고). 주 단위 행 안에서 ①배경 셀 7칸
    ②날짜 숫자 줄 ③띠 레인 순서의 세로 흐름입니다.
13. **띠 레인이 클릭을 먹는다** — 레인 컨테이너가 칸의 아래 절반을 덮어서 날짜가 한 번에 안
    눌렸습니다. 레인은 `pointer-events-none`, 띠와 `+N건`만 `pointer-events-auto`.
14. **창이 낮으면 2줄이 안 들어간다** — 주 줄 높이를 `ResizeObserver`로 재서 띠 줄 수를
    1~`CAL_LANES`(2) 사이로 정합니다. 넘치는 건 그대로 `+N건`.

**기타**

15. **같은 상태로 저장하면 아무 일도 안 한다** — 완료 목록에서 완료 버튼이 죽은 것처럼
    보였습니다. 끝난 건은 '되돌리기'로 바꿨습니다(`dashboardParts.jsx`).
16. **`ProfileMenu`/팝오버 위치** — `useAnchoredPos(triggerRef, open, w, estH, gap, measuredRef)`.
    `measuredRef`를 넘기면 실제 높이로 다시 잡습니다. 추정 높이만 쓰면 위로 뜨는 팝오버가
    트리거에서 100px 떠 보입니다. 여는 순간 `place()`를 먼저 호출해야 첫 프레임이 `{0,0}`에
    안 그려집니다.

**데이터 로드 · 실시간 (2026-07-28 구조 변경)**

22. **목록 화면에서 `task.comments` / `task.activityLog`는 비어 있다.** 초기 로드가
    읽는 것은 팀·프로필·프로젝트·카드·리소스·첨부까지고, 댓글과 활동은 업무 창을 열 때
    그 카드 것만 읽는다(`cloudSync.loadCardDetail`). 카드 목록에 "댓글 3" 같은 걸
    붙이려면 개수를 따로 세는 경로가 필요하다 — 전체 댓글을 다시 읽으면 예전으로 되돌아간다.
23. **실시간은 표(payload.table)에 따라 갈라진다**(`cloudSync.subscribeWorkspace`).
    cards는 그 카드 1건만 다시 읽고, comments·files는 열려 있는 창일 때만 상세를 갱신하고,
    나머지는 전체 재조회다. **구독에 새 표를 추가하면 기본이 전체 재조회**이니 라우팅에
    같이 적어야 한다. comments의 DELETE payload에는 `card_id`가 없다(replica identity가
    PK뿐) → cardId가 비면 "지금 열려 있는 카드"로 본다.
24. **스토어 히스토리는 최근 20개까지.** `LOAD_STATE`는 기록을 초기화하고(서버가 원본이라
    그 이전으로 되돌리면 유령 데이터가 살아난다) `SYNC_TASK`는 기록하지 않는다.
    `SYNC_TASK`는 카드 1건을 **병합**한다 — `UPSERT_TASK`로 바꾸면 담아둔 댓글·활동·첨부가 날아간다.
25. **`store.canUndo()`를 렌더 중에 그냥 부르면 갱신되지 않는다.** `useCanUndo()`/`useCanRedo()`로
    구독한다(예전엔 카드를 옮겨도 실행 취소 버튼이 계속 비활성이었다).
26. **`cards.position`은 아무도 채우지 않는다**(전부 0). 정렬 키로 쓰면 같은 값이라
    Postgres가 순서를 보장하지 않아 카드가 뒤바뀐다. 컬럼 안 순서는
    `dashboardParts.byDue`(마감일 순)가 소유한다 — 마감 그룹 목록과 같은 함수다.

27. **RLS가 걸린 테이블에 "남의 행"을 넣을 때 `.select()`를 붙이면 전부 롤백된다.**
    `insert().select()`는 SQL의 `INSERT ... RETURNING`이라 넣은 행을 읽으려 하는데,
    `notifications`의 SELECT 정책은 본인 수신 행만(`recipient_id = auth.uid()`) 허용한다.
    그래서 42501(new row violates row-level security policy)로 insert까지 되돌아갔고,
    **멘션 알림이 한 번도 생성되지 않았다.** 호출부가 실패를 조용히 삼켜서(console.error만)
    화면에는 아무 표시가 없었고, 검증 스위트는 게스트 모드만 돌아 이 경로를 보지 못한다.
    넣기만 할 때는 `.select()`를 붙이지 않는다(`cloud.insertNotifications`).

28. **담당자를 표시명으로 붙이면 이름을 바꿀 때 카드가 남의 것이 된다.** `cards.assignees`는
    표시명 `text[]`인데 프로필 이름을 바꾸는 경로는 이 배열을 건드리지 않았고, '내 업무'는
    `assignees.includes(currentUser.name)`으로 거른다. 그래서 설정에서 이름을 한 번 고치면
    그 사람이 맡은 카드가 전부 사라져 보였다. 0013의 `card_assignees(profile_id)`가 원본이고
    **표시명은 읽을 때 `profiles`에서 파생한다** — 그래서 앱 안의 `task.assignees`는 여전히
    이름 배열이고 뷰·셀렉터·활동 기록·AI 컨텍스트는 그대로다. 조인 행이 없으면
    `cards.assignees` 컬럼으로 폴백한다(0013 전 카드, 백필 안 된 이름을 지우지 않기 위해).
    담당자 선택기는 이제 **등록된 멤버만** 고를 수 있다 — 목록 밖 이름은 그 사람이 업무를
    볼 수도 알림을 받을 수도 없어서 배정이 아니라 메모였다. 검증은 `tests/assignees.mjs`
    (게스트 모드로는 이 경로가 안 돌아서 `cloud.js`를 가짜로 바꿔친다).

29. **조인 테이블은 "전부 지우고 전부 넣기"로 맞추면 안 된다.** 왕복이 두 번이라 멱등이
    아니다. 저장 두 개가 겹치면 문장이 D1 → D2 → I1 → I2 순으로 도착하고, D2가 빈손으로
    지나가서 I2가 I1의 행과 부딪힌다(23505 duplicate key). 실제로 0013 직후 담당자를
    추가할 때 저장이 실패했다. 지금은 **집합에 없는 것만 지우고 + on conflict do nothing**
    이라 순서에 상관없다(`cloud.resetCardJoin`). 새 조인 테이블을 붙이면 같은 모양을
    쓰세요. 그리고 이 판단이 0015에서 하위 업무를 조인이 아니라 `cards.subtasks` 컬럼으로
    둔 이유이기도 하다 — 컬럼 통째 쓰기는 겹쳐도 마지막 것이 남을 뿐 깨지지 않는다.

30. **"새로 생긴 것"을 나중에 되계산하지 마세요.** 업무 저장이 활동 기록을
    `task.activityLog.slice(oldData.activityLog.length)`로 잘라냈는데, `oldData`(업무 창을
    열 때의 스냅샷)와 `newData`(스토어를 따라가는 폼)가 **다른 스냅샷**이었다. 창을 열면
    상세 로드가 스토어에만 활동을 채우므로 `oldData.activityLog`는 빈 배열이고, 그래서
    `slice(0)`이 되어 서버에 이미 있는 기록까지 다시 넣었다 → `activity_pkey` 중복 →
    카드는 저장됐는데 "저장에 실패했어요"가 떴다. 하위 업무 체크가 매번 저장을 부르면서
    드러났다. 지금은 `TaskService.updateWithLogs`가 바뀐 업무와 **이번에 생긴 기록**을
    같이 돌려줘서 그 계산 자체가 없다. `insertActivity`도 `on conflict do nothing`이다 —
    활동은 덧붙이기만 하는 기록이고 id는 클라이언트가 만든다.

31. **한 겹 더 벗기면 조용히 `undefined`가 되고, 그 자리가 "아무도 안 걸리는 필터"가 된다.**
    `cloudSync.myUserId()`가 `const { data } = await cloud.getSession()`으로 읽었는데,
    `cloud.getSession()`은 supabase의 `{ data }`를 **이미 벗겨서** `{ session, user }`를
    돌려준다. 그래서 언제나 null이었고 **알림의 본인 제외가 한 번도 걸리지 않았다.**
    멘션은 이름으로도 한 번 거르므로(`resolveMentionRecipients`) 증상이 가려졌지만,
    내 댓글에 내가 답글을 달면 나에게 알림이 왔다. 담당자 알림을 붙이면서 드러났다 —
    "본인 제외" 같은 방어는 통과가 기본값이라 깨져도 아무 소리가 안 난다. 검사를
    남겨 두세요(`tests/push.mjs`).

32. **웹 푸시의 상태 원본은 DB 행이 아니라 브라우저의 `PushSubscription`이다.**
    기기에서 권한을 껐거나 브라우저 데이터를 지우면 DB 행은 남아 있어도 알림이 오지
    않는다. 그래서 화면의 켜짐/꺼짐은 `pushManager.getSubscription()`으로 판정하고,
    죽은 행은 발송에서 410/404를 받은 서버가 지운다(`api/push.js`).
    그리고 **iOS는 홈 화면에 추가(PWA)한 뒤에만** 동작한다 — 브라우저 탭에서는
    `requestPermission()` 창 자체가 뜨지 않으므로, 묻기 전에 안내를 보여야 한다.

33. **"고정된 값 우선"과 "방금 만든 값 우선"을 `A || B`로 쓰면 둘 중 하나가 죽는다.**
    3줄 요약이 `shown = pinned || summary`였다. 그래서 고정된 요약이 있는 상태에서
    '다시 만들기'를 누르면 AI는 돌고 `summary`에 새 글이 들어오는데 화면은 옛 요약
    그대로였고, 새로 만든 것을 고정할 방법도 없었다(버튼 줄이 `pinned` 여부만 봤다).
    지금은 `shown = summary || (revealed ? pinned : '')`이고, 버튼 줄은 **지금 보고
    있는 것이 저장된 것인지**(`showingPinned`)로 갈린다. '고정' 배지도 그 기준이다 —
    새로 만든 요약에 배지가 붙으면 이미 저장된 줄로 오해한다.

34. **업무 창 안의 state는 카드가 바뀌어도 살아 있다.** 모달은 카드를 바꿀 때
    언마운트되지 않으므로(`openTaskModal`이 state만 바꾼다), `TaskViewer`의 요약
    state가 그대로 남아 **다음 카드에 앞 카드의 요약이 보였다.** `key={formData.id}`로
    카드마다 새로 마운트한다. 업무 창에 state를 새로 두면 이 점을 먼저 보세요.

**테스트 스크립트 작성 시**

17. 페이지에 주입하는 문자열은 JS 템플릿 리터럴이라 `\d`가 `d`로 죽습니다 → `[0-9]`.
18. Chrome은 `linear-gradient` 직렬화에서 `180deg`를 생략합니다 → 가로 판정은
    `to right`/`90deg` 유무로.
19. `div.hidden.md:block`은 유효한 셀렉터가 아닙니다(`md\\:block`로 이스케이프).
20. 배지 껍데기와 안쪽 텍스트가 `textContent`가 같습니다 → `children.length === 0`으로 잎
    노드만 고르세요.
21. `getBoundingClientRect()`는 조상 `overflow`에 잘려 안 보이는 요소도 좌표를 돌려줍니다 →
    보이는지 판정할 때는 조상 clip을 같이 계산해야 합니다(`tests/bottomgap.mjs`의
    `visibleBottom`).

---

## 6. 데이터 · 스키마 · 비밀

- 스키마는 `supabase/migrations/0001~0016`이고 **전부 라이브 DB에 적용**되어 있습니다
  (0001~0005는 대시보드에서 수동, 0006~0011은 `npx supabase db push --db-url "$SUPABASE_DB_URL"`로.
  접속 문자열은 로컬 `.env`의 `SUPABASE_DB_URL`에 둡니다 — 대시보드 Connect의 Session pooler URI).
  0009~0011이 한 일:
  안 쓰는 컬럼 정리(`projects.archived`·`projects.description`·`activity.payload` 삭제 —
  값이 있던 `teams.color`는 남았고 앱은 이 컬럼을 보지 않습니다. 팀 색은 `config.js`),
  activity 고아 행 정리 + cards/projects cascade, teams 쓰기는 관리자만,
  `cards.updated_by`(트리거가 채움 → 업무 창의 '수정: 이름'),
  어드바이저 경고 정리(공개 버킷 목록 조회 차단 등),
  그리고 0012에서 `pg_cron`으로 보존 기간(읽은 알림 30일 / 활동 기록 6개월,
  UTC 19:00 = KST 04:00. 확인은 `select * from cron.job`, 해제는 `cron.unschedule`).
  **`projects.description`은 이제 없습니다** — `createProject`에 다시 넣으면 실패합니다.
- 0013이 한 일: 담당자를 표시명 대신 프로필로 붙이는 `card_assignees` 조인 테이블
  (`card_teams`와 같은 모양·같은 정책). 적용 후 확인 — 카드 4건 / 조인 행 7개 /
  프로필과 못 이어진 이름 0개. `cards.assignees` 컬럼은 남겨 두었고 앱은 양쪽에
  다 쓰지만 **읽기는 조인을 먼저** 봅니다(§5의 28번).
- 0014: `projects.archived` 복구(0009에서 지웠던 것). 보관은 삭제가 아니라 탭·대시보드에서
  빼는 것이고, 보관함은 `created_at`으로 연도를 묶습니다 — 연도 컬럼을 따로 두지 않습니다.
- 0015: `cards.subtasks`(jsonb 체크리스트, 배열 제약 있음) + `cards.ai_summary`/`_at`/`_by`
  (관리자가 고정한 3줄 요약). 하위 업무를 조인 테이블이 아니라 컬럼으로 둔 이유는 §5의 29번.
  요약 쓰기는 `cloud.cardSummaryCloud`가 **그 세 칸만** 건드립니다 — 카드 폼에 실어 보내면
  요약을 고정하는 사람이 남의 편집을 같이 덮습니다. 관리자의 '고치기'도 같은 경로입니다.
- 0016: `cards.comment_count`/`file_count` + `comments`·`files`에 붙은 재계산 트리거
  (`recount_card`). 목록에서 카드를 열지 않고 대화·파일 유무를 보여주려고 **개수만**
  들고 있습니다 — 개수를 세려고 댓글을 다시 읽으면 §5의 22번으로 되돌아갑니다.
  앱이 세지 않고 트리거가 유지하므로 어느 경로로 들어와도 맞습니다(증감이 아니라
  실제 행 수 재계산이라 어긋나도 자기 회복). 전부 다시 세려면 0016 맨 아래 update문.
- 0017: `notifications.kind`에 `assign`·`due_soon` 추가 + `push_subscriptions`(기기당 한 행,
  `endpoint` unique). **체크 제약과 INSERT 정책을 같이 넓혔습니다** — 0007이 가르쳐 준
  것이고, 한쪽만 고치면 RLS로 막힙니다. `due_soon`은 INSERT 정책에서 **일부러 뺐습니다**:
  사람이 만들 알림이 아니고 서버(service key)는 RLS를 우회하므로, 넣어 두면 로그인
  사용자가 남에게 가짜 마감 알림을 보낼 수 있습니다. 적용 후 확인 — 제약 4종/정책 3종/
  push_subscriptions 8컬럼·정책 4개·RLS on.
- 0008(`0008_profile_teams.sql`) 메모: 라이브에 적용됨 — 한 사람이 여러 팀에 속하는 조인 테이블 + RLS(읽기: 로그인 사용자,
  쓰기: 본인 행만) + 기존 `profiles.team_id` 복사. 기존 컬럼은 남겨 두었고
  (`currentUser.teams?.length ? teams : [team]` 패턴으로 양쪽을 봅니다), 적용 후 데이터
  건수(프로젝트 3 / 카드 3)를 확인했습니다.
- `cloud.js`의 `listProfileTeams()` / `setMyTeams()`는 **에러를 삼킵니다** — 마이그레이션
  전 코드와 섞여도 죽지 않게 한 의도이니, 조용히 실패할 수 있음을 염두에 두세요.
- **비밀 값은 이 문서에 없고, 앞으로도 넣지 마세요.** 서버 전용(`VITE_` 접두사 금지):
  `GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, 드라이브 서비스 계정 자격증명, 드라이브 폴더 ID.
  값은 Vercel 환경변수와 로컬 `.env`에만 둡니다(`.env`, `.env.guest` 모두 gitignore).
- 프로젝트 삭제는 관리자 전용(`admins` 테이블 화이트리스트 / `VITE_ADMIN_EMAILS`).
- 오피스 미리보기는 **서명 URL이 마이크로소프트로 전달**됩니다. UI에 그 사실을 표기하고
  있고, `OFFICE_VIEWER = false`로 끌 수 있습니다.

---

## 7. 관례

- 커밋 메시지는 한국어, 제목 한 줄 + 본문에 **왜**를 씁니다. `Co-Authored-By: Claude` 라인은
  넣지 않습니다.
- 문구 톤: 담백하고 상태를 그대로 말합니다. 사용자가 고친 실제 예 —
  `여기는 다 정리됐어요` → `다 정리되었어요`,
  `지난 마감 없이 잘 굴러가고 있어요` → `지연된 업무가 없네요 :)`,
  `오늘 마감만 남았어요` → `오늘 마감되는 업무만 남았어요`,
  `마감 없음` → `마감 미정`, `+ 링크` → `+ 참고 링크`,
  `이날은 잡힌 일이 없어요` → `해당 날짜에는 업무가 없어요`.
  "없어요"로 끝나는 짧은 부정 표현과 번역투를 특히 싫어합니다.
- 빈 화면에는 로티 대신 **SVG 선 그리기 마크**를 씁니다(외부 JSON·라이브러리 없음):
  `AllClearMark`(체크), `EmptyColumnMark`(카드 한 장). 빈 상태 내용은 남는 공간의 세로
  가운데에 둡니다.
- 기능을 숨기지 않습니다. 정리하려고 '⋯' 메뉴에 넣었더니 기존에 쓰던 공유를 못 찾았습니다.
  hover로만 나타나는 조작도 같은 이유로 피합니다 — 터치 기기에는 hover가 없어서 그 기능이
  아예 없는 것처럼 보입니다(요약 버튼·하위 업무 삭제·댓글 수정에서 실제로 그랬습니다).
- **버튼 배치·색**: 대화창·팝오버는 `취소 왼쪽 / 확정 오른쪽`(웹 관행이고, 삭제 같은 확정을
  손가락이 놓이는 자리에서 떨어뜨려 두는 안전 장치입니다). 업무 창 푸터는 대화창이 아니라
  상시 도구 줄이라 `수정·저장 왼쪽 / 닫기 오른쪽`이고, 두 모드에서 자리가 같습니다 —
  저장이 오른쪽이고 수정이 왼쪽이면 저장한 순간 손가락 밑의 버튼이 다른 뜻이 됩니다.
  색은 구조색이 하나뿐이므로 행동에만 씁니다: 진한 accent = 확정(저장·새 업무),
  연한 accent = 편집 진입(수정), 무채색 = 아무 일도 안 함(닫기·취소).
  **Tailwind 기본 팔레트(`red-500` 등)를 쓰지 마세요** — 테마를 따라가지 않아 다크 모드에서
  그대로 튑니다. 토큰(`tag-red-fg` 등)만 씁니다.

---

## 8. 다음에 할 일 (준비된 설계)

### 8.1 알림 확장 + 웹 푸시 — 코드는 다 붙었고, **VAPID 키만 남았습니다**

네 덩이 전부 구현했습니다(0017 + `api/push.js` + `public/sw.js` + `src/services/push.js`).
전달 방식을 웹 푸시로 정한 이유는 §8.3에 남겨 두었습니다.

지금 도는 것:

| 종류 | 만드는 자리 |
|---|---|
| `mention` `reply` | 예전부터 (`cloudSync.notifyMentions` · `notifyComment`) |
| `assign` | `controllers.js`의 `handleSaveTask` — `newAssigneesOnly`로 **이전에 없던 담당자만** |
| `due_soon` | `api/push.js`의 GET — Vercel Cron이 하루 한 번(22:00 UTC = 07:00 KST) |

- 문구는 `src/services/notifyText.js` **한 곳**에 있습니다. 앱 안 알림 목록과 잠금화면
  푸시가 같은 함수를 봅니다 — 갈라 두면 같은 알림이 두 군데서 다르게 읽힙니다.
- 푸시는 `cloud.insertNotifications` 안에서 같이 보냅니다(`requestPush`). 그 함수가
  모든 알림의 관문이라, **알림 종류가 늘어도 푸시가 따라옵니다.** 기다리지 않고
  실패도 삼킵니다 — 앱 안 알림은 이미 들어갔으니 저장 흐름을 붙잡을 이유가 없습니다.
- 권한은 **알림 종 팝오버의 '이 기기로 알림 받기'** 에서만 묻습니다(`PushRow`).
  앱을 처음 열 때 묻지 않는 이유: 무슨 알림인지 모르는 상태에서 거부하기 쉽고,
  한 번 거부되면 브라우저 설정에서 손으로 되돌려야 합니다.
- 죽은 구독(410/404)은 발송할 때 서버가 지웁니다. 안 지우면 앱을 지운 기기로 계속
  보내고, 그 실패가 로그를 가려서 진짜 실패를 못 봅니다.
- 보관한 프로젝트의 카드는 마감 임박에서 뺍니다 — 탭·대시보드에서 이미 빠진 일입니다.
- 같은 날 두 번 알리지 않게, 넣기 전에 최근 20시간의 `due_soon`을 읽어서 거릅니다.
  유니크 제약으로 막지 못하는 이유: `(created_at at time zone 'Asia/Seoul')::date`는
  immutable이 아니라 인덱스 식으로 못 씁니다.

**환경변수는 등록·배포까지 끝났습니다** (2026-07-29, Production).
`VAPID_PUBLIC_KEY` / `VITE_VAPID_PUBLIC_KEY`(같은 값) / `VAPID_PRIVATE_KEY` /
`VAPID_SUBJECT` / `CRON_SECRET` — 값은 Vercel 환경변수와 로컬 `.env`에만 있습니다.
`VITE_` 값은 빌드 시점에 박히므로 **환경변수를 고치면 재배포가 필요합니다**
(`npx vercel redeploy <배포 URL>`).

라이브에서 확인한 것:
- 공개키가 클라이언트 번들에 실렸고 `/sw.js`는 200 + `application/javascript`
- `GET /api/push`(크론 경로)가 `{cards:2, notified:2, sent:0}` — 마감 임박 알림 2건
  실제로 생성. `sent:0`은 아직 아무도 푸시를 켜지 않아서입니다
- 다시 부르면 `{notified:0, skipped:2}` — 20시간 중복 방지가 걸립니다
- 시크릿 없는 GET, 인증 없는 POST 모두 401

**남은 것 — 실기기 확인뿐입니다** (검증 스위트는 게스트 모드만 돕니다 — §서두 3번):
- 종 팝오버의 '이 기기로 알림 받기'를 켜고, 다른 계정으로 나를 담당자로 지정 →
  잠금화면에 오는지, 눌러서 그 업무가 열리는지
- 아이폰은 **홈 화면에 추가한 뒤에** 켜야 합니다. 탭에서는 '홈 화면에 추가하면
  알림을 받을 수 있어요' 안내만 보입니다
- 마감 임박은 손으로도 부를 수 있습니다:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://church-workspace.vercel.app/api/push`

참고 — 키가 없는 환경(로컬·프리뷰)에서도 앱은 돕니다. POST가 501을 주고 '알림 받기'
줄이 숨어서 **푸시만 빠집니다.** 마감 임박 배치(GET)는 VAPID 키를 보지 않고 앱 안
알림을 만들고 발송만 건너뜁니다 — 키가 없다고 라우트 전체를 막으면 종에도 아무것도
안 떠서 "마감 임박이 아예 없는 것"과 구분이 안 됩니다. GET에 필요한 것은
`CRON_SECRET` 하나입니다.

### 8.2 그 밖에 짚어둔 것

- **`DatePicker`/`AssigneePicker` 드롭다운만 portal이 아니라 `absolute`** 입니다.
  업무 창 본문이 `overflow-y-auto`라 잘릴 수 있습니다(지금 깨지지는 않습니다).
  §5의 1번대로 body 포털이 기본이어야 합니다.
- **캘린더 띠 줄 수 상한** `CAL_LANES = 2` — 사용자가 2로 유지하기로 정했습니다.
- **검색은 아직 `String.includes()`** 입니다. "버스 견적"이 "전세버스 견적서"를 못 찾고,
  댓글·첨부 내용은 검색되지 않습니다. 여기가 RAG(pgvector)를 도입할 자리로 정리해
  두었는데, 카드 본문은 이미 컨텍스트에 다 들어가므로 **첨부 파일 내용·댓글·지난
  프로젝트 아카이브**에만 값이 있습니다. 카드에 벡터를 붙이는 것부터 시작하지 마세요.
- 성능은 측정하지 않았습니다. 이 PC에서는 실행 간 편차가 3배까지 나서, 예전에 낸 "블러
  제거로 3배 빨라졌다"는 결론은 근거가 없어 철회했습니다. 성능 주장은 같은 실행 안에서
  비교하세요.

### 8.3 "다시 제안하지 말 것" (사용자가 판단해서 뺀 것)

| 항목 | 이유 |
|---|---|
| 주간 브리핑(AI) | 품질 검증을 먼저 하기로. 팀 단위 주 1회면 월 28회라 비용은 문제가 아닙니다 |
| 순(조직) 정보 | 나중에 명단을 줍니다. 대시보드는 팀 단위 기획을 유지하고, 순은 화면 축이 아니라 사람에 붙는 속성으로만 둡니다(순별 보드를 만들지 않습니다) |
| 카카오 알림톡·친구톡 | 위 8.1의 이유. 웹 푸시로 먼저 해결합니다 |
| 반복 업무 | 지금은 아니라고 정했습니다 |
| 로티·외부 JSON | 빈 상태는 SVG 선 그리기(`dc-draw`)로 갑니다. lottie-web은 gzip 약 70KB인데(현재 메인 번들 gzip 182KB의 40%) 쓰이는 곳이 "할 일 없을 때만 보이는 화면"입니다 |
| 마감일 필수화 | 강제하면 아무 날짜나 넣어서 '지연' 숫자가 거짓이 됩니다. 대신 마감 미정 구간 + 2주 방치 표시로 해결했고, 안내 문구는 "마감일을 정하면 캘린더에서 볼 수 있어요" |

### 8.4 알려진 상태

- **`docs/DESIGN.md`는 현재 기준이 아닙니다.** 문서 머리에 그렇게 적어 두었습니다.
  초기 토큰 구조의 참고 자료이고 값은 전부 갈렸습니다(accent `#0075de` → `#3f6fc4`,
  Pretendard → SUIT Variable). 시각 기준은 §1의 외부 핸드오프 번들과 §3입니다.
- 폰트는 §3대로 두 조각으로 나눠 두었습니다. 더 줄이려면 조각을 더 잘게 나누는 길이
  남아 있는데, 재보고 접었습니다(빈도별 92조각: 합계 610→920KB로 늘고 첫 화면이
  28조각 485KB. 이유는 `scripts/subset_suit.py` docstring에).
- **메인 번들 657KB(gzip 189KB)** 는 손대지 않았습니다(푸시 붙이면서 633→657KB). TipTap·pdf.js는 이미 분리돼
  있고 남은 큰 덩이는 supabase-js·dnd-kit·React입니다.
- 어드바이저 경고 중 두 개는 **의도해서 남긴 것**입니다: `is_admin()`을 로그인 사용자가
  실행할 수 있는 것(RLS 정책이 평가할 때 필요합니다. 불러도 "나는 관리자인가"만 알 수 있습니다),
  그리고 Leaked Password Protection(구글·카카오 OAuth만 쓰므로 저장하는 비밀번호가 없습니다).
  `rls_auto_enable()`은 이 레포가 만든 함수가 아니라 PUBLIC 권한만 회수했습니다 — 정체를
  확인하려면 대시보드 Database > Functions를 보세요.
- 구글 드라이브 첨부 이관은 보류 상태(현재는 Supabase Storage private 버킷).
  계획은 `docs/DRIVE.md`.
- `tests/`는 헤드리스 Chrome이 있는 로컬에서만 돕니다. CI에 붙이려면 Chrome 설치와
  `CHROME` 환경변수가 필요합니다.

---

## 9. 새 기능을 붙일 때 (이 레포의 흐름)

이번 회차에 기능 여덟 개를 붙이면서 매번 같은 순서를 밟았습니다. 그대로 하면 됩니다.

1. **저장 자리를 먼저 고릅니다 — 컬럼이냐 조인 테이블이냐.**
   카드와 언제나 같이 읽고 쓰고 항목이 몇 개뿐이면 **컬럼**(jsonb라도)이 맞습니다.
   조인 테이블은 따로 조회·집계할 이유가 있을 때만. 이유는 §5의 29번 — 조인은 왕복이
   두 번이라 저장이 겹치면 깨지고, 컬럼은 마지막 것이 남을 뿐입니다.
2. **앱 안의 모양은 그대로 두는 쪽을 먼저 봅니다.** 0013이 담당자를 조인으로 옮겼는데도
   `task.assignees`는 여전히 이름 배열입니다. 그래서 셀렉터·뷰·활동 기록·AI 컨텍스트를
   한 줄도 안 고쳤습니다. 저장 계층만 바꾸는 길이 있는지 먼저 찾으세요.
3. **마이그레이션은 dry-run 먼저.**
   `npx supabase db push --db-url "$SUPABASE_DB_URL" --dry-run` → 새 파일만 대상인지 보고
   `--yes`로 적용 → **psql로 결과를 눈으로 확인**(컬럼·제약·정책·백필 건수).
   되돌리는 SQL을 마이그레이션 파일 맨 아래 주석으로 같이 적어두세요.
4. **코드가 새 컬럼을 읽기 시작하면 마이그레이션이 먼저 나가야 합니다.** 조회에 없는
   관계를 넣으면 `loadCloudState`가 던지고 **모두에게 오류 화면**이 뜹니다.
   순서는 마이그레이션 → 푸시.
5. **검사 하나를 남깁니다.** 화면이면 브라우저 스위트에, 순수 로직이면 `logcheck`에.
   그리고 **일부러 되돌려서 실제로 실패하는지 확인하세요.** 이번에 두 번 걸렸습니다:
   담당자 조인 문장 모양 검사, 그리고 활동 기록 검사(첫판은 옛 방식도 통과해서 다시 썼습니다).
6. **클라우드 경로는 직접 확인해 달라고 부탁합니다.** 검증 스위트는 게스트 모드만 돕니다.
   이번 회차의 버그 두 개(담당자 duplicate key, `activity_pkey`)는 둘 다 사용자가 실제로
   써 보고 알려준 것입니다.
7. **HANDOFF·README·`tests/README.md`를 같이 고칩니다.** 스위트 수·단정 개수·
   마이그레이션 표가 낡으면 다음 사람이 그걸 믿습니다.
