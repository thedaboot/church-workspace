# 함정 · 구조 색인 — 더다붓 워크스페이스

2026-09-11에 `HANDOFF.md`의 §4(무엇이 어떻게 되어 있나)·§6(이미 밟은 함정)을 여기로 옮겼다. **번호는 절대 바꾸지 마세요** — 코드 주석 여든 곳이 `§6-9-as`·`§6-29-c`처럼, 서른 곳이 `§4.2`처럼 이 번호를 가리킨다.
새 항목은 중간에 끼우지 말고 `9-a`처럼 갈라 쓴다. 한 항목은 세 줄까지다. 경위·날짜·대화 인용은 git 이력에 있다 — 여기는 **무엇이 깨지고, 무엇을 하면 되고, 어느 파일인지**만. 자세한 사정은 그 파일의 머리말 주석에 있다.

---

## §4 무엇이 어떻게 되어 있나

### §4.1 검증

- 기본은 **골라서** `npm run verify -- calfit drag`. 전체(약 7분)는 **사용자가 부를 때만** — 푸시 직전도 아니다. 손잡이: `-- --jobs 3` · `SHOTS=1` · `CHROME=<경로>`. 헤드리스 Chrome이 있는
  로컬에서만 돈다.
- **스위트가 도는 동안 레포 파일을 고치지 마세요.** vite가 아무 파일 변경에도 페이지를 새로고침해서 (`HANDOFF.md`도 그렇다) 좌표를 재던 발밑이 사라지고 **코드가 깨진 것과 똑같이 보인다.**
- **`CRASH`를 그냥 넘기지 마세요.** 셀렉터를 못 찾아 스크립트가 죽은 것이고 `FAIL` 줄이 없어 통과처럼 보인다. 스위트는 못 찾으면 던지지 말고 FAIL로 남긴다(§6-40). 깨진 스위트는 **혼자 다시 돌려 보는 것이 첫 수순**(§6-42-a).

### §4.2 디자인 토큰 · 모션

`src/index.css` 한 곳. `@theme inline`으로 `bg-surface`와 `var(--app-surface)`가 같은 값을 본다.

- **진행 바 파스텔** `--p-track/-blue/-red/…`(다크는 별도) · **이징 하나** `--ease-out-quint`(새로 만들지 않는다).
- **애니메이션 클래스** `.dc-screen` `.dc-row` `.dc-card` `.dc-kpi` `.dc-pop` `.dc-bar-fill`(scaleX) `.dc-draw`/`-2`/`-3` `.dc-draw-ring` `.dc-skeleton`
  `.dc-fade` `.dc-nav-fwd`/`-back`.
- **`transform`/`opacity`만** 애니메이션한다(진행 바도 scaleX). `prefers-reduced-motion`에서 전부 해제(`tests/handoff`).
- **순서가 있는 애니메이션은 앞 것이 끝난 뒤에 시작한다**(`.dc-draw` .1+.44 → `-2` .54+.24 → `-3` .78+.24 · `.dc-draw-ring` .28 → `AllClearMark` 체크). **한쪽 길이를 바꾸면 짝도 고친다.**
- **줄 순번 지연은 첫 마운트에서만**(`useEnterStagger`) — fill-mode가 both라 나중에 붙는 줄이 혼자 늦게 나타난다.
- **진행 바는 0에서 자란다**(`Bar` · 160ms 뒤 실제 값 · reduced-motion이면 처음부터 최종 값 — 안 그러면 빈 바가 남는다). **한 줄에 놓인 칸은 전부 애니메이션을 받거나 전부 안 받는다.**
- **빈 화면은 남는 공간의 정가운데 + SVG 선 표식**(`AllClearMark`·`EmptyColumnMark`·`GraphEmptyMark`, 로티는 §7).
- **자리가 안 움직이면 떠오르지 말고 밝아진다** — `.dc-fade`(내용만) · `.dc-nav-*`(교회 축 사이 7px, 업무 축에는 안 붙인다 — 드래그 화면 위에 transform 조상을 만들지 않는다, §6-1). 가로 스크롤 줄은
  `x-scroll-lock`.
- **폰트 SUIT Variable** — `scripts/subset_suit.py`의 두 조각을 커밋해 두었다. **UI에 새 기호를 쓰면** 그 스크립트의 `LATIN` 범위에 넣고 다시 돌린다(범위 밖은 시스템 폰트로 떨어진다). 결합 부호·기하 도형은
  `symbols.css`(§6-9-au).
- **아이콘 lucide**(`stroke-width 1.4px`), 이모지 아이콘 금지, **선으로만 그린 아이콘에 `fill`을 주지 마세요.** 브랜드 마크는 `simple-icons`의 path만 `linkIcons.jsx`에 커밋(패키지 의존성 없음).
- 반응형 그리드 유틸 `.dash-grid` · `.side-grid` · `.kpi-grid`.

### §4.3 알림 · 웹 푸시

- 만드는 자리: `mention`·`reply` = `cloudSync.notifyMentions`/`notifyComment` · `reaction` = `comments.jsx` (그 댓글의 **첫 반응 한 번만**) · `assign` =
  `controllers.handleSaveTask` · `due_soon`·`worship_today` = `api/push.js` GET(크론 둘이 `?job`으로 **같은 입구**를 나눠 쓴다 — Hobby는 크론 2개) ·
  `service_published`·`note_shared` = `worship.js` · 동아리·모임 셋 = `groups.js`.
- **문구는 `services/notifyText.js` 한 곳**(앱 목록과 잠금화면 푸시가 같은 함수를 본다). 딥링크는 `notifications.link`(0053).
- 푸시는 `cloud.insertNotifications` 안에서 같이 보낸다 — 종류가 늘어도 따라오고 본인은 관문에서 거른다(§6-31-g).
- 권한은 **종 팝오버의 '이 기기로 알림 받기'** 에서만 묻는다. iOS는 홈 화면에 추가한 뒤에만 된다(§6-30).
- 키가 없는 환경에서도 앱은 돈다(POST 501 · 마감 배치는 앱 안 알림만). GET에 필요한 것은 `CRON_SECRET` 하나.
- **`VITE_` 값은 빌드에 박히므로 환경변수를 고치면 재배포**(`npx vercel redeploy <URL>`).

### §4.4 3줄 요약 · AI 맥락

- **AI가 무엇을 보고 무엇을 쓰는지는 `docs/AI.md`가 기준이다.** 사람이 바뀌면 코드가 아니라 `profiles.role_note`(0030).
- 저장 자리 `cards.ai_summary`/`_at`/`_by`(0015) · 쓰기는 `cloud.cardSummaryCloud`가 **그 세 칸만** 건드린다.
- **고정해도 열자마자 펼치지 않고, 저장된 것을 보여주므로 AI를 다시 부르지 않는다.** 그래도 '분석하는 중'을 2초 보여준다(`REVEAL_MS`) — **성능 문제로 오해하고 지우지 마세요, 사용자가 원해서 넣은 지연이다.**
- **고정은 마스터만**(0028) — DB는 막지 않는다(§4.5). 배지는 관리자에게만 보이고 고정한 사람 이름은 안 붙인다.
- **다듬기의 관련 업무 링크**: AI에게 uuid를 쓰게 하지 않고 `[[업무:제목]]`만 쓰게 한 뒤 `ai.resolveTaskLinks`가 **제목 정확 일치**로 딥링크를 만든다(못 찾으면 글자로 · 파일 확장자 제목은 제외).
- **순모임 가이드**(`services/sunGuide.js` · 0039·0055): 템플릿을 **JSON으로만** 채우고 `fitGuide`가 문장 경계에서 자른다. `passage.ref`·`title`은 **모델 값이 아니라 주보 값**이고 번호·'Q.'는
  화면이 붙인다. 보기=만들기=순장∨ `can_manage_sun`, **고정은 마스터만**(rpc). 화면의 마스터 판정은 `perms.isMaster`(`useAuth().isMaster`는 게스트에서 참).

### §4.5 권한이 어디서 막히나

- 앱에 들어오기 — 승인 전에는 안내 화면만 · DB도 0행(모든 내용 표에 `is_approved()` · 0022).
- 가입 수락·환송 = 관리자 · **관리자 지정·해제 = 마스터만**(0029 · 자기 자신은 삭제 불가) · 팀 쓰기 = 관리자(0009).
- **프로젝트 삭제 = 전원**(0021 사용자 결정) · 업무 삭제 = 작성자·관리자 · 알림·푸시 구독 = 본인 행만(0005·0017).
- AI 요약 고정은 화면에서 마스터만, **DB는 막지 않는다**(`cards_update`가 authenticated 전체 — 요약은 다시 만들면 되는 값이라는 판단. 진짜로 사라지는 일은 `is_admin()`으로 DB에서 막는다).
- **관리자 원본은 `admins` 표 하나**(0022)이고 화면도 `is_admin()` rpc로 묻는다. `VITE_ADMIN_EMAILS`는 코드·문서·`.env.example`에서 전부 지웠다 — **다시 넣지 마세요.**
- 관리자는 자기 승인 여부와 무관하게 통과한다(관리자가 잠기면 아무도 승인할 수 없다). `AuthGate`는 승인 전에 워크스페이스를 마운트하지 않고, 권한을 모르는 동안(`null`)은 승인된 것으로 본다. v2 자격 표는 `docs/V2.md` §1.

### §4.6 프로젝트 헤더 (모바일)

- **개수가 변하는 것과 고정된 것을 같은 가로 스크롤 칸에 두지 않는다** — 참고 링크는 미는 칸 안, 공유·삭제는 그 칸 **밖**(왼쪽 실선으로 "여기가 끝"을 보여준다). **`+ 참고 링크`도 미는 칸 밖**(안에 두면 점선 상자가 잘린다).
- 모바일 두 줄은 flex가 아니라 **그리드**(`grid-cols-[minmax(0,1fr)_auto]` → `md:flex`)이고 감싸개를 `contents`로 지워 칸 넷이 2×2로 선다. **액션이 `새 업무`와 같은 칸**이라는 것이 핵심(§6-9-a).
- 실선·공유·삭제는 한 덩이로 그 칸의 **가운데**에 서고 `-mr-2`로 아이콘 여백을 상쇄한다(§6-9-b). 세로는 `items-center`.
- **담당자 얼굴은 진척 바 뒤**, `personLoad`로 **남은 업무를 맡은 사람만** 4명까지(나머지 `+N`, 이름 글자 없음).
- 이 줄에서 **양보하는 것은 메타 글자뿐**(`truncate min-w-0`) — 안 그러면 얼굴이 버튼 밑으로 파고든다(§6-9-c). 기준선은 헤더 아래 실선이고 `tests/three.mjs`가 지킨다. 여기서 검토하고 접은 것 셋은 §7에 있다.

### §4.7 프로필 사진

- **사진은 이미 전원 다 있었다** — `ensureMyProfile`이 `avatar_url`을 넣고 있었는데 앱이 읽지 않았을 뿐이다.
- **동그라미는 `components/Avatar.jsx` 한 곳**(9곳에서 쓴다). 없거나 깨지면 이름 첫 글자 원으로 돌아가고, 주소는 이름으로 찾는다(`cloudSync.getAvatar(name)`) — 같은 이름이 여럿이면 §6-34-f.
- **`display`는 이 부품이 정하지 않는다**(기본 클래스에 박으면 호출부의 `hidden`이 진다 · §6-4).
- **카카오 사진 주소는 `http`** 로 온다 → `utils.httpsImage`(순수 함수, logcheck가 검사).
- 직접 바꾸기는 '내 정보'의 `사진 변경`/`기본으로`. 저장소는 본문 이미지의 `content-images` 버킷을 그대로 쓰고 (마이그레이션 없음) `squareThumb`으로 가운데를 정사각 256px jpeg로 줄인다.
- **안 건드렸으면 payload에서 키를 빼야 한다** — `avatarUrl: undefined`를 넘기면 지금 사진이 사라진다.

### §4.8 대시보드 '사람' 칸 · 달력 생일 (0019)

- 데스크톱은 오른쪽 칸 맨 위, 모바일은 KPI 아래(감싸개를 `contents`로 지우고 `order-first`). **세 줄뿐이고 없는 줄은 안 그린다**(오늘 다녀간 사람 · 생일 7일 전부터 · 새로 온 사람 3일) · 상한 `PEOPLE_ROWS = 2`.
- 머리줄 `N명`을 누르면 `MembersModal`이 열리고 **`createPortal`로 body에 띄운다**(§6-1).
- **`last_seen_at`은 심장박동이다** — 보이는 동안 5분마다 · 떠날 때 한 번(`stampLeaveBeacon`, keepalive) · **REST 쓰기가 나갈 때마다**(1분 스로틀). 찍는 자리는 `cloudSync.markSeen` 하나,
  관찰자는 `supabaseClient.setWriteObserver`이고 **rpc는 반드시 제외**(스탬프가 스스로를 불러 무한 루프).
- **시각은 서버가 정한다**(0048 rpc) — 한 화면에 나란히 놓이는 두 값은 같은 시계를 봐야 한다.
- 고르는 순서는 `presence > max(last_seen_at, 최근 activity) > 가입`이고 가운데를 만드는 것이 `utils.mergeActivitySeen`(서버 왕복 0 · 바뀐 게 없으면 **받은 배열을 그대로** 돌려준다). 두 화면이 같은
  함수를 지난다.
- **`activity`로 세지 않는다**(보기만 한 사람이 빠진다) · **카드별 조회 추적은 §7** · **순위·점수·판정어를 두지 않는다.**
- 달력의 생일은 날짜 숫자 **옆의 작은 얼굴**(띠 레인은 두 줄뿐 — `CAL_LANES`). 세는 로직은 전부 `utils.js`의 순수 함수이고 logcheck가 지킨다. `todayLocal()`과 값 파싱을 겸하지 말 것(두 번 데었다).

### §4.9 최근 활동 · 프로젝트 연결 지도 · 업무 선후관계 (0020)

- **최근 활동 피드는 카드별로 묶는다**(`groupFeed` · 다섯 카드까지) · activity 이벤트는 전체 재조회가 아니라 피드만 다시 읽는다(500ms 디바운스) · 피드 줄에 `.dc-row`를 붙이지 말 것(검사가 그 클래스로 마감 행을 센다).
- **연결 지도는 힘 배치 노드 그래프이고 고른 해만 본다.** 물리 `utils.forceStep`, 루프·드래그 `useForceGraph`이며 **프로젝트 그래프 뷰와 한 벌이다 — 갈라 두지 마세요.** x 앵커·열 머리글·선 길이는 `FM.AX_*` 한 곳을
  본다.
- **사용자가 정한 것**: 팀은 가운데 열 고정 · 사람·프로젝트는 자기 영역(`zx`) 밖으로 못 나감 · **alpha 냉각으로 멈춤**(상수 감쇠만 쓰면 깨울 때마다 진동) · **끌어다 놓은 노드는 그 자리 고정**(`pinnedIds`) · **끌기는
  그대로**.
- **첫 페인트 전에 조용히 미리 돌린다**(`SETTLE_*` — 초기 폭발이 "촥 펼쳐짐"으로 읽혔다. 초기 x를 두 열로 벌리는 방법은 효과가 없었다) · **선의 목표 길이는 두 층의 앵커 간격**(`EDGE_OF` — 고정값은 앵커와 줄다리기한다).
- 데스크톱은 카드 폭을 다 쓰고 높이는 `가장 붐비는 층 × 30 + 60`(상한 `FM.H_MAX_*`) · **사람·프로젝트는 자기 팀의 띠 높이에 선다**(`ay` — 가독성을 망친 것은 라벨 겹침이 아니라 선의 교차였다) · **겹침은 그릴 때
  푼다**(`spreadLabels`).
- **선 굵기 = 같이 맡은 업무 수, 선의 유무는 멤버십**(업무 수로 선을 만들면 일 없는 사람이 팀에서 사라진다) · **강조는 id로 기억하고 호버는 진짜 마우스에만**(`pointerType === 'mouse'`) · **폭을 재기 전에는 노드도 만들지
  않는다.**
- **연도로 거른다** — 값은 `hooks/useProjectYear` **모듈 스토어 하나**라 지도·'프로젝트 진행'·탭 줄이 같이 따라가고, 바꿀 때 지도가 화면에서 안 움직이게 보정한다(`pickYear` · 스크롤하는 것은 창이 아니라 `main`이다).
- **업무 선후관계는 `cards.depends_on`**(uuid[] · §6-27) · 깊이(`depLayers`)는 x 앵커로만 남고 선이 없는 업무는 격자 앵커로 면에 편다 · 선행이 끝났으면 초록, 아직이면 회색. 선의 교차는 구조적으로 남는다(고치려면
  **먼저 물어보세요**).
- **presence는 `services/presence.js`가 채널을 직접 소유**(스토어에 섞으면 재조회마다 사라진다)하고 `utils.viewersOf`가 사람마다 `at`이 가장 큰 meta **하나만** 남긴다(§6-24-b) · 교회 화면은
  `projectId`가 null · realtime-js의 ref 버그를 `healRefs`가 join·leave **둘 다**에서 메운다. **상대 시간 라벨은 `useMinuteTick`을 그 라벨이 있는 컴포넌트에만** 붙인다.
- **수정 모드에도 업무 창 사이드바를 그대로 둔다** · `useStore` 셀렉터에서 **매번 새 배열을 만들면 무한 리렌더**다.

### §4.10 대시보드 인사말

- 인사말은 **나에게 말을 거는 문장**이라 `utils.myScope`로 내 것만 센다(담당자 없는 업무는 '공통'으로 함께). KPI·목록은 상단 세그먼트를 따라간다 — 그건 필터의 일이다.
- 내 지연은 없는데 KPI에 숫자가 있는 경우(남의 것)를 위해 **`잘하고 있어요!`** 를 따로 둔다. `내가 맡은 업무에는 없네요`는 **남과 견주는 문장**이라 쓰지 않는다(§8).

### §4.11 댓글 답글 (2026-08-31)

- **답글 입력은 댓글 입력과 같은 부품·같은 규칙**(`MentionInput` · Enter=등록 · Shift+Enter=줄바꿈). 갈라 두면 @멘션 자동완성이 없어 **알림이 아무 오류 없이 그냥 안 간다**(표시명 정확 일치 — §6-45).
- **취소·답글 버튼이 있다**(모바일에는 Esc가 없다) 그래서 Enter/Esc 안내 문구를 뺐다. `○○님에게 답글` 한 줄과 `답글 3`(작성 중이면 `· 작성 중`)이 언제나 보인다 — hover로만 나오면 §8 위반.
- **초안은 원 댓글별**(`replyDrafts`)이고 접어도 남는다 · `keepVisible`을 작성칸에 걸어 둔다.
- **답글의 답글은 없다**(한 단계만 · 저장 구조 `comments.parent_id`는 받는다). `tests/modalclose`가 지킨다.

### §4.12 목록 순서 — 무엇이 위로 오나 (2026-08-31)

- 정렬 규칙은 `utils.js`의 순수 함수이고 logcheck가 지킨다. **'끝낸 날'은 언제나 `utils.completedTime` (= `cards.completed_at`)이다** — `updatedAt`은 첨부만 올려도 트리거가 밀어 올린다.
- 마감 목록 = `byDue`("앞으로 무엇이 급한가") · **'끝낸 업무' 구간 = `byCompleted`**(0033, 방금 끝낸 것이 맨 위) 이고 **그 구간은 날짜 칸도 끝낸 날**(`rowDate`) · 칸반 컬럼 안 = `position` →
  `byDue`(0024) · 프로젝트 탭 = `position` → `createdAt`(0021) · 가입한 사람 모달 = `visitOrder`(§4.9).
- 선행 업무 후보 = `byNewest`(`createdAt`↓) — **`updatedAt`을 보지 않는다**(남이 옛 제목만 고쳐도 순서가 흔들린다).
- **정렬 기준은 화면에 보여야 한다** — `무엇으로 세우나`와 `무엇을 보여주나`가 같은 값인지 먼저 확인한다.
- **`completed_at`의 주인은 DB 트리거 하나**(`set_card_updated_meta`) — 저장 경로가 넷이라 앱에서 채우면 한 곳을 빼먹는다. `cardPatch`는 이 칸을 보내지 않고 게스트만 앱이 채운다(규칙이 트리거와 한 글자도 달라선 안
  된다).
- 새 칸을 만들면 **그 값을 쓰던 자리를 전부 grep해서 옮긴다**(0033·0034에서 한 자리를 빼먹었다).

## §6 이미 밟은 함정

코드에는 각 지점에 왜 그렇게 했는지 주석이 달려 있다. 여기 있는 것은 그 주석의 색인이다.

### 레이아웃 · CSS

0. **포털로 띄운 팝오버는 '바깥 클릭' 판정에 자기 자신도 넣어야 한다.** 앵커 ref만 보면 팝오버 안을 누르는 것이 '바깥'이 되어 mousedown에서 닫힌다 — 참고 링크가 이것 때문에 한 건도 저장되지 않았다. 앵커 ref + 본체 ref 둘 다.
   **`el.click()`으로는 재현되지 않는다**(mousedown이 안 나간다).
1. **`position: fixed`가 뷰포트 기준이 아니게 된다** — `.dc-screen`·`.dc-card`의 transform이 조상 containing block이 되어 `DragOverlay`가 100px 아래에서 떴다. fixed로 띄우는 것은 전부
   `createPortal(…, document.body)`.
2. **스크롤 컨테이너의 `padding-bottom`은 넘친 내용에 적용되지 않는다** — `h-full`은 내부 스크롤이 필요한 프로젝트 화면에만(`App.isProjectScreen`). 회귀는 `tests/bottomgap`이 막는다.
3. **CSS로 감추기 ≠ 언마운트** — 내비를 `hidden`/`md:hidden`으로만 가리면 둘 다 마운트되어 알림 종이 두 개가 되고 같은 실시간 채널에 두 번 붙어 앱이 죽는다. `useIsMobile()`로 한쪽만 마운트. **반응형으로 구조가 달라질 때
   컴포넌트를 두 벌 두지 마세요**(`md:contents`로 가는 쪽이 맞다).
4. **Tailwind display 유틸 충돌** — 컴포넌트 기본 클래스의 `inline-flex`가 호출부의 `hidden`과 같은 레이어라 `hidden`이 진다. display는 호출부가 소유한다.
5. **`<button>`은 내용을 수직 중앙 정렬한다** — 형제가 `div`인 grid에서 라벨이 8px 어긋난다(`block` 추가).
6. **iOS Safari의 `transform-box`가 Chrome과 다르다** — 회전한 SVG `<text>`가 부모 밖으로 튄다. HTML을 겹치세요.
7. **`touch-action: pan-x`는 자손 전체에 걸린다** — 안쪽 세로 스크롤까지 죽는다. 보드에는 `overscroll-behavior-x`만.
8. **`overscroll-behavior-x: contain` vs `none`** — contain은 자기 고무줄을 남겨 "더 갈 것처럼" 밀린다 → `none`.
9. **`button` 안에 `button`은 유효하지 않다** — 줄 전체가 클릭 대상이면 줄을 `div`로 바꾸고 여는 영역만 button. (번호는 `§6-N`으로 참조되므로 새 항목은 뒤에 붙이지 말고 `9-a`로 갈라 쓴다.)
9-a. **두 줄을 세로로 맞추려면 같은 칸에 넣으세요 — 마진으로 밀지 마세요.** 프로젝트 헤더에서 액션을 버튼과 같은 칸에 두니(감싸개 `contents` + `justify-end`) 양쪽 선이 저절로 맞았다. 폭 계산은 그때만 맞는다.
9-b. **아이콘은 여백까지가 버튼이라 배경 있는 버튼과 선이 안 맞는다.** `p-1.5`(6px) + lucide의 안쪽 2px = 8px이라 상쇄는 `-mr-2`. 판정은 rect가 아니라 **`getBBox()`로 잉크 상자**를 재세요.
9-b-2. **좁은 묶음을 넓은 버튼에 맞출 때는 한쪽 선이 아니라 가운데를 맞춘다** — 한쪽에 붙이는 순간 반대쪽에 구멍이 생긴다. 가운데도 박스가 아니라 자획으로 잡는다(§6-9-b).
9-c. **한 줄에 폭 고정인 것만 모아 두면 좁은 화면에서 서로 파고든다** — 320px에서 얼굴이 버튼 밑으로 들어갔고 `main`의 가로 스크롤은 0이라 넘침 검사에 안 걸렸다. **줄마다 '양보할 것'을 하나 정하세요**(`truncate min-w-0`).
9-c-2. **`<button>`은 `display:flex`를 줘도 내용 폭으로 줄어든다.** 음수 마진으로 좌우를 넓히는 줄은 `w-[calc(100%+16px)]`로 폭을 직접 준다. 같은 목록에 button 줄과 div 줄이 섞이면 같은 클래스를 준다.
9-d. **모바일 입력 글자 크기를 CSS 한 줄로 덮지 마세요.** `input{font-size:16px!important}`가 11~13px 칸을 키우고 `text-2xl` 제목을 줄여 위계를 무너뜨렸다. 자동 확대는 viewport의
    `maximum-scale=1`로 막는다(`tests/mobbits`).
9-e. **스켈레톤은 `animate-pulse`로 두지 마세요** — 흰 배경 위 옅은 회색에서는 변화가 안 보여 "빈 상자"로 읽힌다. `.dc-skeleton`이 훑고 지나가는 빛으로 그린다(reduced-motion에서는 정적 음영).
9-f. **스켈레톤이 끝나지 않으면 원인은 스켈레톤이 아니다** — 80px 상자에 1.5MB 원본을 받고 있었다. `createSignedUrl(…, { transform })`으로 200px을 받는다(변환은 토큰에 묶여 묶음 발급을 못 쓴다). 자리를 잡는
    스켈레톤은 실제 줄과 **같은 높이**여야 하고 개수를 자르면 안 된다.
9-g. **서명 URL 캐시는 '주소를 오래 유지하는 것'이 전부다** — 브라우저 캐시는 주소가 같을 때만 맞는다. 썸네일만 7일로 서명해 6일까지 재사용하고 저장은 **localStorage**(탭을 닫으면 주소가 바뀌어 캐시가 빗나간다).
9-h. **빈 상태의 `min-h-[46vh]` 같은 고정값은 화면마다 어긋난다** — 스크롤 박스 안에서 제 자리를 재서 남는 만큼을 **min-height로만** 준다(`worshipDetail.useFillRest`). 자기 아래에 깔린 것(`pb-*`·뒤
    형제)도 빼야 한다.
9-i. **형광펜·강조 배경은 블록이 아니라 인라인 요소에** — `<mark>` + `box-decoration-break: clone` (`wordBible.HL_STYLE`). 절 번호는 mark 밖에 둔다.
9-j. **눌릴 것처럼 보이는 화살표는 눌려야 한다** — 본문 선택 피커의 ▾가 장식용 SVG였다(`worshipPassage.jsx`). 검사는 `el.click()`이 아니라 실제 mousedown으로 해야 잡힌다.
9-k. **`max-w`는 그리드 트랙 안에서 빈 띠를 만든다** — 말씀 본문 열의 `max-w-[46rem]`이 1000px에서 오른쪽 216px을 비웠다. 칸은 자기 트랙을 다 쓰게 두고 폭은 트랙 정의(`minmax`)로 줄인다. 읽기 폭 상한은 폐기.
9-l. **조건부 Fragment는 그 자리의 DOM 노드를 새로 만든다** — 고른 절만 `<>…</>`로 감싸면 선택·포커스가 끊긴다. 언제나 같은 모양으로 감싼다(`wordBible.PassageText`).
9-m. **위치를 재는 팝오버보다 문서 흐름 배치를 먼저 검토한다** — 형광펜 도구 줄은 눌린 절의 다음 형제로 흐름 안에 그려 해결했다(17-b·17-c 뒤). 잴 것이 없으면 어긋날 자리도 없다.
9-n. **캐시 훅으로 화면을 채울 때는 '어느 키의 값인지'를 값에 담아라** — 앞 날짜 값이 새 날짜를 덮어 묵상이 빈 칸이 됐다. 묶음에 `date`를 담고 같을 때만 반영(`wordView`), 모임은 `useSettled(key, loading)`.
9-o. **등장 애니메이션(transform)은 쌓임 문맥을 만든다** — 아래 카드의 `animate-in`이 위 데이트피커 패널을 덮었다. 패널을 가진 컨테이너에 `relative z-20`.
9-p. **캐시 값을 첫 렌더부터 써라**(`useState` 초기값) — 이펙트에 맡기면 한 프레임 스켈레톤이 그려진다.
9-q. **한 줄에 안 들어가는 메타는 접거나 자르지 말고 도막을 뺀다 — 기준은 화면 폭이 아니라 그 상자 폭.** `.worship-card-meta`에 **컨테이너 쿼리**로 도막을 빼고, 구분점은 각 도막 **앞**에 붙인다(같이 빠지게).
    `truncate`는 규칙이 아니라 마지막 안전망. 카드 폭은 화면 폭에 비례하지 않는다(3열은 `2xl`부터).
9-r. **모바일 한 열 격자에 `grid-cols-1`을 빼면 칸이 내용 폭을 따라 넓어진다** — `auto` 트랙의 최소 폭이 min-content라 긴 메타가 카드를 오른쪽으로 밀어낸다. `grid-cols-1`은
    `minmax(0,1fr)`이다(`tests/home` 6-b).
9-s. **`overflow`도 `text-overflow`도 인라인 상자에는 걸리지 않는다** — 자르는 줄에는 `block`을 같이 준다 (`homeView.ONE_LINE`). flex 안에서는 `min-w-0`도 필요하다.
9-t. **낡은 Blink는 `button`에 `align-items: flex-start`를 걸어 둔다**(카카오 인앱 웹뷰 축) — 카드를 `<button class="flex flex-col">`로 만들면 제목 줄이 글자 폭만큼만 선다.
    `items-stretch`를 직접 적으세요.
9-u. **고정 폭 칸에는 가장 긴 값이 들어가는지 재 보고 `whitespace-nowrap`을 같이 준다** — 홈 마감 날짜 칸이 `w-11`이라 `26. 9. 13.`이 두 줄로 접혔다. 폭을 없애지 말고 재서 늘리세요(제목 시작 자리를 맞추는 값이다).
9-v. **스크롤하는 상자는 `main` 하나이고 화면이 바뀌어도 그 통은 그대로다** — `key`로 리마운트해도 scrollTop이 안 돌아온다. App이 `useLayoutEffect([activeMenu])`로 0으로 되돌리되 의도된 스크롤은
    `keepScrollRef`로 비켜 준다.
9-w. **스켈레톤이 '자리를 지킨다'면 줄 상자까지 같아야 한다** — 높이를 px로 박지 않고 폭 0 글자(U+200B)로 진짜 줄 상자를 만들고 뼈대를 절대 위치로 얹는다(§6-9-e의 짝).
9-x. **'하나라도 오면 있는 것만 세운다'는 순서를 깨뜨린다** — 갈래별 로딩이면 **아직 안 온 자리도 목록에 남긴다** (`homeView.orderedSlots`의 `wait`).
9-y. **가로 스크롤 통의 `padding-right`는 넘친 내용에 안 걸린다**(§6-2의 가로판) — 끝 여백은 `pr-*`이 아니라 `after:content-[''] after:shrink-0 after:w-3`로 flex 항목을 하나
    세운다(`roster.CHIP_ROW`·`views.TEAM_CHIP_ROW`).
9-z. **`flex-wrap`에 줄을 맡기면 좁은 폭에서 마지막 항목만 떨어져 고아 줄이 된다** — 줄을 **정해서** 그린다. `basis-full sm:basis-auto`는 세그먼트 자신이 아니라 **감싸개**에 · `flex-1` 빈 칸 대신
    `ml-auto`를 쓴다.
9-aa. **sticky의 통은 `overflow != visible`로 찾아야 한다** — `auto|scroll`만 보면 `overflow:hidden` 조상을 지나쳐 재는 상자와 붙는 상자가 달라진다(`MarkdownEditor.useStickyTop` ·
    편집기 자신·`window.resize`도 듣는다).
9-ab. **읽기 상자의 높이는 자리표가 아니라 편집기의 실제 높이다**(센티넬 `h-px` 때문에 1px 크다). `display:none`에서 막 풀린 상자에는 같은 프레임에 focus가 안 먹는다. 달력 격자는 6주 높이를 늘 잡는다.
9-ac. **머리줄을 카드로 바꾸면 그 아래 빈 상태의 '남는 자리'가 그만큼 줄어든다** — `useFillRest`가 재는 값이라 `centered()` 문턱을 조용히 넘는다. "오른쪽 끝" 검사도 content box 기준으로.
9-ad. **'자리를 잡았다'를 ref로 기억하면 도착한 프레임에 다시 그리지 않는다** — `groupsParts.useSettled`가 ref로 키를 들어 스켈레톤이 그대로 섰다("공유된 예배 노트가 계속 스켈레톤"). state로
    바꿨다(`tests/groups`).
9-ae. **하단 탭바 위에 얹는 고정 줄은 상수 rem으로 앉히면 안 된다** — `MobileTabBar`가 ResizeObserver로 실측을 `--mobile-tab-bar-h`로 내보내고 얹는 쪽이 그것을 `bottom`으로 쓴다.
9-af. **낙관적 줄에도 갈래(kind)를 실어야 한다** — `fileKindOf` 기본값이 송폼이라 큐시트가 5~10초 동안 찬양 탭에 섰다(`worshipView.uploadFiles`의 `staged`). 짝으로 읽히는 두 입력칸에 한쪽만 `wide`를 주지
    말 것.
9-ag. **업무의 '이번 주'는 주일(일)~토요일의 달력 주다** — 기준 함수는 `utils.weekEndOf(todayIso)` 하나이고 KPI와 마감 구간이 **같은 함수**를 봐야 한다. 날짜 덧셈은 `Z`로 파싱하고 UTC 게터만 쓴다.
9-ah. **유튜브 제목이 굵게 들어오는 것은 서식이 아니라 글자다**(유니코드 수학 알파벳) — 받는 자리에서 NFKC로 접는다(`services/titleText.cleanTitle`, 폭 없는 글자는 따로). **서버(api/yt.js)와 앱 두 곳**에 둔다.
9-ai. **출석 메모는 명시 저장이다** — `service.attendance_note`가 진실이고, 저장 잠금은 '바뀐 것이 없을 때'뿐이다 (비운 메모도 저장이다). 저장 뒤 값이 갈리는 프레임에 상태를 비우면 '저장되었어요'가 같은 프레임에 지워진다.
9-aj. **라벨이 칸 위에 앉는 줄에서는 칸 높이를 맞춰야 한다**(`items-end`만으로는 이름표가 계단이 된다). 좁은 폭에서는 `order-*`로 제목을 먼저 세운다.
9-ak. **참석 수의 기준 주보는 `groups.attendanceSunday`**(발행된 주일 중 오늘까지 왔고 출석 행이 있는 최근 것, 없으면 `pastSunday`)다. `latestSunday`는 **순모임 가이드 전용**(앞으로 올 주일 포함) —
    **다시 합치지 말 것.**
9-al. **캐시 한 벌로 딥링크를 판정하면 안 된다** — 첫 한 벌은 stale이라 동아리 QR 신청이 그 프레임에 판정돼 사라졌다. 한 번 쓰고 버리는 값은 `!loading && !stale`(`bundleFresh`)까지 들고 있는다.
9-am. **`.dc-nav`는 화면이 살아 있는 내내 붙어 있다** — 그 안의 모든 `dc-screen`은 계속 fade다. 화면 **안쪽** 이동에 방향을 주려면 겉 한 겹(`dc-nav dc-nav-fwd/back` + `key`)을 스스로
    만든다(`groupsClub.ClubsPanel`).
9-an. **터치·좁은 화면에서는 `PersonPick` 목록을 포털이 아니라 칸 바로 아래 보통 흐름에 그린다** (`groupsParts.isTouchNarrow`) — **iOS 사파리는 키보드가 뜬 동안 fixed를 제자리에 안 그린다.** 데스크톱 포털은
    visualViewport 기준 + rAF로 앵커를 견주어 재배치하고, 위로 뒤집기는 위가 더 넓을 때만.
9-ao. **검사에서 등장 애니메이션이 붙은 요소를 밀 때는 transform이 아니라 margin을 쓴다**(`fill-mode: both`가 `transform: none`을 남긴다). `tests/groups`의 주보 날짜는 오늘 기준 상대값이다.
9-ap. **표를 실시간 발행에 더하면 세 자리를 같이 고친다** — 마이그레이션 + `liveV2.TABLE_CACHE` 한 줄 + logcheck의 표 개수. **모임 접두는 `groups:all`·`groups:roster`·`groups:mine` 셋으로 나눠
    적는다** (`dropCache`는 글자 비교라 맨 `groups`로 두면 `groups:guide:*`까지 딸려 지워진다).
9-aq. **본문 검색 풀(`bible.forEachPool`)은 받는 것만 겹치고 훑기는 정경 순서다**(도착 순으로 훑으면 결과와 잘리는 자리가 정경 순을 잃는다). **Cache Storage `bible-v1`은 만료가 없다** — 본문을 갈면 이름의 숫자를
    올린다. fetch를 막아 실패를 만드는 검사는 새로고침 **전에** `caches.delete`(뒤에 지우면 앱 부팅과 경주).
9-ar. **AI 검색은 참조만 받고 본문은 우리 파일이 정답이다**(`bibleSearch.js`). 프롬프트에 **책 이름 목록을 실어야** `parseRef`가 읽는다. 빈 답은 캐시하지 않는다(안내 문구가 굳는다).
9-as. **손대지 않은 템플릿은 빈 노트다**(`noteTemplate.isTemplateOnly`) — 아니면 아무도 안 쓴 제목 줄이 저장되어 나눔·잔디에 오른다. **옛 도막 이름은 `LEGACY_SECTIONS`에 쌓는다**(갈아치우면 옛 빈 노트가 '사람이
    쓴 글'이 된다). 편집기를 한 바퀴 돌면 끝의 빈 줄이 사라지므로 줄 단위·빈 줄 무시로 판정한다.
9-at. **멘션 규칙은 한 벌**(`utils.splitMention`) — 뽑는 쪽만 꼬리 문장부호를 떼면 `(@박지호)`의 닫는 괄호가 강조에 들어간다. 알림을 받는 이름과 화면에서 강조되는 글자가 같아야 한다.
9-au. **SUIT에 없는 글자는 한 글꼴에서 나와야 한다** — 보조 글꼴 `Daboot Symbols`(symbols.css)를 `--font-sans`의 SUIT **바로 뒤**에 둔다. 범위를 늘리면 `scripts/subset_symbols.py`의
    RANGE와 symbols.css를 같이 고친다.
9-av. **순모임 가이드 종이 색은 라이트 값으로 박아 두었다**(토큰을 바꿔도 안 따라온다 — index.css `:root`와 손으로 맞춘다). 머리 줄과 섹션 머리줄에 '순모임 가이드'가 두 번 있는 것은 의도다(인쇄물에 제목이 있어야 한다).
9-aw. **스켈레톤은 '기다리는 그림'이 아니라 '자리를 지키는 그림'이다** — 화면 머리의 **조건 없는 줄**은 스켈레톤도 같은 높이로 잡고(`worship-loading-chips`), 자격·건수가 정하는 줄은 잡지 않는다(빈 띠가 남는다).
9-ax. **`max-w`는 트랙 안에 빈 띠를 만든다 — 세 번째 사례**(주보 편집 폼·본문 보기·출석 메모). 새 구역에 폭 상한을 붙이려면 1440에서 옆 구역과 오른쪽 끝을 맞춰 보고 붙인다.
9-ay. **`line-clamp` 넘침 판정은 폭이 바뀌면 다시 잰다**(`NoticeCard` — ResizeObserver). **펼친 동안은 재지 않는다** (늘 '안 넘침'이 나와 접는 프레임에 버튼이 깜빡인다).
9-az. **flex-wrap으로 접히는 줄은 둘째 줄의 왼쪽을 손으로 맞춘다**(`ml-[1.625rem] sm:ml-0`). 접힐 때 **'누구 옆에 서는지'까지 바뀐다** — 인원 수가 순장 칸 줄로 내려가 순장에 딸린 숫자로 읽혔다(`order-*` +
    `basis-full`).
9-ba. **같은 자리에 그려지는 같은 부품은 prop만 갈려도 state를 물려받는다**(§6-18의 새 사례). `key`로 리마운트하면 오갈 때마다 접힘으로 되돌아가니 **state 열쇠에 갈래 이름을 넣는다**(`MarkSection`).
9-bb. **검색어 표시는 첫 등장만 칠하면 안 된다** — `String.split(q)`로 전부 칠한다(`wordBible.highlight`).
9-bc. **성경 상태 그릇은 `useStateBox()` 한 벌이다**(캐시 초깃값 · `edited` · `adopt` · `update`). QT 본문과 리더가 그릇은 같고 읽는 이펙트만 다르다(logcheck가 자리를 못 박는다).
9-bd. **세그먼트에는 `aria-pressed`, 탭 줄에는 `role="tablist"/"tab"`**(`aria-selected`는 tab에만 뜻이 있다).
9-be. **wordView 도구 줄과 worshipDetail `NOTE_TOOLS`는 배치가 다르다**(2열 vs 4열) — 둘 다 고아 줄이 없어 합치지 않았다. §6-9-z의 "같은 배치"라는 설명은 사실이 아니다.
9-bf. **컴포넌트를 화면 함수 안에서 만들면 렌더마다 리마운트다** — `fill-mode: both`라 등장 모션이 다시 돌고, `useMinuteTick` 같은 화면에서는 목록이 **매분 깜빡인다**(멤버 화면 `MemberRow`). 모듈 바깥에 둔다.
9-bg. **한 화면이 자격과 한 벌을 나란히 읽으면 같은 표를 두 번 읽기 쉽다** — `groups.share(key, run)`가 같은 틱의 중복 조회를 묶는다(캐시가 아니라 in-flight 창). 홈도 같은 짝을 부르므로 **서비스 계층**에 둔다.
9-bh. **연도·탭처럼 사람이 방금 누른 조작기는 로딩 중에도 화면에 남는다** — 껍데기는 세워 두고 바뀌는 목록 자리만 잡는다(`SunAdminPanel`의 `ADMIN_SKELETON`).
9-bi. **`ClubsPanel`의 `key={club:<id>}`는 상세를 통째로 다시 마운트한다** — `useEffect([club.id])`로 칸을 닫던 코드는 이제 대개 돌지 않는다. key를 걷으면 되살아나는 함정이라 셋(편집·QR·모임 만들기)을 다
    닫아 둔다.
9-bj. **긴 클라이언트 작업에는 `busy`가 불리언이면 모자란다** — 어느 버튼이 일하는 중인지를 담아야 그 버튼에만 스피너를 놓을 수 있다(`sunGuide`의 `'' | make | save | pin | image`).
9-bk. **같은 구글 iframe을 띄우는 자리가 다섯이다**(`sheet`·`gdoc`·`drive`·`office`·`InlineSheet`) — 갈래를 늘릴 때 **준비 화면(`PreparingFrame`)·`FRAME_SETTLE`·페이드 셋을 같이**
    붙인다(`tests/three`가 소스로 못 박는다).
9-bl. **`useMemo`의 의존성에 매 렌더 새로 만드는 배열을 넣으면 그 memo는 한 번도 맞지 않는다** (`MyTasksView.shown`·`TeamView.openTasks`·`ScheduleView.dated`) — 거른 목록도 같이 묶는다.
9-bm. **dnd-kit은 끄는 동안 모든 draggable을 프레임마다 다시 그린다** — 자식에게 넘기는 **엘리먼트를 인라인으로 만들면 그 자식의 `React.memo`가 무력화된다**(`boards.jsx`의
    `action={<StatusMoveButton/>}`). 엘리먼트도 `useMemo`.
9-bn. **`callGemini`에 상한이 없으면 답이 안 올 때 화면이 스켈레톤에 굳는다** — `CALL_TIMEOUT_MS = 25000`이고 **AbortError는 `needDeploy`가 아니라 `failed`로 가른다**. 서버 함수 셋(drive 55
    · yt 8 · ai 25초)이 플랫폼 maxDuration보다 먼저 끊고 한국어 이유를 실어 보낸다.
9-bo. **`config.js`의 팀 표 셋(TEAMS·TEAM_FG·TEAM_TOKENS)은 Tailwind 안전목록이다** — `bg-tag-pink` 같은 클래스가 소스 통틀어 여기에만 통짜로 있다. 토큰에서 만들게 바꾸면 팀 색이 빌드에서 통째로 사라진다.
9-bp. **한 벌로 모은 규칙 셋**: 교회 축 목록 `layout.CHURCH_MENUS`(App은 `CHURCH_ORDER`로 가져다 쓴다) · 확장자→구글 편집기 표 `utils.GOOGLE_EDITOR` · 화면 가림 비밀번호
    `viewPw.js`(**`cloud.js`를 절대 import하지 않는다** — supabase가 딸려 와 노드 검사가 깨진다) · 홈 날짜 `worship.formatServiceDate` · `BTN_SOFT`.
9-bq. **`tests/assignees.mjs`는 `cloud.js`를 통째로 복사해 돌린다**(import를 절대 경로로 바꿔 자동으로 견딘다). **스위트마다 CDP 포트가 고정**이라 같은 스위트를 병렬로 돌리면 충돌한다 — 배분하세요(§6-42-a).
9-br. **검사 중 화면 좌표를 견줄 때는 `.dc-card`가 붙은 요소를 재지 않는다**(등장 연출로 5px 내려온 프레임이 있어 늘 어긋난다) — 그 부모(격자·상자)를 잰다.
9-bs. **검색 결과 머리줄은 `wordBible.searchHeads()` 한 자리에서 정한다** — 낱말 0건 + AI 있음이면 낱말 줄 없이 AI 줄만. 게스트는 AI 도막이 못 서므로 이 순수 함수로만 검사된다.
9-bt. **검색창 안내 회전은 `layout.useRotatingHint(on, hints)`/`SearchHint` 한 벌**이고 문구 배열만 받는다. AI 문구는 `aiEnabled()`일 때만 넣는다(없는 것을 약속하지 않게). 줄이 하나면 타이머를 안 건다.
    검사에서 `::placeholder`는 `getComputedStyle`로 못 재니 감추는 클래스를 본다.
9-bu. **`inline-flex` 링크를 `items-baseline` 줄에 넣으면 아이콘 밑동이 기준선이 된다**(2~3px 떠오른다) — 글자 크기가 다른 칸이 섞인 줄은 `items-center` + `leading-none`으로 맞춘다.
9-bv. **주보 편집의 재생목록 칸은 주보에 적힌 주소를 그대로 세운다**(빈 칸에서 시작하지 않는다). ×는 `praise_playlist_url`만 비우고 **가져온 곡은 지우지 않는다**(곡은 줄마다 지운다 · 0046).

그 밖에 이 자리에서 고친 것(번호 없음):
- **`+ 프로젝트`만 `border-b-2 border-transparent`가 없었다** — 탭 줄이 `items-end`라 글자가 2px 내려앉는다.
- **대시보드 '프로젝트 진행'·탭 줄·연결 지도가 같은 연도를 봐야 한다** — 규칙은 `utils.projectsOfYear`/ `projectYear` 한 벌, 고른 값은 `hooks/useProjectYear` 하나(`safeYear`로 떨어질 때 스토어에
  되돌린다).
- **업무 줄의 팀은 `utils.teamsLabel`이 `웰컴팀 외 2팀`으로 만든다**(중복 팀을 먼저 걷어낸다).
- **모바일 대시보드는 `업무 / 청년 / 연결` 세 탭**(사용자 결정) — 감싸개는 `contents`여야 데스크톱 2열이 맞다.
- **달력 격자선은 `utils.snapCols`가 `round(x*dpr)/dpr`로 붙인다**(소수 폭이 장치 픽셀에 걸쳐 두 줄만 굵어 보였다). 요일 줄도 같은 값을 쓰고 `ResizeObserver` 외에 `onDprChange`(matchMedia
  `resolution`)도 듣는다.
- **팀 칩 숫자와 화면에 뜨는 것이 다르면 기준이 둘이라는 뜻이다** — `utils.datedTasks`로 **그 보기가 보여줄 수 있는 것만** 센다(칩의 숫자는 고르기 전에 알아야 하므로 필터 밖에서 센다).
- **필터(`전체·내 업무·내 팀`)는 `scoped` 하나가 KPI·마감 목록·프로젝트 진행을 전부 지배한다** (인사말·사람 칸·팀별·청년별은 필터 밖 — §6-31).
- **숨긴 덩이는 DOM에 그대로 있다** — 검사에서 존재가 아니라 **보이는지**(`rect.width > 0`)를 봐야 한다.
- **`editor.view`는 뷰가 붙기 전에 게터가 던진다**(옵셔널 체이닝으로도 못 막아 수정 창이 통째로 오류 화면이 됐다) — `try/catch` + `editor.on('create', …)`로 두 번 시도한다.
- **제목에서 Enter는 본문으로 떨어진다**(`HeadingExit`) — `splitBlock({keepMarks:true})` 뒤 `setNode('paragraph')` 이고 **뒤쪽이 아직 제목일 때만** `.command()`로 부른다(체인 안 한 명령이
  no-op이면 전체가 false가 되어 ProseMirror가 기본 Enter를 한 번 더 돌려 빈 문단이 생겼다).
- **서식 바는 스크롤을 따라오되 상세 내용 칸의 머리줄로 남는다** — `useStickyTop`이 스크롤 통 안에서 `top:0`에 붙는 것들의 높이를 재서 내려 세운다(`compareDocumentPosition`으로 **완전히 앞에 있는 것**만 · 통의
  패딩만큼은 음수 top). 붙었을 때의 연출은 없다(사용자 결정) — 달라지는 것은 아래 선 하나뿐.
- **에디터 빈 공간을 눌러도 글이 써진다** — 감싸개의 `onMouseDown`에서 `.tiptap` 밖일 때만 문서 끝으로 보낸다.
- **`---`로 구분선** — 판정 모양이 `markdown.js`·`RichText.jsx` **두 곳에 한 쌍**으로 있다. 본문 문법을 더할 때는 두 곳을 고치고 검사도 두 곳에 남긴다.
- **본문 링크의 주소는 절대 주소여야 한다**(`MD_LINK_RE`가 `https?://`만 본다 — `ai.resolveTaskLinks`가 origin을 붙인다). 그리는 자리는 `RichText.InlineLink` 하나이고 같은 origin + `?p=`면
  앱 안에서 연다. **링크에 굵게·형광펜을 겹치면 왕복이 깨진다**(`INLINE_SPLIT_RE`).
- **주소 쓰기는 기본 replaceState, 본문 링크로 건너뛸 때만 pushState 한 번**(`pushNextUrlRef`). popstate 복원 때 업무는 모달 스냅샷이 아니라 **스토어의 카드**를 넣는다(§6-18).
- **내 정보·프로젝트 창도 바깥을 눌러 닫는다**(`useDismissModal` — 누름이 딤에서 시작했을 때만 · 온보딩 중에는 안 닫힌다). 원형이 될 수 있는 칩의 아이콘 버튼에는 좌우 비대칭 패딩을 주지 말 것(정사각 + `justify-center`).
- 검사 쪽: **템플릿 리터럴 안의 주석에 백틱을 넣지 말 것**(문자열이 끊긴다 · `\d`도 깨진다 → `[0-9]`) · **테일윈드 4는 색을 `oklab(… / .9)`로도 적는다**(`/` 뒤 값까지 읽어야 한다) · **서식 바의 '붙은 상태'를 재려면
  본문을 길게 만들어야 한다** · **`tests/handoff`의 크롬 디버그 포트는 9530 하나다**(§6-42-a).

### dnd-kit

10. **가로 자동 스크롤이 드롭 타깃을 빗나가게 만든다** — `autoScroll={{ threshold: { x: 0, y: 0.2 } }}`로 가로만 끈다. 가로 스크롤 줄 자체가 드롭 대상이면(모바일 프로젝트 탭) `autoScroll={false}`로
    통째로 끈다.
11. **`pointerWithin`이 비면 `rectIntersection`으로 떨어진다** — 카드의 큰 사각형이 기준이 되어 엉뚱한 컬럼이 잡힌다.
12. 터치와 마우스는 센서를 분리한다(`MouseSensor` distance 6 / `TouchSensor` delay 200) — 합치면 모바일에서 드래그가 시작되지 않거나 스크롤과 싸운다.
12-a. **"놓은 카드 앞에 끼워 넣기"만 두면 아래로 끌 때 제자리로 돌아온다**(나를 뺀 만큼 아래가 당겨진다) — 원래 자리가 놓은 자리보다 **위였으면 뒤에, 아래였으면 앞에**. 순서 바꾸기를 만들면 **아래로 끄는 경우를 반드시 검사에 넣으세요**(사람
    눈으로는 "안 움직인다"로만 보인다).
12-b. **카드를 드롭 대상으로 만들면 컬럼 드롭 경로가 거의 안 쓰인다** — 그래도 컬럼·상태 칩 갈래는 **빈 자리에 놓는 경우**를 위해 남는다. 지우지 마세요(`drag`·`dragdesk`가 검사한다).
12-c. **draggable 노드의 ref 콜백에 조건을 넣지 말 것** — 콜백 신원이 바뀌면 React가 ref를 떼었다 붙이고 그 순간 dnd-kit이 들고 있던 노드가 사라진다. 부수 동작은 `useEffect`로. 모바일 탭은 길게 누르기
    (TouchSensor delay 300 · tolerance 8)이고 끼워 넣기·저장은 데스크톱과 한 벌(`utils.reorderIds` · 0021).

### 캘린더

13. **띠를 절대 배치로 날짜 위에 얹지 말 것** — 주 단위 행 안에서 ①배경 셀 7칸 ②날짜 숫자 줄 ③띠 레인 순서의 세로 흐름.
14. **띠 레인이 클릭을 먹는다** — 레인은 `pointer-events-none`, 띠와 `+N건`만 `pointer-events-auto`.
15. **창이 낮으면 2줄이 안 들어간다** — 주 줄 높이를 `ResizeObserver`로 재서 띠 줄 수를 1~`CAL_LANES`(2)로 정한다.

### 상태 · 팝오버 · 모달

16. **같은 상태로 저장하면 아무 일도 안 한다** — 완료 목록의 완료 버튼이 죽은 것처럼 보였다 → '되돌리기'로 바꿨다.
17. **팝오버 위치는 `useAnchoredPos(triggerRef, open, w, estH, gap, measuredRef)`** — `measuredRef`를 넘기면 실제 높이로 다시 잡는다(추정만 쓰면 위로 뜨는 팝오버가 100px 떠 보인다). 여는 순간
    `place()`를 먼저 부른다.
17-b. **tailwind `duration-150`은 `transition-duration`만 정한다** — `transition-property` 초깃값이 `all`이라 top/left까지 전이되어 첫 배치에서 미끄러져 들어온다. 팝오버에는
    `transition-none`을 두거나 속성을 못 박는다.
17-c. **위치를 state로 든 팝오버는 앵커가 바뀌면 `key`로 새로 마운트한다** — `useAnchoredPos`의 deps는 `open`뿐이라 앞 절 좌표에 그대로 남는다(`wordBible.jsx` `key={pickRef}`).
18. **업무 창 안의 state는 카드가 바뀌어도 살아 있다**(모달이 언마운트되지 않는다) — `key={formData.id}`로 카드마다 새로 마운트한다. 안 그러면 다음 카드에 앞 카드의 요약이 보인다.
19. **"고정된 값 우선"과 "방금 만든 값 우선"을 `A || B`로 쓰면 둘 중 하나가 죽는다** — 지금은 `summary || (revealed ? pinned : '')`이고 버튼·배지는 `showingPinned`로 갈린다.
19-a. **'바깥 누름으로 닫기'의 바깥 판정에 "다음에 누를 수 있는 것"이 빠지면 그 기능은 조용히 죽는다** — 형광펜 범위 선택이 실물에서 한 번도 안 됐다(절 전체 `[data-verse]`가 '안'이다). **바깥 클릭 닫기를 검사할 때는
    `click()`이 아니라 mousedown→click을 쏘세요.**
19-b. **낙관적 갱신과 서버 목록을 '이어 붙이면' 그 사이 프레임이 거짓말한다** — 나눔 피드에 내 글이 두 줄로 섰다. `wordView.mergeFeed(shared, mine)`이 내 줄을 언제나 내 상태에서 한 줄만 만들고 키는 `'mine'`
    고정이다.
19-c. **map 안에서 바깥 변수와 같은 이름을 쓰면 잠금이 조용히 풀린다** — 출석의 `open`(펼침)이 13:30 게이트를 이겨 칩이 하나도 안 잠겼다 → `checkOpen`으로 갈랐다.

### 데이터 로드 · 실시간

20. **목록 화면에서 `task.comments`/`task.activityLog`는 비어 있다** — 댓글·활동은 업무 창을 열 때 그 카드 것만 읽는다(`cloudSync.loadCardDetail`). 목록에 개수를 붙이려면 세는 경로가 따로 필요하다(그래서
    0016).
21. **실시간은 표(`payload.table`)에 따라 갈라진다**(`cloudSync.subscribeWorkspace`) — cards는 1건, comments·files· comment_reactions는 열린 창일 때만, 나머지는 전체 재조회다. **새
    표를 구독에 추가하면 기본이 전체 재조회**이니 라우팅에 같이 적는다. comments의 DELETE payload에는 `card_id`가 없다(replica identity가 PK뿐).
21-a. **모듈 캐시로 들고 있는 표는 그 원본 테이블을 구독하지 않으면 영영 낡는다** — `profileIdToName`이 그랬고, 새로 가입한 사람을 화면이 영영 몰라 담당자가 조용히 지워졌다(0018로 `profiles`를 발행에 넣었다). **캐시해 둔
    조회 결과를 만들 때마다 "이 표가 바뀌면 누가 알려주나"를 같이 정하세요.**
22. **스토어 히스토리는 최근 20개까지** — `LOAD_STATE`는 기록을 초기화하고 `SYNC_TASK`는 기록하지 않는다. `SYNC_TASK`는 카드 1건을 **병합**한다(`UPSERT_TASK`로 바꾸면 댓글·활동·첨부가 날아간다).
23. **`store.canUndo()`를 렌더 중에 그냥 부르면 갱신되지 않는다** — `useCanUndo()`/`useCanRedo()`로 구독한다.
24. **`cards.position`은 아무도 채우지 않는다**(전부 0) — 정렬 키로 쓰면 순서가 뒤바뀐다. 컬럼 안 순서는 `dashboardParts.byDue`가 소유한다.
12-c. **컬럼의 빈 자리에 놓는 것은 "이 컬럼으로"가 아니라 "맨 밑으로"다**(상태 칩은 같은 상태면 아무 일도 안 하는 것이 맞다). 이 검사는 **카드가 화면을 채우지 않는 시드**로만 만들 수 있다(`dragdesk`).
12-d. **`profiles` UPDATE를 전부 전체 재조회로 보내면 심장박동이 곧 폭풍이다** — `utils.seenOnlyChange`가 "다녀간 시각만 바뀐 UPDATE"를 가르고 그때만 `SYNC_MEMBER_SEEN`이다. **키를 열거하지 않고**
    모르는 키가 다르면 false로 떨어져 전체 재조회로 안전하게 간다. 직전 행은 `cloudSync.profileRows`에 있다.
12-e. **realtime의 timestamptz는 PostgREST와 글자 모양이 다르다**(공백·`+00` vs `T`·`+00:00`) — 섞어 문자열로 비교하면 `visitOrder`가 같은 날 안에서 뒤집힌다. 스토어에 담기 전
    `utils.isoTime`으로 한 모양을 만든다.
24-a. **v2 실시간은 행을 고치지 않는다 — 표 이름을 캐시 접두로 옮길 뿐이다**(`services/liveV2.js` · 0049). **행 단위 리듀서를 만들지 마세요**(표가 늘 때마다 두 벌을 고치게 된다 — §6-21-a). 캐시는 언제나 비우고
    재조회는 그 화면이 떠 있을 때만, 편집 중이면 신호를 기억했다가 켜질 때 **한 번만** 흘린다(`useLiveRefresh`).
24-b. **presence의 `at`은 '알린 시각'이 아니라 '자리를 옮긴 시각'이다** — 재접속마다 찍으면 백그라운드 탭이 와이파이 복귀만으로 지금 보는 탭을 이긴다. 찍는 자리는 `utils.nextWhereMeta` 하나(같으면 null).
    **정리(teardown)에서 화면 상태를 지우지 마세요** — 재구독 뒤 `{null,null}`로 track되어 얼굴이 사라진다.
24-c. **캐시로 그린 화면에 새 값이 늦게 오면 편집기가 옛 글을 되받는다** — `word.shouldAdoptBody({dateChanged, body, lastSynced, next})`가 넣을지 말지를 한 곳에서 정한다. §6-9-n의 짝(그쪽은 누구
    값인가, 이쪽은 덮어도 되는가).
24-d. **재조회가 실패했다고 캐시로 그린 화면을 비우지 마세요** — `useCached`의 실패 분기는 `loading`·`error`만 바꾸고 `data`는 그대로 둔다(비우면 끊긴 네트워크가 "내용이 없어졌다"로 읽힌다).
24-e. **캐시는 자리도 관리해야 한다**(`services/cache.js`) — scope(사용자)를 바꿀 때 옛 키를 지우고 (`setCacheScope` → `purgeKeys`), 한도에 걸리면 이 scope를 비우고 한 번만 다시
    넣는다(localStorage는 5MB에 닿는 순간부터 모든 쓰기가 조용히 실패해 캐시가 옛 값에 영영 굳는다).
24-f. **캐시 열쇠의 첫 도막을 서로의 접두가 되게 짓지 마세요**(`dropCache`는 접두로 지운다) — 화면 것은 `bible:state`, 사용자별 저장 자리는 `word_bible_state:<uid>`로 **일부러 다른 도막**이다.
24-c. **딥링크의 나머지 값은 App이 주소를 `/`로 정리하기 전에 붙잡아야 한다** — `services/entryQuery.js`가 모듈 첫 실행 때 스냅샷을 뜬다. **OAuth 왕복은 그 스냅샷보다 늦다** → `auth.consumeReturnTo`가
    다시 실어 준다.

### 드라이브 · 첨부

29-b. **화면이 어느 뷰어를 쓰는지 조건 없이 적어 두지 마세요** — 상수로 박힌 '마이크로소프트 오피스 미리보기로 표시해요'가 구글로 그리면서도 그렇게 적혀 있었다. `viewerNote(row)`가 행을 보고 정한다.
29-c. **엑셀·csv 미리보기는 구글 화면이다 — 우리가 그리지 않는다**(사용자 결정 2026-08-29 · 세 번 뒤집혔다). 올릴 때 Apps Script가 네이티브 시트 사본을 만들어 둔다(0031 `files.preview_file_id`) — 없으면
    '표로 볼 수 없어요'이고 백필은 `node scripts/backfill_sheet_preview.mjs --fix`. **원본 `.xlsx`는 그대로 둔다**(내려받기· 새 탭·내용 검색이 쓴다). 옛 형식(.doc·.ppt)만 구글 편집기 + 시간
    게이트다(`utils.driveSrc`).
29-c-2. **`blocks()`에서 자기 닫는 태그를 정규식 그룹으로 잡으려 하지 마세요** — `[^>]*`가 끝 슬래시까지 먹어 태그가 '열린 것'이 되고 다음 셀을 삼킨다(공유 문자열이 인덱스 숫자로 보였다). `open.endsWith('/>')`를 본다.
29-c-3. **이름마다 정규식을 만들어 속성을 찾지 마세요** — 여는 태그를 한 번 훑어 객체로 담는 `attrs()`가 정직하고 빠르다.
29-d. **업무를 지우면 첨부도 같이 정리해야 한다** — 안 하면 파일 행이 주인 없이 남고 드라이브에 실체가 남는다 (싱크가 아니라 유실이다). `cloud.deleteCard`가 **드라이브는 폴더째 휴지통으로** 보내고, 실패해도 카드 삭제는 진행한다.
    **순서는 29-e를 보세요 — 행이 먼저다.**
29-d-2. **불리언 하나로 두 가지 상태를 겸하지 마세요** — `approved`가 '승인 안 함'과 '내보냄'을 겸해 환송한 사람이 다시 승인 대기로 올라왔다(0027의 `removed_at`). **환송할 때 `approved_at`을 지우지 마세요.**
29-e. **지우는 일은 DB 행부터. 실체 정리는 그 뒤에 최선으로.** 드라이브 왕복을 먼저 하면 그 사이 다른 조회가 아직 남은 행을 읽어 **지운 파일이 되살아난다**(`deleteAttachment`·`deleteCard`·`deleteProject` 전부
    이 순서). 이중 방어로 `attachments.jsx`가 이번 세션에 지운 id를 모듈 레벨로 기억한다.
29-e. **우리 API가 한국어로 준 이유를 버리지 마세요**(`err.human`) — 버리는 바람에 첨부가 안 올라가는데 화면에도 서버 로그에도 단서가 없었다. **아는 코드가 하나도 없으면 원문이라도 보여준다.** 원인을 못 찾겠으면 **먼저 실패를 읽을 수
    있게 만드세요** — 짐작으로 고치는 것은 두 번 데인 길이다.
29-e-0. **`getSession()`을 쓸 때는 반드시 한 겹 안(`session`)을 보세요** — `cloud.getSession()`은 supabase의 `{data}`를 이미 벗겨서 돌려준다. 토큰이 언제나 undefined라 **앱에서 올리는 첨부가 한
    번도 드라이브로 가지 못했다**(이관 스크립트는 멀쩡해서 더 안 보였다). 이 함정은 이 레포에서 두 번 났다(`tests/push`).
29-f. **드라이브 왕복은 느리다 — 시간 제한을 우리가 고르세요**(바닥값 4초, Apps Script 자체 비용). `vercel.json`으로 `api/drive.js` = 60초를 **명시**하고 `api/drive.js`가 **50초에 스스로 끊는다**(안
    끊으면 플랫폼이 죽여서 브라우저가 받는 것은 JSON이 아니라 오류 페이지다).
29-g. **업로드는 멱등이 아니다 — 그냥 재시도하면 파일이 두 개가 된다.** 파일마다 **멱등 열쇠**를 붙이고 실패하면 `list`로 확인한 뒤 없을 때만 `retry: true`(모르는 스크립트면 재시도 안 함). **`IDEMPOTENT`에
    `upload`을 넣지 마세요.**
29-h. **폴더는 파일보다 먼저 만들고 id를 파일보다 먼저 적는다** — `cloudSync.ensureCardFolder`가 가벼운 호출로 두 겹을 만들고 `cards.drive_folder_id`를 먼저 적는다(드라이브는 같은 이름 형제를 허용한다).
    `ensureFolder`는 `folderId`를 주면 그 폴더 자체를 주므로 한 겹 더 파려면 `path: [프로젝트, 업무]`로 보낸다.
29-i. **드라이브에 올렸는데 DB 행을 못 만들면 올린 파일을 되돌린다**(`trash` — 30일 복구). 안 되돌리면 "드라이브에는 있는데 앱에는 없는" 파일이 영영 남는다(되돌리기마저 실패하면 `drive_check.mjs`가 잡는다).
29-j. **어긋난 것을 맞추는 길: `node scripts/drive_check.mjs`**(유령·고아·중복) — **읽기가 기본이고 `--fix`를 붙여야 고친다.** 고아는 `--fix`로도 건드리지 않는다(사람이 넣어 둔 자료일 수 있다).
29-k. **첨부는 고르자마자 목록에 보인다(낙관적 업로드) — 화면이 거짓말하지 않는 선까지만.** 새 탭·삭제·비밀번호는 주지 않고(아직 없는 것을 버튼으로 내놓으면 거짓말이다) 내려받기는 준다. 남에게는 안 보인다. 바이트는 **메모리에만**
    둔다(`createObjectURL` · 올리는 중 탭을 닫으려 하면 `beforeunload`가 묻는다).
29-l. **개발 기기에서 잰 업로드 시간으로 정책을 정하지 마세요 — 자기 회선을 재게 됩니다**(파일을 안 쓰는 호출조차 66~87초가 나왔다). **진짜 소요는 서버 로그**(`[drive] upload … → 성공 (N ms)`)에 있다. 브라우저 →
    Vercel 구간이 함수 실행 시간에 들어가고 Hobby의 60초 상한은 못 늘린다.
29-m. **답은 상한을 깎는 것이 아니라 보내는 바이트를 줄이는 것이었다** — `services/image.js`가 긴 변 2560px로 줄인다(본문 이미지 1600px와 **같은 코드**). 사진이 아니면 손대지 않고(gif 포함) 줄였는데 더 커지면 원본을
    쓴다. EXIF 회전을 반영한다(`imageOrientation: 'from-image'`). **화면에는 아무 문구도 붙이지 않는다.**
29-n. **Vercel 함수의 요청 몸통 한도는 4.5MB다 — 큰 파일은 함수에 닿지도 못한다**(4.4MB부터 413). base64가 33%를 붙이니 실제 파일은 3.3MB가 천장이었고 화면은 25MB라고 말하고 있었다. 함수 안에서 고칠 것은 없다(→
    29-o).
29-o. **3MB 넘는 파일은 Storage를 거쳐 나른다**(`cloud.uploadViaStorage`) — 브라우저가 Storage에 직접 올리고 스크립트에는 **주소만** 넘긴다(`uploadFromUrl`). 옮겨 가면 사본을 지운다. **실패 경로에서
    Storage 파일을 지우지 마세요 — 그게 유일한 사본이다.** 사진은 이 갈래를 못 밟는다(29-m).
29-p. **Apps Script에 새 권한이 필요한 판은 승인을 한 번 더 해야 한다 — 재배포만으로는 안 된다.** **에디터에서 아무 함수나 실행해서는 승인 창이 안 뜬다**(그 권한을 실제로 써야 구글이 묻는다) — `권한승인()`을 골라 실행한다. 계정이
    여러 개면 **시크릿 창에서 소유자만 로그인해서** 하는 것이 확실하다.
29-q. **받아 주는 크기와 그려 주는 크기를 따로 두지 마세요** — 상한은 `config.MAX_UPLOAD_MB` 하나이고 첨부 고르기·미리보기·`api/drive-file`의 `MAX_BYTES`가 전부 그것을 본다. PDF·텍스트는 크기로 안 가른다.
29-r. **"올리는 중"은 업무 창보다 오래 산다** — 목록이 컴포넌트 state에만 있어 창을 닫았다 열면 그 줄이 사라졌다. `uploadingByCard`(모듈 레벨 Map)가 들고 인스턴스들이 구독한다. 탭 닫기 경고도 모듈이고, blob 회수는 언마운트가
    아니라 **업로드가 끝나는 자리**에서 한다.
29-s. **업무 창이 첨부에 넘기는 `task`는 스토어가 아니라 폼 스냅샷(`formData`)이다** — 지운 파일이 저장 뒤 도로 한 줄 섰다. 첫 값·조회 결과·스토어 반영 **세 자리가 같은 집합(`deletedFileIds`)을 봐야 한다.**
29-t. **`download` 속성은 같은 출처에서만 듣는다**(드라이브 주소에는 통째로 무시되고 새 탭으로 열린다) — 바이트를 받아 blob 주소에 이름을 붙이고, **blob 주소를 바로 회수하면 안 된다**(10초 뒤).
29-u. **첨부를 올리는 길은 하나여야 한다** — 새 업무 쪽이 딴 구현이라 사진을 줄이지도 폴더를 확보하지도 않았다. 지금은 `attachments.startUploads` 하나다(`tests/drivesync`가 두 번째 구현을 막는다).
29-v. **첨부 목록을 거르는 자리를 늘리지 마세요 — `mergeKnown` 하나다**(세 군데가 제각각 하다가 §6-29-s가 났다).
29-w. **엑셀 파서가 시트를 끝까지 읽고 나서 500줄로 잘랐다**(6.4MB에서 3.3초 → 0.36초) — 그래서 `MAX_SHEET_BYTES`도 없앴다. 우리 표로 못 가더라도 드라이브 파일 뷰어가 아니라 구글 편집기로 간다.
29-x. **`state="visible"`을 숨긴 시트로 보고 있었다** — 다른 도구가 만든 파일이 그 값을 적어 시트가 한 장도 없는 것이 되고 미리보기가 빈 화면이었다. 숨김을 뜻하는 값은 `hidden`·`veryHidden` 둘뿐이다.
29-y. **워드·PPT 우리 렌더러는 이제 폴백이다**(2026-09-08부터) — 사본이 있으면 구글 화면을 iframe으로 띄우고 (`previewKind` `'gdoc'`), `docx.js`·`pptx.js` + `OfficeView.jsx`는 사본 없는 옛
    첨부·변환 실패와 내용 검색에만 남는다. zip·XML 기계는 셋이 `services/ooxml.js` 하나를 같이 쓴다(각자 복사하면 29-c-2를 세 번 고친다).
29-z. **`../`가 든 상대 경로를 문자열 치환으로 풀지 마세요** — OOXML rels의 `../slideLayouts/…`(PPT 기본)를 `/../`→`/`로 때우면 레이아웃을 통째로 못 찾아 표지가 도형 0개가
    된다(`ooxml.resolvePath`).
29-z-2. **HTML 첨부는 `<iframe sandbox="allow-scripts" srcDoc referrerPolicy="no-referrer">`로 그린다.** 허용은 그 하나뿐 — **`allow-same-origin`은 절대 함께 주지 마세요**(둘을
    같이 주면 sandbox를 벗을 수 있고, 불투명 출처라야 우리 localStorage의 세션 토큰에 닿지 못한다). 판정은 `services/previewKind.js`.
29-z-3. **중계가 `text/html`을 무조건 "바이러스 검사 경고 페이지"로 보면 .html 첨부는 전부 막힌다** — 실제 파일 바이트는 `Content-Disposition: attachment`로 오고 경고 페이지는 그 머리줄이 없다. 그것으로 가른다.
29-z-4. **dev 서버(vite)에는 Vercel 함수가 없다** — `/api/…`에 Vite가 소스를 변환해 돌려줬다(미리보기 iframe에 `drive-file.js` 코드가 떴다). `vite.config.js`의 dev 전용 미들웨어가 핸들러로
    넘긴다(게스트 모드 제외). `vercel.json`의 rewrite는 dev에 없다 — 공유 카드는 `/api/share?type=…&id=…`로 직접 부른다.
29-z-5. **번들 안의 이미지는 번들이 다 와야 요청이 나간다 — 바로 떠나는 화면에서는 깨진 아이콘이 된다.** 고침 셋: `index.html`의 `<link rel="preload" as="image">`(**href는 소스 경로로** — vite가 해시로
    바꾼다) · `vercel.json`의 `/assets/(.*)` immutable · 로고 `<img>`에 `width`/`height`(logcheck가 셋을 본다).
29-z-6. **구글 편집기 iframe에 `sandbox`를 주지 마세요**(`DocEmbed.jsx`) — 조금이라도 조이면 쿠키·팝업·클립보드가 막혀 편집이 안 된다(29-z-2와 정반대다). 임베드 주소는 `URL`로 파싱해 `searchParams`만
    건드린다(문자열 이어 붙이기는 `#gid=`를 잃고 게시 사본을 없는 주소로 만든다). `tests/three`가 `sandbox === null`을 본다.
29-z-7. **iframe 안 구글 로그인은 사파리(ITP)·카카오 인앱에서 막힌다** — 감지할 길이 없어 '새 탭에서 열기'를 늘 두고 30초 안에 `load`가 없으면 강조한다. 그림으로 굽는 SVG에는 페이지 `@font-face`가 안 따라오니
    `font-family`에 시스템 한글 폰트까지 적는다. **QR은 반전이면 못 읽는 리더가 많다**(흰색을 먼저 칠한다).
29-z-8. **Apps Script 버전 호환 함정** — 클라이언트는 `convert: true`를 안 보내고 `convertTo`만 보내며(**종류는 확장자가 정한다** — 스크립트의 `COPY_AS`), 답마다 실린 `version`이 8 미만이면 워드·PPT
    변환을 안 보낸다. **두 단계**: 업로드는 원본만 올리고 즉시 답하고 사본은 **await 없이** 뒤에서 만든다. 자세한 것은 `docs/APPS_SCRIPT.md`. 드라이브 소유자는 마스터 개인 계정이다(§7 "Drive API 직접").

### 서비스 계층

28-a. **수정 폼이 들고 있는 목록으로 스토어를 덮지 마세요** — 폼(`formData`)은 '수정'을 누른 순간의 스냅샷이라 댓글·활동을 모르고 그대로 저장하면 **저장하는 순간 화면에서 사라진다**. 저장은 `comments`·`activityLog`·
    `attachments`를 payload에서 빼고 `SYNC_TASK`로 병합한다(그 셋은 스토어의 것이 원본 · §6-22).
28-b. **전체 재조회(`LOAD_STATE`)는 열려 있는 업무 창의 댓글·활동을 비운다**(§6-20) — `reloadCloud`가 재조회 뒤 **열린 창의 카드만** 상세를 다시 읽고, 편집 중 카드 변경은 그 카드만 다시
    읽는다(`pendingCardsRef`). **§6-28-a를 고치고도 증상이 그대로였다**(원인이 둘이었다).
29-a. **`services/cloudSync.js`에서 스토어를 import하지 마세요** — `assignees`·`push` 검사가 cloudSync를 노드에서 돌리므로 통째로 `ERR_MODULE_NOT_FOUND`가 된다. 화면에 반영할 값은 부르는 쪽이
    넣는다.

### RLS · 저장

25. **RLS가 걸린 표에 '남의 행'을 넣을 때 `.select()`를 붙이면 전부 롤백된다**(`INSERT … RETURNING`) — `notifications`의 SELECT 정책이 본인 수신 행만 허용해 42501이 되고 **멘션 알림이 한 번도 생성되지
    않았다.**
26. **담당자를 표시명으로 붙이면 이름을 바꿀 때 카드가 남의 것이 된다** — 0013의 `card_assignees(profile_id)`가 원본이고 **표시명은 읽을 때 파생한다**(그래서 `task.assignees`는 여전히 이름 배열이다 · 조인 행이
    없으면 옛 컬럼으로 폴백). 담당자 선택기는 **등록된 멤버만** 고를 수 있다.
27. **조인 테이블은 "전부 지우고 전부 넣기"로 맞추면 안 된다**(왕복이 두 번이라 멱등이 아니고 겹치면 23505) — **집합에 없는 것만 지우고 + on conflict do nothing**(`cloud.resetCardJoin`). 이 판단이 하위
    업무를 조인이 아니라 `cards.subtasks` 컬럼으로 둔 이유다(컬럼 통째 쓰기는 겹쳐도 마지막 것이 남을 뿐이다).
28. **"새로 생긴 것"을 나중에 되계산하지 마세요** — `slice(oldData.length)`가 서로 다른 스냅샷을 견주어 `activity_pkey` 중복이 났다. `TaskService.updateWithLogs`가 **이번에 생긴 기록**을 같이 돌려줘
    계산이 없다.
29. **한 겹 더 벗기면 조용히 `undefined`가 되고 그 자리가 "아무도 안 걸리는 필터"가 된다** — `myUserId()`가 언제나 null이라 **알림의 본인 제외가 한 번도 걸리지 않았다.** 이런 방어는 통과가 기본값이라 깨져도 아무 소리가 안
    난다 — 검사를 남기세요(`tests/push`).
30. **웹 푸시의 상태 원본은 DB 행이 아니라 브라우저의 `PushSubscription`이다** — 화면은 `pushManager.getSubscription()`으로 판정하고 죽은 행은 410/404를 받은 서버가 지운다. **iOS는 홈 화면에 추가한
    뒤에만** 되고 탭과 홈 화면 앱을 **별개 저장소로 취급**한다.
31. **화면에 말을 거는 문장은 화면 필터를 따라가면 안 된다** — 인사말은 `utils.myScope`로 내 것만 센다(§4.10).
31-a. **느슨한 정책 하나가 엄한 정책을 무력화한다 — RLS의 permissive는 OR다.** 라이브에서 두 번 물렸다(0051): `content_images_insert`가 버킷만 봐서 '본인 폴더에만'이 무력화됐고, `services_write`가
    `FOR ALL` + 조건 하나뿐이라 `is_approved()`가 풀렸다. **둘 다 '더 열어 주는 쪽'으로 어긋나서 화면에 증상이 없다.** 좁히려면 새 정책을 **더하지 말고** 있는 정책 안에서 `and`로 감싼다(0047의 files 넷이 그
    모양이다).
31-b. **배타 CHECK를 넣으면 그 컬럼들의 FK `on delete set null`이 지뢰가 된다** — 0047의 CHECK 때문에 카드를 지우는 순간 둘 다 null인 행이 생겨 **업무 삭제가 23514로 죽었다**(FK를 cascade로 같이
    바꿨다). **"이 컬럼이 null이 될 수 있는 다른 길"을 먼저 세어 보고 CHECK를 거세요.**
31-c. **없는 액션 이름은 던지지 않는다 — 조용히 아무 일도 안 한다.** 되돌리기 분기가 없는 이름을 걸러 서버에서 온 카드가 기록에 쌓였다(실행 취소가 남의 저장을 되돌린다). 문자열로 가르는 자리는 소스를 읽는 검사로 부족하고 **실제 스토어를 돌려서**
    확인해야 한다.
31-d. **조회 결과의 `error`를 버리면 실패가 빈 화면으로 둔갑한다** — `api/share.js`가 없는 컬럼을 골라 42703이 났는데 구조분해를 안 해 로그에 한 줄도 안 남고 OG 제목·딥링크가 기본값으로 떨어졌다.
31-e. **`groups`에 `description` 칸은 없다 — 설명은 `note`다**(0035). **없는 칸 이름을 문서에서 옮겨 적기 전에 `information_schema.columns`로 보세요.**
31-f. **비밀번호 해시 규칙이 두 곳에 있다** — `cloud.sha256Hex`(첨부·참고 링크)와 `services/viewPw.js`. 한쪽을 고치면 다른 쪽도. **빈 비밀번호로 풀 때 소금만 남기지 말 것**(세 칸 다 비운다).
31-g. **`insertNotifications`가 본인을 거른다**(0053부터). **새 kind는 0053 CHECK와 INSERT 정책 둘 다**에 넣는다 (한쪽만 넣으면 42501 또는 23514).

그 밖에(번호 없음):
- **"넣으려던 상태가 이미 참"인 유니크 위반(23505)은 실패가 아니다** — 순장 교체가 그렇게 거짓말했다. 저장 **전에** 갈래를 판정하고(`groups.leaderPlan`) DB 오류는 마지막 방어선으로만, 사람 말은 `dupReason`이 얹는다.
- **프로필 자가 복구(`ensureMyProfile`)는 '없으면 만들기'까지만** — upsert여서 OAuth 메타가 사용자가 바꿔 둔 사진·이름을 덮어썼다. 있는 행을 먼저 읽고 없을 때만 insert.
- **로그인 전 자리 복원은 `setSession` 앞에서, 저장소는 sessionStorage**(`auth.jsx`) — `WorkspaceShell`이 `?p=&t=`를 useState 초기값으로 한 번만 읽기 때문이다. `redirectTo`에 쿼리를 싣지
  않는다(허용 목록에 와일드카드가 없으면 조용히 Site URL로 떨어진다). **카카오 자동 시작 표식은 지우는 경로가 없다**(로그아웃 → 자동 재로그인 고리 방지).
- **명단 수정 폼의 이름 초깃값은 `roster_name`이다** — `withDisplayName`이 덮은 `name`을 쓰면 저장 한 번에 `people.name`이 계정 표시명으로 덮인다(라이브에서 두 건이 그렇게 돌아가 있었다).

### 테스트 스크립트 작성 시

- **`/`는 v2부터 홈이다** — 업무 화면을 보는 스위트는 `/?p=dashboard`나 `/?p=<프로젝트>`로 들어간다.
- **CDP 스위트에서 `Page.navigate` 전에 이벤트 큐를 비워라**(옛 `loadEventFired`를 집어 `about:blank`에서 localStorage를 읽고 SecurityError로 죽는다) · lazy 청크가 붙기 전에 클릭하면 통째로
  CRASH다.
- **토스트는 `[data-toast]`로 잡는다**(`[role="status"]`는 dnd-kit의 라이브 리전이 먼저 잡힌다) · **스크립트로 JS 문자열을 고칠 때 `\n`이 실제 줄바꿈으로 들어가면 문자열이 깨진다**(파일로 써서 돌린다) · **"남는
  공간을 채웠나"를 칸의 부모로 재면 늘 0이 나와 통과한다**(감싸개 끝과 스크롤 박스 바닥으로 잰다).
32. 페이지에 주입하는 문자열은 JS 템플릿 리터럴이라 `\d`가 `d`로 죽는다 → `[0-9]`.
33. Chrome은 `linear-gradient` 직렬화에서 `180deg`를 생략한다 → 가로 판정은 `to right`/`90deg`로.
34. `div.hidden.md:block`은 유효한 셀렉터가 아니다(`md\\:block`로 이스케이프).
35. 배지 껍데기와 안쪽 텍스트가 `textContent`가 같다 → `children.length === 0`으로 잎 노드만.
36. `getBoundingClientRect()`는 조상 `overflow`에 잘려 안 보이는 요소도 좌표를 준다 — 보이는지 판정할 때는 조상 clip을 같이 계산한다(`tests/bottomgap`의 `visibleBottom`).
37. **`el.click()`은 `mousedown`을 내보내지 않는다** — 바깥 클릭으로 닫히는 팝오버는 실제 마우스 이벤트로 누른다.
38. **좌표를 미리 재두고 나중에 쓰면 엉뚱한 것을 누른다**(버튼이 밀린다) — 누를 때마다 다시 찾으세요.
39. `Emulation.setTouchEmulationEnabled`의 `maxTouchPoints`는 1~16이다(0을 넘기면 CDP가 던진다).
40. **셀렉터를 못 찾을 때 던지지 말고 FAIL로 남기세요** — 던지면 러너가 `CRASH`로만 찍는다.
41. 리로드 없이 폭만 바꾸면(`setDeviceMetricsOverride`) 넣은 데이터를 그대로 두고 반응형을 볼 수 있다.
42. **시드에 날짜를 박아 두면 달이 바뀌는 날 검사가 스스로 무너진다** — 실행하는 달 기준으로 만든다 (`thisMonth(12)`·`nextMonth(5)`). FAIL을 보면 **먼저 main에서도 실패하는지** 보되, dev 서버가 떠 있거나 다른
    에이전트가 같은 트리에서 일하는 중이면 `git stash` 대신 `git worktree`로 HEAD를 따로 서빙한다.
42-a. **여러 에이전트가 동시에 스위트를 돌리면 코드가 멀쩡해도 깨진다** — 스크립트마다 크롬 디버그 포트가 고정이고 게스트 dev 서버도 한 대라 서로의 크롬에 붙는다(러너를 둘 띄우면 포트 분리 보호가 없다). **깨진 스위트는 혼자 다시 돌려 보는 것이 첫
    수순이고, 재실행으로 갈리는 실패를 코드 회귀로 단정하지 마세요.**

### AI

43. **AI가 돌려준 문자열을 그대로 화면에 넣지 마세요** — 실패해도 안내 문구를 **문자열로** 돌려주므로 truthy라 `if (result) setContent(result)`를 통과해 다듬기에서 **쓰던 본문이 그 한 줄로 갈아치워졌다.**
    `isFallbackText(text)`로 **부르는 쪽이 반드시** 거른다.
44. **AI에게 절차를 베껴 주지 마세요** — 프롬프트에 심은 회계 절차가 앱 안 정본과 어긋났다. 정본이 있는 것은 **그 자리를 가리키게** 하고 "지어내지 마라"만 규칙으로 넣는다(`BUDGET_CONTEXT`).
45. **멘션은 표시명 정확 일치다**(`이시온`의 표시명이 `시온`이라 `@이시온`은 아무에게도 안 간다) — 프롬프트에 `멘션은 @표시명`을 싣고 `sanitizeMentions`가 한 번 더 거른다. 뽑는 규칙은 `utils.extractMentions` 하나.
46. **프롬프트에 넣는 값은 실제 모양으로 읽으세요** — 하위 업무 키가 `title`인데 `x.text`로 읽어 항상 빈 목록이 실렸고 겉보기에는 "AI가 체크를 무시한다"였다(**검사 픽스처가 `text` 키라 못 잡았다**). AI 관련 버그는 모델을
    의심하기 전에 **프롬프트에 실제로 실린 글자를 찍어 보세요.**

### 짧은 목록(MenuPick)은 떠서 나온다 (2026-09-09 · §6-9-an의 예외)

**33-a.** `isTouchNarrow()`로 흐름에 그리는 규칙은 **입력칸이 있는 피커(`PersonPick`)만**이다 — 근거가 iOS 키보드였고 `MenuPick`에는 입력칸이 없다. 흐름에 두면 머리줄에서 제목·가로선이 통째로 내려간다.

**33-b.** `PersonPick`과 `MenuPick`은 한 파일에 있고 `const next = isTouchNarrow();` 줄이 **둘 다에** 있었다 — 하나만 고치려고 찾아 바꾸니 앞의 것이 잡혀 모임 화면이 통째로
    죽었다(`ReferenceError`). **같은 파일의 같은 줄을 고칠 때는 어느 부품의 것인지 확인하세요.**

### 합친 계정 · 그림 내보내기에서 또 밟은 것 (2026-09-10)

**34-a.** **파일이 크면 폰에서 공유가 실패한다**(QR PNG는 10KB지만 주보 1쪽은 본문 전문이 들어 몇 MB다) — `MAX_PIXELS`를 하드 상한(16.7M)이 아니라 **4M**으로 잡고 PDF는 JPEG 0.85로 굽는다. 하드 상한은
    `toBlob`이 null을 주는 자리이고 **그 아래에서도 공유는 실패한다.**

**34-b.** **`저장`이라고 적힌 버튼이 공유 시트를 열면 두 번 같은 일이다** — 폰에서는 내려받기가 막혀 결국 공유로 가므로 이름은 **'이미지로 공유'**·'PDF로 공유'다(동아리 QR은 공유 하나만 남겼다). 하는 일을 그대로 적는다.

**34-c.** **합친 계정으로 로그인하면 '승인 대기'에 갇혔다** — 0059/0060은 데이터만 옮기고 로그인 신원은 그대로다. 0061의 `effective_uid()`가 그 자리를 메운다. **`auth.uid()`를 그대로 보는 자리를 새로 만들 때는
    "합친 계정이면?"을 한 번 물어 보세요.**

**34-d.** **클라이언트도 같은 값을 봐야 한다** — DB 정책만 고치면 화면은 자기 uid로 `.eq('profile_id', …)`를 걸어 **노트·묵상이 한 줄도 안 나온다.** `supabaseClient.myUid()` 한 벌을
    쓰고(`word`·`worship`·`groups`·`people`) 세션이 바뀌면 `resetMyUid()`로 버린다.

**34-e.** **템플릿 문자열 안의 `\s`는 그냥 `s`다** — 그렇게 짠 검사가 조용히 안 맞아 **일부러 되돌려도 통과했다.** 정규식은 리터럴(`/…/`)로 쓰세요. SQL 파일을 글자로 볼 때는 **주석 줄과 `comment on` 문장을 걷어야**
    한다.

**34-f.** **`new Map(배열)`은 같은 열쇠에서 뒤에 온 것이 이긴다** — `nameToAvatar`에서 같은 이름이면 합쳐진 행이 남긴 행을 덮어 합친 계정의 사진이 옛 것으로 나왔다. 지금은 **합쳐지지 않은 행을 먼저 넣고, 합쳐진 행은 그 이름에
    사진이 없을 때만** 채운다(환송한 사람은 그대로 — 지난 댓글의 사진이다). 이 표 하나가 화면 아홉 곳을 정한다.

**34-g.** **합친 계정으로 '내 정보'를 고치면 자기 행에 써져 화면에 안 보였다** — 보이는 것은 남긴 계정 (`loadCloudState`의 `shownProfile`)인데 저장은 `auth.uid()`로 갔다. **0063으로 닫혔다**(2026-09-11):
    `profiles_update`·`profile_teams write own`이 `effective_uid()`를 보고 `updateMyProfile`·`setMyTeams`가 `myUid()`로 쓴다.

**34-h.** **"편집 권한을 줬는데 앱에서 수정이 안 된다"는 두 갈래다.** ① **서드파티 쿠키** — iframe 안의 구글은 브라우저의 구글 로그인 상태를 쓰고 사파리·카카오 인앱·시크릿은 그것을 막는다(**앱 안 창에서는 구조적으로 못 고친다**). ②
    **기본 계정** — 기본 구글 계정이 편집자와 다르면 읽기 화면이라 `authuser=<이메일>`을 붙인다 (`copyEditUrl`·`docEmbedSrc` · 값은 세션의 `user.email`). 첫 갈래를 받는 것이 **'구글 문서에서 편집'(새
    탭)** 이고 자격자에게는 언제나 보인다(§8). `previewCopyUrl`(보기)은 **영영 편집 주소를 만들지 않는다**(§7).
**34-h-2.** **업무 첨부도 같은 길이다**(2026-09-11 · 자격은 올린 사람+마스터+관리자). 다만 **권한을 붙인 뒤에 열어야 한다** — 사본에 편집자가 없는 채로 편집 주소를 열면 구글이 읽기 화면을 주고 그것이 위 신고의 정체다.
    그래서 누를 때 **빈 탭을 제스처 안에서 먼저 열고**(안 그러면 팝업 차단) `grantCopyEditors`를 기다린 뒤 그 탭의 `location`을 옮긴다(Apps Script v11 `grantEditors` · 멱등 · 실패하면 탭을 닫고 토스트).
    `window.open('', '_blank', 'noreferrer')`처럼 features를 주면 **null이 와서** 주소를 실을 창이 없다. 관리자 명단은 **서버가** 읽는다(`admins`는 관리자에게만 열려 있어 브라우저에서는 조용히 0행이다).

**34-i.** **한 자리만 옮기면 나머지가 조용히 어긋난다 — 0061이 남긴 것을 0063이 덮었다**(읽기 전용 감사 2026-09-11). 0061은 `is_approved`·`my_person_id`와 개인 표 셋의 정책만 옮겼고, **그 밖의
    `auth.uid()`는 그대로였다.** 그래서 합친 계정으로 로그인하면 이런 것들이 **오류 없이** 어긋났다 — 첨부 업로드·드라이브 미리보기 403(`api/drive.js`·`api/drive-file.js`가 서비스 키라 `is_approved()`를
    못 쓰고 승인 칸을 직접 읽었다 · 합친 행은 환송 처리라 `approved = false`) · 알림 벨이 거의 빔(정책 셋 + 클라이언트 + 실시간 필터) · '내 순에 공유된 노트' 0건(`same_sun`) · 옛 댓글·업무·첨부·링크
    삭제 실패 · 반응 토글 안 됨 · 다녀간 시각 안 찍힘 · 멘션 알림이 두세 벌(`nameToIdsMap`이 한 이름에 두 id를 잡았다). 0063이 **정책 열다섯 · 함수 셋 · 컬럼 기본값 하나**를 한 번에 옮겼고
    `alter policy`만 써서 정책 수는 그대로다(§6-31-a).
    **규칙**: "내 것인가"를 보는 자리(using)는 `in (auth.uid(), public.effective_uid())`로 **두 id를 다 내 것으로 본다**(합치기 전후로 행이 두 id에 갈려 있다 — 0059는 '누가 눌렀나' 칸을 일부러 안 옮겼다).
    **주인을 새로 적는 자리**(insert의 with check)는 `effective_uid()` 하나다. `profiles_insert`만 예외로 `auth.uid() = id`다(가입 순간 자기 행을 만드는 자리).
    **`auth.uid()`를 보는 자리를 새로 만들 때는 `effective_uid()`를 쓰세요** — DB 밖(서버 키·클라이언트)이라면 `merged_into`를 따라가거나 `supabaseClient.myUid()`를 쓴다.
    아직 `auth.uid()`인 채로 **남겨 둔 것**: 컬럼 기본값들(`comments.author_id`·`cards.created_by`·`files.uploaded_by`·`activity.actor_id` — 0061이 "누가 눌렀나의 기록"이라 일부러 남긴 것)
    · 개인 표 셋의 `profile_id` 기본값(클라이언트가 언제나 값을 실어 보내서 안 쓰인다) · Storage 정책의 폴더 이름(`0003`·`0004` — 본문 이미지·프로필 사진 경로다).


### 업무 창에는 링크가 없습니다 (2026-09-11에 되돌렸다)

**35. 되돌렸다** — 2026-09-10에 0058의 링크를 첨부 구역 안 한 목록(`+ 파일`·`+ 링크`)으로 옮겼는데 사용자가 걷었다("링크 첨부 방식을 넣지 말고 기존처럼 돌리되"). **업무 창에는 링크 줄도, `+ 링크`도, '참고 링크'라는 말도 없다** —
    첨부 구역은 예전 점선 상자 그대로다(`tests/handoff`·`logcheck`가 단정).

- 링크를 다는 자리는 **프로젝트 헤더 하나**다(칩 · `+ 참고 링크` · §4.6 · §8). 표(`resource_links`)와 `cloudSync.link*Cloud`·`components/links.jsx`는 그 헤더가 쓰므로 남아 있다 — `LinkRow`·`modals.linkOps`만 지웠다.

### 종이 · 그림 내보내기 (2026-09-09)

**32-a.** **`navigator.share`는 사용자 제스처가 살아 있는 동안만 열린다**(크롬 약 5초) — 누른 뒤에 청크를 받고 굽고 share를 부르면 느린 회선에서 `NotAllowedError`다. 종이가 서면 `preloadExport()`로
    **미리** 받는다 (lazy import 자체가 문제가 아니라 **그것을 공유 앞에 두는 것**이 문제다).

**32-b.** **세로로 긴 종이는 캔버스 상한을 넘겨 `toBlob`이 null을 준다**(iOS는 약 16.7M 화소) — `shareImage.nodeToPng`이 배율을 상한 안으로 깎는다. **원하는 배율을 그대로 쓰지 마세요.**

**32-c.** **카카오톡 인앱 웹뷰는 공유 시트도 내려받기도 없다** — 사다리의 마지막은 `window.open`(새 탭)이고 **그마저 팝업 차단에 막히면 토스트로 말해야 한다**(예전에는 `console.error`만 찍어 정말 아무 일도 없었다).

**32-d.** **PDF 안의 글자는 그림이다**(쪽을 캔버스로 구워 담는다 — 복사·검색이 안 된다). **PDF의 값은 "두 쪽이 한 파일로 간다" 하나**로 두고 갔다(§7).

**32-e.** **종이에 `max-w`를 쓰는 것은 §6-9-k의 예외다** — 인쇄물이라 560px에서 멈추는 것이 맞다(가이드 종이도 같은 값). 앱 화면의 상자에는 여전히 쓰지 않는다.

**32-f.** **`SectionHead`의 오른쪽 묶음이 두 줄로 접히면 제목과 가로선이 따라 내려간다**(`items-center`) — 버튼이 넷 이상인 머리줄에는 `wrapRight`를 주세요(위로 맞추고 가로선만 제목 한가운데 높이로 내린다).

**32-g.** **미리 받아 두는 것만으로는 폰에서 공유가 안 된다 — 미리 굽어 둬야 한다.** 남은 시간이 굽는 시간이었고 그 사이 iOS가 자격을 거둬 간다(데스크톱은 빨라서 창 안에 들어왔다). `hooks/useSheetShare`가 종이가 서고 700ms
    뒤에 뒤에서 굽고 버튼은 이미 만든 파일을 보내기만 한다. **`share()` 앞에 `await`를 두지 마세요.**

**32-h.** **홈 화면에 추가한 앱(PWA standalone)은 내려받기가 막힌다** — 카카오 인앱과 같은 갈래로 다룬다 (`shareImage.isStandalone()`이 `navigator.standalone`과 `display-mode`를 같이
    본다).

**32-i.** **종이에 `RichText`를 쓰지 마세요** — 그 뷰어는 앱 토큰으로 칠해 **다크 모드를 따라간다**(그림으로 구우면 어두운 종이가 된다). `paper.jsx`의 `PaperText`가 필요한 만큼만 그린다(`**굵게**`는
    `splitBold` 한 벌).

**32-j.** **`canShare`로 공유의 문을 잠그지 마세요** — 폰에서 아무 일도 없던 **결정적 원인**이다. `canShare`가 없거나 거짓을 주면 share를 아예 부르지 않고 내려받기로 떨어졌고 그것도 막혀 있었다. 지금은
    `navigator.share`가 있으면 **부르고** 거부하면 다음 갈래로 간다. 실패 갈래에서 `console.error`를 쓰지 마세요(검사의 '콘솔 오류 0').

**32-k.** **마지막 갈래는 API가 필요 없어야 한다** — 공유도 내려받기도 막힌 자리가 실재하므로 그때는 **그림을 화면에 띄운다**(`useSheetShare`의 `overlay` — 길게 눌러 저장). PDF는 쪽마다 PNG로 다시 구워 띄운다.

**32-l.** **노트 도막 제목은 저장 자리에서 되살린다**(`noteTemplate.ensureNoteSections`) — 편집기 안에서 손을 막는 대신 **저장되는 글**에서 보장하면 붙여넣기·되돌리기와 안 부딪히고 한 자리만 지키면 된다. 잃는 것이 없어야
    한다(쓴 글·제목 앞의 글·사람이 새로 만든 도막은 뒤에 붙는다). **딸린 자리** — `wordView`의 `syncedBody.current`도 되살린 글로 옮긴다(안 그러면 다음 도착값이 편집기를 덮는다).

**32-m.** **마지막 갈래를 그리는 것도 잊지 마세요** — `useSheetShare`가 돌려주는 `overlay`를 네 화면에서 렌더하지 않아 사다리는 끝까지 갔는데 화면에 아무것도 안 나왔다. `{img.overlay}`를 한 줄로 놓으세요.

**32-n.** **실패는 토스트가 아니라 그 전면 화면에 이유까지 적는다** — 폰에서는 토스트를 놓치기 쉽고 무엇이 막혔는지가 다음 걸음의 유일한 재료다. §8의 '실패 문구에 기술 용어 금지'는 **평소 문구**의 규칙이다.

**32-o.** **노트 도막 제목은 편집기 안에서도 지워지지 않는다**(`MarkdownEditor`의 `LockedHeadings`가 `filterTransaction`으로 물린다). **딸린 함정**: 바깥에서 문서를 통째로 교체할 때도 트랜잭션이 돌아 옛
    노트를 못 받으므로 그동안은 `bypass()`로 통과시킨다. 잠그는 것은 **지금 목록만**이다(옛 이름은 지울 수 있어야 한다).

**32-p.** **노트는 종이 안에서 쓴다**(2026-09-10) — 편집 화면이 읽기 종이와 **같은 부품**으로 선다(`paper.jsx`의 `PaperMast`·`PaperNoteHead`·`PaperSheet`·`NotePaper`가 그래서
    export다). 도막 자리에 읽기는 `PaperRow` 여러 줄, 편집은 `MarkdownEditor` 하나(`frame` prop). **도막마다 편집기를 두는 길은 안 갔다**(저장 자리가 갈린다). 라벨·칸은 `index.css` `.note-paper
    .tiptap`의 두 열 격자 한 겹이 만든다(제목은 1열, 그 밖은 2열 — 격자 자동 배치가 줄을 되감지 않는 성질을 쓴다 · DOM 순서는 그대로라 커서·선택이 예전과 같다). 함정 넷: **`.tiptap > * + *`의 margin-top을 0으로
    누른다**(줄 간격은 padding) · **칸 사이는 gap이 아니라 글 칸의 `padding-left`** (gap이면 가로선이 끊긴다) · 가로선은 제목과 다음 블록의 `border-top` 두 조각 · **누를 빈 자리는 `.tiptap`
    밖**(`.note-paper .paper-rows`의 min-height). 색은 `PaperSheet`가 흘려 준 `--paper-*`다. 좁은 화면(<640)에서는 라벨이 칸 위에 서고 가로선을 제목에만 남긴다. 그 대가로 **읽기·편집 두 모드의 높이가
    더는 같지 않다**(HANDOFF §2에 적어 두었다).

**32-r.** **html2canvas에서 굽는 시간의 대부분은 화소가 아니라 `document` 복제였다**(비용이 DOM 개수라 배율을 낮춰도 줄지 않는다) — `ignoreElements`로 굽는 가지만 남기면 2412ms → 905ms이고 판정식은 하나다
    (`(el) => !(el.contains(node) || node.contains(el) || document.head.contains(el))`). **`<head>`는 반드시 남기세요**(빼면 스타일이 통째로 없는 맨 HTML로 구워진다). **두 쪽은
    각각 굽지 말고 가장 가까운 공통 조상을 한 번 굽고 잘라 담는다**(`shareImage.bakeAndSlice` — 5.3초가 1024ms). 조상은 `backgroundColor: null`로 굽고 **쪽마다 종이 바탕을 먼저 깐 뒤**
    drawImage(안 깔면 카카오톡에서 검은 종이다).

**32-s.** **누를 때 굽고 있으면 그 약속을 이어받으세요 — 다시 구우면 체감이 두 배다.** 굽기를 시작하는 자리를 `useSheetShare.ensure()` 하나로 모으고 `share()`는 그것을 `await`한다(**`share()` 안에서
    `bake()`를 새로 부르지 마세요**). 구운 Blob은 **모듈 레벨 Map**(상한 8개)에 남기고 열쇠는 `kind|fileName|key`다(key만으로는 노트와 주보가 부딪힌다) · 늦게 도착하는 결과는 **세대 번호로 거른다.** '공유' 버튼의
    아이콘은 `Share2`다(§6-34-b).

**32-t.** **html2canvas는 화면을 베끼지 않고 다시 그린다 — 그래서 종이가 화면과 달랐다**(2026-09-11). 글자·줄·flex 정렬을 자기 방식으로 다시 계산해서 마스트·라벨의 기준선이 12화소 밀리고 줄 간격이 벌어지고 가이드 머리줄의
    하트가 제목 위로 떴다. **1차는 `modern-screenshot`이다**(사용자 결정) — 노드를 SVG `foreignObject`에 넣어 **브라우저에게 그리게** 하므로 화면 스크린샷과 픽셀 단위로 같다. `domToCanvas(node, {
    scale, width, height, backgroundColor })` 하나만 쓰고 **`width`·`height`를 명시하세요** (안 주면 소수점 폭 때문에 `bakeAndSlice`의 배율이 어긋나 긴 종이에서 좌표가 밀린다 · 가지치기는 필요
    없다). **html2canvas는 대비용으로 남긴다** — 사파리에서 foreignObject가 빈 캔버스를 주는 보고가 있어 `shareImage.isBlankCanvas`(16×16 격자 256점, **줄 단위로 읽는다**)로 한 색이면 그 길로 떨어지고,
    읽지 못하면 (오염된 캔버스) **비지 않았다고 본다.** 속도는 조금 잃었다(주보 1쪽 0.9 → 1.6초) — 미리 굽기·약속 이어받기· Blob 캐시가 그대로라 **충실도를 골랐다.** 검사는 구운 종이와 **실제 화면 스크린샷**을 겹쳐 ±3화소로
    단정한다 — **화면을 찍을 때는 종이를 창 안으로 들여놓으세요**(앱은 `main`을 스크롤해서 `captureBeyondViewport`가 안 듣는다).

### 엑셀 미리보기 — 우리가 그리던 시절 (지금은 없습니다)

표를 우리 손으로 그리던 화면(`components/SheetView.jsx`)과 조건부 서식 계산기(`services/formula.js`)는 2026-08-30에 통째로 지웠다 — 지금은 구글 시트 사본을 iframe으로 띄우는 것뿐이고(§6-29-c) 남은 것은
`services/xlsx.js`의 파서 하나(첨부 내용 검색이 쓴다). 그 화면을 지키던 함정 다섯(**옛 47~51번**)도 같이 뺐다 — **그 번호는 다시 쓰지 마세요**(지난 커밋과 코드 주석이 아직 그 뜻으로 가리킬 수 있다).
