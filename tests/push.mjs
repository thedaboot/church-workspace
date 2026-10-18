// 알림 확장(assign·due_soon) + 웹 푸시. 브라우저 없이 순수 로직만 본다.
// 이 경로는 게스트 모드로 돌지 않는다(로그인·서버리스 함수가 필요) — assignees.mjs와
// 같은 방식으로 cloud.js를 가짜로 바꿔치고 cloudSync만 노드에서 돌린다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSplit } from './_load.mjs';

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
// 가입 요청(0022 트리거). 이 열쇠가 없던 동안 fallback으로 떨어져 '나를 멘션했어요'로
// 떴다(사용자 지적 2026-09-09) — 그 자리를 다시 비우면 이 줄이 실패한다.
assert.equal(notify.notifLine('approval', '문진혁'), '문진혁님이 가입을 요청했어요');
assert.ok(!notify.isSystemNotif('approval'), '가입 요청은 누가 신청했는지가 문구에 남아야 한다');
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
// 생기지 않는다(docs/PITFALLS.md §6-25 — 실제로 그렇게 멘션 알림이 죽어 있었다).
const cloudSrc = readSplit('src/services/cloud.js');
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
  // supabaseClient의 쓰기 관찰 지점(2026-09-05 — 다녀간 시각)은 여기서 필요 없다
  // 팀장 줄(0107 · C 묶음)은 supabase를 직접 읽는다 — 가짜에서는 없음(null → 읽지 않는다) · 탭 차례(0108)는 할 일 없음
  .replace(/import \{ setWriteObserver(, supabase)? \} from '\.\/supabaseClient\.js';/, 'const setWriteObserver = () => {}; const supabase = null;')
  .replace(/import \{ primeTabOrder \} from '\.\/tabOrder\.js';/, 'const primeTabOrder = () => {};')
  .replace(/import \{ primeNotifOff \} from '\.\/notifOff\.js';/, 'const primeNotifOff = () => {};')
  // 팀장 원본 거치기(aiPeople.withTeamLead) · 설정(CONFIG)은 순수 모듈 — 진짜 파일을 절대 경로로
  .replace(/from '\.\/aiPeople\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'services', 'aiPeople.js')).href}';`)
  .replace(/from '\.\.\/config\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'config.js')).href}';`)
  .replace(/import \{ statusToDb, statusFromDb \} from '\.\/cloud\.js';/,
    `const statusToDb = () => 'todo'; const statusFromDb = () => '시작 전';`)
  // utils는 진짜 파일을 절대 경로로 문다(assignees.mjs와 같은 이유 — 가짜로 다시
  // 적으면 cloudSync가 utils에서 가져오는 이름이 늘 때마다 여기가 같이 깨진다)
  // 재접속 판정(2026-09-25)은 순수 모듈이라 진짜 파일을 절대 경로로 문다
    // 리더만 보는 프로젝트 판정(0092)도 순수 모듈이라 진짜 파일을 절대 경로로 문다
  .replace(/from '\.\/visibility\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'services', 'visibility.js')).href}';`)
  // 업무 잠금 판정(0099)도 순수 모듈 — 진짜 파일을 절대 경로로
  .replace(/from '\.\/cardLock\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'services', 'cardLock.js')).href}';`)
  // 휴지통 규칙(0104)도 순수 모듈 — 진짜 파일을 절대 경로로
  .replace(/from '\.\/trashItems\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'services', 'trashItems.js')).href}';`)
  .replace(/from '\.\/realtimeStatus\.js';/, `from '${pathToFileURL(join(ROOT, 'src', 'services', 'realtimeStatus.js')).href}';`)
  .replace(/import (\{[^}]*\}) from '\.\.\/utils\.js';/,
    (m, names) => `import ${names} from '${pathToFileURL(join(ROOT, 'src', 'utils.js')).href}';`);

const PROFILES = [
  { id: 'u1', display_name: '노준석' },
  { id: 'u2', display_name: '조준환' },
  { id: 'u3', display_name: '천진영' },
  // 환송한 사람(0027) — 멘션·담당자 후보에서 빠져야 한다(아래 단정)
  { id: 'u4', display_name: '환송된사람', removed_at: '2026-08-01T00:00:00Z' },
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

// 환송한 사람(0027)은 멘션·담당자 자동완성 후보에서 빠진다 — 스토어의 members는
// 걸렀는데 이 모듈 캐시(memberNames)는 안 걸러서 목록에 남아 있었다(사용자 지적
// 2026-08-30). 지난 댓글의 이름·사진 표시는 그대로여야 하므로 profileIdToName·
// nameToAvatar는 일부러 안 거른다.
assert.deepStrictEqual(sync.getMemberNames(), ['노준석', '조준환', '천진영'],
  '환송한 사람이 멘션·담당자 후보에 남아 있다');

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

// ── 담당 업무 댓글 알림 (0103 · UX 다듬기 2차 D9 · 2026-10-15) ─────────────────────────────────────
// 업무에 댓글이 달리면 그 업무의 담당자에게 '○○님이 내가 담당한 업무에 댓글을 남겼어요' — 댓글 쓴 사람 본인과, 같은 댓글로 멘션·답글을
// 받는 사람은 뺀다(한 사람에게 한 통). 문구는 답글·멘션과 같은 틀(notifLine) · 미리보기는 같은 댓글 앞 80자.
// **되돌리기**(§3-5): notifyComment의 담당자 거르기에서 `!mentioned.has(id) && !replied.has(id)`를 빼면 '한 통만'이,
// notifyText의 assignee_comment 줄을 빼면 문구가(멘션 문구로 떨어진다), 0103의 INSERT 정책에서 'assignee_comment'를 빼면 아래 마이그레이션 단정이 깨진다.
{
  assert.equal(notify.notifLine('assignee_comment', '조준환'), '조준환님이 내가 담당한 업무에 댓글을 남겼어요');
  assert.ok(!notify.isSystemNotif('assignee_comment') && notify.notifArea('assignee_comment') === 'task', '사람이 만드는 업무 알림이다(얼굴 · 업무 갈래)');
  notified.length = 0;
  // 담당자 조준환·천진영 · 댓글 쓴 사람 노준석(담당자이기도) → 둘에게 담당 업무 알림
  await sync.notifyComment('3시까지로 수정', { actorName: '노준석', cardId: 'c1', projectId: 'p1', assignees: ['조준환', '천진영', '노준석'] });
  assert.deepStrictEqual(notified.map(n => [n.meta.kind, n.ids, n.meta.preview]), [['assignee_comment', ['u2', 'u3'], '3시까지로 수정']],
    '담당자에게(댓글 쓴 본인은 빼고) · 미리보기는 댓글');
  notified.length = 0;
  // 같은 댓글로 멘션(천진영)·답글(조준환)을 받는 담당자는 그쪽 한 통만
  await sync.notifyComment('@천진영 확인 부탁해요', { actorName: '노준석', cardId: 'c1', projectId: 'p1', replyToName: '조준환', assignees: ['조준환', '천진영'] });
  assert.deepStrictEqual(notified.map(n => [n.meta.kind, n.ids]), [['mention', ['u3']], ['reply', ['u2']]], '멘션·답글을 받는 담당자에게는 담당 업무 알림을 또 보내지 않는다');
  notified.length = 0;
  await sync.notifyComment('혼자 남긴 메모', { actorName: '노준석', cardId: 'c1', projectId: 'p1', assignees: ['노준석'] });
  await sync.notifyComment('담당자 없음', { actorName: '조준환', cardId: 'c1', projectId: 'p1' });
  assert.deepStrictEqual(notified, [], '내가 맡은 업무에 내가 단 댓글 · 담당자 없는 업무는 알림 없음');
  // 마이그레이션 0103 — CHECK와 INSERT 정책을 같이 넓힌다(한쪽만이면 RLS에 조용히 막힌다 · 0017·0022)
  const m103 = readFileSync(join(ROOT, 'supabase', 'migrations', '0103_assignee_comment_notice.sql'), 'utf8').replace(/\r\n/g, '\n');
  const body103 = m103.slice(0, m103.indexOf('-- ── 확인'));
  const check103 = body103.slice(body103.indexOf('add constraint notifications_kind_check'), body103.indexOf('alter policy'));
  for (const k of ['mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction', 'worship_today', 'service_published', 'note_shared',
    'club_apply', 'club_accepted', 'meeting_new', 'approved', 'guide_pinned', 'meeting_tomorrow', 'assignee_comment']) {
    assert.ok(check103.includes(`'${k}'`), `0103의 체크 제약에 ${k}가 없다`);
  }
  const pol103 = body103.slice(body103.indexOf('alter policy notifications_insert_authenticated'));
  const wc103 = pol103.slice(0, pol103.indexOf(';\n'));
  assert.ok(wc103.includes("'assignee_comment'::text") && wc103.includes("'guide_pinned'::text") && /\(select is_approved\(\)\)/.test(wc103) && /\(kind = 'approved'::text\) AND \(select is_admin\(\)\)/.test(wc103),
    '0103: INSERT 정책은 지금 정책(0101 꼴)에 assignee_comment만 더한다');
  assert.ok(!wc103.includes("'due_soon'") && !wc103.includes("'worship_today'") && !wc103.includes("'approval'") && !wc103.includes("'meeting_tomorrow'"),
    '서버·트리거가 만드는 종류를 INSERT 정책에 넣으면 로그인 사용자가 위조할 수 있다');
  assert.ok(!/create policy|drop policy/i.test(body103), '0103은 정책을 alter만(이름·역할 그대로)');
}

// ── 리더만 보는 프로젝트(0092) — 알림 받는 사람·멘션 후보·마감 임박 ─────────────────
// 리더가 아니면 RLS가 그 프로젝트를 안 주지만 **알림은 보내는 사람의 클라이언트가 받는 사람을 고른다** — 리더가 쓴 댓글의
// @멘션·답글·반응·배정이 리더 아닌 사람에게 미리보기째 가면 그대로 샌다. 마감 임박은 서버 키 배치라 RLS 밖이다.
// **되돌리기**(§3-5): cloudSync의 seeing(…)을 네 함수 중 하나에서 빼면 그 줄이, getMemberNames의 leaderNames 갈래를
// 빼면 '멘션 후보'가, push.js dueSoonWanted의 visibleRecipients를 빼면 '마감 임박'이 깨진다.
{
  const C = globalThis.__CLOUD;
  const keep = { listProjects: C.listProjects };
  C.listProjects = async () => [{ id: 'p1', name: '2026 하계 수련회' }, { id: 'p2', name: '임원 MT', visibility: 'leaders' }];
  C.getLeaderInfo = async () => ({ amLeader: true, ids: ['u1', 'u2'] });
  const { state } = await sync.loadCloudState();
  assert.strictEqual(state.amLeader, true, '리더 판정이 스토어에 실린다');
  assert.strictEqual(state.projects.byId.p2.visibility, 'leaders');
  assert.strictEqual(state.projects.byId.p1.visibility, 'all', '칸이 없으면 공개');
  assert.deepStrictEqual(sync.getMemberNames('p2'), ['노준석', '조준환'], '리더 프로젝트의 멘션·담당자 후보는 리더만');
  assert.deepStrictEqual(sync.getMemberNames('p1'), ['노준석', '조준환', '천진영'], '공개 프로젝트는 예전 그대로');
  notified.length = 0;
  await sync.notifyAssignees(['u2', 'u3'], { actorName: '노준석', cardId: 'c9', projectId: 'p2', preview: '숙소 계약금' });
  assert.deepStrictEqual(notified.map(n => n.ids), [['u2']], '배정 알림은 리더에게만');
  notified.length = 0;
  await sync.notifyComment('@천진영 @조준환 확인 부탁해요', { actorName: '노준석', cardId: 'c9', projectId: 'p2', replyToName: '천진영' });
  assert.deepStrictEqual(notified.map(n => [n.meta.kind, n.ids]), [['mention', ['u2']]], '멘션·답글도 리더에게만(천진영 빠짐)');
  notified.length = 0;
  await sync.notifyMentions('@천진영', { actorName: '노준석', cardId: 'c9', projectId: 'p2', recipientIds: ['u3'] });
  await sync.notifyReaction('천진영', { actorName: '노준석', cardId: 'c9', projectId: 'p2', preview: '확인' });
  assert.deepStrictEqual(notified, [], '본문 멘션·반응도 리더가 아니면 안 간다');
  await sync.notifyAssignees(['u3'], { actorName: '노준석', cardId: 'c1', projectId: 'p1', preview: '콘티' });
  assert.deepStrictEqual(notified.map(n => n.ids), [['u3']], '공개 프로젝트는 그대로 간다');
  // 리더 목록을 못 읽으면(마이그레이션 전 · 조회 실패) 리더 프로젝트 알림은 아무에게도 안 간다 — 통과가 기본값이면 깨져도 소리가 안 난다
  C.getLeaderInfo = async () => { throw new Error('function leader_profile_ids() does not exist'); };
  const { state: s2 } = await sync.loadCloudState();
  assert.strictEqual(s2.amLeader, false, '판정을 못 읽어도 로드는 던지지 않고 리더 아님');
  notified.length = 0;
  await sync.notifyAssignees(['u2'], { actorName: '노준석', cardId: 'c9', projectId: 'p2', preview: 'x' });
  assert.deepStrictEqual(notified, [], '리더 목록이 없으면 리더 프로젝트 알림은 닫힌다');
  // 마감 임박 배치(api/push.js · 서버 키) — 순수 함수로
  const cards = [
    { id: 'c1', title: '콘티', project_id: 'p1', due_date: '2026-10-12', card_assignees: [{ profile_id: 'u3' }], projects: { archived: false, visibility: 'all' } },
    { id: 'c9', title: '숙소', project_id: 'p2', due_date: '2026-10-13', card_assignees: [{ profile_id: 'u2' }, { profile_id: 'u3' }, { profile_id: null }], projects: { archived: false, visibility: 'leaders' } },
  ];
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12', new Set(['u1', 'u2'])).map(w => `${w.cardId}:${w.recipientId}:${w.preview}`),
    ['c1:u3:콘티 · 오늘 마감', 'c9:u2:숙소 · 내일 마감'], '리더 프로젝트 마감은 리더 담당자에게만');
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12').map(w => w.cardId), ['c1'], '리더 목록이 없으면 리더 프로젝트 마감은 건너뛴다');
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(/projects!inner\(archived, visibility\)/.test(src), '마감 임박 조회가 visibility를 같이 읽는다');
  assert.ok(/audienceFor\(db, \{ cardId, projectId \}\)/.test(src) && /res\.status\(200\)\.json\(\{ sent: 0 \}\); return;\n\s*\}/.test(src),
    'POST 푸시도 좁혀진 프로젝트면 볼 수 있는 사람만 · 판정 실패면 보내지 않는다');
  // 되돌려 두기 — 아래 검사는 0092 전 모양을 본다
  C.listProjects = keep.listProjects; delete C.getLeaderInfo;
  await sync.loadCloudState();
  console.log('PASS  리더만 보는 프로젝트(0092) — 알림 받는 사람·멘션 후보·판정 실패는 닫힘·마감 임박 13가지');
}

// ── 보는 사람 직접 선택(0105 · v5 B) — 알림 받는 사람·멘션 후보·저장 모양·마감 임박·POST 푸시 · 비밀번호 재설정 요청 알림(0106) ──
// 리더 프로젝트와 같은 길이다: RLS는 행을 걷지만 알림 받는 사람은 보내는 쪽이 고른다 — project_audiences(고른 사람 ∪ 마스터)로 거른다.
// **되돌리기**(§3-5): cloudSync seeing의 isCustomProject 갈래를 빼면 '배정·멘션', getMemberNames의 갈래를 빼면 '멘션 후보',
// primeViewers의 customProjects를 빼면 '못 읽으면 닫힘', dueSoonWanted의 audiences 갈래를 빼면 '마감 임박',
// _leaders.audienceFor의 custom 갈래를 빼면 'POST 푸시', notifyText의 lock_reset 줄을 빼면 '요청 알림 문구'가 깨진다.
{
  const C = globalThis.__CLOUD;
  C.listProjects = async () => [{ id: 'p1', name: '2026 하계 수련회' }, { id: 'p3', name: '새신자 초청 주일', visibility: 'custom', viewer_teams: ['웰컴팀'] }];
  C.listProjectViewers = async () => [{ project_id: 'p3', profile_id: 'u1' }, { project_id: 'p3', profile_id: 'u2' }];
  C.projectAudiences = async () => [{ project_id: 'p3', profile_ids: ['u1', 'u2'] }];
  const { state } = await sync.loadCloudState();
  assert.strictEqual(state.viewersReady, true, '고른 사람 표를 읽으면 직접 선택을 쓸 수 있다');
  assert.deepStrictEqual([state.projects.byId.p3.visibility, state.projects.byId.p3.viewers, state.projects.byId.p3.viewerTeams],
    ['custom', ['노준석', '조준환'], ['웰컴팀']], '앱 프로젝트에 custom · 고른 사람 이름 · 팀 칩');
  assert.deepStrictEqual(sync.getMemberNames('p3'), ['노준석', '조준환'], '직접 선택의 멘션·담당자 후보는 볼 수 있는 사람만');
  notified.length = 0;
  await sync.notifyAssignees(['u2', 'u3'], { actorName: '노준석', cardId: 'c3', projectId: 'p3', preview: '선물' });
  await sync.notifyComment('@천진영 @조준환 봐 주세요', { actorName: '노준석', cardId: 'c3', projectId: 'p3' });
  assert.deepStrictEqual(notified.map(n => [n.meta.kind, n.ids]), [['assign', ['u2']], ['mention', ['u2']]], '배정·멘션은 고른 사람에게만(천진영 빠짐)');
  // 저장 — 이름 → 계정 id로 set_project_viewers 한 번 · 다시 읽은 값으로 돌려준다
  const calls = [];
  C.setProjectViewers = async (id, ids, teams) => { calls.push([id, ids, teams]); return { id, visibility: 'custom', visibility_by: 'u1', visibility_at: 't', viewer_teams: teams }; };
  C.announceProjectVisibility = async () => {};
  C.listProjectViewers = async () => [{ project_id: 'p3', profile_id: 'u1' }, { project_id: 'p3', profile_id: 'u3' }];
  C.projectAudiences = async () => [{ project_id: 'p3', profile_ids: ['u1', 'u3'] }];
  const saved = await sync.projectVisibilityCloud('p3', { visibility: 'custom', viewers: ['노준석', '천진영'], viewerTeams: [] });
  assert.deepStrictEqual(calls, [['p3', ['u1', 'u3'], []]], '이름을 계정 id로 바꿔 한 번에 보낸다');
  assert.deepStrictEqual([saved.visibility, saved.viewers, saved.visibilityBy], ['custom', ['노준석', '천진영'], 'u1'], '돌려받은 값(다시 읽은 고른 사람)');
  notified.length = 0;
  await sync.notifyAssignees(['u2', 'u3'], { actorName: '노준석', cardId: 'c3', projectId: 'p3', preview: '선물' });
  assert.deepStrictEqual(notified.map(n => n.ids), [['u3']], '바꾼 뒤에는 새 audience로');
  // 표·함수를 못 읽으면(0105 전 · 실패) 로드는 던지지 않고 예전 토글 · custom 프로젝트 알림은 닫힌다
  C.listProjectViewers = async () => { throw new Error('relation "project_viewers" does not exist'); };
  const { state: s3 } = await sync.loadCloudState();
  assert.strictEqual(s3.viewersReady, false, '못 읽으면 viewersReady false(예전 토글)');
  notified.length = 0;
  await sync.notifyAssignees(['u2'], { actorName: '노준석', cardId: 'c3', projectId: 'p3', preview: 'x' });
  assert.deepStrictEqual(notified, [], '못 읽으면 직접 선택 프로젝트 알림은 닫힌다');
  // 마감 임박(서버 키)
  const cards = [{ id: 'c3', title: '선물', project_id: 'p3', due_date: '2026-10-12', card_assignees: [{ profile_id: 'u2' }, { profile_id: 'u3' }], projects: { archived: false, visibility: 'custom' } }];
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12', new Set(['u3']), new Map([['p3', new Set(['u2'])]])).map(w => w.recipientId), ['u2'], '직접 선택 마감은 audience 담당자에게만(리더 목록이 아니다)');
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12', new Set(['u2', 'u3'])), [], 'audience를 못 읽으면 건너뛴다');
  // POST 푸시의 판정 — _leaders.audienceFor(가짜 db)
  const L = await import('file://' + join(ROOT, 'api', '_leaders.js').replace(/\\/g, '/'));
  const fdb = (vis) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'p3', projects: { visibility: vis } } }) }) }) }),
    rpc: async (fn, args) => ({ data: fn === 'project_audiences' ? [{ project_id: args.ps[0], profile_ids: ['u2'] }] : fn === 'leader_profile_ids' ? ['u9'] : null }),
  });
  assert.deepStrictEqual([...await L.audienceFor(fdb('custom'), { cardId: 'c3' })], ['u2'], 'POST 푸시: 직접 선택은 project_audiences');
  assert.deepStrictEqual([...await L.audienceFor(fdb('leaders'), { cardId: 'c3' })], ['u9', 'u2'], '리더만은 leader_profile_ids ∪ 그 프로젝트 몫(0110 그해 리더)');
  assert.strictEqual(await L.audienceFor(fdb('all'), { cardId: 'c3' }), null, '공개는 거르지 않는다');
  // 비밀번호 재설정 요청 알림(0106) — 사람이 만든 업무 알림 · 문구 사용자 확인 2026-10-18
  assert.equal(notify.notifLine('lock_reset', '천진영'), '천진영님이 비밀번호를 다시 설정해 달라고 요청했어요', '요청 알림 문구');
  assert.ok(!notify.isSystemNotif('lock_reset') && notify.notifArea('lock_reset') === 'task', '사람이 만든 업무 알림(얼굴 · 업무 갈래)');
  delete C.listProjectViewers; delete C.projectAudiences; delete C.setProjectViewers; delete C.announceProjectVisibility;
  C.listProjects = async () => [{ id: 'p1', name: '2026 하계 수련회' }];
  await sync.loadCloudState();
  console.log('PASS  보는 사람 직접 선택(0105) — 알림 받는 사람·멘션 후보·저장·못 읽으면 닫힘·마감 임박·POST 푸시 · 요청 알림(0106) 15가지');
}

// ── 지난해 리더(0110 · 합치기 2026-10-17 사용자 요청) — 리더 프로젝트의 몫(project_audiences 줄 · 그해 리더)을 올해 리더에 더한다 ──
// 2025 리더 프로젝트(p2)의 2025 임원 천진영(u3)은 2026 리더가 아니어도 그 업무 알림·멘션 후보·마감 임박·푸시에 든다.
// **되돌리기**(§3-5): cloudSync seeing의 leaderAudience를 빼면 '배정', getMemberNames의 leaderAud 갈래를 빼면 '멘션 후보',
// dueSoonWanted의 leaderAudience를 빼면 '마감 임박', _leaders.audienceFor의 audienceMap 합치기를 빼면 'POST 푸시'가 깨진다.
{
  const C = globalThis.__CLOUD;
  C.listProjects = async () => [{ id: 'p1', name: '2026 하계 수련회' }, { id: 'p2', name: '2025 임원 MT', visibility: 'leaders', year: 2025 }];
  C.getLeaderInfo = async () => ({ amLeader: true, ids: ['u1'] });
  C.listProjectViewers = async () => [];
  C.projectAudiences = async () => [{ project_id: 'p2', profile_ids: ['u1', 'u3'] }];
  await sync.loadCloudState();
  assert.deepStrictEqual(sync.getMemberNames('p2'), ['노준석', '천진영'], '지난해 리더 프로젝트의 멘션 후보에 그해 리더가 든다');
  notified.length = 0;
  await sync.notifyAssignees(['u2', 'u3'], { actorName: '노준석', cardId: 'c9', projectId: 'p2', preview: '숙소' });
  assert.deepStrictEqual(notified.map(n => n.ids), [['u3']], '배정 알림은 올해 리더 ∪ 그해 리더에게(조준환 빠짐)');
  // project_audiences를 못 읽으면 올해 리더만(0110 전과 같다 · 닫힌 쪽)
  C.listProjectViewers = async () => { throw new Error('relation "project_viewers" does not exist'); };
  await sync.loadCloudState();
  assert.deepStrictEqual(sync.getMemberNames('p2'), ['노준석'], '몫을 못 읽으면 올해 리더만');
  // 마감 임박(서버 키)
  const cards = [{ id: 'c9', title: '숙소', project_id: 'p2', due_date: '2026-10-12', card_assignees: [{ profile_id: 'u2' }, { profile_id: 'u3' }], projects: { archived: false, visibility: 'leaders' } }];
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12', new Set(['u1']), new Map([['p2', new Set(['u1', 'u3'])]])).map(w => w.recipientId), ['u3'],
    '리더 프로젝트 마감은 올해 리더 ∪ 그해 리더 담당자에게');
  assert.deepStrictEqual(api.dueSoonWanted(cards, '2026-10-12', new Set(['u1'])), [], '몫이 없으면 올해 리더만(담당자 둘 다 아님)');
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(/live\.filter\(c => isCustomOnly\(c\.projects\) \|\| isLeaderOnly\(c\.projects\)\)/.test(src), '마감 임박은 리더 프로젝트 몫도 읽는다');
  // POST 푸시 · 달력 — _leaders.audienceFor(가짜 db): 몫을 못 읽으면 올해 리더만
  const L = await import('file://' + join(ROOT, 'api', '_leaders.js').replace(/\\/g, '/'));
  const fdb = (audFails) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'p2', projects: { visibility: 'leaders' } } }) }) }) }),
    rpc: async (fn) => (fn === 'project_audiences' ? (audFails ? { data: null, error: { message: 'down' } } : { data: [{ project_id: 'p2', profile_ids: ['u1', 'u3'] }] })
      : fn === 'leader_profile_ids' ? { data: ['u1'] } : { data: null }),
  });
  assert.deepStrictEqual([...await L.audienceFor(fdb(false), { cardId: 'c9' })].sort(), ['u1', 'u3'], 'POST 푸시: 그해 리더도 받는다');
  assert.deepStrictEqual([...await L.audienceFor(fdb(true), { cardId: 'c9' })], ['u1'], 'POST 푸시: 몫을 못 읽으면 올해 리더만');
  assert.ok(/await audienceFor\(supabase, \{ projectId: proj\.id \}\)/.test(readFileSync(join(ROOT, 'api', 'ics.js'), 'utf8')), '달력 구독도 같은 판정(audienceFor)');
  delete C.listProjectViewers; delete C.projectAudiences; delete C.getLeaderInfo;
  C.listProjects = async () => [{ id: 'p1', name: '2026 하계 수련회' }];
  await sync.loadCloudState();
  console.log('PASS  지난해 리더(0110) — 리더 프로젝트 몫을 올해 리더에 더한다 · 멘션 후보·배정·마감 임박·POST 푸시·달력 · 못 읽으면 올해 리더만 8가지');
}

// ── 복제: 직접 선택 원본(합치기 2026-10-17 — A 복제 × B 직접 선택) ─────────────────────────────────────────
// 'all'로 베끼면 고른 사람만 보던 업무가 모두에게 간다. 'custom'으로 만들고 업무를 넣기 전에 같은 고른 사람을 싣는다.
// 리더가 아니면 트리거가 'all'로 되돌린다 → 빈 프로젝트를 지우고 42501로 실패(업무를 넣지 않는다).
// **되돌리기**: projectCreateCloud의 `custom ? { visibility: CUSTOM }`을 빼면 첫 단정이, isCustomOnly(saved) 검사를 빼면 '리더가 아니면'이 깨진다.
{
  const C = globalThis.__CLOUD;
  const made = [], viewersSet = [], deleted = [];
  C.createProject = async (row) => { made.push(row); return { ...row, visibility: C.__asLeader ? row.visibility : 'all' }; };
  C.setProjectViewers = async (id, ids, teams) => { viewersSet.push([id, ids, teams]); return { id, visibility: 'custom', viewer_teams: teams }; };
  C.listProjectViewers = async () => []; C.projectAudiences = async () => [];
  C.announceProjectVisibility = async () => {};
  C.deleteProject = async (id) => { deleted.push(id); };
  C.__asLeader = true;
  await sync.projectCreateCloud({ id: 'pN', title: '새신자 초청(복제)', position: 9, year: 2027, visibility: 'custom', viewers: ['노준석', '천진영'], viewerTeams: ['웰컴팀'] });
  assert.deepStrictEqual([made[0].visibility, viewersSet[0]], ['custom', ['pN', ['u1', 'u3'], ['웰컴팀']]], '직접 선택으로 만들고 같은 고른 사람·팀 칩을 싣는다');
  C.__asLeader = false;
  const err = await sync.projectCreateCloud({ id: 'pM', title: 'x', visibility: 'custom', viewers: ['노준석'], viewerTeams: [] }).then(() => null, e => e);
  assert.ok(err && err.code === '42501' && deleted.includes('pM'), '리더가 아니면(트리거가 all로) 빈 프로젝트를 지우고 실패로 돌려준다');
  await sync.projectCreateCloud({ id: 'pA', title: '공개', visibility: 'all' });
  assert.ok(!('visibility' in made.at(-1)) && !deleted.includes('pA'), '공개 원본은 예전 그대로');
  for (const k of ['createProject', 'setProjectViewers', 'listProjectViewers', 'projectAudiences', 'announceProjectVisibility', 'deleteProject', '__asLeader']) delete C[k];
  console.log('PASS  복제: 직접 선택 원본 — 같은 고른 사람으로 · 리더가 아니면 지우고 실패 · 공개는 그대로 3가지');
}

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
  const cSrc = readSplit('src/services/cloud.js');
  assert.ok(/table: 'comment_reactions'/.test(cSrc), 'subscribeAll이 comment_reactions를 듣지 않는다');
  const sSrc = readFileSync(join(ROOT, 'src', 'services', 'cloudSync.js'), 'utf8');
  const route = sSrc.slice(sSrc.indexOf('export function subscribeWorkspace'));
  const i = route.indexOf("table === 'comments'");
  assert.ok(i > 0, 'comments 라우팅 분기를 찾지 못했다');
  const detailBranch = route.slice(i, route.indexOf("table === 'activity'", i));
  assert.ok(detailBranch.includes("'comment_reactions'"),
    '반응 이벤트가 전체 재조회로 흐른다 — comments와 같은 결(열린 창일 때만 상세 갱신)이어야 한다');
}

// ── 합친 계정의 알림·구독 (0063 · 감사 2026-09-11) ──────────────────────────
// 벨이 거의 비어 보이던 자리. **정책과 클라이언트가 같은 값을 봐야 한다**(§6-34-d) —
// 정책만 effective_uid()로 올리고 화면이 세션 uid로 물으면 결과가 빈 목록이다.
{
  const cSrc = readSplit('src/services/cloud.js');
  for (const fn of ['listMyNotifications', 'markAllNotificationsRead', 'savePushSubscription']) {
    const at = cSrc.indexOf(`function ${fn}(`);
    assert.ok(at > 0, `${fn}을 못 찾았다`);
    assert.ok(/await myUid\(\)/.test(cSrc.slice(at, at + 600)),
      `${fn}이 세션 uid로 묻는다 — 합친 계정에게는 알림이 안 보인다`);
  }
  // 실시간 필터(`recipient_id=eq.<id>`)도 같은 값이어야 새 알림이 들어온다
  const bellSrc = readFileSync(join(ROOT, 'src', 'components', 'notificationBell.jsx'), 'utf8'); // 19차: 알림 종은 layout.jsx에서 갈라져 나왔다
  assert.ok(/myUid\(\)\.then/.test(bellSrc), '알림 구독 필터가 세션 uid다');
  // 푸시는 남긴 계정 앞으로 온다 — 구독 행도 그 계정이어야 기기에 닿는다
  const m63 = readFileSync(join(ROOT, 'supabase', 'migrations', '0063_effective_uid_rest.sql'), 'utf8');
  const body63 = m63.slice(m63.indexOf('begin;'), m63.indexOf('commit;'))
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const p of ['"notifications_select_own"', 'push_subscriptions_insert_own']) {
    const at = body63.indexOf(`alter policy ${p} on `);
    assert.ok(at > 0, `${p}을 0063에서 못 찾았다`);
    const next = body63.indexOf('\nalter ', at + 1);
    assert.ok(/public\.effective_uid\(\)/.test(body63.slice(at, next < 0 ? body63.length : next)),
      `${p}이 아직 auth.uid()만 본다`);
  }
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const cron = (vercel.crons || []).find(c => c.path === '/api/push');
assert.ok(cron, 'vercel.json에 /api/push 크론이 없다');
assert.ok(/^\S+ \S+ \* \* \*$/.test(cron.schedule), '마감 임박은 하루 한 번 돈다');

// ── 예배 당일 배치 (0053) ───────────────────────────────────────────────────
// Vercel Hobby는 크론 **두 개까지 · 하루 한 번**이다. 그래서 라우트를 새로 파지 않고
// 같은 GET 입구를 `?job`으로 나눠 쓴다 — 갈래가 없으면 예배 크론이 마감 임박 배치를
// 한 번 더 돌려서 **같은 알림이 하루 두 번** 간다(로그를 안 보면 모른다).
{
  const worship = (vercel.crons || []).find(c => c.path === '/api/push?job=worship');
  assert.ok(worship, 'vercel.json에 예배 당일 크론(/api/push?job=worship)이 없다');
  assert.equal(worship.schedule, '30 2 * * *', '예배 당일 배치는 11:30 KST(= 02:30 UTC)에 돈다');
  assert.ok((vercel.crons || []).length <= 2, 'Hobby 요금제는 크론 두 개까지다');
  assert.ok((vercel.crons || []).every(c => /^\S+ \S+ \* \* \*$/.test(c.schedule)), '크론은 하루 한 번 스케줄만 된다');

  // 22:00 UTC는 KST로 **다음 날**이지만 02:30 UTC는 같은 날 11:30이다 — 그날 주보를 찾아야 한다.
  const fire = Date.parse('2026-09-06T02:30:00Z');
  assert.equal(api.kstDate(0, fire), '2026-09-06', '11:30 KST 배치가 그날 주보를 찾아야 한다');

  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(/req\.query\?\.job === 'worship'/.test(src), 'GET이 job=worship으로 갈리지 않는다');
  const at = src.indexOf('async function handleWorshipToday');
  assert.ok(at > 0, 'handleWorshipToday를 못 찾았다');
  // 함수 몸통만 — 다음 최상위 선언까지(파일 끝 export default까지 자르면 뒤에 붙은 마스터 알림의 .from이 걸린다 · 18차 2회)
  const end = src.slice(at + 1).search(/\n(?:export |(?:async )?function |const |\/\/ ──)/);
  const fn = src.slice(at, end > 0 ? at + 1 + end : src.indexOf('export default'));
  assert.ok(/kstDate\(0\)/.test(fn), '오늘 날짜를 KST로 세지 않는다 — UTC로 세면 하루씩 어긋난다');
  assert.ok(/eq\('status', 'published'\)/.test(fn), '작성 중인 주보로도 알림이 나간다');
  assert.ok(/eq\('approved', true\)/.test(fn) && /is\('removed_at', null\)/.test(fn),
    '승인 멤버만 골라야 한다 — 승인 전·환송한 사람에게도 종이 울린다');
  assert.ok(/kind: 'worship_today'/.test(fn), 'worship_today로 넣지 않는다');
  assert.ok(/link: w\.link/.test(fn) && /\/\?p=worship&s=/.test(fn), '딥링크(?p=worship&s=)를 싣지 않는다');
  // 같은 날 두 번 알리지 않는다 — due_soon과 같은 방어(유니크 제약을 걸 수 없다)
  assert.ok(/eq\('kind', 'worship_today'\)[\s\S]{0,120}gte\('created_at', since\)/.test(fn),
    '최근 알림을 보고 거르지 않는다 — 손으로 한 번 더 부르면 알림이 두 번 간다');
  // 마감 배치와 같은 N+1 방어: 구독·안 읽은 수는 루프 밖에서 한 번만
  const loop = fn.indexOf('for (const s of services)', fn.indexOf('if (pushReady())'));
  assert.ok(loop > 0, '예배 당일 발송 루프가 없다');
  assert.ok(/loadTargets\(/.test(fn.slice(0, loop)), '구독·안 읽은 수를 루프 밖에서 한 번에 읽지 않는다');
  assert.ok(!/\.from\(|loadTargets\(|sendToProfiles\(/.test(fn.slice(loop)), '주보마다 DB를 다시 묻고 있다 (N+1)');
  // 브라우저 모듈(services/worship.js)을 서버리스에서 import하면 supabase 클라이언트가 통째로 딸려 온다
  assert.ok(!/from '\.\.\/src\/services\/worship\.js'/.test(src),
    'api/push.js가 브라우저 모듈을 import한다 — 종류 이름은 서버에서 한 줄로 가른다');
}

// 문구 — 앱 안 알림과 푸시가 같은 함수를 본다(0053의 새 종류도 그렇다)
assert.equal(notify.notifLine('worship_today', '더다붓'), '오늘 예배가 있어요');
assert.ok(notify.isSystemNotif('worship_today'), '예배 당일 알림은 배치가 만든다 — 누가가 없다');
assert.equal(notify.notifLine('service_published', '노준석'), '노준석님이 이번 주 주보를 발행했어요');
assert.equal(notify.notifLine('note_shared', '김윤주'), '김윤주님이 예배 노트를 우리 순에 공유했어요');
assert.equal(notify.notifArea('worship_today'), 'worship');
assert.equal(notify.notifArea('service_published'), 'worship');
assert.equal(notify.notifArea('note_shared'), 'worship');
// 가이드 고정(0077) — 사용자 문구 그대로 · 누가 고정했는지 말하지 않는 시스템 갈래 · 모임 아이콘.
// DB의 CHECK와 INSERT 정책 **둘 다** 넓혀야 한다(0007에서 밟은 함정) — 고정은 마스터가 앱에서 만드는
// 알림이라 INSERT 정책에 있어야 한다. 되돌리기 검사: 0077의 정책 목록에서 'guide_pinned'를 지우면 깨진다.
assert.equal(notify.notifLine('guide_pinned', '노준석'), '이번 예배 순모임 가이드가 도착했어요!');
assert.ok(notify.isSystemNotif('guide_pinned'));
assert.equal(notify.notifArea('guide_pinned'), 'group');
{
  const m76 = readFileSync(join(ROOT, 'supabase', 'migrations', '0077_guide_pinned_notice.sql'), 'utf8').replace(/\r\n/g, '\n');
  const body76 = m76.slice(0, m76.indexOf('-- ── 확인'));
  const check76 = body76.slice(body76.indexOf('add constraint notifications_kind_check'), body76.indexOf('drop policy'));
  const pol76 = body76.slice(body76.indexOf('create policy "notifications_insert_authenticated"'));
  const wc76 = pol76.slice(0, pol76.indexOf(');'));
  const kinds = ['mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction', 'worship_today',
    'service_published', 'note_shared', 'club_apply', 'club_accepted', 'meeting_new', 'guide_pinned'];
  for (const k of kinds) assert.ok(check76.includes(`'${k}'`), `0077의 체크 제약에 ${k}가 없다`);
  assert.ok(wc76.includes("'guide_pinned'"), '가이드 고정 알림은 앱이 넣는다 — INSERT 정책에 있어야 한다');
  assert.ok(!wc76.includes("'due_soon'") && !wc76.includes("'worship_today'") && !wc76.includes("'approval'"),
    '서버·트리거가 만드는 종류를 INSERT 정책에 넣으면 로그인 사용자가 위조할 수 있다');
  assert.ok(/add column if not exists pin_notified_at timestamptz/.test(body76), '한 번만 보내는 칸(pin_notified_at)');
}

// 서비스 워커는 빌드를 타지 않으므로(public/) 파일이 그대로 배포된다
const sw = readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');
assert.ok(/addEventListener\('push'/.test(sw) && /showNotification/.test(sw), 'sw가 푸시를 띄우지 않는다');
assert.ok(/addEventListener\('notificationclick'/.test(sw), 'sw에 클릭 처리가 없다');
// 같은 tag로 갈아 끼우는 알림도 울려야 한다(renotify 없으면 두 번째부터 소리·진동이 없다 · 갤럭시 신고)
assert.ok(/renotify: true/.test(sw) && /vibrate: \[/.test(sw), 'sw 알림에 renotify·vibrate가 없다');

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
  // 카드 이벤트는 전체 재조회가 아니라 그 카드만 다시 읽어야 한다
  assert.ok(/onCard: \(id\) => cards\.add\(id\)/.test(app) && /createIdBatcher\(\(ids\) => \{ ids\.forEach\(id => syncCard\(id\)\)/.test(app),
    '카드 변경이 전체 재조회로 예약된다(그 카드만 다시 읽어야 한다)');
  // 2026-09-28 — 편집 중에 재조회를 미루지 않게 되어, 열린 창의 상세는 **갈아 끼우기 전에** 읽는다
  // (먼저 넣고 읽으면 그 왕복 동안 창의 댓글·활동이 빈다)
  assert.ok(body.indexOf('loadCardDetail') > 0 && body.indexOf('loadCardDetail') < body.indexOf('LOAD_STATE'),
    '열린 창의 상세를 LOAD_STATE 전에 읽지 않는다');
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
  const cloudSrc = readSplit('src/services/cloud.js');
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
  const src = ['components/layout.jsx', 'components/mobileNav.jsx', 'components/navParts.jsx', 'App.jsx'] // 19차: 내비가 네 파일
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
  const layout = readFileSync(join(ROOT, 'src', 'components', 'notificationBell.jsx'), 'utf8'); // 19차: 설치 줄은 종 팝오버 파일에
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

// ── 마감 임박 배치가 알림마다 다시 묻지 않는다 (N+1) ───────────────────────
// 예전에는 알림 한 건마다 sendToProfiles를 불러 **구독 조회 + 안 읽은 수 집계**를 다시
// 했다(알림 N건 → 왕복 2N번, 순차 await). 동작이 같아서 화면으로는 절대 안 보이는 낭비다.
// 되돌리기 검사: 루프를 sendToProfiles(db, [w.recipientId], …) 로 되돌리면 아래가 깨진다.
{
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  // 함수 하나만 잘라 본다 — 뒤에 다른 배치(handleWorshipToday)가 붙으면 그쪽 조회가
  // 이 검사에 섞여 들어와 엉뚱하게 실패한다.
  const from = src.indexOf('async function handleDueSoon');
  const to = src.indexOf('\nasync function ', from + 10);
  const fn = src.slice(from, to > 0 ? to : src.indexOf('export default'));
  assert.ok(fn.length > 0, 'handleDueSoon을 못 찾았다');
  const at = fn.indexOf('for (const w of fresh)');
  assert.ok(at > 0, '마감 임박 발송 루프가 없다');
  assert.ok(/loadTargets\(/.test(fn.slice(0, at)),
    '구독·안 읽은 수를 루프 밖에서 한 번에 읽지 않는다');
  assert.ok(!/\.from\(|loadTargets\(|sendToProfiles\(/.test(fn.slice(at)),
    '알림 한 건마다 DB를 다시 묻고 있다 (N+1)');
}

// ── 공용 머리 · 상한 · 크론 비밀 비교 (보안 감사 2026-09-24 · api/_lib.js) ───
// 예전에는 ai·yt·push(POST)가 **로그인만** 봐서 승인 전 계정도 제미나이·유튜브 키와 푸시를
// 쓸 수 있었고, 몸통 크기도 받는 사람 수도 끝이 없었다. 크론 비밀은 `!==`로 견줘 걸린 시간으로
// 앞자리가 샌다. 되돌리기 검사: handleWorshipToday의 safeEqual을 `bearer(req) !== secret`로
// 되돌리면 '크론 두 갈래' 줄이 깨진다.
const lib = await import('file://' + join(ROOT, 'api', '_lib.js').replace(/\\/g, '/'));
{
  assert.equal(lib.safeEqual('s3cret-value', 's3cret-value'), true, '같은 비밀을 거절한다');
  assert.equal(lib.safeEqual('s3cret-valuf', 's3cret-value'), false, '한 글자 다른 비밀을 받는다');
  assert.equal(lib.safeEqual('s3cret', 's3cret-value'), false, '길이가 다르면 던지지 말고 거절');
  assert.equal(lib.safeEqual(null, 's3cret-value'), false, '토큰이 없으면 거절');
  assert.equal(lib.safeEqual('', ''), false, '비밀이 비어 있으면 누구도 통과하지 않는다');

  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(!/bearer\(req\) !== secret/.test(src), '크론 비밀을 !==로 견준다(시간으로 앞자리가 샌다)');
  for (const fn of ['handleDueSoon', 'handleWorshipToday']) {
    const at = src.indexOf(`async function ${fn}`);
    assert.ok(/if \(!safeEqual\(bearer\(req\), secret\)\)/.test(src.slice(at, at + 400)), `크론 두 갈래 — ${fn}이 safeEqual을 안 쓴다`);
  }
  const send = src.slice(src.indexOf('async function handleSend'), src.indexOf('export const kstDate'));
  assert.ok(/requireApprovedUser\(req, res, \{ supabase: db \}\)/.test(send), 'POST가 승인을 안 본다(로그인만 본다)');
  assert.equal(api.MAX_RECIPIENTS, 50);
  assert.equal(api.MAX_PREVIEW, 200, '미리보기 상한이 DB의 알림 INSERT 정책(0053 · 200자)과 다르다');
  assert.ok(/\[\.\.\.new Set\([\s\S]*?\)\]\.slice\(0, MAX_RECIPIENTS\)/.test(send), '받는 사람을 중복 제거 뒤 상한으로 자르지 않는다');
  assert.ok(/String\(preview \|\| ''\)\.slice\(0, MAX_PREVIEW\)/.test(send), '미리보기를 자르지 않는다');
  // 제목의 '누가'는 서버가 정한다 — 몸통의 actorName('관리자')을 그대로 싣지 않는다(0071 트리거와 같은 값)
  assert.ok(/notifLine\(kind, await actorNameOf\(db, user\.id, actorName\)\)/.test(send), '푸시 제목에 몸통의 actorName을 그대로 싣는다');

  // 다섯 라우트가 한 벌의 머리를 쓴다 — 새 라우트가 승인 확인을 빼먹을 자리가 없게
  const ai = readFileSync(join(ROOT, 'api', 'ai.js'), 'utf8');
  assert.ok(/const MAX_PROMPT = 60000;/.test(ai) && /const MAX_SYSTEM = 20000;/.test(ai), 'AI 글자 상한이 없다');
  assert.ok(/status\(413\)/.test(ai), 'AI 상한을 넘으면 413으로 가르지 않는다');
  for (const f of ['ai.js', 'yt.js', 'drive.js', 'drive-file.js', 'push.js']) {
    const code = readFileSync(join(ROOT, 'api', f), 'utf8');
    assert.ok(/requireApprovedUser\(req, res/.test(code), `api/${f}가 공용 머리(requireApprovedUser)를 안 쓴다`);
    assert.ok(!/auth\.getUser\(/.test(code), `api/${f}가 세션을 따로 확인한다 — 승인 확인이 빠지는 자리다`);
    assert.ok(!/async function readJson\(/.test(code), `api/${f}에 readJson이 또 있다(_lib.js 한 벌)`);
  }
}

// ── 알림 딥링크는 우리 출처 안에서만 (서버 · 서비스 워커 · 보안 감사 2026-09-24) ──
// 앞글자만 보면(`/`로 시작 · `//` 아님) `'/\t/evil.com'`이 지나가고, 브라우저의 URL 파서가
// 탭을 지워 `//evil.com`(남의 출처)으로 연다. 서버와 워커 둘 다 브라우저와 같은 파서로 본다.
// 되돌리기 검사: sw.js의 `u.origin === self.location.origin` 확인을 지우면 워커 줄이 깨진다.
{
  const BAD = ['/\t/evil.com', '/\n/evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com/x', 'javascript:alert(1)', '', null, 42];
  for (const b of BAD) assert.equal(lib.sameOriginPath(b), null, `서버가 남의 출처 딥링크를 받는다: ${JSON.stringify(b)}`);
  assert.equal(lib.sameOriginPath('/?p=worship&s=abc'), '/?p=worship&s=abc', '주보 딥링크가 막힌다');
  assert.equal(lib.sameOriginPath('/?p=groups'), '/?p=groups');
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(/const safeLink = sameOriginPath\(link\);/.test(src) && /url: safeLink \|\| deepLink\(projectId, cardId\)/.test(src),
    'POST가 딥링크를 앞글자로만 본다');

  // 서비스 워커를 가짜 전역으로 실제로 돌려 알림 클릭이 어디를 여는지 본다
  const clickOpens = async (url) => {
    const handlers = {};
    const opened = [];
    const self = {
      location: { origin: 'https://church-workspace.vercel.app' },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting() {}, registration: { showNotification: async () => {} },
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (u) => { opened.push(u); } },
    };
    new Function('self', 'navigator', sw)(self, {});
    let wait;
    handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p) => { wait = p; } });
    await wait;
    return new URL(opened[0], self.location.origin).href;   // 거절이면 '/'(첫 화면)
  };
  for (const b of ['/\t/evil.com', '//evil.com', '/\\evil.com', 'https://evil.com/']) {
    assert.equal(await clickOpens(b), 'https://church-workspace.vercel.app/', `알림 클릭이 남의 출처를 연다: ${JSON.stringify(b)}`);
  }
  assert.equal(await clickOpens('/?p=worship&s=abc'), 'https://church-workspace.vercel.app/?p=worship&s=abc', '우리 딥링크가 안 열린다');

  // 앱이 떠 있으면 새로 불러오지 않고 제자리에서 연다(2026-10-15 · PITFALLS 55-e) — 워커가 탭을 앞으로 부르고 { open }을 보낸다.
  // 앱이 { ok: true }로 답하면 navigate하지 않는다 · ok:false거나 1초 안에 답이 없으면 예전처럼 navigate.
  // 되돌리기: sw.js의 `if (await openInPlace(...)) return shown;` 줄을 지우면 첫 단정이(늘 navigate) 깨진다.
  const clickWithTab = async (url, reply) => {
    const handlers = {};
    const log = [];
    const client = {
      focus: async () => { log.push('focus'); return client; },
      navigate: async (u) => { log.push(`navigate ${new URL(u).search}`); return client; },
      postMessage: (msg, ports) => { log.push(`message ${new URL(msg.open).search}`); if (reply !== undefined) setTimeout(() => ports[0].postMessage(reply), 20); },
    };
    const self = {
      location: { origin: 'https://church-workspace.vercel.app' },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting() {}, registration: { showNotification: async () => {} },
      clients: { claim: async () => {}, matchAll: async () => [client], openWindow: async (u) => { log.push(`open ${u}`); } },
    };
    new Function('self', 'navigator', sw)(self, {});
    let wait;
    const t0 = Date.now();
    handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: (p) => { wait = p; } });
    await wait;
    return { log, ms: Date.now() - t0 };
  };
  const inPlace = await clickWithTab('/?p=p1&t=t2', { ok: true });
  assert.deepStrictEqual(inPlace.log, ['focus', 'message ?p=p1&t=t2'], `앱이 열었다고 답하면 navigate하지 않는다: ${JSON.stringify(inPlace)}`);
  const refused = await clickWithTab('/?p=p1&t=gone', { ok: false });
  assert.deepStrictEqual(refused.log, ['focus', 'message ?p=p1&t=gone', 'navigate ?p=p1&t=gone', 'focus'], `못 연다고 답하면 곧바로 navigate: ${JSON.stringify(refused)}`);
  assert.ok(refused.ms < 600, `못 연다는 답은 1초를 기다리지 않는다(${refused.ms}ms)`);
  const silent = await clickWithTab('/?p=worship&s=abc');
  assert.deepStrictEqual(silent.log, ['focus', 'message ?p=worship&s=abc', 'navigate ?p=worship&s=abc', 'focus'], `답이 없으면(로그인 화면·옛 판) navigate: ${JSON.stringify(silent)}`);
  assert.ok(silent.ms >= 950 && silent.ms < 2000, `답을 1초 기다린다(${silent.ms}ms)`);
  // 앱 쪽 배선 — 받은 주소를 알림 종과 같은 길로 열고 MessageChannel로 답한다
  const appSrc = readFileSync(join(ROOT, 'src', 'App.jsx'), 'utf8');
  assert.ok(/sw\.addEventListener\('message', onMsg\)/.test(appSrc) && /e\.ports\?\.\[0\]\?\.postMessage\(\{ ok \}\)/.test(appSrc), '앱이 워커 메시지를 받고 답한다');
  assert.ok(/handleSearchSelect\('task', task\);\s*return true;/.test(appSrc) && /handleOpenLink\(`\$\{u\.pathname\}\$\{u\.search\}`\);\s*return true;/.test(appSrc), '업무·딥링크는 알림 종과 같은 길');
}

// ── /api/ai의 임베딩 갈래 (배치 E3 · 0073) ─────────────────────────────────────
// { embed } 갈래도 글 만들기와 **같은 인증 머리**를 지나야 한다 — 따로 두면 승인 전 계정이
// 우리 키로 임베딩을 돌린다. 제미나이는 가짜 fetch로 바꿔치고 실제 함수를 돌린다.
// 되돌리기 검사: handler에서 embed 분기를 requireApprovedUser 위로 올리면 첫 단정이 깨진다.
{
  const aiApi = await import('file://' + join(ROOT, 'api', 'ai.js').replace(/\\/g, '/'));
  const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const realFetch = globalThis.fetch;
  const prevKey = process.env.GEMINI_API_KEY;
  const calls = [];
  let reply = null;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init?.body || '{}') }); return reply(); };
  try {
    process.env.GEMINI_API_KEY = 'test-key';
    // ① 토큰이 없으면 제미나이를 부르기 전에 401
    reply = () => { throw new Error('인증 전에 밖으로 나갔다'); };
    const r1 = fakeRes();
    await aiApi.default({ method: 'POST', headers: {}, body: { embed: '두려울 때' } }, r1);
    assert.equal(r1.code, 401, '임베딩 갈래가 인증 머리를 지나지 않는다');
    assert.equal(calls.length, 0, '인증 전에 제미나이를 불렀다');

    // ② 성공 — RETRIEVAL_QUERY · 768 · 500자로 자름 · 단위 길이로 맞춰 돌려준다
    const raw = Array.from({ length: 768 }, (_, i) => Math.cos(i) * 0.021);   // 길이 약 0.58(실제 출력과 비슷)
    reply = () => new Response(JSON.stringify({ embedding: { values: raw } }), { status: 200 });
    const r2 = fakeRes();
    await aiApi.handleEmbed('  위로 ' + '가'.repeat(700), 'test-key', r2);
    assert.equal(r2.code, 200);
    assert.equal(r2.body.vec.length, 768);
    assert.ok(Math.abs(Math.hypot(...r2.body.vec) - 1) < 1e-9, '질문 벡터를 단위 길이로 맞추지 않는다(절 쪽과 어긋난다)');
    const sent = calls.at(-1);
    assert.match(sent.url, /models\/gemini-embedding-001:embedContent$/);
    assert.equal(sent.body.taskType, 'RETRIEVAL_QUERY');
    assert.equal(sent.body.outputDimensionality, 768);
    assert.equal(sent.body.content.parts[0].text.length, 500, '질문을 500자로 자르지 않는다');
    assert.ok(sent.body.content.parts[0].text.startsWith('위로 '), '앞뒤 공백을 걷지 않는다');

    // ③ 빈 질문 400 · 차원이 다르면 502 · 제미나이 오류 502
    const r3 = fakeRes(); await aiApi.handleEmbed('   ', 'test-key', r3);
    assert.equal(r3.code, 400);
    const r3b = fakeRes(); await aiApi.handleEmbed(42, 'test-key', r3b);
    assert.equal(r3b.code, 400, '글자가 아닌 embed를 받는다');
    reply = () => new Response(JSON.stringify({ embedding: { values: raw.slice(0, 100) } }), { status: 200 });
    const r4 = fakeRes(); await aiApi.handleEmbed('위로', 'test-key', r4);
    assert.equal(r4.code, 502, '차원이 다른 벡터를 돌려준다');
    reply = () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    const r5 = fakeRes(); await aiApi.handleEmbed('위로', 'test-key', r5);
    assert.equal(r5.code, 502);
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
  }
  const src = readFileSync(join(ROOT, 'api', 'ai.js'), 'utf8');
  assert.ok(src.indexOf('await requireApprovedUser(req, res)') < src.indexOf('if (body.embed != null)'), '임베딩 분기가 인증보다 앞에 있다');
}

// ── Gemini 한 번(_lib.geminiFetch) · 시간 초과 판정(_lib.isTimeout) — 19차 ─────────────────────
// 서버의 시간 상한은 AbortSignal.timeout이다 — 끊기면 AbortError가 아니라 **TimeoutError**가 온다. 판정을 옛 이름으로 두면
// 시간 초과가 504(다시 해 볼 만한 실패)가 아니라 502로 떨어지고 위키 gen은 다시 부르지 않는다.
// 되돌리기 검사: isTimeout을 'AbortError'로 되돌리거나 geminiFetch에서 signal을 빼면 아래가 깨진다.
{
  const lib = await import('file://' + join(ROOT, 'api', '_lib.js').replace(/\\/g, '/'));
  const aiApi = await import('file://' + join(ROOT, 'api', 'ai.js').replace(/\\/g, '/'));
  const WB = await import('file://' + join(ROOT, 'api', '_wikiBuild.js').replace(/\\/g, '/'));
  const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  // ① 진짜 fetch + AbortSignal.timeout — 답하지 않는 로컬 서버에서 TimeoutError가 온다(노드가 정한 이름)
  const http = await import('node:http');
  const srv = http.createServer(() => {});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const hung = await fetch(`http://127.0.0.1:${srv.address().port}/`, { signal: AbortSignal.timeout(50) }).then(() => null, e => e);
  srv.closeAllConnections(); srv.close();
  assert.ok(lib.isTimeout(hung) && hung.name !== 'AbortError', `시간 상한에 끊긴 fetch를 시간 초과로 못 가른다(${hung?.name})`);
  assert.ok(!lib.isTimeout(new TypeError('fetch failed')) && !lib.isTimeout(null), '시간 초과가 아닌 실패를 시간 초과로 본다');
  const realFetch = globalThis.fetch;
  try {
    // ② geminiFetch — 주소 · 키 머리 · 몸통 · 시간 상한 신호(신호가 없으면 아래가 2초 안에 안 끝난다)
    const seen = [];
    globalThis.fetch = (url, init) => { seen.push({ url: String(url), init }); return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(init.signal.reason))); };
    const t0 = Date.now();
    const cut = await Promise.race([lib.geminiFetch('m-1', 'embedContent', { a: 1 }, { key: 'k', ms: 40 }).then(() => null, e => e), new Promise(r => setTimeout(() => r('안 끊김'), 2000))]);
    assert.ok(lib.isTimeout(cut) && Date.now() - t0 < 2000, `geminiFetch가 시간 상한에 끊기지 않는다(${cut?.name || cut})`);
    assert.equal(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/m-1:embedContent');
    assert.equal(seen[0].init.headers['x-goog-api-key'], 'k');
    assert.deepEqual(JSON.parse(seen[0].init.body), { a: 1 });
    // ③ /api/ai — 시간 초과는 504(안내 문구 그대로) · 닿지 못함은 502
    globalThis.fetch = async () => { throw new DOMException('signal timed out', 'TimeoutError'); };
    const r1 = fakeRes(); await aiApi.handleEmbed('위로', 'k', r1);
    assert.equal(r1.code, 504, '시간 초과가 504로 가지 않는다');
    assert.equal(r1.body.error, '요청이 제때 끝나지 않았어요\n잠시 후 다시 시도해주세요');
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const r2 = fakeRes(); await aiApi.handleEmbed('위로', 'k', r2);
    assert.equal(r2.code, 502);
    // ④ 위키 gen — 시간 초과만 tries만큼 다시 부르고 마지막 TimeoutError를 던진다(다붓이 답이 504로) · 다른 실패는 한 번
    let n = 0;
    globalThis.fetch = async () => { n++; throw new DOMException('signal timed out', 'TimeoutError'); };
    const ge = await WB.gen('s', 't', { key: 'k', tries: 2 }).then(() => null, e => e);
    assert.ok(lib.isTimeout(ge) && n === 2, `gen이 시간 초과를 다시 부르지 않는다(${n}번)`);
    n = 0;
    globalThis.fetch = async () => { n++; throw new TypeError('fetch failed'); };
    await WB.gen('s', 't', { key: 'k', tries: 3 }).catch(() => {});
    assert.equal(n, 1, '시간 초과가 아닌 실패를 다시 부른다');
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('PASS  Gemini 한 번(_lib) · 시간 초과는 TimeoutError(504 · 위키 다시 부르기)');
}

// ── 8시 크론에 얹은 문서 임베딩 (배치 E4 · 0074 doc_vec · api/_docsync.js) ────────────
// 크론 자리가 둘뿐이라 마감 임박 배치 **뒤에** 얹었다. 지켜야 할 것: 알림이 먼저 · 임베딩이 죽어도
// 알림 응답은 그대로 · 비밀 없이는 둘 다 안 돈다 · ?job=embed도 같은 비밀 · 함수 시간 제한 안.
// Supabase(PostgREST)와 제미나이를 가짜 fetch 하나로 바꿔치고 실제 handler를 돌린다.
// 되돌리기 검사: handleDueSoonThenEmbed에서 runEmbedSync를 handleDueSoon 앞으로 올리면 '알림이 먼저'가,
// runEmbedSync의 try/catch를 걷으면 '임베딩이 죽어도 알림 응답은 200'이, handleEmbedJob의 safeEqual 줄을
// 지우면 '?job=embed는 비밀이 있어야'가 깨진다.
{
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.equal(vercel.functions?.['api/push.js']?.maxDuration * 1000, api.PUSH_MAX_MS, 'push.js의 PUSH_MAX_MS가 vercel.json maxDuration과 다르다');
  assert.equal((vercel.crons || []).length, 2, '임베딩은 새 크론이 아니라 8시 크론에 얹는다(Hobby 두 개 상한)');
  assert.ok(!(vercel.crons || []).some(c => /job=embed/.test(c.path)), '?job=embed는 손으로 부르는 길이다 — 크론 자리를 쓰지 않는다');
  assert.ok(/if \(req\.query\?\.job === 'embed'\) return await handleEmbedJob\(req, res, started\);/.test(src), 'GET이 job=embed로 갈리지 않는다');
  assert.ok(/return await handleDueSoonThenEmbed\(req, res, started\);/.test(src), 'job 없는 GET(8시 크론)이 임베딩을 얹은 길로 가지 않는다');
  {
    const at = src.indexOf('async function handleEmbedJob');
    assert.ok(/if \(!safeEqual\(bearer\(req\), secret\)\)/.test(src.slice(at, at + 400)), 'handleEmbedJob이 크론 비밀(safeEqual)을 안 본다');
  }
  // 예산 — 남은 시간에서 여유를 빼고 40초를 넘지 않는다
  assert.equal(api.embedBudget(1000, 1000), api.EMBED_BUDGET_MS);
  assert.ok(api.embedBudget(0, 30000) <= api.PUSH_MAX_MS - 30000 - 5000, '알림 배치가 쓴 시간을 예산에서 빼지 않는다');
  assert.equal((await api.runEmbedSync(1000)).skipped != null, true, '예산이 5초도 안 남았는데 임베딩을 시작한다');

  const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const realFetch = globalThis.fetch;
  const saved = Object.fromEntries(['CRON_SECRET', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GEMINI_API_KEY'].map(k => [k, process.env[k]]));
  const calls = [];
  let geminiFails = false;
  let trashRows = [];   // 휴지통(0104) — ⑤에서 채운다
  const CARD = '11111111-1111-4111-8111-111111111111';
  const table = (url) => /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    const method = (init.method || input?.method || 'GET').toUpperCase();
    const t = table(url);
    calls.push({ url, method, t: t || (url.includes('generativelanguage') ? 'gemini' : '?') });
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('generativelanguage')) {
      if (geminiFails) return json({ error: { message: 'bad' } }, 400);
      const n = JSON.parse(init.body).requests.length;
      return json({ embeddings: Array.from({ length: n }, (_, i) => ({ values: Array.from({ length: 768 }, (_, j) => Math.cos(i + j)) })) });
    }
    if (t === 'cards' && /due_date/.test(decodeURIComponent(url))) return json([]);   // 마감 임박 없음
    // 휴지통(0104 · api/_trash.js) — 지운 표시가 있는 행 읽기 · 정리 크론의 행 삭제
    if ((t === 'cards' || t === 'projects') && /deleted_at=not\.is\.null/.test(decodeURIComponent(url))) return json(t === 'cards' ? trashRows : []);
    if (t === 'cards' && method === 'DELETE') return new Response(null, { status: 204 });
    if (t === 'cards') return json([{ id: CARD, project_id: null, title: '수련회 숙소', description: '2박 3일 예약' }]);
    if (t === 'projects' || t === 'comments' || t === 'files') return json([]);
    if (t === 'doc_vec' && method === 'GET') return json([]);
    if (t === 'doc_vec') return new Response(null, { status: 201 });
    return json([]);
  };
  try {
    Object.assign(process.env, { CRON_SECRET: 'cron-test-secret', VITE_SUPABASE_URL: 'http://supabase.test', SUPABASE_SECRET_KEY: 'svc', GEMINI_API_KEY: 'gem' });
    const auth = { authorization: 'Bearer cron-test-secret' };

    // ① 비밀이 없으면 401 · 아무것도 안 부른다
    const r1 = fakeRes();
    await api.default({ method: 'GET', headers: {}, query: {} }, r1);
    assert.equal(r1.code, 401);
    assert.equal(calls.length, 0, '크론 비밀 없이 DB·제미나이를 불렀다');

    // ② 8시 크론: 알림(마감 임박 조회)이 먼저, 그다음 임베딩 · 응답에 둘 다
    const r2 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: {} }, r2);
    assert.equal(r2.code, 200);
    assert.equal(r2.body.cards, 0, '마감 임박 응답이 빠졌다');
    assert.equal(r2.body.embed?.embedded, 1, `임베딩이 안 돌았다: ${JSON.stringify(r2.body.embed)}`);
    const firstDue = calls.findIndex(c => c.t === 'cards' && /due_date/.test(decodeURIComponent(c.url)));
    const firstEmbed = calls.findIndex(c => c.t === 'doc_vec' || c.t === 'gemini' || c.t === 'projects');
    assert.ok(firstDue === 0 && firstEmbed > firstDue, '알림이 먼저다 — 임베딩이 마감 임박 배치보다 앞서 돈다');
    const up = calls.find(c => c.t === 'doc_vec' && c.method === 'POST');
    assert.ok(up && /on_conflict=kind%2Csource_id%2Cchunk|on_conflict=kind,source_id,chunk/.test(up.url), 'doc_vec upsert가 (kind, source_id, chunk) 열쇠를 안 쓴다');

    // ③ 임베딩이 죽어도(제미나이 400) 알림 응답은 그대로 200
    calls.length = 0; geminiFails = true;
    const r3 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: {} }, r3);
    assert.equal(r3.code, 200, '임베딩 실패가 알림 크론을 죽였다');
    assert.equal(r3.body.cards, 0);
    assert.equal(r3.body.embed?.error, '실패');
    geminiFails = false;

    // ④ ?job=embed — 비밀 없으면 401(아무것도 안 부름) · 있으면 임베딩만(마감 임박 조회 없음)
    calls.length = 0;
    const r4 = fakeRes();
    await api.default({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: { job: 'embed' } }, r4);
    assert.equal(r4.code, 401, '?job=embed가 비밀 없이 돈다');
    assert.equal(calls.length, 0);
    const r5 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: { job: 'embed' } }, r5);
    assert.equal(r5.code, 200);
    assert.equal(r5.body.embed?.embedded, 1);
    assert.ok(!calls.some(c => c.t === 'cards' && /due_date/.test(decodeURIComponent(c.url))), '?job=embed가 마감 임박 알림까지 돌린다');
    assert.ok(!calls.some(c => c.t === 'notifications'), '?job=embed가 알림 표를 건드린다');

    // ⑤ 휴지통 30일 정리(0104 · api/_trash.js purgeTrash) — 8시 크론이 마감 알림 뒤 · 임베딩 앞에 돈다.
    //    31일 전에 지운 업무는 행을 지우고, 3일 전에 지운 업무는 남긴다 · 지운 업무는 임베딩 원본에서도 빠진다.
    //    **되돌리기**: push.js handleDueSoonThenEmbed에서 runTrashPurge 줄을 빼면 첫 단정이, trashItems.purgePlan의
    //    `old(c.deleted_at)` 거르기를 빼면 '3일 전 것은 남긴다'가 깨진다.
    calls.length = 0;
    const OLD = '22222222-2222-4222-8222-222222222222';
    trashRows = [
      { id: OLD, project_id: 'p-old', deleted_at: new Date(Date.now() - 31 * 864e5).toISOString(), drive_folder_id: null },
      { id: CARD, project_id: null, deleted_at: new Date(Date.now() - 3 * 864e5).toISOString(), drive_folder_id: null },
    ];
    const r6 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: {} }, r6);
    const del = calls.filter(c => c.t === 'cards' && c.method === 'DELETE');
    assert.equal(r6.body.trash?.cards, 1, `휴지통 정리가 안 돌았다: ${JSON.stringify(r6.body.trash)}`);
    assert.ok(del.length === 1 && decodeURIComponent(del[0].url).includes(OLD) && !decodeURIComponent(del[0].url).includes(CARD), '30일 지난 것만 지우고 3일 전 것은 남긴다');
    const firstPurge = calls.indexOf(del[0]);
    assert.ok(firstPurge > 0 && firstPurge < calls.findIndex(c => c.t === 'doc_vec'), '정리는 임베딩보다 앞이다');
    assert.equal(r6.body.embed?.embedded, 0, '휴지통의 업무를 임베딩했다');
    trashRows = [];
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── 동아리 모임 전날 알림 (0078 · 11:30 크론의 두 번째 갈래) ─────────────────────
// 사용자 결정: 모임 **전날**, 그 동아리 구성원에게만 앱 안 알림 + 푸시 한 통 · 당일은 없음.
// 되돌리기 검사: handleMeetingEve의 kstDate(1)을 kstDate(0)으로 바꾸면 '내일 날짜로 찾는다'가,
// meetingEveRows에서 seen(recent) 거르기를 걷으면 '두 번 돌아도 한 번'이, 동아리장 줄을 빼면
// '동아리장도 받는다'가, handleWorshipThenMeetings에서 모임 갈래를 빼면 E2E가 깨진다.
{
  // 문구 — 동아리 이름은 actor_name 칸에서 온다(종 팝오버도 그 값을 넘긴다)
  assert.equal(notify.notifLine('meeting_tomorrow', '통통'), '내일 통통 모임이 있어요');
  assert.equal(notify.notifLine('meeting_tomorrow', ''), '내일 동아리 모임이 있어요', '이름이 비면 문구가 깨진다');
  assert.ok(notify.isSystemNotif('meeting_tomorrow'));
  assert.equal(notify.notifArea('meeting_tomorrow'), 'group');
  const bellSrc2 = readFileSync(join(ROOT, 'src', 'components', 'notificationBell.jsx'), 'utf8'); // 19차: 종은 notificationBell.jsx
  assert.ok(/notifLine\(n\.kind, n\.actor_name\)/.test(bellSrc2), '종 팝오버가 시스템 알림에 actor_name(동아리 이름)을 넘기지 않는다');

  // 내일(KST) 경계 — 11:30 KST(02:30 UTC)에 돌면 내일은 KST 다음 날 · KST 자정(15:00 UTC)에서 넘어간다
  assert.equal(api.kstDate(1, Date.parse('2026-09-26T02:30:00Z')), '2026-09-27', '11:30 배치의 내일');
  assert.equal(api.kstDate(1, Date.parse('2026-09-26T14:59:00Z')), '2026-09-27', 'KST 23:59의 내일');
  assert.equal(api.kstDate(1, Date.parse('2026-09-26T15:00:00Z')), '2026-09-28', 'KST 자정이 지나면 내일도 넘어간다');
  assert.equal(api.kstDate(1, Date.parse('2026-12-31T02:30:00Z')), '2027-01-01', '해 넘김');

  // 링크는 앱의 동아리 알림(groups.js clubLink)과 같은 모양이어야 한다
  assert.equal(api.clubLink('g1'), '/?p=groups&g=g1');
  const gSrc = readFileSync(join(ROOT, 'src', 'services', 'groups.js'), 'utf8');
  assert.ok(gSrc.includes("export const clubLink = (groupId) => (groupId ? `/?p=groups&g=${groupId}` : '/?p=groups');"),
    'services/groups.js clubLink와 api/push.js clubLink가 갈라졌다');

  // 대상 고르기(순수)
  const club = (id, extra = {}) => ({ id, name: '통통', type: 'club', removed_at: null, leader_person_id: 'lead', group_members: [{ person_id: 'a' }, { person_id: 'b' }, { person_id: 'noacct' }], ...extra });
  const accounts = new Map([['lead', 'U-lead'], ['a', 'U-a'], ['b', 'U-b'], ['x', 'U-x']]);
  let rows = api.meetingEveRows([{ group_id: 'g1', title: ' 9월 모임 ', groups: club('g1') }], accounts, []);
  assert.deepEqual(rows.map(r => r.recipientId).sort(), ['U-a', 'U-b', 'U-lead'], '구성원+동아리장 중 계정 있는 사람만');
  assert.ok(rows.every(r => r.link === '/?p=groups&g=g1' && r.club === '통통' && r.preview === '9월 모임'));
  rows = api.meetingEveRows([{ group_id: 'g1', title: '', groups: club('g1') }], accounts, []);
  assert.ok(rows.every(r => r.preview === null), '제목이 없으면 preview를 비운다');
  // 중복 방지 — 이미 받은 (사람, 링크)는 빠진다 · 한 동아리에 내일 모임이 둘이어도 한 통
  rows = api.meetingEveRows([{ group_id: 'g1', groups: club('g1') }, { group_id: 'g1', title: '둘째', groups: club('g1') }],
    accounts, [{ recipient_id: 'U-a', link: '/?p=groups&g=g1' }]);
  assert.deepEqual(rows.map(r => r.recipientId).sort(), ['U-b', 'U-lead'], '크론이 두 번 돌면 두 통 간다');
  // 순·지운 동아리는 대상이 아니다 · 다른 동아리 구성원은 받지 않는다
  assert.equal(api.meetingEveRows([{ group_id: 's', groups: club('s', { type: 'sun' }) }], accounts, []).length, 0);
  assert.equal(api.meetingEveRows([{ group_id: 'r', groups: club('r', { removed_at: '2026-01-01' }) }], accounts, []).length, 0);
  assert.ok(!api.meetingEveRows([{ group_id: 'g1', groups: club('g1') }], accounts, []).some(r => r.recipientId === 'U-x'),
    '그 동아리 밖의 사람에게 간다');

  // 마이그레이션 0078 — CHECK에만 더하고 INSERT 정책은 건드리지 않는다(서버가 서비스 키로 넣는다)
  const m78 = readFileSync(join(ROOT, 'supabase', 'migrations', '0078_meeting_tomorrow_notice.sql'), 'utf8').replace(/\r\n/g, '\n');
  const body78 = m78.slice(0, m78.indexOf('-- ── 확인'));
  const check78 = body78.slice(body78.indexOf('add constraint notifications_kind_check'));
  for (const k of ['mention', 'reply', 'assign', 'due_soon', 'approval', 'reaction', 'worship_today', 'service_published',
    'note_shared', 'club_apply', 'club_accepted', 'meeting_new', 'approved', 'guide_pinned', 'meeting_tomorrow']) {
    assert.ok(check78.includes(`'${k}'`), `0078의 체크 제약에 ${k}가 없다`);
  }
  assert.ok(!/^\s*(create|drop) policy/m.test(body78), '0078이 INSERT 정책을 건드린다 — 로그인 사용자가 위조할 수 있게 된다');
  assert.equal((vercel.crons || []).length, 2, '모임 전날 알림은 새 크론이 아니라 11:30 배치에 얹는다');

  // E2E — 가짜 PostgREST로 실제 handler(?job=worship)를 돌린다
  const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const realFetch = globalThis.fetch;
  const saved = Object.fromEntries(['CRON_SECRET', 'VITE_SUPABASE_URL', 'SUPABASE_SECRET_KEY'].map(k => [k, process.env[k]]));
  const calls = [];
  let recentRows = [];
  let servicesFail = false;
  const table = (url) => /\/rest\/v1\/([a-z_]+)/.exec(url)?.[1];
  globalThis.fetch = async (input, init = {}) => {
    const url = decodeURIComponent(String(input?.url || input));
    const method = (init.method || input?.method || 'GET').toUpperCase();
    const t = table(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, t, body });
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (t === 'services') return servicesFail ? json({ message: 'boom' }, 500) : json([]);
    if (t === 'group_meetings') return json([{ id: 'm1', group_id: 'g1', title: '9월 모임', meeting_date: api.kstDate(1), groups: club('g1') }]);
    if (t === 'people') return json([{ id: 'lead', profile_id: 'P-lead' }, { id: 'a', profile_id: 'P-a' }, { id: 'b', profile_id: 'P-b' }]);
    if (t === 'profiles') return json([{ id: 'P-lead', merged_into: null }, { id: 'P-a', merged_into: 'P-keep' }, { id: 'P-b', merged_into: null }]);
    if (t === 'notifications' && method === 'GET') return json(recentRows);
    if (t === 'notifications' && method === 'POST') return new Response(null, { status: 201 });
    return json([]);
  };
  try {
    Object.assign(process.env, { CRON_SECRET: 'cron-test-secret', VITE_SUPABASE_URL: 'http://supabase.test', SUPABASE_SECRET_KEY: 'svc' });
    const auth = { authorization: 'Bearer cron-test-secret' };
    const r0 = fakeRes();
    await api.default({ method: 'GET', headers: {}, query: { job: 'worship' } }, r0);
    assert.equal(r0.code, 401);
    assert.equal(calls.length, 0, '크론 비밀 없이 DB를 불렀다');

    const r1 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: { job: 'worship' } }, r1);
    assert.equal(r1.code, 200);
    const q = calls.find(c => c.t === 'group_meetings');
    assert.ok(q && q.url.includes(`meeting_date=eq.${api.kstDate(1)}`), `내일(KST) 날짜로 찾지 않는다: ${q?.url}`);
    const ins = calls.find(c => c.t === 'notifications' && c.method === 'POST');
    assert.ok(ins, '모임 전날 알림을 넣지 않는다');
    assert.deepEqual(ins.body.map(r => r.recipient_id).sort(), ['P-b', 'P-keep', 'P-lead'], '합친 계정은 남긴 계정으로 · 동아리장 포함');
    assert.ok(ins.body.every(r => r.kind === 'meeting_tomorrow' && r.actor_name === '통통' && r.link === '/?p=groups&g=g1' && r.preview === '9월 모임'));
    assert.equal(r1.body.meeting?.notified, 3);

    // 두 번째 실행 — 최근 20시간 안에 넣은 것이 보이면 아무것도 넣지 않는다
    recentRows = ins.body.map(r => ({ recipient_id: r.recipient_id, link: r.link }));
    calls.length = 0;
    const r2 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: { job: 'worship' } }, r2);
    const rq = calls.find(c => c.t === 'notifications' && c.method === 'GET');
    assert.ok(rq && rq.url.includes('kind=eq.meeting_tomorrow') && /created_at=gte\./.test(rq.url), '최근 알림을 보고 거르지 않는다');
    assert.ok(!calls.some(c => c.t === 'notifications' && c.method === 'POST'), '크론이 두 번 돌면 알림이 두 번 간다');
    assert.equal(r2.body.meeting?.notified, 0);

    // 예배 당일 갈래가 DB 오류로 죽어도 모임 갈래는 돈다
    recentRows = []; servicesFail = true; calls.length = 0;
    const r3 = fakeRes();
    await api.default({ method: 'GET', headers: auth, query: { job: 'worship' } }, r3);
    assert.ok(calls.some(c => c.t === 'notifications' && c.method === 'POST'), '예배 갈래 실패가 모임 전날 알림을 막았다');
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── 알림 종류별 설정이 **푸시**도 막는다(0113 · profiles.notif_off) ─────────────────────────────
// 앱 안 알림 행은 DB 트리거(trg_notifications_off)가 막고, 푸시는 모든 발송이 지나는 loadTargets 한 곳이 같은 표(notifyPrefs)로 거른다.
// **되돌리기**(§3-5): loadTargets의 `ids = allowedByPrefs(ids, prefs, kind)` 줄을 지우면 ③이, 배치 하나의 kind 인자를 빼면 ④가,
// notifyPrefs.notifAllowed의 표 밖 통과(`if (!s) return true;`)를 빼면 ①의 feedback_fixed 줄이 깨진다.
{
  const ids = ['a', 'b', 'c', 'd'];
  const rows = [{ id: 'a', notif_off: ['task'] }, { id: 'b', notif_off: ['task.due'] }, { id: 'c', notif_off: ['task.mention'] }, { id: 'd', notif_off: [] }];
  // ① 순수 판정 — 갈래 · 항목 · 표 밖 · 칸 없음
  assert.deepEqual(api.allowedByPrefs(ids, rows, 'due_soon'), ['c', 'd'], '① 업무 갈래·마감 임박을 끈 사람은 마감 푸시를 안 받는다');
  assert.deepEqual(api.allowedByPrefs(ids, rows, 'mention'), ['b', 'd'], '① 멘션만 끈 사람');
  assert.deepEqual(api.allowedByPrefs(ids, rows, 'lock_reset'), ['b', 'c', 'd'], '① 항목 칩이 없는 lock_reset은 갈래로만');
  assert.deepEqual(api.allowedByPrefs(ids, [{ id: 'a', notif_off: ['task', 'worship', 'group', 'join'] }], 'feedback_fixed'), ids, '① 해결 알림은 다 꺼도 간다(표 밖)');
  assert.deepEqual(api.allowedByPrefs(ids, [{ id: 'a' }], 'reply'), ids, '① 칸이 없으면(0113 전) 다 통과');
  assert.deepEqual(api.allowedByPrefs(ids, rows, null), ids, '① kind가 없으면(다붓이 마스터 알림) 그대로');
  // ② 가짜 DB로 loadTargets — 끈 사람의 구독은 손에 들지 않는다
  const fakeDb = (tables, fail = {}) => ({
    from: (t) => {
      let keep = () => true;
      const q = { select: () => q, eq: () => q, in: (col, vals) => { const k0 = keep; keep = (r) => k0(r) && vals.includes(r[col]); return q; },
        then: (ok, ko) => Promise.resolve(fail[t] ? { data: null, error: fail[t] } : { data: (tables[t] || []).filter(keep), error: null }).then(ok, ko) };
      return q;
    },
  });
  const tables = {
    profiles: rows,
    push_subscriptions: ids.map(id => ({ profile_id: id, endpoint: `https://push/${id}`, p256dh: 'k', auth: 'a' })),
    notifications: [],
  };
  const t1 = await api.loadTargets(fakeDb(tables), ids, 'worship_today');
  assert.deepEqual([...t1.byProfile.keys()].sort(), ids, '② 아무도 안 끈 갈래는 모두');
  const t2 = await api.loadTargets(fakeDb(tables), ids, 'due_soon');
  // ③
  assert.deepEqual([...t2.byProfile.keys()].sort(), ['c', 'd'], '③ 끈 사람의 기기로는 보내지 않는다');
  const t3 = await api.loadTargets(fakeDb(tables, { profiles: { code: '42703', message: 'column does not exist' } }), ids, 'due_soon');
  assert.equal(t3.byProfile.size, 4, '③ 칸이 없으면(0113 전 · 42703) 거르지 않는다');
  const t4 = await api.loadTargets(fakeDb(tables, { profiles: { code: '500', message: 'boom' } }), ids, 'due_soon');
  assert.equal(t4.byProfile.size, 0, '③ 설정을 못 읽으면 보내지 않는다(닫힌 쪽)');
  // ④ 배선 — 앱이 부탁하는 POST와 배치 셋이 모두 kind와 함께 loadTargets를 지난다
  const src = readFileSync(join(ROOT, 'api', 'push.js'), 'utf8');
  assert.ok(/loadTargets\(db, fresh\.map\(w => w\.recipientId\), 'due_soon'\)/.test(src), '④ 마감 임박 배치');
  assert.ok(/loadTargets\(db, wanted\.map\(w => w\.recipientId\), 'meeting_tomorrow'\)/.test(src), '④ 모임 전날 배치');
  assert.ok(/loadTargets\(db, wanted\.map\(w => w\.recipientId\), 'worship_today'\)/.test(src), '④ 예배 당일 배치');
  assert.ok(/\}, typeof kind === 'string' \? kind : null\);\n\s+res\.status\(200\)\.json\(result\);/.test(src) && /const targets = await loadTargets\(db, ids, kind\);/.test(src), '④ 앱이 부탁하는 POST');
  console.log('PASS push — 알림 종류별 설정(0113): 끈 사람에게는 푸시 없음 · 표 밖 해결 알림은 간다 · 칸 없으면 통과 · 못 읽으면 닫힘 · 배선 넷');
}

console.log('PASS push — 문구·KST 날짜·딥링크·insert 모양·새 담당자만·댓글 반응(토글·본인 제외·표 없어도 안 죽음·RLS·실시간 라우팅·칩 라벨·아이콘 가운데·얼굴 인라인/+N)·마이그레이션·크론(마감 임박 + 예배 당일 job 갈래·중복 방지·N+1 없음 · 8시 뒤 문서 임베딩·job=embed)·sw·재조회 상세 복구·저장이 목록을 안 덮음·manifest·설치 안내·뱃지 수·합친 계정의 알림·구독(0063)·동아리 모임 전날(0078 · 내일 KST·대상·중복 방지·문구)');
