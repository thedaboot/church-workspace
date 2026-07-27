// 공유·삭제가 데스크톱/모바일 양쪽에서 실제로 동작하는지
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const PORT = 9505;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'csh-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id=0; const pend=new Map(); const evs=[]; const logs=[];
ws.addEventListener('message', e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description).join(' '));
  else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async(e,a=false)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const mk=(i)=>({id:'t'+i,projectId:'p1',title:'업무 '+i,content:'',status:'시작 전',assignees:['노준석'],
  teams:['찬양팀'],startDate:'',dueDate:'2026-08-0'+(i+1),position:i,author:'노준석',
  createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-01T00:00:00Z',comments:[],activityLog:[],attachments:[]});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀']},
  projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]},p2:{id:'p2',title:'가을 축제',pinnedLinks:[]}},allIds:['p1','p2']},
  tasks:{byId:{t0:mk(0),t1:mk(1)},allIds:['t0','t1']}};

// navigator.share / clipboard 를 가로채 호출 여부를 기록
const STUB = `(() => {
  window.__shared = []; window.__copied = [];
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true,
    value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  } catch {}
  return true;
})()`;

await send('Page.enable'); await send('Runtime.enable');
const load = async (metrics) => {
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!metrics.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
  await send('Page.navigate',{url:URL_BASE+'/?p=p1'}); await wait('Page.loadEventFired'); await sleep(1400);
  await ev(STUB);
};
const findShare = `[...document.querySelectorAll('button')].filter(b=>/공유/.test(b.title||'')).filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0;})`;

// ── 데스크톱 ──
await load({width:1440,height:900,deviceScaleFactor:1,mobile:false});
let n = await ev(`${findShare}.length`);
check('데스크톱: 프로젝트 공유 버튼이 보인다', n === 1, `${n}개`);
await ev(`${findShare}[0].click()`);
await sleep(500);
let r = await ev(`({shared:window.__shared, copied:window.__copied})`);
check('데스크톱: 공유가 실제로 실행된다', (r.shared.length + r.copied.length) === 1, JSON.stringify(r));
check('데스크톱: 링크만 보낸다(제목 없이)', r.shared.length ? (Object.keys(r.shared[0]).join()==='url' && /\/s\/p\/p1$/.test(r.shared[0].url)) : /\/s\/p\/p1$/.test(r.copied[0]), JSON.stringify(r));

// 업무 상세의 공유도
await ev(`document.querySelector('.board-card').click()`); await sleep(800);
await ev(`window.__shared=[];window.__copied=[];`);
// 모달 뒤의 프로젝트 공유 버튼도 DOM에 남아 있으니 모달 안쪽만 고른다
const modalShare = `[...document.querySelector('.fixed.inset-0.z-50').querySelectorAll('button')].filter(b=>/공유/.test(b.title||''))`;
n = await ev(`${modalShare}.length`);
check('데스크톱: 업무 상세에도 공유 버튼', n >= 1, `${n}개`);
await ev(`${modalShare}[0].click()`); await sleep(500);
r = await ev(`({shared:window.__shared, copied:window.__copied})`);
check(`데스크톱: 업무 공유 실행 + 업무 링크`, (r.shared.length+r.copied.length)===1 && /[/]s[/]t[/]/.test((r.shared[0]?.url)||r.copied[0]||''), JSON.stringify(r));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(400);

// ── 모바일: 공유가 메타 줄에 그대로 보인다(⋯ 메뉴는 없앴다) ──
await load({width:390,height:844,deviceScaleFactor:2,mobile:true});
n = await ev(`${findShare}.length`);
check('모바일: 공유 버튼이 숨지 않고 바로 보인다', n === 1, `${n}개`);
await ev(`${findShare}[0].click()`); await sleep(600);
r = await ev(`({shared:window.__shared, copied:window.__copied})`);
check('모바일: 공유가 실제로 실행된다', (r.shared.length+r.copied.length) === 1, JSON.stringify(r));

// ── 모바일: 삭제 확인창 ──
await load({width:390,height:844,deviceScaleFactor:2,mobile:true});
const delBtn = `[...document.querySelectorAll('button')].find(b=>/프로젝트 삭제/.test(b.title||''))`;
check('모바일: 삭제 버튼도 바로 보인다', (await ev(`!!${delBtn}`)) === true);
await ev(`${delBtn}.click()`); await sleep(500);
const confirmVisible = await ev(`(() => {
  const btns=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='삭제');
  return btns.filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0;}).length;
})()`);
check('모바일: 삭제 확인창이 뜬다', confirmVisible >= 1, `${confirmVisible}개`);
const stillProjects = await ev(`JSON.parse(localStorage.getItem('church_app_v4')).projects.allIds.length`);
check('확인 전에는 프로젝트가 지워지지 않는다', stillProjects === 2, `${stillProjects}개`);

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,4).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(x=>x.startsWith('FAIL'))?1:0);
