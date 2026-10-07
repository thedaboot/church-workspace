// logcheck 묶음이 같이 쓰는 손질 — 소스를 tmp에 베껴 노드에서 import한다(스위트가 아니다 · run.mjs HELPERS).
// 앱 소스는 vite 별칭·react·supabase를 import해서 노드에서 바로 못 들인다 — 블록마다 걷을 줄을
// 걷은 글(`src`)을 넘기고, 여기서는 베끼고 들이는 것만 한다.
//   loadSource('src/utils.js')                              그대로 베껴 들인다
//   loadSource('src/services/word.js', { src })             손질한 글로
//   loadSource('src/hooks/x.js', { as: 'tick.mjs' })         tmp 안 파일 이름(기본: 이름.mjs)
//   loadSource(p, { dir, siblings: ['src/services/a.js'] })  같은 폴더에 둘 순수 모듈(상대 import용)
//   바렐 줄(`export * from './utils/x.js'`)은 그 조각을 tmp의 같은 상대 자리에 같이 베낀다(utils.js — 19차 B2 · follow: false로 끈다)
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const readSrc = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// 바렐(`export * from './x/y.js'`)로 쪼갠 소스는 그 조각까지 이어 읽는다 — 소스 글자를 단정하는 검사가
// 함수가 어느 조각으로 갔는지 몰라도 되게(cloud.js · worship.js — 2026-10-07 19차). 다른 스위트도 이것을 문다.
export function readSplit(rel) {
  const text = readSrc(rel);
  const base = rel.replace(/[^/]*$/, '');
  const parts = [...text.matchAll(/^export \* from '\.\/([^']+)';/gm)].map(m => readSplit(base + m[1]));
  return [text, ...parts].join('\n');
}

export const tmpDir = () => mkdtempSync(join(tmpdir(), 'lc-'));

// 바렐 줄이 가리키는 조각을 `to` 폴더의 같은 상대 자리에 베낀다(조각 안의 바렐 줄도 따라간다).
function copyParts(text, from, to) {
  for (const [, p] of text.matchAll(/^export \* from '\.\/([^']+)';/gm)) {
    const body = readSrc(from + p);
    mkdirSync(dirname(join(to, p)), { recursive: true });
    writeFileSync(join(to, p), body);
    copyParts(body, from + p.replace(/[^/]*$/, ''), dirname(join(to, p)));
  }
}

export async function loadSource(rel, { src, as, dir = tmpDir(), siblings = [], follow = true } = {}) {
  for (const s of siblings) writeFileSync(join(dir, basename(s)), readSrc(s));
  const f = join(dir, as ?? basename(rel).replace(/\.[^.]+$/, '.mjs'));
  const text = src ?? readSrc(rel);
  if (follow) copyParts(text, rel.replace(/[^/]*$/, ''), dir);
  writeFileSync(f, text);
  return import(pathToFileURL(f).href);
}
