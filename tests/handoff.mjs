// 핸드오프 규격 검증 — 4개 화면 + 토큰 + 모션 + 첨부/DB 동작
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const PORT = 9530;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'chf-'));
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

const D=(off)=>{const d=new Date();d.setDate(d.getDate()+off);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const T=[
 ['찬양 콘티 확정',['워십팀','찬양팀'],'완료',D(-14),D(-8),['노준석']],
 ['악보·송폼 제작',['찬양팀'],'진행 중',D(-3),D(-2),['노준석']],       // 지연
 ['오늘 마감 건',['미디어팀'],'진행 중','',D(0),['이시온']],           // 오늘
 ['이번 주 건',['웰컴팀'],'시작 전','',D(3),['박지호']],               // 이번 주
 ['다음 주 건',['임원진'],'시작 전','',D(12),['양민혁']],              // 이후
 ['주 경계 넘는 기간 업무',['찬양팀','엔지니어팀'],'시작 전',D(-2),D(6),['노준석']],
];
const byId={},allIds=[];
T.forEach(([title,teams,status,sd,dd,as],i)=>{const id='t'+i;
 byId[id]={id,projectId:'p1',title,content:'내용',status,assignees:as,teams,startDate:sd,dueDate:dd,position:i,
  author:'노준석',createdAt:'2026-07-01T00:00:00Z',updatedAt:'2026-07-20T00:00:00Z',comments:[],activityLog:[],attachments:[]};
 allIds.push(id);});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
 projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[{id:'l1',title:'기획안',url:'https://e.com'}]},
                 p2:{id:'p2',title:'가을 축제',pinnedLinks:[]}},allIds:['p1','p2']},
 tasks:{byId,allIds}};

const DESK={width:1440,height:900,deviceScaleFactor:1,mobile:false};
await send('Page.enable'); await send('Runtime.enable');
// 기본 경로는 대시보드다 — '/'는 v2부터 홈이라 ?p=dashboard로 간다
const load=async(m,path='/?p=dashboard',theme='light')=>{
  await send('Emulation.setDeviceMetricsOverride',m);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','${theme}')`);
  await send('Page.navigate',{url:URL_BASE+path}); await wait('Page.loadEventFired'); await sleep(1600);
};
const clickText=t=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})?.click()`;
// 에디터에 진짜 키를 넣는다 — Enter는 char까지 보내야 브라우저가 치는 것과 같아진다
const key=async(k,vk,text='')=>{
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code:k,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
  if(text)await send('Input.dispatchKeyEvent',{type:'char',key:k,code:k,text,unmodifiedText:text,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
};

// ── 토큰 ──
await load(DESK);
const tok = await ev(`(() => {
  const cs=getComputedStyle(document.documentElement);
  const g=(n)=>cs.getPropertyValue(n).trim();
  return { track:g('--p-track'), blue:g('--p-blue'), red:g('--p-red'), yellow:g('--p-yellow'),
           green:g('--p-green'), gray:g('--p-gray'), brown:g('--p-brown'), purple:g('--p-purple'), pink:g('--p-pink'),
           ease:g('--ease-out-quint') };
})()`);
check('진행 바 파스텔 토큰 9개 모두 정의', Object.entries(tok).filter(([k])=>k!=='ease').every(([,v])=>/^#|rgb/.test(v)), JSON.stringify(tok));
check('라이트 파스텔 값이 스펙과 같다', tok.blue==='#93b4e4' && tok.red==='#e5a29b' && tok.track==='#e6e3e8', `${tok.blue}/${tok.red}/${tok.track}`);
check('이징이 cubic-bezier(.16,1,.3,1)', /cubic-bezier\(\s*\.?0?\.16/.test(tok.ease), tok.ease);
const dark = await ev(`(() => { document.documentElement.dataset.theme='dark';
  const cs=getComputedStyle(document.documentElement); return cs.getPropertyValue('--p-track').trim(); })()`);
check('다크 파스텔도 따로 정의', dark === '#2d2d2c', dark);
await ev(`document.documentElement.dataset.theme='light'`);

// ── 1. 대시보드 ──
const dash = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const segs=[...document.querySelectorAll('button')].map(b=>b.textContent.trim());
  const kpiLabels=[...document.querySelectorAll('main span')].map(s=>s.textContent.trim());
  const grids=[...document.querySelectorAll('main .dash-grid')];
  const cols=grids.map(g=>getComputedStyle(g).gridTemplateColumns);
  return {
    greeting: /님, /.test(txt),
    hasSeg: segs.some(t=>/^전체 \\d/.test(t)) && segs.some(t=>/^내 업무 \\d/.test(t)) && segs.some(t=>/^내 팀 \\d/.test(t)),
    kpis: ['지연','오늘 마감','이번 주','전체 진척도'].filter(l=>kpiLabels.includes(l)),
    buckets: ['지연','오늘 마감','이번 주','다음 주 이후'].filter(l=>txt.includes(l)),
    hasProjectCard: txt.includes('프로젝트 진행'), hasTeamLeft: txt.includes('팀별 남은 업무'),
    gridCount: grids.length, sameCols: cols.length>=2 && cols[0]===cols[1], cols,
  };
})()`);
check('대시보드: 인사말', dash.greeting === true);
check('대시보드: 전체/내 업무/내 팀 세그먼트', dash.hasSeg === true);
check('대시보드: KPI 4종', dash.kpis.length === 4, JSON.stringify(dash.kpis));
check('대시보드: 마감 그룹 4구간', dash.buckets.length === 4, JSON.stringify(dash.buckets));
check('대시보드: 프로젝트 진행 + 팀별 남은 업무', dash.hasProjectCard && dash.hasTeamLeft);
check('대시보드: KPI 줄과 본문 줄의 2열 정의가 같다', dash.sameCols === true, JSON.stringify(dash.cols));
const segBefore = await ev(`document.querySelector('main').textContent.length`);
await ev(`[...document.querySelectorAll('button')].find(b=>/^내 업무 \\d/.test(b.textContent.trim()))?.click()`);
await sleep(400);
check('대시보드: 세그먼트를 바꾸면 내용이 즉시 바뀐다',
  (await ev(`document.querySelector('main').textContent.length`)) !== segBefore);

// 완료 버튼 → 상태가 실제로 저장되고 목록에서 사라진다
await load(DESK);
const before = await ev(`(() => { const s=JSON.parse(localStorage.getItem('church_app_v4'));
  return { doing: Object.values(s.tasks.byId).filter(t=>t.status!=='완료').length }; })()`);
// 확인 팝오버가 한 번 뜬다 → 트리거 클릭 후 '완료' 확인까지
await ev(`document.querySelector('[title="완료로 옮기기"]').click()`);
await sleep(300);
await ev(`[...document.body.querySelectorAll('button')].filter(b=>b.textContent.trim()==='완료').pop().click()`);
await sleep(700);
const after = await ev(`(() => { const s=JSON.parse(localStorage.getItem('church_app_v4'));
  return { doing: Object.values(s.tasks.byId).filter(t=>t.status!=='완료').length,
           logged: Object.values(s.tasks.byId).some(t=>(t.activityLog||[]).some(a=>/완료/.test(a.action||''))) }; })()`);
check('대시보드: 원형 버튼이 상태를 완료로 저장한다', after.doing === before.doing - 1, `${before.doing} → ${after.doing}`);
check('대시보드: 완료 처리가 활동 기록에 남는다', after.logged === true);

// ── 2. 프로젝트 보드 ──
await load(DESK, '/?p=p1');
const board = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const newBtn=[...document.querySelectorAll('main button')].find(b=>/새 업무/.test(b.textContent));
  const cs=newBtn?getComputedStyle(newBtn):null;
  const rail=document.querySelector('.board-card span');
  const chips=[...document.querySelectorAll('main button')].filter(b=>/^전체 \\d/.test(b.textContent.trim()));
  const heads=[...document.querySelectorAll('main h3')].map(h=>h.textContent.trim());
  const dd=[...document.querySelectorAll('.board-card span')].map(s=>s.textContent.trim()).filter(t=>/^D-\\d|일 지남|^오늘$/.test(t));
  return {
    meta: /\\d+건 · 완료 \\d+건/.test(txt),
    newBtnRadius: cs?cs.borderRadius:null, newBtnWeight: cs?cs.fontWeight:null,
    railWidth: rail?getComputedStyle(rail).width:null,
    hasAllChip: chips.length===1,
    columns: ['시작 전','진행 중','보류 중','완료'].filter(s=>heads.includes(s)).length,
    ddBadges: dd.length,
    hasShare: !!document.querySelector('main button[title*="공유"]'),
    hasDelete: !!document.querySelector('main button[title="프로젝트 삭제"]'),
    hasMoveBtn: !!document.querySelector('.board-card button[title="상태 옮기기"]'),
  };
})()`);
check('보드: 헤더 메타(건수·완료)', board.meta === true);
check('보드: 새 업무 버튼 radius 8px / 700', board.newBtnRadius === '8px' && board.newBtnWeight === '700', `${board.newBtnRadius} / ${board.newBtnWeight}`);
check('보드: 카드 좌측 3px 팀 레일', board.railWidth === '3px', String(board.railWidth));
check('보드: 전체 칩 + 팀 칩', board.hasAllChip === true);
check('보드: 컬럼 4개', board.columns === 4, String(board.columns));
check('보드: D-day 배지', board.ddBadges >= 3, `${board.ddBadges}개`);
check('보드: 공유·삭제가 화면에 남아 있다', board.hasShare && board.hasDelete);
check('보드: 카드마다 상태 옮기기 버튼', board.hasMoveBtn === true);
await ev(`document.querySelector('.board-card button[title="상태 옮기기"]').click()`);
await sleep(400);
const pop = await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''))
  || [...document.querySelectorAll('div')].find(d=>/dc-pop/.test(d.className||''));
  if(!p) return null; const cs=getComputedStyle(p);
  return { w: Math.round(p.getBoundingClientRect().width), origin: cs.transformOrigin,
           items: [...p.querySelectorAll('button')].map(b=>b.textContent.trim()) }; })()`);
check('보드: 상태 팝오버 150px', pop && pop.w === 150, JSON.stringify(pop && { w: pop.w }));
check('보드: 팝오버에 4개 상태', pop && pop.items.length === 4, JSON.stringify(pop && pop.items));

// ── 3. 캘린더 ──
await load(DESK, '/?p=p1');
await ev(clickText('캘린더')); await sleep(1100);
const cal = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const weeks=[...document.querySelectorAll('main div')].filter(d=>/flex-1 min-h-0 overflow-hidden/.test(d.className||''));
  const bars=[...document.querySelectorAll('main button[title*="~"]')];
  const spans=bars.map(b=>getComputedStyle(b).gridColumn);
  const cont=bars.filter(b=>/↳/.test(b.textContent));
  const dates=[...document.querySelectorAll('main span')].map(s=>s.textContent.trim()).filter(t=>/^\\d{1,2}$/.test(t));
  return { hasNav: /년 \\d+월/.test(txt), weekRows: weeks.length, bars: bars.length,
           spanning: spans.filter(s=>/span [2-9]/.test(s)).length, continued: cont.length,
           dateCells: dates.length, hasLegend: /시작 전/.test(txt) && /완료/.test(txt),
           hasDaySheet: /월 \\d+일/.test(txt) };
})()`);
check('캘린더: 연월 내비', cal.hasNav === true);
check('캘린더: 주 단위 행 구조', cal.weekRows >= 5, `${cal.weekRows}행`);
check('캘린더: 기간 업무가 span으로 묶인다', cal.spanning >= 1, `span 막대 ${cal.spanning}개`);
check('캘린더: 주 경계를 넘으면 ↳ 로 이어진다', cal.continued >= 1, `${cal.continued}개`);
check('캘린더: 날짜 숫자가 가려지지 않는다', cal.dateCells >= 28, `${cal.dateCells}칸`);
check('캘린더: 상태 범례', cal.hasLegend === true);
check('캘린더: 선택한 날 목록', cal.hasDaySheet === true);

// ── 4. 내 업무 ──
await load(DESK);
await ev(`[...document.querySelectorAll('button')].find(b=>/^내 업무/.test(b.textContent.trim()) && !/^내 업무 \\d+$/.test(b.textContent.trim()))?.click()
  || [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='내 업무')?.click()`);
await sleep(900);
const mine = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const chips=[...document.querySelectorAll('main button')].filter(b=>/^(시작 전|진행 중|보류 중|완료)$/.test(b.textContent.trim()));
  const grid=document.querySelector('main .side-grid');
  return { title: /님의 업무/.test(txt), summary: /건 남음/.test(txt), chips: chips.length,
           hasProjects: txt.includes('내가 맡은 프로젝트'),
           cols: grid?getComputedStyle(grid).gridTemplateColumns:null };
})()`);
check('내 업무: 제목·요약', mine.title && mine.summary, JSON.stringify(mine));
check('내 업무: 상태 칩 4개(다중 선택)', mine.chips === 4, `${mine.chips}개`);
check('내 업무: 내가 맡은 프로젝트 카드', mine.hasProjects === true);
check('내 업무: 2열 300px', /300px/.test(mine.cols || ''), String(mine.cols));
const beforeChip = await ev(`document.querySelectorAll('main [class*=dc-row]').length`);
await ev(`[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='완료')?.click()`);
await sleep(500);
check('내 업무: 상태 칩이 목록을 즉시 바꾼다',
  (await ev(`document.querySelectorAll('main [class*=dc-row]').length`)) !== beforeChip);

// ── 5. 팀 보드 ──
await load(DESK);
// 마감 리스트 행 버튼에도 팀 이름이 들어 있어 텍스트로 찾으면 그쪽이 먼저 걸린다 → title로
await ev(`document.querySelector('main button[title="찬양팀 보드로"]')?.click()`);
await sleep(1000);
const team = await ev(`(() => {
  const txt=document.querySelector('main').textContent;
  const kpi=[...document.querySelectorAll('main span')].map(s=>s.textContent.trim());
  return { mark: !!document.querySelector('main h2 span'), summary: /건 남음 · \\d+개 프로젝트/.test(txt),
           statuses: ['시작 전','진행 중','보류 중','완료'].filter(s=>kpi.includes(s)).length,
           hasProjects: txt.includes('참여 프로젝트'), hasMember: /명|건/.test(txt) };
})()`);
check('팀 보드: 제목 앞 팀 색 표식', team.mark === true);
check('팀 보드: 요약(남은 건수·참여 프로젝트)', team.summary === true, JSON.stringify(team));
check('팀 보드: 상태 4칸', team.statuses === 4, `${team.statuses}개`);
check('팀 보드: 참여 프로젝트', team.hasProjects === true);

// 사람 칩은 **제목 아래 새 줄**에 왼쪽부터 선다(사용자 지적 2026-09-07 · 실기기 iPhone).
// 제목 오른쪽에 붙여 두면 폭에 따라 두 명만 첫 줄에 서고 나머지가 접혔다.
// 넘칠 때는 줄바꿈이 아니라 가로 스크롤이고, 끝까지 밀면 오른쪽에 여백이 남는다.
const chipRow = await ev(`(() => {
  const h2 = document.querySelector('main h2');
  const row = document.querySelector('main [data-team-chips]');
  if (!h2 || !row) return null;
  const cs = getComputedStyle(row);
  const a = h2.getBoundingClientRect(), b = row.getBoundingClientRect();
  return { below: Math.round(b.top - a.bottom), left: Math.round(b.left - a.left),
           wrap: cs.flexWrap, overflowX: cs.overflowX, tail: getComputedStyle(row, '::after').width,
           chips: row.querySelectorAll('[data-team-chip]').length };
})()`);
check('팀 보드: 사람 칩이 제목 아래 새 줄', chipRow && chipRow.below >= 0, JSON.stringify(chipRow));
check('팀 보드: 사람 칩이 제목과 같은 왼쪽에서 시작', chipRow && Math.abs(chipRow.left) <= 1, JSON.stringify(chipRow));
check('팀 보드: 칩이 넘치면 줄바꿈이 아니라 가로 스크롤',
  chipRow && chipRow.wrap === 'nowrap' && chipRow.overflowX === 'auto', JSON.stringify(chipRow));
check('팀 보드: 칩 줄 끝에 여백(12px)', chipRow && chipRow.tail === '12px', JSON.stringify(chipRow));
check('팀 보드: 사람 칩이 선다', chipRow && chipRow.chips > 0, JSON.stringify(chipRow));

// ── 모션 ──
await load(DESK);
const motion = await ev(`(() => {
  const screen=document.querySelector('main .dc-screen');
  const bar=document.querySelector('main .dc-bar-fill');
  const kpi=document.querySelector('main .dc-kpi');
  const cs=(el)=>el?getComputedStyle(el):null;
  const s=cs(screen), b=cs(bar), k=cs(kpi);
  return { screenAnim: s?s.animationName:null, screenDur: s?s.animationDuration:null,
           barProp: b?b.transitionProperty:null, barDur: b?b.transitionDuration:null,
           kpiDelay: k?k.animationDelay:null,
           mark: !!document.querySelector('main .dc-draw') };
})()`);
check('모션: 화면 전환 260ms', motion.screenDur === '0.26s', String(motion.screenDur));
check('모션: 진행 바는 transform 전환(width 아님)', motion.barProp === 'transform' && motion.barDur === '0.55s', `${motion.barProp} ${motion.barDur}`);
check('모션: KPI stagger', motion.kpiDelay === '0s' || /ms|s/.test(motion.kpiDelay || ''), String(motion.kpiDelay));

// reduced motion에서 애니메이션이 꺼지는지
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.navigate', { url: URL_BASE + '/?p=dashboard' }); await wait('Page.loadEventFired'); await sleep(1200);
const rm = await ev(`(() => { const s=document.querySelector('main .dc-screen'); const b=document.querySelector('main .dc-bar-fill');
  return { anim: s?getComputedStyle(s).animationName:null, trans: b?getComputedStyle(b).transitionDuration:null }; })()`);
check('모션: reduced-motion에서 전부 해제', rm.anim === 'none' && rm.trans === '0s', JSON.stringify(rm));
await send('Emulation.setEmulatedMedia', { features: [] });

// ── 첨부 + 저장 경로 ──
await load(DESK, '/?p=p1');
await ev(`document.querySelector('.board-card').click()`); await sleep(900);
const modal = await ev(`(() => {
  const m=document.querySelector('.fixed.inset-0.z-50');
  if(!m) return null;
  const t=m.textContent;
  return { open:true, hasTabs: /댓글|활동/.test(t), hasShare: !!m.querySelector('button[title*="공유"]'),
           hasEdit: [...m.querySelectorAll('button')].some(b=>b.textContent.trim()==='수정') };
})()`);
check('업무 상세: 열린다', modal?.open === true);
check('업무 상세: 댓글·활동 탭', modal?.hasTabs === true);
check('업무 상세: 공유 버튼', modal?.hasShare === true);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='수정')?.click()`);
await sleep(1200);
const edit = await ev(`(() => {
  const m=document.querySelector('.fixed.inset-0.z-50'); const t=m?m.textContent:'';
  return { title: !!m?.querySelector('input[name=title]'),
           status: /시작 전/.test(t), teams: /담당 팀/.test(t), assignee: /담당자/.test(t),
           dates: /시작일/.test(t) && /마감일/.test(t), ai: /AI 문맥 다듬기/.test(t) };
})()`);
check('업무 수정: 제목·상태·팀·담당자·일정 입력이 그대로', edit.title && edit.status && edit.teams && edit.assignee && edit.dates, JSON.stringify(edit));
check('업무 수정: AI 다듬기 버튼', edit.ai === true);
// 제목을 바꿔 저장 → 저장소 반영
await ev(`(() => { const i=document.querySelector('input[name=title]');
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(i,'저장 확인용 제목'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(250);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='저장')?.click()`);
await sleep(900);
const saved = await ev(`Object.values(JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId).some(t=>t.title==='저장 확인용 제목')`);
check('업무 수정: 저장이 저장소에 반영된다', saved === true);


// ── 본문 구분선이 실제로 그려지는가 (2026-08-30) ────────────────────────────
// mdcheck는 markdown.js의 왕복만 본다. **그리는 쪽**(RichText)에 오타가 있어서
// 구분선이 든 업무를 아예 못 열었다(사용자 신고 — 오류 경계로 떨어졌다).
// 판정이 두 파일에 한 쌍으로 있으므로 그리는 쪽도 같이 봐야 한다.
{
  const first = Object.keys(st.tasks.byId)[0];
  st.tasks.byId[first].content = '위 글\n---\n아래 글';
  await load(DESK, `/?p=p1&t=${first}`);
  const hr = await ev(`(() => {
    const t = document.body.textContent || '';
    return {
      오류: /문제가 생겼어요|오류가 발생|다시 시도/.test(t),
      위아래: /위 글/.test(t) && /아래 글/.test(t),
      선: document.querySelectorAll('hr').length,
    };
  })()`);
  check('구분선이 든 업무가 열린다', hr.오류 === false && hr.위아래 === true, JSON.stringify(hr));
  check('구분선이 <hr>로 그려진다', hr.선 >= 1, JSON.stringify(hr));
  st.tasks.byId[first].content = '내용';   // 뒤 검사들이 쓰는 상태로 되돌린다
}


// ── 번호 목록이 이어지는 숫자로 그려진다 (2026-09-11) ───────────────────────
// 저장된 글은 `2.`인데 화면에서는 1부터 다시 셌다(사용자 스크린샷 · 업무 상세) —
// RichText가 `<ol>`을 언제나 1부터 그렸기 때문이다. mdcheck가 저장 쪽 왕복을 보고,
// 여기서는 **그리는 쪽**을 본다(구분선과 같은 짝).
// **되돌리기**: RichText의 `start={block.start || 1}`를 떼면 두 번째 줄이 깨진다.
{
  const first = Object.keys(st.tasks.byId)[0];
  st.tasks.byId[first].content = '1. 첫째\n- 사이 불릿\n2. 둘째';
  await load(DESK, `/?p=p1&t=${first}`);
  const ols = await ev(`[...document.querySelectorAll('ol')].map(o => ({ start: o.getAttribute('start'), n: o.children.length }))`);
  check('사이에 블록이 끼면 번호 목록이 둘로 갈린다', Array.isArray(ols) && ols.length === 2, JSON.stringify(ols));
  check('두 번째 목록이 2부터 그려진다',
    Array.isArray(ols) && ols.length === 2 && ols[1].start === '2', JSON.stringify(ols));
  st.tasks.byId[first].content = '내용';
}


// ── 제목에서 Enter (2026-08-30) ─────────────────────────────────────────────
// 제목에서 Enter를 치면 다음 줄은 본문이다(§6). 처음 나간 판은 **줄 끝에서 빈 문단을
// 하나 더 만들었다**(사용자 지적 — "줄바꿈이 두 번 된다"). 줄 끝에서는 splitBlock이
// 이미 문단을 만들어 두므로 setNode가 false를 돌려주고, 그 false가 단축키의 반환값이
// 되어 ProseMirror의 기본 Enter가 한 번 더 갈랐다.
// 저장된 문자열로 본다 — 사람이 다시 열었을 때 보는 것이 그것이다.
{
  const firstId = Object.keys(st.tasks.byId)[0];
  const enterAt = async (content, lefts, typed) => {
    st.tasks.byId[firstId].content = content;
    await load(DESK, `/?p=p1&t=${firstId}`);
    await ev(clickText('수정'));
    await sleep(1400);
    // 제목 줄을 눌러 커서를 넣고 End로 줄 끝까지 — 클릭 x좌표에 기대지 않는다
    const p = await ev(`(() => { const h=document.querySelector('.tiptap h1,.tiptap h2');
      if(!h) return null; const r=h.getBoundingClientRect();
      return { x: Math.round(r.left+5), y: Math.round(r.top+r.height/2) }; })()`);
    if (!p) return '(제목 없음)';
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
    await sleep(250);
    await key('End', 35);
    for (let i = 0; i < lefts; i++) await key('ArrowLeft', 37);
    await sleep(150);
    await key('Enter', 13, '\r');
    await sleep(300);
    if (typed) { await send('Input.insertText',{text:typed}); await sleep(300); }
    await ev(clickText('저장'));
    await sleep(900);
    return ev(`JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId.${firstId}.content`);
  };

  const endMd = await enterAt('## 제목줄\n본문줄', 0, 'X');
  check('제목 끝에서 Enter가 빈 문단을 만들지 않는다', endMd === '## 제목줄\nX\n본문줄', JSON.stringify(endMd));
  const midMd = await enterAt('## 제목줄\n본문줄', 1, '');
  check('제목 가운데서 Enter는 뒷부분을 본문으로 떨어뜨린다', midMd === '## 제목\n줄\n본문줄', JSON.stringify(midMd));
  const markMd = await enterAt('## ==강조제목==\n본문줄', 0, 'Y');
  check('제목에서 Enter 뒤에도 형광펜이 따라온다(keepMarks)', markMd === '## ==강조제목==\n==Y==\n본문줄', JSON.stringify(markMd));
  const boldMd = await enterAt('## **굵은제목**\n본문줄', 0, 'Y');
  check('제목에서 Enter 뒤에도 굵기가 따라온다(keepMarks)', boldMd === '## **굵은제목**\n**Y**\n본문줄', JSON.stringify(boldMd));
  st.tasks.byId[firstId].content = '내용';   // 뒤 검사들이 쓰는 상태로 되돌린다
}


// ── 서식 바 — 붙으면 '줄'이 된다 (2026-08-30 · 2026-09-11) ──────────────────
// 처음 나간 판은 top:8px으로 박아서 바가 업무 창 머리줄 **위로 올라가 겹쳤다**
// (사용자 지적 — "아예 헤더로 가면 어떻게 해"). 머리줄 높이는 폭·글자에 따라 달라지므로
// 재서 맞춘다. 2026-09-11에 **붙었을 때의 모양**이 바뀌었다(사용자 결정 — "붙으면 상자가
// 아니라 줄로"): 둥근 모서리·좌우·위 선을 걷고 아래 가는 선 하나와 연한 그림자만 남으며,
// 배경은 그 통의 바탕색이다. 같은 날 저녁 **모바일 갈래도 이 한 벌로 합쳤다** — 화면 아래
// (키보드 위) 고정은 실기기 아이폰에서 자리가 맞지 않아 걷었다(§6-9-aa-4). 폭별 확인은
// 아래 매트릭스가 한다.
// 본문이 짧으면 바가 멈출 자리까지 올라가지도 못한다 — 길게 만들어 실제로 붙여 놓고 잰다
const 긴본문 = Array.from({ length: 40 }, (_, i) => `본문 ${i + 1}번째 줄입니다`).join('\n');
{
  const label = '데스크톱';
  const firstId = Object.keys(st.tasks.byId)[0];
  st.tasks.byId[firstId].content = 긴본문;
  await load(DESK, `/?p=p1&t=${firstId}`);
  await ev(clickText('수정'));
  await sleep(1400);
  // 끝까지 내려 바를 붙인 뒤에 잰다(스크롤과 재기를 한 번에 하면 옛 자리가 나온다)
  await ev(`(() => {
    const bar = document.querySelector('[data-editor-bar="sticky"]');
    const box = bar && (bar.closest('.overflow-y-auto') || bar.parentElement);
    if (box) box.scrollTop = box.scrollHeight;
  })()`);
  await sleep(600);
  const tb = await ev(`(() => {
    const bar = document.querySelector('[data-editor-bar="sticky"]');
    if (!bar) return null;
    const box = bar.closest('.overflow-y-auto') || bar.parentElement;
    const heads = [...document.querySelectorAll('*')].filter(e =>
      e !== bar && !e.contains(bar) && getComputedStyle(e).position === 'sticky'
      && parseFloat(getComputedStyle(e).top || '0') === 0 && e.getBoundingClientRect().height > 20);
    const barR = bar.getBoundingClientRect();
    const worst = heads.map(h => h.getBoundingClientRect()).reduce((a, r) => Math.max(a, r.bottom - barR.top), -999);
    // 바가 멈춰야 하는 자리 = 위에 붙는 머리줄의 아래끝. 머리줄이 없으면(모바일 창은
    // 머리줄이 스크롤 통 **밖**에 있다) 통의 맨 위가 그 자리다.
    const 멈출자리 = heads.length
      ? Math.max(...heads.map(h => h.getBoundingClientRect().bottom))
      : box.getBoundingClientRect().top;
    const cs = getComputedStyle(bar);
    // 투명도 읽기 — 정규식을 안 쓴다(이 코드는 백틱 문자열로 넘어가서 역슬래시가
    // 삼켜진다 · §6). 테일윈드 4는 rgba()가 아니라 **oklab(L a b / .9)** 로도 적는다 —
    // 쉼표 네 조각만 보면 반투명을 불투명으로 잘못 읽는다(실제로 그랬다).
    const 알파of = (bg) => {
      const open = bg.indexOf('(');
      if (open < 0) return bg === 'transparent' ? 0 : 1;
      const inside = bg.slice(open + 1, bg.lastIndexOf(')'));
      const slash = inside.indexOf('/');
      const raw = slash >= 0 ? inside.slice(slash + 1).trim()
        : (inside.split(',').length === 4 ? inside.split(',')[3].trim() : '1');
      const n = parseFloat(raw);
      if (!isFinite(n)) return 1;
      return raw.endsWith('%') ? n / 100 : n;
    };
    // 붙었을 때의 배경은 **통의 바탕색**이어야 한다(상자가 아니라 줄이다)
    const 통배경 = (() => {
      for (let n = bar.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (알파of(c) > 0) return c;
      }
      return '';
    })();
    return {
      머리줄수: heads.length,
      겹침px: Math.round(worst),
      떨어진px: Math.round(barR.top - 멈출자리),
      배경: cs.backgroundColor,
      통배경,
      알파: 알파of(cs.backgroundColor),
      블러: cs.backdropFilter,
      그림자: cs.boxShadow,
      둥근: cs.borderTopLeftRadius,
      좌선: cs.borderLeftWidth, 우선: cs.borderRightWidth,
      위선: cs.borderTopWidth, 아래선: cs.borderBottomWidth,
      z바: Number(getComputedStyle(bar).zIndex) || 0,
      z머리: heads.length ? Math.max(...heads.map(h => Number(getComputedStyle(h).zIndex) || 0)) : 0,
      좌우가_본문과_같다: Math.abs(barR.left - (bar.nextElementSibling?.getBoundingClientRect().left ?? barR.left)) < 1.5,
    };
  })()`);
  await sleep(400);
  check(`${label}: 서식 바가 머리줄과 안 겹친다`, !!tb && tb.겹침px <= 1, JSON.stringify(tb));
  check(`${label}: 머리줄이 더 위 층이다`, !!tb && (tb.머리줄수 === 0 || tb.z바 < tb.z머리), JSON.stringify(tb));
  check(`${label}: 붙어도 상세 내용 칸 폭 그대로다`, !!tb && tb.좌우가_본문과_같다 === true, JSON.stringify(tb));
  // **머리줄 '바로' 아래여야 한다.** 처음 나간 판은 서식 바 자신이 top:0이라
  // useStickyTop의 그물에 걸려 자기 키만큼 자기를 내려 세웠다 — 머리줄이 더 큰
  // 데스크톱에서는 안 보였고, 머리줄이 없는 모바일에서만 본문 한가운데에 떴다
  // (사용자 지적 2026-08-30). 위로 올라가지도, 아래로 내려가지도 않는다.
  check(`${label}: 서식 바가 머리줄 바로 아래에 선다`, !!tb && Math.abs(tb.떨어진px) <= 1, JSON.stringify(tb));
  // 밑으로 지나가는 글이 비치면 안 된다(사용자 결정 2026-08-30 — "투명도 안 넣고 그냥
  // 그대로 딸려오게만"). 블러도 없다(§6-9-aa).
  check(`${label}: 서식 바 배경이 완전 불투명하다`, !!tb && tb.알파 === 1, JSON.stringify(tb));
  check(`${label}: 서식 바에 블러가 없다`, !!tb && tb.블러 === 'none', JSON.stringify(tb));
  // **붙으면 상자가 아니라 줄이다**(사용자 결정 2026-09-11) — 둥근 모서리 0 · 좌우·위 선
  // 없음 · 아래 선 하나 · 연한 그림자 · 통과 같은 바탕색.
  // **되돌리기**: 붙었을 때의 `rounded-none border-x-0 border-t-0 shadow-soft`를 떼면
  // 아래 세 줄이 깨진다.
  check(`${label}: 붙으면 둥근 모서리가 없다`, !!tb && parseFloat(tb.둥근) === 0, JSON.stringify(tb));
  check(`${label}: 붙으면 좌우·위 선이 없고 아래 선만 남는다`,
    !!tb && parseFloat(tb.좌선) === 0 && parseFloat(tb.우선) === 0
    && parseFloat(tb.위선) === 0 && parseFloat(tb.아래선) > 0, JSON.stringify(tb));
  check(`${label}: 붙으면 연한 그림자와 통의 바탕색으로 눕는다`,
    !!tb && tb.그림자 !== 'none' && tb.배경 === tb.통배경, JSON.stringify(tb));
  st.tasks.byId[firstId].content = '내용';
}


// ── 서식 바 매트릭스 — 폭 여섯 × 자리 셋 (사용자 요구 2026-09-11) ──────────
// "서식 바 쪽은 좀 더 철저히 — 반응형으로 모든 기기에서 다 잘 되도록."
//
// **폭 분기가 없다**(사용자 결정 2026-09-11 저녁 — "그냥 데스크톱처럼 똑같은 방식으로
// 모바일·태블릿에서도 되게"). 375·390·430도 768·1024·1440과 **같은 sticky 한 벌**이다.
// 그 전에 모바일만 화면 아래(키보드 위)에 fixed로 세웠는데, 실기기 아이폰에서
// `visualViewport` 계산이 키보드 위에 서지 않아 걷었다(§6-9-aa-4).
//
// 자리 셋은 **스크롤 통이 서로 다른 세 곳**이다(MarkdownEditor의 useStickyTop 머리말):
// 업무 창은 모달 안 통(데스크톱은 머리줄이 통 안에 sticky로, 모바일 풀스크린 창은 통
// **밖**에 있다), 예배 노트·묵상 노트는 페이지 통(App의 main · 통 안에 머리줄이 없어
// top이 `-paddingTop`이다 — 모바일에서는 그 자리가 곧 `MobileTopBar` 바로 밑이다).
//
// 재는 것: (a) 안 붙었을 때 둥근 상자로 편집 칸 위에 있다 (b) 스크롤해 붙이면 '줄'이 되고
// 머리줄(없으면 통 위) 바로 밑이다 (c) 가로로 안 넘친다 (d) **body 직계 자식 포털이 없다**
// — 걷어낸 고정 갈래로 되돌아가는 것을 막는 줄이다.
//
// **되돌리기**: 붙었을 때의 `rounded-none border-x-0 border-t-0 shadow-soft`를 떼면 (b)가,
// IntersectionObserver의 `root`를 떼면 페이지 통 줄들의 (b)가, 바를 다시
// `createPortal(document.body)`로 빼면 (d)가 깨진다.
{
  const waitFor = async (expr, to = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < to) { if (await ev(`!!(${expr})`)) return true; await sleep(150); }
    return false;
  };
  const firstId = Object.keys(st.tasks.byId)[0];
  st.tasks.byId[firstId].content = 긴본문;

  // 종이가 통보다 길어야 바가 실제로 붙는다 — 도막 하나를 길게 쓴 노트를 심는다
  const 줄들 = Array.from({ length: 40 }, (_, i) => `노트 ${i + 1}번째 줄입니다`).join('\n');
  const 예배노트 = `### 본문\n이사야 32:9-20\n### 말씀 요약\n${줄들}\n### 나의 결단\n한 줄\n### 기도\n한 줄\n`;
  const 묵상노트 = `### 본문\n여호수아 4:1-14\n### 나의 결단\n${줄들}\n### 기도\n한 줄\n`;
  // 게스트에서 예배·말씀 화면이 보는 자리(services/worship.js · services/word.js). 여기서는
  // 노트 편집기까지 가는 데 필요한 최소만 심는다 — 주보 한 건과 그 노트, 오늘의 QT 한 줄.
  const WSEED = {
    people: [{ id: 'p1', name: '노준석', profile_id: 'u1' }],
    people_roles: [], groups: [], group_members: [], attendance: [], files: [],
    services: [{
      id: 's1', kind: 'sunday', service_date: D(-3), status: 'published',
      title: '흔들리지 않는 기쁨', passage_ref: '이사야 32:9-20', preacher: '임성빈 전도사님',
      roles: [], songs: [], notices: [], attendance_note: '',
    }],
    service_notes: [{ service_id: 's1', body: 예배노트, shared_to_sun: false }],
  };
  const QSCHED = { [D(0)]: { passage_ref: '수 4:1-14', label: '사귐의 기도' } };
  const QENTRY = { [D(0)]: { body: 묵상노트, shared: false } };

  // 페이지에 심는 손 — 바·통·머리줄을 앱과 **같은 규칙**으로 찾는다(useStickyTop과 한 쌍).
  const HELPERS = `(() => {
    const 통찾기 = (el) => {
      let n = el;
      while (n && n !== document.body) {
        const oy = getComputedStyle(n).overflowY;
        if (oy !== 'visible' && oy !== 'clip') return n;
        n = n.parentElement;
      }
      return null;
    };
    const 머리줄 = (통, bar) => (!통 ? [] : [...통.querySelectorAll('*')].filter(e =>
      e !== bar && !e.contains(bar) && !bar.contains(e)
      && getComputedStyle(e).position === 'sticky'
      && parseFloat(getComputedStyle(e).top || '0') === 0
      && e.getBoundingClientRect().height > 20));
    const 부품 = (sel) => {
      const tip = document.querySelector(sel);
      const bar = document.querySelector('[data-editor-bar]');
      if (!tip || !bar) return null;
      const wrap = tip.closest('div.relative');
      const box = wrap ? [...wrap.children].find(c => c.contains(tip)) : null;
      return { tip, bar, wrap, box, 통: wrap ? 통찾기(wrap.parentElement) : null };
    };
    const 멈출자리of = (p) => {
      const heads = 머리줄(p.통, p.bar);
      return heads.length ? Math.max(...heads.map(h => h.getBoundingClientRect().bottom))
        : (p.통 ? p.통.getBoundingClientRect().top : 0);
    };
    window.__bar = (sel) => {
      const p = 부품(sel);
      if (!p) return { 없음: true };
      const cs = getComputedStyle(p.bar);
      const r = p.bar.getBoundingClientRect();
      const br = p.box ? p.box.getBoundingClientRect() : null;
      const d = document.documentElement;
      return {
        갈래: p.bar.getAttribute('data-editor-bar'),
        보임: cs.display !== 'none', 자리: cs.position,
        top: Math.round(r.top), bottom: Math.round(r.bottom), 높이: Math.round(r.height),
        칸위: br ? Math.round(br.top) : null,
        body자식: p.bar.parentElement === document.body,
        둥근: parseFloat(cs.borderTopLeftRadius) || 0,
        좌선: parseFloat(cs.borderLeftWidth) || 0, 우선: parseFloat(cs.borderRightWidth) || 0,
        위선: parseFloat(cs.borderTopWidth) || 0, 아래선: parseFloat(cs.borderBottomWidth) || 0,
        그림자: cs.boxShadow, 멈출자리: Math.round(멈출자리of(p)), 통있음: !!p.통,
        넘침: d.scrollWidth - d.clientWidth,
      };
    };
    // 바가 **막 붙는 자리**로 통을 굴린다 — 끝까지 내리면 감싸개가 통째로 위로 빠져나가
    // 바가 sticky를 놓는다(붙은 상태가 아니게 된다).
    window.__stick = (sel, extra) => {
      const p = 부품(sel);
      if (!p || !p.통) return -1;
      const dy = p.wrap.getBoundingClientRect().top - 멈출자리of(p) + extra;
      p.통.scrollTop = Math.max(0, Math.min(p.통.scrollHeight - p.통.clientHeight, p.통.scrollTop + dy));
      return p.통.scrollTop;
    };
  })()`;

  const loadM = async (m, path) => {
    await send('Emulation.setDeviceMetricsOverride', m);
    await send('Emulation.setTouchEmulationEnabled', { enabled: !!m.mobile, maxTouchPoints: 5 });
    await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
    await ev(`(() => {
      localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))});
      localStorage.setItem('theme', 'light');
      localStorage.setItem('church_worship_v1', ${JSON.stringify(JSON.stringify(WSEED))});
      localStorage.setItem('word_qt_schedule', ${JSON.stringify(JSON.stringify(QSCHED))});
      localStorage.setItem('word_qt_entries', ${JSON.stringify(JSON.stringify(QENTRY))});
    })()`);
    await send('Page.navigate', { url: URL_BASE + path }); await wait('Page.loadEventFired');
    await sleep(1800);
    await ev(HELPERS);
  };

  const 자리들 = [
    {
      이름: '업무 창', path: `/?p=p1&t=${firstId}`, tip: '.fixed.inset-0.z-50 .tiptap',
      열기: async () => {
        await ev(clickText('수정'));
        return waitFor(`document.querySelector('.fixed.inset-0.z-50 .tiptap')`);
      },
    },
    {
      이름: '예배 노트', path: '/?p=worship', tip: '.worship-note .tiptap',
      열기: async () => {
        if (!await waitFor(`document.querySelector('.worship-card')`)) return false;
        await ev(`document.querySelector('.worship-card').click()`);
        if (!await waitFor(`document.querySelector('.worship-note-edit')`)) return false;
        await ev(`document.querySelector('.worship-note-edit').click()`);
        return waitFor(`document.querySelector('.worship-note .tiptap')`);
      },
    },
    {
      이름: '묵상 노트', path: '/?p=word', tip: '.qt-note-editor .tiptap',
      열기: async () => {
        const 수정 = `[...document.querySelectorAll('[data-note="read"] button')].find(b => b.textContent.trim() === '수정')`;
        if (!await waitFor(수정)) return false;
        await ev(`${수정}.click()`);
        return waitFor(`(() => { const t = document.querySelector('.qt-note-editor .tiptap'); return t && t.offsetParent; })()`);
      },
    },
  ];

  for (const w of [375, 390, 430, 768, 1024, 1440]) {
    for (const 자리 of 자리들) {
      const 이름 = `${w}px · ${자리.이름}`;
      const S = JSON.stringify(자리.tip);
      await loadM({ width: w, height: 844, deviceScaleFactor: 1, mobile: w < 768 }, 자리.path);
      if (!await 자리.열기()) { check(`${이름}: 편집기가 열린다`, false, '편집기를 못 열었다'); continue; }
      await sleep(600);
      const 안붙음 = await ev(`window.__bar(${S})`);
      const 굴림 = await ev(`window.__stick(${S}, 150)`);
      await sleep(700);
      const 붙음 = await ev(`window.__bar(${S})`);
      check(`${이름}: 안 붙었을 때 둥근 상자로 편집 칸 위에 있고 가로로 안 넘친다`,
        !!안붙음 && 안붙음.갈래 === 'sticky' && 안붙음.보임 === true
        && 안붙음.bottom <= 안붙음.칸위 + 1 && 안붙음.둥근 > 0 && 안붙음.넘침 <= 1,
        JSON.stringify(안붙음));
      check(`${이름}: 붙으면 줄이 되고 머리줄 바로 밑이다`,
        !!붙음 && 굴림 > 0 && 붙음.둥근 === 0 && 붙음.좌선 === 0 && 붙음.우선 === 0
        && 붙음.위선 === 0 && 붙음.아래선 > 0 && 붙음.그림자 !== 'none'
        && Math.abs(붙음.top - 붙음.멈출자리) <= 1,
        JSON.stringify({ 굴림, ...붙음 }));
      // **body 직계 자식이 아니어야 한다** — 걷어낸 화면 아래 고정 갈래는 바를 포털로
      // body에 뺐다. sticky는 제자리에 있어야 붙으므로, 포털이 돌아오면 이 줄이 깨진다.
      check(`${이름}: 바가 body 포털로 빠져 있지 않다`,
        !!붙음 && 붙음.body자식 === false && 붙음.자리 === 'sticky',
        JSON.stringify({ body자식: 붙음 && 붙음.body자식, 자리: 붙음 && 붙음.자리 }));
    }
  }
  st.tasks.byId[firstId].content = '내용';
}


// ── 업무 창에는 링크가 없다 (2026-09-11에 되돌렸다) ─────────────────────────
// 2026-09-10에 0058의 링크를 첨부 구역 안 한 목록(`+ 파일`·`+ 링크`)으로 옮겼는데,
// 사용자가 "링크 첨부 방식을 넣지 말고 기존처럼 돌리되"라고 판단해서 걷었다(§6-35).
// 링크가 달려 있어도 업무 창에는 링크 줄도, '+ 링크'도, '참고 링크'라는 말도 없다.
// 링크는 **프로젝트 헤더**에만 남는다(칩 · `+ 참고 링크` — 그쪽 검사는 위 헤더 절).
{
  const firstId = Object.keys(st.tasks.byId)[0];
  st.tasks.byId[firstId].pinnedLinks = [
    { id: 'lk1', title: '수련회 예산표', url: 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=0' },
  ];
  await load(DESK, `/?p=p1&t=${firstId}`);
  // 모달 안에서만 본다 — 프로젝트 헤더의 칩은 창 뒤에 그대로 서 있어야 한다.
  const box = `(() => {
    const m = document.querySelector('.fixed.inset-0.z-50');
    if (!m) return { 창: false };
    const btn = (t) => [...m.querySelectorAll('button')].some(b => b.textContent.trim() === t);
    return {
      창: true,
      링크줄: [...m.querySelectorAll('a')].some(x => x.textContent.trim() === '수련회 예산표'),
      추가링크: btn('+ 링크'), 추가참고링크: btn('+ 참고 링크'),
      참고링크문구: /참고 링크/.test(m.textContent),
      옛줄: !!document.querySelector('.task-links'),
      헤더칩: [...document.querySelectorAll('a')].some(x => x.textContent.trim() === '기획안'),
    };
  })()`;
  const view = await ev(box);
  check('업무 보기: 링크 줄이 없다', view.창 === true && view.링크줄 === false, JSON.stringify(view));
  check("업무 보기: '참고 링크'라는 말도 '+ 링크'도 없다",
    view.참고링크문구 === false && view.추가링크 === false && view.추가참고링크 === false && view.옛줄 === false,
    JSON.stringify(view));
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='수정')?.click()`);
  await sleep(1100);
  const edit2 = await ev(box);
  check('업무 수정: 링크를 붙이는 버튼이 없다',
    edit2.추가링크 === false && edit2.추가참고링크 === false && edit2.링크줄 === false, JSON.stringify(edit2));
  // 되돌린 것은 **업무 창뿐이다** — 같은 링크가 프로젝트 헤더에는 그대로 서 있다
  check('프로젝트 헤더의 참고 링크 칩은 그대로다', edit2.헤더칩 === true, JSON.stringify(edit2));
  delete st.tasks.byId[firstId].pinnedLinks;   // 뒤 검사들이 쓰는 상태로 되돌린다
}

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,6).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
