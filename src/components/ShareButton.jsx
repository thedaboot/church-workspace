import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';

// 공유 링크 복사 버튼 — 클릭 시 클립보드 복사 후 2초간 Check+"복사됨"
export function ShareButton({ url, title = '공유 링크 복사', className = '' }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('복사에 실패했어요. 링크: ' + url);
    }
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 shrink-0 ${className}`}
    >
      {copied ? <Check size={16} strokeWidth={1.75} /> : <Share2 size={16} strokeWidth={1.75} />}
      {copied && <span className="text-[10px] font-medium text-accent-text">복사됨</span>}
    </button>
  );
}
