// ============================================================================
// 본문 안의 우리 앱 링크 판정 한 벌(import 0 · RichText InlineLink와 업무 링크 카드가 같이 · logcheck-task가 노드에서 본다)
// ----------------------------------------------------------------------------
// 같은 origin의 두 모양을 앱 안 여는 길로 돌린다:
//   `/?p=<프로젝트>&t=<업무>`  주소창·AI 다듬기 링크(services/ai.js resolveTaskLinks)
//   `/s/t/<업무>` · `/s/p/<프로젝트>`  공유 버튼이 복사하는 주소(ShareButton · vercel.json rewrite → api/share.js)
// 예전에는 앞의 것만 알아서, 공유 버튼으로 복사해 붙인 링크를 누르면 api/share를 거쳐 **페이지 전체를 새로 읽었다**.
// `/s/c/<동아리>`(가입 신청 QR)는 여기서 열지 않는다 — `?apply=1`을 들고 모임 화면으로 가는 길은 api/share가 만든다.
// 돌려주는 것: { projectId, taskId, share } | null. 공유 모양의 업무 링크는 프로젝트를 모른다(projectId null — 여는 쪽이 업무로 찾는다).
// ============================================================================

const SHARE_PATH = /^\/s\/([pt])\/([^/?#]+)\/?$/;

export function parseAppLink(href, here) {
  try {
    const base = new URL(here);
    const u = new URL(href, base);
    if (u.origin !== base.origin) return null;
    const share = u.pathname.match(SHARE_PATH);
    if (share) {
      const id = decodeURIComponent(share[2]);
      return share[1] === 't' ? { projectId: null, taskId: id, share: true } : { projectId: id, taskId: null, share: true };
    }
    const projectId = u.searchParams.get('p');
    return projectId ? { projectId, taskId: u.searchParams.get('t'), share: false } : null;
  } catch { return null; }
}
