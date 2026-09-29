import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pencil } from 'lucide-react';
import { store } from '../store/workspaceStore.js';
import { myUid } from '../services/supabaseClient.js';
import { cardWritePromise, profileName, getAvatar } from '../services/cloudSync.js';
import { userColor, facesFrom, versionLabel, versionTime, versionDiff, presenceLabel, presenceInk } from '../services/coedit/view.js';
import { errorReason } from '../services/errorText.js';
import { BTN } from '../components/buttons.js';
import { Avatar } from '../components/Avatar.jsx';
import { RichText } from '../components/RichText.jsx';
import { ListSkeleton } from './comments.jsx';

// ============================================================================
// 업무 창의 같이 쓰기 부품 — 여는 훅 · 얼굴(머리줄 · 수정 중 알약 · 줄 표시) · 보기 화면의 살아 있는 본문 ·
// 버전 기록 탭 · 고친 곳 보기 (0084 · 2026-09-29 보기/수정 나눔)
// ----------------------------------------------------------------------------
// 엔진은 services/coedit/index.js이고 **여기서는 늦게 받는다**(`import()`) — yjs·y-tiptap이
// 첫 화면과 업무 창의 첫 조각에 실리지 않게(§6-29-z-18 · tests/coedit가 배선을 본다).
// 이 파일이 정적으로 부르는 엔진 쪽은 순수 모듈 view.js(import 0)뿐이다.
//
// **보기 화면에서도 문서에 들어와 있다**(2026-09-29 · 목업 승인) — 창을 열면 보기든 수정이든 같이 쓰기를 연다.
// 보기 화면은 편집기 없이 문서의 마크다운을 그리고(useLiveMarkdown · 남이 치는 글이 150ms 안에 따라온다),
// awareness의 `editing`·`line`으로 '누가 수정 중인가'(PresencePill)와 '그 사람이 어느 줄에 있나'(PresenceMarks)를 세운다.
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
          // avatar — 이름표 커서·얼굴의 사진(남의 화면에서도 이름으로 다시 찾지 않아도 되게 싣는다)
          user: { id: uid || '', name: who, color: userColor(uid || who), avatar: getAvatar(who) || '' },
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

// ── 개발 빌드 전용 가짜 같이 쓰기 ────────────────────────────────────────────
// 게스트 검사가 얼굴·수정 중 알약·줄 표시·살아 있는 본문·고친 곳 보기를 그려 보게(tests/modalclose · 실제 사람 사이는
// 클라우드에서만 볼 수 있다). 창을 열 때 한 번 읽는다 — 없으면 null(배포 빌드에서는 늘 null):
//   window.__coeditFake = [[clientID, { user: { id, name, color, avatar? }, editing?, line? }], …]   첫 줄이 나다
//   window.__coeditFakeMd = '…'          문서의 마크다운(보기 화면이 이것을 그린다)
//   window.__coeditFakeVersions = [{ id, by, at, md, added, removed }, …]   버전 기록(최신이 앞)
// 값을 바꾼 뒤 `window.dispatchEvent(new Event('coedit-fake'))`를 쏘면 얼굴·본문이 다시 읽는다(남이 치는 흉내).
export function useDevFake() {
  const [fake] = useState(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null;
    const w = window;
    if (!Array.isArray(w.__coeditFake) && typeof w.__coeditFakeMd !== 'string' && !Array.isArray(w.__coeditFakeVersions)) return null;
    const subs = new Set();
    return {
      subs,
      awareness: Array.isArray(w.__coeditFake) ? {
        get clientID() { return w.__coeditFake?.[0]?.[0]; },
        getStates: () => new Map(w.__coeditFake || []),
        on: (_e, fn) => subs.add(fn), off: (_e, fn) => subs.delete(fn),
        // 내 줄(첫 줄)에 싣는다 — 수정 화면에 들어가면 내 얼굴에도 고리가 서는지 볼 수 있게
        setLocalStateField(k, v) { const r = w.__coeditFake?.[0]; if (r) { r[1] = { ...r[1], [k]: v }; subs.forEach(fn => fn()); } },
      } : null,
      doc: typeof w.__coeditFakeMd === 'string' ? {
        markdown: () => String(w.__coeditFakeMd ?? ''),
        onChange: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      } : null,
      versions: Array.isArray(w.__coeditFakeVersions) ? () => Promise.resolve(w.__coeditFakeVersions) : null,
    };
  });
  useEffect(() => {
    if (!fake) return undefined;
    const fire = () => fake.subs.forEach(fn => fn());
    window.addEventListener('coedit-fake', fire);
    return () => window.removeEventListener('coedit-fake', fire);
  }, [fake]);
  return fake;
}

// ── 보기 화면의 살아 있는 본문 ──────────────────────────────────────────────
// src = { markdown(), onChange(fn) → 끊기 } (같이 쓰기 문서 · 가짜). 문서가 바뀌면 **150ms에 한 번** 다시 적는다 —
// 남이 치는 글자마다 마크다운을 새로 적고 그리면 긴 본문에서 무겁다. src가 없으면 null(부르는 쪽이 스토어 본문을 쓴다).
export const LIVE_MD_MS = 150;
export function useLiveMarkdown(src) {
  const [md, setMd] = useState(() => (src ? src.markdown() : null));
  useEffect(() => {
    if (!src) { setMd(null); return undefined; }
    setMd(src.markdown());
    let timer = null;
    const off = src.onChange(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; setMd(src.markdown()); }, LIVE_MD_MS);
    });
    return () => { off?.(); clearTimeout(timer); };
  }, [src]);
  return src ? md : null;
}
// 같이 쓰기 문서 → 위 src 모양(업무 창이 co마다 한 번 만든다)
export const docSource = (co) => (co ? {
  markdown: () => co.markdown(),
  onChange: (fn) => { co.ydoc.on('update', fn); return () => co.ydoc.off('update', fn); },
} : null);

// ── awareness 구독 ──────────────────────────────────────────────────────────
// 얼굴 목록(view.facesFrom — 나 먼저 · 수정 중인가 · 커서 줄). 머리줄 얼굴과 보기 화면 알약·줄 표시가 같이 쓴다.
export function useCoeditFaces(awareness) {
  const snap = useRef({ key: '', faces: [] });
  const subscribe = useCallback((fn) => {
    if (!awareness) return () => {};
    awareness.on('change', fn);
    return () => awareness.off('change', fn);
  }, [awareness]);
  const get = () => {
    if (!awareness) return NO_FACES;
    const faces = facesFrom(awareness.getStates(), awareness.clientID);
    const key = faces.map(f => `${f.key}|${f.name}|${f.color}|${f.avatar}|${f.editing ? 1 : 0}|${f.line ?? ''}`).join(',');
    if (key !== snap.current.key) snap.current = { key, faces };
    return snap.current.faces;
  };
  return useSyncExternalStore(subscribe, get, get);
}
const NO_FACES = [];

// 사람 얼굴 하나 — 사진(Avatar) · 없으면 그 사람 색 바탕에 흰 첫 글자(이름표 커서와 같은 색)
const Face = ({ f, className }) => (
  <Avatar name={f.name} url={f.avatar || undefined} title="" fallbackClass="text-white"
    className={`flex ${className}`} style={{ background: f.color }} />
);

// 머리줄 얼굴 — 지금 이 본문에 들어와 있는 사람 전부(나 먼저 · 보기 화면에 있는 사람도). 표면색 고리로 겹친다(-6px).
// **수정 중인 사람**은 그 사람 색 2px 고리(밖에 표면색 1.5px — 이웃 얼굴과 가른다) + 오른쪽 아래 작은 연필(그 사람 색 ·
// 흰 연필) · title `이름 · 수정 중`. 고리가 선 얼굴 곁은 덜 겹친다(-2px) — 6px 겹치면 고리가 이웃에 반쯤 가렸다.
// 나 혼자여도 선다 — 누가 들어오는 순간 얼굴 줄이 생기며 머리줄이 밀리지 않게.
export function CoeditFaces({ awareness, faces: given }) {
  const own = useCoeditFaces(given ? null : awareness);
  const faces = given || own;
  if (!faces.length) return null;
  return (
    <span data-coedit-faces="" className="flex items-center mr-2">
      {faces.slice(0, 5).map((f, i) => (
        <span key={f.key} title={f.editing ? `${f.name} · 수정 중` : f.name} data-face={f.name} data-editing={f.editing ? '' : undefined}
          className={`relative inline-flex rounded-full shrink-0 ${i ? (f.editing || faces[i - 1].editing ? '-ml-0.5' : '-ml-1.5') : ''}`}
          style={{ zIndex: 10 - i, boxShadow: f.editing ? `0 0 0 2px ${f.color}, 0 0 0 3.5px var(--app-surface)` : '0 0 0 2px var(--app-surface)' }}>
          <Face f={f} className="w-[22px] h-[22px] text-[10px]" />
          {f.editing && (
            <span aria-hidden data-pencil=""
              className="absolute -right-1 -bottom-1 w-3 h-3 rounded-full inline-flex items-center justify-center"
              style={{ background: f.color, boxShadow: '0 0 0 1.5px var(--app-surface)' }}>
              <Pencil size={7} strokeWidth={3} color="#fff" />
            </span>
          )}
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

// ── 보기 화면: '○○○님이 수정 중' 알약 ────────────────────────────────────────
// 나 말고 수정 화면에 있는 사람(editors — 들어온 차례). 첫 사람의 얼굴 · 그 사람 색 12% 물 · 글자는 테마마다
// 4.5:1이 되게 섞은 색(view.presenceInk · index.css `.coedit-pill`). 둘 넘으면 `○○○님 외 N명이 수정 중`.
export function PresencePill({ editors }) {
  if (!editors?.length) return null;
  const f = editors[0];
  const ink = presenceInk(f.color);
  return (
    <span data-presence-pill="" className="coedit-pill inline-flex items-center gap-1.5 h-6 pl-0.5 pr-2.5 rounded-full text-[11.5px] font-semibold min-w-0 max-w-full"
      style={{ background: ink.bg, '--pi-light': ink.light, '--pi-dark': ink.dark }}>
      <Face f={f} className="w-5 h-5 text-[9px]" />
      <span className="truncate">{presenceLabel(editors)}</span>
    </span>
  );
}

// ── 보기 화면: 그 사람이 있는 줄 ─────────────────────────────────────────────
// box — 본문을 그린 통 요소(RichText lineAttrs · 줄마다 `data-line` · **ref 객체가 아니라 요소**다 — 이 부품이 그 통의 자식이라
// 첫 레이아웃 효과 때는 부모의 ref가 아직 안 붙어 있어 한 번도 못 쟀다). 수정 중인 사람의 `line`에 해당하는 줄을 찾아
// ① 그 줄에 그 사람 색 옅은 물(8%)을 깔고 ② 줄 오른쪽 끝에 18px 얼굴 + 그 사람 색 1.5px 고리를 세운다.
// **얼굴 자리는 통 안에 있다** — 통이 오른쪽에 28px(pr-7)을 비워 두고 얼굴은 그 안에 선다(목업에서 얼굴이 통 밖으로
// 나가 잘렸다 · tests/modalclose가 375·1280에서 얼굴 오른쪽 끝 ≤ 통 오른쪽 끝을 잰다). 같은 줄에 둘이면 왼쪽으로 겹쳐 선다.
// 줄이 다시 흐르면(폭 · 그림이 늦게 뜬다) ResizeObserver가 다시 잰다.
export const MARK_FACE = 18;
export function PresenceMarks({ box, editors, content }) {
  const [marks, setMarks] = useState([]);
  const sig = (editors || []).filter(e => e.line != null).map(e => `${e.key}:${e.line}:${e.color}:${e.avatar}`).join(',');
  const listRef = useRef(editors);
  listRef.current = editors;
  useLayoutEffect(() => {
    if (!box || !sig) { setMarks([]); return undefined; }
    const measure = () => {
      const b = box.getBoundingClientRect();
      const perLine = new Map();
      const out = [];
      for (const e of listRef.current || []) {
        if (e.line == null) continue;
        const el = box.querySelector(`[data-line="${e.line}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
        const n = perLine.get(e.line) || 0;
        perLine.set(e.line, n + 1);
        out.push({ ...e, top: r.top - b.top, height: r.height, first: Math.min(lh, r.height || lh), stack: n });
      }
      setMarks(out);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [box, sig, content]);
  return marks.map(m => (
    <Fragment key={m.key}>
      {m.stack === 0 && (
        <span aria-hidden data-line-tint={m.line}
          className="absolute -left-2 right-0 rounded-[4px] pointer-events-none"
          style={{ top: m.top - 1, height: m.height + 2, background: `${m.color}14`, zIndex: -1 }} />
      )}
      <span data-line-mark={m.name} title={`${m.name} · 수정 중`}
        className="absolute rounded-full inline-flex pointer-events-none"
        style={{ top: m.top + Math.max(0, (m.first - MARK_FACE) / 2), right: 3 + m.stack * 13, zIndex: 1 + m.stack,
          boxShadow: `0 0 0 1.5px ${m.color}` }}>
        <Face f={m} className="w-[18px] h-[18px] text-[9px]" />
      </span>
    </Fragment>
  ));
}

// ── 버전 기록 탭 ────────────────────────────────────────────────────────────
// 탭을 처음 열 때 읽는다(card_doc_versions · 최신이 앞). 줄: 그 사람 색 점(첫 글자) · 이름 ·
// `오늘 오후 3:12 · 2줄 추가 · 1줄 제거`(0인 쪽은 뺀다 · 기준 판(0086)은 `처음 작성한 본문`).
// 줄을 누르면 본문 자리가 그 판의 **고친 곳**(바로 앞 판 → 이 판의 줄 차이 · view.versionDiff)으로 바뀐다.
// 실패는 빈 자리에 선다(§8 D2 — 토스트 없이 제목 · 까닭 · 다시 시도).
// load — 개발 빌드의 가짜 판 목록(useDevFake)만 넘긴다. 줄의 얼굴은 사진(Avatar) · 폰 32px · 넓은 폭 24px.
export function VersionPanel({ cardId, pickedId, onPick, refreshKey = 0, load = null }) {
  const [st, setSt] = useState({ loading: true, rows: null, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt(s => ({ ...s, loading: true }));
    (load ? load() : loadEngine().then(m => m.loadVersions(cardId)))
      .then(rows => { if (alive) setSt({ loading: false, rows: rows || [], error: null }); })
      .catch(e => { console.error('[coedit] 버전 기록 읽기 실패:', e); if (alive) setSt({ loading: false, rows: null, error: e }); });
    return () => { alive = false; };
  }, [cardId, refreshKey, retry, load]);

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
        // 그 판 사이에 같이 고친 사람(0087 editors) — 세션을 끝낸 사람 한 명만 세우면 남이 친 글까지 그 사람 것으로 읽혔다
        const others = (v.editors || []).filter(id => id && id !== v.by);
        const lead = profileName(v.by) || '이름 미상';
        const name = others.length ? `${lead} 외 ${others.length}명` : lead;
        const label = versionLabel(v);
        const on = v.id === pickedId;
        return (
          <button key={v.id} type="button" data-version-row={v.id} aria-pressed={on}
            onClick={() => onPick?.({ version: v, name, time: versionTime(v.at, now), rows: versionDiff(list, i) })}
            className={`w-full flex items-center gap-2.5 md:gap-2 px-1.5 py-2 rounded-md text-left transition-colors ${on ? 'bg-accent-weak' : 'hover:bg-surface-hover'}`}>
            <span className={`relative shrink-0 flex ${others[0] ? "mr-1.5" : ""}`} title={[lead, ...others.map(id => profileName(id) || '이름 미상')].join(', ')}>
              <Avatar name={lead} title="" fallbackClass="text-white"
                className="flex w-8 h-8 md:w-6 md:h-6 text-[12px] md:text-[10px]" style={{ background: userColor(v.by || lead) }} />
              {others[0] && (
                <Avatar name={profileName(others[0]) || '?'} title="" fallbackClass="text-white"
                  className="flex absolute -right-1.5 -bottom-1 w-[18px] h-[18px] md:w-4 md:h-4 text-[9px] md:text-[8px] ring-2 ring-surface"
                  style={{ background: userColor(others[0]) }} />
              )}
            </span>
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
// **줄마다 본문과 같은 그리기**(RichText 한 줄 — 굵게·형광펜·링크·체크리스트·제목이 본문 모양 그대로 · 2026-09-29 사용자 요청:
// 마크다운 원문이 보이면 무엇이 바뀌었는지 못 읽는다). 더한 줄은 초록 물 + `+`, 뺀 줄은 빨강 물 + 흐리게 + 취소선 + `−`
// (태그 초록·빨강 토큰 — 두 테마를 따라간다). 글자는 같고 서식만 바뀐 줄도 뺀 줄 → 더한 줄 한 쌍이다(view.lineDiff 차례).
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
      {/* text-sm — 보기 화면 본문과 같은 기준 크기(RichText는 크기를 강제하지 않는다) */}
      <div className="py-2 text-sm min-h-40 md:min-h-56">
        {pick.rows.map((r, i) => (
          <div key={i} data-diff={r.op}
            className={`flex gap-2 px-3 pt-1 ${r.op === 'add' ? 'bg-tag-green' : r.op === 'del' ? 'bg-tag-red' : ''}`}>
            <span aria-hidden className={`w-3 shrink-0 text-center select-none font-semibold leading-relaxed ${r.op === 'add' ? 'text-tag-green-fg' : 'text-tag-red-fg'}`}>
              {r.op === 'add' ? '+' : r.op === 'del' ? '−' : ''}
            </span>
            <div data-diff-line="" className={`min-w-0 flex-1 break-words [&>:first-child]:mt-0 ${r.op === 'del' ? 'line-through opacity-60' : ''}`}>
              {/* 빈 줄은 빈 문단 한 줄(RichText의 gap)이다 — 빈 글이면 아무것도 안 그려 줄이 사라진다 */}
              <RichText content={r.text || ' '} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
