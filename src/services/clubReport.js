import { guestStore } from './people.js';
import { kstNow } from './worship.js';
import { demoOn } from './opsDemo.js';
import { fillClubReport, SUPPORT_PER_PERSON, XLSX_TYPE } from './xlsxWrite.js';
import templateUrl from '../assets/club-report-template.xlsx?url';

// ============================================================================
// 동아리 활동 보고서 작성 · 제출 현황 · 지원비 (v5 3묶음 · **시안 mock/b4 · 게스트 시연만**)
// ----------------------------------------------------------------------------
// 사용자 결정 2026-10-21:
//   · 보고서의 원본은 **앱의 작성 화면**이다(구글 편집 사본은 폰·카카오 인앱에서 못 고치고, 구글 계정이 없는 계정이 13/31).
//     저장할 때마다 양식 그대로 엑셀을 새로 만들어 그 모임의 보고서 칸을 덮는다(services/xlsxWrite.fillClubReport).
//     엑셀을 직접 올리는 '파일 올리기'는 그대로 둔다.
//   · 지원비는 **모임마다** 참석자 × 5,000원(양식의 '5,000원/1인') · 지급 체크도 모임마다(마스터 · 총무).
//   · 현황은 모임 > 동아리 탭 안(마스터 · 총무만) · 상태 셋: 미제출(보고서 없음) · 작성 중(저장만) · 제출 완료('제출'을 누름).
// 저장 자리(게스트): church_groups_v1의 group_meetings 행에 report_form · support_paid_at · support_paid_by.
//   사진은 줄인 jpeg를 dataUrl로(시연이라 localStorage — 실제로 붙일 때는 0117 표 + 드라이브).
// 실제로 붙일 때(승인 뒤): 0117 — club_reports(모임마다 한 줄 · 글 칸 넷 · 계좌 · saved_at · submitted_at) ·
//   사진은 files(meeting_id · kind 'report_photo'·'report_receipt') · 지원비 support_paid_at/by(총무·마스터만 · 트리거).
// ============================================================================

const { all: guestAll, rows, set } = guestStore('church_groups_v1');

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
  return { id: `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: file.name || '사진', dataUrl: c.toDataURL('image/jpeg', 0.82), w, h };
}
const bytesOf = (dataUrl) => {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

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
  const pics = (list) => (list || []).map(p => ({ bytes: bytesOf(p.dataUrl), ext: 'jpg', w: p.w, h: p.h }));
  const bytes = await fillClubReport(await template(), {
    club: club?.name || '', date: meeting.meeting_date, attendees: names,
    activity: form.activity, plan: form.plan, usage: form.usage, account: form.account,
    amount: supportAmountOf(meeting), photos: pics(form.photos), receipts: pics(form.receipts),
  });
  return new File([bytes], reportFileName(club, meeting), { type: XLSX_TYPE });
}

// 저장(submit=false) · 제출(submit=true) — 작성 내용을 모임 행에 두고 양식 그대로의 엑셀을 만들어 돌려준다.
// 올리기는 부르는 쪽이 보고서 칸의 올리기 길(uploadQueue — 진행 막대·멈춤·다시 시도)로 보낸다. 다 올라간 뒤 markGenerated로
// 표시하고, 앞에 만든 엑셀은 그 뒤에 걷는다(새 것이 못 올라가면 옛 것이 남는다).
export async function prepareReportForm(club, meeting, people, draft, { submit = false } = {}) {
  const now = new Date().toISOString();
  const prev = formOf(meeting) || {};
  const form = { activity: '', plan: '', usage: '', account: '', photos: [], receipts: [], ...draft,
    saved_at: now, submitted_at: submit ? now : (prev.submitted_at || null) };
  const file = await renderReportFile(club, meeting, people, form);
  set('group_meetings', rows('group_meetings').map(m => (m.id === meeting.id ? { ...m, report_form: form } : m)));
  return { form, file };
}
export function markGenerated(fileId) {
  set('files', rows('files').map(f => (f.id === fileId ? { ...f, generated: true } : f)));
}

// 제출 취소(동아리장이 다시 고치려 할 때 — 현황이 '작성 중'으로 돌아간다)
export function unsubmitReport(meetingId) {
  set('group_meetings', rows('group_meetings').map(m => (m.id === meetingId && m.report_form
    ? { ...m, report_form: { ...m.report_form, submitted_at: null } } : m)));
}

export function setSupportPaid(meetingId, on, byName = '') {
  set('group_meetings', rows('group_meetings').map(m => (m.id === meetingId
    ? { ...m, support_paid_at: on ? new Date().toISOString() : null, support_paid_by: on ? byName : null } : m)));
}

// 현황 — 그 해의 지난 모임 전부(동아리 순서 · 최근 모임이 위). 행: { club, meeting, status, amount, paidAt, paidBy, files }
export function fetchReportBoard(year = Number(kstNow().slice(0, 4))) {
  const today = kstNow().slice(0, 10);
  const clubs = rows('groups').filter(g => g.type === 'club' && !g.removed_at);
  const files = rows('files');
  const byClub = new Map(clubs.map(c => [c.id, c]));
  return rows('group_meetings')
    .filter(m => byClub.has(m.group_id) && String(m.meeting_date).startsWith(`${year}-`) && m.meeting_date < today)
    .map(m => {
      const meeting = { ...m, files: files.filter(f => f.meeting_id === m.id) };
      return { club: byClub.get(m.group_id), meeting, status: reportStatus(meeting), amount: supportAmountOf(meeting),
        paidAt: m.support_paid_at || null, paidBy: m.support_paid_by || null };
    })
    .sort((a, b) => String(b.meeting.meeting_date).localeCompare(String(a.meeting.meeting_date)));
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
