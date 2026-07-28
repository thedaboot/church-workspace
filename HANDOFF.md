# 인수인계 — 더다붓 워크스페이스 리디자인 (2026-07-28 기준)

다음 사람이 이 코드를 처음 열었을 때 **어디를 보면 되는지**, 그리고 **이미 한 번 밟은 함정을
다시 밟지 않도록** 정리한 문서입니다. 기능 소개는 [`README.md`](README.md)에 있습니다(단,
디자인 시스템 절은 낡았습니다 — 아래 "README와 어긋난 부분" 참고).

- 레포: `github.com/thedaboot/church-workspace` · 브랜치 `main`
- 마지막 커밋: `4e59daf` (모바일 하단 여백 + 검증 스위트 레포 편입)
- 배포: Vercel, `main` 푸시 시 자동
- 검증: `npm run verify` → 20개 스위트 270 pass (약 6분)

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
src/index.css               토큰(--app-*, --p-*) · 모션(dc-*) · 그리드 유틸 · SUIT 폰트
src/config.js               팀·상태 상수, teamColor/teamBgColor/teamBar/teamPaint
src/components/layout.jsx   TopNav(데스크톱 2줄) / MobileTopBar / MobileTabBar / ProfileMenu
                            / SearchBox / NotificationBell
src/components/boards.jsx   칸반 보드(dnd-kit) + 캘린더(주 단위 행) + 카드 + 상태 칩
src/views/views.jsx         DashboardView / ProjectView / MyTasksView / TeamView / TeamFilterBar
src/views/dashboardParts.jsx  세 화면이 공유하는 부품: 마감 구간 계산, KpiCell, Bar,
                            StatusSegments, DueGroupList, TeamLeftGrid, SectionHead, Card
src/modals/modals.jsx       업무 상세·수정, 프로필(설정), 프로젝트 생성/이름 변경
src/services/               cloud.js(Supabase) · cloudSync.js(모양 변환) · ai.js(Gemini
                            프롬프트+컨텍스트) · markdown.js · domain.js
src/store/                  useSyncExternalStore 기반 커스텀 스토어 + 셀렉터
tests/                      검증 스위트 + 러너 (README는 tests/README.md)
```

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
- 폰트: **SUIT Variable**(`@sun-typeface/suit`), Pretendard는 폴백으로만 남아 있습니다.
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

- 스키마는 `supabase/migrations/0001~0008`. **0008(`0008_profile_teams.sql`)은 라이브 DB에
  이미 적용**했습니다 — 한 사람이 여러 팀에 속하는 조인 테이블 + RLS(읽기: 로그인 사용자,
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

- **README와 `docs/DESIGN.md`의 디자인 시스템 절이 낡았습니다.** Pretendard·노션 스펙·
  사이드바 기준으로 쓰여 있는데 실제로는 SUIT + 외부 핸드오프 + 상단 2줄 내비입니다.
  여기 있는 §3이 현재 기준입니다. 두 문서를 갱신하거나, 최소한 §3을 가리키게 해야 합니다.
- 구글 드라이브 첨부 이관은 보류 상태(현재는 Supabase Storage private 버킷).
  계획은 `docs/DRIVE.md`.
- `tests/`는 헤드리스 Chrome이 있는 로컬에서만 돕니다. CI에 붙이려면 Chrome 설치와
  `CHROME` 환경변수가 필요합니다.
- 성능은 측정하지 않았습니다. 이 PC에서는 실행 간 편차가 3배까지 나서, 예전에 낸 "블러
  제거로 3배 빨라졌다"는 결론은 근거가 없어 철회했습니다. 성능 주장은 같은 실행 안에서
  비교하세요.
