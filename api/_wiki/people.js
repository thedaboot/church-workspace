import { josa, hasJong, mdLabel, kstDate } from '../../src/services/wikiCore.js';
import { hitsName, COMMON_GIVEN } from '../../src/services/aiPeople.js';
import { liveProfile } from '../_lib.js';
import { strip } from './text.js';

// ── 사람 이름 ────────────────────────────────────────────────────────────────
// 가입자 표시명 · 명단 이름 · 세 글자 이름의 뒤 두 글자(흔한 낱말은 빼고) + 직함 붙은 바깥 이름.
// hasName(글) → 이름이 있나 · hasName.strangers(글, 근거) → 글에 있는데 **근거에 없는** 이름들(지어낸 이름을 버린다 · 2026-10-04)
const OUTSIDE = [/[가-힣]{2,4}\s?(?:목사|선생|전도사|간사|집사|권사|장로|교수)님/, /(?<![가-힣])[가-힣]{3}\s?(?:형제|자매)/, /@\S/, /\(with\.?\s*[^)]*\)/i];
const OUTSIDE_NAME = /(?<![가-힣])([가-힣]{3})\s?(?:목사|선생|전도사|간사|집사|권사|장로|교수)님|(?<![가-힣])([가-힣]{3})\s?(?:형제|자매)/g;
export function nameMatcher(names) {
  const people = [];
  for (const n of names || []) {
    const s = String(n || '').trim();
    if (s.length < 2) continue;
    const keys = [s];
    const h = (s.match(/[가-힣]+/) || [''])[0];
    if (h.length === 3 && !COMMON_GIVEN.has(h.slice(1))) keys.push(h.slice(1));
    people.push({ name: s, keys });
  }
  const list = people.flatMap(p => p.keys);
  const fn = (text) => list.some(k => hitsName(text, k)) || OUTSIDE.some(re => re.test(String(text || '')));
  fn.strangers = (text, hay) => {
    const t = String(text || ''); const h = String(hay || '');
    const out = people.filter(p => p.keys.some(k => hitsName(t, k)) && !p.keys.some(k => hitsName(h, k))).map(p => p.name);
    for (const m of t.matchAll(OUTSIDE_NAME)) { const nm = m[1] || m[2]; if (!h.includes(nm) && !out.includes(nm)) out.push(nm); }
    return out;
  };
  return fn;
}

// ── 사람을 부르는 꼴 · 별명 · 댓글 줄 (사용자 지적 2026-10-04) ─────────────────────────
// 위키 문장에서 사람은 '이름 형제·자매'로 부른다(성별을 모르면 '청년' · 교역자는 '전도사님').
// 댓글은 '하빈이랑' · '윤민이와'처럼 이름 두 글자로 부른다 — 명단에서 그 두 글자 이름이 한 사람뿐일 때만 온 이름으로 푼다.
// roster: [{ name(명단 이름), display(가입자 표시명), gender('m'|'f'|''), pastor, profileId }] — 환송·미승인·합쳐진 계정은 빼고 넘긴다.
const PERSON_TITLE = /^\s?(?:형제|자매|청년|님|씨|전도사|목사|간사|장로|집사|권사|[가-힣]{0,5}(?:팀장|팀원|순장|순원|회장|부장|총무|회계|리더|담당))/;
// 두 글자 이름이 흔한 낱말과 같으면 풀지 않는다('유리가 깨졌다')
const COMMON_SHORT = new Set([...COMMON_GIVEN, '유리', '하늘', '한별', '다솜', '가람', '보람', '나래', '슬기', '은별']);
// 이름 뒤 조사 — 앞의 '이'는 부르는 꼴('하빈이랑'의 이)이다. → [붙은 글자, 뜻이 같은 조사]
const AFTER_NAME = [['이에요', '이에요'], ['이한테', '한테'], ['이에게', '에게'], ['이랑', '랑'], ['이가', '가'], ['이는', '는'], ['이와', '와'], ['이를', '를'], ['이의', '의'], ['이도', '도'],
  ['으로', '로'], ['에게', '에게'], ['한테', '한테'], ['께서', '께서'], ['예요', '이에요'], ['이', '가'], ['가', '가'], ['은', '는'], ['는', '는'], ['을', '를'], ['를', '를'],
  ['과', '와'], ['와', '와'], ['랑', '랑'], ['로', '로'], ['의', '의'], ['도', '도'], ['만', '만'], ['', '']];
const PAIR = { 가: ['이', '가'], 는: ['은', '는'], 를: ['을', '를'], 와: ['과', '와'], 랑: ['이랑', '랑'], 로: ['으로', '로'], 이에요: ['이에요', '예요'] };
const particleFor = (call, p) => (PAIR[p] ? (hasJong(call) ? PAIR[p][0] : PAIR[p][1]) : p);

export function peopleIndex(roster = []) {
  const list = (roster || []).filter(p => p && String(p.name || p.display || '').trim());
  const callOf = (p, shown = p.name || p.display) => `${shown} ${p.pastor ? '전도사님' : p.gender === 'm' ? '형제' : p.gender === 'f' ? '자매' : '청년'}`;
  const full = new Map();
  for (const p of list) for (const n of [p.name, p.display]) {
    const s = String(n || '').trim();
    if (/^[가-힣]{3,4}$/.test(s) && !full.has(s)) full.set(s, p);
  }
  const given = new Map();
  for (const p of list) {
    const n = String(p.name || '').trim();
    if (!/^[가-힣]{3}$/.test(n)) continue;
    const g = n.slice(1);
    if (COMMON_SHORT.has(g)) continue;
    if (!given.has(g)) given.set(g, new Set());
    given.get(g).add(p);
  }
  // 표시명이 두 글자 이름이면('재훈') 그 사람의 이름 두 글자와 같다 — 같은 사람이면 하나로 센다
  const resolveGiven = (g) => { const s = given.get(g); return s && s.size === 1 ? [...s][0] : null; };
  const byProfile = new Map(list.filter(p => p.profileId).map(p => [p.profileId, p]));
  const byName = (n) => full.get(n) || list.find(p => p.display === n || p.name === n) || null;
  // 글 속 이름 자리를 찾는다 → [{ at, len, p, given, tail, base }] (앞이 한글·@가 아니고, 뒤가 직함이 아닐 때)
  const spots = (t) => {
    const out = [];
    const re = /[가-힣]+/g; let m;
    while ((m = re.exec(t))) {
      const w = m[0]; const at = m.index;
      if (t[at - 1] === '@') continue;
      let hit = null;
      for (const n of [w.slice(0, 4), w.slice(0, 3)]) if (n.length >= 3 && full.has(n)) { hit = { len: n.length, p: full.get(n), given: false }; break; }
      if (!hit && w.length >= 2) { const p = resolveGiven(w.slice(0, 2)); if (p) hit = { len: 2, p, given: true }; }
      if (!hit) continue;
      const rest = t.slice(at + hit.len);
      // '강희라 청년'은 성별을 알면 '강희라 자매'로(청년은 성별을 모를 때만 · 사용자 결정 2026-10-04)
      const youth = !hit.given && (hit.p.gender === 'm' || hit.p.gender === 'f') && /^\s?청년(?!부)/.exec(rest);
      if (youth) {
        const after = (/^[가-힣]*/.exec(rest.slice(youth[0].length)) || [''])[0];
        const tail = AFTER_NAME.find(([k]) => after === k);
        if (tail) out.push({ at, ...hit, tail: youth[0] + tail[0], base: tail[1] });
        continue;
      }
      if (PERSON_TITLE.test(rest) || rest.startsWith('(')) continue;
      const word = w.slice(hit.len);
      const tail = AFTER_NAME.find(([k]) => word === k);
      if (!tail) continue;   // '노준석이었어요'처럼 풀지 못하는 꼬리는 건드리지 않는다
      out.push({ at, ...hit, tail: tail[0], base: tail[1] });
    }
    return out;
  };
  const rewrite = (text, make) => {
    const t = String(text || '');
    let out = ''; let i = 0;
    for (const s of spots(t)) { out += t.slice(i, s.at) + make(s, t.slice(s.at, s.at + s.len)); i = s.at + s.len + s.tail.length; }
    return out + t.slice(i);
  };
  return {
    list, callOf, byProfile, byName, resolveGiven,
    // 근거(조각)에 — 온 이름은 부르는 꼴로('장제훈' → '장제훈 형제') · 두 글자 이름은 괄호로 풀어 둔다('윤민이와' → '윤민(박윤민 자매)와')
    evidence: (text) => rewrite(text, (s, n) => {
      const c = s.given ? `${n}(${callOf(s.p)})` : callOf(s.p);
      return `${c}${particleFor(callOf(s.p), s.base)}`;
    }),
    // 모델 문장에 — 맨 이름 뒤에 형제·자매·청년을 넣고 조사를 맞춘다 · 두 글자 이름은 온 이름으로('윤민과' → '박윤민 자매와')
    fix: (text) => rewrite(text, (s) => { const c = callOf(s.p); return `${c}${particleFor(c, s.base)}`; }),
  };
}

// 댓글 한 줄(사용자 지적 2026-10-04 — '@정민경 장제훈 (4주차/6주차) 완료'를 '정민경은 장제훈과 4주차와 6주차를 완료했어요'로 옮겼다).
// 쓴 사람이 그 말의 주어다 · '@이름'은 그 말을 들은 사람(부른 사람)이지 주어가 아니다 · 답글이면 누구의 댓글에 답했는지.
// c: { id, parent_id, author_id, body, created_at } · ctx: { people: peopleIndex, names: Map(profileId → 표시명), byId: Map(id → 댓글), mentionNames: [이름] }
// → { kind: '댓글'|'답글', date, who, text, line } — line은 '[답글 · 9월 19일] 노준석 형제가 노준석 형제의 댓글('…')에 답함(정민경 자매를 부름): 9월 19일(토)에 1주차 완료'
export function commentLine(c, ctx = {}) {
  const people = ctx.people || peopleIndex([]);
  const whoOf = (id) => {
    const p = people.byProfile.get(id);
    if (p) return people.callOf(p);
    const n = ctx.names?.get(id);
    return n ? (people.byName(n) ? people.callOf(people.byName(n)) : `${n} 청년`) : '';
  };
  // @이름 — 아는 이름 가운데 가장 긴 것(표시명에 띄어쓰기·영문이 붙기도 한다 · '@이하랑Alex')
  const known = [...new Set([...(ctx.mentionNames || []), ...people.list.flatMap(p => [p.name, p.display])].filter(Boolean).map(String))].sort((a, b) => b.length - a.length);
  const called = [];
  let body = strip(c.body).replace(/@(\S+)(?:\s?님(?![가-힣]))?/g, (all, tok) => {
    const n = known.find(k => tok.startsWith(k)) || tok.replace(/[^가-힣A-Za-z0-9]+$/, '');
    const p = people.byName(n);
    const label = p ? people.callOf(p) : n;
    if (label && !called.includes(label)) called.push(label);
    return tok.length > n.length ? tok.slice(n.length) : '';
  }).replace(/\s+/g, ' ').replace(/^[\s,.:]+/, '').trim();
  body = people.evidence(body);
  const who = whoOf(c.author_id) || '누군가';
  const parent = c.parent_id ? ctx.byId?.get(c.parent_id) : null;
  const kind = c.parent_id ? '답글' : '댓글';
  const date = kstDate(c.created_at);
  const pq = parent ? strip(parent.body).replace(/@\S+\s?/g, '').trim() : '';
  const did = parent
    ? `${josa(who, '이', '가')} ${whoOf(parent.author_id) || '다른 사람'}의 댓글${pq ? `(“${people.evidence(pq).slice(0, 40)}${pq.length > 40 ? '…' : ''}”)` : ''}에 답함`
    : `${josa(who, '이', '가')} 씀`;
  const to = called.length ? `(${called.join(', ')}${hasJong(called[called.length - 1]) ? '을' : '를'} 부름)` : '';
  const text = `${did}${to}: ${body}`;
  return { kind, date, who, body, text, line: `[${kind} · ${mdLabel(date)}] ${text}` };
}

// 부를 사람 한 벌 — 환송 안 된 명단 + 명단에 안 이어진 승인 가입자(환송·합쳐진 계정은 뺀다)
export function rosterOf(profiles = [], people = []) {
  const live = new Map(profiles.filter(liveProfile).map(p => [p.id, String(p.display_name).trim()]));
  const out = people.filter(p => !p.removed_at && String(p.name || '').trim()).map(p => ({
    name: String(p.name).trim(), display: (p.profile_id && live.get(p.profile_id)) || '', gender: p.gender || '', pastor: !!p.is_pastor, profileId: (p.profile_id && live.has(p.profile_id)) ? p.profile_id : '',
  }));
  const linked = new Set(out.map(p => p.profileId).filter(Boolean));
  for (const [id, n] of live) if (!linked.has(id)) out.push({ name: n, display: n, gender: '', pastor: false, profileId: id });
  return out;
}
