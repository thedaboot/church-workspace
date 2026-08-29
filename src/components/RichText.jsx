import React, { useMemo, useState } from 'react';
import { tokenizeInline, MD_LINK_RE, IMAGE_LINE_RE } from '../services/markdown.js';
import { SmartImage, ImageLightbox } from './media.jsx';

// ============================================================================
// 9. RichText Parser & Renderer
//    마크다운 서브셋: **굵게** *기울임* __밑줄__ ~~취소선~~ ==형광펜==
//    # ~ #### 제목, -/* 불릿, 1. 번호 목록 + 기존 @멘션·링크·이미지 URL 유지
//    인라인 토큰화는 에디터와 같은 것(services/markdown.js)을 쓴다 — 한쪽만
//    중첩을 지원하면 "쓴 그대로 보인다"가 깨지므로 파서를 하나로 유지한다.
// ============================================================================

const LINK_CLS = 'text-accent-text underline mx-0.5 break-all hover:text-accent-strong';
// 마크 → 태그·클래스 (에디터 .tiptap 스타일과 같은 톤)
const MARK_TAG = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', highlight: 'mark' };
const MARK_CLS = {
  bold: 'font-bold',
  strike: 'opacity-80',
  highlight: 'bg-tag-yellow text-tag-yellow-fg rounded-[3px] px-0.5',
};

// 서식이 없는 구간에서만 @멘션·생 URL을 살린다(마크 안의 URL은 그대로 글자로)
const PLAIN_RE = /(@\S+|https?:\/\/\S+)/g;
const renderPlain = (text, key) => text.split(PLAIN_RE).filter(Boolean).map((p, i) => {
  const k = `${key}-p${i}`;
  if (/^@\S+$/.test(p)) return <span key={k} className="text-accent-text font-semibold bg-accent-weak px-1 rounded-xs mx-0.5">{p}</span>;
  if (/^https?:\/\/\S+$/.test(p)) return <a key={k} href={p} target="_blank" rel="noreferrer" className={LINK_CLS}>{p}</a>;
  return <React.Fragment key={k}>{p}</React.Fragment>;
});

const renderInline = (text, keyBase) => {
  if (!text) return null;
  return tokenizeInline(text).map((seg, i) => {
    const key = `${keyBase}-${i}`;
    // 안쪽부터: 링크 or 평문 → 마크로 감싸 올라간다
    let node = seg.href
      ? <a href={seg.href} target="_blank" rel="noreferrer" className={LINK_CLS}>{seg.text}</a>
      : renderPlain(seg.text, key);
    for (const m of [...seg.marks].reverse()) {
      const Tag = MARK_TAG[m];
      if (Tag) node = <Tag className={MARK_CLS[m]}>{node}</Tag>;
    }
    return <React.Fragment key={key}>{node}</React.Fragment>;
  });
};

const HEADING_CLS = {
  1: 'text-xl font-bold tracking-[-0.25px] text-fg mt-3 mb-1.5',
  2: 'text-lg font-bold tracking-[-0.25px] text-fg mt-3 mb-1',
  3: 'text-base font-semibold text-fg mt-2 mb-1',
  4: 'text-sm font-semibold text-fg mt-2 mb-0.5',
};

// 줄 배열 → 블록 배열 (연속된 목록 항목은 하나의 목록으로 묶음)
const parseBlocks = (text) => {
  if (!text) return [];
  const blocks = [];
  let todoIdx = -1;   // 본문 전체에서 몇 번째 체크 항목인지 — 토글(utils.toggleTodoLine)의 좌표
  for (const [i, line] of text.split('\n').entries()) {
    // [텍스트](URL) 형태의 링크 줄은 이미지로 오인하지 않고 단락으로(인라인에서 링크 렌더)
    const isMdLinkLine = MD_LINK_RE.test(line.trim());
    // 줄 **전체**가 이미지 URL일 때만 이미지 블록으로 본다(에디터의 IMAGE_LINE_RE와 같은 판정).
    // 예전에는 줄 안에 URL이 있으면 되던 탓에 "사진: https://….png"가 줄 전체를 src로
    // 넘겨 깨진 이미지가 되고 앞의 문장이 사라졌다.
    if (!isMdLinkLine && IMAGE_LINE_RE.test(line.trim())) { blocks.push({ type: 'image', value: line.trim(), key: i }); continue; }
    // 구분선 — 판정 모양은 markdown.js와 한 쌍이다(읽기는 ---·***·___ 셋 다)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { blocks.push({ type: 'rule', key: i }); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, value: h[2], key: i }); continue; }
    // 체크리스트 — 불릿보다 먼저(불릿 패턴에도 걸린다). 판정 모양은 markdown.js와 한 쌍.
    const todo = line.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/);
    if (todo) {
      todoIdx++;
      const item = { checked: todo[1].toLowerCase() === 'x', value: todo[2], key: i, idx: todoIdx };
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'todo') prev.items.push(item);
      else blocks.push({ type: 'todo', items: [item], key: i });
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'ul') prev.items.push({ value: ul[1], key: i });
      else blocks.push({ type: 'ul', items: [{ value: ul[1], key: i }], key: i });
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'ol') prev.items.push({ value: ol[1], key: i });
      else blocks.push({ type: 'ol', items: [{ value: ol[1], key: i }], key: i });
      continue;
    }
    if (line.trim() === '') { blocks.push({ type: 'gap', key: i }); continue; }
    blocks.push({ type: 'p', value: line, key: i });
  }
  return blocks;
};

// 본문 이미지 — 받는 동안 같은 자리에 스켈레톤, 누르면 크게 본다
function ContentImage({ src }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SmartImage
        src={src} alt="첨부 이미지" title="크게 보기" onClick={() => setOpen(true)}
        wrapperClassName="max-w-full inline-block"
        className="max-w-full rounded-lg border border-line max-h-64 object-contain"
        skeletonClassName="w-full h-40 rounded-lg"
      />
      {open && <ImageLightbox src={src} alt="첨부 이미지" onClose={() => setOpen(false)} />}
    </>
  );
}

// onToggleTodo(idx): 본문 체크리스트의 idx번째 항목을 뒤집는다 — 업무 창 보기 모드만
// 넘긴다(하위 업무처럼 보기에서 바로 눌린다). 안 넘기면(댓글·요약 등) 읽기 전용이다.
export const RichText = React.memo(({ content, onToggleTodo }) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <>
      {blocks.map(block => {
        switch (block.type) {
          case 'rule':
            // 본문 안의 선은 카드 테두리보다 옅다 — 글을 가르는 표시이지 상자가 아니다
            return <hr key={block.key} className="my-3 border-0 h-px" style={{ background: 'var(--app-line)' }} />;
          case 'image':
            return <div key={block.key} className="my-2"><ContentImage src={block.value} /></div>;
          case 'todo':
            return (
              <div key={block.key} className="mb-1 space-y-1">
                {block.items.map(it => (
                  <div key={it.key} className="flex items-start gap-2 leading-relaxed">
                    {/* 하위 업무 체크박스와 같은 표기(초록 채움 + 흰 체크) — 같은 뜻은 같은 모양 */}
                    <button
                      type="button" disabled={!onToggleTodo}
                      onClick={() => onToggleTodo?.(it.idx)}
                      className={`w-[16px] h-[16px] mt-[3px] rounded-[4px] shrink-0 flex items-center justify-center transition-colors ${onToggleTodo ? '' : 'cursor-default'}`}
                      style={it.checked
                        ? { background: 'var(--app-tag-green-fg)' }
                        : { border: '1.5px solid var(--app-line)' }}
                      aria-pressed={it.checked} aria-label={`${it.value || '체크 항목'} ${it.checked ? '완료 취소' : '완료'}`}
                    >
                      {it.checked && (
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </button>
                    <span className={`min-w-0 ${it.checked ? 'text-fg-faint line-through' : 'text-fg'}`}>{renderInline(it.value, it.key)}</span>
                  </div>
                ))}
              </div>
            );
          case 'heading': {
            const Tag = `h${block.level}`;
            return <Tag key={block.key} className={HEADING_CLS[block.level]}>{renderInline(block.value, block.key)}</Tag>;
          }
          // 글자 크기는 호출부가 정한다 — 여기서 text-sm을 박아 두면 댓글(11px 이름 옆),
          // 요약(text-xs 래퍼) 안에서도 14px로 커져서 주변과 어긋났다(실제 지적).
          // 본문은 TaskViewer 래퍼가 text-sm을 준다.
          case 'ul':
            return <ul key={block.key} className="list-disc pl-5 mb-1 space-y-0.5 text-fg leading-relaxed">{block.items.map(it => <li key={it.key}>{renderInline(it.value, it.key)}</li>)}</ul>;
          case 'ol':
            return <ol key={block.key} className="list-decimal pl-5 mb-1 space-y-0.5 text-fg leading-relaxed">{block.items.map(it => <li key={it.key}>{renderInline(it.value, it.key)}</li>)}</ol>;
          case 'gap':
            return <div key={block.key} className="h-2" />;
          default:
            return <p key={block.key} className="mb-1 text-fg leading-relaxed">{renderInline(block.value, block.key)}</p>;
        }
      })}
    </>
  );
});
