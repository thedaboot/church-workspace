import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const M = await import(new URL('../src/services/markdown.js', import.meta.url).href);
const { mdToDoc, docToMd, tokenizeInline } = M;

const marksOf = (md) => mdToDoc(md).content[0].content.map(n => ({
  t: n.text, m: (n.marks || []).map(x => x.type).sort().join('+'),
}));
const round = (md) => docToMd(mdToDoc(md));

// 중첩 마크가 살아난다 (전에는 '**'가 글자로 남았다)
assert.deepStrictEqual(marksOf('==**형광굵게**=='), [{ t: '형광굵게', m: 'bold+highlight' }]);
assert.deepStrictEqual(marksOf('**==굵게형광==**'), [{ t: '굵게형광', m: 'bold+highlight' }]);
assert.deepStrictEqual(marksOf('==__밑줄형광__=='), [{ t: '밑줄형광', m: 'highlight+underline' }]);
assert.deepStrictEqual(marksOf('==~~취소형광~~=='), [{ t: '취소형광', m: 'highlight+strike' }]);
assert.deepStrictEqual(marksOf('***굵고기울임***'), [{ t: '굵고기울임', m: 'bold+italic' }]);
assert.deepStrictEqual(marksOf('==__**셋다**__=='), [{ t: '셋다', m: 'bold+highlight+underline' }]);
// 링크 안의 굵게
assert.deepStrictEqual(marksOf('[**링크굵게**](https://a.io)'), [{ t: '링크굵게', m: 'bold+link' }]);

// 단일 마크는 그대로
assert.deepStrictEqual(marksOf('**굵게**'), [{ t: '굵게', m: 'bold' }]);
assert.deepStrictEqual(marksOf('*기울임*'), [{ t: '기울임', m: 'italic' }]);
assert.deepStrictEqual(marksOf('==형광=='), [{ t: '형광', m: 'highlight' }]);
// 섞인 문장
assert.deepStrictEqual(marksOf('앞 ==**강조**== 뒤'), [
  { t: '앞 ', m: '' }, { t: '강조', m: 'bold+highlight' }, { t: ' 뒤', m: '' },
]);
// 멘션·생 URL은 평문 유지
assert.deepStrictEqual(marksOf('@노준석 확인 https://a.io'), [{ t: '@노준석 확인 https://a.io', m: '' }]);

// 라운드트립: 한 번 정규화된 뒤에는 값이 고정된다(마크는 절대 유실 없음)
for (const src of ['==**x**==', '**==x==**', '***x***', '==__**x**__==', '[**x**](https://a.io)',
                   '# 제목 ==**강조**==', '- 항목 ==**강조**==', '**굵게** 일반 *기울임*']) {
  const once = round(src);
  assert.strictEqual(round(once), once, `불안정: ${src} → ${once} → ${round(once)}`);
  // 마크가 유실되지 않았는지 — 마커 문자가 남아 있어야 한다
  for (const tok of ['**', '==', '__', '~~']) {
    if (src.includes(tok)) assert.ok(once.includes(tok), `${tok} 유실: ${src} → ${once}`);
  }
}
// 서식 있는 그대로 복원되는 케이스
assert.strictEqual(round('==**x**=='), '==**x**==');
assert.strictEqual(round('***x***'), '***x***');
assert.strictEqual(round('# 제목 ==**강조**=='), '# 제목 ==**강조**==');
assert.strictEqual(round('- 항목 **굵게**'), '- 항목 **굵게**');
// 서식 문자가 아닌 별표는 건드리지 않음
assert.strictEqual(round('2 * 3 = 6'), '2 * 3 = 6');

// tokenizeInline 직접
assert.deepStrictEqual(tokenizeInline('==**a**=='), [{ text: 'a', marks: ['highlight', 'bold'], href: null }]);

console.log('마크다운 중첩 라운드트립 자체검증 통과 (30 asserts)');

// ── 본문 체크리스트 (- [ ] / - [x]) ──
// 에디터(taskList) ↔ 서브셋 문자열 라운드트립. 불릿보다 먼저 판정돼야 한다 —
// 순서가 바뀌면 '- [ ] 일'이 불릿 "[ ] 일"로 저장돼 체크박스가 사라진다.
{
  const doc = mdToDoc('- [ ] 하나\n- [x] 둘\n- 그냥 불릿');
  assert.strictEqual(doc.content[0].type, 'taskList', '체크리스트가 불릿으로 새지 않는다');
  assert.strictEqual(doc.content[0].content.length, 2, '연속 항목은 한 목록');
  assert.deepStrictEqual(doc.content[0].content.map(i => i.attrs.checked), [false, true]);
  assert.strictEqual(doc.content[1].type, 'bulletList', '뒤의 불릿은 불릿 그대로');
  assert.strictEqual(round('- [ ] 하나\n- [x] 둘'), '- [ ] 하나\n- [x] 둘');
  assert.strictEqual(round('- [x] **굵은 할 일**'), '- [x] **굵은 할 일**', '항목 안 마크 유지');
  console.log('본문 체크리스트 라운드트립 통과 (6 asserts)');
}

// ── 구분선 (2026-08-30) ─────────────────────────────────────────────────────
// `---`를 치면 선이 된다(에디터의 입력 규칙 + 저장 형식). 읽을 때는 ***·___도 받고
// 쓸 때는 언제나 `---` 한 벌이다 — 판정 모양이 RichText와 한 쌍이어야 한다.
{
  for (const mark of ['---', '----', '***', '___']) {
    const d = mdToDoc(`위\n${mark}\n아래`);
    assert.strictEqual(d.content[1].type, 'horizontalRule', `${mark}가 선이 안 된다`);
  }
  assert.strictEqual(round('위\n---\n아래'), '위\n---\n아래');
  assert.strictEqual(round('위\n***\n아래'), '위\n---\n아래', '쓸 때는 --- 한 벌이다');
  // 글 안의 --- 는 선이 아니다 — 줄 전체일 때만
  assert.strictEqual(mdToDoc('가--나').content[0].type, 'paragraph');
  assert.strictEqual(mdToDoc('-- 둘').content[0].type, 'paragraph', '두 개는 선이 아니다');
  // 불릿(`- 글`)을 선으로 잘못 보면 목록이 통째로 사라진다
  assert.strictEqual(mdToDoc('- 하나').content[0].type, 'bulletList');
  console.log('구분선 라운드트립 통과 (9 asserts)');
}

// ── 번호 목록이 이어지는 숫자를 지킨다 (2026-09-11) ─────────────────────────
// `1.` → 불릿 → `2.`처럼 목록 사이에 다른 블록이 끼면 목록이 둘로 갈리고, 뒤 목록은
// `2.`부터다. 쓰는 쪽(serializeList)은 `start + i`로 제대로 적고 있었는데 **읽는 쪽 둘이
// 그 숫자를 버려서** 저장하고 다시 열면 전부 `1.`이 됐다(사용자 스크린샷 · 업무 상세).
// **되돌리기**: mdToDoc의 `attrs: { start … }`를 빼면 왕복이 `1.`로 돌아와 깨진다.
{
  const src = '1. 첫째\n- 사이 불릿\n2. 둘째\n3. 셋째';
  const doc = mdToDoc(src);
  const lists = doc.content.filter(b => b.type === 'orderedList');
  assert.strictEqual(lists.length, 2, '사이에 블록이 끼면 번호 목록이 둘로 갈린다');
  // 되돌아간 코드에는 attrs가 아예 없다 — 던지지 말고 값을 비교해서 깨지게 둔다
  assert.strictEqual((lists[0].attrs || {}).start, 1);
  assert.strictEqual((lists[1].attrs || {}).start, 2, '뒤 목록은 2부터다');
  assert.strictEqual(lists[1].content.length, 2, '이어지는 2.·3.은 한 목록이다');
  assert.strictEqual(round(src), src, '왕복 뒤에도 2.·3.이다');
  assert.strictEqual(round('5) 다섯\n6) 여섯'), '5. 다섯\n6. 여섯', '괄호로 적어도 숫자는 지킨다');
  // **그리는 쪽**(RichText)도 그 숫자로 그려야 한다 — `<ol start>`가 없으면 화면에서는
  // 다시 1부터다. JSX라 노드에서 부를 수 없으므로 소스로 본다(logcheck와 같은 방식이고,
  // 실제로 그려지는지는 tests/handoff가 브라우저에서 본다).
  const rich = readFileSync(new URL('../src/components/RichText.jsx', import.meta.url), 'utf8');
  assert.ok(rich.includes('start: Number(ol[1]) || 1'), 'RichText가 블록의 첫 숫자를 start로 담는다');
  assert.ok(rich.includes('<ol key={block.key} start={block.start || 1}'), 'RichText가 <ol start>로 그린다');
  console.log('번호 목록 이어짐 통과 (8 asserts)');
}
