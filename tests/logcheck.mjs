// logcheck — 공용 순수 로직(utils 잔것 · 실패 문구 · 한 벌 모음 · 키보드·커서 · 한글 조합 · 내 달력 구독). 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { loadSource } from './_load.mjs';

// ── 멘션 꼬리 (utils.splitMention) — 뽑는 쪽과 그리는 쪽이 같은 규칙 ──
// "(@박지호)"의 닫는 괄호가 칩 안에 들어갔다(2026-09-08). RichText가 `@\S+`를 통째로
// 칩에 넣었기 때문이다 — 이제 splitMention 한 벌을 쓴다.
{
  const src = readFileSync(new URL('../src/utils.js', import.meta.url), 'utf8');
  const { splitMention, extractMentions } = await loadSource('src/utils.js');
  assert.deepStrictEqual(splitMention('@박지호)'), { name: '박지호', tail: ')' });
  assert.deepStrictEqual(splitMention('@민수,'), { name: '민수', tail: ',' });
  assert.deepStrictEqual(splitMention('@시온'), { name: '시온', tail: '' });
  assert.deepStrictEqual(splitMention('@노준석)."'), { name: '노준석', tail: ')."' });
  assert.deepStrictEqual(splitMention('@)'), { name: '', tail: ')' }, '이름이 비면 칩을 만들지 않는다');
  assert.deepStrictEqual(extractMentions('웰컴팀 ( @박지호) · @시온.'), ['박지호', '시온'], '뽑는 쪽도 같은 꼬리 규칙');
  // 서식 안의 멘션(2026-09-25 · 라이브 카드 3장) — 굵게·형광펜·밑줄·취소선 기호도 꼬리다.
  // 되돌리기 검사: MENTION_TAIL에서 `*=_~` 를 빼면 이 줄이 깨진다.
  assert.deepStrictEqual(extractMentions('**@양민혁** 확인 · 담당(@박지호)** · ==@시온== · __@조해리__ · ~~@김윤주~~ · @노준석_서브'),
    ['양민혁', '박지호', '시온', '조해리', '김윤주', '노준석_서브'], '서식 기호는 이름이 아니다(가운데 _는 이름이다)');
  const rich = readFileSync(new URL('../src/components/RichText.jsx', import.meta.url), 'utf8');
  assert.ok(rich.includes('splitMention(p)'), 'RichText가 splitMention으로 칩과 꼬리를 가른다');
  assert.ok(!/\/\^@\\S\+\$\//.test(rich), 'RichText가 `@\\S+` 통째로 칩을 만들지 않는다');
  console.log('PASS  멘션 꼬리 8가지');
}

// ── 기호 보조 글꼴 (◡̈ — src/assets/fonts/symbols.css) ──
// SUIT에 없는 결합 부호·기하 도형은 한 글꼴에서 나와야 제자리에 붙는다(2026-09-08).
{
  const css = readFileSync(new URL('../src/assets/fonts/symbols.css', import.meta.url), 'utf8');
  const range = (css.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
  const covers = (cp) => range.split(',').some(part => {
    const m = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return false;
    const a = parseInt(m[1], 16), b = m[2] ? parseInt(m[2], 16) : a;
    return cp >= a && cp <= b;
  });
  assert.ok(covers(0x25E1) && covers(0x0308), '◡(U+25E1)와 결합 점(U+0308)이 보조 글꼴 범위에 있다');
  assert.ok(!covers(0xAC00) && !covers(0x41), '한글·라틴은 보조 글꼴이 맡지 않는다(SUIT 그대로)');
  const index = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const stack = (index.match(/--font-sans:\s*([^;]+);/) || [])[1] || '';
  assert.ok(stack.indexOf("'SUIT Variable'") >= 0 && stack.indexOf("'Daboot Symbols'") > stack.indexOf("'SUIT Variable'"),
    "보조 글꼴은 SUIT 바로 뒤에 선다");
  assert.ok(index.includes("@import './assets/fonts/symbols.css'"), 'index.css가 symbols.css를 import한다');
  const { statSync } = await import('node:fs');
  assert.ok(statSync(new URL('../src/assets/fonts/symbols.woff2', import.meta.url)).size > 1000, 'symbols.woff2가 있다');
  console.log('PASS  기호 보조 글꼴 5가지');
}

// ── 프로필 사진 주소 https 승격 (utils.httpsImage) ──
// 카카오 로그인이 http 주소를 준다. https 페이지에서 http 이미지는 브라우저가 혼합
// 콘텐츠로 막아 버려서, 카카오로 가입한 사람만 사진이 안 보였다(구글은 이미 https).
{
  const { httpsImage } = await loadSource('src/utils.js');
  assert.strictEqual(httpsImage('http://k.kakaocdn.net/dn/a/b.jpg'), 'https://k.kakaocdn.net/dn/a/b.jpg');
  assert.strictEqual(httpsImage('HTTP://img1.kakaocdn.net/x.png'), 'https://img1.kakaocdn.net/x.png', '대문자도');
  assert.strictEqual(httpsImage('https://lh3.googleusercontent.com/a/x'), 'https://lh3.googleusercontent.com/a/x', '이미 https면 그대로');
  assert.strictEqual(httpsImage(''), '', '빈 값은 빈 값 — 화면은 이름 첫 글자로 떨어진다');
  assert.strictEqual(httpsImage(null), '', 'null도 안전하다');
  assert.strictEqual(httpsImage(undefined), '', 'undefined도 안전하다');
  // 주소 한가운데의 http는 건드리지 않는다(?url=http://... 같은 경우)
  assert.strictEqual(httpsImage('https://x.com/i?u=http://y.com/a.png'), 'https://x.com/i?u=http://y.com/a.png');
  console.log('PASS  프로필 사진 https 승격 7가지');
}

// ── 프로젝트 탭 순서 (selectors.selectProjectsList) ──
// 0021의 position이 1차 키, created_at이 2차 키다. position이 전부 0인 옛 데이터에서
// 만든 순이 유지되는지, 드래그로 바꾼 position이 이기는지를 본다.
{
  const { selectProjectsList } = await import(new URL('../src/store/selectors.js', import.meta.url));
  const mk = (byId) => ({ projects: { byId, allIds: Object.keys(byId) } });
  const s1 = mk({
    b: { id: 'b', title: 'B', position: 0, createdAt: '2026-02-01' },
    a: { id: 'a', title: 'A', position: 0, createdAt: '2026-01-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s1).map(p => p.id), ['a', 'b'], 'position이 같으면 만든 순');
  const s2 = mk({
    a: { id: 'a', title: 'A', position: 2, createdAt: '2026-01-01' },
    b: { id: 'b', title: 'B', position: 1, createdAt: '2026-02-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s2).map(p => p.id), ['b', 'a'], '드래그로 정한 position이 이긴다');
  const s3 = mk({
    old: { id: 'old', title: '옛 행' },                                 // position·createdAt 없음(게스트)
    neo: { id: 'neo', title: '새 행', position: 1, createdAt: '2026-03-01' },
  });
  assert.deepStrictEqual(selectProjectsList(s3).map(p => p.id), ['old', 'neo'], '값이 없어도 안전하다');
  console.log('PASS  프로젝트 탭 순서 3가지');
}

// ── 실패 문구 (services/errorText.js) ──
// 화면에 Postgres 원문이 새지 않는지 + 흔한 코드마다 사람이 할 일을 말하는지.
// 되돌리기 검사: errorReason의 23502 갈래를 지우면 첫 단정이 바로 깨진다.
{
  const { errorReason, failText, objectParticle } =
    await import(new URL('../src/services/errorText.js', import.meta.url).href);

  const notNull = { code: '23502', message: 'null value in column "title" of relation "cards" violates not-null constraint' };
  assert.strictEqual(errorReason(notNull), '제목을 먼저 적어주세요');
  assert.strictEqual(failText('업무를 저장하지 못했어요', notNull), '업무를 저장하지 못했어요\n제목을 먼저 적어주세요');
  assert.strictEqual(errorReason({ code: '23502', message: 'null value in column "zzz" of relation "cards"' }), '아직 채우지 않은 부분이 있어요');
  assert.strictEqual(errorReason({ code: '23503', message: 'violates foreign key constraint "files_card_id_fkey"' }), '연결된 항목이 이미 지워졌어요\n새로고침해주세요');
  assert.strictEqual(errorReason({ code: '42501' }), '권한이 있어야 할 수 있는 일이에요');
  assert.strictEqual(errorReason({ message: 'new row violates row-level security policy' }), '권한이 있어야 할 수 있는 일이에요');
  assert.strictEqual(errorReason({ message: 'Failed to fetch' }), '인터넷 연결을 확인하고 다시 시도해주세요');
  assert.strictEqual(errorReason({ status: 413, message: 'The object exceeded the maximum allowed size' }), '파일이 너무 커요');
  assert.strictEqual(errorReason(null), '잠시 후 다시 시도해주세요');
  // 아는 코드가 하나도 없으면 **원문이라도** 보여준다. 아무 단서도 없이
  // '잠시 후 다시 시도해주세요'만 남으면 쓰는 사람도 고치는 사람도 원인을 못 본다
  // (첨부가 안 올라가는데 이유를 못 찾아 두 번 헤맸다).
  assert.strictEqual(errorReason({ code: 'ZZZZZ', message: 'boom' }), 'boom');
  assert.strictEqual(errorReason({}), '잠시 후 다시 시도해주세요');
  assert.ok(errorReason({ message: 'x'.repeat(200) }).length <= 91, '길면 잘라서 한 줄을 넘기지 않는다');
  // 우리 서버가 한국어로 이유를 준 경우에는 그것을 그대로 쓴다 — 버리면 화면에
  // '잠시 후 다시 시도해주세요'만 남아서 무엇이 막혔는지 아무도 모른다
  assert.strictEqual(errorReason({ human: '승인된 사용자만 파일을 올릴 수 있습니다.' }), '승인된 사용자만 파일을 올릴 수 있습니다.');
  // failText는 짧으면 한 줄(`무엇 · 왜`), 길면 줄을 나눈다(2026-08-28) — 토스트가
  // 한눈에 읽혀야 하는데 두 마디를 언제나 가운뎃점으로 붙이면 줄이 흘러넘친다.
  // 줄을 나누는 규칙 자체는 tests/drivesync.mjs가 본다.
  assert.strictEqual(failText('저장 실패', { human: '다시 시도해주세요' }), '저장 실패\n다시 시도해주세요');
  assert.strictEqual(failText('파일을 올리지 못했어요', { human: '25MB를 넘는 파일은 올릴 수 없습니다.' }),
    '파일을 올리지 못했어요\n25MB를 넘는 파일은 올릴 수 없습니다.');

  // 원문이 한 글자도 섞이지 않아야 한다 — 이게 이번 요청의 핵심 단정이다
  const raw = ['null value', 'constraint', 'relation', 'violates', 'code 2'];
  for (const e of [notNull, { code: '23503', message: 'violates foreign key constraint "x"' }, { code: '23505', message: 'duplicate key value violates unique constraint' }]) {
    const line = failText('업무를 저장하지 못했어요', e);
    for (const r of raw) assert.ok(!line.includes(r), `원문이 화면에 샜다: ${line}`);
  }

  assert.strictEqual(objectParticle('제목'), '을');
  assert.strictEqual(objectParticle('프로젝트'), '를');
  assert.strictEqual(objectParticle('file.png'), '를', '한글이 아니면 를');
  console.log('PASS  실패 문구 19가지');
}

// ── 본문 링크로 연 업무에서 뒤로가기 (App.jsx 소스 단정) ──────────────────────
// 주소 쓰기는 기본이 replaceState라 history가 안 쌓이고, 본문 링크로 건너뛸 때만
// 한 번 pushState라 뒤로가기가 보던 자리로 돌아온다. popstate는 주소를 다시 읽는다.
// 되돌리기 검사: pushNextUrlRef를 안 올리면 첫 단정이, popstate 리스너를 지우면
// 마지막 단정이 깨진다. (실제 동작은 브라우저로 확인한다 — 여기서는 배선만 지킨다.)
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(/pushNextUrlRef\.current = true; setActiveMenu\(task\.projectId\); openTaskModal\(task\)/.test(src),
    '본문 링크로 업무를 열 때 다음 주소를 push로 남긴다');
  assert.ok(/window\.history\.pushState\(null, '', next\)[\s\S]{0,40}window\.history\.replaceState\(null, '', next\)/.test(src),
    '주소 동기화는 push 한 번을 빼면 replaceState다');
  assert.ok(/addEventListener\('popstate'/.test(src) && /removeEventListener\('popstate'/.test(src),
    'popstate를 듣고 떼어낸다');
  // 업무 창이 열려 있으면 프로젝트는 그 업무의 것 — 내 업무·대시보드·검색에서 연
  // 사람은 isProjectScreen이 false라 projectId가 null로 나가서, 카드에는 얼굴이
  // 붙는데 프로젝트 탭 집계에서는 빠졌다(2026-08-30 — "업무는 3명인데 탭은 1명").
  assert.ok(/modalState\.isOpen && modalState\.task\?\.projectId\)\s*\|\|\s*\(isProjectScreen \? activeMenu : null\)/.test(src),
    '업무 창이 열려 있으면 그 업무의 프로젝트로 track한다(탭·카드 집계가 어긋나지 않게)');
  console.log('PASS  뒤로가기·트래킹 배선 4가지');
}

// ── 한 벌로 모은 것들 (2026-09-08 정리 회차) ───────────────────────────────
// 같은 규칙이 두 파일에 각각 적혀 있으면 반드시 한쪽만 고쳐진다. 이번에 셋을 모았고,
// 여기서는 **정말 한 벌인지**를 지킨다.
//
// 되돌리기 검사(실제로 해서 깨지는 것을 확인했다):
//   · cloud.js에 `const OPEN_EDITOR = {`를 되살리면 첫 묶음이 깨진다
//   · cloud.js에 `const sha256Hex =`를 되살리면 둘째 묶음이 깨진다
//   · App.jsx의 CHURCH_ORDER를 배열 리터럴로 되돌리면 셋째 묶음이 깨진다
{
  const cloudSrc = readFileSync(new URL('../src/services/cloud.js', import.meta.url), 'utf8');
  const layoutSrc = readFileSync(new URL('../src/components/layout.jsx', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  // ① 확장자 → 구글 편집기 표. 앱 안 미리보기(utils.driveSrc)와 새 탭에서 열기
  //    (cloud.getFileOpenUrl)가 같은 표를 봐야 "앱에서는 구글 화면인데 새 탭은 어두운
  //    파일 뷰어"인 파일이 안 생긴다.
  const { GOOGLE_EDITOR } = await loadSource('src/utils.js');
  assert.deepStrictEqual(
    Object.entries(GOOGLE_EDITOR).sort(),
    [['csv', 'spreadsheets'], ['doc', 'document'], ['docx', 'document'],
     ['ppt', 'presentation'], ['pptx', 'presentation'],
     ['xls', 'spreadsheets'], ['xlsx', 'spreadsheets']].sort(),
    '구글 편집기 표는 엑셀·워드·PPT 일곱 확장자');
  assert.ok(/import \{ GOOGLE_EDITOR \} from '\.\.\/utils\.js'/.test(cloudSrc),
    'cloud.js가 그 표를 가져다 쓴다');
  assert.ok(!/const (OPEN_EDITOR|DRIVE_EDITOR) = \{/.test(cloudSrc),
    'cloud.js에 같은 표가 다시 적혀 있지 않다');

  // ② 화면 가림 비밀번호 계산은 services/viewPw.js 한 벌.
  //    cloud.js가 자기 sha256Hex를 들고 있으면 한쪽을 고쳤을 때 걸어 둔 비밀번호가
  //    다른 쪽에서 안 풀린다(첨부·참고 링크·큐시트가 같은 세 칸을 쓴다).
  const { makeViewPw, verifyViewPw, isLocked } = await import(new URL('../src/services/viewPw.js', import.meta.url).href);
  const locked = await makeViewPw('daboot');
  assert.ok(locked.view_pw && locked.view_pw_salt, '비밀번호를 걸면 해시와 소금이 생긴다');
  assert.strictEqual(await verifyViewPw(locked, 'daboot'), true, '같은 비밀번호는 열린다');
  assert.strictEqual(await verifyViewPw(locked, 'daboo'), false, '다른 비밀번호는 안 열린다');
  assert.deepStrictEqual(await makeViewPw(''), { view_pw: null, view_pw_salt: null },
    '빈 값이면 두 칸을 다 비운다(소금만 남기면 예전 비밀번호가 살아난다)');
  assert.strictEqual(isLocked({ view_pw: null }), false);
  assert.ok(!/const sha256Hex/.test(cloudSrc), 'cloud.js에 같은 해시 계산이 다시 적혀 있지 않다');
  assert.ok(/import \{ makeViewPw, verifyViewPw \} from '\.\/viewPw\.js'/.test(cloudSrc),
    'cloud.js가 viewPw.js를 가져다 쓴다');
  assert.ok(/setViewPassword\('files'/.test(cloudSrc) && /setViewPassword\('resource_links'/.test(cloudSrc),
    '첨부와 참고 링크가 같은 쓰기 한 벌을 쓴다');
  // 방향은 한쪽뿐 — viewPw.js가 cloud.js를 물면 supabase가 딸려 와서 이 검사가 못 돈다
  const pwSrc = readFileSync(new URL('../src/services/viewPw.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/cloud\.js'/.test(pwSrc), 'viewPw.js는 cloud.js를 import하지 않는다');

  // ③ 교회 축 화면 목록. 하단 바에 서는 순서 = 화면 전환 방향의 기준이라,
  //    두 벌이면 탭을 눌렀는데 반대쪽에서 들어오는 화면이 생긴다.
  assert.ok(/export const CHURCH_MENUS = \['home', 'worship', 'word', 'groups'\]/.test(layoutSrc),
    '교회 축 목록은 layout.jsx가 소유한다');
  assert.ok(/CHURCH_MENUS \} from '\.\/components\/layout\.jsx'/.test(appSrc)
    && /const CHURCH_ORDER = CHURCH_MENUS;/.test(appSrc),
    'App이 그 목록을 그대로 전환 방향의 차례로 쓴다');
  assert.ok(!/\['home', 'worship', 'word', 'groups'\]/.test(appSrc),
    'App에 같은 배열이 다시 적혀 있지 않다');
  assert.ok((layoutSrc.match(/\['home', 'worship', 'word', 'groups'\]/g) || []).length === 1,
    'layout에도 한 번만 적혀 있다');

  console.log('PASS  한 벌로 모은 규칙 셋 15가지');
}

// ── 키보드가 올라와도 쓰던 칸이 보이는지 (소스 단정) ─────────────────────────
// 폰에서 댓글 칸이 키보드에 가리고, 업무 수정에서는 손으로 다시 내려야 했다
// (사용자 신고 2026-09-22 · 실기기 두 대). 원인 둘:
//   ① 모바일 업무 창이 `fixed inset-0`이라 **레이아웃 뷰포트**에 붙어 있었다 —
//      키보드가 올라와 앱 뿌리(--app-vh)가 줄어도 그 창의 바닥은 키보드 밑에 남는다.
//   ② 모달 안 스크롤 상자에서는 브라우저가 focus된 칸을 알아서 끌어오지 못한다.
// 키보드는 헤드리스에서 못 띄우므로 소스로 지킨다(presence.js·§6-31과 같은 방식).
// 되돌리기 검사: 모달의 `h-[var(--app-vh,100dvh)]`를 `inset-0`으로 되돌리면 첫 단정이,
// App.jsx의 scrollIntoView를 지우면 셋째가 깨진다.
{
  const modals = readFileSync(new URL('../src/modals/modals.jsx', import.meta.url), 'utf8');
  const mobileOpen = modals.slice(modals.indexOf('if (isMobile) {'));
  assert.ok(/fixed inset-x-0 top-0 h-\[var\(--app-vh,100dvh\)\][^"]*z-50 bg-surface/.test(mobileOpen),
    '모바일 업무 창은 앱 뿌리와 같은 높이를 쓴다(fixed inset-0이면 키보드 밑에 남는다)');
  assert.ok(!/className="fixed inset-0 z-50 bg-surface/.test(modals),
    'inset-0으로 되돌아간 자리가 없다');

  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const vv = app.slice(app.indexOf('const vv = window.visualViewport;'));
  assert.ok(/requestAnimationFrame\(keepCaretVisibleSettled\)/.test(vv),
    '창이 줄면 커서를 보이는 자리로 끌어온다(새 높이가 잡힌 다음 프레임에)');
  // 키보드가 올라오는 동안 **매 프레임 따라간다**(2026-09-22 실기기 — 시각마다 툭툭
  // 밀었더니 "뚜두둑" 끊겨 보였다). 비율로 좁히면 움직임이 이어지고, 목표가 계속
  // 바뀌어도 그때그때 다시 잰다. 되돌리기 검사: rAF 되풀이를 setTimeout 몇 개로
  // 바꾸면 첫 단정이, 2px 스냅을 빼면 셋째가 깨진다(비율로만 좁히면 영영 안 닿는다).
  assert.ok(/followId = requestAnimationFrame\(step\)/.test(app),
    '키보드가 올라오는 동안 프레임마다 따라간다');
  assert.ok(/dy \* FOLLOW_EASE/.test(app), '한 프레임에 남은 거리의 일부만 좁힌다');
  assert.ok(/Math\.abs\(dy\) < 2 \? dy :/.test(app), '2px 안쪽은 한 번에 붙인다');
  assert.ok(/cancelAnimationFrame\(followId\)/.test(app),
    '다시 부르면 앞의 따라가기를 멈춘다 — 둘이 겹치면 서로 민다');
  // 업무 창은 창 전체가 한 번, 그 안의 상세 칸이 또 한 번 구르는 겹 구조다.
  assert.ok(/left -= \(n\.scrollTop - was\)/.test(app),
    '한 상자로 모자라면 바깥 상자를 이어서 민다');
  assert.ok(!/behavior: 'smooth'/.test(app),
    '커서 맞추기는 바로 민다 — 부드럽게 하면 여러 번 부르는 것과 서로 싸운다');
  assert.ok(/const shrank = h < lastH - 80/.test(vv),
    '키보드와 주소창 여닫힘을 가른다 — 주소창은 이보다 적게 움직인다');
  assert.ok(/selectionchange/.test(vv) && /setTimeout\(keepCaretVisible, 120\)/.test(vv),
    '글을 쓰는 동안 커서가 내려가도 따라간다(글자마다 굴리지 않게 한 박자 묶는다)');
  // 주석에는 그 이름이 남아 있다(왜 안 쓰는지를 적어 뒀다) — **부르는 자리**만 본다.
  assert.ok(!new RegExp('\\.scrollIntoView\\(').test(app.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')),
    'scrollIntoView로 돌아가지 않았다 — 그건 칸 전체를 가운데로 보내서 커서와 무관하다');
  assert.ok(/data-kb-bar/.test(app) && /data-kb-bar/.test(modals),
    '아래 도구 줄(저장·취소) 높이를 셈이 안다 — 그 줄이 커서를 가리던 자리다');
  assert.ok(/isContentEditable/.test(app),
    '본문 편집기(contenteditable)도 같이 본다 — 업무 수정이 그 자리다');
  console.log('PASS  키보드가 올라와도 커서가 보인다 14가지');
}

// ── 커서를 얼마나 굴려야 하나 (utils.caretShift) ────────────────────────────
// 위 소스 단정이 '배선'을 보는 것이라면, 이건 **셈 자체**를 본다. 순수 함수라 그냥 부른다.
// 되돌리기 검사: `caret.bottom > bottom` 갈래를 지우면 첫 단정이, 띠가 없을 때의
// 조기 반환을 지우면 마지막이 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  const view = { top: 0, bottom: 400 };   // 보이는 띠: 0~400 (그 아래는 저장·취소 바)
  assert.strictEqual(U.caretShift({ top: 380, bottom: 400 }, view), 12,
    '커서가 바에 닿으면 그만큼 굴린다(여백 12px)');
  assert.strictEqual(U.caretShift({ top: 100, bottom: 120 }, view), 0,
    '띠 안에 있으면 안 굴린다 — 글자마다 화면이 움직이면 멀미가 난다');
  assert.strictEqual(U.caretShift({ top: 0, bottom: 20 }, view), -12,
    '위로 숨었으면 음수 — 내려서 보여 준다');
  assert.strictEqual(U.caretShift({ top: 500, bottom: 520 }, view), 132,
    '한참 아래면 그만큼 크게 굴린다');
  assert.strictEqual(U.caretShift(null, view), 0, '커서를 못 재면 가만히 둔다');
  assert.strictEqual(U.caretShift({ top: 10, bottom: 30 }, { top: 0, bottom: 10 }), 0,
    '키보드가 띠를 다 먹었으면 굴리지 않는다(굴려 봐야 보일 자리가 없다)');
  console.log('PASS  커서를 얼마나 굴리나 6가지');
}

// ── 한글 조합 중의 Enter는 확정이 아니다 (utils.imeComposing · 2026-09-25 감사 S6) ──────
// 맥·아이폰은 조합 중인 마지막 글자를 끝내는 Enter를 칸에 그대로 보낸다 — 그 Enter로 등록이
// 한 번 돌고, 끝난 글자가 칸에 남았다. **Enter로 무언가를 하는 칸은 전부** 이 가드를 먼저 본다:
// 소스에서 `e.key === 'Enter'`가 나오는 핸들러마다 같은 핸들러 안에 imeComposing이 있어야 한다.
// 되돌리기 검사: 한 곳에서 `if (imeComposing(e)) return;`을 지우면 둘째 단정이 그 파일을 짚는다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  assert.strictEqual(U.imeComposing({ nativeEvent: { isComposing: true } }), true, 'React 이벤트의 조합');
  assert.strictEqual(U.imeComposing({ isComposing: true }), true, 'DOM 이벤트의 조합');
  assert.strictEqual(U.imeComposing({ keyCode: 229 }), true, '옛 브라우저(keyCode 229)');
  assert.strictEqual(U.imeComposing({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 }), false, '보통 Enter');
  const { readdirSync, readFileSync: rf, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src/', import.meta.url);
  const walk = (dir) => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : (/\.(jsx?|mjs)$/.test(n) ? [p] : []);
  });
  const missing = [];
  let seen = 0;
  const { fileURLToPath } = await import('node:url');
  for (const file of walk(fileURLToPath(root))) {
    const lines = rf(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\b(e|event)\.key === 'Enter'/.test(line)) return;
      // 성경 절 고르기(wordBible)는 글 칸이 아니다 — Enter·Space로 누르는 줄이다
      if (/e\.key !== 'Enter'/.test(line)) return;
      seen++;
      // 같은 줄, 아니면 그 핸들러의 앞 8줄 안에 가드가 있어야 한다
      const near = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      if (!/imeComposing\((e|event)\)/.test(near)) missing.push(`${file.split(/[\\/]src[\\/]/)[1]}:${i + 1}`);
    });
  }
  assert.ok(seen >= 20, `Enter 핸들러를 못 찾는다(${seen})`);
  assert.deepStrictEqual(missing, [], `조합 가드가 없는 Enter 핸들러: ${missing.join(', ')}`);
  console.log(`PASS  한글 조합 중 Enter 가드(핸들러 ${seen}곳) 6가지`);
}

// ── pdf.js 6.3이 옛 브라우저에서 모듈째 죽지 않는다 (services/pdfPolyfill.js) ──
// 6.3은 모듈 맨 위에서 `Iterator.prototype.join`을 본다 — `Iterator` 전역이 없으면(사파리 18.4 ·
// 크롬 122 미만) ReferenceError로 PDF가 통째로 안 열린다. 노드에는 다 있으므로 **새 전역 칸(vm)을
// 만들어 그 셋을 지운 뒤** 폴리필을 돌리고, 설치된 pdf.mjs의 그 첫 줄과 pdf.js가 실제로 쓰는
// 모양(`keys().filter().toArray()` 등)을 그대로 부른다.
// 되돌리기 검사: 폴리필의 `globalThis.Iterator` 세우기를 지우면 첫 단정이 ReferenceError로 깨진다.
{
  const vm = await import('node:vm');
  const poly = readFileSync(new URL('../src/services/pdfPolyfill.js', import.meta.url), 'utf8');
  const pdfSrc = readFileSync(new URL('../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url), 'utf8');
  const head = pdfSrc.slice(pdfSrc.indexOf('if (typeof Iterator.prototype.join'), pdfSrc.indexOf('\n}\n', pdfSrc.indexOf('if (typeof Iterator.prototype.join')) + 3);
  assert.ok(head.includes('Iterator.prototype.join = function'), '설치된 pdf.mjs에서 Iterator 첫 줄을 못 찾았다(판이 바뀌었나?)');
  const old = vm.createContext({});
  vm.runInContext(`
    const P = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    for (const k of ['map', 'filter', 'some', 'every', 'find', 'forEach', 'toArray', 'reduce', 'take', 'drop', 'flatMap']) delete P[k];
    delete globalThis.Iterator; delete Promise.try; delete Math.sumPrecise;`, old);
  assert.strictEqual(vm.runInContext('typeof Iterator', old), 'undefined', '옛 브라우저 흉내가 안 됐다');
  vm.runInContext(poly, old);
  vm.runInContext(head, old);                     // pdf.js 6.3의 모듈 첫 줄 — 여기서 죽으면 PDF가 통째로 안 열린다
  const r = vm.runInContext(`({
    filt: new Set([3, 1, 2]).keys().filter(x => x > 1).toArray(),
    find: new Map([['a', 1], ['b', 2]]).keys().find(k => k === 'b'),
    some: new Map([['a', { n: 1 }]]).values().some(v => v.n === 1),
    join: new Map([['x', 'A'], ['y', 'B']]).values().join(''),
    map: [1, 2].values().map((v, i) => v * 10 + i).toArray(),
    each: (() => { let s = 0; [1, 2, 3].values().forEach(v => { s += v; }); return s; })(),
    every: [2, 4].values().every(v => v % 2 === 0),
    sum: Math.sumPrecise([0.5, 1.5, 2]),
    iterIsProto: Iterator.prototype === Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
  })`, old);
  assert.deepStrictEqual([...r.filt], [3, 2], 'Set.keys().filter().toArray() (pdf.js 텍스트 레이어)');
  assert.strictEqual(r.find, 'b', 'Map.keys().find() (pdf.js 범위 읽기)');
  assert.strictEqual(r.some, true, 'Map.values().some() (편집기 · 폼)');
  assert.strictEqual(r.join, 'AB', 'values().join() (XFA)');
  assert.deepStrictEqual([...r.map], [10, 21], 'map은 순번을 둘째 인자로 준다');
  assert.strictEqual(r.each, 6);
  assert.strictEqual(r.every, true);
  assert.strictEqual(r.sum, 4, 'Math.sumPrecise');
  assert.strictEqual(r.iterIsProto, true, 'Iterator.prototype이 내장 이터레이터들이 물려받는 그 객체가 아니다');
  const tried = await vm.runInContext(`Promise.try(() => { throw new Error('동기 오류'); }).then(() => 'ok', e => e.message)`, old);
  assert.strictEqual(tried, '동기 오류', 'Promise.try가 동기 오류를 거절로 바꾸지 않는다(워커 메시지 처리)');
  assert.strictEqual(await vm.runInContext(`Promise.try((a, b) => a + b, 2, 3)`, old), 5, 'Promise.try가 인자를 넘기지 않는다');

  // 이미 있는 브라우저(노드 그대로)에서는 아무것도 바꾸지 않는다 — 네이티브가 언제나 더 빠르다
  const now = vm.createContext({});
  const before = vm.runInContext('[Iterator, Iterator.prototype.map, Iterator.prototype.toArray, Promise.try, Math.sumPrecise]', now);
  vm.runInContext(poly, now);
  const after = vm.runInContext('[Iterator, Iterator.prototype.map, Iterator.prototype.toArray, Promise.try, Math.sumPrecise]', now);
  before.forEach((f, i) => { if (typeof f === 'function') assert.strictEqual(after[i], f, `네이티브를 덮었다(${i})`); });
  console.log('PASS  pdf.js 6.3 옛 브라우저 폴리필 15가지');
}

// ── 조건부로 뜨는 무거운 부품은 열 때만 받는다 (2026-09-24) ─────────────────────────────
// 미리보기 창(+PdfView) · 순모임 가이드 패널 · 선후관계 그래프 · 동아리 QR 창은 누르거나 자격이
// 있을 때만 뜨는데 첫 번들에 실려 있었다. **한 곳이라도 정적 import가 남으면 그 파일은 도로 첫
// 번들로 끌려 들어간다** — 그래서 모든 사용처를 본다. 가이드 패널은 React.lazy가 아니라 미리
// 받아 두고 딸린 섹션의 스켈레톤 한 덩이로 기다린다(Suspense 폴백이 두 번째 스켈레톤이 된다 —
// tests/groups '딸린 두 섹션의 스켈레톤은 하나다').
// 되돌리기 검사: attachments.jsx의 import를 정적으로 되돌리면 첫 단정이 깨진다.
{
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const all = ['modals/attachments.jsx', 'components/worshipDetail.jsx', 'components/groupsClub.jsx',
    'views/views.jsx', 'views/groupsView.jsx'];
  const lazyOf = { FilePreviewModal: 'FilePreviewModal.jsx', ClubQrModal: 'ClubQr.jsx', DepGraph: 'depgraph.jsx' };
  for (const p of all) {
    const s = src(p);
    for (const [name, file] of Object.entries(lazyOf)) {
      assert.ok(!new RegExp(`^import \\{[^}]*\\b${name}\\b[^}]*\\} from '[^']*${file.replace('.', '\\.')}';`, 'm').test(s),
        `${p}가 ${name}을 정적으로 import한다 — 첫 번들로 끌려 들어간다`);
    }
    assert.ok(!/^import [^;]*from '[^']*components\/sunGuide\.jsx';/m.test(s) && !/^import [^;]*from '\.\/sunGuide\.jsx';/m.test(s),
      `${p}가 가이드 패널을 정적으로 import한다`);
  }
  assert.ok(/const FilePreviewModal = lazy\(\(\) => import\('\.\.\/components\/FilePreviewModal\.jsx'\)/.test(src('modals/attachments.jsx')),
    '업무 첨부의 미리보기 창은 lazy');
  assert.ok(/const FilePreviewModal = lazy\(\(\) => import\('\.\/FilePreviewModal\.jsx'\)/.test(src('components/worshipDetail.jsx')),
    '송폼·큐시트의 미리보기 창은 lazy');
  assert.ok(/<Suspense fallback=\{null\}><ClubQrModal/.test(src('components/groupsClub.jsx')), 'QR 창은 lazy · 폴백 없음');
  assert.ok(/<Suspense fallback=\{null\}><DepGraph/.test(src('views/views.jsx')), '그래프는 lazy · 폴백 없음');
  const gv = src('views/groupsView.jsx');
  assert.ok(/import\('\.\.\/components\/sunGuide\.jsx'\)/.test(gv), '가이드 패널은 동적으로 받는다');
  assert.ok(/if \(!canViewGuide \|\| GuidePanel \|\| guideFailed\) return undefined;/.test(gv), '볼 자격이 있을 때만 받는다');
  assert.ok(/\{mineSettled && !guideWait \? \(/.test(gv), '받는 동안은 딸린 섹션 스켈레톤 한 덩이가 선다');
  console.log('PASS  무거운 부품은 열 때만 7가지');
}

// ── 주보 편집 줄의 열쇠 (utils.stableRowKeys · 2026-09-24) ─────────────────────────────
// 줄에 id가 없어 key={i}였다 — 옮기기·지우기에서 한 줄의 상태가 옆 줄로 넘어갔다. 열쇠는
// 저장하지 않는다(jsonb 모양 그대로). 되돌리기 검사: 함수가 자리 번호를 돌려주게 바꾸면
// 옮기기·지우기 단정이 깨지고, ②(같은 자리 이어 쓰기)를 빼면 고치기 단정이 깨진다.
{
  const U = await import(new URL('../src/utils.js', import.meta.url).href);
  let n = 0; const mint = () => `n${++n}`;
  const a = { role: '대표기도', name: '김' }, b = { role: '광고', name: '이' }, c = { role: '헌금', name: '박' };
  const k0 = U.stableRowKeys([], [], [a, b, c], mint);
  assert.deepStrictEqual(k0, ['n1', 'n2', 'n3'], '처음에는 줄마다 새 열쇠');
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [b, a, c], mint), ['n2', 'n1', 'n3'], '옮기면 열쇠가 줄을 따라간다');
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [a, c], mint), ['n1', 'n3'], '지우면 남은 줄의 열쇠가 그대로다');
  const b2 = { ...b, name: '이수' };
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, [a, b2, c], mint), ['n1', 'n2', 'n3'],
    '그 자리에서 고친 줄(새 객체)은 열쇠를 이어 쓴다 — 칠 때마다 칸이 새로 마운트되지 않게');
  const d = { role: '', name: '' };
  const kAdd = U.stableRowKeys([a, b, c], k0, [a, b, c, d], mint);
  assert.ok(kAdd.slice(0, 3).join() === 'n1,n2,n3' && !k0.includes(kAdd[3]), '더한 줄은 새 열쇠');
  const fresh = [{ ...a }, { ...b }, { ...c }];
  assert.deepStrictEqual(U.stableRowKeys([a, b, c], k0, fresh, mint), ['n1', 'n2', 'n3'], '통째로 다시 읽으면 자리대로 잇는다');
  const twice = U.stableRowKeys([a, b], ['x', 'y'], [a, a], mint);
  assert.ok(twice[0] === 'x' && twice[1] !== 'x' && new Set(twice).size === 2, '한 열쇠를 두 줄에 주지 않는다');
  console.log('PASS  주보 편집 줄 열쇠 7가지');
}

// ── 내 달력 구독 (0085 · services/calendarFeed.js · api/ics.js · 2026-09-28) ─────────────
// 프로젝트 달력에서 고른 업무 → 폰·구글 달력 구독 주소(`/cal/<feed>/<서명>.ics`). 화면과 서버가 같은 순수
// 모듈을 본다 — 설명 문장 · 날짜 글자 · 하루 종일 일정(끝은 다음 날) · 이스케이프·75옥텟 접기·CRLF ·
// 구글 cid 주소 · 기기 → 버튼 · 저장 줄 세우기(400ms 모음 · 하나씩 · 옛 응답 버림) · 서버 배선.
// 되돌리기 검사(2026-09-28): feedEvent의 `+ DAY`를 빼면 DTEND 단정이, api/ics.js의
// `onConflict: 'owner,project_id'`를 지우면 배선 단정이, createFeedSaver의 `if (busy) { again = true; return; }`를
// 걷으면 '보내는 중에는 하나만' 단정이 깨지는 것을 보고 되돌렸다.
{
  process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret';
  const F = await import(new URL('../src/services/calendarFeed.js', import.meta.url).href);
  const { CONFIG } = await import(new URL('../src/config.js', import.meta.url).href);

  // 설명 문장(목업 문구 그대로)
  assert.strictEqual(F.feedSentence([]), '내 달력에 넣을 업무를 골라 주세요.');
  assert.strictEqual(F.feedSentence(['임원 선출']), '임원 선출 업무가 내 달력에 일정으로 들어가요.');
  assert.strictEqual(F.feedSentence(['A', 'B']), 'A, B 업무가 내 달력에 일정으로 들어가요.');
  assert.strictEqual(F.feedSentence(['A', 'B', 'C']), 'A, B 업무 외 1건이 내 달력에 일정으로 들어가요.');
  assert.strictEqual(F.feedSentence(['A', 'B', 'C', 'D', 'E']), 'A, B 업무 외 3건이 내 달력에 일정으로 들어가요.');

  // 날짜 글자
  assert.strictEqual(F.feedDateLabel({ dueDate: '2026-10-11' }), '10월 11일');
  assert.strictEqual(F.feedDateLabel({ startDate: '2026-10-11', dueDate: '' }), '10월 11일', '시작일만 있으면 그 하루');
  assert.strictEqual(F.feedDateLabel({ startDate: '2026-10-04', dueDate: '2026-10-25' }), '10월 4일 ~ 25일');
  assert.strictEqual(F.feedDateLabel({ startDate: '2026-09-28', dueDate: '2026-10-03' }), '9월 28일 ~ 10월 3일', '달을 넘으면 달을 다시 적는다');
  assert.strictEqual(F.feedDateLabel({ startDate: '2026-10-25', dueDate: '2026-10-04' }), '10월 4일 ~ 25일', '거꾸로 적힌 기간은 뒤집는다(calendar spanOf)');
  assert.strictEqual(F.feedDateLabel({}), '');

  // 고를 수 있는 업무 · 처음 골라 둘 것
  const T = (id, title, status, startDate, dueDate, assignees = []) => ({ id, title, status, startDate, dueDate, assignees });
  const tasks = [T('c', '사역기획모임', '시작 전', '2026-10-04', '2026-10-25', ['노준석']), T('o', '순번표', '상시', '', '2026-12-31'),
    T('n', '마감 미정', '시작 전', '', ''), T('a', '임원진 선출', '보류 중', '', '2026-09-27'), T('b', '사역팀장 선출', '완료', '', '2026-10-11', ['노준석', '강꽃님'])];
  const pick = F.feedPickable(tasks);
  assert.deepStrictEqual(pick.map(t => t.id), ['a', 'c', 'b'], '상시·날짜 없는 업무는 빠지고 이른 날부터 · 완료는 남는다');
  assert.deepStrictEqual(F.feedDefaultPick(pick, '노준석'), ['c', 'b'], '처음에는 내가 담당자인 업무');
  assert.deepStrictEqual(F.feedDefaultPick(pick, '없는 사람'), [], '없으면 아무것도 고르지 않는다');

  // 상태 글자 — config.STATUS_DB를 뒤집은 것과 같다
  assert.deepStrictEqual(F.STATUS_KO, Object.fromEntries(Object.entries(CONFIG.STATUS_DB).map(([a, d]) => [d, a])));
  assert.ok(F.feedKeepRow({ status: 'done', due_date: '2026-10-11' }) && !F.feedKeepRow({ status: 'ongoing', due_date: '2026-10-11' })
    && !F.feedKeepRow({ status: 'todo', start_date: null, due_date: null }), '서버 거름: 상시·날짜 없음은 빠지고 완료는 남는다');

  // .ics
  const link = F.taskLink('https://church-workspace.vercel.app', 'p1', 'c1');
  assert.strictEqual(link, 'https://church-workspace.vercel.app/?p=p1&t=c1', '앱 딥링크(App.jsx ?p=&t=)');
  const long = '2027 더다붓 사역기획모임, 준비; 첫째\n둘째 — 아주 긴 제목이 이어져서 한 줄 칠십오 옥텟을 훌쩍 넘어가는 경우';
  const ev1 = F.feedEvent({ id: 'c1', title: long, status: '진행 중', startDate: '2026-10-04', dueDate: '2026-10-25', assignees: ['노준석', '강꽃님'] }, link);
  const ev2 = F.feedEvent({ id: 'c2', title: '임원 선출', status: '완료', startDate: '2026-10-11', dueDate: '', assignees: [] }, link);
  assert.strictEqual(ev1.end, '20261026', '끝은 다음 날(DTEND;VALUE=DATE는 그 날을 빼고 센다)');
  assert.strictEqual(ev2.start, '2026-10-11'); assert.strictEqual(ev2.end, '20261012', '시작일만 있으면 하루');
  assert.strictEqual(F.feedEvent({ id: 'x', title: 'x', status: '시작 전' }, link), null);
  const ics = F.buildFeedIcs({ calName: F.feedCalName('2027 사역기획'), events: [ev1, ev2], now: Date.UTC(2026, 8, 28, 3, 0) });
  assert.ok(ics.endsWith('\r\n') && !/[^\r]\n/.test(ics), '줄 끝은 모두 CRLF');
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, `75옥텟 이하: ${l}`);
  const lines = ics.replace(/\r\n /g, '').split('\r\n');   // 접은 줄을 편다
  assert.ok(lines.includes('X-WR-CALNAME:더다붓 · 2027 사역기획') && lines.includes('REFRESH-INTERVAL;VALUE=DURATION:PT1H')
    && lines.includes('X-PUBLISHED-TTL:PT1H'), '달력 이름 · 다시 읽는 간격');
  assert.deepStrictEqual(lines.filter(l => l.startsWith('UID:')), ['UID:card-c1@thedaboot', 'UID:card-c2@thedaboot'], 'UID는 업무 id — 고치면 같은 일정이 바뀐다');
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20261004') && lines.includes('DTEND;VALUE=DATE:20261026')
    && lines.includes('DTSTART;VALUE=DATE:20261011') && lines.includes('DTEND;VALUE=DATE:20261012'), '하루 종일 일정');
  assert.ok(lines.includes('SUMMARY:2027 더다붓 사역기획모임\\, 준비\\; 첫째\\n둘째 — 아주 긴 제목이 이어져서 한 줄 칠십오 옥텟을 훌쩍 넘어가는 경우'), '쉼표·쌍반점·줄바꿈 이스케이프');
  const desc = lines.find(l => l.startsWith('DESCRIPTION:') && l.includes('임원 선출'));
  assert.strictEqual(desc, `DESCRIPTION:임원 선출 · 완료\\n더다붓 워크스페이스에서 열기\\n${link}`, '담당자가 없으면 그 줄을 뺀다');
  assert.ok(lines.some(l => l.startsWith('DESCRIPTION:') && l.includes('\\n담당자 노준석\\, 강꽃님\\n더다붓 워크스페이스에서 열기\\n')), '담당자 줄');
  assert.ok(lines.includes(`URL:${link}`) && lines.includes('DTSTAMP:20260928T030000Z'));

  // 주소 · 기기 → 버튼
  const urls = F.feedUrls('church-workspace.vercel.app', 'f1', 'S_ig-1');
  assert.deepStrictEqual(urls, { url: 'https://church-workspace.vercel.app/cal/f1/S_ig-1.ics', webcal: 'webcal://church-workspace.vercel.app/cal/f1/S_ig-1.ics' });
  assert.strictEqual(F.googleSubscribeUrl(urls.webcal), 'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fchurch-workspace.vercel.app%2Fcal%2Ff1%2FS_ig-1.ics');
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  };
  const labels = (ua, touch = 0) => F.feedButtons(F.feedDevice(ua, touch)).map(b => b.label);
  assert.deepStrictEqual(labels(UA.iphone), ['아이폰 달력에 추가', '주소 복사']);
  assert.deepStrictEqual(labels(UA.ipad, 5), ['아이폰 달력에 추가', '주소 복사'], '아이패드는 Mac UA + 터치로 가른다');
  assert.deepStrictEqual(labels(UA.android), ['구글 캘린더에 추가', '주소 복사']);
  assert.deepStrictEqual(labels(UA.mac), ['구글 캘린더에 추가', 'Mac 캘린더에 추가', '주소 복사']);
  assert.deepStrictEqual(labels(UA.mac, 10), ['구글 캘린더에 추가', 'Mac 캘린더에 추가', '주소 복사'], 'Mac 크롬 UA는 터치 점이 있어도 Mac');
  assert.deepStrictEqual(labels(UA.win), ['구글 캘린더에 추가', '주소 복사']);
  assert.ok(F.feedButtons(F.feedDevice(UA.iphone))[0].primary && F.feedIsMobile(F.feedDevice(UA.android)) && !F.feedIsMobile(F.feedDevice(UA.mac)));
  assert.deepStrictEqual(F.feedHref('webcal', urls, false), { href: urls.webcal, how: 'location' });
  assert.deepStrictEqual(F.feedHref('google', urls, false), { href: F.googleSubscribeUrl(urls.webcal), how: 'window' });
  const kakao = F.feedDevice(`${UA.iphone} KAKAOTALK 10.8.0`);
  assert.ok(kakao.kakao && kakao.os === 'ios');
  assert.deepStrictEqual(F.feedHref('webcal', urls, true), { href: `kakaotalk://web/openExternal?url=${encodeURIComponent(urls.webcal)}`, how: 'location' }, '카카오 인앱은 기본 브라우저로 넘긴다');
  assert.strictEqual(F.feedHref('copy', urls), null); assert.strictEqual(F.feedHref('webcal', null), null);

  // 저장 줄 세우기 — 가짜 시계 · 손으로 끝내는 요청
  {
    let now = 0; const timers = [];
    const setTimer = (fn, ms) => { const t = { fn, at: now + ms, dead: false }; timers.push(t); return t; };
    const clearTimer = (t) => { if (t) t.dead = true; };
    const tick = async (ms) => { now += ms; for (const t of timers.filter(x => !x.dead && x.at <= now)) { t.dead = true; t.fn(); } await new Promise(r => setImmediate(r)); };
    const sent = []; const done = [];
    let release = [];
    const send = (cards) => { sent.push(cards); return new Promise(r => release.push(() => r({ url: `u${sent.length}`, cards }))); };
    const s = F.createFeedSaver(send, { delay: 400, setTimer, clearTimer, onDone: (out) => done.push(out.url) });
    s.set(['a']); await tick(100); s.set(['a', 'b']); await tick(100); s.set(['b']);
    await tick(399); assert.strictEqual(sent.length, 0, '400ms 안의 체크는 모은다');
    await tick(1); assert.deepStrictEqual(sent, [['b']], '마지막 것 하나만 보낸다');
    s.set(['b', 'c']); await tick(400); s.set(['c']); await tick(400);
    assert.strictEqual(sent.length, 1, '보내는 중에는 하나만 — 끝날 때까지 기다린다');
    assert.ok(s.pending);
    release.shift()(); await tick(0); await tick(0);
    assert.deepStrictEqual(sent, [['b'], ['c']], '끝나면 그사이 바뀐 것 중 마지막 것을 한 번 더');
    release.shift()(); await tick(0); await tick(0);
    assert.deepStrictEqual(done, ['u1', 'u2']); assert.ok(!s.pending);
    s.set(['d']); s.flush(); await tick(0);
    assert.deepStrictEqual(sent.at(-1), ['d'], 'flush는 기다리지 않고 보낸다(창 닫기·버튼)');
    release.shift()(); await tick(0);
    // 실패해도 다음 저장은 간다
    const s2 = F.createFeedSaver(() => Promise.reject(new Error('x')), { delay: 1, setTimer, clearTimer, onFail: () => done.push('fail') });
    s2.set(['z']); await tick(1); await tick(0);
    assert.strictEqual(done.at(-1), 'fail');
  }

  // 배선 — 재작성 · 크론 둘 · upsert 열쇠 · 승인 확인 · 서명 접두 · 광고 길 그대로
  const vj = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/cal/:f/:file' && r.destination === '/api/ics?f=:f&sig=:file'), '/cal/ 재작성');
  assert.strictEqual(vj.crons.length, 2, '크론은 둘 그대로(Hobby)');
  assert.ok(!existsSync(new URL('../api/calendar.js', import.meta.url)) && !existsSync(new URL('../api/feed.js', import.meta.url)), '함수 파일을 늘리지 않는다');
  const icsSrc = readFileSync(new URL('../api/ics.js', import.meta.url), 'utf8');
  assert.ok(/\.upsert\(\{ owner, project_id: project, card_ids: kept[^}]*\}, \{ onConflict: 'owner,project_id' \}\)/.test(icsSrc), 'POST는 (owner, project_id) upsert');
  assert.ok(/const owner = await ownerOf\(supabase, user\.id\)/.test(icsSrc), '주인은 세션에서 정한다(몸통을 믿지 않는다)');
  assert.ok(/if \(!feed \|\| !\(await ownerApproved\(supabase, feed\.owner\)\)\) \{ gone\(res\); return; \}/.test(icsSrc)
    && /isApprovedProfile\(supabase, owner\)/.test(icsSrc) && /isAdminEmail\(supabase, data\?\.email\)/.test(icsSrc), 'GET은 매번 주인의 승인을 본다');
  assert.ok(/safeEqual\(sig, calSig\(f\)\)/.test(icsSrc) && /`cal:\$\{process\.env\.SUPABASE_SECRET_KEY/.test(icsSrc) && /`ics:\$\{process\.env\.SUPABASE_SECRET_KEY/.test(icsSrc),
    '구독 서명은 cal: 접두(광고 ics:와 다른 열쇠)');
  assert.ok(/'Cache-Control', 'public, max-age=300'/.test(icsSrc) && /picked\.has\(r\.id\) && feedKeepRow\(r\)/.test(icsSrc), '캐시 5분 · 지금 남은 업무만');
  assert.ok(/\.eq\('project_id', feed\.project_id\)/.test(icsSrc), '다른 프로젝트로 간 업무는 빠진다');
  assert.ok(/const a = argsOf\(body\);/.test(icsSrc) && /sign\(a\.s, a\.n, e\)/.test(icsSrc) && /\?s=\$\{a\.s\}&n=\$\{a\.n\}&e=\$\{e\}&sig=/.test(icsSrc), '광고 → 내 달력 길은 그대로');
  const { calSig } = await import(new URL('../api/ics.js', import.meta.url).href);
  const { createHmac } = await import('node:crypto');
  const id = '11111111-2222-3333-4444-555555555555';
  assert.strictEqual(calSig(id), calSig(id), '서명은 늘 같다(주소가 바뀌지 않는다)');
  assert.notStrictEqual(calSig(id), createHmac('sha256', `ics:${process.env.SUPABASE_SECRET_KEY}`).update(id).digest('base64url'));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(calSig(id)), '서명은 주소에 그대로 싣는 글자');
  const mig = readFileSync(new URL('../supabase/migrations/0085_calendar_feeds.sql', import.meta.url), 'utf8');
  const migCode = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(/unique \(owner, project_id\)/.test(migCode) && /references public\.projects\(id\) on delete cascade/.test(migCode)
    && /for select using \(owner = public\.effective_uid\(\)\)/.test(migCode), '0085: 한 사람·한 프로젝트 한 줄 · 본인만 읽기');
  assert.ok(!/for (insert|update|delete|all)/.test(migCode) && !/publication/.test(migCode), '0085: 쓰기 정책 없음(서버만) · 실시간 밖');
  // 화면 — 프로젝트 달력에만 · 게스트에는 없다
  const viewsSrc = readFileSync(new URL('../src/views/views.jsx', import.meta.url), 'utf8');
  assert.strictEqual((viewsSrc.match(/headerExtra=/g) || []).length, 1, '내 달력은 프로젝트 달력에만(전체 일정에는 없다)');
  assert.ok(/const feedButton = useMemo\(\(\) => \(cloudOn \? <MyCalendarButton/.test(viewsSrc), '게스트(cloudOn 아님)에는 세우지 않는다');
  const feedUi = readFileSync(new URL('../src/components/calendarFeed.jsx', import.meta.url), 'utf8');
  assert.ok(feedUi.includes('이 주소를 아는 사람도 동일하게 업무 제목과 마감일을 등록할 수 있어요.') && feedUi.includes('마감일을 바꾸면 내 달력에는 몇 시간 뒤에 반영돼요.')
    && feedUi.includes("failText('달력 주소를 만들지 못했어요', { human: '잠시 뒤 다시 눌러 주세요' })"), '고지 두 줄 · 실패 두 줄(목업 문구)');
  assert.ok(/transition-none animate-in fade-in zoom-in-95 duration-150/.test(feedUi), '떠 있는 판은 transition-none(PITFALLS 17-b)');
  console.log('PASS  내 달력 구독(문장 · 날짜 · .ics · 기기별 버튼 · 저장 줄 세우기 · 서버 배선)');
}


// ── 내비 부품 한 벌(19차 묶음 D — layout.jsx를 navParts·mobileNav·searchBox·notificationBell로 갈랐다) ──
// 되돌리기 검사:
//   · searchBox.jsx SearchHint를 matchMedia 한 줄로 되돌리면 ①이 깨진다
//   · usePopover.js POP_MOTION에서 transition-none을 빼거나, 네 자리 중 하나를 손 껍데기(useDismiss)로 되돌리면 ②가 깨진다
//   · MarkdownEditor 멘션 목록의 transition-none을 빼면 ③(17-b 훑기)이 깨진다
//   · MobileTopBar를 자기 계산(splitFrontTabs)으로 되돌리면 ④가 깨진다
{
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const NAV = ['components/layout.jsx', 'components/navParts.jsx', 'components/mobileNav.jsx', 'components/searchBox.jsx', 'components/notificationBell.jsx'];
  const nav = Object.fromEntries(NAV.map(p => [p.split('/')[1].replace('.jsx', ''), read(p)]));

  // ① 모션 최소화 판정 한 벌(hooks/useReducedMotion.js)
  const { prefersReducedMotion, REDUCED_MOTION_QUERY } = await import(new URL('../src/hooks/useReducedMotion.js', import.meta.url).href);
  const fakeWin = (on) => ({ matchMedia: (q) => ({ matches: on && q === '(prefers-reduced-motion: reduce)' }) });
  assert.strictEqual(REDUCED_MOTION_QUERY, '(prefers-reduced-motion: reduce)');
  assert.strictEqual(prefersReducedMotion(fakeWin(true)), true, '줄이라고 했으면 참');
  assert.strictEqual(prefersReducedMotion(fakeWin(false)), false, '아니면 거짓');
  assert.strictEqual(prefersReducedMotion({}), false, 'matchMedia가 없는 곳은 줄이라는 말이 없던 것으로 본다');
  assert.strictEqual(prefersReducedMotion(), false, '노드(window 없음)에서도 던지지 않는다');
  assert.ok(/const still = useReducedMotion\(\);/.test(nav.searchBox), '검색 안내 문구가 그 훅으로 멈춘다');
  for (const [k, s] of Object.entries({ ...nav, MarkdownEditor: read('components/MarkdownEditor.jsx') })) {
    assert.ok(!s.includes('prefers-reduced-motion'), `${k}에 matchMedia 판정이 다시 적혀 있지 않다`);
  }

  // ② 팝오버 껍데기 한 벌(hooks/usePopover.js) — 등장 모션은 훅이 붙인다(PITFALLS 17-b)
  const pop = read('hooks/usePopover.js');
  assert.ok(pop.includes("export const POP_MOTION = 'transition-none animate-in fade-in zoom-in-95 duration-150';"), '훅의 모션에 transition-none이 있다');
  assert.ok(pop.includes('className: `${className} ${POP_MOTION}`'), '판 클래스 끝에 그 모션을 붙인다');
  assert.ok(/useDismiss\(open, \(\) => setOpen\(false\), \[rootRef, popRef\]\)/.test(pop), '포털로 나간 판도 바깥 누름의 안이다(17-d)');
  assert.ok(nav.layout.includes('usePopover(224, 200, { gap: 8, measure: true })') && nav.layout.includes('usePopover(224, 260)'), '프로필 메뉴 · 더보기');
  assert.ok(nav.navParts.includes('usePopover(112, 40 + years.length * 34)'), '연도 고르기');
  assert.ok(nav.notificationBell.includes('usePopover(320, 240, { portal: false })'), '알림 종(앵커 곁에 그린다)');
  for (const k of ['layout', 'navParts', 'notificationBell']) {
    assert.ok(!/useDismiss\(/.test(nav[k]), `${k}에 손으로 짠 팝오버 껍데기가 다시 생기지 않았다`);
  }

  // ③ 17-b 훑기 — 자리를 인라인 left/top(state)으로 잡는 fixed 판에 animate-in이 있으면 transition-none도 있어야 한다.
  //    내비 다섯 파일 + 본문 에디터(멘션 목록 · 링크 팝오버). fixed 다음에 오는 첫 className을 그 판의 것으로 본다.
  const scan = { ...nav, MarkdownEditor: read('components/MarkdownEditor.jsx') };
  let seen = 0;
  for (const [k, s] of Object.entries(scan)) {
    for (const m of s.matchAll(/position: 'fixed'/g)) {
      const cls = /className=(["`])([\s\S]*?)\1/.exec(s.slice(m.index, m.index + 600))?.[2] || '';
      if (!cls.includes('animate-in')) continue;
      seen++;
      assert.ok(cls.includes('transition-none'), `${k}: 자리를 state로 잡는 떠 있는 판에 transition-none이 없다(PITFALLS 17-b) — ${cls.slice(0, 60)}`);
    }
  }
  assert.ok(seen >= 4, `훑은 판이 너무 적다(${seen}) — 범위가 비었나`);

  // ④ 고른 해의 탭 계산 한 벌(navParts.useYearTabs) — 데스크톱·폰이 같은 것을 본다
  assert.ok(/export function useYearTabs\(activeMenu, \{ liftArchived = true \} = \{\}\)/.test(nav.navParts), 'useYearTabs가 있다');
  assert.ok(/\} = useYearTabs\(activeMenu\);/.test(nav.layout), '데스크톱 TopNav가 쓴다');
  assert.ok(/\} = useYearTabs\(activeMenu, \{ liftArchived: false \}\);/.test(nav.mobileNav), '폰 MobileTopBar가 쓴다(보관된 지금 프로젝트는 끌어올리지 않는다)');
  assert.strictEqual((nav.navParts.match(/splitFrontTabs\(/g) || []).length, 1, '앞 칸 가르기는 한 자리');
  for (const k of ['layout', 'mobileNav']) {
    assert.ok(!/splitFrontTabs\(|useTabYear\(/.test(nav[k]), `${k}에 탭 계산이 다시 적혀 있지 않다`);
  }
  // 옮긴 부품을 들이던 다른 화면의 import 줄은 그대로다(layout.jsx 재수출)
  assert.ok(/export \{ YearPicker \} from '\.\/navParts\.jsx';/.test(nav.layout) && /export \{ SearchHint \} from '\.\/searchBox\.jsx';/.test(nav.layout), '재수출');
  console.log('PASS  내비 부품 한 벌(모션 최소화 판정 · 팝오버 껍데기 · 17-b 훑기 · 고른 해의 탭)');
}
