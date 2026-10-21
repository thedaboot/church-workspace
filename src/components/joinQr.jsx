import { useState } from 'react';
import { QrCardModal } from './ClubQr.jsx';
import { Segmented } from './segmented.jsx';

// ============================================================================
// 가입 QR 두 갈래 — 시안(v5 4묶음 · mock/b5 · 사용자 결정 2026-10-21 "새가족 QR, 새 가입자 QR을 따로")
// ----------------------------------------------------------------------------
//   새가족     = 처음 온 사람. **로그인 없이** 새가족 카드를 쓴다 → 정착 보드 '첫 방문'(services/welcome.js).
//   워크스페이스 가입 = 청년 명단에는 있는데 아직 계정이 없는 사람. 카카오 로그인 → 승인 대기 → 마스터가 수락하면서
//                '청년 명단과 잇기'(지금 있는 길 · views/membersView ProfileLinkPanel)로 잇는다.
// 여는 자리: 모임 > 새가족 탭 머리(새가족이 기본) · 멤버 관리 > 가입자 탭 머리(워크스페이스 가입이 기본).
// 시안 주소는 게스트 빌드 안에서 열리는 `?welcome=1` · `?join=1`이다. 실제로 붙일 때 `/s/w`·`/s/j`(카톡 카드 OG)로.
// ============================================================================
const KINDS = {
  newcomer: { name: '처음 오셨나요?', label: '새신자 청년 가입', q: 'welcome=1' },
  member: { name: '더다붓 워크스페이스', label: '워크스페이스 가입', q: 'join=1' },
};

export function JoinQrModal({ initial = 'newcomer', onClose }) {
  const [kind, setKind] = useState(initial);
  const k = KINDS[kind];
  const url = `${window.location.origin}/?${k.q}`;
  return (
    <QrCardModal name={k.name} label={k.label} url={url} short={null}
      copied="링크를 복사했어요" onClose={onClose}
      header={(
        <Segmented role="group" aria-label="QR 종류" className="flex p-[3px] rounded-md mb-3" value={kind} onPick={setKind}
          btnClassName="flex-1 px-3 py-[6px] rounded-sm text-[12px] font-semibold transition-colors" data-join-kind=""
          items={[['newcomer', '새가족', { 'data-kind': 'newcomer' }], ['member', '워크스페이스 가입', { 'data-kind': 'member' }]]} />
      )} />
  );
}
