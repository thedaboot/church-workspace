-- ============================================================================
-- 0080 — 이번 주 이 장을 본 사람 (bible_reads · 사용자 결정 2026-09-25)
-- ----------------------------------------------------------------------------
-- 성경 읽기의 장 머리(`[data-chap-head]`)에 **이번 주 같은 장을 펼친 사람** 얼굴 셋 + `+N`을
-- 세운다(목업 '같은 본문' — 사용자 승인). HANDOFF §7의 '카드별 조회 추적'(감시처럼 읽힌다)과
-- 닿는 자리라 **사용자가 공동체성을 보고 예외로 정했다** — §7 그 행 옆에 적어 두었다.
--
-- **남기는 것은 셋뿐이다: 누가 · 어느 장 · 어느 주.** 절·시각·횟수 칸이 없다 — 그래서 '누가 먼저·
-- 얼마나 많이'를 셀 수가 없다(§8 '견주는 구조 금지'). 화면도 이름순으로만 세운다.
--   · 주는 **주일~토요일**(§8 셈 기준)이고 week_start는 그 주의 주일(KST)이다.
--   · 장을 **5초 넘게** 펼쳤을 때만 적는다(목차에서 훑고 지나간 것이 '본 것'으로 서지 않게 · 클라이언트).
--   · 같은 주에 같은 장을 몇 번 열어도 한 줄이다(primary key 셋 · upsert ignoreDuplicates).
--   · **지난주 줄은 지운다** — 새 크론을 만들지 않고 11:30 배치(`api/push.js ?job=worship`) 끝에
--     delete 한 줄을 얹었다(크론 자리가 둘뿐이다 · HANDOFF §5 · Vercel Hobby).
--
-- **켬/끔(나도 나누기)은 `bible_state.share_reads` 한 칸이다**(HANDOFF §3-1). 그 표는 본인만 읽는
-- 개인 표(0061)이고 성경 화면이 이미 한 행으로 읽고 쓴다 — 조인 표를 만들 까닭이 없다. 남은 이 값을
-- 읽을 필요가 없다: 끄면 **내 줄을 지우고 다시 적지 않으므로**, 읽는 쪽에는 애초에 줄이 없다.
-- 기본은 켬(사용자 결정 — 판 아래 토글과 내 정보에서 끈다).
--
-- 정책
--   · 읽기: 승인된 사람 전원(`is_approved()` — 0022 · 이 레포의 '전원' 관용구)
--   · 쓰기·지우기: 본인만(`effective_uid()` — 합친 계정은 남긴 계정 · 0061). update는 두지 않는다
--     (칸이 전부 열쇠라 고칠 것이 없다 — upsert는 충돌이면 아무것도 안 한다).
--   · 서버(11:30 배치)는 서비스 키라 정책 밖에서 지난주 줄을 지운다.
-- **실시간 발행(0049·0056)에는 넣지 않는다** — 장을 열 때 한 번 읽으면 된다(사용자 결정). 넣으면
-- liveV2의 TABLE_CACHE와 tests/logcheck의 V2_TABLES까지 세 자리를 같이 고쳐야 한다(§6-9-ao).
--
-- **코드보다 먼저 나가야 한다**(HANDOFF §3-4). 앱은 이 표·칸을 못 읽으면 조용히 빈 자리로 떨어지지만
-- (얼굴이 안 서고 토글은 켬으로 보인다) 그러면 기능이 없는 것과 같다.
--
-- 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- ============================================================================

begin;

create table if not exists public.bible_reads (
  profile_id  uuid not null default public.effective_uid() references public.profiles(id) on delete cascade,
  chapter_key text not null check (char_length(chapter_key) between 3 and 12),   -- 'gen 3'(services/word.js chapterKey)
  week_start  date not null check (extract(dow from week_start) = 0),            -- 그 주의 주일(KST)
  primary key (profile_id, chapter_key, week_start)
);

-- 장을 열 때 읽는 모양: 이 장 · 이번 주
create index if not exists idx_bible_reads_chapter_week on public.bible_reads(chapter_key, week_start);

alter table public.bible_reads enable row level security;

create policy bible_reads_select on public.bible_reads
  for select using (public.is_approved());

create policy bible_reads_insert on public.bible_reads
  for insert with check (profile_id = public.effective_uid() and public.is_approved());

create policy bible_reads_delete on public.bible_reads
  for delete using (profile_id = public.effective_uid());

comment on table public.bible_reads is
  '이번 주 이 장을 본 사람 — 누가·어느 장·어느 주(주일 시작)만. 절·시각·횟수 없음. 지난주 줄은 11:30 배치가 지운다(0080)';

-- 켬/끔 — 본인만 읽는 개인 표의 한 칸(0061 정책 그대로)
alter table public.bible_state
  add column if not exists share_reads boolean not null default true;

comment on column public.bible_state.share_reads is
  '나도 나누기 — 끄면 bible_reads에 내 줄을 남기지 않고 지운다(0080). 기본 켬';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default from information_schema.columns
--    where table_schema='public' and table_name in ('bible_reads','bible_state') order by table_name, ordinal_position;
--   select policyname, cmd from pg_policies where schemaname='public' and tablename='bible_reads';
--   -- bible_reads_select SELECT · bible_reads_insert INSERT · bible_reads_delete DELETE
--   select count(*) from public.bible_state where share_reads is null;   -- 0
--
--   -- RLS 흉내(롤백): 승인된 계정으로 남의 줄은 못 넣는다
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<내 uid>","role":"authenticated"}', true);
--   insert into public.bible_reads(profile_id, chapter_key, week_start) values ('<남의 uid>', 'gen 1', '2026-09-20');  -- 거절
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop table if exists public.bible_reads;               -- 정책·인덱스도 같이 사라진다
--   alter table public.bible_state drop column if exists share_reads;
--   (클라이언트도 같이 — services/word.js의 읽은 장·나도 나누기, components/wordBible.jsx의 장 머리 얼굴,
--    modals/settings.jsx의 토글, api/push.js 11:30 배치 끝의 delete 한 줄)
