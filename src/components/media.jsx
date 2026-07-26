import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ============================================================================
// 이미지 표시 조각들 (스켈레톤 · 라이트박스)
// ----------------------------------------------------------------------------
// FilePreviewModal은 마크다운 미리보기를 위해 RichText를 쓰고, RichText는 본문
// 이미지를 위해 이 조각들을 쓴다. 순환 import를 만들지 않으려고 여기에 따로 둔다.
// ============================================================================

export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse bg-surface-2 border border-line rounded-md ${className}`} />
);

// 이미지가 실제로 그려지기 전까지 같은 자리에 스켈레톤을 둔다.
// (src만 걸어두면 받는 동안 자리가 비었다가 툭 나타나서 화면이 끊겨 보인다)
export function SmartImage({ src, alt = '', className = '', wrapperClassName = '', skeletonClassName = '', onClick, title }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  useEffect(() => { setState('loading'); }, [src]);

  return (
    <span className={`relative inline-block ${wrapperClassName}`}>
      {state !== 'ready' && <Skeleton className={`absolute inset-0 w-full h-full ${skeletonClassName}`} />}
      {src && (
        <img
          src={src} alt={alt} title={title} onClick={onClick}
          onLoad={() => setState('ready')} onError={() => setState('error')}
          className={`${className} ${state === 'ready' ? '' : 'opacity-0'} ${onClick ? 'cursor-zoom-in' : ''} transition-opacity duration-200`}
        />
      )}
      {state === 'error' && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-fg-faint">불러올 수 없어요</span>
      )}
    </span>
  );
}

// 본문 이미지처럼 URL만 있는 경우의 확대 보기
export function ImageLightbox({ src, alt = '', onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute top-3 right-3 p-2 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition" title="닫기"><X size={20} /></button>
      <SmartImage
        src={src} alt={alt}
        wrapperClassName="max-w-full max-h-full flex items-center justify-center"
        className="max-w-full max-h-[88dvh] object-contain rounded-md"
        skeletonClassName="w-64 h-64"
      />
    </div>,
    document.body
  );
}
