import { taskWhen, hashKey, mdLabel, kstDate, josa, stripBold } from '../../src/services/wikiCore.js';
import { STATUS } from '../_lib.js';
import { AUDIENCE, TEAM_ORDER, audienceNote, MEETING_TITLE } from './const.js';
import { strip, snippetsOf } from './text.js';
import { commentLine, peopleIndex } from './people.js';

// 댓글 줄의 재료 — 업무 하나 만들 때마다 다시 세우지 않게 D에 한 번
function commentCtx(D) {
  if (!D._cctx) {
    const people = D.people || peopleIndex(D.roster || []);
    D._cctx = { people, names: new Map((D.profiles || []).map(p => [p.id, String(p.display_name || '').trim()])), byId: new Map((D.comments || []).map(c => [c.id, c])), mentionNames: D.names || [] };
  }
  return D._cctx;
}

// ── 장 뼈대의 재료(발췌 · 블록 하나 · 바뀌기 전 · 정보 상자 · 정해지기까지) ─────────────────
// 블록의 snips(모델 재료)와 max(문장 수 상한)는 저장하지 않는다 — fillPage가 쓰고 걷는다.
export const cardCite = (c) => ({ t: 'card', id: c.id, label: c.title });
export const svcCite = (s, label) => ({ t: 'service', id: s.id, label: label || `${mdLabel(s.service_date)} 주보` });
export const pageCite = (id, label) => ({ t: 'page', id, label });
export const cardDate = (c) => c.start_date || c.due_date || '';
export const byDate = (a, b) => String(cardDate(a) || '9999').localeCompare(String(cardDate(b) || '9999'));
export const projectTitle = (name, year) => String(name || '').replace(new RegExp(`^${year || '\\d{4}'}\\s+`), '').replace(/^더다붓\s+/, '').trim() || name;
// 기록의 날 — 회의 기록은 회의 날, 그 밖의 업무는 마지막으로 고친 날(같은 것을 두고 다르면 늦은 기록이 이긴다 · 사용자 결정 2026-10-04)
export const recordDate = (c) => ((MEETING_TITLE.test(c.title) && cardDate(c)) || kstDate(c.updated_at) || cardDate(c) || '');
// 끝난 일 — 완료이거나 날짜(마감 · 없으면 시작)가 오늘(KST)보다 앞(다른 팀과 했던 일 · 사용자 결정 2026-10-04)
export const finishedTask = (c, today) => c.status === 'done' || (!!(c.due_date || c.start_date) && (c.due_date || c.start_date) < today);

function cardSnips(D, c, { comments = true } = {}) {
  const s = snippetsOf(c.description).map(x => ({ ...x, date: recordDate(c) }));
  const subs = (Array.isArray(c.subtasks) ? c.subtasks : []).filter(x => x?.title);
  if (subs.length) s.push({ head: '하위 업무', text: `${subs.map(x => strip(x.title)).join(', ')} (${subs.length}개, 끝낸 것 ${subs.filter(x => x.done).length}개)`, date: recordDate(c) });
  // 댓글 — 쓴 사람 · 답글이면 누구의 댓글에 · 부른 사람(@)을 밝힌 줄로(commentLine · 사용자 지적 2026-10-04)
  if (comments) for (const m of D.comments.filter(m => m.card_id === c.id)) {
    const x = commentLine(m, commentCtx(D));
    if (x.body.length >= 6) s.push({ head: `${x.kind} ${mdLabel(x.date)}`, text: x.text.slice(0, 260), date: x.date });
  }
  return s.map(x => ({ ...x, cite: cardCite(c) }));
}

// 질문 목록인 업무(별빛데이트 · 팟캐스트 질문) — 문장으로 옮기지 않고 질문을 그대로 목록으로(사용자 결정 2026-10-04).
// 물음표로 끝나는 줄이 넷 이상이고 본문 줄의 절반 이상이면. 화면에는 앞 QUESTIONS_MAX개, 블록 머리에 '나눈 질문 N개'.
const QUESTIONS_MAX = 12;
function questionsOf(c) {
  const lines = String(c.description || '').replace(/\r/g, '').split('\n').map(l => strip(l.trim().replace(/^([-*]|\d+\.)\s+/, ''))).filter(l => l.length >= 2 && !/^#|^-{3,}$/.test(l));
  const qs = lines.filter(l => /[?？]$/.test(l));
  return qs.length >= 4 && qs.length * 2 >= lines.length ? [...new Set(qs)] : null;
}

// 기록 전 접기 — 같은 꼴(괄호 속 말 · 끝 낱말)인 업무가 셋 이상이면 한 줄로: '준원조(필름카메라)' ×8 → '조별 필름카메라 8건'(사용자 결정 2026-10-04)
export function foldGap(items) {
  const shape = (t) => {
    const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(t);
    if (m) return { key: `(${m[2].trim()})`, word: m[2].trim(), head: m[1].trim() };
    const w = t.trim().split(/\s+/);
    // 끝 낱말 꼴은 앞말이 숫자로 시작하면 접지 않는다('10월 월례회 · 11월 월례회'는 달이 내용이다)
    return w.length >= 2 && !/^\d/.test(w[0]) ? { key: w[w.length - 1], word: w[w.length - 1], head: w.slice(0, -1).join(' ') } : null;
  };
  const groups = Map.groupBy(items.map(it => ({ it, s: shape(it.text) })).filter(x => x.s), x => x.s.key);
  const out = []; const done = new Set();
  for (const it of items) {
    if (done.has(it.key)) continue;
    const s = shape(it.text);
    const g = s && groups.get(s.key);
    if (!g || g.length < 3) { out.push(it); continue; }
    // 앞말이 모두 같은 글자로 끝나면('준원조'·'진혁조') 그 글자별로: '조별 필름카메라'
    const last = g[0].s.head.slice(-1);
    const per = /[가-힣]/.test(last) && g.every(x => x.s.head.slice(-1) === last && x.s.head.length >= 2) ? `${last}별 ` : '';
    out.push({ key: `g:fold:${hashKey(s.key)}`, text: `${per}${s.word} ${g.length}건`, by: 'code', cites: g.map(x => x.it.cites[0]).filter(Boolean) });
    for (const x of g) done.add(x.it.key);
  }
  return out;
}

// 블록 제목은 업무 이름만 — 날짜는 '업무 날짜'로 밝혀 옆에 따로 선다(meta.when · 행사 날짜로 읽히지 않게 · 2026-10-03)
const sectionTitle = (c) => c.title;
// seen: 같은 장 앞 블록에 이미 나온 조각 글 — 회의록마다 되풀이되는 '다가오는 행사' 같은 줄은 처음 나온 블록에만 둔다
// (리더십 회의 장의 블록 다섯이 모두 추석 행사 한 문장으로 채워졌다 · 2026-10-04)
export const sectionOf = (D, c, perCard, extra = {}, seen = new Set()) => {
  const meta = { status: STATUS[c.status] || '', cardId: c.id, date: cardDate(c), when: taskWhen(c.start_date, c.due_date), ...extra };
  const note = audienceNote(c.audience);
  if (note) meta.note = note;
  const qs = questionsOf(c);
  if (qs) {
    meta.note = [`나눈 질문 ${qs.length}개`, note].filter(Boolean).join(' · ');
    // 댓글은 그대로 모델이 옮긴다(질문 아래 문장으로)
    const snips = cardSnips(D, c).filter(s => /^(?:댓글|답글)/.test(s.head));
    return { block: { key: `c:${c.id}`, type: 'section', title: sectionTitle(c), meta, cites: [cardCite(c)],
      items: qs.slice(0, QUESTIONS_MAX).map(q => ({ key: `q:${c.id.slice(0, 8)}:${hashKey(q)}`, text: q, by: 'code', cites: [cardCite(c)] })),
      ...(snips.length ? { snips, max: 2 } : {}) }, snips };
  }
  const all = cardSnips(D, c);
  const snips = all.filter(s => !seen.has(s.text));
  for (const s of snips) seen.add(s.text);
  // 글이 모두 앞 블록과 같으면 '기록 전'이 아니다(글은 있다) — 제목과 근거 칩만(PITFALLS 33-d)
  if (all.length && !snips.length) return { block: { key: `c:${c.id}`, type: 'section', title: sectionTitle(c), meta, cites: [cardCite(c)], items: [] }, snips: [] };
  return snips.length ? { block: { key: `c:${c.id}`, type: 'section', title: sectionTitle(c), meta, cites: [cardCite(c)], items: [], snips, max: perCard }, snips } : null;
};

// ── 바뀌기 전 조각(코드가 정한다 · 2026-10-04 사용자 지적 — 예배 2.0 장에 9/12의 '15시 20분 파송 찬양'이 지금 사실로 남았다) ──
// 늦은 기록이 앞 기록의 말을 바꿨다고 **글로 적었으면** 앞 조각은 바뀌기 전 내용이다. 모델 검사(supersede:)는 그대로 두고 그 앞에서 먼저 걷는다.
//   ① '기존 주제: 전도'      — 그 줄 자체가 지난 값 · 앞 기록에서 같은 이름표에 그 값을 적은 줄도
//   ② '변경 주제: 예배자'    — 앞 기록에서 같은 이름표('주제:')에 다른 값을 적은 줄
//   ③ '파송 찬양 제외'       — 빠진 것('파송 찬양')을 말한 앞 기록 줄(제외·취소·삭제·빼기)
//   ④ '9곡 → 7곡' · '15:30에서 15:00로 변경' — 숫자가 든 옛 값을 적은 앞 기록 줄
//   ⑤ 같은 이름표(일시·날짜·장소·시간·주제·대상) 줄이 더 늦은 기록에서 다른 값이면 앞 값('미정'·빈칸은 값이 아니다)
// snips: [{ head, text, date, cite }] → Map(조각 → 이유). 행사 장에서만 쓴다(팀 장은 서로 다른 일의 기록이 섞여 이름표가 겹친다).
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LABEL_LINE = /^([^:：]{1,16}?)\s*[:：]\s*(.+)$/;
const SAME_LABEL = { 일시: '날짜', 날짜: '날짜', '날짜 확정': '날짜', 일정: '날짜', 장소: '장소', 시간: '시간', 주제: '주제', 대상: '대상', '참석 대상': '대상' };
const NOT_A_VALUE = /미정|정해지지|^\(|_{2,}|확인\s?(?:필요|요망)|[?？]$/;
export function supersededSnips(snips) {
  const old = new Map();
  // 하위 업무 목록(쉼표로 이은 할 일 제목)은 견주지 않는다 — '…제외' 같은 할 일 제목이 앞 기록을 잘못 걷었다
  const list = (snips || []).filter(s => s && s.text && s.head !== '하위 업무');
  const before = (s, c) => s !== c && String(s.date || '') < String(c.date || '');
  const mark = (s, why) => { if (!old.has(s)) old.set(s, why); };
  for (const c of list) {
    const t = String(c.text).replace(/\s+/g, ' ').trim();
    let m = /^기존\s*([^:：]{1,12}?)\s*[:：]\s*(.+)$/.exec(t);
    if (m) {
      const label = m[1].trim(); const v = m[2].trim();
      mark(c, t);
      for (const s of list) if (before(s, c) && s.text.includes(label) && s.text.includes(v)) mark(s, t);
    }
    m = /^(?:변경(?:된)?|바뀐)\s*([^:：]{1,12}?)\s*[:：]\s*(.+)$/.exec(t);
    if (m) {
      const re = new RegExp(`(?:^|[\\s(])${escRe(m[1].trim())}\\s*[:：]\\s*(?!${escRe(m[2].trim())})\\S`);
      for (const s of list) if (before(s, c) && re.test(s.text)) mark(s, t);
    }
    for (const x of t.matchAll(/([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+)?)\s*(?:은|는|을|를|이|가)?\s*(?:제외|취소|삭제|빼기|뺐)/g)) {
      const p = x[1].replace(/(?:을|를|은|는|이|가)$/, '').trim();
      if (p.length < 2 || /^(?:기존|변경|일부|모두|전부|나머지)$/.test(p)) continue;
      for (const s of list) if (before(s, c) && s.text.includes(p)) mark(s, t);
    }
    for (const x of t.matchAll(/(?<![\d:])(\d[\d:.]*[가-힣]{0,2}?)\s*(?:에서|→|->)/g)) {
      const v = x[1];
      if (v.length < 2) continue;
      const re = new RegExp(`(?<![\\d:])${escRe(v)}(?![\\d:])`);
      for (const s of list) if (before(s, c) && re.test(s.text)) mark(s, t);
    }
  }
  const labelOf = (s) => {
    const m = LABEL_LINE.exec(String(s.text).trim());
    const k = m && SAME_LABEL[m[1].replace(/\s+/g, ' ').trim()];
    if (!k || NOT_A_VALUE.test(m[2].trim())) return null;
    // 날짜는 달·날만, 시간은 시각만 견준다('10월 31일(토)'와 '2026년 10월 31일 (토)'는 같은 값)
    const raw = m[2].replace(/\s+/g, '');
    const md = [...raw.matchAll(/(\d{1,2})월(\d{1,2})일/g)].map(x => `${+x[1]}-${+x[2]}`).join(',');
    const hm = [...raw.matchAll(/(\d{1,2}):(\d{2})/g)].map(x => `${+x[1]}:${x[2]}`).join(',');
    // 그 밖의 값은 덧붙인 말(마침표·괄호 뒤) 앞까지만 — '한강공원 운동장 괜찮음. 3시간에…'와 '… 괜찮음.(다목적…)'은 같은 장소다
    return { k, v: (k === '날짜' && md) || (k === '시간' && hm) || raw.split(/[.(,]/)[0] || raw };
  };
  for (const c of list) {
    const lc = labelOf(c);
    if (!lc) continue;
    for (const s of list) {
      const ls = labelOf(s);
      // 늦은 값이 앞 값을 품거나(더 자세히) 앞 값이 늦은 값을 품으면 바뀐 게 아니다
      if (ls && ls.k === lc.k && before(s, c) && !ls.v.includes(lc.v) && !lc.v.includes(ls.v)) mark(s, c.text);
    }
  }
  return old;
}

// 행사 정보 상자(사용자 승인 목업 2026-10-04) — 기록 글의 '이름표: 값' 줄에서 늦은 기록이 이긴다(지어내지 않는다 · 모르는 줄은 뺀다).
// 맡은 곳은 그 장 업무의 팀(많이 걸린 순 셋). → [{ k, v }]
const INFO_KEYS = [['날짜', /^(?:일시|날짜(?:\s?확정)?|행사\s?일시)$/], ['시간', /^시간$/], ['장소', /^장소$/], ['대상', /^(?:참석\s?)?대상(?:\s?및\s?예상\s?인원)?$/]];
export function eventInfo(snips, cards = []) {
  // 이름표마다 가장 늦은 기록 날의 값 — 그날 값이 둘 넘게 다르면(주일반·토요반 시간) 하나로 못 정하니 뺀다
  const by = {};
  for (const s of snips || []) {
    const m = LABEL_LINE.exec(String(s.text || '').trim());
    if (!m) continue;
    const key = INFO_KEYS.find(([, re]) => re.test(m[1].replace(/\s+/g, ' ').trim()));
    const v = m[2].replace(/\s+/g, ' ').trim();
    if (!key || !v || NOT_A_VALUE.test(v)) continue;
    const d = String(s.date || '');
    const cur = by[key[0]];
    if (!cur || d > cur.d) by[key[0]] = { d, vs: [v] };
    else if (d === cur.d && !cur.vs.includes(v)) {
      // 한 값이 다른 값을 품으면 같은 값이다('한강공원'과 '한강공원 운동장 괜찮음…') — 짧은 쪽을 남긴다
      const k = cur.vs.findIndex(x => x.includes(v) || v.includes(x));
      if (k >= 0) { if (v.length < cur.vs[k].length) cur.vs[k] = v; } else cur.vs.push(v);
    }
  }
  const got = {};
  for (const [k, x] of Object.entries(by)) if (x.vs.length === 1) got[k] = x.vs[0];
  const rows = [];
  if (got.날짜) rows.push({ k: '날짜', v: got.시간 && !/\d{1,2}:\d{2}/.test(got.날짜) ? `${got.날짜} ${got.시간}` : got.날짜 });
  else if (got.시간) rows.push({ k: '시간', v: got.시간 });
  if (got.장소) rows.push({ k: '장소', v: got.장소 });
  if (got.대상) rows.push({ k: '대상', v: got.대상 });
  const n = new Map();
  for (const c of cards) for (const t of c.teams || []) if (!AUDIENCE.has(t)) n.set(t, (n.get(t) || 0) + 1);
  const teams = [...n].sort((a, b) => b[1] - a[1] || TEAM_ORDER.indexOf(a[0]) - TEAM_ORDER.indexOf(b[0])).slice(0, 3).map(x => x[0]);
  if (teams.length) rows.push({ k: '맡은 곳', v: teams.join(' · ') });
  return rows;
}

// 되풀이 모임 장(월례회 …)의 개요 — 자주 쓰는 말의 뜻(사람이 고친 글) 또는 더다붓 소개의 한 달 줄 + 다음 날짜(KST 오늘 기준).
// 장 첫 줄이 스튜디오 물품 이야기였다(사용자 지적 2026-10-04). 뜻이 없으면 null(모델 소개 그대로).
// cards: 그 장 업무 · terms/month: 줄 [{ text }] → [{ key, text, by, cites }] | null
const squash = (s) => String(s || '').replace(/\s+/g, '').replace(/쉽/g, '십');
export function recurringLead(title, cards, { terms = [], month = [], today = '' } = {}) {
  const t = String(title || '').trim();
  if (!t) return null;
  const same = (cards || []).filter(c => squash(c.title).includes(squash(t)) && /^(?:\d{1,2}월|\d{6}|\d{1,2}월\s?\d{1,2}일)/.test(String(c.title).trim()));
  if (same.length < 2) return null;
  const def = terms.map(it => stripBold(it.text)).find(x => x.startsWith(`${t} ·`));
  const line = def ? `${josa(t, '은', '는')} ${def.slice(t.length + 2).trim()}` : month.map(it => stripBold(it.text)).find(x => x.includes(t));
  if (!line) return null;
  const items = [{ key: 'def', text: line, by: 'code', cites: [def ? pageCite('terms', '자주 쓰는 말') : pageCite('intro', '더다붓 소개')] }];
  const next = same.filter(c => cardDate(c) && cardDate(c) >= today).sort(byDate)[0];
  if (next) items.push({ key: 'next', text: `다음 ${josa(t, '은', '는')} ${mdLabel(cardDate(next), true)}이에요.`, by: 'code', cites: [cardCite(next)], meta: { date: cardDate(next) } });
  return items;
}

// 정해지기까지 — 행사 장의 날짜 있는 기록 가운데 정한 것·바뀐 것을 말한 조각(업무마다 둘 · 늦은 것 여덟). 바뀌기 전 조각도 싣는다(화면이 줄을 긋는다).
// 시각은 시:분만('누가복음 2:25-32' 같은 장절은 아니다)
const DECIDE = /일시|날짜|장소|시간|대상|인원|방식|주제|연합|확정|결정|변경|제외|취소|대신|기존|하기로|\d+\s?월\s?\d+\s?일|(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?![\d-])/;
export const DECIDE_STRONG = /확정|결정|변경|제외|취소|대신|기존|하기로|조정|연합|장소|날짜|일시|주제/;
export function decideSnips(pool, old = new Map()) {
  // 글에서만 본다(소제목의 '댓글 9월 12일'이 날짜로 걸렸다) · 정한 말이 든 줄이나 바뀌기 전 줄만 · 댓글·하위 업무 목록은 뺀다 ·
  // '기존 …' 줄은 바뀐 줄이 말해 주므로 따로 세우지 않는다
  const byCard = Map.groupBy(pool.filter(s => !(!s.date || s.head === '하위 업무' || /^(?:댓글|답글)/.test(s.head || '') || /[?？]$/.test(s.text) || /^기존\s/.test(s.text))
    && DECIDE.test(s.text) && (old.has(s) || DECIDE_STRONG.test(s.text))), s => s.cite?.id || '');
  const score = (s) => (old.has(s) ? 3 : 0) + (DECIDE_STRONG.test(s.text) ? 2 : 0) + (LABEL_LINE.test(s.text) ? 1 : 0);
  const out = [];
  // 업무마다 둘 — 바뀌기 전 조각은 이유가 다른 것부터('주제: 전도'와 '파송 찬양'이 둘 다 서게)
  for (const list of byCard.values()) {
    const pick = []; const why = new Set();
    for (const s of [...list].sort((a, b) => score(b) - score(a))) {
      if (pick.length >= 2) break;
      if (old.has(s) && why.has(old.get(s)) && list.some(x => !pick.includes(x) && x !== s && (!old.has(x) || !why.has(old.get(x))))) continue;
      pick.push(s); if (old.has(s)) why.add(old.get(s));
    }
    out.push(...pick);
  }
  const seen = new Set();
  // 무게(바뀌기 전 · 정한 말 · 이름표) 순으로 여덟, 같으면 늦은 기록 — 그다음 날짜 순으로 세운다
  return out.filter(s => (seen.has(s.text) ? false : seen.add(s.text)))
    .sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date)).slice(0, 8)
    .sort((a, b) => a.date.localeCompare(b.date));
}
