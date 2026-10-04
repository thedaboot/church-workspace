// ============================================================================
// 위키 장의 모양과 '지금' 칸 — 순수 모듈(wikiCore만 import). 화면(views/wikiView.jsx)이 쓰고 tests/logcheck이 노드에서 읽는다.
// (17차 · 승인 목업 2026-10-04 '나무위키식 장')
// ----------------------------------------------------------------------------
//   outlineOf(page)          장 → 번호 붙은 큰 마디(1. 개요 · 2. 하는 일 …)와 작은 마디(2.1.) · 목차
//   teamMembers / teamWork   팀 장의 '구성원'(현재 명단 기준) · '지금 하는 일'(현재 업무 기준) — 화면이 열 때 읽은 가입자·업무로 센다
//   pageTasks                행사 장의 '준비'(현재 업무 기준) — 장이 가리키는 업무를 지금 상태로
//   teamInfo / prepInfo      정보 상자의 줄 — 적힌 글(사람이 고친 글 포함)과 명단에서만 · 모르는 줄은 뺀다(지어내지 않는다)
//   relatedPages             관련 문서 — 같은 업무를 가리키는 다른 장 · 자주 쓰는 말
//   linkTargets / linkParts  글 안의 장 제목·자주 쓰는 말을 그 장으로(마디마다 처음 한 번)
// 빼는 업무는 장을 만들 때(api/_wikiBuild.js)와 같다 — 워크스페이스 개선·회계 프로젝트 · 명단·출석 같은 한 사람 한 사람의 기록.
// ============================================================================
import { mdLabel, kstDate, taskWhen, stripBold } from './wikiCore.js';

export const TEAM_NAMES = ['교역자', '임원진', '찬양팀', '워십팀', '웰컴팀', '미디어팀', '엔지니어팀'];
const AUDIENCE = new Set(['순장', '순원']);
export const EXCLUDED_PROJECT = /워크스페이스 개선|^회계$|회계 인수인계/;
export const PERSONAL_CARD = /미수료|명단|출석|연락처/;
const STEMS = { 교역자: ['교역', '전도사', '목사'], 임원진: ['임원'] };
const stemsOf = (team) => STEMS[team] || [team.replace(/팀$/, '')];

// ── 장의 마디 ────────────────────────────────────────────────────────────────
// → { kind: 'team'|'event'|'other', sections: [{ id, no, title, blocks, subs:[{ no, title, block }], live?, label? }], toc: [{ id, no, title, sub }] }
//   live: 'members' · 'work' · 'prep' · 'related' — 화면이 지금 데이터로 그리는 마디(label은 머리 오른쪽 작은 글)
const GROUP_TITLE = { 'weekly:leaders': '회의 기록', clubs: '동아리', sermon: '설교', songs: '찬양' };
export const LIVE_LABEL = { members: '현재 명단 기준', work: '현재 업무 기준', prep: '현재 업무 기준' };
export function pageKind(page) {
  const id = String(page?.id || '');
  if (id.startsWith('team:')) return 'team';
  if (page?.grp === '행사' && id.startsWith('p:')) return 'event';
  return 'other';
}
export function outlineOf(page, { related = false } = {}) {
  const kind = pageKind(page);
  const blocks = page?.blocks || [];
  const secs = [];
  const add = (s) => { secs.push({ blocks: [], subs: [], ...s }); return secs[secs.length - 1]; };
  if (kind === 'team') {
    const lead = blocks.filter(b => b.key === 'about' || b.key === 'lead');
    if (lead.length) add({ title: '개요', blocks: lead });
    const work = blocks.filter(b => b.type === 'section');
    const gap = blocks.find(b => b.type === 'gap' && b.items?.length);
    if (work.length || gap) add({ title: '하는 일', subs: work.map(b => ({ title: b.title, block: b })), blocks: gap ? [gap] : [] });
    add({ title: '구성원', live: 'members' });
    add({ title: '지금 하는 일', live: 'work', subs: [{ title: '최근에 끝낸 일', live: 'done' }] });
    const chips = blocks.find(b => b.type === 'chips' && b.items?.length);
    if (chips) add({ title: chips.title || '다른 팀과 했던 일', blocks: [chips] });
  } else if (kind === 'event') {
    const lead = blocks.find(b => b.key === 'lead');
    if (lead) add({ title: '개요', blocks: [lead] });
    const decide = blocks.find(b => b.type === 'decisions' && b.steps?.length);
    if (decide) add({ title: decide.title || '정해지기까지', blocks: [decide] });
    const k = blocks.findIndex(b => b.type === 'head');
    const main = blocks.filter((b, i) => b.type === 'section' && (k < 0 || i < k));
    const prep = k < 0 ? [] : blocks.filter((b, i) => b.type === 'section' && i > k);
    if (main.length) add({ title: '기록', subs: main.map(b => ({ title: b.title, block: b })) });
    // 되풀이 모임(월례회)의 업무는 회차라 '준비'가 아니라 '업무'
    if (prep.length || pageCardIds(page).length) add({ title: lead?.meta?.recurring ? '업무' : (blocks[k]?.title || '준비'), live: 'prep', subs: prep.map(b => ({ title: b.title, block: b })) });
    const chips = blocks.find(b => b.type === 'chips' && b.items?.length);
    if (chips) add({ title: chips.title, blocks: [chips] });
  } else {
    let group = null;
    blocks.forEach((b, i) => {
      if (b.type === 'info') return;
      if (b.type === 'hero') { add({ title: '개요', blocks: [b] }); group = null; return; }
      if (b.type === 'head') { group = add({ title: b.title }); return; }
      if (b.type === 'section' || ((b.type === 'sermon' || b.type === 'songs') && !b.title)) {
        if (!group) group = add({ title: GROUP_TITLE[page.id] || '기록' });
        if (b.type === 'section') group.subs.push({ title: b.title, block: b }); else group.blocks.push(b);
        return;
      }
      group = null;
      if (b.title) { add({ title: b.title, blocks: [b] }); return; }
      if (!secs.length) { add({ title: i === 0 ? '개요' : '', blocks: [b] }); return; }
      secs[secs.length - 1].blocks.push(b);
    });
  }
  if (related) add({ title: '관련 문서', live: 'related' });
  // 번호 — 큰 마디 'N.' · 작은 마디 'N.M.'(나무위키처럼 끝에 점)
  const toc = [];
  secs.forEach((s, i) => {
    s.no = `${i + 1}.`; s.id = `s${i + 1}`;
    if (s.live) s.label = LIVE_LABEL[s.live] || '';
    toc.push({ id: s.id, no: s.no, title: s.title, sub: false });
    s.subs.forEach((x, j) => { x.no = `${i + 1}.${j + 1}.`; x.id = `s${i + 1}-${j + 1}`; toc.push({ id: x.id, no: x.no, title: x.title, sub: true }); });
  });
  return { kind, sections: secs, toc };
}

// ── 지금 데이터(가입자 · 업무) ───────────────────────────────────────────────
// 맡은 일에서 그 팀 몫 — '찬양팀 베이스' → '베이스' · '찬양팀장' → '팀장' · 다른 팀을 말한 조각은 뺀다 ·
// 팀 이름이 없는 일반 직함('순장' · '총무' · '회계' · '리더순장')은 팀 몫이 아니다(사용자 지적 2026-10-04 — '순장 · 찬양팀장'이 섰다) ·
// 팀 이름이 없는 맡은 일('일렉')은 그 사람이 한 팀일 때만 그 팀 몫으로 본다
const GENERAL_TITLE = /(장|총무|회계|전도사|목사|간사)$/;
// 임원진은 일반 직함이 곧 그 팀 몫이다(사용자 지적 2026-10-04 — 임원진 장에 임원 직함이 안 섰다):
// 회장('청년부 회장' → '회장') · 부회장 · 총무 · 회계 · 서기 · 부장 · 리더팀장 · 리더순장 · 예배팀장 처럼 '…장'인 직함.
// 순장(순을 이끄는 사람 — 임원이 아니다) · 다른 팀의 '<팀>장' · 직함 아닌 말('여러 팀을 섬기는 팀원')은 뺀다.
const OFFICER_TITLE = /^(?:총무|회계|서기|[가-힣]{0,4}장)$/;
export const OFFICER_ORDER = ['회장', '부회장', '총무', '회계', '서기', '부장', '예배팀장', '리더팀장', '리더순장'];
export function teamPart(role, team, memberTeams = []) {
  const out = [];
  for (const raw of String(role || '').split(/\s*[·,/]\s*/).map(x => x.trim()).filter(Boolean)) {
    const seg = team === '임원진' ? raw.replace(/^청년부\s+/, '') : raw;
    const said = TEAM_NAMES.filter(t => seg.includes(t) || stemsOf(t).some(x => seg.includes(x)));
    if (team === '임원진' && !said.length) {
      const t = seg.replace(/\([^)]*\)/g, '').trim();
      if (OFFICER_TITLE.test(t) && t !== '순장') out.push(t);
      continue;
    }
    if (said.includes(team)) {
      const part = seg.replace(new RegExp(`^${team}\\s+`), '').trim();
      out.push(part === `${team}장` ? '팀장' : part || seg);
    } else if (!said.length && !GENERAL_TITLE.test(seg.replace(/\([^)]*\)/g, '').trim()) && memberTeams.filter(t => !AUDIENCE.has(t)).length <= 1) out.push(seg);
  }
  return [...new Set(out)].join(' · ');
}
// → [{ id, name, role }] · 직함(…장) 먼저 · 맡은 일 있는 사람 · 기록 전 · 이름 순
export function teamMembers(team, members = []) {
  const rows = (members || []).filter(m => (m.teams || []).includes(team)).map(m => ({ id: m.id || m.name, name: m.name, role: teamPart(m.role, team, m.teams) }));
  const rank = (r) => (r.role.split(' · ').includes('팀장') ? 0 : r.role ? 1 : 2);
  // 임원진은 직함 차례(회장 → 부회장 → 총무 …)
  const office = (r) => { const k = Math.min(...r.role.split(' · ').map(x => OFFICER_ORDER.indexOf(x)).filter(i => i >= 0)); return Number.isFinite(k) ? k : 99; };
  return rows.sort((a, b) => (team === '임원진' ? office(a) - office(b) : 0) || rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'ko'));
}
const usable = (t, projById) => {
  const p = projById.get(t.projectId);
  return !PERSONAL_CARD.test(t.title || '') && !(p && EXCLUDED_PROJECT.test(p.title || p.name || ''));
};
const doneDay = (t) => kstDate(t.completedAt) || t.dueDate || t.startDate || kstDate(t.updatedAt) || '';
// 팀의 지금 하는 일 → { doing, late, done:[{ id, title, with, date, sub }] } · today: KST 'YYYY-MM-DD'
export function teamWork(team, tasks = [], projects = [], today = '', limit = 5) {
  const projById = new Map((projects || []).map(p => [p.id, p]));
  const mine = (tasks || []).filter(t => (t.teams || []).includes(team) && usable(t, projById));
  const open = (t) => t.status === '진행 중' || t.status === '시작 전';
  const late = mine.filter(t => t.status === '보류 중' || (open(t) && t.dueDate && t.dueDate < today));
  const doing = mine.filter(t => t.status === '진행 중' && !late.includes(t));
  const done = mine.filter(t => t.status === '완료').sort((a, b) => doneDay(b).localeCompare(doneDay(a))).slice(0, limit).map(t => {
    const subs = Array.isArray(t.subtasks) ? t.subtasks.filter(x => x?.title) : [];
    return { id: t.id, title: t.title, with: (t.teams || []).filter(x => x !== team && !AUDIENCE.has(x)), date: mdLabel(doneDay(t)), sub: subs.length ? `${subs.filter(x => x.done).length}/${subs.length}` : '' };
  });
  return { doing: doing.length, late: late.length, done };
}
// 장이 가리키는 업무 id(블록 순서) — 블록의 업무 · 기록 전 · 다른 팀과 했던 일
export function pageCardIds(page) {
  const ids = [];
  const push = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  for (const b of page?.blocks || []) {
    if (b.type === 'section' && b.meta?.cardId) push(b.meta.cardId);
    if (b.type === 'gap' || b.type === 'chips') for (const it of b.items || []) for (const c of it.cites || []) if (c.t === 'card') push(c.id);
  }
  return ids;
}
// 글이 근거로 단 업무까지(장 소개·정해지기까지가 다른 회의 기록을 단다) — 관련 문서를 찾을 때
export function citedCardIds(page) {
  const ids = new Set(pageCardIds(page));
  for (const b of page?.blocks || []) for (const it of [...(b.items || []), ...(b.steps || [])]) for (const c of it.cites || []) if (c.t === 'card') ids.add(c.id);
  return ids;
}
// 행사 장의 준비(현재 업무 기준) → [{ id, title, status, meta }] — 가입자 화면에 없는 업무는 장에 적힌 그대로(상태·날짜)
export function pageTasks(page, tasks = []) {
  const byId = new Map((tasks || []).map(t => [t.id, t]));
  const blockOf = new Map((page?.blocks || []).filter(b => b.type === 'section' && b.meta?.cardId).map(b => [b.meta.cardId, b]));
  const gapOf = new Map((page?.blocks || []).filter(b => b.type === 'gap').flatMap(b => (b.items || []).flatMap(it => (it.cites || []).map(c => [c.id, it.text]))));
  const rows = pageCardIds(page).filter(id => blockOf.has(id) || gapOf.has(id)).map(id => {
    const t = byId.get(id);
    if (t) {
      const subs = Array.isArray(t.subtasks) ? t.subtasks.filter(x => x?.title).length : 0;
      return { id, title: t.title, status: t.status || '', date: t.startDate || t.dueDate || '',
        meta: [(t.teams || []).filter(x => !AUDIENCE.has(x)).join(' · '), taskWhen(t.startDate, t.dueDate), `하위 업무 ${subs}개`].filter(Boolean).join(' · ') };
    }
    const b = blockOf.get(id);
    return { id, title: b?.title || gapOf.get(id) || '', status: b?.meta?.status || '', date: b?.meta?.date || '', meta: b?.meta?.when || '' };
  });
  return rows.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
}
// 정보 상자의 '준비 업무' 줄 — '1건 · 시작 전' · '6건 · 완료 4 · 시작 전 2'
export function prepInfo(rows = [], k = '준비 업무') {
  if (!rows.length) return null;
  const n = new Map();
  for (const r of rows) if (r.status) n.set(r.status, (n.get(r.status) || 0) + 1);
  const parts = [...n].sort((a, b) => b[1] - a[1]);
  const tail = parts.length === 1 ? parts[0][0] : parts.map(([s, c]) => `${s} ${c}`).join(' · ');
  return { k, v: [`${rows.length}건`, tail].filter(Boolean).join(' · ') };
}

// ── 정보 상자(팀) ────────────────────────────────────────────────────────────
// 팀 장 개요 줄(소개 카드 + 마스터가 더한 줄) · 더다붓 소개의 한 달 줄 · 자주 쓰는 말 · 가입자에서 **글로 적힌 것만** 뽑는다.
// → { name: '찬양팀 이름'|'', rows: [{ k, v }] }
const textOf = (b) => (b?.items || []).map(it => stripBold(it.text)).join(' ');
const names = (s) => String(s).split(/\s*(?:,|과|와|및|·)\s+|\s*(?:,|·)\s*/).map(x => x.replace(/\s*(?:청년|형제|자매)$/, '').trim()).filter(Boolean);
export function teamInfo(page, pages = [], members = []) {
  const team = String(page?.id || '').replace(/^team:/, '');
  const about = (page?.blocks || []).filter(b => b.key === 'about' || b.key === 'lead').map(textOf).join(' ');
  const rows = [];
  const mm = teamMembers(team, members);
  const heads = mm.filter(m => m.role.split(' · ').some(r => r === '팀장' || r === `${team}장` || r.endsWith(`${team}장`))).map(m => m.name);
  if (team === '교역자') { const p = mm.map(m => m.name); if (p.length) rows.push({ k: '교역자', v: p.join(' · ') }); }
  else if (team === '임원진') {
    // 임원 직함마다 한 줄(가입자의 맡은 일에 적힌 것만)
    for (const t of OFFICER_ORDER) { const who = mm.filter(m => m.role.split(' · ').includes(t)).map(m => m.name); if (who.length) rows.push({ k: t, v: who.join(' · ') }); }
  } else if (heads.length) rows.push({ k: '팀장', v: heads.join(' · ') });
  const name = (/이름은\s+(.+?)(?:이에요|예요)/.exec(about) || [])[1] || '';
  // 인도 — 마스터가 적은 줄('찬양 인도자는 A 청년과 B 청년이에요')의 이름 + 맡은 일에 '인도자'가 적힌 가입자(사용자 결정 2026-10-04 · 지어내지 않는다)
  const leads = mm.filter(m => m.role.split(' · ').includes('인도자')).map(m => m.name);
  let leadRow = false;
  for (const m of about.matchAll(/(\S+)\s인도자는\s+(.+?)(?:이에요|예요)/g)) {
    rows.push({ k: `${m[1]} 인도`, v: [...new Set([...names(m[2]), ...leads])].join(' · ') });
    leadRow = true;
  }
  if (!leadRow && leads.length) rows.push({ k: `${team.replace(/팀$/, '')} 인도`, v: leads.join(' · ') });
  const intro = (pages || []).find(p => p.id === 'intro');
  const month = textOf((intro?.blocks || []).find(b => b.key === 'month'));
  const practice = new RegExp(`${team}\\s?연습은\\s+(.+?)(?:이에요|예요)`).exec(month);
  if (practice) rows.push({ k: '연습', v: practice[1] });
  const terms = (((pages || []).find(p => p.id === 'terms')?.blocks || [])[0]?.items || []).map(it => stripBold(it.text));
  for (const w of ['콘티', '송폼']) {
    if (!about.includes(w)) continue;
    const def = terms.find(x => x.startsWith(`${w} ·`));
    const when = def && /([^.]+?)(?:에|까지)\s나와요/.exec(def.slice(w.length + 2));
    if (when) rows.push({ k: w, v: when[1].trim() });
  }
  if (mm.length) rows.push({ k: '가입자', v: `${mm.length}명` });
  return { name, rows };
}

// ── 관련 문서 ────────────────────────────────────────────────────────────────
// 같은 업무를 가리키는 다른 장(많이 겹친 순) + 글에 자주 쓰는 말이 나오면 그 장. 자주 묻는 질문 · 더다붓 소개는 뺀다.
export function relatedPages(page, pages = [], limit = 8) {
  const mine = citedCardIds(page);
  const out = [];
  if (mine.size) {
    for (const p of pages || []) {
      if (!p || p.id === page.id || p.id === 'faq' || p.id === 'intro' || p.id === 'terms') continue;
      const n = pageCardIds(p).filter(id => mine.has(id)).length;
      if (n) out.push({ id: p.id, title: p.title, n });
    }
  }
  out.sort((a, b) => b.n - a.n || String(a.title).localeCompare(String(b.title), 'ko'));
  const list = out.slice(0, limit).map(({ id, title }) => ({ id, title }));
  const terms = (pages || []).find(p => p.id === 'terms');
  if (terms && page.id !== 'terms') {
    const words = termWords(terms);
    const text = (page.blocks || []).flatMap(b => (b.items || []).map(it => it.text)).join(' ');
    if (words.some(w => text.includes(w))) list.push({ id: 'terms', title: terms.title });
  }
  return list;
}

// ── 글 안의 링크 ─────────────────────────────────────────────────────────────
// 자주 쓰는 말의 낱말(두 글자 넘는 것) · 장 제목 → 그 장. 낱말 뒤가 조사·끝·문장부호일 때만('찬양팀장'의 '찬양팀'은 아니다).
export const termWords = (terms) => (((terms?.blocks || [])[0]?.items) || [])
  .map(it => /^([^·]{2,12}?)\s·/.exec(stripBold(it.text))?.[1]?.trim()).filter(w => w && w.length >= 2);
export function linkTargets(pages = [], selfId = '') {
  const map = new Map();
  const terms = (pages || []).find(p => p.id === 'terms');
  // 제 장 이름은 잇지 않는다(월례회 장의 '월례회' → 자주 쓰는 말)
  const self = (pages || []).find(p => p.id === selfId)?.title;
  for (const w of termWords(terms)) if (selfId !== 'terms' && w !== self) map.set(w, 'terms');
  for (const p of pages || []) {
    if (!p?.title || p.id === selfId || p.id === 'faq' || p.kind === 'human' || String(p.title).length < 2) continue;
    map.set(p.title, p.id);   // 장 제목이 자주 쓰는 말보다 앞(월례회 → 월례회 장)
  }
  return [...map].map(([word, id]) => ({ word, id })).sort((a, b) => b.word.length - a.word.length);
}
const AFTER = /^(?:$|[^가-힣A-Za-z0-9]|(?:은|는|이|가|을|를|의|에|에서|에게|과|와|도|로|으로|이에요|예요|이고|이나|나|까지|부터|처럼|만|마다|보다|랑|이랑|하고)(?![가-힣]))/;
// text → [{ t, id? }] · used: 이 마디에서 이미 이은 낱말(처음 한 번만) — 부르는 쪽이 마디마다 새로 만든다
export function linkParts(text, targets = [], used = new Set()) {
  const s = String(text ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    let best = null;
    for (const tg of targets) {
      if (used.has(tg.word)) continue;
      let from = i;
      for (;;) {
        const k = s.indexOf(tg.word, from);
        if (k < 0) break;
        const before = k === 0 ? '' : s[k - 1];
        if (!/[가-힣A-Za-z0-9]/.test(before) && AFTER.test(s.slice(k + tg.word.length))) { if (!best || k < best.k) best = { k, tg }; break; }
        from = k + 1;
      }
    }
    if (!best) { out.push({ t: s.slice(i) }); break; }
    if (best.k > i) out.push({ t: s.slice(i, best.k) });
    out.push({ t: best.tg.word, id: best.tg.id });
    used.add(best.tg.word);
    i = best.k + best.tg.word.length;
  }
  return out.filter(p => p.t);
}

// ── QT 달력 ──────────────────────────────────────────────────────────────────
// '사사기 15:1-20' → { book: '사사기', ref: '15:1-20' } · 책마다 점 색(앞에서부터 차례로)
export function splitRef(full) {
  const s = String(full || '').trim();
  const k = s.lastIndexOf(' ');
  return k > 0 && /\d/.test(s.slice(k + 1)) ? { book: s.slice(0, k), ref: s.slice(k + 1) } : { book: '', ref: s };
}
export const BOOK_TOKENS = ['orange', 'green', 'purple', 'blue', 'pink', 'red', 'yellow', 'brown'];
export function bookColors(books) {
  const m = new Map();
  for (const b of books) if (b && !m.has(b)) m.set(b, BOOK_TOKENS[m.size % BOOK_TOKENS.length]);
  return m;
}
