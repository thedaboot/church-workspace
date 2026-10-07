// logcheck 묶음이 같이 쓰는 손질 — 소스를 tmp에 베껴 노드에서 import한다(스위트가 아니다 · run.mjs HELPERS).
// 앱 소스는 vite 별칭·react·supabase를 import해서 노드에서 바로 못 들인다 — 블록마다 걷을 줄을
// 걷은 글(`src`)을 넘기고, 여기서는 베끼고 들이는 것만 한다.
//   loadSource('src/utils.js')                              그대로 베껴 들인다
//   loadSource('src/services/word.js', { src })             손질한 글로
//   loadSource('src/hooks/x.js', { as: 'tick.mjs' })         tmp 안 파일 이름(기본: 이름.mjs)
//   loadSource(p, { dir, siblings: ['src/services/a.js'] })  같은 폴더에 둘 순수 모듈(상대 import용)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const readSrc = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

export const tmpDir = () => mkdtempSync(join(tmpdir(), 'lc-'));

export async function loadSource(rel, { src, as, dir = tmpDir(), siblings = [] } = {}) {
  for (const s of siblings) writeFileSync(join(dir, basename(s)), readSrc(s));
  const f = join(dir, as ?? basename(rel).replace(/\.[^.]+$/, '.mjs'));
  writeFileSync(f, src ?? readSrc(rel));
  return import(pathToFileURL(f).href);
}
