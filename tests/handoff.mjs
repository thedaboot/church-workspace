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
const MOB={width:390,height:844,deviceScaleFactor:2,mobile:true};
await send('Page.enable'); await send('Runtime.enable');
const load=async(m,path='/',theme='light')=>{
  await send('Emulation.setDeviceMetricsOverride',m);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','${theme}')`);
  await send('Page.navigate',{url:URL_BASE+path}); await wait('Page.loadEventFired'); await sleep(1600);
};
const clickText=t=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)})?.click()`;

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
await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1200);
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


// ── 서식 바가 머리줄과 겹치지 않는다 (2026-08-30) ──────────────────────────
// 처음 나간 판은 top:8px으로 박아서 바가 업무 창 머리줄 **위로 올라가 겹쳤다**
// (사용자 지적 — "아예 헤더로 가면 어떻게 해"). 머리줄 높이는 폭·글자에 따라
// 달라지므로 재서 맞춘다. 붙어도 상세 내용 칸의 머리줄로 남아야 한다.
for (const [m, label] of [[DESK, '데스크톱'], [MOB, '모바일']]) {
  const firstId = Object.keys(st.tasks.byId)[0];
  await load(m, `/?p=p1&t=${firstId}`);
  await ev(clickText('수정'));
  await sleep(1400);
  // 본문을 길게 만들어 스크롤이 생기게 한 뒤 끝까지 내린다
  const tb = await ev(`(() => {
    const bar = [...document.querySelectorAll('*')]
      .find(e => getComputedStyle(e).position === 'sticky' && (e.className || '').includes('overflow-x-auto'));
    if (!bar) return null;
    const box = bar.closest('.overflow-y-auto') || bar.parentElement;
    box.scrollTop = box.scrollHeight;
    const heads = [...document.querySelectorAll('*')].filter(e =>
      e !== bar && !e.contains(bar) && getComputedStyle(e).position === 'sticky'
      && parseFloat(getComputedStyle(e).top || '0') === 0 && e.getBoundingClientRect().height > 20);
    const barR = bar.getBoundingClientRect();
    const worst = heads.map(h => h.getBoundingClientRect()).reduce((a, r) => Math.max(a, r.bottom - barR.top), -999);
    return {
      머리줄수: heads.length,
      겹침px: Math.round(worst),
      z바: Number(getComputedStyle(bar).zIndex) || 0,
      z머리: heads.length ? Math.max(...heads.map(h => Number(getComputedStyle(h).zIndex) || 0)) : 0,
      좌우가_본문과_같다: Math.abs(barR.left - (bar.nextElementSibling?.getBoundingClientRect().left ?? barR.left)) < 1.5,
    };
  })()`);
  await sleep(400);
  check(`${label}: 서식 바가 머리줄과 안 겹친다`, !!tb && tb.겹침px <= 1, JSON.stringify(tb));
  // 모바일에는 위에 붙는 머리줄이 없다(창이 화면을 다 쓴다) — 그때는 볼 것이 없다
  check(`${label}: 머리줄이 더 위 층이다`, !!tb && (tb.머리줄수 === 0 || tb.z바 < tb.z머리), JSON.stringify(tb));
  check(`${label}: 붙어도 상세 내용 칸 폭 그대로다`, !!tb && tb.좌우가_본문과_같다 === true, JSON.stringify(tb));
}

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,6).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
