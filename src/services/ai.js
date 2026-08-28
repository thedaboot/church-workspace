import { supabase } from './supabaseClient.js';
import { store } from '../store/workspaceStore.js';
import { extractMentions, MENTION_TAIL } from '../utils.js';

// ============================================================================
// 6-2. AI Service Layer — /api/ai 서버 프록시 경유 (API 키는 서버에만)
// ----------------------------------------------------------------------------
// **배경 지식의 원본은 `docs/AI.md`다.** 사람·예배 순서·지출 절차가 바뀌면 그 문서와
// 이 파일을 같이 고친다. 여기 있는 상수는 그 문서를 프롬프트 모양으로 옮긴 것이다.
// ============================================================================

// 사람의 팀과 역할은 **DB에서 온다**(profiles.team_id · profile_teams · role_note, 0030).
// 여기에 이름을 적지 않는 이유가 둘이다 —
//   · 표시명으로 매달면 개명할 때 끊긴다(지금 '말감이'는 임재훈으로 바뀔 수 있다),
//   · 이 레포는 공개라서 id로 매달면 교인 uuid가 공개 레포에 남는다.
// 그래서 여기에는 **규칙과 팀 소관만** 둔다.
const ORG_CONTEXT = [
  '[우리 청년부]',
  '- 청년부는 약 40명이다. **워크스페이스 가입자가 청년부 전부가 아니다** — 여기 없는 사람이 더 많다.',
  '- 팀은 일곱이다: 교역자 · 임원진 · 찬양팀 · 워십팀 · 웰컴팀 · 미디어팀 · 엔지니어팀.',
  '  · 찬양팀 — 싱어와 연주(일렉·베이스 등). 콘티와 송폼을 만들고 리허설을 한다.',
  '  · 워십팀 — 앞에서 안무를 하는 팀이다. **찬양팀과 다른 팀이다.** 아직 지원자가 없어 거의 TF로 운영 중이다.',
  '  · 엔지니어팀 — 예배용 PPT를 만들고 조명·사운드를 맡는다. 카운트다운 영상을 트는 것도 이 팀이다.',
  '  · 미디어팀 — 카운트다운 영상과 포스터류를 만든다. 광고 이미지는 만들지 않는다.',
  '  · 웰컴팀 — 명단 정리 · 안내 동선 · 물품 준비 · 당일 접수와 안내.',
  '  · 임원진·교역자 — 기획과 예산 승인, 팀·순 배분, 진행 점검.',
  '- **순과 조는 다르다.** 순은 1년을 가져가는 단위이고 순장이 이끈다. 조는 수련회 때만 짜는 단위다(예: 민준조·서진조). 둘을 섞어 쓰지 마라.',
  '- 더다붓 — 작년 "다붓"에서 왔다. "다붓하다"는 매우 가깝게 붙어 있다는 뜻이고, 더다붓은 "더 다붓해지자"는 뜻이다. The다붓으로도 쓴다.',
  '호칭 규칙:',
  '- 아래 "[이 업무에 관련된 사람]" 목록에 적힌 직함으로 불러라(예: 조해리 → 조해리 총무님).',
  '- 한 사람이 두 직함을 가질 수 있다. 맥락에 맞는 쪽을 골라라.',
  '- **그 목록에 없는 이름은 직함을 지어내지 마라.** 기본은 "OOO 청년"이고, 소속 팀을 알 수 있으면 "웰컴팀 OOO 청년"처럼 팀을 앞에 붙여라.',
].join('\n');

// 교회 일정의 리듬. 이게 없으면 AI는 마감일을 그냥 숫자로 본다 — 마감이 일요일이면
// 그건 대개 "예배 당일"이라는 뜻인데 그걸 모르고 "주말까지 여유가 있다"고 말한다.
// 시간은 **대략**이다. 딱딱 지켜지는 것이 아니라 흐름과 구조로만 쓴다(사용자 확인).
const CHURCH_CALENDAR_CONTEXT = [
  '[교회 일정의 기본 리듬]',
  '주일 4부 청년 예배 — 13:30 시작 · 3층 본당(은혜샘채플). 청년들은 "3층 본당"으로 부른다.',
  '  11:30~12:30  임원진(리더) 모임 — 광고에서 나눌 내용과 지난주 피드백을 정한다',
  '  13:00~13:20  찬양팀 리허설 (같은 시간에 엔지니어팀이 예배용 PPT·조명·사운드를 점검한다)',
  '  13:20~13:25  예배 담당자들이 기도로 예배를 준비한다',
  '  13:25~13:30  카운트다운 영상 5분 (미디어팀이 만들고 엔지니어팀이 튼다)',
  '  13:30~14:00  찬양     14:00~14:30  설교',
  '  14:30~14:40  적용 찬양 및 봉헌',
  '  14:40~14:50  축복     14:50~15:00  광고',
  '  예배 후 순모임 ~16:30',
  '달마다 달라지는 것:',
  '  · 둘째 주는 성찬 예배다 — 설교 뒤에 성찬(14:30~14:40) → 봉헌 → 축복 → 광고로 흐른다.',
  '    이 주는 순모임을 16:00까지 하고, 그 뒤 월례회를 한다(리더·순장·팀장·교역자·임원진 대상).',
  '  · 마지막 주에는 Q예배(Question 예배)가 있다 — 담당 교역자가 한 달간의 예배를 정리해 준다.',
  '    대신 특별한 2부 순서가 들어갈 때도 있어 고정은 아니다.',
  '주중:',
  '  · 금요 열정 예배 — 금요일 20:00~22:00',
  '  · 찬양팀 연습 — 토요일 13:00~15:00. **보통 토요일에는 이것만 있다.**',
  '    아주 큰 행사가 있을 때에만 그 전날에 준비가 몰린다.',
  '주일 예배를 향한 준비 마감:',
  '  · 찬양 콘티는 그 전주 목요일에 나온다.',
  '  · 그 콘티의 송폼은 전주 금요일까지 나온다.',
  '절기·큰 행사: 설·추석 / 부활절(3~4월) / 여름 수련회(7~8월) / 추수감사절(11월) /',
  '  성탄절(12월) / 송구영신 예배(12월 31일).',
  '달력 관련 규칙:',
  '- 날짜에는 요일이 괄호로 붙어 있다. 정기 예배와 겹치면 "주일 4부 청년 예배", "금요 열정 예배"로 불러라.',
  '- 마감이 주일이고 그 업무가 예배에 쓰이는 것이면, 준비는 그 전날까지라는 것을 전제해라.',
  '- **위 목록에 없는 절기나 행사를 지어내지 마라.** 시간은 대략이니 분 단위로 따지지 마라.',
].join('\n');

// 돈이 도는 절차는 **여기에 적지 않는다.** 회계 담당자가 워크스페이스 안에
// ['회계 인수인계' 프로젝트 / '메뉴얼' 업무]로 정리해 두었고 그쪽이 정본이다
// (사용자 결정 2026-08-28 — "굳이 프롬프트로 안 심고"). 프롬프트에 베껴 두면
// 절차가 바뀔 때마다 두 군데가 어긋난다. 실제로 한 번 어긋났다 — 결재를 "두 분"으로
// 적어 두었는데 메뉴얼에는 결재란이 다섯 칸(작성자·회장·부장·지도교역자·교육위원회)이었다.
const BUDGET_CONTEXT = [
  '[돈이 걸린 업무]',
  '- 예산 신청 · 영수증 처리 · 가결산/결산 보고 · 수련회 정산 · 이월 절차는',
  "  워크스페이스의 '회계 인수인계' 프로젝트 안 '메뉴얼' 업무에 정리되어 있다. **그 업무가 정본이다.**",
  '- 결재 순서·제출 기한·환입 기준 같은 것을 **지어내지 마라.** 모르면 그 업무를 확인하라고 안내해라.',
  '- 예산·영수증·정산이 걸린 업무의 "챙길 것"이나 "다음 단계"를 쓸 때는',
  "  \"'회계 인수인계'의 '메뉴얼' 업무에 정리된 절차대로\"처럼 그 자리를 짚어 주면 된다.",
].join('\n');

// 사역 업무의 일반적인 진행 순서. "다음 단계"가 지금 업무를 되풀이하지 않고
// 실제로 이어질 일을 짚게 하는 데 쓴다(예: 콘티 확정 → 송폼·악보 제작 → 연습 → 리허설).
const FLOW_CONTEXT = [
  '[사역별 일반 진행 순서]',
  '- 찬양·워십: 곡 선정 → 콘티 확정 → 송폼 제작 → 파트별 연습 → 전체 연습 → 사운드 체크·리허설 → 본 예배/집회',
  '- 미디어: 컨셉 논의 → 디자인 시안 → 시안 확정 → 제작/인쇄 → 업로드',
  '- 엔지니어: 장비 점검 → PPT 제작 → 세팅 → 사운드/조명 체크 → 리허설 → 당일 운영',
  '- 웰컴: 참가 명단 정리 → 안내 동선 → 물품 준비 → 당일 접수/안내',
  '- 임원진·교역자: 리더 모임 → 기획/예산 승인 → 각 팀/순 배분 → 진행 점검 → 마무리 보고',
].join('\n');

// 문구 톤 — HANDOFF §8이 사람에게 요구하는 것을 AI에게도 그대로 요구한다.
// 요약은 카드에 고정돼 워크스페이스에 남는 글이라, 사람이 쓴 문구와 같은 규칙을 받아야 한다.
// 예전에는 대시 금지 한 줄만 있었다.
const TONE_RULES = [
  '문구 톤(반드시 지켜라):',
  '- 담백하게, 상태를 그대로 말해라. 번역투를 쓰지 마라.',
  '- **누가 누구와 견주는 표현을 절대 쓰지 마라.** "내 것에는 없다"는 곧 "남의 것에는 있다"로 읽힌다.',
  '  이 화면은 같이 사역하는 사람들이 본다.',
  '- 판정하는 말(부하, 과부하, 병목, 지지부진, 뒤처짐)을 쓰지 마라.',
  '- "없어요"로 끝나는 짧은 부정 표현을 피해라(예: "마감 없음" 대신 "마감 미정").',
  '- 문장 안에서 엠 대시(—)나 엔 대시(–)는 절대 쓰지 마라. 필요하면 일반 하이픈(-)을 써라.',
  '- "핵심"이라는 단어는 절대 쓰지 마라.',
].join('\n');

// 대시 표기 규칙 — 엠/엔 대시는 쓰지 않는다(사용자 요청). TONE_RULES에도 들어 있지만,
// 다듬기처럼 톤 전체를 싣지 않는 자리에서도 이 줄만은 붙는다.
const DASH_RULE = '- 문장 안에서 엠 대시(—)나 엔 대시(–)는 절대 쓰지 마라. 필요하면 일반 하이픈(-)을 써라.';

// ── 날짜 ────────────────────────────────────────────────────────────────────
// 날짜에 요일을 붙인다 — AI가 ISO 문자열만 보고 요일을 맞히지 못한다.
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const withDow = (iso) => {
  if (!iso) return iso;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${iso}(${DOW[d.getDay()]})`;
};
// 로컬 기준 YYYY-MM-DD. toISOString()은 UTC라 한국 시간 오전 9시 이전에 어제가 된다.
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAY_MS = 86400000;
const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(`${toIso}T00:00:00`) - new Date(`${fromIso}T00:00:00`)) / DAY_MS);
// "마감까지 3일 남음" / "마감이 2일 지남" / "마감 당일" — 오늘을 줘야 AI가 급한지 안다.
function duePhrase(dueIso, todayIso) {
  if (!dueIso) return '마감 미정';
  const gap = daysBetween(todayIso, dueIso);
  if (Number.isNaN(gap)) return '';
  if (gap === 0) return '마감 당일';
  return gap > 0 ? `마감까지 ${gap}일 남음` : `마감이 ${-gap}일 지남`;
}

// ── 한 줄 표기 ──────────────────────────────────────────────────────────────
const fmtTask = (t) => [
  t.title,
  t.status,
  t.teams?.length ? t.teams.join('·') : '팀 미지정',
  t.assignees?.length ? t.assignees.join(', ') : '담당자 미지정',
  [t.startDate, t.dueDate].filter(Boolean).map(withDow).join('~') || '일정 없음',
].join(' | ');

const NEARBY_LIMIT = 12;        // 같은 프로젝트
const OTHER_ACTIVE_LIMIT = 8;   // 다른 프로젝트에서 지금 돌아가는 일
const ARCHIVE_LIMIT = 6;        // 같은 팀이 예전에 끝낸 일
const EXCERPT_FILES = 3;        // 발췌를 실을 첨부 개수
const EXCERPT_TOTAL = 3000;     // 발췌 합계 글자 상한

// 이 업무에 **실제로 등장하는 사람만** 고른다. 조직표 전체를 매번 싣지 않는다
// (사용자 결정 — 가입자가 14명에서 140명이 돼도 프롬프트가 커지지 않는다).
// 등장의 정의: 담당자 · 선행/후행 업무의 담당자 · 본문과 댓글에서 @로 불린 사람.
export function peopleContext(task, related, { withMention = false } = {}) {
  const members = store.getState().members || [];
  if (!members.length) return '';            // 게스트 모드에는 사람 목록이 없다
  const names = new Set();
  const add = (arr) => (arr || []).forEach(n => n && names.add(n));
  add(task.assignees);
  (related || []).forEach(t => add(t.assignees));
  const said = [task.content || '', ...(task.comments || []).map(c => c?.text || '')].join('\n');
  extractMentions(said).forEach(n => names.add(n));
  const picked = members.filter(m => names.has(m.name));
  if (!picked.length) return '';
  return [
    '[이 업무에 관련된 사람]',
    ...picked.map(m => [
      m.name,
      m.teams?.length ? m.teams.join('·') : (m.team || '팀 미지정'),
      m.role || '직함 없음',
      withMention ? `멘션은 @${m.name}` : '',
    ].filter(Boolean).join(' | ')),
  ].join('\n');
}

// AI가 쓴 멘션을 검사한다. 멘션은 표시명 **정확 일치**로만 사람을 찾으므로
// (cloudSync.resolveMentionRecipients), 표시명이 아닌 이름에 @를 붙이면 그 멘션은
// 아무에게도 안 가고 본문에 죽은 채로 남는다. 안 맞는 것은 @를 떼어 평범한 이름으로
// 되돌린다 — 개명 직후처럼 표시명과 실제 이름이 어긋나는 때에 걸린다.
export function sanitizeMentions(text, knownNames) {
  const known = new Set(knownNames || (store.getState().members || []).map(m => m.name));
  return String(text || '').replace(/@([^\s@]+)/g, (whole, token) => {
    const tail = (token.match(MENTION_TAIL) || [''])[0];
    const name = tail ? token.slice(0, token.length - tail.length) : token;
    return known.has(name) ? whole : `${name}${tail}`;
  });
}

export function buildTaskContext(task, now = new Date()) {
  const today = isoOf(now);
  const s = store.getState();
  const project = s.projects.byId[task.projectId];
  const byId = s.tasks.byId;
  const all = (s.tasks.allIds || []).map(id => byId[id]).filter(Boolean);
  const siblings = all.filter(t => t.projectId === task.projectId && t.id !== task.id);
  // 같은 팀을 공유하는 업무가 조율 상대일 확률이 높다 → 그걸 먼저, 나머지는 일정 순
  const myTeams = new Set(task.teams || []);
  const sharesTeam = (t) => (t.teams || []).some(x => myTeams.has(x));
  const shared = siblings.filter(sharesTeam);
  const rest = siblings.filter(t => !shared.includes(t));
  const byDate = (a, b) => String(a.dueDate || a.startDate || '9999').localeCompare(String(b.dueDate || b.startDate || '9999'));
  const picked = [...shared.sort(byDate), ...rest.sort(byDate)].slice(0, NEARBY_LIMIT);

  // 선후관계(§4.9)가 날짜 추측보다 정확한 "다음 단계"다 —
  //  · 선행: 이 업무가 기다리는 업무(끝나야 시작할 수 있다)
  //  · 후행: 이 업무를 기다리는 업무(이 업무가 끝나면 저기로 넘어간다)
  const depTasks = (task.dependsOn || []).map(id => byId[id]).filter(Boolean);
  const blockedBy = siblings.filter(t => (t.dependsOn || []).includes(task.id));
  // 후행이 없을 때만 날짜로 짐작한다(예전 방식) — 연결이 있으면 그쪽이 답이다
  const after = !blockedBy.length && task.dueDate
    ? picked.filter(t => String(t.dueDate || t.startDate || '') > task.dueDate).map(t => t.title)
    : [];

  // 다른 프로젝트 — 재료는 listAllCards가 이미 스토어에 다 올려 두었다(네트워크 0).
  //  ⓐ 지금 돌아가는 일: 다른 프로젝트의 미완료 업무. 팀이 겹치는 것을 앞에 둔다.
  //  ⓑ 아카이브: 같은 팀이 **예전에 끝낸** 업무. "작년엔 이 시점에 뭘 했나"가 여기서 온다.
  const others = all.filter(t => t.projectId !== task.projectId);
  const projName = (t) => s.projects.byId[t.projectId]?.title || s.projects.byId[t.projectId]?.name || '다른 프로젝트';
  const otherActive = [
    ...others.filter(t => t.status !== '완료' && sharesTeam(t)).sort(byDate),
    ...others.filter(t => t.status !== '완료' && !sharesTeam(t)).sort(byDate),
  ].slice(0, OTHER_ACTIVE_LIMIT);
  const archive = others
    .filter(t => t.status === '완료' && sharesTeam(t))
    .sort((a, b) => String(b.dueDate || b.startDate || '').localeCompare(String(a.dueDate || a.startDate || '')))
    .slice(0, ARCHIVE_LIMIT);

  // 첨부는 이름과 발췌 — "포스터_시안2.png"가 있으면 시안 단계라는 뜻이고,
  // 문서라면 안에 든 글이 더 정확하다(files.text_excerpt, 0030). 사진은 발췌가 없다.
  // 클라우드에서 목록을 아직 안 받았으면 개수(fileCount)라도 준다.
  const atts = (task.attachments || []).map(a => (typeof a === 'string' ? { name: a } : a)).filter(a => a?.name);
  const fileLine = atts.length
    ? `- 첨부 파일 ${atts.length}개: ${atts.slice(0, 10).map(a => a.name).join(', ')}${atts.length > 10 ? ' 외' : ''}`
    : (task.fileCount ? `- 첨부 파일 ${task.fileCount}개(이름 미확인)` : '');
  // 첨부 행은 DB 모양 그대로 스토어에 들어간다(snake_case) — 화면·미리보기가 그렇게 읽는다
  let budget = EXCERPT_TOTAL;
  const excerpts = atts
    .filter(a => a.text_excerpt)
    .slice(0, EXCERPT_FILES)
    .map(a => {
      if (budget <= 0) return '';
      const body = String(a.text_excerpt).slice(0, budget);
      budget -= body.length;
      return `  · ${a.name}: ${body}`;
    })
    .filter(Boolean);

  // 하위 업무 — 끝난 것과 남은 것을 갈라서 준다. 남은 것만 주면 AI가 이미 끝낸 일을
  // 다시 "챙길 것"으로 올린다(사용자 요청 2026-08-28).
  const subs = task.subtasks || [];
  const subDone = subs.filter(x => x.done).map(x => x.text).filter(Boolean);
  const subLeft = subs.filter(x => !x.done).map(x => x.text).filter(Boolean);
  const subLine = subs.length
    ? [`- 하위 업무 ${subDone.length}/${subs.length} 완료`,
       subDone.length ? `끝낸 것: ${subDone.slice(0, 8).join(', ')}` : '',
       subLeft.length ? `남은 것: ${subLeft.slice(0, 8).join(', ')}` : ''].filter(Boolean).join(' · ')
    : '';

  // 프로젝트 진척 — 제목만 주면 이 업무가 프로젝트의 어디쯤인지 AI가 모른다
  const inProject = siblings.length + 1;
  const doneInProject = siblings.filter(t => t.status === '완료').length + (task.status === '완료' ? 1 : 0);
  const projLine = project
    ? `- 소속 프로젝트: ${project.title || project.name} (업무 ${doneInProject}/${inProject} 완료)`
    : '';

  return [
    `[오늘] ${withDow(today)}`,
    '',
    '[지금 이 업무의 주변 상황]',
    projLine,
    `- 이 업무: ${fmtTask(task)} | ${duePhrase(task.dueDate, today)}`,
    subLine,
    fileLine,
    excerpts.length ? ['- 첨부 파일 안의 글(앞부분만):', ...excerpts].join('\n') : '',
    depTasks.length ? `- 이 업무의 선행 업무(먼저 끝나야 함): ${depTasks.map(t => `${t.title}(${t.status})`).join(', ')}` : '',
    blockedBy.length ? `- 이 업무를 기다리는 후행 업무: ${blockedBy.map(t => `${t.title}(${t.teams?.join('·') || '팀 미지정'} · ${t.assignees?.join(', ') || '담당자 미지정'})`).join(', ')}` : '',
    '- 같은 프로젝트의 다른 업무 (제목 | 상태 | 담당 팀 | 담당자 | 일정):',
    picked.length ? picked.map(t => `  · ${fmtTask(t)}${(t.dependsOn || []).includes(task.id) ? ' | ★이 업무를 기다림' : ''}`).join('\n') : '  · (없음)',
    after.length ? `- 이 업무 마감 이후에 놓인 업무: ${after.join(', ')}` : '',
    otherActive.length
      ? ['', '[다른 프로젝트에서 지금 돌아가는 일]', ...otherActive.map(t => `  · ${projName(t)} / ${fmtTask(t)}`)].join('\n')
      : '',
    archive.length
      ? ['', '[같은 팀이 예전에 끝낸 업무 — 그때 어떻게 했는지 참고하라]',
         ...archive.map(t => `  · ${projName(t)} / ${fmtTask(t)}`)].join('\n')
      : '',
  ].filter(Boolean).join('\n');
}

// 호출이 안 된 경우 화면에 그대로 보여주는 안내 문구. 상수로 둔 이유는 요약 캐시가
// "이건 모델 답이 아니다"를 알아야 하기 때문이다 — 안내 문구를 캐시에 넣으면
// 로그인한 뒤에도 계속 "로그인 후 사용할 수 있어요"가 나온다.
const MSG = {
  needLogin: 'AI 기능은 로그인 후 사용할 수 있어요.',
  needDeploy: 'AI 기능은 배포 환경에서 동작해요 (로컬은 `npx vercel dev` 필요).',
  needKey: 'AI 기능이 아직 설정되지 않았어요 (관리자에게 GEMINI_API_KEY 설정을 요청하세요).',
  failed: '오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
};
const FALLBACKS = new Set(Object.values(MSG));
// **부르는 쪽이 반드시 이걸로 걸러야 한다.** 안내 문구도 truthy한 문자열이라, 그냥
// 받아서 본문에 넣으면 쓰던 글이 "AI 기능은 로그인 후…" 한 줄로 갈아치워진다.
// 다듬기에서 실제로 그랬다(2026-08-28에 고쳤다).
export const isFallbackText = (text) => FALLBACKS.has(text);

// 요약 캐시 — 같은 카드를 다시 열거나 요약을 두 번 누르면 그대로 돌려준다.
// 예전에는 사람 열 명이 같은 카드를 열면 열 번 과금됐다. 키에 updatedAt을 넣어서
// 카드가 바뀌면 자동으로 무효가 된다.
// ponytail: 탭을 닫으면 사라지는 메모리 캐시다. 사람들 사이에 공유하려면 카드에
// 저장해야 하고, 그건 '이 요약 고정' 버튼이 하는 일이다(저장은 옵트인).
const summaryCache = new Map();
// 키에 하위 업무 체크 상태도 넣는다 — updatedAt은 서버 왕복이 돌아와야 바뀌어서,
// 체크하고 곧바로 다시 요약을 누르면 체크 전 요약이 캐시에서 나왔다. 요약이
// 끝낸 것/남은 것을 갈라 말하는 이상 체크 하나가 답을 바꾼다(사용자 강조 2026-08-29).
const subsFingerprint = (task) => (task.subtasks || []).map(x => (x.done ? '1' : '0')).join('');
const summaryKey = (task) => `${task.id || 'new'}:${task.updatedAt || ''}:${subsFingerprint(task)}`;

export const AiService = {
  callGemini: async (prompt, systemInstruction = "") => {
    // 게스트 모드(수파베이스 미설정) → 로그인 안내
    if (!supabase) return MSG.needLogin;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return MSG.needLogin;

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt, systemInstruction }),
      });
      // 로컬 vite dev에는 서버 함수가 없어 404 → 안내
      if (response.status === 404) return MSG.needDeploy;
      if (response.status === 501) return MSG.needKey;
      if (!response.ok) {
        console.error("AI 프록시 오류:", response.status, await response.text().catch(() => ''));
        return MSG.failed;
      }
      const result = await response.json();
      return result.text || "";
    } catch (error) {
      console.error("AI 요청 실패:", error);
      return MSG.needDeploy;
    }
  },
  // 캐시를 비우는 손잡이 — 카드를 저장한 뒤처럼 강제로 다시 만들어야 할 때
  clearSummaryCache: () => summaryCache.clear(),

  summarizeTask: async (task) => {
    const cached = summaryCache.get(summaryKey(task));
    if (cached) return cached;
    const commentsText = (task.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const meta = [
      task.assignees?.length ? `담당자: ${task.assignees.join(', ')}` : '',
      task.dueDate ? `마감일: ${task.dueDate}` : '',
    ].filter(Boolean).join(' · ');
    const related = [...(task.dependsOn || []).map(id => store.getState().tasks.byId[id]).filter(Boolean)];
    const prompt = [
      `업무 제목: ${task.title}`,
      `상세 내용: ${task.content || '(없음)'}`,
      meta && `[정보] ${meta}`,
      `\n[댓글 타임라인]\n${commentsText || '(댓글 없음)'}`,
      '',
      buildTaskContext(task),
      '',
      peopleContext(task, related),
      '\n위 업무를 아래 형식에 맞춰 요약해줘.',
    ].filter(Boolean).join('\n');
    const sysPrompt = [
      '너는 더다붓(교회 청년부) 워크스페이스의 요약 도우미야. 팀원들이 읽자마자 바로 움직일 수 있게 요약해.',
      '',
      '출력 형식(정확히 이 3줄, 다른 말 붙이지 마):',
      '1. **현황** - 한 문장',
      '2. **챙길 것** - 한 문장',
      '3. **다음 단계** - 한 문장',
      '',
      '규칙:',
      '- 라벨과 문장 사이는 일반 하이픈 하나("- ")로만 구분해라.',
      '- 각 줄은 딱 한 문장, 존댓말 간결체(~해요/~예요체).',
      '- 예배·전도·수련회·양육 같은 사역 맥락과 용어를 자연스럽게 살려라.',
      '- 내용이 빈약하면 지어내지 말고 있는 것만 담백하게 적어라.',
      '- "챙길 것"에는 남은 하위 업무·선행 업무가 있으면 그걸 먼저 써라. **이미 끝낸 하위 업무를 다시 챙기라고 하지 마라.**',
      '  첨부 파일 이름이나 그 안의 글이 단계를 알려주면(예: 시안, 견적서, 최종본) 그 단계에 맞게 말해라.',
      '- 사람을 부를 때 @를 붙이지 마라. 요약에서는 이름과 직함으로만 부른다.',
      '',
      TONE_RULES,
      '',
      '"다음 단계" 규칙 (가장 중요):',
      '- 이 업무가 끝난 뒤 이어질 행동을 써라. 이 업무를 마감일까지 끝내라는 말은 절대 쓰지 마라',
      '  (예: 콘티 확정 업무에서 "마감일까지 콘티를 확정해 주세요"는 틀린 답이다).',
      '- 1순위: "이 업무를 기다리는 후행 업무"가 있으면 그 업무를 지목하고, 그 담당 팀·담당자를 함께 불러라',
      '  (선후관계는 팀원이 직접 연결한 것이라 날짜 추측보다 정확하다).',
      '- 2순위: 후행 연결이 없으면 "이 업무 마감 이후에 놓인 업무"를 지목하고, 그 담당 팀·담당자를 함께 불러라.',
      '- 3순위: 이어질 업무가 목록에 없으면 사역별 진행 순서에서 바로 다음 단계 하나만 제안해라',
      '  (예: 콘티 확정 → 악보·송폼 제작이나 파트별 연습 일정 잡기).',
      '- 담당 팀이 둘 이상이면 팀 사이에 무엇을 넘겨주고 받아야 하는지 한 마디로 적어라',
      '  (예: 찬양팀이 확정한 콘티를 엔지니어팀에 넘겨 사운드 세팅을 준비해요).',
      '- 이 업무가 이미 완료 상태면 다음 단계는 후속 업무나 인수인계로 써라.',
      '- "같은 팀이 예전에 끝낸 업무"가 주어지면 그때의 순서를 참고해라. 다만 그 업무를 지금 할 일처럼 쓰지는 마라.',
      '',
      FLOW_CONTEXT,
      '',
      CHURCH_CALENDAR_CONTEXT,
      '',
      BUDGET_CONTEXT,
      '',
      ORG_CONTEXT,
    ].join('\n');
    const text = await AiService.callGemini(prompt, sysPrompt);
    // 안내 문구는 캐시에 넣지 않는다 — 로그인하거나 배포된 뒤에도 계속 그 문구가 나온다
    if (text && !FALLBACKS.has(text)) summaryCache.set(summaryKey(task), text);
    return text;
  },
  // task를 넘기면 주변 상황(같은 프로젝트 업무·팀·담당자)을 배경 지식으로 함께 준다.
  // 내용을 늘리라는 뜻이 아니라, 사람·팀 이름을 맞게 부르고 엉뚱한 다음 단계를 만들지 않게 하려는 것.
  polishText: async (text, task = null) => {
    const prompt = [
      '아래는 팀원이 카드에 쓴 초안이야. 더다붓 카드 본문 형식으로 다듬어줘. 내용·의도·수량·링크·메모는 하나도 빼지 마.',
      '',
      '---예시 1 (대충 쓴 짧은 메모)---',
      'before:',
      '수련회 조편성 아직 안됨 인원 42명 리더 5명 방배정도 해야하고 버스는 25인승 2대 예약함 김집사님한테 견적 받기',
      'after:',
      '### 수련회 준비 현황',
      '- 참가 인원 **42명**, 리더 **5명**',
      '- 버스: 25인승 **2대** 예약 완료',
      '',
      '### 남은 일',
      '- ==조 편성== (아직 정하지 못했어요)',
      '- 방 배정',
      '- 김집사님께 견적 받기',
      '',
      '---예시 2 (쇼핑 링크 나열)---',
      'before:',
      '간식 이거 https://smartstore.naver.com/main/products/1234567?query=abc 20봉지 그리고 포장지 https://www.coupang.com/vp/products/999?itemId=88 이건 50장',
      'after:',
      '### 간식',
      '- [초코파이 대용량_네이버](https://smartstore.naver.com/main/products/1234567?query=abc) **20봉지**',
      '',
      '### 포장지',
      '- [선물 포장지_쿠팡](https://www.coupang.com/vp/products/999?itemId=88) **50장**',
      '',
      '---예시 3 (회의록 · 피드백 및 강평회)---',
      'before:',
      '8/24 강평회 함 참석 민경 준환 해리 지호 카운트다운 늦게 시작한거 지적나옴 다음주부터 25분에 딱 틀기로 함 송폼 오타 있었대서 해리가 다시 보기로 조명 어두웠다는 얘기 있었는데 결론 못냄 다음 강평회때 다시',
      'after:',
      '### 8월 24일 피드백 및 강평회',
      '- 참석: 정민경 리더순장님, 조준환 예배팀장님, 조해리 총무님, 박지호 리더팀장님',
      '',
      '### 정한 것',
      '- 카운트다운 영상을 ==13시 25분에 정확히 시작==하기로 했어요 (다음 주부터)',
      '- 송폼 오타는 @조해리 님이 다시 확인하기로 했어요',
      '',
      '### 아직 정하지 못한 것',
      '- 조명이 어두웠다는 의견이 있었고, ==다음 강평회에서 다시 다루기로== 했어요',
      '---예시 끝---',
      '',
      task ? '\n' + buildTaskContext(task) : '',
      '',
      task ? peopleContext(task, [], { withMention: true }) : '',
      '',
      '이제 아래 초안을 다듬어줘:',
      '',
      text,
    ].filter(Boolean).join('\n');
    const sysPrompt = [
      '너는 더다붓(교회 청년부) 워크스페이스의 카드 정리 도우미야.',
      '청년부 팀원이 아무렇게나 쓴 초안(짧은 메모, 대충 나열, 구어체, 회의록, 어딘가에서 복붙한 긴 텍스트 등)을 더다붓 카드 본문 형식으로 잘 구조화하는 게 목적이야.',
      '',
      '반드시 지켜:',
      '- 원문의 내용·의도·수량·가격·메모·고민 포인트·링크는 절대 삭제하지 마라. 다듬는 거지 요약이 아니다.',
      '- 우리 마크다운 서브셋만 써라: #~#### 제목, - 불릿, 1. 번호, **굵게**, ==형광펜==, [이름](URL) 링크. 표와 코드블록은 쓰지 마라.',
      '- 긴 쇼핑/상품 URL은 반드시 `[상품명_쇼핑몰](원본URL)` 한 줄 링크로 축약해라. 쿼리스트링까지 원본 URL 그대로 링크 안에 넣어라.',
      '- 성격이 다른 묶음(예: 포장지/간식/안내문/남은 일)은 ### 제목으로 섹션을 나눠라.',
      '- 톤은 청년부 팀원에게 말하듯 간결하고 친근하게. 과한 격식은 빼라.',
      '- 이모지는 원문에 있던 것만 유지하고 새로 넣지 마라.',
      '- 원문이 이미 깔끔하면 억지로 뜯어고치지 말고 형식만 살짝 정돈해라.',
      '',
      '강조는 두 가지를 갈라 써라:',
      '- **굵게**는 숫자다 — 수량·가격·인원·날짜.',
      '- ==형광펜==은 판단이다 — 정해진 것, 아직 막혀 있는 것.',
      '- **형광펜은 한 문서에 두세 곳까지.** 온 데 칠하면 강조가 아니라 배경이 된다.',
      '',
      '회의록(강평회·리더 모임·기획 회의)이면 이 구조로 정리해라:',
      '- 언제 · 누가 모였는지',
      '- "정한 것"',
      '- "아직 정하지 못한 것"',
      '- "누가 무엇을 언제까지" (이게 그대로 하위 업무 후보가 된다)',
      '',
      '우리가 쓰는 말로 바꿔라(다른 말로 바꾸지 마라):',
      '- 예배당·본당 → 3층 본당    미팅·회의 → 리더 모임(임원진 모임일 때)',
      '- 주일예배·4부 → 주일 4부 청년 예배    금요예배 → 금요 열정 예배',
      '- 셀·소그룹 → 순    조는 수련회 때만 쓰는 말이다',
      '- 곡 순서 → 콘티    악보 양식 → 송폼',
      '',
      '멘션:',
      '- 사람이 원문에 등장하면 "[이 업무에 관련된 사람]"에 적힌 **멘션 표기 그대로** @를 붙여 불러라.',
      '  표기가 이름과 다를 수 있다(예: 이시온을 @시온으로 부른다). 적힌 대로 써라.',
      '- **원문에 나오지 않은 사람은 멘션하지 마라.** 멘션은 그 사람에게 알림을 보낸다.',
      '- 목록에 없는 사람에게는 @를 붙이지 마라. 그냥 이름으로 써라.',
      DASH_RULE,
      '- "핵심"이라는 단어는 절대 쓰지 마라.',
      '',
      '주변 상황(같은 프로젝트의 다른 업무·담당 팀·담당자)이 함께 주어지면:',
      '- 원문에 등장하는 사람·팀을 그 정보에 맞게 정확히 불러라.',
      '- 원문이 "남은 일"을 적고 있으면, 다른 팀에 넘겨야 하는 것과 받아야 하는 것을 원문 범위 안에서 분명히 적어라.',
      '- 주변 상황에서 알게 된 사실을 새 항목으로 추가하지는 마라. 다듬기지 작성이 아니다.',
      '',
      FLOW_CONTEXT,
      '',
      CHURCH_CALENDAR_CONTEXT,
      '',
      BUDGET_CONTEXT,
      '',
      ORG_CONTEXT,
    ].join('\n');
    const out = await AiService.callGemini(prompt, sysPrompt);
    // 안내 문구는 그대로 돌려준다 — 부르는 쪽이 isFallbackText로 걸러 본문을 지킨다.
    return isFallbackText(out) ? out : sanitizeMentions(out);
  }
};
