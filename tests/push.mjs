// 알림 확장(assign·due_soon) + 웹 푸시. 브라우저 없이 순수 로직만 본다.
// 이 경로는 게스트 모드로 돌지 않는다(로그인·서버리스 함수가 필요) — assignees.mjs와
// 같은 방식으로 cloud.js를 가짜로 바꿔치고 cloudSync만 노드에서 돌린다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');
const notify = await import('file://' + join(ROOT, 'src', 'services', 'notifyText.js').replace(/\\/g, '/'));
const api = await import('file://' + join(ROOT, 'api', 'push.js').replace(/\\/g, '/'));

// ── 문구 ────────────────────────────────────────────────────────────────────
// 푸시 제목과 앱 안 알림이 같은 함수를 본다. 갈라지면 같은 알림이 두 군데서 다르게 읽힌다.
assert.equal(notify.notifLine('mention', '노준석'), '노준석님이 나를 멘션했어요');
assert.equal(notify.notifLine('reply', '노준석'), '노준석님이 내 댓글에 답글을 남겼어요');
assert.equal(notify.notifLine('assign', '노준석'), '노준석님이 나를 담당자로 지정했어요');
// 댓글 반응(0032). 종류(좋아요·최고·확인)는 문구에 넣지 않는다 — 목록이
// "최고를 눌렀어요"처럼 읽히고, 어느 것인지는 댓글을 열면 보인다.
assert.equal(notify.notifLine('reaction', '노준석'), '노준석님이 내 댓글에 반응을 남겼어요');
assert.ok(!notify.isSystemNotif('reaction'), '반응은 사람이 만드는 알림이다');
// due_soon은 배치가 만든다 → '누가'가 없다. 이름이 섞여 들어가면 안 된다.
assert.equal(notify.notifLine('due_soon', '더다붓'), '마감이 다가왔어요');
assert.ok(notify.isSystemNotif('due_soon') && !notify.isSystemNotif('assign'));
// 모르는 종류는 멘션 문구로 떨어진다(DB에 새 kind가 먼저 들어가도 화면이 비지 않게)
assert.equal(notify.notifLine('무언가', '노준석'), '노준석님이 나를 멘션했어요');

// ── 마감 임박 배치의 날짜 (KST) ─────────────────────────────────────────────
// 크론은 22:00 UTC에 돈다. 그 시각은 이미 다음 날 07:00 KST이므로 UTC 날짜를
// 그대로 쓰면 "오늘 마감"이 하루씩 어긋난다.
const cronFire = Date.parse('2026-07-29T22:00:00Z');
assert.equal(api.kstDate(0, cronFire), '2026-07-30', '22:00 UTC는 KST로 다음 날이다');
assert.equal(api.kstDate(1, cronFire), '2026-07-31', '내일은 KST 기준 다음 날');
// 낮에 손으로 부를 때도 맞아야 한다
assert.equal(api.kstDate(0, Date.parse('2026-07-29T03:00:00Z')), '2026-07-29');
// KST 자정 직후 = 전날 15:00 UTC
assert.equal(api.kstDate(0, Date.parse('2026-07-29T15:00:00Z')), '2026-07-30');

// ── 딥링크 ──────────────────────────────────────────────────────────────────
assert.equal(api.deepLink('p1', 'c1'), '/?p=p1&t=c1');
assert.equal(api.deepLink(null, 'c1'), '/?t=c1');
assert.equal(api.deepLink(null, null), '/');

// ── cloud.js 문장 모양 ──────────────────────────────────────────────────────
// insertNotifications에 .select()를 붙이면 RLS로 insert까지 롤백되어 알림이 한 건도
// 생기지 않는다(HANDOFF §5의 27번 — 실제로 그렇게 멘션 알림이 죽어 있었다).
const cloudSrc = readFileSync(join(ROOT, 'src', 'services', 'cloud.js'), 'utf8');
const notifBody = cloudSrc.slice(cloudSrc.indexOf('export async function insertNotifications'));
const insertStmt = notifBody.slice(0, notifBody.indexOf('\n}'));
assert.ok(/from\('notifications'\)\.insert\(rows\)/.test(insertStmt), 'notifications insert 문장을 찾지 못했다');
assert.ok(!/\.insert\(rows\)[\s\S]{0,40}\.select\(/.test(insertStmt), 'insert에 .select()를 붙이면 RLS로 롤백된다');
// 같은 기기가 다시 구독할 때 깨지지 않아야 한다 → endpoint 기준 upsert
const subBody = cloudSrc.slice(cloudSrc.indexOf('export async function savePushSubscription'));
assert.ok(/\.upsert\(/.test(subBody.slice(0, 900)), 'push_subscriptions는 upsert로 넣는다');
assert.ok(/onConflict:\s*'endpoint'/.test(subBody.slice(0, 900)), 'onConflict는 endpoint여야 한다');
// 알림 만들기와 푸시가 한 경로에 있어야 한다 — 갈라지면 한쪽만 도는 경로가 생긴다
assert.ok(/requestPush\(ids/.test(insertStmt), '알림을 넣은 자리에서 푸시도 보내야 한다');

// ── newAssigneesOnly (cloudSync) ────────────────────────────────────────────
// cloud.js를 가짜로 바꿔치고 cloudSync만 돌린다(assignees.mjs와 같은 패턴).
const SRC = join(ROOT, 'src', 'services', 'cloudSync.js');
const patched = readFileSync(SRC, 'utf8')
  .replace(/import \* as cloud from '\.\/cloud\.js';/, 'const cloud = globalThis.__CLOUD;')
  .replace(/import \{ statusToDb, statusFromDb \} from '\.\/cloud\.js';/,
    `const statusToDb = () => 'todo'; const statusFromDb = () => '시작 전';`)
  // utils는 진짜 파일을 절대 경로로 문다(assignees.mjs와 같은 이유 — 가짜로 다시
  // 적으면 cloudSync가 utils에서 가져오는 이름이 늘 때마다 여기가 같이 깨진다)
  .replace(/import (\{[^}]*\}) from '\.\.\/utils\.js';/,
    (m, names) => `import ${names} from '${pathToFileURL(join(ROOT, 'src', 'utils.js')).href}';`);

const PROFILES = [
  { id: 'u1', display_name: '노준석' },
  { id: 'u2', display_name: '조준환' },
  { id: 'u3', display_name: '천진영' },
];
const notified = [];
globalThis.__CLOUD = {
  withClockSkewRetry: (fn) => fn(),
  listRecentActivity: async () => [],   // 대시보드 피드(0020) — 이 스위트의 관심사가 아니다
  listTeams: async () => [],
  listProfiles: async () => PROFILES,
  listProjects: async () => [{ id: 'p1', name: '2026 하계 수련회' }],
  listAllCards: async () => [],
  listAllLinks: async () => [],
  listAllFiles: async () => [],
  getMyProfile: async () => PROFILES[0],
  // 로그인한 사람은 노준석(u1)
  getSession: async () => ({ session: { user: { id: 'u1' } }, user: { id: 'u1' } }),
  listProfileTeams: async () => [],
  insertNotifications: async (ids, meta) => { notified.push({ ids, meta }); return ids.length; },
  // 업무 창 상세(§6-20). 반응 조회는 아래에서 일부러 던지게 두어, 표가 아직 없는
  // 환경(마이그레이션 0032 적용 전)에서도 댓글·활동이 뜨는지 본다.
  listComments: async () => [{ id: 'cm1', card_id: 'c1', author_id: 'u2', body: '확인했습니다', created_at: '2026-08-30T00:00:00Z' }],
  listCardActivity: async () => [],
  listCardReactions: async () => { throw new Error('relation "comment_reactions" does not exist'); },
};

const dir = mkdtempSync(join(tmpdir(), 'push-'));
const file = join(dir, 'cloudSync.mjs');
writeFileSync(file, patched);
const sync = await import('file://' + file.replace(/\\/g, '/'));
await sync.loadCloudState(); // 이름 → 프로필 id 맵 프라이밍

const only = (next, prev) => sync.newAssigneesOnly(next, prev, '노준석');

// 새 카드(이전 값이 없음)는 담당자 전원이 '새로 붙은' 것이다
assert.deepStrictEqual(only(['조준환', '천진영'], undefined), ['u2', 'u3']);
// 그대로 다시 저장하면 아무에게도 안 간다 — 하위 업무 체크처럼 저장이 자주 불리는
// 경로가 있어서, 여기가 틀리면 같은 사람에게 매번 알림이 다시 간다
assert.deepStrictEqual(only(['조준환', '천진영'], ['조준환', '천진영']), []);
// 한 명 추가 → 그 한 명만
assert.deepStrictEqual(only(['조준환', '천진영'], ['조준환']), ['u3']);
// 빼는 것은 알림이 아니다
assert.deepStrictEqual(only(['조준환'], ['조준환', '천진영']), []);
// 내가 나를 담당자로 넣어도 알림 없음
assert.deepStrictEqual(only(['노준석'], []), []);
// 프로필에 없는 이름(오타·미가입자)은 받을 계정이 없다
assert.deepStrictEqual(only(['없는사람'], []), []);

// notifyAssignees는 kind='assign'으로 넣고, 본인은 최종적으로 걸러낸다
await sync.notifyAssignees(['u2', 'u1'], { actorName: '노준석', cardId: 'c1', projectId: 'p1', preview: '콘티 확정' });
assert.equal(notified.length, 1);
assert.deepStrictEqual(notified[0].ids, ['u2'], '본인(u1)에게는 보내지 않는다');
assert.equal(notified[0].meta.kind, 'assign');
assert.equal(notified[0].meta.preview, '콘티 확정');

// 내 댓글에 내가 답글을 달면 나에게는 알림이 오지 않는다.
// 이게 원래 버그다 — myUserId()가 cloud.getSession()의 결과를 한 겹 더 벗기고 있어서
// 언제나 null이었고, 본인 제외가 한 번도 걸리지 않았다. 멘션은 이름으로도 걸러서
// 증상이 가려졌지만 답글은 그대로 나에게 왔다.
notified.length = 0;
await sync.notifyComment('고마워요', { actorName: '노준석', cardId: 'c1', projectId: 'p1', replyToName: '노준석' });
assert.deepStrictEqual(notified, [], '내 댓글에 내가 답글을 달면 알림 없음');
// 남의 댓글에 답글이면 그 사람에게 간다
await sync.notifyComment('확인했어요', { actorName: '노준석', cardId: 'c1', projectId: 'p1', replyToName: '조준환' });
assert.equal(notified.length, 1);
assert.deepStrictEqual(notified[0].ids, ['u2']);
assert.equal(notified[0].meta.kind, 'reply');

// ── 댓글 반응 (0032) ────────────────────────────────────────────────────────
// 토글 판정은 순수 함수다. **이름이 아니라 auth user id로 가른다** — 이름으로
// 판정하면 동명이인이 서로의 반응을 자기 것으로 본다.
{
  const me = { userId: 'u1', name: '노준석' };
  const other = { kind: 'heart', userId: 'u2', name: '조준환' };
  // 처음 누르면 켜진다
  let list = sync.toggleReaction([other], 'heart', me);
  assert.equal(list.length, 2);
  // 같은 종류를 다시 누르면 취소 — 남의 것은 그대로 남는다
  list = sync.toggleReaction(list, 'heart', me);
  assert.deepStrictEqual(list, [other], '다시 누르면 내 것만 빠진다');
  // 세 종류를 모두 누를 수 있다
  let three = [];
  for (const k of sync.REACTION_KINDS) three = sync.toggleReaction(three, k, me);
  assert.deepStrictEqual(three.map(r => r.kind), ['heart', 'thumbsup', 'check']);
  // 모르는 종류는 아무 일도 하지 않는다(DB 체크 제약이 막는 값이 화면에서 먼저 걸린다)
  assert.strictEqual(sync.toggleReaction(three, 'fire', me), three);
  // 로그인 전(userId 없음)에는 아무것도 담지 않는다 — 주인 없는 반응이 생기면 안 된다
  assert.strictEqual(sync.toggleReaction(three, 'heart', { userId: '' }), three);

  const sum = sync.reactionSummary(three.concat(other), 'u1');
  assert.deepStrictEqual(sum.map(s => [s.kind, s.count, s.mine]),
    [['heart', 2, true], ['thumbsup', 1, true], ['check', 1, true]]);
  // 안 누른 사람에게는 mine이 전부 false여야 한다(그래야 화면에서 색이 안 켜진다)
  assert.ok(sync.reactionSummary(three, 'u9').every(s => !s.mine));
  assert.deepStrictEqual(sync.reactionSummary(three.concat(other), 'u1')[0].people.map(p => p.userId),
    ['u1', 'u2'], '누른 사람 목록을 그대로 돌려줘야 얼굴·이름을 세울 수 있다');
}

// 반응 알림: 댓글 작성자 한 명에게, kind는 'reaction'.
notified.length = 0;
await sync.notifyReaction('조준환', { actorName: '노준석', cardId: 'c1', projectId: 'p1', preview: '확인했습니다' });
assert.equal(notified.length, 1);
assert.deepStrictEqual(notified[0].ids, ['u2']);
assert.equal(notified[0].meta.kind, 'reaction');
assert.equal(notified[0].meta.preview, '확인했습니다');
// **자기 댓글에 자기가 누른 것은 알림이 없다.** 본인 제외는 통과가 기본값이라
// 깨져도 아무 소리가 안 난다 — §6-29에서 통째로 죽어 있던 자리다.
notified.length = 0;
await sync.notifyReaction('노준석', { actorName: '노준석', cardId: 'c1', projectId: 'p1', preview: '확인했습니다' });
assert.deepStrictEqual(notified, [], '내 댓글에 내가 반응하면 알림 없음');
// 프로필에 없는 이름(환송한 사람 등)은 받을 계정이 없다
await sync.notifyReaction('없는사람', { actorName: '노준석', cardId: 'c1', projectId: 'p1' });
assert.deepStrictEqual(notified, []);

// 알림은 그 댓글의 **첫 반응 한 번만**(사용자 피드백 2026-08-30 — "너무 쌓일 것 같다").
// 부르는 쪽(comments.jsx)이 반응이 이미 있던 댓글에는 notifyReaction을 부르지 않는다 —
// 소스로 못 박는다(브라우저 스위트는 게스트라 알림 경로를 못 본다).
{
  const src = readFileSync(new URL('../src/modals/comments.jsx', import.meta.url), 'utf8');
  assert.ok(/before\.length === 0 && notifyReaction/.test(src),
    '반응 알림이 첫 반응(before가 빈 배열)일 때만 나가지 않는다 — 댓글마다 쌓인다');
}

// 반응 표가 아직 없어도(마이그레이션 전) 댓글·활동은 떠야 한다.
// loadCardDetail이 Promise.all이라, 반응 조회가 던지면 업무 창이 통째로 빈다.
{
  const detail = await sync.loadCardDetail('c1');
  assert.equal(detail.comments.length, 1, '반응 조회가 실패하면 댓글까지 못 읽는다');
  assert.deepStrictEqual(detail.comments[0].reactions, [], '표가 없으면 반응은 빈 목록이다');
}

// ── 반응 칩 재설계 (comments.jsx · 2026-08-30 사용자 피드백) ────────────────
// 브라우저 없이 도는 스위트라 소스를 읽어 단정한다(cloud.js 문장 모양과 같은 방식).
// 되돌리기 검사: 아이콘 버튼을 `pl-2 pr-1.5`로 되돌리거나, 얼굴 대신 `{count}`
// 숫자 버튼으로 되돌리거나, heart 라벨을 '하트'로 되돌리면 아래가 깨진다.
{
  const uiSrc = readFileSync(join(ROOT, 'src', 'modals', 'comments.jsx'), 'utf8');
  const tblStart = uiSrc.indexOf('const REACTIONS = [');
  assert.ok(tblStart > 0, 'REACTIONS 표를 찾지 못했다');
  const table = uiSrc.slice(tblStart, uiSrc.indexOf('];', tblStart));

  // ① 라벨. heart가 '좋아요'다(사용자 지적 — 모달 머리줄이 "하트 1명"으로 떴다).
  //    그래서 thumbsup은 겹치지 않게 '최고'로 옮겼다. check는 '확인' 그대로.
  assert.ok(/kind: 'heart',[^\n]*label: '좋아요'/.test(table), "heart 라벨은 '좋아요'다");
  assert.ok(/kind: 'thumbsup',[^\n]*label: '최고'/.test(table), "thumbsup 라벨은 '최고'다('좋아요'와 겹치면 안 된다)");
  assert.ok(/kind: 'check',[^\n]*label: '확인'/.test(table), "check 라벨은 '확인'이다");
  assert.ok(!/label: '하트'/.test(uiSrc), "'하트'는 화면 라벨이 아니다");
  assert.ok(!/label: '따봉'/.test(uiSrc), "화면에 '따봉'을 쓰지 않는다(§8)");
  // 선으로만 그린 아이콘에 fill을 주면 갈고리가 뭉개진다(§4.2)
  assert.ok(/kind: 'check',[^\n]*fill: false/.test(table), 'Check에 fill을 주면 안 된다');

  const rowStart = uiSrc.indexOf('const ReactionRow');
  const row = uiSrc.slice(rowStart, uiSrc.indexOf('function ReactionPeopleModal'));
  assert.ok(rowStart > 0 && row.length > 200, 'ReactionRow를 찾지 못했다');

  // ② 아이콘은 어느 상태에서도 자기 칸의 가운데다 — 좌우 패딩이 어긋나면
  //    아무도 안 누른 원형 칩에서 아이콘이 왼쪽으로 치우쳐 보인다(스크린샷 지적).
  const iconBtn = row.slice(row.indexOf('aria-pressed'), row.indexOf('<Icon'));
  assert.ok(/justify-center/.test(iconBtn) && /\bw-6 h-6\b/.test(iconBtn),
    '아이콘 버튼이 정사각 + justify-center가 아니다 — 원형 칩에서 아이콘이 치우친다');
  assert.ok(!/\bp[lrxy]-\d/.test(iconBtn.replace(/py-\d/g, '')),
    '아이콘 버튼에 좌우 비대칭 패딩이 다시 붙었다');

  // ③ 숫자 대신 얼굴. 셋까지 겹쳐 세우고 넘치면 +N, +N만 전체 목록을 연다.
  assert.ok(/const FACES_MAX = 3;/.test(uiSrc), '얼굴 상한(FACES_MAX)이 3이 아니다');
  assert.ok(/<Avatar\b/.test(row), '반응 칩에 누른 사람 얼굴이 없다 — 숫자 버튼으로 되돌아갔다');
  assert.ok(/people\.slice\(0, FACES_MAX\)/.test(row), '얼굴을 상한까지만 세우고 있지 않다');
  assert.ok(/ring-surface/.test(row) && /-ml-\[5px\] first:ml-0/.test(row),
    '얼굴 겹치기가 ViewerFaces·PeopleStrip과 다른 결이다');
  assert.ok(/extra > 0[\s\S]{0,400}onOpen\(kind\)/.test(row),
    '+N일 때만 모달이 열려야 한다(세 명 이하는 얼굴이 곧 목록이다)');
  assert.ok(!/>\{count\}</.test(row), '숫자 버튼이 다시 붙었다 — 얼굴로 대체한 자리다');
}

// ── 마이그레이션·크론 설정 ──────────────────────────────────────────────────
// 0007에서 배운 것: 체크 제약과 INSERT 정책이 둘 다 kind를 열거하므로 양쪽을 같이
// 넓혀야 한다. 한쪽만 고치면 알림이 RLS로 막힌다.
const mig = readFileSync(join(ROOT, 'supabase', 'migrations', '0017_push_notifications.sql'), 'utf8');
const checkLine = mig.slice(mig.indexOf('notifications_kind_check\n  check'), mig.indexOf('-- due_soon은 빼'));
for (const k of ['mention', 'reply', 'assign', 'due_soon']) {
  assert.ok(checkLine.includes(`'${k}'`), `체크 제약에 ${k}가 없다`);
}
const policy = mig.slice(mig.indexOf('create policy "notifications_insert_authenticated"'));
const withCheck = policy.slice(0, policy.indexOf(');'));
for (const k of ['mention', 'reply', 'assign']) {
  assert.ok(withCheck.includes(`'${k}'`), `INSERT 정책에 ${k}가 없다`);
}
// due_soon은 서버(service key)가 넣는다 — 로그인 사용자가 위조할 수 있으면 안 된다
assert.ok(!withCheck.includes("'due_soon'"), 'due_soon은 INSERT 정책에 넣지 않는다');

// 0032가 그 둘을 'reaction'까지 넓혔는지 — 한쪽만 고치면 반응 알림이 RLS로
// 조용히 막힌다(0007·0017에서 이미 밟은 함정이다).
{
  const m32 = readFileSync(join(ROOT, 'supabase', 'migrations', '0032_comment_reactions.sql'), 'utf8');
  const check32 = m32.slice(m32.indexOf('notifications_kind_check\n  check'), m32.indexOf('drop policy if exists "notifications_insert'));
  for (const k of ['mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction']) {
    assert.ok(check32.includes(`'${k}'`), `0032의 체크 제약에 ${k}가 없다`);
  }
  const pol32 = m32.slice(m32.indexOf('create policy "notifications_insert_authenticated"'));
  const wc32 = pol32.slice(0, pol32.indexOf(');'));
  assert.ok(wc32.includes("'reaction'"), '반응은 사람이 만드는 알림이라 INSERT 정책에 있어야 한다');
  assert.ok(!wc32.includes("'due_soon'") && !wc32.includes("'approval'"),
    '서버·트리거가 만드는 종류를 INSERT 정책에 넣으면 로그인 사용자가 위조할 수 있다');

  // 표·RLS. "승인된 사용자만 읽기·쓰기, **자기 행만 지우기**"가 스펙이다.
  assert.ok(/primary key \(comment_id, user_id, kind\)/.test(m32),
    '같은 종류를 두 번 못 누르게 막는 것은 이 기본키다');
  assert.ok(/check \(kind in \('heart', 'thumbsup', 'check'\)\)/.test(m32), '반응 종류가 셋이 아니다');
  assert.ok(/comment_reactions_select on public\.comment_reactions\s+for select using \(public\.is_approved\(\)\)/.test(m32),
    '읽기가 승인된 사용자로 막혀 있지 않다');
  assert.ok(/for insert with check \(public\.is_approved\(\) and user_id = auth\.uid\(\)\)/.test(m32),
    '남의 이름으로 반응을 넣을 수 있다');
  assert.ok(/for delete using \(user_id = auth\.uid\(\)\)/.test(m32), '남의 반응을 취소할 수 있다');
  // 집계 컬럼을 두면 목록과 숫자가 어긋난다(주석으로 이유를 적어 두는 것은 괜찮다)
  assert.ok(!/^\s*(alter table|create trigger)[^\n]*like_count/mi.test(m32),
    'comments에 집계 컬럼을 붙이고 있다 — 개수는 클라이언트가 센다');
  assert.ok(/add table public\.comment_reactions/.test(m32), 'Realtime 발행에 안 넣으면 상대 화면이 안 바뀐다');
  assert.ok(/되돌리기/.test(m32) && /drop table if exists public\.comment_reactions/.test(m32),
    '되돌리는 SQL이 파일에 없다');
}

// 발행에 넣었으면 구독도 들어야 하고, **라우팅에 적지 않으면 기본이 전체 재조회다**(§6-21).
{
  const cSrc = readFileSync(join(ROOT, 'src', 'services', 'cloud.js'), 'utf8');
  assert.ok(/table: 'comment_reactions'/.test(cSrc), 'subscribeAll이 comment_reactions를 듣지 않는다');
  const sSrc = readFileSync(join(ROOT, 'src', 'services', 'cloudSync.js'), 'utf8');
  const route = sSrc.slice(sSrc.indexOf('export function subscribeWorkspace'));
  const i = route.indexOf("table === 'comments'");
  assert.ok(i > 0, 'comments 라우팅 분기를 찾지 못했다');
  const detailBranch = route.slice(i, route.indexOf("table === 'activity'", i));
  assert.ok(detailBranch.includes("'comment_reactions'"),
    '반응 이벤트가 전체 재조회로 흐른다 — comments와 같은 결(열린 창일 때만 상세 갱신)이어야 한다');
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const cron = (vercel.crons || []).find(c => c.path === '/api/push');
assert.ok(cron, 'vercel.json에 /api/push 크론이 없다');
assert.ok(/^\S+ \S+ \* \* \*$/.test(cron.schedule), '마감 임박은 하루 한 번 돈다');

// 서비스 워커는 빌드를 타지 않으므로(public/) 파일이 그대로 배포된다
const sw = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
assert.ok(/addEventListener\('push'/.test(sw) && /showNotification/.test(sw), 'sw가 푸시를 띄우지 않는다');
assert.ok(/addEventListener\('notificationclick'/.test(sw), 'sw에 클릭 처리가 없다');

// ── 전체 재조회가 열린 업무 창의 댓글·활동을 비우지 않는다 ──────────────────
// 클라우드 전용 경로라 게스트 스위트가 볼 수 없다. LOAD_STATE는 모든 카드의
// 댓글·활동을 빈 배열로 되돌리는데(초기 로드가 안 읽는 값이다 — §6-20), 창이
// 열려 있으면 카드 id가 그대로라 상세 효과가 다시 돌지 않아 **빈 채로 남는다**.
// 저장 직후에 특히 잘 났다: 내 저장이 실시간 cards 이벤트로 돌아오고, 편집 중이라
// 미뤄 둔 재조회가 편집이 끝나는 순간 실행된다(사용자 지적, 두 번).
{
  const app = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');
  const i = app.indexOf('const reloadCloud = useCallback');
  assert.ok(i > 0, 'reloadCloud를 찾지 못했다');
  const body = app.slice(i, app.indexOf('}, []);', i));
  assert.ok(body.includes('LOAD_STATE'), 'reloadCloud가 LOAD_STATE를 안 쓴다');
  assert.ok(body.includes('openCardIdRef'), '재조회 뒤 열린 창의 카드를 보지 않는다');
  assert.ok(body.includes('loadCardDetail'), '재조회 뒤 상세를 다시 읽지 않는다');
  // 편집 중 카드 이벤트는 전체 재조회가 아니라 그 카드만 다시 읽어야 한다
  assert.ok(/onCard:[\s\S]{0,400}pendingCardsRef/.test(app),
    '편집 중 카드 변경이 전체 재조회로 예약된다(그 카드만 다시 읽어야 한다)');
}

// ── 업무 저장이 댓글·활동·첨부를 덮지 않는다 (§6-22 · §6-28-a) ──────────────
{
  const ctrl = readFileSync(join(ROOT, 'src', 'hooks', 'controllers.js'), 'utf8');
  const i = ctrl.indexOf('const handleSaveTask');
  // handleSaveTask 다음에 오는 첫 const handle… 까지만 자른다 — 함수 순서가
  // 바뀌어도 엉뚱하게 파일 끝까지 잡히지 않게(그러면 다른 UPSERT_TASK까지 센다)
  const nextI = ctrl.indexOf('const handle', i + 20);
  const body = ctrl.slice(i, nextI > 0 ? nextI : undefined);
  assert.ok(/const \{ comments, activityLog, attachments, \.\.\.patch \} = task;/.test(body),
    '저장이 댓글·활동·첨부를 payload에서 빼지 않는다');
  assert.ok(body.includes("type: 'SYNC_TASK'"), '기존 카드 저장이 병합(SYNC_TASK)이 아니다');
  const upserts = (body.match(/UPSERT_TASK/g) || []).length;
  assert.strictEqual(upserts, 1, '새 카드에만 UPSERT_TASK를 써야 한다');
}

// ── getSession()을 한 겹 덜 벗기지 않았는지 (§6-29) ────────────────────────
// cloud.getSession()은 supabase의 { data }를 이미 벗겨 { session, user }를 준다.
// `.access_token`을 바로 꺼내면 언제나 undefined이고, 그 자리는 조용히 통과하는
// 필터가 된다. 실제로 이 실수로 앱 첨부가 한 번도 드라이브로 못 갔다.
{
  const cloudSrc = readFileSync(join(ROOT, 'src', 'services', 'cloud.js'), 'utf8');
  assert.ok(!/getSession\(\)\)\?\.access_token/.test(cloudSrc),
    'getSession()에서 access_token을 한 겹 덜 벗겨 꺼내고 있다 (§6-29)');
  assert.ok(/getSession\(\)\)\?\.session\?\.access_token/.test(cloudSrc),
    'access_token은 session 아래에서 꺼내야 한다');
}

// ── PWA manifest (홈 화면에 추가) ───────────────────────────────────────────
// 브라우저가 조용히 무시하는 자리라 어긋나도 화면에는 아무 표시가 안 난다.
{
  const mf = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.ok(mf.id, 'id가 없으면 start_url을 바꿀 때 설치된 앱이 다른 앱으로 취급된다');
  assert.ok(mf.icons.some(i => i.purpose === 'maskable'), '안드로이드 아이콘이 흰 사각형 안에 갇힌다');
  // orientation을 세로로 잠그면 설치한 사람은 엑셀 미리보기·대시보드를 가로로 못 본다.
  assert.ok(!mf.orientation, 'manifest가 화면 방향을 잠그고 있다');

  // 바로가기(아이콘 길게 누르기)의 ?p= 는 App.jsx가 그대로 activeMenu로 쓴다.
  // 메뉴 키 이름이 바뀌면 바로가기는 조용히 대시보드로 떨어진다 — 눌러 보기 전에는 모른다.
  const src = ['components/layout.jsx', 'App.jsx']
    .map(f => readFileSync(join(ROOT, 'src', f), 'utf8')).join('\n');
  const menus = new Set([...src.matchAll(/(?:setActiveMenu\(|activeMenu === )'([A-Za-z]+)'/g)].map(m => m[1]));
  for (const sc of mf.shortcuts || []) {
    const p = new URL(sc.url, 'https://x/').searchParams.get('p');
    assert.ok(menus.has(p), `manifest 바로가기 '${sc.name}'의 ?p=${p} 를 아는 화면이 없다`);
  }
}

// ── 설치 안내는 설치하면 사라져야 한다 ──────────────────────────────────────
// 설치를 마친 사람에게 설치하라는 줄이 계속 뜨는 것이 이 줄의 유일한 실패 방식이다.
{
  const layout = readFileSync(join(ROOT, 'src', 'components', 'layout.jsx'), 'utf8');
  const i = layout.indexOf('function InstallRow');
  assert.ok(i > 0, 'InstallRow가 없다');
  const body = layout.slice(i, layout.indexOf('\nfunction ', i + 20));
  assert.ok(/isStandalone\(\)/.test(body), '설치 안내가 standalone을 보지 않아 설치 뒤에도 계속 뜬다');
  assert.ok(/isAndroid\(\)/.test(body), '안드로이드 안내가 아이폰에도 뜬다(iOS는 PushRow가 따로 안내한다)');
}

// ── 아이콘 뱃지 숫자 (안 읽은 알림 수) ──────────────────────────────────────
// 아이폰 홈 화면 웹앱에서만 보이는 값이라, 틀려도 개발 중에는 아무도 못 본다.
{
  const apiSrc = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  // payload를 루프 밖에서 한 번만 만들면 **모두가 첫 사람의 숫자를 받는다.**
  // 알림 자체는 멀쩡히 오기 때문에 숫자만 조용히 남의 것이 된다.
  assert.ok(!/const payload = JSON\.stringify/.test(apiSrc),
    'payload를 하나로 만들어 돌려쓰고 있다 — 뱃지가 남의 안 읽은 수가 된다');
  assert.ok(/appBadge: unread\.get\(s\.profile_id\)/.test(apiSrc),
    '뱃지 수를 그 구독의 주인으로 세지 않는다');
  assert.ok(/select\('profile_id/.test(apiSrc),
    '구독을 읽을 때 profile_id를 안 가져오면 사람별로 가를 수 없다');
  assert.ok(/eq\('read', false\)/.test(apiSrc), '안 읽은 것만 세지 않는다');

  // 서버가 못 세면 null이 온다. 그때 0으로 덮으면 남아 있던 숫자가 사라진다.
  assert.ok(/typeof n === 'number'/.test(sw), 'sw가 서버 값이 없을 때도 뱃지를 건드린다');
  assert.ok(/clearAppBadge/.test(sw), '0이 됐을 때 숫자를 지우지 않는다');
  // 뱃지 갱신을 waitUntil 밖에 두면 워커가 먼저 종료돼 숫자가 안 바뀔 수 있다.
  assert.ok(/waitUntil\(Promise\.all\(\[shown, badged\]\)\)/.test(sw),
    '뱃지 갱신이 waitUntil 밖이다 — 워커가 먼저 죽으면 숫자가 안 바뀐다');
}

console.log('PASS push — 문구·KST 날짜·딥링크·insert 모양·새 담당자만·댓글 반응(토글·본인 제외·표 없어도 안 죽음·RLS·실시간 라우팅·칩 라벨·아이콘 가운데·얼굴 인라인/+N)·마이그레이션·크론·sw·재조회 상세 복구·저장이 목록을 안 덮음·manifest·설치 안내·뱃지 수');
