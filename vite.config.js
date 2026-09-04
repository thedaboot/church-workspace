import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// SEED Design은 파운데이션 토큰(@seed-design/css/base.css)만 쓴다. 컴포넌트를 하나도
// 쓰지 않으므로 @seed-design/react와 vite 플러그인은 뺐다(플러그인은 컴포넌트 레시피를
// 생성하는 용도다). 다시 컴포넌트를 도입하면 그때 되돌리면 된다.

// ============================================================================
// dev 서버에서 api/*.js 돌리기 (2026-09-05)
// ----------------------------------------------------------------------------
// 왜: `vite`에는 Vercel 함수가 없다. 그래서 dev(5173)에서 /api/drive-file?id=… 를
// 부르면 Vite의 정적/변환 미들웨어가 **그 파일의 소스 코드**를 돌려줬다. HTML 첨부
// 미리보기를 sandbox iframe에 srcdoc으로 넣었더니 화면에 api/drive-file.js가 떠서
// 잡혔다. PDF 중계·유튜브(api/yt.js)·AI(api/ai.js)도 그래서 여태 배포에서만
// 확인이 됐다(HANDOFF §1.1 "api/yt.js는 배포에서만 돕니다").
//
// 무엇을 흉내내나: 핸들러들이 실제로 쓰는 표면만이다 —
//   req.method · req.headers · req.query · req.body(JSON)
//   res.status(n)(체이닝) · res.json · res.send · res.setHeader · res.end
// (`grep -ohE "\b(req|res)\.[a-zA-Z]+" api/*.js`가 목록이다. 늘어나면 여기도 늘린다.)
// `vercel dev`를 쓰지 않는 이유는 로그인·빌드가 얽혀 무거운데, 우리가 필요한 것은
// 이 여섯 줄짜리 표면뿐이라서다.
//
// 게스트 모드(--mode guest, 4598)에는 붙이지 않는다 — 게스트는 supabase가 없어서
// 어차피 401이고, 브라우저 검증 스위트가 보는 서버라 건드리지 않는 쪽이 안전하다.
// apply:'serve'라 `vite build`·프로덕션에는 아무 영향이 없다.
// ============================================================================
const API_ROUTE = /^\/api\/([A-Za-z0-9_-]+)\/?$/;

// Vercel은 content-type이 json이면 req.body에 파싱된 객체를 넣어 준다. 핸들러들의
// readJson()은 그게 없으면 req 스트림을 직접 읽는데, 여기서 이미 다 읽어 버리므로
// 파싱해서 넣어 주는 쪽이 맞다(안 넣으면 빈 몸통으로 보인다).
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

// node의 ServerResponse에 Vercel 모양을 얹는다. status는 체이닝이 되어야 한다
// (api/yt.js가 res.status(…)\n.json(…) 으로 줄을 넘긴다).
function asVercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (Buffer.isBuffer(body)) { res.end(body); return res; }
    if (body && typeof body === 'object') return res.json(body);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body == null ? '' : String(body));
    return res;
  };
  return res;
}

function devApiFunctions(mode) {
  return {
    name: 'dev-api-functions',
    apply: 'serve',
    configureServer(server) {
      // .env의 **서버용** 키(VITE_ 접두사가 없는 것들 — SUPABASE_SECRET_KEY·
      // DRIVE_WEBAPP_*·GEMINI_API_KEY·YOUTUBE_API_KEY·VAPID_*·CRON_SECRET)는 Vite가
      // import.meta.env에 넣지 않는다(넣으면 브라우저로 나가니 그게 맞다). 핸들러는
      // process.env에서 읽으므로 여기서만 옮긴다. 이미 있는 값은 덮지 않는다.
      const env = loadEnv(mode, server.config.root, '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

      const apiDir = resolve(server.config.root, 'api');
      server.middlewares.use(async (req, res, next) => {
        const name = API_ROUTE.exec((req.url || '').split('?')[0])?.[1];
        if (!name) return next();
        const file = resolve(apiDir, `${name}.js`);
        if (!existsSync(file)) return next();
        try {
          // 모듈은 node가 캐시한다. mtime을 쿼리로 붙여 두면 파일을 고쳤을 때만
          // 새로 읽힌다(고치지 않았으면 매 요청이 같은 주소라 캐시가 그대로 산다).
          const mod = await import(`${pathToFileURL(file).href}?t=${statSync(file).mtimeMs}`);
          // Vercel의 req.query는 같은 이름이 여러 번이면 배열이 되는데, 우리 핸들러는
          // 하나씩만 읽으므로(id·type) 마지막 값 하나로 충분하다.
          req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
          if (req.method !== 'GET' && req.method !== 'HEAD') req.body = await readBody(req);
          await mod.default(req, asVercelRes(res));
        } catch (e) {
          console.error(`[dev-api] /api/${name} 실패:`, e);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          if (!res.writableEnded) res.end(JSON.stringify({ error: `dev 서버에서 /api/${name} 실행 실패: ${e?.message || e}` }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'guest' ? [] : [devApiFunctions(mode)]),
  ],
}));
