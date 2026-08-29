# 더다붓 워크스페이스 (church-workspace)

교회 청년부·임원진·사역 팀을 위한 협업 툴입니다. 칸반 보드와 캘린더로 프로젝트를 굴리고,
Supabase를 DB로 두고 Vercel에 배포합니다. 로그인 설정 없이도 로컬(게스트) 모드로 돕니다.

- 레포: `github.com/thedaboot/church-workspace` · 배포: Vercel (`main` 푸시 시 자동)
- 코드 위치·함정·관례는 [`HANDOFF.md`](HANDOFF.md)에 정리되어 있습니다. 새로 합류했다면 그 문서부터 읽으세요.

## 시작하기

```bash
git clone https://github.com/thedaboot/church-workspace.git
cd church-workspace
npm install
npm run dev          # 개발 서버
npm run build        # dist/ 로 빌드 (npm run preview 로 확인)
npm run verify       # 브라우저 검증 스위트 (tests/README.md)
```

`.env` 없이 실행하면 로그인 없는 게스트 모드로, 데이터는 브라우저 localStorage에 저장됩니다.
`api/` 서버 함수(AI·공유 미리보기·드라이브)까지 같이 띄우려면 `npx vercel dev`를 쓰세요.

## 기능

**프로젝트**
- 칸반 보드 — 시작 전 / 진행 중 / 보류 중 / 완료. 드래그 앤 드롭(마우스·터치)으로 상태를 옮기고,
  모바일에서는 카드의 ⇄ 버튼으로 한 번에 바꿉니다. 팀 필터는 여러 개를 함께 고를 수 있습니다(OR).
- 캘린더 — 한 업무는 한 줄, 시작~마감이 띠로 이어집니다. 색은 담당 팀 색을 따르고 여러 팀이
  걸린 업무는 줄무늬로 표시합니다. 칸에 다 안 들어가면 `+N건`으로 접습니다. 날짜를 누르면
  그 날 업무가 목록으로 펼쳐집니다(데스크톱은 오른쪽 열, 모바일은 하단).
- 참고 링크 — 기획안·시트 같은 외부 링크를 프로젝트 상단에 달아 둡니다. 노션·유튜브·
  인스타그램·핀터레스트·피그마·구글 드라이브·쿠팡은 이름 앞에 아주 작은 서비스 표시가
  붙습니다. 링크가 늘어도 공유·삭제 버튼은 자리를 지킵니다(가로로 미는 칸 밖에 있습니다).
- 보관 — 끝난 프로젝트를 상단 탭·대시보드에서 뺍니다. 지우는 것이 아니라 업무는 그대로 남고,
  검색과 '더보기 > 보관함'(연도별)에서 다시 찾습니다. 이름 수정 창에서 켜고 끕니다.
- 탭 순서 — 프로젝트 탭을 데스크톱은 끌어서, 모바일은 **길게 눌러** 끌어서 바꿉니다.
  순서는 저장되어 전원이 같은 순서를 봅니다.

**업무**
- WYSIWYG 상세 내용(TipTap) — 툴바로 쓰고, 마크다운 문법 입력도 그대로 먹습니다.
  **저장 형식은 마크다운 문자열**이라 뷰어·AI·기존 데이터와 호환됩니다.
- 첨부 파일(클라우드 모드) — 수정 모드에서 드래그앤드롭·붙여넣기로 올립니다. 한 파일 25MB,
  여러 장을 고르면 **동시 3개**로 올라갑니다. 실체는 **개인 구글 드라이브**에
  `프로젝트 / 업무 / 파일` 폴더로 들어가고 DB에는 참조만 남습니다([`docs/DRIVE.md`](docs/DRIVE.md)).
  업무·프로젝트를 지우면 드라이브 폴더도 **폴더째 휴지통**으로 갑니다(30일 복구).
  앱 안 미리보기 — PDF(pdf.js) · 이미지 · 영상 · 소리 · 텍스트에 더해 **워드·PPT는 우리
  파서**로 앱이 직접 그립니다(`services/docx.js`·`pptx.js`). 올린 그 순간부터 보이고,
  다크 모드와 톤이 맞습니다. **엑셀·csv 펼쳐보기는 구글 스프레드시트 화면 그대로**입니다
  (사용자 결정 2026-08-29) — 올릴 때 Apps Script가 만들어 둔 네이티브 시트 사본
  (`files.preview_file_id`, 0031)을 보여줘서 기다림이 없습니다. 원본 `.xlsx`는 그대로
  남아 내려받기·검색이 씁니다(`xlsx.js`는 글자 뽑기 파서만 남았습니다).
  사진이 여러 장이면 미리보기에서 좌우로 넘길 수 있습니다.
  첨부에서 뽑은 글(앞 2000자)은 `files.text_excerpt`에 남아 **검색과 AI 요약이 같이 읽습니다**
  — 새로 올리는 파일부터 쌓이고, 사진은 뽑을 것이 없어 비어 있습니다.
- 하위 업무 — 업무를 여러 개로 나눠 체크리스트로 만듭니다. 보기 모드에서도 체크가 되고,
  보드 카드에 `3/5` 진척이 붙습니다. 이름 수정·삭제는 수정 모드에서, 삭제는 확인을 거칩니다.
- 댓글·@멘션 자동완성, 활동 기록(생성·상태·필드 변경·댓글·첨부).
  보드 카드에 댓글·첨부 개수가 표시됩니다(개수만 카드가 들고 있어서, 목록을 볼 때
  댓글을 다시 읽지 않습니다).
- 댓글 반응 — 댓글마다 **좋아요(하트)·최고(따봉)·확인(체크)** 세 가지를 달 수 있습니다
  (다시 누르면 취소, 한 사람이 셋 다 눌러도 됩니다). 누른 사람 얼굴이 아이콘 옆에
  **바로** 보이고, 네 명째부터는 `+N`을 눌러 전체 목록을 봅니다.
  반응을 받으면 종·푸시로 알리고, 내 댓글에 내가 누른 것은 알리지 않습니다.
- 알림(클라우드 모드) — 멘션, 내 댓글의 답글·반응, **담당자로 지정됨**, **마감 임박**이 헤더 종에
  실시간으로 쌓입니다. 업무 저장 시에는 이전에 없던 새 멘션·새 담당자만 알립니다.
  더 이상 맞지 않는 알림은 한 건씩 지울 수 있습니다.
- 웹 푸시 — 종 팝오버의 '이 기기로 알림 받기'를 켜면 앱을 닫아 둔 동안에도 알림이 옵니다.
  마감 임박(오늘·내일 마감인데 완료가 아닌 업무)은 하루 한 번 담당자에게 갑니다.
  **아이폰은 홈 화면에 추가한 뒤에만 동작합니다**(iOS 16.4+).

**전체**
- 대시보드 — 마감 구간(지연·오늘·이번 주·다음 주·**마감 미정**·끝낸 업무)별 할 일,
  프로젝트 진척도, 팀별·청년별 남은 업무, "지난 7일 간 N건 끝냈어요". 마감이 2주 넘게
  안 정해진 업무는 따로 표시합니다. 고른 필터(전체/내 업무/내 팀)는 주소에 남아
  새로고침해도 유지됩니다. 아래로는 **함께하는 사람**(접속 중이면 초록 원), **최근 활동**
  피드, **프로젝트 연결 지도**가 있습니다.
- 프로젝트 연결 지도 — 사람—팀—프로젝트를 잇는 노드 그래프. 팀은 가운데 열에 고정되고
  사람·프로젝트는 서로 밀며 자리를 잡습니다. **노드를 끌어다 놓으면 그 자리에 남습니다.**
  프로젝트 화면의 '그래프' 보기(업무 선후관계)도 같은 물리를 씁니다.
- 지금 누가 어디를 — 프로젝트 탭과 보드 카드에, 지금 그것을 보고 있는 사람 얼굴이
  최대 3명 겹쳐 뜹니다(본인 제외 · **한 사람은 한 곳에만**). 실시간 표시일 뿐
  **어디에도 기록되지 않습니다** — 자리를 옮기거나 나가면 얼굴도 바로 사라집니다.
- 전체 일정 — 프로젝트를 넘나드는 캘린더 하나. 팀으로 걸러 봅니다
  (데스크톱은 상단 메뉴 '전체 일정', 모바일은 상단바 달력 아이콘).
- 통합 검색 — 두 글자 이상 입력하면 프로젝트와 업무를 함께 찾고, 고르면 해당 보드·업무 창까지 엽니다.
  띄어쓰기는 무시하고("버스견적"으로 "전세버스 견적서"가 잡힙니다), 제목·본문뿐 아니라
  담당자·팀·댓글·첨부 **이름과 파일 안의 글**까지 봅니다(첨부는 한 번 열어 본 카드에서).
- 공유 — 모바일은 OS 공유 시트, 그 외는 링크 복사. 카카오톡 미리보기(OG)는 `api/share.js`가 처리합니다.
- Gemini AI — 업무 3줄 요약, 본문 구조화 다듬기(`api/ai.js` 경유, `gemini-3.1-flash-lite`).
  **AI가 무엇을 보고 무엇을 쓰는지는 [`docs/AI.md`](docs/AI.md)가 기준입니다.**
  프롬프트에는 오늘 날짜(마감까지 남은/지난 날), 하위 업무의 **끝낸 것과 남은 것**,
  선후관계, 같은 프로젝트의 다른 업무, **다른 프로젝트에서 지금 돌아가는 일과 같은 팀이
  예전에 끝낸 업무**, 첨부 이름과 그 안의 글, 그리고 **그 업무에 등장하는 사람만** 골라
  팀·직함과 함께 실립니다. 배경 지식으로 교회 달력(주일 4부 청년 예배의 순서 · 성찬 예배 ·
  Q예배 · 금요 열정 예배 · 준비 마감), 팀 소관, 순과 조의 구분, 문구 톤 규칙이 들어갑니다.
  팀·직함은 코드가 아니라 DB에서 옵니다(`profiles.team_id`·`role_note`) — 사람이 바뀌면
  그 행만 고칩니다. 회계 절차처럼 워크스페이스 안에 정본이 있는 것은 프롬프트에 베끼지 않고
  그 업무를 가리키게 합니다.
  요약은 같은 카드를 다시 열면 다시 부르지 않고(캐시 — 하위 업무 체크가 바뀌면 무효),
  마스터가 '이 요약 고정'을 누르면 카드에 남아(`cards.ai_summary`) 모두가 같은 요약을 봅니다.
  고정해도 업무 창을 열자마자 펼쳐지지는 않습니다 — **'3줄 요약'을 눌렀을 때** 나옵니다.
  저장된 것을 보여주므로 AI를 다시 부르지는 않지만, 화면은 새로 만드는 것과 똑같이
  '분석하는 중'을 2초 지나서 나옵니다. 읽는 사람은 그게 저장된 글인지 알 수 없고,
  '고정' 표시와 '고치기'는 마스터에게만 보입니다(저장된 요약의 한 줄만 손볼 수 있습니다 —
  다시 돌리면 딴 글이 나오니까요). 고정한 뒤에 업무가 바뀌면 마스터에게
  **'고정한 뒤로 업무가 바뀌었어요'** 가 붙습니다 — 고정본은 일부러 다시 만들지 않으니까요.
  AI 기능이 마스터 전용인 이유는 돈이 들고 워크스페이스 전체에 남는 글을 만들기 때문입니다.
  **다듬기**는 회의록(강평회)도 다룹니다 — '정한 것 / 아직 정하지 못한 것 / 누가 무엇을
  언제까지'로 갈라 주고, 우리 표현(3층 본당 · 주일 4부 청년 예배 · 순 · 콘티 · 송폼)으로
  맞추며, 굵게는 숫자에 형광펜은 판단에 씁니다. 원문에 나오는 사람은 `@표시명`으로 불러
  **업무를 저장할 때** 그 사람에게 알림이 갑니다(사람이 저장을 눌러야 나가는 안전장치).
  다듬은 직후에는 **'되돌리기'** 가 떠서 원래 글로 한 번 돌아갈 수 있습니다.
  원문이 **다른 업무를 언급하면 그 대목이 눌러서 열리는 링크**가 됩니다 — 새 창이 아니라
  앱 안에서 그 업무 창이 뜹니다. AI는 제목 표시만 쓰고 링크는 저장 전에 제목 정확 일치로만
  만들어(못 찾으면 그냥 글자로) 죽은 링크가 본문에 남지 않습니다.
- 실행 취소/다시 실행 — 게스트 모드 전용(여러 사람이 함께 쓰는 클라우드 모드에서는 감춥니다).
  대신 목록·보드에서 상태를 옮기면 '되돌리기' 토스트가 뜨고, 누르면 DB까지 함께 되돌립니다
  (그 사이 다른 사람이 바꿨으면 덮지 않고 알려줍니다).
- PWA — 홈 화면에 추가하면 앱처럼 전체 화면으로 열립니다. 아이콘은 `scripts/make_icons.py`로 생성.
- 라이트/다크 — 처음엔 시스템 설정을 따르고, 헤더에서 바꾼 선택을 기억합니다.

## 기술 스택

- Vite 8 · React 19 · Tailwind CSS 4 + [SEED Design](https://seed-design.io/)(파운데이션 토큰)
- [TipTap](https://tiptap.dev/) 3 (WYSIWYG, 저장은 마크다운 서브셋) · dnd-kit · pdf.js · lucide-react
- 폰트: SUIT Variable (Pretendard는 폴백)
- 백엔드: Supabase(Postgres · Auth · Storage · Realtime) · Vercel 서버 함수

## 구조

```
src/
├── App.jsx              조립 · 라우팅 상태 · 내비 마운트 분기
├── config.js            팀·상태 상수, 팀 색
├── index.css            디자인 토큰 · 모션 · 그리드 유틸
├── store/               useSyncExternalStore 기반 커스텀 스토어 + 셀렉터
├── services/            domain · cloud(Supabase) · cloudSync · markdown · ai · auth · presence
├── hooks/               controllers · useIsMobile · useForceGraph(그래프 시뮬·드래그)
├── components/          layout(상단 2줄 내비 · 모바일 탭바) · boards(칸반) · calendar
│                        depgraph(업무 선후 그래프) · MarkdownEditor · RichText ·
│                        MentionInput · FilePreviewModal · PdfView 등
├── views/               views(대시보드·프로젝트·내 업무·팀·전체 일정) · dashboardParts(공유 부품)
│                        · membersView(가입 승인·관리자 지정)
└── modals/              업무 상세·수정, 프로필, 프로젝트 생성/이름 변경
```

상태는 `{ byId, allIds }`로 정규화해 Map 룩업으로 읽고, 화면(views) → 컨트롤러(hooks) →
서비스(services) → Supabase 순으로 책임을 나눴습니다. 에디터 문서 모델과 저장 형식(마크다운)
사이의 변환은 `services/markdown.js`에만 있어서, 에디터를 바꿔도 뷰어·AI·기존 데이터가 영향을 받지 않습니다.

## 디자인

현재 기준은 외부 디자인 핸드오프 문서이고, 구현 규칙(토큰·모션·그리드·아이콘·폰트)은
[`HANDOFF.md`](HANDOFF.md)의 "디자인 토큰 · 모션" 절에 정리해 두었습니다. 값은 모두
`src/index.css` 한 곳에 있습니다.

> `docs/DESIGN.md`는 이전 노션 기준 스펙으로, 현재 화면과 맞지 않습니다. 참고용으로만 남겨 둡니다.

## 로그인 (선택)

1. [supabase.com](https://supabase.com)에서 프로젝트를 만들고 `Settings → API`에서 URL과 anon key를 확인합니다.
2. `Authentication → Providers`에서 Google / Kakao를 활성화합니다.
3. `.env.example`을 `.env`로 복사해 값을 채우고 개발 서버를 재시작합니다.
4. 첫 로그인 직후 표시 이름과 소속 팀을 정하는 창이 열립니다. 이후에는 헤더의 프로필 메뉴에서 바꿉니다.

권한은 세 층입니다(`admins` 테이블이 원본 — 0022에서 `VITE_ADMIN_EMAILS`를 없앴고,
화면과 DB가 같은 `is_admin()`·`is_master()`를 봅니다. 재배포가 필요하지 않습니다).

| | 할 수 있는 것 |
|---|---|
| 마스터 | AI 기능(3줄 요약 고정·고치기) + 관리자 지정·해제 |
| 관리자 | 멤버 관리(가입 수락·환송) + 업무 삭제 |
| 승인된 사람 | 그 밖의 모든 것(프로젝트 만들기·삭제 포함 — 0021에서 열었습니다) |

새 가입자는 **승인을 기다립니다**(0022) — 관리자가 전역 '멤버' 화면에서 수락하기 전에는
프로젝트도 업무도 보이지 않습니다. 관리자 지정은 가입한 사람 목록에서 고르고,
그 버튼은 마스터에게만 보입니다(DB도 `is_master()`로 막습니다 — 0029).
게스트 모드에서는 제한이 없습니다.

```sql
insert into admins (email) values ('admin@example.com');
```

## 클라우드 백엔드

프로젝트·카드·댓글·팀·리소스 링크·알림은 Supabase Postgres에, **첨부 파일은 개인 구글
드라이브**에 두고 DB에는 참조(`files`)만 남깁니다(2026-08-26에 이관을 마쳤습니다 —
[`docs/DRIVE.md`](docs/DRIVE.md)). 본문 이미지와 프로필 사진은 Supabase Storage에 남습니다
(올릴 때 이미 줄여 저장하고, 본문 이미지는 주소가 글 안에 박혀 있어 옮기면 지난 글이 깨집니다).
모든 테이블은 RLS로 보호되고, 조회·작성은 로그인 사용자, 삭제는 작성 본인 또는 관리자입니다.
다른 사람이 바꾼 내용은 Realtime 구독으로 반영됩니다.

### 마이그레이션

`supabase/migrations/`를 순서대로 적용하세요(대시보드 SQL Editor 붙여넣기 또는 `supabase db push`).

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | 초기 스키마 — 테이블 · RLS · 트리거 · Realtime |
| `0002_profile_selfheal.sql` | 누락 프로필 백필 |
| `0003_attachments.sql` | 첨부 `files` 스키마 + Storage 버킷/정책 + teams 시드 |
| `0004_content_images.sql` | 본문 이미지용 공개 버킷 `content-images` |
| `0005_notifications.sql` | 멘션 알림 `notifications` + RLS + Realtime |
| `0006_hold_status_and_drive.sql` | 상태 `hold` 허용 + `projects.drive_folder_id` |
| `0007_reply_notifications.sql` | `notifications.kind`에 `reply` 추가 |
| `0008_profile_teams.sql` | 한 사람이 여러 팀에 속하는 조인 테이블 + RLS |
| `0009_cleanup.sql` | 안 쓰는 컬럼 정리 · activity 고아 행 + cascade · teams 쓰기는 관리자만 |
| `0010_card_updated_by.sql` | `cards.updated_by` — 마지막으로 고친 사람(트리거가 채운다) |
| `0011_linter_warnings.sql` | 어드바이저 경고 — search_path 고정 · 공개 버킷 목록 조회 차단 · SECURITY DEFINER 실행 권한 |
| `0012_retention.sql` | 보존 기간(pg_cron) — 읽은 알림 30일 / 활동 기록 6개월 |
| `0013_card_assignees.sql` | 담당자를 표시명이 아니라 프로필로 (`card_assignees` 조인 + 백필) |
| `0014_project_archive.sql` | `projects.archived` 복구 — 프로젝트 보관 |
| `0015_subtasks_and_summary.sql` | `cards.subtasks`(체크리스트) + `cards.ai_summary`(고정한 요약) |
| `0016_card_counts.sql` | `cards.comment_count`·`file_count` + 재계산 트리거 |
| `0017_push_notifications.sql` | `notifications.kind`에 `assign`·`due_soon` + `push_subscriptions` |
| `0018_profiles_realtime.sql` | 새 가입자가 열려 있는 화면에 바로 뜨게 — profiles 실시간 |
| `0019_profile_visits.sql` | `profiles.last_seen_at`·`birthday` — 대시보드 '사람' 칸과 달력 생일 |
| `0020_deps_and_activity.sql` | `cards.depends_on`(업무 선후관계) + 최근 활동 피드 |
| `0021_open_project_delete.sql` | 프로젝트 삭제를 승인된 사람 전체에게 · 탭 순서(`projects.position`) |
| `0022_member_approval.sql` | 가입 승인(`profiles.approved`) + `admins` 표로 권한 판정(`VITE_ADMIN_EMAILS` 제거) |
| `0023_file_password.sql` | `files.view_pw` — 첨부 화면 가림(파일 자체를 잠그는 것이 아님) |
| `0024_card_position.sql` | 컬럼 안 카드 순서 |
| `0025_project_year.sql` | `projects.year` — 연도별로 프로젝트 탭을 가른다 |
| `0026_card_drive_folder.sql` | `cards.drive_folder_id` — 제목을 바꿔도 드라이브 파일이 갈라지지 않게 |
| `0027_profile_removed.sql` | `profiles.removed_at` — '환송한 사람'과 '아직 승인 안 한 사람'을 가른다 |
| `0028_admin_pick_and_pin.sql` | `profiles.email` + `admins.is_master` — 관리자를 목록에서 고르고, AI는 마스터만 |
| `0029_admin_grant_master_only.sql` | 관리자 지정·해제를 마스터만(`admins` 정책이 `is_master()`) |
| `0030_ai_context.sql` | `profiles.role_note`(AI가 부를 직함 — 개명해도 안 끊기고 코드에 개인 정보를 안 남긴다) · `files.text_excerpt`(첨부에서 뽑은 글 — 요약과 검색이 같이 읽는다) |

## 딥링크 · 공유 · 환경변수

- `/?p=<projectId>` — 해당 프로젝트 보드. `&t=<taskId>`를 붙이면 업무 창까지 엽니다.
  앱 안에서 이동하면 주소창이 따라 바뀝니다(게스트 모드도 동일).
- `/s/p/<projectId>` · `/s/t/<taskId>` — 공유 링크. 크롤러에는 OG 메타 HTML을, 사람에게는 앱으로
  리디렉션을 줍니다(`api/share.js`, `s-maxage=300`).
  점검은 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing).
- `/api/push` — 웹 푸시. POST는 앱이 알림을 만든 직후 부르고, GET은 Vercel Cron이 하루 한 번
  깨워 마감 임박 알림을 만듭니다(`vercel.json`의 `crons`, 22:00 UTC = 07:00 KST).

| 변수 | 용도 | 노출 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 클라이언트 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | 클라이언트 |
| `VITE_VAPID_PUBLIC_KEY` | 웹 푸시 구독용 공개키 | 클라이언트 |
| `GEMINI_API_KEY` | Gemini 호출 키 | **서버 전용** |
| `SUPABASE_SECRET_KEY` | RLS 우회 조회 · 세션 검증 | **서버 전용** |
| `VAPID_PUBLIC_KEY` | 발송 시 짝을 맞추는 공개키 | 서버 |
| `VAPID_PRIVATE_KEY` | 웹 푸시 서명 | **서버 전용** |
| `VAPID_SUBJECT` | 푸시 서비스 연락처 (`mailto:…`) | 서버 |
| `DRIVE_WEBAPP_URL` | 개인 드라이브 첨부용 Apps Script 웹앱 주소 | 서버 전용 |
| `DRIVE_WEBAPP_TOKEN` | 그 웹앱과 우리 서버만 아는 값 | 서버 전용 |
| `CRON_SECRET` | Vercel Cron이 `/api/push`를 깨울 때의 인증 | **서버 전용** |

VAPID 키는 `npx web-push generate-vapid-keys`로 한 번 만들어 Vercel 환경변수에 넣습니다
(공개키는 `VAPID_PUBLIC_KEY`와 `VITE_VAPID_PUBLIC_KEY` 두 이름에 같은 값으로).
이 값들이 없으면 `/api/push`의 POST가 501을 돌려주고 앱은 '알림 받기' 줄을 감춥니다 —
푸시만 빠지고 앱 안 알림은 그대로 동작합니다(마감 임박 배치도 알림은 만들고 발송만
건너뜁니다. 그쪽은 `CRON_SECRET`만 있으면 됩니다).

`.env`·`.env.guest`는 커밋하지 않습니다. 서버 전용 값에 `VITE_` 접두사를 붙이면 빌드에 노출되니 주의하세요.

## 기여

PR 환영합니다. 커밋 메시지는 한국어로, 제목 한 줄 + 본문에 **왜**를 씁니다.
화면을 건드렸다면 `npm run verify`를 돌려 `FAIL`·`CRASH`가 없는지 확인해 주세요.
