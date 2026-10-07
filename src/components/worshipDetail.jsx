import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, ClipboardCheck, ListMusic, PencilLine, Music, Loader2, FileText,
  Share2, CalendarPlus, GalleryHorizontalEnd, ImagePlus, MoveVertical, Link2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { kstToday } from '../services/word.js';
import { Avatar } from './Avatar.jsx';
import { ConfirmPopover } from './ConfirmPopover.jsx';
import { PassageBody } from './worshipPassage.jsx';
import { loadPassage } from '../services/bible.js';
import { DocEmbedModal } from './DocEmbed.jsx';
import { failText } from '../services/errorText.js';
import { showToast } from './Toast.jsx';
import { BTN, BTN_QUIET, WITH_ICON } from './groupsParts.jsx';
import { kindLabel, formatServiceDate, attendanceVisible, youtubeThumb, PRAISE_TEAM,
  filesOfKind, fileKindOf, servicePaperName, SONGFORM, CUESHEET, fetchLastCuesheet } from '../services/worship.js';
import { honorificsOf } from '../services/people.js';
import { ServiceSheetOne, ServiceSheetTwo, PAPER, paperDate } from './paper.jsx';
import { useSheetShare } from '../hooks/useSheetShare.jsx';
import { churchSeason } from '../services/churchYear.js';
import { realNameOf, realNamesInRoleLines, isNextWeekNotice } from '../services/serviceView.js';
import { readNoticeDate, noticeDateLabel } from '../services/noticeDate.js';
import { ServiceStory } from './worshipStory.jsx';
import { CoverImg, CoverDialog, useCoverShown } from './worshipCover.jsx';
import { coverImage } from '../services/serviceView.js';
import { ROW_LINE, CARD_BOX, NUM, ROLE_VIEW, BTN_SOFT, LIST, SHEET_BOX, SaveState, WorshipEmpty,
  ServiceFileRow, ServiceFiles } from './worshipParts.jsx';
import { WordEdit, RolesEdit, SongsEdit, NoticesEdit, isSeeded } from './worshipEdit.jsx';
import { MyNote } from './worshipNote.jsx';

// 미리보기 창(+PdfView)은 열 때만 받는다 — 첨부를 안 여는 사람까지 그 무게를 받지 않게(2026-09-24).
const FilePreviewModal = lazy(() => import('./FilePreviewModal.jsx').then(m => ({ default: m.FilePreviewModal })));

// ============================================================================
// 주보 상세 — 말씀 · 담당자 · 찬양 · 광고 + 내 예배 노트 (docs/V2.md 결정 4·5·7)
// ----------------------------------------------------------------------------
// 데이터는 전부 props다. 화면을 눌러 보는 검사(tests/worship.mjs)가 가짜 주보·명단으로
// 이 부품만 그려 볼 수 있게, 통신은 부르는 쪽(worshipView)이 전부 가진다.
//
// 담당자·찬양·광고는 주보 한 건과 언제나 같이 읽고 쓰는 값이라 jsonb 한 칸이다
// (HANDOFF §3-1 · 0036). 그래서 편집은 '행 목록을 통째로 들고 있다가 저장'이고,
// 조인 테이블처럼 행마다 왕복하지 않는다.
//
// 편집 중에는 **저절로 저장된다**(디바운스). 그래서 편집 모드의 오른쪽 버튼은 '취소'가
// 아니라 '목록으로'다 — 이미 저장된 것을 되돌려 주지 못하면서 취소라고 부르면 거짓말이
// 된다. 왼쪽 '저장'은 기다리지 않고 지금 저장하고 보기 모드로 돌아가는 버튼이다.
// 발행은 여전히 명시적으로 누른다(결정 5).
//
// 19차(2026-10-07)에 네 파일로 갈랐다 — 여기는 **보기 탭 · 발행본 종이 · 상세(ServiceDetail)**만 남는다.
//   worshipParts.jsx  공용 부품(저장 상태 칩 · 빈 상태 · 휴지통 확인 · 송폼·큐시트 파일 줄)
//   worshipEdit.jsx   수정 중의 말씀·담당자·찬양·광고(줄 목록 한 벌 useRowList)
//   worshipNote.jsx   내 예배 노트 · 내 예배 노트 모아 보기
// ============================================================================

const SAVE_DELAY = 900;

const TABS = [
  { id: 'word', label: '말씀' },
  { id: 'roles', label: '담당자' },
  { id: 'songs', label: '찬양' },
  { id: 'notices', label: '광고' },
];
// 발행된 주보에는 **'주보'가 맨 앞에 붙고 그것이 기본 탭**이다(사용자 요청 2026-09-09 —
// "발행이 완료되면 예배 페이지에서 보일 때는 주보 템플릿에 맞춰서 깔끔하게").
//
// 탭을 없애고 종이만 남기지 **않는** 이유: 곡 제목의 유튜브 링크·재생목록 열기와 본문
// 구절 → 성경 읽기 잇기가 종이에는 없다. 그것까지 걷으면 §8의 '기능을 숨기지 않습니다'와
// 부딪힌다. 종이는 바깥으로 나가는 인쇄물이고, 탭은 우리끼리 쓰는 화면이다.
const PUBLISHED_TABS = [{ id: 'paper', label: '주보' }, ...TABS];

// 저장에 실제로 실리는 칸만 추린다 — 보기 값(status·created_at)까지 되돌려 보내지 않는다
const patchOf = (d) => ({
  title: d.title || null, passage_ref: d.passage_ref || null, preacher: d.preacher || null,
  praise_leader: d.praise_leader || null, praise_playlist_url: d.praise_playlist_url || null,
  roles: d.roles || [], songs: d.songs || [], notices: d.notices || [],
  // 큐시트는 링크 한 칸이라 jsonb다(0053). 주소가 없으면 통째로 null — 제목·비밀번호만
  // 남은 껍데기가 있으면 보기 화면이 열 수 없는 줄을 그린다.
  cue_sheet: d.cue_sheet && String(d.cue_sheet.url || '').trim() ? d.cue_sheet : null,
});

// ── 큐시트 (링크는 0053 · 파일은 0054) ──────────────────────────────────────
// 큐시트는 **링크로도 파일로도** 붙는다(사용자 요구 2026-09-08 "링크로도 걸 수 있게
// 해주고, 파일 업로드로도 첨부할 수 있게도"). 링크는 주보 행의 한 칸이고
// (`services.cue_sheet` jsonb — {url, title}), 파일은 송폼과 같은 files 표에
// `kind='cuesheet'`로 앉는다(0054 · 업로드 길은 그대로 하나다 — §6-29-u).
//
// **비밀번호는 없다**(사용자 결정 2026-09-08 "큐시트는 비밀번호 안 걸어도 돼" —
// 0053의 view_pw 두 칸은 비워 둔다). 발행된 주보를 읽는 사람이면 누구나 연다.
const cueOf = (s) => (s && typeof s.cue_sheet === 'object' ? s.cue_sheet : null);
const cueUrl = (s) => String(cueOf(s)?.url || '').trim();

// 보기 — 링크 줄과 파일 줄이 **한 카드**에 선다. 둘 다 '큐시트'라는 한 가지이고,
// 카드를 갈라 두면 같은 것이 두 군데 있는 것처럼 읽힌다.
// 창 열기는 **참고 링크와 같은 창**(DocEmbed의 DocEmbedModal)이다 — 같은 앱에서 문서 여는
// 방식이 두 가지가 되지 않게. 파일은 첨부·송폼과 같은 FilePreviewModal이다.
// 링크도 파일도 없으면 **카드를 그리지 않는다**(빈 안내 줄 금지 · §8).
function CueSheetView({ cue, files = [], onOpen }) {
  const [open, setOpen] = useState(false);
  if (!cue && !files.length) return null;
  return (
    <section className="worship-cue mt-5 p-3 rounded-[10px]" style={CARD_BOX}>
      <p className="worship-cue-label text-xs font-semibold text-fg-muted">큐시트</p>
      <ul className={`worship-cue-list ${LIST} mt-1`}>
        {cue && (
          <li className="worship-cue-row" style={files.length ? ROW_LINE : undefined}>
            {/* 줄 전체가 누르는 자리다 — 오른쪽 '열기'는 그 사실을 눈에 보이게 하는 표식 */}
            <button type="button" onClick={() => setOpen(true)}
              className="w-full text-left flex items-center gap-2.5 py-2.5">
              <span className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 bg-tag-blue text-tag-blue-fg">
                <FileText size={16} strokeWidth={1.75} />
              </span>
              <span className="worship-cue-title min-w-0 flex-1 text-[13px] text-fg truncate">
                {cue.title || '구글 문서'}
              </span>
              <span className={`worship-cue-open shrink-0 ${BTN_SOFT}`}>열기</span>
            </button>
          </li>
        )}
        {files.map((row, i) => (
          <ServiceFileRow key={row.id} row={row} cls="worship-cue-file" openLabel="보기"
            line={i < files.length - 1} canDelete={false} onOpen={() => onOpen && onOpen(row)} />
        ))}
      </ul>
      {open && cue && <DocEmbedModal url={cue.url} title={cue.title || '큐시트'} onClose={() => setOpen(false)} />}
    </section>
  );
}

// ── 보기 ─────────────────────────────────────────────────────────────────────
function WordTab({ service, onOpenBible, cueFiles = [], onOpenFile }) {
  const cue = cueUrl(service) ? cueOf(service) : null;
  const has = service.title || service.passage_ref || service.preacher;
  if (!has && !cue && !cueFiles.length) return <WorshipEmpty text="설교 제목과 본문 구절을 아직 적지 않았어요" />;
  // 구절은 누르면 성경 읽기의 그 장으로 간다(App.jsx의 openBible → WordView initialRef).
  const ref = service.passage_ref;
  return (
    <div>
      {service.title && <h3 className="text-[17px] md:text-[19px] font-extrabold text-fg tracking-[-0.3px] leading-snug break-words">{service.title}</h3>}
      <p className="mt-1.5 text-[12.5px] text-fg-muted">
        {ref && (onOpenBible
          ? <button type="button" onClick={() => onOpenBible(ref)}
              className="worship-open-bible underline decoration-dotted underline-offset-2 hover:text-fg transition">{ref}</button>
          : ref)}
        {ref && service.preacher && ' · '}
        {service.preacher}
      </p>
      <PassageBody refStr={service.passage_ref} />
      <CueSheetView cue={cue} files={cueFiles} onOpen={onOpenFile} />
    </div>
  );
}

// **보기에서는 이름 뒤에 호칭이 붙는다**(사용자 결정 2026-09-06) — 교역자 '전도사님' ·
// 그 해 부장 '부장님' · 나머지 명단 사람 '청년'. 명단에 없는 객원은 적힌 글자 그대로다.
// 규칙은 services/people.js 한 곳이고(honorific), 여기는 그 한 벌을 받아 쓴다.
// 편집 줄은 손대지 않는다 — 입력칸에 담기는 값은 이름이라야 명단 연결이 계속 맞는다.
function RolesTab({ rows, people, nameOf }) {
  const byId = useMemo(() => new Map((people || []).map(p => [p.id, p])), [people]);
  if (!rows.length) return <WorshipEmpty text="담당자를 아직 정하지 않았어요" />;
  return (
    <ul className={LIST}>
      {rows.map((r, i) => {
        const personId = r.personId || r.person_id || null;
        const person = personId ? byId.get(personId) : null;
        const name = person?.name || r.name || '';
        // 아바타의 글자 원은 **이름**에서 뽑는다(호칭이 붙은 글자로 뽑으면 '전'이 된다)
        const shown = nameOf ? nameOf(name, personId) : name;
        return (
          <li key={i} className="worship-role-row flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid var(--app-line)' }}>
            <span className={NUM}>{i + 1}</span>
            {/* 계정이 이어진 사람만 사진이 있다 — 나머지는 이름 글자 원이다(§4.7) */}
            <Avatar name={name} {...(person?.profile_id ? {} : { url: null })} className="flex w-7 h-7 text-[12px] shrink-0" />
            {/* 역할은 편집 줄과 같은 자리·같은 칩이다. 예전에는 오른쪽 끝에 밀어 뒀는데,
                폭 상한을 걷어내니 이름과 역할이 화면 양 끝으로 갈라졌다(위 지적의
                재발). 붙여 두면 어느 폭에서도 '누가 무엇을' 한 눈에 읽힌다. */}
            {r.role && <span className={`${ROLE_VIEW} shrink-0`}>{r.role}</span>}
            <span className="min-w-0 text-[13px] font-semibold text-fg truncate">{shown || '이름 미입력'}</span>
            <span className="flex-1" />
          </li>
        );
      })}
    </ul>
  );
}

// 유튜브 썸네일 — **키도 서버 함수도 필요 없다**(i.ytimg.com 공개 주소, services의
// youtubeThumb). 그래서 게스트·로컬에서도 그림이 뜬다. 못 받으면(비공개 영상·인터넷
// 없음) 음표 아이콘으로 떨어진다 — 깨진 그림 자리를 남기지 않는다.
// lazy 로딩이라 목록이 길어도 보이는 것만 받는다.
//
// **도착하기 전에는 같은 크기의 스켈레톤이 그 자리를 지킨다**(2026-09-07). 예전에는 빈
// 자리였다가 그림이 뿅 나타나서, 목록을 훑는 동안 곡 줄이 하나씩 깜빡이는 것처럼 보였다.
// 도착하면 200ms 페이드 — 캐시에서 오는 경우(두 번째 진입)에는 `complete`가 이미 참이라
// 첫 프레임부터 켜져 있다(onLoad는 그때 안 울린다 · §6-9-p와 같은 결).
// 편집 줄의 링크 칸 앞 작은 썸네일도 이 한 벌이다(ServiceDetail이 worshipEdit의 SongsEdit에 Thumb로 넘긴다).
function SongThumb({ link, big = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  const src = youtubeThumb(link);
  const box = big ? 'w-16 h-9' : 'w-10 h-6';
  useEffect(() => {
    setFailed(false);
    const el = imgRef.current;
    setLoaded(!!(el && el.complete && el.naturalWidth > 0));
  }, [src]);
  if (!src || failed) {
    return (
      <span className={`worship-song-thumb-fallback ${box} shrink-0 inline-flex items-center justify-center rounded-sm`}
        style={{ background: 'var(--app-surface-hover)' }}>
        <Music size={big ? 13 : 11} className={link ? 'text-accent-text' : 'text-fg-faint'} />
      </span>
    );
  }
  return (
    <span className={`worship-song-thumbbox ${box} shrink-0 relative inline-block overflow-hidden rounded-sm`}
      style={{ background: 'var(--app-surface-hover)' }}>
      {!loaded && <span className="worship-song-thumb-skeleton absolute inset-0 dc-skeleton rounded-sm" />}
      <img referrerPolicy="no-referrer" ref={imgRef} src={src} alt="" loading="lazy" draggable={false}
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
        className={`worship-song-thumb w-full h-full rounded-sm object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
    </span>
  );
}

// 찬양 섹션의 머리 한 줄 — **팀 이름은 고정**(services의 PRAISE_TEAM)이고 주보마다
// 바뀌는 것은 인도자 하나다(사용자 결정 2026-09-05: 팀은 'Re:born 워십'으로 고정,
// 인도자는 격주 교대). 주보에 실리는 사실이지 사용법 안내가 아니라 §8의 '안내 줄
// 금지'와 다르다 — 그래서 이 한 줄 말고 덧붙이는 설명은 없다.
// 재생목록 주소가 있으면 그 줄 끝에서 **한 번에 틀 수 있다**(0046) — 예전에는 곡을
// 하나씩 눌러야 했다. 곡 제목은 지금도 그 곡의 영상으로 간다.
// **줄은 가운데로 맞춘다**(사용자 지적 2026-09-09 — "'재생목록 열기' 버튼이 옆의
// 인도자랑 정렬이 안 맞는데"). 예전에는 `items-baseline`이었는데, 링크가 inline-flex라
// 그 상자의 기준선은 **첫 칸(아이콘 svg)의 아랫변**이다 — 아이콘 밑동이 글자 기준선에
// 붙으면서 아이콘과 글자가 통째로 몇 px 위로 떠올랐다. 세로 가운데로 맞추면 글자 크기가
// 달라도(12.5 / 11.5) 두 상자의 한가운데가 같은 자리에 온다.
const PraiseHead = ({ leader, playlistUrl, nameOf }) => (
  <p className="worship-praise-head flex flex-wrap items-center gap-1.5 pb-2.5 text-[12.5px] text-fg-muted">
    <span className="worship-praise-team font-bold text-fg">{PRAISE_TEAM}</span>
    {/* 인도자도 담당자 줄과 같은 호칭 규칙이다(services/people.js honorific) — 명단에
        없는 객원 인도자는 적은 글자 그대로 선다 */}
    {/* '찬양 인도'다 — 예배 인도가 아니다(사용자 지적 2026-09-09) */}
    {leader ? <span className="worship-praise-leader">· 찬양 인도 {nameOf ? nameOf(leader) : leader}</span> : null}
    {playlistUrl ? (
      <a href={playlistUrl} target="_blank" rel="noreferrer"
        className="worship-praise-playlist inline-flex items-center gap-1 leading-none text-[11.5px] font-semibold text-accent-text hover:underline">
        <ListMusic size={12} className="shrink-0" /> 재생목록 열기
      </a>
    ) : null}
  </p>
);

// 찬양 — 링크가 있으면 **제목 자체가 링크**다(사용자 지적 2026-09-03: 줄 나열이 밋밋).
// 예전에는 오른쪽 끝에 '듣기'가 따로 있어서 눌러야 할 것이 두 군데로 갈렸다.
//
// 곡도 인도자도 없으면 **빈 상태 한 벌 그대로**다 — 아직 아무것도 안 정했는데 팀
// 이름만 남겨 두면 '찬양을 정해 뒀다'로 읽힌다.
function SongsTab({ rows, leader, playlistUrl, nameOf }) {
  // 빈 상태 한 벌 — 인도자·재생목록만 정해 둔 주보는 머리 한 줄 아래에 같은 빈 상태가 선다
  const empty = <WorshipEmpty text="찬양을 아직 정하지 않았어요" />;
  if (!rows.length && !leader && !playlistUrl) return empty;
  return (
    <>
      <PraiseHead leader={leader} playlistUrl={playlistUrl} nameOf={nameOf} />
      {!rows.length ? empty : (
      <ul className={LIST}>
        {rows.map((s, i) => (
          <li key={i} className="worship-song-view flex items-center gap-2.5 py-2.5" style={ROW_LINE}>
            <span className={NUM}>{i + 1}</span>
            <SongThumb link={s.link} big />
            {s.link ? (
              <a href={s.link} target="_blank" rel="noreferrer"
                className="worship-song-link min-w-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-text hover:underline break-words">
                <span className="min-w-0 break-words">{s.title || '제목 없는 찬양'}</span>
                <ExternalLink size={11} className="shrink-0" />
              </a>
            ) : (
              <span className="min-w-0 text-[13px] text-fg break-words">{s.title}</span>
            )}
          </li>
        ))}
      </ul>
      )}
    </>
  );
}

// 광고 한 건 — 제목은 굵게, 본문은 두 줄에서 접는다(긴 광고 셋이면 화면을 다 먹었다).
// 접힘 여부는 **실제로 넘쳤을 때만** 묻는다 — 한 줄짜리 광고에 '펼치기'가 붙으면
// 누를 것이 없는 버튼이 된다.
//
// **날짜가 읽힌 광고에는 본문 아래에 달력 칩이 선다**(광고 → 내 달력 · 2026-09-25 · services/noticeDate.js).
// 칩 글자가 곧 "무엇을 읽었는지"의 확인이다(`10월 11일 (일) 오후 2:00`) — 못 읽은 광고에는 아무것도 없다.
// 누르면 부르는 쪽(worshipView)이 기기에 맞는 길로 폰 기본 달력에 넣는다.
function NoticeCard({ notice, index, serviceDate = '', onCalendar }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = useMemo(() => readNoticeDate(notice, serviceDate), [notice, serviceDate]);
  const chip = read ? noticeDateLabel(read) : '';
  const [over, setOver] = useState(false);
  const bodyRef = useRef(null);
  // **폭이 바뀌면 다시 잰다.** 넘침은 글자 수가 아니라 줄 수로 정해지므로 같은 광고가
  // 1440에서는 두 줄에 들어가고 375에서는 넉 줄이 된다 — 마운트 때 한 번만 재면 창을
  // 좁히거나 폰을 돌렸을 때 잘린 광고에 '펼치기'가 붙지 않는다(읽을 길이 사라진다).
  // **펼쳐 둔 동안은 재지 않는다** — 그때는 접힘이 없어 언제나 '안 넘친다'가 나오고,
  // 접는 순간 그 값이 한 프레임 동안 남아 버튼이 깜빡인다. 접히면 레이아웃 이펙트가
  // 그리기 전에 다시 재므로 값이 늦지 않는다.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return undefined;
    const measure = () => setOver(el.scrollHeight - el.clientHeight > 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notice.body, open]);
  return (
    <li className="worship-notice-card p-3 md:p-4 rounded-[10px]" style={CARD_BOX}>
      <div className="flex items-start gap-2">
        <span className={`${NUM} pt-0.5`}>{index + 1}</span>
        <p className="worship-notice-title min-w-0 flex-1 text-[13.5px] font-bold text-fg break-words">{notice.title || '제목 없는 광고'}</p>
      </div>
      {notice.body && (
        <div className="mt-1 pl-7">
          <p ref={bodyRef}
            className={`worship-notice-body text-[12.5px] leading-relaxed text-fg-secondary whitespace-pre-line break-words ${open ? '' : 'line-clamp-2'}`}>
            {notice.body}
          </p>
          {(over || open) && (
            <button type="button" onClick={() => setOpen(o => !o)}
              className="worship-notice-more mt-1 text-[11.5px] font-semibold text-accent-text hover:underline">
              {open ? '접기' : '펼치기'}
            </button>
          )}
        </div>
      )}
      {chip && onCalendar && (
        <div className="mt-2 pl-7">
          <button type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onCalendar(index, notice, read); } finally { setBusy(false); } }}
            className="worship-notice-cal inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-md bg-accent-weak text-accent-text text-[11.5px] font-semibold transition active:scale-95 disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
            <span>{chip}</span>
          </button>
        </div>
      )}
    </li>
  );
}

// '다음 주 예배 위원' 광고의 이름은 본명으로 세운다(real · serviceView.realNamesInRoleLines) —
// 저장된 광고 글은 그대로다. 나머지 광고는 사람이 쓴 글이라 한 글자도 안 건드린다.
function NoticesTab({ rows, serviceDate = '', onCalendar, real = null }) {
  if (!rows.length) return <WorshipEmpty text="광고를 아직 적지 않았어요" />;
  return (
    <ul className={`${LIST} space-y-2`}>
      {rows.map((n, i) => (
        <NoticeCard key={i} index={i} serviceDate={serviceDate} onCalendar={onCalendar}
          notice={real && isNextWeekNotice(n) ? { ...n, body: realNamesInRoleLines(n.body, real) } : n} />
      ))}
    </ul>
  );
}

// ── 발행본 = 종이 두 쪽 (사용자 요청 2026-09-09) ─────────────────────────────
// "주보도 발행이 완료되면 예배 페이지에서 보일 때는 주보 템플릿에 맞춰서 깔끔하게".
// 그래서 **발행된 주보에는 탭이 없다** — 담당자·찬양·광고가 다 종이 위에 있으니 탭은
// 말씀 하나만 남아 뜻이 없어진다. 작성 중인 주보는 그대로 탭이다(고치는 화면이다).
//
// 쪽 나누기: **1쪽 말씀 · 2쪽 찬양·광고**(사용자 결정 2026-09-09). 본문을 전부 적기
// 때문에 1쪽이 본문 길이만큼 길어지는데, 찬양·광고가 2쪽에서 새로 시작하므로 밀리지
// 않는다. PDF는 쪽마다 그 종이의 비율을 그대로 쓴다(services/shareImage.js).
//
// 송폼·큐시트 파일은 종이에 없다 — 그것은 바깥으로 나가는 인쇄물의 내용이 아니라
// 우리끼리 여는 파일이고, 각자의 탭(말씀·찬양)에 그대로 있다.
//
// **교회력**(2026-09-25): 머리 띠에 절기 이름 한 줄이 서고, 특별 절기면 띠가 그 절기 색이다
// (paper.jsx PaperMast · services/churchYear.js). PDF에도 그대로 들어간다(사용자 결정).
// **이름은 명단 본명**이다(nameOf · '다음 주 예배 위원' 광고는 real) — 저장된 글은 그대로다.
//
// **'넘기면서 보기'는 폰에서만**이다(사용자 결정 2026-09-25) — 데스크톱에는 버튼을 두지 않는다
// (`md:hidden`). 본문이 붙기 전에는 PDF와 같이 잠긴다(말씀 장을 나눌 재료가 없다).
// **'링크로 공유'**(사용자 결정 2026-09-26 — 주보 공개 보기 · api/service-view.js): 로그인 없이 열리는 주소를
// 기본 공유창으로(없으면 복사). 주소는 **이 탭이 열릴 때 미리 받아 둔다** — 누른 뒤에 서버를 기다리면 폰
// 브라우저가 공유창을 열 자격(사용자 동작)을 잃는다(PDF를 미리 굽는 것과 같은 이유). 발행본에만 이 탭이 있고
// 발행본은 모두가 보므로 **전원에게** 선다. 게스트(서버 없음)에는 onShareLink가 null을 돌려 버튼이 없다.
function ServicePaper({ service, nameOf, real = null, rosterKey = '', cover = null, onShareLink = null }) {
  const [link, setLink] = useState(null);      // null(받는 중) | 주소 | Error | ''(게스트 — 버튼 없음)
  const [verses, setVerses] = useState(null);
  const [story, setStory] = useState(false);
  const storyBtn = useRef(null);
  const one = useRef(null);
  const two = useRef(null);
  const date = paperDate(service?.service_date);
  const kind = kindLabel(service?.kind);
  const season = useMemo(() => churchSeason(service?.service_date), [service?.service_date]);
  const notices = useMemo(() => (service?.notices || [])
    .map(n => (real && isNextWeekNotice(n) ? { ...n, body: realNamesInRoleLines(n.body, real) } : n)),
  [service?.notices, real]);
  const closeStory = useCallback(() => {
    setStory(false);
    // 닫으면 누른 버튼으로 초점을 돌려준다(키보드로 연 사람이 제자리를 잃지 않게)
    setTimeout(() => { try { storyBtn.current?.focus({ preventScroll: true }); } catch { /* 옛 브라우저 */ } }, 0);
  }, []);

  // **누르기 전에 PDF까지 구워 둔다** — 폰에서는 굽는 시간이 공유 시트를 열 자격보다
  // 길어서 "데스크톱은 되는데 모바일은 안 된다"였다(hooks/useSheetShare.js 머리말).
  // 열쇠에 본문 절 수를 넣는다: 본문이 늦게 붙으므로, 그 전에 구운 PDF는 버려야 한다.
  const pdf = useSheetShare({
    refs: [one, two], kind: 'pdf', background: PAPER.surface,
    // 명단이 늦게 오면 이름(본명·호칭)이 바뀐다 — 그 전에 구운 PDF도 버린다(rosterKey)
    key: `${service?.id || ''}:${service?.updated_at || ''}:${verses ? verses.length : 'wait'}:${rosterKey}`,
    // 파일 이름은 `2026.09.06 주일 4부 젊은이 예배_주보`다(services/worship.js
    // servicePaperName · 사용자 결정 2026-09-11) — 카카오톡 목록에서 이름만 보고
    // 어느 예배의 주보인지 알아야 한다
    fileName: servicePaperName(service), what: '주보를 내보내지 못했어요',
  });

  const fetchLink = useCallback(() => (onShareLink && service?.id
    ? onShareLink(service.id).then(u => u || '')
    : Promise.resolve('')), [onShareLink, service?.id]);
  useEffect(() => {
    let alive = true;
    setLink(null);
    fetchLink().then(u => { if (alive) setLink(u); }).catch((e) => { if (alive) setLink(e instanceof Error ? e : new Error(String(e))); });
    return () => { alive = false; };
  }, [fetchLink]);
  const shareLink = async () => {
    let url = typeof link === 'string' ? link : '';
    if (!url) {
      // 미리 받기가 실패했으면 지금 다시 묻는다 — 이때는 공유창 대신 복사로 끝날 수 있다
      try { url = await fetchLink(); setLink(url); } catch (e) {
        if (!e?.quiet) console.error('[worship] 공개 주소 실패:', e);
        showToast(failText('링크를 만들지 못했어요', e));
        return;
      }
      if (!url) return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try { await navigator.share({ url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); showToast('링크를 복사했어요'); }
    catch { showToast(`복사하지 못했어요\n${url}`); }
  };

  // 본문 전문. 못 읽는 구절은 빈 배열이고 종이에는 구절 표기만 남는다(PassageBody와 같은 규칙).
  useEffect(() => {
    let alive = true;
    setVerses(null);
    const ref = service?.passage_ref;
    if (!ref) { setVerses([]); return undefined; }
    loadPassage(ref)
      .then(p => { if (alive) setVerses(p?.verses?.length ? p.verses : []); })
      .catch(() => { if (alive) setVerses([]); });
    return () => { alive = false; };
  }, [service?.passage_ref]);

  return (
    <div className="worship-paper">
      {/* 도구는 종이 위 한 줄 — 감추지 않는다(§8). 본문이 아직 안 왔으면 잠긴다:
          그때 구우면 본문 없는 주보가 나간다 */}
      <div className="flex items-center gap-1.5 mb-3">
        <button type="button" onClick={pdf.share} disabled={pdf.busy || verses === null}
          className={`worship-paper-pdf ${WITH_ICON} ${BTN}`}>
          {pdf.busy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
          <span>PDF로 공유</span>
        </button>
        {link !== '' && (
          <button type="button" onClick={shareLink} disabled={link === null}
            className={`worship-paper-link ${WITH_ICON} ${BTN}`}>
            <Link2 size={13} />
            <span>링크로 공유</span>
          </button>
        )}
        <button ref={storyBtn} type="button" onClick={() => setStory(true)} disabled={verses === null}
          className={`worship-story-open md:hidden ${WITH_ICON} ${BTN}`}>
          <GalleryHorizontalEnd size={13} />
          <span>넘기면서 보기</span>
        </button>
      </div>

      <div className={`${SHEET_BOX} flex flex-col gap-4`}>
        <div className="rounded-lg overflow-hidden border border-line">
          <ServiceSheetOne sheetRef={one} date={date} kind={kind} title={service?.title || ''} season={season}
            refStr={service?.passage_ref || ''} preacher={service?.preacher || ''} verses={verses || []} />
        </div>
        <div className="rounded-lg overflow-hidden border border-line">
          <ServiceSheetTwo sheetRef={two} date={date} kind={kind} team={PRAISE_TEAM} season={season}
            leader={service?.praise_leader || ''} songs={service?.songs || []}
            roles={service?.roles || []} notices={notices} nameOf={nameOf} />
        </div>
      </div>

      {story && <ServiceStory service={service} verses={verses || []} nameOf={nameOf} realName={real} cover={cover} onClose={closeStory} />}

      {/* 공유·저장이 막힌 브라우저에서 마지막 갈래 — 쪽마다 그림으로 띄운다
          (hooks/useSheetShare.jsx). **그리지 않으면 그 갈래가 아무것도 안 한다.** */}
      {pdf.overlay}

    </div>
  );
}

// ── 표지 사진 도구 줄 (0081) — 주보 **수정 중** 머리 아래 · 편집 자격자만(부르는 쪽이 가린다).
// 문구는 사용자 문구 그대로: `표지 사진`(올리기) · `표지 위치` · `표지 사진 제거`. 창·그리기는 worshipCover.jsx.
function CoverTools({ cover, busy = false, onPick, onPosition, onRemove }) {
  const input = useRef(null);
  return (
    <div className="worship-cover-tools flex flex-wrap items-center gap-1.5 -mt-2 mb-4">
      <input ref={input} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy}
        className="worship-cover-pick shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-line text-[11.5px] font-semibold text-fg transition active:scale-95 hover:bg-surface-hover disabled:opacity-40">
        <ImagePlus size={13} /> 표지 사진
      </button>
      {cover && (
        <>
          <button type="button" onClick={onPosition} className={`worship-cover-move ${WITH_ICON} ${BTN_QUIET}`}>
            <MoveVertical size={13} /> 표지 위치
          </button>
          <ConfirmPopover onConfirm={onRemove} message="표지 사진을 지울까요?" confirmLabel="제거">
            <button type="button" className={`worship-cover-remove ${BTN_QUIET}`}>표지 사진 제거</button>
          </ConfirmPopover>
        </>
      )}
    </div>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────────
export function ServiceDetail({
  service, people = [], personRoles = [], perms = {}, note = null, canWriteNote = false, startEditing = false,
  files = [], recentSongs = [], prefill = [], onBack, onSave, onPublish, onDelete, onSaveNote, onOpenAttendance, onOpenBible,
  onPullPlaylist, onLookupTitle, onShareNote, onUploadFiles, onRemoveFile, onAddToCalendar, focusNote = false, onCopyLastCue = null,
  cover = null, onUploadCover, onRemoveCover, onSaveCoverFocus, onShareLink = null,
}) {
  const [tab, setTab] = useState('paper');
  const [draft, setDraft] = useState(null);     // null이면 보기 모드
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);     // 미리보기로 열어 둔 파일 행
  // 표지 위치 창(0081) — { src, focus } | null. 새 사진을 고르면 **곧바로** .5로 열린다(업로드를 기다리지 않는다).
  const [coverDlg, setCoverDlg] = useState(null);
  const photo = useCoverShown(cover);
  // 주보 파일은 한 표에서 한 번에 오고(0047의 files.service_id) **여기서 갈래로 갈린다**
  // (0054의 files.kind). kind가 없는 행은 송폼이다 — 0054 이전에 심긴 행(게스트 시드·옛
  // 주보)이 그렇고, 마이그레이션의 백필도 같은 값을 넣었다.
  const songForms = useMemo(() => filesOfKind(files, SONGFORM), [files]);
  const cueFiles = useMemo(() => filesOfKind(files, CUESHEET), [files]);
  // 지난 큐시트 — 고치는 중이고 · 큐시트 편집 자격(구글 사본을 고칠 수 있는 사람)이 있고 · 이 주보에 큐시트 파일이 없을 때만 묻는다
  const [lastCue, setLastCue] = useState(null);
  const wantLastCue = draft !== null && !!perms.canEdit && !!perms.canEditCue && !!onCopyLastCue && !cueFiles.length;
  useEffect(() => {
    if (!wantLastCue) { setLastCue(null); return undefined; }
    let alive = true;
    fetchLastCuesheet(service).then(c => { if (alive) setLastCue(c); })
      .catch(e => console.warn('[worship] 지난 큐시트를 찾지 못했다:', e));
    return () => { alive = false; };
  }, [wantLastCue, service?.id, service?.service_date]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 올라가고 사본이 서면 그 파일 창을 연다 — 데스크톱은 그 창이 곧 구글 편집 화면이다(canEditCopy)
  const copyLastCue = useCallback(async (prev) => {
    const row = await onCopyLastCue(prev);
    if (row) setPreview(row);
  }, [onCopyLastCue]);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved'
  const dirty = useRef(false);
  const editing = draft !== null;
  const shown = editing ? draft : service;
  const rows = (k) => (Array.isArray(shown?.[k]) ? shown[k] : []);
  // 고친 횟수 — 저장이 **보낸 뒤에 또 고쳤는지** 안다(2026-09-25 감사 S7). 저장이 도는 사이
  // 친 글자가 있는데 먼저 끝난 저장이 dirty를 내려서, 곧바로 '목록으로'를 누르면 마지막 글자가
  // 안 넘어갔다. 끝난 저장은 자기가 보낸 뒤로 고친 것이 없을 때만 dirty를 내린다.
  const edits = useRef(0);
  const set = (patch) => { dirty.current = true; edits.current += 1; setDraft(d => ({ ...d, ...patch })); };
  // 이름 → 호칭 한 벌. 명단(is_pastor)과 그 해 직분(people_roles)이 재료다 —
  // 둘 다 출석 명단과 같은 조회에서 온다(worship.fetchRoster).
  //
  // **이름은 명단 본명으로 세운다**(사용자 결정 2026-09-25 · serviceView.realNameOf) — 계정 표시
  // 이름('이하랑Alex'·'꽃님')이 저장돼 있어도 보기에서는 '이하랑 형제'·'강꽃님 자매'다. 저장된
  // roles·praise_leader는 그대로고 편집 줄의 이름 칸도 그 글자 그대로다. HANDOFF §8의 '이름·사진은
  // 명단↔계정을 잇지 않는다'와 부딪히지 않는다 — 어느 쪽도 덮지 않고 **보일 때 고를 뿐**이다.
  // 명단에 없는 이름(객원)은 적힌 그대로이고 호칭도 붙지 않는다(honorific의 ⑤).
  const honor = useMemo(() => honorificsOf(people, personRoles), [people, personRoles]);
  const real = useMemo(() => realNameOf(people), [people]);
  const nameOf = useCallback((name, personId = null) => {
    const r = real(name, personId);
    return honor(r.found ? r.name : name, personId);
  }, [real, honor]);
  const rosterKey = `${(people || []).length}:${(personRoles || []).length}`;

  // 임사자 줄이 **아직 하나도 없을 때만** 지난 주보에서 둘을 물려받는다(2026-09-21).
  // 이미 적은 주보를 다시 열 때 덮어쓰면 사람이 지운 줄이 되살아난다.
  // 씨로 넣은 것을 seeded에 적어 두면 화면이 '이 값이 어디서 왔나'를 말할 수 있다 —
  // 저장 모양에는 아무것도 더하지 않는다(DB는 그냥 roles 두 줄이다).
  const [seeded, setSeeded] = useState([]);
  const draftOf = (s) => {
    const had = Array.isArray(s?.roles) ? s.roles : [];
    const seed = had.length === 0 ? (prefill || []) : [];
    setSeeded(seed);
    return {
      ...s,
      roles: had.length === 0 ? seed.map(r => ({ ...r })) : had,
      songs: Array.isArray(s?.songs) ? s.songs : [],
      notices: Array.isArray(s?.notices) ? s.notices : [],
    };
  };
  // 물려받은 칸만 비운다 — 사람이 그 사이에 적은 줄은 건드리지 않는다.
  const clearPrefill = () => {
    set({ roles: rows('roles').map(r => (isSeeded(seeded, r) ? { ...r, name: '', personId: null } : r)) });
    setSeeded([]);
  };

  // 만들자마자 수정 화면으로 들어온다(사용자 결정) — 새 주보는 열자마자 빈 칸이라
  // '수정'을 한 번 더 누르게 할 이유가 없다.
  useEffect(() => {
    // 발행본은 종이부터, 작성 중인 주보는 말씀부터(종이 탭이 아예 없다)
    dirty.current = false; setSaveState('');
    setTab(service?.status === 'published' ? 'paper' : 'word');
    setPreview(null);
    setCoverDlg(null);
    setDraft(startEditing && perms.canEdit ? draftOf(service) : null);
    // 주보가 바뀔 때만 — startEditing은 그때 부르는 쪽이 정해서 넘긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  // 편집 중에는 저절로 저장된다(사용자 결정) — 노트·출석 메모와 같은 디바운스다.
  useEffect(() => {
    if (!editing || !dirty.current) return undefined;
    const t = setTimeout(async () => {
      setSaveState('saving');
      const sent = edits.current;
      const ok = await onSave(patchOf(draft));
      setSaveState(ok ? 'saved' : '');
      if (ok && edits.current === sent) dirty.current = false;
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, editing, onSave]);

  if (!service) return null;
  const isDraft = service.status !== 'published';
  // **발행된 주보는 종이부터 본다**(사용자 요청 2026-09-09). 작성 중이거나 고치는
  // 중에는 종이 탭이 없으므로, 그 상태에서 tab이 'paper'로 남아 있으면 말씀으로 읽는다
  // (수정을 누른 순간 빈 판이 되지 않게).
  const tabs = (!isDraft && !editing) ? PUBLISHED_TABS : TABS;
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'word';
  // 출석 진입은 **발행되었는가**까지만 본다(사용자 결정 2026-09-05) — 예배 전에도
  // 미리 열어 명단을 훑을 수 있고, 그때는 출석 화면이 체크를 잠근다(worshipAttendance).
  const canAttend = perms.canCheck && attendanceVisible(service);

  // 기다리지 않고 지금 저장하고 보기 모드로
  const saveNow = async () => {
    setBusy(true);
    setSaveState('saving');
    const ok = await onSave(patchOf(draft));
    setBusy(false);
    setSaveState(ok ? 'saved' : '');
    if (ok) { dirty.current = false; setDraft(null); }
  };

  // 편집 중에 나가면 아직 안 넘어간 글자를 먼저 넘긴다(디바운스가 씹히지 않게)
  const leave = async () => {
    if (editing && dirty.current) { dirty.current = false; await onSave(patchOf(draft)); }
    onBack();
  };

  return (
    <div className={`worship-detail dc-screen ${editing && perms.canEdit ? 'pb-24 md:pb-10' : 'pb-10'}`}>
      {/* 상시 도구 줄 — 나가기와 발행. **편집 확정(저장·삭제)은 여기 없다** —
          데스크톱은 머리줄 오른쪽, 모바일은 화면 아래 고정 줄로 갔다(사용자 결정
          2026-09-03: 편집 도구 줄이 한눈에 읽히지 않았다). §8의 '확정 왼쪽 / 나가기
          오른쪽'은 각 줄 안에서 그대로다. */}
      <div className="flex items-center gap-1.5 mb-4">
        {perms.canEdit && !editing && isDraft && (
          <ConfirmPopover tone="ok" confirmLabel="발행하기" message="발행하면 모두가 이 주보를 볼 수 있어요."
            onConfirm={onPublish}>
            <button type="button"
              className="px-3 py-1.5 rounded-md bg-accent text-white text-[11.5px] font-semibold transition active:scale-95">발행하기</button>
          </ConfirmPopover>
        )}
        <span className="flex-1" />
        <button type="button" onClick={leave}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">
          <ArrowLeft size={13} /> 목록으로
        </button>
      </div>

      {/* 머리줄 — 왼쪽에 종류·날짜·설교자, 오른쪽에 출석 체크·수정.
          **한 덩이 카드다**(2026-09-07). 예전에는 칩과 날짜가 캔버스 위에 그냥 얹혀 있어서
          그 위 도구 줄과 아래 탭 줄 사이에 아무것도 없는 띠가 났다 — 무엇을 보고 있는지가
          화면 맨 위에서 한 번에 읽히도록 상자로 묶었다(목록 카드와 같은 껍데기다). */}
      {/* 교회력 물 한 겹(2026-09-25) — 왼쪽에서 오른쪽으로 옅어진다. 특별 절기는 그 색, 연중은
          우리 기본 톤(index.css `.season-wash`). 인라인 background 줄임말은 물을 덮으므로 색만 준다. */}
      {/* 표지 사진(0081)이 있으면 사진이 이긴다 — 폰 76px · 넓은 폭 92px, 글자는 아래에 앉는다(index.css `.has-cover`) */}
      <header className={`worship-head season-wash relative flex items-center gap-2 mb-4 p-3 rounded-[10px]${photo.shown ? ' has-cover' : ''}`}
        data-season={churchSeason(service.service_date)?.color || 'plain'}
        style={{ backgroundColor: 'var(--app-surface)', border: '1px solid var(--app-line)' }}>
        {photo.shown && <CoverImg cover={cover} focus={service.cover_focus_y} onFail={photo.onFail} />}
        {/* 한 줄에 종류·상태·날짜·설교자. **줄을 늘리지 않는다** — 이 자리가 두 줄이 되면
            그만큼 아래 빈 탭의 가운데가 위로 밀린다(검사가 화면의 1/3을 요구한다). */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 min-w-0 flex-1">
          <span className="worship-head-kind px-2 py-0.5 rounded-full bg-tag-blue text-tag-blue-fg text-[10.5px] font-bold">{kindLabel(service.kind)}</span>
          {isDraft && <span className="worship-draft-badge px-2 py-0.5 rounded-full bg-tag-yellow text-tag-yellow-fg text-[10.5px] font-bold">작성 중</span>}
          <span className="worship-head-date text-[12.5px] font-bold text-fg">{formatServiceDate(service.service_date)}</span>
          {/* 설교자는 **넓은 폭(≥640)에서만** 머리줄에 — 375에서는 둘째 줄로 내려가 머리 카드가
              두 줄이 됐다(실기기 스크린샷 2026-09-07·08). 폰에서는 말씀 탭 제목 밑에 같은 값이 이미
              있으니(`구절 · 설교자`) 머리에서 뺀다. */}
          {service.preacher && (
            <span className="worship-head-preacher hidden sm:inline min-w-0 text-[11.5px] text-fg-muted truncate">· 설교 {service.preacher}</span>
          )}
        </div>
        {/* 버튼은 좁은 화면에서 서로 밑으로 접힌다 — 날짜 덩이를 밀어내지 않게 shrink-0 */}
        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
          {/* 출석은 발행된 뒤, 예배 날짜가 지난 뒤에만 만진다(사용자 결정) */}
          {canAttend && !editing && (
            <button type="button" onClick={onOpenAttendance}
              className="worship-att-open shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-line text-[11.5px] font-semibold text-fg transition active:scale-95 hover:bg-surface-hover">
              <ClipboardCheck size={13} /> 출석 체크
            </button>
          )}
          {/* **수정은 머리줄 오른쪽에서 채운 버튼**이다(사용자 지적 2026-09-03: 눈에 안
              띈다). 도구 줄의 연한 버튼이던 것을 자격자에게만 여기로 올렸다 —
              발행·삭제·저장 상태는 그대로 아래 도구 줄에 남는다. */}
          {perms.canEdit && !editing && (
            <button type="button" onClick={() => { dirty.current = false; setSaveState(''); setDraft(draftOf(service)); }}
              className={`worship-edit-open shrink-0 ${WITH_ICON} ${BTN}`}>
              <PencilLine size={13} /> 수정
            </button>
          )}
          {/* 편집 중 — 저장 상태 칩은 좁은 화면에서도 여기 있고(하나만 그린다),
              저장·삭제 버튼은 데스크톱에서만 여기 선다. 모바일은 아래 고정 줄이다. */}
          {perms.canEdit && editing && (
            <>
              {/* 저장은 저절로 되므로 그 사실이 눈에 보여야 한다(노트 라벨과 같은 톤).
                  발행 전에는 '임시' — 저장은 됐지만 아직 나만 본다는 뜻이 담긴다 */}
              <SaveState state={saveState} savedLabel={isDraft ? '임시 저장되었어요' : '저장되었어요'} />
              <button type="button" onClick={saveNow} disabled={busy}
                className={`worship-save shrink-0 hidden md:inline-flex ${BTN}`}>저장</button>
              <ConfirmPopover className="shrink-0 hidden md:inline-flex" onConfirm={onDelete}
                message={<><span className="font-bold text-fg">이 주보를 삭제할까요?</span><br />모든 내용이 같이 사라지니 신중하게 선택해주세요</>}>
                <button type="button" className="worship-head-delete px-2.5 py-1.5 rounded-md text-tag-red-fg hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">삭제</button>
              </ConfirmPopover>
            </>
          )}
        </div>
      </header>

      {/* 표지 사진 도구 — **수정 중에만**, 편집 자격자에게만(사용자 문구 `표지 사진`·`표지 위치`·`표지 사진 제거`).
          종이(PDF)에는 싣지 않는다. */}
      {perms.canEdit && editing && onUploadCover && (
        <CoverTools cover={cover} busy={!!cover?._pending}
          onPick={(file) => { setCoverDlg({ src: URL.createObjectURL(file), focus: 0.5, own: true }); void onUploadCover(file); }}
          onPosition={() => { const img = coverImage(cover); if (img) setCoverDlg({ src: img.src, focus: service.cover_focus_y ?? 0.5 }); }}
          onRemove={onRemoveCover} />
      )}
      {coverDlg && (
        <CoverDialog src={coverDlg.src} focus={coverDlg.focus} title={service.title || ''}
          dateLabel={formatServiceDate(service.service_date)} kindLabel={kindLabel(service.kind)}
          onCancel={() => { if (coverDlg.own) URL.revokeObjectURL(coverDlg.src); setCoverDlg(null); }} onSave={onSaveCoverFocus} />
      )}

      {/* `aria-selected`는 **`role="tab"`인 요소에만** 뜻이 있다(그냥 button에 달면 보조
          기기가 무시한다). 대시보드 탭 줄(views.jsx)이 이미 tablist/tab 한 벌이라 같은
          모양으로 맞춘다 — 보이는 것은 그대로다. */}
      <div role="tablist" aria-label="주보" className="flex items-center gap-1 mb-3 overflow-x-auto scrollbar-hide x-scroll-lock" style={{ borderBottom: '1px solid var(--app-line)' }}>
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" onClick={() => setTab(t.id)} aria-selected={activeTab === t.id}
            className={`worship-tab shrink-0 px-3 py-2 text-[12.5px] font-semibold transition-colors ${activeTab === t.id ? 'text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            style={{ borderBottom: `2px solid ${activeTab === t.id ? 'var(--app-ink)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="worship-tabpanel">
        {activeTab === 'paper' && (
          <ServicePaper service={service} nameOf={nameOf} real={real} rosterKey={rosterKey} cover={cover} onShareLink={onShareLink} />
        )}
        {activeTab === 'word' && (editing
          ? <WordEdit draft={draft} set={set} cueFiles={cueFiles} canEdit={!!(editing && perms.canEdit)}
              onPick={fs => onUploadFiles(fs, CUESHEET)} onOpen={setPreview}
              onRemove={onRemoveFile} lastCue={lastCue} onCopyLast={copyLastCue} />
          : <WordTab service={service} onOpenBible={onOpenBible} cueFiles={cueFiles} onOpenFile={setPreview} />)}
        {activeTab === 'roles' && (editing
          ? <RolesEdit rows={rows('roles')} people={people} onChange={v => set({ roles: v })}
              seeded={seeded} onClearPrefill={clearPrefill} />
          : <RolesTab rows={rows('roles')} people={people} nameOf={nameOf} />)}
        {activeTab === 'songs' && (
          <>
            {editing
              ? <SongsEdit rows={rows('songs')} people={people} onChange={v => set({ songs: v })}
                  recent={recentSongs}
                  leader={draft.praise_leader || ''} onLeader={v => set({ praise_leader: v })}
                  playlistUrl={draft.praise_playlist_url || ''}
                  onPlaylist={v => set({ praise_playlist_url: v })}
                  onPullPlaylist={onPullPlaylist} onLookupTitle={onLookupTitle} Thumb={SongThumb} />
              : <SongsTab rows={rows('songs')} leader={service.praise_leader || ''}
                  playlistUrl={service.praise_playlist_url || ''} nameOf={nameOf} />}
            {/* 송폼은 찬양 목록 바로 아래 한 구역이다(0047). 붙이고 지우는 것은 수정
                화면에서, 보기 화면에는 줄만 선다 — 담당자·찬양·광고와 같은 문법이다.
                큐시트 파일(말씀 탭)이 여기 섞이지 않는 것은 kind로 갈랐기 때문이다(0054). */}
            <ServiceFiles files={songForms} canEdit={!!(editing && perms.canEdit)}
              onPick={fs => onUploadFiles(fs, SONGFORM)} onOpen={setPreview} onRemove={onRemoveFile} />
          </>
        )}
        {activeTab === 'notices' && (editing
          ? <NoticesEdit rows={rows('notices')} onChange={v => set({ notices: v })} />
          : <NoticesTab rows={rows('notices')} serviceDate={service.service_date} real={real}
              onCalendar={onAddToCalendar && !isDraft ? (i, n, r) => onAddToCalendar(service, i, n, r) : null} />)}
      </div>

      {/* **발행 전에는 노트 자리가 없다**(사용자 결정 2026-09-09 — "발행하기 전에는 예배
          노트 작성 못하게 섹션을 아예 지워주고"). 아직 아무도 안 본 주보에 노트를 쓰면
          그 노트가 어느 예배의 것인지 모호해지고, 발행 뒤에 주보가 바뀌면 노트가 먼저
          쓰인 셈이 된다. */}
      {canWriteNote && !editing && !isDraft && (
        <MyNote note={note} serviceId={service?.id || ''} serviceDate={service?.service_date || ''} passageRef={service?.passage_ref || ''}
          passageTitle={service?.title || ''} onSave={onSaveNote} onShare={onShareNote} focus={focusNote} />
      )}

      {/* 파일 미리보기 — 업무 첨부와 **같은 창**이다. 송폼도 큐시트 파일도 이 창 하나로
          연다. PDF는 앱 안 pdf.js로 그려지고 새 탭·내려받기도 그 창이 준다(§6-29-q).
          사진 넘기기는 이미지끼리만 도는데, 그 목록은 **연 줄과 같은 갈래**만 준다 —
          찬양 탭에서 연 송폼이 말씀 탭 큐시트로 넘어가면 어디에 있는지 알 수 없다. */}
      {preview && (
        <Suspense fallback={null}>
        <FilePreviewModal row={preview} initialSrc={null} onClose={() => setPreview(null)}
          rows={fileKindOf(preview) === CUESHEET ? cueFiles : songForms}
          /* 큐시트 사본만, 교역자·마스터만 편집 화면으로 연다(사용자 결정 2026-09-09).
             송폼·업무 첨부는 그대로 보기다(§7) */
          canEditCopy={fileKindOf(preview) === CUESHEET && !!perms.canEditCue}
          /* 지난 주보(예배 날짜가 오늘(KST) 앞)의 큐시트는 앱 안 창을 보기로 연다 — 편집은 머리줄 버튼으로만(2026-10-02) */
          inlineEdit={fileKindOf(preview) === CUESHEET && !!perms.canEditCue && !(service?.service_date && service.service_date < kstToday())} />
        </Suspense>
      )}

      {/* 모바일 편집 도구 줄 — 화면 아래에 붙는다. 하단 탭바(4.5rem + safe-area) 위에
          얹고, 편집 중에만 뜬다. 긴 주보를 고칠 때 저장 버튼을 찾아 위로 올라가지
          않게(사용자 결정 2026-09-03). 데스크톱은 머리줄에 있으니 여기는 md:hidden.
          **body 포털이라야 한다**(§6-1) — .dc-screen의 transform 애니메이션이 조상
          containing block이 되어, 그냥 두면 fixed가 뷰포트가 아니라 이 화면 상자를
          기준으로 앉는다(검사가 폭 불일치·바닥에서 316px 떨어짐으로 잡아냈다). */}
      {perms.canEdit && editing && createPortal(
        <div className="worship-edit-bar md:hidden fixed left-0 right-0 z-30 flex items-center gap-2 px-3 py-2.5"
          style={{
            // **탭바가 잰 제 높이**로 앉는다(layout.jsx MobileTabBar → `--mobile-tab-bar-h`).
            // 예전에는 `4.5rem + safe-area` 상수였는데 탭바 높이는 안 내용으로 정해져서
            // (pt-2 + 아이콘 + 글자 + pb + safe-area ≈ 68px) 그 사이에 4px쯤 틈이 남았다
            // (사용자 지적 2026-09-08). 변수가 아직 없는 첫 프레임에는 옛 상수가 대신 선다.
            bottom: 'var(--mobile-tab-bar-h, calc(4.5rem + env(safe-area-inset-bottom)))',
            background: 'var(--app-surface)', borderTop: '1px solid var(--app-line)',
          }}>
          <button type="button" onClick={saveNow} disabled={busy} className={`worship-save-mobile ${BTN}`}>저장</button>
          <span className="flex-1" />
          <ConfirmPopover onConfirm={onDelete}
            message={<><span className="font-bold text-fg">이 주보를 삭제할까요?</span><br />모든 내용이 같이 사라지니 신중하게 선택해주세요</>}>
            <button type="button" className="px-2.5 py-1.5 rounded-md text-tag-red-fg hover:bg-surface-hover text-[11.5px] font-semibold transition active:scale-95">삭제</button>
          </ConfirmPopover>
        </div>,
        document.body,
      )}
    </div>
  );
}
