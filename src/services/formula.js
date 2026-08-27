// ============================================================================
// 엑셀 수식 조각 계산기 — **조건부 서식의 수식 규칙(type="expression")** 전용.
// ----------------------------------------------------------------------------
// 왜 있나: 조건부 서식의 규칙 하나가 `=$D5>1000` 처럼 수식으로 적혀 있는 경우가 있다.
// 그걸 못 읽으면 그 규칙이 칠하는 색이 앱에서 통째로 빠진다(사용자 요청으로 추가).
//
// 무엇이 아닌가: **스프레드시트 엔진이 아니다.** 셀에 든 수식을 다시 계산하지 않는다
// (그건 엑셀이 이미 계산해 둔 값을 파일에서 읽는다). 여기는 조건부 서식 규칙 한 줄을
// 셀마다 참/거짓으로 판정하는 데만 쓴다.
//
// 못 읽는 수식은 **던지지 않고 null을 돌려준다.** 부르는 쪽은 null이면 칠하지 않는다 —
// 틀린 색을 칠하는 것보다 안 칠하는 쪽이 낫다(§6-29-c의 판단과 같다).
//
// 순수 함수라 노드에서 그대로 검사한다(tests/sheet.mjs).
// ============================================================================

// ── 값 ──────────────────────────────────────────────────────────────────────
// 빈 칸은 숫자로는 0, 글자로는 ''로 행세한다(엑셀이 그렇다 — `A1=""`가 빈 칸에 참).
export const BLANK = Symbol('blank');
const ERR = Symbol('error');
const isBlank = (v) => v === BLANK;
const num = (v) => {
  if (isBlank(v)) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const str = (v) => (isBlank(v) ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const bool = (v) => {
  if (isBlank(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return s !== '';
};

// ── 토큰 ────────────────────────────────────────────────────────────────────
// ':' 도 연산자다 — 범위(A1:B9)를 자리표시자로 빼돌리는 것보다 파서에서 바로 잡는 쪽이
// 짧고, 절대·상대($)와 열 전체($A:$A)를 한자리에서 다룰 수 있다.
const OPS = ['<>', '<=', '>=', '=', '<', '>', '&', '+', '-', '*', '/', '^', '%', '(', ')', ',', ':'];
function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '"') {                                  // 문자열("" 두 겹은 따옴표 하나)
      let s = ''; i++;
      while (i < src.length) {
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (OPS.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(src.slice(i));
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    // 이름 · 셀 주소 · 함수 이름. 시트 이름(Sheet1!A1)이나 따옴표 이름은 못 읽는다.
    const m = /^\$?[A-Za-z_][A-Za-z0-9_.$]*/.exec(src.slice(i));
    if (!m) throw new Error(`읽을 수 없는 글자: ${ch}`);
    out.push({ t: 'name', v: m[0] }); i += m[0].length;
    continue;
  }
  return out;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)$/;
const COL_RE = /^(\$?)([A-Za-z]{1,3})$/;
const colNum = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

// ── 파서 (재귀 하강) ────────────────────────────────────────────────────────
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (v) => { if (peek() && peek().t === 'op' && peek().v === v) { p++; return true; } return false; };

  function primary() {
    const tk = tokens[p];
    if (!tk) throw new Error('수식이 갑자기 끝났어요');
    if (tk.t === 'num') { p++; return { k: 'num', v: tk.v }; }
    if (tk.t === 'str') { p++; return { k: 'str', v: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') { p++; const e = expr(); if (!eat(')')) throw new Error(') 가 없어요'); return e; }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) { p++; return { k: 'neg', sign: tk.v, a: primary() }; }
    if (tk.t === 'name') {
      p++;
      const up = tk.v.toUpperCase();
      if (peek() && peek().t === 'op' && peek().v === '(') {         // 함수 호출
        p++;
        const args = [];
        if (!eat(')')) {
          do { args.push(expr()); } while (eat(','));
          if (!eat(')')) throw new Error(') 가 없어요');
        }
        return { k: 'fn', name: up, args };
      }
      if (up === 'TRUE') return { k: 'bool', v: true };
      if (up === 'FALSE') return { k: 'bool', v: false };
      if (eat(':')) {                                   // 범위: A1:B9 · $A:$A
        const end = tokens[p++];
        if (!end || end.t !== 'name') throw new Error('범위의 끝이 없어요');
        return rangeNode(tk.v, end.v);
      }
      return refNode(tk.v);
    }
    throw new Error(`읽을 수 없는 조각: ${tk.v}`);
  }
  function refNode(text) {
    const m = REF_RE.exec(text);
    if (m) return { k: 'ref', absC: m[1] === '$', c: colNum(m[2]), absR: m[3] === '$', r: Number(m[4]) };
    throw new Error(`셀 주소가 아니에요: ${text}`);
  }
  // 양끝이 온전한 주소(A1)면 셀 범위, 열 이름만이면 그 열 전체다.
  function rangeNode(a, b) {
    const pa = REF_RE.exec(a), pb = REF_RE.exec(b);
    if (pa && pb) {
      return { k: 'range', kind: 'cells',
        a: { absC: pa[1] === '$', c: colNum(pa[2]), absR: pa[3] === '$', r: Number(pa[4]) },
        b: { absC: pb[1] === '$', c: colNum(pb[2]), absR: pb[3] === '$', r: Number(pb[4]) } };
    }
    const ca = COL_RE.exec(a), cb = COL_RE.exec(b);
    if (ca && cb) {
      return { k: 'range', kind: 'col',
        a: { absC: ca[1] === '$', c: colNum(ca[2]), absR: true, r: 0 },
        b: { absC: cb[1] === '$', c: colNum(cb[2]), absR: true, r: 0 } };
    }
    throw new Error(`범위를 못 읽었어요: ${a}:${b}`);
  }
  function postfix() {
    let n = primary();
    while (peek() && peek().t === 'op' && peek().v === '%') { p++; n = { k: 'pct', a: n }; }
    return n;
  }
  function power() {
    const a = postfix();
    if (peek() && peek().t === 'op' && peek().v === '^') { p++; return { k: 'bin', op: '^', a, b: power() }; }
    return a;
  }
  function mul() {
    let a = power();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const op = tokens[p++].v; a = { k: 'bin', op, a, b: power() }; }
    return a;
  }
  function add() {
    let a = mul();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const op = tokens[p++].v; a = { k: 'bin', op, a, b: mul() }; }
    return a;
  }
  function concat() {
    let a = add();
    while (peek() && peek().t === 'op' && peek().v === '&') { p++; a = { k: 'bin', op: '&', a, b: add() }; }
    return a;
  }
  function expr() {
    let a = concat();
    while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = tokens[p++].v; a = { k: 'bin', op, a, b: concat() };
    }
    return a;
  }
  const out = expr();
  if (p !== tokens.length) throw new Error('남는 조각이 있어요');
  return out;
}

// ── 계산 ────────────────────────────────────────────────────────────────────
// ctx = {
//   get(r, c)          → 값(숫자·문자열·불리언·BLANK)
//   bounds: {r1,c1,r2,c2}   전체 열/행 참조를 자를 범위
//   here: {r, c}       지금 판정 중인 셀(ROW()·COLUMN()용)
//   dr, dc             상대 참조를 옮길 양(규칙이 적힌 자리 → 지금 셀)
// }
function shift(node, ctx) {
  return { r: node.absR ? node.r : node.r + ctx.dr, c: node.absC ? node.c : node.c + ctx.dc };
}

function evalNode(n, ctx) {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'bool': return n.v;
    case 'pct': return num(evalNode(n.a, ctx)) / 100;
    case 'neg': {
      const v = num(evalNode(n.a, ctx));
      return n.sign === '-' ? -v : v;
    }
    case 'ref': {
      const { r, c } = shift(n, ctx);
      return ctx.get(r, c);
    }
    case 'range': return rangeCells(n, ctx);
    case 'bin': return binop(n.op, n.a, n.b, ctx);
    case 'fn': return callFn(n.name, n.args, ctx);
    default: throw new Error('모르는 마디');
  }
}

function rangeCells(n, ctx) {
  const a = shift(n.a, ctx), b = shift(n.b, ctx);
  const B = ctx.bounds;
  const r1 = n.kind === 'col' ? B.r1 : Math.max(Math.min(a.r, b.r), B.r1);
  const r2 = n.kind === 'col' ? B.r2 : Math.min(Math.max(a.r, b.r), B.r2);
  const c1 = Math.max(Math.min(a.c, b.c), B.c1);
  const c2 = Math.min(Math.max(a.c, b.c), B.c2);
  const out = [];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(ctx.get(r, c));
  return out;
}

function cmpVals(op, x, y) {
  // 빈 칸은 ''·0 양쪽과 같다고 본다
  const bothNum = (isBlank(x) || typeof x === 'number') && (isBlank(y) || typeof y === 'number');
  const a = bothNum ? num(x) : str(x).toUpperCase();
  const b = bothNum ? num(y) : str(y).toUpperCase();
  switch (op) {
    case '=': return a === b;
    case '<>': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    default: throw new Error(`모르는 비교: ${op}`);
  }
}

function binop(op, an, bn, ctx) {
  const x = evalNode(an, ctx), y = evalNode(bn, ctx);
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) return cmpVals(op, x, y);
  if (op === '&') return str(x) + str(y);
  const a = num(x), b = num(y);
  if (Number.isNaN(a) || Number.isNaN(b)) return ERR;
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? ERR : a / b;
    case '^': return a ** b;
    default: throw new Error(`모르는 연산: ${op}`);
  }
}

const flat = (v) => (Array.isArray(v) ? v : [v]);
const nums = (vals) => vals.flatMap(flat).filter(v => !isBlank(v) && v !== ERR).map(num).filter(n => !Number.isNaN(n));
// COUNTIF 등의 조건("<>0", ">=3", "사과")
function critMatch(v, crit) {
  const s = str(crit);
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(s);
  const op = m[1] || '=';
  const rhs = m[2];
  const asNum = Number(rhs);
  return cmpVals(op, v, rhs === '' ? BLANK : (Number.isFinite(asNum) && rhs.trim() !== '' ? asNum : rhs));
}
const serialOf = (d) => Math.floor(d.getTime() / 86400000) + 25569;

const FNS = {
  AND: (a, ctx) => a.every(x => bool(evalNode(x, ctx))),
  OR: (a, ctx) => a.some(x => bool(evalNode(x, ctx))),
  NOT: (a, ctx) => !bool(evalNode(a[0], ctx)),
  IF: (a, ctx) => (bool(evalNode(a[0], ctx)) ? evalNode(a[1], ctx) : (a[2] ? evalNode(a[2], ctx) : false)),
  IFERROR: (a, ctx) => { const v = evalNode(a[0], ctx); return v === ERR ? evalNode(a[1], ctx) : v; },
  ISBLANK: (a, ctx) => isBlank(evalNode(a[0], ctx)),
  ISNUMBER: (a, ctx) => typeof evalNode(a[0], ctx) === 'number',
  ISTEXT: (a, ctx) => typeof evalNode(a[0], ctx) === 'string',
  ISERROR: (a, ctx) => evalNode(a[0], ctx) === ERR,
  LEN: (a, ctx) => str(evalNode(a[0], ctx)).length,
  TRIM: (a, ctx) => str(evalNode(a[0], ctx)).trim(),
  LEFT: (a, ctx) => str(evalNode(a[0], ctx)).slice(0, a[1] ? num(evalNode(a[1], ctx)) : 1),
  RIGHT: (a, ctx) => { const s = str(evalNode(a[0], ctx)); const n = a[1] ? num(evalNode(a[1], ctx)) : 1; return n <= 0 ? '' : s.slice(-n); },
  MID: (a, ctx) => str(evalNode(a[0], ctx)).substr(num(evalNode(a[1], ctx)) - 1, num(evalNode(a[2], ctx))),
  UPPER: (a, ctx) => str(evalNode(a[0], ctx)).toUpperCase(),
  LOWER: (a, ctx) => str(evalNode(a[0], ctx)).toLowerCase(),
  EXACT: (a, ctx) => str(evalNode(a[0], ctx)) === str(evalNode(a[1], ctx)),
  SEARCH: (a, ctx) => { const i = str(evalNode(a[1], ctx)).toUpperCase().indexOf(str(evalNode(a[0], ctx)).toUpperCase()); return i < 0 ? ERR : i + 1; },
  FIND: (a, ctx) => { const i = str(evalNode(a[1], ctx)).indexOf(str(evalNode(a[0], ctx))); return i < 0 ? ERR : i + 1; },
  CONCATENATE: (a, ctx) => a.map(x => str(evalNode(x, ctx))).join(''),
  ABS: (a, ctx) => Math.abs(num(evalNode(a[0], ctx))),
  INT: (a, ctx) => Math.floor(num(evalNode(a[0], ctx))),
  MOD: (a, ctx) => { const d = num(evalNode(a[1], ctx)); return d === 0 ? ERR : ((num(evalNode(a[0], ctx)) % d) + d) % d; },
  ROUND: (a, ctx) => { const p = a[1] ? num(evalNode(a[1], ctx)) : 0; const f = 10 ** p; return Math.round(num(evalNode(a[0], ctx)) * f) / f; },
  ROUNDUP: (a, ctx) => { const p = a[1] ? num(evalNode(a[1], ctx)) : 0; const f = 10 ** p; return Math.ceil(num(evalNode(a[0], ctx)) * f) / f; },
  ROUNDDOWN: (a, ctx) => { const p = a[1] ? num(evalNode(a[1], ctx)) : 0; const f = 10 ** p; return Math.floor(num(evalNode(a[0], ctx)) * f) / f; },
  SUM: (a, ctx) => nums(a.map(x => evalNode(x, ctx))).reduce((s, n) => s + n, 0),
  AVERAGE: (a, ctx) => { const v = nums(a.map(x => evalNode(x, ctx))); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : ERR; },
  MIN: (a, ctx) => { const v = nums(a.map(x => evalNode(x, ctx))); return v.length ? Math.min(...v) : 0; },
  MAX: (a, ctx) => { const v = nums(a.map(x => evalNode(x, ctx))); return v.length ? Math.max(...v) : 0; },
  COUNT: (a, ctx) => nums(a.map(x => evalNode(x, ctx))).length,
  COUNTA: (a, ctx) => a.map(x => evalNode(x, ctx)).flatMap(flat).filter(v => !isBlank(v) && str(v) !== '').length,
  COUNTBLANK: (a, ctx) => a.map(x => evalNode(x, ctx)).flatMap(flat).filter(v => isBlank(v) || str(v) === '').length,
  COUNTIF: (a, ctx) => { const crit = evalNode(a[1], ctx); return flat(evalNode(a[0], ctx)).filter(v => critMatch(v, crit)).length; },
  SUMIF: (a, ctx) => {
    const range = flat(evalNode(a[0], ctx));
    const crit = evalNode(a[1], ctx);
    const target = a[2] ? flat(evalNode(a[2], ctx)) : range;
    let s = 0;
    range.forEach((v, i) => { if (critMatch(v, crit)) { const n = num(target[i] ?? BLANK); if (!Number.isNaN(n)) s += n; } });
    return s;
  },
  ROW: (a, ctx) => (a.length ? shift(a[0], ctx).r : ctx.here.r),
  COLUMN: (a, ctx) => (a.length ? shift(a[0], ctx).c : ctx.here.c),
  TODAY: (_a, ctx) => serialOf(ctx.today || new Date()),
  NOW: (_a, ctx) => serialOf(ctx.today || new Date()),
  YEAR: (a, ctx) => new Date((num(evalNode(a[0], ctx)) - 25569) * 86400000).getUTCFullYear(),
  MONTH: (a, ctx) => new Date((num(evalNode(a[0], ctx)) - 25569) * 86400000).getUTCMonth() + 1,
  DAY: (a, ctx) => new Date((num(evalNode(a[0], ctx)) - 25569) * 86400000).getUTCDate(),
  WEEKDAY: (a, ctx) => new Date((num(evalNode(a[0], ctx)) - 25569) * 86400000).getUTCDay() + 1,
};

function callFn(name, args, ctx) {
  const fn = FNS[name];
  if (!fn) throw new Error(`모르는 함수: ${name}`);
  return fn(args, ctx);
}

// ── 바깥 문 ─────────────────────────────────────────────────────────────────
// 수식 글자 → 미리 씹어둔 모양. 셀마다 다시 파싱하지 않으려고 한 번만 만든다.
// 못 읽으면 null(부르는 쪽이 칠하지 않는다).
export function compile(src) {
  try {
    const text = String(src || '').trim().replace(/^=/, '');
    if (!text) return null;
    if (text.includes('!')) return null;            // 다른 시트 참조는 못 읽는다
    return parse(lex(text));
  } catch {
    return null;
  }
}

// 한 셀에서 규칙이 참인가. 못 읽는 수식·계산 실패는 false(칠하지 않음).
export function evalRule(ast, ctx) {
  if (!ast) return false;
  try {
    const v = evalNode(ast, ctx);
    return v === ERR ? false : bool(v);
  } catch {
    return false;
  }
}
