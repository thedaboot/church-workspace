import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Pencil, Plus, X } from 'lucide-react';
import { useCached } from '../services/cache.js';
import { loadWiki, saveWikiEdits, seenMap, markSeen } from '../services/wiki.js';
import {
  WIKI_GROUPS, EDITABLE_TYPES, ADDABLE_TYPES, overlayEdits, overlayTitles, editStats, editRows, sourceLabel, mdLabel, kstDate,
  FAQ_SOURCE, TITLE_KEY, headKey,
} from '../services/wikiCore.js';
import { useAuth } from '../services/auth.jsx';
import { AskPanel, AskEntry, CiteChip, chipsFrom } from '../components/dabooti.jsx';
import { cutSet } from '../components/dabooti.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { profileName } from '../services/cloudSync.js';
import { CONFIG } from '../config.js';
import { BTN } from '../components/buttons.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { store } from '../store/workspaceStore.js';
import { showToast } from '../components/Toast.jsx';
import { errorReason } from '../services/errorText.js';
import { FailTail } from '../components/groupsParts.jsx';

const FilePreviewModal = lazy(() => import('../components/FilePreviewModal.jsx').then(m => ({ default: m.FilePreviewModal })));

// ============================================================================
// 더다붓 위키 + 다붓이에게 물어보기 (0088 · 16차 · 목업 LKarXC8WVahATdEuyivvRp v12)
// ----------------------------------------------------------------------------
// 데스크톱: 왼쪽 장 목록(맨 위 '다붓이에게 물어보기' 칸 · 묶음 일곱) | 가운데 물어보기 또는 장.
// 폰: 위키 첫 화면(물어보기 칸 + 장 목록) → 물어보기 / 장(‹ 위키 · ✎ 수정).
// 장은 서버가 매일 아침 모은 블록이고(api/_wikiBuild.js), 사람이 고친 문장은 wiki_edits를 겹쳐 그린다 —
// 초록 줄 + 고친 사람 사진 + 'OOO · 10월 2일 수정'. 고친 줄은 다음 날 다시 모아도 덮이지 않는다.
// 고치기: ✎ 수정 → 줄마다 글 칸 → 저장(바뀐 줄만 upsert) · 함께 쓰는 글의 목록은 줄을 더할 수 있다.
// 근거 칩: 업무 → 업무 창 · 주보 → 그 주보 · 파일 → 미리보기(비밀번호 파일은 업무 창으로) · 장 → 그 장.
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
      el.style.setProperty('--wiki-h', `${main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(main);
    return () => ro.disconnect();
  }, [ref]);
}
const STATUS_TAG = new Set(['진행 중', '시작 전', '보류 중', '상시']);

export default function WikiView({ onTaskClick, onOpenLink }) {
  const isMobile = useIsMobile();
  const { data, loading, error, refresh } = useCached('wiki:all', loadWiki);
  const [sel, setSel] = useState(() => (isMobile ? null : 'ask'));   // null(폰 첫 화면) · 'ask' · 장 id
  const [chat, setChat] = useState([]);
  const [preview, setPreview] = useState(null);
  const [seen, setSeen] = useState(seenMap);
  const [dir, setDir] = useState('fwd');   // 폰 장 넘김 방향 — 들어가면 오른쪽에서, 돌아오면 왼쪽에서
  const { isMaster } = useAuth();
  const rootRef = useRef(null);
  useMainHeight(rootRef);

  const pages = useMemo(() => {
    if (!data) return [];
    const by = new Map();
    for (const e of data.edits || []) { if (!by.has(e.page_id)) by.set(e.page_id, []); by.get(e.page_id).push(e); }
    return (data.pages || []).map(p => { const pe = by.get(p.id) || []; const o = overlayTitles(p, pe); return { ...o, blocks: overlayEdits(o.blocks, pe), edits: pe }; })
      .sort((a, b) => WIKI_GROUPS.indexOf(a.grp) - WIKI_GROUPS.indexOf(b.grp) || a.position - b.position || a.title.localeCompare(b.title));
  }, [data]);
  const page = pages.find(p => p.id === sel) || null;
  const chips = useMemo(() => chipsFrom(pages), [pages]);

  useEffect(() => {
    if (!page) return;
    markSeen(page.id, page.built_at || page.updated_at);
    setSeen(seenMap());
  }, [page?.id, page?.built_at]);  // eslint-disable-line react-hooks/exhaustive-deps

  const go = (id) => { setDir(id === null ? 'back' : 'fwd'); setSel(id); document.querySelector('main')?.scrollTo?.({ top: 0 }); };
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
  const ask = <AskPanel chat={chat} setChat={setChat} chips={chips} onOpenCite={openCite} onOpenFile={openFile} onOpenFaq={() => go('faq')}
    fill={isMobile ? 'calc(var(--wiki-h, 70vh) - 40px)' : 'var(--wiki-h, 70vh)'} />;
  const modal = preview && (
    <Suspense fallback={null}>
      <FilePreviewModal row={preview} rows={[preview]} initialSrc={null} onClose={() => setPreview(null)} />
    </Suspense>
  );

  // ── 폰 ────────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div ref={rootRef} className="wiki wiki-mobile overflow-x-hidden">
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
            {sel !== 'ask' && (body || (page ? <WikiPage key={page.id} page={page} mobile isMaster={isMaster} onOpenCite={openCite} onSaved={refresh} /> : null))}
          </div>
        )}
        {modal}
      </div>
    );
  }

  // ── 데스크톱 ──────────────────────────────────────────────────────────────
  return (
    // 흰 판(테두리 카드)을 두지 않는다 — 앱 바탕 위에 목록과 글이 바로 선다(사용자 지적 2026-10-03 · 앱에 속한 느낌)
    <div ref={rootRef} className="wiki wiki-desk dc-screen grid grid-cols-[236px_minmax(0,1fr)] max-w-[1180px] mx-auto">
      <aside className="wiki-side sticky top-0 self-start overflow-y-auto border-r border-line/70 pr-3 py-1 grid content-start gap-3.5" style={{ height: 'var(--wiki-h, 80vh)' }}>
        <AskEntry active={sel === 'ask'} onClick={() => go('ask')} />
        {body ? null : list}
      </aside>
      <section className="min-w-0 pl-8 pr-2">
        <div className={sel === 'ask' ? '' : 'hidden'}>{ask}</div>
        {sel !== 'ask' && (body || (page ? <div key={page.id} className="dc-fade py-1"><WikiPage page={page} isMaster={isMaster} onOpenCite={openCite} onSaved={refresh} /></div> : null))}
      </section>
      {modal}
    </div>
  );
}

// ── 장 하나 ──────────────────────────────────────────────────────────────────
function WikiPage({ page, mobile = false, isMaster = false, onOpenCite, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [added, setAdded] = useState([]);   // [{ key, block_key, text }]
  const [saving, setSaving] = useState(false);
  const stats = editStats(page.blocks);
  const human = page.kind === 'human';
  const lastWho = stats.last?.by ? profileName(stats.last.by) : '';

  const start = () => { setDrafts({}); setAdded([]); setEditing(true); };
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

  const editBar = editing ? (
    <span className="flex items-center gap-1.5 shrink-0">
      <button type="button" onClick={cancel} className="px-3 py-1.5 rounded-md text-[11.5px] font-semibold text-fg-muted bg-surface-hover transition active:scale-95">취소</button>
      <button type="button" onClick={save} disabled={saving} className={BTN}>저장</button>
    </span>
  ) : (
    <button type="button" onClick={start} className="wiki-edit shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95">
      <Pencil size={12} /> 수정
    </button>
  );

  return (
    <article className="wiki-page dc-fade min-w-0" data-page={page.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-bold text-fg-muted">{editing ? `${page.title} · 수정 중` : page.grp}</span>
          <h2 className={`mt-1 mb-1.5 font-extrabold tracking-[-0.4px] text-fg ${mobile ? 'text-[19px]' : 'text-[22px]'}`}>
            {editing && isMaster
              ? <TitleDraft value={TITLE_KEY in drafts ? drafts[TITLE_KEY] : page.title} onChange={v => setDrafts(d => ({ ...d, [TITLE_KEY]: v }))} label="장 제목" />
              : page.title}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-fg-muted">
            {human ? <Tag green>함께 작성</Tag> : <Tag>{sourceLabel(page.source)}</Tag>}
            {!human && page.source_count > 0 && <span>{UNIT[page.source] || '기록'} {page.source_count}{page.source === '업무' || page.source === '주보' ? '건' : '개'}</span>}
            {!human && page.built_at && <span>{mdLabel(kstDate(page.built_at))}</span>}
            {!human && stats.n > 0 && <Tag green>수정한 곳 {stats.n}</Tag>}
            {human && stats.last && <Who by={stats.last.by} at={stats.last.at} name={lastWho} muted />}
          </div>
        </div>
        {editBar}
      </div>

      <div className="mt-3.5">
        {page.blocks.map((b, i) => (
          <Block key={b.key} b={b} i={i} page={page} editing={editing} isMaster={isMaster} drafts={drafts} setDrafts={setDrafts}
            added={added.filter(a => a.block_key === b.key)} setAdded={setAdded} onOpenCite={onOpenCite} />
        ))}
      </div>
    </article>
  );
}

function Tag({ children, green = false }) {
  return (
    <span className={`text-[10.5px] font-bold px-[7px] py-[2px] rounded-full ${green ? 'bg-tag-green text-tag-green-fg' : 'bg-surface-hover text-fg-muted'}`}>{children}</span>
  );
}

// 'OOO · 10월 2일 수정'(사진) — 업무 창 버전 기록과 같은 모양
function Who({ by, at, name, muted = false }) {
  const n = name || profileName(by) || '';
  return (
    <span className={`wiki-who inline-flex items-center gap-1 text-[10.5px] leading-4 font-semibold whitespace-nowrap ${muted ? 'text-fg-muted' : 'text-tag-green-fg'}`}>
      {n && <Avatar name={n} className="w-4 h-4 text-[8px] flex shrink-0" />}
      {n ? `${n} · ` : ''}{mdLabel(kstDate(at))} 수정
    </span>
  );
}

function Cites({ cites, onOpen, className = 'ml-1.5' }) {
  if (!cites?.length) return null;
  return <span className={`inline-flex flex-wrap gap-1 ${className}`}>{cites.map(c => <CiteChip key={`${c.t}:${c.id}`} cite={c} onOpen={onOpen} />)}</span>;
}

// 고치는 글 칸 — 내용만큼 늘어난다
function Draft({ value, onChange, onRemove, placeholder }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return (
    // 보이는 글을 그 자리에서 고친다 — 같은 글꼴·줄 간격(index.css .wiki-draft) · 줄바꿈은 그대로 저장되고 읽기도 그대로 바꾼다
    <span className="flex items-start gap-2">
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={1} placeholder={placeholder}
        className="wiki-draft flex-1 min-w-0 placeholder:text-fg-faint" />
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="이 줄 지우기" title="이 줄 지우기"
          className="-mt-0.5 w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-fg-faint hover:text-fg-muted hover:bg-surface-hover transition active:scale-90"><X size={14} /></button>
      )}
    </span>
  );
}

// 제목 칸 — 같은 글꼴로 그 자리에서(마스터만)
function TitleDraft({ value, onChange, label }) {
  return <input value={value} onChange={e => onChange(e.target.value)} aria-label={label} maxLength={120} className="wiki-draft wiki-title-draft" />;
}

function Block({ b, i, page, editing, isMaster = false, drafts, setDrafts, added, setAdded, onOpenCite }) {
  const canEdit = editing && EDITABLE_TYPES.has(b.type);
  const anim = { animationDelay: `${Math.min(i, 10) * 30}ms` };
  const val = (it) => (it.key in drafts ? drafts[it.key] : it.text);
  const setVal = (it, v) => setDrafts(d => ({ ...d, [it.key]: v }));
  const visible = (b.items || []).filter(it => !(it.key in drafts && drafts[it.key] === '' && it.text !== ''));
  const hk = headKey(b.key);
  const titleNode = editing && isMaster && b.title
    ? <TitleDraft value={hk in drafts ? drafts[hk] : b.title} onChange={v => setDrafts(d => ({ ...d, [hk]: v }))} label="소제목" />
    : b.title;
  const h3 = b.title ? <h3 className="text-[14.5px] font-bold tracking-[-0.2px] text-fg mt-5 mb-2">{titleNode}</h3> : null;

  // 한 줄 — 읽기면 글 + 근거 칩 + (고친 줄이면) 초록 줄과 사람, 고치기면 글 칸
  const line = (it, extra = null) => {
    if (canEdit) return <Draft value={val(it)} onChange={v => setVal(it, v)} onRemove={ADDABLE_TYPES.has(b.type) || it.by === 'model' ? () => setVal(it, '') : null} />;
    return (
      <span className={it.edit ? 'wiki-fixed block' : ''}>
        <span className="whitespace-pre-line">{extra}{it.text}</span>
        <Cites cites={it.cites} onOpen={onOpenCite} />
        {it.edit && <span className="flex mt-1"><Who by={it.edit.by} at={it.edit.at} /></span>}
      </span>
    );
  };
  const adder = editing && ADDABLE_TYPES.has(b.type) && page.kind === 'human' && (
    <>
      {added.map(a => (
        <li key={a.key} className="list-none mt-1.5"><Draft value={a.text} placeholder="새 줄"
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
      <div className="dc-row flex items-center gap-4 rounded-[10px] px-4 py-4 my-3" style={{ ...anim, background: 'var(--app-hero)' }}>
        <img src="/chars/umbrella.webp" srcSet={cutSet('/chars/umbrella.webp')} width={95} height={98} alt="" aria-hidden="true" draggable="false" className="shrink-0 w-[84px] sm:w-[95px] h-auto" />
        <p className="min-w-0 flex-1 text-[13.5px] leading-[1.7] text-fg"><b className="text-[15px] block">{titleNode}</b>{it ? line(it) : null}</p>
      </div>
    );
  }

  if (b.type === 'list' || b.type === 'plain') {
    const bullets = b.type === 'list' && b.bullets !== false;
    return (
      <section className="dc-row" style={anim}>
        {h3}
        <ul className={`${bullets ? 'list-disc pl-[18px]' : 'list-none pl-0'} m-0 ${b.title ? '' : 'mt-3'}`}>
          {visible.map(it => <li key={it.key} className={`text-[13.5px] leading-[1.75] mb-1.5 text-fg ${it.edit && bullets ? 'list-none' : ''}`}>{line(it)}</li>)}
          {adder}
        </ul>
      </section>
    );
  }

  if (b.type === 'teams') {
    return (
      <section className="dc-row" style={anim}>
        {h3}
        <ul className="grid grid-cols-1 min-[421px]:grid-cols-2 lg:grid-cols-4 gap-2 m-0 p-0 list-none">
          {visible.map(it => {
            const tk = CONFIG.TEAM_TOKENS[it.meta?.team] || 'gray';
            return (
              <li key={it.key} className="rounded-[9px] px-3 py-2.5 text-[12.5px] leading-[1.6] text-fg"
                style={{ background: `var(--app-tag-${tk})`, border: `1px solid color-mix(in srgb, var(--app-tag-${tk}-fg) 18%, transparent)` }}>
                <b className="flex items-center gap-1.5 text-[13px] mb-0.5" style={{ color: `var(--app-tag-${tk}-fg)` }}>
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: `var(--app-tag-${tk}-fg)` }} />{it.meta?.team}
                </b>
                {line(it)}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (b.type === 'timeline') {
    return (
      <section className="dc-row" style={anim}>
        {h3}
        <div className="my-1.5 ml-1.5 mb-2.5 border-l-2 border-line">
          {visible.map(it => (
            <div key={it.key} className={`wiki-time ${it.meta?.sub ? 'sub' : ''} grid grid-cols-[3.4em_1fr] gap-x-3 items-baseline py-1.5 pl-4`}>
              <b className={`text-[13.5px] leading-[1.6] tabular-nums ${it.meta?.sub ? 'text-fg-muted font-semibold' : 'text-accent-text font-bold'}`}>{it.meta?.time}</b>
              <span className="min-w-0 text-[13.5px] leading-[1.6] text-fg">{line(it)}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (b.type === 'section') {
    const status = b.meta?.status;
    return (
      <section className="dc-row" style={anim}>
        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-bold tracking-[-0.2px] text-fg mt-5 mb-2">
          <span className="min-w-0 flex-1">{titleNode}</span>
          {STATUS_TAG.has(status) && <Tag>{status}</Tag>}
        </h3>
        {visible.length ? (
          <ul className="list-disc pl-[18px] m-0">
            {visible.map(it => <li key={it.key} className={`text-[13.5px] leading-[1.75] mb-1.5 text-fg ${it.edit ? 'list-none' : ''}`}>{line(it)}</li>)}
          </ul>
        ) : <Cites cites={b.cites} onOpen={onOpenCite} className="" />}
      </section>
    );
  }

  if (b.type === 'chips') {
    return (
      <section className="dc-row" style={anim}>
        {h3}
        <ul className="m-0 p-0 list-none grid gap-1">
          {visible.map(it => (
            <li key={it.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-fg-muted">
              {it.meta?.date && <span className="tabular-nums w-[4.6em] shrink-0">{mdLabel(it.meta.date)}</span>}
              <Cites cites={it.cites} onOpen={onOpenCite} className="" />
              {it.meta?.teams?.length > 0 && <span className="text-[11px]">{it.meta.teams.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (b.type === 'gap') {
    return (
      <div className="dc-row mt-5 px-3.5 py-2.5 rounded-lg border border-dashed border-line text-[13px] text-fg-muted leading-relaxed" style={anim}>
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
      <section className="dc-row" style={anim}>
        {h3}
        <div className={`rounded-lg border border-line overflow-hidden ${b.title ? '' : 'mt-3'}`}>
          <div className={`hidden sm:grid ${cols} gap-3 px-3 py-1.5 bg-surface-hover text-[11px] font-bold text-fg-muted`}>{(b.head || []).map(h => <span key={h}>{h}</span>)}</div>
          {(b.rows || []).map((r, k) => {
            const Row = r.cite ? 'button' : 'div';
            return (
              <Row key={k} type={r.cite ? 'button' : undefined} onClick={r.cite ? () => onOpenCite(r.cite) : undefined}
                className={`w-full text-left grid ${cols} gap-x-3 gap-y-0.5 px-3 py-2 border-t border-line first:border-t-0 sm:first:border-t text-[13px] leading-snug ${r.today ? 'bg-accent-weak' : ''} ${r.cite ? 'transition-colors hover:bg-surface-hover' : ''}`}>
                {r.cells.map((c, j) => (
                  <span key={j} className={`min-w-0 break-words ${j === 0 ? 'tabular-nums font-semibold text-fg' : 'text-fg'} ${j >= 2 ? 'text-fg-muted' : ''}`}>
                    {j > 0 && <span className="sm:hidden text-fg-muted text-[11px] mr-1.5">{b.head?.[j]}</span>}{c}
                  </span>
                ))}
              </Row>
            );
          })}
        </div>
      </section>
    );
  }

  if (b.type === 'sermon') {
    const m = b.meta || {};
    return (
      <div className="dc-row wiki-sermon border border-line rounded-[9px] px-3 py-2.5 grid gap-[3px] mt-2.5" style={anim}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11.5px] text-fg-muted tabular-nums">{mdLabel(m.date)}{m.label ? ` · ${m.label}` : ''}</span>
          <Cites cites={b.cites} onOpen={onOpenCite} className="" />
        </div>
        <span className="text-[14px] font-bold tracking-[-0.2px] leading-[1.45] text-fg">{m.title}</span>
        <span className="text-[12px] text-fg-muted">{m.passage}</span>
        {visible.map(it => <span key={it.key} className="text-[13px] leading-[1.65] mt-[3px] text-fg">{canEdit ? line(it) : <span className={it.edit ? 'wiki-fixed block' : ''}><span className="whitespace-pre-line">{it.text}</span>{it.edit && <span className="flex mt-1"><Who by={it.edit.by} at={it.edit.at} /></span>}</span>}</span>)}
        {m.points?.length > 0 && (
          <ol className="mt-1.5 p-0 list-none grid gap-[3px]">
            {m.points.map((pt, k) => (
              <li key={k} className="grid grid-cols-[1.4em_1fr] text-[12.5px] leading-[1.55] text-fg-muted">
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
      <section className="dc-row" style={anim}>
        {h3}
        {visible.length ? (
          <ul className="m-0 p-0 list-none grid gap-2.5">
            {visible.map(it => (
              <li key={it.key} className="wiki-faq rounded-lg border border-line px-3 py-2.5">
                <p className="m-0 text-[13.5px] font-semibold text-fg">{it.meta?.q}{it.meta?.n > 1 && <span className="ml-1.5 text-[11px] font-medium text-fg-muted">{it.meta.n}번</span>}</p>
                <div className="mt-1 text-[13.5px] leading-[1.7] text-fg">
                  {canEdit ? <Draft value={val(it)} onChange={v => setVal(it, v)} placeholder="답을 적어 주세요" />
                    : it.text ? line(it) : <span className="text-fg-muted">기록 전</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-fg-muted">기록 전</p>}
      </section>
    );
  }
  return null;
}
