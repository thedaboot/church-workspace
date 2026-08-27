import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ============================================================================
// 이미지 표시 조각들 (스켈레톤 · 라이트박스)
// ----------------------------------------------------------------------------
// FilePreviewModal은 마크다운 미리보기를 위해 RichText를 쓰고, RichText는 본문
// 이미지를 위해 이 조각들을 쓴다. 순환 import를 만들지 않으려고 여기에 따로 둔다.
// ============================================================================

// 훑고 지나가는 빛(index.css의 .dc-skeleton). animate-pulse는 흰 배경 위 옅은
// 회색을 투명도만 흔들어서 "로딩 중"으로 읽히지 않았다(사용자 지적).
export const Skeleton = ({ className = '' }) => (
  <div className={`dc-skeleton border border-line rounded-md ${className}`} />
);

// 이미지가 실제로 그려지기 전까지 같은 자리에 스켈레톤을 둔다.
// (src만 걸어두면 받는 동안 자리가 비었다가 툭 나타나서 화면이 끊겨 보인다)
export function SmartImage({ src, alt = '', className = '', wrapperClassName = '', skeletonClassName = '', onClick, title }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  useEffect(() => { setState('loading'); }, [src]);

  // display는 호출부가 정한다 — 여기서 inline-block을 고정하면 래퍼에 확정 높이를
  // 줄 수 없어서, 안쪽 이미지의 max-h-full이 기준을 못 잡고 가로 화면에서 넘쳤다.
  return (
    <span className={`relative ${wrapperClassName}`}>
      {/* 스켈레톤 크기는 **둘 중 하나만** 쓴다. 예전에는 `absolute inset-0 w-full h-full`과
          호출부의 `w-72 h-72`를 같이 붙였는데, Tailwind는 클래스를 적은 순서가 아니라
          스타일시트 순서로 이기므로 어느 쪽이 이길지 정해져 있지 않았고 inset-0이 네 변을
          다 잡아서 **미리보기 창 전체가 통째로 반짝이다가** 사진이 가운데에 툭 나타났다
          (사용자 지적). 크기를 받은 경우에는 그 크기로 가운데에 둔다 — 사진이 뜰 자리와
          같은 자리다. 안 받으면 예전처럼 꽉 채운다(썸네일 자리가 그렇다). */}
      {state !== 'ready' && (
        <Skeleton className={skeletonClassName
          ? `absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${skeletonClassName}`
          : 'absolute inset-0 w-full h-full'} />
      )}
      {src && (
        <img
          src={src} alt={alt} title={title} onClick={onClick}
          /* 사진이 여럿 붙은 업무에서 화면 밖 썸네일까지 한꺼번에 받지 않는다 */
          loading="lazy" decoding="async"
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
        wrapperClassName="w-full h-full flex items-center justify-center"
        className="max-w-full max-h-[88dvh] object-contain rounded-md"
        skeletonClassName="w-64 h-64"
      />
    </div>,
    document.body
  );
}
