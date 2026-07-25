import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { showToast } from './Toast.jsx';

// 공유 버튼
// - 공유 시트를 지원하는 환경(모바일 사파리·크롬, 윈도우 크롬 등)에서는 OS 공유 시트를
//   띄운다 → 카카오톡·메시지·메일로 바로 보낼 수 있다.
// - 지원하지 않으면(데스크톱 사파리·파이어폭스 등) 기존처럼 링크를 복사한다.
// 카카오톡으로 "한 번에" 보내기(카카오 JS SDK)는 자바스크립트 키 발급 + 카카오 콘솔에
// 도메인 등록이 필요해서, 설정 없이 바로 되는 공유 시트를 기본으로 둔다.
export function ShareButton({ url, what = '', shareTitle = '더다붓 워크스페이스', className = '' }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('복사에 실패했어요 · ' + url);
    }
  };

  const onClick = async (e) => {
    e.stopPropagation();
    if (canShare) {
      try {
        await navigator.share({ title: shareTitle, text: shareTitle, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // 사용자가 시트를 닫음 — 조용히 종료
        // 그 외 실패는 복사로 폴백
      }
    }
    copy();
  };

  const label = (canShare ? `${what} 공유하기` : `${what} 공유 링크 복사`).trim();

  return (
    <button
      onClick={onClick}
      title={label} aria-label={label}
      className={`inline-flex items-center gap-1 p-1.5 rounded-md text-fg-faint hover:text-accent-text hover:bg-surface-hover transition active:scale-95 shrink-0 ${className}`}
    >
      {copied ? <Check size={16} strokeWidth={1.75} /> : <Share2 size={16} strokeWidth={1.75} />}
      {copied && <span className="text-[10px] font-medium text-accent-text">복사됨</span>}
    </button>
  );
}
