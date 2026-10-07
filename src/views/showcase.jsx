import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CARD, CARD_STYLE } from '../components/groupsParts.jsx';

// ============================================================================
// 홈의 캐릭터 컷(Cut)과 카드 넷 아래의 랜딩 쇼케이스 — views/homeView.jsx에서 갈라 왔다(19차).
// 히어로 컷도 같은 Cut을 쓴다(homeView가 가져간다). 컷 크기·@2x 규칙은 homeView의 HERO_CUT 주석.
// ============================================================================

export const cutSet = (src) => `${src} 1x, ${src.replace(/\.webp$/, '@2x.webp')} 2x`;
// 글이 다 들어온 뒤에 컷이 선다(§4.2) — 그 지연이 이 한 곳이다.
const CUT_DELAY = 280;

// **그림이 도착하기 전에 시작한 모션은 빈 자리에서 끝난다.** 등장 연출(.dc-card)이
// 마운트와 함께 돌면, 느린 회선(모바일)에서는 280+280ms가 지나도록 칸이 비어 있다가
// 그림이 뒤늦게 **툭** 나타났다(사용자 2026-09-06: "확실하게 모바일에서도 캐릭터가 뜨는
// 모션이 잘 적용되게"). 그래서 **도착한 뒤에** 연출을 건다:
//   · 캐시에 이미 있으면(complete) 첫 이펙트에서 바로 — 지연은 그대로 280ms
//   · 늦게 오면 onLoad에서 지연 0으로 — 이미 늦었는데 또 기다릴 이유가 없다
//   · 못 받아도(onError) 숨긴 채로 두지 않는다
// `prefers-reduced-motion`이면 index.css가 .dc-card의 animation을 끄므로 **즉시** 보인다.
// width/height는 그대로 적는다 — 자리 잡기(그림이 늦게 와도 아래 카드가 안 밀린다)는
// 이 연출과 별개다.
export function Cut({ src, w, h, className, eager = false, delay = CUT_DELAY }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  const [wait, setWait] = useState(delay);
  useEffect(() => { if (ref.current?.complete) setShown(true); }, []);
  const reveal = () => setShown(s => { if (!s) setWait(0); return true; });
  return (
    <img
      ref={ref} src={src} srcSet={cutSet(src)} width={w} height={h}
      alt="" aria-hidden="true" draggable="false"
      loading={eager ? 'eager' : 'lazy'} decoding="async"
      {...(eager ? { fetchPriority: 'high' } : {})}
      onLoad={reveal} onError={reveal}
      className={`${className} ${shown ? 'dc-card' : 'opacity-0'}`}
      style={{ animationDelay: `${wait}ms` }}
    />
  );
}

// ── 랜딩 쇼케이스 ───────────────────────────────────────────────────────────
// 카드 넷 아래에 서는 네 블록(예배 · 말씀 · 모임 · 업무). 사용자 요청 2026-09-03 —
// "카드 아래 남는 부분에 랜딩 페이지 같은 인터랙션·모션 그래픽으로 '우리 서비스로
// 이걸 할 수 있다' 느낌." 카드가 **오늘 무엇이 있는지**를 말하고, 이 블록은 **여기서
// 무엇을 할 수 있는지**를 말한다. 그래서 카드가 하나도 없는 날에도 이건 선다.
//
// 숫자를 세지 않는다 — 통계·랭킹은 §1 원칙에서 금지다. 블록은 눌러서 그 화면으로 간다.
//
// **모션은 CSS만으로 돈다.** 자바스크립트 타이머로 프레임을 돌리면 홈이 떠 있는 동안
// 계속 리렌더가 돈다. 키프레임은 `index.css`가 아니라 이 화면이 들고 있다 — 그 파일은
// 이 회차의 소유가 아니어서 건드리지 않았다(옮길 자리는 §4.2의 모션 절이다).
// 규칙은 그대로 지킨다: **transform·opacity만** 움직이고, 색은 토큰만 쓰고,
// `prefers-reduced-motion`이면 전부 멈춘다.
// 문구는 사용자가 준 그대로다(2026-09-03) — 무엇을 할 수 있는지 한 줄이고, 과장·비교가
// 없다(§8). 블록은 **캐릭터 컷 + 제목 + 설명 한 줄**이다.
//
// 모션 그래픽은 만들었다가 **뺐다**(사용자 결정 2026-09-03 — "가독성을 높이든지, 아니면
// 모션 그래픽 자체를 없애자, 그게 나을 것 같다"). 작은 도형이 네 칸에서 각자 돌면
// 시선이 글보다 그쪽으로 가고, 좁은 폭에서는 부품이 서로 겹쳤다. 되살리지 말 것.
//
// 컷은 서로, 그리고 히어로의 sparkle-wave와 겹치지 않게 고른다. 원본 크기(1x)를 함께
// 들고 있는 이유는 width/height로 자리를 미리 잡기 위해서다 — 그림이 늦게 와도 카드가
// 안 밀린다. 실제로 받는 파일은 `srcset`이 화면 배율에 따라 고른다(1x 또는 @2x).
//
// 설명은 **두 도막**이다. 어디서 줄이 나뉘는지를 사용자가 정했다(2026-09-03) — 넓은
// 화면에서 브라우저가 알아서 접으면 '예배 중'과 '예배 노트를' 사이처럼 뜻이 끊기는
// 자리에서 나뉜다. `text-wrap: balance`는 쓰지 않는다(줄 위치가 폭마다 또 달라진다).
// 좁은 화면에서는 `<br>`을 숨겨 한 문장으로 흐르게 두고, 그때는 브라우저가 접는다.
const SHOWCASE = [
  { key: 'worship', to: 'worship', title: '예배', cut: '/chars/heart.webp', w: 187, h: 156,
    desc: ['이번 주 주보를 확인하고', '예배 중 예배 노트를 남겨요'] },
  { key: 'word', to: 'word', title: '말씀', cut: '/chars/book.webp', w: 196, h: 157,
    desc: ['오늘 QT 본문을 읽고', '묵상을 기록해요'] },
  { key: 'groups', to: 'groups', title: '모임', cut: '/chars/coffee.webp', w: 190, h: 153,
    desc: ['우리 순, 우리 동아리의 명단과', '순모임 가이드를 확인해요'] },
  { key: 'work', to: 'dashboard', title: '업무', cut: '/chars/laptop.webp', w: 189, h: 160,
    desc: ['내가 맡은 업무와', '프로젝트를 이어서 진행해요'] },
];

export function Showcase({ onNavigate }) {
  const ref = useRef(null);
  // 스크롤로 내려올 때 한 번 나타난다. 처음부터 세워 두면 카드 넷과 함께 이미 다 서
  // 있어서 '내려오다 만나는' 인상이 없다. **한 번 보이면 관찰을 끊는다** — 오르내릴
  // 때마다 다시 나타나면 스크롤이 덜컹거린다(§4.2 — 순번 지연은 첫 마운트만).
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const ob = new IntersectionObserver((rows) => {
      if (rows.some(r => r.isIntersecting)) { setSeen(true); ob.disconnect(); }
    }, { rootMargin: '-40px' });
    ob.observe(ref.current);
    return () => ob.disconnect();
  }, [seen]);

  return (
    <section className="home-show mt-9 md:mt-11" ref={ref}>
      <h3 className="home-show-title text-[12.5px] font-bold text-fg-muted pb-3">더다붓 워크스페이스에서 할 수 있는 것</h3>
      {/* 1열 → 768px 2열 → 1280px 4열. 1024에서 4열로 가면 한 칸이 230px 남짓이라
          설명 한 줄이 세 줄로 접힌다(사용자 요청 2026-09-03 — 폭마다 예쁘게).
          사이는 12px, 넓은 화면에서 16px. */}
      <div className="home-show-grid grid gap-3 lg:gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SHOWCASE.map(({ key, to, title, desc, cut, w, h }, i) => (
          // 차례는 **컷 → 제목 → 설명 → 모션**이다(사용자 정정 2026-09-03). 컷과 모션은
          // 가로 가운데이고 글은 왼쪽 정렬이다 — 글까지 가운데로 두면 네 블록의 설명
          // 길이가 달라서 줄 시작이 제각각이 된다. 모션은 눌리지 않는다(블록 전체가
          // 버튼이다). 설명 길이가 블록마다 달라 모션 줄의 높이를 맞추려면 설명 칸이
          // 남는 자리를 먹어야 한다 — 그래서 블록은 flex 세로 배치이고 설명이 flex-1이다.
          // 호버에서 살짝 떠오르고 화살표가 오른쪽으로 미끄러진다. **transition에
          // `all`을 주지 않는다**(§6-17-b) — 자리(top/left)까지 전이 대상이 되면
          // 그림자·자리 계산이 겹쳐 미끄러진다. transform·box-shadow만 전이한다.
          // 호버가 없는 기기에서는 화살표가 그냥 제자리에 있고, 그래도 '눌러서 가는
          // 것'이 보인다(§8 — hover로만 나타나는 조작은 만들지 않는다).
          <button
            key={key} type="button" onClick={() => onNavigate(to)}
            // **전이 목록에 `translate`가 들어가야 한다.** 테일윈드 4의 `-translate-y-*`는
            // `transform`이 아니라 독립 속성 `translate`를 쓴다 — `transition-[transform]`만
            // 적어 두면 값은 바뀌는데 전이가 걸리지 않아 툭 튄다(실측: transform은
            // 내내 matrix(1,0,0,1,0,0)이었다). `all`은 쓰지 않는다(§6-17-b).
            className={`home-show-item home-show-${key} group ${seen ? 'dc-card' : 'opacity-0'} relative flex flex-col items-center w-full text-center p-5 lg:p-6 ${CARD} transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elevated active:scale-[.995]`}
            style={{ ...CARD_STYLE, animationDelay: `${i * 70}ms` }}
          >
            <ChevronRight size={14}
              className="home-show-go absolute top-4 right-4 text-fg-faint transition-[translate] duration-200 ease-out group-hover:translate-x-[3px]" />
            {/* 컷도 **도착한 뒤에** 뜬다(위 Cut) — 블록이 먼저 서고 그림 자리만 비는 일이 없게 */}
            <Cut src={cut} w={w} h={h} delay={0}
              className="home-show-cut block w-auto h-[96px] select-none pointer-events-none" />
            {/* 제목은 가운데다. 화살표는 블록 오른쪽 위 — **제목 줄로 옮기지 않는다**
                (사용자 정정 2026-09-03: "화살표를 옮기라고 하진 않았다"). 제목 줄 오른쪽
                끝 규칙은 위 카드 넷에만 해당한다. */}
            <span className="home-show-name block w-full mt-3 text-[15.5px] font-extrabold text-fg tracking-[-0.3px]">{title}</span>
            {/* 설명은 읽는 줄이다 — 줄 간격을 넉넉히 두고(1.7) keep-all로 낱말이 쪼개지지
                않게 한다(body에 걸려 있다). 줄바꿈 자리는 사용자가 정했다(위 SHOWCASE). */}
            <span className="home-show-desc block w-full mt-1.5 text-[13px] leading-[1.7] text-fg-muted">
              <span className="home-show-l1">{desc[0]}</span>
              <br className="hidden sm:inline" />
              <span className="home-show-l2">{` ${desc[1]}`}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
