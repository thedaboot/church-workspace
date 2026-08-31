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

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,4).join('\n'):'\n콘솔 오류 없음');
ws.close();chrome.kill();process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
