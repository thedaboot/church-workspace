// logcheck-v2 — 예배·말씀·모임·홈(v2 화면의 순수 로직). 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { loadSource, tmpDir, readSrc, readSplit } from './_load.mjs';

// ── 새로 읽어 온 묵상을 에디터에 넣어도 되나 (word.shouldAdoptBody · §6-9-n) ──
// 캐시가 낡아 있으면 옛 글이 에디터에 남고, 그 상태로 저장하면 **서버의 새 글을 덮는다**
// (2026-09-06 지적). 그렇다고 도착할 때마다 넣으면 쓰던 글을 뺏는다.
// 되돌리기 검사: `return body === lastSynced`를 `return false`로 바꾸면 '안 고쳤으면
// 신선한 값으로 간다'가 깨지고, `true`로 바꾸면 '고치던 글은 지킨다'가 깨진다.
{
  const src = readFileSync(new URL('../src/services/word.js', import.meta.url), 'utf8')
    // 0061부터 myUid도 같이 가져온다 — 노드에서는 둘 다 세운다(supabaseClient는
    // import.meta.env를 읽어서 그대로 들이면 던진다)
    .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/,
      'const supabase = null; const myUid = async () => null;')
    .replace(/^import \{ unwrap \} from '\.\/cloud\/core\.js';$/m, 'const unwrap = ({ data, error }) => { if (error) throw error; return data; };');
  const { shouldAdoptBody } = await loadSource('src/services/word.js', { src });

  assert.strictEqual(shouldAdoptBody({ dateChanged: true, body: '쓰던 글', lastSynced: '', next: '' }), true,
    '날짜가 바뀌면 언제나 갈아 끼운다(다른 날의 글이다)');
  assert.strictEqual(shouldAdoptBody({ body: '옛 글', lastSynced: '옛 글', next: '새 글' }), true,
    '캐시로 넣어 준 글 그대로면 신선한 값으로 간다(stale이 새 글을 덮던 자리)');
  assert.strictEqual(shouldAdoptBody({ body: '고치던 글', lastSynced: '옛 글', next: '새 글' }), false,
    '한 글자라도 고쳤으면 그대로 둔다');
  assert.strictEqual(shouldAdoptBody({ body: '같은 글', lastSynced: '아무거나', next: '같은 글' }), false,
    '넣어 봐야 같은 글이면 건드리지 않는다(헛렌더 금지)');
  assert.strictEqual(shouldAdoptBody({ body: '', lastSynced: '', next: '남이 쓴 새 글' }), true,
    '빈 칸이면 도착한 글로 채운다');
  assert.strictEqual(shouldAdoptBody(), false, '아무것도 안 주면 아무 일도 안 한다');

  // 화면이 실제로 그 판정을 쓰고 있나(순수 함수만 맞아도 배선이 빠지면 그대로다)
  const view = readFileSync(new URL('../src/views/wordView.jsx', import.meta.url), 'utf8');
  assert.ok(/shouldAdoptBody\(\{ dateChanged, body: bodyRef\.current, lastSynced: syncedBody\.current, next: next\.body \}\)/.test(view),
    'wordView가 그 판정으로 body를 갈아 끼운다');
  // 저장되는 글은 **도막을 되살린 것**이다(2026-09-09 · ensureNoteSections) — 기준도
  // 그 글이어야 한다. `body`로 두면 다음 도착값 판정이 되살린 제목을 '남이 고친 것'으로
  // 읽어 편집기를 덮는다.
  // 2026-09-14: 옮기는 일을 `putBody` 한 벌이 맡는다(초안을 지우는 자리와 같은 곳).
  // 편집기의 글과 기준이 한 줄에서 같이 가야 **도막 제목이 되살아난 직후에도 dirty가
  // 아니다** — 예전에는 기준만 옮겨서 저장 직후 방금 지운 초안이 곧바로 다시 쓰였다.
  assert.ok(/const putBody = \(b\) => \{ const v = bodyOrTemplate\(b, tpl\); setBody\(v\); syncedBody\.current = v; \};/.test(view),
    'putBody가 편집기의 글과 기준을 같이 옮긴다');
  assert.ok(/const kept = ensureNoteSections\(body, QT_SECTIONS\);/.test(view)
    && /putBody\(kept\);/.test(view), '저장하면 기준도 저장된 그 글로 옮긴다');
  // 재조회 실패가 캐시 화면을 '묵상 없음'으로 만들지 않는다
  assert.ok(/if \(!qt \|\| qt\.date !== date\) \{\s*\n\s*setEntry\(\{ date, body: '', title: '', shared: false, exists: false \}\)/.test(view),
    '캐시가 있으면 빈 칸을 세우지 않고 토스트만 한다');
  assert.ok(/if \(qtError && !ref\) \{ setDay\(/.test(view),
    '본문도 같다 — 캐시된 구절이 있으면 그것을 그린다');

  // 형광펜: 로딩 중에 칠한 것을 도착값이 덮지 않는다(ref 플래그). 그릇은 **useStateBox 한 벌**이다
  // (2026-09-09 — 예전에는 useBibleState·BibleTab이 같은 코드를 두 벌 들고 있었다): update가 표식을
  // 놓고, adopt가 표식을 보고 도착값을 버린다. 읽는 이펙트 둘(QT 본문 · 리더)은 그 adopt를 부른다.
  // 그릇과 QT 본문의 읽기는 19차에 bibleParts.jsx로 갈라 갔다 — 리더의 읽기(BibleTab)는 wordBible.jsx에 남는다
  const bible = ['wordBible', 'bibleParts'].map(n => readFileSync(new URL(`../src/components/${n}.jsx`, import.meta.url), 'utf8')).join('\n');
  assert.strictEqual((bible.match(/edited\.current = true;/g) || []).length, 1,
    '표식을 놓는 자리는 useStateBox.update 하나다(두 벌로 갈리면 한쪽만 고쳐진다)');
  assert.ok(/const adopt = \(saved\) => \{ if \(edited\.current\) return; setState\(saved\); writeCache\(STATE_KEY, saved\); \};/.test(bible),
    'adopt: 내가 고쳤으면 도착값을 버린다');
  assert.strictEqual((bible.match(/adopt\(saved\)/g) || []).length, 2,
    '읽는 이펙트 둘(useBibleState · BibleTab)이 모두 adopt를 거친다');
  assert.ok(/const STATE_KEY = 'bible:state';/.test(bible),
    "성경 상태 열쇠는 'bible:'로 시작한다 — dropCache('word')에 쓸려가지 않게");
  console.log('PASS  묵상 본문 동기화 · 성경 상태 14가지');
}

// ── 호칭 · '지난 주일' · 출석 메모 자리 (2026-09-06) ─────────────────────────
// 셋 다 사용자 결정이고, 규칙은 순수 함수 하나씩이다. 화면은 그것을 부르기만 한다 —
// 그래서 여기서 함수를 직접 돌리고, **배선**(어느 화면이 그 함수를 쓰는가)은 소스로 못 박는다.
// 되돌려서 깨뜨린 것(§3-5): honorific의 is_pastor 가지를 지우면 ①, pastSunday의
// `< today`를 `<=`로 바꾸면 ③, worship.js의 rpc 호출을 saveService로 되돌리면 ④가 깨진다.
{
  // 서비스 계층은 supabase·react를 import한다 — 순수 부분만 노드에서 부르기 위해
  // import 줄을 걷어낸다(liveV2 블록과 같은 방식). people.js의 guestStore는 worship.js가
  // **모듈 최상단에서** 부르므로 그 자리만 빈 저장소로 세워 준다.
  const strip = (t) => t
    // 여러 줄 import도 걷는다(worship.js의 cloud import가 2026-09-07부터 두 줄) — 중괄호 안에는 }가 없어
    // 다음 import까지 삼키지 않는다
    .replace(/^import \{[^}]*\} from '\.\.?\/(supabaseClient|cloud|cloud\/core|image)\.js';\s*$/gm, '')
    // localDate·byName은 2026-09-24부터 utils·people에서 온다(한 벌로 모았다)
    .replace(/^import .*from '(?:\.\.\/)+utils\.js';\s*$/gm, 'const generateId = () => "id"; const localDate = (d) => new Date(d).toLocaleDateString("sv-SE");')
    .replace(/^import .*from '\.\.?\/people\.js';\s*$/gm,
      'const guestStore = () => ({ all: () => ({}), rows: () => [], set: () => {} }); const byName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ko");');
  const dir = tmpDir();
  const siblings = [
    // titleText.js는 순수 모듈이라 그대로 옆에 둔다(2026-09-08 — 유튜브 제목 NFKC 정규화)
    'src/services/titleText.js',
    // serviceView.js(표지 갈래 · 0081)와 그것이 부르는 noteTemplate.js도 순수 모듈이라 그대로 옆에 둔다
    ...['serviceView.js', 'noteTemplate.js', 'honorific.js', 'cueDigest.js'].map(f => `src/services/${f}`),
  ];
  const { honorific, honorificsOf } = await loadSource('src/services/people.js', { src: strip(readSrc('src/services/people.js')), dir, siblings });
  const { pastSunday, recentSongs, weeksAgoOf, songKey, prefillRoles, PREFILL_ROLES, cueNameFor, pickLastCue } = await loadSource('src/services/worship/pure.js', { src: strip(readSrc('src/services/worship/pure.js')).replace(/from '\.\.\//g, "from './"), dir });

  // 지난 큐시트로 바로 편집(2026-10-02) — 이름의 날짜는 이 주보 날짜로, 고르는 것은 이 날짜 **앞**의 가장 가까운 큐시트
  assert.strictEqual(cueNameFor('20260920_더다붓청년예배 큐시트.docx', '2026-09-20', '2026-10-04'), '20261004_더다붓청년예배 큐시트.docx');
  assert.strictEqual(cueNameFor('26.09.20 큐시트.docx', '2026-09-20', '2026-10-04'), '26.10.04 큐시트.docx', 'YY.MM.DD 모양도');
  assert.strictEqual(cueNameFor('큐시트.docx', '2026-09-20', '2026-10-04'), '20261004_큐시트.docx', '날짜가 없으면 앞에 붙인다');
  const CS = [{ id: 'a', service_date: '2026-09-20' }, { id: 'b', service_date: '2026-09-27' }, { id: 'c', service_date: '2026-10-11' }];
  const CF = [
    { id: 'f1', service_id: 'a', kind: 'cuesheet', created_at: '1' },
    { id: 'f2', service_id: 'b', kind: 'songform', created_at: '1' },
    { id: 'f3', service_id: 'c', kind: 'cuesheet', created_at: '1' },
  ];
  assert.strictEqual(pickLastCue(CS, CF, '2026-10-04')?.file.id, 'f1', '송폼만 있는 주보는 건너뛰고 · 뒤 날짜는 안 본다');
  assert.strictEqual(pickLastCue(CS, CF, '2026-09-20'), null, '앞에 큐시트가 없으면 null(버튼이 안 선다)');
  const driveFile = readFileSync(new URL('../api/drive-file.js', import.meta.url), 'utf8');
  assert.ok(/export\?format=docx/.test(driveFile) && /asDocx \? 'private, no-store'/.test(driveFile), 'as=docx는 구글 문서 내보내기 · 캐시하지 않는다');

  // ① 세 갈래 + 객원 — 교역자 '전도사님' · 그 해 부장 '부장님' · 나머지 '청년'
  assert.strictEqual(honorific('임성빈', { isPastor: true }), '임성빈 전도사님');
  assert.strictEqual(honorific('신효진', { roles: ['director'] }), '신효진 부장님');
  assert.strictEqual(honorific('노준석', { roles: [] }), '노준석 청년');
  assert.strictEqual(honorific('조준환', { roles: ['lead_team'] }), '조준환 청년',
    '부장 말고 다른 직분은 호칭을 바꾸지 않는다');
  assert.strictEqual(honorific('한상록 강사님', null), '한상록 강사님',
    '명단에 없는 객원은 적은 글자 그대로 — 아는 것이 없으니 청년이라고 부르지 않는다');
  assert.strictEqual(honorific('', { isPastor: true }), '', '이름이 없으면 붙일 것도 없다');
  assert.strictEqual(honorific('임성빈', { isPastor: true, roles: ['director'] }), '임성빈 전도사님',
    '겸직이면 교역자가 먼저다');

  // ② 이름·id로 찾는 한 벌 — 계정 표시명으로 덮인 이름과 명단의 이름 둘 다 열쇠다
  const nameOf = honorificsOf(
    [{ id: 'p1', name: '임성빈', is_pastor: true },
      { id: 'p2', name: '신효진' },
      { id: 'p3', name: '말감이', roster_name: '임재훈' }],
    [{ person_id: 'p2', year: 2026, role: 'director' }, { person_id: 'p3', year: 2026, role: 'lead_team' }],
  );
  assert.strictEqual(nameOf('임성빈'), '임성빈 전도사님');
  assert.strictEqual(nameOf('신효진'), '신효진 부장님');
  assert.strictEqual(nameOf('말감이'), '말감이 청년');
  assert.strictEqual(nameOf('임재훈'), '임재훈 청년', '명단에 적힌 이름으로도 찾는다(roster_name)');
  assert.strictEqual(nameOf('한상록 강사님'), '한상록 강사님');
  assert.strictEqual(nameOf('아무개', 'p1'), '아무개 전도사님', 'id가 있으면 id가 먼저다');
  assert.strictEqual(honorificsOf()('누구'), '누구', '재료가 없으면 이름 그대로');

  // ③ 홈의 '지난 주일' — **오늘보다 앞선** 발행 주일 주보. 오늘 것은 세지 않는다
  const svc = [
    { id: 'a', kind: 'sunday', status: 'published', service_date: '2026-08-30' },
    { id: 'b', kind: 'sunday', status: 'published', service_date: '2026-09-06' },
    { id: 'c', kind: 'sunday', status: 'draft', service_date: '2026-09-05' },
    { id: 'd', kind: '금요 열정 예배', status: 'published', service_date: '2026-09-04' },
    { id: 'e', kind: 'sunday', status: 'published', service_date: '' },
  ];
  assert.strictEqual(pastSunday(svc, '2026-09-06')?.id, 'a',
    "오늘이 주일이면 오늘 주보를 '지난 주일'이라 부르지 않는다(사용자 지적 2026-09-06)");
  assert.strictEqual(pastSunday(svc, '2026-09-09')?.id, 'b', '평일이면 바로 앞 주일');
  assert.strictEqual(pastSunday(svc, '2026-08-30'), null,
    '앞선 발행 주일이 없으면 null — 홈은 그 도막을 아예 그리지 않는다');
  assert.strictEqual(pastSunday([], '2026-09-09'), null);
  assert.strictEqual(pastSunday(svc, '2026-09-07')?.id, 'b', '작성 중·금요 예배·날짜 없는 행은 세지 않는다');

  // ④ 배선 — 함수가 맞아도 화면이 안 부르면 그대로다
  const src = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const worship = readSplit('src/services/worship.js');
  assert.ok(/supabase\.rpc\('set_attendance_note', \{ p_service_id: serviceId, p_note: text \}\)/.test(worship),
    '출석 메모는 0052의 rpc로 간다 — services 업데이트(services_write)가 아니다');
  const wview = src('../src/views/worshipView.jsx');
  assert.ok(/await saveAttendanceNoteRow\(openId, text\)/.test(wview), '예배 화면이 그 rpc 경로를 부른다');
  assert.ok(!/save\(\{ attendance_note/.test(wview), '주보 저장 경로로는 더 이상 보내지 않는다');
  const att = src('../src/components/worshipAttendance.jsx');
  assert.ok(/\{perms\.canCheck && \(/.test(att), '메모 칸은 출석 자격(canCheck)일 때 선다 — canEdit이 아니다');
  const detail = src('../src/components/worshipDetail.jsx');
  assert.ok(/honorificsOf\(people, personRoles\)/.test(detail), '주보 상세가 명단+직분으로 호칭 한 벌을 만든다');
  assert.ok(/<Avatar name=\{name\}/.test(detail), '아바타 글자 원은 호칭이 아니라 이름에서 뽑는다');
  const home = src('../src/views/homeView.jsx');
  assert.ok(/pastSunday\(list, day\)/.test(home), "홈의 '지난 주일'은 오늘보다 앞선 주보다");
  // 인도자는 **홈에서 뺐다**(사용자 결정 2026-09-06). 주보 상세에는 그대로 있다 —
  // 호칭 규칙(honorificsOf)이 홈에서 쓰이지 않게 됐으니 그 재료도 같이 사라져야 한다.
  // 2026-09-25 사용자 결정으로 **오늘의 예배 카드에서만** 인도자를 싣는다(찬양 칸 머리). 평소 카드(LinkCard)의
  // 메타 줄에는 여전히 없다 — 그 줄이 praise_leader를 읽지 않는지를 본다.
  const metaAt = home.indexOf('kindLabel(church.service.kind)');
  const metaLine = metaAt > 0 ? home.slice(metaAt, metaAt + 200) : '';
  assert.ok(metaLine && !/praise_leader/.test(metaLine), '평소 홈 예배 카드의 메타 줄은 인도자를 싣지 않는다');
  assert.ok(/찬양 인도 \$\{leader\}/.test(home) && /leader=\{leaderLabel\}/.test(home), '오늘의 예배 카드는 찬양 칸 머리에 인도자(본명+호칭)');
  assert.ok(/worship-praise-leader/.test(detail), '주보 상세는 인도자를 그대로 보여 준다');
  // 홈 캐릭터 — **그림이 도착한 뒤에** 등장 연출이 걸린다(모바일에서 모션이 빈 자리에서
  // 먼저 끝나던 자리 · 사용자 2026-09-06). 히어로는 우선순위까지 올려 먼저 받는다.
  // 컷 부품(Cut)은 쇼케이스와 한 파일이다(19차 묶음 J — views/showcase.jsx) · 히어로는 홈이 eager로 부른다
  const showSrc = src('../src/views/showcase.jsx');
  assert.ok(/\$\{shown \? 'dc-card' : 'opacity-0'\}/.test(showSrc),
    '컷은 도착 전에는 숨어 있다가 도착한 뒤에 등장한다');
  assert.ok(/fetchPriority: 'high'/.test(showSrc) && /<Cut src=\{HERO_CUT\.src\}[^>]*\beager\b/.test(home),
    '히어로 컷은 fetchpriority=high로 먼저 받는다');
  assert.ok(/pre\.srcset = cutSet\(HERO_CUT\.src\)/.test(home),
    '히어로 컷은 번들이 읽히는 순간부터 받기 시작한다(index.html의 preload 대신)');
  const mig = src('../supabase/migrations/0052_attendance_note_rpc.sql');
  assert.ok(/security definer/.test(mig) && /set attendance_note = p_note/.test(mig),
    '0052는 security definer로 그 한 칸만 쓴다');
  assert.ok(/can_check_all_attendance\(\) or public\.leads_any_sun\(\)/.test(mig),
    '자격은 전체 출석 자격자 + 순장이다');
  assert.ok(/status = 'published'/.test(mig), '발행된 주보만');
  assert.ok(/grant execute on function public\.set_attendance_note\(uuid, text\) to authenticated/.test(mig)
    && /revoke execute on function public\.set_attendance_note\(uuid, text\) from anon/.test(mig),
    '실행 권한은 로그인 사용자만(0048과 같은 마무리)');

  // ── 최근에 부른 곡 (2026-09-21) ──────────────────────────────────────────
  // 새 표 없이 services.songs(jsonb)만 거꾸로 훑는다. 되돌리기 검사: 발행본 거르기를
  // 빼면 둘째가, `at >= on` 거르기를 빼면 셋째가, weeksAgo의 Math.max(1, …)를 빼면
  // 넷째가, 겹친 곡 추리기를 빼면 다섯째가 깨진다.
  const SVCS = [
    { status: 'published', service_date: '2026-09-13', songs: [{ title: '살아계신 주' }, { title: '주 은혜임을' }] },
    { status: 'published', service_date: '2026-09-06', songs: [{ title: '살아계신 주' }, { title: '오직 예수' }] },
    { status: 'draft',     service_date: '2026-09-19', songs: [{ title: '아직 안 부른 곡' }] },
    { status: 'published', service_date: '2026-09-18', songs: [{ title: '금요에 부른 곡' }] },   // 금요 예배
    { status: 'published', service_date: '2026-06-07', songs: [{ title: '오래전 곡' }] },        // 8주 밖
    { status: 'published', service_date: '2026-09-20', songs: [{ title: '같은 날 곡' }] },        // 자기 날짜
  ];
  const recent = recentSongs(SVCS, { onDate: '2026-09-20', weeks: 8 });
  assert.deepStrictEqual(recent.map(r => `${r.title}/${r.weeksAgo}`),
    ['금요에 부른 곡/1', '살아계신 주/1', '주 은혜임을/1', '오직 예수/2'],
    '최신이 앞 · 같은 곡은 가장 최근 한 번만');
  assert.ok(!recent.some(r => r.title === '아직 안 부른 곡'),
    '작성 중 주보의 곡은 아직 부른 곡이 아니다');
  assert.ok(!recent.some(r => r.title === '같은 날 곡'),
    '같은 날짜(지금 짜는 콘티)는 되돌아오지 않는다');
  assert.ok(recent.every(r => r.weeksAgo >= 1),
    '주중에 낀 예배도 0주 전이 되지 않는다 — "0주 전에 했던 곡"이라는 말은 없다');
  assert.ok(!recent.some(r => r.title === '오래전 곡'), '창 밖(8주)은 빠진다');
  assert.deepStrictEqual(recentSongs(SVCS, { onDate: '' }), [], '날짜를 모르면 빈 목록이다');

  // 제목 맞추기는 띄어쓰기·대소문자를 접는다(손으로 적은 것과 유튜브에서 온 것이 섞인다)
  assert.strictEqual(songKey(' 주  은혜임을 '), songKey('주은혜임을'));
  assert.strictEqual(weeksAgoOf(recent, ' 살아계신주 '), 1, '띄어쓰기가 달라도 같은 곡이다');
  assert.strictEqual(weeksAgoOf(recent, '처음 부르는 곡'), 0, '없으면 0 — 표를 안 붙인다');
  // 링크도 같이 물려준다(2026-09-22) — 칩으로 넣고 같은 영상을 다시 찾게 하지 않는다.
  // 되돌리기 검사: recentSongs의 link를 빼면 이 단정이 깨진다.
  assert.strictEqual(
    recentSongs([{ status: 'published', service_date: '2026-09-13',
      songs: [{ title: '오직 예수', link: 'https://youtu.be/abc' }] }], { onDate: '2026-09-20' })[0].link,
    'https://youtu.be/abc', '곡 이력이 유튜브 링크를 함께 들고 온다');
  console.log('PASS  최근에 부른 곡 10가지');

  // ── 다음 주 예배 위원 물려받기 (2026-09-22에 재료를 바꿨다) ───────────────
  // 처음에는 **지난 주보의 roles**를 물려줬는데, 라이브를 보니 그건 '그 날 섬긴 사람'이라
  // 언제나 한 주 밀린 이름이 앉았다. 다음 주 담당자는 지난 주보 **광고**의
  // `다음 주 예배 위원`에 적혀 있다(사용자 지적 · 9/20 주보로 확인).
  // 되돌리기 검사: 광고 대신 roles를 읽게 하면 첫째가, 종류 거르기를 빼면 다섯째가,
  // 호칭 떼기를 빼면 첫째가, 차례대로 세우기를 빼면 둘째가 깨진다.
  assert.deepStrictEqual(PREFILL_ROLES, ['대표기도', '헌금봉헌'], '물려받는 자리는 둘뿐이다');
  const RSVCS = [
    { kind: 'sunday', status: 'published', service_date: '2026-09-20',
      // roles는 **그 날 섬긴 사람**이다 — 여기서 가져오면 안 된다
      roles: [{ role: '대표기도', name: '이하랑' }, { role: '헌금봉헌', name: '꽃님' }],
      notices: [
        { title: '교우동정', body: '생일자: 조현재 형제 9/20' },
        { title: '다음 주 예배 위원', body: ['헌금봉헌: 윤현서 자매', '대표기도: 이수빈 형제'].join('\n') },
      ] },
    { kind: 'sunday', status: 'published', service_date: '2026-09-13',
      notices: [{ title: '다음 주 예배 위원', body: ['대표 기도: 강서윤 자매', '헌금 봉헌: 옛사람 자매'].join('\n') }] },
    { kind: 'sunday', status: 'draft', service_date: '2026-09-25',
      notices: [{ title: '다음 주 예배 위원', body: '대표기도: 작성중 형제' }] },
  ];
  const PEOPLE = [{ id: 'p-su', name: '이수빈' }];
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27', people: PEOPLE }),
    [{ role: '대표기도', name: '이수빈', personId: 'p-su' },
     { role: '헌금봉헌', name: '윤현서', personId: null }],
    '지난 주보 광고에서 · 호칭을 떼고 · 명단에 있으면 personId까지 잇는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27' }).map(r => r.role),
    ['대표기도', '헌금봉헌'],
    '광고에 적힌 순서와 상관없이 늘 같은 차례로 세운다');
  assert.strictEqual(prefillRoles(RSVCS, { onDate: '2026-09-20' })[0].name, '강서윤',
    '띄어 적은 역할(대표 기도)도 같은 자리로 본다');
  assert.ok(!prefillRoles(RSVCS, { onDate: '2026-09-27' }).some(r => r.name === '작성중'),
    '작성 중 주보의 광고는 보지 않는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-27', kind: '성탄절 예배' }), [],
    '이벤트 예배는 주일 4부의 위원을 물려받지 않는다');
  assert.deepStrictEqual(prefillRoles(RSVCS, { onDate: '2026-09-10' }), [],
    '앞선 발행본이 없으면 빈 배열이다(화면도 조용하다)');
  assert.deepStrictEqual(
    prefillRoles([{ kind: 'sunday', status: 'published', service_date: '2026-09-20',
      notices: [{ title: '교우동정', body: '없음' }] }], { onDate: '2026-09-27' }), [],
    '광고에 위원이 안 적혀 있으면 지어내지 않는다');
  // 호칭은 넉넉히 뗀다(2026-09-22 사용자 요청 — "OOO 청년"으로 적어도 잡히게).
  // **띄어쓰기 한 칸은 반드시 있어야 한다**: 붙여 쓴 것까지 떼면 '강꽃님'처럼 호칭으로
  // 끝나는 진짜 이름을 잘라 먹는다(우리 명단에 있는 이름이다).
  // 되돌리기 검사: HONORIFICS의 `\s+`를 `\s*`로 되돌리면 마지막 단정이 깨진다.
  const said = (body) => prefillRoles(
    [{ kind: 'sunday', status: 'published', service_date: '2026-09-20',
       notices: [{ title: '다음 주 예배 위원', body }] }], { onDate: '2026-09-27' })[0]?.name;
  for (const [body, want] of [
    ['대표기도: 이수빈 형제', '이수빈'],
    ['대표기도: 이수빈 자매', '이수빈'],
    ['대표기도: 이수빈 청년', '이수빈'],
    ['대표기도: 이수빈 부장님', '이수빈'],
    ['대표기도: 이수빈 전도사님', '이수빈'],
    ['대표기도: 이수빈 순장', '이수빈'],
    ['대표기도: 이수빈 팀장님', '이수빈'],
    ['대표기도: 이수빈 회장', '이수빈'],
    ['대표기도: 이수빈', '이수빈'],
    ['대표기도 : 이수빈 형제', '이수빈'],
    ['- 대표기도: 이수빈 형제', '이수빈'],
  ]) assert.strictEqual(said(body), want, `"${body}" → ${want}`);
  assert.strictEqual(said('대표기도: 강꽃님'), '강꽃님',
    '호칭으로 끝나는 진짜 이름은 자르지 않는다(띄어쓰기가 없으면 호칭이 아니다)');
  console.log('PASS  다음 주 예배 위원 물려받기 20가지');

  console.log('PASS  호칭 · 지난 주일 · 출석 메모 33가지');
}

// ── 노트 도막 (이름·고정·옛 이름 옮기기) ───────────────────────────────────
// 사용자 결정 2026-09-09: "본문, 말씀 요약, 나의 묵상, 결단, 기도 는 아예 지울 수 없게
// 고정" → "중제목들 안 지워지게 해달라니까". 편집기에서 지웠어도 **저장되는 글**에는
// 도막이 그 순서로 서 있다(저장 자리 하나에서 보장한다 — 그 파일 머리말).
// 잃는 것이 없어야 한다: 사람이 쓴 글 · 제목 앞의 글 · 새로 만든 도막.
//
// 2026-09-10에 **이름이 한 번 더 바뀌었다** — '나의 묵상'을 빼고 '결단'을 '나의 결단'으로.
// 2026-09-12에는 **'본문'을 뺐다**(예배 노트 셋 · QT 둘) — 종이 머리(paper.jsx
// PaperNoteHead)에 구절이 이미 서기 때문이다. 옛 이름은 LEGACY_SECTIONS에 **쌓는다**
// (갈아치우면 옛 빈 노트가 '사람이 쓴 글'이 되어 나눔·잔디에 오른다 — docs/PITFALLS.md §6-9-as).
{
  const nt = await loadSource('src/services/noteTemplate.js');

  // 도막 이름·순서 (사용자 결정 2026-09-12 — '본문'을 뺐다)
  assert.deepStrictEqual(nt.WORSHIP_SECTIONS, ['말씀 요약', '나의 결단', '기도'],
    '예배 노트는 세 도막이다');
  assert.deepStrictEqual(nt.QT_SECTIONS, ['나의 결단', '기도'],
    'QT는 두 도막이다(말씀 요약이 없다)');

  const kept = nt.ensureNoteSections('### 말씀 요약\n들은 것\n### 나의 결단\n음', nt.WORSHIP_SECTIONS);
  assert.deepStrictEqual(nt.splitNoteSections(kept).map(x => x.title), ['말씀 요약', '나의 결단'],
    '글이 있는 도막만 갈리지만');
  for (const t of nt.WORSHIP_SECTIONS) {
    assert.ok(kept.includes(`### ${t}`), `${t} 제목이 되살아난다`);
  }
  assert.ok(kept.indexOf('### 말씀 요약') < kept.indexOf('### 나의 결단')
    && kept.indexOf('### 나의 결단') < kept.indexOf('### 기도'), '순서는 템플릿 순서다');
  assert.ok(kept.includes('들은 것') && kept.includes('음'), '쓴 글은 그대로 얹힌다');

  // 제목을 다 지운 글 — 맨 위에 그대로 남는다(잃지 않는다)
  const lead = nt.ensureNoteSections('그냥 쓴 글', nt.QT_SECTIONS);
  assert.ok(lead.startsWith('그냥 쓴 글'), '제목 앞의 글은 맨 위에 남는다');
  assert.strictEqual((lead.match(/^### /gm) || []).length, 2, 'QT는 두 도막이다');

  // 사람이 새로 만든 도막은 **뒤에** 붙는다
  const extra = nt.ensureNoteSections('### 나의 결단\n가\n### 내가 만든 칸\n나', nt.QT_SECTIONS);
  assert.ok(extra.indexOf('### 내가 만든 칸') > extra.indexOf('### 기도'), '새 도막은 뒤에 붙는다');
  assert.ok(extra.includes('나'), '새 도막의 글도 남는다');

  // **되살린 템플릿은 여전히 빈 노트다** — 아니면 아무도 쓰지 않은 제목이 나눔에 오른다
  assert.strictEqual(
    nt.isTemplateOnly(nt.ensureNoteSections(nt.worshipNoteTemplate(), nt.WORSHIP_SECTIONS)),
    true, '되살린 템플릿은 빈 노트로 남는다');

  // ── 옛 이름으로 저장된 노트를 열어 저장하면 (2026-09-10) ──────────────────
  // 옛 도막('나의 묵상'·'결단')은 이제 템플릿에 없다. 그래도 **글이 사라지면 안 된다** —
  // 새 도막이 그 순서로 서고 옛 도막은 사람이 만든 칸처럼 뒤에 붙는다. 사람이 그 글을
  // 새 도막으로 옮길 수 있게 편집기의 고정 목록에서도 옛 이름은 빠져 있다.
  // **되돌리기**: ensureNoteSections가 아는 이름만 남기게(extra를 버리게) 만들면 깨진다.
  const old = '### 본문\n요 3:16\n### 말씀 요약\n들은 것\n### 나의 묵상\n생각한 것\n### 결단\n하기로 한 것\n### 기도\n빈다';
  const moved = nt.ensureNoteSections(old, nt.WORSHIP_SECTIONS);
  for (const t of nt.WORSHIP_SECTIONS) {
    assert.ok(moved.includes(`### ${t}`), `옛 노트를 저장해도 ${t} 도막이 선다`);
  }
  // '요 3:16'은 2026-09-14에 빠졌다 — 아래 '본문 도막을 걷는다' 묶음이 그 자리다.
  for (const line of ['들은 것', '생각한 것', '하기로 한 것', '빈다']) {
    assert.ok(moved.includes(line), `옛 노트의 '${line}'이 남는다`);
  }
  assert.ok(moved.indexOf('### 기도') < moved.indexOf('### 나의 묵상')
    && moved.indexOf('### 나의 묵상') < moved.indexOf('### 결단'),
    '옛 도막은 새 도막 **뒤에** 그 순서대로 붙는다');
  // 옛 이름만 있는 빈 노트는 아직 빈 노트다(LEGACY_SECTIONS에 쌓았다)
  assert.strictEqual(
    nt.isTemplateOnly('### 본문\n요 3:16\n### 말씀 요약\n\n### 나의 묵상\n\n### 결단\n\n### 기도\n', '요 3:16'),
    true, '옛 이름으로 저장된 빈 노트도 빈 노트다');

  // ── '본문' 도막은 2026-09-12에 뺐다 (사용자 결정) ─────────────────────────
  // "제목 밑에 본문이 나오니까, 그 아래 실제 섹션에서 본문 섹션은 빼자" — 종이 머리
  // (paper.jsx PaperNoteHead)에 구절이 이미 서므로 도막으로 한 번 더 두지 않는다.
  // **새 템플릿에는 없지만 LEGACY_SECTIONS에는 쌓았다** — 옛 노트의 `### 본문`은 저장된
  // 글이라 읽기 종이에 그대로 서고, 빈 템플릿 판정에서도 제목으로 읽혀야 한다.
  // **되돌리기**: LEGACY_SECTIONS에서 '본문'을 빼면 바로 아래 빈 노트 판정이 깨진다(옛
  // 빈 노트가 '사람이 쓴 글'이 되어 나눔 피드·잔디에 오른다).
  assert.ok(!nt.WORSHIP_SECTIONS.includes('본문') && !nt.QT_SECTIONS.includes('본문'),
    "'본문'은 새 템플릿에 없다");
  assert.strictEqual(
    nt.isTemplateOnly('### 본문\n삿 4:11-24\n### 말씀 요약\n\n### 나의 결단\n\n### 기도\n', '삿 4:11-24'),
    true, "'본문'은 LEGACY라 그 도막이 든 옛 빈 노트도 빈 노트다");
  // ── 2026-09-14: 그 도막을 **어디에도 세우지 않는다** (사용자 결정) ────────
  // "그 밑에 구절 또 사용자로부터 입력받을 수 있는 섹션이 있는데 거기! 그거 완벽하게
  // 제거해줬으면 해서." 2026-09-12에는 템플릿에서만 뺐던 터라, 옛 노트에 저장된 도막이
  // **편집 종이에서 여전히 쓸 수 있는 칸**으로 서 있었다. 이제 걷는 자리는
  // noteTemplate.dropLegacySections 한 곳이고 편집기로 들어가는 글·종이·저장이 그것을 지난다.
  // 머리 구절은 주보의 값 하나다(paper.jsx NoteSheet의 끌어올리기도 같이 걷었다).
  // **되돌리기**: dropLegacySections를 빼면 아래 넷이 바로 깨진다.
  const withRef = nt.ensureNoteSections('### 본문\n삿 4:11-24\n### 나의 결단\n음', nt.WORSHIP_SECTIONS);
  assert.deepStrictEqual(nt.splitNoteSections(withRef).map(x => x.title), ['나의 결단'],
    "옛 '본문' 도막은 종이에 서지 않는다");
  assert.ok(!withRef.includes('삿 4:11-24') && !withRef.includes('### 본문'),
    "'본문' 도막은 저장될 때 다시 쓰이지 않는다");
  assert.strictEqual(nt.dropLegacySections('앞 글\n### 본문\n구절\n### 기도\n빈다'), '앞 글\n### 기도\n빈다',
    '걷는 것은 그 도막뿐이고 나머지 줄은 한 글자도 안 건드린다');
  assert.strictEqual(nt.bodyOrTemplate('### 본문\n삿 3:1-11\n', nt.worshipNoteTemplate()),
    nt.worshipNoteTemplate(), "'본문'만 있던 옛 노트는 손대지 않은 템플릿이 된다");

  // 초안 관례 — 자리는 브라우저이고 열쇠는 노트마다 하나다(사용자 결정 2026-09-14)
  assert.strictEqual(nt.noteDraftKey('qt', '2026-09-14'), 'draft:note:qt:2026-09-14');
  // 열쇠의 첫 도막이 화면 캐시(word:·worship:·home)와 겹치면 저장 한 번에 초안이 같이 지워진다
  assert.ok(nt.noteDraftKey('worship', 's1').startsWith('draft:'), '초안 열쇠는 화면 캐시와 갈린다');
  assert.strictEqual(nt.hasDraft({ body: 'a' }, 'a'), false, '저장된 글과 같으면 되살릴 것이 없다');
  assert.strictEqual(nt.hasDraft({ body: 'b' }, 'a'), true);
  assert.strictEqual(nt.hasDraft({ body: 'a', title: '제목' }, 'a', ''), true, '제목만 달라도 초안이다');
  assert.strictEqual(nt.hasDraft(null, 'a'), false);

  // 편집기에서도 고정된다(사용자 결정 2026-09-10 — "아예 수정 창에서부터")
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const ed = src('../src/components/MarkdownEditor.jsx');
  const worship = src('../src/components/worshipNote.jsx');   // 예배 노트는 19차에 worshipDetail에서 갈라 왔다
  const word = src('../src/views/wordView.jsx');
  assert.ok(/name: 'lockedHeadings'/.test(ed) && /filterTransaction/.test(ed),
    '편집기가 정해진 중제목을 지우는 트랜잭션을 물린다');
  assert.ok(/bypass\(\)/.test(ed) && /replacingRef\.current = true/.test(ed),
    '문서를 통째로 교체할 때는 통과시킨다(옛 노트가 안 들어오는 것을 막는다)');
  assert.ok(/lockedHeadings=\{WORSHIP_SECTIONS\}/.test(worship), '예배 노트가 세 도막을 잠근다');
  assert.ok(/lockedHeadings=\{QT_SECTIONS\}/.test(word), '묵상 노트가 두 도막을 잠근다');

  // ── 편집도 종이 안에서 한다 (사용자 요청 2026-09-10) ─────────────────────
  // 읽기와 **같은 부품**을 써야 한다(마크업을 한 벌 더 적으면 한쪽만 고쳐진다).
  // **되돌리기**: 두 화면 중 하나에서 frame/NotePaper를 떼면 이 줄이 깨진다.
  const paper = src('../src/components/paper.jsx');
  for (const name of ['PaperMast', 'PaperNoteHead', 'PaperSheet', 'NotePaper']) {
    assert.ok(new RegExp(`export function ${name}`).test(paper),
      `종이의 ${name}이 읽기·편집 둘 다에 열려 있다`);
  }
  assert.ok(/<PaperNoteHead /.test(paper) && /<PaperMast /.test(paper),
    '읽기 종이도 그 부품을 쓴다(중복 마크업 금지)');
  assert.ok(/frame = null/.test(ed) && /frame \? frame\(<EditorContent editor=\{editor\} \/>\)/.test(ed),
    '편집기가 틀을 받아 편집 칸을 그 안에 넣는다');
  for (const [name, s] of [['예배 노트', worship], ['묵상 노트', word]]) {
    assert.ok(/frame=\{\(content\) => \(/.test(s) && /<NotePaper /.test(s),
      `${name} 편집기가 종이 안에 선다`);
    assert.ok(/note-paper/.test(s), `${name} 편집기에 종이 격자 클래스가 붙는다`);
    assert.ok(/tools="note"/.test(s), `${name} 서식 바에 제목·구분선·링크 버튼이 없다(tools="note")`);
  }
  // 격자는 index.css 한 자리다 — h3은 1열, 그 밖은 2열
  const css = src('../src/index.css');
  assert.ok(/\.note-paper \.tiptap \{[^}]*display: grid/.test(css)
    && /grid-template-columns: 58px minmax\(0, 1fr\)/.test(css),
    '종이 격자는 라벨 58px + 남는 폭이다(읽기 줄과 같은 값)');
  assert.ok(/\.note-paper \.tiptap > :is\(h1, h2, h3, h4\) \{[^}]*grid-column: 1/.test(css),
    '제목은 1열(라벨 칸)로 간다');
  assert.ok(/\.note-paper \.tiptap > \* \{[^}]*grid-column: 2/.test(css),
    '그 밖의 블록은 2열(쓰는 칸)로 간다');
  // 종이는 다크를 안 따라간다(§6-32-i) — 색은 PaperSheet가 흘려 준 --paper-* 한 벌이다
  assert.ok(/'--paper-line': PAPER\.line/.test(paper) && /'--paper-ink2': PAPER\.ink2/.test(paper),
    'PAPER 한 벌이 CSS 변수로 내려간다');
  const paperCss = css.slice(css.indexOf('.note-paper .tiptap {'), css.indexOf('/* 입력 요소의'));
  assert.ok(paperCss.length > 500 && !paperCss.includes('var(--app-'),
    '종이 안 글자에 앱 토큰(다크를 따라가는 색)을 쓰지 않는다');

  console.log('PASS  노트 도막 이름·고정·종이 편집 46가지');
}

// ── 구절을 책 이름 전체로 (services/bibleRef.js fullRef · 2026-09-11) ────────
// QT 읽기표(qt_schedule.passage_ref · 0038 시드)는 '삿 5:19-31'처럼 **약자**로 저장되어
// 있고 주보의 구절은 사람이 이름 전체로 적는다 — 같은 모양의 노트 종이인데 묵상 쪽
// 머리만 약자였다(사용자 지적 2026-09-11). 저장값은 그대로 두고 **보여줄 때만** 푼다.
// **되돌리기**: fullRef가 받은 글을 그대로 돌려주게 만들면 아래 첫 줄이 깨진다.
{
  const { fullRef, parseRef, formatRef } = await import(new URL('../src/services/bibleRef.js', import.meta.url).href);
  const books = JSON.parse(readFileSync(new URL('../public/bible/index.json', import.meta.url), 'utf8'));

  assert.strictEqual(fullRef('삿 5:19-31', books), '사사기 5:19-31', '약자가 책 이름 전체로 풀린다');
  assert.strictEqual(fullRef('수 4:1-14', books), '여호수아 4:1-14', '읽기표의 약자 표기');
  // 장 전체는 formatRef의 규칙대로 'N장'이다(주보의 구절과 같은 한 벌) — 읽기표 730일은
  // 전부 절 범위라('시 2:1-12') 이 갈래로 오지 않는다
  assert.strictEqual(fullRef('시 121편', books), '시편 121장', '장 전체는 formatRef 규칙을 따른다');
  assert.strictEqual(fullRef('시 2:1-12', books), '시편 2:1-12', '읽기표의 시편 표기');
  // 이미 이름 전체인 글은 **그 모양 그대로** 나와야 한다 — 주보의 구절이 여기를 지난다
  assert.strictEqual(fullRef('이사야 32:9-20', books), '이사야 32:9-20', '이름 전체는 그대로다');
  // 못 읽는 글은 삼키지 않고 그대로 돌려준다(parseRef와 같은 안전한 실패) — 화면에
  // 빈 칸이 서면 그 노트가 무엇에 대한 글인지 말하는 줄이 통째로 사라진다
  assert.strictEqual(fullRef('도마복음 1:1', books), '도마복음 1:1', '못 읽는 글은 그대로');
  assert.strictEqual(fullRef('', books), '', '빈 글은 빈 글');
  assert.strictEqual(fullRef('삿 5:19-31', null), '삿 5:19-31', '책 목록이 없으면 그대로');
  // formatRef와 **같은 답**이어야 한다(두 벌이 되면 한쪽만 고쳐진다)
  assert.strictEqual(fullRef('삿 5:19-31', books), formatRef(parseRef('삿 5:19-31', books), books),
    'fullRef는 parseRef+formatRef 한 벌이다');

  console.log('PASS  구절 표기 풀기 9가지');
}

// ── 묵상 제목 (0062 · 2026-09-11) ───────────────────────────────────────────
// 예배 노트 종이의 머리에는 주보의 설교 제목이 서는데 묵상 노트는 그 자리가 늘 비어
// 구절만 올라왔다. 사용자 요청으로 쓰는 사람이 직접 제목을 단다 — 저장 자리는 컬럼이다
// (HANDOFF §3-1: 묵상과 언제나 같이 읽고 쓰고 값이 하나뿐이다).
// SQL이라 브라우저 없이 **글자로** 본다(0054·0058을 보는 방식 그대로).
{
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const m62 = src('../supabase/migrations/0062_qt_title.sql');
  assert.ok(/add column if not exists title text not null default ''/.test(m62),
    "0062는 qt_entries에 title을 not null default ''로 더한다");
  assert.ok(/alter table public\.qt_entries/.test(m62), '표는 qt_entries다');
  assert.ok(/comment on column public\.qt_entries\.title is/.test(m62), '칸에 설명이 붙는다');
  // 되돌리는 SQL은 파일 맨 아래 주석(HANDOFF §5)
  assert.ok(/--\s*alter table public\.qt_entries drop column if exists title;/.test(m62),
    '되돌리는 SQL이 맨 아래 주석에 있다');
  // 정책은 **행 단위**라 바꿀 것이 없다 — 이 파일이 정책을 건드리면 0061의 경계가 흔들린다
  assert.ok(!/create policy|drop policy/.test(m62), '정책은 건드리지 않는다(행 단위라 그대로다)');

  // 저장 계층이 그 칸을 읽고 쓴다 — 셋 중 하나만 빠져도 제목이 어디선가 사라진다
  const wordSrc = src('../src/services/word.js');
  assert.ok(/\.select\('id, qt_date, body, title, shared'\)/.test(wordSrc), '내 묵상 조회가 title을 읽는다');
  assert.ok(/title: t, shared: !!shared, updated_at/.test(wordSrc), 'upsert가 title을 쓴다');
  assert.ok(/\.select\('id, profile_id, body, title, updated_at, profiles/.test(wordSrc),
    '나눔 피드 조회도 title을 싣는다');
  // 0062를 아직 안 넣은 판에서 온 행에도 안 죽어야 한다
  assert.ok(/const entryTitle = \(row\) => String\(row\?\.title \?\? ''\);/.test(wordSrc),
    'title이 없는 행은 빈 글자로 받는다');

  // 화면 — 제목 칸은 **편집 종이 위**에 있고(테두리 없는 입력), 자리표는 '제목 미정'이다
  const paperSrc = src('../src/components/paper.jsx');
  assert.ok(/placeholder="제목 미정"/.test(paperSrc), "자리표는 '제목 미정' 하나다");
  assert.ok(/paper-title-input[\s\S]{0,120}border-0 bg-transparent outline-none/.test(paperSrc),
    '제목 칸에는 테두리·배경이 없다(종이 위에 바로 쓴다)');
  assert.ok(/const TITLE_TYPE = /.test(paperSrc) && (paperSrc.match(/\$\{TITLE_TYPE\}/g) || []).length >= 3,
    '읽기 문단과 입력 칸이 같은 글자 규격을 쓴다');
  // 빈 묵상 판정은 **본문만** 본다(사용자 결정 2026-09-11 — 제목만 적은 날은 빈 노트다)
  const viewSrc = src('../src/views/wordView.jsx');
  assert.ok(/const hasText = !isTemplateOnly\(body, passageRef\);/.test(viewSrc),
    '제목은 빈 노트 판정에 들어오지 않는다');
  // 다만 제목만 고쳐도 저장은 열린다(고친 것이 있다는 뜻이다) — 본문이 비어 있으면
  // hasText가 거짓이라 여전히 저장되지 않는다
  assert.ok(/const dirty = ready && \(body !== base \|\| title\.trim\(\) !== baseTitle\);/.test(viewSrc),
    '제목만 고쳐도 저장 버튼이 열린다');
  // 실시간으로 남이 고친 글이 편집기를 덮지 않게, 제목도 **제 판정**으로 간다(§6-24-c)
  assert.ok(/shouldAdoptBody\(\{ dateChanged, body: titleRef\.current, lastSynced: syncedTitle\.current, next: next\.title \}\)/.test(viewSrc),
    '제목은 제 shouldAdoptBody로 갈아 끼운다');

  console.log('PASS  묵상 제목 저장 자리와 화면 15가지');
}

// ── 홈 예배 카드 · 형제/자매 호칭 (사용자 결정 2026-09-14) ───────────────────
// 셋 다 순수 함수 하나씩이고 화면은 부르기만 한다 — 함수를 직접 돌리고 **배선**은
// 소스로 못 박는다(위 호칭 블록과 같은 짜임).
// 되돌려서 깨뜨린 것(§3-5): pickService의 `status === 'published'`를 빼면 ①,
// homeWorshipLabel의 `date === base` 갈래를 빼면 ②,
// honorific의 BY_GENDER 줄을 HONORIFIC.youth로 되돌리면 ③이 깨진다.
{
  const src = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const home = src('../src/views/homeView.jsx');

  // homeView는 JSX라 통째로는 노드에서 못 읽는다 — **순수 함수 둘만** 오려 낸다.
  // (닫는 `}`가 열 0에 서는 것이 이 오려내기의 전제다 — 그 관례가 깨지면 여기서 드러난다.)
  const cutFn = (name) => {
    const m = new RegExp(String.raw`^export function ${name}\([\s\S]*?\n\}`, 'm').exec(home);
    assert.ok(m, `homeView.jsx가 ${name}를 export 한다`);
    return m[0];
  };
  const { pickService, homeWorshipLabel } = await loadSource('src/views/homeView.jsx', { src: `const kstToday = () => '2026-09-14';\n${cutFn('pickService')}\n${cutFn('homeWorshipLabel')}\n`, as: 'home.mjs' });

  // ① 홈에 서는 주보 — **발행본 중 가장 최근 날짜**(앞으로 올 것도 고른다)
  const list = [
    { id: 'a', status: 'published', service_date: '2026-08-30' },
    { id: 'b', status: 'published', service_date: '2026-09-06' },
    { id: 'c', status: 'draft', service_date: '2026-09-20' },
    { id: 'd', status: 'published', service_date: '2026-09-20' },
    { id: 'e', status: 'published', service_date: '' },
  ];
  assert.strictEqual(pickService(list)?.id, 'd', '앞으로 올 발행본이 있으면 그것이 가장 최근이다');
  assert.strictEqual(pickService(list.filter(s => s.id !== 'd'))?.id, 'b',
    '앞으로 올 발행본이 없으면 지난 발행본 중 가장 최근');
  assert.strictEqual(pickService([list[2]]), null,
    '작성 중인 주보는 홈에 오르지 않는다(사용자 결정 2026-09-14) — 카드가 아예 서지 않는다');
  assert.strictEqual(pickService([list[4]]), null, '날짜가 없거나 모양이 깨진 행은 세지 않는다');
  assert.strictEqual(pickService([]), null);
  assert.strictEqual(pickService(), null);

  // ② 카드 라벨 셋 — **주를 보지 않는다**(사용자 결정 2026-09-18). 오늘과 주보 날짜만
  // 견준다. 주 경계로 갈랐을 때 어느 시작을 골라도 한쪽이 틀렸던 자리를 다 짚는다.
  const L = (iso, today) => homeWorshipLabel(iso, today);
  assert.strictEqual(L('2026-09-20', '2026-09-18'), '다가오는 예배',
    '금요일에 보는 다가오는 주일 — 월요일 시작이면 여기가 이번 주로 나왔다(사용자 신고)');
  assert.strictEqual(L('2026-09-20', '2026-09-20'), '오늘 예배', '예배 당일');
  assert.strictEqual(L('2026-09-20', '2026-09-21'), '지난 예배',
    '월요일이 되면 어제 주일은 지난 예배 — 주일 시작이면 여기가 이번 주로 남았다');
  assert.strictEqual(L('2026-09-18', '2026-09-16'), '다가오는 예배',
    '금요 예배도 같은 잣대다 — 주 단위 말이 애초에 안 맞는 자리(§7 · 예배는 주일과 금요 둘)');
  assert.strictEqual(L('2026-10-04', '2026-09-16'), '다가오는 예배', '두 주 뒤라도 아직 안 온 예배다');
  assert.strictEqual(L('2026-09-13', '2026-09-16'), '지난 예배', '지난 주일');
  assert.strictEqual(L('bad', '2026-09-16'), '', '못 읽는 날짜에는 아무 말도 하지 않는다');
  assert.strictEqual(L('2026-09-16', 'bad'), '');

  // ③ 호칭 여섯 갈래 — 교역자 · 부장 · 형제 · 자매 · 아직 비어 있음 · 명단 밖
  const strip = (t) => t.replace(/^import \{[^}]*\} from '\.\.?\/(supabaseClient|cloud|cloud\/core|image)\.js';\s*$/gm, '');
  // 호칭은 2026-09-26부터 순수 모듈 honorific.js에 있고 people.js가 다시 내보낸다
  const { honorific, honorificsOf, HONORIFIC } = await loadSource('src/services/people.js', { src: strip(src('../src/services/people.js')), siblings: ['src/services/honorific.js'] });
  assert.deepStrictEqual(HONORIFIC,
    { pastor: '전도사님', director: '부장님', brother: '형제', sister: '자매', youth: '청년' });
  assert.strictEqual(honorific('임성빈', { isPastor: true, gender: 'f' }), '임성빈 전도사님',
    '교역자가 성별보다 먼저다');
  assert.strictEqual(honorific('신효진', { roles: ['director'], gender: 'f' }), '신효진 부장님',
    '그 해 부장이 성별보다 먼저다');
  assert.strictEqual(honorific('문진우', { gender: 'm' }), '문진우 형제');
  assert.strictEqual(honorific('신효진', { gender: 'f' }), '신효진 자매');
  assert.strictEqual(honorific('노준석', { gender: null, roles: [] }), '노준석 청년',
    '성별이 아직 비어 있으면 예전처럼 청년이다(0064는 nullable — 53명을 손으로 채우는 중)');
  assert.strictEqual(honorific('한상록 강사님', null), '한상록 강사님',
    '명단에 없는 객원은 적은 글자 그대로');
  assert.strictEqual(honorific('조준환', { roles: ['lead_team'], gender: 'm' }), '조준환 형제',
    '부장 말고 다른 직분은 성별 호칭을 막지 않는다');
  // 한 벌(honorificsOf)도 gender를 싣는다 — 안 실으면 조용히 전부 '청년'이 된다
  const nameOf = honorificsOf(
    [{ id: 'p1', name: '임성빈', is_pastor: true, gender: 'm' },
      { id: 'p2', name: '신효진', gender: 'f' },
      { id: 'p3', name: '말감이', roster_name: '임재훈', gender: 'm' },
      { id: 'p4', name: '아직' }],
    [{ person_id: 'p2', year: 2026, role: 'director' }],
  );
  assert.strictEqual(nameOf('임성빈'), '임성빈 전도사님');
  assert.strictEqual(nameOf('신효진'), '신효진 부장님');
  assert.strictEqual(nameOf('임재훈'), '임재훈 형제', '명단에 적힌 이름으로 찾아도 성별이 붙는다');
  assert.strictEqual(nameOf('아직'), '아직 청년');

  // ④ 배선 — 함수가 맞아도 화면이 안 부르면 그대로다
  assert.ok(/gender/.test(/\.select\('id, name[^']*'\)/.exec(src('../src/services/people.js'))?.[0] || ''),
    'fetchPeople의 select에 gender가 있다 — 빠지면 화면이 조용히 전부 청년이 된다');
  assert.ok(/label=\{homeWorshipLabel\(church\.service\.service_date, day\)\}/.test(home),
    '홈 예배 카드의 머리 글자는 주보 날짜가 정한다');
  assert.ok(!/label="돌아오는 주 예배"/.test(home), "'돌아오는 주 예배' 고정 문구는 사라졌다");
  assert.ok(!/home-worship-draft/.test(home),
    '발행본만 오르므로 카드 안의 작성 중 표시는 죽은 코드다 — 같이 걷었다');
  assert.ok(/church\.service\.preacher/.test(home), '메타 줄 끝은 설교자다');
  assert.ok(!/담당자 \$\{church\.service\.roles/.test(home) && !/찬양 \$\{church\.service\.songs/.test(home),
    '담당자 수·찬양 수 도막은 홈에서 뺐다(사용자 결정 2026-09-14)');
  const ros = src('../src/components/roster.jsx');
  assert.ok(/on\.gender\(person, person\.gender === g \? null : g\)/.test(ros),
    '켠 성별 칩을 다시 누르면 비운다(null) — 잘못 눌렀을 때 돌아갈 길');
  assert.ok(/<PanelRow label="성별">/.test(ros) && /GENDER_STYLE\[g\]/.test(ros),
    '성별은 직분과 같은 Chip·같은 줄 모양이고 색은 토큰이다');
  assert.ok(!/bg-(red|blue|pink|green)-\d{3}/.test(ros), '색은 토큰만 쓴다(Tailwind 기본 팔레트 금지)');
  assert.ok(/소속 <span/.test(ros) && !/소속 팀 </.test(ros), "명단 폼의 라벨은 '소속'이다");
  const rsvc = src('../src/services/roster.js');
  assert.ok(/export async function setGender/.test(rsvc) && /gender: value/.test(rsvc),
    'roster.js가 성별 쓰기 길을 가진다');
  assert.ok(/const COLS = 'id, name, birthday, teams, gender,/.test(rsvc),
    '쓰고 돌려받는 칸에도 gender가 있다');
  const mem = src('../src/views/membersView.jsx');
  assert.ok(/gender: \(p, next\) => write\(p\.id, \(\) => roster\.setGender\(p\.id, next\)/.test(mem),
    '멤버 화면의 쓰기 껍데기(write)를 그대로 탄다 — busy·실패 토스트가 직분과 같다');
  assert.ok(/patchPerson\(p\.id, \{ gender: next \}\)/.test(mem),
    '성공하면 그 줄만 갈아 끼운다(putBook이 예배·모임 캐시를 비운다)');
  console.log('PASS  홈 예배 카드 · 형제/자매 호칭 43가지');
}

// ── 성경 읽기의 최근 검색어 (word.pushRecentSearch · removeRecentSearch · 0065) ──
// 사용자 요구(2026-09-14): "검색어 클릭 시 바로 검색 실행, 삭제 기능 포함. 사용자당 최대
// 30개 노출, 가장 최근 검색어가 최상단, 30개 넘어가면 가장 오래된 것 자동으로 삭제."
// 상한·중복 제거·자르기는 **클라이언트가 한다**(0065 머리말) — 그 규칙이 한 함수에 있는지,
// 그리고 화면이 그 함수를 부르는지를 못 박는다.
// 되돌리기 검사(§3-5): `...rows.filter(r => r.q !== text)`를 `...rows`로 바꾸면 ①이,
// `.slice(0, RECENT_SEARCH_MAX)`를 지우면 ③이, `if (!text) return rows;`를 지우면 ④가,
// `.trim()`을 지우면 ④-b가, removeRecentSearch의 filter를 지우면 ⑤가 깨진다(다섯 다 확인).
{
  const src = readFileSync(new URL('../src/services/word.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/,
      'const supabase = null; const myUid = async () => null;')
    .replace(/^import \{ unwrap \} from '\.\/cloud\/core\.js';$/m, 'const unwrap = ({ data, error }) => { if (error) throw error; return data; };');
  const { pushRecentSearch, removeRecentSearch, RECENT_SEARCH_MAX } = await loadSource('src/services/word.js', { src });

  assert.strictEqual(RECENT_SEARCH_MAX, 30, '사용자당 30개');

  // ① 같은 검색어를 다시 치면 줄이 쌓이지 않고 맨 위로 올라간다(시각만 새로)
  let list = pushRecentSearch([], '사사기', 't1');
  list = pushRecentSearch(list, '사랑', 't2');
  list = pushRecentSearch(list, '사사기', 't3');
  assert.strictEqual(list.length, 2, '같은 검색어가 두 줄이 되지 않는다');
  assert.deepStrictEqual(list.map(r => r.q), ['사사기', '사랑'], '가장 최근 검색어가 최상단');
  assert.strictEqual(list[0].at, 't3', '줄을 새로 쌓지 않고 시각만 간다');

  // ② 새 검색어는 언제나 맨 앞
  assert.strictEqual(pushRecentSearch(list, '요나', 't4')[0].q, '요나', '새 검색어는 언제나 맨 앞');

  // ③ 31번째에서 가장 오래된 것이 빠진다
  let many = [];
  for (let i = 1; i <= 31; i++) many = pushRecentSearch(many, `말${i}`, `t${i}`);
  assert.strictEqual(many.length, 30, '상한 30을 넘지 않는다');
  assert.strictEqual(many[0].q, '말31', '맨 위는 방금 친 것');
  assert.strictEqual(many[29].q, '말2', '가장 오래된 말1이 뒤에서 빠졌다');
  assert.ok(!many.some(r => r.q === '말1'), '빠진 것은 목록에 없다');

  // ④ 빈 글자 · 앞뒤 공백
  assert.deepStrictEqual(pushRecentSearch(list, '   ', 't5'), list, '공백뿐인 검색어는 남기지 않는다');
  assert.deepStrictEqual(pushRecentSearch(list, '', 't5'), list, '빈 글자는 남기지 않는다');
  const trimmed = pushRecentSearch(list, '  사랑  ', 't6');
  assert.strictEqual(trimmed[0].q, '사랑', '앞뒤 공백은 다듬는다');
  assert.strictEqual(trimmed.length, 2, '다듬은 뒤 같은 말이면 쌓이지 않고 올라간다');

  // ⑤ 삭제도 순수 함수 — 견주는 기준은 남길 때와 같다
  assert.deepStrictEqual(removeRecentSearch(list, ' 사랑 ').map(r => r.q), ['사사기'],
    '삭제도 다듬은 글자로 견준다');
  assert.deepStrictEqual(removeRecentSearch(list, '없는말').map(r => r.q), ['사사기', '사랑'],
    '없는 것을 지워도 목록은 그대로');

  // ⑥ 모양이 깨진 옛 값은 걸러진다(화면이 빈 줄을 그리지 않게)
  assert.deepStrictEqual(pushRecentSearch([{ q: '  ' }, null, 'x', { q: '요한', at: 5 }], '눅', 'z'),
    [{ q: '눅', at: 'z' }, { q: '요한', at: '5' }], '모양이 깨진 옛 값은 걸러진다');

  // 배선 — 순수 함수만 맞아도 화면이 안 부르면 그대로다
  const bible = readFileSync(new URL('../src/components/wordBible.jsx', import.meta.url), 'utf8');
  assert.strictEqual((bible.match(/pushRecentSearch\(/g) || []).length, 1,
    '검색어를 남기는 자리는 runSearch 하나다(글자를 칠 때마다 남기면 세 줄이 쌓인다)');
  assert.ok(/const pickRecent = \(q\) => \{[^}]*runSearch\(q\);/.test(bible),
    '최근 검색어를 누르면 지금 검색을 시작하는 그 길로 간다');
  assert.ok(/removeRecentSearch\(state\.recentSearches, q\)/.test(bible), '줄마다 지울 수 있다');
  // 2026-09-25부터는 '이런 마음일 때' 칩이 있으면(AI 있는 판) 최근 검색어가 없어도 판이 선다(목업 5번)
  assert.ok(/const recentOpen = focused && !typed && \(recent\.length > 0 \|\| moodsOn\);/.test(bible),
    '검색어를 비운 채 칸에 들어왔을 때만 목록이 선다');
  // 판이 떠 있는 동안 칸 안 안내 문구는 첫 줄에 멎는다(사용자 결정 2026-09-14) —
  // 같은 `recentOpen` 하나를 봐야 판이 열린 순간과 문구가 멎는 순간이 어긋나지 않는다
  assert.ok(/hints=\{recentOpen \? hints\.slice\(0, 1\) : hints\}/.test(bible),
    '판이 떠 있는 동안 안내 문구가 계속 갈아탄다');
  assert.ok(/onMouseDown=\{e => e\.preventDefault\(\)\}/.test(bible),
    '누르는 순간 칸이 포커스를 잃어 목록이 사라지지 않는다');

  // 저장 자리는 bible_state 한 행이다(0065) — 새 왕복을 만들지 않는다
  assert.ok(/\.select\('last_ref, bookmarks, highlights, recent_searches'\)/.test(src),
    '읽기는 bible_state를 읽던 그 한 벌에 얹혀 있다');
  assert.ok(/recent_searches: recentRows\(next\.recentSearches\)/.test(src),
    '쓰기도 그 upsert 한 벌이다');
  // 0080의 나도 나누기(share_reads)는 **일부러 따로 오간다**(loadReadShare·saveReadShare — 0080이 늦게 나가도
  // 북마크·형광펜 저장이 같이 실패하지 않게). 그 둘을 빼면 여전히 읽기·쓰기 한 벌이다.
  const stateTrips = src.split(/(?=from\('bible_state'\))/).slice(1).filter(c => !/^from\('bible_state'\)[^;]*share_reads/.test(c));
  assert.strictEqual(stateTrips.length, 2,
    'bible_state를 오가는 왕복은 읽기·쓰기 둘뿐이다');

  console.log('PASS  성경 읽기 최근 검색어 (0065) 21가지');
}

// ── 홈·모임은 주보를 가볍게 읽는다 (worship.fetchServices columns · fetchAttendanceCounts since · 2026-09-24) ──
// 홈·모임은 '출석이 든 가장 최근 주일' 하나를 찾으려고 출석 표 두 개를 통째로 읽고, 주보는
// 찬양·광고·임사자 jsonb까지 받았다. 이제 출석은 최근 여덟 주 주보 것만, 주보는 그 화면이 읽는
// 칸만이다. **칸을 빼면 그 칸을 읽는 소비자가 조용히 빈 값을 본다** — 그래서 소비자가 읽는 칸이
// 전부 들어 있는지를 소스에서 맞대 본다. 예배 목록은 지난 주보마다 '출석 N명'이라 전체를 센다.
// 되돌리기 검사: GUIDE_SERVICE_COLS에서 songs를 빼면 '가이드 프롬프트가 읽는 칸'이, 게스트
// 갈래의 since 거르기를 지우면 '게스트도 같은 창'이 깨진다.
{
  const raw = readSplit('src/services/worship.js');
  const seed = {
    services: [{ id: 'old', service_date: '2026-06-01' }, { id: 'new', service_date: '2026-09-20' }],
    attendance: [{ service_id: 'old' }, { service_id: 'new' }, { service_id: 'new' }],
    attendance_guests: [{ service_id: 'old' }, { service_id: 'new' }],
  };
  const part = (f) => 'const supabase = null; const myUid = () => null;\n' + readSrc(`src/services/worship/${f}`)
    .replace(/^import \{[^}]*\} from '\.\.?\/(supabaseClient|cloud|cloud\/core|image)\.js';\s*$/gm, '')
    // localDate·byName은 2026-09-24부터 utils·people에서 온다(한 벌로 모았다)
    .replace(/^import .*from '(?:\.\.\/)+utils\.js';\s*$/gm, 'const generateId = () => "id"; const localDate = (d) => new Date(d).toLocaleDateString("sv-SE");')
    .replace(/^import .*from '\.\.?\/people\.js';\s*$/gm,
      `const guestStore = () => ({ all: () => ({}), rows: (t) => (${JSON.stringify(seed)})[t] || [], set: () => {} }); const byName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ko");`)
    .replace(/from '\.\.\//g, "from './");
  const dirW = tmpDir();
  const pureW = await loadSource('src/services/worship/pure.js', { src: part('pure.js'), dir: dirW, siblings: [
    'src/services/titleText.js',
    'src/services/cueDigest.js',   // copyExportAs(순수)
    // serviceView.js(표지 갈래 · 0081)와 그것이 부르는 noteTemplate.js도 순수 모듈이라 그대로 옆에 둔다
    ...['serviceView.js', 'noteTemplate.js', 'honorific.js'].map(f => `src/services/${f}`),
  ] });
  const W = { ...pureW, ...await loadSource('src/services/worship/attendance.js', { src: part('attendance.js').replace(/^import \{ worshipPerms \} from '\.\/pure\.js';\s*$/m, ''), dir: dirW }) };

  // ① 창 — 오늘(KST 날짜 글자)에서 56일 전. 달·해를 넘어도 글자로만 셈한다
  assert.strictEqual(W.COUNT_WINDOW_DAYS, 56, '여덟 주');
  assert.strictEqual(W.countsSince('2026-09-24'), '2026-07-30');
  assert.strictEqual(W.countsSince('2026-01-10'), '2025-11-15', '해를 넘는다');
  assert.strictEqual(W.countsSince('2024-03-01', 1), '2024-02-29', '윤년');
  assert.strictEqual(W.countsSince('nope'), '', '못 읽는 날짜면 빈 글자 — 그러면 전체를 센다');

  // ② 게스트 갈래도 같은 창으로 센다(명단 출석 + 손님)
  assert.deepStrictEqual(await W.fetchAttendanceCounts(), { old: 2, new: 3 }, 'since 없으면 전체');
  assert.deepStrictEqual(await W.fetchAttendanceCounts({ since: '2026-07-30' }), { new: 3 },
    'since가 있으면 그 날짜 이후 주보만 — 게스트도 같은 창');

  // ③ 클라우드 갈래 — 주보 날짜로 붙여 거른다(왕복 하나 · 두 표 모두)
  assert.ok(/select\('service_id, services!inner\(service_date\)'\)\.gte\('services\.service_date', since\)/.test(raw),
    '출석 수의 창은 services!inner로 붙여 주보 날짜로 거른다');
  assert.ok(/count\('attendance'\), count\('attendance_guests'\)/.test(raw), '명단 출석과 손님 둘 다 같은 창');

  // ④ 배선 — 홈·모임은 창과 가벼운 열, 예배 목록은 전체
  const view = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const home = view('../src/views/homeView.jsx');
  const groups = view('../src/views/groupsView.jsx');
  const worshipV = view('../src/views/worshipView.jsx');
  assert.ok(/fetchServices\(\{ columns: HOME_SERVICE_COLS \}\)/.test(home)
    && /fetchAttendanceCounts\(\{ since: countsSince\(day\) \}\)/.test(home), '홈은 가벼운 열 + 여덟 주');
  assert.ok(/fetchServices\(\{ columns: GUIDE_SERVICE_COLS \}\)/.test(groups)
    && /fetchAttendanceCounts\(\{ since: countsSince\(\) \}\)/.test(groups), '모임은 가이드 열 + 여덟 주');
  assert.ok(/fetchServices\(\), fetchAttendanceCounts\(\),/.test(worshipV),
    '예배 목록은 전체 열·전체 출석 — 지난 주보마다 출석 N명 · 최근 곡 · 임사자 물려받기');

  // ⑤ 소비자가 읽는 칸이 전부 들어 있나
  const cols = (s) => new Set(s.split(',').map(c => c.trim()));
  const homeCols = cols(W.HOME_SERVICE_COLS);
  const guideCols = cols(W.GUIDE_SERVICE_COLS);
  // 홈 카드가 읽는 칸(church.service.X) + 고르는 함수 셋(pickService·pastSunday·attendanceSunday)이 보는 칸
  const cardReads = [...new Set([...home.matchAll(/church\.service\.(\w+)/g)].map(m => m[1]))];
  assert.ok(cardReads.length >= 4, `홈 카드가 읽는 칸을 찾았다(${cardReads})`);
  for (const c of [...cardReads, 'id', 'kind', 'status', 'service_date']) {
    assert.ok(homeCols.has(c), `홈 주보 열에 ${c}가 있다`);
  }
  // 모임은 홈 칸 전부 + 가이드 프롬프트가 읽는 칸(sunGuide.songLine · buildGuidePrompt · generateGuide)
  // 작업 사본이 CRLF일 수 있다(autocrlf) — 함수 끝('\n}\n')을 찾기 전에 줄끝을 맞춘다
  const guideSrc = view('../src/services/sunGuide.js').replace(/\r\n/g, '\n');
  const body = (sig) => {
    const at = guideSrc.indexOf(sig);
    return at < 0 ? '' : guideSrc.slice(at, guideSrc.indexOf('\n}\n', at));
  };
  const promptSrc = ['export function songLine(', 'export function buildGuidePrompt(', 'export async function generateGuide(']
    .map(body).join('\n');
  const guideReads = [...new Set([...promptSrc.matchAll(/\b(?:s|service)\??\.(\w+)/g)].map(m => m[1]))];
  assert.ok(guideReads.includes('songs') && guideReads.includes('praise_leader') && guideReads.includes('passage_ref'),
    `가이드가 읽는 칸을 찾았다(${guideReads})`);
  for (const c of guideReads) assert.ok(guideCols.has(c), `모임 주보 열에 가이드 프롬프트가 읽는 ${c}가 있다`);
  for (const c of homeCols) assert.ok(guideCols.has(c), `모임 열은 홈 열을 다 담는다(${c})`);
  console.log('PASS  홈·모임 주보 가볍게 읽기 14가지');
}

// ── 순모임 가이드 굽기 열쇠는 글의 해시 (components/sunGuide.jsx · 2026-09-24) ─────────────
// 열쇠가 JSON 길이였을 때는 같은 글자 수로 고치면(오타 하나) 열쇠가 그대로라 **옛 그림이 나갔다**.
// 되돌리기 검사: 열쇠를 `.length`로 되돌리면 마지막 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/components/sunGuide.jsx', import.meta.url), 'utf8');
  const fn = /const textHash = (\(str\) => \{[\s\S]*?\n\};)/.exec(src.replace(/\r\n/g, '\n'))?.[1];
  assert.ok(fn, 'textHash를 찾지 못했다');
  const textHash = (0, eval)(fn.slice(0, -1));
  const a = JSON.stringify({ points: [{ body: '하나님이 들으셨다' }] });
  const b = JSON.stringify({ points: [{ body: '하나님이 들으셨나' }] });   // 같은 길이, 한 글자만 다르다
  assert.strictEqual(a.length, b.length);
  assert.notStrictEqual(textHash(a), textHash(b), '같은 글자 수라도 글이 다르면 열쇠가 다르다');
  assert.strictEqual(textHash(a), textHash(String(a)), '같은 글이면 같은 열쇠');
  assert.ok(/key: `\$\{selectedId \|\| ''\}:\$\{guide \? textHash\(JSON\.stringify\(guide\)\) : 0\}`/.test(src),
    '굽기 열쇠가 글의 해시를 쓴다(길이가 아니라)');
  console.log('PASS  가이드 굽기 열쇠 4가지');
}

// ── 2026-09-25 묶음: 모임·홈·성경 검색·달력의 순수 로직 ─────────────────────
// ① 동아리 카드 '다음 동아리 모임 26. 9. 28.' — 날짜 모양(YY. M. D.)과 동아리마다 가장 이른 앞날(오늘 포함)
// ② 홈 내 순 카드의 '공유된 노트 N'은 주보별 개수에서 그 주보 것만(countByService)
// ③ 노트 공유 알림 링크는 그 주보를 싣는다(note= · s가 아니다 — 예배 화면이 s를 먼저 집는다)
// ④ 성경 낱말 검색은 띄어쓰기를 지우고 견주고, 칠할 자리는 원문 자리로 돌려준다(matchRanges)
// ⑤ 전체 일정 달력은 2026년 1월 ~ 내년 12월(calendarBounds · clampMonth)
// 되돌리기 검사(§3-5): nextMeetingDates의 `d < today`를 지우면 ①-b가, countByService의 `+ 1`을 `= 1`로
// 바꾸면 ②가, matchRanges의 `continue`(공백 건너뛰기)를 지우면 ④-b가, calendarBounds의 `y + 1`을 `y`로
// 바꾸면 ⑤-a가 깨진다.
{
  const gsrc = readFileSync(new URL('../src/services/groups.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^/, "const supabase = null; const myUid = async () => null; const kstNow = () => '2026-09-25 10:00:00';"
      + " const SUNDAY_KIND = 'sunday'; const generateId = () => 'id'; const insertNotifications = async () => 0;"
      + " const fetchMyNote = async () => null; const saveMyNote = async () => null; const byName = () => 0;"
      + " const guestStore = () => ({ all: () => ({}), rows: () => [], set: () => {} });\n");
  const G = await loadSource('src/services/groups.js', { src: gsrc });
  assert.strictEqual(G.meetingDateShort('2026-09-28'), '26. 9. 28.', '사용자 문구의 날짜 모양 그대로');
  assert.strictEqual(G.meetingDateShort('2027-01-05'), '27. 1. 5.');
  assert.strictEqual(G.meetingDateShort(''), '');
  const next = G.nextMeetingDates([
    { group_id: 'a', meeting_date: '2026-10-03' }, { group_id: 'a', meeting_date: '2026-09-28' },
    { group_id: 'b', meeting_date: '2026-09-20' },                       // 지난 모임 — 다음이 아니다
    { group_id: 'c', meeting_date: '2026-09-25' },                       // 오늘은 '다음'에 든다
    { group_id: '', meeting_date: '2026-09-30' }, { group_id: 'd', meeting_date: 'bad' },
  ], '2026-09-25');
  assert.deepStrictEqual(next, { a: '2026-09-28', c: '2026-09-25' }, '동아리마다 가장 이른 앞날 · 지난 것과 깨진 행은 버린다');

  assert.deepStrictEqual(G.countByService([
    { service_id: 's1' }, { service_id: 's1' }, { service_id: 's2' }, { service_id: null },
    { service_id: 's2', body: '   ' },                                  // 게스트 행 — 빈 노트는 세지 않는다
  ]), { s1: 2, s2: 1 }, '주보별로 센다(전 기간 합계가 아니다)');

  const wsrc = readSplit('src/services/worship.js');
  assert.ok(/link: noteSharedLink\(service\.id\)/.test(wsrc) && /noteSharedLink = \(serviceId\) => `\/\?p=groups&note=\$\{serviceId\}`/.test(wsrc),
    '노트 공유 알림은 그 주보를 note=로 싣는다');
  // 순장 한 사람만 묻는다(2026-10-07 · 예전에는 명단 전체를 읽고 골랐다) — 명단 목록과 같은 조건(내보낸 사람은 뺀다)
  const nns = wsrc.slice(wsrc.indexOf('export async function notifyNoteShared'), wsrc.indexOf('export async function removeService'));
  assert.ok(nns.length > 0 && !/fetchPeople\(/.test(nns)
    && /from\('people'\)\.select\('profile_id'\)\s*\.eq\('id', mine\.leader_person_id\)\.is\('removed_at', null\)\.maybeSingle\(\)/.test(nns),
    '노트 공유 알림이 순장을 찾으려고 명단 전체를 읽는다');
  const gvsrc = readFileSync(new URL('../src/views/groupsView.jsx', import.meta.url), 'utf8');
  assert.ok(/entryOf\('note'\)/.test(gvsrc) && /entryOf\('guide'\)/.test(gvsrc), '모임 화면이 note·guide를 읽는다');

  const wordSrc = readFileSync(new URL('../src/services/word.js', import.meta.url), 'utf8')
    .replace(/import \{ supabase, myUid \} from '\.\/supabaseClient\.js';/, 'const supabase = null; const myUid = async () => null;')
    .replace(/^import \{ unwrap \} from '\.\/cloud\/core\.js';$/m, 'const unwrap = ({ data, error }) => { if (error) throw error; return data; };');
  const W = await loadSource('src/services/word.js', { src: wordSrc });
  assert.strictEqual(W.compactText(' 사랑 하는\t자 '), '사랑하는자');
  assert.deepStrictEqual(W.matchRanges('하나님이 자기 형상 곧 하나님의 형상대로', '하나님'), [[0, 3], [13, 16]], '한 절에 두 번');
  const verse = '내가 너희를 사랑 하는 것 같이';
  const r = W.matchRanges(verse, '사랑하는');
  assert.deepStrictEqual(r, [[7, 12]], '띄어쓰기가 달라도 찾고, 원문 자리(공백 포함)로 돌려준다');
  assert.strictEqual(verse.slice(r[0][0], r[0][1]), '사랑 하는');
  assert.deepStrictEqual(W.matchRanges('태초에 하나님이', '태초 에하나님'), [[0, 7]], '검색어 쪽 공백도 지운다');
  assert.deepStrictEqual(W.matchRanges('아무 말', '   '), [], '빈 검색어는 없음');
  const bibleSrc = readFileSync(new URL('../src/components/wordBible.jsx', import.meta.url), 'utf8');
  assert.ok(/packed\[c\]\[v\]\.includes\(needle\)/.test(bibleSrc) && /const needle = compactText\(q\)/.test(bibleSrc),
    '성경 낱말 검색은 띄어쓰기를 지운 모양으로 견준다');
  assert.ok(!/RESULT_LIMIT/.test(bibleSrc), '50건에서 훑기를 멈추지 않는다(더 보기로 이어 편다)');

  const cal = readFileSync(new URL('../src/components/calendar.jsx', import.meta.url), 'utf8');
  const cut = (re, what) => { const m = re.exec(cal); assert.ok(m, `calendar.jsx에 ${what}가 있다`); return m[0]; };
  const C = await loadSource('src/components/calendar.jsx', { as: 'cal.mjs', src: [
    cut(/^export const CAL_START = .*$/m, 'CAL_START'),
    cut(/^export function calendarBounds\([\s\S]*?\n\}/m, 'calendarBounds'),
    cut(/^const monthIdx = .*$/m, 'monthIdx'),
    cut(/^export function clampMonth\([\s\S]*?\n\}/m, 'clampMonth'),
  ].join('\n') });
  const b26 = C.calendarBounds(new Date(2026, 8, 25));
  assert.deepStrictEqual(b26, { min: { y: 2026, m: 0 }, max: { y: 2027, m: 11 } }, '2026년 1월 ~ 내년 12월');
  const b27 = C.calendarBounds(new Date(2027, 0, 3));
  assert.deepStrictEqual(b27.min, { y: 2026, m: 0 }, '2027년이 되어도 2026년 12월 행사를 볼 수 있다');
  assert.deepStrictEqual(C.clampMonth({ y: 2027, m: -1 }, b27), { y: 2026, m: 11 }, '1월에서 뒤로 가면 지난해 12월');
  assert.deepStrictEqual(C.clampMonth({ y: 2026, m: -1 }, b27), { y: 2026, m: 0 }, '바닥(2026년 1월) 아래로는 안 간다');
  assert.deepStrictEqual(C.clampMonth({ y: 2028, m: 0 }, b27), { y: 2028, m: 0 });
  assert.deepStrictEqual(C.clampMonth({ y: 2028, m: 12 }, b27), { y: 2028, m: 11 }, '위(내년 12월)로도 가둔다');
  assert.ok(!/CAL_MAX_YEAR|= 2030/.test(cal), '2030 상한이 박혀 있지 않다');
  console.log('PASS  9월 25일 묶음(다음 동아리 모임 · 주보별 공유 노트 · 노트 알림 링크 · 성경 띄어쓰기 · 달력 연도)');
}

// ── 교회력 · 광고 → 내 달력 · 주보를 보여 주는 규칙 (2026-09-25 사용자 결정) ────────────
// 셋 다 import 없는 순수 모듈이라 그대로 부른다(churchYear · noticeDate) — serviceView는 순수 모듈
// noteTemplate 하나만 import한다. 화면 배선은 소스로 못 박는다.
// 되돌려서 깨뜨린 것(§3-5): churchSeason의 성령강림절 후 번호를 `weeks(pent, t) + 1`로 바꾸면 큐시트
// 대조가, splitSongTitle을 `' | '`에서도 나누게 하면 찬양 줄 단정이, readNoticeDate의 요일 확인을
// 지우면 '(토) 틀린 요일' 단정이 깨진다.
{
  const CY = await import(new URL('../src/services/churchYear.js', import.meta.url).href);
  // 부활절 — 알려진 해 넷
  assert.deepStrictEqual([2024, 2025, 2026, 2027].map(CY.easterDate), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28']);

  // **큐시트 전례색과 날짜 계산 대조** — 라이브 큐시트 세 장의 요지(files.text_excerpt, 2026-09-25 SELECT)
  // 그대로다. 예배팀은 '오순절 후'라고 적고 우리는 '성령강림절 후'라고 부른다(사용자 결정) — 번호와
  // 색이 같아야 한다. 다른 해의 큐시트가 오면 여기에 한 줄씩 더한다.
  const CUE = [
    ['2026-09-06', '주제: 오순절 후 열 다섯번째 주일 · 전례색: 초록색 - 생명의 희열과 희망의 색, 교회의 성장, 성숙'],
    ['2026-09-13', '주제: 오순절 후 열 여섯 번째 주일 · 전례색: 초록색 - 생명의 희열과 희망의 색, 교회의 성장, 성숙'],
    ['2026-09-20', '주제: 오순절 후 열 일곱번째 주일 · 전례색: 초록색 - 생명의 희열과 희망의 색, 교회의 성장, 성숙'],
  ];
  const UNIT = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };
  const TEN = { 열: 10, 스물: 20, 스무: 20, 서른: 30 };
  const ordinal = (w) => {
    let s = w.replace(/\s+/g, '').replace(/번째$/, '');
    let n = 0;
    for (const [k, v] of Object.entries(TEN)) if (s.startsWith(k)) { n = v; s = s.slice(k.length); break; }
    return n + (s ? (UNIT[s] ?? NaN) : 0);
  };
  const COLOR = { 초록색: 'green', 보라색: 'purple', 흰색: 'white', 백색: 'white', 빨간색: 'red', 붉은색: 'red' };
  for (const [date, text] of CUE) {
    const m = /오순절 후 (.+?번째) 주일 · 전례색: (\S+)/.exec(text);
    assert.ok(m, `큐시트 요지 모양이 바뀌었다: ${text}`);
    const s = CY.churchSeason(date);
    assert.strictEqual(s.liturgical, COLOR[m[2]], `${date} 전례색 — 큐시트 ${m[2]} · 계산 ${s.liturgical}`);
    assert.strictEqual(s.name, `성령강림절 후 제${ordinal(m[1])}주일`, `${date} 절기 번호 — 큐시트 ${m[1]}`);
    assert.strictEqual(s.color, null, '연중은 절기 색이 없다(기본 톤)');
  }
  // 한 해의 경계들
  const nm = (d) => CY.churchSeason(d).name;
  const col = (d) => CY.churchSeason(d).color;
  assert.strictEqual(nm('2026-11-29'), '대림절 제1주일'); assert.strictEqual(col('2026-11-29'), 'purple');
  assert.strictEqual(nm('2026-11-22'), '성령강림절 후 제26주일', '대림 전날 주일까지 연중');
  assert.strictEqual(nm('2026-12-20'), '대림절 제4주일');
  assert.strictEqual(nm('2026-12-25'), '성탄절'); assert.strictEqual(col('2026-12-25'), 'gold');
  assert.strictEqual(nm('2027-01-03'), '성탄절', '새해 첫 닷새는 지난해 성탄절 기간');
  assert.strictEqual(nm('2027-01-06'), '주현절'); assert.strictEqual(col('2027-01-06'), 'gold');
  assert.strictEqual(nm('2027-01-10'), '주현절 후 제1주일'); assert.strictEqual(col('2027-01-10'), null, '주현절 뒤는 연중');
  assert.strictEqual(nm('2027-02-10'), '사순절', '재의 수요일(부활절 −46일)'); assert.strictEqual(col('2027-02-10'), 'purple');
  assert.strictEqual(nm('2027-02-14'), '사순절 제1주일');
  assert.strictEqual(nm('2027-03-28'), '부활주일'); assert.strictEqual(col('2027-03-28'), 'gold');
  assert.strictEqual(nm('2027-04-04'), '부활절 제2주일');
  assert.strictEqual(nm('2026-05-24'), '성령강림주일'); assert.strictEqual(col('2026-05-24'), 'red');
  assert.strictEqual(nm('2026-05-29'), '성령강림절'); assert.strictEqual(col('2026-05-29'), 'red', '빨강은 그 주 토요일까지');
  assert.strictEqual(nm('2026-05-31'), '성령강림절 후 제1주일'); assert.strictEqual(col('2026-05-31'), null);
  assert.strictEqual(nm('2026-09-25'), '성령강림절 후', '주일이 아니면 번호가 없다');
  assert.strictEqual(CY.churchSeason('bad'), null);
  assert.deepStrictEqual(Object.keys(CY.SEASON_MAST).sort(), ['gold', 'purple', 'red'], '종이 띠 색은 특별 절기 셋뿐(연중은 인디고 그대로)');

  // ── 광고 → 날짜 ──
  const ND = await import(new URL('../src/services/noticeDate.js', import.meta.url).href);
  const rd = (title, body, svc) => ND.readNoticeDate({ title, body }, svc);
  // 라이브 광고(9/6·9/13·9/20)는 하나도 읽히지 않는다 — 달만 · 연도만 · 상대 말 · 빈 본문 · 생일 줄
  const LIVE = [
    ['2026-09-20', '다음 주 예배 위원', '대표기도: 이수빈 형제\n헌금봉헌: 윤현서 자매'], ['2026-09-20', '교우동정', '생일자: 조현재 형제 9/20'],
    ['2026-09-20', '다음 주 예배 안내', ''], ['2026-09-20', '예배 캠페인', ''], ['2026-09-13', '교우 동정', '없음'],
    ['2026-09-13', '다음 주 예배 위원', '대표 기도: 강서윤 자매\n헌금 봉헌: 윤현서 자매'], ['2026-09-13', '9월 월례회', ''],
    ['2026-09-13', '청년부 회장 추천', ''], ['2026-09-06', '다음 주 예배 위원', '대표기도: 문진혁 형제\n헌금봉헌: 조준환 형제'],
    ['2026-09-06', '9월 월례회', ''], ['2026-09-06', '다붓 팟캐스트 ', ''], ['2026-09-06', '팀장 모임', ''], ['2026-09-06', '27년도 회장 선출', ''],
  ];
  for (const [svc, t, b] of LIVE) assert.strictEqual(rd(t, b, svc), null, `라이브 광고는 안 읽힌다: ${t}`);
  assert.strictEqual(rd('교우동정', '생일자: 조현재 형제 10/4', '2026-09-20'), null, "'생일' 줄은 뒷날이어도 건너뛴다");
  assert.deepStrictEqual(rd('10월 월례회', '10월 11일(주일) 예배 후 청년부실', '2026-09-27'), { date: '2026-10-11', time: null });
  assert.strictEqual(rd('10월 월례회', '10월 11일(토) 예배 후', '2026-09-27'), null, '요일이 틀리면 칩 없음');
  assert.deepStrictEqual(rd('사역팀장 선출', '10/11 까지 추천서 제출', '2026-09-27'), { date: '2026-10-11', time: null }, 'M/D');
  assert.deepStrictEqual(rd('x', '10.3 14:30 모임', '2026-09-27'), { date: '2026-10-03', time: '14:30' }, 'M.D · H:MM');
  assert.deepStrictEqual(rd('가을 체육대회', '25일 오후 2시, 자세한 장소는 다음 주 광고', '2026-10-18'), { date: '2026-10-25', time: '14:00' }, 'D일 · 상대 말은 거들지 않는다');
  assert.deepStrictEqual(rd('x', '3일 오전 10시 반', '2026-09-27'), { date: '2026-10-03', time: '10:30' }, '지난 D일은 다음 달 · 반');
  assert.deepStrictEqual(rd('송구영신', '1월 3일 오후 7시 30분', '2026-12-27'), { date: '2027-01-03', time: '19:30' }, '연말의 1월은 새해');
  assert.strictEqual(rd('x', '9월 20일 오후 1시 반', '2026-09-20'), null, '주보 날짜 당일은 칩 없음');
  assert.strictEqual(rd('x', '9월 13일', '2026-09-20'), null, '지난 날은 칩 없음');
  assert.strictEqual(rd('예배 2.0', '', '2026-09-27'), null, "'2.0'은 날짜가 아니다");
  assert.strictEqual(rd('수련회', '3일간 진행', '2026-09-27'), null, "'3일간'은 기간이다");
  assert.strictEqual(rd('x', '2월 30일', '2026-01-04'), null, '없는 날');
  assert.strictEqual(ND.noticeDateLabel({ date: '2026-10-11', time: '14:00' }), '10월 11일 (일) 오후 2:00', '칩 글자(목업)');
  assert.strictEqual(ND.noticeDateLabel({ date: '2026-10-11', time: null }), '10월 11일 (일)');
  assert.strictEqual(ND.noticeDateLabel({ date: '2026-10-11', time: '00:05' }), '10월 11일 (일) 오전 12:05');
  // .ics — 한국 시간은 UTC(Z)로 · 하루 종일은 DATE · 글자 이스케이프 · 75옥텟 접기 · CRLF
  const ev = ND.noticeEvent({ id: 'svc1', service_date: '2026-09-27' }, { title: '10월 월례회, 청년부', body: '예배 후; 청년부실' }, 2,
    { date: '2026-10-11', time: '14:00' }, '주일 4부 젊은이 예배');
  assert.deepStrictEqual([ev.uid, ev.title, ev.description], ['svc1-2@thedaboot', '10월 월례회, 청년부', '예배 후; 청년부실\n(2026.09.27 주일 4부 젊은이 예배 광고)']);
  const ics = ND.buildIcs({ ...ev, now: Date.UTC(2026, 8, 27) });
  assert.ok(ics.includes('\r\nDTSTART:20261011T050000Z\r\nDTEND:20261011T060000Z\r\n'), '오후 2시 KST = 05:00Z, 1시간');
  assert.ok(ics.includes('SUMMARY:10월 월례회\\, 청년부'), '쉼표 이스케이프');
  assert.ok(ics.includes('DESCRIPTION:예배 후\\; 청년부실\\n'), '세미콜론·줄바꿈 이스케이프');
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), '한 줄 75옥텟 이하(접기)');
  const allDay = ND.buildIcs({ uid: 'u', title: 't', date: '2026-12-31', time: null, now: 0 });
  assert.ok(allDay.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'), '하루 종일은 다음 날까지');
  const g = new URL(ND.googleCalendarUrl({ title: '월례회', date: '2026-10-11', time: '23:30' }));
  assert.strictEqual(g.searchParams.get('dates'), '20261011T233000/20261012T003000', '구글 주소는 한국 시간 그대로 · 자정을 넘으면 다음 날');
  assert.strictEqual(g.searchParams.get('ctz'), 'Asia/Seoul');
  assert.strictEqual(ND.kakaoExternal('https://a.b/api/ics?s=1&n=2'), 'kakaotalk://web/openExternal?url=https%3A%2F%2Fa.b%2Fapi%2Fics%3Fs%3D1%26n%3D2');

  // api/ics — 공용 머리 · 같은 파서 · 발행본만 · 서명 비교는 safeEqual · 토큰은 주소에 싣지 않는다
  const icsApi = readFileSync(new URL('../api/ics.js', import.meta.url), 'utf8');
  assert.ok(/requireApprovedUser\(req, res/.test(icsApi) && !/auth\.getUser\(/.test(icsApi), 'api/ics는 공용 승인 머리를 쓴다');
  assert.ok(/from '\.\.\/src\/services\/noticeDate\.js'/.test(icsApi) && /readNoticeDate\(notice, data\.service_date\)/.test(icsApi), '서버도 같은 파서로 다시 읽는다');
  assert.ok(/data\.status !== 'published'/.test(icsApi), '발행된 주보만');
  assert.ok(/safeEqual\(/.test(icsApi) && /e < Date\.now\(\)/.test(icsApi), '서명·만료를 본다');
  assert.ok(!/access_token|Bearer \$\{/.test(icsApi.replace(/\/\/.*$/gm, '')), '주소에 접근 토큰을 싣지 않는다');

  // ── 주보를 보여 주는 규칙 ──
  const SV = await import(new URL('../src/services/serviceView.js', import.meta.url).href);
  // 찬양 줄 — 라이브 제목 그대로. `팀 - 제목`만 나누고 나머지는 한 줄 그대로(지어내서 나누지 않는다)
  assert.deepStrictEqual(SV.splitSongTitle('F.I.A LIVE WORSHIP - 예배하는 이에게 (피아버전)'), { team: 'F.I.A LIVE WORSHIP', title: '예배하는 이에게 (피아버전)' });
  assert.deepStrictEqual(SV.splitSongTitle('팀룩워십 - 주를 바라보며 + 주를 찾는 모든 자들이'), { team: '팀룩워십', title: '주를 바라보며 + 주를 찾는 모든 자들이' });
  assert.deepStrictEqual(SV.splitSongTitle('A - B - C'), { team: 'A', title: 'B - C' }, '첫 " - " 기준');
  for (const t of ['예배하는 이에게ㅣMidnight Worship', '빛으로 비추시네 | YKDC | OPEN WORSHIP', '하나님의 나라 | 아이자야씩스티원',
    '예수로 살리  l Anointing', '예수의 길 | 마커스워십', '주 은혜임을', '주-은혜', ' - 제목만', '팀만 - ']) {
    assert.deepStrictEqual(SV.splitSongTitle(t), { team: '', title: t.trim() }, `나누지 않는다: ${t}`);
  }
  // 본명 — personId로, 이름만이면 표시 이름·본명 둘 다 열쇠로. 없으면 그대로(지어내지 않는다)
  const people = [
    { id: 'a', name: '이하랑Alex', roster_name: '이하랑' }, { id: 'b', name: '꽃님', roster_name: '강꽃님' },
    { id: 'c', name: '조준환', roster_name: '조준환' }, { id: 'd', name: '김서진' },
  ];
  const real = SV.realNameOf(people);
  assert.deepStrictEqual(real('이하랑Alex', 'a'), { name: '이하랑', found: true });
  assert.deepStrictEqual(real('옛 이름', 'b'), { name: '강꽃님', found: true }, 'id가 이긴다');
  assert.deepStrictEqual(real('꽃님'), { name: '강꽃님', found: true }, '이름만 — 표시 이름');
  assert.deepStrictEqual(real('강꽃님'), { name: '강꽃님', found: true }, '이름만 — 본명');
  assert.deepStrictEqual(real('김서진'), { name: '김서진', found: true }, '게스트 모양(roster_name 없음)');
  assert.deepStrictEqual(real('한상록 강사님'), { name: '한상록 강사님', found: false }, '객원은 그대로');
  assert.strictEqual(SV.realNamesInRoleLines('대표기도: 꽃님 자매\n헌금 봉헌: 이하랑Alex\n- 광고: 한상록 강사님\n그냥 글', real),
    '대표기도: 강꽃님 자매\n헌금 봉헌: 이하랑\n- 광고: 한상록 강사님\n그냥 글', '이름 칸만 바꾸고 호칭·나머지 줄은 그대로');
  assert.deepStrictEqual(SV.nextWeekRoles([{ title: '교우동정', body: '생일자: 조현재 형제 9/20' }, { title: '다음 주 예배 위원', body: '대표 기도: 강서윤 자매\n\n헌금봉헌: 윤현서 자매' }]),
    [{ role: '대표 기도', value: '강서윤 자매' }, { role: '헌금봉헌', value: '윤현서 자매' }]);
  assert.deepStrictEqual(SV.storyNotices([{ title: '다음 주 예배 위원', body: 'x: y' }, { title: '제목만', body: '  ' }, { title: '', body: ' ' }, {}, { title: '교우동정', body: '생일' }, { title: '', body: '본문만' }]).map(n => n.title || n.body),
    ['제목만', '교우동정', '본문만'], '스토리 광고는 전부(제목만 있는 것도) · 둘 다 빈 줄만 뺀다 · 다음 주 위원은 마지막 장으로');
  // 표지 사진(0081) — lh3 자르지 않은 주소(=w720 · 1x =w360 · -c 없음) · 위치 한 칸 · 목록 한 번에 가장 최근 한 장 · 틀 끌기
  assert.deepStrictEqual(SV.coverImage({ drive_file_id: 'abc' }), { src: 'https://lh3.googleusercontent.com/d/abc=w720',
    srcSet: 'https://lh3.googleusercontent.com/d/abc=w360 1x, https://lh3.googleusercontent.com/d/abc=w720 2x' });
  assert.ok(!/-c\b|=w\d+-h/.test(SV.coverImage({ drive_file_id: 'x' }).srcSet), '자르는 주소(-c)를 쓰지 않는다 — 위치를 서버가 버린다');
  assert.deepStrictEqual(SV.coverImage({ _src: 'blob:1', drive_file_id: 'abc' }), { src: 'blob:1', srcSet: undefined }, '방금 올린 것은 브라우저 안 주소가 이긴다');
  assert.strictEqual(SV.coverImage({ source: 'storage', storage_path: 'a/b' }), null, '드라이브 id가 없으면 사진 없이');
  assert.strictEqual(SV.coverImage(null), null);
  assert.deepStrictEqual([SV.coverPosition(0.7), SV.coverPosition(undefined), SV.coverPosition(-1), SV.coverPosition(2), SV.coverPosition(0.333)],
    ['50% 70%', '50% 50%', '50% 0%', '50% 100%', '50% 33.3%']);
  const cm = SV.coverMap([{ id: 'a', service_id: 's1', kind: 'cover', created_at: '2026-09-01' }, { id: 'b', service_id: 's1', kind: 'cover', created_at: '2026-09-02' },
    { id: 'c', service_id: 's2', kind: 'songform', created_at: '2026-09-03' }, { id: 'd', service_id: 's3', created_at: '2026-09-03' }]);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(cm).map(([k, v]) => [k, v.id])), { s1: 'b', s3: 'd' }, '겹치면 가장 최근 · 표지 아닌 갈래는 버린다');
  const fr = SV.coverFrame(343, 514.5, 0.5);
  assert.ok(Math.abs(fr.height - 76) < 1e-9 && Math.abs(fr.top - (514.5 - 76) / 2) < 1e-9, '틀은 카드 비율 · 폭을 다 쓰고 y만큼 내려간다');
  assert.deepStrictEqual(SV.coverFrame(343, 50, 0.9), { top: 0, height: 50 }, '사진이 틀보다 납작하면 사진 높이에 멈춘다');
  assert.strictEqual(SV.dragFocus(0.5, 438.5 / 2, 343, 514.5), 1, '틀이 갈 수 있는 거리의 절반을 내리면 끝');
  assert.strictEqual(SV.dragFocus(0.5, -9999, 343, 514.5), 0);
  assert.strictEqual(SV.dragFocus(0.3, 40, 343, 50), 0.3, '움직일 거리가 없으면 그대로');
  // 표지 배선 — 같은 업로드 한 벌(kind만) · 목록 한 번에 한 조회 · 조회 칸 · 종이에는 없다 · 0081 모양
  const cl = readSplit('src/services/cloud.js');
  const wsvc = readSplit('src/services/worship.js');
  const wview = readFileSync(new URL('../src/views/worshipView.jsx', import.meta.url), 'utf8');
  const wpaper = readFileSync(new URL('../src/components/paper.jsx', import.meta.url), 'utf8');
  const m81 = readFileSync(new URL('../supabase/migrations/0081_service_cover.sql', import.meta.url), 'utf8');
  assert.ok(/SERVICE_FILE_KINDS = \['songform', 'cuesheet', 'cover'\]/.test(cl), 'cloud.uploadServiceFile이 cover 갈래를 받는다');
  assert.ok(/const COLS = '[^']*\bcover_focus_y\b/.test(wsvc), '주보 조회에 cover_focus_y');
  assert.ok(/\.from\('files'\)[\s\S]{0,160}\.eq\('kind', COVER\)/.test(wsvc) && !/fetchCovers\(s\.id|fetchCovers\(svc/.test(wview), '표지는 목록 한 번에 한 조회(주보마다 부르지 않는다)');
  assert.ok(/sendServiceFile\(file, await serviceFolder\(\), COVER\)/.test(wview) && /removeServiceFile\(old\)/.test(wview), '표지도 같은 업로드 길 · 새 것 뒤에 옛 것을 지운다');
  assert.ok(!/cover/i.test(wpaper), '주보 종이(PDF)는 표지를 모른다');
  assert.ok(/'songform', 'cuesheet', 'cover'/.test(m81) && /cover_focus_y real not null default 0\.5/.test(m81) && /cover_focus_y >= 0 and cover_focus_y <= 1/.test(m81),
    '0081 — files.kind에 cover · services.cover_focus_y 0~1 기본 .5');
  // ── 주보 공개 보기 (사용자 결정 2026-09-26 · api/service-view.js · src/serviceViewMain.jsx) ──
  // 되돌려서 깨뜨린 것(§3-5): publicService가 service를 통째로 펼치면({ ...service }) '싣지 않는 칸' 줄이,
  // loadPublic의 status 확인을 지우면 '작성 중은 404' 줄이, worshipStory가 worship.js를 다시 import하면 'supabase를 안 문다' 줄이 깨진다.
  {
    const pubPeople = [{ id: 'a', name: '이하랑Alex', roster_name: '이하랑', gender: 'm' }, { id: 'b', name: '꽃님', roster_name: '강꽃님', gender: 'f' },
      { id: 'c', name: '양민혁', roster_name: '양민혁', is_pastor: true }];
    const pubSvc = { id: 's1', kind: 'sunday', service_date: '2026-09-20', status: 'published', title: '제목', passage_ref: '사사기 9:7-15', preacher: '임성빈 전도사님',
      roles: [{ role: '대표기도', personId: 'a', name: '이하랑Alex' }, { role: '말씀', personId: 'c', name: '양민혁' }, { role: '헌금봉헌', name: '한상록 강사님' }, { role: '', name: '' }],
      songs: [{ title: 'A - B', link: 'https://youtu.be/x' }, { title: 'C', link: 'javascript:alert(1)' }, { title: '' }],
      notices: [{ title: '다음 주 예배 위원', body: '대표기도: 꽃님 자매' }, { title: '제목만', body: '' }, { title: '', body: '' }],
      praise_leader: '꽃님', attendance_note: '출석 메모 비밀', cue_sheet: { url: 'https://docs.google.com/x' }, drive_folder_id: 'F', created_by: 'u1', cover_focus_y: 0.7 };
    const pub = SV.publicService(pubSvc, { people: pubPeople, roles: [], cover: { drive_file_id: 'D1', id: 'f9', name: 'x.jpg' } });
    assert.deepStrictEqual(Object.keys(pub).sort(), ['cover', 'cover_focus_y', 'id', 'kind', 'notices', 'passage_ref', 'praise_leader', 'preacher', 'roles', 'service_date', 'songs', 'title'],
      '공개로 싣는 칸은 이것뿐 — 출석 메모·큐시트·폴더·작성자는 없다');
    assert.ok(!JSON.stringify(pub).includes('출석 메모') && !JSON.stringify(pub).includes('personId') && !JSON.stringify(pub).includes('docs.google'), '속 칸이 새지 않는다');
    assert.deepStrictEqual(pub.roles, [{ role: '대표기도', name: '이하랑 형제' }, { role: '말씀', name: '양민혁 전도사님' }, { role: '헌금봉헌', name: '한상록 강사님' }],
      '이름은 서버에서 명단 본명 + 호칭으로(객원은 그대로) · 빈 줄은 뺀다');
    assert.strictEqual(pub.praise_leader, '강꽃님 자매');
    assert.deepStrictEqual(pub.notices, [{ title: '다음 주 예배 위원', body: '대표기도: 강꽃님 자매' }, { title: '제목만', body: '' }], '다음 주 위원 줄도 본명 · 빈 광고만 뺀다');
    assert.deepStrictEqual(pub.songs, [{ title: 'A - B', link: 'https://youtu.be/x' }, { title: 'C', link: '' }], 'https 링크만');
    assert.deepStrictEqual([pub.cover, pub.cover_focus_y], [{ drive_file_id: 'D1' }, 0.7]);
    assert.strictEqual(SV.publicService(null), null);

    process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'logcheck-secret';
    const SVW = await import(new URL('../api/service-view.js', import.meta.url).href);
    const ID = '11111111-2222-4333-8444-555555555555', ID2 = '11111111-2222-4333-8444-555555555556';
    const sig = SVW.viewSig(ID);
    assert.ok(/^[A-Za-z0-9_-]{22}$/.test(sig) && SVW.viewSig(ID) === sig && SVW.viewSig(ID2) !== sig, '서명은 22글자 · 같은 주보는 같은 서명 · 주보마다 다르다');
    assert.strictEqual(SVW.viewPath(ID), `/w/${ID}/${sig}`);
    assert.ok(SVW.sigOk(ID, sig) && !SVW.sigOk(ID2, sig) && !SVW.sigOk(ID, sig.slice(0, 21) + (sig[21] === 'A' ? 'B' : 'A')) && !SVW.sigOk('not-uuid', sig), '서명이 틀리면 거절');
    // 가짜 조회 — select는 칸을 거르지 않는다(서버가 받은 행을 그대로 넘기면 속 칸이 샌다는 것까지 본다)
    const fakeDb = (tables) => ({ from(t) {
      let rows = [...(tables[t] || [])];
      const q = { select: () => q, eq: (k, v) => { rows = rows.filter(r => r[k] === v); return q; }, in: (k, vs) => { rows = rows.filter(r => vs.includes(r[k])); return q; },
        order: (k, o = {}) => { rows.sort((a, b) => (o.ascending === false ? -1 : 1) * String(a[k]).localeCompare(String(b[k]))); return q; }, limit: (n) => { rows = rows.slice(0, n); return q; },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }), then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej) };
      return q; } });
    const tables = {
      services: [{ ...pubSvc, id: ID }, { ...pubSvc, id: ID2, status: 'draft' }],
      files: [{ service_id: ID, kind: 'cover', drive_file_id: 'OLD', created_at: '2026-09-01' }, { service_id: ID, kind: 'cover', drive_file_id: 'NEW', created_at: '2026-09-02' },
        { service_id: ID, kind: 'songform', drive_file_id: 'SF', created_at: '2026-09-03' }],
      people: [{ id: 'a', name: '이하랑', profile_id: 'u9', gender: 'm' }, { id: 'b', name: '강꽃님', profile_id: 'u8', gender: 'f' }, { id: 'c', name: '양민혁', is_pastor: true }],
      people_roles: [], profiles: [{ id: 'u9', display_name: '이하랑Alex' }, { id: 'u8', display_name: '꽃님' }],
    };
    const shell = '<html><head><title>더다붓 주보</title><!--service-view:head--></head><body></body></html>';
    const ok = await SVW.servePublic({ supabase: fakeDb(tables), id: ID, sig, origin: 'https://x.app', shell });
    const dataJson = /<script type="application\/json" id="service-data">([\s\S]*?)<\/script>/.exec(ok.html)?.[1] || '';
    const data = JSON.parse(dataJson || 'null');
    assert.strictEqual(ok.status, 200);
    assert.ok(data && data.roles[0].name === '이하랑 형제' && data.praise_leader === '강꽃님 자매' && data.cover.drive_file_id === 'NEW', '표시 이름으로 저장된 이름도 본명 + 호칭 · 표지는 가장 최근 한 장');
    assert.ok(!ok.html.includes('출석 메모 비밀') && !ok.html.includes('docs.google.com/x') && !/"status"/.test(dataJson), '페이지에 속 칸이 없다');
    assert.ok(ok.html.includes('<meta property="og:title" content="제목"/>') && ok.html.includes('og:description" content="2026년 9월 20일 · 주일 4부 젊은이 예배"')
      && ok.html.includes('og:image" content="https://lh3.googleusercontent.com/d/NEW=w1200"') && (ok.html.match(/<title>/g) || []).length === 1, 'OG — 설교 제목 · 날짜 · 표지 사진');
    const noCover = await SVW.servePublic({ supabase: fakeDb({ ...tables, files: [] }), id: ID, sig, origin: 'https://x.app', shell });
    assert.ok(noCover.html.includes('og:image" content="https://x.app/og/season-plain.png"'), '표지가 없으면 절기 색 그림(연중은 기본 톤)');
    assert.ok(existsSync(new URL('../public/og/season-plain.png', import.meta.url)) && existsSync(new URL('../public/og/season-purple.png', import.meta.url)), '절기 그림 파일');
    const xss = await SVW.servePublic({ supabase: fakeDb({ ...tables, services: [{ ...pubSvc, id: ID, title: '</script><script>alert(1)</script>' }] }), id: ID, sig, origin: 'https://x.app', shell });
    assert.ok(!xss.html.includes('</script><script>alert(1)') && xss.html.includes('\\u003c/script>'), '데이터 블록이 </script>로 끊기지 않는다');
    for (const [why, args] of [['서명이 틀림', { id: ID, sig: 'x'.repeat(22) }], ['작성 중', { id: ID2, sig: SVW.viewSig(ID2) }], ['없는 주보', { id: '11111111-2222-4333-8444-000000000000', sig: SVW.viewSig('11111111-2222-4333-8444-000000000000') }]]) {
      const r = await SVW.servePublic({ supabase: fakeDb(tables), ...args, origin: 'https://x.app', shell });
      assert.ok(r.status === 404 && r.html.includes(SV.PUBLIC_MISSING) && !r.html.includes('service-data'), `${why}이면 404 모양의 짧은 페이지`);
    }
    const svwSrc = readFileSync(new URL('../api/service-view.js', import.meta.url), 'utf8');
    assert.ok(/requireApprovedUser\(req, res/.test(svwSrc) && /data\.status !== 'published'/.test(svwSrc), '주소를 받는 POST는 승인 멤버 · 발행본만');
    assert.ok(!/attendance|service_notes|qt_entries|bible_state/.test(svwSrc.replace(/\/\/.*$/gm, '')), '서버는 출석·노트·개인 표를 읽지 않는다');
    // 공개 페이지는 supabase에 붙지 않는다 — 입구에서 상대 import를 따라가며 supabaseClient에 닿는지 본다
    const seen = new Set();
    const walk = (url) => {
      const key = url.href; if (seen.has(key)) return; seen.add(key);
      const text = readFileSync(url, 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)\s(?:[^'"]*?from\s+)?'(\.[^']+)'/gm)) {
        if (/\.(css|webp|png|svg)$/.test(m[1])) continue;
        walk(new URL(m[1], url));
      }
    };
    walk(new URL('../src/serviceViewMain.jsx', import.meta.url));
    const reached = [...seen].map(h => h.split('/src/')[1] || h);
    assert.ok(reached.includes('components/worshipStory.jsx') && reached.includes('components/paper.jsx'), '공개 보기는 스토리·종이 부품 그대로');
    assert.ok(!reached.some(r => /services\/(supabaseClient|worship|people|groups|cloud)\.js$/.test(r)), `공개 보기는 supabase를 안 문다 — ${reached.filter(r => /services\/(supabaseClient|worship|people|groups|cloud)/.test(r)).join(', ')}`);
    // 배선 — 주소 · 입구 · 앱 안 버튼
    const vj = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.ok(vj.rewrites.some(r => r.source === '/w/:id/:sig' && r.destination === '/api/service-view?id=:id&sig=:sig'), 'vercel.json /w/ 주소');
    assert.ok(/view: resolve\(process\.cwd\(\), 'service-view\.html'\)/.test(readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')), '빌드 입구에 service-view.html');
    const themeOf = (f) => /<script>\s*\/\/ 첫 페인트 전에 테마 결정[\s\S]*?<\/script>/.exec(readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))?.[0];   // 작업 사본은 CRLF일 수 있다(배포는 LF)
    assert.ok(themeOf('../service-view.html') && themeOf('../service-view.html') === themeOf('../index.html'), '공개 페이지 테마 스크립트가 앱과 같다(CSP 해시 한 벌)');
    assert.ok(readFileSync(new URL('../service-view.html', import.meta.url), 'utf8').includes('<!--service-view:head-->'), '껍데기에 끼울 자리');
    const wdSrc = readFileSync(new URL('../src/components/worshipDetail.jsx', import.meta.url), 'utf8');
    assert.ok(/worship-paper-link[\s\S]{0,200}링크로 공유/.test(wdSrc) && /onShareLink\(service\.id\)/.test(wdSrc), "주보 탭 도구 줄에 '링크로 공유'(주소는 탭이 열릴 때 미리 받는다)");
  }
  // 장 나누기 — 넘치면 다음 장 · 혼자 넘는 것은 혼자 · 못 쟀으면 한 장
  assert.deepStrictEqual(SV.packPages([100, 100, 100], 250, 10), [[0, 2], [2, 3]]);
  assert.deepStrictEqual(SV.packPages([100, 400, 50], 250, 10), [[0, 1], [1, 2], [2, 3]]);
  assert.deepStrictEqual(SV.packPages([10, 20], 0, 0), [[0, 2]]);
  assert.deepStrictEqual(SV.packPages([], 100, 0), []);
  // 내 노트 목록 — 쓴 것만 · 주보가 있는 것만 · 최근 예배가 앞
  const svcs = [{ id: 's1', service_date: '2026-09-06', passage_ref: '사사기 3:1-11' }, { id: 's2', service_date: '2026-09-20', passage_ref: '' }];
  const rows = SV.myNoteRows([
    { service_id: 's1', body: '### 말씀 요약\n은혜\n\n### 나의 결단\n\n### 기도\n' },
    { service_id: 's2', body: '### 말씀 요약\n기쁨' },
    { service_id: 'gone', body: '지워진 주보의 노트' },
    { service_id: 's1', body: '### 말씀 요약\n\n### 나의 결단\n\n### 기도\n' },
    { service_id: 's2', body: '   ' },
  ], svcs);
  assert.deepStrictEqual(rows.map(r => r.service.id), ['s2', 's1'], '템플릿만 남은 노트·빈 노트·주보 없는 노트는 뺀다');

  // 배선 — 화면이 이 규칙들을 실제로 쓰는가
  const wd = readFileSync(new URL('../src/components/worshipDetail.jsx', import.meta.url), 'utf8');
  const wv = readFileSync(new URL('../src/views/worshipView.jsx', import.meta.url), 'utf8');
  const pp = readFileSync(new URL('../src/components/paper.jsx', import.meta.url), 'utf8');
  const ws = readSplit('src/services/worship.js');
  assert.ok(/data-season=\{season\?\.color \|\| 'plain'\}/.test(wv) && /worship-season-dot/.test(wv), '주보 카드에 절기 물·점');
  assert.ok(/worship-head season-wash/.test(wd) && /churchSeason\(service\.service_date\)/.test(wd), '상세 머리에 절기 물');
  assert.ok(/season=\{season\} className="paper-service paper-service-1"/.test(pp) && /season=\{season\} className="paper-service paper-service-2"/.test(pp), '주보 종이 두 쪽 머리 띠에 절기');
  assert.ok(/nameOf\(r\.name, r\.personId \|\| r\.person_id \|\| null\)/.test(pp), '종이 섬기는 이들은 personId로 본명을 찾는다');
  assert.ok(/const r = real\(name, personId\);/.test(wd) && /honor\(r\.found \? r\.name : name, personId\)/.test(wd), '상세의 이름은 본명 + 호칭');
  assert.ok(/worship-story-open md:hidden/.test(wd), "'넘기면서 보기'는 폰에서만(데스크톱에 버튼 없음)");
  assert.ok(/from\('service_notes'\)[\s\S]{0,120}\.eq\('profile_id', uid\)\)?( \?\? \[\])?;/.test(ws.slice(ws.indexOf('export async function fetchMyNotes'))),
    '내 노트 모아 보기는 profile_id로 거른다(읽기 정책은 같은 순의 공유 노트도 준다)');
  console.log('PASS  교회력(큐시트 대조 3) · 광고 → 달력(라이브 13건 안 읽힘 · .ics · 구글) · 찬양 줄 · 본명 · 장 나누기 · 내 노트 목록');
}

// ── 은혜와 리듬 묶음(2026-09-25 · 목업 '은혜와 리듬' 3·5·6·7·8 · '지난 기록' 2) ──────────────
// 홈의 날짜로 켜지는 세 자리(homeMoments) · 이번 주 이 장을 본 사람(bibleReads · 0080) · 마음 칩(moodPick·moods).
// 되돌리기 검사: sundayMode의 SUNDAY_FROM 비교를 지우면 '07:59에는 아직'이, pickYearAgo의 작년 거르기를 지우면
// '올해 프로젝트는 고르지 않는다'가, readersView의 나 빼기를 지우면 '나는 빠진다'가, fitMoods의 폰 상한을 지우면
// '폰은 넷까지'가, reshuffle의 뒤로 밀기를 지우면 '방금 본 칩은 뒤로'가, push.js의 delete 한 줄을 지우면 '지난주 줄을 지운다'가 깨진다.
{
  const M = await import(new URL('../src/services/homeMoments.js', import.meta.url).href);
  // ① 오늘의 예배 — 발행된 오늘 주보 + 08:00~자정
  const svc = { status: 'published', service_date: '2026-09-27' };
  assert.strictEqual(M.sundayMode(svc, '2026-09-27 07:59:59'), false, '07:59에는 아직');
  assert.strictEqual(M.sundayMode(svc, '2026-09-27 08:00:00'), true, '08:00부터');
  assert.strictEqual(M.sundayMode(svc, '2026-09-27 23:59:59'), true, '자정까지');
  assert.strictEqual(M.sundayMode(svc, '2026-09-28 09:00:00'), false, '다음 날은 아니다');
  assert.strictEqual(M.sundayMode({ ...svc, status: 'draft' }, '2026-09-27 10:00:00'), false, '작성 중 주보는 켜지 않는다');
  assert.strictEqual(M.sundayMode(null, '2026-09-27 10:00:00'), false);
  // ② 지난 해의 오늘 — 창 · 고르기
  assert.deepStrictEqual(M.yearAgoWindow('2027-07-29'), { year: 2026, from: '2026-07-22', to: '2026-08-05' }, '작년 오늘 ±7일');
  assert.deepStrictEqual(M.yearAgoWindow('2028-02-29'), { year: 2027, from: '2027-02-21', to: '2027-03-07' }, '2월 29일은 작년 28일로');
  assert.strictEqual(M.yearAgoWindow('nope'), null);
  const at = (d, h = 12) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h).toISOString();
  const projects = [
    { id: 'camp', year: 2026, title: '2026 하계 수련회', archived: true },
    { id: 'help', year: 2026, title: '동수교회 청소년부 수련회 지원' },
    { id: 'now', year: 2027, title: '2027 하계 수련회' },
  ];
  const rows = [
    ...Array.from({ length: 5 }, () => ({ projectId: 'camp', at: at('2026-07-30') })),
    ...Array.from({ length: 3 }, () => ({ projectId: 'help', at: at('2026-08-01') })),
    ...Array.from({ length: 9 }, () => ({ projectId: 'now', at: at('2026-07-30') })),   // 올해(2027) 프로젝트 — 고르지 않는다
    ...Array.from({ length: 9 }, () => ({ projectId: 'help', at: at('2026-08-20') })),  // 창 밖
  ];
  const tasks = [
    { id: 't1', projectId: 'camp', title: '포스터 제작', dueDate: '2026-08-03', completedAt: '' },
    { id: 't2', projectId: 'camp', title: '기도카드 제작', dueDate: '2026-07-01', completedAt: at('2026-07-30') },
    { id: 't3', projectId: 'camp', title: '슈링클스 제작', dueDate: '2026-07-26', completedAt: '' },
    { id: 't4', projectId: 'camp', title: '정산', dueDate: '2026-08-04', completedAt: '' },
    { id: 't5', projectId: 'camp', title: '창 밖 업무', dueDate: '2026-09-01', completedAt: '' },
    { id: 't6', projectId: 'help', title: '다른 프로젝트', dueDate: '2026-07-30', completedAt: '' },
  ];
  const ya = M.pickYearAgo({ today: '2027-07-29', rows, projects, tasks });
  assert.strictEqual(ya.project.id, 'camp', '창 안 활동이 가장 많은 작년 프로젝트(보관이어도) · 올해 프로젝트는 고르지 않는다');
  assert.deepStrictEqual(ya.tasks.map(x => [x.task.id, x.date]), [['t3', '2026-07-26'], ['t2', '2026-07-30'], ['t1', '2026-08-03']],
    '그 창에 마감·완료가 걸린 업무 셋까지 · 날짜순 · 완료가 창 안이면 끝낸 날');
  const tie = M.pickYearAgo({ today: '2027-07-29', projects, tasks: [],
    rows: [{ projectId: 'camp', at: at('2026-07-23') }, { projectId: 'help', at: at('2026-07-24') }] });
  assert.strictEqual(tie.project.id, 'help', '같으면 최근 활동이 앞');
  assert.strictEqual(M.pickYearAgo({ today: '2026-09-25', rows, projects, tasks }), null, '작년 창에 활동이 없으면 줄이 없다(2027-07-25 전의 지금)');
  assert.ok(M.yearAgoWindow('2027-07-17').to < M.ACTIVITY_SINCE && M.yearAgoWindow('2027-07-18').to >= M.ACTIVITY_SINCE,
    '기록 시작일(2026-07-25)에 창(±7일)이 닿는 첫날은 2027-07-18 — 그 전에는 묻지도 않는다');
  // ③ 발자취 — 12월 둘째 주일 ~ 1월 6일
  assert.strictEqual(M.secondSundayOfDecember(2026), '2026-12-13');
  assert.strictEqual(M.secondSundayOfDecember(2027), '2027-12-12');
  assert.strictEqual(M.footprintYear('2026-12-12'), null, '둘째 주일 전날은 아직');
  assert.strictEqual(M.footprintYear('2026-12-13'), 2026, '둘째 주일부터');
  assert.strictEqual(M.footprintYear('2026-12-31'), 2026);
  assert.strictEqual(M.footprintYear('2027-01-06'), 2026, '1월 6일(주현절)까지 — 돌아보는 해는 지난해');
  assert.strictEqual(M.footprintYear('2027-01-07'), null, '1월 7일부터는 없다');
  assert.strictEqual(M.footprintYear('2026-09-25'), null);
  const fs = M.footprintSections({
    year: 2026, myName: '노준석',
    highlights: [
      { ref: 'jdg 3:2', at: '2026-09-08T01:00:00Z' }, { ref: 'jdg 3:1', at: '2026-09-08T01:00:00Z' },
      { ref: 'qt:2026-09-20 jdg 9:7', at: '2026-09-20T01:00:00Z' }, { ref: 'jdg 9:7', at: '2026-09-21T01:00:00Z' },
      { ref: 'psa 23:1', at: '2025-12-01T01:00:00Z' },
    ],
    bookmarks: [{ ref: 'luk 2', label: '누가복음 2장', at: '2026-09-12T01:00:00Z' }, { ref: 'jdg 3', at: '2026-09-08T01:00:00Z' }],
    notes: [{ serviceId: 's2', title: '포도주 틀에서', date: '2026-09-13' }, { serviceId: 's1', title: '전쟁터에 선 사람', date: '2026-09-06' }],
    projects: [{ id: 'p1', year: 2026, title: '2026 예배 2.0' }, { id: 'p0', year: 2025, title: '지난해' }],
    tasks: [
      { projectId: 'p1', assignees: ['노준석', '조준환', '김승찬', '임성빈', '가나다'] },
      { projectId: 'p1', assignees: ['조해리'] },
      { projectId: 'p0', assignees: ['노준석', '양민혁'] },
    ],
  });
  assert.deepStrictEqual(fs.passages.map(p => `${p.bookId} ${p.chapter}:${p.from}-${p.to}`), ['jdg 3:1-2', 'jdg 9:7-7'],
    '이어진 절은 한 줄 · QT에서 칠한 같은 절은 한 번 · 다른 해는 빠진다');
  assert.deepStrictEqual(fs.chapters.map(c => c.ref), ['jdg 3', 'luk 2'], '북마크는 넣은 날 순');
  assert.deepStrictEqual(fs.sundays.map(n => n.serviceId), ['s1', 's2'], '예배 노트는 주보 날짜 순 · 설교 제목만');
  assert.deepStrictEqual(fs.together.map(t => [t.project.id, t.faces]), [['p1', ['가나다', '김승찬', '임성빈']]],
    '그 해 내가 담당한 업무의 프로젝트만 · 같이 한 얼굴은 이름순 셋까지(나를 빼고)');
  assert.ok(!JSON.stringify(fs).match(/"(count|total|rank)"/), '합계·순위 칸이 없다');

  // ④ 이번 주 이 장을 본 사람(0080)
  const R = await import(new URL('../src/services/bibleReads.js', import.meta.url).href);
  assert.strictEqual(R.weekStartOf('2026-09-25'), '2026-09-20', '주는 주일 시작');
  assert.strictEqual(R.weekStartOf('2026-09-20'), '2026-09-20');
  assert.strictEqual(R.weekStartOf('2026-09-26'), '2026-09-20', '토요일까지 같은 주');
  assert.strictEqual(R.weekStartOf('2027-01-01'), '2026-12-27', '해를 넘는다');
  assert.strictEqual(R.READ_DWELL_MS, 5000, '5초 넘게');
  const rv = R.readersView([
    { profile_id: 'me', name: '노준석' }, { profile_id: 'a', name: '조해리' }, { profile_id: 'b', name: '김승찬' },
    { profile_id: 'c', name: '시온' }, { profile_id: 'd', name: '박지호' }, { profile_id: 'b', name: '김승찬' }, { profile_id: 'e', name: '' },
  ], 'me');
  assert.deepStrictEqual(rv.all.map(p => p.name), ['김승찬', '박지호', '시온', '조해리'], '나는 빠지고 · 같은 사람은 한 번 · 이름순');
  assert.deepStrictEqual([rv.faces.length, rv.more], [3, 1], '얼굴 셋 + +1');
  assert.deepStrictEqual(R.readersView([{ profile_id: 'me', name: '노준석' }], 'me').all, [], '나뿐이면 0명(자리째 없다)');
  const parse = (s) => { const m = /^(\S+) (\d+)(?::\d+)?(?:-(\d+))?/.exec(s); return m ? { bookId: m[1], start: { chapter: +m[2] }, end: { chapter: +m[2] } } : null; };
  assert.deepStrictEqual(R.qtDatesCovering([{ qt_date: '2026-09-21', passage_ref: 'jdg 9:1-21' }, { qt_date: '2026-09-22', passage_ref: 'jdg 10:1' },
    { qt_date: '2026-09-20', passage_ref: 'jdg 9:22' }], 'jdg', 9, parse), ['2026-09-20', '2026-09-21'], '이 장에 걸친 날만');

  // ⑤ 마음 칩 — 한 줄 · 폰 넷까지 · 1분 · 방금 본 칩은 뒤로
  const P = await import(new URL('../src/services/moodPick.js', import.meta.url).href);
  const { MOODS, moodAsk } = await import(new URL('../src/data/moods.js', import.meta.url).href);
  assert.strictEqual(MOODS.length, 50, '후보 50');
  assert.strictEqual(new Set(MOODS).size, 50, '겹치지 않는다');
  for (const t of ['결정을 앞두고 있을 때', '기도 응답이 늦다고 생각될 때', '새로운 시작을 할 때', '유혹에 맞서 싸울 때', '감사가 안 나올 때', '시험을 앞두고 있을 때']) {
    assert.ok(MOODS.includes(t), `사용자가 고친 칩: ${t}`);
  }
  for (const t of ['결정을 앞두고', '기다림이 길 때', '새로 시작할 때', '유혹 앞에서', '감사가 안 될 때', '시험을 앞두고']) {
    assert.ok(!MOODS.includes(t), `옛 칩은 없다: ${t}`);
  }
  assert.strictEqual(moodAsk('지칠 때'), '지칠 때 읽을 성경 말씀', 'AI 물음은 한 틀');
  const widths = { 0: 70, 1: 190, 2: 80, 3: 90, 4: 60, 5: 75, 6: 65 };
  const order = [1, 0, 2, 3, 4, 5, 6];
  const phone = P.fitMoods(order, widths, 331);
  const used = (ids) => ids.reduce((s, i, k) => s + widths[i] + (k ? P.MOOD_GAP : 0), 0);
  assert.ok(phone.length <= 4 && used(phone) <= 331, `폰은 넷까지 · 한 줄 폭 안(${phone} = ${used(phone)}px)`);
  assert.deepStrictEqual(P.fitMoods(order, widths, 220), [0, 4, 5], '폰은 셋을 채운다 — 긴 칩이 앞이라 셋이 안 들어가면 건너뛴다(줄은 넘지 않는다)');
  assert.deepStrictEqual(P.fitMoods([1, 0, 2], widths, 160), [0, 2], '긴 칩이 앞이어도 짧은 칩으로 찬다');
  const wide = P.fitMoods(order, widths, 700);
  assert.ok(wide.length > 4 && used(wide) <= 700, '데스크톱은 폭에 들어가는 만큼');
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const memo = { order: P.shuffledOrder(50, rand), shownAt: 1_000_000, last: [3, 7, 11] };
  assert.deepStrictEqual(P.orderOnOpen(memo, 50, 1_000_000 + 59_000, rand), memo.order, '1분 안에 다시 열면 같은 차례');
  const again = P.orderOnOpen(memo, 50, 1_000_000 + 60_000, rand);
  assert.deepStrictEqual(again.slice(-3).sort((a, b) => a - b), [3, 7, 11], '1분이 지나면 새로 섞고 방금 본 칩은 뒤로');
  assert.strictEqual(new Set(again).size, 50);
  assert.strictEqual(P.validMemo({ order: [0, 1], shownAt: 1 }, 50), null, '후보 수가 바뀐 기억은 버린다');

  // ⑥ 배선 — 11:30 배치 끝의 지난주 지우기(크론을 새로 만들지 않는다) · 0080 모양 · §7 예외 줄
  const push = readFileSync(new URL('../api/push.js', import.meta.url), 'utf8');
  const wtm = push.slice(push.indexOf('async function handleWorshipThenMeetings'), push.indexOf('// GET ?job=embed'));
  assert.ok(/await dropLastWeekReads\(admin\(\)\)/.test(wtm)
    && /async function dropLastWeekReads\(db\) \{\s*const \{ error \} = await db\.from\('bible_reads'\)\.delete\(\)\.lt\('week_start', weekStartOf\(kstDate\(0\)\)\)/.test(push), '11:30 배치 끝에서 지난주 줄을 지운다');
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.strictEqual((vercel.crons || []).length, 2, '크론은 둘 그대로');
  const mig = readFileSync(new URL('../supabase/migrations/0080_bible_reads.sql', import.meta.url), 'utf8');
  const sql = mig.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(/primary key \(profile_id, chapter_key, week_start\)/.test(sql), '누가·어느 장·어느 주 셋이 열쇠');
  assert.ok(!/(verse|seen_at|count)\s/.test(sql.slice(sql.indexOf('create table'), sql.indexOf(');'))), '절·시각·횟수 칸이 없다');
  assert.ok(/bible_reads_select[\s\S]*?for select using \(public\.is_approved\(\)\)/.test(sql), '읽기는 승인된 전원');
  assert.ok(/bible_reads_insert[\s\S]*?profile_id = public\.effective_uid\(\)/.test(sql) && /bible_reads_delete[\s\S]*?profile_id = public\.effective_uid\(\)/.test(sql), '쓰기·지우기는 본인만');
  assert.ok(!/for update|for all/.test(sql), 'update 정책 없음');
  assert.ok(/share_reads boolean not null default true/.test(sql), '나도 나누기는 bible_state 한 칸 · 기본 켬');
  assert.ok(!/supabase_realtime/.test(sql), '실시간 발행에 넣지 않는다');
  const handoff = readFileSync(new URL('../HANDOFF.md', import.meta.url), 'utf8');
  assert.ok(/카드별 조회 추적[^\n]*\n\|[^\n]*성경 장 보기는 예외/.test(handoff), 'HANDOFF §7에 성경 장 보기 예외 줄이 카드별 조회 추적 바로 아래에 있다');
  console.log('PASS  은혜와 리듬 묶음(오늘의 예배 · 지난 해의 오늘 · 발자취 · 이 장을 본 사람 · 마음 칩)');
}

// ── 예배 화면 쪼개기 배선 (19차 묶음 G · 2026-10-07) ─────────────────────────────
// worshipDetail.jsx(1,994줄)를 보기·편집(worshipEdit)·노트(worshipNote)·공용 부품(worshipParts)으로 갈랐다.
// 저장 상태 칩 하나·노트 컷 하나 때문에 출석·모임 화면이 2천 줄을 import하던 자리를 못 박는다.
// 되돌리기 검사: worshipNote의 useNoteDraft 줄을 옛 pendingDraft 효과 두 벌로 되돌리면 ②가,
// worshipView의 attempt 하나를 try/catch로 다시 적으면 ③이 깨진다.
{
  const rd = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const det = rd('components/worshipDetail.jsx');
  const note = rd('components/worshipNote.jsx');
  const view = rd('views/worshipView.jsx');
  // ① 공용 부품은 한 벌 — 출석·모임은 worshipDetail을 import하지 않는다 · 말씀(wordView)은 묶음 H부터 worshipParts에서 바로 받는다(상세의 재수출 줄은 19차 끝에 걷었다)
  assert.ok(!/from '\.\/worshipDetail\.jsx'/.test(rd('components/worshipAttendance.jsx')) && !/from '\.\/worshipDetail\.jsx'/.test(rd('components/groupsSun.jsx')),
    '출석·모임 화면이 2천 줄 상세를 import하지 않는다');
  assert.ok(/export const NOTE_CUT = \{ src: '\/chars\/heart\.webp'/.test(rd('components/paper.jsx')) && !/NOTE_CUT =/.test(det + note), '노트 컷은 종이(paper.jsx) 한 벌');
  assert.ok(!/export \{ SaveState \};/.test(det) && !/function SaveState\(/.test(det + note) && /export function SaveState\(/.test(rd('components/worshipParts.jsx')) && !/SaveState \} from '\.\.\/components\/worshipDetail\.jsx'/.test(rd('views/wordView.jsx')), '저장 상태 칩은 worshipParts 한 벌 · 상세는 재수출도 하지 않는다');
  // ② 노트 초안은 훅 한 벌(hooks/useNoteDraft.js) — 기다리는 동안 떠나면 그 자리에서 남긴다
  const hook = rd('hooks/useNoteDraft.js');
  assert.ok(/useNoteDraft\(draftKey, body === base \? null : \{ body \}\);/.test(note) && !/pendingDraft/.test(note), '예배 노트가 초안 훅을 쓴다(지역 사본 없음)');
  assert.ok(/if \(p && p\.key === key\) \{ writeCache\(p\.key, p\.value\); pending\.current = null; \}/.test(hook)
    && /setTimeout\(\(\) => \{ writeCache\(key, value\); pending\.current = null; \}, NOTE_DRAFT_DELAY\)/.test(hook), '훅이 늦은 쓰기와 떠날 때 쓰기를 둘 다 한다');
  // ③ 실패 처리 한 벌 — 콘솔 줄 모양은 그대로(`[worship] … 실패:`). 손으로 적은 실패 토스트는
  //    attempt 안 하나 + 출석 칩(23505를 되돌리지 않는 갈래) + 목록 읽기 실패 이펙트 + 내 노트 목록(캐시 유무 갈래)뿐이다
  const toasts = [...view.matchAll(/showToast\(fail\(/g)].length;
  const uses = [...view.matchAll(/\battempt\('/g)].length;
  assert.ok(/console\.error\(`\[worship\] \$\{log\} 실패:`, e\);/.test(view), 'attempt가 콘솔에 같은 꼴로 남긴다');
  assert.ok(uses >= 17 && toasts === 4, `attempt ${uses}곳 · 손으로 적은 실패 토스트 ${toasts}곳`);
  // ④ 모션 최소화 판정은 hooks/useReducedMotion.js 한 벌
  for (const [k, s] of Object.entries({ det, note, view, edit: rd('components/worshipEdit.jsx') })) {
    assert.ok(!/matchMedia/.test(s), `${k}에 matchMedia 판정이 다시 적혀 있지 않다`);
  }
  console.log('PASS  예배 쪼개기 배선(공용 부품 한 벌 · 노트 컷 · 초안 훅 · 실패 처리 한 벌 · 모션 판정)');
}

// ── 말씀 화면 쪼개기 배선 (19차 묶음 H · 2026-10-07) ─────────────────────────────
// wordBible.jsx(1,738줄)를 공용 부품(bibleParts)·북마크/형광펜 목록(bibleMarks)·리더로, wordView.jsx(1,134줄)를
// 나눔(shareFeed)·잔디(grass)·QT로 갈랐다. 한 벌로 모은 자리가 다시 두 벌로 갈리지 않게 글자로 못 박는다.
// 되돌리기 검사: goto에 옛 검색 비우기 여섯 줄을 되살리면 ①이, 키워드 결과 줄을 옛 <button> 마크업으로
// 되돌리면 ②가, removeShared에 옛 꼬리(setFeed·dropCache·refreshQt)를 다시 적으면 ③이,
// wordView에 옛 pendingDraft 효과를 되살리면 ⑤가 깨진다.
{
  const rd = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const wb = rd('components/wordBible.jsx');
  const parts = rd('components/bibleParts.jsx');
  const marks = rd('components/bibleMarks.jsx');
  const wv = rd('views/wordView.jsx');
  const feed = rd('views/shareFeed.jsx');
  const count = (s, re) => (s.match(re) || []).length;
  const body = (src, head) => {
    const s = src.replace(/\r/g, '');
    const i = s.indexOf(head); assert.ok(i >= 0, head);
    const j = s.indexOf('\n}\n', i); return s.slice(i, j < 0 ? undefined : j);
  };
  // ① 검색 자리를 비우는 길은 resetSearch 한 벌(새 검색 · 검색 접기 · 자리 옮기기)
  assert.ok(/const resetSearch = \(q = ''\) => \{/.test(wb), 'resetSearch가 있다');
  assert.strictEqual(count(wb, /setAiHits\(\[\]\); setAiWait\(false\);/g), 1, '검색 비우기 줄은 resetSearch 안 한 곳');
  assert.strictEqual(count(wb, /\+\+searchToken\.current|searchToken\.current\+\+/g), 1, '검색 열쇠를 가는 자리도 한 곳');
  // ② 결과 한 줄은 HitRow 한 벌 — 낱말 도막과 AI 도막이 같은 모양
  assert.strictEqual(count(wb, /<HitRow /g), 2, '낱말 결과와 AI 결과가 HitRow를 쓴다');
  assert.strictEqual(count(wb, /text-left py-2\.5 px-2\.5 -mx-2\.5/g), 1, '결과 줄의 클래스는 한 자리');
  // ③ 쓰고 난 뒤의 꼬리는 afterWrite 한 벌 — 저장 · 공유 바꿈 · 지우기 · 남의 나눔 지우기
  assert.strictEqual(count(wv, /await afterWrite\(/g), 4, '꼬리를 부르는 자리가 넷');
  assert.strictEqual(count(wv, /dropCache\(qtKey\); refreshQt\(\);/g), 1, '그 날짜 묶음을 비우고 다시 읽는 줄은 afterWrite 안 한 곳');
  assert.strictEqual(count(wv, /setFeed\(await fetchSharedEntries\(date\)\)/g), 1, '나눔을 다시 읽는 줄도 한 곳');
  // ④ 큰 함수의 상태는 훅으로 — BibleTab에 검색·쓸기·본 사람·판 차례가, QtTab에 노트 동기화가 남지 않는다
  for (const h of ['useBibleSearch', 'useRecentPanel', 'useChapterReaders', 'useSwipe']) {
    assert.ok(new RegExp(`function ${h}\\(`).test(wb), `${h}가 있다`);
  }
  const tab = body(wb, 'export function BibleTab(');
  assert.ok(!/searchToken|touchAt|moodOrderRef|setReaders/.test(tab), 'BibleTab 본문에 훅으로 옮긴 상태가 남아 있지 않다');
  const qtTab = body(wv, 'function QtTab(');
  assert.ok(/useQtNote\(\{ qt, qtError, date, setFeed, setShareState \}\)/.test(qtTab)
    && !/const syncedBody|shouldAdoptBody\(\{|const \[entry, setEntry\]/.test(qtTab),
    'QtTab은 노트 상태를 useQtNote에서 받는다');
  // ⑤ 노트 초안은 hooks/useNoteDraft.js 한 벌(예배 노트와 같다)
  assert.ok(/useNoteDraft\(draftKey, !ready \? undefined : \(dirty \? \{ body, title \} : null\)\);/.test(wv) && !/pendingDraft/.test(wv),
    '말씀 묵상이 초안 훅을 쓴다(지역 사본 없음)');
  // ⑥ 공용 것을 가져다 쓴다 — 저장 칩은 worshipParts · 사람 칩 줄은 TEAM_CHIP_ROW · 모션 판정은 hooks/useReducedMotion
  assert.ok(/import \{ SaveState \} from '\.\.\/components\/worshipParts\.jsx';/.test(wv), '저장 상태 칩은 worshipParts에서');
  assert.ok(/className=\{TEAM_CHIP_ROW\}/.test(feed) && !/overflow-x-auto scrollbar-hide x-scroll-lock/.test(feed), '나눔 사람 칩 줄은 TEAM_CHIP_ROW 한 벌');
  for (const [k, s] of Object.entries({ wb, parts, marks })) {
    assert.ok(!/matchMedia/.test(s) && !/prefersReducedMotion \} from '\.\.\/views\/dashboardParts/.test(s), `${k}가 모션 판정을 따로 하지 않는다`);
  }
  assert.strictEqual(count(parts + marks, /useReducedMotion\(\)/g), 2, '그리는 중 판정(Swap · 책 묶음 접기)은 훅으로');
  // ⑦ 다른 화면의 import 경로는 그대로 — wordBible·wordView가 이어서 내보낸다
  assert.ok(/export \{ EmptyBookMark, PassageSkeleton, ShareSwitch, hlColor \};/.test(wb), 'wordBible이 공용 부품을 이어서 내보낸다');
  assert.ok(/export \{ mergeFeed \};/.test(wv) && /export \{ canDeleteShared \} from '\.\/shareFeed\.jsx';/.test(wv), 'wordView가 나눔 순수 함수를 이어서 내보낸다');
  console.log('PASS  말씀 쪼개기 배선(검색 비우기 · 결과 줄 · 쓰기 꼬리 · 훅 넷 · 초안 훅 · 공용 부품 · 재수출)');
}

// ── 예배·말씀·모임·청년 명단은 늦게 싣는다 (App.jsx 소스 단정) ──
// 첫 화면(홈·대시보드)이 쓰지 않는 화면이라 main 번들에서 뺐다(main gzip 165→118kB).
// 되돌리기: 넷 중 하나라도 App에서 정적 import로 되돌리면 깨진다.
{
  const app = readSrc('src/App.jsx');
  for (const [name, file] of [['MembersView', 'membersView'], ['WorshipView', 'worshipView'], ['WordView', 'wordView'], ['GroupsView', 'groupsView']]) {
    assert.ok(app.includes(`const ${name} = lazy(() => import('./views/${file}.jsx').then(m => ({ default: m.${name} })));`), `${name}는 lazy`);
    assert.ok(!new RegExp(`^import .* from '\\./views/${file}\\.jsx';`, 'm').test(app), `${file}를 정적으로 들이지 않는다`);
    assert.ok(new RegExp(`<Suspense fallback=\\{null\\}><${name} `).test(app), `${name}는 Suspense 안에 선다`);
  }
  console.log('PASS  예배·말씀·모임·청년 명단은 늦게 싣는다');
}
