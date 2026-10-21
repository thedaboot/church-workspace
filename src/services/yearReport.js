import { store } from '../store/workspaceStore.js';
import { guestStore } from './people.js';
import { kindLabel } from './serviceView.js';
import { buildWorkbook, XLSX_TYPE } from './xlsxWrite.js';
import { projectYear } from '../utils.js';
import { reportStatus, supportAmountOf } from './clubReport.js';

// ============================================================================
// 연말 보고 내보내기(v5 3묶음 · **시안 mock/b4 · 게스트 시연 자료로** · 관리자 메뉴 '연말 보고' · 마스터만)
// ----------------------------------------------------------------------------
// 엑셀 한 파일에 표 다섯 장(사용자 결정 2026-10-16: 요약·프로젝트·예배 출석·동아리·명단 변화 · **개인별 출석은 넣지 않는다**).
//   요약       항목 | 값
//   프로젝트   프로젝트 | 업무 | 완료 | 진행 중 | 마감 지난 업무
//   예배 출석  날짜 | 예배 | 명단 출석 | 명단 외 출석 | 전체 출석   (주보마다 — 누가 왔는지는 없다)
//   동아리     동아리 | 동아리장 | 구성원 | 모임 | 참석 연인원 | 보고서 제출 | 지원금 | 지급 완료
//   명단 변화  이름 | 상태 | 날짜                        (그 해 청년 명단에 새로 든 새신자 · 환송)
// 실제로 붙일 때: 클라우드는 마스터 세션으로 같은 표를 읽는다(RLS가 마스터에게 다 연다) — 서버 함수는 필요 없다.
// ============================================================================

const worship = guestStore('church_worship_v1');
const groups = guestStore('church_groups_v1');
const roster = guestStore('church_roster_v1');
const DONE = '완료';
const inYear = (d, y) => String(d || '').startsWith(`${y}-`);

// 화면 타일이 쓰는 숫자(yearReportSheets가 마지막에 센 값)
export const summaryOf = { last: null };

export function yearReportSheets(year) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  // 프로젝트 — 그 해 프로젝트(연도 칸 · 없으면 만든 날)
  const st = store.getState();
  const projects = (st.projects?.allIds || []).map(id => st.projects.byId[id]).filter(p => p && !p.deletedAt && projectYear(p) === String(year));
  const tasks = (st.tasks?.allIds || []).map(id => st.tasks.byId[id]).filter(t => t && !t.deletedAt);
  const projRows = projects.map(p => {
    const ts = tasks.filter(t => t.projectId === p.id);
    const done = ts.filter(t => t.status === DONE).length;
    const late = ts.filter(t => t.status !== DONE && t.dueDate && t.dueDate < today).length;
    return [p.title, ts.length, done, ts.length - done, late];
  });

  // 예배 출석 — 주보마다 수만
  const services = worship.rows('services').filter(s => inYear(s.service_date, year))
    .sort((a, b) => String(a.service_date).localeCompare(String(b.service_date)));
  const att = worship.rows('attendance');
  const guests = worship.rows('attendance_guests');
  const worshipRows = services.map(s => {
    const n = att.filter(a => a.service_id === s.id).length;
    const g = guests.filter(a => a.service_id === s.id).length;
    return [s.service_date, kindLabel(s.kind) || s.kind || '', n, g, n + g];
  });

  // 동아리 — 그 해 모임 · 보고서 · 지원금
  const clubs = groups.rows('groups').filter(g => g.type === 'club' && !g.removed_at);
  const people = groups.rows('people');
  const nameOf = (id) => people.find(p => p.id === id)?.name || '';
  const meetings = groups.rows('group_meetings').filter(m => inYear(m.meeting_date, year) && m.meeting_date < today);
  const files = groups.rows('files');
  const clubRows = clubs.map(c => {
    const ms = meetings.filter(m => m.group_id === c.id).map(m => ({ ...m, files: files.filter(f => f.meeting_id === m.id) }));
    const heads = ms.reduce((n, m) => n + (m.attendance || []).length, 0);
    const done = ms.filter(m => reportStatus(m) === 'done').length;
    const money = ms.reduce((n, m) => n + supportAmountOf(m), 0);
    const paid = ms.filter(m => m.support_paid_at).reduce((n, m) => n + supportAmountOf(m), 0);
    return [c.name, nameOf(c.leader_person_id), groups.rows('group_members').filter(x => x.group_id === c.id).length, ms.length, heads, `${done}/${ms.length}`, money, paid];
  });

  // 명단 변화 — 그 해에 새로 등록한 사람 · 환송한 사람
  const everyone = roster.rows('people');
  const changeRows = [
    ...everyone.filter(p => inYear(p.created_at, year)).map(p => [p.name, '새신자', String(p.created_at).slice(0, 10)]),
    ...everyone.filter(p => inYear(p.removed_at, year)).map(p => [p.name, '환송', String(p.removed_at).slice(0, 10)]),
  ].sort((a, b) => a[2].localeCompare(b[2]));

  const sum = (rows, i) => rows.reduce((n, r) => n + (Number(r[i]) || 0), 0);
  const avg = worshipRows.length ? Math.round(sum(worshipRows, 4) / worshipRows.length) : 0;
  const won = (n) => `${n.toLocaleString('ko-KR')}원`;
  // 요약 값은 단위까지 적는다(사용자 지적 2026-10-21 — 숫자만 두지 않는다). 화면 타일은 summaryOf.last로 숫자를 따로 받는다.
  const summary = [
    ['연도', `${year}년`],
    ['프로젝트', `${projRows.length}개`],
    ['업무', `${sum(projRows, 1)}건`],
    ['완료한 업무', `${sum(projRows, 2)}건`],
    ['예배', `${worshipRows.length}번`],
    ['예배 평균 출석 인원', `${avg}명`],
    ['동아리', `${clubRows.length}곳`],
    ['동아리 모임', `${sum(clubRows, 3)}번`],
    ['동아리 지원금', won(sum(clubRows, 6))],
    ['지원금 지급 완료', won(sum(clubRows, 7))],
    ['새신자', `${changeRows.filter(r => r[1] === '새신자').length}명`],
    ['환송', `${changeRows.filter(r => r[1] === '환송').length}명`],
  ];
  summaryOf.last = { projects: projRows.length, tasks: sum(projRows, 1), done: sum(projRows, 2), services: worshipRows.length, avg,
    support: sum(clubRows, 6), paid: sum(clubRows, 7) };
  return [
    { name: '요약', rows: [['항목', '값'], ...summary], widths: [22, 16], align: ['left', 'right'] },
    { name: '프로젝트', rows: [['프로젝트', '업무', '완료', '진행 중', '마감 지난 업무'], ...projRows], widths: [30, 8, 8, 9, 14], align: ['left', 'right', 'right', 'right', 'right'] },
    { name: '예배 출석', rows: [['날짜', '예배', '명단 출석', '명단 외 출석', '전체 출석'], ...worshipRows], widths: [12, 14, 11, 13, 11], align: ['left', 'left', 'right', 'right', 'right'] },
    { name: '동아리', rows: [['동아리', '동아리장', '구성원', '모임', '참석 연인원', '보고서 제출', '지원금', '지급 완료'], ...clubRows], widths: [20, 10, 8, 8, 12, 12, 12, 12], align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'] },
    { name: '명단 변화', rows: [['이름', '상태', '날짜'], ...changeRows], widths: [12, 12, 12] },
  ];
}

export const yearReportFile = (year, sheets = yearReportSheets(year)) =>
  new File([buildWorkbook(sheets)], `더다붓 ${year}년 연말 보고.xlsx`, { type: XLSX_TYPE });
