// 모바일: 각 탭에서 끝까지 스크롤했을 때 마지막 내용이 하단 탭바에 가리는지
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4173';
const OUT = import.meta.dirname;
const PORT = 9561;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cbg-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id=0; const pend=new Map(); const evs=[];
ws.addEventListener('message', e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
  else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)return{__err:r.exceptionDetails.exception?.description};return r.result.value;};
const shot=async n=>{const{data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,n+'.png'),Buffer.from(data,'base64'));};

// 팀·업무를 넉넉히 만들어 내용이 화면을 넘치게 한다
const TEAMS=['찬양팀','워십팀','엔지니어팀','미디어팀','웰컴팀','임원진','교역자'];
const byId={},allIds=[];
for (let i=0;i<24;i++){ const id='t'+i;
  byId[id]={id,projectId:i%2?'p1':'p2',title:'업무 '+i,content:'x',status:['시작 전','진행 중','보류 중','완료'][i%4],
    assignees:['노준석'],teams:[TEAMS[i%7]],startDate:'',dueDate:`2026-08-${String(i%28+1).padStart(2,'0')}`,
    position:i,author:'노준석',createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-01T00:00:00Z',comments:[],activityLog:[],attachments:[]};
  allIds.push(id); }
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
  projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]},p2:{id:'p2',title:'가을 전도 축제',pinnedLinks:[]}},allIds:['p1','p2']},
  tasks:{byId,allIds}};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
await send('Page.navigate',{url:URL_BASE+'/'}); await wait('Page.loadEventFired'); await sleep(1600);

const probe = `(() => {
  const main=document.querySelector('main');
  const nav=document.querySelector('nav');
  const navTop=nav?nav.getBoundingClientRect().top:innerHeight;
  const cs=getComputedStyle(main);
  // 화면에 그려진 '내용' 중 가장 아래에 있는 것
  // 조상의 overflow에 잘려서 화면에 안 보이는 것은 제외한다
  const visibleBottom=(el)=>{
    let b=el.getBoundingClientRect().bottom;
    for(let p=el.parentElement; p && p!==document.body; p=p.parentElement){
      const cs=getComputedStyle(p);
      if(cs.overflowY!=='visible'||cs.overflowX!=='visible'){
        b=Math.min(b, p.getBoundingClientRect().bottom);
      }
    }
    return b;
  };
  let lowest=null, lowestBottom=-1;
  main.querySelectorAll('*').forEach(el=>{
    if(!el.textContent.trim() && !el.querySelector('svg')) return;
    const r=el.getBoundingClientRect();
    if(r.height===0||r.width===0) return;
    if(el.children.length) return;                 // 잎 노드만
    const vb=visibleBottom(el);
    if(vb < r.top) return;                         // 완전히 잘려 안 보임
    if(vb>lowestBottom){ lowestBottom=vb; lowest=el; }
  });
  return { scrollTop:Math.round(main.scrollTop), max:Math.round(main.scrollHeight-main.clientHeight),
    padB:cs.paddingBottom, navTop:Math.round(navTop),
    lowestText:(lowest?lowest.textContent.trim():'').slice(0,18),
    lowestBottom:Math.round(lowestBottom),
    gap:Math.round(navTop-lowestBottom) };   // 양수 = 탭바 위에 여백 있음
})()`;

const tabs = [
  ['대시보드', `[...document.querySelector('nav').querySelectorAll('button')].find(b=>/대시보드/.test(b.textContent)).click()`],
  ['내 업무', `[...document.querySelector('nav').querySelectorAll('button')].find(b=>/내 업무/.test(b.textContent)).click()`],
  ['팀', `[...document.querySelector('nav').querySelectorAll('button')].find(b=>b.textContent.trim()==='팀').click()`],
  ['프로젝트', `[...document.querySelector('nav').querySelectorAll('button')].find(b=>/프로젝트/.test(b.textContent)).click()`],
];
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
for (const [name, click] of tabs) {
  await ev(click); await sleep(900);
  await ev(`document.querySelector('main').scrollTop = 99999`); await sleep(600);
  const r = await ev(probe);
  // gap = 하단 탭바 위쪽과 마지막으로 보이는 내용 사이 여백. 음수면 탭바에 가린다.
  check(`${name}: 마지막 내용이 탭바에 가리지 않는다`, r.gap >= 8, `여백 ${r.gap}px (마지막: ${r.lowestText})`);
  if (process.env.SHOTS) await shot('bg-' + name);
}
console.log(results.join('\n'));
ws.close(); chrome.kill();
process.exit(results.some(r=>r.startsWith('FAIL')) ? 1 : 0);
