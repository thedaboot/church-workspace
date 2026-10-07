// ============================================================================
// 예배 — 우리 서버 함수를 부르는 셋: 유튜브 가져오기(api/yt) · 광고 → 내 달력(api/ics) · 주보 공개 보기 주소(api/service-view)
// ----------------------------------------------------------------------------
// 로그인 토큰을 붙여 보내는 것은 cloud.authedPost 한 벌이다. 이유 글(err.human)은 여기서 만든다.
// ============================================================================
import { supabase } from '../supabaseClient.js';
import { authedPost } from '../cloud/core.js';
import { cleanTitle } from '../titleText.js';
import { youtubeListId, youtubeVideoId, youtubeWatchUrl } from './pure.js';

// ── 유튜브 가져오기 (서버 함수 경유) ───────────────────────────────────────
// 재생목록은 RSS로, 영상 제목은 oEmbed로 받는다. 둘 다 api/yt.js가 대신 받아 온다 —
// 브라우저에서 바로 부르면 CORS가 막고, 나중에 키를 쓰는 길로 가더라도 서버만 바뀐다.
// **게스트·로컬 vite에는 /api/yt가 없다**(404) — 그때는 토스트 한 줄로 끝낸다.
//
// **왜 안 됐는지를 원인마다 다르게 말한다**(사용자 지시 2026-09-03: '지금은 가져올 수
// 없어요'로는 무엇을 하면 되는지 알 수 없다). 여기서 만드는 글은 **뒷도막(이유)** 이고
// 앞도막('재생목록을 가져오지 못했어요')은 부르는 화면이 붙인다 — failText가 그 둘을
// 잇는다(errorText.js의 err.human 경로).
//
// `quiet`는 '콘솔에 오류로 남길 일이 아니다'는 뜻이다 — 서버 함수가 없는 환경
// (게스트·로컬 vite)이나 주소를 잘못 붙인 경우가 그렇다. 고장이 아니라 환경이거나
// 사람이 고칠 수 있는 일이라 화면의 토스트 한 줄로 끝난다. 서버가 실제로 실패한
// 경우만 console.error로 남긴다(cloud.js가 501을 notConfigured로 가르는 것과 같은 취지).
const WHY_GUEST = '게스트 모드에서는 유튜브에 닿을 수 없어요';
const WHY_DEPLOY = '배포된 앱에서만 되는 기능이에요';
const WHY_LOGIN = '로그인이 풀렸어요\n새로고침하고 다시 로그인해주세요';
const WHY_NOT_LIST = '붙인 주소가 유튜브 재생목록 링크가 아니에요';

const cantErr = (why, quiet = false) => {
  const e = new Error('yt');
  e.human = why;
  if (quiet) e.quiet = true;
  return e;
};

// 이 파일의 셋(유튜브 · 달력 · 공개 링크)이 같이 지나는 길. 토큰이 없으면 보내지 않고 '로그인이 풀렸어요'.
// 게스트 갈래는 자리마다 달라서(유튜브는 던지고 · 달력·공개 링크는 null) 부르는 쪽이 먼저 본다.
// `done(out)` — 성공으로 칠 몸통인가(주소를 받는 둘은 url이 있어야 한다).
async function askServer(path, body, fallback, done = () => true) {
  const r = await authedPost(path, body, { noToken: () => { throw cantErr(WHY_LOGIN, true); } });
  const out = await r.json().catch(() => ({}));
  if (r.ok && done(out)) return out;
  // 서버가 한국어로 이유를 주면 그것을 그대로 싣는다. 이유가 없는 404는 함수 자체가
  // 없는 것이고(로컬 vite), 401은 세션이 끊긴 것이라 우리가 이유를 만든다.
  if (r.status === 401) throw cantErr(WHY_LOGIN, true);
  if (r.status === 404 && !out.error) throw cantErr(WHY_DEPLOY, true);
  throw cantErr(out.error || fallback);
}

async function ytFetch(body) {
  if (!supabase) throw cantErr(WHY_GUEST, true);
  return askServer('/api/yt', body, '유튜브가 응답하지 않았어요\n잠시 후 다시 시도해주세요');
}

// 재생목록 주소 → [{ title, link }]. 곡 목록에 그대로 붙일 모양으로 돌려준다.
//
// **제목은 언제나 cleanTitle을 거친다**(services/titleText.js). 서버(api/yt.js)도 같은
// 함수를 거치지만 여기서 한 번 더 접는 이유는, 배포된 서버가 앱보다 낡을 수 있어서다 —
// 정규화가 서버에만 있으면 옛 서버가 도는 동안 굵은 제목이 그대로 들어온다.
export async function fetchPlaylistSongs(url) {
  const listId = youtubeListId(url);
  if (!listId) throw cantErr(WHY_NOT_LIST, true);
  const { items = [] } = await ytFetch({ listId });
  return items.filter(v => v?.videoId).map(v => ({ title: cleanTitle(v.title), link: youtubeWatchUrl(v.videoId) }));
}

// 영상 주소 → 제목. 제목 칸이 비어 있을 때만 쓴다(적어 둔 제목을 덮지 않는다).
export async function fetchVideoTitle(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) return '';
  const { title = '' } = await ytFetch({ videoId });
  return cleanTitle(title);
}

// ── 광고 → 내 달력 (api/ics.js · 2026-09-25) ────────────────────────────────
// .ics는 **브라우저가 주소를 직접 여는 것**이라(아이폰 Safari가 캘린더 '추가' 화면을 띄우는 길)
// 요청에 Authorization 머리를 실을 수 없다. 접근 토큰을 주소에 싣지도 않는다 — 방문 기록·서버
// 로그에 남는다. 그래서 두 걸음이다: ① 로그인한 채로 POST하면 서버가 승인을 보고 **10분짜리
// 서명 주소**를 준다 ② 그 주소를 연다(서버가 서명·만료를 보고, 같은 파서로 광고를 다시 읽는다).
// 게스트에는 서버가 없다 — 부르는 쪽이 blob으로 대신한다.
export async function noticeIcsUrl(serviceId, index) {
  if (!supabase) return null;
  return (await askServer('/api/ics', { s: serviceId, n: index }, '일정을 만들지 못했어요\n잠시 후 다시 시도해주세요', out => !!out.url)).url;
}

// 주보 공개 보기 주소(사용자 결정 2026-09-26 · api/service-view.js) — 로그인한 승인 멤버가 발행본에 대해 받는다.
// 서명은 서버 비밀로만 만들 수 있어 서버에 묻는다(한 주보에 한 주소 — 부르는 쪽이 주보마다 한 번 쥔다).
// 게스트는 서버가 없다 → null(버튼을 세우지 않는다). 돌려주는 것은 경로(`/w/<id>/<sig>`)다.
export async function publicServiceUrl(serviceId) {
  if (!supabase) return null;
  return (await askServer('/api/service-view', { s: serviceId }, '링크를 만들지 못했어요\n잠시 후 다시 시도해주세요', out => !!out.url)).url;
}