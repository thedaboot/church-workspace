import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Pencil, Wand2 } from 'lucide-react';
import { Skeleton } from './media.jsx';
import { SectionHead } from '../views/dashboardParts.jsx';
import { BTN, BTN_QUIET, CARD_STYLE, WITH_ICON } from './groupsParts.jsx';
import { showToast } from './Toast.jsx';
import { supabase } from '../services/supabaseClient.js';
import { failText } from '../services/errorText.js';
import {
  LIMITS, POINTS,
  fitGuide, guideDateLabel, generateGuide, loadGuide, saveGuide, splitBold,
} from '../services/sunGuide.js';

// ============================================================================
// 순모임 가이드 섹션 — 내 순 탭의 **순 카드 밑** (docs/V2.md · 0039 · services/sunGuide.js)
// ----------------------------------------------------------------------------
// 자리와 머리줄은 사용자 지적으로 두 번째 판이다(2026-09-03 — "버튼 배치를 왜 이렇게
// 해놨나, 섹션은 순 카드 밑으로"). 처음에는 카드 위에 놓고, 제목과 버튼을 종이 폭
// (560px)에 맞춰 화면 가운데에 띄웠다 — 그래서 제목이 순 카드의 어느 선과도 맞지
// 않고 버튼만 허공에 떠 보였다. 지금은 **화면의 다른 섹션과 같은 머리줄**이다:
// SectionHead(제목 왼쪽 · 가로선 · 동작 버튼 오른쪽 끝) — '구성원 3명'·'모임'·
// '가입 신청 1건'과 한 벌이고, 종이는 그 머리줄 왼쪽 끝에서 시작한다.
// ----------------------------------------------------------------------------
// 사용자가 준 템플릿(세로 카드 3장 · 상단 좌 날짜 / 우 '순모임 가이드' · 하단
// THE DABOOT MINISTRY)을 우리 토큰으로 옮긴 것이다. 원본은 베이지 배경 + 흰 블롭
// 카드였는데 **베이지를 박아 두지 않는다** — 다크 모드에서 그 종이만 밝게 남는다.
// 종이는 `--app-surface`, 바탕은 화면의 canvas다.
//
// 값은 전부 `service`와 sun_guides의 body에서 온다. 자격 판정은 하지 않는다 —
// 부르는 쪽(모임 화면)이 `perms = { canCreate, canView }`로 넘긴다. 진실은 RLS다
// (0039: 보는 사람 = 순장 + can_manage_sun, 만드는 사람 = can_manage_sun).
//
// 소제목 번호('1.')와 질문의 'Q.'는 **여기서 붙인다** — body에 넣으면 모델이 번호를
// 어긋나게 매기고 글자수 상한도 번호가 잡아먹는다(sunGuide.js 주석).
// ============================================================================

const HEART = <Heart size={11} className="fill-current shrink-0" style={{ color: 'var(--app-accent)' }} />;

// 카드 한 장 — 큰 radius의 종이. 템플릿의 흰 블롭 카드 자리다.
const PAGE = 'sun-guide-page rounded-[20px] px-5 py-5 md:px-6 md:py-6';

// 종이 안의 머리 — 하트 + 이름. 템플릿의 '♥ 주일 본문' 그대로다.
// (화면 섹션의 머리줄은 dashboardParts의 SectionHead다 — 이름이 겹치지 않게 나눈다.)
function SheetHead({ children, className = '' }) {
  return (
    <p className={`sun-guide-head flex items-center gap-1.5 text-[12.5px] font-bold text-fg ${className}`}>
      {HEART}<span>{children}</span>
    </p>
  );
}

// 굵게 마커를 <strong>으로. **HTML을 삽입하지 않는다**(§6-43과 같은 정신 — 모델이
// 돌려준 글에 태그가 섞여 있어도 글자로만 보인다).
function Rich({ text, className = '' }) {
  const parts = useMemo(() => splitBold(text), [text]);
  return (
    <p className={`sun-guide-body text-[12.5px] leading-[1.75] text-fg-secondary ${className}`}>
      {parts.map((p, i) => (p.bold
        ? <strong key={i} className="font-bold text-fg">{p.text}</strong>
        : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </p>
  );
}

// 빨간 소제목 — 템플릿의 번호 소제목. 색은 토큰(tag-red-fg)이다.
const Sub = ({ children, className = '' }) => (
  <p className={`sun-guide-sub text-[12.5px] font-bold text-tag-red-fg ${className}`}>{children}</p>
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
  return (
    <div className="sun-guide-edit space-y-3">
      <Field label="본문 한 마디" value={draft.passage.title} rows={1}
        onChange={(v) => set({ passage: { ...draft.passage, title: v } })} />
      <Field label="요약이 다루는 구절" value={draft.summaryRef} limit={LIMITS.summaryRef} rows={1}
        onChange={(v) => set({ summaryRef: v })} />
      <Field label="말씀 요약" value={draft.summary} limit={LIMITS.summary} rows={6}
        onChange={(v) => set({ summary: v })} />
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
function Sheet({ guide, dateLabel }) {
  const [p1, p2, p3] = guide.points;
  return (
    <div className="sun-guide-sheet">
      {/* 템플릿의 머리 줄. 오른쪽에 있던 '순모임 가이드'는 **섹션 머리줄로 올라갔다** —
          바로 위에 같은 글자가 두 번 있으면 그중 하나는 실수처럼 보인다. */}
      <div className="sun-guide-top flex items-baseline gap-2 px-1 pb-2">
        <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{dateLabel}</span>
      </div>

      <div className="space-y-3">
        <article className={PAGE} style={CARD_STYLE}>
          <SheetHead>주일 본문</SheetHead>
          <p className="sun-guide-ref mt-1.5 text-[14px] font-extrabold text-fg break-words">
            {guide.passage.ref}
            {guide.passage.title && (
              <span className="sun-guide-ref-title font-bold text-accent-text"> [{guide.passage.title}]</span>
            )}
          </p>
          <SheetHead className="mt-4">말씀 요약</SheetHead>
          {/* 요약이 다루는 구절 범위. 템플릿의 '[요한복음 8:1~11 배경 요약]' 자리이고,
              주일 본문의 **앞 문맥**일 때가 많아 본문 구절로 만들어 낼 수 없다.
              값이 없으면 소제목을 아예 두지 않는다 — 빈 대괄호가 남으면 안 된다. */}
          {guide.summaryRef && <Sub className="mt-1.5">{`[${guide.summaryRef} 배경 요약]`}</Sub>}
          <Rich text={guide.summary} className="mt-1.5" />
        </article>

        <article className={PAGE} style={CARD_STYLE}>
          {[p1, p2].map((p, i) => (
            <div key={i} className={i ? 'mt-4' : ''}>
              <Sub>{`${i + 1}. ${p.title}`}</Sub>
              <Rich text={p.body} className="mt-1.5" />
            </div>
          ))}
        </article>

        <article className={PAGE} style={CARD_STYLE}>
          <Sub>{`${POINTS}. ${p3.title}`}</Sub>
          <Rich text={p3.body} className="mt-1.5" />
          <SheetHead className="mt-4">오늘의 나눔 질문</SheetHead>
          <div className="mt-1.5 space-y-2">
            {guide.questions.map((q, i) => (
              <p key={i} className="sun-guide-q flex gap-1.5 text-[12.5px] leading-[1.7] text-fg-secondary">
                <span className="font-bold text-tag-red-fg shrink-0">Q.</span>
                <span>{q}</span>
              </p>
            ))}
          </div>
        </article>
      </div>

      <p className="sun-guide-mark mt-3 text-center text-[9.5px] font-semibold text-fg-faint"
        style={{ letterSpacing: '2.4px' }}>THE DABOOT MINISTRY</p>
    </div>
  );
}

// 만드는 동안 — 카드 세 장이 설 자리를 그대로 잡는다(높이는 실제 카드에 가깝게).
// Skeleton은 className만 받는다(자리·크기는 유틸리티로) — media.jsx 주석.
const SKELETON = (
  <div className="sun-guide-loading space-y-3">
    {['h-[132px]', 'h-[176px]', 'h-[196px]'].map((h) => (
      <Skeleton key={h} className={`w-full rounded-[20px] ${h}`} />
    ))}
  </div>
);

// ── 패널 ────────────────────────────────────────────────────────────────────
export function SunGuidePanel({ service, perms }) {
  const canView = !!perms?.canView;
  const canCreate = !!perms?.canCreate;
  const serviceId = service?.id || '';
  const [state, setState] = useState('load');   // load | none | view | edit | make
  const [guide, setGuide] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!serviceId || !canView) return undefined;
    let alive = true;
    setState('load'); setGuide(null); setDraft(null);
    loadGuide(serviceId)
      .then((body) => {
        if (!alive) return;
        setGuide(body);
        setState(body ? 'view' : 'none');
      })
      .catch((e) => {
        // 가이드는 이 화면의 곁가지다 — 못 받아도 순 명단은 그대로 서야 한다
        console.error('[sunGuide] 가이드를 받지 못했어요:', e);
        if (alive) setState('none');
      });
    return () => { alive = false; };
  }, [serviceId, canView]);

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
    setBusy(true); setState('make');
    try {
      const body = await generateGuide(service);
      if (!body) {
        showToast(failText('지금은 가이드를 만들 수 없어요', { human: await whyCannotMake() }));
        setState(guide ? 'view' : 'none');
        return;
      }
      setDraft(body); setState('edit');
    } catch (e) {
      console.error('[sunGuide] 가이드를 만들지 못했어요:', e);
      showToast(failText('가이드를 만들지 못했어요', e));
      setState(guide ? 'view' : 'none');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveGuide(serviceId, draft);
      setGuide(saved); setDraft(null); setState('view');
      showToast('순모임 가이드를 저장했어요');
    } catch (e) {
      console.error('[sunGuide] 가이드를 저장하지 못했어요:', e);
      showToast(failText('가이드를 저장하지 못했어요', e));
    } finally { setBusy(false); }
  };

  if (!service || !canView) return null;
  // 읽는 동안에는 아무것도 두지 않는다 — 여기 빈 카드를 세우면 가이드가 없는 순장
  // (대다수)에게 카드가 한 번 떴다가 사라진다. 한 행을 읽는 일이라 금방 끝난다.
  if (state === 'load') return null;
  if (state === 'none' && !canCreate) return null;

  const dateLabel = guideDateLabel(service.service_date);
  // 동작 버튼은 **머리줄 오른쪽 끝**에 선다 — '모임' 섹션의 '모임 만들기'와 같은 자리다.
  // 가이드가 아직 없으면 만들기 하나(확정이라 accent), 있으면 수정·다시 만들기 둘
  // (이미 있는 것을 손대는 일이라 조용한 버튼)이다.
  const actions = state === 'none' && canCreate
    ? (
      <button type="button" className={`sun-guide-create ${WITH_ICON} ${BTN}`} disabled={busy} onClick={make}>
        <Wand2 size={12} /><span>AI로 만들기</span>
      </button>
    )
    : (state === 'view' && canCreate ? (
      <>
        <button type="button" className={`sun-guide-editbtn ${WITH_ICON} ${BTN_QUIET}`}
          onClick={() => { setDraft(fitGuide(guide)); setState('edit'); }}>
          <Pencil size={12} /><span>수정</span>
        </button>
        <button type="button" className={`sun-guide-regen ${WITH_ICON} ${BTN_QUIET}`} disabled={busy} onClick={make}>
          <Wand2 size={12} /><span>다시 만들기</span>
        </button>
      </>
    ) : null);

  // **폭은 내 순 카드와 같다.** 섹션 자신에게 max-w를 주지 않으므로 이 화면의 다른
  // 섹션과 같은 열에 서고, 왼쪽·오른쪽 끝이 위 카드와 같은 선에 떨어진다
  // (사용자 지적 2026-09-03 — 처음에는 섹션 전체가 `max-w-[560px] mx-auto`여서
  // 제목과 버튼이 카드의 어느 선과도 맞지 않고 화면 가운데에 떠 있었다).
  // 종이만 상한을 두고 **그 카드 폭 안에서 가운데**로 세운다(mx-auto) — 카드 세 장이
  // 세로로 이어지는 인쇄물이라 1440px을 가로로 다 쓰면 한 줄이 화면을 가로지른다
  // (토스트 폭 상한과 같은 판단, §8). 좌우 여백이 같아야 인쇄물처럼 보인다.
  // 편집 화면도 같은 폭·같은 가운데다 — 미리보기와 편집이 같은 종이여야 자리가
  // 안 흔들린다.
  return (
    <section className="sun-guide dc-card pt-1">
      <SectionHead right={actions}>순모임 가이드</SectionHead>
      <div className="sun-guide-body-wrap w-full max-w-[560px] mx-auto">
        {state === 'make' && SKELETON}
        {state === 'edit' && draft && (
          <Editor draft={draft} setDraft={setDraft} busy={busy} onSave={save} onRegen={make}
            onCancel={() => { setDraft(null); setState(guide ? 'view' : 'none'); }} />
        )}
        {state === 'view' && guide && <Sheet guide={guide} dateLabel={dateLabel} />}
      </div>
    </section>
  );
}
