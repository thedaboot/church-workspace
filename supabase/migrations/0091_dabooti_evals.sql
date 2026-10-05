-- ============================================================================
-- 0091 — 다붓이 회귀 질문 묶음 (18차 2회 · 사용자 결정 2026-10-05 'DB로 두는 게 맞지')
-- ----------------------------------------------------------------------------
-- 사람이 확인한 질문과 정답을 모은 시험지. 다붓이 구조를 바꿀 때마다 이 묶음을 다시 물어서
-- 예전에 맞히던 답이 틀려지지 않았는지 본다(scripts/dabooti-eval.mjs). 정답에 실명이 있어 레포에 두지 않는다.
-- 아침 크론의 자가개선 고리도 이 표를 읽고 쓴다(18차 2회 5번 · api/push.js runWiki).
--
-- 칸
--   · question  묻는 말 그대로
--   · prev      앞 대화(이어 묻기 — answerQuestion의 prev와 같은 꼴: 앞 질문 줄들 + 맨 끝 '[답] 앞 답 첫 문장')
--   · expect    'answered' | 'unknown' | 'refused' — 기대하는 결과
--   · must      답에 꼭 있어야 할 말들(전부). 한 칸 안의 'A|B'는 둘 중 하나면 된다
--   · never     답에 있으면 틀린 말들(지어낸 이름·옛 답)
--   · note      왜 이 문항이 있나(사용자 결정 · 날짜)
--   · active    끄면 묶음에서 빠진다(데이터가 바뀌어 정답이 달라졌을 때)
--   · last      마지막으로 돌린 결과 { at, ok, status, text, why }
--
-- 정책 없음(서버 키만) — dabooti_questions와 같다. 앱은 이 표를 읽지 않는다.
-- ============================================================================

begin;

create table if not exists public.dabooti_evals (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) between 1 and 300),
  prev       text not null default '',
  expect     text not null default 'answered' check (expect in ('answered', 'unknown', 'refused')),
  must       jsonb not null default '[]'::jsonb,
  never      jsonb not null default '[]'::jsonb,
  note       text not null default '',
  active     boolean not null default true,
  last       jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_dabooti_evals_updated_at
  before update on public.dabooti_evals
  for each row execute function public.set_updated_at();

alter table public.dabooti_evals enable row level security;

comment on table public.dabooti_evals is '다붓이 회귀 질문 묶음(사람이 확인한 질문·정답) — 서버만 · 0091';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'dabooti_evals';   -- t
--   select count(*) from pg_policies where tablename = 'dabooti_evals';     -- 0
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   drop table public.dabooti_evals;
