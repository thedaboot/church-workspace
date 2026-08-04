import React, { useState } from 'react';
import { avatarColor } from '../utils.js';
import { getAvatar } from '../services/cloudSync.js';

// ============================================================================
// 사람 동그라미 — 사진이 있으면 사진, 없으면 이름 첫 글자
// ============================================================================
// 카드·댓글·활동·알림·헤더·팀 화면이 저마다 같은 마크업을 들고 있었다. 사진을 붙이면서
// 한 군데로 모은다 — 크기·위치 클래스는 **부르는 쪽이 그대로 소유**한다.
//
// **display도 호출부가 준다**(§6-4). 여기에 inline-flex를 박아 두면 호출부의
// `hidden sm:flex`가 같은 레이어에서 지고, 모바일에서 아바타가 두 개 보인다.
// 그래서 className에 flex 계열을 반드시 하나 넣어야 한다(안 넣으면 가운데 정렬이 안 된다).
//
// 사진 주소는 부르는 쪽에서 넘기지 않아도 된다. 앱 안에서 사람은 표시명으로 다니므로
// (담당자·댓글 작성자·활동 기록 전부 이름) 이름으로 cloudSync에 물어본다. 게스트 모드에는
// 표가 비어 있어 언제나 글자 원이다.
//
// 사진이 깨지면(주소가 죽었거나 카카오 CDN이 막았거나) **글자 원으로 돌아간다.** 깨진 이미지
// 아이콘을 그대로 두면 그 사람만 화면이 고장 난 것처럼 보인다.
export function Avatar({ name = '', url, className = '', title, fallbackClass }) {
  const [broken, setBroken] = useState(false);
  const src = url !== undefined ? url : getAvatar(name);
  const letter = name[0] || '?';
  const showImg = !!src && !broken;
  return (
    <span
      title={title ?? name}
      className={`rounded-full items-center justify-center font-bold overflow-hidden shrink-0 ${showImg ? 'bg-surface-hover' : (fallbackClass || avatarColor(name))} ${className}`}
    >
      {showImg
        ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)}
            className="w-full h-full object-cover" />
        : letter}
    </span>
  );
}
