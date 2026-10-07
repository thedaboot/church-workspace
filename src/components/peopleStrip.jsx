import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { teamColor } from '../config.js';
import { Avatar } from './Avatar.jsx';
import { visitOrder, agoLabel, lastVisitOf } from '../utils.js';
import { usePresence } from '../services/presence.js';
import { useMinuteTick } from '../hooks/useMinuteTick.js';
import { Card } from '../views/dashboardParts.jsx';

// 대시보드 사람 칸과 가입한 사람 창(views/dashboardView.jsx만 쓴다 · 2026-10-07 dashboardParts에서 갈랐다).
// ── 사람 칸 (0019) ────────────────────────────────────────────────────────────
// 대시보드가 숫자만 있고 사람이 없었다. 참여의 시작은 "여기 사람이 있다"이고, 그걸
// 말하려면 얼굴이 필요하다. 없는 줄은 그리지 않는다 — 이 앱은 담백함이 먼저다(§8).
//
// 판정어·순위·점수를 두지 않는다. 다녀간 사람은 이름을 나열하지 않고 얼굴만 보여준다 —
// 많이 온 순으로 세우면 그 줄이 곧 "덜 온 사람" 목록이 된다(§8).
//
// **줄 수는 언제나 상한이 있다.** 수련회 시즌에 열 명이 한꺼번에 가입하면 이 카드가
// 화면을 밀어내고, 그러면 정작 업무 목록이 안 보인다. 두 줄까지만 그리고 나머지는 +N이다.
const PEOPLE_ROWS = 2;

// 얼굴 묶음 (다녀간 사람 · 접힌 +N 자리에서 같이 쓴다)
function FaceRow({ people, max = 8, size = 'w-[18px] h-[18px] text-[9px]' }) {
  if (!people.length) return null;
  return (
    <span className="flex items-center min-w-0" title={people.map(m => m.name).join(' · ')}>
      {people.slice(0, max).map(m => (
        <Avatar key={m.id || m.name} name={m.name} url={m.avatarUrl}
          className={`flex ${size} -ml-[5px] first:ml-0 ring-[1.5px] ring-surface`} />
      ))}
      {people.length > max && (
        <span className="ml-[5px] text-[10.5px] text-fg-muted tabular-nums">+{people.length - max}</span>
      )}
    </span>
  );
}

// 한 사람 줄 (생일 · 새로 온 사람이 같은 모양을 쓴다)
function PersonLine({ member, text, right, rightColor }) {
  return (
    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-line/60">
      <Avatar name={member.name} url={member.avatarUrl} className="flex w-[22px] h-[22px] text-[10.5px]" />
      <span className="text-[11.5px] text-fg min-w-0 truncate">
        <span className="font-semibold">{member.name}</span>{text}
      </span>
      <span className="flex-1" />
      {right && (
        <span className="text-[11px] tabular-nums whitespace-nowrap shrink-0" style={{ color: rightColor }}>{right}</span>
      )}
    </div>
  );
}

// 상한을 넘은 나머지 — 얼굴 묶음 + "그리고 N명 더"
function OverflowLine({ rest, text }) {
  if (!rest.length) return null;
  return (
    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-line/60">
      <FaceRow people={rest} max={6} />
      <span className="text-[11px] text-fg-muted min-w-0 truncate">{rest.length}명 {text}</span>
    </div>
  );
}

export function PeopleStrip({ members, myName, seen, birthdays, joined, onOpenMembers }) {
  if (!members.length) return null;
  const dayLabel = (n) => (n === 0 ? '오늘' : n === 1 ? '내일' : `${n}일 뒤`);
  const bShown = birthdays.slice(0, PEOPLE_ROWS), bRest = birthdays.slice(PEOPLE_ROWS);
  const jShown = joined.slice(0, PEOPLE_ROWS), jRest = joined.slice(PEOPLE_ROWS);
  return (
    <Card className="px-4 py-[15px]">
      {/* 머리줄의 숫자는 누를 수 있다 — 가입한 사람 전체 목록이 열린다.
          누를 수 있다는 걸 밑줄 점선으로 보여준다(hover로만 알 수 있게 두면 §8 위반이다) */}
      <div className="flex items-baseline justify-between gap-2 pb-2.5">
        <h3 className="text-[12.5px] font-bold text-fg whitespace-nowrap shrink-0">현재까지 가입한 사람</h3>
        <button type="button" onClick={onOpenMembers}
          className="text-[11px] font-semibold text-fg-muted hover:text-accent-text tabular-nums shrink-0 transition-colors"
          style={{ borderBottom: '1px dotted var(--app-line)' }}
          title="가입한 사람 전체 보기">{members.length}명</button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fg-muted whitespace-nowrap shrink-0">오늘 다녀간 사람</span>
        <FaceRow people={seen} />
      </div>

      {/* 생일은 일주일 전부터. '축하'를 앱이 대신 말하지 않는다 — 그건 사람이 할 일이다 */}
      {bShown.map(b => (
        <PersonLine key={b.id || b.name} member={b} text="님 생일이에요"
          right={`${b.month}월 ${b.day}일 · ${dayLabel(b.inDays)}`}
          rightColor={b.inDays === 0 ? 'var(--app-accent)' : 'var(--app-ink-muted)'} />
      ))}
      <OverflowLine rest={bRest} text="더 생일이 있어요" />

      {/* 새로 온 사람 — 사흘만. 환영은 한 번 지나가면 되고, 오래 남으면 인사가 낡는다 */}
      {jShown.map(m => (
        <PersonLine key={m.id || m.name} member={m} text="님이 함께하게 되었어요"
          right={m.team || ''} rightColor={m.team ? teamColor(m.team) : undefined} />
      ))}
      <OverflowLine rest={jRest} text="더 함께하게 되었어요" />
    </Card>
  );
}

// 가입한 사람 전체 — 머리줄의 'N명'을 누르면 열린다.
// 순서는 **최근에 방문한 사람이 위**다(사용자가 가입순에서 바꿨다). 지금 접속해 있는
// 사람은 초록 원(presence — DB에 안 쓰고 연결이 끊기면 서버가 지운다)이 붙고 맨 위로 온다.
// 순번을 매기지 않는다: 방문순에 번호를 붙이면 그 끝이 곧 "안 오는 사람" 순위가 된다(§8).
// 목록이 길어질 것을 전제로 스크롤을 카드 안에 둔다(창이 화면을 넘지 않게 max-h).
export function MembersModal({ members, myName, onClose }) {
  const online = usePresence();
  // 오른쪽 끝의 'N분 전'은 그릴 때의 시각으로 굳는다 — 창을 열어 둔 동안 같이 늙게 한다
  useMinuteTick(10000);   // 초 단위 '다녀감'이 굳지 않게
  const ordered = React.useMemo(() => visitOrder(members, online), [members, online]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // **body 포털이 기본이다**(§6-1). 대시보드 뿌리에 걸린 .dc-screen의 transform 애니메이션이
  // 조상 containing block이 되어, 그냥 fixed로 두면 뷰포트가 아니라 그 안쪽을 기준으로
  // 박힌다 — 실제로 창이 화면 아래쪽에 나타나 하단 탭바에 잘렸다.
  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-lg shadow-elevated border border-line w-full max-w-sm max-h-[80dvh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h3 className="font-bold text-fg tracking-[-0.25px]">가입한 사람 {ordered.length}명</h3>
        </div>
        {/* 스크롤은 이 안에서만 — 창이 길어져 화면 밖으로 나가면 닫기 버튼을 못 찾는다 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 divide-y divide-line/60">
          {ordered.map(m => {
            const isOnline = online.has(m.id);
            return (
              <div key={m.id || m.name} className="flex items-center gap-2.5 py-2.5">
                {/* 접속 표시는 아바타 귀퉁이의 초록 원. 글자 배지보다 자리를 안 먹고,
                    사진 위에서도 읽힌다(바탕색 테두리로 뗀다) */}
                <span className="relative shrink-0 inline-flex">
                  <Avatar name={m.name} url={m.avatarUrl} className="flex w-7 h-7 text-xs" />
                  {isOnline && (
                    <span aria-hidden className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full"
                      style={{ background: 'var(--app-tag-green-fg)', boxShadow: '0 0 0 2px var(--app-surface)' }} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-fg truncate">
                    {m.name}{m.name === myName && <span className="ml-1 text-[10px] font-normal text-fg-muted">나</span>}
                  </span>
                  {/* 대표 팀만 보여주면 겸직(찬양팀+임원진)이 안 보인다 — 전부 적는다.
                      색은 첫 팀(대표) 것 하나만: 글자마다 딴 색이면 태그 잔치가 된다 */}
                  {(m.teams?.length || m.team) && (
                    <span className="block text-[11px] truncate" style={{ color: teamColor((m.teams?.[0]) || m.team) }}>
                      {[...new Set(m.teams?.length ? m.teams : [m.team])].join(' · ')}
                    </span>
                  )}
                </span>
                {/* 방문 기록이 없으면 가입 시각으로 — 가입하던 순간에도 앱에 있었다.
                    (0019 이전 가입자에게 '아직 방문 전'은 틀린 말이었다 — 사용자 지적) */}
                <span className="text-[11px] tabular-nums whitespace-nowrap shrink-0"
                  style={{ color: isOnline ? 'var(--app-tag-green-fg)' : 'var(--app-ink-muted)' }}>
                  {isOnline ? '접속 중' : (agoLabel(lastVisitOf(m)) || '방문 전')}
                </span>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 shrink-0">
          <button onClick={onClose}
            className="w-full bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">닫기</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
