import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser, selectTasksList, selectProjectsList } from '../store/selectors.js';
import { Avatar } from '../components/Avatar.jsx';
import { Skeleton } from '../components/media.jsx';
import { loadBibleState } from '../services/word.js';
import { loadBook, loadBibleIndex } from '../services/bible.js';
import { footprintSections, localDayOf } from '../services/homeMoments.js';
import { fetchMyNoteSundays } from '../services/moments.js';
import { formatDay } from '../utils.js';

// ============================================================================
// 홈 안의 한 장 — 한 해의 발자취(views/homeView.jsx에서 갈라 왔다 · 19차). 입구 알약과 기간 판정은
// homeView(homeMoments.footprintYear)에 있고, 여기는 그 장을 그린다. 홈 카드 뼈대도 SkelLine을 같이 쓴다.
// ============================================================================

// ── 한 해의 발자취 — 나만 보는 한 장(창이 아니라 화면 · '홈으로'로 돌아온다) ──────────────
// 제목 '{해}년의 발자취' · 부제 '예수님과 함께 걸어온 한 해' · 구역 넷(사용자 문구 2026-09-25):
// 마음에 남긴 구절(내 형광펜 + 본문) · 다시금 펼치게 된 말씀(북마크한 장) · 예배 노트를 작성한 주일(설교
// 제목만) · 더다붓과 함께한 프로젝트(그 해 내가 담당한 업무의 프로젝트 + 같이 한 얼굴 셋).
// **숫자·합계·순위·공유가 없다**(§8 · 나만 보는 장에 공유를 붙이면 견주는 물건이 된다). 노트·묵상 글은
// 싣지 않는다. 빈 구역은 자리째 서지 않는다. 고르는 규칙은 homeMoments.footprintSections.
// **App의 전역 화면이 아니다** — 홈 안의 한 상태(page)라 GLOBAL_MENUS를 건드리지 않는다.
const FOOT_GLOW = {
  backgroundRepeat: 'no-repeat',
  backgroundImage: [
    'radial-gradient(26rem 10rem at 10% 0%, color-mix(in srgb, var(--app-tag-purple) 80%, transparent), transparent 70%)',
    'radial-gradient(20rem 9rem at 95% 10%, color-mix(in srgb, var(--app-accent-weak) 90%, transparent), transparent 70%)',
  ].join(','),
};
const FootSection = ({ name, title, children }) => (
  <section data-foot={name} className="px-5 pt-3.5 pb-4 border-t border-line">
    <h4 className="mb-2 text-[11.5px] font-bold text-fg-muted">{title}</h4>
    {children}
  </section>
);

export function FootprintPage({ year, onBack, onOpenLink, onNavigate }) {
  const currentUser = useStore(selectCurrentUser);
  const tasks = useStore(selectTasksList);
  const projects = useStore(selectProjectsList);
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [state, notes, books] = await Promise.all([
        loadBibleState().catch(() => null),
        fetchMyNoteSundays(year).catch((e) => { console.warn('[home] 예배 노트를 쓴 주일을 읽지 못했어요:', e); return []; }),
        loadBibleIndex().catch(() => []),
      ]);
      const sec = footprintSections({
        year, highlights: state?.highlights || [], bookmarks: state?.bookmarks || [], notes,
        tasks, projects, myName: currentUser?.name || '',
      });
      // 구절 본문 — 그 책 파일만 받는다(bible.js가 책 단위로 캐시한다). 못 받으면 참조만 선다.
      const nameOf = (id) => books.find(b => b.id === id)?.name || id;
      const passages = await Promise.all(sec.passages.map(async (p) => {
        let text = '';
        try {
          const book = await loadBook(p.bookId);
          text = (book?.chapters?.[p.chapter - 1] || []).slice(p.from - 1, p.to).join(' ');
        } catch { /* 참조만 */ }
        return { ...p, text, label: `${nameOf(p.bookId)} ${p.chapter}:${p.from}${p.to > p.from ? `-${p.to}` : ''}` };
      }));
      const chapters = sec.chapters.map(c => ({ ...c, label: c.label || `${nameOf(c.bookId)} ${c.chapter}장` }));
      if (alive) setData({ ...sec, passages, chapters });
    })().catch(e => { console.error('[home] 발자취를 읽지 못했어요:', e); if (alive) setData({ passages: [], chapters: [], sundays: [], together: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  return (
    <div className="home-screen home-footprint dc-screen pb-8">
      <button type="button" data-foot-back="" onClick={onBack}
        className="inline-flex items-center gap-0.5 h-11 pl-2 pr-3 -ml-2 mb-1 rounded-md text-[13px] font-semibold text-fg-muted hover:bg-surface-hover transition-colors">
        <ChevronLeft size={15} />홈으로
      </button>
      <div className="home-foot-page overflow-hidden rounded-[14px] border border-line bg-surface">
        <header className="px-5 pt-[22px] pb-4" style={FOOT_GLOW}>
          <h2 className="text-[22px] font-extrabold text-fg tracking-[-0.6px]">{`${year}년의 발자취`}</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">예수님과 함께 걸어온 한 해</p>
        </header>
        {!data ? (
          <div className="px-5 pt-3.5 pb-5 border-t border-line space-y-2.5" aria-hidden="true">
            <SkelLine className="text-[13px]" w="72%" /><SkelLine className="text-[13px]" w="58%" /><SkelLine className="text-[13px]" w="64%" />
          </div>
        ) : (
          <>
            {data.passages.length > 0 && (
              <FootSection name="verses" title="마음에 남긴 구절">
                {data.passages.map(p => (
                  <blockquote key={`${p.bookId} ${p.chapter}:${p.from}`} className="m-0 mb-2.5 last:mb-0 pl-3 border-l-2 text-[13px] leading-[1.75] text-fg"
                    style={{ borderColor: 'var(--app-tag-red)' }}>
                    {p.text || null}
                    <cite className="block not-italic mt-0.5 text-[11px] font-bold text-fg-muted">{`${p.label} · ${+localDayOf(p.at).slice(5, 7)}월`}</cite>
                  </blockquote>
                ))}
              </FootSection>
            )}
            {data.chapters.length > 0 && (
              <FootSection name="bookmarks" title="다시금 펼치게 된 말씀">
                {data.chapters.map(c => (
                  <div key={c.ref} className="flex items-baseline gap-2.5 py-1 text-[12.5px] text-fg">
                    <span className="w-16 shrink-0 text-[11.5px] font-bold text-fg-muted">{formatDay(localDayOf(c.at))}</span>
                    <span className="min-w-0 truncate">{c.label}</span>
                  </div>
                ))}
              </FootSection>
            )}
            {data.sundays.length > 0 && (
              <FootSection name="notes" title="예배 노트를 작성한 주일">
                {data.sundays.map(n => (
                  <button key={n.serviceId} type="button" onClick={() => (onOpenLink ? onOpenLink(`/?p=worship&s=${n.serviceId}`) : onNavigate('worship'))}
                    className="w-full flex items-baseline gap-2.5 py-1 text-left text-[12.5px] text-fg hover:text-accent-text transition-colors">
                    <span className="w-16 shrink-0 text-[11.5px] font-bold text-fg-muted">{formatDay(n.date)}</span>
                    <span className="min-w-0 truncate">{n.title || '설교 제목 미정'}</span>
                  </button>
                ))}
              </FootSection>
            )}
            {data.together.length > 0 && (
              <FootSection name="projects" title="더다붓과 함께한 프로젝트">
                {data.together.map(({ project, faces }) => (
                  <button key={project.id} type="button" onClick={() => onNavigate(project.id)}
                    className="w-full flex items-center gap-2.5 py-1.5 text-left text-[12.5px] text-fg hover:text-accent-text transition-colors">
                    <b className="flex-1 min-w-0 truncate font-bold">{project.title}</b>
                    <span className="flex shrink-0">
                      {faces.map((n, i) => (
                        <Avatar key={n} name={n} className={`flex w-[21px] h-[21px] text-[10px] ring-[1.5px] ring-surface ${i ? '-ml-1.5' : ''}`} />
                      ))}
                    </span>
                  </button>
                ))}
              </FootSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 뼈대 한 줄 — 홈 카드 뼈대(homeView CardSkeleton)와 이 장의 읽는 중 자리가 같이 쓴다.
// 줄 높이를 맞추는 방법: 폭 0짜리 글자(U+200B) 하나로 **진짜 줄 상자**를 만들고 뼈대는
// 그 위에 얹는다. 높이를 px로 박으면 글꼴·줄 간격이 바뀔 때마다 어긋난다.
// 뼈대에 위치 유틸리티를 직접 주지 않는 이유는 §6-9-e의 짝이다 — `.dc-skeleton`이
// `position: relative`를 갖고 있어 나중에 오는 그 규칙이 이긴다. 자리는 바깥 span이 잡는다.
export function SkelLine({ className, w }) {
  return (
    <span className={`relative block ${className}`}>
      {'\u200b'}
      <span className="absolute left-0 top-[12%] bottom-[12%]" style={{ width: w }}>
        <Skeleton className="w-full h-full rounded-[5px]" />
      </span>
    </span>
  );
}
