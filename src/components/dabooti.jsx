import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Lock, ThumbsUp, ThumbsDown } from 'lucide-react';
import { askDabooti, sendFeedback } from '../services/wiki.js';
import { imeComposing, coarsePointer } from '../utils.js';
import { mdLabel } from '../services/wikiCore.js';

// ============================================================================
// 다붓이 — 입구(상단 알약 · 폰 얼굴)와 물어보기 판 (0088 · 16차 · 목업 v12)
// ----------------------------------------------------------------------------
// 컷은 원본 시트에서 자른 '물음표' 컷 하나(public/chars/question · 85×85, @2x 170). 얼굴 자리는 그 컷을
// 동그라미에 담아 위쪽(50% 20%)을 보인다. 효과는 index.css의 dab-tilt(갸웃) · dab-ring(무지개 테두리).
// 답은 서버가 근거를 찾고 검증까지 끝낸 것만 온다(api/_wikiAsk.js) — 여기서는 그리기만 한다.
// ============================================================================

export const DAB_CUT = { src: '/chars/question.webp', w: 85, h: 85 };
export const cutSet = (src) => `${src} 1x, ${src.replace(/\.webp$/, '@2x.webp')} 2x`;

function Face({ size = 26, className = '' }) {
  return (
    <img src={DAB_CUT.src} srcSet={cutSet(DAB_CUT.src)} alt="" aria-hidden="true" draggable="false"
      width={size} height={size}
      className={`dab-face rounded-full object-cover bg-surface shrink-0 ${className}`}
      style={{ width: size, height: size, objectPosition: '50% 20%' }} />
  );
}

// 데스크톱 상단 바 — 두 묶음 밖, 찾기 바로 앞(사용자 결정 2026-10-02)
export function DaboutiPill({ active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className="dab-tilt dab-pill shrink-0 inline-flex items-center gap-[7px] h-8 pl-[3px] pr-3 rounded-full border text-[12.5px] font-semibold text-accent-text whitespace-nowrap transition active:scale-95"
      style={{ background: 'var(--app-hero)', borderColor: 'color-mix(in srgb, var(--app-accent) 25%, transparent)', boxShadow: `0 0 0 3px color-mix(in srgb, var(--app-accent) ${active ? 22 : 12}%, transparent)` }}>
      <Face size={26} />
      다붓이에게 물어보기
    </button>
  );
}

// 폰 상단 아이콘 줄 맨 앞 — 옅은 파란 고리로 다른 아이콘과 가른다
export function DaboutiFace({ active, onClick }) {
  return (
    <button type="button" onClick={onClick} title="다붓이에게 물어보기" aria-label="다붓이에게 물어보기"
      className="dab-tilt w-9 h-9 flex items-center justify-center rounded-md transition active:scale-95">
      <span className="rounded-full" style={{ boxShadow: `0 0 0 2px color-mix(in srgb, var(--app-accent) ${active ? 60 : 35}%, transparent)`, background: 'var(--app-hero)' }}>
        <Face size={28} />
      </span>
    </button>
  );
}

// 위키 안의 물어보기 칸(왼쪽 목록 맨 위 · 폰 위키 첫 화면) — 갸웃 + 무지개 테두리
export function AskEntry({ active, onClick, className = '' }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`dab-tilt dab-ring w-full flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[12.5px] font-semibold text-accent-text text-left transition active:scale-[0.98] ${className}`}>
      <Face size={28} />
      <span className="truncate">다붓이에게 물어보기</span>
    </button>
  );
}

// ── 근거 칩 · 파일 카드 ─────────────────────────────────────────────────────
export function CiteChip({ cite, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen?.(cite)}
      className="wiki-cite inline-flex items-center max-w-full h-[19px] px-1.5 rounded-[5px] bg-accent-weak text-accent-text text-[10.5px] font-semibold align-[1px] whitespace-nowrap overflow-hidden text-ellipsis transition hover:brightness-95 active:scale-95">
      {cite.label}
    </button>
  );
}

const EXT_PAINT = { docx: ['W', '#2b579a'], doc: ['W', '#2b579a'], xlsx: ['X', '#217346'], xls: ['X', '#217346'], csv: ['X', '#217346'], pptx: ['P', '#c43e1c'], ppt: ['P', '#c43e1c'], pdf: ['PDF', '#c4302b'], hwp: ['한', '#1f6fb2'], hwpx: ['한', '#1f6fb2'] };
function extPaint(name, mime) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (EXT_PAINT[ext]) return EXT_PAINT[ext];
  if (/^image\//.test(mime || '')) return ['IMG', '#7a5a1e'];
  if (/google-apps\.document/.test(mime || '')) return ['W', '#2b579a'];
  return [ext.slice(0, 3).toUpperCase() || '파일', '#6b6675'];
}

export function FileCard({ file, onOpen }) {
  const [mark, color] = extPaint(file.name, file.mime_type);
  return (
    <button type="button" onClick={() => onOpen?.(file)}
      className="wiki-file w-full grid grid-cols-[30px_1fr_auto] gap-2 items-center text-left rounded-[9px] border border-line bg-surface px-2.5 py-2 mt-1.5 transition hover:bg-surface-hover active:scale-[0.99]">
      <span className="w-[30px] h-[30px] rounded-[7px] inline-flex items-center justify-center text-[10px] font-extrabold text-white" style={{ background: color }}>{mark}</span>
      <span className="min-w-0 text-[12.5px] font-semibold leading-snug break-all text-fg">
        {file.name}
        <span className="flex items-center gap-1 text-[11px] font-medium text-fg-muted">
          {file.pw && <Lock size={11} className="shrink-0" />}
          <span className="truncate">{file.pw ? `비밀번호 · ${file.where}` : file.where}</span>
        </span>
      </span>
      <span className="text-[11px] font-bold text-accent-text whitespace-nowrap">열기</span>
    </button>
  );
}

// ── 물어보기 판 ──────────────────────────────────────────────────────────────
// 처음: 가운데에 다붓이 + 질문 칩 + 입력 · 물어본 뒤: 말풍선이 쌓이고 입력은 아래('다붓이에게 더 물어보기').
// chat/setChat은 부르는 쪽(위키 화면)이 쥔다 — 장을 오가도 대화가 남는다.
export function AskPanel({ chat, setChat, chips = [], onOpenCite, onOpenFile, onOpenFaq }) {
  const [q, setQ] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const busy = chat.some(m => m.loading);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [chat.length, chat[chat.length - 1]?.loading]);

  const send = async (text) => {
    const question = String(text ?? q).trim();
    if (!question || busy) return;
    setQ('');
    if (coarsePointer()) inputRef.current?.blur();
    const prev = [...chat].reverse().find(m => m.a)?.q || '';
    const id = `${Date.now()}`;
    setChat(c => [...c, { id, q: question, loading: true }]);
    try {
      const a = await askDabooti(question, prev);
      setChat(c => c.map(m => (m.id === id ? { ...m, loading: false, a } : m)));
    } catch (e) {
      setChat(c => c.map(m => (m.id === id ? { ...m, loading: false, err: e.human || '답을 받지 못했어요' } : m)));
    }
  };
  const retry = (m) => { setChat(c => c.filter(x => x.id !== m.id)); send(m.q); };
  const rate = (m, v) => {
    const next = m.rated === v ? null : v;
    setChat(c => c.map(x => (x.id === m.id ? { ...x, rated: next } : x)));
    sendFeedback(m.a?.id, next);
  };

  const input = (
    <div className="dab-input flex items-center gap-2 rounded-full border border-accent bg-surface pl-4 pr-1.5 py-1.5 w-full shadow-[0_1px_0_rgba(0,0,0,.02)]">
      <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} maxLength={300}
        onKeyDown={e => { if (imeComposing(e)) return; if (e.key === 'Enter') { e.preventDefault(); send(); } }}
        enterKeyHint="send"
        placeholder={chat.length ? '다붓이에게 더 물어보기' : '예: 수련회 준비는 언제부터 해요?'}
        aria-label={chat.length ? '다붓이에게 더 물어보기' : '다붓이에게 물어보기'}
        className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-fg placeholder:text-fg-faint" />
      <button type="button" onClick={() => send()} disabled={!q.trim() || busy} aria-label="보내기"
        className="w-8 h-8 shrink-0 rounded-full bg-accent text-white inline-flex items-center justify-center transition active:scale-90 disabled:opacity-40">
        <ArrowUp size={16} strokeWidth={2.4} />
      </button>
    </div>
  );

  if (!chat.length) {
    return (
      <div className="dab-home flex flex-col items-center justify-center gap-2.5 text-center px-4 py-8 min-h-[min(520px,calc(var(--app-vh,100dvh)-220px))]">
        <div className="dab-tilt dc-card flex flex-col items-center gap-1.5">
          <img src={DAB_CUT.src} srcSet={cutSet(DAB_CUT.src)} width={DAB_CUT.w} height={DAB_CUT.h} alt="" aria-hidden="true" draggable="false" className="dab-face" />
          <b className="text-[16px] text-fg tracking-[-0.3px]">다붓이에게 물어보기</b>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 max-w-[560px] mt-1">
            {chips.map((c, i) => (
              <button key={c} type="button" onClick={() => send(c)} style={{ animationDelay: `${80 + i * 40}ms` }}
                className="dab-chip dc-card rounded-full border border-line bg-surface px-3 py-[5px] text-[12px] text-fg transition hover:bg-surface-hover active:scale-95">{c}</button>
            ))}
          </div>
        )}
        <div className="w-full max-w-[520px] mt-1.5 dc-card" style={{ animationDelay: '160ms' }}>{input}</div>
      </div>
    );
  }

  return (
    <div className="dab-chat flex flex-col min-h-[min(520px,calc(var(--app-vh,100dvh)-220px))]">
      <div className="flex-1 grid content-start gap-3 px-1 py-3">
        {chat.map(m => (
          <div key={m.id} className="grid gap-3">
            <div className="dab-q dab-q-in justify-self-end max-w-[82%] rounded-[14px_14px_4px_14px] bg-accent text-white px-3 py-2 text-[13.5px] leading-relaxed break-words">{m.q}</div>
            <div className="grid grid-cols-[34px_1fr] gap-2 items-start">
              <span className="w-[34px] h-[34px] rounded-full overflow-hidden" style={{ background: 'var(--app-hero)' }}><Face size={34} className="bg-transparent" /></span>
              {m.loading ? (
                <div className="dab-bub-in justify-self-start rounded-[4px_14px_14px_14px] px-3 py-3" style={{ background: 'var(--app-hero)' }} aria-label="다붓이가 답을 찾는 중">
                  <span className="dab-dots inline-flex gap-1"><span /><span /><span /></span>
                </div>
              ) : m.err ? (
                <div className="dab-bub-in dab-err justify-self-start min-w-0 rounded-[4px_14px_14px_14px] bg-surface-hover px-3 py-2.5 text-[13px] leading-relaxed text-fg-muted whitespace-pre-line" role="alert">
                  {m.err}
                  <div className="mt-2"><button type="button" onClick={() => retry(m)} className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">다시 시도</button></div>
                </div>
              ) : (
                <Answer m={m} onOpenCite={onOpenCite} onOpenFile={onOpenFile} onOpenFaq={onOpenFaq} onRate={rate} />
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {/* 폰은 하단 바가 main 위에 떠 있어 그 높이만큼 띄운다(--mobile-tab-bar-h · 데스크톱엔 없다 = 0) */}
      <div className="sticky pt-2 pb-1 bg-gradient-to-t from-[var(--app-canvas)] via-[var(--app-canvas)] to-transparent" style={{ bottom: 'var(--mobile-tab-bar-h, 0px)' }}>{input}</div>
    </div>
  );
}

function Answer({ m, onOpenCite, onOpenFile, onOpenFaq, onRate }) {
  const a = m.a;
  const refused = a.status === 'refused';
  const cites = [];
  for (const s of a.sentences || []) for (const c of s.cites || []) if (!cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
  if (a.status === 'unknown' && /자주 묻는 질문/.test(a.sentences?.[0]?.text || '')) cites.push({ t: 'page', id: 'faq', label: '자주 묻는 질문' });
  return (
    <div className={`dab-answer dab-bub-in justify-self-start min-w-0 max-w-full rounded-[4px_14px_14px_14px] px-3 py-2.5 text-[13.5px] leading-[1.7] text-fg ${refused ? 'bg-surface-hover' : ''}`}
      style={refused ? undefined : { background: 'var(--app-hero)' }} data-status={a.status}>
      <span className="block text-[11px] font-bold text-accent-text mb-0.5">다붓이</span>
      <span className="break-words">{(a.sentences || []).map(s => s.text).join(' ')}</span>
      {cites.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {cites.map(c => <CiteChip key={`${c.t}:${c.id}`} cite={c} onOpen={c.id === 'faq' && c.t === 'page' ? onOpenFaq : onOpenCite} />)}
        </div>
      )}
      {(a.files || []).map(f => <FileCard key={f.id} file={f} onOpen={onOpenFile} />)}
      {!refused && a.id && (
        <div className="flex items-center gap-0.5 mt-1.5 -mb-1 -ml-1">
          <button type="button" onClick={() => onRate(m, 'good')} aria-label="도움이 됐어요" title="도움이 됐어요" aria-pressed={m.rated === 'good'}
            className={`w-7 h-7 inline-flex items-center justify-center rounded-md transition active:scale-90 ${m.rated === 'good' ? 'text-accent-text' : 'text-fg-faint hover:text-fg-muted'}`}><ThumbsUp size={13} /></button>
          <button type="button" onClick={() => onRate(m, 'bad')} aria-label="도움이 안 됐어요" title="도움이 안 됐어요" aria-pressed={m.rated === 'bad'}
            className={`w-7 h-7 inline-flex items-center justify-center rounded-md transition active:scale-90 ${m.rated === 'bad' ? 'text-accent-text' : 'text-fg-faint hover:text-fg-muted'}`}><ThumbsDown size={13} /></button>
        </div>
      )}
    </div>
  );
}

// 처음 화면의 질문 칩 — 자주 묻는 질문(사람들이 실제로 물은 것) 먼저, 모자라면 위키 장에서 만든 기본 질문
export function chipsFrom(pages) {
  const out = [];
  const faq = pages.find(p => p.id === 'faq');
  for (const it of faq?.blocks?.[0]?.items || []) if (it.meta?.q && out.length < 3) out.push(it.meta.q);
  const sermon = pages.find(p => p.id === 'sermon');
  const lastSvc = sermon?.blocks?.[0]?.meta?.date;
  const base = ['월례회는 언제 해요?', '송폼은 언제까지 나와요?', '워십팀은 뭐 하는 팀이에요?', lastSvc ? `${mdLabel(lastSvc)} 큐시트 어디 있어요?` : '큐시트는 어디 있어요?'];
  for (const b of base) if (out.length < 4 && !out.includes(b)) out.push(b);
  return out;
}
