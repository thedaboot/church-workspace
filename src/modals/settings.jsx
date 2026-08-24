import React, { useState, useRef } from 'react';
import { Check, Hash, Archive } from 'lucide-react';
import { CONFIG } from '../config.js';
import { useStore } from '../store/workspaceStore.js';
import { selectCurrentUser } from '../store/selectors.js';
import { useAuth } from '../services/auth.jsx';
import { supabase } from '../services/supabaseClient.js';
import * as cloud from '../services/cloud.js';
import { Avatar } from '../components/Avatar.jsx';
import { showToast } from '../components/Toast.jsx';

// ============================================================================
// 설정 창 — 내 정보(사진·이름·소속 팀·연결된 계정) / 프로젝트 만들기·이름 수정
// ============================================================================

// 폰 사진을 그대로 올리면 5MB짜리가 18px 동그라미에 들어간다. 목록마다 수십 개가 뜨는
// 이미지라 가운데를 정사각으로 잘라 256px jpeg로 줄여서 올린다.
// 자르기 UI는 두지 않는다 — 얼굴은 대개 가운데에 있고, 원형으로 보여줄 거라 미세한
// 위치는 티가 안 난다. 필요해지면 그때 붙이면 된다.
const AVATAR_PX = 256;
async function squareThumb(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_PX;
  canvas.getContext('2d').drawImage(
    bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bmp.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('이미지를 바꾸지 못했어요');
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export function ProfileModal({ onClose, onSave }) {
  const user = useStore(selectCurrentUser);
  const { enabled, session } = useAuth();
  const cloudMode = enabled && !!session;
  const [name, setName] = useState(user.name);
  // teams[0]이 대표 팀. 기존 단일 team만 있던 계정은 그걸 첫 원소로 올려 시작한다.
  const [teams, setTeams] = useState(() => (user.teams?.length ? user.teams : [user.team]).filter(Boolean));
  const toggleTeam = (t) => setTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const [linking, setLinking] = useState(null); // 연결 중인 provider
  // 사진: 고르는 즉시 올려서 미리 보여주고, 실제 적용은 '저장'에서 한다.
  // undefined = 안 건드림 / '' = 지움(다시 이름 첫 글자 원)
  const [avatarUrl, setAvatarUrl] = useState(undefined);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const shownAvatar = avatarUrl !== undefined ? avatarUrl : (user.avatarUrl || '');

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                       // 같은 파일을 다시 골라도 change가 나게
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('이미지 파일만 올릴 수 있어요.'); return; }
    setUploading(true);
    try {
      const url = await cloud.uploadContentImage(await squareThumb(file));
      setAvatarUrl(url);
    } catch (err) {
      showToast(`사진 업로드에 실패했어요: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const linkedProviders = (session?.user?.identities || []).map(i => i.provider);
  const linkProvider = async (provider) => {
    if (!supabase || linking) return;
    setLinking(provider);
    try {
      const { error } = await supabase.auth.linkIdentity({ provider });
      if (error) showToast(`연결 실패: ${error.message} · Supabase 설정에서 Manual Linking이 켜져 있는지 확인해 주세요.`);
    } catch (e) {
      showToast(`연결 실패: ${e.message} · Supabase 설정에서 Manual Linking이 켜져 있는지 확인해 주세요.`);
    } finally {
      setLinking(null);
    }
  };
  const ACCOUNTS = [
    { provider: 'google', label: '구글', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> },
    { provider: 'kakao', label: '카카오', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#191919" d="M12 3C6.48 3 2 6.54 2 10.9c0 2.8 1.86 5.26 4.66 6.65l-1.19 4.4c-.1.39.34.7.68.47l5.23-3.47c.2.01.41.02.62.02 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"/></svg> },
  ];
  // 첫 설정이 안 끝난 상태(이름이 없거나 팀이 없음) = 온보딩.
  // 안내 문구를 바꾸고, 이름·팀을 채우기 전에는 닫지 못하게 한다.
  // 한 번 채우고 나면 이 조건이 거짓이 되어 다시 뜨지 않는다.
  const onboarding = !user.name || !(user.teams?.length || user.team);
  const canSave = name.trim().length > 0 && teams.length > 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm max-h-[90dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        <h3 className="font-bold text-fg mb-1 tracking-[-0.25px]">{onboarding ? '반가워요! 먼저 알려주세요' : '내 정보'}</h3>
        <p className="text-xs text-fg-muted mb-4 leading-relaxed">
          {onboarding
            ? <>워크스페이스에 표시될 이름과 소속 팀을 정해주세요.<br />팀은 여러 개 고를 수 있어요.</>
            : <>워크스페이스에 표시될 이름(닉네임)과 소속 팀이에요.<br />언제든 여기서 바꿀 수 있어요.</>}
        </p>

        {/* 사진은 클라우드에서만 — 게스트 모드에는 올릴 곳이 없다.
            가입할 때 구글·카카오 사진이 이미 들어와 있어서, 대부분은 여기서 아무것도
            안 해도 얼굴이 보인다. 이 자리는 "그걸 내 것으로 바꾸는" 곳이다. */}
        {cloudMode && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">사진</label>
            <div className="flex items-center gap-3">
              <Avatar name={name || user.name || ''} url={shownAvatar} className="flex w-14 h-14 text-lg" />
              <div className="min-w-0">
                <div className="flex gap-1.5">
                  <button
                    type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="text-accent-text hover:bg-accent-weak rounded-md px-2 py-1 text-xs transition active:scale-95 disabled:opacity-50"
                  >{uploading ? '올리는 중...' : '사진 변경'}</button>
                  {shownAvatar && (
                    <button
                      type="button" onClick={() => setAvatarUrl('')} disabled={uploading}
                      className="text-fg-muted hover:bg-surface-hover rounded-md px-2 py-1 text-xs transition active:scale-95 disabled:opacity-50"
                    >기본으로</button>
                  )}
                </div>
                <p className="text-[11px] text-fg-faint mt-1">가운데를 정사각형으로 잘라서 올려요</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
            </div>
          </div>
        )}

        <label className="block text-xs font-semibold text-fg-muted mb-1.5">이름</label>
        {/* text-[13px]: 업무 창의 입력칸들(하위 업무·링크 13px)과 같은 크기 —
            text-sm(14px)은 12px 라벨 옆에서 입력만 커 보였다(실제 지적) */}
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          className="w-full border border-line rounded-xs p-2 mb-4 text-[13px] bg-surface text-fg focus:ring-2 focus:ring-accent outline-none"
        />

        {/* 한 사람이 두 팀 이상에 속하는 일이 흔하다(예: 찬양팀 + 임원진) → 다중 선택.
            맨 앞 팀이 대표 팀이 되어 아바타 색과 기본 팀 보드에 쓰인다. */}
        <label className="block text-xs font-semibold text-fg-muted mb-1.5">
          소속 팀 <span className="font-normal text-fg-faint">여러 개 고를 수 있어요</span>
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(CONFIG.TEAMS).map(([t, colorClass]) => {
            const on = teams.includes(t);
            return (
              <button
                key={t} type="button" onClick={() => toggleTeam(t)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs text-[11px] font-semibold border transition active:scale-95 ${on ? colorClass + ' border-transparent' : 'bg-surface text-fg-muted border-line hover:bg-surface-hover'}`}
              >
                {on && <Check size={11} className="shrink-0" />}{t}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-fg-faint mb-4">
          {teams.length > 1 ? <>대표 팀은 <span className="font-semibold text-fg-muted">{teams[0]}</span>이에요 (아바타 색·기본 팀 보드에 쓰여요)</> : ' '}
        </p>

        {cloudMode && (
          <div className="mb-6">
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">연결된 계정</label>
            <div className="border border-line rounded-md divide-y divide-line/60">
              {ACCOUNTS.map(({ provider, label, icon }) => {
                const linked = linkedProviders.includes(provider);
                return (
                  <div key={provider} className="flex items-center gap-2.5 px-3 py-2">
                    <span className="shrink-0">{icon}</span>
                    <span className="flex-1 text-sm text-fg">{label}</span>
                    {linked
                      ? <span className="inline-flex items-center gap-1 bg-tag-green text-tag-green-fg rounded-full text-[10px] px-2 py-0.5"><Check size={10} /> 연결됨</span>
                      : <button type="button" onClick={() => linkProvider(provider)} disabled={linking === provider} className="text-accent-text hover:bg-accent-weak rounded-md px-2 py-1 text-xs transition active:scale-95 disabled:opacity-50">{linking === provider ? '연결 중...' : '연결하기'}</button>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {/* 첫 로그인에는 취소가 없다 — 이름·팀 없이 들어가면 멘션·팀 보드가 빈다 */}
          {!onboarding && <button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button>}
          <button
            onClick={() => {
              if (!canSave) return;
              // 사진을 안 건드렸으면 키 자체를 빼야 한다 — UPDATE_USER가 payload를 그대로
              // 펼치므로 avatarUrl: undefined를 넘기면 지금 사진이 사라진다
              const payload = { name: name.trim(), team: teams[0], teams };
              if (avatarUrl !== undefined) payload.avatarUrl = avatarUrl;
              onSave(payload);
              onClose();
            }}
            disabled={!canSave || uploading}
            className="flex-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95"
          >
            {onboarding ? '시작하기' : '저장'}
          </button>
        </div>
        {!canSave && <p className="text-[11px] text-tag-red-fg mt-2 text-center">이름과 팀을 하나 이상 정해주세요</p>}
      </div>
    </div>
  );
}

// project를 넘기면 이름 수정, 없으면 새로 만들기 (창 하나로 둘 다)
// 보관은 이름 수정일 때만 — 만들면서 보관할 일은 없다. 삭제(관리자 전용)와 달리
// 되돌릴 수 있으므로 확인 팝오버를 두지 않는다.
export function ProjectModal({ onClose, onSave, onArchive, project = null }) {
  const renaming = !!project;
  const [title, setTitle] = useState(project?.title || '');
  const clean = title.trim();
  const unchanged = renaming && clean === (project.title || '').trim();
  const submit = () => { if (clean && !unchanged) onSave(clean); };
  const archived = !!project?.archived;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-surface p-5 md:p-6 rounded-lg shadow-elevated border border-line w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
        <h3 className="font-bold text-fg mb-4 flex items-center gap-2"><Hash size={18} className="text-accent"/> {renaming ? '프로젝트 이름 수정' : '새 프로젝트 생성'}</h3>
        <label className="block text-xs font-semibold text-fg-muted mb-1.5">프로젝트 이름</label>
        <input
          type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="예: 2026 하계 수련회"
          className="w-full border border-line p-2.5 rounded-xs mb-6 text-[13px] bg-surface text-fg placeholder:text-fg-faint focus:ring-2 focus:ring-accent outline-none"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        {/* 보관은 눌러야 보이는 기능이라 회색 글자 한 줄로 두면 아무도 못 찾는다.
            테두리와 아이콘 칩을 줘서 '누를 수 있는 것'으로 읽히게 한다. 다만 이 창의
            주 행동은 '저장'이므로 구조색(accent)은 쓰지 않는다 — 노란 칩은 '잠시
            치워둔다'는 뜻이고 빨강처럼 위험해 보이지 않는다.
            설명은 짧은 두 줄로 끊는다. 한 문장으로 길게 쓰면 좁은 창에서
            '검색과 보관함에서 / 찾을 수 있어요'처럼 구절 중간이 잘렸다. */}
        {renaming && onArchive && (
          <div className="-mt-3 mb-5 pb-5 border-b border-line">
            <button
              onClick={() => { onArchive(project.id, !archived); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-line bg-surface hover:bg-surface-hover transition-colors text-left active:scale-[0.99]"
            >
              <span className="w-7 h-7 rounded-md bg-tag-yellow text-tag-yellow-fg flex items-center justify-center shrink-0">
                <Archive size={14} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-fg">{archived ? '보관 해제' : '보관하기'}</span>
                {(archived
                  ? ['다시 상단 탭과 대시보드에 나와요']
                  : ['상단 탭과 대시보드에서 빠져요', '업무는 그대로 남고, 보관함에서 찾을 수 있어요']
                ).map(line => (
                  <span key={line} className="block text-[11px] text-fg-muted mt-px text-pretty">{line}</span>
                ))}
              </span>
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-surface-hover hover:bg-line text-fg-muted py-2.5 rounded-md text-sm font-medium transition active:scale-95">취소</button>
          <button onClick={submit} disabled={!clean || unchanged} className="flex-1 bg-accent hover:bg-accent-strong disabled:bg-line text-white py-2.5 rounded-md text-sm font-medium transition active:scale-95">{renaming ? '저장' : '생성하기'}</button>
        </div>
      </div>
    </div>
  );
}
