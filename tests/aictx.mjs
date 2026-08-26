// AI 프롬프트에 주변 상황이 실제로 실리는지 (네트워크 없이 buildTaskContext만 검사)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = 'C:/Users/노준석/Desktop/church_workspace/src/services/ai.js';
const src = readFileSync(SRC, 'utf8');
// store import만 우리 가짜로 바꿔치기 (supabaseClient도 안 타게)
const patched = src
  .replace(/import \{ supabase \} from '\.\/supabaseClient\.js';/, 'export const supabase = null;')
  .replace(/import \{ store \} from '\.\.\/store\/workspaceStore\.js';/, `
const STATE = globalThis.__STATE;
export const store = { getState: () => STATE };`);
const dir = mkdtempSync(join(tmpdir(), 'aictx-'));
const file = join(dir, 'ai.mjs');
writeFileSync(file, patched);

const mk = (id, title, teams, status, sd, dd, assignees) => ({ id, projectId:'p1', title, teams, status,
  startDate:sd, dueDate:dd, assignees, content:'', comments:[], activityLog:[], attachments:[] });
globalThis.__STATE = {
  projects:{ byId:{ p1:{ id:'p1', title:'2026 하계 수련회' } }, allIds:['p1'] },
  tasks:{ byId:{
    t0: mk('t0','찬양 콘티 결정',['워십팀','찬양팀'],'완료','2026-07-12','2026-07-26',['노준석','조준환']),
    t1: mk('t1','악보·송폼 제작',['찬양팀'],'시작 전','2026-07-27','2026-08-02',['노준석']),
    t2: mk('t2','사운드 체크·리허설',['엔지니어팀','찬양팀'],'시작 전','2026-08-03','2026-08-08',['문진혁']),
    t3: mk('t3','간식·음료 구매',['웰컴팀'],'시작 전','','2026-07-30',['박지호']),
  }, allIds:['t0','t1','t2','t3'] },
};
import { pathToFileURL } from 'node:url';
const { buildTaskContext, AiService } = await import(pathToFileURL(file).href);
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const ctx = buildTaskContext(globalThis.__STATE.tasks.byId.t0);
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
check('다른 프로젝트 업무는 섞이지 않는다', !ctx.includes('다른프로젝트'));

// 실제로 프롬프트에 붙는지 — callGemini를 가로채 프롬프트를 들여다본다
let captured = null;
AiService.callGemini = async (prompt, sys) => { captured = { prompt, sys }; return ''; };
await AiService.summarizeTask(globalThis.__STATE.tasks.byId.t0);
check('요약 프롬프트에 주변 상황이 들어간다', captured.prompt.includes('[지금 이 업무의 주변 상황]'));
check('요약 규칙에 "마감일까지 끝내라는 말 금지"가 있다',
  captured.sys.includes('마감일까지 끝내라는 말은 절대 쓰지 마라'));
check('요약 규칙에 사역 진행 순서가 있다',
  captured.sys.includes('콘티 확정 → 악보·송폼 제작'));
check('요약 규칙에 팀 간 인수인계 지시가 있다',
  captured.sys.includes('넘겨주고 받아야'));
check('요약 규칙에 교회 달력이 있다',
  captured.sys.includes('[교회 일정의 기본 리듬]')
  && captured.sys.includes('주일 4부 청년 예배') && captured.sys.includes('금요 열정 예배'));
// 우리 교회에 없는 일정은 넣지 않는다 (수요 예배는 안 한다)
check('수요 예배는 달력에 없다', !captured.sys.includes('수요 예배'));
check('없는 절기를 지어내지 말라는 규칙이 있다', captured.sys.includes('지어내지 마라'));

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
  st.tasks.byId.t0.subtasks = [{ text: '곡 목록 확정', done: true }, { text: '키 확인', done: false }];
  const ctx2 = buildTaskContext(st.tasks.byId.t0);
  check('후행 업무(이 업무를 기다리는)가 실린다', ctx2.includes('이 업무를 기다리는 후행 업무: 악보·송폼 제작'), '');
  check('후행 연결이 있으면 날짜 짐작은 접는다', !ctx2.includes('마감 이후에 놓인 업무'));
  check('목록 줄에도 기다림 표가 붙는다', ctx2.includes('★이 업무를 기다림'));
  check('선행 업무가 실린다(악보 쪽에서 보면)', buildTaskContext(st.tasks.byId.t1).includes('선행 업무(먼저 끝나야 함): 찬양 콘티 결정(완료)'));
  check('첨부 이름이 실린다(행 객체·문자열 모두)', ctx2.includes('첨부 파일 2개: 콘티_시안2.pdf, 지난주_콘티.xlsx'));
  check('하위 업무 진척과 남은 것이 실린다', ctx2.includes('하위 업무 1/2 완료') && ctx2.includes('남은 것: 키 확인'));
  // 되돌려 놓는다 — 위쪽 검사들이 이 상태를 전제하지 않게
  delete st.tasks.byId.t1.dependsOn; st.tasks.byId.t0.attachments = []; delete st.tasks.byId.t0.subtasks;
}

console.log(results.join('\n'));
console.log('\n--- 실제로 만들어진 주변 상황 블록 ---\n' + ctx);
process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
