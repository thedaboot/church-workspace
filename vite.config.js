import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ============================================================================
// dev 서버에서 api/*.js 돌리기 (2026-09-05)
// ----------------------------------------------------------------------------
// 왜: `vite`에는 Vercel 함수가 없다. 그래서 dev(5173)에서 /api/drive-file?id=… 를
// 부르면 Vite의 정적/변환 미들웨어가 **그 파일의 소스 코드**를 돌려줬다. HTML 첨부
// 미리보기를 sandbox iframe에 srcdoc으로 넣었더니 화면에 api/drive-file.js가 떠서
// 잡혔다. PDF 중계·유튜브(api/yt.js)·AI(api/ai.js)도 그래서 여태 배포에서만
// 확인이 됐다.
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
// **`_`로 시작하는 이름은 라우트가 아니다**(api/_lib.js — 형제들이 import하는 공용 머리).
// Vercel이 그렇게 가르므로(404) 여기서도 404로 끝낸다 — 그냥 넘기면(next) 위에 적은 그
// 함정대로 Vite가 **그 파일의 소스**를 돌려준다.
const API_ROUTE = /^\/api\/([A-Za-z0-9_-]+)\/?$/;
const NOT_A_ROUTE = (name) => name.startsWith('_');

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
        if (NOT_A_ROUTE(name)) { res.statusCode = 404; res.end(); return; }
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

// ============================================================================
// pdf.js 보조 자료를 `/pdfjs/…`로 낸다 (2026-09-13)
// ----------------------------------------------------------------------------
// 왜: 한글 PDF가 **글자 없이** 그려졌다(사용자 신고 — 'TalkFile_1회 학점 라디오대본.pdf'.
// 숫자·영문만 남고 한글이 통째로 비었다). 원인은 pdf.js가 한글 CID 글꼴을 풀 때
// `Adobe-Korea1-UCS2.bcmap`을 받아야 하는데 `cMapUrl`을 안 줘서다 —
// "Ensure that the `cMapUrl` API parameter is provided." 경고만 내고 그 글꼴을 버린다
// (2026-09-13에 그 파일로 노드에서 재현·확인했다: cMapUrl을 주면 한글이 그대로 나온다).
//
// 그 자료는 `node_modules/pdfjs-dist/` 안에 이미 있다. public/에 복사해 커밋하면
// 169개 파일이 레포에 눌러앉고 pdfjs-dist를 올릴 때마다 어긋나므로, **설치된 것을
// 그대로** dev에서는 미들웨어로 내주고 build에서는 결과물에 실어 보낸다.
//   cmaps          한중일 CID 글꼴 — 이것이 없어서 한글이 빠졌다
//   standard_fonts 글꼴을 품지 않은 PDF의 기본 14종 대체
//   wasm·iccs      스캔 PDF의 JBIG2·JPEG2000 그림, ICC 색 프로필
//                  (없으면 pdf.js가 `_nowasm_fallback.js`로 내려가 느리거나 못 그린다)
// 주소는 PdfView.jsx가 `/pdfjs/<dir>/`로 물고 있다 — 한쪽을 바꾸면 짝도 고치세요.
// ============================================================================
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const PDFJS_ROUTE = /^\/pdfjs\/(cmaps|standard_fonts|wasm|iccs)\/([A-Za-z0-9._-]+)$/;

function pdfjsAssets() {
  const dirOf = (root, d) => resolve(root, 'node_modules/pdfjs-dist', d);
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = PDFJS_ROUTE.exec((req.url || '').split('?')[0]);
        if (!m) return next();
        const file = dirOf(server.config.root, `${m[1]}/${m[2]}`);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    // 번들이 아니라 **정적 파일**로 낸다 — pdf.js가 주소로 하나씩 받아 가고,
    // 실제로 받는 것은 그 PDF가 쓰는 한두 개뿐이다(cmaps 전체는 1.5MB지만
    // 한글 문서는 23KB짜리 하나만 받는다).
    generateBundle() {
      const root = process.cwd();
      for (const d of PDFJS_DIRS) {
        const dir = dirOf(root, d);
        if (!existsSync(dir)) continue;
        for (const f of readdirSync(dir)) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${d}/${f}`, source: readFileSync(resolve(dir, f)) });
        }
      }
    },
  };
}

// ============================================================================
// 첫 화면에 이미 들어 있는 벤더만 따로 칸을 낸다 (2026-09-14)
// ----------------------------------------------------------------------------
// **크기를 줄이는 것이 아니다**(1,096 → 1,100 kB로 오히려 4 kB 는다). 노리는 것은
// **배포 사이의 캐시**다 — `/assets/*`는 immutable로 캐시되므로(vercel.json), 이 칸의
// 이름이 그대로면 재방문자는 다시 받지 않는다. 앱 코드만 고쳐 다시 지어 확인했다:
//   vendor-CxilZ4dm.js → 그대로 · index-B4sqzN3O.js → 새 해시
// 하루에 여러 번 푸시하므로, 매일 들어오는 사람에게 배포마다 129 kB(gzip)가 빠진다.
//
// **`node_modules`를 통째로 묶지 마세요 — 첫 화면이 2배로 나빠집니다.** 그렇게 하면
// 지금 lazy로 잘 빠져 있는 것들(tiptap 286 · pdfjs-dist 425 · jspdf 332 ·
// html2canvas 199 kB)이 이 칸에 끌려 들어와 **2,052 kB**가 된다(2026-09-14 실측 —
// 그렇게 해 보고 되돌렸다). 그래서 **첫 화면에 이미 있는 패키지만** 이름으로 적는다.
//
// 목록은 소스맵으로 잰 것이다 — react-dom 174 · supabase 195 · dnd-kit 40 ·
// lucide-react 18 kB. **새 의존성을 여기 더하기 전에** 그것이 정말 첫 화면에서 쓰이는지
// 먼저 보세요(한 번도 안 쓰는 사람까지 받게 된다). `tests/drivesync`가 lazy 무거운
// 것들이 이 목록에 끼어들지 않았는지 본다.
// ============================================================================
const EAGER_VENDORS = [
  'react-dom/', 'react/', 'scheduler/',      // 화면을 그리는 것
  '@supabase/',                              // 로그인·조회·실시간 — 첫 화면부터 쓴다
  '@dnd-kit/',                               // 보드 드래그
  'lucide-react/', '@vercel/analytics/',
];
// 윈도우에서 id는 역슬래시로 온다. 정규식에 역슬래시를 박는 대신 한 글자로 갈라 잇는다
// (이 파일은 heredoc으로도 고쳐지는데 거기서 역슬래시가 먹히는 일이 있었다).
const WIN_SEP = String.fromCharCode(92);
const isEagerVendor = (id) => {
  const path = String(id).split(WIN_SEP).join('/');
  const at = path.lastIndexOf('node_modules/');
  if (at < 0) return false;
  const rest = path.slice(at + 'node_modules/'.length);
  return EAGER_VENDORS.some((name) => rest.startsWith(name));
};

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    pdfjsAssets(),
    ...(mode === 'guest' ? [] : [devApiFunctions(mode)]),
  ],
  build: {
    rollupOptions: {
      // 입구 둘 — 앱(index.html)과 주보 공개 보기(service-view.html · api/service-view.js가 받아 데이터를 끼운다).
      // 공개 보기는 supabase를 import하지 않으므로 벤더 칸(@supabase 포함)을 받더라도 붙지는 않는다.
      input: { main: resolve(process.cwd(), 'index.html'), view: resolve(process.cwd(), 'service-view.html') },
      // 이름은 `codeSplitting`이다 — 옛 이름 `advancedChunks`는 rolldown이 deprecated로
      // 표시했고(빌드 때 경고가 뜬다) **둘 다 적으면 옛 이름이 무시된다.** 걷어내는 판이
      // 오면 오류 없이 조용히 벤더 칸만 사라지고, 그러면 첫 화면이 두 배가 된다(§6-29-z-18).
      // `groups`의 모양은 그대로다 — 이름만 바뀌었다.
      output: { codeSplitting: { groups: [{ name: 'vendor', test: isEagerVendor }] } },
    },
  },
}));
