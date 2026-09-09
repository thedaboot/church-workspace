import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Heart, Loader2, Pencil, Pin, Wand2 } from 'lucide-react';
import logoLight from '../assets/logo-light.png';
import { Skeleton } from './media.jsx';
import { SectionHead } from '../views/dashboardParts.jsx';
import { BTN, BTN_QUIET, MenuPick, WITH_ICON } from './groupsParts.jsx';
import { showToast } from './Toast.jsx';
import { supabase } from '../services/supabaseClient.js';
import { dropCache, useCached } from '../services/cache.js';
import { failText } from '../services/errorText.js';
import { useSheetShare } from '../hooks/useSheetShare.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import {
  LIMITS,
  fitGuide, generateGuide, guideDateLabel, guidePickLabel, guideServiceDate, guideServiceLabel,
  guidedServiceIds, loadGuide, pinGuide, saveGuide, splitBold,
} from '../services/sunGuide.js';

// ============================================================================
// 순모임 가이드 섹션 — 내 순 탭의 **순 카드 밑** (docs/V2.md · 0039 · 0055 ·
// services/sunGuide.js)
// ----------------------------------------------------------------------------
// 자리와 머리줄은 사용자 지적으로 두 번째 판이다(2026-09-03 — "버튼 배치를 왜 이렇게
// 해놨나, 섹션은 순 카드 밑으로"). 처음에는 카드 위에 놓고, 제목과 버튼을 종이 폭
// (560px)에 맞춰 화면 가운데에 띄웠다 — 그래서 제목이 순 카드의 어느 선과도 맞지
// 않고 버튼만 허공에 떠 보였다. 지금은 **화면의 다른 섹션과 같은 머리줄**이다:
// SectionHead(제목 왼쪽 · 가로선 · 동작 오른쪽 끝) — '구성원 3명'·'모임'과 한 벌이고,
// 종이는 그 머리줄 왼쪽 끝에서 시작한다.
// ----------------------------------------------------------------------------
// **종이는 늘 밝다**(사용자 스펙 2026-09-08 — "만든 가이드를 이미지로 저장도 할 수
// 있게, 로고도 잘 포함될 수 있도록"). 이건 화면 UI가 아니라 **인쇄물**이고, 눌러서
// 그림으로 굽는 그 종이다. 다크 테마에서 어둡게 그리면 저장한 그림도 어둡게 나가거나,
// 화면과 파일이 서로 다른 그림이 된다 — 동아리 QR 카드와 같은 판단이다(ClubQr.jsx
// "카드는 언제나 밝다"). 그래서 종이 안쪽 색은 **라이트 토큰 값을 그대로 박고**,
// 종이를 감싸는 것(머리줄·버튼·편집 칸)은 여느 화면처럼 테마를 따라간다.
// 예전 판은 반대였다(종이 = --app-surface). 그 결정은 이미지 저장이 없던 때의 것이다.
//
// 값은 전부 `service`와 sun_guides의 body에서 온다. 자격 판정은 하지 않는다 —
// 부르는 쪽(모임 화면)이 `perms = { canView, canCreate, canPin }`로 넘긴다. 진실은
// RLS다(0039·0055: 보기 = 순장 + can_manage_sun, 쓰기 = 그 둘 · 고정된 행은 마스터만,
// 고정 = 마스터).
//
// **읽기는 이 패널이 한다**(2026-09-08에 바뀌었다). 기준 주보를 사람이 고를 수 있게
// 되면서 "바깥이 미리 읽어 둔 한 벌"로는 모자란다 — 고른 주보마다 다른 한 벌이다.
// 그래서 services/cache.js의 useCached를 주보 id로 걸고(`groups:guide:<id>`), 한 번
// 읽은 가이드는 다시 눌러도 AI를 부르지 않는다(사용자 스펙의 "캐싱 구조").
// 저장·고정 뒤에는 그 키를 비우고 다시 읽으며, 바깥에도 알린다(onChanged) — 바깥은
// '지금 고정된 주보'를 들고 있다.
//
// 소제목 번호('1.')와 질문의 'Q.', 예시 줄의 '(EX. …)'는 **여기서 붙인다** — body에
// 넣으면 모델이 번호를 어긋나게 매기고 글자수 상한도 번호가 잡아먹는다(sunGuide.js).
// ============================================================================

// 라이트 토큰 값 그대로다(index.css :root) — 위 머리말의 '종이는 늘 밝다'.
const PAPER = '#eeecef';   // --app-surface-hover — 종이 바탕(카드가 떠 보이게 canvas보다 한 단 깊다)
const CARD = '#fffdfc';    // --app-surface
const LINE = '#dcd8dc';    // --app-line
const INK = '#191720';     // --app-ink
const INK_2 = '#2b2833';   // --app-ink-secondary
const INK_M = '#6b6675';   // --app-ink-muted
const INK_F = '#a29daa';   // --app-ink-faint
const ACCENT = '#3f6fc4';  // --app-accent
const RED = '#993731';     // --app-tag-red-fg

// 종이 위의 큰 카드 — **위가 넓은 돔**이다(사용자가 준 템플릿). 가로 반지름은 폭의
// 46%라 375px에서도 1440px에서도 같은 모양이고, 세로 반지름만 고정이라 돔의 높이가
// 화면 폭을 따라 늘어나지 않는다(둘 다 %로 두면 세로로 긴 종이에서 돔이 반쯤 잡아먹는다).
// 두 가로 반지름의 합이 100%를 넘으면 브라우저가 비율로 줄인다 — 46 + 46 = 92%.
const DOME = '46% 46% 18px 18px / 84px 84px 18px 18px';


const HEART = <Heart size={11} className="fill-current shrink-0 block" style={{ color: ACCENT }} />;

// 종이 안의 머리 — 하트 + 이름. 템플릿의 '♥ 주일 본문' 그대로다.
// (화면 섹션의 머리줄은 dashboardParts의 SectionHead다 — 이름이 겹치지 않게 나눈다.)
function SheetHead({ children, className = '' }) {
  return (
    <p className={`sun-guide-head flex items-center gap-1.5 text-[13px] font-bold ${className}`}
      style={{ color: INK }}>
      {HEART}<span>{children}</span>
    </p>
  );
}

// 굵게 마커를 <strong>으로. **HTML을 삽입하지 않는다**(§6-43과 같은 정신 — 모델이
// 돌려준 글에 태그가 섞여 있어도 글자로만 보인다).
function Rich({ text, className = '' }) {
  const parts = useMemo(() => splitBold(text), [text]);
  return (
    <p className={`sun-guide-body text-[12.5px] leading-[1.75] ${className}`} style={{ color: INK_2 }}>
      {parts.map((p, i) => (p.bold
        ? <strong key={i} className="font-bold" style={{ color: INK }}>{p.text}</strong>
        : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </p>
  );
}

// 빨간 소제목 — 템플릿의 번호 소제목.
const Sub = ({ children, className = '' }) => (
  <p className={`sun-guide-sub text-[12.5px] font-bold ${className}`} style={{ color: RED }}>{children}</p>
);

// ── 편집 ────────────────────────────────────────────────────────────────────
// 미리보기가 곧 편집이다 — AI 초안을 그대로 저장하는 자리가 아니라 사람이 다듬는
// 자리다(사용자 피드백 — "내용만 AI가 글자수에 맞게 채우는 것").
// 카운터는 상한이 있는 칸에만 붙는다. 넘겨 써도 막지 않고 저장할 때 문장 경계에서
// 잘린다(fitGuide) — 타이핑 중에 글자가 사라지면 쓰던 문장을 잃는다.
function Field({ label, value, onChange, limit, rows = 2 }) {
  const over = limit != null && value.length > limit;
  return (
    <label className="sun-guide-field block">
      <span className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] font-semibold text-fg-muted">{label}</span>
        <span className="flex-1" />
        {limit != null && (
          <span className="sun-guide-count text-[10.5px] tabular-nums"
            style={{ color: over ? 'var(--app-tag-red-fg)' : 'var(--app-ink-faint)' }}>
            {value.length}/{limit}
          </span>
        )}
      </span>
      <textarea
        value={value} onChange={(e) => onChange(e.target.value)} rows={rows}
        className="w-full text-[12.5px] leading-[1.7] px-2.5 py-2 bg-surface border border-line rounded-md outline-none focus:border-accent text-fg resize-y"
      />
    </label>
  );
}

function Editor({ draft, setDraft, onSave, onRegen, onCancel, busy }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const setPoint = (i, patch) => set({
    points: draft.points.map((p, j) => (j === i ? { ...p, ...patch } : p)),
  });
  const setQuestion = (i, v) => set({ questions: draft.questions.map((q, j) => (j === i ? v : q)) });
  // 줄글 요약 두 칸은 **그 값을 들고 있는 지난 가이드에서만** 나온다 — 2026-09-08
  // 템플릿에는 없는 자리라, 없는 가이드에 빈 칸을 세우면 채워야 하는 칸처럼 보인다.
  const hasSummary = !!(draft.summary || draft.summaryRef);
  return (
    <div className="sun-guide-edit space-y-3">
      {/* 설교 제목은 주보에서 온다(services/sunGuide.js의 계약) — 그래도 고칠 수 있게
          둔다. 지난 가이드는 그때 모델이 지은 말을 들고 있고, 주보 제목이 길거나
          부제가 붙어 종이에서 줄을 잡아먹는 일이 있다. */}
      <Field label="설교 제목" value={draft.passage.title} rows={1}
        onChange={(v) => set({ passage: { ...draft.passage, title: v } })} />
      {hasSummary && (
        <>
          <Field label="요약이 다루는 구절" value={draft.summaryRef} limit={LIMITS.summaryRef} rows={1}
            onChange={(v) => set({ summaryRef: v })} />
          <Field label="말씀 요약" value={draft.summary} limit={LIMITS.summary} rows={6}
            onChange={(v) => set({ summary: v })} />
        </>
      )}
      {draft.points.map((p, i) => (
        <div key={i} className="space-y-2">
          <Field label={`${i + 1}. 소제목`} value={p.title} limit={LIMITS.pointTitle} rows={1}
            onChange={(v) => setPoint(i, { title: v })} />
          <Field label={`${i + 1}. 내용`} value={p.body} limit={LIMITS.pointBody} rows={5}
            onChange={(v) => setPoint(i, { body: v })} />
        </div>
      ))}
      {draft.questions.map((q, i) => (
        <Field key={i} label={`나눔 질문 ${i + 1}`} value={q} limit={LIMITS.question} rows={2}
          onChange={(v) => setQuestion(i, v)} />
      ))}
      <Field label="마지막 질문에 곁들일 예시" value={draft.questionNote} limit={LIMITS.questionNote} rows={2}
        onChange={(v) => set({ questionNote: v })} />
      {/* 도구 줄 — 모임 화면의 다른 도구 줄과 같은 짜임이다(§8 · gap-1.5 ·
          확정 왼쪽 / 나가기 오른쪽). 저장이 손가락 자리를 지킨다. */}
      <div className="sun-guide-tools flex items-center gap-1.5 pt-1">
        <button type="button" className={`sun-guide-save ${BTN}`} disabled={busy} onClick={onSave}>저장</button>
        <button type="button" className={`sun-guide-regen ${WITH_ICON} ${BTN_QUIET}`} disabled={busy} onClick={onRegen}>
          <Wand2 size={12} /><span>다시 만들기</span>
        </button>
        <span className="flex-1" />
        <button type="button" className={`sun-guide-cancel ${BTN_QUIET}`} disabled={busy} onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 템플릿 ──────────────────────────────────────────────────────────────────
// 사용자가 준 템플릿 그대로다: 머리 줄(왼쪽 날짜 · 세로선 · 오른쪽 '순모임 가이드')
// → 위가 돔인 흰 카드(로고 · ♥ 주일 본문 · ♥ 말씀 요약 · ♥ 오늘의 나눔 질문)
// → 짧은 가로선 + THE DABOOT MINISTRY.
//
// 머리 줄의 '순모임 가이드'는 섹션 머리줄과 같은 글자다. 한때 그게 실수처럼 보여서
// 뺐었는데(2026-09-03), 이제 이 종이는 **그림으로 나간다** — 카카오톡으로 받은 사람에게
// 이 줄이 없으면 무슨 종이인지 알 수 없다. 화면의 섹션 이름과 종이의 제목은 다른 일을
// 한다(하나는 화면 목차, 하나는 인쇄물의 제목).
function Sheet({ guide, dateLabel, sheetRef }) {
  // 빈 질문은 그리지 않는다 — fitGuide가 셋을 채워 두므로 넷째가 비어 있을 수 있고,
  // 빈 줄에 'Q.'만 남으면 종이에 구멍이 생긴다.
  const questions = guide.questions.filter((q) => q.trim());
  return (
    <div ref={sheetRef} className="sun-guide-sheet px-3 pt-3.5 pb-4 rounded-[14px]"
      style={{ background: PAPER, color: INK }}>
      <div className="sun-guide-top flex items-stretch" style={{ borderBottom: `1px solid ${LINE}` }}>
        <p className="sun-guide-head-date flex-1 min-w-0 px-1 pb-2 text-[17px] md:text-[19px] leading-tight tabular-nums truncate"
          style={{ color: INK }}>{dateLabel}</p>
        <p className="sun-guide-head-name shrink-0 pl-3 md:pl-4 pb-2 text-[17px] md:text-[19px] font-extrabold leading-tight"
          style={{ borderLeft: `1px solid ${LINE}`, color: INK }}>순모임 가이드</p>
      </div>

      <article className="sun-guide-page mt-3 px-5 md:px-8 pt-[46px] md:pt-[54px] pb-7"
        style={{ background: CARD, borderRadius: DOME }}>
        <img src={logoLight} width="640" height="469" alt="더다붓" decoding="async"
          className="sun-guide-logo block mx-auto h-9 md:h-10 w-auto" />

        <SheetHead className="mt-5">주일 본문</SheetHead>
        <p className="sun-guide-ref mt-2 text-[14.5px] font-extrabold break-words" style={{ color: INK }}>
          {guide.passage.ref}
          {guide.passage.title && (
            <span className="sun-guide-ref-title font-bold" style={{ color: RED }}> [{guide.passage.title}]</span>
          )}
        </p>

        <SheetHead className="mt-6">말씀 요약</SheetHead>
        {/* 줄글 요약 두 줄은 **지난 가이드에만** 있다(sunGuide.js 머리말) — 값이 있을
            때만 그린다. 빈 대괄호나 빈 단락이 남으면 안 된다. */}
        {guide.summaryRef && <Sub className="mt-2">{`[${guide.summaryRef} 배경 요약]`}</Sub>}
        {guide.summary && <Rich text={guide.summary} className="mt-1.5" />}
        {guide.points.map((p, i) => (
          <div key={i} className="mt-3">
            <Sub>{`${i + 1}. ${p.title}`}</Sub>
            <Rich text={p.body} className="mt-1.5" />
          </div>
        ))}

        <SheetHead className="mt-6">오늘의 나눔 질문</SheetHead>
        <div className="mt-2 space-y-2.5">
          {questions.map((q, i) => (
            <div key={i}>
              <p className="sun-guide-q flex gap-1.5 text-[12.5px] leading-[1.7]" style={{ color: INK_2 }}>
                <span className="font-bold shrink-0" style={{ color: RED }}>Q.</span>
                <span>{q}</span>
              </p>
              {/* 마지막 질문에 곁들이는 한 줄. 괄호와 'EX.'는 화면이 붙인다. */}
              {i === questions.length - 1 && guide.questionNote && (
                <p className="sun-guide-q-note mt-1 pl-[18px] text-[11px] leading-[1.6]"
                  style={{ color: INK_M }}>{`(EX. ${guide.questionNote})`}</p>
              )}
            </div>
          ))}
        </div>
      </article>

      <div className="sun-guide-foot mt-3.5 flex flex-col items-center gap-1.5">
        <span className="block w-9 h-px" style={{ background: LINE }} />
        <p className="sun-guide-mark text-[9.5px] font-semibold"
          style={{ color: INK_F, letterSpacing: '2.4px' }}>THE DABOOT MINISTRY</p>
      </div>
    </div>
  );
}

// ── 주보 고르기 ─────────────────────────────────────────────────────────────
// 아직 가이드가 없는 자리에는 **만들기 버튼 하나만 두지 않는다**(사용자 지시
// 2026-09-09 — "주보를 일단 먼저 사용자가 선택을 하고 나서 해당 주보에 대해서 만들 수
// 있게끔도 해줄 수 있나"). 버튼 하나뿐이면 무엇으로 만드는지가 머리줄의 작은 피커
// 안에만 있어서, 누르고 나서 종이 머리의 날짜를 보고서야 알았다. 그래서 고를 수 있는
// 주보(발행된 주일 · 최근순)를 줄로 펴고, 고른 줄을 강조하고, 만들기 버튼에 **그
// 날짜를 적는다**.
//
// 이미 가이드가 있는 주보에는 꼬리표가 붙는다 — 누르면 그 가이드가 열리므로, 지난
// 가이드를 다시 펴 보는 길이기도 하다. 종이가 서면 이 자리는 사라지고 머리줄의
// 피커가 같은 일을 이어받는다(같은 조작기를 두 벌 세우지 않는다).
//
// **모듈 바깥에 둔다**(§6-9-bf) — 화면 함수 안에서 만들면 렌더마다 리마운트라
// `.dc-row` 등장 모션이 그때마다 다시 돈다.
function Chooser({ items, selectedId, have, onPick }) {
  return (
    <ul className="sun-guide-choices space-y-1">
      {items.map((s) => {
        const on = s.id === selectedId;
        return (
          <li key={s.id} className="dc-row">
            <button type="button" aria-pressed={on} onClick={() => onPick(s.id)}
              className={`sun-guide-choice w-full flex items-center gap-2 px-3 py-2.5 rounded-md border text-left transition active:scale-[.99] ${on
                ? 'border-accent bg-accent-weak' : 'border-line bg-surface hover:bg-surface-hover'}`}>
              <span className={`sun-guide-choice-date shrink-0 text-[12px] font-semibold tabular-nums ${on ? 'text-accent-text' : 'text-fg'}`}>
                {guideServiceDate(s)}
              </span>
              <span className="sun-guide-choice-title min-w-0 flex-1 truncate text-[12px] text-fg-muted">{s.title || ''}</span>
              {have.has(s.id) && (
                <span className="sun-guide-choice-tag shrink-0 px-1.5 py-px rounded-full border border-line text-[10px] font-semibold text-fg-muted">
                  가이드 있음
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 만드는 동안 — 종이 한 장이 설 자리를 그대로 잡는다.
// Skeleton은 className만 받는다(자리·크기는 유틸리티로) — media.jsx 주석.
const SKELETON = (
  <div className="sun-guide-loading">
    <Skeleton className="w-full rounded-[14px] h-[520px]" />
  </div>
);

// ── 패널 ────────────────────────────────────────────────────────────────────
// props (모임 화면과의 계약):
//   services         — 고를 수 있는 주보들(발행된 주일 · 최근순 · sunGuide.guideServices)
//   service          — 고정이 없을 때 기본으로 여는 주보(가장 최근 주일)
//   pinnedServiceId  — 지금 고정된 가이드가 붙은 주보 id, 없으면 ''
//   perms            — { canView, canCreate, canPin }
//   loading          — 바깥이 아직 주보 목록을 읽는 중. 이때는 **아무것도 그리지 않는다** —
//                      바깥 컨테이너가 한 덩이 스켈레톤을 그리므로, 여기서 또 그리면
//                      스켈레톤이 두 겹이 된다.
//   onChanged()      — 저장·고정 뒤. 바깥이 '지금 고정된 주보'를 다시 읽게 알린다.
export function SunGuidePanel({
  services = [], service, pinnedServiceId = '', perms, loading = false, onChanged,
}) {
  const canView = !!perms?.canView;
  const canCreate = !!perms?.canCreate;
  const canPin = !!perms?.canPin;

  // 고를 수 있는 주보. 바깥이 목록을 못 줬으면 기본 한 건이라도 세운다.
  const list = useMemo(
    () => (services.length ? services : (service ? [service] : [])),
    [services, service],
  );
  // **처음 여는 한 벌은 고정된 것**이다(사용자 스펙 2026-09-08 — "해당 가이드만 볼 수
  // 있게끔"). 고정이 없으면 가장 최근 주일이다.
  const defaultId = (pinnedServiceId && list.some((s) => s.id === pinnedServiceId))
    ? pinnedServiceId : (service?.id || list[0]?.id || '');
  const [picked, setPicked] = useState('');
  const selectedId = (picked && list.some((s) => s.id === picked)) ? picked : defaultId;
  const selected = list.find((s) => s.id === selectedId) || service || null;

  const [draft, setDraft] = useState(null);
  const [making, setMaking] = useState(false);
  // **무엇을 하는 중인지**를 담는다(불리언이 아니다) — 이미지로 굽는 일은 라이브러리를
  // 받아 와 캔버스를 그리느라 몇 초가 걸리는데, 버튼이 흐려지기만 하면 눌린 것인지
  // 멈춘 것인지 알 수 없었다. 값은 '' | 'make' | 'save' | 'pin' | 'image'.
  const [busy, setBusy] = useState('');
  const working = !!busy;
  const sheetRef = useRef(null);
  const isMobile = useIsMobile();

  // 주보 한 건에 가이드 한 벌 — 캐시 열쇠도 주보 id다. 한 번 읽은 가이드는 다시 눌러도
  // 읽기 한 번으로 끝난다(AI를 다시 부르지 않는다 — 저장된 글을 보여줄 뿐이다).
  const guideQ = useCached(
    `groups:guide:${selectedId || 'none'}`,
    () => ((canView && selectedId) ? loadGuide(selectedId) : null),
    [canView, selectedId],
  );
  // 어느 주보에 이미 가이드가 있나 — 고르는 줄의 '가이드 있음' 꼬리표 몫이다. 한 건씩
  // 열어 보지 않고 한 번에 묻는다(services/sunGuide.js guidedServiceIds). 캐시 열쇠가
  // `groups:guide:`로 시작해서, 저장·고정 뒤의 dropCache('groups:guide')가 같이 비운다 —
  // 방금 만든 주보에 꼬리표가 바로 붙는다.
  const idsKey = useMemo(() => list.map((s) => s.id).join(','), [list]);
  const haveQ = useCached(
    `groups:guide:have:${idsKey || 'none'}`,
    () => ((canView && idsKey) ? guidedServiceIds(idsKey.split(',')) : []),
    [canView, idsKey],
  );
  const have = useMemo(() => new Set(haveQ.data || []), [haveQ.data]);
  // 가이드는 이 화면의 곁가지다 — 못 받아도 순 명단은 그대로 서야 한다
  useEffect(() => {
    if (guideQ.error) console.error('[sunGuide] 가이드를 받지 못했어요:', guideQ.error);
    if (haveQ.error) console.error('[sunGuide] 주보별 가이드 유무를 받지 못했어요:', haveQ.error);
  }, [guideQ.error, haveQ.error]);
  // 고른 주보가 바뀌면 쓰던 초안을 접는다 — 다른 주보의 종이에 앞 주보의 초안이
  // 얹히면 무엇을 저장하는지 알 수 없다.
  useEffect(() => { setDraft(null); setMaking(false); }, [selectedId]);

  const guide = guideQ.data?.body || null;
  const pinned = !!guideQ.data?.pinned;
  // 고정된 가이드는 **마스터 말고는 못 고친다**(0055의 write 정책과 같은 경계). 화면은
  // 버튼을 감출 뿐이고, 고른 주보를 바꿔 다른 가이드를 보는 길은 그대로 열려 있다.
  const locked = pinned && !canPin;

  // 왜 못 만들었는지를 말한다(사용자 지적 2026-09-03 — "가이드는 지금 만들지 못하는
  // 건지?"). generateGuide는 막힌 이유를 null 하나로 돌려주므로(AI 계층의 안내 문구는
  // 그 안에서 걸러진다) 화면에서 짚을 수 있는 것을 짚는다: 로그인이 없거나, 로컬
  // 서버에 /api/ai가 없거나, 그 밖의 실패다. 원문은 콘솔에 남는다(ai.js).
  const whyCannotMake = async () => {
    const session = supabase ? (await supabase.auth.getSession()).data?.session : null;
    if (!session) return 'AI는 로그인한 다음에 쓸 수 있어요';
    if (import.meta.env?.DEV) return 'AI 서버는 배포된 주소에서만 닿아요';
    return 'AI가 답을 주지 않았어요 · 잠시 뒤 다시 눌러 주세요';
  };

  const make = async () => {
    if (!selected) return;
    setBusy('make'); setMaking(true);
    try {
      const body = await generateGuide(selected);
      if (!body) {
        showToast(failText('지금은 가이드를 만들 수 없어요', { human: await whyCannotMake() }));
        return;
      }
      setDraft(body);
    } catch (e) {
      console.error('[sunGuide] 가이드를 만들지 못했어요:', e);
      showToast(failText('가이드를 만들지 못했어요', e));
    } finally { setBusy(''); setMaking(false); }
  };

  // 쓰기 뒤에는 **캐시를 비우고 다시 읽는다**(cache.js 주석) — 안 비우면 다른 탭에
  // 갔다 오면 저장 전 값이 먼저 그려진다.
  const reread = async () => {
    dropCache('groups:guide');
    await guideQ.refresh();
    onChanged?.();
  };

  const save = async () => {
    setBusy('save');
    try {
      await saveGuide(selectedId, draft);
      setDraft(null);
      await reread();
      showToast('순모임 가이드를 저장했어요');
    } catch (e) {
      console.error('[sunGuide] 가이드를 저장하지 못했어요:', e);
      showToast(failText('가이드를 저장하지 못했어요', e));
    } finally { setBusy(''); }
  };

  const pin = async (on) => {
    setBusy('pin');
    try {
      await pinGuide(selectedId, on);
      await reread();
      showToast(on ? '순모임 가이드를 고정했어요' : '순모임 가이드 고정을 풀었어요');
    } catch (e) {
      console.error('[sunGuide] 가이드를 고정하지 못했어요:', e);
      showToast(failText(on ? '가이드를 고정하지 못했어요' : '고정을 풀지 못했어요', e));
    } finally { setBusy(''); }
  };

  // 화면에 서 있는 그 종이를 그대로 그림으로. 굽는 것도 보내는 사다리도 한 벌이다 —
  // 노트·주보가 같이 쓴다(hooks/useSheetShare.js · services/shareImage.js).
  //
  // **여기서 사용자가 겪은 것**(2026-09-09 — "이미지로 저장을 했을 때 저장도 안되고
  // 카카오톡으로 공유 창도 안 열림", 그리고 고친 뒤에도 "모바일에서 또 마찬가지로 …
  // 데스크톱 쪽은 되는데")은 넷이 겹친 것이고 넷 다 그 두 자리에서 고쳤다: 누를 때
  // 라이브러리를 받아 공유 자격을 잃던 것 · **누를 때 굽느라 그 자격을 또 잃던 것**
  // (그림을 미리 구워 둔다) · 긴 종이에서 캔버스가 상한을 넘어 빈 그림이 되던 것 ·
  // 마지막 갈래까지 실패해도 아무 말이 없던 것. 여기서 남은 일은 파일 이름뿐이다.
  const img = useSheetShare({
    refs: [sheetRef], background: PAPER,
    key: `${selectedId || ''}:${guide ? JSON.stringify(guide).length : 0}`,
    fileName: `순모임 가이드 ${guideDateLabel(selected?.service_date)}`.trim(),
    what: '이미지를 저장하지 못했어요',
  });

  if (!canView || !selected) return null;
  // 바깥이 읽는 중이면 자리를 비운다 — 컨테이너가 한 덩이 스켈레톤을 그린다.
  if (loading) return null;

  const dateLabel = guideDateLabel(selected.service_date);
  const editing = !!draft;
  const showSheet = !editing && !making && !guideQ.loading && !!guide;
  // 고른 주보에 아직 가이드가 없으면 **고르는 줄부터** 편다(Chooser 머리말).
  const showChooser = !editing && !making && !guideQ.loading && !guide;

  // 동작은 **머리줄 오른쪽 끝**에 선다 — '모임' 섹션의 '모임 만들기'와 같은 자리다.
  // 모바일에서는 줄이 모자라니 접힌다(flex-wrap) — 감추지 않는다(§8).
  // 가이드가 아직 없으면 만들기 하나(확정이라 accent), 있으면 이미 있는 것을 손대는
  // 일이라 조용한 버튼들이다.
  // 고르개는 **머리줄 오른쪽에 하나**, 나머지 버튼은 그 아래 한 줄이다(모바일).
  // 사용자 요구 2026-09-09: "버튼이 많아지면서 순모임 가이드 쪽에 버튼이 좀 이상하게
  // 보여지고 … 아예 버튼들은 한 줄로 순모임 가이드 밑에 줄에 보여주든가 해줄래?
  // 넘치지 않게끔... (모바일에서만)". 넷이 375에 안 들어가므로 그 줄은 옆으로 밀린다.
  // **고르개를 그 줄에 넣지 않는다** — 미는 줄은 세로가 잠겨 있어서(x-scroll-lock)
  // 칸 아래 흐름에 그려지는 고르개 목록이 잘린다.
  const pick = showSheet ? (
    <MenuPick className="sun-guide-pick" label="가이드 기준 주보 고르기"
      items={list.map((x) => ({ id: x.id, name: guideServiceLabel(x) }))}
      onPick={(id) => setPicked(id)}>
      {guidePickLabel(selected.service_date) || '주보 고르기'}
    </MenuPick>
  ) : null;

  // 버튼 묶음 — 데스크톱은 머리줄 오른쪽에 고르개와 나란히, 모바일은 머리줄 **아래**
  // 한 줄에 이것만 선다(아래 return).
  const actionButtons = (<>
      {/* '고정' 배지는 **고정을 풀 수 없는 사람에게** 붙는다(2026-09-09에 조건을 뒤집었다).
          마스터에게는 바로 옆에 '고정 해제' 버튼이 있어 배지가 같은 말을 두 번 하고, 375에서
          머리줄이 접히는 원인이기도 했다. 반대로 순장에게는 고정된 가이드의 '수정·다시 만들기'가
          **아무 설명 없이 사라져** 있었다(locked) — 이 배지가 그 이유를 말하는 유일한 자리다.
          고정한 사람 이름은 DB에만 남는다. */}
      {pinned && !canPin && (
        <span className="sun-guide-pinned inline-flex items-center gap-1 text-[10px] text-fg-faint">
          <Pin size={9} />고정
        </span>
      )}
      {showSheet && (
        <button type="button" className={`sun-guide-image ${WITH_ICON} ${BTN_QUIET}`}
          disabled={working || img.busy} onClick={img.share}>
          {img.busy
            ? <Loader2 size={12} className="animate-spin" />
            : <Download size={12} />}
          <span>이미지로 저장</span>
        </button>
      )}
      {showSheet && canCreate && !locked && (
        <>
          <button type="button" className={`sun-guide-editbtn ${WITH_ICON} ${BTN_QUIET}`}
            disabled={working} onClick={() => setDraft(fitGuide(guide))}>
            <Pencil size={12} /><span>수정</span>
          </button>
          <button type="button" className={`sun-guide-regen ${WITH_ICON} ${BTN_QUIET}`}
            disabled={working} onClick={make}>
            <Wand2 size={12} /><span>다시 만들기</span>
          </button>
        </>
      )}
      {showSheet && canPin && (
        <button type="button" className={`sun-guide-pin ${WITH_ICON} ${BTN_QUIET}`}
          disabled={working} onClick={() => pin(!pinned)}>
          <Pin size={12} /><span>{pinned ? '고정 해제' : '고정'}</span>
        </button>
      )}
  </>);

  const actions = (
    <span className="sun-guide-actions flex flex-wrap items-center justify-end gap-1.5 min-w-0">
      {/* 어느 주보로 만들 것인가(사용자 스펙 2026-09-08). 보는 사람 모두에게 열려 있다 —
          지난 주 가이드를 다시 펼쳐 보는 길이기도 하다. **종이가 서 있을 때만** 선다:
          가이드가 아직 없으면 같은 일을 본문의 고르는 줄이 한다(2026-09-09 · Chooser
          머리말) — 같은 조작기를 두 벌 세우면 어느 쪽이 진짜인지 알 수 없다. */}
      {pick}
      {actionButtons}
    </span>
  );

  // **폭은 내 순 카드와 같다.** 섹션 자신에게 max-w를 주지 않으므로 이 화면의 다른
  // 섹션과 같은 열에 서고, 왼쪽·오른쪽 끝이 위 카드와 같은 선에 떨어진다
  // (사용자 지적 2026-09-03 — 처음에는 섹션 전체가 `max-w-[560px] mx-auto`여서
  // 제목과 버튼이 카드의 어느 선과도 맞지 않고 화면 가운데에 떠 있었다).
  // 종이만 상한을 두고 **그 카드 폭 안에서 가운데**로 세운다(mx-auto) — 세로로 이어지는
  // 인쇄물이라 1440px을 가로로 다 쓰면 한 줄이 화면을 가로지른다(토스트 폭 상한과 같은
  // 판단, §8). 편집 화면도 같은 폭·같은 가운데다 — 미리보기와 편집이 같은 종이여야
  // 자리가 안 흔들린다.
  // **딸린 두 섹션은 같은 간격으로 선다**(mt-6 — '내 순에 공유된 예배 노트'와 같은 값).
  // 위쪽 여백이 없던 자리라 가이드 머리줄이 마지막 노트 카드에 9px 붙어, 노트 목록에
  // 딸린 줄처럼 읽혔다(1440에서 실측).
  return (
    <section className="sun-guide dc-card mt-6 pt-1">
      {/* 모바일 — 머리줄에는 고르개 하나만, 버튼은 아래 한 줄(옆으로 밀린다).
          데스크톱 — 예전처럼 머리줄 오른쪽에 다 선다(넷 이상이면 접히므로 wrapRight). */}
      {isMobile ? (
        <>
          <SectionHead right={pick}>순모임 가이드</SectionHead>
          <div className="sun-guide-actions-row -mt-1 mb-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-hide x-scroll-lock">
            {actionButtons}
          </div>
        </>
      ) : (
        <SectionHead right={actions} wrapRight>순모임 가이드</SectionHead>
      )}
      <div className="sun-guide-body-wrap w-full max-w-[560px] mx-auto">
        {(making || guideQ.loading) && SKELETON}
        {editing && (
          <Editor draft={draft} setDraft={setDraft} busy={working} onSave={save} onRegen={make}
            onCancel={() => setDraft(null)} />
        )}
        {showChooser && (
          <>
            <Chooser items={list} selectedId={selectedId} have={have} onPick={setPicked} />
            {/* 만들기는 **고른 줄 밑**이고 날짜를 달고 있다 — 무엇으로 만드는지가
                버튼 글자에 있어야 누르기 전에 안다. 상시 도구 줄이라 확정이 왼쪽(§8). */}
            {canCreate && (
              <div className="sun-guide-choose-tools flex items-center gap-1.5 pt-2.5">
                <button type="button" className={`sun-guide-create ${WITH_ICON} ${BTN}`}
                  disabled={working} onClick={make}>
                  <Wand2 size={12} />
                  <span>{dateLabel ? `${dateLabel} 주보로 만들기` : 'AI로 만들기'}</span>
                </button>
              </div>
            )}
          </>
        )}
        {showSheet && <Sheet guide={guide} dateLabel={dateLabel} sheetRef={sheetRef} />}
      </div>
    </section>
  );
}
