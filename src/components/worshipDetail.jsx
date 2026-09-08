import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink, ClipboardCheck,
  ListMusic, PencilLine, Music, Loader2, Paperclip, UploadCloud, Eye, FileText, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ShareChip, ShareToggle } from './ShareToggle.jsx';
import { Avatar } from './Avatar.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { FilePreviewModal } from './FilePreviewModal.jsx';
import { formatBytes, fileKind } from './fileRow.jsx';
import { keepVisible } from '../utils.js';
import { PassagePicker, PassageBody } from './worshipPassage.jsx';
import { EmptyBookMark } from './wordBible.jsx';
import { RichText } from './RichText.jsx';
import { DocEmbedModal, docEmbedKind } from './DocEmbed.jsx';
import { objectParticle } from '../services/errorText.js';
import { BTN, BTN_QUIET, WITH_ICON, FIELD } from './groupsParts.jsx';
import { kindLabel, formatServiceDate, attendanceVisible, youtubeThumb, youtubeListId, youtubePlaylistUrl, PRAISE_TEAM,
  filesOfKind, fileKindOf, SONGFORM, CUESHEET } from '../services/worship.js';
import { honorificsOf } from '../services/people.js';
import { worshipNoteTemplate, isTemplateOnly, bodyOrTemplate } from '../services/noteTemplate.js';

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

// ── 이 파일이 되풀이해서 쓰는 모양 한 벌 ────────────────────────────────────
// **쓰이는 곳보다 위에 둔다.** 예전에는 이 넷이 파일 한가운데(보기 절과 노트 절)에
// 흩어져 있어서, 맨 위의 큐시트 카드가 400줄 아래의 상수를 쓰고 있었다 — 읽는 사람이
// 값을 찾으러 아래로 내려가야 했다(모듈 평가 순서로는 문제가 없었다).
const ROW_LINE = { borderBottom: '1px solid var(--app-line)' };
const CARD_BOX = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };
const NUM = 'w-5 shrink-0 text-[11px] font-bold text-fg-faint tabular-nums';
// 보기 줄의 역할 칩 — 편집 줄의 ROLE_CHIP과 같은 색·같은 모양이되 입력칸이 아니다
// (누를 수 없는 것에 focus 스타일을 달아 두면 눌러 보게 된다).
const ROLE_VIEW = 'px-2.5 py-0.5 rounded-full bg-accent-weak text-accent-text text-[11.5px] font-semibold';
// 편집 진입은 **연한 accent**, 확정은 진한 accent, 나가기는 무채색(§8의 색 규칙).
// **출석 화면도 이 한 줄을 쓴다**(worshipAttendance의 '수정') — 같은 뜻의 버튼이
// 두 파일에 각자 적혀 있으면 한쪽만 고쳐진다.
export const BTN_SOFT = 'px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40';
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
    // **아래에 깔린 것도 나중에 커진다.** 내 예배 노트의 편집기는 lazy로 늦게 붙고,
    // 저장된 글이 없는 주보에서는 템플릿만큼(제목 다섯 줄) 상자보다 길어진다 —
    // 마운트 때 잰 below로 두면 그만큼 넘쳐서 스크롤이 생겼다(2026-09-08). 그래서
    // el과 sc 사이의 겹들도 같이 본다. 우리 min-height는 below를 바꾸지 않으므로
    // (바로 위 주석) 재기 → 커짐 → 다시 재기의 되풀이가 생기지 않는다.
    for (let node = el; node.parentElement && node.parentElement !== sc; node = node.parentElement) {
      ro.observe(node.parentElement);
    }
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
  praise_leader: d.praise_leader || null, praise_playlist_url: d.praise_playlist_url || null,
  roles: d.roles || [], songs: d.songs || [], notices: d.notices || [],
  // 큐시트는 링크 한 칸이라 jsonb다(0053). 주소가 없으면 통째로 null — 제목·비밀번호만
  // 남은 껍데기가 있으면 보기 화면이 열 수 없는 줄을 그린다.
  cue_sheet: d.cue_sheet && String(d.cue_sheet.url || '').trim() ? d.cue_sheet : null,
});

// ── 큐시트 (링크는 0053 · 파일은 0054) ──────────────────────────────────────
// 큐시트는 **링크로도 파일로도** 붙는다(사용자 요구 2026-09-08 "링크로도 걸 수 있게
// 해주고, 파일 업로드로도 첨부할 수 있게도"). 링크는 주보 행의 한 칸이고
// (`services.cue_sheet` jsonb — {url, title}), 파일은 송폼과 같은 files 표에
// `kind='cuesheet'`로 앉는다(0054 · 업로드 길은 그대로 하나다 — §6-29-u).
//
// **비밀번호는 없다**(사용자 결정 2026-09-08 "큐시트는 비밀번호 안 걸어도 돼" —
// 0053의 view_pw 두 칸은 비워 둔다). 발행된 주보를 읽는 사람이면 누구나 연다.
const cueOf = (s) => (s && typeof s.cue_sheet === 'object' ? s.cue_sheet : null);
const cueUrl = (s) => String(cueOf(s)?.url || '').trim();

// 보기 — 링크 줄과 파일 줄이 **한 카드**에 선다. 둘 다 '큐시트'라는 한 가지이고,
// 카드를 갈라 두면 같은 것이 두 군데 있는 것처럼 읽힌다.
// 창 열기는 **참고 링크와 같은 창**(DocEmbed의 DocEmbedModal)이다 — 같은 앱에서 문서 여는
// 방식이 두 가지가 되지 않게. 파일은 첨부·송폼과 같은 FilePreviewModal이다.
// 링크도 파일도 없으면 **카드를 그리지 않는다**(빈 안내 줄 금지 · §8).
function CueSheetView({ cue, files = [], onOpen }) {
  const [open, setOpen] = useState(false);
  if (!cue && !files.length) return null;
  return (
    <section className="worship-cue mt-5 p-3 rounded-[10px]" style={CARD_BOX}>
      <p className="worship-cue-label text-xs font-semibold text-fg-muted">큐시트</p>
      <ul className={`worship-cue-list ${LIST} mt-1`}>
        {cue && (
          <li className="worship-cue-row" style={files.length ? ROW_LINE : undefined}>
            {/* 줄 전체가 누르는 자리다 — 오른쪽 '열기'는 그 사실을 눈에 보이게 하는 표식 */}
            <button type="button" onClick={() => setOpen(true)}
              className="w-full text-left flex items-center gap-2.5 py-2.5">
              <span className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 bg-tag-blue text-tag-blue-fg">
                <FileText size={16} strokeWidth={1.75} />
              </span>
              <span className="worship-cue-title min-w-0 flex-1 text-[13px] text-fg truncate">
                {cue.title || '구글 문서'}
              </span>
              <span className={`worship-cue-open shrink-0 ${BTN_SOFT}`}>열기</span>
            </button>
          </li>
        )}
        {files.map((row, i) => (
          <ServiceFileRow key={row.id} row={row} cls="worship-cue-file" openLabel="보기"
            line={i < files.length - 1} canDelete={false} onOpen={() => onOpen && onOpen(row)} />
        ))}
      </ul>
      {open && cue && <DocEmbedModal url={cue.url} title={cue.title || '큐시트'} onClose={() => setOpen(false)} />}
    </section>
  );
}

// 편집 — 위는 링크 두 칸, 아래는 파일 줄. 주소가 구글 문서가 아니면 **저장하지 않고**
// 그 자리에서 말한다(잘못된 주소를 담아 두면 보기 화면에 열리지 않는 줄이 선다).
//
// 링크 두 칸은 **같은 폭 두 열**이다(사용자 요구 2026-09-08 "큐시트 제목 적는 란도
// 반응형 같이"). 예전에는 링크만 `wide`(두 열 차지)라 넓은 화면에서 제목 칸만 절반으로
// 남아 어긋나 보였다. 좁으면 둘 다 한 열로 쌓인다.
//
// 파일 줄은 송폼과 **같은 부품**이다(ServiceFiles) — 라벨·클래스·받는 확장자만 다르다.
function CueSheetEdit({ value, onChange, files = [], canEdit, onPick, onOpen, onRemove }) {
  const cur = value || {};
  const [url, setUrl] = useState(cur.url || '');
  const bad = !!url.trim() && !docEmbedKind(url.trim());

  const commitUrl = (next) => {
    setUrl(next);
    const clean = next.trim();
    if (!clean) { onChange(null); return; }          // 비우면 큐시트 링크가 없어진다
    if (!docEmbedKind(clean)) return;                 // 모양이 아니면 담지 않는다
    onChange({ ...cur, url: clean });
  };

  return (
    <div className="worship-cue-edit sm:col-span-2 min-w-0 pt-3" style={{ borderTop: '1px solid var(--app-line)' }}>
      <p className="worship-cue-label mb-2 text-xs font-semibold text-fg-muted">큐시트</p>
      <div className="worship-cue-fields grid gap-3 sm:grid-cols-2">
        <Field label="큐시트 링크">
          <input className={`${INPUT} w-full`} value={url} aria-label="큐시트 링크"
            onChange={e => commitUrl(e.target.value)}
            placeholder="예: https://docs.google.com/document/d/..." />
          {bad && <p className="worship-cue-bad mt-1 text-[11.5px] text-tag-red-fg">구글 문서·시트 링크만 붙일 수 있어요</p>}
        </Field>
        <Field label="큐시트 제목">
          <input className={`${INPUT} w-full`} value={cur.title || ''} aria-label="큐시트 제목"
            onChange={e => onChange({ ...cur, title: e.target.value })} placeholder="예: 9월 6일 큐시트" />
        </Field>
      </div>
      <ServiceFiles files={files} canEdit={canEdit} onPick={onPick} onOpen={onOpen} onRemove={onRemove}
        label="파일" what="큐시트 파일" cls="worship-cue-file" sectionCls="worship-cue-files"
        accept={CUE_ACCEPT} topLine={false} />
    </div>
  );
}


// ── 보기 ─────────────────────────────────────────────────────────────────────
function WordTab({ service, onOpenBible, cueFiles = [], onOpenFile }) {
  const cue = cueUrl(service) ? cueOf(service) : null;
  const has = service.title || service.passage_ref || service.preacher;
  if (!has && !cue && !cueFiles.length) return <WorshipEmpty text="설교 제목과 본문 구절을 아직 적지 않았어요" />;
  // 구절은 누르면 성경 읽기의 그 장으로 간다(App.jsx의 openBible → WordView initialRef).
  const ref = service.passage_ref;
  return (
    <div>
      {service.title && <h3 className="text-[17px] md:text-[19px] font-extrabold text-fg tracking-[-0.3px] leading-snug break-words">{service.title}</h3>}
      <p className="mt-1.5 text-[12.5px] text-fg-muted">
        {ref && (onOpenBible
          ? <button type="button" onClick={() => onOpenBible(ref)}
              className="worship-open-bible underline decoration-dotted underline-offset-2 hover:text-fg transition">{ref}</button>
          : ref)}
        {ref && service.preacher && ' · '}
        {service.preacher}
      </p>
      <PassageBody refStr={service.passage_ref} />
      <CueSheetView cue={cue} files={cueFiles} onOpen={onOpenFile} />
    </div>
  );
}

// **보기에서는 이름 뒤에 호칭이 붙는다**(사용자 결정 2026-09-06) — 교역자 '전도사님' ·
// 그 해 부장 '부장님' · 나머지 명단 사람 '청년'. 명단에 없는 객원은 적힌 글자 그대로다.
// 규칙은 services/people.js 한 곳이고(honorific), 여기는 그 한 벌을 받아 쓴다.
// 편집 줄은 손대지 않는다 — 입력칸에 담기는 값은 이름이라야 명단 연결이 계속 맞는다.
function RolesTab({ rows, people, nameOf }) {
  const byId = useMemo(() => new Map((people || []).map(p => [p.id, p])), [people]);
  if (!rows.length) return <WorshipEmpty text="담당자를 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((r, i) => {
        const personId = r.personId || r.person_id || null;
        const person = personId ? byId.get(personId) : null;
        const name = person?.name || r.name || '';
        // 아바타의 글자 원은 **이름**에서 뽑는다(호칭이 붙은 글자로 뽑으면 '전'이 된다)
        const shown = nameOf ? nameOf(name, personId) : name;
        return (
          <li key={i} className="worship-role-row flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
            <span className={NUM}>{i + 1}</span>
            {/* 계정이 이어진 사람만 사진이 있다 — 나머지는 이름 글자 원이다(§4.7) */}
            <Avatar name={name} {...(person?.profile_id ? {} : { url: null })} className="flex w-7 h-7 text-[12px] shrink-0" />
            {/* 역할은 편집 줄과 같은 자리·같은 칩이다. 예전에는 오른쪽 끝에 밀어 뒀는데,
                폭 상한을 걷어내니 이름과 역할이 화면 양 끝으로 갈라졌다(회차 5 지적의
                재발). 붙여 두면 어느 폭에서도 '누가 무엇을' 한 눈에 읽힌다. */}
            {r.role && <span className={`${ROLE_VIEW} shrink-0`}>{r.role}</span>}
            <span className="min-w-0 text-[13px] font-semibold text-fg truncate">{shown || '이름 없음'}</span>
            <span className="flex-1" />
          </li>
        );
      })}
    </ul>
  );
}

// 유튜브 썸네일 — **키도 서버 함수도 필요 없다**(i.ytimg.com 공개 주소, services의
// youtubeThumb). 그래서 게스트·로컬에서도 그림이 뜬다. 못 받으면(비공개 영상·인터넷
// 없음) 음표 아이콘으로 떨어진다 — 깨진 그림 자리를 남기지 않는다.
// lazy 로딩이라 목록이 길어도 보이는 것만 받는다.
//
// **도착하기 전에는 같은 크기의 스켈레톤이 그 자리를 지킨다**(2026-09-07). 예전에는 빈
// 자리였다가 그림이 뿅 나타나서, 목록을 훑는 동안 곡 줄이 하나씩 깜빡이는 것처럼 보였다.
// 도착하면 200ms 페이드 — 캐시에서 오는 경우(두 번째 진입)에는 `complete`가 이미 참이라
// 첫 프레임부터 켜져 있다(onLoad는 그때 안 울린다 · §6-9-p와 같은 결).
function SongThumb({ link, big = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  const src = youtubeThumb(link);
  const box = big ? 'w-16 h-9' : 'w-10 h-6';
  useEffect(() => {
    setFailed(false);
    const el = imgRef.current;
    setLoaded(!!(el && el.complete && el.naturalWidth > 0));
  }, [src]);
  if (!src || failed) {
    return (
      <span className={`worship-song-thumb-fallback ${box} shrink-0 inline-flex items-center justify-center rounded-[5px]`}
        style={{ background: 'var(--app-surface-hover)' }}>
        <Music size={big ? 13 : 11} className={link ? 'text-accent-text' : 'text-fg-faint'} />
      </span>
    );
  }
  return (
    <span className={`worship-song-thumbbox ${box} shrink-0 relative inline-block overflow-hidden rounded-[5px]`}
      style={{ background: 'var(--app-surface-hover)' }}>
      {!loaded && <span className="worship-song-thumb-skeleton absolute inset-0 dc-skeleton rounded-[5px]" />}
      <img ref={imgRef} src={src} alt="" loading="lazy" draggable={false}
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
        className={`worship-song-thumb w-full h-full rounded-[5px] object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
    </span>
  );
}

// 찬양 섹션의 머리 한 줄 — **팀 이름은 고정**(services의 PRAISE_TEAM)이고 주보마다
// 바뀌는 것은 인도자 하나다(사용자 결정 2026-09-05: 팀은 'Re:born 워십'으로 고정,
// 인도자는 격주 교대). 주보에 실리는 사실이지 사용법 안내가 아니라 §8의 '안내 줄
// 금지'와 다르다 — 그래서 이 한 줄 말고 덧붙이는 설명은 없다.
// 재생목록 주소가 있으면 그 줄 끝에서 **한 번에 틀 수 있다**(0046) — 예전에는 곡을
// 하나씩 눌러야 했다. 곡 제목은 지금도 그 곡의 영상으로 간다.
// **줄은 가운데로 맞춘다**(사용자 지적 2026-09-09 — "'재생목록 열기' 버튼이 옆의
// 인도자랑 정렬이 안 맞는데"). 예전에는 `items-baseline`이었는데, 링크가 inline-flex라
// 그 상자의 기준선은 **첫 칸(아이콘 svg)의 아랫변**이다 — 아이콘 밑동이 글자 기준선에
// 붙으면서 아이콘과 글자가 통째로 몇 px 위로 떠올랐다. 세로 가운데로 맞추면 글자 크기가
// 달라도(12.5 / 11.5) 두 상자의 한가운데가 같은 자리에 온다.
const PraiseHead = ({ leader, playlistUrl, nameOf }) => (
  <p className="worship-praise-head flex flex-wrap items-center gap-1.5 pb-2.5 text-[12.5px] text-fg-muted">
    <span className="worship-praise-team font-bold text-fg">{PRAISE_TEAM}</span>
    {/* 인도자도 담당자 줄과 같은 호칭 규칙이다(services/people.js honorific) — 명단에
        없는 객원 인도자는 적은 글자 그대로 선다 */}
    {leader ? <span className="worship-praise-leader">· 인도 {nameOf ? nameOf(leader) : leader}</span> : null}
    {playlistUrl ? (
      <a href={playlistUrl} target="_blank" rel="noreferrer"
        className="worship-praise-playlist inline-flex items-center gap-1 leading-none text-[11.5px] font-semibold text-accent-text hover:underline">
        <ListMusic size={12} className="shrink-0" /> 재생목록 열기
      </a>
    ) : null}
  </p>
);

// 찬양 — 링크가 있으면 **제목 자체가 링크**다(사용자 지적 2026-09-03: 줄 나열이 밋밋).
// 예전에는 오른쪽 끝에 '듣기'가 따로 있어서 눌러야 할 것이 두 군데로 갈렸다.
//
// 곡도 인도자도 없으면 **빈 상태 한 벌 그대로**다 — 아직 아무것도 안 정했는데 팀
// 이름만 남겨 두면 '찬양을 정해 뒀다'로 읽힌다.
function SongsTab({ rows, leader, playlistUrl, nameOf }) {
  if (!rows.length && !leader && !playlistUrl) return <WorshipEmpty text="찬양을 아직 정하지 않았어요" />;
  if (!rows.length) {
    return (
      <>
        <PraiseHead leader={leader} playlistUrl={playlistUrl} nameOf={nameOf} />
        <WorshipEmpty text="찬양을 아직 정하지 않았어요" />
      </>
    );
  }
  return (
    <>
      <PraiseHead leader={leader} playlistUrl={playlistUrl} nameOf={nameOf} />
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
    </>
  );
}

// ── 주보에 붙는 파일 — 송폼 · 큐시트 (0047 · 갈래는 0054) ───────────────────
// 주보에 붙는 파일이다. 업무 첨부와 **같은 files 표·같은 드라이브 길**을 쓰고
// (services/worship.js → cloud.uploadServiceFile), 줄 모양도 그 화면과 한 벌이다
// (components/fileRow.jsx의 formatBytes·fileKind) — 같은 앱에서 파일 줄이 화면마다
// 다르게 생길 이유가 없다. 미리보기는 첨부와 같은 FilePreviewModal이라 PDF는 앱 안
// pdf.js로 그려지고 새 탭·내려받기도 그대로 딸려 온다.
//
// **송폼(찬양 탭)과 큐시트 파일(말씀 탭)이 이 한 부품을 쓴다**(2026-09-08). 다른 것은
// 라벨·클래스·받는 확장자뿐이고, 저장 자리는 `files.kind` 한 칸으로 갈린다(0054).
// 두 벌로 두면 §6-29-u를 화면에서 그대로 다시 밟는다 — 한쪽만 고치는 일이 계속 생긴다.
//
// **빈 상태 문구를 두지 않는다.** 붙은 파일도 없고 붙일 자격도 없으면 이 구역 자체가
// 뜨지 않는다 — 없는 것을 설명하는 줄은 §8의 안내 줄 금지에 걸린다.
// 올리기·삭제는 **수정 화면에서만**이다(담당자·찬양·광고와 같은 문법).
//
// 큐시트는 큰 화면으로 띄워 놓고 보는 문서라 오피스 파일까지 받는다(미리보기는
// FilePreviewModal이 종류를 판정한다 — 워드·PPT·엑셀은 오피스 뷰어, PDF는 pdf.js).
const CUE_ACCEPT = '.pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.hwp';

function ServiceFileRow({ row, cls = 'worship-songform', what = '송폼', canDelete, onOpen, onRemove,
  openLabel = null, line = true }) {
  // 아직 드라이브에 안 올라간 줄 — 고르자마자 선다(§6-29-k). 삭제는 주지 않는다:
  // DB에 행이 없어서 지울 것이 없고, 버튼을 내놓으면 화면이 거짓말을 한다.
  const pending = !!row._pending;
  const kind = fileKind(row.name, row.mime_type);
  return (
    <li className={`${cls}-row flex items-center gap-2.5 py-2.5`} style={line ? ROW_LINE : undefined}>
      <span className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${kind.chip}`}>{kind.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`${cls}-name text-[13px] text-fg break-words`}>{row.name}</p>
        {/* 올리는 중에도 크기는 그대로 말해 준다 — '올리는 중'은 상태이지 안내가 아니다 */}
        <p className={`${cls}-meta mt-0.5 flex items-center gap-1 text-[10.5px] text-fg-faint`}>
          {pending && <Loader2 size={10} className="shrink-0 animate-spin" />}
          {pending ? `드라이브에 올리는 중 · ${formatBytes(row.size_bytes)}` : formatBytes(row.size_bytes)}
        </p>
      </div>
      {/* 보기 카드에서는 옆에 선 링크 줄의 '열기'와 짝이 되게 글자 버튼이고,
          편집 목록에서는 삭제와 나란히 서므로 첨부·송폼과 같은 아이콘 버튼이다 */}
      <button type="button" onClick={onOpen} title="미리보기" aria-label={`${row.name} 미리보기`}
        className={`${cls}-open shrink-0 ${openLabel ? BTN_SOFT : ICON_BTN}`}>
        {openLabel || <Eye size={14} />}
      </button>
      {!pending && canDelete && (
        <ConfirmPopover className="shrink-0 inline-flex" title={`${what} 삭제`}
          message={`이 ${what}${objectParticle(what)} 삭제할까요?`} onConfirm={onRemove}>
          <button type="button" aria-label={`${row.name} 삭제`}
            className="shrink-0 p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors">
            <Trash2 size={13} />
          </button>
        </ConfirmPopover>
      )}
    </li>
  );
}

function ServiceFiles({ files = [], canEdit, onPick, onOpen, onRemove,
  label = '송폼', what = '송폼', cls = 'worship-songform', sectionCls = 'worship-songforms',
  accept, topLine = true }) {
  const inputRef = useRef(null);
  if (!canEdit && !files.length) return null;
  return (
    <section className={`${sectionCls} mt-4 ${topLine ? 'pt-3' : ''}`}
      style={topLine ? { borderTop: '1px solid var(--app-line)' } : undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Paperclip size={13} className="shrink-0 text-fg-faint" />
        <span className="text-xs font-semibold text-fg-muted">{label}</span>
        <span className="flex-1" />
        {canEdit && (
          <>
            {/* 칸 자체는 안 보인다 — 버튼이 대신 연다(첨부 영역과 같은 방식) */}
            <input ref={inputRef} type="file" multiple className="hidden" tabIndex={-1} aria-hidden="true"
              {...(accept ? { accept } : {})}
              onChange={e => { onPick(e.target.files); e.target.value = ''; }} />
            <button type="button" onClick={() => inputRef.current?.click()}
              className={`${cls}-add shrink-0 ${WITH_ICON} ${BTN}`}>
              <UploadCloud size={13} /><span>파일 올리기</span>
            </button>
          </>
        )}
      </div>
      {files.length > 0 && (
        <ul className={`${LIST} mt-1`}>
          {files.map(row => (
            <ServiceFileRow key={row.id} row={row} cls={cls} what={what} canDelete={canEdit}
              onOpen={() => onOpen(row)} onRemove={() => onRemove(row)} />
          ))}
        </ul>
      )}
    </section>
  );
}

// 광고 한 건 — 제목은 굵게, 본문은 두 줄에서 접는다(긴 광고 셋이면 화면을 다 먹었다).
// 접힘 여부는 **실제로 넘쳤을 때만** 묻는다 — 한 줄짜리 광고에 '펼치기'가 붙으면
// 누를 것이 없는 버튼이 된다.
function NoticeCard({ notice, index }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const bodyRef = useRef(null);
  // **폭이 바뀌면 다시 잰다.** 넘침은 글자 수가 아니라 줄 수로 정해지므로 같은 광고가
  // 1440에서는 두 줄에 들어가고 375에서는 넉 줄이 된다 — 마운트 때 한 번만 재면 창을
  // 좁히거나 폰을 돌렸을 때 잘린 광고에 '펼치기'가 붙지 않는다(읽을 길이 사라진다).
  // **펼쳐 둔 동안은 재지 않는다** — 그때는 접힘이 없어 언제나 '안 넘친다'가 나오고,
  // 접는 순간 그 값이 한 프레임 동안 남아 버튼이 깜빡인다. 접히면 레이아웃 이펙트가
  // 그리기 전에 다시 재므로 값이 늦지 않는다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return undefined;
    const measure = () => setOver(el.scrollHeight - el.clientHeight > 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notice.body, open]);
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

function WordEdit({ draft, set, cueFiles = [], canEdit, onPick, onOpen, onRemove }) {
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
      {/* 큐시트는 말씀 탭의 마지막 구역이다(0053) — 설교와 같이 쓰는 문서라 여기가 맞다.
          링크 두 칸 아래에 파일 줄이 붙는다(0054). */}
      <CueSheetEdit value={draft.cue_sheet} onChange={v => set({ cue_sheet: v })}
        files={cueFiles} canEdit={canEdit} onPick={onPick} onOpen={onOpen} onRemove={onRemove} />
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
    <div className="worship-person relative flex-1 basis-24 sm:basis-40 min-w-0" ref={rootRef}>
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

// 담당자 줄은 [번호][역할 칩][이름][도구] 넷이다. 좁은 화면에서는 도구(위·아래·삭제)만
// 다음 줄 오른쪽에 혼자 서던 자리라(2026-09-07), 375px에서 역할 칩과 이름 칸을 한 뼘씩
// 줄여 넷이 한 줄에 다 선다 — 640 위에서는 예전 폭 그대로다.
function RolesEdit({ rows, people, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className={LIST}>
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((r, i) => (
          <li key={i} className="worship-role-edit group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 역할은 칩처럼 — 이름 칸과 생김새가 같으면 어느 쪽이 무엇인지 매번 읽어야 한다 */}
            <input className={`${ROLE_CHIP} w-[5.75rem] sm:w-[7rem] shrink-0`} value={r.role || ''} aria-label="역할"
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

// 찬양 줄도 담당자 줄과 같은 규칙이다(2026-09-07). **두 줄이 되더라도 고아를 만들지
// 않는다** — 예전에는 제목이 `basis-full`이라 번호만 첫 줄에 혼자 남고 제목이 둘째 줄로
// 떨어졌다. 지금 640 미만은 [번호][제목] / [링크][도구] 두 줄이고 그 위는 한 줄이다.
// 제목의 basis는 `100% - (번호 1.25rem + gap 0.375rem)` — 번호 옆을 정확히 채우는 값이다.
function SongsEdit({ rows, people, leader, playlistUrl = '', onLeader, onPlaylist, onChange, onPullPlaylist, onLookupTitle }) {
  // 칸은 **주보에 적혀 있는 재생목록**에서 시작한다(사용자 지적 2026-09-09 — "재생목록이
  // 잘못 되었으면 이를 삭제도 할 수 있는 구조로"). 예전에는 늘 빈 칸이라, 가져오고 나면
  // 무엇이 주보에 남았는지 편집 화면에서 볼 길이 없었고 지울 길은 더 없었다.
  const [url, setUrl] = useState(() => playlistUrl || '');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(() => new Set());   // 제목을 받아 오는 중인 줄
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  // 인도자는 **이름 글자 하나**로 저장된다(0044 `services.praise_leader`) — 담당자
  // 줄처럼 person 연결을 따로 들고 있지 않다. 그래도 동그라미(연결 표시)는 붙어야
  // 하므로 적힌 이름이 명단과 정확히 같을 때 그 사람을 그 자리에서 찾는다.
  const leaderRow = useMemo(() => {
    const name = leader || '';
    const p = name ? (people || []).find(x => x.name === name) : null;
    return { name, personId: p?.id ?? null };
  }, [leader, people]);

  const pull = async () => {
    if (busy || !url.trim() || !onPullPlaylist) return;
    setBusy(true);
    const next = await onPullPlaylist(url, rows);
    setBusy(false);
    if (!next) return;
    onChange(next);
    // 곡만 뽑고 **재생목록 자체는 버리던 자리**(0046). 보기에서 한 번에 틀 수 있게
    // 주보에 적어 둔다 — 저장 모양은 언제나 playlist?list=…다(사람이 붙이는 주소는
    // watch?v=…&list=…일 때가 많아 그대로 두면 첫 곡 재생으로 튄다).
    const listId = youtubeListId(url);
    if (listId && onPlaylist) onPlaylist(youtubePlaylistUrl(listId));
    // 칸은 비우지 않는다 — 주보에 남은 그 주소를 그대로 세워 둔다(위 useState 주석).
    // 저장 모양으로 다시 적어서 칸에 보이는 것과 주보에 든 것이 같은 글자가 된다.
    if (listId) setUrl(youtubePlaylistUrl(listId));
  };

  // 재생목록만 뗀다 — **곡은 그대로 둔다**(사용자 스펙 2026-09-09). 가져온 곡은 이미
  // 주보의 찬양 목록이고, 줄마다 지우는 길이 따로 있다. 잘못 붙인 것은 주소 한 칸이다.
  const clearPlaylist = () => { setUrl(''); onPlaylist?.(''); };

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
      {/* 찬양 섹션 머리 — **팀 이름은 고정 상수라 글자**이고, 주보마다 바뀌는 것은
          인도자 하나다. 이름 칸은 담당자 줄과 **같은 부품**(PersonNameInput)이라
          명단 자동완성이 그대로 붙고, 명단에 없는 객원 인도자는 적은 글자가 남는다.
          라벨 '인도자'는 그 칸이 무엇을 받는지라 §8의 안내 줄 금지와 다르다. */}
      <div className="worship-praise-edit flex flex-wrap items-center gap-1.5 pb-2.5">
        <span className={`worship-praise-team ${ROLE_VIEW} shrink-0`}>{PRAISE_TEAM}</span>
        <span className="shrink-0 text-xs text-fg-muted">인도자</span>
        <PersonNameInput row={leaderRow} people={people} onPick={v => onLeader(v.name)} />
      </div>
      {/* 목록 도구 줄 — **줄을 바꾸지 않는다**(2026-09-07). 예전에는 입력칸이 `basis-full`이라
          좁은 화면에서 버튼만 둘째 줄 오른쪽에 혼자 섰다(고아). 지금은 언제나 한 줄이고,
          좁을 때는 버튼 라벨이 '가져오기'로 줄어든다 — 전체 문구는 title에 남는다. */}
      <div className="worship-song-import flex items-center gap-1.5 pb-2.5">
        {/* 칸 안에 × 를 두려면 테두리는 감싸는 상자가 갖는다(링크 칸·명단 검색 칸과 같은
            짜임) — 375에서도 칸이 남는 폭을 다 쓰고 ×는 오른쪽 끝에 붙는다. */}
        <span className="worship-song-urlbox flex items-center gap-1 flex-1 min-w-0 border border-line rounded-xs bg-surface px-2 py-1 focus-within:border-accent transition-colors">
          <input className="flex-1 min-w-0 bg-transparent text-[13px] py-0.5 outline-none text-fg placeholder:text-fg-faint"
            value={url} aria-label="유튜브 재생목록 주소"
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pull(); } }}
            placeholder="예: https://www.youtube.com/playlist?list=..." />
          {(url.trim() || playlistUrl) && (
            <button type="button" onClick={clearPlaylist} aria-label="재생목록 지우기" title="재생목록 지우기"
              className="worship-song-clear shrink-0 p-1 -mr-1 rounded text-fg-faint hover:text-fg transition-colors">
              <X size={13} />
            </button>
          )}
        </span>
        <button type="button" onClick={pull} disabled={busy || !url.trim()} title="유튜브 재생목록에서 가져오기"
          className="worship-song-pull shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold whitespace-nowrap transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ListMusic size={13} />}
          {busy ? <span>가져오는 중</span> : (
            <>
              <span className="md:hidden">가져오기</span>
              <span className="hidden md:inline">유튜브 재생목록에서 가져오기</span>
            </>
          )}
        </button>
      </div>
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((s, i) => (
          <li key={i} className="worship-song-row group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 제목을 받아 오는 중이면 그 자리를 스켈레톤 한 줄이 지킨다 */}
            {looking.has(i) ? (
              <span className="worship-song-title-loading basis-[calc(100%-1.625rem)] sm:basis-0 flex-1 min-w-0 h-[30px] rounded-xs dc-skeleton" />
            ) : (
              <input className={`${INPUT} basis-[calc(100%-1.625rem)] sm:basis-0 flex-1 min-w-0`} value={s.title || ''} aria-label="찬양 제목"
                onChange={e => set(i, { title: e.target.value })} placeholder="예: 주 은혜임을" />
            )}
            {/* 링크 칸 앞에는 작은 썸네일 — 어느 영상인지 눈으로 확인된다.
                **둘째 줄은 번호 칸 밑에서 시작하지 않는다**(2026-09-08 실측 375px:
                제목 칸은 x=38인데 링크 칸이 x=12에서 시작해 왼쪽이 들쭉날쭉했다).
                640 미만에서는 이 칸이 언제나 둘째 줄이므로 번호 칸만큼(1.25rem + gap
                0.375rem) 들여 제목 칸과 왼쪽을 맞춘다. 640 위는 한 줄이라 들여쓰기가 없다. */}
            <span className="worship-song-linkbox flex items-center gap-1.5 flex-1 basis-32 sm:basis-0 min-w-0 ml-[1.625rem] sm:ml-0 border border-line rounded-xs bg-surface px-1.5 py-1 focus-within:border-accent transition-colors">
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
// 세그먼트는 components/ShareToggle.jsx 한 벌이고 라벨만 이 화면 것이다. 글은 저장
// 버튼으로만 나가고(빈 노트는 저장할 것이 없으니 버튼이 잠긴다), **공유는 저장된 노트의
// 상태만 그 자리에서 바꾼다** — 같이 올리면 저장을 누르지 않았는데 글이 나가 버린다.
// 아직 저장한 것이 없으면 공유할 것도 없으므로 세그먼트가 잠긴다.
//
// **저장된 노트가 있으면 읽기 모드다**(2026-09-07 · QT 묵상과 같은 패턴). 예전에는 편집기가
// 늘 열려 있어서 "쓴 것인지 고치는 중인지"가 화면에 없었다 — 글은 저장돼 있는데 편집기
// 안에 그대로 있으니 아직 안 보낸 것처럼 읽혔다. 지금은 저장된 글을 RichText(나눔 피드와
// 같은 뷰어 · 저장 형식이 같은 마크다운이다)로 그리고 '수정'을 눌러야 편집기가 열린다.
//
// 도구 줄의 자리는 §8 그대로다 — **확정 왼쪽 / 나가기 오른쪽**, 그리고 두 모드에서 같은 자리:
//   읽기  `[수정(연한 accent)] [칩] … [ ] [공유 토글]`
//   편집  `[저장(진한 accent)] [칩] … [취소(무채색)] [공유 토글]`
// 375px에서 토글만 다음 줄 오른쪽에 혼자 서던 자리라 **줄을 grid로 잡는다**(flex-wrap에
// 맡기지 않는다): 640 미만에서 토글이 둘째 줄을 통째로 쓰고 왼쪽부터 폭을 채운다.
const NOTE_TOOLS = 'worship-note-tools mt-2.5 grid items-center gap-2 grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]';
const NOTE_TOGGLE = 'col-span-3 w-full sm:col-span-1 sm:w-auto';

function MyNote({ note, passageRef = '', onSave, onShare }) {
  // **처음 여는 노트는 템플릿으로 시작한다**(사용자 요청 2026-09-08 — 옛 순 노트
  // 템플릿을 우리 디자인으로). services/noteTemplate.js가 제목 다섯 줄을 만들고,
  // '본문' 아래에는 이 예배의 구절이 미리 들어간다.
  const tpl = useMemo(() => worshipNoteTemplate({ passageRef }), [passageRef]);
  const [body, setBody] = useState(() => bodyOrTemplate(note?.body, tpl));
  const [state, setState] = useState('');         // '' | 'saving' | 'saved'  (저장 버튼)
  const [shareState, setShareState] = useState(''); // '' | 'saving' | 'saved'  (공유 칩)
  const [busy, setBusy] = useState(false);
  // 저장된 노트가 없으면 처음부터 편집기다 — 빈 읽기 상자를 세울 이유가 없다
  const [editing, setEditing] = useState(!note);

  const saved = !!note;
  const shared = !!note?.shared_to_sun;
  // 되돌아갈 자리 — 저장된 글이 있으면 그것, 없으면 손대지 않은 템플릿이다
  const base = bodyOrTemplate(note?.body, tpl);
  // **손대지 않은 템플릿은 빈 노트다.** 제목 줄이 있다는 이유로 저장이 열리면
  // 아무도 쓰지 않은 제목 다섯 줄이 그대로 저장된다(isTemplateOnly).
  const hasText = !isTemplateOnly(body, passageRef);
  const dirty = body !== base;
  const reading = saved && !editing;

  // 주보가 바뀌거나 서버 값이 새로 오면 편집 중이던 글을 그 값으로 되돌린다.
  // **읽기 모드도 같이 되돌린다** — 다른 주보를 열었는데 앞 주보의 편집 상태가 남으면
  // 남의 글 위에 커서가 놓인 것처럼 보인다.
  // `state`는 건드리지 않는다 — 저장이 끝나면 부르는 쪽이 note를 갈아 끼우므로,
  // 여기서 비우면 방금 켠 '저장되었어요'가 같은 프레임에 지워진다.
  useEffect(() => { setBody(bodyOrTemplate(note?.body, tpl)); setEditing(!note); }, [note, tpl]);

  const save = async () => {
    if (busy || !hasText || !dirty) return;
    setBusy(true); setState('saving'); setShareState('');
    const ok = await onSave({ body, sharedToSun: shared });
    setBusy(false); setState(ok ? 'saved' : '');
    if (ok) setEditing(false);
  };

  // 취소는 **저장된 글로 되돌리고** 읽기 모드로 나간다(고치던 것을 버린다)
  const cancel = () => { setBody(base); setState(''); setEditing(false); };

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
      {reading ? (
        <div className="worship-note-read note-template min-h-40 border border-line rounded-md p-3 bg-surface">
          <div className="text-[13px] leading-relaxed text-fg-secondary break-words">
            <RichText content={note?.body || ''} />
          </div>
        </div>
      ) : (
        // 업무 본문·QT 묵상과 같은 편집기(서식 바 포함, 저장 값은 마크다운 문자열)
        <div className="worship-note-editor note-template">
          <Suspense fallback={<EditorSkeleton />}>
            <MarkdownEditor
              value={body}
              onChange={(v) => { setState(''); setBody(v); }}
              placeholder="오늘 말씀에서 마음에 남은 것"
              className={EDITOR_BOX}
            />
          </Suspense>
        </div>
      )}
      <div className={NOTE_TOOLS}>
        {reading ? (
          <button type="button" onClick={() => setEditing(true)} className={`worship-note-edit ${BTN_SOFT}`}>수정</button>
        ) : (
          <button type="button" onClick={save} disabled={!dirty || !hasText || busy} className={`worship-note-save ${BTN}`}>저장</button>
        )}
        <span className="min-w-0">
          <ShareChip state={shareState} label={shared ? '우리 순에 공유할게요' : '나만 볼게요'} />
        </span>
        {/* 취소는 고치던 것이 있을 때만 뜬다(처음 쓰는 노트에는 되돌아갈 글이 없다).
            칸 자체는 늘 있어야 격자가 흔들리지 않는다. */}
        <span className="justify-self-end">
          {!reading && saved && (
            <button type="button" onClick={cancel} className={`worship-note-cancel ${BTN_QUIET}`}>취소</button>
          )}
        </span>
        <ShareToggle className={NOTE_TOGGLE} value={shared} disabled={!saved || busy}
          onChange={setShare} shareLabel="순에 공유하기" />
      </div>
    </section>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
export function ServiceDetail({
  service, people = [], personRoles = [], perms = {}, note = null, canWriteNote = false, startEditing = false,
  files = [], onBack, onSave, onPublish, onDelete, onSaveNote, onOpenAttendance, onOpenBible,
  onPullPlaylist, onLookupTitle, onShareNote, onUploadFiles, onRemoveFile,
}) {
  const [tab, setTab] = useState('word');
  const [draft, setDraft] = useState(null);     // null이면 보기 모드
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);     // 미리보기로 열어 둔 파일 행
  // 주보 파일은 한 표에서 한 번에 오고(0047의 files.service_id) **여기서 갈래로 갈린다**
  // (0054의 files.kind). kind가 없는 행은 송폼이다 — 0054 이전에 심긴 행(게스트 시드·옛
  // 주보)이 그렇고, 마이그레이션의 백필도 같은 값을 넣었다.
  const songForms = useMemo(() => filesOfKind(files, SONGFORM), [files]);
  const cueFiles = useMemo(() => filesOfKind(files, CUESHEET), [files]);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved'
  const dirty = useRef(false);
  const editing = draft !== null;
  const shown = editing ? draft : service;
  const rows = (k) => (Array.isArray(shown?.[k]) ? shown[k] : []);
  const set = (patch) => { dirty.current = true; setDraft(d => ({ ...d, ...patch })); };
  // 이름 → 호칭 한 벌. 명단(is_pastor)과 그 해 직분(people_roles)이 재료다 —
  // 둘 다 출석 명단과 같은 조회에서 온다(worship.fetchRoster).
  const nameOf = useMemo(() => honorificsOf(people, personRoles), [people, personRoles]);

  const draftOf = (s) => ({
    ...s,
    roles: Array.isArray(s?.roles) ? s.roles : [],
    songs: Array.isArray(s?.songs) ? s.songs : [],
    notices: Array.isArray(s?.notices) ? s.notices : [],
  });

  // 만들자마자 수정 화면으로 들어온다(사용자 결정) — 새 주보는 열자마자 빈 칸이라
  // '수정'을 한 번 더 누르게 할 이유가 없다.
  useEffect(() => {
    dirty.current = false; setSaveState(''); setTab('word'); setPreview(null);
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
  // 출석 진입은 **발행되었는가**까지만 본다(사용자 결정 2026-09-05) — 예배 전에도
  // 미리 열어 명단을 훑을 수 있고, 그때는 출석 화면이 체크를 잠근다(worshipAttendance).
  const canAttend = perms.canCheck && attendanceVisible(service);

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

      {/* 머리줄 — 왼쪽에 종류·날짜·설교자, 오른쪽에 출석 체크·수정.
          **한 덩이 카드다**(2026-09-07). 예전에는 칩과 날짜가 캔버스 위에 그냥 얹혀 있어서
          그 위 도구 줄과 아래 탭 줄 사이에 아무것도 없는 띠가 났다 — 무엇을 보고 있는지가
          화면 맨 위에서 한 번에 읽히도록 상자로 묶었다(목록 카드와 같은 껍데기다). */}
      <header className="worship-head flex items-center gap-2 mb-4 p-3 rounded-[10px]" style={CARD_BOX}>
        {/* 한 줄에 종류·상태·날짜·설교자. **줄을 늘리지 않는다** — 이 자리가 두 줄이 되면
            그만큼 아래 빈 탭의 가운데가 위로 밀린다(검사가 화면의 1/3을 요구한다). */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 min-w-0 flex-1">
          <span className="px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(service.kind)}</span>
          {isDraft && <span className="worship-draft-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>}
          <span className="worship-head-date text-[12.5px] font-bold text-fg">{formatServiceDate(service.service_date)}</span>
          {/* 설교자는 **넓은 폭(≥640)에서만** 머리줄에 — 375에서는 둘째 줄로 내려가 머리 카드가
              두 줄이 됐다(실기기 스크린샷 2026-09-07·08). 폰에서는 말씀 탭 제목 밑에 같은 값이 이미
              있으니(`구절 · 설교자`) 머리에서 뺀다. */}
          {service.preacher && (
            <span className="worship-head-preacher hidden sm:inline min-w-0 text-[11.5px] text-fg-muted truncate">· 설교 {service.preacher}</span>
          )}
        </div>
        {/* 버튼은 좁은 화면에서 서로 밑으로 접힌다 — 날짜 덩이를 밀어내지 않게 shrink-0 */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
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
        </div>
      </header>

      {/* `aria-selected`는 **`role="tab"`인 요소에만** 뜻이 있다(그냥 button에 달면 보조
          기기가 무시한다). 대시보드 탭 줄(views.jsx)이 이미 tablist/tab 한 벌이라 같은
          모양으로 맞춘다 — 보이는 것은 그대로다. */}
      <div role="tablist" aria-label="주보" className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock" style={{ borderBottom: '1px solid var(--app-line)' }}>
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" onClick={() => setTab(t.id)} aria-selected={tab === t.id}
            className={`worship-tab shrink-0 px-3 py-2 text-[12.5px] font-semibold transition-colors ${tab === t.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            style={{ borderBottom: `2px solid ${tab === t.id ? 'var(--app-ink)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="worship-tabpanel">
        {tab === 'word' && (editing
          ? <WordEdit draft={draft} set={set} cueFiles={cueFiles} canEdit={!!(editing && perms.canEdit)}
              onPick={fs => onUploadFiles(fs, CUESHEET)} onOpen={setPreview}
              onRemove={onRemoveFile} />
          : <WordTab service={service} onOpenBible={onOpenBible} cueFiles={cueFiles} onOpenFile={setPreview} />)}
        {tab === 'roles' && (editing
          ? <RolesEdit rows={rows('roles')} people={people} onChange={v => set({ roles: v })} />
          : <RolesTab rows={rows('roles')} people={people} nameOf={nameOf} />)}
        {tab === 'songs' && (
          <>
            {editing
              ? <SongsEdit rows={rows('songs')} people={people} onChange={v => set({ songs: v })}
                  leader={draft.praise_leader || ''} onLeader={v => set({ praise_leader: v })}
                  playlistUrl={draft.praise_playlist_url || ''}
                  onPlaylist={v => set({ praise_playlist_url: v })}
                  onPullPlaylist={onPullPlaylist} onLookupTitle={onLookupTitle} />
              : <SongsTab rows={rows('songs')} leader={service.praise_leader || ''}
                  playlistUrl={service.praise_playlist_url || ''} nameOf={nameOf} />}
            {/* 송폼은 찬양 목록 바로 아래 한 구역이다(0047). 붙이고 지우는 것은 수정
                화면에서, 보기 화면에는 줄만 선다 — 담당자·찬양·광고와 같은 문법이다.
                큐시트 파일(말씀 탭)이 여기 섞이지 않는 것은 kind로 갈랐기 때문이다(0054). */}
            <ServiceFiles files={songForms} canEdit={!!(editing && perms.canEdit)}
              onPick={fs => onUploadFiles(fs, SONGFORM)} onOpen={setPreview} onRemove={onRemoveFile} />
          </>
        )}
        {tab === 'notices' && (editing
          ? <NoticesEdit rows={rows('notices')} onChange={v => set({ notices: v })} />
          : <NoticesTab rows={rows('notices')} />)}
      </div>

      {canWriteNote && !editing && (
        <MyNote note={note} passageRef={service?.passage_ref || ''} onSave={onSaveNote} onShare={onShareNote} />
      )}

      {/* 파일 미리보기 — 업무 첨부와 **같은 창**이다. 송폼도 큐시트 파일도 이 창 하나로
          연다. PDF는 앱 안 pdf.js로 그려지고 새 탭·내려받기도 그 창이 준다(§6-29-q).
          사진 넘기기는 이미지끼리만 도는데, 그 목록은 **연 줄과 같은 갈래**만 준다 —
          찬양 탭에서 연 송폼이 말씀 탭 큐시트로 넘어가면 어디에 있는지 알 수 없다. */}
      {preview && (
        <FilePreviewModal row={preview} initialSrc={null} onClose={() => setPreview(null)}
          rows={fileKindOf(preview) === CUESHEET ? cueFiles : songForms} />
      )}

      {/* 모바일 편집 도구 줄 — 화면 아래에 붙는다. 하단 탭바(4.5rem + safe-area) 위에
          얹고, 편집 중에만 뜬다. 긴 주보를 고칠 때 저장 버튼을 찾아 위로 올라가지
          않게(사용자 결정 2026-09-03). 데스크톱은 머리줄에 있으니 여기는 md:hidden.
          **body 포털이라야 한다**(§6-1) — .dc-screen의 transform 애니메이션이 조상
          containing block이 되어, 그냥 두면 fixed가 뷰포트가 아니라 이 화면 상자를
          기준으로 앉는다(검사가 폭 불일치·바닥에서 316px 떨어짐으로 잡아냈다). */}
      {perms.canEdit && editing && createPortal(
        <div className="worship-edit-bar md:hidden fixed left-0 right-0 z-30 flex items-center gap-2 px-3 py-2.5"
          style={{
            // **탭바가 잰 제 높이**로 앉는다(layout.jsx MobileTabBar → `--mobile-tab-bar-h`).
            // 예전에는 `4.5rem + safe-area` 상수였는데 탭바 높이는 안 내용으로 정해져서
            // (pt-2 + 아이콘 + 글자 + pb + safe-area ≈ 68px) 그 사이에 4px쯤 틈이 남았다
            // (사용자 지적 2026-09-08). 변수가 아직 없는 첫 프레임에는 옛 상수가 대신 선다.
            bottom: 'var(--mobile-tab-bar-h, calc(4.5rem + env(safe-area-inset-bottom)))',
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
