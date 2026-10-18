// ============================================================================
// 잠긴 업무를 생체 인증(Face ID · 지문)으로 열기 — 이 기기 등록과 확인 (v5 2묶음 시안 · mock/b3 · 서버 검증은 아직 없다)
// ----------------------------------------------------------------------------
// 흐름(시안): 잠금 판에서 비밀번호로 한 번 열면 → 그 업무 위에 '이 기기 등록' 한 줄(cardLock.BioOffer) →
// 등록하면 다음부터 잠금 판에 생체 인증 버튼(LockedPanel onBio)이 선다. 카카오톡 인앱은 비밀번호만(사용자 결정 · inApp.inKakao).
//
// 브라우저 쪽: navigator.credentials.create/get + 플랫폼 인증기(authenticatorAttachment 'platform' · userVerification 'required').
//   등록하면 자격 증명 id를 이 브라우저(localStorage `lock:bio:<이름>`)에 적는다 — 기기마다 따로다.
//   플랫폼 인증기가 없는 곳(헤드리스 · 지문 없는 PC)은 **게스트에서만** 흉내(sim — 잠깐 기다렸다 성공).
//
// **실제로 붙이려면(서버 · 지금은 없다)**
//   · 도전값(challenge)은 서버가 만들고 한 번만 쓴다 — 새 함수 파일을 늘리지 않고 기존 api 함수 하나에 op로(Hobby 함수 9/12 ·
//     예 `/api/ai`처럼 op로 가르는 자리) · 등록 op(옵션 → 증명 검증 → 공개 키 저장) · 확인 op(옵션 → 서명 검증 → unlock).
//   · 표: `card_lock_passkeys(profile_id, credential_id, public_key, sign_count, device_label, created_at)` · RLS 본인 행 · 쓰기는 함수만.
//   · 확인이 맞으면 서버가 `unlock_card`와 같은 자리(card_unlocks 행)를 쓴다 — 단 0099는 '한 번 맞히면 계속 열림'이라
//     생체 인증이 다시 쓰일 때가 없다(열린 계정은 다시 막히지 않는다). 그래서 이 기능에는 **여는 권한의 수명**(기기마다 ·
//     기간) 결정이 먼저 필요하다 — 시안의 게스트 시연 업무는 창을 닫으면 다시 잠긴다(그 모델을 흉내).
//   · 비밀번호가 바뀌면(lock_card 다시 설정 · reset_card_lock) 생체 인증으로 열던 기기도 다시 비밀번호부터.
// 순수 판정(bioMode · bioKey)은 노드 검사가 문다(tests/logcheck-phone).
// ============================================================================

// 어느 길로 할까 — 'real'(플랫폼 인증기) · 'sim'(게스트 흉내) · null(버튼도 등록 줄도 없음)
//   카카오 인앱이면 언제나 null(비밀번호만) · 클라우드는 서버 검증이 생기기 전까지 null
export function bioMode({ cloud = false, kakao = false, platform = false } = {}) {
  if (kakao || cloud) return null;
  return platform ? 'real' : 'sim';
}
export const bioKey = (who = '') => `lock:bio:${String(who || '')}`;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
export const SIM_MS = 650;   // 흉내가 '인증하는 동안' 기다리는 시간

export async function platformReady() {
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials?.create) return false;
    return !!(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch { return false; }
}

export function readBio(who) {
  try { const v = JSON.parse(localStorage.getItem(bioKey(who)) || 'null'); return v && v.id ? v : null; } catch { return null; }
}
const writeBio = (who, v) => { try { if (v) localStorage.setItem(bioKey(who), JSON.stringify(v)); else localStorage.removeItem(bioKey(who)); } catch { /* 막힌 저장소 */ } };

// 이 기기 등록 → true(등록함) · false(사용자가 취소 · 실패). 도전값은 시안이라 브라우저가 만든다(서버 검증 없음 — 위 머리말).
export async function registerBio(who, mode) {
  if (mode === 'sim') { await wait(SIM_MS); writeBio(who, { id: 'sim', sim: true, at: Date.now() }); return true; }
  if (mode !== 'real') return false;
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32),
      rp: { name: '더다붓 워크스페이스', id: window.location.hostname },
      user: { id: rand(16), name: String(who || 'guest'), displayName: String(who || 'guest') },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000, attestation: 'none',
    } });
    if (!cred) return false;
    writeBio(who, { id: b64u(cred.rawId), sim: false, at: Date.now() });
    return true;
  } catch (e) { console.warn('[bio] 등록 안 됨:', e?.name || e); return false; }
}

// 확인 → true(본인 확인됨) · false(취소 · 실패 · 등록 없음)
export async function verifyBio(who, mode) {
  const reg = readBio(who);
  if (!reg) return false;
  if (reg.sim || mode === 'sim') { await wait(SIM_MS); return true; }
  try {
    const got = await navigator.credentials.get({ publicKey: {
      challenge: rand(32), rpId: window.location.hostname, timeout: 60_000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64u(reg.id), transports: ['internal'] }],
    } });
    return !!got;
  } catch (e) { console.warn('[bio] 확인 안 됨:', e?.name || e); return false; }
}

export const forgetBio = (who) => writeBio(who, null);
