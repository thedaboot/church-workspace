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
ws.send(JSON.stringify({ id: 0, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));   // 누른 내려받기(.ics·공유 이미지)가 사용자 다운로드 폴더에 쌓이지 않게(2026-10-22)
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

// ── D9 모양 통일 — 소스로 지킨다(2026-09-25 · 사용자 결정 D9-a · components/buttons.js 머리말) ──
// 화면을 다 돌지 않아도 새로 들어오는 줄이 규칙을 어기면 바로 깨지게 소스를 훑는다.
// ① 주 버튼 비활성은 opacity .4 하나 — `disabled:bg-line`이 소스에 없다
// ② 10px 미만 글자는 얼굴 원 안의 머리글자(Avatar·PersonFace·FaceRow의 w-/h- 원)와 종이(paper · 가이드 표지)뿐
// ③ 12px 미만 글에 text-fg-faint를 같이 쓰지 않는다(muted로) — 같은 className 문자열 안에서 본다
// ④ 대화창 뒤판은 검정 50%, 전면 미리보기는 80% — 그 밖의 값(/40·/60·/70)이 없다
// **되돌리기**: 어느 한 줄을 옛 값(예: comments.jsx 댓글 시각 `text-[9px] text-fg-faint`)으로 두면 깨진다.
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const SRC = new URL('../src/', import.meta.url);
  const walk = (u) => readdirSync(u).flatMap(n => { const c = new URL(n, u); return statSync(c).isDirectory() ? walk(new URL(n + '/', u)) : [c]; });
  const files = walk(SRC).filter(u => /\.(jsx|js)$/.test(u.pathname));
  const bgLine = [], tiny = [], faintSmall = [], backs = [], roundSkel = [];
  for (const u of files) {
    const name = decodeURIComponent(u.pathname).split('/src/')[1];
    const lines = readFileSync(u, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      const at = `${name}:${i + 1}`;
      if (/disabled:bg-line/.test(l)) bgLine.push(at);
      for (const m of l.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) >= 10) continue;
        const face = /<(Avatar|PersonFace)\b|FaceRow|size = 'w-\[|w-\[1[3-9]px\] h-\[1[3-9]px\]|w-\[20px\] h-\[20px\]|w-[45] h-[45]/.test(l);
        const paper = /paper|sun-guide-mark/.test(name + ' ' + l);
        if (!face && !paper) tiny.push(`${at} ${m[0]}`);
      }
      for (const m of l.matchAll(/(["'`])((?:(?!\1).)*?)\1/g)) {
        const body = m[2];
        if (/(?:^|\s)text-fg-faint(?:\s|$)/.test(body) && /(?:^|\s)text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(body) && !/paper/.test(name)) faintSmall.push(at);
      }
      for (const m of l.matchAll(/fixed inset-0[^"'`]*bg-black\/(\d+)/g)) if (!['50', '80'].includes(m[1])) backs.push(`${at} /${m[1]}`);
      if (/<Skeleton\b[^>]*className=["'`][^"'`]*\brounded-full(?!!)/.test(l)) roundSkel.push(at);
    });
  }
  check('D9: 주 버튼 비활성에 bg-line을 쓰지 않는다(opacity .4)', bgLine.length === 0, bgLine.join(' · '));
  check('D9: 10px 미만 글자는 얼굴 머리글자·종이뿐이다', tiny.length === 0, tiny.join(' · '));
  check('D9: 12px 미만 글에 faint를 쓰지 않는다', faintSmall.length === 0, faintSmall.join(' · '));
  // ── UI 다듬기 회차(2026-10-26) 규격 — 소스로 지킨다 ──
  // ⑤ 다크의 회색 토글 고른 칸(--app-seg-on)은 통(--app-surface-hover)보다 밝다 — 어두우면 꺼진 칸으로 읽힌다(PITFALLS 57-f)
  // ⑥ 폰 업무 창 등장(dc-rise-in)은 투명도를 앞 12%에서 끝낸다 — 같이 가면 첫 0.1초에 뒤 보드 글자와 두 겹으로 겹친다
  // ⑦ 형광펜은 글자색을 바꾸지 않는다(bibleParts HL_STYLE color: inherit · 펜 자국 그라데이션) — 빨강이면 말씀이 빨간 글씨가 됐다
  // **되돌리기**: index.css 다크 --app-seg-on을 #202020으로, dc-rise-in의 '12% { opacity: 1; }'를 지우면 ⑤·⑥이 깨진다.
  {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].reduce((a, v) => a + v, 0); };
    const dark = css.slice(css.indexOf(":root[data-theme='dark'] {"));
    const segOn = dark.match(/--app-seg-on:\s*(#[0-9a-f]{6})/i)?.[1], track = dark.match(/--app-surface-hover:\s*(#[0-9a-f]{6})/i)?.[1];
    check('다듬기: 다크 회색 토글의 고른 칸이 통보다 밝다', !!segOn && !!track && lum(segOn) > lum(track), `${segOn} / ${track}`);
    check('다듬기: 폰 업무 창은 투명도를 먼저 채우고 떠오른다(dc-rise-in 12%)', /@keyframes dc-rise-in\s*\{[^}]*\}\s*12%\s*\{\s*opacity:\s*1;?\s*\}/.test(css));
    const bp = readFileSync(new URL('../src/components/bibleParts.jsx', import.meta.url), 'utf8');
    check('다듬기: 형광펜은 글자색을 바꾸지 않는다(펜 자국)', /color:\s*'inherit'/.test(bp) && !/tag-(red|blue|yellow|green)-fg/.test(bp.slice(bp.indexOf('const HL_TOKEN'), bp.indexOf('export const hlColor'))), '');
    // ⑨ 2차(2026-10-27): 스위치 손잡이는 transform + 탄성 곡선(D3) · 대시보드 숫자는 바뀔 때만 굴러옴(M3) · 진행 막대·다붓이 입구는
    //    바탕 빛 그라데이션(D1) · 동아리·예배 카드는 마우스가 있는 기기에서만 떠오름(S1). **되돌리기**: ShareSwitch를 left 전환으로 되돌리면 깨진다.
    const bpx = readFileSync(new URL('../src/components/bibleParts.jsx', import.meta.url), 'utf8');
    const dp = readFileSync(new URL('../src/views/dashboardParts.jsx', import.meta.url), 'utf8');
    check('다듬기 2차: 스위치 손잡이는 transform으로 · 탄성 곡선', /dc-spring/.test(bpx) && !/transition-\[left\]/.test(bpx) && /\.dc-spring\s*\{\s*transition: transform [^;]*cubic-bezier\(\.34, 1\.56/.test(css), '');
    check('다듬기 2차: 숫자는 처음엔 가만히 · 바뀔 때만 굴러옴', /export function RollNum/.test(dp) && /<RollNum value=\{value\} \/>/.test(dp) && /rolled\.current \? 'dc-num-roll' : undefined/.test(dp), '');
    check('다듬기 2차: 바탕 빛 그라데이션 토큰이 두 테마에', /:root \{ --app-brand-grad: linear-gradient/.test(css) && /:root\[data-theme='dark'\] \{ --app-brand-grad:/.test(css), '');
    check('다듬기 2차: 카드 떠오름은 hover 있는 기기만', /@media \(hover: hover\) \{\s*\.dc-lift/.test(css), '');
    const tt = readFileSync(new URL('../src/components/taskTable.jsx', import.meta.url), 'utf8');
    const fl = readFileSync(new URL('../src/hooks/useFlip.js', import.meta.url), 'utf8');
    check('다듬기 2차: 표·대시보드 줄은 새 자리로 미끄러진다(FLIP · 처음엔 재기만 · 움직임 줄이기면 재기만)',
      /useFlip\(flipRef, \[rows\]\)/.test(tt) && (tt.match(/data-flip=\{t\.id\}/g) || []).length === 2 && /useFlip\(flipRef, \[groups, expanded\]\)/.test(dp) && /data-flip=\{t\.id\}/.test(dp)
      && /if \(!prev \|\| prefersReducedMotion\(\)\) return;/.test(fl) && /box\.scrollTop/.test(fl), '');
    // M1·C1 — 창 자체를 키우지 않고 빈 판(유령)을 transform으로 키운다 · 출발점은 0.8초 안에 누른 data-flip 줄만 · 움직임 줄이기면 유령 없음
    // **되돌리기**: morph.js의 squeeze를 width·height 애니메이션으로 바꾸거나 modals.jsx에서 morphOpen을 지우면 깨진다.
    const mo = readFileSync(new URL('../src/hooks/morph.js', import.meta.url), 'utf8');
    const md = readFileSync(new URL('../src/modals/modals.jsx', import.meta.url), 'utf8');
    check('다듬기 2차: 업무 창은 누른 줄에서 자라고 그 줄로 돌아간다(유령 판 · transform만)',
      /morphOpen\(document\.querySelector\('\[data-task-window\]'\), task\.id\)/.test(md) && /morphClose\(document\.querySelector\('\[data-task-window\]'\), id\)/.test(md)
      && (md.match(/data-task-window=""/g) || []).length === 2 && /translate\(\$\{from\.left - to\.left\}px[^`]*scale\(/.test(mo) && !/width:\s*`\$\{[^}]+\}px`\s*\}\s*,\s*\{\s*width/.test(mo)
      && /performance\.now\(\) - o\.at > 800/.test(mo) && /prefersReducedMotion\(\)/.test(mo) && /\.dc-was-open \{ animation: dc-was-open/.test(css), '');
    // ⑧ 읽기 화면도 같은 펜 자국이다 — 편집(.tiptap)만 바꾸고 업무 본문 읽기(RichText)·종이 읽기(paper)는 옛 네모로 남았었다(2026-10-27 사용자 확인)
    const rt = readFileSync(new URL('../src/components/RichText.jsx', import.meta.url), 'utf8');
    const pp = readFileSync(new URL('../src/components/paper.jsx', import.meta.url), 'utf8');
    check('다듬기: 읽기 화면 형광펜도 펜 자국이다(RichText · 종이)', /highlight:\s*'app-hl'/.test(rt) && /mark\.app-hl\s*\{\s*background:\s*linear-gradient/.test(css.replace('.tiptap mark, ', '')) && /highlight:\s*\{\s*background:\s*`linear-gradient/.test(pp), '');
  }
  // ③-b 같은 문자열만 보면 구멍이 둘이다(2026-10-07 · 19차 묶음 E) — **조건부 문자열**(`text-[10px] ${열림 ? '…' : 'text-fg-faint'}`)과
  // **물려받은 색**(글자 색이 없는 10px 버튼이 faint 칩 안에 선다). 그래서 JSX를 읽어(vite parseAst) className 식 안의 문자열 조각을
  // 모두 모으고, 색은 조상에게서, 크기는 자기 것으로 본다. 대문자 부품(Avatar 등)은 안에서 제 색을 정하므로 물려받기는 소문자 태그만.
  // **되돌리기**: comments.jsx '답글'을 `'text-fg-faint hover:text-accent-text'`로, 반응 칩 +N의 `text-fg-muted`를 걷으면 깨진다.
  {
    const { parseAst } = await import('vite');
    const faintTree = [], parseFail = [];
    const COLOR = /^text-(fg|accent|tag|white|black|status)\b/;
    const frags = (n, out = []) => {
      if (!n || typeof n !== 'object') return out;
      if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value);
      else if (n.type === 'TemplateElement') out.push(n.value?.cooked ?? n.value?.raw ?? '');
      else for (const k of Object.keys(n)) { const v = n[k]; if (k !== 'parent' && v && typeof v === 'object') (Array.isArray(v) ? v : [v]).forEach(c => frags(c, out)); }
      return out;
    };
    for (const u of files) {
      const name = decodeURIComponent(u.pathname).split('/src/')[1];
      if (/paper/.test(name)) continue;
      const code = readFileSync(u, 'utf8');
      if (!/className/.test(code)) continue;
      let ast;
      try { ast = parseAst(code, { lang: 'jsx' }); } catch (e) { parseFail.push(`${name} ${e.message.slice(0, 60)}`); continue; }
      const lineOf = (off) => code.slice(0, off).split('\n').length;
      const visit = (n, faintUp) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(c => visit(c, faintUp)); return; }
        if (n.type === 'JSXElement') {
          const tag = n.openingElement.name?.name || '';
          const attr = n.openingElement.attributes.find(a => a.type === 'JSXAttribute' && a.name?.name === 'className');
          const tokens = attr ? frags(attr.value).join(' ').split(/\s+/).filter(Boolean) : [];
          const small = tokens.some(t => { const m = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(t); return m && Number(m[1]) < 12; });
          const colors = tokens.filter(t => COLOR.test(t));
          const faintHere = colors.includes('text-fg-faint');
          const faint = colors.length ? faintHere : (/^[a-z]/.test(tag) && faintUp);
          const cls = tokens.join(' ');
          if (small && faint) faintTree.push(`${name}:${lineOf(n.start)} <${tag}>`);
          n.openingElement.attributes.forEach(a => visit(a, faintUp));
          visit(n.children, colors.length ? faintHere : faintUp);
          return;
        }
        for (const k of Object.keys(n)) { const v = n[k]; if (k !== 'parent' && v && typeof v === 'object') visit(v, faintUp); }
      };
      visit(ast, false);
    }
    check('D9: 12px 미만 글에 faint가 없다 — 조건부 문자열 · 조상에게서 물려받은 색까지(JSX를 읽는다)',
      faintTree.length === 0 && parseFail.length === 0, [...faintTree, ...parseFail].join(' · '));
  }
  check('D9: 뒤판은 대화창 50% · 전면 미리보기 80% 두 값뿐이다', backs.length === 0, backs.join(' · '));
  // ⑤ 동그라미 뼈는 `rounded-full!` — Skeleton이 자기 `rounded-md`를 붙여서 그냥 `rounded-full`은 CSS 차례에서 진다(PITFALLS 9-bw·48-b·52-e).
  // 가입자 얼굴(roster RowSkeleton) 뒤에 예배 목록 칩 셋 · 공유 피드 사람 칩이 둥근 네모로 섰다가 도착하는 순간 모양이 튀었다(2026-10-14 C3).
  // **되돌리기**: worshipView LOADING 칩이나 shareFeed FeedSkeleton 칩의 `!`를 걷으면 깨진다.
  check('뼈대: 동그라미여야 하는 Skeleton은 rounded-full!(Skeleton의 rounded-md에 지지 않게)', roundSkel.length === 0, roundSkel.join(' · '));
  const btnSrc = readFileSync(new URL('components/buttons.js', SRC), 'utf8');
  check('D9: 버튼 두 단 — 작은 단 11.5px·600 · 확정 단 13px·600·40px, 둘 다 비활성 opacity .4',
    /BTN = 'px-3 py-1\.5 rounded-md bg-accent text-white text-\[11\.5px\] font-semibold[^']*disabled:opacity-40'/.test(btnSrc)
    && /min-h-10 px-4 py-2\.5 rounded-md text-\[13px\] font-semibold[^']*disabled:opacity-40/.test(btnSrc));
  // 내 정보 → 연결된 계정(클라우드에서만 선다 — 게스트 화면에 없어 소스로 본다 · 2026-10-14 점검 · PITFALLS 49-g)
  // 카카오 아이콘은 노란 칸(#FEE500) 위 검은 말풍선 — 말풍선만(#191919) 두면 다크 판과 거의 같은 색이라 묻혔다.
  // '연결됨'은 앱의 상태 배지 한 벌(px-2 py-0.5 rounded-full 10.5px 굵게 — 참여 중·수락됨·순에 공유와 같은 꼴).
  // **되돌리기**: settings.jsx 카카오 svg의 rect를 걷거나 배지를 옛 text-[10px]로 두면 깨진다.
  {
    const setSrc = readFileSync(new URL('modals/settings.jsx', SRC), 'utf8');
    const kakao = setSrc.match(/provider: 'kakao'[^\n]*<\/svg>/)?.[0] || '';
    check('내 정보: 카카오 아이콘은 노란 칸 위 검은 말풍선(두 테마에서 같은 모양)',
      /<rect [^>]*fill="#FEE500"/.test(kakao) && /<path fill="#191919"/.test(kakao) && kakao.indexOf('<rect') < kakao.indexOf('<path'), kakao.slice(0, 120));
    check("내 정보: '연결됨'은 상태 배지 한 벌(10.5px 굵게)",
      /className="inline-flex items-center gap-1 px-2 py-0\.5 rounded-full bg-tag-green text-tag-green-fg text-\[10\.5px\] font-bold"><Check size=\{11\} \/> 연결됨/.test(setSrc));
  }
}

// ── 업무 잠금(0099 · 20차 ⑨ 시안 '⑨ 업무 잠금')의 글자·색 규격과 모션 토큰 — 소스로 본다(화면 흐름은 tests/modalclose) ──
// 팝오버 제목 12.5px 굵게 · 칸 이름 11px muted · 취소(회색)/잠그기(accent 12px 굵게) · 잠금 판은 surface-2 판에 13px 본문색 글 +
// accent `입력`(12.5px 굵게 · 36px) · 틀린 칸은 tag-red-fg 테두리(팔레트 기본 red 아님) · 모션은 .42s quint 하나 + 움직임 줄이기에서 끈다.
// **되돌리기**: cardLock.jsx의 빨간 테두리를 `border-red-500`으로, index.css .dc-lock-veil-in의 이징을 ease로 바꾸면 깨진다.
{
  const { readFileSync } = await import('node:fs');
  const lk = readFileSync(new URL('../src/components/cardLock.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const spec = {
    // 두 칸 판은 LockForm 한 벌이다(시안 2026-10-16 — 마스터의 '새 비밀번호 정하기'가 같이 쓴다) — 글자는 부르는 쪽이 넘긴다
    title: /className="text-\[12\.5px\] font-bold text-fg">\{title\}</.test(lk) && /title="업무 잠그기" submitLabel="잠그기"/.test(lk),
    labels: (lk.match(/text-\[11px\] text-fg-muted">비밀번호( 확인)?\n/g) || []).length === 2,
    cancel: /bg-surface-hover text-fg-muted text-\[12px\] font-semibold[^"]*">취소</.test(lk),
    submit: /bg-accent hover:bg-accent-strong text-white text-\[12px\] font-bold[^"]*">\{submitLabel\}</.test(lk),
    panel: /data-lock-panel="" className="[^"]*rounded-\[10px\] bg-surface-2"/.test(lk) && /text-\[13px\] leading-relaxed text-center text-fg">이 업무는 현재 잠겨있어요</.test(lk),
    enter: /h-9 px-3\.5 rounded-\[9px\] bg-accent hover:bg-accent-strong text-white text-\[12\.5px\] font-bold[^"]*">입력</.test(lk),
    red: /border-tag-red-fg/.test(lk) && !/(border|ring)-red-\d/.test(lk),
    board: /CardLockMark[\s\S]*?size = 12[\s\S]*?text-fg-muted/.test(lk),
  };
  const motion = {
    quint: ['dc-lock-shut', 'dc-lock-lift', 'dc-lock-veil-in', 'dc-lock-veil-out', 'dc-lock-blur-out', 'dc-lock-blur-in', 'dc-shake']
      .every(k => new RegExp(`animation: ${k} \\.(42|36)s var\\(--ease-out-quint\\)`).test(css)),
    reduce: /@media \(prefers-reduced-motion: reduce\) \{\s*\.dc-lock-shut \.dc-lock-shackle, \.dc-lock-lift \.dc-lock-shackle,\s*\.dc-lock-veil-in, \.dc-lock-veil-out, \.dc-lock-blur-out, \.dc-lock-blur-in, \.dc-shake \{ animation: none !important; \}/.test(css),
    gate: /if \(reduced\) \{ setPhase\(null\); return undefined; \}/.test(lk) && /LOCK_MOTION_MS/.test(lk),
  };
  check('잠금: 팝오버·잠금 판·보드 자물쇠의 글자·색 규격(시안 ⑨)', Object.values(spec).every(Boolean), JSON.stringify(spec));
  check('잠금: 모션은 .42s quint 하나 · 움직임 줄이기면 전부 끄고 판은 즉시', Object.values(motion).every(Boolean), JSON.stringify(motion));
}

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
check('라이트 파스텔 값이 스펙과 같다', tok.blue==='#93b4e4' && tok.red==='#e5a29b' && tok.track==='#e7e4de', `${tok.blue}/${tok.red}/${tok.track}`);
check('이징이 cubic-bezier(.16,1,.3,1)', /cubic-bezier\(\s*\.?0?\.16/.test(tok.ease), tok.ease);
const dark = await ev(`(() => { document.documentElement.dataset.theme='dark';
  const cs=getComputedStyle(document.documentElement); return cs.getPropertyValue('--p-track').trim(); })()`);
check('다크 파스텔도 따로 정의', dark === '#2f2d28', dark);
await ev(`document.documentElement.dataset.theme='light'`);
// UI 다듬기 2차 D6·D11(PITFALLS 72-b·72-d) — 빌드가 @supports·:where를 지나서도 살아 있나를 실제 계산값으로 본다.
// D6 스위치 손잡이는 linear() 스프링 0.7초(지원 브라우저) · D11 제목은 balance · 본문은 pretty · 쓰는 칸 안은 둘 다 아님.
// **되돌리기**: index.css의 '@supports (transition-timing-function: linear(0, 1))' 줄이나 :where(h1…) 줄을 지우면 깨진다.
const d611 = await ev(`(() => {
  const box = document.createElement('div'); document.body.appendChild(box);
  box.innerHTML = '<span class="dc-spring"></span><h3>제목</h3><p>본문</p><div contenteditable="true"><p>쓰는 칸</p></div>';
  const [sp, h, p, ce] = [box.querySelector('.dc-spring'), box.querySelector('h3'), box.querySelector(':scope > p'), box.querySelector('[contenteditable] p')].map(e => getComputedStyle(e));
  const r = { ease: sp.transitionTimingFunction.slice(0, 40), dur: sp.transitionDuration, h: h.textWrapStyle, p: p.textWrapStyle, ce: ce.textWrapStyle, hMode: h.textWrapMode };
  box.remove(); return r;
})()`);
check('다듬기 2차 D6: 스위치 손잡이는 스프링 곡선(linear()) 0.7초', /^linear\(0[ ,]/.test(d611.ease) && d611.dur === '0.7s', JSON.stringify(d611));
check('다듬기 2차 D11: 제목 balance · 본문 pretty · 쓰는 칸 안은 그대로 · 접기 여부는 안 건드림', d611.h === 'balance' && d611.p === 'pretty' && d611.ce === 'auto' && d611.hMode === 'wrap', JSON.stringify(d611));

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
// 상시(0075)는 칸이 아니어도 고를 수 있다 — 맨 아래
check('보드: 팝오버에 상태 다섯(상시가 맨 아래)', pop && pop.items.length === 5 && pop.items[4] === '상시', JSON.stringify(pop && pop.items));

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

// ── 떠 있는 것 모션 (2026-10-15 · 사용자 지적 "딱딱하게 뜬다" · index.css '떠 있는 것 모션' · PITFALLS 57) ──
// 프로필 메뉴 · 알림 판 · 확인 팝오버 · 설정(내 정보) 창 · 업무 창(데스크톱 · 폰 393)이 **열리는 그 프레임에** 등장 모션을 타는가 —
// 이름이 우리 한 벌(dc-*-in)이고 길이 160ms 이상 · 이징 quint. 닫기는 걷히는 모션(dc-*-out)을 거쳐 내린다.
// 움직임 줄이기에서는 등장이 없고 닫기도 기다리지 않는다.
// **되돌리기**: index.css의 --dur-pop·--dur-dialog를 .15s로 두거나 usePopover의 POP_MOTION을 옛 `animate-in … duration-150`으로
// 되돌리면 길이·이름 검사가, hooks/useExit.js의 useLeave를 곧바로 fn()만 부르게 하면 퇴장 검사가 깨진다.
{
  const QUINT = 'cubic-bezier(0.16, 1, 0.3, 1)';
  // 누르고 → 다음 프레임에 찾은 판의 계산값. find는 문서에서 판을 돌려주는 식이다.
  const enter = (click, find) => ev(`new Promise(res => { ${click};
    requestAnimationFrame(() => { const el = (${find})(); if (!el) return res(null);
      const cs = getComputedStyle(el); res({ name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000), ease: cs.animationTimingFunction,
        origin: el.style.getPropertyValue('--pop-origin') }); }); })`, true);
  const ok = (m, name, min = 160) => !!m && m.name === name && m.ms >= min && m.ease === QUINT;
  const pop90 = `() => [...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && /z-\\[90\\]/.test(d.className))`;
  const scrimOf = (inner) => `() => [...document.querySelectorAll('div.fixed')].find(d => /bg-black\\/50/.test(d.className) && ${inner})`;
  const avatar = `[...document.querySelectorAll('button[title="설정"]')].find(b => b.offsetParent).click()`;
  const menuItem = `[...document.querySelectorAll('div')].find(d => d.style.position === 'fixed' && /z-\\[90\\]/.test(d.className))?.querySelectorAll('button')[0]?.click()`;
  const profileBox = scrimOf(`d.querySelector('input[aria-label], input[type=text]')`);
  const bell = `(async () => {
      const main = await (await fetch('/src/main.jsx')).text();
      const R = await import(main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react\\.js\\?v=[^"]+)"/)[1]);
      const C = await import(main.match(/"(\\/node_modules\\/\\.vite\\/deps\\/react-dom_client\\.js\\?v=[^"]+)"/)[1]);
      const { NotificationBell } = await import('/src/components/notificationBell.jsx');
      const host = document.createElement('div'); host.id = 'bell-host'; host.style.cssText = 'position:fixed;top:4px;right:56px;z-index:200';
      document.body.appendChild(host); (C.default ?? C).createRoot(host).render((R.default ?? R).createElement(NotificationBell, {}));
      await new Promise(r => setTimeout(r, 300)); })()`;
  const bellPanel = `() => [...document.querySelectorAll('#bell-host div')].find(d => d.style.position === 'fixed')`;

  const run = async (reduce) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
    await load(DESK, '/?p=p1');
    const r = {};
    r.menu = await enter(avatar, pop90);
    await sleep(300);
    r.settings = await enter(menuItem, profileBox);
    const box = `(() => { const s = (${profileBox})(); return s && s.firstElementChild; })`;
    r.settingsBox = await ev(`(() => { const b = ${box}(); if (!b) return null; const cs = getComputedStyle(b); return { name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000), ease: cs.animationTimingFunction }; })()`);
    await sleep(400);
    // 닫기(Esc) — 다음 프레임에도 창이 남아 걷히는 중인가, 그 뒤에는 내려갔나
    r.leave = await ev(`new Promise(res => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      requestAnimationFrame(() => { const b = ${box}(); res(b ? getComputedStyle(b).animationName : 'gone'); }); })`, true);
    await sleep(400);
    r.gone = await ev(`!(${profileBox})()`);
    r.confirm = await enter(`document.querySelector('main button[title="프로젝트 삭제"]').click()`, pop90);
    await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(400);
    r.task = await enter(`document.querySelector('.board-card').click()`, scrimOf(`d.classList.contains('z-50')`));
    r.taskBox = await ev(`(() => { const s = [...document.querySelectorAll('div.fixed')].find(d => /bg-black\\/50/.test(d.className) && d.classList.contains('z-50')); const b = s && s.firstElementChild;
      if (!b) return null; const cs = getComputedStyle(b); return { name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000), ease: cs.animationTimingFunction }; })()`);
    await sleep(500);
    await ev(`[...document.querySelectorAll('.fixed.z-50 button')].find(b => b.textContent.trim() === '닫기')?.click()`); await sleep(400);
    await ev(bell, true);
    r.bell = await enter(`document.querySelector('#bell-host button[title="알림"]').click()`, bellPanel);
    await load({ width: 393, height: 852, deviceScaleFactor: 2, mobile: true }, '/?p=p1');
    r.phoneTask = await enter(`document.querySelector('.board-card').click()`, `() => [...document.querySelectorAll('div.fixed.z-50')].find(d => d.classList.contains('top-0') && d.classList.contains('inset-x-0'))`);
    return r;
  };
  const on = await run(false);
  check('떠 있는 것: 프로필 메뉴는 앵커에서 자란다(dc-pop-in · 160ms 이상 · quint · 원점은 아바타 쪽)', ok(on.menu, 'dc-pop-in') && /px 0$/.test(on.menu.origin), JSON.stringify(on.menu));
  check('떠 있는 것: 설정 창 — 뒤판 dc-scrim-in · 창 dc-dialog-in(160ms 이상 · quint)', ok(on.settings, 'dc-scrim-in') && ok(on.settingsBox, 'dc-dialog-in'), JSON.stringify([on.settings, on.settingsBox]));
  check('떠 있는 것: 설정 창 Esc — 걷히는 모션(dc-dialog-out)을 거쳐 내려간다', on.leave === 'dc-dialog-out' && on.gone === true, JSON.stringify([on.leave, on.gone]));
  check('떠 있는 것: 확인 팝오버(프로젝트 삭제)도 같은 판 모션', ok(on.confirm, 'dc-pop-in'), JSON.stringify(on.confirm));
  check('떠 있는 것: 업무 창(데스크톱) — 뒤판 dc-scrim-in · 창 dc-dialog-in', ok(on.task, 'dc-scrim-in') && ok(on.taskBox, 'dc-dialog-in'), JSON.stringify([on.task, on.taskBox]));
  check('떠 있는 것: 알림 판 — dc-pop-in(160ms 이상 · quint)', ok(on.bell, 'dc-pop-in'), JSON.stringify(on.bell));
  check('떠 있는 것: 폰 업무 창(393) — 아래에서 떠오른다(dc-rise-in · 160ms 이상 · quint)', ok(on.phoneTask, 'dc-rise-in'), JSON.stringify(on.phoneTask));
  const off = await run(true);
  const none = (m) => !!m && m.name === 'none';
  check('떠 있는 것: 움직임 줄이기 — 메뉴·설정 창·확인·업무 창(데스크톱·폰)·알림 판에 등장 모션이 없다',
    [off.menu, off.settings, off.settingsBox, off.confirm, off.task, off.taskBox, off.bell, off.phoneTask].every(none), JSON.stringify(off));
  check('떠 있는 것: 움직임 줄이기 — 닫기는 기다리지 않는다(다음 프레임에 이미 없다)', off.leave === 'gone' && off.gone === true, JSON.stringify([off.leave, off.gone]));
  await send('Emulation.setEmulatedMedia', { features: [] });
}

// ── 첨부 + 저장 경로 ──
await load(DESK, '/?p=p1');
await ev(`document.querySelector('.board-card').click()`); await sleep(900);
const modal = await ev(`(() => {
  const m=document.querySelector('.fixed.inset-0.z-50');
  if(!m) return null;
  const t=m.textContent;
  return { open:true, hasTabs: /댓글|활동/.test(t), hasShare: !!m.querySelector('button[title*="공유"]'),
           hasEdit: [...m.querySelectorAll('button')].some(b=>b.textContent.trim()==='수정'),
           hasSave: [...m.querySelectorAll('button')].some(b=>b.textContent.trim()==='저장') };
})()`);
check('업무 상세: 열린다', modal?.open === true);
check('업무 상세: 댓글·활동 탭', modal?.hasTabs === true);
check('업무 상세: 공유 버튼', modal?.hasShare === true);
// 2026-09-29 — 보기가 기본이고 '수정'으로 수정 화면에 들어간다. 저장 버튼은 없다(칸마다 저절로).
check("업무 상세: 보기에 '수정' 버튼 · 저장 버튼은 없다", modal?.hasEdit === true && modal?.hasSave === false, JSON.stringify(modal));
await ev(clickText('수정'));
await sleep(1200);
const edit = await ev(`(() => {
  const m=document.querySelector('.fixed.inset-0.z-50'); const t=m?m.textContent:'';
  return { title: !!m?.querySelector('input[name=title]'),
           status: /시작 전/.test(t), teams: /담당 팀/.test(t), assignee: /담당자/.test(t),
           dates: /시작일/.test(t) && /마감일/.test(t), ai: /AI 문맥 다듬기/.test(t) };
})()`);
check('업무 창: 제목·상태·팀·담당자·일정 입력이 그대로', edit.title && edit.status && edit.teams && edit.assignee && edit.dates, JSON.stringify(edit));
check('업무 창: AI 다듬기 버튼', edit.ai === true);
// 제목을 바꾸면 조용해진 뒤(600ms) 저절로 저장소에 반영된다
await ev(`(() => { const i=document.querySelector('input[name=title]');
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(i,'저장 확인용 제목'); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(1300);
const saved = await ev(`Object.values(JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId).some(t=>t.title==='저장 확인용 제목')`);
check('업무 창: 제목이 저절로 저장소에 반영된다', saved === true);


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
    await ev(clickText('수정'));   // 보기가 기본이다(2026-09-29)
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
    // 저장 버튼이 없다 — 본문은 800ms 조용하면 저절로(게스트) · 로컬 저장 300ms
    await sleep(1400);
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
      // **`inset-0`으로 찾지 않는다**(2026-09-22). 폰의 업무 창은 키보드에 가리지 않으려고
      // `inset-0` 대신 앱 뿌리와 같은 높이(`--app-vh`)를 쓰게 바뀌었다 — 그 자리를 클래스
      // 글자로 붙잡고 있으면 화면이 나아질 때마다 이 검사가 헛으로 깨진다.
      이름: '업무 창', path: `/?p=p1&t=${firstId}`, tip: '.fixed.z-50 .tiptap',
      // 보기가 기본이다(2026-09-29) — '수정'을 눌러 편집기를 세운다
      열기: async () => {
        const 수정 = `[...document.querySelectorAll('.fixed.z-50 button')].find(b => b.textContent.trim() === '수정')`;
        if (!await waitFor(수정)) return false;
        await ev(`${수정}.click()`);
        return waitFor(`document.querySelector('.fixed.z-50 .tiptap')`);
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
  // 수정 화면으로 들어가 한 번 더 잰다(2026-09-29 보기/수정 나눔 — 2026-09-28 이전 모양으로 되살렸다)
  await ev(clickText('수정'));
  await sleep(1100);
  const edit2 = await ev(box);
  check('업무 수정: 링크를 붙이는 버튼이 없다',
    edit2.추가링크 === false && edit2.추가참고링크 === false && edit2.링크줄 === false, JSON.stringify(edit2));
  // 되돌린 것은 **업무 창뿐이다** — 같은 링크가 프로젝트 헤더에는 그대로 서 있다
  check('프로젝트 헤더의 참고 링크 칩은 그대로다', edit2.헤더칩 === true, JSON.stringify(edit2));
  delete st.tasks.byId[firstId].pinnedLinks;   // 뒤 검사들이 쓰는 상태로 되돌린다
}

// ── 청년별 담당 업무 줄이 두 폭에서 다 들어오나 (2026-09-22 사용자 신고) ─────
// 신고 셋: "항목 추가는 되지도 않고 / 폰에서 날짜 달력이 밀리고 선택하는 것도 화면에
// 안 들어오고 / 하위 업무 초록 라벨이 한 줄 밀린다."
// 원인 셋: ① writeActionSection이 할 일 빈 줄을 버려서 새로 만든 줄이 그 자리에서
// 사라졌다(부품이 줄을 직접 들고 있게 고쳤다) ② DatePicker가 `absolute left-0 top-full`
// 이라 좁은 화면에서 화면 밖으로 나갔다(포털 + 세로 클램프로) ③ 초록 표가 흐름대로
// 접혔다(order/basis로 좁을 때 2줄 · 넓을 때 1줄을 못 박았다).
// 되돌리기 검사: ActionItems의 `rows` 상태를 지우면 '항목 추가'가, DatePicker의 포털을
// 되돌리면 '달력이 화면 안에'가, 하위 업무 줄의 '두 줄/한 줄'은 **모양만 지킨다** —
// 375px에서는 order·basis를 빼도 저절로 같은 모양으로 접혀서 되돌려도 안 깨졌다(2026-09-24 확인).
// 2026-09-24: 내린 줄은 위에서 빠지고 본문 도막에서도 지워진다(초록 '하위 업무' 표는 없앴다) —
// 편집기 onCreate가 남은 줄(rest)을 본문에 안 적으면 '본문 도막에서 지워진다'가 깨진다.
{
  const AC = ['### 정한 것', '- 주제를 예배자로 바꿔요', '', '### 청년별 담당 업무',
    '- @노준석 @이시온 · 10월 콘티 확정 · 9월 26일까지',
    '- @엔지니어팀 · 영상 송출 계획과 역할 분담 정하고 PPT 완료 일정 잡기 · 9월 26일까지'].join('\n');
  const tid = Object.keys(st.tasks.byId)[0];
  const keep = st.tasks.byId[tid].content;
  st.tasks.byId[tid].content = AC;
  st.tasks.byId[tid].subtasks = [];
  const ROWS = `[...document.querySelectorAll('.action-items > div:nth-child(2) > div')]`;
  for (const w of [1440, 375]) {
    const tag = `${w}px 담당 업무`;
    await load({ width: w, height: 860, deviceScaleFactor: 1, mobile: w < 768 }, `/?p=p1&t=${tid}`);
    await ev(clickText('수정')); await sleep(1100);

    const before = await ev(`document.querySelectorAll('.action-items input[aria-label="할 일"]').length`);
    await ev(`[...document.querySelectorAll('.action-items button')].find(b => b.textContent.includes('항목 추가'))?.click()`);
    await sleep(500);
    const after = await ev(`document.querySelectorAll('.action-items input[aria-label="할 일"]').length`);
    check(`${tag}: 항목 추가로 줄이 는다`, after === before + 1, `${before} → ${after}`);

    await ev(`[...document.querySelectorAll('.action-check')].forEach(b => { if (!b.checked && !b.disabled) b.click(); })`);
    await sleep(350);
    await ev(`[...document.querySelectorAll('.action-items button')].find(b => b.textContent.trim() === '하위 업무로')?.click()`);
    await sleep(800);
    // 내린 줄은 위에서 빠진다(2026-09-24) — 남는 것은 '항목 추가'로 만든 빈 줄 하나뿐
    const left = await ev(`[...document.querySelectorAll('.action-items input[aria-label="할 일"]')].map(i => i.value)`);
    check(`${tag}: 내린 줄은 위 구역에서 빠진다`, JSON.stringify(left) === '[""]', JSON.stringify(left));
    // 아래 하위 업무 줄에 사람 칩·기한 칩이 서고, 좁으면 두 줄 · 넓으면 한 줄
    const shape = await ev(`[...document.querySelectorAll('.subtask-row')].map(r => {
      const kids=[...r.children].map(c => c.getBoundingClientRect()).filter(b => b.width>0);
      const band=(b)=>Math.round((b.top+b.bottom)/2/12);
      const bandOf=(el)=>el ? band(el.getBoundingClientRect()) : -1;
      return { lines: [...new Set(kids.map(band))].length,
               // 좁을 때 [체크][사람] … [🗑] / [할 일][기한] — 사람과 🗑이 같은 줄, 할 일은 다음 줄
               ownerBand: bandOf(r.querySelector('button[aria-label$="완료"]')),
               trashBand: bandOf(r.querySelector('button[aria-label$="삭제"]')),
               inputBand: bandOf(r.querySelector('input')),
               owner: [...r.querySelectorAll('button')].map(b => b.textContent.trim()).find(t => /노준석|엔지니어팀/.test(t)) || '',
               due: r.querySelector('button[aria-label="기한"]')?.textContent.trim() || '' };
    })`);
    check(`${tag}: 하위 업무 줄에 사람·기한이 같이 내려온다`,
      (shape || []).length === 2 && shape.every(r => r.owner && r.due === '9월 26일'), JSON.stringify(shape));
    check(`${tag}: ${w < 768 ? '좁은 화면은 두 줄' : '넓은 화면은 한 줄'}`,
      (shape || []).length > 0 && shape.every(r => r.lines === (w < 768 ? 2 : 1)
        && r.ownerBand === r.trashBand && (w < 768 ? r.inputBand !== r.ownerBand : r.inputBand === r.ownerBand)),
      JSON.stringify(shape));

    // 달력은 **그 자리에서** 뜬다(2026-09-24 사용자 신고 "위에서 오고 다른 데서 온다") —
    // 첫 프레임부터 버튼 왼쪽 아래에 서 있어야 한다. 되돌리기: DatePicker의 transition-none을 빼면
    // 첫 프레임이 화면 왼쪽 위(8,8)에서 미끄러져 내려오고, align:'start'를 빼면 왼쪽이 버튼과 어긋난다.
    const fly = await ev(`new Promise(async (done) => {
      const t=document.querySelector('.subtask-row button[aria-label="기한"]');
      t.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300));
      const tr=t.getBoundingClientRect();
      t.click(); const fr=[];
      for (let i=0;i<10;i++) { await new Promise(r => requestAnimationFrame(r));
        const d=document.querySelector('[data-datepicker]'); if (!d) continue;
        const r=d.getBoundingClientRect(); fr.push([Math.round(r.left), Math.round(r.top), Math.round(r.bottom), d.offsetWidth]); }
      done({ tl: Math.round(tr.left), tt: Math.round(tr.top), tb: Math.round(tr.bottom), vw: innerWidth, fr });
    })`, true);
    const f0 = fly?.fr?.[0];
    check(`${tag}: 달력이 첫 프레임부터 버튼 자리에서 뜬다`,
      // 왼쪽 = 버튼 왼쪽 끝을 화면 안으로 가둔 값(폰에서 오른쪽 버튼이면 안쪽으로 당겨진다)
      !!f0 && Math.abs(f0[0] - Math.min(Math.max(fly.tl, 8), fly.vw - f0[3] - 8)) <= 8
        && (Math.abs(f0[1] - fly.tb) <= 12 || Math.abs(f0[2] - fly.tt) <= 12),
      JSON.stringify(fly));
    await sleep(400);
    const cal = await ev(`(() => {
      const d=document.querySelector('[data-datepicker]'); if(!d) return null;
      const r=d.getBoundingClientRect();
      return { l:Math.round(r.left), rt:Math.round(r.right), t:Math.round(r.top), b:Math.round(r.bottom),
               vw:window.innerWidth, vh:window.innerHeight, days:d.querySelectorAll('button').length };
    })()`);
    check(`${tag}: 날짜 달력이 열린다`, !!cal && cal.days > 20, JSON.stringify(cal));
    check(`${tag}: 날짜 달력이 화면 안에 들어온다`,
      !!cal && cal.l >= 0 && cal.rt <= cal.vw && cal.t >= 0 && cal.b <= cal.vh, JSON.stringify(cal));
    if (w === 1440) {
      await sleep(1300);   // 저장 버튼이 없다 — 내리기는 곧바로 저장된다(로컬 저장 300ms)
      const saved = await ev(`(() => { const t=JSON.parse(localStorage.getItem('church_app_v4')).tasks.byId[${JSON.stringify(tid)}];
        return { content: t.content, subs: (t.subtasks||[]).map(s => [s.title, s.assignee || '', s.due || '']) }; })()`);
      check('저장하면 내린 줄은 본문 도막에서 지워진다',
        !!saved && !/콘티 확정|영상 송출/.test(saved.content) && /주제를 예배자로/.test(saved.content), JSON.stringify(saved?.content));
      check('저장된 하위 업무가 사람·기한을 들고 있다',
        !!saved && saved.subs.length === 2 && saved.subs.every(s => s[1] && /^\d{4}-09-26$/.test(s[2])), JSON.stringify(saved?.subs));
    }
  }
  // 체크칸은 **두 테마에서 다 우리 바탕**이다(라이트에서 검게 뜨던 자리 — accent-color만
  // 주면 켰을 때의 색만 바뀌고 꺼진 상자는 브라우저 기본 모양이 그대로 나온다)
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
    await sleep(300);
    const box = await ev(`(() => {
      const el=document.querySelector('.action-check'); if(!el) return null;
      const cs=getComputedStyle(el);
      return { appearance: cs.appearance, bg: cs.backgroundColor, border: cs.borderTopColor };
    })()`);
    check(`체크칸이 ${theme}에서 우리 바탕이다`,
      !!box && box.appearance === 'none' && box.bg !== 'rgb(0, 0, 0)' && box.bg !== 'rgba(0, 0, 0, 0)',
      JSON.stringify(box));
  }
  st.tasks.byId[tid].content = keep;
  delete st.tasks.byId[tid].subtasks;
}

// ── 업무 보기가 수정 편집기와 같은 줄에 선다 · 하위 업무 추가 칸의 글 시작 (2026-09-25 · 목업 A1·B2) ──
// 빈 줄은 한 줄 높이(예전 8px), 들여쓰기는 그대로(예전 접힘) — 수정↔보기 때 줄이 뛰지 않는다.
// (2026-09-28에 보기 화면이 없어져 걷었다가 2026-09-29 보기/수정 나눔으로 되살렸다.)
// 하위 업무 추가 칸은 글이 편집기 글과 같은 x에서 시작한다(px-2 → px-3).
// **되돌리기**: RichText의 빈 줄을 `h-2`로, p의 `whitespace-break-spaces`를 빼면 첫 줄이,
// 추가 칸을 px-2로 되돌리면 둘째 줄이 깨진다.
{
  const tid = 't0';
  const keep = st.tasks.byId[tid].content;
  st.tasks.byId[tid].content = '첫 줄\n    들여쓴 줄\n\n빈 줄 뒤 글\n\n\n빈 줄 둘 뒤 글\n마지막 줄';
  const LINES = (sel) => `(() => {
    const box = document.querySelector(${JSON.stringify(sel)}); if (!box) return null; const out = [];
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); const lead = n.textContent.length - n.textContent.trimStart().length;
      r.setStart(n, lead); r.setEnd(n, n.textContent.length); const rc = r.getClientRects()[0]; if (!rc) continue;
      out.push([n.textContent.trim().slice(0, 6), rc.top, rc.left]);
    }
    return out;
  })()`;
  const rel = (a) => (a || []).map(([t, y, x]) => [t, Math.round((y - a[0][1]) * 2) / 2, Math.round((x - a[0][2]) * 2) / 2]);
  for (const m of [DESK, { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }]) {
    await load(m, `/?p=p1&t=${tid}`);
    await sleep(600);
    const view = rel(await ev(LINES('.prose')));
    await ev(clickText('수정')); await sleep(1400);
    const edit = rel(await ev(LINES('.tiptap')));
    const off = view.map((v, i) => (edit[i] ? [v[0], v[1] - edit[i][1], v[2] - edit[i][2]] : [v[0], 'x'])).filter(d => d[1] !== 0 || d[2] !== 0);
    check(`${m.width}px: 업무 보기의 줄이 편집기와 같은 자리에 선다(빈 줄 한 줄 · 들여쓰기 그대로)`,
      view.length === 5 && edit.length === 5 && off.length === 0, JSON.stringify({ view, edit, off }));
    check(`${m.width}px: 업무 창 편집기가 다섯 줄을 세우고 들여쓴 줄은 안으로 든다`,
      edit.length === 5 && edit[1][2] > 0 && edit[2][1] > edit[1][1], JSON.stringify(edit));
    const xs = await ev(`(() => {
      const t = document.querySelector('.tiptap'); const i = [...document.querySelectorAll('input')].filter(x => (x.placeholder || '').startsWith('예:')).pop();
      if (!t || !i) return null; const cs = getComputedStyle(i);
      return { editor: Math.round(t.getBoundingClientRect().left), add: Math.round(i.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) };
    })()`);
    check(`${m.width}px: 하위 업무 추가 칸의 글이 편집기 글과 같은 x에서 시작한다`, !!xs && Math.abs(xs.editor - xs.add) <= 1, JSON.stringify(xs));
  }
  st.tasks.byId[tid].content = keep;
}

// ── 면 S2~S11 (UI 다듬기 2차 2026-10-27 · PITFALLS 73) ──────────────────────────
// S2 높이마다 모서리 · S3 상단 바 물러남 · S4 묶음 사이 선만 · S5 빛 한 방향 · S6 영역 색 그림자 · S7 붙을 때만 머리 선 ·
// S8 더 있을 때만 끝 흐림 · S10 종이 결(굽는 길에서는 뺀다) · S11 쓰는 칸 바탕/고르는 칸 테두리.
// **되돌리기**: index.css 그림자 식의 `:root, .shadow-tint`에서 `.shadow-tint`를 빼면 S6이, `.stuck-edge::after`의
// 컨테이너 질의를 지우면 S7이, mobileNav의 FadeRow를 div로 되돌리면 S8이, shareImage의 `filter: (el) => !isGrain(el)`을
// 지우면 S10이 깨진다.
{
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  // S2 — 떠 있는 판(포털 팝오버 · 메뉴)은 12px(rounded-lg) 한 벌. 10px 카드도 12px로 올렸다(버튼만 10px이 남는다).
  const { readdirSync, statSync } = await import('node:fs');
  const SRC = new URL('../src/', import.meta.url);
  const walk = (u) => readdirSync(u).flatMap(n => { const c = new URL(n, u); return statSync(c).isDirectory() ? walk(new URL(n + '/', u)) : [c]; });
  const odd = [];
  for (const u of walk(SRC).filter(u => /\.(jsx|js)$/.test(u.pathname))) {
    const name = decodeURIComponent(u.pathname).split('/src/')[1];
    readFileSync(u, 'utf8').split('\n').forEach((l, i) => {
      if (/pop\.panel\(|dc-pop/.test(l) && /shadow-elevated/.test(l) && /rounded-(?:\[\d+px\]|xl|md|sm)\b/.test(l)) odd.push(`${name}:${i + 1}`);
      if (/rounded-\[10px\]/.test(l) && !/h-\[46px\]|h-12|h-11|worship-add-card|data-lock-/.test(l)) odd.push(`${name}:${i + 1} 10px`);
    });
  }
  check('S2: 떠 있는 판은 12px 한 벌 · 카드에 10px이 남지 않는다(버튼 · 잠금 판 시안 ⑨는 그대로)', odd.length === 0, odd.join(' · '));
  // S4 — 업무 창 칸은 묶음 사이에만 선(줄마다 divide 없음)
  const tf = rd('modals/taskFields.jsx');
  const props = tf.slice(tf.indexOf('export function TaskProps'));
  check('S4: 업무 창 칸은 줄마다 선이 아니라 묶음 사이 한 줄', !/divide-y/.test(props.slice(0, 600)) && /data-prop-group/.test(props));
  // S11 — 담당자 찾기 칸(쓰는 칸)은 바탕, 선행 업무 select(고르는 칸)는 테두리
  check('S11: 쓰는 칸은 바탕 · 고르는 칸은 테두리', /border-transparent rounded-xs bg-surface-hover/.test(tf) && /appearance-none w-full[^\"]*bg-transparent border border-line/.test(tf));
  // S10 — 종이 결은 굽는 두 길에서 빠진다
  const si = rd('services/shareImage.js');
  check('S10: 종이 결 판이 있고 그림·PDF로 굽는 두 길이 뺀다', /data-paper-grain/.test(rd('components/paper.jsx'))
    && /filter:\s*\(el\)\s*=>\s*!isGrain\(el\)/.test(si) && /\|\|\s*isGrain\(el\)/.test(si));

  await load(DESK);
  // S5 — 모든 그림자 층이 x 0 · y > 0(위에서 오는 빛 하나) — 라이트·다크
  const layers = await ev(`(() => {
    const out = {};
    for (const th of ['light', 'dark']) {
      document.documentElement.dataset.theme = th;
      const cs = getComputedStyle(document.documentElement);
      for (const n of ['--app-shadow-soft', '--app-shadow-elevated']) {
        out[th + n] = cs.getPropertyValue(n).split(/,(?![^(]*\\))/).map(s => s.trim().split(/\\s+/).slice(0, 2).map(parseFloat));
      }
    }
    document.documentElement.dataset.theme = 'light';
    return out;
  })()`);
  const allDown = Object.values(layers).every(ls => ls.length >= 2 && ls.every(([x, y]) => x === 0 && y > 0));
  check('S5: 그림자 층은 모두 x 0 · y 아래(라이트·다크 두 단)', allDown, JSON.stringify(layers));
  // S6 — 영역(.shadow-tint)이 색조를 바꾸면 그 안 카드(shadow-soft)의 그림자가 그 색으로 물든다. 밖은 기본 색조 그대로.
  const tint = await ev(`(() => {
    const box = document.createElement('div');
    box.innerHTML = '<div class="season-wash shadow-tint" data-season="purple"><div class="shadow-soft" id="__s6in"></div></div><div class="shadow-soft" id="__s6out"></div>';
    document.body.appendChild(box);
    const r = { in: getComputedStyle(document.getElementById('__s6in')).boxShadow, out: getComputedStyle(document.getElementById('__s6out')).boxShadow };
    box.remove(); return r;
  })()`);
  check('S6: 영역 색을 바꾸면 안의 카드 그림자가 그 색으로 물든다', /70, 50, 140/.test(tint.in) && /55, 42, 28/.test(tint.out) && !/55, 42, 28/.test(tint.in), JSON.stringify(tint));
  // S7 — sticky 머리는 붙기 전엔 선이 없고(::after 0) 붙으면 선 + 그림자(::after 1)
  const stuck = await ev(`(async () => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:160px;overflow-y:auto;z-index:999;background:#fff';
    box.innerHTML = '<div class="stuck-edge" style="position:sticky;top:0;height:30px;background:#fff">머리</div>' + Array.from({ length: 30 }, (_, i) => '<div style="height:24px">' + i + '</div>').join('');
    document.body.appendChild(box);
    const h = box.firstElementChild; const op = () => getComputedStyle(h, '::after').opacity;
    await new Promise(r => setTimeout(r, 300)); const before = op();
    box.scrollTop = 60; await new Promise(r => setTimeout(r, 450)); const after = op();
    const shadow = getComputedStyle(h, '::after').boxShadow;
    box.remove(); return { before, after, shadow, supports: CSS.supports('container-type', 'scroll-state') };
  })()`, true);
  check('S7: 머리 선은 붙었을 때만(스크롤 상태 질의)', stuck.supports && stuck.before === '0' && stuck.after === '1' && /inset/.test(stuck.shadow), JSON.stringify(stuck));
  // S3 — 데스크톱 상단 바: 로고·내 얼굴이 쉬는 동안 옅고, 바에 마우스를 올리면 또렷. 다붓이 알약은 그대로.
  const barOp = () => ev(`(() => { const b = document.querySelector('[data-top-nav]'); const logo = b?.querySelector('[data-bar-logo]'); const me = b?.querySelector('button[title="설정"]');
    return b && { logo: getComputedStyle(logo).opacity, me: getComputedStyle(me).opacity, line: getComputedStyle(b).borderBottomColor }; })()`);
  const rest = await barOp();
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 26 }); await sleep(400);
  const hover = await barOp();
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600 }); await sleep(300);
  check('S3: 상단 바는 쉬는 동안 한 단 물러나고 마우스를 올리면 또렷하다', !!rest && rest.logo === '0.8' && rest.me === '0.6' && hover.logo === '1' && hover.me === '1', JSON.stringify({ rest, hover }));

  // S8 — 폰 프로젝트 탭 줄이 넘치면 오른쪽 끝만 흐리고, 끝까지 밀면 왼쪽만 흐리다(넘치지 않으면 마스크 없음)
  const keepP = st.projects;
  const many = {}; const ids = [];
  for (let i = 0; i < 12; i++) { const id = `fp${i}`; ids.push(id); many[id] = { id, title: `긴 이름의 프로젝트 ${i + 1}`, pinnedLinks: [] }; }
  st.projects = { byId: { ...keepP.byId, ...many }, allIds: [...keepP.allIds, ...ids] };
  await load({ width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, '/?p=p1');
  const fade = await ev(`(async () => {
    const row = [...document.querySelectorAll('.x-scroll-lock')].find(r => r.textContent.includes('긴 이름의 프로젝트'));
    if (!row) return null;
    const at = () => ({ over: row.hasAttribute('data-x-fade'), l: row.hasAttribute('data-fade-l'), r: row.hasAttribute('data-fade-r'), mask: getComputedStyle(row).maskImage !== 'none' });
    const start = at();
    row.scrollLeft = row.scrollWidth; await new Promise(r => setTimeout(r, 200));
    return { start, end: at() };
  })()`, true);
  st.projects = keepP;
  check('S8: 넘치는 줄은 더 있는 쪽 끝만 흐리다', !!fade && fade.start.over && fade.start.mask && !fade.start.l && fade.start.r && fade.end.l && !fade.end.r, JSON.stringify(fade));
}

// ── 색 C (UI 다듬기 2차 2026-10-27 · PITFALLS 77) ──────────────────────────
// C4 hover·눌림은 accent에서 계산 — accent를 바꾸면 따라오고(라이트·다크), 한 단(12%)·두 단(24%) 진하다.
// **되돌리기**: index.css의 --app-accent-strong을 손으로 적은 색(#33589c)으로 두면 깨진다.
{
  await load(DESK);
  const c4 = await ev(`(() => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const num = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number).map(v => v <= 1 && s.startsWith('color(') ? v * 255 : v);
    const read = (cls) => { el.className = cls; return num(getComputedStyle(el).backgroundColor); };
    const out = {};
    for (const th of ['light', 'dark']) {
      document.documentElement.dataset.theme = th;
      out[th] = { base: read('bg-accent'), hover: read('bg-accent-strong'), press: read('bg-accent-press') };
    }
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.setProperty('--app-accent', '#c0392b');
    out.swapped = read('bg-accent-strong');
    document.documentElement.style.removeProperty('--app-accent');
    el.remove(); return out;
  })()`);
  const near = (a, b, k) => a.every((v, i) => Math.abs(v - b[i] * (1 - k)) <= 1.5);
  check('C4: hover·눌림이 accent의 한 단(12%)·두 단(24%) — 라이트·다크 · accent를 바꾸면 따라온다',
    ['light', 'dark'].every(t => near(c4[t].hover, c4[t].base, .12) && near(c4[t].press, c4[t].base, .24)) && near(c4.swapped, [192, 57, 43], .12), JSON.stringify(c4));

  // C5·C6 칩 — 아홉 색 짝(바탕 --app-tag-X · 글자 --app-tag-X-fg)의 글자 대비가 라이트·다크 모두 4.5:1 이상(C5 대비 보증),
  // 바탕끼리 가장 가까운 짝도 OKLab 거리 .02 이상 · 바탕이 카드(surface)와 .08 이상 떨어진다(C6 한 단 위 — 옛 회색·갈색은 .007).
  // **되돌리기**: 태그 팔레트를 옛 값(#e8e6ea·#eee6e0 …)으로 두면 C6이, 아무 글자색을 바탕 쪽으로 옅게 하면 C5가 깨진다.
  const TAGS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
  const pal = await ev(`(() => { const out = {};
    for (const th of ['light', 'dark']) { document.documentElement.dataset.theme = th; const cs = getComputedStyle(document.documentElement);
      out[th] = { surface: cs.getPropertyValue('--app-surface').trim(), tags: ${JSON.stringify(TAGS)}.map(k => [k, cs.getPropertyValue('--app-tag-' + k).trim(), cs.getPropertyValue('--app-tag-' + k + '-fg').trim()]) }; }
    document.documentElement.dataset.theme = 'light'; return out; })()`);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const rgbOf = (h) => [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  const lumOf = (h) => { const [r, g, b] = rgbOf(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };
  const lab = (h) => { const [r, g, b] = rgbOf(h);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]; };
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const c5 = [], c6 = [];
  for (const th of ['light', 'dark']) {
    const { surface, tags } = pal[th];
    for (const [k, bg, fg] of tags) { const r = cr(bg, fg); if (!(r >= 4.5)) c5.push(`${th} ${k} ${r.toFixed(2)}`); const d = dE(bg, surface); if (!(d >= 0.08)) c6.push(`${th} ${k}↔surface ${d.toFixed(3)}`); }
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) { const d = dE(tags[i][1], tags[j][1]); if (!(d >= 0.02)) c6.push(`${th} ${tags[i][0]}↔${tags[j][0]} ${d.toFixed(3)}`); }
  }
  check('C5: 칩 아홉 색 글자 대비 4.5:1 이상(라이트·다크)', c5.length === 0 && pal.light.tags.every(t => /^#/.test(t[1])), c5.join(' · ') || JSON.stringify(pal.light.tags[0]));
  check('C6: 칩 바탕은 서로·카드와 갈린다(한 단 위)', c6.length === 0, c6.join(' · '));

  // C8 — 넓은 색 영역(P3) 화면에서만 바탕 빛 · brand-grad(라이트·다크) · 다붓이 고리가 display-p3 값으로. sRGB 화면은 그대로.
  // **되돌리기**: P3 .dab-ring 묶음을 원래 .dab-ring보다 앞에 두면(뒤의 sRGB 규칙이 이긴다) 깨진다.
  const gamut = async (v) => { await send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: v }] }); return ev(`(() => {
    const box = document.createElement('div'); box.innerHTML = '<div class="app-glow"></div><div class="app-glow-tall"></div><div class="dab-ring"></div>'; document.body.appendChild(box);
    const [g, t, r] = [...box.children].map(n => getComputedStyle(n).backgroundImage);
    const root = document.documentElement; const light = getComputedStyle(root).getPropertyValue('--app-brand-grad');
    root.dataset.theme = 'dark'; const dark = getComputedStyle(root).getPropertyValue('--app-brand-grad'); root.dataset.theme = 'light';
    box.remove(); return [g, t, r, light, dark].map(s => /display-p3/.test(s));
  })()`); };
  const p3 = await gamut('p3'), srgb = await gamut('srgb');
  await send('Emulation.setEmulatedMedia', { features: [] });
  check('C8: P3 화면에서만 바탕 빛·brand-grad·다붓이 고리가 display-p3', p3.every(Boolean) && srgb.every(x => !x), JSON.stringify({ p3, srgb }));

  // C7·C9 역할 표 — index.css '역할 표'의 `--이름 #라이트/#다크`가 실제 토큰 값과 같다(표가 코드와 어긋나지 않게).
  // C9 원색은 예외에만 — 화면 className에 `bg-[#…]`류 hex와 Tailwind 원색 팔레트(`bg-gray-100` 등)가 없다(공개 화면 둘만 예외).
  // **되돌리기**: 태그 하나를 고치고 표를 그대로 두면 C7이, 아무 화면에 `bg-[#ffffff]`를 넣으면 C9가 깨진다.
  {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('/* ── 역할 표 (UI'), css.indexOf('── 역할 표 끝'));
    const rows = [...block.matchAll(/(--[\w-]+) (#[0-9a-f]{6})\/(#[0-9a-f]{6})/g)].map(m => [m[1], m[2], m[3]]);
    const live = await ev(`(() => { const names = ${JSON.stringify(rows.map(r => r[0]))}; const out = {};
      for (const th of ['light', 'dark']) { document.documentElement.dataset.theme = th; const cs = getComputedStyle(document.documentElement); out[th] = names.map(n => cs.getPropertyValue(n).trim().toLowerCase()); }
      document.documentElement.dataset.theme = 'light'; return out; })()`);
    const off = rows.filter((r, i) => live.light[i] !== r[1] || live.dark[i] !== r[2]).map((r, i) => `${r[0]} 표 ${r[1]}/${r[2]}`);
    check('C7·C9: 역할 표(10단 포함)의 라이트·다크 값이 실제 토큰과 같다', rows.length >= 40 && off.length === 0, off.join(' · ') || `${rows.length}줄`);
    const SRC = new URL('../src/', import.meta.url);
    const walk = (u) => readdirSync(u).flatMap(n => { const c = new URL(n, u); return statSync(c).isDirectory() ? walk(new URL(n + '/', u)) : [c]; });
    const raw = [];
    for (const u of walk(SRC).filter(u => /\.(jsx|js)$/.test(u.pathname))) {
      const name = decodeURIComponent(u.pathname).split('/src/')[1];
      if (/LoginScreen|newcomerCard/.test(name)) continue;
      readFileSync(u, 'utf8').split('\n').forEach((l, i) => {
        if (/\b(?:bg|text|border|from|via|to|fill|stroke|ring|outline|decoration)-\[#[0-9a-fA-F]{3,8}\]/.test(l)
          || /\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|stone|red|blue|green|yellow|purple|pink|orange|amber|emerald|sky|indigo|rose|violet|teal|cyan|lime|fuchsia)-\d{2,3}\b/.test(l)) raw.push(`${name}:${i + 1}`);
      });
    }
    check('C9: 화면 className에 원색(hex·Tailwind 팔레트)이 없다 — 역할 토큰만', raw.length === 0, raw.join(' · '));
  }

  // C11 — 대시보드 '전체 진척도'(끝낸 몫 막대)가 보는 동안 100%가 되는 순간 빛이 한 번 지나간다(transform만 · 끝나면 걷힘).
  // 처음 뜰 때는 없다. **되돌리기**: dashboardParts Bar의 setSweep 줄을 지우면 깨진다.
  await load(DESK);
  const c11 = await ev(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(900);
    const atMount = document.querySelectorAll('.dc-bar-sweep').length;
    const s = window.__store; const st = s.getState();
    for (const id of st.tasks.allIds) { const t = st.tasks.byId[id]; if (t.status !== '완료') s.dispatch({ type: 'UPSERT_TASK', payload: { ...t, status: '완료' } }); }
    await sleep(250);
    const sw = [...document.querySelectorAll('.dc-bar-sweep')];
    const fill = sw[0]?.parentElement.querySelector('.dc-bar-fill');
    const kf = sw[0]?.getAnimations().map(a => Object.keys(a.effect.getKeyframes()[0]).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)));
    const r = { atMount, n: sw.length, grad: fill ? /gradient/.test(getComputedStyle(fill).backgroundImage) : null, props: kf, dur: sw[0] && getComputedStyle(sw[0]).animationDuration };
    await sleep(1800); r.after = document.querySelectorAll('.dc-bar-sweep').length; return r;
  })()`, true);
  check('C11: 진척도가 100%가 되는 순간에만 빛이 한 번(transform) — 처음엔 없고 끝나면 걷힌다',
    c11.atMount === 0 && c11.n >= 1 && c11.grad && JSON.stringify(c11.props) === '[["transform"]]' && c11.dur === '1.1s' && c11.after === 0, JSON.stringify(c11));
}

console.log(results.join('\n'));
console.log(logs.length?'\n콘솔 오류:\n'+logs.slice(0,6).join('\n'):'\n콘솔 오류 없음');
ws.close(); chrome.kill(); process.exit(results.some(r=>r.startsWith('FAIL'))?1:0);
