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
        if (block.type === 'image') return <div key={block.key} className="my-2"><img src={block.value} alt="embedded" className="max-w-full rounded-lg border max-h-64 object-contain shadow-sm" /></div>;
        if (block.type === 'line') return (
          <p key={block.key} className="mb-1 text-gray-700 leading-relaxed text-sm">
            {block.tokens.map(t => {
              if (t.type === 'mention') return <span key={t.key} className="text-blue-600 font-semibold bg-blue-50 px-1 rounded mx-0.5">{t.value}</span>;
              if (t.type === 'link') return <a key={t.key} href={t.value} target="_blank" rel="noreferrer" className="text-blue-500 underline mx-0.5 break-all hover:text-blue-700">{t.value}</a>;
              return <span key={t.key}>{t.value}</span>;
            })}
          </p>
        );
        return null;
      })}
    </>
  );
});
