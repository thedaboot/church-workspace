import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { readJson, requireApprovedUser } from './_lib.js';
import { cleanTitle } from '../src/services/titleText.js';
import { isYoutube, linkUrlProblem, isPrivateAddress, pageTitle } from '../src/services/linkTitle.js';

// ============================================================================
// /api/link-title — 참고 링크 이름 받기(2026-10-15 · UX 다듬기 2차 C10 · PITFALLS 60).
//   요구: Authorization: Bearer <supabase access token> · **승인된 사람만**(_lib.js — drive·yt와 같다)
//   { url } → { title } — 못 받으면 title은 빈 글이고, 이름 짓기(도메인 · 경로 한 토막)는 앱이 한다(services/linkTitle.fallbackTitle)
//   유튜브   oEmbed(영상·재생목록 둘 다 · 키 없음) — api/yt.js의 영상 제목과 같은 길이지만 그쪽은 영상 id만 받는다
//   그 밖    페이지를 받아 <title>(구글 문서·시트·슬라이드·설문지는 꼬리를 떼고, 로그인 화면이면 빈 값)
// ----------------------------------------------------------------------------
// **아무 주소나 받으러 가는 자리라 SSRF를 막는 것이 이 파일의 절반이다.**
//   ① 주소 글자 — http/https · 기본 포트 · 계정 정보 없음 · localhost·.internal·사설 IP 글자 아님(linkUrlProblem)
//   ② 연결할 IP — 소켓의 lookup에서 DNS 답을 다시 본다(isPrivateAddress). 공개 이름이 사설 IP로 풀리면(재바인딩 포함)
//      연결 자체를 하지 않는다. fetch는 lookup을 갈아 끼울 수 없어서 node:http(s)로 받는다.
//   ③ 넘겨주기(3xx)는 우리가 따라간다 — 세 번까지, 매번 ①②를 다시.
//   ④ 4초 · 512KB(풀린 뒤 2MB)에서 끊는다 — 제목은 머리에 있다. 응답은 제목 글자만 돌려준다(몸통을 중계하지 않는다).
// ============================================================================
const TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_HOPS = 3;

// 연결 직전 DNS 답을 본다 — 하나라도 안쪽 주소면 막는다(옵션 all의 두 모양을 다 받는다 · Node 20의 autoSelectFamily)
export function guardedLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    const addrs = Array.isArray(list) ? list : [];
    if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    }
    if (opts.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

function decode(buf, enc) {
  const opts = { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 2 * 1024 * 1024 };
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf, opts);
    if (enc === 'deflate') return zlib.inflateSync(buf, opts);
    if (enc === 'br') return zlib.brotliDecompressSync(buf, { finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH, maxOutputLength: opts.maxOutputLength });
  } catch { return Buffer.alloc(0); }
  return buf;
}

// 글자 집합 — 머리줄 charset · 없으면 <meta charset>(국내 옛 사이트는 euc-kr이 남아 있다)
function textOf(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const cs = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

function getOnce(url, signal) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, {
      lookup: guardedLookup, signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; thedabot/1.0; +link-title)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'ko,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, (res) => {
      const { statusCode: status, headers } = res;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, headers, body: Buffer.alloc(0) }); return; }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        chunks.push(c); size += c.length;
        if (size >= MAX_BYTES) { res.destroy(); finish(); }
      });
      let done = false;
      const finish = () => { if (done) return; done = true; resolve({ status, headers, body: Buffer.concat(chunks).subarray(0, MAX_BYTES) }); };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', () => finish());
    });
    req.on('error', reject);
  });
}

export async function titleOfPage(start, signal) {
  let url = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (linkUrlProblem(url)) return '';
    const r = await getOnce(url, signal);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      url = new URL(r.headers.location, url).href;
      continue;
    }
    if (r.status !== 200) return '';
    if (!/html|xml/i.test(String(r.headers['content-type'] || 'text/html'))) return '';
    const html = textOf(decode(r.body, String(r.headers['content-encoding'] || '').toLowerCase()), r.headers['content-type']);
    return cleanTitle(pageTitle(html, url));
  }
  return '';
}

async function titleOfYoutube(url, signal) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal, headers: { 'User-Agent': 'thedabot/1.0' } });
  if (!r.ok) return '';
  const out = await r.json().catch(() => ({}));
  return cleanTitle(out?.title || '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!(await requireApprovedUser(req, res))) return;
  const { url } = await readJson(req);
  const why = linkUrlProblem(url);
  // 막은 이유는 로그에만 — 화면은 이름을 짓는 것으로 끝난다(앱이 fallbackTitle)
  if (why) { console.warn('[link-title] 받지 않는 주소:', why); res.status(400).json({ title: '' }); return; }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const title = isYoutube(url) ? await titleOfYoutube(url, signal) : await titleOfPage(new URL(url).href, signal);
    res.status(200).json({ title });
  } catch (e) {
    console.warn('[link-title] 제목을 못 받았다:', e?.code || e?.name || e);
    res.status(200).json({ title: '' });
  }
}
