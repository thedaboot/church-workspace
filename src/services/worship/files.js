// ============================================================================
// 예배 — 주보에 붙는 파일(송폼 · 큐시트 · 표지) 올리기·읽기·지우기 · 지난 큐시트로 바로 편집
// ----------------------------------------------------------------------------
// 업로드·삭제는 업무 첨부와 한 벌이다(cloud.uploadServiceFile → uploadOwnedFile · deleteAttachment · §6-29-u·29-e).
// 갈래 이름과 고르기(SONGFORM · pickLastCue …)는 pure.js에 있다.
// ============================================================================
import { supabase } from '../supabaseClient.js';
import { guestStore } from '../people.js';
import { listServiceFiles, uploadServiceFile as uploadServiceFileToDrive, ensureServiceFolder, deleteAttachment,
  setFileExcerpt, fetchDriveFileBlob, SERVICE_FILE_KINDS, OFFICE_TYPE } from '../cloud.js';
import { unwrap } from '../cloud/core.js';
import { downscaleImage, FILE_MAX_DIM, BODY_MAX_DIM } from '../image.js';
import { coverMap } from '../serviceView.js';
import { copyExportAs } from '../cueDigest.js';
import { generateId } from '../../utils.js';
import { SONGFORM, CUESHEET, COVER, cueNameFor, pickLastCue } from './pure.js';

const { rows: guestRows, set: guestSet } = guestStore('church_worship_v1');

// ── 주보에 붙는 파일 — 송폼 · 큐시트 (0047 · 갈래는 0054) ───────────────────
// 저장 자리는 업무 첨부와 **같은 files 표**다(축만 card_id → service_id로 바뀐다).
// 드라이브도 같은 길이라(cloud.uploadServiceFile → uploadOwnedFile) 3MB 갈래·멱등
// 열쇠·미리보기·내려받기·휴지통이 전부 그대로 동작한다. 여기서 가르는 것은
// 게스트/클라우드뿐이다.
//
// **갈래는 `files.kind` 한 칸이다**(0054 — 'songform' · 'cuesheet'). 사용자가 큐시트를
// 링크뿐 아니라 파일로도 붙이고 싶다고 해서(2026-09-08) 두 번째 업로드 길을 내지 않고
// 이 칸만 더했다(§6-29-u "첨부를 올리는 길은 하나"). 조회는 갈래를 안 가른다 —
// 주보 한 건의 파일을 한 번에 읽고, **화면이** kind로 갈라 세운다.
//
// **게스트 모드에는 드라이브도 Storage도 없다.** 행만 localStorage에 남기고 바이트는
// 메모리에 둔다(§6-29-k와 같은 이유 — localStorage는 문자열 5MB라 PDF 한 장도 못 담는다).
// 새로고침하면 줄은 남고 미리보기만 못 연다.
const guestBytes = new Map();   // files.id → 고른 File (게스트 세션 동안만)

export async function fetchServiceFiles(serviceId) {
  if (!supabase) {
    return guestRows('files')
      .filter(f => f.service_id === serviceId)
      .map(f => (guestBytes.has(f.id) ? { ...f, _file: guestBytes.get(f.id) } : f));
  }
  return listServiceFiles(serviceId);
}

// 드라이브 폴더는 **파일 바이트가 오가기 전에** 한 번만 확보한다(§6-29-h).
// 게스트에는 폴더가 없다 — null이면 부르는 쪽이 그냥 올린다.
export async function ensureServiceDriveFolder(service) {
  if (!supabase) return null;
  return ensureServiceFolder(service);
}

// `kind`를 안 주면 송폼이다 — 0047부터의 호출부를 그대로 두기 위해서다.
// `awaitCopy` — 구글 편집 사본이 설 때까지 기다린다(`지난 큐시트로 바로 편집`이 곧바로 편집 화면을 연다)
export async function uploadServiceFile(service, file, folderId = null, { kind = SONGFORM, awaitCopy = false } = {}) {
  const k = SERVICE_FILE_KINDS.includes(kind) ? kind : SONGFORM;   // 갈래 목록은 cloud 한 벌(송폼·큐시트·표지)
  if (!supabase) {
    const row = {
      id: generateId(), service_id: service.id, kind: k, name: file.name,
      size_bytes: file.size ?? null, mime_type: file.type || null, source: 'local',
    };
    guestBytes.set(row.id, file);
    guestSet('files', [...guestRows('files'), row]);
    return { ...row, _file: file };
  }
  // 사진으로 찍어 온 송폼도 있다 — 첨부와 같이 보내기 직전에 줄인다(§6-29-m).
  // 사진이 아니거나 이미 작으면 원본 그대로 간다.
  // 표지는 lh3에서 폭 720으로만 받는다 — 본문 이미지 상한(1600)이면 충분하고 올리는 바이트가 준다.
  const sending = await downscaleImage(file, k === COVER ? BODY_MAX_DIM : FILE_MAX_DIM, 0.9);
  const row = await uploadServiceFileToDrive(sending, {
    serviceId: service.id,
    serviceDate: service.service_date,
    serviceFolderId: folderId || service.drive_folder_id || null,
    kind: k,
    awaitCopy,
  });
  // 큐시트는 **올리는 순간** 요지를 뽑아 둔다 — 브라우저가 바이트를 이미 쥐고 있어 다운로드가
  // 없고, 순모임 가이드가 그 한 칸(files.text_excerpt)만 읽는다(services/cueDigest.js · 결정 12).
  // 기다리지 않는다 — 업무 첨부의 fillExcerpt와 같은 판단(발췌 때문에 업로드가 늦어지면 안 된다).
  if (k === CUESHEET && row?.id) void fillCueExcerpt(row, file);
  return row;
}

export async function fetchLastCuesheet(service) {
  if (!supabase || !service?.service_date) return null;   // 게스트에는 드라이브가 없다 — 버튼이 서지 않는다
  const svcs = unwrap(await supabase.from('services').select('id, service_date')
    .lt('service_date', service.service_date).order('service_date', { ascending: false }).limit(8));
  if (!svcs?.length) return null;
  const files = unwrap(await supabase.from('files')
    .select('id, service_id, kind, name, mime_type, source, drive_file_id, preview_file_id, created_at')
    .eq('kind', CUESHEET).in('service_id', svcs.map(s => s.id)));
  return pickLastCue(svcs, (files || []).filter(f => f.source === 'drive' && f.drive_file_id), service.service_date);
}
export async function lastCueFile(prev, toDate) {
  const f = prev.file;
  const as = f.preview_file_id ? copyExportAs(f.name) : null;
  const blob = await fetchDriveFileBlob(as ? f.preview_file_id : f.drive_file_id, { as });
  let name = cueNameFor(f.name, prev.service.service_date, toDate);
  if (as && !name.toLowerCase().endsWith(`.${as}`)) name = `${name.replace(/\.[^.]+$/, '')}.${as}`;
  return new File([blob], name, { type: as ? OFFICE_TYPE[as] : (f.mime_type || blob.type || '') });
}

async function fillCueExcerpt(row, file) {
  try {
    const { extractFileText } = await import('../fileText.js');
    const text = await extractFileText(file, { kind: CUESHEET });
    if (text) await setFileExcerpt(row.id, text);
  } catch (e) {
    console.warn('[worship] 큐시트 요지를 저장하지 못했다:', row?.name, e?.message || e);
  }
}

// 표지 — **목록 한 번에 한 조회**(주보마다 부르지 않는다). 읽기 정책은 첨부와 같아서(0047) 작성 중
// 주보의 표지는 편집 자격자에게만 온다. 돌려주는 모양은 { service_id: 행 }(serviceView.coverMap).
// 게스트는 바이트가 메모리에만 있으므로 이번 세션에 올린 것만 선다(새로고침하면 사진 없이).
const guestCoverSrc = new Map();   // files.id → blob 주소(게스트 · 한 번만 만든다)
export async function fetchCovers() {
  if (!supabase) {
    return coverMap(guestRows('files').filter(f => f.kind === COVER && guestBytes.has(f.id)).map((f) => {
      if (!guestCoverSrc.has(f.id)) guestCoverSrc.set(f.id, URL.createObjectURL(guestBytes.get(f.id)));
      return { ...f, _src: guestCoverSrc.get(f.id) };
    }));
  }
  const data = unwrap(await supabase.from('files')
    .select('id, service_id, kind, name, source, drive_file_id, storage_path, preview_file_id, created_at')
    .eq('kind', COVER).order('created_at', { ascending: true }));
  return coverMap(data ?? []);
}

// 지우는 길은 업무 첨부와 한 벌이다 — **DB 행부터, 실체는 그 뒤 최선으로**(§6-29-e).
export async function removeServiceFile(row) {
  if (!supabase) {
    if (guestCoverSrc.has(row.id)) { URL.revokeObjectURL(guestCoverSrc.get(row.id)); guestCoverSrc.delete(row.id); }
    guestBytes.delete(row.id);
    guestSet('files', guestRows('files').filter(f => f.id !== row.id));
    return;
  }
  return deleteAttachment(row);
}
