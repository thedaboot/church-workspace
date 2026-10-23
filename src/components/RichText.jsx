import React, { useMemo, useState, useEffect } from 'react';
import { ExternalLink, CheckSquare, Hash, Link2, Globe } from 'lucide-react';
import { tokenizeInline, MD_LINK_RE, IMAGE_LINE_RE, unescapeLine } from '../services/markdown.js';
import { youtubeVideoId, youtubeThumb, fetchVideoTitle } from '../services/worship.js';
import { SmartImage, ImageLightbox } from './media.jsx';
import { docEmbedKind, DocEmbedModal, DocKindIcon } from './DocEmbed.jsx';
import { DOC_KIND_LABEL } from '../services/docEmbed.js';
import { fileKind } from './fileRow.jsx';
import { authedPost } from '../services/cloud/core.js';
import { splitMention } from '../utils.js';
import { parseAppLink } from '../services/appLink.js';
import { useStore } from '../store/workspaceStore.js';
import { CONFIG, teamPaint } from '../config.js';
import { Avatar } from './Avatar.jsx';
import { CardLockMark, LockGlyph } from './cardLock.jsx';
import { isCardClosed } from '../services/cardLock.js';
// 이 업무·프로젝트가 나에게 보이나 — 판정은 visibility.canSeeProject 한 곳(리더만 · 직접 선택 · 휴지통 · 지난해 리더는 RLS가 행을 안 준다)
import { canSeeProject } from '../services/visibility.js';


// ============================================================================
// 9. RichText Parser & Renderer
//    마크다운 서브셋: **굵게** *기울임* __밑줄__ ~~취소선~~ ==형광펜==
//    # ~ #### 제목, -/* 불릿, 1. 번호 목록 + 기존 @멘션·링크·이미지 URL 유지
//    인라인 토큰화는 에디터와 같은 것(services/markdown.js)을 쓴다 — 한쪽만
//    중첩을 지원하면 "쓴 그대로 보인다"가 깨지므로 파서를 하나로 유지한다.
// ============================================================================

// 줄바꿈은 overflow-wrap:anywhere — break-all은 한글 라벨(`[회의록](…)`)까지 글자마다 끊어
// 아무 데서나 줄이 갈렸다. anywhere는 **넘칠 때만** 끊으므로 라벨은 낱말대로, 긴 URL은 잘린다.
const LINK_CLS = 'text-accent-text underline mx-0.5 [overflow-wrap:anywhere] hover:text-accent-strong';

// 우리 앱을 가리키는 링크(`?p=<projectId>&t=<taskId>`)는 새 창이 아니라 **앱 안에서**
// 그 업무 창을 연다. App이 여는 함수를 여기 등록한다 — showToast(Toast.jsx)와 같은
// 모듈 스코프 한 칸이다(뷰어는 본문 어디에나 있어서 프롭으로 내려주면 전부를 지나야 한다).
// 등록 전이거나 앱 밖(딴 배포·딴 도메인)이면 평범한 링크 그대로 두므로, 눌러도
// 주소로 이동해서 딥링크가 받는다 — 어느 쪽이든 그 업무가 열린다.
let openTaskDeepLink = null;
export function setTaskLinkOpener(fn) {
  openTaskDeepLink = fn;
  return () => { if (openTaskDeepLink === fn) openTaskDeepLink = null; };
}

// 같은 origin의 `?p=…&t=…` 또는 공유 주소 `/s/t/<업무>`·`/s/p/<프로젝트>`면 { projectId, taskId, share }, 아니면 null
// (판정은 services/appLink.js 한 벌 — 공유 주소를 몰라서 누르면 페이지 전체를 새로 읽던 것을 고쳤다 2026-10-16)
const parseDeepLink = (href) => (typeof window === 'undefined' ? null : parseAppLink(href, window.location.href));

// 본문의 링크 하나. 앱 안 링크와 **구글 문서 링크**만 클릭을 가로챈다 — 새 탭으로
// 열려는 누름(⌘/Ctrl·가운데 버튼)은 어느 쪽이든 브라우저에 그대로 넘긴다.
//
// 본문 안 링크에는 **비밀번호가 없다.** 참고 링크(resource_links)나 큐시트와 달리 글 안에
// 박힌 주소라 해시를 적어 둘 자리가 없다 — 없는 것을 있는 척하지 않는다(§6-29-k와 같은 판단).
function InlineLink({ href, children }) {
  const deep = parseDeepLink(href);
  const docKind = deep ? null : docEmbedKind(href);
  const [docOpen, setDocOpen] = useState(false);
  if (docKind) return (
    <>
      {/* 앞의 작은 표시가 "앱 안에서 열린다"를 말한다 — 안내 글줄을 붙이지 않는다(§8) */}
      <a
        href={href} target="_blank" rel="noreferrer" className={LINK_CLS}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault(); setDocOpen(true);
        }}
      >
        <DocKindIcon kind={docKind} size={12} className="inline-block shrink-0 mr-[3px] -translate-y-px" />
        {children}
      </a>
      {docOpen && <DocEmbedModal url={href} title={typeof children === 'string' ? children : ''} onClose={() => setDocOpen(false)} />}
    </>
  );
  if (!deep) return <a href={href} target="_blank" rel="noreferrer" className={LINK_CLS}>{children}</a>;
  // 글자가 곧 주소(붙여 넣은 공유 주소 · `[주소](주소)`)면 긴 주소 대신 멘션 한 칩 — 사람이 지은 링크 글자는 그대로다
  if (typeof children === 'string' && children.trim() === href.trim()) return <AppMention href={href} deep={deep} />;
  return (
    <a
      href={href} className={LINK_CLS}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // App이 열었을 때만 클릭을 막는다 — 못 열었으면 주소로 가서 딥링크가 받는다
        if (openTaskDeepLink?.(deep)) e.preventDefault();
      }}
    >{children}</a>
  );
}

// ── 앱 링크 멘션 (시안 2차 2026-10-16) ─────────────────────────────────────────────
// 같은 origin의 업무·프로젝트 주소가 **글자 그대로** 박혀 있으면(`/s/t/<uuid>`는 60자가 넘어 본문·댓글을 갈랐다) 그 자리를
// 노션 페이지 멘션처럼 '아이콘 + 제목' 한 칩으로 그린다 — 업무는 초록 체크(잠긴 업무는 자물쇠) · 프로젝트는 보라 #(상단 검색과 같은 표시).
// 누르면 InlineLink와 같은 길로 앱 안에서 연다. 스토어에 없거나 나에게 안 보이는 업무·프로젝트 링크는 '업무 링크'·'프로젝트 링크' 중립 칩(아래).
// 아래 업무 링크 카드는 그대로 선다. 저장된 글(마크다운)은 주소 그대로라 수정 화면에서는 주소가 보인다.
// **복사하면 주소가 나온다** — 문서의 copy를 한 번 듣고, 고른 구간 안의 멘션을 그 주소 글자로 바꿔 클립보드에 싣는다
// (멘션 안만 골랐으면 그 주소 하나). 링크 복사(우클릭)는 href 그대로라 손댈 것이 없다.
let mentionCopyHooked = false;
function hookMentionCopy() {
  if (mentionCopyHooked || typeof document === 'undefined') return;
  mentionCopyHooked = true;
  document.addEventListener('copy', (e) => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !e.clipboardData) return;
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const host = (anc.nodeType === 1 ? anc : anc.parentElement)?.closest?.('[data-app-mention]');
    if (host) { e.clipboardData.setData('text/plain', host.getAttribute('href')); e.preventDefault(); return; }
    const frag = range.cloneContents();
    const marks = frag.querySelectorAll('[data-app-mention]');
    if (!marks.length) return;
    marks.forEach(m => m.replaceWith(document.createTextNode(m.getAttribute('href'))));
    const box = document.createElement('div');
    box.appendChild(frag);
    e.clipboardData.setData('text/plain', box.textContent);
    e.clipboardData.setData('text/html', box.innerHTML);
    e.preventDefault();
  });
}
const MENTION_CLS = 'inline mx-0.5 px-1 py-px rounded-xs bg-surface-hover text-fg font-semibold no-underline hover:bg-line transition-colors [overflow-wrap:anywhere] [box-decoration-break:clone]';
function AppMention({ href, deep }) {
  useEffect(hookMentionCopy, []);
  const task = useStore(s => (deep.taskId ? s.tasks.byId[deep.taskId] : null));
  const project = useStore(s => s.projects.byId[task ? task.projectId : deep.projectId] || null);
  const title = deep.taskId ? task?.title : project?.title;
  const open = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (openTaskDeepLink?.(deep)) e.preventDefault();
  };
  if (!title || !canSeeProject(project)) {
    // 업무·프로젝트 링크인데 나에게 보이는 것이 없다(지움 · 볼 수 없음 · 없는 id) — 긴 주소 대신 **같은 모양의 중립 칩**(시안 3차).
    // 제목도 '있다/없다'도 드러내지 않는다 — 없는 것과 못 보는 것이 같은 글자·같은 아이콘이다. 누름은 그대로(못 열면 주소로).
    // `?p=<화면>` 같은 화면 링크(업무가 아니다)는 예전처럼 주소 그대로다.
    if (!deep.share && !deep.taskId) return <a href={href} className={LINK_CLS} onClick={open}>{href}</a>;
    return (
      <a href={href} data-app-mention="unknown" className={MENTION_CLS} onClick={open}>
        <Link2 size={12} strokeWidth={2} aria-hidden className="inline-block align-[-1px] mr-1 text-fg-muted" />{deep.taskId ? '업무 링크' : '프로젝트 링크'}
      </a>
    );
  }
  const icon = deep.taskId
    ? (task.locked
      ? <LockGlyph size={12} strokeWidth={2.4} className="inline-block align-[-1px] mr-1 text-fg-muted" />
      : <CheckSquare size={12} strokeWidth={2} aria-hidden className="inline-block align-[-1px] mr-1 text-tag-green-fg" />)
    : <Hash size={12} strokeWidth={2} aria-hidden className="inline-block align-[-1px] mr-[3px] text-tag-purple-fg" />;
  return <a href={href} data-app-mention={deep.taskId ? 'task' : 'project'} title={title} className={MENTION_CLS} onClick={open}>{icon}{title}</a>;
}
// ── 유튜브 링크 카드 (UX 다듬기 2차 C13 · 2026-10-15 · PITFALLS 59-d) ─────────────────────────────
// 댓글·업무 본문(ytCards를 넘긴 자리만)의 유튜브 **영상** 주소 아래에 카드 한 장 — 주보 찬양 줄(worshipDetail SongThumb + 제목 링크 + ↗)과
// 같은 한 벌을 테두리 상자로 감쌌다(시안 C13). 썸네일은 공개 주소(i.ytimg.com)라 곧바로 서고, 제목은 우리 서버(api/yt · 승인된 사람만 ·
// oEmbed)에서 받아 오는 동안 그 자리에 막대가 숨 쉰다. **못 받으면(게스트 · 비공개 영상 · 서버 실패) 카드를 걷는다** — 링크는 글 안에
// 그대로 있다. 제목은 영상 id마다 이 탭에 한 번만 묻는다(실패도 적어 둔다 — 그리는 때마다 서버를 두드리지 않게).
// 잠긴 업무(0099)는 본문·댓글을 아예 그리지 않으므로(잠금 판) 묻지도 않는다. 본문 링크에는 비밀번호가 없다(위 InlineLink).
// 개발 빌드의 게스트 검사(tests/modalclose)는 `window.__ytTitleFake = { [영상 id]: '제목' | null }`로 답을 정한다(null = 실패).
const ytTitles = new Map();   // 영상 id → '제목' | '' (못 받음) | Promise
const URL_IN_LINE = /https?:\/\/[^\s)\]]+/g;
const ytIdsIn = (text) => [...new Set((String(text || '').match(URL_IN_LINE) || []).map(u => youtubeVideoId(u)).filter(Boolean))];
function askTitle(id) {
  const had = ytTitles.get(id);
  if (had !== undefined) return Promise.resolve(had);
  const fake = import.meta.env?.DEV && typeof window !== 'undefined' ? window.__ytTitleFake : null;
  const p = (fake ? Promise.resolve(fake[id] ?? null).then(t => { if (!t) throw new Error('fake'); return t; })
    : fetchVideoTitle(`https://www.youtube.com/watch?v=${id}`))
    .then(t => String(t || '').trim(), (e) => { if (!e?.quiet) console.warn('[yt] 영상 제목을 받지 못했어요:', e?.human || e); return ''; })
    .then(t => { ytTitles.set(id, t); return t; });
  ytTitles.set(id, p);
  return p;
}
const WJ = '⁠';   // 단어 잇개 — 아이콘이 혼자 다음 줄로 내려가지 않게(worshipDetail과 같다)
function YtCard({ id }) {
  const cached = ytTitles.get(id);
  const [title, setTitle] = useState(typeof cached === 'string' ? cached : null);   // null = 받는 중
  const [thumbOk, setThumbOk] = useState(true);
  useEffect(() => {
    if (typeof ytTitles.get(id) === 'string') { setTitle(ytTitles.get(id)); return undefined; }
    let alive = true;
    askTitle(id).then(t => { if (alive) setTitle(t); });
    return () => { alive = false; };
  }, [id]);
  if (title === '' || !thumbOk) return null;
  const href = `https://www.youtube.com/watch?v=${id}`;
  return (
    <a href={href} target="_blank" rel="noreferrer" data-yt-card={id}
      className="yt-card flex items-center gap-2.5 mt-1.5 mb-1 px-2.5 py-2 rounded-md border border-line hover:bg-surface-hover transition-colors max-w-[380px] no-underline">
      <span className="worship-song-thumbbox w-16 h-9 shrink-0 relative inline-block overflow-hidden rounded-sm" style={{ background: 'var(--app-surface-hover)' }}>
        <img referrerPolicy="no-referrer" src={youtubeThumb(href)} alt="" loading="lazy" draggable={false} onError={() => setThumbOk(false)}
          className="worship-song-thumb w-full h-full rounded-sm object-cover" />
      </span>
      {title === null
        ? <span className="flex-1 min-w-0"><span className="block h-2.5 w-3/4 rounded-full dc-skeleton" /></span>
        : (
          <span className="worship-song-link min-w-0 text-[13px] font-semibold text-accent-text leading-snug break-words">
            {title}{WJ}<ExternalLink size={11} className="worship-song-ext inline-block ml-1.5 align-[-1px]" />
          </span>
        )}
    </a>
  );
}
// 한 줄(문단·목록 한 칸·체크 항목·제목)의 영상 주소마다 카드 — 그 줄 바로 아래에 선다(같은 영상은 한 장)
const YtCards = ({ text }) => {
  const ids = useMemo(() => ytIdsIn(text), [text]);
  return ids.map(id => <YtCard key={id} id={id} />);
};

// ── 업무 링크 카드 (시안 2026-10-16 · 유튜브 카드와 같은 자리 — 댓글·업무 보기 본문만) ─────────────────────────────
// 같은 줄에 우리 업무 주소(`/s/t/<업무>` · `?p=&t=` — services/appLink.js)가 있으면 그 줄 아래에 카드 한 장:
// 팀 색 레일(보드 카드와 같은 3px · 프로젝트에는 색 칸이 없어 팀 색이다) · 프로젝트 이름 · 제목 · 본문 첫 줄 · 상태 칩 · 담당자 얼굴.
// 누르면 그 자리에서 업무 창을 연다(InlineLink와 같은 opener · ⌘/Ctrl 누름은 브라우저에 그대로).
// **잠긴 업무**(나에게 닫힌 것)는 자물쇠 + 제목만(공유 카드 api/share와 같은 선 — 상태·담당자·본문을 싣지 않는다).
// **스토어에 없는 업무 · 나에게 안 보이는 프로젝트**(직접 고른 사람에 내가 없음)는 카드를 세우지 않는다 — 링크만 남는다.
const taskIdsIn = (text) => {
  const here = typeof window === 'undefined' ? null : window.location.href;
  if (!here) return [];
  return [...new Set((String(text || '').match(URL_IN_LINE) || []).map(u => parseAppLink(u, here)?.taskId).filter(Boolean))];
};
// 본문 첫 글줄을 맨 글자로(제목 줄은 다른 글줄이 없을 때만 · 목록표·체크표·인라인 서식을 뗀다)
const firstLine = (md) => {
  const lines = String(md || '').split('\n').map(l => l.trim()).filter(l => l && !/^(-{3,}|\*{3,}|_{3,})$/.test(l) && !IMAGE_LINE_RE.test(l));
  const line = lines.find(l => !/^#{1,4}\s/.test(l)) || lines[0] || '';
  const bare = line.replace(/^#{1,4}\s+/, '').replace(/^[-*]\s+\[( |x|X)\]\s?/, '').replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '');
  return tokenizeInline(bare).map(s => s.text).join('').trim();
};
function TaskLinkCard({ id }) {
  const task = useStore(s => s.tasks.byId[id]);
  const project = useStore(s => (task ? s.projects.byId[task.projectId] : null));
  if (!task || !canSeeProject(project)) return null;
  const closed = isCardClosed(task);
  const href = `${window.location.origin}/s/t/${id}`;
  const lead = closed ? '' : firstLine(task.content);
  const faces = task.assignees || [];
  return (
    <a href={href} data-task-card={id} data-task-card-locked={closed ? '' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (openTaskDeepLink?.({ projectId: task.projectId, taskId: id, share: true })) e.preventDefault();
      }}
      className="task-card flex gap-2.5 mt-1.5 mb-1 pl-2.5 pr-3 py-2 rounded-md border border-line hover:bg-surface-hover transition-colors max-w-[380px] no-underline">
      <span className="shrink-0 w-[3px] rounded-full my-0.5" style={teamPaint(task.teams || [], true)} />
      <span className="flex-1 min-w-0">
        <span className="block text-[10px] text-fg-muted truncate">{project.title}</span>
        <span className="block text-[13px] font-semibold text-fg leading-snug break-words"><CardLockMark task={task} />{task.title}</span>
        {lead && <span className="block mt-0.5 text-[11.5px] text-fg-muted leading-snug truncate">{lead}</span>}
        {!closed && (
          <span className="flex items-center gap-2 mt-1.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 pl-2 pr-2 py-[2px] rounded-full border border-line text-[10.5px] font-bold text-fg-muted shrink-0">
              <span className={`w-[5px] h-[5px] rounded-full ${CONFIG.STATUS_DOTS[task.status] || 'bg-fg-faint'}`} />{task.status}
            </span>
            {faces.length > 0 && (
              <span className="flex items-center shrink-0" title={faces.join(', ')}>
                {faces.slice(0, 3).map(n => (
                  <Avatar key={n} name={n} className="flex w-[18px] h-[18px] text-[9px] -ml-[5px] first:ml-0 ring-[1.5px] ring-surface" />
                ))}
                {faces.length > 3 && <span className="ml-[5px] text-[10.5px] text-fg-muted tabular-nums">+{faces.length - 3}</span>}
              </span>
            )}
          </span>
        )}
      </span>
    </a>
  );
}
// 본문 밖에서 업무 하나를 가리킬 때(행사 일정의 관련 업무 · 0112) — 보이면 위 카드, 못 보면(없음·안 보이는 프로젝트) '업무 링크' 중립 칩.
// 판정은 카드·칩과 같은 canSeeProject 하나다.
export function TaskRef({ id }) {
  const task = useStore(s => s.tasks.byId[id]);
  const project = useStore(s => (task ? s.projects.byId[task.projectId] : null));
  if (task && canSeeProject(project)) return <TaskLinkCard id={id} />;
  const href = `${window.location.origin}/s/t/${encodeURIComponent(id)}`;
  return <AppMention href={href} deep={{ projectId: null, taskId: id, share: true }} />;
}
const TaskLinkCards = ({ text }) => {
  const ids = useMemo(() => taskIdsIn(text), [text]);
  return ids.map(id => <TaskLinkCard key={id} id={id} />);
};

// ── 링크 카드 (사용자 승인 목업 ⑦ 2026-10-19 · 유튜브·업무 카드와 같은 자리 — 댓글·업무 보기 본문만) ─────────────────────────────
// **한 줄에 주소만 있을 때만** 그 줄 아래에 카드 한 장 — 글 속에 섞인 주소는 지금처럼 파란 글자다. 유튜브·우리 앱 주소는 위 카드들이 맡는다.
//   일반 링크  서버(/api/link-title · meta)가 그 페이지의 대표 제목·설명·그림·사이트 이름을 받아 온다(SSRF 두 겹 그대로 · 글자만 돌려받는다).
//             제목이 있으면 큰 카드(그림은 오른쪽 · 폰 72px · 설명은 데스크톱만), 못 받으면(자동 접근을 막는 곳 · 게스트) 한 줄 카드(사이트 주소 + 경로).
//   파일 링크  구글 문서·시트·슬라이드 · 드라이브 파일 · .pdf/.docx/.xlsx/.pptx/.hwp 주소 — 종류 칩 + 이름 + 어디 파일인지.
//             구글 문서류는 누르면 앱 안 창(DocEmbedModal — 본문 링크를 누를 때와 같은 창) · 그 밖은 새 탭.
// 받은 것은 이 탭에 + 브라우저에 하루 둔다(같은 주소를 댓글마다 다시 묻지 않게). 받는 동안은 한 줄 카드 모양 뼈대.
const META_TTL = 24 * 60 * 60 * 1000;
const linkMetas = new Map();   // 주소 → { title, description, image, site } | Promise
const META_KEY = (u) => `linkmeta:${u}`;
function askMeta(url) {
  const had = linkMetas.get(url);
  if (had) return Promise.resolve(had);
  try {
    const saved = JSON.parse(localStorage.getItem(META_KEY(url)) || 'null');
    if (saved && Date.now() - saved.at < META_TTL) { linkMetas.set(url, saved.meta); return Promise.resolve(saved.meta); }
  } catch { /* 저장소를 못 쓰면 이번에 받는다 */ }
  const empty = { title: '', description: '', image: '', site: '' };
  const fake = import.meta.env?.DEV && typeof window !== 'undefined' ? window.__linkMetaFake : null;
  const p = (fake ? Promise.resolve({ ...empty, ...(fake[url] || {}) })
    : authedPost('/api/link-title', { url, meta: true }, { noToken: () => null, signal: AbortSignal.timeout(6000) })
      .then(r => (r && r.ok ? r.json() : empty)))
    .then(m => ({ ...empty, ...(m || {}) }), () => empty)
    .then(m => {
      linkMetas.set(url, m);
      if (!fake) { try { localStorage.setItem(META_KEY(url), JSON.stringify({ at: Date.now(), meta: m })); } catch { /* 자리가 없으면 이 탭에서만 */ } }
      return m;
    });
  linkMetas.set(url, p);
  return p;
}
const BARE_URL = /^https?:\/\/\S+$/;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|hwpx?|csv)$/i;
const DRIVE_FILE = /^https?:\/\/drive\.google\.com\/(file\/d\/|open\?id=)/i;
// 파일 링크면 { ext(종류 칩용), where(어디 파일인지), doc(앱 안 창 종류 | null) } · 아니면 null
export function fileLinkOf(url) {
  const doc = docEmbedKind(url);
  if (doc) return { ext: { doc: 'docx', sheet: 'xlsx', slide: 'pptx' }[doc], where: DOC_KIND_LABEL[doc], doc };
  if (DRIVE_FILE.test(url)) return { ext: '', where: '구글 드라이브', doc: null };
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  const m = FILE_EXT.exec(path);
  return m ? { ext: m[1].toLowerCase(), where: hostOfUrl(url), doc: null } : null;
}
const hostOfUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const pathOfUrl = (u) => { try { const x = new URL(u); return decodeURIComponent(x.pathname + x.search).replace(/\/$/, ''); } catch { return ''; } };
const fileNameOf = (u) => pathOfUrl(u).split('?')[0].split('/').filter(Boolean).pop() || hostOfUrl(u);
const CARD_BOX = 'mt-1.5 mb-1 rounded-md border border-line hover:bg-surface-hover transition-colors max-w-[520px] no-underline';

function LinkCard({ url }) {
  const cached = linkMetas.get(url);
  const [meta, setMeta] = useState(cached && typeof cached.then !== 'function' ? cached : null);   // null = 받는 중
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    let alive = true;
    askMeta(url).then(m => { if (alive) setMeta(m); });
    return () => { alive = false; };
  }, [url]);
  const host = hostOfUrl(url);
  if (meta === null) {
    return <span className={`${CARD_BOX} flex items-center gap-2 px-3 h-10`} data-link-card-loading=""><span className="block h-2.5 w-2/3 rounded-full dc-skeleton" /></span>;
  }
  if (!meta.title) {
    return (
      <a href={url} target="_blank" rel="noreferrer" data-link-card={url} data-link-card-kind="line"
        className={`${CARD_BOX} flex items-center gap-2 px-3 h-10 min-w-0`}>
        <Globe size={14} className="shrink-0 text-fg-faint" />
        <span className="shrink-0 text-[12.5px] font-semibold text-fg">{host}</span>
        <span className="min-w-0 truncate text-[11.5px] text-fg-muted">{pathOfUrl(url).replace(/^\//, '')}</span>
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" data-link-card={url} data-link-card-kind="rich" className={`${CARD_BOX} flex overflow-hidden min-w-0`}>
      <span className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[11px] text-fg-muted min-w-0"><Globe size={12} className="shrink-0 text-fg-faint" /><span className="truncate">{meta.site || host}</span></span>
        <span className="text-[13px] font-bold text-fg leading-snug line-clamp-2 break-words">{meta.title}</span>
        {meta.description && <span className="hidden md:block text-[11.5px] text-fg-muted truncate">{meta.description}</span>}
        {meta.site && <span className="text-[10.5px] text-fg-muted truncate">{host}</span>}
      </span>
      {meta.image && imgOk && (
        <span className="shrink-0 w-[72px] md:w-24 self-stretch min-h-[72px]" style={{ background: 'var(--app-surface-hover)' }}>
          <img src={meta.image} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setImgOk(false)} className="w-full h-full object-cover" />
        </span>
      )}
    </a>
  );
}

function FileLinkCard({ url, file }) {
  const [open, setOpen] = useState(false);
  const cached = linkMetas.get(url);
  const [meta, setMeta] = useState(cached && typeof cached.then !== 'function' ? cached : null);
  useEffect(() => {
    // 구글 문서·드라이브는 제목을 받아 본다(공개 문서만 온다 · 못 받으면 주소의 이름) · 그 밖의 파일 주소는 이름이 주소에 있다
    if (!file.doc && !DRIVE_FILE.test(url)) return undefined;
    let alive = true;
    askMeta(url).then(m => { if (alive) setMeta(m); });
    return () => { alive = false; };
  }, [url, file.doc]);
  const kind = fileKind(`x.${file.ext}`, '', 16);
  const name = meta?.title || (file.doc ? DOC_KIND_LABEL[file.doc] : fileNameOf(url));
  const body = (
    <>
      <span className={`w-9 h-9 ml-2.5 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>
      <span className="flex-1 min-w-0 px-2.5 py-2">
        <span className="block text-[13px] font-bold text-fg truncate">{name}</span>
        <span className="block text-[11px] text-fg-muted truncate">{file.doc ? `${file.where} · 눌러서 미리보기` : file.where}</span>
      </span>
      <span className="shrink-0 mr-3 text-[11.5px] font-semibold text-accent-text">열기</span>
    </>
  );
  if (file.doc) {
    return (
      <>
        <a href={url} target="_blank" rel="noreferrer" data-file-link-card={url}
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setOpen(true); }}
          className={`${CARD_BOX} flex items-center min-w-0`}>{body}</a>
        {open && <DocEmbedModal url={url} title={meta?.title || ''} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return <a href={url} target="_blank" rel="noreferrer" data-file-link-card={url} className={`${CARD_BOX} flex items-center min-w-0`}>{body}</a>;
}

// 그 줄이 주소 하나뿐일 때만 — 유튜브·우리 앱 주소는 다른 카드가 맡는다
const linkCardTakesLine = (text) => {
  const url = String(text || '').trim();
  if (!BARE_URL.test(url) || youtubeVideoId(url)) return false;
  return !(typeof window !== 'undefined' && parseAppLink(url, window.location.href));
};
const LinkCards = ({ text }) => {
  const url = String(text || '').trim();
  if (!linkCardTakesLine(url)) return null;
  const file = fileLinkOf(url);
  return file ? <FileLinkCard url={url} file={file} /> : <LinkCard url={url} />;
};

// 마크 → 태그·클래스 (에디터 .tiptap 스타일과 같은 톤)
const MARK_TAG = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', highlight: 'mark' };
const MARK_CLS = {
  bold: 'font-bold',
  strike: 'opacity-80',
  highlight: 'bg-tag-yellow text-tag-yellow-fg rounded-[3px] px-0.5',
};

// 서식이 없는 구간에서만 @멘션·생 URL을 살린다(마크 안의 URL은 그대로 글자로)
// 멘션 토큰은 `@` 뒤 공백 아닌 글자 전부지만, **칩에 넣는 것은 꼬리 문장부호를 뗀 이름**이다
// (utils.splitMention — 뽑는 쪽과 같은 규칙). "(@박지호)"의 `)`는 칩 밖의 글자로 남는다.
const PLAIN_RE = /(@[^\s@]+|https?:\/\/\S+)/g;
const renderPlain = (text, key) => text.split(PLAIN_RE).filter(Boolean).map((p, i) => {
  const k = `${key}-p${i}`;
  if (/^@[^\s@]+$/.test(p)) {
    const { name, tail } = splitMention(p);
    if (!name) return <React.Fragment key={k}>{p}</React.Fragment>;
    return (
      <React.Fragment key={k}>
        <span className="text-accent-text font-semibold bg-accent-weak px-1 rounded-xs mx-0.5">@{name}</span>
        {tail}
      </React.Fragment>
    );
  }
  if (/^https?:\/\/\S+$/.test(p)) return <InlineLink key={k} href={p}>{p}</InlineLink>;
  return <React.Fragment key={k}>{p}</React.Fragment>;
});

const renderInline = (text, keyBase) => {
  if (!text) return null;
  return tokenizeInline(text).map((seg, i) => {
    const key = `${keyBase}-${i}`;
    // 안쪽부터: 링크 or 평문 → 마크로 감싸 올라간다
    let node = seg.href
      ? <InlineLink href={seg.href}>{seg.text}</InlineLink>
      : renderPlain(seg.text, key);
    for (const m of [...seg.marks].reverse()) {
      const Tag = MARK_TAG[m];
      if (Tag) node = <Tag className={MARK_CLS[m]}>{node}</Tag>;
    }
    return <React.Fragment key={key}>{node}</React.Fragment>;
  });
};

const HEADING_CLS = {
  1: 'text-xl font-bold tracking-[-0.25px] text-fg mt-3 mb-1.5',
  2: 'text-lg font-bold tracking-[-0.25px] text-fg mt-3 mb-1',
  3: 'text-base font-semibold text-fg mt-2 mb-1',
  4: 'text-sm font-semibold text-fg mt-2 mb-0.5',
};

// 줄 배열 → 블록 배열 (연속된 목록 항목은 하나의 목록으로 묶음)
const parseBlocks = (text) => {
  if (!text) return [];
  const blocks = [];
  let todoIdx = -1;   // 본문 전체에서 몇 번째 체크 항목인지 — 토글(utils.toggleTodoLine)의 좌표
  for (const [i, line] of text.split('\n').entries()) {
    // `\`로 막아 둔 글줄은 문법처럼 생겼어도 문단이다(markdown.js needsEscape와 한 쌍)
    const plain = unescapeLine(line);
    if (plain !== null) { blocks.push({ type: 'p', value: plain, key: i }); continue; }
    // [텍스트](URL) 형태의 링크 줄은 이미지로 오인하지 않고 단락으로(인라인에서 링크 렌더)
    const isMdLinkLine = MD_LINK_RE.test(line.trim());
    // 줄 **전체**가 이미지 URL일 때만 이미지 블록으로 본다(에디터의 IMAGE_LINE_RE와 같은 판정).
    // 예전에는 줄 안에 URL이 있으면 되던 탓에 "사진: https://….png"가 줄 전체를 src로
    // 넘겨 깨진 이미지가 되고 앞의 문장이 사라졌다.
    if (!isMdLinkLine && IMAGE_LINE_RE.test(line.trim())) { blocks.push({ type: 'image', value: line.trim(), key: i }); continue; }
    // 구분선 — 판정 모양은 markdown.js와 한 쌍이다(읽기는 ---·***·___ 셋 다)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { blocks.push({ type: 'rule', key: i }); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, value: h[2], key: i }); continue; }
    // 체크리스트 — 불릿보다 먼저(불릿 패턴에도 걸린다). 판정 모양은 markdown.js와 한 쌍.
    const todo = line.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/);
    if (todo) {
      todoIdx++;
      const item = { checked: todo[1].toLowerCase() === 'x', value: todo[2], key: i, idx: todoIdx };
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'todo') prev.items.push(item);
      else blocks.push({ type: 'todo', items: [item], key: i });
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'ul') prev.items.push({ value: ul[1], key: i });
      else blocks.push({ type: 'ul', items: [{ value: ul[1], key: i }], key: i });
      continue;
    }
    // 번호 목록 — **블록의 첫 숫자를 들고 간다**(`<ol start>`). 예전에는 언제나 1부터
    // 그려서, 목록 사이에 다른 블록이 끼어 `2.`로 저장된 글도 화면에서는 `1.`이 됐다
    // (사용자 지적 2026-09-11 · 읽는 쪽 markdown.js `mdToDoc`와 한 쌍이다).
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'ol') prev.items.push({ value: ol[2], key: i });
      else blocks.push({ type: 'ol', start: Number(ol[1]) || 1, items: [{ value: ol[2], key: i }], key: i });
      continue;
    }
    if (line.trim() === '') { blocks.push({ type: 'gap', key: i }); continue; }
    blocks.push({ type: 'p', value: line, key: i });
  }
  return blocks;
};

// 본문 이미지 — 받는 동안 같은 자리에 스켈레톤, 누르면 크게 본다
function ContentImage({ src }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SmartImage
        src={src} alt="첨부 이미지" title="크게 보기" onClick={() => setOpen(true)}
        wrapperClassName="max-w-full inline-block"
        className="max-w-full rounded-lg border border-line max-h-64 object-contain"
        skeletonClassName="w-full h-40 rounded-lg"
      />
      {open && <ImageLightbox src={src} alt="첨부 이미지" onClose={() => setOpen(false)} />}
    </>
  );
}

// onToggleTodo(idx): 본문 체크리스트의 idx번째 항목을 뒤집는다 — 업무 창 보기 모드만
// 넘긴다(하위 업무처럼 보기에서 바로 눌린다). 안 넘기면(댓글·요약 등) 읽기 전용이다.
// lineAttrs: 줄마다 `data-line`(마크다운 줄 번호)을 단다 — 업무 창 보기 화면이 '누가 어느 줄을 고치는 중인가'를
// 그 줄 옆에 세우는 좌표다(modals/coedit.jsx PresenceMarks · 엔진 core.caretLine과 같은 번호). 모양은 안 바뀐다.
// ytCards: 유튜브 영상 주소·우리 업무 주소가 있는 줄 아래에 카드(위 '유튜브 링크 카드'·'업무 링크 카드') · 주소만 있는 줄은 링크 카드(위 '링크 카드') — 댓글·업무 보기 본문만 넘긴다.
export const RichText = React.memo(({ content, onToggleTodo, lineAttrs = false, ytCards = false }) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const ln = (k) => (lineAttrs ? { 'data-line': k } : null);
  const yt = (value) => (ytCards ? <><TaskLinkCards text={value} /><YtCards text={value} /><LinkCards text={value} /></> : null);
  // 링크 카드가 그 줄을 대신하면(주소만 있는 줄 · 목업 ⑦ '그 자리에 카드') 주소 글자는 다시 쓰지 않는다 — 폰에서 긴 주소가 두 줄로 카드 위에 겹쳐 섰다
  const inl = (value, key) => (ytCards && linkCardTakesLine(value) ? null : renderInline(value, key));
  return (
    <>
      {blocks.map(block => {
        switch (block.type) {
          case 'rule':
            // 본문 안의 선은 카드 테두리보다 옅다 — 글을 가르는 표시이지 상자가 아니다
            return <hr key={block.key} {...ln(block.key)} className="my-3 border-0 h-px" style={{ background: 'var(--app-line)' }} />;
          case 'image':
            return <div key={block.key} {...ln(block.key)} className="my-2"><ContentImage src={block.value} /></div>;
          case 'todo':
            return (
              <div key={block.key} className="mb-1 space-y-1">
                {block.items.map(it => (
                  <div key={it.key} {...ln(it.key)} className="flex items-start gap-2 leading-relaxed">
                    {/* 하위 업무 체크박스와 같은 표기(초록 채움 + 흰 체크) — 같은 뜻은 같은 모양 */}
                    <button
                      type="button" disabled={!onToggleTodo}
                      onClick={() => onToggleTodo?.(it.idx)}
                      className={`w-[16px] h-[16px] mt-[3px] rounded-xs shrink-0 flex items-center justify-center transition-colors ${onToggleTodo ? '' : 'cursor-default'}`}
                      style={it.checked
                        ? { background: 'var(--app-tag-green-fg)' }
                        : { border: '1.5px solid var(--app-line)' }}
                      aria-pressed={it.checked} aria-label={`${it.value || '체크 항목'} ${it.checked ? '완료 취소' : '완료'}`}
                    >
                      {it.checked && (
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </button>
                    <span className={`min-w-0 ${it.checked ? 'text-fg-faint line-through' : 'text-fg'}`}>{inl(it.value, it.key)}{yt(it.value)}</span>
                  </div>
                ))}
              </div>
            );
          case 'heading': {
            const Tag = `h${block.level}`;
            return <Tag key={block.key} {...ln(block.key)} className={HEADING_CLS[block.level]}>{inl(block.value, block.key)}{yt(block.value)}</Tag>;
          }
          // 글자 크기는 호출부가 정한다 — 여기서 text-sm을 박아 두면 댓글(11px 이름 옆),
          // 요약(text-xs 래퍼) 안에서도 14px로 커져서 주변과 어긋났다(실제 지적).
          // 본문은 TaskViewer 래퍼가 text-sm을 준다.
          case 'ul':
            return <ul key={block.key} className="list-disc pl-5 mb-1 space-y-0.5 text-fg leading-relaxed">{block.items.map(it => <li key={it.key} {...ln(it.key)}>{inl(it.value, it.key)}{yt(it.value)}</li>)}</ul>;
          case 'ol':
            return <ol key={block.key} start={block.start || 1} className="list-decimal pl-5 mb-1 space-y-0.5 text-fg leading-relaxed">{block.items.map(it => <li key={it.key} {...ln(it.key)}>{inl(it.value, it.key)}{yt(it.value)}</li>)}</ol>;
          // **빈 줄은 글자 한 줄 높이 · 들여쓰기는 그대로**(사용자 결정 2026-09-25 · 목업 A1 —
          // 편집 화면과 같게). 예전에는 빈 줄이 8px(h-2)이고 앞 공백이 접혀서, 엔터 두 번으로
          // 나눈 문단이 보기에서 붙고 수정↔보기 때 줄이 뛰었다. 빈 줄은 빈 문단 하나라 어느
          // 글자 크기(업무 본문 · 댓글 · 요약)에서도 그 자리의 한 줄이다.
          case 'gap':
            return <p key={block.key} {...ln(block.key)} className="mb-1 text-fg leading-relaxed"><br /></p>;
          default:
            return <p key={block.key} {...ln(block.key)} className="mb-1 text-fg leading-relaxed whitespace-break-spaces">{inl(block.value, block.key)}{yt(block.value)}</p>;
        }
      })}
    </>
  );
});
