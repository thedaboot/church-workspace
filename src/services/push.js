import * as cloud from './cloud.js';

// ============================================================================
// 웹 푸시 구독 (브라우저 쪽)
// ----------------------------------------------------------------------------
// 앱 안 알림(NotificationBell)은 실시간 구독으로 이미 뜬다. 여기는 **앱을 닫아 둔
// 동안에도** 닿게 하는 길이다. 청년부가 이 앱을 매일 열지는 않는다.
//
// 상태의 원본은 브라우저의 PushSubscription이다(DB 행이 아니라). 기기에서 권한을
// 껐거나 브라우저 데이터를 지웠으면 DB 행은 남아 있어도 실제로는 안 오므로,
// 화면에 보여줄 켜짐/꺼짐은 항상 pushManager.getSubscription()으로 판정한다.
// 죽은 DB 행은 발송에서 410/404를 받으면 서버가 지운다(api/push.js).
//
// **iOS는 홈 화면에 추가(PWA)한 뒤에만 동작한다**(iOS 16.4+). 브라우저 탭에서는
// 권한 요청 자체가 뜨지 않으므로, 물어보기 전에 안내를 띄워야 한다.
// ============================================================================

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

// applicationServerKey는 base64url 문자열이 아니라 바이트 배열을 받는다.
const urlBase64ToUint8Array = (base64) => {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  // 아이패드는 데스크톱 UA를 쓴다 — 터치 가능한 Mac은 아이패드로 본다.
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// 안드로이드는 **설치하지 않아도** 브라우저 탭에서 푸시가 온다(iOS와 정반대다).
// 그래서 이 판정은 알림이 아니라 '앱처럼 쓰기' 안내에만 쓴다.
export const isAndroid = () => /Android/.test(navigator.userAgent);

// 홈 화면에서 띄운 상태인지 (iOS는 navigator.standalone, 나머지는 display-mode)
export const isStandalone = () => window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

const pushConfigured = () => !!VAPID_PUBLIC;

const apiSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 화면이 분기해야 하는 상태를 하나로 모아 돌려준다.
//   'unavailable' 키가 없거나(배포 전) 브라우저가 지원하지 않음 → 줄을 숨긴다
//   'needs-pwa'   iOS인데 홈 화면에서 띄운 게 아님 → 안내만 보여준다
//   'denied'      한 번 거부됨 → 다시 물어봐도 창이 안 뜬다. 안내만.
//   'on' / 'off'  실제 구독 유무
export async function getPushState() {
  if (!pushConfigured() || !apiSupported()) return 'unavailable';
  if (isIos() && !isStandalone()) return 'needs-pwa';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

// 켜기 — 서비스 워커 등록 → 권한 요청 → 구독 → DB 저장.
// 앱을 처음 열 때 부르지 마세요. 한 번 거부되면 브라우저 설정에서 손으로 되돌려야 합니다.
export async function enablePush() {
  if (!pushConfigured()) throw new Error('푸시 키가 설정되지 않았어요 (VITE_VAPID_PUBLIC_KEY).');
  if (!apiSupported()) throw new Error('이 브라우저는 알림을 지원하지 않아요.');
  if (isIos() && !isStandalone()) throw new Error('홈 화면에 추가하면 알림을 받을 수 있어요.');

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  // 방금 등록한 워커는 아직 활성 상태가 아닐 수 있고, 그때 subscribe가 실패한다.
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았어요.');

  // 이미 구독이 있으면 그대로 쓴다(구독은 기기당 하나다).
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });

  await cloud.savePushSubscription(sub.toJSON());
  return true;
}

// 끄기 — 브라우저 구독 해제 + DB 행 삭제. 워커 등록은 남겨 둔다(다시 켤 때 빠르다).
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  const { endpoint } = sub;
  await sub.unsubscribe();
  await cloud.deletePushSubscription(endpoint);
  return true;
}
