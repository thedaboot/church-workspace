import { useLayoutEffect, useRef, useState } from 'react';
import { Trash2, Eye, Loader2, Paperclip, UploadCloud } from 'lucide-react';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { formatBytes, fileKind } from './fileRow.jsx';
import { EmptyBookMark } from './wordBible.jsx';
import { objectParticle } from '../services/errorText.js';
import { BTN, WITH_ICON } from './groupsParts.jsx';

// ============================================================================
// 예배 화면 공용 부품 — 주보 보기(worshipDetail) · 편집(worshipEdit) · 노트(worshipNote) · 출석(worshipAttendance)이 같이 쓴다
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 worshipDetail.jsx(1,994줄)에서 갈라 왔다. 저장 상태 칩 하나·빈 상태 하나를 쓰려고
// 출석·말씀 화면이 2천 줄을 import하던 자리다. **모양은 그대로다** — 옮기기만 했다.
// 송폼·큐시트 파일 줄(ServiceFiles)도 여기 있다: 보기 카드(큐시트)와 편집(송폼·큐시트) 양쪽에 선다.
// ============================================================================

// ── 되풀이해서 쓰는 모양 한 벌 ───────────────────────────────────────────────
export const ROW_LINE = { borderBottom: '1px solid var(--app-line)' };
export const CARD_BOX = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };
export const NUM = 'w-5 shrink-0 text-[11px] font-bold text-fg-muted tabular-nums';
// 보기 줄의 역할 칩 — 편집 줄의 ROLE_CHIP과 같은 색·같은 모양이되 입력칸이 아니다
// (누를 수 없는 것에 focus 스타일을 달아 두면 눌러 보게 된다).
export const ROLE_VIEW = 'px-2.5 py-0.5 rounded-full bg-accent-weak text-accent-text text-[11.5px] font-semibold';
// 편집 진입은 **연한 accent**, 확정은 진한 accent, 나가기는 무채색(§8의 색 규칙).
// **출석 화면도 이 한 줄을 쓴다**(worshipAttendance의 '수정') — 같은 뜻의 버튼이
// 두 파일에 각자 적혀 있으면 한쪽만 고쳐진다.
export const BTN_SOFT = 'px-3 py-1.5 rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40';
// 누르는 자리는 before로 3px 넓힌다(모양은 그대로) — 순서 버튼끼리 틈이 6px(gap-1.5)이라 그 절반.
export const ICON_BTN = 'relative before:absolute before:-inset-[3px] p-1.5 rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-30';
// 목록·편집 줄은 **트랙을 다 쓴다**(사용자 결정 2026-09-05: "다 반응형으로 메워야
// 한다. 모바일·데스크톱 모두 잘 나오게"). 예전에는 46rem 상한이 있었다 — 이름과
// 역할이 화면 양 끝으로 갈라져 보인다는 사용자 지적을 폭으로 눌러 둔
// 것이었는데, 그 대가로 1440px에서 오른쪽 40%가 통째로 비었다(§6-9-k와 같은 함정:
// max-w는 트랙 안에 빈 띠를 만든다).
// 갈라짐은 이제 **줄 안의 배치**로 막는다 — 남는 폭은 입력칸이 먹고, 조작 버튼은
// 그 입력칸 바로 옆에 선다(오른쪽 끝에 따로 떨어뜨리지 않는다). 보기 줄도 같은
// 문법이다: 역할 칩과 이름을 붙여 두고 남는 폭은 뒤에 남긴다.
export const LIST = 'min-w-0';
// 종이 폭 상한 — 인쇄물이라 여기만 max-w를 쓴다(§6-9-k의 예외. 가이드 종이도 같다)
export const SHEET_BOX = 'paper-box w-full max-w-[560px] mx-auto';

// 저장 상태를 말하는 칩 한 벌. 저절로 저장되는 칸(주보 편집 · 출석 메모)과 눌러서
// 저장하는 칸(내 예배 노트 — 사용자 결정 2026-09-02)이 같은 것을 쓴다.
// state는 '' | 'saving' | 'saved'.
//
// 끝난 것만 **연한 초록 칩**이다(사용자 결정 2026-09-02) — 누르지 않아도 저장되는 화면이라
// 저장이 끝난 순간이 눈에 들어와야 안심이 된다. '저장하는 중'은 지나가는 상태라 무채색이다.
// 라벨은 부르는 쪽이 정한다: 아직 발행 전인 주보는 '임시 저장되었어요'(발행해야 남들이
// 본다는 뜻이 담긴다), 이미 발행된 주보를 고치는 중이면 그 글자가 거짓이 되므로
// '저장되었어요'다.
// **`'draft'`는 브라우저에 남아 있던 글을 되살렸다는 뜻이다**(사용자 결정 2026-09-14 —
// 글자도 사용자가 정했다: `작성 중인 노트`). 초록 칩이 아니라 무채색이다 — 아직 저장된
// 것이 아니고, 저장이 끝난 순간만 칩으로 도드라져야 한다. **새 안내 줄을 만들지 않는다**
// (§8) — 이미 있는 이 자리에서 말한다.
export function SaveState({ state, savedLabel = '저장되었어요' }) {
  const done = state === 'saved';
  const plain = state === 'saving' ? '저장하는 중' : (state === 'draft' ? '작성 중인 노트' : '');
  return (
    <span className={`worship-save-state text-[10.5px] ${
      done ? 'px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg font-bold' : 'text-fg-muted'}`}>
      {done ? savedLabel : plain}
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
// 자리를 재고 그 아래 남는 만큼을 min-height로 가진다(§6-9-h).
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
    // 저장된 글이 없는 주보에서는 템플릿만큼(제목 세 줄) 상자보다 길어진다 —
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

// children — 읽기 실패 때 제목 아래에 붙는 둘째 줄과 '다시 시도'(groupsParts FailTail · D2).
// mark — 그림을 바꿀 때(내 예배 노트 0건은 노트 그림 · groupsParts NoteMark). alert — children이
// 실패가 아니라 할 일 버튼일 때 false로 준다(그때는 경고 역할이 아니다).
export function WorshipEmpty({ text, className = '', children, mark = null, alert = null }) {
  const [ref, minH] = useFillRest();
  return (
    <div ref={ref} className={`worship-empty flex flex-col items-center justify-center text-center ${className}`}
      style={{ minHeight: minH === null ? '46vh' : `${minH}px` }} role={(alert ?? !!children) ? 'alert' : undefined}>
      {mark || <EmptyBookMark />}
      <p className="mt-3 text-[13.5px] font-semibold text-fg">{text}</p>
      {children}
    </div>
  );
}

// 휴지통 + 삭제 확인 한 벌 — 편집 줄(담당자·찬양·광고 · worshipEdit RowTools)과 파일 줄이 같은 것을 쓴다.
// 확인 문구는 **무엇을 지우는지**를 말한다('이 찬양을 삭제할까요?' — 조사는 이름에 맞춘다).
// label — 버튼의 aria-label(기본 `{what} 삭제` · 파일 줄은 파일 이름). shrink — 파일 줄은 버튼 자체도 shrink-0이다.
const TRASH_BTN = 'p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition-colors';
export function TrashConfirm({ what, label = `${what} 삭제`, onConfirm, shrink = false }) {
  return (
    <ConfirmPopover className="shrink-0 inline-flex" title={`${what} 삭제`}
      message={`이 ${what}${objectParticle(what)} 삭제할까요?`} onConfirm={onConfirm}>
      <button type="button" aria-label={label} className={shrink ? `shrink-0 ${TRASH_BTN}` : TRASH_BTN}>
        <Trash2 size={13} />
      </button>
    </ConfirmPopover>
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
export function ServiceFileRow({ row, cls = 'worship-songform', what = '송폼', canDelete, onOpen, onRemove,
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
        <p className={`${cls}-meta mt-0.5 flex items-center gap-1 text-[10.5px] text-fg-muted`}>
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
      {!pending && canDelete && <TrashConfirm what={what} label={`${row.name} 삭제`} onConfirm={onRemove} shrink />}
    </li>
  );
}

export function ServiceFiles({ files = [], canEdit, onPick, onOpen, onRemove,
  label = '송폼', what = '송폼', cls = 'worship-songform', sectionCls = 'worship-songforms',
  accept, topLine = true, extra = null }) {
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
            {extra}
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
