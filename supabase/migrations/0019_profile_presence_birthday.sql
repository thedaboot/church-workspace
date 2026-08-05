-- 0019 대시보드에 사람을 세운다 — 다녀간 시각 + 생일
--
-- 대시보드가 정적이고 상호작용할 것이 없다는 이야기에서 나왔다. 참여의 시작은 "여기 사람이
-- 있다"이고, 그걸 말하려면 두 칸이 필요했다.
--
--   last_seen_at  앱을 열 때 한 번 찍는다 → "오늘 다녀간 사람"
--   birthday      'MM-DD' 문자열 → "이번 주에 OOO님 생일이 있어요"
--
-- 왜 activity로 "오늘 움직인 사람"을 세지 않았나: activity에는 **행동**만 남는다(제목 바꿈·
-- 상태 옮김·댓글). 들어와서 보기만 한 사람은 아무 데도 안 남아서, 얼굴 줄이 실제보다 훨씬
-- 적게 나온다. 그렇다고 카드별 조회를 추적하면 "누가 무엇을 봤는지"가 남는다 — 같이 사역하는
-- 사람들이 쓰는 화면에서 그건 감시처럼 읽힌다(사용자 판단). 접속 시각 한 칸이 정직한 중간이다.
--
-- 왜 생일에 연도가 없나: 나이는 화면에 쓸 데가 없고, 컬럼에 없으면 새어 나갈 일도 없다.
-- 음력은 다루지 않는다(자동 환산은 라이브러리가 필요하다) — 양력으로 환산해서 넣는다.
--
-- 왜 가입한 사람만인가: profiles.id는 auth.users를 참조하므로 미가입자는 넣을 행이 없다.
-- 미가입 청년까지 담으려면 이름만 들고 있는 별도 명단이 필요한데, 이름으로 사람을 매다는
-- 방식은 §6-26에서 이미 깨졌다(이름을 바꾸면 남의 것이 된다). 그건 §7의 순 명단과 한 덩이로
-- 판단할 일이다. 생일은 바뀌지 않으니 새로 가입할 때 한 줄씩 넣으면 된다.
--
-- **생일 값은 이 파일에 없다.** 이 레포는 공개이고 실명 생일을 커밋할 이유가 없다 —
-- 값은 psql로 직접 넣었다(비밀 값과 같은 취급, §5). 새 멤버가 오면 아래 형태로 한 줄 넣는다:
--   update public.profiles set birthday = '03-14' where display_name = '강희라';

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- 'MM-DD'만 허용한다. 형식이 흐트러지면 "이번 주 생일" 비교(문자열 대소)가 조용히 틀린다.
alter table public.profiles add column if not exists birthday text;
do $$
begin
  alter table public.profiles
    add constraint profiles_birthday_mmdd
    check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
exception when duplicate_object then null;
end $$;

-- 확인:
--   \d public.profiles
--   select display_name, birthday, last_seen_at from public.profiles order by birthday;
--
-- 되돌리기:
--   alter table public.profiles drop constraint profiles_birthday_mmdd;
--   alter table public.profiles drop column birthday;
--   alter table public.profiles drop column last_seen_at;
