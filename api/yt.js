import { createClient } from '@supabase/supabase-js';

// ============================================================================
// /api/yt — 유튜브 재생목록·영상 제목 프록시.
//   요구: Authorization: Bearer <supabase access token> (getUser로 검증 — api/ai.js와 같다)
//   { listId }  → YOUTUBE_API_KEY가 있으면 Data API playlistItems(50개씩 페이지 넘김, 전체)
//                 없으면 https://www.youtube.com/feeds/videos.xml?playlist_id=<id>  (RSS, 최신 15곡)
//                 → { items: [{ title, videoId }] }
//   { videoId } → https://www.youtube.com/oembed?url=...&format=json
//                 → { title }
// ----------------------------------------------------------------------------
// 왜 서버를 거치나: 브라우저에서 바로 받으면 CORS가 막는다(RSS·oEmbed 둘 다 CORS
// 헤더가 없다). 그리고 **아무 주소나 받지 않는다** — 받는 것은 id뿐이고 정규식을
// 통과한 것만 유튜브 주소로 조립한다. 주소를 그대로 받아 그대로 fetch하면 로그인만
// 있으면 우리 서버로 남의 심부름을 시킬 수 있는 열린 프록시가 된다.
//
// 재생목록을 받는 길이 둘인 이유: 키가 있으면 Data API가 **전체**를 주고, 없으면 RSS가
// **최신 15개까지만** 준다(유튜브가 정한 상한). 키는 YOUTUBE_API_KEY 하나뿐이고 없어도
// 동작하므로, 환경변수를 안 넣은 배포·로컬에서도 화면은 그대로 돈다. 돌려주는 모양은
// 두 길이 같다({ items: [{ title, videoId }] }) — 화면·서비스 계층은 어느 쪽인지 모른다.
// ============================================================================
const TIMEOUT_MS = 8000;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

// 8초 안에 못 받으면 끊는다 — 유튜브가 늦어도 함수 예산을 다 태우지 않는다
async function getText(url) {
  const ctl = new AbortController();
  const killer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'thedabot/1.0' } });
    if (!r.ok) return { status: r.status, text: '' };
    return { status: 200, text: await r.text() };
  } finally { clearTimeout(killer); }
}

const decode = (s = '') => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// RSS <entry> 하나가 영상 하나다. 라이브러리를 붙이지 않는 이유는 우리가 읽는 칸이
// 제목과 videoId 둘뿐이고, 이 피드 모양은 유튜브가 정해 둔 고정 형식이기 때문이다.
function parseFeed(xml) {
  const out = [];
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const e of entries) {
    const videoId = (/<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e) || [])[1] || '';
    const title = (/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1] || '';
    if (VIDEO_ID.test(videoId)) out.push({ title: decode(title).trim(), videoId });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ error: '인증이 필요합니다.' }); return; }

  // 세션(access token) 검증 — 로그인 사용자만 프록시 이용
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) { res.status(401).json({ error: '유효하지 않은 세션입니다.' }); return; }

  const { listId, videoId } = await readJson(req);

  try {
    if (LIST_ID.test(String(listId || ''))) {
      const key = process.env.YOUTUBE_API_KEY;
      if (key) {
        // Data API — 비공개·삭제된 영상은 제목이 'Private video'/'Deleted video'로 오고 재생할 수 없어 뺀다.
        // ponytail: 상한 500곡(10페이지) — 예배 찬양 목록이 그 이상일 일은 없다. 할당량은 페이지당 1단위.
        const items = []; let pageToken = '';
        for (let page = 0; page < 10; page++) {
          const url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50'
            + `&playlistId=${listId}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`;
          const { status, text } = await getText(url);
          if (status === 404) { res.status(404).json({ error: '그 재생목록이 없거나 비공개예요' }); return; }
          if (status !== 200) { console.error('[yt] Data API', status, text.slice(0, 200)); res.status(502).json({ error: '유튜브가 재생목록을 주지 않았어요' }); return; }
          let data; try { data = JSON.parse(text); } catch { data = {}; }
          for (const it of data.items || []) {
            const sn = it.snippet || {}; const vid = sn.resourceId?.videoId || '';
            if (!VIDEO_ID.test(vid) || /^(Private|Deleted) video$/.test(sn.title || '')) continue;
            items.push({ title: String(sn.title || '').trim(), videoId: vid });
          }
          pageToken = data.nextPageToken || '';
          if (!pageToken) break;
        }
        if (!items.length) { res.status(404).json({ error: '그 재생목록에 영상이 한 곡도 없어요' }); return; }
        res.status(200).json({ items });
        return;
      }
      const { status, text } = await getText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${listId}`);
      if (status === 404) { res.status(404).json({ error: '그 재생목록이 없거나 비공개예요' }); return; }
      if (status !== 200) { res.status(502).json({ error: '유튜브가 재생목록을 주지 않았어요' }); return; }
      const items = parseFeed(text);
      if (!items.length) { res.status(404).json({ error: '그 재생목록에 영상이 한 곡도 없어요' }); return; }
      res.status(200).json({ items });
      return;
    }

    if (VIDEO_ID.test(String(videoId || ''))) {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const { status, text } = await getText(url);
      if (status !== 200) {
        res.status(status === 404 ? 404 : 502)
          .json({ error: status === 404 ? '그 영상이 없거나 비공개예요' : '유튜브가 제목을 주지 않았어요' });
        return;
      }
      let title = '';
      try { title = JSON.parse(text).title || ''; } catch { title = ''; }
      res.status(200).json({ title });
      return;
    }

    res.status(400).json({ error: '보낸 주소에서 재생목록을 찾지 못했어요' });
  } catch (e) {
    // AbortError(8초 초과)도 여기로 온다 — 화면에는 초 단위를 내보내지 않는다(§8).
    // 이 글은 화면에서 '왜 안 됐나' 자리에 실린다(services/worship.js의 err.human).
    console.error('[yt] 유튜브 요청 실패:', e);
    res.status(502).json({ error: '유튜브가 제때 답하지 않았어요\n잠시 후 다시 시도해주세요' });
  }
}
