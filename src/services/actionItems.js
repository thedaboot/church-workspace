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
// 2026-09-22에 `누가 무엇을 언제까지` → `청년별 업무`로 바꿨다(사용자 결정).
// **옛 이름도 계속 읽는다** — 이미 그 제목으로 다듬어 저장된 회의록이 있고, 이름을
// 바꿨다고 그 카드의 줄이 사라지면 안 된다. 앞엣것이 새로 쓰는 이름이다.
export const ACTION_HEADINGS = ['청년별 업무', '누가 무엇을 언제까지'];
export const ACTION_HEADING = ACTION_HEADINGS[0];

// 가운뎃점은 우리 글에서 항목을 가르는 표다(화면 곳곳이 그렇다). 모델이 어길 때를
// 대비해 빗금·하이픈도 받는다 — 못 가르면 줄 전체를 '무엇을'로 둔다(이름 없이).
const SEP = /\s*[·|/]\s*|\s+[-–]\s+/;
const MONTH_DAY = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const ISO_DAY = /(\d{4})-(\d{2})-(\d{2})/;

const clean = (v) => String(v || '').trim();
// 멘션 표기(@이름)와 굵게·형광펜 표시를 걷어 이름만 남긴다
const plainName = (v) => clean(v).replace(/^@/, '').replace(/\*\*|==/g, '').trim();

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
  // 기준일보다 반년 넘게 지난 날짜면 다음 해로 본다(회의록은 앞일을 적는다)
  const diffDays = (Date.parse(`${same}T00:00:00Z`) - Date.parse(`${base.toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000;
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
    // 이름은 **첫 도막이 사람처럼 보일 때만** 쓴다 — @표기이거나 짧은 글자다.
    // 아니면 이름 없이 통째로 '무엇을'이다(모델이 한 문장으로 적은 경우).
    const head = parts[0] || '';
    const named = parts.length > 1 && (head.startsWith('@') || plainName(head).length <= 6);
    const name = named ? plainName(head) : '';
    const rest = named ? parts.slice(1) : parts;
    const dueText = rest.length > 1 && (MONTH_DAY.test(rest[rest.length - 1]) || ISO_DAY.test(rest[rest.length - 1]))
      ? rest[rest.length - 1] : '';
    const what = (dueText ? rest.slice(0, -1) : rest).join(' · ').replace(/\*\*|==/g, '').trim();
    if (!what) continue;
    out.push({ name, what, dueText, dueDate: isoOf(dueText || body, now), raw: body });
  }
  return out;
}

// 이 항목이 이미 하위 업무가 되었나 — 제목 글자로 견준다(띄어쓰기·대소문자를 접는다).
// 통합 검색의 norm과 같은 판단이다(layout.jsx): 사람이 옮겨 적으면서 띄어쓰기가 흔들린다.
export const titleKey = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');

export function matchSubtask(item, subtasks) {
  const key = titleKey(item?.what);
  if (!key) return null;
  return (subtasks || []).find(t => titleKey(t?.title) === key) || null;
}
