// AI 프롬프트에 주변 상황이 실제로 실리는지 (네트워크 없이 buildTaskContext만 검사)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = 'C:/Users/노준석/Desktop/church_workspace';
const SRC = `${ROOT}/src/services/ai.js`;
const src = readFileSync(SRC, 'utf8');
// store import만 우리 가짜로 바꿔치기 (supabaseClient도 안 타게)
// utils.js는 순수 모듈이라 그대로 쓴다 — 다만 임시 폴더에서 도니 절대 경로로 바꾼다
const patched = src
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'export const supabase = null;')
  .replace(/from '\.\.\/utils\.js';/, `from '${pathToFileURL(`${ROOT}/src/utils.js`).href}';`)
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
const { buildTaskContext, peopleContext, sanitizeMentions, AiService } = await import(pathToFileURL(file).href);
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
  check('담당자의 팀과 직함이 실린다',
    people.includes('노준석 | 찬양팀 | 순장 · 찬양팀장') && people.includes('조준환 | 임원진·찬양팀 | 예배팀장'));
  check('이 업무에 없는 사람은 안 실린다', !people.includes('문진혁') && !people.includes('박지호'), people.replace(/\n/g,' / '));
  const withMention = peopleContext({ ...t0, assignees:['시온'] }, [], { withMention: true });
  check('다듬기용으로 부르면 멘션 표기가 붙는다', withMention.includes('멘션은 @시온'));
  check('요약용으로 부르면 멘션 표기가 없다', !people.includes('멘션은 @'));
  const mentioned = peopleContext({ ...t0, assignees:[], content:'이건 @문진혁 님이 봐주세요' }, []);
  check('본문에서 @로 불린 사람도 실린다', mentioned.includes('문진혁'));
  const fromComment = peopleContext({ ...t0, assignees:[], comments:[{ author:'x', text:'@박지호 확인 부탁' }] }, []);
  check('댓글에서 @로 불린 사람도 실린다', fromComment.includes('박지호'));
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
  captured.sys.includes('"남은 하위 업무" 줄에 적힌 것만') && captured.sys.includes('그 요약은 틀린 것이다'));
check('요약 규칙에 "마감일까지 끝내라는 말 금지"가 있다',
  captured.sys.includes('마감일까지 끝내라는 말은 절대 쓰지 마라'));
check('요약 규칙에 사역 진행 순서가 있다',
  captured.sys.includes('콘티 확정 → 송폼 제작'));
check('요약 규칙에 팀 간 인수인계 지시가 있다',
  captured.sys.includes('넘겨주고 받아야'));
check('요약 규칙에 교회 달력이 있다',
  captured.sys.includes('[교회 일정의 기본 리듬]')
  && captured.sys.includes('주일 4부 청년 예배') && captured.sys.includes('금요 열정 예배'));
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
check('청년부 규모를 알려준다', captured.sys.includes('약 40명'));
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
  // 되돌려 놓는다 — 위쪽 검사들이 이 상태를 전제하지 않게
  delete st.tasks.byId.t1.dependsOn; st.tasks.byId.t0.attachments = []; delete st.tasks.byId.t0.subtasks;
}

console.log(results.join('\n'));
console.log('\n--- 실제로 만들어진 주변 상황 블록 ---\n' + ctx);
process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
