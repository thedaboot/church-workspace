// logcheck-sec — 인증·공유·계정 합치기·마이그레이션 모양. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { loadSource, readSplit } from './_load.mjs';

// ── 공유 링크로 들어온 로그인 (utils.isKakaoInApp · returnToOf · authErrorInUrl) ──
// 카카오톡으로 공유한 링크를 인앱 브라우저에서 열면 로그인 화면이 뜨고, OAuth가 origin으로
// 돌려보내 가려던 자리를 잃었다(2026-09-05). 자리는 sessionStorage에 적어 두고(auth.jsx),
// 인앱 브라우저면 카카오 로그인을 한 번 자동으로 시작한다.
// 되돌리기 검사: returnToOf가 hash까지 붙이면 '#access_token' 케이스가, authErrorInUrl이
// hash를 안 보면 '#error=' 케이스가 깨진다. 배선 단정은 auth.jsx가 signInWithOAuth 앞에서
// 자리를 적는지 · 세션을 넣기 전에 복원하는지 · 로그인 화면이 waiting을 걸러 자동 시작하는지.
{
  const src = readSplit('src/utils.js');
  const { isKakaoInApp, returnToOf, authErrorInUrl } = await loadSource('src/utils.js');
  const KAKAO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0';
  const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  assert.strictEqual(isKakaoInApp(KAKAO_UA), true, '카카오톡 인앱 UA');
  assert.strictEqual(isKakaoInApp(CHROME_UA), false, '일반 크롬은 아니다');
  assert.strictEqual(isKakaoInApp(''), false, '빈 값도 안전하다');
  assert.strictEqual(isKakaoInApp(undefined), false, '값이 없어도 안전하다');

  assert.strictEqual(returnToOf({ pathname: '/', search: '?p=p1&t=t1' }), '/?p=p1&t=t1', '딥링크는 그대로');
  assert.strictEqual(returnToOf({ pathname: '/', search: '' }), null, '홈이면 기억할 것이 없다');
  assert.strictEqual(returnToOf({ pathname: '/', search: '?p=p1', hash: '#access_token=abc' }), '/?p=p1', 'hash는 싣지 않는다 — 토큰 자리다');
  assert.strictEqual(returnToOf(null), null, '값이 없어도 안전하다');

  assert.strictEqual(authErrorInUrl('https://x.app/#error=access_denied&error_description=user+cancelled'), true, 'hash의 오류');
  assert.strictEqual(authErrorInUrl('https://x.app/?error=server_error'), true, '쿼리의 오류');
  assert.strictEqual(authErrorInUrl('https://x.app/#error_code=400'), true, 'error_code만 있어도');
  assert.strictEqual(authErrorInUrl('https://x.app/?p=p1&t=t1'), false, '딥링크는 오류가 아니다');
  assert.strictEqual(authErrorInUrl('https://x.app/#access_token=a&refresh_token=b'), false, '토큰은 오류가 아니다');
  assert.strictEqual(authErrorInUrl(''), false, '빈 값도 안전하다');

  const auth = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  assert.ok(/rememberReturnTo\(\);\s*\n\s*return supabase\.auth\.signInWithOAuth\(/.test(auth), '떠나기 전에 자리를 적는다');
  assert.ok(/if \(data\.session\) consumeReturnTo\(\);\s*\n\s*setSession\(data\.session\)/.test(auth), '세션을 넣기 전에 자리를 복원한다(WorkspaceShell이 주소를 한 번만 읽는다)');
  assert.ok(/if \(event === 'SIGNED_IN' && newSession\) consumeReturnTo\(\);/.test(auth), 'SIGNED_IN에서도 복원한다');
  assert.ok(/if \(ss\.get\(AUTO_KAKAO_KEY\)\) return false;\s*\n\s*ss\.set\(AUTO_KAKAO_KEY, '1'\);\s*\n\s*signIn\('kakao'\)/.test(auth), '자동 시작은 표식을 먼저 놓고 한 번만');
  assert.ok(/if \(authErrorInUrl\(window\.location\.href\)\) return false;/.test(auth), '오류로 돌아온 뒤에는 자동으로 다시 시작하지 않는다');
  assert.ok(!/sessionStorage\.removeItem\(AUTO_KAKAO_KEY\)|ss\.del\(AUTO_KAKAO_KEY\)/.test(auth), '표식을 지우는 길이 생겼다 — 로그아웃 → 자동 로그인 고리');
  const login = readFileSync(new URL('../src/components/LoginScreen.jsx', import.meta.url), 'utf8');
  assert.ok(/useEffect\(\(\) => \{ if \(!waiting && autoSignInKakao\(\)\) setAuto\(true\); \}/.test(login), '로그인 화면이 마운트될 때 한 번, 승인 대기 화면은 제외');
  console.log('PASS  공유 링크 로그인 21가지');
}

// ── 로그인 화면 로고가 깨져 보이던 것 (2026-09-06 · 사용자 신고) ─────────────
// 카카오톡으로 공유 링크(/s/p/<id>)를 열면 로그인 화면에서 로고가 **깨진 이미지
// 아이콘**으로 보였다. 리소스는 전부 200이다(경로 문제가 아니다) — 순서 문제다:
//   ① 로고는 번들(1MB) 안의 import라, 번들이 다 와서 React가 그릴 때 **그제서야**
//      65KB PNG 요청이 나간다. 인앱 브라우저는 그 직후 카카오 로그인으로 떠나므로
//      (auth.jsx autoSignInKakao) 요청이 취소되고 깨진 아이콘이 남는다.
//   ② Vercel이 /assets/… 를 'max-age=0, must-revalidate'로 내보내고 있었다 —
//      인앱 웹뷰는 열 때마다 빈 캐시라 매번 그 왕복을 처음부터 한다.
//   ③ img에 width/height가 없어서, 안 들어온 동안 `w-auto`가 칸을 가로 전체로 벌린다
//      (깨진 아이콘이 왼쪽 끝, alt 글자만 가운데 — 실제로 그 모양이었다).
// 되돌리기 검사(실제로 해 봤다): index.html의 preload 줄을 지우거나 href를 손으로
// 적은 /assets/logo-light.webp로 바꾸면, vercel.json의 /assets/ 규칙을 빼면,
// LoginScreen의 width/height를 지우면 아래가 각각 깨진다.
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const preload = /<link rel="preload"[^>]*>/.exec(html)?.[0] || '';
  assert.ok(/as="image"/.test(preload), '로고 preload가 없다 — 번들이 다 온 뒤에야 요청이 나간다');
  // 2026-09-24: 로고는 표시 크기의 3배(328×240) WebP다 — preload도 같은 파일·같은 형식을 가리킨다
  assert.ok(/href="\/src\/assets\/logo-light\.webp"/.test(preload) && /type="image\/webp"/.test(preload),
    'preload는 **소스 경로**를 가리켜야 vite가 해시 붙은 /assets/… 로 바꿔 준다(손으로 적으면 다음 빌드에 죽은 preload가 된다)');

  const login = readFileSync(new URL('../src/components/LoginScreen.jsx', import.meta.url), 'utf8');
  const img = /<img src=\{logoLight\}[^]*?\/>/.exec(login)?.[0] || '';
  assert.ok(/width="328" height="240"/.test(img),
    '로고 img에 원본 크기가 없다 — 안 들어온 동안 칸이 가로 전체로 벌어진다');

  const vc = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const assets = (vc.headers || []).find(h => h.source === '/assets/(.*)');
  assert.ok(assets, 'vercel.json에 /assets/ 캐시 규칙이 없다 — Vercel 기본값이 max-age=0, must-revalidate다');
  assert.ok(/immutable/.test(assets.headers.find(h => h.key === 'Cache-Control')?.value || ''),
    '해시 붙은 산출물이니 immutable이어야 한다(이름이 바뀌면 다른 파일이다)');

  // 공유 페이지는 **/s/p/<id> 에서** 열린다. 그 HTML이 상대 경로를 하나라도 쓰면
  // /s/p/assets/… 로 풀려 404가 난다(지금은 이미지가 없지만, 붙이는 순간 그 함정이다).
  const share = readFileSync(new URL('../api/share.js', import.meta.url), 'utf8');
  const body = share.slice(share.indexOf('<!doctype html>'));
  const urls = [...body.matchAll(/(?:src|href|content|url)=(?:"([^"]*)"|([^"\s>]+))/g)]
    .map(m => (m[1] ?? m[2]).trim())
    .filter(v => !/^(width=|height=|initial-scale|website$|summary)/.test(v));
  assert.ok(urls.length >= 4, '공유 HTML에서 주소를 하나도 못 찾았다 — 정규식이 늙었다');
  for (const u of urls) {
    assert.ok(/^(\/|https?:\/\/|\$\{|0; url=[/$])/.test(u),
      `공유 HTML의 상대 경로: ${u} — /s/p/<id> 밑으로 풀려 404가 난다`);
  }
  console.log('PASS  로그인 로고 · 공유 HTML 경로 8가지');
}

// ── 공유 카드 메타 (api/share.js) ───────────────────────────────────────────
// 크롤러가 읽는 OG 메타이자 **사람이 눌렀을 때 가는 주소**를 만드는 자리다. 조회가
// 실패하면 제목이 기본값으로 떨어지고 appUrl이 '/'로 남아 딥링크가 통째로 사라지는데,
// 크롤러 말고는 아무도 안 보는 화면이라 증상이 밖으로 안 난다. 실제로 없는 컬럼
// (projects.description — 0009에서 지웠다)을 고르고 있어서 42703으로 늘 실패했다.
// 되돌리기 검사: select('name')을 select('name, description')으로 되돌리거나
// api/_lib.js STATUS에서 hold를 빼면 아래가 깨진다.
{
  const src = readFileSync(new URL('../api/share.js', import.meta.url), 'utf8');
  // 0092부터 visibility를 같이 읽는다(리더만 보는 프로젝트는 이름을 싣지 않는다 — 아래 0092 묶음)
  assert.ok(/from\('projects'\)\.select\('name(, visibility)?'\)/.test(src),
    "projects에 없는 컬럼을 고르고 있다(description은 0009에서 지웠다)");
  assert.ok(!/select\('name, description'\)/.test(src), 'description이 다시 들어왔다');
  // 조회 오류를 버리면 같은 고장이 또 조용히 지나간다
  assert.ok((src.match(/console\.error\('\[share\]/g) || []).length >= 3,
    '조회 실패를 로그로 남기지 않는 갈래가 있다');

  // 상태 라벨은 앱과 같은 글자여야 한다 — DB는 todo/doing/hold/done(0006) + ongoing(0075 상시)이다.
  // 글자는 api/_lib.js STATUS 한 벌(19차 — 공유 카드·위키·다붓이가 같이 쓴다)
  const { CONFIG } = await import(new URL('../src/config.js', import.meta.url).href);
  assert.ok(/STATUS\[data\.status\]/.test(src) && /import \{[^}]*\bSTATUS\b[^}]*\} from '\.\/_lib\.js'/.test(src), '공유 카드가 _lib.STATUS를 쓰지 않는다');
  const libStatus = /export const STATUS = \{[^}]*\}/.exec(readFileSync(new URL('../api/_lib.js', import.meta.url), 'utf8'))?.[0] || '';
  const ko = Object.fromEntries(
    [...libStatus.matchAll(/(todo|doing|hold|done|ongoing): '([^']+)'/g)].map(m => [m[1], m[2]]));
  const want = Object.fromEntries(Object.entries(CONFIG.STATUS_DB).map(([k, v]) => [v, k]));
  assert.deepStrictEqual(ko, want, '공유 카드의 상태 글자가 config.js의 STATUSES와 다르다');
  console.log('PASS  공유 카드 메타 5가지');
}

// ── 참고 링크 카드 축(0058) · 계정 합치기(0059) ─────────────────────────────
// SQL이라 브라우저 없이 **글자로** 본다(0052·0017을 보는 방식 그대로). 라이브 적용은
// psql로 하고 눈으로 확인했다(HANDOFF §5) — 여기서 보는 것은 "다음 사람이 이 파일을
// 고칠 때 무엇을 지키면 되는가"다.
{
  const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const m58 = src('../supabase/migrations/0058_card_resource_links.sql');
  assert.ok(/add column if not exists card_id uuid references public\.cards\(id\) on delete cascade/.test(m58),
    '0058은 카드 축을 cascade로 더한다(카드를 지우면 링크도 사라진다)');
  // 배타 CHECK — 한 링크는 프로젝트의 것이거나 카드의 것이다. 0047의 files와 같은 모양이다.
  assert.ok(/check \(\(project_id is null\) <> \(card_id is null\)\)/.test(m58),
    '주인은 정확히 하나다(0047 files_owner_exactly_one과 같은 모양)');
  assert.ok(/idx_resource_links_card_id/.test(m58), '카드 축에 인덱스가 있다');

  // **업무 창에는 링크가 없다**(2026-09-11에 되돌렸다 · §6-35). 2026-09-10에 첨부 구역
  // 안 한 목록('+ 파일'·'+ 링크')으로 옮겼던 것을 사용자가 판단해서 걷었다 —
  // "링크 첨부 방식을 넣지 말고 기존처럼 돌리되". 브라우저 검사(tests/handoff)가 화면을
  // 보고, 여기서는 **부품이 다시 살아나지 않는지**를 글자로 본다.
  // **주석은 걷고 본다** — 이 절이 무엇을 되돌렸는지 적어 둔 주석에 그 글자가 그대로
  // 들어 있다(§6-34-e가 SQL에서 가르쳐 준 것과 같다).
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const att = noComments(src('../src/modals/attachments.jsx'));
  const modals = noComments(src('../src/modals/modals.jsx'));
  const links = src('../src/components/links.jsx');
  assert.ok(!/LinkRow|LinkAddPopover|onLinkAdd/.test(att),
    '첨부 구역에 링크 부품이 다시 들어왔다');
  // 버튼 글자로 본다 — 용량 초과 상자의 '참고 링크로 공유해 주세요'(2026-10-15 시안 C14)는 프로젝트 머리의 참고 링크를 가리키는 말이다
  assert.ok(!/\+ 링크|\+ 참고 링크/.test(att + modals), "업무 창에 '+ 링크'·'+ 참고 링크'가 있다");
  assert.ok(!/export function LinkRow/.test(links), '첨부 구역용 링크 줄(LinkRow)이 남아 있다');
  // 첨부 구역은 예전 모양 그대로다 — 점선 상자 안에 끌어다 놓기·붙여넣기 안내 두 줄
  const dropBox = att.slice(att.indexOf('border-2 border-dashed'), att.indexOf('{!readOnly && rejected.length > 0'));
  assert.ok(/파일을 끌어다 놓거나 클릭해서 선택하세요/.test(dropBox)
    && /이미지는 붙여넣기\(Ctrl\/⌘\+V\)도 돼요/.test(dropBox), '첨부 구역의 점선 상자가 예전 모양이 아니다');
  // 프로젝트 헤더는 그대로다(§8 — 거기 버튼은 '+ 참고 링크')
  assert.ok(/export function PinnedLinkChip/.test(links) && /export function LinkAddPopover/.test(links),
    '프로젝트 헤더가 쓰는 부품까지 지웠다');
  assert.ok(/\+ 참고 링크<\/button>/.test(links), "헤더 버튼 글자가 '+ 참고 링크'가 아니다");

  const m59 = src('../supabase/migrations/0059_merge_profiles.sql');
  assert.ok(/security definer/.test(m59) && /is_master\(\)/.test(m59),
    '0059는 security definer이고 마스터만 부른다');
  // **profiles 행을 지우지 않는다** — 지우면 다시 로그인해 새 프로필이 생기고(0001
  // handle_new_user) 합친 일이 헛일이 된다. 환송 처리로 남긴다.
  assert.ok(!/delete from public\.profiles/.test(m59), '합친 계정의 profiles 행을 지우지 않는다');
  assert.ok(/set approved = false, removed_at = now\(\)/.test(m59), '합친 계정은 환송 처리된다');
  // 겹치는 행이 있는 표는 **먼저 지우고** 옮긴다 — 안 그러면 유니크 제약에 걸려 통째로 실패한다
  for (const t of ['profile_teams', 'card_assignees', 'comment_reactions', 'service_notes', 'qt_entries']) {
    assert.ok(new RegExp(`delete from public\.${t} d`).test(m59), `${t}는 겹치는 행을 먼저 버린다`);
  }
  assert.ok(/update public\.bible_state set profile_id = p_keep/.test(m59), '성경 상태도 옮긴다(PK 한 줄)');
  assert.ok(/update public\.activity set actor_id = p_keep/.test(m59), '활동 기록의 행위자도 옮긴다(FK가 없는 칸이다)');
  assert.ok(/grant execute on function public\.merge_profiles\(uuid, uuid\) to authenticated/.test(m59)
    && /revoke all on function public\.merge_profiles\(uuid, uuid\) from public, anon/.test(m59),
    '실행 권한은 로그인 사용자만(자격은 함수 안에서 본다)');
  // 명단 연결은 UNIQUE라 갈래가 둘이다 — 남기는 쪽이 이미 붙어 있으면 그것을 남긴다
  assert.ok(/people_kept_existing/.test(m59) && /people_relinked/.test(m59),
    '명단 연결은 두 갈래를 돌려준다(이미 붙어 있었나 / 새로 이었나)');

  // 0060 — 합쳐진 계정에 표를 남긴다. 이 칸이 없으면 '환송한 사람'의 '다시 초대하기'가
  // 그 계정을 **빈 중복**으로 되살려 합친 일이 헛일이 된다(0059가 데이터를 다 옮겼다).
  const m60 = src('../supabase/migrations/0060_merged_into.sql');
  assert.ok(/add column if not exists merged_into uuid references public\.profiles\(id\) on delete set null/.test(m60),
    '0060은 merged_into를 자기 참조로 더한다(남은 계정이 지워져도 삭제가 막히지 않게)');
  assert.ok(/removed_by = auth\.uid\(\), merged_into = p_keep/.test(m60),
    '합칠 때 그 표를 같이 남긴다');
  assert.ok(/이미 다른 계정으로 합쳐진 계정은 남길 수 없습니다/.test(m60),
    '이미 합쳐진 계정을 남길 쪽으로 고르지 못하게 막는다(옮긴 것이 다시 갈린다)');
  assert.ok(/update public\.profiles set merged_into = p_keep where merged_into = p_drop/.test(m60),
    '합치기를 두 번 하면 옛 표도 새 주인을 가리킨다');
  // 화면 — 합친 계정은 **환송한 사람과 따로 선다**(사용자 요구 2026-09-10 "아예 구분해서")
  const mv = src('../src/views/membersView.jsx');
  assert.ok(/const mergedRows = \(rows \|\| \[\]\)\.filter\(r => !r\.approved && r\.merged_into\);/.test(mv),
    '합친 계정을 따로 센다');
  assert.ok(/r\.removed_at && !r\.merged_into/.test(mv), '환송한 사람에서는 그것을 뺀다');
  assert.ok(/title="합친 계정"/.test(mv), '제 구역 이름이 있다');
  assert.ok(/합쳤어요/.test(mv) && !/mergedRows[\s\S]{0,900}다시 초대하기/.test(mv),
    '그 구역에는 다시 초대하기가 없다');
  assert.ok(/merged_into/.test(readSplit('src/services/cloud.js')),
    '목록 조회가 그 칸을 실어 온다(없으면 화면이 가를 수 없다)');

  // 0061 — 합친 계정으로 들어와도 **그 사람**이다(사용자 요구 2026-09-10 "그 계정으로
  // 해도 합쳐진 계정으로 남을 수 있게끔"). 판정 자리에서 auth.uid() 대신 effective_uid().
  const m61 = src('../supabase/migrations/0061_effective_uid.sql');
  assert.ok(/create or replace function public\.effective_uid\(\)/.test(m61)
    && /coalesce\(\(select p\.merged_into from public\.profiles p where p\.id = auth\.uid\(\)\), auth\.uid\(\)\)/.test(m61),
    'effective_uid는 합쳐 들어간 계정이 있으면 그것을 준다');
  // 로그인이 막히지 않아야 한다 — 합친 계정은 환송 처리라 is_approved가 거짓이었다
  assert.ok(/function public\.is_approved[\s\S]{0,400}effective_uid\(\)/.test(m61),
    'is_approved가 그 값을 본다(합친 계정도 통과)');
  // 순 소속·순장 자격·출석이 그대로여야 한다(0035의 헬퍼 아홉이 이 함수를 본다)
  assert.ok(/function public\.my_person_id[\s\S]{0,400}effective_uid\(\)/.test(m61),
    'my_person_id가 그 값을 본다(명단 축으로 이어진다)');
  // 개인 표 셋 — 노트·묵상·성경 상태가 두 벌로 갈리지 않아야 한다.
  // **정책 구역 안에 auth.uid()가 하나도 남아 있지 않은지**로 본다 — 표별로 '어딘가에
  // effective_uid가 있나'만 보면 다섯 중 하나만 고쳐도 통과한다(실제로 그랬다).
  // **주석 줄은 걷는다** — 이 파일의 주석이 'auth.uid() → effective_uid()'라고 적고 있어서
  // 그대로 보면 늘 실패한다(처음에 그렇게 걸렸다)
  const pol = m61.slice(m61.indexOf('drop policy if exists service_notes_select'), m61.indexOf('comment on function'))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(pol.length > 500, '정책 구역을 찾았다');
  assert.ok(!/auth\.uid\(\)/.test(pol), '개인 표 정책에 auth.uid()가 남아 있지 않다');
  // using 5 + with check 3 = 8 (select 정책 둘에는 with check가 없다)
  assert.ok((pol.match(/effective_uid/g) || []).length >= 8, '다섯 정책이 모두 그 값을 본다');
  for (const t of ['service_notes', 'qt_entries', 'bible_state']) {
    assert.ok(pol.includes(`policy ${t}`), `${t} 정책을 다시 만든다`);
  }
  // 클라이언트도 같은 값을 봐야 한다 — 자기 uid로 걸면 노트가 한 줄도 안 나온다
  const sc = src('../src/services/supabaseClient.js');
  assert.ok(/rpc\('effective_uid'\)/.test(sc) && /export function resetMyUid/.test(sc),
    '클라이언트가 그 값을 묻고 세션이 바뀌면 버린다');
  assert.ok(/resetMyUid\(\)/.test(src('../src/services/auth.jsx')), '세션이 바뀌면 실제로 버린다');
  for (const f of ['word.js', 'worship.js', 'groups.js', 'people.js']) {
    assert.ok(/myUid/.test(readSplit(`src/services/${f}`)), `${f}가 그 값을 쓴다`);
  }
  // 화면에 보이는 이름도 남긴 계정의 것이다
  assert.ok(/p\.merged_into && nameOfId\.get\(p\.merged_into\)/.test(src('../src/services/cloudSync.js')),
    '합친 계정의 이름은 남긴 계정의 것으로 풀린다');

  // 0063 — 0061이 **남겨 둔 나머지 자리**(읽기 전용 감사 2026-09-11). 합친 계정으로
  // 로그인하면 알림 벨이 비고, '내 순에 공유된 노트'가 0건이고, 옛 댓글·업무·첨부·링크
  // 삭제와 반응 토글과 다녀간 시각이 조용히 실패했다.
  const m63 = src('../supabase/migrations/0063_effective_uid_rest.sql');
  // **주석과 `comment on` 줄을 걷고 본문만 본다**(§6-34-e) — 이 파일의 주석에도
  // 되돌리기 SQL이 통째로 적혀 있어서 그대로 보면 auth.uid()가 잔뜩 잡힌다.
  const body63 = m63.slice(m63.indexOf('begin;'), m63.indexOf('commit;'))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(body63.length > 1500, '0063 본문을 찾았다');
  // **정책을 새로 만들지 않는다** — permissive는 OR라 하나 더 만들면 옛 조건이 그대로
  // 살아 남아 아무것도 안 바뀐다(§6-31-a). 전부 alter policy로 본문만 바꾼다.
  assert.ok(!/create policy/.test(body63) && !/drop policy/.test(body63),
    '0063이 정책을 새로 만든다 — 이름이 같아도 수가 늘면 OR로 합쳐진다(§6-31-a)');
  // effective_uid()는 0061이 만든다. 여기서 다시 만들면 두 벌이 된다.
  assert.ok(!/function public\.effective_uid/.test(body63), '0063이 effective_uid를 다시 만든다');
  // 사람 판정 함수 셋 — 각각 본문에 auth.uid()가 남아 있지 않아야 한다
  for (const fn of ['same_sun', 'is_pastor', 'touch_last_seen']) {
    const at = body63.indexOf(`function public.${fn}`);
    assert.ok(at > 0, `${fn}을 다시 만들지 않는다`);
    const fnBody = body63.slice(at, body63.indexOf('$$;', at));
    assert.ok(/effective_uid\(\)/.test(fnBody), `${fn}이 effective_uid를 안 본다`);
    assert.ok(!/= auth\.uid\(\)/.test(fnBody), `${fn}에 auth.uid() 판정이 남아 있다`);
  }
  // 정책 열넷 — 이름별로 그 alter 문 안에 effective_uid가 있는지 본다.
  // (`alter policy X on public.Y` 부터 다음 `alter ` 까지가 한 문장이다)
  const stmt63 = (name) => {
    const at = body63.indexOf(`alter policy ${name} on `);
    assert.ok(at > 0, `${name} 정책을 못 찾았다`);
    const next = body63.indexOf('\nalter ', at + 1);
    return body63.slice(at, next < 0 ? body63.length : next);
  };
  for (const p of ['"notifications_select_own"', '"notifications_update_own"', '"notifications_delete_own"',
                   'comments_delete', 'cards_delete', 'files_delete', 'resource_links_delete',
                   'comment_reactions_insert', 'comment_reactions_delete',
                   'push_subscriptions_select_own', 'push_subscriptions_insert_own',
                   'push_subscriptions_update_own', 'push_subscriptions_delete_own',
                   'profiles_update', '"profile_teams write own"']) {
    assert.ok(/public\.effective_uid\(\)/.test(stmt63(p)), `${p}가 effective_uid를 안 본다`);
  }
  // **profiles_insert는 손대지 않는다** — 가입 순간 자기 행을 만드는 자리라
  // auth.uid() = id가 아니면 아무도 첫 행을 못 만든다(0001 그대로).
  assert.ok(!/profiles_insert/.test(body63), '0063이 profiles_insert를 건드린다 — 가입이 막힌다');
  assert.ok(/auth\.uid\(\) = id/.test(src('../supabase/migrations/0001_init.sql')),
    'profiles_insert는 0001의 auth.uid() = id 그대로다');
  // 반응은 **컬럼 기본값도** 같이 옮겨야 한다 — 클라이언트가 주인을 안 보내므로
  // 기본값이 auth.uid()인 채로 정책만 올리면 합친 계정은 반응을 아예 못 남긴다.
  assert.ok(/alter table public\.comment_reactions alter column user_id set default public\.effective_uid\(\)/.test(body63),
    '반응의 주인 기본값이 아직 auth.uid()다 — 정책만 올리면 insert가 통째로 막힌다');

  // 클라이언트도 같은 값을 봐야 한다(§6-34-d) — 정책만 고치면 화면은 자기 uid로 묻는다
  const cl = readSplit('src/services/cloud.js');
  for (const fn of ['listMyNotifications', 'markAllNotificationsRead', 'savePushSubscription',
                    'updateMyProfile', 'setMyTeams', 'removeCommentReaction']) {
    const at = cl.indexOf(`function ${fn}(`);
    assert.ok(at > 0, `${fn}을 못 찾았다`);
    const fnSrc = cl.slice(at, at + 600);
    assert.ok(/await myUid\(\)/.test(fnSrc), `${fn}이 세션 uid로 묻는다 — 합친 계정에게는 빈 목록이다`);
  }
  assert.ok(/myUid\(\)\.then/.test(src('../src/components/notificationBell.jsx')),
    '알림 실시간 구독 필터가 세션 uid다 — 합친 계정에게는 새 알림이 안 들어온다');
  assert.ok(/presence: \{ key: uid \}/.test(src('../src/services/presence.js')),
    '접속 표시 열쇠가 세션 uid다 — 합친 계정은 접속해도 얼굴이 안 밝는다');
  assert.ok(/export function myUidSync/.test(sc) && /export function isMyUid/.test(sc),
    '자격 판정이 쓸 동기 접근이 없다');
  // 업무 창은 스토어의 지금 카드(source)를 본다(2026-09-28 — 창을 연 채로 고친다)
  assert.ok(/isMyUid\((task|source)\.created_by, userId\)/.test(src('../src/modals/modals.jsx')),
    '업무 삭제 자격이 세션 uid만 본다');

  console.log('PASS  링크 카드 축·자리 · 계정 합치기 38가지 · 0063 나머지 자리 40가지');
  console.log('PASS  링크 카드 축 · 업무 창에는 링크 없음 · 계정 합치기 40가지');
}

// ── 9차 개선의 마이그레이션 셋 (0064 · 0065 · 0066) ─────────────────────────
// 파일이 무엇을 하는지, 무엇을 **안 하는지**, 되돌리는 SQL이 맨 아래 주석에 있는지를
// 본다(0062 묶음과 같은 짜임 · HANDOFF §5). 라이브 DB는 검사가 못 보므로 여기서는
// 파일만 본다 — 적용 결과는 사람이 psql로 눈으로 확인한다(§3-3).
{
  const mig = (n) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8');

  // 0064 — people.gender. **nullable이어야 한다**: not null + 기본값 '형제'로 백필하면
  // 고치기 전까지 자매를 형제라고 부른다(사용자 결정 2026-09-14는 '미입력 = 청년'이다).
  const m64 = mig('0064_people_gender.sql');
  assert.ok(/alter table public\.people add column if not exists gender text;/.test(m64),
    '0064는 people에 gender를 더한다');
  // 주석에는 'not null'이 말로 나온다(왜 안 쓰는지 적어 뒀다) — **SQL 줄만** 본다
  const ddl = (t) => t.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/not null/i.test(ddl(m64)), "0064의 gender는 nullable이다(미입력이 '청년'으로 남는 근거)");
  assert.ok(/check \(gender is null or gender in \('m', 'f'\)\)/.test(m64),
    "값은 'm'·'f' 둘뿐이다(화면 글자는 services/people.js의 HONORIFIC이 정한다)");
  assert.ok(!/create policy|drop policy/.test(m64), '0064는 정책을 건드리지 않는다(행 단위라 그대로다)');
  assert.ok(/--\s*alter table public\.people drop column if exists gender;/.test(m64),
    '0064의 되돌리는 SQL이 맨 아래 주석에 있다');

  // 0065 — bible_state.recent_searches. 상한 30·중복 제거는 **클라이언트가** 한다
  // (위 '최근 검색어' 묶음이 그 규칙을 본다) — 여기에 트리거를 두면 규칙이 두 곳으로 갈린다.
  const m65 = mig('0065_bible_recent_searches.sql');
  assert.ok(/add column if not exists recent_searches jsonb not null default '\[\]'/.test(m65),
    '0065는 bible_state에 recent_searches를 더한다');
  assert.ok(!/create trigger|create policy|drop policy/.test(m65),
    '0065는 트리거도 정책도 만들지 않는다(자르는 규칙은 services/word.js 한 곳)');
  assert.ok(/--\s*alter table public\.bible_state drop column if exists recent_searches;/.test(m65),
    '0065의 되돌리는 SQL이 맨 아래 주석에 있다');

  // 0066 — 개인 표 셋의 기본값을 정책과 같은 함수로. **'누가 했나' 칸은 건드리지 않는다**
  // (0059가 일부러 안 옮긴 자리다 — 그 순간 그 계정이 한 일은 사실이다).
  const m66 = mig('0066_personal_tables_default_effective_uid.sql');
  for (const t of ['service_notes', 'qt_entries', 'bible_state']) {
    assert.ok(new RegExp(`alter table public\\.${t}\\s+alter column profile_id set default public\\.effective_uid\\(\\);`).test(m66),
      `0066이 ${t}.profile_id의 기본값을 옮긴다`);
  }
  for (const t of ['activity', 'comments', 'files', 'cards', 'resource_links', 'sun_guides', 'projects']) {
    assert.ok(!new RegExp(`alter table public\\.${t} `).test(m66),
      `0066은 ${t}을 건드리지 않는다('누가 했나' 칸은 auth.uid() 그대로다 — 0059·0063)`);
  }
  assert.ok(!/create policy|drop policy/.test(m66), '0066은 정책을 건드리지 않는다');
  assert.ok(/--\s*alter table public\.bible_state\s+alter column profile_id set default auth\.uid\(\);/.test(m66),
    '0066의 되돌리는 SQL이 맨 아래 주석에 있다');

  console.log('PASS  9차 마이그레이션 0064·0065·0066 20가지');
}

// ── 0093 모임 활동 보고서 — files의 세 번째 주인 · 모임 갈래 정책 (20차 묶음 ④) ─────────────
// 기존 files 정책 넷은 건드리지 않는다(0092가 업무 갈래를 alter policy로 조인다 — 두 파일이 같은 정책을 고치면 뒤의 것이
// 앞을 지운다). 그 대신 모임 갈래 permissive 둘 + **restrictive 셋**: 지금 업무 갈래 조건(`service_id is null`)이 모임 행도
// 통과시키므로, restrictive가 없으면 승인된 누구나 남의 모임에 보고서를 붙이거나 업무 첨부를 모임으로 옮길 수 있다.
// psql 리허설(ROLLBACK · 2026-10-12): 남의 모임에 넣기 42501 · 업무 첨부를 모임으로 옮기기 42501 · 업무 첨부 넣기 그대로 ·
// 동아리장 자기 모임 넣기/고치기 · 다른 동아리 막힘 · 구성원 읽기 1 · 고치기·지우기 0행 · 관리자 넣기·지우기 · 모임 지우면 cascade.
// 되돌리기 검사: guard 셋 중 하나의 `as restrictive`를 지우면 '모임 행 쓰기는 restrictive' 단정이 깨진다.
{
  const raw = readFileSync(new URL('../supabase/migrations/0093_meeting_files.sql', import.meta.url), 'utf8');
  const m = raw.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(/add column if not exists meeting_id uuid references public\.group_meetings\(id\) on delete cascade/.test(m),
    'files.meeting_id — 모임을 지우면 행도 같이(set null이면 셋 다 null이 되어 배타 CHECK에 걸린다)');
  assert.ok(/check \(num_nonnulls\(card_id, service_id, meeting_id\) = 1\)/.test(m), '주인은 셋 중 정확히 하나(files_owner_exactly_one)');
  assert.ok(/alter table public\.group_meetings add column if not exists drive_folder_id text;/.test(m), 'group_meetings.drive_folder_id(폴더 기억)');
  assert.ok(!/(alter|drop) policy (if exists )?files_(select|insert|update|delete) /.test(m), '기존 files 정책 넷은 건드리지 않는다');
  assert.ok(/create or replace function public\.can_edit_meeting\(p_meeting uuid\)[\s\S]*?security definer set search_path = public, pg_temp[\s\S]*?public\.is_admin\(\) or exists[\s\S]*?g\.leader_person_id = public\.my_person_id\(\)/.test(m),
    '모임 판정은 0035 group_meetings_write와 같은 식(관리자 또는 그 동아리장)');
  assert.ok(/create policy files_meeting_select on public\.files\s+for select using \(\s*files\.meeting_id is not null\s+and public\.is_approved\(\)/.test(m),
    '보고서 읽기는 승인된 사람(group_meetings_select와 같다)');
  assert.ok(/create policy files_meeting_write on public\.files\s+for all using \(\s*files\.meeting_id is not null[\s\S]*?can_edit_meeting\(files\.meeting_id\)\s*\) with check \(\s*files\.meeting_id is not null[\s\S]*?can_edit_meeting\(files\.meeting_id\)/.test(m),
    '보고서 쓰기 permissive — using·check 둘 다');
  for (const [cmd, body] of [['insert', /as restrictive for insert with check \(\s*files\.meeting_id is null or public\.can_edit_meeting\(files\.meeting_id\)\s*\)/],
    ['update', /as restrictive for update using \(\s*files\.meeting_id is null or public\.can_edit_meeting\(files\.meeting_id\)\s*\) with check \(\s*files\.meeting_id is null or public\.can_edit_meeting\(files\.meeting_id\)\s*\)/],
    ['delete', /as restrictive for delete using \(\s*files\.meeting_id is null or public\.can_edit_meeting\(files\.meeting_id\)\s*\)/]]) {
    assert.ok(new RegExp(`create policy files_meeting_guard_${cmd} on public\\.files\\s+${body.source}`).test(m),
      `모임 행 쓰기는 restrictive(${cmd}) — 업무·주보 행(meeting_id is null)에는 언제나 참`);
  }
  assert.ok(/--\s*drop policy if exists files_meeting_guard_delete on public\.files;/.test(raw)
    && /--\s*check \(\(card_id is null\) <> \(service_id is null\)\);/.test(raw)
    && /--\s*alter table public\.files drop column if exists meeting_id;/.test(raw), '되돌리는 SQL이 맨 아래 주석에 있다');
  console.log('PASS  0093 모임 활동 보고서(세 번째 주인 · 기존 정책 그대로 · 모임 갈래 permissive 둘 + restrictive 셋) 11가지');
}

// ── 로그아웃이 이 기기만 끊는지 (services/auth.jsx 소스 단정) ────────────────
// auth-js의 `signOut()` 기본 scope는 `'global'`이라, 옵션을 비우면 **그 사람의 모든
// 기기**의 리프레시 토큰이 서버에서 폐기된다. 폰에서 한 번 로그아웃하면 아이패드는
// 그 자리에서 안 튕기고 **다음 토큰 갱신 때** 조용히 풀려서, 원인을 알기 어려운
// "가끔 로그인하라고 뜬다"로 나타났다(사용자 신고 2026-09-21 · 아이패드 PWA).
// 이 파일은 supabase 클라이언트를 import해서 노드에서 돌릴 수 없으므로 소스로 지킨다
// (presence.js·§6-31과 같은 방식).
// 되돌리기 검사: `signOut({ scope: 'local' })`을 `signOut()`으로 되돌리면 첫 단정이 깨진다.
{
  const src = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  assert.ok(/auth\.signOut\(\{\s*scope:\s*'local'\s*\}\)/.test(src),
    "로그아웃은 scope: 'local' — 기본값 global은 다른 기기의 세션까지 끊는다");
  assert.ok(!/auth\.signOut\(\s*\)/.test(src),
    'scope 없는 signOut()이 남아 있지 않다');
  console.log('PASS  로그아웃이 이 기기만 끊는다 2가지');
}

// ── '승인을 기다려주세요'가 헛뜨지 않는지 (소스 단정) ────────────────────────
// 신고 2026-09-22(조해리·노준석): 잘 쓰다가 가끔 승인 대기 화면으로 떨어진다.
// 원인이 둘이었다.
//   ① AuthGate가 `!approved` 하나로 봐서 **아직 물어보기 전(null)** 에도 그 화면을 띄웠다.
//   ② 자격을 묻는 rpc가 실패하면 `!!null`이 false가 되어 **true였던 값이 false로 떨어졌다.**
//      이 물음은 토큰이 갱신될 때마다(한 시간) 다시 던져지므로, 폰에서 신호가 잠깐
//      끊기면 멀쩡히 쓰던 사람이 그 화면을 봤다.
// 되돌리기 검사: AuthGate의 `approved === null` 줄을 지우면 첫 단정이, auth.jsx의
// 실패 시 조기 반환을 지우면 셋째가 깨진다.
{
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  // 2026-10-15부터 빈 바탕 대신 첫 페인트와 같은 로고(CloudSplash · logcheck '첫 페인트 로고 하나')
  assert.ok(/approved === null\) return <CloudSplash \/>/.test(app),
    '아직 모르는 동안에는 승인 대기가 아니라 로고 화면이다');
  assert.ok(app.indexOf('approved === null') < app.indexOf('enabled && !approved'),
    '모름 판정이 먼저다 — 뒤에 두면 !approved가 null을 먼저 삼킨다');

  const auth = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  const perm = auth.slice(auth.indexOf("resetMyUid();"));
  assert.ok(/if \(!res\) \{[\s\S]*?return;/.test(perm),
    '자격을 못 물어봤으면 알던 값을 그대로 둔다(아니오로 바꾸지 않는다)');
  // 판정은 approvalWatch.permFromRpc 한 벌 — 끝의 '승인 대기 자동 전환' 구역이 함수를 단정한다
  assert.ok(/return permFromRpc\(await Promise\.all/.test(auth),
    'rpc 셋 중 하나라도 실패하면 그 회차는 통째로 버린다 — 반만 믿으면 더 나쁘다');
  assert.ok(/setTimeout\(r, 1500\)/.test(perm), '한 번은 다시 물어본다');
  assert.ok(perm.indexOf('if (!res)') < perm.indexOf('setPerm(res)'),
    '값을 덮어쓰는 줄은 실패 관문 **뒤**에 있다 — 앞에 있으면 관문이 아무 일도 안 한다');
  console.log('PASS  승인 대기 화면이 헛뜨지 않는다 6가지');
}

// ── 0071 보안 조이기의 모양 (보안 감사 2026-09-24) ──────────────────────────
// 라이브 DB는 검사가 못 보므로 파일만 본다(적용 결과는 psql로 눈으로 · §3-3). 핵심은 셋:
// 프로필 가드가 **예외 없이 되돌리기만** 하는지(내 정보 저장 upsert가 행을 통째로 보낼 수 있다),
// 그 트리거가 이메일 트리거보다 **이름순 앞**인지, 정책을 **더하지 않고** alter만 하는지(§6-31-a).
// 되돌리기 검사: 가드에서 `new.merged_into := old.merged_into`를 지우면 첫 묶음이 깨진다.
{
  const m71 = readFileSync(new URL('../supabase/migrations/0071_rls_hardening.sql', import.meta.url), 'utf8');
  const sql = m71.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

  // ① 프로필 가드 — 관리자·서버 문맥(auth.uid() 없음)은 통과, 나머지는 일곱 칸을 옛 값으로
  ok(/create or replace function public\.guard_profile_columns\(\)/.test(sql), '0071에 guard_profile_columns가 있다');
  ok(/if auth\.uid\(\) is null or public\.is_admin\(\) then\s+return new;/.test(sql),
    '가드는 서버 문맥·관리자(merge_profiles 포함)를 그대로 둔다');
  for (const c of ['approved', 'approved_at', 'approved_by', 'removed_at', 'removed_by', 'merged_into', 'email']) {
    ok(new RegExp(`new\\.${c}\\s*:=\\s*old\\.${c};`).test(sql), `비관리자 UPDATE는 ${c}를 옛 값으로 되돌린다`);
  }
  ok(/if tg_op = 'INSERT' then[\s\S]*?new\.approved := false;[\s\S]*?new\.merged_into := null;[\s\S]*?return new;/.test(sql),
    '행이 없을 때의 INSERT로도 스스로 승인할 수 없다');
  ok(!/raise exception/i.test(sql), '0071은 예외를 던지지 않는다 — 되돌리기만(내 정보 저장이 실패하면 안 된다)');
  const guard = sql.match(/create trigger (\w+) before insert or update on public\.profiles/);
  ok(guard && guard[1] < 'trg_sync_profile_email',
    '프로필 가드 트리거가 trg_sync_profile_email보다 이름순 앞이다(비운 email을 그 트리거가 채운다)');
  ok(/alter policy profiles_insert on public\.profiles\s+with check \(id = any \(array\[auth\.uid\(\), public\.effective_uid\(\)\]\)\);/.test(sql),
    'profiles_insert가 남긴 계정 id도 받는다(합친 계정의 내 정보 upsert)');

  // ② 작성자 칸 — 트리거 넷 + insert with check 넷
  for (const [t, c] of [['cards', 'created_by'], ['files', 'uploaded_by'], ['comments', 'author_id']]) {
    ok(new RegExp(`create trigger trg_${t}_guard_author before insert or update of ${c} on public\\.${t}\\s+for each row execute function public\\.guard_author_column\\('${c}'\\);`).test(sql),
      `${t}.${c}에 작성자 가드(INSERT·UPDATE)가 있다`);
  }
  ok(/create trigger trg_activity_guard_author before insert on public\.activity\s+for each row execute function public\.guard_author_column\('actor_id'\);/.test(sql),
    'activity.actor_id에 작성자 가드(INSERT)가 있다');
  for (const [t, c] of [['cards', 'created_by'], ['files', 'uploaded_by'], ['comments', 'author_id'], ['activity', 'actor_id']]) {
    ok(new RegExp(`alter policy ${t}_insert on public\\.${t}\\s+with check \\([\\s\\S]*?public\\.is_approved\\(\\)[\\s\\S]*?${c} = any \\(array\\[auth\\.uid\\(\\), public\\.effective_uid\\(\\)\\]\\)[\\s\\S]*?\\);`).test(sql),
      `${t}_insert가 승인 게이트를 유지하고 ${c}를 내 id(두 id)로 묶는다`);
  }
  ok(/alter policy files_insert[\s\S]*?\(service_id is null or public\.can_edit_service\(\)\)/.test(sql),
    'files_insert는 0047의 주보 송폼 갈래를 그대로 둔다');

  // ③ 댓글 고치기 · ④ 명단 추가
  ok(/alter policy comments_update on public\.comments\s+using \(public\.is_approved\(\) and \(author_id = any[^\n]*\)\s+with check \(public\.is_approved\(\) and \(author_id = any/.test(sql),
    'comments_update는 쓴 사람(두 id)·관리자만 — using과 with check 둘 다');
  ok(/alter policy people_insert[\s\S]*?not is_pastor[\s\S]*?profile_id is null/.test(sql),
    '비관리자의 명단 추가는 교역자·계정 연결 없이만(0069 트리거가 계정 권한을 올린다)');

  // ⑤ 알림 — 보낸 사람 이름 트리거 · 딥링크 CHECK
  ok(/create trigger trg_notifications_actor_name before insert on public\.notifications/.test(sql),
    '알림 INSERT에 actor_name 트리거가 있다');
  ok(/if auth\.uid\(\) is null then\s+return new;[\s\S]*?where p\.id = public\.effective_uid\(\)/.test(sql),
    '서버 배치는 그대로, 로그인 문맥은 effective_uid의 표시 이름으로');
  ok(sql.includes("link like '/%' and link not like '//%' and link !~ '[\\s\\\\]'"),
    "딥링크 CHECK가 공백류·역슬래시를 막는다('/\\t/evil.com')");

  // ⑥ 함수 둘 · ⑦ storage
  for (const f of ['recount_card', 'fix_profile_team_id']) {
    ok(new RegExp(`revoke execute on function public\\.${f}\\(uuid\\) from public, anon, authenticated;`).test(sql),
      `${f}의 바깥 실행 권한을 public·anon·authenticated에서 걷는다`);
  }
  for (const p of ['attachments_select_authenticated', 'attachments_insert_authenticated', 'content_images_insert_own']) {
    ok(new RegExp(`alter policy "${p}" on storage\\.objects[\\s\\S]*?public\\.is_approved\\(\\)\\s*\\);`).test(sql),
      `storage 정책 ${p}에 승인 게이트가 있다`);
  }

  // 정책 수를 늘리지 않는다 · 되돌리는 SQL
  ok(!/create policy|drop policy/i.test(sql), '0071은 정책을 만들거나 지우지 않는다 — alter만(§6-31-a)');
  ok(!/projects_delete/.test(sql), 'projects_delete(0021 전원 삭제)는 사용자 결정이라 건드리지 않는다');
  for (const line of ['drop trigger if exists trg_profiles_guard on public.profiles;',
    'drop function if exists public.guard_author_column();',
    'alter policy people_insert on public.people with check (public.is_admin() or public.can_check_all_attendance() or public.leads_any_sun());',
    'grant execute on function public.recount_card(uuid) to public, anon, authenticated;']) {
    ok(m71.includes(`--   ${line}`), `0071의 되돌리는 SQL에 '${line.slice(0, 40)}…'이 있다`);
  }
  console.log(`PASS  0071 보안 조이기의 모양 ${n}가지`);
}

// ── 0092 리더만 보는 프로젝트의 모양 (사용자 결정 2026-10-12) ─────────────────────
// 라이브 경계는 psql 리허설(ROLLBACK)로 봤다 — 리더/비리더 select 수 · 쓰기 막힘(HANDOFF 20차 블록). 여기는 파일 모양:
// 함수 다섯(security definer · search_path · anon 회수) · 정책은 alter만(§6-31-a) · 정책이 줄마다 함수를 부르지 않고
// `(select public.hidden_ids())`로 한 번만(InitPlan — 줄마다 부르면 doc_vec count가 4배 느렸다) · files는 업무 갈래만 ·
// 보호 트리거 둘(예외 없이 되돌리기) · 같이 쓰기 함수 셋의 can_see_card · 되돌리는 SQL.
// 서버 키 경로 넷(위키 장·공유 카드·달력·푸시)은 코드로 거른다 — 그 배선과 순수 판정(services/visibility.js)도 여기서 본다.
// **되돌리기**(§3-5): 0092에서 doc_vec 정책의 comment_id를 빼거나, files_select의 주보 갈래를 고치거나, guard_card_project가
// projects를 직접 읽게 하거나, share.js의 isLeaderOnly 분기를 빼면 아래가 깨진다.
{
  const m92 = readFileSync(new URL('../supabase/migrations/0092_project_visibility.sql', import.meta.url), 'utf8');
  const sql = m92.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const H = 'coalesce\\(';
  const hidden = (col) => new RegExp(`${H}${col} <> all \\(\\(select public\\.hidden_ids\\(\\)\\)::uuid\\[\\]\\), true\\)`);

  ok(/alter table public\.projects add column if not exists visibility text not null default 'all';/.test(sql), 'projects.visibility 기본 all');
  ok(/check \(visibility in \('all', 'leaders'\)\)/.test(sql), 'visibility는 all|leaders만');
  for (const f of ['is_leader()', 'can_see_project(p uuid)', 'can_see_card(c uuid)', 'hidden_ids()', 'leader_profile_ids()']) {
    const name = f.split('(')[0];
    ok(new RegExp(`create or replace function public\\.${name.replace(/_/g, '_')}\\([^)]*\\) returns \\w+(\\[\\])?\\s+language sql stable security definer set search_path = public, pg_temp`).test(sql),
      `${f}: security definer · stable · search_path 고정`);
    ok(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`).test(sql), `${name}: anon 실행 회수`);
  }
  ok(/select public\.is_admin\(\) or public\.is_pastor\(\) or public\.is_officer\(\);/.test(sql),
    '리더 = 관리자(마스터 포함) · 교역자 · 그 해 임원진 — role_note·팀은 보지 않는다');
  ok(!/role_note|profile_teams|'임원진'/.test(sql), '본인이 고칠 수 있는 칸(role_note·팀)으로 판정하지 않는다');
  ok(/leader_profile_ids\(\)[\s\S]*?\(auth\.uid\(\) is null or public\.is_approved\(\)\)[\s\S]*?p\.merged_into is null and p\.removed_at is null/.test(sql),
    '리더 id 목록은 승인된 사람·서버만 · 남긴 계정만 · 환송 제외');

  // 정책 — alter만, 그리고 줄마다 함수를 부르지 않는다
  ok(!/create policy|drop policy/i.test(sql), '0092는 정책을 만들거나 지우지 않는다 — alter만(§6-31-a)');
  const altered = [...sql.matchAll(/alter policy (\w+) on (\w+\.\w+)/g)].map(m => m[1]);
  const want = ['projects_select', 'projects_update', 'projects_delete',
    ...['cards', 'comments', 'card_teams', 'card_assignees', 'resource_links', 'files'].flatMap(t => ['select', 'insert', 'update', 'delete'].map(c => `${t}_${c}`)),
    'activity_select', 'activity_insert', 'comment_reactions_select', 'comment_reactions_insert', 'comment_reactions_delete',
    'card_docs_select', 'card_doc_updates_select', 'card_doc_updates_insert', 'card_doc_versions_select', 'card_doc_versions_insert',
    'doc_vec_select', 'coedit_channel_read', 'coedit_channel_write', 'attachments_select_authenticated'];
  for (const p of want) ok(altered.includes(p), `${p}를 조인다`);
  ok(!altered.includes('projects_insert'), 'projects_insert는 그대로(트리거가 비리더의 leaders를 all로)');
  const policyText = sql.slice(sql.indexOf('alter policy projects_select'), sql.indexOf('create or replace function public.card_doc_seed'));
  ok(!/can_see_(card|project)\(/.test(policyText), '정책이 줄마다 can_see_*를 부르지 않는다 — hidden_ids 한 번(InitPlan)');
  for (const [p, col] of [['cards_select', 'project_id'], ['comments_select', 'card_id'], ['card_teams_select', 'card_id'],
    ['comment_reactions_select', 'comment_id'], ['card_docs_select', 'card_id'], ['activity_select', 'coalesce\\(card_id, project_id\\)'],
    ['resource_links_select', 'coalesce\\(card_id, project_id\\)'], ['doc_vec_select', 'coalesce\\(card_id, comment_id, file_id, project_id\\)']]) {
    const body = sql.slice(sql.indexOf(`alter policy ${p} `)).split(/;\n/)[0];
    ok(hidden(col).test(body), `${p}: ${col.replace(/\\/g, '')}가 가릴 id가 아니다(업무가 먼저 · 낡을 수 있는 project_id는 마지막)`);
    ok(/public\.is_approved\(\)/.test(body), `${p}: 승인 게이트를 유지한다`);
  }
  for (const c of ['select', 'insert', 'update', 'delete']) {
    const body = sql.slice(sql.indexOf(`alter policy files_${c} `)).split(/;\n/)[0];
    ok(/service_id is null( and|\s+then) coalesce\(coalesce\(card_id, project_id\) <> all/.test(body), `files_${c}: 업무 첨부 갈래에만 감싼다`);
  }
  ok(/exists \(select 1 from public\.services s\s+where s\.id = files\.service_id and \(s\.status = 'published' or public\.can_edit_service\(\)\)\)/.test(sql),
    'files_select의 주보 갈래(발행본 · 편집 자격)는 그대로');
  ok(!/alter table public\.files|files_\w*check|drop constraint[^;]*files/.test(sql), 'files의 CHECK 제약은 건드리지 않는다(④ 모임 갈래)');
  ok(/created_by = any \(array\[auth\.uid\(\), public\.effective_uid\(\)\]\) or public\.is_admin\(\)\)\s+and coalesce\(project_id <> all/.test(sql),
    'cards_insert는 0071의 작성자 칸 식을 그대로 두고 and만 더한다');
  ok(/substr\(realtime\.topic\(\), 8\) <> all \(\(select public\.hidden_ids\(\)\)::text\[\]\)/.test(sql), '같이 쓰기 채널은 주제의 업무 id로(글자 비교 — 형 변환 오류 없음)');
  ok(/\(storage\.foldername\(name\)\)\[2\] <> all \(\(select public\.hidden_ids\(\)\)::text\[\]\)/.test(sql), '레거시 첨부 버킷은 경로 둘째 도막(업무 id)으로');
  ok(/union all select c\.id from public\.comments c join lc[\s\S]*?union all select f\.id from public\.files f join lc/.test(sql),
    'hidden_ids가 댓글·첨부 id도 담는다(doc_vec·반응은 card_id 칸이 없다)');

  // 보호 트리거 — 예외 없이 되돌리기(0071 방식) · 트리거는 projects를 직접 읽지 않는다(RLS에 가려 '없음'이 된다 — 리허설에서 밟음)
  ok(/create trigger trg_projects_guard_visibility before insert or update of visibility on public\.projects/.test(sql), 'visibility 보호 트리거');
  ok(/if tg_op = 'INSERT' then\s+new\.visibility := 'all';\s+else\s+new\.visibility := old\.visibility;/.test(sql), '비리더는 INSERT면 all · UPDATE면 옛 값');
  ok(/create trigger trg_cards_guard_project before update of project_id on public\.cards/.test(sql), '업무 옮기기 보호 트리거');
  const g = sql.slice(sql.indexOf('function public.guard_card_project'), sql.indexOf('create trigger trg_cards_guard_project'));
  ok(/not public\.can_see_project\(old\.project_id\) or not public\.can_see_project\(new\.project_id\)[\s\S]*?new\.project_id := old\.project_id;/.test(g)
    && !/from public\.projects/.test(g), '업무 옮기기 가드는 can_see_project(definer)로 보고 옛 값으로 되돌린다');
  const guards = sql.slice(sql.indexOf('function public.guard_project_visibility'), sql.indexOf('alter policy projects_select'));
  ok(!/raise exception/i.test(guards), '보호 트리거는 예외를 던지지 않는다');
  for (const f of ['card_doc_seed', 'card_doc_compact', 'card_doc_baseline']) {
    const body = sql.slice(sql.indexOf(`function public.${f}(`)).split('end $$;')[0];
    ok(/if not public\.can_see_card\(p_card\) then raise exception 'not visible' using errcode = '42501';/.test(body), `${f}가 리더 업무를 막는다(security definer라 RLS 밖)`);
  }
  for (const line of ['alter table public.projects drop column if exists visibility;', 'drop function if exists public.hidden_ids();',
    'drop trigger if exists trg_cards_guard_project on public.cards;', 'alter policy doc_vec_select on public.doc_vec using (public.is_approved());']) {
    ok(m92.includes(`--   ${line}`), `0092의 되돌리는 SQL에 '${line.slice(0, 40)}…'`);
  }

  // 순수 판정 한 벌(services/visibility.js · import 0)
  const V = await import(new URL('../src/services/visibility.js', import.meta.url).href);
  ok(V.isLeaderOnly({ visibility: 'leaders' }) && !V.isLeaderOnly({ visibility: 'all' }) && !V.isLeaderOnly({}) && !V.isLeaderOnly(null), 'isLeaderOnly — 칸이 없으면 공개');
  ok(V.canSetVisibility({ cloudOn: false }) && V.canSetVisibility({ cloudOn: true, amLeader: true })
    && !V.canSetVisibility({ cloudOn: true, amLeader: false }) && !V.canSetVisibility({ cloudOn: true }), '자물쇠는 리더에게만 · 게스트는 언제나');
  ok(JSON.stringify(V.visibleRecipients(['a', 'b', null], { leaderOnly: true, leaderIds: new Set(['b']) })) === '["b"]'
    && JSON.stringify(V.visibleRecipients(['a'], { leaderOnly: true })) === '[]'
    && JSON.stringify(V.visibleRecipients(['a', ''], {})) === '["a"]', '받는 사람 — 리더 목록이 없으면 닫힌다');
  const d = V.dropLeaderOnly({
    projects: [{ id: 'p1' }, { id: 'p2', visibility: 'leaders' }],
    cards: [{ id: 'c1', project_id: 'p1' }, { id: 'c2', project_id: 'p2' }],
    comments: [{ id: 'm1', card_id: 'c1' }, { id: 'm2', card_id: 'c2' }, { id: 'm3', card_id: 'gone' }],
    files: [{ id: 'f1', card_id: 'c2' }, { id: 'f2', card_id: null, service_id: 's1' }, { id: 'f3', card_id: 'c1' }],
  });
  ok(d.projects.map(x => x.id).join() === 'p1' && d.cards.map(x => x.id).join() === 'c1'
    && d.comments.map(x => x.id).join() === 'm1,m3' && d.files.map(x => x.id).join() === 'f2,f3',
    '위키 원본에서 리더 프로젝트·업무·댓글·첨부만 걷는다(주보 첨부·주인 없는 줄은 그대로)');

  // 서버 키 경로 배선
  const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const share = rd('api/share.js');
  ok(/from\('projects'\)\.select\('name, visibility'\)/.test(share) && /if \(!isRestricted\(data\)\) \{\s+title = `더다붓 · \$\{data\.name\}`/.test(share),
    '공유 카드: 리더 프로젝트·직접 선택(0105)이면 이름을 싣지 않는다');
  ok(/projects\(visibility\)/.test(share) && /if \(!isRestricted\(data\.projects\)\) \{\s+title = `더다붓 · \$\{data\.title\}`/.test(share),
    '공유 카드: 좁혀진 프로젝트의 업무면 제목·상태·마감을 싣지 않는다');
  const ics = rd('api/ics.js');
  ok((ics.match(/await seeProject\(supabase, /g) || []).length === 2 && /if \(!proj\) \{ reply\(null\); return; \}/.test(ics),
    '달력: 등록(POST — 읽기·쓰기)과 구독(GET) 둘 다 주인이 볼 수 있는 프로젝트인지');
  ok(/import \{[^}]*\bdropLeaderOnly\b[^}]*\} from '\.\.\/\.\.\/src\/services\/visibility\.js';/.test(rd('api/_wiki/gather.js'))
    && /select\('id, name, year, archived, position, visibility'\)/.test(rd('api/_wiki/gather.js')), '위키 장: 읽은 자리에서 걷는다');
  ok(/rpc\('leader_profile_ids'\)/.test(rd('api/_leaders.js')) && /select\('project_id, projects\(visibility\)'\)\.eq\('id', cardId\)/.test(rd('api/_leaders.js')),
    '서버 판정: 리더 목록은 DB 함수 한 벌 · 업무는 지금 프로젝트로');
  console.log(`PASS  0092 리더만 보는 프로젝트의 모양·판정·서버 키 경로 ${n}가지`);
}

// ── 0105 보는 사람 직접 선택 · 0106 비밀번호 재설정 요청 (v5 B · 2026-10-17) — 마이그레이션 모양 · 순수 판정 · 앱 배선 ──
// 실제 경계(행 수)는 레포 밖 리허설(PGlite 하네스 · 운영 DB ROLLBACK SQL)이 본다 — 여기는 모양이 0092·0101·0102 관례를 지키는지.
// **되돌리기**: 0105의 restrictive 정책을 지우면 '①', hidden_ids의 custom 갈래를 지우면 '②', 0106 INSERT 정책에 lock_reset을 넣으면 '⑤',
// toggleViewerTeam의 rest.some 거르기를 빼면 '겸직', leaderOnly의 viewersReady 판정을 빼면 '배선'이 깨진다.
{
  const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m105 = rd('supabase/migrations/0105_project_viewers.sql');
  const b105 = m105.slice(0, m105.indexOf('-- ── 확인'));
  assert.ok(/create policy projects_custom_guard on public\.projects as restrictive for all to authenticated/.test(b105)
    && /visibility <> 'custom' or coalesce\(id <> all \(\(select public\.hidden_ids\(\)\)::uuid\[\]\), true\)/.test(b105), '① projects는 restrictive 하나(custom이 아니면 참)');
  assert.ok(!/alter policy projects_(select|update|delete)/.test(b105), 'projects의 기존 정책은 alter하지 않는다(휴지통 묶음과 겹치지 않게)');
  const hid = b105.slice(b105.indexOf('create or replace function public.hidden_ids()'));
  assert.ok(/nar\.visibility = 'custom' and not me\.master/.test(hid.slice(0, 1500)) && /where exists \(select 1 from nar\)/.test(hid.slice(0, 1500)), '② hidden_ids에 custom 갈래 · 좁혀진 프로젝트가 없으면 판정 함수를 안 부른다');
  assert.ok(/check \(visibility in \('all', 'leaders', 'custom'\)\)/.test(b105), '③ CHECK에 custom');
  for (const f of ['is_project_viewer(uuid)', 'project_audiences(uuid[])', 'set_project_viewers(uuid, uuid[], text[])']) {
    assert.ok(b105.includes(`revoke all on function public.${f} from public, anon;`), `${f} 익명 회수`);
  }
  for (const f of ['ensure_custom_viewer()', 'guard_project_visibility()', 'stamp_project_visibility()']) {
    assert.ok(b105.includes(f) && /revoke execute on function public\.ensure_custom_viewer\(\) from public, anon, authenticated;/.test(b105), `트리거 함수 EXECUTE 회수(${f})`);
  }
  assert.ok(/create policy project_viewers_select on public\.project_viewers for select to authenticated\s+using \(\(select public\.is_approved\(\)\)/.test(b105)
    && !/create policy project_viewers_(insert|update|delete)/.test(b105), '④ 고른 사람 표: 읽기만 · to authenticated · (select …) 꼴 · 쓰기는 함수만');
  assert.ok(/if not public\.is_leader\(\) then raise exception 'not a leader' using errcode = '42501'/.test(b105)
    && /if not public\.can_see_project\(p\) then raise exception 'not visible'/.test(b105), 'set_project_viewers는 리더 · 보는 사람만');
  assert.ok(m105.includes('-- ── 되돌리기') && m105.includes('--   drop table if exists public.project_viewers;'), '되돌리는 SQL은 맨 아래 주석');
  const m106 = rd('supabase/migrations/0106_lock_reset_request.sql');
  const b106 = m106.slice(0, m106.indexOf('-- ── 확인'));
  assert.ok(b106.includes("'assignee_comment', 'lock_reset'));") && !/alter policy notifications_insert_authenticated/.test(b106), '⑤ lock_reset은 CHECK만 — INSERT 정책에는 없다(위조 못 함)');
  assert.ok(/create policy card_lock_requests_select on public\.card_lock_requests for select to authenticated\s+using \(profile_id = any \(array\[\(select auth\.uid\(\)\), \(select public\.effective_uid\(\)\)\]\) or \(select public\.is_master\(\)\)\)/.test(b106),
    '⑥ 요청 읽기는 본인 · 마스터((select …) 꼴)');
  assert.ok(/if not public\.is_master\(\) then raise exception 'not master' using errcode = '42501'/.test(b106) && !/delete from public\.card_unlocks/.test(b106),
    '⑦ reset_card_lock은 마스터만 · 맞혀 둔 계정은 걷지 않는다');
  assert.ok(/on conflict \(card_id, profile_id\) do nothing;\n\s+get diagnostics n = row_count;\n\s+if n = 0 then return '\{\}'::uuid\[\]; end if;/.test(b106), '⑧ 같은 사람의 두 번째 요청은 알림 없이 빈 배열');
  assert.ok(/revoke execute on function public\.clear_lock_requests\(\) from public, anon, authenticated;/.test(b106)
    && /revoke all on function public\.request_lock_reset\(uuid\) from public, anon;/.test(b106), '트리거 함수 회수 · RPC 익명 회수');
  // 순수 판정(visibility.js)
  const V = await import(new URL('../src/services/visibility.js', import.meta.url).href);
  assert.ok(V.isCustomOnly({ visibility: 'custom' }) && V.isRestricted({ visibility: 'custom' }) && V.isRestricted({ visibility: 'leaders' }) && !V.isRestricted({}),
    '좁혀진 프로젝트 = 리더만 ∪ 직접 선택');
  assert.ok(V.visibilityOf({ visibility: 'custom' }) === 'custom' && V.visibilityOf({ visibility: 'weird' }) === 'all' && V.visibilityOf(null) === 'all', 'DB 값 → 앱 값(모르면 공개)');
  const people = [{ name: '나', teams: ['미디어팀'] }, { name: '은지', teams: ['웰컴팀', '임원진'] }, { name: '수빈', teams: ['웰컴팀'] }, { name: '지훈', teams: ['임원진'] }];
  let v = V.toggleViewerTeam({ viewers: ['나'], viewerTeams: [] }, '웰컴팀', people, '나');
  assert.deepStrictEqual(v, { viewers: ['나', '은지', '수빈'], viewerTeams: ['웰컴팀'] }, '팀 칩을 켜면 그 팀 사람이 다 들어간다');
  v = V.toggleViewerTeam(v, '임원진', people, '나');
  assert.deepStrictEqual(v.viewers, ['나', '은지', '수빈', '지훈'], '겸직은 한 번만');
  v = V.toggleViewerTeam(v, '웰컴팀', people, '나');
  assert.deepStrictEqual(v, { viewers: ['나', '은지', '지훈'], viewerTeams: ['임원진'] }, '겸직: 끄면 그 팀에만 걸린 사람만 빠진다(은지는 남는다)');
  assert.deepStrictEqual(V.toggleViewerTeam({ viewers: ['나'], viewerTeams: ['미디어팀'] }, '미디어팀', people, '나').viewers, ['나'], '나는 빠지지 않는다');
  const d = V.dropLeaderOnly({ projects: [{ id: 'p1' }, { id: 'p3', visibility: 'custom' }], cards: [{ id: 'c1', project_id: 'p1' }, { id: 'c3', project_id: 'p3' }] });
  assert.ok(d.projects.map(x => x.id).join() === 'p1' && d.cards.map(x => x.id).join() === 'c1', '위키 원본에서 직접 선택 프로젝트도 걷는다');
  // 앱 배선
  const lo = rd('src/components/leaderOnly.jsx');
  assert.ok(/const viewersReady = useStore\(s => s\.viewersReady === true\);\n\s+const pick = enabled && !!session \? viewersReady : true;/.test(lo) && !/GUEST_PEOPLE|s\.demo/.test(lo),
    '배선: 직접 선택 판은 클라우드에서 0105를 읽었을 때만(시연 표시·씨앗 사람 없음)');
  const cs = readSplit('src/services/cloudSync.js');
  assert.ok(/const viewerInfo = Promise\.resolve\(\)\.then\(\(\) => Promise\.all\(\[cloud\.listProjectViewers\(\), cloud\.projectAudiences\(\)\]\)\)\n\s+\.catch\(/.test(cs)
    && cs.includes('viewersReady: !!viewers,'), '배선: 고른 사람·audience는 없어도 되는 값(마이그레이션 전에도 오류 화면 없음)');
  const md = rd('src/modals/modals.jsx');
  assert.ok(/const askReset = isNew \|\| !source\.locked \|\| \(cloudMode && !cloudAsk\) \? null/.test(md) && !/s\.demo/.test(md),
    '배선: 클라우드는 요청 표를 읽었을 때만 비밀번호를 까먹었어요');
  assert.ok(/lock_reset: '비밀번호를 다시 설정해 달라고 요청했어요'/.test(rd('src/services/notifyText.js')) && /failText\('요청하지 못했어요', e\)/.test(rd('src/modals/modals.jsx')),
    '재설정 요청 문구(사용자 확인 2026-10-18)');
  console.log('PASS  0105 보는 사람 직접 선택 · 0106 비밀번호 재설정 요청 — 마이그레이션 모양 · 순수 판정 · 앱 배선');
}

// ── 승인 대기가 저절로 넘어가기 · 승인 알림 · 화면에 기술 원문 안 싣기 (2026-09-25) ──
// 승인 여부를 토큰 갱신(한 시간)마다만 물어서, 관리자가 수락해도 기다리는 사람은 새로고침해야 했다.
// 대기 중에는 실시간 내 profiles 행 · 다시 보일 때 · 30초 주기로 다시 묻는다(클라우드 전용 — 게스트
// 스위트가 못 본다). 판정은 approvalWatch.js 순수 함수로 여기서 단정하고, 배선은 소스로 본다.
{
  const W = await import(new URL('../src/services/approvalWatch.js', import.meta.url).href);
  const ok = (data) => ({ data, error: null });
  assert.deepStrictEqual(W.permFromRpc([ok(false), ok(false), ok(true)]), { isAdmin: false, isMaster: false, approved: true });
  assert.deepStrictEqual(W.permFromRpc([ok(null), ok(null), ok(null)]), { isAdmin: false, isMaster: false, approved: false });
  assert.strictEqual(W.permFromRpc([ok(true), { data: null, error: { message: 'x' } }, ok(true)]), null, '하나라도 실패면 모름(null) — 아니오로 바꾸지 않는다');
  assert.strictEqual(W.permFromRpc(null), null);
  assert.strictEqual(W.permFromRpc([ok(true)]), null);
  assert.ok(W.shouldWatchApproval({ enabled: true, hasSession: true, approved: false }), '대기로 확정되면 지켜본다');
  assert.ok(!W.shouldWatchApproval({ enabled: true, hasSession: true, approved: null }), '아직 모르면 지켜보지 않는다');
  assert.ok(!W.shouldWatchApproval({ enabled: true, hasSession: true, approved: true }), '승인되면 그만 본다');
  assert.ok(!W.shouldWatchApproval({ enabled: true, hasSession: false, approved: false }));
  assert.ok(!W.shouldWatchApproval({ enabled: false, hasSession: true, approved: false }), '게스트는 해당 없음');
  assert.ok(W.approvalRowPassed({ approved: true, removed_at: null }));
  assert.ok(!W.approvalRowPassed({ approved: false }), '이름·사진 쓰기로 온 행은 다시 묻지 않는다');
  assert.ok(!W.approvalRowPassed({ approved: true, removed_at: '2026-09-25' }));
  assert.ok(!W.approvalRowPassed(null));
  assert.ok(W.APPROVAL_POLL_MS >= 20000 && W.APPROVAL_POLL_MS <= 60000, '가벼운 주기 — 20~60초');

  const authSrc = readFileSync(new URL('../src/services/auth.jsx', import.meta.url), 'utf8');
  assert.ok(/shouldWatchApproval\(\{ enabled, hasSession: !!uid, approved: perm\.approved \}\)/.test(authSrc), '대기 판정은 perm.approved(null/false 구분)로');
  assert.ok(/table: 'profiles', filter: `id=eq\.\$\{uid\}`/.test(authSrc), '실시간은 내 profiles 행만');
  assert.ok(/approvalRowPassed\(payload\.new\)/.test(authSrc), '실시간 행은 approvalRowPassed로 거른다');
  assert.ok(/setInterval\(recheck, APPROVAL_POLL_MS\)/.test(authSrc) && /visibilitychange/.test(authSrc), '주기 + 다시 보일 때');
  assert.ok(/supabase\.removeChannel\(channel\)/.test(authSrc), '떠날 때 채널을 걷는다');
  assert.strictEqual((authSrc.match(/permFromRpc\(/g) || []).length, 1, '처음 물음과 다시 묻기가 askPerm 한 벌');
  // 첫 물음이 두 번 다 실패하면 답을 받을 때까지 다시 묻는다(2026-10-15 · PITFALLS 55-b) — 예전에는 토큰 갱신(한 시간)까지 '모름'.
  // 되돌리기: auth.jsx의 setPermStuck(true)를 지우면 다시 묻기가 영영 안 켜진다(아래 배선 단정이 깨진다).
  const R = (o) => W.shouldRetryPerm({ enabled: true, hasSession: true, approved: null, stuck: true, ...o });
  assert.ok(R({}), '두 번 다 실패하고 아직 모르면 다시 묻는다');
  assert.ok(!R({ stuck: false }), '첫 물음이 도는 동안은 겹쳐 묻지 않는다');
  assert.ok(!R({ approved: true }) && !R({ approved: false }), '답을 받으면 그친다(대기는 shouldWatchApproval 몫)');
  assert.ok(!R({ hasSession: false }) && !R({ enabled: false }), '로그인 전·게스트는 해당 없음');
  assert.ok(W.PERM_RETRY_MS >= 2000 && W.PERM_RETRY_MS <= 10000, '몇 초 간격');
  assert.ok(/setPermStuck\(true\);\s*return;/.test(authSrc), '두 번 다 실패하면 stuck을 세운다');
  assert.ok(/shouldRetryPerm\(\{ enabled, hasSession: !!session, approved: perm\.approved, stuck: permStuck \}\)/.test(authSrc), '판정은 shouldRetryPerm 한 벌');
  assert.ok(/setInterval\(again, PERM_RETRY_MS\)/.test(authSrc) && /addEventListener\('focus', again\)/.test(authSrc)
    && /addEventListener\('online', again\)/.test(authSrc), '주기 + 초점 + online(+ 다시 보일 때)');

  // 승인 알림 — 시스템 갈래 문구 · 관리자 수락에서 보낸다 · 체크 제약과 INSERT 정책을 같이(관리자만)
  const N = await import(new URL('../src/services/notifyText.js', import.meta.url).href);
  assert.ok(N.isSystemNotif('approved'));
  assert.strictEqual(N.notifLine('approved', '노준석'), '가입이 승인되었어요');
  assert.strictEqual(N.notifArea('approved'), 'group', '시계 아이콘이 아니라 사람들 아이콘');
  const memSrc = readFileSync(new URL('../src/views/membersView.jsx', import.meta.url), 'utf8');
  assert.ok(/if \(next\) \{\s*cloud\.insertNotifications\(\[row\.id\], \{ kind: 'approved'/.test(memSrc), '수락하면 그 사람에게 approved 알림');
  const mig = readFileSync(new URL('../supabase/migrations/0076_approved_notification.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(/notifications_kind_check[\s\S]*'approved'\)\);/.test(mig), '체크 제약에 approved');
  assert.ok(/or \(kind = 'approved' and public\.is_admin\(\)\)/.test(mig), 'approved는 관리자만 넣는다');

  // 화면에 기술 원문을 싣지 않는다(§8) — 계정 연결 토스트 · 오류 화면 · 미리보기 · 공유 거부 이름 · api 401
  const { linkErrorReason } = await import(new URL('../src/services/errorText.js', import.meta.url).href);
  assert.strictEqual(linkErrorReason({ code: 'identity_already_exists', message: 'Identity is already linked to another user' }), '이미 따로 가입된 계정이에요');
  assert.strictEqual(linkErrorReason({ message: 'Manual linking is disabled' }), '관리자에게 알려주세요');
  assert.strictEqual(linkErrorReason({ message: 'Failed to fetch' }), '인터넷 연결을 확인하고 다시 시도해주세요');
  assert.strictEqual(linkErrorReason({ message: 'Unexpected provider state' }), '잠시 후 다시 시도해주세요', '영어 원문은 화면에 안 싣는다');
  const setSrc = readFileSync(new URL('../src/modals/settings.jsx', import.meta.url), 'utf8');
  assert.ok(!/Manual Linking|Supabase 설정|error\.message|e\.message/.test(setSrc), '계정 연결 토스트에 원문·제품명 없음');
  assert.ok(/계정을 연결하지 못했어요\\n\$\{linkErrorReason\(err\)\}/.test(setSrc), '두 줄 — 무엇을 못했는지 / 이유');
  const ebSrc = readFileSync(new URL('../src/components/ErrorBoundary.jsx', import.meta.url), 'utf8');
  assert.ok(!/error\?\.toString\(\)|렌더링 중 오류/.test(ebSrc) && /data-error-boundary/.test(ebSrc), '오류 화면에 TypeError 원문 없음');
  const fpSrc = readFileSync(new URL('../src/components/FilePreviewModal.jsx', import.meta.url), 'utf8');
  assert.ok(!/setError\([^)]*(e\.message|String\(e\))/.test(fpSrc) && !/new Error\(`HTTP/.test(fpSrc), "미리보기 실패에 원문·'HTTP 404' 없음");
  const shSrc = readFileSync(new URL('../src/services/shareImage.js', import.meta.url), 'utf8');
  assert.ok(!/\(\$\{why\}\)/.test(shSrc), '공유 거부 이름(NotAllowedError)을 토스트에 싣지 않는다');
  const libSrc = readFileSync(new URL('../api/_lib.js', import.meta.url), 'utf8');
  assert.ok(!/세션이 유효하지 않습니다|'인증이 필요합니다\.'/.test(libSrc.split('export async function requireApprovedUser')[1] || 'x'), 'api 401은 사람 말');
  console.log('PASS  승인 대기 자동 전환(approvalWatch) · 승인 알림(0076) · 화면에 기술 원문 안 싣기');
}


// 0097 — 가입 트리거가 뒤늦게 온 카카오·구글 메타도 받아 적는다(2026-10-11 천진영: identity가 150ms 늦어 사진이 비었다).
// UPDATE 갈래는 **10분 안에 만든 프로필의 빈 칸만** 메운다 — 사용자가 나중에 고른 '기본으로'(null)는 건드리지 않는다.
// **되돌리기**(§3-5): 트리거에서 `or update of raw_user_meta_data`를 빼거나, UPDATE 갈래의 10분 조건·`is null` 조건을 지우면 깨진다.
{
  const sql = readFileSync(new URL('../supabase/migrations/0097_signup_avatar_late.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.ok(/after insert or update of raw_user_meta_data on auth\.users/.test(sql), '트리거는 insert와 raw_user_meta_data update');
  assert.ok(/if tg_op = 'INSERT' then[\s\S]*on conflict \(id\) do nothing;[\s\S]*else/.test(sql), 'INSERT 갈래는 0001 그대로(on conflict do nothing)');
  assert.ok(/and \(p\.avatar_url is null or p\.display_name is null\)\s*and p\.created_at > now\(\) - interval '10 minutes'/.test(sql), 'UPDATE 갈래는 10분 안의 빈 칸만');
  assert.ok(/set avatar_url\s*=\s*coalesce\(p\.avatar_url, new\.raw_user_meta_data ->> 'avatar_url', new\.raw_user_meta_data ->> 'picture'\)/.test(sql), '있는 사진은 안 덮는다(coalesce 앞이 p.avatar_url)');
  console.log('PASS  0097 가입 트리거 — 늦게 온 메타는 10분 안 빈 칸만');
}

// 0098 — 다붓이가 배운 것(20차 ⑧ · 사용자 결정 2026-10-13). 알려 준 사람(told_by)이 든 표라 읽기·쓰기 모두 마스터만 —
// 서버는 서버 키로 대신 쓰고 승인된 것만 근거로 읽는다. 'learned' 장도 0090의 faq처럼 마스터만. 질문 표는 그대로 익명.
// **되돌리기**(§3-5): 정책 하나를 is_approved()로 풀거나, wiki_pages 정책에서 'learned'를 빼거나, 질문 표에 묻는 사람 칸을 더하면 깨진다.
{
  const sql = readFileSync(new URL('../supabase/migrations/0098_dabooti_facts.sql', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const table = sql.slice(sql.indexOf('create table if not exists public.dabooti_facts'), sql.indexOf('create index'));
  for (const col of ['id ', 'question ', 'text ', 'told_by ', 'status ', 'from_question_id ', 'leader ', 'count ', 'created_at ', 'decided_at ']) assert.ok(table.includes(`  ${col}`), `0098 칸: ${col.trim()}`);
  assert.ok(/status\s+text not null default 'pending' check \(status in \('pending', 'approved', 'rejected'\)\)/.test(table), '상태 셋 · 기본 pending');
  assert.ok(/told_by\s+uuid references public\.profiles\(id\) on delete set null/.test(table) && /from_question_id uuid references public\.dabooti_questions\(id\) on delete set null/.test(table), '알려 준 사람 · 이어진 물음');
  assert.ok(sql.includes('alter table public.dabooti_facts enable row level security;'), 'RLS 켬');
  const pols = [...sql.matchAll(/create policy (\w+) on public\.dabooti_facts for (\w+) (using|with check) \(([^;]*)\);/g)];
  assert.deepStrictEqual(pols.map(m => m[2]).sort(), ['delete', 'insert', 'select', 'update'], '정책 넷');
  assert.ok(pols.every(m => !/is_approved/.test(m[4]) && (m[4].match(/public\.is_master\(\)/g) || []).length >= 1 && !/\bor\b/.test(m[4])), `모두 is_master()만: ${pols.map(m => m[4])}`);
  assert.ok(sql.includes("using (public.is_approved() and (id not in ('faq', 'learned') or public.is_master()));") && sql.includes("using (public.is_approved() and (page_id not in ('faq', 'learned') or public.is_master()));"), "'learned' 장 · 그 장의 고친 줄은 마스터만 읽는다");
  assert.ok(sql.includes("add constraint doc_vec_no_learned check (page_id is distinct from 'learned')"), '뜻 찾기 조각으로 만들지 않는다');
  assert.ok(sql.includes('alter table public.dabooti_questions add column if not exists resolved_at timestamptz;') && !/dabooti_questions add column if not exists (user_id|asked_by|profile_id|told_by)/.test(sql), '질문 표는 닫힌 때만 더한다(익명 그대로)');
  console.log('PASS  0098 다붓이가 배운 것 — 마스터만(정책 넷) · learned 장 마스터만 · 질문 표 익명 그대로');
}

// ── 0099 업무 잠금(비밀번호 · 사용자 결정 2026-10-13 · 20차 묶음 ⑨) ───────────────────────────
// 라이브 경계는 psql 리허설(ROLLBACK)로 봤다 — 만든 사람 / 맞힌 사람 / 못 맞힌 사람 / 마스터 네 시점의 select 수 · 1분 5회 ·
// 보호·거울 트리거 · 칸 권한(HANDOFF 20차 블록). 여기는 파일 모양: 새 표 셋(해시는 cards가 아니라 card_secrets · 칸 권한으로 해시를
// 아무에게도 안 준다) · 함수 다섯(security definer · search_path · anon 회수) · 있는 정책은 alter만 + `(select locked_hidden_ids())`
// 한 번(InitPlan) · 0092 식은 그대로 둔 채 and 하나 · 보호 트리거는 current_user로(함수 안은 주인) · 같이 쓰기 함수 셋의 can_open_card ·
// 순수 판정(services/cardLock.js) · 서버 키 경로(위키 장·임베딩·공유 카드)와 앱 배선(card_secrets 얹기 · 알림 미리보기 · 업무 창).
// **되돌리기**(§3-5): 0099에서 comments_select의 locked_hidden_ids 줄을 빼거나, unlock_card의 `tries >= 5`를 지우거나, 칸 권한에
// lock_hash를 넣거나, guard_card_lock을 auth.uid()로 가르거나, cloudSync.loadCardPatch의 getCardSecret을 빼면 아래가 깨진다.
{
  const m99 = readFileSync(new URL('../supabase/migrations/0099_card_lock.sql', import.meta.url), 'utf8');
  const sql = m99.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const L = (col) => new RegExp(`coalesce\\(${col} <> all \\(\\(select public\\.locked_hidden_ids\\(\\)\\)::uuid\\[\\]\\), true\\)`);

  ok(/alter table public\.cards add column if not exists locked boolean not null default false;/.test(sql), 'cards.locked 기본 false');
  ok(/cards add column if not exists locked_by uuid/.test(sql) && /cards add column if not exists locked_at timestamptz/.test(sql), '누가·언제 잠갔나는 DB 칸에만');
  ok(/projects add column if not exists visibility_by uuid/.test(sql) && /projects add column if not exists visibility_at timestamptz/.test(sql), '리더만 보기를 누가·언제');
  ok(!/cards add column[^;]*lock_hash/.test(sql), '해시는 cards에 두지 않는다(승인된 누구나 읽는 행이다 — 오프라인으로 풀린다)');
  ok(/create table if not exists public\.card_secrets \([\s\S]*?lock_hash\s+text not null,[\s\S]*?lock_salt\s+text not null/.test(sql), 'card_secrets에 본문 거울과 해시');
  ok(/grant select \(card_id, description, ai_summary, updated_at\) on public\.card_secrets to authenticated;/.test(sql)
    && /grant update \(description, ai_summary, updated_at\) on public\.card_secrets to authenticated;/.test(sql)
    && !/grant [^;]*lock_hash[^;]*to authenticated/.test(sql), '해시 두 칸은 칸 권한으로 아무에게도 안 준다(여는 사람에게도)');
  ok(/revoke all on public\.card_unlock_tries from anon, authenticated;/.test(sql) && !/policy \w+ on public\.card_unlock_tries/.test(sql), '시도 기록은 함수만');
  for (const t of ['card_secrets', 'card_unlocks', 'card_unlock_tries']) ok(new RegExp(`alter table public\\.${t} enable row level security;`).test(sql), `${t} RLS`);

  for (const name of ['can_open_card', 'locked_hidden_ids']) {
    ok(new RegExp(`create or replace function public\\.${name}\\([^)]*\\) returns [\\w\\[\\]]+\\s+language sql stable security definer set search_path = public, pg_temp`).test(sql), `${name}: security definer · stable · search_path`);
  }
  for (const f of ['lock_card(uuid, text)', 'unlock_card(uuid, text)', 'unlock_owner(uuid)', 'can_open_card(uuid)', 'locked_hidden_ids()']) {
    ok(sql.includes(`revoke all on function public.${f} from public, anon;`), `${f}: anon 실행 회수`);
  }
  for (const f of ['lock_card', 'unlock_card', 'unlock_owner']) {
    ok(new RegExp(`function public\\.${f}\\([^)]*\\) returns boolean\\s+language plpgsql security definer set search_path = public, pg_temp`).test(sql), `${f}: security definer`);
  }
  const canOpen = sql.slice(sql.indexOf('function public.can_open_card'), sql.indexOf('function public.locked_hidden_ids'));
  ok(/not exists \(select 1 from public\.cards k where k\.id = c and k\.locked\)/.test(canOpen) && /k\.created_by = any \(array\[auth\.uid\(\), public\.effective_uid\(\)\]\)/.test(canOpen)
    && /from public\.card_unlocks u/.test(canOpen) && /public\.is_master\(\)/.test(canOpen) && !/is_admin\(\)|is_leader\(\)/.test(canOpen),
    '여는 사람 = 안 잠김 · 만든 사람(남긴 계정) · 맞힌 계정 · 마스터 — 관리자·리더는 아니다');
  ok(/union all select c\.id from public\.comments c join lk[\s\S]*?union all select f\.id from public\.files f join lk/.test(sql), 'locked_hidden_ids가 댓글·첨부 id도 담는다');
  const lockFn = sql.slice(sql.indexOf('function public.lock_card'), sql.indexOf('function public.unlock_card'));
  ok(lockFn.includes("encode(sha256(convert_to(salt || pw, 'UTF8')), 'hex')") && /salt text := gen_random_uuid\(\)::text;/.test(lockFn),
    '해시 = hex(sha256(소금‖비밀번호)) · 소금은 uuid 글자 — viewPw.js와 같은 규칙(31-f)');
  ok(/raise exception 'not the author' using errcode = '42501'/.test(lockFn) && /coalesce\(pw, ''\) = ''/.test(lockFn), '잠그기는 만든 사람만 · 빈 비밀번호 거절');
  ok(/description = '', ai_summary = null/.test(lockFn) && /coalesce\(k\.description, ''\), k\.ai_summary/.test(lockFn), '잠그면 본문·고정 요약을 card_secrets로 옮기고 cards를 비운다');
  ok(/delete from public\.card_unlocks where card_id = c;/.test(lockFn), '다시 설정하면 맞힌 계정을 걷는다');
  const unl = sql.slice(sql.indexOf('function public.unlock_card'), sql.indexOf('function public.unlock_owner'));
  ok(/if tries >= 5 then return false; end if;/.test(unl) && /interval '1 minute'/.test(unl) && /insert into public\.card_unlock_tries/.test(unl), '시도 제한 — 1분에 5회');
  ok(unl.indexOf('card_unlock_tries (card_id, profile_id) values') < unl.indexOf('select lock_hash, lock_salt'), '시도를 먼저 적고 견준다(틀려도 남는다)');
  ok(/insert into public\.card_unlocks \(card_id, profile_id\) values \(c, me\)/.test(unl) && /me\s+uuid := public\.effective_uid\(\);/.test(unl), '맞히면 남긴 계정으로 계속 열림');
  const own = sql.slice(sql.indexOf('function public.unlock_owner'), sql.indexOf('revoke all on function public.can_open_card'));
  ok(/or public\.is_master\(\)\) then\s+raise exception 'not the author'/.test(own) && /description = d, ai_summary = s/.test(own) && /delete from public\.card_secrets/.test(own),
    '잠금 해제는 만든 사람·마스터 — 본문을 되돌리고 거울을 걷는다');

  // 보호·거울 트리거 — current_user로 가른다(함수 안 = 주인). 예외 없이 되돌린다.
  const guard = sql.slice(sql.indexOf('function public.guard_card_lock'), sql.indexOf('create trigger trg_cards_guard_lock'));
  ok(/if current_user not in \('authenticated', 'anon'\) then\s+return new;/.test(guard) && !/auth\.uid\(\)/.test(guard) && !/raise exception/i.test(guard), '보호 트리거는 current_user로(auth.uid()면 잠금 함수도 막힌다)');
  ok(/new\.locked := old\.locked; new\.locked_by := old\.locked_by; new\.locked_at := old\.locked_at;/.test(guard), '클라이언트의 잠금 칸 쓰기는 옛 값으로');
  ok(/create trigger trg_cards_guard_lock before insert or update of locked, locked_by, locked_at on public\.cards/.test(sql), '잠금 칸 보호 트리거');
  const mir = sql.slice(sql.indexOf('function public.mirror_locked_card'), sql.indexOf('create trigger trg_cards_lock_mirror'));
  ok(/if public\.can_open_card\(new\.id\) then\s+update public\.card_secrets/.test(mir) && /new\.description := old\.description;/.test(mir), '잠긴 업무의 본문 쓰기는 여는 사람이면 거울로 · cards는 그대로 비운 채');
  ok(/create trigger trg_cards_lock_mirror before update of description, ai_summary on public\.cards/.test(sql), '거울 트리거');
  ok('trg_cards_guard_lock' < 'trg_cards_lock_mirror', '이름 차례 — 보호가 거울보다 먼저 돈다');
  const stamp = sql.slice(sql.indexOf('function public.stamp_project_visibility'), sql.indexOf('create trigger trg_projects_visibility_stamp'));
  ok(/elsif new\.visibility is distinct from old\.visibility then\s+new\.visibility_by := public\.effective_uid\(\); new\.visibility_at := now\(\);\s+else\s+new\.visibility_by := old\.visibility_by;/.test(stamp),
    '리더만 보기가 바뀔 때만 누가·언제를 적고 그 밖에는 옛 값(위조 못 함)');
  ok('trg_projects_guard_visibility' < 'trg_projects_visibility_stamp', '0092 보호가 먼저 되돌린 뒤 적는다');

  // 정책 — 새 정책은 새 표에만 · 있는 정책은 alter만 · 줄마다 can_open_card를 부르지 않는다
  const created = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)].map(m => m[2]);
  ok(created.length === 3 && created.every(t => ['card_secrets', 'card_unlocks'].includes(t)), '새 정책은 새 표 둘에만(셋)');
  const altered = [...sql.matchAll(/alter policy (\w+) on (\w+\.\w+)/g)].map(m => m[1]);
  const want = [...['select', 'insert', 'update', 'delete'].flatMap(c => [`comments_${c}`, `files_${c}`]),
    'comment_reactions_select', 'comment_reactions_insert', 'comment_reactions_delete', 'activity_select',
    'card_docs_select', 'card_doc_updates_select', 'card_doc_updates_insert', 'card_doc_versions_select', 'card_doc_versions_insert',
    'doc_vec_select', 'coedit_channel_read', 'coedit_channel_write', 'attachments_select_authenticated'];
  ok(want.every(p => altered.includes(p)) && altered.length === want.length, `조이는 정책 ${want.length}개 그대로(${altered.length})`);
  for (const p of ['activity_insert', 'cards_select', 'card_teams_select', 'card_assignees_select', 'resource_links_select']) ok(!altered.includes(p), `${p}는 그대로(제목·칩·담당은 보인다 · 상태 바꾼 기록은 남긴다)`);
  const pol = sql.slice(sql.indexOf('alter policy comments_select'), sql.indexOf('create or replace function public.card_doc_seed'));
  ok(!/can_open_card\(/.test(pol), '있는 정책이 줄마다 can_open_card를 부르지 않는다 — locked_hidden_ids 한 번(InitPlan)');
  for (const [p, col] of [['comments_select', 'card_id'], ['comments_insert', 'card_id'], ['comment_reactions_select', 'comment_id'], ['activity_select', 'card_id'],
    ['card_docs_select', 'card_id'], ['card_doc_updates_insert', 'card_id'], ['doc_vec_select', 'coalesce\\(card_id, comment_id, file_id\\)']]) {
    const body = sql.slice(sql.indexOf(`alter policy ${p} `)).split(/;\n/)[0];
    ok(L(col).test(body), `${p}: ${col.replace(/\\/g, '')}가 잠긴 id가 아니다`);
    ok(/\(select public\.hidden_ids\(\)\)/.test(body) && /public\.is_approved\(\)/.test(body), `${p}: 0092 식(리더 가림 · 승인 게이트)은 그대로`);
  }
  for (const c of ['select', 'insert', 'update', 'delete']) {
    const body = sql.slice(sql.indexOf(`alter policy files_${c} `)).split(/;\n/)[0];
    ok(/service_id is null( and|\s+then) coalesce\(coalesce\(card_id, project_id\) <> all \(\(select public\.hidden_ids\(\)\)::uuid\[\]\), true\)\s+and coalesce\(card_id <> all \(\(select public\.locked_hidden_ids\(\)\)/.test(body),
      `files_${c}: 업무 첨부 갈래 안에만 더한다`);
  }
  ok(/exists \(select 1 from public\.services s\s+where s\.id = files\.service_id and \(s\.status = 'published' or public\.can_edit_service\(\)\)\)/.test(sql), 'files_select의 주보 갈래는 그대로');
  ok(!/files_meeting/.test(sql), '모임 갈래 정책 다섯(0093)은 건드리지 않는다');
  ok(/substr\(realtime\.topic\(\), 8\) <> all \(\(select public\.locked_hidden_ids\(\)\)::text\[\]\)/.test(sql), '같이 쓰기 채널도 잠긴 업무 id로');
  for (const f of ['card_doc_seed', 'card_doc_compact', 'card_doc_baseline']) {
    const body = sql.slice(sql.indexOf(`function public.${f}(`)).split('end $$;')[0];
    ok(/if not public\.can_see_card\(p_card\)/.test(body) && /if not public\.can_open_card\(p_card\) then raise exception 'locked' using errcode = '42501';/.test(body), `${f}가 잠긴 업무를 막는다(0092 줄도 그대로)`);
  }
  for (const line of ['drop table if exists public.card_secrets;', 'drop function if exists public.locked_hidden_ids();', 'alter table public.cards drop column if exists locked;',
    'drop trigger if exists trg_projects_visibility_stamp on public.projects;']) ok(m99.includes(`--   ${line}`), `되돌리는 SQL에 '${line.slice(0, 40)}…'`);
  ok(/본문을 begin\/commit 줄 없이/.test(m99), '리허설 안내: \\i로 바깥 begin 안에 넣지 않는다');

  // 순수 판정(services/cardLock.js · import 0)
  const K = await import(new URL('../src/services/cardLock.js', import.meta.url).href);
  ok(K.isCardClosed({ locked: true }) && !K.isCardClosed({ locked: true, lockedOpen: true }) && !K.isCardClosed({}) && !K.isCardClosed(null), '잠금 판 — 잠겼고 나에게 안 열렸을 때만');
  ok(K.canLockCard({ cloudOn: true, isMine: true }) && !K.canLockCard({ cloudOn: true, isMine: false })
    && K.canLockCard({ cloudOn: false, author: '노준석', me: '노준석' }) && !K.canLockCard({ cloudOn: false, author: '', me: '' }), '자물쇠는 만든 사람에게만');
  ok(K.lockFormError('', '') === 'pw' && K.lockFormError('1', '2') === 'confirm' && K.lockFormError('12', '12') === null, '두 칸 — 비었으면 첫 칸 · 다르면 확인 칸');
  const t0 = 1_000_000;
  ok(K.allowTry([t0, t0, t0, t0], t0) && !K.allowTry([t0, t0, t0, t0, t0], t0 + 1) && K.allowTry([t0, t0, t0, t0, t0], t0 + K.LOCK_TRY_WINDOW_MS), '게스트 시도 제한 — 1분에 5회(서버와 같은 값)');
  ok(K.LOCK_TRY_LIMIT === 5 && K.LOCK_MOTION_MS === 420, '상수 — 5회 · 420ms');
  const sec = K.withSecret({ id: 'c', locked: true, content: '', aiSummary: '' }, { description: '본문', ai_summary: '요약' });
  ok(sec.lockedOpen && sec.content === '본문' && sec.aiSummary === '요약' && !K.withSecret({ id: 'c', locked: true, content: 'x' }, null).lockedOpen
    && K.withSecret({ id: 'c', locked: true, content: 'x' }, null).content === '', 'card_secrets 행이 오면 열림 · 안 오면 본문 없음');
  const dl = K.dropLocked({ cards: [{ id: 'a' }, { id: 'b', locked: true }], comments: [{ id: 'm1', card_id: 'a' }, { id: 'm2', card_id: 'b' }],
    files: [{ id: 'f1', card_id: 'b' }, { id: 'f2', card_id: null, service_id: 's' }] });
  ok(dl.cards.map(x => x.id).join() === 'a' && dl.comments.map(x => x.id).join() === 'm1' && dl.files.map(x => x.id).join() === 'f2' && dl.locked.has('b'), '서버 키 원본에서 잠긴 업무·댓글·첨부만 걷는다');
  const V = await import(new URL('../src/services/viewPw.js', import.meta.url).href);
  const g = await V.makeViewPw('1234');
  const { createHash } = await import('node:crypto');
  ok(createHash('sha256').update(g.view_pw_salt + '1234', 'utf8').digest('hex') === g.view_pw, '게스트 해시(viewPw)가 0099의 hex(sha256(소금‖비밀번호))와 같은 규칙');

  // 서버 키 경로 · 앱 배선
  const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const gather = rd('api/_wiki/gather.js');
  ok(/const open = dropLocked\(kept\);/.test(gather) && /updated_at, locked'\)/.test(gather) && /\.\.\.open\.locked\]\);/.test(gather), '위키 장: 잠긴 업무 몫을 걷고 그 id를 자주 묻는 질문 거르개에 더한다');
  const share = rd('api/share.js');
  ok(/select\('title, status, due_date, project_id, locked, projects\(visibility\)'\)/.test(share) && /if \(!data\.locked\) description = /.test(share), '공유 카드: 잠긴 업무는 제목만');
  const lead = rd('api/_leaders.js');
  ok(/export async function lockedCardIds\(db\)[\s\S]*?\.eq\('locked', true\)/.test(lead) && /rpc\('locked_hidden_ids'\)/.test(lead) && /export async function lockedOf/.test(lead), '서버 판정: 잠긴 업무 id · 묻는 사람에게 가린 id · 한 업무');
  const cs = rd('src/services/cloudSync.js');
  ok(/const secret = card\.locked \? await cloud\.getCardSecret\(cardId\)/.test(cs) && /withSecret\(cardToTask\(card\), secret\)/.test(cs), '카드 1건 다시 읽기(실시간·잠그고 풀 때)가 card_secrets까지 읽는다');
  ok(/cloud\.listCardSecrets\(\)\.catch/.test(cs) && /withSecret\(cardToTask\(card\), secretOf\.get\(card\.id\)\)/.test(cs), '첫 로드도 — 실패는 삼킨다(마이그레이션 전)');
  ok((cs.match(/previewOf\(cardId, /g) || []).length === 3, '알림 미리보기 셋(멘션·댓글·반응)이 잠긴 업무면 비운다');
  ok(/SECRET_COLS = 'card_id, description, ai_summary, subtasks'/.test(rd('src/services/cloud/board.js')), 'card_secrets는 해시 없이 네 칸만 고른다(하위 업무 0100)');
  // 0100 — 하위 업무도 card_secrets로 · 잠그는 순간 위키 블록·조각·알림 미리보기를 걷는다
  const m100 = rd('supabase/migrations/0100_card_lock_gaps.sql');
  ok(/subtasks = '\[\]'::jsonb\s*where id = c;\s*perform public\.scrub_locked_card\(c\);/.test(m100), '0100: 잠글 때 cards.subtasks를 비우고 위키·알림을 걷는다');
  ok(/before update of description, ai_summary, subtasks on public\.cards/.test(m100) && /new\.subtasks := old\.subtasks;/.test(m100), '0100: 거울 트리거가 하위 업무 쓰기도 card_secrets로 돌린다');
  ok(/subtasks = coalesce\(st, '\[\]'::jsonb\)/.test(m100), '0100: 풀면 하위 업무를 되돌린다');
  ok(/delete from public\.doc_vec where page_id = any \(pages\)/.test(m100) && /update public\.notifications set preview = null where card_id = c/.test(m100)
    && /before insert or update of preview, card_id on public\.notifications/.test(m100), '0100: 위키 조각·있던 알림 미리보기·새 알림 미리보기');
  ok(/revoke all on function public\.scrub_locked_card\(uuid\) from public, anon, authenticated;/.test(m100), '0100: 걷는 함수는 lock_card 안에서만');
  const sub = K.withSecret({ id: 'c', locked: true, subtasks: [] }, { description: '', subtasks: [{ title: '하위' }] });
  ok(sub.subtasks.length === 1 && K.withSecret({ id: 'c', locked: true, subtasks: [{ title: 'x' }] }, null).subtasks.length === 0, '여는 사람은 card_secrets 하위 업무 · 못 여는 사람은 빈 목록');
  ok(/if \(now\?\.locked\) now = await cloud\.getCardSecret\(task\.id\)/.test(cs), '잠긴 업무의 하위 업무 합치기는 card_secrets 목록과');
  ok(/select\('card_id, description, subtasks'\)/.test(rd('api/_wikiAsk.js')), '다붓이: 여는 사람의 기록에 잠긴 업무 하위 업무도');
  ok(/'Cache-Control', 'no-store'/.test(share), '공유 카드는 CDN에 두지 않는다(잠금·리더만 보기가 바로 걸리게)');
  const mo = rd('src/modals/modals.jsx');
  ok(/enabled: cloudMode && !!cardId && !closed/.test(mo), '같이 쓰기는 잠금 판이 걷힌 뒤에만 연다');
  ok(/if \(!cloudMode \|\| !task\.id \|\| closed\) return;/.test(mo) && /\}, \[cloudMode, task\.id, closed\]\);/.test(mo), '상세(댓글·활동)는 열린 뒤 그 자리에서 다시 읽는다');
  ok(/task\.id && isMine && <CardLockButton/.test(mo), '자물쇠 버튼은 만든 사람에게만');
  console.log(`PASS  0099 업무 잠금의 모양·판정·서버 키 경로·앱 배선 ${n}가지`);
}

// ── 0101 Supabase 점검(advisors) 보완 (2026-10-14) ─────────────────────────────────────────────
// 라이브 경계는 psql 리허설(ROLLBACK)로 봤다 — 승인 회원·관리자·익명이 정책 걸린 표 42개에서 보는 행 수가 적용 전후 같고,
// 권한을 걷은 트리거가 그대로 돈다(댓글 넣기). 승인 회원의 activity 최근 200개 401ms → 6ms. 여기는 파일 모양:
// 트리거 함수 12개 EXECUTE 회수 · reorder_clubs는 로그인한 사람만 · search_path 셋 · 정책은 alter만(116개)이고
// 그 안의 auth.*()·인자 없는 판정 함수는 모두 (select …)로 감쌌다(행마다가 아니라 쿼리마다 한 번).
// **되돌리기**(§3-5): 0101의 alter policy 하나에서 `(select is_approved())`를 `is_approved()`로 풀거나, 트리거 함수 하나를
// revoke 목록에서 빼면 아래가 깨진다.
{
  const m101 = readFileSync(new URL('../supabase/migrations/0101_advisor_fixes.sql', import.meta.url), 'utf8');
  const sql = m101.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const trig = ['blank_locked_preview', 'handle_new_user', 'keep_sun_guide_final', 'notifications_actor_name', 'notify_admins_on_signup', 'rls_auto_enable',
    'services_stamp_published', 'sync_pastor_team', 'sync_person_birthday', 'sync_person_teams', 'sync_profile_email', 'tg_recount_card'];
  const rev = sql.match(/revoke execute on function([\s\S]*?)from public, anon, authenticated;/)?.[1] ?? '';
  ok(trig.every(f => rev.includes(`public.${f}()`)), '0101: 트리거 함수 12개 모두 anon·authenticated EXECUTE 회수');
  ok(/revoke execute on function public\.reorder_clubs\(uuid\[\]\) from public, anon;\s*grant execute on function public\.reorder_clubs\(uuid\[\]\) to authenticated;/.test(sql), '0101: reorder_clubs는 로그인한 사람만');
  ok(['is_roster_team(text)', 'kst_year()', 'touch_last_seen()'].every(f => sql.includes(`alter function public.${f} set search_path = public, pg_temp;`)), '0101: search_path 셋');
  const alters = sql.match(/alter policy [\s\S]*?;\n/g) || [];
  ok(alters.length === 116 && !/create policy|drop policy/i.test(sql), '0101: 정책은 alter만 116개(수·이름·역할 그대로)');
  const bare = /(?<!select )(?<!SELECT )(auth\.(uid|role|jwt)|\b(is_approved|hidden_ids|effective_uid|is_admin|is_master|locked_hidden_ids|my_person_id|can_manage_sun|leads_any_sun|can_edit_service|can_check_all_attendance|is_leader|kst_year))\(\)/;
  const left = alters.filter(a => bare.test(a));
  ok(left.length === 0, `0101: 정책 안 판정 호출은 모두 (select …) — 맨 호출 남음: ${left.map(a => a.split('\n')[0]).join(', ')}`);
  console.log(`PASS  0101 점검 보완 — 트리거 함수 회수 · search_path · 정책 116개 판정 한 번씩 ${n}가지`);
}

// ── 0102 정책은 로그인한 사람에게만 · 판정 함수 14개 익명 회수 (2026-10-14 · advisors 후속) ──────────────────
// 라이브 경계는 psql 리허설(ROLLBACK)로 봤다 — 승인 회원·관리자가 표 42개에서 보는 행 수가 같고, 익명은 원래도 0행이던 것이
// 18개 표에서 '권한 오류' 대신 빈 결과가 된다(남은 둘은 표 권한 자체가 없는 card_secrets·card_unlocks). 로그인 뒤 rpc(is_admin ·
// is_master · is_approved · my_person_id)와 댓글 쓰기 그대로. 여기는 파일 모양: 정책은 대상 역할만 alter(108) · 14개 회수와 재부여.
// **되돌리기**(§3-5): 0102에서 alter policy 하나를 빼거나, 회수 목록에서 is_approved()를 빼면 아래가 깨진다.
{
  const m102 = readFileSync(new URL('../supabase/migrations/0102_policies_to_authenticated.sql', import.meta.url), 'utf8');
  const sql = m102.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const fns = ['can_check_all_attendance()', 'can_edit_meeting(uuid)', 'can_edit_service()', 'can_manage_sun()', 'has_role(text)', 'is_admin()', 'is_approved()',
    'is_master()', 'is_officer()', 'is_pastor()', 'leads_any_sun()', 'leads_sun_of(uuid)', 'my_person_id()', 'same_sun(uuid)'];
  const rev = sql.match(/revoke execute on function([\s\S]*?)from public, anon;/)?.[1] ?? '';
  const gra = sql.match(/grant execute on function([\s\S]*?)to authenticated, service_role;/)?.[1] ?? '';
  ok(fns.every(f => rev.includes(`public.${f}`)), '0102: 판정 함수 14개 public·anon 회수');
  ok(fns.every(f => gra.includes(`public.${f}`)), '0102: 같은 14개를 authenticated·service_role에 다시 준다');
  const alters = sql.match(/alter policy .*;/g) || [];
  ok(alters.length === 108 && alters.every(a => / on public\.\w+ to authenticated;$/.test(a)), '0102: 정책 108개는 대상 역할만 authenticated로');
  ok(!/create policy|drop policy|using \(|with check \(/i.test(sql), '0102: 정책 식·수는 그대로(§6-31-a)');
  console.log(`PASS  0102 정책은 로그인한 사람에게만 · 판정 함수 익명 회수 ${n}가지`);
}

// ── v5 1묶음 합치기(2026-10-17) — 마이그레이션 사슬 0104 → 0110 · 함수마다 '마지막 정의'가 모든 갈래를 갖는가 ──────────────
// 0104(휴지통) · 0105(직접 선택) · 0110(지난해 리더)이 hidden_ids·can_see_project·projects 판정을 각자 다시 썼다. 번호 차례로 적용하면
// 뒤 파일이 이긴다 — 뒤 파일이 앞 갈래를 안 안고 가면 휴지통 업무의 댓글·첨부가 도로 보인다(PITFALLS 61-b).
// 여기는 파일 모양만(행 수는 레포 밖 리허설 SQL · PGlite). **되돌리기**: 0105 hidden_ids의 휴지통 줄(`deleted_at is not null`)을 지우면
// '0105 hidden_ids', 0105 trash_list의 can_see_project를 0104 식으로 되돌리면 '휴지통 줄', 0110 project_audiences를 지우면 '받는 사람',
// RichText에 지역 seeable을 되살리면 '업무 링크' 단정이 깨진다.
{
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const strip = (t) => t.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const sqlOf = new Map(files.map(f => [f, strip(readFileSync(new URL(f, dir), 'utf8'))]));
  // 함수 이름 → [파일, 몸통] — 번호 차례로 훑어 마지막 create or replace
  const lastDef = (name) => {
    let hit = [null, ''];
    for (const f of files) {
      const re = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$`, 'gi');
      for (const m of sqlOf.get(f).matchAll(re)) hit = [f, m[2]];
    }
    return hit;
  };
  const policyLast = (name) => {
    let hit = [null, ''];
    for (const f of files) {
      const re = new RegExp(`(?:alter|create) policy ${name} on public\\.projects[\\s\\S]*?;\\n`, 'gi');
      for (const m of sqlOf.get(f).matchAll(re)) hit = [f, m[0]];
    }
    return hit;
  };
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const b05 = sqlOf.get('0105_project_viewers.sql').match(/create or replace function public\.hidden_ids\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] || '';
  ok(/deleted_at is not null/.test(b05) && /'custom'/.test(b05) && /'leaders'/.test(b05), '0105 hidden_ids는 0104 몸통(휴지통) 위에 custom을 더한다');
  const [hf, hb] = lastDef('hidden_ids');
  ok(hf === '0110_past_year_leaders.sql' && /deleted_at is not null/.test(hb) && /'custom'/.test(hb) && /leader_hidden_project_ids\(\)/.test(hb),
    `hidden_ids 마지막 정의(${hf})가 휴지통 · custom · 리더(연도) 갈래를 다 갖는다`);
  const [cf, cb] = lastDef('can_see_project');
  ok(cf === '0110_past_year_leaders.sql' && /'custom'/.test(cb) && /is_project_viewer/.test(cb) && /my_leader_years\(\)/.test(cb), `can_see_project 마지막 정의(${cf}) — custom · 연도`);
  const [kf, kb] = lastDef('can_see_card');
  ok(kf === '0105_project_viewers.sql' && /can_see_project\(k\.project_id\)/.test(kb), `can_see_card 마지막 정의(${kf})는 can_see_project를 불러 뒤 갈래를 따라간다`);
  for (const fn of ['trash_project', 'restore_card', 'restore_project', 'trash_list']) {
    const [tf, tb] = lastDef(fn);
    ok(tf === '0105_project_viewers.sql' && /can_see_project\(/.test(tb) && !/visibility <> 'leaders'|visibility = 'leaders'/.test(tb),
      `${fn} 마지막 정의(${tf})는 can_see_project 하나로 본다(휴지통 줄에 직접 선택 제목이 새지 않게)`);
  }
  const [af, ab] = lastDef('project_audiences');
  ok(af === '0110_past_year_leaders.sql' && /leader_profile_ids_for\(pj\.year\)/.test(ab) && /project_viewers/.test(ab), `project_audiences 마지막 정의(${af}) — 리더 프로젝트에 그해 리더 · custom 그대로`);
  for (const p of ['projects_select', 'projects_update']) {
    const [pf, pb] = policyLast(p);
    ok(pf === '0110_past_year_leaders.sql' && /deleted_at IS NULL/.test(pb) && /my_leader_years/.test(pb), `${p} 마지막(${pf}) — 휴지통 · 연도`);
  }
  const [df, db] = policyLast('projects_delete');
  ok(df === '0110_past_year_leaders.sql' && /my_leader_years/.test(db), `projects_delete 마지막(${df}) — 연도(옛 앱의 행 삭제 길은 그대로)`);
  const [gf, gb] = policyLast('projects_custom_guard');
  ok(gf === '0105_project_viewers.sql' && /as restrictive/i.test(gb), 'projects_custom_guard(0105 restrictive)는 뒤 파일이 건드리지 않는다');
  // 앱 — 업무 링크 칩·카드는 visibility.canSeeProject 한 곳 · 복원 실패는 두 도막(사용자 결정 2026-10-17)
  const rt = readFileSync(new URL('../src/components/RichText.jsx', import.meta.url), 'utf8');
  ok(/import \{ canSeeProject \} from '\.\.\/services\/visibility\.js';/.test(rt) && !/const seeable/.test(rt) && (rt.match(/!canSeeProject\(project\)/g) || []).length === 2,
    '업무 링크: RichText는 visibility.canSeeProject로 본다(지역 판정 없음)');
  const V = await import(new URL('../src/services/visibility.js', import.meta.url).href);
  ok(V.canSeeProject({ id: 'p' }) === true && V.canSeeProject(undefined) === false, 'canSeeProject: 스토어에 있으면 보인다');
  ok([...V.leaderAudience(new Set(['a']), new Set(['b']))].join() === 'a,b' && V.leaderAudience(new Set(['a']), null).size === 1, 'leaderAudience: 올해 리더 ∪ 그 프로젝트 몫');
  const tr = readFileSync(new URL('../src/components/trash.jsx', import.meta.url), 'utf8');
  ok(/showToast\(failText\('복원하지 못했어요', e\)\)/.test(tr), '복원 실패 토스트는 앞도막 + 이유(failText)');
  console.log(`PASS  v5 1묶음 합치기 — 마이그레이션 사슬 0104→0110 마지막 정의 · 업무 링크 판정 · 복원 실패 문구 ${n}가지`);
}

// ── 비밀번호 칸은 SecretInput 한 벌 (PITFALLS 64 · 사용자 피드백 2026-10-18) ──────────────────
// type="password"면 브라우저·비밀번호 관리자가 강력한 비밀번호 제안·저장·자동 채우기를 띄운다. src 전체에서
// type="password"는 SecretInput.jsx의 대비(그 CSS를 모르는 브라우저) 하나뿐이고, '비밀번호' 칸은 전부 SecretInput이다.
// 되돌리기 검사: 아무 칸을 <input type="password">로 되돌리면 첫 단정이, SecretInput의 관리자 무시 표시를 지우면 둘째가 깨진다.
{
  const { readdirSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const walk = (d) => readdirSync(d).flatMap(f => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
  const files = walk(fileURLToPath(new URL('../src', import.meta.url)).replace(/\\/g, '/'));
  const relOf = (f) => f.slice(f.lastIndexOf('/src/') + 1);
  const bad = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''); // 주석 줄은 빼고
    const rel = relOf(f);
    if (rel === 'src/components/SecretInput.jsx') { if (!/masked && !MASK_OK \? 'password' : 'text'/.test(t)) bad.push(rel + ' 대비 줄'); continue; }
    const hits = (t.match(/type=(?:"password"|'password'|\{['"]password['"]\})|\?\s*'password'/g) || []).length;
    if (hits) bad.push(`${rel} type=password ${hits}`);
    // '비밀번호' 이름표·placeholder를 단 <input>이 남았으면 SecretInput을 안 지난 칸이다
    for (const m of t.matchAll(/<input\b[^>]*>/gs)) if (/비밀번호|new-password|current-password/.test(m[0])) bad.push(`${rel} <input> ${m[0].slice(0, 60)}`);
  }
  assert.deepStrictEqual(bad, [], '비밀번호 칸은 SecretInput만 쓴다');
  const si = readFileSync(new URL('../src/components/SecretInput.jsx', import.meta.url), 'utf8');
  for (const a of ['autoComplete="off"', 'autoCorrect="off"', 'autoCapitalize="off"', 'spellCheck={false}', 'data-1p-ignore', 'data-lpignore="true"', 'data-bwignore', 'data-form-type="other"', "WebkitTextSecurity: 'disc'", "CSS.supports?.('-webkit-text-security', 'disc')"])
    assert.ok(si.includes(a), `SecretInput: ${a}`);
  assert.ok(!/\s(name|id)=/.test(si), 'SecretInput: name/id를 달지 않는다(관리자가 열쇠로 삼지 않게)');
  const used = files.filter(f => /^\s*<SecretInput\b/m.test(readFileSync(f, 'utf8'))).map(relOf).sort();
  assert.deepStrictEqual(used, ['src/components/DocEmbed.jsx', 'src/components/cardLock.jsx', 'src/components/links.jsx', 'src/modals/attachments.jsx'], '쓰는 자리 넷');
  // 넘기는 값은 누른 글쇠(type=password가 하던 한글 입력기 끄기를 대신한다)
  const { secretKeys, matchSecret } = await import(new URL('../src/services/secretKeys.js', import.meta.url).href);
  assert.strictEqual(secretKeys('ㅂㅈㄷㄱ'), 'qwer', '홀자모');
  assert.strictEqual(secretKeys('사랑1234'), 'tkfkd1234', '음절 + 숫자');
  assert.strictEqual(secretKeys('왜 값'), 'dho rkqt', '겹모음 · 겹받침');
  assert.strictEqual(secretKeys('ㄲㅒ쌰'), 'ROTi', '쌍자음 · Shift 모음');
  assert.strictEqual(secretKeys('abc!@#'), 'abc!@#', '영문·기호는 그대로');
  assert.strictEqual(secretKeys('사'), 'tk', 'NFD(맥)도 같은 값');
  const seen = [];
  const chk = (want) => async (v) => { seen.push(v); return v === want; };
  assert.strictEqual(await matchSecret(chk('tkfkd'), 'tkfkd', '사랑'), true, '글쇠로 맞으면 한 번');
  assert.strictEqual(seen.length, 1);
  seen.length = 0;
  assert.strictEqual(await matchSecret(chk('사랑'), 'tkfkd', '사랑'), true, '예전 한글 비밀번호는 원래 글자로 한 번 더');
  assert.deepStrictEqual(seen, ['tkfkd', '사랑']);
  seen.length = 0;
  assert.strictEqual(await matchSecret(chk('x'), 'abc', 'abc'), false, '영문만이면 두 번 묻지 않는다(1분 5회를 아낀다)');
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(await matchSecret(async () => undefined, 'a', 'ㅁ'), undefined, '틀림(false)이 아닌 답은 그대로');
  console.log('PASS  비밀번호 칸 — type=password 없음 · SecretInput 한 벌(넷) · 관리자 무시 표시 · 누른 글쇠');
}

// ── 0112 행사 일정 — 마이그레이션 모양(읽기 승인 전원 · 쓰기 리더진 + 마스터 · 내 달력 줄은 서버만) · 행사 내 달력 .ics ──────────
// 라이브 경계는 psql 리허설(ROLLBACK)로 봤다(순원 insert·save_event 42501 · 순원 delete/update 0행 · 리더·마스터 save_event · 익명 42501 ·
// 서버 키 upsert · 본인 줄만 읽힘). 여기는 파일 모양과 api/ics.js의 행사 갈래를 가짜 DB로 끝까지 돌린다.
// **되돌리기**(§3-5): save_event의 `if not (public.is_leader() or public.is_master())` 줄을 지우면 ②가, api/ics.js feedGet의 eventSig 갈래를
// 지우면 ⑥이, events.eventFeedEvent의 다음 날을 종료일 그대로 두면 ⑦이, POST의 '있는 행사만 남기기'를 빼면 ⑨가 깨진다.
{
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const m = readFileSync(new URL('../supabase/migrations/0112_events.sql', import.meta.url), 'utf8');
  const sql = m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
  const pols = sql.match(/create policy [\s\S]*?;/g) || [];
  const W = '(select public.is_leader()) or (select public.is_master())';
  ok(pols.length === 9 && pols.every(p => / to authenticated\b/.test(p)), '① 정책 아홉 · 전부 to authenticated');
  ok(['events', 'event_tasks'].every(t => pols.some(p => p.startsWith(`create policy ${t}_select on public.${t} for select`) && p.includes('using ((select public.is_approved()))'))),
    '① 읽기는 승인된 사람 모두(events · event_tasks)');
  ok(['events', 'event_tasks'].every(t => ['insert', 'update', 'delete'].every(c => pols.some(p => p.startsWith(`create policy ${t}_${c} on public.${t} for ${c}`) && p.includes(W)))),
    '① 쓰기 셋은 리더진 + 마스터');
  ok(pols.filter(p => p.includes('public.event_feeds')).length === 1 && /event_feeds_select[\s\S]*owner = \(select public\.effective_uid\(\)\)/.test(sql)
    && /revoke insert, update, delete on public\.event_feeds from authenticated;/.test(sql), '① 내 달력 줄은 본인 읽기 하나 · 쓰기는 서버만(권한부터 닫음)');
  const fn = sql.match(/create or replace function public\.save_event\([\s\S]*?end \$\$;/)?.[0] || '';
  ok(/security definer set search_path = public, pg_temp/.test(fn) && /if not \(public\.is_leader\(\) or public\.is_master\(\)\) then\s+raise exception [^;]*errcode = '42501'/.test(fn),
    '② save_event는 definer이고 첫 줄에서 리더진 + 마스터를 본다');
  ok(/delete from public\.event_tasks where event_id = r\.id;/.test(fn) && /where exists \(select 1 from public\.cards c where c\.id = x\.id\)/.test(fn),
    '② 관련 업무는 통째로 갈아 끼우고 있는 업무만');
  ok(/revoke all on function public\.save_event\([^)]*\) from public, anon;/.test(sql), '② save_event 익명 회수');
  ok(/on delete cascade,\s+card_id\s+uuid not null references public\.cards\(id\) on delete cascade/.test(sql), '③ 관련 업무는 행사·업무 어느 쪽이 지워져도 따라간다');
  const E = await import(new URL('../src/services/events.js', import.meta.url).href);
  const kinds = (sql.match(/kind in \(([^)]*)\)/)?.[1].match(/'(\w+)'/g) || []).map(s => s.slice(1, -1));
  ok(JSON.stringify(kinds) === JSON.stringify(E.EVENT_KINDS.map(k => k.key)), '④ DB 종류 CHECK = 앱 종류(예배 · 행사 · 수련회 차례)');
  ok(/array\['events', 'event_tasks'\]/.test(sql) && !/event_feeds'\]/.test(sql), '⑤ 실시간 발행은 events · event_tasks(내 달력 줄은 밖)');
  const live = readFileSync(new URL('../src/services/liveV2.js', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/services/eventStore.js', import.meta.url), 'utf8');
  ok(/events:\s+\['events'\],\s+event_tasks:\s+\['events'\],/.test(live) && /const CACHE_KEY = 'events:list';/.test(store) && /useLiveRefresh\('events',/.test(store),
    '⑤ 앱은 liveV2의 events 신호로 목록 한 벌을 다시 읽는다');
  ok(/rpc\('save_event', saveEventArgs\(ev\)\)/.test(readSplit('src/services/cloud.js')), '⑤ 저장은 save_event 한 번(행사 + 관련 업무)');

  // ── api/ics.js 행사 갈래 — 가짜 DB(_lib의 adminClient만 바꿔 끼운다)로 끝까지 ──
  process.env.SUPABASE_SECRET_KEY ||= 'test-secret';
  const dir = mkdtempSync(join(tmpdir(), 'lc-ics-'));
  const real = (rel) => pathToFileURL(fileURLToPath(new URL(`../${rel}`, import.meta.url))).href;
  writeFileSync(join(dir, 'fake_lib.mjs'), `export * from '${real('api/_lib.js')}';
export const adminClient = () => globalThis.__fakeDb;
export const requireApprovedUser = async () => globalThis.__fakeUser;
export const readJson = async (req) => req.body;
`);
  const icsRaw = readFileSync(new URL('../api/ics.js', import.meta.url), 'utf8');
  const icsSrc = icsRaw
    .replace("from './_lib.js'", `from '${pathToFileURL(join(dir, 'fake_lib.mjs')).href}'`)
    .replace(/from '\.\/(_\w+\.js)'/g, (_, f) => `from '${real(`api/${f}`)}'`)
    .replace(/from '\.\.\/src\/([^']+)'/g, (_, f) => `from '${real(`src/${f}`)}'`);
  writeFileSync(join(dir, 'ics.mjs'), icsSrc);
  const ics = await import(pathToFileURL(join(dir, 'ics.mjs')).href);
  const fakeDb = (tables) => ({
    from(table) {
      const filters = []; let one = false; let up = null;
      const b = {
        select: () => b, order: () => b,
        eq: (c, v) => { filters.push(r => r[c] === v); return b; },
        in: (c, vs) => { filters.push(r => vs.includes(r[c])); return b; },
        ilike: (c, v) => { filters.push(r => String(r[c] || '').toLowerCase() === String(v).toLowerCase()); return b; },
        maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
        upsert: (row, { onConflict }) => { up = { row, key: onConflict }; return b; },
        then(res, rej) {
          const t = (tables[table] ||= []);
          let data;
          if (up) {
            let ex = t.find(r => r[up.key] === up.row[up.key]);
            if (ex) Object.assign(ex, up.row); else { ex = { id: '00000000-0000-4000-8000-00000000f00d', ...up.row }; t.push(ex); }
            data = ex;
          } else {
            const out = t.filter(r => filters.every(f => f(r)));
            data = one ? (out[0] ?? null) : out;
          }
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return b;
    },
  });
  const fakeRes = () => {
    const r = { code: 0, headers: {}, body: undefined };
    r.status = (c) => { r.code = c; return r; };
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
    r.json = (o) => { r.body = o; return r; };
    r.end = (b) => { r.body = b; return r; };
    return r;
  };
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const FEED = '22222222-2222-4222-8222-222222222222';
  const [E1, E2, E3, GONE] = ['a', 'b', 'c', 'd'].map(c => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
  const tables = () => ({
    profiles: [{ id: OWNER, approved: true, merged_into: null, email: 'o@x' }],
    admins: [],
    events: [
      { id: E1, title: '2026 겨울 수련회', start_date: '2026-12-28', end_date: '2026-12-30', place: '양평 수양관', memo: '신청은 12월 13일까지' },
      { id: E2, title: '성탄 예배', start_date: '2026-12-25', end_date: '2026-12-25', place: '', memo: '' },
      { id: E3, title: '고르지 않은 행사', start_date: '2026-12-31', end_date: '2026-12-31', place: '', memo: '' },
    ],
    event_feeds: [{ id: FEED, owner: OWNER, event_ids: [E1, E2, GONE] }],
    calendar_feeds: [],
  });
  const get = async (db, f, sig) => {
    globalThis.__fakeDb = fakeDb(db);
    const res = fakeRes();
    await ics.default({ method: 'GET', query: { f, sig: `${sig}.ics` }, headers: { host: 'x.app' } }, res);
    return res;
  };
  ok(ics.eventSig(FEED) !== ics.calSig(FEED) && /`calev:\$\{process\.env\.SUPABASE_SECRET_KEY/.test(icsRaw), '⑥ 행사 피드 서명은 calev: 접두(프로젝트 cal:와 다른 열쇠)');
  const r1 = await get(tables(), FEED, ics.eventSig(FEED));
  ok(r1.code === 200 && /^text\/calendar/.test(r1.headers['content-type'] || ''), '⑥ 서명이 맞으면 text/calendar');
  const body = String(r1.body).replace(/\r\n /g, '');
  const vevents = body.split('BEGIN:VEVENT').slice(1);
  ok(vevents.length === 2 && body.includes('SUMMARY:2026 겨울 수련회') && body.includes('SUMMARY:성탄 예배') && !body.includes('고르지 않은 행사'),
    '⑥ 고른 것 중 남아 있는 것만(지운 행사 id는 저절로 빠진다)');
  ok(body.includes('DTSTART;VALUE=DATE:20261228') && body.includes('DTEND;VALUE=DATE:20261231')
    && body.includes('DTSTART;VALUE=DATE:20261225') && body.includes('DTEND;VALUE=DATE:20261226'), '⑦ 하루 종일 · DTEND = 종료일 다음 날');
  ok(body.includes('LOCATION:양평 수양관') && body.includes('UID:event-') && body.includes(`X-WR-CALNAME:${E.EVENT_FEED_NAME}`), '⑦ 장소 · 고유 id · 달력 이름');
  ok((await get(tables(), FEED, ics.calSig(FEED))).code === 404, '⑥ 프로젝트 서명으로는 행사 줄이 안 열린다');
  ok((await get(tables(), FEED, ics.eventSig(E1))).code === 404, '⑥ 다른 id의 서명은 404');
  const off = tables(); off.profiles[0].approved = false;
  ok((await get(off, FEED, ics.eventSig(FEED))).code === 404, '⑧ 주인이 승인에서 빠지면 주소가 닫힌다');
  // POST — 있는 행사만 남겨 owner 한 줄 upsert → 주소
  const post = async (db, b) => {
    globalThis.__fakeDb = fakeDb(db); globalThis.__fakeUser = { id: OWNER };
    const res = fakeRes();
    await ics.default({ method: 'POST', body: b, headers: { host: 'x.app', 'x-forwarded-proto': 'https' } }, res);
    return res;
  };
  const db2 = tables(); db2.event_feeds = [];
  const p1 = await post(db2, { eventFeed: true });
  ok(p1.code === 200 && p1.body.events === null, '⑨ 줄이 없으면 { events: null }');
  const p2 = await post(db2, { eventFeed: true, events: [E1, GONE, E1, E3] });
  ok(p2.code === 200 && JSON.stringify(p2.body.events) === JSON.stringify([E1, E3]) && db2.event_feeds.length === 1
    && p2.body.url === `https://x.app/cal/${db2.event_feeds[0].id}/${ics.eventSig(db2.event_feeds[0].id)}.ics` && p2.body.webcal.startsWith('webcal://x.app/cal/'),
    '⑨ 있는 행사만 · 겹침 없이 · owner 한 줄 · 행사 서명 주소');
  const p3 = await post(db2, { eventFeed: true, events: [E2] });
  ok(db2.event_feeds.length === 1 && JSON.stringify(p3.body.events) === JSON.stringify([E2]), '⑨ 다시 보내면 같은 줄을 고른 것 전체로 덮는다(다른 달 것도 화면이 같이 보낸다)');
  ok((await post(db2, { eventFeed: true, events: ['x'] })).code === 400, '⑨ id가 아닌 값은 400');
  console.log(`PASS  0112 행사 일정 — 정책(읽기 승인 · 쓰기 리더진 + 마스터) · save_event · 실시간 · 행사 내 달력 서명·.ics·저장 ${n}가지`);
}
