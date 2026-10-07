// ============================================================================
// 첨부 주소 — 서명 URL 캐시(localStorage) · 썸네일 · 열기 · 내려받기 · 첨부 삭제
// ----------------------------------------------------------------------------
// 확장자 → 구글 편집기 표(getFileOpenUrl)는 utils.GOOGLE_EDITOR 한 벌이다(순수 모듈이라 supabase가 딸려 가지 않는다).
// ============================================================================
import { client, unwrap } from './core.js';
import { ATTACH_BUCKET, trashFileBodies } from './drive.js';
import { GOOGLE_EDITOR } from '../../utils.js';

// 1시간 유효 서명 URL (private 버킷이라 직접 URL 불가)
//
// **같은 파일은 같은 URL을 다시 쓴다(50분).** 매번 새로 발급하면 토큰이 달라서 주소가
// 바뀌고, 브라우저 캐시가 통째로 빗나가 같은 이미지를 열 때마다 다시 내려받았다 —
// 업무 창을 여닫을 때마다 첨부 썸네일 전체가 다시 왔다(Storage Egress의 큰 몫).
// 탭이 살아 있는 동안만 유효한 메모리 캐시라 권한 회수 걱정은 만료(1시간)와 같다.
// ── 서명 URL 캐시 ──────────────────────────────────────────────────────────
// 브라우저 캐시는 **주소가 같을 때만** 맞는다. 매번 새 토큰을 발급하면 같은 그림도
// 남남이 되어 통째로 다시 내려온다 — 느린 것도 Egress도 여기서 나왔다.
//
// 실측(2026-08-25): Storage 응답은 `cache-control: public, max-age=3600` + ETag이고
// 앞에 Cloudflare가 있다. 즉 주소만 유지되면 1시간 뒤에도 304(본문 0바이트)로 끝난다.
// 그래서 **주소를 오래 유지하는 것**이 이 캐시의 전부다.
//
// 파일 열기(미리보기·내려받기)는 1시간이면 충분하다. 썸네일은 다르다 — 목록을 열
// 때마다 보이고, 파일이 바뀌지 않으며(경로에 uuid가 박힌다), 한 장이 원본 1.5MB짜리
// 사진이다. 그래서 썸네일만 7일로 길게 서명하고 6일까지 재사용한다.
//
// 저장소는 localStorage다 — sessionStorage는 탭을 닫으면 사라져서, 다음에 열 때
// 주소가 바뀌고 캐시가 다시 빗나간다. 서명 URL은 유효기간이 지나면 스스로 죽고,
// 만료 검사도 여기서 한다.
const SIGNED_TTL_S = 3600;                       // 파일 열기
const SIGNED_REUSE_MS = 50 * 60 * 1000;
const THUMB_TTL_S = 7 * 24 * 3600;               // 썸네일(바뀌지 않는 그림)
const THUMB_REUSE_MS = 6 * 24 * 60 * 60 * 1000;
const SIGNED_STORE_KEY = 'church_signed_urls';

const signedUrlCache = new Map(); // key → { url, at, ttl }
const isThumbKey = (key) => key.startsWith('thumb:');
const reuseMsFor = (key) => (isThumbKey(key) ? THUMB_REUSE_MS : SIGNED_REUSE_MS);

try {
  const saved = JSON.parse(localStorage.getItem(SIGNED_STORE_KEY) || '{}');
  const now = Date.now();
  for (const [key, hit] of Object.entries(saved)) {
    if (hit?.url && now - hit.at < reuseMsFor(key)) signedUrlCache.set(key, hit);
  }
} catch { /* 사파리 프라이빗 등 — 캐시 없이 그냥 돈다 */ }

let signedFlush = null;
const rememberSigned = (key, url) => {
  signedUrlCache.set(key, { url, at: Date.now() });
  // 한 번에 여러 건이 들어오므로 쓰기는 한 프레임 뒤에 몰아서 한 번만.
  // 만료된 것은 이때 걷어낸다 — 안 그러면 지운 파일의 주소가 영영 쌓인다.
  clearTimeout(signedFlush);
  signedFlush = setTimeout(() => {
    const now = Date.now();
    for (const [k, v] of signedUrlCache) if (now - v.at >= reuseMsFor(k)) signedUrlCache.delete(k);
    try { localStorage.setItem(SIGNED_STORE_KEY, JSON.stringify(Object.fromEntries(signedUrlCache))); }
    catch { /* 용량 초과 등 — 메모리 캐시만으로도 동작한다 */ }
  }, 0);
};

const cachedSigned = (key) => {
  const hit = signedUrlCache.get(key);
  return hit && Date.now() - hit.at < reuseMsFor(key) ? hit.url : null;
};

// 썸네일은 **원본을 받지 않는다.** 80px 상자에 1.5MB 원본을 그리고 있었고,
// 사진 열 장짜리 업무를 LTE에서 열면 15MB가 내려와 스켈레톤이 끝나지 않았다
// (사용자 지적 — "스켈레톤이 적용이 안 된 것 같다"의 진짜 원인).
// 이 프로젝트는 Storage 이미지 변환이 켜져 있다(확인함: 9.5KB → 4.3KB).
// 200px인 이유: 화면 상자가 80px이고 고해상도 화면은 2배로 그린다.
// 변환은 서명 요청의 **본문**에 실려서 토큰에 묶이므로 묶음 발급(createSignedUrls)을
// 쓸 수 없다 — 파일마다 한 번씩 서명한다(토큰 발급뿐이라 가볍고, 동시에 보낸다).
const THUMB = { width: 200, height: 200, resize: 'cover' };

export async function getAttachmentThumbUrls(storagePaths) {
  const map = {};
  const need = [];
  for (const p of storagePaths.filter(Boolean)) {
    const hit = cachedSigned(`thumb:${p}`);
    if (hit) map[p] = hit; else need.push(p);
  }
  if (!need.length) return map;
  await Promise.all(need.map(async (p) => {
    try {
      const data = unwrap(await client().storage.from(ATTACH_BUCKET)
        .createSignedUrl(p, THUMB_TTL_S, { transform: THUMB }));
      map[p] = data.signedUrl;
      rememberSigned(`thumb:${p}`, data.signedUrl);
    } catch (e) {
      // 변환이 꺼지면(요금제 변경 등) 여기서 걸린다 — 부르는 쪽이 원본으로 되돌린다
      console.error('[cloud] 썸네일 서명 실패:', p, e);
    }
  }));
  return map;
}

async function getAttachmentUrl(storagePath) {
  const hit = cachedSigned(storagePath);
  if (hit) return hit;
  const data = unwrap(await client().storage.from(ATTACH_BUCKET).createSignedUrl(storagePath, SIGNED_TTL_S));
  rememberSigned(storagePath, data.signedUrl);
  return data.signedUrl;
}

// 파일 열기 URL — files.source로 저장소를 분기한다.
// 개인 구글 드라이브로 실체를 옮긴 뒤에는 source='drive'로 바꾸고
// drive_file_id/web_view_link만 채우면 앱 코드는 그대로 동작한다.
// 확장자 → 구글 편집기 표는 **utils.GOOGLE_EDITOR 한 벌**이다(앱 안 미리보기 주소를
// 만드는 utils.driveSrc와 같은 표). '새 탭에서 열기'가 **언제나 보기 좋은 화면**으로
// 가게 하는 값이다 — 드라이브가 내주는 web_view_link는 오피스 파일이면 이미 편집기
// 주소(docs.google.com/spreadsheets/d/…/edit)라서 그걸 그대로 쓰면 되는데, 링크가
// 비어 있을 때 파일 뷰어(drive.google.com/file/d/…/view)로 떨어지면 앱 안에서 없앤
// 바로 그 어두운 화면이 새 탭에서 다시 나온다. 그 자리를 막는다.
export async function getFileOpenUrl(row) {
  if (row.source === 'drive') {
    if (row.web_view_link) return row.web_view_link;
    if (row.drive_file_id) {
      const editor = GOOGLE_EDITOR[String(row.name || '').split('.').pop().toLowerCase()];
      return editor
        ? `https://docs.google.com/${editor}/d/${row.drive_file_id}/edit`
        : `https://drive.google.com/file/d/${row.drive_file_id}/view`;
    }
    throw new Error('드라이브 링크가 없는 파일이에요');
  }
  return getAttachmentUrl(row.storage_path);
}

// 파일 **내려받기** 주소 — '열기'(위)와 일부러 나눠 둔다. 여기서 돌려주는 주소는
// `Content-Disposition: attachment`를 달고 오는 것이어야 한다.
//
// 왜 이게 필요했나(사용자 신고 2026-09-13 · 아이폰): 예전에는 바이트를 우리가 받아
// `URL.createObjectURL` + `a.download`로 저장했다. 그런데 **홈 화면에 담은 앱(PWA)·
// 인앱 웹뷰의 iOS 사파리는 blob: 주소를 내려받지 않고 열어 버린다** — 파일 아이콘과
// "'미리보기'에서 열기 / 기타…"만 있는 페이지가 뜨고 저장이 안 된다. 반면 **머리줄에
// attachment가 달려 오는 진짜 HTTP 주소**는 사파리가 자기 내려받기로 받아 파일 앱에
// 넣는다. 그래서 blob을 만들지 않고 그 주소로 바로 보낸다.
// 덤으로 바이트가 브라우저를 두 번 지나지 않고, 드라이브 파일은 우리 대역폭이 0이다.
//
//  · 드라이브: `uc?export=download` — 공개('링크를 아는 사람은 보기') 파일이면
//    구글이 attachment로 내준다(api/drive-file.js가 서버에서 쓰는 그 주소와 같다).
//    새로 새는 정보는 없다 — '새 탭에서 열기'가 이미 같은 파일의 드라이브 주소를 준다.
//  · Storage: 서명 URL에 `download`를 주면 supabase가 attachment 머리줄을 붙여 준다.
//    (지금 남아 있는 행은 전부 source='drive'지만, 이 갈래를 지우면 옛 첨부가 막힌다.)
//  · 아직 올리는 중인 파일(source: 'local')은 주소가 없다 — 부르는 쪽이 고른 파일
//    그대로 blob으로 저장한다(자기가 방금 고른 파일이라 그 길이 맞다).
export async function getFileDownloadUrl(row) {
  if (row.source === 'drive') {
    if (!row.drive_file_id) throw new Error('드라이브 링크가 없는 파일이에요');
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(row.drive_file_id)}`;
  }
  const data = unwrap(await client().storage
    .from(ATTACH_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_TTL_S, { download: row.name || true }));
  return data.signedUrl;
}

// 복수 서명 URL 일괄 발급 → { [storagePath]: signedUrl }
// (행마다 개별 요청하면 모바일에서 요청 폭주로 느려지므로 한 번에 받는다)
// 캐시에 있는 것은 빼고 발급한다 — 위 getAttachmentUrl과 같은 이유(브라우저 캐시 유지).
export async function getAttachmentUrls(storagePaths = []) {
  const map = {};
  const need = [];
  for (const p of storagePaths.filter(Boolean)) {
    const hit = cachedSigned(p);
    if (hit) map[p] = hit; else need.push(p);
  }
  if (!need.length) return map;
  // 40개씩 나눠 보낸다 — 한 요청에 전부 실으면 그 요청이 실패할 때 그 업무의 썸네일이
  // **통째로** 죽고, 첫 장이 그려지기까지 마지막 장을 기다린다(사진이 많은 업무에서
  // 실제로 "이미지가 안 뜬다"로 보였다).
  const CHUNK = 40;
  for (let i = 0; i < need.length; i += CHUNK) {
    const slice = need.slice(i, i + CHUNK);
    const { data, error } = await client().storage.from(ATTACH_BUCKET).createSignedUrls(slice, SIGNED_TTL_S);
    if (error) {
      console.error('[cloud] 서명 URL 묶음 실패:', error);
      continue;                                   // 나머지 묶음은 계속 시도한다
    }
    (data || []).forEach(d => {
      if (d?.path && d.signedUrl) {
        map[d.path] = d.signedUrl;
        rememberSigned(d.path, d.signedUrl);
      }
    });
  }
  return map;
}

// 삭제 — **DB 행부터 지운다.** 화면의 진실은 DB다: 드라이브 휴지통 왕복(1~2초)을
// 먼저 하면, 그 사이 다른 조회(저장 직후 보기 화면의 listCardFiles)가 아직 남아 있는
// 행을 읽어 와 **지운 파일이 화면에 되살아났다**(사용자 지적 — 엑셀 지우고 저장했더니
// 그대로 있었다). 행이 먼저 사라지면 어떤 조회가 언제 다녀가도 그 파일은 없다.
// 실체 정리(드라이브 휴지통·Storage)는 그 뒤 최선으로 — 실패해도 던지지 않는다.
// 드라이브는 30일 복구가 되고(사용자 결정), 남은 실체는 소유자가 정리할 수 있다.
export async function deleteAttachment(fileRow) {
  unwrap(await client().from('files').delete().eq('id', fileRow.id));
  // 실체(Storage · 변환 사본 · 드라이브 원본)는 drive.js trashFileBodies 한 벌로 — 업무·프로젝트 삭제와 같은 정리다
  await trashFileBodies([fileRow]);
}
