import { supabase, myUid } from './supabaseClient.js';
import { unwrap } from './cloud/core.js';
import { guestStore } from './people.js';
import { kstNow } from './worship.js';
import { demoOn } from './opsDemo.js';
import { fillClubReport, readClubReport, SUPPORT_PER_PERSON, XLSX_TYPE } from './xlsxWrite.js';
import { generateId } from '../utils.js';
import templateUrl from '../assets/club-report-template.xlsx?url';

// ============================================================================
// 동아리 활동 보고서 작성 · 제출 현황 · 지원비 (v5 3묶음 첫 묶음 · 사용자 승인 시안 mock/b4 · 0117)
// ----------------------------------------------------------------------------
// 사용자 결정 2026-10-21:
//   · 보고서의 원본은 **앱 안 작성 화면**이다(구글 편집 사본은 아이폰 사파리·카카오 인앱에서 앱 안 편집이 막혀 있고 · PITFALLS 34-h,
//     구글 계정이 없는 계정이 31개 중 13개). 저장할 때마다 양식 그대로 엑셀을 새로 만들어(services/xlsxWrite.fillClubReport)
//     그 모임의 보고서 칸(files · 0093)에 올리고 그 id를 적는다(club_reports.file_id) — 다음 저장 때 갈아 끼운다.
//     엑셀을 직접 올리는 '파일 올리기'는 그대로 둔다.
//   · 지원비는 **모임마다** 참석자 × 5,000원(양식의 '5,000원/1인') · 지급 체크도 모임마다 · 마스터 · 총무만(set_support_paid).
//   · 현황은 모임 > 동아리 탭 안(마스터 · 총무) · 상태 셋: 미제출(보고서 없음) · 작성 중(저장만) · 제출 완료('제출'을 누름).
// 저장 자리
//   클라우드(0117): club_reports(글 칸 넷 · 계좌 · 사진 경로 두 묶음 · file_id · saved/submitted) · club_support_payments ·
//     사진은 비공개 버킷 club-reports `<meeting_id>/<uuid>.jpg`. 작성 내용은 그 모임을 고칠 수 있는 사람 · 마스터 · 총무만 읽는다
//     (계좌가 있다 — 구성원에게는 0행이라 상태 칩도 안 선다). **두 표는 '없어도 되는 값'으로 읽는다**(0117 전 · 읽기 실패 = 미제출).
//   게스트: church_groups_v1의 group_meetings 행에 report_form · support_paid_at · support_paid_by(사진은 dataUrl).
// 모임 행의 모양(두 모드 같다): report_form { activity, plan, usage, account, photos[], receipts[], file_id?, saved_at, submitted_at } |
//   null · support_paid_at · support_paid_by · files[].generated(작성 화면이 만든 엑셀).
// 사진 한 장: { id, name, w, h, path?(클라우드에 올라간 것), dataUrl?(방금 고른 것 · 게스트), url?(화면용 서명 주소),
//   drive_name?(영수증만 · 드라이브 낱장의 이름 — groups.receiptPlan) }.
// ============================================================================

const { all: guestAll, rows, set } = guestStore('church_groups_v1');
const BUCKET = 'club-reports';
const REPORT_COLS = 'meeting_id, activity, plan, usage, account, photos, receipts, file_id, saved_at, submitted_at';

export const supportAmountOf = (meeting) => (Array.isArray(meeting?.attendance) ? meeting.attendance.length : 0) * SUPPORT_PER_PERSON;
export const formOf = (meeting) => meeting?.report_form || null;

// 'none' 미제출 · 'draft' 작성 중 · 'done' 제출 완료
export function reportStatus(meeting) {
  const f = formOf(meeting);
  if (f?.submitted_at) return 'done';
  if (f?.saved_at || (meeting?.files || []).length) return 'draft';
  return 'none';
}

export const canCheckSupport = (perms) => !!perms?.isMaster || !!perms?.isTreasurer;

// 작성 화면이 만든 엑셀인가(그 파일은 구글 사본으로 고치지 않는다 — 원본은 작성 화면)
export const isGenerated = (meeting, file) => !!file?.generated || (!!file?.id && file.id === formOf(meeting)?.file_id);

// 클라우드 모임 한 벌에 작성 내용 · 지급을 붙인다(groups.fetchMeetings 뒤). 못 읽으면 그대로(미제출로 보인다).
const toForm = (r) => ({ activity: r.activity || '', plan: r.plan || '', usage: r.usage || '', account: r.account || '',
  photos: r.photos || [], receipts: r.receipts || [], file_id: r.file_id || null, saved_at: r.saved_at || null, submitted_at: r.submitted_at || null });
export async function attachReports(meetings = []) {
  if (!supabase || !meetings.length) return meetings;
  const ids = meetings.map(m => m.id);
  const [rep, pay] = await Promise.all([
    supabase.from('club_reports').select(REPORT_COLS).in('meeting_id', ids),
    supabase.from('club_support_payments').select('meeting_id, paid_at, paid_by').in('meeting_id', ids),
  ]);
  if (rep.error) console.warn('[report] 보고서 작성 내용을 읽지 못했어요(0117 전이면 그대로):', rep.error.message);
  if (pay.error) console.warn('[report] 지원비 지급을 읽지 못했어요:', pay.error.message);
  const byRep = new Map((rep.data || []).map(r => [r.meeting_id, r]));
  const byPay = new Map((pay.data || []).map(r => [r.meeting_id, r]));
  return meetings.map(m => {
    const r = byRep.get(m.id);
    const p = byPay.get(m.id);
    return { ...m, report_form: r ? toForm(r) : null, support_paid_at: p?.paid_at || null, support_paid_by: p?.paid_by || null,
      files: (m.files || []).map(f => (r?.file_id && f.id === r.file_id ? { ...f, generated: true } : f)) };
  });
}

// ── 사진 ────────────────────────────────────────────────────────────────────
const PHOTO_MAX = 1280;
const loadImage = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
// 고른 사진 → 긴 변 1280px jpeg(0.82) dataUrl + 크기. EXIF 회전을 반영한다(createImageBitmap from-image).
export async function photoOf(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await loadImage(URL.createObjectURL(file)); }
  const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { id: generateId(), name: file.name || '사진', dataUrl: c.toDataURL('image/jpeg', 0.82), w, h };
}
const bytesOf = (dataUrl) => {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
// 화면용 — 올라간 사진에 서명 주소(10분)를 붙인다(비공개 버킷 · 작성 화면이 열릴 때)
export async function withPhotoUrls(list = []) {
  const paths = list.filter(p => p.path && !p.dataUrl && !p.url).map(p => p.path);
  if (!supabase || !paths.length) return list;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  if (error) { console.warn('[report] 사진 주소를 받지 못했어요:', error.message); return list; }
  const url = new Map((data || []).map(d => [d.path, d.signedUrl]));
  return list.map(p => (p.path && url.get(p.path) ? { ...p, url: url.get(p.path) } : p));
}
async function photoBytes(p) {
  if (p.dataUrl) return bytesOf(p.dataUrl);
  if (!supabase || !p.path) throw new Error('사진을 찾지 못했어요');
  const blob = unwrap(await supabase.storage.from(BUCKET).download(p.path));
  return new Uint8Array(await blob.arrayBuffer());
}

// ── 엑셀 만들기 ──────────────────────────────────────────────────────────────
let templateBytes = null;
const template = async () => {
  if (!templateBytes) templateBytes = new Uint8Array(await (await fetch(templateUrl)).arrayBuffer());
  return templateBytes;
};
export const reportFileName = (club, meeting) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(meeting?.meeting_date || ''));
  return `${String(club?.name || '동아리').trim()} 활동보고서(${m ? `${+m[1]}월 ${+m[2]}일` : ''}).xlsx`;
};
export async function renderReportFile(club, meeting, people, form) {
  const nameOf = new Map((people || []).map(p => [p.id, p.name]));
  const names = (meeting.attendance || []).map(id => nameOf.get(id)).filter(Boolean);
  const pics = (list) => Promise.all((list || []).map(async p => ({ bytes: await photoBytes(p), ext: 'jpg', w: p.w, h: p.h })));
  const bytes = await fillClubReport(await template(), {
    club: club?.name || '', date: meeting.meeting_date, attendees: names,
    activity: form.activity, plan: form.plan, usage: form.usage, account: form.account,
    amount: supportAmountOf(meeting), photos: await pics(form.photos), receipts: await pics(form.receipts),
  });
  return new File([bytes], reportFileName(club, meeting), { type: XLSX_TYPE });
}

// 저장(submit=false) · 제출(submit=true) — 작성 내용을 두고 양식 그대로의 엑셀을 만들어 돌려준다.
// 올리기는 부르는 쪽이 보고서 칸의 올리기 길(uploadQueue — 진행 막대·멈춤·다시 시도)로 보낸다. 다 올라간 뒤 markGenerated로
// 적고, 앞에 만든 엑셀은 그 뒤에 걷는다(새 것이 못 올라가면 옛 것이 남는다).
// 클라우드: 새 사진을 버킷에 올리고 → club_reports upsert(file_id는 건드리지 않는다) → 빠진 사진을 버킷에서 지운다(최선).
const keepPhoto = ({ id, name, w, h, path, drive_name }) => ({ id, name, w, h, path, drive_name });
// 영수증 낱장(groups.receiptPlan) — 드라이브에 올릴 jpg 파일
export const receiptFile = async (p) => new File([await photoBytes(p)], p.drive_name, { type: 'image/jpeg' });
export async function prepareReportForm(club, meeting, people, draft, { submit = false } = {}) {
  const form = await saveReportForm(meeting, draft, { submit });
  const file = await renderReportFile(club, meeting, people, form);
  return { form, file };
}
// 작성 내용만 둔다(엑셀은 만들지 않는다) — 저장·제출과 올린 엑셀 읽어 채우기(importReportForm)가 같이 쓴다
async function saveReportForm(meeting, draft, { submit = false } = {}) {
  const now = new Date().toISOString();
  const prev = formOf(meeting) || {};
  const base = { activity: '', plan: '', usage: '', account: '', photos: [], receipts: [], ...draft };
  if (!supabase) {
    const form = { ...base, saved_at: now, submitted_at: submit ? now : (prev.submitted_at || null) };
    set('group_meetings', rows('group_meetings').map(m => (m.id === meeting.id ? { ...m, report_form: form } : m)));
    return form;
  }
  const up = async (p) => {
    if (p.path) return p;
    const path = `${meeting.id}/${generateId()}.jpg`;
    unwrap(await supabase.storage.from(BUCKET).upload(path, new Blob([bytesOf(p.dataUrl)], { type: 'image/jpeg' }), { contentType: 'image/jpeg', upsert: false }));
    return { ...p, path };
  };
  const photos = await Promise.all(base.photos.map(up));
  const receipts = await Promise.all(base.receipts.map(up));
  const uid = await myUid();
  const submittedAt = submit ? now : (prev.submitted_at || null);
  unwrap(await supabase.from('club_reports').upsert({
    meeting_id: meeting.id, activity: base.activity, plan: base.plan, usage: base.usage, account: base.account,
    photos: photos.map(keepPhoto), receipts: receipts.map(keepPhoto),
    saved_at: now, saved_by: uid, submitted_at: submittedAt, ...(submit ? { submitted_by: uid } : {}), updated_at: now,
  }, { onConflict: 'meeting_id' }));
  const kept = new Set([...photos, ...receipts].map(p => p.path));
  const gone = [...(prev.photos || []), ...(prev.receipts || [])].map(p => p.path).filter(p => p && !kept.has(p));
  if (gone.length) supabase.storage.from(BUCKET).remove(gone).catch(e => console.warn('[report] 뺀 사진을 지우지 못했어요:', e));
  return { ...base, photos, receipts, file_id: prev.file_id || null, saved_at: now, submitted_at: submittedAt };
}

// 올린 엑셀로 작성 화면 채우기(사용자 요청 2026-10-22 — 총무가 지난 보고서를 올린다) — 작성 내용이 없는 모임에만.
// 칸 넷과 그림을 읽어(xlsxWrite.readClubReport) **제출 완료**로 두고, 올린 그 엑셀을 이 보고서의 파일로 적는다(file_id —
// 다음 저장 때 작성 화면이 만든 엑셀로 갈아 끼운다 · 서부버튼 9/12를 손으로 옮긴 것과 같은 모양). 보고서 양식이 아니면 null.
// 영수증 이름(drive_name)은 부르는 쪽이 붙인다(groups.nameReceipts).
export async function readReportDraft(file) {
  const read = await readClubReport(await file.arrayBuffer());
  if (!read) return null;
  const pics = (list) => Promise.all(list.map((p, i) => photoOf(new File([p.bytes], `그림 ${i + 1}.${p.ext}`, { type: `image/${p.ext === 'jpg' ? 'jpeg' : p.ext}` }))
    .catch(e => { console.warn('[report] 엑셀 안 그림을 읽지 못했어요:', e); return null; })));
  return { activity: read.activity, plan: read.plan, usage: read.usage, account: read.account,
    photos: (await pics(read.photos)).filter(Boolean), receipts: (await pics(read.receipts)).filter(Boolean) };
}
export async function importReportForm(meeting, draft, fileId) {
  const form = await saveReportForm(meeting, draft, { submit: true });
  await markGenerated(meeting.id, fileId);
  return { ...form, file_id: fileId };
}
export async function markGenerated(meetingId, fileId) {
  if (!supabase) { set('files', rows('files').map(f => (f.id === fileId ? { ...f, generated: true } : f))); return; }
  unwrap(await supabase.from('club_reports').update({ file_id: fileId }).eq('meeting_id', meetingId));
}

// 지급 체크 — 마스터 · 총무만(DB가 판정 · 42501). byName은 게스트 시연의 표시용.
export async function setSupportPaid(meetingId, on, byName = '') {
  if (!supabase) {
    set('group_meetings', rows('group_meetings').map(m => (m.id === meetingId
      ? { ...m, support_paid_at: on ? new Date().toISOString() : null, support_paid_by: on ? byName : null } : m)));
    return;
  }
  unwrap(await supabase.rpc('set_support_paid', { p_meeting: meetingId, p_paid: !!on }));
}

// 현황 — 그 해의 지난 모임 전부(최근 모임이 위). 행: { club, meeting, status, amount, paidAt, paidBy }
// paidBy — 게스트는 이름, 클라우드는 계정 id(화면이 이름으로 바꾼다)
const boardRows = (clubs, meetings) => {
  const byClub = new Map(clubs.map(c => [c.id, c]));
  return meetings.filter(m => byClub.has(m.group_id))
    .map(meeting => ({ club: byClub.get(meeting.group_id), meeting, status: reportStatus(meeting), amount: supportAmountOf(meeting),
      paidAt: meeting.support_paid_at || null, paidBy: meeting.support_paid_by || null }))
    .sort((a, b) => String(b.meeting.meeting_date).localeCompare(String(a.meeting.meeting_date)));
};
export async function fetchReportBoard(year = Number(kstNow().slice(0, 4))) {
  const today = kstNow().slice(0, 10);
  const inYear = (d) => String(d).startsWith(`${year}-`) && d < today;
  if (!supabase) {
    const files = rows('files');
    const clubs = rows('groups').filter(g => g.type === 'club' && !g.removed_at);
    const meetings = rows('group_meetings').filter(m => inYear(m.meeting_date)).map(m => ({ ...m, files: files.filter(f => f.meeting_id === m.id) }));
    return boardRows(clubs, meetings);
  }
  const [clubs, meetings] = await Promise.all([
    supabase.from('groups').select('id, name, position').eq('type', 'club').is('removed_at', null),
    supabase.from('group_meetings').select('id, group_id, meeting_date, title, attendance, files(id)')
      .gte('meeting_date', `${year}-01-01`).lt('meeting_date', today < `${year + 1}-01-01` ? today : `${year + 1}-01-01`),
  ]);
  return boardRows(unwrap(clubs) ?? [], await attachReports(unwrap(meetings) ?? []));
}


// ── 시연 씨앗(미리보기 빌드 · 처음 여는 브라우저) ──────────────────────────────
// 동아리 셋 · 사람 열넷 · 모임마다 출석. 상태가 셋 다 보이게: 제출 완료(지급 완료 · 미지급) · 작성 중 · 미제출.
const day = (offset) => {
  const t = new Date(`${kstNow().slice(0, 10)}T00:00:00Z`).getTime() + offset * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};
const PEOPLE = ['노준석', '조해리', '김승찬', '박지호', '강도윤', '이서준', '윤다은', '정민경', '천진영', '이하빈', '서우현', '한지민', '최유나', '김윤주'];
// `?demo=clubs`면 지금 저장을 덮고 처음부터 다시 심는다(시연을 처음으로 · 자동화 브라우저 화면 확인)
export function ensureClubDemo() {
  if (!demoOn() || typeof window === 'undefined') return;
  let force = false;
  try { force = new URLSearchParams(window.location.search).get('demo') === 'clubs'; } catch { /* 옛 브라우저 */ }
  if (!force) {
    if (navigator.webdriver) return;
    try { if (localStorage.getItem('church_groups_v1')) return; } catch { return; }
  }
  const pid = (i) => `cd-p${i}`;
  const people = PEOPLE.map((name, i) => ({ id: pid(i), name, birthday: null, teams: [], gender: null, is_pastor: false, profile_id: null, removed_at: null }));
  const clubs = [
    { id: 'cd-c1', type: 'club', name: '더다북 📖', year: null, leader_person_id: pid(0), note: '한 달에 두 번 함께 책을 읽어요', position: 0, removed_at: null },
    { id: 'cd-c2', type: 'club', name: '더다붓 러닝', year: null, leader_person_id: pid(3), note: '토요일 아침 한강 5km', position: 1, removed_at: null },
    { id: 'cd-c3', type: 'club', name: '사진 동아리', year: null, leader_person_id: pid(4), note: '', position: 2, removed_at: null },
  ];
  const memberOf = { 'cd-c1': [0, 1, 2, 5, 6, 7], 'cd-c2': [3, 8, 9, 10, 11], 'cd-c3': [4, 12, 13, 1] };
  const group_members = Object.entries(memberOf).flatMap(([g, ids]) => ids.map(i => ({ group_id: g, person_id: pid(i) })));
  const M = (id, g, offset, title, att, extra = {}) => ({ id, group_id: g, meeting_date: day(offset), title, attendance: att.map(pid), note: null, drive_folder_id: null, created_at: new Date().toISOString(), ...extra });
  const done = (saved, paid) => ({
    report_form: { activity: '로마서 8장을 함께 읽고 서로 받은 은혜를 나눴어요.', plan: '다음 모임은 로마서 9~10장', usage: '모임 간식(빵·음료)', account: '카카오뱅크 3333-01-0000000 노준석', photos: [], receipts: [],
      saved_at: saved, submitted_at: saved },
    ...(paid ? { support_paid_at: saved, support_paid_by: '조해리' } : {}),
  });
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const meetings = [
    M('cd-m1', 'cd-c1', -40, '정기 모임', [0, 1, 2, 5, 6], done(ago(38), true)),
    M('cd-m2', 'cd-c1', -26, '정기 모임', [0, 1, 2, 6], done(ago(24), false)),
    M('cd-m3', 'cd-c1', -12, '정기 모임', [0, 2, 5, 6, 7], { report_form: { activity: '로마서 11장', plan: '', usage: '', account: '', photos: [], receipts: [], saved_at: ago(11), submitted_at: null } }),
    M('cd-m4', 'cd-c1', 5, '정기 모임', []),
    M('cd-m5', 'cd-c2', -30, '한강 러닝', [3, 8, 9, 10]),
    M('cd-m6', 'cd-c2', -9, '한강 러닝', [3, 9, 10, 11], done(ago(8), false)),
    M('cd-m7', 'cd-c3', -20, '가을 출사', [4, 12, 13]),
  ];
  const data = { people, groups: clubs, group_members, group_meetings: meetings, files: [], people_roles: [], club_applications: [],
    me: { isMaster: true, personId: pid(0), roles: ['treasurer'] } };
  try { localStorage.setItem('church_groups_v1', JSON.stringify({ ...guestAll(), ...data })); } catch { /* 저장소가 막힌 브라우저 */ }
  // 주소의 표식은 한 번만 — 새로 고칠 때마다 시연이 처음으로 돌아가지 않게(인수인계 시연과 같다)
  if (force) try { const u = new URL(window.location.href); u.searchParams.delete('demo'); window.history.replaceState(window.history.state, '', u); } catch { /* 위와 같다 */ }
}
