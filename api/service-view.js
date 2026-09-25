import { createHmac } from 'node:crypto';
import { adminClient, readJson, requireApprovedUser, safeEqual } from './_lib.js';
import { publicService, kindLabel, coverUrl, PUBLIC_MISSING } from '../src/services/serviceView.js';
import { churchSeason } from '../src/services/churchYear.js';

// ============================================================================
// /w/:id/:sig → 주보 공개 보기 (사용자 결정 2026-09-26 — 로그인 없이 열리는 주소 · 사람 이름도 그대로, PDF와 같게)
// ----------------------------------------------------------------------------
// 업무·프로젝트 공유 주소(`/s/` · api/share.js)와 같은 결이다 — vercel.json rewrite → 이 함수 → 서비스 키로
// **필요한 칸만** 읽어 OG 메타(카카오톡 카드: 설교 제목 · 날짜 · 표지 사진/절기 색)를 붙인 HTML을 낸다.
// 다른 점: 앱으로 보내지 않고 **그 자리에서 보여 준다**(껍데기 `service-view.html` + 데이터 한 덩이 →
// src/serviceViewMain.jsx가 넘기면서 보기 여섯 장을 그린다). 브라우저는 Supabase에 붙지 않는다.
//
// **주소는 추측할 수 없다** — `sig` = HMAC-SHA256(서버 비밀에서 갈라 낸 열쇠, 주보 id)의 앞 22글자(128비트).
// 새 비밀 값·새 표 없이 api/ics.js와 같은 방식으로 SUPABASE_SECRET_KEY에서 가른다(열쇠 앞머리가 달라
// .ics 서명과 섞이지 않는다). 만료는 없다(카톡방에 올린 주소가 다음 주에 죽으면 안 된다) — 끊으려면
// 발행을 되돌리거나 서버 비밀을 바꾼다(그러면 모든 공개 주소가 같이 죽는다).
//
//   POST { s }  + Bearer → 승인 확인(공용 머리) → 발행본이면 { url: '/w/<id>/<sig>' }  (앱의 '링크로 공유')
//   GET  ?id=&sig=       → 서명·발행 확인 → 페이지 · 아니면 **404 모양의 짧은 페이지**
//
// 싣는 칸은 serviceView.publicService가 정한다(출석·메모·노트·큐시트·개인 표는 읽지도 않는다).
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 공개로 읽는 주보 칸 — 여기 없는 칸(attendance_note·cue_sheet·drive_folder_id·created_by…)은 아예 받지 않는다
const COLS = 'id, kind, service_date, status, title, passage_ref, preacher, roles, songs, notices, praise_leader, cover_focus_y';
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const viewSig = (id) => createHmac('sha256', `service-view:${process.env.SUPABASE_SECRET_KEY || ''}`)
  .update(String(id)).digest('base64url').slice(0, 22);
export const viewPath = (id) => `/w/${id}/${viewSig(id)}`;
export const sigOk = (id, sig) => UUID_RE.test(String(id || '')) && !!process.env.SUPABASE_SECRET_KEY
  && safeEqual(String(sig || ''), viewSig(id));

// 발행본 한 건 → 공개 데이터 | null. 이름 재료(명단·그 해 직분·계정 표시 이름)는 서버에서만 쓰고 넘기지 않는다.
export async function loadPublic(supabase, id) {
  const { data: svc, error } = await supabase.from('services').select(COLS).eq('id', id).maybeSingle();
  if (error) { console.error('[service-view] 주보 조회 실패:', error); return null; }
  if (!svc || svc.status !== 'published') return null;
  const year = Number(String(svc.service_date || '').slice(0, 4)) || null;
  const [coverQ, peopleQ, rolesQ] = await Promise.all([
    supabase.from('files').select('drive_file_id, created_at').eq('service_id', id).eq('kind', 'cover')
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('people').select('id, name, profile_id, is_pastor, gender'),
    year ? supabase.from('people_roles').select('person_id, role').eq('year', year) : Promise.resolve({ data: [] }),
  ]);
  for (const [what, q] of [['표지', coverQ], ['명단', peopleQ], ['직분', rolesQ]]) {
    if (q.error) console.error(`[service-view] ${what} 조회 실패:`, q.error);   // 이름·사진이 빠질 뿐 페이지는 선다
  }
  const people = peopleQ.data || [];
  // 계정이 이어진 사람은 표시 이름도 열쇠다(people.js withDisplayName과 같은 모양 — 주보에 저장된 이름이 표시 이름이다)
  const pids = [...new Set(people.map(p => p.profile_id).filter(Boolean))];
  let shown = new Map();
  if (pids.length) {
    const { data: profs, error: pe } = await supabase.from('profiles').select('id, display_name').in('id', pids);
    if (pe) console.error('[service-view] 표시 이름 조회 실패:', pe);
    shown = new Map((profs || []).map(r => [r.id, String(r.display_name || '').trim()]));
  }
  const withName = people.map(p => ({ ...p, roster_name: p.name, name: shown.get(p.profile_id) || p.name }));
  return publicService(svc, { people: withName, roles: rolesQ.data || [], cover: (coverQ.data || [])[0] || null });
}

// 카카오톡 카드 — 제목은 설교 제목(없으면 예배 이름), 설명은 날짜 · 예배, 그림은 표지 사진 → 절기 색 → 기본 톤
export function metaOf(data, origin) {
  const kind = kindLabel(data.kind);
  const [y, m, d] = String(data.service_date || '').split('-');
  const date = y ? `${Number(y)}년 ${Number(m)}월 ${Number(d)}일` : '';
  const season = churchSeason(data.service_date);
  return {
    title: data.title || kind,
    description: [date, kind].filter(Boolean).join(' · '),
    image: data.cover?.drive_file_id ? coverUrl(data.cover.drive_file_id, 1200) : `${origin}/og/season-${season?.color || 'plain'}.png`,
  };
}

// 껍데기에 제목·OG·데이터를 끼운다. 데이터는 실행되지 않는 JSON 블록이다(CSP 스크립트 해시와 무관 ·
// `<`를 이스케이프해 `</script>`로 블록이 끊기지 않게).
export function renderPage(shell, data, origin, url) {
  const m = metaOf(data, origin);
  const head = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}"/>`,
    '<meta property="og:type" content="website"/>',
    `<meta property="og:site_name" content="더다붓"/>`,
    `<meta property="og:title" content="${esc(m.title)}"/>`,
    `<meta property="og:description" content="${esc(m.description)}"/>`,
    `<meta property="og:image" content="${esc(m.image)}"/>`,
    `<meta property="og:url" content="${esc(origin + url)}"/>`,
    '<meta name="twitter:card" content="summary_large_image"/>',
    `<meta name="twitter:title" content="${esc(m.title)}"/>`,
    `<meta name="twitter:image" content="${esc(m.image)}"/>`,
    `<script type="application/json" id="service-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
  return shell.replace(/<title>[\s\S]*?<\/title>/, '').replace('<!--service-view:head-->', head);
}

export const missingPage = () => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>더다붓 주보</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f4;font-family:system-ui,sans-serif">
<p style="font-size:14px;font-weight:600;color:#615d59">${esc(PUBLIC_MISSING)}</p>
</body></html>`;

// 껍데기는 우리 정적 파일이다 — 인스턴스마다 한 번 받는다(배포가 바뀌면 인스턴스도 새로 선다)
let shellCache = null;
async function fetchShell(origin) {
  if (shellCache) return shellCache;
  const r = await fetch(`${origin}/service-view.html`);
  if (!r.ok) throw new Error(`shell ${r.status}`);
  const text = await r.text();
  if (!text.includes('<!--service-view:head-->')) throw new Error('shell marker');
  shellCache = text;
  return text;
}

// GET 한 번 — 테스트가 가짜 조회·껍데기로 그대로 부른다(tests/worship · logcheck)
export async function servePublic({ supabase, id, sig, origin, shell }) {
  if (!sigOk(id, sig)) return { status: 404, html: missingPage() };
  const data = await loadPublic(supabase, id);
  if (!data) return { status: 404, html: missingPage() };
  const text = typeof shell === 'function' ? await shell(origin) : shell;
  return { status: 200, html: renderPage(text, data, origin, viewPath(id)) };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const supabase = adminClient();
    const user = await requireApprovedUser(req, res, { supabase });
    if (!user) return;
    const s = String((await readJson(req))?.s || '');
    if (!UUID_RE.test(s)) { res.status(400).json({ error: '어느 주보인지 알 수 없어요' }); return; }
    const { data, error } = await supabase.from('services').select('id, status').eq('id', s).maybeSingle();
    if (error) { console.error('[service-view] 주보 조회 실패:', error); res.status(500).json({ error: '주보를 읽지 못했어요' }); return; }
    if (!data || data.status !== 'published') { res.status(404).json({ error: '발행된 주보만 공유할 수 있어요' }); return; }
    res.status(200).json({ url: viewPath(s) });
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }

  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  let out;
  try {
    out = await servePublic({ supabase: adminClient(), id: req.query?.id, sig: req.query?.sig, origin, shell: fetchShell });
  } catch (e) {
    console.error('[service-view] 페이지 조립 실패:', e);
    out = { status: 404, html: missingPage() };
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  // 발행본을 고치면 5분 안에 따라온다(공유 카드와 같은 값) · 404는 캐시하지 않는다(발행 직후 다시 연다)
  res.setHeader('Cache-Control', out.status === 200 ? 's-maxage=300, stale-while-revalidate=60' : 'no-store');
  res.status(out.status).send(out.html);
}
