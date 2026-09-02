import React, { useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { Skeleton } from './media.jsx';
import { BTN, BTN_QUIET, CARD_STYLE } from './groupsParts.jsx';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';
import {
  LIMITS, POINTS,
  fitGuide, guideDateLabel, generateGuide, loadGuide, saveGuide, splitBold,
} from '../services/sunGuide.js';

// ============================================================================
// 순모임 가이드 카드 — 내 순 탭 맨 위 (docs/V2.md · 0039 · services/sunGuide.js)
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

// 섹션 머리 — 하트 + 이름. 템플릿의 '♥ 주일 본문' 그대로.
function SectionHead({ children, className = '' }) {
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
const Sub = ({ children }) => (
  <p className="sun-guide-sub text-[12.5px] font-bold text-tag-red-fg">{children}</p>
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
      {/* 상시 도구 줄은 확정 왼쪽 / 나가기 오른쪽(§8) — 저장이 손가락 자리를 지킨다 */}
      <div className="flex items-center gap-2 pt-0.5">
        <button type="button" className={`sun-guide-save ${BTN}`} disabled={busy} onClick={onSave}>저장</button>
        <button type="button" className={`sun-guide-regen ${BTN_QUIET}`} disabled={busy} onClick={onRegen}>다시 만들기</button>
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
      <div className="sun-guide-top flex items-baseline gap-2 px-1 pb-2">
        <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{dateLabel}</span>
        <span className="flex-1" />
        <span className="text-[11px] font-semibold text-fg-muted">순모임 가이드</span>
      </div>

      <div className="space-y-3">
        <article className={PAGE} style={CARD_STYLE}>
          <SectionHead>주일 본문</SectionHead>
          <p className="sun-guide-ref mt-1.5 text-[14px] font-extrabold text-fg break-words">
            {guide.passage.ref}
            {guide.passage.title && (
              <span className="sun-guide-ref-title font-bold text-accent-text"> [{guide.passage.title}]</span>
            )}
          </p>
          <SectionHead className="mt-4">말씀 요약</SectionHead>
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
          <SectionHead className="mt-4">오늘의 나눔 질문</SectionHead>
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

  const make = async () => {
    setBusy(true); setState('make');
    try {
      const body = await generateGuide(service);
      // 게스트·로그인 없음·모양 깨짐이 전부 null이다 — 무엇이 막혔는지는 콘솔에 있다
      if (!body) { showToast('지금은 가이드를 만들 수 없어요'); setState(guide ? 'view' : 'none'); return; }
      setDraft(body); setState('edit');
    } catch (e) {
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
      showToast(failText('가이드를 저장하지 못했어요', e));
    } finally { setBusy(false); }
  };

  if (!service || !canView) return null;
  // 읽는 동안에는 아무것도 두지 않는다 — 여기 빈 카드를 세우면 가이드가 없는 순장
  // (대다수)에게 카드가 한 번 떴다가 사라진다. 한 행을 읽는 일이라 금방 끝난다.
  if (state === 'load') return null;
  if (state === 'none' && !canCreate) return null;

  const dateLabel = guideDateLabel(service.service_date);
  // 카드 세 장이 세로로 이어지는 종이라 데스크톱에서는 폭을 묶어 가운데 세운다 —
  // 1440px을 가로로 다 쓰면 한 줄이 화면을 가로지른다(토스트 폭 상한과 같은 판단, §8).
  // 편집 화면도 같은 폭이다 — 미리보기와 편집이 같은 종이여야 자리가 안 흔들린다.
  return (
    <section className="sun-guide dc-card w-full max-w-[560px] mx-auto">
      <div className="flex items-center gap-2 pb-2.5">
        <h3 className="text-[13.5px] font-bold text-fg">순모임 가이드</h3>
        <span className="flex-1" />
        {state === 'view' && canCreate && (
          <>
            <button type="button" className={`sun-guide-editbtn ${BTN_QUIET}`}
              onClick={() => { setDraft(fitGuide(guide)); setState('edit'); }}>수정</button>
            <button type="button" className={`sun-guide-regen ${BTN_QUIET}`} disabled={busy} onClick={make}>다시 만들기</button>
          </>
        )}
      </div>

      {state === 'make' && SKELETON}
      {state === 'none' && canCreate && (
        <button type="button" className={`sun-guide-create ${BTN}`} disabled={busy} onClick={make}>AI로 만들기</button>
      )}
      {state === 'edit' && draft && (
        <Editor draft={draft} setDraft={setDraft} busy={busy} onSave={save} onRegen={make}
          onCancel={() => { setDraft(null); setState(guide ? 'view' : 'none'); }} />
      )}
      {state === 'view' && guide && <Sheet guide={guide} dateLabel={dateLabel} />}
    </section>
  );
}
