-- 0020 대시보드 참여 기능 2차 — 활동 피드 실시간 + 업무 선후관계
--
-- (A) activity를 Realtime 발행에 추가.
--     대시보드에 '최근 활동' 피드를 얹는다. activity는 이미 쌓이고 있었지만 업무 창 안에만
--     갇혀 있었다 — 꺼내기만 하면 되는 데이터다. SELECT 정책은 0001부터 authenticated
--     전체(activity_select)라 Realtime이 로그인 사용자에게 전달한다.
--     **구독 라우팅 주의(§6-21)**: 앱은 이 표의 이벤트를 전체 재조회가 아니라
--     "피드만 다시 읽기"(cloudSync.loadActivityFeed, 쿼리 1개)로 받는다. 저장 한 번에
--     기록이 여러 건 생기므로 앱 쪽에서 500ms 디바운스한다.
--
-- (B) cards.depends_on — 업무 선후관계 (프로젝트 '그래프' 보기가 읽는다).
--     조인 테이블이 아니라 **컬럼**이다(§2-1). 카드와 언제나 같이 읽고 쓰고, 항목이 몇 개
--     안 되고, 따로 조회·집계할 이유가 없다. 컬럼 통째 쓰기는 저장이 겹쳐도 마지막 것이
--     남을 뿐 깨지지 않는다 — 0015가 하위 업무를 컬럼으로 둔 것과 같은 판단(§6-27).
--     FK 제약을 걸지 않는 이유: uuid[] 원소에는 FK를 걸 수 없다(Postgres 제약).
--     가리키던 카드가 지워지면 앱이 읽을 때 걸러낸다(utils.depLayers가 없는 id를 무시).

do $$
begin
  alter publication supabase_realtime add table public.activity;
exception when duplicate_object then null;
end $$;

alter table public.cards add column if not exists depends_on uuid[] not null default '{}';

-- 확인:
--   select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1;
--   select column_name, data_type from information_schema.columns
--     where table_name='cards' and column_name='depends_on';
--
-- 되돌리기:
--   alter publication supabase_realtime drop table public.activity;
--   alter table public.cards drop column depends_on;
