import { FAQ_SOURCE, MASTER_PAGES, hashKey, kstDate, prefilter, stripBold, talkKind, termsOf, tokenCoverage, forgetKind, isAskRow } from '../../src/services/wikiCore.js';
import { leaderCited } from '../../src/services/visibility.js';

// ── '아직 답하지 못한 질문' 장(id는 faq 그대로 — 딥링크·정책·푸시가 그 id를 안다) — 물어본 글로 매일 다시 세운다(모델 없음 · 마스터만 · 0090) ──
// 20차 ⑧(사용자 결정 2026-10-13): 답 스냅샷을 걷었다 — 그날 찍어 둔 답이 낡았다('다음 월례회는 10월 11일').
//   답이 다 나온 질문을 '많이 물어본 질문' 칩으로 두던 것도 걷었다(사용자 결정 2026-10-13 — "답변이 다 나온 질문인데 왜 자꾸 여기에") —
//   답을 적는 자리는 '다붓이가 배운 것'(learn.js)이고, 이 장은 **다붓이가 못 답한 질문**만 둔다.
//   · 열린 질문(openGroups) · 날짜 · 못 찾음/👎 — 마스터가 '답을 알려 주기'로 사실을 남기면 그 자리에서 다시 답해 닫힌다
//     (api/_wikiAsk.js resolveWithFact · resolved_at)
// 인사 · 알려 준 말 · 만들어 달라는 요청 · 코드가 받는 말은 어느 쪽에도 안 선다(옛 10줄은 다음 빌드에서 정리된다).
// 마스터 장 글(이 장 · 다붓이가 배운 것)은 아는 말 견주기에 쓰지 않는다.
//
// 알려 준 말인데 그 내용이 이미 위키 한 줄에 다 있거나, 지금 코드가 저장하지 않고 받는 말(다붓이 자신 · 인사 · 마음 · 신앙 · 청년부 밖)이면
// 질문이 아니다(사용자 지적 2026-10-04 — '너 누가 만들었누' · '임성빈 전도사님이야'가 그 갈래가 생기기 전에 저장돼 남았다).
export function answeredToday(q, wikiLines = []) {
  const k = talkKind(q);
  if (k && k.kind !== 'statement') return true;
  if (k?.kind === 'statement') {
    const toks = termsOf(q).filter(t => !/^\d+$/.test(t));
    return toks.length > 0 && wikiLines.some(line => tokenCoverage(q, line) === 1);
  }
  return false;
}
// 위키 줄(마스터 장은 빼고 · 사람이 고친 글 포함) — 굵게 별표는 걷는다
function faqWikiLines(D) {
  const out = [];
  for (const p of D.pages || []) if (!MASTER_PAGES.has(p.id)) for (const b of p.blocks || []) for (const it of b.items || []) if (String(it.text || '').trim()) out.push(stripBold(it.text));
  for (const e of D.edits || []) if (!MASTER_PAGES.has(e.page_id) && String(e.text || '').trim()) out.push(stripBold(e.text));
  return out;
}

// 열린 질문 — 묶음(norm)마다 마지막 물음이 몰랐거나(unknown) 👎인데 아직 닫히지 않은 것(resolved_at · 0098).
// 그 뒤 아침 고리가 이미 가른 것도 닫힌 셈이다: 답했다(missed — 👎 질문은 새 고리가 본 fromBad만) · 검사가 버림(dropped — 기록은 있다) ·
// 이미 아는 알려 준 말(known). disputed는 열린 그대로(👎). 알려 준 말 · 코드가 받는 말 · 거른 말 · 앞 대화 없이 남은 말투 꼴 ·
// 리더 프로젝트 기록에 기댄 답이 있던 묶음(20차 ⑥ — 마스터만 보는 장이라도 그 기록에서 온 질문은 싣지 않던 규칙 그대로)은 열린 질문이 아니다.
// since: 그보다 오래된 물음은 뺀다(자주 묻는 질문 장 60일 · 아침 고리는 제한 없이) → [{ norm, q, id, why: 'none'|'bad', at, n, row }]
export function openGroups(questions = [], { leaderCards = new Set(), wikiLines = [], since = null } = {}) {
  const out = [];
  const sorted = [...questions].filter(q => q && q.status !== 'refused' && q.status !== 'failed').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const [norm, list] of Map.groupBy(sorted, q => q.norm)) {
    const ask = [...list].reverse().find(isAskRow);   // 아침 미리 답하기(warm · 0115)는 물음이 아니다
    if (!ask || ask.resolved_at || (since && String(ask.created_at) < since)) continue;
    const bad = ask.feedback === 'bad';
    if (ask.status !== 'unknown' && !bad) continue;
    if (ask.answer?.told || talkKind(ask.question)?.kind === 'statement' || prefilter(ask.question) || answeredToday(ask.question, wikiLines)) continue;
    // 다붓이 말투로 받아친 말(answer.talk · 👎가 붙어도) · 학습하지 마(옛 저장분 '아니야 학습하지마')는 질문이 아니다(2026-10-17 · PITFALLS 33-x)
    if (ask.answer?.talk || forgetKind(ask.question)) continue;
    if (!ask.answer?.prev && !termsOf(ask.question).length) continue;
    if (list.some(q => q.status === 'answered' && leaderCited(q.answer, leaderCards))) continue;
    const night = [...list].reverse().find(q => q.via === 'nightly' && String(q.created_at) >= String(ask.created_at));
    const cause = night?.answer?.cause;
    if (['dropped', 'known', 'told', 'talk'].includes(cause) || (cause === 'missed' && night.status === 'answered' && (!bad || night.answer.fromBad))) continue;
    out.push({ norm, q: ask.question, id: ask.id, why: bad || cause === 'disputed' ? 'bad' : 'none', at: ask.created_at, n: list.filter(isAskRow).length, row: ask });
  }
  return out;
}

export function faqPage(D) {
  const leaderCards = D.leaderCards || new Set();
  const open = openGroups(D.questions || [], { leaderCards, wikiLines: faqWikiLines(D), since: new Date(Date.now() - 60 * 864e5).toISOString() });
  const unanswered = open.map(o => ({ key: `q:${hashKey(o.norm)}`, text: '', by: 'model', meta: { q: o.q, n: o.n, day: kstDate(o.at), why: o.why, qid: o.id }, at: o.at }));
  const clean = (x) => { const { at, ...rest } = x; return rest; };
  const rows = unanswered.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30).map(clean);
  return {
    id: 'faq', grp: '함께 쓰는 글', title: '아직 답하지 못한 질문', kind: 'auto', position: 3, source: FAQ_SOURCE, source_count: rows.length,
    blocks: rows.length ? [{ key: 'open', type: 'open', title: '아직 답하지 못한 질문', items: rows }] : [],
  };
}
