// ============================================================================
// 첨부 올리기 줄 — 올리는 중인 파일과 **못 올린 파일**의 목록(업무마다).
// ----------------------------------------------------------------------------
// attachments.jsx에서 떼어 냈다(2026-10-09) — 화면 없이 노드에서 돌려 보려고
// (tests/logcheck-task: 한 번 실패 → 빨간 줄이 남는다 → 다시 시도로 올라간다).
//
// **모듈 레벨**이다. 업무 창을 닫아도 업로드는 계속 도는데(예전부터 그랬다), 이 목록이
// 컴포넌트 안에만 있으면 창을 다시 열었을 때 그 줄이 사라진다 — 드라이브에도 DB에도
// 아직 없어서 목록 조회에도 안 잡힌다. 그러면 화면이 **아무 일도 안 하고 있다고
// 거짓말한다**(사용자 지적 2026-08-28). 지금은 창을 닫았다 열어도 줄이 그대로 서 있다.
// 탭을 닫으면 사라지는 것은 그대로다 — 바이트가 메모리에만 있다(§6-29-k).
//
// 못 올린 파일(`_failed`)도 같은 목록에 남는다(2026-10-09). 예전에는 실패하면 줄이
// 사라져서 토스트를 놓치면 파일을 다시 골라야 했다. 이제 빨간 줄로 서서 '다시 시도'를
// 기다린다. blob 주소는 줄이 **빠질 때만** 돌려준다 — 다시 시도는 같은 줄·같은 주소로 간다.
// ============================================================================
export const uploadingByCard = new Map();   // cards.id → [고른 파일 줄]
export const uploadWatchers = new Set();    // 지금 떠 있는 첨부 영역들(보기·수정이 다른 인스턴스다)

// 아직 올라가는 중인 줄이 있나 — 못 올린 줄은 셈하지 않는다(그건 기다리는 일이 아니다)
const active = (list) => (list || []).some(r => !r._failed);
export const hasActiveUploads = (cardId) => active(uploadingByCard.get(cardId));

// 탭을 닫으려 하면 묻는 것도 여기서 건다. 업무 창이 아니라 **탭**이 기준이라
// 컴포넌트에 매달아 두면 창을 닫는 순간 경고가 같이 풀렸다.
const warnUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
export const notifyUploads = () => {
  if (typeof window !== 'undefined') {
    if ([...uploadingByCard.values()].some(active)) window.addEventListener('beforeunload', warnUnload);
    else window.removeEventListener('beforeunload', warnUnload);
  }
  uploadWatchers.forEach(fn => fn());
};

// 고른 파일 → 목록 줄. 사진은 고른 바이트로 바로 그린다(blob 주소).
export const stagedRow = (f) => ({
  id: `local:${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
  name: f.name, size_bytes: f.size, mime_type: f.type || null,
  source: 'local', _file: f,
  _url: (f.type || '').startsWith('image/') ? URL.createObjectURL(f) : null,
});

// 같은 id가 이미 있으면(다시 시도) **그 자리에서** 바꾼다 — 줄이 맨 밑으로 튀지 않는다
const put = (cardId, rows) => {
  const list = [...(uploadingByCard.get(cardId) || [])];
  for (const r of rows) {
    const i = list.findIndex(p => p.id === r.id);
    if (i >= 0) list[i] = r; else list.push(r);
  }
  uploadingByCard.set(cardId, list);
  notifyUploads();
};
export const stageUploads = (cardId, rows) => put(cardId, rows.map(r => ({ ...r, _failed: false })));
export const failUpload = (cardId, id) => {
  const row = (uploadingByCard.get(cardId) || []).find(p => p.id === id);
  if (row) put(cardId, [{ ...row, _failed: true }]);
};
export const unstageUpload = (cardId, id) => {
  const list = uploadingByCard.get(cardId) || [];
  const row = list.find(p => p.id === id);
  if (!row) return;
  if (row._url) URL.revokeObjectURL(row._url);
  const left = list.filter(p => p.id !== id);
  if (left.length) uploadingByCard.set(cardId, left); else uploadingByCard.delete(cardId);
  notifyUploads();
};

// 줄들을 올린다 — **동시 3개**. 순차는 사진 열 장에 수십 초였다.
//   prepare()      파일보다 먼저 한 번(폴더 확보). 여기서 던지면 남은 줄은 전부 못 올린 줄이 된다.
//   send(file, x)  한 파일을 보낸다(x = prepare가 돌려준 것). 돌려준 값이 결과 목록에 들어간다.
//   onError(file, e) 한 파일이 실패했을 때(토스트).
export async function runUploads({ cardId, rows, prepare, send, onError }) {
  if (!rows.length) return [];
  stageUploads(cardId, rows);
  const done = [];
  try {
    const ctx = prepare ? await prepare() : undefined;
    const LIMIT = 3;
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const row = rows[next++];
        try {
          done.push(await send(row._file, ctx));
          unstageUpload(cardId, row.id);
        } catch (e) {
          onError?.(row._file, e);
          failUpload(cardId, row.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LIMIT, rows.length) }, worker));
  } finally {
    // 아직 '올리는 중'으로 남은 줄(prepare에서 던졌을 때) — 끝나지 않는 '올리는 중'을
    // 남기지 않고 못 올린 줄로 세운다(다시 시도할 수 있게).
    const ids = new Set(rows.map(r => r.id));
    for (const r of uploadingByCard.get(cardId) || []) {
      if (ids.has(r.id) && !r._failed) failUpload(cardId, r.id);
    }
  }
  return done;
}

// '다시 시도'가 넘길 줄 — 못 올린 줄만 돌려준다(이미 다시 올라가는 중이면 null)
export const failedRow = (cardId, id) =>
  (uploadingByCard.get(cardId) || []).find(p => p.id === id && p._failed) || null;
