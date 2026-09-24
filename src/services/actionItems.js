// ============================================================================
// 회의록의 "누가 · 무엇을 · 언제까지" 줄 읽기 (2026-09-21 사용자 요청)
// ----------------------------------------------------------------------------
// 다듬기(services/ai.js의 polishText)는 회의록을 정리하면서 **누가 무엇을 언제까지**
// 도막을 만든다. 그런데 그 줄은 본문 글자로만 남아서, 사람이 손으로 하위 업무를
// 만들지 않으면 그대로 사라졌다. 여기서 그 줄을 읽어 화면이 "아직 업무가 아닌 것"을
// 짚을 수 있게 한다.
//
// **새 저장 자리를 만들지 않는다.** 항목은 본문에서 매번 읽고, '업무가 되었나'는
// 하위 업무 제목과 맞춰 본다(§3-1 — 칸을 늘리기 전에 이미 있는 것으로 되는지 본다).
// 제목을 나중에 고치면 이어짐이 끊기는데, 그건 사람이 보면 아는 어긋남이고 잘못된
// 자동 연결보다 낫다.
//
// 이 파일은 **순수하다** — import가 없다. 그래서 tests/logcheck가 그대로 읽어 돌린다.
// ============================================================================

// 도막 제목. 다듬기 프롬프트가 이 글자를 쓴다(ai.js의 회의록 구조 규칙·예시 3).
// 바꾸려면 **두 곳을 같이** 바꿔야 한다 — 한쪽만 바꾸면 조용히 0건이 된다.
//
// 2026-09-22에 `누가 무엇을 언제까지` → `청년별 업무` → `청년별 담당 업무`로 갔다
// (사용자 결정 — **화면 라벨과 같은 글자**가 되게). **옛 이름도 계속 읽는다**: 이미 그
// 제목으로 다듬어 저장된 회의록이 있고, 이름을 바꿨다고 그 카드의 줄이 사라지면 안 된다.
// 앞엣것이 새로 쓰는 이름이다. 새 이름은 옛 이름을 **품으므로**('청년별 업무'가
// '청년별 담당 업무' 안에 없다) 둘을 따로 적는다.
export const ACTION_HEADINGS = ['청년별 담당 업무', '청년별 업무', '누가 무엇을 언제까지'];
export const ACTION_HEADING = ACTION_HEADINGS[0];

// 가운뎃점은 우리 글에서 항목을 가르는 표다(화면 곳곳이 그렇다). 모델이 어길 때를
// 대비해 빗금·하이픈도 받는다 — 못 가르면 줄 전체를 '무엇을'로 둔다(이름 없이).
const SEP = /\s*[·|/]\s*|\s+[-–]\s+/;
const MONTH_DAY = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const ISO_DAY = /(\d{4})-(\d{2})-(\d{2})/;

const clean = (v) => String(v || '').trim();
// 멘션 표기(@이름)와 굵게·형광펜 표시를 걷어 이름만 남긴다
const plainName = (v) => clean(v).replace(/^@/, '').replace(/\*\*|==/g, '').trim();

// 맡는 쪽 도막 → 이름 배열. `@조해리 @박지호`처럼 여럿일 수 있고, @가 없으면 통째로 하나다
// (`찬양팀` 같은 팀 이름이 그렇다). 빈 것은 버린다.
function peopleOf(head) {
  const t = clean(head);
  if (!t) return [];
  if (!t.includes('@')) return [plainName(t)].filter(Boolean);
  return t.split(/\s+/).filter(x => x.startsWith('@')).map(plainName).filter(Boolean);
}

// 'YYYY-MM-DD'. 월·일만 있으면 **기준일에서 가장 가까운 앞날**의 해로 채운다 —
// 12월 회의에서 "1월 5일까지"라고 적으면 지난 1월이 아니라 다음 해 1월이다.
function isoOf(text, now) {
  const iso = ISO_DAY.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = MONTH_DAY.exec(text);
  if (!md) return '';
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return '';
  const base = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const y = base.getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  const same = `${y}-${pad(month)}-${pad(day)}`;
  // 기준일도 **로컬** 연·월·일로 적는다 — toISOString()은 UTC라 한국 시간 오전 9시 전에는
  // 어제가 되어 반년 경계에서 해가 하루 어긋났다(2026-09-24). 이 파일은 import가 없어야
  // 해서 utils.localDate를 부르지 않고 그 자리에서 조립한다.
  const today = `${y}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  // 기준일보다 반년 넘게 지난 날짜면 다음 해로 본다(회의록은 앞일을 적는다)
  const diffDays = (Date.parse(`${same}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return diffDays < -182 ? `${y + 1}-${pad(month)}-${pad(day)}` : same;
}

// 마크다운 본문 → [{ name, what, dueText, dueDate, raw }]
// 도막이 없거나 비면 빈 배열이다(그 카드는 회의록이 아니거나 아직 안 다듬었다).
export function parseActionItems(markdown, { now = new Date() } = {}) {
  const lines = String(markdown || '').split('\n');
  // 도막 제목 줄 찾기 — `### 누가 무엇을 언제까지` (제목 수준은 가리지 않는다)
  let i = lines.findIndex(l => /^#{1,4}\s/.test(l) && ACTION_HEADINGS.some(h => l.includes(h)));
  if (i < 0) return [];
  const out = [];
  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,4}\s/.test(line)) break;                 // 다음 도막에서 멈춘다
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!m) continue;                                   // 불릿이 아닌 줄은 건너뛴다
    const body = clean(m[1]);
    if (!body) continue;
    const parts = body.split(SEP).map(clean).filter(Boolean);
    // 맡는 쪽은 **첫 도막이 사람처럼 보일 때만** 쓴다 — @표기이거나 짧은 글자다.
    // 아니면 이름 없이 통째로 '무엇을'이다(모델이 한 문장으로 적은 경우).
    //
    // **한 줄에 여럿일 수 있다**(사용자 결정 2026-09-22): 같은 팀 사람이 둘이면
    // `@조해리 @박지호 · 조편성 방법 정하기`처럼 적는다. 할 일이 하나이니 줄도 하나다.
    const head = parts[0] || '';
    const named = parts.length > 1 && (head.startsWith('@') || plainName(head).length <= 6);
    const names = named ? peopleOf(head) : [];
    const rest = named ? parts.slice(1) : parts;
    const dueText = rest.length > 1 && (MONTH_DAY.test(rest[rest.length - 1]) || ISO_DAY.test(rest[rest.length - 1]))
      ? rest[rest.length - 1] : '';
    const what = (dueText ? rest.slice(0, -1) : rest).join(' · ').replace(/\*\*|==/g, '').trim();
    if (!what) continue;
    // `name`은 한 사람일 때의 편의값이다 — 화면은 `names`를 쓴다.
    out.push({ names, name: names[0] || '', what, dueText, dueDate: isoOf(dueText || body, now), raw: body });
  }
  return out;
}

// 본문에서 그 도막을 **통째로 걷어낸 글**. 화면은 이 글을 그리고, 그 도막은 아래
// '청년별 담당 업무' 부품이 훨씬 잘 보여 준다 — 같은 내용이 두 번 보이지 않게 한다
// (사용자 지적 2026-09-22 · 본문에도 적히고 부품에도 떠서 겹쳤다).
//
// **저장된 글은 그대로 둔다.** 걷는 것은 그리는 자리뿐이다 — 그 도막이 곧 그 항목들의
// 저장 자리이고(따로 만든 칸이 없다), 지우면 부품이 세울 것도 사라진다.
//
// 본문 체크리스트의 번호는 안 밀린다 — 걷는 줄은 전부 `- ` 평범한 불릿이고
// utils.toggleTodoLine은 `- [ ]` 모양만 센다.
export function stripActionSection(markdown) {
  const lines = String(markdown || '').split('\n');
  const at = lines.findIndex(l => /^#{1,4}\s/.test(l) && ACTION_HEADINGS.some(h => l.includes(h)));
  if (at < 0) return String(markdown || '');
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,4}\s/.test(lines[i])) { end = i; break; }
  }
  const out = [...lines.slice(0, at), ...lines.slice(end)];
  // 걷어낸 자리에 빈 줄이 겹쳐 남지 않게 다듬는다
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── 되쓰기 — 부품에서 고친 것을 본문 도막으로 되돌린다 (2026-09-22) ─────────
// 화면은 이 도막을 **부품으로만** 고친다(편집기 본문에서는 감춘다). 그래서 고친 결과를
// 다시 마크다운으로 적는 자리가 필요하다. **읽는 모양과 적는 모양이 같아야 한다** —
// 여기서 적은 줄을 parseActionItems가 그대로 다시 읽을 수 있어야 왕복이 닫힌다.
export function formatActionLine(it) {
  const who = (it?.names || []).filter(Boolean).map(n => `@${n}`).join(' ');
  const iso = String(it?.dueDate || '');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일까지`
    : String(it?.dueText || '').trim();
  return `- ${[who, String(it?.what || '').trim(), due].filter(Boolean).join(' · ')}`;
}

// 본문 + 항목들 → 도막이 맨 아래에 붙은 본문. 할 일이 빈 줄은 버린다(빈 줄을 남기면
// 다음에 읽을 때 사라져서 사람이 "지워졌나?" 한다). 항목이 하나도 없으면 도막도 없다.
export function writeActionSection(body, items) {
  const rows = (items || []).filter(it => String(it?.what || '').trim());
  const rest = stripActionSection(body);
  if (!rows.length) return rest;
  return [rest, '', `### ${ACTION_HEADING}`, ...rows.map(formatActionLine)]
    .join('\n').replace(/^\n+/, '').trim();
}

// 맡는 쪽 이름표 — **세 명까지는 이름, 그보다 많으면 외 N명**(사용자 결정 2026-09-22).
export function namesLabel(names) {
  const a = (names || []).filter(Boolean);
  if (a.length <= 3) return a.join(' · ');
  return `${a.slice(0, 3).join(' · ')} 외 ${a.length - 3}명`;
}

// 이 항목이 이미 하위 업무가 되었나 — 제목 글자로 견준다(띄어쓰기·대소문자를 접는다).
// 통합 검색의 norm과 같은 판단이다(layout.jsx): 사람이 옮겨 적으면서 띄어쓰기가 흔들린다.
export const titleKey = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');

export function matchSubtask(item, subtasks) {
  const key = titleKey(item?.what);
  if (!key) return null;
  return (subtasks || []).find(t => titleKey(t?.title) === key) || null;
}
