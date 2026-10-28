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
ws.send(JSON.stringify({ id: 0, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));   // 누른 내려받기(.ics·공유 이미지)가 사용자 다운로드 폴더에 쌓이지 않게(2026-10-22)
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
  updatedAt:'2026-07-01T00:00:00Z',comments:[],attachments:[],
  activityLog:[{id:'a'+i,action:"상태를 '시작 전'에서 '진행 중'(으)로 변경했습니다.",author:'노준석',timestamp:new Date(Date.now()-(i+1)*7*60e3).toISOString()}]});
const byId={},allIds=[];
[['시작 전','2026-07-28'],['진행 중','2026-07-30'],['보류 중','2026-07-29'],['완료','2026-07-27'],['시작 전','2026-07-20']]
  .forEach(([s,d],i)=>{const t=mk(i,s,d);byId[t.id]=t;allIds.push(t.id);});
// 지워진 카드의 활동도 피드에 남는다(div 분기) — 버튼 줄과 박스가 같아야 시간이 정렬된다
byId.t0.activityLog.push({id:'ghost',action:'댓글을 남겼습니다.',author:'노준석',timestamp:new Date(Date.now()-3*60e3).toISOString()});
const st={currentUser:{name:'노준석',team:'찬양팀',teams:['찬양팀','임원진']},
  members:[{id:'u1',name:'노준석',avatarUrl:'',team:'찬양팀',teams:['찬양팀','임원진'],birthday:'',lastSeenAt:'',joinedAt:'2026-07-01T00:00:00Z'},
           {id:'u2',name:'조준환',avatarUrl:'',team:'엔지니어팀',teams:['엔지니어팀'],birthday:'',lastSeenAt:'',joinedAt:'2026-07-02T00:00:00Z'}],
  projects:{byId:{p1:{id:'p1',title:'2026 하계 수련회',pinnedLinks:[]}},allIds:['p1']},tasks:{byId,allIds}};
await send('Page.enable');await send('Runtime.enable');
const load=async(m,theme)=>{
  await send('Emulation.setDeviceMetricsOverride',m);
  await send('Emulation.setTouchEmulationEnabled',{enabled:!!m.mobile,maxTouchPoints:5});
  await send('Page.navigate',{url:URL_BASE});await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(st))}); localStorage.setItem('theme','${theme}')`);
  await send('Page.navigate',{url:URL_BASE+'/'});await wait('Page.loadEventFired');await sleep(1500);
  // 첫 화면이 홈(교회 생활)이 되면서(2026-09-02, A안) 대시보드로 한 번 이동한다.
  // 모바일은 데스크톱 내비가 마운트되지 않으므로(§6-3) 하단 바 '업무' → '대시보드'로 간다.
  await ev(`(() => {
    const desk=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='업무 대시보드');
    if (desk) { desk.click(); return; }
    const nav=document.querySelector('nav');
    const work=[...(nav?.querySelectorAll('button')||[])].find(x=>x.textContent.trim()==='업무');
    work && work.click();
  })()`);
  await sleep(500);
  await ev(`(() => {
    const nav=document.querySelector('nav');
    const d=[...(nav?.querySelectorAll('button')||[])].find(x=>x.textContent.trim()==='대시보드');
    d && d.click();
  })()`);
  await sleep(800);
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
    // 진척도 칸도 2026-08-31부터 .dc-kpi다(순번 애니메이션을 같이 받는다) — 두 번
    // 세지 않게 Set으로 합친다.
    const cells=[...document.querySelectorAll('main .dc-kpi')].filter(vis);
    const progLabel=[...document.querySelectorAll('main span')]
      .find(s=>s.textContent.trim()==='전체 진척도' && vis(s));
    const progCell=progLabel?progLabel.parentElement.parentElement:null;
    const all=progCell?[...new Set([...cells,progCell])]:cells;
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
      // 상태 글자는 두 벌 있다 — 좁은 화면용(메타 줄)과 넓은 화면용(오른쪽 칩).
      // 안 쓰는 쪽은 display:none으로 DOM에 남아 있으므로 '보이는 쪽'을 골라야 한다.
      // 배지 껍데기도 textContent가 같으니 자식 없는 잎 노드만 본다.
      const st=spans.filter(s=>!s.children.length && /^(시작 전|진행 중|보류 중|완료)$/.test(s.textContent.trim()))
                    .find(s=>s.getBoundingClientRect().width>0);
      const dot=st?st.previousElementSibling:null;
      const d=dot?dot.getBoundingClientRect():null;
      // 제목 — 좁은 화면에서 상태·담당자를 메타 줄로 내린 이유가 이 폭이다
      const ti=spans.find(s=>!s.children.length && /^업무 [0-9]$/.test(s.textContent.trim()));
      // 담당자 아바타(이름 첫 글자). 상태 글자처럼 두 벌이라 보이는 쪽을 고른다.
      const av=spans.filter(s=>!s.children.length && s.textContent.trim()==='노')
                    .find(s=>s.getBoundingClientRect().width>0);
      return { title:r.textContent.slice(0,10), status:st?st.textContent.trim():null,
               dotPx:d?Math.round(d.width):0, titlePx: ti?Math.round(ti.getBoundingClientRect().width):0,
               avatarPx: av?Math.round(av.getBoundingClientRect().width):0 };
    });
  })()`);
  check(`${label}: 마감 목록에 행이 있다`, soon.length>0, `${soon.length}행`);
  check(`${label}: 완료는 대시보드 마감 목록에서 빠진다`, !soon.some(r=>r.status==='완료'), JSON.stringify(soon.map(r=>r.status)));
  // 상태는 두 폭 다 글자로 읽혀야 한다. 좁은 화면은 오른쪽 칩을 없애고 제목 아래
  // 메타 줄에 두는 방식 — 점만 남기면 색과 상태의 대응을 외워야 읽혔다.
  check(`${label}: 상태 글자가 보인다`, soon.every(r=>r.status), JSON.stringify(soon.map(r=>r.status)));
  check(`${label}: 상태 점이 6px 이상`, soon.every(r=>r.dotPx>=6), JSON.stringify(soon.map(r=>r.dotPx)));
  // 담당자도 두 폭 다 보인다(좁은 화면은 메타 줄 오른쪽 끝).
  check(`${label}: 담당자 아바타가 보인다`, soon.every(r=>r.avatarPx>=14), JSON.stringify(soon.map(r=>r.avatarPx)));
  // 상태·담당자를 메타 줄로 내린 대가로 제목 줄은 폭을 그대로 쓴다(제목이 주인공인 목록).
  // 둘 중 하나라도 제목 옆으로 되돌리면 여기서 걸린다.
  if (m.mobile) check(`${label}: 제목 폭 260px 이상`, soon.every(r=>r.titlePx>=260), JSON.stringify(soon.map(r=>r.titlePx)));
  const over=await ev(`(() => { const m=document.querySelector('main'); return Math.round(m.scrollWidth-m.clientWidth); })()`);
  check(`${label}: 가로 넘침 없음`, over<=0, `초과 ${over}px`);
  await shot(label==='모바일'?'fix-mob-dashboard':'fix-desk-dashboard');
}
// ── 최근 활동 피드(#3) + 연결 지도(#28) ──
// 게스트에서는 피드가 tasks의 activityLog에서 파생된다(셀렉터 폴백) — 시드에 기록을 넣었다.
const feed = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='최근 활동');
  if(!h) return null;
  const txt=h.closest('div').parentElement.textContent||'';
  return { rows:(txt.match(/변경했습니다/g)||[]).length, hasAgo:/분 전|시간 전/.test(txt) };
})()`);
check('최근 활동 피드가 있다(게스트=활동 기록에서 파생)', !!feed && feed.rows>=3, JSON.stringify(feed));
check('피드 줄에 상대 시간이 붙는다', feed?.hasAgo===true, JSON.stringify(feed));
// 시간 라벨은 전부 같은 오른쪽 선에 서야 한다 — 줄 박스가 하나라도 다르면(버튼 vs div)
// 그 줄만 시간이 다른 x에 서서 목록이 흐트러져 보인다(사용자 지적)
const feedAlign = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='최근 활동');
  if(!h) return null;
  const card=h.closest('div').parentElement;
  const times=[...card.querySelectorAll('span')]
    .filter(s=>/^([0-9]+(초|분|시간|일|주|개월|년) 전)$/.test(s.textContent.trim()))
    .map(s=>Math.round(s.getBoundingClientRect().right));
  return { times, uniq:[...new Set(times)] };
})()`);
check('피드 시간 라벨이 같은 오른쪽 선에 선다', !!feedAlign && feedAlign.times.length>=3 && feedAlign.uniq.length===1,
  JSON.stringify(feedAlign));
// 2026-08-26부터 목록형이 아니라 힘 기반 노드 그래프다 — 선은 <line>, 팀·프로젝트는
// 클릭되는 버튼 노드. 높이는 사람 수와 무관하게 고정이어야 한다(그게 바꾼 이유다).
await sleep(2800);   // 자리 잡는 모션(SETTLE_MS)이 끝난 뒤에 잰다
const map = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='프로젝트 연결 지도');
  if(!h) return null;
  const wrap=h.closest('div').parentElement;
  const t=wrap.textContent||'';
  const canvas=wrap.querySelector('svg')?.parentElement;
  return { people:/노준석/.test(t)&&/조준환/.test(t), hint:/사람/.test(t)&&/프로젝트/.test(t),
           lines: wrap.querySelectorAll('svg path').length,   // 에지는 곡선 path다(2026-08-27)
           nodes: [...wrap.querySelectorAll('button')].length,
           height: canvas ? Math.round(canvas.getBoundingClientRect().height) : 0 };
})()`);
check('연결 지도에 사람 노드가 있다', map?.hint===true && map?.people===true, JSON.stringify(map));
check('연결 지도에 연결선이 있다', !!map && map.lines>=2, JSON.stringify(map));
check('팀·프로젝트 노드가 눌리는 버튼이다', !!map && map.nodes>=2, JSON.stringify(map));
// 2026-08-31: 높이는 **고정이 아니라 줄 수를 따라가고 상한이 있다**. 340px에 프로젝트
// 15개를 넣으면 한 칸이 22px인데 라벨이 26px이라 겹칠 수밖에 없었다(사용자 스크린샷).
// 지킬 것은 "사람 수만큼 무한히 쌓이지 않는다" — 그래서 상한(모바일 580 · 데스크톱 540)을 본다.
check('그래프 높이에 상한이 있다(사람 수만큼 쌓이지 않는다)', !!map && map.height>0 && map.height<=580, JSON.stringify(map));


// ── 모바일 세 탭 (2026-08-29) ───────────────────────────────────────────────
// 예전에는 아홉 덩이가 세로로 쌓여서 뒤 네 덩이(팀별·청년별·최근 활동·연결 지도)는
// 스크롤이 끝나지 않아 아무도 못 봤다. 탭은 **모바일에만** 있고 데스크톱은 2열 그대로다.
await load({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, 'light');
const tabsOf = () => ev(`(() => {
  const bar = document.querySelector('[role="tablist"][aria-label="대시보드"]');
  if (!bar) return null;
  const btns = [...bar.querySelectorAll('[role="tab"]')];
  const seen = (t) => [...document.querySelectorAll('h3,div')]
    .some(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0);
  return {
    labels: btns.map(b => b.textContent.trim()),
    on: btns.find(b => b.getAttribute('aria-selected') === 'true')?.textContent.trim(),
    // 숨긴 덩이는 DOM에 그대로 있다(display:none) — **보이는지**를 봐야 한다
    due: [...document.querySelectorAll('.dc-row')].some(e => e.getBoundingClientRect().width > 0),
    people: seen('팀별 남은 업무'),
    map: seen('프로젝트 연결 지도'),
  };
})()`);
const pickTab = (name) => ev(`(() => {
  const b = [...document.querySelectorAll('[role="tab"]')].find(x => x.textContent.trim() === ${JSON.stringify(name)});
  if (b) b.click();
  return !!b;
})()`);

const tabsInit = await tabsOf();
check('모바일 대시보드에 세 탭이 있다',
  JSON.stringify(tabsInit?.labels) === JSON.stringify(['업무', '청년', '연결']), JSON.stringify(tabsInit));
check('기본은 업무 탭이고 마감 목록이 보인다',
  tabsInit?.on === '업무' && tabsInit?.due === true, JSON.stringify(tabsInit));
check('업무 탭에서는 청년·연결 덩이가 안 보인다',
  tabsInit?.people === false && tabsInit?.map === false, JSON.stringify(tabsInit));

await pickTab('청년'); await sleep(350);
const tabsPeople = await tabsOf();
check('청년 탭이 팀별 남은 업무를 연다', tabsPeople?.people === true, JSON.stringify(tabsPeople));
check('청년 탭에서는 마감 목록이 빠진다', tabsPeople?.due === false, JSON.stringify(tabsPeople));

await pickTab('연결'); await sleep(350);
const tabsMap = await tabsOf();
check('연결 탭이 연결 지도를 연다', tabsMap?.map === true, JSON.stringify(tabsMap));
check('연결 탭에서는 팀별 남은 업무가 빠진다', tabsMap?.people === false, JSON.stringify(tabsMap));

// 데스크톱에는 탭 줄이 없다 — 있으면 2열 배치를 탭이 덮는다는 뜻이다
await load({ width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, 'light');
const deskTabs = await ev(`(() => {
  const bar = document.querySelector('[role="tablist"][aria-label="대시보드"]');
  return {
    hidden: !bar || bar.getBoundingClientRect().width === 0,
    due: [...document.querySelectorAll('.dc-row')].some(e => e.getBoundingClientRect().width > 0),
    people: [...document.querySelectorAll('div')]
      .some(e => e.textContent.trim() === '팀별 남은 업무' && e.getBoundingClientRect().width > 0),
  };
})()`);
check('데스크톱에는 탭 줄이 없다', deskTabs?.hidden === true, JSON.stringify(deskTabs));
check('데스크톱은 마감 목록과 청년 칸이 같이 보인다',
  deskTabs?.due === true && deskTabs?.people === true, JSON.stringify(deskTabs));

// ── 프로젝트 진행이 연도를 따라간다 (2026-08-29) ────────────────────────────
// 예전에는 보관 여부만 걸러서 해가 쌓일수록 이 칸만 끝없이 길어졌다.
const yearCard = await ev(`(() => {
  const h = [...document.querySelectorAll('h3')].find(x => x.textContent === '프로젝트 진행');
  if (!h) return null;
  const card = h.closest('div').parentElement;
  return {
    // 연도는 이제 **누를 수 있는 버튼**이다(탭 줄이 아니라 여기서 고른다)
    year: h.parentElement.querySelector('button')?.textContent.replace(/[^0-9]/g, '') || '',
    yearIsButton: !!h.parentElement.querySelector('button'),
    total: /[0-9]{4}년 전체/.test(card.textContent || ''),
    // 예전 요약 줄(완료 3 · 진행 2 · …)이 남아 있으면 줄이는 것이 안 먹은 것이다
    oldSummary: /완료 [0-9]+ · 진행 [0-9]+/.test(card.textContent || ''),
  };
})()`);
check('프로젝트 진행 머리줄에 연도가 붙는다', /^[0-9]{4}$/.test(yearCard?.year || ''), JSON.stringify(yearCard));
check('그 해 전체 진척도 줄이 있다', yearCard?.total === true, JSON.stringify(yearCard));
check('연도를 그 칸에서 고를 수 있다', yearCard?.yearIsButton === true, JSON.stringify(yearCard));
check('프로젝트 요약이 한 마디로 줄었다', yearCard?.oldSummary === false, JSON.stringify(yearCard));

// ── 탭 줄의 '+ 프로젝트'가 이웃과 같은 줄에 선다 (2026-08-29) ───────────────
// items-end 줄이라 **아래 테두리 두께만큼** 글자 자리가 정해진다. 탭·더보기·연도는
// 투명 2px을 깔고 있는데 이 버튼만 없어서 글자가 2px 내려앉아 보였다(사용자 지적).
const plusAlign = await ev(`(() => {
  const plus = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '+ 프로젝트');
  if (!plus) return null;
  // 글자가 앉는 자리 = 박스 아래끝에서 아래 테두리를 뺀 값. 박스 아래끝은 items-end라
  // 언제나 같아서, 테두리가 빠진 것은 **글자 자리로만** 드러난다.
  const inkBottom = (el) => Math.round(
    el.getBoundingClientRect().bottom - parseFloat(getComputedStyle(el).borderBottomWidth || 0));
  const row = plus.parentElement;
  const others = [...row.querySelectorAll('button')].filter(b => b !== plus && b.getBoundingClientRect().width > 0);
  return { plus: inkBottom(plus), others: [...new Set(others.map(inkBottom))], n: others.length };
})()`);
check('+ 프로젝트가 이웃 버튼과 같은 밑선에 선다',
  !!plusAlign && plusAlign.n > 0 && plusAlign.others.every(b => Math.abs(b - plusAlign.plus) <= 1),
  JSON.stringify(plusAlign));


// ── 필터 하나가 화면의 숫자 전부를 지배한다 (2026-08-29) ────────────────────
// 예전에는 전체·내 업무·내 팀이 **남은 업무에만** 걸려서, '내 업무'를 골라도 KPI의
// '전체 진척도'와 프로젝트 진행 바는 워크스페이스 전부를 세고 있었다(사용자 지적).
// 이 검사에만 **남의 업무**를 섞은 상태를 쓴다 — 공용 픽스처는 전부 노준석·찬양팀이라
// '전체'와 '내 업무'가 같은 숫자여서 필터가 걸렸는지 아닌지를 가릴 수 없다.
// (공용 픽스처를 건드리면 위쪽 행 수·상태 배열 단정이 전부 밀린다)
const stMix = JSON.parse(JSON.stringify(st));
['x1', 'x2', 'x3'].forEach((id, i) => {
  stMix.tasks.byId[id] = { ...mk(90 + i, i === 0 ? '완료' : '진행 중', '2026-07-31'),
    id, title: '남의 업무 ' + i, assignees: ['조준환'], teams: ['엔지니어팀'] };
  stMix.tasks.allIds.push(id);
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(stMix))}); localStorage.setItem('theme','light')`);
await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1500);
// 첫 화면이 홈이라(2026-09-02) 대시보드로 한 번 이동한다(데스크톱 1440px — gnav가 있다)
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='업무 대시보드'); b && b.click(); })()`);
await sleep(800);
const scopeOf = () => ev(`(() => {
  const cell = [...document.querySelectorAll('div')]
    .find(d => d.children.length && [...d.children].some(c => c.textContent.trim() === '전체 진척도'));
  const box = cell ? cell.parentElement.textContent : '';
  const sub = box.match(/([0-9]+)[/]([0-9]+)건/) || [];
  const h = [...document.querySelectorAll('h3')].find(x => x.textContent === '프로젝트 진행');
  const card = h ? h.closest('div').parentElement.textContent : '';
  const proj = card.match(/([0-9]+)건 중 ([0-9]+)건/) || [];
  return { total: sub[2] || null, projTotal: proj[1] || null };
})()`);
const pickFilter = (label) => ev(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => x.textContent.trim().startsWith(${JSON.stringify('')}) && x.textContent.trim().replace(/ [0-9]+$/, '') === ${JSON.stringify('__L__')});
  if (b) b.click();
  return !!b;
})()`.replace('__L__', label));

const scopeAll = await scopeOf();
const clicked = await pickFilter('내 업무');
await sleep(400);
const scopeMine = await scopeOf();
check('내 업무 칩이 눌린다', clicked === true, String(clicked));
check('전체 진척도가 필터를 따라간다',
  !!scopeAll?.total && !!scopeMine?.total && scopeAll.total !== scopeMine.total,
  JSON.stringify({ scopeAll, scopeMine }));
check('프로젝트 진행 바도 같은 필터를 따라간다',
  !!scopeAll?.projTotal && !!scopeMine?.projTotal && scopeAll.projTotal !== scopeMine.projTotal,
  JSON.stringify({ scopeAll, scopeMine }));

// ── '다녀감'과 '활동'이 같은 시각을 본다 (2026-09-06) ────────────────────────
// 증상(사용자 2026-09-05): "특정 인물이 1분 전에 업무 세부 정보를 수정했다고 뜨는데,
// 그 사람 현황을 보면 4분 전에 떠났다고 뜬다." 라이브에서 실제로 activity가
// last_seen_at보다 225초 뒤였다 — 5분 심장박동이 그 사이의 쓰기를 통째로 못 봤다.
// 이제 화면이 **presence(접속 중) > max(last_seen_at, 그 사람의 최근 활동)**을 본다.
// 여기서는 스토어에 그 상황을 그대로 심는다: 조준환은 40분 전에 다녀갔다고 적혀 있고
// 피드에는 2분 전 활동이 있다. 되돌리기 검사: views.jsx에서 mergeActivitySeen을 빼면
// '40분 전'이 뜨면서 아래 두 단정이 깨진다.
const agoIso = (min) => new Date(Date.now() - min * 60e3).toISOString();
const stSeen = JSON.parse(JSON.stringify(st));
stSeen.members = [
  { id: 'u1', name: '노준석', avatarUrl: '', team: '찬양팀', teams: ['찬양팀'], birthday: '', lastSeenAt: agoIso(1), joinedAt: '2026-07-01T00:00:00Z' },
  { id: 'u2', name: '조준환', avatarUrl: '', team: '엔지니어팀', teams: ['엔지니어팀'], birthday: '', lastSeenAt: agoIso(40), joinedAt: '2026-07-02T00:00:00Z' },
  { id: 'u3', name: '박지호', avatarUrl: '', team: '미디어팀', teams: ['미디어팀'], birthday: '', lastSeenAt: agoIso(40), joinedAt: '2026-07-03T00:00:00Z' },
];
// 서버 피드(클라우드 모양) — actorId가 있어야 사람과 짝이 지어진다
stSeen.activityFeed = [
  { id: 'f1', actorId: 'u2', actorName: '조준환', action: '상세 내용을 수정했습니다.', cardId: 't0', projectId: 'p1', at: agoIso(2) },
];
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(stSeen))}); localStorage.setItem('theme','light')`);
await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1500);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='업무 대시보드'); b && b.click(); })()`);
await sleep(800);
// 머리줄의 'N명'을 눌러 가입한 사람 전체 목록을 연다
await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='현재까지 가입한 사람');
  const b=h?h.parentElement.querySelector('button'):null;
  if (b) b.click();
  return !!b;
})()`);
await sleep(400);
const seenRows = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>/^가입한 사람 [0-9]+명$/.test(x.textContent.trim()));
  if(!h) return null;
  const box=h.closest('div').parentElement;
  const out={};
  [...box.querySelectorAll('span')].forEach(cell=>{
    const nameEl=[...cell.querySelectorAll('span')]
      .find(x=>!x.children.length && /^(노준석|조준환|박지호)$/.test(x.textContent.trim().replace(/나$/,'').trim()));
    if(!nameEl) return;
    const row=cell.parentElement;
    if(!row) return;
    const time=[...row.querySelectorAll('span')]
      .filter(x=>!x.children.length && /^([0-9]+(초|분|시간|일|주|개월|년) 전|방문 전|접속 중)$/.test(x.textContent.trim()))
      .map(x=>x.textContent.trim());
    if(time.length) out[nameEl.textContent.trim().replace(/나$/,'').trim()]=time[time.length-1];
  });
  return out;
})()`);
check('활동이 더 최근이면 그 시각이 다녀감으로 뜬다',
  seenRows && seenRows['조준환'] === '2분 전', JSON.stringify(seenRows));
check('활동이 없는 사람은 다녀간 시각 그대로',
  seenRows && seenRows['박지호'] === '40분 전', JSON.stringify(seenRows));
// 그리고 **피드와 같은 글자**여야 한다 — 두 값이 한 화면에서 서로 다른 말을 하면 안 된다
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='닫기'); b && b.click(); })()`);
await sleep(300);
const feedAgo = await ev(`(() => {
  const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='최근 활동');
  if(!h) return null;
  const card=h.closest('div').parentElement;
  const txt=card.textContent||'';
  const t=[...card.querySelectorAll('span')]
    .filter(x=>!x.children.length && /^[0-9]+(초|분|시간|일|주|개월|년) 전$/.test(x.textContent.trim()))
    .map(x=>x.textContent.trim());
  return { has: /조준환/.test(txt), times: t };
})()`);
check('피드의 그 활동과 다녀감이 같은 시각을 말한다',
  !!feedAgo && feedAgo.has === true && feedAgo.times.includes('2분 전')
    && seenRows && seenRows['조준환'] === '2분 전',
  JSON.stringify({ feedAgo, viewer: seenRows && seenRows['조준환'] }));


// ── '지난 7일 간 N건 끝냈어요'는 **끝낸 날**로 센다 (2026-09-09) ───────────────
// 예전에는 updatedAt으로 셌다. 그런데 끝난 업무에 첨부를 하나 올리기만 해도(0016의
// file_count 트리거가 카드를 건드린다) updated_at이 오늘로 밀려서, **한 달 전에 끝낸
// 업무가 이 줄에 다시 세어졌다.** 지금은 utils.completedTime(cards.completed_at)이고
// 마감 목록의 '끝낸 업무' 구간이 세우고 보여주는 값과 같은 함수다(§4.12).
// 되돌리기 검사: views.jsx의 completedTime(t)를 t.updatedAt으로 돌리면 '2건'이 되어 깨진다.
const daysAgoIso = (n) => new Date(Date.now() - n * 86400e3).toISOString();
const stDone = JSON.parse(JSON.stringify(st));
stDone.tasks.byId = {}; stDone.tasks.allIds = [];
[
  // [id, 끝낸 날, 마지막으로 고친 날] — 둘째 줄이 함정이다(오래 전에 끝냈는데 오늘 고쳐졌다)
  ['d1', daysAgoIso(2), daysAgoIso(2)],
  ['d2', daysAgoIso(40), daysAgoIso(0)],
].forEach(([id, done, upd], i) => {
  stDone.tasks.byId[id] = { ...mk(50 + i, '완료', '2026-07-01'), id, title: '끝낸 업무 ' + i,
    completedAt: done, updatedAt: upd };
  stDone.tasks.allIds.push(id);
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(stDone))}); localStorage.setItem('theme','light')`);
await send('Page.navigate', { url: URL_BASE + '/' }); await wait('Page.loadEventFired'); await sleep(1500);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='업무 대시보드'); b && b.click(); })()`);
await sleep(800);
const doneLine = await ev(`(() => {
  const p=[...document.querySelectorAll('p')].find(x=>/지난 7일 간/.test(x.textContent||''));
  return p ? p.textContent.trim() : null;
})()`);
check('지난 7일 줄이 끝낸 날로 센다(수정한 날이 아니다)', doneLine === '지난 7일 간 1건 끝냈어요', String(doneLine));

// ── 19차 리팩토링(2026-10-07)에서 한 벌로 모은 부품 — 회색 토글 · 혼자 선 KPI 칸 · 프로젝트 화면 훅 순서 ──
// 회색 토글(components/segmented.jsx): 고른 칸만 흰 칸(미끄러지는 .ops-seg-thumb — UI 다듬기 2026-10-26)·진한 글자이고 칸 클래스는 자리마다 그대로다(앞에 relative만 · 통에는 잰 뒤 M17의 dc-seg-clip·dc-seg-live).
// 되돌리기 검사: segStyle의 on/off 글자색을 맞바꾸거나 흰 칸을 고른 칸이 아닌 곳에 두면 첫 단정과 폰 탭 단정이, 폰 탭의 `tabs`를 빼면 폰 탭 단정이 깨진다.
await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired'); await sleep(1400);
const seg = await ev(`(() => {
  const btns = ['보드', '캘린더', '그래프'].map(t => [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === t));
  if (btns.some(b => !b)) return null;
  const box = btns[0].parentElement;
  return {
    same: btns.every(b => b.parentElement === box), boxCls: box.className, boxBg: box.style.background,
    cls: btns.map(b => b.className),
    bg: btns.map(b => b.style.background), fg: btns.map(b => b.style.color),
    thumbOnPick: (() => { const th = box.querySelector('.ops-seg-thumb'); return !!th && Math.abs(th.getBoundingClientRect().left - btns[0].getBoundingClientRect().left) < 1.5; })(),
  };
})()`);
check('프로젝트 보기 토글: 고른 칸(보드)만 흰 바탕 · 진한 글자 · 칸 클래스 그대로',
  !!seg && seg.same && seg.boxCls.replace(' dc-seg-clip', '').replace(' dc-seg-live', '') === 'relative flex p-[3px] rounded-md shrink-0' && seg.boxBg === 'var(--app-surface-hover)'
    && seg.cls.every(c => c === 'relative px-2.5 md:px-3 py-[5px] rounded-sm text-[12.5px] font-semibold transition-colors')
    && seg.bg.join() === 'transparent,transparent,transparent' && seg.thumbOnPick
    && seg.fg.join() === 'var(--app-ink),var(--app-ink-muted),var(--app-ink-muted)',
  JSON.stringify(seg));

// M17(UI 다듬기 2차 · PITFALLS 76-a): 글자색은 흰 칸이 지나가는 만큼만 진해진다 — 글 칸(.dc-seg-l)의 진한 겹(::after)을 흰 칸 자리로 자른다.
// 끝에서 끝(보드 → 표)으로 누른 직후, 움직이는 흰 칸의 왼쪽 끝과 진한 겹의 왼쪽 끝이 같은 자리에 있다(누르는 순간 글자색이 먼저 바뀌지 않는다).
// **되돌리기**: segmented.jsx에서 글을 .dc-seg-l로 싸지 않거나, index.css의 `.dc-seg-live .dc-seg-l::after` 전이를 지우면 깨진다.
const segRead = `(() => {
  const btns = ['보드', '캘린더', '그래프', '표'].map(t => [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === t));
  if (btns.some(b => !b)) return null;
  const box = btns[0].parentElement, th = box.querySelector('.ops-seg-thumb')?.getBoundingClientRect();
  // inset()은 줄인 꼴로 읽힌다(inset(0px -12px round 4px)) — margin처럼 1~4값을 넷으로 편다
  const px = s => { const v = (s.split(' round')[0].match(/-?[0-9.]+(px|%)?/g) || []).map(parseFloat);
    return v.length ? [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]] : []; };
  // 진한 겹이 보이는 가로 구간이 흰 칸과 그 글 칸이 겹친 구간과 같은지(1.5px) — 안 겹치면 겹도 비어 있어야 한다
  const ls = btns.map(b => { const s = b.querySelector('.dc-seg-l'); if (!s || !th) return null;
    const r = s.getBoundingClientRect(), [, rt, , l] = px(getComputedStyle(s, '::after').clipPath);
    const a = r.left + Math.max(0, l ?? r.width), z = r.right - Math.max(0, rt ?? r.width), shown = z - a > 0.5;
    const ea = Math.max(r.left, th.left), ez = Math.min(r.right, th.right), want = ez - ea > 0.5;
    return { data: s.dataset.l, color: getComputedStyle(s).color, after: getComputedStyle(s, '::after').color, shown,
      match: shown === want && (!shown || (Math.abs(a - ea) < 1.5 && Math.abs(z - ez) < 1.5)) }; });
  return { clipBox: box.classList.contains('dc-seg-clip'), thumbLeft: th ? Math.round(th.left) : null, b0: Math.round(btns[0].getBoundingClientRect().left), b3: Math.round(btns[3].getBoundingClientRect().left), ls };
})()`;
const segRest = await ev(segRead);
check('M17 회색 토글 글: 진한 겹은 고른 칸(보드)에만 · 글은 흐린 색 · 겹은 진한 색',
  !!segRest && segRest.clipBox && segRest.ls.every(l => l && l.color !== l.after)
    && segRest.ls.map(l => l.shown).join() === 'true,false,false,false' && segRest.ls.every(l => l.match) && segRest.ls.map(l => l.data).join() === '보드,캘린더,그래프,표',
  JSON.stringify(segRest));
await ev(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '표').click()`);
await sleep(70);
const segMid = await ev(segRead);
check('M17 끝에서 끝으로 누른 직후: 흰 칸이 가는 중이고 진한 겹은 흰 칸이 걸친 만큼만이다(표 글자가 먼저 진해지지 않는다)',
  !!segMid && segMid.thumbLeft > segMid.b0 + 2 && segMid.thumbLeft < segMid.b3 - 2 && segMid.ls.every(l => l?.match),
  JSON.stringify(segMid));
await sleep(500);
const segEnd = await ev(segRead);
check('M17 다 간 뒤: 진한 겹은 표에만', !!segEnd && segEnd.ls.map(l => l.shown).join() === 'false,false,false,true', JSON.stringify(segEnd));
await ev(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '보드').click()`);
await sleep(500);

// 훅 순서(★ 사용자 승인): 보던 프로젝트가 **다른 곳에서** 지워지면(실시간 삭제 · 잘못된 딥링크) 대시보드로
// 돌아가야 한다. 가드가 훅 위에 있던 때는 'Rendered fewer hooks'로 ErrorBoundary가 떴다.
// 되돌리기 검사: projectView.jsx의 `if (!project) return null;`을 useMemo들 위로 올리면 깨진다.
const logsBefore = logs.length;
await ev(`window.__store.dispatch({ type: 'DELETE_PROJECT', payload: 'p1' })`);
await sleep(900);
const afterDel = await ev(`({
  boundary: !!document.querySelector('[data-error-boundary]'),
  dash: [...document.querySelectorAll('main span')].some(s => s.textContent.trim() === '전체 진척도'),
})`);
const hookErr = logs.slice(logsBefore).filter(l => /fewer hooks|Rendered more hooks|change in the order of Hooks/i.test(l));
check('보던 프로젝트가 지워지면 오류 상자 없이 대시보드로 돌아간다',
  afterDel.boundary === false && afterDel.dash === true && hookErr.length === 0,
  JSON.stringify({ ...afterDel, hookErr: hookErr.slice(0, 1) }));

// 혼자 선 KPI 칸(KpiCell phoneNote): 폰에서 격자 칸 메모는 숨지만 '12/30건'·'전체 N건 중'은 값의 분모라 남는다.
// 되돌리기 검사: KpiCell에서 phoneNote를 무시하고 늘 `hidden md:inline`을 붙이면 깨진다.
await load({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, 'light');
const tabs = await ev(`(() => {
  const list = document.querySelector('main [role="tablist"][aria-label="대시보드"]');
  const t = list ? [...list.querySelectorAll('[role="tab"]')] : [];
  const th = list?.querySelector('.ops-seg-thumb'), on = t.find(b => b.getAttribute('aria-selected') === 'true');
  return { names: t.map(b => b.textContent.trim()), sel: t.map(b => b.getAttribute('aria-selected')), bg: t.map(b => b.style.background),
    // 흰 칸은 고른 칸 뒤로 미끄러지는 .ops-seg-thumb이 칠한다(UI 다듬기 2026-10-26 · segmented.jsx) — 버튼은 투명
    thumbOnSel: !!th && !!on && Math.abs(th.getBoundingClientRect().left - on.getBoundingClientRect().left) < 1.5 && getComputedStyle(th).backgroundColor !== 'rgba(0, 0, 0, 0)' };
})()`);
check('폰 대시보드 탭: 세 칸이 role=tab이고 고른 칸만 aria-selected · 흰 칸이 고른 칸 뒤에',
  tabs.names.join() === '업무,청년,연결' && tabs.sel.join() === 'true,false,false'
    && tabs.bg.join() === 'transparent,transparent,transparent' && tabs.thumbOnSel, JSON.stringify(tabs));
const vis = `e => !!e && e.getBoundingClientRect().width > 0`;
const phoneNotes = await ev(`(() => {
  const vis = ${vis};
  const spans = [...document.querySelectorAll('main .dc-kpi span')];
  const prog = spans.find(s => !s.children.length && /^[0-9]+\\/[0-9]+건$/.test(s.textContent.trim()) && vis(s));
  const week = spans.find(s => s.textContent.trim() === '이번 주 토요일까지');
  return { prog: prog ? prog.textContent.trim() : null, weekShown: vis(week), weekInDom: !!week };
})()`);
check('폰: 진척도 칸의 분모 메모(N/M건)는 보이고 격자 칸 메모는 숨는다',
  !!phoneNotes.prog && phoneNotes.weekInDom && !phoneNotes.weekShown, JSON.stringify(phoneNotes));
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.title === '찬양팀 보드로'); b && b.click(); })()`);
await sleep(900);
const teamNote = await ev(`(() => {
  const vis = ${vis};
  const s = [...document.querySelectorAll('main .dc-kpi span')].find(x => /^전체 [0-9]+건 중$/.test(x.textContent.trim()));
  const done = s ? s.closest('.dc-kpi') : null;
  return { note: s ? s.textContent.trim() : null, shown: vis(s), bg: done ? done.style.background : null };
})()`);
check("폰: 팀 보드 '완료' 칸의 '전체 N건 중'이 보이고 바탕은 초록",
  teamNote.shown === true && teamNote.bg === 'var(--app-tag-green)', JSON.stringify(teamNote));

// ── 보드 카드 자물쇠(0099 · 20차 ⑨ 시안 ③) — 잠긴 업무만 제목 앞 12px 자물쇠 · muted · 움직이지 않는다 · 담당자·마감은 그대로 ──
// **되돌리기**: boards.jsx 카드 제목의 <CardLockMark>를 지우면 깨진다.
{
  const lockedSt = JSON.parse(JSON.stringify(st));
  lockedSt.tasks.byId.t1 = { ...lockedSt.tasks.byId.t1, author: '조준환', locked: true, lockedOpen: false };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(lockedSt))}); localStorage.setItem('theme','light')`);
  await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired'); await sleep(1500);
  const mark = await ev(`(() => {
    const cards = [...document.querySelectorAll('.board-card')];
    const card = cards.find(c => c.textContent.includes('업무 1') && !c.textContent.includes('업무 1 0'));
    const lock = card?.querySelector('[data-card-lock]');
    const title = lock?.parentElement;
    const r = lock?.getBoundingClientRect();
    return { lock: !!lock, w: r ? Math.round(r.width) : null, color: lock ? getComputedStyle(lock).color : null,
      muted: getComputedStyle(document.documentElement).getPropertyValue('--app-ink-muted').trim(),
      before: !!lock && title.textContent.trim() === '업무 1' && title.firstElementChild === lock,
      anim: lock ? [getComputedStyle(lock).animationName, getComputedStyle(lock.querySelector('.dc-lock-shackle')).animationName] : null,
      others: cards.filter(c => c !== card && c.querySelector('[data-card-lock]')).length,
      who: card ? /노준석/.test(card.textContent) : false };
  })()`);
  const hex2rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  check('보드 카드: 잠긴 업무만 제목 앞 12px 자물쇠(muted · 움직이지 않음) · 담당자 그대로',
    mark.lock && mark.w === 12 && mark.before && mark.others === 0 && mark.who && mark.color === hex2rgb(mark.muted)
    && JSON.stringify(mark.anim) === '["none","none"]', JSON.stringify(mark));
}

// ── 반응형 점검 후속(2026-10-14 시안 'Graph'·'NetMap'·'Board' · PITFALLS 50-a) ──
// 사람 24 · 프로젝트 13 · 실제 '2026 워크스페이스 개선'을 닮은 업무 25건(사슬 13·9 + 갈래 둘 + 선 없는 하나)으로
// 그래프 알약이 안 겹치고 판 가장자리에 안 붙는지 · 지도 이름이 남의 얼굴에 안 깔리는지 · 보드 네 칸 폭을 잰다.
// 되돌리기: ① depgraph가 자리를 40px 알약으로 짜고(widthOf) box를 지우면(점처럼 밀어내면) '그래프 알약이 안 겹친다'가
// (둘 중 하나만 되돌리면 나머지가 메운다 — 짠 자리와 상자 충돌이 서로의 안전망이다), ② networkMap 사람의
// box를 지우고 spreadBoxes를 spreadLabels로 되돌리면 '이름이 남의 얼굴에 안 깔린다'가, ③ boards의 md:min-w-[180px]을
// 210으로 되돌리면 '820에서 네 칸이 다 들어온다'가, ④ useForceGraph의 resumed 갈래를 지우면 '업무가 늘어도 툭 튀지
// 않는다'가 깨진다.
{
  const TEAMS = ['웰컴팀', '워십팀', '찬양팀', '엔지니어팀', '미디어팀', '임원진', '교역자'];
  const NAMES = ['김우한', '윤현서', '이서진', '양민혁', '노준석', '안병현', '김승찬', '이준원', '조해리', '문진혁', '박지호', '재훈', '김윤주', '이하랑Alex', '손채은', '정민경', '강희라', '시온', '장제훈', '조준환', '신효진', '주재은', '천진영', '김다은'];
  const members = NAMES.map((name, i) => ({ id: 'u' + i, name, avatarUrl: '', team: TEAMS[i % 7],
    teams: i % 5 === 0 ? [TEAMS[i % 7], TEAMS[(i + 3) % 7]] : [TEAMS[i % 7]], birthday: '', lastSeenAt: '', joinedAt: '2026-01-01T00:00:00Z' }));
  const PN = ['2026 웰컴팀', '2026 워크스페이스 개선', '2026 예배팀', '2026 엔지니어링팀', '새신자 관리', '다붓캐스트', '2026 미디어팀', '2026 월례회', '2026 믿음샘 양육', '회계', '2026 가을 체육대회', '더다붓 임원진 회의', '2026 더다붓 예배 2.0'];
  const projects = { byId: {}, allIds: [] };
  PN.forEach((title, k) => { projects.byId['p' + k] = { id: 'p' + k, title, pinnedLinks: [], year: 2026, createdAt: '2026-01-01T00:00:00Z' }; projects.allIds.push('p' + k); });
  const byId = {}, allIds = [];
  let n = 0;
  const ST = ['완료', '완료', '진행 중', '완료', '시작 전'];
  const task = (projectId, title, extra = {}) => {
    const tid = 'c' + (n++);
    byId[tid] = { id: tid, projectId, title, content: '', status: ST[n % 5], assignees: [NAMES[n % 24]], teams: [TEAMS[n % 7]],
      startDate: '', dueDate: `2026-0${1 + (n % 9)}-1${n % 9}`, position: n, author: '노준석', createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z', comments: [], attachments: [], activityLog: [], ...extra };
    allIds.push(tid); return tid;
  };
  const W = [], F = [];
  for (let k = 1; k <= 13; k++) W.push(task('p1', k === 13 ? '워크스페이스 13차 개선 (다붓이)' : `워크스페이스 ${k}차 개선`, { teams: ['찬양팀'], dependsOn: W.length ? [W[W.length - 1]] : [] }));
  for (let k = 1; k <= 9; k++) F.push(task('p1', k === 2 ? '2차 피드백 개선(feedback 묶음)' : `${k}차 피드백 개선`, { teams: ['찬양팀'], dependsOn: F.length ? [F[F.length - 1]] : [W[2]] }));
  task('p1', '추석 맞이 워크스페이스', { teams: ['찬양팀'], dependsOn: [W[9]] });
  task('p1', '더다붓 위키와 다붓이', { teams: ['찬양팀'], dependsOn: [W[11]] });
  task('p1', '워크스페이스 대개편 회의', { teams: ['찬양팀'] });
  PN.forEach((_, k) => { if (k !== 1) for (let j = 0; j < 4; j++) task('p' + k, `업무 ${k}-${j}`, { teams: [TEAMS[(k + j) % 7]], assignees: [NAMES[(k * 3 + j) % 24]] }); });
  const crowd = { currentUser: { name: '노준석', team: '찬양팀', teams: ['찬양팀', '임원진'] }, members, projects, tasks: { byId, allIds } };
  const openCrowd = async (w, path) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 860 : 1000, deviceScaleFactor: 1, mobile: w < 1024 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: w < 1200, maxTouchPoints: w < 1200 ? 5 : 1 });
    await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
    await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(crowd))}); localStorage.setItem('theme','light')`);
    await send('Page.navigate', { url: URL_BASE + path }); await wait('Page.loadEventFired'); await sleep(1400);
  };
  const graphNodes = `[...document.querySelectorAll('main button')].filter(b => /워크스페이스|피드백|다붓이/.test(b.title || ''))`;
  const openGraph = async (w) => {
    await openCrowd(w, '/?p=p1');
    await ev(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '그래프')?.click()`);
  };
  // ① 그래프 — 폴드 바깥 · 아이패드 세로 · 데스크톱
  for (const w of [344, 820, 1440]) {
    await openGraph(w); await sleep(2600);
    const g = await ev(`(() => {
      const btns = ${graphNodes}; const wrap = btns[0]?.parentElement; if (!wrap) return null;
      const C = wrap.getBoundingClientRect(), R = btns.map(b => b.getBoundingClientRect());
      let over = 0;
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
        const a = R[i], b = R[j];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) over++;
      }
      const edge = R.filter(r => r.top - C.top < 3 || C.bottom - r.bottom < 3 || r.left - C.left < 3 || C.right - r.right < 3).length;
      return { n: btns.length, H: Math.round(C.height), over, edge };
    })()`);
    check(`그래프 ${w}px: 업무 25건 알약이 서로 안 겹치고 판 가장자리에 줄지어 붙지 않는다`,
      !!g && g.n === 25 && g.over === 0 && g.edge === 0 && g.H >= (w < 768 ? 360 : 440), JSON.stringify(g));
  }
  // ①-b 폰에서 맨 아래 알약까지 내려갈 수 있다 — 프로젝트 화면은 h-full이라 판이 넘친 몫에 main 아래 여백이 안 붙어 마지막 알약이
  // 하단 바 밑에 깔린 채 멈췄다(사용자 지적 2026-10-18 아이폰 · PITFALLS 68-a). 판은 모든 알약을 담고, 끝까지 내리면 마지막 알약이 하단 바 위.
  // **되돌리기**: depgraph.jsx 뿌리의 pb-[calc(5.5rem+env(safe-area-inset-bottom))]를 지우면 lastBottom > navTop으로 깨진다.
  await openGraph(393); await sleep(2600);
  const reach = await ev(`(() => {
    const m = document.querySelector('main'); m.scrollTop = m.scrollHeight;
    const btns = ${graphNodes}; const wrap = btns[0]?.parentElement; if (!wrap) return null;
    const C = wrap.getBoundingClientRect(), R = btns.map(b => b.getBoundingClientRect());
    const nav = document.querySelector('nav[data-tab-bar]').getBoundingClientRect();
    return { n: btns.length, inside: R.every(r => r.top >= C.top && r.bottom <= C.bottom), lastBottom: Math.round(Math.max(...R.map(r => r.bottom))), navTop: Math.round(nav.top) };
  })()`);
  check('그래프 폰 393: 판이 알약을 다 담고 끝까지 내리면 마지막 알약이 하단 바 위', !!reach && reach.n === 25 && reach.inside && reach.lastBottom <= reach.navTop, JSON.stringify(reach));
  // ①-c 데스크톱도 끝까지 내리면 판 아래에 틈이 남는다(사용자 지적 2026-10-27 — 판이 창 바닥에 붙어 끝났다 · md:pb-0이었다).
  // **되돌리기**: depgraph.jsx 뿌리의 md:pb-4를 md:pb-0으로 되돌리면 gap < 12로 깨진다.
  await openGraph(1280); await sleep(2600);
  const deskGap = await ev(`(() => {
    const m = document.querySelector('main'); m.scrollTop = m.scrollHeight;
    const panel = document.querySelector('[data-graph-root] > .rounded-lg'); if (!panel) return null;
    return { gap: Math.round(m.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom) };
  })()`);
  check('그래프 데스크톱 1280: 끝까지 내리면 판 아래에 12px 넘는 틈', !!deskGap && deskGap.gap >= 12, JSON.stringify(deskGap));
  // ② 업무가 늘어 판이 길어져도 툭 튀지 않는다 — 한 프레임에 움직인 거리 · 판 높이가 같은 곡선으로 늘어나는지
  await openGraph(393); await sleep(3000);
  await ev(`(() => {
    window.__gs = [];
    const t0 = performance.now();
    const tick = () => {
      const btns = ${graphNodes};
      window.__gs.push({ h: btns[0]?.parentElement.getBoundingClientRect().height,
        p: Object.fromEntries(btns.map(b => [b.textContent.trim(), [parseFloat(b.style.left), parseFloat(b.style.top)]])) });
      if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => window.__store.dispatch({ type: 'UPSERT_TASK', payload: { ...window.__store.getState().tasks.byId['${W[12]}'],
      id: 'cnew', title: '워크스페이스 14차 개선', dependsOn: ['${W[12]}'], status: '시작 전', position: 99 } }), 120);
  })()`);
  await sleep(2000);
  const glide = await ev(`(() => {
    const s = window.__gs; let step = 0;
    for (let k = 1; k < s.length; k++) for (const [name, [x, y]] of Object.entries(s[k - 1].p)) {
      const q = s[k].p[name]; if (q) step = Math.max(step, Math.hypot(q[0] - x, q[1] - y));
    }
    const hs = [...new Set(s.map(f => Math.round(f.h)))];
    return { frames: s.length, step: Math.round(step * 10) / 10, heights: hs.length, from: hs[0], to: hs[hs.length - 1],
      added: !!s[s.length - 1].p['워크스페이스 14차 개선'] };
  })()`);
  check('그래프: 업무가 늘어도 알약이 툭 튀지 않고(프레임당 10px 이하) 판 높이가 미끄러지듯 늘어난다',
    glide.added && glide.step <= 10 && glide.to > glide.from && glide.heights >= 4, JSON.stringify(glide));
  // ③ 움직임 줄이기 — 판 높이 전이 없음 · 처음부터 제자리(프레임 사이 움직임 0)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await openGraph(393);
  // 그래프는 lazy라 노드가 처음 나타나는 순간을 기다렸다가 바로 찍는다
  for (let k = 0; k < 60 && (await ev(`${graphNodes}.length`)) < 25; k++) await sleep(25);
  const snapG = `JSON.stringify(${graphNodes}.map(b => [b.style.left, b.style.top]))`;
  const firstSnap = await ev(snapG);
  await sleep(400);
  const still = await ev(`({ same: ${snapG} === ${JSON.stringify(firstSnap)}, n: ${graphNodes}.length,
    tr: ${graphNodes}[0]?.parentElement.style.transition })`);
  check('그래프(움직임 줄이기): 처음부터 제자리 · 판 높이 전이 없음', still.n === 25 && still.same && still.tr === 'none', JSON.stringify(still));
  await send('Emulation.setEmulatedMedia', { features: [] });
  // ④ 연결 지도 — 이름이 남의 얼굴에 안 깔린다(폰 393 · 데스크톱 1440) · 이름에 바탕색 헤일로
  for (const w of [393, 1440]) {
    await openCrowd(w, '/');
    await ev(`(() => { const d=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='업무 대시보드'); if (d) { d.click(); return; }
      const b=[...(document.querySelector('nav')?.querySelectorAll('button')||[])].find(x=>x.textContent.trim()==='업무'); b&&b.click(); })()`);
    await sleep(500);
    await ev(`(() => { const d=[...(document.querySelector('nav')?.querySelectorAll('button')||[])].find(x=>x.textContent.trim()==='대시보드'); d&&d.click(); })()`);
    await sleep(700);
    await ev(`(() => { const t=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim()==='연결'); t&&t.click(); })()`);
    await sleep(3200);
    const nm = await ev(`(() => {
      const h=[...document.querySelectorAll('h3')].find(x=>x.textContent==='프로젝트 연결 지도'); if(!h) return null;
      const ppl=[...h.closest('div').parentElement.querySelectorAll('button[aria-pressed]')];
      const P=ppl.map(b=>({ face:b.children[0].getBoundingClientRect(), name:b.children[1].getBoundingClientRect() }));
      const hit=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5;
      let bad=0; for(let i=0;i<P.length;i++)for(let j=0;j<P.length;j++) if(i!==j&&(hit(P[i].name,P[j].face)||(i<j&&hit(P[i].name,P[j].name)))) bad++;
      return { people:P.length, bad, halo: ppl[0] ? getComputedStyle(ppl[0].children[1]).textShadow : '' };
    })()`);
    check(`연결 지도 ${w}px: 사람 24명의 이름이 남의 얼굴·이름에 안 깔리고 바탕색 헤일로가 있다`,
      !!nm && nm.people === 24 && nm.bad === 0 && /rgb\(.*\) 0px 0px 2px/.test(nm.halo), JSON.stringify(nm));
  }
  // ⑤ 보드 네 칸 — 820(아이패드 세로)은 네 칸이 다 들어오고(칸 180px 이상) 옅음이 없다 ·
  //    800은 가로로 넘기며 오른쪽 끝이 옅고, 끝까지 넘기면 옅음이 걷힌다
  const boardOf = `(() => {
    const sc=[...document.querySelectorAll('main div')].find(d=>d.children.length===4&&[...d.children].every(c=>c.querySelector('h3'))&&getComputedStyle(d).overflowX==='auto');
    if(!sc) return null;
    return { client: sc.clientWidth, scroll: sc.scrollWidth, cols: [...sc.children].map(c => Math.round(c.getBoundingClientRect().width)),
      fade: sc.hasAttribute('data-fade-r'), mask: getComputedStyle(sc).maskImage !== 'none' };
  })()`;
  await openCrowd(820, '/?p=p1');
  const b820 = await ev(boardOf);
  check('보드 820px: 네 칸이 폭을 나눠 다 들어온다(칸 180px 이상 · 가로 넘침·옅음 없음)',
    !!b820 && b820.cols.every(c => c >= 180) && b820.scroll <= b820.client && !b820.fade && !b820.mask, JSON.stringify(b820));
  await openCrowd(800, '/?p=p1');
  const b800 = await ev(boardOf);
  await ev(`(() => { const sc=[...document.querySelectorAll('main div')].find(d=>d.children.length===4&&[...d.children].every(c=>c.querySelector('h3'))&&getComputedStyle(d).overflowX==='auto'); sc.scrollLeft = sc.scrollWidth; })()`);
  await sleep(300);
  const b800end = await ev(boardOf);
  check('보드 800px: 칸 180px로 가로로 넘기고 오른쪽 끝이 옅다 · 끝까지 넘기면 걷힌다',
    !!b800 && b800.cols.every(c => c === 180) && b800.scroll > b800.client && b800.fade && b800.mask && b800end && !b800end.fade,
    JSON.stringify({ b800, end: b800end?.fade }));
}

// ── 그래프 뷰 다듬기(UI 다듬기 2차 G · 2026-10-28 · PITFALLS 80) ──
// 시안의 수련회 프로젝트 하나(업무 10 · 선 7 · 참가 신청 받기 11/5 → 조 편성 11/3이 일정 충돌)로 잰다.
{
  const G = [
    { id: 'a', title: '수련회 장소 답사', status: '완료', dueDate: '2026-10-18' },
    { id: 'b', title: '찬양 콘티 정리', status: '진행 중', dueDate: '2026-10-30' },
    { id: 'e', title: '수련회 포스터', status: '완료', dueDate: '2026-10-24', dependsOn: ['a'] },
    { id: 'c', title: '숙소 예약', status: '진행 중', dueDate: '2026-10-29', dependsOn: ['a'] },
    { id: 'd', title: '버스 대절', status: '시작 전', dueDate: '2026-11-01', dependsOn: ['a'] },
    { id: 'f', title: '주보 PPT 만들기', status: '시작 전', dueDate: '2026-11-01', dependsOn: ['b'] },
    { id: 'g', title: '참가 신청 받기', status: '진행 중', dueDate: '2026-11-05', dependsOn: ['c', 'e'],
      subtasks: [{ title: '1', done: true }, { title: '2', done: true }, { title: '3' }, { title: '4' }, { title: '5' }] },
    { id: 'h', title: '조 편성', status: '시작 전', dueDate: '2026-11-03', dependsOn: ['g'] },
    { id: 'i', title: '새가족 환영 카드', status: '시작 전', dueDate: '2026-11-02' },
    { id: 'j', title: '10월 순모임 가이드', status: '완료', dueDate: '2026-10-12' },
  ];
  const byId = {}, allIds = [];
  G.forEach((t, n) => { byId[t.id] = { projectId: 'p1', content: '', assignees: ['노준석'], teams: ['찬양팀'], startDate: '', position: n, author: '노준석',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', comments: [], attachments: [], activityLog: [], dependsOn: [], subtasks: [], ...t }; allIds.push(t.id); });
  const camp = { currentUser: { name: '노준석', team: '찬양팀', teams: ['찬양팀'] },
    members: [{ id: 'u1', name: '노준석', avatarUrl: '', team: '찬양팀', teams: ['찬양팀'], birthday: '', lastSeenAt: '', joinedAt: '2026-01-01T00:00:00Z' }],
    projects: { byId: { p1: { id: 'p1', title: '수련회', pinnedLinks: [], year: 2026, createdAt: '2026-01-01T00:00:00Z' } }, allIds: ['p1'] }, tasks: { byId, allIds } };
  const openCamp = async (w, theme = 'light') => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 860 : 1000, deviceScaleFactor: 1, mobile: w < 1024 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: w < 768, maxTouchPoints: w < 768 ? 5 : 1 });
    await send('Page.navigate', { url: URL_BASE }); await wait('Page.loadEventFired');
    await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify(camp))}); localStorage.setItem('theme','${theme}')`);
    await send('Page.navigate', { url: URL_BASE + '/?p=p1' }); await wait('Page.loadEventFired'); await sleep(1400);
    await ev(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '그래프')?.click()`);
    await sleep(2200);
  };
  const hexRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  const pill = (title) => `[...document.querySelectorAll('[data-graph-root] button')].find(b => b.textContent.trim() === '${title}')`;

  // G1·G2 — 선은 알약 가장자리에서 나가 가장자리 앞 화살촉으로 들어가는 S곡선(C) · 끝 점(circle) 없음
  // **되돌리기**: edgeGeom을 중심끼리의 Q 곡선으로 되돌리면(끝점 = 알약 중심) 깨진다.
  await openCamp(1280);
  const geo = await ev(`(() => {
    const g = document.querySelector('[data-edge="a>e"]'); if (!g) return null;
    const [line, head] = g.querySelectorAll('path');
    const box = document.querySelector('[data-graph-root] .relative').getBoundingClientRect();
    const A = ${pill('수련회 장소 답사')}.getBoundingClientRect(), B = ${pill('수련회 포스터')}.getBoundingClientRect();
    const n = line.getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    const sx = n[0] + box.left, ex = n[n.length - 2] + box.left;
    return { cubic: /C/.test(line.getAttribute('d')), head: !!head && /Z$/.test(head.getAttribute('d')),
      out: Math.round((sx - A.right) * 10) / 10, gap: Math.round((B.left - ex) * 10) / 10,
      circles: document.querySelectorAll('.dg-edges circle').length, cap: line.getAttribute('stroke-linecap') };
  })()`);
  check('그래프 G1·G2: 선이 알약 가장자리에서 나가(1px) 화살촉 뒤에서 멈추는(1.5 + 4px) S곡선 · 끝 점 없음',
    !!geo && geo.cubic && geo.head && Math.abs(geo.out - 1) <= 1 && Math.abs(geo.gap - 5.5) <= 1 && geo.circles === 0 && geo.cap === 'round', JSON.stringify(geo));
  // G6 — 선행 마감이 후행보다 늦은 안 끝난 선 하나만 빨강(참가 신청 받기 11/5 → 조 편성 11/3)
  // **되돌리기**: late 조건을 false로 두면 빨간 선이 0개라 깨진다.
  const late = await ev(`(() => { const L = [...document.querySelectorAll('[data-edge][data-late]')];
    return { keys: L.map(g => g.dataset.edge), stroke: L[0]?.querySelector('path').getAttribute('stroke'), op: L[0] && getComputedStyle(L[0]).opacity }; })()`);
  check('그래프 G6: 일정이 어긋난 선만 빨강(.9)', late.keys.join() === 'g>h' && late.stroke === 'var(--app-tag-red-fg)' && late.op === '0.9', JSON.stringify(late));
  // G4 — 마우스를 올리면 사슬 전체(앞으로 선행 전부 · 뒤로 후행 전부)가 켜진다. 숙소 예약 → 장소 답사 · 참가 신청 받기 · 조 편성
  // **되돌리기**: lit을 이웃 한 칸(a === hi || b === hi)으로 되돌리면 조 편성이 흐려져 깨진다.
  const litOf = `(() => ({ on: [...document.querySelectorAll('[data-graph-root] button.dg-pill')].filter(b => b.style.opacity !== '0.2').map(b => b.textContent.trim()).sort().join(','),
    edges: Object.fromEntries([...document.querySelectorAll('[data-edge]')].map(g => [g.dataset.edge, g.style.opacity])) }))()`;
  const ctr = async (title) => ev(`(() => { const r = ${pill(title)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, b: r.bottom, l: r.left, w: r.width }; })()`);
  {
    const c = await ctr('숙소 예약');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    await sleep(300);
    const hov = await ev(litOf);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
    check('그래프 G4: 올리면 사슬 전체가 켜지고 형제 갈래는 흐리다',
      hov.on === '수련회 장소 답사,숙소 예약,조 편성,참가 신청 받기' && hov.edges['a>c'] === '0.9' && hov.edges['g>h'] === '0.9' && hov.edges['a>e'] === '0.12' && hov.edges['e>g'] === '0.12', JSON.stringify(hov));
  }
  // G9 — 키보드 초점도 같은 강조(:focus-visible일 때만) · 초점이 떠나면 걷힌다
  // **되돌리기**: 알약의 onFocus를 지우면 깨진다.
  {
    // 바로 앞 알약(수련회 포스터)에 초점을 두고 Tab 한 번 — 숙소 예약으로 간다(DOM 차례 = 업무 차례)
    await ev(`${pill('수련회 포스터')}.focus()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(300);
    const kb = await ev(`({ ...${litOf}, fv: document.activeElement.matches(':focus-visible') })`);
    await ev(`document.activeElement.blur()`);
    await sleep(300);
    const off = await ev(litOf);
    check('그래프 G9: 키보드 초점이 오면 사슬 강조 · 떠나면 걷힘', kb.fv && kb.on === '수련회 장소 답사,숙소 예약,조 편성,참가 신청 받기' && off.on.split(',').length === 10, JSON.stringify({ kb: kb.on, fv: kb.fv, off: off.on }));
  }
  // G19 — 선행을 정해 새로 생긴 선만 .6s에 그려진다(이미 있던 선은 그대로)
  // **되돌리기**: freshEdges를 늘 빈 Set으로 두면 깨진다.
  await ev(`window.__store.dispatch({ type: 'UPSERT_TASK', payload: { ...window.__store.getState().tasks.byId.h, dependsOn: ['g', 'd'] } })`);
  await sleep(120);
  const fresh = await ev(`(() => { const N = [...document.querySelectorAll('.dg-edges path.dg-edge-new')];
    return { keys: N.map(p => p.parentElement.dataset.edge), anim: N[0] && getComputedStyle(N[0]).animationName, dur: N[0] && getComputedStyle(N[0]).animationDuration }; })()`);
  check('그래프 G19: 새로 생긴 선(버스 대절 → 조 편성)만 그려진다(dc-draw .6s)', fresh.keys.join() === 'd>h' && fresh.anim === 'dc-draw' && fresh.dur === '0.6s', JSON.stringify(fresh));
  // G24 — 다크에서 안 끝난 선은 muted · .8(라이트는 faint · .5 그대로)
  // **되돌리기**: index.css의 다크 .dg-edges 줄을 지우면 깨진다.
  const edgeOf = `(() => { const g = document.querySelector('[data-edge="b>f"]'); const s = getComputedStyle(g.querySelector('path'));
    return { op: getComputedStyle(g).opacity, stroke: s.stroke, muted: getComputedStyle(document.documentElement).getPropertyValue('--app-ink-muted').trim(),
      faint: getComputedStyle(document.documentElement).getPropertyValue('--app-ink-faint').trim() }; })()`;
  const lightEdge = await ev(edgeOf);
  await openCamp(1280, 'dark');
  const darkEdge = await ev(edgeOf);
  check('그래프 G24: 안 끝난 선 — 라이트 faint .5 · 다크 muted .8',
    lightEdge.op === '0.5' && lightEdge.stroke === hexRgb(lightEdge.faint) && darkEdge.op === '0.8' && darkEdge.stroke === hexRgb(darkEdge.muted), JSON.stringify({ lightEdge, darkEdge }));

  // G8 — 폰: 첫 탭은 사슬 강조(창이 안 열린다) · 같은 알약을 다시 탭하면 업무 창 · 판 빈 곳을 탭하면 강조가 걷힌다
  // **되돌리기**: 알약 onClick을 늘 onTaskClick으로 되돌리면 첫 탭에 창이 열려 깨진다.
  await openCamp(393);
  const tapAt = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(450);
  };
  const winOpen = `!!document.querySelector('.fixed.z-50')`;
  {
    const c = await ctr('숙소 예약');
    await tapAt(c.x, c.y);
    const first = await ev(`({ ...${litOf}, open: ${winOpen} })`);
    const wrapBox = await ev(`(() => { const r = document.querySelector('[data-graph-root] .relative').getBoundingClientRect(); return { x: r.right - 6, y: r.top + 6 }; })()`);
    await tapAt(wrapBox.x, wrapBox.y);
    const cleared = await ev(litOf);
    await tapAt(c.x, c.y);
    await tapAt(c.x, c.y);
    const second = await ev(winOpen);
    check('그래프 G8(폰): 첫 탭은 사슬 강조 · 빈 곳 탭은 걷힘 · 같은 알약 다시 탭은 업무 창',
      !first.open && first.on === '수련회 장소 답사,숙소 예약,조 편성,참가 신청 받기' && cleared.on.split(',').length === 10 && second,
      JSON.stringify({ first, cleared: cleared.on.split(',').length, second }));
  }
  // G21 — 폰은 알약의 누를 자리가 위아래 7px · 좌우 3px 넓다(알약 아래 5px을 눌러도 그 알약) · 데스크톱은 그대로(1px)
  // **되돌리기**: 판의 dg-hit 클래스를 지우면 깨진다.
  await openCamp(393);
  {
    const c = await ctr('숙소 예약');
    const hit = await ev(`(() => { const p = ${pill('숙소 예약')}; const s = getComputedStyle(p, '::before');
      const under = document.elementFromPoint(${c.x}, ${c.b} + 5); return { top: s.top, left: s.left, under: under?.closest('button') === p }; })()`);
    await openCamp(1280);
    const desk = await ev(`getComputedStyle(${pill('숙소 예약')}, '::before').top`);
    check('그래프 G21: 폰은 누를 자리가 위아래 7 · 좌우 3px 넓다(데스크톱 1px)', hit.top === '-7px' && hit.left === '-3px' && hit.under && desk === '-1px', JSON.stringify({ hit, desk }));
  }
}

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,4).join('\n'):'\n콘솔 오류 없음');
ws.close();chrome.kill();process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
