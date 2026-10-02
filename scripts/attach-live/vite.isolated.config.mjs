// 실측용 dev 서버 설정 — 레포의 vite.config.js 그대로에 **의존성 캐시 자리만** 따로 둔다.
//   npx vite --config scripts/attach-live/vite.isolated.config.mjs --port 4614 --strictPort
// 왜: 워크트리들이 node_modules를 이어 붙여 쓰면 `node_modules/.vite`도 같이 쓰게 되는데, 다른 dev 서버(게스트 모드 등)가
// 같은 캐시를 다시 묶는 순간 이쪽 페이지가 'optimized dependencies changed. reloading'으로 새로 고쳐지고,
// 섞인 청크 때문에 편집기(ProseMirror)가 'localsInner'로 죽었다(2026-10-02 첫 실측). 캐시를 떼면 그 둘이 없다.
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import base from '../../vite.config.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export default (env) => {
  const cfg = typeof base === 'function' ? base(env) : base;
  return { ...cfg, root, cacheDir: resolve(tmpdir(), 'attach-live-vite-cache') };
};
