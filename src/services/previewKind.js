import { MAX_UPLOAD_BYTES } from '../config.js';

// ============================================================================
// 첨부 미리보기 종류 판정 — 순수 함수(브라우저 없이 검사한다 — tests/logcheck.mjs).
// ----------------------------------------------------------------------------
// 그리는 쪽은 components/FilePreviewModal.jsx다. 종류마다 바이트를 어느 길로 받는지
// (로컬 파일 · /api/drive-file 중계 · 서명 URL)는 그쪽 주석에 있다.
// 예전에는 이 판정이 그 파일 안에 있어서 노드에서 import가 안 됐고(JSX·React),
// 검사가 소스 문자열 단정(tests/drivesync.mjs)으로만 남아 있었다.
// ============================================================================
const OFFICE_VIEWER = true; // false = 오피스 파일도 미리보기 없이 '열기'만

export const extOf = (name = '') => (String(name).split('.').pop() || '').toLowerCase();
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
// html·htm은 여기 없다 — 글자가 아니라 **문서**로 그린다(아래 HTML_EXT).
export const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sql', 'sh'];
// HTML 첨부는 sandbox iframe으로 그린다(2026-09-05). 허용은 allow-scripts 하나뿐이고
// allow-same-origin은 함께 주지 않는다 — 왜 그렇게 갈랐는지는 FilePreviewModal의
// kind === 'html' 자리에 적어 두었다. 예전에는 TEXT_EXT에 들어 있어서 소스가 <pre>로 떴다.
const HTML_EXT = ['html', 'htm'];
export const OFFICE_EXT = ['doc', 'docx', 'ppt', 'pptx'];   // 앱이 못 그려서 구글 편집기 미리보기로 남는 것
// 우리 표로 직접 그리는 것. csv는 파싱이 몇 줄이라 같이 본다.
export const SHEET_EXT = ['xlsx', 'xls', 'csv'];
// 스프레드시트도 **우리가 받아 주는 크기면 우리가 그린다.** 예전에는 8MB에서 갈랐는데,
// 파서가 시트를 끝까지 읽고 나서 500줄로 자르던 시절의 값이다 — 그때는 6.4MB짜리가
// 3.3초 동안 탭을 멎게 했다. 지금은 500줄을 채우면 거기서 멈춘다(xlsx.js) — 같은 파일이
// 0.36초다(실측 2026-08-28, 같은 실행에서 세 번씩). 그래서 상한을 첨부 상한에 묶는다.
// 예전에는 여기 15MB가 박혀 있어서, 25MB까지 받아 놓고 19MB PDF는 드라이브의 어두운
// 파일 뷰어로 떨어뜨렸다(사용자 신고 2026-08-28 — "드라이브에 올라갔는데 왜 이쁜 뷰로
// 안 보이지"). 상한을 첨부 상한(config.MAX_UPLOAD_BYTES)에 묶어 두면 그 어긋남이 다시 안 생긴다.
export const MAX_SHEET_BYTES = MAX_UPLOAD_BYTES;

const isHtml = (mime, ext) => mime === 'text/html' || HTML_EXT.includes(ext);

export function previewKind(row) {
  const mime = row?.mime_type || '';
  const ext = extOf(row?.name);
  // 이미지는 드라이브 파일이어도 <img>로 직접 그린다 — 구글 이미지 CDN(lh3) 주소가
  // 고정이라 브라우저가 캐싱하고(서명 URL과 달리 두 번째부터는 요청이 안 나간다),
  // iframe 뷰어와 달리 사진 넘기기(이전/다음)가 된다.
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  // 엑셀·csv는 **구글이 그린 화면**을 iframe으로 띄운다(2026-08-29). 예전에는 우리가
  // 직접 표를 그렸는데, 구글이 .xlsx를 사람이 열 때 게을리 변환하는 것이 문제였고
  // 지금은 올릴 때 변환 사본을 만들어 두므로 기다릴 것이 없다(files.preview_file_id).
  if (SHEET_EXT.includes(ext) && (row?.size_bytes ?? 0) <= MAX_SHEET_BYTES) return 'sheet';
  if (row?.source === 'drive') {
    // 드라이브 파일도 형식별로 **가장 나은 뷰어**로 간다(사용자 요청) —
    //  · 오피스류(엑셀·워드·PPT·csv): 구글 전용 편집기 미리보기(driveSrc가 시간 게이트)
    //  · PDF·텍스트·HTML·영상·소리: 앱이 직접 그린다. 바이트는 /api/drive-file이 중계한다
    //    (브라우저→drive.google.com 은 CORS가 막는다). 첨부 상한이 25MB이고 중계도
    //    같은 값이라 통째로 받아도 된다 — 실측 19MB PDF가 드라이브에서 8-12초다.
    // 옛 형식(.doc·.ppt)만 구글 편집기 미리보기로 남는다 — 그건 OOXML(zip+XML)이
    // 아니라 옛 바이너리라 우리 파서가 읽을 수 없다. 스프레드시트가 어쩌다 여기로
    // 떨어지더라도 아래 'drive'(어두운 파일 뷰어) 대신 편집기 미리보기로 간다.
    if (ext === 'docx') return 'doc';
    if (ext === 'pptx') return 'slide';
    if (OFFICE_EXT.includes(ext) || SHEET_EXT.includes(ext)) return 'drive';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    // html은 text/* 보다 먼저 — 아니면 mime 'text/html'이 text로 떨어져 소스가 그대로 뜬다
    if (isHtml(mime, ext)) return 'html';
    if (mime.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text';
    if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
    if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg'].includes(ext)) return 'audio';
    return 'drive';
  }
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (isHtml(mime, ext)) return 'html';
  if (mime.startsWith('text/') || TEXT_EXT.includes(ext)) return 'text';
  // 올리는 중이어도 우리 파서는 고른 파일 그대로 읽는다 — 엑셀과 같다.
  if (ext === 'docx') return 'doc';
  if (ext === 'pptx') return 'slide';
  // 옛 형식은 오피스 뷰어뿐인데, 그건 **공개로 닿는 주소**를 넘겨야 그린다. 아직
  // 올리는 중인 파일은 주소가 없어 빈 iframe이 뜬다 — 정보와 내려받기가 정직하다.
  if (OFFICE_EXT.includes(ext) || SHEET_EXT.includes(ext)) return (OFFICE_VIEWER && row?.source !== 'local') ? 'office' : 'none';
  return 'none';
}
