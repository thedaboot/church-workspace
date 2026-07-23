import React, { useMemo } from 'react';

// ============================================================================
// 9. RichText Parser & Renderer
// ============================================================================
const parseContentToTokens = (text) => {
  if (!text) return [];
  return text.split('\n').map((line, i) => {
    if (/(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(line)) return { type: 'image', value: line, key: i };
    const tokens = line.split(' ').map((word, j) => {
      if (word.startsWith('@')) return { type: 'mention', value: word, key: `${i}-${j}` };
      if (word.startsWith('http')) return { type: 'link', value: word, key: `${i}-${j}` };
      return { type: 'text', value: word + ' ', key: `${i}-${j}` };
    });
    return { type: 'line', tokens, key: i };
  });
};

export const RichText = React.memo(({ content }) => {
  const parsedBlocks = useMemo(() => parseContentToTokens(content), [content]);
  return (
    <>
      {parsedBlocks.map(block => {
        if (block.type === 'image') return <div key={block.key} className="my-2"><img src={block.value} alt="embedded" className="max-w-full rounded-lg border border-line max-h-64 object-contain" /></div>;
        if (block.type === 'line') return (
          <p key={block.key} className="mb-1 text-fg leading-relaxed text-sm">
            {block.tokens.map(t => {
              if (t.type === 'mention') return <span key={t.key} className="text-accent-text font-semibold bg-accent-weak px-1 rounded-xs mx-0.5">{t.value}</span>;
              if (t.type === 'link') return <a key={t.key} href={t.value} target="_blank" rel="noreferrer" className="text-accent-text underline mx-0.5 break-all hover:text-accent-strong">{t.value}</a>;
              return <span key={t.key}>{t.value}</span>;
            })}
          </p>
        );
        return null;
      })}
    </>
  );
});
