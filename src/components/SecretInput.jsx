import { useState, useEffect } from 'react';
import { secretKeys } from '../services/secretKeys.js';

// ============================================================================
// 비밀번호 칸 한 벌 — 업무 잠금 · 첨부 · 참고 링크 · 문서 창의 가림 비밀번호가 전부 이것을 쓴다 (PITFALLS 64)
// ----------------------------------------------------------------------------
// 이 앱의 비밀번호는 계정 비밀번호가 아니라 **같이 아는 문 비밀번호**다. type="password"면 브라우저·비밀번호
// 관리자(크롬·사파리 키체인·삼성 패스·구글 자동완성·1Password 등)가 '강력한 비밀번호 제안'·'저장할까요?'·
// 자동 채우기를 계속 띄운다 — 사용자가 몹시 귀찮아했다(2026-10-18). 그래서:
//   · type="text" + `-webkit-text-security: disc`로 점만 그린다(크롬·엣지·사파리·iOS·안드로이드 · 파이어폭스 신판).
//     그 CSS를 모르는 브라우저만 예전처럼 type="password"(가리는 것이 먼저다).
//   · 값이 있을 때만 가린다 — 빈 칸에 걸면 placeholder('비밀번호')까지 점이 되는 브라우저가 있다.
//   · autocomplete=off · 맞춤법·자동 고침·대문자 끔 · name/id 없음 · 관리자 무시 표시(1Password·LastPass·Bitwarden·Dashlane).
//   · 넘기는 값은 **누른 글쇠**다(services/secretKeys.js) — type="password"가 하던 '한글 입력기 끄기'를 대신한다.
// 쓰는 법: <SecretInput ref value onValue={(keys, raw) => …} className … />  · masked={false}는 거는 칸(보이게 · 예전 그대로).
// 이 밖의 자리에 type="password"를 새로 쓰지 않는다 — tests/logcheck-sec.mjs가 src 전체를 훑는다.
// ============================================================================

export const MASK_OK = typeof CSS !== 'undefined' && !!CSS.supports?.('-webkit-text-security', 'disc');

export function SecretInput({ value, onValue, masked = true, style, ref, ...rest }) {
  const [raw, setRaw] = useState(value ?? '');
  // 부르는 쪽이 칸을 비우면(팝오버 닫힘 등) 따라 비운다 — 조합 중에는 secretKeys(raw)가 value와 같아 건드리지 않는다
  useEffect(() => { if (secretKeys(raw) !== (value ?? '')) setRaw(value ?? ''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const css = masked && MASK_OK;
  return (
    <input
      {...rest}
      ref={ref}
      type={masked && !MASK_OK ? 'password' : 'text'}
      value={raw}
      onChange={(e) => { setRaw(e.target.value); onValue?.(secretKeys(e.target.value), e.target.value); }}
      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      data-secret="" data-1p-ignore="" data-lpignore="true" data-bwignore="" data-form-type="other"
      style={css && raw ? { ...style, WebkitTextSecurity: 'disc' } : style}
    />
  );
}
