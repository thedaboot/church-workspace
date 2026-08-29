// ============================================================================
// 서비스 워커 — 웹 푸시 수신 전용. 캐싱은 하지 않는다.
// ----------------------------------------------------------------------------
// 오프라인 캐시를 붙이면 배포한 새 버전이 낡은 캐시에 갇혀서, 무엇이 도는지
// 알 수 없는 상태가 만들어진다. 이 워커가 하는 일은 두 가지뿐이다:
//   push             → 알림을 띄운다
//   notificationclick → 이미 열린 탭이 있으면 그 탭을 딥링크로 보내고, 없으면 새로 연다
//
// 이 파일은 빌드를 타지 않는다(public/ 이므로 그대로 배포된다) — 번들러 문법을
// 쓸 수 없고, 스코프는 '/'이다.
// ============================================================================

// 새로 배포된 워커가 기존 탭이 닫히기를 기다리지 않게 한다. 캐시가 없으니
// 즉시 교체해도 낡은 자원이 섞일 위험이 없다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // 페이로드가 없거나 JSON이 아니어도 알림은 띄운다 — userVisibleOnly로 구독했으므로
  // 아무것도 안 띄우면 브라우저가 "이 사이트가 백그라운드에서 실행 중" 경고를 대신 띄운다.
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || '더다붓';
  const shown = self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // 같은 업무에 대한 알림은 겹쳐 쌓이지 않고 마지막 것으로 갱신된다.
    tag: data.tag || 'thedaboot',
    data: { url: data.url || '/' },
  });

  // 아이콘 위 숫자(안 읽은 알림 수). **아이폰 홈 화면 웹앱에서만 보인다** — 안드로이드
  // 크롬에는 이 API가 없고, 알림이 와 있으면 OS가 알아서 점을 붙인다. 뱃지 API는 워커
  // 안에서도 쓸 수 있어서, 앱이 닫혀 있는 동안 온 알림도 숫자에 들어간다(앱이 열려 있을
  // 때는 NotificationBell이 같은 값을 다시 맞춘다).
  // 서버가 세지 못했으면 null로 온다 — 그때는 손대지 않는다. 0으로 덮으면 남아 있던
  // 숫자가 사라져서 "읽지도 않았는데 뱃지가 없어졌다"가 된다.
  const n = data.appBadge;
  const badged = (typeof n === 'number' && navigator.setAppBadge)
    ? (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();

  event.waitUntil(Promise.all([shown, badged]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 이미 열려 있는 탭을 재사용한다. 매번 새 창을 열면 아이폰에서 PWA가 여러 개
    // 쌓인 것처럼 보인다. navigate가 막히는 경우(다른 출처)만 새로 연다.
    for (const c of clientList) {
      try {
        await c.navigate(url);
        return await c.focus();
      } catch { /* 다음 후보로 */ }
    }
    return self.clients.openWindow(url);
  })());
});
