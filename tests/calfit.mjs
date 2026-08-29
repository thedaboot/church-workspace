// 데스크톱 캘린더: 스크롤 없음 / 요일 헤더-칸 정렬 / 칸 높이에 맞춘 줄 수
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE=process.argv[2] || 'http://localhost:4173', CHROME=(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), PORT=9390;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const prof=mkdtempSync(join(tmpdir(),'cfit-'));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,'--no-first-run','about:blank'],{stdio:'ignore'});
async function tg(){for(let i=0;i<40;i++){try{const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('f');}
const page=await tg();const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
let id=0;const pend=new Map();const evs=[];const logs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description).join(' '));else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=25000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async(e,a=false)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const results=[];const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
const mk=(id,title,teams,s,e)=>({id,projectId:'p1',title,content:'x',status:'진행 중',assignees:['노준석'],teams,startDate:s,dueDate:e,position:0,author:'노준석',createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-01T00:00:00Z',comments:[],activityLog:[],attachments:[]});
const list=[mk('t1','슈링클스 제작',['미디어팀'],'2026-07-26','2026-07-26'),mk('t2','간식',['웰컴팀'],'2026-07-26','2026-07-26'),mk('t3','포스터',['워십팀'],'2026-07-26','2026-07-26'),mk('t4','버스',['찬양팀'],'2026-07-26','2026-07-26'),mk('t5','방배정',['교역자'],'2026-07-26','2026-07-26')];
const byId={};list.forEach(t=>{byId[t.id]=t;});
const st={currentUser:{name:'노준석',team:'임원진'},projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]}},allIds:['p1']},tasks:{byId,allIds:list.map(t=>t.id)}};
await send('Page.enable');await send('Runtime.enable');
const openCal = async () => {
  await send('Page.navigate',{url:URL_BASE});await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))})`);
  await send('Page.navigate',{url:URL_BASE+'/?p=p1'});await wait('Page.loadEventFired');await sleep(1200);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='캘린더').click()`);await sleep(1000);
};
// 주 단위 행 구조(핸드오프 리라이트 이후) 기준 — 헤더 7열 / 주 행 / 막대 레인
const probe = () => ev(`(() => {
  const main=document.querySelector('main');
  const head=[...main.querySelectorAll('.grid.grid-cols-7')][0];
  const weeks=[...main.querySelectorAll('div')].filter(d=>/flex-1 min-h-0 overflow-hidden/.test(d.className||''));
  const box=c=>c.getBoundingClientRect();
  const hd=[...head.children].map(c=>{const r=box(c);return Math.round(r.left+r.width/2);});
  // 첫 주의 배경 칸(절대 배치된 7칸)의 열 중심 — 요일 헤더와 1:1로 비교
  const bg=weeks[0]?[...weeks[0].querySelectorAll('.grid.grid-cols-7')][0]:null;
  const cols=bg?[...bg.children].map(c=>{const r=box(c);return Math.round(r.left+r.width/2);}):[];
  const dates=[...main.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>/^[0-9]{1,2}$/.test(t));
  const bars=[...main.querySelectorAll('button[title*="~"]')];
  const shell=main.querySelector('.dc-screen')||main.firstElementChild;
  const last=weeks[weeks.length-1];
  return {
    scrollY: Math.max(0, main.scrollHeight-main.clientHeight),
    headCenters: hd, cellCenters: cols,
    weekRows: weeks.length, dates: dates.length, bars: bars.length,
    weekH: last?Math.round(box(last).height):-1,
    // 마지막 주 행이 화면(main) 밖으로 밀려나지 않는지
    overflowsBottom: last?Math.round(box(last).bottom - box(main).bottom):999,
    // 주 행 안의 내용이 행 밖으로 넘치지 않는지(overflow:hidden으로 잘리는지)
    clipped: weeks.some(w=>w.scrollHeight - w.clientHeight > 1),
  };
})()`);
const at = async (h) => {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:h,deviceScaleFactor:1,mobile:false});
  await openCal();
  return probe();
};
const p1 = await at(900);
check('데스크톱 달력에 스크롤 없음', p1.scrollY <= 1, `스크롤 여유 ${p1.scrollY}px`);
const drift = p1.headCenters.map((c,i)=>Math.abs(c-p1.cellCenters[i]));
check('요일 헤더와 칸 정렬', p1.cellCenters.length===7 && Math.max(...drift) <= 1, `열 중심 차이 ${drift.join(',')}px`);
check('주 단위 행 5~6줄', p1.weekRows>=5 && p1.weekRows<=6, `${p1.weekRows}행`);
check('날짜 숫자가 전부 그려진다', p1.dates>=28, `${p1.dates}칸`);
check('마지막 주가 화면 밖으로 밀리지 않음', p1.overflowsBottom <= 1, `${p1.overflowsBottom}px 넘침`);
check('막대가 그려진다', p1.bars>=1, `${p1.bars}개`);

const p2 = await at(620);
check('낮은 창에서도 스크롤 없음', p2.scrollY <= 1, `스크롤 여유 ${p2.scrollY}px (주 행 ${p2.weekH}px)`);
const drift2 = p2.headCenters.map((c,i)=>Math.abs(c-p2.cellCenters[i]));
check('낮은 창에서도 헤더 정렬', p2.cellCenters.length===7 && Math.max(...drift2) <= 1, `열 중심 차이 ${drift2.join(',')}px`);
check('낮은 창에서도 마지막 주가 안 밀림', p2.overflowsBottom <= 1, `${p2.overflowsBottom}px`);

const p3 = await at(1200);
check('창이 커지면 주 행이 높아진다', p3.weekH > p2.weekH, `${p2.weekH}px(620) → ${p3.weekH}px(1200)`);
check('높은 창에서도 스크롤 없음', p3.scrollY <= 1, `스크롤 여유 ${p3.scrollY}px`);

// ── 데스크톱: 고른 날 목록이 달력 오른쪽 / 띠가 잘리지 않음 / 한 번에 날짜 선택 ──
await at(900);
const side = await ev(`(() => {
  const main=document.querySelector('main');
  const weeks=[...main.querySelectorAll('div')].filter(d=>/flex-1 min-h-0 overflow-hidden/.test(d.className||''));
  const grid=weeks[0].parentElement;
  const head=[...main.querySelectorAll('h4')].find(h=>/[0-9]+월 [0-9]+일/.test(h.textContent));
  const list=head?head.closest('div').parentElement:null;
  const g=grid.getBoundingClientRect(), l=list?list.getBoundingClientRect():null;
  // 띠가 자기 주 줄 밖으로 잘리는지
  const clipped=[...main.querySelectorAll('button[title*="~"]')].filter(b=>{
    const w=b.closest('div[class*="overflow-hidden"]'); if(!w) return false;
    const br=b.getBoundingClientRect(), wr=w.getBoundingClientRect();
    return br.bottom > wr.bottom + 0.5 || br.top < wr.top - 0.5;
  }).length;
  return { gridRight:Math.round(g.right), listLeft:l?Math.round(l.left):null,
           listWidth:l?Math.round(l.width):null, sameRow: l? Math.abs(l.top-g.top)<80 : false,
           bars:[...main.querySelectorAll('button[title*="~"]')].length, clipped,
           empty:/해당 날짜에는 업무가 없어요|[0-9]+건/.test(main.textContent) };
})()`);
check('고른 날 목록이 달력 오른쪽에 있다', side.listLeft !== null && side.listLeft >= side.gridRight - 1, JSON.stringify(side));
check('목록 폭 300px', side.listWidth === 300, `${side.listWidth}px`);
check('띠가 주 줄 밖으로 잘리지 않는다', side.clipped === 0, `${side.clipped}개 잘림 / 띠 ${side.bars}개`);

// 날짜 칸 아래쪽(띠 레인 영역)을 한 번 눌러도 바로 선택이 바뀌는지
const before = await ev(`[...document.querySelectorAll('main h4')].find(h=>/[0-9]+월 [0-9]+일/.test(h.textContent)).textContent.trim()`);
// 고정 좌표(둘째 주 수요일)로 누르면 **오늘이 하필 그 칸인 날** 선택이 안 바뀌어서
// 검사가 스스로 실패한다(2026-08-05에 실제로 그랬다 — §6-42와 같은 시간 함정).
// 지금 선택된 날짜가 아닌 칸을 골라서 누른다.
const clicked = await ev(`(() => {
  const main=document.querySelector('main');
  // 목록 제목은 '8월 5일', 칸의 aria-label은 '8. 5.' 꼴이다 → 숫자만 뽑아 견준다
  const norm = (s) => ((s||'').match(/[0-9]+/g)||[]).slice(0,2).join('-');
  const now=norm([...main.querySelectorAll('h4')].find(h=>/[0-9]+월 [0-9]+일/.test(h.textContent))?.textContent);
  const cells=[...main.querySelectorAll('button[aria-label]')]
    .filter(b=>/^[0-9]+[.] [0-9]+[.]$/.test((b.getAttribute('aria-label')||'').trim()));
  // 선택된 날이 아닌 칸 중, 아래쪽 1/4 지점이 자기 자신에게 닿는 첫 칸
  // (띠 레인이 클릭을 먹지 않는지도 같이 보는 검사다 — §6-14)
  for (const b of cells) {
    if (norm(b.getAttribute('aria-label')) === now) continue;
    const r=b.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    const x=Math.round(r.left + r.width/2), y=Math.round(r.bottom - r.height*0.2);
    const el=document.elementFromPoint(x,y);
    if (el && el.tagName==='BUTTON' && el.getAttribute('aria-label'))
      return { tag:el.tagName, isCellBtn:true, x, y, label:b.getAttribute('aria-label') };
  }
  return { tag:null, isCellBtn:false, x:0, y:0, cells:cells.length };
})()`);
check('칸 아래쪽도 날짜 버튼이 받는다(한 번에 선택)', clicked.isCellBtn === true, JSON.stringify(clicked));
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:clicked.x,y:clicked.y,button:'left',clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:clicked.x,y:clicked.y,button:'left',clickCount:1});
await sleep(350);
const after = await ev(`[...document.querySelectorAll('main h4')].find(h=>/[0-9]+월 [0-9]+일/.test(h.textContent)).textContent.trim()`);
check('한 번 클릭으로 목록 날짜가 바뀐다', after !== before, `${before} → ${after}`);
const emptyWord = await ev(`(() => { const t=document.querySelector('main').textContent;
  return { neu:/해당 날짜에는 업무가 없어요/.test(t), old:/이날은 잡힌 일이 없어요/.test(t) }; })()`);
check("빈 날 문구가 '해당 날짜에는 업무가 없어요'", emptyWord.old === false, JSON.stringify(emptyWord));

// ── 모바일: 달력 격자와 아래 목록이 같은 스크롤 통에 있으면 안 된다 ──
// 한 통에 두면 목록을 읽으려고 미는 순간 달력이 위로 밀려 첫 주 줄이 잘린다
// (사용자 스크린샷). 되돌리기 검사: MobileCalendar 격자의 shrink-0을 빼고
// 목록의 스크롤 통을 없애면 아래 두 단정이 바로 깨진다.
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await sleep(800);
const mob = await ev(`(() => {
  const main=document.querySelector('main');
  const grid=[...main.querySelectorAll('div')].find(d=>/grid-cols-7/.test(d.className||'') && d.children.length>=35);
  if (!grid) return { found:false };
  const gr=grid.getBoundingClientRect();
  let sc=grid.parentElement, scroller=null;
  while (sc && sc!==document.body) {
    if (/auto|scroll/.test(getComputedStyle(sc).overflowY)) { scroller=sc; break; }
    sc=sc.parentElement;
  }
  return {
    found:true,
    // 격자를 품은 스크롤 통이 넘치면, 목록을 밀 때 격자가 같이 밀려 올라간다
    gridScrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : false,
    gridBottom: Math.round(gr.bottom),
    rows: grid.children.length / 7,
  };
})()`);
check('모바일 달력 격자를 찾는다', mob.found === true, JSON.stringify(mob));
check('격자가 스크롤 통 안에서 넘치지 않는다', mob.found && mob.gridScrolls === false, JSON.stringify(mob));
check('격자 아래쪽이 화면 안에 있다', mob.found && mob.gridBottom <= 844, JSON.stringify(mob));
// 아래 목록은 위아래로만 민다 — 줄이 -mx-2로 좌우를 넘치게 그려서 가로 스크롤이 생겼다
const daySc = await ev(`(() => {
  const h=[...document.querySelectorAll('main h4')].find(x=>/[0-9]+월 [0-9]+일/.test(x.textContent));
  if (!h) return { found:false };
  let el=h.parentElement;
  while (el && el!==document.body) {
    const st=getComputedStyle(el);
    if (/auto|scroll/.test(st.overflowY)) break;
    el=el.parentElement;
  }
  if (!el || el===document.body) return { found:false };
  return { found:true, xScroll: el.scrollWidth > el.clientWidth + 1,
           overflowX: getComputedStyle(el).overflowX };
})()`);
check('고른 날 목록의 스크롤 통을 찾는다', daySc.found === true, JSON.stringify(daySc));
check('목록이 좌우로 밀리지 않는다', daySc.found && daySc.xScroll === false, JSON.stringify(daySc));
await send('Emulation.clearDeviceMetricsOverride');


// ── 격자선이 고르게 그려지는가 (2026-08-29) ────────────────────────────────
// grid-cols-7 + gap:1px으로 두면 열 폭이 소수가 되고(164.703 · 164.719 …), 1px 선이
// 장치 픽셀 두 개에 걸쳐 번진다. 걸치는 비율이 선마다 달라서 **어떤 선만 굵어 보였다**
// — 실측 소수부가 .703 .422 .141 .844 .563 .281이었고, 0.5에 가장 가까운 두 선
// (월|화 · 목|금)이 정확히 사용자가 짚은 자리였다.
// 고쳐야 할 것은 선명함이 아니라 **들쭉날쭉함**이다 — 여섯 선의 소수부가 같으면 된다.
const lineSpread = () => ev(`(() => {
  const main = document.querySelector('main');
  const bg = [...main.querySelectorAll('.grid.grid-cols-7')].find(g => g.children.length === 7 && g.closest('.absolute'));
  if (!bg) return null;
  const cells = [...bg.children].map(c => c.getBoundingClientRect());
  const d = window.devicePixelRatio;
  const frac = [];
  for (let i = 0; i < 6; i++) {
    const dev = cells[i].right * d;
    frac.push(dev - Math.floor(dev));
  }
  return { dpr: d, frac: frac.map(f => +f.toFixed(3)), spread: +(Math.max(...frac) - Math.min(...frac)).toFixed(3) };
})()`);

// 배율마다 **새로 그린다** — CDP의 배율 변경만으로는 matchMedia(resolution)가 울리지
// 않아서 앱이 열 폭을 다시 재지 못한다(실제 브라우저에서는 울린다). 여기서 재려는 것은
// 그 구독이 아니라 "그 배율에서 격자가 고른가"다.
for (const dpr of [1, 1.25, 2]) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1513, height: 900, deviceScaleFactor: dpr, mobile: false });
  await openCal();
  const g = await lineSpread();
  // 0.25는 넉넉한 선이다 — 고치기 전 실측이 0.72였고 고친 뒤가 0.05 미만이다.
  // 레이아웃 단위(1/64px) 양자화 때문에 0은 될 수 없다.
  check(`격자선이 고르다 (dpr ${dpr})`, !!g && g.spread <= 0.25, JSON.stringify(g));
}

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.join('\n'):'\n콘솔 오류 없음');
ws.close();chrome.kill();process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
