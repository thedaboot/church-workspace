// ============================================================================
// 큐시트 → 순모임 가이드가 읽을 몇 줄 (2026-09-25 · AI 감사 결정 12) — 순수 모듈(import 0)
// ----------------------------------------------------------------------------
// 큐시트(주보에 붙은 `files.kind='cuesheet'` · 워드)는 예배 전체의 진행표다 — 시간·순서·담당자·
// 멘트·조명·음향·영상 칸에 교독문·봉독 본문·공동기도문까지 들어 있다. 발췌를 **앞 2000자**로
// 두면 준비 순서(13:00 악보 출력 …)와 교독문(새번역)만 채우고 정작 설교 칸에 닿지 못했다.
// 가이드에 필요한 것은 둘뿐이다(사용자 결정):
//   ⓒ 머리 표의 **주제·전례색** 한 줄
//   ⓑ 순서 칸이 **설교·적용·결단**인 줄의 **내용 칸**만 — 제목 · 본문 · 인용 구절 · 적용 찬양
// 결과는 1200자 이하의 몇 줄이고, 올리는 순간 `files.text_excerpt`에 그대로 앉는다
// (services/fileText.js · worship.uploadServiceFile) — 가이드는 다운로드 없이 그 한 칸을 읽는다.
//
// **성경 인용문은 싣지 않는다.** 가이드는 개역한글 본문만 쓴다(sunGuide.js). 큐시트의 인용은
// 번역이 섞여 있다 — `[시105:1-6, 37-45, 새번역]`처럼 번역을 적은 곳도 있지만 설교 칸의
// `[요12:3] 마리아는 지극히 비싼 향유…`는 번역 표시가 없고 개역한글·개역개정 어느 쪽과도
// 글자가 맞지 않았다(2026-09-20 큐시트). 번역을 가려 새번역만 걷는 것은 믿을 수 없어서
// **`[책장:절]` 표시가 있는 인용은 본문을 통째로 버리고 구절 표시만 남긴다**(`인용 구절: 요12:3`).
// 절 번호로 시작하는 줄(`1 너희는 주님께…`)도 인용 본문으로 보고 버린다.
//
// **사람 이름을 싣지 않는다** — 담당자 칸은 읽지 않고, 내용 칸의 '봉헌자 : OOO 청년' 같은 줄도
// 진행 지시와 함께 걷는다. 가이드의 원칙(순원 지목 금지 · docs/V2.md §1)과 같은 선이다.
// ============================================================================

export const CUE_DIGEST_MAX = 1200;

const norm = (s) => String(s || '').replace(/\s+/g, '');
const tidy = (s) => String(s || '').replace(/[—–]/g, '-').replace(/[ \t]+/g, ' ').trim();
// 진행 지시(반주·마이크·헌금함·봉헌자·조명…)와 대본 머리(집례자·다같이…)는 가이드의 재료가 아니다
const STAGE = /반주|마이크|헌금함|헌금|봉헌자|PPT|조명|음향|슬라이드|카메라|멘트|(^|\s)(on|off)(\s|$)/i;
const SCRIPT = /^(집례자|다같이|다 같이|봉독자|담당자|회중|인도자|배종위원)(?=[\s:]|$)/;
// 구절 표시 — `[요12:3]` · `[시105:1-6, 37-45, 새번역]` · `[삿 9:7-15]`
const REF = /\[([^\]\n]{1,40}?\d+\s*:\s*\d+[^\]\n]*)\]/g;
const SECTION = /설교|적용|결단/;

// 한 칸의 글 → 남길 줄들
function keepLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n/)) {
    let s = tidy(raw).replace(/^[•‣▪·*\-\s]+/, '').trim();
    if (!s) continue;
    const refs = [...s.matchAll(REF)].map(m => tidy(m[1].replace(/,?\s*새번역\s*$/, '')));
    if (refs.length) { out.push(`인용 구절: ${refs.join(', ')}`); continue; }
    if (/^\d{1,3}\s+\S/.test(s)) continue;              // 절 번호로 시작하는 줄 = 인용 본문
    if (STAGE.test(s) || SCRIPT.test(s)) continue;
    s = s.replace(/^(제목|본문|찬양)\s*:?\s*/, '$1: ');
    out.push(s);
  }
  return [...new Set(out)];
}

// ── 워드(parseDocx의 { blocks }) ───────────────────────────────────────────
const paraText = (p) => (p?.runs || []).map(r => r.text || '').join('');
const cellText = (c) => (c?.paras || []).map(paraText).join('\n');

function fromDocx(doc) {
  let theme = '';
  let color = '';
  const sections = [];
  for (const b of doc?.blocks || []) {
    if (b?.t !== 'table') continue;
    let head = null;                                   // { order, body, width }
    for (const row of b.rows || []) {
      const cells = row.map(cellText);
      const key = norm(cells[0]);
      if (cells.length >= 2 && key === '주제') { theme = tidy(cells.slice(1).join(' ')); continue; }
      if (cells.length >= 2 && key === '전례색') { color = tidy(cells.slice(1).join(' ')); continue; }
      if (!head) {
        const order = cells.findIndex(c => norm(c) === '순서');
        const body = cells.findIndex(c => norm(c).startsWith('내용'));
        if (order >= 0 && body >= 0) head = { order, body, width: cells.length };
        continue;
      }
      // 칸을 합친 줄(여는 전례 · 말씀범퍼 …)은 칸 수가 다르다 — 순서 줄만 본다
      if (cells.length !== head.width) continue;
      if (!SECTION.test(norm(cells[head.order]))) continue;
      const lines = keepLines(cells[head.body]);
      if (lines.length) sections.push({ label: tidy(cells[head.order].replace(/\n/g, ' ')), lines });
    }
  }
  return { theme, color, sections };
}

// ── 글(옛 발췌 · PDF에서 뽑은 한 덩어리) ─────────────────────────────────────
// 표 칸이 한 줄로 붙어 있어서 칸을 가를 수 없다. 머리의 주제·전례색과, 설교·결단 도막 안의
// **이름표가 붙은 것**(제목 · 본문 · 찬양 · 구절 표시)만 줍는다 — 담당자 이름이 도막 첫머리에 붙어
// 있어 나머지는 믿을 수 없다.
function fromText(text) {
  const t = tidy(String(text || '').replace(/\s+/g, ' '));
  const theme = tidy(/주제\s+(.+?)\s+전례색/.exec(t)?.[1] || '');
  const color = tidy(/전례색\s+(.+?)(?:\s+시간\s+순서|\s+\d{1,2}:\d{2}|$)/.exec(t)?.[1] || '').slice(0, 80);
  const sections = [];
  const re = /(?<![가-힣])(설교|결단\s?및\s?봉헌|적용\s?찬양)(?![가-힣])\s+(.*?)(?=\s\d{1,2}:\d{2}\s|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const body = m[2];
    const lines = [];
    for (const f of body.matchAll(/(?:^|[•‣\s])(제목|본문)\s+(.+?)(?=\s*[•‣]|\s(?:제목|본문|찬양)\s|\s[‘'"]|\s\[|$)/g)) lines.push(`${f[1]}: ${tidy(f[2])}`);
    const song = /(?:^|\s)찬양\s+(.+?)(?=\s\*|\s[‘'"]|\s강단|$)/.exec(body);
    if (song) lines.push(`찬양: ${tidy(song[1])}`);
    const refs = [...body.matchAll(REF)].map(x => tidy(x[1].replace(/,?\s*새번역\s*$/, '')));
    if (refs.length) lines.push(`인용 구절: ${refs.join(', ')}`);
    const kept = lines.filter(l => !STAGE.test(l));
    if (kept.length) sections.push({ label: tidy(m[1]), lines: kept });
  }
  return { theme, color, sections };
}

// 워드 파싱 결과든 글이든 → 몇 줄. 건질 것이 없으면 빈 글이다(가이드는 그 줄을 안 싣는다).
export function cueDigest(input) {
  const { theme, color, sections } = typeof input === 'string' ? fromText(input) : fromDocx(input);
  const lines = [];
  const head = [theme && `주제: ${theme}`, color && `전례색: ${color}`].filter(Boolean).join(' · ');
  if (head) lines.push(head);
  for (const s of sections) lines.push(`${s.label}: ${s.lines.join(' · ')}`);
  let out = '';
  for (const l of lines) {
    const next = out ? `${out}\n${l}` : l;
    if (next.length > CUE_DIGEST_MAX) break;           // 줄 단위로 자른다 — 줄 중간에서 끊지 않는다
    out = next;
  }
  return out || (lines[0] || '').slice(0, CUE_DIGEST_MAX);
}
