# 더다붓 워크스페이스 (church-workspace)

교회 청년부·임원진·사역 팀을 위한 협업 툴입니다. 청년 ~50명의 교회 생활(홈·예배·말씀·모임)과
스태프의 업무(칸반·캘린더·대시보드)를 한 앱에 담고, Supabase를 DB로 두고 Vercel에 배포합니다.
로그인 설정 없이도 로컬(게스트) 모드로 돕니다.

- 레포: `github.com/thedaboot/church-workspace` · 배포: Vercel (`main` 푸시 시 자동)
- 코드 위치·함정·관례는 [`HANDOFF.md`](HANDOFF.md)입니다. 새로 합류했다면 그 문서부터 읽으세요.

## 시작하기

```bash
git clone https://github.com/thedaboot/church-workspace.git
cd church-workspace
npm install
npm run dev          # 개발 서버
npm run build        # dist/ 로 빌드 (npm run preview 로 확인)
npm run verify -- <이름>   # 검증 스위트 — 고친 것과 관련된 것만 (tests/README.md)
```

`.env` 없이 실행하면 로그인 없는 게스트 모드로, 데이터는 브라우저 localStorage에 저장됩니다.
`api/` 서버 함수(AI·공유 미리보기·드라이브·유튜브·푸시)는 **`npm run dev`가 그대로 돌립니다** —
`vite.config.js`의 dev 전용 미들웨어가 `/api/<이름>` 요청을 `api/<이름>.js`에 넘기고 `.env`의
서버 키를 실어 줍니다. 게스트 모드에는 붙지 않습니다.

## 기능

**교회 생활** — 모바일 첫 화면은 **홈**이고, 하단 바의 '업무'를 누르면 바가 업무 바로
바뀝니다(모드 전환). 설계·결정·권한은 [`docs/V2.md`](docs/V2.md).

- **홈** — 오늘의 QT · 이번 주 예배 · 내 업무 · 내 순 카드 넷 + 쇼케이스.
- **예배** — 주보(말씀·담당자·찬양·광고)를 작성해 발행하고 발행본은 **종이 두 쪽**으로 열립니다
  ([PDF로 공유]가 한 파일로). 본문 구절은 개역한글 본문이 자동으로 붙고, 찬양은 유튜브 재생목록
  주소로 가져오고, **송폼·큐시트**를 붙이고, 출석을 체크하고, 예배 노트를 내 순에 공유합니다.
- **말씀** — QT(읽기표 본문 → 묵상 → 더다붓에 공유하기 · 나만 보는 잔디 · 종이) ·
  성경 읽기(본문 · 검색 = 그대로 나오는 절 + AI가 찾은 구절 · 북마크 · 절 형광펜).
- **모임** — 내 순(구성원·출석·공유된 노트·**순모임 가이드**) · 동아리(가입 신청·모임·
  리더 도구·신청 QR) · 순 편성.
- **명단** — 계정 없이도 청년 전체를 등록하고 가입한 사람을 명단에 연결합니다
  (멤버 화면의 `[가입자 | 청년 명단]` 탭). 한 사람의 여러 계정은 합칠 수 있습니다.

**업무**

- **칸반 보드** — 시작 전 / 진행 중 / 보류 중 / 완료. 드래그로 상태와 순서를 옮기고 팀 필터는
  여러 개를 함께 고릅니다(OR). **캘린더**는 한 업무 한 줄, 시작~마감이 팀 색 띠로 이어집니다.
- **업무 창** — WYSIWYG 상세 내용(TipTap, **저장 형식은 마크다운 문자열**) · 하위 업무
  체크리스트 · 댓글·@멘션·반응(하트·따봉·체크) · 활동 기록 · 선후관계.
- **첨부 파일** — 한 파일 25MB · 동시 3개. 실체는 **개인 구글 드라이브**에 `프로젝트 / 업무`
  폴더로 들어가고 DB에는 참조만 남습니다([`docs/DRIVE.md`](docs/DRIVE.md)). 앱 안 미리보기는
  PDF·이미지·영상·소리·텍스트이고 **워드·PPT·엑셀은 구글 화면 그대로**입니다. 같은 구역의
  `+ 링크`로 구글 시트 같은 링크도 한 목록에 달고 그것은 앱 안에서 바로 편집됩니다.
  화면을 가리는 비밀번호를 걸 수 있고, 첨부에서 뽑은 글은 검색과 AI가 같이 읽습니다.
- **대시보드** — 마감 구간별 할 일 · 프로젝트 진척도 · 팀별·청년별 남은 업무 · 함께하는 사람 ·
  최근 활동 · **프로젝트 연결 지도**(끌어다 놓으면 그 자리에 남습니다). 필터는 주소에 남습니다.
- **지금 누가 어디를** — 프로젝트 탭과 보드 카드에 그것을 보고 있는 사람 얼굴이 최대 3명
  겹쳐 뜹니다. 실시간 표시일 뿐 **어디에도 기록되지 않습니다.**
- **통합 검색** — 띄어쓰기를 무시하고("버스견적"으로 "전세버스 견적서") 제목·본문·담당자·팀·
  댓글·첨부 이름과 파일 안의 글까지 봅니다.
- **알림 · 웹 푸시** — 멘션, 답글·반응, 담당자 지정, 마감 임박, 예배·모임·가입 요청이 헤더 종에
  쌓입니다. '이 기기로 알림 받기'를 켜면 앱을 닫아 둔 동안에도 옵니다(**아이폰은 홈 화면에
  추가한 뒤에만** — iOS 16.4+).
- **Gemini AI** — 업무 3줄 요약(마스터가 고정), 본문 구조화 다듬기, 순모임 가이드,
  성경 본문 검색. **무엇을 보고 무엇을 쓰는지는 [`docs/AI.md`](docs/AI.md)가 기준입니다.**
- **그 밖** — 프로젝트 보관('더보기 > 보관함'에서 찾습니다) · 끌어서 바꾸는 프로젝트 탭 순서 ·
  전체 일정 · 실행 취소/다시 실행(게스트 전용) · 상태 이동 '되돌리기' 토스트 ·
  PWA(홈 화면에 추가) · 라이트/다크(시스템을 따르고 헤더에서 바꾼 선택을 기억).

## 기술 스택

- Vite 8 · React 19 · Tailwind CSS 4 + [SEED Design](https://seed-design.io/)(파운데이션 토큰)
- [TipTap](https://tiptap.dev/) 3 (WYSIWYG, 저장은 마크다운 서브셋) · dnd-kit · pdf.js · lucide-react
- 폰트: SUIT Variable (Pretendard는 폴백)
- 백엔드: Supabase(Postgres · Auth · Storage · Realtime) · Vercel 서버 함수

## 구조

```
src/  App.jsx(조립·라우팅 상태) · config.js(팀·상태 상수) · index.css(디자인 토큰·모션)
      store/(useSyncExternalStore 스토어 + 셀렉터) · services/(도메인·Supabase·마크다운·AI)
      hooks/(컨트롤러) · components/(내비·칸반·캘린더·그래프·에디터·미리보기·종이·링크)
      views/(화면) · modals/(업무 상세·수정, 프로필, 프로젝트)
api/  서버 함수 — ai · drive · drive-file · share · push · yt
public/bible/  개역한글 66권 json(책 단위 청크)
```

**화면 ↔ 파일 지도는 [`HANDOFF.md`](HANDOFF.md) §3입니다.** 상태는 `{ byId, allIds }`로
정규화해 Map 룩업으로 읽고, 화면(views) → 컨트롤러(hooks) → 서비스(services) → Supabase
순으로 책임을 나눴습니다. 에디터 문서 모델과 저장 형식(마크다운) 사이의 변환은
`services/markdown.js`에만 있어서, 에디터를 바꿔도 뷰어·AI·기존 데이터가 영향을 받지 않습니다.
디자인 토큰·모션·그리드 규칙은 HANDOFF §4.2이고 값은 모두 `src/index.css` 한 곳에 있습니다.

## 로그인 (선택)

[supabase.com](https://supabase.com)에서 프로젝트를 만들고 `Settings → API`의 URL·anon key를
`.env`(`.env.example` 복사)에 넣고, `Authentication → Providers`에서 Google / Kakao를 켜면
됩니다. 첫 로그인 직후 표시 이름과 소속 팀을 정하는 창이 열립니다.

권한은 세 층이고 **`admins` 표가 원본입니다**(0022에서 `VITE_ADMIN_EMAILS`를 없앴습니다 —
화면과 DB가 같은 `is_admin()`·`is_master()`를 보므로 재배포가 필요하지 않습니다).

| | 할 수 있는 것 |
|---|---|
| 마스터 | AI 요약 고정·고치기 + 관리자 지정·해제 + 계정 합치기 + 가이드 고정 |
| 관리자 | 멤버 관리(가입 수락·환송) + 업무 삭제 + 명단 관리 |
| 승인된 사람 | 그 밖의 모든 것(프로젝트 만들기·삭제 포함) |

새 가입자는 **승인을 기다립니다** — 관리자가 '멤버' 화면에서 수락하기 전에는 아무것도
보이지 않습니다. 교회 화면의 세부 자격은 `docs/V2.md`의 권한 표입니다. 게스트 모드에서는
제한이 없습니다. 첫 마스터는 `insert into admins (email) values ('…');`로 넣습니다.

## 클라우드 백엔드

프로젝트·카드·댓글·팀·참고 링크·알림과 v2 표(명단·모임·예배·말씀)는 Supabase Postgres에,
**첨부 파일은 개인 구글 드라이브**에 두고 DB에는 참조(`files`)만 남깁니다
([`docs/DRIVE.md`](docs/DRIVE.md)). 본문 이미지와 프로필 사진은 Supabase Storage에 남습니다
(올릴 때 이미 줄여 저장하고, 본문 이미지는 주소가 글 안에 박혀 있어 옮기면 지난 글이 깨집니다).
모든 테이블은 RLS로 보호되고, 다른 사람이 바꾼 내용은 Realtime 구독으로 반영됩니다.

### 마이그레이션

`supabase/migrations/`를 순서대로 적용합니다. **0001~0061은 전부 라이브 DB에 적용되어
있습니다**(적용 방법과 원장 주의사항은 HANDOFF §5).

| 파일 | 내용 | 적용 |
|---|---|---|
| `0001_init` | 초기 스키마 — 테이블 · RLS · 트리거 · Realtime · `is_admin()` | ✅ |
| `0002_profile_selfheal` | 누락 프로필 백필 | ✅ |
| `0003_attachments` | 첨부 `files` + Storage 버킷/정책 + teams 시드 | ✅ |
| `0004_content_images` | 본문 이미지용 공개 버킷 `content-images` | ✅ |
| `0005_notifications` | 멘션 알림 `notifications` + RLS + Realtime | ✅ |
| `0006_hold_status_and_drive` | 상태 `hold` 허용 + `projects.drive_folder_id` | ✅ |
| `0007_reply_notifications` | `notifications.kind`에 `reply` | ✅ |
| `0008_profile_teams` | 한 사람이 여러 팀에 속하는 조인 테이블 + RLS | ✅ |
| `0009_cleanup` | 안 쓰는 컬럼 정리 · activity 고아 행 + cascade · teams 쓰기는 관리자만 | ✅ |
| `0010_card_updated_by` | `cards.updated_by` — 마지막으로 고친 사람(트리거가 채운다) | ✅ |
| `0011_linter_warnings` | 어드바이저 경고 — search_path 고정 · 공개 버킷 목록 조회 차단 | ✅ |
| `0012_retention` | 보존 기간(pg_cron) — 읽은 알림 30일 / 활동 기록 6개월 | ✅ |
| `0013_card_assignees` | 담당자를 표시명이 아니라 프로필로(조인 + 백필) | ✅ |
| `0014_project_archive` | `projects.archived` — 프로젝트 보관 | ✅ |
| `0015_subtasks_and_summary` | `cards.subtasks`(체크리스트) + `cards.ai_summary` | ✅ |
| `0016_card_counts` | `cards.comment_count`·`file_count` + 재계산 트리거 | ✅ |
| `0017_push_notifications` | `kind`에 `assign`·`due_soon` + `push_subscriptions` | ✅ |
| `0018_profiles_realtime` | 새 가입자가 열려 있는 화면에 바로 뜨게 — profiles 실시간 | ✅ |
| `0019_profile_presence_birthday` | `profiles.last_seen_at`·`birthday` | ✅ |
| `0020_deps_and_activity_feed` | `cards.depends_on`(선후관계) + 최근 활동 피드 | ✅ |
| `0021_project_delete_and_order` | 프로젝트 삭제를 승인된 사람 전체에게 · `projects.position` | ✅ |
| `0022_approval_and_admins` | 가입 승인(`profiles.approved`) + `admins` 표로 권한 판정 | ✅ |
| `0023_file_password` | `files.view_pw` — 첨부 화면 가림(파일 자체를 잠그는 것이 아님) | ✅ |
| `0024_card_position` | 컬럼 안 카드 순서 | ✅ |
| `0025_project_year` | `projects.year` — 연도별로 프로젝트 탭을 가른다 | ✅ |
| `0026_card_drive_folder` | `cards.drive_folder_id` — 제목을 바꿔도 드라이브 파일이 안 갈리게 | ✅ |
| `0027_profile_removed` | `profiles.removed_at` — '환송한 사람'과 '승인 대기'를 가른다 | ✅ |
| `0028_admin_pick_and_pin` | `profiles.email` + `admins.is_master` | ✅ |
| `0029_admin_grant_master_only` | 관리자 지정·해제를 마스터만(`is_master()`) | ✅ |
| `0030_ai_context` | `profiles.role_note`(AI가 부를 직함) · `files.text_excerpt`(첨부에서 뽑은 글) | ✅ |
| `0031_sheet_preview` | `files.preview_file_id` — 오피스 파일의 구글 네이티브 사본 id | ✅ |
| `0032_comment_reactions` | 댓글 반응(하트·따봉·체크) | ✅ |
| `0033_card_completed_at` | `cards.completed_at` — 업무를 끝낸 시각 | ✅ |
| `0034_fix_completed_at_backfill` | 0033의 백필이 한 일을 바로잡는다 | ✅ |
| `0035_people_and_groups` | v2 명단(`people` — 계정 없이도 등록) · 연도별 직분 · 순·동아리 한 벌(`groups`) · 가입 신청 · 모임 | ✅ |
| `0036_worship_and_word` | v2 예배(`services`·`attendance`·예배 노트) · 말씀(QT 일정·묵상·`bible_state`) | ✅ |
| `0037_roster_seed` | 명단 시드 53명(순 6 · 동아리 5 · 직분) | ✅ |
| `0038_qt_plan_and_polish` | QT 읽기표 2026·2027 시드 · 동아리 카드 순서 · 절 형광펜 | ✅ |
| `0039_sun_guides_and_perms` | 순 편성·동아리 정보 수정 자격 · 순모임 가이드 `sun_guides` | ✅ |
| `0040_people_sun_exempt` | `people.sun_exempt` — 순 편성 대상이 아닌 사역자(이름을 코드에 안 박으려고) | ✅ |
| `0041_groups_unique_name` | 같은 이름 막기 — 순은 같은 해 안에서만, 동아리는 전체 | ✅ |
| `0042_service_edit_perms` | `can_edit_service()` — 주보 작성·수정 자격 | ✅ |
| `0043_people_roles_split` | 직분을 하나에서 다섯으로(부장·회장·총무·리더순장·리더팀장) · 교역자는 `people.is_pastor` | ✅ |
| `0044_services_praise_leader` | `services.praise_leader` — 찬양 인도자 | ✅ |
| `0045_perms_2026_09_05` | 권한 다섯 손질 — 주보·순 편성에 교역자 · 전체 출석 자격 · 동아리 멤버 · 마스터가 남의 묵상 삭제 | ✅ |
| `0046_services_praise_playlist` | `services.praise_playlist_url` — 재생목록 주소 정규화 저장 | ✅ |
| `0047_service_files` | 주보 송폼 — `files.service_id`(+`card_id`와 배타 CHECK) · `services.drive_folder_id` · `files` RLS를 업무/주보 갈래로 | ✅ |
| `0048_touch_last_seen_now` | `touch_last_seen()` — 다녀간 시각을 기기 시계가 아니라 서버 `now()`로 | ✅ |
| `0049_realtime_v2_tables` | v2 표 9개를 Realtime 발행에 추가 | ✅ |
| `0050_sun_leader_adds_own_member` | 순장이 자기 순(올해)에 사람을 넣을 수 있게 | ✅ |
| `0051_dead_policies_and_approval` | 죽은 storage 정책 정리 · 주보·가이드 정책에 `is_approved()` | ✅ |
| `0052_attendance_note_rpc` | `set_attendance_note` rpc — 순장도 출석 메모를(그 한 칸만) | ✅ |
| `0053_feedback_round_10` | `attendance_guests`(손님 출석) · `notifications.link` + 예배·모임 알림 종류 · `resource_links.view_pw*` · `services.cue_sheet` | ✅ |
| `0054_files_kind` | `files.kind`(songform·cuesheet) — 주보에 붙는 파일의 갈래 한 칸 | ✅ |
| `0055_sun_guide_pin_and_leaders` | 순모임 가이드 재가동 — `pinned*`(고정은 하나·마스터만, rpc) · 쓰기를 순장까지 | ✅ |
| `0056_realtime_guides_guests` | 실시간 발행에 `sun_guides`·`attendance_guests` 추가 | ✅ |
| `0057_bible_search_cache` | 성경 AI 본문 검색 캐시 — 같은 물음은 누가 물어도 한 번만(본문 글자는 안 담는다) | ✅ |
| `0058_card_resource_links` | 참고 링크를 업무에도 — `resource_links.card_id` + 프로젝트 축과 배타 CHECK | ✅ |
| `0059_merge_profiles` | 한 사람의 여러 계정 합치기 — `merge_profiles` rpc(마스터만). 되돌릴 수 없다 | ✅ |
| `0060_merged_into` | `profiles.merged_into` — 합쳐진 계정에 표를 남겨 '다시 초대하기'가 빈 중복을 안 되살리게 | ✅ |
| `0061_effective_uid` | 합친 계정으로 들어와도 그 사람 — 승인·명단·개인 표 정책이 `effective_uid()`를 본다 | ✅ |
| `0063_effective_uid_rest` | 0061이 남긴 나머지 자리 — 알림·삭제 자격·반응·푸시 구독·내 정보 정책과 `same_sun`·`is_pastor`·`touch_last_seen` | ✅ |

## 딥링크 · 공유 · 환경변수

- `/?p=<projectId>` — 그 프로젝트 보드(`&t=<taskId>`로 업무 창까지) · `/?p=worship&s=<serviceId>` —
  주보 상세 · `/?p=groups&g=<groupId>` — 동아리 상세(`&apply=1`이면 로그인 뒤 가입 신청까지).
  알림의 딥링크가 이 모양이고(`notifications.link`), 앱 안에서 이동하면 주소창이 따라 바뀝니다.
- `/s/p/<projectId>` · `/s/t/<taskId>` · `/s/c/<groupId>` — 공유 링크. 크롤러에는 OG 메타
  HTML을, 사람에게는 앱으로 리디렉션을 줍니다(`api/share.js`, `s-maxage=300`).
  점검은 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing).
- `/api/push` — POST는 앱이 알림을 만든 직후, GET은 Vercel Cron이 부릅니다(`vercel.json`의
  `crons` — 22:00 UTC 마감 임박 · `?job=worship`은 02:30 UTC = 11:30 KST 오늘 예배).

| 변수 | 용도 | 노출 |
|---|---|---|
| `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` | Supabase 프로젝트 | 클라이언트 |
| `VITE_VAPID_PUBLIC_KEY` | 웹 푸시 구독용 공개키 | 클라이언트 |
| `GEMINI_API_KEY` | Gemini 호출 키 | **서버 전용** |
| `SUPABASE_SECRET_KEY` | RLS 우회 조회 · 세션 검증 | **서버 전용** |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | 웹 푸시 서명·연락처 | 서버(개인키는 전용) |
| `DRIVE_WEBAPP_URL` · `DRIVE_WEBAPP_TOKEN` | 개인 드라이브 Apps Script 웹앱 주소와 공유 값 | **서버 전용** |
| `CRON_SECRET` | Vercel Cron이 `/api/push`를 깨울 때의 인증 | **서버 전용** |
| `YOUTUBE_API_KEY` | 찬양 재생목록 — 있으면 Data API로 전체, 없으면 RSS로 최신 15곡 | **서버 전용** |

VAPID 키는 `npx web-push generate-vapid-keys`로 한 번 만듭니다(공개키는 `VAPID_PUBLIC_KEY`와
`VITE_VAPID_PUBLIC_KEY` 두 이름에 같은 값으로). 없으면 `/api/push`의 POST가 501을 돌려주고
앱은 '알림 받기' 줄을 감춥니다 — 푸시만 빠지고 앱 안 알림은 그대로 동작합니다.
`.env`·`.env.guest`는 커밋하지 않습니다. **서버 전용 값에 `VITE_` 접두사를 붙이면 빌드에
그대로 노출됩니다.**

## 기여

PR 환영합니다. 커밋 메시지는 한국어로, 제목 한 줄 + 본문에 **왜**를 씁니다.
검증은 **고친 것과 관련된 스위트만** 돌립니다(`npm run verify -- <이름>` · `tests/README.md`).
