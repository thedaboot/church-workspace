import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bold, ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { useCached } from '../services/cache.js';
import { loadWiki, saveWikiEdits, seenMap, markSeen } from '../services/wiki.js';
import {
  WIKI_GROUPS, EDITABLE_TYPES, ADDABLE_TYPES, overlayEdits, overlayTitles, editStats, editRows, sourceLabel, mdLabel, kstDate,
  FAQ_SOURCE, FAQ_ID, TITLE_KEY, headKey, visiblePages, boldParts, toggleBold, withTeamCards, leadBold,
} from '../services/wikiCore.js';
import {
  outlineOf, pageKind, teamMembers, teamWork, pageTasks, prepInfo, teamInfo, relatedPages, linkTargets, linkParts, splitRef, bookColors,
} from '../services/wikiLive.js';
import { useAuth } from '../services/auth.jsx';
import { entryParam, takeEntryParam, useEntryQuery } from '../services/entryQuery.js';
import { loadBibleIndex } from '../services/bible.js';
import { fullRef } from '../services/bibleRef.js';
import { AskPanel, AskEntry, CiteChip, chipsFrom, useDabootiChat } from '../components/dabooti.jsx';
import { cutSet } from '../components/dabooti.jsx';
import { CONFIG } from '../config.js';
import { BTN } from '../components/buttons.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { store, useStore } from '../store/workspaceStore.js';
import { isCloudEnabled } from '../services/supabaseClient.js';
import { showToast } from '../components/Toast.jsx';
import { errorReason } from '../services/errorText.js';
import { FailTail } from '../components/groupsParts.jsx';

const FilePreviewModal = lazy(() => import('../components/FilePreviewModal.jsx').then(m => ({ default: m.FilePreviewModal })));

// ============================================================================
// 더다붓 위키 + 다붓이에게 물어보기 (0088 · 16차 · 목업 LKarXC8WVahATdEuyivvRp v12 · 17차 나무위키식 장 목업 승인 2026-10-04)
// ----------------------------------------------------------------------------
// 데스크톱: 왼쪽 장 목록(맨 위 '다붓이에게 물어보기' 칸 · 묶음 일곱) | 가운데 물어보기 또는 장.
// 폰: 위키 첫 화면(물어보기 칸 + 장 목록) → 물어보기 / 장(‹ 위키 · ✎ 수정).
// 장은 서버가 매일 아침 모은 블록이고(api/_wikiBuild.js), 사람이 고친 문장은 wiki_edits를 겹쳐 그린다 —
// 고친 줄은 다음 날 다시 모아도 덮이지 않는다(글에 표시는 없다 · 마스터에게 장 머리 '수정한 곳 N'만).
// 고치기는 마스터만(0090): ✎ 수정 → 줄마다 글 칸(B = **굵게**) → 저장(바뀐 줄만 upsert) · 함께 쓰는 글의 목록은 줄을 더할 수 있다.
// 자주 묻는 질문 장은 마스터만 본다(목록·다붓이 링크에서 뺀다 — wikiCore.visiblePages).
// 근거 칩: 업무 → 업무 창 · 주보 → 그 주보 · 파일 → 미리보기(비밀번호 파일은 업무 창으로) · 장 → 그 장.
// 장 모양(17차): 갈래 › 장 · 제목 · 목차 · 번호 붙은 마디(services/wikiLive.outlineOf) · 정보 상자(팀·행사) ·
//   '지금' 마디(구성원 · 지금 하는 일 · 준비 — 화면을 열 때 스토어의 가입자·업무로 센다 · 머리 오른쪽 '현재 … 기준') ·
//   글 안의 장 제목·자주 쓰는 말은 그 장으로(마디마다 처음 한 번) · QT는 달력(폰은 주마다 줄).
// ============================================================================

const UNIT = { 업무: '업무', 주보: '주보', 말씀: '본문', 모임: '모임', '물어본 글': '질문', [FAQ_SOURCE]: '질문' };

// main(스크롤 통)의 **안쪽 높이**를 --wiki-h로 — 물어보기 첫 화면을 그 가운데에, 대화 입력 칸을 그 바닥에 세운다.
// 상수로 셈하면 폰의 상단 바·하단 바·safe-area가 기기마다 달라 가운데가 위로 쏠렸다(사용자 지적 2026-10-03).
function useMainHeight(ref) {
  useLayoutEffect(() => {
    const main = document.querySelector('main');
    const el = ref.current;
    if (!main || !el) return undefined;
    const set = () => {
      const cs = getComputedStyle(main);
      // 데스크톱 프로젝트 탭 줄이 접히는 동안(0.3초) main이 프레임마다 커진다 — 그 줄 높이를 더해 '접힌 뒤 높이'를 처음부터 쓴다.
      // 안 그러면 프레임마다 판을 다시 그려 접히는 모션이 버벅였다(사용자 지적 2026-10-03). 위키에서는 그 줄이 늘 접힌다.
      const row = document.querySelector('[data-project-row]');
      const extra = row ? row.getBoundingClientRect().height : 0;
      el.style.setProperty('--wiki-h', `${Math.round(main.clientHeight + extra - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(main);
    // 위키에 있는 동안 스크롤바 자리를 늘 남긴다 — 긴 장(스크롤바 생김)과 짧은 장(없음)을 오갈 때 판 전체가 8px씩
    // 좌우로 움직였다(사용자 지적 2026-10-03 '내용에 따라 너비가 살짝'). 다른 화면은 건드리지 않게 떠날 때 되돌린다.
    const prevGutter = main.style.scrollbarGutter;
    main.style.scrollbarGutter = 'stable';
    return () => { ro.disconnect(); main.style.scrollbarGutter = prevGutter; };
  }, [ref]);
}
const STATUS_TAG = new Set(['진행 중', '시작 전', '보류 중', '상시']);

// '지금' 마디의 재료 — 스토어가 이미 들고 있는 가입자·업무·프로젝트(새로 묻지 않는다).
// 게스트(클라우드 없음)는 검사(tests/wiki)가 장 묶음에 실어 준 live를 쓴다.
const EMPTY = { byId: {}, allIds: [] };
function useWikiLive() {
  const tasks = useStore(s => s.tasks) || EMPTY;
  const projects = useStore(s => s.projects) || EMPTY;
  const members = useStore(s => s.members);
  const fx = !isCloudEnabled() && typeof window !== 'undefined' ? window.__wikiFixture?.live : null;
  return useMemo(() => (fx
    ? { tasks: fx.tasks || [], projects: fx.projects || [], members: fx.members || [] }
    : { tasks: (tasks.allIds || []).map(id => tasks.byId[id]).filter(Boolean), projects: (projects.allIds || []).map(id => projects.byId[id]).filter(Boolean), members: members || [] }),
  [fx, tasks, projects, members]);
}

export default function WikiView({ onTaskClick, onOpenLink }) {
  const isMobile = useIsMobile();
  const { data, loading, error, refresh } = useCached('wiki:all', loadWiki);
  const [sel, setSel] = useState(() => (isMobile ? null : 'ask'));   // null(폰 첫 화면) · 'ask' · 장 id
  // 대화는 앱이 떠 있는 동안 남긴다 — 탭을 오가도 그대로, 다시 열거나 30분 넘게 가려졌다 돌아오면 새로(사용자 결정 2026-10-04)
  const [chat, setChat] = useDabootiChat();
  const [preview, setPreview] = useState(null);
  const [seen, setSeen] = useState(seenMap);
  const [dir, setDir] = useState('fwd');   // 폰 장 넘김 방향 — 들어가면 오른쪽에서, 돌아오면 왼쪽에서
  // 게스트는 늘 마스터라 검사(tests/wiki)는 장 묶음의 member로 마스터 아닌 사람을 흉내 낸다(services/wiki.loadWiki)
  const isMaster = useAuth().isMaster && !data?.member;
  const rootRef = useRef(null);
  useMainHeight(rootRef);
  const live = useWikiLive();

  const pages = useMemo(() => {
    if (!data) return [];
    const by = new Map();
    for (const e of data.edits || []) { if (!by.has(e.page_id)) by.set(e.page_id, []); by.get(e.page_id).push(e); }
    // 팀 장 맨 위 소개 줄은 더다붓 소개 › 팀 카드의 지금 글(wikiCore.withTeamCards · 사용자 결정 2026-10-04)
    return withTeamCards(visiblePages(data.pages || [], isMaster).map(p => { const pe = by.get(p.id) || []; const o = overlayTitles(p, pe); return { ...o, blocks: overlayEdits(o.blocks, pe), edits: pe }; }))
      .sort((a, b) => WIKI_GROUPS.indexOf(a.grp) - WIKI_GROUPS.indexOf(b.grp) || a.position - b.position || a.title.localeCompare(b.title));
  }, [data, isMaster]);
  const page = pages.find(p => p.id === sel) || null;
  const chips = useMemo(() => chipsFrom(pages), [pages]);

  useEffect(() => {
    if (!page) return;
    markSeen(page.id, page.built_at || page.updated_at);
    setSeen(seenMap());
  }, [page?.id, page?.built_at]);  // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id) => { if (id === FAQ_ID && !isMaster) return; setDir(id === null ? 'back' : 'fwd'); setSel(id); document.querySelector('main')?.scrollTo?.({ top: 0 }); };
  // 딥링크 `/?p=wiki&wiki=<장 id>` — 8시 크론의 마스터 알림('다붓이가 모르는 질문 N개' → 자주 묻는 질문)이 연다(services/entryQuery)
  const entry = useEntryQuery();
  useEffect(() => {
    if (!pages.length || !entryParam('wiki')) return;
    const id = takeEntryParam('wiki');
    if (pages.some(p => p.id === id)) go(id);
  }, [entry, pages.length]);  // eslint-disable-line react-hooks/exhaustive-deps
  const openCite = (c) => {
    if (!c) return;
    if (c.t === 'page') { go(c.id); return; }
    if (c.t === 'card') {
      const task = store.getState().tasks.byId[c.id];
      if (task) onTaskClick?.(task); else showToast('업무를 찾지 못했어요\n지워졌거나 볼 수 없는 업무예요');
      return;
    }
    if (c.t === 'service') { onOpenLink?.(`/?p=worship&s=${c.id}`); return; }
    if (c.t === 'file') openCite({ t: c.cardId ? 'card' : 'service', id: c.cardId || c.serviceId });
  };
  // QT 본문 일정의 날 → 말씀 탭 QT의 그 날(딥링크 값 qt · services/entryQuery · WordView가 마운트되며 읽는다)
  const openQt = (date) => onOpenLink?.(`/?p=word&qt=${date}`);
  const openFile = (f) => {
    // 비밀번호 파일은 업무 창에서 연다(비밀번호를 묻는 자리가 거기다)
    if (f.pw && f.card_id) { openCite({ t: 'card', id: f.card_id }); return; }
    setPreview(f);
  };

  const groups = WIKI_GROUPS.map(g => ({ g, list: pages.filter(p => p.grp === g) })).filter(x => x.list.length);
  const fresh = (p) => seen[p.id] && p.built_at && String(p.built_at) > String(seen[p.id]);

  const list = (
    <nav className="wiki-list grid gap-3.5" aria-label="위키 장 목록">
      {groups.map(({ g, list: ps }) => (
        <div key={g}>
          <p className="ml-1.5 mb-1 text-[10.5px] font-bold text-fg-muted tracking-[.03em]">{g}</p>
          {ps.map(p => (
            <button key={p.id} type="button" onClick={() => go(p.id)} aria-current={sel === p.id ? 'page' : undefined}
              className={`wiki-item w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors ${sel === p.id ? 'bg-accent-weak text-accent-text font-semibold' : 'text-fg hover:bg-surface-hover'}`}>
              <span className="min-w-0 flex items-center gap-1.5">
                {fresh(p) && <span className="w-[5px] h-[5px] rounded-full bg-accent/60 shrink-0" title="다시 모았어요" />}
                <span className="truncate">{p.title}</span>
              </span>
              {p.kind === 'auto' && p.source_count > 0 && <small className="text-[10.5px] text-fg-muted tabular-nums">{p.source_count}</small>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );

  const failed = !data && error;
  const body = failed ? (
    <div className="load-failed py-10 text-center" role="alert">
      <p className="load-fail-title text-[13.5px] font-semibold text-fg">위키를 불러오지 못했어요</p>
      <FailTail reason={errorReason(error)} onRetry={refresh} />
    </div>
  ) : loading && !data ? (
    <div className="grid gap-3 py-6" aria-busy="true">
      {[70, 92, 84, 60].map((w, i) => <div key={i} className="dc-skeleton dc-skel-line h-3.5 rounded" style={{ width: `${w}%` }} />)}
    </div>
  ) : null;

  // 폰은 ‹ 위키 줄(약 40px)만큼 뺀다
  const ask = <AskPanel chat={chat} setChat={setChat} chips={chips} onOpenCite={openCite} onOpenFile={openFile} onOpenFaq={isMaster ? () => go(FAQ_ID) : null}
    fill={isMobile ? 'calc(var(--wiki-h, 70vh) - 40px)' : 'var(--wiki-h, 70vh)'} />;
  const modal = preview && (
    <Suspense fallback={null}>
      <FilePreviewModal row={preview} rows={[preview]} initialSrc={null} onClose={() => setPreview(null)} />
    </Suspense>
  );
  const pageProps = { pages, live, isMaster, onOpenCite: openCite, onOpenQt: openQt, onGo: go, onSaved: refresh };

  // ── 폰 ────────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div ref={rootRef} className="wiki wiki-mobile overflow-x-clip -mx-2 px-2">
        {/* 넘김 애니메이션 때문에 가로를 자르는데, 고치기 칸(.wiki-draft)은 글 밖으로 6px 나와서 왼쪽 테두리가 잘렸다(사용자 지적 2026-10-04) — 자르는 선만 8px 밖으로.
            hidden이 아니라 clip — hidden은 세로도 auto가 되어 이 판이 스크롤 통이 되고, 물어보기 칸의 sticky가 main 대신 여기에 붙어
            대화가 길 때 키보드를 열면 칸이 화면 밖으로 잘렸다(사용자 지적 2026-10-05 · PITFALLS 33-u) */}
        {sel === null && (
          <div key="index" className={`${dir === 'back' ? 'wiki-in-back' : 'dc-screen'} grid gap-4 pt-1`}>
            <AskEntry onClick={() => go('ask')} className="py-1.5" />
            {body || list}
          </div>
        )}
        {sel !== null && (
          <div key={sel} className="wiki-in-fwd">
            <div className="flex items-center justify-between gap-2 -mx-1 mb-1">
              <button type="button" onClick={() => go(null)} className="inline-flex items-center gap-0.5 px-1 py-1.5 text-[13px] font-semibold text-accent-text transition active:scale-95">
                <ChevronLeft size={16} /> 위키
              </button>
            </div>
            <div className={sel === 'ask' ? '' : 'hidden'}>{ask}</div>
            {sel !== 'ask' && (body || (page ? <WikiPage key={page.id} page={page} mobile {...pageProps} /> : null))}
          </div>
        )}
        {modal}
      </div>
    );
  }

  // ── 데스크톱 ──────────────────────────────────────────────────────────────
  return (
    // 흰 판(테두리 카드)을 두지 않는다 — 앱 바탕 위에 목록과 글이 바로 선다(사용자 지적 2026-10-03 · 앱에 속한 느낌)
    <div ref={rootRef} className="wiki wiki-desk dc-screen grid grid-cols-[236px_minmax(0,1fr)] max-w-[1320px] mx-auto">
      <aside className="wiki-side sticky top-0 self-start overflow-y-auto border-r border-line/70 pr-3 py-1 grid content-start gap-3.5" style={{ height: 'var(--wiki-h, 80vh)' }}>
        <AskEntry active={sel === 'ask'} onClick={() => go('ask')} />
        {body ? null : list}
      </aside>
      <section className="min-w-0 pl-8 pr-2">
        <div className={sel === 'ask' ? '' : 'hidden'}>{ask}</div>
        {sel !== 'ask' && (body || (page ? <div key={page.id} className="dc-fade py-1"><WikiPage page={page} {...pageProps} /></div> : null))}
      </section>
      {modal}
    </div>
  );
}

// ── 장 하나 ──────────────────────────────────────────────────────────────────
// 고치는 글 칸이 마지막으로 잡은 자리 — B(굵게)가 그 칸의 고른 글을 감싼다(폰에서 B를 누르면 칸의 초점이 풀려도 고른 자리는 남는다)
const DraftCtx = createContext(null);
// 글 안의 링크 — 장 제목 · 자주 쓰는 말 → 그 장(마디마다 처음 한 번 · used는 마디가 그릴 때마다 새로 만든다)
const LinkCtx = createContext(null);

const todayKst = () => kstDate(new Date().toISOString());

function WikiPage({ page, pages = [], live = {}, mobile = false, isMaster = false, onOpenCite, onOpenQt, onGo, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [added, setAdded] = useState([]);   // [{ key, block_key, text }]
  const [saving, setSaving] = useState(false);
  const stats = editStats(page.blocks);
  const human = page.kind === 'human';
  const lastDraft = useRef(null);   // { el, start, end, onChange }
  const kind = pageKind(page);
  const related = useMemo(() => (kind === 'other' ? [] : relatedPages(page, pages)), [kind, page, pages]);
  const outline = useMemo(() => outlineOf(page, { related: related.length > 0 }), [page, related.length]);
  const targets = useMemo(() => linkTargets(pages, page.id), [pages, page.id]);
  const today = todayKst();

  // 정보 상자 — 팀: 적힌 글 + 명단 · 행사: 장을 만들 때 기록에서 뽑은 줄 + 지금의 준비 업무
  const prep = useMemo(() => (kind === 'event' ? pageTasks(page, live.tasks) : []), [kind, page, live.tasks]);
  const team = kind === 'team' ? page.id.slice(5) : '';
  const tinfo = useMemo(() => (kind === 'team' ? teamInfo(page, pages, live.members) : null), [kind, page, pages, live.members]);
  const infoRows = kind === 'team' ? tinfo.rows
    : kind === 'event' ? [...((page.blocks.find(b => b.type === 'info') || {}).rows || []), ...[prepInfo(prep, page.blocks.find(b => b.key === 'lead')?.meta?.recurring ? '업무' : '준비 업무')].filter(Boolean)] : [];
  const subtitle = tinfo?.name || '';

  const start = () => { lastDraft.current = null; setDrafts({}); setAdded([]); setEditing(true); };
  const bold = () => {
    const d = lastDraft.current;
    if (!d || !d.el.isConnected) return;
    // 칸에 초점이 남아 있으면(데스크톱) 지금 고른 자리를, 아니면(폰 — B를 누르며 초점이 풀렸다) 마지막으로 쥔 자리를
    const liveSel = document.activeElement === d.el;
    const r = toggleBold(d.el.value, liveSel ? d.el.selectionStart : d.start, liveSel ? d.el.selectionEnd : d.end);
    d.onChange(r.value);
    d.start = r.start; d.end = r.end;
    requestAnimationFrame(() => { try { d.el.focus(); d.el.setSelectionRange(r.start, r.end); } catch { /* 칸이 사라짐 */ } });
  };
  const cancel = () => { setEditing(false); setDrafts({}); setAdded([]); };
  const save = async () => {
    // 제목·소제목(마스터만 · 0089) — 열쇠 `#title`·`#h:<블록>` · before는 처음 제목
    const titleRows = [];
    if (TITLE_KEY in drafts && drafts[TITLE_KEY].trim() && drafts[TITLE_KEY].trim() !== page.title) titleRows.push({ page_id: page.id, item_key: TITLE_KEY, block_key: null, text: drafts[TITLE_KEY].trim(), before: page.originalTitle || page.title });
    for (const b of page.blocks) {
      const k = headKey(b.key);
      if (k in drafts && drafts[k].trim() && drafts[k].trim() !== (b.title || '')) titleRows.push({ page_id: page.id, item_key: k, block_key: b.key, text: drafts[k].trim(), before: b.originalTitle ?? b.title ?? '' });
    }
    const rows = [
      ...titleRows,
      ...editRows(page.id, page.blocks, drafts),
      ...added.filter(a => a.text.trim()).map(a => ({ page_id: page.id, item_key: a.key, block_key: a.block_key, text: a.text.trim(), before: '' })),
    ];
    if (!rows.length) { cancel(); return; }
    setSaving(true);
    try {
      await saveWikiEdits(rows);
      setEditing(false); setDrafts({}); setAdded([]);
      onSaved?.();
    } catch (e) {
      showToast(`저장하지 못했어요\n${errorReason(e)}`);
    } finally { setSaving(false); }
  };

  // 고치기는 마스터만(0090) — 마스터가 아니면 ✎ 수정을 세우지 않는다
  const editBar = !isMaster ? null : editing ? (
    <span className="flex items-center gap-1.5 shrink-0">
      {/* 누르는 순간 칸의 초점을 뺏지 않는다(데스크톱) — 폰은 lastDraft가 고른 자리를 쥐고 있다 */}
      <button type="button" onPointerDown={e => e.preventDefault()} onClick={bold} aria-label="굵게" title="굵게"
        className="wiki-bold w-8 h-[30px] inline-flex items-center justify-center rounded-md text-fg-muted bg-surface-hover transition active:scale-95"><Bold size={14} strokeWidth={2.6} /></button>
      <button type="button" onClick={cancel} className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold text-fg-muted bg-surface-hover transition active:scale-95">취소</button>
      <button type="button" onClick={save} disabled={saving} className={BTN}>저장</button>
    </span>
  ) : (
    <button type="button" onClick={start} className="wiki-edit shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-lg bg-accent-weak text-accent-text text-[12.5px] font-bold transition active:scale-95">
      <Pencil size={12} /> 수정
    </button>
  );

  const ctx = { page, pages, live, today, mobile, editing, isMaster, drafts, setDrafts, added, setAdded, onOpenCite, onOpenQt, onGo, prep, team, related };
  const single = outline.sections.length < 2;
  const toc = !single && (
    <nav className="wiki-toc self-start justify-self-start min-w-[240px] max-w-full rounded-[10px] border border-line bg-surface px-[18px] py-3.5 grid gap-1.5 text-[13px]" aria-label="목차">
      <b className="text-[13px] font-extrabold text-fg mb-0.5">목차</b>
      {outline.toc.map(t => (
        <button key={t.id} type="button" onClick={() => document.getElementById(`${page.id}:${t.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          className={`wiki-toc-item text-left leading-snug hover:underline underline-offset-2 ${t.sub ? 'pl-3.5' : ''}`}>
          <span className="font-bold text-accent-text">{t.no}</span> <span className="text-fg">{t.title}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <article className="wiki-page dc-fade min-w-0" data-page={page.id}>
      <p className="wiki-crumb text-[12px] text-fg-muted">{editing ? `${page.title} · 수정 중` : `${page.grp} › ${page.title}`}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 grid gap-1.5">
          <h1 className={`m-0 font-extrabold tracking-[-0.5px] text-fg leading-tight ${mobile ? 'text-[26px]' : 'text-[32px]'}`}>
            {editing && isMaster
              ? <TitleDraft value={TITLE_KEY in drafts ? drafts[TITLE_KEY] : page.title} onChange={v => setDrafts(d => ({ ...d, [TITLE_KEY]: v }))} label="장 제목" />
              : <>{page.title}{subtitle && <span className="wiki-subtitle ml-2 text-[15px] font-medium text-fg-muted tracking-normal">{subtitle}</span>}</>}
          </h1>
          {/* 누가 고쳤는지('함께 작성' · 'OOO · 날짜 수정')는 걷었다(사용자 결정 2026-10-04) — 출처·기록 수·모은 날만.
              '수정한 곳 N'은 마스터에게만(고치는 사람이 마스터뿐이라 그쪽에만 쓸모가 있다) */}
          {!human && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-fg-muted">
              <Tag>{sourceLabel(page.source)}</Tag>
              {page.source_count > 0 && <span>{UNIT[page.source] || '기록'} {page.source_count}{page.source === '업무' || page.source === '주보' ? '건' : '개'}</span>}
              {page.built_at && <span>{mdLabel(kstDate(page.built_at))}</span>}
              {isMaster && stats.n > 0 && <Tag green>수정한 곳 {stats.n}</Tag>}
            </div>
          )}
        </div>
        {editBar}
      </div>

      <DraftCtx.Provider value={lastDraft}>
        <div className={`wiki-body ${infoRows.length ? 'has-info' : ''} ${mobile ? 'is-phone' : ''} mt-5`}>
          {infoRows.length > 0 && <InfoBox title={page.title} name={subtitle} rows={infoRows} tone={kind === 'team' ? (CONFIG.TEAM_TOKENS[team] || 'gray') : 'yellow'} />}
          <div className="wiki-main min-w-0 grid gap-[26px] content-start">
            {toc}
            {outline.sections.map(s => (
              <Section key={s.id} s={s} ctx={ctx} heading={!single} targets={targets} />
            ))}
          </div>
        </div>
      </DraftCtx.Provider>
    </article>
  );
}

function Tag({ children, green = false }) {
  return (
    <span className={`text-[11px] font-bold px-2 py-[2px] rounded-full ${green ? 'bg-tag-green text-tag-green-fg' : 'bg-surface-hover text-fg-muted'}`}>{children}</span>
  );
}

// 정보 상자 — 데스크톱은 오른쪽 칸, 폰·좁은 화면은 맨 위 한 줄 너비(index.css .wiki-body)
function InfoBox({ title, name, rows, tone }) {
  return (
    <aside className="wiki-info rounded-xl border border-line bg-surface overflow-hidden self-start" aria-label={`${title} 정보`}>
      <div className="px-4 py-3 text-center text-[15px] font-extrabold" style={{ background: `var(--app-tag-${tone})`, color: `var(--app-tag-${tone}-fg)` }}>{title}{name ? ` · ${name}` : ''}</div>
      {rows.map(r => (
        <div key={r.k} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 px-3.5 py-[9px] border-t border-line text-[13px] leading-normal">
          <span className="font-bold text-fg-muted">{r.k}</span><span className="min-w-0 text-fg">{r.v}</span>
        </div>
      ))}
    </aside>
  );
}

// 큰 마디 — 'N.' 번호(강조색) · 굵게 · 아래 가는 선 · 지금 마디는 오른쪽에 '현재 … 기준'
function Section({ s, ctx, heading = true, targets = [] }) {
  // 글 안의 링크 — 이 마디의 줄을 차례로 보며 낱말마다 처음 한 번만(wikiLive.linkParts)
  const go = ctx.onGo;
  const link = useMemo(() => {
    const used = new Set();
    const map = new Map();
    const blocks = [...s.blocks, ...s.subs.map(x => x.block).filter(Boolean)];
    for (const b of blocks) for (const it of b.items || []) {
      const shown = PROSE_TYPES.has(b.type) ? leadBold(it.text) : it.text;   // 줄글은 앞말 굵게(읽기에서만 · 글은 그대로)
      map.set(it.key, { text: it.text, parts: boldParts(shown).map(p => ({ b: p.b, parts: linkParts(p.t, targets, used) })) });
    }
    return { map, go };
  }, [s, targets, go]);
  return <LinkCtx.Provider value={link}><SectionBody s={s} ctx={ctx} heading={heading} /></LinkCtx.Provider>;
}
function SectionBody({ s, ctx, heading }) {
  const qt = s.blocks.find(b => b.type === 'qt');
  const right = s.label || (qt ? <QtLegend days={qt.days || []} /> : null);
  // 마디 제목이 블록 제목이면 그 블록 소제목을 고치는 자리(마스터 · 0089) — 묶음 이름('개요'·'하는 일')은 고치지 않는다
  const titleBlock = s.blocks.find(b => b.type !== 'hero' && b.title && b.title === s.title) || null;
  const hk = titleBlock ? headKey(titleBlock.key) : null;
  const title = ctx.editing && ctx.isMaster && titleBlock && titleBlock.type !== 'hero'
    ? <TitleDraft value={hk in ctx.drafts ? ctx.drafts[hk] : titleBlock.title} onChange={v => ctx.setDrafts(d => ({ ...d, [hk]: v }))} label="소제목" />
    : s.title;
  return (
    <section className="wiki-sec grid gap-3 min-w-0" id={`${ctx.page.id}:${s.id}`} data-sec={s.no}>
      {heading && s.title && (
        <h2 className="wiki-h2 m-0 flex items-baseline justify-between gap-2 pb-2 border-b border-line text-[20px] font-extrabold tracking-[-0.3px] text-fg">
          <span className="min-w-0 flex items-baseline gap-1.5"><span className="wiki-no text-accent-text">{s.no}</span><span className="min-w-0 flex-1">{title}</span></span>
          {right && <span className="wiki-live-label shrink-0 text-[11px] font-bold text-fg-muted">{right}</span>}
        </h2>
      )}
      {s.live === 'members' && <LiveMembers ctx={ctx} />}
      {s.live === 'work' && <LiveWork ctx={ctx} sub={s.subs[0]} />}
      {s.live === 'prep' && <LivePrep ctx={ctx} />}
      {s.live === 'related' && <Related ctx={ctx} />}
      {s.blocks.filter(b => b.type !== 'gap').map((b, i) => <Block key={b.key} b={b} i={i} ctx={ctx} noTitle={heading} />)}
      {s.live !== 'work' && s.subs.map((x, i) => (
        <div key={x.block?.key || x.title} className="wiki-sub grid gap-2 min-w-0" id={`${ctx.page.id}:${x.id}`}>
          {x.block ? <Block b={x.block} i={i} ctx={ctx} no={heading ? x.no : ''} /> : null}
        </div>
      ))}
      {s.blocks.filter(b => b.type === 'gap').map((b, i) => <Block key={b.key} b={b} i={i} ctx={ctx} />)}
    </section>
  );
}

// 작은 마디 머리 — 'N.M.' 번호 · 업무 이름 · 업무 날짜·보는 사람·상태
function SubHead({ no, title, meta = null }) {
  return (
    <h3 className="wiki-h3 m-0 mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[16px] font-bold tracking-[-0.2px] text-fg">
      <span className="min-w-0 flex-1 flex items-baseline gap-1.5">{no && <span className="wiki-no text-accent-text shrink-0">{no}</span>}<span className="min-w-0">{title}</span></span>
      {meta}
    </h3>
  );
}

// ── 지금 마디 ────────────────────────────────────────────────────────────────
function LiveMembers({ ctx }) {
  const rows = useMemo(() => teamMembers(ctx.team, ctx.live.members), [ctx.team, ctx.live.members]);
  return (
    <>
      <p className="wiki-count m-0 text-[13px] text-fg-muted">워크스페이스 가입자 {rows.length}명이에요.</p>
      {rows.length > 0 && (
        <ul className={`wiki-members m-0 p-0 list-none grid gap-2 ${ctx.mobile ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'}`}>
          {rows.map(m => (
            <li key={m.id} className="min-w-0 min-h-[44px] rounded-[10px] border border-line bg-surface px-3 py-2.5 grid gap-0.5">
              <b className="text-[14px] font-bold text-fg truncate">{m.name}</b>
              <span className={`text-[12px] leading-snug ${m.role ? 'text-fg-muted' : 'text-fg-faint'}`}>{m.role || '맡은 일 기록 전'}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function LiveWork({ ctx, sub }) {
  const w = useMemo(() => teamWork(ctx.team, ctx.live.tasks, ctx.live.projects, ctx.today), [ctx.team, ctx.live.tasks, ctx.live.projects, ctx.today]);
  const open = (id) => ctx.onOpenCite?.({ t: 'card', id });
  const cols = 'grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_76px_64px]';
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className="wiki-pill px-3 py-1.5 rounded-lg border border-line bg-surface text-[13px] text-fg">진행 중 <b>{w.doing}건</b></span>
        <span className="wiki-pill px-3 py-1.5 rounded-lg border border-line bg-surface text-[13px] text-fg">마감 지남 · 보류 <b>{w.late}건</b></span>
      </div>
      <div className="wiki-sub grid gap-2 min-w-0" id={`${ctx.page.id}:${sub?.id}`}>
        <SubHead no={sub?.no} title={sub?.title || '최근에 끝낸 일'} />
        {w.done.length ? (
          <div className="wiki-done rounded-[10px] border border-line bg-surface overflow-hidden">
            {!ctx.mobile && <div className={`grid ${cols} gap-3 px-3.5 py-2 bg-surface-hover text-[11px] font-bold text-fg-muted`}><span>업무</span><span>함께한 팀</span><span>끝낸 날</span><span>하위 업무</span></div>}
            {w.done.map((d, k) => (
              <button key={d.id} type="button" onClick={() => open(d.id)}
                className={`w-full min-h-[44px] text-left grid ${ctx.mobile ? 'grid-cols-1 gap-0.5' : `${cols} gap-3 items-center`} px-3.5 py-2.5 text-[13px] transition-colors hover:bg-surface-hover ${k || !ctx.mobile ? 'border-t border-line' : ''} ${k === 0 && ctx.mobile ? 'border-t-0' : ''}`}>
                <span className="min-w-0 font-bold text-fg leading-normal">{d.title}</span>
                {ctx.mobile
                  ? <span className="text-[12px] leading-normal text-fg-muted">{[`${d.date} 끝남`, d.sub ? `하위 업무 ${d.sub}` : '', d.with.join(' · ')].filter(Boolean).join(' · ')}</span>
                  : <>
                    <span className="min-w-0 text-[12px] text-fg-muted">{d.with.join(' · ')}</span>
                    <span className="text-[12px] text-fg-muted tabular-nums">{d.date}</span>
                    <span className="text-[12px] font-bold text-tag-green-fg tabular-nums">{d.sub}</span>
                  </>}
              </button>
            ))}
          </div>
        ) : <p className="m-0 text-[13px] text-fg-muted">기록 전</p>}
      </div>
    </>
  );
}

function StatusPill({ status }) {
  if (!status) return null;
  return <span className="wiki-status shrink-0 text-[11px] font-bold px-[9px] py-[3px] rounded-full bg-surface-hover text-fg-muted">{status}</span>;
}

function LivePrep({ ctx }) {
  if (!ctx.prep.length) return null;
  return (
    <ul className="wiki-prep m-0 p-0 list-none rounded-[10px] border border-line bg-surface overflow-hidden">
      {ctx.prep.map((r, k) => (
        <li key={r.id} className={k ? 'border-t border-line' : ''}>
          <button type="button" onClick={() => ctx.onOpenCite?.({ t: 'card', id: r.id })} className="w-full min-h-[44px] text-left grid gap-1.5 px-4 py-3 transition-colors hover:bg-surface-hover">
            <span className="flex items-center justify-between gap-2.5"><span className="min-w-0 text-[15px] font-bold text-fg">{r.title}</span><StatusPill status={r.status} /></span>
            {r.meta && <span className="text-[12.5px] text-fg-muted">{r.meta}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Related({ ctx }) {
  return (
    <div className="wiki-related flex flex-wrap gap-x-4 gap-y-1.5 text-[14px]">
      {ctx.related.map(r => <button key={r.id} type="button" onClick={() => ctx.onGo?.(r.id)} className="min-h-[32px] text-accent-text hover:underline underline-offset-2">{r.title}</button>)}
    </div>
  );
}

// 읽기 글 — 줄바꿈 그대로 · `**굵게**`만 굵게(wikiCore.boldParts) · 장 제목·자주 쓰는 말은 그 장으로(마디마다 처음 한 번)
// 링크 자리는 마디가 한 번에 정한다(Section의 linkMap) — 그리면서 '이미 이은 낱말'을 바꾸면 StrictMode의 두 번 그리기에서 링크가 사라졌다
// 줄글 블록 — 점 목록 · 앞말 굵게가 서는 자리(정보 상자 · 시간표 · 팀 카드 · 칩은 아니다)
const PROSE_TYPES = new Set(['list', 'plain', 'section']);

function Rich({ text, itemKey = null, extra = null, lead = false }) {
  const link = useContext(LinkCtx);
  const got = itemKey != null && link?.map.get(itemKey);
  const parts = got && got.text === text ? got.parts : boldParts(lead ? leadBold(text) : text).map(p => ({ b: p.b, parts: [{ t: p.t }] }));
  const run = (xs, k) => xs.map((p, j) => (p.id
    ? <button key={`${k}.${j}`} type="button" onClick={() => link.go?.(p.id)} className="wiki-link inline text-accent-text hover:underline underline-offset-2">{p.t}</button>
    : <span key={`${k}.${j}`}>{p.t}</span>));
  return <span className="whitespace-pre-line">{extra}{parts.map((p, k) => (p.b ? <strong key={k} className="font-bold">{run(p.parts, k)}</strong> : run(p.parts, k)))}</span>;
}

function Cites({ cites, onOpen, className = 'ml-1.5' }) {
  if (!cites?.length) return null;
  return <span className={`inline-flex flex-wrap gap-1 ${className}`}>{cites.map(c => <CiteChip key={`${c.t}:${c.id}`} cite={c} onOpen={onOpen} />)}</span>;
}

// 고치는 글 칸 — 내용만큼 늘어난다
function Draft({ value, onChange, onRemove, placeholder }) {
  const ref = useRef(null);
  const last = useContext(DraftCtx);
  const mark = (e) => { if (last) last.current = { el: e.target, start: e.target.selectionStart, end: e.target.selectionEnd, onChange }; };
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return (
    // 보이는 글을 그 자리에서 고친다 — 같은 글꼴·줄 간격(index.css .wiki-draft) · 줄바꿈은 그대로 저장되고 읽기도 그대로 바꾼다
    <span className="flex items-start gap-2">
      <textarea ref={ref} value={value} onChange={e => { onChange(e.target.value); mark(e); }} onSelect={mark} onFocus={mark} rows={1} placeholder={placeholder}
        className="wiki-draft flex-1 min-w-0 placeholder:text-fg-faint" />
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="이 줄 지우기" title="이 줄 지우기"
          className="mt-px w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-fg-faint hover:text-fg-muted hover:bg-surface-hover transition active:scale-90"><X size={14} /></button>
      )}
    </span>
  );
}

// ── QT 본문 일정 — 승인 목업(2026-10-04): 데스크톱 7칸 달력 · 폰은 주마다 묶은 줄 ────────────────
// 칸: 날(주일은 강조색) · 책 점 + 책 이름(작게) · 장:절(굵게 · 한 줄) · 오늘은 강조 테두리 + '오늘' · 지난 날은 옅게.
// 날을 누르면 말씀 탭 QT의 그 날로(onOpen — WikiView.openQt). 책 이름은 전체로 푼다(저장값은 약자 그대로).
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function useBooks() {
  const [books, setBooks] = useState(null);
  useEffect(() => { let on = true; loadBibleIndex().then(b => { if (on) setBooks(b); }).catch(() => {}); return () => { on = false; }; }, []);
  return books;
}
const qtCells = (days, books) => days.map(d => ({ ...d, dow: new Date(`${d.date}T00:00:00`).getDay(), ...splitRef(books ? fullRef(d.ref, books) : d.ref) }));
function QtLegend({ days }) {
  const books = useBooks();
  const color = bookColors(qtCells(days, books).map(c => c.book));
  if (!color.size) return null;
  return (
    <span className="wiki-qt-legend inline-flex flex-wrap justify-end gap-x-3 gap-y-1 font-medium">
      {[...color].map(([b, tk]) => <span key={b} className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: `var(--app-tag-${tk}-fg)` }} />{b}</span>)}
    </span>
  );
}
function QtDays({ days, onOpen, mobile = false, today }) {
  const books = useBooks();
  const cells = qtCells(days, books);
  const color = bookColors(cells.map(c => c.book));
  const weeks = [];
  for (const d of cells) { if (!weeks.length || d.dow === 0) weeks.push([]); weeks[weeks.length - 1].push(d); }
  const aria = (d) => `${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일 QT 열기 · ${d.book} ${d.ref}`.trim();
  const dot = (d) => <i className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(--app-tag-${color.get(d.book) || 'gray'}-fg)` }} />;
  if (mobile) {
    return (
      <div className="wiki-qt grid gap-4">
        {weeks.map((w, k) => (
          <div key={k} className="grid gap-1">
            <p className="m-0 px-1 text-[11.5px] font-bold text-fg-muted">{`${Number(w[0].date.slice(5, 7))}월 ${Number(w[0].date.slice(8))}일 ~ ${Number(w[w.length - 1].date.slice(8))}일`}</p>
            <ul className="m-0 p-0 list-none rounded-xl border border-line bg-surface overflow-hidden">
              {w.map((d, j) => {
                const isToday = d.date === today;
                return (
                  <li key={d.date} style={{ '--col': d.dow + 1 }} className={`wiki-qt-day ${j ? 'border-t border-line' : ''}`}>
                    <button type="button" onClick={() => onOpen?.(d.date)} aria-current={isToday ? 'date' : undefined} aria-label={aria(d)}
                      className={`w-full min-h-[48px] grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2 text-left transition active:scale-[.99] ${isToday ? 'bg-accent-weak' : ''} ${d.date < today ? 'opacity-50' : ''}`}>
                      <span className={`flex items-baseline gap-1 ${d.dow === 0 ? 'text-accent' : 'text-fg'}`}><b className="text-[16px] tabular-nums">{Number(d.date.slice(8))}</b><span className="text-[11px]">{DOW[d.dow]}</span></span>
                      <span className="min-w-0 flex items-center gap-1.5 text-[14px]">{dot(d)}<span className="text-fg-muted shrink-0">{d.book}</span> <b className="tabular-nums whitespace-nowrap text-fg">{d.ref}</b></span>
                      {isToday ? <span className="text-[12px] font-bold text-accent">오늘</span> : <ChevronRight size={14} className="text-fg-faint" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="wiki-qt grid gap-2">
      <div className="grid grid-cols-7 gap-2 px-1 text-[12px] font-bold">{DOW.map((w, i) => <span key={w} className={i === 0 ? 'text-accent' : 'text-fg-muted'}>{w}</span>)}</div>
      {weeks.map((w, k) => (
        <ul key={k} className="m-0 p-0 list-none grid grid-cols-7 gap-2">
          {w.map(d => {
            const isToday = d.date === today;
            return (
              <li key={d.date} style={{ '--col': d.dow + 1 }} className="wiki-qt-day [grid-column-start:var(--col)] flex min-w-0">
                <button type="button" onClick={() => onOpen?.(d.date)} aria-current={isToday ? 'date' : undefined} aria-label={aria(d)}
                  className={`wiki-qt-cell w-full min-w-0 min-h-[88px] text-left flex flex-col gap-[5px] rounded-xl px-3 py-2.5 cursor-pointer ${isToday ? 'border-2 border-accent bg-accent-weak' : 'border border-line bg-surface'} ${d.date < today ? 'opacity-50' : ''}`}>
                  <span className="flex items-center justify-between w-full">
                    <b className={`text-[15px] tabular-nums ${d.dow === 0 ? 'text-accent' : 'text-fg'}`}>{Number(d.date.slice(8))}</b>
                    {isToday && <span className="text-[10.5px] font-extrabold text-white bg-accent px-[7px] py-px rounded-full">오늘</span>}
                  </span>
                  <span className="min-w-0 inline-flex items-center gap-[5px] text-[11.5px] text-fg-muted">{dot(d)}<span className="truncate">{d.book}</span></span>
                  {' '}<b className="text-[14px] font-bold tabular-nums whitespace-nowrap text-fg">{d.ref}</b>
                  {d.label && <span className="text-[11px] text-fg-muted">{d.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

// 제목 칸 — 같은 글꼴로 그 자리에서(마스터만)
function TitleDraft({ value, onChange, label }) {
  return <input value={value} onChange={e => onChange(e.target.value)} aria-label={label} maxLength={120} className="wiki-draft wiki-title-draft" />;
}

// 블록 하나 — noTitle: 큰 마디 머리가 이미 그 제목을 보인다 · no: 작은 마디 번호(N.M.)
function Block({ b, i, ctx, noTitle = false, no = '' }) {
  const { page, editing, isMaster = false, drafts, setDrafts, onOpenCite, onOpenQt } = ctx;
  const added = (ctx.added || []).filter(a => a.block_key === b.key);
  const setAdded = ctx.setAdded;
  const canEdit = editing && EDITABLE_TYPES.has(b.type);
  const anim = { animationDelay: `${Math.min(i, 10) * 30}ms` };
  const val = (it) => (it.key in drafts ? drafts[it.key] : it.text);
  const setVal = (it, v) => setDrafts(d => ({ ...d, [it.key]: v }));
  const visible = (b.items || []).filter(it => !(it.key in drafts && drafts[it.key] === '' && it.text !== ''));
  const hk = headKey(b.key);
  const titleNode = editing && isMaster && b.title
    ? <TitleDraft value={hk in drafts ? drafts[hk] : b.title} onChange={v => setDrafts(d => ({ ...d, [hk]: v }))} label="소제목" />
    : b.title;
  const h3 = b.title && !noTitle ? <SubHead no={no} title={titleNode} /> : null;
  const body = 'text-[15px] leading-[1.8] text-fg';

  // 한 줄 — 읽기면 글 + 근거 칩, 고치기면 글 칸
  const line = (it, extra = null) => {
    if (canEdit) return <Draft value={val(it)} onChange={v => setVal(it, v)} onRemove={ADDABLE_TYPES.has(b.type) || it.by === 'model' ? () => setVal(it, '') : null} />;
    return (
      <span className={it.edit ? 'wiki-fixed block' : ''}>
        <Rich text={it.text} itemKey={it.key} extra={extra} lead={PROSE_TYPES.has(b.type)} />
        <Cites cites={it.cites} onOpen={onOpenCite} />
      </span>
    );
  };
  const adder = editing && ADDABLE_TYPES.has(b.type) && page.kind === 'human' && (
    <>
      {added.map(a => (
        <li key={a.key} className="wiki-dot"><Draft value={a.text} placeholder="새 줄"
          onChange={v => setAdded(xs => xs.map(x => (x.key === a.key ? { ...x, text: v } : x)))}
          onRemove={() => setAdded(xs => xs.filter(x => x.key !== a.key))} /></li>
      ))}
      <li className="list-none mt-1.5">
        <button type="button" onClick={() => setAdded(xs => [...xs, { key: `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, block_key: b.key, text: '' }])}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold text-accent-text hover:bg-accent-weak transition active:scale-95"><Plus size={13} /> 줄 추가</button>
      </li>
    </>
  );

  if (b.type === 'hero') {
    const it = b.items[0];
    return (
      <div className="dc-row flex items-center gap-4 rounded-[10px] px-4 py-4" style={{ ...anim, background: 'var(--app-hero)' }}>
        <img src="/chars/umbrella.webp" srcSet={cutSet('/chars/umbrella.webp')} width={95} height={98} alt="" aria-hidden="true" draggable="false" className="shrink-0 w-[84px] sm:w-[95px] h-auto" />
        <p className="min-w-0 flex-1 m-0 text-[14px] leading-[1.75] text-fg"><b className={`text-[15px] block ${editing && isMaster ? 'mb-1.5' : ''}`}>{titleNode}</b>{it ? line(it) : null}</p>
      </div>
    );
  }

  // 줄글 — 두 줄 넘으면 줄마다 점 + 앞말 굵게(사용자 승인 2026-10-05 · 한 줄짜리 장 개요·팀 소개는 문단 그대로). 고치기에서도 같은 점이 선다.
  if (b.type === 'list' || b.type === 'plain') {
    const dots = visible.length + added.length > 1;
    return (
      <div className="dc-row grid gap-2" style={anim}>
        {h3}
        <ul className="list-none pl-0 m-0 grid gap-1.5">
          {visible.map(it => <li key={it.key} className={`${body} ${dots ? 'wiki-dot' : ''}`}>{line(it)}</li>)}
          {adder}
        </ul>
      </div>
    );
  }

  if (b.type === 'teams') {
    return (
      <div className="dc-row grid gap-2" style={anim}>
        {h3}
        <ul className="grid grid-cols-1 min-[421px]:grid-cols-2 lg:grid-cols-4 gap-2 m-0 p-0 list-none">
          {visible.map(it => {
            const tk = CONFIG.TEAM_TOKENS[it.meta?.team] || 'gray';
            return (
              <li key={it.key} className="rounded-[9px] px-3 py-2.5 text-[13px] leading-[1.6] text-fg"
                style={{ background: `var(--app-tag-${tk})`, border: `1px solid color-mix(in srgb, var(--app-tag-${tk}-fg) 18%, transparent)` }}>
                <b className="flex items-center gap-1.5 text-[13.5px] mb-0.5" style={{ color: `var(--app-tag-${tk}-fg)` }}>
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: `var(--app-tag-${tk}-fg)` }} />{it.meta?.team}
                </b>
                {line(it)}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (b.type === 'timeline') {
    return (
      <div className="dc-row" style={anim}>
        {h3}
        <div className="wiki-timeline my-1.5 ml-1.5 mb-2.5">
          {visible.map(it => (
            <div key={it.key} className={`wiki-time ${it.meta?.sub ? 'sub' : ''} grid grid-cols-[3.4em_1fr] gap-x-3 items-baseline py-1.5 pl-4`}>
              <b className={`text-[14px] leading-[1.6] tabular-nums ${it.meta?.sub ? 'text-fg-muted font-semibold' : 'text-accent-text font-bold'}`}>{it.meta?.time}</b>
              <span className="min-w-0 text-[14px] leading-[1.6] text-fg">{line(it)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (b.type === 'section') {
    const status = b.meta?.status;
    return (
      <div className="dc-row grid gap-2 min-w-0" style={anim}>
        <SubHead no={no} title={titleNode} meta={<>
          {b.meta?.when && <span className="wiki-when text-[12px] font-medium text-fg-muted tabular-nums">{b.meta.when}</span>}
          {b.meta?.note && <span className="wiki-note text-[12px] font-medium text-fg-muted">{b.meta.note}</span>}
          {STATUS_TAG.has(status) && <Tag>{status}</Tag>}
        </>} />
        {visible.length ? (
          <ul className="list-none pl-0 m-0 grid gap-1.5">
            {visible.map(it => <li key={it.key} className={`${body} ${visible.length > 1 ? 'wiki-dot' : ''}`}>{line(it)}</li>)}
          </ul>
        ) : <Cites cites={b.cites} onOpen={onOpenCite} className="" />}
      </div>
    );
  }

  // 정해지기까지 — 날짜 · 그 기록(업무) · 문장 · 바뀌기 전(줄을 긋는다) / 지금 정해진 내용(api/_wikiBuild.js가 정한다)
  if (b.type === 'decisions') {
    return (
      <ol className="wiki-steps dc-row m-0 p-0 list-none" style={anim}>
        {(b.steps || []).map(st => (
          <li key={st.key} data-state={st.state || undefined} className={`grid ${ctx.mobile ? 'grid-cols-[62px_minmax(0,1fr)]' : 'grid-cols-[96px_minmax(0,1fr)]'} gap-3.5 py-3.5 border-b border-line items-start`}>
            <span className="pt-0.5 text-[12.5px] font-bold text-fg-muted whitespace-nowrap tabular-nums">{mdLabel(st.date)}</span>
            <div className="min-w-0 grid gap-1 justify-items-start">
              {st.cites?.[0] && <button type="button" onClick={() => onOpenCite?.(st.cites[0])} className="text-left text-[12px] text-accent-text hover:underline underline-offset-2">{st.cites[0].label}</button>}
              <span className={`text-[15px] leading-[1.7] ${st.state === 'old' ? 'line-through text-fg-faint' : 'text-fg'}`}>{st.text}</span>
              {st.state === 'old' && <span className="wiki-step-pill text-[11px] font-bold px-2 py-[2px] rounded-full bg-surface-hover text-fg-muted">바뀌기 전</span>}
              {st.state === 'now' && <span className="wiki-step-pill text-[11px] font-bold px-2 py-[2px] rounded-full bg-tag-green text-tag-green-fg">지금 정해진 내용</span>}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  // 묶음 머리(옛 장 — 지금은 마디 머리가 대신한다)
  if (b.type === 'head') {
    return <h3 className="wiki-group dc-row text-[12px] font-bold text-fg-muted mt-2 mb-0 pt-3 border-t border-line/70" style={anim}>{titleNode}</h3>;
  }

  // 다른 팀과 했던 일 — 날짜를 앞에 단 칩(누르면 업무 창) · 보는 사람 표시는 칩 안 작은 글
  if (b.type === 'chips') {
    return (
      <div className="dc-row grid gap-2" style={anim}>
        {h3}
        <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5">
          {visible.map(it => (
            <li key={it.key} className="min-w-0 max-w-full">
              <button type="button" onClick={() => onOpenCite?.(it.cites?.[0])} title={it.meta?.teams?.join(' · ') || undefined}
                className="wiki-chip max-w-full inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-full border border-line bg-surface text-[12.5px] text-fg text-left transition hover:bg-surface-hover active:scale-95">
                {it.meta?.date && <span className="text-fg-muted tabular-nums shrink-0">{mdLabel(it.meta.date)}</span>}
                <span className="min-w-0">{it.text}</span>
                {it.meta?.note && <span className="wiki-note text-[11px] text-fg-muted shrink-0">{it.meta.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (b.type === 'gap') {
    return (
      <div className="dc-row px-3.5 py-2.5 rounded-lg border border-dashed border-line text-[13px] text-fg-muted leading-relaxed" style={anim}>
        <b className="text-fg font-bold mr-1.5">{b.title || '기록 전'}</b>
        {visible.map((it, k) => (
          <span key={it.key}>{k > 0 && ' · '}
            <button type="button" onClick={() => onOpenCite(it.cites?.[0])} className="hover:text-fg hover:underline underline-offset-2">{it.text}</button>
          </span>
        ))}
      </div>
    );
  }

  if (b.type === 'rows') {
    const n = (b.head || []).length;
    const cols = n >= 4 ? 'sm:grid-cols-[7.5em_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]' : 'sm:grid-cols-[7.5em_minmax(0,1fr)]';
    return (
      <div className="dc-row grid gap-2" style={anim}>
        {h3}
        <div className="rounded-lg border border-line overflow-hidden">
          <div className={`hidden sm:grid ${cols} gap-3 px-3 py-1.5 bg-surface-hover text-[11px] font-bold text-fg-muted`}>{(b.head || []).map(h => <span key={h}>{h}</span>)}</div>
          {(b.rows || []).map((r, k) => {
            const Row = r.cite ? 'button' : 'div';
            return (
              <Row key={k} type={r.cite ? 'button' : undefined} onClick={r.cite ? () => onOpenCite(r.cite) : undefined}
                className={`w-full min-h-[44px] text-left grid ${cols} gap-x-3 gap-y-0.5 px-3 py-2 border-t border-line first:border-t-0 sm:first:border-t text-[13px] leading-snug ${r.today ? 'bg-accent-weak' : ''} ${r.cite ? 'transition-colors hover:bg-surface-hover' : ''}`}>
                {r.cells.map((c, j) => (
                  <span key={j} className={`min-w-0 break-words ${j === 0 ? 'tabular-nums font-semibold text-fg' : 'text-fg'} ${j >= 2 ? 'text-fg-muted' : ''}`}>
                    {j > 0 && <span className="sm:hidden text-fg-muted text-[11px] mr-1.5">{b.head?.[j]}</span>}{c}
                  </span>
                ))}
              </Row>
            );
          })}
        </div>
      </div>
    );
  }

  // 예배 찬양 — 주일 한 장: 날짜(+ 성찬·Q예배) · 설교 제목 · 곡 번호 목록(곡 진하게 · 부른 사람 옅게)
  if (b.type === 'songs') {
    const m = b.meta || {};
    return (
      <div className="dc-row wiki-songs border border-line rounded-[9px] px-3.5 py-3" style={anim}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[14px] font-bold text-fg tabular-nums">{mdLabel(m.date, true)}{m.label ? <span className="ml-1.5 text-[11.5px] font-semibold text-accent-text">{m.label}</span> : null}</span>
          <Cites cites={b.cites} onOpen={onOpenCite} className="" />
        </div>
        {m.sermon && <p className="mt-0.5 text-[12.5px] text-fg-muted">설교 · {m.sermon}</p>}
        {b.songs?.length ? (
          <ol className="mt-2 p-0 list-none grid gap-1.5">
            {b.songs.map((x, k) => (
              <li key={k} className="grid grid-cols-[1.6em_1fr] items-baseline">
                <b className="text-[12px] text-accent-text tabular-nums">{k + 1}</b>
                <span className="min-w-0 text-[14px] leading-snug text-fg">{x.title}{x.by && <span className="block text-[11.5px] text-fg-muted">{x.by}</span>}</span>
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-[12.5px] text-fg-muted">미입력</p>}
      </div>
    );
  }

  if (b.type === 'qt') return <div className="dc-row" style={anim}>{h3}<QtDays days={b.days || []} onOpen={onOpenQt} mobile={ctx.mobile} today={ctx.today} /></div>;

  if (b.type === 'sermon') {
    const m = b.meta || {};
    return (
      <div className="dc-row wiki-sermon border border-line rounded-[9px] px-3.5 py-3 grid gap-[3px]" style={anim}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[12px] text-fg-muted tabular-nums">{mdLabel(m.date)}{m.label ? ` · ${m.label}` : ''}</span>
          <Cites cites={b.cites} onOpen={onOpenCite} className="" />
        </div>
        <span className="text-[15px] font-bold tracking-[-0.2px] leading-[1.45] text-fg">{m.title}</span>
        <span className="text-[12.5px] text-fg-muted">{m.passage}</span>
        {visible.map(it => <span key={it.key} className="text-[14px] leading-[1.7] mt-[3px] text-fg">{canEdit ? line(it) : <span className={it.edit ? 'wiki-fixed block' : ''}><Rich text={it.text} itemKey={it.key} /></span>}</span>)}
        {m.points?.length > 0 && (
          <ol className="mt-1.5 p-0 list-none grid gap-[3px]">
            {m.points.map((pt, k) => (
              <li key={k} className="grid grid-cols-[1.4em_1fr] text-[13px] leading-[1.55] text-fg-muted">
                <b className="text-accent-text tabular-nums">{k + 1}</b>{pt}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (b.type === 'faq') {
    return (
      <div className="dc-row grid gap-2" style={anim}>
        {h3}
        {visible.length ? (
          <ul className="m-0 p-0 list-none grid gap-2.5">
            {visible.map(it => (
              <li key={it.key} className="wiki-faq rounded-lg border border-line px-3 py-2.5">
                <p className="m-0 text-[14px] font-semibold text-fg">{it.meta?.q}{it.meta?.n > 1 && <span className="ml-1.5 text-[11px] font-medium text-fg-muted">{it.meta.n}번</span>}</p>
                <div className="mt-1 text-[14px] leading-[1.7] text-fg">
                  {canEdit ? <Draft value={val(it)} onChange={v => setVal(it, v)} placeholder="답을 적어 주세요" />
                    : it.text ? line(it) : <span className="text-fg-muted">기록 전</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-fg-muted">기록 전</p>}
      </div>
    );
  }
  return null;
}
