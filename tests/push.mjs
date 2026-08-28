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

console.log('PASS push — 문구·KST 날짜·딥링크·insert 모양·새 담당자만·마이그레이션·크론·sw·재조회 상세 복구·저장이 목록을 안 덮음');
