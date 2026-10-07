// logcheck-ai — AI 글 조각·사람 줄·임베딩·뜻 검색. 노드 스위트(브라우저·서버 없음 · tests/README.md).
// logcheck 묶음의 하나다 — `npm run verify -- logcheck`가 logcheck와 logcheck-* 전부를 돈다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// ── 첨부 발췌가 글인가 · HTML은 글만 (services/textQuality.js · fileText.js · 2026-09-24) ──
// 악보·콘티 PDF에서 pdf.js가 뽑는 것은 화음 글자와 기호 부스러기다 — 그게 발췌로 들어가면 AI
// 요약이 읽을 것 없는 기호 2천 자를 싣는다. HTML 첨부는 원문이 그대로 들어가 태그가 자리를
// 먼저 채웠다. 앱은 **PDF에만** 글 판정을 걸고, 한글 수는 보지 않는다(영어 문서를 비우면 안 된다).
// 되돌리기 검사: WEIRD에서 굽은 따옴표를 빼면 '인쇄물 따옴표·글머리표'가, fileText에서
// looksLikeText 거르기를 지우면 'PDF에만 건다'가 깨진다.
{
  const T = await import(new URL('../src/services/textQuality.js', import.meta.url).href);
  const ko = '하나님이 그 아이의 소리를 들으셨나니 하나님의 사자가 하늘에서부터 하갈을 불러 가라사대 하갈아 무슨 일이냐 두려워 말라.';
  assert.strictEqual(T.looksLikeText(ko), true, '한국어 본문은 글이다');
  assert.strictEqual(T.looksLikeText('The Lord is my shepherd; I shall not want. He makes me lie down in green pastures.'), true,
    '영어 문서도 글이다 — 앱은 한글 수를 보지 않는다');
  assert.strictEqual(T.looksLikeText('“은혜” — 2부 순서 • 찬양 • 기도 • 말씀 ‘아멘’ 「광고」 <공지> 10:30~12:00'), true,
    '워드 PDF의 인쇄물 따옴표·줄표·글머리표는 기호 부스러기가 아니다');
  const debris = 'G D/F# ¤ Em ☆ C □ ⇌ 十 ♩ ♪ ¤ ☆ □ ⇌ 十 Am7 ¤ ☆ □ ♩ ♪ ¤ ☆ □';
  assert.strictEqual(T.looksLikeText(debris), false, '악보 부스러기는 글이 아니다');
  assert.strictEqual(T.looksLikeText('����� ��� ������ �� ���'), false, '깨진 글자(U+FFFD)는 글이 아니다');
  assert.strictEqual(T.looksLikeText(''), false, '빈 글은 글이 아니다');
  assert.strictEqual(T.looksLikeText('   \n '), false);
  assert.strictEqual(T.looksLikeText('A-1'), true, '짧아도 글이면 글이다(앱은 글자 수 하한이 없다)');
  // 백필 스크립트가 쓰는 더 엄한 문턱(사진·스캔 PDF를 Gemini로 넘길지)
  assert.strictEqual(T.looksLikeText('Am7 G C D Em F G Am C D G Em', { minHangul: 30 }), false, '백필 문턱: 한글 30자');
  assert.strictEqual(T.looksLikeText(ko, { minLength: 20, minHangul: 30 }), true);
  const st = T.textStats('가나 다 ¤');
  assert.deepStrictEqual([st.length, st.readable, st.weird, st.hangul], [4, 3, 1, 3], '공백을 뺀 몸통으로 센다');
  // 경계값 — 60%·5%
  assert.strictEqual(T.looksLikeText('가'.repeat(19) + '¤'), true, '기호 5%는 글');
  assert.strictEqual(T.looksLikeText('가'.repeat(18) + '¤¤'), false, '기호 10%는 글이 아니다');
  assert.strictEqual(T.looksLikeText('가'.repeat(6) + '....'), true, '읽히는 글자 60%는 글');
  assert.strictEqual(T.looksLikeText('가'.repeat(5) + '.....'), false, '읽히는 글자 50%는 글이 아니다');

  // HTML → 글
  const html = `<!doctype html><html><head><title>t</title><style>body{color:red}</style>
    <script>alert("x<y")</script></head><body><!-- 주석 --><h1>주보</h1><p>하나&nbsp;&amp;&#32;둘 &lt;셋&gt; &#xAC00;</p>
    <noscript>켜 주세요</noscript><ul><li>찬양</li><li>기도</li></ul><svg><text>그림</text></svg></body></html>`;
  const got = T.htmlToText(html);
  assert.strictEqual(got, '주보\n하나 & 둘 <셋> 가\n찬양\n기도', `태그·스타일·스크립트를 걷고 글만(${JSON.stringify(got)})`);
  assert.ok(!/alert|color:red|주석|켜 주세요|그림/.test(got), '스크립트·스타일·주석·noscript·svg 내용은 버린다');
  assert.strictEqual(T.htmlToText(''), '');

  // 배선 — fileText
  const ft = readFileSync(new URL('../src/services/fileText.js', import.meta.url), 'utf8');
  const firstImport = ft.search(/^import /m);
  assert.ok(firstImport >= 0 && ft.slice(firstImport).startsWith("import './pdfPolyfill.js';"),
    '폴리필이 맨 먼저 실린다(pdf.js보다 앞)');
  assert.ok(/await import\('\.\/pdfWorkerEntry\.js\?worker&url'\)/.test(ft), 'PdfView와 같은 워커 껍데기');
  assert.ok(!/pdf\.worker\.min\.mjs/.test(ft), '폴리필 없는 워커를 따로 가리키지 않는다(전역 workerSrc를 덮는다)');
  assert.ok(/getDocument\(\{ \.\.\.PDF_TEXT_ASSETS,/.test(ft) && /cMapUrl: '\/pdfjs\/cmaps\/'/.test(ft),
    '한글 CID 글꼴을 풀 cmaps를 싣는다');
  assert.strictEqual((ft.match(/looksLikeText\(/g) || []).length, 1, '글 판정은 한 자리(PDF)에만');
  assert.ok(/return looksLikeText\(text\) \? text : '';\s*\}/.test(ft), 'PDF에 글 판정을 건다');
  assert.ok(/HTML\.includes\(ext\) \|\| type === 'text\/html'\) \{\s*return htmlToText\(/.test(ft),
    'HTML은 태그를 걷는다(일반 텍스트보다 먼저 본다)');
  console.log('PASS  첨부 발췌 글 판정·HTML 25가지');
}

// ── 성경 임베딩 뒷단 (0073 bible_vec · scripts/embed-bible.mjs · api/ai.js embed · 배치 E) ──────
// 절 쪽(스크립트)과 질문 쪽(api/ai.js)이 모델·차원·정규화를 한 벌로 써야 벡터끼리 견줄 수 있다 —
// 갈려도 오류 없이 엉뚱한 절만 나온다. 0073은 인덱스 없이 · 읽기만 승인된 사람 · RPC는 invoker.
// 되돌리기 검사: embedRows의 unitVec(v)를 v로 되돌리면 '맞춘 벡터를 넣는다'가, 0073에 create index를
// 더하면 '인덱스 없이'가, 정책의 is_approved()를 true로 바꾸면 '읽기 정책 하나'가 깨진다.
{
  const mig = readFileSync(new URL('../supabase/migrations/0073_bible_vec.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');   // 주석(되돌리기 SQL)은 빼고 본다
  assert.ok(/create extension if not exists vector with schema extensions;/.test(body), '0073이 vector를 extensions 스키마에 두지 않는다');
  assert.ok(/vec\s+extensions\.halfvec\(768\) not null/.test(body), 'bible_vec.vec이 halfvec(768) not null이 아니다');
  assert.ok(/ref\s+text primary key/.test(body) && /body\s+text not null/.test(body), 'bible_vec의 ref·body 칸 모양이 다르다');
  assert.ok(!/create\s+(unique\s+)?index/i.test(body) && !/using\s+(hnsw|ivfflat)/i.test(body), '0073은 인덱스 없이다(전수 비교 · 무료 500MB)');
  assert.ok(/alter table public\.bible_vec enable row level security;/.test(body), 'bible_vec에 RLS가 없다');
  const pols = [...body.matchAll(/create policy (\w+) on public\.bible_vec\s+for (\w+) using \(([^;]*)\);/g)];
  assert.deepStrictEqual(pols.map(m => [m[2], m[3]]), [['select', 'public.is_approved()']], '읽기 정책 하나(승인된 사람)만 있어야 한다 — 쓰기는 서비스 키만');
  assert.ok(/revoke insert, update, delete, truncate on public\.bible_vec from anon, authenticated;/.test(body), '클라이언트 쓰기 권한을 빼지 않았다');
  assert.ok(/create or replace function public\.match_bible\(q extensions\.halfvec\(768\), k int default 30\)\nreturns table \(ref text, book text, chapter int, verse int, body text, score real\)\nlanguage sql stable security invoker\nset search_path = public, extensions, pg_temp/.test(body),
    'match_bible 서명·invoker·search_path가 다르다');
  assert.ok(/order by b\.vec <=> q/.test(body) && /\(1 - \(b\.vec <=> q\)\)::real as score/.test(body), 'match_bible이 코사인 거리로 세우지 않는다');
  assert.ok(/revoke execute on function public\.match_bible\(extensions\.halfvec, int\) from public, anon;/.test(body), 'anon이 match_bible을 부를 수 있다');
  assert.ok(/-- drop table if exists public\.bible_vec;/.test(mig), '0073 맨 아래에 되돌리는 SQL이 없다');

  const ai = await import(new URL('../api/ai.js', import.meta.url).href);
  const E = await import(new URL('../scripts/embed-bible.mjs', import.meta.url).href);
  assert.strictEqual(ai.EMBED_MODEL, 'gemini-embedding-001');
  assert.strictEqual(ai.EMBED_DIM, 768);
  assert.strictEqual(Number(/halfvec\((\d+)\) not null/.exec(body)[1]), ai.EMBED_DIM, '0073의 차원과 api/ai.js의 EMBED_DIM이 다르다');
  assert.strictEqual(E.TASK_TYPE, 'RETRIEVAL_DOCUMENT');
  assert.strictEqual(E.EMBED_BATCH, 100, 'batchEmbedContents 한 번의 상한은 100이다');
  // 정규화 — 단위 길이 · 방향 유지 · 0·NaN은 던진다
  assert.deepStrictEqual(ai.unitVec([3, 4]), [0.6, 0.8]);
  const u = ai.unitVec(Array.from({ length: 768 }, (_, i) => Math.sin(i) * 0.02));
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-9, 'unitVec이 단위 길이를 만들지 않는다');
  assert.throws(() => ai.unitVec([0, 0]), /길이가 0/);
  assert.throws(() => ai.unitVec([1, NaN]), /숫자가 아닌/);
  const es = readFileSync(new URL('../scripts/embed-bible.mjs', import.meta.url), 'utf8');
  assert.ok(/import \{ EMBED_MODEL, EMBED_DIM, unitVec \} from '\.\.\/api\/ai\.js';/.test(es), '스크립트가 모델·차원·정규화를 api/ai.js에서 가져오지 않는다(두 벌이 된다)');
  assert.ok(/return \{ raw: Math\.hypot\(\.\.\.v\), vec: unitVec\(v\) \};/.test(es), '스크립트가 맞춘 벡터를 넣지 않는다(768차원 출력은 정규화되어 오지 않는다)');
  assert.ok(/v\.length !== EMBED_DIM/.test(es), '스크립트가 차원을 확인하지 않는다');
  // 요청 모양 — 절 쪽 DOCUMENT · 질문 쪽 QUERY · 둘 다 768
  const [req] = E.docRequests([{ ref: '요한복음 3:16', body: '하나님이 세상을' }]);
  assert.deepStrictEqual(req, { model: 'models/gemini-embedding-001', content: { parts: [{ text: '요한복음 3:16 하나님이 세상을' }] },
    taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 });
  const q = ai.embedQueryPayload('가'.repeat(600));
  assert.strictEqual(q.taskType, 'RETRIEVAL_QUERY');
  assert.strictEqual(q.outputDimensionality, 768);
  assert.strictEqual(q.content.parts[0].text.length, ai.MAX_EMBED_QUERY, '질문을 500자로 자르지 않는다');
  // 절 목록 — 편집 표기 36절을 뺀 31,067절 · ref는 formatRef 모양이고 parseRef가 다시 읽는다
  const verses = E.loadVerses();
  assert.strictEqual(verses.length, 31067);
  assert.deepStrictEqual(verses[0], { book: 'gen', chapter: 1, verse: 1, ref: '창세기 1:1', body: '태초에 하나님이 천지를 창조하시니라' });
  assert.ok(!verses.some(v => E.PLACEHOLDER_RE.test(v.body)), '편집 표기뿐인 절이 들어갔다');
  assert.ok(verses.some(v => v.ref === '신명기 3:9'), '괄호로 감싼 진짜 본문(신 3:9)까지 뺐다');
  assert.strictEqual(new Set(verses.map(v => v.ref)).size, verses.length, 'ref가 겹친다(primary key)');
  const { parseRef } = await import(new URL('../src/services/bibleRef.js', import.meta.url).href);
  const books = JSON.parse(readFileSync(new URL('../public/bible/index.json', import.meta.url), 'utf8'));
  for (const v of E.spreadSample(verses, 50)) {
    const p = parseRef(v.ref, books);
    assert.deepStrictEqual([p?.bookId, p?.start.chapter, p?.start.verse], [v.book, v.chapter, v.verse], `parseRef가 ${v.ref}를 못 읽는다`);
  }
  assert.strictEqual(E.loadVerses({ book: 'jud' }).length, 25);
  assert.strictEqual(E.vecLiteral([0.1, -0.25]), '[0.100000,-0.250000]');
  console.log('PASS  성경 임베딩 뒷단(0073 모양 · 모델·차원·정규화 한 벌 · 절 목록) 35가지');
}

// ── 업무·댓글·첨부 임베딩 뒷단 (0074 doc_vec · api/_docsync.js · scripts/embed-docs.mjs · 배치 E4) ──
// 0074는 원본 FK 셋 중 정확히 하나 · cascade · (kind, source_id, chunk) 유일 · 벡터 인덱스 없음 ·
// 읽기만 승인된 사람 · RPC는 invoker. 동기화의 열쇠는 **임베딩한 글의 해시**다(updated_at 아님).
// 되돌리기 검사: chunkText의 `<= max`를 `<= max + 500`으로 바꾸면 '조각은 max 이하'가, buildDocs의
// service_id 거르기를 지우면 '주보 첨부는 넣지 않는다'가, 0074에 create index를 더하면 '인덱스 없이'가,
// 정책의 is_approved()를 true로 바꾸면 '읽기 정책 하나'가 깨진다.
{
  const mig = readFileSync(new URL('../supabase/migrations/0074_doc_vec.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const [col, tbl] of [['card_id', 'cards'], ['comment_id', 'comments'], ['file_id', 'files']]) {
    assert.ok(new RegExp(`${col}\\s+uuid references public\\.${tbl}\\(id\\) on delete cascade,`).test(body), `doc_vec.${col}가 ${tbl}를 cascade로 잇지 않는다(지운 원본의 벡터가 남는다)`);
  }
  assert.ok(/kind\s+text not null check \(kind in \('card', 'comment', 'file'\)\)/.test(body), 'doc_vec.kind 목록이 다르다');
  assert.ok(/source_id\s+uuid generated always as \(coalesce\(card_id, comment_id, file_id\)\) stored/.test(body), 'source_id 생성 칸이 없다');
  assert.ok(/num_nonnulls\(card_id, comment_id, file_id\) = 1/.test(body), '원본이 정확히 하나라는 제약이 없다');
  for (const k of ['card', 'comment', 'file']) assert.ok(new RegExp(`kind <> '${k}'\\s+or ${k}_id\\s+is not null`).test(body), `kind='${k}'가 ${k}_id를 가리킨다는 제약이 없다`);
  assert.ok(/constraint doc_vec_source_chunk unique \(kind, source_id, chunk\)/.test(body), '(kind, source_id, chunk) 유일 제약이 없다 — upsert 열쇠');
  assert.ok(/vec\s+extensions\.halfvec\(768\) not null/.test(body) && /body_hash\s+text not null/.test(body), 'vec·body_hash 칸 모양이 다르다');
  assert.ok(!/create\s+(unique\s+)?index/i.test(body) && !/using\s+(hnsw|ivfflat)/i.test(body), '0074는 벡터 인덱스 없이다(전수 비교 · 무료 500MB)');
  assert.ok(/alter table public\.doc_vec enable row level security;/.test(body), 'doc_vec에 RLS가 없다');
  const pols = [...body.matchAll(/create policy (\w+) on public\.doc_vec\s+for (\w+) using \(([^;]*)\);/g)];
  assert.deepStrictEqual(pols.map(m => [m[2], m[3]]), [['select', 'public.is_approved()']], '읽기 정책 하나(승인된 사람)만 있어야 한다 — 쓰기는 서버 키만');
  assert.ok(/revoke insert, update, delete, truncate on public\.doc_vec from anon, authenticated;/.test(body), '클라이언트 쓰기 권한을 빼지 않았다');
  assert.ok(!/alter publication/i.test(body), 'doc_vec을 실시간 발행에 넣었다');
  assert.ok(/create or replace function public\.match_docs\(q extensions\.halfvec\(768\), k int default 20, kinds text\[\] default null\)\nreturns table \(kind text, card_id uuid, comment_id uuid, file_id uuid, project_id uuid, chunk int, body text, score real\)\nlanguage sql stable security invoker\nset search_path = public, extensions, pg_temp/.test(body),
    'match_docs 서명·invoker·search_path가 다르다');
  assert.ok(/order by d\.vec <=> q/.test(body) && /\(1 - \(d\.vec <=> q\)\)::real as score/.test(body), 'match_docs가 코사인 거리로 세우지 않는다');
  assert.ok(/coalesce\(t\.card_id, c\.card_id, f\.card_id\)/.test(body), '댓글·첨부 조각에 그 업무 id를 붙이지 않는다');
  assert.ok(/revoke execute on function public\.match_docs\(extensions\.halfvec, int, text\[\]\) from public, anon;/.test(body), 'anon이 match_docs를 부를 수 있다');
  assert.ok(/-- drop table if exists public\.doc_vec;/.test(mig) && /-- drop function if exists public\.match_docs/.test(mig), '0074 맨 아래에 되돌리는 SQL이 없다');

  const ai = await import(new URL('../api/ai.js', import.meta.url).href);
  const D = await import(new URL('../api/_docsync.js', import.meta.url).href);
  assert.strictEqual(Number(/halfvec\((\d+)\) not null/.exec(body)[1]), ai.EMBED_DIM, '0074의 차원과 api/ai.js의 EMBED_DIM이 다르다');
  const ds = readFileSync(new URL('../api/_docsync.js', import.meta.url), 'utf8');
  assert.ok(/import \{ EMBED_MODEL, EMBED_DIM, unitVec \} from '\.\/ai\.js';/.test(ds), '_docsync가 모델·차원·정규화를 api/ai.js에서 가져오지 않는다(두 벌이 된다)');
  assert.ok(/return unitVec\(v\);/.test(ds) && /v\.length !== EMBED_DIM/.test(ds), '_docsync가 차원 확인·단위 길이 맞추기를 안 한다');
  assert.ok(/from '\.\.\/api\/_docsync\.js'/.test(readFileSync(new URL('../scripts/embed-docs.mjs', import.meta.url), 'utf8')), '스크립트가 크론과 같은 동기화(_docsync)를 쓰지 않는다');
  assert.deepStrictEqual(D.docRequests(['가']), [{ model: 'models/gemini-embedding-001', content: { parts: [{ text: '가' }] }, taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 }]);

  // 해시 — 임베딩한 글의 sha256
  assert.strictEqual(D.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // 해시는 api/_lib.js 한 벌(19차) — 위키 원본 해시는 같은 함수의 앞 24자(len 옵션). 되돌리기: len을 무시하면 아래가 깨진다.
  const Lib = await import(new URL('../api/_lib.js', import.meta.url).href);
  assert.strictEqual(D.sha256, Lib.sha256, '문서 조각 해시가 _lib 한 벌이 아니다');
  assert.strictEqual(Lib.sha256('abc', { len: 24 }), 'ba7816bf8f01cfea414140de', 'len 옵션이 앞 24자만 남기지 않는다');
  const WB = await import(new URL('../api/_wikiBuild.js', import.meta.url).href);
  assert.strictEqual(WB.sha('abc'), 'ba7816bf8f01cfea414140de', '위키 원본 해시(src_hash)가 예전 24자와 다르다 — 모든 장이 다시 모인다');

  // 조각 — 짧으면 그대로 · 비면 없음 · 길면 max 이하로 문단 경계 · 앞 조각 끝이 다음 조각 앞에 겹친다
  assert.deepStrictEqual(D.chunkText('  짧은 글  '), ['짧은 글']);
  assert.deepStrictEqual(D.chunkText(''), []);
  const paras = Array.from({ length: 14 }, (_, i) => `## 문단 ${i}\n- 할 일 ${i}: ${'준비 '.repeat(30 + i * 4)}끝${i}`);
  const long = paras.join('\n\n');
  const ch = D.chunkText(long);
  assert.ok(ch.length >= 3, '긴 글을 여러 조각으로 나누지 않는다');
  assert.ok(ch.every(c => c.length <= D.CHUNK_MAX), `조각은 max(${D.CHUNK_MAX}) 이하 — ${ch.map(c => c.length)}`);
  for (let i = 0; i < paras.length; i++) assert.ok(ch.some(c => c.includes(`끝${i}`)), `문단 ${i}가 어느 조각에도 없다`);
  assert.ok(ch.slice(1).every(c => /^## 문단|^- 할 일|^준비/.test(c)), '조각이 문단·줄 경계가 아닌 자리에서 시작한다');
  for (let i = 1; i < ch.length; i++) {
    const head = ch[i].split('\n')[0];
    assert.ok(ch[i - 1].endsWith(head) && head.length <= D.CHUNK_OVERLAP, `조각 ${i}가 앞 조각 끝과 겹치지 않는다`);
  }
  assert.deepStrictEqual(D.chunkText(long), ch, '같은 글인데 조각이 달라진다(해시가 흔들린다)');
  const flat = D.chunkText('셀 '.repeat(2000));          // 엑셀 발췌처럼 줄바꿈 없는 통짜
  assert.ok(flat.length > 1 && flat.every(c => c.length <= D.CHUNK_MAX), '줄바꿈 없는 긴 발췌를 max 이하로 자르지 않는다');

  // 글 만들기 — 카드 · 댓글 · 첨부(사진 캡션 그대로 · 주보 첨부·빈 발췌·업무 없는 댓글은 뺀다)
  const P = 'p-1', C1 = 'c-1', C2 = 'c-2';
  const src = {
    projects: [{ id: P, name: '2026 하계 수련회' }],
    cards: [
      { id: C1, project_id: P, title: '피드백 및 강평회', updated_at: '2026-09-01',
        description: '[회의록](https://docs.google.com/x) ==정한 것== **39명**\n\n### 청년별 담당 업무\n- @임성빈 · 결산안 · 9월 30일까지' },
      { id: C2, project_id: P, title: '숙소', description: '' },
    ],
    comments: [{ id: 'm-1', card_id: C1, body: '결산 공유해주세요' }, { id: 'm-2', card_id: 'gone', body: '고아' }, { id: 'm-3', card_id: C2, body: '  ' }],
    files: [
      { id: 'f-1', card_id: C1, name: '결산안.xlsx', text_excerpt: '교회지원 3,500,000' },
      { id: 'f-2', card_id: C1, name: 'IMG.JPG', text_excerpt: '[사진] 제주 해안에서 청년 두 명' },
      { id: 'f-3', card_id: C1, name: '빈.pdf', text_excerpt: '' },
      { id: 'f-4', card_id: null, service_id: 's-1', name: '큐시트.pdf', text_excerpt: '작성 중 주보' },
      { id: 'f-5', card_id: C1, service_id: 's-1', name: '콘티.pdf', text_excerpt: '작성 중 주보' },
    ],
  };
  const docs = D.buildDocs(src);
  const byId = (id) => docs.filter(d => d.source_id === id);
  assert.strictEqual(byId(C1)[0].body, '2026 하계 수련회 / 피드백 및 강평회\n회의록 정한 것 39명\n\n### 청년별 담당 업무\n- @임성빈 · 결산안 · 9월 30일까지',
    '카드 글 모양이 다르다(링크 주소·강조는 걷고 담당 업무 도막·@이름은 그대로)');
  assert.strictEqual(byId(C2)[0].body, '2026 하계 수련회 / 숙소', '본문이 빈 업무는 머리줄만으로 한 조각');
  assert.strictEqual(byId('m-1')[0].body, '피드백 및 강평회 · 댓글: 결산 공유해주세요');
  assert.strictEqual(byId('m-1')[0].project_id, P, '댓글 조각에 업무의 프로젝트가 안 붙는다');
  assert.strictEqual(byId('f-1')[0].body, '피드백 및 강평회 · 첨부: 결산안.xlsx\n교회지원 3,500,000');
  assert.strictEqual(byId('f-2')[0].body, '피드백 및 강평회 · 첨부: IMG.JPG\n[사진] 제주 해안에서 청년 두 명', '사진 캡션의 [사진] 접두를 잃었다');
  for (const gone of ['m-2', 'm-3', 'f-3', 'f-4']) assert.strictEqual(byId(gone).length, 0, `${gone}는 넣지 않아야 한다`);
  assert.strictEqual(byId('f-5').length, 0, '주보 첨부는 넣지 않는다(작성 중 주보의 발췌가 전원에게 샌다)');
  for (const d of docs) {
    const ids = [d.card_id, d.comment_id, d.file_id].filter(Boolean);
    assert.deepStrictEqual(ids, [d.source_id], '조각 행의 원본 칸이 정확히 하나가 아니다(0074 제약)');
    assert.strictEqual(d[`${d.kind}_id`], d.source_id, 'kind와 원본 칸이 어긋난다');
    assert.strictEqual(d.body_hash, D.sha256(d.body), '해시가 임베딩한 글의 sha256이 아니다');
  }
  const touched = D.buildDocs({ ...src, cards: src.cards.map(c => ({ ...c, updated_at: '2030-01-01', status: 'done' })) });
  assert.deepStrictEqual(touched.map(d => d.body_hash), docs.map(d => d.body_hash), 'updated_at·상태만 바뀌었는데 해시가 달라진다(매일 다시 임베딩한다)');
  assert.deepStrictEqual(D.buildDocs(src, ['comment']).map(d => d.kind), ['comment'], 'kinds로 한 종류만 고르지 않는다');

  // 증분 계획 — 같으면 0 · 글이 바뀌면 embed · 프로젝트만 옮기면 move · 조각이 줄면 drop · 다른 종류는 안 건드림
  const existing = docs.map((d, i) => ({ id: i + 1, kind: d.kind, source_id: d.source_id, chunk: d.chunk, body_hash: d.body_hash, project_id: d.project_id }));
  assert.deepStrictEqual(D.planSync(docs, existing), { embed: [], move: [], drop: [] }, '바뀐 것이 없는데 할 일이 생긴다');
  const edited = D.buildDocs({ ...src, comments: [{ ...src.comments[0], body: '결산 올렸어요' }] });
  const p1 = D.planSync(edited, existing);
  assert.deepStrictEqual(p1.embed.map(d => d.source_id), ['m-1'], '고친 댓글만 다시 임베딩해야 한다');
  const moved = D.buildDocs({ ...src, projects: [...src.projects, { id: 'p-2', name: '2026 하계 수련회' }], cards: src.cards.map(c => c.id === C2 ? { ...c, project_id: 'p-2' } : c) });
  const p2 = D.planSync(moved, existing);
  assert.strictEqual(p2.embed.length, 0, '이름이 같은 프로젝트로 옮겼을 뿐인데 다시 임베딩한다');
  assert.deepStrictEqual(p2.move, [{ id: existing.find(r => r.source_id === C2).id, project_id: 'p-2' }], '옮긴 업무의 project_id를 고치지 않는다');
  const extra = [...existing, { id: 99, kind: 'card', source_id: C1, chunk: 5, body_hash: 'old', project_id: P }];
  assert.deepStrictEqual(D.planSync(docs, extra).drop, [99], '줄어든 조각을 지우지 않는다');
  assert.deepStrictEqual(D.planSync(D.buildDocs(src, ['file']), extra, ['file']), { embed: [], move: [], drop: [] }, '--kind file이 카드 조각을 지운다');
  console.log('PASS  문서 임베딩 뒷단(0074 모양 · 조각·해시 · 글 모양 · 증분 계획)');
}

// ── AI가 사람을 부르는 말 · 글에 나온 사람 (services/aiPeople.js · 2026-09-25 AI 감사 결정 1·3·6·7·9·13) ──
// 순수 모듈이라 여기서 바로 부른다. 프롬프트에 실리는 모양은 tests/aictx가 본다.
{
  const P = await import(new URL('../src/services/aiPeople.js', import.meta.url).href);
  // role_note → 직함 / 맡은 일. 끝이 ~장·총무·회계·전도사인 두 낱말까지가 직함이다.
  assert.deepStrictEqual(P.splitRoleNote('순장 · 찬양팀장'), { titles: ['순장', '찬양팀장'], notes: [] });
  assert.deepStrictEqual(P.splitRoleNote('예배팀장 · 찬양팀 남자 싱어'), { titles: ['예배팀장'], notes: ['찬양팀 남자 싱어'] });
  assert.deepStrictEqual(P.splitRoleNote('총무 · 회계 · 찬양팀 여자 싱어').titles, ['총무', '회계']);
  assert.deepStrictEqual(P.splitRoleNote('청년부 회장 · 여러 팀을 섬기는 팀원'), { titles: ['청년부 회장'], notes: ['여러 팀을 섬기는 팀원'] });
  assert.deepStrictEqual(P.splitRoleNote('전도사 · 담당 교역자').titles, ['전도사'], "'교역자'를 직함으로 읽었다(결정 6 — 전도사님으로 부른다)");
  assert.deepStrictEqual(P.splitRoleNote('담당 교역자(전도사님)').titles, ['전도사'], '괄호 속 옛 직함을 못 읽었다');
  assert.deepStrictEqual(P.splitRoleNote('부장님').titles, ['부장'], "뒤에 붙은 '님'을 안 뗐다(부장님님)");
  assert.deepStrictEqual(P.splitRoleNote('순장 · 찬양팀 일렉(팀에서 유일)'), { titles: ['순장'], notes: ['찬양팀 일렉(팀에서 유일)'] });
  // 결정 1 — role_note가 이긴다. 연도 직분·교역자는 role_note에 직함이 없을 때만 채운다
  const info = { isPastor: false, roles: ['lead_team'] };
  assert.deepStrictEqual(P.titlesOf({ role: '예배팀장 · 찬양팀 남자 싱어' }, info).titles, ['예배팀장'], '연도 직분(리더팀장)이 role_note를 밀어냈다');
  assert.deepStrictEqual(P.titlesOf({ role: '' }, info).titles, ['리더팀장'], 'role_note가 비었는데 연도 직분이 안 채운다');
  assert.deepStrictEqual(P.titlesOf({ role: '' }, { isPastor: true, roles: ['director'] }).titles, ['전도사', '부장']);
  // 결정 3 — 업무가 고른다
  const both = ['순장', '찬양팀장'];
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '찬양 콘티 결정', teams: ['찬양팀'] })), '찬양팀장');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '순모임 준비', teams: ['임원진'] })), '순장');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '양육', teams: ['순원'] })), '순장', '담당 팀이 순원이면 순 일이다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '대림절 TF', teams: ['임원진'] })), '찬양팀장', '순 아닌 첫 직함이어야 한다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '선착순 20명 모집', teams: ['웰컴팀'] })), '찬양팀장', "'선착순'을 순 일로 읽었다");
  assert.strictEqual(P.pickTitle(['리더순장'], P.taskScope({ title: '월례회', content: '리더순장님 참석' })), '리더순장');
  assert.strictEqual(P.isSunText({ text: '리더순장님 참석 · 리더순장 보고 · 리더 순장' }), false, "'리더순장'이라는 직함 글자를 순 일로 읽었다");
  // 본문만 순을 말할 때는 약한 신호 — 세 번 이상이어야 하고, 업무 팀의 직함이 있으면 그쪽이 이긴다
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '피드백', teams: ['찬양팀'], content: '## 순장 피드백' })), '찬양팀장', '본문의 순 한 번으로 순장을 골랐다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '나눔', teams: ['임원진'], content: '각 순 순원 출석 · 순모임 장소' })), '순장', '본문이 순 이야기인데 순장을 안 골랐다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '개선', teams: ['찬양팀'], content: '순장 권한 · 순원 목록 · 순 편성 화면' })), '찬양팀장', '업무 팀 직함이 약한 순 신호보다 먼저다');
  assert.strictEqual(P.pickTitle(both, P.taskScope({ title: '나눔', teams: ['임원진'], content: '순장 한 번' })), '찬양팀장', '본문의 순 한 번은 순 일이 아니다');
  assert.strictEqual(P.pickTitle(['리더팀장', '웰컴팀장'], P.taskScope({ title: '조 편성', teams: ['웰컴팀'] })), '웰컴팀장');
  assert.strictEqual(P.pickTitle(['찬양팀장', '예배팀장'], P.taskScope({ title: '10월 찬양 예배', teams: ['찬양팀', '엔지니어팀'] })), '찬양팀장', '팀이 맞는 직함이 예배팀장보다 먼저다');
  assert.strictEqual(P.pickTitle(['리더팀장', '예배팀장'], P.taskScope({ title: '10월 찬양 예배', teams: ['임원진'] })), '예배팀장', '예배 전반의 일인데 예배팀장을 안 골랐다');
  assert.strictEqual(P.pickTitle(['순장'], P.taskScope({ title: 'PPT 제작', teams: ['엔지니어팀'] })), '순장', '직함이 하나면 그 직함이다');
  assert.strictEqual(P.callName('신효진', '부장'), '신효진 부장님');
  assert.strictEqual(P.callName('강희라', ''), '강희라 청년');
  // 결정 13 — 글에 나온 가입자(열쇠: 표시명 · 명단 이름 · 이름 두 글자)
  const members = [
    { id: 'a', name: '노준석' }, { id: 'b', name: '시온' }, { id: 'c', name: '꽃님' }, { id: 'd', name: '현민스' }, { id: 'e', name: '이하랑Alex' },
  ];
  const idx = P.rosterIndex({
    people: [{ id: 'p1', name: '노준석', roster_name: '노준석', profile_id: 'a' }, { id: 'p2', name: '시온', roster_name: '이시온', profile_id: 'b' },
      { id: 'p3', name: '꽃님', roster_name: '강꽃님', profile_id: 'c' }, { id: 'p4', name: '현민스', roster_name: '배현민', profile_id: 'd' },
      { id: 'p5', name: '이하랑Alex', roster_name: '이하랑', profile_id: 'e' }],
    groups: [{ id: 'g', type: 'sun', name: 'TT순', leader_person_id: 'p1' }], members: [{ group_id: 'g', person_id: 'p3' }], roles: [],
  }, members);
  assert.strictEqual(idx.get('노준석').sun, 'TT순 순장');
  assert.strictEqual(idx.get('꽃님').sun, 'TT순 순원');
  const found = (s) => [...P.mentionedMembers(s, members, idx)].sort();
  assert.deepStrictEqual(found('### 준석\n- 좋았다'), ['노준석'], '줄 끝의 이름 두 글자를 못 찾았다');
  assert.deepStrictEqual(found('운전자(준석)가 고생'), ['노준석']);
  assert.deepStrictEqual(found('준석순(TT순)'), ['노준석'], "'OO순'을 못 찾았다");
  assert.deepStrictEqual(found('강꽃님 자매'), ['꽃님'], '명단 이름으로 표시명을 못 찾았다');
  assert.deepStrictEqual(found('현민순 모임'), ['현민스'], '명단 이름의 두 글자로 별명 표시명을 못 찾았다');
  assert.deepStrictEqual(found('하랑 의견'), ['이하랑Alex']);
  assert.deepStrictEqual(found('이시온 자매 · 시온 형제 · (시온)'), ['시온']);
  assert.deepStrictEqual(found('시온의 영광이 비치는 아침 · 주의 시온 성'), [], "찬양 가사의 '시온'을 사람으로 읽었다");
  assert.deepStrictEqual(found('노준석님'), ['노준석']);
  assert.deepStrictEqual(found('민스 · 이하랑의 · 선착순'), ['이하랑Alex'], "별명에서 뗀 두 글자('민스')를 열쇠로 썼다");
  assert.deepStrictEqual(found('현준석 형제'), [], '다른 사람 이름 안의 두 글자를 잡았다');
  // 한 줄 — 순 자리는 팀과 따로(결정 9)
  const line = P.personLine({ name: '노준석', teams: ['찬양팀', '순장'], role: '순장 · 찬양팀장' },
    { info: idx.get('노준석'), scope: P.taskScope({ title: '콘티', teams: ['찬양팀'] }), withMention: true });
  assert.strictEqual(line, '노준석 | 팀: 찬양팀 | 순: TT순 순장 | 부를 때: 노준석 찬양팀장님 | 멘션은 @노준석');
  assert.strictEqual(P.personLine({ name: '현민스', teams: ['순장'], role: '순장' }, { info: idx.get('현민스') }),
    '현민스(명단 이름 배현민) | 팀: 미지정 | 순: 순장 | 부를 때: 현민스 순장님');
  console.log('PASS  AI 사람 줄(aiPeople — 직함 고르기 · 순 칸 · 글에 나온 가입자)');
}

// ── AI 글 조각 (services/aiText.js · api/ai.js geminiText · 2026-09-30) ──────────
// 날짜 주석(성찬 · Q예배 · 주일 마감의 전날 준비) · 하위 업무 담당·기한 · 댓글 타임라인 · 대시 뒤처리 · 요약 모양 · 제미나이 답 잇기.
{
  const T = await import(new URL('../src/services/aiText.js', import.meta.url).href);
  // 2026-10: 4일·11일·18일·25일이 주일 → 11일이 둘째 주, 25일이 마지막 주
  assert.strictEqual(T.sundayNote('2026-10-11'), '둘째 주 성찬 예배');
  assert.strictEqual(T.sundayNote('2026-10-25'), '마지막 주 Q예배');
  assert.strictEqual(T.sundayNote('2026-10-04'), '', '첫째 주는 아무것도');
  assert.strictEqual(T.sundayNote('2026-10-18'), '', '셋째 주는 아무것도');
  assert.strictEqual(T.sundayNote('2026-10-10'), '', '주일이 아니면 아무것도');
  assert.strictEqual(T.sundayNote('2026-08-30'), '마지막 주 Q예배', '8월은 30일이 마지막 주일(다섯째)');
  assert.strictEqual(T.sundayNote('2026-08-23'), '', '다섯 주일인 달의 넷째는 마지막이 아니다');
  assert.strictEqual(T.dateLabel('2026-10-10'), '2026-10-10(토)');
  assert.strictEqual(T.dateLabel('2026-10-11'), '2026-10-11(일 · 둘째 주 성찬 예배)', '마감이 아니면 준비 줄이 없다');
  assert.strictEqual(T.dateLabel('2026-10-11', { due: true }), '2026-10-11(일 · 둘째 주 성찬 예배 · 준비는 10일(토)까지)');
  assert.strictEqual(T.dateLabel('2026-11-01', { due: true }), '2026-11-01(일 · 준비는 10월 31일(토)까지)', '전날이 앞 달이면 달까지');
  assert.strictEqual(T.dateLabel('2026-10-09', { due: true }), '2026-10-09(금)', '주일이 아닌 마감에는 준비 줄이 없다');
  assert.strictEqual(T.dateLabel(''), '');
  assert.strictEqual(T.dateLabel('미정'), '미정', '날짜가 아니면 그대로');
  assert.strictEqual(T.subtaskLabel({ title: '송폼 제작', assignee: '한가람', due: '2026-10-03' }), '송폼 제작(담당 한가람 · 10월 3일(토))');
  assert.strictEqual(T.subtaskLabel({ title: '송폼 제작', due: '2026-10-03' }), '송폼 제작(10월 3일(토))');
  assert.strictEqual(T.subtaskLabel({ title: '송폼 제작' }), '송폼 제작', '담당·기한이 없으면 제목만');
  // 댓글 — 날짜 · 답글 들여쓰기 · 최근 20개
  const c = (id, day, text, parentId = null) => ({ id, author: '가람', text, timestamp: `2026-09-${String(day).padStart(2, '0')}T03:00:00Z`, parentId });
  assert.strictEqual(T.commentTimeline([c('a', 23, '첫 댓글'), c('b', 24, '답글', 'a')]),
    '[9/23(수)] 가람: 첫 댓글\n  ↳ [9/24(목)] 가람: 답글');
  const many = Array.from({ length: 25 }, (_, i) => c(`m${i}`, 1 + i, `댓글 ${i}`));
  const tl = T.commentTimeline(many).split('\n');
  assert.strictEqual(tl[0], '(그 앞 댓글 5개 생략)');
  assert.strictEqual(tl.length, 21, '생략 줄 + 최근 20개');
  assert.ok(tl[1].endsWith('댓글 5') && tl[20].endsWith('댓글 24'), '남는 것은 최근 20개');
  assert.strictEqual(T.commentTimeline([]), '');
  assert.ok(!T.commentTimeline(many.slice(0, 3)).includes('생략'), '20개 이하는 생략 줄이 없다');
  // 대시 — 주소 안은 그대로
  assert.strictEqual(T.plainDashes('준비 — 확인 – 끝'), '준비 - 확인 - 끝');
  assert.strictEqual(T.plainDashes('[간식_네이버 — 링크](https://x.com/a—b?q=1–2) 끝—'), '[간식_네이버 - 링크](https://x.com/a—b?q=1–2) 끝-');
  assert.strictEqual(T.plainDashes(null), '');
  // 요약 모양
  const ok = '1. **현황** - 콘티가 나왔어요.\n2. **챙길 것** - 송폼을 만들어요.\n3. **다음 단계** - 연습 일정을 잡아요.';
  assert.ok(T.isSummaryShape(ok) && T.isSummaryShape(`\n${ok}\n`), '3줄 모양');
  assert.ok(!T.isSummaryShape('1. **현황** - 그대로예요'), '한 줄은 아니다');
  assert.ok(!T.isSummaryShape(`요약입니다\n${ok}`), '앞에 잡말이 붙으면 아니다');
  assert.ok(!T.isSummaryShape(ok.replace('**챙길 것**', '**할 일**')), '라벨이 다르면 아니다');
  // 제미나이 답 — 조각을 잇고, 끝나지 않은 답은 실패
  const ai = await import(new URL('../api/ai.js', import.meta.url).href);
  assert.deepStrictEqual(ai.geminiText({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '앞 ' }, { text: '생각', thought: true }, { text: '뒤' }] } }] }), { text: '앞 뒤' });
  assert.deepStrictEqual(ai.geminiText({ candidates: [{ content: { parts: [{ text: '옛 모양' }] } }] }), { text: '옛 모양' }, '이유가 없으면 받는다');
  assert.strictEqual(ai.geminiText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '잘린' }] } }] }).error, 'MAX_TOKENS');
  assert.deepStrictEqual(ai.geminiText({}), { text: '' });
  const aiSrc = readFileSync(new URL('../api/ai.js', import.meta.url), 'utf8');
  assert.ok(/if \(error\) \{[^\n]*res\.status\(502\)/.test(aiSrc), '끝나지 않은 답은 502(클라이언트가 MSG.failed로 보인다)');
  console.log('PASS  AI 글 조각(aiText — 날짜 주석 · 하위 업무 · 댓글 · 대시 · 요약 모양 · geminiText)');
}

// ── 뜻 검색 결과를 줄로 (services/vecSearch.js · 사용자 결정 G-a · S-a 2026-09-25) ──────────
// 화면(상단 검색의 '관련된 업무 내용' · 성경 검색의 AI 실패 대체)은 게스트 모드에서 안 돈다(네트워크 0) —
// 그래서 모양을 바꾸는 순수 로직은 여기서 본다. **되돌리기**: andParticle의 `% 28 ? '과' : '와'`를
// 뒤집거나, relatedTasks의 exclude 검사·같은 업무 묶기를 지우면 깨진다.
{
  const V = await import(new URL('../src/services/vecSearch.js', import.meta.url).href);
  // 와/과 — 받침으로 가른다(사용자 문구 '{검색어}과 관련된 성경 구절')
  assert.strictEqual(V.andParticle('두려움'), '과');
  assert.strictEqual(V.andParticle('사랑'), '과');
  assert.strictEqual(V.andParticle('믿음 소망'), '과');
  assert.strictEqual(V.andParticle('평화'), '와');
  assert.strictEqual(V.andParticle('재물과 돈'), '과');
  assert.strictEqual(V.andParticle('진로 고민'), '과');
  assert.strictEqual(V.andParticle('기도'), '와');
  assert.strictEqual(V.andParticle('걱정?'), '과', '끝의 문장부호는 건너뛴다');
  assert.strictEqual(V.andParticle('요한복음 3'), '과', '숫자는 읽는 소리로(삼)');
  assert.strictEqual(V.andParticle('시편 23:2'), '와', '숫자는 읽는 소리로(이)');
  assert.strictEqual(V.andParticle('love'), '와', '한글이 아니면 와');
  assert.strictEqual(V.andParticle(''), '와');
  // 조각 → 발췌 한 줄 (api/_docsync.js buildDocs의 모양)
  assert.strictEqual(V.docExcerpt({ kind: 'comment', body: '수련회 차량 대절 견적 · 댓글: 버스 두 대\n견적 받았어요' }), '버스 두 대 견적 받았어요');
  assert.strictEqual(V.docExcerpt({ kind: 'file', body: '청년부 2분기 결산 · 첨부: 결산안.xlsx\n수련회 숙소비,\n차량 대절비' }), '결산안.xlsx · 수련회 숙소비, 차량 대절비');
  assert.strictEqual(V.docExcerpt({ kind: 'file', body: '업무 · 첨부: 사진.jpg' }), '사진.jpg', '발췌가 없으면 파일명만');
  assert.strictEqual(V.docExcerpt({ kind: 'card', body: '2026 여름 수련회 / 장소 답사\n숙소 1인당   비용' }), '숙소 1인당 비용');
  assert.strictEqual(V.docExcerpt({ kind: 'card', body: '프로젝트 / 제목만' }), '', '본문 없는 업무는 빈 발췌');
  // 조각들 → 업무 줄: 가까운 순 · 업무 하나에 한 줄 · 위에 선 업무 빼기 · 모르는 업무 빼기 · 다섯까지
  const tasksById = { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' }, c: { id: 'c', title: 'C' },
    d: { id: 'd', title: 'D' }, e: { id: 'e', title: 'E' }, f: { id: 'f', title: 'F' }, g: { id: 'g', title: 'G' } };
  const rows = [
    { kind: 'card', card_id: 'a', body: 'P / A', score: 0.9 },                    // 머리줄만 — 발췌를 빌린다
    { kind: 'comment', card_id: 'b', body: 'B · 댓글: 비', score: 0.85 },
    { kind: 'comment', card_id: 'a', body: 'A · 댓글: 에이 댓글', score: 0.8 },
    { kind: 'file', card_id: 'x', body: 'X · 첨부: 없는.pdf\n글', score: 0.79 },   // 스토어에 없는 업무
    { kind: 'file', card_id: 'c', body: 'C · 첨부: 씨.pdf\n씨 발췌', score: 0.7 },
    { kind: 'card', card_id: 'd', body: 'P / D\n디', score: 0.6 },
    { kind: 'card', card_id: 'e', body: 'P / E\n이', score: 0.5 },
    { kind: 'card', card_id: 'f', body: 'P / F\n에프', score: 0.4 },
    { kind: 'card', card_id: 'g', body: 'P / G\n지', score: 0.3 },
  ];
  const got = V.relatedTasks(rows, { tasksById, exclude: new Set(['d']) });
  assert.deepStrictEqual(got.map(r => r.task.id), ['a', 'b', 'c', 'e', 'f'], '가까운 순 · 한 업무 한 줄 · 위의 업무·모르는 업무 빼고 다섯');
  assert.deepStrictEqual([got[0].kind, got[0].excerpt], ['comment', '에이 댓글'], '빈 발췌는 같은 업무의 다음 조각에서 빌린다');
  assert.deepStrictEqual([got[2].kind, got[2].excerpt], ['file', '씨.pdf · 씨 발췌']);
  assert.strictEqual(V.relatedTasks(rows, { tasksById: new Map(Object.entries(tasksById)), limit: 2 }).length, 2, 'Map도 받는다 · limit');
  assert.deepStrictEqual(V.relatedTasks(null, { tasksById }), []);
  assert.deepStrictEqual(V.RELATED_KIND_LABEL, { comment: '댓글', file: '첨부', card: '상세 내용' });
  assert.ok(V.RELATED_LIMIT === 5 && V.RELATED_DEBOUNCE_MS >= 350 && V.RELATED_K >= 10, '다섯 줄 · 350ms 이상 기다린다 · k 10 이상');
  assert.ok(!V.relatedReady('가') && !V.relatedReady(' 가 ') && V.relatedReady('가나') && V.relatedReady('가 나'), '공백을 뺀 두 글자부터');
  assert.strictEqual(V.relatedKey('  찬양   기획 '), '찬양 기획');
  assert.strictEqual(V.vecParam([0.5, -1]), '[0.5,-1]');
  // 성경 대체 줄 — match_bible 행 → AI 줄과 같은 모양 · 모르는 책·겹친 절 버림
  const books = [{ id: 'isa', name: '이사야' }, { id: 'psa', name: '시편' }];
  const bh = V.bibleVecHits([
    { ref: '이사야 41:10', book: 'isa', chapter: 41, verse: 10, body: '두려워 말라' },
    { ref: '이사야 41:10', book: 'isa', chapter: 41, verse: 10, body: '두려워 말라' },
    { ref: '??', book: 'zzz', chapter: 1, verse: 1, body: 'x' },
    { ref: '시편 23:4', book: 'psa', chapter: 23, verse: 4, body: '사망의' },
  ], books);
  assert.deepStrictEqual(bh, [
    { bookId: 'isa', name: '이사야', chapter: 41, verse: 10, to: 10, text: '두려워 말라' },
    { bookId: 'psa', name: '시편', chapter: 23, verse: 4, to: 4, text: '사망의' },
  ]);
  // 게스트에서는 네트워크 0 — semanticOn이 클라우드 클라이언트를 보고, 상단 검색이 그것으로 구역을 가른다
  const semSrc = readFileSync(new URL('../src/services/semantic.js', import.meta.url), 'utf8');
  const laySrc = readFileSync(new URL('../src/components/searchBox.jsx', import.meta.url), 'utf8');
  assert.ok(/export const semanticOn = \(\) => !!supabase;/.test(semSrc), 'semanticOn은 클라우드 클라이언트가 있을 때만 참');
  assert.ok(/const ready = semanticOn\(\) && relatedReady\(query\);/.test(laySrc), '상단 검색의 뜻 결과는 semanticOn일 때만 묻는다');
  assert.ok(/>관련된 업무 내용</.test(laySrc), "구역 머리는 사용자 문구 '관련된 업무 내용'");
  assert.ok(/max-h-\[360px\]/.test(laySrc), '데스크톱 결과 판은 360px까지');
  console.log('PASS  뜻 검색 결과를 줄로(vecSearch — 와/과 · 발췌 · 업무 묶기 · 성경 대체 줄 · 게스트 네트워크 0)');
}

