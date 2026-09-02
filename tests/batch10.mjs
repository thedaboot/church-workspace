// 이번 배치 검증 — 설정 탭·메뉴 위치 / 모바일 조작 정리 / 대시보드 / 캘린더 팀 분할 /
//                  다중 팀 / 뷰 유지 / AI 프롬프트 컨텍스트
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const PORT = 9491;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cb10-'));
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
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const mk=(i,{teams,status,sd='',dd=''}) => ({ id:'t'+i, projectId:'p1', title:'업무 '+i, content:'내용', status,
  assignees:['노준석'], teams, startDate:sd, dueDate:dd, position:i, author:'노준석',
  createdAt:'2026-07-01T00:00:00Z', updatedAt:'2026-07-01T00:00:00Z', comments:[], activityLog:[], attachments:[] });
const byId={},allIds=[];
// 캘린더는 늘 '이번 달'을 펼친다. 날짜를 2026-07로 박아 두었더니 8월이 되는 순간 띠가
// 화면에서 사라져서 팀 분할 검사 네 개가 통째로 헛돌았다(FAIL로는 보였지만 앱은 멀쩡했다).
// 날짜는 실행하는 달을 기준으로 만든다 — 시간이 지나 저절로 어긋나는 시드를 두지 않는다.
const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
const thisMonth = n => { const d=new Date(); d.setDate(n); return iso(d); };
const nextMonth = n => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+1); d.setDate(n); return iso(d); };
[[{teams:['워십팀','찬양팀'],status:'완료',sd:thisMonth(12),dd:thisMonth(20)}],
 [{teams:['찬양팀','엔지니어팀','미디어팀'],status:'진행 중',sd:thisMonth(21),dd:thisMonth(25)}],
 [{teams:['웰컴팀'],status:'시작 전',dd:thisMonth(28)}],
 [{teams:['임원진'],status:'시작 전',dd:nextMonth(5)}]].forEach(([o],i)=>{const t=mk(i,o);byId[t.id]=t;allIds.push(t.id);});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
  projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[{id:'l1',title:'기획안',url:'https://e.com'}]},
                  p2:{id:'p2',title:'가을 전도 축제',pinnedLinks:[]}},allIds:['p1','p2']},
  tasks:{byId,allIds}};

const MOB={width:390,height:844,deviceScaleFactor:2,mobile:true};
const DESK={width:1440,height:900,deviceScaleFactor:1,mobile:false};
await send('Page.enable'); await send('Runtime.enable');
const load=async(metrics,path='/?p=p1',state=st)=>{
  await send('Emulation.setDeviceMetricsOverride',metrics);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!metrics.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem('theme','light')`);
  await send('Page.navigate',{url:URL_BASE+path}); await wait('Page.loadEventFired'); await sleep(1400);
};

// ── 1) 설정은 상단 헤더 / 하단 탭 네 자리는 프로젝트·내 업무·대시보드·팀 ──
await load(MOB);
const tabLabels = await ev(`[...document.querySelectorAll('nav span')].map(s=>s.textContent.trim()).filter(t=>t&&t.length<=5)`);
check('하단 탭에 설정이 없다', !tabLabels.includes('설정') && tabLabels.includes('팀'), JSON.stringify([...new Set(tabLabels)]));
await ev(`document.querySelector('div.md\\\\:hidden button[title="설정"]').click()`);
await sleep(450);
const pop = await ev(`(() => {
  const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
  // 헤더의 첫 줄(제목·검색·설정) 기준 — 그 아래 프로젝트 탭 줄까지 포함하면 안 된다
  const head=document.querySelector('div.md\\\\:hidden')?.firstElementChild;
  if(!p||!head) return null;
  const r=p.getBoundingClientRect(), h=head.getBoundingClientRect();
  return { gap: Math.round(r.top - h.bottom), onScreen: r.top>=0 && r.bottom<=window.innerHeight,
           rightGap: Math.round(window.innerWidth - r.right) };
})()`);
check('설정 메뉴가 헤더 바로 아래 뜬다(간격 -12~20px)', pop && pop.gap >= -12 && pop.gap <= 20, JSON.stringify(pop));
check('메뉴가 화면 안에 온전히 있다', pop?.onScreen === true, JSON.stringify(pop));
const popTeams = await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
  return [...p.querySelectorAll('p')].map(e=>e.textContent.trim()); })()`);
check('여러 팀 소속이 함께 보인다', popTeams.some(t => t === '찬양팀 · 임원진'), JSON.stringify(popTeams));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
await sleep(250);

// ── 2) 모바일 조작 줄 정리 ──
// 보이지 않는 버튼(데스크톱 전용 md:hidden, 팝오버 안)은 세지 않는다 — 실제로 화면에
// 그려진 것만. 상태 칩 줄은 보드 안이라 자동으로 빠진다.
const rows = await ev(`(() => {
  const main=document.querySelector('main');
  const board=[...main.querySelectorAll('div')].find(d=>/overscroll-behavior-x:/.test(d.className||''));
  const boardTop = board ? board.getBoundingClientRect().top : null;
  const visible = [...main.querySelectorAll('button')].filter(b=>{
    const r=b.getBoundingClientRect();
    return r.width>0 && r.height>0 && r.bottom<=boardTop;
  });
  // 몇 '줄'인지 = top을 정렬해 14px 이상 벌어질 때마다 새 줄로 센다.
  // (한 줄 안에서도 아이콘 버튼은 크기가 달라 top이 몇 px씩 어긋난다)
  const sorted=visible.map(b=>b.getBoundingClientRect().top).sort((a,b)=>a-b);
  const tops=sorted.filter((t,i)=>i===0||t-sorted[i-1]>14);
  return { boardTop, viewport: window.innerHeight, rowCount: tops.length,
           btns: visible.map(b=>b.title||b.textContent.trim()).filter(Boolean) };
})()`);
// 핸드오프 레이아웃: 상단바+탭줄(88) / 제목 / 메타(참고 링크·공유·삭제) + 새 업무 / 보기·필터
check('보드가 화면 절반 위에서 시작한다', rows.boardTop !== null && rows.boardTop < rows.viewport*0.45, `boardTop ${rows.boardTop}px / vh ${rows.viewport}`);
check('보드 위 조작이 4줄 이내', rows.rowCount <= 4, `${rows.rowCount}줄 / ${rows.btns.length}개: ${rows.btns.join(', ')}`);
// '⋯' 메뉴는 없앴다 — 공유·삭제는 메타 줄에 그대로 보이고, 접는 건 팀 필터 한 줄뿐
const filterBtn = `[...document.querySelectorAll('main button')].find(b=>/전체 팀 ·|외 [0-9] ·|팀 · [0-9]/.test(b.textContent))`;
const hasFilter = await ev(`!!${filterBtn}
  && [...document.querySelectorAll('main button')].some(b=>/프로젝트 공유/.test(b.title||''))`);
check('팀 필터만 접히고 공유는 그대로 보인다', hasFilter === true);
await ev(`${filterBtn}.click()`); await sleep(400);
// 오버레이 카드(포털이 아니라 필터 버튼 바로 아래 absolute)
const filterChips = await ev(`(() => { const card=document.querySelector('main .dc-pop');
  return card ? [...card.querySelectorAll('button')].map(b=>b.textContent.trim()) : null; })()`);
check('필터 카드에 이 프로젝트의 팀이 나온다', filterChips && filterChips.length >= 2, JSON.stringify(filterChips));
await ev(`(() => { const card=document.querySelector('main .dc-pop');
  [...card.querySelectorAll('button')].find(b=>/웰컴팀/.test(b.textContent)).click(); })()`);
await sleep(500);
const badge = await ev(`${filterBtn}.textContent.trim()`);
check('필터를 고르면 버튼에 고른 팀이 보인다', /웰컴팀/.test(badge), String(badge));

// ── 3) 캘린더: 여러 팀은 균등 세로 분할(번갈아 반복 아님) ──
await load(DESK);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('캘린더'))?.click()`);
await sleep(1100);
// 주의: 이 문자열은 템플릿 리터럴 → \d, \( 같은 이스케이프가 죽는다. [0-9]와 리터럴 괄호로 쓴다.
// title은 "업무 0 (7.12~7.20) · 워십팀, 찬양팀" 형태라 앞부분으로 키를 만든다.
const bands = await ev(`(() => {
  const out={};
  // 캘린더 리라이트 이후 막대는 button[title="업무 0 (7.12~7.20) · 워십팀, 찬양팀"]
  [...document.querySelectorAll('main [title]')].forEach(d=>{
    const bg=getComputedStyle(d).backgroundImage;
    if(bg.indexOf('gradient')<0) return;
    const key=(d.title||'').split(' (')[0].split(' ·')[0];
    // Chrome은 180deg(= to bottom, 기본값)를 직렬화에서 생략한다 → 가로였다면
    // 'to right'나 '90deg'가 남는다. 그걸로 세로 분할을 판정한다.
    const horizontal = bg.indexOf('to right') >= 0 || bg.indexOf('90deg') >= 0;
    // 같은 색이 범위 양끝으로 두 번 적히므로(0% 50%, 50% 100%) 중복을 지운다
    const colors=[...new Set(bg.match(/rgba?[(][^)]*[)]/g)||[])].length;
    out[key]=out[key]||{horizontal,colors,samples:0,bg:bg.slice(0,160)};
    out[key].samples++;
  });
  return out;
})()`);
const b2 = bands['업무 0'], b3 = bands['업무 1'];
check('2팀 띠는 세로로 나뉜다(가로 반복 아님)', b2 && b2.horizontal === false, JSON.stringify(b2));
check('2팀 띠는 색이 딱 2개(50%씩)', b2 && b2.colors === 2, JSON.stringify(b2));
check('3팀 띠는 색이 딱 3개(33%씩)', b3 && b3.colors === 3, JSON.stringify(b3));
check('여러 날에 걸쳐도 같은 그림이 반복 없이 이어진다', b2 && b2.samples >= 2, `${b2?.samples}칸`);

// ── 4) 프로젝트를 옮겨도 캘린더 뷰 유지 ──
const before = await ev(`!!document.querySelector('.grid.grid-cols-7')`);
check('지금 캘린더 뷰', before === true);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='가을 전도 축제')?.click()`);
await sleep(1100);
const after = await ev(`(() => ({ cal: !!document.querySelector('.grid.grid-cols-7'),
  onTab: [...document.querySelectorAll('button')].find(b=>/border-fg($| )/.test(b.className))?.textContent.trim() }))()`);
check('다른 프로젝트로 옮겨도 캘린더 유지', after.cal === true, JSON.stringify(after));

// ── 5) 대시보드 ── ('/'는 v2부터 홈이라 ?p=dashboard로 간다)
await load(DESK, '/?p=dashboard');
// 핸드오프 리디자인 후: 도넛 대신 진척도 막대, '마감이 가까운' 섹션 대신 마감 그룹 리스트
const dash = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const bars=[...document.querySelectorAll('main span[style*="background"]')].map(s=>s.getAttribute('style'));
  const heads=[...document.querySelectorAll('main h3')].map(h=>h.textContent.trim());
  const main=document.querySelector('main');
  return { progress: /전체 진척도/.test(txt),
           teamBars: bars.filter(s=>/--p-|--app-tag-/.test(s)).length, heads,
           dueGroups: ['지연','오늘 마감','이번 주','다음 주 이후'].filter(l=>txt.includes(l)).length,
           fullWidth: Math.round(main.scrollWidth - main.clientWidth) };
})()`);
check('전체 진척도 칸이 있다', dash.progress === true);
check('팀별 막대가 팀 색을 쓴다', dash.teamBars >= 4, `${dash.teamBars}개`);
check('마감 그룹 구간이 나온다', dash.dueGroups >= 2, `${dash.dueGroups}구간`);
check('가로 스크롤 없이 폭에 들어간다', dash.fullWidth <= 0, `초과 ${dash.fullWidth}px`);
check('팀별 남은 업무 섹션', dash.heads.some(h=>/팀별 남은 업무/.test(h)), JSON.stringify(dash.heads));

// ── 6) 좁은 화면에서도 대시보드가 넘치지 않는지 ──
for (const w of [320, 390, 768, 1024, 1440, 1920]) {
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<768});
  await sleep(450);
  const over = await ev(`(() => { const m=document.querySelector('main'); return Math.round(m.scrollWidth - m.clientWidth); })()`);
  check(`${w}px 폭에서 가로 넘침 없음`, over <= 0, `초과 ${over}px`);
}

// ── 대시보드 필터가 URL에 담긴다 ──
// 예전에는 '내 팀'을 골라놓고 새로고침하면 '전체'로 돌아갔다.
// 화면(p)과 열린 업무(t)는 주소에 있는데 필터만 모든 기록에서 부려 있었다.
await load(DESK, '/?p=dashboard');
await ev(`[...document.querySelectorAll('main button')].find(b=>/^내 팀 [0-9]+$/.test(b.textContent.trim()))?.click()`);
await sleep(400);
const urlPick = await ev(`location.search`);
check('필터를 고르면 주소에 f가 붙는다', /f=/.test(urlPick), urlPick || '(빈 주소)');
await send('Page.navigate',{url:URL_BASE+urlPick}); await wait('Page.loadEventFired'); await sleep(1500);
const keptFilter = await ev(`(() => {
  // 상단 내비에도 '업무 대시보드'·'내 업무'가 있어서 main 안 세그먼트로 좁힌다
  const segs=[...document.querySelectorAll('main button')]
    .filter(b=>/^(전체|내 업무|내 팀) [0-9]+$/.test(b.textContent.trim()));
  const on=segs.find(b=>getComputedStyle(b).backgroundColor!=='rgba(0, 0, 0, 0)');
  return on ? on.textContent.trim() : null;
})()`);
check('새로고침해도 고른 필터가 유지된다', /^내 팀/.test(keptFilter || ''), String(keptFilter));
await ev(`[...document.querySelectorAll('main button')].find(b=>/^전체 [0-9]+$/.test(b.textContent.trim()))?.click()`);
await sleep(400);
const urlAll = await ev(`location.search`);
check('기본값(전체)은 주소에 적지 않는다', !/f=/.test(urlAll), urlAll || '(빈 주소)');

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,5).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
