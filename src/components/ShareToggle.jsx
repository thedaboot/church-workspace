import React from 'react';
import { Lock, Users } from 'lucide-react';

// ============================================================================
// 나만 보기 / 공유하기 — **말씀(QT 묵상)과 예배 노트가 같이 쓰는 한 벌**
// ----------------------------------------------------------------------------
// 사용자 재강조 2026-09-03: "예배 노트와 말씀 묵상의 나만 보기/공유하기 로직은
// 동일해야 한다." 그래서 wordView에 있던 두 부품을 **코드 그대로** 여기로 옮겼다.
// 화면마다 다른 것은 라벨과 칩 문구뿐이라 그것만 props로 뺐다(shareLabel).
//
// 두 부품이 함께 지키는 규칙(옮겨 온 주석 그대로):
//   · **이미 그 상태인 쪽을 눌러도 아무 일도 일어나지 않는다**(사용자 지적 2026-09-01 —
//     예전에는 한 버튼이 상태를 표시하면서 누르면 뒤집혀서, 지금 상태를 확인하려고 누른
//     사람이 값을 바꿔 놓고 저장 버튼을 켰다). 두 쪽을 나란히 두고 값이 실제로 달라질
//     때만 부른다 — 부르는 쪽(setShared)이 같은 값이면 되돌아 나온다.
//   · 값은 **저장된 것**을 그대로 비춘다(고치던 상태가 아니다). 그래서 이 토글은 저장
//     버튼을 켜지 않고, 눌리면 그 자리에서 shared 칸만 저장된다.
//   · **라벨은 상태와 무관하게 고정이다**(사용자 정정 2026-09-03 — 확정형은 세그먼트가
//     아니라 뒤에 뜨는 칩이 말한다). 칸의 이름이 손 밑에서 바뀌면 지금 누른 것이
//     무엇인지 흔들린다.
//
// 부르는 쪽이 정하는 것: `shareLabel`(공유 쪽 이름)과 칩에 실을 문구.
//   말씀   — shareLabel 기본값('더다붓에 공유하기') · 칩 '더다붓에 공유할게요' / '나만 볼게요'
//   예배   — shareLabel='순에 공유하기'             · 칩 '우리 순에 공유할게요' / '나만 볼게요'
// 기본값이 말씀 것인 이유는 이 부품이 거기서 왔고, 그 화면의 부르는 자리를 한 글자도
// 바꾸지 않기로 했기 때문이다(옮기기는 이동이지 수정이 아니다).
// ============================================================================

export function ShareChip({ state, label }) {
  if (!state) return null;
  const done = state === 'saved';
  return (
    <span data-share-chip={state} className={`text-[10.5px] ${
      done ? 'px-2 py-0.5 rounded-full bg-tag-green text-tag-green-fg font-bold' : 'text-fg-faint'}`}>
      {done ? label : '저장하는 중'}
    </span>
  );
}

export function ShareToggle({ value, disabled, onChange, shareLabel = '더다붓에 공유하기' }) {
  const OPTIONS = [[false, '나만 보기', Lock], [true, shareLabel, Users]];
  return (
    <span className={`flex p-[3px] rounded-[8px] shrink-0 ${disabled ? 'opacity-40' : ''}`}
      style={{ background: 'var(--app-surface-hover)' }}>
      {OPTIONS.map(([v, label, Icon]) => (
        <button
          key={label} onClick={() => onChange(v)} disabled={disabled} aria-pressed={value === v}
          className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[5px] text-[11.5px] font-semibold transition-colors"
          style={{
            background: value === v ? 'var(--app-surface)' : 'transparent',
            color: value === v ? 'var(--app-ink)' : 'var(--app-ink-muted)',
          }}
        >
          <Icon size={12.5} className="shrink-0" />{label}
        </button>
      ))}
    </span>
  );
}
