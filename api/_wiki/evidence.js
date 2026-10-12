import { SEED_PAGES, overlayEdits, overlayTitles, withTeamCards, stripBold, mdLabel } from '../../src/services/wikiCore.js';

// ── 다붓이 근거 글 — 위키 장 · 주보 (20차 ② · 2026-10-12) ─────────────────────────
// 다붓이 답(api/_wikiAsk.js collectAll)과 뜻 찾기 조각(api/_docsync.js — 크론이 doc_vec에 임베딩)이 **같은 글**을 쓴다.
// 둘이 갈리면 검색 모드(DABOOTI_RETRIEVE)가 찾은 조각과 모델에 실린 기록이 서로 다른 글이 된다.

// 마크다운 → 평문(이미지 · 링크 주소 · 강조 기호를 걷는다)
export const plain = (s) => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
  .replace(/[=*_`>#]+/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// 주보 근거 줄 — 있는 자리(예배 탭)까지 싣는다. 자리가 없어 '10월 4일 주보는 어디에 있나요?'의 '예배 탭에 있어요'를
// 검사가 근거 밖 말로 버렸다(2026-10-05 · 아침 다시 묻기에서도 남은 질문).
export const serviceLine = (s) => {
  const songs = (Array.isArray(s.songs) ? s.songs : []).map(x => x?.title).filter(Boolean).join(' · ');
  return `${mdLabel(s.service_date, true)} 주보는 예배 탭에 있어요 · 설교 '${s.title || '미입력'}' · 본문 ${s.passage_ref || '미입력'}${songs ? ` · 찬양 ${songs}` : ''}`;
};
// 광고 — 그 주일에 모두에게 알린 정해진 소식. 제목만 있는 광고도 싣는다('내년도(2027) 회장(정민경 청년) 발표' · 2026-10-05)
export const noticesOf = (s) => (Array.isArray(s.notices) ? s.notices : [])
  .map(n => [String(n?.title || '').trim(), plain(n?.body).replace(/\n/g, ' ')].filter(Boolean).join(': ')).filter(Boolean);
export const serviceText = (s) => {
  const notices = noticesOf(s);
  return `[주보 · ${mdLabel(s.service_date, true)}] ${serviceLine(s)}${notices.length ? `\n광고: ${notices.join(' / ')}` : ''}`;
};

// 위키 장 — 장 하나가 기록 하나(사람이 고친 문장 겹침 · 팀 소개 카드) → { items: [{ text, cite, page }], now: 겹친 장들 }
// 자주 묻는 질문 장(faq)은 싣지 않는다(2026-10-09) — 남이 물은 질문 글이 들어 있고 마스터만 읽는 장이다.
export const pageBody = (p) => (p.blocks || []).map(b => `${b.title ? `${b.title}: ` : ''}${(b.items || []).map(it => `${it.meta?.q ? `(질문 '${it.meta.q}') ` : ''}${it.meta?.team ? `${it.meta.team} ` : ''}${stripBold(it.text)}`).join(' / ')}`).filter(Boolean).join('\n').slice(0, 4000);
export function wikiEvidence(pages, edits) {
  const editsBy = Map.groupBy(edits.filter(e => e.page_id !== 'faq'), e => e.page_id);
  const allPages = [...pages, ...SEED_PAGES.filter(sp => !pages.some(p => p.id === sp.id))].filter(p => p.id !== 'faq');
  const now = withTeamCards(allPages.map(p => { const pe = editsBy.get(p.id) || []; const o = overlayTitles(p, pe); return { ...o, blocks: overlayEdits(o.blocks, pe) }; }));
  const items = [];
  for (const p of now) {
    const body = pageBody(p);
    if (body.trim()) items.push({ text: `[위키 '${p.title}' · 매일 아침 모은 글]\n${body}`, cite: { t: 'page', id: p.id, label: p.title }, page: p });
  }
  return { items, now };
}
