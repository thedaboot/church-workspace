import { store } from '../store/workspaceStore.js';
import { supabase } from './supabaseClient.js';
import { unwrap } from './cloud/core.js';
import { guestStore } from './people.js';
import { kindLabel } from './serviceView.js';
import { buildWorkbook, XLSX_TYPE } from './xlsxWrite.js';
import { projectYear } from '../utils.js';
import { reportStatus, supportAmountOf, attachReports } from './clubReport.js';

// ============================================================================
// 연말 보고 내보내기(v5 3묶음 · 사용자 승인 시안 mock/b4 · 문구 확정 2026-10-21 · 관리자 메뉴 '연말 보고' · 마스터만)
// ----------------------------------------------------------------------------
// 엑셀 한 파일에 표 다섯 장(사용자 결정 2026-10-16: 요약·프로젝트·예배 출석·동아리·명단 변화 · **개인별 출석은 넣지 않는다**).
//   요약       항목 | 값                                    (값은 단위까지 — '3'만 두지 않는다 · 사용자 지적 2026-10-21)
//   프로젝트   프로젝트 | 업무 | 완료 | 진행 중 | 마감 지난 업무
//   예배 출석  날짜 | 예배 | 명단 출석 | 명단 외 출석 | 전체 출석   (주보마다 수만 — 누가 왔는지는 없다 · 명단 외 = attendance_guests)
//   동아리     동아리 | 동아리장 | 구성원 | 모임 | 참석 연인원 | 보고서 제출 | 지원금 | 지급 완료
//   명단 변화  이름 | 상태 | 날짜                        (새신자 · 환송)
// **새신자 = people.newcomer_at이 그해인 사람**(0119 · 사용자 결정 2026-10-21). 처음에는 '그해 명단에 새로 추가된 사람
// (첫 이관 날 제외)'으로 셌는데, 첫 이관(2026-09-01) 뒤에 들어온 셋 중 문진우·김우한은 새신자가 아니었다 — 들어온 날로는
// 못 가른다. 환송은 그대로 removed_at으로 센다.
// 읽기: gatherYear(year)가 두 모드에서 같은 모양을 모으고(클라우드는 마스터 세션 — RLS가 마스터에게 다 연다), 표는 순수 함수
// buildYearSheets가 짓는다(노드에서 검사 · tests/logcheck-v2 '연말 정산').
// ============================================================================

const worship = guestStore('church_worship_v1');
const groups = guestStore('church_groups_v1');
const roster = guestStore('church_roster_v1');
const DONE = '완료';
const inYear = (d, y) => String(d || '').startsWith(`${y}-`);
const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const kstDay = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '');

// PostgREST는 한 번에 1000줄까지 준다 — 출석·명단은 해가 갈수록 넘을 수 있어 쪽마다 받는다
async function pageAll(build, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const rows = unwrap(await build().range(from, from + size - 1)) ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// 표 다섯 장을 짓는 재료 — { projects[], tasks[], services[{service_date, kind, n, g}], clubs[], memberCount{group_id: n},
//   meetings[모임 + files + report_form + support_paid_at], leaderName(person_id), people[{name, newcomer_at, removed_at}] }
export async function gatherYear(year) {
  const today = kstToday();
  const st = store.getState();
  const projects = (st.projects?.allIds || []).map(id => st.projects.byId[id]).filter(p => p && !p.deletedAt && projectYear(p) === String(year));
  const tasks = (st.tasks?.allIds || []).map(id => st.tasks.byId[id]).filter(t => t && !t.deletedAt);
  if (!supabase) {
    const att = worship.rows('attendance');
    const gst = worship.rows('attendance_guests');
    const services = worship.rows('services').filter(s => inYear(s.service_date, year)).map(s => ({
      service_date: s.service_date, kind: s.kind,
      n: att.filter(a => a.service_id === s.id).length, g: gst.filter(a => a.service_id === s.id).length,
    }));
    const files = groups.rows('files');
    const gp = groups.rows('people');
    const memberCount = {};
    for (const m of groups.rows('group_members')) memberCount[m.group_id] = (memberCount[m.group_id] || 0) + 1;
    return {
      today, projects, tasks, services, memberCount,
      clubs: groups.rows('groups').filter(g => g.type === 'club' && !g.removed_at),
      meetings: groups.rows('group_meetings').filter(m => inYear(m.meeting_date, year) && m.meeting_date < today)
        .map(m => ({ ...m, files: files.filter(f => f.meeting_id === m.id) })),
      leaderName: (id) => gp.find(p => p.id === id)?.name || '',
      people: roster.rows('people'),
    };
  }
  const end = `${year + 1}-01-01`;
  const [svc, clubs, meetings, people] = await Promise.all([
    supabase.from('services').select('id, service_date, kind').gte('service_date', `${year}-01-01`).lt('service_date', end),
    supabase.from('groups').select('id, name, leader_person_id').eq('type', 'club').is('removed_at', null),
    supabase.from('group_meetings').select('id, group_id, meeting_date, title, attendance, files(id)')
      .gte('meeting_date', `${year}-01-01`).lt('meeting_date', today < end ? today : end),
    pageAll(() => supabase.from('people').select('id, name, newcomer_at, removed_at').order('created_at')),
  ]);
  const services = unwrap(svc) ?? [];
  const ids = services.map(s => s.id);
  const [att, gst] = ids.length ? await Promise.all([
    pageAll(() => supabase.from('attendance').select('service_id').in('service_id', ids).order('service_id')),
    pageAll(() => supabase.from('attendance_guests').select('service_id').in('service_id', ids).order('service_id')),
  ]) : [[], []];
  const clubList = unwrap(clubs) ?? [];
  const members = clubList.length
    ? unwrap(await supabase.from('group_members').select('group_id').in('group_id', clubList.map(c => c.id))) ?? [] : [];
  const memberCount = {};
  for (const m of members) memberCount[m.group_id] = (memberCount[m.group_id] || 0) + 1;
  const count = (rows) => { const o = {}; for (const r of rows) o[r.service_id] = (o[r.service_id] || 0) + 1; return o; };
  const n = count(att), g = count(gst);
  return {
    today, projects, tasks, memberCount, clubs: clubList,
    services: services.map(s => ({ service_date: s.service_date, kind: s.kind, n: n[s.id] || 0, g: g[s.id] || 0 })),
    meetings: await attachReports(unwrap(meetings) ?? []),
    leaderName: (id) => people.find(p => p.id === id)?.name || '',
    people,
  };
}

// 재료 → { sheets, summary } (순수 · summary는 화면 숫자판)
export function buildYearSheets(year, d) {
  const projRows = d.projects.map(p => {
    const ts = d.tasks.filter(t => t.projectId === p.id);
    const done = ts.filter(t => t.status === DONE).length;
    const late = ts.filter(t => t.status !== DONE && t.dueDate && t.dueDate < d.today).length;
    return [p.title, ts.length, done, ts.length - done, late];
  });
  const worshipRows = [...d.services].sort((a, b) => String(a.service_date).localeCompare(String(b.service_date)))
    .map(s => [s.service_date, kindLabel(s.kind) || s.kind || '', s.n, s.g, s.n + s.g]);
  const clubRows = d.clubs.map(c => {
    const ms = d.meetings.filter(m => m.group_id === c.id);
    const heads = ms.reduce((n, m) => n + (m.attendance || []).length, 0);
    const done = ms.filter(m => reportStatus(m) === 'done').length;
    const money = ms.reduce((n, m) => n + supportAmountOf(m), 0);
    const paid = ms.filter(m => m.support_paid_at).reduce((n, m) => n + supportAmountOf(m), 0);
    return [c.name, d.leaderName(c.leader_person_id), d.memberCount[c.id] || 0, ms.length, heads, `${done}/${ms.length}`, money, paid];
  });
  const changeRows = [
    ...d.people.filter(p => inYear(p.newcomer_at, year)).map(p => [p.name, '새신자', String(p.newcomer_at).slice(0, 10)]),
    ...d.people.filter(p => inYear(kstDay(p.removed_at), year)).map(p => [p.name, '환송', kstDay(p.removed_at)]),
  ].sort((a, b) => a[2].localeCompare(b[2]));

  const sum = (rows, i) => rows.reduce((n, r) => n + (Number(r[i]) || 0), 0);
  const avg = worshipRows.length ? Math.round(sum(worshipRows, 4) / worshipRows.length) : 0;
  const won = (n) => `${n.toLocaleString('ko-KR')}원`;
  const summary = { projects: projRows.length, tasks: sum(projRows, 1), done: sum(projRows, 2), services: worshipRows.length, avg,
    support: sum(clubRows, 6), paid: sum(clubRows, 7) };
  const summaryRows = [
    ['연도', `${year}년`],
    ['프로젝트', `${summary.projects}개`],
    ['업무', `${summary.tasks}건`],
    ['완료한 업무', `${summary.done}건`],
    ['예배', `${summary.services}번`],
    ['예배 평균 출석 인원', `${avg}명`],
    ['동아리', `${clubRows.length}곳`],
    ['동아리 모임', `${sum(clubRows, 3)}번`],
    ['동아리 지원금', won(summary.support)],
    ['지원금 지급 완료', won(summary.paid)],
    ['새신자', `${changeRows.filter(r => r[1] === '새신자').length}명`],
    ['환송', `${changeRows.filter(r => r[1] === '환송').length}명`],
  ];
  const sheets = [
    { name: '요약', rows: [['항목', '값'], ...summaryRows], widths: [22, 16], align: ['left', 'right'] },
    { name: '프로젝트', rows: [['프로젝트', '업무', '완료', '진행 중', '마감 지난 업무'], ...projRows], widths: [30, 8, 8, 9, 14], align: ['left', 'right', 'right', 'right', 'right'] },
    { name: '예배 출석', rows: [['날짜', '예배', '명단 출석', '명단 외 출석', '전체 출석'], ...worshipRows], widths: [12, 14, 11, 13, 11], align: ['left', 'left', 'right', 'right', 'right'] },
    { name: '동아리', rows: [['동아리', '동아리장', '구성원', '모임', '참석 연인원', '보고서 제출', '지원금', '지급 완료'], ...clubRows], widths: [20, 10, 8, 8, 12, 12, 12, 12], align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'] },
    { name: '명단 변화', rows: [['이름', '상태', '날짜'], ...changeRows], widths: [12, 12, 12] },
  ];
  return { sheets, summary };
}

export const yearReportFile = (year, sheets) =>
  new File([buildWorkbook(sheets)], `더다붓 ${year}년 연말 보고.xlsx`, { type: XLSX_TYPE });
