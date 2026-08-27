// ============================================================================
// 올리기 전에 사진 줄이기 — 본문 이미지와 첨부가 같이 쓴다.
// ----------------------------------------------------------------------------
// 왜 첨부에도 쓰나: 드라이브로 가는 길은 브라우저 → Vercel 함수 → Apps Script인데,
// **첫 구간이 쓰는 사람의 업로드 회선**이고 그 시간이 함수 실행 시간에 그대로 들어간다.
// Hobby 플랜의 함수 상한은 60초라 더 늘릴 수 없다 — 그러면 남은 길은 **보내는 바이트를
// 줄이는 것**뿐이다. 폰 사진 한 장이 4032×3024·4MB인데 긴 변 2560px로 줄이면 1MB 아래로
// 내려간다(화면에서 차이가 안 보인다). base64가 4/3을 더 붙이므로 효과는 그만큼 더 크다.
//
// 원본이 꼭 필요한 파일(인쇄용 등)은 이 줄이기가 손해다. 그래서 **사진만, 그리고 실제로
// 작아질 때만** 건드린다. gif는 줄이면 애니메이션이 죽어서 손대지 않는다.
// 실패하면 조용히 원본을 돌려준다 — 줄이지 못하는 것이 못 올리는 것보다 낫다.
// ============================================================================

// 본문 이미지: 화면 표시용이라 작게. 그 카드를 여는 모두가 매번 내려받는다.
export const BODY_MAX_DIM = 1600;
// 첨부: 원본에 가까운 쪽. 2560px면 레티나 화면에도 충분하고 확대해서 볼 수도 있다.
export const FILE_MAX_DIM = 2560;

export async function downscaleImage(file, maxDim = BODY_MAX_DIM, quality = 0.82) {
  if (!(file?.type || '').startsWith('image/') || file.type === 'image/gif') return file;
  try {
    // imageOrientation: EXIF 회전을 반영해서 그린다 — 안 하면 세로로 찍은 폰 사진이
    // 눕는다(캔버스는 EXIF를 스스로 보지 않는다).
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = maxDim / Math.max(bmp.width, bmp.height);
    if (scale >= 1) { bmp.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    // 줄였는데 더 커지는 경우가 있다(작은 png 등) — 그러면 원본이 맞다
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${(file.name || 'image').replace(/\.[^.]+$/, '')}.jpg`,
      { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
