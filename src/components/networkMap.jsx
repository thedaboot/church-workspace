import React, { useState, useEffect, useMemo, useRef } from 'react';
import { teamColor } from '../config.js';
import { Avatar } from './Avatar.jsx';
import { YearPicker } from './layout.jsx';
import { spreadLabels, scrollParentOf } from '../utils.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useForceGraph, hoverProps } from '../hooks/useForceGraph.js';
import { Card } from '../views/dashboardParts.jsx';

// 대시보드 맨 아래의 프로젝트 연결 지도(views/dashboardView.jsx만 쓴다 · 2026-10-07 dashboardParts에서 갈랐다).
// ── 연결 지도 — 사람 · 팀 · 프로젝트 (0019·0020 회차의 #28) ──────────────────
// "내가 어디에 붙어 있나"를 한 장으로. 세 열을 고정 좌표로 두고 선만 SVG로 긋는다 —
// force 시뮬레이션·측정(ResizeObserver) 없이 렌더와 같은 상수로 좌표를 계산한다.
// ── 프로젝트 연결 지도 — 힘 기반 노드 그래프 (2026-08-26 · 27) ─────────────────
// 예전에는 사람·팀·프로젝트 3열 목록이라 사람이 늘수록 높이가 줄 수만큼 쌓였다
// (사용자 지적). 지금은 힘 배치라 높이가 고정이고 자리 잡는 과정이 모션이다.
//  · **팀은 가운데 열에 고정**(사용자 결정 2026-08-27 — 순수 force로 두었더니
//    어디가 팀인지 흔들렸다). 사람·프로젝트만 그 주위에 떠 있다.
//  · **사람·프로젝트 노드는 손으로 끌 수 있다**(사용자 요청 — 겹치면 직접 편다).
//    시뮬·드래그·클릭 삼킴은 useForceGraph가 한다(그래프 뷰와 공용).
//  · 판정어 없음(§8): 연결이 없는 사람도 그대로 보인다.
// 배치 상수 한 곳 — **노드 앵커 · 열 머리글 · 선의 목표 길이가 같은 값을 본다.**
// 예전에는 세 군데에 숫자를 흩뿌려서 '프로젝트' 머리글(0.8)과 실제 앵커(0.85)가
// 어긋나 있었다.
// 데스크톱(desk)과 폰(mob)이 같은 열쇠를 가진다 — 그리는 쪽은 `FM[compact ? 'mob' : 'desk']` 한 번만 고른다.
//  · H_MIN · H_MAX · ROW: 높이는 **줄 수를 따라간다**(2026-08-31). 340px에 프로젝트 15개를 넣으면 한 칸이
//    22px인데 라벨이 26px이라 겹칠 수밖에 없었다(사용자 스크린샷의 그 상태다).
//  · AX: 시뮬 폭 — **데스크톱은 카드를 다 쓴다**(2026-08-31 사용자 지적 — "좌우 공간이 많이
//    남는다"). 예전에 760으로 묶어 둔 이유는 "넓으면 앵커가 양끝으로 찢는다"였는데,
//    그건 폭 탓이 아니라 **선의 목표 길이가 고정(92·150px)이라 앵커 간격과 싸운 것**
//    이었다. 지금은 목표 길이를 앵커 간격에서 뽑으므로(EDGE_OF) 폭에 따라 같이 늘고,
//    넓어질수록 오히려 조용해진다(실측: 총이동 168 → 52px/노드).
//    1400으로 한 번 묶어 봤더니 1858px 카드에서 좌우 229px씩 또 남았다 → 상한을 없앤다.
//    x 앵커(폭 비율): 사람 · 팀 · 프로젝트.
//    프로젝트 라벨이 180px까지라 0.84에 세우면 오른쪽 끝(+90)이 카드 경계에 딱 맞는다.
//  · GAP: 라벨 최소 간격 — 그릴 때 utils.spreadLabels가 이만큼은 띄운다(층별)
//  · ZX: 층이 가로로 헤맬 수 있는 범위(폭 비율). 겹침은 그릴 때 y로 풀므로 가로 흔들림은
//    그냥 잡음이다 — 좁혀서 **열로 읽히게** 한다. 넓게 뒀더니 프로젝트 라벨이 팀 열
//    위로 들어왔다(모바일에서 특히). 끌기는 세로로는 그대로 자유롭다.
//  · ZXD: 끌 때만 쓰는 넓은 범위(utils.forceBounds의 drag). 시뮬 범위로 끌면 몇십 px에서
//    벽에 부딪혀 뻑뻑하다(사용자 지적 2026-08-31). **층 밖으로는 여전히 못 나간다**
//    (사용자 결정 2026-08-27) — 넓어진 것은 자기 층 안에서의 여유뿐이다.
const FM = {
  desk: {
    H_MIN: 340, H_MAX: 540, ROW: 30,
    AX: { m: 0.09, t: 0.44, p: 0.84 },
    GAP: { m: 36, t: 22, p: 30 },
    ZX: { m: [0.02, 0.20], p: [0.78, 0.99] },
    ZXD: { m: [0.02, 0.40], p: [0.58, 0.99] },
  },
  mob: {
    H_MIN: 300, H_MAX: 580, ROW: 30,
    AX: { m: 0.16, t: 0.44, p: 0.84 },
    GAP: { m: 36, t: 20, p: 30 },
    ZX: { m: [0.02, 0.30], p: [0.76, 0.99] },
    ZXD: { m: [0.02, 0.42], p: [0.52, 0.99] },
  },
};
// 선의 목표 길이 = 두 층의 앵커 간격. 스프링이 앵커와 싸우지 않으므로 가로로는
// 가만히 있고 **세로로만** 이어진 짝을 끌어당긴다 — 그게 이 그림이 원하는 힘이다.
const EDGE_OF = (a, b, W) => Math.max(48, (b - a) * W);

export function NetworkMap({ members, teamsInUse, projects, teamProjects, teamLeft = {}, memberLoad,
  year, years, yearCounts, onPickYear, onOpenTeam, onOpenProject }) {
  const compact = useIsMobile();
  const wrapRef = useRef(null);
  // **폭을 재기 전에는 배치하지 않는다**(cw = 0 · 2026-08-31 사용자 지적 — "모바일에서
  // 렌더링될 때 뚜둑하면서 펼쳐지는 느낌"). 예전에는 짐작한 폭(340/640)으로 한 번
  // 배치하고, ResizeObserver가 진짜 폭을 알려주면 W가 바뀌어 **처음부터 다시** 배치했다.
  // 그 두 번째 배치가 눈에 보이는 "뚜둑"이었다. 모바일은 더 심했다 — '연결' 탭이
  // 숨어 있는 동안 clientWidth가 0이라 하한(280)으로 한 번 더 배치됐다.
  const [cw, setCw] = useState(0);
  // 가장 붐비는 층이 높이를 정한다 — 라벨이 겹치지 않을 만큼만 키우고 상한에서 멈춘다
  const rows = Math.max(members.length, teamsInUse.length, projects.length, 1);
  const L = FM[compact ? 'mob' : 'desk'];
  const H = Math.min(L.H_MAX, Math.max(L.H_MIN, rows * L.ROW + 60));
  const W = cw;   // 카드 폭을 그대로 쓴다(좌우 여백을 만들지 않는다)
  const { AX, ZX, ZXD } = L;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // 숨어 있는 동안(clientWidth 0)은 0으로 둔다 — 하한으로 배치해 두면 보일 때
    // 다시 배치되고 그게 "뚜둑"이다. 창을 몇 px 흔드는 것으로 다시 배치되지 않게
    // 8px 단위로 끊는다(회전·창 크기 변경은 그대로 따라간다).
    const read = () => {
      const w = el.clientWidth;
      setCw(w < 200 ? 0 : Math.round(w / 8) * 8);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 노드·연결 목록 ─────────────────────────────────────────────────────────
  // **사람과 프로젝트를 자기 팀의 띠(밴드) 높이에 세운다**(2026-08-31 읽기 보조).
  // 예전에는 세로 등분이라 순서가 팀과 아무 상관이 없었고, 그래서 선 40개가 서로를
  // 가로질렀습니다 — 가독성을 망친 것은 라벨 겹침이 아니라 **교차**였습니다.
  // 팀을 여럿 맡은 사람은 **첫 팀** 띠에 서고 나머지 팀으로 가는 선만 띠를 건넙니다
  // (그게 실제로 겸직이라는 사실이라 숨기지 않습니다).
  // ay를 안 주면 forceStep이 **전부 세로 가운데로** 끌어당깁니다(기본 0.5) — 그것도
  // 순서를 흐트러뜨리던 원인이었습니다.
  const { nodes, edges, bands } = useMemo(() => {
    // 폭을 아직 모르면 **아무것도 만들지 않는다.** 노드를 만들어 두면 그 폭으로 한 번
    // 배치되고 자리가 posById에 기억돼서, 진짜 폭이 들어올 때 그 자리에서 다시
    // 움직인다 — 그게 "뚜둑"이다. 빈 목록이면 시뮬이 기억할 것도 없다.
    if (!W) return { nodes: [], edges: [], bands: [] };
    const nodes = [];
    const idx = new Map();
    const push = (n) => { idx.set(n.id, nodes.length); nodes.push(n); };
    const T = Math.max(1, teamsInUse.length);
    const slot = new Map(teamsInUse.map((t, i) => [t, i]));
    // 띠 = 세로를 팀 수로 나눈 칸. 팀 칩은 그 칸의 가운데에 고정된다.
    const top = 26, span = H - 52;
    const bandTop = (k) => top + (k / T) * span;
    const bandH = span / T;
    const bands = teamsInUse.map((t, k) => ({ team: t, y0: bandTop(k), y1: bandTop(k) + bandH }));

    // 한 띠 안에서 j번째(총 n개)면 어디에 서나 — 등분해서 겹치지 않게
    const inBand = (k, j, n) => (bandTop(k) + ((j + 0.5) / Math.max(1, n)) * bandH) / H;
    // 팀이 없거나 목록에 없는 팀이면 전체 높이에 편다(마지막 띠 아래로 밀지 않는다)
    const spread = (j, n) => (top + ((j + 0.5) / Math.max(1, n)) * span) / H;

    // 층별로 "같은 띠에 몇 번째인가"를 먼저 센다 — 그래야 등분할 수 있다
    const rank = (list, teamOf) => {
      const seen = new Map();
      return list.map((x) => {
        const k = slot.has(teamOf(x)) ? slot.get(teamOf(x)) : -1;
        const j = seen.get(k) || 0;
        seen.set(k, j + 1);
        return { k, j };
      }).map((r, i, all) => ({ ...r, n: all.filter(o => o.k === r.k).length, i }));
    };
    const firstTeam = (m) => (m.teams?.length ? m.teams : [m.team]).filter(Boolean)[0];
    const mainTeamOfProject = (pr) => {
      const hit = teamProjects.filter(([, pid]) => pid === pr.id);
      if (!hit.length) return null;
      // 업무가 가장 많은 팀을 그 프로젝트의 자리로 본다
      return hit.slice().sort((a, b) => (b[2] || 1) - (a[2] || 1))[0][0];
    };

    const mRank = rank(members, firstTeam);
    members.forEach((m, k) => {
      const r = mRank[k];
      push({
        id: `m:${m.name}`, kind: 'member', m, pl: 30, pr: 46,
        // zx: 사람은 왼쪽 영역 밖으로 못 나간다 — 층 읽기가 안 깨진다(사용자 결정)
        ax: AX.m, zx: ZX.m, zxDrag: ZXD.m,
        ay: r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n),
        iy: r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n),
      });
    });
    // 팀은 가운데 열 고정 — 자기 띠의 가운데. 모바일은 살짝 왼쪽(0.44).
    const teamX = W * AX.t;
    teamsInUse.forEach((t, k) => push({
      id: `t:${t}`, kind: 'team', t, left: teamLeft[t] || 0,
      fixed: { x: teamX, y: bandTop(k) + bandH / 2 },
    }));
    const pRank = rank(projects, mainTeamOfProject);
    projects.forEach((pr, k) => {
      const r = pRank[k];
      const y = r.k >= 0 ? inBand(r.k, r.j, r.n) : spread(r.j, r.n);
      push({
        id: `p:${pr.id}`, kind: 'project', p: pr,
        // pr = 라벨 반폭 + 여유. 이 값이 라벨 폭보다 작으면 좁은 데스크톱(좌우 여백이 없는
        // 폭)에서 라벨 오른쪽이 카드 밖으로 나간다.
        pl: 56, pr: compact ? 66 : 96,
        // **한 열로 세운다.** 두 열(홀짝 지그재그)로 벌려 봤더니 선이 오히려 더
        // 엇갈려 보였다 — 겹침은 그릴 때 떼어놓는 쪽(spreadLabels)이 확실하다.
        ax: AX.p,
        ay: y, iy: y, zx: ZX.p, zxDrag: ZXD.p,
        repel: 1.7,   // 라벨이 제일 크다 — 서로는 더 세게 밀어야 안 겹친다
      });
    });

    const edges = [];
    // 목표 길이는 앵커 간격이다(EDGE_OF) — 고정값이면 폭이 넓어질수록 스프링이
    // 앵커를 이기려 들어 그래프가 계속 출렁인다(실측: 방향 반전 4.9 → 1.0회/노드).
    const lenMT = EDGE_OF(AX.m, AX.t, W);
    const lenTP = EDGE_OF(AX.t, AX.p, W);
    // 선 굵기 = 같이 맡은 업무 수(사용자 결정 2026-08-31). **선이 있냐 없냐는 멤버십**
    // 이고 굵기만 업무 수다 — 업무 수로 선을 만들면 맡은 일이 없는 사람이 팀에서
    // 사라집니다(§8).
    members.forEach(m => [...new Set((m.teams?.length ? m.teams : [m.team]).filter(Boolean))].forEach(t => {
      if (!idx.has(`t:${t}`)) return;
      edges.push([idx.get(`m:${m.name}`), idx.get(`t:${t}`), lenMT, teamColor(t),
        memberLoad?.get?.(`${m.name}|${t}`) || 0]);
    }));
    teamProjects.forEach(([team, pid, n]) => {
      if (idx.has(`t:${team}`) && idx.has(`p:${pid}`)) {
        edges.push([idx.get(`t:${team}`), idx.get(`p:${pid}`), lenTP, teamColor(team), n || 0]);
      }
    });
    return { nodes, edges, bands };
  }, [members, teamsInUse, projects, teamProjects, teamLeft, memberLoad, compact, W, H, AX, ZX, ZXD]);

  // 엔진은 프로젝트 그래프 뷰(depgraph)와 **같은 useForceGraph/forceStep**이다
  // (사용자 지시 2026-08-31 — "힘 엔진은 같이 가져가라"). 상수·미리 돌리기·선 길이
  // 규칙을 여기서 고치면 그 화면도 같이 따라온다. 갈라 두지 마세요.
  // **끌기는 그대로 둡니다**(사용자 지시 2026-08-31 — "끌기는 왜 빼").
  const { pos, bindDrag } = useForceGraph({ nodes, edges, W, H, wrapRef, compact });
  // hover(데스크톱) 또는 탭(모바일)으로 고른 노드. 사람 노드는 갈 곳이 없으므로
  // **탭이 곧 포커스**다 — 터치 기기에는 hover가 없어서 이 기능이 아예 없었다(§8).
  // **고른 노드는 인덱스가 아니라 id로 기억한다.** 인덱스로 들고 있으면 목록이 다시
  // 만들어질 때(사람이 가입하거나 실시간 재조회가 오거나 폭이 바뀔 때) 같은 번호가
  // **딴 노드**를 가리켜서, 아무것도 안 했는데 엉뚱한 프로젝트가 강조됐다
  // (사용자 지적 2026-08-31 — "가끔 다른 프로젝트가 갑자기 강조가 된다").
  // 그 노드가 사라졌으면 강조도 사라진다(찾지 못하면 null).
  const [hiId, setHiId] = useState(null);
  const [pinId, setPinId] = useState(null);
  const curId = hiId ?? pinId;
  const curIdx = curId == null ? -1 : nodes.findIndex(n => n.id === curId);
  const cur = curIdx >= 0 ? curIdx : null;
  // **호버는 진짜 마우스에만**(hooks/useForceGraph.js의 hoverProps — 그래프 뷰와 한 벌).
  // 터치에서 강조를 보는 길은 사람 노드를 눌러 두는 것(pin)뿐이고, 그건 기준이 분명하다
  // (누르면 켜지고 다시 누르거나 빈 데를 누르면 꺼진다).
  const hoverOn = hoverProps(setHiId);


  // 만진(또는 탭해 둔) 노드와 그 이웃만 또렷하게 — 나머지는 흐린다
  const linked = useMemo(() => {
    if (cur == null) return null;
    const set = new Set([cur]);
    edges.forEach(([a, b]) => { if (a === cur) set.add(b); if (b === cur) set.add(a); });
    return set;
  }, [cur, edges]);
  // 선 굵기의 기준 — 가장 굵은 연결이 상한이 된다(절대 굵기를 박으면 업무가 늘 때 다 굵어진다)
  const maxW = useMemo(() => Math.max(1, ...edges.map(e => e[4] || 0)), [edges]);

  // **그릴 때 같은 층 라벨을 떼어놓는다**(utils.spreadLabels · 2026-08-31).
  // 힘 배치는 겹치지 않음을 보장할 수 없다 — 척력을 세게 하면 노드가 영역 밖으로
  // 밀리고, 약하면 라벨이 겹친다(실측 4~9건). 시뮬 좌표(pos)는 건드리지 않고
  // 화면 y만 민다: 끌기는 여전히 자기 좌표를 따라가고, 보이는 것만 안 겹친다.
  // useMemo를 쓰지 않는다 — pos는 ref 배열이라 참조가 안 바뀌어서 의존성으로 못 쓴다.
  // 노드 37개 × 층 3개짜리 정렬이라 매 프레임 돌아도 공짜다.
  const GAP = L.GAP;
  const drawY = new Map();
  for (const [kind, key] of [['member', 'm'], ['team', 't'], ['project', 'p']]) {
    const items = nodes.map((n, i) => ({ n, i }))
      .filter(({ n }) => n.kind === kind)
      .map(({ i }) => ({ i, y: pos[i]?.y ?? 0 }));
    if (!items.length) continue;
    // 위 경계 38: 열 머리글(9.5px, 위에 붙어 있다) 아래다 — 20으로 뒀더니 첫 노드가
    // 머리글을 덮었다(실측 '사람'·'프로젝트' 둘 다).
    spreadLabels(items, GAP[key], 38, H - 16).forEach((y, i) => drawY.set(i, y));
  }
  const yOf = (i) => drawY.get(i) ?? (pos[i]?.y ?? 0);

  // 연도를 바꾸면 **위쪽 칸('프로젝트 진행')이 크게 줄어서** 페이지가 짧아지고, 지도를
  // 보려고 끝까지 내려온 상태에서는 스크롤이 위로 튄다(사용자 지적 2026-08-31 —
  // 실측으로 스크롤 높이 −696px · 스크롤 −720px). 브라우저의 scroll anchoring은
  // 스크롤 끝에서 잘리는 이 경우를 못 잡는다.
  // 그래서 **지도 카드가 화면에서 있던 자리를 지킨다** — 바꾸기 전 top을 재두고,
  // 다음 프레임에 그만큼 되돌린다. 페이지가 더 짧아져 되돌릴 스크롤이 없으면
  // 남는 만큼은 어쩔 수 없다(그때는 지도가 화면 아래에 온전히 보인다).
  const pickYear = (y) => {
    const el = wrapRef.current;
    const before = el?.getBoundingClientRect().top;
    onPickYear(y);
    if (before == null) return;
    requestAnimationFrame(() => {
      const now = wrapRef.current;
      if (!now) return;
      const d = now.getBoundingClientRect().top - before;
      if (Math.abs(d) > 1) scrollParentOf(now)?.scrollBy({ top: d, behavior: 'instant' });
    });
  };

  return (
    <Card className="px-4 py-[15px]">
      <div className="flex items-center gap-2 pb-1">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">프로젝트 연결 지도</h3>
        <span className="text-[10px] text-fg-muted truncate">사람 → 팀 → 프로젝트</span>
        {/* 연도 고르기 — **'프로젝트 진행' 칸·탭 줄과 같은 하나의 값**이다
            (useProjectYear 모듈 스토어). 여기서 바꾸면 그 둘도 따라간다.
            해가 쌓일수록 프로젝트 층이 넘쳐 라벨이 겹치므로 이 칸에도 필요해졌다
            (사용자 결정 2026-08-31). 데스크톱·모바일 같은 자리다. */}
        {onPickYear && (
          <span className="shrink-0 ml-auto -my-1">
            <YearPicker year={year} years={years} yearCounts={yearCounts} onPick={pickYear} compact />
          </span>
        )}
      </div>
      {/* 고른 해에 프로젝트가 없을 수 있다 — 다른 해에는 있다는 뜻이므로 '아직'이라고
          하지 않는다('프로젝트 진행' 칸과 같은 문장). 사람 층만 남은 그림은 뜻이 없다.
          **칸의 높이는 그대로 둔다**(통째로 접으면 페이지가 확 짧아져서 위 스크롤
          보정으로도 못 막는다). 빈 줄을 그 높이 안 가운데에 세운다.
          빈 데를 누르면 탭 포커스가 풀린다. */}
      <div ref={wrapRef} className="relative select-none" style={{ height: H }}
        onClick={(e) => { if (e.target === e.currentTarget) setPinId(null); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHiId(null); }}>
        {/* 팀 띠 — 사람·프로젝트가 자기 팀 높이에 서므로, 옅은 가로 띠가 "이 줄은 이 팀"을
            말해 준다(2026-08-31 읽기 보조). 홀수 띠만 칠해서 줄무늬로 읽히게 하고, 고른
            팀의 띠는 그 팀 색으로 한 겹 더 밝힌다. 선 아래에 깔린다(pointer-events 없음). */}
        {!projects.length && (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
            {year}년에 프로젝트는 아직 없어요
          </p>
        )}
        {bands.map((b, k) => {
          const isCur = cur != null && nodes[cur]?.kind === 'team' && nodes[cur].t === b.team;
          const near = cur != null && linked && [...linked].some(j => nodes[j]?.kind === 'team' && nodes[j].t === b.team);
          return (
            <span key={b.team} aria-hidden className="absolute pointer-events-none"
              style={{
                left: 0, top: b.y0, width: W, height: b.y1 - b.y0,
                background: isCur || near
                  ? `color-mix(in srgb, ${teamColor(b.team)} 12%, transparent)`
                  : k % 2 ? 'var(--app-surface-hover)' : 'transparent',
                opacity: isCur || near ? 1 : 0.55,
                transition: 'background 200ms, opacity 200ms',
              }} />
          );
        })}
        {/* 열 머리글 — 팀 열(가운데)은 고정이라 정확하고, 사람·프로젝트는 영역(zx)의 가운데쯤이다 */}
        <span className="absolute text-[10px] font-bold text-fg-muted" style={{ left: W * AX.m, top: 0, transform: 'translateX(-50%)' }}>사람</span>
        <span className="absolute text-[10px] font-bold text-fg-muted" style={{ left: W * AX.t, top: 0, transform: 'translateX(-50%)' }}>팀</span>
        <span className="absolute text-[10px] font-bold text-fg-muted" style={{ left: W * AX.p, top: 0, transform: 'translateX(-50%)' }}>프로젝트</span>
        <svg className="absolute inset-0 pointer-events-none" width={cw} height={H} aria-hidden>
          {edges.map(([a, b, , color, weight], i) => {
            const on = cur != null && (a === cur || b === cur);
            const dim = cur != null && !on;
            const x1 = (pos[a]?.x || 0), y1 = yOf(a);
            const x2 = (pos[b]?.x || 0), y2 = yOf(b);
            const bend = Math.min(26, Math.hypot(x2 - x1, y2 - y1) * 0.12);
            // 굵기 = 같이 맡은 업무 수(사용자 결정 2026-08-31). 0.9~3.2px 사이로 누른다 —
            // 상한이 없으면 업무가 많은 한 줄이 화면을 갈라 버리고, 하한이 없으면
            // 0건 연결이 사라져 "그 팀 사람이 아닌 것"처럼 보인다.
            const wpx = 0.9 + Math.min(1, (weight || 0) / maxW) * 2.3;
            return (
              <path key={i}
                d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${(y1 + y2) / 2 - bend} ${x2} ${y2}`}
                fill="none" stroke={color} strokeWidth={on ? wpx + 0.7 : wpx}
                strokeLinecap="round"
                opacity={dim ? 0.1 : on ? 0.9 : 0.42}
                style={{ transition: 'opacity 200ms, stroke-width 200ms' }} />
            );
          })}
        </svg>
        {nodes.map((n, i) => {
          const P = pos[i];
          if (!P) return null;
          const dim = linked && !linked.has(i);
          const base = {
            position: 'absolute', left: P.x, top: yOf(i), transform: 'translate(-50%, -50%)',
            opacity: dim ? 0.22 : 1, transition: 'opacity 200ms',
          };
          if (n.kind === 'member') {
            const drag = bindDrag(i);
            const picked = pinId === n.id;
            return (
              // 사람 노드는 갈 곳이 없어서 예전에는 눌러도 아무 일이 없었다 → **탭이 포커스**다.
              // 터치 기기에는 hover가 없어서 "그 사람의 연결만 보기"가 아예 없는 기능이었다(§8).
              <button key={n.id} type="button" {...drag}
                style={{ ...base, ...drag.style, cursor: 'grab' }}
                aria-pressed={picked}
                title={`${n.m.name} — 눌러서 이 사람의 연결만 보기`}
                className="flex flex-col items-center gap-0.5"
                onClick={() => setPinId(picked ? null : n.id)}
                {...hoverOn(n.id)}>
                <Avatar name={n.m.name} url={n.m.avatarUrl}
                  className={`flex w-[20px] h-[20px] text-[9px] pointer-events-none ${picked ? 'ring-2 ring-accent' : ''}`} />
                <span className={`text-[10px] leading-none whitespace-nowrap pointer-events-none ${picked ? 'text-fg font-bold' : 'text-fg-muted'}`}>{n.m.name}</span>
              </button>
            );
          }
          if (n.kind === 'team') {
            return (
              // 남은 업무 수를 칩 안에 붙인다(사용자 결정 2026-08-31) — 연결과 부담을
              // 한 번에 읽는다. 0건이면 숫자를 쓰지 않는다(없는 것을 굳이 말하지 않는다).
              <button key={n.id} type="button" title={`${n.t} 보드로${n.left ? ` · 남은 업무 ${n.left}건` : ''}`} style={base}
                {...hoverOn(n.id)}
                onClick={() => onOpenTeam(n.t)}
                className="inline-flex items-center gap-1 pl-2 pr-[7px] py-[3px] rounded-full text-[10.5px] font-bold whitespace-nowrap bg-surface border border-line shadow-soft transition hover:opacity-70">
                <span style={{ color: teamColor(n.t) }}>{n.t}</span>
                {n.left > 0 && (
                  <span className="text-[10px] font-semibold tabular-nums text-fg-muted">{n.left}</span>
                )}
              </button>
            );
          }
          const drag = bindDrag(i);
          return (
            <button key={n.id} type="button" title={`${n.p.title} 열기`} {...drag}
              style={{ ...base, ...drag.style, cursor: 'grab' }}
              {...hoverOn(n.id)}
              onClick={() => onOpenProject(n.p.id)}
              className={`px-2.5 py-1 rounded-md bg-surface shadow-soft border border-line font-bold text-fg whitespace-nowrap truncate transition hover:opacity-70 ${compact ? 'text-[10.5px] max-w-[128px]' : 'text-[11.5px] max-w-[200px]'}`}>
              {n.p.title}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
