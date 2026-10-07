// ── 글 조각 ──────────────────────────────────────────────────────────────────
// 마크다운 → 평문(링크·이미지·주소·강조 기호를 걷는다) — 사람 줄·발췌·뼈대가 같이 쓴다
export const strip =(s) => String(s || '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\((?:https?:)?[^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
  .replace(/\*\*|__|==|[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}/g, '').replace(/\s+/g, ' ').trim();
const cleanHead = (s) => strip(s.replace(/^#+\s*/, '')).replace(/@\S+/g, '').replace(/\(\s*[,\s]*\)/g, '').replace(/\s+/g, ' ').trim();

// 틀의 빈칸 — '(예: …)' · '___명' · '00:00 ~ 00:00' · 값이 통째로 괄호인 '장소: (실내 체육관 / 야외 운동장 등)'는 아직 안 정한 자리다.
// 빈칸만 걷고, 걷고 나니 이름표만 남으면 줄을 버린다(가을 체육대회 개요의 틀 글이 '장소는 실내 체육관…'으로 옮겨졌다 · 2026-10-04).
export function fillIn(body) {
  const s = String(body || '');
  const t = s.replace(/\s*00:00\s*~\s*00:00/g, '').replace(/\s*\(예:[^)]*\)/g, '').replace(/\s*(?:총\s*)?₩?_{2,}\s*[명개원팀]?/g, '').replace(/\s+/g, ' ').trim();
  if (/^[^:]{1,24}:\s*\([^()]*\)$/.test(t)) return '';
  if (t !== s && /:\s*$/.test(t)) return '';
  return t;
}

const BARE_HEAD = /^(?:목적|장소|일시|날짜|내용|개요|일정|시간|주제|대상|준비물|안건|역할|참고)$/;

// 본문 → [{ head, text }]. 소제목을 앞에 달고, 가사 자투리는 버린다. 사람 이름이 든 줄도 싣는다(2026-10-04 · 예전에는 버렸다).
export function snippetsOf(text) {
  const out = []; let head = ''; let parent = ''; let buf = null;
  const flush = () => {
    if (buf && buf.items.length) out.push(buf.items.length === 1 ? { head: buf.head, text: buf.items[0] } : { head: buf.head, text: `${buf.items.join(', ')} (${buf.items.length}개)` });
    buf = null;
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const t = raw.trim();
    if (!t || /^-{3,}$/.test(t)) continue;
    if (/^#{1,6}\s/.test(t) || /^(?:\d+\.\s*)?\*\*[^*]+\*\*\s*$/.test(t)) { flush(); head = cleanHead(t); parent = ''; continue; }
    const bullet = /^([-*]|\d+\.|\[[ x]\])\s+/.test(t);
    if (/더미/.test(head)) continue;
    // 빈칸(___)은 strip이 밑줄을 걷기 전에 본다
    const body = strip(fillIn(t.replace(/^([-*]|\d+\.)\s+/, '').replace(/^\[[ x]\]\s+/, '').replace(/\*\*|==/g, '')));
    if (!body || body.length < 2) continue;
    if (BARE_HEAD.test(body)) continue;   // '1. 목적' '2. 장소'처럼 소제목 낱말만 있는 줄(틀) — '목적이 있어요'로 옮겨졌다
    if (!bullet && !/[.:)다요음함]$/.test(body)) continue;
    if (/:$/.test(body) && body.length < 40) { flush(); parent = body.replace(/:$/, '').trim(); continue; }
    const h = [head, parent].filter(Boolean).join(' > ');
    if (bullet && /\((?:[A-G][#b]?)(?:-[A-G][#b]?)?\)$/.test(body)) {
      if (!buf || buf.head !== h) { flush(); buf = { head: h, items: [] }; }
      buf.items.push(body); continue;
    }
    flush();
    out.push({ head: h, text: body.slice(0, 300) });
  }
  flush();
  return out;
}
