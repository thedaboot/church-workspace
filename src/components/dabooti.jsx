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
// 위키 코드는 늦게 싣는다(App.jsx lazy) — 입구에 손이 가면 미리 받아, 누를 때 받기와 프로젝트 줄 접힘 모션이 겹치지 않게 한다
export const prefetchWiki = () => { import('../views/wikiView.jsx').catch(() => {}); };

export function DaboutiPill({ active, onClick }) {
  return (
    <button type="button" onClick={onClick} onPointerEnter={prefetchWiki} onFocus={prefetchWiki} aria-current={active ? 'page' : undefined}
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
    <button type="button" onClick={onClick} onPointerDown={prefetchWiki} title="다붓이에게 물어보기" aria-label="다붓이에게 물어보기"
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
// fill — 판이 차지할 높이(위키 화면이 main의 안쪽 높이를 재서 준다 · CSS 길이). 처음 화면은 그 가운데에 서고,
// 대화가 시작되면 입력 칸이 그 높이의 바닥(=화면 아래)에 붙는다(사용자 지적 2026-10-03 — 가운데에 떠 있었다).
export function AskPanel({ chat, setChat, chips = [], onOpenCite, onOpenFile, onOpenFaq, fill = 'min(520px, calc(var(--app-vh,100dvh) - 220px))' }) {
  const [q, setQ] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const busy = chat.some(m => m.loading);
  // 새 말풍선이 생기거나 답이 왔을 때만 main(스크롤 통)을 맨 아래로 — 판이 다시 붙을 때(폰: 위키 목록 → 물어보기)는 내리지 않는다.
  // scrollIntoView는 폰에서 main 말고 페이지 전체까지 밀어 화면이 살짝 밀렸다(사용자 지적 2026-10-03).
  const seenRef = useRef(`${chat.length}:${chat[chat.length - 1]?.loading ? 1 : 0}`);
  useEffect(() => {
    const sig = `${chat.length}:${chat[chat.length - 1]?.loading ? 1 : 0}`;
    if (seenRef.current === sig) return;
    seenRef.current = sig;
    const main = endRef.current?.closest('main');
    main?.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  }, [chat.length, chat[chat.length - 1]?.loading]);

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
  // 누를 때마다 react.n이 늘어 애니메이션이 처음부터 다시 돈다(같은 버튼을 다시 누르면 풀린다 — 그때는 움직이지 않는다)
  const rate = (m, v) => {
    const next = m.rated === v ? null : v;
    setChat(c => c.map(x => (x.id === m.id ? { ...x, rated: next, react: next ? { v: next, n: (x.react?.n || 0) + 1, at: Date.now() } : x.react } : x)));
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
      <div className="dab-home flex flex-col items-center justify-center gap-2.5 text-center px-4 py-6" style={{ minHeight: fill }}>
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
    <div className="dab-chat flex flex-col" style={{ minHeight: fill }}>
      <div className="flex-1 grid content-start gap-3 px-1 py-3">
        {chat.map(m => (
          <div key={m.id} className="grid gap-3">
            <div className="dab-q dab-q-in justify-self-end max-w-[82%] rounded-[14px_14px_4px_14px] bg-accent text-white px-3 py-2 text-[13.5px] leading-relaxed break-words">{m.q}</div>
            <div className="grid grid-cols-[34px_1fr] gap-2 items-start">
              <span key={m.react ? `${m.react.v}${m.react.n}` : 'still'} className={`w-[34px] h-[34px] rounded-full overflow-hidden ${fresh(m) ? (m.react.v === 'good' ? 'dab-hop' : 'dab-droop') : ''}`} style={{ background: 'var(--app-hero)' }}><Face size={34} className="bg-transparent" /></span>
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
      {/* bottom 0 — 스티키 자리는 main의 아래 여백(폰은 하단 바 몫)을 이미 뺀 곳이라 더 띄우면 하단 바 높이만큼 떠 있었다(2026-10-03) */}
      <div className="sticky bottom-0 pt-2 pb-1 bg-gradient-to-t from-[var(--app-canvas)] via-[var(--app-canvas)] to-transparent">{input}</div>
    </div>
  );
}

function Answer({ m, onOpenCite, onOpenFile, onOpenFaq, onRate }) {
  const a = m.a;
  const refused = a.status === 'refused';
  const cites = [];
  // 자주 묻는 질문 장은 마스터만 본다(0090) — onOpenFaq가 없으면(마스터 아님) 그 장으로 가는 칩을 세우지 않는다
  const isFaq = (c) => c.t === 'page' && c.id === 'faq';
  for (const s of a.sentences || []) for (const c of s.cites || []) if ((onOpenFaq || !isFaq(c)) && !cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
  if (onOpenFaq && a.status === 'unknown' && /자주 묻는 질문/.test(a.sentences?.[0]?.text || '') && !cites.some(isFaq)) cites.push({ t: 'page', id: 'faq', label: '자주 묻는 질문' });
  return (
    <div className={`dab-answer dab-bub-in justify-self-start min-w-0 max-w-full rounded-[4px_14px_14px_14px] px-3 py-2.5 text-[13.5px] leading-[1.7] text-fg ${refused ? 'bg-surface-hover' : ''}`}
      style={refused ? undefined : { background: 'var(--app-hero)' }} data-status={a.status}>
      <span className="block text-[11px] font-bold text-accent-text mb-0.5">다붓이</span>
      <span className="break-words">{(a.sentences || []).map(s => s.text).join(' ')}</span>
      {cites.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {cites.map(c => <CiteChip key={`${c.t}:${c.id}`} cite={c} onOpen={isFaq(c) ? onOpenFaq : onOpenCite} />)}
        </div>
      )}
      {(a.files || []).map(f => <FileCard key={f.id} file={f} onOpen={onOpenFile} />)}
      {!refused && a.id && (
        <div className="flex items-center gap-0.5 mt-1.5 -mb-1 -ml-1">
          <Thumb m={m} v="good" onRate={onRate} />
          <Thumb m={m} v="bad" onRate={onRate} />
        </div>
      )}
    </div>
  );
}

// 반응 애니메이션은 **누른 직후**만 — 판이 다시 붙을 때(위키에 갔다 오기) 또 돌지 않게(사용자 지적 2026-10-03)
const fresh = (m) => !!m.react && Date.now() - (m.react.at || 0) < 1000;

// 👍/👎 한 칸 — 좋아요는 손이 튀며 빛 조각 여덟 개가 터지고(채움 · accent), 싫어요는 손이 흔들린다(채움 · 붉은 톤).
// 같은 쪽을 다시 누르면 풀린다. 다붓이 얼굴의 폴짝/고개 숙임은 말풍선 옆 얼굴이 같은 react로 돈다.
function Thumb({ m, v, onRate }) {
  const on = m.rated === v;
  const Icon = v === 'good' ? ThumbsUp : ThumbsDown;
  const label = v === 'good' ? '도움이 됐어요' : '도움이 안 됐어요';
  const color = v === 'good' ? 'var(--app-accent-text)' : 'var(--app-tag-red-fg)';
  const anim = on && m.react?.v === v && fresh(m) ? (v === 'good' ? 'dab-thumb-pop' : 'dab-thumb-shake') : '';
  return (
    <button type="button" onClick={() => onRate(m, v)} aria-label={label} title={label} aria-pressed={on}
      className={`dab-thumb relative w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors active:scale-90 ${on ? '' : 'text-fg-faint hover:text-fg-muted hover:bg-surface-hover'}`}
      style={on ? { color, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}>
      <span key={on ? `${m.react?.n}` : 'off'} className={`inline-flex ${anim}`}><Icon size={13} fill={on ? 'currentColor' : 'none'} /></span>
      {on && v === 'good' && fresh(m) && (
        <span key={`b${m.react?.n}`} className="dab-burst" aria-hidden="true" style={{ '--c': color }}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map(d => <i key={d} style={{ '--a': `${d}deg` }} />)}
        </span>
      )}
    </button>
  );
}

// 처음 화면의 질문 칩 — 자주 묻는 질문(사람들이 실제로 물은 것) 먼저, 모자라면 위키 장에서 만든 기본 질문
export function chipsFrom(pages) {
  const out = [];
  const faq = pages.find(p => p.id === 'faq');
  for (const it of faq?.blocks?.[0]?.items || []) if (it.meta?.q && out.length < 2) out.push(it.meta.q);
  const sermon = pages.find(p => p.id === 'sermon');
  const lastSvc = sermon?.blocks?.[0]?.meta?.date;
  // 문구는 사용자 것(2026-10-03) · 송폼 질문은 뺐다(같은 날 — 모델이 '그 전주 금요일'을 '그 주 금요일'로 옮겨 검증에 걸렸다)
  const base = ['월례회는 언제 해요?', '엔지니어팀은 어떤 팀이에요?', lastSvc ? `${mdLabel(lastSvc)} 예배 큐시트는 어디에 있나요?` : '예배 큐시트는 어디에 있나요?'];
  for (const b of base) if (out.length < 3 && !out.includes(b)) out.push(b);
  return out;
}
