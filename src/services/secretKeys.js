// ============================================================================
// 비밀번호 칸의 글자 → 두벌식 자판 글쇠 (import 0 · 노드 검사가 그대로 들인다)
// ----------------------------------------------------------------------------
// 비밀번호 칸은 type="password"가 아니다(components/SecretInput.jsx · PITFALLS 64). type="password"일 때는
// 윈도 크롬이 그 칸의 한글 입력기를 끄고 맥은 영문으로 돌려서, 한/영이 '한'이어도 칸에는 **누른 글쇠**가
// 들어갔다. 일반 칸에서는 '한' 상태로 치면 한글이 조합되고 점으로 가려져 본인도 모른다 —
// 그래서 칸이 넘기는 값을 **누른 글쇠**로 되돌린다('ㅂㅈㄷㄱ' · '벚' → 'qwer' · 'qjw').
// 걸 때와 열 때 같은 규칙이라 어느 기기·어느 입력 상태로 쳐도 같은 값이 된다.
// 예전에 한글 그대로 걸어 둔 비밀번호는 여는 칸이 원래 글자로 한 번 더 맞춰 본다(matchSecret).
// ============================================================================

const CHO = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
const JUNG = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
const JONG = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
// 호환 자모 ㄱ(U+3131)~ㅎ(U+314E) — 조합 중이거나 홀로 남은 자음
const JA = ['r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];

export function secretKeys(text) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) {
      const i = c - 0xAC00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else if (c >= 0x3131 && c <= 0x314E) out += JA[c - 0x3131];
    else if (c >= 0x314F && c <= 0x3163) out += JUNG[c - 0x314F];
    else out += ch;
  }
  return out;
}

// 여는 칸: 글쇠 값으로 먼저, **틀렸다(false)**고 했고 친 글자가 그와 다를 때만(한글이 섞였을 때) 원래 글자로 한 번 더.
// check의 답을 그대로 돌려준다(부르는 쪽마다 false=틀림 · 그 밖=맞음/오류의 뜻이 있다).
export async function matchSecret(check, keys, raw) {
  const first = await check(keys);
  if (first !== false || raw == null || raw === keys) return first;
  return check(raw);
}
