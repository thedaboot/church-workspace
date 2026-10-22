import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { X, Bell, BellRing, BellOff, Users, CalendarClock, Smartphone, Church, Compass, Settings2, ChevronLeft, Check, Wrench } from 'lucide-react';
import { inKakao, openExternal, kakaoDemo } from '../services/inApp.js';
import { store } from '../store/workspaceStore.js';
import { useAuth } from '../services/auth.jsx';
import { formatRelative } from '../utils.js';
import { myUid, supabase } from '../services/supabaseClient.js';
import { Avatar } from './Avatar.jsx';
import * as cloudSync from '../services/cloudSync.js';
import * as push from '../services/push.js';
import { notifLine, notifText, isSystemNotif, notifArea } from '../services/notifyText.js';
import { isAppLink } from '../services/entryQuery.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { usePopover } from '../hooks/usePopover.js';
import { markCardNotificationsRead } from '../services/cloud.js';
import { setTaskFocus, notifFocusHint, onTaskOpen, openTaskId, notifArrival } from '../modals/taskFocus.js';
import { visibleGroups, filterNotifs, flipOff } from '../services/notifyPrefs.js';
import { useGuestNotifs, setGuestNotifs } from '../services/opsDemo.js';
import { useNotifOff, setNotifOff } from '../services/notifOff.js';
import { ShareSwitch } from './bibleParts.jsx';
import { Skeleton } from './media.jsx';

// ============================================================================
// 알림 종(클라우드 모드에서만 선다 · 데스크톱 TopNav와 폰 상단바가 같은 것을 쓴다).
// 판 머리의 톱니 → 같은 판 안에서 **알림 설정**(갈래 넷 + 항목 · services/notifyPrefs.js · v5 2묶음 사용자 승인 시안 · 0113)으로 바뀐다(뒤로 → 목록).
//   끈 값은 services/notifOff.js(profiles.notif_off) — 서버가 끈 종류의 행을 넣지 않고 푸시도 거른다. 이 판은 끄기 전에 받은 줄도 가린다
//   (끈 것은 줄도 안 서고 빨간 숫자에도 안 든다). 목록 ↔ 설정은 판 높이가 quint로 따라가고 내용이 옆에서 들어온다(PITFALLS 57).
// 게스트 시연(opsDemo.demoOn — 미리보기 빌드)에도 서서 브라우저에 심은 알림으로 같은 판을 그린다 — 아래 GuestBell.
// 19차 묶음 D에서 layout.jsx에서 갈라 왔다(동작·모양은 그대로).
//   · 알림은 **남긴 계정 앞으로** 온다(0063) — 구독 필터는 myUid()로 물은 값(세션 uid가 아니다)
//   · 판 안: 머리(모두 읽음) · 안드로이드 설치 줄 · '이 기기로 알림 받기'(권한은 여기서 묻는다) · 알림 줄(열기 · 지우기)
//   · 카카오톡 인앱(v5 2묶음 · services/inApp.js)에서는 설치 줄·알림 받기 줄 대신 '브라우저로 열기' 한 줄(KakaoOutRow) — 인앱 웹뷰는
//     웹 푸시도 홈 화면 추가도 못 한다. 게스트·미리보기는 `?demo=kakao`면 종이 서고(bellOn) 넘기는 대신 토스트 — 클라우드는 실제 UA만
//   · 판은 앵커 곁에 그린다(portal: false — 원래 그렇다) · 껍데기는 hooks/usePopover 한 벌 · 640 미만 폰은 화면 폭 - 32px(좌우 16px · PITFALLS 49-f)
// ============================================================================

// ── @멘션 알림 (클라우드 모드 전용) ────────────────────────────────────────
// 알림은 전역 스토어에 넣지 않는다(워크스페이스 데이터와 수명·성격이 다름).
// 헤더 컴포넌트 로컬 state + realtime 구독으로 충분.
// 종류별 문구는 services/notifyText.js에 있다 — 웹 푸시(api/push.js)가 같은 문구를 쓴다.

// 안드로이드 설치 안내. **알림과는 별개다** — 안드로이드는 설치하지 않아도 브라우저
// 탭에서 푸시가 온다(iOS만 설치가 전제 조건이라 그쪽은 PushRow의 'needs-pwa' 줄이
// 다른 문구로 안내한다). 설치하고 아이콘으로 열면 display-mode가 standalone이 되어
// 이 줄은 저절로 사라진다 — 닫기 버튼도, 닫았다는 기록도 두지 않는 이유다.
// 판 안의 알림 한 줄(아이콘 + 글) — 설치 안내 · 홈 화면 추가 · 권한 거부가 같은 모양을 쓴다
const NoteLine = ({ icon: Icon, children }) => (
  <div className="flex items-start gap-2 px-3 py-2.5 border-b border-line text-[10px] text-fg-muted">
    <Icon size={13} strokeWidth={1.75} className="shrink-0 mt-px" />
    <span>{children}</span>
  </div>
);

function InstallRow() {
  if (!push.isAndroid() || push.isStandalone()) return null;
  return (
    <NoteLine icon={Smartphone}>
      크롬 <b className="font-semibold text-fg">⋮ → 앱 설치</b>를 누르면 앱처럼 쓸 수 있어요<br />
      삼성 인터넷은 <b className="font-semibold text-fg">☰ → 현재 페이지 추가</b>
    </NoteLine>
  );
}

// 막힌 상태의 줄 — 누를 것이 없고 글만 선다
const PUSH_NOTES = {
  'needs-pwa': [Smartphone, '홈 화면에 추가하면 알림을 받을 수 있어요'],
  denied: [BellOff, '브라우저 설정에서 이 사이트의 알림을 허용해 주세요'],
};

// 알림 종 팝오버 안의 '알림 받기' 줄. 여기서 권한을 묻는다 — 앱을 처음 열 때 물으면
// 무슨 알림인지 모르는 상태에서 거부하기 쉽고, 한 번 거부되면 브라우저 설정에서
// 손으로 되돌려야 한다.
function PushRow() {
  const [state, setState] = useState('unavailable');
  const [busy, setBusy] = useState(false);

  useEffect(() => { let alive = true; push.getPushState().then(s => alive && setState(s)); return () => { alive = false; }; }, []);

  if (state === 'unavailable') return null;

  const note = PUSH_NOTES[state];
  if (note) return <NoteLine icon={note[0]}>{note[1]}</NoteLine>;

  const on = state === 'on';
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await push.disablePush(); showToast('앱을 닫았을 때는 알림이 오지 않아요'); }
      else { await push.enablePush(); showToast('이제 앱을 닫아도 알림이 와요'); }
      setState(await push.getPushState());
    } catch (e) {
      console.error('[push] 설정 실패:', e);
      showToast(failText('알림 설정을 바꾸지 못했어요', e));
      setState(await push.getPushState());
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle} disabled={busy}
      className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-line text-left hover:bg-surface-hover transition-colors disabled:opacity-60"
    >
      {on ? <BellRing size={13} strokeWidth={1.75} className="shrink-0 text-accent-text" />
          : <Bell size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-fg">{on ? '이 기기로 알림 받는 중' : '이 기기로 알림 받기'}</span>
        <span className="block text-[10px] text-fg-muted mt-0.5">{on ? '눌러서 끄기' : '앱을 닫아도 알림이 와요'}</span>
      </span>
    </button>
  );
}

// 카카오 인앱 — 같은 주소를 기본 브라우저로(kakaotalk://web/openExternal · 아이폰·안드로이드 둘 다).
// 한 문구로(사용자 결정 2026-10-18) — openExternal은 아이폰·안드로이드 모두 **기기의 기본 브라우저**로 연다(사파리·크롬으로 가르지 않는다).
// demo는 게스트 시연 토스트에만(kakaoDemo — 클라우드에서는 늘 false).
export const KAKAO_OUT_COPY = {
  title: '브라우저로 열기',
  sub: '알림 받기와 홈 화면에 추가하는 건 브라우저에서 할 수 있어요',
  demo: '시연: 카카오톡 안이라면 여기서 브라우저로 넘어가요',
};
function KakaoOutRow() {
  const go = () => {
    openExternal();
    if (kakaoDemo()) showToast(KAKAO_OUT_COPY.demo);
  };
  return (
    <button onClick={go} data-kakao-out=""
      className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-line text-left hover:bg-surface-hover transition-colors">
      <Compass size={13} strokeWidth={1.75} className="shrink-0 text-accent-text" />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-fg">{KAKAO_OUT_COPY.title}</span>
        <span className="block text-[10px] text-fg-muted mt-0.5">{KAKAO_OUT_COPY.sub}</span>
      </span>
    </button>
  );
}
// 종이 서는가 — 클라우드 · 또는 게스트의 카카오 시연(?demo=kakao — 게스트는 알림 행이 없어 판은 그 줄과 빈 목록뿐)
export const bellOn = (cloudMode) => cloudMode || kakaoDemo();

// 시스템 알림의 동그라미 — 갈래(notifArea)마다 [아이콘, 색]. 표에 없는 갈래(마감 등)는 시계
const AREA_ICON = {
  worship: [Church, 'bg-accent-weak text-accent-text'],
  group: [Users, 'bg-tag-green text-tag-green-fg'],
  ops: [Wrench, 'bg-accent-weak text-accent-text'],
};
const AREA_ICON_DEFAULT = [CalendarClock, 'bg-tag-yellow text-tag-yellow-fg'];
const SystemIcon = ({ kind }) => {
  const [Icon, cls] = AREA_ICON[notifArea(kind)] || AREA_ICON_DEFAULT;
  return (
    <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${cls}`}>
      <Icon size={12} strokeWidth={1.75} />
    </span>
  );
};

// 게스트 시연(guest · 시안 v5 2묶음)은 브라우저에 심은 알림으로 같은 판을 그리고 '알림 설정'을 연다 — 클라우드 갈래는 그대로다.
// 받는 사람에게만 서는 칩의 자격(모임 > 새가족 · 0121) — 종이 화면에 붙을 때 한 번 묻고 계정마다 기억한다.
// 판을 열 때 물으면 칩이 늦게 서며 판 아래가 늘었다 줄었다(사용자 지적 2026-10-22). 클라우드는 DB 판정(0120 can_see_welcome) ·
// 게스트는 켬(시연·검사) · 못 읽으면 세우지 않는다(닫힌 쪽).
const welcomeAsk = { uid: undefined, promise: null, value: undefined };
function askWelcome(uid) {
  if (welcomeAsk.uid !== uid || !welcomeAsk.promise) {
    welcomeAsk.uid = uid;
    welcomeAsk.value = undefined;
    const p = (supabase ? supabase.rpc('can_see_welcome').then(({ data, error }) => !error && !!data, () => false) : Promise.resolve(true))
      .then(v => { if (welcomeAsk.promise === p) welcomeAsk.value = v; return v; });
    welcomeAsk.promise = p;
  }
  return welcomeAsk.promise;
}

export function NotificationBell(props) {
  const uid = useAuth().session?.user?.id || null;
  useEffect(() => { askWelcome(uid); }, [uid]);
  return props.guest ? <GuestBell {...props} /> : <CloudBell {...props} />;
}

function CloudBell({ onOpenTask, onOpenLink }) {
  const { session } = useAuth();
  // 알림은 **남긴 계정 앞으로** 온다(0063) — 구독 필터(`recipient_id=eq.…`)가 세션 uid면
  // 합친 계정에게는 새 알림이 한 줄도 안 들어와 벨이 비어 보인다. 물어 오기 전까지는
  // 세션 uid로 떨어진다(합치지 않은 계정에게는 같은 값이다).
  const sessionUid = session?.user?.id;
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    if (!sessionUid) { setUserId(null); return; }
    let alive = true;
    myUid().then(id => { if (alive) setUserId(id || sessionUid); })
      .catch(() => { if (alive) setUserId(sessionUid); });
    return () => { alive = false; };
  }, [sessionUid]);
  const [items, setItems] = useState([]);
  const off = useNotifOff();
  const shown = useMemo(() => filterNotifs(items, off), [items, off]);
  // 바깥 클릭 / Esc 닫기는 프로필 메뉴·검색과 같은 훅 한 벌(usePopover 안의 useDismiss) — 이 판은
  // rootRef 안에 그려진다(포털이 아니다 · portal: false)
  // 좁은 폰(640 미만)은 판이 화면 폭 - 32px로 서고 좌우 16px 여백(앱 거터)에 맞춘다 — 320px 판을 종 오른쪽 끝에 맞추면
  // 왼쪽 9px · 오른쪽 25~48px로 어긋났다(2026-10-14 점검 · PITFALLS 49-f). 폭은 아래 판 클래스(!)가 정하고, measure로 그 실제 폭을 재서 가둔다.
  const pop = usePopover(320, 240, { portal: false, gap: 16, measure: true });
  const unread = shown.filter(n => !n.read).length;

  // 앱 아이콘 뱃지. **아이폰 홈 화면 웹앱에서만 보인다** — 안드로이드 크롬은 이 API가
  // 아예 없고(대신 알림이 와 있으면 OS가 알아서 점을 붙인다), 데스크톱은 설치한 창에서만
  // 보인다. 지원하지 않는 곳에서 navigator.setAppBadge는 undefined라 호출 전에 본다.
  useEffect(() => {
    if (!navigator.setAppBadge) return;
    // 권한이 없거나 설치 상태가 아니면 거부될 수 있다 — 뱃지 하나 때문에 콘솔을 더럽히지 않는다.
    const p = unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge();
    p?.catch(() => {});
  }, [unread]);

  // 초기 로드
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    cloudSync.listMyNotifications(30)
      .then(rows => { if (alive) setItems(rows || []); })
      .catch(e => console.error('[cloud] 알림 로드 실패:', e));
    return () => { alive = false; };
  }, [userId]);

  // 한 업무의 안 읽은 알림을 모두 읽음으로(UX 다듬기 α · 2026-10-15 · D4) — 업무 창이 어느 길로 열리든(보드·검색·알림·링크)
  // 그 업무의 알림은 이미 본 것이다. 손에 든 목록에 안 읽은 것이 있을 때만 서버에 **한 번** 쓴다(업무를 열 때마다 쓰지 않는다).
  // 목록은 ref로도 든다 — 알림 줄을 눌러 여는 길은 같은 흐름 안에서 이것을 두 번 부른다(누를 때 · 창이 열릴 때).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const markCardRead = useCallback((cardId) => {
    if (!cardId || !itemsRef.current.some(n => n.card_id === cardId && !n.read)) return;
    const read = (list) => list.map(n => (n.card_id === cardId && !n.read ? { ...n, read: true } : n));
    itemsRef.current = read(itemsRef.current);
    setItems(read);
    markCardNotificationsRead(cardId).catch(e => console.error('[cloud] 업무 알림 읽음 처리 실패:', e));
  }, []);
  useEffect(() => onTaskOpen(markCardRead), [markCardRead]);

  // 알림 하나 열기 — 판의 줄 · 새 알림 토스트의 '열기'가 같이 쓴다
  const openItem = (n) => {
    pop.close();
    // 예배·모임 알림(0053)은 우리 주소 한 칸으로 간다 — App이 화면을 바꾸고 나머지 값은
    // entryQuery에 실어 그 화면이 마운트되며 읽는다(새로고침 없음).
    const task = !isAppLink(n.link) && n.card_id ? store.getState().tasks.byId[n.card_id] : null;
    if (task) markCardRead(n.card_id);   // 이 업무의 다른 알림까지 한 번에(창이 열리며 다시 불러도 쓰지 않는다)
    else if (!n.read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      cloudSync.markNotificationRead(n.id).catch(e => console.error('[cloud] 알림 읽음 처리 실패:', e));
    }
    if (isAppLink(n.link)) { onOpenLink?.(n.link); return; }
    if (!n.card_id) return;
    if (!task) { showToast('업무를 찾을 수 없어요'); return; }
    // 댓글에서 온 알림(멘션·답글·반응)은 그 댓글을 보며 연다 — 창보다 먼저 적어 둔다(modals/taskFocus.js)
    setTaskFocus(task.id, notifFocusHint(n));
    onOpenTask?.(task);
  };
  const openRef = useRef(openItem);
  openRef.current = openItem;

  // 실시간: 본인 수신 알림 INSERT — 토스트에 '열기'(D3). **그 업무 창이 지금 열려 있으면** 토스트 없이 읽음으로 둔다
  // (보고 있는 업무에 단 댓글을 토스트로 또 알릴 이유가 없다).
  useEffect(() => {
    if (!userId) return;
    const unsub = cloudSync.subscribeMyNotifications(userId, (row) => {
      const quiet = notifArrival(row, openTaskId()) === 'quiet';
      const got = quiet ? { ...row, read: true } : row;
      setItems(prev => (prev.some(n => n.id === row.id) ? prev : [got, ...prev].slice(0, 30)));
      if (quiet) {
        cloudSync.markNotificationRead(row.id).catch(e => console.error('[cloud] 알림 읽음 처리 실패:', e));
        return;
      }
      const canOpen = isAppLink(row.link) || !!row.card_id;
      showToast(notifLine(row.kind, row.actor_name), canOpen ? { label: '열기', onAction: () => openRef.current(got) } : null);
    });
    return unsub;
  }, [userId]);

  // 알림 1건 지우기. 확인은 묻지 않는다 — 잃는 것이 알림 한 줄뿐이고, 지우려고
  // 누르는 자리에 또 한 번 물으면 목록을 정리하는 일이 두 배로 는다.
  // 실패하면 되돌린다(토스트만 띄우고 화면에서 지워두면 DB와 어긋난 채로 남는다).
  const dismiss = (n) => {
    setItems(prev => prev.filter(x => x.id !== n.id));
    cloudSync.deleteNotification(n.id).catch(e => {
      console.error('[cloud] 알림 삭제 실패:', e);
      showToast('알림을 지우지 못했어요');
      setItems(prev => (prev.some(x => x.id === n.id) ? prev : [n, ...prev]
        .sort((a, b) => (a.read - b.read) || (new Date(b.created_at) - new Date(a.created_at)))));
    });
  };

  const readAll = () => {
    setItems(prev => prev.map(x => ({ ...x, read: true })));
    cloudSync.markAllNotificationsRead().catch(e => console.error('[cloud] 모두 읽음 실패:', e));
  };

  return (
    <span className="inline-flex shrink-0" ref={pop.rootRef}>
      <BellTrigger pop={pop} unread={unread} />
      <BellPanel pop={pop} items={shown} unread={unread} readAll={readAll} openItem={openItem} dismiss={dismiss} off={off} />
    </span>
  );
}

const PANEL = 'z-[90] max-w-[calc(100vw-2rem)] max-sm:w-[calc(100vw-2rem)]! max-h-96 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated';
// 알림 설정은 갈래 넷이 한 판에 다 서게 더 길다 — 낮은 창에서는 판 안에서 구른다(상단바 아래 · 아래 5rem 여백)
const PANEL_PREFS = PANEL.replace('max-h-96', 'max-h-[min(36rem,calc(100dvh-5.5rem))]');

// 판 높이가 내용을 따라 quint로 자란다(목록 ↔ 알림 설정 · PITFALLS 57) — 안쪽 실제 높이를 재서 겉 높이로 준다.
// 겉은 overflow: clip(스크롤 통이 되지 않는다 — 머리 줄의 sticky가 판을 기준으로 그대로 붙는다). 첫 높이는 전이 없이.
// 내용이 판(스크롤 칸)의 최대 높이보다 길면 높이를 재지 않고 auto로 둔다 — 그대로 재면 잘려 보이던 목록(710px)에서 설정(516px)으로
// 넘어갈 때 판이 설정용 최대 높이까지 늘었다가 줄었다(사용자 지적 2026-10-22 · 실측). auto에서 숫자로는 움직이지 않으니 그때만 바로 바뀐다.
function useSmoothHeight() {
  const inner = useRef(null);
  const [h, setH] = useState(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const read = () => {
      const panel = el.parentElement?.parentElement;
      const max = panel ? parseFloat(getComputedStyle(panel).maxHeight) - (panel.offsetHeight - panel.clientHeight) : NaN;
      setH(Number.isFinite(max) && el.offsetHeight > max ? null : el.offsetHeight);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const t = requestAnimationFrame(() => setReady(true));
    return () => { ro.disconnect(); cancelAnimationFrame(t); };
  }, []);
  return [inner, { height: h == null ? 'auto' : h }, ready];
}

// 판 안 — 목록(머리 · 설치 줄 · 알림 받기 줄 · 알림 줄) ↔ 알림 설정. 두 종(클라우드 · 게스트 시연)이 같이 쓴다.
function BellPanel({ pop, items, unread, readAll, openItem, dismiss, off }) {
  const [view, setView] = useState('list');
  const [dir, setDir] = useState(null);   // null = 처음 열림(판 자체의 등장만)
  useEffect(() => { if (!pop.open) { setView('list'); setDir(null); } }, [pop.open]);
  const go = (next) => { setDir(next === 'prefs' ? 'fwd' : 'back'); setView(next); };
  return pop.panel(view === 'prefs' ? PANEL_PREFS : PANEL,
    <SmoothBox>
      <div key={view} className={dir ? `dc-nav-${dir}` : undefined} data-bell-view={view}>
        <div className={dir ? 'dc-fade' : undefined}>
          {view === 'prefs' ? (
            <>
              <PanelHead title="알림 설정" onBack={() => go('list')} />
              <NotifPrefs off={off} />
            </>
          ) : (
            <>
              <PanelHead title="알림">
                {unread > 0 && <ReadAllButton onClick={readAll} />}
                <button type="button" onClick={() => go('prefs')} aria-label="알림 설정" title="알림 설정" data-notif-prefs-open=""
                  className="-mr-1.5 p-1 rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95"><Settings2 size={14} /></button>
              </PanelHead>
              {inKakao() ? <KakaoOutRow /> : <><InstallRow /><PushRow /></>}
              <NotifRows items={items} openItem={openItem} dismiss={dismiss} />
            </>
          )}
        </div>
      </div>
    </SmoothBox>);
}

function SmoothBox({ children }) {
  const [inner, style, ready] = useSmoothHeight();
  return (
    <div style={style} className={`[overflow:clip] ${ready ? 'bell-smooth-h' : ''}`}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

function BellTrigger({ pop, unread }) {
  return (
    <span ref={pop.btnRef} className="inline-flex">
      <button
        // 열기 전에 위치 확정(pop.toggle) — 첫 프레임이 {0,0}에 그려지면 좌상단에서
        // 날아오는 것처럼 보인다(첫 오픈에서만 나던 증상)
        onClick={pop.toggle}
        className="relative p-2 min-w-11 min-h-11 flex items-center justify-center rounded-md hover:bg-surface-hover text-fg-muted transition active:scale-95"
        title="알림"
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-tag-red-fg text-white text-[10px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </span>
  );
}

const PanelHead = ({ title, children, onBack }) => (
  <div className="flex items-center gap-1 px-3 py-2.5 border-b border-line sticky top-0 z-[1] bg-surface min-h-[41px]">
    {onBack && (
      <button type="button" onClick={onBack} aria-label="뒤로" title="뒤로"
        className="-ml-1.5 p-1 rounded-md text-fg-muted hover:bg-surface-hover transition active:scale-95"><ChevronLeft size={15} /></button>
    )}
    <span className="flex-1 text-xs font-bold text-fg">{title}</span>
    {children}
  </div>
);

const ReadAllButton = ({ onClick }) => (
  <button onClick={onClick} className="text-[10px] text-accent-text hover:bg-surface-hover rounded-md px-1.5 py-1 transition active:scale-95">모두 읽음</button>
);

function NotifRows({ items, openItem, dismiss }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 px-3">
        <span className="inline-flex w-8 h-8 rounded-full bg-tag-yellow text-tag-yellow-fg items-center justify-center mb-2"><Bell size={13} strokeWidth={1.75} /></span>
        <p className="text-xs text-fg-faint">새로운 알림이 없어요</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-line/60">
      {/* 줄 전체가 button이었는데 지우기 버튼이 그 안에 들어가야 해서 div로 바꿨다
          (button 안의 button은 유효하지 않다). 여는 영역만 button으로 남긴다. */}
      {items.map(n => (
        <div
          key={n.id}
          className={`flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-hover transition-colors ${n.read ? '' : 'bg-accent-weak/40'}`}
        >
          <button onClick={() => openItem(n)} className="flex-1 min-w-0 flex items-start gap-2.5 text-left">
            {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-2" />}
            {/* 시스템 알림은 아이콘 — 마감은 시계, 예배는 교회, 모임은 사람들(0053). 사람이 만든 것은 아바타 */}
            {isSystemNotif(n.kind) ? (
              <SystemIcon kind={n.kind} />
            ) : (
              <Avatar name={n.actor_name || ''} className="flex w-6 h-6 text-[10px]" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] text-fg-secondary leading-snug">
                {isSystemNotif(n.kind)
                  ? notifLine(n.kind, n.actor_name)
                  : <><span className="font-semibold text-fg">{n.actor_name}</span>님이 {notifText(n.kind)}</>}
              </span>
              {n.preview && <span className="block text-[10px] text-fg-muted truncate mt-0.5">{n.preview}</span>}
              <span className="block text-[10px] text-fg-muted mt-0.5">{formatRelative(n.created_at)}</span>
            </span>
          </button>
          {/* hover로 숨기지 않는다 — 터치 기기에는 hover가 없어서 이 기능이 아예
              없는 것처럼 보인다(§7) */}
          <button
            onClick={() => dismiss(n)} title="이 알림 지우기" aria-label="이 알림 지우기"
            className="shrink-0 -mr-1 p-1 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 게스트 시연 종(미리보기 빌드 · opsDemo.demoOn) ─────────────────────────────
// 알림은 services/opsDemo.js의 브라우저 목록(씨앗 + 관리자 메뉴 '해결'이 넣는 것) · 판은 클라우드 종과 같은 BellPanel.
// '알림 설정'을 종 판에 둔 까닭: 알림을 받는 일('이 기기로 알림 받기')이 이미 이 판에 있고, 설정 창(내 정보)은 '저장'으로 모아 쓰는 폼이라
// 누르는 즉시 바뀌는 토글과 결이 다르다(시안 결정).
function GuestBell({ onOpenLink }) {
  const all = useGuestNotifs();
  const off = useNotifOff();
  const items = useMemo(() => filterNotifs(all, off), [all, off]);
  const unread = items.filter(n => !n.read).length;
  const pop = usePopover(320, 240, { portal: false, gap: 16, measure: true });
  const openItem = (n) => {
    setGuestNotifs(list => list.map(x => (x.id === n.id ? { ...x, read: true } : x)));
    pop.close();
    if (isAppLink(n.link)) onOpenLink?.(n.link);
  };
  const dismiss = (n) => setGuestNotifs(list => list.filter(x => x.id !== n.id));
  const readAll = () => setGuestNotifs(list => list.map(x => ({ ...x, read: true })));
  return (
    <span className="inline-flex shrink-0" ref={pop.rootRef}>
      <BellTrigger pop={pop} unread={unread} />
      <BellPanel pop={pop} items={items} unread={unread} readAll={readAll} openItem={openItem} dismiss={dismiss} off={off} />
    </span>
  );
}

// 갈래 넷 — 머리 줄(갈래 이름 + 스위치) 아래 항목 칸(사용자 문구 2026-10-18).
// 항목 칸은 **두 칸 격자**(같은 폭 · 같은 높이 32px · 왼쪽 맞춤 · 앞에 체크 상자) — 글자 길이가 다른 칩을 흘려 놓으면
// 줄 끝이 들쭉날쭉하고 혼자 남은 칩이 떠 보였다(사용자 지적 2026-10-18). 폰 판(화면 폭 - 32)·데스크톱 판(320) 둘 다 두 칸.
// 갈래가 꺼지면 칸은 흐리고(.4) 못 누른다 — 체크 상자는 저장된 항목 값을 그대로 보인다(갈래를 켜면 그대로 살아난다).
// 누르는 즉시 바뀌고 저장된다(notifOff) — 저장이 실패하면 값이 되돌아가고 토스트. 흐려짐·색·체크는 quint로 바뀐다(.ops-ease · .ops-pop).
function NotifPrefs({ off }) {
  // 받는 사람에게만 서는 칩(모임 > 새가족 · 0121) — 종이 붙을 때 미리 물어 둔 값(askWelcome) · 아직 모르면 목록 자리에 스켈레톤
  const uid = useAuth().session?.user?.id || null;
  const known = welcomeAsk.uid === uid ? welcomeAsk.value : undefined;
  const [can, setCan] = useState(() => (known === undefined ? null : { welcome: known }));
  useEffect(() => {
    let alive = true;
    askWelcome(uid).then(v => { if (alive) setCan({ welcome: v }); });
    return () => { alive = false; };
  }, [uid]);
  const flip = (key) => setNotifOff(flipOff(off, key)).then(e => { if (e) showToast(failText('저장하지 못했어요', e)); });
  if (!can) {
    return (
      <div className="divide-y divide-line/60" data-notif-prefs="" aria-busy="true">
        {visibleGroups({}).map(g => (
          <div key={g.key} className="px-3 py-3">
            <div className="min-h-6 flex items-center gap-3"><Skeleton className="w-16 h-3.5" /><span className="flex-1" /><Skeleton className="w-9 h-5 rounded-full" /></div>
            {g.items.length > 0 && <div className="grid grid-cols-2 gap-1.5 mt-2.5">{g.items.map(it => <Skeleton key={it.key} className="h-8" />)}</div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y divide-line/60" data-notif-prefs="">
      {visibleGroups(can).map(g => {
        const on = !off.includes(g.key);
        return (
          <div key={g.key} className="px-3 py-3" data-notif-group={g.key}>
            <button type="button" role="switch" aria-checked={on} onClick={() => flip(g.key)}
              className="w-full min-h-6 flex items-center gap-3 text-left">
              <span className="flex-1 text-[12.5px] font-semibold text-fg">{g.label}</span>
              <ShareSwitch on={on} />
            </button>
            {g.items.length > 0 && (
              <div className={`grid grid-cols-2 gap-1.5 mt-2.5 ops-ease ${on ? '' : 'opacity-40'}`}>
                {g.items.map(it => {
                  const key = `${g.key}.${it.key}`;
                  const itOn = !off.includes(key);
                  return (
                    <button key={it.key} type="button" aria-pressed={itOn} disabled={!on} onClick={() => flip(key)} data-notif-item={key}
                      className={`h-8 min-w-0 flex items-center gap-2 px-2.5 rounded-md text-left text-[11.5px] font-semibold ops-ease disabled:pointer-events-none ${
                        itOn ? 'bg-accent-weak text-accent-text' : 'bg-surface-hover text-fg-muted hover:text-fg'}`}>
                      <span aria-hidden="true" className={`shrink-0 w-3.5 h-3.5 rounded-[4px] flex items-center justify-center ops-ease ${
                        itOn ? 'bg-accent text-white' : 'border border-line bg-surface'}`}>
                        {itOn && <Check size={10} strokeWidth={3} className="ops-pop" />}
                      </span>
                      <span className="min-w-0 truncate">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
