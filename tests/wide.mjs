// KPI 4칸이 좁은 폭에서도 한 줄로 버티는지 (320px까지)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE=process.argv[2] || 'http://localhost:4173';
const PORT=9502; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const prof=mkdtempSync(join(tmpdir(),'cw-'));
const chrome=spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'),['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,'--no-first-run','about:blank'],{stdio:'ignore'});
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page=await tg();const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const pend=new Map();const evs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const results=[];const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
const mk=(i,s,d)=>({id:'t'+i,projectId:'p1',title:'수련회 홍보용 기도카드 제작',content:'',status:s,assignees:['노준석'],teams:['찬양팀'],startDate:'',dueDate:d,position:i,author:'노준석',createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-01T00:00:00Z',comments:[],activityLog:[],attachments:[]});
const byId={},allIds=[];[['시작 전','2026-07-28'],['진행 중','2026-07-30'],['시작 전','2026-07-20']].forEach(([s,d],i)=>{const t=mk(i,s,d);byId[t.id]=t;allIds.push(t.id);});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]}},allIds:['p1']},tasks:{byId,allIds}};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:URL_BASE});await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
await send('Page.navigate',{url:URL_BASE});await wait('Page.loadEventFired');await sleep(1500);
for (const w of [320,360,390,430,768,1024,1280,1920]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<768});
  await sleep(450);
  // 핸드오프: KPI는 lg(1024) 이상에서 한 줄(3칸+진척도), 그 아래에서는 2×2
  const r = await ev(`(() => {
    const vis=e=>e.getBoundingClientRect().width>0;
    const cells=[...document.querySelectorAll('main .dc-kpi')].filter(vis);
    const progLabel=[...document.querySelectorAll('main span')]
      .find(s=>s.textContent.trim()==='전체 진척도' && vis(s));
    const progCell=progLabel?progLabel.parentElement.parentElement:null;
    const all=progCell?[...cells,progCell]:cells;
    const tops=all.map(c=>c.getBoundingClientRect().top).sort((a,b)=>a-b);
    const rows=tops.filter((t,i)=>i===0||t-tops[i-1]>14).length;
    // 라벨·숫자가 칸을 넘치는지
    const clipped=all.filter(c=>[...c.querySelectorAll('span')].some(s=>{
      const sr=s.getBoundingClientRect(), cb=c.getBoundingClientRect();
      return sr.width>0 && (sr.right>cb.right+1 || sr.left<cb.left-1);
    })).length;
    const main=document.querySelector('main');
    return { count: all.length, rows, colW: Math.round(all[0].getBoundingClientRect().width), clipped,
             pageOverflow: Math.round(main.scrollWidth-main.clientWidth) };
  })()`);
  const want = w >= 1024 ? 1 : 2;
  check(`${w}px: KPI 4칸이 ${want}줄`, r.count===4 && r.rows===want, `${r.count}칸 / ${r.rows}줄 / 칸폭 ${r.colW}px`);
  check(`${w}px: 라벨·숫자가 칸을 넘지 않음`, r.clipped===0, `${r.clipped}칸 넘침`);
  check(`${w}px: 가로 스크롤 없음`, r.pageOverflow<=0, `초과 ${r.pageOverflow}px`);
}
console.log(results.join('\n'));
ws.close();chrome.kill();process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
