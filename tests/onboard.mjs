// 첫 설정 모달 — 언제 뜨고 언제 안 뜨는지 / 다중 팀 저장
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_BASE = process.argv[2] || 'http://localhost:4174';
const PORT = 9495;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), 'cob2-'));
const chrome = spawn((process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
async function tg(){for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(x=>x.type==='page');if(p?.webSocketDebuggerUrl)return p;}catch{}await sleep(250);}throw new Error('fail');}
const page = await tg();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id=0; const pend=new Map(); const evs=[]; const logs=[];
ws.addEventListener('message', e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')logs.push(m.params.args.map(a=>a.value||a.description).join(' '));
  else if(m.method)evs.push(m);});
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const wait=async(m,to=20000)=>{const s=Date.now();while(Date.now()-s<to){const i=evs.findIndex(e=>e.method===m);if(i>=0)return evs.splice(i,1)[0];await sleep(50);}throw new Error(m);};
const ev=async(e,a=false)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
const results=[]; const check=(n,p,d='')=>results.push(`${p?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);

const base = { projects:{byId:{p1:{id:'p1',title:'P',pinnedLinks:[]}},allIds:['p1']}, tasks:{byId:{},allIds:[]} };
const BOX = `[...document.querySelectorAll('div')].find(d=>/max-w-sm/.test(d.className||''))`;
const clickInBox = (label) => ev(`(() => { const box=${BOX};
  [...box.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click(); })()`);
const clickSubmit = () => ev(`(() => { const box=${BOX};
  [...box.querySelectorAll('button')].find(b=>/시작하기|저장/.test(b.textContent)).click(); })()`);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

const openModal = async (currentUser) => {
  await send('Page.navigate',{url:URL_BASE}); await wait('Page.loadEventFired');
  await ev(`localStorage.setItem('church_app_v4', ${JSON.stringify(JSON.stringify({...base, currentUser}))})`);
  await send('Page.navigate',{url:URL_BASE+'/'}); await wait('Page.loadEventFired'); await sleep(1300);
  await ev(`document.querySelector('button[title="설정"]').click()`); await sleep(350);
  await ev(`(() => { const p=[...document.body.children].find(c=>/z-\\[90\\]/.test(c.className||''));
    [...p.querySelectorAll('button')].find(b=>b.textContent.trim()==='설정').click(); })()`);
  await sleep(500);
  return ev(`(() => {
    const box=${BOX};
    if(!box) return null;
    const btns=[...box.querySelectorAll('button')].map(b=>({t:b.textContent.trim(),off:b.disabled}));
    return { head: box.querySelector('h3').textContent.trim(),
             hasCancel: btns.some(b=>b.t==='취소'),
             submit: btns.find(b=>/시작하기|저장/.test(b.t)),
             chips: btns.filter(b=>/팀$|임원진|교역자/.test(b.t)).length,
             warn: [...box.querySelectorAll('p')].some(p=>/이름과 팀을/.test(p.textContent)),
             namePlaceholder: box.querySelector('input[type=text]').placeholder };
  })()`);
};

// ── 1) 이름·팀 둘 다 없음 = 완전 첫 로그인 ──
let m = await openModal({ name:'', team:'', teams:[] });
check('첫 로그인: 온보딩 문구', /반가워요/.test(m.head), m.head);
check('첫 로그인: 취소 버튼 없음', m.hasCancel === false);
check('첫 로그인: 저장 버튼이 잠겨 있다', m.submit?.off === true && m.submit.t === '시작하기', JSON.stringify(m.submit));
check('첫 로그인: 채우라는 안내 노출', m.warn === true);
check('이름 칸에 예시 placeholder 없음', !m.namePlaceholder, `placeholder="${m.namePlaceholder}"`);
check('팀 칩 7개', m.chips === 7, `${m.chips}개`);

await ev(`(() => { const box=${BOX}; const inp=box.querySelector('input[type=text]');
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(inp,'테스트'); inp.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(200);
await clickInBox('찬양팀'); await sleep(180);
await clickInBox('임원진'); await sleep(180);
const ready = await ev(`(() => { const box=${BOX};
  const b=[...box.querySelectorAll('button')].find(x=>/시작하기|저장/.test(x.textContent));
  const primary=[...box.querySelectorAll('p')].map(p=>p.textContent.trim()).find(t=>/대표 팀/.test(t));
  return { off:b.disabled, primary }; })()`);
check('이름·팀을 채우면 저장이 열린다', ready.off === false);
check('대표 팀을 알려준다', /찬양팀/.test(ready.primary || ''), String(ready.primary));
await clickSubmit(); await sleep(700);
const saved = await ev(`(() => { const s=JSON.parse(localStorage.getItem('church_app_v4')||'{}');
  return { name:s.currentUser?.name, team:s.currentUser?.team, teams:s.currentUser?.teams }; })()`);
check('여러 팀이 저장된다',
  saved.name==='테스트' && saved.team==='찬양팀' && JSON.stringify(saved.teams)===JSON.stringify(['찬양팀','임원진']),
  JSON.stringify(saved));
check('모달이 닫힌다', (await ev(`!${BOX}`)) === true);

// ── 2) 이름은 있는데 팀이 없음(기존 계정) → 아직 온보딩 ──
m = await openModal({ name:'조준환', team:'', teams:[] });
check('이름만 있고 팀이 없으면 아직 온보딩', /반가워요/.test(m.head) && m.hasCancel === false, `${m.head} / 취소 ${m.hasCancel}`);

// ── 3) 이름·팀 있음(설정 끝) → 평범한 '내 정보' ──
m = await openModal({ name:'노준석', team:'찬양팀', teams:['찬양팀'] });
check('설정이 끝나면 평범한 내 정보 창', m.head === '내 정보' && m.hasCancel === true, `${m.head} / 취소 ${m.hasCancel}`);
check('설정이 끝나면 저장이 바로 열려 있다', m.submit?.off === false && m.submit.t === '저장', JSON.stringify(m.submit));

// ── 4) 이미 팀 하나인 사람이 팀을 추가 ──
await clickInBox('임원진'); await sleep(200);
await clickSubmit(); await sleep(700);
const added = await ev(`JSON.parse(localStorage.getItem('church_app_v4')).currentUser.teams`);
check('팀 하나였던 사람이 팀을 추가할 수 있다', JSON.stringify(added)===JSON.stringify(['찬양팀','임원진']), JSON.stringify(added));
check('대표 팀은 그대로 유지된다', (await ev(`JSON.parse(localStorage.getItem('church_app_v4')).currentUser.team`)) === '찬양팀');

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,4).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
