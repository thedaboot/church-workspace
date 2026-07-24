import React, { useMemo } from 'react';

// ============================================================================
// 9. RichText Parser & Renderer
//    마크다운 서브셋: **굵게** *기울임* __밑줄__ ~~취소선~~ ==형광펜==
//    # ~ #### 제목, -/* 불릿, 1. 번호 목록 + 기존 @멘션·링크·이미지 URL 유지
//    (풀 마크다운 파서가 아닌 정규식 경량 구현 — 중첩은 1단계까지만)
// ============================================================================

// 인라인 토큰: 순서 중요 — ** 가 * 보다, __ 가 먼저 매칭되어야 함
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|\*[^*\n]+\*|@\S+|https?:\/\/\S+)/g;

const renderInline = (text, keyBase) => {
  if (!text) return null;
  return text.split(INLINE_RE).filter(Boolean).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={key} className="font-bold">{part.slice(2, -2)}</strong>;
    if (/^__[^_\n]+__$/.test(part)) return <u key={key}>{part.slice(2, -2)}</u>;
    if (/^~~[^~\n]+~~$/.test(part)) return <s key={key} className="opacity-80">{part.slice(2, -2)}</s>;
    if (/^==[^=\n]+==$/.test(part)) return <mark key={key} className="bg-tag-yellow text-tag-yellow-fg rounded-[3px] px-0.5">{part.slice(2, -2)}</mark>;
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^@\S+$/.test(part)) return <span key={key} className="text-accent-text font-semibold bg-accent-weak px-1 rounded-xs mx-0.5">{part}</span>;
    if (/^https?:\/\/\S+$/.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer" className="text-accent-text underline mx-0.5 break-all hover:text-accent-strong">{part}</a>;
    return <span key={key}>{part}</span>;
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
  for (const [i, line] of text.split('\n').entries()) {
    if (/(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp))/i.test(line)) { blocks.push({ type: 'image', value: line.trim(), key: i }); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, value: h[2], key: i }); continue; }
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

export const RichText = React.memo(({ content }) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <>
      {blocks.map(block => {
        switch (block.type) {
          case 'image':
            return <div key={block.key} className="my-2"><img src={block.value} alt="embedded" className="max-w-full rounded-lg border border-line max-h-64 object-contain" /></div>;
          case 'heading': {
            const Tag = `h${block.level}`;
            return <Tag key={block.key} className={HEADING_CLS[block.level]}>{renderInline(block.value, block.key)}</Tag>;
          }
          case 'ul':
            return <ul key={block.key} className="list-disc pl-5 mb-1 space-y-0.5 text-fg text-sm leading-relaxed">{block.items.map(it => <li key={it.key}>{renderInline(it.value, it.key)}</li>)}</ul>;
          case 'ol':
            return <ol key={block.key} className="list-decimal pl-5 mb-1 space-y-0.5 text-fg text-sm leading-relaxed">{block.items.map(it => <li key={it.key}>{renderInline(it.value, it.key)}</li>)}</ol>;
          case 'gap':
            return <div key={block.key} className="h-2" />;
          default:
            return <p key={block.key} className="mb-1 text-fg leading-relaxed text-sm">{renderInline(block.value, block.key)}</p>;
        }
      })}
    </>
  );
});
