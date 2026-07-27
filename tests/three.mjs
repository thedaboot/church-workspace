// 1) 프로젝트명 수정  2) 모바일 가로줄이 세로로 안 흔들림  3) 모바일 컬럼 구분
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const OUT = import.meta.dirname;
const PORT = 9471;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'c3-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
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
const shot=async n=>{const{data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,n+'.png'),Buffer.from(data,'base64'));};
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const task = (i, status) => ({ id:'t'+i, projectId:'p1', title:'업무 '+i, content:'', status,
  assignees:['노준석'], teams:['찬양팀'], startDate:'', dueDate:'2026-08-0'+(i+1), position:i, author:'노준석',
  createdAt:'2026-07-01T00:00:00Z', updatedAt:'2026-07-01T00:00:00Z', comments:[], activityLog:[], attachments:[] });
// 시작 전 2개, 진행 중 1개, 보류 중 0개(빈 컬럼 확인), 완료 1개
const st = {
  currentUser:{name:'노준석',team:'찬양팀'},
  projects:{byId:{
    p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]},
    p2:{id:'p2',title:'새신자 초청 주일',pinnedLinks:[]},
    p3:{id:'p3',title:'가을 전도 축제',pinnedLinks:[]},
    p4:{id:'p4',title:'성탄 칸타타',pinnedLinks:[]},
    p5:{id:'p5',title:'전교인 체육대회',pinnedLinks:[]},
  },allIds:['p1','p2','p3','p4','p5']},
  // 시작 전은 카드 목록이 세로로 스크롤될 만큼 넉넉히, 보류 중은 0개(빈 컬럼 확인용)
  tasks:(() => {
    const byId={}, allIds=[];
    for (let i=0;i<10;i++){ const t=task(i,'시작 전'); byId[t.id]=t; allIds.push(t.id); }
    [['t20','진행 중'],['t21','완료']].forEach(([id,s],k)=>{ const t=task(20+k,s); t.id=id; byId[id]=t; allIds.push(id); });
    return { byId, allIds };
  })(),
};
const START_COUNT = 10;

const MOB={width:390,height:844,deviceScaleFactor:2,mobile:true};
const DESK={width:1440,height:900,deviceScaleFactor:1,mobile:false};
await send('Page.enable'); await send('Runtime.enable');
const load = async (metrics, path='/?p=p1') => {
  await send('Emulation.setDeviceMetricsOverride', metrics);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!metrics.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','light')`);
  await send('Page.navigate',{url:URL_BASE+path}); await wait('Page.loadEventFired'); await sleep(1400);
};

// ── 1) 프로젝트명 수정 (데스크톱: 제목 클릭) ──
await load(DESK);
await ev(`document.querySelector('button[title="프로젝트 이름 수정"]').click()`);
await sleep(400);
const modal = await ev(`(() => {
  const h3=[...document.querySelectorAll('h3')].find(e=>/이름 수정/.test(e.textContent));
  const inp=document.querySelector('input[placeholder*="하계 수련회"]');
  return { open: !!h3, prefilled: inp?.value || null };
})()`);
check('데스크톱: 제목을 누르면 이름 수정 창', modal.open === true, JSON.stringify(modal));
check('현재 이름이 미리 채워져 있다', modal.prefilled === '2026 하계 수련회', String(modal.prefilled));
await ev(`(() => {
  const inp=document.querySelector('input[placeholder*="하계 수련회"]');
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(inp,'2026 여름 수련회'); inp.dispatchEvent(new Event('input',{bubbles:true}));
})()`);
await sleep(250);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='저장').click()`);
await sleep(700);
const renamed = await ev(`(() => {
  const t=document.querySelector('button[title="프로젝트 이름 수정"] span')?.textContent.trim();
  const tab=[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='2026 여름 수련회');
  const st=JSON.parse(localStorage.getItem('church_app_v4')||'{}');
  return { title:t, inTab:tab, saved: st.projects?.byId?.p1?.title };
})()`);
check('제목이 바뀐다', renamed.title === '2026 여름 수련회', String(renamed.title));
check('상단 프로젝트 탭에도 반영', renamed.inTab === true);
check('저장소에도 반영(게스트=localStorage / 클라우드=projects.name)', renamed.saved === '2026 여름 수련회', String(renamed.saved));
const other = await ev(`(() => { const s=JSON.parse(localStorage.getItem('church_app_v4')||'{}');
  return { p2: s.projects?.byId?.p2?.title, taskCount: s.tasks?.allIds?.length, t0: s.tasks?.byId?.t0?.title }; })()`);
check('다른 프로젝트·업무는 그대로', other.p2 === '새신자 초청 주일' && other.taskCount === START_COUNT + 2 && other.t0 === '업무 0', JSON.stringify(other));

// ── 2) 모바일: 제목 눌러 수정 + 가로줄 스크롤 잠금 ──
await load(MOB);
const barBtn = await ev(`!!document.querySelector('button[title="프로젝트 이름 수정"]')`);
check('모바일: 상단바 제목이 수정 버튼', barBtn === true);
const lock = await ev(`(() => {
  const rows = [...document.querySelectorAll('div')].filter(d => /x-scroll-lock/.test(d.className||''));
  return rows.map(d => {
    const s = getComputedStyle(d);
    return { cls: (d.className.match(/(overflow-x-auto|scrollbar-hide)/g)||[]).join('+'),
             touch: s.touchAction, overscrollX: s.overscrollBehaviorX, scrollable: d.scrollWidth > d.clientWidth };
  });
})()`);
// 리디자인 후 모바일 팀 필터는 칩 줄이 아니라 한 줄 버튼이라 가로 줄은 2개다
check('가로 전용 줄이 2개 있다(프로젝트 탭·상태 칩)', lock.length === 2, JSON.stringify(lock.length));
check('전부 touch-action: pan-x', lock.every(r => r.touch === 'pan-x'), JSON.stringify(lock.map(r=>r.touch)));
check('전부 overscroll-behavior-x: contain', lock.every(r => r.overscrollX === 'contain'), JSON.stringify(lock.map(r=>r.overscrollX)));
const boardScroller = await ev(`(() => {
  const el = [...document.querySelectorAll('div')].find(d => /overscroll-behavior-x:/.test(d.className||''));
  if (!el) return null;
  const s = getComputedStyle(el);
  const inner = el.querySelector('[class*=overflow-y-auto]');
  return { touch: s.touchAction, overscrollX: s.overscrollBehaviorX,
           innerTouch: inner ? getComputedStyle(inner).touchAction : null };
})()`);
// none = 부모로 넘김도, 자기 고무줄도 없음 ('완료' 오른쪽으로 밀리지 않게)
check('보드 가로 스크롤러는 overscroll만 잠근다', boardScroller?.overscrollX === 'none', JSON.stringify(boardScroller));
check('컬럼 안 카드 목록의 세로 스크롤은 살아 있다', boardScroller?.innerTouch === 'auto', JSON.stringify(boardScroller));

// 실제로 세로가 안 밀리는지: 세로 스크롤되는 카드 목록을 먼저 조금 내려두고,
// 프로젝트 탭 줄을 비스듬히(가로 위주로) 스와이프한 뒤 그 scrollTop이 그대로인지 본다
const prep = await ev(`(() => {
  const list = [...document.querySelectorAll('div')].find(d => /overflow-y-auto/.test(d.className||'') && d.scrollHeight > d.clientHeight + 20);
  if (!list) return { none: true };
  list.dataset.probe = 'cardlist';
  list.scrollTop = 40;
  const row = [...document.querySelectorAll('div')].find(d => /x-scroll-lock/.test(d.className||''));
  const b = row.getBoundingClientRect();
  row.dataset.probe = 'row';
  return { top: list.scrollTop, canScroll: true,
           x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2), scrollLeft: row.scrollLeft };
})()`);
check('세로 스크롤되는 카드 목록에서 검사한다', prep.canScroll === true && prep.top > 0, JSON.stringify(prep));
const pt = (x,y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }];
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(prep.x,prep.y)});
for (let i=1;i<=12;i++) { await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(prep.x-i*16,prep.y-i*5)}); await sleep(16); }
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(600);
const swiped = await ev(`(() => {
  const list = document.querySelector('[data-probe=cardlist]');
  const row = document.querySelector('[data-probe=row]');
  return { listTop: list?.scrollTop, rowLeft: Math.round(row?.scrollLeft || 0) };
})()`);
check('가로 스와이프가 카드 목록을 위아래로 밀지 않는다', swiped.listTop === prep.top, `${prep.top} → ${swiped.listTop}`);
check('그 대신 줄이 가로로 밀린다', swiped.rowLeft > prep.scrollLeft, `scrollLeft ${prep.scrollLeft} → ${swiped.rowLeft}`);

// ── 3) 모바일 컬럼 구분 ──
const cols = await ev(`(() => {
  const heads = [...document.querySelectorAll('h3')].filter(h => /^(시작 전|진행 중|보류 중|완료)/.test(h.textContent.trim()));
  const emptyMsg = [...document.querySelectorAll('p')].filter(p => /아직 업무가 없어요/.test(p.textContent)).length;
  const firstCol = heads[0]?.closest('[class*=snap-start]');
  const secondCol = heads[1]?.closest('[class*=snap-start]');
  return {
    headers: heads.map(h => h.textContent.replace(/\\s+/g,' ').trim()),
    emptyMsg,
    colGap: firstCol?.parentElement ? getComputedStyle(firstCol.parentElement).columnGap : null,
    colMinWidth: firstCol ? getComputedStyle(firstCol).minWidth : null,
    headerRow: heads[0]?.parentElement?.textContent?.trim() || null,
    headerFontSize: heads[0] ? getComputedStyle(heads[0]).fontSize : null,
  };
})()`);
check('모바일에도 컬럼 제목 4개가 보인다', cols.headers.length === 4, JSON.stringify(cols.headers));
// span이 붙어 있어 textContent에는 공백이 없다(화면에서는 gap으로 벌어짐)
// 리디자인 후 건수는 제목(h3) 밖의 형제 span이다 → 헤더 줄 전체에서 확인한다
check('제목 줄에 상태·건수가 함께 나온다', (cols.headerRow || '').replace(/\s+/g, '') === `시작 전${START_COUNT}`.replace(/\s+/g, ''), String(cols.headerRow));
check('빈 컬럼에 안내 문구', cols.emptyMsg === 1, `${cols.emptyMsg}개`);
check('컬럼 사이가 14px 간격(핸드오프 모바일 gap)', cols.colGap === '14px', String(cols.colGap));
check('컬럼 최소 폭이 82vw', parseFloat(cols.colMinWidth) > 300, String(cols.colMinWidth));
await shot('three-mob-board');

// 보류 중(빈 컬럼)으로 넘겨서 백지가 아닌지
await ev(`(() => { const c=[...document.querySelectorAll('button')].find(b=>/보류 중/.test(b.textContent)); c && c.click(); })()`);
await sleep(900);
await shot('three-mob-empty-col');
const visibleEmpty = await ev(`(() => {
  const p=[...document.querySelectorAll('p')].find(e=>/아직 업무가 없어요/.test(e.textContent));
  if(!p) return null; const r=p.getBoundingClientRect();
  return { onScreen: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 };
})()`);
check('빈 컬럼으로 넘기면 안내 문구가 화면에 보인다', visibleEmpty?.onScreen === true, JSON.stringify(visibleEmpty));

console.log(results.join('\n'));
console.log(logs.length ? '\n콘솔 오류:\n'+logs.slice(0,5).join('\n') : '\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
