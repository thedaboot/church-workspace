import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink } from 'lucide-react';
import { BTN_CONFIRM, BTN_CONFIRM_QUIET } from './buttons.js';
import { paperDate, paperRoles } from './paper.jsx';
import { churchSeason } from '../services/churchYear.js';
// **worship.js(supabase)를 부르지 않는다** — 공개 보기(src/serviceViewMain.jsx)가 이 부품을 로그인 없이 그린다
import { splitSongTitle, packPages, storyNotices, nextWeekRoles, realNameText, kindLabel, PRAISE_TEAM } from '../services/serviceView.js';
import { CoverImg, useCoverShown } from './worshipCover.jsx';

// ============================================================================
// 주보 스토리 — '넘기면서 보기' (사용자 결정 2026-09-25 · 목업 mockup-story 권장안)
// ----------------------------------------------------------------------------
// 종이를 대신하지 않는 **또 하나의 보기**다. 폰에서만 들어온다(주보 탭 도구 줄 'PDF로 공유' 옆 ·
// 데스크톱에는 버튼이 없다 — worshipDetail ServicePaper). 장은 이 차례다:
//   표지(절기 줄 · 예배 · 날짜 · 설교 제목 · 설교자) → 말씀(본문을 장 높이로 나눔) → 찬양 →
//   광고(전부 — 제목만 있는 것도 한 줄 · 넘치면 나눔) → 마지막 장(오늘 섬겨준 이들 · 다음 주 예배 위원 ·
//   주보 전체 보기 · 처음부터)
// 예배 순서 장은 없다 — 주보에 순서 칸이 없어서 지어내지 않으면 채울 게 없다(목업 판단).
//
// 넘김: 오른쪽 2/3 누름 = 다음 · 왼쪽 1/3 = 이전 · 옆으로 밀기 · ←→ · Esc = 닫기.
// **자동 넘김은 없다**(본문을 읽는 도중 넘어간다). 위쪽 진행 막대는 자리만 보여 준다.
// **화면 가장자리 20px는 밀기를 받지 않는다** — 카카오 인앱의 뒤로 가기 몸짓과 겹친다(실기기 확인 대상).
// 누르는 자리를 버튼으로 덮지 않고 뿌리에서 x로 가른다 — 그래야 한 장을 넘는 광고·절이 그 장 안에서
// 세로로 내려간다(덮개 버튼이 손가락을 먹으면 스크롤이 안 된다).
//
// 뒤판·등장은 전면 미리보기 규칙(검정 80% · 150ms — HANDOFF §8 D9), 모션을 끈 사람에게는 걸지 않는다.
// 색: 표지만 교회력 색(특별 절기) · 연중은 우리 기본 톤(accent → night) 그라데이션.
// **표지 사진**(0081)이 있으면 사진이 이긴다 — 사진 위 어두운 덮개 + 흰 글자(COVER.photo · index.css `.has-cover`). 나머지 장은 앱
// 토큰이라 라이트·다크를 따라간다 — 종이와 달리 인쇄물이 아니라 화면이다.
// 이름은 명단 본명 + 호칭이다(부르는 쪽의 nameOf · serviceView.realNameOf).
// ============================================================================

const EDGE = 20;          // 밀기를 받지 않는 가장자리(px)
const SWIPE = 40;         // 이만큼 옆으로 가야 밀기다
// 표지 — 특별 절기는 그 절기의 짙은 색, 연중은 우리 기본 톤. 두 테마 같은 값(--app-night처럼).
const COVER = {
  purple: { bg: 'linear-gradient(165deg, #5a4a97 0%, #3b2f6c 100%)', ink: '#ffffff', bar: 'rgba(255,255,255,.28)', barOn: '#fff' },
  gold: { bg: 'linear-gradient(165deg, #f6eedb 0%, #e9dcbc 100%)', ink: '#4f3b1a', bar: 'rgba(79,59,26,.2)', barOn: '#4f3b1a' },
  red: { bg: 'linear-gradient(165deg, #9a4038 0%, #6f2b25 100%)', ink: '#ffffff', bar: 'rgba(255,255,255,.28)', barOn: '#fff' },
  plain: { bg: 'linear-gradient(160deg, #3f6fc4 0%, #213183 78%)', ink: '#ffffff', bar: 'rgba(255,255,255,.28)', barOn: '#fff' },
  photo: { bg: '#141620', ink: '#ffffff', bar: 'rgba(255,255,255,.32)', barOn: '#fff' },
};
// 12px 아래로 내려갈 수 있는 글은 muted로 칠한다(HANDOFF §8 D9 — faint는 12px 이상에만) ·
// 최소 10px(max()로 바닥을 둔다 — 장 글자 크기가 화면 높이를 따라가므로)
const LAB = { fontSize: 'max(10px, .68em)', fontWeight: 800, letterSpacing: '.06em', color: 'var(--app-ink-muted)' };
const CARD_PAD = { padding: '4.6em 1.35em 1.6em' };

function StoryHead({ label, right, accent = false }) {
  return (
    <div className="story-head flex items-baseline justify-between gap-[.6em] pb-[.7em] mb-[.9em] shrink-0"
      style={{ borderBottom: '1px solid var(--app-line)' }}>
      <span style={LAB}>{label}</span>
      {right ? (
        <span className={accent ? 'text-accent-text' : 'text-fg-muted'}
          style={{ fontSize: accent ? '.78em' : 'max(10px, .68em)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{right}</span>
      ) : null}
    </div>
  );
}

// 절 하나 · 광고 하나 — 재는 판(probe)과 보이는 판이 **같은 부품**이라야 잰 높이가 맞는다
function VerseItem({ v, showChapter }) {
  return (
    <div className="story-verse">
      {showChapter && <p className="text-fg-muted" style={{ ...LAB, marginBottom: '.35em' }}>{v.chapter}장</p>}
      <p className="flex gap-[.55em] text-fg-secondary" style={{ fontSize: '.94em', lineHeight: 1.72 }}>
        <sup className="text-accent-text shrink-0 text-right"
          style={{ flex: '0 0 1.2em', fontSize: 'max(10px, .6em)', fontWeight: 800, paddingTop: '.55em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{v.verse}</sup>
        <span className="min-w-0 break-words">{v.text}</span>
      </p>
    </div>
  );
}
function NoticeItem({ n, no }) {
  return (
    <div className="story-notice grid gap-[.5em]" style={{ gridTemplateColumns: '1.3em minmax(0,1fr)' }}>
      <span style={{ ...LAB, paddingTop: '.25em' }}>{no}</span>
      <span className="min-w-0">
        {n.title ? <span className="block text-fg break-words" style={{ fontWeight: 800, fontSize: '.94em', letterSpacing: '-.01em' }}>{n.title}</span> : null}
        {String(n.body || '').trim() ? <span className="block text-fg-secondary whitespace-pre-line break-words" style={{ fontSize: '.9em', lineHeight: 1.7 }}>{n.body}</span> : null}
      </span>
    </div>
  );
}

// 한 묶음(절 · 광고)을 장 높이로 나눈다 — 보이지 않는 판에 다 세워 재고 serviceView.packPages로 자른다.
// 높이는 **화면 크기가 바뀔 때 다시** 잰다(폰을 돌리면 장 수가 달라진다).
function useSplit(probeRef, count, deps) {
  const [pages, setPages] = useState(() => (count ? [[0, count]] : []));
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe || !count) { setPages([]); return undefined; }
    const measure = () => {
      const body = probe.querySelector('.story-body');
      if (!body) return;
      const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
      const heights = [...body.children].map(el => el.getBoundingClientRect().height);
      const next = packPages(heights, body.clientHeight, gap);
      setPages(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(probe);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ...deps]);
  return pages;
}

// 공개 보기(src/serviceViewMain.jsx · 2026-09-26)는 같은 부품을 이렇게 부른다: closable=false(닫을 곳이 없다 —
// X·Esc 없음) · onAll = 종이 보기로 · rootClassName으로 데스크톱에서 가운데 세로 판.
export function ServiceStory({ service, verses = [], nameOf, realName, cover: coverPhoto = null, onClose, onAll = null,
  closable = true, rootClassName = '' }) {
  const rootRef = useRef(null);
  const wordProbe = useRef(null);
  const noticeProbe = useRef(null);
  const [i, setI] = useState(0);
  const season = useMemo(() => churchSeason(service?.service_date), [service?.service_date]);
  const photo = useCoverShown(coverPhoto);
  const cover = COVER[photo.shown ? 'photo' : (season?.color || 'plain')];
  const date = paperDate(service?.service_date);
  const kind = kindLabel(service?.kind);
  const songs = Array.isArray(service?.songs) ? service.songs : [];
  const leader = service?.praise_leader || '';
  const notices = useMemo(() => storyNotices(service?.notices), [service?.notices]);
  const roles = useMemo(() => paperRoles(service?.roles), [service?.roles]);
  const nextRoles = useMemo(() => nextWeekRoles(service?.notices), [service?.notices]);
  const who = (name, id = null) => (nameOf ? nameOf(name, id) : name);

  const wordPages = useSplit(wordProbe, verses.length, [verses]);
  const noticePages = useSplit(noticeProbe, notices.length, [notices]);

  const pages = useMemo(() => [
    { kind: 'cover' },
    ...wordPages.map(range => ({ kind: 'word', range })),
    ...(songs.length || leader ? [{ kind: 'songs' }] : []),
    ...noticePages.map(range => ({ kind: 'notices', range })),
    { kind: 'end' },
  ], [wordPages, noticePages, songs.length, leader]);
  const N = pages.length;
  const at = Math.min(i, N - 1);
  const go = useCallback((n) => setI(Math.max(0, Math.min(N - 1, n))), [N]);

  // 열리면 판에 초점을 둔다(←→·Esc가 바로 먹는다)
  useEffect(() => { try { rootRef.current?.focus({ preventScroll: true }); } catch { /* 옛 브라우저 */ } }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (closable) { e.preventDefault(); onClose(); } }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, go, onClose, closable]);

  // 밀기 — 가장자리 20px에서 시작한 것은 받지 않는다. 밀었으면 뒤따르는 click(누름 넘김)을 먹는다.
  const start = useRef(null);
  const swiped = useRef(false);
  const onPointerDown = (e) => {
    // 판 안의 x로 잰다 — 공개 보기의 데스크톱 판은 화면 가운데에 선다
    const r = rootRef.current?.getBoundingClientRect() || { left: 0, width: window.innerWidth };
    const x = e.clientX - r.left;
    start.current = (x < EDGE || x > r.width - EDGE) ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.3) {
      swiped.current = true;
      go(at + (dx < 0 ? 1 : -1));
      setTimeout(() => { swiped.current = false; }, 0);
    }
  };
  // 누름 넘김 — 링크·버튼은 제 일을 한다(유튜브 줄은 눌러도 넘어가지 않는다)
  const onClick = (e) => {
    if (swiped.current) return;
    if (e.target.closest('a, button')) return;
    const r = rootRef.current.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 3 ? at - 1 : at + 1);
  };

  const page = pages[at];
  const tone = page?.kind === 'cover' ? cover : null;

  const renderPage = (p, k) => {
    const on = k === at;
    const base = `story-card absolute inset-0 flex flex-col transition-opacity duration-150 motion-reduce:transition-none ${on ? 'opacity-100 visible' : 'opacity-0 invisible'}`;
    if (p.kind === 'cover') {
      return (
        <section key={k} data-page="cover" aria-hidden={!on} className={`${base} justify-end${photo.shown ? ' has-cover story-cover-photo' : ''}`}
          style={{ ...CARD_PAD, paddingBottom: '1.8em', background: cover.bg, color: cover.ink }}>
          {photo.shown && <CoverImg cover={coverPhoto} focus={service?.cover_focus_y} onFail={photo.onFail} />}
          <div className="flex flex-col gap-[.35em]">
            {season?.name && <span className="story-season" style={{ fontSize: '.74em', fontWeight: 700, letterSpacing: '.02em', opacity: 0.85 }}>{season.name}</span>}
            <span style={{ fontSize: '.92em', fontWeight: 800, letterSpacing: '-.02em' }}>{kind}</span>
            <span style={{ fontSize: '.8em', fontWeight: 300, letterSpacing: '.05em', fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>{date}</span>
            {service?.title && (
              <span className="story-title break-words" style={{ fontSize: '1.95em', fontWeight: 300, letterSpacing: '-.05em', lineHeight: 1.2, marginTop: '1.1em', textWrap: 'balance' }}>{service.title}</span>
            )}
            {(service?.passage_ref || service?.preacher) && (
              <span style={{ fontSize: '.84em', fontWeight: 600, opacity: 0.92, marginTop: '.3em' }}>
                {[service.passage_ref, service.preacher].filter(Boolean).join(' · ')}
              </span>
            )}
            <span className="block h-px" style={{ background: 'currentColor', opacity: 0.3, margin: '1.2em 0 .7em' }} />
            <span style={{ fontSize: 'max(10px, .56em)', fontWeight: 800, letterSpacing: '.24em', opacity: 0.7 }}>THE DABOOT MINISTRY</span>
          </div>
        </section>
      );
    }
    if (p.kind === 'word') {
      const [s, e] = p.range;
      return (
        <section key={k} data-page="word" aria-hidden={!on} className={base} style={CARD_PAD}>
          <StoryHead label="말씀" right={service?.passage_ref} accent />
          <div className="story-body flex-1 min-h-0 overflow-y-auto flex flex-col gap-[.55em]">
            {verses.slice(s, e).map((v, j) => (
              <VerseItem key={`${v.chapter}:${v.verse}`} v={v}
                showChapter={s + j > 0 && v.chapter !== verses[s + j - 1].chapter} />
            ))}
          </div>
        </section>
      );
    }
    if (p.kind === 'songs') {
      return (
        <section key={k} data-page="songs" aria-hidden={!on} className={base} style={CARD_PAD}>
          <StoryHead label="찬양" right={songs.length ? `${songs.length}곡` : ''} />
          <div className="story-body flex-1 min-h-0 overflow-y-auto">
            <p className="text-fg" style={{ fontSize: '1.05em', fontWeight: 800, letterSpacing: '-.02em', marginBottom: '.15em' }}>{PRAISE_TEAM}</p>
            {leader && (
              <p className="flex items-baseline gap-[.45em]" style={{ fontSize: '.84em', marginBottom: '.9em' }}>
                <span style={{ ...LAB, letterSpacing: '.02em' }}>찬양 인도</span>
                <span className="story-leader text-fg">{who(leader)}</span>
              </p>
            )}
            {songs.length > 0 && (
              <ol className="story-songs list-none m-0 p-0">
                {songs.map((song, j) => {
                  const t = splitSongTitle(song.title);
                  const title = t.title || '제목 없는 찬양';
                  return (
                    <li key={j} className="story-song grid gap-[.5em]"
                      style={{ gridTemplateColumns: '1.3em minmax(0,1fr)', padding: '.62em 0', borderTop: '1px solid var(--app-line)',
                        ...(j === songs.length - 1 ? { borderBottom: '1px solid var(--app-line)' } : {}) }}>
                      <span style={{ ...LAB, paddingTop: '.35em', letterSpacing: 0 }}>{j + 1}</span>
                      <span className="min-w-0">
                        {t.team ? <span className="story-song-team block text-fg-muted" style={{ fontSize: 'max(10px, .68em)', fontWeight: 700 }}>{t.team}</span> : null}
                        {song.link ? (
                          <a href={song.link} target="_blank" rel="noreferrer"
                            className="story-song-title inline-flex items-center gap-[.35em] text-fg break-words"
                            style={{ fontSize: '.92em', fontWeight: 600, lineHeight: 1.45 }}>
                            <span className="min-w-0 break-words">{title}</span>
                            <ExternalLink size={12} className="shrink-0 text-accent-text" />
                          </a>
                        ) : (
                          <span className="story-song-title block text-fg break-words" style={{ fontSize: '.92em', fontWeight: 600, lineHeight: 1.45 }}>{title}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      );
    }
    if (p.kind === 'notices') {
      const [s, e] = p.range;
      return (
        <section key={k} data-page="notices" aria-hidden={!on} className={base} style={CARD_PAD}>
          <StoryHead label="광고" />
          <div className="story-body flex-1 min-h-0 overflow-y-auto flex flex-col gap-[1em]">
            {notices.slice(s, e).map((n, j) => <NoticeItem key={s + j} n={n} no={s + j + 1} />)}
          </div>
        </section>
      );
    }
    // 마지막 장
    return (
      <section key={k} data-page="end" aria-hidden={!on} className={base} style={CARD_PAD}>
        <div className="story-body flex-1 min-h-0 overflow-y-auto">
          {roles.length > 0 && (
            <div className="story-served pb-[.9em]">
              <span className="block" style={{ ...LAB, marginBottom: '.6em' }}>오늘 섬겨준 이들</span>
              <dl className="grid m-0 gap-x-[.9em] gap-y-[.45em]" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', fontSize: '.94em' }}>
                {roles.map((r, j) => (
                  <div key={j} className="contents">
                    <dt style={{ ...LAB, letterSpacing: '.02em', paddingTop: '.3em' }}>{r.role}</dt>
                    <dd className="m-0 text-fg break-words" style={{ fontWeight: 600 }}>{who(r.name, r.personId || r.person_id || null)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {nextRoles.length > 0 && (
            <div className="story-next py-[.9em]" style={roles.length ? { borderTop: '1px solid var(--app-line)' } : undefined}>
              <span className="block" style={{ ...LAB, marginBottom: '.6em' }}>다음 주 예배 위원</span>
              <dl className="grid m-0 gap-x-[.9em] gap-y-[.45em]" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', fontSize: '.94em' }}>
                {nextRoles.map((r, j) => (
                  <div key={j} className="contents">
                    <dt style={{ ...LAB, letterSpacing: '.02em', paddingTop: '.3em' }}>{r.role}</dt>
                    <dd className="m-0 text-fg break-words" style={{ fontWeight: 600 }}>{realNameText(r.value, realName)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 pt-3 shrink-0">
          <button type="button" onClick={onAll || onClose} className={`story-close-all w-full ${BTN_CONFIRM}`}>주보 전체 보기</button>
          <button type="button" onClick={() => go(0)} className={`story-restart w-full ${BTN_CONFIRM_QUIET}`}>처음부터</button>
        </div>
      </section>
    );
  };

  return createPortal(
    <div className="worship-story fixed inset-0 z-[100] bg-black/80 motion-safe:animate-in motion-safe:fade-in duration-150 transition-none"
      role="dialog" aria-modal="true" aria-label="넘기면서 보기">
      <div ref={rootRef} tabIndex={-1} data-page={page?.kind} data-index={at}
        className={`story-root absolute inset-0 overflow-hidden outline-none select-none bg-surface text-fg ${rootClassName}`}
        style={{ containerType: 'size', touchAction: 'pan-y' }}
        onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { start.current = null; }}
        onClick={onClick}>
        <div className="absolute inset-0" style={{ fontSize: 'clamp(13px, 2.35cqh, 19px)' }}>
          {pages.map(renderPage)}

          {/* 재는 판 — 보이지 않고 누를 수도 없다. 장과 같은 여백·같은 부품이라 잰 높이가 곧 장의 높이다 */}
          {verses.length > 0 && (
            <div ref={wordProbe} aria-hidden="true" className="story-probe absolute inset-0 flex flex-col invisible pointer-events-none" style={CARD_PAD}>
              <StoryHead label="말씀" right={service?.passage_ref} accent />
              <div className="story-body flex-1 min-h-0 overflow-hidden flex flex-col gap-[.55em]">
                {verses.map((v, j) => <VerseItem key={`${v.chapter}:${v.verse}`} v={v} showChapter={j > 0 && v.chapter !== verses[j - 1].chapter} />)}
              </div>
            </div>
          )}
          {notices.length > 0 && (
            <div ref={noticeProbe} aria-hidden="true" className="story-probe absolute inset-0 flex flex-col invisible pointer-events-none" style={CARD_PAD}>
              <StoryHead label="광고" />
              <div className="story-body flex-1 min-h-0 overflow-hidden flex flex-col gap-[1em]">
                {notices.map((n, j) => <NoticeItem key={j} n={n} no={j + 1} />)}
              </div>
            </div>
          )}

          {/* 위쪽 — 진행 막대(자리만) · 날짜와 예배 · 닫기 */}
          <div className="story-bar absolute left-0 right-0 top-0 z-[3] flex flex-col gap-[.55em] pointer-events-none"
            style={{ padding: '.75em .8em 0' }}>
            <div className="story-segs flex gap-[.25em]">
              {pages.map((_, k) => (
                <i key={k} className="block flex-1 h-[.17em] rounded-full"
                  style={{ background: k <= at ? (tone ? tone.barOn : 'var(--app-ink)') : (tone ? tone.bar : 'var(--app-line)') }} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-[.6em]" style={{ color: tone ? tone.ink : 'var(--app-ink-muted)' }}>
              <span className="truncate" style={{ fontSize: 'max(10px, .7em)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', opacity: tone ? 0.85 : 1 }}>{date} · {kind}</span>
              {closable && (
                <button type="button" onClick={onClose} aria-label="닫기"
                  className="story-x pointer-events-auto relative before:absolute before:-inset-2 grid place-items-center w-8 h-8 -my-2 -mr-1.5 rounded-full">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
