import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LockOpen, X } from 'lucide-react';
import { generateId } from '../utils.js';
import { useAnchoredPos } from './ConfirmPopover.jsx';
import { LinkIcon } from './linkIcons.jsx';
import { docEmbedKind, DocEmbedModal, DocKindIcon, PwPrompt } from './DocEmbed.jsx';
import { isLocked, verifyViewPw } from '../services/viewPw.js';
import { showToast } from './Toast.jsx';
import { failText } from '../services/errorText.js';

// ============================================================================
// 참고 링크 부품 — **프로젝트 헤더 하나가 쓴다** (views.jsx)
// ----------------------------------------------------------------------------
// 예전에는 이 부품이 views.jsx 안에 있었고, 0058이 `resource_links.card_id`를 열면서
// 업무 창도 같은 부품을 보게 되어 여기로 나왔다. 2026-09-10에는 업무 창의 링크를
// 첨부 구역 안 한 줄(`LinkRow`)로 옮겨 봤는데, **2026-09-11에 사용자가 되돌렸다** —
// 업무 창에는 링크가 없다(§6-35). 그래서 지금 남은 것은 헤더의 칩 한 벌이다.
// 파일은 여기 그대로 둔다: 부품이 views.jsx로 돌아가면 그 파일이 다시 불어난다.
//
// **한 벌로 두는 것이 요점이다.** 화면 가림 비밀번호 규칙은 이미 두 벌이고(§6-31-f)
// 여기서 또 갈라지면 세 벌이 된다 — 링크를 여는 판정(docEmbedKind), 잠금 판정(isLocked),
// 묻는 팝오버(PwPrompt), 비밀번호 설정 칸이 전부 이 파일 하나에 있다.
// ============================================================================

// ── 열기·잠금 상태 기계 ─────────────────────────────────────────────────────
// 구글 문서·시트·슬라이드는 새 탭이 아니라 **앱 안 창**에서 연다(DocEmbed.jsx) —
// 편집 권한이 열려 있는 링크면 그 자리에서 고쳐진다(사용자 요구 2026-09-07).
// 그 밖의 주소는 예전 그대로 새 탭이다. ⌘/Ctrl 누름은 어느 쪽이든 브라우저에 넘긴다.
//
// 비밀번호는 **화면 가림**이다(첨부 0023과 같은 한계 · services/viewPw.js). 그래서
// 걸 수 있는 자리를 **앱 안에서 여는 링크에만** 둔다 — 새 탭으로 나가는 링크에 비밀번호를
// 걸면 아무것도 막지 못하면서 막은 것처럼 보인다(화면이 거짓말한다).
// 한 번 맞춘 링크는 이 화면이 살아 있는 동안 다시 묻지 않는다(첨부 목록의 `unlocked`와 같다).
//
// `beforePaneRef`는 팝오버를 **열기 직전에** 부를 것(칩의 위치 잡기)이다 — 훅이 부를 때
// 최신 함수여야 해서 값이 아니라 ref로 받는다.
function useLinkAccess(link, onSetPw, beforePaneRef = null) {
  const kind = docEmbedKind(link.url);
  const [unlocked, setUnlocked] = useState(false);
  const [pane, setPane] = useState(null);     // null | 'ask'(열려고 묻는 중) | 'set'(걸거나 푸는 중)
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = isLocked(link) && !unlocked;

  const showPane = (p) => { beforePaneRef?.current?.(); setPane(p); };
  const togglePane = (p) => { beforePaneRef?.current?.(); setPane(cur => (cur === p ? null : p)); };

  // 이름(앵커)을 누를 때 — 구글 문서가 아니면 앵커의 기본 동작(새 탭)에 맡긴다
  const onLinkClick = (e) => {
    if (!kind) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (locked) { showPane('ask'); return; }
    setOpen(true);
  };
  const savePw = async (next) => {
    setBusy(true);
    try { await onSetPw?.(next); setPane(null); }
    catch (e) { console.error('[cloud] 링크 비밀번호 저장 실패:', e); showToast(failText('비밀번호를 저장하지 못했어요', e)); }
    finally { setBusy(false); }
  };
  const tryPw = async (typed) => {
    const ok = await verifyViewPw(link, typed);
    if (ok) { setUnlocked(true); setPane(null); setOpen(true); }
    return ok;
  };
  return { kind, locked, pane, setPane, showPane, togglePane, open, setOpen, busy, onLinkClick, savePw, tryPw };
}

// 비밀번호를 걸거나 푸는 칸 — 첨부의 PasswordSetter와 같은 문구·같은 배치다
// (modals/attachments.jsx). 칸이 닫히면 같이 사라지므로 적어 둔 글자도 남지 않는다.
function LinkPwFields({ link, busy, onSave }) {
  const [pw, setPw] = useState('');
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          type="text" value={pw} autoComplete="off" autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pw) onSave(pw); }}
          placeholder={link.view_pw ? '새 비밀번호' : '비밀번호를 정해주세요'}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-line bg-surface text-[13px] text-fg outline-none focus:border-accent transition-colors"
        />
        <button type="button" disabled={busy || !pw} onClick={() => onSave(pw)}
          className="px-2.5 py-1.5 rounded-md bg-accent text-white text-[11px] font-semibold transition active:scale-95 disabled:opacity-40 shrink-0">설정</button>
        {link.view_pw && (
          <button type="button" disabled={busy} onClick={() => onSave('')}
            className="px-2.5 py-1.5 rounded-md bg-surface-hover text-fg-muted text-[11px] font-semibold transition active:scale-95 shrink-0">잠금 해제</button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-fg-faint leading-relaxed">
        비밀번호를 아는 사람만 앱에서 열 수 있어요.
      </p>
    </>
  );
}

// ── 프로젝트 헤더의 링크 한 칸 ──────────────────────────────────────────────
// 여는 규칙·잠금 규칙은 위 useLinkAccess에 있다. 이 칩은 메타 줄에 한 줄로 서므로
// 비밀번호 칸을 줄 아래에 붙일 자리가 없어 포털 팝오버로 띄운다.
const LINK_POP_W = 268;
export function PinnedLinkChip({ link, canLock, onRemove, onSetPw }) {
  const rootRef = useRef(null);
  const anchorRef = useRef(null);
  const bodyRef = useRef(null);
  const placeRef = useRef(null);
  const acc = useLinkAccess(link, onSetPw, placeRef);
  const [pos, place] = useAnchoredPos(anchorRef, !!acc.pane, LINK_POP_W, 120);
  placeRef.current = place;   // 팝오버를 열기 전에 자리를 잡는다(안 그러면 첫 프레임이 {0,0}에 그려진다)
  const { kind, locked, pane, setPane } = acc;

  // 팝오버는 포털로 body에 나가 있으므로 **본체도 '안'으로 세어야 한다**
  // (링크 추가 팝오버가 같은 함정을 이미 이렇게 고쳐 두었다 — 아래 주석 참고).
  useEffect(() => {
    if (!pane) return;
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || bodyRef.current?.contains(e.target);
      if (!inside) setPane(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPane(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pane]);

  return (
    <span ref={rootRef} className="group/link inline-flex items-center gap-1 shrink-0">
      {/* 아는 서비스면 이름 앞에 글자만 한 표시가 붙는다(linkIcons.jsx). 구글 문서는
          종류 표시를 대신 붙인다 — 그 표시가 "앱 안에서 열린다"는 신호다. */}
      {/* gap은 공백 한 칸만큼(11px 글자에서 5px) — 3px로 붙였더니 표시가
          글자에 눌어붙어 보였다 */}
      <a ref={anchorRef} href={link.url} target="_blank" rel="noreferrer" onClick={acc.onLinkClick}
        className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-accent-text hover:underline whitespace-nowrap">
        {kind ? <DocKindIcon kind={kind} size={11} /> : <LinkIcon url={link.url} />}{link.title}
      </a>
      {locked && <Lock size={12} className="shrink-0 text-fg-faint" aria-label="비밀번호가 걸린 링크" />}
      {canLock && (
        <button type="button" onClick={() => acc.togglePane('set')}
          className="md:opacity-0 md:group-hover/link:opacity-100 transition-opacity text-fg-faint shrink-0"
          title="비밀번호 설정">
          {isLocked(link) ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      )}
      <button onClick={onRemove} className="md:opacity-0 md:group-hover/link:opacity-100 transition-opacity text-fg-faint shrink-0" title="링크 삭제"><X size={10} /></button>
      {pane && createPortal(
        <div ref={bodyRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: LINK_POP_W }}
          className="dc-pop bg-surface border border-line rounded-lg shadow-elevated p-3 z-[90]">
          {pane === 'ask' ? (
            <PwPrompt className="flex-wrap" onCancel={() => setPane(null)} onOk={acc.tryPw} />
          ) : (
            /* 첨부의 PasswordSetter와 같은 문구·같은 배치다(modals/attachments.jsx) */
            <LinkPwFields link={link} busy={acc.busy} onSave={acc.savePw} />
          )}
        </div>, document.body)}
      {acc.open && <DocEmbedModal url={link.url} title={link.title} onClose={() => acc.setOpen(false)} />}
    </span>
  );
}

// ── 링크 하나 추가하는 점선 버튼 + 팝오버 ────────────────────────────────────
// **프로젝트 헤더의 그 DOM 그대로다** — 그 줄은 폭·잘림·순서를 재는 검사가 여럿 붙어
// 있어서(§6-9 링크 줄) 옮기면서 마크업을 바꾸지 않았다. 열기 전에 위치를 먼저 잡는
// 이유도 그대로다: 안 그러면 첫 프레임이 {0,0}에 그려진다.
// 라벨은 '+ 참고 링크' 하나다 — 업무 창의 '+ 링크'는 2026-09-11에 되돌렸다(§6-35 · §8).
export function LinkAddPopover({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', url: '' });
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const bodyRef = useRef(null);
  const [pos, place] = useAnchoredPos(btnRef, open, 256, 140);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const inside = rootRef.current?.contains(e.target) || bodyRef.current?.contains(e.target);
      if (!inside) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const ready = !!draft.title.trim() && !!draft.url.trim();
  const save = () => {
    if (!ready) return;
    // 주소만 적어도 링크가 되게 한다 — `docs.google.com/…`을 그대로 붙이는 사람이 많다
    const url = /^https?:\/\//.test(draft.url) ? draft.url : `https://${draft.url}`;
    onAdd({ id: generateId(), title: draft.title.trim(), url });
    setDraft({ title: '', url: '' });
    setOpen(false);
  };

  const FIELD_CLS = 'w-full text-xs px-2 py-1.5 bg-surface border border-line rounded-xs outline-none focus:border-accent text-fg placeholder:text-fg-faint';
  return (
    <span className="inline-flex shrink-0" ref={rootRef}>
      <span ref={btnRef} className="inline-flex">
        <button type="button" onClick={() => { place(); setOpen(v => !v); }}
          className="text-[11px] text-fg-faint px-1.5 py-px rounded-[4px] transition-colors hover:text-fg-muted"
          style={{ border: '1px dashed var(--app-line)' }}>+ 참고 링크</button>
      </span>
      {open && createPortal(
        <div ref={bodyRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: 256 }}
          className="dc-pop bg-surface border border-line rounded-lg shadow-elevated p-3 z-[90]">
          <div className="space-y-2">
            <input autoFocus value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
              placeholder="이름" className={FIELD_CLS} />
            <input value={draft.url} onChange={e => setDraft(p => ({ ...p, url: e.target.value }))}
              placeholder="https://..." onKeyDown={e => { if (e.key === 'Enter') save(); }} className={FIELD_CLS} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)}
                className="text-xs px-2.5 py-1 text-fg-muted hover:bg-surface-hover rounded-md transition active:scale-95">취소</button>
              <button type="button" onClick={save} disabled={!ready}
                className="text-xs px-2.5 py-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white rounded-md transition active:scale-95">추가</button>
            </div>
          </div>
        </div>, document.body)}
    </span>
  );
}
