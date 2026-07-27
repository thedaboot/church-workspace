// 11차 수정 검증 — 설정 헤더 이동 / 팀 탭 / 완료 분류·확인 / 모바일 하단 여백 / 문구 / 빈 칸 표식
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const OUT = import.meta.dirname;
const PORT = 9537;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cb11-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id=0; const pend=new Map(); const evs=[]; const logs=[];
ws.addEventListener('message', e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description).join(' '));
  else if(m.method==='Runtime.exceptionThrown')logs.push('THROWN '+(m.params.exceptionDetails.exception?.description||''));
  else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async(e,a=false)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const shot=async n=>{const{data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(OUT,n+'.png'),Buffer.from(data,'base64'));};
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const D=(off)=>{const d=new Date();d.setDate(d.getDate()+off);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const T=[
 ['찬양 콘티 확정',['찬양팀'],'완료',D(-14),D(-8),['노준석']],        // 완료 + 마감 지남 → '지연'이면 안 됨
 ['악보·송폼 제작',['찬양팀'],'진행 중',D(-3),D(-2),['노준석']],       // 지연
 ['오늘 마감 건',['미디어팀'],'진행 중','',D(0),['노준석']],
 ['이번 주 건',['웰컴팀'],'시작 전','',D(3),['노준석']],
 ['마감 없는 건',['임원진'],'시작 전','','',['노준석']],
];
const byId={},allIds=[];
T.forEach(([title,teams,status,sd,dd,as],i)=>{const id='t'+i;
 byId[id]={id,projectId:'p1',title,content:'내용',status,assignees:as,teams,startDate:sd,dueDate:dd,position:i,
  author:'노준석',createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-20T00:00:00Z',comments:[],activityLog:[],attachments:[]};
 allIds.push(id);});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
 projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]},
                 p2:{id:'p2',title:'가을 축제',pinnedLinks:[]}},allIds:['p1','p2']},
 tasks:{byId,allIds}};

const DESK={width:1440,height:900,deviceScaleFactor:1,mobile:false};
const MOB={width:390,height:844,deviceScaleFactor:2,mobile:true};
await send('Page.enable'); await send('Runtime.enable');
const load=async(m,path='/')=>{
  await send('Emulation.setDeviceMetricsOverride',m);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
  await send('Page.navigate',{url:URL_BASE+path}); await wait('Page.loadEventFired'); await sleep(1600);
};
const clickText=t=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})?.click()`;

// ── 1·2. 모바일: 설정은 헤더, 하단 탭은 프로젝트·내 업무·대시보드·팀 ──
await load(MOB);
const nav = await ev(`(() => {
  const bar=document.querySelector('nav');
  const tabs=[...bar.querySelectorAll('button')].map(b=>b.textContent.trim());
  const head=document.querySelector('div.md\\\\:hidden');
  const headBtns=[...head.querySelectorAll('button')].map(b=>b.getAttribute('title')||b.textContent.trim());
  return { tabs, headBtns, tabHasSettings: tabs.includes('설정'),
           barH: bar.getBoundingClientRect().height,
           mainPB: parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom) };
})()`);
check('모바일 하단 탭 = 프로젝트·내 업무·대시보드·팀', JSON.stringify(nav.tabs.map(t=>t.replace(/[0-9]/g,'')))===JSON.stringify(['프로젝트','내 업무','대시보드','팀']), JSON.stringify(nav.tabs));
check('모바일 하단 탭에 설정이 없다', nav.tabHasSettings===false);
check('모바일 헤더에 설정 버튼이 있다', nav.headBtns.includes('설정'), JSON.stringify(nav.headBtns));
check('모바일 본문 아래 여백 > 탭바 높이', nav.mainPB > nav.barH, `pb ${nav.mainPB}px > 탭바 ${Math.round(nav.barH)}px`);

// 헤더 설정을 눌러 팝오버가 화면 안에 뜨는지
await ev(`document.querySelector('div.md\\\\:hidden button[title="설정"]').click()`);
await sleep(350);
const pop = await ev(`(() => {
  const p=[...document.body.querySelectorAll('div')].find(d=>getComputedStyle(d).position==='fixed'&&/설정/.test(d.textContent)&&d.getBoundingClientRect().width===224);
  if(!p) return null; const r=p.getBoundingClientRect();
  return { top:Math.round(r.top), left:Math.round(r.left), inView: r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth };
})()`);
check('설정 팝오버가 헤더 아래·화면 안에 뜬다', pop?.inView===true && pop.top<200, JSON.stringify(pop));
await ev(`document.body.click()`); await sleep(200);

// 팀 탭 → 팀 보드
await ev(`[...document.querySelector('nav').querySelectorAll('button')].find(b=>b.textContent.trim()==='팀').click()`);
await sleep(700);
check('팀 탭이 내 팀 보드를 연다', /찬양팀/.test(await ev(`document.querySelector('main h2').textContent`)), await ev(`document.querySelector('main h2').textContent.trim()`));
await shot('b11-mob-team');

// ── 3·4·5. 내 업무: 완료 분류와 확인 ──
await load(DESK);
await ev(clickText('내 업무 4')); await sleep(300);
await ev(`[...document.querySelectorAll('button')].find(b=>/^내 업무/.test(b.textContent.trim()))?.click()`);
await sleep(700);
// 완료 칩만 켠다
await ev(clickText('완료')); await sleep(500);
const doneView = await ev(`(() => {
  const heads=[...document.querySelectorAll('main div')].map(d=>d.firstElementChild)
    .filter(Boolean).map(e=>e.textContent.trim());
  const txt=document.querySelector('main').textContent;
  return { hasDoneGroup:/끝낸 업무/.test(txt), hasOverdueGroup:/지연/.test(txt),
           title:/찬양 콘티 확정/.test(txt),
           revert: !!document.querySelector('[title="완료 취소"]') };
})()`);
check('완료 건이 지연으로 분류되지 않는다', doneView.hasDoneGroup===true && doneView.hasOverdueGroup===false, JSON.stringify(doneView));
check('완료 건에 되돌리기 버튼이 붙는다', doneView.revert===true);

// 되돌리기 → 실제 저장
await ev(`document.querySelector('[title="완료 취소"]').click()`); await sleep(300);
await ev(clickText('되돌리기')); await sleep(800);
const reverted = await ev(`JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.t0.status`);
check('되돌리기가 상태를 진행 중으로 저장한다', reverted==='진행 중', reverted);

// 완료 버튼: 확인 없이는 바뀌지 않는다
await load(DESK);
await ev(`document.querySelector('[title="완료로 옮기기"]').click()`); await sleep(350);
const hasConfirm = await ev(`[...document.body.querySelectorAll('div')].some(d=>getComputedStyle(d).position==='fixed'&&/완료로 옮길까요/.test(d.textContent))`);
check('완료 버튼이 확인을 한 번 받는다', hasConfirm===true);
await ev(clickText('취소')); await sleep(500);
const stillOpen = await ev(`Object.values(JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId).filter(t=>t.status==='완료').length`);
check('취소하면 상태가 그대로다', stillOpen===1, `완료 ${stillOpen}건`);
await ev(`document.querySelector('[title="완료로 옮기기"]').click()`); await sleep(300);
await ev(`[...document.body.querySelectorAll('button')].filter(b=>b.textContent.trim()==='완료').pop().click()`); await sleep(800);
const nowDone = await ev(`Object.values(JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId).filter(t=>t.status==='완료').length`);
check('확인하면 완료로 저장된다', nowDone===2, `완료 ${nowDone}건`);

// ── 7·8·10. 문구 ──
await load(DESK, '/?p=p1');
const words = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  return { refLink:/\\+ 참고 링크/.test(txt), oldLink:/\\+ 링크(?! 추가)/.test(txt.replace('+ 참고 링크','')) };
})()`);
check('프로젝트 헤더 버튼이 "+ 참고 링크"', words.refLink===true, JSON.stringify(words));
await load(DESK);
const dash = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  return { noDueOld:/마감 없음/.test(txt), noDueNew:/마감 미정/.test(txt),
           overdueNote:/전부 기한 안/.test(txt), oldNote:/지연[\\s\\S]{0,20}없어요/.test(txt) };
})()`);
check("'마감 없음' 표현이 사라졌다", dash.noDueOld===false, JSON.stringify(dash));

// 지연 0건 상태로 만들어 KPI 문구 확인
await ev(`(() => { const s=JSON.parse(localStorage.getItem('church_app_v4'));
  s.tasks.byId.t1.dueDate='${D(5)}'; localStorage.setItem('church_app_v4',JSON.stringify(s)); })()`);
await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired'); await sleep(1500);
const zero = await ev(`(() => { const t=document.querySelector('main').textContent;
  return { note:/전부 기한 안/.test(t), old:/없어요/.test(t.slice(0, t.indexOf('오늘 마감'))) }; })()`);
check("지연 0건 문구가 '전부 기한 안'", zero.note===true && zero.old===false, JSON.stringify(zero));

// ── 9. 빈 칸 표식 ──
await load(DESK, '/?p=p2');
const empty = await ev(`(() => {
  const cols=[...document.querySelectorAll('main h3')].map(h=>h.parentElement.parentElement);
  const svgs=cols.filter(c=>c.querySelector('svg path[pathLength="1"]')).length;
  return { cols:cols.length, svgs, txt:/아직 업무가 없어요/.test(document.querySelector('main').textContent) };
})()`);
check('빈 컬럼에 선으로 그려지는 표식', empty.svgs>=4 && empty.txt===true, JSON.stringify(empty));
await shot('b11-empty-columns');

// ── 마감 그룹 리스트 빈 상태(로티 대체 마크) ──
await load(MOB);
await ev(`[...document.querySelector('nav').querySelectorAll('button')].find(b=>/내 업무/.test(b.textContent)).click()`);
await sleep(600);
await ev(clickText('보류 중')); await sleep(500);
const allClear = await ev(`(() => {
  const p=[...document.querySelectorAll('main p')].find(e=>/다 정리되었어요/.test(e.textContent));
  if(!p) return null;
  const wrap=p.parentElement;                       // 빈 상태 컨테이너
  const r=wrap.getBoundingClientRect();
  const svg=wrap.querySelector('svg').getBoundingClientRect();
  const last=wrap.lastElementChild.getBoundingClientRect();
  const top=svg.top-r.top, bottom=r.bottom-last.bottom;
  return { mark:!!wrap.querySelector('svg circle'), centered: Math.abs(top-bottom) < 24,
           h:Math.round(r.height), top:Math.round(top), bottom:Math.round(bottom) };
})()`);
check('빈 마감 목록에 체크 마크가 그려진다', allClear?.mark === true, JSON.stringify(allClear));
check('빈 화면 마크가 남는 공간 가운데', allClear?.centered === true, JSON.stringify(allClear));
const words2 = await ev(`(() => { const t=document.querySelector('main').textContent;
  return { neu:/다 정리되었어요/.test(t), old:/다 정리됐어요/.test(t) }; })()`);
check("'다 정리되었어요' 문구", words2.neu===true && words2.old===false, JSON.stringify(words2));
await shot('b11-mob-empty-list');

console.log(results.join('\n'));
const real = logs.filter(l=>!/favicon|Failed to load resource|manifest/i.test(l));
console.log(real.length ? '\n콘솔 오류:\n' + real.slice(0,5).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill();
process.exit(results.some(r=>r.startsWith('FAIL')) || real.length ? 1 : 0);
