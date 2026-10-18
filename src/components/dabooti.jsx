import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Lock, ThumbsUp, ThumbsDown } from 'lucide-react';
import { askDabooti, sendFeedback, tellDabooti } from '../services/wiki.js';
import { imeComposing, coarsePointer } from '../utils.js';
import { prefersReducedMotion } from '../hooks/useReducedMotion.js';
import { glideTo } from '../hooks/scrollGlide.js';
import { chipPool, rotateChips, normQ, chatExpired, looksFollowUp, waitLine, tellTurn, TELL_ASK, NUDGE, TALK_ANSWERS } from '../services/wikiCore.js';
import { fetchMyPerson, fetchGroups, fetchGroupMembers } from '../services/people.js';
import { revealPlan, revealAt, revealTotal, sliceGlyphs } from '../services/answerReveal.js';

// ============================================================================
// 다붓이 — 입구(상단 알약 · 폰 얼굴)와 물어보기 판 (0088 · 16차 · 목업 v12)
// ----------------------------------------------------------------------------
// 컷은 원본 시트에서 자른 '물음표' 컷 하나(public/chars/question · 85×85, @2x 170). 얼굴 자리는 그 컷을
// 동그라미에 담아 위쪽(50% 20%)을 보인다. 효과는 index.css의 dab-tilt(갸웃) · dab-ring(무지개 테두리).
// 답은 서버가 근거를 찾고 검증까지 끝낸 것만 온다(api/_wikiAsk.js) — 여기서는 그리기만 한다.
// 대화는 이 모듈이 쥔다(useDabootiChat · 2026-10-04) — 앱이 떠 있는 동안 화면을 오가도 남고, 새로 열거나
// 30분 넘게 가려져 있다 돌아오면 빈다(wikiCore.chatExpired · localStorage에 쓰지 않는다 · 메모리만).
// 학습 고리(20차 ⑧ · 사용자 결정 2026-10-13): 👎를 누르면 다붓이가 '어떻게 말해야 할까요?'를 묻는 말풍선({ tellFor }) —
// 평소 입력창의 다음 말이 원래 물음과 이어지면 알려 준 말(wikiCore.tellTurn → services/wiki.tellDabooti · 고마움 말풍선 { told }),
// 다른 물음이면 새 질문(알려 주기는 접는다). 👎를 풀거나 👍로 바꾸면 아직 답하지 않은 그 말풍선을 걷는다(마지막 것만).
// 서버가 nudge를 단 답은 말풍선 끝에 권유 한 줄(NUDGE · 가운데 👎 아이콘은 답 줄의 버튼과 같은 회색 선 아이콘).
// 답 속도(v5 2묶음 · 사용자 승인 시안 mock/b3 · services/answerReveal.js): 서버가 답보다 먼저 '찾은 근거'를 흘리면(onEvidence — api/_wikiAsk.js
// earlyEvidence · 게스트는 services/dabootiDemo.js 흉내) 기다리는 말풍선에 그 칩이 먼저 선다. 답이 오면 **검사가 끝난 문장**을 한 문장씩 쳐 나가듯 펼친다
// (근거를 먼저 받은 답 · a.reveal만 — 바로 오는 답·같은 말 기억은 그대로) · 다 펼친 뒤 권유 줄·파일·👍/👎. 움직임 줄이기면 한 번에.
// ============================================================================

// ── 대화 · 같은 질문 답 (메모리만) ─────────────────────────────────────────────
let chatNow = [];
const chatSubs = new Set();
const setChatStore = (next) => {
  const v = typeof next === 'function' ? next(chatNow) : next;
  if (v === chatNow) return;
  chatNow = v;
  chatSubs.forEach(f => f());
};
// 같은 질문을 이 앱 세션 안에서 다시 물으면 서버에 가지 않고 앞의 답을 쓴다(10분 · 30개 · 오래된 것부터 뺀다)
const ANSWER_TTL = 10 * 60 * 1000;
const answerMemo = new Map();
const memoGet = (q) => {
  const hit = answerMemo.get(normQ(q));
  if (!hit || Date.now() - hit.at > ANSWER_TTL) return null;
  return hit.a;
};
const memoPut = (q, a) => {
  const k = normQ(q);
  answerMemo.delete(k);
  answerMemo.set(k, { a, at: Date.now() });
  while (answerMemo.size > 30) answerMemo.delete(answerMemo.keys().next().value);
};
let hiddenAt = null;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (chatExpired(hiddenAt, Date.now())) { setChatStore([]); answerMemo.clear(); }
    hiddenAt = null;
  });
}
const subscribeChat = (f) => { chatSubs.add(f); return () => chatSubs.delete(f); };
const chatSnap = () => chatNow;
export function useDabootiChat() {
  const chat = useSyncExternalStore(subscribeChat, chatSnap, chatSnap);
  return [chat, setChatStore];
}

// 묻는 사람의 순(올해) — '지난 주일 OO순에는 누가 왔나요?' 칩. 순이 없거나 게스트면 ''(칩을 뺀다). 한 번만 읽는다.
let sunPromise = null;
function loadMySun() {
  if (!sunPromise) {
    sunPromise = (async () => {
      const me = await fetchMyPerson();
      if (!me) return '';
      const year = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
      const suns = await fetchGroups('sun', year);
      const members = await fetchGroupMembers(suns.map(g => g.id));
      const mine = suns.find(g => g.leader_person_id === me.id || members.some(m => m.group_id === g.id && m.person_id === me.id));
      return mine?.name || '';
    })().catch(() => { sunPromise = null; return ''; });
  }
  return sunPromise;
}
const SUN_MARK = '{순}';   // 칩 문구의 자리표 — 그대로 화면에 나가지 않는다(채우거나 칩을 뺀다)

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

// 폰 상단 아이콘 줄 맨 앞 — 옅은 파란 고리로 다른 아이콘과 가른다.
// 아이패드 세로(768~1023)의 데스크톱 상단 바도 알약 대신 이 얼굴이다(layout.jsx TopNav · 시안 승인 2026-10-14).
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
// pending — 밖에서 넣는 질문 { q, n }(자주 묻는 질문 장의 '많이 물어본 질문' 칩 · n이 바뀔 때마다 한 번 묻는다)
export function AskPanel({ chat, setChat, chips = [], onOpenCite, onOpenFile, onOpenFaq, pending = null, fill = 'min(520px, calc(var(--app-vh,100dvh) - 220px))' }) {
  const [q, setQ] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const busy = chat.some(m => m.loading);
  // 새 말풍선이 생기거나 답이 왔을 때만 main(스크롤 통)을 맨 아래로 — 판이 다시 붙을 때(폰: 위키 목록 → 물어보기)는 내리지 않는다.
  // scrollIntoView는 폰에서 main 말고 페이지 전체까지 밀어 화면이 살짝 밀렸다(사용자 지적 2026-10-03).
  // **긴 답은 끝이 아니라 처음부터 보이게**(2026-10-15 · PITFALLS 56-g) — 맨 아래로만 내리면 화면보다 긴 답은 끝부분이 서서
  // 위로 거슬러 올라가 읽어야 했다. 답이 온 그 질문 말풍선부터 답 끝까지가 보이는 높이(입력 칸 뺀)보다 크면 질문을 맨 위에 세운다.
  // 움직임은 앱 곡선(scrollGlide · 움직임 줄이기면 즉시). 그때는 맨 아래가 아니므로 키보드 바닥 붙이기(stickRef)도 푼다.
  const seenRef = useRef(`${chat.length}:${chat[chat.length - 1]?.loading ? 1 : 0}`);
  useEffect(() => {
    const sig = `${chat.length}:${chat[chat.length - 1]?.loading ? 1 : 0}`;
    if (seenRef.current === sig) return;
    seenRef.current = sig;
    const main = endRef.current?.closest('main');
    if (!main) return;
    const last = chat[chat.length - 1];
    const turn = last && !last.loading && last.a ? main.querySelector(`[data-turn="${last.id}"]`) : null;
    const qEl = turn?.querySelector('.dab-q');
    if (qEl) {
      const top = main.getBoundingClientRect().top;
      const room = main.clientHeight - (inputRef.current?.closest('.sticky')?.offsetHeight || 0) - 16;   // 아래에 붙은 입력 줄(sticky)이 가리는 몫
      const qTop = qEl.getBoundingClientRect().top;
      if (turn.getBoundingClientRect().bottom - qTop > room) {
        stickRef.current = false;
        glideTo(main, main.scrollTop + qTop - top - 12);
        return;
      }
    }
    glideTo(main, main.scrollHeight);
  }, [chat.length, chat[chat.length - 1]?.loading]);  // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text) => {
    const question = String(text ?? q).trim();
    if (!question || busy) return;
    setQ('');
    if (coarsePointer()) inputRef.current?.blur();
    // 👎 뒤 '어떻게 말해야 할까요?'에 이어진 말 — 원래 물음과 이어지면 알려 준 말(고마움 말풍선 · 서버 { tell }), 아니면 그 말풍선은 접고 새 질문
    const open = [...chat].reverse().find(m => m.tellFor && !m.closed);
    if (open) {
      const told = tellTurn(question) === 'tell';
      const id = `${Date.now()}`;
      setChat(c => [...c.map(m => (m.id === open.id ? { ...m, closed: true } : m)),
        ...(told ? [{ id, q: question, told: true, a: { status: 'answered', sentences: [{ text: TALK_ANSWERS.statement, cites: [] }], files: [] } }] : [])]);
      if (told) { tellDabooti(open.qid, question); return; }
    }
    // 앞 질문들을 줄바꿈으로 — 마지막 줄이 바로 앞 질문(서버가 다시 쓴 꼴 a.asked가 있으면 그것) + 맨 끝 '[답] 앞 답 첫 문장'.
    // 서버는 앞 대화를 모델에 그대로 준다([앞 대화] · 18차 2회) — 출석·생일만 코드가 바꿔 끼운다(followUpRule · a.asked) · 앞에서 알려 준 말도 본다(talkKind)
    const done = chat.filter(m => m.a && !m.told);   // 알려 준 말과 그 고마움은 앞 대화가 아니다
    const lastA = done[done.length - 1]?.a?.sentences?.[0]?.text || '';
    const prev = [...done.slice(-6).map(m => (m.a.asked || m.q).replace(/\s*\n\s*/g, ' ')), ...(lastA ? [`[답] ${lastA.replace(/\s*\n\s*/g, ' ')}`] : [])].join('\n');
    // 이어 묻는 말은 앞 대화에 따라 답이 달라서 같은 말 기억(10분)을 쓰지 않는다
    const follow = done.length > 0 && looksFollowUp(question);
    const id = `${Date.now()}`;
    const known = follow ? null : memoGet(question);
    if (known) { setChat(c => [...c, { id, q: question, a: known }]); return; }
    setChat(c => [...c, { id, q: question, loading: true, since: Date.now(), follow: !!prev }]);
    try {
      // 서버가 흘려보내는 단계(기록 모음 → 답 작성 → flash-lite) — 기다리는 말풍선이 그 단계의 문구를 고른다(wikiCore.waitLine)
      const onStage = (stage) => setChat(c => c.map(m => (m.id === id && m.loading ? { ...m, stage } : m)));
      const onEvidence = (evidence) => setChat(c => c.map(m => (m.id === id && m.loading ? { ...m, evidence } : m)));
      const a = await askDabooti(question, prev, { onStage, onEvidence });
      // 받아친 말 · 학습하지 마(a.talk · 2026-10-17)는 앞 대화에 따라 다르고 '학습하지 마'는 서버가 앞 질문을 빼야 해서 기억하지 않는다
      if (!follow && !a.asked && !a.talk) memoPut(question, a);
      // 근거를 먼저 받은 답(또는 a.reveal)은 한 문장씩 — 펼치기 시작 시각을 적어 두어 판이 다시 붙어도 처음부터 다시 돌지 않는다
      setChat(c => c.map(m => (m.id === id ? { ...m, loading: false, a, revealFrom: (m.evidence || a.reveal) && !prefersReducedMotion() ? Date.now() : null } : m)));
    } catch (e) {
      setChat(c => c.map(m => (m.id === id ? { ...m, loading: false, err: e.human || '답을 받지 못했어요' } : m)));
    }
  };
  const retry = (m) => { setChat(c => c.filter(x => x.id !== m.id)); send(m.q); };
  // 누를 때마다 react.n이 늘어 애니메이션이 처음부터 다시 돈다(같은 버튼을 다시 누르면 풀린다 — 그때는 움직이지 않는다)
  // 👎(권유 줄이 있든 없든 모든 👎) →다붓이가 묻는 말풍선을 맨 뒤에 하나 · 풀거나 👍로 바꾸면 아직 이어진 말이 없는 그 말풍선을 걷는다
  const rate = (m, v) => {
    const next = m.rated === v ? null : v;
    setChat(c => {
      const out = c.map(x => (x.id === m.id ? { ...x, rated: next, react: next ? { v: next, n: (x.react?.n || 0) + 1, at: Date.now() } : x.react } : x))
        .filter(x => !(x.tellFor === m.id && !x.closed));
      return next === 'bad' && m.a?.id ? [...out, { id: `t${Date.now()}`, tellFor: m.id, qid: m.a.id, oq: m.a.asked || m.q }] : out;
    });
    sendFeedback(m.a?.id, next);
  };
  // 밖에서 넣은 질문(자주 묻는 질문 칩) — n이 바뀔 때 한 번
  useEffect(() => { if (pending?.q) send(pending.q); }, [pending?.n]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 바뀌는 질문 칩(사용자 결정 2026-10-04) — 셋을 보이고 4초마다 한 칸씩 돌아가며 다음 질문으로 바꾼다.
  // 칩 위에 손이 있거나 · 칸에 초점이 있거나 · 치는 중이면 멈춘다 · 움직임 줄이기면 돌리지 않는다.
  const [sun, setSun] = useState('');
  useEffect(() => { let live = true; loadMySun().then(n => { if (live) setSun(n); }); return () => { live = false; }; }, []);
  const pool = useMemo(() => chips.map(c => (c.includes(SUN_MARK) ? (sun ? c.replace(SUN_MARK, sun) : '') : c)).filter(Boolean), [chips, sun]);
  const [rot, setRot] = useState({ slots: [0, 1, 2], turn: 0, next: 3, n: 0 });
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  // 맨 아래(마지막 답)를 보고 있다가 칸을 누르면, 키보드가 올라와 main이 줄어도 맨 아래를 유지한다 —
  // 안 그러면 마지막 답이 키보드 뒤로 숨었다(사용자 지적 2026-10-05). 위로 올려 읽던 중이면 건드리지 않는다.
  const stickRef = useRef(false);
  const onFocusInput = () => {
    setFocus(true);
    const m = inputRef.current?.closest('main');
    stickRef.current = !!m && m.scrollHeight - m.scrollTop - m.clientHeight < 48;
  };
  const hasChat = chat.length > 0;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !hasChat) return undefined;
    const keep = () => requestAnimationFrame(() => {
      if (!stickRef.current || document.activeElement !== inputRef.current) return;
      const m = inputRef.current.closest('main');
      if (m) m.scrollTop = m.scrollHeight;
    });
    vv.addEventListener('resize', keep);
    return () => vv.removeEventListener('resize', keep);
  }, [hasChat]);
  const still = hover || focus || !!q || chat.length > 0;
  useEffect(() => {
    if (still || pool.length <= 3 || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => { if (!document.hidden) setRot(r => ({ ...rotateChips(r, pool.length), n: r.n + 1 })); }, CHIP_EVERY);
    return () => clearInterval(t);
  }, [still, pool.length]);
  const target = rot.slots.map(i => pool[i]).filter(Boolean);
  // 칩 바꾸기는 두 박자(사용자 지적 2026-10-05 — 줄이 바뀔 때마다 뚝뚝 끊겼다): ① 바뀌는 칩이 흐려지며 빠지고(CHIP_OUT)
  // ② 새 문구로 갈아 끼우면 나머지 칩은 새 자리로 미끄러지고(FLIP) 묶음 높이도 따라 늘고 준다. 다붓이 갸웃은 ②에 한 번 —
  // 칩이 도는 동안은 5초 고리(CSS) 대신 칩과 같은 박자로만 갸웃한다(칩이 멈추면 갸웃도 쉰다 · 칩이 셋 이하면 예전 고리).
  const [shown, setShown] = useState(target);
  const [leaving, setLeaving] = useState(-1);
  const targetKey = target.join('|');
  useEffect(() => {
    // 회전이 아닌 바뀜(내 순 이름을 불러와 칩 목록이 바뀜 · rot.n 0)은 바로 갈아 끼운다 — 빠짐·미끄러짐·갸웃은 회전에서만
    if (rot.n === 0 || target.length !== shown.length || prefersReducedMotion()) { setShown(target); return undefined; }
    const k = target.findIndex((t, i) => t !== shown[i]);
    if (k < 0) return undefined;
    setLeaving(k);
    const t = setTimeout(() => { setLeaving(-1); setShown(target); }, CHIP_OUT);
    return () => clearTimeout(t);
  }, [targetKey]);  // eslint-disable-line react-hooks/exhaustive-deps
  const chipsRef = useRef(null);
  const faceRef = useRef(null);
  const rects = useRef({ box: 0, chips: [], texts: [] });
  useLayoutEffect(() => {
    const box = chipsRef.current;
    if (!box) return;
    const els = [...box.children];
    const base = box.getBoundingClientRect();
    const now = { box: base.height, texts: shown, chips: els.map(el => { const r = el.getBoundingClientRect(); return { x: r.left - base.left, y: r.top - base.top }; }) };
    const was = rects.current;
    rects.current = now;
    if (rot.n === 0 || prefersReducedMotion() || !box.animate) return;
    const ease = { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' };
    els.forEach((el, i) => {
      const p = was.chips[i];
      if (!p || was.texts[i] !== shown[i]) return;   // 새로 들어온 칩은 제 등장 움직임(Chip)으로
      const dx = p.x - now.chips[i].x; const dy = p.y - now.chips[i].y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], ease);
    });
    if (was.box && Math.abs(was.box - now.box) > 0.5) box.animate([{ height: `${was.box}px` }, { height: `${now.box}px` }], ease);
    faceRef.current?.animate?.(TILT_FRAMES, { duration: 1100, easing: 'ease-in-out' });
  }, [shown.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps
  const syncTilt = pool.length > 3 && !prefersReducedMotion();

  const input = (
    <div className="dab-input flex items-center gap-2 rounded-full border border-accent bg-surface pl-4 pr-1.5 py-1.5 w-full shadow-[0_1px_0_rgba(0,0,0,.02)]">
      <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} maxLength={300}
        onFocus={onFocusInput} onBlur={() => setFocus(false)}
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
        <div className={`${syncTilt ? 'dab-tilt-sync' : 'dab-tilt'} dc-card flex flex-col items-center gap-1.5`}>
          <img ref={faceRef} src={DAB_CUT.src} srcSet={cutSet(DAB_CUT.src)} width={DAB_CUT.w} height={DAB_CUT.h} alt="" aria-hidden="true" draggable="false" className="dab-face" />
          <b className="text-[16px] text-fg tracking-[-0.3px]">다붓이에게 물어보기</b>
        </div>
        {shown.length > 0 && (
          <div ref={chipsRef} className="dab-chips flex flex-wrap justify-center content-start gap-1.5 max-w-[560px] mt-1" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
            {shown.map((c, i) => <Chip key={`${i}:${c}`} text={c} i={i} swapped={rot.n > 0} leaving={i === leaving} onPick={send} />)}
          </div>
        )}
        <div className="w-full max-w-[520px] mt-1.5 dc-card" style={{ animationDelay: '160ms' }}>{input}</div>
      </div>
    );
  }

  return (
    <div className="dab-chat flex flex-col" style={{ minHeight: fill }}>
      {/* 열은 minmax(0,1fr) — 그냥 grid면 열이 내용의 최소 폭(띄어쓰기 없는 긴 낱말·주소)만큼 커져 질문·답 말풍선이
          둘 다 화면 오른쪽 밖으로 밀렸다(2026-10-14 점검 · PITFALLS 49-a). 말풍선 글은 overflow-wrap:anywhere로 어디서든 끊는다. */}
      <div className="flex-1 grid grid-cols-[minmax(0,1fr)] content-start gap-3 px-1 py-3">
        {chat.map(m => (m.tellFor ? (
          // 👎 뒤에 다붓이가 묻는 말 — 다음 말을 평소 입력창에서 받는다(따로 칸 없음)
          <div key={m.id} className="dab-tell grid grid-cols-[34px_minmax(0,1fr)] gap-2 items-start">
            <span className="w-[34px] h-[34px] rounded-full overflow-hidden" style={{ background: 'var(--app-hero)' }}><Face size={34} className="bg-transparent" /></span>
            <div className="dab-bub-in justify-self-start min-w-0 rounded-[4px_14px_14px_14px] px-3 py-2.5 text-[13.5px] leading-[1.7] text-fg" style={{ background: 'var(--app-hero)' }}>
              <span className="block text-[11px] font-bold text-accent-text mb-0.5">다붓이</span>
              {TELL_ASK}
            </div>
          </div>
        ) : (
          <div key={m.id} data-turn={m.id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="dab-q dab-q-in justify-self-end max-w-[82%] rounded-[14px_14px_4px_14px] bg-accent text-white px-3 py-2 text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">{m.q}</div>
            <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 items-start">
              <span key={m.react ? `${m.react.v}${m.react.n}` : 'still'} className={`w-[34px] h-[34px] rounded-full overflow-hidden ${fresh(m) ? (m.react.v === 'good' ? 'dab-hop' : 'dab-droop') : ''}`} style={{ background: 'var(--app-hero)' }}><Face size={34} className="bg-transparent" /></span>
              {m.loading ? (
                <div className="dab-bub-in justify-self-start rounded-[4px_14px_14px_14px] px-3 py-3" style={{ background: 'var(--app-hero)' }} aria-label="다붓이가 답을 찾는 중">
                  <WaitLine stage={m.stage} since={m.since} follow={m.follow} />
                  <span className="dab-dots inline-flex gap-1 align-middle"><span /><span /><span /></span>
                  {/* 찾은 근거 먼저(v5 2묶음) — 답보다 먼저 칩이 하나씩 선다 · 누르면 그 업무·장으로 */}
                  {m.evidence?.length > 0 && (
                    <div data-dab-evidence="" className="flex flex-wrap gap-1 mt-2">
                      {m.evidence.map((c, i) => <span key={`${c.t}:${c.id}`} className="dc-card inline-flex max-w-full" style={{ animationDelay: `${i * 90}ms` }}><CiteChip cite={c} onOpen={onOpenCite} /></span>)}
                    </div>
                  )}
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
        )))}
        <div ref={endRef} />
      </div>
      {/* bottom 0 — 스티키 자리는 main의 아래 여백(폰은 하단 바 몫)을 이미 뺀 곳이라 더 띄우면 하단 바 높이만큼 떠 있었다(2026-10-03) */}
      <div className="sticky bottom-0 pt-2 pb-1 bg-gradient-to-t from-[var(--app-canvas)] via-[var(--app-canvas)] to-transparent">{input}</div>
    </div>
  );
}

// 칩 한 개 — 처음 셋은 화면 등장(dc-card)과 같이, 바뀌어 들어온 칩은 0.45초 아래에서 떠오르며 나타난다(Web Animations — CSS를 더하지 않는다)
const CHIP_EVERY = 4000;
const CHIP_OUT = 200;   // 바뀌는 칩이 빠지는 시간(.dab-chip-out과 같다)
// 갸웃 — index.css의 dab-tilt 고리에서 움직이는 마디(78~100%)만 떼어 한 번(1.1초)
const TILT_FRAMES = [{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg)', offset: 0.27 }, { transform: 'rotate(8deg)', offset: 0.55 }, { transform: 'rotate(-3deg)', offset: 0.77 }, { transform: 'rotate(0)' }];
// 기다리는 말(사용자 확정 문구 2026-10-12 · 1-c) — 시간으로 돌리던 다섯 줄(2026-10-05)을 **서버의 실제 단계**에 맞췄다.
// 문구 다섯 줄과 고르는 규칙은 wikiCore(WAIT_LINES · waitLine — logcheck가 본다): 처음 1.5초는 점만 · 기록 모음 → 답 작성 ·
// 15초 넘음 · flash-lite로 넘어감 · 앞 대화가 있으면 첫 단계 대신 '앞 이야기들과…'. 바로 오는 답(캐시·출석·생일·인사)은 문구 없이 점만.
// 모션 최소화면 처음 선 말에 머문다(바꾸지 않는다 — 예전 규칙 그대로).
function WaitLine({ stage = '', since = Date.now(), follow = false }) {
  const [now, setNow] = useState(() => Date.now());
  const frozen = useRef('');
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  let line = waitLine(stage, now - since, follow);
  if (prefersReducedMotion()) { if (!frozen.current) frozen.current = line; line = frozen.current; }
  if (!line) return null;
  return <span key={line} className="dab-wait mr-1.5 text-[13px] text-fg-muted">{line}</span>;
}

function Chip({ text, i, swapped, leaving, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (swapped && ref.current?.animate) ref.current.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button ref={ref} type="button" onClick={() => onPick(text)} style={swapped ? undefined : { animationDelay: `${80 + i * 40}ms` }}
      className={`dab-chip ${swapped ? '' : 'dc-card '}${leaving ? 'dab-chip-out ' : ''}rounded-full border border-line bg-surface px-3 py-[5px] text-[12px] text-fg transition hover:bg-surface-hover active:scale-95`}>{text}</button>
  );
}

// 한 문장씩 펼치기 — revealFrom부터 지난 시간으로 문장마다 보인 글자 수(services/answerReveal). 끝났거나 없으면 null.
function useReveal(m) {
  const texts = useMemo(() => (m.a?.sentences || []).map(x => x.text || ''), [m.a]);
  const plan = useMemo(() => revealPlan(texts), [texts]);
  const total = revealTotal(plan);
  const live = !!m.revealFrom && Date.now() - m.revealFrom < total;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return undefined;
    let raf = 0;
    const tick = () => { setNow(Date.now()); if (Date.now() - m.revealFrom < total) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, m.revealFrom, total]);
  if (!m.revealFrom) return null;
  const r = revealAt(plan, now - m.revealFrom);
  return r.done ? null : r.shown;
}

function Answer({ m, onOpenCite, onOpenFile, onOpenFaq, onRate }) {
  const a = m.a;
  const shown = useReveal(m);   // null = 다 보임
  const typing = !!shown;
  const cur = typing ? shown.findIndex((n, i) => n < Array.from(a.sentences[i]?.text || '').length) : -1;
  const refused = a.status === 'refused';
  const cites = [];
  // 자주 묻는 질문 장은 마스터만 본다(0090) — onOpenFaq가 없으면(마스터 아님) 그 장으로 가는 칩을 세우지 않는다
  const isFaq = (c) => c.t === 'page' && c.id === 'faq';
  for (const s of a.sentences || []) for (const c of s.cites || []) if ((onOpenFaq || !isFaq(c)) && !cites.some(x => x.t === c.t && x.id === c.id)) cites.push(c);
  // 모르는 질문은 마스터에게만 그 장 칩(답을 알려 주러 간다) — 장 이름은 '아직 답하지 못한 질문'(2026-10-13 · id는 faq 그대로)
  if (onOpenFaq && a.status === 'unknown' && !cites.some(isFaq)) cites.push({ t: 'page', id: 'faq', label: '아직 답하지 못한 질문' });
  return (
    <div className={`dab-answer dab-bub-in justify-self-start min-w-0 max-w-full rounded-[4px_14px_14px_14px] px-3 py-2.5 text-[13.5px] leading-[1.7] text-fg [overflow-wrap:anywhere] ${refused ? 'bg-surface-hover' : ''}`}
      style={refused ? undefined : { background: 'var(--app-hero)' }} data-status={a.status}>
      <span className="block text-[11px] font-bold text-accent-text mb-0.5">다붓이</span>
      {a.verses?.length > 0 ? (
        <>
          {/* 성경 구절(bible) — 어느 말씀인지 한 줄 · 절마다 한 줄 · 그 아래 말씀 탭 안내(여덟 절 넘을 때) */}
          <span className="break-words">{a.sentences?.[0]?.text}</span>
          <span className="dab-verses block mt-1 mb-0.5 pl-2.5 border-l-2 border-line">
            {a.verses.map(v => <span key={v.n} className="block"><b className="text-[11px] font-semibold text-fg-muted mr-1">{v.n}</b>{v.text}</span>)}
          </span>
          {a.sentences.length > 1 && <span className="block break-words">{a.sentences.slice(1).map(s => s.text).join(' ')}</span>}
        </>
      ) : typing ? (
        // 펼치는 중 — 다 펼친 글과 같은 줄바꿈이 되게 남은 글자는 투명하게 자리를 잡아 둔다(말풍선이 늘었다 줄었다 하지 않는다)
        <span className="break-words" data-dab-typing="" aria-busy="true">
          {(a.sentences || []).map((s, i) => {
            const vis = sliceGlyphs(s.text, shown[i]);
            const rest = Array.from(s.text || '').slice(shown[i]).join('');
            return <span key={i}>{i > 0 ? ' ' : ''}{vis}{i === cur && <span className="dab-caret" aria-hidden="true" />}<span className="opacity-0">{rest}</span></span>;
          })}
        </span>
      ) : (
        <span className="break-words">{(a.sentences || []).map(s => s.text).join(' ')}</span>
      )}
      {/* 권유 한 줄(20차 ⑧ · 사용자 문구) — 글자는 accent 600 · 가운데 아이콘은 아래 👎 버튼과 같은 회색 선 아이콘(누르는 자리는 아래 버튼) */}
      {a.nudge && !refused && !typing && (
        <span className="dab-nudge block mt-1 font-semibold text-accent-text break-words">
          {NUDGE.before}<ThumbsDown size={13} fill="none" className="inline-block align-[-2px] text-fg-faint" role="img" aria-label="싫어요" />{NUDGE.after}
        </span>
      )}
      {cites.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {cites.map(c => <CiteChip key={`${c.t}:${c.id}`} cite={c} onOpen={isFaq(c) ? onOpenFaq : onOpenCite} />)}
        </div>
      )}
      {!typing && (a.files || []).map(f => <FileCard key={f.id} file={f} onOpen={onOpenFile} />)}
      {!refused && a.id && !typing && (
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

// 처음 화면의 질문 칩 — 사용자 문구 15개(2026-10-04 · wikiCore.chipPool). 큐시트 칩 날짜는 설교 장의 마지막 주보 날,
// 묻는 사람의 순 칩은 자리표(SUN_MARK)로 두고 AskPanel이 순을 읽어 채운다(순이 없거나 게스트면 뺀다).
export function chipsFrom(pages) {
  const sermon = pages.find(p => p.id === 'sermon');
  return chipPool({ cueDate: sermon?.blocks?.[0]?.meta?.date || '', sun: SUN_MARK });
}
