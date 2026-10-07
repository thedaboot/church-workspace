import { useState, useEffect, useMemo, useRef } from 'react';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import { Avatar } from '../components/Avatar.jsx';
import { Skeleton } from '../components/media.jsx';
import { ConfirmPopover } from '../components/ConfirmPopover.jsx';
import { NoteSheet, paperDate } from '../components/paper.jsx';
import { splitNoteSections, QT_SECTIONS } from '../services/noteTemplate.js';
import { TEAM_CHIP_ROW } from './viewParts.jsx';

// ============================================================================
// 말씀 QT의 '오늘의 나눔' — 사람 칩 한 줄 + 종이 하나(사용자 결정 2026-09-13 · HANDOFF §7)
// ----------------------------------------------------------------------------
// 19차(2026-10-07)에 views/wordView.jsx에서 갈라 왔다. 무엇을 피드에 세우는지(mergeFeed)와 누가 지울 수
// 있는지(canDeleteShared)는 순수 함수라 wordView가 이어서 내보낸다(tests/word가 그 경로로 부른다).
// 묵상 종이의 폭·캐릭터(QT_SHEET_BOX · QT_CUT)도 여기 두고 wordView의 '내 묵상' 칸이 같이 쓴다.
// ============================================================================

// 종이 폭 상한 — 인쇄물이라 여기만 max-w를 쓴다(§6-9-k의 예외). 예배 노트와 같은 값이고
// **읽기와 편집이 같이 쓴다**(2026-09-10 — 두 모드에서 종이의 폭·왼쪽 자리가 같아야
// 수정·취소를 눌렀을 때 종이가 옆으로 흔들리지 않는다. tests/word가 단정한다).
// 2026-09-07~09-09에는 읽기 상자를 **편집기의 실제 높이**(198/262px)로 맞춰 두었는데,
// 편집 화면도 종이가 되면서 두 높이가 내용에 따라 달라졌다 — 2026-09-25 사용자 결정 A1로 글 줄의 자리는 편집과 같게 맞췄다(PITFALLS 9-aa-11).
export const QT_SHEET_BOX = 'qt-note-sheet w-full max-w-[560px] mx-auto';
export const QT_CUT = { src: '/chars/book.webp', w: 196, h: 157 };

// ── 나눔 (사람 칩 + 종이 하나) ──────────────────────────────────────────────
// ★ 기다리는 자리는 **실제 나눔과 같은 짜임**이다 — 사람 칩 한 줄 + 종이 한 장(19차 2026-10-07 · 사용자 허락).
// 예전에는 옛 '한 줄 피드'(얼굴 + 두 줄 · 52px)였고, 나눔이 도착하는 순간 아래 칸이 300px 넘게 밀렸다.
// 종이는 진짜 부품(NoteSheet)을 보이지 않게 세워 자리만 잡고 그 위에 뼈대 빛을 씌운다 — 높이를 숫자로
// 베껴 두면 종이가 바뀔 때 갈라진다. 도막은 묵상 템플릿의 둘(QT_SECTIONS)을 한 줄씩(제목 없는 노트의 흔한 모양).
// tools: 종이 아래 도구 줄(연필·휴지통 · 32px)의 자리 — 마스터는 어느 종이에서나 휴지통이 서므로 늘 있고,
// 마스터가 아니면 첫 종이가 대개 남의 것이라(내 것은 공유 중이면 목록 순서 자리다 · mergeFeed) 없다.
const BONE_SECTIONS = QT_SECTIONS.map(title => ({ title, body: '한 줄' }));
export function FeedSkeleton({ date = '', passageRef = '', tools = false }) {
  return (
    <div className="qt-feed-loading" aria-hidden="true">
      <div className="flex items-center">
        <div className="w-24 h-7"><Skeleton className="w-full h-full rounded-full" /></div>
      </div>
      <div className={`mt-3 ${QT_SHEET_BOX}`}>
        <div className="dc-skeleton rounded-lg border border-line">
          <div className="invisible" inert>
            <NoteSheet date={paperDate(date)} kind="묵상 노트" passageRef={passageRef} sections={BONE_SECTIONS} cut={QT_CUT} />
          </div>
        </div>
        {tools && <div className="mt-2 h-8" />}
      </div>
    </div>
  );
}

// 내 줄의 열쇠는 공개 범위와 상관없이 하나다 — 토글할 때마다 key가 바뀌면 같은 줄이
// 언마운트됐다 다시 붙어서, 고쳐 놓은 두 줄 문제 대신 한 줄이 깜빡인다.
export const MY_ROW = 'mine';

// 나눔 피드에 설 줄들 — 그 날 **공유 목록**(fetchSharedEntries)과 **지금 내 묵상 상태**를
// 합친다. 이 둘은 서로 다른 시각의 값이다: 토글은 내 상태를 먼저 바꾸고 목록은 그 다음에
// 다시 읽어 오므로, 그 사이 한 프레임에서는 같은 글이 양쪽에 다 있다. 예전처럼 그냥 이어
// 붙이면 **공유 → 나만 보기로 넘길 때 내 묵상이 두 줄로 보였다가 하나로** 합쳐졌고
// (사용자 관찰 2026-09-05), 반대로 넘길 때는 목록이 도착하기 전까지 한 줄도 없어서
// '올라온 나눔이 아직 없어요'가 스쳤다. 그래서 **내 줄은 지금 내 상태에서 한 줄만 만들고**
// 목록에서 온 내 줄은 걷어낸다.
//   mine: undefined = 아직 이 날 내 묵상을 못 읽었다(목록을 그대로 둔다)
//         null      = 이 날 내 묵상이 없다(지우고 나서 목록이 늦게 오는 경우도 여기다)
//         { … }     = 내 줄 한 줄
// 자리: 비공개면 맨 위다(남에게는 안 보이는 줄이라 목록의 시간 순서에 낄 자리가 없다).
// 공유 중이면 목록이 준 자리 그대로 두고, 목록에 아직 없으면 맨 뒤에 세운다 — 목록은
// updated_at 오름차순이고 방금 저장한 글이 갈 자리가 거기라, 새 목록이 와도 줄이 안 움직인다.
export function mergeFeed(shared, mine) {
  const rows = shared || [];
  if (mine === undefined) return rows;
  const others = rows.filter(e => !e.mine);
  if (!mine) return others;
  // 이름·사진은 목록에 있던 내 줄에서 이어받는다(없으면 프로필에서 찾는다 — profile_id)
  const at = rows.findIndex(e => e.mine);
  const row = { ...(at < 0 ? null : rows[at]), ...mine };
  if (mine.private) return [row, ...others];
  return at < 0 ? [...others, row] : [...others.slice(0, at), row, ...others.slice(at)];
}

// **비공개 묵상도 내 피드에는 선다**(사용자 결정 2026-09-03). 그 칩에 '나만 보기'
// 표시가 붙는다. 남에게는 여전히 안 보인다: 피드 데이터는 공유된 글만 읽고(RLS와 같은
// 경계) 내 것 하나는 화면에서 얹은 것이다(mergeFeed).
//
// **이 자리에는 공유를 바꾸는 칸이 없다**(사용자 결정 2026-09-05 — 머리말 '공유를 조작하는
// 자리는 한 곳'). 표시(잠금)와 고치기(연필)만 두고, 공개 범위는 위 '내 묵상' 칸의 토글이
// 정한다 — 연필이 그 칸으로 데려간다.
//
// **남의 것을 지우는 것은 마스터만이다**(사용자 결정 2026-09-05 · 0045
// qt_entries_delete_master). 내 것에는 붙지 않는다 — 내 것은 위 '내 묵상' 칸의 휴지통이
// 지우고, 거기는 잔디까지 같이 비운다.
export const canDeleteShared = (row, isMaster) => !!isMaster && !row?.mine;

// 나눔은 **종이 하나 + 사람 칩**이다(사용자 결정 2026-09-13 — "더다붓에 공유할 때도
// 묵상 제목이 아니라 그 종이 전체를 보여줘야지. 쌓이는 구조는 아니고, 사람마다 볼 수
// 있게 피커를 둔다든지. 물론 쓴 사람에 한해서만. 쌓이지 않는 구조가 중요"). 예전에는
// 사람마다 한 줄씩 쌓고 도막을 라벨|글 두 칸으로 접어 요약했는데(NoteDigest — 지웠다),
// 나가는 것은 요약이 아니라 그 사람이 쓴 종이다. **종이는 언제나 하나**라서 몇 명이
// 올렸든 화면이 그만큼 길어지지 않는다.
//
// 종이는 '내 묵상' 칸의 읽기 종이와 **같은 부품·같은 폭**이다(paper.jsx `NoteSheet` ·
// `QT_SHEET_BOX`) — 여기에만 다른 마크업을 두면 한쪽만 고쳐진다(§6-32-p). 도막 없이
// 쓴 옛 나눔은 `splitNoteSections`가 라벨 없는 도막 하나로 주므로 종이가 그대로 선다.
//
// 사람 칩이 이어지는 줄은 팀 보드 사람 칩 줄(viewParts.jsx TEAM_CHIP_ROW)과 **같은 한 벌**이다 — 넘치면
// 줄을 바꾸지 않고 가로로 민다(§8 · 같은 종류가 이어지는 줄에서는 허용 · 끝 여백은 ::after 12px · §6-2).
export function ShareFeed({ rows = [], members = [], myName = '', date, passageRef = '',
  onEdit, isMaster = false, onDeleteOther, wantPerson = '' }) {
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  // 고르는 것은 **사람이지 자리가 아니다** — 순번으로 들면 남이 하나 올리는 순간 보고
  // 있던 종이가 다른 사람 것으로 바뀐다. 날짜를 넘겨 그 id가 없어지면 목록의 첫 사람으로
  // 떨어진다(mergeFeed 순서 그대로 — 내 것이 있으면 그게 첫째다).
  const [pickedId, setPickedId] = useState('');
  // 성경 읽기의 '나눔 보기'로 왔으면 그 사람의 칩을 한 번 골라 둔다(목록이 늦게 와도 도착하면 고른다)
  const wanted = useRef('');
  useEffect(() => {
    if (!wantPerson || wanted.current === wantPerson) return;
    const row = rows.find(r => r.profile_id === wantPerson);
    if (row) { wanted.current = wantPerson; setPickedId(row.id); }
  }, [wantPerson, rows]);
  const cur = rows.find(r => r.id === pickedId) || rows[0];
  // 이름·사진의 원본은 워크스페이스 멤버 목록이다(profiles에서 온다).
  // 게스트 모드의 로컬 나눔은 언제나 내 글이라 프로필이 붙지 않는다.
  const who = (e) => {
    const m = byId.get(e.profile_id);
    return { name: m?.name || e.name || myName, url: m?.avatarUrl || e.avatarUrl || '' };
  };
  const sections = useMemo(() => splitNoteSections(cur?.body || ''), [cur?.body]);
  if (!rows.length) {
    return <p className="text-[11.5px] text-fg-muted">이 날짜에 올라온 QT 나눔이 아직 없어요</p>;
  }
  return (
    <div data-share-feed="1">
      {/* 한 명뿐인 날에도 칩 줄은 선다 — 사람 수에 따라 있다 없다 하면 그 줄이 무엇인지
          배울 자리가 없다(§8 '기능을 숨기지 않는다'). */}
      <div className={TEAM_CHIP_ROW}>
        {rows.map((e) => {
          const p = who(e);
          const on = e.id === cur.id;
          return (
            <button key={e.id} type="button" onClick={() => setPickedId(e.id)} aria-pressed={on}
              data-share-person={e.mine ? (e.private ? 'mine-private' : 'mine') : 'other'}
              className={`inline-flex items-center gap-1.5 shrink-0 pl-1 pr-2.5 py-1 rounded-full text-[11.5px] font-semibold transition active:scale-95
                ${on ? 'bg-accent text-white' : 'bg-surface-hover text-fg-muted hover:bg-line'}`}>
              <Avatar name={p.name} url={p.url || undefined} className="flex w-5 h-5 text-[9px] shrink-0" />
              <span className="truncate max-w-[8.5rem]">{p.name}</span>
              {/* 지금 이 글이 나만 보는 것임을 그 칩에서 말한다 — 내 칩에만 붙는다 */}
              {e.private && (
                <span data-private="1" role="img" aria-label="나만 보기" className="inline-flex shrink-0">
                  <Lock size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 그 사람의 **종이 하나**. 칩을 바꾸면 이 종이의 내용만 바뀐다 — 쌓이지 않는다.
          머리의 구절은 '내 묵상' 칸과 **같은 값**(그날 구절 전체 이름 · §6-32-w)이고
          제목은 쓴 사람이 종이 위에 적어 둔 것이다(0062). */}
      <div data-share-paper={cur.mine ? 'mine' : 'other'} className={`mt-3 ${QT_SHEET_BOX}`}>
        <div className="rounded-lg overflow-hidden border border-line">
          <NoteSheet date={paperDate(date)} kind="묵상 노트"
            passageRef={passageRef} passageTitle={cur.title || ''}
            sections={sections} cut={QT_CUT} />
        </div>
        {/* 도구 줄 — 고치기가 왼쪽, 지우기가 오른쪽 끝이다(§8 도구 줄 규칙).
            **언제나 보인다** — hover로만 뜨면 터치 기기에서는 없는 기능이 된다. */}
        {((cur.mine && onEdit) || (canDeleteShared(cur, isMaster) && onDeleteOther)) && (
          <div data-share-tools="1" className="flex items-center gap-1 mt-2">
            {cur.mine && onEdit && (
              <button onClick={onEdit} aria-label="내 나눔 고치기"
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                <Pencil size={13} />
              </button>
            )}
            {/* 공유 해제가 아니라 그 사람의 그날 묵상이 없어진다 — 문구가 그걸 말한다 */}
            {canDeleteShared(cur, isMaster) && onDeleteOther && (
              <ConfirmPopover className="inline-flex ml-auto"
                message="이 나눔을 지울까요? 공유만 내려가는 게 아니라 그 사람의 이 날 묵상이 지워져요."
                onConfirm={() => onDeleteOther(cur)}>
                <button aria-label="이 나눔 지우기"
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-surface-hover transition-colors">
                  <Trash2 size={13} />
                </button>
              </ConfirmPopover>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

