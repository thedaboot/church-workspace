# 인수인계 — 더다붓 워크스페이스 리디자인 (2026-07-28 기준)

다음 사람이 이 코드를 처음 열었을 때 **어디를 보면 되는지**, 그리고 **이미 한 번 밟은 함정을
다시 밟지 않도록** 정리한 문서입니다. 기능 소개는 [`README.md`](README.md)에 있습니다(단,
디자인 시스템 절은 낡았습니다 — 아래 "README와 어긋난 부분" 참고).

- 레포: `github.com/thedaboot/church-workspace` · 브랜치 `main`
- 최근 작업은 `git log --oneline -15`로 봅니다 (여기에 커밋 해시를 적어 두면
  커밋마다 손으로 고쳐야 해서 금방 낡습니다 — 실제로 한 번 어긋나 있었습니다)
- 배포: Vercel, `main` 푸시 시 자동
- 검증: `npm run verify` → 21개 스위트 293 pass (약 6분).
  293은 단정 개수이고 스위트는 21개입니다 — 평소에는 `npm run verify -- handoff navsmoke`처럼
  골라 돌리고(수십 초), 푸시 직전에 한 번 전부 돌리는 흐름입니다.

### 이 문서 밖에 있는 것 (레포만 받아서는 알 수 없는 것)

1. **시각 규격의 원본**은 아래 §1의 외부 핸드오프 번들이고 레포에 없습니다. 규격 논쟁이
   생기면 그 문서가 기준입니다.
2. **비밀 값**은 로컬 `.env`와 Vercel 환경변수에만 있습니다(§6). 마이그레이션을 돌리려면
   `.env`의 `SUPABASE_DB_URL`(대시보드 Connect의 Session pooler URI)이 필요합니다.
3. **검증 스위트는 게스트 모드만 돌립니다.** 로그인·실시간·알림·첨부처럼 클라우드에서만
   도는 경로는 테스트가 보지 못합니다 — 실제로 멘션 알림이 한 번도 생성되지 않던 버그를
   이 사각지대가 가리고 있었습니다(§5의 27번). 그쪽을 건드리면 두 브라우저로 직접 확인하세요.

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
src/views/views.jsx         DashboardView / ProjectView / MyTasksView / TeamView / TeamFilterBar
src/views/dashboardParts.jsx  세 화면이 공유하는 부품: 마감 구간 계산(byDue·groupByDue),
                            KpiCell, Bar, StatusSegments, DueGroupList, TeamLeftGrid, SectionHead, Card
src/modals/modals.jsx       업무 창 — 껍데기(TaskModalShell) · 보기 · 수정 폼 · 담당자 선택
src/modals/attachments.jsx  업무 창의 첨부 영역(업로드·미리보기 열기·삭제)
src/modals/comments.jsx     업무 창의 댓글 · 활동 기록 패널
src/modals/settings.jsx     내 정보(이름·팀·연결된 계정) / 프로젝트 만들기·이름 수정
src/services/               cloud.js(Supabase) · cloudSync.js(모양 변환 + 실시간 라우팅)
                            · ai.js(Gemini 프롬프트+컨텍스트) · markdown.js · domain.js
src/store/                  useSyncExternalStore 기반 커스텀 스토어 + 셀렉터
scripts/subset_suit.py      폰트 조각 생성(한 번 돌리고 결과물을 커밋 — §3)
tests/                      검증 스위트 + 러너 (README는 tests/README.md)
```

업무 창 네 파일은 서로를 이렇게 부릅니다: `modals.jsx`가 `attachments.jsx`와
`comments.jsx`를 가져다 쓰고, `settings.jsx`는 App이 직접 가져옵니다.

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
- 0016: `cards.comment_count`/`file_count` + `comments`·`files`에 붙은 재계산 트리거
  (`recount_card`). 목록에서 카드를 열지 않고 대화·파일 유무를 보여주려고 **개수만**
  들고 있습니다 — 개수를 세려고 댓글을 다시 읽으면 §5의 22번으로 되돌아갑니다.
  앱이 세지 않고 트리거가 유지하므로 어느 경로로 들어와도 맞습니다(증감이 아니라
  실제 행 수 재계산이라 어긋나도 자기 회복). 전부 다시 세려면 0016 맨 아래 update문.
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

---

## 8. 남은 일 / 알려진 상태

- README는 정리했습니다(디자인 절은 여기 §3을 가리킵니다). **`docs/DESIGN.md`는 여전히
  낡았습니다** — 노션 스펙·Pretendard 기준이라 현재 화면과 맞지 않습니다. 참고용으로만
  남겨 두었고, 시각 기준은 §1의 외부 핸드오프 문서와 §3입니다.
- 폰트는 §3대로 두 조각으로 나눠 두었습니다. 더 줄이려면 조각을 더 잘게 나누는 길이
  남아 있는데, 재보고 접었습니다(빈도별 92조각: 합계 610→920KB로 늘고 첫 화면이
  28조각 485KB. 이유는 `scripts/subset_suit.py` docstring에).
- **메인 번들 633KB(gzip 182KB)** 는 손대지 않았습니다. TipTap·pdf.js는 이미 분리돼
  있고 남은 큰 덩이는 supabase-js·dnd-kit·React입니다.
- 손대지 않은 개선 후보: `DatePicker`/`AssigneePicker` 드롭다운만 portal이 아니라
  `absolute`(모달 본문이 `overflow-y-auto`라 잘릴 수 있음. 지금 깨지지는 않습니다),
  캘린더 띠 줄 수 상한(`CAL_LANES = 2` — 사용자가 2로 유지하기로 정했습니다).
- 어드바이저 경고 중 두 개는 **의도해서 남긴 것**입니다: `is_admin()`을 로그인 사용자가
  실행할 수 있는 것(RLS 정책이 평가할 때 필요합니다. 불러도 "나는 관리자인가"만 알 수 있습니다),
  그리고 Leaked Password Protection(구글·카카오 OAuth만 쓰므로 저장하는 비밀번호가 없습니다).
  `rls_auto_enable()`은 이 레포가 만든 함수가 아니라 PUBLIC 권한만 회수했습니다 — 정체를
  확인하려면 대시보드 Database > Functions를 보세요.
- 구글 드라이브 첨부 이관은 보류 상태(현재는 Supabase Storage private 버킷).
  계획은 `docs/DRIVE.md`.
- `tests/`는 헤드리스 Chrome이 있는 로컬에서만 돕니다. CI에 붙이려면 Chrome 설치와
  `CHROME` 환경변수가 필요합니다.
- 성능은 측정하지 않았습니다. 이 PC에서는 실행 간 편차가 3배까지 나서, 예전에 낸 "블러
  제거로 3배 빨라졌다"는 결론은 근거가 없어 철회했습니다. 성능 주장은 같은 실행 안에서
  비교하세요.
