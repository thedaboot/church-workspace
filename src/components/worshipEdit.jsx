import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, ChevronUp, ChevronDown, ListMusic, Loader2, X, FilePen } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar.jsx';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { keepVisible, stableRowKeys, imeComposing } from '../utils.js';
import { useDismiss } from '../hooks/useDismiss.js';
import { PassagePicker, PassageBody } from './worshipPassage.jsx';
import { docEmbedKind } from './DocEmbed.jsx';
import { BTN, WITH_ICON, FIELD } from './groupsParts.jsx';
import { youtubeListId, youtubePlaylistUrl, PRAISE_TEAM, songKey, weeksAgoOf } from '../services/worship.js';
import { ROW_LINE, CARD_BOX, NUM, ROLE_VIEW, ICON_BTN, LIST, TrashConfirm, ServiceFiles } from './worshipParts.jsx';

// ============================================================================
// 주보 편집 — 말씀(+큐시트) · 담당자 · 찬양 · 광고 (ServiceDetail이 수정 중에 세운다)
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 worshipDetail.jsx에서 갈라 왔다 — 보기·발행·상세는 그 파일에 남는다.
// 담당자·찬양·광고는 주보 한 건과 언제나 같이 읽고 쓰는 jsonb 한 칸이라(HANDOFF §3-1 · 0036)
// 편집은 '행 목록을 통째로 들고 있다가 저장'이다. 줄 하나를 고치고·옮기고·지우는 것은
// 세 화면이 같은 일이라 useRowList 한 벌이다. 저장(디바운스)은 부르는 쪽(ServiceDetail)이 한다.
// ============================================================================

const ROW = 'flex items-center gap-1.5';
// 입력칸은 **모임 화면과 같은 한 벌**을 쓴다(groupsParts의 FIELD) — 같은 앱에서
// 칸 생김새가 화면마다 다를 이유가 없다. 여기서 더하는 것은 min-w-0뿐이다(flex 안에서
// 줄어들 수 있게 · §6-9-c).
const INPUT = `min-w-0 ${FIELD}`;

// 편집 줄의 열쇠(저장하지 않는다 — utils.stableRowKeys 머리말). 렌더 중에 ref만 고친다:
// 같은 rows면 같은 열쇠를 돌려주므로 두 번 그려도(StrictMode) 값이 같다.
function useRowKeys(rows) {
  const box = useRef({ rows: [], keys: [] });
  const seq = useRef(0);
  const cur = box.current;
  if (cur.rows !== rows) {
    cur.keys = stableRowKeys(cur.rows, cur.keys, rows, () => `row${++seq.current}`);
    cur.rows = rows;
  }
  return cur.keys;
}

// 배열 한 칸 옮기기. 끝에서는 그대로 둔다.
const moveAt = (list, from, to) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
};

// 줄 목록 한 벌 — 담당자·찬양·광고 세 화면이 같은 네 가지를 한다(예전에는 화면마다 한 벌씩 적혀 있었다).
//   keys            줄마다 열쇠(위 useRowKeys — 줄을 옮겨도 입력칸이 그 줄을 따라간다)
//   set(i, patch)   한 칸 고치기 · move(from, to) 한 칸 옮기기(끝에서는 그대로) · remove(i) 지우기
// 바뀐 목록은 언제나 onChange 하나로 나간다(저장은 부르는 쪽).
function useRowList(rows, onChange) {
  const keys = useRowKeys(rows);
  return {
    keys,
    set: (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))),
    move: (from, to) => onChange(moveAt(rows, from, to)),
    remove: (i) => onChange(rows.filter((_, x) => x !== i)),
  };
}

// 칸마다 이름을 붙인다 — 자리 글(placeholder)만 있으면 '흔들리지 않는 기쁨'이
// 무엇의 예시인지 알 수 없었다(사용자 지적 2026-09-02). 라벨은 사용법 안내가 아니라
// **그 칸이 무엇을 받는 칸인지**라 §8의 '안내 줄 금지'와 다르다.
const Field = ({ label, children, wide = false }) => (
  <div className={`worship-field min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
    <span className="worship-field-label block mb-1 text-xs text-fg-muted">{label}</span>
    {children}
  </div>
);

// 큐시트는 큰 화면으로 띄워 놓고 보는 문서라 오피스 파일까지 받는다(미리보기는
// FilePreviewModal이 종류를 판정한다 — 워드·PPT·엑셀은 오피스 뷰어, PDF는 pdf.js).
const CUE_ACCEPT = '.pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.hwp';

// 큐시트 편집 — 위는 링크 두 칸, 아래는 파일 줄. 주소가 구글 문서가 아니면 **저장하지 않고**
// 그 자리에서 말한다(잘못된 주소를 담아 두면 보기 화면에 열리지 않는 줄이 선다).
//
// 링크 두 칸은 **같은 폭 두 열**이다(사용자 요구 2026-09-08 "큐시트 제목 적는 란도
// 반응형 같이"). 예전에는 링크만 `wide`(두 열 차지)라 넓은 화면에서 제목 칸만 절반으로
// 남아 어긋나 보였다. 좁으면 둘 다 한 열로 쌓인다.
//
// 파일 줄은 송폼과 **같은 부품**이다(ServiceFiles) — 라벨·클래스·받는 확장자만 다르다.
// `lastCue`·`onCopyLast` — **지난 큐시트로 바로 편집**(사용자 요청 2026-10-02 · 문구도 사용자 것). 이 주보에 큐시트
// 파일이 없고 지난 주보에 있을 때만 선다(worship.fetchLastCuesheet · 큐시트 편집 자격자만 — 부르는 쪽이 거른다).
function CueSheetEdit({ value, onChange, files = [], canEdit, onPick, onOpen, onRemove, lastCue = null, onCopyLast = null }) {
  const cur = value || {};
  const [copying, setCopying] = useState(false);
  const copyLast = async () => {
    if (copying) return;
    setCopying(true);
    try { await onCopyLast(lastCue); } finally { setCopying(false); }
  };
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
        accept={CUE_ACCEPT} topLine={false}
        extra={lastCue && onCopyLast && !files.length ? (
          <button type="button" onClick={copyLast} disabled={copying}
            title={lastCue.file?.name || ''}
            className={`worship-cue-copy-last shrink-0 ${WITH_ICON} ${BTN}`}>
            {copying ? <Loader2 size={13} className="animate-spin" /> : <FilePen size={13} />}<span>지난 큐시트로 바로 편집</span>
          </button>
        ) : null} />
    </div>
  );
}

// 순서 버튼은 언제나 보인다 — hover로 숨기면 터치 기기에서 그 기능이 없는 것과 같다(§8).
function RowTools({ index, total, onMove, onRemove, what }) {
  return (
    <>
      <button type="button" className={ICON_BTN} disabled={index === 0} title="위로"
        aria-label={`${what} 위로`} onClick={() => onMove(index, index - 1)}><ChevronUp size={13} /></button>
      <button type="button" className={ICON_BTN} disabled={index === total - 1} title="아래로"
        aria-label={`${what} 아래로`} onClick={() => onMove(index, index + 1)}><ChevronDown size={13} /></button>
      <TrashConfirm what={what} onConfirm={() => onRemove(index)} />
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

export function WordEdit({ draft, set, cueFiles = [], canEdit, onPick, onOpen, onRemove, lastCue = null, onCopyLast = null }) {
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
        files={cueFiles} canEdit={canEdit} onPick={onPick} onOpen={onOpen} onRemove={onRemove}
        lastCue={lastCue} onCopyLast={onCopyLast} />
    </div>
  );
}

// 담당자 사람 칸 — 이름 입력 하나로 명단 고르기와 자유 이름을 겸한다(사용자 결정).
// 치면 명단이 뜨고(방향키·Enter), 고르면 person이 연결된다. 명단에 없는 사람(외부 강사
// 같은)은 적은 글자가 그대로 남는다 — 0036의 roles jsonb가 둘 다 받는다.
// 담당자 지정(modals의 AssigneePicker)과 같은 톤이되, 그쪽은 목록 밖 이름을 막는다는
// 점만 다르다(업무 배정은 계정이 있어야 뜻이 있고, 주보 담당자는 이름만으로도 뜻이 있다).
function PersonNameInput({ row, people, onPick, seeded = false }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
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

  // 목록은 **body 포털**이다(HANDOFF §8 '떠 있는 것') — 375px에서 오른쪽 칸(인도자)의 목록이
  // 화면 밖으로 나갈 수 있었다. 칸의 왼쪽 끝에서 연다. 클래스 `worship-person-list`는
  // 검사가 문서에서 찾는 열쇠다(tests/worship).
  const listOpen = open && suggestions.length > 0;
  const [pos, place] = useAnchoredPos(rootRef, listOpen, 160, 192, 8, listRef, { align: 'start' });
  // 글자를 칠수록 줄 수가 바뀐다 — 위로 뒤집혀 선 목록이 칸에서 떨어져 뜨지 않게 다시 잰다
  useLayoutEffect(() => { if (listOpen) place(); }, [listOpen, suggestions.length, place]);

  // 목록이 포털이라 rootRef의 자손이 아니다 — **목록도 '안'으로 센다**(useDismiss 머리말 · PITFALLS 17-d)
  useDismiss(open, () => setOpen(false), [rootRef, listRef]);

  const choose = (p) => { onPick({ name: p.name, personId: p.id }); setOpen(false); setActiveIdx(0); };

  const onKeyDown = (e) => {
    if (imeComposing(e)) return;   // 조합을 끝내는 Enter로 고르지 않는다
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(suggestions[activeIdx] ?? suggestions[0]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="worship-person relative flex-1 basis-24 sm:basis-40 min-w-0" ref={rootRef}>
      <div className={`flex items-center gap-1.5 border rounded-xs bg-surface px-2 py-1 focus-within:border-accent focus-within:shadow-soft transition-all ${seeded ? 'border-accent' : 'border-line'}`}>
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
      {listOpen && createPortal(
        <div ref={listRef} style={{ position: 'fixed', left: pos.left, top: pos.top }}
          className="worship-person-list z-[90] w-max min-w-[10rem] max-w-[min(18rem,90vw)] max-h-48 overflow-y-auto bg-surface border border-line rounded-lg shadow-elevated p-1 transition-none animate-in fade-in zoom-in-95 duration-150">
          {suggestions.map((p, i) => (
            <button key={p.id} type="button" onMouseDown={e => { e.preventDefault(); choose(p); }}
              ref={i === activeIdx ? keepVisible : null}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${i === activeIdx ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover'}`}>
              <Avatar name={p.name} {...(p.profile_id ? {} : { url: null })} className="flex w-5 h-5 text-[10px] shrink-0" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>, document.body)}
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
// 물려받은 줄인가 — 씨로 넣은 것과 **역할·이름이 아직 그대로**일 때만이다.
// 따로 표식을 들고 다니지 않는 이유: 사람이 고치는 순간 저절로 아니게 되어야 하는데,
// 표식을 두면 '고쳤는지'를 또 따라다녀야 한다(줄을 옮기면 자리도 어긋난다).
export const isSeeded = (seeded, r) => !!String(r?.name || '').trim()
  && (seeded || []).some(x => x.role === r.role && x.name === r.name);

export function RolesEdit({ rows, people, onChange, seeded = [], onClearPrefill }) {
  const list = useRowList(rows, onChange);
  const anySeeded = rows.some(r => isSeeded(seeded, r));
  return (
    <div className={LIST}>
      {/* 지난 주보에서 물려받은 값이 있으면 그것만 말한다 — 사용법 안내가 아니라
          '이 값이 어디서 왔나'라는 출처다(2026-09-21). ×는 물려받은 칸만 비운다. */}
      {anySeeded && (
        <div className="worship-role-prefill flex items-center gap-1.5 pb-2">
          <span className="inline-flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded-full bg-tag-blue text-tag-blue-fg text-[11.5px] font-semibold">
            지난 주보
            <button type="button" onClick={onClearPrefill} aria-label="미리 채운 값 비우기"
              className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full bg-tag-blue-fg/15 transition active:scale-90">
              <X size={10} />
            </button>
          </span>
        </div>
      )}
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((r, i) => (
          <li key={list.keys[i]} className="worship-role-edit group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 역할은 칩처럼 — 이름 칸과 생김새가 같으면 어느 쪽이 무엇인지 매번 읽어야 한다 */}
            <input className={`${ROLE_CHIP} w-[5.75rem] sm:w-[7rem] shrink-0`} value={r.role || ''} aria-label="역할"
              onChange={e => list.set(i, { role: e.target.value })} placeholder="예: 대표기도" />
            {/* 이름 칸이 남는 폭을 먹는다(flex-1) — 그래서 넓은 화면에서도 도구는
                입력칸 **바로 옆**에 붙어 서고, ml-auto는 좁은 화면에서 도구만 다음
                줄로 접혔을 때 오른쪽에 세우는 용도로만 남는다 */}
            <PersonNameInput row={r} people={people} onPick={v => list.set(i, v)} seeded={isSeeded(seeded, r)} />
            <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
              <RowTools index={i} total={rows.length} what="담당자" onMove={list.move} onRemove={list.remove} />
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
// 제목 칸·링크 칸의 클래스는 아래 가져오는 중 뼈대가 **같은 것을 쓴다**(뼈대 줄 높이 = 실제 줄 높이).
const SONG_TITLE_BOX = 'basis-[calc(100%-1.625rem)] sm:basis-0 flex-1 min-w-0';
const SONG_LINK_BOX = 'flex-1 basis-32 sm:basis-0 min-w-0 ml-[1.625rem] sm:ml-0';
//
// Thumb — 링크 칸 앞의 썸네일 부품(worshipDetail의 SongThumb · 보기 줄과 같은 한 벌). 그 파일이 이 파일을
// import하므로 거꾸로 import하지 않고(고리) 부르는 쪽이 넘긴다.
export function SongsEdit({ rows, people, leader, playlistUrl = '', recent = [], onLeader, onPlaylist, onChange, onPullPlaylist, onLookupTitle, Thumb }) {
  // 칸은 **주보에 적혀 있는 재생목록**에서 시작한다(사용자 지적 2026-09-09 — "재생목록이
  // 잘못 되었으면 이를 삭제도 할 수 있는 구조로"). 예전에는 늘 빈 칸이라, 가져오고 나면
  // 무엇이 주보에 남았는지 편집 화면에서 볼 길이 없었고 지울 길은 더 없었다.
  const [url, setUrl] = useState(() => playlistUrl || '');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(() => new Set());   // 제목을 받아 오는 중인 줄
  const list = useRowList(rows, onChange);

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
    if (title) list.set(i, { title });
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
            onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); pull(); } }}
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
      {/* 최근에 부른 곡 — 콘티를 짜는 **그 자리**에서 "저번 달에 부르지 않았나"에 답한다
          (사용자 요청 2026-09-21). 재료는 발행된 주보의 songs뿐이라 새 표가 없다.
          폰에서는 한 줄로 가로 스크롤한다 — 줄바꿈하면 곡 목록이 화면 밖으로 밀린다
          (`x-scroll-lock`은 가로로 미는 동안 세로가 흔들리지 않게 한다 · 탭 줄과 같은 짜임).
          누르면 목록 끝에 붙는다 — **막지 않는다**(부러 다시 부르는 곡이 있다). */}
      {recent.length > 0 && (
        <div className="worship-song-recent pb-2.5">
          <div className="text-[11.5px] font-bold text-fg-secondary pb-1.5">최근 8주 내에 고백한 곡</div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide x-scroll-lock md:flex-wrap md:overflow-visible">
            {recent.map(r => (
              <button key={songKey(r.title)} type="button"
                onClick={() => onChange([...rows, { title: r.title, link: r.link || '' }])}
                className="worship-song-chip shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line bg-surface text-[12.5px] text-fg-secondary transition active:scale-95 hover:bg-surface-hover">
                {r.title}<span className="text-fg-faint">{r.weeksAgo}주 전</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ul style={{ borderTop: rows.length ? '1px solid var(--app-line)' : 'none' }}>
        {rows.map((s, i) => (
          <li key={list.keys[i]} className="worship-song-row group flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            {/* 제목을 받아 오는 중이면 그 자리를 스켈레톤 한 줄이 지킨다 */}
            {looking.has(i) ? (
              <span className={`worship-song-title-loading ${SONG_TITLE_BOX} h-[30px] rounded-xs dc-skeleton`} />
            ) : (
              /* 이미 최근에 부른 곡이면 그 줄이 말한다(칩과 같은 재료다). 입력은 막지
                 않는다 — 부러 다시 부르는 곡이 있고 그 판단은 찬양팀의 것이다.
                 **표는 제목 칸 안에 띄운다**(사용자 지적 2026-09-22 — 줄에 끼워 넣었더니
                 앞뒤 칸이 표 너비만큼 밀렸다). 칸 오른쪽에 얹고 글자는 그만큼 물러나며,
                 길어서 닿으면 `…`로 잘린다(input도 text-overflow가 먹는다 — 포커스가
                 없을 때. 쓰는 동안에는 커서를 따라가야 하므로 잘리면 안 된다). */
              <span className={`worship-song-titlebox relative ${SONG_TITLE_BOX}`}>
                <input className={`${INPUT} w-full text-ellipsis`} value={s.title || ''} aria-label="찬양 제목"
                  style={weeksAgoOf(recent, s.title) > 0 ? { paddingRight: '7.5rem' } : undefined}
                  onChange={e => list.set(i, { title: e.target.value })} placeholder="예: 주 은혜임을" />
                {weeksAgoOf(recent, s.title) > 0 && (
                  <span className="worship-song-ago pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center h-[21px] px-2 rounded-full bg-tag-yellow text-tag-yellow-fg text-[11px] font-semibold whitespace-nowrap">
                    {weeksAgoOf(recent, s.title)}주 전에 했던 곡
                  </span>
                )}
              </span>
            )}
            {/* 링크 칸 앞에는 작은 썸네일 — 어느 영상인지 눈으로 확인된다.
                **둘째 줄은 번호 칸 밑에서 시작하지 않는다**(2026-09-08 실측 375px:
                제목 칸은 x=38인데 링크 칸이 x=12에서 시작해 왼쪽이 들쭉날쭉했다).
                640 미만에서는 이 칸이 언제나 둘째 줄이므로 번호 칸만큼(1.25rem + gap
                0.375rem) 들여 제목 칸과 왼쪽을 맞춘다. 640 위는 한 줄이라 들여쓰기가 없다. */}
            <span className={`worship-song-linkbox flex items-center gap-1.5 ${SONG_LINK_BOX} border border-line rounded-xs bg-surface px-1.5 py-1 focus-within:border-accent transition-colors`}>
              <Thumb link={s.link} />
              <input className="flex-1 min-w-0 bg-transparent text-[13px] py-0.5 outline-none text-fg placeholder:text-fg-faint"
                value={s.link || ''} aria-label="찬양 링크"
                onChange={e => list.set(i, { link: e.target.value })} onBlur={() => fillTitle(i, s)} placeholder="유튜브 링크(선택)" />
            </span>
            <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
              <RowTools index={i} total={rows.length} what="찬양" onMove={list.move} onRemove={list.remove} />
            </span>
          </li>
        ))}
      </ul>
      {/* 가져오는 중 — 새로 들어올 자리를 스켈레톤이 지킨다(몇 줄이 늘지 눈에 보인다).
          **뼈대 줄은 실제 줄과 같은 높이다**(19차 2026-10-07) — 한 줄짜리 뼈대(51px)였을 때 폰에서는 실제
          줄이 두 줄(제목 / 링크 · 약 94px)이라 곡이 들어오는 순간 목록이 줄마다 43px씩 아래로 뛰었다.
          그래서 제목·링크 칸을 실제 줄과 같은 클래스·같은 높이(제목 33.5 · 링크 34)로 세운다. */}
      {busy && (
        <ul className="worship-song-loading">
          {[0, 1, 2].map(k => (
            <li key={k} className="flex flex-wrap items-center gap-1.5 py-2.5" style={ROW_LINE}>
              <span className={NUM}>{rows.length + k + 1}</span>
              <span className={`${SONG_TITLE_BOX} h-[33.5px] rounded-xs dc-skeleton`} />
              <span className={`${SONG_LINK_BOX} h-[34px] rounded-xs dc-skeleton`} />
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
export function NoticesEdit({ rows, onChange }) {
  const list = useRowList(rows, onChange);
  return (
    <div className={LIST}>
      <ul className="space-y-2">
        {rows.map((n, i) => (
          <li key={list.keys[i]} className="worship-notice-row group p-3 md:p-4 rounded-[10px]" style={CARD_BOX}>
            <div className="flex items-center gap-1.5 pb-1.5">
              <span className="text-[11.5px] font-bold text-fg-muted tabular-nums">광고 {i + 1}</span>
              <span className={`${ROW} shrink-0 ml-auto ${TOOLS}`}>
                <RowTools index={i} total={rows.length} what="광고" onMove={list.move} onRemove={list.remove} />
              </span>
            </div>
            <div className="grid gap-2.5">
              <Field label="제목">
                <input className={`${INPUT} w-full`} value={n.title || ''} aria-label="광고 제목"
                  onChange={e => list.set(i, { title: e.target.value })} placeholder="예: 겨울 수련회 신청" />
              </Field>
              <Field label="내용">
                <textarea className={`${INPUT} w-full resize-y min-h-[3.5rem]`} value={n.body || ''} aria-label="광고 내용"
                  onChange={e => list.set(i, { body: e.target.value })} placeholder="예: 1월 20일까지 순장에게 신청해주세요" />
              </Field>
            </div>
          </li>
        ))}
      </ul>
      <AddCard label="광고 추가" onClick={() => onChange([...rows, { title: '', body: '' }])} />
    </div>
  );
}
