import { FAQ_SOURCE, hashKey, kstDate, stripBold, talkKind, termsOf, tokenCoverage } from '../../src/services/wikiCore.js';

// ── 자주 묻는 질문 장 — 물어본 글로 매일 다시 세운다(모델 없음) ─────────────────
// · 자주 묻는 질문: 두 번 넘게 물었거나 답을 찾은(밤에 다시 물어 찾은 것 포함) 질문 · 사람이 답을 적은 질문
// · 다붓이가 아직 모르는 질문: 최근 60일 안에 몰랐거나 '도움이 안 됐어요'를 받은 질문 — 사람이 답을 적으면
//   그 글이 다음 질문의 근거가 된다(다붓이 자가 개선 · 열쇠 q:<묶음>이 두 블록 사이를 옮겨 다녀도 같다)
// 지금 코드가 저장하지 않고 받는 말(다붓이 자신 · 인사 · 마음 · 신앙 · 청년부 밖)이거나, 알려 준 말인데 그 내용이 이미 위키 한 줄에 다 있으면
// '아직 모르는 질문'이 아니다(사용자 지적 2026-10-04 — '너 누가 만들었누' · '임성빈 전도사님이야'가 그 갈래가 생기기 전에 저장돼 남았다).
export function answeredToday(q, wikiLines = []) {
  const k = talkKind(q);
  if (k && k.kind !== 'statement') return true;
  if (k?.kind === 'statement') {
    const toks = termsOf(q).filter(t => !/^\d+$/.test(t));
    return toks.length > 0 && wikiLines.some(line => tokenCoverage(q, line) === 1);
  }
  return false;
}
// 위키 줄(자주 묻는 질문 장은 빼고 · 사람이 고친 글 포함) — 굵게 별표는 걷는다
function faqWikiLines(D) {
  const out = [];
  for (const p of D.pages || []) if (p.id !== 'faq') for (const b of p.blocks || []) for (const it of b.items || []) if (String(it.text || '').trim()) out.push(stripBold(it.text));
  for (const e of D.edits || []) if (e.page_id !== 'faq' && String(e.text || '').trim()) out.push(stripBold(e.text));
  return out;
}

export function faqPage(D) {
  const byNorm = Map.groupBy(D.questions.filter(q => q.status !== 'refused' && q.status !== 'failed'), q => q.norm);
  const human = new Map(D.edits.filter(e => e.page_id === 'faq' && String(e.text).trim()).map(e => [e.item_key, e]));
  const known = []; const unknown = [];
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const wikiLines = faqWikiLines(D);
  for (const [norm, list] of byNorm) {
    const key = `q:${hashKey(norm)}`;
    const latest = list[list.length - 1];
    const answered = [...list].reverse().find(q => q.status === 'answered' && q.feedback !== 'bad' && q.answer?.sentences?.length);
    const badAfter = answered && list.some(q => q.feedback === 'bad' && q.created_at >= answered.created_at);
    const item = { key, text: '', by: 'model', meta: { q: latest.question, n: list.length } };
    if (human.has(key)) { known.push({ ...item, at: latest.created_at }); continue; }
    if (answered && !badAfter) {
      if (list.length >= 2 || answered.via === 'nightly') {
        const cites = [];
        for (const s of answered.answer.sentences) for (const c of s.cites || []) if (!cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
        // 답한 날 — 그날 답을 찍어 둔 것이라 시간이 지나면 낡는다(마스터만 보는 장 · 사용자 결정 2026-10-05 '언제 답한 것인지')
        known.push({ ...item, meta: { ...item.meta, day: kstDate(answered.created_at) }, text: answered.answer.sentences.map(s => s.text).join(' '), cites, at: latest.created_at });
      }
      continue;
    }
    // 아침 고리가 '검사가 버림'으로 가른 것은 마스터에게 올리지 않는다 — 기록은 있다(18차 2회 · 마스터에게는 '기록 없음'만)
    const night = [...list].reverse().find(q => q.via === 'nightly');
    if (['dropped', 'known'].includes(night?.answer?.cause) && night.created_at >= latest.created_at) continue;
    // 앞 대화 없이 남은, 내용 낱말이 없는 이어 묻는 말('오~ 어디소 하는딩?')은 혼자로는 답할 수 없다 — 마스터에게도 올리지 않는다
    if (!latest.answer?.prev && !termsOf(latest.question).length) continue;
    if (latest.created_at >= since && !answeredToday(latest.question, wikiLines)) unknown.push({ ...item, at: latest.created_at });
  }
  const order = (a, b) => (b.meta.n - a.meta.n) || String(b.at).localeCompare(String(a.at));
  const clean = (x) => { const { at, ...rest } = x; return rest; };
  return {
    id: 'faq', grp: '함께 쓰는 글', title: '자주 묻는 질문', kind: 'auto', position: 3, source: FAQ_SOURCE, source_count: known.length + unknown.length,
    blocks: [
      { key: 'known', type: 'faq', title: '자주 묻는 질문', items: known.sort(order).slice(0, 30).map(clean) },
      { key: 'unknown', type: 'faq', title: '다붓이가 아직 모르는 질문', items: unknown.sort(order).slice(0, 30).map(clean) },
    ],
  };
}
