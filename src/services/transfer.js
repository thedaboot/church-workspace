// ============================================================================
// 바이트가 오가는 동안의 진행 — 올리기(XHR upload.onprogress)와 받기(응답 스트림) 한 벌(2026-10-15 · UX 다듬기 2차 C2·C4 · PITFALLS 60).
// ----------------------------------------------------------------------------
// **순수 모듈이다**(import 0 · 브라우저 전역은 부를 때만 본다) — tests/logcheck-task가 가짜 XHR·가짜 Response로 노드에서 돌린다.
//   pctOf(loaded, total)        0~100 정수 · 전체를 모르면 null(화면은 퍼센트를 안 세운다)
//   xhrSend({ url, method, headers, body, onProgress, signal })
//                               fetch는 올리는 진행을 주지 않아서 XHR로 보낸다. 돌려주는 것은 fetch의 Response 흉내
//                               ({ ok, status, json(), text() }) — 부르는 쪽(cloud/drive.js driveOnce)이 fetch 때와 같은 줄로 읽는다.
//                               onProgress(loaded, total)는 **올리는 바이트**의 진행이고, 다 보낸 순간(upload.onload) 한 번 더
//                               onSent()를 부른다 — 그 뒤는 서버가 드라이브로 옮기는 시간이다('드라이브로 옮기는 중').
//                               signal이 끊으면 xhr.abort() → `cancelled` 표시가 붙은 오류로 던진다(재시도·실패 토스트 갈래가 거른다).
//   readBody(response, onProgress)
//                               응답 몸통을 조각으로 읽으며 Content-Length에 대한 진행을 알린다 → Blob. 길이 머리줄이 없으면
//                               (압축돼 온 응답 — api/drive-file은 그때 길이를 안 싣는다 · 56-a) total = 0으로 알린다.
// ============================================================================

export const pctOf = (loaded, total) =>
  (total > 0 ? Math.max(0, Math.min(100, Math.floor((loaded / total) * 100))) : null);

export const cancelledError = () => Object.assign(new Error('올리기를 멈췄어요'), { cancelled: true, name: 'AbortError' });

export function xhrSend({ url, method = 'POST', headers = {}, body = null, onProgress = null, onSent = null, signal = null, XHR = globalThis.XMLHttpRequest }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelledError()); return; }
    const xhr = new XHR();
    xhr.open(method, url, true);
    for (const [k, v] of Object.entries(headers)) if (v != null) xhr.setRequestHeader(k, v);
    let sent = false;
    const markSent = () => { if (!sent) { sent = true; onSent?.(); } };
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => { onProgress?.(e.loaded, e.lengthComputable ? e.total : 0); };
      xhr.upload.onload = markSent;
    }
    const onAbort = () => xhr.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener?.('abort', onAbort);
    xhr.onload = () => {
      done();
      markSent();
      const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: async () => text,
        json: async () => JSON.parse(text),
      });
    };
    // 끊긴 연결은 fetch처럼 상태 없는 TypeError로 — driveOnce가 그것을 '다시 해볼 만한 실패'(status 없음)로 읽는다
    xhr.onerror = () => { done(); reject(new TypeError('Failed to fetch')); };
    xhr.ontimeout = () => { done(); reject(new TypeError('Failed to fetch')); };
    xhr.onabort = () => { done(); reject(cancelledError()); };
    xhr.send(body);
  });
}

export async function readBody(response, onProgress = null) {
  const total = Number(response.headers?.get?.('content-length')) || 0;
  if (!response.body?.getReader || !onProgress) return response.blob();
  const reader = response.body.getReader();
  const parts = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(parts, { type: response.headers?.get?.('content-type') || '' });
}
