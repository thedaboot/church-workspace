// logcheck-phone — v5 2묶음 시안(mock/b3) 폰·다붓이의 순수 규칙. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
//   카카오 인앱 판정·외부 브라우저 주소(services/inApp.js) · 다붓이 답 한 문장씩 펼치기·근거 먼저 줄(services/answerReveal.js)
// 되돌리기 검사(실제로 깨지는지 확인함):
//   · externalHref의 encodeURIComponent를 빼면 '주소 안의 ?·& 그대로 넘어간다'가, kakaoDemoFrom의 cloud 갈래를 빼면 '클라우드는 표식을 안 읽는다'가,
//   · isKakaoUa가 'KAKAOTALK' 표식을 못 알아보면 'UA — 아이폰·안드로이드'가,
//   · revealPlan의 비율 줄이기를 빼면 '전체는 maxTotal을 넘지 않는다'가, revealAt의 `t <= start` 갈래를 빼면 '다음 문장은 앞 문장이 끝난 뒤에'가,
//   · isEvidenceLine의 키 하나 조건을 빼면 '근거 먼저 줄은 { evidence } 하나뿐'이 깨진다.
import assert from 'node:assert';
import { loadSource } from './_load.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`PASS ${name}`); };

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
    assert.strictEqual(kakaoDemoFrom('?demo=other'), false);
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
