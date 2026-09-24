// AI 프롬프트에 주변 상황이 실제로 실리는지 (네트워크 없이 buildTaskContext만 검사)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
// 이 파일이 있는 레포를 본다 — 절대 경로로 박아 두면 worktree에서 돌려도 본 레포의 ai.js를 읽었다(2026-09-24)
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const SRC = `${ROOT}/src/services/ai.js`;
const src = readFileSync(SRC, 'utf8');
// store import만 우리 가짜로 바꿔치기 (supabaseClient도 안 타게)
// utils.js는 순수 모듈이라 그대로 쓴다 — 다만 임시 폴더에서 도니 절대 경로로 바꾼다
const patched = src
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'export const supabase = null;')
  .replace(/from '\.\.\/utils\.js';/, `from '${pathToFileURL(`${ROOT}/src/utils.js`).href}';`)
  // aiPeople.js는 순수 모듈이라 그대로 쓴다(2026-09-25) — 임시 폴더에서 도니 절대 경로로
  .replace(/from '\.\/aiPeople\.js';/, `from '${pathToFileURL(`${ROOT}/src/services/aiPeople.js`).href}';`)
  // 명단 한 벌은 supabase 쪽이라 가짜로 — 검사는 setAiRoster로 직접 쥐여 준다(supabase가 null이면 부르지도 않는다)
  .replace(/import \{ fetchRoster \} from '\.\/worship\.js';/, 'const fetchRoster = async () => null;')
  .replace(/import \{ store \} from '\.\.\/store\/workspaceStore\.js';/, `
const STATE = globalThis.__STATE;
export const store = { getState: () => STATE };`);
const dir = mkdtempSync(join(tmpdir(), 'aictx-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, patched);

const mk = (id, title, teams, status, sd, dd, assignees, projectId = 'p1') => ({ id, projectId, title, teams, status,
  startDate:sd, dueDate:dd, assignees, content:'', comments:[], activityLog:[], attachments:[] });
globalThis.__STATE = {
  projects:{ byId:{
    p1:{ id:'p1', title:'2026 하계 수련회' },
    p2:{ id:'p2', title:'2026 가을 체육대회' },
    p3:{ id:'p3', title:'2025 하계 수련회' },
  }, allIds:['p1','p2','p3'] },
  // 사람의 팀·역할은 DB에서 온다(profiles.team_id · role_note, 0030)
  members:[
    { id:'u1', name:'노준석', team:'찬양팀', teams:['찬양팀'], role:'순장 · 찬양팀장' },
    { id:'u2', name:'조준환', team:'임원진', teams:['임원진','찬양팀'], role:'예배팀장 · 찬양팀 남자 싱어' },
    { id:'u3', name:'문진혁', team:'엔지니어팀', teams:['엔지니어팀'], role:'엔지니어팀장' },
    { id:'u4', name:'시온', team:'미디어팀', teams:['미디어팀'], role:'미디어팀장 · 찬양팀 베이스' },
    { id:'u5', name:'박지호', team:'임원진', teams:['임원진'], role:'리더팀장 · 웰컴팀장' },
  ],
  tasks:{ byId:{
    t0: mk('t0','찬양 콘티 결정',['워십팀','찬양팀'],'완료','2026-07-12','2026-07-26',['노준석','조준환']),
    t1: mk('t1','악보·송폼 제작',['찬양팀'],'시작 전','2026-07-27','2026-08-02',['노준석']),
    t2: mk('t2','사운드 체크·리허설',['엔지니어팀','찬양팀'],'시작 전','2026-08-03','2026-08-08',['문진혁']),
    t3: mk('t3','간식·음료 구매',['웰컴팀'],'시작 전','','2026-07-30',['박지호']),
    // 다른 프로젝트 — 지금 돌아가는 것 하나, 예전에 끝난 것 하나
    t4: mk('t4','체육대회 물품 준비',['웰컴팀'],'진행 중','2026-09-01','2026-09-20',['박지호'],'p2'),
    t5: mk('t5','작년 콘티 확정',['찬양팀'],'완료','2025-07-10','2025-07-24',['노준석'],'p3'),
    t6: mk('t6','작년 포스터 제작',['미디어팀'],'완료','2025-06-01','2025-06-20',['시온'],'p3'),
  }, allIds:['t0','t1','t2','t3','t4','t5','t6'] },
};
if (!patched.includes('/src/services/aiPeople.js') || /from '\.\/worship\.js'/.test(patched)) { console.log('FAIL  aiPeople import 줄을 못 바꿨어요 (ai.js의 import가 바뀌었나요)'); process.exit(1); }
const { buildTaskContext, peopleContext, sanitizeMentions, resolveTaskLinks, AiService, setAiRoster } = await import(pathToFileURL(file).href);
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const NOW = new Date('2026-07-24T10:00:00');   // 콘티 마감(7/26) 이틀 전
const ctx = buildTaskContext(globalThis.__STATE.tasks.byId.t0, NOW);
check('프로젝트 이름이 실린다', ctx.includes('2026 하계 수련회'), '');
check('이 업무의 팀·담당자·일정이 실린다',
  ctx.includes('워십팀·찬양팀') && ctx.includes('노준석, 조준환')
  && /2026-07-12\([일월화수목금토]\)~2026-07-26\([일월화수목금토]\)/.test(ctx));
// 요일이 없으면 AI가 ISO 문자열만 보고 주일·수요 예배를 알아낼 수 없다
check('날짜에 요일이 붙는다', /2026-08-02\(일\)/.test(ctx), (ctx.split('\n').find(l=>l.includes('2026-08-02')) || '(없음)'));
check('같은 팀을 공유하는 업무가 먼저 온다',
  ctx.indexOf('악보·송폼 제작') < ctx.indexOf('간식·음료 구매'),
  `악보 ${ctx.indexOf('악보·송폼 제작')} / 간식 ${ctx.indexOf('간식·음료 구매')}`);
check('마감 이후에 놓인 업무를 따로 뽑아준다',
  /이 업무 마감 이후에 놓인 업무: .*악보·송폼 제작/.test(ctx),
  (ctx.split('\n').find(l=>l.includes('마감 이후')) || '(없음)'));

// ── 오늘 (2026-08-28에 넣었다) ──────────────────────────────────────────────
// 오늘이 없으면 AI는 마감이 지났는지 코앞인지를 모른다 — 요일까지 붙여 주면서
// 정작 기준점을 안 줬다.
check('오늘 날짜가 실린다', ctx.includes('[오늘] 2026-07-24(금)'),
  (ctx.split('\n')[0] || '(없음)'));
check('마감까지 남은 날을 알려준다', ctx.includes('마감까지 2일 남음'),
  (ctx.split('\n').find(l=>l.startsWith('- 이 업무:')) || '(없음)'));
{
  const late = buildTaskContext({ ...globalThis.__STATE.tasks.byId.t0, dueDate:'2026-07-20' }, NOW);
  check('마감이 지났으면 지났다고 말한다', late.includes('마감이 4일 지남'),
    (late.split('\n').find(l=>l.startsWith('- 이 업무:')) || '(없음)'));
  const none = buildTaskContext({ ...globalThis.__STATE.tasks.byId.t0, dueDate:'' }, NOW);
  check('마감이 없으면 "마감 미정"이다(§8 — "없어요"로 끝내지 않는다)', none.includes('마감 미정'));
}

// ── 다른 프로젝트 (2026-08-28) ─────────────────────────────────────────────
// 재료는 listAllCards가 이미 스토어에 다 올려 두었다. 프로젝트 경계만 풀면 된다.
check('다른 프로젝트에서 지금 돌아가는 일이 실린다',
  ctx.includes('[다른 프로젝트에서 지금 돌아가는 일]') && ctx.includes('2026 가을 체육대회 / 체육대회 물품 준비'));
check('같은 팀이 예전에 끝낸 업무가 아카이브로 실린다',
  ctx.includes('[같은 팀이 예전에 끝낸 업무') && ctx.includes('2025 하계 수련회 / 작년 콘티 확정'));
// 팀이 안 겹치는 예전 업무까지 부르면 프롬프트가 남의 일로 채워진다
check('팀이 안 겹치는 예전 업무는 아카이브에 안 들어간다', !ctx.includes('작년 포스터 제작'));
check('완료된 업무는 "지금 돌아가는 일"에 안 들어간다',
  !ctx.split('[같은 팀이 예전에')[0].includes('작년 콘티 확정'));

// ── 등장 인물만 (2026-08-28) ───────────────────────────────────────────────
// 조직표를 통째로 싣지 않는다 — 가입자가 늘어도 프롬프트가 커지면 안 된다(사용자 결정).
{
  const t0 = globalThis.__STATE.tasks.byId.t0;
  const people = peopleContext(t0, []);
  check('담당자의 팀과 부를 말이 실린다',
    people.includes('노준석 | 팀: 찬양팀 | 부를 때: 노준석 찬양팀장님')
    && people.includes('조준환 | 팀: 임원진·찬양팀 | 부를 때: 조준환 예배팀장님 | 맡은 일: 찬양팀 남자 싱어'),
    people.replace(/\n/g, ' / '));
  check('이 업무에 없는 사람은 안 실린다', !people.includes('문진혁') && !people.includes('박지호'), people.replace(/\n/g,' / '));
  const withMention = peopleContext({ ...t0, assignees:['시온'] }, [], { withMention: true });
  check('다듬기용으로 부르면 멘션 표기가 붙는다', withMention.includes('멘션은 @시온'));
  check('요약용으로 부르면 멘션 표기가 없다', !people.includes('멘션은 @'));
  const mentioned = peopleContext({ ...t0, assignees:[], content:'이건 @문진혁 님이 봐주세요' }, []);
  check('본문에서 @로 불린 사람도 실린다', mentioned.includes('문진혁'));
  const fromComment = peopleContext({ ...t0, assignees:[], comments:[{ author:'x', text:'@박지호 확인 부탁' }] }, []);
  check('댓글에서 @로 불린 사람도 실린다', fromComment.includes('박지호'));
}

// ── 직함 고르기 · 순 자리 · 글에 나온 사람 (2026-09-25 · AI 감사 결정 1·3·6·7·9·13) ──────────
// 명단 한 벌(worship.fetchRoster 모양)은 setAiRoster로 쥐여 준다 — 실제 앱은 처음 AI를 부를 때
// 한 번 읽는다(ai.js loadAiRoster). 명단 쪽 이름 '강꽃님'·'배현민'은 표시명과 다른 짝이다.
{
  const st = globalThis.__STATE;
  const extra = [
    { id:'u6', name:'임성빈', team:'교역자', teams:['교역자'], role:'전도사 · 담당 교역자' },
    { id:'u7', name:'신효진', team:'임원진', teams:['임원진'], role:'부장' },
    { id:'u8', name:'김윤주', team:'엔지니어팀', teams:['엔지니어팀','순장'], role:'순장' },
    { id:'u9', name:'꽃님', team:'웰컴팀', teams:['웰컴팀','순원'], role:'' },
    { id:'u10', name:'현민스', team:'순장', teams:['순장'], role:'순장' },
    { id:'u11', name:'김승찬', team:'찬양팀', teams:['찬양팀','순장'], role:'순장 · 찬양팀 일렉(팀에서 유일)' },
    // 지은 이름 — role_note에 직함이 없고 연도 직분만 있는 사람(결정 1의 채우는 쪽)
    { id:'u12', name:'한가람', team:'임원진', teams:['임원진'], role:'' },
  ];
  st.members.push(...extra);
  st.members.find(m => m.name === '노준석').teams = ['찬양팀', '순장'];
  const person = (id, name, profile_id, extraCols = {}) => ({ id, name, roster_name: name, profile_id, is_pastor: false, ...extraCols });
  setAiRoster({
    people: [
      person('p1', '노준석', 'u1'), person('p2', '조준환', 'u2'), person('p6', '임성빈', 'u6', { is_pastor: true }),
      person('p7', '신효진', 'u7'), person('p9', '꽃님', 'u9', { roster_name: '강꽃님' }),
      person('p10', '현민스', 'u10', { roster_name: '배현민' }), person('p11', '김승찬', 'u11'),
      person('p12', '한가람', 'u12'), person('p13', '천미가입', null),
    ],
    groups: [{ id:'g1', type:'sun', name:'TT순', leader_person_id:'p1' }, { id:'g2', type:'sun', name:'오순도순', leader_person_id:'p10' }],
    members: [{ group_id:'g1', person_id:'p9' }, { group_id:'g1', person_id:'p2' }],
    roles: [{ person_id:'p2', role:'lead_team' }, { person_id:'p7', role:'director' }, { person_id:'p12', role:'treasurer' }],
  });
  const lineOf = (ctx, name) => (ctx.split('\n').find(l => l.startsWith(`${name} `) || l.startsWith(`${name}(`)) || '(없음)');
  const t0 = st.tasks.byId.t0;                                   // 찬양 콘티 결정 · 워십팀·찬양팀
  const praise = peopleContext(t0, []);
  check('찬양팀 업무에서 노준석은 찬양팀장님(결정 3)', lineOf(praise, '노준석').includes('부를 때: 노준석 찬양팀장님'), lineOf(praise, '노준석'));
  const sunTask = { ...t0, id:'s1', title:'순모임 나눔 정리', teams:['순장'], content:'', assignees:['노준석'] };
  check('순 업무에서 노준석은 순장님(결정 3)', lineOf(peopleContext(sunTask, []), '노준석').includes('부를 때: 노준석 순장님'),
    lineOf(peopleContext(sunTask, []), '노준석'));
  const sunByText = { ...t0, id:'s2', title:'9월 셋째 주 나눔', teams:['임원진'], content:'각 순 순원 출석 확인 · 순모임 장소 정하기', assignees:['노준석'] };
  check('글이 순을 말해도 순장님(담당 팀이 순이 아니어도)', lineOf(peopleContext(sunByText, []), '노준석').includes('노준석 순장님'));
  // 본문에 순이 한두 번 곁가지로 나오면(수련회 피드백의 '## 순장 피드백' 한 도막) 순 일이 아니다 — 업무 팀 직함이 이긴다
  const aside = { ...t0, id:'s2b', title:'피드백 및 강평회', teams:['찬양팀','임원진'], content:'## 순장 피드백\n- 좋았다', assignees:['노준석'] };
  check('본문에 순이 곁가지로 나오면 업무 팀의 직함(찬양팀장님)', lineOf(peopleContext(aside, []), '노준석').includes('노준석 찬양팀장님'), lineOf(peopleContext(aside, []), '노준석'));
  const other = { ...t0, id:'s3', title:'대림절 TF', teams:['임원진'], content:'', assignees:['노준석'] };
  check('순도 팀도 안 맞으면 순 아닌 첫 직함(찬양팀장님)', lineOf(peopleContext(other, []), '노준석').includes('노준석 찬양팀장님'));
  check('조준환은 연도 직분이 리더팀장이어도 예배팀장님(결정 1 — role_note가 이긴다)',
    lineOf(praise, '조준환').includes('부를 때: 조준환 예배팀장님') && !lineOf(praise, '조준환').includes('리더팀장'), lineOf(praise, '조준환'));
  const staff = peopleContext({ ...other, assignees:['임성빈', '신효진', '한가람', '김윤주'] }, []);
  check('임성빈은 전도사님 · 교역자님이 아니다(결정 6)',
    lineOf(staff, '임성빈').includes('부를 때: 임성빈 전도사님') && !staff.includes('교역자님'), lineOf(staff, '임성빈'));
  check('신효진은 부장님(결정 7)', lineOf(staff, '신효진').includes('부를 때: 신효진 부장님'), lineOf(staff, '신효진'));
  check('role_note에 직함이 없으면 연도 직분이 채운다(결정 1)', lineOf(staff, '한가람').includes('부를 때: 한가람 총무님'), lineOf(staff, '한가람'));
  check('직함이 하나뿐이면 어느 업무에서나 그 직함(김윤주 순장님)', lineOf(staff, '김윤주').includes('김윤주 순장님'), lineOf(staff, '김윤주'));
  check('순 자리는 팀과 따로 적는다(결정 9 · 명단이 있으면 순 이름까지)',
    lineOf(praise, '노준석').includes('| 팀: 찬양팀 | 순: TT순 순장 |') && lineOf(praise, '조준환').includes('| 순: TT순 순원 |'),
    `${lineOf(praise, '노준석')} / ${lineOf(praise, '조준환')}`);
  check('명단이 없으면 팀의 순장·순원에서 순 칸을 채운다', lineOf(staff, '김윤주').includes('| 팀: 엔지니어팀 | 순: 순장 |'), lineOf(staff, '김윤주'));
  check('팀 칸에 순장·순원이 섞이지 않는다', !/팀: [^|]*순[장원]/.test(praise + staff), (praise + staff).replace(/\n/g, ' / '));

  // 글에 이름으로 나온 가입자(결정 13) — 표시명 · 명단 이름 · 이름 두 글자 · 'OO순'
  const said = { ...other, id:'s4', assignees:[], content:'### 승찬\n- 좋았다\n강꽃님 자매가 도와줌\n현민순(오순도순) 모임\n운전자(준석)가 고생' };
  const found = peopleContext(said, []);
  check('이름 두 글자로 적힌 가입자가 실린다(### 승찬 · (준석))', found.includes('김승찬 |') && found.includes('노준석 |'), found.replace(/\n/g, ' / '));
  check('명단 이름으로 적힌 가입자가 표시명으로 실린다(강꽃님 → 꽃님)', lineOf(found, '꽃님').startsWith('꽃님(명단 이름 강꽃님)'), lineOf(found, '꽃님'));
  check('OO순으로 적힌 순장이 실린다(현민순 → 현민스)', found.includes('현민스(명단 이름 배현민)'), found.replace(/\n/g, ' / '));
  const noise = peopleContext({ ...other, id:'s5', assignees:[], content:'시온의 영광이 비치는 아침 · 선착순 20명 · 오순도순 모여 · 교역자 회의' }, []);
  check('흔한 낱말·붙여 쓴 말은 사람으로 안 잡는다(시온의 영광 · 선착순 · 오순도순)', noise === '', noise.replace(/\n/g, ' / '));
  check('미가입 명단 사람은 싣지 않는다(가입자만)', !found.includes('천미가입'));
  st.members.splice(st.members.length - extra.length, extra.length);
  st.members.find(m => m.name === '노준석').teams = ['찬양팀'];
  setAiRoster(null);
}

// ── AI가 쓴 멘션 검사 (2026-08-28) ─────────────────────────────────────────
// 멘션은 표시명 정확 일치로만 사람을 찾는다. 표시명이 아닌 이름에 @를 붙이면
// 아무에게도 안 가고 본문에 죽은 채로 남는다.
{
  const names = ['노준석','시온'];
  check('있는 표시명은 멘션을 남긴다', sanitizeMentions('@노준석 님 확인 부탁해요', names) === '@노준석 님 확인 부탁해요');
  check('없는 이름은 @를 뗀다', sanitizeMentions('@이시온 님 확인 부탁해요', names) === '이시온 님 확인 부탁해요',
    sanitizeMentions('@이시온 님 확인 부탁해요', names));
  check('문장부호가 붙어도 이름만 보고 판단한다',
    sanitizeMentions('@노준석, @임재훈.', names) === '@노준석, 임재훈.',
    sanitizeMentions('@노준석, @임재훈.', names));
}

// 실제로 프롬프트에 붙는지 — callGemini를 가로채 프롬프트를 들여다본다
let captured = null;
AiService.callGemini = async (prompt, sys) => { captured = { prompt, sys }; return ''; };
await AiService.summarizeTask(globalThis.__STATE.tasks.byId.t0);
check('요약 프롬프트에 주변 상황이 들어간다', captured.prompt.includes('[지금 이 업무의 주변 상황]'));
check('요약 프롬프트에 관련된 사람이 들어간다', captured.prompt.includes('[이 업무에 관련된 사람]'));
check('챙길 것은 남은 하위 업무만 - 끝낸 것을 챙기라 하면 틀린 요약이다',
  captured.sys.includes('"남은 하위 업무" 줄이 있으면 그 줄에 적힌 것만') && captured.sys.includes('그 요약은 틀린 것이다'));
// 결정 11(2026-09-25) — 하위 업무가 없으면 본문에서 할 일을 고른다. "남은 하위 업무가 없어요"를 썼다(A/B title-2)
check('챙길 것: 남은 하위 업무가 없으면 본문에서 고르고, 없다고만 쓰지 말라고 한다',
  captured.sys.includes('**상세 내용과 댓글에서 아직 안 끝난 일**을 골라 써라')
  && captured.sys.includes('하위 업무가 없다고만 적고 끝내지 마라'));
check('챙길 것 규칙이 "없어요" 문장을 예로 들지 않는다(모델이 예문을 베낀다)',
  !/남은 하위 업무가? 없어요/.test(captured.sys) && !captured.prompt.includes('없음(전부 완료)'));
check('요약 규칙에 "마감일까지 끝내라는 말 금지"가 있다',
  captured.sys.includes('마감일까지 끝내라는 말은 절대 쓰지 마라'));
check('요약 규칙에 사역 진행 순서가 있다',
  captured.sys.includes('콘티 확정 → 송폼 제작'));
check('요약 규칙에 팀 간 인수인계 지시가 있다',
  captured.sys.includes('넘겨주고 받아야'));
check('요약 규칙에 교회 달력이 있다',
  captured.sys.includes('[교회 일정의 기본 리듬]')
  && captured.sys.includes('주일 4부 젊은이 예배') && captured.sys.includes('금요 열정 예배'));
// 우리 교회에 없는 일정은 넣지 않는다 (수요 예배는 안 한다)
check('수요 예배는 달력에 없다', !captured.sys.includes('수요 예배'));
check('없는 절기를 지어내지 말라는 규칙이 있다', captured.sys.includes('지어내지 마라'));
// 2026-08-28에 넣은 배경들
check('예배 순서와 성찬 예배가 달력에 있다',
  captured.sys.includes('13:30~14:00  찬양') && captured.sys.includes('둘째 주는 성찬 예배'));
check('토요일에 준비가 몰린다는 틀린 문장이 없다', !captured.sys.includes('토요일은 주일 준비가 몰리는 날'),
  '2026-08-28 사용자 정정 — 토요일은 보통 찬양팀 연습만 있다');
// 회계 절차는 프롬프트에 베끼지 않는다 — 워크스페이스의 '메뉴얼' 업무가 정본이다
check('회계는 절차를 심지 않고 메뉴얼 업무를 가리킨다',
  captured.sys.includes('[돈이 걸린 업무]') && captured.sys.includes("'메뉴얼' 업무에 정리되어 있다")
  && !captured.sys.includes('두 분의 결재'));
check('순과 조를 구분하라는 규칙이 있다', captured.sys.includes('순과 조는 다르다'));
check('워십팀이 찬양팀과 다르다는 것을 알려준다', captured.sys.includes('찬양팀과 다른 팀이다'));
check('청년부 규모를 알려준다(약 55명 · 2026-09-25)', captured.sys.includes('약 55명') && !captured.sys.includes('약 40명'));
check('예배팀장과 찬양팀장이 다른 자리라고 알려준다(결정 2)',
  captured.sys.includes('예배팀장은 찬양팀장과 다른 자리다') && captured.sys.includes('찬양팀·엔지니어팀·워십팀에 걸친 예배 전체'));
check('호칭 규칙: 부를 때 글자 그대로 · 교역자님 금지',
  captured.sys.includes('"부를 때" 글자를 그대로') && captured.sys.includes('"교역자님"이라고 부르지 마라'));
// §8의 문구 톤을 AI도 받아야 한다 — 요약은 카드에 고정돼 남는 글이다
check('견주는 표현 금지가 규칙에 있다', captured.sys.includes('누가 누구와 견주는 표현을 절대 쓰지 마라'));
check('판정어 금지가 규칙에 있다', captured.sys.includes('부하, 과부하, 병목'));
check('요약에서는 @를 쓰지 말라고 한다', captured.sys.includes('사람을 부를 때 @를 붙이지 마라'));

// 같은 카드를 두 번 요약하면 두 번 과금됐다 — 캐시가 두 번째 호출을 막는지
{
  const t = { ...globalThis.__STATE.tasks.byId.t1, id: 'cache-1', updatedAt: '2026-07-20T00:00:00Z' };
  let calls = 0;
  AiService.callGemini = async () => { calls++; return '1. **현황** - 그대로예요'; };
  const first = await AiService.summarizeTask(t);
  const second = await AiService.summarizeTask(t);
  check('같은 카드를 두 번 요약해도 호출은 한 번', calls === 1, `${calls}회`);
  check('캐시가 같은 내용을 돌려준다', first === second && first.includes('현황'));
  // 카드가 바뀌면(updatedAt 변경) 다시 만든다
  await AiService.summarizeTask({ ...t, updatedAt: '2026-07-21T00:00:00Z' });
  check('카드가 바뀌면 캐시가 무효가 된다', calls === 2, `${calls}회`);
  // 하위 업무를 체크하면 updatedAt이 아직 그대로여도(서버 왕복 전) 다시 만든다 —
  // 요약이 끝낸 것/남은 것을 갈라 말하므로 체크 하나가 답을 바꾼다
  const subs = [{ id: 's1', title: '곡 목록', done: false }];
  await AiService.summarizeTask({ ...t, updatedAt: '2026-07-21T00:00:00Z', subtasks: subs });
  await AiService.summarizeTask({ ...t, updatedAt: '2026-07-21T00:00:00Z', subtasks: [{ id: 's1', title: '곡 목록', done: true }] });
  check('하위 업무 체크가 캐시를 무효로 만든다(서버 왕복 전에도)', calls === 4, `${calls}회`);
  // 안내 문구는 캐시에 남지 않는다 — 로그인한 뒤에도 계속 그 문구가 나오면 안 된다
  AiService.clearSummaryCache();
  calls = 0;
  AiService.callGemini = async () => { calls++; return 'AI 기능은 로그인 후 사용할 수 있어요.'; };
  await AiService.summarizeTask(t);
  await AiService.summarizeTask(t);
  check('안내 문구는 캐시하지 않는다', calls === 2, `${calls}회`);
  // 아래 다듬기 검사가 쓰는 프롬프트 가로채기를 되돌려 놓는다
  AiService.callGemini = async (prompt, sys) => { captured = { prompt, sys }; return ''; };
}

captured = null;
await AiService.polishText('콘티 확정했고 송폼 아직', globalThis.__STATE.tasks.byId.t0);
check('다듬기 프롬프트에도 주변 상황이 들어간다', captured.prompt.includes('[지금 이 업무의 주변 상황]'));
check('다듬기는 새 항목 추가 금지 규칙이 있다', captured.sys.includes('새 항목으로 추가하지는 마라'));
check('다듬기에 회의록 구조 지시가 있다',
  captured.sys.includes('회의록') && captured.sys.includes('아직 정하지 못한 것'));
check('다듬기에 회의록 예시가 있다', captured.prompt.includes('피드백 및 강평회'));
check('굵게와 형광펜의 역할이 갈려 있다',
  captured.sys.includes('**굵게**는 숫자다') && captured.sys.includes('==형광펜==은 판단이다')
  && captured.sys.includes('두세 곳까지'));
check('우리 표현으로 바꾸라는 표가 있다',
  captured.sys.includes('3층 본당') && captured.sys.includes('셀·소그룹 → 순'));
check('원문에 없는 사람을 멘션하지 말라는 규칙이 있다', captured.sys.includes('원문에 나오지 않은 사람은 멘션하지 마라'));
check('다듬기 프롬프트에 멘션 표기가 실린다', captured.prompt.includes('멘션은 @노준석'));
// 예시 3·4의 사람은 지은 이름이다(2026-09-25) — 실명을 쓰면 모델이 그 사람을 다른 카드로 끌어왔고
// 공개 레포에 교인 이름·직함 짝이 남는다. 예시 4가 줄마다 '9월 26일까지'를 붙여 모델이 그 날짜를 베꼈다.
{
  const examples = captured.prompt.split('[오늘]')[0];
  const real = ['조해리', '박지호', '김승찬', '정민경', '조준환', '민경', '준환', '해리', '지호', '이시온'];
  check('다듬기 예시에 실제 교인 이름이 없다', !real.some(n => examples.includes(n) || captured.sys.includes(n)),
    real.filter(n => examples.includes(n) || captured.sys.includes(n)).join(','));
  check('다듬기 예시·규칙에 9월 26일이 없다(베껴 쓰던 기한)', !/9월 26일|26일까지/.test(examples + captured.sys));
  check('예시 4는 기한이 적힌 줄에만 날짜를 붙인다',
    examples.includes('- @한가람 @최서율 · 4월 콘티 확정(이번 주 안)\n') || examples.includes('- @한가람 @최서율 · 4월 콘티 확정(이번 주 안)\r\n'));
  check('예시의 사람 목록이 실제 한 줄 모양(부를 때)과 같다', examples.includes('  한가람 | 팀: 찬양팀·임원진 | 부를 때: 한가람 총무님 | 멘션은 @한가람'));
  check('예시 날짜를 옮겨 적지 말라고 한다', captured.sys.includes('예시에 나온 날짜를 옮겨 적지 마라')
    && captured.sys.includes('원문에 날짜가 하나도 없으면 이 도막의 어느 줄에도 날짜를 붙이지 마라'));
  // 예시 4의 날짜는 원문의 공동 기한('17일까지') 하나다 — 연습 날짜(4월 25일)를 두었더니 25일이 베껴졌다
  const ex4 = examples.slice(examples.indexOf('---예시 4')).replace('이 예시의 오늘은 4월 13일이다', '');
  check('예시 4에는 공동 기한 말고 날짜가 없다',
    [...ex4.matchAll(/(\d{1,2})월\s?(\d{1,2})일/g)].every(m => m[0].replace(/\s/g, '') === '4월17일')
    && [...ex4.matchAll(/(\d{1,2})월(\d{1,2})일/g)].length === 0 && !/\d+일까지/.test(ex4.replace(/17일까지/g, '')),
    [...ex4.matchAll(/\d{1,2}월\s?\d{1,2}일/g)].map(m => m[0]).join(','));
}
// 다듬기에 싣는 사람 = 담당자 · @ · **초안에 이름으로 나온 가입자**만(결정 13)
{
  const t3 = globalThis.__STATE.tasks.byId.t3;                   // 간식·음료 구매 · 담당 박지호
  captured = null;
  await AiService.polishText('간식 목록 정리 준석 형제가 영수증 모아줌 시온의 영광 틀기', t3);
  // 예시 3·4도 '[이 업무에 관련된 사람]'이라는 글자를 쓴다 — 실제 목록은 마지막 것이다
  const at = captured.prompt.lastIndexOf('\n[이 업무에 관련된 사람]');
  const ppl = at < 0 ? '' : captured.prompt.slice(at).split('이제 아래 초안')[0];
  check('다듬기: 초안에 이름 두 글자로 나온 가입자가 실린다(준석 형제 → 노준석)', ppl.includes('노준석 |'), ppl.trim().replace(/\n/g, ' / '));
  check('다듬기: 담당자는 그대로 실린다', ppl.includes('박지호 |'));
  check('다듬기: 초안에 없는 가입자는 안 실린다(시온의 영광은 사람이 아니다)',
    !ppl.includes('시온 |') && !ppl.includes('조준환') && !ppl.includes('문진혁'), ppl.trim().replace(/\n/g, ' / '));
}

// ── 관련 업무 링크 (2026-08-30) ────────────────────────────────────────────
// 모델에게 uuid를 쓰게 하면 지어내서 죽은 링크가 된다. 표시만 쓰게 하고 제목 정확
// 일치로 우리가 id를 찾는다 — 멘션이 표시명 정확 일치로 사람을 찾는 것과 같은 방식.
check('다듬기에 관련 업무를 [[업무:제목]]로 쓰라는 지시가 있다',
  captured.sys.includes('[[업무:제목]]') && captured.sys.includes('한 글자도 바꾸지 말고'));
check('업무 표시에 주소·id를 직접 쓰지 말라고 한다',
  captured.sys.includes('주소나 id를 직접 쓰지 마라'));
check('지금 다듬는 업무 자신은 표시하지 말라고 한다',
  captured.sys.includes('지금 다듬고 있는 이 업무 자신은 표시하지 마라'));
// 라이브에서 다듬기가 첨부 파일 이름(`2026 하계 수련회-3.xlsx`)에 업무 링크를 걸었다.
// 첨부 이름은 프롬프트에 그대로 실리므로 모델이 그걸 "다른 업무"로 착각한다 → 프롬프트로
// 한 겹, resolveTaskLinks의 확장자 가드로 한 겹 막는다(2026-08-30).
check('첨부 파일 이름에는 표시를 붙이지 말라고 한다',
  captured.sys.includes('첨부 파일 이름에는 표시를 붙이지 마라'));
{
  const ORG = 'https://x.app';
  const t0 = globalThis.__STATE.tasks.byId.t0;      // '찬양 콘티 결정' (p1)
  const link = (s) => resolveTaskLinks(s, t0, { origin: ORG });
  check('제목이 정확히 맞으면 링크가 된다',
    link('송폼은 [[업무:악보·송폼 제작]]에서 이어가요')
      === `송폼은 [악보·송폼 제작](${ORG}/?p=p1&t=t1)에서 이어가요`,
    link('송폼은 [[업무:악보·송폼 제작]]에서 이어가요'));
  check('다른 프로젝트의 업무도 링크가 된다',
    link('[[업무:체육대회 물품 준비]]') === `[체육대회 물품 준비](${ORG}/?p=p2&t=t4)`,
    link('[[업무:체육대회 물품 준비]]'));
  // 못 찾으면 표시만 벗기고 글자로 둔다 — 본문에 [[…]]가 남으면 그게 죽은 표시다
  check('없는 업무는 표시를 벗겨 글자로 둔다',
    link('[[업무:있지도 않은 업무]] 확인') === '있지도 않은 업무 확인',
    link('[[업무:있지도 않은 업무]] 확인'));
  check('제목이 한 글자라도 다르면 링크가 아니다',
    link('[[업무:악보 송폼 제작]]') === '악보 송폼 제작', link('[[업무:악보 송폼 제작]]'));
  // 자기 자신을 가리키는 링크는 뜻이 없다(이미 그 업무를 보고 있다)
  check('자기 자신은 링크로 만들지 않는다',
    link('이 업무는 [[업무:찬양 콘티 결정]]이에요') === '이 업무는 찬양 콘티 결정이에요',
    link('이 업무는 [[업무:찬양 콘티 결정]]이에요'));
  check('표시가 없는 글은 그대로 둔다', link('그냥 문장이에요') === '그냥 문장이에요');
  // **`업무:` 접두 없이 쓴 표시도 받는다** — 실제 Gemini가 `[[5차 피드백 개선]]`처럼
  // 접두를 빼고 써서, 접두 필수 정규식이 통째로 무시하고 본문에 [[…]]가 생짜로 남았다
  // (사용자 지적 2026-08-30 · 라이브). 되돌리기 검사: TASK_MARK_RE의 (?:업무\s*:\s*)?를
  // 필수로 되돌리면 아래 둘이 깨진다.
  check('업무: 접두 없이도 제목이 맞으면 링크가 된다',
    link('[[악보·송폼 제작]]에서 이어가요') === `[악보·송폼 제작](${ORG}/?p=p1&t=t1)에서 이어가요`,
    link('[[악보·송폼 제작]]에서 이어가요'));
  check('업무: 접두 없이 못 찾은 표시도 괄호를 벗겨 글자로 둔다 — [[가 본문에 안 남는다',
    link('[[있지도 않은 업무]] 확인') === '있지도 않은 업무 확인',
    link('[[있지도 않은 업무]] 확인'));
  // 파일 이름은 제목이 실제로 맞아도 링크로 만들지 않는다 — 라이브에서 다듬기가
  // `2026 하계 수련회-3.xlsx`(첨부 이름)에 업무 링크를 걸었다(2026-08-30).
  // 되돌리기 검사: ai.js의 FILE_TITLE_RE 가드를 빼면 이 단정이 깨진다.
  {
    const st = globalThis.__STATE;
    st.tasks.byId.t9 = mk('t9', '2026 하계 수련회-3.xlsx', ['임원진'], '시작 전', '', '', []);
    st.tasks.allIds.push('t9');
    check('제목이 파일 이름이면 링크로 만들지 않는다',
      link('[[업무:2026 하계 수련회-3.xlsx]] 확인') === '2026 하계 수련회-3.xlsx 확인',
      link('[[업무:2026 하계 수련회-3.xlsx]] 확인'));
    // 확장자처럼 보이는 꼬리가 없으면 그대로 링크가 된다(가드가 너무 넓지 않은지)
    st.tasks.byId.t9.title = '결산안 v1.2 정리';
    check('점이 있어도 확장자가 아니면 링크가 된다',
      link('[[업무:결산안 v1.2 정리]]') === `[결산안 v1.2 정리](${ORG}/?p=p1&t=t9)`,
      link('[[업무:결산안 v1.2 정리]]'));
    st.tasks.allIds.pop();
    delete st.tasks.byId.t9;
  }
  // 다듬기 결과가 실제로 이 변환을 거쳐 나오는지 (본문에 [[…]]가 남으면 안 된다).
  // 주소는 절대 주소여야 한다 — 저장 형식의 링크 문법이 http(s)만 받는다(markdown.js).
  // 그래서 브라우저처럼 origin이 있는 상태를 만들어 준다.
  globalThis.window = { location: { origin: ORG } };
  AiService.callGemini = async () => '- [[업무:악보·송폼 제작]]로 넘겨요\n- [[업무:없는 것]]은 그대로';
  const polished = await AiService.polishText('초안', t0);
  check('다듬기 결과가 링크로 바뀌어 나온다',
    polished.includes(`[악보·송폼 제작](${ORG}/?p=p1&t=t1)`) && !polished.includes('[[업무:'),
    polished.replace(/\n/g, ' / '));
  delete globalThis.window;
  AiService.callGemini = async (prompt, sys) => { captured = { prompt, sys }; return ''; };
}
// 안내 문구는 그대로 돌려줘야 부르는 쪽이 걸러낼 수 있다(본문을 덮어쓰던 버그)
{
  AiService.callGemini = async () => 'AI 기능은 로그인 후 사용할 수 있어요.';
  const out = await AiService.polishText('초안');
  check('다듬기가 안내 문구를 그대로 돌려준다', out === 'AI 기능은 로그인 후 사용할 수 있어요.', out);
  AiService.callGemini = async (prompt, sys) => { captured = { prompt, sys }; return ''; };
}
captured = null;
await AiService.polishText('그냥 초안');
check('task 없이 부르면 주변 상황 없이도 동작', captured && !captured.prompt.includes('[지금 이 업무의 주변 상황]'));

// ── 선후관계·첨부·하위 업무가 실리는지 (2026-08-26에 넓힌 컨텍스트) ──
// 후행 연결이 있으면 날짜 짐작("마감 이후에 놓인 업무")은 접어야 한다 —
// 연결은 팀원이 직접 그은 것이라 그쪽이 정답이다.
{
  const st = globalThis.__STATE;
  st.tasks.byId.t1.dependsOn = ['t0'];                     // 악보 제작은 콘티 확정을 기다린다
  st.tasks.byId.t0.attachments = [{ name: '콘티_시안2.pdf' }, '지난주_콘티.xlsx'];
  st.tasks.byId.t0.subtasks = [{ id: 's1', title: '곡 목록 확정', done: true }, { id: 's2', title: '키 확인', done: false }];
  const ctx2 = buildTaskContext(st.tasks.byId.t0, NOW);
  check('후행 업무(이 업무를 기다리는)가 실린다', ctx2.includes('이 업무를 기다리는 후행 업무: 악보·송폼 제작'), '');
  check('후행 연결이 있으면 날짜 짐작은 접는다', !ctx2.includes('마감 이후에 놓인 업무'));
  check('목록 줄에도 기다림 표가 붙는다', ctx2.includes('★이 업무를 기다림'));
  check('선행 업무가 실린다(악보 쪽에서 보면)', buildTaskContext(st.tasks.byId.t1, NOW).includes('선행 업무(먼저 끝나야 함): 찬양 콘티 결정(완료)'));
  check('첨부 이름이 실린다(행 객체·문자열 모두)', ctx2.includes('첨부 파일 2개: 콘티_시안2.pdf, 지난주_콘티.xlsx'));
  // 끝난 것과 남은 것을 **제 줄로 갈라** 준다 — 한 줄에 붙였더니 모델이 둘을 섞어
  // 이미 끝낸 항목을 "마무리해야 해요"로 올렸다(라이브 재현 후 A/B 6회 전부로 확인).
  check('하위 업무를 남은 것 먼저, 제 줄로 가른다',
    ctx2.includes('하위 업무 1/2 완료')
    && ctx2.includes('- 남은 하위 업무(챙길 것은 이것뿐이다): 키 확인')
    && ctx2.includes('- 이미 끝낸 하위 업무(끝났다 — 챙기라고 말하지 마라): 곡 목록 확정')
    && ctx2.indexOf('남은 하위 업무') < ctx2.indexOf('이미 끝낸 하위 업무'),
    (ctx2.split('\n').filter(l=>l.includes('하위 업무')).join(' / ') || '(없음)'));
  // 결정 11 — 다 끝났거나 안 나눴을 때도 챙길 것의 재료(본문)를 가리킨다. '없음(전부 완료)'만 적으면
  // 모델이 "남은 하위 업무는 없어요"를 챙길 것에 그대로 썼다(A/B title-2 · 3회 중 2회).
  const allDone = buildTaskContext({ ...st.tasks.byId.t0, subtasks: [{ id:'s1', title:'곡 목록 확정', done:true }] }, NOW);
  const noSubs = buildTaskContext({ ...st.tasks.byId.t0, subtasks: [] }, NOW);
  check('하위 업무가 다 끝나면 본문에서 챙길 것을 고르라고 한다',
    allDone.includes('하위 업무는 모두 끝났다(챙길 것은 상세 내용·댓글에서') && !allDone.includes('없음'),
    (allDone.split('\n').filter(l=>l.includes('하위 업무')).join(' / ') || '(없음)'));
  check('하위 업무가 없으면 본문에서 챙길 것을 고르라고 한다', noSubs.includes('하위 업무는 아직 나누지 않았다(챙길 것은 상세 내용·댓글에서'));

  // 첨부 발췌(0030) — 파일 3개·합계 3000자 상한에서 잘리는지
  const long = 'ㄱ'.repeat(2000);
  st.tasks.byId.t0.attachments = [
    { name:'결산.xlsx', text_excerpt: long },
    { name:'예산.xlsx', text_excerpt: long },
    { name:'기획.docx', text_excerpt: long },
    { name:'네번째.pdf', text_excerpt: '이건 안 실려야 한다' },
    { name:'사진.jpg' },
  ];
  const ctx3 = buildTaskContext(st.tasks.byId.t0, NOW);
  const body = ctx3.split('[첨부')[0];
  check('첨부 발췌가 프롬프트에 실린다', ctx3.includes('- 첨부 파일 안의 글(앞부분만):') && ctx3.includes('결산.xlsx: ㄱ'));
  check('발췌는 파일 3개까지만', !ctx3.includes('네번째.pdf: '), '4번째 파일의 발췌는 빠져야 한다');
  check('발췌 합계가 3000자에서 잘린다', (ctx3.match(/ㄱ/g) || []).length === 3000,
    `${(ctx3.match(/ㄱ/g) || []).length}자`);
  check('발췌가 없는 첨부는 이름만 나온다', ctx3.includes('사진.jpg') && !ctx3.includes('사진.jpg: '));
  // 문서 발췌가 사진 캡션보다 먼저다(2026-09-24) — 백필한 사진 캡션([사진] 접두)이 올린 차례대로
  // 앞 3칸을 차지해 문서의 글을 밀어냈다. 되돌리기: ai.js의 isCaption 정렬을 빼면 깨진다.
  st.tasks.byId.t0.attachments = [
    { name:'행사1.jpg', text_excerpt: '[사진] 무대 위 찬양팀 다섯 명' },
    { name:'행사2.jpg', text_excerpt: '[사진] 현수막에 여름 수련회' },
    { name:'행사3.jpg', text_excerpt: '[사진] 식당 테이블' },
    { name:'결산.xlsx', text_excerpt: '야식 찬조 30,000원' },
  ];
  const ctx4 = buildTaskContext(st.tasks.byId.t0, NOW);
  check('문서 발췌가 사진 캡션보다 먼저 실린다',
    ctx4.includes('결산.xlsx: 야식 찬조') && ctx4.includes('행사1.jpg: [사진]')
    && ctx4.indexOf('결산.xlsx: ') < ctx4.indexOf('행사1.jpg: ') && !ctx4.includes('행사3.jpg: '),
    (ctx4.split('\n').filter(l => /^\s+· /.test(l)).join(' / ') || '(없음)'));
  // 되돌려 놓는다 — 위쪽 검사들이 이 상태를 전제하지 않게
  delete st.tasks.byId.t1.dependsOn; st.tasks.byId.t0.attachments = []; delete st.tasks.byId.t0.subtasks;
}

// ── 답이 안 오면 우리가 끊는다 (2026-09-09 · 소스 단정) ─────────────────────
// 상한이 없으면 브라우저 기본 타임아웃(수 분)까지 부르는 화면이 스켈레톤에 굳는다 —
// 본문 검색의 'AI가 찾은 구절' 도막이 실제로 그랬다. 끊은 뒤에는 **다른 실패와 같은
// 안내 문구**를 돌려줘야 부르는 쪽의 isFallbackText가 걸러낸다(안 그러면 그 글이
// 본문·요약에 그대로 들어간다 — 2026-08-28에 겪은 그 함정).
// 되돌리기 검사: signal이나 CALL_TIMEOUT_MS를 지우면 아래 단정이 깨진다.
{
  // 정규식으로 블록을 잡지 않는다 — `${CALL_TIMEOUT_MS}`의 닫는 중괄호가 먼저 걸린다
  const abortAt = src.indexOf("error?.name === 'AbortError'");
  const abortBranch = abortAt < 0 ? '' : src.slice(abortAt, abortAt + 260);
  check('AI 호출에 시간 상한이 있다',
    /const CALL_TIMEOUT_MS = \d+;/.test(src) && /new AbortController\(\)/.test(src)
    && /signal: ctl\.signal/.test(src) && /clearTimeout\(timer\)/.test(src));
  check('시간 초과는 안내 문구로 돌아온다(폴백)', /return MSG\.failed;/.test(abortBranch), abortBranch.trim().slice(0, 80));
  // 화면에 나가는 문구에는 숫자를 쓰지 않는다(§8 — "드라이브가 50초 안에…"를 고친 그 규칙).
  // 초 수는 콘솔에만 남는다.
  const msgBlock = /const MSG = \{([\s\S]*?)\n\};/.exec(src)?.[1] || '';
  check('사유는 콘솔에만 남고 안내 문구에는 숫자가 없다',
    /console\.warn\(/.test(abortBranch) && !/\d/.test(msgBlock), msgBlock.trim().slice(0, 60));
}

console.log(results.join('\n'));
console.log('\n--- 실제로 만들어진 주변 상황 블록 ---\n' + ctx);
process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
