import React, { useState, useEffect } from 'react';
import { X, Bell, BellRing, BellOff, Users, CalendarClock, Smartphone, Church } from 'lucide-react';
import { store } from '../store/workspaceStore.js';
import { useAuth } from '../services/auth.jsx';
import { formatRelative } from '../utils.js';
import { myUid } from '../services/supabaseClient.js';
import { Avatar } from './Avatar.jsx';
import * as cloudSync from '../services/cloudSync.js';
import * as push from '../services/push.js';
import { notifLine, notifText, isSystemNotif, notifArea } from '../services/notifyText.js';
import { isAppLink } from '../services/entryQuery.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import { usePopover } from '../hooks/usePopover.js';

// ============================================================================
// 알림 종(클라우드 모드에서만 선다 · 데스크톱 TopNav와 폰 상단바가 같은 것을 쓴다).
// 19차 묶음 D에서 layout.jsx에서 갈라 왔다(동작·모양은 그대로).
//   · 알림은 **남긴 계정 앞으로** 온다(0063) — 구독 필터는 myUid()로 물은 값(세션 uid가 아니다)
//   · 판 안: 머리(모두 읽음) · 안드로이드 설치 줄 · '이 기기로 알림 받기'(권한은 여기서 묻는다) · 알림 줄(열기 · 지우기)
//   · 판은 앵커 곁에 그린다(portal: false — 원래 그렇다) · 껍데기는 hooks/usePopover 한 벌
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

// 시스템 알림의 동그라미 — 갈래(notifArea)마다 [아이콘, 색]. 표에 없는 갈래(마감 등)는 시계
const AREA_ICON = {
  worship: [Church, 'bg-accent-weak text-accent-text'],
  group: [Users, 'bg-tag-green text-tag-green-fg'],
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

export function NotificationBell({ onOpenTask, onOpenLink }) {
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
  // 바깥 클릭 / Esc 닫기는 프로필 메뉴·검색과 같은 훅 한 벌(usePopover 안의 useDismiss) — 이 판은
  // rootRef 안에 그려진다(포털이 아니다 · portal: false)
  const pop = usePopover(320, 240, { portal: false });
  const unread = items.filter(n => !n.read).length;

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

  // 실시간: 본인 수신 알림 INSERT
  useEffect(() => {
    if (!userId) return;
    const unsub = cloudSync.subscribeMyNotifications(userId, (row) => {
      setItems(prev => (prev.some(n => n.id === row.id) ? prev : [row, ...prev].slice(0, 30)));
      showToast(notifLine(row.kind, row.actor_name));
    });
    return unsub;
  }, [userId]);

  const openItem = (n) => {
    pop.close();
    if (!n.read) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
      cloudSync.markNotificationRead(n.id).catch(e => console.error('[cloud] 알림 읽음 처리 실패:', e));
    }
    // 예배·모임 알림(0053)은 우리 주소 한 칸으로 간다 — App이 화면을 바꾸고 나머지 값은
    // entryQuery에 실어 그 화면이 마운트되며 읽는다(새로고침 없음).
    if (isAppLink(n.link)) { onOpenLink?.(n.link); return; }
    if (!n.card_id) return;
    const task = store.getState().tasks.byId[n.card_id];
    if (task) onOpenTask?.(task);
    else showToast('업무를 찾을 수 없어요');
  };

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
      {pop.panel('z-[90] max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated', <>
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-line sticky top-0 bg-surface">
            <span className="text-xs font-bold text-fg">알림</span>
            {unread > 0 && (
              <button onClick={readAll} className="text-[10px] text-accent-text hover:bg-surface-hover rounded-md px-1.5 py-1 transition active:scale-95">모두 읽음</button>
            )}
          </div>
          <InstallRow />
          <PushRow />
          {items.length === 0 ? (
            <div className="text-center py-8 px-3">
              <span className="inline-flex w-8 h-8 rounded-full bg-tag-yellow text-tag-yellow-fg items-center justify-center mb-2"><Bell size={13} strokeWidth={1.75} /></span>
              <p className="text-xs text-fg-faint">새로운 알림이 없어요</p>
            </div>
          ) : (
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
                    {/* 마감 알림은 사람이 만든 게 아니라 배치가 만든다 — 아바타 대신 시계 */}
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
          )}
        </>)}
    </span>
  );
}
