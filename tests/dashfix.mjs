// 도넛 숫자가 링 안에 있는지 / 모바일 KPI 한 줄 / 마감 임박 상태 표시
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const OUT = import.meta.dirname;
const PORT = 9498;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cdf-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page=await tg(); const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0;const pend=new Map();const evs=[];const logs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
 if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
 else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description).join(' '));
 else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const shot=async n=>{const{data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,n+'.png'),Buffer.from(data,'base64'));console.log('saved',n);};
const results=[];const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
const mk=(i,status,dd)=>({id:'t'+i,projectId:'p1',title:'업무 '+i,content:'',status,assignees:['노준석'],
  teams:['찬양팀'],startDate:'',dueDate:dd,position:i,author:'노준석',createdAt:'2026-07-01T00:00:00Z',
  updatedAt:'2026-07-01T00:00:00Z',comments:[],activityLog:[],attachments:[]});
const byId={},allIds=[];
[['시작 전','2026-07-28'],['진행 중','2026-07-30'],['보류 중','2026-07-29'],['완료','2026-07-27'],['시작 전','2026-07-20']]
  .forEach(([s,d],i)=>{const t=mk(i,s,d);byId[t.id]=t;allIds.push(t.id);});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
  projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]}},allIds:['p1']},tasks:{byId,allIds}};
await send('Page.enable');await send('Runtime.enable');
const load=async(m,theme)=>{
  await send('Emulation.setDeviceMetricsOverride',m);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE});await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','${theme}')`);
  await send('Page.navigate',{url:URL_BASE+'/'});await wait('Page.loadEventFired');await sleep(1500);
};
// 핸드오프 대시보드: 도넛 대신 진척도 막대, KPI 4칸(모바일 2×2 / 데스크톱 3+1),
// 마감 그룹 리스트의 각 행에 상태 배지(점 + 글자)
for (const [m,label,theme] of [[{width:390,height:844,deviceScaleFactor:2,mobile:true},'모바일','dark'],
                               [{width:1440,height:900,deviceScaleFactor:2,mobile:false},'데스크톱','light']]) {
  await load(m,theme);
  const kpi=await ev(`(() => {
    const vis=e=>e.getBoundingClientRect().width>0;
    // KPI 칸(.dc-kpi) 3개 + 진척도 칸. '지연/오늘 마감/이번 주'는 마감 그룹 제목에도
    // 쓰이므로 칸 안쪽으로 한정해서 센다.
    const cells=[...document.querySelectorAll('main .dc-kpi')].filter(vis);
    const progLabel=[...document.querySelectorAll('main span')]
      .find(s=>s.textContent.trim()==='전체 진척도' && vis(s));
    const progCell=progLabel?progLabel.parentElement.parentElement:null;
    const all=progCell?[...cells,progCell]:cells;
    const rows=all.map(t=>t.getBoundingClientRect().top).sort((a,b)=>a-b)
      .filter((t,i,a)=>i===0||t-a[i-1]>14).length;
    const num=progCell?[...progCell.querySelectorAll('span')].find(s=>/^[0-9]+%$/.test(s.textContent.trim())):null;
    const c=progCell?progCell.getBoundingClientRect():null, n=num?num.getBoundingClientRect():null;
    const nameOf=e=>{const s=[...e.querySelectorAll('span')].find(x=>/^(지연|오늘 마감|이번 주|전체 진척도)$/.test(x.textContent.trim()));
      return s?s.textContent.trim():'?';};
    return { count:all.length, rows, order:all.map(nameOf),
             pct: num?num.textContent.trim():null,
             pctInside: n&&c ? (n.left>=c.left-1&&n.right<=c.right+1&&n.top>=c.top-1&&n.bottom<=c.bottom+1) : null };
  })()`);
  check(`${label}: KPI 라벨 4개`, kpi.count===4, JSON.stringify(kpi.order));
  check(`${label}: 진척도가 마지막 칸`, kpi.order[3]==='전체 진척도', JSON.stringify(kpi.order));
  check(`${label}: 진척도 숫자가 칸 안에 있다`, kpi.pctInside===true, `${kpi.pct} / inside ${kpi.pctInside}`);
  check(`${label}: KPI가 ${m.mobile?'2줄(2×2)':'1줄'}`, kpi.rows===(m.mobile?2:1), `${kpi.rows}줄`);
  const soon=await ev(`(() => {
    const rows=[...document.querySelectorAll('main .dc-row')];
    return rows.map(r=>{
      const spans=[...r.querySelectorAll('span')];
      // 배지 껍데기도 textContent가 같으므로 자식 없는 안쪽 span만 고른다
      const st=spans.find(s=>!s.children.length && /^(시작 전|진행 중|보류 중|완료)$/.test(s.textContent.trim()));
      const dot=st?st.previousElementSibling:null;
      const d=dot?dot.getBoundingClientRect():null;
      return { title:r.textContent.slice(0,10), status:st?st.textContent.trim():null,
               dotPx:d?Math.round(d.width):0, visible: st? getComputedStyle(st).display!=='none':false };
    });
  })()`);
  check(`${label}: 마감 목록에 행이 있다`, soon.length>0, `${soon.length}행`);
  check(`${label}: 완료는 대시보드 마감 목록에서 빠진다`, !soon.some(r=>r.status==='완료'), JSON.stringify(soon.map(r=>r.status)));
  check(`${label}: 상태 글자가 보인다`, soon.every(r=>r.status && r.visible), JSON.stringify(soon.map(r=>r.status)));
  check(`${label}: 상태 점이 6px 이상`, soon.every(r=>r.dotPx>=6), JSON.stringify(soon.map(r=>r.dotPx)));
  const over=await ev(`(() => { const m=document.querySelector('main'); return Math.round(m.scrollWidth-m.clientWidth); })()`);
  check(`${label}: 가로 넘침 없음`, over<=0, `초과 ${over}px`);
  await shot(label==='모바일'?'fix-mob-dashboard':'fix-desk-dashboard');
}
console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,4).join('\n'):'\n콘솔 오류 없음');
ws.close();chrome.kill();process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
