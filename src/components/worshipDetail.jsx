import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink, ClipboardCheck,
  ListMusic, PencilLine, Music, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ShareChip, ShareToggle } from './ShareToggle.jsx';
import { Avatar } from './Avatar.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { keepVisible } from '../utils.js';
import { PassagePicker, PassageBody } from './worshipPassage.jsx';
import { EmptyBookMark } from './wordBible.jsx';
import { objectParticle } from '../services/errorText.js';
import { BTN, WITH_ICON, FIELD } from './groupsParts.jsx';
import { kindLabel, formatServiceDate, attendanceOpen, youtubeThumb } from '../services/worship.js';

// ============================================================================
// 주보 상세 — 말씀 · 담당자 · 찬양 · 광고 + 내 예배 노트 (docs/V2.md 결정 4·5·7)
// ----------------------------------------------------------------------------
// 데이터는 전부 props다. 화면을 눌러 보는 검사(tests/worship.mjs)가 가짜 주보·명단으로
// 이 부품만 그려 볼 수 있게, 통신은 부르는 쪽(worshipView)이 전부 가진다.
//
// 담당자·찬양·광고는 주보 한 건과 언제나 같이 읽고 쓰는 값이라 jsonb 한 칸이다
// (HANDOFF §2-1 · 0036). 그래서 편집은 '행 목록을 통째로 들고 있다가 저장'이고,
// 조인 테이블처럼 행마다 왕복하지 않는다.
//
// 편집 중에는 **저절로 저장된다**(디바운스). 그래서 편집 모드의 오른쪽 버튼은 '취소'가
// 아니라 '목록으로'다 — 이미 저장된 것을 되돌려 주지 못하면서 취소라고 부르면 거짓말이
// 된다. 왼쪽 '저장'은 기다리지 않고 지금 저장하고 보기 모드로 돌아가는 버튼이다.
// 발행은 여전히 명시적으로 누른다(결정 5).
// ============================================================================

const ROW = 'flex items-center gap-1.5';
// 입력칸은 **모임 화면과 같은 한 벌**을 쓴다(groupsParts의 FIELD) — 같은 앱에서
// 칸 생김새가 화면마다 다를 이유가 없다. 여기서 더하는 것은 min-w-0뿐이다(flex 안에서
// 줄어들 수 있게 · §6-9-c).
const INPUT = `min-w-0 ${FIELD}`;
const ICON_BTN = 'p-1.5 rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-30';
const SAVE_DELAY = 900;
// 업무 본문·QT 묵상과 같은 에디터 한 벌. 무거워서 그 화면들처럼 lazy로 들인다
// (첫 번들에 tiptap이 실리지 않게 — modals.jsx·wordView.jsx가 같은 방식이다).
const MarkdownEditor = lazy(() => import('./MarkdownEditor.jsx').then(m => ({ default: m.MarkdownEditor })));
const EditorSkeleton = () => <div className="min-h-40 border border-line rounded-md rounded-t-none dc-skeleton" />;
// 감싸개 클래스도 그 화면들과 같다 — MarkdownEditor는 이 상자의 **빈 자리를 눌러도**
// 문서 끝으로 커서를 보낸다(그 파일의 focusEnd).
const EDITOR_BOX = 'min-h-40 border border-line rounded-md rounded-t-none p-3 bg-surface focus-within:border-accent focus-within:shadow-soft transition-all';
// 목록·편집 줄은 **트랙을 다 쓴다**(사용자 결정 2026-09-05: "다 반응형으로 메워야
// 한다. 모바일·데스크톱 모두 잘 나오게"). 예전에는 46rem 상한이 있었다 — 이름과
// 역할이 화면 양 끝으로 갈라져 보인다는 지적(회차 5 '결정 대기 ⑪')을 폭으로 눌러 둔
// 것이었는데, 그 대가로 1440px에서 오른쪽 40%가 통째로 비었다(§6-9-k와 같은 함정:
// max-w는 트랙 안에 빈 띠를 만든다).
// 갈라짐은 이제 **줄 안의 배치**로 막는다 — 남는 폭은 입력칸이 먹고, 조작 버튼은
// 그 입력칸 바로 옆에 선다(오른쪽 끝에 따로 떨어뜨리지 않는다). 보기 줄도 같은
// 문법이다: 역할 칩과 이름을 붙여 두고 남는 폭은 뒤에 남긴다.
const LIST = 'min-w-0';

const TABS = [
  { id: 'word', label: '말씀' },
  { id: 'roles', label: '담당자' },
  { id: 'songs', label: '찬양' },
  { id: 'notices', label: '광고' },
];

// 저장 상태를 말하는 칩 한 벌. 저절로 저장되는 칸(주보 편집 · 출석 메모)과 눌러서
// 저장하는 칸(내 예배 노트 — 사용자 결정 2026-09-02)이 같은 것을 쓴다.
// state는 '' | 'saving' | 'saved'.
//
// 끝난 것만 **연한 초록 칩**이다(사용자 결정 2026-09-02) — 누르지 않아도 저장되는 화면이라
// 저장이 끝난 순간이 눈에 들어와야 안심이 된다. '저장하는 중'은 지나가는 상태라 무채색이다.
// 라벨은 부르는 쪽이 정한다: 아직 발행 전인 주보는 '임시 저장되었어요'(발행해야 남들이
// 본다는 뜻이 담긴다), 이미 발행된 주보를 고치는 중이면 그 글자가 거짓이 되므로
// '저장되었어요'다.
export function SaveState({ state, savedLabel = '저장되었어요' }) {
  const done = state === 'saved';
  return (
    <span className={`worship-save-state text-[10.5px] ${
      done ? 'px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg font-bold' : 'text-fg-faint'}`}>
      {done ? savedLabel : (state === 'saving' ? '저장하는 중' : '')}
    </span>
  );
}

// 예배 화면의 빈 상태 한 벌 — **마크와 함께 남는 공간의 세로·가로 가운데**(§8 ·
// 사용자 지적 2026-09-02: 글자만 위에 붙어 있으면 아래가 통째로 비어 보인다).
//
// 그림은 **SVG 선 그리기 마크**다. 캐릭터 컷을 잠깐 얹었다가 걷어냈다(사용자 결정
// 2026-09-03: "홈 제외하고는 캐릭터 넣지 말라"). 마크는 새로 그리지 않는다 — 대시보드의
// AllClearMark·EmptyColumnMark는 export가 없으므로, 이미 export된 같은 한 벌인 말씀
// 화면의 EmptyBookMark(펼친 책)를 그대로 쓴다 — 주보·본문 화면이라 그림도 맞는다.
// 안내 줄은 붙이지 않는다(§8) — 마크 아래 한 줄이 전부다.
//
// 남는 공간은 **재서** 차지한다. 46vh 고정값으로 두었더니, 이 자리 위에 무엇이 몇
// 픽셀 서 있는지가 화면마다 달라서(목록 머리줄·상세 도구 줄·탭 줄·모바일 상단 바)
// 1440x900에서는 아래로 274px이 남고 낮은 화면에서는 도리어 넘쳤다 — 글자가 위쪽에
// 붙어 보였다(사용자 지적 2026-09-02). 그래서 스크롤 박스(App의 `main`) 안에서 제
// 자리를 재고 그 아래 남는 만큼을 min-height로 가진다.
//
// **min-height만 준다** — 자기 top은 그대로이므로 재고 나서 다시 잴 일이 없다(그래서
// ResizeObserver도 필요 없다). 창 크기가 바뀔 때만 다시 잰다.
const FILL_MIN = 200;

function useFillRest() {
  const ref = useRef(null);
  const [minH, setMinH] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // 스크롤 박스(App의 main)를 찾는다
    let sc = el.parentElement;
    while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc || sc === document.body) return undefined;

    const measure = () => {
      const cs = getComputedStyle(sc);
      const pt = parseFloat(cs.paddingTop) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      // 스크롤된 상태에서도 같은 답이 나오게 scrollTop을 되돌려 잰다
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - pt;
      // 이 자리 **아래**에 있는 것도 뺀다 — 화면 감싸개의 pb-8이나 그 밑에 오는 노트를
      // 세지 않으면 그만큼 넘쳐서 스크롤이 생긴다. 어느 겹이든 el과 함께 밀리므로
      // 차이(= 그 겹에서 el 아래 남은 만큼)는 min-height를 줘도 그대로다.
      let below = 0;
      for (let node = el; node.parentElement && node.parentElement !== sc; node = node.parentElement) {
        below += node.parentElement.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
      }
      setMinH(Math.max(FILL_MIN, Math.round(sc.clientHeight - pt - pb - top - below)));
    };
    measure();

    // **한 번 재고 끝내면 안 된다.** 마운트 뒤에 위쪽이 바뀌는 일이 있다 — 업무 화면에서
    // 교회 화면으로 넘어오면 프로젝트 탭 줄이 접혀서 main이 39px 커진다. 그때 다시
    // 재지 않으면 그만큼 아래가 빈다(검사가 fill 39px로 잡아냈다).
    // 보는 것은 **스크롤 박스**다 — 우리 min-height는 그 크기를 바꾸지 않으므로
    // 되풀이(재기 → 커짐 → 다시 재기)가 생기지 않는다.
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return [ref, minH];
}

export function WorshipEmpty({ text }) {
  const [ref, minH] = useFillRest();
  return (
    <div ref={ref} className="worship-empty flex flex-col items-center justify-center text-center"
      style={{ minHeight: minH === null ? '46vh' : `${minH}px` }}>
      <EmptyBookMark />
      <p className="mt-3 text-[13.5px] font-semibold text-fg">{text}</p>
    </div>
  );
}

// 배열 한 칸 옮기기 (담당자·찬양·광고 공용). 끝에서는 그대로 둔다.
const moveAt = (list, from, to) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
};

// 저장에 실제로 실리는 칸만 추린다 — 보기 값(status·created_at)까지 되돌려 보내지 않는다
const patchOf = (d) => ({
  title: d.title || null, passage_ref: d.passage_ref || null, preacher: d.preacher || null,
  roles: d.roles || [], songs: d.songs || [], notices: d.notices || [],
});

// ── 보기 ─────────────────────────────────────────────────────────────────────
function WordTab({ service, onOpenBible }) {
  const has = service.title || service.passage_ref || service.preacher;
  if (!has) return <WorshipEmpty text="설교 제목과 본문 구절을 아직 적지 않았어요" />;
  // 구절은 누르면 성경 읽기의 그 장으로 간다(App.jsx의 openBible → WordView initialRef).
  const ref = service.passage_ref;
  return (
    <div>
      {service.title && <h3 className="text-[16px] font-extrabold text-fg tracking-[-0.3px]">{service.title}</h3>}
      <p className="mt-1 text-[12px] text-fg-muted">
        {ref && (onOpenBible
          ? <button type="button" onClick={() => onOpenBible(ref)}
              className="worship-open-bible underline decoration-dotted underline-offset-2 hover:text-fg transition">{ref}</button>
          : ref)}
        {ref && service.preacher && ' · '}
        {service.preacher}
      </p>
      <PassageBody refStr={service.passage_ref} />
    </div>
  );
}

function RolesTab({ rows, people }) {
  const byId = useMemo(() => new Map((people || []).map(p => [p.id, p])), [people]);
  if (!rows.length) return <WorshipEmpty text="담당자를 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((r, i) => {
        const person = r.personId || r.person_id ? byId.get(r.personId || r.person_id) : null;
        const name = person?.name || r.name || '';
        return (
          <li key={i} className="worship-role-row flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
            <span className={NUM}>{i + 1}</span>
            {/* 계정이 이어진 사람만 사진이 있다 — 나머지는 이름 글자 원이다(§4.7) */}
            <Avatar name={name} {...(person?.profile_id ? {} : { url: null })} className="flex w-7 h-7 text-[12px] shrink-0" />
            {/* 역할은 편집 줄과 같은 자리·같은 칩이다. 예전에는 오른쪽 끝에 밀어 뒀는데,
                폭 상한을 걷어내니 이름과 역할이 화면 양 끝으로 갈라졌다(회차 5 지적의
                재발). 붙여 두면 어느 폭에서도 '누가 무엇을' 한 눈에 읽힌다. */}
            {r.role && <span className={`${ROLE_VIEW} shrink-0`}>{r.role}</span>}
            <span className="min-w-0 text-[13px] font-semibold text-fg truncate">{name || '이름 없음'}</span>
            <span className="flex-1" />
          </li>
        );
      })}
    </ul>
  );
}

const ROW_LINE = { borderBottom: '1px solid var(--app-line)' };
const CARD_BOX = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };
const NUM = 'w-5 shrink-0 text-[11px] font-bold text-fg-faint tabular-nums';
// 보기 줄의 역할 칩 — 편집 줄의 ROLE_CHIP과 같은 색·같은 모양이되 입력칸이 아니다
// (누를 수 없는 것에 focus 스타일을 달아 두면 눌러 보게 된다).
const ROLE_VIEW = 'px-2.5 py-0.5 rounded-full bg-accent-weak text-accent-text text-[11.5px] font-semibold';

// 유튜브 썸네일 — **키도 서버 함수도 필요 없다**(i.ytimg.com 공개 주소, services의
// youtubeThumb). 그래서 게스트·로컬에서도 그림이 뜬다. 못 받으면(비공개 영상·인터넷
// 없음) 음표 아이콘으로 떨어진다 — 깨진 그림 자리를 남기지 않는다.
// lazy 로딩이라 목록이 길어도 보이는 것만 받는다.
function SongThumb({ link, big = false }) {
  const [failed, setFailed] = useState(false);
  const src = youtubeThumb(link);
  const box = big ? 'w-16 h-9' : 'w-10 h-6';
  if (!src || failed) {
    return (
      <span className={`worship-song-thumb-fallback ${box} shrink-0 inline-flex items-center justify-center rounded-[5px]`}
        style={{ background: 'var(--app-surface-hover)' }}>
        <Music size={big ? 13 : 11} className={link ? 'text-accent-text' : 'text-fg-faint'} />
      </span>
    );
  }
  return (
    <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)}
      className={`worship-song-thumb ${box} shrink-0 rounded-[5px] object-cover`}
      style={{ background: 'var(--app-surface-hover)' }} />
  );
}

// 찬양 — 링크가 있으면 **제목 자체가 링크**다(사용자 지적 2026-09-03: 줄 나열이 밋밋).
// 예전에는 오른쪽 끝에 '듣기'가 따로 있어서 눌러야 할 것이 두 군데로 갈렸다.
function SongsTab({ rows }) {
  if (!rows.length) return <WorshipEmpty text="찬양을 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((s, i) => (
        <li key={i} className="worship-song-view flex items-center gap-2.5 py-2.5" style={ROW_LINE}>
          <span className={NUM}>{i + 1}</span>
          <SongThumb link={s.link} big />
          {s.link ? (
            <a href={s.link} target="_blank" rel="noreferrer"
              className="worship-song-link min-w-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-text hover:underline break-words">
              <span className="min-w-0 break-words">{s.title || '제목 없는 찬양'}</span>
              <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : (
            <span className="min-w-0 text-[13px] text-fg break-words">{s.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// 광고 한 건 — 제목은 굵게, 본문은 두 줄에서 접는다(긴 광고 셋이면 화면을 다 먹었다).
// 접힘 여부는 **실제로 넘쳤을 때만** 묻는다 — 한 줄짜리 광고에 '펼치기'가 붙으면
// 누를 것이 없는 버튼이 된다.
function NoticeCard({ notice, index }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const bodyRef = useRef(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) setOver(el.scrollHeight - el.clientHeight > 2);
  }, [notice.body]);
  return (
    <li className="worship-notice-card p-3 md:p-4 rounded-[10px]" style={CARD_BOX}>
      <div className="flex items-start gap-2">
        <span className={`${NUM} pt-0.5`}>{index + 1}</span>
        <p className="worship-notice-title min-w-0 flex-1 text-[13.5px] font-bold text-fg break-words">{notice.title || '제목 없는 광고'}</p>
      </div>
      {notice.body && (
        <div className="mt-1 pl-7">
          <p ref={bodyRef}
            className={`worship-notice-body text-[12.5px] leading-relaxed text-fg-secondary whitespace-pre-line break-words ${open ? '' : 'line-clamp-2'}`}>
            {notice.body}
          </p>
          {(over || open) && (
            <button type="button" onClick={() => setOpen(o => !o)}
              className="worship-notice-more mt-1 text-[11.5px] font-semibold text-accent-text hover:underline">
              {open ? '접기' : '펼치기'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function NoticesTab({ rows }) {
  if (!rows.length) return <WorshipEmpty text="광고를 아직 적지 않았어요" />;
  return (
    <ul className={`${LIST} space-y-2`}>
      {rows.map((n, i) => <NoticeCard key={i} notice={n} index={i} />)}
    </ul>
  );
}

// ── 편집 ─────────────────────────────────────────────────────────────────────
// 순서 버튼은 언제나 보인다 — hover로 숨기면 터치 기기에서 그 기능이 없는 것과 같다(§8).
function RowTools({ index, total, onMove, onRemove, what }) {
  return (
    <>
      <button type="button" className={ICON_BTN} disabled={index === 0} title="위로"
        aria-label={`${what} 위로`} onClick={() => onMove(index, index - 1)}><ChevronUp size={13} /></button>
      <button type="button" className={ICON_BTN} disabled={index === total - 1} title="아래로"
        aria-label={`${what} 아래로`} onClick={() => onMove(index, index + 1)}><ChevronDown size={13} /></button>
      <ConfirmPopover className="shrink-0 inline-flex" title={`${what} 삭제`}
        message={`이 ${what}${objectParticle(what)} 삭제할까요?`} onConfirm={() => onRemove(index)}>
        <button type="button" aria-label={`${what} 삭제`}
          className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors">
          <Trash2 size={13} />
        </button>
      </ConfirmPopover>
    </>
  );
}

// 새 줄은 **목록 끝의 점선 카드**로 더한다 — 목록에 섞인 작은 버튼은 줄 하나처럼
// 보여서 눌러야 할 자리로 읽히지 않았다(사용자 지적 2026-09-03).
const AddCard = ({ label, onClick }) => (
  <button type="button" onClick={onClick}
    className="worship-add-card mt-2.5 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-[10px] text-[11.5px] font-semibold text-fg-muted hover:text-fg hover:bg-surface-hover transition active:scale-[.995]"
    style={{ border: '1px dashed var(--app-line)' }}>
    <Plus size={13} /> {label}
  </button>
);

// 역할은 칩 모양 입력칸이다 — 이름 칸과 생김새를 다르게 둔다
const ROLE_CHIP = 'text-[12px] font-semibold px-2.5 py-1.5 rounded-full bg-accent-weak text-accent-text outline-none focus:shadow-soft placeholder:font-normal transition-all';

// 칸마다 이름을 붙인다 — 자리 글(placeholder)만 있으면 '흔들리지 않는 기쁨'이
// 무엇의 예시인지 알 수 없었다(사용자 지적 2026-09-02). 라벨은 사용법 안내가 아니라
// **그 칸이 무엇을 받는 칸인지**라 §8의 '안내 줄 금지'와 다르다.
const Field = ({ label, children, wide = false }) => (
  <div className={`worship-field min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
    <span className="worship-field-label block mb-1 text-xs text-fg-muted">{label}</span>
    {children}
  </div>
);

function WordEdit({ draft, set }) {
  return (
    <div className={`worship-word-edit ${LIST} grid gap-3 sm:grid-cols-2`}>
      <Field label="설교 제목">
        <input className={`${INPUT} w-full`} value={draft.title || ''} onChange={e => set({ title: e.target.value })}
          aria-label="설교 제목" placeholder="예: 흔들리지 않는 기쁨" />
      </Field>
      <Field label="설교자">
        <input className={`${INPUT} w-full`} value={draft.preacher || ''} onChange={e => set({ preacher: e.target.value })}
          aria-label="설교자" placeholder="예: 임성빈 전도사님" />
      </Field>
      <Field label="본문 구절" wide>
        <PassagePicker value={draft.passage_ref || ''} onChange={v => set({ passage_ref: v })} />
      </Field>
      {/* 고르는 대로 아래에 본문이 펼쳐진다 */}
      <div className="sm:col-span-2 min-w-0"><PassageBody refStr={draft.passage_ref} /></div>
    </div>
  );
}

// 담당자 사람 칸 — 이름 입력 하나로 명단 고르기와 자유 이름을 겸한다(사용자 결정).
// 치면 명단이 뜨고(방향키·Enter), 고르면 person이 연결된다. 명단에 없는 사람(외부 강사
// 같은)은 적은 글자가 그대로 남는다 — 0036의 roles jsonb가 둘 다 받는다.
// 담당자 지정(modals의 AssigneePicker)과 같은 톤이되, 그쪽은 목록 밖 이름을 막는다는
// 점만 다르다(업무 배정은 계정이 있어야 뜻이 있고, 주보 담당자는 이름만으로도 뜻이 있다).
function PersonNameInput({ row, people, onPick }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);
  const name = row.name || '';
  const linked = useMemo(
    () => (row.personId ? (people || []).find(p => p.id === row.personId) : null),
    [row.personId, people],
  );

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    const all = [...(people || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    return q ? all.filter(p => String(p.name).toLowerCase().includes(q)) : all;
  }, [name, people]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (p) => { onPick({ name: p.name, personId: p.id }); setOpen(false); setActiveIdx(0); };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[activeIdx] ?? suggestions[0]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="worship-person relative flex-1 basis-40 min-w-0" ref={rootRef}>
      <div className="flex items-center gap-1.5 border border-line rounded-xs bg-surface px-2 py-1 focus-within:border-accent focus-within:shadow-soft transition-all">
        {/* 명단에 이어진 사람만 동그라미가 붙는다 — 연결됐다는 표시를 겸한다 */}
        {linked && <Avatar name={linked.name} {...(linked.profile_id ? {} : { url: null })} className="flex w-5 h-5 text-[10px] shrink-0" />}
        <input
          value={name} aria-label="이름" placeholder="이름"
          // 글자를 고치면 연결은 풀린다 — 이름과 사람이 어긋난 채로 남지 않게(§6-26)
          onChange={e => { onPick({ name: e.target.value, personId: null }); setOpen(true); setActiveIdx(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-fg-faint outline-none py-0.5"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="worship-person-list absolute left-0 top-full z-50 mt-1 w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 animate-in fade-in zoom-in-95 duration-150">
          {suggestions.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={e => { e.preventDefault(); choose(p); }}
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <Avatar name={p.name} {...(p.profile_id ? {} : { url: null })} className="flex w-5 h-5 text-[10px] shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 편집 줄의 도구(순서·삭제) — **언제나 보인다.** hover로만 나타나게 하지 않는다(§8:
// 터치 기기에는 hover가 없어서 그 기능이 아예 없는 것처럼 보인다 — 이 화면에서 이미
// 그렇게 정했다). 사용자 요청은 'hover 시 노출'이었지만 그 규칙과 부딪히므로, 평소엔
// 연하게 두고 줄에 손이 닿으면 진해지는 쪽으로 했다(보고서에 적어 둠).
const TOOLS = 'text-fg-faint group-hover:text-fg-muted transition-colors';

function RolesEdit({ rows, people, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((r, i) => (
          <li key={i} className="worship-role-edit group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 역할은 칩처럼 — 이름 칸과 생김새가 같으면 어느 쪽이 무엇인지 매번 읽어야 한다 */}
            <input className={`${ROLE_CHIP} w-[7rem] shrink-0`} value={r.role || ''} aria-label="역할"
              onChange={e => set(i, { role: e.target.value })} placeholder="예: 대표기도" />
            {/* 이름 칸이 남는 폭을 먹는다(flex-1) — 그래서 넓은 화면에서도 도구는
                입력칸 **바로 옆**에 붙어 서고, ml-auto는 좁은 화면에서 도구만 다음
                줄로 접혔을 때 오른쪽에 세우는 용도로만 남는다 */}
            <PersonNameInput row={r} people={people} onPick={v => set(i, v)} />
            <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
              <RowTools index={i} total={rows.length} what="담당자"
                onMove={(a, b) => onChange(moveAt(rows, a, b))}
                onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
            </span>
          </li>
        ))}
      </ul>
      <AddCard label="담당자 추가" onClick={() => onChange([...rows, { role: '', personId: null, name: '' }])} />
    </div>
  );
}

function SongsEdit({ rows, onChange, onPullPlaylist, onLookupTitle }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(() => new Set());   // 제목을 받아 오는 중인 줄
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const pull = async () => {
    if (busy || !url.trim() || !onPullPlaylist) return;
    setBusy(true);
    const next = await onPullPlaylist(url, rows);
    setBusy(false);
    if (next) { onChange(next); setUrl(''); }
  };

  // 링크를 다 적은 뒤(칸을 떠날 때) 한 번만 물어본다 — 글자마다 물으면 한 곡에
  // 스무 번을 부르게 된다. 받는 동안 그 줄의 제목 칸은 스켈레톤이다(빈 칸을 그대로
  // 두면 아무 일도 안 일어나는 것처럼 보인다 · 사용자 결정 2026-09-03).
  const fillTitle = async (i, s) => {
    if (!onLookupTitle || (s.title || '').trim() || !(s.link || '').trim()) return;
    setLooking(prev => new Set(prev).add(i));
    const title = await onLookupTitle(s.link);
    setLooking(prev => { const n = new Set(prev); n.delete(i); return n; });
    if (title) set(i, { title });
  };

  return (
    <div className={LIST}>
      {/* 목록 도구 줄 — 주소 칸은 넓게, 가져오기는 오른쪽 끝에 */}
      <div className="worship-song-import flex flex-wrap items-center gap-1.5 pb-2.5">
        <input className={`${INPUT} flex-1 basis-full sm:basis-0 min-w-0`} value={url} aria-label="유튜브 재생목록 주소"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pull(); } }}
          placeholder="예: https://www.youtube.com/playlist?list=..." />
        <button type="button" onClick={pull} disabled={busy || !url.trim()}
          className="worship-song-pull shrink-0 ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ListMusic size={13} />}
          {busy ? '가져오는 중' : '유튜브 재생목록에서 가져오기'}
        </button>
      </div>
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((s, i) => (
          <li key={i} className="worship-song-row group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 제목을 받아 오는 중이면 그 자리를 스켈레톤 한 줄이 지킨다 */}
            {looking.has(i) ? (
              <span className="worship-song-title-loading basis-full sm:basis-0 sm:flex-1 min-w-0 h-[30px] rounded-xs dc-skeleton" />
            ) : (
              <input className={`${INPUT} basis-full sm:basis-0 sm:flex-1 min-w-0`} value={s.title || ''} aria-label="찬양 제목"
                onChange={e => set(i, { title: e.target.value })} placeholder="예: 주 은혜임을" />
            )}
            {/* 링크 칸 앞에는 작은 썸네일 — 어느 영상인지 눈으로 확인된다 */}
            <span className="worship-song-linkbox flex items-center gap-1.5 flex-1 basis-40 sm:basis-0 min-w-0 border border-line rounded-xs bg-surface px-1.5 py-1 focus-within:border-accent transition-colors">
              <SongThumb link={s.link} />
              <input className="flex-1 min-w-0 bg-transparent text-[13px] py-0.5 outline-none text-fg placeholder:text-fg-faint"
                value={s.link || ''} aria-label="찬양 링크"
                onChange={e => set(i, { link: e.target.value })} onBlur={() => fillTitle(i, s)} placeholder="유튜브 링크(선택)" />
            </span>
            <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
              <RowTools index={i} total={rows.length} what="찬양"
                onMove={(a, b) => onChange(moveAt(rows, a, b))}
                onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
            </span>
          </li>
        ))}
      </ul>
      {/* 가져오는 중 — 새로 들어올 자리를 스켈레톤이 지킨다(몇 줄이 늘지 눈에 보인다) */}
      {busy && (
        <ul className="worship-song-loading">
          {[0, 1, 2].map(k => (
            <li key={k} className="flex items-center gap-1.5 py-2.5" style={ROW_LINE}>
              <span className={NUM}>{rows.length + k + 1}</span>
              <span className="w-10 h-6 shrink-0 rounded-[5px] dc-skeleton" />
              <span className="flex-1 h-[30px] rounded-xs dc-skeleton" />
            </li>
          ))}
        </ul>
      )}
      <AddCard label="찬양 추가" onClick={() => onChange([...rows, { title: '', link: '' }])} />
    </div>
  );
}

// 광고는 카드 한 장에 라벨 붙은 칸 둘이다 — 줄로 늘어놓으면 어느 제목에 딸린 본문인지
// 눈으로 이어야 했다(사용자 지적 2026-09-03).
//
// 넓은 폭에서 **2열로 놓지 않고 한 열로 폭을 채운다**(사용자가 "판단해서 한 가지로"라고
// 맡긴 자리 · 2026-09-05). 2열이면 광고가 한 건일 때 카드가 왼쪽 절반만 차지해서 지금
// 고치고 있는 '오른쪽이 빈다'가 그대로 되살아나고, 번호가 붙은 순서 목록이 좌우로 흘러
// 읽는 순서가 흐려진다. 대신 제목 칸과 내용 textarea가 카드 폭을 다 쓴다.
function NoticesEdit({ rows, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      <ul className="space-y-2">
        {rows.map((n, i) => (
          <li key={i} className="worship-notice-row group p-3 md:p-4 rounded-[10px]" style={CARD_BOX}>
            <div className="flex items-center gap-1.5 pb-1.5">
              <span className="text-[11.5px] font-bold text-fg-muted tabular-nums">광고 {i + 1}</span>
              <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
                <RowTools index={i} total={rows.length} what="광고"
                  onMove={(a, b) => onChange(moveAt(rows, a, b))}
                  onRemove={k => onChange(rows.filter((_, x) => x !== k))} />
              </span>
            </div>
            <div className="grid gap-2.5">
              <Field label="제목">
                <input className={`${INPUT} w-full`} value={n.title || ''} aria-label="광고 제목"
                  onChange={e => set(i, { title: e.target.value })} placeholder="예: 겨울 수련회 신청" />
              </Field>
              <Field label="내용">
                <textarea className={`${INPUT} w-full resize-y min-h-[3.5rem]`} value={n.body || ''} aria-label="광고 내용"
                  onChange={e => set(i, { body: e.target.value })} placeholder="예: 1월 20일까지 순장에게 신청해주세요" />
              </Field>
            </div>
          </li>
        ))}
      </ul>
      <AddCard label="광고 추가" onClick={() => onChange([...rows, { title: '', body: '' }])} />
    </div>
  );
}

// ── 내 예배 노트 ─────────────────────────────────────────────────────────────
// 예배마다 한 건, 기본은 나만 본다. 남의 노트는 여기 오지 않는다(결정 7).
//
// **말씀의 내 묵상과 같은 부품·같은 순서다**(사용자 재강조 2026-09-03) — 칩과 공유
// 세그먼트는 components/ShareToggle.jsx 한 벌이고 라벨만 이 화면 것이다: 편집기 아래에
// `[저장] … [나만 보기 | 순에 공유하기]`. 글은 저장 버튼으로만 나가고(빈 노트는 저장할
// 것이 없으니 버튼이 잠긴다), **공유는 저장된 노트의 상태만 그 자리에서 바꾼다** —
// 같이 올리면 저장을 누르지 않았는데 글이 나가 버린다. 아직 저장한 것이 없으면
// 공유할 것도 없으므로 세그먼트가 잠긴다.
function MyNote({ note, onSave, onShare }) {
  const [body, setBody] = useState(note?.body || '');
  const [state, setState] = useState('');         // '' | 'saving' | 'saved'  (저장 버튼)
  const [shareState, setShareState] = useState(''); // '' | 'saving' | 'saved'  (공유 칩)
  const [busy, setBusy] = useState(false);

  const saved = !!note;
  const shared = !!note?.shared_to_sun;
  // 저장된 글과 다를 때만 저장할 것이 있다. 빈 노트는 저장하지 않는다(사용자 결정)
  const hasText = !!String(body || '').replace(/\s/g, '');
  const dirty = body !== (note?.body || '');

  useEffect(() => { setBody(note?.body || ''); }, [note]);

  const save = async () => {
    if (busy || !hasText || !dirty) return;
    setBusy(true); setState('saving'); setShareState('');
    const ok = await onSave({ body, sharedToSun: shared });
    setBusy(false); setState(ok ? 'saved' : '');
  };

  // 공유만 바꾼다 — 글은 저장된 것을 그대로 둔다(편집 중인 글은 건드리지 않는다).
  // onShare는 부르는 쪽이 services의 setNoteShared로 잇는다(모임 화면도 같은 함수를 쓴다).
  const setShare = async (v) => {
    if (!saved || v === shared || shareState === 'saving') return;
    setShareState('saving'); setState('');
    const ok = onShare ? await onShare(v) : await onSave({ body: note?.body || '', sharedToSun: v });
    setShareState(ok ? 'saved' : '');
  };

  return (
    <section className="worship-note mt-7">
      <div className="flex items-center gap-2 pb-2.5">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">내 예배 노트</h3>
        <span className="flex-1 h-px" style={{ background: 'var(--app-line)' }} />
        {/* 노트는 발행이라는 것이 없다 — 저장되면 그것으로 끝이라 '임시'가 아니다 */}
        <SaveState state={state} />
      </div>
      {/* 업무 본문·QT 묵상과 같은 편집기(서식 바 포함, 저장 값은 마크다운 문자열) */}
      <div className="worship-note-editor">
        <Suspense fallback={<EditorSkeleton />}>
          <MarkdownEditor
            value={body}
            onChange={(v) => { setState(''); setBody(v); }}
            placeholder="오늘 말씀에서 마음에 남은 것"
            className={EDITOR_BOX}
          />
        </Suspense>
      </div>
      {/* 확정 왼쪽(§8) · 공유 세그먼트는 오른쪽. 좁은 폭에서는 줄을 바꾼다 */}
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        <button type="button" onClick={save} disabled={!dirty || !hasText || busy} className={`worship-note-save ${BTN}`}>저장</button>
        <ShareChip state={shareState} label={shared ? '우리 순에 공유할게요' : '나만 볼게요'} />
        <span className="flex-1" />
        <ShareToggle value={shared} disabled={!saved || busy} onChange={setShare} shareLabel="순에 공유하기" />
      </div>
    </section>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
export function ServiceDetail({
  service, people = [], perms = {}, note = null, canWriteNote = false, startEditing = false,
  onBack, onSave, onPublish, onDelete, onSaveNote, onOpenAttendance, onOpenBible,
  onPullPlaylist, onLookupTitle, onShareNote,
}) {
  const [tab, setTab] = useState('word');
  const [draft, setDraft] = useState(null);     // null이면 보기 모드
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved'
  const dirty = useRef(false);
  const editing = draft !== null;
  const shown = editing ? draft : service;
  const rows = (k) => (Array.isArray(shown?.[k]) ? shown[k] : []);
  const set = (patch) => { dirty.current = true; setDraft(d => ({ ...d, ...patch })); };

  const draftOf = (s) => ({
    ...s,
    roles: Array.isArray(s?.roles) ? s.roles : [],
    songs: Array.isArray(s?.songs) ? s.songs : [],
    notices: Array.isArray(s?.notices) ? s.notices : [],
  });

  // 만들자마자 수정 화면으로 들어온다(사용자 결정) — 새 주보는 열자마자 빈 칸이라
  // '수정'을 한 번 더 누르게 할 이유가 없다.
  useEffect(() => {
    dirty.current = false; setSaveState(''); setTab('word');
    setDraft(startEditing && perms.canEdit ? draftOf(service) : null);
    // 주보가 바뀔 때만 — startEditing은 그때 부르는 쪽이 정해서 넘긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  // 편집 중에는 저절로 저장된다(사용자 결정) — 노트·출석 메모와 같은 디바운스다.
  useEffect(() => {
    if (!editing || !dirty.current) return undefined;
    const t = setTimeout(async () => {
      setSaveState('saving');
      const ok = await onSave(patchOf(draft));
      setSaveState(ok ? 'saved' : '');
      if (ok) dirty.current = false;
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, editing, onSave]);

  if (!service) return null;
  const isDraft = service.status !== 'published';
  const canAttend = perms.canCheck && attendanceOpen(service);

  // 기다리지 않고 지금 저장하고 보기 모드로
  const saveNow = async () => {
    setBusy(true);
    setSaveState('saving');
    const ok = await onSave(patchOf(draft));
    setBusy(false);
    setSaveState(ok ? 'saved' : '');
    if (ok) { dirty.current = false; setDraft(null); }
  };

  // 편집 중에 나가면 아직 안 넘어간 글자를 먼저 넘긴다(디바운스가 씹히지 않게)
  const leave = async () => {
    if (editing && dirty.current) { dirty.current = false; await onSave(patchOf(draft)); }
    onBack();
  };

  return (
    <div className={`worship-detail dc-screen ${editing && perms.canEdit ? 'pb-24 md:pb-10' : 'pb-10'}`}>
      {/* 상시 도구 줄 — 나가기와 발행. **편집 확정(저장·삭제)은 여기 없다** —
          데스크톱은 머리줄 오른쪽, 모바일은 화면 아래 고정 줄로 갔다(사용자 결정
          2026-09-03: 편집 도구 줄이 한눈에 읽히지 않았다). §8의 '확정 왼쪽 / 나가기
          오른쪽'은 각 줄 안에서 그대로다. */}
      <div className="flex items-center gap-1.5 mb-4">
        {perms.canEdit && !editing && isDraft && (
          <ConfirmPopover tone="ok" confirmLabel="발행하기" message="발행하면 모두가 이 주보를 볼 수 있어요."
            onConfirm={onPublish}>
            <button type="button"
              className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">발행하기</button>
          </ConfirmPopover>
        )}
        <span className="flex-1" />
        <button type="button" onClick={leave}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">
          <ArrowLeft size={13} /> 목록으로
        </button>
      </div>

      {/* 머리줄 — 왼쪽에 종류·날짜, 오른쪽에 출석 체크(사용자 지적: 아래에 두니 공백이 남았다) */}
      <header className="flex items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(service.kind)}</span>
          {isDraft && <span className="worship-draft-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>}
          <span className="text-[11.5px] text-fg-muted">{formatServiceDate(service.service_date)}</span>
        </div>
        <span className="flex-1" />
        {/* 출석은 발행된 뒤, 예배 날짜가 지난 뒤에만 만진다(사용자 결정) */}
        {canAttend && !editing && (
          <button type="button" onClick={onOpenAttendance}
            className="worship-att-open shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-line text-[11.5px] font-semibold text-fg transition active:scale-95 hover:bg-surface-hover">
            <ClipboardCheck size={13} /> 출석 체크
          </button>
        )}
        {/* **수정은 머리줄 오른쪽에서 채운 버튼**이다(사용자 지적 2026-09-03: 눈에 안
            띈다). 도구 줄의 연한 버튼이던 것을 자격자에게만 여기로 올렸다 —
            발행·삭제·저장 상태는 그대로 아래 도구 줄에 남는다. */}
        {perms.canEdit && !editing && (
          <button type="button" onClick={() => { dirty.current = false; setSaveState(''); setDraft(draftOf(service)); }}
            className={`worship-edit-open shrink-0 ${WITH_ICON} ${BTN}`}>
            <PencilLine size={13} /> 수정
          </button>
        )}
        {/* 편집 중 — 저장 상태 칩은 좁은 화면에서도 여기 있고(하나만 그린다),
            저장·삭제 버튼은 데스크톱에서만 여기 선다. 모바일은 아래 고정 줄이다. */}
        {perms.canEdit && editing && (
          <>
            {/* 저장은 저절로 되므로 그 사실이 눈에 보여야 한다(노트 라벨과 같은 톤).
                발행 전에는 '임시' — 저장은 됐지만 아직 나만 본다는 뜻이 담긴다 */}
            <SaveState state={saveState} savedLabel={isDraft ? '임시 저장되었어요' : '저장되었어요'} />
            <button type="button" onClick={saveNow} disabled={busy}
              className={`worship-save shrink-0 hidden md:inline-flex ${BTN}`}>저장</button>
            <ConfirmPopover className="shrink-0 hidden md:inline-flex" onConfirm={onDelete}
              message={<><span className="font-bold text-fg">이 주보를 삭제할까요?</span><br />모든 내용이 같이 사라지니 신중하게 선택해주세요</>}>
              <button type="button" className="px-2.5 py-1.5 rounded-md text-tag-red-fg hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">삭제</button>
            </ConfirmPopover>
          </>
        )}
      </header>

      <div className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock" style={{ borderBottom: '1px solid var(--app-line)' }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-selected={tab === t.id}
            className={`worship-tab shrink-0 px-3 py-2 text-[12.5px] font-semibold transition-colors ${tab === t.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            style={{ borderBottom: `2px solid ${tab === t.id ? 'var(--app-ink)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="worship-tabpanel">
        {tab === 'word' && (editing ? <WordEdit draft={draft} set={set} /> : <WordTab service={service} onOpenBible={onOpenBible} />)}
        {tab === 'roles' && (editing
          ? <RolesEdit rows={rows('roles')} people={people} onChange={v => set({ roles: v })} />
          : <RolesTab rows={rows('roles')} people={people} />)}
        {tab === 'songs' && (editing
          ? <SongsEdit rows={rows('songs')} onChange={v => set({ songs: v })}
              onPullPlaylist={onPullPlaylist} onLookupTitle={onLookupTitle} />
          : <SongsTab rows={rows('songs')} />)}
        {tab === 'notices' && (editing
          ? <NoticesEdit rows={rows('notices')} onChange={v => set({ notices: v })} />
          : <NoticesTab rows={rows('notices')} />)}
      </div>

      {canWriteNote && !editing && <MyNote note={note} onSave={onSaveNote} onShare={onShareNote} />}

      {/* 모바일 편집 도구 줄 — 화면 아래에 붙는다. 하단 탭바(4.5rem + safe-area) 위에
          얹고, 편집 중에만 뜬다. 긴 주보를 고칠 때 저장 버튼을 찾아 위로 올라가지
          않게(사용자 결정 2026-09-03). 데스크톱은 머리줄에 있으니 여기는 md:hidden.
          **body 포털이라야 한다**(§6-1) — .dc-screen의 transform 애니메이션이 조상
          containing block이 되어, 그냥 두면 fixed가 뷰포트가 아니라 이 화면 상자를
          기준으로 앉는다(검사가 폭 불일치·바닥에서 316px 떨어짐으로 잡아냈다). */}
      {perms.canEdit && editing && createPortal(
        <div className="worship-edit-bar md:hidden fixed left-0 right-0 z-30 flex items-center gap-2 px-3 py-2.5"
          style={{
            bottom: 'calc(4.5rem + env(safe-area-inset-bottom))',
            background: 'var(--app-surface)', borderTop: '1px solid var(--app-line)',
          }}>
          <button type="button" onClick={saveNow} disabled={busy} className={`worship-save-mobile ${BTN}`}>저장</button>
          <span className="flex-1" />
          <ConfirmPopover onConfirm={onDelete}
            message={<><span className="font-bold text-fg">이 주보를 삭제할까요?</span><br />모든 내용이 같이 사라지니 신중하게 선택해주세요</>}>
            <button type="button" className="px-2.5 py-1.5 rounded-md text-tag-red-fg hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">삭제</button>
          </ConfirmPopover>
        </div>,
        document.body,
      )}
    </div>
  );
}
