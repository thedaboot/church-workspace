import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserCheck, UserX, ShieldCheck, Shield, Plus, Loader2, Merge } from 'lucide-react';
import { Avatar } from '../components/Avatar.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { RosterPanel } from '../components/roster.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText, objectParticle } from '../services/errorText.js';
import { agoLabel, visitOrder, isoTime, mergeActivitySeen } from '../utils.js';
import { usePresence } from '../services/presence.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import { useEnterStagger } from '../hooks/useEnterStagger.js';
import { useStore } from '../store/workspaceStore.js';
import { selectMembers, selectActivityFeed } from '../store/selectors.js';
import * as cloud from '../services/cloud.js';
import { isCloudEnabled } from '../services/supabaseClient.js';
import { readCache, writeCache, dropCache } from '../services/cache.js';
import { useLiveTick } from '../services/liveV2.js';
import * as roster from '../services/roster.js';

// ============================================================================
// 전역 '멤버' 화면 — 관리자만 (0022)
// ----------------------------------------------------------------------------
// 사용자가 "전역 화면 신설"로 정했다. 대시보드의 '가입한 사람' 목록(MembersModal)은
// **누가 있는지 보는 자리**로 그대로 두고, 여기는 **손을 대는 자리**다.
//
// 네 가지만 한다. 승인 대기 수락 · 환송해주기 · 다시 초대하기 · 관리자 지정·해제.
// '환송해주기'는 접근만 끊는다(0022) — 지난 댓글·기록의 이름은 그대로 남는다.
// 환송한 사람은 '승인을 기다리는 사람'으로 **다시 올라오지 않는다**(0027):
// approved 하나로 둘을 겸했더니 방금 내보낸 사람을 다시 수락하라고 화면이 졸랐다.
// 계정을 지우는 길은 두지 않았다 — 프로필 행을 지워도 다시 로그인하면 되살아나고
// (auth.users가 남는다), 계정을 지우려면 뭔가 쓴 적 있는 사람은 DB가 막는다.
//
// 관리자 지정은 **가입자 목록에서 고른다**. 예전에는 이메일을 타이핑해야 했는데
// (관리자 원본이 `admins.email`이고 profiles에 이메일이 없었다), 0028이
// `profiles.email`을 채워서 얼굴·이름으로 고를 수 있게 됐다. 지정·해제 버튼은
// **마스터에게만 보인다** — DB도 막는다(0029). 화면만 감추는 상태를 만들지 않는다.
//
// ── v2에서 붙은 '청년 명단' 탭 (docs/V2.md 결정 1·13 · 권한 표: 마스터 + 관리자) ──
// 청년 ~50명은 대부분 계정이 없다. 그래서 사람의 축이 둘이다 —
//   **가입자**(profiles)   = 워크스페이스에 가입한 사람. 위의 네 가지가 그대로다.
//   **청년 명단**(people)  = 청년부 전체. 출석·순 편성이 이 축을 쓴다.
// 둘을 잇는 열쇠가 `people.profile_id`이고, **관리자가 눈으로 골라** 연결한다.
// 이름이 같아도 자동으로 연결하지 않는다(§6-26).
// (탭 이름은 사용자가 정했다 — 2026-09-05 '계정' → '가입자' · '명단' → '청년 명단'.)
//
// 명단 쪽 통신은 전부 여기서 하고(services/roster.js), 화면은 props만 받는
// components/roster.jsx가 그린다 — 게스트 스위트가 가짜 명단으로 눌러 볼 수 있게.
// 게스트 모드에는 클라우드가 없으므로 계정 목록도 roster.guestProfiles()로 떨어진다
// (예전에는 여기서 던져서 콘솔 오류와 토스트가 같이 났다).
//
// **명단 한 벌은 캐시를 먼저 그린다**(services/cache.js — 홈·예배·말씀과 같은 방식).
// 예전에는 탭을 누를 때마다 `setBook(null)`로 되돌려 네 번의 왕복을 기다리는 동안
// 스켈레톤이 다시 떴다(사용자 지적 2026-09-05 — "명단이 계속 스켈레톤으로 나온다").
// 지금은 두 번째 진입·연도 되돌리기에서 지난 값이 바로 그려지고 새 값이 뒤에서 온다.
// ============================================================================

const TABS = [['account', '가입자'], ['roster', '청년 명단']];
const THIS_YEAR = new Date().getFullYear();
// 직분(people_roles)과 순 편성(groups)은 연도별이다. 고를 수 있는 해는 **올해와 다음 두
// 해**다(사용자 지시 2026-09-05 — 2026·2027·2028). 명단이 시작된 2026보다 앞선 해는
// 두지 않는다 — 그 해에는 아무 줄도 없어서 빈 화면이 거짓말처럼 읽힌다(0035·0037).
const ROSTER_FIRST_YEAR = 2026;
const YEARS = [0, 1, 2].map(i => Math.max(THIS_YEAR, ROSTER_FIRST_YEAR) + i);
const EMPTY_BOOK = { people: [], roles: [], suns: [], groupMembers: [] };
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'ko');

const Section = ({ title, count, children, hint }) => (
  <section className="mb-7">
    <div className="flex items-center gap-2 mb-2.5">
      <h3 className="text-[13px] font-bold text-fg">{title}</h3>
      {count != null && <span className="text-[11px] text-fg-faint tabular-nums">{count}명</span>}
      <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
    </div>
    {hint && <p className="text-[11px] text-fg-faint mb-2.5 leading-relaxed">{hint}</p>}
    {children}
  </section>
);

const RowSkeleton = () => (
  <div className="flex items-center gap-2.5 py-2.5">
    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
    <div className="flex-1 min-w-0 space-y-1.5">
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-2 w-16 rounded" />
    </div>
  </div>
);

// 가입자 한 줄. **화면 함수 밖에 둔다** — 안에서 만들면 렌더마다 새 컴포넌트 타입이라
// 리액트가 줄을 통째로 떼었다 다시 붙이고, `.dc-row` 등장 모션이 그때마다 처음부터 돈다.
// 이 화면은 useMinuteTick으로 1분마다 다시 그리므로 목록이 1분마다 한 번씩 떠올랐다.
//
// 접속 표시는 대시보드 '가입한 사람' 목록(MembersModal)과 같은 모양이다 — 아바타
// 귀퉁이의 초록 원 + '접속 중'. 지금 보고 있는 사람에게 '1초 전 다녀감'이 뜨면
// 어색하다(사용자 지적). 방문 기록이 없으면 '다녀감' 줄을 아예 안 그린다 — 그 사람의
// 가장 최근 시각은 가입 시각이고(대시보드 목록이 lastVisitOf로 그것을 쓴다), 이 화면은
// 그 값을 이미 왼쪽의 'N분 전 가입'으로 보여주고 있다. 같은 값을 두 번 적지 않는다.
// `below` — 줄 아래에 펴지는 판(계정 합치기의 고르는 목록). 줄 안에 넣으면 아바타·이름과
// 같은 가로 흐름에 끼어 이름이 짜부라진다.
function MemberRow({ row, action, delay = 0, isOnline = false, at = '', below = null }) {
  return (
    <div className="dc-row py-2.5"
      style={{ borderBottom: '1px solid var(--app-line)', animationDelay: `${delay}ms` }}>
    <div className="flex items-center gap-2.5">
      <span className="relative shrink-0 inline-flex">
        <Avatar name={row.display_name} url={row.avatar_url} className="flex w-8 h-8 text-[13px]" />
        {isOnline && (
          <span aria-hidden className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full"
            style={{ background: 'var(--app-tag-green-fg)', boxShadow: '0 0 0 2px var(--app-surface)' }} />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-fg truncate">{row.display_name || '이름 없음'}</p>
        <p className="text-[10.5px] truncate" style={{ color: isOnline ? 'var(--app-tag-green-fg)' : 'var(--app-ink-faint)' }}>
          {[row.created_at && `${agoLabel(row.created_at)} 가입`,
            isOnline ? '접속 중' : (at && `${agoLabel(at)} 다녀감`)].filter(Boolean).join(' · ')}
        </p>
      </div>
      {action}
    </div>
    {below}
    </div>
  );
}

export function MembersView({ isAdmin, isMaster }) {
  const [tab, setTab] = useState('account');
  const [rows, setRows] = useState(null);       // null = 아직 받는 중
  const [admins, setAdmins] = useState(null);
  const [busy, setBusy] = useState({});         // { profileId|email|personId|'add': true }
  const [pickOpen, setPickOpen] = useState(false);   // 관리자로 지정할 사람 고르기
  const [year, setYear] = useState(YEARS[0]);
  // 명단 한 벌. **어느 해의 것인지 같이 들고 있는다** — 연도를 바꾼 첫 프레임에 지난 해의
  // 값이 스치지 않게(§6의 캐시 훅 한 프레임 함정과 같은 이유. groupsParts.useSettled).
  const [book, setBook] = useState(null);       // { key, data } | null
  const online = usePresence();
  // 줄마다 'N분 전 가입 · N분 전 다녀감'이 있다 — 이 화면을 열어 두면 그 글자가 굳는다
  useMinuteTick();
  // 줄 등장은 앱의 관례대로 `.dc-row` + 순번 지연이고 **첫 마운트에만** 준다
  // (useEnterStagger 주석 — 수락·환송으로 줄이 구역을 옮길 때 그 줄만 뒤늦게 나타나면
  //  "순서"가 아니라 지각으로 읽힌다). 지연 상한도 둔다 — 가입자가 쉰 명이면 아래쪽이
  //  1.5초 뒤에 뜬다.
  const stagger = useEnterStagger();
  const rowDelay = (i) => (stagger ? Math.min(i, 12) * 30 : 0);
  // **'다녀감'은 대시보드와 같은 값이어야 한다**(사용자 지적 2026-09-05 — 두 화면의
  // 싱크). 이 화면의 목록(cloud.listMembersAdmin)은 열 때 한 번 받는 스냅샷이라 그대로
  // 두면 그 시각이 굳고, 위의 useMinuteTick이 굳은 값을 늙히기까지 해서 열어 둔 만큼
  // 대시보드와 벌어졌다. 스토어의 members는 profiles 실시간을 타므로(§6-21의 profiles
  // 라우팅) 거기서 **다녀간 시각만** 겹쳐 쓴다 — 같은 값·같은 경로다.
  // 목록 자체를 스토어로 갈지 않는 이유: 이 화면은 승인 대기·환송한 사람과 이메일까지
  // 다루는데 스토어의 members는 그들을 걸러 낸다(0027).
  // **활동까지 같이 본다**(2026-09-06 · 사용자 지적 "1분 전 수정 · 4분 전 다녀감").
  // 대시보드 사람 칸과 **같은 함수**(utils.mergeActivitySeen)를 지나야 두 화면이 같이 움직인다.
  const storeMembersRaw = useStore(selectMembers);
  const feed = useStore(selectActivityFeed);
  const storeMembers = useMemo(() => mergeActivitySeen(storeMembersRaw, feed), [storeMembersRaw, feed]);
  const seenById = useMemo(
    () => new Map(storeMembers.map(m => [m.id, m.lastSeenAt || ''])), [storeMembers]);
  // 둘 중 나중 것. 스토어를 항상 믿지 않는 이유는 업무 창을 편집하는 동안 전체 재조회가
  // 보류될 수 있어서다(App). 두 값 다 isoTime을 지나 같은 모양이라 글자 비교로 된다.
  const seenAt = (row) => {
    const live = seenById.get(row.id) || '';
    const mine = isoTime(row.last_seen_at);
    return live > mine ? live : mine;
  };

  const load = useCallback(async () => {
    // 게스트 모드에는 클라우드가 없다 — 던지게 두면 화면을 열 때마다 콘솔 오류다
    if (!isCloudEnabled()) { setRows(roster.guestProfiles()); setAdmins([]); return; }
    try {
      const [ms, as] = await Promise.all([cloud.listMembersAdmin(), cloud.listAdmins()]);
      setRows(ms);
      setAdmins(as);   // [{ email, is_master }]
    } catch (e) {
      console.error('[cloud] 멤버 목록 실패:', e);
      showToast(failText('멤버 목록을 받지 못했어요', e));
      setRows([]); setAdmins([]);
    }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // 명단은 '청년 명단' 탭을 열 때 처음 받는다 — 가입자만 보러 온 사람에게 네 번의
  // 왕복을 미리 물리지 않는다. 연도를 바꾸면 그 해의 직분·순 편성을 다시 받는다.
  //
  // **캐시가 있으면 그것이 첫 화면이다.** readCache는 render에서 읽는다(effect는 그림을
  // 그린 뒤에 돌아서, effect에서 채우면 매 진입마다 스켈레톤이 한 프레임 스친다).
  // 남이 명단·직분·순 편성을 고치면 신호가 온다(0049 · services/liveV2.js). 여기는
  // useCached가 아니라 effect가 읽으므로 **숫자 하나**를 받아 deps에 얹는다.
  const rosterTick = useLiveTick('roster');
  const bookKey = `roster:${year}`;
  const shownBook = book?.key === bookKey ? book.data : readCache(bookKey);
  // 명단을 고치면 **명단을 읽는 다른 화면의 캐시도 비운다**(2026-09-06). 사람·직분·순
  // 편성은 여기서만 고치는데, 모임(groups:*)과 예배 상세(worship:svc:* — 출석 명단)는
  // 그 값을 각자 캐시해 두고 있다. 안 비우면 순장을 바꾸거나 새 청년을 넣은 뒤 예배·모임
  // 화면이 **다음 진입에서 옛 명단을 먼저** 그린다(그 자리에서 출석을 체크하면 사라진
  // 사람이 서 있다). 여기서는 비우기만 한다 — 그 화면들이 열릴 때 스스로 다시 읽는다.
  const putBook = (data) => {
    writeCache(bookKey, data);
    setBook({ key: bookKey, data });
    dropCache('groups'); dropCache('worship:svc'); dropCache('home');
  };

  useEffect(() => {
    if (!isAdmin || tab !== 'roster') return undefined;
    const key = `roster:${year}`;
    let alive = true;
    (async () => {
      try {
        const data = await roster.loadRoster(year);
        const next = { ...data, people: [...data.people].sort(byName) };
        // 캐시는 끊긴 뒤에도 채운다 — 받아 온 값은 여전히 그 해의 값이다
        writeCache(key, next);
        if (alive) setBook({ key, data: next });
      } catch (e) {
        console.error('[roster] 명단 조회 실패:', e);
        if (!alive) return;
        showToast(failText('명단을 받지 못했어요', e));
        // 캐시도 없을 때만 빈 명단으로 앉힌다 — 아무것도 안 하면 스켈레톤이 걷히지
        // 않고, 캐시를 덮으면 지난 값이 사라진다.
        if (readCache(key) === undefined) setBook({ key, data: EMPTY_BOOK });
      }
    })();
    return () => { alive = false; };
  }, [isAdmin, tab, year, rosterTick]);

  if (!isAdmin) {
    return (
      <div className="dc-screen max-w-3xl mx-auto py-16 text-center">
        <p className="text-[13px] text-fg-muted">관리자만 볼 수 있는 화면이에요.</p>
      </div>
    );
  }

  const mark = (key, on) => setBusy(prev => ({ ...prev, [key]: on }));

  const approve = async (row, next) => {
    mark(row.id, true);
    try {
      await cloud.setApproved(row.id, next);
      // removed_at도 같이 바꾼다 — 안 그러면 환송한 사람이 어느 구역에도 안 남는다
      setRows(prev => prev.map(r => (r.id === row.id
        ? { ...r, approved: next, removed_at: next ? null : new Date().toISOString() }
        : r)));
      showToast(next ? `${row.display_name || '이 분'}을 수락했어요` : `${row.display_name || '이 분'}을 환송했어요`);
    } catch (e) {
      console.error('[cloud] 승인 변경 실패:', e);
      showToast(failText(next ? '수락하지 못했어요' : '환송하지 못했어요', e));
    } finally { mark(row.id, false); }
  };

  // 이메일을 손으로 치지 않고 **가입한 사람 목록에서 고른다**(0028에서 profiles.email을
  // 두면서 가능해졌다). "어차피 노준석이잖아" — 사람으로 다루는 것이 맞다.
  const addAdmin = async (person) => {
    const email = (person.email || '').trim().toLowerCase();
    if (!email) { showToast('이 분은 로그인 이메일이 없어서 관리자로 지정할 수 없어요'); return; }
    mark(email, true);
    try {
      await cloud.addAdmin(email);
      setAdmins(prev => [...prev, { email, is_master: false }].sort((a, b) => a.email.localeCompare(b.email)));
      setPickOpen(false);
      showToast(`${person.display_name || email}님을 관리자로 지정했어요`);
    } catch (e) {
      console.error('[cloud] 관리자 지정 실패:', e);
      showToast(failText('관리자로 지정하지 못했어요', e));
    } finally { mark(email, false); }
  };

  // ── 계정 합치기 (0059 · 마스터만) ─────────────────────────────────────────
  // 한 사람이 구글·카카오·네이버로 여럿 들어온 경우다(사용자 요청 2026-09-09 —
  // "한 사람이 여러 계정으로 들어오는 경우, 통합을 시켜야 함"). 라이브에 실제로 문진혁
  // 청년이 셋, 임재훈 청년이 둘이었다.
  //
  // **남길 계정을 먼저 고르고 합칠 계정을 고른다.** 남길 쪽은 보통 **명단에 연결된**
  // 계정이다 — 거기에 순 소속·출석·직분이 매달려 있고, 연결되지 않은 계정으로 로그인하면
  // my_person_id()가 null이라 자격이 통째로 사라진다(0035).
  // 되돌릴 수 없으므로 ConfirmPopover로 한 번 묻는다.
  const [mergeFor, setMergeFor] = useState('');   // 남길 계정 id (팝업이 열린 줄)
  const mergeInto = async (keep, drop) => {
    mark(keep.id, true);
    try {
      await cloud.mergeProfiles(keep.id, drop.id);
      // 합친 계정은 환송 처리된다 — 목록에서 그 줄을 그쪽으로 옮긴다(다시 받지 않는다)
      setRows(prev => prev.map(r => (r.id === drop.id
        ? { ...r, approved: false, removed_at: new Date().toISOString(), merged_into: keep.id }
        : r)));
      setMergeFor('');
      showToast(`${drop.display_name || '그 계정'}을 ${keep.display_name || '이 계정'}으로 합쳤어요`);
    } catch (e) {
      console.error('[cloud] 계정 합치기 실패:', e);
      showToast(failText('계정을 합치지 못했어요', e));
    } finally { mark(keep.id, false); }
  };

  const dropAdmin = async (email) => {
    mark(email, true);
    try {
      await cloud.removeAdmin(email);
      setAdmins(prev => prev.filter(a => a.email !== email));
      showToast('관리자에서 해제했어요');
    } catch (e) {
      console.error('[cloud] 관리자 해제 실패:', e);
      showToast(failText('관리자에서 해제하지 못했어요', e));
    } finally { mark(email, false); }
  };

  // ── 명단 ──────────────────────────────────────────────────────────────────
  // 쓰기가 성공하면 그 줄만 갈아 끼운다(목록을 통째로 다시 받지 않는다 — 가입자 쪽
  // approve와 같은 방식). 막히면 화면은 그대로 두고 토스트만 낸다 — RLS가 진실이다.
  // **고친 값이 곧 다음 진입의 첫 화면이다** — 화면과 캐시를 같이 갈아 끼운다.
  // 비우고 다시 받지 않는 이유: 왕복 네 번을 다시 물면 방금 고친 줄이 한 번 깜빡인다.
  const editBook = (fn) => {
    const base = shownBook;
    if (!base) return;
    putBook(fn(base));
  };
  const patchPerson = (id, patch) => editBook(prev => ({
    ...prev, people: prev.people.map(p => (p.id === id ? { ...p, ...patch } : p)),
  }));

  // 한 벌로 쓰는 쓰기 껍데기 — busy 표시 · 성공 토스트 · 실패 토스트가 전부 같다
  const write = async (key, run, done, whatFailed) => {
    mark(key, true);
    try {
      const out = await run();
      done(out);
      return true;
    } catch (e) {
      console.error(`[roster] ${whatFailed}:`, e);
      showToast(failText(whatFailed, e));
      return false;
    } finally { mark(key, false); }
  };

  const rosterOn = {
    year: setYear,
    add: (row) => write('add', () => roster.addPerson(row), (made) => {
      editBook(prev => ({ ...prev, people: [...prev.people, made].sort(byName) }));
      showToast(`${made.name}${objectParticle(made.name)} 청년 명단에 올렸어요`);
    }, '청년 명단에 올리지 못했어요'),

    save: (p, patch) => write(p.id, () => roster.updatePerson(p.id, patch), () => {
      patchPerson(p.id, patch);
      showToast(`${patch.name || p.name} 정보를 저장했어요`);
    }, '저장하지 못했어요'),

    remove: (p, next) => write(p.id, () => roster.setRemoved(p.id, next), () => {
      patchPerson(p.id, { removed_at: next ? new Date().toISOString() : null });
      showToast(next
        ? `${p.name}${objectParticle(p.name)} 환송했어요`
        : `${p.name}${objectParticle(p.name)} 청년 명단으로 되돌렸어요`);
    }, next ? '환송하지 못했어요' : '되돌리지 못했어요'),

    link: (p, profileId) => write(p.id, () => roster.linkProfile(p.id, profileId), () => {
      patchPerson(p.id, { profile_id: profileId || null });
      showToast(profileId ? '계정을 연결했어요' : '계정 연결을 해제했어요');
    }, profileId ? '계정을 연결하지 못했어요' : '계정 연결을 해제하지 못했어요'),

    pastor: (p, next) => write(p.id, () => roster.setPastor(p.id, next), () => {
      patchPerson(p.id, { is_pastor: next });
      showToast(next ? `${p.name} 교역자로 지정했어요` : '교역자 지정을 해제했어요');
    }, next ? '교역자로 지정하지 못했어요' : '교역자 지정을 해제하지 못했어요'),

    role: (p, role, next) => write(p.id, () => roster.setYearRole(p.id, year, role, next), () => {
      const label = roster.ROLE_LABEL[role];
      editBook(prev => ({
        ...prev,
        roles: next
          ? [...prev.roles, { person_id: p.id, year, role }]
          : prev.roles.filter(r => !(r.person_id === p.id && r.year === year && r.role === role)),
      }));
      showToast(next ? `${year}년 ${label}으로 지정했어요` : `${year}년 ${label} 지정을 해제했어요`);
    }, next ? '직분을 지정하지 못했어요' : '직분 지정을 해제하지 못했어요'),
  };

  // 환송한 사람은 '승인을 기다리는 사람'으로 다시 올라오지 않는다(0027) —
  // 방금 내보낸 사람을 다시 수락하라고 화면이 조르면 안 된다(사용자 지적).
  const waiting = (rows || []).filter(r => !r.approved && !r.removed_at);
  // **합친 계정은 환송한 사람과 따로 센다**(사용자 요구 2026-09-10 — "환송 쪽 말고 그냥
  // 아예 구분해서 보여주면 안 되나"). 겉모습은 같지만(둘 다 approved=false + removed_at)
  // 성격이 다르다: 환송은 다시 부를 수 있고, 합친 계정은 다시 부를 것이 없다(0060).
  const removed = (rows || []).filter(r => !r.approved && r.removed_at && !r.merged_into);
  const mergedRows = (rows || []).filter(r => !r.approved && r.merged_into);
  // 어느 계정으로 합쳐졌는지 이름으로 말해 준다 — id는 사람에게 아무것도 알려주지 않는다
  const nameById = new Map((rows || []).map(r => [r.id, r.display_name || r.email || '']));
  // 함께하는 사람은 **다녀간 순**이다 — 대시보드 '가입한 사람' 목록과 같은 정렬
  // (utils.visitOrder). 가입순으로 두면 오래 안 온 사람이 계속 맨 위에 선다.
  // 접속 중인 사람이 맨 위인 것까지 같다 — 그 자리를 안 넘기면 같은 목록이 두 화면에서
  // 다른 순서로 선다(MembersModal은 넘긴다).
  const members = visitOrder(
    (rows || []).filter(r => r.approved)
      .map(r => ({ ...r, name: r.display_name || '', lastSeenAt: seenAt(r), joinedAt: r.created_at })),
    online,
  );

  // 줄 하나에 넘길 값 — 접속 여부와 다녀간 시각은 이 화면이 정한다(MemberRow는 그리기만).
  const rowProps = (row) => ({ isOnline: online.has(row.id), at: seenAt(row) });

  return (
    <div className="dc-screen max-w-3xl mx-auto pb-8">
      <div className="mb-4">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">멤버 관리</h2>
        <p className="text-[11.5px] text-fg-muted mt-1">가입 수락, 관리자 지정을 할 수 있고, 청년 명단을 확인할 수 있습니다.</p>
      </div>

      {/* 사람의 축이 둘이다 — 가입한 '계정'과 청년부 전체 '명단'(파일 머리말) */}
      <div className="flex items-center gap-2 pb-4">
        <span className="flex p-[3px] rounded-[8px] shrink-0" style={{ background: 'var(--app-surface-hover)' }}>
          {TABS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className="px-3.5 py-[6px] rounded-[5px] text-[12.5px] font-semibold transition-colors"
              style={{
                background: tab === key ? 'var(--app-surface)' : 'transparent',
                color: tab === key ? 'var(--app-ink)' : 'var(--app-ink-muted)',
              }}>{label}</button>
          ))}
        </span>
      </div>

      {/* 탭을 바꾸면 그 내용이 살짝 들어온다(.dc-screen · §4.2 260ms). '청년 명단' 쪽은
          RosterPanel의 뿌리가 이미 .dc-screen이라 여기서 한 겹 더 씌우지 않는다. */}
      {tab === 'roster' ? (
        <RosterPanel {...(shownBook || {})} profiles={rows || []} profilesReady={rows !== null}
          year={year} years={YEARS} busy={busy} loading={!shownBook} on={rosterOn} />
      ) : rows === null ? (
        <div className="dc-screen"><RowSkeleton /><RowSkeleton /><RowSkeleton /></div>
      ) : (
        <div className="dc-screen">
          {/* 대기자가 있을 때만 그린다 — 없는 줄을 그리면 "할 일이 있다"로 읽힌다 */}
          {waiting.length > 0 && (
            <Section title="승인을 기다리는 사람" count={waiting.length}
              hint="수락하기 전에는 프로젝트도 업무도 볼 수 없어요.">
              {waiting.map((row, i) => (
                <MemberRow key={row.id} row={row} delay={rowDelay(i)} {...rowProps(row)} action={
                  <button type="button" disabled={!!busy[row.id]} onClick={() => approve(row, true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} 수락
                  </button>
                } />
              ))}
            </Section>
          )}

          <Section title="함께하는 사람" count={members.length}>
            {members.map((row, i) => (
              <MemberRow key={row.id} row={row} delay={rowDelay(i)} {...rowProps(row)} action={
                <span className="flex items-center gap-1">
                  {/* 합치기는 마스터만 — 남의 댓글·담당자를 다른 계정으로 옮기는 일이다 */}
                  {isMaster && (
                    <button type="button" disabled={!!busy[row.id]}
                      onClick={() => setMergeFor(v => (v === row.id ? '' : row.id))}
                      className="members-merge shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                      {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />} 계정 합치기
                    </button>
                  )}
                  <ConfirmPopover message={`${row.display_name || '이 분'}을 환송할까요? 지난 댓글·기록은 그대로 남아요.`}
                    onConfirm={() => approve(row, false)}>
                    <button type="button" disabled={!!busy[row.id]}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                      <UserX size={13} /> 환송해주기
                    </button>
                  </ConfirmPopover>
                </span>
              } below={mergeFor === row.id ? (
                <div className="members-merge-pick mt-2 border border-line rounded-lg p-1.5 max-h-60 overflow-y-auto">
                  <p className="px-2 py-1.5 text-[11px] text-fg-muted leading-relaxed">
                    <span className="font-bold text-fg">{row.display_name || '이 계정'}</span>으로 합칠 계정을 고르세요.
                    고른 계정의 업무·댓글·노트·알림이 이쪽으로 옮겨지고 그 계정은 환송돼요. 되돌릴 수 없어요.
                  </p>
                  {members.filter(m => m.id !== row.id && !m.merged_into).map(m => (
                    <ConfirmPopover key={m.id}
                      message={<>
                        <span className="font-bold text-fg">{m.display_name || '그 계정'}</span>
                        을 <span className="font-bold text-fg">{row.display_name || '이 계정'}</span>으로 합칠까요?
                        <br />되돌릴 수 없어요.
                      </>}
                      confirmLabel="합치기" onConfirm={() => mergeInto(row, m)}>
                      <button type="button" disabled={!!busy[row.id]}
                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
                        <Avatar name={m.display_name} url={m.avatar_url} className="flex w-7 h-7 text-xs shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] text-fg truncate">{m.display_name || '이름 없음'}</span>
                          <span className="block text-[10.5px] text-fg-faint truncate">{m.email || '로그인 이메일 없음'}</span>
                        </span>
                      </button>
                    </ConfirmPopover>
                  ))}
                  <button type="button" onClick={() => setMergeFor('')}
                    className="w-full mt-1 py-2 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">닫기</button>
                </div>
              ) : null} />
            ))}
          </Section>

          {/* 합친 계정 — **환송한 사람과 따로 둔다**(0060의 merged_into). 이 계정의
              업무·댓글·노트는 이미 다른 계정으로 옮겨졌고 다시 부를 것이 없다.
              지우지 않는 이유는 0059 머리말이다(지우면 다시 로그인해 새 프로필이 생긴다). */}
          {mergedRows.length > 0 && (
            <Section title="합친 계정" count={mergedRows.length}
              hint="한 사람이 여러 계정으로 들어온 경우예요. 업무·댓글·노트는 남긴 계정으로 옮겨졌어요.">
              {mergedRows.map((row, i) => (
                <MemberRow key={row.id} row={row} delay={rowDelay(i)} {...rowProps(row)} action={
                  <span className="members-merged shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-fg-faint">
                    <Merge size={13} />
                    {nameById.get(row.merged_into)
                      ? `${nameById.get(row.merged_into)}(으)로 합쳤어요`
                      : '다른 계정으로 합쳤어요'}
                  </span>
                } />
              ))}
            </Section>
          )}

          {/* 환송한 사람 — 다시 부를 수 있다. 프로필 행을 지우지 않는 이유는
              0027 주석에 있다(지워도 다시 로그인하면 되살아난다). */}
          {removed.length > 0 && (
            <Section title="환송한 사람" count={removed.length}
              hint="다시 초대하면 수락 대기 없이 바로 돌아와요. 지난 댓글·기록은 계속 남아 있어요.">
              {removed.map((row, i) => (
                <MemberRow key={row.id} row={row} delay={rowDelay(i)} {...rowProps(row)} action={
                  <button type="button" disabled={!!busy[row.id]} onClick={() => approve(row, true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-hover text-fg-muted text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                    {busy[row.id] ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} 다시 초대하기
                  </button>
                } />
              ))}
            </Section>
          )}

          {/* 마스터라는 말은 화면에 쓰지 않는다 — 사용자 결정("마스터 권한은 나만 알고
              있을게"). 문구도 배지도 마스터에게만 보인다. 경계 자체는 DB가 막으므로
              (0029) 감춰도 '화면만 감추는' 상태가 되지 않는다. */}
          <Section title="관리자" count={(admins || []).length}
            hint="관리자는 멤버 관리와 업무 삭제를 할 수 있어요.">
            {(admins || []).map((a, i) => {
              // 같은 사람이 계정을 여럿 쓰면(구글·카카오) 행이 둘이다 — 이름으로 묶어 보여준다
              const who = (rows || []).find(r => (r.email || '').toLowerCase() === a.email);
              return (
                <div key={a.email} className="dc-row flex items-center gap-2.5 py-2.5"
                  style={{ borderBottom: '1px solid var(--app-line)', animationDelay: `${rowDelay(i)}ms` }}>
                  {who
                    ? <Avatar name={who.display_name} url={who.avatar_url} className="flex w-8 h-8 text-[13px] shrink-0" />
                    : <span className="w-8 h-8 rounded-full bg-accent-weak flex items-center justify-center shrink-0"><ShieldCheck size={15} className="text-accent-text" /></span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-fg truncate">
                      {who?.display_name || a.email}
                      {isMaster && a.is_master && <span className="ml-1.5 text-[10px] font-bold text-accent-text">마스터</span>}
                    </p>
                    <p className="text-[10.5px] text-fg-faint truncate">{a.email}</p>
                  </div>
                  {isMaster && (
                    <ConfirmPopover message={`${who?.display_name || a.email}을 관리자에서 해제할까요?`} onConfirm={() => dropAdmin(a.email)}>
                      <button type="button" disabled={!!busy[a.email]}
                        className="shrink-0 px-2.5 py-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover text-[11px] font-semibold transition active:scale-95 disabled:opacity-40">
                        해제하기
                      </button>
                    </ConfirmPopover>
                  )}
                </div>
              );
            })}

            {/* 지정은 마스터만. 관리자에게 이 줄을 보여 주고 누르면 DB가 막는 것은
                §4.4가 지적한 '화면만 감추는' 상태와 반대다 — 아예 안 보여준다. */}
            {isMaster && (pickOpen ? (
              <div className="mt-3 border border-line rounded-lg p-1.5 max-h-64 overflow-y-auto">
                {members.filter(m => !(admins || []).some(a => a.email === (m.email || '').toLowerCase())).map(m => (
                  <button key={m.id} type="button" disabled={!!busy[m.email]} onClick={() => addAdmin(m)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-hover transition-colors text-left disabled:opacity-40">
                    <Avatar name={m.display_name} url={m.avatar_url} className="flex w-7 h-7 text-xs shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-fg truncate">{m.display_name || '이름 없음'}</span>
                      <span className="block text-[10.5px] text-fg-faint truncate">{m.email || '로그인 이메일 없음'}</span>
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => setPickOpen(false)}
                  className="w-full mt-1 py-2 rounded-md text-[11px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">닫기</button>
              </div>
            ) : (
              <button type="button" onClick={() => setPickOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95">
                <Plus size={13} /> 가입한 사람 중에서 지정하기
              </button>
            ))}

            <p className="mt-2.5 text-[10.5px] text-fg-faint leading-relaxed">
              <Shield size={11} className="inline -mt-0.5 mr-1" />
              자기 자신은 해제할 수 없어요.
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}
