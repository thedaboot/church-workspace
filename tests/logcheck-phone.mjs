// logcheck-phone — v5 2묶음 시안(mock/b3) 폰·다붓이의 순수 규칙. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
//   당겨서 새로 고침 셈(services/pullMath.js) · 카카오 인앱 판정·외부 브라우저 주소(services/inApp.js) ·
//   생체 인증 길(services/bioUnlock.bioMode) · 다붓이 답 한 문장씩 펼치기·근거 먼저 줄(services/answerReveal.js)
// 되돌리기 검사(실제로 깨지는지 확인함):
//   · rubber의 `1 - 1/(…+1)`을 raw 그대로(손을 그대로 따라오게) 바꾸면 '고무줄은 max에 닿지 않는다'·'무거워진다'가,
//   · gestureVerdict에서 `ms > longPress`를 빼면 '길게 누른 뒤의 움직임은 끌기'가, `Math.abs(dx) >= Math.abs(dy)`를 빼면 '가로 손짓'이,
//   · externalHref의 encodeURIComponent를 빼면 '주소 안의 ?·& 그대로 넘어간다'가, kakaoDemoFrom의 cloud 갈래를 빼면 '클라우드는 표식을 안 읽는다'가,
//   · bioMode의 kakao 갈래를 빼면 '카카오 인앱은 비밀번호만'이, revealPlan의 비율 줄이기를 빼면 '전체는 maxTotal을 넘지 않는다'가,
//   · revealAt의 `t <= start` 갈래를 빼면 '다음 문장은 앞 문장이 끝난 뒤에'가 깨진다.
import assert from 'node:assert';
import { loadSource } from './_load.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`PASS ${name}`); };

// ── 당겨서 새로 고침 ──────────────────────────────────────────────────────
{
  const { PULL, rubber, pullPhase, gestureVerdict, peek } = await loadSource('src/services/pullMath.js');
  ok('고무줄 — 0이면 0 · 처음은 손을 꽤 따라오고 갈수록 무거워진다', () => {
    assert.strictEqual(rubber(0), 0);
    assert.strictEqual(rubber(-30), 0);
    const a = rubber(20) - rubber(0); const b = rubber(320) - rubber(300);
    assert.ok(a > 15 && a < 20, `처음 20px → ${a}`);
    assert.ok(b < a / 3, `뒤 20px(${b})는 처음(${a})보다 훨씬 무겁다`);
  });
  ok('고무줄은 max에 닿지 않는다', () => {
    assert.ok(rubber(5000) < PULL.max && rubber(5000) > PULL.max * 0.9);
  });
  ok('놓기 문턱 — arm 전은 pull · 그 뒤 armed · 0은 idle', () => {
    assert.strictEqual(pullPhase(0), 'idle');
    assert.strictEqual(pullPhase(PULL.arm - 1), 'pull');
    assert.strictEqual(pullPhase(PULL.arm), 'armed');
    // 문턱까지 손가락으로 얼마나 — 폰에서 너무 길지 않게(손가락 한 번 · 200px 안)
    let raw = 0; while (rubber(raw) < PULL.arm) raw += 1;
    assert.ok(raw > PULL.arm && raw < 200, `문턱까지 손가락 ${raw}px`);
    assert.ok(PULL.hold < PULL.arm && PULL.hold > 0);
  });
  ok('손짓 가르기 — 아래로 곧게 · 빨리면 당기기', () => {
    assert.strictEqual(gestureVerdict({ dx: 2, dy: 14, ms: 60 }), 'pull');
  });
  ok('손짓 가르기 — 아직 조금이면 더 본다', () => {
    assert.strictEqual(gestureVerdict({ dx: 1, dy: 4, ms: 30 }), 'wait');
  });
  ok('가로 손짓(보드 칸 넘기기)·위로 미는 손짓은 놓는다', () => {
    assert.strictEqual(gestureVerdict({ dx: 30, dy: 12, ms: 60 }), 'skip');
    assert.strictEqual(gestureVerdict({ dx: 0, dy: -20, ms: 60 }), 'skip');
  });
  ok('길게 누른 뒤의 움직임은 끌기(dnd-kit) — 놓는다', () => {
    assert.ok(PULL.longPress < 200, 'dnd-kit TouchSensor delay 200ms보다 앞');
    assert.strictEqual(gestureVerdict({ dx: 0, dy: 30, ms: 260 }), 'skip');
  });
  ok('맨 위가 아니거나 창이 열렸으면 놓는다', () => {
    assert.strictEqual(gestureVerdict({ dx: 0, dy: 30, ms: 40, atTop: false }), 'skip');
    assert.strictEqual(gestureVerdict({ dx: 0, dy: 30, ms: 40, blocked: true }), 'skip');
  });
  ok('다붓이 내려오기 — 0에서 갸웃 · 문턱에서 바로 선다', () => {
    assert.deepStrictEqual(peek(0), { p: 0, tilt: -16 });
    assert.strictEqual(peek(PULL.arm).tilt, 0);
    assert.strictEqual(peek(PULL.arm * 3).p, 1);
  });
}

// ── 카카오 인앱 · 외부 브라우저 ─────────────────────────────────────────────
{
  const { isKakaoUa, kakaoDemoFrom, externalHref } = await loadSource('src/services/inApp.js');
  const IOS_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5';
  const AND_KAKAO = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36;KAKAOTALK 2410850';
  const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  ok('카카오 인앱 UA — 아이폰·안드로이드 둘 다 · 사파리는 아니다', () => {
    assert.ok(isKakaoUa(IOS_KAKAO) && isKakaoUa(AND_KAKAO));
    assert.ok(!isKakaoUa(SAFARI) && !isKakaoUa(''));
  });
  ok('시연 표식 — 게스트에서 ?demo=kakao 또는 저장된 표식', () => {
    assert.strictEqual(kakaoDemoFrom('?demo=kakao'), true);
    assert.strictEqual(kakaoDemoFrom('?p=home&demo=kakao'), true);
    assert.strictEqual(kakaoDemoFrom('', { stored: true }), true);
    assert.strictEqual(kakaoDemoFrom('?demo=lock'), false);
    assert.strictEqual(kakaoDemoFrom(''), false);
  });
  ok('클라우드는 표식을 안 읽는다(실제 UA만)', () => {
    assert.strictEqual(kakaoDemoFrom('?demo=kakao', { cloud: true, stored: true }), false);
  });
  ok('외부 브라우저 주소 — kakaotalk://web/openExternal?url=<인코딩한 주소>', () => {
    const u = 'https://church-workspace.vercel.app/?p=worship&s=a b';
    const h = externalHref(u);
    assert.strictEqual(h, `kakaotalk://web/openExternal?url=${encodeURIComponent(u)}`);
    assert.ok(!h.slice(h.indexOf('url=') + 4).includes('&'), '주소 안의 & 그대로 넘어가면 카카오가 잘라 읽는다');
    assert.strictEqual(decodeURIComponent(h.split('url=')[1]), u);
  });
  ok('상대 주소·빈 값은 넘기지 않는다', () => {
    assert.strictEqual(externalHref('/?p=home'), null);
    assert.strictEqual(externalHref(''), null);
    assert.strictEqual(externalHref('javascript:alert(1)'), null);
  });
}

// ── 생체 인증 길 ─────────────────────────────────────────────────────────
{
  const { bioMode, bioKey } = await loadSource('src/services/bioUnlock.js');
  ok('카카오 인앱은 비밀번호만(사용자 결정)', () => {
    assert.strictEqual(bioMode({ kakao: true, platform: true }), null);
    assert.strictEqual(bioMode({ kakao: true }), null);
  });
  ok('클라우드는 서버 검증 전이라 없다 · 게스트는 플랫폼 인증기가 있으면 real · 없으면 sim', () => {
    assert.strictEqual(bioMode({ cloud: true, platform: true }), null);
    assert.strictEqual(bioMode({ platform: true }), 'real');
    assert.strictEqual(bioMode({}), 'sim');
  });
  ok('등록은 사람마다 따로', () => { assert.notStrictEqual(bioKey('김하나'), bioKey('이두리')); });
}

// ── 다붓이 답 한 문장씩 · 근거 먼저 ─────────────────────────────────────────
{
  const { REVEAL, revealPlan, revealAt, revealTotal, sliceGlyphs, isEvidenceLine } = await loadSource('src/services/answerReveal.js');
  const S = ['수련회 준비는 프로젝트에서 하고 있어요.', '마감은 7월 25일이에요.', '담당 팀이 일정을 정해요.'];
  const plan = revealPlan(S);
  ok('문장마다 차례로 — 다음 문장은 앞 문장이 끝나고 숨 쉰 뒤', () => {
    assert.strictEqual(plan.length, 3);
    assert.strictEqual(plan[0].start, 0);
    for (let i = 1; i < plan.length; i++) assert.strictEqual(plan[i].start, plan[i - 1].start + plan[i - 1].dur + REVEAL.gapMs);
    const mid = revealAt(plan, plan[0].dur / 2);
    assert.ok(mid.shown[0] > 0 && mid.shown[0] < plan[0].len);
    assert.deepStrictEqual(mid.shown.slice(1), [0, 0]);
    const gap = revealAt(plan, plan[0].dur + REVEAL.gapMs / 2);
    assert.deepStrictEqual(gap.shown, [plan[0].len, 0, 0]);
    assert.strictEqual(gap.done, false);
  });
  ok('끝나면 전부 · done', () => {
    const end = revealAt(plan, revealTotal(plan) + 1);
    assert.deepStrictEqual(end.shown, plan.map(p => p.len));
    assert.strictEqual(end.done, true);
  });
  ok('글자 수는 한글 글자 하나가 하나(이모지도 하나)', () => {
    assert.strictEqual(revealPlan(['가나다'])[0].len, 3);
    assert.strictEqual(sliceGlyphs('👍좋아요', 2), '👍좋');
  });
  ok('긴 답도 전체는 maxTotal을 넘지 않는다', () => {
    const long = Array.from({ length: 6 }, () => '가'.repeat(120));
    const p = revealPlan(long);
    assert.ok(revealTotal(p) <= REVEAL.maxTotal + 1, `${revealTotal(p)}`);
    assert.ok(p.every(x => x.dur > 0));
  });
  ok('빈 답은 바로 done', () => { assert.strictEqual(revealAt(revealPlan([]), 0).done, true); });
  ok('근거 먼저 줄은 { evidence } 하나뿐 — 단계 줄·답과 섞이지 않는다', () => {
    assert.ok(isEvidenceLine({ evidence: [{ t: 'card', id: 'c1', label: '수련회 포스터' }] }));
    assert.ok(!isEvidenceLine({ stage: 'gather' }));
    assert.ok(!isEvidenceLine({ id: 'q', status: 'answered', sentences: [], evidence: [] }));
  });
}

console.log(`\n${n}개 통과`);
