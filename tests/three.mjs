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

// ── 1-b) 참고 링크 추가 ──
// 팝오버가 createPortal로 body에 나가 있는데 바깥 클릭 판정이 앵커 span만 봐서,
// 팝오버 안을 누르는 것이 '바깥'으로 잡혔다. mousedown에서 팝오버가 닫히니 그 뒤의
// click은 사라진 '추가' 버튼에 닿지 않았다 → 링크가 한 건도 저장되지 않았다.
// **실제 마우스 이벤트로 눌러야 재현된다** — el.click()은 mousedown을 안 내보낸다.
const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
const clickAt = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(200); };
const center = (sel) => ev(`(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
const linkPopOpen = () => ev(`!!document.querySelector('input[placeholder="https://..."]')`);
// 셀렉터를 못 찾으면 던지지 않고 false를 돌려준다 — 여기서 예외로 죽으면 러너가
// CRASH로만 찍고 어느 단정에서 어긋났는지 안 보인다(§4)
const typeInto = async (sel, text) => {
  const c = await center(sel);
  if (!c) return false;
  await clickAt(c.x, c.y);
  await send('Input.insertText', { text });
  await sleep(150);
  return true;
};

await load(DESK);
// 링크가 하나 붙으면 칩이 앞에 끼어들어 '+ 참고 링크' 버튼이 오른쪽으로 밀린다.
// 옛 좌표를 다시 누르면 방금 만든 외부 링크를 클릭해 버린다 → 매번 다시 찾는다.
const addBtnPos = () => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '+ 참고 링크');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
const openLinkPop = async () => { const p = await addBtnPos(); if (!p) return false; await clickAt(p.x, p.y); return true; };

check('프로젝트 화면에 + 참고 링크 버튼이 있다', !!(await addBtnPos()));
await openLinkPop();
check('누르면 링크 입력 팝오버가 열린다', (await linkPopOpen()) === true);

// 이름 칸은 autoFocus지만, URL 칸은 눌러서 옮겨가야 한다 — 이 클릭에서 닫혔다
await send('Input.insertText', { text: '전세버스 견적서' });
const typedUrl = await typeInto('input[placeholder="https://..."]', 'example.com/quote');
check('팝오버 안을 눌러도 닫히지 않는다', typedUrl === true && (await linkPopOpen()) === true, typedUrl ? '' : 'URL 칸이 사라졌다');

const addLinkBtn = await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '추가');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: b.disabled };
})()`);
check("'추가' 버튼이 눌릴 수 있는 상태", !!addLinkBtn && addLinkBtn.disabled === false, JSON.stringify(addLinkBtn));
if (addLinkBtn) await clickAt(addLinkBtn.x, addLinkBtn.y);
await sleep(500);
const saved = await ev(`(() => {
  const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === '전세버스 견적서');
  const s = JSON.parse(localStorage.getItem('church_app_v4') || '{}');
  const stored = (s.projects?.byId?.p1?.pinnedLinks || []);
  return { onScreen: !!a, href: a?.getAttribute('href') || null, stored: stored.length, storedUrl: stored[0]?.url || null };
})()`);
check('참고 링크가 헤더에 나온다', saved.onScreen === true, JSON.stringify(saved));
check('http가 없으면 https://를 붙인다', saved.href === 'https://example.com/quote', String(saved.href));
check('저장소에도 들어간다(게스트=localStorage / 클라우드=resource_links)', saved.stored === 1, JSON.stringify(saved));

// Escape는 그대로 닫아야 한다
await openLinkPop();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(300);
check('Escape로 닫힌다', (await linkPopOpen()) === false);

// 진짜 바깥을 누르면 닫혀야 한다. 제목 버튼은 이름 수정 창을 열어 버리므로
// 아무 것도 열지 않는 자리(메타 글자)를 고른다.
await openLinkPop();
const outside = await ev(`(() => {
  const s = [...document.querySelectorAll('span')].find(x => /건 · 완료/.test(x.textContent) && x.children.length === 0);
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) };
})()`);
if (outside) await clickAt(outside.x, outside.y);
check('팝오버 바깥을 누르면 닫힌다', !!outside && (await linkPopOpen()) === false, outside ? '' : '메타 글자를 못 찾았다');

// 아는 서비스면 이름 앞에 글자만 한 표시가 붙는다(linkIcons.jsx). 모르는 주소에는 안 붙는다.
await openLinkPop();
await send('Input.insertText', { text: '수련회 찬양 영상' });
await typeInto('input[placeholder="https://..."]', 'https://www.youtube.com/watch?v=abc');
const addBtn2 = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='추가');
  if(!b) return null; const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; })()`);
if (addBtn2) await clickAt(addBtn2.x, addBtn2.y);
await sleep(400);
const icons = await ev(`(() => {
  const pick = (t) => [...document.querySelectorAll('a')].find(a => a.textContent.trim() === t);
  const yt = pick('수련회 찬양 영상'), plain = pick('전세버스 견적서');
  if (!yt || !plain) return null;
  const svg = yt.querySelector('svg');
  return { ytHasIcon: !!svg,
           iconPx: svg ? Math.round(svg.getBoundingClientRect().width) : null,
           // 색을 쓰지 않는다 — 글자와 같은 색으로 흐른다
           iconFill: svg ? getComputedStyle(svg).fill : null,
           linkColor: getComputedStyle(yt).color,
           plainHasIcon: !!plain.querySelector('svg') };
})()`);
check('유튜브 링크에는 서비스 표시가 붙는다', icons?.ytHasIcon === true, JSON.stringify(icons));
check('표시 크기가 글자만 하다(9~14px)', icons?.iconPx >= 9 && icons?.iconPx <= 14, String(icons?.iconPx));
check('표시가 링크 글자색을 따른다(브랜드 색을 쓰지 않는다)', icons?.iconFill === icons?.linkColor, `${icons?.iconFill} vs ${icons?.linkColor}`);
check('모르는 주소에는 표시를 붙이지 않는다', icons?.plainHasIcon === false, JSON.stringify(icons));

// 공유·삭제는 링크가 미는 칸 **밖**에 있어야 한다. 예전에는 같은 칸 안에 있어서
// 링크가 늘 때마다 삭제가 화면 밖으로 밀려났다(밀어야 나오는 삭제 = §7 위반).
for (const w of [375, 414, 768]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: w < 768 });
  await sleep(450);
  const acts = await ev(`(() => {
    const del = document.querySelector('button[title="프로젝트 삭제"]');
    if (!del) return null;
    const r = del.getBoundingClientRect();
    // 링크가 들어 있는 가로 스크롤 칸
    const scroller = [...document.querySelectorAll('div')]
      .find(d => typeof d.className === 'string' && /x-scroll-lock/.test(d.className) && d.querySelector('a'));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '새 업무');
    const glyph = del.querySelector('svg');
    // 공유 왼쪽의 세로 실선. ConfirmPopover가 래퍼를 하나 더 만들므로 del.parentElement가
    // 아니라 border-l이 달린 span을 직접 찾는다(처음에 이걸 잘못 잡아 헛measure했다)
    const acts = [...document.querySelectorAll('span')]
      .find(s => /border-l/.test(s.className || '') && s.contains(del));
    const head = del.closest('div[style*="border-bottom"]');
    return {
      onScreen: r.right <= window.innerWidth + 1 && r.left >= 0 && r.width > 0,
      insideScroller: scroller ? scroller.contains(del) : null,
      right: Math.round(r.right), vw: window.innerWidth,
      // 아이콘은 여백까지가 버튼이고 lucide는 16px 박스 안에서 좌우 2px을 더 비운다.
      // 눈에 보이는 선은 **자획**이라 getBBox()로 잉크 상자를 재서 화면 좌표로 환산한다
      // (svg의 rect로 재면 어긋난 채로도 맞다고 나온다).
      glyphRight: (() => {
        if (!glyph) return null;
        const box = glyph.getBoundingClientRect();
        const bb = glyph.getBBox();          // viewBox(24) 좌표
        return Math.round(box.left + (bb.x + bb.width) * (box.width / 24));
      })(),
      btnRight: btn ? Math.round(btn.getBoundingClientRect().right) : null,
      btnLeft: btn ? Math.round(btn.getBoundingClientRect().left) : null,
      dividerLeft: acts ? Math.round(acts.getBoundingClientRect().left) : null,
      // 헤더 아래 실선의 양 끝 — 위 요소들이 이 안에 있어야 한다
      lineLeft: head ? Math.round(head.getBoundingClientRect().left) : null,
      lineRight: head ? Math.round(head.getBoundingClientRect().right) : null,
    };
  })()`);
  check(`${w}px: 삭제가 화면 안에 있다`, acts?.onScreen === true, JSON.stringify(acts));
  check(`${w}px: 삭제가 링크 스크롤 칸 밖에 있다`, acts?.insideScroller === false, JSON.stringify(acts));
  // 모바일 아래 줄은 '새 업무' 아래를 지나 **화면 오른쪽 끝**까지 가야 한다. 예전에는
  // 이 줄이 왼쪽 칸 안이라 버튼 왼쪽에서 끝났고, 공유·삭제가 화면 중간에 떠 보였다.
  // 그리고 삭제 아이콘의 자획이 바로 위 '새 업무' 버튼의 오른쪽 선과 맞아야 한다
  // (아이콘 버튼의 p-1.5를 상쇄하지 않으면 6px 안쪽에 서서 두 줄이 어긋나 보인다).
  if (w < 768) {
    check(`${w}px: 공유·삭제가 오른쪽 끝에 붙어 있다`, acts && acts.vw - acts.right < 24, JSON.stringify(acts));
    check(`${w}px: 삭제 아이콘이 '새 업무' 버튼과 같은 오른쪽 선에 선다`,
      acts && Math.abs(acts.glyphRight - acts.btnRight) <= 1, JSON.stringify(acts));
    // 공유 왼쪽 세로 실선은 바로 위 '새 업무' 버튼의 왼쪽 선과 같은 x에 서야 한다.
    // 액션을 버튼과 **같은 그리드 칸**에 넣어서 맞춘 것이라, 아래 줄을 col-span-2로
    // 되돌리면 실선이 21px 오른쪽으로 밀린다.
    check(`${w}px: 공유 왼쪽 실선이 '새 업무' 버튼 왼쪽 선과 맞는다`,
      acts && Math.abs(acts.dividerLeft - acts.btnLeft) <= 1, JSON.stringify(acts));
    // 헤더 아래 실선 밖으로 삐져나오는 것이 없어야 한다(자획 기준)
    check(`${w}px: 헤더 실선 안에 정렬돼 있다`,
      acts && acts.glyphRight <= acts.lineRight + 1 && acts.btnRight <= acts.lineRight + 1,
      JSON.stringify(acts));
  }
}

// 값 줄이 비어 보이지 않게 진척 바를 둔다(대시보드와 같은 부품)
const headBar = await ev(`(() => {
  const meta = [...document.querySelectorAll('span')].find(s => /건 · 완료/.test(s.textContent) && s.children.length === 0);
  if (!meta) return null;
  const row = meta.parentElement;
  const fill = row.querySelector('.dc-bar-fill');
  if (!fill) return { hasBar: false };
  const w = Math.round(fill.parentElement.getBoundingClientRect().width);
  return { hasBar: true, width: w, transform: getComputedStyle(fill).transform };
})()`);
check('값 줄에 진척 바가 있다', headBar?.hasBar === true && headBar.width > 20, JSON.stringify(headBar));

// 값 줄에서 양보할 수 있는 것은 글자뿐이다. 메타에 nowrap만 걸려 있으면 flex 항목의 최소 폭이
// 글자 폭으로 굳어서, 좁은 화면에 담당자 얼굴까지 서면 얼굴이 '새 업무' 버튼 밑으로 파고든다.
// 가장 긴 메타('103일 지남')를 밀어 넣고 그 줄이 넘치지 않는지 본다 — truncate를 지우면 실패한다.
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 812, deviceScaleFactor: 1, mobile: true });
await sleep(450);
const squeeze = await ev(`(() => {
  const meta = [...document.querySelectorAll('span')].find(s => /건 · 완료/.test(s.textContent) && s.children.length === 0);
  if (!meta) return null;
  meta.textContent = '18건 · 완료 4건 · 103일 지남';
  const row = meta.parentElement;
  return { over: Math.round(row.scrollWidth - row.clientWidth), clip: getComputedStyle(meta).overflow };
})()`);
check('320px: 값 줄이 가장 긴 메타에도 넘치지 않는다(글자가 양보한다)',
  squeeze?.over === 0, JSON.stringify(squeeze));
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 812, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// 이 프로젝트에 누가 붙어 있는지 — 값 줄 오른쪽 끝의 담당자 얼굴. 진척 바 **뒤**여야 한다
// (`완료 N건`과 바는 같은 사실이라 그 사이를 가르지 않는다). 세는 함수는 대시보드
// '청년별 남은 업무'와 같은 personLoad라서, 여기서는 자리와 개수만 본다.
const faces = await ev(`(() => {
  const meta = [...document.querySelectorAll('span')].find(s => /건 · 완료/.test(s.textContent) && s.children.length === 0);
  if (!meta) return null;
  const row = meta.parentElement;
  const fill = row.querySelector('.dc-bar-fill');
  // 아바타 = 값 줄 안의 원형 + 글자 한 자
  const av = [...row.querySelectorAll('span')].filter(s => /rounded-full/.test(s.className||'') && s.children.length === 0 && s.textContent.trim().length === 1);
  if (!av.length) return { count: 0 };
  const first = av[0].getBoundingClientRect();
  return {
    count: av.length, initials: av.map(s => s.textContent.trim()).join(''),
    afterBar: fill ? first.left >= fill.getBoundingClientRect().right : null,
    size: Math.round(first.width),
  };
})()`);
// 시드는 모든 업무를 '노준석'이 맡는다 → 얼굴 하나
check('값 줄에 담당자 얼굴이 있다', faces?.count === 1 && faces.initials === '노', JSON.stringify(faces));
check('담당자 얼굴이 진척 바 뒤에 온다', faces?.afterBar === true, JSON.stringify(faces));

// 링크가 붙은 뒤에도 '새 업무'가 메타 줄과 같은 줄에 남아야 한다.
// 예전에는 헤더에 flex-wrap이 걸려 있어서 링크 하나에 버튼이 아래로 떨어지고 혼자 한 줄을
// 차지했다(모바일에서 특히 어색했다 — 제목은 상단바에 있어 왼쪽에 메타 줄만 남는다).
// 리로드하지 않고 폭만 좁힌다 — 방금 넣은 링크를 그대로 두고 보려면 이 방법뿐이다
// (load()는 localStorage를 seed로 되돌린다). 앱은 matchMedia로 다시 그린다.
for (const w of [1440, 375]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: w < 768 });
  await sleep(500);
  const row = await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '새 업무');
    const meta = [...document.querySelectorAll('span')].find(s => /건 · 완료/.test(s.textContent) && s.children.length === 0);
    if (!btn || !meta) return null;
    const b = btn.getBoundingClientRect(), m = meta.getBoundingClientRect();
    return { sameRow: b.top < m.bottom && b.bottom > m.top, rightOfMeta: b.left >= m.left,
             btnTop: Math.round(b.top), metaTop: Math.round(m.top), onScreen: b.right <= window.innerWidth + 1 };
  })()`);
  check(`${w}px: 참고 링크가 있어도 '새 업무'가 메타 줄과 같은 줄에 있다`,
    row?.sameRow === true && row?.onScreen === true, JSON.stringify(row));
}

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
// 리디자인 후 모바일 팀 필터는 칩 줄이 아니라 한 줄 버튼이다. 가로 줄은 3개 —
// 프로젝트 탭 · 프로젝트 헤더의 메타 줄(참고 링크가 늘어나는 자리) · 상태 칩.
check('가로 전용 줄이 3개 있다(프로젝트 탭·메타 줄·상태 칩)', lock.length === 3, JSON.stringify(lock.length));
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
