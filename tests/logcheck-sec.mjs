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
  assert.ok(/from\('projects'\)\.select\('name'\)/.test(src),
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
  assert.ok(!/\+ 링크|참고 링크/.test(att + modals), "업무 창에 '+ 링크'·'참고 링크'가 있다");
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
  assert.ok(/approved === null\) return <div className="h-dvh bg-canvas"/.test(app),
    '아직 모르는 동안에는 승인 대기가 아니라 빈 화면이다');
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

