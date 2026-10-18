// ============================================================================
// 다붓이 답을 한 문장씩 펼치기 · 근거 먼저 (v5 2묶음 시안 · mock/b3 · import 0 — tests/logcheck-phone이 문다)
// ----------------------------------------------------------------------------
// 모델이 쓰는 글을 그대로 흘리는 것이 아니다 — 서버가 **검사까지 끝낸** 문장(answer.sentences)이 다 온 뒤에, 화면이 한 문장씩
// 글자를 쳐 나가듯 보인다(타자 느낌). 문장 사이에는 짧은 숨. 길이에 따라 빨라져 전체가 maxTotal을 넘지 않는다.
//   revealPlan(texts)     문장마다 { start, dur, len } (ms · 글자 수 — 한글은 글자 하나가 하나)
//   revealAt(plan, t)     t ms 뒤 문장마다 보인 글자 수 + 다 펼쳤나
//   isEvidenceLine(o)     스트림의 '근거 먼저' 줄 { evidence: [{ t, id, label }] } (서버가 답보다 먼저 흘리는 줄 — 시안은 게스트 흉내만)
// ============================================================================

export const REVEAL = { charMs: 24, gapMs: 180, maxSentence: 1100, maxTotal: 3600 };

const glyphs = (s) => Array.from(String(s ?? ''));

export function revealPlan(texts = [], o = REVEAL) {
  const lens = texts.map(t => glyphs(t).length);
  let durs = lens.map(n => Math.min(o.maxSentence, n * o.charMs));
  const gaps = Math.max(0, texts.length - 1) * o.gapMs;
  const sum = durs.reduce((a, b) => a + b, 0);
  if (sum + gaps > o.maxTotal && sum > 0) {
    const k = Math.max(0, o.maxTotal - gaps) / sum;
    durs = durs.map(d => d * k);
  }
  const out = [];
  let at = 0;
  lens.forEach((len, i) => { out.push({ start: at, dur: durs[i], len }); at += durs[i] + o.gapMs; });
  return out;
}

export function revealAt(plan = [], t = 0) {
  const shown = plan.map(({ start, dur, len }) => {
    if (t <= start) return 0;
    if (dur <= 0 || t >= start + dur) return len;
    return Math.min(len, Math.ceil(((t - start) / dur) * len));
  });
  const done = plan.every((p, i) => shown[i] >= p.len);
  return { shown, done };
}

export const revealTotal = (plan = []) => (plan.length ? plan[plan.length - 1].start + plan[plan.length - 1].dur : 0);

export const sliceGlyphs = (s, n) => glyphs(s).slice(0, n).join('');

export const isEvidenceLine = (o) => !!o && Array.isArray(o.evidence) && Object.keys(o).length === 1;
