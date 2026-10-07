import React, { lazy, Suspense, useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { teamColor, teamBgColor } from '../config.js';
import { datedTasks } from '../utils.js';
import { isOngoing, isRunning, progressOf } from '../services/taskCounts.js';
import { Avatar } from '../components/Avatar.jsx';
import { store, useStore } from '../store/workspaceStore.js';
import { selectProjectsMap, selectTasksList } from '../store/selectors.js';
import { ISO_TODAY, daysLeft, Bar, personLoad } from './dashboardParts.jsx';
import { dueLabelOf, teamCountsOf, teamChipsOf, TeamFilterBar } from './viewParts.jsx';
import { Board } from '../components/boards.jsx';
import { CalendarBoard } from '../components/calendar.jsx';
import { MyCalendarButton } from '../components/calendarFeed.jsx';
import { useAuth } from '../services/auth.jsx';
import { isMyUid } from '../services/supabaseClient.js';
import * as cloudSync from '../services/cloudSync.js';
import { ShareButton } from '../components/ShareButton.jsx';
import { docEmbedKind } from '../components/DocEmbed.jsx';
import { makeViewPw } from '../services/viewPw.js';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { PinnedLinkChip, LinkAddPopover } from '../components/links.jsx';
import { Segmented } from '../components/segmented.jsx';
import { showToast } from '../components/Toast.jsx';
import { failText } from '../services/errorText.js';

// ── 프로젝트 화면 ─────────────────────────────────────────────────────────
// 헤더(제목 · 메타 줄 · 참고 링크 · 공유·삭제 · 새 업무) + 보기 전환(보드 · 캘린더 · 그래프) + 팀 칩.
// 보던 프로젝트가 사라지면(삭제 · 잘못된 딥링크) 대시보드로 되돌린다 — 그 가드는 **모든 훅 아래**다.

// 선후관계 그래프는 그 보기로 바꿀 때만 받는다(2026-09-24)
const DepGraph = lazy(() => import('../components/depgraph.jsx').then(m => ({ default: m.DepGraph })));
const VIEW_MODES = [['kanban', '보드'], ['calendar', '캘린더'], ['graph', '그래프']];

// 모바일 프로젝트 화면의 접히는 조작은 팀 필터 하나뿐이다(→ TeamFilterBar).
// '⋯' 메뉴와 그 안의 팀 필터 팝오버는 없앴다 — 공유·삭제·참고 링크를 메타 줄에
// 그대로 두는 쪽이 숨겨진 메뉴보다 찾기 쉬웠다.

// NewTaskButton은 지웠다 — 아무도 부르지 않는 죽은 코드였고, 실제 '새 업무' 버튼과
// 다른 스타일(bg-fg 반전)이라 남겨두면 어느 쪽이 기준인지 헷갈린다. 지금 쓰는 것은
// ProjectView 헤더 안의 accent 채움 버튼 하나뿐이다.

// viewMode(보드/캘린더)는 App이 들고 있다 — 프로젝트를 옮기면 이 컴포넌트가 리마운트되므로
// 여기서 state로 두면 캘린더를 보다가 다른 프로젝트로 넘어갈 때마다 보드로 되돌아갔다.
export const ProjectView = React.memo(function ProjectView({ projectId, onTaskClick, onStatusChange, onReorder, onNewTask, onNavigate, onRenameProject, viewMode, setViewMode }) {
  const projectsMap = useStore(selectProjectsMap);
  const tasksList = useStore(selectTasksList);
  const { enabled, session, isAdmin } = useAuth();
  const cloudOn = enabled && !!session;
  // 참고 링크에 비밀번호를 걸 수 있는 사람을 가르는 데만 쓴다(만든 사람 + 관리자).
  const myId = session?.user?.id || null;
  // 특정 프로젝트의 Task만 필터링 (해당 View 내부에서만 필요한 연산)
  const projectTasks = useMemo(() => tasksList.filter(t => t.projectId === projectId), [tasksList, projectId]);
  const project = projectsMap[projectId];

  const [selectedTeams, setSelectedTeams] = useState([]);

  // 리소스 추가 팝오버: 바깥 클릭 / Escape 닫기
  //
  // **팝오버 본체도 '안'으로 세어야 한다.** 본체는 createPortal로 body에 나가 있어서
  // 앵커 span의 자손이 아니다. 앵커만 보면 팝오버 안을 누르는 것이 '바깥'으로 잡히고,
  // mousedown에서 팝오버가 언마운트되니 그 뒤의 click이 사라진 '추가' 버튼에 닿지
  // 않는다 → 참고 링크가 한 건도 저장되지 않았다(URL 칸을 누르는 순간부터 닫혔다).
  // ConfirmPopover가 같은 함정을 이미 이렇게 고쳐 두었다.

  const toggleTeam = (team) => setSelectedTeams(prev => prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]);
  const filteredTasks = useMemo(() => selectedTeams.length === 0 ? projectTasks : projectTasks.filter(task => task.teams.some(t => selectedTeams.includes(t))), [projectTasks, selectedTeams]);

  // 없는 프로젝트(잘못된 ?p= 딥링크 / 다른 사람이 방금 삭제)일 때 그냥 null을 돌려주면
  // 내비만 남고 본문이 빈 화면이 됐다. 대시보드로 되돌린다.
  // ponytail: 토스트는 띄우지 않는다 — 직접 삭제한 사람에게도 같이 떠서 "못 찾았다"는
  // 엉뚱한 안내가 된다. 화면이 대시보드로 돌아가는 것으로 충분하다.
  useEffect(() => { if (!project) onNavigate?.('dashboard'); }, [project, onNavigate]);

  const cloudErr = (what) => (err) => { console.error(`[cloud] ${what}:`, cloudSync.formatCloudError(err), err); showToast(failText(what, err)); };

  // 주소 다듬기·팝오버 여닫기는 부품이 한다(components/links.jsx) — 여기는 저장만.
  const saveLink = (newLink) => {
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: [...(project.pinnedLinks || []), newLink] } });
    if (cloudOn) cloudSync.linkAddCloud({ projectId: project.id }, newLink).catch(cloudErr('참고 링크를 추가하지 못했어요'));
  };
  const removeLink = (linkId) => {
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id, pinnedLinks: (project.pinnedLinks || []).filter(l => l.id !== linkId) } });
    if (cloudOn) cloudSync.linkRemoveCloud(linkId).catch(cloudErr('참고 링크를 지우지 못했어요'));
  };
  // 참고 링크의 화면 가림용 비밀번호(0053). 빈 값이면 푼다.
  // **낙관적으로 먼저 바꾸지 않는다** — 잠금은 걸렸는지 아닌지가 곧 화면의 사실이라,
  // 저장이 실패했는데 자물쇠만 붙어 있으면 그게 거짓말이다(첨부의 PasswordSetter와 같은 순서).
  // 클라우드에서는 서버가 돌려준 행의 두 칸을 그대로 쓰고(해시는 서버 왕복에서 만들어진다),
  // 게스트는 저장 자리가 localStorage 한 벌뿐이라 여기서 바로 만든다.
  const setLinkPw = async (link, pw) => {
    const patch = cloudOn ? await cloudSync.linkSetPasswordCloud(link.id, pw) : await makeViewPw(pw);
    store.dispatch({ type: 'UPDATE_PROJECT', payload: { id: project.id,
      pinnedLinks: (project.pinnedLinks || []).map(l => (l.id === link.id
        ? { ...l, view_pw: patch?.view_pw ?? null, view_pw_salt: patch?.view_pw_salt ?? null }
        : l)) } });
  };

  const deleteProject = () => {
    store.dispatch({ type: 'DELETE_PROJECT', payload: project.id });
    if (cloudOn) cloudSync.projectDeleteCloud(project.id).catch(cloudErr('프로젝트를 삭제하지 못했어요'));
    onNavigate?.('dashboard');
  };

  // 업무가 있는 팀만 칩으로 — 0건 팀을 늘어놓으면 줄만 길어진다.
  // **숫자는 지금 보기가 보여줄 수 있는 것만 센다.** 달력에는 마감 미정이 얹히지 않으므로
  // 전부를 세면 `웰컴팀 7`이라 해놓고 띠는 3개만 뜬다(사용자 지적 2026-08-29).
  // 보드·그래프는 마감이 없어도 다 그리므로 그때는 전부가 맞다.
  const countable = useMemo(
    () => (viewMode === 'calendar' ? datedTasks(projectTasks) : projectTasks),
    [projectTasks, viewMode]);
  const teamCounts = useMemo(() => teamCountsOf(countable), [countable]);
  const teamChips = useMemo(() => teamChipsOf(teamCounts), [teamCounts]);
  // 헤더 메타 줄에 쓰는 값들 — 목록을 세 번 훑는 셈이라, 보드를 끌 때마다 다시 돌지
  // 않게 묶어 둔다(드래그 중에는 이 컴포넌트가 프레임마다 다시 그려진다).
  // 이 프로젝트에 누가 붙어 있나 — 대시보드의 '청년별 남은 업무'와 같은 함수다.
  // 끝난 업무의 담당자는 세지 않는다: '붙어 있다'는 지금 맡고 있다는 뜻이고, 프로젝트를
  // 다 끝내면 아무도 안 남는 것이 맞다(빈 자리는 다른 것으로 채우지 않는다).
  const { people, doneCount, progressTotal, projectMeta } = useMemo(() => {
    const { done, total } = progressOf(projectTasks);
    // 가장 가까운 마감은 돌아가는 일에서만(대시보드 '프로젝트 진행'과 같은 셈)
    const openDues = projectTasks.filter(t => t.dueDate && isRunning(t)).map(t => t.dueDate).sort();
    const dd = openDues[0] ? daysLeft(openDues[0], ISO_TODAY()) : null;
    return {
      people: personLoad(projectTasks),
      doneCount: done,
      progressTotal: total,
      projectMeta: [`${projectTasks.length}건`, `완료 ${done}건`, dueLabelOf(dd)].join(' · '),
    };
  }, [projectTasks]);
  // 달력에는 상시가 얹히지 않는다(날짜가 없는 것이 상시의 모양이다 · 옛 행에 날짜가 남아 있어도)
  const calendarTasks = useMemo(() => filteredTasks.filter(t => !isOngoing(t)), [filteredTasks]);
  // 내 달력(0085)은 팀 필터와 상관없이 이 프로젝트 업무 전부에서 고른다 · 게스트에는 서버가 없어 세우지 않는다.
  // 요소를 묶어 둔다 — 렌더마다 새로 만들면 CalendarBoard(memo)가 매번 다시 그려진다.
  const feedButton = useMemo(() => (cloudOn ? <MyCalendarButton projectId={projectId} tasks={projectTasks} /> : null),
    [cloudOn, projectId, projectTasks]);

  // 없는 프로젝트면 여기서 멈춘다 — **모든 훅 아래**여야 한다(2026-10-07 · 사용자 승인). 예전에는 이 줄이
  // 훅들(useMemo) 위에 있어서, 보던 프로젝트가 지워지면 훅 수가 줄어 'Rendered fewer hooks'로 ErrorBoundary가
  // 떴고 위의 대시보드 되돌리기 효과도 돌지 못했다. 위 훅들은 projectTasks만 보므로 project가 없어도 안전하다.
  if (!project) return null;

  const shareBtn = <ShareButton url={`${window.location.origin}/s/p/${project.id}`} what="프로젝트" />;
  // 삭제는 전원에게 연다(사용자 결정 2026-08-24, RLS도 0021에서 같이 열었다).
  // 확인 팝오버는 그대로 — 프로젝트 삭제는 안의 업무까지 사라지는 되돌릴 수 없는 일이다.
  const deleteBtn = (
    <ConfirmPopover message="프로젝트와 안의 모든 업무가 삭제돼요. 되돌릴 수 없어요." onConfirm={deleteProject}>
      <button type="button" className="p-1.5 rounded-md text-fg-faint hover:text-tag-red-fg hover:bg-surface-hover transition active:scale-95 shrink-0" title="프로젝트 삭제"><Trash2 size={16} /></button>
    </ConfirmPopover>
  );

  return (
    <div className="dc-screen h-full flex flex-col min-w-0">
      {/* ── 헤더: 제목 + 메타(건수·완료·D-day) + 링크 / 우측은 '새 업무'만 ── */}
      {/* 예전에는 이 줄에 flex-wrap이 걸려 있어서, 참고 링크를 하나 달면 메타 줄이
          길어지고 '새 업무'가 아래로 떨어져 혼자 한 줄을 차지했다(모바일에서 특히
          어색했다 — 제목은 상단바에 있으니 왼쪽에 메타 줄만 남는다). 지금은 감싸지
          않고, 좁으면 메타 줄이 가로로 밀린다. */}
      {/* 모바일은 위 줄에 '새 업무'가 붙어야 하므로 items-start(제목이 없으니 첫 줄이
          값 줄이다). 데스크톱은 제목이 위에 있어서 예전처럼 아래(메타 줄)에 맞춘다. */}
      {/* 모바일은 2×2 그리드다. flex로 두면 왼쪽 칸이 '새 업무' 버튼 **왼쪽에서** 끝나고,
          아래 줄(링크 + 공유·삭제)도 그 칸 안이라 공유·삭제가 화면 오른쪽에 못 붙고
          버튼 아래 어딘가에 떠 있었다. 그리드로 두면 아래 줄이 두 칸을 걸쳐 화면
          오른쪽 끝까지 간다. 데스크톱은 md:flex로 예전처럼 한 줄이다. */}
      {/* items-center: 아래 줄에서 링크 글자(17px)와 아이콘 버튼(24px)은 높이가 달라서, 칸을
          위로 붙이면(items-start) 가운데선이 3~4px 어긋난다. 위 줄은 값 줄 min-h가 버튼 높이와
          같아서 가운데 정렬이 아무것도 바꾸지 않는다. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-[6px] md:flex md:items-end md:justify-between md:gap-4 pb-3" style={{ borderBottom: '1px solid var(--app-line)' }}>
        {/* 모바일에서는 감싸개를 지워 안쪽 줄이 직접 그리드 칸이 되게 한다(§6-3 — 반응형으로
            구조가 달라져도 컴포넌트를 두 벌 두지 않는다) */}
        <div className="contents md:block md:min-w-0 md:flex-1">
          {/* 모바일은 상단바에 같은 제목(과 수정 연필)이 이미 있다 — 한 줄을 두 번 쓰지 않는다 */}
          <button onClick={() => onRenameProject?.(project)} className="group/title hidden md:inline-flex items-baseline gap-1.5 mb-[5px] text-left" title="프로젝트 이름 수정">
            <span className="text-[19px] md:text-[23px] font-extrabold text-fg" style={{ letterSpacing: '-0.7px' }}>{project.title}</span>
            <Pencil size={12} className="text-fg-faint pointer-fine:md:opacity-0 md:group-hover/title:opacity-100 transition-opacity shrink-0" />
          </button>
          {/* 개수가 변하는 것(참고 링크)과 하나로 고정된 것(공유·삭제)을 같은 스크롤 칸에
              두면, 링크가 늘 때마다 삭제가 화면 밖으로 밀려난다. 밀어야 나오는 삭제는
              '기능을 숨기지 않는다'(§7)를 가로 스크롤로 어기는 것이다.
              그래서 링크는 미는 칸 **안**, 공유·삭제는 그 칸 **밖**에 둔다.
              모바일은 두 줄(값+새 업무 / 링크+액션), 데스크톱은 md:contents로 감싸개를
              지워서 예전처럼 한 줄로 흐른다. */}
          <div className="contents md:flex md:flex-row md:items-center md:gap-[7px]">
            {/* min-h는 '새 업무' 버튼 높이 — 모바일에서 값 줄이 버튼 가운데에 맞게 */}
            <div className="flex items-center gap-2.5 min-w-0 min-h-[34px] md:min-h-0 md:gap-[7px] md:flex-none">
              {/* truncate(+min-w-0): 이 줄에서 **양보할 수 있는 것은 글자뿐**이다. nowrap만 걸어
                  두면 flex 항목의 최소 폭이 글자 폭으로 굳어서, 320px에 담당자 얼굴까지 서면
                  얼굴이 '새 업무' 버튼 밑으로 파고들었다(실측). 좁으면 '103일 지남'의 꼬리를
                  잃는 쪽이, 사람 얼굴이 버튼에 겹치는 것보다 낫다. */}
              <span className="text-[11px] text-fg-muted tabular-nums whitespace-nowrap truncate min-w-0">{projectMeta}</span>
              {/* 값만 있는 줄이 비어 보여서 진척 바로 채운다 — 대시보드가 쓰는 부품 그대로 */}
              <span className="flex-1 max-w-[130px] min-w-[36px] md:w-14 md:flex-none">
                <Bar ratio={progressTotal ? doneCount / progressTotal : 0} color="var(--p-blue)" height={3} />
              </span>
              {/* 담당자 얼굴. 값·바 다음에 두는 이유: `완료 5건`과 진척 바는 같은 사실이라
                  둘 사이를 다른 것으로 가르지 않는다.
                  이름 글자를 쓰지 않는 것은 카드와 같은 판단이다 — 같은 11px 글자를 늘어
                  놓으면 메타 값과 구분이 안 되고, 원형은 한눈에 '사람'으로 읽힌다.
                  ponytail: 4명까지만 그리고 나머지는 `+N`. 다 그리면 사람이 늘 때마다
                  375px에서 진척 바가 먼저 눌린다. 이름을 다 보여줄 자리가 필요해지면
                  누르면 열리는 목록으로 올리세요(hover로만 나오게 두면 §8 위반입니다). */}
              {people.length > 0 && (
                <span className="flex items-center shrink-0" title={people.map(p => `${p.name} ${p.left}건`).join(' · ')}>
                  {/* ring: 겹친 원끼리 붙어 보이지 않게 페이지 바탕색으로 테두리를 준다.
                      래퍼로 감싸면 안 된다 — Avatar가 자기 래퍼의 첫 자식이 되어
                      first:ml-0이 전부에 걸리고 겹침이 사라진다. */}
                  {people.slice(0, 4).map(p => (
                    <Avatar key={p.name} name={p.name}
                      className="flex w-[18px] h-[18px] text-[9px] -ml-[5px] first:ml-0 ring-[1.5px] ring-canvas" />
                  ))}
                  {people.length > 4 && (
                    <span className="ml-[5px] text-[10.5px] text-fg-muted tabular-nums">+{people.length - 4}</span>
                  )}
                </span>
              )}
            </div>
            {/* 감싸개를 지워 링크 줄과 액션이 각각 그리드 칸이 된다 — 링크는 왼쪽 칸(값 줄
                아래), 액션은 오른쪽 칸('새 업무' 버튼 아래). 아래 줄을 두 칸에 걸치면
                (col-span-2) 액션이 자기 자리를 못 잡아서 공유 왼쪽 실선이 버튼 왼쪽 선보다
                21px 오른쪽에 섰다. 같은 칸에 두면 실선이 버튼 폭에 저절로 맞는다. */}
            <div className="contents">
          {/* 왼쪽 칸 = 미는 칸(링크들) + 제자리인 '+ 참고 링크'.
              전에는 '+ 참고 링크'도 미는 칸 안이라 링크가 세 개쯤 되면 **점선 버튼이 반쯤
              잘렸다** — 잘린 글자는 "오른쪽에 더 있다"는 신호로 읽히지만, 잘린 점선 상자는
              깨진 것처럼 보인다. 그리고 밀어야 나오는 버튼은 §8(기능을 숨기지 않는다)에 걸린다.
              칸 폭은 내용만큼만 잡되(flex-initial) 좁으면 줄어들어 링크가 스크롤된다 —
              flex-1로 두면 링크가 없을 때도 칸이 늘어나 '+ 참고 링크'가 오른쪽으로 날아간다. */}
          <div className="flex items-center gap-[7px] min-w-0 md:contents">
          <div className="flex items-center gap-[7px] flex-nowrap min-w-0 overflow-x-auto scrollbar-hide x-scroll-lock md:flex-none md:flex-wrap md:overflow-x-visible">
            {project.pinnedLinks?.map(l => (
              <PinnedLinkChip
                key={l.id} link={l}
                // 비밀번호를 걸 수 있는 자리는 **앱 안에서 여는 링크**에만, 만든 사람과 관리자에게만.
                // 새 탭으로 나가는 링크에 걸면 아무것도 막지 못한다(위 PinnedLinkChip 주석).
                canLock={!!docEmbedKind(l.url) && (isAdmin || isMyUid(l.created_by, myId))}
                onRemove={() => removeLink(l.id)}
                onSetPw={(pw) => setLinkPw(l, pw)}
              />
            ))}
          </div>
            <LinkAddPopover onAdd={saveLink} />
          </div>
              {/* 스크롤 칸 밖. 링크가 몇 개든 제자리다. 왼쪽 실선이 "여기가 끝"을 알려
                  준다 — 미는 줄에서 끝을 못 보면 뭐가 더 있는지 짐작할 수 없다.
                  모바일에서 이 span은 '새 업무' 버튼과 같은 그리드 칸이라 칸 폭까지 늘어난다.
                  실선·공유·삭제를 한 덩이로 묶어 그 칸의 **가운데**에 둔다(justify-center) —
                  아이콘 묶음(56px)이 버튼(80px)보다 좁아서 한쪽 선에 붙이면 반대쪽에 구멍이
                  생긴다. 실선을 칸의 테두리(border-l)로 두면 실선만 왼쪽 선에 남고 아이콘은
                  멀찍이 떨어져 보였다 — 그래서 실선도 안쪽 요소로 넣어 아이콘과 같이 움직인다. */}
              {/* -mr-2: 가운데를 잡을 때 마지막 아이콘의 오른쪽 여백 8px(p-1.5 + lucide가 16px
                  박스 안에서 비우는 2px)은 자획이 아니다. 그대로 두면 눈에 보이는 묶음이 버튼
                  가운데보다 4px 왼쪽에 선다 — 왼쪽은 실선이 칸 끝에 딱 붙어 시작하기 때문이다. */}
              <span className="inline-flex items-center justify-center gap-0.5 shrink-0 -mr-2 md:mr-0 md:justify-start md:ml-1">
                {/* 링크 줄이 여기서 끝난다는 표시. 높이는 아이콘 자획과 같은 16px */}
                <span aria-hidden className="w-px h-4 mr-1.5 shrink-0 md:hidden" style={{ background: 'var(--app-line)' }} />
                {shareBtn}{deleteBtn}
              </span>
            </div>
          </div>
        </div>
        {/* 그리드에서는 첫 줄 오른쪽 칸을 명시한다 — 자동 배치에 맡기면 아래 줄 다음(3번째
            줄)으로 떨어진다 */}
        <button onClick={onNewTask}
          className="dc-press row-start-1 col-start-2 inline-flex items-center gap-1.5 pl-[11px] pr-3.5 py-[7px] rounded-md text-[12.5px] font-bold text-white whitespace-nowrap shrink-0 hover:brightness-[1.07] transition-[filter]"
          style={{ background: 'var(--app-accent)', boxShadow: '0 1px 2px rgba(25,23,32,.18), inset 0 1px 0 rgba(255,255,255,.22)' }}>
          {/* -translate-y-px: 화면에 **찍힌 잉크**로 재면 아이콘 중심이 글자 중심보다 1px
              아래에 앉는다(사용자 지적 2026-08-30). 배율 1·1.25·2 모두에서 같은 값이고,
              1px 올리면 셋 다 정확히 0이 된다. 줄 상자(getBoundingClientRect)로 재면
              0.88px이 나오는데 그건 글꼴 여백을 품은 값이라 눈에 보이는 것과 다르다.
              translate라 버튼 높이는 그대로다(margin으로 올리면 줄이 밀린다). */}
          <Plus size={13} className="shrink-0 [stroke-width:2.2px] -translate-y-px" />새 업무
        </button>
      </div>

      {/* ── 필터 줄: 보기 전환 + 팀 칩(데스크톱) / 한 줄 필터 버튼(모바일) ── */}
      <div className="flex items-center gap-2.5 py-[11px] flex-wrap shrink-0">
        <Segmented className="flex p-[3px] rounded-md shrink-0"
          items={VIEW_MODES} value={viewMode} onPick={setViewMode}
          btnClassName="px-3 py-[5px] rounded-sm text-[12.5px] font-semibold transition-colors" />

        {/* 데스크톱: 전체 칩 + 업무가 있는 팀만 */}
        <span className="hidden md:block w-px h-5 shrink-0" style={{ background: 'var(--app-line)' }} />
        <div className="hidden md:flex flex-wrap items-center gap-1.5 min-w-0">
          <button onClick={() => setSelectedTeams([])}
            className="px-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
            style={{
              background: selectedTeams.length ? 'var(--app-surface-hover)' : 'var(--app-ink)',
              color: selectedTeams.length ? 'var(--app-ink-muted)' : 'var(--app-canvas)',
              fontWeight: selectedTeams.length ? 500 : 700,
            }}>전체 {projectTasks.length}</button>
          {teamChips.map(name => {
            const on = selectedTeams.includes(name);
            return (
              <button key={name} onClick={() => toggleTeam(name)}
                className="inline-flex items-center gap-1.5 pl-[9px] pr-[11px] py-[5px] rounded-full text-[11.5px] whitespace-nowrap transition-colors"
                style={{
                  background: on ? teamBgColor(name) : 'var(--app-surface-hover)',
                  color: on ? teamColor(name) : 'var(--app-ink-muted)',
                  fontWeight: on ? 700 : 500,
                }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: teamColor(name) }} />
                {name}
                <span className="text-[10.5px] tabular-nums" style={{ color: on ? teamColor(name) : 'var(--app-ink-muted)' }}>{teamCounts[name]}</span>
              </button>
            );
          })}
        </div>

        {/* 모바일: 한 줄 필터 버튼 → 오버레이 카드 */}
        <TeamFilterBar
          className="md:hidden"
          teams={teamChips} counts={teamCounts} total={countable.length}
          shownCount={(viewMode === 'calendar' ? datedTasks(filteredTasks) : filteredTasks).length} selected={selectedTeams}
          onToggle={toggleTeam} onClear={() => setSelectedTeams([])}
        />
      </div>

      <div className="flex-1 min-h-0">
        {/* 순서 바꾸기는 프로젝트 보드에서만 — 대시보드·내 업무·팀 보드는 여러
            프로젝트가 섞여 있어서 "이 컬럼의 순서"라는 말이 성립하지 않는다 */}
        {viewMode === 'kanban' && <Board tasks={filteredTasks} onStatusChange={onStatusChange} onReorder={onReorder} onTaskClick={onTaskClick} />}
        {viewMode === 'calendar' && <CalendarBoard tasks={calendarTasks} onTaskClick={onTaskClick} onNewTask={onNewTask} headerExtra={feedButton} />}
        {/* 그래프(0020): 선후관계. 필터를 그대로 물려받는다 — 팀을 고르면 그 팀 순서만 남는다 */}
        {viewMode === 'graph' && <Suspense fallback={null}><DepGraph tasks={filteredTasks} onTaskClick={onTaskClick} /></Suspense>}
      </div>
    </div>
  );
});
