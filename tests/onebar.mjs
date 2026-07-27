// 폭에 맞는 내비 하나만 마운트되는지(알림 종 중복 구독 방지)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const PORT = 9465; const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cob-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id=0; const pend=new Map(); const evs=[];
ws.addEventListener('message', e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
const st={currentUser:{name:'노준석',team:'찬양팀'},projects:{byId:{p1:{id:'p1',title:'P',pinnedLinks:[]}},allIds:['p1']},tasks:{byId:{},allIds:[]}};
await send('Page.enable'); await send('Runtime.enable');
const probe = () => ev(`(() => ({
  topnav: [...document.querySelectorAll('div')].filter(d=>/hidden md:block/.test(d.className||'')&&d.querySelector('button[title="설정"]')).length,
  mobtop: [...document.querySelectorAll('div')].filter(d=>/md:hidden/.test(d.className)&&d.querySelector('button[title="검색"]')).length,
  tabbar: document.querySelectorAll('nav').length,
  searchBtns: document.querySelectorAll('button[title="검색"]').length,
  searchInputs: document.querySelectorAll('input[placeholder*="검색"]').length,
  profileBtns: document.querySelectorAll('button[title="설정"]').length,
}))()`);
for (const [w,h,mob,label] of [[1440,900,false,'데스크톱'],[390,844,true,'모바일']]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:mob});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Page.navigate',{url:URL_BASE+'/?p=p1'}); await wait('Page.loadEventFired'); await sleep(1300);
  const p = await probe();
  check(`${label}: 내비가 하나만 마운트`, (label==='데스크톱' ? p.mobtop===0 && p.tabbar===0 : p.topnav===0 && p.tabbar===1), JSON.stringify(p));
  check(`${label}: 검색 진입점 1개`, (p.searchBtns + p.searchInputs) === 1, `버튼 ${p.searchBtns} + 입력 ${p.searchInputs}`);
  check(`${label}: 설정 버튼 1개`, p.profileBtns === 1, `${p.profileBtns}개`);
}
// 폭을 바꿨을 때 반응하는지 (리사이즈)
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await sleep(700);
const after = await probe();
check('리사이즈로 데스크톱 내비로 전환', after.tabbar===0 && after.topnav>=1, JSON.stringify(after));
console.log(results.join('\n'));
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
