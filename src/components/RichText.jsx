import React, { useMemo, useState } from 'react';
import { tokenizeInline, MD_LINK_RE } from '../services/markdown.js';
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
  for (const [i, line] of text.split('\n').entries()) {
    // [텍스트](URL) 형태의 링크 줄은 이미지로 오인하지 않고 단락으로(인라인에서 링크 렌더)
    const isMdLinkLine = MD_LINK_RE.test(line.trim());
    if (!isMdLinkLine && /(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp))/i.test(line)) { blocks.push({ type: 'image', value: line.trim(), key: i }); continue; }
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

// 본문 이미지 — 받는 동안 같은 자리에 스켈레톤, 누르면 크게 본다
function ContentImage({ src }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SmartImage
        src={src} alt="첨부 이미지" title="크게 보기" onClick={() => setOpen(true)}
        wrapperClassName="max-w-full"
        className="max-w-full rounded-lg border border-line max-h-64 object-contain"
        skeletonClassName="w-full h-40 rounded-lg"
      />
      {open && <ImageLightbox src={src} alt="첨부 이미지" onClose={() => setOpen(false)} />}
    </>
  );
}

export const RichText = React.memo(({ content }) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  return (
    <>
      {blocks.map(block => {
        switch (block.type) {
          case 'image':
            return <div key={block.key} className="my-2"><ContentImage src={block.value} /></div>;
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
