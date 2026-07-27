import assert from 'node:assert';
const M = await import('file:///C:/Users/%EB%85%B8%EC%A4%80%EC%84%9D/Desktop/church_workspace/src/services/markdown.js');
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
