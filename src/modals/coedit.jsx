import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store } from '../store/workspaceStore.js';
import { myUid } from '../services/supabaseClient.js';
import { cardWritePromise, profileName } from '../services/cloudSync.js';
import { userColor, facesFrom, versionLabel, versionTime, versionDiff } from '../services/coedit/view.js';
import { errorReason } from '../services/errorText.js';
import { BTN } from '../components/buttons.js';
import { ListSkeleton } from './comments.jsx';

// ============================================================================
// 업무 창의 같이 쓰기 부품 — 여는 훅 · 머리줄 얼굴 · 버전 기록 탭 · 고친 곳 보기 (0084)
// ----------------------------------------------------------------------------
// 엔진은 services/coedit/index.js이고 **여기서는 늦게 받는다**(`import()`) — yjs·y-tiptap이
// 첫 화면과 업무 창의 첫 조각에 실리지 않게(§6-29-z-18 · tests/coedit가 배선을 본다).
// 이 파일이 정적으로 부르는 것은 순수 모듈 view.js(import 0)뿐이다.
// ============================================================================

const loadEngine = () => import('../services/coedit/index.js');

// ── 같이 쓰기 열기 ──────────────────────────────────────────────────────────
// 카드 id마다 한 번 연다. 닫힐 때(창을 닫거나 다른 업무로 넘어갈 때) destroy — **편집기가 먼저
// 내려가게** 한 박자 미룬다(index.js 머리말 '편집기를 먼저 내리고').
// 돌려주는 것: { co, failed } — co가 서기 전에는 본문 자리에 뼈대가 선다. failed면 혼자 쓰기로
// 간다(업무 창이 마크다운을 직접 저장 · 예전 길).
//
// **새로 만든 업무는 카드 행이 먼저 있어야 한다** — card_docs·card_doc_updates가 cards를
// 참조해서 심기가 외래키로 실패한다. 첨부 업로드와 같은 이유로 카드 쓰기를 기다린다(cardWritePromise).
//
// `divergedAtOpen`(description이 문서와 다르다 — 옛 앱을 쓰는 사람이 같이 쓰기 밖에서 본문을
// 고쳤다) → **한 번만** description을 받아들인다(replaceAll). 안 받아들이면 다음 거울이 그 사람의
// 글을 문서의 옛 글로 덮어 **그 사람의 편집이 조용히 사라진다**. 다만 문서 쪽이 새것일 수도 있어서
// (누가 지금 쓰는 중 · 거울이 못 가고 끊겼다) 엔진의 adoptCheck가 셋을 본다. 받아들이는 편집은
// 내 이름의 편집 한 번이 되지만 **활동 기록·멘션은 남기지 않는다**(내가 쓴 글이 아니다 — 받아들이자마자
// 세션을 끝내고(flush) 그 onVersion을 건너뛴다). 판은 한 줄 선다(그 글이 된 순간이라 거짓은 아니다).
export const ADOPT_WAIT_MS = 1500;   // hello에 남들이 답할 틈(커서 왕복 ≈ 200ms + 채널 왕복)

export function useCoedit({ cardId, enabled, name, onMirror, onVersion }) {
  const [state, setState] = useState({ co: null, failed: false, id: null });
  const cb = useRef({});
  cb.current = { onMirror, onVersion };
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    if (!enabled || !cardId) { setState({ co: null, failed: false, id: null }); return undefined; }
    let alive = true;
    let opened = null;
    let adopting = false;
    let touched = false;
    let adoptTimer = null;
    setState({ co: null, failed: false, id: cardId });
    (async () => {
      try {
        const [{ openCoedit }, uid] = await Promise.all([loadEngine(), myUid().catch(() => null)]);
        if (!(await cardWritePromise(cardId))) throw new Error('카드가 아직 저장되지 않았다');
        if (!alive) return;
        const card = store.getState().tasks.byId[cardId];
        const who = nameRef.current || '';
        const co = await openCoedit({
          cardId,
          user: { id: uid || '', name: who, color: userColor(uid || who) },
          markdown: card?.content || '',
          onMirror: (md) => cb.current.onMirror?.(md),
          onVersion: (v) => { if (!adopting) cb.current.onVersion?.(v); },
        });
        if (!alive) { co.destroy(); return; }
        opened = co;
        setState({ co, failed: false, id: cardId });
        if (co.divergedAtOpen) {
          const onLocal = (_u, origin) => { if (origin && typeof origin !== 'symbol') touched = true; };
          co.ydoc.on('update', onLocal);
          adoptTimer = setTimeout(async () => {
            co.ydoc.off('update', onLocal);
            const live = store.getState().tasks.byId[cardId];
            if (!alive || touched || !live || !(await co.adoptCheck(live.updatedAt))) return;
            if (!alive) return;
            adopting = true;
            try { co.replaceAll(live.content || ''); await co.flush(); } finally { adopting = false; }
          }, ADOPT_WAIT_MS);
        }
      } catch (e) {
        console.warn('[coedit] 같이 쓰기를 열지 못했어요 — 혼자 쓰기로 갑니다:', e);
        if (alive) setState({ co: null, failed: true, id: cardId });
      }
    })();
    return () => {
      alive = false;
      clearTimeout(adoptTimer);
      if (opened) { const c = opened; setTimeout(() => { c.destroy(); }, 0); }
    };
  }, [cardId, enabled]);

  // 다른 카드로 넘어간 첫 렌더에 앞 카드의 co를 돌려주지 않는다
  return state.id === cardId ? state : { co: null, failed: false, id: cardId };
}

// ── awareness 구독 ──────────────────────────────────────────────────────────
function useAwarenessFaces(awareness) {
  const snap = useRef({ key: '', faces: [] });
  const subscribe = useCallback((fn) => {
    if (!awareness) return () => {};
    awareness.on('change', fn);
    return () => awareness.off('change', fn);
  }, [awareness]);
  const get = () => {
    if (!awareness) return snap.current.faces;
    const faces = facesFrom(awareness.getStates(), awareness.clientID);
    const key = faces.map(f => `${f.key}|${f.name}|${f.color}`).join(',');
    if (key !== snap.current.key) snap.current = { key, faces };
    return snap.current.faces;
  };
  return useSyncExternalStore(subscribe, get, get);
}

// 머리줄 얼굴 — 지금 이 본문에 들어와 있는 사람(나 먼저). 이름 첫 글자 + 그 사람의 색
// (이름표 커서와 같은 색) · 표면색 고리로 겹친다(-6px) · title은 이름. 나 혼자여도 선다 —
// 누가 들어오는 순간 얼굴 줄이 생기며 머리줄이 밀리지 않게.
export function CoeditFaces({ awareness }) {
  const faces = useAwarenessFaces(awareness);
  if (!faces.length) return null;
  return (
    <span data-coedit-faces="" className="flex items-center mr-1.5">
      {faces.slice(0, 5).map((f, i) => (
        <span key={f.key} title={f.name} data-face={f.name}
          className={`inline-flex w-[22px] h-[22px] rounded-full items-center justify-center text-[10px] font-bold text-white ring-2 ring-surface shrink-0 ${i ? '-ml-1.5' : ''}`}
          style={{ background: f.color, zIndex: 10 - i }}>
          {f.name[0] || '?'}
        </span>
      ))}
      {faces.length > 5 && (
        <span className="-ml-1.5 inline-flex h-[22px] min-w-[22px] px-1 rounded-full items-center justify-center text-[10px] font-bold bg-surface-hover text-fg-muted ring-2 ring-surface">
          +{faces.length - 5}
        </span>
      )}
    </span>
  );
}

// ── 버전 기록 탭 ────────────────────────────────────────────────────────────
// 탭을 처음 열 때 읽는다(card_doc_versions · 최신이 앞). 줄: 그 사람 색 점(첫 글자) · 이름 ·
// `오늘 오후 3:12 · 2줄 추가 · 1줄 제거`(0인 쪽은 뺀다 · 가장 오래된 판은 `처음 작성한 본문`).
// 줄을 누르면 본문 자리가 그 판의 **고친 곳**(바로 앞 판 → 이 판의 줄 차이 · view.versionDiff)으로 바뀐다.
// 실패는 빈 자리에 선다(§8 D2 — 토스트 없이 제목 · 까닭 · 다시 시도).
export function VersionPanel({ cardId, pickedId, onPick, refreshKey = 0 }) {
  const [st, setSt] = useState({ loading: true, rows: null, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt(s => ({ ...s, loading: true }));
    loadEngine().then(m => m.loadVersions(cardId))
      .then(rows => { if (alive) setSt({ loading: false, rows: rows || [], error: null }); })
      .catch(e => { console.error('[coedit] 버전 기록 읽기 실패:', e); if (alive) setSt({ loading: false, rows: null, error: e }); });
    return () => { alive = false; };
  }, [cardId, refreshKey, retry]);

  if (st.error && !st.rows) {
    return (
      <div className="load-failed py-6 text-left" role="alert">
        <p className="load-fail-title text-[13.5px] font-semibold text-fg">버전 기록을 읽지 못했어요</p>
        <p className="load-fail-reason mt-1 text-xs leading-[1.625] text-fg-muted whitespace-pre-line">{errorReason(st.error)}</p>
        <div className="mt-3"><button type="button" onClick={() => setRetry(n => n + 1)} className={`load-fail-retry ${BTN}`}>다시 시도</button></div>
      </div>
    );
  }
  if (!st.rows) return <ListSkeleton />;
  if (!st.rows.length) {
    return (
      <div className="text-center mt-6">
        <span className="inline-flex w-8 h-8 rounded-full bg-tag-blue text-tag-blue-fg items-center justify-center mb-2"><span className="w-1.5 h-1.5 rounded-full bg-current" /></span>
        <p className="text-xs text-fg-faint">기록 전</p>
      </div>
    );
  }
  const now = new Date();
  const list = st.rows;
  return (
    <div data-version-list="" className="space-y-1 -mx-1">
      {list.map((v, i) => {
        const name = profileName(v.by) || '이름 미상';
        const label = versionLabel(v, i === list.length - 1);
        const on = v.id === pickedId;
        return (
          <button key={v.id} type="button" data-version-row={v.id} aria-pressed={on}
            onClick={() => onPick?.({ version: v, name, time: versionTime(v.at, now), rows: versionDiff(list, i) })}
            className={`w-full flex items-start gap-2.5 px-1.5 py-2 rounded-md text-left transition-colors ${on ? 'bg-accent-weak' : 'hover:bg-surface-hover'}`}>
            <span className="mt-0.5 inline-flex w-6 h-6 rounded-full items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: userColor(v.by || name) }}>{name[0]}</span>
            <span className="min-w-0 flex-1">
              <span className={`block text-xs font-semibold truncate ${on ? 'text-accent-text' : 'text-fg'}`}>{name}</span>
              <span className="block text-[11px] text-fg-muted mt-0.5">{[versionTime(v.at, now), label].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 고친 곳 보기 — 본문 자리에 선다 ─────────────────────────────────────────
// 더한 줄은 초록 물 + `+`, 뺀 줄은 빨강 물 + 취소선 + `−`(태그 초록·빨강 토큰 — 두 테마를 따라간다).
// 도구 줄은 확정 왼쪽 · 나가기 오른쪽(§8 상시 도구 줄): `이 버전으로 되돌리기` → 본문을 그 판으로
// (같이 쓰기면 한 번의 편집 · 되돌리기 한 걸음 · 모두에게 퍼진다) · `현재 본문으로` → 보기만 닫는다.
export function VersionDiffView({ pick, onRestore, onExit, restoring = false }) {
  return (
    <div data-version-diff="" className="border border-line rounded-md overflow-hidden bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 bg-surface-2 border-b border-line">
        <p className="flex-1 min-w-[10rem] text-xs font-semibold text-fg">{pick.name} · {pick.time}에 고친 곳</p>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onRestore} disabled={restoring} className={BTN}>이 버전으로 되돌리기</button>
          <button type="button" onClick={onExit}
            className="px-3 py-1.5 rounded-md bg-surface-hover hover:bg-line text-fg-muted text-[11.5px] font-semibold transition active:scale-95">현재 본문으로</button>
        </div>
      </div>
      <div className="py-2 text-[13px] leading-relaxed min-h-40 md:min-h-56">
        {pick.rows.map((r, i) => (
          <div key={i} data-diff={r.op}
            className={`flex gap-2 px-3 ${r.op === 'add' ? 'bg-tag-green text-tag-green-fg' : r.op === 'del' ? 'bg-tag-red text-tag-red-fg' : 'text-fg-secondary'}`}>
            <span aria-hidden className="w-3 shrink-0 text-center select-none">{r.op === 'add' ? '+' : r.op === 'del' ? '−' : ''}</span>
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${r.op === 'del' ? 'line-through' : ''}`}>{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
