import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, PencilLine, NotebookPen } from 'lucide-react';
import { Skeleton } from '../components/media.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText, errorReason } from '../services/errorText.js';
import { useAuth } from '../services/auth.jsx';
import { useCached, readCache, writeCache, dropCache } from '../services/cache.js';
import { useLiveRefresh } from '../services/liveV2.js';
import { entryParam, takeEntryParam, useEntryQuery } from '../services/entryQuery.js';
import { DatePicker } from '../components/DatePicker.jsx';
import { BTN, BTN_QUIET, FIELD, LabeledField, FailTail } from '../components/groupsParts.jsx';
import { ServiceDetail, WorshipEmpty, MyNotesScreen, BTN_SOFT } from '../components/worshipDetail.jsx';
import { AttendanceScreen } from '../components/worshipAttendance.jsx';
import {
  SUNDAY_KIND, kindLabel, formatServiceDate, nextSundayDate, serviceYear, worshipPerms, mergeSongs, kstNow,
  fetchServices, fetchWorshipPerms, fetchRoster, createService, saveService, publishService, removeService,
  fetchAttendance, checkIn, checkOut, fetchMyNote, saveMyNote,
  fetchGuests, addGuest as addGuestRow, removeGuest as removeGuestRow, fetchAttendanceCounts,
  notifyServicePublished, notifyNoteShared,
  saveAttendanceNote as saveAttendanceNoteRow,
  fetchPlaylistSongs, fetchVideoTitle, setNoteShared,
  fetchServiceFiles, ensureServiceDriveFolder, uploadServiceFile, removeServiceFile, SONGFORM,
  recentSongs as worshipRecentSongs, prefillRoles as worshipPrefillRoles,
  fetchMyNotes, noticeIcsUrl, fetchCovers, COVER,
} from '../services/worship.js';
import { CoverImg, useCoverShown } from '../components/worshipCover.jsx';
import { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } from '../config.js';
import { imeComposing, isKakaoInApp } from '../utils.js';
import { churchSeason } from '../services/churchYear.js';
import { myNoteRows } from '../services/serviceView.js';
import { buildIcs, googleCalendarUrl, kakaoExternal, noticeEvent } from '../services/noticeDate.js';

// ============================================================================
// v2 예배 화면 — 주보 목록/상세(말씀·임사자·찬양·광고) · 작성/발행 · 출석 체크 · 예배 노트
// ----------------------------------------------------------------------------
// 스펙은 docs/V2.md §1(결정 4·5·6·7·14)·§2, 저장 자리는 0036이다.
// App.jsx 라우팅(GLOBAL_MENUS 'worship')은 이미 연결돼 있다.
//
// **이 파일은 통신과 상태만 가진다.** 그리는 일은 worshipDetail·worshipAttendance가
// props로 받아서 한다 — 그래야 검사가 가짜 주보·명단으로 화면을 그대로 눌러 볼 수 있다.
//
// 작성 중(draft) 주보는 편집 자격자에게만 온다. 목록에서 거르는 것이 아니라 **RLS가
// 안 준다**(0036) — 화면은 그걸 비추기만 한다. 자격 판정(worshipPerms)이 어긋나도
// DB가 이긴다.
// ============================================================================

const KINDS = [
  { id: 'all', label: '전체' },
  { id: 'sunday', label: '주일예배' },
  { id: 'other', label: '그 밖의 예배' },
];

// 종류 세그먼트의 두 칸. 오른쪽을 고르면 이름 칸이 나온다(이벤트성 예배).
// 라벨은 바로 아래 거르기 칩과 같은 짧은 말이다('주일예배') — 카드·상세에 서는
// 정식 이름('주일 4부 젊은이 예배', kindLabel)은 그 값이 뜻하는 것이고, 고르는
// 자리에서는 두 칸이 한눈에 대비되어야 한다.
const KIND_SEG = [[false, '주일예배'], [true, '다른 예배']];

// 생성기의 칸은 **모두 같은 높이**다(34px = FIELD 한 칸의 높이). 라벨이 칸 위에 앉는
// 짜임이라 칸 높이가 다르면 아래를 맞춘 만큼 라벨 줄이 어긋나 계단처럼 보인다
// (세그먼트 37 · 날짜 30 · 입력칸 34로 두었을 때 1440에서 라벨이 3~4px씩 엇갈렸다).
// 날짜 픽커는 공용이라 손대지 않고 트리거 모양만 넘긴다(DatePicker의 triggerClassName).
const NEW_H = 'h-[34px]';
const DATE_TRIGGER = `inline-flex items-center gap-1.5 ${NEW_H} border border-line rounded-xs bg-surface px-2 text-xs text-fg hover:bg-surface-hover focus:border-accent focus:shadow-soft outline-none transition-all`;

// 모션을 꺼 둔 사람에게는 등장·퇴장을 걸지 않는다(§4.2 · dashboardParts와 같은 한 줄)
const reduceMotion = () => typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const CLOSE_MS = 150;

// ── 실패 문구 ───────────────────────────────────────────────────────────────
// **'무엇을 못 했는지'에 '왜'를 붙여 한 줄로 말한다**(사용자 지시 2026-09-03:
// "'순장을 정하지 못했어요 · 이미 같은 것이 있어요'보다 '순장을 지정하지 못했어요.
// 그 청년은 이미 자리가 배정되어 있어요'처럼 명확하게"). 공용 errorReason은 표와
// 코드만 알아서 '이미 같은 것이 있어요'까지밖에 말하지 못한다 — **무엇이 겹쳤는지는
// 이 화면만 안다.** 그래서 아는 코드는 여기서 사람 말로 바꾸고, 모르는 것(오프라인·
// 로그인 끊김·서버 불안정)은 그대로 공용 문구에 맡긴다(앱 전체가 같은 말을 해야 한다).
//
// 두 도막을 잇는 것은 failText이고 **언제나 줄을 바꾼다**(사용자 결정 2026-09-03).
// 이유 안에서 문장이 또 나뉘면 거기도 줄바꿈이다 — 가운뎃점은 한 문장 안의 나열
// ('회장·교역자·마스터')에만 쓴다.
const NEED_EDIT = '주보는 회장·교역자·미디어팀·관리자만 쓸 수 있어요';
// 송폼도 큐시트 파일도 주보를 쓰는 자격과 같은 문이다(0047의 files RLS가 can_edit_service를
// 그대로 보고, 0054의 kind는 자격에 영향이 없다)
const NEED_EDIT_FILE = '파일은 주보를 쓰는 사람만 붙이고 지울 수 있어요';
const GONE = '이 주보가 이미 지워졌어요\n새로고침해주세요';
const fail = (what, err, byCode = {}) => failText(what, { human: reasonOf(err, byCode) });
// 뒷도막만 — 읽기 실패 자리(D2)의 둘째 줄이 토스트의 둘째 줄과 같은 말을 하게 한 벌로 둔다
const reasonOf = (err, byCode = {}) => {
  const why = err?.human || byCode[String(err?.code ?? '')];
  return errorReason(why ? { human: why } : err);
};
const LIST_FAIL = '주보 목록을 받지 못했어요';
const LIST_FAIL_BY = { 42501: '승인된 멤버만 주보를 볼 수 있어요' };

const CARD = 'rounded-[10px] shadow-soft transition active:scale-[.995]';
const CARD_STYLE = { background: 'var(--app-surface)', border: '1px solid var(--app-line)' };

// 카드는 **두 줄**이다(사용자 지적 2026-09-03: "줄바꿈이 많아 무엇을 봐야 할지
// 고민하게 된다"). 예전에는 종류 칩·날짜 / 제목 / 본문·설교자가 각각 줄이라 카드
// 하나에 세 덩이가 쌓였다.
//   1줄 — **설교 제목**(초점). 작성 중일 때만 오른쪽에 작은 칩.
//   2줄 — 날짜 · 종류 · 본문 · 설교자를 가운뎃점으로 이어 한 줄로(없는 값은 빠진다).
// 종류를 칩에서 글자로 내린 이유: 칩은 눈을 먼저 끄는데 목록에서 먼저 읽어야 하는
// 것은 제목이다.
//
// **메타가 한 줄에 안 들어갈 때의 규칙**(사용자 결정 2026-09-05 — 520px 카드에서
// 설교자만 다음 줄로 내려갔다 · 재강조 "줄바꿈 안 되게끔"): 줄을 늘리지 않고
// **덜 중요한 도막을 통째로 뺀다.** 남기는 순서는 날짜·본문 > 설교자 > 종류다 —
// 종류는 위 칩으로 이미 거르고 있고 거의 모든 주보가 '주일 4부 젊은이 예배'라
// 카드마다 되풀이되는 값이다. **남은 도막은 잘리지 않고 온전히 읽힌다.**
// 떨어뜨리는 자리는 카드 폭이 정한다(컨테이너 쿼리 · 자리와 실측은 index.css의
// `.worship-card-meta`). truncate는 그 규칙이 아니라 **마지막 안전망**이다 —
// 어떤 값이 와도 두 줄이 되지 않게 nowrap을 걸어 두는 것이 본래 목적이다.
const metaParts = (service) => [
  ['date', formatServiceDate(service.service_date)],
  ['kind', kindLabel(service.kind)],
  ['ref', service.passage_ref ? `본문 ${service.passage_ref}` : null],
  ['preacher', service.preacher || null],
].filter(([, v]) => !!v);

// 카드 오른쪽 위의 작은 칩 자리는 **하나뿐**이다. 작성 중이면 그 배지가, 이미 지나간
// 발행본이면 출석 수가 선다(두 상태가 같이 오는 일은 없다 — 작성 중은 발행 전이다).
// 출석 수를 **메타 줄에 넣지 않은 이유**: 그 줄은 폭에 따라 도막을 빼는 컨테이너 쿼리로
// 한 줄을 지키는데(§6-9-q · index.css), 도막을 하나 더 얹으면 그 계산이 통째로 어긋난다.
//
// **교회력 물 한 겹**(2026-09-25 · services/churchYear.js) — 카드 위쪽이 절기 색으로 옅게 물들고
// 메타 줄 앞에 6px 점이 선다. 특별 절기(대림·성탄·주현·사순·부활·성령강림 주간)만 색이고, 연중은
// 우리 기본 톤이 더 옅게 서며 **점이 없다** — 점은 "이번 주는 특별한 절기"라는 표시라 매주 서면
// 뜻이 없어진다. 모양은 index.css `.season-wash`. **배경은 backgroundColor로 준다** — 인라인
// `background` 줄임말은 background-image까지 none으로 덮어 클래스의 물이 사라진다.
const CARD_SEASON_STYLE = { backgroundColor: 'var(--app-surface)', border: '1px solid var(--app-line)' };
// **표지 사진**(0081)이 있으면 사진이 이긴다 — 절기 물은 빠지고 점만 흰 테두리로 남는다(index.css `.has-cover`).
function ServiceCard({ service, onOpen, attended = 0, cover = null }) {
  const isDraft = service.status !== 'published';
  const season = churchSeason(service.service_date);
  const photo = useCoverShown(cover);
  return (
    <button type="button" onClick={() => onOpen(service)} data-season={season?.color || 'plain'}
      className={`worship-card season-wash dc-card relative w-full text-left px-4 py-3.5 ${CARD}${photo.shown ? ' has-cover' : ''}`} style={CARD_SEASON_STYLE}>
      {photo.shown && <CoverImg cover={cover} focus={service.cover_focus_y} onFail={photo.onFail} />}
      <div className="flex items-start gap-2">
        <p className="worship-card-title flex-1 min-w-0 text-[15px] font-bold text-fg tracking-[-0.2px] break-words">
          {service.title || '설교 제목 미정'}
        </p>
        {isDraft ? (
          <span className="worship-draft-badge shrink-0 mt-0.5 px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>
        ) : attended > 0 ? (
          <span className="worship-card-att shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums whitespace-nowrap"
            style={{ background: 'var(--app-surface-hover)', color: 'var(--app-ink-muted)' }}>출석 {attended}명</span>
        ) : null}
      </div>
      {/* 도막마다 span이고 구분점은 그 앞에 붙는다 — 도막이 빠지면 구분점도 같이 빠진다 */}
      <p className="worship-card-meta mt-1 text-[12.5px] leading-relaxed text-fg-muted truncate">
        {season?.color && <span className="worship-season-dot" aria-hidden="true" />}
        {metaParts(service).map(([k, v], i) => (
          <span key={k} className={`worship-meta-${k}`}>{i ? ' · ' : ''}{v}</span>
        ))}
      </p>
    </button>
  );
}

// 예배 종류 — 고르는 것은 둘뿐이다(주일 4부 젊은이 예배 / 그 밖의 자유 이름).
//
// **세그먼트다**(2026-09-08). 예전에는 팝오버가 달린 한 칸이었는데 375px 스크린샷에서
// '다른 예배…'만 덩그러니 서 있어서, 무엇을 고르는 칸인지도 지금 무엇이 골라져 있는지도
// 읽히지 않았다(말줄임표까지 붙어 잘린 글로 보였다 — 그래서 그 표를 뗐다). 갈래가 둘뿐인
// 값에 팝오버를 열게 하는 것은 조작도 한 번 더 든다.
// 부품은 새로 만들지 않는다 — 말씀의 [QT | 성경 읽기], 성경 리더의 [본문 | 북마크 |
// 형광펜]과 **같은 짜임·같은 토큰**이다(surface-hover 트랙 + 고른 칸만 surface).
function KindPicker({ other, onPick }) {
  return (
    <span className={`worship-kind-seg flex ${NEW_H} w-full sm:w-auto p-[3px] rounded-md`}
      style={{ background: 'var(--app-surface-hover)' }}>
      {KIND_SEG.map(([v, label]) => (
        <button key={label} type="button" data-kind={v ? 'other' : 'sunday'} aria-pressed={other === v}
          onClick={() => onPick(v)}
          className="worship-kind-opt flex-1 sm:flex-none whitespace-nowrap px-3.5 rounded-sm text-[12.5px] font-semibold transition-colors"
          style={{
            background: other === v ? 'var(--app-surface)' : 'transparent',
            color: other === v ? 'var(--app-ink)' : 'var(--app-ink-muted)',
          }}>{label}</button>
      ))}
    </span>
  );
}

// 새 주보 — 기본은 주일 4부 젊은이 예배, 날짜는 다가오는 주일이다(결정 14).
// 이벤트성 예배는 종류 이름을 그대로 적는다('금요 열정 예배'·'성탄절 예배').
//
// **만들기 한 번이면 끝난다**(사용자 지적 2026-09-02: "날짜와 그 밖의 예배만 정하고
// 만들 것이라면 세 줄로 쪼갤 이유가 없다"). 종류·날짜가 기본값으로 채워져 있고,
// 이름 칸은 '다른 예배'를 고를 때만 나온다.
//
// 다만 **짜임은 준다**(사용자 지적 2026-09-08: 375px에서 뒤죽박죽으로 읽힌다). 칸마다
// 라벨을 얹어 무엇을 정하는 자리인지 말하는 것은 동아리 만들기 카드와 같은 문법이다
// (groupsClub · LabeledField). 라벨은 사용법 안내가 아니라 칸 이름이다(§8).
//
// 줄은 폭이 정한다 — flex-wrap 하나에 맡기고 칸의 폭만 정해 준다:
//   ≥640  한 줄 · [종류][이름(남는 폭)][날짜][만들기] … [취소]
//   <640  [종류] / [이름] / [날짜][만들기] … [취소]  — 종류·이름만 w-full이라
//         날짜와 두 버튼(합쳐 260px 남짓)이 마지막 줄에 같이 선다. 버튼만 따로
//         한 줄에 남지 않는다.
// 취소는 `ml-auto`로 그 줄의 오른쪽 끝이다 — 상시 도구 줄은 확정 왼쪽 / 나가기
// 오른쪽이고(§8), 두 폭에서 자리가 같다.
function NewServiceForm({ onCreate, onCancel, closing = false }) {
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => nextSundayDate());
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await onCreate({ kind: other ? name.trim() : SUNDAY_KIND, serviceDate: date });
    setBusy(false);
  };

  return (
    // 등장은 §4.2의 카드 등장 토큰(dc-card = opacity + 5px, 280ms)을 그대로 탄다 —
    // 새 애니메이션을 만들지 않고, prefers-reduced-motion에서 index.css가 알아서 끈다.
    // 퇴장은 그 짝이 없어서 tw-animate로 짧게 준다(모션을 꺼 두면 아예 안 걸린다).
    // relative z-20 — 날짜 픽커 패널은 absolute라 조상의 z-index를 따르는데, 아래
    // 카드들이 등장 애니메이션(transform)으로 저마다 쌓임 문맥을 만들어 패널이 그 밑으로
    // 깔렸다(사용자 스크린샷 2026-09-03). DatePicker는 공용이라 손대지 않는다.
    <div className={`worship-new relative z-20 ${closing ? 'animate-out fade-out slide-out-to-top-1 duration-150' : 'dc-card'} p-3.5 mb-4 ${CARD}`}
      style={CARD_STYLE}>
      <div className="worship-new-fields flex flex-wrap items-end gap-2.5">
        <LabeledField label="종류" className="worship-new-kind w-full sm:w-auto shrink-0">
          <KindPicker other={other} onPick={setOther} />
        </LabeledField>
        {/* 이름 칸은 남는 폭을 먹되 **끝없이 늘지는 않는다**(동아리 만들기 카드와 같은
            판단) — 1440px에서 그대로 두면 이름 한 줄을 적는 자리가 970px이 되어 '빈 띠'로
            읽힌다. 남은 폭은 만들기와 취소 사이로 간다(§8의 나가기 오른쪽). */}
        {other && (
          <LabeledField label="이름" className="worship-new-name w-full sm:flex-1 sm:basis-40 sm:min-w-0 sm:max-w-[24rem]">
            <input value={name} onChange={e => setName(e.target.value)} aria-label="예배 이름" placeholder="예: 금요 열정 예배"
              autoFocus onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              className={`${FIELD} w-full`} />
          </LabeledField>
        )}
        {/* 업무의 날짜 픽커 한 벌을 그대로 쓴다 — 브라우저마다 다르게 그려지는
            <input type="date">와 달리 다크 모드·모바일에서 같은 모양이다(사용자 지적) */}
        <LabeledField label="날짜" className="worship-new-date shrink-0">
          <DatePicker value={date} onChange={setDate} triggerClassName={DATE_TRIGGER} />
        </LabeledField>
        <button type="button" onClick={submit} disabled={busy || (other && !name.trim()) || !date}
          className={`worship-new-make shrink-0 ${BTN}`}>만들기</button>
        <button type="button" onClick={onCancel}
          className={`worship-new-cancel shrink-0 ml-auto ${BTN_QUIET}`}>취소</button>
      </div>
    </div>
  );
}

// failed — 캐시 없는 첫 읽기가 실패했을 때 { reason, onRetry }(D2). 그때 services는 빈 목록이
// 아니라 **없는 것**이고(부르는 쪽 services === null), 빈 문구 자리에 실패 두 줄이 선다.
// onOpenNotes — '내 예배 노트' 모아 보기(2026-09-25). 노트를 쓸 수 있는 사람(가입자 · 게스트)에게만 선다.
function ServiceList({ services, perms, counts = {}, covers = {}, onOpen, onCreate, onOpenNotes = null, failed = null }) {
  // 출석 수는 **지난 예배**에만 붙인다 — 오늘·앞으로 올 예배의 '출석 0명'은 아직 부르지
  // 않았다는 뜻이지 아무도 안 왔다는 뜻이 아니다(그 예배의 출석은 출석 화면이 말한다).
  // 오늘은 **한국 시간**이고 그 셈은 services/worship.js의 kstNow 한 벌이다 —
  // 여기서 toLocaleDateString을 다시 적으면 시간대 규칙이 두 곳으로 갈린다.
  const today = kstNow().slice(0, 10);
  const [kind, setKind] = useState('all');
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  // 닫힘도 짧게 — 열림만 애니메이션하면 닫을 때 '뚝' 사라진다(사용자 지적 2026-09-03).
  // 그리기 위해 잠깐 더 남겨 두고 지운다. 모션을 꺼 둔 사람에게는 바로 접는다.
  const [closing, setClosing] = useState(false);
  const closeNew = () => {
    if (reduceMotion()) { setCreating(false); return; }
    setClosing(true);
    setTimeout(() => { setClosing(false); setCreating(false); }, CLOSE_MS);
  };

  const drafts = useMemo(() => (services || []).filter(s => s.status !== 'published'), [services]);
  const shown = useMemo(() => (services || [])
    .filter(s => (draftsOnly ? s.status !== 'published' : s.status === 'published'))
    .filter(s => (kind === 'all' ? true : kind === 'sunday' ? s.kind === SUNDAY_KIND : s.kind !== SUNDAY_KIND)),
  [services, kind, draftsOnly]);

  return (
    <div className="worship-list dc-screen pb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg md:text-xl font-extrabold text-fg tracking-[-0.4px]">예배</h2>
        <span className="flex-1" />
        {/* '새 주보' 왼쪽 — 연한 accent(들어가는 버튼 · §8 색 규칙). 노트가 없어도 선다(목업 판단) */}
        {onOpenNotes && (
          <button type="button" onClick={onOpenNotes}
            className={`worship-mynotes-open inline-flex items-center gap-1.5 ${BTN_SOFT}`}>
            <NotebookPen size={13} /> 내 예배 노트
          </button>
        )}
        {perms.canEdit && !creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="worship-new-open inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">
            <Plus size={13} /> 새 주보
          </button>
        )}
      </div>

      {creating && <NewServiceForm closing={closing} onCancel={closeNew}
        onCreate={async (v) => { const ok = await onCreate(v); if (ok) { setClosing(false); setCreating(false); } }} />}

      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock">
        {KINDS.map(k => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
            className="worship-kind-chip shrink-0 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition active:scale-95"
            style={kind === k.id
              ? { background: 'var(--app-ink)', color: 'var(--app-canvas)' }
              : { background: 'var(--app-surface)', color: 'var(--app-ink-muted)', border: '1px solid var(--app-line)' }}>
            {k.label}
          </button>
        ))}
      </div>

      {/* 작성 중 줄은 편집 자격자에게만 — 없는 사람에게는 RLS가 애초에 안 준다(0036) */}
      {perms.canEdit && drafts.length > 0 && (
        <button type="button" onClick={() => setDraftsOnly(v => !v)} aria-pressed={draftsOnly}
          className="worship-drafts-open inline-flex items-center gap-1.5 px-2.5 py-2 mb-3 rounded-md text-[11.5px] font-semibold transition active:scale-95"
          style={draftsOnly
            ? { background: 'var(--app-tag-yellow)', color: 'var(--app-tag-yellow-fg)' }
            : { background: 'var(--app-surface-hover)', color: 'var(--app-ink-muted)' }}>
          <PencilLine size={13} /> 작성 중인 주보 {drafts.length}건
        </button>
      )}

      {/* 넓은 폭에서는 카드가 옆으로 선다 — 한 줄짜리 카드를 1440px에 늘여 놓으면
          글자는 왼쪽 끝에 몰리고 오른쪽은 비어 있다(사용자 지적).
          3열은 **2xl(1536px)부터**다(예전에는 xl 1280). 1280에서 3열이 되면 카드가
          569 → 409px으로 **좁아져서** 메타 도막이 도리어 떨어져 나갔다 — 화면을
          넓혔는데 정보가 줄어드는 구간이 생긴다. 1536부터는 3열에서도 카드가 491px이라
          날짜·종류·본문·설교자가 다 한 줄에 선다(index.css의 메타 규칙과 한 벌이다). */}
      <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
        {shown.map(s => (
          <ServiceCard key={s.id} service={s} onOpen={onOpen} cover={covers[s.id] || null}
            attended={String(s.service_date) < today ? (counts[s.id] || 0) : 0} />
        ))}
      </div>
      {failed ? (
        <WorshipEmpty className="worship-load-failed" text={LIST_FAIL}>
          <FailTail reason={failed.reason} onRetry={failed.onRetry} />
        </WorshipEmpty>
      ) : !shown.length && (
        <WorshipEmpty text={draftsOnly ? '작성 중인 주보가 아직 없어요' : '발행된 주보가 아직 없어요'} />
      )}
    </div>
  );
}

// 첫 진입(캐시가 아예 없을 때)에만 나온다 — services/cache.js 참고
//
// **목록이 서는 자리를 그대로 잡아 둔다.** 예전에는 제목 뼈대 하나 + 카드 셋이라
// 거르기 칩 줄(≈30px + mb-3)이 빠져 있었고, 목록이 도착하는 순간 카드가 통째로 42px
// 아래로 뛰었다 — 스켈레톤은 '기다리는 그림'이 아니라 **자리를 지키는 그림**이다
// (홈 카드가 자리마다 따로 서는 것과 같은 판단 · homeView의 CardSkeleton).
// 높이는 실제 줄에서 잰 값이다: 머리줄 28 + mb-4 · 칩 줄 30 + mb-3 · 카드 86.
// **'작성 중인 주보 N건' 줄은 여기서 잡지 못한다** — 그 줄이 서는지는 자격과 초안 수,
// 곧 아직 오지 않은 데이터가 정한다. 자리를 미리 비워 두면 초안이 없는 사람에게는
// 도리어 빈 띠가 남는다(대부분이 그렇다).
const LOADING = (
  <div className="worship-loading pb-8" aria-hidden="true">
    <div className="flex items-center h-[28px] mb-4"><Skeleton className="h-[22px] w-24 rounded-md" /></div>
    {/* 거르기 칩 줄 — 셋의 폭은 '전체 · 주일예배 · 그 밖의 예배'만큼이다 */}
    <div className="worship-loading-chips flex items-center gap-1.5 h-[30px] mb-3">
      <Skeleton className="h-full w-[54px] rounded-full" />
      <Skeleton className="h-full w-[74px] rounded-full" />
      <Skeleton className="h-full w-[88px] rounded-full" />
    </div>
    <div className="worship-loading-cards grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
      <Skeleton className="h-[86px] w-full rounded-[10px]" />
    </div>
  </div>
);

// 딥링크(`/?p=worship&s=<주보 id>`)로 들어올 때 서는 자리 — **목록도 LOADING도 아니다.**
//
// 사용자 지적 2026-09-19: "주보 상세로 갈 때 … 바로 넘어가니 자연스럽지 않게 넘어가는
// 느낌이 살짝 든다." 원인은 상세의 등장(dc-screen)이 아니라 **그 앞에서 목록이 한 번
// 스치는 것**이었다 — 목록(또는 목록 스켈레톤)을 그린 다음 상세로 갈아 끼우니, 갈 데가
// 아닌 화면이 한 프레임 번쩍이고 사라진다.
//
// 그래서 LOADING과 **같은 원칙**으로 상세가 설 자리를 잡아 둔다(스켈레톤은 기다리는
// 그림이 아니라 **자리를 지키는 그림**이다). 높이는 게스트에서 실제 상세를 재서 맞췄다:
// 도구 줄 29 + mb-4 · 머리 카드 46 + mb-4 · 탭 줄 37 + mb-3.
// **머리 카드는 읽기만 하는 사람의 줄(46)이다** — 수정·출석 버튼이 서는 자격자에게는
// 그 줄이 57(폰은 버튼이 접혀 68)로 자라는데, 그건 아직 오지 않은 주보가 정하는 값이라
// (발행됐는지, 예배 날짜가 지났는지) 스켈레톤이 미리 알 수 없다. 알 수 없는 것은 넓게
// 잡지 않는다 — 대부분은 읽기만 하고(그때는 탭 줄까지 한 픽셀도 안 어긋난다), 자격자는
// 데스크톱 12px·폰 23px만큼 내려온다.
// 탭 안쪽은 종이 상자 하나로 둔다: 그 아래에는 노트 구역밖에 없어서 길이가 어긋나도
// 화면에 보이는 것이 밀리지 않는다.
const DETAIL_LOADING = (
  <div className="worship-detail-loading dc-screen pb-10" aria-hidden="true">
    {/* 도구 줄 — 오른쪽 끝의 '목록으로' 하나 */}
    <div className="flex items-center h-[29px] mb-4">
      <span className="flex-1" />
      <Skeleton className="h-[22px] w-[76px] rounded-md" />
    </div>
    {/* 머리 카드 — 종류 칩·날짜·설교자가 한 줄로 앉는 상자 */}
    <div className="h-[46px] mb-4"><Skeleton className="h-full w-full rounded-[10px]" /></div>
    {/* 탭 줄 — 주보·말씀·담당자·찬양·광고 */}
    <div className="worship-detail-loading-tabs flex items-center gap-1 h-[37px] mb-3">
      <Skeleton className="h-[20px] w-[42px] rounded-md" />
      <Skeleton className="h-[20px] w-[42px] rounded-md" />
      <Skeleton className="h-[20px] w-[54px] rounded-md" />
      <Skeleton className="h-[20px] w-[42px] rounded-md" />
      <Skeleton className="h-[20px] w-[42px] rounded-md" />
    </div>
    <Skeleton className="h-[420px] w-full rounded-[10px]" />
  </div>
);

export function WorshipView({ onOpenBible } = {}) {
  const { enabled, session, isMaster, isAdmin } = useAuth();

  // **캐시된 목록을 먼저 그린다**(사용자 요청 2026-09-03: "매번 스켈레톤이 아니라
  // 캐시된 값이 먼저 보이게"). 자격도 같은 묶음이다 — 자격을 기다리면 목록이 있어도
  // 스켈레톤이 남는다. 자격은 버튼을 감추는 용도이고 실제 경계는 RLS다(이 파일 머리말).
  // 게스트에서는 캐시가 메모리에만 있어서(cache.js) 새로고침하면 첫 진입과 같다.
  const year = new Date().getFullYear();
  const cached = useCached(`worship:list:${year}`,
    // 표지(0081)는 목록 한 번에 한 조회다. 꾸밈이라 **실패해도 목록은 선다**(사진 없이 절기 색으로).
    () => Promise.all([fetchWorshipPerms(year, { isMaster, isAdmin }), fetchServices(), fetchAttendanceCounts(),
      fetchCovers().catch((e) => { console.warn('[worship] 표지 조회 실패 — 사진 없이 선다:', e?.message || e); return {}; })])
      .then(([ps, rows, n, cv]) => ({ perms: ps, services: rows, counts: n, covers: cv })),
    [isMaster, isAdmin, year]);

  // 캐시 값은 **첫 렌더부터** 들고 있다(useState 초기값) — 이펙트에서 넣으면 한 프레임
  // 동안 스켈레톤이 그려진다. 화면이 낙관적으로 고치는 값이라 지역 상태로 받아 둔다.
  const [perms, setPerms] = useState(() => cached.data?.perms ?? null);
  const [services, setServices] = useState(() => cached.data?.services ?? null);
  const [counts, setCounts] = useState(() => cached.data?.counts ?? {});   // 주보 id → 출석 수(손님 포함)
  const [covers, setCovers] = useState(() => cached.data?.covers ?? {});   // 주보 id → 표지 files 행(0081)
  const [openId, setOpenId] = useState(null);
  const [screen, setScreen] = useState('list');      // 'list' | 'detail' | 'attendance' | 'notes'
  // 내 예배 노트 모아 보기(2026-09-25) — null이면 읽는 중. 노트 행만 받고 주보는 이미 손에 있는
  // 목록과 잇는다(serviceView.myNoteRows — 조회 하나). 캐시는 목록과 같은 자리 관례(worship: 접두).
  const [myNotes, setMyNotes] = useState(() => readCache('worship:mynotes'));
  const [notesFail, setNotesFail] = useState(null);
  const [roster, setRoster] = useState({ people: [], groups: [], members: [], roles: [] });
  const [present, setPresent] = useState(() => new Set());
  const [guests, setGuests] = useState([]);          // 이 주보의 미등록 출석자(0053)
  const [note, setNote] = useState(null);
  const [files, setFiles] = useState([]);                // 이 주보에 붙은 파일 — 송폼·큐시트 한 목록(0047·0054)
  const [editOnOpen, setEditOnOpen] = useState(false);   // 만들자마자 수정 화면으로
  const [noteOnOpen, setNoteOnOpen] = useState(false);   // 열자마자 내 예배 노트 칸으로(0건 자리의 '예배 노트 쓰기')

  // 노트는 가입자 누구나 쓴다(결정 7). 게스트 모드에는 로그인이 없다 — 그때도 연다.
  const canWriteNote = !enabled || !!session;
  const service = useMemo(() => (services || []).find(s => s.id === openId) || null, [services, openId]);
  // 최근에 부른 곡 — **여기서 셈하고 화면은 받은 줄만 그린다**(이 파일 머리말의 규칙).
  // 재료는 이미 손에 있는 목록이라 네트워크가 0이다(새 표도 새 조회도 없다).
  const recentSongs = useMemo(
    () => (service ? worshipRecentSongs(services || [], { onDate: service.service_date }) : []),
    [services, service],
  );
  // 지난 발행본의 대표기도·헌금봉헌 — 임사자 줄이 비어 있는 주보에만 씨로 들어간다.
  const prefill = useMemo(
    () => (service
      ? worshipPrefillRoles(services || [], { onDate: service.service_date, kind: service.kind, people: roster.people })
      : []),
    [services, service, roster.people],
  );

  // 뒤에서 새로 읽어 온 값으로 갈아 끼운다(stale-while-revalidate)
  useEffect(() => {
    if (!cached.data) return;
    setPerms(cached.data.perms); setServices(cached.data.services);
    setCounts(cached.data.counts || {});
    // 방금 올린 표지는 브라우저 안 주소(_src)를 쥔 채 둔다 — 드라이브가 섬네일을 만들기 전 몇 초 동안
    // lh3가 비어 있어서, 다시 읽은 행으로 갈아 끼우면 사진이 잠깐 사라진다. 같은 행일 때만 이어 준다.
    setCovers(prev => Object.fromEntries(Object.entries(cached.data.covers || {}).map(([sid, row]) => [sid,
      (prev[sid]?.id === row.id && prev[sid]?._src) ? { ...row, _src: prev[sid]._src } : row])));
  }, [cached.data]);

  // 읽기 실패 — **캐시가 있으면** 지난 목록이 그대로 서 있으니 토스트로 한 번 말한다.
  // **캐시가 없으면**(첫 진입) 빈 목록을 앉히지 않는다: 그러면 '발행된 주보가 아직 없어요'가 서서
  // 실패가 "아직 없다"로 읽혔다(D2 · 사용자 결정 2026-09-25). services는 null(= 없음)로 두고
  // 빈 문구 자리에 실패 두 줄 + '다시 시도'가 선다 — 그때는 토스트를 띄우지 않는다(한 번만 말한다).
  // retryOf는 '다시 시도'로 다시 읽는 중인 그 실패다 — useCached는 다시 읽는 동안에도 error를
  // 들고 있어서, 이것 없이는 누른 뒤에도 실패 자리가 그대로 서 있다(그동안은 스켈레톤).
  const [retryOf, setRetryOf] = useState(null);
  const listFailed = services === null && !!cached.error && cached.error !== retryOf;
  useEffect(() => {
    if (!cached.error) return;
    console.error('[worship] 주보 목록 실패:', cached.error);
    if (cached.data) showToast(fail(LIST_FAIL, cached.error, LIST_FAIL_BY));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached.error]);
  const retryList = useCallback(() => { setRetryOf(cached.error); cached.refresh(); }, [cached.error, cached.refresh]);

  // 쓰기 뒤에는 캐시를 비우고 다시 읽는다 — 안 비우면 다음 진입에서 옛 값이 한 번 보인다.
  //
  // **목록 열쇠만 비운다**(2026-09-06). `dropCache('worship')`은 접두 비교라 열어 둔 주보의
  // 상세 캐시(`worship:svc:<id>` — 명단·출석·노트·송폼)까지 같이 가져갔고, 그래서 출석 칩
  // 한 번에 상세 네 조회가 통째로 다시 돌았다(services/cache.js의 접두 주석).
  //
  // 홈은 같이 비운다 — 홈 카드가 주보·출석·공유 노트를 그대로 세고 있어서(homeView의
  // home:services·home:sun·home:present), 안 비우면 예배에서 저장한 것이 홈에서는 다음 날까지 옛 값이다.
  const invalidate = useCallback(() => {
    // 내 노트 목록도 같이 — 노트를 저장·공유한 뒤 모아 보기로 가면 새 글이 서야 한다
    dropCache('worship:list'); dropCache('worship:mynotes'); dropCache('home'); cached.refresh();
  }, [cached.refresh]);

  // 남이 주보를 만들거나 발행하면 목록에 몇 초 안에 뜬다(0049 · services/liveV2.js).
  // **상세·출석 화면에서는 건너뛴다** — 거기서는 편집 중인 초안과 방금 누른 출석 칩이
  // 화면에 있고, 그 신호는 나올 때 한 번에 흐른다(캐시는 그 사이에도 비워진다).
  // 신호 길에서는 **홈을 비우지 않는다**(2026-09-24) — 바뀐 표에 딸린 홈 접두는 liveV2가 이미
  // 골라 비웠다. 여기서 'home'을 통째로 비우면 상관없는 카드(오늘의 QT 등)의 캐시까지 사라져
  // 다음 홈 진입이 스켈레톤부터였다. 내 저장 뒤(invalidate)에는 그대로 비운다.
  const liveInvalidate = useCallback(() => {
    dropCache('worship:list'); cached.refresh();
  }, [cached.refresh]);
  useLiveRefresh('worship', liveInvalidate, screen === 'list');

  const open = useCallback(async (svc, { edit = false, note: toNote = false } = {}) => {
    setEditOnOpen(edit);
    setNoteOnOpen(toNote);
    setOpenId(svc.id); setScreen('detail');
    // 지난번에 열어 본 주보면 명단·출석·노트를 **먼저 그린다** — 없을 때만 빈 자리에서
    // 시작한다(present는 Set이라 캐시에는 배열로 둔다 — cache.js는 JSON만 받는다)
    const key = `worship:svc:${svc.id}`;
    const hit = readCache(key);
    setRoster(hit?.roster || { people: [], groups: [], members: [], roles: [] });
    setPresent(new Set(hit?.present || []));
    setGuests(hit?.guests || []);
    setNote(hit?.note ?? null);
    setFiles(hit?.files || []);
    try {
      const [r, att, gs, n, fs] = await Promise.all([
        fetchRoster(serviceYear(svc.service_date)),
        fetchAttendance(svc.id),
        fetchGuests(svc.id),
        canWriteNote ? fetchMyNote(svc.id) : Promise.resolve(null),
        fetchServiceFiles(svc.id),
      ]);
      setRoster(r); setPresent(new Set(att)); setGuests(gs); setNote(n);
      // 올리는 중인 줄은 조회 결과가 덮지 않는다 — 드라이브에도 DB에도 아직 없어서
      // 이 조회에 안 잡히는데, 그대로 갈아 끼우면 방금 고른 파일이 화면에서 사라진다.
      setFiles(prev => [...fs, ...prev.filter(f => f._pending)]);
      writeCache(key, { roster: r, present: att, guests: gs, note: n, files: fs });
    } catch (e) {
      console.error('[worship] 주보 상세 실패:', e);
      showToast(fail('주보에 딸린 명단과 출석을 받지 못했어요', e, { 42501: '승인된 멤버만 명단을 볼 수 있어요' }));
    }
  }, [canWriteNote]);

  // ── 딥링크 진입 (`/?p=worship&s=<주보 id>` · 0053의 알림 link) ──────────────
  // 알림에서 눌러 들어오면 목록이 아니라 **그 주보 상세**를 연다. 두 갈래를 한 이펙트가
  // 받는다: ① 새로 열린 앱(주소에 실려 온 값 — entryQuery가 모듈 로드 때 붙잡아 둔다)
  // ② 이미 떠 있는 앱에서 종을 누른 경우(App이 setEntryQuery로 값을 넣고 신호를 보낸다).
  // **값을 붙잡아 두는 이유**: takeEntryParam은 한 번 읽으면 지우는데, 그 순간 목록이 아직
  // 안 왔을 수 있다(첫 진입은 조회가 돈다). 기억해 두었다가 그 주보가 목록에 나타나면 연다.
  //
  // **ref가 아니라 state다**(2026-09-19). 그리는 쪽이 "지금 딥링크로 들어오는 중"을 알아야
  // 목록 대신 DETAIL_LOADING을 세울 수 있는데, ref는 렌더를 부르지 않는다. 초기값을
  // `entryParam('s')`로 잡아 **첫 렌더부터** 안다 — 홈 카드 경로는 App.handleOpenLink가
  // setEntryQuery를 먼저 부르고 화면을 바꾸므로, 이 화면이 마운트될 때 값이 이미 들어 있다
  // (읽기만 하는 entryParam이다 — 지우는 것은 아래 이펙트의 몫이다).
  const entrySignal = useEntryQuery();
  const [wantId, setWantId] = useState(() => entryParam('s'));
  useEffect(() => {
    // 가져가면 지운다 — 같은 값으로 두 번 열지 않게. 첫 렌더의 초기값과 같은 값이면
    // 이미 손에 있으니 그대로 이어서 본다(한 프레임을 버리지 않는다).
    const taken = takeEntryParam('s');
    if (taken && taken !== wantId) { setWantId(taken); return; }
    if (!wantId) return;
    // 목록을 못 읽었다(캐시도 없다) — 딥링크를 내려놓는다. 안 그러면 상세 스켈레톤이 영영 남는다.
    if (!services) { if (listFailed) setWantId(null); return; }
    const svc = services.find(s => s.id === wantId);
    if (svc) { setWantId(null); open(svc); return; }
    // 목록에 없다 — 두 갈래다.
    // ① 아직 캐시 목록이다(stale): 새로 읽은 목록이 오면 다시 본다. 갓 발행된 주보는
    //    캐시에 없으므로 여기서 포기하면 알림으로 들어온 사람에게 목록이 스친다.
    // ② 새로 읽은 목록인데도 없다(삭제·미발행·잘못된 링크) 또는 목록을 못 읽었다:
    //    **포기하고 목록을 보여 준다.** 안 그러면 스켈레톤이 영영 남는다.
    if (cached.stale && !cached.error) return;
    setWantId(null);
  }, [entrySignal, services, open, wantId, cached.stale, cached.error, listFailed]);

  const create = useCallback(async (v) => {
    try {
      const made = await createService(v);
      setServices(list => [made, ...(list || [])]);
      invalidate();
      // 만들면 목록이 아니라 그 주보의 수정 화면으로 바로 간다(사용자 결정) —
      // 갓 만든 주보는 전부 빈 칸이라 목록으로 돌아갈 이유가 없다
      open(made, { edit: true });
      return true;
    } catch (e) {
      console.error('[worship] 주보 만들기 실패:', e);
      showToast(fail('주보를 만들지 못했어요', e, {
        23505: '그 날짜의 주일 예배 주보가 이미 있어요',
        42501: '주보는 회장·교역자·미디어팀·관리자만 만들 수 있어요',
      }));
      return false;
    }
  }, [open, invalidate]);

  const save = useCallback(async (patch) => {
    try {
      const row = await saveService(openId, patch);
      setServices(list => (list || []).map(s => (s.id === openId ? { ...s, ...(row || patch) } : s)));
      invalidate();
      return true;
    } catch (e) {
      console.error('[worship] 주보 저장 실패:', e);
      showToast(fail('주보를 저장하지 못했어요', e, { 42501: NEED_EDIT, PGRST116: GONE }));
      return false;
    }
  }, [openId, invalidate]);

  const publish = useCallback(async () => {
    try {
      await publishService(openId);
      setServices(list => (list || []).map(s => (s.id === openId ? { ...s, status: 'published' } : s)));
      invalidate();
      showToast('주보를 발행했어요');
      // 승인 멤버 전원에게 알린다(0053). **기다리지 않는다** — 발행은 이미 끝났고,
      // 알림이 늦거나 실패해도 화면은 그대로다(services/worship.js가 콘솔에만 남긴다).
      if (service) void notifyServicePublished({ ...service, status: 'published' });
    } catch (e) {
      console.error('[worship] 주보 발행 실패:', e);
      showToast(fail('주보를 발행하지 못했어요', e, { 42501: NEED_EDIT, PGRST116: GONE }));
    }
  }, [openId, service, invalidate]);

  const drop = useCallback(async () => {
    const id = openId;
    try {
      await removeService(id);
      setServices(list => (list || []).filter(s => s.id !== id));
      invalidate();
      setOpenId(null); setScreen('list');
    } catch (e) {
      console.error('[worship] 주보 삭제 실패:', e);
      showToast(fail('주보를 삭제하지 못했어요', e, {
        42501: NEED_EDIT, PGRST116: GONE,
        23503: '이 주보에 딸린 출석 기록이 아직 남아 있어요',
      }));
    }
  }, [openId, invalidate]);

  // 노트를 순에 공유로 **바꾸는 순간에만** 순장에게 알린다(0053). 이미 공유 상태에서
  // 글만 다시 저장하는 것은 알림이 아니다 — 그러면 고칠 때마다 순장에게 종이 울린다.
  const notifyIfNewlyShared = useCallback((wasShared, nowShared) => {
    if (wasShared || !nowShared || !service) return;
    void notifyNoteShared(service);
  }, [service]);

  const saveNote = useCallback(async ({ body, sharedToSun }) => {
    const wasShared = !!note?.shared_to_sun;
    try {
      const row = await saveMyNote(openId, { body, sharedToSun });
      if (row) setNote(row);
      invalidate();
      notifyIfNewlyShared(wasShared, !!sharedToSun);
      return true;
    } catch (e) {
      console.error('[worship] 예배 노트 저장 실패:', e);
      showToast(fail('예배 노트를 저장하지 못했어요', e, {
        42501: '노트는 로그인한 본인만 쓸 수 있어요',
        PGRST116: GONE,
      }));
      return false;
    }
  }, [openId, note, invalidate, notifyIfNewlyShared]);

  // 상세 캐시(`worship:svc:<id>`)의 출석만 그 자리에서 갈아 끼운다. 출석은 주보 목록을
  // 바꾸지 않으므로 목록을 다시 읽을 이유가 없다 — 칩 하나에 조회 넷이 돌던 자리다.
  const patchAttendanceCache = useCallback((personId, next) => {
    const key = `worship:svc:${openId}`;
    const hit = readCache(key);
    if (!hit) return;
    const list = new Set(hit.present || []);
    if (next) list.add(personId); else list.delete(personId);
    writeCache(key, { ...hit, present: [...list] });
  }, [openId]);

  // 목록 카드의 '출석 N명'을 그 자리에서 더하고 뺀다. 목록을 다시 읽으면 출석 칩 한 번에
  // 조회가 통째로 돌아서(위 patchAttendanceCache와 같은 이유) 지역 상태와 목록 캐시를
  // 같이 고친다 — 안 고치면 출석을 부르고 목록으로 나갔을 때 옛 숫자가 한 번 보인다.
  const patchCount = useCallback((delta) => {
    if (!openId || !delta) return;
    const bump = (m = {}) => ({ ...m, [openId]: Math.max(0, (m[openId] || 0) + delta) });
    setCounts(bump);
    const key = `worship:list:${year}`;
    const hit = readCache(key);
    if (hit) writeCache(key, { ...hit, counts: bump(hit.counts) });
  }, [openId, year]);

  // 출석은 먼저 화면에 반영하고 실패하면 되돌린다 — 한 명씩 누르는 조작이라
  // 서버를 기다리면 목록 전체가 굼떠 보인다.
  const toggle = useCallback(async (personId, next) => {
    // 누구의 출석인지까지 말한다 — 칩 여러 개를 잇달아 누르면 어느 것이 실패했는지
    // 토스트만 보고는 알 수 없다(이름은 이미 명단에 있다)
    const who = (roster.people || []).find(p => p.id === personId)?.name || '그 청년';
    setPresent(prev => {
      const s = new Set(prev);
      if (next) s.add(personId); else s.delete(personId);
      return s;
    });
    try {
      await (next ? checkIn : checkOut)(openId, personId);
      patchAttendanceCache(personId, next);
      patchCount(next ? 1 : -1);
      dropCache('home');   // 홈의 '내 순' 카드가 지난 주일 참석 수를 센다(homeView)
    } catch (e) {
      console.error('[worship] 출석 변경 실패:', e);
      // **23505는 되돌리지 않는다.** 넣으려던 상태가 이미 참인 것이라 DB에는 출석이
      // 있는데 화면만 끄면 정확히 반대로 말하게 된다(services의 checkIn은 upsert라
      // 여기까지 오지도 않지만, 경합으로 다른 길에서 올 수 있다).
      const dup = String(e?.code) === '23505';
      if (dup && next) { patchAttendanceCache(personId, true); patchCount(1); return; }
      setPresent(prev => {
        const s = new Set(prev);
        if (next) s.delete(personId); else s.add(personId);
        return s;
      });
      showToast(fail(next ? `${who}님을 출석으로 표시하지 못했어요` : `${who}님의 출석을 취소하지 못했어요`, e, {
        23505: '이미 출석으로 표시되어 있어요\n새로고침해주세요',
        42501: '내 순 청년만 출석을 만질 수 있어요\n다른 순은 리더순장·교역자가 체크해요',
        23503: '이 주보나 명단이 이미 지워졌어요\n새로고침해주세요',
      }));
    }
  }, [openId, roster.people, patchAttendanceCache, patchCount]);

  // 상세 캐시의 손님 목록만 갈아 끼운다(출석 칩과 같은 이유 — 목록을 다시 읽지 않는다)
  const patchGuestCache = useCallback((rows) => {
    const key = `worship:svc:${openId}`;
    const hit = readCache(key);
    if (hit) writeCache(key, { ...hit, guests: rows });
  }, [openId]);

  // 미등록 출석자 — **명단에 올리지 않는다**(사용자 결정 2026-09-07 · 0053). 예전에는
  // people에 행을 만들고 순장이면 자기 순(group_members)에까지 넣었는데, 출석을 부르다
  // 잘못 적은 이름이 그대로 청년 명단에 남았고 이 화면에는 지우는 길이 없었다.
  // 지금은 그 예배의 손님 한 줄이고, 걸음도 하나다(그래서 실패도 한 가지다).
  const addGuest = useCallback(async (name) => {
    const clean = String(name || '').trim();
    try {
      const made = await addGuestRow(openId, clean);
      if (!made) return null;
      setGuests(prev => { const next = [...prev, made]; patchGuestCache(next); return next; });
      patchCount(1);
      dropCache('home');
      return made;
    } catch (e) {
      console.error('[worship] 미등록 출석자 추가 실패:', e);
      showToast(fail(`${clean}님을 미등록 출석자로 올리지 못했어요`, e, {
        42501: '출석을 체크할 수 있는 사람만 올릴 수 있어요',
        23503: '이 주보가 이미 지워졌어요\n새로고침해주세요',
      }));
      return null;
    }
  }, [openId, patchGuestCache, patchCount]);

  // **확인 없이 바로 지운다**(알림 지우기와 같은 판단 · §8) — 잃는 것이 이름 한 줄이다.
  // 대신 실패하면 그 자리에 되돌려 놓는다(줄이 사라진 채로 두면 지워진 것으로 읽힌다).
  const removeGuest = useCallback(async (row) => {
    let before = [];
    setGuests(prev => { before = prev; const next = prev.filter(g => g.id !== row.id); patchGuestCache(next); return next; });
    patchCount(-1);
    dropCache('home');
    try {
      await removeGuestRow(row.id);
    } catch (e) {
      console.error('[worship] 미등록 출석자 삭제 실패:', e);
      setGuests(before); patchGuestCache(before); patchCount(1);
      showToast(fail(`${row.name}님을 지우지 못했어요`, e, {
        42501: '출석을 체크할 수 있는 사람만 지울 수 있어요',
      }));
    }
  }, [patchGuestCache, patchCount]);

  // 공유만 바꾸는 길 — 글을 다시 보내지 않는다(services의 setNoteShared 한 벌).
  // 모임 화면의 '공유된 노트' 목록도 같은 함수를 쓰기로 했다(보고서의 계약).
  const shareNote = useCallback(async (shared) => {
    const wasShared = !!note?.shared_to_sun;
    try {
      const row = await setNoteShared(openId, shared);
      if (row) setNote(row);
      invalidate();
      notifyIfNewlyShared(wasShared, !!shared);
      return true;
    } catch (e) {
      console.error('[worship] 예배 노트 공유 변경 실패:', e);
      showToast(fail(shared ? '노트를 순에 공유하지 못했어요' : '노트를 나만 보기로 바꾸지 못했어요', e, {
        42501: '노트는 로그인한 본인만 바꿀 수 있어요',
        PGRST116: '이 노트가 이미 지워졌어요\n새로고침해주세요',
      }));
      return false;
    }
  }, [openId, note, invalidate, notifyIfNewlyShared]);

  // ── 주보에 붙는 파일 — 송폼 · 큐시트 (0047 · 갈래는 0054) ─────────────────
  // 저장 자리·드라이브 길은 업무 첨부와 한 벌이다(services/worship.js). 여기가 갖는
  // 것은 통신과 낙관적 목록뿐이다 — 화면(worshipDetail)은 props로 받은 줄만 그린다.
  //
  // **송폼과 큐시트가 이 함수 하나를 쓴다**(2026-09-08). 다른 것은 `kind` 인자뿐이고
  // 목록·캐시·드라이브 폴더는 그대로다 — 두 번째 업로드 길을 내면 §6-29-u다.
  //
  // **고르자마자 목록에 선다**(§6-29-k). 드라이브 왕복이 5~10초라 그동안 아무것도
  // 안 보이면 화면이 아무 일도 안 하는 것처럼 읽힌다. 바이트는 메모리에만 있으므로
  // 아직 없는 것(삭제)은 그 줄에 달지 않는다.
  // **폴더를 파일보다 먼저**(§6-29-h) — 가벼운 호출로 한 번만 판다. 실패해도 올린다:
  // 스크립트가 path로 폴더를 찾는 폴백이 있어 파일은 제자리에 간다.
  const serviceFolder = useCallback(async () => {
    let folderId = null;
    try { folderId = await ensureServiceDriveFolder(service); }
    catch (e) { console.error('[worship] 주보 폴더 확보 실패:', e); }
    if (folderId && !service.drive_folder_id) {
      setServices(list => (list || []).map(s => (s.id === service.id ? { ...s, drive_folder_id: folderId } : s)));
    }
    return folderId;
  }, [service]);
  // 주보 파일이 드라이브로 가는 **한 자리**(§6-29-u) — 송폼·큐시트·표지(0081)가 kind만 달리해 여기를 지난다
  const sendServiceFile = useCallback((file, folderId, kind) => uploadServiceFile(service, file, folderId, { kind }), [service]);

  const uploadFiles = useCallback(async (fileList, kind = SONGFORM) => {
    const picked = Array.from(fileList || []);
    if (!picked.length || !service) return;
    // 용량 초과는 여기서 걸러 낸다 — 상한은 config.js 한 곳이고 첨부와 같은 값이다
    picked.filter(f => f.size > MAX_UPLOAD_BYTES)
      .forEach(f => showToast(`'${f.name}'은(는) ${MAX_UPLOAD_MB}MB를 넘어 첨부하지 못했어요.`));
    const ok = picked.filter(f => f.size <= MAX_UPLOAD_BYTES);
    if (!ok.length) return;
    const staged = ok.map(f => ({
      id: `local:${f.name}:${f.size}:${f.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
      // 갈래를 **올리는 중인 줄에도** 실어 둔다 — 안 실으면 그 줄이 fileKindOf의 기본값
      // 때문에 송폼으로 읽혀, 큐시트에 고른 파일이 올라가는 동안 찬양 탭에 가서 선다.
      service_id: service.id, kind, name: f.name, size_bytes: f.size, mime_type: f.type || null,
      source: 'local', _pending: true, _file: f,
    }));
    setFiles(prev => [...prev, ...staged]);
    const folderId = await serviceFolder();
    for (let i = 0; i < ok.length; i += 1) {
      const stagedId = staged[i].id;
      try {
        const row = await sendServiceFile(ok[i], folderId, kind);
        setFiles(prev => prev.map(x => (x.id === stagedId ? row : x)));
      } catch (e) {
        console.error('[worship] 주보 파일 올리기 실패:', e);
        setFiles(prev => prev.filter(x => x.id !== stagedId));
        showToast(fail(`'${ok[i].name}'을(를) 올리지 못했어요`, e, { 42501: NEED_EDIT_FILE }));
      }
    }
    invalidate();
  }, [service, invalidate, serviceFolder, sendServiceFile]);

  // **줄을 먼저 지우고 서버에 알린다**(§6-29-e와 같은 순서 · 첨부와 한 벌).
  // 실패하면 되돌린다 — 지워진 척하고 사라지면 파일을 잃은 것으로 읽힌다.
  const removeFile = useCallback(async (row) => {
    let before = [];
    setFiles(prev => { before = prev; return prev.filter(x => x.id !== row.id); });
    try {
      await removeServiceFile(row);
      invalidate();
    } catch (e) {
      console.error('[worship] 주보 파일 삭제 실패:', e);
      setFiles(before);
      showToast(fail(`'${row.name}'을(를) 지우지 못했어요`, e, { 42501: NEED_EDIT_FILE }));
    }
  }, [invalidate]);

  // ── 표지 사진 (0081) ──────────────────────────────────────────────────────
  // 올리는 길은 위 송폼·큐시트와 **한 벌**이다(uploadServiceFile · 같은 폴더 · kind만 'cover').
  // 주보당 한 장 — 새 것이 들어간 **뒤에** 옛 것을 지운다(올리다 실패하면 옛 표지가 그대로 남게).
  // 새 사진은 보일 위치를 .5로 되돌린다(창은 화면이 곧바로 연다 — worshipDetail).
  // 고르자마자 브라우저 안 주소(_src)로 먼저 선다(§6-29-k — 드라이브 왕복이 5~10초다).
  const uploadCover = useCallback(async (file) => {
    if (!service || !file) return false;
    if (!String(file.type || '').startsWith('image/')) { showToast('표지는 사진 파일만 올릴 수 있어요'); return false; }
    if (file.size > MAX_UPLOAD_BYTES) { showToast(`'${file.name}'은(는) ${MAX_UPLOAD_MB}MB를 넘어 올리지 못했어요.`); return false; }
    const sid = service.id;
    const old = covers[sid] && !covers[sid]._pending ? covers[sid] : null;
    const local = URL.createObjectURL(file);
    setCovers(prev => ({ ...prev, [sid]: { id: `local:${file.name}`, service_id: sid, kind: COVER, _pending: true, _src: local } }));
    if (Number(service.cover_focus_y ?? 0.5) !== 0.5) void save({ cover_focus_y: 0.5 });
    try {
      const row = await sendServiceFile(file, await serviceFolder(), COVER);
      setCovers(prev => ({ ...prev, [sid]: { ...row, _src: row._src || local } }));
      if (old?.id) {
        try { await removeServiceFile(old); } catch (e) { console.error('[worship] 옛 표지 정리 실패:', e); }
      }
      invalidate();
      return true;
    } catch (e) {
      console.error('[worship] 표지 올리기 실패:', e);
      setCovers(prev => { const next = { ...prev }; if (old) next[sid] = old; else delete next[sid]; return next; });
      showToast(fail('표지 사진을 올리지 못했어요', e, { 42501: NEED_EDIT_FILE }));
      return false;
    }
  }, [service, covers, save, invalidate, serviceFolder, sendServiceFile]);

  const removeCover = useCallback(async () => {
    const sid = service?.id;
    const row = sid ? covers[sid] : null;
    if (!row || row._pending) return;
    setCovers(prev => { const next = { ...prev }; delete next[sid]; return next; });
    try {
      await removeServiceFile(row);
      invalidate();
    } catch (e) {
      console.error('[worship] 표지 제거 실패:', e);
      setCovers(prev => ({ ...prev, [sid]: row }));
      showToast(fail('표지 사진을 지우지 못했어요', e, { 42501: NEED_EDIT_FILE }));
    }
  }, [service, covers, invalidate]);

  const saveCoverFocus = useCallback((y) => save({ cover_focus_y: y }), [save]);

  // 올리는 중에 탭을 닫으면 그 파일은 드라이브에도 DB에도 없이 사라진다 — 바이트가
  // 메모리에만 있기 때문이다(§6-29-k). 업무 첨부와 같이 브라우저가 먼저 묻는다.
  useEffect(() => {
    if (!files.some(f => f._pending)) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [files]);

  // 출석 메모는 **주보를 쓰는 길이 아니다**(사용자 결정 2026-09-06). `saveService`로 보내면
  // `services_write`(can_edit_service)라 순장에게 42501이었다 — 0052의 rpc가 그 한 칸만
  // 쓰고, 자격은 '출석을 체크할 수 있는 사람'이다(services/worship.js의 주석).
  const saveAttendanceNote = useCallback(async (text) => {
    try {
      await saveAttendanceNoteRow(openId, text);
      setServices(list => (list || []).map(s => (s.id === openId ? { ...s, attendance_note: text } : s)));
      invalidate();
      return true;
    } catch (e) {
      console.error('[worship] 출석 메모 저장 실패:', e);
      showToast(fail('출석 메모를 저장하지 못했어요', e, {
        42501: '출석을 체크할 수 있는 사람만 메모를 남길 수 있어요',
        P0002: GONE, PGRST116: GONE,
      }));
      return false;
    }
  }, [openId, invalidate]);

  // 유튜브 재생목록 → 찬양 목록. 통신은 이 파일이 갖고(worshipDetail 머리말) 화면은
  // 돌려받은 목록을 그대로 쓴다. **왜 안 됐는지는 원인마다 다르다** — 주소가 아닌지,
  // 게스트 모드인지, 배포된 앱이 아닌지, 재생목록이 비공개인지(services/worship.js가
  // 이유를 만들고 여기서 '무엇을 못 했는지'를 앞에 붙인다).
  const pullPlaylist = useCallback(async (url, rows) => {
    try {
      const picked = await fetchPlaylistSongs(url);
      const next = mergeSongs(rows, picked);
      const added = next.length - (rows || []).length;
      showToast(added ? `${added}곡을 가져왔어요` : '가져올 새 곡이 없어요\n재생목록의 곡이 이미 다 들어 있어요');
      return added ? next : null;
    } catch (e) {
      // 서버 함수가 없는 환경(게스트·로컬 vite)이나 주소를 잘못 붙인 것은 고장이
      // 아니다 — 토스트 한 줄로 끝내고 콘솔에는 남기지 않는다(worship.js의 quiet)
      if (!e?.quiet) console.error('[worship] 재생목록 가져오기 실패:', e);
      showToast(fail('재생목록을 가져오지 못했어요', e));
      return null;
    }
  }, []);

  // 링크만 붙였을 때 제목을 채운다. 실패하면 아무 말도 하지 않는다 — 사람이 부탁한
  // 일이 아니라 곁들이는 일이고, 제목은 손으로 적으면 된다.
  const lookupTitle = useCallback(async (url) => {
    try { return await fetchVideoTitle(url); } catch { return ''; }
  }, []);

  // ── 내 예배 노트 모아 보기 (2026-09-25) ─────────────────────────────────────
  // 들어올 때마다 다시 읽는다 — 지난번 값(캐시)이 있으면 그것을 먼저 세운다(목록과 같은 관례).
  // 못 읽었을 때: 캐시가 있으면 그대로 두고 토스트, 없으면 빈 자리에 실패 두 줄(D2 · 토스트 없음).
  const NOTES_FAIL = '내 예배 노트를 받지 못했어요';
  const loadNotes = useCallback(async () => {
    setNotesFail(null);
    try {
      const rows = await fetchMyNotes();
      setMyNotes(rows); writeCache('worship:mynotes', rows);
    } catch (e) {
      console.error('[worship] 내 예배 노트 실패:', e);
      if (readCache('worship:mynotes')) showToast(fail(NOTES_FAIL, e));
      else setNotesFail(e);
    }
  }, []);
  const openNotes = useCallback(() => { setScreen('notes'); void loadNotes(); }, [loadNotes]);
  const noteRows = useMemo(() => (myNotes ? myNoteRows(myNotes, services || []) : null), [myNotes, services]);
  // 0건 자리의 '{M월 D일} 예배 노트 쓰기'가 가리키는 주보 — 발행본 중 오늘(KST)까지 드린 가장 최근 것.
  // 홈 예배 카드(미래 포함)와 기준이 다르다: 아직 드리지 않은 예배의 노트를 권하지 않는다.
  const writeTarget = useMemo(() => {
    const today = kstNow().slice(0, 10);
    return (services || []).filter(s => s?.status === 'published' && /^\d{4}-\d{2}-\d{2}$/.test(String(s.service_date || ''))
      && String(s.service_date) <= today)
      .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)))[0] || null;
  }, [services]);

  // ── 광고 → 내 달력 (2026-09-25 · api/ics.js · services/noticeDate.js) ─────────
  // 기기마다 길이 다르다(목업 '넣는 길'):
  //   · 안드로이드 — 구글 캘린더 템플릿 주소(앱이 받는다 · 구글 캘린더 앱은 .ics를 못 여는 기기가 많다)
  //   · 아이폰·데스크톱 — 서버의 서명 주소(.ics를 text/calendar로 연다 → 캘린더 '추가' 화면)
  //   · 카카오 인앱 — 위 주소를 `kakaotalk://web/openExternal`로 기본 브라우저에 넘긴다(안내 문구 없음 ·
  //     실기기 확인 대상 — 인앱 웹뷰는 text/calendar를 받아도 아무 일도 안 하거나 내려받기로 떨어진다)
  //   · 게스트 — 서버가 없다. 같은 글자로 만든 .ics를 blob으로 내려받는다.
  // 안드로이드 주소는 누른 그 자리에서 만든다(await 없이 — 새 창을 여는 자격이 살아 있을 때).
  const addToCalendar = useCallback(async (svc, index, notice, read) => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const kakao = isKakaoInApp(ua);
    const ev = noticeEvent(svc, notice, index, read, kindLabel(svc.kind));
    if (/Android/i.test(ua)) {
      const g = googleCalendarUrl(ev);
      if (kakao) window.location.href = kakaoExternal(g);
      else window.open(g, '_blank', 'noopener');
      return;
    }
    try {
      const url = await noticeIcsUrl(svc.id, index);
      if (!url) {
        // 게스트(서버 없음) — blob
        const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href; a.download = `${ev.title}.ics`; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        return;
      }
      const abs = new URL(url, window.location.origin).href;
      window.location.href = kakao ? kakaoExternal(abs) : abs;
    } catch (e) {
      if (!e?.quiet) console.error('[worship] 달력에 넣기 실패:', e);
      showToast(fail('달력에 넣지 못했어요', e));
    }
  }, []);

  // 첫 읽기 실패(캐시 없음) — 목록 껍데기(머리줄·거르기 칩)에 빈 자리 대신 실패가 선다(D2).
  // 자격은 못 읽었으니 계정 속성으로만 판정한다(버튼을 감추는 용도 — 실제 경계는 RLS).
  if (listFailed) {
    return <ServiceList services={[]} perms={perms || worshipPerms({ isMaster, isAdmin })}
      onOpen={open} onCreate={create}
      failed={{ reason: reasonOf(cached.error, LIST_FAIL_BY), onRetry: retryList }} />;
  }
  // 딥링크로 들어오는 중이면 목록 스켈레톤도 아니다 — 갈 데는 상세다(DETAIL_LOADING 머리말)
  if (!perms || services === null) return wantId ? DETAIL_LOADING : LOADING;

  if (screen === 'notes') {
    return (
      <MyNotesScreen rows={noteRows} onBack={() => setScreen('list')}
        writeTarget={writeTarget} onWrite={(svc) => open(svc, { note: true })}
        failed={notesFail && !myNotes ? { reason: reasonOf(notesFail), onRetry: () => { setNotesFail(null); void loadNotes(); } } : null}
        onOpenService={(svc) => open(svc)} />
    );
  }

  if (screen === 'attendance' && service) {
    return (
      <AttendanceScreen
        service={service} roster={roster} present={present} guests={guests} perms={perms}
        onToggle={toggle} onAddGuest={addGuest} onRemoveGuest={removeGuest} onSaveNote={saveAttendanceNote}
        onBack={() => setScreen('detail')}
      />
    );
  }

  if (screen === 'detail' && service) {
    // 출석에 다녀오면 **보기 모드로 돌아온다**(onOpenAttendance가 editOnOpen을 끈다) —
    // 갓 만든 주보는 그 표시가 켜져 있어서, 그대로 두면 ServiceDetail이 다시 마운트될 때
    // 수정 화면으로 들어간다. 출석은 보기 모드에서만 들어가므로 꺼도 잃는 것이 없다.
    return (
      <ServiceDetail
        service={service} people={roster.people} personRoles={roster.roles} perms={perms} note={note} canWriteNote={canWriteNote}
        startEditing={editOnOpen} files={files} recentSongs={recentSongs} prefill={prefill}
        onUploadFiles={uploadFiles} onRemoveFile={removeFile}
        cover={covers[service.id] || null} onUploadCover={uploadCover} onRemoveCover={removeCover} onSaveCoverFocus={saveCoverFocus}
        onBack={() => { setScreen('list'); setOpenId(null); setEditOnOpen(false); setNoteOnOpen(false); }}
        onSave={save} onPublish={publish} onDelete={drop} onSaveNote={saveNote}
        onOpenAttendance={() => { setEditOnOpen(false); setNoteOnOpen(false); setScreen('attendance'); }}
        onOpenBible={onOpenBible}
        onPullPlaylist={pullPlaylist} onLookupTitle={lookupTitle} onShareNote={shareNote}
        onAddToCalendar={addToCalendar} focusNote={noteOnOpen}
      />
    );
  }

  // 목록은 왔는데 그 주보를 아직 못 열었다(이펙트가 다음 틱에 연다) — 그 한 프레임이
  // 바로 사용자가 본 '목록이 스치는' 자리다. 여기서도 목록을 그리지 않는다.
  // 스켈레톤이 영영 남지 않게 하는 것은 위 진입 이펙트의 ② 갈래다.
  if (wantId) return DETAIL_LOADING;

  return <ServiceList services={services} perms={perms} counts={counts} covers={covers} onOpen={open} onCreate={create}
    onOpenNotes={canWriteNote ? openNotes : null} />;
}
