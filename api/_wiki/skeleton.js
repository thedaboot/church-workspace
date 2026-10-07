import { SEED_PAGES, josa, mdLabel, kstDate, overlayEdits, stripBold, teamCardText } from '../../src/services/wikiCore.js';
import { sundayNote } from '../../src/services/aiText.js';
import { AUDIENCE, TEAM_ORDER, audienceNote, MEETING_TITLE } from './const.js';
import { strip, snippetsOf } from './text.js';
import {
  cardCite, svcCite, pageCite, cardDate, byDate, projectTitle, recordDate, finishedTask,
  sectionOf, foldGap, supersededSnips, eventInfo, recurringLead, decideSnips,
} from './excerpt.js';

// ── 장 뼈대 — 장마다 블록을 세운다(사실은 코드가 · 모델 재료는 snips로) ─────────────────────
// 위키에 싣지 않는 프로젝트(앱 개발 · 돈 — api/_wikiBuild.js 머리말)
const EXCLUDED_PROJECT = /워크스페이스 개선|^회계$|회계 인수인계/;
const LEADERS_PROJECT = /임원진 회의/;
// 리더십 회의 장에는 회의 기록만(사용자 결정 2026-10-04) — 같은 프로젝트의 헌금봉헌·대표기도자·팟캐스트 같은 업무는 맞는 장으로 가거나 빠진다
const LEADERS_TITLE = /리더\s?[쉽십]\s?회의/;
// 준비 업무 — 행사 전에 한 일(포스터·홍보·모집…). 행사 장에서는 행사 기록 아래 '준비'로 묶는다(사용자 결정 2026-10-04 · PITFALLS 33-k)
const PREP_TITLE = /포스터|홍보|모집|제작|준비|공지|섭외|대관|기획|콘티|송폼|리허설|연습/;
// 행사 그 자체의 기록 — 행사 장에서 맨 앞에
const RECORD_TITLE = /결산|결과|개요|보고/;
// 한 사람 한 사람의 기록인 업무(명단·미수료자·출석)는 어느 장에도 싣지 않는다 — 출석·노트와 같은 이유(사용자 결정 2026-10-02)
const PERSONAL_CARD = /미수료|명단|출석|연락처/;
const TEAM_PROJECT = /^\d{4}\s+(웰컴팀|미디어팀|엔지니어팀|예배팀|찬양팀|워십팀)$/;

// 업무 묶음 → 블록들: 이음 문장(lead) · 업무마다 section · 글이 비어 있는 업무는 '기록 전'
// event: 행사 장 — 행사 기록(결산·개요…)을 맨 앞에, 준비 업무는 '준비' 아래로 · mentions: 다른 회의 기록에서 이 행사를 말한 조각(lead 재료)
function cardBlocks(D, cards, { leadMax = 2, perCard = 4, multiAsChips = false, team = null, event = false, mentions = [], recurring = false } = {}) {
  const blocks = [];
  const solo = multiAsChips ? cards.filter(c => c.teams.length <= 1) : cards;
  const multi = multiAsChips ? cards.filter(c => c.teams.length > 1) : [];
  const empty = [];
  let main = []; let prep = [];
  const seen = new Set();
  for (const c of [...solo].sort(byDate)) {
    const isPrep = event && PREP_TITLE.test(c.title) && !RECORD_TITLE.test(c.title);
    const sec = sectionOf(D, c, perCard, isPrep ? { prep: true } : {}, seen);
    if (!sec) { empty.push(c); continue; }
    (isPrep ? prep : main).push(sec);
  }
  // 준비와 기록이 둘 다 있을 때만 가른다(전부 준비면 그대로)
  if (event && (!main.length || !prep.length)) { main = [...main, ...prep].sort((a, b) => byDate({ start_date: a.block.meta.date }, { start_date: b.block.meta.date })); prep = []; for (const s of main) delete s.block.meta.prep; }
  if (event) main.sort((a, b) => Number(RECORD_TITLE.test(b.block.title)) - Number(RECORD_TITLE.test(a.block.title)));
  // 행사 장: 바뀌기 전 조각은 장 소개·블록 재료에서 걷고(지금 사실로 쓰이지 않게) '정해지기까지'에만 바뀌기 전으로 싣는다
  const pool = [...mentions, ...[...main, ...prep].flatMap(s => s.snips)];
  let old = new Map();
  if (event && !recurring) {
    old = supersededSnips(pool);
    if (old.size) {
      for (const s of [...main, ...prep]) {
        s.snips = s.snips.filter(x => !old.has(x));
        if (s.block.snips) { if (s.snips.length) s.block.snips = s.snips; else { delete s.block.snips; delete s.block.max; } }
      }
      mentions = mentions.filter(x => !old.has(x));
    }
    // 정보 상자는 행사 기록 · 다른 회의 기록에서만(준비 업무의 '대상'은 키링을 받을 사람이었다 · 하계 수련회)
    const info = eventInfo([...mentions, ...main.flatMap(s => s.snips)].filter(x => !old.has(x)), cards);
    if (info.length) blocks.push({ key: 'info', type: 'info', rows: info, items: [] });
  }
  const all = [...main, ...prep].flatMap(s => s.snips);
  // 장 소개 재료는 늦은 기록 24개(앞 블록 것만 실으면 바뀌기 전 주제가 소개에 섰다 · 예배 2.0 '전도' 2026-10-04)
  // 행사 장이면 행사 그 자체의 기록(결산·개요)을 먼저 — 늦은 기록만 실었더니 찬조 명단이 하계 수련회 소개가 됐다(2026-10-04)
  const records = event ? [...main, ...prep].filter(s => RECORD_TITLE.test(s.block.title)).flatMap(s => s.snips) : [];
  const rest = [...all].filter(x => !records.includes(x)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const leadSnips = [...records.slice(0, 24), ...rest.slice(-Math.max(0, 24 - records.length)), ...mentions];
  if (leadMax && leadSnips.length) blocks.push({ key: 'lead', type: 'plain', items: [], snips: leadSnips, max: mentions.length ? Math.max(leadMax, 3) : leadMax });
  if (event && !recurring) {
    // 행사 기록 · 다른 회의 기록에서만(준비 업무의 '대상'이 하계 수련회의 지금 정해진 내용으로 섰다) — 바뀌기 전 표시는 준비 업무까지 본 것 그대로
    const ds = decideSnips([...pool.filter(x => mentions.includes(x) || old.has(x)), ...main.flatMap(s => s.snips)], old);
    if (ds.length >= 2 && new Set(ds.map(s => s.date)).size >= 2) {
      blocks.push({ key: 'decide', type: 'decisions', title: '정해지기까지', items: [], snips: ds.map(s => (old.has(s) ? { ...s, old: old.get(s) } : s)), max: ds.length });
    }
  }
  blocks.push(...main.map(s => s.block));
  if (prep.length) blocks.push({ key: 'prep', type: 'head', title: '준비', items: [] }, ...prep.map(s => s.block));
  // 다른 팀과 했던 일 — 끝난 것만(완료 · 날짜가 지남). 앞으로 할 월례회는 싣지 않는다(사용자 결정 2026-10-04)
  const together = multi.filter(c => finishedTask(c, D.today));
  if (together.length) blocks.push({ key: 'together', type: 'chips', title: '다른 팀과 했던 일', items: together.sort(byDate).map(c => ({
    key: `t:${c.id}`, text: c.title, by: 'code', cites: [cardCite(c)],
    meta: { date: cardDate(c), teams: c.teams.filter(t => t !== team), ...(c.audience?.length ? { note: audienceNote(c.audience) } : {}) },
  })) });
  if (empty.length) blocks.push({ key: 'gap', type: 'gap', title: '기록 전', items: foldGap(empty.map(c => ({ key: `g:${c.id}`, text: c.title, by: 'code', cites: [cardCite(c)] }))) });
  return blocks;
}

// 행사를 부르는 낱말 — 제목 끝에서부터 세 글자 넘는 첫 낱말(흔한 말은 건너뛴다). '가을 체육대회' → '체육대회'
const GENERIC_WORDS = /^(?:더다붓|리더십|리더쉽|청년부|예배|회의|만들기|지원|기획|양육|모임|관리|수련회|진행|\d+기|\d{4})$/;
function eventWord(title) {
  const w = String(title || '').split(/\s+/).filter(Boolean);
  for (let i = w.length - 1; i >= 0; i--) if (w[i].length >= 3 && !GENERIC_WORDS.test(w[i]) && !MEETING_TITLE.test(w[i])) return w[i];
  return '';
}
// 다른 프로젝트의 회의 기록(리더십 회의 · 월례회 · 미팅)에서 소제목에 행사 낱말이 든 조각 — 행사 장의 lead가 '지금 사실'을 늦은 기록으로 쓴다.
// 같은 글이 여러 회의에 되풀이되면 가장 늦은 것 하나만 · 날짜 순 · 늦은 것 12개.
function eventMentions(D, word, pool) {
  if (!word) return [];
  const byText = new Map();
  for (const c of pool) {
    if (!MEETING_TITLE.test(c.title)) continue;
    for (const s of snippetsOf(c.description)) {
      if (!s.head.includes(word)) continue;
      const x = { ...s, date: recordDate(c), cite: cardCite(c) };
      const prev = byText.get(s.text);
      if (!prev || prev.date < x.date) byText.set(s.text, x);
    }
  }
  return [...byText.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
}

// 리더십 회의 프로젝트에서 회의가 아닌 업무가 갈 장 — 프로젝트 제목과 세 글자 넘게 겹치는 장('팟캐스트' → '다붓캐스트'). 없으면 빠진다.
function overlap3(a, b) {
  const x = String(a).replace(/\s+/g, ''); const y = String(b).replace(/\s+/g, '');
  for (let i = 0; i + 3 <= x.length; i++) if (/^[가-힣A-Za-z]{3}$/.test(x.slice(i, i + 3)) && y.includes(x.slice(i, i + 3))) return true;
  return false;
}

export function skeletons(D) {
  const year = D.today.slice(0, 4);
  const pages = [];
  const usable = D.projects.filter(p => !EXCLUDED_PROJECT.test(p.name));
  const usableIds = new Set(usable.map(p => p.id));
  const cards = D.cards.filter(c => !PERSONAL_CARD.test(c.title)).map(c => ({ ...c, teams: (c.teams || []).filter(t => !AUDIENCE.has(t)), audience: c.audience || (c.teams || []).filter(t => AUDIENCE.has(t)) }));
  const cardsOf = (pid) => cards.filter(c => c.project_id === pid);
  const liveCards = cards.filter(c => usableIds.has(c.project_id));

  // 행사 — 프로젝트 하나에 한 장(팀 이름 프로젝트·리더십 회의는 다른 묶음으로)
  const eventProjects = usable.filter(p => !TEAM_PROJECT.test(p.name) && !LEADERS_PROJECT.test(p.name));
  const leaders = usable.find(p => LEADERS_PROJECT.test(p.name));
  const homeOf = (c) => eventProjects.find(p => overlap3(c.title.split(/\s+/)[0], projectTitle(p.name, year)));
  const moved = Map.groupBy(leaders ? cardsOf(leaders.id).filter(c => !LEADERS_TITLE.test(c.title) && homeOf(c)) : [], c => homeOf(c).id);
  const eventCards = (p) => [...cardsOf(p.id), ...(moved.get(p.id) || [])];
  const events = eventProjects.filter(p => eventCards(p).length);
  const lastDate = (p) => eventCards(p).map(cardDate).filter(Boolean).sort().pop() || '';
  events.sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
  // 함께 쓰는 글의 지금 글(사람이 고친 글 겹침) — 자주 쓰는 말 · 더다붓 소개의 한 달 줄
  const termsNow = overlayEdits(SEED_PAGES[1].blocks, D.edits.filter(e => e.page_id === 'terms'));
  const introNowAll = overlayEdits(SEED_PAGES[0].blocks, D.edits.filter(e => e.page_id === 'intro'));
  const lineSrc = { terms: (termsNow[0] || {}).items || [], month: (introNowAll.find(b => b.key === 'month') || {}).items || [], today: D.today };
  events.forEach((p, i) => {
    const cs = eventCards(p);
    const title = projectTitle(p.name, year);
    const word = eventWord(title);
    const mentions = eventMentions(D, word, liveCards.filter(c => c.project_id !== p.id));
    // 되풀이 모임(월례회)은 개요를 뜻 + 다음 날짜로(모델 소개 대신 · 사용자 지적 2026-10-04) — 회차마다 다른 이야기라
    // 이름표 줄(날짜·장소)로 정보 상자를 세우거나 정해지기까지를 묶지 않는다(9월 월례회의 체육대회 날짜가 월례회 날짜로 섰다)
    const rec = recurringLead(title, cs, lineSrc);
    const blocks = cardBlocks(D, cs, { event: true, mentions: rec ? [] : mentions, recurring: !!rec });
    if (rec) {
      const k = blocks.findIndex(b => b.key === 'lead');
      const lead = { key: 'lead', type: 'plain', items: rec, meta: { recurring: true } };
      if (k >= 0) blocks.splice(k, 1, lead); else blocks.unshift(lead);
      const next = rec.find(it => it.key === 'next');
      const rows = [...(next ? [{ k: '다음 모임', v: mdLabel(next.meta.date, true) }] : []), ...eventInfo([], cs)];
      if (rows.length) blocks.unshift({ key: 'info', type: 'info', rows, items: [] });
    }
    pages.push({ id: `p:${p.id}`, grp: '행사', title, kind: 'auto', position: i, source: '업무', source_count: cs.length, blocks });
  });

  // 팀 — 그 팀만 걸린 업무는 '맡은 일', 여러 팀이 걸린 업무는 '다른 팀과 했던 일'(이름만 · 한 팀의 일로 쓰지 않는다)
  // 맨 위 소개 줄은 더다붓 소개 › 팀 카드의 지금 글(사람이 고친 글 · 화면도 wikiCore.withTeamCards로 같은 글을 겹친다)
  const introTeams = new Map(((SEED_PAGES[0].blocks.find(b => b.key === 'teams') || {}).items || []).map(it => [it.meta.team, it]));
  const introEdits = D.edits.filter(e => e.page_id === 'intro');
  const introNow = overlayEdits(SEED_PAGES[0].blocks, introEdits);
  const teamLine = (team) => teamCardText(((introNow.find(b => b.key === 'teams') || {}).items || []).find(it => it.meta?.team === team)?.text || introTeams.get(team)?.text);
  TEAM_ORDER.forEach((team, i) => {
    const cs = liveCards.filter(c => c.teams.includes(team));
    if (!cs.length) return;
    const line = teamLine(team);
    const blocks = [];
    if (line) blocks.push({ key: 'about', type: 'plain', items: [{ key: 'about1', text: line, by: 'code', cites: [pageCite('intro', '더다붓 소개')] }] });
    blocks.push(...cardBlocks(D, cs, { leadMax: 0, perCard: 2, multiAsChips: true, team }));
    pages.push({ id: `team:${team}`, grp: '팀', title: team, kind: 'auto', position: i, source: '업무', source_count: cs.length, meta: { team }, blocks });
  });

  // 매주 하는 일 — 리더십 회의(회의 기록만) · 주보 만들기
  const meetings = leaders ? cardsOf(leaders.id).filter(c => LEADERS_TITLE.test(c.title)) : [];
  if (meetings.length) {
    pages.push({ id: 'weekly:leaders', grp: '매주 하는 일', title: '리더십 회의', kind: 'auto', position: 0, source: '업무', source_count: meetings.length,
      blocks: cardBlocks(D, meetings, { leadMax: 1, perCard: 2 }) });
  }
  const svcs = D.services;
  if (svcs.length) {
    const fileOf = (s, kind) => D.files.filter(f => f.service_id === s.id && f.kind === kind).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    const word = (w) => ((termsNow[0] || {}).items || []).find(it => stripBold(it.text).startsWith(`${w} ·`));
    const lead = ['콘티', '송폼', '큐시트'].map(word).filter(Boolean).map((it, i) => ({ key: `rule${i + 1}`, text: it.text, by: 'code', cites: [pageCite('terms', '자주 쓰는 말')] }));
    pages.push({ id: 'weekly:bulletin', grp: '매주 하는 일', title: '주보 만들기', kind: 'auto', position: 1, source: '주보', source_count: svcs.length,
      blocks: [
        ...(lead.length ? [{ key: 'rules', type: 'list', items: lead }] : []),
        { key: 'rows', type: 'rows', title: '발행된 주보', head: ['주일', '설교', '송폼', '큐시트'], rows: [...svcs].reverse().map(s => {
          const sf = fileOf(s, 'songform'); const cu = fileOf(s, 'cuesheet');
          return { cells: [mdLabel(s.service_date, true), s.title || '미입력', sf ? `${mdLabel(kstDate(sf.created_at), true)} 올림` : '미등록', cu ? `${mdLabel(kstDate(cu.created_at), true)} 올림` : '미등록'], cite: svcCite(s) };
        }) },
      ] });
  }

  // 예배 — 올해 설교 본문(설교 카드: 날짜 → 제목 → 본문 → 한두 문장 → 고정된 가이드 세 마디) · 예배 찬양
  const thisYear = svcs.filter(s => s.service_date.startsWith(year));
  if (thisYear.length) {
    const guideOf = new Map(D.guides.map(g => [g.service_id, g.body || {}]));
    pages.push({ id: 'sermon', grp: '예배', title: `${year} 설교 본문`, kind: 'auto', position: 0, source: '주보', source_count: thisYear.length,
      blocks: [...thisYear].reverse().map(s => {
        const g = guideOf.get(s.id);
        const points = (g?.points || []).map(p => strip(p.title)).filter(Boolean);
        const snips = [];
        if (g) {
          if (g.summary) snips.push({ head: '가이드 요약', text: strip(g.summary).slice(0, 400), cite: svcCite(s, `${mdLabel(s.service_date)} 가이드`) });
          for (const p of g.points || []) if (p?.body) snips.push({ head: `가이드 '${strip(p.title)}'`, text: strip(p.body).slice(0, 400), cite: svcCite(s, `${mdLabel(s.service_date)} 가이드`) });
        }
        const note = sundayNote(s.service_date).replace(/^(둘째|마지막) 주 /, '');
        return { key: `s:${s.id}`, type: 'sermon', meta: { date: s.service_date, label: note, title: s.title || '', passage: s.passage_ref || '', points, guide: !!g, serviceId: s.id },
          cites: [svcCite(s, g ? '주보 · 가이드' : '주보')], items: [], snips, max: 2 };
      }) });
    pages.push({ id: 'songs', grp: '예배', title: '예배 찬양', kind: 'auto', position: 1, source: '주보', source_count: thisYear.length,
      // 주일마다 한 블록 — 곡은 번호 목록('부른 사람 - 곡'을 갈라 곡을 앞에 · 가독성 · 사용자 요청 2026-10-03)
      blocks: [...thisYear].reverse().map(s => ({
        key: `s:${s.id}`, type: 'songs', meta: { date: s.service_date, label: sundayNote(s.service_date).replace(/^(둘째|마지막) 주 /, ''), sermon: s.title || '' },
        cites: [svcCite(s)], items: [],
        songs: (Array.isArray(s.songs) ? s.songs : []).map(x => strip(x?.title)).filter(Boolean).map(t => {
          const m = t.match(/^(.+?)\s+-\s+(.+)$/);
          return m ? { title: m[2].trim(), by: m[1].trim() } : { title: t, by: '' };
        }),
      })) });
  }

  // 말씀 — QT 본문 일정(이번 달 · 다음 달)
  if (D.qt.length) {
    const months = [...new Set(D.qt.map(r => r.qt_date.slice(0, 7)))];
    pages.push({ id: 'qt', grp: '말씀', title: 'QT 본문 일정', kind: 'auto', position: 0, source: '말씀', source_count: D.qt.filter(r => r.qt_date.startsWith(D.today.slice(0, 7))).length,
      // 달마다 한 블록, 날짜마다 한 칸 — 화면이 주(주일 시작)로 묶고 오늘은 강조 · 지난 날은 옅게(가독성 · 2026-10-03)
      blocks: months.map(mo => ({ key: `m:${mo}`, type: 'qt', title: `${Number(mo.slice(5))}월`,
        days: D.qt.filter(r => r.qt_date.startsWith(mo)).map(r => ({ date: r.qt_date, ref: r.passage_ref, label: r.label || '' })) })) });
  }

  // 모임 — 동아리 · 순 편성
  const clubs = D.groups.filter(g => g.type === 'club').sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  if (clubs.length) {
    pages.push({ id: 'clubs', grp: '모임', title: '동아리', kind: 'auto', position: 0, source: '모임', source_count: clubs.length,
      blocks: clubs.map(g => {
        const ms = D.meetings.filter(m => m.group_id === g.id);
        const items = [];
        if (g.note) items.push({ key: `n:${g.id}`, text: `${josa(strip(g.note), '이에요', '예요')}.`, by: 'code' });
        const past = ms.filter(m => m.meeting_date < D.today); const next = ms.find(m => m.meeting_date >= D.today);
        if (next) items.push({ key: `next:${g.id}`, text: `다음 모임은 ${mdLabel(next.meeting_date, true)}${next.title ? ` '${strip(next.title)}'` : ''}이에요.`, by: 'code' });
        if (past.length) items.push({ key: `past:${g.id}`, text: `지금까지 모임 기록은 ${past.length}번이에요. 마지막 모임은 ${mdLabel(past[past.length - 1].meeting_date, true)}이에요.`, by: 'code' });
        if (!ms.length) items.push({ key: `none:${g.id}`, text: '모임 기록은 기록 전이에요.', by: 'code' });
        return { key: `g:${g.id}`, type: 'section', title: strip(g.name), meta: { groupId: g.id }, items };
      }) });
  }
  const suns = D.groups.filter(g => g.type === 'sun');
  if (suns.length) {
    const years = [...new Set(suns.map(g => g.year))].sort((a, b) => b - a);
    pages.push({ id: 'suns', grp: '모임', title: '순 편성', kind: 'auto', position: 1, source: '모임', source_count: suns.filter(g => String(g.year) === year).length,
      blocks: years.map(yy => {
        const list = suns.filter(g => g.year === yy).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
        return { key: `y:${yy}`, type: 'list', title: `${yy}년`, items: [{ key: `y${yy}`, text: `${yy}년 순은 ${list.length}개예요. ${list.map(g => g.name).join(' · ')}`, by: 'code' }] };
      }) });
  }
  return pages;
}
