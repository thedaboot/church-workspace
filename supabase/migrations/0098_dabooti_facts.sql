-- ============================================================================
-- 0098 — 다붓이 학습 고리: 배운 것 저장소 · 열린 질문 닫기 · '다붓이가 배운 것' 장은 마스터만 (20차 ⑧ · 사용자 결정 2026-10-13)
-- ----------------------------------------------------------------------------
-- 왜: 지금 고리는 '다시 찾아보기'뿐이었다 — 알려 준 말은 세기만 하고 저장되지 않았고, '자주 묻는 질문' 장의 답 스냅샷은 낡았고
-- (마스터가 적은 답 '10월 월례회는 10월 11일이에요'), 모르는 질문 목록에는 인사·알려 준 말이 섞였고 해소 상태가 없었다.
--
-- 표 하나 · 칸 하나 · 정책 넷
--   · dabooti_facts      사람이 알려 준 사실 한 줄(api/_wiki/learn.js)
--       question         이어진 물음 글(없을 수 있다) · text 사실 한 줄 · told_by 알려 준 사람(profiles · 마스터만 읽는다)
--       status           pending(확인을 기다리는 말) | approved(다붓이 근거가 된다) | rejected(버림)
--                        마스터가 알려 주면 바로 approved · 다른 사람은 pending · 거르는 말(비밀 값·기도제목·한 사람의 사정 …)이 들면
--                        마스터 말이어도 pending(코드 — wikiCore.prefilter)
--       from_question_id 이어진 물음(dabooti_questions) · decided_at 반영·버림·고친 때(답 캐시 도장 · _wikiAsk dataStamp)
--       leader           리더 프로젝트와 관련 있는 사실(이어진 물음의 답이 리더 기록에 기댔다) — 리더에게만 근거로 싣는다
--       count            같은 말을 알려 준 횟수(같은 말이면 줄을 늘리지 않는다)
--   · dabooti_questions.resolved_at  열린 질문(몰랐거나 👎)이 닫힌 때 — 아침 고리가 답을 찾았거나 승인된 사실로 그 자리에서 다시 답했다.
--                        질문 표는 그대로 익명이다(누가 물었는지 칸 없음 · 0088).
--   정책: dabooti_facts 읽기·넣기·고치기·지우기 is_master() — 서버(서버 키)가 대신 쓰고 승인된 것만 근거로 읽는다.
--         wiki_pages · wiki_edits 읽기: 'learned' 장도 마스터만(0090의 faq와 같은 꼴).
--   doc_vec: 'learned' 장은 뜻 찾기 조각으로 만들지 않는다(0096의 faq 막기와 같은 꼴).
--
-- 옮겨 오는 것: 아침 고리가 '알려 준 말'(cause told)로 가른 글은 확인을 기다리는 말로(마스터가 ✓/✗) ·
--   예전 고리가 답을 찾은(missed) 물음 · 알려 준 말로 가른(told · known) 물음은 닫힌 것으로(👎 물음은 새 고리가 본 fromBad만 — 2026-10-12 결정).
--   자주 묻는 질문 장에 마스터가 적은 답(wiki_edits page_id 'faq' · 1줄)은 옮기지 않는다 — 그날 찍은 답이라 낡았다('10월 11일').
--
-- **코드보다 먼저 나가야 한다**(HANDOFF §3-4): 서버가 resolved_at · dabooti_facts를 읽는다(아침 빌드 · 아침 고리 · /api/ai { tell, learn }).
-- 앱의 첫 읽기(loadCloudState)는 이 표를 보지 않는다.
-- ============================================================================

begin;

create table if not exists public.dabooti_facts (
  id               uuid primary key default gen_random_uuid(),
  question         text check (length(question) <= 500),
  text             text not null check (length(text) between 1 and 500),
  told_by          uuid references public.profiles(id) on delete set null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  from_question_id uuid references public.dabooti_questions(id) on delete set null,
  leader           boolean not null default false,
  count            int not null default 1 check (count >= 1),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

create index if not exists idx_dabooti_facts_status on public.dabooti_facts(status, created_at);

alter table public.dabooti_facts enable row level security;
create policy dabooti_facts_select on public.dabooti_facts for select using (public.is_master());
create policy dabooti_facts_insert on public.dabooti_facts for insert with check (public.is_master());
create policy dabooti_facts_update on public.dabooti_facts for update using (public.is_master()) with check (public.is_master());
create policy dabooti_facts_delete on public.dabooti_facts for delete using (public.is_master());

alter table public.dabooti_questions add column if not exists resolved_at timestamptz;

alter policy wiki_pages_select on public.wiki_pages
  using (public.is_approved() and (id not in ('faq', 'learned') or public.is_master()));

alter policy wiki_edits_select on public.wiki_edits
  using (public.is_approved() and (page_id not in ('faq', 'learned') or public.is_master()));

alter table public.doc_vec add constraint doc_vec_no_learned check (page_id is distinct from 'learned');

-- 옮겨 오기 ① 아침 고리가 '알려 준 말'로 가른 글 → 확인을 기다리는 말(같은 글은 한 줄 · 처음 물은 때)
insert into public.dabooti_facts (text, status, created_at, count)
select left(question, 500), 'pending', min(created_at), count(*)
  from public.dabooti_questions
 where via = 'nightly' and answer->>'cause' = 'told'
 group by left(question, 500);

-- 옮겨 오기 ② 이미 닫힌 물음 — 그 뒤 아침 고리가 답을 찾았거나(missed) 알려 준 말로 갈랐다(told · known)
update public.dabooti_questions q
   set resolved_at = n.created_at
  from public.dabooti_questions n
 where q.via = 'ask' and q.resolved_at is null
   and n.via = 'nightly' and n.norm = q.norm and n.created_at >= q.created_at
   and (n.answer->>'cause' in ('told', 'known')
        or (n.status = 'answered' and n.answer->>'cause' = 'missed'
            and (q.feedback is distinct from 'bad' or (n.answer->>'fromBad')::boolean is true)));

comment on table public.dabooti_facts is '다붓이가 배운 것 — 사람이 알려 준 사실(마스터 확인) · 승인된 것만 다붓이 근거 · 마스터만 · 0098';
comment on column public.dabooti_questions.resolved_at is '열린 질문(몰랐거나 👎)이 닫힌 때 — 아침 고리 · 승인된 사실로 다시 답함 · 0098';

commit;

-- ── 확인 ────────────────────────────────────────────────────────────────────
--   select policyname, cmd, qual, with_check from pg_policies where tablename in ('dabooti_facts', 'wiki_pages', 'wiki_edits') order by 1;
--   select status, count(*) from public.dabooti_facts group by 1;                       -- pending 1(신효진 부장님 정정 글)
--   select count(*) filter (where resolved_at is not null), count(*) from public.dabooti_questions where via = 'ask';
--   -- RLS 흉내(롤백): 마스터가 아니면 0줄 · 넣기 거절
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<마스터 아닌 uid>","role":"authenticated","email":"x@y"}', true);
--   select count(*) from public.dabooti_facts;                                          -- 0
--   insert into public.dabooti_facts(text) values ('x');                               -- 거절
--   select count(*) from public.wiki_pages where id = 'learned';                         -- 0
--   rollback;
--
-- ── 되돌리기 ────────────────────────────────────────────────────────────────
--   alter table public.doc_vec drop constraint if exists doc_vec_no_learned;
--   alter policy wiki_edits_select on public.wiki_edits using (public.is_approved() and (page_id <> 'faq' or public.is_master()));
--   alter policy wiki_pages_select on public.wiki_pages using (public.is_approved() and (id <> 'faq' or public.is_master()));
--   delete from public.wiki_pages where id = 'learned';
--   alter table public.dabooti_questions drop column if exists resolved_at;
--   drop table if exists public.dabooti_facts;
--   (코드도 같이 — api/_wiki/learn.js · api/_wikiAsk.js 학습 고리 · api/ai.js { tell, learn } · api/push.js 확인을 기다리는 말 수 ·
--    views/wikiView.jsx 마스터 장 둘 · components/dabooti.jsx 👎 뒤 대화)
